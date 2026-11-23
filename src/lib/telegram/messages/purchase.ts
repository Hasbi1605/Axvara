import { marketRefundNotice } from "@/lib/warranty-policy";
import { escapeHtml, escapeItemSummary, formatRupiah, invoiceDeadline, truncate } from "./format";
import { parseExpiry } from "@/lib/expiry";
import type { Locale } from "@/lib/i18n/locale";
import type { BulkTier } from "@/lib/bulk-pricing";
import { formatIdr } from "@/lib/i18n/format";

export const TELEGRAM_QRIS_DEADLINE_NOTICE = {
  id: "Lewat batas? Jangan bayar QR lama; hubungi admin untuk pemeriksaan manual.",
  en: "Past deadline? Do not pay the old QR; contact admin for a manual check.",
} as const;

export type TgMoneyOpts = { locale?: Locale; usdEquivalentText?: string | null; usdUnavailable?: boolean };

// TG2b: tier display helpers (visual spec §7). Effective FIRST, base never
// misleads; unreachable tiers (min > stock/cap) never raise limits.
export type TgTierDisplay = {
  basePrice: number;
  appliedTierMinQty?: number | null;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
  stock?: number;
  maxQty?: number;
};

const TIER_RANGE_QTY_CAP = 100;

function tierRangeLabel(tier: BulkTier, next?: BulkTier, locale: Locale = "id"): string {
  const nextMin = next ? next.min_qty - 1 : TIER_RANGE_QTY_CAP;
  const end = Math.min(nextMin, TIER_RANGE_QTY_CAP);
  return tier.min_qty >= end ? `${tier.min_qty}+` : `${tier.min_qty}–${end}`;
}

export function tgTierPreview(params: {
  basePrice: number;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
  stock?: number;
  maxQty?: number;
  qty: number;
  locale?: Locale;
  formatPrice?: (idr: number) => string;
}): string[] {
  const locale = params.locale ?? "id";
  const en = locale === "en";
  if (params.bulkEnabled === false || !params.bulkTiers?.length) return [];
  const format = params.formatPrice ?? ((idr: number) => formatIdr(idr, locale));
  const tiers = [...params.bulkTiers].sort((a, b) => a.min_qty - b.min_qty).slice(0, 5);
  const reachLimit = Math.min(
    params.maxQty ?? TIER_RANGE_QTY_CAP,
    TIER_RANGE_QTY_CAP,
    params.stock != null && params.stock !== -1 ? Math.max(1, params.stock) : TIER_RANGE_QTY_CAP,
  );
  const out = [en ? "Bulk price (per pcs, all units):" : "Harga grosir (per pcs, semua unit):"];
  for (const [index, tier] of tiers.entries()) {
    const unreachable = tier.min_qty > reachLimit;
    out.push(`• ${tierRangeLabel(tier, tiers[index + 1], locale)}: ${format(tier.unit_price)}${unreachable ? (en ? " (exceeds stock)" : " (melebihi stok)") : ""}`);
  }
  return out;
}

export function tgTierAppliedLine(params: {
  price: number;
  basePrice?: number;
  appliedTierMinQty?: number | null;
  qty: number;
  bulkTiers?: BulkTier[] | null;
  stock?: number;
  maxQty?: number;
  locale?: Locale;
}): string[] {
  const locale = params.locale ?? "id";
  const en = locale === "en";
  const out: string[] = [];
  const base = Number(params.basePrice ?? NaN);
  const discounted = Number.isSafeInteger(base) && base > params.price;
  if (discounted) {
    const saved = base * params.qty - params.price * params.qty;
    out.push(en
      ? `<b>Subtotal: ${formatIdr(params.price * params.qty, locale)}</b> (save ${formatIdr(saved, locale)})`
      : `<b>Subtotal: ${formatIdr(params.price * params.qty, locale)}</b> (hemat ${formatIdr(saved, locale)})`);
    out.push(en
      ? `Unit price: <b>${formatIdr(params.price, locale)}</b> (bulk ${params.appliedTierMinQty ?? ""}+)`
      : `Harga satuan: <b>${formatIdr(params.price, locale)}</b> (grosir ${params.appliedTierMinQty ?? ""}+)`);
  }
  // Next reachable tier jump (only when a higher tier is still reachable).
  const tiers = (params.bulkTiers ?? []).filter((t) => Number.isSafeInteger(t.min_qty) && Number.isSafeInteger(t.unit_price));
  const reachLimit = Math.min(
    params.maxQty ?? TIER_RANGE_QTY_CAP,
    TIER_RANGE_QTY_CAP,
    params.stock != null && params.stock !== -1 ? Math.max(1, params.stock) : TIER_RANGE_QTY_CAP,
  );
  const next = [...tiers].sort((a, b) => a.min_qty - b.min_qty).find((t) => t.min_qty > params.qty && t.min_qty <= reachLimit);
  if (next) out.push(en ? `Add ${next.min_qty - params.qty} more → ${formatIdr(next.unit_price, locale)}/pcs.` : `Tambah ${next.min_qty - params.qty} lagi → ${formatIdr(next.unit_price, locale)}/pcs.`);
  return out;
}

