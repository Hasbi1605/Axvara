import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { POST } from "@/app/api/internal/queue/fulfill/route";

const m = vi.hoisted(() => ({
  wrCreate: vi.fn(async () => 0), skCreate: vi.fn(async () => 0),
  wrProcess: vi.fn(async () => ({})), skProcess: vi.fn(async () => ({})),
  skDelivery: vi.fn<(code: string, id: number) => Promise<boolean>>().mockResolvedValue(true),
}));
vi.mock("@/lib/tunvn/orders", () => ({ createTunvnOrderLinks: async () => 0, processTunvnOrders: async () => 0 }));
vi.mock("@/lib/aivault/orders", () => ({ createAivaultOrderLinks: async () => 0, processAivaultOrders: async () => 0 }));
vi.mock("@/lib/fulfillment/delivery/inventory-binding", () => ({ ensureFulfillmentItems: async () => [] }));
vi.mock("@/lib/fulfillment/deliver", () => ({ ensureFulfillmentForPaidOrder: async () => false }));
vi.mock("@/lib/warung-rebahan/client", () => ({ isWrAutoOrderEnabled: () => true }));
vi.mock("@/lib/sekalipay/client", () => ({ isSkAutoOrderEnabled: () => true }));
vi.mock("@/lib/warung-rebahan/order", () => ({ createWrOrderLinksForOrder: m.wrCreate, processWrPendingOrders: m.wrProcess }));
vi.mock("@/lib/sekalipay/order", () => ({ createSkOrderLinksForOrder: m.skCreate, processSkPendingOrders: m.skProcess }));
vi.mock("@/lib/warung-rebahan/deliver", () => ({ processCredentialDelivery: async () => false }));
vi.mock("@/lib/sekalipay/deliver", () => ({ deliverSkCredentialToBuyer: m.skDelivery }));
let f: ReturnType<typeof createD1Fixture>;
const code = "AXV-20261118-P2RESUME";
const post = () => POST(new NextRequest("https://fixture/api/internal/queue/fulfill", {
  method: "POST", headers: { authorization: "Bearer fixture" },
  body: JSON.stringify({ v: 1, kind: "supplier_settled", orderCode: code, orderKind: "apps", source: "sk", attempt: 1, dryRun: false }),
}));
beforeEach(() => {
  f = createD1Fixture(); vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "fixture");
  f.sql.exec("INSERT INTO store_settings(key,value) VALUES('queue_fulfillment_mode','active')");
  f.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,order_kind,sales_channel)
    VALUES(?,'Fixture','6280','[]',10000,'qris','lunas','paid','apps','web')`).run(code);
});
afterEach(() => { f.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it.each(["wr", "sk"])("R3-2: %s retries run the scoped processor when link creation returns zero", async supplier => {
  f.sql.prepare(`INSERT INTO ${supplier}_order_links(order_code,${supplier}_variant_id,quantity,${supplier}_cost,status,idempotency_key)
    VALUES(?,'fixture',1,100,'pending','fixture')`).run(code);
  for (let attempt = 0; attempt < 2; attempt++) expect(await (await post()).json()).toMatchObject({ settled: false });
  expect(supplier === "wr" ? m.wrProcess : m.skProcess).toHaveBeenCalledTimes(2);
  expect(supplier === "wr" ? m.wrProcess : m.skProcess).toHaveBeenCalledWith(undefined, { orderCode: code, skipOrphanProbe: true, limit: 1 });
});
it("R3-1: each completed SK link gets a delivery pass, not the first link twice", async () => {
  for (const id of [1, 2]) {
    f.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status)
      VALUES(?,?,?,1,1,1,'manual','web','fixture','delivered')`).run(id, code, id - 1);
    f.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,idempotency_key,fulfillment_item_id)
      VALUES(?,?,1,100,'completed',?,?)`).run(code, `fixture-${id}`, `fixture-${id}`, id);
  }
  expect(await (await post()).json()).toMatchObject({ settled: true, state: "done" });
  expect(m.skDelivery.mock.calls.map(args => args[1])).toEqual([1, 2]);
});

it("R3-1: a deadline after SK item one cannot report done while item two has no channel notice", async () => {
  f.sql.prepare("UPDATE orders SET customer_email='fixture@example.test' WHERE code=?").run(code);
  for (const id of [1, 2]) {
    f.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,delivered_ciphertext)
      VALUES(?,?,?,1,1,1,'manual','web','fixture','delivered','fixture-encrypted')`).run(id, code, id - 1);
    f.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,idempotency_key,fulfillment_item_id)
      VALUES(?,?,1,100,'completed',?,?)`).run(code, `fixture-${id}`, `fixture-${id}`, id);
  }
  const start = Date.now(); vi.spyOn(Date, "now").mockReturnValue(start);
  m.skDelivery.mockImplementationOnce(async () => {
    f.sql.prepare("INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status) VALUES(?,?,'email','sent')").run(`email:sk-credential:${code}:1`, code);
    vi.mocked(Date.now).mockReturnValue(start + 41_000);
    return true;
  });
  expect(await (await post()).json()).toMatchObject({ settled: false });
  expect(m.skDelivery.mock.calls.map(args => args[1])).toEqual([1]);
});

it("manual handover remains terminal even if automatic SK notice was never created", async () => {
  f.sql.prepare("UPDATE orders SET customer_email='fixture@example.test' WHERE code=?").run(code);
  f.sql.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status,delivered_ciphertext,last_error)
    VALUES(1,?,0,1,1,1,'manual','delivered','fixture','manual_handover:already delivered')`).run(code);
  f.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,idempotency_key,fulfillment_item_id)
    VALUES(?,'fixture',1,100,'completed','fixture',1)`).run(code);
  expect(await (await post()).json()).toMatchObject({ settled: true, state: "done" });
});
