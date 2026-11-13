// tests/games-admin.test.ts — AXVARA Games admin: katalog SK (supplier,
// varian, stok, kontrak), harga referensi/grup/enabled, dan gelombang 1 yang
// sudah dipensiunkan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  effectiveGroup, gamesMargin, isHealthyForWave, GAMES_WAVE1_BRANDS,
} from "@/lib/games/admin";

let fx: ReturnType<typeof createD1Fixture>;

const CONTRACT = JSON.stringify({
  version: 1,
  fields: [{ key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 }],
  requires_zone_id: false, validation_available: false, open_denom: false, supported: true, reason: null,
});
const slugOf = (brand: unknown) => String(brand ?? "Mobile Legends").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
let nextVariant = 900;

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
const seed = (over: Record<string, unknown> = {}) => {
  const code = String(over.buyer_sku_code ?? "sk:101");
  const brand = over.game_brand ?? "Mobile Legends";
  const digits = Number(code.replace(/\D/g, ""));
  const row: Record<string, unknown> = {
    buyer_sku_code: "sk:101", product_name: "86 Diamond", game_brand: brand, product_type: "Umum",
    sk_product_name: brand, game_slug: slugOf(brand),
    sk_variant_id: Number.isSafeInteger(digits) && digits > 0 ? digits : nextVariant++,
    sk_product_id: 33, supplier: "sekalipay", supplier_active: 1, stock: 100, min_order: 1,
    required_fields_json: CONTRACT, cost: 10000, sell_price: 11000, seller_active: 0, enabled: 0, ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
};
const legacy = (over: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = { buyer_sku_code: "ml86", product_name: "86 Diamond", game_brand: "MOBILE LEGENDS", cost: 10000, sell_price: 11000, seller_active: 1, enabled: 1, ...over };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key]));
};
const product = (sku: string) => fx.sql.prepare("SELECT * FROM games_products WHERE buyer_sku_code=?").get(sku) as Record<string, unknown>;
const reference = (sku: string) => fx.sql.prepare("SELECT * FROM games_reference_prices WHERE buyer_sku_code=?").get(sku) as Record<string, unknown> | undefined;

beforeEach(() => { fx = createD1Fixture(); setAdminEnv(); });
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

describe("games admin helpers", () => {
  it("keeps the four legacy brands available for compatibility", () => {
    expect(GAMES_WAVE1_BRANDS).toEqual(["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"]);
  });

  it("effectiveGroup prefers the admin override, then Membership/WDP/Twilight names", () => {
    expect(effectiveGroup({ display_group: "bestseller", product_name: "Weekly Diamond Pass" })).toBe("bestseller");
    expect(effectiveGroup({ display_group: null, product_type: "Membership", product_name: "X" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "Weekly Diamond Pass" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "WDP 55" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "Twilight Pass" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "86 Diamond" })).toBe("all");
    expect(effectiveGroup({ display_group: "bogus", product_name: "86 Diamond" })).toBe("all");
  });

  it("gamesMargin reports floor/reference source, rupiah and percent margin", () => {
    const withReference = gamesMargin({ cost: 10000, sell_price: 19600, reference_price: 20000 });
    expect(withReference).toMatchObject({ cost: 10000, sell: 19600, floor: 10300, margin_rp: 9600, margin_pct: 96, source: "reference", competitive: true });
    const floorOnly = gamesMargin({ cost: 10000, sell_price: 10300, reference_price: null });
    expect(floorOnly).toMatchObject({ source: "floor", competitive: null, margin_rp: 300, margin_pct: 3 });
    expect(gamesMargin({ cost: 10000, sell_price: 10300, reference_price: 10400 })).toMatchObject({ source: "floor", competitive: true });
  });

  it("legacy health helper stays available but is not used by the SK catalogue", () => {
    expect(isHealthyForWave({ cost: 10000, sell_price: 10300, seller_active: 1 })).toBe(true);
    expect(isHealthyForWave({ cost: 10000, sell_price: 11000, seller_active: 0 })).toBe(false);
  });
});

