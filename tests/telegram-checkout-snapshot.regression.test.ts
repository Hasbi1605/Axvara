import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { getActiveVariant } from "@/lib/catalog";
import { addToCart, getCartSummary, setCartLineQty } from "@/lib/telegram/cart";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { readCheckoutEmail } from "@/lib/telegram/checkout-email";
import { handlePayWithQris, createAndSendVariantInvoice } from "@/lib/telegram/handlers/invoice";
import { createAndSendCartInvoice } from "@/lib/telegram/handlers/cart-invoice";
import { handleCartAdjust, handleCartCheckout } from "@/lib/telegram/handlers/cart";
import { handleShowQty } from "@/lib/telegram/handlers/catalog";
import { showEmailConfirmation } from "@/lib/telegram/handlers/discovery";
import { sendMessage, safeEditOrSend } from "@/lib/telegram/api";
import { createChannelOrderAtomic } from "@/lib/commerce";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
  showLoadingBar: vi.fn(async () => {}),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/telegram/handlers/catalog", () => ({ handleShowQty: vi.fn() }));
vi.mock("@/lib/telegram/handlers/discovery", () => ({ showEmailConfirmation: vi.fn() }));
vi.mock("@/lib/telegram/payment-maintenance", () => ({ notifyPaymentMaintenance: vi.fn(async () => false) }));
vi.mock("@/lib/payments/dana-qris", () => ({ isActiveQrisConfigured: () => true, createActiveQrisInvoice: vi.fn(), qrisPaymentAccountLabel: () => "GoPay Merchant" }));
vi.mock("@/lib/telegram/invoice-retry", () => ({ retryTelegramInvoiceDelivery: vi.fn(async () => true) }));
vi.mock("@/lib/commerce", () => ({ createChannelOrderAtomic: vi.fn(async () => ({ code: "EXISTING", isExisting: true })) }));

let fixture: ReturnType<typeof createD1Fixture>;
const buyer = { id: 42, first_name: "Pembeli" };
const line = { productId: 1, variantId: 1, qty: 1, price: 1000 };

