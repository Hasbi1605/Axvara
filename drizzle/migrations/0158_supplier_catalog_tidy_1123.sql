-- 0158 — Kurasi fallback AIVault, StoreBat, dan TUNVN (23 November 2026).
-- Hanya ID + family fallback yang ditentukan; jangan migrasikan produk/varian
-- yang sudah diaktifkan admin. Pengecualian: iLovePDF #381 mempertahankan URL,
-- status, dan harga; hanya family/nama produk dan label varian lama berubah.

WITH rekey(id, old_key, new_key, sku, slug, name, category_id, image, default_id, copy_id, copy_en) AS (VALUES
  (51950, 'service:service_uned_mail', 'uned-mail', 'AV-service_uned_mail',
    'email-student-uned-av', 'Email Student UNED', 3, '/r2/products/c204df6e033ebd2e9f018f51e76f1a5e.webp',
    'UNED Student Email. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.',
    'Paket email pelajar UNED, universitas di Spanyol. Produk ini berupa akun email, bukan pendaftaran kuliah.',
    'Get a student email account from UNED, a university in Spain. This product is an email account, not university enrollment.'),
  (51945, 'product:142', 'langsmith', 'SB-142',
    'langsmith-sb', 'LangSmith Plus', 6, '/r2/products/9b461c09788050b6a28e42060cbbcffc.webp',
    'LangSmith Plus. Pilih varian sesuai kebutuhan. Harga dan stok dapat berubah.',
    'Gunakan LangSmith untuk menelusuri dan mengevaluasi aplikasi berbasis model bahasa. Produk ini menawarkan paket LangSmith Plus.',
    'Use LangSmith to trace and evaluate applications built with language models. This product is for the LangSmith Plus plan.'),
  (51959, 'p122', 'microsoft-copilot', 'TUNVN-122',
    'microsoft-copilot-tunvn', 'Microsoft Copilot Premium', 1, '/r2/products/a1701a94b1f47ce83ffd1c1527fb9c89.webp',
    'Copilot Premium 1M (FW). Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.',
    'Akses Microsoft Copilot Premium selama 1 bulan. Paket ini termasuk garansi penuh selama masa aktif.',
    'Get Microsoft Copilot Premium for 1 month. This plan includes full warranty coverage throughout the subscription period.')
)
UPDATE products AS p SET
  aivault_family = CASE WHEN p.aivault_family = r.old_key THEN r.new_key ELSE p.aivault_family END,
  storebat_family = CASE WHEN p.storebat_family = r.old_key THEN r.new_key ELSE p.storebat_family END,
  tunvn_family = CASE WHEN p.tunvn_family = r.old_key THEN r.new_key ELSE p.tunvn_family END,
  slug = r.slug, name = r.name, category_id = r.category_id,
  image_url = COALESCE(NULLIF(trim(p.image_url), ''), r.image),
  images = CASE WHEN p.images IS NULL OR trim(p.images) IN ('', '[]') THEN json_array(r.image) ELSE p.images END,
  description = CASE WHEN p.description = r.default_id THEN r.copy_id ELSE p.description END,
  -- The three fallback publishers never insert English copy.
  description_en = CASE WHEN p.description_en IS NULL OR p.description_en = '' THEN r.copy_en ELSE p.description_en END,
  updated_at = datetime('now')
FROM rekey r WHERE p.id = r.id AND p.is_active = 0 AND p.archived_at IS NULL
  AND ((r.id = 51950 AND p.aivault_family = r.old_key)
    OR (r.id = 51945 AND p.storebat_family = r.old_key)
    OR (r.id = 51959 AND p.tunvn_family = r.old_key))
  AND EXISTS(SELECT 1 FROM categories WHERE id = r.category_id)
  AND EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.sku = r.sku AND v.is_active = 0
    AND ((r.id = 51950 AND v.aivault_service_id = 'service_uned_mail')
      OR (r.id = 51945 AND v.storebat_product_id = 142)
      OR (r.id = 51959 AND v.tunvn_source_product_id = 122)))
  AND NOT EXISTS(SELECT 1 FROM products other WHERE other.id <> p.id AND (other.slug = r.slug
    OR (r.id = 51950 AND other.aivault_family = r.new_key)
    OR (r.id = 51945 AND other.storebat_family = r.new_key)
    OR (r.id = 51959 AND other.tunvn_family = r.new_key)));

