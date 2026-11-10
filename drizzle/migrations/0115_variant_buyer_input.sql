ALTER TABLE product_variants ADD COLUMN buyer_field_key TEXT CHECK(buyer_field_key IS NULL OR buyer_field_key='muse_invite_code');
ALTER TABLE product_variants ADD COLUMN max_qty INTEGER CHECK(max_qty IS NULL OR (max_qty BETWEEN 1 AND 100));
ALTER TABLE telegram_carts ADD COLUMN buyer_fields TEXT NOT NULL DEFAULT '{}';

-- Old bundle identities remain available to historical order readers only.
UPDATE product_variants SET is_active=0 WHERE sku IN ('TUNVN-BUFF-5B','TUNVN-BUFF-10B','TUNVN-BUFF-20B','TUNVN-BUFF-30B');
INSERT INTO product_variants(product_id,sku,label,price,stock,fulfillment_mode,is_active,sort_order,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_markup_percent,tunvn_fx_idr_per_usdt,buyer_field_key,max_qty)
SELECT id,'TUNVN-BUFF-1B','Buff Token Muse AI per 1B',1500,-1,'manual',0,10,1,0.0588,40,18086,'muse_invite_code',30
FROM products WHERE slug='muse-ai-1-miliar-token' ON CONFLICT(sku) DO NOTHING;

-- Both admin editors share this per-variant publication gate; a product toggle
-- never has to turn an intentionally disabled sibling back on.
CREATE TRIGGER IF NOT EXISTS tunvn_variant_publication AFTER UPDATE OF is_active ON product_variants
WHEN NEW.sku IN ('TUNVN-86','TUNVN-83') BEGIN
  UPDATE tunvn_products SET publish_requested=NEW.is_active WHERE supplier_product_id=CAST(substr(NEW.sku,7) AS INTEGER);
END;
CREATE TRIGGER IF NOT EXISTS tunvn_retired_bundle_update BEFORE UPDATE OF is_active ON product_variants
WHEN NEW.sku IN ('TUNVN-BUFF-5B','TUNVN-BUFF-10B','TUNVN-BUFF-20B','TUNVN-BUFF-30B') AND NEW.is_active=1 BEGIN
  SELECT RAISE(ABORT,'retired_bundle');
END;
