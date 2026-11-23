-- 0160_tunvn_copilot_copy.sql — deskripsi ID/EN + S&K/cara aktivasi Microsoft Copilot Premium (TUNVN #122).
--
-- Permintaan owner 23 Nov 2026: melengkapi deskripsi, S&K, dan cara aktivasi
-- produk Microsoft Copilot Premium (`microsoft-copilot-tunvn`, varian `TUNVN-122`)
-- yang sudah live berdasarkan deskripsi API supplier TUNVN GET /api/products #122
-- dan bukti format hasil pembelian aktual (5 bagian dipisahkan `|`):
--   Email Hotmail | Password | Refresh Token | Client ID | Email pemulihan
--   (Recovery mail site: fviainboxes.com → axvara.tech/go/mail-fvia;
--    4 bagian pertama adalah format OAuth API mail → axvara.tech/go/mail-dongvan).
-- Aman/idempoten:
-- - shortlink INSERT OR IGNORE;
-- - deskripsi produk hanya menimpa kosong, template default, atau salinan singkat 0158
--   (suntingan admin setelahnya tetap aman);
-- - salinan varian hanya mengisi kolom ID/EN yang masih kosong; bekerja pada produk aktif.

INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('mail-fvia', 'https://fviainboxes.com/', 'Mailbox email pemulihan Microsoft 365 (TUNVN)'),
  ('mail-dongvan', 'https://dongvanfb.net/read_mail_box/', 'Baca mailbox API mail (TUNVN Grammarly/Muse)');

UPDATE products SET
  description='Akun Microsoft Copilot Premium siap pakai selama 1 bulan untuk akses fitur AI Microsoft di web dan aplikasi Copilot.
- Akun jadi, langsung login
- Masa aktif 1 bulan
- Dikirim otomatis setelah pembayaran
- Garansi penuh selama masa aktif',
  updated_at=datetime('now')
WHERE slug='microsoft-copilot-tunvn'
  AND tunvn_family='microsoft-copilot'
  AND archived_at IS NULL
  AND (
    description IS NULL
    OR description=''
    OR description='Akses Microsoft Copilot Premium selama 1 bulan. Paket ini termasuk garansi penuh selama masa aktif.'
    OR substr(description, -86)='Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'
  );

UPDATE products SET
  description_en='Ready-to-use Microsoft Copilot Premium account for 1 month with access to Microsoft AI features on the web and Copilot apps.
- Ready-made account, log in right away
- 1-month active period
- Delivered automatically after payment
- Full warranty for the active period',
  updated_at=datetime('now')
WHERE slug='microsoft-copilot-tunvn'
  AND tunvn_family='microsoft-copilot'
  AND archived_at IS NULL
  AND (
    description_en IS NULL
    OR description_en=''
    OR description_en='Get Microsoft Copilot Premium for 1 month. This plan includes full warranty coverage throughout the subscription period.'
  );

UPDATE product_variants SET
  admin_terms='Detail paket:
- Akun Microsoft Copilot Premium siap pakai, masa aktif 1 bulan
- Format data pesanan dipisahkan tanda | (5 bagian): Email Hotmail | Password | Token | Client ID | Email pemulihan

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan.

Garansi:
- Garansi penuh selama masa aktif (1 bulan).',
  admin_activation='1. Buka copilot.microsoft.com atau aplikasi Microsoft Copilot lalu login dengan Email Hotmail (bagian ke-1) dan Password (bagian ke-2) dari pesanan
2. Bila diminta kode verifikasi ke email pemulihan, buka axvara.tech/go/mail-fvia lalu masukkan alamat email pemulihan (bagian paling akhir) untuk membaca inbox
3. Masukkan kode verifikasi tersebut untuk menyelesaikan login, lalu Microsoft Copilot Premium siap digunakan

Catatan:
- Kode panjang di tengah (Token dan Client ID) adalah data API mail dan tidak perlu dimasukkan saat login ke Copilot
- Bila perlu membaca inbox email utama lewat API mail, salin 4 bagian pertama (Email|Password|Token|Client ID, tanpa email pemulihan) ke axvara.tech/go/mail-dongvan',
  updated_at=datetime('now')
WHERE sku='TUNVN-122'
  AND tunvn_source_product_id=122
  AND product_id IN (
    SELECT id FROM products
    WHERE slug='microsoft-copilot-tunvn'
      AND tunvn_family='microsoft-copilot'
      AND archived_at IS NULL
  )
  AND COALESCE(admin_terms,'')=''
  AND COALESCE(admin_activation,'')='';

UPDATE product_variants SET
  admin_terms_en='Package details:
- Ready-to-use Microsoft Copilot Premium account, active for 1 month
- Order data format separated by | (5 parts): Hotmail Email | Password | Token | Client ID | Recovery email

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page.

Warranty:
- Full warranty for the active period (1 month).',
  admin_activation_en='1. Open copilot.microsoft.com or the Microsoft Copilot app and log in with the Hotmail Email (part 1) and Password (part 2) from your order
2. If asked for a verification code sent to the recovery email, open axvara.tech/go/mail-fvia and enter the recovery email address (the last part) to read the inbox
3. Enter the verification code to finish logging in, and Microsoft Copilot Premium is ready to use

Notes:
- The long code in the middle (Token and Client ID) is API mail data and is not needed when logging in to Copilot
- If you need to read the main email inbox via API mail, paste the first 4 parts (Email|Password|Token|Client ID, without the recovery email) into axvara.tech/go/mail-dongvan',
  updated_at=datetime('now')
WHERE sku='TUNVN-122'
  AND tunvn_source_product_id=122
  AND product_id IN (
    SELECT id FROM products
    WHERE slug='microsoft-copilot-tunvn'
      AND tunvn_family='microsoft-copilot'
      AND archived_at IS NULL
  )
  AND COALESCE(admin_terms_en,'')=''
  AND COALESCE(admin_activation_en,'')='';
