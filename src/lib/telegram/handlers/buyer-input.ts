import { execRun, isD1Mode, queryFirst } from "@/lib/db";
import type { DatabaseAccess } from "@/lib/db-access";
import { effectiveVariantStock, formatVariantLabel, getActiveVariant } from "@/lib/catalog";
import {
  INVITE_EMAIL_REGEX,
  parsePixelverifInput,
  validateBuyerFields,
  type BuyerFields,
  type CustomBuyerFieldDef,
  type CustomBuyerFieldsConfig,
  type PixelverifInput,
} from "@/lib/buyer-fields";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { PIXELVERIF_GMAIL_REGEX } from "@/lib/pixelverif/purchase";
import { resolveBulkPrice } from "@/lib/bulk-pricing";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { readCheckoutEmail } from "@/lib/telegram/checkout-email";
import { deleteMessage, sendMessage } from "@/lib/telegram/api";
import { minimalMenuKeyboard, TELEGRAM_MAX_QTY } from "@/lib/telegram/keyboards";
import { escapeHtml } from "@/lib/telegram/messages/format";
import { MAX_UNIQUE_UNITS_PER_ORDER } from "@/lib/fulfillment/units";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import { productDisplayName } from "@/lib/i18n/product-name";
import type { Locale } from "@/lib/i18n/locale";
import { setPendingActionUnlessCreating } from "./shared";

const PIXELVERIF_STASH_TTL_MS = 10 * 60_000;

type PixelverifStashPayload = {
  kind?: "pixelverif";
  email: string;
  password?: string;
  totpSecret?: string;
  variantId: number;
  flowId: string;
};

type CustomStashPayload = {
  kind: "custom";
  variantId: number;
  flowId: string;
  qty: number;
  values: Record<string, string>;
};

/**
 * Delete a message that carried a password/2FA key. Bounded retry (no sleep in
 * Workers); deleteMessage resolves {ok:false} on API errors instead of
 * throwing. If deletion is still unconfirmed, tell the buyer to delete it
 * manually instead of implying it is gone. The flow continues: the chat is the
 * buyer's own private chat with the bot (owner decision 2026-11-22).
 */
async function deleteSecretMessage(chatId: number, messageId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await deleteMessage(chatId, messageId).catch(() => null);
    if (result?.ok) return true;
  }
  await sendMessage({ chat_id: chatId, text: "⚠️ Pesan berisi password/kunci 2FA belum berhasil dihapus otomatis. Mohon hapus pesan tersebut secara manual dari chat ini." }).catch(() => undefined);
  return false;
}

/** Drop durable Pixel credential stash (cancel / flow restart / completion). */
export async function clearPixelverifStash(userId: string): Promise<void> {
  if (!isD1Mode()) return;
  await execRun("DELETE FROM telegram_pixelverif_stashes WHERE user_id=?", userId).catch(() => {});
}

/** Bounded maintenance sweep for expired Telegram Pixel credential stashes. */
export async function purgeExpiredTelegramPixelverifStashes(db: DatabaseAccess) {
  return db.execRun(
    `DELETE FROM telegram_pixelverif_stashes WHERE user_id IN (
       SELECT user_id FROM telegram_pixelverif_stashes
       WHERE datetime(expires_at)<=datetime('now')
       ORDER BY expires_at LIMIT 200
     )`,
  );
}

async function saveEncryptedStash(
  userId: string,
  variantId: number,
  flowId: string,
  payload: PixelverifStashPayload,
  expiresAtIso: string,
): Promise<boolean> {
  if (!isD1Mode()) return false;
  const sealed = await encryptSecret(JSON.stringify(payload));
  await execRun(
    `INSERT INTO telegram_pixelverif_stashes(user_id, variant_id, flow_id, ciphertext, iv, expires_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       variant_id=excluded.variant_id,
       flow_id=excluded.flow_id,
       ciphertext=excluded.ciphertext,
       iv=excluded.iv,
       expires_at=excluded.expires_at,
       updated_at=datetime('now')`,
    userId,
    variantId,
    flowId,
    sealed.ciphertext,
    sealed.iv,
    expiresAtIso,
  );
  return true;
}

