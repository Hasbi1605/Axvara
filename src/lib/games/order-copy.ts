// src/lib/games/order-copy.ts — teks halaman pesanan + lacak AXVARA Games
// (hierarki mengikuti halaman pesanan/lacak Pedia).
import type { Locale } from "@/lib/i18n/locale";

const copy = {
  id: {
    payTitle: "Selesaikan pembayaran", payGateway: "Bayar via {label}", payCrypto: "Bayar dengan crypto",
    titles: { awaiting_payment: "Selesaikan pembayaran", processing: "Top up sedang diproses", success: "Top up berhasil", needs_admin: "Perlu pengecekan admin", expired: "Pesanan kedaluwarsa" },
    pills: { awaiting_payment: "Menunggu pembayaran", processing: "Diproses otomatis", success: "Berhasil", needs_admin: "Dicek admin", expired: "Kedaluwarsa" },
    leads: {
      processing: "Pembayaran diterima. Top up dikirim otomatis ke akunmu, biasanya dalam beberapa menit.",
      success: "Top up sudah masuk ke akun game kamu. Simpan nomor seri di bawah sebagai bukti.",
      needs_admin: "Pembayaranmu aman. Top up perlu dicek admin sebelum dilanjutkan; tim kami akan menghubungimu.",
      expired: "Waktu pembayaran habis dan pesanan ditutup. Buat pesanan baru bila masih ingin top up.",
    },
    paidAt: "Dibayar {time} WIB", copyCode: "Salin kode pesanan", scan: "Scan dengan aplikasi e-wallet atau m-banking",
    qrisAlt: "Kode QRIS pembayaran", qrisLoading: "Memuat QRIS…", qrisFailed: "QRIS gagal dimuat", qrisRetry: "Muat ulang QRIS",
    nationalStandard: "Standar QR nasional", waitingPay: "Menunggu pembayaran", totalPay: "Total bayar", uniqueCode: "Kode unik",
    validFor: "Berlaku", timeLeftAria: "Sisa waktu pembayaran", payExactly: "Bayar tepat sesuai nominal agar terdeteksi otomatis.",
    saveQris: "Simpan QRIS", checkPayment: "Cek Pembayaran", checking: "Mengecek…", autoCheck: "Status dicek otomatis setiap beberapa detik",
    qrisExpiredTitle: "QRIS sudah tidak aktif", qrisExpiredNote: "Batas waktu pembayaran habis. Buat pesanan baru untuk mendapatkan QRIS baru.",
    summary: "Ringkasan pesanan", summaryMeta: "Game, ID akun, nominal", game: "Game", accountId: "ID akun", amount: "Nominal", method: "Metode", total: "Total",
    progress: "Progres pesanan", timelineAria: "Tahapan pesanan",
    steps: ["Pesanan dibuat", "Pembayaran diterima", "Top up diproses otomatis", "Top up berhasil"],
    stepCodeHint: "Simpan kode pesanan untuk melacak status.", stepAutoDetect: "Pembayaran terdeteksi otomatis setelah kamu bayar.",
    stepProcessing: "Dikirim ke penyedia game, tunggu sebentar.", stepNeedsAdmin: "Ditahan untuk dicek admin.",
    updated: "Diperbarui {time} · cek otomatis tiap {seconds} dtk", refresh: "Perbarui status",
    sn: "Nomor seri / bukti top up", copy: "Salin", copied: "Tersalin",
    needsAdminTitle: "Kami sedang mengecek pesananmu", adminWhatsApp: "Hubungi admin via WhatsApp", supportMessage: "Halo AXVARA, saya butuh bantuan pesanan Games",
    track: "Lacak pesanan", continueShopping: "Lanjut top up", orderAgain: "Pesan lagi", needHelp: "Butuh bantuan?",
    footer: "Dengan memesan kamu menyetujui {link} AXVARA Games.", footerLink: "ketentuan",
    error: "Gagal memuat: {error}", noSelection: "Belum dipilih",
    // Lacak
    trackKicker: "AXVARA Games", trackTitle: "Lacak pesanan Games", trackIntro: "Masukkan kode pesanan AXG dan WhatsApp atau email yang kamu pakai saat checkout.",
    trackFormAria: "Form lacak pesanan Games", trackFormTitle: "Cari pesanan", trackFormSub: "Kode AXG + kontak checkout",
    trackCode: "Kode pesanan AXG", trackCodeHint: "Contoh: AXG-20261116-4206447D", trackCodeBad: "Format kode pesanan tidak valid.",
    trackContact: "WhatsApp atau email", trackContactPlaceholder: "08xxxx atau nama@email.com", trackContactHint: "Sesuai yang diisi saat checkout.", trackContactBad: "Masukkan WhatsApp atau email yang valid.",
    trackSubmit: "Lacak pesanan", trackLoading: "Mencari pesanan…", trackSlow: "Masih mencari, mohon tunggu…", trackNotFound: "Pesanan tidak ditemukan atau kontak tidak cocok.", trackConnection: "Koneksi bermasalah. Coba lagi.",
    recentTitle: "Terakhir dilacak", recentAria: "Pesanan yang terakhir dilacak", fillContact: "Isi kontak untuk membuka", deleteRecent: "Hapus {code} dari riwayat",
    savedTitle: "Pesanan di perangkat ini", savedNote: "Pesanan Games yang dibuat atau dibuka di browser ini.", savedOpen: "Buka pesanan", savedHide: "Sembunyikan {code}",
    faqAria: "Pertanyaan umum pelacakan",
    faq: [
      ["Di mana saya menemukan kode pesanan?", "Kode AXG tampil setelah checkout dan di halaman pembayaran. Jika memesan di browser ini, buka daftar Pesanan di perangkat ini di atas."],
      ["Sudah bayar, tetapi status masih menunggu pembayaran?", "Buka halaman pesanan lalu tekan Cek Pembayaran. Pastikan nominal yang dibayar sesuai tagihan. Jika belum berubah, hubungi WA Admin dengan kode pesanan dan bukti bayar."],
      ["Berapa lama top up masuk?", "Top up dikirim otomatis setelah pembayaran terverifikasi, biasanya beberapa menit. Nomor seri tampil di halaman pesanan dan dikirim ke email."],
      ["Top up belum masuk padahal status berhasil?", "Periksa kembali ID akun dan server di ringkasan pesanan, lalu hubungi WA Admin dengan kode pesanan dan nomor seri."],
    ] as [string, string][],
  },
  en: {
    payTitle: "Complete payment", payGateway: "Pay via {label}", payCrypto: "Pay with crypto",
    titles: { awaiting_payment: "Complete payment", processing: "Top up in progress", success: "Top up successful", needs_admin: "Admin check needed", expired: "Order expired" },
    pills: { awaiting_payment: "Awaiting payment", processing: "Processing automatically", success: "Successful", needs_admin: "Under admin review", expired: "Expired" },
    leads: {
      processing: "Payment received. Your top up is sent automatically, usually within a few minutes.",
      success: "The top up has reached your game account. Keep the serial number below as proof.",
      needs_admin: "Your payment is safe. The top up needs an admin check before it continues; our team will contact you.",
      expired: "The payment window closed. Create a new order if you still want to top up.",
    },
    paidAt: "Paid {time} WIB", copyCode: "Copy order code", scan: "Scan with any e-wallet or banking app",
    qrisAlt: "Payment QRIS code", qrisLoading: "Loading QRIS…", qrisFailed: "QRIS failed to load", qrisRetry: "Reload QRIS",
    nationalStandard: "National QR standard", waitingPay: "Awaiting payment", totalPay: "Total to pay", uniqueCode: "Unique code",
    validFor: "Valid for", timeLeftAria: "Payment time left", payExactly: "Pay the exact amount so it is detected automatically.",
    saveQris: "Save QRIS", checkPayment: "Check Payment", checking: "Checking…", autoCheck: "Status is checked automatically every few seconds",
    qrisExpiredTitle: "QRIS is no longer active", qrisExpiredNote: "The payment window has closed. Create a new order to get a new QRIS.",
    summary: "Order summary", summaryMeta: "Game, account ID, amount", game: "Game", accountId: "Account ID", amount: "Amount", method: "Method", total: "Total",
    progress: "Order progress", timelineAria: "Order steps",
    steps: ["Order created", "Payment received", "Top up processing", "Top up successful"],
    stepCodeHint: "Keep the order code to track the status.", stepAutoDetect: "Payment is detected automatically once you pay.",
    stepProcessing: "Sent to the game provider, please wait.", stepNeedsAdmin: "On hold for an admin check.",
    updated: "Updated {time} · auto check every {seconds}s", refresh: "Refresh status",
    sn: "Serial number / top up proof", copy: "Copy", copied: "Copied",
    needsAdminTitle: "We are checking your order", adminWhatsApp: "Contact admin on WhatsApp", supportMessage: "Hi AXVARA, I need help with a Games order",
    track: "Track order", continueShopping: "Keep topping up", orderAgain: "Order again", needHelp: "Need help?",
    footer: "By ordering you agree to the AXVARA Games {link}.", footerLink: "terms",
    error: "Failed to load: {error}", noSelection: "Not selected",
    trackKicker: "AXVARA Games", trackTitle: "Track Games order", trackIntro: "Enter your AXG order code and the WhatsApp number or email used at checkout.",
    trackFormAria: "Games order tracking form", trackFormTitle: "Find order", trackFormSub: "AXG code + checkout contact",
    trackCode: "AXG order code", trackCodeHint: "Example: AXG-20261116-4206447D", trackCodeBad: "Invalid order code format.",
    trackContact: "WhatsApp or email", trackContactPlaceholder: "08xxxx or name@email.com", trackContactHint: "As entered at checkout.", trackContactBad: "Enter a valid WhatsApp number or email.",
    trackSubmit: "Track order", trackLoading: "Finding order…", trackSlow: "Still searching, please wait…", trackNotFound: "Order not found or contact does not match.", trackConnection: "Connection problem. Try again.",
    recentTitle: "Recently tracked", recentAria: "Recently tracked orders", fillContact: "Enter contact to open", deleteRecent: "Remove {code} from history",
    savedTitle: "Orders on this device", savedNote: "Games orders created or opened in this browser.", savedOpen: "Open order", savedHide: "Hide {code}",
    faqAria: "Tracking FAQ",
    faq: [
      ["Where do I find the order code?", "The AXG code is shown after checkout and on the payment page. If you ordered in this browser, open Orders on this device above."],
      ["I paid but it still says awaiting payment.", "Open the order page and press Check Payment. Make sure the amount matches the invoice. If it does not change, contact WA Admin with the order code and payment proof."],
      ["How long does a top up take?", "Top ups are sent automatically after payment is verified, usually within minutes. The serial number appears on the order page and is emailed to you."],
      ["Status is successful but the top up has not arrived?", "Double-check the account ID and server in the order summary, then contact WA Admin with the order code and serial number."],
    ] as [string, string][],
  },
};

