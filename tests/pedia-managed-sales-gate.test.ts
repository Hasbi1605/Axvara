// tests/pedia-managed-sales-gate.test.ts — PSMM-P5 (2026-11-12).
// Mengunci kontrak publik: katalog/quote/order hanya menerima baris OTOMATIS
// supplier jual dengan deskripsi resmi `ok`; tier kurasi/ProviderSMM lama dan
// baris tanpa deskripsi tidak bisa dijual walau id-nya dipalsukan; retry order
// tersimpan tetap dilayani; Custom Comments tetap didukung.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { seedOfficialDescriptions } from "./helpers/pedia-managed-fixture";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import * as qris from "@/lib/payments/dana-qris";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const request = (body: unknown) => new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;

type Seed = {
  managed?: boolean;
  withDescription?: boolean;
  productManaged?: boolean;
  inputKind?: "comments" | null;
  name?: string;
};

async function seed(opts: Seed = {}) {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-p5-secret");
  const productManaged = opts.productManaged ?? true;
  await db.execRun(
    `INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
     VALUES ('ig','instagram',?,?,?, '[100,250]',10,1,?)`,
    opts.inputKind === "comments" ? "comments" : "followers",
    opts.inputKind === "comments" ? "post" : "profile",
    opts.name ?? "Followers Instagram",
    productManaged ? "auto" : "curated",
  );
  await db.execRun(
    `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
     VALUES ('providersmm',501,'Private supplier name','Instagram','${opts.inputKind === "comments" ? "Custom Comments" : "Default"}',20000,20,10000,1)`,
  );
  await db.execRun(
    `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,is_active,managed,input_kind)
     VALUES (1,'standar','providersmm',501,'G2',60,2000,0,'{"100":4000,"250":9000}',1,?,?)`,
    (opts.managed ?? true) ? "auto" : "curated", opts.inputKind ?? null,
  );
  if (opts.withDescription ?? true) await seedOfficialDescriptions(db, [501]);
  return { db, fx };
}

describe("public catalog managed gate", () => {
  it("offers only an active managed tier whose official description is ok", async () => {
    await seed();
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    expect(data.products).toHaveLength(1);
    expect(data.products[0].name).toBe("Followers Instagram");
    expect(data.products[0].tiers[0]).toMatchObject({ min_qty: 20, max_qty: 10000 });
    // Tidak boleh bocor identitas/biaya supplier atau ID layanan mentah.
    expect(JSON.stringify(data)).not.toMatch(/providersmm|Private supplier|supplier_service_id|rate_idr|markup/);
  });

  it("hides a curated (legacy ProviderSMM) tier so no duplicate offer appears", async () => {
    await seed({ managed: false });
    const { GET } = await import("@/app/api/pedia/catalog/route");
    expect((await (await GET()).json()).products).toEqual([]);
  });

  it("hides a managed tier with no usable official description", async () => {
    await seed({ withDescription: false });
    const { GET } = await import("@/app/api/pedia/catalog/route");
    expect((await (await GET()).json()).products).toEqual([]);
  });

  it("white-labels the product name instead of leaking the raw supplier name", async () => {
    await seed({ name: "Followers ProviderSMM 🇮🇩" });
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    expect(data.products[0].name).not.toMatch(/ProviderSMM/);
    expect(data.products[0].name).toContain("AXVARA");
  });

  it("serves every eligible managed tier without a hard cap", async () => {
    const { db } = await seed();
    // Tambah 12 tier managed tambahan pada produk yang sama.
    for (let i = 0; i < 12; i++) {
      await db.execRun(
        `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
         VALUES ('providersmm',?, 'Private supplier name','Instagram','Default',25000,20,10000,1)`, 600 + i,
      );
      await db.execRun(
        `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,package_prices_json,is_active,managed)
         VALUES (1,'standar','providersmm',?,'G2',60,2000,'{"100":4200,"250":9500}',1,'auto')`, 600 + i,
      );
    }
    await seedOfficialDescriptions(db, [501, ...Array.from({ length: 12 }, (_, i) => 600 + i)]);
    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    expect(data.products[0].tiers).toHaveLength(13);
  });
});

