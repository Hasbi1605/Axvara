// src/lib/telegram/messages.ts — BARREL pesan Telegram (Bahasa Indonesia + HTML).
//
// MENGAPA tetap ada sebagai barrel: banyak modul (route webhook,
// order-notifications, invoice-retry, cron, delivery) dan puluhan test
// mengimpor dari path "@/lib/telegram/messages". File ini WAJIB tetap
// mengekspor SEMUA fungsi pesan agar path impor lama tidak berubah.
//
// Implementasi sebenarnya kini dipecah per-tanggung-jawab di folder
// messages/ agar tiap file kecil dan mudah ditinjau — tanpa mengubah
// satu karakter pun dari teks pesan yang dikirim ke pengguna:
//   format.ts    — helper escape/format/waktu/breadcrumb bersama
//   catalog.ts   — welcome, katalog, kategori, detail, cari, daftar order
//   purchase.ts  — konfirmasi, jumlah, keranjang, invoice, pengingat
//   status.ts    — lunas, kirim, kedaluwarsa/batal, status, error, stok
//   group.ts     — keamanan grup (deep-link + redirect + notice)
//   help.ts      — bantuan + ketentuan/klaim garansi
//   admin.ts     — notifikasi grup admin (Web/Telegram/WhatsApp)
//
// Patterns adopted from top Telegram shop bots:
// - Visual hierarchy with separators (━━━)
// - Consistent emoji language (not spam)
// - Monospace <code> for copyable data (order codes, secrets)
// - Progress indicators for multi-step flows
// - Short, scannable lines — mobile-first (95% users)

export { escapeHtml, formatWIBTime, formatSoldCountLabel, breadcrumbLine } from "./messages/format";

export {
  welcomeMessage, catalogFlatMessage, categoriesMessage, categoryProductsMessage,
  productDetailMessage, myOrdersPrompt, myOrdersMessage, searchPromptMessage,
  searchResultsMessage,
  type TelegramBestseller, type TelegramVariantLine, type TelegramOrderRow,
} from "./messages/catalog";

export {
  confirmVariantBuyMessage, chooseVariantMessage, confirmBuyMessage, chooseQtyMessage,
  cartMessage, cartAddedMessage, cartCheckoutSummaryMessage, orderReminderMessage,
  invoiceMessage, type TelegramCartLine,
} from "./messages/purchase";

export {
  orderPaidMessage, deliveryMessage, whatsAppInputPromptMessage, orderExpiredMessage,
  orderCancelledMessage, orderStatusMessage, qrisRenewRejectedMessage, outOfStockMessage,
  alreadyPendingMessage, errorMessage, waSavedAfterPaymentMessage, invalidWhatsAppMessage,
} from "./messages/status";

export {
  privateChatDeepLink, groupCheckoutRedirectMessage, groupDeliveryNoticeMessage,
} from "./messages/group";

export {
  helpMessage, warrantyTermsMessage, warrantyClaimMessage, warrantyFullMessage,
} from "./messages/help";

export {
  adminTelegramOrderCreatedMessage, adminTelegramOrderPaidMessage,
  adminDeliveryFailedNotification, adminWebOrderNotification,
  adminWhatsAppOrderCreatedMessage, adminWhatsAppOrderPaidMessage,
} from "./messages/admin";
