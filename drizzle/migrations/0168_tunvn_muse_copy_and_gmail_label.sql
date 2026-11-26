-- Migrasi data 0168 (tanpa DDL):
-- 1) Memperjelas label varian Gmail Muse AI (TUNVN-111 1B Gmail & TUNVN-112 31B Gmail)
--    karena TUNVN-111 sebelumnya sudah aktif tanpa kata "Gmail" pada label.
-- 2) Menyelaraskan admin_terms, admin_terms_en, admin_activation, admin_activation_en
--    seluruh varian Muse AI (#112) sesuai spesifikasi aktual supplier (format kredensial,
--    kuota token, garansi, 2FA via 2fa.axvara.tech, mailbox haiproxy via shortlink,
--    pemulihan salinan Buff Invite Code pada TUNVN-BUFF-1B, serta pengisian salinan siap
--    pakai pada TUNVN-120 yang tetap nonaktif) sambil mempertahankan link YouTube saat ini
--    secara persis pada varian akun dan menyamakan versi EN-nya.

INSERT OR IGNORE INTO supplier_links (slug, destination, title, is_active)
VALUES ('otp-haiproxy', 'https://otp.haiproxy.top/', 'Mailbox OTP Haiproxy (Muse AI)', 1);

-- 1. TUNVN-111: MUSE AI 1B - GMAIL (W2D) — Mail | Password | 2FA (garansi 2 hari)
UPDATE product_variants
SET
  label = 'Akun 1B Token · Gmail (garansi 2 hari)',
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai berbasis Gmail dengan kuota awal sekitar 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password | Kode 2FA.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi ringkas melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Jangan mengubah email pemulihan, password akun, atau pengaturan 2FA selama masa garansi.
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Garansi 2 hari sejak pesanan dikirim untuk kendala akses awal yang memenuhi syarat.
- Garansi gugur bila password/2FA diubah atau akun disalahgunakan.',
  admin_terms_en = 'Package details:
- Ready-to-use Gmail-based Muse AI account with an initial quota of around 1 billion tokens (1B).
- Delivered credential format: Email | Password | 2FA Code.

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials and summary instructions in AXVARA Track Order.

Usage rules:
- Do not change the recovery email, account password, or 2FA settings during the warranty period.
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- 2-day warranty from delivery covering eligible initial access issues.
- Warranty is void if password/2FA is changed or the account is misused.',
  admin_activation = 'Cara aktivasi:
1. Salin Email, Password, dan Kode 2FA (secret key) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk menggunakan akun Google/Gmail tersebut.
3. Masukkan Email dan Password yang diterima.
4. Jika diminta kode verifikasi 2FA (authenticator), buka 2fa.axvara.tech, tempel Kode 2FA dari pesanan, lalu masukkan kode OTP 6 digit yang muncul.
5. Setelah berhasil masuk, cek saldo token pada dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Jangan mengubah password atau pengaturan 2FA selama masa garansi 2 hari agar garansi tetap berlaku.',
  admin_activation_en = 'How to activate:
1. Copy the Email, Password, and 2FA Code (secret key) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Google/Gmail account.
3. Enter the delivered Email and Password.
4. When prompted for a 2FA verification code, open 2fa.axvara.tech, paste the 2FA Code from your order, and enter the generated 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Do not change the password or 2FA settings during the 2-day warranty period to keep the warranty valid.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-111'
  AND (
    label IS NOT 'Akun 1B Token · Gmail (garansi 2 hari)'
    OR admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai berbasis Gmail dengan kuota awal sekitar 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password | Kode 2FA.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi ringkas melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Jangan mengubah email pemulihan, password akun, atau pengaturan 2FA selama masa garansi.
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Garansi 2 hari sejak pesanan dikirim untuk kendala akses awal yang memenuhi syarat.
- Garansi gugur bila password/2FA diubah atau akun disalahgunakan.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Gmail-based Muse AI account with an initial quota of around 1 billion tokens (1B).
- Delivered credential format: Email | Password | 2FA Code.

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials and summary instructions in AXVARA Track Order.

Usage rules:
- Do not change the recovery email, account password, or 2FA settings during the warranty period.
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- 2-day warranty from delivery covering eligible initial access issues.
- Warranty is void if password/2FA is changed or the account is misused.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email, Password, dan Kode 2FA (secret key) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk menggunakan akun Google/Gmail tersebut.
3. Masukkan Email dan Password yang diterima.
4. Jika diminta kode verifikasi 2FA (authenticator), buka 2fa.axvara.tech, tempel Kode 2FA dari pesanan, lalu masukkan kode OTP 6 digit yang muncul.
5. Setelah berhasil masuk, cek saldo token pada dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Jangan mengubah password atau pengaturan 2FA selama masa garansi 2 hari agar garansi tetap berlaku.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email, Password, and 2FA Code (secret key) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Google/Gmail account.
3. Enter the delivered Email and Password.
4. When prompted for a 2FA verification code, open 2fa.axvara.tech, paste the 2FA Code from your order, and enter the generated 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Do not change the password or 2FA settings during the 2-day warranty period to keep the warranty valid.'
  );

