-- 0055_supplier_pairs_susulan.sql — 5 pasangan susulan 2026-10-01.
-- SK baru pasca-pemetaan awal (foto/commit belakangan): CamScanner,
-- Crunchyroll, Getcontact, Grok AI, Leonardo AI. iQiyi SUDAH ada (pair 11).
-- INSERT OR IGNORE: aman bila prod sudah punya (ditulis langsung 2026-10-01).
INSERT OR IGNORE INTO supplier_pairs (wr_product_id, sk_product_id, prefer, prefer_margin, reason) VALUES
  (42, 104, 'auto', 2000, 'susulan 2026-10-01: CamScanner'),
  (30, 106, 'auto', 2000, 'susulan 2026-10-01: Crunchyroll'),
  (10, 109, 'auto', 2000, 'susulan 2026-10-01: Getcontact'),
  (35, 101, 'auto', 2000, 'susulan 2026-10-01: Grok AI'),
  (8, 108, 'auto', 2000, 'susulan 2026-10-01: Leonardo AI');
