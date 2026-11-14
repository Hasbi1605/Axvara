import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GAMES_LOCAL_ASSETS, gamesLocalAsset, gamesLocalBanner, gamesLocalIcon } from "@/lib/games/assets";
import { getGamesCatalog, getGamesDetail } from "@/lib/games/catalog";

const ROOT = path.resolve(__dirname, "..");
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, "scripts/games-assets.manifest.json"), "utf8"));

// Snapshot katalog Sekalipay 14 Nov 2026 (games-fixture-seed.sql, 48 game SK).
const SK_GAME_SLUGS = [
  "aniimo", "arena-breakout", "arena-of-valor", "au2-mobile", "blood-strike",
  "call-of-duty-mobile", "captain-tsubasa-ace", "crossfire-legends", "delta-force",
  "dragon-city", "fc-mobile", "football-master-2", "free-fire", "free-fire-max",
  "gangstar-mirage-city", "garena-undawn", "genshin-impact", "growtopia",
  "haikyu-fly-high", "heartopia", "honkai-star-rail", "honor-of-kings", "identity-v",
  "laplace-m", "league-of-legends-wild-rift", "lifeafter", "lineage2m", "machina-waking",
  "magic-chess-go-go", "marvel-rivals", "mobile-legends", "mobile-legends-adventure",
  "mu-origin-2", "one-punch-man", "onmyoji-arena", "point-blank", "pubg-mobile",
  "ragnarok-m-eternal-love", "rainbow-six-mobile", "roblox", "sausage-man",
  "speed-drifters", "state-of-survival", "super-sus", "valorant", "where-winds-meet",
  "zenless-zone-zero", "zepeto",
];

const TOPUP_SHOP_HOSTS = [
  "oura", "ditopup", "codashop", "unipin", "sekalipay", "itemku", "pinterest",
  "fandom", "wikia", "wiki", "midjourney", "openai",
];
const OFFICIAL_HOSTS = ["mzstatic.com", "play-lh.googleusercontent.com", "apps.apple.com", "play.google.com"];

async function sizes(file: string) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(file).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

describe("manifest aset game", () => {
  it("mencakup SEMUA slug game SK di katalog", () => {
    expect(Object.keys(MANIFEST.games).sort()).toEqual([...SK_GAME_SLUGS].sort());
  });

  it("setiap game punya sumber resmi lengkap atau alasan skip eksplisit", () => {
    for (const [slug, game] of Object.entries<any>(MANIFEST.games)) {
      if (game.skip) {
        expect(game.skip.length, slug).toBeGreaterThan(10);
        continue;
      }
      expect(game.publisher, slug).toBeTruthy();
      expect(game.page, slug).toMatch(/^https:\/\/apps\.apple\.com\//);
      expect(game.icon?.source, slug).toMatch(/^https:\/\//);
      expect(game.icon?.licence, slug).toBeTruthy();
      expect(Boolean(game.banner) !== Boolean(game.banner_skip), slug).toBe(true);
    }
  });

  it("hanya mengunduh dari CDN resmi Apple/Google, tidak dari toko top-up", () => {
    for (const [slug, game] of Object.entries<any>(MANIFEST.games)) {
      if (game.skip) continue;
      const urls = [game.page, game.icon?.source, game.banner?.source].filter(Boolean);
      for (const url of urls) {
        const host = new URL(url).hostname.toLowerCase();
        expect(OFFICIAL_HOSTS.some((official) => host.endsWith(official)), `${slug}: ${host}`).toBe(true);
        expect(TOPUP_SHOP_HOSTS.some((blocked) => host.includes(blocked)), `${slug}: ${host}`).toBe(false);
      }
    }
  });

  it("berkas lokal lengkap; ikon 512×512 dan banner ≤250 KB lebar 1600", async () => {
    for (const [slug, game] of Object.entries<any>(MANIFEST.games)) {
      const expected = GAMES_LOCAL_ASSETS[slug];
      if (game.skip) {
        expect(expected, slug).toBeUndefined();
        expect(existsSync(path.join(ROOT, `public/brand/games/${slug}-icon.webp`)), slug).toBe(false);
        continue;
      }
      expect(expected?.icon, slug).toBe(`/brand/games/${slug}-icon.webp`);
      const iconFile = path.join(ROOT, `public/brand/games/${slug}-icon.webp`);
      expect(existsSync(iconFile), slug).toBe(true);
      expect(await sizes(iconFile), slug).toEqual({ width: 512, height: 512 });

      if (game.banner) {
        expect(expected?.banner, slug).toBe(`/brand/games/${slug}-banner.webp`);
        const bannerFile = path.join(ROOT, `public/brand/games/${slug}-banner.webp`);
        expect(existsSync(bannerFile), slug).toBe(true);
        const size = await sizes(bannerFile);
        expect(size.width, slug).toBe(1600);
        expect(size.height, slug).toBeLessThanOrEqual(1000);
        expect(statSync(bannerFile).size, slug).toBeLessThanOrEqual(250 * 1024);
      } else {
        expect(expected?.banner, slug).toBeNull();
        expect(existsSync(path.join(ROOT, `public/brand/games/${slug}-banner.webp`)), slug).toBe(false);
      }
    }
  });

  it("peta aset.ts konsisten dengan manifest (tidak ada slug asing)", () => {
    expect(Object.keys(GAMES_LOCAL_ASSETS).sort()).toEqual(
      Object.entries<any>(MANIFEST.games).filter(([, game]) => !game.skip).map(([slug]) => slug).sort(),
    );
    expect(gamesLocalAsset("tidak-ada-game")).toEqual({ icon: null, banner: null });
    expect(gamesLocalIcon("MOBILE-LEGENDS")).toBe("/brand/games/mobile-legends-icon.webp");
    expect(gamesLocalBanner("valorant")).toBeNull();
  });
});

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); });

