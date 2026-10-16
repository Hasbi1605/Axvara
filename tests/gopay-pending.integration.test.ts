import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createGopayQrisInvoice } from "@/lib/payments/dana-qris";
import { GET } from "@/app/api/webhook/gopay/pending/route";

vi.mock("@/lib/payments/gopay-wake", () => ({ scheduleGopayWake: vi.fn() }));
let fixture: ReturnType<typeof createD1Fixture>;
const base = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI51440014ID.CO.QRIS.WWW0215ID10111111111110303UMI5204899953033605802ID5911AXVARA TEST6006SLEMAN61055558162070703A016304";
const source = (id: string) => { const payload = base.replace("G111111111", id); return payload + calculateCrc16(payload); };
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey(); await insertTestProduct(fixture.sql);
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_STATIC_QRIS", source("G111111111"));
  vi.stubEnv("GOPAY_POLLER_SECRET", "fixture-secret");
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const request = (secret = "fixture-secret") => GET(new NextRequest("http://localhost/api/webhook/gopay/pending", { headers: { "x-poller-secret": secret } }));
async function invoice(code: string) { insertTestOrder(fixture.sql, code); return createGopayQrisInvoice(code, 10_000); }

it("keeps old and new invoices bound to their stored merchant when the configured QR changes", async () => {
  const old = await invoice("AXV-20261016-OLDQR001");
  vi.stubEnv("GOPAY_STATIC_QRIS", source("G222222222"));
  await invoice("AXV-20261016-NEWQR001");
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.pending).toEqual(expect.arrayContaining([
    expect.objectContaining({ order_code: old.orderCode, merchant_id: "G111111111" }),
    expect.objectContaining({ order_code: "AXV-20261016-NEWQR001", merchant_id: "G222222222" }),
  ]));
  expect(body.pending).toHaveLength(2);
  expect(JSON.stringify(body)).not.toContain("COM.GO-JEK.WWW");
  expect(JSON.stringify(body)).not.toContain("fixture-secret");
  expect((await createGopayQrisInvoice(old.orderCode, 10_000)).qrisPayload).toBe(old.qrisPayload);
});

it("exposes an unknown merchant explicitly for a damaged invoice instead of using current configuration", async () => {
  const old = await invoice("AXV-20261016-BADQR001");
  fixture.sql.prepare("UPDATE payment_transactions SET qris_payload='corrupt' WHERE order_code=?").run(old.orderCode);
  expect((await (await request()).json()).pending[0].merchant_id).toBeNull();
});

it("keeps the pending endpoint secret-protected and excludes expired and terminal invoices", async () => {
  const old = await invoice("AXV-20261016-EXPQR001");
  expect((await request("wrong")).status).toBe(401);
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','-1 minute') WHERE order_code=?").run(old.orderCode);
  expect((await (await request()).json()).pending).toEqual([]);
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=datetime('now','+15 minutes'),status='expired' WHERE order_code=?").run(old.orderCode);
  expect((await (await request()).json()).pending).toEqual([]);
});

it("uses the active invoice index despite a large paid GoPay history", async () => {
  const active = await invoice("AXV-20261016-LIVE0001");
  for (let i = 0; i < 300; i++) {
    const code = `AXV-20261016-HIST${String(i).padStart(4, "0")}`;
    insertTestOrder(fixture.sql, code);
    fixture.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
      VALUES(?,'gopay','dynamic',?,'m',10000,10000,'paid',datetime('now','-1 day'))`).run(code, `history-${i}`);
  }
  let captured = "";
  fixture.control.fail = (sql) => { if (sql.includes("AS issued_at")) captured = sql; return false; };
  expect((await (await request()).json()).pending).toEqual([expect.objectContaining({ order_code: active.orderCode })]);
  const plan = fixture.sql.prepare(`EXPLAIN QUERY PLAN ${captured}`).all();
  expect(plan.some(row => String(row.detail).includes("payment_transactions_active_gopay_amount"))).toBe(true);
  expect(plan.some(row => String(row.detail).includes("idx_payment_amount_history"))).toBe(false);
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2024-11-01", d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.batch([
      db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY,status TEXT,expires_at TEXT)"),
      db.prepare("CREATE TABLE payment_transactions(order_code TEXT,provider TEXT,status TEXT,payable_amount INTEGER,expires_at TEXT,qris_payload TEXT,invoice_issued_at TEXT,created_at TEXT)"),
      db.prepare("CREATE UNIQUE INDEX payment_transactions_active_gopay_amount ON payment_transactions(payable_amount) WHERE provider='gopay' AND status IN ('initializing','pending')"),
      db.prepare("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO orders SELECT 'H'||x,'lunas',datetime('now','-1 day') FROM n"),
      db.prepare("INSERT INTO payment_transactions SELECT code,'gopay','paid',10000,expires_at,NULL,NULL,datetime('now','-1 day') FROM orders"),
    ]);
    const empty = await db.prepare(captured).all();
    expect(empty.results).toEqual([]);
    expect(empty.meta.rows_read).toBeLessThan(8);
    await db.batch([
      db.prepare("INSERT INTO orders VALUES('LIVE','pending',datetime('now','+15 minutes'))"),
      db.prepare("INSERT INTO payment_transactions VALUES('LIVE','gopay','pending',10001,datetime('now','+15 minutes'),'stored-qr',NULL,datetime('now'))"),
    ]);
    const live = await db.prepare(captured).all();
    expect(live.results).toEqual([expect.objectContaining({ order_code: "LIVE", qris_payload: "stored-qr" })]);
    expect(live.meta.rows_read).toBeLessThan(12);
  } finally { await runtime.dispose(); }
});
