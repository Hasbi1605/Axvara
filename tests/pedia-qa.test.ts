// tests/pedia-qa.test.ts — PEDIA M7 QA: AC-06/15/22/23 + DNS/flag.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyProvidersmmDiff } from "@/lib/pedia/sync";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setPediaEnv() {
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-pedia-qa-secret");
}

async function seedActive() {
  const { db: d1 } = createD1Fixture();
  const db = createDatabaseAccess(d1);
  await db.execRun(
    `INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active)
     VALUES ('followers-instagram','instagram','followers','profile','Followers Instagram','[100,250]',10,1)`,
  );
  const p = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='followers-instagram'`);
  await db.execRun(
    `INSERT INTO pedia_tiers (product_id, tier, supplier, supplier_service_id, price_group,
       markup_pct, min_profit_rp, refill_days, package_prices_json, is_active)
     VALUES (?, 'standar', 'providersmm', 86, 'G3', 20, 1000, 30, '{}', 1)`,
    Number(p?.id),
  );
  await applyProvidersmmDiff(db, [{
    service_id: 86, name: "IG", type: "D", category: "IG",
    rate: 38750, min_qty: 100, max_qty: 1000,
    api_refill: 0, api_cancel: 0, api_dripfeed: 1,
  }], []);
  const tier = await db.queryFirst(`SELECT id FROM pedia_tiers`);
  return { pid: Number(p?.id), tierId: Number(tier?.id), db };
}

async function quoteFor(pid: number, tierId: number, target: string) {
  const { POST } = await import("@/app/api/pedia/quote/route");
  const res = await POST(new Request("http://x/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ product_id: pid, tier_id: tierId, quantity: 250, target }),
  }) as never);
  expect(res.status).toBe(200);
  return (await res.json()).quote_token as string;
}

describe("M7 QA triple-check", () => {
  it("AC-06: order ganda (link+produk aktif) ditolak + kode lama", async () => {
    const { pid, tierId } = await seedActive();
    setPediaEnv();
    // Mock invoice QRIS (DANA tidak dikonfigurasi di test).
    const qris = await import("@/lib/payments/dana-qris");
    const spy = vi.spyOn(qris, "createActiveQrisInvoice").mockResolvedValue({
      orderCode: "AXP-X", requestedAmount: 12000, payableAmount: 12000,
      uniqueCode: 1, qrisPayload: "x", qrisUrl: "http://x/q.png",
      expiresAt: new Date().toISOString(), isExisting: false,
    });
    const target = "https://www.instagram.com/namakamu";
    const q1 = await quoteFor(pid, tierId, target);
    const { POST } = await import("@/app/api/pedia/orders/route");
    const mk = (qt: string) => new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_wa: "081234567890", customer_email: "a@b.com", quote_token: qt }),
    }) as never;
    const r1 = await POST(mk(q1));
    expect(r1.status).toBe(201);
    const d1 = await r1.json();
    expect(d1.code).toMatch(/^AXP-/);
    // Order kedua ke link+produk yang sama → 409 + kode lama.
    const q2 = await quoteFor(pid, tierId, target);
    const r2 = await POST(mk(q2));
    expect(r2.status).toBe(409);
    const d2 = await r2.json();
    expect(d2.error).toBe("duplicate_active_order");
    expect(d2.order_code).toBe(d1.code);
    spy.mockRestore();
  });

  it("AC-15: diff menonaktifkan tier ≤ tampilan katalog (cache 60 dtk)", async () => {
    const { db } = await seedActive();
    setPediaEnv();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const before = await (await GET()).json();
    expect(before.products.length).toBe(1);
    // Rate naik besar → guard margin menonaktifkan.
    await applyProvidersmmDiff(db, [{
      service_id: 86, name: "IG", type: "D", category: "IG",
      rate: 200000, min_qty: 100, max_qty: 1000,
      api_refill: 0, api_cancel: 0, api_dripfeed: 1,
    }], []);
    const after = await (await GET()).json();
    expect(after.products.length).toBe(0);
  });

  it("AC-22: filter kind=pedia memisahkan order Pedia", async () => {
    createD1Fixture();
    process.env.ADMIN_EMAIL = "a@x.com";
    process.env.ADMIN_JWT_SECRET = "test-qa-secret-1234567890";
    process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
    const auth = await import("@/lib/auth");
    const { token, sid } = await auth.createAdminToken("a@x.com");
    const idle = await auth.createIdleToken(sid);
    const cookie = `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
    const { createDatabaseAccess: cda } = await import("@/lib/db-access");
    const db = cda();
    await db.execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, sales_channel, order_kind)
       VALUES ('AXP-QA1', '', '6281', '[]', 5000, 'qris', 'pending', 'web', 'pedia')`,
    );
    await db.execRun(
      `INSERT INTO orders (code, customer_name, customer_wa, items, subtotal, payment_method, status, sales_channel, order_kind)
       VALUES ('AXV-QA1', '', '6281', '[]', 5000, 'qris', 'pending', 'web', 'apps')`,
    );
    const { GET } = await import("@/app/api/admin/orders/route");
    const { NextRequest } = await import("next/server");
    const call = async (kind: string) => {
      const res = await GET(new NextRequest(`http://x/api/admin/orders?kind=${kind}`, { headers: { cookie } }));
      return (await res.json()) as { orders: { code: string }[] };
    };
    const pedia = await call("pedia");
    expect(pedia.orders.map((o) => o.code)).toEqual(["AXP-QA1"]);
    const apps = await call("apps");
    expect(apps.orders.map((o) => o.code)).toEqual(["AXV-QA1"]);
  });

  it("AC-23: PEDIA_ENABLED=false → katalog 503 (tanpa error)", async () => {
    await seedActive();
    vi.stubEnv("PEDIA_ENABLED", "false");
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