function seedVariant(id: number, mode = "manual", stock = 100, minQty = 1) {
  fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,min_qty)
    VALUES(?,1,?,'Paket',1000,?,?,?)`).run(id, `SKU-${id}`, stock, mode, minQty);
  if (mode === "unique") seedInventory(id);
}

function seedInventory(variantId: number) {
  for (let i = 0; i < 10; i++) fixture.sql.prepare(`INSERT INTO fulfillment_inventory
    (product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint)
    VALUES(1,?,'fixture','fixture',?)`).run(variantId, `${variantId}-${i}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture = createD1Fixture();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network_forbidden_in_checkout_regression"); }));
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Produk','produk',1000,100);
    INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email) VALUES('42','42','Pembeli','buyer@example.com')`);
  seedVariant(1);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fixture.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("checkout consent and required-email snapshot", () => {
  it("uses a short canonical public tag and binds price, product, variant and quantity", async () => {
    const second = { ...line, variantId: 2 };
    const tag = await checkoutApprovalTag([line, second]);
    expect(tag).toMatch(/^[a-f0-9]{12}$/);
    expect(await checkoutApprovalTag([second, line])).toBe(tag);
    for (const field of ["price", "productId", "variantId", "qty"] as const) {
      expect(await checkoutApprovalTag([{ ...line, [field]: line[field] + 1 }, second])).not.toBe(tag);
    }
    expect(await checkoutApprovalTag([{ ...line, contact: "private@example.com" } as typeof line])).toBe(await checkoutApprovalTag([line]));
    await expect(checkoutApprovalTag([{ ...line, price: NaN }])).rejects.toThrow("invalid_checkout_snapshot");
  });

  it("missing approval only refreshes quantity, never creates an order", async () => {
    await handlePayWithQris(42, 7, 1, 1, 1, buyer);
    expect(handleShowQty).toHaveBeenCalledWith(42, 7, 1, 1, 1);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("a stale price approval refreshes quantity instead of charging the new price", async () => {
    const tag = await checkoutApprovalTag([line]);
    fixture.sql.exec("UPDATE product_variants SET price=2000 WHERE id=1");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, tag);
    expect(handleShowQty).toHaveBeenCalledWith(42, 7, 1, 1, 1);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("failed requirement reads cannot bypass mandatory email", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    fixture.control.fail = sql => sql.includes("SELECT pv.id, pv.product_id, wv.wr_type");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]));
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Email belum bisa diperiksa. Coba lagi sebelum membayar." }));
  });

  it("failed saved-email reads cannot create an email-less order", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]));
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("retains the confirmed snapshot after the saved email changes without reading it again", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1; UPDATE telegram_users SET buyer_email='changed@example.com'");
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]), "buyer@example.com");
    expect(createChannelOrderAtomic).toHaveBeenCalledWith(expect.objectContaining({ customerEmail: "buyer@example.com" }));
  });

  it.each([0, 1])("confirmed=true without a snapshot refreshes confirmation even with require_email=%i", async required => {
    fixture.sql.prepare("UPDATE products SET require_email=? WHERE id=1").run(required);
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]));
    expect(showEmailConfirmation).toHaveBeenCalledWith(42, 1, 1, 1, "buyer@example.com", null, 7);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it.each(["", " ", "not-an-email"])("an invalid confirmed snapshot %j cannot fall back to the saved email", async confirmedEmail => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]), confirmedEmail);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Email dibutuhkan") }));
  });

  it("a supplied snapshot without email confirmation cannot authorize a required-email order", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, false, await checkoutApprovalTag([line]), "unconfirmed@example.com");
    expect(showEmailConfirmation).toHaveBeenCalledWith(42, 1, 1, 1, "buyer@example.com", null, 7);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("an already-consumed confirmation does not clear a newer pending action", async () => {
    fixture.sql.exec("UPDATE telegram_users SET pending_action='email_confirm:1:1:1:newer'");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer, true, await checkoutApprovalTag([line]), "buyer@example.com");
    expect(fixture.sql.prepare("SELECT pending_action FROM telegram_users").get()?.pending_action).toBe("email_confirm:1:1:1:newer");
  });

  it("checks every cart line and rejects a missing catalog row", async () => {
    await expect(readCheckoutEmail("42", [line, { productId: 1, variantId: 2 }])).rejects.toThrow("checkout_email_catalog_missing");
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("cart factory fails closed when the required-email lookup is unavailable", async () => {
    await addToCart("42", 1, 1, 1);
    const summary = await getCartSummary("42");
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await createAndSendCartInvoice(42, summary.lines, buyer);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
  });

  it("cart factory requires email for an Invite line even when the first line does not", async () => {
    seedVariant(2);
    fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wp','Invite');
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_type,wr_delivery_class) VALUES('invite','wp','Invite',500,'Invite','restock');
      UPDATE product_variants SET wr_variant_id='invite' WHERE id=2;
      UPDATE telegram_users SET buyer_email=NULL`);
    await addToCart("42", 1, 1, 1);
    await addToCart("42", 1, 2, 1);
    await createAndSendCartInvoice(42, (await getCartSummary("42")).lines, buyer);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("factories retain explicitly validated email snapshots even if the saved email cannot be read again", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    const variant = (await getActiveVariant(1))!;
    await addToCart("42", 1, 1, 1);
    const summary = await getCartSummary("42");
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await createAndSendVariantInvoice(42, 7, 1, "Produk", variant, buyer, 1, "snapshot@example.com");
    await createAndSendCartInvoice(42, summary.lines, buyer, "snapshot@example.com");
    expect(createChannelOrderAtomic).toHaveBeenCalledTimes(2);
    for (const [input] of vi.mocked(createChannelOrderAtomic).mock.calls) expect(input.customerEmail).toBe("snapshot@example.com");
  });

  it("reuses an existing pending order before checking current price, stock or email", async () => {
    fixture.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,variant_id)
      VALUES('RETRY','Pembeli','','[]',1000,'qris','pending','unpaid','telegram','42','42',1);
      UPDATE product_variants SET price=3000,stock=0,is_active=0;
      UPDATE products SET is_active=0,require_email=1`);
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer);
    await handleCartCheckout(42, 7, buyer);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(handleShowQty).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("RETRY") }));
  });

  it("cart confirmation carries the exact displayed snapshot tag", async () => {
    await addToCart("42", 1, 1, 2);
    await handleCartCheckout(42, 7, buyer);
    const sent = vi.mocked(safeEditOrSend).mock.calls.at(-1)![0];
    expect(sent.message_id).toBe(7);
    expect(sent.reply_markup).toEqual(expect.objectContaining({
      inline_keyboard: expect.arrayContaining([[expect.objectContaining({ callback_data: `cconfirm:${await checkoutApprovalTag([{ ...line, qty: 2 }])}` })]]),
    }));
  });
});

describe("atomic cart quantity mutations with real SQLite", () => {
  it("parallel adds accumulate instead of overwriting each other", async () => {
    await addToCart("42", 1, 1, 1);
    expect((await Promise.all([addToCart("42", 1, 1, 1), addToCart("42", 1, 1, 1)])).every(r => r.ok)).toBe(true);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(3);
  });

  it("parallel button increments use durable quantity", async () => {
    await addToCart("42", 1, 1, 1);
    await Promise.all([handleCartAdjust(42, 7, buyer, 1, 1), handleCartAdjust(42, 7, buyer, 1, 1)]);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(3);
  });

  it("an add and a button increment cannot overwrite each other", async () => {
    await addToCart("42", 1, 1, 1);
    const results = await Promise.all([addToCart("42", 1, 1, 2), setCartLineQty("42", 1, 1, true)]);
    expect(results).toEqual([{ ok: true }, true]);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(4);
  });

  it("a stale summary cleanup cannot delete a new increment after restock", async () => {
    await addToCart("42", 1, 1, 1);
    fixture.sql.exec("UPDATE product_variants SET stock=0 WHERE id=1");
    fixture.control.beforeRun = async sql => {
      if (!sql.startsWith("DELETE FROM telegram_carts")) return;
      fixture.control.beforeRun = null;
      fixture.sql.exec("UPDATE product_variants SET stock=10 WHERE id=1");
      expect(await addToCart("42", 1, 1, 1)).toEqual({ ok: true });
    };
    await getCartSummary("42");
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(2);
  });

  it("concurrent new lines cannot exceed 20 lines", async () => {
    for (let id = 2; id <= 21; id++) seedVariant(id);
    for (let id = 1; id <= 19; id++) await addToCart("42", 1, id, 1);
    const results = await Promise.all([addToCart("42", 1, 20, 1), addToCart("42", 1, 21, 1)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(20);
  });

  it("concurrent unique lines cannot exceed the combined ten-unit cap", async () => {
    fixture.sql.exec("UPDATE product_variants SET fulfillment_mode='unique' WHERE id=1");
    seedInventory(1);
    seedVariant(2, "unique");
    seedVariant(3, "unique");
    await addToCart("42", 1, 1, 9);
    const results = await Promise.all([addToCart("42", 1, 2, 1), addToCart("42", 1, 3, 1)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT SUM(qty) AS n FROM telegram_carts").get()?.n).toBe(10);
  });

  it("parallel quantity updates cannot exceed the combined unique cap", async () => {
    fixture.sql.exec("UPDATE product_variants SET fulfillment_mode='unique' WHERE id=1");
    seedInventory(1);
    seedVariant(2, "unique");
    await addToCart("42", 1, 1, 4);
    await addToCart("42", 1, 2, 5);
    const results = await Promise.all([setCartLineQty("42", 1, 1, true), setCartLineQty("42", 2, 1, true)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT SUM(qty) AS n FROM telegram_carts").get()?.n).toBe(10);
  });

  it("checks stock again in the atomic mutation when stock changes after the initial read", async () => {
    fixture.control.beforeRun = async sql => {
      if (sql.includes("INSERT INTO telegram_carts")) fixture.sql.exec("UPDATE product_variants SET stock=1 WHERE id=1");
    };
    expect(await addToCart("42", 1, 1, 2)).toEqual({ ok: false, reason: "cart_changed" });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it("parallel adds cannot exceed stock", async () => {
    fixture.sql.exec("UPDATE product_variants SET stock=2 WHERE id=1");
    const results = await Promise.all([addToCart("42", 1, 1, 2), addToCart("42", 1, 1, 2)]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(2);
  });

  it("minimum quantity cannot be overridden or decremented below the variant minimum", async () => {
    fixture.sql.exec("UPDATE product_variants SET min_qty=50 WHERE id=1");
    expect(await addToCart("42", 1, 1, 1, 1)).toEqual({ ok: false, reason: "below_minimum" });
    expect(await addToCart("42", 1, 1, 50)).toEqual({ ok: true });
    expect(await setCartLineQty("42", 1, 49)).toBe(false);
    expect(await setCartLineQty("42", 1, -1, true)).toBe(false);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(50);
  });

  it("checks the live minimum if it increases between validation and the cart write", async () => {
    fixture.control.beforeRun = async sql => {
      if (sql.includes("INSERT INTO telegram_carts")) fixture.sql.exec("UPDATE product_variants SET min_qty=50 WHERE id=1");
    };
    expect(await addToCart("42", 1, 1, 1)).toEqual({ ok: false, reason: "cart_changed" });
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM telegram_carts").get()?.n).toBe(0);
  });

  it("set quantity enforces stock for ordinary modes and rejects non-finite input", async () => {
    fixture.sql.exec("UPDATE product_variants SET stock=2 WHERE id=1");
    await addToCart("42", 1, 1, 1);
    expect(await setCartLineQty("42", 1, 3)).toBe(false);
    expect(await setCartLineQty("42", 1, NaN)).toBe(false);
    expect(await setCartLineQty("42", 1, 2)).toBe(true);
    expect(await setCartLineQty("42", 1, 1, true)).toBe(false);
    expect(fixture.sql.prepare("SELECT qty FROM telegram_carts").get()?.qty).toBe(2);
  });
});