async function loadEncryptedStash(
  userId: string,
  variantId: number,
  expectedFlowId?: string,
): Promise<{ payload: PixelverifStashPayload; expiresAt: string } | null> {
  if (!isD1Mode()) return null;
  const row = await queryFirst(
    `SELECT variant_id, flow_id, ciphertext, iv, expires_at
     FROM telegram_pixelverif_stashes
     WHERE user_id=? AND variant_id=? AND datetime(expires_at)>datetime('now')`,
    userId,
    variantId,
  );
  if (!row || !row.ciphertext || !row.iv) return null;
  if (expectedFlowId && String(row.flow_id ?? "") !== expectedFlowId) return null;
  try {
    const parsed = JSON.parse(await decryptSecret(String(row.ciphertext), String(row.iv))) as PixelverifStashPayload;
    if (
      !parsed || typeof parsed !== "object" ||
      (parsed as { kind?: unknown }).kind === "custom" ||
      Number(parsed.variantId) !== variantId ||
      String(parsed.flowId ?? "") !== String(row.flow_id ?? "") ||
      (expectedFlowId && parsed.flowId !== expectedFlowId) ||
      typeof parsed.email !== "string" || !parsed.email
    ) {
      return null;
    }
    return { payload: parsed, expiresAt: String(row.expires_at) };
  } catch {
    return null;
  }
}

async function saveEncryptedCustomStash(
  userId: string,
  variantId: number,
  flowId: string,
  payload: CustomStashPayload,
  expiresAtIso: string,
): Promise<boolean> {
  if (!isD1Mode()) return false;
  const sealed = await encryptSecret(JSON.stringify(payload));
  await execRun(
    `INSERT INTO telegram_pixelverif_stashes(user_id, variant_id, flow_id, ciphertext, iv, expires_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       variant_id=excluded.variant_id,
       flow_id=excluded.flow_id,
       ciphertext=excluded.ciphertext,
       iv=excluded.iv,
       expires_at=excluded.expires_at,
       updated_at=datetime('now')`,
    userId,
    variantId,
    flowId,
    sealed.ciphertext,
    sealed.iv,
    expiresAtIso,
  );
  return true;
}

async function loadEncryptedCustomStash(
  userId: string,
  variantId: number,
  qty: number,
  expectedFlowId?: string,
): Promise<{ payload: CustomStashPayload; expiresAt: string } | null> {
  if (!isD1Mode()) return null;
  const row = await queryFirst(
    `SELECT variant_id, flow_id, ciphertext, iv, expires_at
     FROM telegram_pixelverif_stashes
     WHERE user_id=? AND variant_id=? AND datetime(expires_at)>datetime('now')`,
    userId,
    variantId,
  );
  if (!row || !row.ciphertext || !row.iv) return null;
  if (expectedFlowId && String(row.flow_id ?? "") !== expectedFlowId) return null;
  try {
    const parsed = JSON.parse(await decryptSecret(String(row.ciphertext), String(row.iv))) as CustomStashPayload;
    if (
      !parsed || typeof parsed !== "object" ||
      parsed.kind !== "custom" ||
      Number(parsed.variantId) !== variantId ||
      Number(parsed.qty) !== qty ||
      String(parsed.flowId ?? "") !== String(row.flow_id ?? "") ||
      (expectedFlowId && parsed.flowId !== expectedFlowId) ||
      !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)
    ) {
      return null;
    }
    const cleanValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.values)) {
      if (typeof k !== "string" || typeof v !== "string") return null;
      cleanValues[k] = v;
    }
    return { payload: { ...parsed, values: cleanValues }, expiresAt: String(row.expires_at) };
  } catch {
    return null;
  }
}

/** Load a completed encrypted custom-field stash for single-item Telegram checkout. */
export async function loadCompletedCustomStash(
  userId: string,
  variantId: number,
  qty: number,
  flowId: string,
): Promise<Record<string, string> | null> {
  const existing = await loadEncryptedCustomStash(userId, variantId, qty, flowId);
  if (!existing) return null;
  return existing.payload.values;
}

/** Load a completed 3-step encrypted Pixel credential stash for single-item Telegram checkout. */
export async function loadCompletedPixelverifStash(
  userId: string,
  variantId: number,
  flowId: string,
): Promise<PixelverifInput | null> {
  const existing = await loadEncryptedStash(userId, variantId, flowId);
  if (!existing?.payload.password || !existing.payload.totpSecret) return null;
  try {
    return parsePixelverifInput({
      pv_email: existing.payload.email,
      pv_password: existing.payload.password,
      pv_totp_secret: existing.payload.totpSecret,
    });
  } catch {
    return null;
  }
}

