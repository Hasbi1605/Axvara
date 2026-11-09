// tests/pedia-payment-rails.integration.test.ts — Fase B (2026-11-07): rail
// gateway + crypto di checkout Pedia memakai mesin Market (token bertanda tangan,
// validator kanonis, create adapter) tanpa duplikasi logika finansial.
// Fixture SQLite + adapter di-mock; tanpa jaringan/produksi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyPediaDiff } from "@/lib/pedia/sync";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import * as qris from "@/lib/payments/dana-qris";

const gatewayMock = vi.hoisted(() => ({
  catalog: [] as unknown[],
  methods: [] as unknown[],
  create: vi.fn(),
}));
vi.mock("@/lib/payments/sekalipay-gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/sekalipay-gateway")>();
  return {
    ...actual,
    // total kanonis = subtotal + fee (validator Market menolak selisih).
    listSekalipayCatalog: vi.fn(async (amount: number) => gatewayMock.catalog.map((entry) => ({
      ...(entry as Record<string, unknown>), estimatedFee: 500, estimatedTotal: amount + 500,
    }))),
    listSekalipayMethods: vi.fn(async (amount: number) => gatewayMock.methods.map((entry) => ({
      ...(entry as Record<string, unknown>), estimatedFee: 500, estimatedTotal: amount + 500,
    }))),
    createSekalipayGatewayInvoice: gatewayMock.create,
  };
});
const nowpaymentsMock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/payments/nowpayments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/nowpayments")>();
  return { ...actual, createNowpaymentsInvoice: nowpaymentsMock.create };
});

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetCryptoMarketMemo(); });
beforeEach(() => { clearRateLimitBucketsForTest(); resetCryptoMarketMemo(); vi.stubEnv("PEDIA_ENABLED", "true"); vi.stubEnv("PEDIA_ORDERS_ENABLED", "true"); vi.stubEnv("ADMIN_JWT_SECRET", "pedia-rails-test-secret"); });

