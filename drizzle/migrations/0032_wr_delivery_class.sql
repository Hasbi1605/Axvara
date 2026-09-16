-- 0032_wr_delivery_class.sql — Kelas pengiriman WR: restock vs made_by_order.
--
-- Masalah: API WR tidak memberi penanda auto/manual. Satu-satunya kebenaran
-- adalah daftar admin WR (RESTOK 10 item vs MADE BY ORDER 7 item, 2026-09-16)
-- yang volatil dan jarang diupdate. Tanpa penanda, semua 87 varian WR
-- fulfillment_mode='manual' dan auto-order tidak bisa dibedakan per produk.
--
-- Desain hibrida (keputusan owner 2026-09-16):
-- - wr_delivery_class: 'restock' | 'made_by_order' | NULL (belum dikunci).
-- - wr_delivery_source: 'screenshot' (modal awal 17 nama) | 'system' (tebakan
--   dari sinyal API: stok + kata kunci + tipe) | 'admin' (kunci manual owner).
-- - Sync TIDAK PERNAH menimpa baris yang sudah punya class (pola
--   admin_description_override, migrasi 0030). Tebakan sistem hanya mengisi
--   yang NULL.
-- - Default aman = manual: ragu = made_by_order (under-promise).
-- - Label pembeli: restock = "Kirim otomatis", made_by_order/NULL = "Dikirim admin".
--
-- Idempoten: jalur CI d1 migrations apply mencatat migrasi; rerun manual
-- memakai pola yang sama seperti 0031 (ALTER langsung, tanpa IF NOT EXISTS
-- karena SQLite tidak mendukungnya). UPDATE seed memakai WHERE class IS NULL
-- sehingga rerun parsial (UPDATE saja) aman — kunci admin/sistem tak tertimpa.

-- 1. Kolom kelas + sumber (CHECK membatasi nilai yang sah).
ALTER TABLE wr_variants ADD COLUMN wr_delivery_class TEXT
  CHECK (wr_delivery_class IN ('restock', 'made_by_order'));
ALTER TABLE wr_variants ADD COLUMN wr_delivery_source TEXT
  CHECK (wr_delivery_source IN ('screenshot', 'system', 'admin'));

-- 2. Seed modal awal dari daftar admin WR 2026-09-16 (cocok nama produk,
--    case-insensitive; INSERT OR IGNORE tidak berlaku untuk UPDATE sehingga
--    guard memakai WHERE class IS NULL — rerun aman, kunci admin/sistem
--    yang sudah ada tidak tertimpa).
-- RESTOK (stok siap, auto): Netflix, Capcut, Gemini, Apple Music, Canva Pro,
-- Canva Edu, Loklok, ILovePDF, Vidio, Microsoft Office 365.
UPDATE wr_variants SET wr_delivery_class='restock', wr_delivery_source='screenshot'
  WHERE wr_delivery_class IS NULL AND (
    wr_variant_name LIKE '%Netflix%' OR wr_variant_name LIKE '%Capcut%'
    OR wr_variant_name LIKE '%Gemini%' OR wr_variant_name LIKE '%Apple Music%'
    OR wr_variant_name LIKE '%Canva%' OR wr_variant_name LIKE '%Loklok%'
    OR wr_variant_name LIKE '%ILovePDF%' OR wr_variant_name LIKE '%Vidio%'
    OR wr_variant_name LIKE '%Office%' OR wr_variant_name LIKE '%Microsoft%'
  );
-- MADE BY ORDER (slow, manual): Wink, Meitu, Zoom, Picsart, Scribd,
-- VPN Express, VPN Hidemyass.
UPDATE wr_variants SET wr_delivery_class='made_by_order', wr_delivery_source='screenshot'
  WHERE wr_delivery_class IS NULL AND (
    wr_variant_name LIKE '%Wink%' OR wr_variant_name LIKE '%Meitu%'
    OR wr_variant_name LIKE '%Zoom%' OR wr_variant_name LIKE '%Picsart%'
    OR wr_variant_name LIKE '%Scribd%' OR wr_variant_name LIKE '%VPN%'
    OR wr_variant_name LIKE '%Hidemyass%' OR wr_variant_name LIKE '%HMA%'
  );
