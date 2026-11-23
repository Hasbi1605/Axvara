import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { handlePendingEmailInput, showEmailConfirmation } from "@/lib/telegram/handlers/discovery";
import { checkoutApprovalTag } from "@/lib/telegram/checkout-approval";
import { checkoutEmailFingerprint, readCheckoutEmail } from "@/lib/telegram/checkout-email";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { transitionPendingOrder } from "@/lib/db";
import { createActiveQrisInvoice } from "@/lib/payments/qris";
import { sendMessage, sendPhoto, sendChatAction, safeEditOrSend, withLoadingIndicator } from "@/lib/telegram/api";
import type { SendMessageParams } from "@/lib/telegram/types";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(), sendPhoto: vi.fn(), sendChatAction: vi.fn(), safeEditOrSend: vi.fn(), showLoadingBar: vi.fn(async () => {}), withLoadingIndicator: vi.fn(async (_chat, _label, work) => work(async () => {})),
}));
vi.mock("@/lib/payments/qris", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/qris")>(),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: vi.fn(),
}));
vi.mock("@/lib/commerce", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/commerce")>();
  return { ...actual, createChannelOrderAtomic: vi.fn(actual.createChannelOrderAtomic) };
});

const buyer = { id: 12345, first_name: "Pembeli" };
const savedEmail = "buyer@example.com";
const changedEmail = "changed@example.net";
const factory = vi.mocked(createChannelOrderAtomic);
const provider = vi.mocked(createActiveQrisInvoice);
const send = vi.mocked(sendMessage);
const edit = vi.mocked(safeEditOrSend);
let fx: ReturnType<typeof createD1Fixture>;

const click = (data: string, chatId = buyer.id, from = buyer) => handleCallback(data, chatId, 7, from);
const user = () => fx.sql.prepare("SELECT buyer_email,pending_action FROM telegram_users WHERE user_id=?").get(String(buyer.id))!;
const orders = () => fx.sql.prepare("SELECT * FROM orders ORDER BY id").all();
const sent = () => (send.mock.invocationCallOrder.at(-1) ?? 0) > (edit.mock.invocationCallOrder.at(-1) ?? 0)
  ? send.mock.calls.at(-1)![0] : edit.mock.calls.at(-1)![0];
