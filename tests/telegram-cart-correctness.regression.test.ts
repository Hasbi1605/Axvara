import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { addToCart, clearCart, getCartSummary, setCartLineQty } from "@/lib/telegram/cart";
import { handleCartCheckout, handleShowCart } from "@/lib/telegram/handlers/cart";
import { createAndSendCartInvoice } from "@/lib/telegram/handlers/cart-invoice";
import { createActiveQrisInvoice } from "@/lib/payments/dana-qris";
import { sendMessage, sendPhoto, safeEditOrSend } from "@/lib/telegram/api";
import * as invoiceDelivery from "@/lib/telegram/invoice-retry";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/telegram/payment-maintenance", () => ({ notifyPaymentMaintenance: async () => false }));
vi.mock("@/lib/payments/dana-qris", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/dana-qris")>(),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: vi.fn(),
}));

let fixture: ReturnType<typeof createD1Fixture>;
const buyer = { id: 42, first_name: "Buyer" };

function seedVariant(id: number, mode = "manual", stock = 10, inventory = 0) {
  fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode)
    VALUES(?,1,?,'Paket',1000,?,?)`).run(id, `SKU-${id}`, stock, mode);
  for (let i = 0; i < inventory; i++) fixture.sql.prepare(`INSERT INTO fulfillment_inventory
    (product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint)
    VALUES(1,?,'fixture','fixture',?)`).run(id, `${id}-${i}`);
}

function saveInvoice(code: string, status = "pending", provider = "gopay") {
  fixture.sql.prepare(`INSERT INTO payment_transactions
    (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,qris_url,expires_at)
    VALUES(?,?,'inhouse',?,'fixture',1000,1001,?,'https://example.com/qr.png',?)`)
    .run(code, provider, code, status, new Date(Date.now() + 900_000).toISOString());
  return { orderCode: code, qrisUrl: "https://example.com/qr.png", payableAmount: 1001,
    qrisPayload: "fixture", isExisting: false,
    requestedAmount: 1000, uniqueCode: 1, expiresAt: new Date(Date.now() + 900_000).toISOString() };
}

function state() {
  return {
    order: fixture.sql.prepare("SELECT code,status,payment_status FROM orders").get(),
    stock: fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock,
    inventory: fixture.sql.prepare("SELECT status,order_code FROM fulfillment_inventory WHERE variant_id=1 ORDER BY id").all(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "cart-correctness-fixture");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network_forbidden_in_cart_regression"); }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Produk <test>','produk',1000,10);
    INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email) VALUES('42','42','Buyer','buyer@example.com')`);
  vi.mocked(createActiveQrisInvoice).mockImplementation(async code => saveInvoice(code));
});

afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cart summaries and atomic quantity guards", () => {
  it("always exposes issues, including empty and non-D1 summaries", async () => {
    expect(await getCartSummary("42")).toEqual({ lines: [], subtotal: 0, totalQty: 0, issues: [] });
    const db = (globalThis as { DB?: unknown }).DB;
    delete (globalThis as { DB?: unknown }).DB;
    try { expect((await getCartSummary("42")).issues).toEqual([]); }
    finally { (globalThis as { DB?: unknown }).DB = db; }
  });

  it("uses canonical WR duration labels in one summary query", async () => {
    seedVariant(1);
    seedVariant(2);
    fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wp','Produk');
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class) VALUES('wv','wp','Paket',500,'restock');
      UPDATE product_variants SET wr_variant_id='wv',duration_value=7,duration_unit='day' WHERE id=1;
      UPDATE product_variants SET duration_value=6,duration_unit='month' WHERE id=2`);
    await addToCart("42", 1, 1, 1);
    await addToCart("42", 1, 2, 1);
    fixture.control.queries = 0;
    const summary = await getCartSummary("42");
    expect(fixture.control.queries).toBe(1);
    expect(summary.lines.map(line => line.variantLabel)).toEqual(["Paket - 7 Hari", "Paket"]);
    expect(summary.issues).toEqual([]);
  });

  it.each([10, -1])("uses available unique inventory instead of raw stock %i without changing quantity", async stock => {
    seedVariant(1, "unique", stock, 3);
    await addToCart("42", 1, 1, 3);
    fixture.sql.exec("UPDATE fulfillment_inventory SET status='revoked' WHERE id=1");
    const summary = await getCartSummary("42");
    expect(summary.lines[0]).toMatchObject({ qty: 3, stock: 2 });
    expect(summary.issues.join("\n")).toContain("stok tersedia 2");
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(3);
    expect(await setCartLineQty("42", 1, 4)).toBe(false);
    expect(await addToCart("42", 1, 1, 1)).toEqual({ ok: false, reason: "out_of_stock" });
  });

  it("rejects overstock, minimum and combined unique-cap snapshots without silently clamping", async () => {
    seedVariant(1, "unique", 20, 20);
    seedVariant(2, "unique", 20, 20);
    fixture.sql.exec(`INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('42',1,1,11),('42',1,2,1);
      UPDATE product_variants SET min_qty=2 WHERE id=2`);
    const summary = await getCartSummary("42");
    expect(summary.lines.map(line => line.qty)).toEqual([11, 1]);
    expect(summary.issues.join("\n")).toContain("minimal 2");
    expect(summary.issues.join("\n")).toContain("Maksimal 10");
  });

  it.each([1.5, NaN, Infinity, 101, 0])("rejects invalid add quantity %s instead of clamping", async qty => {
    seedVariant(1, "manual", -1);
    expect(await addToCart("42", 1, 1, qty)).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it("does not silently accept increments at the maximum", async () => {
    seedVariant(1, "manual", -1);
    await addToCart("42", 1, 1, 100);
    expect(await addToCart("42", 1, 1, 1)).toEqual({ ok: false, reason: "invalid_quantity" });
    expect(await setCartLineQty("42", 1, 101)).toBe(false);
    expect(await setCartLineQty("42", 1, 1, true)).toBe(false);
    expect(await setCartLineQty("42", 1, 1.5)).toBe(false);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(100);
  });

  it("does not increment corrupted fractional quantities in SQL", async () => {
    seedVariant(1);
    fixture.sql.exec("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('42',1,1,1.5)");
    expect(await setCartLineQty("42", 1, 1, true)).toBe(false);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(1.5);
  });

  it("surfaces invalid fractional stored quantities and blocks checkout", async () => {
    seedVariant(1);
    fixture.sql.exec("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('42',1,1,1.5)");
    expect((await getCartSummary("42")).issues.join("\n")).toContain("jumlah tidak valid");
    await handleCartCheckout(42, 7, buyer);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("jumlah tidak valid") }));
    expect(JSON.stringify(vi.mocked(sendMessage).mock.calls)).not.toContain("cconfirm:");
  });

  it.each(["disabled", "inactive", "missing", "empty_inventory"])("warns and cleans unavailable rows: %s", async unavailable => {
    seedVariant(1, "unique", 10, 1);
    await addToCart("42", 1, 1, 1);
    if (unavailable === "disabled") fixture.sql.exec("UPDATE products SET telegram_enabled=0");
    if (unavailable === "inactive") fixture.sql.exec("UPDATE products SET is_active=0");
    if (unavailable === "missing") fixture.sql.exec("DELETE FROM fulfillment_inventory; DELETE FROM product_variants");
    if (unavailable === "empty_inventory") fixture.sql.exec("UPDATE fulfillment_inventory SET status='revoked'");
    await handleShowCart(42, 7, buyer);
    expect(safeEditOrSend).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("tidak tersedia") }));
    expect(vi.mocked(safeEditOrSend).mock.calls.at(-1)![0].text).toContain("&lt;test&gt;");
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it.each(["add", "absolute", "relative"])("rechecks Telegram visibility inside the %s mutation", async mutation => {
    seedVariant(1);
    await addToCart("42", 1, 1, 1);
    fixture.control.beforeRun = async sql => {
      if (sql.includes("candidate AS")) fixture.sql.exec("UPDATE products SET telegram_enabled=0");
    };
    const result = mutation === "add" ? await addToCart("42", 1, 1, 1)
      : await setCartLineQty("42", 1, mutation === "relative" ? 1 : 2, mutation === "relative");
    expect(result).toEqual(mutation === "add" ? { ok: false, reason: "cart_changed" } : false);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(1);
  });

  it("rechecks unique inventory inside the atomic mutation", async () => {
    seedVariant(1, "unique", 10, 2);
    fixture.control.beforeRun = async sql => {
      if (sql.includes("candidate AS")) fixture.sql.exec("UPDATE fulfillment_inventory SET status='revoked' WHERE id=1");
    };
    expect(await addToCart("42", 1, 1, 2)).toEqual({ ok: false, reason: "cart_changed" });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it("does not remove a row restocked and edited after a stale inventory read", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    fixture.sql.exec("UPDATE fulfillment_inventory SET status='revoked'");
    fixture.control.beforeRun = async sql => {
      if (!sql.startsWith("DELETE FROM telegram_carts")) return;
      fixture.control.beforeRun = null;
      fixture.sql.exec("UPDATE fulfillment_inventory SET status='available'");
      expect(await setCartLineQty("42", 1, 2)).toBe(true);
    };
    expect((await getCartSummary("42")).issues).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(2);
  });
});

describe("cart snapshot cleanup and payment-safe compensation", () => {
  it("only clears purchased rows unchanged while awaiting the invoice provider", async () => {
    for (let id = 1; id <= 3; id++) seedVariant(id);
    await addToCart("42", 1, 1, 1);
    await addToCart("42", 1, 2, 1);
    const summary = await getCartSummary("42");
    vi.mocked(createActiveQrisInvoice).mockImplementationOnce(async code => {
      expect(await addToCart("42", 1, 3, 1)).toEqual({ ok: true });
      expect(await setCartLineQty("42", 1, 2)).toBe(true);
      return saveInvoice(code);
    });
    await createAndSendCartInvoice(42, summary.lines, buyer, "buyer@example.com");
    expect(vi.mocked(console.error).mock.calls).toEqual([]);
    expect(fixture.sql.prepare("SELECT variant_id,qty FROM telegram_carts ORDER BY variant_id").all())
      .toEqual([{ variant_id: 1, qty: 2 }, { variant_id: 3, qty: 1 }]);
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM payment_transactions").get()?.n).toBe(1);
  });

  it("retains a same-millisecond A -> B -> A edit using updated_at as a version", async () => {
    seedVariant(1);
    await addToCart("42", 1, 1, 1);
    fixture.sql.exec("UPDATE telegram_carts SET updated_at='2099-01-01 00:00:00.000'");
    const summary = await getCartSummary("42");
    await setCartLineQty("42", 1, 2);
    await setCartLineQty("42", 1, 1);
    const updated = fixture.sql.prepare("SELECT updated_at FROM telegram_carts").get()?.updated_at;
    expect(updated).toBe("2099-01-01 00:00:00.002");
    await clearCart("42", summary.lines);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(1);
  });

  it("clears all twenty purchased rows within D1's hundred-bind limit", async () => {
    for (let id = 1; id <= 20; id++) {
      seedVariant(id);
      await addToCart("42", 1, id, 1);
    }
    const summary = await getCartSummary("42");
    fixture.control.fail = (_sql, params) => params.length > 100;
    await clearCart("42", summary.lines);
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it("retains a removed and re-added row, even with identical quantity and timestamp", async () => {
    seedVariant(1);
    await addToCart("42", 1, 1, 1);
    const summary = await getCartSummary("42");
    fixture.sql.exec("DELETE FROM telegram_carts");
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty,updated_at) VALUES('42',1,1,1,?)")
      .run(summary.lines[0].cartUpdatedAt);
    await clearCart("42", summary.lines);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(1);
  });

  it.each(["markInvoicePending", "markInvoiceSent"] as const)("preserves the active QR and reservations if %s throws", async marker => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.spyOn(invoiceDelivery, marker).mockRejectedValueOnce(new Error("Injected database interruption"));
    await expect(createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer))
      .rejects.toThrow("Injected database interruption");
    expect(state()).toMatchObject({ order: { status: "pending", payment_status: "pending" }, stock: 9,
      inventory: [{ status: "reserved" }, { status: "available" }] });
    expect(fixture.sql.prepare("SELECT status FROM payment_transactions").get()?.status).toBe("pending");
    expect(sendPhoto).toHaveBeenCalledTimes(marker === "markInvoicePending" ? 0 : 1);
  });

  it("preserves stock when the real marker SQL fails (markers swallow errors for cron retry)", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    fixture.control.fail = sql => sql.startsWith("UPDATE orders SET telegram_invoice_sent_at");
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ stock: 9, inventory: [{ status: "reserved" }, { status: "available" }] });
    expect(fixture.sql.prepare("SELECT telegram_invoice_sent_at FROM orders").get()?.telegram_invoice_sent_at).toBeNull();
  });

  it("cannot release inventory if payment wins before a marker failure", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.spyOn(invoiceDelivery, "markInvoiceSent").mockImplementationOnce(async () => {
      fixture.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'; UPDATE payment_transactions SET status='paid'");
      throw new Error("Injected database interruption");
    });
    await expect(createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer)).rejects.toThrow();
    expect(state()).toMatchObject({ order: { status: "lunas", payment_status: "paid" }, stock: 9,
      inventory: [{ status: "reserved" }, { status: "available" }] });
  });

  it.each(["gopay", "dana", "klikqris"])("preserves %s initializing invoices for generic failures", async provider => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockImplementationOnce(async code => {
      saveInvoice(code, "initializing", provider);
      throw new Error("unreadable_provider_response");
    });
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: "pending" }, stock: 9, inventory: [{ status: "reserved" }, {}] });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Cek status") }));
  });

  it("fails closed when the ledger cannot be read during compensation", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockRejectedValueOnce(new Error("provider_setup_failed"));
    fixture.control.fail = sql => sql.startsWith("SELECT id FROM payment_transactions");
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: "pending" }, stock: 9, inventory: [{ status: "reserved" }, {}] });
  });

  it("retains reservations for an ambiguous provider failure even without a readable ledger", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockRejectedValueOnce(new Error("provider_network_ambiguous"));
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: "pending" }, stock: 9, inventory: [{ status: "reserved" }, {}] });
  });

  it("atomically cancels and restores stock/inventory only when no invoice exists", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockRejectedValueOnce(new Error("provider_not_configured"));
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: "dibatalkan", payment_status: "failed" }, stock: 10,
      inventory: [{ status: "available", order_code: null }, { status: "available", order_code: null }] });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM operation_guards").get()?.n).toBe(0);
  });

  it.each(["paid", "invoice"])("a concurrent %s wins before the terminal rollback batch", async winner => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockRejectedValueOnce(new Error("provider_setup_failed"));
    const batch = fixture.db.batch.bind(fixture.db);
    fixture.db.batch = async statements => {
      if (statements.some(statement => (statement as unknown as { query: string }).query.includes("NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=?)"))) {
        const code = String(state().order?.code);
        if (winner === "paid") fixture.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'");
        else saveInvoice(code);
      }
      return batch(statements);
    };
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: winner === "paid" ? "lunas" : "pending" }, stock: 9,
      inventory: [{ status: "reserved" }, { status: "available" }] });
  });

  it("a rollback interruption cannot partly release reservations", async () => {
    seedVariant(1, "unique", 10, 2);
    await addToCart("42", 1, 1, 1);
    vi.mocked(createActiveQrisInvoice).mockRejectedValueOnce(new Error("provider_setup_failed"));
    fixture.control.fail = sql => sql.includes("UPDATE orders") && sql.includes("SET status=?");
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(state()).toMatchObject({ order: { status: "pending" }, stock: 9,
      inventory: [{ status: "reserved" }, { status: "available" }] });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM operation_guards").get()?.n).toBe(0);
  });
});
