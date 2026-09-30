-- ============================================================
-- Migration 0052: Kategorisasi SK dari NAMA produk (selaras WR).
-- Laporan owner 2026-09-30: semua produk SK menumpuk di AI & Chatbot.
-- Akar: kategori upstream SK selalu "Aplikasi Premium" untuk seluruh scope
-- fase 1, jadi map kategori upstream selalu jatuh ke default id 1.
-- WR tidak kena ini karena kategori WR beragam.
--
-- Aturan diselaraskan pola WR produksi (48 produk WR hanya "Domain Murah"
-- di AI): streaming/musik/film → 2, AI murni → 1, VPN → 6, SELAIN ITU → 3
-- (bucket umum WR: Canva/CapCut/ChatGPT/Meitu/PicsArt/Remini/Scribd/Wink/
-- Zoom semua di 3). Sync ke depan memakai mapSkCategory(nama) yang sama.
--
-- Data-only, idempoten: hanya menyentuh baris milik sync
-- (sk_product_id NOT NULL). Rerun aman (SET nilai yang sama).
-- Kategori manual (sk_product_id NULL) TIDAK tersentuh.
-- ============================================================

-- 2 Streaming & Hiburan: musik, film, series, stasiun TV, novel.
UPDATE products SET category_id=2, updated_at=datetime('now')
WHERE sk_product_id IN
  ('2','6','12','13','14','15','17','22','24','25','29','52','63','72','73')
  AND sk_product_id IS NOT NULL;

-- 1 AI & Chatbot murni: LLM (bukan editor media).
UPDATE products SET category_id=1, updated_at=datetime('now')
WHERE sk_product_id IN ('45','50') AND sk_product_id IS NOT NULL;

-- 6 Developer & Tools: VPN.
UPDATE products SET category_id=6, updated_at=datetime('now')
WHERE sk_product_id IN ('16','28','32') AND sk_product_id IS NOT NULL;

-- 3 Produktivitas & Office (bucket umum WR): editor foto/video/desain,
-- office, meeting, belajar, utilitas — sisa yang masih di default 1.
UPDATE products SET category_id=3, updated_at=datetime('now')
WHERE sk_product_id IS NOT NULL AND category_id=1
  AND sk_product_id NOT IN ('45','50');