function formatCustomFieldPrompt(
  config: CustomBuyerFieldsConfig,
  idx: number,
  locale: Locale,
  isFirst: boolean,
  prev?: { label: string; secret: boolean; skipped?: boolean },
): { text: string; placeholder: string } {
  const en = locale === "en";
  const field: CustomBuyerFieldDef = config.fields[idx];
  const total = config.fields.length;
  const hasAnyPassword = config.fields.some((f) => f.type === "password");
  const lines: string[] = [];

  if (prev) {
    const escapedPrev = escapeHtml(prev.label);
    if (prev.skipped) {
      lines.push(en ? `⏭ ${escapedPrev} skipped.` : `⏭ ${escapedPrev} dilewati.`);
    } else if (prev.secret) {
      lines.push(en ? `✅ ${escapedPrev} saved & message deleted.` : `✅ ${escapedPrev} diterima & pesan dihapus.`);
    } else {
      lines.push(en ? `✅ ${escapedPrev} saved.` : `✅ ${escapedPrev} disimpan.`);
    }
    lines.push("");
  }

  if (isFirst) {
    const title = config.title?.trim() || (en ? "Account details" : "Data khusus");
    lines.push(`🔐 <b>${escapeHtml(title)}</b>`);
    if (config.note?.trim()) {
      lines.push(escapeHtml(config.note.trim()));
    }
    if (hasAnyPassword) {
      lines.push(
        en
          ? "Messages containing passwords are <b>automatically deleted</b> after being read."
          : "Pesan berisi password akan <b>otomatis dihapus</b> setelah dibaca.",
      );
    }
    lines.push("");
  }

  const stepPrefix = total > 1 ? `(${idx + 1}/${total}) ` : "";
  const showExample = field.type !== "password" && Boolean(field.placeholder?.trim());
  const example = showExample
    ? (en ? ` (e.g. <code>${escapeHtml(field.placeholder!.trim())}</code>)` : ` (contoh: <code>${escapeHtml(field.placeholder!.trim())}</code>)`)
    : "";
  lines.push(
    en
      ? `${stepPrefix}Send <b>${escapeHtml(field.label)}</b>${example}.`
      : `${stepPrefix}Kirim <b>${escapeHtml(field.label)}</b>${example}.`,
  );
  if (field.helper?.trim()) {
    lines.push(escapeHtml(field.helper.trim()));
  }
  if (!isFirst && field.type === "password") {
    lines.push(
      en
        ? "Your message will be <b>automatically deleted</b> after being read."
        : "Pesan Anda akan <b>otomatis dihapus</b> setelah dibaca.",
    );
  }
  if (field.required === false) {
    lines.push(
      en
        ? "<i>(Optional — type <code>-</code> to skip)</i>"
        : "<i>(Opsional — ketik <code>-</code> untuk melewati)</i>",
    );
  }
  lines.push("");
  lines.push(en ? "/batal to cancel." : "/batal untuk batal.");

  const placeholder = (field.placeholder?.trim() || field.label).slice(0, 64);
  return { text: lines.join("\n"), placeholder };
}