-- 2. TUNVN-112: MUSE AI 31B - GMAIL(W2D) — Mail | Password | 2FA (garansi 2 hari)
UPDATE product_variants
SET
  label = 'Akun 31B Token · Gmail (garansi 2 hari)',
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai berbasis Gmail dengan kuota awal 31 miliar token (31B).
- Format kredensial yang dikirim: Email | Password | Kode 2FA.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi ringkas melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Jangan mengubah email pemulihan, password akun, atau pengaturan 2FA selama masa garansi.
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Garansi 2 hari sejak pesanan dikirim untuk kendala akses awal yang memenuhi syarat.
- Garansi gugur bila password/2FA diubah atau akun disalahgunakan.',
  admin_terms_en = 'Package details:
- Ready-to-use Gmail-based Muse AI account with an initial quota of 31 billion tokens (31B).
- Delivered credential format: Email | Password | 2FA Code.

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials and summary instructions in AXVARA Track Order.

Usage rules:
- Do not change the recovery email, account password, or 2FA settings during the warranty period.
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- 2-day warranty from delivery covering eligible initial access issues.
- Warranty is void if password/2FA is changed or the account is misused.',
  admin_activation = 'Cara aktivasi:
1. Salin Email, Password, dan Kode 2FA (secret key) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk menggunakan akun Google/Gmail tersebut.
3. Masukkan Email dan Password yang diterima.
4. Jika diminta kode verifikasi 2FA (authenticator), buka 2fa.axvara.tech, tempel Kode 2FA dari pesanan, lalu masukkan kode OTP 6 digit yang muncul.
5. Setelah berhasil masuk, cek saldo token pada dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Jangan mengubah password atau pengaturan 2FA selama masa garansi 2 hari agar garansi tetap berlaku.',
  admin_activation_en = 'How to activate:
1. Copy the Email, Password, and 2FA Code (secret key) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Google/Gmail account.
3. Enter the delivered Email and Password.
4. When prompted for a 2FA verification code, open 2fa.axvara.tech, paste the 2FA Code from your order, and enter the generated 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Do not change the password or 2FA settings during the 2-day warranty period to keep the warranty valid.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-112'
  AND (
    label IS NOT 'Akun 31B Token · Gmail (garansi 2 hari)'
    OR admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai berbasis Gmail dengan kuota awal 31 miliar token (31B).
- Format kredensial yang dikirim: Email | Password | Kode 2FA.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi ringkas melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Jangan mengubah email pemulihan, password akun, atau pengaturan 2FA selama masa garansi.
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Garansi 2 hari sejak pesanan dikirim untuk kendala akses awal yang memenuhi syarat.
- Garansi gugur bila password/2FA diubah atau akun disalahgunakan.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Gmail-based Muse AI account with an initial quota of 31 billion tokens (31B).
- Delivered credential format: Email | Password | 2FA Code.

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials and summary instructions in AXVARA Track Order.

Usage rules:
- Do not change the recovery email, account password, or 2FA settings during the warranty period.
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- 2-day warranty from delivery covering eligible initial access issues.
- Warranty is void if password/2FA is changed or the account is misused.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email, Password, dan Kode 2FA (secret key) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk menggunakan akun Google/Gmail tersebut.
3. Masukkan Email dan Password yang diterima.
4. Jika diminta kode verifikasi 2FA (authenticator), buka 2fa.axvara.tech, tempel Kode 2FA dari pesanan, lalu masukkan kode OTP 6 digit yang muncul.
5. Setelah berhasil masuk, cek saldo token pada dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Jangan mengubah password atau pengaturan 2FA selama masa garansi 2 hari agar garansi tetap berlaku.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email, Password, and 2FA Code (secret key) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Google/Gmail account.
3. Enter the delivered Email and Password.
4. When prompted for a 2FA verification code, open 2fa.axvara.tech, paste the 2FA Code from your order, and enter the generated 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Do not change the password or 2FA settings during the 2-day warranty period to keep the warranty valid.'
  );

