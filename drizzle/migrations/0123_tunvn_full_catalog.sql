-- 0123_tunvn_full_catalog.sql — Semua produk mirror TUNVN masuk katalog (15 Nov 2026).
-- Keputusan owner: produk mirror TUNVN (~26 baris, kecuali #60 API TEST) dipetakan
-- ke produk AXVARA lewat publisher (src/lib/tunvn/catalog.ts). Produk serupa menjadi
-- varian satu produk; semua produk/varian baru dibuat NONAKTIF.
--
-- Identitas durable:
--   products.tunvn_family              = key keluarga TUNVN (badge asal di admin).
--   product_variants.tunvn_source_product_id = id produk upstream TUNVN.
-- Publisher menentukan pemetaan dari kolom varian ini, BUKAN dari slug/nama.
-- Tidak ada seed produk baru di migrasi ini: publisher yang membuatnya (sekali),
-- lalu admin memiliki nama/deskripsi/gambar.

ALTER TABLE products ADD COLUMN tunvn_family TEXT;

ALTER TABLE product_variants ADD COLUMN tunvn_source_product_id INTEGER
  CHECK (tunvn_source_product_id IS NULL OR tunvn_source_product_id >= 1);

-- Backfill keadaan pra-0123 (ChatGPT Private: 86 Business, 83 GPay).
UPDATE products SET tunvn_family='chatgpt' WHERE slug='chatgpt-tunvn' AND tunvn_family IS NULL;
UPDATE product_variants SET tunvn_source_product_id=86 WHERE sku='TUNVN-86' AND tunvn_source_product_id IS NULL;
UPDATE product_variants SET tunvn_source_product_id=83 WHERE sku='TUNVN-83' AND tunvn_source_product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_tunvn_family ON products(tunvn_family) WHERE tunvn_family IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_variants_tunvn_source ON product_variants(tunvn_source_product_id) WHERE tunvn_source_product_id IS NOT NULL;

-- Trigger publikasi lama hanya mengenal dua SKU ChatGPT. Ganti dengan identitas
-- durable: setiap varian ber-tunvn_source_product_id menyinkronkan
-- publish_requested mirror TUNVN saat admin menyalakan/mematikan varian.
-- Buff (TUNVN-BUFF-*) tidak punya tunvn_source_product_id sehingga tidak tersentuh.
DROP TRIGGER IF EXISTS tunvn_variant_publication;
CREATE TRIGGER tunvn_variant_publication AFTER UPDATE OF is_active ON product_variants
WHEN NEW.tunvn_source_product_id IS NOT NULL BEGIN
  UPDATE tunvn_products SET publish_requested=NEW.is_active
   WHERE supplier_product_id=NEW.tunvn_source_product_id;
END;
