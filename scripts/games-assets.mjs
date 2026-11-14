#!/usr/bin/env node
// scripts/games-assets.mjs — unduh + olah aset resmi publisher untuk katalog
// Games. Sumber tunggal: `scripts/games-assets.manifest.json` (slug, publisher,
// halaman sumber, URL berkas, lisensi, atau `skip`). Output:
//   public/brand/games/<slug>-icon.webp    512×512  q82
//   public/brand/games/<slug>-banner.webp  1600 lebar q80, ≤250 KB
//   src/lib/games/assets.ts                peta slug → { icon, banner }
//   docs/games-assets.md                   tabel provenance
// Pemakaian:
//   node scripts/games-assets.mjs [--only <slug>] [--contact-sheet <file>]
//   node scripts/games-assets.mjs --contact-sheet <file>   (tanpa unduh ulang)
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "scripts/games-assets.manifest.json");
const OUT_DIR = path.join(ROOT, "public/brand/games");
const ASSETS_TS = path.join(ROOT, "src/lib/games/assets.ts");
const DOC_PATH = path.join(ROOT, "docs/games-assets.md");
const CACHE_DIR = path.join(tmpdir(), "axvara-games-assets");
const ICON_SIZE = 512;
const ICON_QUALITY = 82;
const BANNER_WIDTH = 1600;
const BANNER_QUALITY = 80;
const BANNER_MAX_BYTES = 250 * 1024;
const UA = "axvara-games-assets/1.0 (+https://axvara.tech)";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? "" : null;
};
const only = flag("--only");
const contactSheet = flag("--contact-sheet");

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
const slugs = Object.keys(manifest.games).sort();

function assertManifest() {
  const problems = [];
  for (const [slug, game] of Object.entries(manifest.games)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) problems.push(`${slug}: slug tidak valid`);
    if (game.skip) {
      if (!game.skip.trim()) problems.push(`${slug}: alasan skip kosong`);
      continue;
    }
    if (!game.publisher || !game.page) problems.push(`${slug}: publisher/page wajib`);
    if (!game.icon?.source) problems.push(`${slug}: icon.source wajib`);
    if (game.banner && game.banner_skip) problems.push(`${slug}: pilih banner atau banner_skip`);
    if (!game.banner && !game.banner_skip) problems.push(`${slug}: banner_skip wajib bila tanpa banner`);
  }
  if (problems.length) throw new Error(`Manifest tidak valid:\n - ${problems.join("\n - ")}`);
}

async function download(url) {
  const name = path.join(CACHE_DIR, encodeURIComponent(url).replace(/%/g, "_").slice(0, 180));
  try {
    return await readFile(name);
  } catch {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} untuk ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(name, buffer);
    return buffer;
  }
}

async function buildIcon(slug, game) {
  const input = await download(game.icon.source);
  const file = path.join(OUT_DIR, `${slug}-icon.webp`);
  await sharp(input)
    .rotate()
    .resize({ width: ICON_SIZE, height: ICON_SIZE, fit: "cover", position: "centre" })
    .webp({ quality: ICON_QUALITY })
    .toFile(file);
  const meta = await sharp(file).metadata();
  return {
    file,
    url: `/brand/games/${slug}-icon.webp`,
    width: meta.width,
    height: meta.height,
    bytes: (await stat(file)).size,
  };
}

async function buildBanner(slug, game) {
  const input = await download(game.banner.source);
  const probe = await sharp(input).metadata();
  const file = path.join(OUT_DIR, `${slug}-banner.webp`);
  let quality = BANNER_QUALITY;
  let bytes = 0;
  for (const attempt of [0, 1, 2, 3]) {
    const buffer = await sharp(input)
      .rotate()
      .resize({ width: BANNER_WIDTH, withoutEnlargement: false, fit: "inside" })
      .webp({ quality })
      .toBuffer();
    bytes = buffer.byteLength;
    await writeFile(file, buffer);
    if (bytes <= BANNER_MAX_BYTES) break;
    quality = [80, 72, 64, 58][attempt + 1] ?? 55;
  }
  const meta = await sharp(file).metadata();
  return {
    file,
    url: `/brand/games/${slug}-banner.webp`,
    width: meta.width,
    height: meta.height,
    bytes,
    sourceWidth: probe.width ?? null,
    sourceHeight: probe.height ?? null,
    quality,
  };
}

