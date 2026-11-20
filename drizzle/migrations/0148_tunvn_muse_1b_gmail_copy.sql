-- 0148_tunvn_muse_1b_gmail_copy.sql — koreksi salinan varian Muse AI 1B garansi 2 hari (TUNVN #111).
--
-- Permintaan owner 20 Nov 2026 (screenshot bot TUNVN): #111 "MUSE AI 1B - GMAIL (W2D)"
-- kini akun Gmail, format Mail | Password | 2FA, garansi 2 hari, panduan login
-- Drive 1v95Q95…, kode 2FA via 2fa.live. Salinan lama (0127) masih Hotmail/API mail.
-- Owner meminta ditimpa, jadi UPDATE tanpa syarat kolom kosong; hanya SKU TUNVN-111.
-- Revisi owner di sesi yang sama: deskripsi induk Muse AI (dipakai semua varian)
-- diringkas menjadi poin-poin seperti produk lain (ID + EN), hanya slug induk Muse.
-- Shortlink baru: INSERT OR IGNORE; `otp-2fa` (2fa.live) sudah ada.

INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('muse-login-gmail', 'https://drive.google.com/file/d/1v95Q95v2jB8LkWLwQlw3WTwO7U3Ma2d4/view?usp=drivesdk', 'Panduan login Muse AI Gmail (TUNVN)');

UPDATE product_variants SET
  admin_terms='Detail paket:
- Akun Muse AI 1 miliar token berbasis Gmail (sangat stabil)
- Format: Email | Password | Kode 2FA

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Aturan pakai:
- Login hanya memakai email, password, dan kode 2FA dari pesanan.
- Jangan mengganti email, password, atau 2FA akun selama masa garansi.

Garansi:
- Garansi 2 hari sejak pesanan dikirim.',
  admin_terms_en='Package details:
- Muse AI account with 1 billion tokens on Gmail (very stable)
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
WHERE sku='TUNVN-111';

UPDATE products SET
  description='AI agent otonom dari Meta (pembuat WhatsApp, Instagram, dan Threads) untuk riset, coding, analisis, serta konten dan promosi media sosial.
- Multimodal: baca teks, gambar, video, dan audio; bisa generate gambar dan video
- VPS bawaan (2 vCPU, RAM ±7,7 GB, storage 100 GB) untuk tugas 24 jam
- Browser bawaan dan kendali/chat langsung lewat WhatsApp
- Konektor Google Workspace, GitHub, Canva, Instagram, Threads, dan lainnya
- Akun siap pakai, tanpa kartu kredit dan tanpa VPN',
  description_en='Autonomous AI agent from Meta (maker of WhatsApp, Instagram, and Threads) for research, coding, analysis, and social media content and promotion.
- Multimodal: reads text, images, video, and audio; generates images and video
- Built-in VPS (2 vCPU, ±7.7 GB RAM, 100 GB storage) for 24-hour tasks
- Built-in browser plus direct control/chat via WhatsApp
- Connectors for Google Workspace, GitHub, Canva, Instagram, Threads, and more
- Ready-to-use account, no credit card and no VPN needed',
  updated_at=datetime('now')
WHERE slug='muse-ai-1-miliar-token';
