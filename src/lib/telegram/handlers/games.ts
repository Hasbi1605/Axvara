// src/lib/telegram/handlers/games.ts — Alur 100% native AXVARA Games di Bot Telegram.
// Mendukung 48+ game & 1.600+ SKU dengan:
// - 9 Game Populer (2 kolom) + Semua Game + Filter Genre + Cari Game (alias ml/ff/valo/dll)
// - Default region Indonesia / utama + pintasan 🎫 Pass & Membership + 🌏 Region Lain
// - Grid nominal 2 kolom (10/halaman) + filter rentang harga + 🔢 Cari Nominal
// - 1-klik pakai ID terakhir dari riwayat order sendiri (tanpa tabel/migrasi baru)
// - Input 1 pesan (`12345678 1234` / `12345678(1234)`) + Cek Nickname gratis + peringatan region
// - Konfirmasi & freeze payq1 (QRIS + Crypto)

import { createDatabaseAccess } from "@/lib/db-access";
import { execRun, isD1Mode, queryFirst } from "@/lib/db";
import { getGamesCatalog, getGamesDetail, type GamesCatalogItem, type GamesDetailProduct } from "@/lib/games/catalog";
import { selectPopularGames } from "@/lib/games/popular";
import { GAMES_GENRES, GAMES_GENRE_BY_SLUG, type GamesGenre } from "@/lib/games/genres";
import { gamesOrderingOpen, gamesPreviewMessage } from "@/lib/games/ordering";
import {
  gamesSkContractDigest,
  parseGamesSkContract,
  parseGamesSkTargetSnapshot,
  validateGamesSkTarget,
  type GamesSkContract,
} from "@/lib/games/registry";
import { checkSkGamesNickname } from "@/lib/games/nickname";
import { splitNicknameRegion } from "@/lib/games/variant-kind";
import { gamesVariantName } from "@/lib/games/display-name";
import { sendChatAction, sendMessage } from "@/lib/telegram/api";
import {
  buttonPrice, cb, minimalMenuKeyboard, paymentMethodOfferKeyboard,
  type TgPriceCtx,
} from "@/lib/telegram/keyboards";
import { paymentMethodNoticeMessage, paymentMethodOfferDetails } from "@/lib/telegram/messages/purchase";
import {
  gamesAccountInputPromptMessage,
  gamesCatalogListMessage,
  gamesDetailMessage,
  gamesHomeMessage,
  gamesReviewMessage,
  gamesSavedAccountPromptMessage,
} from "@/lib/telegram/messages/games";
import { freezePayq1, type Payq1GamesSource } from "@/lib/telegram/payment-quote";
import { tgCtxFor, tgDisplayPrice } from "@/lib/telegram/render-prefs";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { gamesApprovalTag } from "@/lib/telegram/games-checkout";
import { replaceWithPhoto, replaceWithText, setPendingActionUnlessCreating, type ScreenSourceMeta } from "./shared";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "@/lib/telegram/types";
import type { Locale } from "@/lib/i18n/locale";
import { SITE } from "@/lib/site";

const GAMES_PER_PAGE = 10;
const SKUS_PER_PAGE = 10;

const GAME_ALIASES: Record<string, string[]> = {
  "mobile-legends": ["ml", "mlbb", "mobile legend", "mobile legends", "mobel"],
  "magic-chess-go-go": ["mcgg", "magic chess"],
  "free-fire": ["ff", "freefire", "epep"],
  "free-fire-max": ["ffmax", "ff max", "freefire max"],
  "pubg-mobile": ["pubg", "pubgm"],
  "genshin-impact": ["gi", "genshin"],
  "honor-of-kings": ["hok", "honor of king"],
  "valorant": ["valo", "val", "vp"],
  "roblox": ["robux", "rbx"],
  "honkai-star-rail": ["hsr", "honkai", "star rail"],
  "call-of-duty-mobile": ["cod", "codm"],
  "arena-of-valor": ["aov"],
  "zenless-zone-zero": ["zzz", "zenless"],
  "league-of-legends-wild-rift": ["wr", "lol", "wild rift", "wildrift"],
  "fc-mobile": ["fc", "fifa", "fcmobile"],
  "blood-strike": ["bs", "bloodstrike"],
  "point-blank": ["pb"],
};

const GENRE_LABELS: Record<Exclude<GamesGenre, "all">, { id: string; en: string; icon: string }> = {
  moba: { id: "MOBA", en: "MOBA", icon: "⚔️" },
  shooter: { id: "Shooter", en: "Shooter", icon: "🎯" },
  rpg: { id: "RPG", en: "RPG", icon: "🗡" },
  sports: { id: "Olahraga", en: "Sports", icon: "⚽" },
  strategy: { id: "Strategi", en: "Strategy", icon: "♟️" },
  casual: { id: "Kasual", en: "Casual", icon: "🎲" },
};

type PriceRangeCode = "0" | "1" | "2" | "3";
// 0 = all, 1 = <20k, 2 = 20k–100k, 3 = >100k
function matchesPriceRange(price: number, range: PriceRangeCode): boolean {
  if (range === "1") return price < 20_000;
  if (range === "2") return price >= 20_000 && price <= 100_000;
  if (range === "3") return price > 100_000;
  return true;
}

function rangeLabel(range: PriceRangeCode, locale: Locale): string | null {
  if (range === "1") return locale === "en" ? "<Rp20k" : "<Rp20rb";
  if (range === "2") return locale === "en" ? "Rp20k–100k" : "Rp20rb–100rb";
  if (range === "3") return locale === "en" ? ">Rp100k" : ">Rp100rb";
  return null;
}

function gameDisplayPrice(amount: number, ctx: TgPriceCtx): string {
  if (ctx.displayCurrency === "USD" && ctx.fx) {
    return tgDisplayPrice(amount, { locale: ctx.locale ?? "en", displayCurrency: "USD", fx: ctx.fx });
  }
  return buttonPrice(amount);
}

