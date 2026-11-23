-- 0162_pixelverif_activation_copy.sql — bersihkan ekor S&K umum tersembunyi pada deskripsi
-- Google AI Pro 3 Bulan & perbarui Cara Aktivasi ID/EN (6 langkah persiapan akun + catatan tutorial).
--
-- Permintaan owner 23 Nov 2026:
-- - Deskripsi produk, proses & pengiriman, serta aturan pakai pada baris D1 existing dibiarkan
--   seperti suntingan owner saat ini; hanya blok ekor tersembunyi "\n\nSyarat & Ketentuan:" /
--   "\n\nSyarat akun:" dari 0157/ProductCopyTab yang dipangkas agar tidak menyuntikkan poin lama
--   ke semua varian.
-- - Cara aktivasi (ID & EN) untuk PV-NORMAL-3 dan PV-FULL-3 diperbarui dengan 6 langkah persiapan
--   akun sebelum order + langkah pasca-pembayaran + catatan video tutorial placeholder (`yt.....`).
-- - Idempoten (tanpa LIKE/GLOB panjang, tanpa JOIN multi-tabel): pengulangan tidak menulis ulang.

UPDATE products
SET description = rtrim(substr(description, 1, instr(description, char(10) || char(10) || 'Syarat & Ketentuan:') - 1)),
    updated_at = datetime('now')
WHERE pixelverif_family = 'google_ai_pro_3m'
  AND instr(description, char(10) || char(10) || 'Syarat & Ketentuan:') > 0;

UPDATE products
SET description = rtrim(substr(description, 1, instr(description, char(10) || char(10) || 'Syarat akun:') - 1)),
    updated_at = datetime('now')
WHERE pixelverif_family = 'google_ai_pro_3m'
  AND instr(description, char(10) || char(10) || 'Syarat akun:') > 0;

UPDATE product_variants
SET admin_activation = 'Persiapan akun sebelum order:
1. Akun Google harus aktif dan tidak sedang ditandai aktivitas tidak biasa (unusual activity). Pastikan tidak muncul captcha saat login.
2. Hapus passkey jika ada (myaccount.google.com/signinoptions/passkeys).
3. Hapus payment profile lama di Google Payments jika masih ada (payments.google.com).
4. Akun tidak boleh tergabung dalam grup Google Family. Keluar melalui https://families.google.com/families.
5. Akun tidak boleh memiliki langganan Gemini atau Google One yang sedang aktif.
6. Aktifkan Verifikasi 2 Langkah (2-Step Verification) dan tambahkan aplikasi authenticator (myaccount.google.com/signinoptions/twosv). Kunci secret authenticator wajib diisi saat memesan.

Setelah pembayaran:
1. Tunggu link muncul di halaman Lacak Pesanan atau email/Telegram (±1–2 menit setelah pembayaran).
2. Login ke Gmail yang didaftarkan di browser.
3. Buka link one.google.com yang diterima.
4. Ikuti langkah di halaman Google sampai Google AI Pro aktif.
5. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.

Catatan:
- Tonton video tutorial berikut: yt.....',
    admin_activation_en = 'Before ordering:
1. Your Google account must be active and not flagged for unusual activity. Make sure no captcha appears when logging in.
2. Remove any passkey if you have one (myaccount.google.com/signinoptions/passkeys).
3. Remove any old payment profile in Google Payments if one still exists (payments.google.com).
4. The account must not be part of any Google Family group. Leave at https://families.google.com/families.
5. The account must not have an active Gemini or Google One subscription.
6. Turn on 2-Step Verification and add an authenticator app (myaccount.google.com/signinoptions/twosv). Your authenticator setup secret is required when placing an order.

After payment:
1. Wait for the link on the Track Order page or in your email/Telegram (about 1–2 minutes after payment).
2. Sign in to the registered Gmail in your browser.
3. Open the one.google.com link you received.
4. Follow the steps on Google''s page until Google AI Pro is active.
5. Check on one.google.com that the Google AI Pro plan is active.

Notes:
- Watch the tutorial video here: yt.....',
    admin_copy_fingerprint = COALESCE(admin_copy_fingerprint, ''),
    updated_at = datetime('now')
WHERE sku = 'PV-NORMAL-3'
  AND product_id IN (SELECT id FROM products WHERE pixelverif_family = 'google_ai_pro_3m')
  AND (
    COALESCE(admin_activation, '') != 'Persiapan akun sebelum order:
1. Akun Google harus aktif dan tidak sedang ditandai aktivitas tidak biasa (unusual activity). Pastikan tidak muncul captcha saat login.
2. Hapus passkey jika ada (myaccount.google.com/signinoptions/passkeys).
3. Hapus payment profile lama di Google Payments jika masih ada (payments.google.com).
4. Akun tidak boleh tergabung dalam grup Google Family. Keluar melalui https://families.google.com/families.
5. Akun tidak boleh memiliki langganan Gemini atau Google One yang sedang aktif.
6. Aktifkan Verifikasi 2 Langkah (2-Step Verification) dan tambahkan aplikasi authenticator (myaccount.google.com/signinoptions/twosv). Kunci secret authenticator wajib diisi saat memesan.

Setelah pembayaran:
1. Tunggu link muncul di halaman Lacak Pesanan atau email/Telegram (±1–2 menit setelah pembayaran).
2. Login ke Gmail yang didaftarkan di browser.
3. Buka link one.google.com yang diterima.
4. Ikuti langkah di halaman Google sampai Google AI Pro aktif.
5. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.

Catatan:
- Tonton video tutorial berikut: yt.....'
    OR COALESCE(admin_activation_en, '') != 'Before ordering:
1. Your Google account must be active and not flagged for unusual activity. Make sure no captcha appears when logging in.
2. Remove any passkey if you have one (myaccount.google.com/signinoptions/passkeys).
3. Remove any old payment profile in Google Payments if one still exists (payments.google.com).
4. The account must not be part of any Google Family group. Leave at https://families.google.com/families.
5. The account must not have an active Gemini or Google One subscription.
6. Turn on 2-Step Verification and add an authenticator app (myaccount.google.com/signinoptions/twosv). Your authenticator setup secret is required when placing an order.

After payment:
1. Wait for the link on the Track Order page or in your email/Telegram (about 1–2 minutes after payment).
2. Sign in to the registered Gmail in your browser.
3. Open the one.google.com link you received.
4. Follow the steps on Google''s page until Google AI Pro is active.
5. Check on one.google.com that the Google AI Pro plan is active.

Notes:
- Watch the tutorial video here: yt.....'
  );

