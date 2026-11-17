-- 0134: pensiunkan antrean & 14 trigger pair_dirty_* dari model pasangan lama (supplier_pairs),
-- yang sudah digantikan grup produk lintas supplier pada migrasi 0129.
-- Tabel supplier_pairs dan supplier_pair_dirty tetap dipertahankan untuk kompatibilitas
-- shim/histori, tetapi seluruh trigger pengisian antrean dihapus dan antrean lama dikosongkan.

DROP TRIGGER IF EXISTS pair_dirty_product_insert;
DROP TRIGGER IF EXISTS pair_dirty_product_delete;
DROP TRIGGER IF EXISTS pair_dirty_variant_insert;
DROP TRIGGER IF EXISTS pair_dirty_variant_delete;
DROP TRIGGER IF EXISTS pair_dirty_variant_update;
DROP TRIGGER IF EXISTS pair_dirty_wr_insert;
DROP TRIGGER IF EXISTS pair_dirty_wr_delete;
DROP TRIGGER IF EXISTS pair_dirty_wr_update;
DROP TRIGGER IF EXISTS pair_dirty_sk_insert;
DROP TRIGGER IF EXISTS pair_dirty_sk_delete;
DROP TRIGGER IF EXISTS pair_dirty_sk_update;
DROP TRIGGER IF EXISTS pair_dirty_pair_insert;
DROP TRIGGER IF EXISTS pair_dirty_pair_update;
DROP TRIGGER IF EXISTS pair_dirty_product_active_update;

DELETE FROM supplier_pair_dirty;
