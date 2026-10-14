-- 0062_pedia_service_curation.sql — Kurasi layanan Pedia berlapis (2026-10-14).
--
-- Latar (permintaan owner): model Hemat/Standar/Premium memampatkan ribuan
-- layanan supplier menjadi maks 3 peringkat generik per produk — pembeli
-- tidak bisa membedakan layanan selain harga, dan katalog terasa miskin.
-- Model baru: produk tetap wadah platform x metrik, tetapi isinya BANYAK
-- layanan terkurasi per produk (rekomendasi tampil utama, sisanya bisa
-- dibuka + difilter), masing-masing dengan nama/deskripsi publik bahasa
-- manusia dan atribut terstruktur (wilayah, kualitas, refill, kecepatan).
--
-- Perbaikan (forward-only, pola rebuild seperti 0019/0061):
-- - CHECK tier 3-nama dibuang; UNIQUE(product_id, tier) diganti
--   UNIQUE(product_id, supplier, supplier_service_id) agar satu layanan
--   supplier hanya terhubung sekali per produk.
-- - Kolom kurasi baru: public_name, description_md, region, quality,
--   speed_note, drop_risk, is_recommended, sort_order.
-- - Backfill atribut dari label_note + nama layanan supplier yang sudah
--   tersimpan, agar 34 peringkat aktif tidak kosong atribut pada hari
--   pertama. Admin dapat mengoreksi lewat panel sesudahnya.
PRAGMA defer_foreign_keys=ON;

DROP TABLE IF EXISTS pedia_tiers_new;

CREATE TABLE pedia_tiers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier TEXT NOT NULL DEFAULT 'standar',
  label_note TEXT,
  supplier TEXT NOT NULL DEFAULT 'providersmm',
  supplier_service_id INTEGER NOT NULL,
  backup_service_id INTEGER,
  price_group TEXT NOT NULL CHECK (price_group IN ('G1','G2','G3')),
  markup_pct REAL NOT NULL,
  min_profit_rp INTEGER NOT NULL,
  refill_days INTEGER NOT NULL DEFAULT 0,
  eta_start TEXT,
  eta_finish TEXT,
  package_prices_json TEXT NOT NULL DEFAULT '{}',
  rate_snapshot REAL,
  is_active INTEGER NOT NULL DEFAULT 0,
  auto_disabled_reason TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  -- Kurasi publik (0062): nama + deskripsi bahasa manusia per layanan.
  public_name TEXT,
  description_md TEXT,
  region TEXT NOT NULL DEFAULT 'global' CHECK (region IN ('indonesia','global','mixed')),
  quality TEXT NOT NULL DEFAULT 'standar' CHECK (quality IN ('ekonomis','standar','hq','real')),
  speed_note TEXT,
  drop_risk TEXT NOT NULL DEFAULT 'sedang' CHECK (drop_risk IN ('rendah','sedang','tinggi')),
  is_recommended INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, supplier, supplier_service_id)
);

INSERT INTO pedia_tiers_new (
  id, product_id, tier, label_note, supplier, supplier_service_id,
  backup_service_id, price_group, markup_pct, min_profit_rp, refill_days,
  eta_start, eta_finish, package_prices_json, rate_snapshot, is_active,
  auto_disabled_reason, updated_at, public_name, description_md, region, quality,
  speed_note, drop_risk, is_recommended, sort_order
)
SELECT
  t.id, t.product_id, t.tier, t.label_note, t.supplier, t.supplier_service_id,
  t.backup_service_id, t.price_group, t.markup_pct, t.min_profit_rp, t.refill_days,
  t.eta_start, t.eta_finish, t.package_prices_json, t.rate_snapshot, t.is_active,
  t.auto_disabled_reason, t.updated_at,
  -- Backfill dari label/nama supplier. CATATAN rerun: di prod, migrasi ini
  -- sudah diterapkan manual SEBELUM file ini sampai ke CI, jadi saat CI
  -- menjalankannya tabel sumber SUDAH skema baru; backfill akan menghitung
  -- ulang atribut dari label yang sama, dan nama/deskripsi publik diisi
  -- ulang oleh langkah kurasi data terpisah (idempoten, nilai sama).
  NULL,
  NULL,
  CASE
    WHEN lower(COALESCE(t.label_note, '')) LIKE '%indonesia%' THEN 'indonesia'
    ELSE 'global'
  END,
  CASE
    WHEN lower(COALESCE(t.label_note, '') || ' ' || COALESCE(s.name, '')) LIKE '%hq%' THEN 'hq'
    WHEN lower(COALESCE(t.label_note, '') || ' ' || COALESCE(s.name, '')) LIKE '%real%' THEN 'real'
    WHEN t.price_group = 'G1' THEN 'ekonomis'
    ELSE 'standar'
  END,
  NULL,
  CASE
    WHEN lower(COALESCE(s.name, '')) LIKE '%non drop%' OR lower(COALESCE(s.name, '')) LIKE '%no drop%' OR lower(COALESCE(s.name, '')) LIKE '%low drop%' THEN 'rendah'
    ELSE 'sedang'
  END,
  0,
  t.id
FROM pedia_tiers t
LEFT JOIN pedia_supplier_services s
  ON s.supplier = t.supplier AND s.service_id = t.supplier_service_id;

-- PENTING: JANGAN `DROP TABLE pedia_tiers` — FK dari pedia_order_items
-- membuat DROP gagal di D1 (terbukti saat penerapan prod 2026-10-14; D1
-- me-rollback batch --file). Pola aman: rename lama -> rename baru -> lama
-- dibiarkan sebagai arsip (drop menyusul setelah tidak dirujuk).
-- IDEMPOTEN: migrasi ini lebih dulu diterapkan manual ke prod 2026-10-14,
-- jadi arsip lama dibuang dulu agar langkah migrasi CI aman dijalankan
-- ulang (di DB yang belum bermigrasi, DROP IF EXISTS ini no-op).
DROP TABLE IF EXISTS pedia_tiers_old0062;
ALTER TABLE pedia_tiers RENAME TO pedia_tiers_old0062;
ALTER TABLE pedia_tiers_new RENAME TO pedia_tiers;

CREATE INDEX IF NOT EXISTS idx_pedia_tiers_product_active
  ON pedia_tiers(product_id, is_active, is_recommended, sort_order);
