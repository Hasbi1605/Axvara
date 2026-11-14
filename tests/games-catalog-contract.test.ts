import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";
import { cleanGamesFieldLabel } from "@/lib/games/variant-kind";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); });

const contract = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 1,
  fields: [{ key: "note", label: "User ID :", required: true, input: "text", min: 1, max: 50 }],
  requires_zone_id: false,
  validation_available: false,
  open_denom: false,
  supported: true,
  reason: null,
  ...over,
});

let nextId = 1;
function seed(over: Record<string, unknown> = {}) {
  const variantId = Number(over.sk_variant_id ?? nextId++);
  const row: Record<string, unknown> = {
    buyer_sku_code: `sk:${variantId}`,
    product_name: "5 Diamond",
    game_slug: "mobile-legends",
    sk_product_id: 33,
    sk_product_name: "Mobile Legends",
    sk_variant_id: variantId,
    supplier: "sekalipay",
    supplier_active: 1,
    enabled: 1,
    stock: 100,
    min_order: 1,
    cost: 11750,
    sell_price: 12400,
    required_fields_json: contract(),
    product_type_name: "Indonesia",
    ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

function meta(slug: string, over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { slug, hidden: 0, ...over };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_meta(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

describe("katalog publik: overlay games_meta", () => {
  it("meta menang atas registry, registry menang atas produk SK", async () => {
    // Tanpa overlay: registry empat game legacy dipakai.
    seed({ sk_product_id: 33, sk_product_name: "Mobile Legends" });
    let catalog = await getGamesCatalog();
    expect(catalog[0]).toMatchObject({ slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton" });

    meta("mobile-legends", {
      display_name: "MLBB", publisher: "Moonton ID", icon_url: "/r2/products/ml.webp",
      banner_url: "https://cdn.example/banner.webp",
    });
    catalog = await getGamesCatalog();
    expect(catalog[0]).toMatchObject({
      name: "MLBB", publisher: "Moonton ID", icon: "/r2/products/ml.webp", banner: "https://cdn.example/banner.webp",
    });
  });

  it("game tanpa registry memakai nama supplier, lalu overlay admin", async () => {
    seed({ sk_product_id: 77, sk_product_name: "Ragnarok M", game_slug: "ragnarok-m", sk_variant_id: 901 });
    expect((await getGamesCatalog())[0]).toMatchObject({ slug: "ragnarok-m", name: "Ragnarok M", publisher: "" });
    meta("ragnarok-m", { display_name: "Ragnarok", publisher: "Gravity" });
    expect((await getGamesCatalog())[0]).toMatchObject({ name: "Ragnarok", publisher: "Gravity" });
  });

  it("detail membawa description + id_guide dari meta", async () => {
    seed();
    expect((await getGamesDetail("mobile-legends"))!.game).toMatchObject({ description: "", id_guide: "" });
    meta("mobile-legends", { description: "Top up ML cepat.", id_guide: "Buka profil → salin User ID." });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.game).toMatchObject({
      description: "Top up ML cepat.", id_guide: "Buka profil → salin User ID.",
    });
  });
});

describe("katalog publik: game tersembunyi", () => {
  it("hidden=1 hilang dari list dan detail 404", async () => {
    seed({ sk_product_id: 33, sk_variant_id: 1 });
    seed({ sk_product_id: 44, sk_product_name: "Free Fire", game_slug: "free-fire", sk_variant_id: 2 });
    meta("free-fire", { hidden: 1 });
    const catalog = await getGamesCatalog();
    expect(catalog.map((game) => game.slug)).toEqual(["mobile-legends"]);
    expect(await getGamesDetail("free-fire")).toBeNull();
    expect((await getGamesDetail("mobile-legends"))?.products).toHaveLength(1);
  });

  it("hidden=0 tetap tampil dan detailnya ada", async () => {
    seed();
    meta("mobile-legends", { hidden: 0 });
    expect((await getGamesCatalog()).map((game) => game.slug)).toEqual(["mobile-legends"]);
    expect(await getGamesDetail("mobile-legends")).not.toBeNull();
  });
});

describe("katalog publik: min_price hanya varian yang bisa dijual", () => {
  it("min_price null saat tidak ada varian bisa dijual", async () => {
    seed({ sk_variant_id: 10, supplier_active: 0, sell_price: 12000 });
    seed({ sk_variant_id: 11, stock: 0, sell_price: 11000 });
    seed({ sk_variant_id: 13, cost: 0, sell_price: 9000 });
    // Admin-disabled tidak masuk katalog publik sama sekali.
    seed({ sk_variant_id: 12, enabled: 0, sell_price: 10000 });
    const [game] = await getGamesCatalog();
    expect(game).toMatchObject({ slug: "mobile-legends", min_price: null, sellable_count: 0, sku_count: 3 });
  });

  it("min_price = harga terendah varian bisa dijual, bukan harga termurah keseluruhan", async () => {
    seed({ sk_variant_id: 20, sell_price: 12400 });
    seed({ sk_variant_id: 21, sell_price: 337200 });
    // Lebih murah, tetapi supplier off → tidak dihitung.
    seed({ sk_variant_id: 22, sell_price: 5000, supplier_active: 0 });
    const [game] = await getGamesCatalog();
    expect(game).toMatchObject({ min_price: 12400, sellable_count: 2, sku_count: 3 });
  });

  it("stok -1 (tak terbatas) dianggap bisa dijual", async () => {
    seed({ sk_variant_id: 30, stock: -1, sell_price: 12400 });
    expect((await getGamesCatalog())[0]).toMatchObject({ min_price: 12400, sellable_count: 1 });
  });
});

describe("katalog publik: urutan list", () => {
  it("bisa dijual dulu → featured_rank asc (null terakhir) → registry → nama", async () => {
    const mk = (slug: string, name: string, rank: number | null, sellable: boolean, id: number) => {
      seed({ sk_variant_id: id, game_slug: slug, sk_product_name: name, sk_product_id: id, supplier_active: sellable ? 1 : 0 });
      if (rank !== null) meta(slug, { featured_rank: rank });
    };
    // Unsellable dengan rank 1 tetap di bawah semua yang sellable.
    mk("aaa-unsellable", "AAA", 1, false, 100);
    mk("zeta", "Zeta", null, true, 101);
    mk("alpha", "Alpha", 5, true, 102);
    mk("beta", "Beta", 2, true, 103);
    mk("gamma", "Gamma", null, true, 104);
    mk("mobile-legends", "Mobile Legends", null, true, 105);
    mk("free-fire", "Free Fire", null, true, 106);

    expect((await getGamesCatalog()).map((game) => game.slug)).toEqual([
      // rank 2, 5, lalu null: urutan registry (free-fire sebelum mobile-legends),
      // kemudian nama untuk slug lain.
      "beta", "alpha", "free-fire", "mobile-legends", "gamma", "zeta", "aaa-unsellable",
    ]);
    const catalog = await getGamesCatalog();
    expect(catalog.find((game) => game.slug === "beta")).toMatchObject({ featured_rank: 2, sellable_count: 1 });
    expect(catalog.find((game) => game.slug === "gamma")).toMatchObject({ featured_rank: null });
  });
});

describe("detail per varian: label, region, kategori", () => {
  it("memakai nama fixture nyata dan aturan B6", async () => {
    seed({ sk_variant_id: 1, product_name: "Mobilelegend - 5 Diamond", product_type_name: "" , sell_price: 12400 });
    seed({ sk_variant_id: 2, product_name: "5 Diamonds (filipina)", product_type_name: "Filipina" });
    seed({ sk_variant_id: 3, product_name: "Weekly Diamond Pass 2x (indonesia)", product_type_name: "Indonesia" });
    seed({ sk_variant_id: 4, product_name: "First Top Up 50+5 Diamonds (brazil)", product_type_name: "Brazil" });
    seed({ sk_variant_id: 5, product_name: "Roblox Gift Card (US) $10", product_type_name: "DIGITAL", game_slug: "roblox", sk_product_name: "Roblox", sk_product_id: 99 });
    seed({ sk_variant_id: 6, product_name: "Twilight Pass (global)", product_type_name: "Global" });

    const detail = (await getGamesDetail("mobile-legends"))!;
    const byName = new Map(detail.products.map((product) => [product.name, product]));
    expect(byName.get("Mobilelegend - 5 Diamond")).toMatchObject({ type_label: null, region_code: null, category: "topup" });
    expect(byName.get("5 Diamonds (filipina)")).toMatchObject({ type_label: "Filipina", region_code: "PH", category: "topup" });
    expect(byName.get("Weekly Diamond Pass 2x (indonesia)")).toMatchObject({ type_label: "Indonesia", region_code: "ID", category: "pass" });
    expect(byName.get("First Top Up 50+5 Diamonds (brazil)")).toMatchObject({ type_label: "Brasil", region_code: "BR", category: "first_topup" });
    expect(byName.get("Twilight Pass (global)")).toMatchObject({ type_label: "Global", region_code: "GLOBAL", category: "pass" });

    const roblox = (await getGamesDetail("roblox"))!;
    expect(roblox.products[0]).toMatchObject({ type_label: null, region_code: null, category: "other" });
  });

  it("override display_group menang atas aturan otomatis", async () => {
    seed({ sk_variant_id: 1, product_name: "Mobilelegend - 5 Diamond", display_group: "bestseller" });
    seed({ sk_variant_id: 2, product_name: "Weekly Diamond Pass", display_group: "promo" });
    seed({ sk_variant_id: 3, product_name: "Roblox Gift Card", display_group: "special" });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.products.map((product) => product.category)).toEqual(["bestseller", "promo", "special"]);
    // Grup legacy tetap tersedia untuk kompatibilitas UI lama.
    expect(detail.products.map((product) => product.group)).toEqual(["bestseller", "special", "special"]);
  });

  it("label field dibersihkan dan validation_available mengikuti kontrak", async () => {
    seed({ sk_variant_id: 1, product_name: "86 Diamond", required_fields_json: contract({ validation_available: true }) });
    seed({ sk_variant_id: 2, product_name: "172 Diamond" });
    const detail = (await getGamesDetail("mobile-legends"))!;
    const [withCheck, withoutCheck] = detail.products;
    expect(withCheck.fields?.[0].label).toBe("User ID");
    expect(cleanGamesFieldLabel("User ID :")).toBe("User ID");
    expect(withCheck.validation_available).toBe(true);
    expect(withoutCheck.validation_available).toBe(false);
  });

  it("detail hanya baris Sekalipay (legacy Digiflazz tidak dirender)", async () => {
    seed({ sk_variant_id: 1 });
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,cost,sell_price,enabled,seller_active,supplier,game_slug)
      VALUES('ml86','86 Diamond',15000,20000,1,1,'digiflazz','mobile-legends')`);
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.products.map((product) => product.buyer_sku_code)).toEqual(["sk:1"]);
  });
});
