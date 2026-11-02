-- 0091_jaspay_max_quantity.sql — Batas qty Jaspay per varian (WR3).
--
-- Jaspay (made-by-order WR) membawa max_quantity per produk yang WAJIB
-- ditegakkan server-side sebelum quote/order. Satu-satunya delta skema WR3:
-- kolom nullable ini. NULL = bukan-Jaspay/legacy (tanpa cap, perilaku lama
-- tak berubah). Nilai Jaspay valid >= 1; sync menolak (fail-closed, bukan
-- unlimited) bila max_quantity upstream invalid/missing.
-- CHECK: NULL atau >= 1 (0 dan negatif ditolak).

ALTER TABLE wr_variants ADD COLUMN wr_max_quantity INTEGER
  CHECK (wr_max_quantity IS NULL OR wr_max_quantity >= 1);