export type GamesOrderCopy = (typeof copy)["id"];
export function gamesOrderCopy(locale: Locale): GamesOrderCopy { return copy[locale]; }

export const gamesManualRefundCopy = {
  id: { title: "Top up gagal", text: "Pembayaranmu akan dikembalikan oleh admin. Hubungi admin via WhatsApp dan sertakan kode pesanan untuk bantuan refund.", pill: "Refund oleh admin" },
  en: { title: "Top up failed", text: "An admin will refund your payment. Contact support on WhatsApp with your order code for help with the refund.", pill: "Manual refund" },
} as const;
export const fillGames = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));

/** Riwayat lokal Games (pola Pedia `axp-orders`/`axp-track-recent`). */
export const GAMES_DEVICE_KEY = "axg-orders";
export const GAMES_RECENT_KEY = "axg-track-recent";
export const GAMES_CODE_RE = /^AXG-\d{8}-[A-Z0-9]{8}$/;

/** Catat pesanan Games di perangkat ini (terbaru di atas, maksimal 20). */
export function rememberGamesDeviceOrder(code: string, name: string) {
  if (!GAMES_CODE_RE.test(code)) return;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(GAMES_DEVICE_KEY) || "[]");
    const list = Array.isArray(raw) ? raw.filter((entry) => entry && typeof entry === "object" && (entry as { code?: unknown }).code !== code) : [];
    localStorage.setItem(GAMES_DEVICE_KEY, JSON.stringify([{ code, name: name.slice(0, 160) }, ...list].slice(0, 20)));
  } catch { /* Riwayat bersifat opsional. */ }
}