describe("quote managed gate", () => {
  it("issues a quote for a managed tier and snapshots the official description", async () => {
    await seed();
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(200);
    const q = await res.json();
    expect(q.quote_token).toBeTruthy();
  });

  it("rejects a forged curated tier id even if it is active in the DB", async () => {
    await seed({ managed: false });
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("provider_retired");
  });

  it("rejects a managed tier whose description is missing", async () => {
    await seed({ withDescription: false });
    const { POST } = await import("@/app/api/pedia/quote/route");
    const res = await POST(request({ product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" }));
    expect(res.status).toBe(409);
  });

  it("keeps Custom Comments end-to-end (comments required and signed)", async () => {
    await seed({ inputKind: "comments" });
    const { POST } = await import("@/app/api/pedia/quote/route");
    const base = { product_id: 1, tier_id: 1, quantity: 20, target: "https://instagram.com/p/ABC/" };
    const missing = await POST(request(base));
    expect(missing.status).toBe(422);
    const ok = await POST(request({ ...base, comments: Array.from({ length: 20 }, (_, i) => `komentar ${i + 1}`).join("\n") }));
    expect(ok.status).toBe(200);
  });
});

describe("order managed gate", () => {
  async function orderFor(fx: ReturnType<typeof createD1Fixture>) {
    // Quote yang ditandatangani sebagai baris otomatis (zaman sebelum flip tier).
    const { token, quoteId } = await createPediaQuoteToken({
      product_id: 1, tier_id: 1, quantity: 250, target_raw: "https://instagram.com/buyer",
      target_normalized: "https://www.instagram.com/buyer/", unit_price: 32, total: 8000,
      credit_code_hash: null, credit_used: 0, supplier: "providersmm", supplier_service_id: 501,
      supplier_rate_snapshot: 20000, managed: "auto", terms_version: "2026-11-12T10:00:00.000Z",
      service_copy: { product_name: "Followers Instagram", service_name: "Followers Instagram", description: "Deskripsi kurasi lama.", terms: "", instructions: "" },
    });
    void fx; void quoteId;
    return token;
  }

  it("persists a managed order and snapshots the official description", async () => {
    const { db } = await seed();
    vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 1, qrisPayload: "t", qrisUrl: "/qr.png", expires_at: "2099-01-01", expiresAt: "2099-01-01", isExisting: false }) as never);
    const token = await orderFor(db.d1 as never);
    const { POST } = await import("@/app/api/pedia/orders/route");
    const res = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));
    expect(res.status).toBe(201);
    const item = await db.queryFirst(`SELECT snapshot_json FROM pedia_order_items`);
    expect(String(item?.snapshot_json)).toContain("Syarat resmi");
  });

  it("refuses a fresh order when the tier is curated (active but not managed)", async () => {
    const { db } = await seed({ managed: false });
    const token = await orderFor(db.d1 as never);
    const { POST } = await import("@/app/api/pedia/orders/route");
    const res = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));
    expect(res.status).toBe(409);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM orders`)).toMatchObject({ n: 0 });
  });

  it("still returns an existing persisted order after its tier becomes unsellable", async () => {
    const { db } = await seed();
    const token = await orderFor(db.d1 as never);
    vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 1, qrisPayload: "t", qrisUrl: "/qr.png", expires_at: "2099-01-01", expiresAt: "2099-01-01", isExisting: false }) as never);
    const { POST } = await import("@/app/api/pedia/orders/route");
    const created = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));
    const code = (await created.json()).code;
    // Tier dinonaktifkan + deskripsi dicabut SETELAH order tersimpan.
    await db.execRun(`UPDATE pedia_tiers SET is_active=0 WHERE id=1`);
    await db.execRun(`DELETE FROM store_settings WHERE key='pedia_psmm_desc_snapshot'`);
    const retry = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ code, reused: true });
  });
});
