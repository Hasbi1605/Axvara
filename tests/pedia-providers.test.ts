import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { seedOfficialDescriptions } from "./helpers/pedia-managed-fixture";
import { applyPediaDiff, applyProvidersmmDiff } from "@/lib/pedia/sync";
import { callPediaProxy, callPsmmProxy, type PediaProvider } from "@/lib/pedia/proxy";
import { processPediaPaidOrders } from "@/lib/pedia/dispatch";
import { createPediaQuoteToken, verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { SignJWT } from "jose";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const service = (rate = 1000, min = 100) => ({ service_id: 86, name: "Private supplier name", category: "IG", type: "Default", rate, min_qty: min, max_qty: 1000, api_refill: 1, api_cancel: 0, api_dripfeed: 0 });
const request = (body: unknown) => new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;

async function seed() {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  await db.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES ('ig','instagram','followers','profile','IG','[100,250]',10,1,'auto')`);
  for (const [provider, tier] of [["providersmm", "hemat"], ["indosmm", "standar"]]) {
    // Beda service_id per provider: sejak 0062 satu layanan supplier hanya
    // boleh terhubung sekali per produk (dulu service 86 dipakai berdua
    // hanya untuk menguji batas — kini dilayani baris terpisah). Sejak
    // 2026-11-12 ProviderSMM adalah supplier penjualan, IndoSMM riwayat.
    // PSMM-P5: baris supplier jual ditandai `managed='auto'` agar lolos gate
    // katalog/quote/order publik; IndoSMM tetap kurasi (riwayat).
    const serviceId = provider === "indosmm" ? 87 : 86;
    const managed = provider === "providersmm" ? "auto" : "curated";
    await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,managed) VALUES (1,?,?,${serviceId},'G3',20,1000,30,1,'${managed}')`, tier, provider);
  }
  await applyProvidersmmDiff(db, [service()], []);
  await applyPediaDiff(db, "indosmm", [{ ...service(5000, 250), service_id: 87 }], [], "IDR");
  await seedOfficialDescriptions(db, [86]);
  return { db, fx };
}

async function paid(db: ReturnType<typeof createDatabaseAccess>, provider: PediaProvider, status = "queued", code = "AXP-P") {
  await db.execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES (?,'','6281234567890','test@example.com','[]',10000,'qris','lunas','pedia')`, code);
  await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,supplier_order_id) VALUES (?,1,1,'{}','x','x',250,40,10000,?,CASE WHEN ?='indosmm' THEN 87 ELSE 86 END,1000,?,'SAME-ORDER-ID')`, code, provider, provider, status);
}

