import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

const notify = vi.hoisted(() => ({
  telegram: vi.fn(async (_: unknown) => ({ ok: true })),
  pin: vi.fn(async (_db: unknown, _n: number, _now: unknown, options: { hasTime: (ms: number) => boolean }) => ({ sent: Number(options.hasTime(9_000)) })),
  wa: vi.fn(async () => ({ sent: Number(Date.now() - notify.started < 30_000), dead: 0 })),
  started: 0,
}));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: notify.telegram }));
vi.mock("@/lib/orders/access-email", () => ({ processCredentialAccessEmails: notify.pin }));
vi.mock("@/lib/whatsapp/outbox", async original => ({ ...await original<object>(), processDueWhatsAppOutbox: notify.wa }));

let f: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  f = createD1Fixture();
  vi.stubEnv("CRON_SECRET", "fx1");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network in fixture"); }));
  vi.clearAllMocks();
  notify.telegram.mockImplementation(async () => ({ ok: true }));
  await insertTestProduct(f.sql, "unique");
});
afterEach(() => { f.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function call(path: string) {
  const { POST } = path.startsWith("lite") ? await import("@/app/api/cron/lite/route") : await import("@/app/api/cron/operations/route");
  const response = await POST(new NextRequest(`http://localhost/api/cron/${path}`, { method: "POST", headers: { authorization: "Bearer fx1" } }));
  expect(response.status).toBe(200);
  return response.json();
}

function payment(code: string, provider: string, id: string | null, status = "initializing", age = "-6 minutes", expiry = "+25 minutes") {
  insertTestOrder(f.sql, code);
  f.sql.prepare("UPDATE orders SET expires_at=datetime('now',?) WHERE code=?").run(expiry, code);
  f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,
    status,provider_payment_id,created_at,expires_at) VALUES(?,?,'merchant',?,'fixture',10000,10000,?,?,datetime('now',?),datetime('now',?))`)
    .run(code, provider, code, status, id, age, expiry);
}

it.each(["operations?phase=expiry", "lite?job=expiry"])("keeps recoverable claims and cancels unknown stale claims: %s", async path => {
  payment("np-known", "nowpayments", "12345");
  payment("gateway-claim", "sekalipay_gateway", null);
  payment("np-unknown", "nowpayments", null);
  payment("np-late", "nowpayments", "12346");
  f.sql.exec("UPDATE orders SET status='dibatalkan' WHERE code='np-late'");
  expect(await call(path)).toMatchObject({ stale_initializing: 1 });
  const statuses = f.sql.prepare("SELECT code,o.status,pt.status AS ledger FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code ORDER BY o.rowid").all();
  expect(statuses).toEqual([
    { code: "np-known", status: "pending", ledger: "initializing" },
    { code: "gateway-claim", status: "pending", ledger: "initializing" },
    { code: "np-unknown", status: "dibatalkan", ledger: "failed" },
    { code: "np-late", status: "dibatalkan", ledger: "initializing" },
  ]);
});

it.each(["operations?phase=expiry", "lite?job=expiry"])("rechecks NOWPayments provider ID in expiry batch: %s", async path => {
  payment("np-race", "nowpayments", null);
  const batch = f.db.batch.bind(f.db);
  f.db.batch = async statements => {
    f.sql.exec("UPDATE payment_transactions SET provider_payment_id='12345' WHERE order_code='np-race'");
    return batch(statements);
  };
  expect(await call(path)).toMatchObject({ stale_initializing: 0 });
  expect(f.sql.prepare("SELECT status FROM orders WHERE code='np-race'").get()?.status).toBe("pending");
  expect(f.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
});

it("manual fulfillment converges on three unique units and stays idempotent without sending", async () => {
  insertTestOrder(f.sql, "unique", { status: "lunas", items: [{ product_id: 1, variant_id: 1, qty: 3, unique_units: true, fulfillment_mode: "unique" }] });
  f.sql.exec("INSERT INTO fulfillment_jobs(order_code) VALUES('unique')");
  const list = () => f.sql.prepare("SELECT item_index,qty FROM fulfillment_items WHERE order_code='unique' ORDER BY item_index").all();
  await call("operations?phase=fulfillment");
  expect(list()).toHaveLength(2);
  await call("operations?phase=fulfillment");
  expect(list()).toEqual([0, 1, 2].map(item_index => ({ item_index, qty: 1 })));
  await call("operations?phase=fulfillment");
  expect(list()).toHaveLength(3);
  expect(notify.telegram).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

function settlement(code: string, jobStatus: string, itemStatus: string | null, count = 1) {
  insertTestOrder(f.sql, code, { status: "lunas", items: Array.from({ length: count }, () => ({ product_id: 1, variant_id: 1, qty: 1 })) });
  f.sql.prepare("UPDATE orders SET fulfillment_status='manual_required' WHERE code=?").run(code);
  f.sql.prepare("INSERT INTO fulfillment_jobs(order_code,status,last_error) VALUES(?,?,'fixture')").run(code, jobStatus);
  if (itemStatus) f.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
    VALUES(?,0,1,1,1,'unique','telegram',?)`).run(code, itemStatus);
}

