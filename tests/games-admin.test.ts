// tests/games-admin.test.ts — AXVARA Games admin (docs/GAMES.md §12.7 P1–P3):
// helper murni, daftar SKU, PATCH harga referensi/grup/enabled, aktivasi gelombang 1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  effectiveGroup, gamesMargin, isHealthyForWave, GAMES_WAVE1_BRANDS,
} from "@/lib/games/admin";

let fx: ReturnType<typeof createD1Fixture>;

function setAdminEnv() {
  process.env.ADMIN_EMAIL = "admin@axvara.tech";
  process.env.ADMIN_JWT_SECRET = "test-games-admin-secret-0123456789";
  process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
}

async function authedRequest(url: string, init?: RequestInit): Promise<NextRequest> {
  const auth = await import("@/lib/auth");
  const { token, sid } = await auth.createAdminToken("admin@axvara.tech");
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
  const row: Record<string, unknown> = {
    buyer_sku_code: "ml86", product_name: "86 Diamond", game_brand: "MOBILE LEGENDS", product_type: "Umum",
    cost: 10000, sell_price: 11000, seller_active: 1, enabled: 0, ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
};
const product = (sku: string) => fx.sql.prepare("SELECT * FROM games_products WHERE buyer_sku_code=?").get(sku) as Record<string, unknown>;
const reference = (sku: string) => fx.sql.prepare("SELECT * FROM games_reference_prices WHERE buyer_sku_code=?").get(sku) as Record<string, unknown> | undefined;

beforeEach(() => { fx = createD1Fixture(); setAdminEnv(); });
afterEach(() => { fx.close(); vi.unstubAllEnvs(); });

describe("games admin helpers", () => {
  it("exposes the four wave-1 brands and matches case-insensitively", () => {
    expect(GAMES_WAVE1_BRANDS).toEqual(["FREE FIRE", "Free Fire Max", "MOBILE LEGENDS", "PUBG MOBILE"]);
  });

  it("effectiveGroup prefers the admin override, then Membership/WDP/Twilight names", () => {
    expect(effectiveGroup({ display_group: "bestseller", product_name: "Weekly Diamond Pass" })).toBe("bestseller");
    expect(effectiveGroup({ display_group: null, product_type: "Membership", product_name: "X" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "Weekly Diamond Pass" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "WDP 55" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "Twilight Pass" })).toBe("special");
    expect(effectiveGroup({ product_type: "Umum", product_name: "86 Diamond" })).toBe("all");
    // Nilai tak dikenal dari DB tidak lolos sebagai grup; jatuh ke heuristik.
    expect(effectiveGroup({ display_group: "bogus", product_name: "86 Diamond" })).toBe("all");
  });

  it("gamesMargin reports floor/reference source, rupiah and percent margin", () => {
    const withReference = gamesMargin({ cost: 10000, sell_price: 19600, reference_price: 20000 });
    expect(withReference).toMatchObject({ cost: 10000, sell: 19600, floor: 10300, margin_rp: 9600, margin_pct: 96, source: "reference", competitive: true });
    const floorOnly = gamesMargin({ cost: 10000, sell_price: 10300, reference_price: null });
    expect(floorOnly).toMatchObject({ source: "floor", competitive: null, margin_rp: 300, margin_pct: 3 });
    // Referensi di bawah batas bawah → harga jual = batas bawah, tetap kompetitif.
    expect(gamesMargin({ cost: 10000, sell_price: 10300, reference_price: 10400 })).toMatchObject({ source: "floor", competitive: true });
  });

  it("isHealthyForWave requires an active seller, positive cost, floor price and no overshoot", () => {
    expect(isHealthyForWave({ cost: 10000, sell_price: 10300, seller_active: 1 })).toBe(true);
    expect(isHealthyForWave({ cost: 10000, sell_price: 10300, seller_active: 1, reference_price: 10300 })).toBe(true);
    expect(isHealthyForWave({ cost: 10000, sell_price: 10299, seller_active: 1 })).toBe(false);
    expect(isHealthyForWave({ cost: 10000, sell_price: 11000, seller_active: 0 })).toBe(false);
    expect(isHealthyForWave({ cost: 0, sell_price: 0, seller_active: 1 })).toBe(false);
    expect(isHealthyForWave({ cost: 10000, sell_price: 11000, seller_active: 1, reference_price: 10500 })).toBe(false);
  });
});

describe("admin games products API", () => {
  it("blocks username utilities in manual and bulk enable; includes today's nickname budget", async () => {
    seed({ buyer_sku_code: "mlcekusername", product_name: "Utility" });
    seed({ buyer_sku_code: "other-check", product_name: "Cek\tUsername" });
    fx.sql.prepare("INSERT INTO games_nickname_checks(ref_id,slug,buyer_sku_code,cost,status,ip_hash,device_id,created_at) VALUES('NCK-fixture','mobile-legends','mlcekusername',24,'ok','hash','device',?)").run(Date.now());
    const { GET, PATCH } = await import("@/app/api/admin/games/products/route");
    for (const sku of ["mlcekusername", "other-check"]) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: sku, enabled: true }));
      expect(res.status).toBe(409); expect((await res.json()).error).toBe("not_sellable");
    }
    const { enableGamesWave1 } = await import("@/lib/games/admin");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    expect(await enableGamesWave1(createDatabaseAccess())).toMatchObject({ eligible: 0, enabled_now: 0 });
    expect((await (await GET(await authedRequest("http://x/api/admin/games/products"))).json()).nickname_checks).toEqual({ today: { count: 1, cost: 24 }, week: { count: 1, cost: 24 } });
  });
  it("rejects unauthenticated GET, PATCH and enable-wave", async () => {
    const { GET, PATCH } = await import("@/app/api/admin/games/products/route");
    const wave = await import("@/app/api/admin/games/products/enable-wave/route");
    expect((await GET(new NextRequest("http://x/api/admin/games/products"))).status).toBe(401);
    expect((await PATCH(new NextRequest("http://x/api/admin/games/products", { method: "PATCH", body: "{}" }))).status).toBe(401);
    expect((await wave.POST(new NextRequest("http://x/api/admin/games/products/enable-wave", { method: "POST", body: "{}" }))).status).toBe(401);
  });

  it("lists SKUs with margin, effective group, counts and last sync", async () => {
    seed({ buyer_sku_code: "ml86", product_name: "Weekly Diamond Pass", product_type: "Membership", reference_price: 20000, sell_price: 19600 });
    seed({ buyer_sku_code: "ff140", game_brand: "FREE FIRE", product_name: "140 Diamond", cost: 20000, sell_price: 20600 });
    seed({ buyer_sku_code: "pubg60", game_brand: "PUBG MOBILE", product_name: "60 UC", enabled: 1 });
    fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('games_catalog_sync_at',?)").run(String(Date.UTC(2026, 10, 9, 3, 0, 0)));
    const { GET } = await import("@/app/api/admin/games/products/route");

    const res = await GET(await authedRequest("http://x/api/admin/games/products?limit=10"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(3);
    expect(data.sync.counts).toEqual({ total: 3, enabled: 1, seller_active: 3, with_reference: 1 });
    expect(data.sync.last_sync_at).toBe("2026-11-09T03:00:00.000Z");
    expect(data.brands).toEqual(["FREE FIRE", "MOBILE LEGENDS", "PUBG MOBILE"]);
    const wdp = data.items.find((item: { buyer_sku_code: string }) => item.buyer_sku_code === "ml86");
    expect(wdp.effectiveGroup).toBe("special");
    expect(wdp.margin).toMatchObject({ cost: 10000, sell: 19600, margin_rp: 9600, source: "reference" });

    const filtered = await (await GET(await authedRequest("http://x/api/admin/games/products?brand=free%20fire&q=140"))).json();
    expect(filtered.total).toBe(1);
    expect(filtered.items[0].buyer_sku_code).toBe("ff140");

    const enabled = await (await GET(await authedRequest("http://x/api/admin/games/products?enabled=1"))).json();
    expect(enabled.items.map((item: { buyer_sku_code: string }) => item.buyer_sku_code)).toEqual(["pubg60"]);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?enabled=yes"))).status).toBe(400);
    expect((await GET(await authedRequest("http://x/api/admin/games/products?limit=500"))).status).toBe(400);
    // UI mengirim filter kosong sebagai `enabled=` — harus dianggap "semua".
    expect((await (await GET(await authedRequest("http://x/api/admin/games/products?enabled=&brand=&q="))).json()).total).toBe(3);
  });

  it("validates PATCH strictly and returns 404 for unknown SKUs", async () => {
    seed();
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    const cases: unknown[] = [
      { buyer_sku_code: "ml86" },
      { buyer_sku_code: "ml86", reference_price: 0 },
      { buyer_sku_code: "ml86", reference_price: 12.5 },
      { buyer_sku_code: "ml86", display_group: "bogus" },
      { buyer_sku_code: "ml86", display_order: -1 },
      { buyer_sku_code: "ml86", enabled: "yes" },
      { buyer_sku_code: "ml86", unknown_field: 1 },
      { buyer_sku_code: "" },
    ];
    for (const body of cases) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const missing = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "nope", enabled: true }));
    expect(missing.status).toBe(404);
  });

  it("refuses to enable a SKU without an active seller or cost (409 not_sellable)", async () => {
    seed({ buyer_sku_code: "noseller", seller_active: 0 });
    seed({ buyer_sku_code: "nocost", cost: 0 });
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    for (const sku of ["noseller", "nocost"]) {
      const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: sku, enabled: true }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("not_sellable");
      expect(product(sku).enabled).toBe(0);
    }
    // Menonaktifkan tetap boleh meski tidak sellable.
    const off = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "noseller", enabled: false }));
    expect(off.status).toBe(200);
  });

  it("writes games_reference_prices, mirrors it, and recomputes sell_price (and clears both on null)", async () => {
    seed({ cost: 10000, sell_price: 10300 });
    const { PATCH } = await import("@/app/api/admin/games/products/route");

    const set = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "ml86", reference_price: 20000 }));
    expect(set.status).toBe(200);
    expect(reference("ml86")).toMatchObject({ price: 20000, source: "admin" });
    expect(String(reference("ml86")!.captured_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(product("ml86")).toMatchObject({ reference_price: 20000, sell_price: 19600, enabled: 0 });

    // Menurunkan harga Oura mengubah sell_price mengikuti −2% (di atas batas bawah).
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "ml86", reference_price: 15000 }));
    expect(reference("ml86")).toMatchObject({ price: 15000 });
    expect(product("ml86")).toMatchObject({ reference_price: 15000, sell_price: 14700 });

    const clear = await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "ml86", reference_price: null }));
    expect(clear.status).toBe(200);
    expect(reference("ml86")).toBeUndefined();
    expect(product("ml86")).toMatchObject({ reference_price: null, sell_price: 10300 });
  });

  it("stores group/order overrides and the enabled flag", async () => {
    seed();
    const { PATCH } = await import("@/app/api/admin/games/products/route");
    const res = await PATCH(await json("http://x/api/admin/games/products", "PATCH", {
      buyer_sku_code: "ml86", display_group: "bestseller", display_order: 4, enabled: true,
    }));
    expect(res.status).toBe(200);
    expect(product("ml86")).toMatchObject({ display_group: "bestseller", display_order: 4, enabled: 1 });
    await PATCH(await json("http://x/api/admin/games/products", "PATCH", { buyer_sku_code: "ml86", display_group: null, display_order: null }));
    expect(product("ml86")).toMatchObject({ display_group: null, display_order: null, enabled: 1 });
  });
});