function truncateBtn(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Bentuk label pendek nominal di tombol 2 kolom agar jelas & tidak terpotong. */
function compactSkuButtonLabel(name: string, price: number, ctx: TgPriceCtx): string {
  const short = name
    .replace(/\bDiamonds?\b/gi, "DM")
    .replace(/\bWeekly Diamond Pass\b/gi, "Weekly Pass")
    .replace(/\bMembership\b/gi, "Member")
    .replace(/\bGenesis Crystals?\b/gi, "GC")
    .replace(/\bValorant Points?\b/gi, "VP")
    .replace(/\s+/g, " ")
    .trim();
  const priceStr = gameDisplayPrice(price, ctx);
  return `${truncateBtn(short, 16)} · ${priceStr}`;
}

/** Encoding token game aman ≤ 38 char untuk callback_data ≤ 64 byte. */
export async function gameCallbackRef(slug: string): Promise<string> {
  if (slug.length <= 36) return slug;
  const row = await queryFirst(
    `SELECT MIN(id) AS rep_id FROM games_products WHERE supplier='sekalipay' AND game_slug=?`,
    slug,
  ).catch(() => null);
  const repId = Number(row?.rep_id ?? 0);
  return repId > 0 ? `#${repId}` : slug.slice(0, 36);
}

async function resolveGameSlug(slugOrRef: string): Promise<string> {
  const raw = String(slugOrRef || "").trim();
  if (raw.startsWith("#")) {
    const id = Number(raw.slice(1));
    if (Number.isSafeInteger(id) && id > 0) {
      const row = await queryFirst(`SELECT game_slug FROM games_products WHERE id=?`, id).catch(() => null);
      if (row?.game_slug) return String(row.game_slug).trim().toLowerCase();
    }
  }
  return raw.toLowerCase();
}

function twoColGrid<T>(items: T[], toButton: (item: T) => InlineKeyboardButton): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    const row: InlineKeyboardButton[] = [toButton(items[i])];
    if (items[i + 1]) row.push(toButton(items[i + 1]));
    rows.push(row);
  }
  return rows;
}

