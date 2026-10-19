-- 0071_disney_login_shortlink.sql — Seed shortlink go/disney-login yang
-- tertinggal di D1 produksi (2026-10-19).
--
-- Akar 404 axvara.tech/go/disney-login: slug ditambahkan ke migrasi 0056 +
-- schema + dev-fallback (commit 2e68bb1), tetapi migrasi 0056 SUDAH tercatat
-- diterapkan di D1 produksi SEBELUM baris itu ada — dan CI ("No migrations
-- to apply") tidak menjalankan ulang file migrasi lama yang diubah. Maka
-- seed WAJIB lewat file migrasi BARU agar ikut diterapkan.
--
-- INSERT OR IGNORE: idempoten, aman dijalankan ulang bila prod sudah di-seed
-- manual via admin.
INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('disney-login', '/artikel/cara-login-disney-setelah-order-di-axvara', 'Panduan login Disney+ AXVARA');
