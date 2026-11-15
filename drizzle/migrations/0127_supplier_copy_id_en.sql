-- 0127_supplier_copy_id_en.sql — deskripsi produk + S&K/cara aktivasi varian TUNVN dan AIVault (ID + EN).
--
-- TUNVN: sumber deskripsi supplier GET /api/products (dibaca 15 Nov 2026, read-only),
-- ditulis ulang gaya AXVARA; Gemini #115 meniru varian manual Gemini Plus 6 Bulan
-- (GOOGLE-AI-PRO-ANTIGRAVITY-PLUS-6M). AIVault: API tanpa deskripsi; salinan dari
-- screenshot owner 15 Nov (Gemini = manual + aturan 24 jam AIVault). ChatGPT Plus
-- AIVault belum diisi (menunggu materi owner).
-- Link pihak ketiga TUNVN diganti shortlink axvara.tech/go/* (existing: otp-generator,
-- otp-2fa, grok-web; baru di bawah).
-- Aman/idempoten:
-- - shortlink INSERT OR IGNORE;
-- - deskripsi produk hanya menimpa template bawaan (…Pilih varian sesuai kebutuhan;
--   garansi mengikuti varian…); description_en hanya bila masih kosong; produk owner
--   Muse tidak disentuh;
-- - salinan varian hanya bila kolom ID/EN masih kosong (suntingan admin aman).

INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('claude-api', 'https://www.fableaiapi.com/', 'Redeem kode Claude API (TUNVN)'),
  ('claude-api-docs', 'https://www.fableaiapi.com/docs', 'Panduan Claude API (TUNVN)'),
  ('mail-fvia', 'https://fviainboxes.com/', 'Mailbox email pemulihan Microsoft 365 (TUNVN)'),
  ('mail-dongvan', 'https://dongvanfb.net/read_mail_box/', 'Baca mailbox API mail (TUNVN Grammarly/Muse)'),
  ('muse-login', 'https://drive.google.com/file/d/1PPt0V_hv91I3hBx6jAoCoZXTIqkyiVtx/view?usp=drivesdk', 'Panduan login Muse AI Hotmail (TUNVN)');

-- TUNVN
UPDATE products SET description='Akun ChatGPT siap pakai dengan email dan password sendiri, bukan sharing. Pilih varian Business atau Plus (Google Pay) sesuai kebutuhan.
- Akun jadi, langsung login
- Dikirim otomatis setelah pembayaran
- Garansi 1x24 jam sesuai varian', updated_at=datetime('now') WHERE tunvn_family='chatgpt' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Ready-to-use ChatGPT account with its own email and password, not a shared account. Choose the Business or Plus (Google Pay) variant to suit your needs.
- Ready-made account, log in right away
- Delivered automatically after payment
- 24-hour warranty per variant' WHERE tunvn_family='chatgpt' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='CapCut Pro untuk edit video dengan fitur premium dan kredit AI. Tersedia paket 7 hari, 1 bulan, Team 1 bulan, dan 6 bulan.
- Akun jadi, langsung login
- Kredit AI sesuai paket
- Garansi penuh selama masa aktif sesuai aturan pakai', updated_at=datetime('now') WHERE tunvn_family='capcut' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='CapCut Pro for video editing with premium features and AI credits. Available as 7-day, 1-month, Team 1-month and 6-month plans.
- Ready-made account, log in right away
- AI credits per plan
- Full warranty for the active period, subject to the usage rules' WHERE tunvn_family='capcut' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Grok Premium + Cursor Premium dalam satu akun: asisten AI Grok dan editor kode AI Cursor.
- Akun jadi, langsung login
- Pilihan 14 hari atau 1 bulan
- Garansi sesuai varian', updated_at=datetime('now') WHERE tunvn_family='grok-cursor' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Grok Premium + Cursor Premium in one account: the Grok AI assistant plus the Cursor AI code editor.
- Ready-made account, log in right away
- 14-day or 1-month options
- Warranty per variant' WHERE tunvn_family='grok-cursor' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Kredit Claude API melalui API gateway untuk developer dan integrasi aplikasi. Produk berupa kode redeem, bukan akun claude.ai.
- Kredit $100 atau $500
- Masa aktif 30 hari
- Garansi penuh selama masa aktif', updated_at=datetime('now') WHERE tunvn_family='claude-api' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Claude API credit through an API gateway for developers and app integrations. Delivered as a redeem code, not a claude.ai account.
- $100 or $500 credit
- 30-day validity
- Full warranty for the active period' WHERE tunvn_family='claude-api' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Microsoft 365 akun Admin 12 bulan untuk aplikasi Office dan layanan Microsoft 365, bisa menambah hingga 5 anggota family.
- Masa aktif 12 bulan
- Bisa tambah 5 anggota
- Garansi penuh selama masa aktif', updated_at=datetime('now') WHERE tunvn_family='microsoft-365' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Microsoft 365 Admin account for 12 months for Office apps and Microsoft 365 services, with up to 5 family members.
- 12-month active period
- Add up to 5 members
- Full warranty for the active period' WHERE tunvn_family='microsoft-365' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Link redeem Spotify Premium 3 bulan untuk akun baru atau akun yang belum pernah Premium.
- Masa aktif 3 bulan setelah aktivasi
- Bisa diaktifkan dari negara mana pun
- Wajib kartu untuk aktivasi', updated_at=datetime('now') WHERE tunvn_family='spotify' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Spotify Premium 3-month redeem link for new accounts or accounts that have never had Premium.
- 3 months of Premium after activation
- Can be activated from any country
- A card is required to activate' WHERE tunvn_family='spotify' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='ElevenLabs Creator untuk text-to-speech dan voice AI dengan kredit bulanan besar.
- Paket Creator 3 bulan
- 131 ribu kredit per bulan
- Garansi 3 hari', updated_at=datetime('now') WHERE tunvn_family='elevenlabs' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='ElevenLabs Creator for AI text-to-speech and voice with a large monthly credit allowance.
- Creator plan for 3 months
- 131k credits per month
- 3-day warranty' WHERE tunvn_family='elevenlabs' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Grammarly Pro 12 bulan untuk cek tata bahasa, gaya tulisan, dan parafrase berbahasa Inggris.
- Akun jadi, langsung login
- Masa aktif 12 bulan
- Garansi 10 hari', updated_at=datetime('now') WHERE tunvn_family='grammarly' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Grammarly Pro for 12 months for English grammar, style and paraphrasing checks.
- Ready-made account, log in right away
- 12-month active period
- 10-day warranty' WHERE tunvn_family='grammarly' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Key HMA VPN (Hide My Ass) untuk Android dan PC.
- Masa aktif 30 hari
- Berupa license key
- Garansi 25 hari', updated_at=datetime('now') WHERE tunvn_family='hma' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='HMA VPN (Hide My Ass) key for Android and PC.
- 30-day active period
- Delivered as a license key
- 25-day warranty' WHERE tunvn_family='hma' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Kupon Nord VPN 3 bulan, aktivasi tanpa kartu.
- Masa aktif 3 bulan
- Aktivasi dengan email sendiri
- Garansi kupon 3 hari', updated_at=datetime('now') WHERE tunvn_family='nord' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Nord VPN 3-month coupon, activated without a card.
- 3-month active period
- Activate with your own email
- 3-day coupon warranty' WHERE tunvn_family='nord' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Google Gemini Plus 6 bulan lewat link redeem resmi ke akun Google milikmu sendiri, dengan storage 400 GB dan tanpa kartu kredit.
- Masa aktif 6 bulan setelah diklaim
- Bisa undang hingga 5 akun keluarga
- Storage 400 GB untuk Drive, Photos & Gmail
- Tanpa kartu kredit / metode pembayaran

Detail benefit, syarat, dan cara aktivasi mengikuti varian yang dipilih.', updated_at=datetime('now') WHERE tunvn_family='gemini' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Google Gemini Plus for 6 months via an official redeem link to your own Google account, with 400 GB storage and no credit card required.
- 6-month active period after claiming
- Invite up to 5 family accounts
- 400 GB storage for Drive, Photos & Gmail
- No credit card / payment method required

Benefit details, terms, and activation steps follow the selected variant.' WHERE tunvn_family='gemini' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Link promo LinkedIn Premium Career 3 bulan untuk akun yang belum pernah Premium.
- Masa aktif 3 bulan
- Upgrade akun LinkedIn milik sendiri
- Tanpa garansi', updated_at=datetime('now') WHERE tunvn_family='linkedin' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='LinkedIn Premium Career 3-month promo link for accounts that have never had Premium.
- 3-month active period
- Upgrades your own LinkedIn account
- No warranty' WHERE tunvn_family='linkedin' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Nomor telepon sewa sekali pakai untuk menerima kode verifikasi (misalnya verifikasi nomor Codex/OpenAI).
- Kode tampil otomatis di halaman link
- Satu link untuk satu kode
- Dikirim otomatis setelah pembayaran', updated_at=datetime('now') WHERE tunvn_family='codex-phone' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='One-time rental phone number to receive a verification code (for example Codex/OpenAI phone verification).
- The code appears automatically on the link page
- One link receives one code
- Delivered automatically after payment' WHERE tunvn_family='codex-phone' AND (description_en IS NULL OR description_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- CapCut Pro Team Plan 1 bulan
- 650 kredit AI
- Format: Email | Password CapCut

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Login maksimal di 2 perangkat

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Buka aplikasi atau web CapCut lalu login dengan email dan password dari pesanan
2. Bila diminta kode verifikasi, buka axvara.tech/go/otp-generator lalu masukkan alamat email akun untuk membaca inbox
3. Salin kode verifikasi dan masukkan di CapCut' WHERE sku='TUNVN-37' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- CapCut Pro Team Plan for 1 month
- 650 AI credits
- Format: Email | CapCut password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Log in on 2 devices at most

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Open the CapCut app or website and log in with the email and password from your order
2. If asked for a verification code, open axvara.tech/go/otp-generator and enter the account email to read its inbox
3. Copy the verification code and enter it in CapCut' WHERE sku='TUNVN-37' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- CapCut Pro durasi 6 sampai 7 hari
- 500 kredit AI
- Format: Email | Password

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Buka aplikasi atau web CapCut
2. Login dengan email dan password dari pesanan
3. Fitur Pro dan kredit langsung aktif di akun' WHERE sku='TUNVN-44' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- CapCut Pro for 6 to 7 days
- 500 AI credits
- Format: Email | Password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Open the CapCut app or website
2. Log in with the email and password from your order
3. Pro features and credits are active right away' WHERE sku='TUNVN-44' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- ElevenLabs Creator Plan 3 bulan
- 131 ribu kredit setiap bulan
- Format: Email | Password ElevenLabs | Password email | Link OTP

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Amankan akun setelah pembelian

Garansi:
- Garansi 3 hari sejak pesanan dikirim.', admin_activation='1. Buka elevenlabs.io lalu login dengan email dan password ElevenLabs dari pesanan
2. Bila diminta kode, buka link OTP dari pesanan
3. Amankan akun (ganti password) setelah berhasil login' WHERE sku='TUNVN-47' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- ElevenLabs Creator Plan for 3 months
- 131k credits every month
- Format: Email | ElevenLabs password | Email password | OTP link

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Secure the account after purchase

Warranty:
- 3-day warranty from delivery.', admin_activation_en='1. Open elevenlabs.io and log in with the email and ElevenLabs password from your order
2. If asked for a code, open the OTP link from your order
3. Secure the account (change the password) after logging in' WHERE sku='TUNVN-47' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Link promo upgrade LinkedIn Premium Career 3 bulan
- Untuk akun yang belum pernah Premium

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Wajib menambahkan kartu pembayaran; tagihan awal Rp0

Garansi:
- Tanpa garansi.', admin_activation='1. Login ke akun LinkedIn yang ingin di-upgrade
2. Klik link promo dari pesanan
3. Tambahkan kartu pembayaran lalu konfirmasi (tagihan awal Rp0)

Catatan:
- Batalkan langganan sebelum 3 bulan berakhir bila tidak ingin diperpanjang otomatis.' WHERE sku='TUNVN-59' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- LinkedIn Premium Career 3-month promotional upgrade link
- For accounts that have never had Premium

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- A payment card must be added; the initial charge is 0

Warranty:
- No warranty.', admin_activation_en='1. Log in to the LinkedIn account you want to upgrade
2. Click the promotional link from your order
3. Add a payment card and confirm (initial charge is 0)

Notes:
- Cancel the subscription before the 3 months end if you do not want it to renew automatically.' WHERE sku='TUNVN-59' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- CapCut Pro Individual 6 sampai 7 bulan
- Format: Email | Password | Tanggal | Link mailbox

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Wajib mengganti email akun dalam 2 hari setelah pembelian
- Login maksimal di 2 perangkat; error batas perangkat tidak termasuk garansi

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Buka aplikasi atau web CapCut lalu login dengan email dan password dari pesanan
2. Buka link mailbox dari pesanan untuk membaca kode verifikasi
3. Dalam 2 hari, ganti email akun ke email milikmu lewat pengaturan akun CapCut' WHERE sku='TUNVN-67' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- CapCut Pro Individual for 6 to 7 months
- Format: Email | Password | Date | Mailbox link

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- You must change the account email within 2 days of purchase
- Log in on 2 devices at most; device-limit errors are not covered by the warranty

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Open the CapCut app or website and log in with the email and password from your order
2. Open the mailbox link from your order to read verification codes
3. Within 2 days, change the account email to your own in the CapCut account settings' WHERE sku='TUNVN-67' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Kode redeem kredit Claude API senilai $100
- Masa aktif 30 hari
- Akses melalui API gateway, bukan akun claude.ai

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Daftar akun di axvara.tech/go/claude-api
2. Redeem kode dari pesanan di dashboard
3. Buat API key lalu hubungkan ke aplikasimu

Catatan:
- Panduan lengkap: axvara.tech/go/claude-api-docs' WHERE sku='TUNVN-69' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Claude API credit redeem code worth $100
- 30-day validity
- Access through an API gateway, not a claude.ai account

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Sign up at axvara.tech/go/claude-api
2. Redeem the code from your order in the dashboard
3. Create an API key and connect it to your app

Notes:
- Full guide: axvara.tech/go/claude-api-docs' WHERE sku='TUNVN-69' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Kode redeem kredit Claude API senilai $500
- Masa aktif 30 hari
- Akses melalui API gateway, bukan akun claude.ai

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Daftar akun di axvara.tech/go/claude-api
2. Redeem kode dari pesanan di dashboard
3. Buat API key lalu hubungkan ke aplikasimu

Catatan:
- Panduan lengkap: axvara.tech/go/claude-api-docs' WHERE sku='TUNVN-70' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Claude API credit redeem code worth $500
- 30-day validity
- Access through an API gateway, not a claude.ai account

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Sign up at axvara.tech/go/claude-api
2. Redeem the code from your order in the dashboard
3. Create an API key and connect it to your app

Notes:
- Full guide: axvara.tech/go/claude-api-docs' WHERE sku='TUNVN-70' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Admin Microsoft 365 masa aktif 12 bulan
- Bisa menambah hingga 5 anggota family
- Format: Email | Password | Email pemulihan

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Jangan mengganti password atau email pemulihan
- Jangan menambah keamanan tambahan ke akun: sistem login otomatis tiap bulan untuk perpanjangan

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Login di office.com dengan email dan password dari pesanan
2. Bila diminta kode, buka axvara.tech/go/mail-fvia untuk membaca inbox email pemulihan
3. Tambahkan hingga 5 anggota family dari pengaturan langganan' WHERE sku='TUNVN-73' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Microsoft 365 Admin account active for 12 months
- Add up to 5 family members
- Format: Email | Password | Recovery email

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Do not change the password or the recovery email
- Do not add extra security to the account: the system logs in every month to renew it

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Log in at office.com with the email and password from your order
2. If asked for a code, open axvara.tech/go/mail-fvia to read the recovery email inbox
3. Add up to 5 family members from the subscription settings' WHERE sku='TUNVN-73' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun ChatGPT Plus 1 bulan berbasis Gmail, berlangganan via Google Pay
- Format: Gmail | Password | Kode 2FA

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Amankan akun sendiri setelah login (ganti password dan 2FA)

Garansi:
- Garansi 1x24 jam sejak pesanan dikirim.', admin_activation='1. Login Gmail dengan email dan password dari pesanan
2. Saat diminta kode 2FA, buka axvara.tech/go/otp-2fa, tempel kode 2FA dari pesanan, lalu salin kode 6 digit yang muncul
3. Buka chatgpt.com lalu pilih Continue with Google memakai Gmail tersebut
4. Ganti password dan 2FA Gmail agar akun aman' WHERE sku='TUNVN-83' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- ChatGPT Plus 1-month account on Gmail, subscribed via Google Pay
- Format: Gmail | Password | 2FA key

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Secure the account yourself after logging in (change the password and 2FA)

Warranty:
- 24-hour warranty from delivery.', admin_activation_en='1. Log in to Gmail with the email and password from your order
2. When asked for a 2FA code, open axvara.tech/go/otp-2fa, paste the 2FA key from your order, then copy the 6-digit code shown
3. Open chatgpt.com and choose Continue with Google with that Gmail
4. Change the Gmail password and 2FA to secure the account' WHERE sku='TUNVN-83' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun ChatGPT Business siap pakai, masa aktif 1 bulan
- Format: Email | Password | Kode 2FA

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Jangan menambahkan anggota ke workspace: akun akan dikeluarkan tanpa refund
- Segera ganti password dan 2FA setelah login agar akun aman

Garansi:
- Garansi 1x24 jam sejak pesanan dikirim.', admin_activation='1. Buka chatgpt.com lalu login dengan email dan password dari pesanan
2. Saat diminta kode 2FA, buka axvara.tech/go/otp-2fa, tempel kode 2FA dari pesanan, lalu salin kode 6 digit yang muncul
3. Masukkan kode 6 digit tersebut di ChatGPT
4. Ganti password dan atur ulang 2FA agar akun aman' WHERE sku='TUNVN-86' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-made ChatGPT Business account, active for 1 month
- Format: Email | Password | 2FA key

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Do not add members to the workspace: the account will be removed with no refund
- Change the password and 2FA right after logging in to secure the account

Warranty:
- 24-hour warranty from delivery.', admin_activation_en='1. Open chatgpt.com and log in with the email and password from your order
2. When asked for a 2FA code, open axvara.tech/go/otp-2fa, paste the 2FA key from your order, then copy the 6-digit code shown
3. Enter that 6-digit code in ChatGPT
4. Change the password and reset 2FA to secure the account' WHERE sku='TUNVN-86' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- CapCut Pro Individual 1 bulan (29 sampai 30 hari)
- 650 kredit AI
- Format: Email | Password CapCut | Password email

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Login maksimal di 2 perangkat
- Error karena batas perangkat atau keamanan akun tidak termasuk garansi

Garansi:
- Garansi penuh selama masa aktif, selama aturan pakai dipatuhi.', admin_activation='1. Buka aplikasi atau web CapCut
2. Login dengan email dan password CapCut dari pesanan
3. Bila diminta kode verifikasi, login ke email memakai password email dari pesanan' WHERE sku='TUNVN-87' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- CapCut Pro Individual for 1 month (29 to 30 days)
- 650 AI credits
- Format: Email | CapCut password | Email password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Log in on 2 devices at most
- Errors from the device limit or account security are not covered by the warranty

Warranty:
- Full warranty for the active period, as long as the usage rules are followed.', admin_activation_en='1. Open the CapCut app or website
2. Log in with the email and CapCut password from your order
3. If asked for a verification code, sign in to the email with the email password from your order' WHERE sku='TUNVN-87' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Muse AI siap pakai dengan 1 miliar token
- Format: Email | Link baca mailbox

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Tanpa garansi sama sekali: harga sangat murah, risiko ditanggung pembeli.', admin_activation='1. Buka muse.ai lalu login memakai email dari pesanan
2. Bila diminta kode, buka link baca mailbox dari pesanan untuk melihat kode login
3. Masukkan kode tersebut di Muse AI' WHERE sku='TUNVN-97' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-to-use Muse AI account with 1 billion tokens
- Format: Email | Mailbox link

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- No warranty at all: the price is very low and the risk is on the buyer.', admin_activation_en='1. Open muse.ai and log in with the email from your order
2. If asked for a code, open the mailbox link from your order to see the login code
3. Enter that code in Muse AI' WHERE sku='TUNVN-97' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Muse AI siap pakai dengan 31 miliar token
- Format: Email | Link baca mailbox

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Tanpa garansi sama sekali: harga sangat murah, risiko ditanggung pembeli.', admin_activation='1. Buka muse.ai lalu login memakai email dari pesanan
2. Bila diminta kode, buka link baca mailbox dari pesanan untuk melihat kode login
3. Masukkan kode tersebut di Muse AI' WHERE sku='TUNVN-98' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-to-use Muse AI account with 31 billion tokens
- Format: Email | Mailbox link

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- No warranty at all: the price is very low and the risk is on the buyer.', admin_activation_en='1. Open muse.ai and log in with the email from your order
2. If asked for a code, open the mailbox link from your order to see the login code
3. Enter that code in Muse AI' WHERE sku='TUNVN-98' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Grok Premium + Cursor Premium 1 bulan
- Format: Email | Password akun | Password email

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 3 hari sejak pesanan dikirim.', admin_activation='1. Buka axvara.tech/go/grok-web lalu login dengan email dan password dari pesanan
2. Install Cursor dari cursor.com lalu login dengan akun yang sama
3. Bila diminta kode verifikasi, login ke email memakai data dari pesanan' WHERE sku='TUNVN-99' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Grok Premium + Cursor Premium for 1 month
- Format: Email | Account password | Email password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 3-day warranty from delivery.', admin_activation_en='1. Open axvara.tech/go/grok-web and log in with the email and password from your order
2. Install Cursor from cursor.com and log in with the same account
3. If asked for a verification code, sign in to the email with the details from your order' WHERE sku='TUNVN-99' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Grok Premium + Cursor Premium 1 bulan
- Format: Email | Password akun | Password email

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 28 hari sejak pesanan dikirim.', admin_activation='1. Buka axvara.tech/go/grok-web lalu login dengan email dan password dari pesanan
2. Install Cursor dari cursor.com lalu login dengan akun yang sama
3. Bila diminta kode verifikasi, login ke email memakai data dari pesanan' WHERE sku='TUNVN-100' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Grok Premium + Cursor Premium for 1 month
- Format: Email | Account password | Email password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 28-day warranty from delivery.', admin_activation_en='1. Open axvara.tech/go/grok-web and log in with the email and password from your order
2. Install Cursor from cursor.com and log in with the same account
3. If asked for a verification code, sign in to the email with the details from your order' WHERE sku='TUNVN-100' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- License key HMA VPN untuk Android dan PC
- Masa aktif 30 hari
- Format: Key

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 25 hari sejak pesanan dikirim.', admin_activation='1. Install aplikasi HMA VPN di Android atau PC
2. Pilih opsi masuk dengan activation code / license key
3. Tempel key dari pesanan lalu aktifkan' WHERE sku='TUNVN-103' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- HMA VPN license key for Android and PC
- 30-day active period
- Format: Key

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 25-day warranty from delivery.', admin_activation_en='1. Install the HMA VPN app on Android or PC
2. Choose the option to sign in with an activation code / license key
3. Paste the key from your order and activate' WHERE sku='TUNVN-103' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Grok Premium + Cursor Premium 14 hari
- Format: Email | Password

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Untuk memakai Cursor, ganti email akun ke alamat Gmail

Garansi:
- Garansi 1 hari sejak pesanan dikirim.', admin_activation='1. Buka axvara.tech/go/grok-web lalu login dengan email dan password dari pesanan
2. Install Cursor dari cursor.com lalu login dengan akun yang sama
3. Bila diminta kode verifikasi, login ke email memakai data dari pesanan' WHERE sku='TUNVN-104' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Grok Premium + Cursor Premium for 14 days
- Format: Email | Password

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- To use Cursor, change the account email to a Gmail address

Warranty:
- 1-day warranty from delivery.', admin_activation_en='1. Open axvara.tech/go/grok-web and log in with the email and password from your order
2. Install Cursor from cursor.com and log in with the same account
3. If asked for a verification code, sign in to the email with the details from your order' WHERE sku='TUNVN-104' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Kupon Nord VPN 3 bulan, tanpa kartu
- Aktivasi dengan email milikmu

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi holding kupon 3 hari sejak pesanan dikirim.', admin_activation='1. Klik link kupon Nord dari pesanan
2. Masukkan alamat email milikmu
3. Masukkan kode OTP yang dikirim ke email tersebut
4. Buat password akun
5. Bila diminta data kartu untuk perpanjangan, klik Skip
6. Paket berhasil aktif' WHERE sku='TUNVN-105' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Nord VPN 3-month coupon, no card needed
- Activated with your own email

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 3-day coupon holding warranty from delivery.', admin_activation_en='1. Click the Nord coupon link from your order
2. Enter your email address
3. Enter the OTP sent to that email
4. Set your password
5. If asked for card details for renewal, click Skip
6. Your plan is activated' WHERE sku='TUNVN-105' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Nomor telepon sewa sekali pakai untuk menerima satu kode verifikasi
- Dikirim berupa link halaman nomor dan kode

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Pilih nomor operator Vinaphone
- Satu link hanya bisa menerima satu kode; nomor hanya bisa dipakai sekali', admin_activation='1. Buka layanan yang ingin diverifikasi sampai langkah memasukkan nomor telepon
2. Buka link dari pesanan, ketuk Get, lalu salin nomor telepon
3. Tempel nomor di layanan tersebut lalu ketuk Send code
4. Biarkan halaman link tetap terbuka; kode muncul otomatis, lalu salin dan masukkan ke layanan

Catatan:
- Bila halaman tidak sengaja tertutup, buka ulang link yang sama untuk melihat kode.' WHERE sku='TUNVN-110' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- One-time rental phone number that receives one verification code
- Delivered as a link to the number and code page

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- Choose a Vinaphone number
- Each link receives only one code; the number can be used once', admin_activation_en='1. Open the service you want to verify and go to the phone number step
2. Open the link from your order, tap Get, then copy the phone number
3. Paste the number into the service and tap Send code
4. Keep the link page open; the code appears automatically, then copy it into the service

Notes:
- If you close the page by accident, open the same link again to see your code.' WHERE sku='TUNVN-110' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Muse AI 1 miliar token berbasis Hotmail (cukup stabil)
- Format: API mail

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 2 hari sejak pesanan dikirim.', admin_activation='1. Buka muse.ai lalu login memakai email dari API mail pesanan
2. Untuk membaca kode login, salin seluruh API mail ke axvara.tech/go/mail-dongvan
3. Masukkan kode tersebut di Muse AI

Catatan:
- Panduan login bergambar: axvara.tech/go/muse-login' WHERE sku='TUNVN-111' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Muse AI account with 1 billion tokens on Hotmail (fairly stable)
- Format: API mail

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 2-day warranty from delivery.', admin_activation_en='1. Open muse.ai and log in with the email from the API mail in your order
2. To read the login code, paste the whole API mail into axvara.tech/go/mail-dongvan
3. Enter that code in Muse AI

Notes:
- Illustrated login guide: axvara.tech/go/muse-login' WHERE sku='TUNVN-111' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Muse AI 31 miliar token berbasis Hotmail (cukup stabil)
- Format: API mail

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 2 hari sejak pesanan dikirim.', admin_activation='1. Buka muse.ai lalu login memakai email dari API mail pesanan
2. Untuk membaca kode login, salin seluruh API mail ke axvara.tech/go/mail-dongvan
3. Masukkan kode tersebut di Muse AI

Catatan:
- Panduan login bergambar: axvara.tech/go/muse-login' WHERE sku='TUNVN-112' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Muse AI account with 31 billion tokens on Hotmail (fairly stable)
- Format: API mail

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 2-day warranty from delivery.', admin_activation_en='1. Open muse.ai and log in with the email from the API mail in your order
2. To read the login code, paste the whole API mail into axvara.tech/go/mail-dongvan
3. Enter that code in Muse AI

Notes:
- Illustrated login guide: axvara.tech/go/muse-login' WHERE sku='TUNVN-112' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Muse AI siap pakai dengan 25 sampai 28 miliar token
- Format: Email | Link baca mailbox

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Tanpa garansi sama sekali: harga sangat murah, risiko ditanggung pembeli.', admin_activation='1. Buka muse.ai lalu login memakai email dari pesanan
2. Bila diminta kode, buka link baca mailbox dari pesanan untuk melihat kode login
3. Masukkan kode tersebut di Muse AI' WHERE sku='TUNVN-114' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-to-use Muse AI account with 25 to 28 billion tokens
- Format: Email | Mailbox link

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- No warranty at all: the price is very low and the risk is on the buyer.', admin_activation_en='1. Open muse.ai and log in with the email from your order
2. If asked for a code, open the mailbox link from your order to see the login code
3. Enter that code in Muse AI' WHERE sku='TUNVN-114' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Link redeem resmi Google Gemini Plus, klaim ke akun Google milikmu sendiri.
- Masa aktif 6 bulan setelah berhasil diklaim.
- Penyimpanan cloud 400 GB untuk Google Drive, Google Photos & Gmail.
- Akses AI: Gemini 3.1 Pro, 3.5 Flash & 3.6 Flash, Gemini Omni 1.1 Flash.
- Mendukung Anti Gravity & Nano Banana 2.
- Bisa mengundang hingga 5 akun keluarga (storage 400 GB dipakai bersama).
- Bonus 250 poin Google Flow.
- Tanpa kartu kredit / tanpa metode pembayaran.

Proses & pengiriman:
- Link redeem dikirim melalui email dan tersedia di halaman pesanan setelah pembayaran terverifikasi.

Aturan pakai:
- Harap segera redeem setelah membeli, garansi hold link hanya 1 jam setelah pembelian.
- Satu link hanya untuk satu kali klaim pada satu akun Google. Setelah diklik dan diklaim, link terikat permanen ke akun tersebut.
- Klaim hanya pada akun yang memenuhi syarat / eligible, tanpa konflik Google One aktif.
- Pastikan sudah paham cara redeem-nya sebelum membeli.

Garansi:
- Link yang terbukti error atau expired sebelum digunakan dan dilaporkan dalam 1 jam setelah pembelian akan diganti.
- Link yang sudah terpakai, salah klaim ke akun yang salah, atau diuji coba dengan akun lain bersifat non-refundable dan tidak dapat diganti.
- Garansi hanya berlaku untuk validitas link saat diterima dan sebelum berhasil diklaim.
- Setelah link berhasil diklaim, tidak ada garansi masa aktif.
- Garansi tidak mencakup akun kembali ke free / penonaktifan paket, maupun perubahan kebijakan dari Google.', admin_activation='1. Login ke akun Google yang ingin diaktifkan di perangkat atau browser.
2. Buka link redeem resmi yang kami kirim ke email dan halaman pesanan kamu.
3. Klik "Claim Offer" / "Start Subscription" lalu ikuti langkahnya sampai status Plus aktif.
4. Gemini Plus 6 bulan langsung aktif, tanpa kartu kredit atau metode pembayaran.' WHERE sku='TUNVN-115' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Official Google Gemini Plus redeem link, claim to your own Google account.
- 6 months active period after successful claim.
- 400 GB cloud storage for Google Drive, Google Photos & Gmail.
- AI access: Gemini 3.1 Pro, 3.5 Flash & 3.6 Flash, Gemini Omni 1.1 Flash.
- Supports Anti Gravity & Nano Banana 2.
- Can invite up to 5 family accounts (400 GB storage shared).
- Bonus 250 Google Flow points included.
- No credit card / no payment method required.

Process & delivery:
- Redeem link is sent by email and available on the order page after payment is verified.

Usage rules:
- Please redeem immediately after purchase; link hold warranty is only 1 hour after purchase.
- One link is for one-time claim on one Google account only. Once clicked and claimed, it binds permanently to that account.
- Claim only on eligible accounts without active Google One conflict.
- Make sure you understand how to redeem before buying.

Warranty:
- Links proven to be in error or expired before use and reported within 1 hour after purchase will be replaced.
- Used links, claims to the wrong account, or links tested with another account are non-refundable and cannot be replaced.
- Warranty only covers link validity when received and before successful claim.
- After the link is successfully claimed, there is no active-period warranty.
- Warranty does not cover accounts returning to free / plan deactivation, or policy changes from Google.', admin_activation_en='1. Sign in to the Google account you want to activate on your device or browser.
2. Open the official redeem link we sent to your email and order page.
3. Click "Claim Offer" / "Start Subscription" and follow the steps until Plus status is active.
4. Your 6-month Gemini Plus is activated immediately, no credit card or payment method required.' WHERE sku='TUNVN-115' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Link redeem Spotify Premium 3 bulan (dikirim link redeem saja)
- Masa aktif 3 bulan setelah aktivasi
- Untuk akun baru atau akun yang belum pernah Premium
- Bisa diaktifkan dari negara mana pun

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Wajib menambahkan kartu saat aktivasi

Garansi:
- Garansi holding 24 jam sejak link dikirim.', admin_activation='1. Login akun Spotify milikmu di browser
2. Buka link redeem dari pesanan
3. Tambahkan kartu pembayaran lalu konfirmasi untuk mengaktifkan Premium

Catatan:
- Matikan perpanjangan otomatis sebelum masa aktif habis bila tidak ingin ditagih.' WHERE sku='TUNVN-116' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Spotify Premium 3-month redeem link (only the redeem link is delivered)
- 3 months of Premium after activation
- For new accounts or accounts that have never had Premium
- Can be activated from any country

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Usage rules:
- A card must be added during activation

Warranty:
- 24-hour holding warranty from delivery.', admin_activation_en='1. Log in to your own Spotify account in a browser
2. Open the redeem link from your order
3. Add a payment card and confirm to activate Premium

Notes:
- Turn off auto-renewal before the period ends if you do not want to be charged.' WHERE sku='TUNVN-116' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Akun Grammarly Pro jadi, masa aktif 12 bulan
- Format: Email | Password Grammarly | Mail API

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi 10 hari sejak pesanan dikirim.', admin_activation='1. Buka grammarly.com lalu login dengan email dan password Grammarly dari pesanan
2. Bila diminta kode, salin seluruh Mail API dari pesanan ke axvara.tech/go/mail-dongvan untuk membaca inbox
3. Masukkan kode verifikasi di Grammarly' WHERE sku='TUNVN-117' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-made Grammarly Pro account, active for 12 months
- Format: Email | Grammarly password | Mail API

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- 10-day warranty from delivery.', admin_activation_en='1. Open grammarly.com and log in with the email and Grammarly password from your order
2. If asked for a code, paste the whole Mail API from your order into axvara.tech/go/mail-dongvan to read the inbox
3. Enter the verification code in Grammarly' WHERE sku='TUNVN-117' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

-- AIVault
UPDATE products SET description='Google Gemini Plus 6 bulan lewat link redeem resmi ke akun Google milikmu sendiri, dengan storage 400 GB dan tanpa kartu kredit.
- Masa aktif 6 bulan setelah diklaim
- Bisa undang hingga 5 akun keluarga
- Storage 400 GB untuk Drive, Photos & Gmail
- Tanpa kartu kredit / metode pembayaran

Detail benefit, syarat, dan cara aktivasi mengikuti varian yang dipilih.', updated_at=datetime('now') WHERE aivault_family='gemini' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Google Gemini Plus for 6 months via an official redeem link to your own Google account, with 400 GB storage and no credit card required.
- 6-month active period after claiming
- Invite up to 5 family accounts
- 400 GB storage for Drive, Photos & Gmail
- No credit card / payment method required

Benefit details, terms, and activation steps follow the selected variant.' WHERE aivault_family='gemini' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Notion Education Plus 12 bulan dengan email edu khusus, sudah aktif tanpa kartu. Cocok untuk catatan, dokumen, dan kolaborasi workspace dengan Notion AI.
- Masa aktif 12 bulan (1 tahun penuh)
- Unlimited blocks, pages, dan upload file
- Notion AI dengan model GPT-5, Sonnet, Opus, Gemini, Grok, DeepSeek
- Tanpa kartu, 100% sudah aktif', updated_at=datetime('now') WHERE aivault_family='notion' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Notion Education Plus for 12 months with a dedicated edu email, pre-activated with no card. Great for notes, docs and workspace collaboration with Notion AI.
- 12-month active period (full 1 year)
- Unlimited blocks, pages and file uploads
- Notion AI with GPT-5, Sonnet, Opus, Gemini, Grok, DeepSeek models
- No card required, 100% pre-activated' WHERE aivault_family='notion' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Udemy Personal Plan 1 bulan: akses 26.000+ kursus pilihan dengan rating tinggi, akun privat dengan mailbox khusus.
- Topik programming, IT, AI, bisnis, desain, marketing, dan lainnya
- Sertifikat penyelesaian resmi
- Sudah aktif, tanpa kartu atau pengaturan tagihan', updated_at=datetime('now') WHERE aivault_family='udemy' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Udemy Personal Plan for 1 month: access to 26,000+ curated top-rated courses on a private account with a dedicated mailbox.
- Topics in programming, IT, AI, business, design, marketing and more
- Official certificates of completion
- Pre-activated, no card or billing setup required' WHERE aivault_family='udemy' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Adobe Express Premium lewat link promo resmi yang diaktifkan di akun Adobe milikmu, tanpa kartu.
- Adobe Firefly Generative AI (250+ kredit/bulan)
- 200 juta+ foto, video, dan musik Adobe Stock
- 25.000+ Adobe Fonts dan storage cloud 100 GB
- Bisa dipakai di web, iOS, dan Android dengan login yang sama', updated_at=datetime('now') WHERE aivault_family='adobe-express' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Adobe Express Premium via an official promo link activated on your own Adobe account, no card required.
- Adobe Firefly Generative AI (250+ credits/month)
- 200M+ Adobe Stock photos, videos and music
- 25,000+ Adobe Fonts and 100 GB cloud storage
- Works on web, iOS and Android with the same login' WHERE aivault_family='adobe-express' AND (description_en IS NULL OR description_en='');

UPDATE products SET description='Apple Music Individual 5 bulan lewat link aktivasi resmi ke akun Apple milikmu (khusus akun baru region India).
- Masa aktif 5 bulan
- Aktivasi di akun sendiri
- Wajib metode pembayaran UPI / kartu valid milik pembeli', updated_at=datetime('now') WHERE aivault_family='apple-music' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='Apple Music Individual for 5 months via an official activation link on your own Apple account (new Indian-region accounts only).
- 5-month active period
- Activated on your own account
- A valid UPI / card payment method from the buyer is required' WHERE aivault_family='apple-music' AND (description_en IS NULL OR description_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- Adobe Express Premium.
- Durasi 12 bulan.
- Aktivasi di akun Adobe milikmu (baru atau lama).
- Link promo resmi.
- Tanpa metode pembayaran / kartu (aktivasi 100% gratis).
- Bisa dipakai di web serta aplikasi iOS / Android dengan login yang sama.
- Premium penuh: Adobe Firefly Generative AI (250+ kredit/bulan), 200 juta+ foto, video & musik Adobe Stock, 25.000+ Adobe Fonts, storage cloud 100 GB.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Satu kali redeem per akun.
- Jika muncul error region / mismatch, sambungkan VPN Indonesia lalu coba lagi.
- Setelah 12 bulan paket berakhir otomatis tanpa tagihan; proyek dan file desainmu tetap aman.

Garansi:
- Garansi link 24 jam sejak pesanan dikirim.
- Tidak ada garansi setelah aktivasi.', admin_activation='1. Buka link promo dari pesanan di browser.
2. Sign in atau sign up dengan akun Adobe milikmu.
3. Klik redeem untuk mengaktifkan Premium.
4. Jika muncul error region / mismatch, sambungkan VPN Indonesia lalu ulangi.' WHERE sku='AV-service_1789191781' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Adobe Express Premium.
- Duration: 12 months.
- Activated on your own Adobe account (new or existing).
- Official promo link.
- No payment method / card required (100% free activation).
- Works on web plus the iOS / Android app with the same login.
- Full Premium unlocked: Adobe Firefly Generative AI (250+ credits/month), 200M+ Adobe Stock photos, videos & music, 25,000+ Adobe Fonts, 100 GB cloud storage.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- One redemption per account.
- If you encounter a region restriction or mismatch error, connect to an Indonesian VPN and try again.
- After 12 months the plan ends automatically with no auto-charge; your design projects and files remain safe.

Warranty:
- 24-hour link warranty from delivery.
- No warranty after activation.', admin_activation_en='1. Open the promo link from your order in a browser.
2. Sign in or sign up with your Adobe account.
3. Click redeem to activate Premium.
4. If you get a region restriction or mismatch error, connect to an Indonesian VPN and retry.' WHERE sku='AV-service_1789191781' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Apple Music Individual.
- Durasi 5 bulan.
- Aktivasi di akun Apple milikmu.
- Link aktivasi resmi.
- Khusus akun baru region India (gunakan VPN).
- Wajib metode pembayaran UPI / kartu yang valid untuk aktivasi (tanggung jawab pembeli; kami tidak menyediakan kartu atau UPI).

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Akun yang sudah pernah memakai trial Apple Music atau punya langganan aktif akan ditolak.
- Jika berada di luar India, gunakan VPN di browser untuk aktivasi.
- Perpanjangan otomatis ₹139/bulan setelah 5 bulan: batalkan dari Settings > Apple Account > Subscriptions sebelum masa aktif habis.

Garansi:
- Garansi hold link 24 jam sejak pesanan dikirim.
- Tidak ada garansi setelah aktivasi.', admin_activation='1. Sambungkan VPN India di browser bila kamu berada di luar India.
2. Klik link aktivasi dari pesanan.
3. Buat akun Apple region India lalu tambahkan metode pembayaran UPI / kartu yang valid.
4. Selesaikan aktivasi dan nikmati Apple Music selama 5 bulan.

Catatan:
- Batalkan perpanjangan otomatis dari Settings > Apple Account > Subscriptions sebelum 5 bulan berakhir bila tidak ingin ditagih ₹139/bulan.' WHERE sku='AV-service_1789191878' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Apple Music Individual.
- Duration: 5 months.
- Activated on your own Apple account.
- Official activation link.
- Only for fresh Indian-region accounts (use a VPN).
- A valid UPI / card payment method is needed for activation (buyer''s responsibility; we do not provide cards or UPI).

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- Accounts that already used an Apple Music trial or have an active subscription will be rejected.
- If you are outside India, use a VPN in the browser to activate.
- Auto-renews at ₹139/month after 5 months: cancel from Settings > Apple Account > Subscriptions before expiry.

Warranty:
- 24-hour link hold warranty from delivery.
- No warranty after activation.', admin_activation_en='1. Connect to an Indian VPN in your browser if you are outside India.
2. Click the activation link from your order.
3. Create an Indian-region Apple account and add a valid UPI / card payment method.
4. Complete activation and enjoy 5 months of Apple Music.

Notes:
- Cancel auto-renewal from Settings > Apple Account > Subscriptions before the 5 months end if you do not want to be charged ₹139/month.' WHERE sku='AV-service_1789191878' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Adobe Express Premium.
- Durasi 6 bulan.
- Aktivasi di akun Adobe milikmu (baru atau lama).
- Link promo resmi.
- Tanpa metode pembayaran / kartu (aktivasi 100% gratis).
- Pengguna Adobe Premium lama juga bisa redeem: tagihan bulanan dijeda selama 6 bulan.
- Bisa dipakai di web serta aplikasi iOS / Android dengan login yang sama.
- Premium penuh: Adobe Firefly Generative AI (250+ kredit/bulan), 200 juta+ foto, video & musik Adobe Stock, 25.000+ Adobe Fonts, storage cloud 100 GB.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Satu kali redeem per akun.
- Jika muncul error region / mismatch, sambungkan VPN Indonesia lalu coba lagi.
- Setelah 6 bulan paket berakhir otomatis tanpa tagihan; proyek dan file desainmu tetap aman.

Garansi:
- Garansi link 24 jam sejak pesanan dikirim.
- Tidak ada garansi setelah aktivasi.', admin_activation='1. Buka link promo dari pesanan di browser.
2. Sign in atau sign up dengan akun Adobe milikmu.
3. Klik redeem untuk mengaktifkan Premium.
4. Jika muncul error region / mismatch, sambungkan VPN Indonesia lalu ulangi.' WHERE sku='AV-service_adobe_express_6m' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Adobe Express Premium.
- Duration: 6 months.
- Activated on your own Adobe account (new or existing).
- Official promo link.
- No payment method / card required (100% free activation).
- Existing Adobe Premium users can also redeem: monthly billing is paused for 6 months.
- Works on web plus the iOS / Android app with the same login.
- Full Premium unlocked: Adobe Firefly Generative AI (250+ credits/month), 200M+ Adobe Stock photos, videos & music, 25,000+ Adobe Fonts, 100 GB cloud storage.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- One redemption per account.
- If you encounter a region restriction or mismatch error, connect to an Indonesian VPN and try again.
- After 6 months the plan ends automatically with no auto-charge; your design projects and files remain safe.

Warranty:
- 24-hour link warranty from delivery.
- No warranty after activation.', admin_activation_en='1. Open the promo link from your order in a browser.
2. Sign in or sign up with your Adobe account.
3. Click redeem to activate Premium.
4. If you get a region restriction or mismatch error, connect to an Indonesian VPN and retry.' WHERE sku='AV-service_adobe_express_6m' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Link redeem resmi Google Gemini Plus, klaim ke akun Google milikmu sendiri.
- Masa aktif 6 bulan setelah berhasil diklaim.
- Penyimpanan cloud 400 GB untuk Google Drive, Google Photos & Gmail.
- Akses AI: Gemini 3.1 Pro, 3.5 Flash & 3.6 Flash, Gemini Omni 1.1 Flash.
- Mendukung Anti Gravity & Nano Banana 2.
- Bisa mengundang hingga 5 akun keluarga (storage 400 GB dipakai bersama).
- Bonus 250 poin Google Flow.
- Tanpa kartu kredit / tanpa metode pembayaran.
- Semua link otomatis dan sudah dicek bot 100% valid sebelum dikirim.

Proses & pengiriman:
- Link redeem dikirim melalui email dan tersedia di halaman pesanan setelah pembayaran terverifikasi.

Aturan pakai:
- Harap segera redeem setelah membeli.
- Satu link hanya untuk satu kali percobaan klaim pada satu akun Google. Setelah diklik dan diklaim, link terikat permanen ke akun tersebut.
- Klaim hanya pada akun fresh / eligible tanpa konflik Google One aktif.
- Pastikan sudah paham cara redeem-nya sebelum membeli.

Garansi:
- Garansi 24 jam: link mati yang dilaporkan dalam 24 jam setelah pembelian akan diganti.
- Link yang sudah terpakai atau salah uji coba ke akun lain bersifat non-refundable dan tidak dapat diganti.
- Garansi hanya berlaku untuk validitas link saat diterima dan sebelum berhasil diklaim.
- Setelah link berhasil diklaim, tidak ada garansi masa aktif.
- Garansi tidak mencakup akun kembali ke free / penonaktifan paket, maupun perubahan kebijakan dari Google.', admin_activation='1. Login ke akun Google yang ingin diaktifkan di perangkat atau browser.
2. Buka link redeem resmi yang kami kirim ke email dan halaman pesanan kamu.
3. Klik "Claim Offer" / "Start Subscription" lalu ikuti langkahnya sampai status Plus aktif.
4. Gemini Plus 6 bulan langsung aktif, tanpa kartu kredit atau metode pembayaran.' WHERE sku='AV-service_gemini_plus_6m' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Official Google Gemini Plus redeem link, claim to your own Google account.
- 6 months active period after successful claim.
- 400 GB cloud storage for Google Drive, Google Photos & Gmail.
- AI access: Gemini 3.1 Pro, 3.5 Flash & 3.6 Flash, Gemini Omni 1.1 Flash.
- Supports Anti Gravity & Nano Banana 2.
- Can invite up to 5 family accounts (400 GB storage shared).
- Bonus 250 Google Flow points included.
- No credit card / no payment method required.
- All links are automated and bot-checked for 100% validity before delivery.

Process & delivery:
- Redeem link is sent by email and available on the order page after payment is verified.

Usage rules:
- Please redeem immediately after purchase.
- Each redeem link is strictly for one activation attempt on one Google account. Once clicked and claimed, it binds permanently to that account.
- Claim only on fresh / eligible accounts without an active Google One conflict.
- Make sure you understand how to redeem before buying.

Warranty:
- 24-hour warranty: dead links reported within 24 hours of purchase will be replaced.
- Consumed or wrongly tested links are non-refundable and cannot be replaced.
- Warranty only covers link validity when received and before successful claim.
- After the link is successfully claimed, there is no active-period warranty.
- Warranty does not cover accounts returning to free / plan deactivation, or policy changes from Google.', admin_activation_en='1. Sign in to the Google account you want to activate on your device or browser.
2. Open the official redeem link we sent to your email and order page.
3. Click "Claim Offer" / "Start Subscription" and follow the steps until Plus status is active.
4. Your 6-month Gemini Plus is activated immediately, no credit card or payment method required.' WHERE sku='AV-service_gemini_plus_6m' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Notion Education Plus Plan.
- Durasi 12 bulan (1 tahun penuh).
- Akses: email edu khusus + link inbox webmail.
- Fitur: unlimited blocks & pages, unlimited upload file.
- Notion AI: model GPT-5, Sonnet, Opus, Gemini, Grok, DeepSeek.
- Tanpa kartu, 100% sudah aktif.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Jangan mengganti email utama akun agar lisensi Education Plus tetap aktif.
- Kamu bisa mengundang email pribadimu ke workspace sebagai Member / Admin.
- Simpan (bookmark) link inbox webmail di browser untuk login berikutnya bila kamu logout.

Garansi:
- Garansi hold / login pertama 24 jam sejak pesanan dikirim.', admin_activation='1. Buka notion.so/login di browser atau aplikasi Notion Desktop/Mobile.
2. Masukkan email edu dari pesanan lalu klik Continue with Email.
3. Buka link inbox dari pesanan di tab browser baru.
4. Cek kode login / OTP dari Notion di inbox, lalu masukkan kodenya atau klik magic link login.
5. Selesai, Notion Education Plus 12 bulan sudah aktif dan siap dipakai.' WHERE sku='AV-service_notion_plus' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Notion Education Plus Plan.
- Duration: 12 months (full 1 year).
- Access: dedicated edu email + webmail inbox link.
- Features: unlimited blocks & pages, unlimited file uploads.
- Notion AI: GPT-5, Sonnet, Opus, Gemini, Grok, DeepSeek models.
- No card required, 100% pre-activated.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- Do NOT change the primary email of the account, to preserve the Education Plus license.
- You can invite your personal email account to your workspace as a Member / Admin.
- Bookmark your webmail inbox link in your browser for future logins if you ever log out.

Warranty:
- 24-hour hold / first-login warranty from delivery.', admin_activation_en='1. Open notion.so/login in a browser or the Notion Desktop/Mobile app.
2. Enter the edu email from your order and click Continue with Email.
3. Open the inbox link from your order in a new browser tab.
4. Check the inbox for the login code / OTP from Notion, then enter the code or click the magic login link.
5. Done, your 12-month Notion Education Plus is active and ready to use.' WHERE sku='AV-service_notion_plus' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

UPDATE product_variants SET admin_terms='Detail paket:
- Udemy Personal Plan.
- Durasi 1 bulan.
- Akses: email privat | link inbox.
- 26.000+ kursus pilihan dengan rating tinggi.
- Topik: programming, IT, AI, bisnis, desain, marketing, dan lainnya.
- Sudah aktif: tanpa kartu atau pengaturan tagihan.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Akun 100% privat dengan mailbox khusus.
- Simpan (bookmark) link inbox untuk verifikasi OTP berikutnya.
- Selesaikan kursus untuk mendapatkan sertifikat penyelesaian resmi.

Garansi:
- Garansi hold / login pertama 24 jam sejak pesanan dikirim.', admin_activation='1. Buka udemy.com di browser atau aplikasi Udemy.
2. Klik Log In lalu masukkan email dari pesanan.
3. Buka link inbox dari pesanan di tab browser untuk melihat email masuk.
4. Salin kode OTP / verifikasi login dari Udemy lalu verifikasi.
5. Selesai, selamat belajar dari para ahli sesuai ritmemu.' WHERE sku='AV-service_udemy_1m' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- Udemy Personal Plan.
- Duration: 1 month.
- Access: private email | inbox link.
- 26,000+ curated top-rated courses.
- Topics: programming, IT, AI, business, design, marketing and more.
- Pre-activated: no card or billing setup required.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- 100% private account with a dedicated mailbox.
- Bookmark your inbox link for any future OTP verifications.
- Complete courses to earn official certificates of completion.

Warranty:
- 24-hour hold / first-login warranty from delivery.', admin_activation_en='1. Visit udemy.com in your browser or the Udemy app.
2. Click Log In and enter the email from your order.
3. Open the inbox link from your order in a browser tab to view incoming mail.
4. Copy the login OTP / verification code sent by Udemy and verify.
5. You are in, enjoy learning from industry experts at your own pace.' WHERE sku='AV-service_udemy_1m' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';
