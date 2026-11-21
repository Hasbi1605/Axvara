import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { handleCallback } from "@/lib/telegram/handlers/callback";
import { sendMessage, sendPhoto, safeEditOrSend } from "@/lib/telegram/api";
import { getActiveVariant, buyerDeliveryKind } from "@/lib/catalog";
import { parsePayq1State } from "@/lib/telegram/payment-quote";
import type { InlineKeyboardButton } from "@/lib/telegram/types";
import { createD1Fixture } from "./helpers/d1-fixture";
import { seedCryptoMarket } from "./helpers/crypto-market";

vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async () => ({ ok: true })),
  sendPhoto: vi.fn(async () => ({ ok: true })),
  safeEditOrSend: vi.fn(async () => ({ ok: true })),
  sendChatAction: vi.fn(async () => ({ ok: true })),
  answerCallbackQuery: vi.fn(async () => ({ ok: true })),
}));
const qrisCreate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/qris", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payments/qris")>(),
  isActiveQrisConfigured: () => true,
  createActiveQrisInvoice: qrisCreate,
}));

const buyer = { id: 777394, first_name: "Pembeli" };
let fx: ReturnType<typeof createD1Fixture>;
const remoteCreate = vi.fn();
const click = (data: string) => handleCallback(data, buyer.id, 21, buyer, "fixture");
const state = () => parsePayq1State(String(fx.sql.prepare("SELECT pending_action FROM telegram_users").get()?.pending_action));
const lastMessage = () => [vi.mocked(sendMessage), vi.mocked(safeEditOrSend)].flatMap((mock) =>
  mock.mock.calls.map(([message], index) => ({ message, order: mock.mock.invocationCallOrder[index] })),
).sort((a, b) => b.order - a.order)[0]?.message;
function button(match: (button: InlineKeyboardButton) => boolean) {
  const markup = lastMessage()?.reply_markup;
  const found = markup && "inline_keyboard" in markup && markup.inline_keyboard.flat().find(match);
  expect(found && found.callback_data).toBeTruthy();
  return (found as InlineKeyboardButton).callback_data!;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    NEXT_PUBLIC_PAYMENTS_MAINTENANCE: "false", PRODUCT_VARIANTS_READ: "true", ADMIN_JWT_SECRET: "fixture",
    BUYER_ORDER_ACCESS_SECRET: "fixture-secret-local-only", NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_API_KEY: "fixture",
    NOWPAYMENTS_IPN_SECRET: "fixture", NOWPAYMENTS_OUTCOME_CURRENCY: "usdtbsc", NOWPAYMENTS_API_BASE_URL: "https://api.nowpayments.io/v1",
    QRIS_ACTIVE_PROVIDER: "gopay", SEKALIPAY_GATEWAY_ENABLED: "false",
  })) vi.stubEnv(key, value);
  fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,storebat_family) VALUES
    (394,'ChatGPT Plus Private','chatgpt-storebat',109900,76,1,1,'chatgpt-plus'),
    (117,'ChatGPT Plus','chatgpt-tunvn',109900,76,1,1,NULL),
    (119,'Other member','chatgpt-other',109900,76,1,1,NULL),
    (174,'Other member 2','chatgpt-other-2',109900,76,1,1,NULL);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,storebat_product_id,storebat_cost_usd,storebat_fx_idr_per_usd,max_qty,buyer_field_key)
      VALUES(34576,394,'SB-60','Plus 1 Bulan (Apple Pay)',109900,76,'manual',1,60,4.45,18276.51,100,NULL);
    INSERT INTO product_groups(id,name,winner_product_id) VALUES(37,'ChatGPT Plus',394);
    INSERT INTO product_group_members(group_id,product_id) VALUES(37,117),(37,119),(37,174),(37,394);
    INSERT INTO telegram_users(user_id,chat_id,locale) VALUES('777394','777394','id');`);
  seedCryptoMarket(fx.sql, { rate: "18276.51", coins: [{ ticker: "usdtbsc", min_usd_text: "1.00" }] });
  qrisCreate.mockImplementation(async (orderCode: string, subtotal: number) => ({
    orderCode, qrisUrl: "https://example.test/qr.png", payableAmount: subtotal + 161, expiresAt: new Date(Date.now() + 600000).toISOString(),
  }));
  vi.stubGlobal("fetch", vi.fn(async (target: string | URL, init?: RequestInit) => {
    const url = new URL(target);
    expect(url.hostname).toBe("api.nowpayments.io");
    if (url.pathname.endsWith("/estimate")) return Response.json({ estimated_amount: "6.16", currency_from: "usd", currency_to: "usdtbsc" });
    if (url.pathname.endsWith("/min-amount")) return Response.json({ min_amount: "1.00", fiat_equivalent: "1.00", currency_from: "usdtbsc", currency_to: "usdtbsc" });
    if (url.pathname.endsWith("/payment") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      remoteCreate(body);
      return Response.json({ payment_id: "12345", order_id: body.order_id, price_amount: body.price_amount, price_currency: "usd",
        pay_currency: "usdtbsc", network: "bsc", pay_address: "0xBEEF", pay_amount: "6.16", payment_status: "waiting",
        is_fixed_rate: false, is_fee_paid_by_user: false });
    }
    throw new Error("Unexpected fixture request");
  }));
});
afterEach(() => {
  fx.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function buy(rail: "qris" | "crypto", beforeCommit?: () => void) {
  await click("var:34576");
  await click(button((b) => b.callback_data === "q:394:34576:1"));
  expect(lastMessage()?.text).toContain("Kirim otomatis setelah bayar");
  await click(button((b) => b.text.includes("Sudah dibaca")));
  const offer = state()!;
  expect(offer.idrSubtotal).toBe(109900);
  expect(button((b) => b.text.includes("QRIS · Rp109.900"))).toMatch(/^pm:/);
  if (rail === "qris") {
    beforeCommit?.();
    await click(button((b) => b.text.includes("QRIS · Rp109.900")));
  } else {
    const idx = offer.methods.findIndex(m => m.id === "nowpayments:usdtbsc");
    expect(offer.methods[idx]).toMatchObject({ amount_text: "6.16" });
    const open = () => click(button(b => b.callback_data === `pmc:${offer.nonce}`));
    await open();
    await click(button(b => b.callback_data === `pmb:${offer.nonce}`));
    await open();
    await click(button(b => b.callback_data === `pm:${offer.nonce}:${idx}`));
    beforeCommit?.();
    await click(button(b => b.callback_data === `pgo:${offer.nonce}`));
  }
}

it.each(["qris", "crypto"] as const)("reserves and issues a %s invoice for SB-60, even after the group winner changes", async (rail) => {
  await buy(rail, () => fx.sql.exec("UPDATE product_groups SET winner_product_id=117 WHERE id=37"));
  const order = fx.sql.prepare("SELECT * FROM orders").get();
  expect(order, lastMessage()?.text).toMatchObject({ subtotal: 109900, payment_method: rail === "qris" ? "qris" : "nowpayments:usdtbsc", status: "pending" });
  expect(JSON.parse(String(order!.items))[0]).toMatchObject({ max_qty: 100, storebat_eligibility: { product_id: 60, cost_usd: 4.45, fx_idr_per_usd: 18276.51 } });
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=34576").get()?.stock).toBe(75);
  if (rail === "qris") {
    expect(qrisCreate).toHaveBeenCalledExactlyOnceWith(order!.code, 109900);
    expect(sendPhoto).toHaveBeenCalledOnce();
  } else {
    expect(remoteCreate).toHaveBeenCalledOnce();
    expect(fx.sql.prepare("SELECT price_amount_text,status FROM payment_transactions").get()).toMatchObject({ price_amount_text: "6.16", status: "pending" });
  }
});

/** Interleave the catalog writer after JS read the inputs, before the atomic batch starts. */
function atReservation(change: () => void) {
  const batch = fx.db.batch.bind(fx.db);
  let attempts = 0;
  vi.spyOn(fx.db, "batch").mockImplementation(async statements => {
    if (statements.some(s => (s as typeof s & { query: string }).query.includes("INSERT INTO orders"))) {
      if (++attempts === 1) change();
    }
    return batch(statements);
  });
  return () => attempts;
}

it.each(["qris", "crypto"] as const)("retries %s once with current StoreBat costs, without changing the buyer total", async (rail) => {
  const attempts = atReservation(() => fx.sql.exec("UPDATE product_variants SET storebat_fx_idr_per_usd=18278.21,storebat_cost_usd=4.46 WHERE id=34576"));
  await buy(rail);
  const order = fx.sql.prepare("SELECT subtotal,items FROM orders").get();
  expect(order, lastMessage()?.text).toMatchObject({ subtotal: 109900 });
  expect(attempts()).toBe(2);
  expect(JSON.parse(String(order!.items))[0].storebat_eligibility).toMatchObject({ cost_usd: 4.46, fx_idr_per_usd: 18278.21 });
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=34576").get()?.stock).toBe(75);
  if (rail === "qris") expect(qrisCreate).toHaveBeenCalledOnce();
  else expect(remoteCreate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ price_amount: "6.16" }));
});

it.each([
  ["stock=0", "stock", /Stok habis/, 0],
  ["price=110900", "price_changed", /Harga\/stok baru saja diperbarui/, 76],
  ["is_active=0", "variant_changed", /Harga\/stok baru saja diperbarui/, 76],
  ["sku='invalid'", "invalid_supplier_identity", /Harga\/stok baru saja diperbarui/, 76],
  [null, "storebat_sync_in_progress", /Harga\/stok baru saja diperbarui/, 76],
] as const)("rejects a real commit guard (%s) without creating an invoice", async (change, reason, notice, stock) => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const attempts = atReservation(() => {
    if (change != null) fx.sql.exec(`UPDATE product_variants SET ${change} WHERE id=34576`);
    else fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('storebat_catalog_lease',?)").run(JSON.stringify({ until: Date.now() + 60_000 }));
  });
  await buy(change == null ? "crypto" : "qris");
  expect(lastMessage()?.text).toMatch(notice);
  expect(log).toHaveBeenCalledExactlyOnceWith("[telegram-checkout] rejected", expect.objectContaining({ reason, variantId: 34576 }));
  expect(attempts()).toBe(1);
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=34576").get()?.stock).toBe(stock);
  expect(fx.sql.prepare("SELECT code FROM orders").get()).toBeUndefined();
  expect(qrisCreate).not.toHaveBeenCalled();
  expect(remoteCreate).not.toHaveBeenCalled();
});

it.each(["qris", "crypto"] as const)("shows real out-of-stock at %s selection after stock drops to zero", async (rail) => {
  await buy(rail, () => fx.sql.exec("UPDATE product_variants SET stock=0 WHERE id=34576"));
  expect(lastMessage()?.text).toMatch(/Stok habis/);
  expect(fx.sql.prepare("SELECT code FROM orders").get()).toBeUndefined();
  expect(qrisCreate).not.toHaveBeenCalled();
  expect(remoteCreate).not.toHaveBeenCalled();
});

it("uses the catalog delivery classification in web checkout", async () => {
  fx.sql.exec(`UPDATE products SET aivault_family='chatgpt' WHERE id=119;
    UPDATE products SET mirai_family='chatgpt' WHERE id=174;
    INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Manual','manual',109900,76),(2,'WR','wr',109900,76);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,tunvn_source_product_id,aivault_service_id,mirai_package_code,wr_variant_id) VALUES
      (11,117,'TUNVN-12','TUNVN',109900,76,'manual',12,NULL,NULL,NULL),
      (12,119,'AV-pack','AIVault',109900,76,'manual',NULL,'pack',NULL,NULL),
      (13,174,'MR-chatgpt-pro','Mirai',109900,76,'manual',NULL,NULL,'chatgpt-pro',NULL),
      (14,1,'Local','Manual',109900,76,'manual',NULL,NULL,NULL,NULL),
      (15,2,'Wr','WR queue',109900,76,'manual',NULL,NULL,NULL,'wr-queued');
    INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wr-fixture','WR');
    INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class)
      VALUES('wr-queued','wr-fixture','WR queue',80000,'made_by_order');`);
  const variants = [[394, 34576, false], [117, 11, false], [119, 12, false], [174, 13, false], [1, 14, true], [2, 15, true]] as const;
  const { POST } = await import("@/app/api/checkout/quote/route");
  const response = await POST(new NextRequest("http://localhost/api/checkout/quote", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.200" },
    body: JSON.stringify({ items: variants.map(([product_id, variant_id]) => ({ product_id, variant_id, qty: 1 })) }),
  }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  for (const [, id, queued] of variants) {
    expect(buyerDeliveryKind((await getActiveVariant(id))!) === "queued", `PDP variant ${id}`).toBe(queued);
    expect(body.items.find((item: { variant_id: number }) => item.variant_id === id)?.queued_delivery, `quote variant ${id}`).toBe(queued);
  }
});
