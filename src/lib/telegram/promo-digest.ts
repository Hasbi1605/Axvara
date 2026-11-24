import type { DatabaseAccess } from "@/lib/db-access";
import { SITE } from "@/lib/site";
import { siteOrigin } from "@/lib/site-url";
import { escapeHtml, formatRupiah } from "@/lib/telegram/messages/format";
import { mergedGroupCardJoinSql, notLoserProductSql } from "@/lib/product-groups";

export type PromoSlot = "morning" | "evening";

export type PromoProduct = {
  id: number;
  name: string;
  category: string;
  price: number;
};

export const TELEGRAM_PROMO_FOOTER = "Ketik /stop untuk berhenti menerima promo.";
export const TELEGRAM_MESSAGE_MAX_CHARS = 4096;

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

export function promoBannerCaption(slot: PromoSlot): string {
  const slotLabel = slot === "morning" ? "PRODUK AXVARA READY PAGI INI" : "PRODUK AXVARA READY SORE INI";
  return `🔥 <b>${slotLabel}</b>`;
}

function buildPromoParts(slot: PromoSlot, products: PromoProduct[]) {
  const slotLabel = slot === "morning" ? "PRODUK AXVARA READY PAGI INI" : "PRODUK AXVARA READY SORE INI";
  const titleFull = `🔥 <b>${slotLabel}</b>`;
  // Varian WA: sama persis, bold pakai * agar tinggal copy-paste ke WA.
  const titleWa = `🔥 *${slotLabel}*`;
  // Garis pemisah + intro dua baris sesuai contoh manual owner (2026-10-03).
  const separator = "------------------------------------------------------------------";
  const introFull = "Sedia semua kebutuhan aplikasi dan tools premium favorit anda.\nMurah, mudah, cepat, dan bergaransi.";
  const introWa = introFull;
  // Ikon per kategori taksonomi (bukan per indeks — tidak ada lagi
  // "Akun Premium × 4" yang membosankan).
  // PENTING: "desain" mengandung substring "ai", jadi cek AI pakai batas kata
  // (\bai\b) + cek kategori spesifik dulu — kalau tidak, DESAIN & VIDEO
  // jatuh ke 🤖 (insiden laporan owner 2026-10-03).
  const iconFor = (category: string): string => {
    const lowered = category.toLowerCase();
    if (lowered.includes("desain") || lowered.includes("video")) return "🎨";
    if (lowered.includes("stream") || lowered.includes("hiburan")) return "🎬";
    if (lowered.includes("produktivitas") || lowered.includes("office")) return "🛠️";
    if (lowered.includes("develop") || lowered.includes("tool")) return "💻";
    if (lowered.includes("hemat") || lowered.includes("bundle")) return "📦";
    if (/(^|[^a-z])ai([^a-z]|$)/.test(lowered) || lowered.includes("chatbot")) return "🤖";
    return "✨";
  };
  // Kelompok per kategori sesuai urutan kemunculan pertama (= urutan kategori
  // web `categories.sort_order`, lalu `p.sort_order` dan `p.id`). Baris produk memakai ✅
  // (keputusan owner 2026-10-01 — contoh format ceklis WR/SEKUDIL).
  // Format 2026-10-03 (contoh manual owner, berlaku untuk full Telegram DAN
  // short WA): garis pemisah + intro dua baris + header kategori
  // `{ikon} *NAMA*` + baris `✅ nama — RpX` + CTA website-lalu-bot.
  const groups: { category: string; items: PromoProduct[] }[] = [];
  for (const product of products) {
    const group = groups.find((entry) => entry.category === product.category);
    if (group) group.items.push(product);
    else groups.push({ category: product.category, items: [product] });
  }
  const linesFull = groups.map((group) =>
    [`${iconFor(group.category)} <b>${escapeHtml(group.category.toUpperCase())}</b>`,
      ...group.items.map((product) => `✅ ${escapeHtml(product.name)} — ${formatRupiah(product.price)}`)].join("\n"),
  );
  const linesWa = groups.map((group) =>
    [`${iconFor(group.category)} *${group.category.toUpperCase()}*`,
      ...group.items.map((product) => `✅ ${product.name} — ${formatRupiah(product.price)}`)].join("\n"),
  );
  const botUrl = `https://t.me/${SITE.adminTelegram}?start=beli`;
  const webUrl = siteOrigin();
  // Baris Pedia (PD-62, flag terpisah — default mati): 1 baris + link.
  const pediaLine = process.env.PEDIA_PROMO_DIGEST_ENABLED === "true";
  const pediaFull = pediaLine ? `\n\n🚀 <b>Axvara Pedia</b> — naikkan followers, likes & views: https://pedia.axvara.tech?utm_source=digest&utm_medium=telegram` : "";
  const pediaWa = pediaLine ? `\n\n🚀 *Axvara Pedia* — naikkan followers, likes & views: https://pedia.axvara.tech?utm_source=digest&utm_medium=telegram` : "";
  const ctaFull = `🌐 <b>Order melalui Website:</b> ${webUrl}\n\n🤖 <b>Order melalui Bot Telegram:</b> ${botUrl}${pediaFull}`;
  const ctaWa = `🌐 *Order melalui Website:* ${webUrl}\n\n🤖 *Order melalui Bot Telegram:* ${botUrl}${pediaWa}`;
  const headerFull = `${titleFull}\n${separator}\n${introFull}\n${separator}`;
  return { headerFull, linesFull, ctaFull, titleWa, introWa, linesWa, ctaWa };
}