-- 3. TUNVN-97: Akun 1B Token (tanpa garansi) — Email | Password (non-Gmail, tanpa garansi)
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password (non-Gmail).

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login setelah kredensial diterima.',
  admin_terms_en = 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Password (non-Gmail).

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.',
  admin_activation = 'Cara aktivasi:
1. Salin Email dan Password dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk dengan email.
3. Masukkan Email dan Password yang diterima persis sesuai pesanan.
4. Jika pesanan turut menyertakan kode 2FA dan halaman login memintanya, buka 2fa.axvara.tech untuk mengambil kode OTP 6 digit.
5. Setelah masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah pesanan diterima.',
  admin_activation_en = 'How to activate:
1. Copy the Email and Password from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and choose email sign-in.
3. Enter the delivered Email and Password exactly as shown in your order.
4. If your order also includes a 2FA code and login requests it, open 2fa.axvara.tech to generate the 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-97'
  AND (
    admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password (non-Gmail).

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login setelah kredensial diterima.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Password (non-Gmail).

Process & delivery:
- Automatically delivered after payment verification.
- View your account credentials in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email dan Password dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk dengan email.
3. Masukkan Email dan Password yang diterima persis sesuai pesanan.
4. Jika pesanan turut menyertakan kode 2FA dan halaman login memintanya, buka 2fa.axvara.tech untuk mengambil kode OTP 6 digit.
5. Setelah masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah pesanan diterima.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email and Password from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and choose email sign-in.
3. Enter the delivered Email and Password exactly as shown in your order.
4. If your order also includes a 2FA code and login requests it, open 2fa.axvara.tech to generate the 6-digit OTP code.
5. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.'
  );

-- 4. TUNVN-98: Akun 31B Token (tanpa garansi) — Email | Link baca mailbox (tanpa garansi)
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 31 miliar token (31B).
- Format kredensial yang dikirim: Email | Link baca mailbox.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek Email dan tautan mailbox pada Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: segera lakukan login dan cek mailbox sesaat setelah pesanan diterima.',
  admin_terms_en = 'Package details:
- Ready-to-use Muse AI account with an initial quota of 31 billion tokens (31B).
- Delivered credential format: Email | Mailbox link.

Process & delivery:
- Automatically delivered after payment verification.
- Check the Email and mailbox link in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: sign in and check the mailbox immediately after receiving your order.',
  admin_activation = 'Cara aktivasi:
1. Salin Email dan Link baca mailbox dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk meminta kode OTP masuk.
3. Buka Link baca mailbox dari pesanan (atau kunjungi axvara.tech/go/otp-haiproxy bila hanya menyalin alamat mailbox) untuk membaca kode OTP.
4. Masukkan kode OTP ke halaman Muse AI hingga berhasil masuk, lalu cek saldo token pada dashboard.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung login dan cek mailbox sesaat setelah pesanan diterima.',
  admin_activation_en = 'How to activate:
