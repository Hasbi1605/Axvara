import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import {
  GAMES_SK_CATALOG_STATEMENT_BUDGET,
  syncGamesSkCatalog,
  type GamesSkCatalogSyncResult,
} from "@/lib/games/sk-catalog-sync";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";
import {
  gamesSkRowPurchasable,
  parseGamesSkContract,
} from "@/lib/games/registry";
import { createD1Fixture } from "./helpers/d1-fixture";

type Variant = Record<string, unknown>;
type Product = { id: number; name: string; image?: string | null; variants: Variant[] };

const variant = (id: number, over: Variant = {}): Variant => ({
  id,
  sku: `VAR${id}`,
  name: `${id} Diamond`,
  price: 10000.4,
  stock: 100,
  order_process: "h2h",
  h2h_provider: "h2h",
  provider_meta: null,
  required_fields: [{ key: "note", label: "User ID :", required: true }],
  validation: { available: false, requires_zone_id: false, fields: [] },
  updated_at: null,
  min_order: 1,
  status: "on",
  description: "Instant delivery. Region ID only.",
  product_type: null,
  ...over,
});

const product = (id: number, name: string, variants: Variant[], over: Record<string, unknown> = {}): Product => ({
  id,
  name,
  image: `https://sekalipay.com/images/products/p${id}.png`,
  variants,
  ...over,
});

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "test-key");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "");
  vi.stubEnv("GAMES_DEV_FIXTURE", "");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const okResult = (value: GamesSkCatalogSyncResult): Extract<GamesSkCatalogSyncResult, { ok: true }> => {
  if (!("ok" in value) || value.ok !== true) throw new Error(`expected ok, got ${JSON.stringify(value)}`);
  return value;
};

const db = () => createDatabaseAccess(fx.db);
const row = (sku: string) => fx.sql.prepare("SELECT * FROM games_products WHERE buyer_sku_code=?").get(sku) as Record<string, unknown> | undefined;
const setting = () => fx.sql.prepare("SELECT value FROM store_settings WHERE key='games_sk_catalog_sync_at'").get() as { value?: string } | undefined;
const T0 = Date.UTC(2026, 10, 12, 10, 0, 0);