describe("provider boundary and normalized diff", () => {
  it.each(["disable", "reprice"])("margin disable remains replay-safe after failed %s", async (failure) => {
    const { db, fx } = await seed();
    const before = await db.queryFirst(`SELECT package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    fx.control.fail = (q) => failure === "disable"
      ? q.includes("auto_disabled_reason='margin'")
      : q.includes("SET package_prices_json=?");
    await expect(applyPediaDiff(db, "indosmm", [{ ...service(100000, 250), service_id: 87 }], [], "IDR")).rejects.toThrow("Injected database interruption");
    const interrupted = await db.queryFirst(`SELECT is_active,package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    expect(interrupted?.package_prices_json).toBe(before?.package_prices_json);
    expect(interrupted?.is_active).toBe(failure === "disable" ? 1 : 0);
    fx.control.fail = null;
    await applyPediaDiff(db, "indosmm", [{ ...service(100000, 250), service_id: 87 }], [], "IDR");
    const replayed = await db.queryFirst(`SELECT is_active,auto_disabled_reason,package_prices_json FROM pedia_tiers WHERE supplier='indosmm'`);
    expect(replayed).toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });
    expect(replayed?.package_prices_json).not.toBe(before?.package_prices_json);
  });
  it("routes real calls through distinct VPS prefixes and retains the old wrapper", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async (url: unknown) => { void url; return new Response('{"order":1}', { status: 200 }); });
    vi.stubGlobal("fetch", fetch);
    await callPediaProxy("indosmm", "add", { service: 86 }, 1000, "AXP-P");
    await callPsmmProxy("status", { order: 1 });
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual(["https://proxy.example/indosmm/add", "https://proxy.example/psmm/status"]);
    expect(await callPediaProxy("unknown" as never, "add")).toMatchObject({ ok: false, kind: "invalid_provider" });
    expect(await callPediaProxy("indosmm", "unknown" as never)).toMatchObject({ ok: false, kind: "invalid_action" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("treats HTTP 200 supplier errors as rejection, not a successful order", async () => {
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    vi.stubGlobal("fetch", async () => new Response('{"error":"Insufficient funds"}'));
    expect(await callPediaProxy("indosmm", "add")).toMatchObject({ ok: false, kind: "api_error" });
  });
  it("same service IDs retain independent rates, bounds, repricing and removal", async () => {
    const { db } = await seed();
    // Sejak 0062 ID layanan yang sama TIDAK bisa dipakai dua provider pada
    // produk yang sama (UNIQUE per produk+supplier+layanan): kemandirian kini
    // dibuktikan pada katalog cermin — baris (providersmm,86) vs (indosmm,87)
    // dengan rate/batas berbeda, penghapusan satu tidak menyentuh yang lain.
    // Sejak 2026-11-12 hanya tier ProviderSMM (min 100, rate 1.000) yang
    // ditawarkan publik; tier IndoSMM tetap tersimpan untuk riwayat.
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const catalog = await (await GET()).json();
    expect(catalog.products[0].tiers).toHaveLength(1);
    expect(catalog.products[0].tiers[0]).toMatchObject({ min_qty: 100, prices: { "250": 1300 } });
    expect(JSON.stringify(catalog)).not.toMatch(/supplier|providersmm|indosmm|rate|Private/);
    await applyPediaDiff(db, "indosmm", [], [87], "IDR");
    const rows = await db.queryAll(`SELECT supplier,present FROM pedia_supplier_services ORDER BY supplier`);
    expect(rows).toEqual([{ supplier: "indosmm", present: 0 }, { supplier: "providersmm", present: 1 }]);
    expect((await db.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier='providersmm'`))?.is_active).toBe(1);
  });
  it.each([undefined, "USD", "EUR"])("rejects unverified/non-IDR currency %s before changing the catalog", async (currency) => {
    const { db } = await seed();
    await expect(applyPediaDiff(db, "indosmm", [service(1)], [86], currency)).rejects.toThrow("unsupported_currency");
    expect((await db.queryFirst(`SELECT rate_idr_per_1k,present FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=87`))).toMatchObject({ rate_idr_per_1k: 5000, present: 1 });
  });
  it("rejects invalid rows atomically at the input boundary", async () => {
    const { db } = await seed();
    await expect(applyPediaDiff(db, "indosmm", [service(9000), { ...service(), service_id: 0 }], [], "IDR")).rejects.toThrow("invalid_service");
    await expect(applyPediaDiff(db, "unknown" as never, [], [], "IDR")).rejects.toThrow("invalid_provider");
    expect((await db.queryFirst(`SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=87`))?.rate_idr_per_1k).toBe(5000);
  });
  it("supplier-sync requires IDR for IndoSMM and does not acknowledge partial storage", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown) => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify(body) }) as never);
    expect((await send({ source: "indosmm", services: [service()], currency: "USD" })).status).toBe(400);
    fx.control.fail = (q) => q.includes("INSERT INTO pedia_supplier_services");
    expect((await send({ source: "indosmm", services: [service()], currency: "IDR" })).status).toBe(500);
    fx.control.fail = null;
    expect((await send({ source: "indosmm", services: [service()], currency: "IDR" })).status).toBe(200);
    expect(fx.sql.prepare(`SELECT value FROM store_settings WHERE key='pedia_indosmm_diff_last_at'`).get()).toBeTruthy();
  });
  // 2026-11-12 (owner): ProviderSMM kembali menjadi supplier penjualan baru,
  // jadi diff-nya ditulis ke cermin D1 (bukan lagi di-ack lalu dibuang).
  it("supplier-sync stores ProviderSMM diffs and advances its checkpoint", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const before = fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm'`).get();
    const res = await POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify({ source: "providersmm", services: [{ ...service(), service_id: 777 }], removed_service_ids: [] }) }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, upserted: 1, missing: 0 });
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm'`).get()?.n).toBe(Number(before?.n) + 1);
    expect(fx.sql.prepare(`SELECT value FROM store_settings WHERE key='pedia_diff_last_at'`).get()).toBeTruthy();
    expect(fx.sql.prepare(`SELECT value FROM store_settings WHERE key='pedia_diff_last_change_at'`).get()).toBeTruthy();
  });
  it("supplier-sync never acknowledges ProviderSMM malformed input or partial writes", async () => {
    const { fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown, token = "test-sync") => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": token }, body: JSON.stringify(body) }) as never);
    // Auth pertama: token salah/kosong tidak pernah menyentuh D1.
    expect((await send({ source: "providersmm", services: [service()] }, "wrong")).status).toBe(401);
    // Input tidak sah dan batch di atas batas tetap 4xx, bukan 2xx.
    expect((await send({ source: "providersmm" })).status).toBe(400);
    expect((await send({ source: "providersmm", services: [{ ...service(), service_id: 0 }] })).status).toBe(400);
    expect((await send({ source: "providersmm", services: Array.from({ length: 101 }, (_, i) => ({ ...service(), service_id: 900 + i })) })).status).toBe(413);
    expect((await send({ source: "providersmm", services: [service()], currency: "USD" })).status).toBe(400);
    // Kegagalan tulis sebagian tidak di-ack: VPS harus mengirim ulang idempoten.
    fx.control.fail = (q) => q.includes("INSERT INTO pedia_supplier_services");
    expect((await send({ source: "providersmm", services: [{ ...service(), service_id: 777 }] })).status).toBe(500);
    fx.control.fail = null;
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=777`).get()?.n).toBe(0);
  });
  it("an absent ProviderSMM delta never deletes the mirror; only explicit removed IDs do", async () => {
    const { db, fx } = await seed();
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { POST } = await import("@/app/api/supplier-sync/route");
    const send = (body: unknown) => POST(new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": "test-sync" }, body: JSON.stringify(body) }) as never);
    const total = fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm' AND present=1`).get()?.n;
    expect((await send({ source: "providersmm", services: [{ ...service(), service_id: 778 }], removed_service_ids: [] })).status).toBe(200);
    expect(fx.sql.prepare(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm' AND present=1`).get()?.n).toBe(Number(total) + 1);
    expect((await send({ source: "providersmm", services: [], removed_service_ids: [86] })).status).toBe(200);
    expect(fx.sql.prepare(`SELECT present FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=86`).get()).toEqual({ present: 0 });
    expect((await db.queryFirst(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm' AND present=1`))?.n).toBe(1);
  });
});

describe("quote and order provider snapshots", () => {
  it.each(["refill_days", "min_profit_rp"])("preserves quoted %s after an equal-price term change", async (term) => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const q = await (await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }))).json();
    expect(await verifyPediaQuoteToken(q.quote_token)).toMatchObject({ refill_days: 30, min_profit_rp: 1000 });
    await db.execRun(`UPDATE pedia_tiers SET ${term}=? WHERE id=1`, term === "refill_days" ? 0 : 1050);
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const result = await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(result.status).not.toBe(409);
    const item = await db.queryFirst(`SELECT snapshot_json,total FROM pedia_order_items`);
    expect(item?.total).toBe(q.total);
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 30, min_profit_rp: 1000 });
  });
  it("legacy encrypted quotes without terms version still verify but cannot create a NEW order", async () => {
    const { db } = await seed();
    const { token } = await createPediaQuoteToken({ product_id: 1, tier_id: 1, quantity: 250, target_raw: "https://instagram.com/buyer", target_normalized: "https://www.instagram.com/buyer/", unit_price: 5.2, total: 1300, credit_code_hash: null, credit_used: 0, supplier: "providersmm", supplier_service_id: 86, supplier_rate_snapshot: 1000 });
    // Token lama tetap terverifikasi (kompatibilitas baca), tetapi order BARU
    // wajib membawa versi syarat yang cocok dengan snapshot aktif.
    expect(await verifyPediaQuoteToken(token)).not.toBeNull();
    await db.execRun(`UPDATE pedia_tiers SET refill_days=15,min_profit_rp=1050 WHERE id=1`);
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST } = await import("@/app/api/pedia/orders/route");
    const res = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(res.status).toBe(409);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_order_items`)).toMatchObject({ n: 0 });
  });
  it("accepts unexpired legacy ProviderSMM signed quotes", async () => {
    vi.stubEnv("ADMIN_JWT_SECRET", "legacy-test");
    const token = await new SignJWT({ purpose: "pedia_quote", product_id: 1, tier_id: 1, quantity: 250, total: 2300, unit_price: 9.2, target_normalized: "x", supplier_service_id: 86, supplier_rate_snapshot: 5000 })
      .setProtectedHeader({ alg: "HS256" }).setJti("legacy").setExpirationTime("30m").sign(new TextEncoder().encode("legacy-test"));
    expect(await verifyPediaQuoteToken(token)).toMatchObject({ supplier: "providersmm", supplier_service_id: 86 });
  });
  it("quotes the mapped provider and rejects an equal-price mapping change before payment", async () => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q.quote_token.split(".")).toHaveLength(5);
    expect(JSON.stringify(q)).not.toMatch(/supplier|rate_snapshot|indosmm|providersmm/);
    expect(await verifyPediaQuoteToken(q.quote_token)).toMatchObject({ supplier: "providersmm", supplier_service_id: 86, supplier_rate_snapshot: 1000 });
    await db.execRun(`UPDATE pedia_tiers SET supplier='indosmm', supplier_service_id=86 WHERE id=1`);
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const order = await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(order.status).toBe(409);
    expect((await order.json()).error).toBe("service_changed");
    expect(await db.queryAll(`SELECT * FROM orders`)).toEqual([]);
  });
  it("persists ProviderSMM on a new order without making an upstream order", async () => {
    const { db } = await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const q = await (await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }))).json();
    vi.stubEnv("DANA_QRIS_ENABLED", "false");
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    await orders(request({ quote_token: q.quote_token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    const item = await db.queryFirst(`SELECT * FROM pedia_order_items`);
    expect(item).toMatchObject({ supplier: "providersmm", supplier_service_id: 86, supplier_rate_snapshot: 1000 });
    expect(JSON.parse(String(item?.snapshot_json))).toMatchObject({ refill_days: 30, supplier: "providersmm" });
  });
  it("finds a persisted retired-supplier order BEFORE the sale-provider rejection", async () => {
    const { db } = await seed();
    // Quote IndoSMM (kini supplier riwayat) yang sudah menjadi order tersimpan.
    const { token, quoteId } = await createPediaQuoteToken({
      product_id: 1, tier_id: 2, quantity: 250, target_raw: "https://instagram.com/buyer",
      target_normalized: "https://www.instagram.com/buyer/", unit_price: 9.2, total: 2300,
      credit_code_hash: null, credit_used: 0, supplier: "indosmm", supplier_service_id: 87, supplier_rate_snapshot: 5000,
    });
    await db.execRun(`INSERT INTO orders (code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind)
      VALUES ('AXP-PERSISTED',?,'','6281234567890','test@example.com','[]',2300,'qris','pending','pedia')`, `pedia:${quoteId}`);
    await db.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status)
      VALUES ('AXP-PERSISTED',1,2,'{}','https://instagram.com/buyer','https://www.instagram.com/buyer/',250,9.2,2300,0,'indosmm',87,5000,'awaiting_payment')`);
    // Reuse path menerbitkan invoice QRIS untuk order pending; provider QRIS
    // dipalsukan hanya agar jalur reuse mencapai 200 (bukan 409 supplier).
    vi.spyOn(await import("@/lib/payments/dana-qris"), "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 1, qrisPayload: "test", qrisUrl: "/qr.png", expiresAt: "2099-01-01", isExisting: false }));
    const { POST: orders } = await import("@/app/api/pedia/orders/route");
    const res = await orders(request({ quote_token: token, customer_wa: "081234567890", customer_email: "test@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "AXP-PERSISTED", reused: true });
    // Sebaliknya, quote IndoSMM TANPA order tersimpan ditolak sebagai retired.
    const fresh = await createPediaQuoteToken({
      product_id: 1, tier_id: 2, quantity: 250, target_raw: "https://instagram.com/other",
      target_normalized: "https://www.instagram.com/other/", unit_price: 9.2, total: 2300,
      credit_code_hash: null, credit_used: 0, supplier: "indosmm", supplier_service_id: 87, supplier_rate_snapshot: 5000,
    });
    const rejected = await orders(request({ quote_token: fresh.token, customer_wa: "081234567891", customer_email: "other@example.com" }));
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error).toBe("provider_retired");
  });
});

