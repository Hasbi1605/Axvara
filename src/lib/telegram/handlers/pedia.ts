// src/lib/telegram/handlers/pedia.ts — Alur 100% native AXVARA Pedia di Bot Telegram.
// Fitur utama:
// - Jalur A (Killer UX): tempel link sosmed langsung di chat -> auto-detect `detectPediaLink()`
//   -> tawarkan layanan cocok -> lewati input link!
// - Jalur B (Menu): 8 platform populer + Semua Platform (33) + Cari Layanan
// - Daftar tier bernomor di body + tombol angka 1..5 + filter 1-klik (Indo / Global / Refill)
//   (filter & pagination otomatis disembunyikan untuk 79% produk yang hanya 1-3 tier!)
// - Quick quantities 2 kolom + ketik jumlah bebas + Custom Comments multi-baris
// - Freeze `payq1` (QRIS + Crypto) + tombol `♻️ Ajukan Refill` (`pdrf:<code>`) di chat

import { createDatabaseAccess } from "@/lib/db-access";
import { execRun, isD1Mode, queryAll, queryFirst } from "@/lib/db";
import { loadPublicPediaProducts, type PediaCatalogProduct, type PediaCatalogTier } from "@/lib/pedia/public-catalog";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, pediaTargetMatches, type PediaPlatform } from "@/lib/pedia/link";
import { pediaMatches, pediaPlatform, pediaTargetExample } from "@/lib/pedia/platforms";
import { pediaBounds } from "@/lib/pedia/bounds";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { pediaMinOrderRp } from "@/lib/pedia/ops-config";
import { checkCustomComments, CUSTOM_COMMENT_MAX_LINES, pediaServiceTypeFor } from "@/lib/pedia/custom-comments";
import { executePediaRefill } from "@/lib/pedia/refill-action";
import { pediaNumber, pediaServiceName } from "@/lib/pedia/copy";
import { whiteLabel } from "@/lib/pedia/terms";
import { sendMessage } from "@/lib/telegram/api";
import {
  buttonPrice, cb, minimalMenuKeyboard, paymentMethodOfferKeyboard,
  type TgPriceCtx,
} from "@/lib/telegram/keyboards";
import { paymentMethodNoticeMessage, paymentMethodOfferDetails } from "@/lib/telegram/messages/purchase";
import {
  pediaAllPlatformsMessage,
  pediaCommentsPromptMessage,
  pediaHomeMessage,
  pediaLinkDetectedMessage,
  pediaPlatformProductsMessage,
  pediaQtyPromptMessage,
  pediaReviewMessage,
  pediaTargetPromptMessage,
  pediaTierDisplayName,
  pediaTierListMessage,
  type PediaTierFilter,
} from "@/lib/telegram/messages/pedia";
import { freezePayq1, type Payq1PediaSource } from "@/lib/telegram/payment-quote";
import { tgCtxFor, tgDisplayPrice } from "@/lib/telegram/render-prefs";
import { notifyPaymentMaintenance } from "@/lib/telegram/payment-maintenance";
import { pediaApprovalTag } from "@/lib/telegram/pedia-checkout";
import { replaceWithText, setPendingActionUnlessCreating, type ScreenSourceMeta } from "./shared";
import type { InlineKeyboardButton } from "@/lib/telegram/types";
import type { Locale } from "@/lib/i18n/locale";

const PLATFORMS_PER_PAGE = 10;
const PRODUCTS_PER_PAGE = 6;
const TIERS_PER_PAGE = 5;
const LINK_CTX_TTL_SEC = 900; // 15 menit

const POPULAR_PLATFORMS: readonly { id: string; icon: string }[] = [
  { id: "instagram", icon: "📸" },
  { id: "tiktok", icon: "🎵" },
  { id: "youtube", icon: "▶️" },
  { id: "facebook", icon: "📘" },
  { id: "threads", icon: "🧵" },
  { id: "x", icon: "𝕏" },
  { id: "telegram", icon: "✈️" },
  { id: "shopee", icon: "🛒" },
];

const PLATFORM_ICON_MAP = new Map<string, string>([
  ...POPULAR_PLATFORMS.map((p) => [p.id, p.icon] as const),
  ["spotify", "🎧"],
  ["linkedin", "💼"],
  ["pinterest", "📌"],
  ["discord", "💬"],
  ["twitch", "🟣"],
  ["soundcloud", "☁️"],
  ["github", "🐙"],
  ["website", "🌐"],
]);

export type TelegramPediaProduct = PediaCatalogProduct & { id: number };

function pediaPriceBtn(amount: number, ctx: TgPriceCtx): string {
  if (ctx.displayCurrency === "USD" && ctx.fx) {
    return tgDisplayPrice(amount, { locale: ctx.locale ?? "en", displayCurrency: "USD", fx: ctx.fx });
  }
  return buttonPrice(amount);
}

