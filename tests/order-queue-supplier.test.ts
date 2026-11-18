import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { ensureFulfillmentItems } from "@/lib/fulfillment/deliver";
import { handleWrOrderCompleted, handleJaspayTerminal } from "@/lib/warung-rebahan/deliver";
import { handleSkOrderCompleted } from "@/lib/sekalipay/deliver";
import { applyGamesTransactionResult } from "@/lib/games/dispatch";
import { createDatabaseAccess } from "@/lib/db-access";
const send = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => ({ env: { ORDER_FULFILLMENT_QUEUE: { send } }, ctx: { waitUntil: vi.fn() } }) }));
let f: ReturnType<typeof createD1Fixture>;
const code = "AXV-20261118-SUPPLIER";
beforeEach(async () => {
  f = createD1Fixture(); stubFulfillmentKey(); send.mockClear();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in fixture"); }));
  await insertTestProduct(f.sql);
  insertTestOrder(f.sql, code);
  f.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid',sales_channel='web' WHERE code=?").run(code);
  await ensureFulfillmentItems(f.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!);
  f.sql.prepare("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')").run();
});
afterEach(() => { f.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
for (const supplier of ["wr", "sk", "jaspay"]) {
  it(`${supplier}: only the winning concurrent completion enqueues supplier_settled; replay does not`, async () => {
    const id = Number(f.sql.prepare("SELECT id FROM fulfillment_items WHERE order_code=?").get(code)!.id);
    if (supplier === "wr") f.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,idempotency_key,status,wr_order_id,fulfillment_item_id)
      VALUES(?,'supplier-1',1,100,'fixture-wr','processing','WR-FIXTURE',?)`).run(code, id);
    else if (supplier === "jaspay") f.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,idempotency_key,status,wr_order_id,fulfillment_item_id)
      VALUES(?,'jaspay:PROD:PKG',1,100,'fixture-jsp','processing','JSP-FIXTURE',?)`).run(code, id);
    else f.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,idempotency_key,status,sk_invoice,fulfillment_item_id)
      VALUES(?,'supplier-1',1,100,'fixture-sk','processing','SK-FIXTURE',?)`).run(code, id);
    const complete = () => supplier === "wr" ? handleWrOrderCompleted("WR-FIXTURE", { email: "fixture@example.test", password: "fixture-only" })
      : supplier === "jaspay" ? handleJaspayTerminal("JSP-FIXTURE", { invoice: "JSP-FIXTURE", status: "completed", product: "PROD", quantity: 1, success_count: 1, accounts: [{ email: "fixture@example.test", password: "fixture-only" }] })
      : handleSkOrderCompleted("SK-FIXTURE", { invoice: "SK-FIXTURE", status: "completed", items: [{ variant_id: "supplier-1", licenses: [{ product_license: "fixture-only" }] }] } as never);
    expect(await Promise.all([complete(), complete()])).toEqual([true, true]);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "supplier_settled", orderCode: code, orderKind: "apps", source: supplier, mode: "active" }));
    await complete(); expect(send).toHaveBeenCalledTimes(1);
  });
}
it("Digiflazz: the active-attempt winner enqueues once, terminal replay enqueues zero", async () => {
  let status = "pending";
  const db = { ...createDatabaseAccess(),
    queryFirst: vi.fn(async (sql: string, ...params: unknown[]) => sql.includes("games_dispatch_attempts")
      ? { order_code: code, a_no: 1, i_no: 1, i_status: status, max_price: 10000 }
      : createDatabaseAccess().queryFirst(sql, ...params)),
    execRun: vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE games_order_items")) { if (status === "success") return { changes: 0 }; status = "success"; }
      return { changes: 1 };
    }),
  };
  const tx = { ref_id: "fixture", buyer_sku_code: "fixture", status: "Sukses", sn: "fixture", message: "success", rc: "00", price: 100 } as const;
  expect(await applyGamesTransactionResult(db, "fixture", tx)).toBe("success");
  expect(await applyGamesTransactionResult(db, "fixture", tx)).toBe("ignored");
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "supplier_settled", source: "digiflazz", orderKind: "games" }));
});
