-- 0147_tunvn_archive_duplicate_118.sql — arsipkan produk TUNVN ganda #118.
--
-- 19 Nov 2026 13:12 UTC supplier TUNVN sempat menayangkan #118 "MUSE AI 1B -
-- GMAIL (W2D)" (nama identik dengan #111 yang sudah menjadi varian
-- "Akun 1B Token (garansi 2 hari)" di produk Muse AI owner). #118 tidak ada di
-- peta families.ts sehingga publisher membuat produk fallback 1:1 id51944
-- (`muse-ai-1b-gmail-w2d-tunvn`), lalu #118 hilang lagi dari katalog upstream
-- (stok 0, tersembunyi). Keputusan owner 20 Nov: bersihkan dengan Arsip,
-- setara tombol hapus admin (produk supplier tidak pernah dihapus permanen).
-- Guard: hanya produk family p118 yang nonaktif, belum diarsip, dan mirror-nya
-- stok 0 + tersembunyi. Idempoten.

UPDATE products SET archived_at=COALESCE(archived_at,datetime('now')), is_active=0, updated_at=datetime('now')
WHERE tunvn_family='p118' AND slug='muse-ai-1b-gmail-w2d-tunvn' AND is_active=0 AND archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM tunvn_products t WHERE t.supplier_product_id=118 AND (t.stock<>0 OR t.visible<>0));

UPDATE product_variants SET is_active=0, updated_at=datetime('now')
WHERE sku='TUNVN-118' AND is_active<>0
  AND product_id IN (SELECT id FROM products WHERE tunvn_family='p118' AND archived_at IS NOT NULL);
