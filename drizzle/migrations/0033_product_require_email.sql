-- 0033_product_require_email.sql — Toggle email wajib per produk.
--
-- Masalah (uji live WR 2026-09-16): produk WR tipe Invite/Link WAJIB kirim
-- email_invite — tanpa email, WR 422 dan retry tidak sembuh. Email checkout
-- selama ini opsional di semua kanal, sehingga order Invite tanpa email bisa
-- lunas lalu macet di WR.
--
-- Desain (keputusan owner 2026-09-16):
-- - products.require_email (0/1, default 0): toggle manual untuk produk
--   non-WR masa depan (e-book, lisensi, akun). Diatur dari editor admin.
-- - Varian WR tipe Invite/Link OTOMATIS butuh email (dari wr_type, tanpa
--   setting) — lihat needsEmailForVariant di delivery-class.ts.
-- - Email SELALU diminta SEBELUM bayar (validasi checkout/API/bot), bukan
--   sesudah: order lunas tanpa email = macet di WR + komplain.
--
-- Idempoten: pola 0031 (ALTER langsung; jalur CI mencatat migrasi).

ALTER TABLE products ADD COLUMN require_email INTEGER NOT NULL DEFAULT 0
  CHECK (require_email IN (0, 1));

-- Email pembeli Telegram yang tersimpan (diisi sekali via alur email_for:,
-- dipakai ulang untuk order Invite/Link berikutnya tanpa tanya ulang).
ALTER TABLE telegram_users ADD COLUMN buyer_email TEXT;