/** Open single-item payment picker directly after buyer input (Telegram has no cart). */
async function openSinglePaymentOfferAfterInput(
  chatId: number,
  from: { id: number; first_name: string; username?: string },
  productId: number,
  variantId: number,
  qty: number,
  extra: { museInviteCode?: string; inviteEmail?: string; pvFlowId?: string; customFlowId?: string; buyerFields: BuyerFields },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const hasStash = Boolean(extra.pvFlowId || extra.customFlowId);
  const variant = await getActiveVariant(variantId);
  const product = variant && variant.product_id === productId
    ? await queryFirst(`SELECT id, name, name_en, is_active, telegram_enabled FROM products WHERE id=?`, productId)
    : null;
  if (!variant || variant.product_id !== productId || !product || Number(product.is_active) !== 1 || Number(product.telegram_enabled) !== 1) {
    if (hasStash) await clearPixelverifStash(String(from.id));
    await sendMessage({
      chat_id: chatId,
      text: en ? "Variant unavailable. Please select again from /katalog." : "Varian tidak tersedia. Silakan pilih ulang dari /katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const stock = effectiveVariantStock(variant);
  const stockMax = stock === -1 ? TELEGRAM_MAX_QTY : Math.max(0, Math.min(stock, TELEGRAM_MAX_QTY));
  const uniqueMax = variant.fulfillment_mode === "unique" ? Math.min(MAX_UNIQUE_UNITS_PER_ORDER, stockMax) : stockMax;
  const minQty = Math.max(1, Number(variant.min_qty ?? 1) || 1);
  const maxQty = Math.min(variant.max_qty ?? TELEGRAM_MAX_QTY, uniqueMax);
  if (stock === 0 || qty < minQty || qty > maxQty || (stock !== -1 && qty > stock)) {
    if (hasStash) await clearPixelverifStash(String(from.id));
    await sendMessage({
      chat_id: chatId,
      text: en ? "Stock or quantity limit changed. Please choose again from /katalog." : "Stok atau batas jumlah berubah. Silakan pilih ulang dari /katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  let effectivePrice = Number(variant.price);
  try {
    effectivePrice = resolveBulkPrice(Number(variant.price), qty, variant.bulk_pricing_enabled ? 1 : 0, JSON.stringify(variant.bulk_pricing_tiers ?? [])).price;
  } catch {
    if (hasStash) await clearPixelverifStash(String(from.id));
    await sendMessage({
      chat_id: chatId,
      text: en ? "Price unavailable. Try again from /katalog." : "Harga belum tersedia. Silakan coba lagi dari /katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  let checked: { required: boolean; email: string | null };
  try {
    checked = await readCheckoutEmail(String(from.id), [{ productId, variantId }]);
  } catch {
    checked = { required: false, email: null };
  }
  if (checked.required && !checked.email) {
    if (hasStash) await clearPixelverifStash(String(from.id));
    await sendMessage({
      chat_id: chatId,
      text: en ? "An active email is required for this product. Please try again from /katalog." : "Email aktif dibutuhkan untuk produk ini. Silakan ulangi dari /katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }
  const approvalTag = await checkoutApprovalTag([{
    productId,
    variantId,
    qty,
    price: effectivePrice,
    buyerFieldKey: variant.buyer_field_key,
    maxQty: variant.max_qty,
    buyerFields: extra.buyerFields,
    pixelverifInput: variant.pixelverif_input,
  }]);
  const productName = productDisplayName({ name: String(product.name), nameEn: product.name_en == null ? null : String(product.name_en) }, ctx.locale);
  const label = formatVariantLabel(variant, ctx.locale);
  const displayName = qty > 1 ? `${productName} · ${label} ×${qty}` : `${productName} · ${label}`;
  const { showPaymentMethodOffer } = await import("./payment-methods");
  await showPaymentMethodOffer(chatId, 0, from, {
    mode: "single",
    productId,
    variantId,
    qty,
    tag: approvalTag,
    productName: displayName,
    subtotal: effectivePrice * qty,
    identity: {
      kind: "single",
      productId,
      variantId,
      qty,
      ...(extra.museInviteCode ? { museInviteCode: extra.museInviteCode } : {}),
      ...(extra.inviteEmail ? { inviteEmail: extra.inviteEmail } : {}),
      ...(extra.pvFlowId ? { pvFlowId: extra.pvFlowId } : {}),
      ...(extra.customFlowId ? { customFlowId: extra.customFlowId } : {}),
    },
    contactEmail: checked.email,
    skipBuyerInputPrompt: true,
  });
}

const PV_INTRO =
  "🔐 <b>Data akun Google untuk aktivasi</b>\n\n" +
  "Kirim <b>email Gmail</b> yang akan diaktivasi (contoh: nama@gmail.com).\n" +
  "Pesan berisi password/kunci 2FA akan <b>otomatis dihapus</b> setelah dibaca. " +
  "Data tersimpan terenkripsi, dipakai sekali untuk aktivasi, lalu dihapus.\n\n" +
  "/batal untuk batal.";

export async function requestBuyerInput(chatId:number,from:{ id:number },productId:number,variantId:number,qty:number):Promise<boolean> {
  const variant = await getActiveVariant(variantId);
  if (variant?.pixelverif_input) {
    if (chatId !== from.id) return true;
    if (!Number.isSafeInteger(qty) || qty !== 1 || variant.product_id !== productId) {
      await sendMessage({ chat_id:chatId,text:"Produk ini hanya bisa dibeli 1 unit per pesanan.",reply_markup:minimalMenuKeyboard() }); return true;
    }
    await clearPixelverifStash(String(from.id));
    if (!await setPendingActionUnlessCreating(String(from.id),chatId,`pvinput:${productId}:${variantId}:email`)) return true;
    await sendMessage({ chat_id:chatId,text:PV_INTRO,parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"nama@gmail.com" } });
    return true;
  }
  if (!variant?.buyer_field_key) return false;
  if (chatId !== from.id) return true;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > (variant.max_qty ?? 100) || variant.product_id !== productId) {
    const cap = variant.max_qty ?? 100;
    const msg = variant.buyer_field_key === "muse_invite_code"
      ? "Jumlah tidak valid. Pilih 1–30 untuk Buff Muse."
      : `Jumlah tidak valid. Maksimal ${cap} unit per pesanan.`;
    await sendMessage({ chat_id:chatId,text:msg,reply_markup:minimalMenuKeyboard() }); return true;
  }
  if (variant.buyer_field_key === "custom") {
    const config = variant.custom_buyer_fields;
    const ctx = await tgCtxFor(from.id).catch(() => ({ locale: "id" as Locale }));
    const en = ctx.locale === "en";
    if (!config?.fields?.length) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "Product input configuration is incomplete. Please contact admin."
          : "Konfigurasi data produk belum lengkap. Silakan hubungi admin.",
        reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
      });
      return true;
    }
    const userId = String(from.id);
    await clearPixelverifStash(userId);
    const flowId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + PIXELVERIF_STASH_TTL_MS).toISOString();
    try {
      const saved = await saveEncryptedCustomStash(
        userId,
        variantId,
        flowId,
        { kind: "custom", variantId, flowId, qty, values: {} },
        expiresAt,
      );
      if (!saved) throw new Error("stash_unavailable");
    } catch {
      await clearPixelverifStash(userId);
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "Could not start the input session. Please try again from /katalog."
          : "Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",
        reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
      });
      return true;
    }
    if (!await setPendingActionUnlessCreating(userId, chatId, `custominput:${productId}:${variantId}:${qty}:0`)) {
      await clearPixelverifStash(userId);
      return true;
    }
    const prompt = formatCustomFieldPrompt(config, 0, ctx.locale, true);
    await sendMessage({
      chat_id: chatId,
      text: prompt.text,
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: prompt.placeholder },
    });
    return true;
  }
  if (!await setPendingActionUnlessCreating(String(from.id),chatId,`buyerinput:${productId}:${variantId}:${qty}`)) return true;
  if (variant.buyer_field_key === "invite_email") {
    await sendMessage({ chat_id:chatId,text:"Kirim email yang ingin di-invite (contoh: nama@gmail.com). /batal untuk batal.",reply_markup:{ force_reply:true,input_field_placeholder:"nama@gmail.com" } });
    return true;
  }
  await sendMessage({ chat_id:chatId,text:"Kirim Kode Invite Muse (6 huruf/angka, case-sensitive; 1–30 = 1–30B token). /batal untuk batal.",reply_markup:{ force_reply:true,input_field_placeholder:"6 huruf/angka" } });
  return true;
}

async function handlePixelverifInput(text:string,chatId:number,from:{ id:number },messageId?:number):Promise<boolean> {
  if (chatId !== from.id) return false;
  const userId = String(from.id);
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",userId);
  const match = /^pvinput:(\d+):(\d+):(email|password|totp)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const [, productIdRaw, variantIdRaw, step] = match;
  const productId = Number(productIdRaw), variantId = Number(variantIdRaw);
  const variant = await getActiveVariant(variantId);
  if (!variant?.pixelverif_input || variant.product_id !== productId) {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Varian berubah. Silakan pilih ulang dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }

  if (step === "email") {
    const emailNormalized = text.trim().toLowerCase();
    if (!PIXELVERIF_GMAIL_REGEX.test(emailNormalized)) {
      await sendMessage({ chat_id:chatId,text:"Email tidak valid. Kirim alamat @gmail.com yang akan diaktivasi, atau /batal." });
      return true;
    }
    const { isPixelverifEmailBlocked, PIXELVERIF_BLOCKED_EMAIL_MESSAGE } = await import("@/lib/pixelverif/blocklist");
    if (await isPixelverifEmailBlocked(emailNormalized, 3)) {
      await sendMessage({ chat_id:chatId,text:`${PIXELVERIF_BLOCKED_EMAIL_MESSAGE} Kirim alamat @gmail.com lain, atau /batal.` });
      return true;
    }
    // Persist encrypted across stateless Workers isolates with a hard 10-minute
    // deadline; telegram_users.buyer_email stays untouched (shared contact col).
    const flowId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + PIXELVERIF_STASH_TTL_MS).toISOString();
    try {
      const ok = await saveEncryptedStash(userId, variantId, flowId, { email: emailNormalized, variantId, flowId }, expiresAt);
      if (!ok) throw new Error("stash_unavailable");
    } catch {
      await sendMessage({ chat_id:chatId,text:"Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
      return true;
    }
    const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",`pvinput:${productId}:${variantId}:password`,userId,user!.pending_action);
    if (!stored.changes) {
      await clearPixelverifStash(userId);
      return true;
    }
    await sendMessage({ chat_id:chatId,text:"Sekarang kirim <b>password Gmail</b> tersebut. Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Password Gmail" } });
    return true;
  }

  if (step === "password") {
    // Preserve raw password text (no .trim()), matching web checkout schema.
    if (messageId) await deleteSecretMessage(chatId, messageId);
    if (!text || text.length > 200) {
      await sendMessage({ chat_id:chatId,text:"Password tidak valid. Kirim ulang password Gmail, atau /batal." });
      return true;
    }
    const existing = await loadEncryptedStash(userId, variantId);
    if (!existing) {
      await clearPixelverifStash(userId);
      await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action).catch(() => {});
      await sendMessage({ chat_id:chatId,text:"Sesi input kedaluwarsa. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
      return true;
    }
    try {
      // Keep the original hard 10-minute deadline from flow start (no sliding extension).
      const ok = await saveEncryptedStash(
        userId,
        variantId,
        existing.payload.flowId,
        { ...existing.payload, password: text },
        existing.expiresAt,
      );
      if (!ok) throw new Error("stash_unavailable");
    } catch {
      await clearPixelverifStash(userId);
      await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action).catch(() => {});
      await sendMessage({ chat_id:chatId,text:"Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
      return true;
    }
    const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",`pvinput:${productId}:${variantId}:totp`,userId,user!.pending_action);
    if (!stored.changes) {
      await clearPixelverifStash(userId);
      return true;
    }
    await sendMessage({ chat_id:chatId,text:"Terakhir, kirim <b>kunci setup 2FA</b> (TOTP secret dari aplikasi authenticator, bukan kode 6 digit). Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Kunci setup 2FA" } });
    return true;
  }

  // step === "totp"
  if (messageId) await deleteSecretMessage(chatId, messageId);
  const existing = await loadEncryptedStash(userId, variantId);
  if (!existing || !existing.payload.password) {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Sesi input kedaluwarsa. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  let fields;
  try {
    fields = parsePixelverifInput({ pv_email: existing.payload.email, pv_password: existing.payload.password, pv_totp_secret: text.trim() });
  } catch (error) {
    // Keep the durable stash intact so the buyer can retry the TOTP step across isolates.
    await sendMessage({ chat_id:chatId,text:`${(error as Error).message} Kirim ulang kunci setup 2FA, atau /batal.` });
    return true;
  }
  // Persist completed triple in the encrypted stash (10-min TTL matching payq1 offer);
  // never persisted in telegram_users.pending_action or any cart table.
  const offerExpiresAt = new Date(Date.now() + PIXELVERIF_STASH_TTL_MS).toISOString();
  try {
    const saved = await saveEncryptedStash(
      userId,
      variantId,
      existing.payload.flowId,
      { email: fields.pv_email, password: fields.pv_password, totpSecret: fields.pv_totp_secret, variantId, flowId: existing.payload.flowId },
      offerExpiresAt,
    );
    if (!saved) throw new Error("stash_unavailable");
  } catch {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action);
  if (!claim.changes) {
    await clearPixelverifStash(userId);
    return true;
  }
  await openSinglePaymentOfferAfterInput(
    chatId,
    { ...from, first_name: (from as { first_name?: string }).first_name ?? "" },
    productId,
    variantId,
    1,
    {
      pvFlowId: existing.payload.flowId,
      buyerFields: { pv_email: fields.pv_email, pv_password: fields.pv_password, pv_totp_secret: fields.pv_totp_secret },
    },
  );
  return true;
}

async function handleCustomBuyerInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
  messageId?: number,
): Promise<boolean> {
  if (chatId !== from.id) return false;
  const userId = String(from.id);
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?", userId);
  const rawPending = String(user?.pending_action ?? "");
  const match = /^custominput:(\d+):(\d+):(\d+):(\d+)$/.exec(rawPending);
  if (!match) return false;

  const productId = Number(match[1]);
  const variantId = Number(match[2]);
  const qty = Number(match[3]);
  const idx = Number(match[4]);
  const ctx = await tgCtxFor(from.id).catch(() => ({ locale: "id" as Locale }));
  const en = ctx.locale === "en";

  const variant = await getActiveVariant(variantId);
  const config = variant?.custom_buyer_fields;
  if (!variant || variant.buyer_field_key !== "custom" || variant.product_id !== productId || !config?.fields?.length || idx >= config.fields.length) {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?", userId, rawPending).catch(() => {});
    await sendMessage({
      chat_id: chatId,
      text: en ? "Variant changed. Please select again from /katalog." : "Varian berubah. Silakan pilih ulang dari katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return true;
  }

  const field = config.fields[idx];
  // Immediately delete user's chat message on password steps, before validation,
  // matching Pixel Verification's secret-handling invariant.
  if (field.type === "password" && messageId) {
    await deleteSecretMessage(chatId, messageId);
  }

  const existing = await loadEncryptedCustomStash(userId, variantId, qty);
  if (!existing) {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?", userId, rawPending).catch(() => {});
    await sendMessage({
      chat_id: chatId,
      text: en ? "Input session expired. Please restart from /katalog." : "Sesi input kedaluwarsa. Silakan ulangi dari katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return true;
  }

  const isRequired = field.required !== false;
  const trimmedCmd = text.trim().toLowerCase();
  const skippedOptional = !isRequired && (trimmedCmd === "-" || trimmedCmd === "/lewati" || trimmedCmd === "/skip");
  const nextValues: Record<string, string> = { ...existing.payload.values };

  if (!skippedOptional) {
    // Preserve raw password text (no .trim()), matching web checkout schema.
    const value = field.type === "password"
      ? String(text)
      : field.type === "email"
        ? text.trim().toLowerCase()
        : text.trim();

    if (!value) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `${escapeHtml(field.label)} is required. Please resend, or /batal.`
          : `${escapeHtml(field.label)} wajib diisi. Kirim ulang, atau /batal.`,
        parse_mode: "HTML",
      });
      return true;
    }
    if (field.type === "email" && (value.length > 254 || !INVITE_EMAIL_REGEX.test(value))) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `Invalid ${escapeHtml(field.label)} format. Please resend (e.g. <code>nama@gmail.com</code>), or /batal.`
          : `Format ${escapeHtml(field.label)} tidak valid. Kirim ulang (contoh: <code>nama@gmail.com</code>), atau /batal.`,
        parse_mode: "HTML",
      });
      return true;
    }
    if (value.length > 500) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `${escapeHtml(field.label)} is too long (max 500 characters). Please resend, or /batal.`
          : `${escapeHtml(field.label)} terlalu panjang (maks 500 karakter). Kirim ulang, atau /batal.`,
        parse_mode: "HTML",
      });
      return true;
    }
    nextValues[field.key] = value;
  }

  if (idx + 1 < config.fields.length) {
    try {
      // Preserve the original hard 10-minute deadline from flow start (no sliding extension).
      const saved = await saveEncryptedCustomStash(
        userId,
        variantId,
        existing.payload.flowId,
        { ...existing.payload, values: nextValues },
        existing.expiresAt,
      );
      if (!saved) throw new Error("stash_unavailable");
    } catch {
      await clearPixelverifStash(userId);
      await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?", userId, rawPending).catch(() => {});
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "Could not save your input temporarily. Please restart from /katalog."
          : "Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",
        reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
      });
      return true;
    }
    const stored = await execRun(
      "UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",
      `custominput:${productId}:${variantId}:${qty}:${idx + 1}`,
      userId,
      rawPending,
    );
    if (!stored.changes) {
      await clearPixelverifStash(userId);
      return true;
    }
    const prompt = formatCustomFieldPrompt(config, idx + 1, ctx.locale, false, {
      label: field.label,
      secret: field.type === "password",
      skipped: skippedOptional,
    });
    await sendMessage({
      chat_id: chatId,
      text: prompt.text,
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: prompt.placeholder },
    });
    return true;
  }

  // Final field completed: run full server validation matching web checkout.
  let validated: BuyerFields;
  try {
    validated = validateBuyerFields(variant, { custom_values: nextValues }, qty);
  } catch (error) {
    await sendMessage({
      chat_id: chatId,
      text: `${escapeHtml((error as Error).message)} ${en ? "Please resend, or /batal." : "Kirim ulang, atau /batal."}`,
      parse_mode: "HTML",
    });
    return true;
  }

  // Persist completed custom values in the encrypted stash (10-min TTL matching payq1 offer);
  // never persisted in telegram_users.pending_action.
  const offerExpiresAt = new Date(Date.now() + PIXELVERIF_STASH_TTL_MS).toISOString();
  try {
    const saved = await saveEncryptedCustomStash(
      userId,
      variantId,
      existing.payload.flowId,
      { kind: "custom", variantId, flowId: existing.payload.flowId, qty, values: validated.custom_values ?? {} },
      offerExpiresAt,
    );
    if (!saved) throw new Error("stash_unavailable");
  } catch {
    await clearPixelverifStash(userId);
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?", userId, rawPending).catch(() => {});
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "Could not save your input temporarily. Please restart from /katalog."
        : "Sesi input tidak dapat disimpan sementara. Silakan ulangi dari katalog.",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return true;
  }
  const claim = await execRun(
    "UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",
    userId,
    rawPending,
  );
  if (!claim.changes) {
    await clearPixelverifStash(userId);
    return true;
  }
  await openSinglePaymentOfferAfterInput(
    chatId,
    from,
    productId,
    variantId,
    qty,
    {
      customFlowId: existing.payload.flowId,
      buyerFields: validated,
    },
  );
  return true;
}