describe("durable provider-specific dispatch", () => {
  it.each(["requested", "submitted", "needs_check"])("does not overwrite unresolved %s refill after 24 hours", async (status) => {
    const { db } = await seed();
    const code = "AXP-20261012-12345678";
    await paid(db, "indosmm", "completed", code);
    await db.execRun(`UPDATE pedia_order_items SET refill_status=?,refill_supplier_id='OLD-ID',refill_last_at=datetime('now','-25 hours')`, status);
    const before = await db.queryFirst(`SELECT refill_status,refill_supplier_id,refill_last_at FROM pedia_order_items`);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code }) })).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id,refill_last_at FROM pedia_order_items`)).toEqual(before);
    const { GET } = await import("@/app/api/pedia/orders/[code]/route");
    const statusRequest = request({}); (statusRequest as Request).headers.set("x-order-contact","test@example.com");
    const res = await GET(statusRequest, { params: Promise.resolve({ code }) });
    expect((await res.json()).order.refill_eligible).toBe(false);
  });
  it.each(["completed", "supplier_rejected"])("allows a new refill after conclusively %s and 24 hours", async (status) => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET refill_status=?,refill_supplier_id='OLD-ID',refill_last_at=datetime('now','-25 hours')`, status);
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async () => new Response('{"refill":43}'));
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) })).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id FROM pedia_order_items`)).toMatchObject({ refill_status: "submitted", refill_supplier_id: "43" });
  });
  it("atomic refill claim blocks a stale read racing an unresolved refill", async () => {
    const { db, fx } = await seed();
    await paid(db, "indosmm", "completed");
    fx.control.beforeRun = async (q) => {
      if (q.includes("SET refill_last_at=")) fx.sql.prepare(`UPDATE pedia_order_items SET refill_status='needs_check',refill_supplier_id='RACE-ID',refill_last_at=datetime('now','-25 hours')`).run();
    };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    expect((await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) })).status).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.queryFirst(`SELECT refill_status,refill_supplier_id FROM pedia_order_items`)).toMatchObject({ refill_status: "needs_check", refill_supplier_id: "RACE-ID" });
  });
  it("refill status polling routes by the item provider", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "completed");
    await db.execRun(`UPDATE pedia_order_items SET refill_status='submitted',refill_supplier_id='42'`);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { status: "Completed" }, status: 200 } as never; }, db);
    expect(calls).toEqual([["refill_status", { refill: "42" }, 20000, undefined, "indosmm"]]);
    expect((await db.queryFirst(`SELECT refill_status FROM pedia_order_items`))?.refill_status).toBe("completed");
  });
  it.each(["IDR", "USD"])("cron records only verified IDR IndoSMM balances (%s)", async (currency) => {
    const { db } = await seed();
    vi.stubEnv("CRON_SECRET", "test-cron");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    vi.stubGlobal("fetch", async (url: unknown) => new Response(String(url).includes("/psmm/") ? '{"error":"Provider offline"}' : JSON.stringify({ balance: "150000", currency })));
    const { POST } = await import("@/app/api/cron/lite/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(new NextRequest("http://x/api/cron/lite?job=pedia_orders", { method: "POST", headers: { authorization: "Bearer test-cron" } }));
    expect(res.status).toBe(200);
    const rows = await db.queryAll(`SELECT supplier,balance FROM pedia_supplier_balance_log`);
    expect(rows).toEqual(currency === "IDR" ? [{ supplier: "indosmm", balance: 150000 }] : []);
  });
  it.each(["providersmm", "indosmm"] as const)("polls old %s orders using their stored provider/service after tier remapping", async (provider) => {
    const { db } = await seed();
    await paid(db, provider, "submitted");
    await db.execRun(`UPDATE pedia_tiers SET supplier=?, supplier_service_id=999 WHERE id=1`, provider === "indosmm" ? "providersmm" : "indosmm");
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { status: "In progress" }, status: 200 } as never; }, db);
    expect(calls).toEqual([["status", { order: "SAME-ORDER-ID" }, 20000, undefined, provider]]);
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("in_progress");
  });
  it("dispatch uses original service, never the tier's replacement", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    await db.execRun(`UPDATE pedia_tiers SET supplier='providersmm',supplier_service_id=999 WHERE id=1`);
    const calls: unknown[][] = [];
    await processPediaPaidOrders(async (...args) => { calls.push(args); return { ok: true, data: { order: "NEW" }, status: 200 } as never; }, db);
    expect(calls[0]).toEqual(["add", { service: 87, link: "x", quantity: 250 }, 30000, "AXP-P", "indosmm"]);
  });
  it("timeout never retries or crosses providers, including later cron ticks", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    const caller = vi.fn(async (...args: unknown[]) => { void args; return { ok: false, kind: "timeout" } as never; });
    await processPediaPaidOrders(caller, db);
    await processPediaPaidOrders(caller, db);
    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller.mock.calls[0]?.[4]).toBe("indosmm");
    expect(await db.queryFirst(`SELECT status,submit_attempts FROM pedia_order_items`)).toMatchObject({ status: "needs_check", submit_attempts: 1 });
  });
  it("crashed submitting orders become needs_check without any network call", async () => {
    const { db } = await seed();
    await paid(db, "indosmm", "submitting");
    const caller = vi.fn();
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("needs_check");
  });
  it("provider low-balance alerts have independent throttle keys", async () => {
    const { db } = await seed();
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "test-chat");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetch = vi.fn(async () => new Response('{"ok":true,"result":{}}'));
    vi.stubGlobal("fetch", fetch);
    const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
    expect(await notifyPediaLowBalance(0, db)).toBe(true);
    expect(await notifyPediaLowBalance(0, db, "indosmm")).toBe(true);
    expect(await notifyPediaLowBalance(0, db)).toBe(false);
    expect(await notifyPediaLowBalance(0, db, "indosmm")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("unknown providers and unpaid queued items cannot submit", async () => {
    const { db } = await seed();
    await paid(db, "indosmm");
    const caller = vi.fn();
    await db.execRun(`UPDATE orders SET status='pending'`);
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    await db.execRun(`UPDATE orders SET status='lunas'`);
    await db.execRun(`UPDATE pedia_order_items SET supplier='unknown'`);
    await processPediaPaidOrders(caller, db);
    expect(caller).not.toHaveBeenCalled();
    expect((await db.queryFirst(`SELECT status FROM pedia_order_items`))?.status).toBe("needs_check");
  });
  it.each(["providersmm", "indosmm"] as const)("refill follows the old %s order provider and stored eligibility, not its remapped tier", async (provider) => {
    const { db } = await seed();
    await paid(db, provider, "completed");
    await db.execRun(`UPDATE pedia_order_items SET snapshot_json='{"refill_days":30}'`);
    await db.execRun(`UPDATE pedia_tiers SET supplier='providersmm',supplier_service_id=999,refill_days=0 WHERE id=1`);
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "test");
    const fetch = vi.fn(async (url: unknown) => { void url; return new Response('{"refill":42}'); });
    vi.stubGlobal("fetch", fetch);
    const { POST } = await import("@/app/api/pedia/orders/[code]/refill/route");
    const res = await POST(request({ contact: "test@example.com" }), { params: Promise.resolve({ code: "AXP-P" }) });
    expect(res.status).toBe(200);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://proxy.example/${provider === "indosmm" ? "indosmm" : "psmm"}/refill`);
    expect((await db.queryFirst(`SELECT refill_supplier_id FROM pedia_order_items`))?.refill_supplier_id).toBe("42");
  });
});

