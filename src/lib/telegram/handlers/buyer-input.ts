import { execRun, isD1Mode, queryFirst } from "@/lib/db";
import type { DatabaseAccess } from "@/lib/db-access";
import { getActiveVariant } from "@/lib/catalog";
import { parsePixelverifInput, validateBuyerFields } from "@/lib/buyer-fields";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";
import { PIXELVERIF_GMAIL_REGEX } from "@/lib/pixelverif/purchase";
import { addToCart } from "@/lib/telegram/cart";
import { deleteMessage, sendMessage } from "@/lib/telegram/api";
import { minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import { setPendingActionUnlessCreating } from "./shared";

const PIXELVERIF_STASH_TTL_MS = 10 * 60_000;

type PixelverifStashPayload = {
  email: string;
  password?: string;
  variantId: number;
  flowId: string;
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
  try {
    const parsed = JSON.parse(await decryptSecret(String(row.ciphertext), String(row.iv))) as PixelverifStashPayload;
    if (
      !parsed || typeof parsed !== "object" ||
      Number(parsed.variantId) !== variantId ||
      String(parsed.flowId ?? "") !== String(row.flow_id ?? "") ||
      typeof parsed.email !== "string" || !parsed.email
    ) {
      return null;
    }
    return { payload: parsed, expiresAt: String(row.expires_at) };
  } catch {
    return null;
  }
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
    await sendMessage({ chat_id:chatId,text:"Jumlah tidak valid. Pilih 1–30 untuk Buff Muse.",reply_markup:minimalMenuKeyboard() }); return true;
  }
  if (!await setPendingActionUnlessCreating(String(from.id),chatId,`buyerinput:${productId}:${variantId}:${qty}`)) return true;
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
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",userId,user!.pending_action);
  if (!claim.changes) return true;
  await clearPixelverifStash(userId);
  const result = await addToCart(userId,productId,variantId,1,1,{ pv_email: fields.pv_email, pv_password: fields.pv_password, pv_totp_secret: fields.pv_totp_secret });
  if (!result.ok) {
    const msg = result.reason === "pixelverif_limit"
      ? "Hanya 1 varian aktivasi Google yang dapat dipesan per checkout. Hapus baris lama di keranjang terlebih dahulu."
      : "Tidak dapat menambah ke keranjang. Coba lagi dari katalog.";
    await sendMessage({ chat_id:chatId,text:msg,reply_markup:minimalMenuKeyboard() });
    return true;
  }
  const { handleShowCart } = await import("./cart");
  await handleShowCart(chatId,0,{ ...from, first_name: "" });
  return true;
}

export async function handleBuyerInput(text:string,chatId:number,from:{ id:number;first_name:string;username?:string },messageId?:number):Promise<boolean> {
  if (await handlePixelverifInput(text, chatId, from, messageId)) return true;
  if (chatId !== from.id) return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return false;
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",String(from.id));
  const match = /^buyerinput:(\d+):(\d+):(\d+)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const variant = await getActiveVariant(Number(match[2]));
  try {
    if (!variant?.buyer_field_key || variant.pixelverif_input) throw new Error("stale");
    validateBuyerFields(variant,{ muse_invite_code:trimmed },Number(match[3]));
  } catch { await sendMessage({ chat_id:chatId,text:"Kode tidak valid atau varian berubah. Kirim 6 huruf/angka ASCII, atau /batal." }); return true; }
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action);
  if (!claim.changes) return true;
  const result = await addToCart(String(from.id),Number(match[1]),Number(match[2]),Number(match[3]),1,{ muse_invite_code:trimmed });
  if (!result.ok) { await sendMessage({ chat_id:chatId,text:"Tidak dapat menambah: maksimum 30 unit dan satu kode per checkout. Hapus baris lama untuk mengganti kode.",reply_markup:minimalMenuKeyboard() }); return true; }
  const { handleShowCart } = await import("./cart");
  await handleShowCart(chatId,0,from);
  return true;
}