function seed(over: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    buyer_sku_code: "sk:1", product_name: "86 Diamond", game_slug: "mobile-legends",
    sk_product_id: 33, sk_product_name: "Mobile Legends", sk_variant_id: 1,
    supplier: "sekalipay", supplier_active: 1, enabled: 1, stock: 100, min_order: 1,
    cost: 11750, sell_price: 12400, product_type_name: "Indonesia",
    required_fields_json: JSON.stringify({
      version: 1,
      fields: [{ key: "note", label: "User ID", required: true, input: "text", min: 1, max: 50 }],
      requires_zone_id: false, validation_available: false, open_denom: false, supported: true, reason: null,
    }),
    image_url: "https://sekalipay.com/images/products/abc.png",
    ...over,
  };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
}

describe("katalog publik: presedensi aset OD5", () => {
  it("tanpa upload admin: aset resmi lokal dipakai, bukan gambar Sekalipay", async () => {
    seed();
    const [game] = await getGamesCatalog();
    expect(game.icon).toBe("/brand/games/mobile-legends-icon.webp");
    expect(game.banner).toBe("/brand/games/mobile-legends-banner.webp");
    expect(JSON.stringify(game)).not.toContain("sekalipay.com");

    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.game.icon).toBe("/brand/games/mobile-legends-icon.webp");
    expect(detail.game.banner).toBe("/brand/games/mobile-legends-banner.webp");
  });

  it("upload admin menang atas aset lokal (list + detail)", async () => {
    seed();
    fx.sql.prepare("INSERT INTO games_meta(slug,icon_url,banner_url,hidden) VALUES(?,?,?,0)")
      .run("mobile-legends", "/r2/products/ml.webp", "https://cdn.example/ml-banner.webp");
    const [game] = await getGamesCatalog();
    expect(game).toMatchObject({ icon: "/r2/products/ml.webp", banner: "https://cdn.example/ml-banner.webp" });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.game).toMatchObject({ icon: "/r2/products/ml.webp", banner: "https://cdn.example/ml-banner.webp" });
  });

  it("game tanpa aset resmi mengirim null (UI memakai fallback AXVARA)", async () => {
    seed({ game_slug: "valorant", sk_product_name: "Valorant", sk_product_id: 700, sk_variant_id: 7 });
    const [game] = await getGamesCatalog();
    expect(game).toMatchObject({ slug: "valorant", icon: null, banner: null });
    const detail = (await getGamesDetail("valorant"))!;
    expect(detail.game).toMatchObject({ icon: null, banner: null });
  });
});

describe("katalog detail: label field V2", () => {
  const contract = (label: string) => JSON.stringify({
    version: 1,
    fields: [{ key: "note", label, required: true, input: "text", min: 1, max: 50 }],
    requires_zone_id: false, validation_available: false, open_denom: false, supported: true, reason: null,
  });

  it("label generik diganti label mayoritas game", async () => {
    seed({ sk_variant_id: 1, buyer_sku_code: "sk:1", product_name: "86 Diamond", required_fields_json: contract("User ID") });
    seed({ sk_variant_id: 2, buyer_sku_code: "sk:2", product_name: "172 Diamond", required_fields_json: contract("User ID") });
    seed({ sk_variant_id: 3, buyer_sku_code: "sk:3", product_name: "355 Diamond", required_fields_json: contract("Catatan") });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.products.map((product) => product.fields?.[0].label)).toEqual(["User ID", "User ID", "User ID"]);
  });

  it("tanpa label bermakna, label asli yang sudah dibersihkan dipertahankan", async () => {
    seed({ sk_variant_id: 1, buyer_sku_code: "sk:1", required_fields_json: contract("Catatan") });
    seed({ sk_variant_id: 2, buyer_sku_code: "sk:2", required_fields_json: contract("Keterangan :") });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.products.map((product) => product.fields?.[0].label)).toEqual(["Catatan", "Keterangan"]);
  });

  it("label bermakna berbeda per varian dipertahankan; hanya label generik yang diganti mayoritas", async () => {
    seed({ sk_variant_id: 1, buyer_sku_code: "sk:1", required_fields_json: contract("Player ID") });
    seed({ sk_variant_id: 2, buyer_sku_code: "sk:2", required_fields_json: contract("Player ID :") });
    seed({ sk_variant_id: 3, buyer_sku_code: "sk:3", required_fields_json: contract("No Hp") });
    seed({ sk_variant_id: 4, buyer_sku_code: "sk:4", required_fields_json: contract("Catatan") });
    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.products.map((product) => product.fields?.[0].label)).toEqual([
      "Player ID", "Player ID", "No Hp", "Player ID",
    ]);
  });
});
