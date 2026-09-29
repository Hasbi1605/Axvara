-- ============================================================
-- Migration 0050: Fitur panel SK setara WR + khas SK.
-- Dijalankan SEKALI oleh `wrangler d1 migrations apply`. SQLite tidak punya
-- ADD COLUMN IF NOT EXISTS — JANGAN apply manual untuk DB yang sudah berisi
-- kolom ini (jalur CI normal aman; bootstrap baru memakai schema.sql final).
--
-- Isi:
-- 1. sk_exclusions (cermin wr_exclusions): pola produk yang tidak dibuatkan
--    katalog. Dibuat KOSONG (pelajaran 0028: seed Canva/Gemini WR dulu
--    menghambat, lalu dibuka lagi) — owner mengisi manual dari panel.
-- 2. Kolom registry khas SK: sk_description, sk_min_order, sk_status,
--    sk_required_fields (JSON), sk_validation (JSON) — dibaca panel admin
--    tanpa panggil API lagi.
-- ============================================================

-- 1. Exclusion rules SK (kosong di bootstrap — owner mengisi manual).
CREATE TABLE IF NOT EXISTS sk_exclusions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern   TEXT NOT NULL UNIQUE,
  reason    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Kolom registry khas SK.
ALTER TABLE sk_products ADD COLUMN sk_description TEXT;
ALTER TABLE sk_products ADD COLUMN sk_min_order INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sk_products ADD COLUMN sk_status TEXT;
ALTER TABLE sk_products ADD COLUMN sk_required_fields TEXT;
ALTER TABLE sk_products ADD COLUMN sk_validation TEXT;
