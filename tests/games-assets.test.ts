import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GAMES_LOCAL_ASSETS, gamesLocalAsset, gamesLocalBanner, gamesLocalIcon, gamesLocalPortrait } from "@/lib/games/assets";
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
// CDN/kanal resmi: Apple, Google Play, Steam, dan situs resmi publisher.
const OFFICIAL_HOSTS = [
  "mzstatic.com", "play-lh.googleusercontent.com", "apps.apple.com", "play.google.com",
  "steamstatic.com", "steampowered.com", "zlongame.com", "uniugame.com", "rgpub.io",
  "akamaized.net", "arenabreakout.com", "vnggames.com", "ea.com", "amazonaws.com",
  "xdcdn.net", "honorofkings.com", "youngjoygame.com", "zepetto.com", "garena.tw",
  "wherewindsmeetgame.com", "zepeto.me",
];
const OFFICIAL_PAGE_HOSTS = [
  "apps.apple.com", "play.google.com", "store.steampowered.com", "laplacem.zlongame.com",
];

async function sizes(file: string) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(file).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** Versi cache-busting yang ditulis generator: 10 hex pertama sha256 isi berkas. */
function fileVersion(rel: string): string {
  return createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex").slice(0, 10);
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
      expect(OFFICIAL_PAGE_HOSTS, slug).toContain(new URL(game.page).hostname.toLowerCase());
      expect(game.icon?.source, slug).toMatch(/^https:\/\//);
      expect(game.icon?.licence, slug).toBeTruthy();
      expect(game.banner, slug).toBeTruthy();
      expect(game.banner_skip, slug).toBeUndefined();
    }
  });

  it("hanya mengunduh dari CDN resmi Apple/Google, tidak dari toko top-up", () => {
    for (const [slug, game] of Object.entries<any>(MANIFEST.games)) {
      if (game.skip) continue;
      const portrait = game.portrait;
      if (portrait?.source.startsWith("local:")) {
        expect(portrait.source, slug).toBe(`local:scripts/games-assets-src/portraits/${slug}.webp`);
        expect(portrait.page, slug).toBe(game.page);
        expect(portrait.generated, slug).toContain("GPT Image (Codex gpt-6.1-sol image_gen)");
        expect(portrait.generated, slug).toContain("docs/games-portrait-sources.md");
      }
      const banner = game.banner;
      expect(banner.source, slug).toBe(`local:scripts/games-assets-src/banners/${slug}.webp`);
      expect(banner.page, slug).toBe(game.page);
      expect(["kept official", "recropped", "generated"], slug).toContain(banner.status);
      if (banner.status === "generated") {
        expect(banner.generated, slug).toContain("GPT Image (Codex image_gen)");
        expect(banner.generation.tool, slug).toBe("image_gen");
        expect(banner.generation.sources, slug).toContain(banner.official_source);
      }
      const urls = [game.page, game.icon?.source, banner.official_source, portrait?.source, ...(banner.generation?.sources ?? [])]
        .filter((url) => url && !url.startsWith("local:"));
      for (const url of urls) {
        const host = new URL(url).hostname.toLowerCase();
        expect(OFFICIAL_HOSTS.some((official) => host.endsWith(official)), `${slug}: ${host}`).toBe(true);
        expect(TOPUP_SHOP_HOSTS.some((blocked) => host.includes(blocked)), `${slug}: ${host}`).toBe(false);
      }
    }
  });

  it("48 master portrait gaya Oura 1200×1800 dan FF MAX berbeda dari FF", async () => {
    const generated = Object.entries<any>(MANIFEST.games).filter(([, game]) => game.portrait?.generated);
    expect(generated).toHaveLength(48);
    for (const [slug, game] of generated) {
      const file = path.join(ROOT, game.portrait.source.slice("local:".length));
      expect(existsSync(file), slug).toBe(true);
      expect(await sizes(file), slug).toEqual({ width: 1200, height: 1800 });
    }
    expect(readFileSync(path.join(ROOT, "scripts/games-assets-src/portraits/free-fire.webp")))
      .not.toEqual(readFileSync(path.join(ROOT, "scripts/games-assets-src/portraits/free-fire-max.webp")));
    expect(readFileSync(path.join(ROOT, "public/brand/games/free-fire-portrait.webp")))
      .not.toEqual(readFileSync(path.join(ROOT, "public/brand/games/free-fire-max-portrait.webp")));
  });

  it("generator membaca master lokal offline dan menolak path, region, atau provenance banner tidak valid", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "axvara-portrait-test-"));
    try {
      const masterDir = path.join(fixtureRoot, "scripts/games-assets-src/portraits");
      mkdirSync(masterDir, { recursive: true });
      copyFileSync(path.join(ROOT, "scripts/games-assets-src/portraits/growtopia.webp"), path.join(masterDir, "growtopia.webp"));
      const bannerDir = path.join(fixtureRoot, "scripts/games-assets-src/banners");
      mkdirSync(bannerDir, { recursive: true });
      copyFileSync(path.join(ROOT, "scripts/games-assets-src/banners/growtopia.webp"), path.join(bannerDir, "growtopia.webp"));
      const game = structuredClone(MANIFEST.games.growtopia);
      // data: keeps the icon step offline; banner/portrait use local masters.
      game.icon.source = `data:image/webp;base64,${readFileSync(path.join(ROOT, "public/brand/games/growtopia-icon.webp")).toString("base64")}`;
      const manifestPath = path.join(fixtureRoot, "scripts/games-assets.manifest.json");
      const run = () => spawnSync(process.execPath, [path.join(ROOT, "scripts/games-assets.mjs"), "--only", "growtopia"], {
        cwd: fixtureRoot, encoding: "utf8", timeout: 15000,
      });
      writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
      const result = run();
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(readFileSync(path.join(fixtureRoot, "public/brand/games/growtopia-portrait.webp")))
        .toEqual(readFileSync(path.join(ROOT, "public/brand/games/growtopia-portrait.webp")));
      expect(readFileSync(path.join(fixtureRoot, "public/brand/games/growtopia-banner.webp")))
        .toEqual(readFileSync(path.join(ROOT, "public/brand/games/growtopia-banner.webp")));
      const originalPortrait = game.portrait.source;
      for (const source of ["local:../outside.webp", "local:scripts/games-assets-src/portraits/roblox.webp"]) {
        game.portrait.source = source;
        writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
        const invalid = run();
        expect(invalid.status).not.toBe(0);
        expect(invalid.stderr).toContain("portrait lokal wajib master per slug");
      }
      game.portrait.source = originalPortrait;
      for (const source of ["local:../outside.webp", "local:scripts/games-assets-src/banners/roblox.webp"]) {
        game.banner.source = source;
        writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
        expect(run().stderr).toContain("banner lokal wajib master per slug");
      }
      game.banner.source = MANIFEST.games.growtopia.banner.source;
      game.banner.region.width = 0;
      writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
      expect(run().stderr).toContain("banner.region wajib");
      game.banner.region = MANIFEST.games.growtopia.banner.region;
      game.banner.status = "generated";
      game.banner.generated = "GPT Image edit without provenance record";
      writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
      expect(run().stderr).toContain("sumber resmi + provenance");
      delete game.banner;
      game.banner_skip = "Legacy skipped banner";
      writeFileSync(manifestPath, JSON.stringify({ games: { growtopia: game } }));
      expect(run().stderr).toContain("banner wajib tanpa banner_skip");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("48 banner tepat 1600×900, ≤200 KB dan focal region master valid", async () => {
    const files = readdirSync(path.join(ROOT, "public/brand/games")).filter((file) => file.endsWith("-banner.webp"));
    expect(files).toHaveLength(48);
    expect(files.sort()).toEqual(SK_GAME_SLUGS.map((slug) => `${slug}-banner.webp`).sort());
    for (const file of files) {
      expect(await sizes(path.join(ROOT, "public/brand/games", file)), file).toEqual({ width: 1600, height: 900 });
      expect(statSync(path.join(ROOT, "public/brand/games", file)).size, file).toBeLessThanOrEqual(200_000);
      const banner = MANIFEST.games[file.replace("-banner.webp", "")].banner;
      const master = await sizes(path.join(ROOT, banner.source.slice("local:".length)));
      const { left, top, width, height } = banner.region;
      expect([left, top, width, height].every(Number.isInteger), file).toBe(true);
      expect(left, file).toBeGreaterThanOrEqual(0);
      expect(top, file).toBeGreaterThanOrEqual(0);
      expect(width, file).toBeGreaterThan(0);
      expect(height, file).toBeGreaterThan(0);
      expect(left + width, file).toBeLessThanOrEqual(master.width);
      expect(top + height, file).toBeLessThanOrEqual(master.height);
    }
  });

  it("berkas lokal lengkap; ikon 512×512 dan banner ≤200 KB 1600×900", async () => {
    for (const [slug, game] of Object.entries<any>(MANIFEST.games)) {
      const expected = GAMES_LOCAL_ASSETS[slug];
      if (game.skip) {
        expect(expected, slug).toBeUndefined();
        expect(existsSync(path.join(ROOT, `public/brand/games/${slug}-icon.webp`)), slug).toBe(false);
        continue;
      }
      expect(expected?.icon, slug).toBe(`/brand/games/${slug}-icon.webp?v=${fileVersion(`public/brand/games/${slug}-icon.webp`)}`);
      const iconFile = path.join(ROOT, `public/brand/games/${slug}-icon.webp`);
      expect(existsSync(iconFile), slug).toBe(true);
      expect(await sizes(iconFile), slug).toEqual({ width: 512, height: 512 });

      if (game.banner) {
        expect(expected?.banner, slug).toBe(`/brand/games/${slug}-banner.webp?v=${fileVersion(`public/brand/games/${slug}-banner.webp`)}`);
        const bannerFile = path.join(ROOT, `public/brand/games/${slug}-banner.webp`);
        expect(existsSync(bannerFile), slug).toBe(true);
        const size = await sizes(bannerFile);
        expect(size.width, slug).toBe(1600);
        expect(size.height, slug).toBe(900);
        expect(statSync(bannerFile).size, slug).toBeLessThanOrEqual(200_000);
      } else {
        expect(expected?.banner, slug).toBeNull();
        expect(existsSync(path.join(ROOT, `public/brand/games/${slug}-banner.webp`)), slug).toBe(false);
      }

      if (game.portrait) {
        expect(expected?.portrait, slug).toBe(`/brand/games/${slug}-portrait.webp?v=${fileVersion(`public/brand/games/${slug}-portrait.webp`)}`);
        const portraitFile = path.join(ROOT, `public/brand/games/${slug}-portrait.webp`);
        expect(existsSync(portraitFile), slug).toBe(true);
        expect(await sizes(portraitFile), slug).toEqual({ width: 600, height: 900 });
        expect(statSync(portraitFile).size, slug).toBeLessThanOrEqual(120 * 1024);
      } else {
        expect(game.portrait_skip, slug).toBeTruthy();
        expect(expected?.portrait, slug).toBeNull();
        expect(existsSync(path.join(ROOT, `public/brand/games/${slug}-portrait.webp`)), slug).toBe(false);
      }
    }
  });

  it("peta aset.ts konsisten dengan manifest (tidak ada slug asing)", () => {
    expect(Object.keys(GAMES_LOCAL_ASSETS).sort()).toEqual(
      Object.entries<any>(MANIFEST.games).filter(([, game]) => !game.skip).map(([slug]) => slug).sort(),
    );
    expect(gamesLocalAsset("tidak-ada-game")).toEqual({ icon: null, banner: null, portrait: null });
    expect(gamesLocalIcon("MOBILE-LEGENDS")).toMatch(/^\/brand\/games\/mobile-legends-icon\.webp\?v=[0-9a-f]{10}$/);
    expect(gamesLocalBanner("valorant")).toMatch(/^\/brand\/games\/valorant-banner\.webp\?v=[0-9a-f]{10}$/);
    expect(gamesLocalPortrait("MOBILE-LEGENDS")).toMatch(/^\/brand\/games\/mobile-legends-portrait\.webp\?v=[0-9a-f]{10}$/);
    expect(gamesLocalPortrait("growtopia")).toMatch(/^\/brand\/games\/growtopia-portrait\.webp\?v=[0-9a-f]{10}$/);
    expect(gamesLocalPortrait("tidak-ada-game")).toBeNull();
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
    expect(game.icon).toMatch(/^\/brand\/games\/mobile-legends-icon\.webp\?v=[0-9a-f]{10}$/);
    expect(game.banner).toMatch(/^\/brand\/games\/mobile-legends-banner\.webp\?v=[0-9a-f]{10}$/);
    expect(JSON.stringify(game)).not.toContain("sekalipay.com");

    const detail = (await getGamesDetail("mobile-legends"))!;
    expect(detail.game.icon).toMatch(/^\/brand\/games\/mobile-legends-icon\.webp\?v=[0-9a-f]{10}$/);
    expect(detail.game.banner).toMatch(/^\/brand\/games\/mobile-legends-banner\.webp\?v=[0-9a-f]{10}$/);
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
    seed({ game_slug: "game-tanpa-aset", sk_product_name: "Game Tanpa Aset", sk_product_id: 700, sk_variant_id: 7 });
    const [game] = await getGamesCatalog();
    expect(game).toMatchObject({ slug: "game-tanpa-aset", icon: null, banner: null });
    const detail = (await getGamesDetail("game-tanpa-aset"))!;
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
