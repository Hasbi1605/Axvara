import type { Locale } from "@/lib/i18n/locale";

const english: Record<string, string> = {
  "Produk tidak ditemukan atau sedang nonaktif.": "Product not found or inactive.",
  "Pilih varian dari halaman detail produk terlebih dahulu.": "Choose a variant on the product page first.",
  "Pilihan varian gagal dimuat.": "Could not load variants.",
  "Varian tidak cocok dengan produk. Pilih ulang dari halaman produk.": "This variant does not match the product. Choose again on the product page.",
  "Varian tidak tersedia. Pilih ulang dari halaman produk.": "Variant unavailable. Choose again on the product page.",
  "Gagal memuat produk.": "Could not load product.",
  "Gagal memuat harga": "Could not load prices",
  "No WA wajib diisi.": "WhatsApp number is required.",
  "No WA harus format 08… atau +62… (10–15 digit).": "Use a WhatsApp number in 08… or +62… format (10–15 digits).",
  "Tulis email aktif — detail pesanan & produk dikirim ke email ini.": "Enter an active email address for order and product details.",
  "Format email tidak valid.": "Invalid email address.",
  "Lengkapi data pembeli untuk melanjutkan.": "Complete your contact details to continue.",
  "Pilih metode pembayaran terlebih dahulu": "Choose a payment method first",
  "Tunggu harga selesai dimuat.": "Wait for prices to load.",
  "Harga atau stok belum tervalidasi. Muat ulang checkout dan konfirmasi perubahan.": "Price or stock has not been verified. Reload checkout and confirm changes.",
  "Centang persetujuan ketentuan third-party & garansi terlebih dahulu.": "Agree to the third-party and warranty terms first.",
  "Harga produk berubah. Periksa harga terbaru lalu lanjutkan.": "The price changed. Check the updated price before continuing.",
  "Koneksi terputus saat membuat pesanan. Tekan Bayar lagi — pesanan yang sama dilanjutkan, tidak dibuat dobel.": "Connection lost while creating the order. Press Pay again to resume the same order without creating a duplicate.",
  "Gagal buat pesanan": "Could not create order",
};

/** Only translate known local strings; unknown provider messages remain untouched. */
export function checkoutMessage(message: string, locale: Locale): string {
  if (locale !== "en") return message;
  const quoteStatus = message.match(/^Quote gagal \((\d{3})\)$/);
  const orderStatus = message.match(/^Gagal buat pesanan \((\d{3})\)$/);
  return quoteStatus ? `Could not load quote (${quoteStatus[1]})` : orderStatus ? `Could not create order (${orderStatus[1]})` : english[message] ?? message;
}