async function writeAssetsTs(entries) {
  const lines = [
    "// AUTO-GENERATED oleh scripts/games-assets.mjs dari scripts/games-assets.manifest.json.",
    "// Jangan edit manual: ubah manifest lalu jalankan `node scripts/games-assets.mjs`.",
    "// Aset = artwork resmi publisher (App Store ID). Tanpa gambar produk Sekalipay.",
    "",
    "export interface GamesLocalAsset {",
    "  icon: string | null;",
    "  banner: string | null;",
    "}",
    "",
    "export const GAMES_LOCAL_ASSETS: Readonly<Record<string, GamesLocalAsset>> = Object.freeze({",
  ];
  for (const entry of entries) {
    if (!entry.icon && !entry.banner) continue;
    lines.push(
      `  ${JSON.stringify(entry.slug)}: { icon: ${entry.icon ? JSON.stringify(entry.icon) : "null"}, banner: ${
        entry.banner ? JSON.stringify(entry.banner) : "null"
      } },`,
    );
  }
  lines.push(
    "});",
    "",
    "const EMPTY: GamesLocalAsset = Object.freeze({ icon: null, banner: null });",
    "",
    "export function gamesLocalAsset(slug: unknown): GamesLocalAsset {",
    "  const key = String(slug ?? \"\").trim().toLowerCase();",
    "  return GAMES_LOCAL_ASSETS[key] ?? EMPTY;",
    "}",
    "",
    "export const gamesLocalIcon = (slug: unknown): string | null => gamesLocalAsset(slug).icon;",
    "export const gamesLocalBanner = (slug: unknown): string | null => gamesLocalAsset(slug).banner;",
    "",
  );
  await writeFile(ASSETS_TS, lines.join("\n"));
}

function tableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

async function writeDoc(results) {
  const generated = manifest.generated ?? "2026-11-14";
  const lines = [
    "# AXVARA Games — Aset Game Resmi (provenance)",
    "",
    `> Dibuat oleh \`scripts/games-assets.mjs\` dari \`scripts/games-assets.manifest.json\` pada ${generated}.`,
    "> Sumber HANYA listing resmi publisher (Apple App Store ID). Tidak ada aset dari toko top-up",
    "> (Oura, ditopup, Codashop, UniPin, Sekalipay), wiki fan, Pinterest, atau generator AI.",
    "> Penggunaan nominatif untuk identifikasi produk; tanpa modifikasi logo dan tanpa klaim afiliasi.",
    "",
    `Total berkas: ${results.filter((r) => r.icon).length} ikon + ${results.filter((r) => r.banner).length} banner = ${results.reduce(
      (sum, r) => sum + (r.iconBytes ?? 0) + (r.bannerBytes ?? 0),
      0,
    )} byte.`,
    "",
    "## Aset yang dipakai",
    "",
    tableRow(["Slug", "Publisher", "Halaman sumber", "Berkas sumber", "Dimensi hasil", "Tanggal"]),
    tableRow(["---", "---", "---", "---", "---", "---"]),
  ];
  for (const slug of slugs) {
    const result = results.find((r) => r.slug === slug);
    const game = manifest.games[slug];
    if (!result || !game || game.skip) continue;
    const iconCell = result.icon ? `${result.iconWidth}×${result.iconHeight} ikon` : "—";
    const bannerCell = result.banner ? `${result.bannerWidth}×${result.bannerHeight} banner` : "—";
    lines.push(
      tableRow([
        `\`${slug}\``,
        game.publisher,
        `[${new URL(game.page).hostname}](${game.page})`,
        `[ikon](${game.icon.source})${result.banner ? ` · [banner](${game.banner.source})` : ""}`,
        `${iconCell}${result.banner ? ` + ${bannerCell}` : ""}`,
        generated,
      ]),
    );
    if (game.banner_skip && !game.skip) {
      lines.push(`| | | | | _Banner dilewati: ${game.banner_skip}_ | |`);
    }
  }
  lines.push("", "## Dilewati (tanpa sumber resmi)", "", tableRow(["Slug", "Alasan"]), tableRow(["---", "---"]));
  for (const slug of slugs) {
    const game = manifest.games[slug];
    if (game?.skip) lines.push(tableRow([`\`${slug}\``, game.skip]));
  }
  lines.push(
    "",
    "## Aturan",
    "",
    "- Urutan aset di storefront: unggahan admin `games_meta` → aset lokal resmi → fallback AXVARA (monogram/blur).",
    "- `image_url` produk Sekalipay tidak pernah dirender di storefront dan tidak lagi ada di CSP `img-src`.",
    "- Aset yang ditolak PM dihapus dari manifest (pakai `skip`) dan fallback AXVARA dipakai.",
    "- Contact sheet: slug tanpa awalan = aset ada; `× slug` = tidak ada/dilewati (fallback AXVARA).",
    "",
  );
  await writeFile(DOC_PATH, lines.join("\n"));
}