1. Copy the Email and Mailbox link from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and enter the delivered Email to request a login OTP code.
3. Open the Mailbox link from your order (or visit axvara.tech/go/otp-haiproxy if you only copied the mailbox address) to read the OTP code.
4. Enter the OTP code on Muse AI to sign in, then verify the token balance on your dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in and check the mailbox immediately upon delivery.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-98'
  AND (
    admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 31 miliar token (31B).
- Format kredensial yang dikirim: Email | Link baca mailbox.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek Email dan tautan mailbox pada Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: segera lakukan login dan cek mailbox sesaat setelah pesanan diterima.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Muse AI account with an initial quota of 31 billion tokens (31B).
- Delivered credential format: Email | Mailbox link.

Process & delivery:
- Automatically delivered after payment verification.
- Check the Email and mailbox link in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: sign in and check the mailbox immediately after receiving your order.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email dan Link baca mailbox dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk meminta kode OTP masuk.
3. Buka Link baca mailbox dari pesanan (atau kunjungi axvara.tech/go/otp-haiproxy bila hanya menyalin alamat mailbox) untuk membaca kode OTP.
4. Masukkan kode OTP ke halaman Muse AI hingga berhasil masuk, lalu cek saldo token pada dashboard.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung login dan cek mailbox sesaat setelah pesanan diterima.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email and Mailbox link from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and enter the delivered Email to request a login OTP code.
3. Open the Mailbox link from your order (or visit axvara.tech/go/otp-haiproxy if you only copied the mailbox address) to read the OTP code.
4. Enter the OTP code on Muse AI to sign in, then verify the token balance on your dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in and check the mailbox immediately upon delivery.'
  );

-- 5. TUNVN-114: Akun 25–28B Token (tanpa garansi)
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal sekitar 25 sampai 28 miliar token (25–28B).
- Format kredensial yang dikirim: Email | Link baca mailbox (atau Email | Password sesuai isi pesanan).

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi masuk melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login sesaat setelah kredensial diterima.',
  admin_terms_en = 'Package details:
- Ready-to-use Muse AI account with an initial quota of around 25 to 28 billion tokens (25–28B).
- Delivered credential format: Email | Mailbox link (or Email | Password as shown in your order).

Process & delivery:
- Automatically delivered after payment verification.
- Check your account credentials and sign-in details in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.',
  admin_activation = 'Cara aktivasi:
1. Salin Email dan Link baca mailbox (atau Password bila tertera) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk masuk.
3. Jika pesanan menyertakan Link baca mailbox, buka tautan mailbox tersebut (atau kunjungi axvara.tech/go/otp-haiproxy bila diarahkan) untuk mengambil kode OTP masuk; jika menyertakan Password langsung, masukkan password tersebut.
4. Setelah berhasil masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah kredensial diterima.',
  admin_activation_en = 'How to activate:
1. Copy the Email and Mailbox link (or Password if included) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Email.
3. If your order includes a Mailbox link, open it (or visit axvara.tech/go/otp-haiproxy if directed) to read your login OTP code; if a Password is provided instead, enter that password directly.
4. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-114'
  AND (
    admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal sekitar 25 sampai 28 miliar token (25–28B).
- Format kredensial yang dikirim: Email | Link baca mailbox (atau Email | Password sesuai isi pesanan).

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek kredensial akun dan instruksi masuk melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login sesaat setelah kredensial diterima.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Muse AI account with an initial quota of around 25 to 28 billion tokens (25–28B).
- Delivered credential format: Email | Mailbox link (or Email | Password as shown in your order).

Process & delivery:
- Automatically delivered after payment verification.
- Check your account credentials and sign-in details in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email dan Link baca mailbox (atau Password bila tertera) dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk masuk.
3. Jika pesanan menyertakan Link baca mailbox, buka tautan mailbox tersebut (atau kunjungi axvara.tech/go/otp-haiproxy bila diarahkan) untuk mengambil kode OTP masuk; jika menyertakan Password langsung, masukkan password tersebut.
4. Setelah berhasil masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah kredensial diterima.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email and Mailbox link (or Password if included) from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and sign in with the delivered Email.
3. If your order includes a Mailbox link, open it (or visit axvara.tech/go/otp-haiproxy if directed) to read your login OTP code; if a Password is provided instead, enter that password directly.
4. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.'
  );

-- 6. TUNVN-120: MUSE AI 1B TOKEN (NW) — Email | Link baca mailbox (tetap is_active sesuai state saat ini)
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Link baca mailbox.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek Email dan tautan mailbox pada Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: segera lakukan login dan cek mailbox sesaat setelah pesanan diterima.',
  admin_terms_en = 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Mailbox link.

Process & delivery:
- Automatically delivered after payment verification.
- Check the Email and mailbox link in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: sign in and check the mailbox immediately after receiving your order.',
  admin_activation = 'Cara aktivasi:
1. Salin Email dan Link baca mailbox dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk meminta kode OTP masuk.
3. Buka Link baca mailbox dari pesanan (atau kunjungi axvara.tech/go/otp-haiproxy bila hanya menyalin alamat mailbox) untuk membaca kode OTP.
4. Masukkan kode OTP ke halaman Muse AI hingga berhasil masuk, lalu cek saldo token pada dashboard.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung login dan cek mailbox sesaat setelah pesanan diterima.',
  admin_activation_en = 'How to activate:
1. Copy the Email and Mailbox link from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and enter the delivered Email to request a login OTP code.
3. Open the Mailbox link from your order (or visit axvara.tech/go/otp-haiproxy if you only copied the mailbox address) to read the OTP code.
4. Enter the OTP code on Muse AI to sign in, then verify the token balance on your dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in and check the mailbox immediately upon delivery.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-120'
  AND (
    admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Link baca mailbox.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terverifikasi.
- Cek Email dan tautan mailbox pada Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: segera lakukan login dan cek mailbox sesaat setelah pesanan diterima.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Mailbox link.

Process & delivery:
- Automatically delivered after payment verification.
- Check the Email and mailbox link in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: sign in and check the mailbox immediately after receiving your order.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email dan Link baca mailbox dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu masukkan Email tersebut untuk meminta kode OTP masuk.
3. Buka Link baca mailbox dari pesanan (atau kunjungi axvara.tech/go/otp-haiproxy bila hanya menyalin alamat mailbox) untuk membaca kode OTP.
4. Masukkan kode OTP ke halaman Muse AI hingga berhasil masuk, lalu cek saldo token pada dashboard.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung login dan cek mailbox sesaat setelah pesanan diterima.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email and Mailbox link from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and enter the delivered Email to request a login OTP code.
3. Open the Mailbox link from your order (or visit axvara.tech/go/otp-haiproxy if you only copied the mailbox address) to read the OTP code.
4. Enter the OTP code on Muse AI to sign in, then verify the token balance on your dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in and check the mailbox immediately upon delivery.'
  );

-- 7. TUNVN-BUFF-1B: pulihkan salinan Buff Token Invite Code (sebelumnya tertimpa instruksi login akun)
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Layanan penambahan token untuk akun Muse AI milikmu, bukan pembelian akun baru.
- 1 unit = 1 miliar token (1B). Pilih jumlah 1–30 unit untuk 1–30B token.

Proses & pengiriman:
- Pesanan diproses setelah pembayaran terverifikasi. Pantau perkembangannya melalui Lacak Pesanan AXVARA.
- Waktu proses mengikuti antrean dan ketersediaan layanan; bukan jaminan selesai seketika.

Aturan pakai:
- Satu checkout hanya untuk satu Invite Code Muse AI. Buat checkout terpisah untuk kode lain.
- Kode wajib 6 karakter huruf/angka, disalin persis dari akun tujuan tanpa mengubah huruf besar atau kecil.
- Pastikan kode dan jumlah sudah benar sebelum membayar.
- Tidak perlu memberikan password atau OTP akun Muse kepada AXVARA.
- Harga dan total pembayaran mengikuti checkout AXVARA.',
  admin_terms_en = 'Package details:
- Token top-up service for your own Muse AI account, not a new account purchase.
- 1 unit = 1 billion tokens (1B). Choose 1–30 units for 1–30B tokens.

Process & delivery:
- Processing starts after payment is verified. Follow progress through AXVARA Track Order.
- Processing time depends on the queue and service availability; completion is not guaranteed to be immediate.

Usage rules:
- Use one Muse AI Invite Code per checkout. Create a separate checkout for another code.
- The code must contain 6 letters or digits. Copy it exactly from the destination account, preserving uppercase and lowercase.
- Check the code and quantity before paying.
- You do not need to share your Muse account password or OTP with AXVARA.
- Prices and the payment total are shown at AXVARA checkout.',
  admin_activation = 'Ambil Invite Code Muse AI:
1. Buka aplikasi atau website Muse AI, lalu masuk ke akun yang ingin ditambah tokennya.
2. Buka menu Invite friends / Undang teman.
3. Salin Invite Code 6 karakter yang tampil pada akunmu.

