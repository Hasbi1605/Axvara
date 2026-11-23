import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { getActiveVariant } from "@/lib/catalog";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { readCheckoutEmail } from "@/lib/telegram/checkout-email";
import { handlePayWithQris, createAndSendVariantInvoice } from "@/lib/telegram/handlers/invoice";
import { handleShowQty } from "@/lib/telegram/handlers/catalog";
import { showEmailConfirmation } from "@/lib/telegram/handlers/discovery";
import { sendMessage } from "@/lib/telegram/api";
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
vi.mock("@/lib/payments/qris", () => ({ isActiveQrisConfigured: () => true, createActiveQrisInvoice: vi.fn(), qrisPaymentAccountLabel: () => "GoPay Merchant" }));
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

  it("checks every checkout line and rejects a missing catalog row", async () => {
    await expect(readCheckoutEmail("42", [line, { productId: 1, variantId: 2 }])).rejects.toThrow("checkout_email_catalog_missing");
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("variant factory fails closed when the required-email lookup is unavailable", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    const variant = (await getActiveVariant(1))!;
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await createAndSendVariantInvoice(42, 7, 1, "Produk", variant, buyer, 1);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
  });

  it("variant factory requires email for an Invite variant", async () => {
    seedVariant(2);
    fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wp','Invite');
      INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_type,wr_delivery_class) VALUES('invite','wp','Invite',500,'Invite','restock');
      UPDATE product_variants SET wr_variant_id='invite' WHERE id=2;
      UPDATE telegram_users SET buyer_email=NULL`);
    const variant = (await getActiveVariant(2))!;
    await createAndSendVariantInvoice(42, 7, 1, "Produk", variant, buyer, 1);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
  });

  it("factory retains explicitly validated email snapshot even if the saved email cannot be read again", async () => {
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=1");
    const variant = (await getActiveVariant(1))!;
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await createAndSendVariantInvoice(42, 7, 1, "Produk", variant, buyer, 1, "snapshot@example.com");
    expect(createChannelOrderAtomic).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createChannelOrderAtomic).mock.calls[0][0].customerEmail).toBe("snapshot@example.com");
  });

  it("reuses an existing pending order before checking current price, stock or email", async () => {
    fixture.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,variant_id)
      VALUES('RETRY','Pembeli','','[]',1000,'qris','pending','unpaid','telegram','42','42',1);
      UPDATE product_variants SET price=3000,stock=0,is_active=0;
      UPDATE products SET is_active=0,require_email=1`);
    fixture.control.fail = sql => sql.startsWith("SELECT buyer_email");
    await handlePayWithQris(42, 7, 1, 1, 1, buyer);
    expect(createChannelOrderAtomic).not.toHaveBeenCalled();
    expect(handleShowQty).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("RETRY") }));
  });
});
