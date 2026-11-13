-- 0119 — Purge data supplier ProviderSMM (keputusan owner 2026-11-13).
--
-- Idempoten dan FK-safe. D1 tidak bisa abort kondisional, jadi guard dihitung
-- SEKALI di awal ke tabel sementara dan setiap DELETE memakai guard itu.
-- Tidak menyentuh baris IndoSMM, Market, atau Games; tidak menyentuh kolom 0117
-- maupun pedia_tiers_archive0062*.
--
-- Guard order legacy (dua baris check-out Oktober 2026 yang kedaluwarsa dan
-- belum pernah dibayar/dikirim saat migrasi ini ditulis):
--   item  supplier='providersmm' AND status='expired' AND supplier_order_id IS NULL
--   order order_kind='pedia' AND paid_at IS NULL AND payment_status='expired'
--         AND status IN ('expired','kadaluarsa')
-- Item/order yang tidak cocok guard TIDAK dihapus, sehingga tier/produknya juga
-- bertahan (langkah 3 hanya menghapus tier tanpa referensi order).

-- 0. Guard order + produk yang SELALU hanya punya tier ProviderSMM (dihitung
--    sebelum tier dihapus).
DROP TABLE IF EXISTS _psmm_purge_orders;
CREATE TABLE _psmm_purge_orders (order_code TEXT PRIMARY KEY);
INSERT OR IGNORE INTO _psmm_purge_orders (order_code)
  SELECT o.code FROM orders o JOIN pedia_order_items i ON i.order_code=o.code
   WHERE i.supplier='providersmm' AND i.status='expired' AND i.supplier_order_id IS NULL
     AND o.order_kind='pedia' AND o.paid_at IS NULL AND o.payment_status='expired'
     AND o.status IN ('expired','kadaluarsa')
     -- Hardening review PM: only purge when EVERY item of the order matches the
     -- item guard; a mixed ProviderSMM/IndoSMM order must survive untouched.
     AND NOT EXISTS (
       SELECT 1 FROM pedia_order_items x
        WHERE x.order_code=o.code
          AND NOT (x.supplier='providersmm' AND x.status='expired' AND x.supplier_order_id IS NULL));

DROP TABLE IF EXISTS _psmm_purge_products;
CREATE TABLE _psmm_purge_products (product_id INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO _psmm_purge_products (product_id)
  SELECT product_id FROM pedia_tiers
   WHERE supplier='providersmm'
   GROUP BY product_id
  HAVING SUM(CASE WHEN supplier<>'providersmm' THEN 1 ELSE 0 END)=0;

-- 1. Dependen order legacy, anak sebelum induk.
DELETE FROM payment_invoice_history WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM payment_transactions    WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM dana_webhook_events     WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM fulfillment_items       WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM fulfillment_jobs        WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM order_item_costs        WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM payment_proofs          WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM wr_order_links          WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM wr_credential_tokens    WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM wr_email_forward_log    WHERE axvara_order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM sk_order_links          WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM order_contact_attempts  WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM pedia_followups         WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM games_order_items       WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM games_dispatch_attempts WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM tunvn_order_links       WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM buyer_notice_log        WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM pedia_credit_ledger     WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
-- Kredit bersumber order legacy hanya dihapus bila tidak ada lagi baris ledger.
DELETE FROM pedia_credits
 WHERE source_order_code IN (SELECT order_code FROM _psmm_purge_orders)
   AND NOT EXISTS (SELECT 1 FROM pedia_credit_ledger l WHERE l.credit_id=pedia_credits.id);
DELETE FROM checkout_claims WHERE quote_id IN (
  SELECT o.quote_id FROM orders o WHERE o.code IN (SELECT order_code FROM _psmm_purge_orders));
DELETE FROM pedia_order_items WHERE order_code IN (SELECT order_code FROM _psmm_purge_orders);
DELETE FROM orders            WHERE code IN (SELECT order_code FROM _psmm_purge_orders);

-- 2. Tier ProviderSMM tanpa referensi order; lalu produk yang hanya berisi tier
--    supplier lama dan kini tidak punya tier/order sama sekali.
DELETE FROM pedia_tiers
 WHERE supplier='providersmm'
   AND NOT EXISTS (SELECT 1 FROM pedia_order_items i WHERE i.tier_id=pedia_tiers.id);
DELETE FROM pedia_products
 WHERE NOT EXISTS (SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id)
   AND NOT EXISTS (SELECT 1 FROM pedia_order_items i WHERE i.product_id=pedia_products.id)
   AND (managed='auto' OR slug LIKE 'psmm-%'
        OR id IN (SELECT product_id FROM _psmm_purge_products));

-- 3. Mirror/statistik/saldo supplier lama.
DELETE FROM pedia_supplier_services   WHERE supplier='providersmm';
DELETE FROM pedia_service_stats       WHERE supplier='providersmm';
DELETE FROM pedia_supplier_balance_log WHERE supplier='providersmm';

-- 4. Penanda/marker milik supplier lama. Prefix pedia_indosmm_* TIDAK disentuh.
DELETE FROM store_settings
 WHERE key IN ('pedia_diff_last_at','pedia_diff_last_change_at',
               'pedia_balance_alert_at','pedia_balance_checked_at',
               'pedia_psmm_desc_last_at','pedia_psmm_desc_snapshot',
               'pedia_managed_pending')
    OR key LIKE 'pedia_pending:%'
    OR key LIKE 'pedia_psmm_%'
    OR key LIKE 'pedia_managed_%'
    OR key LIKE 'pedia_diff_%';

DROP TABLE IF EXISTS _psmm_purge_orders;
DROP TABLE IF EXISTS _psmm_purge_products;