-- A standalone variant gets its new label only under the canonical product.
WITH labels(product_id, sku, slug, family, old_label, label) AS (VALUES
  (51950, 'AV-service_uned_mail', 'email-student-uned-av', 'uned-mail', 'UNED Student Email', 'Email Student UNED (Spanyol)'),
  (51945, 'SB-142', 'langsmith-sb', 'langsmith', 'LangSmith Plus', 'Plus'),
  (51959, 'TUNVN-122', 'microsoft-copilot-tunvn', 'microsoft-copilot', 'Copilot Premium 1M (FW)', 'Premium 1 Bulan (Full Garansi)')
)
UPDATE product_variants AS v SET label = l.label, updated_at = datetime('now')
FROM labels l JOIN products p ON p.id = l.product_id AND p.slug = l.slug
WHERE v.product_id = p.id AND v.sku = l.sku AND v.label = l.old_label AND v.is_active = 0
  AND p.is_active = 0 AND p.archived_at IS NULL
  AND (('AV-'||v.aivault_service_id = l.sku AND p.aivault_family = l.family)
    OR ('SB-'||v.storebat_product_id = l.sku AND p.storebat_family = l.family)
    OR (v.tunvn_source_product_id = 122 AND p.tunvn_family = l.family));

UPDATE products SET aivault_family = 'ilovepdf', name = 'iLovePDF Premium'
WHERE id = 381 AND aivault_family = 'service:service_ilovepdf_1y'
  AND slug = 'ilovepdf-premium-1-year-1d779655-av' AND archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM products WHERE aivault_family = 'ilovepdf');

UPDATE product_variants SET label = 'Premium 1 Tahun'
WHERE product_id = 381 AND sku = 'AV-service_ilovepdf_1y' AND aivault_service_id = 'service_ilovepdf_1y'
  AND label <> 'Premium 1 Tahun'
  AND EXISTS(SELECT 1 FROM products WHERE id = 381 AND aivault_family = 'ilovepdf'
    AND slug = 'ilovepdf-premium-1-year-1d779655-av' AND archived_at IS NULL);

-- Keep the variant ID, price, stock, and inactive status. Do not modify the
-- destination product, even if active. TUNVN sort values match families.ts.
WITH moves(old_id, old_key, sku, new_id, new_slug, new_key, label, sort_order) AS (VALUES
  (51948, 'service:service_chatgpt_plus_1m_fw', 'AV-service_chatgpt_plus_1m_fw', 174, 'chatgpt-plus-av', 'chatgpt-plus', 'Plus 1 Bulan (Full Garansi)', NULL),
  (51957, 'product:143', 'SB-143', 394, 'chatgpt-plus-sb', 'chatgpt-plus', 'Plus 1 Bulan (Garansi 25 Hari)', NULL),
  (51949, 'service:service_ilovepdf_nw', 'AV-service_ilovepdf_nw', 381, 'ilovepdf-premium-1-year-1d779655-av', 'ilovepdf', 'Premium (Tanpa Garansi)', NULL),
  (51960, 'product:144', 'SB-144', 407, 'gemini-sb', 'gemini', 'CDK AI Pro 12 Bulan (V2)', NULL),
  (51947, 'p119', 'TUNVN-119', 123, 'capcut-pro-tunvn', 'capcut', 'Pro 7 Hari (200–500 Kredit)', 5),
  (51958, 'p121', 'TUNVN-121', 123, 'capcut-pro-tunvn', 'capcut', 'Pro 6 Hari (Full Garansi)', 6),
  (51956, 'p120', 'TUNVN-120', 112, 'muse-ai-1-miliar-token', NULL, 'Akun 1B Token (tanpa garansi)', 25)
)
UPDATE product_variants AS v SET product_id = m.new_id, label = m.label,
  sort_order = COALESCE(m.sort_order, v.sort_order), updated_at = datetime('now')
FROM moves m JOIN products source ON source.id = m.old_id
  JOIN products target ON target.id = m.new_id AND target.slug = m.new_slug
