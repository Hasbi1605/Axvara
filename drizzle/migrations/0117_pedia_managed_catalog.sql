-- PSMM-AUTOCATALOG-12 (2026-11-12, implementasi lokal; revisi review-1):
-- Baris katalog yang dibangkitkan otomatis dari mirror supplier ditandai
-- eksplisit di produk DAN tier. Default 'curated' menjaga SEMUA baris lama
-- (kurasi manusia) tidak pernah ditimpa; hanya baris 'auto' yang boleh di-upsert.
ALTER TABLE pedia_products ADD COLUMN managed TEXT NOT NULL DEFAULT 'curated'
  CHECK (managed IN ('curated','auto'));
ALTER TABLE pedia_tiers ADD COLUMN managed TEXT NOT NULL DEFAULT 'curated'
  CHECK (managed IN ('curated','auto'));
-- Versi snapshot deskripsi resmi (`fetched_at`) saat baris auto terakhir
-- direkonsiliasi. Baris auto yang versinya belum sama dengan snapshot aktif
-- TIDAK dijual sampai antrean materialisasi selesai (gate syarat material).
ALTER TABLE pedia_tiers ADD COLUMN managed_snapshot_at TEXT;
