-- 0092_supplier_links_whitelabel_20261102.sql — Seed 2 shortlink white-label baru.
--
-- Audit katalog publik live 2026-11-02 (99 produk via /api/catalog):
-- - https://inbox.hypathia.web.id (OTP Muse AI, copy admin muse-ai-1-miliar-token)
--   → go/otp-hypathia. Ini link admin (bukan supplier), dipendekkan agar PDP
--   rapi; tujuan = URL yang sama persis, tanpa klaim white-label supplier.
-- - https://youtube.com/shorts/YKOMcipD3ig (tutorial login Alight Motion baru,
--   2 varian pemasok alight-motion-sk; BUKAN ID kurasi 8emqddsjPsE yang sudah
--   → go/alight-login) → go/alight-shorts.
-- Juga: netflix-codes.sekalipay.com versi BARE (tanpa /mailbox, 2 varian
-- chatgpt-sk live + 1 langkah kurasi ChatGPT Sharing) kini → go/otp di
-- rewriteSupplierDocsLinks (tidak perlu seed baru).
--
-- Pelajaran 0071: seed lewat file BARU (INSERT OR IGNORE idempoten), jangan
-- titip ke migrasi lama yang sudah live.
INSERT OR IGNORE INTO supplier_links (slug, destination, title) VALUES
  ('otp-hypathia', 'https://inbox.hypathia.web.id/', 'Mailbox OTP Hypathia (Muse AI)'),
  ('alight-shorts', 'https://youtube.com/shorts/YKOMcipD3ig', 'Shorts login Alight Motion supplier');
