// src/lib/telegram/handlers/callback.ts — Router callback + GUARD KEAMANAN.
//
// MENGAPA dipisah: handleCallback adalah SATU-SATUNYA pintu masuk callback
// button. Ia memuat kontrol keamanan `ownerBound` (issue #5): sebelum handler
// sensitif apa pun dipanggil (bayar, keranjang, batal, refresh, status,
// wainput, qrenew), guard WAJIB memverifikasi bahwa penekan tombol (from.id)
// adalah pemilik order dan bukan dari chat grup. Karena guard ini berjalan di
// dalam switch SEBELUM setiap case, memindahkan router utuh (bukan memecah per
// case) menjaga jaminan bahwa TIDAK ADA handler yang bisa dicapai tanpa melewati
// guard. Pemindahan murni dari route.ts — set ownerBound, SQL, teks identik.

import { queryFirst } from "@/lib/db";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";
import {
  homeKeyboard, warrantyKeyboard, orderStatusKeyboard, parseCallback,
} from "@/lib/telegram/keyboards";
import {
  welcomeMessage, helpMessage, warrantyFullMessage, alreadyPendingMessage,
} from "@/lib/telegram/messages";
import { getCartSummary, clearCart } from "@/lib/telegram/cart";
import { clearPendingAction, getBestsellers } from "./shared";
import {
  handleShowCatalogEdit, handleShowCategoriesEdit, handleShowProducts,
  handleShowProduct, handleShowVariants, handleVariantConfirm, handleShowQty,
} from "./catalog";
import {
  handleMyOrders, handleSearchPrompt, handleBuyConfirm, handleConfirmPurchase,
  handleWaInput,
} from "./discovery";
import {
  handleOrderStatus, handleOrderRefresh, handleOrderCancel, handleQrisRenew,
} from "./orders";
import { handlePayWithQris } from "./invoice";
import {
  handleShowCart, handleCartAdd, handleCartAdjust, handleCartCheckout,
  createAndSendCartInvoice,
} from "./cart";

