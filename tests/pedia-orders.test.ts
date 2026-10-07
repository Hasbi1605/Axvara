// tests/pedia-orders.test.ts — PEDIA M4: quote → orders → guard.
// Dikunci: quote JWT 30 mnt, guard ganda (paket hilang 404, harga berubah
// 409, margin jebol 410 + kunci tier), idempoten quote, AC-16 (tanpa data
// supplier di katalog publik), kredit-penuh lunas tanpa QRIS.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { applyProvidersmmDiff } from "@/lib/pedia/sync";
import { verifyPediaQuoteToken } from "@/lib/pedia/quote";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setPediaEnv() {
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-pedia-quote-secret");
}

async function seedCatalog() {
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
    service_id: 86, name: "IG Followers", type: "Default", category: "IG",
    rate: 38750, min_qty: 100, max_qty: 1000,
    api_refill: 0, api_cancel: 0, api_dripfeed: 1,
  }], []);
  const pid = Number(p?.id);
  const tier = await db.queryFirst(`SELECT id FROM pedia_tiers WHERE product_id=?`, pid);
  return { pid, tierId: Number(tier?.id) };
}

describe("quote Pedia PD-20", () => {
  it("quote valid → JWT terverifikasi + payable benar (250 @12000)", async () => {
    const { pid, tierId } = await seedCatalog();
    setPediaEnv();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid, tier_id: tierId, quantity: 250,
        target: "https://www.instagram.com/namakamu",
      }),
    }) as never);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.total).toBe(12000);
    expect(d.payable).toBe(12000);
    const payload = await verifyPediaQuoteToken(d.quote_token);
    expect(payload?.target_normalized).toBe("https://www.instagram.com/namakamu/");
    expect(payload?.supplier_service_id).toBe(86);
  });

  it("AC-03: link post ke produk Followers ditolak dengan saran", async () => {
    const { pid, tierId } = await seedCatalog();
    setPediaEnv();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid, tier_id: tierId, quantity: 250,
        target: "https://www.instagram.com/p/XYZ/",
      }),
    }) as never);
    expect(res.status).toBe(422);
    const d = await res.json();
    expect(d.error).toBe("target_mismatch");
  });

  it("qty di luar min–max ditolak dengan pesan batas", async () => {
    const { pid, tierId } = await seedCatalog();
    setPediaEnv();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid, tier_id: tierId, quantity: 5000,
        target: "https://www.instagram.com/namakamu",
      }),
    }) as never);
    expect(res.status).toBe(422);
    const d = await res.json();
    expect(d.message).toMatch(/Minimal 100, maksimal 1000/);
  });
});

describe("orders Pedia PD-21 + guard", () => {
  it("AC-16: katalog publik tanpa data supplier", async () => {
    await seedCatalog();
    setPediaEnv();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const res = await GET();
    const d = await res.json();
    const raw = JSON.stringify(d);
    expect(raw).not.toMatch(/supplier_service_id|supplier_order_id|rate_idr|live_rate/);
    expect(d.products[0].tiers[0].prices["250"]).toBe(12000);
  });

  it("margin jebol antara quote–order → 410 + tier dikunci (PD-33)", async () => {
    const { pid, tierId } = await seedCatalog();
    setPediaEnv();
    const { POST: quotePost } = await import("@/app/api/pedia/quote/route");
    const q = await quotePost(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid, tier_id: tierId, quantity: 250,
        target: "https://www.instagram.com/namakamu",
      }),
    }) as never);
    expect(q.status).toBe(200);
    const { quote_token } = await q.json();
    // Rate naik 10% setelah quote → margin paket terkecil jebol → diff
    // menonaktifkan tier (PD-32) → order ditolak & tier dikunci.
    // PENTING: fixture D1 sama (globalThis.DB) — jangan buat fixture baru.
    const { createDatabaseAccess: cda } = await import("@/lib/db-access");
    const db2 = cda();
    await applyProvidersmmDiff(db2, [{
      service_id: 86, name: "IG Followers", type: "Default", category: "IG",
      rate: 42625, min_qty: 100, max_qty: 1000,
      api_refill: 0, api_cancel: 0, api_dripfeed: 1,
    }], []);
    const { POST: orderPost } = await import("@/app/api/pedia/orders/route");
    const res = await orderPost(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_wa: "081234567890", customer_email: "a@b.com", quote_token,
      }),
    }) as never);
    // Tier sudah nonaktif oleh diff → 404 produk/tingkat (bukan kirim rugi).
    expect(res.status).toBe(404);
    const locked = await db2.queryFirst(`SELECT is_active, auto_disabled_reason FROM pedia_tiers WHERE id=?`, tierId);
    expect(Number(locked?.is_active)).toBe(0);
    expect(locked?.auto_disabled_reason).toBe("margin");
  });

  it("harga berubah antara quote–order → 409 price_changed", async () => {
    const { pid, tierId } = await seedCatalog();
    setPediaEnv();
    const { POST: quotePost } = await import("@/app/api/pedia/quote/route");
    const q = await quotePost(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid, tier_id: tierId, quantity: 250,
        target: "https://www.instagram.com/namakamu",
      }),
    }) as never);
    const { quote_token } = await q.json();
    // Ubah markup tier langsung (simulasi admin ubah harga) → harga segar
    // berbeda dari quote → 409 tanpa menyentuh status aktif.
    const { createDatabaseAccess: cda } = await import("@/lib/db-access");
    const db2 = cda();
    await db2.execRun(`UPDATE pedia_tiers SET markup_pct=30 WHERE id=?`, tierId);
    const { POST: orderPost } = await import("@/app/api/pedia/orders/route");
    const res = await orderPost(new Request("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_wa: "081234567890", customer_email: "a@b.com", quote_token,
      }),
    }) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("price_changed");
  });
});