describe("enable-wave", () => {
  const wave = () => import("@/app/api/admin/games/products/enable-wave/route");

  beforeEach(() => {
    seed({ buyer_sku_code: "ff140", game_brand: "FREE FIRE", sell_price: 11000 });
    seed({ buyer_sku_code: "ffmax1", game_brand: "FREE FIRE MAX", sell_price: 10000 }); // di bawah batas bawah
    seed({ buyer_sku_code: "ml86", game_brand: "MOBILE LEGENDS", sell_price: 10500, reference_price: 10400 }); // di atas Oura
    seed({ buyer_sku_code: "pubg60", game_brand: "PUBG MOBILE", sell_price: 11000, enabled: 1 });
    seed({ buyer_sku_code: "codm1", game_brand: "CODM", sell_price: 11000 });
  });

  it("dry run reports eligible/unhealthy counts without writing", async () => {
    const { POST } = await wave();
    const res = await POST(await json("http://x/api/admin/games/products/enable-wave", "POST", { dry_run: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: true, eligible: 1, enabled_now: 0, skipped_unhealthy: 2 });
    expect(product("ff140").enabled).toBe(0);
    expect(product("codm1").enabled).toBe(0);
  });

  it("enables only healthy wave-1 SKUs and never disables anything", async () => {
    const { POST } = await wave();
    const first = await POST(await json("http://x/api/admin/games/products/enable-wave", "POST", {}));
    expect(await first.json()).toMatchObject({ dry_run: false, eligible: 1, enabled_now: 1 });
    expect(product("ff140").enabled).toBe(1);
    expect(product("ffmax1").enabled).toBe(0);
    expect(product("ml86").enabled).toBe(0);
    expect(product("pubg60").enabled).toBe(1);
    expect(product("codm1").enabled).toBe(0);

    const second = await POST(await json("http://x/api/admin/games/products/enable-wave", "POST", {}));
    expect(await second.json()).toMatchObject({ eligible: 0, enabled_now: 0 });
    expect(product("pubg60").enabled).toBe(1);
    expect(product("ff140").enabled).toBe(1);
  });

  it("enables more than 100 healthy SKUs within D1's 100 bound-parameter limit", async () => {
    for (let i = 0; i < 150; i++) seed({ buyer_sku_code: `ml${1000 + i}`, game_brand: "MOBILE LEGENDS", sell_price: 11000 });
    const { enableGamesWave1 } = await import("@/lib/games/admin");
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const real = createDatabaseAccess();
    // Production D1 rejects any statement binding more than 100 parameters.
    const limited = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (args.length - 1 > 100) throw new Error("D1_ERROR: too many SQL variables");
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const result = await enableGamesWave1(limited);
    expect(result).toMatchObject({ eligible: 151, enabled_now: 151 });
    expect(product("ml1149").enabled).toBe(1);
    expect(product("ffmax1").enabled).toBe(0);
  });

  it("rejects a non-boolean dry_run", async () => {
    const { POST } = await wave();
    expect((await POST(await json("http://x/api/admin/games/products/enable-wave", "POST", { dry_run: "yes" }))).status).toBe(400);
  });
});
