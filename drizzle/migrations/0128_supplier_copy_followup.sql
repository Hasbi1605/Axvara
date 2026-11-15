-- 0128_supplier_copy_followup.sql — lanjutan 0127 (keputusan owner 15 Nov 2026 malam).
--
-- 1. ChatGPT Plus AIVault (AV-service_chatgpt_plus_1m): deskripsi + S&K + cara aktivasi
--    ID/EN dari materi supplier yang dikirim owner; hanya menimpa template / kolom kosong.
-- 2. Gemini Plus AIVault: hold link disamakan 1 jam seperti TUNVN dan varian manual.
--    Hanya menimpa bila teks masih persis hasil 0127 (suntingan admin aman).
-- 3. Buff Muse TUNVN-BUFF-1B: kosongkan harga manual 1500 yang terkunci (bug simpan
--    ulang Produk) agar sinkron TUNVN berikutnya menghitung dari rumus. Harga tidak
--    diubah di sini; hanya bila nilainya masih 1500.

UPDATE products SET description='ChatGPT Plus 1 bulan penuh (30 hari) dengan akun 100% privat, langganan dibayar resmi via Apple Pay dan bergaransi penuh 30 hari.
- Akun privat, bukan sharing
- Fitur Plus lengkap: batas pesan tinggi, custom GPT, web search, dan code execution
- Akses Codex (verifikasi nomor dilakukan pembeli)
- Garansi penuh 30 hari', updated_at=datetime('now') WHERE aivault_family='chatgpt-plus' AND (description IS NULL OR description='' OR description LIKE '%Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.');
UPDATE products SET description_en='ChatGPT Plus for a full month (30 days) on a 100% private account, billed officially via Apple Pay with a full 30-day warranty.
- Private account, not shared
- Full Plus features: high message limits, custom GPTs, web search and code execution
- Codex access (phone verification done by the customer)
- Full 30-day warranty' WHERE aivault_family='chatgpt-plus' AND (description_en IS NULL OR description_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- ChatGPT Plus 1 bulan (30 hari penuh).
- Akun 100% privat.
- Langganan dibayar resmi via Apple Pay.
- Format pengiriman: Email | Password | Kode 2FA.
- Fitur Plus lengkap: batas pesan tinggi, custom GPT, web search, dan code execution.
- Akses Codex bebas dipakai (verifikasi nomor telepon dilakukan pembeli).
- Password dan 2FA sudah dicek bot sebelum dijual.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Aturan pakai:
- Dilarang memakai 9Router: garansi langsung hangus.
- Boleh mengganti 2FA, tetapi lakukan dengan hati-hati; akun terkunci karena kesalahan pembeli tidak termasuk garansi.
- Patuhi aturan ini agar layanan lancar tanpa kendala.

Garansi:
- Garansi penuh 30 hari.
- Garansi mencakup akun mati atau paket turun (package drop) dengan penggantian atau perbaikan.
- Akun yang sudah dikirim tidak dapat dikembalikan atau di-refund.', admin_activation='1. Buka chatgpt.com atau aplikasi resmi ChatGPT.
2. Klik Log in lalu masukkan email dan password dari pesanan.
3. Masukkan kode 2FA 6 digit dari kode 2FA pesanan lewat axvara.tech/go/otp-2fa atau Google Authenticator.
4. Selesai, akun ChatGPT Plus siap dipakai dengan privasi penuh.' WHERE sku='AV-service_chatgpt_plus_1m' AND COALESCE(admin_terms,'')='' AND COALESCE(admin_activation,'')='';
UPDATE product_variants SET admin_terms_en='Package details:
- ChatGPT Plus 1 month (full 30 days).
- 100% private account.
- Paid via official Apple Pay.
- Delivery format: Email | Password | 2FA key.
- Full Plus features: high message limits, custom GPTs, web search and code execution.
- Codex access freely usable (phone verification by the customer).
- Password and 2FA are bot-tested and verified before sale.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

Usage rules:
- 9Router is strictly prohibited: using it voids the warranty instantly.
- You may change 2FA, but do so carefully; user-induced lockout is not covered.
- Please adhere strictly to these terms for hassle-free service.

Warranty:
- Full 30-day warranty.
- Warranty covers dead accounts or package drops with replacement or fix.
- Delivered accounts cannot be returned or refunded.', admin_activation_en='1. Open chatgpt.com or the official ChatGPT app.
2. Click Log in and enter the email and password from your order.
3. Enter the 6-digit 2FA code generated from your 2FA key via axvara.tech/go/otp-2fa or Google Authenticator.
4. Done, enjoy ChatGPT Plus with full privacy.' WHERE sku='AV-service_chatgpt_plus_1m' AND COALESCE(admin_terms_en,'')='' AND COALESCE(admin_activation_en,'')='';

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
- Harap segera redeem setelah membeli, garansi hold link hanya 1 jam setelah pembelian.
- Satu link hanya untuk satu kali percobaan klaim pada satu akun Google. Setelah diklik dan diklaim, link terikat permanen ke akun tersebut.
- Klaim hanya pada akun fresh / eligible tanpa konflik Google One aktif.
- Pastikan sudah paham cara redeem-nya sebelum membeli.

Garansi:
- Link yang terbukti error atau expired sebelum digunakan dan dilaporkan dalam 1 jam setelah pembelian akan diganti.
- Link yang sudah terpakai, salah klaim ke akun yang salah, atau diuji coba dengan akun lain bersifat non-refundable dan tidak dapat diganti.
- Garansi hanya berlaku untuk validitas link saat diterima dan sebelum berhasil diklaim.
- Setelah link berhasil diklaim, tidak ada garansi masa aktif.
- Garansi tidak mencakup akun kembali ke free / penonaktifan paket, maupun perubahan kebijakan dari Google.' WHERE sku='AV-service_gemini_plus_6m' AND admin_terms='Detail paket:
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
- Garansi tidak mencakup akun kembali ke free / penonaktifan paket, maupun perubahan kebijakan dari Google.';
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
- Please redeem immediately after purchase; link hold warranty is only 1 hour after purchase.
- Each redeem link is strictly for one activation attempt on one Google account. Once clicked and claimed, it binds permanently to that account.
- Claim only on fresh / eligible accounts without an active Google One conflict.
- Make sure you understand how to redeem before buying.

Warranty:
- Links proven to be in error or expired before use and reported within 1 hour after purchase will be replaced.
- Used links, claims to the wrong account, or links tested with another account are non-refundable and cannot be replaced.
- Warranty only covers link validity when received and before successful claim.
- After the link is successfully claimed, there is no active-period warranty.
- Warranty does not cover accounts returning to free / plan deactivation, or policy changes from Google.' WHERE sku='AV-service_gemini_plus_6m' AND admin_terms_en='Package details:
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
- Warranty does not cover accounts returning to free / plan deactivation, or policy changes from Google.';

UPDATE product_variants SET tunvn_admin_price_idr=NULL, updated_at=datetime('now') WHERE sku='TUNVN-BUFF-1B' AND tunvn_admin_price_idr=1500;
