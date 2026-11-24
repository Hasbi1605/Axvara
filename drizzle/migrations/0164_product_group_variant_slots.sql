-- Migration 0164: variant-level competition slots inside merge_variants product groups (24 Nov 2026).
--
-- Within a merge_variants group, equivalent variants from different suppliers
-- can share a slot (product_group_slots + product_group_slot_members).
-- decideGroup/decideDirtyGroups/decideAllGroups automatically pick 1 winning
-- variant per slot using the same rules as product groups (Manual live ->
-- purchasable stock -> lowest normalized modal/30d -> group prefer/margin ->
-- position), hiding slot losers while non-slotted variants remain visible.
CREATE TABLE IF NOT EXISTS product_group_slots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id          INTEGER NOT NULL REFERENCES product_groups(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  winner_variant_id INTEGER,
  reason            TEXT,
  decided_at        TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_group_slots_group ON product_group_slots(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_group_slots_group_name ON product_group_slots(group_id, lower(name));

CREATE TABLE IF NOT EXISTS product_group_slot_members (
  slot_id    INTEGER NOT NULL REFERENCES product_group_slots(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL UNIQUE REFERENCES product_variants(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (slot_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_pg_slot_members_slot ON product_group_slot_members(slot_id);
