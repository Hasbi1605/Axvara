// tests/games-admin-markup.test.ts — API admin baru packet G-BE B5:
// /api/admin/games/pricing (GET/PUT), /api/admin/games/games (GET/PATCH),
// PATCH markup varian + bulk-markup, filter region, dan penolakan
// `reference_price` yang sudah dipensiunkan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

let fx: ReturnType<typeof createD1Fixture>;

function setAdminEnv() {
  process.env.ADMIN_EMAIL = "admin@axvara.test";
  process.env.ADMIN_JWT_SECRET = "test-games-admin-secret-0123456789";
  process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
}

async function authedRequest(url: string, init?: RequestInit): Promise<NextRequest> {
  const auth = await import("@/lib/auth");
  const { token, sid } = await auth.createAdminToken("admin@axvara.test");
  const idle = await auth.createIdleToken(sid);
  const headers = new Headers(init?.headers);
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  const { signal: _signal, ...rest } = init ?? {};
  void _signal;
  return new NextRequest(url, { ...rest, headers });
}

const json = (url: string, method: string, body: unknown) => authedRequest(url, {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

const contract = JSON.stringify({
  version: 1,
  fields: [{ key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 }],
  requires_zone_id: false,
  validation_available: false,
  open_denom: false,
  supported: true,
  reason: null,
});

let nextVariant = 500;
function seed(over: Record<string, unknown> = {}) {
  const variantId = Number(over.sk_variant_id ?? nextVariant++);
  const row: Record<string, unknown> = {
    buyer_sku_code: `sk:${variantId}`,
    product_name: "86 Diamond",
    game_slug: "mobile-legends",
    sk_product_id: 33,
    sk_product_name: "Mobile Legends",
    sk_variant_id: variantId,
    supplier: "sekalipay",
    supplier_active: 1,
    enabled: 1,
    stock: 100,
    min_order: 1,
    cost: 10000,
    sell_price: 10500,
    required_fields_json: contract,
    product_type_name: "Indonesia",
    ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
  return String(row.buyer_sku_code);
}

const product = (sku: string) => fx.sql.prepare("SELECT * FROM games_products WHERE buyer_sku_code=?").get(sku) as Record<string, unknown>;
const variantMarkup = (sku: string) => fx.sql.prepare("SELECT * FROM games_variant_markup WHERE buyer_sku_code=?").get(sku) as Record<string, unknown> | undefined;
const metaRow = (slug: string) => fx.sql.prepare("SELECT * FROM games_meta WHERE slug=?").get(slug) as Record<string, unknown> | undefined;
const setting = (key: string) => (fx.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key) as { value: string } | undefined)?.value;

beforeEach(() => { fx = createD1Fixture(); setAdminEnv(); });
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

describe("/api/admin/games/pricing", () => {
  it("rejects unauthenticated access and invalid bodies", async () => {
    const { GET, PUT } = await import("@/app/api/admin/games/pricing/route");
    expect((await GET(new NextRequest("http://x/api/admin/games/pricing"))).status).toBe(401);
    expect((await PUT(new NextRequest("http://x/api/admin/games/pricing", { method: "PUT", body: "{}" }))).status).toBe(401);

    for (const body of [{}, { markup_percent: -1 }, { markup_percent: 101 }, { markup_percent: 4.555 },
      { rounding: 50 }, { rounding: "100" }, { unknown: 1 }]) {
      const res = await PUT(await json("http://x/api/admin/games/pricing", "PUT", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
  });

  it("reads the defaults and saves + reprices every SK row", async () => {
    seed({ sk_variant_id: 1, cost: 11750, sell_price: 1 });
    seed({ sk_variant_id: 2, cost: 321115, game_slug: "free-fire", sk_product_id: 44, sk_product_name: "Free Fire", sell_price: 1 });
    const { GET, PUT } = await import("@/app/api/admin/games/pricing/route");
    expect(await (await GET(await authedRequest("http://x/api/admin/games/pricing"))).json())
      .toMatchObject({ markup_percent: 5, rounding: 100 });

    const saved = await (await PUT(await json("http://x/api/admin/games/pricing", "PUT", { markup_percent: 8.25, rounding: 500 }))).json();
    expect(saved).toMatchObject({ ok: true, markup_percent: 8.25, rounding: 500, updated: 2 });
    expect(setting("games_markup_percent")).toBe("8.25");
    expect(setting("games_price_rounding")).toBe("500");
    // ceil(11750 × 1,0825 / 500) × 500 = 13000; ceil(321115 × 1,0825 / 500) × 500 = 347500.
    expect(Number(product("sk:1").sell_price)).toBe(13000);
    expect(Number(product("sk:2").sell_price)).toBe(348000);

    // PUT parsial mempertahankan nilai lain.
    const partial = await (await PUT(await json("http://x/api/admin/games/pricing", "PUT", { rounding: 100 }))).json();
    expect(partial).toMatchObject({ markup_percent: 8.25, rounding: 100 });
  });
});

describe("/api/admin/games/games", () => {
  it("lists every SK slug with stats, including hidden games", async () => {
    seed({ sk_variant_id: 1, cost: 10000, sell_price: 10500 });
    seed({ sk_variant_id: 2, cost: 20000, sell_price: 21000 });
    seed({ sk_variant_id: 3, supplier_active: 0, sell_price: 22000 });
    seed({ sk_variant_id: 4, enabled: 0, sell_price: 23000 });
    seed({ sk_variant_id: 5, game_slug: "free-fire", sk_product_id: 44, sk_product_name: "Free Fire", cost: 30000, sell_price: 31500 });
    fx.sql.exec("INSERT INTO games_meta(slug,hidden,featured_rank,display_name) VALUES('free-fire',1,3,'Free Fire ID')");
    const { GET } = await import("@/app/api/admin/games/games/route");
    const data = await (await GET(await authedRequest("http://x/api/admin/games/games"))).json();
    expect(data.count).toBe(2);
    expect(data.pricing).toEqual({ markup_percent: 5, rounding: 100 });
    const ml = data.games.find((game: { slug: string }) => game.slug === "mobile-legends");
    expect(ml).toMatchObject({
      name: "Mobile Legends", publisher: "Moonton", variants_total: 4, sellable_count: 2,
      supplier_off_count: 1, min_price: 10500, featured_rank: null, hidden: false,
      markup_percent: null, effective_markup_percent: 5,
    });
    const ff = data.games.find((game: { slug: string }) => game.slug === "free-fire");
    expect(ff).toMatchObject({ name: "Free Fire ID", hidden: true, featured_rank: 3, sellable_count: 1 });
    expect((await GET(new NextRequest("http://x/api/admin/games/games"))).status).toBe(401);
  });

  it("patches metadata, validates fields, and reprices only that game", async () => {
    seed({ sk_variant_id: 1, cost: 10000, sell_price: 10500 });
    seed({ sk_variant_id: 2, cost: 10000, sell_price: 11000, game_slug: "free-fire", sk_product_id: 44, sk_product_name: "Free Fire" });
    const { PATCH } = await import("@/app/api/admin/games/games/route");

    const ok = await PATCH(await json("http://x/api/admin/games/games", "PATCH", {
      slug: "mobile-legends", display_name: "MLBB", publisher: "Moonton", description: "Top up cepat.",
      id_guide: "Buka profil, salin User ID.", featured_rank: 2, hidden: true,
      icon_url: "/r2/products/ml.webp", banner_url: "https://cdn.example/b.webp",
    }));
    expect(ok.status).toBe(200);
    expect(metaRow("mobile-legends")).toMatchObject({
      display_name: "MLBB", publisher: "Moonton", description: "Top up cepat.",
      id_guide: "Buka profil, salin User ID.", featured_rank: 2, hidden: 1,
      icon_url: "/r2/products/ml.webp", banner_url: "https://cdn.example/b.webp", updated_by: "admin@axvara.test",
    });

    // Markup khusus game 10 % → hanya baris game itu yang dihitung ulang.
    const priced = await (await PATCH(await json("http://x/api/admin/games/games", "PATCH", {
      slug: "mobile-legends", markup_percent: 10,
    }))).json();
    expect(priced).toMatchObject({ ok: true, markup_changed: true, updated: 1 });
    expect(Number(product("sk:1").sell_price)).toBe(11000);
    expect(Number(product("sk:2").sell_price)).toBe(11000);

    // Reset ke default (null) → back to 5 %.
    await PATCH(await json("http://x/api/admin/games/games", "PATCH", { slug: "mobile-legends", markup_percent: null }));
    expect(Number(product("sk:1").sell_price)).toBe(10500);
    expect(metaRow("mobile-legends")!.markup_percent).toBeNull();
  });

  it("rejects unknown slugs, bad bodies and unsafe URLs", async () => {
    const { PATCH } = await import("@/app/api/admin/games/games/route");
    expect((await PATCH(new NextRequest("http://x/api/admin/games/games", { method: "PATCH", body: "{}" }))).status).toBe(401);
    expect((await PATCH(await json("http://x/api/admin/games/games", "PATCH", { slug: "nope", hidden: true }))).status).toBe(404);
    seed({ sk_variant_id: 1 });
    for (const body of [
      { slug: "mobile-legends" },
      { slug: "Mobile Legends!" },
      { slug: "mobile-legends", description: "x".repeat(601) },
      { slug: "mobile-legends", id_guide: "x".repeat(601) },
      { slug: "mobile-legends", featured_rank: 0 },
      { slug: "mobile-legends", featured_rank: 100 },
      { slug: "mobile-legends", featured_rank: 2.5 },
      { slug: "mobile-legends", markup_percent: 101 },
      { slug: "mobile-legends", icon_url: "javascript:alert(1)" },
      { slug: "mobile-legends", banner_url: "http://insecure.example/b.png" },
      { slug: "mobile-legends", unknown: 1 },
    ]) {
      const res = await PATCH(await json("http://x/api/admin/games/games", "PATCH", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("creates metadata for an existing SK slug and trims blank text to null", async () => {
    seed({ sk_variant_id: 1 });
    const { PATCH } = await import("@/app/api/admin/games/games/route");
    await PATCH(await json("http://x/api/admin/games/games", "PATCH", {
      slug: "mobile-legends", display_name: "   ", publisher: "",
    }));
    expect(metaRow("mobile-legends")).toMatchObject({ display_name: null, publisher: null });
  });
});

describe("PATCH /api/admin/games/products (markup varian)", () => {
  it("validates markup bounds and keeps old markup on partial patches", async () => {
    seed({ sk_variant_id: 1 });
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    for (const body of [
      { buyer_sku_code: "sk:1", markup_percent: -1 },
      { buyer_sku_code: "sk:1", markup_percent: 101 },
      { buyer_sku_code: "sk:1", markup_percent: 4.555 },
      { buyer_sku_code: "sk:1", markup_fixed: -1 },
      { buyer_sku_code: "sk:1", markup_fixed: 1_000_001 },
      { buyer_sku_code: "sk:1", markup_fixed: 12.5 },
      { buyer_sku_code: "sk:1", reference_price: 20000 },
    ]) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const retired = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", reference_price: 20000 }));
    expect(await retired.json()).toMatchObject({ error: "invalid_body" });

    // Set 12 %, lalu hanya ubah fixed → persen lama dipertahankan.
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", markup_percent: 12 }));
    expect(variantMarkup("sk:1")).toMatchObject({ markup_percent: 12, markup_fixed: null });
    expect(Number(product("sk:1").sell_price)).toBe(11200);
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", markup_fixed: 250 }));
    expect(variantMarkup("sk:1")).toMatchObject({ markup_percent: 12, markup_fixed: 250 });
    expect(Number(product("sk:1").sell_price)).toBe(11450);
    // Reset ke default menghapus baris override.
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", markup_percent: null, markup_fixed: null }));
    expect(variantMarkup("sk:1")).toBeUndefined();
    expect(Number(product("sk:1").sell_price)).toBe(10500);
  });

  it("accepts all eight categories and rejects unknown ones", async () => {
    seed({ sk_variant_id: 1 });
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    for (const group of ["special", "bestseller", "promo", "first_topup", "pass", "pack", "topup", "other"]) {
      expect((await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", display_group: group }))).status)
        .toBe(200);
      expect(product("sk:1").display_group).toBe(group);
    }
    expect((await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", display_group: "all" }))).status).toBe(400);
    expect((await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:1", display_group: null }))).status).toBe(200);
    expect(product("sk:1").display_group).toBeNull();
  });

  it("GET exposes markup source/effect/region and filters by region", async () => {
    seed({ sk_variant_id: 1, product_type_name: "Indonesia" });
    seed({ sk_variant_id: 2, product_type_name: "Filipina", product_name: "5 Diamonds (filipina)" });
    seed({ sk_variant_id: 3, product_type_name: "DIGITAL", product_name: "Gift Card" });
    fx.sql.exec("INSERT INTO games_meta(slug,markup_percent,hidden) VALUES('mobile-legends',8,0)");
    fx.sql.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed,updated_at) VALUES('sk:2',15,500,'2026-11-14T00:00:00Z')");
    const { GET } = await import("@/app/api/admin/games/products/route");
    const data = await (await GET(await authedRequest("http://x/api/admin/games/products?limit=10"))).json();
    const byId = new Map(data.items.map((item: Record<string, unknown>) => [item.buyer_sku_code, item]));
    expect(byId.get("sk:1")).toMatchObject({ markup_source: "game", effective_markup_percent: 8, markup_fixed: 0, region: "ID" });
    expect(byId.get("sk:2")).toMatchObject({ markup_source: "variant", effective_markup_percent: 15, markup_fixed: 500, region: "PH" });
    expect(byId.get("sk:3")).toMatchObject({ markup_source: "game", region: null });
    expect(data.pricing).toEqual({ markup_percent: 5, rounding: 100 });
    expect(data.sync.counts).toMatchObject({ total: 3, supplier_off: 0 });

    const ph = await (await GET(await authedRequest("http://x/api/admin/games/products?region=PH"))).json();
    expect(ph.items.map((item: { buyer_sku_code: string }) => item.buyer_sku_code)).toEqual(["sk:2"]);
    expect(ph.total).toBe(1);
    const id = await (await GET(await authedRequest("http://x/api/admin/games/products?region=id"))).json();
    expect(id.items.map((item: { buyer_sku_code: string }) => item.buyer_sku_code)).toEqual(["sk:1"]);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?region=ZZ"))).status).toBe(400);
  });
});

describe("POST /api/admin/games/products/bulk-markup", () => {
  it("requires admin and a well-formed body", async () => {
    const { POST } = await import("@/app/api/admin/games/products/bulk-markup/route");
    expect((await POST(new NextRequest("http://x/api/admin/games/products/bulk-markup", { method: "POST", body: "{}" }))).status).toBe(401);
    for (const body of [
      {},
      { skus: [] },
      { skus: ["ml86"] },
      { skus: ["sk:1"] },
      { skus: Array.from({ length: 2001 }, (_, i) => `sk:${i + 1}`), markup_percent: 5 },
      { skus: ["sk:1"], markup_percent: 101 },
      { skus: ["sk:1"], markup_fixed: 1_000_001 },
      { skus: ["sk:1"], display_group: "all" },
      { skus: ["sk:1"], markup_percent: 5, unknown: 1 },
    ]) {
      const res = await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", body));
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it("sets markup for many SKUs and uses ONE recompute statement", async () => {
    for (let i = 1; i <= 30; i++) seed({ sk_variant_id: i, cost: 10000, sell_price: 1 });
    seed({ sk_variant_id: 99, cost: 10000, sell_price: 20000 });
    const { POST } = await import("@/app/api/admin/games/products/bulk-markup/route");
    const skus = Array.from({ length: 30 }, (_, i) => `sk:${i + 1}`);
    // Rekam statement tulis agar bukti "satu recompute" tidak tercampur query auth.
    const statements: string[] = [];
    fx.control.fail = (query) => { statements.push(query); return false; };
    const res = await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", {
      skus, markup_percent: 20, markup_fixed: 0,
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, updated: 30 });
    // `security_events` adalah audit requireAdmin, bukan bagian recompute.
    const writes = statements
      .filter((q) => /^(INSERT|UPDATE|DELETE)/i.test(q.trim()))
      .filter((q) => !/security_events/.test(q));
    // 1 insert override (semua SKU via json_each) + 1 update harga = 2 tulis.
    expect(writes).toHaveLength(2);
    expect(writes.filter((q) => /UPDATE games_products SET sell_price/.test(q))).toHaveLength(1);
    // Baca setting harga global: satu query.
    expect(statements.filter((q) => /FROM store_settings/.test(q)).length).toBeLessThanOrEqual(1);
    expect(Number(product("sk:1").sell_price)).toBe(12000);
    expect(Number(product("sk:30").sell_price)).toBe(12000);
    // Di luar daftar: tidak berubah.
    expect(Number(product("sk:99").sell_price)).toBe(20000);
    expect(fx.sql.prepare("SELECT COUNT(*) n FROM games_variant_markup").get()).toEqual({ n: 30 });
  });

  it("sets a category for the selection without touching Digiflazz rows", async () => {
    seed({ sk_variant_id: 1 });
    seed({ sk_variant_id: 2 });
    fx.sql.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed) VALUES('sk:1',8,250),('sk:2',12,500)");
    const before = fx.sql.prepare("SELECT * FROM games_variant_markup ORDER BY buyer_sku_code").all();
    fx.sql.exec("INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,supplier) VALUES('ml86','legacy',15000,20000,'digiflazz')");
    const { POST } = await import("@/app/api/admin/games/products/bulk-markup/route");
    // Kode non-SK ditolak lebih dulu (skus hanya sk:<id>).
    expect((await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", {
      skus: ["sk:1", "ml86"], display_group: "promo",
    }))).status).toBe(400);
    const res = await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", {
      skus: ["sk:1", "sk:2"], display_group: "promo",
    }));
    expect((await res.json()).changed).toBe(2);
    expect(product("sk:1").display_group).toBe("promo");
    expect(product("sk:2").display_group).toBe("promo");
    expect(product("ml86").display_group).toBeNull();
    expect(fx.sql.prepare("SELECT * FROM games_variant_markup ORDER BY buyer_sku_code").all()).toEqual(before);
    expect(Number(product("sk:1").sell_price)).toBe(10500);
    expect(Number(product("sk:2").sell_price)).toBe(10500);
  });

  it.each([
    { markup_percent: 12 }, { markup_fixed: 350 },
    { markup_percent: null }, { markup_fixed: null },
    { markup_percent: 0 }, { markup_fixed: 0 },
    { markup_percent: null, markup_fixed: null },
  ])("atomically preserves omitted fields for 121 SKUs, including new overrides: %j", async patch => {
    const skus = Array.from({ length: 121 }, (_, i) => seed({ sk_variant_id: i + 1 }));
    // Existing rows deliberately have distinct percentages AND fixed amounts.
    const existing = Array.from({ length: 120 }, (_, i) => ({ sku: skus[i], percent: i % 10 + 1, fixed: 200 + i }));
    fx.sql.prepare(`INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed)
      SELECT json_extract(value,'$.sku'),json_extract(value,'$.percent'),json_extract(value,'$.fixed') FROM json_each(?)`).run(JSON.stringify(existing));
    seed({ sk_variant_id: 999 });
    fx.sql.exec("INSERT INTO games_variant_markup(buyer_sku_code,markup_percent,markup_fixed) VALUES('sk:999',77,999)");
    const statements: string[] = [];
    fx.control.fail = query => { statements.push(query); return false; };
    const { POST } = await import("@/app/api/admin/games/products/bulk-markup/route");
    const response = await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", { skus, ...patch }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 121 });
    for (const [index, sku] of skus.entries()) {
      const percent = "markup_percent" in patch ? patch.markup_percent : existing[index]?.percent ?? null;
      const fixed = "markup_fixed" in patch ? patch.markup_fixed : existing[index]?.fixed ?? null;
      if (patch.markup_percent === null && patch.markup_fixed === null) expect(variantMarkup(sku)).toBeUndefined();
      else expect(variantMarkup(sku)).toMatchObject({ markup_percent: percent, markup_fixed: fixed });
      expect(Number(product(sku).sell_price)).toBe(Math.ceil((10000 * (10000 + (percent ?? 5) * 100)) / 1_000_000) * 100 + (fixed ?? 0));
    }
    expect(variantMarkup("sk:999")).toMatchObject({ markup_percent: 77, markup_fixed: 999 });
    expect(Number(product("sk:999").sell_price)).toBe(10500);
    // No per-SKU read/modify/write loop: one markup write, one recompute, one settings read.
    const business = statements.filter(query => /games_variant_markup|UPDATE games_products SET sell_price|FROM store_settings/.test(query));
    expect(business).toHaveLength(3);
    expect(business.filter(query => /^\s*SELECT[\s\S]*FROM games_variant_markup/.test(query))).toHaveLength(0);
  });

  it("resets markup overrides back to the default", async () => {
    seed({ sk_variant_id: 1 });
    const { POST } = await import("@/app/api/admin/games/products/bulk-markup/route");
    await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", { skus: ["sk:1"], markup_percent: 30 }));
    expect(Number(product("sk:1").sell_price)).toBe(13000);
    await POST(await json("http://x/api/admin/games/products/bulk-markup", "POST", {
      skus: ["sk:1"], markup_percent: null, markup_fixed: null,
    }));
    expect(variantMarkup("sk:1")).toBeUndefined();
    expect(Number(product("sk:1").sell_price)).toBe(10500);
  });
});