export async function handleBuyerInput(text:string,chatId:number,from:{ id:number;first_name:string;username?:string },messageId?:number):Promise<boolean> {
  if (await handlePixelverifInput(text, chatId, from, messageId)) return true;
  if (await handleCustomBuyerInput(text, chatId, from, messageId)) return true;
  if (chatId !== from.id) return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",String(from.id));
  const match = /^buyerinput:(\d+):(\d+):(\d+)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const productId = Number(match[1]);
  const variantId = Number(match[2]);
  const qty = Number(match[3]);
  const variant = await getActiveVariant(variantId);
  let validated: BuyerFields;
  try {
    if (!variant?.buyer_field_key || variant.pixelverif_input || variant.product_id !== productId) throw new Error("stale");
    const candidate = variant.buyer_field_key === "invite_email"
      ? { invite_email: trimmed }
      : { muse_invite_code: trimmed };
    validated = validateBuyerFields(variant, candidate, qty);
  } catch {
    const errText = variant?.buyer_field_key === "invite_email"
      ? "Format email tidak valid atau varian berubah. Kirim email yang ingin di-invite (contoh: nama@gmail.com), atau /batal."
      : "Kode tidak valid atau varian berubah. Kirim 6 huruf/angka ASCII, atau /batal.";
    await sendMessage({ chat_id:chatId,text:errText }); return true;
  }
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action);
  if (!claim.changes) return true;
  await openSinglePaymentOfferAfterInput(chatId, from, productId, variantId, qty, {
    ...(validated.muse_invite_code ? { museInviteCode: validated.muse_invite_code } : {}),
    ...(validated.invite_email ? { inviteEmail: validated.invite_email } : {}),
    buyerFields: validated,
  });
  return true;
}
