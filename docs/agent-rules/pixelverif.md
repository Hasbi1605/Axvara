# Aturan agent — Pixel Verification (Google AI Pro 3 bulan)

## Env produksi — 23 November 2026

- Atas permintaan owner, empat env Pages `secret_text` dipasang: `PIXELVERIF_API_KEY`, `PIXELVERIF_API_BASE_URL` (bawaan `https://api.pixelverification.me`), `PIXELVERIF_ENABLED=true`, `PIXELVERIF_SYNC_ENABLED=true`. Sumber lokal `.pixelverification-credentials` (mode 600, git-ignored); backup di `.pages-env-backup` `[production]`. Jangan cetak/commit nilainya. Uji baca-saja saat pasang: saldo 5 kredit, harga normal 1 / full 1,5. Produk dan varian tetap nonaktif sampai admin sinkron katalog dan mengaktifkan; ini bukan bukti order nyata.

## Copy whitelabel + kebijakan refund — 23 November 2026 (lokal, belum dideploy)

- Keputusan owner: semua teks pembeli 100% whitelabel — jangan sebut nama mitra (Pixel Verification, Tanvir, `pvsk_`), kata "supplier"/"pemasok"/"mitra"; proses disebut "bot otomatis". Nama internal (kode, admin, env) tetap `pixelverif`. Dijaga `tests/pixelverif-copy.test.ts`.
- Kebijakan refund (owner): pesanan gagal diproses = dana dikembalikan penuh, termasuk gagal karena password/2FA/syarat akun; coba lagi = pesanan baru setelah refund; Gmail tidak memenuhi syarat tidak bisa dipesan ulang. Refund dikerjakan admin manual (belum otomatis). Dasar: FAQ README supplier mengembalikan kredit order gagal 100% ke saldo key AXVARA.
- Sumber copy tunggal `src/lib/pixelverif/copy.ts` (ID+EN: deskripsi, `name_en`, S&K + cara aktivasi per varian, pesan error pembeli). Publikasi pertama menulisnya (`INSERT OR IGNORE`; `name_en` hanya bila kosong). Baris D1 existing diperbarui migrasi data `0157_pixelverif_whitelabel_copy.sql` yang dibangkitkan dari copy.ts: ID hanya menimpa kosong/template bawaan lama (awalan tetap), EN hanya bila kosong — edit admin tidak ditimpa. Bila copy.ts diubah lagi untuk baris yang sudah ada, buat migrasi data baru (jangan edit 0157).

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
