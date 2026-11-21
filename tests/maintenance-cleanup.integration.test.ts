import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
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

it("prunes at most 200 expired admission keys and counters while preserving current retries", async () => {
  const now = Date.now(), old = now - 2 * 24 * 60 * 60_000;
  for (let n = 0; n < 205; n++) {
    fixture.sql.prepare("INSERT INTO checkout_claims VALUES(?,?,?)").run(`old-${n}`, "fixture", old);
    fixture.sql.prepare("INSERT INTO checkout_attempts VALUES('ip',?,?,1)").run(`old-${n}`, Math.floor(old / 900_000));
  }
  fixture.sql.prepare("INSERT INTO checkout_claims VALUES('current','fixture',?)").run(now);
  fixture.sql.prepare("INSERT INTO checkout_attempts VALUES('ip','current',?,1)").run(Math.floor(now / 900_000));
  await runMaintenanceCleanup(createDatabaseAccess(fixture.db));
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM checkout_claims").get()?.n).toBe(6);
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM checkout_attempts").get()?.n).toBe(6);
  expect(fixture.sql.prepare("SELECT quote_id FROM checkout_claims WHERE quote_id='current'").get()).toBeDefined();
});

describe("FX-16 AU-G2-7 pure-log retention", () => {
  beforeEach(() => { fixture.sql.exec("UPDATE store_settings SET value=datetime('now','-61 minutes') WHERE key='maintenance_cleanup_at'"); });
  const cleanup = () => runMaintenanceCleanup(createDatabaseAccess(fixture.db));

  it("prunes supplier sync logs >30d but keeps the latest row per type/status", async () => {
    for (const [type, status] of [["products", "success"], ["products", "partial"], ["saldo", "success"]]) {
      fixture.sql.prepare("INSERT INTO wr_sync_log(sync_type,status,created_at) VALUES(?,?,datetime('now','-60 days'))").run(type, status);
      fixture.sql.prepare("INSERT INTO sk_sync_log(sync_type,status,created_at) VALUES(?,?,datetime('now','-60 days'))").run(type, status);
    }
    fixture.sql.prepare("INSERT INTO wr_sync_log(sync_type,status,duration_ms) VALUES('products','success',1)").run();
    fixture.sql.prepare("INSERT INTO sk_sync_log(sync_type,status,duration_ms) VALUES('products','success',1)").run();
    await cleanup();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM wr_sync_log").get()?.n).toBe(3); // latest per type/status
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM sk_sync_log").get()?.n).toBe(3);
    for (const row of fixture.sql.prepare("SELECT sync_type,status FROM wr_sync_log ORDER BY id").all()) expect(row).toEqual(expect.objectContaining({ sync_type: expect.any(String), status: expect.any(String) }));
  });

  it("prunes balance logs >30d and keeps the newest row per source/supplier", async () => {
    for (const source of ["api_check", "order_deduct"]) fixture.sql.prepare("INSERT INTO wr_saldo_log(balance,source,created_at) VALUES(1,?,datetime('now','-45 days'))").run(source);
    for (const source of ["api_check", "low_alert"]) fixture.sql.prepare("INSERT INTO sk_saldo_log(balance,source,created_at) VALUES(1,?,datetime('now','-45 days'))").run(source);
    fixture.sql.prepare("INSERT INTO pedia_supplier_balance_log(supplier,balance,created_at) VALUES('indosmm',1,datetime('now','-45 days'))").run();
    fixture.sql.prepare("INSERT INTO pedia_supplier_balance_log(supplier,balance,created_at) VALUES('indosmm',2,datetime('now','-45 days'))").run();
    await cleanup();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM wr_saldo_log").get()?.n).toBe(2);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM sk_saldo_log").get()?.n).toBe(2);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM pedia_supplier_balance_log").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT balance FROM pedia_supplier_balance_log").get()?.balance).toBe(2);
  });

  it("prunes telegram_updates >14d (dedupe window is hours) and keeps recent ones", async () => {
    fixture.sql.exec("INSERT INTO telegram_updates(update_id,status,created_at,updated_at) VALUES('old','done',datetime('now','-20 days'),datetime('now','-20 days')),('recent','done',datetime('now','-2 days'),datetime('now','-2 days'))");
    await cleanup();
    expect(fixture.sql.prepare("SELECT update_id FROM telegram_updates ORDER BY update_id").all()).toEqual([{ update_id: "recent" }]);
  });

  it("prunes broadcast deliveries >90d for FINISHED campaigns only, never active queues", async () => {
    fixture.sql.exec(`INSERT INTO broadcast_templates(id,name,title,body) VALUES('t','n','t','b');
      INSERT INTO broadcast_campaigns(id,fingerprint,template_id,template_revision,snapshot_json,channels_json,status,created_by)
        VALUES('done','f','t',1,'{}','[]','completed','a'),('live','f','t',1,'{}','[]','queued','a');
      INSERT INTO broadcast_deliveries(campaign_id,channel,recipient_id,destination,status,updated_at)
        VALUES('done','email','1','x@y','sent',datetime('now','-120 days')),
               ('done','email','2','x@y','sent',datetime('now','-10 days')),
               ('live','email','3','x@y','pending',datetime('now','-120 days'))`);
    await cleanup();
    const ids = fixture.sql.prepare("SELECT recipient_id,status FROM broadcast_deliveries ORDER BY recipient_id").all();
    expect(ids).toEqual([{ recipient_id: "2", status: "sent" }, { recipient_id: "3", status: "pending" }]);
  });

  it("never touches money/order/notice ledgers or webhook evidence under review", async () => {
    fixture.sql.exec(`INSERT INTO payment_invoice_history(provider,order_code,payable_amount,issued_at) VALUES('dana','AXV-OLD',1000,datetime('now','-200 days'));
      INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status,created_at) VALUES('notice-old','AXV-OLD','email','sent',datetime('now','-200 days'));
      INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,created_at) VALUES('AXV-OLD','B','628000000000','[]',1000,'qris','lunas','paid',datetime('now','-200 days'));
      INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,created_at) VALUES('unresolved','h',1000,'received',datetime('now','-400 days'));`);
    await cleanup();
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM buyer_notice_log").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM dana_webhook_events WHERE event_key='unresolved'").get()?.n).toBe(1);
  });

  it("prunes within the caller's statement ceiling instead of throwing, and resumes next tick", async () => {
    fixture.sql.exec("INSERT INTO telegram_updates(update_id,status,created_at,updated_at) VALUES('old','done',datetime('now','-20 days'),datetime('now','-20 days'))");
    // Core = marker read + 8 deletes (9 used). With reserve 1 the ceiling is 11,
    // so only the first prune fits (needs 2 free until the marker); the rest
    // skip instead of throwing, and the next tick resumes them.
    const budget = createBudgetedDatabase(12, 1, fixture.db);
    await runMaintenanceCleanup(budget.access); // must not throw QueryBudgetExceeded
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM telegram_updates").get()?.n).toBe(1);
    fixture.sql.exec("UPDATE store_settings SET value=datetime('now','-61 minutes') WHERE key='maintenance_cleanup_at'");
    await runMaintenanceCleanup(createDatabaseAccess(fixture.db));
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM telegram_updates").get()?.n).toBe(0);
  });
});