export function confirmVariantBuyMessage(params: {
  productName: string;
  variantLabel: string;
  duration?: string | null;
  warranty?: string | null;
  price: number;
  step?: string | null;
}): string {
  const { productName, variantLabel, duration, warranty, price } = params;
  const name = escapeHtml(truncate(productName, 100));
  const lines = [
    "<b>Konfirmasi pembelian</b>",
    `<b>${name}</b> · ${escapeHtml(truncate(variantLabel, 100))}`,
  ];
  if (duration) lines.push(`Durasi: ${escapeHtml(duration)}`);
  if (warranty) lines.push(`Garansi: ${escapeHtml(warranty)}`);
  lines.push(`Harga satuan: ${formatRupiah(price)}`);
  return lines.join("\n");
}

export function chooseVariantMessage(productName: string, _opts?: { locale?: Locale }): string {
  const name = escapeHtml(truncate(productName, 100));
  return `<b>${name}</b>`;
}

export function confirmBuyMessage(productName: string, price: number, qty = 1, opts?: TgMoneyOpts): string {
  const name = escapeHtml(truncate(productName, 100));
  const quantity = Math.max(1, Math.min(100, Math.floor(qty)));
  const en = opts?.locale === "en";
  const unit = formatIdr(price, opts?.locale ?? "id");
  const sub = formatIdr(price * quantity, opts?.locale ?? "id");
  const lines = [
    en ? "<b>Confirm purchase</b>" : "<b>Konfirmasi pembelian</b>",
    name,
    en ? `Unit price: ${unit}` : `Harga satuan: ${unit}`,
    en ? `Quantity: ${quantity}` : `Jumlah: ${quantity}`,
    `<b>Subtotal: ${sub}</b>`,
  ];
  if (opts?.usdEquivalentText) lines.push(`≈ ${opts.usdEquivalentText}`);
  if (opts?.usdUnavailable) lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  lines.push(
    "",
    en ? "Final total (incl. unique code) is on the invoice." : "Total final (termasuk kode unik) ada di invoice.",
    en ? "Third-party, not official. Terms: /garansi." : "Third-party, bukan official. Ketentuan: /garansi.",
    marketRefundNotice[en ? "en" : "id"],
  );
  return lines.join("\n");
}

export type ReviewCopySection = {
  kind: "package" | "activation" | "warranty_terms";
  lines: string[];
};

const INVISIBLE_REVIEW_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function normalizeReviewPlain(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_REVIEW_CHARS, "").trim();
}

function truncatePlainForEscapedMax(plain: string, maxEscapedLen: number): string {
  if (maxEscapedLen <= 0) return "";
  if (escapeHtml(plain).length <= maxEscapedLen) return plain;
  const suffix = "…";
  let out = "";
  let escapedLen = 0;
  for (const ch of Array.from(plain)) {
    const esc = escapeHtml(ch);
    if (escapedLen + esc.length > Math.max(0, maxEscapedLen - suffix.length)) break;
    out += ch;
    escapedLen += esc.length;
  }
  return out.trimEnd() + suffix;
}

function sameNormalizedLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(a) === norm(b);
}