function truncateBtn(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function platformLabelOf(platformId: string): string {
  return PEDIA_PLATFORM_LABEL[platformId as PediaPlatform] ?? pediaPlatform(platformId)?.label ?? platformId;
}

function platformIconOf(platformId: string): string {
  return PLATFORM_ICON_MAP.get(platformId) ?? "📱";
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

/** Muat katalog publik Pedia dengan `id` produk dari D1 agar callback tetap ≤ 18 byte. */
export async function loadTelegramPediaCatalog(): Promise<TelegramPediaProduct[]> {
  if (process.env.PEDIA_ENABLED !== "true") return [];
  const [products, idRows] = await Promise.all([
    loadPublicPediaProducts().catch(() => [] as PediaCatalogProduct[]),
    queryAll(`SELECT id, slug FROM pedia_products WHERE is_active=1`).catch(() => []),
  ]);
  const idBySlug = new Map<string, number>();
  for (const r of idRows) {
    const id = Number(r.id);
    if (Number.isSafeInteger(id) && id > 0) idBySlug.set(String(r.slug), id);
  }
  return products.flatMap((p) => {
    const id = idBySlug.get(p.slug);
    return id ? [{ ...p, id }] : [];
  });
}

/** Pencarian katalog Pedia (dipakai oleh `pdsrc` DAN unified smart search Fase 3). */
export async function searchPediaCatalog(keyword: string): Promise<TelegramPediaProduct[]> {
  const q = keyword.trim();
  if (q.length < 2 || process.env.PEDIA_ENABLED !== "true") return [];
  const all = await loadTelegramPediaCatalog();
  return all.filter((p) => {
    const hay = `${p.name} ${p.platform} ${platformLabelOf(p.platform)} ${p.metric} ${p.tagline ?? ""}`;
    return pediaMatches(q, hay);
  });
}

/** Cek apakah pesan chat adalah URL media sosial (bukan kata biasa / username sembarang). */
function looksLikePediaUrl(text: string): boolean {
  const t = text.trim();
  if (!t || t.includes("\n") || /\s/.test(t) || t.length > 600) return false;
  return /^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,10}\/\S+/i.test(t);
}

type SavedLinkCtx = { r: string; n: string; p: string; k: string; exp: number };

async function readSavedLinkCtx(userId: string): Promise<SavedLinkCtx | null> {
  if (!isD1Mode()) return null;
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, userId).catch(() => null);
  const raw = row?.pending_action == null ? "" : String(row.pending_action);
  if (!raw.startsWith("pd_linkctx:")) return null;
  try {
    const parsed = JSON.parse(raw.slice("pd_linkctx:".length)) as SavedLinkCtx;
    if (parsed && typeof parsed.n === "string" && typeof parsed.p === "string" && typeof parsed.k === "string" && Number(parsed.exp) > Math.floor(Date.now() / 1000)) {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Jalur Masuk A (Killer UX): tempel link sosmed langsung di chat -> auto-detect
 * -> tawarkan layanan Pedia yang cocok dan simpan konteks link.
 */
export async function handlePediaPasteLink(
  text: string,
  chatId: number,
  from?: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (process.env.PEDIA_ENABLED !== "true") return false;
  if (!looksLikePediaUrl(text)) return false;
  const detected = detectPediaLink(text.trim());
  if (!detected) return false;

  const catalog = await loadTelegramPediaCatalog();
  const matching = catalog.filter(
    (p) => p.platform === detected.platform
      && pediaTargetMatches(p.target_kind, detected.targetKind, { platform: p.platform, metric: p.metric }),
  );
  if (!matching.length) return false;

  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  if (from && isD1Mode()) {
    const linkCtx: SavedLinkCtx = {
      r: text.trim().slice(0, 600),
      n: detected.normalized,
      p: detected.platform,
      k: detected.targetKind,
      exp: Math.floor(Date.now() / 1000) + LINK_CTX_TTL_SEC,
    };
    await setPendingActionUnlessCreating(String(from.id), chatId, `pd_linkctx:${JSON.stringify(linkCtx)}`);
  }

  const rows: InlineKeyboardButton[][] = matching.slice(0, 8).map((p) => {
    const name = en ? pediaServiceName(p.name, "en") : p.name;
    const minText = p.min_price != null ? ` · ${en ? "from" : "mulai"} ${pediaPriceBtn(p.min_price, ctx)}` : "";
    return [{
      text: `${truncateBtn(name, 26)}${minText}`,
      callback_data: cb.pediaLinkProduct(p.id),
      style: "success",
    }];
  });
  rows.push([
    { text: en ? "📈 All Pedia" : "📈 Semua Pedia", callback_data: cb.pediaHome(), style: "primary" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);

  await sendMessage({
    chat_id: chatId,
    text: pediaLinkDetectedMessage({
      platformLabel: platformLabelOf(detected.platform),
      targetKind: detected.targetKind,
      targetUrl: detected.normalized,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
  return true;
}

/** Beranda AXVARA Pedia (`pdh` / `/pedia` / tombol `📈 Sosmed Pedia`). */
export async function handlePediaHome(
  chatId: number,
  messageId: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  if (process.env.PEDIA_ENABLED !== "true") {
    await replaceWithText({
      chat_id: chatId,
      message_id: messageId,
      text: en
        ? "<b>📈 AXVARA Pedia</b>\nSocial media services are opening soon."
        : "<b>📈 AXVARA Pedia</b>\nLayanan sosial media segera hadir.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    }, sourceMeta);
    return;
  }

  const catalog = await loadTelegramPediaCatalog();
  const platformsPresent = [...new Set(catalog.map((p) => p.platform))];
  const popularItems = POPULAR_PLATFORMS.filter((p) => platformsPresent.includes(p.id));
  const shownPlatforms = popularItems.length
    ? popularItems
    : platformsPresent.slice(0, 8).map((id) => ({ id, icon: platformIconOf(id) }));

  const rows = twoColGrid(shownPlatforms, (p) => ({
    text: `${p.icon} ${platformLabelOf(p.id)}`,
    callback_data: cb.pediaPlatform(p.id, 0),
  }));
  rows.push([
    { text: en ? `📂 All Platforms (${platformsPresent.length})` : `📂 Semua Platform (${platformsPresent.length})`, callback_data: cb.pediaAll(0), style: "primary" },
    { text: en ? "🔎 Search" : "🔎 Cari Layanan", callback_data: cb.pediaSearch(), style: "primary" },
  ]);
  rows.push([{ text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" }]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: pediaHomeMessage(platformsPresent.length, catalog.length, ctx.locale),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Semua platform Pedia (`pda:<page>`). */
export async function handlePediaAllPlatforms(
  chatId: number,
  messageId: number,
  requestedPage: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = await loadTelegramPediaCatalog();
  const countByPlatform = new Map<string, number>();
  for (const p of catalog) countByPlatform.set(p.platform, (countByPlatform.get(p.platform) ?? 0) + 1);
  const platforms = [...countByPlatform.keys()].sort((a, b) => {
    const popA = POPULAR_PLATFORMS.findIndex((p) => p.id === a);
    const popB = POPULAR_PLATFORMS.findIndex((p) => p.id === b);
    if (popA !== -1 || popB !== -1) return (popA === -1 ? 99 : popA) - (popB === -1 ? 99 : popB);
    return (countByPlatform.get(b) ?? 0) - (countByPlatform.get(a) ?? 0) || a.localeCompare(b);
  });

  const totalPages = Math.max(1, Math.ceil(platforms.length / PLATFORMS_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), totalPages - 1);
  const slice = platforms.slice(page * PLATFORMS_PER_PAGE, (page + 1) * PLATFORMS_PER_PAGE);
  const rows = twoColGrid(slice, (id) => ({
    text: `${platformIconOf(id)} ${truncateBtn(platformLabelOf(id), 14)} (${countByPlatform.get(id) ?? 0})`,
    callback_data: cb.pediaPlatform(id, 0),
  }));
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.pediaAll(page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.pediaAll(page + 1) });
  if (nav.length) rows.push(nav);
  rows.push([
    { text: en ? "◀️ Popular" : "◀️ Populer", callback_data: cb.pediaHome() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: pediaAllPlatformsMessage(platforms.length, page, totalPages, ctx.locale),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Daftar produk per platform (`pdp:<platform>:<page>`). */
export async function handlePediaPlatform(
  chatId: number,
  messageId: number,
  platform: string,
  requestedPage: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = await loadTelegramPediaCatalog();
  const items = catalog.filter((p) => p.platform === platform);
  if (!items.length) {
    await handlePediaHome(chatId, messageId, from, sourceMeta);
    return;
  }
  const totalPages = Math.max(1, Math.ceil(items.length / PRODUCTS_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), totalPages - 1);
  const slice = items.slice(page * PRODUCTS_PER_PAGE, (page + 1) * PRODUCTS_PER_PAGE);
  const rows: InlineKeyboardButton[][] = slice.map((p) => {
    const name = en ? pediaServiceName(p.name, "en") : p.name;
    const minStr = p.min_price != null ? ` · ${en ? "from" : "mulai"} ${pediaPriceBtn(p.min_price, ctx)}` : "";
    return [{
      text: `${truncateBtn(name, 26)}${minStr}`,
      callback_data: cb.pediaTiers(p.id, "a", 0),
    }];
  });
  const nav: InlineKeyboardButton[] = [];
  if (page > 0) nav.push({ text: "◀️", callback_data: cb.pediaPlatform(platform, page - 1) });
  if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
  if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.pediaPlatform(platform, page + 1) });
  if (nav.length) rows.push(nav);
  rows.push([
    { text: en ? "◀️ Platforms" : "◀️ Platform", callback_data: cb.pediaHome() },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: pediaPlatformProductsMessage({
      platformLabel: platformLabelOf(platform),
      count: items.length,
      page,
      totalPages,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Prompt cari layanan Pedia (`pdsrc`). */
export async function handlePediaSearchPrompt(
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, "pd_search:"))) return;
  await sendMessage({
    chat_id: chatId,
    text: en
      ? "🔎 Type a social media service (e.g. <code>followers ig</code>, <code>views tiktok</code>) or paste a link directly.\nType /batal to cancel."
      : "🔎 Ketik layanan yang dicari (mis. <code>followers ig</code>, <code>views tiktok</code>) atau langsung tempel link.\nKetik /batal untuk membatalkan.",
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Followers IG, Views TikTok…" },
  });
}

function filterTiers(tiers: PediaCatalogTier[], filter: PediaTierFilter): PediaCatalogTier[] {
  if (filter === "i") return tiers.filter((t) => t.region === "indonesia");
  if (filter === "g") return tiers.filter((t) => t.region === "global" || t.region === "mixed");
  if (filter === "r") return tiers.filter((t) => t.refill_days > 0);
  return tiers;
}

/** Langkah 2 — Daftar Tier Bernomor + Tombol Angka + Filter Adaptif (`pdt:<prodId>:<flt>:<page>` / `pdl:<prodId>`). */
export async function handlePediaTiers(
  chatId: number,
  messageId: number,
  productId: number,
  rawFilter: string,
  requestedPage: number,
  from?: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from?.id ?? chatId);
  const en = ctx.locale === "en";
  const catalog = await loadTelegramPediaCatalog();
  const product = catalog.find((p) => p.id === productId);
  if (!product) {
    await handlePediaHome(chatId, messageId, from, sourceMeta);
    return;
  }

  const filter: PediaTierFilter = (["a", "i", "g", "r"].includes(rawFilter) ? rawFilter : "a") as PediaTierFilter;
  const filtered = filterTiers(product.tiers, filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / TIERS_PER_PAGE));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), totalPages - 1);
  const pageItems = filtered.slice(page * TIERS_PER_PAGE, (page + 1) * TIERS_PER_PAGE);

  const rows: InlineKeyboardButton[][] = [];
  // Tombol pilih angka 1..5 dalam 1 baris kompak
  if (pageItems.length) {
    rows.push(
      pageItems.map((tier, idx) => ({
        text: `${idx + 1}`,
        callback_data: cb.pediaSelect(product.id, tier.id),
        style: "success",
      })),
    );
  }

  // Pagination (hanya jika > 1 halaman)
  if (totalPages > 1) {
    const nav: InlineKeyboardButton[] = [];
    if (page > 0) nav.push({ text: "◀️", callback_data: cb.pediaTiers(product.id, filter, page - 1) });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "noop" });
    if (page + 1 < totalPages) nav.push({ text: "▶️", callback_data: cb.pediaTiers(product.id, filter, page + 1) });
    rows.push(nav);
  }

  // Filter 1-klik: disembunyikan untuk produk dengan <= 3 tier agar layar super bersih!
  if (product.tiers.length > 3) {
    const hasIndo = product.tiers.some((t) => t.region === "indonesia");
    const hasGlobal = product.tiers.some((t) => t.region === "global" || t.region === "mixed");
    const hasRefill = product.tiers.some((t) => t.refill_days > 0);
    const fltRow: InlineKeyboardButton[] = [
      { text: filter === "a" ? (en ? "• All" : "• Semua") : (en ? "All" : "Semua"), callback_data: cb.pediaTiers(product.id, "a", 0), style: "primary" },
    ];
    if (hasIndo) fltRow.push({ text: filter === "i" ? "• 🇮🇩 Indo" : "🇮🇩 Indo", callback_data: cb.pediaTiers(product.id, "i", 0), style: "primary" });
    if (hasGlobal) fltRow.push({ text: filter === "g" ? "• 🌍 Global" : "🌍 Global", callback_data: cb.pediaTiers(product.id, "g", 0), style: "primary" });
    if (hasRefill) fltRow.push({ text: filter === "r" ? "• 🛡 Refill" : "🛡 Refill", callback_data: cb.pediaTiers(product.id, "r", 0), style: "primary" });
    if (fltRow.length > 1) rows.push(fltRow);
  }

  rows.push([
    { text: `◀️ ${platformLabelOf(product.platform)}`, callback_data: cb.pediaPlatform(product.platform, 0), style: "primary" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: pediaTierListMessage({
      productName: product.name,
      tiers: pageItems,
      totalFiltered: filtered.length,
      filter,
      page,
      totalPages,
      ctx,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Langkah 3 — Pilih Tier (`pds:<prodId>:<tierId>`): cek link tersimpan atau minta target link. */
export async function handlePediaSelectTier(
  chatId: number,
  messageId: number,
  productId: number,
  tierId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  if (await notifyPaymentMaintenance(chatId)) return;
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    await sendMessage({
      chat_id: chatId,
      text: en ? "AXVARA Pedia ordering is not open yet." : "Pemesanan AXVARA Pedia belum dibuka saat ini.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }

  const catalog = await loadTelegramPediaCatalog();
  const product = catalog.find((p) => p.id === productId);
  const tier = product?.tiers.find((t) => t.id === tierId);
  if (!product || !tier) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "⚠️ Service is no longer available. Please choose another." : "⚠️ Layanan sudah tidak tersedia. Silakan pilih layanan lain.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: en ? "📈 Social Media" : "📈 Sosmed Pedia", callback_data: cb.pediaHome() }]] },
    });
    return;
  }

  // Jika user datang dari paste-link chat dan link cocok dengan produk ini -> langsung ke Qty / Komentar!
  const savedLink = await readSavedLinkCtx(String(from.id));
  if (
    savedLink
    && savedLink.p === product.platform
    && pediaTargetMatches(product.target_kind, savedLink.k as Parameters<typeof pediaTargetMatches>[1], { platform: product.platform, metric: product.metric })
  ) {
    await showPediaQtyOrCommentsStep(chatId, messageId, product, tier, savedLink.r, savedLink.n, from, sourceMeta);
    return;
  }

  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `pd_target:${productId}:${tierId}`))) return;
  const tierName = pediaTierDisplayName(tier, product.name, ctx.locale);
  const prodName = en ? pediaServiceName(product.name, "en") : product.name;
  await sendMessage({
    chat_id: chatId,
    text: pediaTargetPromptMessage({
      productName: prodName,
      tierName,
      platformLabel: platformLabelOf(product.platform),
      targetKind: product.target_kind,
      example: pediaTargetExample(product.platform, product.target_kind),
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: pediaTargetExample(product.platform, product.target_kind),
    },
  });
}

async function readLiveTierRow(productId: number, tierId: number) {
  const db = createDatabaseAccess();
  const product = await db.queryFirst(`SELECT * FROM pedia_products WHERE id=? AND is_active=1`, productId).catch(() => null);
  const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`, tierId, productId).catch(() => null);
  if (!product || !tier) return null;
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type=? AND rate_idr_per_1k>0`,
    tier.supplier, Number(tier.supplier_service_id), pediaServiceTypeFor(tier.input_kind),
  ).catch(() => null);
  if (!live) return null;
  const limits = pediaBounds(
    tier.input_kind === "comments" ? { ...live, max_qty: Math.min(Number(live.max_qty), CUSTOM_COMMENT_MAX_LINES) } : live,
    tier,
    Number(product.step),
  );
  if (!limits) return null;
  return { product, tier, live, limits };
}

type PediaDraftTarget = { p: number; t: number; tr: string; tn: string };

async function showPediaQtyOrCommentsStep(
  chatId: number,
  messageId: number,
  product: TelegramPediaProduct,
  tier: PediaCatalogTier,
  targetRaw: string,
  targetNormalized: string,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const liveData = await readLiveTierRow(product.id, tier.id);
  if (!liveData) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "⚠️ Service is currently unavailable." : "⚠️ Layanan sedang tidak tersedia.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: en ? "📈 Social Media" : "📈 Sosmed Pedia", callback_data: cb.pediaHome() }]] },
    });
    return;
  }

  const draft: PediaDraftTarget = {
    p: product.id,
    t: tier.id,
    tr: targetRaw.slice(0, 500),
    tn: targetNormalized.slice(0, 500),
  };
  const tierName = pediaTierDisplayName(tier, product.name, ctx.locale);
  const prodName = en ? pediaServiceName(product.name, "en") : product.name;

  // Cabang B: Custom Comments (12 tier)
  if (liveData.tier.input_kind === "comments") {
    if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `pd_comments:${JSON.stringify(draft)}`))) return;
    await sendMessage({
      chat_id: chatId,
      text: pediaCommentsPromptMessage({
        productName: prodName,
        tierName,
        targetUrl: targetNormalized,
        minQty: liveData.limits.min,
        maxQty: liveData.limits.max,
        step: liveData.limits.step,
        locale: ctx.locale,
      }),
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: en ? "1 comment per line…" : "1 komentar per baris…" },
    });
    return;
  }

  // Cabang A: Reguler (quick quantities 2 kolom + boleh langsung ketik angka)
  if (!(await setPendingActionUnlessCreating(String(from.id), chatId, `pd_qty:${JSON.stringify(draft)}`))) return;
  const quickPool = (tier.quick_quantities && tier.quick_quantities.length ? tier.quick_quantities : product.packages)
    .filter((q) => q >= liveData.limits.min && q <= liveData.limits.max && q % liveData.limits.step === 0);
  const chosenQuick = quickPool.length > 6
    ? [quickPool[0], quickPool[1], quickPool[Math.floor(quickPool.length / 2)], quickPool[Math.floor(quickPool.length * 0.7)], quickPool[quickPool.length - 2], quickPool[quickPool.length - 1]]
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .slice(0, 6)
    : quickPool.slice(0, 6);
  if (!chosenQuick.length) chosenQuick.push(liveData.limits.min);

  const minOrderRp = pediaMinOrderRp();
  const rate = Number(liveData.live.rate_idr_per_1k);
  const markupPct = Number(liveData.tier.markup_pct) || 0;
  const minProfitRp = Number(liveData.tier.min_profit_rp) || 0;

  const rows = twoColGrid(chosenQuick, (q) => {
    const rp = computePediaPrice({ supplierRatePer1k: rate, quantity: q, markupPct, minProfitRp, minOrderRp });
    return {
      text: `${pediaNumber(q, ctx.locale)} · ${pediaPriceBtn(rp, ctx)}`,
      callback_data: cb.pediaQty(product.id, tier.id, q),
      style: "success",
    };
  });
  rows.push([{ text: en ? "✍️ Type Custom Quantity" : "✍️ Ketik Jumlah Lain", callback_data: cb.pediaQtyInput(product.id, tier.id), style: "primary" }]);
  rows.push([
    { text: en ? "◀️ Back" : "◀️ Kembali", callback_data: cb.pediaTiers(product.id, "a", 0), style: "primary" },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home(), style: "primary" },
  ]);

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: pediaQtyPromptMessage({
      productName: prodName,
      tierName,
      targetUrl: targetNormalized,
      minQty: liveData.limits.min,
      maxQty: liveData.limits.max,
      step: liveData.limits.step,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }, sourceMeta);
}

/** Langkah 4 — Review + Syarat + Freeze `payq1` (QRIS + Crypto). */
async function showPediaReviewAndPaymentOffer(
  chatId: number,
  messageId: number,
  draft: PediaDraftTarget,
  qty: number,
  comments: string[] | undefined,
  from: { id: number; first_name: string; username?: string },
  allowPendingAction?: string,
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const liveData = await readLiveTierRow(draft.p, draft.t);
  if (!liveData) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "⚠️ Service is no longer available." : "⚠️ Layanan sudah tidak tersedia.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: en ? "📈 Social Media" : "📈 Sosmed Pedia", callback_data: cb.pediaHome() }]] },
    });
    return;
  }

  const { product, tier, live, limits } = liveData;
  if (qty < limits.min || qty > limits.max || qty % limits.step !== 0) {
    await sendMessage({
      chat_id: chatId,
      text: en
        ? `❌ Quantity must be between ${pediaNumber(limits.min, "en")} and ${pediaNumber(limits.max, "en")}${limits.step > 1 ? ` (multiples of ${limits.step})` : ""}.`
        : `❌ Jumlah harus antara ${pediaNumber(limits.min, "id")}–${pediaNumber(limits.max, "id")}${limits.step > 1 ? ` (kelipatan ${limits.step})` : ""}.`,
      parse_mode: "HTML",
    });
    return;
  }

  const rate = Number(live.rate_idr_per_1k);
  const total = computePediaPrice({
    supplierRatePer1k: rate,
    quantity: qty,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp: pediaMinOrderRp(),
  });
  if (!Number.isFinite(total) || total <= 0) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "⚠️ Price unavailable right now." : "⚠️ Harga sedang tidak tersedia.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale: ctx.locale }),
    });
    return;
  }

  const tag = await pediaApprovalTag({
    productId: Number(product.id),
    tierId: Number(tier.id),
    qty,
    total,
    targetNormalized: draft.tn,
    supplier: String(tier.supplier),
    supplierServiceId: Number(tier.supplier_service_id),
    ...(comments ? { comments } : {}),
  });

  const source: Payq1PediaSource = {
    kind: "pedia",
    productId: Number(product.id),
    tierId: Number(tier.id),
    qty,
    targetRaw: draft.tr,
    targetNormalized: draft.tn,
    supplier: String(tier.supplier),
    supplierServiceId: Number(tier.supplier_service_id),
    supplierRateSnapshot: rate,
    ...(comments ? { comments } : {}),
  };

  const frozen = await freezePayq1({
    fromUserId: String(from.id),
    locale: ctx.locale,
    tag,
    identity: source,
    idrSubtotal: total,
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

  const tierName = whiteLabel(String(tier.public_name || tier.label_note || tier.tier || product.name)).trim();
  const reviewText = pediaReviewMessage({
    productName: String(product.name),
    tierName,
    targetUrl: draft.tn,
    qty,
    refillDays: Number(tier.refill_days) || 0,
    refillAnchor: tier.refill_anchor === "completed" ? "completed" : "created",
    etaStart: tier.eta_start ? String(tier.eta_start) : null,
    etaFinish: tier.eta_finish ? String(tier.eta_finish) : null,
    isComments: Boolean(comments?.length),
    total,
    ctx,
  });
  const methodDetails = paymentMethodOfferDetails(frozen.state.methods, { locale: ctx.locale, subtotal: total });
  const markup = paymentMethodOfferKeyboard(
    { nonce: frozen.state.nonce, methods: frozen.state.methods, source: { kind: "pedia", productId: Number(product.id), tierId: Number(tier.id), qty }, idrSubtotal: total },
    { locale: ctx.locale },
  );

  await replaceWithText({
    chat_id: chatId,
    message_id: messageId,
    text: `${reviewText}\n\n${methodDetails.join("\n")}`,
    parse_mode: "HTML",
    reply_markup: markup,
  });
}

/** Pilih preset qty (`pdn:<prodId>:<tierId>:<qty>`). */
async function handlePediaQuickQty(
  chatId: number,
  messageId: number,
  productId: number,
  tierId: number,
  qty: number,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, String(from.id)).catch(() => null);
  const raw = row?.pending_action ? String(row.pending_action) : "";
  let draft: PediaDraftTarget | null = null;
  if (raw.startsWith("pd_qty:")) {
    try {
      const parsed = JSON.parse(raw.slice("pd_qty:".length)) as PediaDraftTarget;
      if (parsed.p === productId && parsed.t === tierId && parsed.tn) draft = parsed;
    } catch { /* fall through */ }
  }
  if (!draft) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "Session expired. Please select the service again." : "Sesi berakhir. Silakan pilih layanan ulang.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: en ? "🔄 Select Again" : "🔄 Pilih Lagi", callback_data: cb.pediaSelect(productId, tierId) }]] },
    });
    return;
  }
  await showPediaReviewAndPaymentOffer(chatId, messageId, draft, qty, undefined, from, raw);
}

