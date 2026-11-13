-- 0120 — Reaktivasi terkurasi IndoSMM (keputusan owner 2026-11-13).
-- Dihasilkan dari ekspor baca-saja produksi memakai helper harga repo
-- (pediaBounds/computePediaPrice/passesMarginGuard, minimum order env).
-- Guard: hanya baris indosmm/curated yang masih nonaktif dan tidak
-- direferensikan order; idempoten (re-run tidak mengubah apa pun).
-- Kandidat = present=1, rate>0, tipe cocok, margin paket termurah lulus,
-- bukan premium tool, dan TIDAK dinonaktifkan oleh migrasi 0089.

UPDATE pedia_tiers SET is_active=1, auto_disabled_reason=NULL, updated_at=datetime('now')
 WHERE id IN (31,32,36,38,40,43,44,48,49,72,125,157,171,172,189,191) AND supplier='indosmm' AND managed='curated' AND is_active=0;
UPDATE pedia_tiers SET is_active=1, auto_disabled_reason=NULL, updated_at=datetime('now')
 WHERE id IN (341,437,486,487,541) AND supplier='indosmm' AND managed='curated' AND is_active=0;
