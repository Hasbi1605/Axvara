-- 0146_aivault_duolingo_copy.sql — salinan ID/EN produk + S&K varian Duolingo Super AIVault.
--
-- Permintaan owner 20 Nov 2026. Sumber: deskripsi produk StoreBat `duolingo-sb`
-- (gaya AXVARA) + aturan supplier AIVault dari GET /api/v1/products (garansi hold
-- 5 hari, satu kali redeem, akun tanpa Super berbayar aktif). Aman/idempoten:
-- deskripsi hanya menimpa template bawaan, *_en dan S&K hanya bila masih kosong.

UPDATE products SET description='Link redeem resmi Duolingo Super 12 bulan untuk belajar bahasa tanpa iklan dan nyawa tak terbatas di akun Duolingo sendiri.
- Masa aktif 12 bulan via link redeem resmi
- Tanpa kartu pembayaran
- Garansi hold link 5 hari', updated_at=datetime('now')
WHERE aivault_family IN ('duolingo','service:service_duolingo_12m')
  AND (description IS NULL OR description='' OR description IN (
    'Duolingo Super 12M. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.',
    'Duolingo Super. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.'));

UPDATE products SET description_en='Official 12-month Duolingo Super redeem link for ad-free language learning with unlimited hearts on your own Duolingo account.
- 12-month plan via official redeem link
- No payment card required
- 5-day link hold warranty', updated_at=datetime('now')
WHERE aivault_family IN ('duolingo','service:service_duolingo_12m') AND (description_en IS NULL OR description_en='');

UPDATE product_variants SET admin_terms='Detail paket:
- Link redeem resmi Duolingo Super 12 bulan untuk akun Duolingo sendiri.
- Tanpa kartu / metode pembayaran.

Proses & pengiriman:
- Dikirim otomatis setelah pembayaran terkonfirmasi; data pesanan tampil di halaman Lacak Pesanan dan email.

Cara aktivasi:
1. Login ke akun Duolingo di browser atau aplikasi (atau buat akun gratis di duolingo.com).
2. Buka link redeem yang dikirim, lalu klik "Redeem" / "Claim Offer".
3. Duolingo Super 12 bulan langsung aktif di semua perangkat.

Aturan pakai:
- Satu link hanya untuk satu kali aktivasi dan terikat permanen ke akun yang meng-klaim.
- Gunakan akun yang tidak sedang berlangganan Super berbayar.

Garansi:
- Garansi hold link 5 hari sejak pembelian: link mati/tidak valid yang dilaporkan dengan kode pesanan dalam 5 hari diganti.
- Link yang sudah dipakai atau salah dicoba tidak dapat direfund.
- Garansi gugur bila langganan dicabut resmi oleh Duolingo.', updated_at=datetime('now')
WHERE aivault_service_id='service_duolingo_12m' AND (admin_terms IS NULL OR admin_terms='');

UPDATE product_variants SET admin_terms_en='Package details:
- Official Duolingo Super 12-month redeem link for your own Duolingo account.
- No card / payment method required.

Process & delivery:
- Delivered automatically once payment is confirmed; your order details appear on the Track Order page and in your email.

How to activate:
1. Sign in to your Duolingo account in a browser or the app (or create a free account at duolingo.com).
2. Open the delivered redeem link and click "Redeem" / "Claim Offer".
3. Duolingo Super for 12 months is active right away on all devices.

Usage rules:
- Each link can be activated once and binds permanently to the claiming account.
- Use an account without an active paid Super subscription.

Warranty:
- 5-day link hold warranty from purchase: dead or invalid links reported with the order code within 5 days are replaced.
- Used or wrongly tested links are non-refundable.
- Warranty is void if Duolingo officially revokes the subscription.', updated_at=datetime('now')
WHERE aivault_service_id='service_duolingo_12m' AND (admin_terms_en IS NULL OR admin_terms_en='');