const edited = () => edit.mock.calls.at(-1)![0];
function callbacks(message: Pick<SendMessageParams, "reply_markup">): string[] {
  const markup = message.reply_markup;
  return markup && "inline_keyboard" in markup
    ? markup.inline_keyboard.flat().flatMap(button => button.callback_data ? [button.callback_data] : [])
    : [];
}
function button(message: Pick<SendMessageParams, "reply_markup">, prefix: string): string {
  const matches = callbacks(message).filter(data => data.startsWith(prefix));
  expect(matches).toHaveLength(1);
  return matches[0];
}
async function quantity(qty = 2) {
  await click(`q:1:1:${qty}`);
  const pmentry = button(edited(), "pmentry:");
  expect(pmentry).toBe(`pmentry:1:1:${qty}:${await checkoutApprovalTag([{ productId: 1, variantId: 1, qty, price: 10000 }])}`);
  return pmentry;
}
async function singleConfirmation() {
  await click(await quantity());
  expect(edited().message_id).toBe(7);
  expect(send).not.toHaveBeenCalled();
  return button(sent(), "epay:");
}
function changeEmailAfterClaim() {
  fx.control.afterRun = async query => {
    if (!query.startsWith("UPDATE telegram_users SET pending_action=NULL WHERE user_id=? AND pending_action=? AND buyer_email=?")) return;
    fx.control.afterRun = null;
    fx.sql.prepare("UPDATE telegram_users SET buyer_email=? WHERE user_id=?").run(changedEmail, String(buyer.id));
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", "telegram-router-checkout-fixture-secret-only");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request in Telegram checkout integration"); }));
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 2);
  fx.sql.exec("UPDATE products SET name='Google AI Pro',require_email=1; UPDATE product_variants SET label='Google Head 18Bulan',duration_value=1,duration_unit='month',duration_label=NULL WHERE id=1");
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name,buyer_email) VALUES(?,?,?,?)")
    .run(String(buyer.id), String(buyer.id), buyer.first_name, savedEmail);
  send.mockResolvedValue({ ok: true, result: { message_id: 1, date: 0, chat: { id: buyer.id, type: "private" } } });
  edit.mockImplementation(async params => params.message_id ? { ok: true } : send(params));
  vi.mocked(sendPhoto).mockResolvedValue({ ok: true });
  vi.mocked(sendChatAction).mockResolvedValue({ ok: true });
  provider.mockImplementation(async (code, amount) => {
    // Item 6 (W-B): the invoice path no longer shows a loading bar, so this
    // assertion was intentionally removed (no artificial UI latency).
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const qrisUrl = `https://example.test/${code}.png`;
    fx.sql.prepare(`INSERT INTO payment_transactions
      (order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at,qris_url)
      VALUES(?,'gopay','inhouse',?,'fixture',?,?,'pending',?,?)`)
      .run(code, code, amount, amount + 89, expiresAt, qrisUrl);
    return { orderCode: code, requestedAmount: amount, uniqueCode: 89, qrisPayload: "fixture", isExisting: false, qrisUrl, payableAmount: amount + 89, expiresAt };
  });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  fx.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Telegram router single-item checkout with real D1", () => {
  it("cancels a definitive invoice setup failure atomically and cannot restore stock twice", async () => {
    provider.mockRejectedValueOnce(new Error("invoice_configuration_invalid"));
    await click(await singleConfirmation());
    const order = orders()[0];
    expect(order).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    await expect(transitionPendingOrder(String(order.code), "kadaluarsa", null, JSON.parse(String(order.items)))).rejects.toThrow();
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it.each(["pending", "failed", "expired", "paid"])("preserves reservations when a %s ledger exists after invoice failure", async status => {
    const createInvoice = provider.getMockImplementation()!;
    provider.mockImplementationOnce(async (...args) => {
      await createInvoice(...args);
      fx.sql.prepare("UPDATE payment_transactions SET status=?").run(status);
      throw new Error("invoice_response_invalid");
    });
    await click(await singleConfirmation());
    expect(orders()[0].status).toBe("pending");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
    expect(button(sent(), "refresh:")).toBe(`refresh:${orders()[0].code}`);
  });

  it("keeps a timeout without a visible ledger pending rather than releasing stock", async () => {
    provider.mockRejectedValueOnce(new Error("invoice_timeout"));
    await click(await singleConfirmation());
    expect(orders()[0].status).toBe("pending");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("rolls back cancellation and stock together if its batch fails", async () => {
    provider.mockImplementationOnce(async () => {
      fx.control.fail = query => query.includes("UPDATE orders") && query.includes("admin_note");
      throw new Error("invoice_configuration_invalid");
    });
    await click(await singleConfirmation());
    expect(orders()[0].status).toBe("pending");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("a payment winning invoice failure cannot be cancelled or have its stock released", async () => {
    provider.mockImplementationOnce(async () => {
      fx.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'");
      throw new Error("invoice_response_invalid");
    });
    await click(await singleConfirmation());
    expect(orders()[0]).toMatchObject({ status: "lunas", payment_status: "paid" });
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
  });

  it("routes tagged quantity through masked saved-email confirmation into the real factory", async () => {
    const epay = await singleConfirmation();
    const [, productId, variantId, qty, tag, nonce] = epay.split(":");
    expect(nonce).toMatch(/^[a-f0-9]{8}$/);
    expect(tag).toMatch(/^[a-f0-9]{12}$/);
    expect(user().pending_action).toBe(`email_confirm:${productId}:${variantId}:${qty}:${nonce}:${await checkoutEmailFingerprint(savedEmail)}`);
    expect(sent().text).toContain("b***r@example.com");
    expect(sent().text).not.toContain(savedEmail);
    expect(epay).not.toContain(savedEmail);
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    changeEmailAfterClaim();
    await click(epay);
    expect(user()).toMatchObject({ pending_action: null, buyer_email: changedEmail });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      customerEmail: savedEmail, subtotal: 20000, telegramUserId: String(buyer.id),
      items: [expect.objectContaining({ product_id: 1, variant_id: 1, price: 10000, qty: 2 })],
    }));
    expect(orders()).toHaveLength(1);
    expect(orders()[0]).toMatchObject({ customer_email: savedEmail, subtotal: 20000 });
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
  });

  it.each(["pmentry", "pay", "epay"])("a price change before %s refreshes without reaching the factory", async stage => {
    const callback = stage === "epay"
      ? await singleConfirmation()
      : stage === "pay"
        ? (await quantity()).replace(/^pmentry:/, "pay:")
        : await quantity();
    fx.sql.exec("UPDATE product_variants SET price=12000 WHERE id=1");
    edit.mockClear();
    await click(callback);
    const updatedTag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 2, price: 12000 }]);
    if (stage === "pmentry") {
      expect(button(edited(), "pmentry:")).toBe(`pmentry:1:1:2:${updatedTag}`);
    } else {
      expect(callbacks(edited())).toContain("q:1:1:1");
      await click("q:1:1:2");
      expect(button(edited(), "pmentry:")).toBe(`pmentry:1:1:2:${updatedTag}`);
    }
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
  });

  it("changing saved email invalidates the old callback even when pending_action is unchanged", async () => {
    const oldCallback = await singleConfirmation();
    const oldState = user().pending_action;
    fx.sql.prepare("UPDATE telegram_users SET buyer_email=?").run(changedEmail);
    expect(user().pending_action).toBe(oldState);
    await click(oldCallback);
    expect(factory).not.toHaveBeenCalled();
    await click("q:1:1:2");
    await click(button(edited(), "pmentry:"));
    expect(sent().text).toContain("c***d@example.net");
    const current = button(sent(), "epay:");
    expect(current).not.toBe(oldCallback);
    expect(user().pending_action).toContain(await checkoutEmailFingerprint(changedEmail));
    await click(current);
    expect(orders()[0].customer_email).toBe(changedEmail);
  });

  it.each([1, 0])("a consumed epay cannot create another order after payment (require_email=%i)", async required => {
    const epay = await singleConfirmation();
    await click(epay);
    expect(factory).toHaveBeenCalledTimes(1);
    fx.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'; UPDATE payment_transactions SET status='paid'");
    fx.sql.prepare("UPDATE products SET require_email=?").run(required);
    await click(epay);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(orders()).toHaveLength(1);
  });

  it("two concurrent clicks claim the single email nonce only once", async () => {
    const epay = await singleConfirmation();
    await Promise.all([click(epay), click(epay)]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(orders()).toHaveLength(1);
  });

  it("a missing single-item email prompts input then confirmation, not an invoice", async () => {
    fx.sql.exec("UPDATE telegram_users SET buyer_email=NULL");
    await click(await quantity());
    expect(user().pending_action).toBe("email_for:1:1:2");
    expect(sent().reply_markup).toMatchObject({ force_reply: true });
    expect(await handlePendingEmailInput(savedEmail, buyer.id, buyer)).toBe(true);
    expect(button(sent(), "epay:")).toMatch(/^epay:1:1:2:[a-f0-9]{12}:[a-f0-9]{8}$/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("showEmailConfirmation uses expectedAction CAS and cannot overwrite newer navigation", async () => {
    await click("var:1");
    send.mockClear();
    await showEmailConfirmation(buyer.id, 1, 1, 2, savedEmail);
    expect(send).not.toHaveBeenCalled();
    expect(user().pending_action).toBe("qty_for:1:1");
    await showEmailConfirmation(buyer.id, 1, 1, 2, savedEmail, "qty_for:1:1");
    const state = user().pending_action;
    expect(button(sent(), "epay:")).toMatch(/:[a-f0-9]{8}$/);
    await click("search");
    send.mockClear();
    await showEmailConfirmation(buyer.id, 1, 1, 2, savedEmail, String(state));
    expect(user().pending_action).toBe("search:");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Telegram checkout fail-closed reads and navigation", () => {
  it("a failed requirements read cannot authorize single checkout", async () => {
    const callback = await quantity();
    fx.control.fail = query => query.includes("SELECT pv.id, pv.product_id, wv.wr_type");
    await click(callback);
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
    expect(sent().text).toMatch(/Email.*diperiksa/i);
  });

  it("a failed saved-email read cannot create an email-less single order", async () => {
    const callback = await quantity();
    fx.control.fail = query => query.startsWith("SELECT buyer_email");
    await click(callback);
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
  });

  it("a missing or mismatched requirement row is not treated as email-optional", async () => {
    await expect(readCheckoutEmail(String(buyer.id), [{ productId: 1, variantId: 999 }])).rejects.toThrow("checkout_email_catalog_missing");
    await expect(readCheckoutEmail(String(buyer.id), [{ productId: 999, variantId: 1 }])).rejects.toThrow("checkout_email_catalog_missing");
    expect(factory).not.toHaveBeenCalled();
  });

  it("navigation expires an old single email prompt before a later email reply", async () => {
    fx.sql.exec("UPDATE telegram_users SET buyer_email=NULL");
    await click(await quantity());
    expect(String(user().pending_action)).toMatch(/^email_for:/);
    await click("catalog:0");
    expect(user().pending_action).toBeNull();
    send.mockClear();
    expect(await handlePendingEmailInput(savedEmail, buyer.id, buyer)).toBe(false);
    expect(user().buyer_email).toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("navigation racing a single email write cannot revive the old prompt", async () => {
    fx.sql.exec("UPDATE telegram_users SET buyer_email=NULL");
    await click(await quantity());
    fx.control.beforeRun = async query => {
      if (!query.includes("SET buyer_email=?")) return;
      fx.control.beforeRun = null;
      await click("catalog:0");
    };
    send.mockClear();
    expect(await handlePendingEmailInput(savedEmail, buyer.id, buyer)).toBe(true);
    expect(user()).toMatchObject({ buyer_email: null, pending_action: null });
    expect(send).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("Telegram callback ownership and cancellation", () => {
  it("cancel first asks for confirmation; only the owner's cancelok mutates order, ledger and stock", async () => {
    await click(await singleConfirmation());
    const code = String(orders()[0].code);
    const before = orders()[0];
    await click(`cancel:${code}`);
    const cancelok = button(sent(), "cancelok:");
    expect(orders()[0]).toEqual(before);
    expect(fx.sql.prepare("SELECT status FROM payment_transactions").get()?.status).toBe("pending");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(98);
    await click(cancelok, 999, { id: 999, first_name: "Other" });
    await click(cancelok, -999);
    expect(orders()[0]).toEqual(before);
    await click(cancelok);
    expect(orders()[0]).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
    expect(fx.sql.prepare("SELECT status FROM payment_transactions").get()?.status).toBe("cancelled");
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
    await click(cancelok);
    expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
  });

  it.each(["order", "refresh", "cred", "cancel", "cancelok", "qrenew", "wainput"])("rejects foreign-owner %s callbacks", async action => {
    await click(await singleConfirmation());
    const before = orders()[0];
    send.mockClear();
    await click(`${action}:${before.code}`, 999, { id: 999, first_name: "Other" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(callbacks(sent())).toEqual([]);
    expect(orders()[0]).toEqual(before);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["pay:1:1:2:tag", "epay:1:1:2:tag:nonce", "eedit:1:1:2", "qinput:1:1", "pmentry:1:1:2:tag"])(
    "rejects group checkout action %s before mutating buyer state", async callback => {
      const before = user();
      await click(callback, -999);
      expect(user()).toEqual(before);
      expect(factory).not.toHaveBeenCalled();
      expect(provider).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
});

describe("Telegram actual catalog labels, inventory and callback budgets", () => {
  it("uses the canonical Google Head 18Bulan label in product and quantity without appending 1 month or showing cart", async () => {
    await click("prd:1");
    expect(withLoadingIndicator).not.toHaveBeenCalled();
    const product = edited();
    expect(product.text).toBe("<b>Google AI Pro</b>\nPilih varian 👇");
    const var1Btn = (product.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] }).inline_keyboard.flat().find((b) => b.callback_data === "var:1");
    expect(var1Btn?.text).toContain("Google Head 18Bulan");
    expect(var1Btn?.text).not.toMatch(/1\s*(month|bulan)\b/i);
    await click(button(product, "var:1"));
    expect(edited().text).toContain("Google Head 18Bulan");
    expect(edited().text).not.toMatch(/1\s*(month|bulan)\b/i);
    expect(callbacks(edited()).some((d) => d.startsWith("cadd:"))).toBe(false);
  });

  it("zero effective unique inventory disables product buying, quantity and stale review/pay callbacks", async () => {
    const pmentry = await quantity();
    const stalePay = pmentry.replace(/^pmentry:/, "pay:");
    fx.sql.exec("UPDATE product_variants SET fulfillment_mode='unique',stock=100 WHERE id=1; UPDATE product_variants SET is_active=0 WHERE id=2");
    await click("prd:1");
    expect(callbacks(edited())).not.toContain("var:1");
    edit.mockClear();
    await click("var:1");
    await click("qty:1:1");
    expect(edit).not.toHaveBeenCalled();
    await click(pmentry);
    await click(stalePay);
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
  });

  it("all generated checkout/terms callback_data fit 64 UTF-8 bytes with maximum safe integer IDs", async () => {
    const id = Number.MAX_SAFE_INTEGER;
    fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,require_email) VALUES(?,'Large IDs','large-ids',10000,100,1)").run(id);
    fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(?,?,'MAX','Large IDs',10000,100)").run(id, id);
    await click(`qty:${id}:${id}`);
    const qtyMessage = edited();
    await click(`q:${id}:${id}:100`);
    const reviewMessage = edited();
    await click(button(reviewMessage, "pmentry:"));
    const emailMessage = sent();
    expect(button(emailMessage, "epay:").split(":").at(-1)).toMatch(/^[a-f0-9]{8}$/);
    for (const message of [qtyMessage, reviewMessage, emailMessage]) {
      expect(callbacks(message).length).toBeGreaterThan(0);
      for (const data of callbacks(message)) expect(Buffer.byteLength(data, "utf8"), data).toBeLessThanOrEqual(64);
    }
    expect(Buffer.byteLength(button(emailMessage, "epay:"), "utf8")).toBe(64);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("Telegram terms pagination through callbacks", () => {
  it("sends one page per click and preserves every escaped character across page boundaries", async () => {
    const rules = Array.from({ length: 35 }, (_, i) => `Wajib aturan ${i}: ${'<tag> & "quoted" '.repeat(5)}akhir-${i}`);
    fx.sql.prepare("UPDATE product_variants SET admin_terms=?,admin_copy_fingerprint='' WHERE id=1")
      .run(`Aturan pakai:\n${rules.map(rule => `- ${rule}`).join("\n")}`);
    let callback = "terms:1:1";
    const bodies: string[] = [];
    const visited = new Set<string>();
    for (let page = 0; page < 20; page++) {
      expect(visited.has(callback)).toBe(false);
      visited.add(callback);
      edit.mockClear();
      send.mockClear();
      await click(callback);
      expect(edit).toHaveBeenCalledTimes(1);
      const message = sent();
      expect(message.parse_mode).toBe("HTML");
      expect(message.text.length).toBeLessThanOrEqual(3900);
      const header = "<b>Google Head 18Bulan</b>\n\n";
      expect(message.text.startsWith(header)).toBe(true);
      bodies.push(message.text.slice(header.length));
      expect(message.text.replaceAll(header, "")).not.toMatch(/<tag>|"quoted"|&(?!amp;|lt;|gt;|quot;)/);
      for (const data of callbacks(message)) expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
      const next = callbacks(message).find(data => data === `terms:1:1:${page + 1}`);
      if (!next) break;
      callback = next;
    }
    expect(bodies.length).toBeGreaterThan(1);
    const expected = `Aturan pakai\n${rules.map(rule => `\u2022 ${rule}`).join("\n")}\n`
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    expect(bodies.join("")).toBe(expected);
    expect(factory).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it("propagates failed terms sends instead of acknowledging an unread page", async () => {
    edit.mockResolvedValueOnce({ ok: false, description: "fixture send failed" });
    await expect(click("terms:1:1")).rejects.toThrow("telegram_terms_send_failed");
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
