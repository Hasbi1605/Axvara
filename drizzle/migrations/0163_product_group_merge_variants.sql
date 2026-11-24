-- Migration 0163: per-group display mode ('winner' | 'merge_variants') on product_groups (24 Nov 2026).
--
-- Default 'winner' preserves existing 1-winner behavior for all existing groups.
-- 'merge_variants' keeps 1 canonical storefront card (winner_product_id) while
-- aggregating active variants from all active non-archived group members; each
-- variant retains its real owning products.id for supplier sync, markup, quote,
-- checkout eligibility, auto-dispatch, and financial reporting.
ALTER TABLE product_groups
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'winner' CHECK (mode IN ('winner', 'merge_variants'));

CREATE INDEX IF NOT EXISTS idx_product_groups_mode_winner
  ON product_groups(mode, winner_product_id);