it("repairs terminal aggregates only for a complete, all-delivered manifest", async () => {
  settlement("mixed", "manual_required", "delivered", 2);
  f.sql.exec(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
    VALUES('mixed',1,1,1,1,'unique','telegram','manual_required')`);
  settlement("incomplete", "manual_required", "delivered", 2);
  settlement("empty", "delivered", null);
  settlement("done", "manual_required", "delivered");
  settlement("failed-job", "failed", "delivered");
  expect(await call("operations?phase=fulfillment")).toMatchObject({ fulfillment_aggregates_repaired: 2 });
  const state = f.sql.prepare("SELECT o.fulfillment_status AS o,fj.status AS j FROM orders o JOIN fulfillment_jobs fj ON fj.order_code=o.code WHERE o.code=?");
  for (const code of ["done", "failed-job"]) expect(state.get(code)).toEqual({ o: "delivered", j: "delivered" });
  for (const code of ["mixed", "incomplete"]) expect(state.get(code)).toEqual({ o: "manual_required", j: "manual_required" });
  expect(state.get("empty")).toEqual({ o: "manual_required", j: "delivered" });
  expect(await call("operations?phase=fulfillment")).toMatchObject({ fulfillment_aggregates_repaired: 0 });
  expect(fetch).not.toHaveBeenCalled();
});

it("does not settle either aggregate when an item changes after the selection", async () => {
  settlement("race", "manual_required", "delivered");
  const batch = f.db.batch.bind(f.db);
  let competed = false;
  f.db.batch = async statements => {
    competed = true;
    f.sql.exec("UPDATE fulfillment_items SET status='manual_required' WHERE order_code='race'");
    return batch(statements);
  };
  expect(await call("operations?phase=fulfillment")).toMatchObject({ fulfillment_aggregates_repaired: 0 });
  expect(competed).toBe(true);
  expect(f.sql.prepare("SELECT status FROM fulfillment_jobs WHERE order_code='race'").get()?.status).toBe("manual_required");
  expect(f.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='race'").get()?.fulfillment_status).toBe("manual_required");
});

it("prunes only old webhook events outside the shared review queue", async () => {
  const { runMaintenanceCleanup } = await import("@/lib/maintenance-cleanup");
  const { PAYMENT_ATTENTION_WHERE } = await import("@/lib/admin-overview-queries");
  const insert = f.sql.prepare("INSERT INTO dana_webhook_events(event_key,payload_hash,amount,status,reviewed_by,created_at) VALUES(?,'fixture',10000,?,?,datetime('now',?))");
  for (const status of ["received", "ignored", "failed", "matched"]) insert.run(status, status, null, "-45 days");
  insert.run("reviewed", "ignored", "fixture-admin", "-45 days");
  insert.run("recent", "matched", null, "-1 day");
  await runMaintenanceCleanup(createDatabaseAccess());
  expect(f.sql.prepare(`SELECT event_key FROM dana_webhook_events WHERE ${PAYMENT_ATTENTION_WHERE} ORDER BY id`).all().map(r => r.event_key)).toEqual(["received", "ignored", "failed"]);
  expect(f.sql.prepare("SELECT event_key FROM dana_webhook_events ORDER BY id").all().map(r => r.event_key)).toEqual(["received", "ignored", "failed", "recent"]);
});

it("gives both PIN emails and WA outbox time even with six slow Telegram reminders", async () => {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
  for (let i = 0; i < 6; i++) payment(`reminder-${i}`, "klikqris", null, "pending", "-12 minutes", "+3 minutes");
  notify.started = Date.now();
  vi.useFakeTimers({ toFake: ["Date"] });
  notify.telegram.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + 10_000);
    return { ok: true };
  });
  expect(await call("lite?job=notify_b")).toMatchObject({ checkout_pin_emails: { sent: 1 }, whatsapp_outbox: { sent: 1 } });
  expect(notify.pin).toHaveBeenCalledOnce();
  expect(notify.wa).toHaveBeenCalledOnce();
  expect(notify.telegram.mock.calls.length).toBeGreaterThan(0);
  expect(notify.telegram.mock.calls.length).toBeLessThan(6);
  expect(Date.now() - notify.started).toBeLessThan(45_000);
});
