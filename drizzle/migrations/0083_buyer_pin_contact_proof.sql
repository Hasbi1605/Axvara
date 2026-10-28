-- Old writers default to 0 during rollout; only new contact+PIN proof writes
-- the current access generation. Legacy/code26 capabilities remain compatible.
ALTER TABLE wr_credential_tokens ADD COLUMN buyer_access_version INTEGER NOT NULL DEFAULT 0
  CHECK(buyer_access_version >= 0);