Pesan melalui AXVARA:
1. Pilih varian Buff Token Muse AI per 1B, lalu tentukan jumlah 1–30 unit. Contoh: jumlah 20 berarti 20B token.
2. Lanjutkan ke checkout dan tempel kode pada kolom Kode Invite Muse, bukan pada kolom email.
3. Periksa kembali kode, jumlah, dan total pembayaran, lalu selesaikan pembayaran.
4. Pantau status melalui Lacak Pesanan AXVARA. Setelah selesai, muat ulang Muse AI dan periksa saldo token pada akun tujuan.

Catatan:
- Jika menu Invite friends tidak ditemukan atau token belum bertambah setelah pesanan selesai, hubungi dukungan AXVARA dengan nomor pesanan.',
  admin_activation_en = 'Get your Muse AI Invite Code:
1. Open the Muse AI app or website and sign in to the account you want to top up.
2. Open Invite friends.
3. Copy the 6-character Invite Code shown in your account.

Order through AXVARA:
1. Select Buff Token Muse AI per 1B and choose 1–30 units. For example, a quantity of 20 means 20B tokens.
2. Continue to checkout and paste the code into Muse invite code, not the email field.
3. Check the code, quantity, and payment total, then complete payment.
4. Follow the status through AXVARA Track Order. Once completed, refresh Muse AI and check the token balance in the destination account.

Notes:
- If you cannot find Invite friends or tokens have not appeared after the order is completed, contact AXVARA support with your order number.',
  updated_at = datetime('now')
WHERE sku = 'TUNVN-BUFF-1B'
  AND (
    admin_terms IS NOT 'Detail paket:
- Layanan penambahan token untuk akun Muse AI milikmu, bukan pembelian akun baru.
- 1 unit = 1 miliar token (1B). Pilih jumlah 1–30 unit untuk 1–30B token.

Proses & pengiriman:
- Pesanan diproses setelah pembayaran terverifikasi. Pantau perkembangannya melalui Lacak Pesanan AXVARA.
- Waktu proses mengikuti antrean dan ketersediaan layanan; bukan jaminan selesai seketika.

Aturan pakai:
- Satu checkout hanya untuk satu Invite Code Muse AI. Buat checkout terpisah untuk kode lain.
- Kode wajib 6 karakter huruf/angka, disalin persis dari akun tujuan tanpa mengubah huruf besar atau kecil.
- Pastikan kode dan jumlah sudah benar sebelum membayar.
- Tidak perlu memberikan password atau OTP akun Muse kepada AXVARA.
- Harga dan total pembayaran mengikuti checkout AXVARA.'
    OR admin_terms_en IS NOT 'Package details:
- Token top-up service for your own Muse AI account, not a new account purchase.
- 1 unit = 1 billion tokens (1B). Choose 1–30 units for 1–30B tokens.

Process & delivery:
- Processing starts after payment is verified. Follow progress through AXVARA Track Order.
- Processing time depends on the queue and service availability; completion is not guaranteed to be immediate.

Usage rules:
- Use one Muse AI Invite Code per checkout. Create a separate checkout for another code.
- The code must contain 6 letters or digits. Copy it exactly from the destination account, preserving uppercase and lowercase.
- Check the code and quantity before paying.
- You do not need to share your Muse account password or OTP with AXVARA.
- Prices and the payment total are shown at AXVARA checkout.'
    OR admin_activation IS NOT 'Ambil Invite Code Muse AI:
1. Buka aplikasi atau website Muse AI, lalu masuk ke akun yang ingin ditambah tokennya.
2. Buka menu Invite friends / Undang teman.
3. Salin Invite Code 6 karakter yang tampil pada akunmu.

Pesan melalui AXVARA:
1. Pilih varian Buff Token Muse AI per 1B, lalu tentukan jumlah 1–30 unit. Contoh: jumlah 20 berarti 20B token.
2. Lanjutkan ke checkout dan tempel kode pada kolom Kode Invite Muse, bukan pada kolom email.
3. Periksa kembali kode, jumlah, dan total pembayaran, lalu selesaikan pembayaran.
4. Pantau status melalui Lacak Pesanan AXVARA. Setelah selesai, muat ulang Muse AI dan periksa saldo token pada akun tujuan.

Catatan:
- Jika menu Invite friends tidak ditemukan atau token belum bertambah setelah pesanan selesai, hubungi dukungan AXVARA dengan nomor pesanan.'
    OR admin_activation_en IS NOT 'Get your Muse AI Invite Code:
1. Open the Muse AI app or website and sign in to the account you want to top up.
2. Open Invite friends.
3. Copy the 6-character Invite Code shown in your account.

Order through AXVARA:
1. Select Buff Token Muse AI per 1B and choose 1–30 units. For example, a quantity of 20 means 20B tokens.
2. Continue to checkout and paste the code into Muse invite code, not the email field.
3. Check the code, quantity, and payment total, then complete payment.
4. Follow the status through AXVARA Track Order. Once completed, refresh Muse AI and check the token balance in the destination account.

Notes:
- If you cannot find Invite friends or tokens have not appeared after the order is completed, contact AXVARA support with your order number.'
  );