export function chooseQtyMessage(params: {
  productName: string;
  variantLabel: string;
  duration?: string | null;
  price: number;
  stock: number;
  qty?: number;
  maxQty?: number;
  minQty?: number;
  requiresEmail?: boolean;
  deliveryKind?: "instant" | "queued";
  warrantyLabel?: string | null;
  /** TG2b: dasar untuk menghitung hemat; price = harga efektif server. */
  basePrice?: number;
  appliedTierMinQty?: number | null;
  bulkTiers?: BulkTier[] | null;
  bulkEnabled?: boolean;
}, opts?: TgMoneyOpts & { formatPrice?: (idr: number) => string }): string {
  const { productName, variantLabel, price, stock } = params;
  const locale = opts?.locale ?? "id";
  const en = locale === "en";
  const formatPrimary = (idr: number) => (opts?.formatPrice ? opts.formatPrice(idr) : formatIdr(idr, locale));
  const minQty = Math.max(1, Math.floor(Number(params.minQty ?? 1) || 1));
  const maxQty = Math.max(1, Math.min(100, stock === -1 ? 100 : Math.max(1, stock), Math.floor(params.maxQty ?? 100)));
  const stockVal = stock === -1 ? "∞" : String(Math.max(0, stock));
  const unitPrice = Number(params.basePrice ?? price);
  const rawDur = params.duration?.trim() ?? "";
  const variantWithDur = rawDur && !variantLabel.toLowerCase().includes(rawDur.toLowerCase())
    ? `${variantLabel} · ${rawDur}`
    : variantLabel;
  const showVariant = !sameNormalizedLabel(productName, variantWithDur);
  const tierPreview = tgTierPreview({
    basePrice: unitPrice,
    bulkTiers: params.bulkTiers,
    bulkEnabled: params.bulkEnabled,
    stock,
    maxQty,
    qty: minQty,
    locale,
    formatPrice: formatPrimary,
  });

  const lines = en
    ? [
        "🛒 <b>Choose quantity</b>",
        `Product : <b>${escapeHtml(truncate(productName, 80))}</b>`,
        ...(showVariant ? [`Variant : ${escapeHtml(truncate(variantWithDur, 80))}`] : []),
        `Price   : ${escapeHtml(formatPrimary(unitPrice))} / pcs`,
        `Stock   : ${stockVal}`,
      ]
    : [
        "🛒 <b>Pilih jumlah</b>",
        `Produk : <b>${escapeHtml(truncate(productName, 80))}</b>`,
        ...(showVariant ? [`Varian : ${escapeHtml(truncate(variantWithDur, 80))}`] : []),
        `Harga  : ${escapeHtml(formatPrimary(unitPrice))} / pcs`,
        `Stok   : ${stockVal}`,
      ];
  if (opts?.usdUnavailable) {
    lines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  }
  if (tierPreview.length > 0) {
    lines.push("", `<blockquote>${tierPreview.join("\n")}</blockquote>`);
  }
  if (minQty > 1) {
    lines.push("", en ? `Minimum purchase ${minQty}` : `Minimal pembelian ${minQty}`);
  }
  return lines.join("\n");
}