const catalogResponse = (products: Product[], meta: Record<string, unknown> = {}) => {
  const total = products.reduce((sum, p) => sum + p.variants.length, 0);
  return new Response(JSON.stringify({
    message: "ok",
    data: [{ id: 3, name: "Game", icon: null, products }],
    meta: { total_items: total, is_delta: false, ...meta },
    server_time: "2026-11-12T10:00:00Z",
  }), { status: 200 });
};
const stubCatalog = (products: Product[], meta: Record<string, unknown> = {}) => {
  const f = vi.fn(async () => catalogResponse(products, meta));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("syncGamesSkCatalog", () => {
  it("is a no-op without the SK gate or transport and never touches settings", async () => {
    vi.stubEnv("SEKALIPAY_ENABLED", "");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await syncGamesSkCatalog(db(), { now: T0 })).toEqual({ skipped: "not_configured" });
    expect(f).not.toHaveBeenCalled();

    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_API_KEY", "");
    expect(await syncGamesSkCatalog(db(), { now: T0 })).toEqual({ skipped: "not_configured" });
    expect(f).not.toHaveBeenCalled();
    expect(setting()).toBeUndefined();
  });

  it("imports every Game variant with supplier, stable slug, ceil cost and enabled-by-default", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(101),
        variant(102, {
          required_fields: [
            { key: "note", label: "User ID", required: true },
            { key: "zone_id", label: "Zone ID", required: true },
          ],
          validation: { available: true, requires_zone_id: true, fields: [] },
        }),
        variant(103, { status: "off", price: 5000 }),
      ], { image: "https://sekalipay.com/images/products/ML.png" }),
      product(34, "Free Fire", [variant(201, { stock: 0, product_type: { id: 9, name: "Membership" } })], {
        image: "https://evil.example/x.png",
      }),
    ]);
    const result = await syncGamesSkCatalog(db(), { now: T0 });
    expect(result).toMatchObject({ ok: true, products: 2, variants: 4, upserted: 4, deactivated: 0, unsupported: 0 });
    const ok = okResult(result);

    const ml = row("sk:101")!;
    expect(ml).toMatchObject({
      supplier: "sekalipay", supplier_active: 1, sk_variant_id: 101, sk_sku: "VAR101",
      sk_product_id: 33, sk_product_name: "Mobile Legends", game_slug: "mobile-legends",
      game_brand: "Mobile Legends", product_name: "101 Diamond", cost: 10001,
      stock: 100, min_order: 1, enabled: 1, reference_price: null,
      image_url: "https://sekalipay.com/images/products/ML.png",
      description: "Instant delivery. Region ID only.",
    });
    expect(Number(ml.sell_price)).toBe(Math.ceil(10001 * 1.03));
    const contract = parseGamesSkContract(ml.required_fields_json);
    expect(contract).toMatchObject({ supported: true, requires_zone_id: false, open_denom: false });
    expect(contract!.fields).toEqual([{ key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 }]);
    expect(gamesSkRowPurchasable(ml)).toBe(true);

    const zoned = parseGamesSkContract(row("sk:102")!.required_fields_json);
    expect(zoned).toMatchObject({ supported: true, requires_zone_id: true, validation_available: true });
    expect(zoned!.fields.map((field) => field.key)).toEqual(["note", "zone_id"]);

    // off + stock0 tetap diimpor, tampil (enabled=1), tetapi tidak bisa dibeli.
    expect(row("sk:103")).toMatchObject({ supplier_active: 0, enabled: 1 });
    expect(gamesSkRowPurchasable(row("sk:103")!)).toBe(false);
    expect(row("sk:201")).toMatchObject({ supplier_active: 1, stock: 0, enabled: 1, game_slug: "free-fire", product_type_name: "Membership" });
    expect(gamesSkRowPurchasable(row("sk:201")!)).toBe(false);
    // URL gambar non-allowlist tidak disimpan.
    expect(row("sk:201")!.image_url).toBeNull();
    expect(ok.statements).toBeLessThanOrEqual(GAMES_SK_CATALOG_STATEMENT_BUDGET);
  });

  it("excludes supplier utility variants from the sale catalog", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(101),
        variant(102, { name: "Cek Username Server", required_fields: null }),
      ]),
    ]);
    const result = await syncGamesSkCatalog(db(), { now: T0 });
    expect(result).toMatchObject({ ok: true, variants: 2, upserted: 1 });
    expect(row("sk:101")).toBeTruthy();
    expect(row("sk:102")).toBeUndefined();
  });

  it("reuses computeGamesSellPrice with the admin reference for sk:<variant>", async () => {
    fx.sql.exec("INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES('sk:101',20000,'admin','2026-11-12T00:00:00Z','2026-11-12T00:00:00Z')");
    stubCatalog([product(33, "Mobile Legends", [variant(101, { price: 15000 })])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    expect(row("sk:101")).toMatchObject({ cost: 15000, reference_price: 20000, sell_price: 19600 });
  });

  it("preserves an admin-disabled enabled flag and never touches legacy Digiflazz rows", async () => {
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,cost,seller_active,enabled,game_brand,sell_price)
      VALUES('sk:101','old SKU',1,1,0,'Mobile Legends',5)`);
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,cost,seller_active,enabled,game_brand,sell_price)
      VALUES('ml86','legacy',15000,1,1,'MOBILE LEGENDS',20000)`);
    stubCatalog([product(33, "Mobile Legends", [variant(101)])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    expect(row("sk:101")).toMatchObject({ enabled: 0, supplier: "sekalipay", cost: 10001, sk_variant_id: 101 });
    expect(row("ml86")).toMatchObject({ supplier: "digiflazz", supplier_active: 0, enabled: 1, cost: 15000, sell_price: 20000 });
  });

  it("never publishes or deactivates on an incomplete, delta, empty, or malformed catalog", async () => {
    stubCatalog([product(33, "Mobile Legends", [variant(101), variant(102)])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    const before = fx.sql.prepare("SELECT COUNT(*) c FROM games_products").get();
    const lastSetting = setting()!.value;

    const cases: [string, unknown][] = [
      ["count mismatch", stubCatalog([product(33, "Mobile Legends", [variant(101)])], { total_items: 2 })],
      ["delta", stubCatalog([product(33, "Mobile Legends", [variant(101), variant(102)])], { is_delta: true })],
      ["empty", vi.fn(async () => catalogResponse([], { total_items: 0 }))],
      ["malformed", vi.fn(async () => new Response(JSON.stringify({ message: "ok", data: [{ name: "Pulsa", products: [] }], meta: { total_items: 1, is_delta: false } }), { status: 200 }))],
      ["fetch 502", vi.fn(async () => new Response("", { status: 502 }))],
      ["duplicate variant", stubCatalog([product(33, "Mobile Legends", [variant(101), variant(101)])])],
    ];
    for (const [name, fetcher] of cases) {
      vi.stubGlobal("fetch", fetcher as unknown as typeof fetch);
      const result = await syncGamesSkCatalog(db(), { now: T0 + 60 * 60_000, force: true });
      expect(result, name).toMatchObject({ ok: false });
      expect(fx.sql.prepare("SELECT COUNT(*) c FROM games_products").get(), name).toEqual(before);
      expect(row("sk:101"), name).toMatchObject({ supplier_active: 1 });
      expect(row("sk:102"), name).toMatchObject({ supplier_active: 1 });
      expect(setting()!.value, name).toBe(lastSetting);
    }
  });

  it("deactivates missing variants only after a complete run", async () => {
    stubCatalog([product(33, "Mobile Legends", [variant(101), variant(102)])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    expect(row("sk:102")).toMatchObject({ supplier_active: 1 });
    stubCatalog([product(33, "Mobile Legends", [variant(101)])]);
    const result = await syncGamesSkCatalog(db(), { now: T0 + 10 * 60_000 });
    expect(result).toMatchObject({ ok: true, deactivated: 1 });
    expect(row("sk:101")).toMatchObject({ supplier_active: 1 });
    expect(row("sk:102")).toMatchObject({ supplier_active: 0 });
  });

  it("admits the whole snapshot before writing and refuses an over-budget run", async () => {
    const tooMany = Array.from({ length: 6000 }, (_, i) => variant(10_000 + i));
    stubCatalog([product(33, "Mobile Legends", tooMany)]);
    fx.control.queries = 0;
    const refused = await syncGamesSkCatalog(db(), { now: T0 });
    expect(refused).toMatchObject({ ok: false, error: "budget_exceeded", budget: 40 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM games_products").get()).toEqual({ c: 0 });
    expect(setting()).toBeUndefined();
    expect(fx.control.queries).toBeLessThanOrEqual(3);

    // 1.619 varian (snapshot nyata) tetap muat dalam budget.
    vi.unstubAllGlobals();
    const full = Array.from({ length: 1619 }, (_, i) => variant(20_000 + i));
    stubCatalog([product(33, "Mobile Legends", full)]);
    fx.control.queries = 0;
    const ok = await syncGamesSkCatalog(db(), { now: T0 });
    expect(ok).toMatchObject({ ok: true, variants: 1619, upserted: 1619 });
    expect(fx.control.queries).toBeLessThanOrEqual(GAMES_SK_CATALOG_STATEMENT_BUDGET);
  });

  it("fits the real cron budget including statements consumed before admission", async () => {
    const full = Array.from({ length: 1619 }, (_, i) => variant(30_000 + i));
    stubCatalog([product(33, "Mobile Legends", full)]);
    const budget = createBudgetedDatabase(40, 2, fx.db);
    // Cron lite sudah memakai beberapa statement sebelum job katalog.
    await budget.access.queryFirst("SELECT 1 AS n");
    await budget.access.queryFirst("SELECT 2 AS n");
    await budget.access.queryFirst("SELECT 3 AS n");
    const result = await syncGamesSkCatalog(budget.access, { now: T0 });
    expect(result).toMatchObject({ ok: true, variants: 1619 });
    expect(budget.used).toBeLessThanOrEqual(38);
  });

  it("preserves SK stock -1 as unlimited and rejects other negative/malformed stock", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(101, { stock: -1 }),
        variant(102, { stock: 0 }),
        variant(103, { stock: -2 }),
        variant(104, { stock: "abc" as unknown as number }),
      ]),
    ]);
    await syncGamesSkCatalog(db(), { now: T0 });
    expect(row("sk:101")!.stock).toBe(-1);
    expect(gamesSkRowPurchasable(row("sk:101")!)).toBe(true);
    for (const sku of ["sk:102", "sk:103", "sk:104"]) {
      expect(Number(row(sku)!.stock)).toBe(0);
      expect(gamesSkRowPurchasable(row(sku)!)).toBe(false);
    }
    const detail = await getGamesDetail("mobile-legends");
    expect(detail!.products.find((p) => p.buyer_sku_code === "sk:101")).toMatchObject({ available: true, availability_reason: null });
    expect(detail!.products.find((p) => p.buyer_sku_code === "sk:103")).toMatchObject({ available: false, availability_reason: "stock_empty" });
  });

  it("treats a malformed min_order as an unsupported contract, not a guessed 1", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(101, { min_order: 0 }),
        variant(102, { min_order: "abc" as unknown as number }),
        variant(103, { min_order: undefined }),
      ]),
    ]);
    const result = await syncGamesSkCatalog(db(), { now: T0 });
    expect(result).toMatchObject({ ok: true, unsupported: 2 });
    expect(parseGamesSkContract(row("sk:101")!.required_fields_json)).toMatchObject({ supported: false, reason: "invalid_min_order" });
    expect(Number(row("sk:101")!.min_order)).toBeGreaterThan(1);
    expect(parseGamesSkContract(row("sk:102")!.required_fields_json)).toMatchObject({ supported: false, reason: "invalid_min_order" });
    expect(parseGamesSkContract(row("sk:103")!.required_fields_json)).toMatchObject({ supported: true });
    expect(gamesSkRowPurchasable(row("sk:101")!)).toBe(false);
    expect(gamesSkRowPurchasable(row("sk:103")!)).toBe(true);
  });

  it("keeps slugs stable across syncs and de-duplicates collisions", async () => {
    stubCatalog([product(10, "Test Game", [variant(1)]), product(11, "Test Game", [variant(2)])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    expect(row("sk:1")!.game_slug).toBe("test-game");
    expect(row("sk:2")!.game_slug).toBe("test-game-2");
    stubCatalog([product(10, "Renamed Game", [variant(1)]), product(11, "Test Game", [variant(2)])]);
    await syncGamesSkCatalog(db(), { now: T0 + 10 * 60_000 });
    expect(row("sk:1")!.game_slug).toBe("test-game");
    expect(row("sk:2")!.game_slug).toBe("test-game-2");
  });

  it("throttles, honours force, and loses the write claim CAS to a concurrent isolate", async () => {
    const f = stubCatalog([product(33, "Mobile Legends", [variant(101)])]);
    expect(await syncGamesSkCatalog(db(), { now: T0 })).toMatchObject({ ok: true });
    expect(await syncGamesSkCatalog(db(), { now: T0 + 5 * 60_000 })).toEqual({ skipped: "throttled" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await syncGamesSkCatalog(db(), { now: T0 + 5 * 60_000, force: true })).toMatchObject({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);

    const stale = createDatabaseAccess(fx.db);
    const realFirst = stale.queryFirst;
    let first = true;
    stale.queryFirst = async (q, ...p) => {
      const out = await realFirst(q, ...p);
      if (first && q.includes("store_settings")) {
        first = false;
        fx.sql.prepare("UPDATE store_settings SET value='999' WHERE key='games_sk_catalog_sync_at'").run();
      }
      return out;
    };
    expect(await syncGamesSkCatalog(stale, { now: T0 + 60 * 60_000, force: true })).toEqual({ skipped: "claimed_elsewhere" });
  });

  it("does not consume the throttle window when a run fails before claiming", async () => {
    stubCatalog([product(33, "Mobile Legends", [variant(101)])]);
    await syncGamesSkCatalog(db(), { now: T0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    expect(await syncGamesSkCatalog(db(), { now: T0 + 10 * 60_000 })).toMatchObject({ ok: false, error: "fetch_failed" });
    stubCatalog([product(33, "Mobile Legends", [variant(101)])]);
    expect(await syncGamesSkCatalog(db(), { now: T0 + 10 * 60_000 + 30_000 })).toMatchObject({ ok: true });
  });
});

describe("DB-driven Games catalog resolution", () => {
  it("lists all Sekalipay Game products at once and keeps the four legacy slugs", async () => {
    const names = [
      "State Of Survival", "Aniimo", "Rainbow Six Mobile", "Point Blank", "Lineage2m", "Machina Waking",
      "Haikyu Fly High", "Gangstar Mirage City", "Crossfire Legends", "Pubg Mobile", "AU2 Mobile", "Free Fire",
      "Free Fire Max", "Mobile Legends", "Super Sus", "Ragnarok M Eternal Love", "Magic Chess Go Go",
      "Mobile Legends Adventure", "Football Master 2", "MU Origin 2", "Garena Undawn", "Onmyoji Arena",
      "Zenless Zone Zero", "Sausage Man", "LifeAfter", "Identity V", "One Punch Man", "League Of Legends Wild Rift",
      "Laplace M", "Captain Tsubasa Ace", "Speed Drifters", "Roblox", "Heartopia", "Blood Strike", "Honkai Star Rail",
      "Genshin Impact", "Where Winds Meet", "Call Of Duty Mobile", "Delta Force", "Valorant", "Zepeto",
      "Arena Breakout", "Marvel Rivals", "Arena Of Valor", "Growtopia", "Honor Of Kings", "FC Mobile",
    ];
    let id = 1000;
    const products = names.map((name) => product(++id, name, [variant(id * 10)]));
    stubCatalog(products);
    const result = await syncGamesSkCatalog(db(), { now: T0 });
    expect(result).toMatchObject({ ok: true, products: 47, variants: 47 });

    const catalog = await getGamesCatalog();
    expect(catalog).toHaveLength(47);
    expect(catalog.map((game) => game.slug)).toEqual(expect.arrayContaining([
      "free-fire", "free-fire-max", "mobile-legends", "pubg-mobile",
    ]));
    for (const game of catalog) {
      expect(game.icon === null || String(game.icon).startsWith("https://sekalipay.com/images/products/") || String(game.icon).startsWith("/brand/games/")).toBe(true);
    }
  });

  it("resolves dynamic detail per variant with availability and text-capable fields", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(101),
        variant(102, {
          required_fields: [{ key: "note", label: "Riot ID", required: true }],
          status: "off",
        }),
      ]),
      product(46, "Pubg Mobile", [variant(501, { price: 25000 })]),
    ]);
    await syncGamesSkCatalog(db(), { now: T0 });

    const detail = await getGamesDetail("mobile-legends");
    expect(detail).not.toBeNull();
    expect(detail!.game).toMatchObject({ slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", currency: "diamond" });
    expect(detail!.products).toHaveLength(2);
    const first = detail!.products[0];
    expect(first).toMatchObject({
      buyer_sku_code: "sk:101", available: true,
      description: "Instant delivery. Region ID only.",
    });
    expect(first.fields).toHaveLength(1);
    expect(first.fields![0]).toMatchObject({ key: "note", input: "text", max: 50 });
    expect(detail!.products[1]).toMatchObject({ available: false, unsupported_reason: null });

    // Game non-registry tetap resolve tanpa metadata kurasi.
    expect(await getGamesDetail("unknown-game")).toBeNull();
  });

  it("marks unsupported, min_order>1, and open-denom variants unpurchasable", async () => {
    stubCatalog([
      product(33, "Mobile Legends", [
        variant(201, { provider_meta: { open_denom: true } }),
        variant(202, { min_order: 2 }),
        variant(203, { required_fields: [{ key: "note", label: "ID", required: true }, { key: "server", label: "Server", required: true }] }),
        variant(204, { required_fields: [{ key: "note", label: "Riot #tag", required: true }] }),
      ]),
    ]);
    const result = await syncGamesSkCatalog(db(), { now: T0 });
    expect(result).toMatchObject({ ok: true, unsupported: 2 });
    expect(parseGamesSkContract(row("sk:201")!.required_fields_json)).toMatchObject({ supported: false, open_denom: true, reason: "open_denom" });
    expect(parseGamesSkContract(row("sk:203")!.required_fields_json)).toMatchObject({ supported: false, reason: "unknown_field" });
    expect(gamesSkRowPurchasable(row("sk:202")!)).toBe(false);
    expect(gamesSkRowPurchasable(row("sk:204")!)).toBe(true);
    expect(parseGamesSkContract(row("sk:204")!.required_fields_json)!.fields[0]).toEqual({
      key: "note", label: "Riot #tag", required: true, input: "text", min: 1, max: 50,
    });

    const detail = await getGamesDetail("mobile-legends");
    expect(detail!.products.map((entry) => entry.available)).toEqual([false, false, false, true]);
  });
});
