-- 0061_wr_delivery_source_api.sql — Sumber kelas WR hanya dari API (2026-10-13).
--
-- Latar (permintaan owner): halaman admin WR penuh badge "RESTOK • tebakan",
-- "MBO • tebakan", "daftar WR", "kunci admin" + tombol kunci kelas AUTO/
-- MANUAL, padahal audit D1 prod 2026-10-13 membuktikan 92/94 varian aktif
-- sudah berkelas dari `delivery_mode` resmi API WR (migrasi 0060) — cap
-- sumber 'system' yang sama untuk tebakan lama dan turunan API membuat
-- labelnya berbohong. Penyederhanaan ala SK: kelas WR kini murni turunan
-- API dengan penanda tunggal 'api'; badge admin hanya AUTO/MANUAL.
--
-- Perbaikan (forward-only, pola rebuild seperti 0019):
-- - Rebuild wr_variants dengan CHECK sumber ('api') saja; kolom, data,
--   UNIQUE wr_variant_id, dan relasi dipertahankan persis.
-- - Nilai sumber lama ('screenshot'/'system'/'admin'/NULL) dinormalkan ke
--   'api': sejak 0060 kelas efektif selalu ditulis ulang sync dari
--   delivery_mode bila ada, dan default tanpa mode adalah made_by_order
--   deterministik — tidak ada lagi kelas warisan tebakan yang perlu
--   dibedakan sumbernya.
PRAGMA defer_foreign_keys=ON;

DROP TABLE IF EXISTS wr_variants_new;

CREATE TABLE wr_variants_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_variant_id         TEXT NOT NULL UNIQUE,
  wr_product_id         TEXT NOT NULL REFERENCES wr_products(wr_product_id),
  wr_variant_name       TEXT NOT NULL,
  wr_price              INTEGER NOT NULL,
  wr_duration           TEXT,
  wr_type               TEXT,
  wr_warranty           TEXT,
  wr_stock              INTEGER NOT NULL DEFAULT 0,
  wr_terms              TEXT,
  wr_delivery_terms     TEXT,
  axvara_variant_id     INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  markup_percent        INTEGER NOT NULL DEFAULT 50,
  markup_fixed          INTEGER NOT NULL DEFAULT 0,
  axvara_sell_price     INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  last_synced_at        TEXT,
  -- Kelas pengiriman WR: 'restock' (AUTO) vs 'made_by_order' (MANUAL),
  -- diturunkan sync dari wr_delivery_mode resmi API WR.
  wr_delivery_class     TEXT CHECK (wr_delivery_class IN ('restock', 'made_by_order')),
  wr_delivery_source    TEXT CHECK (wr_delivery_source IN ('api')),
  -- Mode kirim resmi API WR (migrasi 0060): auto/manual/mixed (mentah).
  wr_delivery_mode      TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO wr_variants_new (
  id, wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
  wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
  axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
  is_active, last_synced_at, wr_delivery_class, wr_delivery_source,
  wr_delivery_mode, created_at, updated_at
)
SELECT
  id, wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
  wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
  axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
  is_active, last_synced_at, wr_delivery_class, 'api',
  wr_delivery_mode, created_at, updated_at
FROM wr_variants;

DROP TABLE wr_variants;
ALTER TABLE wr_variants_new RENAME TO wr_variants;
