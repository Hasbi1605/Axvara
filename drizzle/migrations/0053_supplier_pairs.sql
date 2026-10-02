-- ============================================================
-- Migration 0053: Pemetaan pasangan WR vs SK + pemenang otomatis.
-- Keputusan owner 2026-09-30: produk yang sama di dua supplier dipilih
-- OTOMATIS mana yang tampil (stok dulu, modal kemudian), bukan manual.
--
-- Desain (cermin ownership WR/SK: sync tidak pernah tulis milik admin):
-- - supplier_pairs: pemetaan SEKALI oleh admin (wr_product_id ↔
--   sk_product_id). Sync TIDAK PERNAH tulis tabel ini.
-- - winner: 'WR' | 'SK' | NULL (NULL = belum diputuskan / dua-duanya habis).
-- - prefer: 'auto' | 'WR' | 'SK' — bobot kualitas admin (garansi/S&K bagus)
--   yang mengalahkan selisih modal kecil (di bawah prefer_margin).
-- - decided_at + reason: audit jejak keputusan tiap sweep.
-- - Katalog publik memfilter pecundang via JOIN (bukan is_active — itu
--   milik admin, jangan ditimpa sync).
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_pairs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_product_id     INTEGER NOT NULL,
  sk_product_id     INTEGER NOT NULL,
  winner            TEXT CHECK (winner IN ('WR', 'SK')),
  prefer            TEXT NOT NULL DEFAULT 'auto' CHECK (prefer IN ('auto', 'WR', 'SK')),
  prefer_margin     INTEGER NOT NULL DEFAULT 2000,
  decided_at        TEXT,
  reason            TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wr_product_id, sk_product_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_pairs_wr ON supplier_pairs(wr_product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_pairs_sk ON supplier_pairs(sk_product_id);
-- Tanpa REFERENCES products(id): seed bootstrap (schema.sql) jalan sebelum
-- products ada; dan produk yang dihapus manual tidak boleh blokir migrasi.
-- Pasangan yatim dibersihkan best-effort oleh decideWinner (cermin guard
-- link yatim WR 2026-09-11).

-- Seed 28 pasangan (keputusan owner 2026-09-30, via id produk prod).
-- Susulan 2026-10-01 di 0055 (5 pasangan SK baru pasca-pemetaan awal).
-- Gemini dipasang (produk sama), MS365 vs Office365 TIDAK (beda: langganan
-- vs lifetime). Prefer default auto semua — admin tuning belakangan.
INSERT OR IGNORE INTO supplier_pairs (wr_product_id, sk_product_id) VALUES
  (33, 67),   -- Alight Motion
  (11, 63),   -- Apple Music
  (28, 75),   -- Bstation
  (57, 65),   -- Canva Premium vs Canva
  (5, 76),    -- Capcut Pro vs Capcut
  (12, 85),   -- ChatGPT Premium vs ChatGPT
  (34, 89),   -- Disney Hotstar vs Disney+ Hotstar
  (20, 74),   -- Express VPN
  (39, 90),   -- HBO MAX
  (19, 82),   -- HMA VPN vs HideMyAss VPN (kamus khusus)
  (40, 79),   -- iQiyi vs Iqiyi
  (3, 83),    -- Loklok vs LOKLOK
  (26, 95),   -- Meitu Premium vs Meitu
  (4, 72),    -- Netflix Premium vs Netflix
  (24, 68),   -- PicsArt Pro vs Picsart
  (16, 73),   -- Prime Video
  (27, 64),   -- Remini Premium vs Remini Pro
  (18, 69),   -- Scribd
  (9, 80),    -- Spotify Premium
  (36, 86),   -- Surfshark VPN
  (13, 71),   -- Vidio Platinum vs Vidio
  (14, 70),   -- Viu Premium vs Viu
  (29, 78),   -- WeTV VIP vs WeTV
  (25, 84),   -- Wink Premium vs Wink
  (31, 92),   -- Youku Premium vs Youku
  (7, 66),    -- Youtube Premium vs Youtube
  (15, 62),   -- Zoom Premium vs Zoom Meetings Pro
  (58, 96);   -- Gemini AI Antigravity vs Gemini Ai (produk sama per owner)
