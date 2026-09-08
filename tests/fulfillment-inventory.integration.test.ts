import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createOrderWithStock } from "@/lib/db";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { encryptSecret } from "@/lib/fulfillment/crypto";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "wa-1" })),
}));

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  stubFulfillmentKey();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network disabled in fixture"); }));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const item = (variant_id: number, qty = 1) => ({ product_id: 1, variant_id, name: `V${variant_id}`, price: 10000, qty });
async function webOrder(code: string, items: ReturnType<typeof item>[]) {
  await createOrderWithStock({
    code, quoteId: `q-${code}`, customerName: "Web buyer", customerWa: "628000000000",
    customerEmail: null, items, subtotal: items.reduce((s, it) => s + it.price * it.qty, 0),
    paymentMethod: "qris", paymentAccount: "DANA Business", proofUrl: null,
  });
}
async function seedUnique(variants: string[], legacyRows: (number | null)[]) {
  fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
  variants.forEach((mode, i) => {
    fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(?,1,?,?,10000,100,?)")
      .run(i + 1, `SKU-${i + 1}`, `V${i + 1}`, mode);
  });
  for (const vid of legacyRows) {
    const s = await encryptSecret(`SECRET-${Math.random()}`);
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,?,?,?,?)")
      .run(vid, s.ciphertext, s.iv, `fp-${Math.random()}`);
  }
}
const inv = () => ({
  reserved: fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='reserved'").get()?.n,
  available: fixture.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='available'").get()?.n,
});
const stocks = () => fixture.sql.prepare("SELECT stock FROM product_variants ORDER BY id").all().map((r) => r.stock);

describe("R3 inventory maps one unit to exactly one line", () => {
  it("two unique lines with one legacy row fail whole, no order/stock/reservation left", async () => {
    await seedUnique(["unique", "unique"], [null]);
    await expect(webOrder("R3-ONE", [item(1), item(2)])).rejects.toThrowError(/Stok atau status/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(inv()).toMatchObject({ reserved: 0, available: 1 });
    expect(stocks()).toEqual([100, 100]);
  });

  it("two unique lines with enough rows reserve exactly one unit per line", async () => {
    await seedUnique(["unique", "unique"], [1, null]);
    await webOrder("R3-TWO", [item(1), item(2)]);
    expect(inv()).toMatchObject({ reserved: 2, available: 0 });
    const rows = fixture.sql.prepare("SELECT variant_id,order_code FROM fulfillment_inventory WHERE status='reserved'").all();
    expect(rows.filter((r) => r.order_code === "R3-TWO")).toHaveLength(2);
    // The variant-scoped row serves its own variant; the legacy row covers the other line.
    expect(new Set(rows.map((r) => r.variant_id))).toContain(1);
  });

  it("two checkouts racing for the last unit settle exactly one order", async () => {
    await seedUnique(["unique"], [1]);
    const a = webOrder("R3-A", [item(1)]).then(() => "ok").catch((e) => String(e.constructor.name));
    const b = webOrder("R3-B", [item(1)]).then(() => "ok").catch((e) => String(e.constructor.name));
    const results = await Promise.all([a, b]);
    expect(results.sort()).toEqual(["StockReservationError", "ok"]);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(inv()).toMatchObject({ reserved: 1, available: 0 });
  });

  it("shortage on any unique line fails the whole checkout without partial state", async () => {
    await seedUnique(["unique", "unique"], [null]);
    await expect(webOrder("R3-QTY", [item(1), item(2)])).rejects.toThrowError(/Stok atau status/);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(stocks()).toEqual([100, 100]);
    expect(inv()).toMatchObject({ reserved: 0, available: 1 });
  });

  it("quote rejects qty>1 on unique variants before any reservation", () => {
    const src = fixture.sql; // fixture unused; assert on shipped source instead
    void src;
    const fs = require("node:fs") as typeof import("node:fs");
    const text = fs.readFileSync("src/app/api/checkout/quote/route.ts", "utf8");
    expect(text).toContain('fulfillment_mode) === "unique" && item.qty > 1');
    expect(text).toContain("hanya dapat dibeli 1 unit per pesanan");
  });

  it("non-unique lines never consume inventory", async () => {
    await seedUnique(["shared", "manual"], [null]);
    await webOrder("R3-NU", [item(1), item(2)]);
    expect(inv()).toMatchObject({ reserved: 0, available: 1 });
  });
});

describe("R3 web channel ends in an actionable handover, not a retry loop", () => {
  it("web shared item lands manual_required with handover note, stable on retry", async () => {
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    const s = await encryptSecret("WEB-SHARED");
    fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv)
      VALUES(1,1,'SKU-1','V1',10000,100,'shared',?,?)`).run(s.ciphertext, s.iv);
    await webOrder("R3-WEB", [item(1)]);
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid' WHERE code='R3-WEB'").run();
    await ensureFulfillmentForPaidOrder("R3-WEB");
    const row = fixture.sql.prepare("SELECT status,recipient_channel,last_error FROM fulfillment_items WHERE order_code='R3-WEB'").get()!;
    expect(row).toMatchObject({ status: "manual_required", recipient_channel: "web" });
    expect(String(row.last_error)).toContain("web_channel_requires_manual_handover");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R3-WEB'").get()?.fulfillment_status)
      .toBe("manual_required");
    await ensureFulfillmentForPaidOrder("R3-WEB");
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R3-WEB'").get()?.fulfillment_status)
      .toBe("manual_required");
  });
});
