import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { ensureFulfillmentForPaidOrder, processJob, ensureFulfillmentItems, createFulfillmentJob } from "@/lib/fulfillment/deliver";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/internal/queue/fulfill/route";
const send = vi.hoisted(() => vi.fn(async () => ({ ok: true, result: { message_id: 1 } })));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: send }));
let f: ReturnType<typeof createD1Fixture>;
const code = "AXV-20261118-DEADLINE";
beforeEach(() => {
  f = createD1Fixture(); stubFulfillmentKey(); send.mockClear();
  f.sql.exec("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')");
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true"); vi.stubEnv("TELEGRAM_BOT_ENABLED", "false"); vi.stubEnv("CRON_SECRET", "fixture");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fixture forbids network"); }));
});
afterEach(() => { f.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function seed(mode: string) {
  const secret = await encryptSecret("fixture credential");
  const lines = [1, 2].map(id => ({ product_id: id, variant_id: id, qty: 1, price: 10000 }));
  for (const id of [1, 2]) {
    f.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(?,?,?,10000,10)").run(id, `Fixture ${id}`, `fixture-${id}`);
    f.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv)
      VALUES(?,?,?,?,10000,10,?,?,?)`).run(id, id, `sku-${id}`, "Fixture", mode, secret.ciphertext, secret.iv);
    if (mode === "unique") f.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code) VALUES(?,?,?,?,?,'reserved',?)")
      .run(id, id, secret.ciphertext, secret.iv, `fingerprint-${id}`, code);
  }
  f.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,fulfillment_status)
    VALUES(?,'Fixture','6280',?,20000,'qris','lunas','paid','telegram','12345','12345','queued')`).run(code, JSON.stringify(lines));
  const db = createDatabaseAccess(), order = await db.queryFirst("SELECT * FROM orders WHERE code=?", code), product = await db.queryFirst("SELECT * FROM products WHERE id=1");
  await ensureFulfillmentItems(order!); await createFulfillmentJob(code, null, mode);
  return { db, order: order!, product: product!, job: Number(f.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code=?").get(code)!.id) };
}
for (const mode of ["shared", "unique"]) {
  it(`${mode}: expired absolute deadline starts no item`, async () => {
    const s = await seed(mode);
    expect(await processJob(s.job, s.order, s.product, s.db, Date.now() - 1)).toBe(false);
    expect(await ensureFulfillmentForPaidOrder(code, Date.now() - 1)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(f.sql.prepare("SELECT COUNT(*) n FROM fulfillment_items WHERE status='queued'").get()?.n).toBe(2);
  });
  it(`${mode}: crossing absolute deadline after first item leaves the next one untouched`, async () => {
    await seed(mode); const start = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => start);
    send.mockImplementationOnce(async () => { vi.mocked(Date.now).mockReturnValue(start + 41_000); return { ok: true, result: { message_id: 1 } }; });
    const response = await POST(new NextRequest("https://fixture/api/internal/queue/fulfill", { method: "POST", headers: { authorization: "Bearer fixture" },
      body: JSON.stringify({ v: 1, kind: "order_paid", orderCode: code, orderKind: "apps", source: "fixture", attempt: 1, dryRun: false }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ settled: false, retrySec: 60 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.sql.prepare("SELECT status FROM fulfillment_items WHERE item_index=1").get()?.status).toBe("queued");
  });
  it(`${mode}: no deadline preserves the old full direct pass`, async () => {
    const s = await seed(mode);
    expect(await processJob(s.job, s.order, s.product, s.db)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
}
