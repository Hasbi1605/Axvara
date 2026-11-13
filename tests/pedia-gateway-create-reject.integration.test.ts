// tests/pedia-gateway-create-reject.integration.test.ts — DANA/gateway create gagal:
// batal HANYA bila rejeksi terbaca + GET read-only membuktikan invoice tidak ada.
// Adapter gateway ASLI dipakai (tanpa vi.mock modul) + fetch stub; D1 fixture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyPediaDiff } from "@/lib/pedia/sync";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import * as qris from "@/lib/payments/dana-qris";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); resetCryptoMarketMemo(); });
beforeEach(() => {
  clearRateLimitBucketsForTest(); resetCryptoMarketMemo();
  vi.stubEnv("PEDIA_ENABLED", "true"); vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-reject-test-secret");
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", "fixture-gw-key");
  vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-gw-secret");
});

const WA = "081234567890", EMAIL = "buyer@example.com";
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

async function seedCatalog() {
  const f = createD1Fixture();
  fixtures.push(f);
  const db = createDatabaseAccess();
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active)
    VALUES(1,'followers-instagram','instagram','followers','profile','Followers Instagram','[250]',1,1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active)
    VALUES(1,1,'standar','indosmm',86,'G3',0,1000,0,1);`);
  // Market product dengan id numerik SAMA (1) dan stok terbatas: Pedia tidak boleh
  // menyentuhnya saat cancel/expiry (product_id item Pedia = pedia_products id).
  f.sql.exec("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Market Fixture','market-fixture',10000,50)");
  await applyPediaDiff(db, "indosmm", [{
    service_id: 86, name: "IG Followers", type: "Default", category: "IG",
    rate: 46000, min_qty: 250, max_qty: 1000, api_refill: 0, api_cancel: 0, api_dripfeed: 0,
  } as never], [], "IDR");
  return f;
}

const DANA_ENTRY = { payment_code: "DANA_REALTIME", payment_name: "DANA Realtime", payment_type: "ewallet", min_amount: 1000, max_amount: 10_000_000, fee_info: { type: "percent", description: "1%" } };

/**
 * Fetch stub provider Sekalipay: katalog selalu ada, POST `payment` & GET `payment/<ref>`
 * diatur per skenario. Rekam jumlah POST/GET invoice.
 */
function stubProvider(handlers: { post?: () => Response; get?: () => Response }) {
  const posts = { count: 0 };
  const invoiceGets: string[] = [];
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.endsWith("payment-methods")) return Response.json({ status: true, data: [DANA_ENTRY] });
    if (init?.method === "POST") {
      posts.count++;
      return handlers.post ? handlers.post() : Response.json({ status: false, message: "internal error" }, { status: 500 });
    }
    invoiceGets.push(target);
    return handlers.get ? handlers.get() : Response.json({ status: false, message: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return { mock, posts, invoiceGets };
}

async function quote(target = "https://www.instagram.com/buyer/") {
  const { POST } = await import("@/app/api/pedia/quote/route");
  const res = await POST(new Request("http://x/api/pedia/quote", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_slug: "followers-instagram", tier_id: 1, quantity: 1000, target }),
  }) as never);
  return { res, data: await res.json() };
}

async function createOrder(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/pedia/orders/route");
  return POST(new Request("http://x/api/pedia/orders", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ customer_wa: WA, customer_email: EMAIL, ...body }),
  }) as never);
}

const stubQris = () => vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code: string, amount: number) => ({
  orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 0,
  qrisPayload: "fixture", qrisUrl: "/qr.png", expires_at: iso(15 * 60_000), expiresAt: iso(15 * 60_000), isExisting: false,
}) as never);

const order = (f: ReturnType<typeof createD1Fixture>, code: string) =>
  f.sql.prepare("SELECT status,payment_status FROM orders WHERE code=?").get(code) as Record<string, unknown> | undefined;
const item = (f: ReturnType<typeof createD1Fixture>, code: string) =>
  f.sql.prepare("SELECT status FROM pedia_order_items WHERE order_code=?").get(code) as Record<string, unknown> | undefined;
const tx = (f: ReturnType<typeof createD1Fixture>, code: string) =>
  f.sql.prepare("SELECT status,last_error FROM payment_transactions WHERE order_code=?").get(code) as Record<string, unknown> | undefined;

const METHOD = "sekalipay_gateway:DANA_REALTIME";
const marketStock = (f: ReturnType<typeof createD1Fixture>) =>
  (f.sql.prepare("SELECT stock FROM products WHERE id=1").get() as { stock: number } | undefined)?.stock;

describe("Pedia gateway create gagal: batal hanya saat definitif", () => {
  it("500 terbaca + GET 404 => order dibatalkan, item expired, TX terminal; quote BARU pada target sama => 201 order baru", async () => {
    const f = await seedCatalog();
    const provider = stubProvider({});
    const first = await quote();
    expect((first.data.paymentMethods as { id: string }[]).map((m) => m.id)).toContain(METHOD);

    const res = await createOrder({ quote_token: first.data.quote_token, payment_method: METHOD });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ error_code: "payment_method_unavailable" });
    expect(body.error).toContain("Metode pembayaran ini sedang gangguan");
    expect(body.code).toMatch(/^AXP-/);
    expect(provider.posts.count).toBe(1); // tidak ada re-POST
    expect(provider.invoiceGets).toHaveLength(1); // tepat satu probe read-only

    // Order dibatalkan + item keluar dari status aktif + klaim terminal.
    expect(order(f, body.code)).toMatchObject({ status: "dibatalkan", payment_status: "failed" });
    expect(item(f, body.code)).toMatchObject({ status: "expired" });
    expect(tx(f, body.code)).toMatchObject({ status: "failed", last_error: "sekalipay_gateway_create_rejected" });
    // Pedia tidak pernah mereservasi stok Market: product_id item = pedia id 1,
    // dan products(id=1) Market dengan stok 50 TIDAK boleh bertambah.
    expect(marketStock(f)).toBe(50);

    // Quote BARU pada target yang sama: tidak kena duplicate-active-order lagi.
    stubQris();
    const second = await quote();
    const created = await createOrder({ quote_token: second.data.quote_token, payment_method: "qris" });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.code).toMatch(/^AXP-/);
    expect(createdBody.code).not.toBe(body.code);
    expect(order(f, createdBody.code)).toMatchObject({ status: "pending" });
    expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 2 });
    // Order pertama tetap batal; klaim tidak di-POST ulang; stok Market tetap utuh.
    expect(provider.posts.count).toBe(1);
    expect(marketStock(f)).toBe(50);
  });

  it("buyer cancel order Pedia tidak mengubah stok Market dengan id numerik sama", async () => {
    const f = await seedCatalog();
    stubQris();
    stubProvider({});
    const q = await quote();
    const created = await createOrder({ quote_token: q.data.quote_token, payment_method: "qris" });
    expect(created.status).toBe(201);
    const code = (await created.json()).code as string;
    expect(marketStock(f)).toBe(50);

    const { POST: cancel } = await import("@/app/api/pedia/orders/[code]/cancel/route");
    const { NextRequest } = await import("next/server");
    const res = await cancel(new NextRequest(`http://x/api/pedia/orders/${code}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact: EMAIL }),
    }), { params: Promise.resolve({ code }) });
    expect(res.status).toBe(200);
    expect(order(f, code)).toMatchObject({ status: "dibatalkan" });
    // Tanpa fix, transitionPendingOrder akan menambah products(id=1) Market.
    expect(marketStock(f)).toBe(50);
  });

  it("500 + GET 200 pending => klaim & order DIPERTAHANKAN; order baru pada target sama masih 409 (fail closed)", async () => {
    const f = await seedCatalog();
    const provider = stubProvider({
      get: () => Response.json({ status: true, data: { merchant_ref_id: "x", invoice: "SPYlate", amount: 1000, fee: 10, total: 1010, payment_code: "DANA_REALTIME", status: "pending", is_sandbox: false } }),
    });
    const first = await quote();
    const res = await createOrder({ quote_token: first.data.quote_token, payment_method: METHOD });
    expect(res.status).toBe(503);
    const code = (await res.json()).code as string;
    expect(order(f, code)).toMatchObject({ status: "pending" });
    expect(item(f, code)).toMatchObject({ status: "queued" });
    expect(tx(f, code)).toMatchObject({ status: "initializing", last_error: null });
    expect(provider.posts.count).toBe(1);

    stubQris();
    const second = await quote();
    const blocked = await createOrder({ quote_token: second.data.quote_token, payment_method: "qris" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "duplicate_active_order" });
  });

  it.each([
    ["GET rate-limited/429", () => Response.json({ message: "too many" }, { status: 429 })],
    ["GET 500", () => Response.json({ message: "boom" }, { status: 500 })],
    ["GET jaringan error", () => { throw new Error("network"); }],
  ])("500 + %s => ambigu: order & klaim dipertahankan", async (_label, get) => {
    const f = await seedCatalog();
    const provider = stubProvider({ get });
    const first = await quote();
    const res = await createOrder({ quote_token: first.data.quote_token, payment_method: METHOD });
    expect(res.status).toBe(503);
    const code = (await res.json()).code as string;
    expect(order(f, code)).toMatchObject({ status: "pending" });
    expect(item(f, code)).toMatchObject({ status: "queued" });
    expect(tx(f, code)).toMatchObject({ status: "initializing" });
    expect(provider.invoiceGets).toHaveLength(1);
    expect(provider.posts.count).toBe(1);
  });

  it("timeout/jaringan pada POST => ambigu tanpa GET probe; order & klaim dipertahankan", async () => {
    const f = await seedCatalog();
    const provider = stubProvider({ post: () => { throw new Error("network"); } });
    const first = await quote();
    const res = await createOrder({ quote_token: first.data.quote_token, payment_method: METHOD });
    expect(res.status).toBe(503);
    const code = (await res.json()).code as string;
    expect(provider.posts.count).toBe(1);
    expect(provider.invoiceGets).toHaveLength(0); // bukan rejeksi terbaca: tidak ada probe
    expect(order(f, code)).toMatchObject({ status: "pending" });
    expect(tx(f, code)).toMatchObject({ status: "initializing" });
  });

  // Callback/webhook telat setelah order dibatalkan: tidak boleh crash dan tidak boleh
  // mengirim/melunasi order. Reconcile hanya boleh membaca (GET), tanpa POST.
  it("callback paid telat pada order yang sudah dibatalkan tidak melunasi/mengirim", async () => {
    const f = await seedCatalog();
    const provider = stubProvider({});
    const first = await quote();
    const res = await createOrder({ quote_token: first.data.quote_token, payment_method: METHOD });
    const code = (await res.json()).code as string;
    expect(order(f, code)).toMatchObject({ status: "dibatalkan" });
    const claimed = f.sql.prepare("SELECT requested_amount,gateway_estimated_fee FROM payment_transactions WHERE order_code=?").get(code) as { requested_amount: number; gateway_estimated_fee: number };
    const amount = Number(claimed.requested_amount), fee = Number(claimed.gateway_estimated_fee);

    const { gatewayHmac } = await import("@/lib/payments/sekalipay-gateway");
    const raw = JSON.stringify({ merchant_ref_id: code, invoice: "SPYlate", amount, fee, total: amount + fee, status: "paid", paid_at: "2026-11-07 10:00:00" });
    const { POST: callback } = await import("@/app/api/payments/sekalipay-gateway/callback/route");
    const { NextRequest } = await import("next/server");
    const notice = await callback(new NextRequest("http://x/api/payments/sekalipay-gateway/callback", {
      method: "POST", headers: { "content-type": "application/json", "x-signature": await gatewayHmac("fixture-gw-secret", raw) }, body: raw,
    }));
    const noticeBody = await notice.json().catch(() => null);
    // Tanpa crash: reconcile GET 404 -> 503 reconcile_retry (bukan paid/delivery).
    expect([200, 503], JSON.stringify(noticeBody)).toContain(notice.status);
    expect(order(f, code)).toMatchObject({ status: "dibatalkan" });
    expect(tx(f, code)).toMatchObject({ status: "failed" });
    expect(f.sql.prepare("SELECT COUNT(*) n FROM fulfillment_jobs").get()).toEqual({ n: 0 });
    expect(provider.posts.count).toBe(1); // tidak ada POST/ulang dari callback
    const event = f.sql.prepare("SELECT status FROM dana_webhook_events ORDER BY id DESC LIMIT 1").get() as { status: string };
    expect(event.status).not.toBe("matched");
  });
});
