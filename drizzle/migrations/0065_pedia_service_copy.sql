-- Copy publik terstruktur; snapshot pesanan lama tetap utuh.
ALTER TABLE pedia_tiers ADD COLUMN terms_md TEXT;
ALTER TABLE pedia_tiers ADD COLUMN instructions_md TEXT;
ALTER TABLE pedia_tiers ADD COLUMN recommendation_note TEXT;
ALTER TABLE pedia_tiers ADD COLUMN min_qty_override INTEGER;
ALTER TABLE pedia_tiers ADD COLUMN max_qty_override INTEGER;
ALTER TABLE pedia_tiers ADD COLUMN quantity_step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pedia_tiers ADD COLUMN target_format TEXT NOT NULL DEFAULT 'url';
ALTER TABLE pedia_tiers ADD COLUMN refill_anchor TEXT NOT NULL DEFAULT 'created';
ALTER TABLE pedia_order_items ADD COLUMN completed_at TEXT;
ALTER TABLE pedia_order_items ADD COLUMN credit_return_token TEXT;
