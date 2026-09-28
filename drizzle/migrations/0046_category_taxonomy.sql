-- Migrasi 0046: taksonomi 6 kategori (issue 3-in-1 bagian C).
--
-- Masalah: 4 kategori lama ambigu — "Akun Premium" jadi keranjang sampah
-- (AI+streaming+coding), "Tools Pro" campur kreatif+produktivitas, nama
-- "Bundle Kucing" tidak profesional.
--
-- Target (6 kategori):
--   id 1 = AI & Chatbot            (slug ai-chatbot)
--   id 2 = Streaming & Hiburan      (slug streaming-hiburan)
--   id 3 = Produktivitas & Office   (slug produktivitas-office)
--   id 5 = Desain & Video           (slug desain-video)        [BARU]
--   id 6 = Developer & Tools        (slug developer-tools)     [BARU]
--   id 4 = Bundle Hemat             (slug bundle-hemat, NAMA saja diganti;
--                                    slug dipertahankan agar filter ?cat=
--                                    lama tidak 404)
--
-- Strategi ID: pakai-ulang id 1-4 (rename/repurpose) + tambah id 5-6, agar
-- FK products.category_id tidak perlu rebuild tabel. Produk non-seed
-- (mis. hasil sync WR) ikut kategori baru sesuai id lamanya — disengaja
-- (asumsi eksplisit, lihat laporan subagent C).
--
-- Kompatibilitas slug lama (ai-gateway, akun-premium, tools-pro): DITANGANI
-- di kode (LEGACY_CATEGORY_SLUG_ALIASES di src/lib/products.ts, dipakai
-- GET /api/products + home-client), BUKAN baris alias di DB — agar admin
-- hanya melihat 6 kategori dan guard DELETE 409 tetap bermakna.

-- 1. Kategori baru (id eksplisit, OR IGNORE agar rerun aman).
INSERT OR IGNORE INTO categories (id, name, slug, icon, sort_order) VALUES
  (5,'Desain & Video','desain-video','box',4),
  (6,'Developer & Tools','developer-tools','shield',5);

-- 2. Rename/repurpose 4 kategori lama (WHERE id= agar aman bila dijalankan
--    di DB yang kategorinya pernah diubah manual namanya).
UPDATE categories SET name='AI & Chatbot', slug='ai-chatbot', icon='lightning-bolt', sort_order=1 WHERE id=1;
UPDATE categories SET name='Streaming & Hiburan', slug='streaming-hiburan', icon='star', sort_order=2 WHERE id=2;
UPDATE categories SET name='Produktivitas & Office', slug='produktivitas-office', icon='bag', sort_order=3 WHERE id=3;
UPDATE categories SET name='Bundle Hemat', icon='packaging', sort_order=6 WHERE id=4 AND slug='bundle-hemat';

-- 3. Bulk pindah products seed by slug (24 produk). Produk non-seed tidak
--    disentuh — ikut kategori baru via id lamanya (asumsi eksplisit).

-- AI & Chatbot (id 1): ChatGPT, Claude, Midjourney, Perplexity, Gemini + 3x AI Gateway.
UPDATE products SET category_id=1 WHERE slug IN (
  'chatgpt-plus-1-bulan','claude-pro-1-bulan','midjourney-1-bulan',
  'perplexity-pro-1-tahun','gemini-advanced-1-bulan',
  'ai-gateway-1jt-token','ai-gateway-5jt-token','ai-gateway-10jt-token'
);

-- Streaming & Hiburan (id 2): YouTube, Netflix, Spotify + bundle streaming.
UPDATE products SET category_id=2 WHERE slug IN (
  'youtube-premium-1-bulan','netflix-premium-1-bulan',
  'spotify-premium-1-bulan','bundle-streaming'
);

-- Produktivitas & Office (id 3): Notion, Microsoft 365, Grammarly.
UPDATE products SET category_id=3 WHERE slug IN (
  'notion-plus-1-tahun','microsoft-365-1-tahun','grammarly-premium-1-tahun'
);

-- Desain & Video (id 5): Canva, CapCut, Adobe CC, Figma.
UPDATE products SET category_id=5 WHERE slug IN (
  'canva-pro-1-tahun','capcut-pro-1-bulan','adobe-cc-1-bulan',
  'figma-professional-1-bulan'
);

-- Developer & Tools (id 6): Cursor, VPN.
UPDATE products SET category_id=6 WHERE slug IN (
  'cursor-pro-1-bulan','vpn-premium-1-tahun'
);

-- Bundle Hemat (id 4): tiga bundle non-streaming.
UPDATE products SET category_id=4 WHERE slug IN (
  'bundle-creator-3in1','bundle-ai-master','bundle-productivity'
);
