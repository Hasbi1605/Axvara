import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { runMaintenanceCleanup } from "@/lib/maintenance-cleanup";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  fixture.sql.exec("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,created_at) VALUES('old','h',1000,'matched',datetime('now','-40 days')),('recent','h',1000,'matched',datetime('now','-1 day'))");
});
afterEach(() => { fixture.close(); vi.useRealTimers(); });

it("only reads the completion marker on repeated ticks and keeps recent events", async () => {
  const db = createDatabaseAccess(fixture.db);
  expect((await runMaintenanceCleanup(db)).rows_cleaned).toBe(1);
  const reads = fixture.control.queries;
  expect(await runMaintenanceCleanup(db)).toMatchObject({ rows_cleaned: 0, cleanup_skipped: "interval" });
  expect(fixture.control.queries - reads).toBe(1);
  expect(fixture.sql.prepare("SELECT event_key FROM dana_webhook_events").all()).toEqual([{ event_key: "recent" }]);
  fixture.sql.exec("UPDATE store_settings SET value=datetime('now','-61 minutes') WHERE key='maintenance_cleanup_at'");
  expect(await runMaintenanceCleanup(db)).not.toHaveProperty("cleanup_skipped");
});

it("failed cleanup leaves no success marker and is retried on the next invocation", async () => {
  const db = createDatabaseAccess(fixture.db);
  fixture.control.fail = sql => sql.startsWith("DELETE FROM dana_webhook_events");
  await expect(runMaintenanceCleanup(db)).rejects.toThrow("Injected database interruption");
  expect(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='maintenance_cleanup_at'").get()).toBeUndefined();
  fixture.control.fail = null;
  expect((await runMaintenanceCleanup(db)).rows_cleaned).toBe(1);
});

it("an invalid or future marker cannot suppress housekeeping indefinitely", async () => {
  const db = createDatabaseAccess(fixture.db);
  fixture.sql.exec("INSERT INTO store_settings(key,value) VALUES('maintenance_cleanup_at','invalid')");
  expect((await runMaintenanceCleanup(db)).rows_cleaned).toBe(1);
  fixture.sql.exec("UPDATE store_settings SET value=datetime('now','+1 day') WHERE key='maintenance_cleanup_at'");
  expect(await runMaintenanceCleanup(db)).not.toHaveProperty("cleanup_skipped");
});