UPDATE product_variants
SET admin_activation = 'Persiapan akun sebelum order:
1. Akun Google harus aktif dan tidak sedang ditandai aktivitas tidak biasa (unusual activity). Pastikan tidak muncul captcha saat login.
2. Hapus passkey jika ada (myaccount.google.com/signinoptions/passkeys).
3. Hapus payment profile lama di Google Payments jika masih ada (payments.google.com).
4. Akun tidak boleh tergabung dalam grup Google Family. Keluar melalui https://families.google.com/families.
5. Akun tidak boleh memiliki langganan Gemini atau Google One yang sedang aktif.
6. Aktifkan Verifikasi 2 Langkah (2-Step Verification) dan tambahkan aplikasi authenticator (myaccount.google.com/signinoptions/twosv). Kunci secret authenticator wajib diisi saat memesan.

Setelah pembayaran:
1. Tunggu keterangan aktivasi di halaman Lacak Pesanan atau email/Telegram (±3–5 menit setelah pembayaran).
2. Bila keterangan menyebut Google AI Pro sudah aktif, tidak ada langkah tambahan.
3. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.
4. Matikan perpanjangan otomatis di one.google.com bila ada.

Catatan:
- Tonton video tutorial berikut: yt.....',
    admin_activation_en = 'Before ordering:
1. Your Google account must be active and not flagged for unusual activity. Make sure no captcha appears when logging in.
2. Remove any passkey if you have one (myaccount.google.com/signinoptions/passkeys).
3. Remove any old payment profile in Google Payments if one still exists (payments.google.com).
4. The account must not be part of any Google Family group. Leave at https://families.google.com/families.
5. The account must not have an active Gemini or Google One subscription.
6. Turn on 2-Step Verification and add an authenticator app (myaccount.google.com/signinoptions/twosv). Your authenticator setup secret is required when placing an order.

After payment:
1. Wait for the activation note on the Track Order page or in your email/Telegram (about 3–5 minutes after payment).
2. If the note says Google AI Pro is already active, there are no extra steps.
3. Check on one.google.com that the Google AI Pro plan is active.
4. Turn off auto-renewal on one.google.com if present.

Notes:
- Watch the tutorial video here: yt.....',
    admin_copy_fingerprint = COALESCE(admin_copy_fingerprint, ''),
    updated_at = datetime('now')
WHERE sku = 'PV-FULL-3'
  AND product_id IN (SELECT id FROM products WHERE pixelverif_family = 'google_ai_pro_3m')
  AND (
    COALESCE(admin_activation, '') != 'Persiapan akun sebelum order:
1. Akun Google harus aktif dan tidak sedang ditandai aktivitas tidak biasa (unusual activity). Pastikan tidak muncul captcha saat login.
2. Hapus passkey jika ada (myaccount.google.com/signinoptions/passkeys).
3. Hapus payment profile lama di Google Payments jika masih ada (payments.google.com).
4. Akun tidak boleh tergabung dalam grup Google Family. Keluar melalui https://families.google.com/families.
5. Akun tidak boleh memiliki langganan Gemini atau Google One yang sedang aktif.
6. Aktifkan Verifikasi 2 Langkah (2-Step Verification) dan tambahkan aplikasi authenticator (myaccount.google.com/signinoptions/twosv). Kunci secret authenticator wajib diisi saat memesan.

Setelah pembayaran:
1. Tunggu keterangan aktivasi di halaman Lacak Pesanan atau email/Telegram (±3–5 menit setelah pembayaran).
2. Bila keterangan menyebut Google AI Pro sudah aktif, tidak ada langkah tambahan.
3. Cek di one.google.com bahwa paket Google AI Pro sudah aktif.
4. Matikan perpanjangan otomatis di one.google.com bila ada.

Catatan:
- Tonton video tutorial berikut: yt.....'
    OR COALESCE(admin_activation_en, '') != 'Before ordering:
1. Your Google account must be active and not flagged for unusual activity. Make sure no captcha appears when logging in.
2. Remove any passkey if you have one (myaccount.google.com/signinoptions/passkeys).
3. Remove any old payment profile in Google Payments if one still exists (payments.google.com).
4. The account must not be part of any Google Family group. Leave at https://families.google.com/families.
5. The account must not have an active Gemini or Google One subscription.
6. Turn on 2-Step Verification and add an authenticator app (myaccount.google.com/signinoptions/twosv). Your authenticator setup secret is required when placing an order.

After payment:
1. Wait for the activation note on the Track Order page or in your email/Telegram (about 3–5 minutes after payment).
2. If the note says Google AI Pro is already active, there are no extra steps.
3. Check on one.google.com that the Google AI Pro plan is active.
4. Turn off auto-renewal on one.google.com if present.

Notes:
- Watch the tutorial video here: yt.....'
  );
