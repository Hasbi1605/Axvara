import { execRun,queryFirst } from "@/lib/db";
import { getActiveVariant } from "@/lib/catalog";
import { validateBuyerFields } from "@/lib/buyer-fields";
import { addToCart } from "@/lib/telegram/cart";
import { sendMessage } from "@/lib/telegram/api";
import { minimalMenuKeyboard } from "@/lib/telegram/keyboards";
import { setPendingActionUnlessCreating } from "./shared";

export async function requestBuyerInput(chatId:number,from:{ id:number },productId:number,variantId:number,qty:number):Promise<boolean> {
  const variant = await getActiveVariant(variantId);
  if (!variant?.buyer_field_key) return false;
  if (chatId !== from.id) return true;
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > (variant.max_qty ?? 100) || variant.product_id !== productId) {
    await sendMessage({ chat_id:chatId,text:"Jumlah tidak valid. Pilih 1–30 untuk Buff Muse.",reply_markup:minimalMenuKeyboard() }); return true;
  }
  if (!await setPendingActionUnlessCreating(String(from.id),chatId,`buyerinput:${productId}:${variantId}:${qty}`)) return true;
  await sendMessage({ chat_id:chatId,text:"Kirim Kode Invite Muse (6 huruf/angka, case-sensitive; 1–30 = 1–30B token). /batal untuk batal.",reply_markup:{ force_reply:true,input_field_placeholder:"6 huruf/angka" } });
  return true;
}

export async function handleBuyerInput(text:string,chatId:number,from:{ id:number;first_name:string;username?:string }):Promise<boolean> {
  if (chatId !== from.id) return false;
  const user = await queryFirst("SELECT pending_action FROM telegram_users WHERE user_id=?",String(from.id));
  const match = /^buyerinput:(\d+):(\d+):(\d+)$/.exec(String(user?.pending_action ?? ""));
  if (!match) return false;
  const variant = await getActiveVariant(Number(match[2]));
  try {
    if (!variant?.buyer_field_key) throw new Error("stale");
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
