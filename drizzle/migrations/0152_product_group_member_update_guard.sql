-- 0152_product_group_member_update_guard.sql — audit AU-G2-3 (21 Nov 2026).
--
-- pg_member_valid_insert only guards INSERT. An UPDATE of
-- product_group_members.product_id could still move a member onto an archived
-- (hidden) product, so the invariant the trigger name claims was incomplete.
-- The app never re-points a member this way (membership changes are delete +
-- insert in src/lib/product-groups.ts), but the storage boundary must hold for
-- manual SQL and future writers too.
--
-- Additive and idempotent: only creates a new BEFORE UPDATE trigger. Archiving a
-- product stays allowed (it updates products, not members); the archived member
-- row is filtered by the winner/aggregate logic as before.
CREATE TRIGGER IF NOT EXISTS pg_member_valid_update
BEFORE UPDATE OF product_id ON product_group_members
WHEN NEW.product_id IS NOT OLD.product_id
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND archived_at IS NULL)
    THEN RAISE(ABORT,'invalid_group_product') END;
END;
