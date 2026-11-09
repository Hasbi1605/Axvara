// TG2b Telegram bulk checkout (LOCAL ONLY): threshold/all-unit, multitier,
// cross-variant isolation, disabled/corrupt, overflow/CAS, caps, email+tag,
// cart cleanup CAS, one invoice, pending replay locale+price immutability.
// QRIS receives discounted net exact; currency display never changes charge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { getCartSummary, addToCart, clearCart } from "@/lib/telegram/cart";
import { createAndSendCartInvoice } from "@/lib/telegram/handlers/cart-invoice";
import { createAndSendVariantInvoice } from "@/lib/telegram/handlers/invoice";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { resolveBulkPrice } from "@/lib/bulk-pricing";

const api = vi.hoisted(() => ({ send: vi.fn(), photo: vi.fn(), edit: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  sendPhoto: api.photo,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  safeEditOrSend: api.edit,
}));
vi.mock("@/lib/telegram/payment-maintenance", () => ({ notifyPaymentMaintenance: async () => false }));

const qris = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/payments/dana-qris", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/dana-qris")>()),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: qris.create,
}));
vi.mock("@/lib/fulfillment/deliver", () => ({ createFulfillmentJob: vi.fn(async () => null) }));

let fx: ReturnType<typeof createD1Fixture>;
const buyer = { id: 777001, first_name: "Bulk" };
const tiers = [{ min_qty: 10, unit_price: 9000 }, { min_qty: 50, unit_price: 8000 }];
const tiersJson = JSON.stringify(tiers);

