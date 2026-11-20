-- 0149_tunvn_muse_other_variants_copy.sql — koreksi salinan varian Muse AI lain (TUNVN).
--
-- Permintaan owner 20 Nov 2026 + deskripsi supplier tersinkron di tunvn_products:
-- #112 31B garansi 2 hari = Gmail | Password | 2FA (sama dengan #111/0148);
-- #97 1B dan #98 31B tanpa garansi = Email | Password, panduan login Drive yang
-- sama (`go/muse-login-gmail`); owner menyatakan semua varian memakai 2fa.live
-- (`go/otp-2fa`) bila diminta kode. Salinan lama (Hotmail/API mail, link baca
-- mailbox) ditimpa tanpa syarat untuk SKU ini saja. #114 25–28B tetap Email |
-- Link baca mailbox sesuai supplier, tidak disentuh.

UPDATE product_variants SET
  admin_terms='Detail paket:
- Akun Muse AI 31 miliar token berbasis Gmail (sangat stabil)
- Format: Email | Password | Kode 2FA

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Login hanya memakai email, password, dan kode 2FA dari pesanan.
- Jangan mengganti email, password, atau 2FA akun selama masa garansi.

Garansi:
- Garansi 2 hari sejak pesanan dikirim.',
  admin_terms_en='Package details:
- Muse AI account with 31 billion tokens on Gmail (very stable)
- Format: Email | Password | 2FA code

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Log in only with the email, password, and 2FA code from your order.
- Do not change the account email, password, or 2FA during the warranty period.

Warranty:
- 2-day warranty from delivery.',
  admin_activation='1. Buka muse.ai lalu login memakai email dan password Gmail dari pesanan
2. Saat diminta kode verifikasi 2FA, buka axvara.tech/go/otp-2fa, tempel kode 2FA dari pesanan, lalu salin 6 digit kode yang muncul
3. Masukkan kode tersebut untuk menyelesaikan login

Catatan:
- Kode 2FA berganti tiap 30 detik; ambil ulang bila kedaluwarsa
- Panduan login bergambar: axvara.tech/go/muse-login-gmail',
  admin_activation_en='1. Open muse.ai and log in with the Gmail email and password from your order
2. When asked for the 2FA verification code, open axvara.tech/go/otp-2fa, paste the 2FA key from your order, then copy the 6-digit code shown
3. Enter that code to finish logging in

Notes:
- The 2FA code changes every 30 seconds; get a new one if it expires
- Illustrated login guide: axvara.tech/go/muse-login-gmail',
  updated_at=datetime('now')
WHERE sku='TUNVN-112';

UPDATE product_variants SET
  admin_terms='Detail paket:
- Akun Muse AI siap pakai dengan 1 miliar token
- Format: Email | Password

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Tanpa garansi sama sekali: harga sangat murah, risiko ditanggung pembeli.',
  admin_terms_en='Package details:
- Ready-to-use Muse AI account with 1 billion tokens
- Format: Email | Password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- No warranty at all: the price is very low and the risk is on the buyer.',
  admin_activation='1. Buka muse.ai lalu login memakai email dan password dari pesanan
2. Bila diminta kode verifikasi 2FA, buka axvara.tech/go/otp-2fa, tempel kode 2FA dari pesanan, lalu salin 6 digit kode yang muncul
3. Masukkan kode tersebut untuk menyelesaikan login

Catatan:
- Panduan login bergambar: axvara.tech/go/muse-login-gmail',
  admin_activation_en='1. Open muse.ai and log in with the email and password from your order
2. If asked for a 2FA verification code, open axvara.tech/go/otp-2fa, paste the 2FA key from your order, then copy the 6-digit code shown
3. Enter that code to finish logging in

Notes:
- Illustrated login guide: axvara.tech/go/muse-login-gmail',
  updated_at=datetime('now')
WHERE sku='TUNVN-97';

UPDATE product_variants SET
  admin_terms='Detail paket:
- Akun Muse AI siap pakai dengan 31 miliar token
- Format: Email | Password

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Tanpa garansi sama sekali: harga sangat murah, risiko ditanggung pembeli.',
  admin_terms_en='Package details:
- Ready-to-use Muse AI account with 31 billion tokens
- Format: Email | Password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- No warranty at all: the price is very low and the risk is on the buyer.',
  admin_activation='1. Buka muse.ai lalu login memakai email dan password dari pesanan
2. Bila diminta kode verifikasi 2FA, buka axvara.tech/go/otp-2fa, tempel kode 2FA dari pesanan, lalu salin 6 digit kode yang muncul
3. Masukkan kode tersebut untuk menyelesaikan login

Catatan:
- Panduan login bergambar: axvara.tech/go/muse-login-gmail',
  admin_activation_en='1. Open muse.ai and log in with the email and password from your order
2. If asked for a 2FA verification code, open axvara.tech/go/otp-2fa, paste the 2FA key from your order, then copy the 6-digit code shown
3. Enter that code to finish logging in

Notes:
- Illustrated login guide: axvara.tech/go/muse-login-gmail',
  updated_at=datetime('now')
WHERE sku='TUNVN-98';