WHERE v.product_id = source.id AND v.sku = m.sku AND v.is_active = 0
  AND source.is_active = 0 AND source.archived_at IS NULL AND target.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM product_variants other WHERE other.product_id = source.id AND other.id <> v.id)
  AND ((m.old_id IN (51948,51949) AND source.aivault_family = m.old_key AND target.aivault_family = m.new_key
      AND 'AV-'||v.aivault_service_id = m.sku)
    OR (m.old_id IN (51957,51960) AND source.storebat_family = m.old_key AND target.storebat_family = m.new_key
      AND 'SB-'||v.storebat_product_id = m.sku)
    OR (m.old_id IN (51947,51956,51958) AND source.tunvn_family = m.old_key AND target.tunvn_family IS m.new_key
      AND target.source = 'manual' AND 'TUNVN-'||v.tunvn_source_product_id = m.sku));

-- Archive as in admin DELETE. No variant may remain on a merged fallback;
-- anomalous fallbacks may keep their variants, but only if already inactive.
WITH merged(old_id, old_key, sku, new_id) AS (VALUES
  (51948, 'service:service_chatgpt_plus_1m_fw', 'AV-service_chatgpt_plus_1m_fw', 174),
  (51957, 'product:143', 'SB-143', 394),
  (51949, 'service:service_ilovepdf_nw', 'AV-service_ilovepdf_nw', 381),
  (51960, 'product:144', 'SB-144', 407),
  (51947, 'p119', 'TUNVN-119', 123),
  (51956, 'p120', 'TUNVN-120', 112),
  (51958, 'p121', 'TUNVN-121', 123)
)
UPDATE products AS p SET archived_at = datetime('now'), is_active = 0, updated_at = datetime('now')
FROM merged m JOIN product_variants v ON v.product_id = m.new_id AND v.sku = m.sku
  JOIN products target ON target.id = m.new_id AND target.archived_at IS NULL
WHERE p.id = m.old_id AND p.is_active = 0 AND p.archived_at IS NULL AND v.is_active = 0
  AND NOT EXISTS(SELECT 1 FROM product_variants remaining WHERE remaining.product_id = p.id)
  AND ((m.old_id IN (51948,51949) AND p.aivault_family = m.old_key AND 'AV-'||v.aivault_service_id = m.sku)
    OR (m.old_id IN (51957,51960) AND p.storebat_family = m.old_key AND 'SB-'||v.storebat_product_id = m.sku)
    OR (m.old_id IN (51947,51956,51958) AND p.tunvn_family = m.old_key AND 'TUNVN-'||v.tunvn_source_product_id = m.sku));

UPDATE products AS p SET archived_at = datetime('now'), is_active = 0, updated_at = datetime('now')
WHERE (p.id, p.aivault_family) IN ((51951,'service:service_5'),(51952,'service:service_4'),
    (51953,'service:service_1'),(51954,'service:service_2'),(51955,'service:service_3'))
  AND p.is_active = 0 AND p.archived_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active <> 0);

-- Repoint mirror links only after the matching variant moved; otherwise the
-- next sync would repair them. No price/stock/markup changes here.
WITH moved(sid, old_id, new_id) AS (VALUES ('service_chatgpt_plus_1m_fw',51948,174),('service_ilovepdf_nw',51949,381))
UPDATE aivault_products AS a SET axvara_product_id = m.new_id
FROM moved m JOIN products old ON old.id = m.old_id AND old.aivault_family = 'service:'||m.sid AND old.archived_at IS NOT NULL
  JOIN product_variants v ON v.product_id = m.new_id AND v.aivault_service_id = m.sid AND v.sku = 'AV-'||m.sid
WHERE a.service_id = m.sid AND a.axvara_product_id = m.old_id AND v.is_active = 0;

WITH moved(sid, old_id, new_id) AS (VALUES (119,51947,123),(120,51956,112),(121,51958,123))
UPDATE tunvn_products AS t SET axvara_product_id = m.new_id, visible = 0
FROM moved m JOIN products old ON old.id = m.old_id AND old.tunvn_family = 'p'||m.sid AND old.archived_at IS NOT NULL
  JOIN product_variants v ON v.product_id = m.new_id AND v.tunvn_source_product_id = m.sid AND v.sku = 'TUNVN-'||m.sid
WHERE t.supplier_product_id = m.sid AND t.axvara_product_id = m.old_id AND v.is_active = 0;