async function variant() {
  const { getActiveVariant } = await import("@/lib/catalog");
  return (await getActiveVariant(1))!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  api.edit.mockResolvedValue({ ok: true });
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "tg2b-fixture");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fx = createD1Fixture();
  stubFulfillmentKey();
  await insertTestProduct(fx.sql);
  fx.sql.exec("UPDATE products SET is_active=1, telegram_enabled=1 WHERE id=1");
  fx.sql.prepare("UPDATE product_variants SET price=10000, stock=-1, min_qty=1, bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1").run(tiersJson);
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email,locale) VALUES('777001','777001','Bulk','buyer@example.com','en')").run();
  qris.create.mockImplementation(async (code: string) => {
    const order = fx.sql.prepare("SELECT subtotal FROM orders WHERE code=?").get(code);
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at)
      VALUES(?,'gopay','inhouse',?,'fixture',?,?, 'pending','https://example.com/qr.png',?)`)
      .run(code, code, Number(order?.subtotal ?? 0), Number(order?.subtotal ?? 0), new Date(Date.now() + 900_000).toISOString());
    return { orderCode: code, qrisUrl: "https://example.com/qr.png", payableAmount: Number(order?.subtotal ?? 0),
      qrisPayload: "fixture", isExisting: false, requestedAmount: Number(order?.subtotal ?? 0),
      uniqueCode: 0, expiresAt: new Date(Date.now() + 900_000).toISOString() };
  });
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("TG2b telegram bulk checkout", () => {
  it.each([
    ["manual", null, null, false, 15],
    ["warung_rebahan", "wr-1", null, false, 60],
    ["manual", null, "sk-1", false, 60],
    ["manual", null, "sk-1", true, 15],
  ])("sets Telegram expiry by ownership %s WR=%s SK=%s mixed=%s", async (source, wr, sk, mixed, minutes) => {
    fx.sql.prepare("UPDATE products SET source=?,wr_product_id=?,sk_product_id=? WHERE id=1").run(source, wr, sk);
    if (mixed) fx.sql.exec("INSERT INTO products(id,name,slug,price,stock,telegram_enabled) VALUES(2,'Manual','manual',10000,100,1); INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(2,2,'SKU-M','Manual',10000,100,'manual')");
    const ids = mixed ? [1, 2] : [1];
    await createChannelOrderAtomic({
      orderCode: "TG-EXPIRY", lines: ids.map(id => ({ productId: id, variantId: id, qty: 1, fulfillmentMode: "manual", stock: 100 })),
      items: ids.map(id => ({ product_id: id, variant_id: id, qty: 1, price: 10000 })),
      variantSnapshot: "{}", subtotal: ids.length * 10000, primaryVariantId: 1, customerName: "Bulk", salesChannel: "telegram",
      telegramChatId: "777009", telegramUserId: "777009", paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required", orderWindowMinutes: 15,
    });
    const row = fx.sql.prepare("SELECT expires_at FROM orders WHERE code='TG-EXPIRY'").get();
    expect((Date.parse(String(row?.expires_at)) - Date.now()) / 60_000).toBeCloseTo(minutes, 0);
  });
  it("rejects a supplier becoming manual between the owner read and atomic reservation", async () => {
    fx.sql.prepare("UPDATE products SET sk_product_id='sk-1' WHERE id=1").run();
    let changed = false;
    fx.control.fail = sql => {
      if (!changed && sql.includes("SELECT 1 FROM products WHERE id=? AND source IS ?")) {
        changed = true;
        fx.sql.prepare("UPDATE products SET sk_product_id=NULL WHERE id=1").run();
      }
      return false;
    };
    await expect(createChannelOrderAtomic({
      orderCode: "TG-OWNER-RACE", lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, qty: 1, price: 10000 }], variantSnapshot: "{}", subtotal: 10000,
      primaryVariantId: 1, customerName: "Bulk", salesChannel: "telegram", telegramChatId: "777009", telegramUserId: "777009",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    })).rejects.toThrow();
    expect(changed).toBe(true);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
  });
  it("threshold-1 base, at-threshold all-units discount, highest tier wins", () => {
    expect(resolveBulkPrice(10000, 9, 1, tiersJson)).toEqual({ price: 10000, tier: undefined });
    expect(resolveBulkPrice(10000, 10, 1, tiersJson)).toMatchObject({ price: 9000, tier: 10 });
    expect(resolveBulkPrice(10000, 50, 1, tiersJson)).toMatchObject({ price: 8000, tier: 50 });
    expect(resolveBulkPrice(10000, 99, 1, tiersJson)).toMatchObject({ price: 8000, tier: 50 });
  });

  it("single invoice honors threshold discount and persists immutable locale snapshot", async () => {
    const { handleShowQty } = await import("@/lib/telegram/handlers/catalog");
    await handleShowQty(777001, 1, 1, 1, 12, buyer);
    const qtyCall = api.edit.mock.calls.at(-1)?.[0];
    const rows = qtyCall?.reply_markup?.inline_keyboard ?? [];
    const payCb = String(rows.flat().find((b: { text: string }) => b.text.includes("QRIS"))?.callback_data ?? "");
    const tag = payCb.split(":").at(-1);
    expect(tag).toBeTruthy();
    expect(String(qtyCall?.text ?? "")).toMatch(/bulk 10\+/);
    const { handlePayWithQris } = await import("@/lib/telegram/handlers/invoice");
    await handlePayWithQris(777001, 1, 1, 1, 12, buyer, false, tag);
    const order = fx.sql.prepare("SELECT code,subtotal,items,variant_snapshot,locale,sales_channel,telegram_user_id FROM orders").get();
    expect(order?.subtotal).toBe(108000);
    expect(order?.locale).toBe("en");
    expect(order?.telegram_user_id).toBe("777001");
    expect(qris.create).toHaveBeenCalledTimes(1);
    expect(qris.create.mock.calls[0]?.[1]).toBe(108000);
    const items = JSON.parse(String(order?.items));
    expect(items[0]).toMatchObject({ price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 12 });
    expect(JSON.parse(String(order?.variant_snapshot))).toMatchObject({ price: 9000, base_price: 10000, applied_tier_min_qty: 10 });
    const caption = String(api.photo.mock.calls[0]?.[0]?.caption ?? "");
    expect(caption).toContain("108");
    // Pending replay after pref+price+tier change reuses SAVED snapshot.
    fx.sql.prepare("UPDATE telegram_users SET locale='id', display_currency='IDR' WHERE user_id='777001'").run();
    fx.sql.prepare("UPDATE product_variants SET price=20000, bulk_pricing_enabled=0 WHERE id=1").run();
    vi.clearAllMocks();
    const v = await variant();
    await createAndSendVariantInvoice(777001, 1, 1, "Bulk Produk", { ...v, price: 20000 }, buyer, 12);
    expect(api.send.mock.calls.map((c) => String(c[0]?.text ?? "")).join("\n")).toContain(String(order?.code));
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(1);
    expect(qris.create).not.toHaveBeenCalled();
    const replayed = fx.sql.prepare("SELECT subtotal,items,locale FROM orders WHERE code=?").get(String(order?.code));
    expect(replayed?.subtotal).toBe(108000);
    expect(replayed?.locale).toBe("en");
    expect(JSON.parse(String(replayed?.items))[0]).toMatchObject({ price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 12 });
  });

  it("rejects inconsistent line/item payloads before any side effect", async () => {
    type TgLine = { productId: number; variantId: number; qty: number; fulfillmentMode: string; stock: number };
    const base: Omit<TgLine, "qty"> = { productId: 1, variantId: 1, fulfillmentMode: "manual", stock: -1 };
    const goodItem = { product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 };
    const stockBefore = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock;
    const mk = (code: string, lines: TgLine[], items: unknown[], subtotal: number) => createChannelOrderAtomic({
      orderCode: code, lines, items, variantSnapshot: "{}", subtotal, primaryVariantId: 1,
      customerName: "Bulk", salesChannel: "telegram", telegramChatId: "777009", telegramUserId: "777009",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    });
    // length mismatch / qty mismatch / zero / negative / fraction / missing
    await expect(mk("TG-LEN", [{ ...base, qty: 10 }], [], 90000)).rejects.toThrow();
    await expect(mk("TG-QTY", [{ ...base, qty: 10 }], [{ ...goodItem, qty: 1 }], 9000)).rejects.toThrow();
    await expect(mk("TG-ZERO", [{ ...base, qty: 0 }], [{ ...goodItem, qty: 0 }], 0)).rejects.toThrow();
    await expect(mk("TG-NEG", [{ ...base, qty: -2 }], [{ ...goodItem, qty: -2 }], -18000)).rejects.toThrow();
    await expect(mk("TG-FRAC", [{ ...base, qty: 2.5 }], [{ ...goodItem, qty: 2.5 }], 22500)).rejects.toThrow();
    // duplicate-line aggregate overflow is fail-closed, not wrapped.
    await expect(mk("TG-AGGR", [{ ...base, qty: Number.MAX_SAFE_INTEGER }, { ...base, qty: 1 }],
      [{ ...goodItem, qty: Number.MAX_SAFE_INTEGER }, { ...goodItem, qty: 1 }], Number.MAX_SAFE_INTEGER)).rejects.toThrow();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(stockBefore);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='reserved'").get()?.n ?? 0).toBe(0);
    expect(qris.create).not.toHaveBeenCalled();
  });

  it("cart aggregates same-variant qty, isolates variants, rejects stale base/config", async () => {
    await addToCart("777001", 1, 1, 5);
    await addToCart("777001", 1, 1, 5);
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers) VALUES(2,1,'SKU-2','Other',10000,-1,'manual',1,1,?)").run(tiersJson);
    await addToCart("777001", 1, 2, 5);
    const summary = await getCartSummary("777001");
    expect(summary.subtotal).toBe(90000 + 50000);
    expect(summary.lines.find((l) => l.variantId === 1)?.appliedTierMinQty).toBe(10);
    expect(summary.lines.find((l) => l.variantId === 2)?.appliedTierMinQty).toBeNull();
    await createAndSendCartInvoice(777001, summary.lines, buyer);
    const order = fx.sql.prepare("SELECT code,subtotal,locale FROM orders").get();
    expect(order?.subtotal).toBe(140000);
    expect(order?.locale).toBe("en");
    expect(invoiceSavedCount()).toBe(1);
    expect(qris.create.mock.calls[0]?.[1]).toBe(140000);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM telegram_carts WHERE user_id='777001'").get()?.n).toBe(0);
    function invoiceSavedCount() { return fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n; }
  });

  it("disabled treats stale tiers as base; corrupt enabled fails closed before order", async () => {
    fx.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
    await addToCart("777001", 1, 1, 10);
    const disabled = await getCartSummary("777001");
    expect(disabled.subtotal).toBe(100000);
    await clearCart("777001", disabled.lines);
    // DB CHECK hanya membolehkan JSON array valid; bentuk 'bukan JSON'
    // tetap lolos CHECK tetapi gagal di validasi strict helper.
    fx.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=1, bulk_pricing_tiers='[1]' WHERE id=1").run();
    const stockBefore = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock;
    await expect(createChannelOrderAtomic({
      orderCode: "TG-CORRUPT", lines: [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 }],
      variantSnapshot: "{}", subtotal: 90000, primaryVariantId: 1, customerName: "Bulk",
      salesChannel: "telegram", telegramChatId: "777001", telegramUserId: "777001",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    })).rejects.toThrow();
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(stockBefore);
    expect(qris.create).not.toHaveBeenCalled();
  });

  it("rejects tampered tiers and overflow; preserves committed price", async () => {
    await expect(createChannelOrderAtomic({
      orderCode: "TG-TAMPER", lines: [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, price: 1000, base_price: 10000, qty: 10 }],
      variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1, customerName: "Bulk",
      salesChannel: "telegram", telegramChatId: "777002", telegramUserId: "777002",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    })).rejects.toThrow();
    await expect(createChannelOrderAtomic({
      orderCode: "TG-OVERFLOW", lines: [{ productId: 1, variantId: 1, qty: Number.MAX_SAFE_INTEGER, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, price: 10000, base_price: 10000, qty: Number.MAX_SAFE_INTEGER }],
      variantSnapshot: "{}", subtotal: Number.MAX_SAFE_INTEGER, primaryVariantId: 1, customerName: "Bulk",
      salesChannel: "telegram", telegramChatId: "777003", telegramUserId: "777003",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    })).rejects.toThrow();
    // Mutasi setelah commit bukan bukti race: klaim ini dipertahankan
    // hanya sebagai perilaku replay immutable. Ganti dengan verifikasi
    // race nyata memakai wrapper fixture batch (lihat tes berikutnya).
    fx.control.afterBatch = async () => {
      fx.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
    };
    const stale = await createChannelOrderAtomic({
      orderCode: "TG-CAS", lines: [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 }],
      variantSnapshot: "{}", subtotal: 90000, primaryVariantId: 1, customerName: "Bulk",
      salesChannel: "telegram", telegramChatId: "777004", telegramUserId: "777004",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    });
    fx.control.afterBatch = null;
    expect(stale.subtotal).toBe(90000);
    // Mutasi sebelum live read gagal
    // tertutup: klaim tier 9000 tidak lagi cocok dengan base/config baru.
    fx.sql.prepare("UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1").run();
    const stockBefore = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock;
    await expect(createChannelOrderAtomic({
      orderCode: "TG-CAS2", lines: [{ productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: -1 }],
      items: [{ product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 }],
      variantSnapshot: "{}", subtotal: 90000, primaryVariantId: 1, customerName: "Bulk",
      salesChannel: "telegram", telegramChatId: "777004", telegramUserId: "777004",
      paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
    })).rejects.toThrow();
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(stockBefore);
    expect(qris.create).not.toHaveBeenCalled();
  });

  it("proves base/config mutation between live read and guard batch rolls back all", async () => {
    // Finite stock + multiline with unique inventory: bila baris kedua gagal,
    // rollback harus mengembalikan potongan baris pertama; inventory tetap tersedia.
    fx.sql.prepare("UPDATE product_variants SET stock=20, bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1").run(tiersJson);
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,bulk_pricing_enabled,bulk_pricing_tiers) VALUES(3,1,'SKU-3','Unique',10000,10,'unique',1,0,'[]')").run();
    for (let i = 0; i < 3; i++) fx.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,3,'c','v',?)").run(`r-${i}`);
    const originalBatch = fx.db.batch.bind(fx.db);
    for (const field of [
      { sql: "UPDATE product_variants SET price=20000 WHERE id=1", label: "base-price" },
      { sql: "UPDATE product_variants SET bulk_pricing_enabled=0 WHERE id=1", label: "enabled" },
      { sql: "UPDATE product_variants SET bulk_pricing_tiers=? WHERE id=1", args: [JSON.stringify([{ min_qty: 10, unit_price: 9500 }])], label: "tier-json" },
    ] as { sql: string; args?: unknown[]; label: string }[]) {
      let entered = 0;
      let batchError = "";
      const spy = vi.spyOn(fx.db, "batch").mockImplementation(async (statements) => {
        entered++;
        if (field.args) fx.sql.prepare(field.sql).run(...(field.args as unknown[]));
        else fx.sql.prepare(field.sql).run();
        try { return await originalBatch(statements); }
        catch (error) { batchError = String(error); throw error; }
      });
      const stockBefore = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock;
      const stock3Before = fx.sql.prepare("SELECT stock FROM product_variants WHERE id=3").get()?.stock;
      await expect(createChannelOrderAtomic({
        orderCode: `TG-RACE-${field.label}`, lines: [
          { productId: 1, variantId: 3, qty: 2, fulfillmentMode: "unique", stock: 10 },
          { productId: 1, variantId: 1, qty: 10, fulfillmentMode: "manual", stock: 20 },
        ],
        items: [
          { product_id: 1, variant_id: 3, price: 10000, base_price: 10000, qty: 2 },
          { product_id: 1, variant_id: 1, price: 9000, base_price: 10000, applied_tier_min_qty: 10, qty: 10 },
        ],
        variantSnapshot: "{}", subtotal: 110000, primaryVariantId: 1, customerName: "Bulk",
        salesChannel: "telegram", telegramChatId: "777010", telegramUserId: "777010",
        paymentMethod: "qris", paymentAccount: "DANA", fulfillmentStatus: "not_required",
      }), field.label).rejects.toThrow();
      expect(entered, field.label).toBe(1);
      expect(batchError, field.label).toMatch(/CHECK constraint failed/);
      expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock, field.label).toBe(stockBefore);
      expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=3").get()?.stock, field.label).toBe(stock3Before);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='reserved'").get()?.n, field.label).toBe(0);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='available'").get()?.n, field.label).toBe(3);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n, field.label).toBe(0);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n, field.label).toBe(0);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM operation_guards").get()?.n, field.label).toBe(0);
      expect(qris.create, field.label).not.toHaveBeenCalled();
      spy.mockRestore();
      // Reset config for next param case.
      fx.sql.prepare("UPDATE product_variants SET price=10000, bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1").run(tiersJson);
    }
  });

  it("honors stock/unique caps and never relaxes them for tiers", async () => {
    fx.sql.prepare("UPDATE product_variants SET stock=5, bulk_pricing_enabled=1, bulk_pricing_tiers=? WHERE id=1").run(tiersJson);
    const out = await addToCart("777001", 1, 1, 10);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("out_of_stock");
    fx.sql.prepare("UPDATE product_variants SET stock=-1, fulfillment_mode='unique' WHERE id=1").run();
    for (let i = 0; i < 10; i++) fx.sql.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint) VALUES(1,1,'c','v',?)").run(`u-${i}`);
    expect((await addToCart("777001", 1, 1, 10)).ok).toBe(true);
    expect((await addToCart("777001", 1, 1, 1)).ok).toBe(false);
  });
});