/** Prompt ketik jumlah lain (`pdni:<prodId>:<tierId>`). */
async function handlePediaQtyInputPrompt(
  chatId: number,
  productId: number,
  tierId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const liveData = await readLiveTierRow(productId, tierId);
  const rangeText = liveData
    ? `${pediaNumber(liveData.limits.min, ctx.locale)}–${pediaNumber(liveData.limits.max, ctx.locale)}`
    : "100–10.000";
  await sendMessage({
    chat_id: chatId,
    text: en
      ? `✍️ Type the quantity you want (<b>${rangeText}</b>), e.g. <code>500</code>.\nType /batal to cancel.`
      : `✍️ Ketik jumlah yang diinginkan (<b>${rangeText}</b>), mis. <code>500</code>.\nKetik /batal untuk membatalkan.`,
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: "500" },
  });
}

/** Ajukan Refill langsung di chat (`pdrf:<code>`). Ownership sudah dicek `ownerBound` + verifikasi ulang di sini. */
export async function handlePediaRefill(
  chatId: number,
  _messageId: number,
  orderCode: string,
  from: { id: number; first_name: string; username?: string },
): Promise<void> {
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return;
  const code = String(orderCode || "").trim().toUpperCase();
  const db = createDatabaseAccess();
  const owned = await db.queryFirst(
    `SELECT code, locale FROM orders WHERE code=? AND sales_channel='telegram' AND telegram_user_id=? AND order_kind='pedia'`,
    code, String(from.id),
  ).catch(() => null);
  const ctx = await tgCtxFor(from.id);
  const locale: Locale = String(owned?.locale ?? "") === "en" ? "en" : String(owned?.locale ?? "") === "id" ? "id" : ctx.locale;
  const en = locale === "en";
  if (!owned) {
    await sendMessage({
      chat_id: chatId,
      text: en ? "❌ Order not found." : "❌ Pesanan tidak ditemukan.",
      parse_mode: "HTML",
      reply_markup: minimalMenuKeyboard({ locale }),
    });
    return;
  }

  const outcome = await executePediaRefill(db, code, locale);
  await sendMessage({
    chat_id: chatId,
    text: outcome.ok
      ? `${en ? "<b>♻️ Refill submitted</b>" : "<b>♻️ Refill diajukan</b>"}\n<code>${code}</code>\n\n${outcome.message}`
      : `${en ? "<b>ℹ️ Refill unavailable</b>" : "<b>ℹ️ Refill belum bisa diajukan</b>"}\n<code>${code}</code>\n\n${outcome.error}`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: en ? "📋 View Order" : "📋 Lihat Pesanan", callback_data: cb.order(code) }],
        [{ text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() }],
      ],
    },
  });
}

