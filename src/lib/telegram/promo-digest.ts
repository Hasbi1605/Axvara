import type { DatabaseAccess } from "@/lib/db-access";
import { SITE } from "@/lib/site";
import { siteOrigin } from "@/lib/site-url";
import { sendMessage } from "@/lib/telegram/api";
import { escapeHtml, formatRupiah } from "@/lib/telegram/messages/format";

export type PromoSlot = "morning" | "evening";

type PromoProduct = {
  id: number;
  name: string;
  category: string;
  price: number;
};

type DigestRow = {
  product_ids: string;
  full_message_id?: string | null;
  short_message_id?: string | null;
};

export type PromoDigestResult = {
  due: boolean;
  fullSent: boolean;
  shortSent: boolean;
  complete: boolean;
  skipped?: "disabled" | "insufficient_products" | "already_sent";
};

export function promoSlotAt(now = new Date()): { businessDate: string; slot: PromoSlot } | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const slot = hour >= 9 && hour < 12 ? "morning" : hour >= 17 && hour < 20 ? "evening" : null;
  return slot ? { businessDate: `${value("year")}-${value("month")}-${value("day")}`, slot } : null;
}

function parseIds(raw: unknown): number[] {
  try {
    const ids = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function rotate<T>(items: T[], offset: number): T[] {
  if (!items.length) return items;
  const at = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(at), ...items.slice(0, at)];
}

export function selectPromoProducts(
  products: PromoProduct[],
  usedToday: Set<number>,
  recentlyUsed: Set<number>,
  seed: number,
): PromoProduct[] {
  const ordered = rotate([...products].sort((a, b) => a.category.localeCompare(b.category) || a.id - b.id), seed);
  const result: PromoProduct[] = [];
  const addTier = (predicate: (product: PromoProduct) => boolean) => {
    const categories = new Set(result.map((product) => product.category));
    for (const product of ordered) {
      if (result.length >= 4) break;
      if (!result.some((item) => item.id === product.id) && predicate(product) && !categories.has(product.category)) {
        result.push(product);
        categories.add(product.category);
      }
    }
    for (const product of ordered) {
      if (result.length >= 4) break;
      if (!result.some((item) => item.id === product.id) && predicate(product)) result.push(product);
    }
  };
  addTier((product) => !usedToday.has(product.id) && !recentlyUsed.has(product.id));
  addTier((product) => !usedToday.has(product.id));
  addTier(() => true);
  return result;
}

export function promoMessages(slot: PromoSlot, products: PromoProduct[]): { full: string; short: string } {
  const morning = slot === "morning";
  const title = morning ? "✨ <b>PILIHAN PREMIUM PAGI INI</b>" : "🌙 <b>PILIHAN PREMIUM SORE INI</b>";
  const intro = morning
    ? "Mulai aktivitas dengan pilihan premium untuk kerja, belajar, dan membuat konten."
    : "Dari hiburan sampai kebutuhan konten, berikut pilihan AXVARA yang sedang tersedia.";
  const icons = ["🤖", "🎨", "🎬", "⚡"];
  const lines = products.map((product, index) =>
    `${icons[index] ?? "✨"} <b>${escapeHtml(product.name)}</b>\n${escapeHtml(product.category)} • Mulai ${formatRupiah(product.price)}`,
  );
  const shortLines = products.map((product, index) =>
    `${icons[index] ?? "✨"} ${escapeHtml(product.name)} — mulai ${formatRupiah(product.price)}`,
  );
  const botUrl = `https://t.me/${SITE.adminTelegram}`;
  const webUrl = siteOrigin();
  const cta = `🤖 <b>Order melalui Bot Telegram:</b>\n${botUrl}\n\n🌐 <b>Order melalui Website:</b>\n${webUrl}`;
  return {
    full: `${title}\n\n${intro}\n\n${lines.join("\n\n")}\n\n${cta}\n\n<i>Harga dan stok mengikuti katalog terbaru.</i>`,
    short: `Produk premium ready ${morning ? "pagi" : "sore"} ini ✨\n\n${shortLines.join("\n")}\n\n${cta}\n\n<i>Harga dan stok mengikuti ketersediaan terbaru.</i>`,
  };
}

export async function sendDueAdminPromoDigest(
  database: DatabaseAccess,
  now = new Date(),
): Promise<PromoDigestResult> {
  const due = promoSlotAt(now);
  if (!due) return { due: false, fullSent: false, shortSent: false, complete: false };
  if (
    process.env.TELEGRAM_PROMO_DIGEST_ENABLED !== "true" ||
    process.env.TELEGRAM_BOT_ENABLED !== "true" ||
    !process.env.TELEGRAM_BOT_TOKEN ||
    !process.env.TELEGRAM_ADMIN_CHAT_ID
  ) return { due: true, fullSent: false, shortSent: false, complete: false, skipped: "disabled" };

  const products = (await database.queryAll(
    `SELECT p.id, p.name, COALESCE(c.name, 'Produk Premium') AS category,
            MIN(CASE WHEN pv.stock = -1 OR pv.stock >= pv.min_qty THEN pv.price END) AS price
       FROM products p
       JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=1
       LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.is_active=1 AND p.telegram_enabled=1
      GROUP BY p.id
     HAVING price IS NOT NULL
      ORDER BY p.sort_order ASC, p.id ASC`,
  )).map((row) => ({
    id: Number(row.id), name: String(row.name), category: String(row.category), price: Number(row.price),
  }));
  if (products.length < 3) {
    return { due: true, fullSent: false, shortSent: false, complete: false, skipped: "insufficient_products" };
  }

  const history = await database.queryAll(
    `SELECT business_date, slot, product_ids FROM telegram_promo_digests
      WHERE business_date BETWEEN date(?, '-2 days') AND ?`,
    due.businessDate, due.businessDate,
  );
  const usedToday = new Set(history.filter((row) => row.business_date === due.businessDate).flatMap((row) => parseIds(row.product_ids)));
  const recentlyUsed = new Set(history.filter((row) => row.business_date !== due.businessDate).flatMap((row) => parseIds(row.product_ids)));
  const seed = Number(due.businessDate.replaceAll("-", "")) + (due.slot === "evening" ? 1 : 0);
  const selected = selectPromoProducts(products, usedToday, recentlyUsed, seed);
  await database.execRun(
    `INSERT OR IGNORE INTO telegram_promo_digests (business_date, slot, product_ids)
     VALUES (?, ?, ?)`,
    due.businessDate, due.slot, JSON.stringify(selected.map((product) => product.id)),
  );
  const row = await database.queryFirst(
    `SELECT product_ids, full_message_id, short_message_id FROM telegram_promo_digests
      WHERE business_date=? AND slot=?`,
    due.businessDate, due.slot,
  ) as DigestRow | null;
  if (!row) return { due: true, fullSent: false, shortSent: false, complete: false };
  if (row.full_message_id && row.short_message_id) {
    return { due: true, fullSent: false, shortSent: false, complete: true, skipped: "already_sent" };
  }

  const fixedProducts = parseIds(row.product_ids).map((id) => products.find((product) => product.id === id)).filter((product): product is PromoProduct => Boolean(product));
  if (fixedProducts.length < 3) return { due: true, fullSent: false, shortSent: false, complete: false, skipped: "insufficient_products" };
  const messages = promoMessages(due.slot, fixedProducts);
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  let fullSent = false;
  let shortSent = false;

  if (!row.full_message_id) {
    const sent = await sendMessage({ chat_id: chatId, text: messages.full, parse_mode: "HTML", disable_web_page_preview: true });
    if (!sent.ok || !sent.result?.message_id) {
      await database.execRun(
        `UPDATE telegram_promo_digests SET full_attempts=full_attempts+1, full_error=?, updated_at=datetime('now') WHERE business_date=? AND slot=?`,
        String(sent.description ?? "Telegram send failed").slice(0, 500), due.businessDate, due.slot,
      );
      return { due: true, fullSent, shortSent, complete: false };
    }
    fullSent = true;
    row.full_message_id = String(sent.result.message_id);
    await database.execRun(
      `UPDATE telegram_promo_digests SET full_message_id=?, full_attempts=full_attempts+1, full_error=NULL, updated_at=datetime('now') WHERE business_date=? AND slot=?`,
      row.full_message_id, due.businessDate, due.slot,
    );
  }

  if (!row.short_message_id) {
    const sent = await sendMessage({ chat_id: chatId, text: messages.short, parse_mode: "HTML", disable_web_page_preview: true });
    if (!sent.ok || !sent.result?.message_id) {
      await database.execRun(
        `UPDATE telegram_promo_digests SET short_attempts=short_attempts+1, short_error=?, updated_at=datetime('now') WHERE business_date=? AND slot=?`,
        String(sent.description ?? "Telegram send failed").slice(0, 500), due.businessDate, due.slot,
      );
      return { due: true, fullSent, shortSent, complete: false };
    }
    shortSent = true;
    row.short_message_id = String(sent.result.message_id);
    await database.execRun(
      `UPDATE telegram_promo_digests SET short_message_id=?, short_attempts=short_attempts+1, short_error=NULL, updated_at=datetime('now') WHERE business_date=? AND slot=?`,
      row.short_message_id, due.businessDate, due.slot,
    );
  }

  return { due: true, fullSent, shortSent, complete: Boolean(row.full_message_id && row.short_message_id) };
}