export function reviewPurchaseMessage(params: {
  productName: string;
  variantLabel: string;
  duration?: string | null;
  qty: number;
  unitPrice: number;
  basePrice?: number;
  appliedTierMinQty?: number | null;
  deliveryKind?: "instant" | "queued" | null;
  sections?: ReviewCopySection[];
}, opts?: TgMoneyOpts & { formatPrice?: (idr: number) => string }): { text: string; truncated: boolean } {
  const locale = opts?.locale ?? "id";
  const en = locale === "en";
  const formatPrimary = (idr: number) => (opts?.formatPrice ? opts.formatPrice(idr) : formatIdr(idr, locale));
  const qty = Math.max(1, Math.floor(params.qty || 1));
  const total = params.unitPrice * qty;
  const base = Number(params.basePrice ?? NaN);
  const discounted = Number.isSafeInteger(base) && base > params.unitPrice;
  const saved = discounted ? (base - params.unitPrice) * qty : 0;
  const bulkNote = discounted
    ? (en ? ` (bulk ${params.appliedTierMinQty ?? ""}+, save ${formatPrimary(saved)})` : ` (grosir ${params.appliedTierMinQty ?? ""}+, hemat ${formatPrimary(saved)})`)
    : "";
  const rawDur = params.duration?.trim() ?? "";
  const variantWithDur = rawDur && !params.variantLabel.toLowerCase().includes(rawDur.toLowerCase())
    ? `${params.variantLabel} · ${rawDur}`
    : params.variantLabel;

  const header = en ? "🧾 <b>Read before you pay</b>" : "🧾 <b>Baca sebelum bayar</b>";
  const summaryLines = [
    `${escapeHtml(truncate(params.productName, 80))} · ${escapeHtml(truncate(variantWithDur, 80))}`,
    `${en ? "Quantity" : "Jumlah"} ${qty} × ${escapeHtml(formatPrimary(params.unitPrice))} = <b>${escapeHtml(formatPrimary(total))}</b>${escapeHtml(bulkNote)}`,
  ];
  if (params.deliveryKind === "instant") {
    summaryLines.push(en ? "⚡ Instant delivery after payment" : "⚡ Kirim otomatis setelah bayar");
  } else if (params.deliveryKind === "queued") {
    summaryLines.push(en ? "⏳ Processed by admin after payment" : "⏳ Diproses admin setelah bayar");
  }
  if (opts?.usdUnavailable) {
    summaryLines.push(en ? "USD equivalent unavailable — shown in IDR." : "Perkiraan USD tidak tersedia — ditampilkan dalam IDR.");
  }
  const topBlock = `${header}\n\n${summaryLines.join("\n")}`;
  const bottomBlock = en ? "By continuing, you agree to these terms." : "Dengan lanjut, kamu setuju ketentuan ini.";

  const titles: Record<ReviewCopySection["kind"], string> = en
    ? { package: "📦 Package details", activation: "🛠 How to activate", warranty_terms: "🛡 Warranty & terms" }
    : { package: "📦 Detail paket", activation: "🛠 Cara aktivasi", warranty_terms: "🛡 Garansi & ketentuan" };

  const seenLines = new Set<string>();
  const sections = (params.sections ?? [])
    .map((sec) => {
      const uniqueLines: string[] = [];
      for (const rawLine of sec.lines) {
        const plain = normalizeReviewPlain(rawLine);
        if (!plain) continue;
        const key = plain
          .replace(/^(?:[-–—•·*▪✓✔]+\s*|\d{1,2}[.)]\s+)/u, "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, " ")
          .trim();
        if (!key || seenLines.has(key)) continue;
        seenLines.add(key);
        uniqueLines.push(plain);
      }
      return {
        title: titles[sec.kind],
        lines: uniqueLines,
      };
    })
    .filter((sec) => sec.lines.length > 0);

  const renderSection = (title: string, lines: string[], trimmed: boolean): string => {
    const bodyLines = trimmed && lines[lines.length - 1] !== "…" ? [...lines, "…"] : lines;
    return `<blockquote><b>${escapeHtml(title)}</b>\n${bodyLines.map(escapeHtml).join("\n")}</blockquote>`;
  };
  const assemble = (kept: string[][], trimmedFlags: boolean[]): string => {
    const rendered = sections.map((sec, idx) => renderSection(sec.title, kept[idx], trimmedFlags[idx]));
    return [topBlock, ...rendered, bottomBlock].filter(Boolean).join("\n\n");
  };

  const kept = sections.map((sec) => [...sec.lines]);
  const trimmedFlags = sections.map(() => false);
  const full = assemble(kept, trimmedFlags);
  if (full.length <= 4096) {
    return { text: full, truncated: false };
  }

  // Iteratively trim the longest multi-line section so every section retains its opening lines.
  while (assemble(kept, trimmedFlags).length > 4096) {
    let bestIdx = -1;
    let bestLen = -1;
    for (let i = 0; i < kept.length; i++) {
      if (kept[i].length > 1) {
        const len = renderSection(sections[i].title, kept[i], trimmedFlags[i]).length;
        if (len > bestLen) {
          bestLen = len;
          bestIdx = i;
        }
      }
    }
    if (bestIdx === -1) break;
    kept[bestIdx].pop();
    trimmedFlags[bestIdx] = true;
  }

  // If still > 4096 when every section is down to 1 line, trim the longest single line safely.
  while (assemble(kept, trimmedFlags).length > 4096) {
    let bestIdx = -1;
    let bestLen = -1;
    for (let i = 0; i < kept.length; i++) {
      const len = escapeHtml(kept[i][0] ?? "").length;
      if (len > bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestLen <= 1) break;
    const current = assemble(kept, trimmedFlags);
    const excess = current.length - 4096;
    const line = kept[bestIdx][0] ?? "";
    const targetEscaped = Math.max(0, escapeHtml(line).length - excess - 2);
    const shortened = truncatePlainForEscapedMax(line, targetEscaped);
    if (shortened === line) break;
    kept[bestIdx][0] = shortened;
    // Shortened line already ends with "…", no extra "…" line needed.
    trimmedFlags[bestIdx] = false;
  }

  return { text: assemble(kept, trimmedFlags), truncated: true };
}

export function emailConfirmationMessage(params: {
  productName: string;
  variantLabel: string;
  qty: number;
  total: number;
  maskedEmail: string;
  basePrice?: number;
  appliedTierMinQty?: number | null;
}, opts?: { locale?: Locale }): string {
  const en = opts?.locale === "en";
  const unit = Number.isSafeInteger(params.qty) && params.qty > 0 ? Math.round(params.total / params.qty) : params.total;
  const discounted = Number.isSafeInteger(params.basePrice) && Number(params.basePrice) > unit;
  return [
    en ? "<b>📧 Email confirmation</b>" : "<b>📧 Konfirmasi email</b>",
    "",
    `<b>${escapeHtml(truncate(params.productName, 80))}</b>`,
    en ? `Variant: ${escapeHtml(truncate(params.variantLabel, 80))}` : `Varian: ${escapeHtml(truncate(params.variantLabel, 80))}`,
    en ? `Quantity: ${params.qty}` : `Jumlah: ${params.qty}`,
    ...(discounted ? [en ? `Unit price: ${formatIdr(unit, opts?.locale ?? "id")} (bulk ${params.appliedTierMinQty ?? ""}+)` : `Harga satuan: ${formatIdr(unit, opts?.locale ?? "id")} (grosir ${params.appliedTierMinQty ?? ""}+)`] : []),
    `<b>Subtotal: ${formatIdr(params.total, opts?.locale ?? "id")}</b>`,
    "",
    `Email: ${escapeHtml(params.maskedEmail)}`,
    en ? "Verify email before paying." : "Pastikan email benar.",
  ].join("\n");
}

export function orderReminderMessage(params: {
  orderCode: string;
  payableAmount: number;
  expiresMs: number;
  now?: number;
}, opts?: TgMoneyOpts): string {
  return providerOrderReminderMessage({ ...params, total: formatRupiah(params.payableAmount) }, opts);
}

/** Provider reminders never disclose payment instructions, address/link/VA. */
export function providerOrderReminderMessage(params: {
  orderCode: string;
  expiresMs: number;
  now?: number;
  total?: string;
}, opts?: TgMoneyOpts): string {
  const en = opts?.locale === "en";
  const { clock, remaining } = invoiceDeadline(params.expiresMs, en, params.now);
  return [
    `⏰ <b>${remaining} ${en ? "left" : "lagi"}</b>`,
    `${en ? "Code" : "Kode"}  : <code>${escapeItemSummary(params.orderCode, 120)}</code>`,
    ...(params.total ? [`Total : <code>${escapeHtml(params.total)}</code>`] : []),
    en ? `Complete payment before ${clock}.` : `Selesaikan pembayaran sebelum ${clock}.`,
  ].join("\n");
}

export type TgInvoiceOpts = TgMoneyOpts & { chargeNote?: boolean };

/** Shared offer crypto helpers: prefer USDT as representative summary, keeping exact quoted amount. */
export function isUsdtOfferMethod(method: { id?: string; label?: string; pay_currency?: string }): boolean {
  const pc = String(method.pay_currency ?? "").toLowerCase();
  const id = String(method.id ?? "").toLowerCase();
  const lbl = String(method.label ?? "").toUpperCase();
  return pc.startsWith("usdt") || id.includes(":usdt") || lbl === "USDT";
}

export function isQrisOfferMethod(method: { kind?: string; label?: string }): boolean {
  const rawLabel = String(method.label ?? "").trim();
  const displayLabel = /^qris\s+dinamis$/i.test(rawLabel) ? "QRIS" : rawLabel;
  return method.kind === "qris" || /^qris$/i.test(displayLabel);
}

export function pickRepresentativeCryptoMethod<
  T extends { id?: string; kind?: string; label?: string; amount_text?: string; pay_currency?: string }
>(methods: readonly T[]): T | null {
  const cryptoMethods = methods.filter((m) => m.kind === "crypto");
  if (cryptoMethods.length === 0) return null;
  return cryptoMethods.find((m) => isUsdtOfferMethod(m)) ?? cryptoMethods[0];
}

export function cryptoPickerMessage(methods: readonly { kind?: string; total_cents?: number }[], page?: string, opts?: TgMoneyOpts): string {
  const en = opts?.locale === "en";
  if (page === "others") return en ? "🪙 <b>Other coins</b>" : "🪙 <b>Koin lainnya</b>";
  if (page) return `🪙 <b>${escapeHtml(page)}</b> · ${en ? "choose a network" : "pilih jaringan"}`;
  const cents = methods.flatMap(m => m.kind === "crypto" && Number.isSafeInteger(m.total_cents) ? [m.total_cents!] : []);
  // Fees vary by coin/network; don't present a representative quote as everyone's total.
  const usd = (n: number) => (n / 100).toFixed(2);
  const min = Math.min(...cents), max = Math.max(...cents);
  const total = !cents.length ? "—" : min === max ? usd(min) : `${usd(min)}–${usd(max)}`;
  return [
    en ? "🪙 <b>Choose a coin</b>" : "🪙 <b>Pilih koin</b>",
    `Total : <b>${total} USD</b> (${en ? "service fee included" : "biaya layanan termasuk"})`,
    en ? "Send on the selected network; gas is paid by the sender." : "Kirim di jaringan yang dipilih; gas ditanggung pengirim.",
  ].join("\n");
}

/** R1 frozen method offer copy (localized). */
export function paymentMethodOfferMessage(
  params: { productName: string; subtotal: number },
  opts?: TgMoneyOpts,
): string {
  const locale = opts?.locale ?? "id";
  const en = locale === "en";
  return [
    en ? "💳 <b>Choose payment</b>" : "💳 <b>Pilih pembayaran</b>",
    en ? `Product : ${escapeItemSummary(params.productName, 220)}` : `Produk : ${escapeItemSummary(params.productName, 220)}`,
    `${en ? "Total   :" : "Total  :"} <b>${formatIdr(params.subtotal, locale)}</b>`,
    ...(opts?.usdEquivalentText ? [`≈ ${opts.usdEquivalentText}`] : []),
  ].join("\n");
}

/** R1 frozen offer detail lines: one short line per available method kind,
 * ordered by locale (ID: QRIS then Crypto; EN: Crypto then QRIS). */
export function paymentMethodOfferDetails(
  methods: { id?: string; kind?: string; label?: string; gateway?: { estimated_fee: number; estimated_total: number } | null; amount_text?: string; pay_currency?: string; network?: string }[],
  opts?: TgMoneyOpts & { subtotal?: number },
): string[] {
  const en = opts?.locale === "en";
  const hasQris = methods.some((m) => m.kind !== "crypto" && isQrisOfferMethod(m));
  const hasGateway = methods.some((m) => m.kind === "gateway");
  const hasCrypto = methods.some((m) => m.kind === "crypto");

  const qrisLines = hasQris
    ? [en ? "QRIS: Indonesian e-wallets &amp; m-banking." : "QRIS: semua e-wallet &amp; m-banking."]
    : [];
  const gatewayLines = hasGateway
    ? [en ? "Virtual Account &amp; e-wallet." : "Virtual Account &amp; e-wallet."]
    : [];
  const cryptoLines = hasCrypto
    ? [en ? "Crypto: USDT, BTC, ETH, etc." : "Crypto: USDT, BTC, ETH, dll."]
    : [];

  return en
    ? [...cryptoLines, ...gatewayLines, ...qrisLines]
    : [...qrisLines, ...gatewayLines, ...cryptoLines];
}

/** R2 selection + expiry/refresh notices (localized, honest, no fallback). */
export function paymentMethodNoticeMessage(
  kind: "selected_other" | "expired" | "refreshed" | "deferred" | "unavailable" | "creating" | "create_failed" | "contact_needed" | "not_ready" | "method_unavailable" | "catalog_changed",
  opts?: TgMoneyOpts,
): string {
  const en = opts?.locale === "en";
  switch (kind) {
    case "selected_other":
      return en
        ? "Method selected. Tap Continue to pay."
        : "Metode dipilih. Tekan Lanjut untuk bayar.";
    case "creating":
      return en
        ? "Creating payment… do not tap again."
        : "Membuat pembayaran… jangan tekan lagi.";
    case "create_failed":
      return en
        ? "Payment method error. Try another method."
        : "Metode pembayaran gangguan. Coba metode lain.";
    case "contact_needed":
      return en
        ? "Contact info needed. Reply with requested detail, then reselect."
        : "Butuh info kontak. Balas detail yang diminta lalu pilih lagi.";
    case "method_unavailable":
      return en
        ? "Method unavailable. Choose another method."
        : "Metode belum tersedia. Pilih metode lain.";
    case "not_ready":
      return en
        ? "Preparing offer. Tap again shortly."
        : "Penawaran sedang disiapkan. Ketuk lagi sebentar.";
    case "expired":
      return en
        ? "Offer expired. Showing latest prices."
        : "Penawaran kedaluwarsa. Harga terbaru ditampilkan.";
    case "catalog_changed":
      return en ? "Price or stock was just updated. Please try again." : "Harga/stok baru saja diperbarui, coba lagi.";
    case "refreshed":
      return en
        ? "Showing latest offer."
        : "Menampilkan penawaran terbaru.";
    case "deferred":
      return en
        ? "Finish the current step first."
        : "Selesaikan langkah saat ini dulu.";
    case "unavailable":
      return en
        ? "Other methods unavailable. QRIS still works."
        : "Metode lain belum tersedia. QRIS tetap aktif.";
  }
}

export function invoiceMessage(params: {
  orderCode: string;
  productName: string;
  payableAmount: number;
  expiresAt: string;
  paymentMethod?: string;
  /** Legacy field, never rendered: buyer PINs are email-only. */
  buyerAccessCode?: string;
}, opts?: TgInvoiceOpts): string {
  const isQris = !params.paymentMethod || params.paymentMethod === "qris";
  const en = opts?.locale === "en";
  const total = formatRupiah(params.payableAmount);
  const bullets = !isQris ? [] : en
    ? ["Scan the QR above with any e-wallet or mobile banking app", `Pay exactly ${total} (last 3 digits include the unique code)`, TELEGRAM_QRIS_DEADLINE_NOTICE.en]
    : ["Scan QR di atas pakai e-wallet/m-banking apa pun", `Bayar persis ${total} (3 digit terakhir kode unik)`, TELEGRAM_QRIS_DEADLINE_NOTICE.id];
  return pendingInvoiceMessage({ ...params, total, bullets, maxLength: 1024,
    chargeNote: isQris && en && opts?.chargeNote ? "Charged in IDR, even when your display currency is USD." : undefined }, opts);
}

/** QRIS photo and non-QRIS text share the same receipt layout. Bullets are caller-escaped HTML. */
export function pendingInvoiceMessage(params: {
  orderCode: string;
  productName: string;
  total: string;
  expiresAt: string;
  bullets: string[];
  chargeNote?: string;
  maxLength?: number;
}, opts?: TgMoneyOpts): string {
  const en = opts?.locale === "en";
  const { clock, remaining } = invoiceDeadline(parseExpiry(params.expiresAt), en);
  const divider = "━━━━━━━━━━━━━━━━";
  const header = [
    en ? "⏳ <b>Awaiting payment</b>" : "⏳ <b>Menunggu pembayaran</b>", divider,
    `${en ? "Code" : "Kode"}   : <code>${escapeItemSummary(params.orderCode, 120)}</code>`,
    `${en ? "Product" : "Produk"} : `,
  ].join("\n");
  const footer = [
    `Total  : <code>${escapeHtml(params.total)}</code>`,
    `${en ? "Due" : "Batas"}  : ${clock} (${remaining})`, divider,
    ...params.bullets.map(line => `• ${line}`),
    ...(params.chargeNote ? [params.chargeNote] : []),
  ].join("\n");
  const product = escapeItemSummary(params.productName.split("\n").slice(0, 20).join("\n"),
    (params.maxLength ?? 4096) - header.length - footer.length - 1);
  return `${header}${product}\n${footer}`;
}