/** Handler input teks pending untuk Pedia (`pd_search:`, `pd_target:`, `pd_qty:`, `pd_comments:`). */
export async function handlePediaPendingInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  if (!isD1Mode() || !text.trim()) return false;
  if (!Number.isSafeInteger(chatId) || chatId <= 0 || chatId !== from.id) return false;
  const user = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, String(from.id)).catch(() => null);
  const action = user?.pending_action ? String(user.pending_action) : "";
  if (!action.startsWith("pd_") || action.startsWith("pd_linkctx:")) return false;

  const ctx = await tgCtxFor(from.id);
  const en = ctx.locale === "en";
  const clearExact = () => execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    String(from.id), action,
  ).catch(() => ({}));

  // 1. Cari layanan Pedia (`pd_search:`)
  if (action === "pd_search:") {
    await clearExact();
    if (await handlePediaPasteLink(text, chatId, from)) return true;
    const matches = await searchPediaCatalog(text);
    if (!matches.length) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `No Pedia services found for "<b>${text.trim().slice(0, 40)}</b>".`
          : `Layanan Pedia untuk "<b>${text.trim().slice(0, 40)}</b>" belum ditemukan.`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: en ? "📂 All Platforms" : "📂 Semua Platform", callback_data: cb.pediaAll(0) },
            { text: en ? "🔎 Try Again" : "🔎 Cari Lagi", callback_data: cb.pediaSearch() },
          ]],
        },
      });
      return true;
    }
    const rows: InlineKeyboardButton[][] = matches.slice(0, 8).map((p) => {
      const name = en ? pediaServiceName(p.name, "en") : p.name;
      const minStr = p.min_price != null ? ` · ${en ? "from" : "mulai"} ${pediaPriceBtn(p.min_price, ctx)}` : "";
      return [{ text: `${truncateBtn(name, 26)}${minStr}`, callback_data: cb.pediaTiers(p.id, "a", 0) }];
    });
    rows.push([
      { text: en ? "◀️ Pedia" : "◀️ Beranda Pedia", callback_data: cb.pediaHome() },
      { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
    ]);
    await sendMessage({
      chat_id: chatId,
      text: en ? `📈 Pedia search results (${matches.length}):` : `📈 Hasil pencarian Pedia (${matches.length}):`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    });
    return true;
  }

  // 2. Input target link (`pd_target:<prodId>:<tierId>`)
  if (action.startsWith("pd_target:")) {
    const [, prodRaw, tierRaw] = action.split(":");
    const productId = Number(prodRaw);
    const tierId = Number(tierRaw);
    const catalog = await loadTelegramPediaCatalog();
    const product = catalog.find((p) => p.id === productId);
    const tier = product?.tiers.find((t) => t.id === tierId);
    if (!product || !tier) {
      await clearExact();
      await sendMessage({ chat_id: chatId, text: en ? "Service no longer available." : "Layanan sudah tidak tersedia.", parse_mode: "HTML", reply_markup: minimalMenuKeyboard({ locale: ctx.locale }) });
      return true;
    }
    const detected = detectPediaLink(text.trim(), product.platform);
    if (!detected) {
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `❌ Link format not recognized.\nExample: <code>${pediaTargetExample(product.platform, product.target_kind)}</code>\nSend a valid link or type /batal.`
          : `❌ Format link belum dikenali.\nContoh: <code>${pediaTargetExample(product.platform, product.target_kind)}</code>\nKirim link yang sesuai atau ketik /batal.`,
        parse_mode: "HTML",
      });
      return true;
    }
    const kindOk = pediaTargetMatches(product.target_kind, detected.targetKind, { platform: product.platform, metric: product.metric });
    if (detected.platform !== product.platform || !kindOk) {
      // Tawarkan produk yang cocok untuk link tersebut!
      const alternatives = catalog.filter(
        (p) => p.platform === detected.platform
          && pediaTargetMatches(p.target_kind, detected.targetKind, { platform: p.platform, metric: p.metric }),
      ).slice(0, 4);
      const altRows: InlineKeyboardButton[][] = alternatives.map((p) => [{
        text: `↪️ ${truncateBtn(en ? pediaServiceName(p.name, "en") : p.name, 30)}`,
        callback_data: cb.pediaLinkProduct(p.id),
        style: "primary",
      }]);
      if (alternatives.length) {
        const linkCtx: SavedLinkCtx = {
          r: text.trim().slice(0, 600),
          n: detected.normalized,
          p: detected.platform,
          k: detected.targetKind,
          exp: Math.floor(Date.now() / 1000) + LINK_CTX_TTL_SEC,
        };
        await execRun(
          `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
          `pd_linkctx:${JSON.stringify(linkCtx)}`, String(from.id), action,
        ).catch(() => {});
      }
      await sendMessage({
        chat_id: chatId,
        text: en
          ? `⚠️ That looks like a <b>${platformLabelOf(detected.platform)} (${detected.targetKind})</b> link, while this service needs a <b>${platformLabelOf(product.platform)} (${product.target_kind})</b> link.${alternatives.length ? "\n\nOr pick a matching service below:" : ""}`
          : `⚠️ Link itu terdeteksi sebagai <b>${platformLabelOf(detected.platform)} (${detected.targetKind})</b>, sedangkan layanan ini butuh link <b>${platformLabelOf(product.platform)} (${product.target_kind})</b>.${alternatives.length ? "\n\nAtau pilih layanan yang cocok di bawah:" : ""}`,
        parse_mode: "HTML",
        ...(altRows.length ? { reply_markup: { inline_keyboard: altRows } } : {}),
      });
      return true;
    }
    await showPediaQtyOrCommentsStep(chatId, 0, product, tier, text.trim(), detected.normalized, from);
    return true;
  }

  // 3. Input jumlah reguler (`pd_qty:{...}`)
  if (action.startsWith("pd_qty:")) {
    let draft: PediaDraftTarget | null = null;
    try { draft = JSON.parse(action.slice("pd_qty:".length)) as PediaDraftTarget; } catch { draft = null; }
    if (!draft?.p || !draft?.t || !draft?.tn) {
      await clearExact();
      return false;
    }
    const cleanNum = text.trim().replace(/[.,\s]/g, "");
    if (!/^\d{1,9}$/.test(cleanNum)) {
      await sendMessage({
        chat_id: chatId,
        text: en ? "❌ Please type a whole number (e.g. <code>500</code>) or tap a button above." : "❌ Ketik angka bulat (mis. <code>500</code>) atau tekan tombol di atas.",
        parse_mode: "HTML",
      });
      return true;
    }
    const qty = Number(cleanNum);
    await showPediaReviewAndPaymentOffer(chatId, 0, draft, qty, undefined, from, action);
    return true;
  }

  // 4. Input Custom Comments multi-baris (`pd_comments:{...}`)
  if (action.startsWith("pd_comments:")) {
    let draft: PediaDraftTarget | null = null;
    try { draft = JSON.parse(action.slice("pd_comments:".length)) as PediaDraftTarget; } catch { draft = null; }
    if (!draft?.p || !draft?.t || !draft?.tn) {
      await clearExact();
      return false;
    }
    const checked = checkCustomComments(text, null, ctx.locale);
    if (!checked.ok) {
      await sendMessage({
        chat_id: chatId,
        text: `❌ ${checked.error}\n${en ? "Send again or type /batal." : "Kirim ulang atau ketik /batal."}`,
        parse_mode: "HTML",
      });
      return true;
    }
    const qty = checked.lines.length;
    await showPediaReviewAndPaymentOffer(chatId, 0, draft, qty, checked.lines, from, action);
    return true;
  }

  return false;
}

/** Dispatcher callback untuk semua prefix `pd*` dan `pdrf`. */
export async function handlePediaCallback(
  action: string,
  params: string[],
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  sourceMeta?: ScreenSourceMeta,
): Promise<boolean> {
  switch (action) {
    case "pdh":
      await handlePediaHome(chatId, messageId, from, sourceMeta);
      return true;
    case "pda":
      await handlePediaAllPlatforms(chatId, messageId, Number(params[0] || 0), from, sourceMeta);
      return true;
    case "pdsrc":
      await handlePediaSearchPrompt(chatId, from);
      return true;
    case "pdp":
      await handlePediaPlatform(chatId, messageId, String(params[0] || ""), Number(params[1] || 0), from, sourceMeta);
      return true;
    case "pdt":
      await handlePediaTiers(chatId, messageId, Number(params[0] || 0), String(params[1] || "a"), Number(params[2] || 0), from, sourceMeta);
      return true;
    case "pdl":
      await handlePediaTiers(chatId, messageId, Number(params[0] || 0), "a", 0, from, sourceMeta);
      return true;
    case "pds":
      await handlePediaSelectTier(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), from, sourceMeta);
      return true;
    case "pdn":
      await handlePediaQuickQty(chatId, messageId, Number(params[0] || 0), Number(params[1] || 0), Number(params[2] || 0), from);
      return true;
    case "pdni":
      await handlePediaQtyInputPrompt(chatId, Number(params[0] || 0), Number(params[1] || 0), from);
      return true;
    case "pdrf":
      await handlePediaRefill(chatId, messageId, String(params[0] || ""), from);
      return true;
    default:
      return false;
  }
}