async function buildContactSheet(file) {
  const icons = [];
  for (const slug of slugs) {
    const iconPath = path.join(OUT_DIR, `${slug}-icon.webp`);
    try {
      const buffer = await sharp(iconPath).resize(120, 120, { fit: "cover" }).png().toBuffer();
      icons.push({ slug, buffer });
    } catch {
      icons.push({ slug, buffer: null });
    }
  }
  const banners = [];
  for (const slug of slugs) {
    const bannerPath = path.join(OUT_DIR, `${slug}-banner.webp`);
    try {
      const buffer = await sharp(bannerPath).resize({ width: 320, height: 180, fit: "cover" }).png().toBuffer();
      banners.push({ slug, buffer });
    } catch {
      banners.push({ slug, buffer: null });
    }
  }

  const label = (text, width, muted = false) =>
    Buffer.from(
      `<svg width="${width}" height="26" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#080C1E"/>
        <text x="${width / 2}" y="18" fill="${muted ? "#6B7280" : "#E6F9FF"}" font-family="Helvetica,Arial,sans-serif" font-size="13"
          text-anchor="middle">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
      </svg>`,
    );

  const iconCols = 8;
  const iconCell = 150;
  const iconRows = Math.ceil(icons.length / iconCols);
  const iconGrid = await sharp({
    create: { width: iconCols * iconCell, height: iconRows * (iconCell + 26), channels: 4, background: "#080C1E" },
  })
    .png()
    .toBuffer();

  const composites = [];
  icons.forEach((item, index) => {
    const x = (index % iconCols) * iconCell + 15;
    const y = Math.floor(index / iconCols) * (iconCell + 26);
    if (item.buffer) composites.push({ input: item.buffer, left: x, top: y, width: 120, height: 120 });
    composites.push({ input: label(item.buffer ? item.slug : `× ${item.slug}`, 120, !item.buffer), left: x, top: y + 122 });
  });
  const iconSheet = await sharp(iconGrid).composite(composites).png().toBuffer();

  const bannerCols = 4;
  const bannerCellW = 340;
  const bannerCellH = 210;
  const bannerRows = Math.ceil(banners.length / bannerCols);
  const bannerGrid = await sharp({
    create: {
      width: bannerCols * bannerCellW,
      height: bannerRows * bannerCellH,
      channels: 4,
      background: "#080C1E",
    },
  })
    .png()
    .toBuffer();
  const bannerComposites = [];
  banners.forEach((item, index) => {
    const x = (index % bannerCols) * bannerCellW + 10;
    const y = Math.floor(index / bannerCols) * bannerCellH;
    if (item.buffer) bannerComposites.push({ input: item.buffer, left: x, top: y + 4, width: 320, height: 180 });
    bannerComposites.push({ input: label(item.buffer ? item.slug : `× ${item.slug}`, 320, !item.buffer), left: x, top: y + 182 });
  });
  const bannerSheet = await sharp(bannerGrid).composite(bannerComposites).png().toBuffer();
  const bannerMeta = await sharp(bannerSheet).metadata();
  const sheetWidth = Math.max(iconCols * iconCell, bannerCols * bannerCellW);

  await sharp({
    create: { width: sheetWidth, height: iconRows * (iconCell + 26) + (bannerMeta.height ?? 0) + 8, channels: 4, background: "#080C1E" },
  })
    .composite([
      { input: iconSheet, left: 0, top: 0 },
      { input: bannerSheet, left: 0, top: iconRows * (iconCell + 26) + 8 },
    ])
    .png()
    .toFile(file);
  return file;
}

assertManifest();

if (contactSheet) {
  await mkdir(path.dirname(contactSheet), { recursive: true });
  const file = await buildContactSheet(contactSheet);
  console.log(`contact sheet → ${file}`);
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
const results = [];
let failures = 0;
for (const slug of slugs) {
  const game = manifest.games[slug];
  const result = { slug, icon: null, banner: null, iconBytes: 0, bannerBytes: 0 };
  if (only && slug !== only) {
    results.push(result);
    continue;
  }
  if (game.skip) {
    console.log(`skip    ${slug} — ${game.skip}`);
    results.push(result);
    continue;
  }
  try {
    const icon = await buildIcon(slug, game);
    result.icon = icon.url;
    result.iconBytes = icon.bytes;
    result.iconWidth = icon.width;
    result.iconHeight = icon.height;
    console.log(`icon    ${slug} ${icon.width}×${icon.height} ${(icon.bytes / 1024).toFixed(1)} KB`);
  } catch (error) {
    failures += 1;
    console.log(`icon!   ${slug} — ${error.message}`);
  }
  if (game.banner) {
    try {
      const banner = await buildBanner(slug, game);
      result.banner = banner.url;
      result.bannerBytes = banner.bytes;
      result.bannerWidth = banner.width;
      result.bannerHeight = banner.height;
      console.log(
        `banner  ${slug} ${banner.width}×${banner.height} ${(banner.bytes / 1024).toFixed(1)} KB (q${banner.quality})`,
      );
    } catch (error) {
      failures += 1;
      console.log(`banner! ${slug} — ${error.message}`);
    }
  }
  results.push(result);
}

if (!only) {
  await writeAssetsTs(results);
  await writeDoc(results);
  const iconCount = results.filter((r) => r.icon).length;
  const bannerCount = results.filter((r) => r.banner).length;
  const totalBytes = results.reduce((sum, r) => sum + (r.iconBytes ?? 0) + (r.bannerBytes ?? 0), 0);
  console.log(`\n${iconCount} ikon + ${bannerCount} banner = ${(totalBytes / 1024).toFixed(1)} KB (${totalBytes} byte)`);
  console.log(`src/lib/games/assets.ts + docs/games-assets.md diperbarui`);
}
if (failures) process.exitCode = 1;
