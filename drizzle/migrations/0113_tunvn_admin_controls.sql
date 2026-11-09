-- 0113_tunvn_admin_controls.sql — Kontrol admin TUNVN (9 Nov 2026).
-- Owner meminta produk TUNVN dimatikan dari publik dan diatur penuh dari
-- panel admin (terbit/sembunyi per produk, markup, nama/deskripsi). Kolom
-- admin-owned ini TIDAK pernah ditimpa sync/publish TUNVN.
ALTER TABLE tunvn_products ADD COLUMN admin_name TEXT;
ALTER TABLE tunvn_products ADD COLUMN admin_description TEXT;
ALTER TABLE tunvn_products ADD COLUMN publish_requested INTEGER NOT NULL DEFAULT 0 CHECK (publish_requested IN (0,1));

ALTER TABLE product_variants ADD COLUMN tunvn_admin_price_idr INTEGER CHECK (tunvn_admin_price_idr IS NULL OR tunvn_admin_price_idr >= 0);

-- Pastikan keadaan awal semua TUNVN nonaktif (idempoten; migrasi 0112 seed
-- juga sudah nonaktif setelah revisi owner di hari yang sama).
UPDATE products SET is_active=0, updated_at=datetime('now')
 WHERE slug IN ('chatgpt-business-1-bulan-tunvn','chatgpt-gpay-1-bulan-tunvn') AND is_active<>0;
UPDATE product_variants SET is_active=0, updated_at=datetime('now')
 WHERE sku LIKE 'TUNVN-%' AND is_active<>0;
UPDATE tunvn_products SET visible=0, publish_requested=0, updated_at=datetime('now') WHERE visible<>0 OR publish_requested<>0;