/** Pencarian game (dipakai oleh `gmq` DAN unified smart search Fase 3). */
export async function searchGamesCatalog(keyword: string): Promise<GamesCatalogItem[]> {
  const q = keyword.trim().toLowerCase();
  if (q.length < 2) return [];
  const catalog = await getGamesCatalog();
  const sellable = catalog.filter((g) => g.sellable_count > 0);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: { game: GamesCatalogItem; score: number }[] = [];
  for (const game of sellable) {
    const aliases = GAME_ALIASES[game.slug] ?? [];
    const nameL = game.name.toLowerCase();
    const slugL = game.slug.toLowerCase();
    let score = 0;
    if (aliases.includes(q) || nameL === q || slugL === q) score = 100;
    else if (aliases.some((a) => a.startsWith(q) || q.includes(a))) score = 80;
    else if (nameL.startsWith(q)) score = 70;
    else if (tokens.every((t) => nameL.includes(t) || slugL.includes(t) || aliases.some((a) => a.includes(t)))) score = 50;
    if (score > 0) scored.push({ game, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.game.featured_rank ?? 999) - (b.game.featured_rank ?? 999))
    .map((s) => s.game);
}

/** Langkah 1 — Beranda AXVARA Games (`gmh` / `/games` / tombol `🎮 Top Up Games`). */
export async function handleGamesHome(
  chatId: number,
  messageId: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = await getGamesCatalog();
  const sellable = catalog.filter((g) => g.sellable_count > 0);
  const popular = selectPopularGames(sellable.length ? sellable : catalog).slice(0, 9);

  const popularRefs = await Promise.all(popular.map(async (g) => ({ game: g, ref: await gameCallbackRef(g.slug) })));
  const rows: InlineKeyboardButton[][] = twoColGrid(popularRefs, ({ game, ref }) => ({
    text: truncateBtn(game.name, 19),
    callback_data: cb.gamesOpen(ref),
  }));

  rows.push([
    { text: en ? `📂 All Games (${sellable.length})` : `📂 Semua Game (${sellable.length})`, callback_data: cb.gamesAll(0), style: "primary" },
    { text: en ? "🔎 Search Game" : "🔎 Cari Game", callback_data: cb.gamesSearch(), style: "primary" },
  ]);
  // Owner 27 Nov 2026: alternatif order lewat web, tepat di atas baris Home.
  rows.push([{ text: "🌐 Order Games via Web", url: `${SITE.gamesUrl}/`, style: "success" }]);
  rows.push([
    { text: en ? "🏷 Genres" : "🏷 Genre", callback_data: cb.gamesGenre("menu", 0), style: "primary" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: gamesHomeMessage(sellable.length, ctx.locale),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Daftar semua game (grid 2 kolom, 10/halaman). */
export async function handleGamesAll(
  chatId: number,
  messageId: number,
  requestedPage: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = (await getGamesCatalog()).filter((g) => g.sellable_count > 0);
  const totalPages = Math.max(1, Math.ceil(catalog.length / GAMES_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), totalPages - 1);
  const slice = catalog.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE);
  const refs = await Promise.all(slice.map(async (g) => ({ game: g, ref: await gameCallbackRef(g.slug) })));
  const rows = twoColGrid(refs, ({ game, ref }) => ({
    text: truncateBtn(game.name, 19),
    callback_data: cb.gamesOpen(ref),
  }));
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.gamesAll(page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.gamesAll(page + 1) });
  if (nav.length) rows.push(nav);
  rows.push([
    { text: en ? "◀️ Popular" : "◀️ Populer", callback_data: cb.gamesHome() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: gamesCatalogListMessage({
      title: en ? "All Games" : "Semua Game",
      total: catalog.length,
      page,
      totalPages,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Menu genre / daftar game per genre (`gmg:<genre>:<page>`). */
export async function handleGamesGenre(
  chatId: number,
  messageId: number,
  genre: string,
  requestedPage: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = (await getGamesCatalog()).filter((g) => g.sellable_count > 0);

  if (genre === "menu" || !GAMES_GENRES.includes(genre as GamesGenre) || genre === "all") {
    const genreList = GAMES_GENRES.filter((g): g is Exclude<GamesGenre, "all"> => g !== "all");
    const rows = twoColGrid(genreList, (g) => {
      const count = catalog.filter((item) => GAMES_GENRE_BY_SLUG[item.slug] === g).length;
      const meta = GENRE_LABELS[g];
      return {
        text: `${meta.icon} ${en ? meta.en : meta.id} (${count})`,
        callback_data: cb.gamesGenre(g, 0),
      };
    });
    rows.push([
      { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.gamesHome() },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ]);
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: en ? "<b>🏷 Choose Game Genre</b>" : "<b>🏷 Pilih Genre Game</b>",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    }, sourceMeta);
    return;
  }

  const typedGenre = genre as Exclude<GamesGenre, "all">;
  const filtered = catalog.filter((item) => GAMES_GENRE_BY_SLUG[item.slug] === typedGenre);
  const totalPages = Math.max(1, Math.ceil(filtered.length / GAMES_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), totalPages - 1);
  const slice = filtered.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE);
  const refs = await Promise.all(slice.map(async (g) => ({ game: g, ref: await gameCallbackRef(g.slug) })));
  const rows = twoColGrid(refs, ({ game, ref }) => ({
    text: truncateBtn(game.name, 19),
    callback_data: cb.gamesOpen(ref),
  }));
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.gamesGenre(typedGenre, page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.gamesGenre(typedGenre, page + 1) });
  if (nav.length) rows.push(nav);
  rows.push([
    { text: en ? "◀️ Genres" : "◀️ Genre", callback_data: cb.gamesGenre("menu", 0) },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);

  const meta = GENRE_LABELS[typedGenre];
  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: gamesCatalogListMessage({
      title: `${meta.icon} ${en ? meta.en : meta.id}`,
      total: filtered.length,
      page,
      totalPages,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Prompt cari game (`gmq`). */
export async function handleGamesSearchPrompt(
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, "gm_search:"))) return;
  await sendMessage({
    chat_id: chatId,
    text: en
      ? "🔎 Type the game name you are looking for (e.g. <code>ml</code>, <code>ff</code>, <code>genshin</code>, <code>valorant</code>).\nType /batal to cancel."
      : "🔎 Ketik nama game yang dicari (mis. <code>ml</code>, <code>ff</code>, <code>genshin</code>, <code>valorant</code>).\nKetik /batal untuk membatalkan.",
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Mobile Legends, FF, Genshin…" },
  });
}

type TypeBucket = { label: string; regionCode: string | null; products: GamesDetailProduct[] };

/** Susun daftar tipe/region game (Indonesia pertama bila ada, lalu terbanyak). */
function buildTypeBuckets(available: GamesDetailProduct[]): TypeBucket[] {
  const map = new Map<string, TypeBucket>();
  for (const p of available) {
    const label = p.type_label || "Utama";
    let bucket = map.get(label);
    if (!bucket) {
      bucket = { label, regionCode: p.region_code, products: [] };
      map.set(label, bucket);
    }
    bucket.products.push(p);
  }
  return [...map.values()].sort((a, b) => {
    const aId = a.regionCode === "ID" || a.label.toLowerCase() === "indonesia" ? 0 : 1;
    const bId = b.regionCode === "ID" || b.label.toLowerCase() === "indonesia" ? 0 : 1;
    if (aId !== bId) return aId - bId;
    return b.products.length - a.products.length || a.label.localeCompare(b.label);
  });
}

/** Peta buyer_sku_code -> games_products.id agar callback `gmv:<id>` selalu ≤ 14 byte. */
async function skuIdMapForSlug(slug: string): Promise<Map<string, number>> {
  const db = createDatabaseAccess();
  const rows = await db.queryAll(
    `SELECT id, buyer_sku_code FROM games_products WHERE supplier='sekalipay' AND game_slug=?`,
    slug,
  ).catch(() => []);
  const map = new Map<string, number>();
  for (const r of rows) {
    const id = Number(r.id);
    if (Number.isSafeInteger(id) && id > 0) map.set(String(r.buyer_sku_code), id);
  }
  return map;
}

/** Langkah 2 — Pilih Nominal (`gmo:<ref>` & `gmt:<ref>:<typeIdx>:<cat>:<range>:<page>`). */
export async function handleGamesOpen(
  chatId: number,
  messageId: number,
  slugOrRef: string,
  opts: { typeIdx?: number; cat?: "a" | "p"; range?: PriceRangeCode; page?: number },
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const slug = await resolveGameSlug(slugOrRef);
  const detail = await getGamesDetail(slug, ctx.locale);
  if (!detail) {
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: en ? "❌ Game not found." : "❌ Game tidak ditemukan.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🎮 Top Up Games", callback_data: cb.gamesHome() }]] },
    }, sourceMeta);
    return;
  }

  const available = detail.products.filter((p) => p.available);
  const ref = await gameCallbackRef(detail.game.slug);
  const orderingOpen = gamesOrderingOpen();
  const idMap = await skuIdMapForSlug(detail.game.slug);

  const buckets = buildTypeBuckets(available);
  const safeTypeIdx = buckets.length > 0
    ? Math.min(Math.max(0, Math.floor(Number(opts.typeIdx ?? 0) || 0)), buckets.length - 1)
    : 0;
  const activeBucket = buckets[safeTypeIdx];
  const bucketProducts = activeBucket ? activeBucket.products : available;

  const passProducts = bucketProducts.filter((p) => p.category === "pass" || p.category === "first_topup" || p.category === "pack");
  const hasPassTab = passProducts.length > 0 && bucketProducts.length > 12;
  const activeCat: "a" | "p" = opts.cat === "p" && hasPassTab ? "p" : "a";
  const catFiltered = activeCat === "p" ? passProducts : bucketProducts;

  const activeRange: PriceRangeCode = opts.range && ["0", "1", "2", "3"].includes(opts.range) ? opts.range : "0";
  const showRangeFilter = catFiltered.length > 10 || activeRange !== "0";
  const finalList = showRangeFilter ? catFiltered.filter((p) => matchesPriceRange(p.price, activeRange)) : catFiltered;

  const totalPages = Math.max(1, Math.ceil(finalList.length / SKUS_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(opts.page ?? 0) || 0)), totalPages - 1);
  const pageItems = finalList.slice(page * SKUS_PER_PAGE, (page + 1) * SKUS_PER_PAGE);

  const rows: InlineKeyboardButton[][] = [];

  // Shortcut Pass & Membership di baris teratas untuk game besar
  if (hasPassTab) {
    rows.push([
      {
        text: activeCat === "a" ? (en ? "• All Packages" : "• Semua Nominal") : (en ? "All Packages" : "Semua Nominal"),
        callback_data: cb.gamesTab(ref, safeTypeIdx, "a", "0", 0),
        style: "primary",
      },
      {
        text: activeCat === "p"
          ? `• 🎫 Pass (${passProducts.length})`
          : `🎫 Pass & Member (${passProducts.length})`,
        callback_data: cb.gamesTab(ref, safeTypeIdx, "p", "0", 0),
        style: "primary",
      },
    ]);
  }

  // Filter rentang harga dinamis
  if (showRangeFilter) {
    const rBtn = (code: PriceRangeCode, label: string): InlineKeyboardButton => ({
      text: activeRange === code ? `• ${label}` : label,
      callback_data: cb.gamesTab(ref, safeTypeIdx, activeCat, code, 0),
      style: "primary",
    });
    rows.push([
      rBtn("0", en ? "All" : "Semua"),
      rBtn("1", en ? "<20k" : "<20rb"),
      rBtn("2", en ? "20–100k" : "20–100rb"),
      rBtn("3", en ? ">100k" : ">100rb"),
    ]);
  }

  // Grid nominal 2 kolom (10 SKU/halaman)
  const validPageItems = pageItems.filter((p) => idMap.has(p.buyer_sku_code));
  rows.push(
    ...twoColGrid(validPageItems, (p) => ({
      text: compactSkuButtonLabel(p.name, p.price, ctx),
      callback_data: cb.gamesVariant(idMap.get(p.buyer_sku_code)!),
      style: "success",
    })),
  );

  // Pagination
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.gamesTab(ref, safeTypeIdx, activeCat, activeRange, page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.gamesTab(ref, safeTypeIdx, activeCat, activeRange, page + 1) });
  if (nav.length) rows.push(nav);

  // Aksi cepat bawah: Cari Nominal + Region Lain
  const quickRow: InlineKeyboardButton[] = [];
  if (available.length > 6) {
    quickRow.push({
      text: en ? "🔢 Search Package" : "🔢 Cari Nominal",
      callback_data: cb.gamesSearchSku(ref, safeTypeIdx),
      style: "primary",
    });
  }
  if (buckets.length > 1) {
    quickRow.push({
      text: en ? `🌏 Regions (${buckets.length})` : `🌏 Region Lain (${buckets.length})`,
      callback_data: cb.gamesRegions(ref),
      style: "primary",
    });
  }
  if (quickRow.length) rows.push(quickRow);

  rows.push([
    { text: en ? "◀️ Games" : "◀️ Daftar Game", callback_data: cb.gamesHome(), style: "primary" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);

  const caption = gamesDetailMessage({
    gameName: detail.game.name,
    description: detail.game.description,
    activeTypeLabel: buckets.length > 1 ? activeBucket?.label : (activeBucket?.label !== "Utama" ? activeBucket?.label : null),
    activeCategoryLabel: activeCat === "p" ? "🎫 Pass & Membership" : null,
    activeRangeLabel: rangeLabel(activeRange, ctx.locale),
    shownCount: validPageItems.length,
    totalInScope: finalList.length,
    page,
    totalPages,
    orderingOpen,
    locale: ctx.locale,
  });

  const rawSite = (process.env.SITE_URL ?? "").trim().replace(/\/$/, "");
  const siteUrl = /^https?:\/\//i.test(rawSite) ? rawSite : "https://axvara.tech";
  const assetPath = detail.game.banner || detail.game.icon;
  const photoUrl = assetPath && assetPath.startsWith("/") ? `${siteUrl}${assetPath}` : null;

  if (photoUrl && caption.length <= 1024) {
    const res = await replaceWithPhoto({
      chat_id: chatId,
      message_id: messageId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    }, sourceMeta).catch(() => ({ ok: false as const }));
    if (res?.ok) return;
  }

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: caption,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Pemilih Region/Tipe game (`gmr:<ref>`). */
export async function handleGamesRegions(
  chatId: number,
  messageId: number,
  slugOrRef: string,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const slug = await resolveGameSlug(slugOrRef);
  const detail = await getGamesDetail(slug, ctx.locale);
  if (!detail) {
    await handleGamesHome(chatId, messageId, from, sourceMeta);
    return;
  }
  const ref = await gameCallbackRef(detail.game.slug);
  const buckets = buildTypeBuckets(detail.products.filter((p) => p.available));
  const rows = twoColGrid(
    buckets.map((b, idx) => ({ b, idx })),
    ({ b, idx }) => ({
      text: `${truncateBtn(b.label, 16)} (${b.products.length})`,
      callback_data: cb.gamesTab(ref, idx, "a", "0", 0),
    }),
  );
  rows.push([
    { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.gamesOpen(ref) },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: en
      ? `<b>🌏 Choose Region / Type — ${detail.game.name}</b>`
      : `<b>🌏 Pilih Region / Tipe — ${detail.game.name}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Prompt cari nominal (`gms:<ref>:<typeIdx>`). */
export async function handleGamesSkuSearchPrompt(
  chatId: number,
  slugOrRef: string,
  typeIdx: number,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const slug = await resolveGameSlug(slugOrRef);
  const safeType = Math.max(0, Math.floor(Number(typeIdx) || 0));
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `gm_skusearch:${slug}:${safeType}`))) return;
  await sendMessage({
    chat_id: chatId,
    text: en
      ? "🔢 Type the amount or package name you want (e.g. <code>85</code>, <code>257</code>, <code>weekly</code>, <code>starlight</code>).\nType /batal to cancel."
      : "🔢 Ketik angka atau nama nominal yang dicari (mis. <code>85</code>, <code>257</code>, <code>weekly</code>, <code>starlight</code>).\nKetik /batal untuk membatalkan.",
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "85, 257, weekly…" },
  });
}

async function loadGamesProductRow(productId: number) {
  return queryFirst(
    `SELECT gp.*, gm.display_name AS game_display_name, gm.id_guide AS game_id_guide
       FROM games_products gp
       LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
      WHERE gp.id=? AND gp.supplier='sekalipay'`,
    productId,
  ).catch(() => null);
}

async function findLastSavedGameAccount(userId: string, gameSlug: string): Promise<{
  target: { note: string; zone_id?: string };
  display: string;
  nickname: string | null;
} | null> {
  const row = await queryFirst(
    `SELECT gi.target_snapshot, gi.customer_no, gi.customer_nickname
       FROM orders o
       JOIN games_order_items gi ON gi.order_code=o.code
       JOIN games_products gp ON gp.id=gi.product_id
      WHERE o.sales_channel='telegram' AND o.telegram_user_id=?
        AND gp.game_slug=? AND gi.target_snapshot IS NOT NULL
      ORDER BY o.id DESC LIMIT 1`,
    userId, gameSlug,
  ).catch(() => null);
  if (!row) return null;
  const parsed = parseGamesSkTargetSnapshot(row.target_snapshot);
  if (!parsed) return null;
  const display = parsed.zone_id ? `${parsed.note} (${parsed.zone_id})` : parsed.note;
  return {
    target: parsed,
    display,
    nickname: row.customer_nickname ? String(row.customer_nickname).trim() : null,
  };
}

/** Langkah 3 — Pilih Varian → Tawarkan ID Terakhir atau Prompt Input ID (`gmv:<id>` / `gme:<id>`). */
export async function handleGamesSelectVariant(
  chatId: number,
  messageId: number,
  gamesProductId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
  opts: { forceNewId?: boolean } = {},
): Promise<void> {
  if (await notifyPaymentMaintenance(chatId)) return;
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  if (!gamesOrderingOpen()) {
    await sendMessage({
      chat_id: chatId,
      text: gamesPreviewMessage(ctx.locale),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }

  const row = await loadGamesProductRow(gamesProductId);
  const contract = row ? parseGamesSkContract(row.required_fields_json) : null;
  const stock = Number(row?.stock ?? 0);
  if (
    !row
    || Number(row.enabled) !== 1
    || Number(row.supplier_active) !== 1
    || !(stock === -1 || stock > 0)
    || Number(row.min_order) !== 1
    || !contract?.supported
    || !(Number(row.sell_price) > 0)
  ) {
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "⚠️ This package is currently unavailable. Please choose another package."
        : "⚠️ Nominal ini sedang tidak tersedia. Silakan pilih nominal lain.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🎮 Top Up Games", callback_data: cb.gamesHome() }]] },
    });
    return;
  }

  const slug = String(row.game_slug ?? "").trim();
  const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").trim();
  const packageName = gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug }) || String(row.product_name ?? "");
  const price = Number(row.sell_price);
  const ref = await gameCallbackRef(slug);

  // Cek ID terakhir milik user untuk game yang sama (tanpa tabel baru!)
  if (!opts.forceNewId) {
    const saved = await findLastSavedGameAccount(String(from.id), slug);
    if (saved) {
      const validSaved = validateGamesSkTarget(contract, saved.target);
      if (validSaved.ok) {
        await replaceWithText({
          chat_id: chatId,
          message_id: messageId,
          text: gamesSavedAccountPromptMessage({
            gameName,
            packageName,
            price,
            savedDisplay: saved.display,
            savedNickname: saved.nickname,
            ctx,
          }),
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: `👤 ${en ? "Use" : "Pakai"} ${truncateBtn(saved.display, 26)}`, callback_data: cb.gamesUseSaved(gamesProductId), style: "success" }],
              [{ text: en ? "✏️ Enter New ID" : "✏️ Masukkan ID Baru", callback_data: cb.gamesEditId(gamesProductId), style: "primary" }],
              [
                { text: en ? "◀️ Packages" : "◀️ Ganti Nominal", callback_data: cb.gamesOpen(ref), style: "primary" },
                { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
              ],
            ],
          },
        }, sourceMeta);
        return;
      }
    }
  }

  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `gm_acct:${gamesProductId}`))) return;
  const noteField = contract.fields.find((f) => f.key === "note");
  const zoneField = contract.fields.find((f) => f.key === "zone_id");
  await sendMessage({
    chat_id: chatId,
    text: gamesAccountInputPromptMessage({
      gameName,
      packageName,
      price,
      requiresZone: contract.requires_zone_id,
      noteLabel: noteField?.label || (contract.requires_zone_id ? "User ID" : "Player ID"),
      zoneLabel: zoneField?.label || "Zone ID",
      idGuide: row.game_id_guide ? String(row.game_id_guide) : null,
      ctx,
    }),
    parse_mode: "HTML",
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: contract.requires_zone_id ? "12345678 1234" : "1234567890",
    },
  });
}

/** Langkah 3b — Pakai ID terakhir (`gmu:<id>`). */
export async function handleGamesUseSavedAccount(
  chatId: number,
  messageId: number,
  gamesProductId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const row = await loadGamesProductRow(gamesProductId);
  if (!row) {
    await handleGamesHome(chatId, messageId, from, sourceMeta);
    return;
  }
  const slug = String(row.game_slug ?? "").trim();
  const saved = await findLastSavedGameAccount(String(from.id), slug);
  if (!saved) {
    await handleGamesSelectVariant(chatId, messageId, gamesProductId, from, sourceMeta, { forceNewId: true });
    return;
  }
  await showGamesReviewAndPaymentOffer(chatId, messageId, row, saved.target, from, undefined);
}

/** Parser pintar input ID 1-pesan: mendukung spasi, kurung `(1234)`, `|`, `/`, `-`. */
export function parseGamesAccountInput(raw: string, contract: GamesSkContract): {
  note: string;
  zone_id?: string;
  needsZoneStep?: boolean;
} | null {
  const text = raw.trim();
  if (!text) return null;
  if (!contract.requires_zone_id) {
    return { note: text };
  }
  // Format 1: `12345678 (1234)` atau `12345678(1234)`
  const paren = /^(.+?)\s*\(\s*([^()]+?)\s*\)$/.exec(text);
  if (paren) {
    return { note: paren[1].trim(), zone_id: paren[2].trim() };
  }
  // Format 2: `12345678|1234` atau `12345678/1234`
  const sep = /^([^|/]+?)\s*[|/]\s*([^|/]+)$/.exec(text);
  if (sep) {
    return { note: sep[1].trim(), zone_id: sep[2].trim() };
  }
  // Format 3: 2 token dipisah spasi (`12345678 1234`) atau 1 tanda hubung (`12345678-1234`)
  const parts = text.split(/\s+/);
  if (parts.length === 2) {
    return { note: parts[0], zone_id: parts[1] };
  }
  const dash = /^([A-Za-z0-9_.]+)-([A-Za-z0-9_.]+)$/.exec(text);
  if (dash) {
    return { note: dash[1], zone_id: dash[2] };
  }
  // User hanya kirim User ID → lanjut langkah tanya Zone ID
  return { note: text, needsZoneStep: true };
}

/** Langkah 4 — Cek Nickname Gratis + Region Hint + Freeze `payq1` (QRIS + Crypto). */
async function showGamesReviewAndPaymentOffer(
  chatId: number,
  messageId: number,
  row: Record<string, unknown>,
  rawTarget: { note: string; zone_id?: string },
  from: { id: number; first_name: string; username?: string },
  allowPendingAction?: string,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const contract = parseGamesSkContract(row.required_fields_json);
  const validated = contract ? validateGamesSkTarget(contract, rawTarget) : null;
  if (!contract?.supported || !validated?.ok) {
    await sendMessage({
      chat_id: chatId,
      text: en
        ? "❌ Invalid account ID format. Please double-check and send again, or type /batal."
        : "❌ Format ID akun tidak valid. Periksa lagi lalu kirim ulang, atau ketik /batal.",
      parse_mode: "HTML",
    });
    return;
  }

  const slug = String(row.game_slug ?? "").trim();
  const productId = Number(row.id);
  const skVariantId = Number(row.sk_variant_id);
  const price = Number(row.sell_price);
  const cost = Number(row.cost);
  const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").trim();
  const packageName = gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug }) || String(row.product_name ?? "");
  const typeName = String(row.product_type_name ?? "").trim();
  const { gamesTypeLabel, gamesRegionCode } = await import("@/lib/games/variant-kind");
  const typeLabel = gamesTypeLabel(typeName);
  const variantRegionCode = gamesRegionCode(typeName);

  // Cek nickname gratis via Sekalipay (non-blocking pada kegagalan)
  let nickname: string | null = null;
  let nicknameUnavailable = false;
  if (contract.validation_available) {
    await sendChatAction(chatId, "typing").catch(() => {});
    const nick = await checkSkGamesNickname(createDatabaseAccess(), {
      variantId: skVariantId,
      contract,
      target: validated.target,
      display: validated.display,
      device: `tg:${from.id}`,
    }).catch(() => ({ status: "unavailable" as const }));
    if (nick.status === "ok") {
      nickname = nick.nickname;
    } else if (nick.status === "invalid") {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? "❌ Game account ID was not found. Please check your ID and try again, or type /batal."
          : "❌ ID akun game tidak ditemukan. Periksa ulang ID kamu lalu kirim lagi, atau ketik /batal.",
        parse_mode: "HTML",
      });
      return;
    } else {
      nicknameUnavailable = true;
    }
  }

  // Deteksi konflik region (paritas Web — saran saja, tidak memblokir)
  let regionWarning: { accountRegion: string; variantRegion: string } | null = null;
  let switchRegionRow: InlineKeyboardButton[] | null = null;
  if (nickname && variantRegionCode && variantRegionCode !== "GLOBAL") {
    const parts = splitNicknameRegion(nickname);
    if (parts.code && parts.code !== variantRegionCode) {
      regionWarning = {
        accountRegion: parts.region || parts.code,
        variantRegion: typeLabel || variantRegionCode,
      };
      // Cari apakah game ini punya tipe/region sesuai akun
      const detail = await getGamesDetail(slug, ctx.locale).catch(() => null);
      if (detail) {
        const buckets = buildTypeBuckets(detail.products.filter((p) => p.available));
        const matchIdx = buckets.findIndex((b) => b.regionCode === parts.code);
        if (matchIdx >= 0) {
          const ref = await gameCallbackRef(slug);
          switchRegionRow = [{
            text: en ? `🔄 Switch to ${buckets[matchIdx].label}` : `🔄 Pindah ke Region ${buckets[matchIdx].label}`,
            callback_data: cb.gamesTab(ref, matchIdx, "a", "0", 0),
            style: "primary",
          }];
        }
      }
    }
  }

  const contractDigest = await gamesSkContractDigest(row.required_fields_json);
  const tag = await gamesApprovalTag({
    productId,
    skVariantId,
    price,
    cost,
    contractDigest,
    display: validated.display,
  });

  const source: Payq1GamesSource = {
    kind: "games",
    productId,
    skVariantId,
    sku: String(row.buyer_sku_code),
    slug,
    note: validated.target.note,
    ...(validated.target.zone_id ? { zoneId: validated.target.zone_id } : {}),
    ...(nickname ? { nickname } : {}),
    contractDigest,
    costSnapshot: cost,
  };

  const frozen = await freezePayq1({
    fromUserId: String(from.id),
    locale: ctx.locale,
    tag,
    identity: source,
    idrSubtotal: price,
    contactEmail: null,
    ...(allowPendingAction ? { allowPendingAction } : {}),
  });

  if (!frozen.ok) {
    await sendMessage({
      chat_id: chatId,
      text: frozen.reason === "namespace_busy"
        ? paymentMethodNoticeMessage("deferred", { locale: ctx.locale })
        : paymentMethodNoticeMessage("unavailable", { locale: ctx.locale }),
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }

  const accountDisplay = validated.target.zone_id
    ? `${validated.target.note} (${validated.target.zone_id})`
    : validated.target.note;

  const reviewText = gamesReviewMessage({
    gameName,
    packageName,
    typeLabel,
    accountDisplay,
    nickname,
    nicknameUnavailable,
    regionWarning,
    total: price,
    ctx,
  });
  const methodDetails = paymentMethodOfferDetails(frozen.state.methods, { locale: ctx.locale, subtotal: price });
  const baseMarkup = paymentMethodOfferKeyboard(
    { nonce: frozen.state.nonce, methods: frozen.state.methods, source: { kind: "games", productId, slug }, idrSubtotal: price },
    { locale: ctx.locale },
  );
  const inlineKeyboard: InlineKeyboardMarkup = switchRegionRow
    ? { inline_keyboard: [switchRegionRow, ...baseMarkup.inline_keyboard] }
    : baseMarkup;

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: `${reviewText}\n\n${methodDetails.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: inlineKeyboard,
  });
}

/** Handler input teks pending untuk Games (`gm_search:`, `gm_skusearch:`, `gm_acct:`, `gm_zone:`). */
export async function handleGamesPendingInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode() || !text.trim()) return false;
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return false;
  const user = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, String(from.id)).catch(() => null);
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("gm_")) return false;

  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const clearExact = () => execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    String(from.id), action,
  ).catch(() => ({}));

  // 1. Cari Game (`gm_search:`)
  if (action === "gm_search:") {
    const q = text.trim();
    if (q.length < 2) {
      await sendMessage({
        chat_id: chatId,
        text: en ? "❌ Type at least 2 characters (e.g. <code>ml</code>, <code>ff</code>)." : "❌ Minimal 2 huruf (mis. <code>ml</code>, <code>ff</code>).",
        parse_mode: "HTML",
      });
      return true;
    }
    await clearExact();
    const matches = await searchGamesCatalog(q);
    if (!matches.length) {
      await sendMessage({
        chat_id: chatId,
        text: en ? `No games found for "<b>${q.slice(0, 40)}</b>".` : `Game "<b>${q.slice(0, 40)}</b>" belum ditemukan.`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "📂 All Games" : "📂 Semua Game", callback_data: cb.gamesAll(0) },
            { text: en ? "🔎 Try Again" : "🔎 Cari Lagi", callback_data: cb.gamesSearch() },
          ]],
        },
      });
      return true;
    }
    const refs = await Promise.all(matches.slice(0, 10).map(async (g) => ({ game: g, ref: await gameCallbackRef(g.slug) })));
    const rows = twoColGrid(refs, ({ game, ref }) => ({
      text: truncateBtn(game.name, 19),
      callback_data: cb.gamesOpen(ref),
    }));
    rows.push([
      { text: en ? "◀️ Games" : "◀️ Daftar Game", callback_data: cb.gamesHome() },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ]);
    await sendMessage({
      chat_id: chatId,
      text: en ? `🎮 Search results (${matches.length}):` : `🎮 Hasil pencarian game (${matches.length}):`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    });
    return true;
  }

  // 2. Cari Nominal dalam 1 Game (`gm_skusearch:<slug>:<typeIdx>`)
  if (action.startsWith("gm_skusearch:")) {
    const [, slug, typeIdxRaw] = action.split(":");
    const typeIdx = Math.max(0, Number(typeIdxRaw) || 0);
    await clearExact();
    const detail = await getGamesDetail(slug, ctx.locale);
    if (!detail) {
      await handleGamesHome(chatId, 0, from);
      return true;
    }
    const ref = await gameCallbackRef(detail.game.slug);
    const available = detail.products.filter((p) => p.available);
    const buckets = buildTypeBuckets(available);
    const activeBucket = buckets[Math.min(typeIdx, Math.max(0, buckets.length - 1))];
    const scope = activeBucket ? activeBucket.products : available;
    const q = text.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const aliasExpand = (s: string) => s
      .replace(/\bwdp\b/g, "weekly diamond pass")
      .replace(/\bdm\b/g, "diamond");
    const expandedTokens = aliasExpand(q).split(/\s+/).filter(Boolean);
    const matched = scope.filter((p) => {
      const hay = `${p.name} ${p.buyer_sku_code} ${p.type_label ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t)) || expandedTokens.every((t) => hay.includes(t));
    });
    const idMap = await skuIdMapForSlug(detail.game.slug);
    const usable = matched.filter((p) => idMap.has(p.buyer_sku_code)).slice(0, 10);
    if (!usable.length) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `No matching packages for "<b>${text.trim().slice(0, 40)}</b>" in ${detail.game.name}.`
          : `Nominal "<b>${text.trim().slice(0, 40)}</b>" tidak ditemukan di ${detail.game.name}.`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "🔢 Search Again" : "🔢 Cari Lagi", callback_data: cb.gamesSearchSku(ref, typeIdx) },
            { text: en ? "◀️ All Packages" : "◀️ Lihat Nominal", callback_data: cb.gamesOpen(ref) },
          ]],
        },
      });
      return true;
    }
    const rows = twoColGrid(usable, (p) => ({
      text: compactSkuButtonLabel(p.name, p.price, ctx),
      callback_data: cb.gamesVariant(idMap.get(p.buyer_sku_code)!),
      style: "success",
    }));
    rows.push([
      { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.gamesOpen(ref) },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ]);
    await sendMessage({
      chat_id: chatId,
      text: en
        ? `🔢 Matching packages in <b>${detail.game.name}</b> (${matched.length}):`
        : `🔢 Nominal cocok di <b>${detail.game.name}</b> (${matched.length}):`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    });
    return true;
  }

  // 3. Input ID Akun (`gm_acct:<productId>`)
  if (action.startsWith("gm_acct:")) {
    const productId = Number(action.slice("gm_acct:".length));
    const row = productId > 0 ? await loadGamesProductRow(productId) : null;
    const contract = row ? parseGamesSkContract(row.required_fields_json) : null;
    if (!row || !contract?.supported) {
      await clearExact();
      await sendMessage({ chat_id: chatId, text: en ? "Package no longer available." : "Nominal tidak lagi tersedia.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
      return true;
    }
    const parsed = parseGamesAccountInput(text, contract);
    if (!parsed) {
      await sendMessage({ chat_id: chatId, text: en ? "❌ Please send a valid account ID." : "❌ Kirim ID akun yang valid.", parse_mode: "HTML" });
      return true;
    }
    if (parsed.needsZoneStep) {
      const nextState = `gm_zone:${JSON.stringify({ p: productId, n: parsed.note })}`;
      await execRun(
        `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
        nextState, String(from.id), action,
      ).catch(() => ({}));
      const slug = String(row.game_slug ?? "").trim();
      const gameName = String(row.game_display_name || row.sk_product_name || row.game_brand || "Games").trim();
      const packageName = gamesVariantName(String(row.product_name ?? ""), { name: gameName, slug }) || String(row.product_name ?? "");
      const noteField = contract.fields.find((f) => f.key === "note");
      const zoneField = contract.fields.find((f) => f.key === "zone_id");
      await sendMessage({
        chat_id: chatId,
        text: gamesAccountInputPromptMessage({
          gameName,
          packageName,
          price: Number(row.sell_price),
          requiresZone: true,
          noteLabel: noteField?.label || "User ID",
          zoneLabel: zoneField?.label || "Zone ID",
          stepZoneOnly: { noteValue: parsed.note },
          ctx,
        }),
        parse_mode: "HTML",
        reply_markup: { force_reply: true, selective: true, input_field_placeholder: "1234" },
      });
      return true;
    }
    await showGamesReviewAndPaymentOffer(chatId, 0, row, { note: parsed.note, ...(parsed.zone_id ? { zone_id: parsed.zone_id } : {}) }, from, action);
    return true;
  }

  // 4. Input Zone ID tahap 2 (`gm_zone:{"p":...,"n":...}`)
  if (action.startsWith("gm_zone:")) {
    let payload: { p?: number; n?: string } | null = null;
    try { payload = JSON.parse(action.slice("gm_zone:".length)); } catch { payload = null; }
    const productId = Number(payload?.p ?? 0);
    const note = String(payload?.n ?? "").trim();
    const row = productId > 0 && note ? await loadGamesProductRow(productId) : null;
    if (!row) {
      await clearExact();
      await sendMessage({ chat_id: chatId, text: en ? "Session expired. Please choose the package again." : "Sesi berakhir. Silakan pilih nominal ulang.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
      return true;
    }
    const zoneId = text.trim().replace(/^[(\s]+|[)\s]+$/g, "");
    await showGamesReviewAndPaymentOffer(chatId, 0, row, { note, zone_id: zoneId }, from, action);
    return true;
  }

  return false;
}

/** Dispatcher callback untuk semua prefix `gm*`. */
export async function handleGamesCallback(
  action: string,
  params: string[],
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<boolean> {
  switch (action) {
    case "gmh":
      await handleGamesHome(chatId, messageId, from, sourceMeta);
      return true;
    case "gma":
      await handleGamesAll(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      return true;
    case "gmg":
      await handleGamesGenre(chatId, messageId, String(params[0] || "menu"), Number(params[1] || 0), from, sourceMeta);
      return true;
    case "gmq":
      await handleGamesSearchPrompt(chatId, from);
      return true;
    case "gmo":
      await handleGamesOpen(chatId, messageId, String(params[0] || ""), {}, from, sourceMeta);
      return true;
    case "gmr":
      await handleGamesRegions(chatId, messageId, String(params[0] || ""), from, sourceMeta);
      return true;
    case "gms":
      await handleGamesSkuSearchPrompt(chatId, String(params[0] || ""), Number(params[1] || 0), from);
      return true;
    case "gmt": {
      const ref = String(params[0] || "");
      const typeIdx = Number(params[1] || 0);
      const cat = params[2] === "p" ? "p" : "a";
      const range = (["0", "1", "2", "3"].includes(String(params[3])) ? String(params[3]) : "0") as PriceRangeCode;
      const page = Number(params[4] || 0);
      await handleGamesOpen(chatId, messageId, ref, { typeIdx, cat, range, page }, from, sourceMeta);
      return true;
    }
    case "gmv":
      await handleGamesSelectVariant(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      return true;
    case "gmu":
      await handleGamesUseSavedAccount(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      return true;
    case "gme":
      await handleGamesSelectVariant(chatId, messageId, Number(params[0] || 0), from, sourceMeta, { forceNewId: true });
      return true;
    default:
      return false;
  }
}