export async function handleCallback(data: string, chatId: number, messageId: number, from: { id: number; first_name: string; username?: string }) {
  const { action, params } = parseCallback(data);

  // Ownership guard (issue #5): callback sensitif order (bayar, keranjang,
  // batal, refresh, status, wainput) hanya boleh dieksekusi pemilik order.
  // from.id adalah identitas penekan tombol terverifikasi Telegram — chat_id
  // grup tidak boleh dipakai untuk mengambil alih order orang lain.
  const ownerBound = new Set(["pay", "pm", "cadd", "cinc", "cdec", "crm", "ccheckout", "cancel", "refresh", "order", "wainput", "qrenew"]);
  if (ownerBound.has(action)) {
    const targetCode = action === "cancel" || action === "refresh" || action === "order" || action === "wainput" || action === "qrenew"
      ? String(params[0] || "").toUpperCase()
      : null;
    if (targetCode) {
      const owned = await queryFirst(
        `SELECT code FROM orders WHERE code=? AND telegram_user_id=? AND sales_channel='telegram'`,
        targetCode, String(from.id),
      );
      if (!owned) {
        await sendMessage({ chat_id: chatId, text: "❌ Pesanan ini bukan milikmu. Buka chat pribadi bot dan buat pesanan sendiri.", parse_mode: "HTML" });
        return;
      }
    }
    // verifyPrivateChat: callback dari grup untuk aksi sensitif ditolak
    // (grup sudah di-redirect di POST; ini lapis kedua bila pesan lama
    // diteruskan). Chat pribadi selalu lolos (chatId positif = from.id).
    if (Number(chatId) < 0) {
      const { SITE } = await import("@/lib/site");
      const { groupCheckoutRedirectMessage } = await import("@/lib/telegram/messages");
      await sendMessage({ chat_id: chatId, text: groupCheckoutRedirectMessage(SITE.adminTelegram), parse_mode: "HTML" });
      return;
    }
  }

  switch (action) {
    case "home":
      await clearPendingAction(from);
      await safeEditOrSend({
        chat_id: chatId, message_id: messageId,
        text: welcomeMessage(from.first_name, await getBestsellers(3)),
        parse_mode: "HTML",
        reply_markup: homeKeyboard(),
      });
      break;

    case "catalog":
      await clearPendingAction(from);
      await handleShowCatalogEdit(chatId, messageId, Number(params[0] || 0));
      break;

    case "cats":
      await handleShowCategoriesEdit(chatId, messageId, Number(params[0] || 0));
      break;

    case "cat":
      await handleShowProducts(chatId, messageId, Number(params[0]), Number(params[1] || 0));
      break;

    case "prd":
      await handleShowProduct(chatId, messageId, Number(params[0]));
      break;

    case "buy":
      // Always use variant flow — stock synced with web/WA via product_variants
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "vars":
      await handleShowVariants(chatId, messageId, Number(params[0]));
      break;

    case "var":
      await handleVariantConfirm(chatId, messageId, Number(params[0]));
      break;

    case "qty":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "q":
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]));
      break;

    case "pay":
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "pm":
      // Compatibility for buttons from older messages: Telegram now always uses QRIS.
      await handlePayWithQris(chatId, messageId, Number(params[0]), Number(params[1]), Number(params[2]), from);
      break;

    case "wainput":
      await handleWaInput(chatId, String(params[0] || ""), from);
      break;

    case "cfv":
      // Legacy "Saya Paham, Lanjut Bayar" buttons route into the qty step now.
      await handleShowQty(chatId, messageId, Number(params[0]), Number(params[1]));
      break;

    case "confirm":
      await handleConfirmPurchase(chatId, messageId, Number(params[0]));
      break;

    case "order":
      await handleOrderStatus(chatId, params[0]);
      break;

    case "refresh":
      await handleOrderRefresh(chatId, messageId, params[0]);
      break;

    case "cancel":
      await handleOrderCancel(chatId, messageId, params[0], from);
      break;

    case "qrenew":
      await handleQrisRenew(chatId, params[0]);
      break;

    case "myorders":
      await handleMyOrders(chatId, from);
      break;

    case "search":
      await handleSearchPrompt(chatId, from);
      break;

    case "reorder": {
      const productId = Number(params[0] || 0);
      if (productId > 0) {
        await handleBuyConfirm(chatId, messageId, productId);
      }
      break;
    }

    case "cart":
      await handleShowCart(chatId, messageId, from);
      break;

    case "cadd":
      await handleCartAdd(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), Number(params[2] || 1), from);
      break;

    case "cinc":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), +1);
      break;

    case "cdec":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), -1);
      break;

    case "crm":
      await handleCartAdjust(chatId, messageId, from, Number(params[0] || 0), 0);
      break;

    case "cclear":
      await clearCart(String(from.id));
      await handleShowCart(chatId, messageId, from);
      break;

    case "ccheckout":
      await handleCartCheckout(chatId, messageId, from);
      break;

    case "cconfirm": {
      const cartSummary = await getCartSummary(String(from.id));
      if (cartSummary.lines.length === 0) {
        await handleShowCart(chatId, messageId, from);
        break;
      }
      // Email wajib keranjang (migrasi 0033): bila ada baris Invite/Link WR
      // atau produk require_email dan email tersimpan belum ada → minta
      // dulu via alur email_for:, JANGAN terbitkan invoice.
      try {
        const { needsEmailForVariant } = await import("@/lib/warung-rebahan/delivery-class");
        const { queryAll } = await import("@/lib/db");
        const vIds = [...new Set(cartSummary.lines.map((l) => Number(l.variantId || 0)).filter((v) => v > 0))];
        let cartNeedsEmail = false;
        if (vIds.length > 0) {
          const rows = await queryAll(
            `SELECT pv.id, wv.wr_type AS wr_type, p.require_email AS require_email
             FROM product_variants pv
             LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
             LEFT JOIN products p ON p.id = pv.product_id
             WHERE pv.id IN (${vIds.map(() => "?").join(",")})`,
            ...vIds,
          ).catch(() => [] as Record<string, unknown>[]);
          for (const r of rows) {
            if (needsEmailForVariant({
              wrType: r.wr_type != null ? String(r.wr_type) : null,
              requireEmail: Number(r.require_email ?? 0),
            })) { cartNeedsEmail = true; break; }
          }
        }
        if (cartNeedsEmail) {
          const { queryFirst } = await import("@/lib/db");
          const emailRow = await queryFirst(
            `SELECT buyer_email FROM telegram_users WHERE user_id=?`,
            String(from.id),
          ).catch(() => null) as { buyer_email?: unknown } | null;
          const savedCartEmail = String(emailRow?.buyer_email || "").trim();
          if (!savedCartEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(savedCartEmail)) {
            const first = cartSummary.lines[0];
            const { execRun } = await import("@/lib/db");
            const { isD1Mode } = await import("@/lib/db");
            if (isD1Mode()) {
              await execRun(
                `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=?`,
                `emailcart:${cartSummary.lines.length}`,
                String(from.id),
              ).catch(() => {});
            }
            const { EMAIL_REQUIRED_MESSAGE } = await import("@/lib/warung-rebahan/delivery-class");
            await sendMessage({
              chat_id: chatId,
              text: [
                "📧 <b>Email dibutuhkan</b>",
                "",
                EMAIL_REQUIRED_MESSAGE,
                "",
                "Balas dengan email aktif kamu (contoh: <code>nama@email.com</code>).",
                "Ketik /batal untuk membatalkan.",
              ].join("\n"),
              parse_mode: "HTML",
            });
            break;
          }
        }
      } catch {
        /* guard best-effort — gagal cek = lanjut seperti biasa */
      }
      const dupOrder = await queryFirst(
        `SELECT code FROM orders WHERE telegram_chat_id=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
        String(chatId),
      );
      if (dupOrder) {
        // RR3-05: redelivery setelah foto invoice gagal (update failed +
        // 500) tiba di sini via reclaim — order pending dipakai ulang
        // (TIDAK membuat order kedua). Bila foto invoice order ini belum
        // terkirim, kirim ulang foto yang SAMA sekarang (provider mungkin
        // sudah pulih); cron menyapu sisanya bila masih gagal.
        try {
          const { retryTelegramInvoiceDelivery } = await import("@/lib/telegram/invoice-retry");
          await retryTelegramInvoiceDelivery(String(dupOrder.code)).catch(() => false);
        } catch { /* sapuan cron berikutnya */ }
        await sendMessage({
          chat_id: chatId,
          text: alreadyPendingMessage(String(dupOrder.code)),
          parse_mode: "HTML",
          reply_markup: orderStatusKeyboard(String(dupOrder.code)),
        });
        break;
      }
      await createAndSendCartInvoice(chatId, cartSummary.lines, from);
      break;
    }

    case "warranty":
      await sendMessage({
        chat_id: chatId,
        text: warrantyFullMessage(),
        parse_mode: "HTML",
        reply_markup: warrantyKeyboard(),
      });
      break;

    case "help":
      await sendMessage({ chat_id: chatId, text: helpMessage(), parse_mode: "HTML" });
      break;

    default:
      break;
  }
}