export function promoMessages(slot: PromoSlot, products: PromoProduct[]): { full: string; short: string } {
  const { headerFull, linesFull, ctaFull, titleWa, introWa, linesWa, ctaWa } = buildPromoParts(slot, products);
  return {
    full: `${headerFull}\n${linesFull.join("\n\n")}\n\n${ctaFull}`,
    short: `${titleWa}\n${"-".repeat(52)}\n${introWa}\n${"-".repeat(52)}\n${linesWa.join("\n\n")}\n\n${ctaWa}`,
  };
}

/**
 * Split Telegram HTML promo message into chunks <= maxLen chars, preferring
 * category boundaries and falling back to line boundaries only if a single
 * category exceeds maxLen (never mid-line or breaking HTML tags).
 */
export function promoTelegramMessages(
  slot: PromoSlot,
  products: PromoProduct[],
  maxLen = TELEGRAM_MESSAGE_MAX_CHARS,
): string[] {
  const { headerFull, linesFull, ctaFull } = buildPromoParts(slot, products);
  const tail = `${ctaFull}\n\n${TELEGRAM_PROMO_FOOTER}`;
  const single = `${headerFull}\n${linesFull.join("\n\n")}\n\n${tail}`;
  if (single.length <= maxLen) return [single];

  const messages: string[] = [];
  let current = headerFull;

  for (const block of linesFull) {
    const sep = current === headerFull ? "\n" : current ? "\n\n" : "";
    const candidate = current ? `${current}${sep}${block}` : block;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }
    if (block.length <= maxLen) {
      if (current) messages.push(current);
      current = block;
      continue;
    }
    // Single category block exceeds maxLen: split only on line boundaries so
    // no product line or <b>...</b> tag is ever broken mid-line.
    for (const line of block.split("\n")) {
      const lineSep = current ? "\n" : "";
      const next = current ? `${current}${lineSep}${line}` : line;
      if (next.length <= maxLen) {
        current = next;
      } else {
        if (current) messages.push(current);
        current = line;
      }
    }
  }

  if (current) {
    if (current.length + 2 + tail.length <= maxLen) {
      messages.push(`${current}\n\n${tail}`);
    } else {
      messages.push(current);
      messages.push(tail);
    }
  } else {
    messages.push(tail);
  }
  return messages;
}

export async function loadPromoProducts(database: DatabaseAccess): Promise<PromoProduct[]> {
  return (await database.queryAll(
    `SELECT p.id, p.name, COALESCE(c.name, 'Produk Premium') AS category,
            MIN(CASE WHEN pv.stock = -1 OR pv.stock >= MAX(1, COALESCE(pv.min_qty, 1)) THEN pv.price END) AS promo_price
       FROM products p
       ${mergedGroupCardJoinSql("p", "gmap", { telegramOnly: true })}
       JOIN product_variants pv ON pv.product_id=gmap.member_id AND pv.is_active=1
       LEFT JOIN categories c ON c.id=p.category_id
      WHERE p.is_active=1 AND COALESCE(p.telegram_enabled, 1)=1
        AND ${notLoserProductSql("p")}
      GROUP BY p.id
     HAVING promo_price IS NOT NULL
      ORDER BY CASE WHEN c.id IS NULL THEN 1 ELSE 0 END ASC,
               COALESCE(c.sort_order, 0) ASC,
               COALESCE(c.name, '') ASC,
               COALESCE(c.id, 0) ASC,
               COALESCE(p.sort_order, 0) ASC,
               p.id ASC`,
  )).map((row) => ({
    id: Number(row.id), name: String(row.name), category: String(row.category), price: Number(row.promo_price),
  }));
}
