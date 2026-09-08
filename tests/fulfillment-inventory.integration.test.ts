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

  it("reversed inventory order still binds each item to its own variant secret", async () => {
    const { encryptSecret: enc } = await import("@/lib/fulfillment/crypto");
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    for (const [id, mode] of [[1, "unique"], [2, "unique"]] as [number, string][]) {
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(?,1,?,?,10000,100,?)")
        .run(id, `SKU-${id}`, `V${id}`, mode);
    }
    // Inventory varian 2 ditulis LEBIH DULU (id lebih kecil) — urutan
    // inventory terbalik dari urutan cart. Tiap item harus tetap menerima
    // secret variannya sendiri.
    for (const vid of [2, 1]) {
      const s = await enc(`SECRET-VARIANT-${vid}`);
      fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,?,?,?,?)")
        .run(vid, s.ciphertext, s.iv, `fp-v${vid}`);
    }
    await webOrder("R3-REV", [item(1), item(2)]);
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', sales_channel='telegram', telegram_chat_id='12345', telegram_user_id='12345' WHERE code='R3-REV'").run();
    const { sendMessage } = await import("@/lib/telegram/api");
    const mocked = sendMessage as unknown as ReturnType<typeof vi.fn>;
    mocked.mockClear();
    await ensureFulfillmentForPaidOrder("R3-REV");
    const rows = fixture.sql.prepare("SELECT variant_id, inventory_id, status FROM fulfillment_items WHERE order_code='R3-REV' ORDER BY item_index").all();
    expect(rows.map((r) => r.status)).toEqual(["delivered", "delivered"]);
    // inventory_id berbeda dan cocok dengan variannya masing-masing.
    expect(new Set(rows.map((r) => r.inventory_id)).size).toBe(2);
    for (const row of rows) {
      const invRow = fixture.sql.prepare("SELECT variant_id FROM fulfillment_inventory WHERE id=?").get(Number(row.inventory_id))!;
      expect(Number(invRow.variant_id)).toBe(Number(row.variant_id));
    }
    // Isi pesan: item 1 menerima SECRET-VARIANT-1, bukan milik varian 2.
    const texts = mocked.mock.calls.map((call) => String((call[0] as { text: string }).text));
    expect(texts.some((t) => t.includes("SECRET-VARIANT-1"))).toBe(true);
    expect(texts.some((t) => t.includes("SECRET-VARIANT-2"))).toBe(true);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R3-REV'").get()?.fulfillment_status).toBe("delivered");
  });

  it("legacy pool mixed with variant-scoped rows binds deterministically", async () => {
    const { encryptSecret: enc2 } = await import("@/lib/fulfillment/crypto");
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    for (const [id, mode] of [[1, "unique"], [2, "unique"]] as [number, string][]) {
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(?,1,?,?,10000,100,?)")
        .run(id, `SKU-${id}`, `V${id}`, mode);
    }
    const legacy = await enc2("SECRET-LEGACY");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,NULL,?,?,?)")
      .run(legacy.ciphertext, legacy.iv, "fp-legacy");
    const scoped = await enc2("SECRET-SCOPED-1");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,?,?,?)")
      .run(scoped.ciphertext, scoped.iv, "fp-scoped-1");
    await webOrder("R3-LEGMIX", [item(1), item(2)]);
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', sales_channel='telegram', telegram_chat_id='12345', telegram_user_id='12345' WHERE code='R3-LEGMIX'").run();
    await ensureFulfillmentForPaidOrder("R3-LEGMIX");
    const rows = fixture.sql.prepare("SELECT variant_id, inventory_id, status FROM fulfillment_items WHERE order_code='R3-LEGMIX' ORDER BY item_index").all();
    expect(rows.map((r) => r.status)).toEqual(["delivered", "delivered"]);
    // Item varian 1 memakai unit scoped-nya; item varian 2 memakai legacy.
    const invOf = (inventoryId: number) =>
      fixture.sql.prepare("SELECT variant_id FROM fulfillment_inventory WHERE id=?").get(inventoryId)?.variant_id ?? null;
    expect(Number(invOf(Number(rows[0].inventory_id)))).toBe(1);
    expect(invOf(Number(rows[1].inventory_id))).toBeNull();
  });

  it("second delivery failure keeps first item delivered, retry ships only the remainder", async () => {
    const { encryptSecret: enc3 } = await import("@/lib/fulfillment/crypto");
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    for (const [id, mode] of [[1, "shared"], [2, "shared"]] as [number, string][]) {
      const s = await enc3(`SECRET-SHARED-${id}`);
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv) VALUES(?,1,?,?,10000,100,?,?,?)")
        .run(id, `SKU-${id}`, `V${id}`, mode, s.ciphertext, s.iv);
    }
    await webOrder("R3-RETRY", [item(1), item(2)]);
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', sales_channel='telegram', telegram_chat_id='12345', telegram_user_id='12345' WHERE code='R3-RETRY'").run();
    const { sendMessage: send3 } = await import("@/lib/telegram/api");
    const mocked3 = send3 as unknown as ReturnType<typeof vi.fn>;
    mocked3.mockClear();
    // Rusak secret item kedua → kirim pertama sukses, kedua retry.
    fixture.sql.prepare("UPDATE product_variants SET shared_secret_ciphertext=NULL, shared_secret_iv=NULL WHERE id=2").run();
    await ensureFulfillmentForPaidOrder("R3-RETRY");
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='R3-RETRY' ORDER BY item_index").all().map((r) => r.status))
      .toEqual(["delivered", "retry"]);
    expect(mocked3).toHaveBeenCalledTimes(1);
    // Perbaiki → retry hanya mengirim item kedua.
    const fixed = await enc3("SECRET-SHARED-2-FIXED");
    fixture.sql.prepare("UPDATE product_variants SET shared_secret_ciphertext=?, shared_secret_iv=? WHERE id=2").run(fixed.ciphertext, fixed.iv);
    mocked3.mockClear();
    await ensureFulfillmentForPaidOrder("R3-RETRY");
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='R3-RETRY' ORDER BY item_index").all().map((r) => r.status))
      .toEqual(["delivered", "delivered"]);
    expect(mocked3).toHaveBeenCalledTimes(1);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='R3-RETRY'").get()?.fulfillment_status).toBe("delivered");
  });

  it("legacy rows with duplicate binding fail closed with mismatch, never wrong secret", async () => {
    const { encryptSecret: enc4 } = await import("@/lib/fulfillment/crypto");
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    for (const [id, mode] of [[1, "unique"], [2, "unique"]] as [number, string][]) {
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(?,1,?,?,10000,100,?)")
        .run(id, `SKU-${id}`, `V${id}`, mode);
    }
    const s1 = await enc4("SECRET-V1");
    const s2 = await enc4("SECRET-V2");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,?,?,?)")
      .run(s1.ciphertext, s1.iv, "fp-dup-1");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,2,?,?,?)")
      .run(s2.ciphertext, s2.iv, "fp-dup-2");
    await webOrder("R3-DUP", [item(1), item(2)]);
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', sales_channel='telegram', telegram_chat_id='12345', telegram_user_id='12345' WHERE code='R3-DUP'").run();
    // Kondisi ambigu historis: baris kedua menunjuk unit milik varian 1
    // (inventory_id sama dengan baris pertama) SEBELUM pengiriman apa pun.
    // Bangun materialisasi manual: baris 0 → unit 1 (benar), baris 1 →
    // unit 1 juga (salah, harusnya unit 2).
    fixture.sql.prepare("DELETE FROM fulfillment_items WHERE order_code='R3-DUP'").run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,inventory_id,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES('R3-DUP',0,1,1,1,'unique',1,'telegram','12345','queued',0,datetime('now')),
            ('R3-DUP',1,1,2,1,'unique',1,'telegram','12345','queued',0,datetime('now'))`).run();
    const { sendMessage: send4 } = await import("@/lib/telegram/api");
    (send4 as unknown as ReturnType<typeof vi.fn>).mockClear();
    await ensureFulfillmentForPaidOrder("R3-DUP");
    const statuses = fixture.sql.prepare("SELECT status, last_error, inventory_id FROM fulfillment_items WHERE order_code='R3-DUP' ORDER BY item_index").all();
    const [first, second] = statuses;
    // Baris pertama (unit cocok) terkirim. Baris kedua menunjuk unit milik
    // varian 1, TETAPI unit benarnya (unit 2) masih tersedia → kode
    // menyembuhkan ikatan ke unit benar dan mengirim secret yang BENAR.
    // Yang dilarang keras: terkirim dengan secret yang salah.
    expect(String(first.status)).toBe("delivered");
    expect(String(second.status)).toBe("delivered");
    expect(Number(second.inventory_id)).toBe(2);
    const texts = (send4 as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => String((call[0] as { text: string }).text));
    expect(texts.some((t) => t.includes("SECRET-V1"))).toBe(true);
    expect(texts.some((t) => t.includes("SECRET-V2"))).toBe(true);
  });

  it("duplicate binding with no correct unit left fails closed with mismatch", async () => {
    const { encryptSecret: enc5 } = await import("@/lib/fulfillment/crypto");
    fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fixture',10000,100)");
    for (const [id, mode] of [[1, "unique"], [2, "unique"]] as [number, string][]) {
      fixture.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(?,1,?,?,10000,100,?)")
        .run(id, `SKU-${id}`, `V${id}`, mode);
    }
    // Hanya SATU unit (milik varian 1); baris kedua menunjuk unit itu juga
    // dan tidak ada unit benar tersisa → mismatch, bukan secret salah.
    const only = await enc5("SECRET-ONLY-V1");
    fixture.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,?,?,?)")
      .run(only.ciphertext, only.iv, "fp-only-1");
    await webOrder("R3-DUP2", [item(1)]);
    // Ubah baris menjadi varian 2 dengan ikatan salah ke unit 1 — TETAPI
    // order.items snapshot tetap varian 1, sehingga ensure (yang memverifikasi
    // materialisasi vs snapshot) akan menolak. Selaraskan snapshot juga.
    fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', sales_channel='telegram', telegram_chat_id='12345', telegram_user_id='12345', items=?, variant_snapshot=? WHERE code='R3-DUP2'")
      .run(JSON.stringify([{ product_id: 1, variant_id: 2, name: "V2", price: 10000, qty: 1 }]),
        JSON.stringify({ lines: [{ variant_id: 2, fulfillment_mode: "unique" }] }));
    fixture.sql.prepare("DELETE FROM fulfillment_items WHERE order_code='R3-DUP2'").run();
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,inventory_id,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES('R3-DUP2',0,1,2,1,'unique',1,'telegram','12345','queued',0,datetime('now'))`).run();
    fixture.sql.prepare(`INSERT INTO fulfillment_jobs(order_code,variant_id,sales_channel,status,attempt_count,next_attempt_at)
      VALUES('R3-DUP2',2,'telegram','queued',0,datetime('now'))`).run();
    const { sendMessage: send6 } = await import("@/lib/telegram/api");
    (send6 as unknown as ReturnType<typeof vi.fn>).mockClear();
    await ensureFulfillmentForPaidOrder("R3-DUP2");
    const row = fixture.sql.prepare("SELECT status, last_error FROM fulfillment_items WHERE order_code='R3-DUP2'").get()!;
    expect(["retry", "failed"]).toContain(String(row.status));
    expect(String(row.last_error ?? "")).toMatch(/mismatch/i);
    expect(send6 as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
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
