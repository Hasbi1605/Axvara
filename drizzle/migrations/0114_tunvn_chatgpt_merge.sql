-- Preserve variant IDs, prices, admin copy and all historical order references.
UPDATE products SET slug='chatgpt-tunvn',
  name=CASE WHEN name='ChatGPT Business 1 Bulan (TUNVN)' THEN 'ChatGPT Private' ELSE name END,
  description=CASE WHEN description LIKE '%TUNVN%' THEN 'Akun ChatGPT Private 1 bulan. Pilih Business atau GPay; garansi mengikuti paket.' ELSE description END
WHERE slug='chatgpt-business-1-bulan-tunvn' AND NOT EXISTS(SELECT 1 FROM products WHERE slug='chatgpt-tunvn');
UPDATE product_variants SET product_id=(SELECT id FROM products WHERE slug='chatgpt-tunvn')
WHERE sku IN ('TUNVN-86','TUNVN-83') AND EXISTS(SELECT 1 FROM products WHERE slug='chatgpt-tunvn');
UPDATE tunvn_products SET axvara_product_id=(SELECT id FROM products WHERE slug='chatgpt-tunvn')
WHERE supplier_product_id IN (86,83) AND EXISTS(SELECT 1 FROM products WHERE slug='chatgpt-tunvn');
UPDATE products SET is_active=0 WHERE slug IN ('chatgpt-business-1-bulan-tunvn','chatgpt-gpay-1-bulan-tunvn');
