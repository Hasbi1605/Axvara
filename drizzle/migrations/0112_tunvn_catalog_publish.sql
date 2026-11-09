-- 0112_tunvn_catalog_publish.sql — TUNVN: katalog ChatGPT + Buff Muse (9 Nov 2026).
-- Keputusan owner: katalog ChatGPT TUNVN diterbitkan memakai gambar produk
-- ChatGPT AXVARA existing (/r2/products/f87f491ee2f9034845db18eb08c9236d.webp,
-- sama dengan produk WR id 12 dan SK id 85 yang sedang nonaktif), markup 35%
-- dari modal USDT; Buff Token Muse AI menjadi varian baru produk Muse manual
-- owner (slug muse-ai-1-miliar-token), markup 40% dari modal 0,0588 USDT/1B.
-- Kurs acuan saat hitung: USDT Rp18.086 (9 Nov 2026). Harga IDR di bawah adalah
-- hasil rumus src/lib/tunvn/pricing.ts dibulatkan ke atas per Rp100.
-- Buff memakai SKU namespace TUNVN-BUFF-* dengan quantity_b pada metadata
-- varian (kolom tunvn_*); fulfillment tetap manual sampai dispatch otomatis
-- dibangun — jangan menganggap varian ini auto-order.

ALTER TABLE tunvn_products ADD COLUMN axvara_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE tunvn_products ADD COLUMN markup_percent INTEGER NOT NULL DEFAULT 35 CHECK (markup_percent >= 0);
ALTER TABLE tunvn_products ADD COLUMN sell_price_idr INTEGER CHECK (sell_price_idr IS NULL OR sell_price_idr >= 0);
ALTER TABLE tunvn_products ADD COLUMN fx_idr_per_usdt REAL CHECK (fx_idr_per_usdt IS NULL OR fx_idr_per_usdt > 0);

ALTER TABLE product_variants ADD COLUMN tunvn_buff_quantity_b INTEGER CHECK (tunvn_buff_quantity_b IS NULL OR (tunvn_buff_quantity_b >= 1 AND tunvn_buff_quantity_b <= 30));
ALTER TABLE product_variants ADD COLUMN tunvn_cost_usdt REAL CHECK (tunvn_cost_usdt IS NULL OR tunvn_cost_usdt > 0);
ALTER TABLE product_variants ADD COLUMN tunvn_markup_percent INTEGER CHECK (tunvn_markup_percent IS NULL OR tunvn_markup_percent >= 0);
ALTER TABLE product_variants ADD COLUMN tunvn_fx_idr_per_usdt REAL CHECK (tunvn_fx_idr_per_usdt IS NULL OR tunvn_fx_idr_per_usdt > 0);

-- Katalog ChatGPT TUNVN (produk Market baru, aktif; harga varian tunggal):
-- 86 ACC CHAT GPT BUSINESS 1M(W1D): 4.60 USDT -> Rp112.400
-- 83 CHAT GPT GPAY (W1D):           4.96 USDT -> Rp121.200
INSERT INTO products (category_id, name, slug, description, price, compare_price, image_url, badge, sold_count, stock, is_active, sort_order, source, fulfillment_mode, telegram_enabled)
SELECT c.id, 'ChatGPT Business 1 Bulan (TUNVN)', 'chatgpt-business-1-bulan-tunvn',
  'Akun ChatGPT Business 1 bulan dari supplier TUNVN. Garansi mengikuti masa garansi supplier (W1D); stok dan harga mengikuti katalog TUNVN.',
  112400, NULL, '/r2/products/f87f491ee2f9034845db18eb08c9236d.webp', NULL, 0, 22, 1, 900, 'manual', 'manual', 1
FROM categories c WHERE c.slug = 'ai-chatbot'
ON CONFLICT(slug) DO NOTHING;

INSERT INTO products (category_id, name, slug, description, price, compare_price, image_url, badge, sold_count, stock, is_active, sort_order, source, fulfillment_mode, telegram_enabled)
SELECT c.id, 'ChatGPT GPay 1 Bulan (TUNVN)', 'chatgpt-gpay-1-bulan-tunvn',
  'Akun ChatGPT via GPay 1 bulan dari supplier TUNVN. Garansi mengikuti masa garansi supplier (W1D); stok dan harga mengikuti katalog TUNVN.',
  121200, NULL, '/r2/products/f87f491ee2f9034845db18eb08c9236d.webp', NULL, 0, 6, 1, 901, 'manual', 'manual', 1
FROM categories c WHERE c.slug = 'ai-chatbot'
ON CONFLICT(slug) DO NOTHING;

INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
SELECT p.id, 'TUNVN-86', 'ChatGPT Business 1 Bulan', 112400, 22, 'manual', 1, 1
FROM products p WHERE p.slug = 'chatgpt-business-1-bulan-tunvn'
ON CONFLICT(sku) DO NOTHING;

INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
SELECT p.id, 'TUNVN-83', 'ChatGPT GPay 1 Bulan', 121200, 6, 'manual', 1, 1
FROM products p WHERE p.slug = 'chatgpt-gpay-1-bulan-tunvn'
ON CONFLICT(sku) DO NOTHING;

-- Varian Buff Token pada produk Muse manual owner (id produk dicari by slug):
-- modal 0,0588 USDT/1B x Rp18.086 x 1,40 dibulatkan ke atas per Rp100.
INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
SELECT p.id, 'TUNVN-BUFF-5B', 'Buff Token Muse AI 5B', 7500, -1, 'manual', 1, 10, 5, 0.294, 40, 18086
FROM products p WHERE p.slug = 'muse-ai-1-miliar-token'
ON CONFLICT(sku) DO NOTHING;

INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
SELECT p.id, 'TUNVN-BUFF-10B', 'Buff Token Muse AI 10B', 14900, -1, 'manual', 1, 11, 10, 0.588, 40, 18086
FROM products p WHERE p.slug = 'muse-ai-1-miliar-token'
ON CONFLICT(sku) DO NOTHING;

INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
SELECT p.id, 'TUNVN-BUFF-20B', 'Buff Token Muse AI 20B', 29800, -1, 'manual', 1, 12, 20, 1.176, 40, 18086
FROM products p WHERE p.slug = 'muse-ai-1-miliar-token'
ON CONFLICT(sku) DO NOTHING;

INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
SELECT p.id, 'TUNVN-BUFF-30B', 'Buff Token Muse AI 30B', 44700, -1, 'manual', 1, 13, 30, 1.764, 40, 18086
FROM products p WHERE p.slug = 'muse-ai-1-miliar-token'
ON CONFLICT(sku) DO NOTHING;
