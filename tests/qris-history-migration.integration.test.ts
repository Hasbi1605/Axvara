import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { calculateCrc16, createDanaQrisInvoice } from "@/lib/payments/dana-qris";
import { NextRequest } from "next/server";
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey();
  await insertTestProduct(fixture.sql);
  // Reconstruct the deployed schema immediately before 0025.
  fixture.sql.exec(`DROP TRIGGER payment_invoice_history_insert;
    DROP TRIGGER payment_invoice_history_update;
    DROP TABLE payment_invoice_history; DROP TABLE dana_qris_legacy_ranges;
    ALTER TABLE payment_transactions DROP COLUMN invoice_issued_at;`);
  const qr = "00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED", "true"); vi.stubEnv("DANA_WEBHOOK_SECRET", "fixture");
  vi.stubEnv("DANA_STATIC_QRIS", qr+calculateCrc16(qr));
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "false"); vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function oldOrder(code: string, reissues: number, amount: number, base: number) {
  insertTestOrder(fixture.sql, code, { status: "kadaluarsa", channel: "web" });
  fixture.sql.prepare("UPDATE orders SET qris_reissue_count=? WHERE code=?").run(reissues,code);
  fixture.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,created_at,updated_at,expires_at)
    VALUES(?,'dana','dynamic-qris',?,'fixture',?,?,'expired',datetime('now','-1 hour'),datetime('now','-30 minutes'),datetime('now','-15 minutes'))`)
    .run(code,code,base,amount);
}
function migrate() { fixture.sql.exec(fs.readFileSync("drizzle/migrations/0025_qris_invoice_history.sql", "utf8")); }
it("backfills surviving invoice history, preserves terminal states, and marks only ranges with lost history", () => {
  oldOrder("OLD-REISSUED",2,10100,10000); oldOrder("OLD-INTACT",0,20042,20000);
  migrate();
  expect(fixture.sql.prepare("SELECT order_code,payable_amount FROM payment_invoice_history ORDER BY order_code").all())
    .toEqual([{order_code:"OLD-INTACT",payable_amount:20042},{order_code:"OLD-REISSUED",payable_amount:10100}]);
  expect(fixture.sql.prepare("SELECT min_amount,max_amount FROM dana_qris_legacy_ranges").all())
    .toEqual([{min_amount:10001,max_amount:10299}]);
  expect(fixture.sql.prepare("SELECT status FROM orders").all().every(r=>r.status==="kadaluarsa")).toBe(true);
  expect(fixture.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(fixture.sql.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
});
it("routes an unknowable old nominal to bank review instead of paying a new order", async () => {
  oldOrder("OLD-REISSUED",2,10100,10000); migrate();
  insertTestOrder(fixture.sql,"AXV-20260910-NEW00001",{channel:"web"});
  vi.spyOn(crypto,"getRandomValues").mockImplementation(array=>{(array as Uint32Array)[0]=41;return array;});
  const invoice = await createDanaQrisInvoice("AXV-20260910-NEW00001",10000);
  expect(invoice.payableAmount).toBe(10042); // absent from surviving rows, but uncertain
  const { POST } = await import("@/app/api/webhook/dana/route");
  const response=await POST(new NextRequest("http://localhost/api/webhook/dana",{
    method:"POST",headers:{"content-type":"application/json","x-webhook-secret":"fixture"},
    body:JSON.stringify({event_id:"delayed-unknown-old-qr",amount:10042}),
  }));
  expect(response.status).toBe(200);
  expect(fixture.sql.prepare("SELECT status FROM orders WHERE code='AXV-20260910-NEW00001'").get()!.status).toBe("pending");
  expect(fixture.sql.prepare("SELECT last_error FROM dana_webhook_events").get()!.last_error).toBe("amount_reused_requires_review");
  expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_invoice_history").get()!.n).toBe(2);
});
it("captures renewal time from old writers during the migrate-before-deploy interval", () => {
  oldOrder("OLD-WRITER",0,10042,10000); migrate();
  const original=fixture.sql.prepare("SELECT invoice_issued_at FROM payment_transactions WHERE order_code='OLD-WRITER'").get()!.invoice_issued_at;
  fixture.sql.prepare("UPDATE payment_transactions SET payable_amount=10100,expires_at=datetime('now','+15 minutes'),updated_at=datetime('now') WHERE order_code='OLD-WRITER'").run();
  const current=fixture.sql.prepare("SELECT invoice_issued_at FROM payment_transactions WHERE order_code='OLD-WRITER'").get()!.invoice_issued_at;
  expect(String(current)>String(original)).toBe(true);
  expect(fixture.sql.prepare("SELECT issued_at FROM payment_invoice_history WHERE order_code='OLD-WRITER' AND payable_amount=10042").get()!.issued_at).toBe(original);
  expect(fixture.sql.prepare("SELECT issued_at FROM payment_invoice_history WHERE order_code='OLD-WRITER' AND payable_amount=10100").get()!.issued_at).toBe(current);
});