describe("ProviderSMM-only public sales with stale active legacy tiers",()=>{
 it("omits legacy comparison prices and refuses forced legacy quotes",async()=>{
  await seed();const {NextRequest}=await import('next/server');const {GET:prices}=await import('@/app/api/pedia/prices/route');
  const response=await prices(new NextRequest('http://x/api/pedia/prices?product_slug=ig&quantity=250'));
  expect(response.status).toBe(200);expect((await response.json()).prices).toEqual([{tier_id:1,total:1300}]);
  const {POST:quote}=await import('@/app/api/pedia/quote/route');const r=await quote(request({product_id:1,tier_id:2,quantity:250,target:'https://instagram.com/buyer'}));
  expect(r.status).toBe(409);expect(await r.json()).toMatchObject({error:'provider_retired'});
 });
 it("hides a legacy-only product before its database tier is retired",async()=>{
  const {db}=await seed();await db.execRun("UPDATE pedia_tiers SET is_active=0 WHERE supplier='providersmm'");
  const {GET}=await import('@/app/api/pedia/catalog/route');expect((await (await GET()).json()).products).toEqual([]);
 });
});
it("rejects a video target for a feed-only Facebook share quote",async()=>{
 const {db}=await seed();await db.execRun("UPDATE pedia_products SET platform='facebook',metric='shares',target_kind='post' WHERE id=1");
 const {POST}=await import('@/app/api/pedia/quote/route');
 expect((await POST(request({product_id:1,tier_id:1,quantity:250,target:'https://facebook.com/reel/123456'}))).status).toBe(422);
 expect((await POST(request({product_id:1,tier_id:1,quantity:250,target:'https://facebook.com/page/posts/123456/'}))).status).toBe(200);
});