const WA = "081234567890", EMAIL = "buyer@example.com";
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Produk/tier Pedia + snapshot FX/koin segar (250 @ ~38.750/1k ≈ US$2,6). */
async function seedCatalog(options: { withCrypto?: boolean } = {}) {
  const f = createD1Fixture();
  fixtures.push(f);
  const db = createDatabaseAccess();
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active)
    VALUES(1,'followers-instagram','instagram','followers','profile','Followers Instagram','[250]',1,1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active)
    VALUES(1,1,'standar','indosmm',86,'G3',0,1000,0,1);`);
  await applyPediaDiff(db, "indosmm", [{
    service_id: 86, name: "IG Followers", type: "Default", category: "IG",
    rate: 46000, min_qty: 250, max_qty: 1000, api_refill: 0, api_cancel: 0, api_dripfeed: 0,
  } as never], [], "IDR");
  if (options.withCrypto) {
    vi.stubEnv("NOWPAYMENTS_ENABLED", "true");
    vi.stubEnv("NOWPAYMENTS_API_KEY", "fixture-key");
    vi.stubEnv("NOWPAYMENTS_IPN_SECRET", "fixture-ipn");
    vi.stubEnv("NOWPAYMENTS_OUTCOME_CURRENCY", "usdtbsc");
    f.sql.prepare(`INSERT INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at,coins_json,coins_refreshed_at)
      VALUES(1,'18000.00','nowpayments-estimate',?,?,?)`)
      .run(iso(-60_000), JSON.stringify([{ ticker: "usdtbsc", min_usd_text: "1.00" }]), iso(-60_000));
  }
  return f;
}

function stubGatewayEnv() {
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "fixture-gw-key");
  vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-gw-secret");
}

async function quote(total = { quantity: 1000, target: "https://www.instagram.com/buyer/" }, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/pedia/quote/route");
  const res = await POST(new Request("http://x/api/pedia/quote", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ product_slug: "followers-instagram", tier_id: 1, ...total }),
  }) as never);
  return { res, data: await res.json() };
}

async function createOrder(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/pedia/orders/route");
  return POST(new Request("http://x/api/pedia/orders", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ customer_wa: WA, customer_email: EMAIL, ...body }),
  }) as never);
}

const orderRow = (f: ReturnType<typeof createD1Fixture>) =>
  f.sql.prepare("SELECT code,status,payment_method,payment_account,subtotal,expires_at FROM orders ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;

describe("Pedia quote menandatangani rail pembayaran", () => {
  it("QRIS selalu ada; gateway curated + crypto masuk katalog dan token, kanal realtime tidak", async () => {
    await seedCatalog({ withCrypto: true });
    stubGatewayEnv();
    gatewayMock.catalog = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0, available: true }];
    gatewayMock.methods = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0 }];
    const { res, data } = await quote();
    expect(res.status).toBe(200);
    const ids = (data.paymentMethods as { id: string }[]).map((method) => method.id);
    expect(ids).toContain("qris");
    expect(ids).toContain("sekalipay_gateway:SHOPEEPAY");
    expect(ids).toContain("nowpayments:usdtbsc");
    expect(ids.some((id) => /_REALTIME/i.test(id))).toBe(false);
    // Hanya metode tersedia yang ditandatangani.
    const { verifyPediaQuoteToken } = await import("@/lib/pedia/quote");
    const payload = await verifyPediaQuoteToken(data.quote_token);
    expect(payload?.payment_methods?.map((method) => method.id)).toEqual(
      (data.paymentMethods as { id: string; available: boolean }[]).filter((method) => method.available).map((method) => method.id),
    );
    expect(payload?.locale).toBe("id");
  });

  it("token dengan metode cacat ditolak saat verifikasi (validator kanonis Market)", async () => {
    await seedCatalog();
    const base = {
      product_id: 1, tier_id: 1, quantity: 250, target_raw: "https://www.instagram.com/buyer/",
      target_normalized: "https://www.instagram.com/buyer/", unit_price: 100, total: 46000,
      credit_code_hash: null, credit_used: 0, supplier: "indosmm" as const, supplier_service_id: 86,
      supplier_rate_snapshot: 46000,
    };
    // gateway.idr_subtotal/estimated_total salah → token tidak sah.
    const forged = await createPediaQuoteToken({
      ...base,
      payment_methods: [{
        id: "sekalipay_gateway:SHOPEEPAY", account_number: "", kind: "gateway", currency: "IDR", sublabel: "x", available: true,
        gateway: { channel: "SHOPEEPAY", estimated_fee: 500, estimated_total: 1, idr_subtotal: 46000 },
      }],
    } as never);
    const { verifyPediaQuoteToken } = await import("@/lib/pedia/quote");
    expect(await verifyPediaQuoteToken(forged.token)).toBeNull();
  });
});

describe("Pedia order create memakai rail terpilih", () => {
  it.each([[5, 5], [120, 60]])("gateway: provider %i menit, order %i menit, retry reusable", async (providerMinutes, expectedMinutes) => {
    const f = await seedCatalog();
    stubGatewayEnv();
    gatewayMock.catalog = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0, available: true }];
    gatewayMock.methods = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0 }];
    gatewayMock.create.mockImplementation(async (code: string, amount: number, channel: string, _customer: unknown, fee: number) => {
      const deadline = iso(providerMinutes * 60_000);
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,
        gateway_channel,gateway_label,gateway_estimated_fee,gateway_fee,payable_amount,gateway_is_sandbox,gateway_fee_consent_required,expires_at,provider_payment_id)
        VALUES(?, 'sekalipay_gateway','merchant',?,'sekalipay_gateway',?,'pending',?,?,?,?,?,0,1,?,?)`)
        .run(code, code, amount, channel, "ShopeePay", fee, fee, amount + fee, deadline, `INV-${code}`);
      return {} as never;
    });
    const { data } = await quote();
    const res = await createOrder({ quote_token: data.quote_token, payment_method: "sekalipay_gateway:SHOPEEPAY" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.qris).toBeNull();
    expect(body.payment).toMatchObject({ kind: "gateway", state: "fee_consent_required", total: data.total + 500 });
    const row = orderRow(f)!;
    expect(row.payment_method).toBe("sekalipay_gateway:SHOPEEPAY");
    expect(row.payment_account).toBe("Sekalipay");
    const orderDeadline = Date.parse(String(row.expires_at).replace(" ", "T") + "Z");
    const providerDeadline = Date.parse(f.sql.prepare("SELECT expires_at FROM payment_transactions ORDER BY id DESC LIMIT 1").get()!.expires_at as string);
    if (providerMinutes < 60) expect(Math.abs(orderDeadline - providerDeadline)).toBeLessThan(1_000);
    expect((orderDeadline - Date.now()) / 60_000).toBeCloseTo(expectedMinutes, 0);

    // Retry quote yang sama: order yang sama (bukan order baru), view tetap ada.
    const retry = await createOrder({ quote_token: data.quote_token, payment_method: "sekalipay_gateway:SHOPEEPAY" });
    expect(retry.status).toBe(200);
    const retryBody = await retry.json();
    expect(retryBody.reused).toBe(true);
    expect(retryBody.code).toBe(row.code);
    expect(retryBody.payment?.kind).toBe("gateway");
    expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 1 });
  });

  it("crypto: adapter dipanggil dengan nominal USD bertanda + view pending; tanpa qris", async () => {
    const f = await seedCatalog({ withCrypto: true });
    const { data } = await quote();
    const crypto = (data.paymentMethods as { id: string; available: boolean; amount_text?: string; total_cents?: number }[])
      .find((method) => method.available && method.id.startsWith("nowpayments:"));
    expect(crypto).toBeTruthy();
    nowpaymentsMock.create.mockImplementation(async (code: string, amount: number, currency: string) => {
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,currency,
        pay_currency,pay_network,pay_amount_text,pay_address,price_amount_text,price_currency,status,expires_at,fee_paid_by_user,fixed_rate,
        crypto_base_usd_cents,crypto_surcharge_usd_cents,crypto_surcharge_bps,provider_payment_id)
        VALUES(?, 'nowpayments','hosted',?,'nowpayments',?,'IDR',?,?,'12.34567890','0xfixture',?,'usd','pending',?,0,0,?,?,?,?)`)
        .run(code, code, amount, currency, "bsc", crypto!.amount_text, iso(8 * 60_000), 200, 4, 2, "NP-1");
      return {} as never;
    });
    const res = await createOrder({ quote_token: data.quote_token, payment_method: crypto!.id });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.qris).toBeNull();
    expect(body.payment).toMatchObject({ kind: "crypto", state: "pending", pay_currency: "usdtbsc" });
    const row = orderRow(f)!;
    expect(row.payment_method).toBe(crypto!.id);
    expect(row.payment_account).toBe("NOWPayments");
    const [code, amount, currency, options] = nowpaymentsMock.create.mock.calls[0] as [string, number, string, Record<string, unknown>];
    expect(code).toBe(row.code);
    expect(amount).toBe(data.total);
    expect(currency).toBe("usdtbsc");
    expect(options).toMatchObject({ priceCurrency: "usd", feePayer: "merchant", fixedRate: false });
    expect((options.expectedUsd as { priceText: string }).priceText).toBe(crypto!.amount_text);
  });

  it("metode yang tidak ada di token ditolak 409 quote_stale tanpa membuat order", async () => {
    const f = await seedCatalog();
    const { data } = await quote();
    const res = await createOrder({ quote_token: data.quote_token, payment_method: "nowpayments:btc" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "quote_stale" });
    expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 0 });
  });

  it("gateway gagal tanpa klaim: order dibatalkan + item expired, pembeli dapat 503 error_code", async () => {
    const f = await seedCatalog();
    stubGatewayEnv();
    gatewayMock.catalog = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0, available: true }];
    gatewayMock.methods = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0 }];
    gatewayMock.create.mockRejectedValueOnce(new Error("gateway_boom"));
    const { data } = await quote();
    const res = await createOrder({ quote_token: data.quote_token, payment_method: "sekalipay_gateway:SHOPEEPAY" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error_code).toBe("payment_method_unavailable");
    expect(body.code).toMatch(/^AXP-/);
    const row = f.sql.prepare("SELECT status FROM orders ORDER BY id DESC LIMIT 1").get() as { status: string };
    expect(row.status).toBe("dibatalkan");
    const item = f.sql.prepare("SELECT status FROM pedia_order_items ORDER BY id DESC LIMIT 1").get() as { status: string };
    expect(item.status).toBe("expired");
  });
});

describe("Locale pembeli tersimpan di order", () => {
  it("cookie axv_locale=en tersimpan di orders.locale; tanpa cookie default id", async () => {
    const f = await seedCatalog();
    vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code: string, amount: number) => ({
      orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 0,
      qrisPayload: "fixture", qrisUrl: "/qr.png", expires_at: iso(15 * 60_000), expiresAt: iso(15 * 60_000), isExisting: false,
    }) as never);
    const en = await quote(undefined, { cookie: "axv_locale=en" });
    expect((await createOrder({ quote_token: en.data.quote_token, payment_method: "qris" }, { cookie: "axv_locale=en" })).status).toBe(201);
    expect(f.sql.prepare("SELECT locale FROM orders ORDER BY id DESC LIMIT 1").get()).toEqual({ locale: "en" });

    const id = await quote({ quantity: 250, target: "https://www.instagram.com/second/" });
    expect((await createOrder({ quote_token: id.data.quote_token, payment_method: "qris" })).status).toBe(201);
    expect(f.sql.prepare("SELECT locale FROM orders ORDER BY id DESC LIMIT 1").get()).toEqual({ locale: "id" });
  });
});

describe("Pedia status GET mengembalikan view rail (tanpa qris)", () => {
  it("gateway pending: payment.kind gateway, qris null, tanpa polling provider (claim di cron/GET)", async () => {
    const f = await seedCatalog();
    stubGatewayEnv();
    gatewayMock.catalog = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0, available: true }];
    gatewayMock.methods = [{ code: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", min: 100, max: 10_000_000, feeText: "1%", estimatedFee: 500, estimatedTotal: 0 }];
    gatewayMock.create.mockImplementation(async (code: string, amount: number, channel: string, _customer: unknown, fee: number) => {
      f.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,
        gateway_channel,gateway_label,gateway_estimated_fee,gateway_fee,payable_amount,gateway_is_sandbox,gateway_fee_consent_required,expires_at,provider_payment_id)
        VALUES(?, 'sekalipay_gateway','merchant',?,'sekalipay_gateway',?,'pending',?,?,?,?,?,0,1,?,?)`)
        .run(code, code, amount, channel, "ShopeePay", fee, fee, amount + fee, iso(5 * 60_000), `INV-${code}`);
      return {} as never;
    });
    const { data } = await quote();
    const created = await (await createOrder({ quote_token: data.quote_token, payment_method: "sekalipay_gateway:SHOPEEPAY" })).json();
    // Tanpa proxy, rekonsiliasi gateway akan mencoba jaringan nyata; stub gagal
    // cepat agar hasil deterministik (view tersimpan tetap dilayani).
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 502 })));
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const res = await GET(new Request(`http://x/api/pedia/orders/${created.code}`, { headers: { "x-order-contact": WA } }) as never, { params: Promise.resolve({ code: created.code }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.payment_method).toBe("sekalipay_gateway:SHOPEEPAY");
    expect(body.order.qris).toBeNull();
    expect(body.order.payment).toMatchObject({ kind: "gateway", state: "fee_consent_required" });
  });
});

describe("Pedia cancel tidak menyentuh stok Market", () => {
  it("nowpayments setup gagal definitif: order dibatalkan tanpa restock Market (product_id = pedia id yang sama angka)", async () => {
    const f = await seedCatalog({ withCrypto: true });
    f.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Market Fixture','market-fixture',10000,50)");
    nowpaymentsMock.create.mockRejectedValueOnce(new Error("nowpayments_preflight_invalid"));
    const { data } = await quote();
    const crypto = (data.paymentMethods as { id: string; available: boolean }[]).find((method) => method.available && method.id.startsWith("nowpayments:"));
    expect(crypto).toBeTruthy();
    const res = await createOrder({ quote_token: data.quote_token, payment_method: crypto!.id });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error_code).toBe("payment_method_unavailable");
    expect(body.code).toMatch(/^AXP-/);
    expect(f.sql.prepare("SELECT status FROM orders WHERE code=?").get(body.code)).toMatchObject({ status: "dibatalkan" });
    // Tanpa fix, products(id=1) Market bertambah (pedia_products id 1).
    expect(f.sql.prepare("SELECT stock FROM products WHERE id=1").get()).toEqual({ stock: 50 });
    expect(f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(body.code)).toMatchObject({ status: "expired" });
  });
});
