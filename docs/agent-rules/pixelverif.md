# Aturan agent — Pixel Verification (Google AI Pro 3 bulan)

## Blacklist Gmail, antrean pembeli, teks ganti password — 23 November 2026 (lokal, belum dideploy)

- Blacklist: kode `ACTIVATION_ITEM_NOT_AVAILABLE` (poll `failed` atau Full `activation_status=item_not_available`) mencatat SHA-256 Gmail ternormalisasi (huruf kecil, tanpa titik/`+tag` di local part) ke `pixelverif_blocked_emails` (migrasi `0156`, PK `email_hash`+`validity`) sebelum input dihapus. README: Gmail tidak boleh dikirim ulang untuk penawaran yang sama, validity lain boleh — jadi blok per validity, berlaku untuk Normal dan Full. Ditolak di quote web (issue `pixelverif_blocked`), validasi order web, langkah email Telegram dan ringkasan keranjang Telegram. Baca gagal = fail-open (supplier tetap refund). Tidak ada UI admin untuk membuka blok; hapus baris hanya atas instruksi owner.
- Antrean pembeli: `readAutomaticProgress` menyertakan link Pixel (`kind:"pixelverif"`): belum ada order supplier → `preparing`, provider `pending` → `queued` + `queue_position` (null ditampilkan tanpa angka), `processing` → `running`, `completed` → `ready`, `needs_admin` → `needs_check`. Footer estimasi Pixel 1–5 menit, hubungi admin setelah 15 menit. Posisi diperbarui tiap tick cron (README: cache supplier ±60 dtk).
- Teks "segera ganti password & reset 2FA" dihapus dari checkout web, intro Telegram, deskripsi produk dan langkah aktivasi atas instruksi owner. Jangan tambahkan lagi sampai owner bilang "tambahkan teks helper ganti pw". Produk yang sudah dipublikasikan ke D1 menyimpan salinan deskripsi lama sampai copy dipublikasikan ulang.

## Kontrak supplier — 23 November 2026 (lokal, belum dideploy)

- Sumber kontrak: README GitHub `Likhonbd/Pixel-Xiaomi-Oppo-Oneplus-Device-Verificaton-API` (base `https://api.pixelverification.me`). Bila README berubah, bandingkan dulu dengan `src/lib/pixelverif/client.ts` + `orders.ts` dan test `tests/pixelverif-*`; jangan membaca/mengubah env produksi hanya untuk menyelaraskan dokumentasi.
- Auth: header `X-API-Key` (`pvsk_...`) hanya server-side dari env `PIXELVERIF_API_KEY`; `GET /api/pricing` dan `/api/health` publik tanpa key. Jangan log key, body POST, password, kunci 2FA atau `user_message` supplier.
- Produk dijual: `normal`/`full` validity `3` saja (12 bulan NOT AVAILABLE). Harga modal diambil live dari `/api/pricing`; preflight harga + `/api/credits` berjalan sebelum SETIAP POST.
- `X-Idempotency-Key` = UUID per link; pakai key yang SAMA untuk POST ulang setelah timeout/5xx/429 (supplier membalas 200 dengan order yang sama tanpa biaya ganda). Key BARU hanya untuk retry setelah order supplier `failed` dengan `OTHER_ERROR`.
- Pemulihan POST ambigu: `GET /api/order-by-email` (jendela 10 menit) sebelum POST ulang; ikat hanya order yang dibuat setelah kirim ini, flow/validity/email sama, belum dimiliki link lain, dan bukan order gagal yang sudah ditinggalkan (`provider_order_code`).
- Polling: kode gagal di `order.error.code`. Kode non-retryable (`WRONG_PASSWORD`, `WRONG_2FA_CODE`, `WRONG_EMAIL`, `2FA_WARNING`, `PAYMENT_WARNING`, `CAPTCHA_DETECTED`, `ACTIVATION_ITEM_NOT_AVAILABLE`) → `needs_admin`, input dihapus, pembeli menerima petunjuk tetap dari `pixelverifBuyerErrorMessage`. `ACTIVATION_ITEM_NOT_AVAILABLE` = Gmail diblacklist untuk penawaran itu; jangan kirim ulang Gmail yang sama untuk produk yang sama.
- Full: `activation_status` `item_not_available`/`failed`/`invalid`/`error` adalah kegagalan (supplier refund) — jangan kirim link ke pembeli.
- Timeout klien Normal 10 menit / Full 15 menit → `poll_timeout`; Retry admin pada status ini hanya re-poll, tidak pernah POST.
- 401/402/403 pada kirim pertama: tidak ada order supplier; link tetap bisa di-retry admin setelah key/kredit diperbaiki. Rate limit POST default 20/menit/key; 429 menghormati `retry_after_seconds`/`Retry-After`.
- Status: implementasi lokal + fixture test; bukan bukti order nyata, saldo supplier, atau deployment.