-- 8. DEFAULT-MUSE-AI-1-MILIAR-TOKEN (nonaktif fallback lama): selaraskan agar bebas link lama
UPDATE product_variants
SET
  admin_terms = 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password.

Proses & pengiriman:
- Dikirim setelah pembayaran terverifikasi.
- Cek kredensial akun melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login setelah kredensial diterima.',
  admin_terms_en = 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Password.

Process & delivery:
- Delivered after payment verification.
- View your account credentials in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.',
  admin_activation = 'Cara aktivasi:
1. Salin Email dan Password dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk dengan email.
3. Masukkan Email dan Password yang diterima persis sesuai pesanan.
4. Setelah masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah pesanan diterima.',
  admin_activation_en = 'How to activate:
1. Copy the Email and Password from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and choose email sign-in.
3. Enter the delivered Email and Password exactly as shown in your order.
4. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.',
  updated_at = datetime('now')
WHERE sku = 'DEFAULT-MUSE-AI-1-MILIAR-TOKEN'
  AND (
    admin_terms IS NOT 'Detail paket:
- Akun Muse AI siap pakai dengan kuota awal 1 miliar token (1B).
- Format kredensial yang dikirim: Email | Password.

Proses & pengiriman:
- Dikirim setelah pembayaran terverifikasi.
- Cek kredensial akun melalui Lacak Pesanan AXVARA.

Aturan pakai:
- Satu pesanan untuk satu pembeli; gunakan akun sesuai batas pemakaian normal Muse AI.
- Perubahan atau pemakaian token setelah login menjadi tanggung jawab pembeli.

Garansi:
- Tanpa garansi: pastikan langsung mencoba login setelah kredensial diterima.'
    OR admin_terms_en IS NOT 'Package details:
- Ready-to-use Muse AI account with an initial quota of 1 billion tokens (1B).
- Delivered credential format: Email | Password.

Process & delivery:
- Delivered after payment verification.
- View your account credentials in AXVARA Track Order.

Usage rules:
- One order per buyer; use the account within normal Muse AI limits.
- Token changes or usage after login are the buyer''s responsibility.

Warranty:
- No warranty: test signing in immediately after receiving the credentials.'
    OR admin_activation IS NOT 'Cara aktivasi:
1. Salin Email dan Password dari Lacak Pesanan AXVARA.
2. Buka situs atau aplikasi Muse AI (https://muse.ai), lalu pilih masuk dengan email.
3. Masukkan Email dan Password yang diterima persis sesuai pesanan.
4. Setelah masuk, periksa saldo token di dashboard Muse AI.

Catatan:
- Panduan login video: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- Varian ini tanpa garansi; pastikan langsung mencoba login sesaat setelah pesanan diterima.'
    OR admin_activation_en IS NOT 'How to activate:
1. Copy the Email and Password from AXVARA Track Order.
2. Open Muse AI (https://muse.ai) and choose email sign-in.
3. Enter the delivered Email and Password exactly as shown in your order.
4. Once signed in, verify the token balance on your Muse AI dashboard.

Notes:
- Video login guide: https://youtu.be/Q6Bjf1wrDbs?si=VkOshNDkLq4bFjLd
- This variant has no warranty; sign in immediately after receiving the credentials.'
  );

INSERT INTO store_settings (key, value, updated_at)
VALUES ('catalog_revision_market', '0168-muse-variant-copy', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at
WHERE store_settings.value != excluded.value;