describe("admin games products API", () => {
  it("lists only SK rows, showing supplier/stock/contract/availability and nickname legacy summary", async () => {
    seed({ buyer_sku_code: "sk:101", game_brand: "Mobile Legends", product_name: "Weekly Diamond Pass", product_type: "Membership", reference_price: 20000, sell_price: 19600 });
    seed({ buyer_sku_code: "sk:140", game_brand: "Free Fire", product_name: "140 Diamond", cost: 20000, sell_price: 20600 });
    seed({ buyer_sku_code: "sk:160", game_brand: "PUBG Mobile", product_name: "60 UC", supplier_active: 0, enabled: 1 });
    legacy();
    fx.sql.prepare("INSERT INTO games_nickname_checks(ref_id,slug,buyer_sku_code,cost,status,ip_hash,device_id,created_at) VALUES('NCK-fixture','mobile-legends','mlcekusername',24,'ok','hash','device',?)").run(Date.now());
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('games_sk_catalog_sync_at',?)").run(String(Date.UTC(2026, 10, 12, 3, 0, 0)));
    const { GET } = await import("@/app/api/admin/games/products/route");

    const data = await (await GET(await authedRequest("http://x/api/admin/games/products?limit=10"))).json();
    expect(data.total).toBe(3);
    expect(data.sync.counts).toEqual({ total: 3, enabled: 1, supplier_active: 2, seller_active: 2, with_reference: 1, contract_supported: 3, sellable: 0 });
    expect(data.sync.last_sync_at).toBe("2026-11-12T03:00:00.000Z");
    expect(data.brands).toEqual(["Free Fire", "Mobile Legends", "PUBG Mobile"]);
    expect(data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "ml86")).toBeUndefined();
    const wdp = data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "sk:101");
    expect(wdp).toMatchObject({ supplier: "sekalipay", sk_variant_id: 101, stock: 100, min_order: 1, contract_supported: true });
    expect(wdp.effectiveGroup).toBe("special");
    expect(wdp.margin).toMatchObject({ cost: 10000, sell: 19600, margin_rp: 9600, source: "reference" });
    expect(wdp.availability).toEqual({ available: false, reason: "admin_disabled" });
    const off = data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "sk:160");
    expect(off.availability).toEqual({ available: false, reason: "supplier_off" });
    expect(data.nickname_checks).toEqual({ today: { count: 1, cost: 24 }, week: { count: 1, cost: 24 } });

    const filtered = await (await GET(await authedRequest("http://x/api/admin/games/products?brand=free%20fire&q=140"))).json();
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].buyer_sku_code).toBe("sk:140");
    const enabled = await (await GET(await authedRequest("http://x/api/admin/games/products?enabled=1"))).json();
    expect(enabled.items.map((item: { buyer_sku_code: string }) => item.buyer_sku_code).sort()).toEqual(["sk:160"]);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?enabled=yes"))).status).toBe(400);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?limit=500"))).status).toBe(400);
  });

  it("counts sellable SKUs (admin+supplier aktif+stok) and supports sellable filter/sort", async () => {
    seed({ buyer_sku_code: "sk:201", enabled: 1, stock: 5, unlimited_stock: 0 });
    seed({ buyer_sku_code: "sk:202", enabled: 1, stock: 0, unlimited_stock: 1 });
    seed({ buyer_sku_code: "sk:203", enabled: 1, stock: 0, unlimited_stock: 0 });
    seed({ buyer_sku_code: "sk:204", enabled: 1, supplier_active: 0 });
    const { GET } = await import("@/app/api/admin/games/products/route");
    const data = await (await GET(await authedRequest("http://x/api/admin/games/products?limit=10&sort=sellable"))).json();
    expect(data.sync.counts.sellable).toBe(2);
    expect(data.items.slice(0, 2).map((item: { buyer_sku_code: string }) => item.buyer_sku_code).sort()).toEqual(["sk:201", "sk:202"]);
    expect(data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "sk:201")).toMatchObject({ sellable: true });
    expect(data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "sk:203")).toMatchObject({ sellable: false });

    const onlySellable = await (await GET(await authedRequest("http://x/api/admin/games/products?sellable=1"))).json();
    expect(onlySellable.total).toBe(2);
    expect(onlySellable.items.every((item: { sellable: boolean }) => item.sellable)).toBe(true);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?sellable=2"))).status).toBe(400);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?sort=price"))).status).toBe(400);
  });

  it("rejects unauthenticated GET/PATCH and non-SK mutations", async () => {
    seed();
    legacy();
    const { GET, PATCH } = await import("@/app/api/admin/games/products/route");
    expect((await GET(new NextRequest("http://x/api/admin/games/products"))).status).toBe(401);
    expect((await PATCH(new NextRequest("http://x/api/admin/games/products", { method: "PATCH", body: "{}" }))).status).toBe(401);
    const parked = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "ml86", enabled: false }));
    expect(parked.status).toBe(409);
    expect(await parked.json()).toMatchObject({ error: "legacy_parked" });
    expect(product("ml86").enabled).toBe(1);
  });

  it("validates PATCH strictly and returns 404 for unknown SKUs", async () => {
    seed();
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    const cases: unknown[] = [
      { buyer_sku_code: "sk:101" },
      { buyer_sku_code: "sk:101", reference_price: 0 },
      { buyer_sku_code: "sk:101", reference_price: 12.5 },
      { buyer_sku_code: "sk:101", display_group: "bogus" },
      { buyer_sku_code: "sk:101", display_order: -1 },
      { buyer_sku_code: "sk:101", enabled: "yes" },
      { buyer_sku_code: "sk:101", unknown_field: 1 },
      { buyer_sku_code: "" },
    ];
    for (const body of cases) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "nope", enabled: true }))).status).toBe(404);
  });

  it("refuses to enable an SK row without supplier/cost/contract; disabling still works", async () => {
    seed({ buyer_sku_code: "sk:201", supplier_active: 0 });
    seed({ buyer_sku_code: "sk:202", cost: 0 });
    seed({ buyer_sku_code: "sk:203", required_fields_json: "{}" });
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    for (const sku of ["sk:201", "sk:202", "sk:203"]) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: sku, enabled: true }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("not_sellable");
      expect(product(sku).enabled).toBe(0);
    }
    seed({ buyer_sku_code: "sk:204", enabled: 1, supplier_active: 0 });
    const off = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:204", enabled: false }));
    expect(off.status).toBe(200);
    expect(product("sk:204").enabled).toBe(0);
  });

  it("writes games_reference_prices, mirrors it, and recomputes sell_price (and clears both on null)", async () => {
    seed({ cost: 10000, sell_price: 10300 });
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    expect((await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", reference_price: 20000 }))).status).toBe(200);
    expect(reference("sk:101")).toMatchObject({ price: 20000, source: "admin" });
    expect(product("sk:101")).toMatchObject({ reference_price: 20000, sell_price: 19600, enabled: 0 });
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", reference_price: 15000 }));
    expect(product("sk:101")).toMatchObject({ reference_price: 15000, sell_price: 14700 });
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", reference_price: null }));
    expect(reference("sk:101")).toBeUndefined();
    expect(product("sk:101")).toMatchObject({ reference_price: null, sell_price: 10300 });
  });

  it("stores group/order overrides and the enabled flag for SK", async () => {
    seed();
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", display_group: "bestseller", display_order: 4, enabled: true }));
    expect(res.status).toBe(200);
    expect(product("sk:101")).toMatchObject({ display_group: "bestseller", display_order: 4, enabled: 1 });
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", display_group: null, display_order: null }));
    expect(product("sk:101")).toMatchObject({ display_group: null, display_order: null, enabled: 1 });
  });
});
