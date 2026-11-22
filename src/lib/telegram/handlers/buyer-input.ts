import { execRun,queryFirst } from "@/lib/db";
import { getActiveVariant } from "@/lib/catalog";
import { parsePixelverifInput, validateBuyerFields } from "@/lib/buyer-fields";
import { addToCart } from "@/lib/telegram/cart";
import { deleteMessage, sendMessage } from "@/lib/telegram/api";
import { minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import { setPendingActionUnlessCreating } from "./shared";

const PV_INTRO =
  "🔐 <b>Data akun Google untuk aktivasi</b>\n\n" +
  "Kirim <b>email Gmail</b> yang akan diaktivasi (contoh: nama@gmail.com).\n" +
  "Pesan berisi password/kunci 2FA akan <b>otomatis dihapus</b> setelah dibaca. " +
  "Data tersimpan terenkripsi, dipakai sekali untuk aktivasi, lalu dihapus.\n" +
  "Setelah aktivasi selesai, <b>segera ganti password & reset 2FA</b> Anda.\n\n" +
  "/batal untuk batal.";

export async function requestBuyerInput(chatId:number,from:{ id:number },productId:number,variantId:number,qty:number):Promise<boolean> {
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
    const stored = await execRun("UPDATE telegram_users SET buyer_email=?, pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",value.toLowerCase(),`pvinput:${productId}:${variantId}:password`,String(from.id),user!.pending_action);
    if (!stored.changes) return true;
    await sendMessage({ chat_id:chatId,text:"Sekarang kirim <b>password Gmail</b> tersebut. Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Password Gmail" } });
    return true;
  }

  if (step === "password") {
    if (!value || value.length > 200) {
      await sendMessage({ chat_id:chatId,text:"Password tidak valid. Kirim ulang password Gmail, atau /batal." });
      return true;
    }
    // No durable plaintext staging exists for secrets: the password is held
    // only in this invocation. Move straight to the TOTP step by asking the
    // buyer to send both in the next message? No — instead we re-ask using a
    // combined final step: keep password in pending_action is forbidden, so
    // ask TOTP now and combine via a second read of this message is impossible.
    // Therefore: store step marker and request TOTP; password must be resent
    // together with TOTP confirmation. Simpler and safe: ask for TOTP next,
    // and stash the password ONLY in memory of this request is lost — so we
    // instead advance and, at the totp step, require the buyer to confirm by
    // re-sending password+TOTP is poor UX. Chosen approach: pending_action
    // carries an opaque step only; secrets are never written to DB.
    // We keep the password in a module-level WeakRef-free map keyed by user
    // with a 10-minute TTL (single isolate, best-effort).
    pvSecretStash.set(String(from.id), { password: value, variantId, expiresAt: Date.now() + 10 * 60_000 });
    if (messageId) await deleteMessage(chatId, messageId).catch(() => {});
    const stored = await execRun("UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?",`pvinput:${productId}:${variantId}:totp`,String(from.id),user!.pending_action);
    if (!stored.changes) return true;
    await sendMessage({ chat_id:chatId,text:"Terakhir, kirim <b>kunci setup 2FA</b> (TOTP secret dari aplikasi authenticator, bukan kode 6 digit). Pesan Anda akan dihapus setelah dibaca.",parse_mode:"HTML",reply_markup:{ force_reply:true,input_field_placeholder:"Kunci setup 2FA" } });
    return true;
  }

  // step === "totp"
  const stash = pvSecretStash.get(String(from.id));
  pvSecretStash.delete(String(from.id));
  if (messageId) await deleteMessage(chatId, messageId).catch(() => {});
  if (!stash || stash.variantId !== variantId || stash.expiresAt < Date.now()) {
    await execRun("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=?",String(from.id),user!.pending_action).catch(() => {});
    await sendMessage({ chat_id:chatId,text:"Sesi input kedaluwarsa. Silakan ulangi dari katalog.",reply_markup:minimalMenuKeyboard() });
    return true;
  }
  const buyer = await queryFirst("SELECT buyer_email FROM telegram_users WHERE user_id=?",String(from.id));
  let fields;
  try {
    fields = parsePixelverifInput({ pv_email: String(buyer?.buyer_email ?? ""), pv_password: stash.password, pv_totp_secret: value });
  } catch (error) {
    await sendMessage({ chat_id:chatId,text:`${(error as Error).message} Kirim ulang kunci setup 2FA, atau /batal.` });
    // Restore stash so the buyer can retry the TOTP step only.
    pvSecretStash.set(String(from.id), stash);
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

// Password lives in memory only (never DB/logs), max 10 minutes, one variant.
const pvSecretStash = new Map<string, { password: string; variantId: number; expiresAt: number }>();

export async function handleBuyerInput(text:string,chatId:number,from:{ id:number;first_name:string;username?:string },messageId?:number):Promise<boolean> {
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
