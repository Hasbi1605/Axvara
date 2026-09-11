-- 0028_unexclude_canva_gemini.sql — Urungkan pengecualian Canva & Gemini WR.
--
-- Konteks 2026-09-11: pemilik meminta Canva + Gemini dari WR tetap disync,
-- dikelola sendiri (aktif/nonaktif) dari halaman produk. Anti-bentrok dengan
-- produk manual sendiri dijamin di application layer (sync.ts):
--   - slug WR dapat suffix "-wr" bila slug dasar dipakai produk manual;
--   - nama katalog WR selalu "<nama> (WR)".
-- Registry excluded lama (axvara_product_id NULL) dipasangkan katalog saat
-- sync berikutnya (cabang linked<=0 di upsertWrProduct) — migrasi ini hanya
-- menghapus aturannya, bukan membuat katalog (idempoten, aman diulang).

DELETE FROM wr_exclusions WHERE pattern LIKE '%canva%' OR pattern LIKE '%gemini%';

UPDATE wr_products
SET is_excluded = 0, exclude_reason = NULL, updated_at = datetime('now')
WHERE is_excluded = 1
  AND (lower(wr_product_name) LIKE '%canva%' OR lower(wr_product_name) LIKE '%gemini%');
