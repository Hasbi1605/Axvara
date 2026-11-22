import { execRun,queryFirst } from "@/lib/db";
import { getActiveVariant } from "@/lib/catalog";
import { parsePixelverifInput, validateBuyerFields } from "@/lib/buyer-fields";
import { addToCart } from "@/lib/telegram/cart";
import { deleteMessage, sendMessage } from "@/lib/telegram/api";
import { minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import { setPendingActionUnlessCreating } from "./shared";

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

/** Drop in-memory Pixel credential stashes (cancel / flow restart). */
export function clearPixelverifStash(userId: string): void {
  pvSecretStash.delete(userId);
  pvEmailStash.delete(userId);
}

const PV_INTRO =
  "🔐 <b>Data akun Google untuk aktivasi</b>\n\n" +
  "Kirim <b>email Gmail</b> yang akan diaktivasi (contoh: nama@gmail.com).\n" +
  "Pesan berisi password/kunci 2FA akan <b>otomatis dihapus</b> setelah dibaca. " +
  "Data tersimpan terenkripsi, dipakai sekali untuk aktivasi, lalu dihapus.\n\n" +
  "/batal untuk batal.";

export async function requestBuyerInput(chatId:number,from:{ id:number },productId:number,variantId:number,qty:number):Promise<boolean> {
  sweepExpiredPixelverifStashes();
  const variant = await getActiveVariant(variantId);
  if (variant?.pixelverif_input) {
    if (chatId !== from.id) return true;
    if (!Number.isSafeInteger(qty) || qty !== 1 || variant.product_id !== productId) {
      await sendMessage({ chat_id:chatId,text:"Produk ini hanya bisa dibeli 1 unit per pesanan.",reply_markup:minimalMenuKeyboard() }); return true;
    }
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
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",String(from.id));
  const match = /^pvinput:(\d+):(\d+):(email|password|totp)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const [, productIdRaw, variantIdRaw, step] = match;
  const productId = Number(productIdRaw), variantId = Number(variantIdRaw);
  const variant = await getActiveVariant(variantId);
  if (!variant?.pixelverif_input || variant.product_id !== productId) {
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Varian berubah. Silakan pilih ulang dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  const value = text.trim();

  if (step === "email") {
    if (!/^[^\s@]+@gmail\.com$/i.test(value)) {
      await sendMessage({ chat_id:chatId,text:"Email tidak valid. Kirim alamat @gmail.com yang akan diaktivasi, atau /batal." });
      return true;
    }
    const { isPixelverifEmailBlocked, PIXELVERIF_BLOCKED_EMAIL_MESSAGE } = await import("@/lib/pixelverif/blocklist");
    if (await isPixelverifEmailBlocked(value, 3)) {
      await sendMessage({ chat_id:chatId,text:`${PIXELVERIF_BLOCKED_EMAIL_MESSAGE} Kirim alamat @gmail.com lain, atau /batal.` });
      return true;
    }
    // Do NOT write the Gmail target into telegram_users.buyer_email: that is
    // the shared checkout-contact column and may change mid-flow. Bind it to
    // this flow's stash; the TOTP step below reads ONLY this stash.
    pvEmailStash.set(String(from.id), { email: value.toLowerCase(), variantId, expiresAt: Date.now() + 10 * 60_000 });
    const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",`pvinput:${productId}:${variantId}:password`,String(from.id),user!.pending_action);
    if (!stored.changes) return true;
    await sendMessage({ chat_id:chatId,text:"Sekarang kirim <b>password Gmail</b> tersebut. Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Password Gmail" } });
    return true;
  }

  if (step === "password") {
    if (!value || value.length > 200) {
      if (messageId) await deleteSecretMessage(chatId, messageId);
      await sendMessage({ chat_id:chatId,text:"Password tidak valid. Kirim ulang password Gmail, atau /batal." });
      return true;
    }
    // Secrets never touch durable storage: pending_action carries only an
    // opaque step marker. The password itself lives solely in the in-memory
    // stash below (10-minute TTL, one variant; see map declaration).
    pvSecretStash.set(String(from.id), { password: value, variantId, expiresAt: Date.now() + 10 * 60_000 });
    if (messageId) await deleteSecretMessage(chatId, messageId);
    const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",`pvinput:${productId}:${variantId}:totp`,String(from.id),user!.pending_action);
    if (!stored.changes) return true;
    await sendMessage({ chat_id:chatId,text:"Terakhir, kirim <b>kunci setup 2FA</b> (TOTP secret dari aplikasi authenticator, bukan kode 6 digit). Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Kunci setup 2FA" } });
    return true;
  }

  // step === "totp"
  const stash = pvSecretStash.get(String(from.id));
  pvSecretStash.delete(String(from.id));
  if (messageId) await deleteSecretMessage(chatId, messageId);
  if (!stash || stash.variantId !== variantId || stash.expiresAt < Date.now()) {
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Sesi input kedaluwarsa. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  const emailStash = pvEmailStash.get(String(from.id));
  pvEmailStash.delete(String(from.id));
  if (!emailStash || emailStash.variantId !== variantId || emailStash.expiresAt < Date.now()) {
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Sesi input kedaluwarsa. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  let fields;
  try {
    fields = parsePixelverifInput({ pv_email: emailStash.email, pv_password: stash.password, pv_totp_secret: value });
  } catch (error) {
    await sendMessage({ chat_id:chatId,text:`${(error as Error).message} Kirim ulang kunci setup 2FA, atau /batal.` });
    // Restore both stashes so the buyer can retry the TOTP step only.
    pvSecretStash.set(String(from.id), stash);
    pvEmailStash.set(String(from.id), emailStash);
    return true;
  }
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action);
  if (!claim.changes) return true;
  const result = await addToCart(String(from.id),productId,variantId,1,1,{ pv_email: fields.pv_email, pv_password: fields.pv_password, pv_totp_secret: fields.pv_totp_secret });
  if (!result.ok) { await sendMessage({ chat_id:chatId,text:"Tidak dapat menambah ke keranjang. Coba lagi dari katalog.",reply_markup:minimalMenuKeyboard() }); return true; }
  const { handleShowCart } = await import("./cart");
  await handleShowCart(chatId,0,{ ...from, first_name: "" });
  return true;
}

// Password + target Gmail live in memory only (never DB/logs), max 10 minutes,
// one variant. deleteMessage is best-effort (a rejected deletion must not block
// the flow), but the stash TTL is enforced by sweeps — never left past expiry.
const pvSecretStash = new Map<string, { password: string; variantId: number; expiresAt: number }>();
const pvEmailStash = new Map<string, { email: string; variantId: number; expiresAt: number }>();

function sweepExpiredPixelverifStashes(now = Date.now()): void {
  for (const [userId, stash] of pvSecretStash) if (stash.expiresAt < now) pvSecretStash.delete(userId);
  for (const [userId, stash] of pvEmailStash) if (stash.expiresAt < now) pvEmailStash.delete(userId);
}

export async function handleBuyerInput(text:string,chatId:number,from:{ id:number;first_name:string;username?:string },messageId?:number):Promise<boolean> {
  sweepExpiredPixelverifStashes();
  if (await handlePixelverifInput(text, chatId, from, messageId)) return true;
  if (chatId !== from.id) return false;
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",String(from.id));
  const match = /^buyerinput:(\d+):(\d+):(\d+)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const variant = await getActiveVariant(Number(match[2]));
  try {
    if (!variant?.buyer_field_key || variant.pixelverif_input) throw new Error("stale");
    validateBuyerFields(variant,{ muse_invite_code:text.trim() },Number(match[3]));
  } catch { await sendMessage({ chat_id:chatId,text:"Kode tidak valid atau varian berubah. Kirim 6 huruf/angka ASCII, atau /batal." }); return true; }
  const claim = await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action);
  if (!claim.changes) return true;
  const result = await addToCart(String(from.id),Number(match[1]),Number(match[2]),Number(match[3]),1,{ muse_invite_code:text.trim() });
  if (!result.ok) { await sendMessage({ chat_id:chatId,text:"Tidak dapat menambah: maksimum 30 unit dan satu kode per checkout. Hapus baris lama untuk mengganti kode.",reply_markup:minimalMenuKeyboard() }); return true; }
  const { handleShowCart } = await import("./cart");
  await handleShowCart(chatId,0,from);
  return true;
}
