-- 0042_canva_invite_terms.sql — S&K + cara aktivasi Canva Pro / Premium (non-WR).
--
-- Permintaan owner (2026-09-24): Canva non-WR dikirim sebagai undangan lewat
-- email, dan pembeli wajib memakai email aktif — hanya itu. Ditulis di
-- deskripsi produk (milik admin) dengan judul "Syarat & Ketentuan:" /
-- "Cara Aktivasi:", jadi tampil di kartu S&K PDP dan tetap bisa diubah admin
-- dari kolom Deskripsi.
--
-- Guard: hanya berlaku bila deskripsi masih persis hasil migrasi 0040 (isi
-- produksi saat ditulis), sehingga suntingan admin sesudahnya aman.
-- Idempoten: jalan ulang tidak mengubah apa pun.

UPDATE products SET description = 'Canva Pro membuka fitur premium Canva untuk desain yang lebih cepat dan tampak profesional, dari konten media sosial, presentasi, poster, dan CV hingga kebutuhan bisnis dan proyek kreatif lainnya.

- Jutaan template, elemen, foto, video, dan font premium
- Background Remover sekali klik, Magic Resize, dan fitur AI Magic Studio
- Brand Kit untuk logo, font, dan warna brand, plus export desain berkualitas tinggi

Syarat & Ketentuan:
- Undangan Canva dikirim lewat email
- Pastikan email yang kamu isi saat checkout aktif

Cara Aktivasi:
- Buka email undangan dari Canva, lalu terima undangannya', updated_at = datetime('now')
  WHERE slug = 'canva-premium' AND source = 'manual'
    AND description = 'Canva Pro membuka fitur premium Canva untuk desain yang lebih cepat dan tampak profesional, dari konten media sosial, presentasi, poster, dan CV hingga kebutuhan bisnis dan proyek kreatif lainnya.

- Jutaan template, elemen, foto, video, dan font premium
- Background Remover sekali klik, Magic Resize, dan fitur AI Magic Studio
- Brand Kit untuk logo, font, dan warna brand, plus export desain berkualitas tinggi';
