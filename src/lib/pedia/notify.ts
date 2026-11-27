// src/lib/pedia/notify.ts — Notifikasi Telegram Pedia (PEDIA-PRD II/§9.5).
//
// Pembeli: pembayaran, selesai, atau penyelesaian manual melalui outbox.
// + 2 ke admin (needs_check konfirmasi ganda resubmit/cancel; saldo < ambang).
// TIDAK ADA spam per-paket kecil. Email pembeli dikirim bersamaan (M5).

import { escapeHtml } from "@/lib/telegram/messages/format";
import { QueryBudgetExceeded, type createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider, type PediaProvider } from "@/lib/pedia/proxy";
import { SITE } from "@/lib/site";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { refillLabel, whiteLabel } from "@/lib/pedia/terms";
import { pediaServiceName } from "@/lib/pedia/copy";
import { renderBrandedNotice, type BrandedNoticeContext } from "@/lib/warung-rebahan/email-forward";

type Db = ReturnType<typeof createDatabaseAccess>;
export type PediaEmailLocale = "id" | "en";

export type PediaBuyerContext = {
  email: string;
  displayName: string;
  productName: string;
  serviceName: string;
  quantity: number;
  target: string;
  /** Pedia item status at context read time (sender re-verifies inside its boundary). */
  status: string;
  hasReceipt: boolean;
  orderPaid: boolean;
  paidAt: string | null;
  startCount: number | null;
  remains: number | null;
  done: number | null;
  percent: number | null;
  etaStart: string | null;
  etaFinish: string | null;
  refillDays: number;
  pediaUrl: string;
  /** Locale pembeli tersimpan di orders.locale (default id). */
  locale: PediaEmailLocale;
  salesChannel?: string;
  telegramUserId?: string | null;
  productId?: number;
  tierId?: number;
  apiRefill?: boolean;
  itemRow?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
};

function sanitizePublicText(value: unknown, max = 200): string {
  return whiteLabel(String(value ?? "")).trim().slice(0, max);
}

/** Unit waktu data (mis. "0–4 jam") dialihbahasakan HANYA untuk tampilan EN. */
function timeText(value: string, locale: PediaEmailLocale): string {
  if (locale !== "en") return value;
  return value
    .replace(/(\d+)\s*jam\b/gi, "$1 hours")
    .replace(/(\d+)\s*menit\b/gi, "$1 minutes")
    .replace(/(\d+)\s*hari\b/gi, "$1 days");
}

function etaLine(etaStart: string | null, etaFinish: string | null, locale: PediaEmailLocale = "id"): string | null {
  const start = (etaStart ?? "").trim();
  const finish = (etaFinish ?? "").trim();
  if (locale === "en") {
    if (finish) return `Estimated finish: ${timeText(finish, locale)}. The estimate follows the queue.`;
    if (start === "Mengikuti antrean layanan") return "Estimated start: follows the service queue.";
    if (start) return `Estimated start: ${timeText(start, locale)} after payment. Service estimate, not a guarantee.`;
    return null;
  }
  if (finish) return `Perkiraan selesai: ${finish}. Estimasi mengikuti antrean.`;
  if (start) {
    if (start === "Mengikuti antrean layanan") return start + ".";
    return `Perkiraan mulai: ${start} setelah pembayaran. Estimasi layanan, bukan jaminan.`;
  }
  return null;
}

/**
 * Shell email `renderBrandedNotice` masih berbahasa Indonesia (dipakai Market).
 * Untuk pembeli EN, footer/label shell diterjemahkan di lapisan Pedia TANPA
 * mengubah modul bersama; teks tak dikenal dibiarkan apa adanya.
 */
const SHELL_EN: [string, string][] = [
  // Kalimat utuh dulu, baru fragmen (urutan penting agar tidak terpotong dini).
  ["Email otomatis dari Axvara, mohon jangan dibalas.", "Automated email from Axvara, please do not reply."],
  ["Butuh bantuan? Tim kami siap membantu:", "Need help? Our team is ready to assist:"],
  ["Halaman pesanan: ", "Order page: "],
  ['lang="id"', 'lang="en"'],
  ["NO. INVOICE", "INVOICE NO."],
  ["Hubungi Kami via WhatsApp", "Contact us on WhatsApp"],
  ["Terima kasih sudah berbelanja di", "Thanks for shopping at"],
  ["Email otomatis", "Automated email"],
  ["mohon jangan dibalas.", "please do not reply."],
  ["Butuh bantuan? WA ", "Need help? WA "],
];
function localizeShell(rendered: { html: string; text: string }, locale: PediaEmailLocale): { html: string; text: string } {
  if (locale !== "en") return rendered;
  const apply = (value: string) => SHELL_EN.reduce((out, [from, to]) => out.split(from).join(to), value);
  return { html: apply(rendered.html), text: apply(rendered.text) };
}

/** Single joined buyer context: ONE budgeted read (orders ⨝ pedia item ⨝
 *  product/tier). Snapshot names (never live tier edits except the
 *  pre-existing eta/label read); supplier identity, wholesale cost and raw
 *  IDs never exposed. Counts keep null (unknown ≠ 0). */
export async function pediaBuyerContext(db: Db, orderCode: string): Promise<PediaBuyerContext | null> {
  if (!db.canSpend(1)) return null;
  const row = await db.queryFirst(
    `SELECT o.customer_name, o.customer_email, o.sales_channel, o.telegram_user_id, o.locale, o.status AS order_status, o.payment_status, o.paid_at,
            i.product_id, i.tier_id, i.status AS item_status, i.quantity, i.start_count, i.remains, i.target_normalized, i.supplier_order_id,
            i.snapshot_json, i.created_at, i.completed_at, i.refill_status, i.refill_last_at, i.refill_supplier_id,
            p.name AS product_name, t.tier AS tier_name, t.label_note, t.refill_days,
            t.eta_start, t.eta_finish, COALESCE(s.api_refill,0) AS api_refill
       FROM orders o
       JOIN pedia_order_items i ON i.order_code=o.code
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
       LEFT JOIN pedia_supplier_services s ON s.supplier=i.supplier AND s.service_id=i.supplier_service_id
      WHERE o.code=?`,
    orderCode,
  ).catch(() => null);
  if (!row) return null;
  const { pediaDisplayName } = await import("@/lib/pedia/notify-channel");
  let snap: Record<string, unknown> = {};
  try { snap = JSON.parse(String(row.snapshot_json ?? "{}")) ?? {}; } catch { /* legacy */ }
  const copy = readPediaServiceCopy(snap.service_copy);
  const productName = sanitizePublicText(copy?.product_name ?? row.product_name, 120) || "Pesanan Pedia";
  const serviceName = sanitizePublicText(copy?.service_name ?? row.label_note ?? row.tier_name, 200) || productName;
  const qty = Number(row.quantity) || 0;
  const countNumber = (value: unknown) => (typeof value === "number" || typeof value === "string") && String(value).trim() !== "" ? Number(value) : NaN;
  const rawStart = countNumber(row.start_count);
  const rawRemains = countNumber(row.remains);
  const startCount = Number.isSafeInteger(rawStart) && rawStart >= 0 ? rawStart : null;
  const remains = Number.isSafeInteger(rawRemains) && rawRemains >= 0 && rawRemains <= qty ? rawRemains : null;
  const itemStatus = String(row.item_status);
  const done = itemStatus === "completed" ? qty : remains != null ? qty - remains : null;
  const percent = qty > 0 && done !== null ? (done / qty) * 100 : null;
  return {
    email: String(row.customer_email ?? "").trim(),
    displayName: pediaDisplayName(row),
    productName,
    serviceName,
    quantity: qty,
    target: String(row.target_normalized ?? "").slice(0, 120),
    status: itemStatus,
    hasReceipt: String(row.supplier_order_id ?? "").trim().length > 0,
    orderPaid: String(row.order_status) === "lunas" && String(row.payment_status) === "paid",
    paidAt: row.paid_at != null ? String(row.paid_at) : null,
    startCount,
    remains,
    done,
    percent,
    etaStart: row.eta_start != null ? String(row.eta_start) : null,
    etaFinish: row.eta_finish != null ? String(row.eta_finish) : null,
    // Snapshot refill_days (order-time terms); live tier is not re-read here.
    refillDays: Number((snap as Record<string, unknown>)?.refill_days) || 0,
    pediaUrl: `${SITE.pediaUrl.replace(/\/$/, "")}/pesanan/${encodeURIComponent(orderCode)}`,
    locale: String(row.locale) === "en" ? "en" : "id",
    salesChannel: String(row.sales_channel ?? "web"),
    telegramUserId: row.telegram_user_id != null ? String(row.telegram_user_id) : null,
    productId: Number(row.product_id) || 0,
    tierId: Number(row.tier_id) || 0,
    apiRefill: Number(row.api_refill) === 1,
    itemRow: {
      status: itemStatus,
      created_at: row.created_at,
      completed_at: row.completed_at,
      refill_status: row.refill_status,
      refill_last_at: row.refill_last_at,
      refill_supplier_id: row.refill_supplier_id,
      supplier_order_id: row.supplier_order_id,
      refill_days: row.refill_days,
    },
    snapshot: snap,
  };
}

/** Terminal Pedia item states: completion/followup/expiry. A deferred
 *  paid/processing send must never claim "sedang berjalan" here. */
export function isPediaTerminalStatus(status: string): boolean {
  return ["completed", "partial", "canceled", "expired"].includes(status);
}

/** Shared branded-email fields: Market shell, Pedia CTA, detail rows.
 *  Unknown numbers are labelled, never 0. Caller supplies title/subtitle/
 *  pill paragraph + callout policy; renderer escapes everything. */
function pediaBrandedFields(ctx: PediaBuyerContext): {
  orderCode: string; orderUrl: string; supportWa: string;
  ctaLabel: string; details: { label: string; value: string }[];
} {
  const en = ctx.locale === "en";
  const fmt = (n: number) => n.toLocaleString(en ? "en-US" : "id-ID");
  const productName = en ? pediaServiceName(ctx.productName, "en") : ctx.productName;
  const serviceName = en ? pediaServiceName(ctx.serviceName, "en") : ctx.serviceName;
  const details = [
    { label: en ? "Service" : "Layanan", value: `${productName} · ${serviceName}` },
    { label: en ? "Quantity ordered" : "Jumlah dipesan", value: fmt(ctx.quantity) },
    { label: en ? "Start count" : "Jumlah awal", value: ctx.startCount != null ? fmt(ctx.startCount) : (en ? "Not reported yet" : "Belum dilaporkan") },
  ];
  if (ctx.status !== "completed") {
    details.push({ label: en ? "Remaining" : "Sisa", value: ctx.remains != null ? fmt(ctx.remains) : (en ? "Not reported yet" : "Belum dilaporkan") });
  }
  details.push({
    label: en ? "Delivered" : "Masuk",
    value: ctx.done != null ? (en ? `${fmt(ctx.done)} of ${fmt(ctx.quantity)}` : `${fmt(ctx.done)} dari ${fmt(ctx.quantity)}`) : (en ? "Not confirmed yet" : "Belum dikonfirmasi"),
  });
  if (ctx.target) details.push({ label: en ? "Target link" : "Link tujuan", value: ctx.target });
  return {
    orderCode: ctx.pediaUrl.split("/").pop() ?? "",
    orderUrl: ctx.pediaUrl,
    supportWa: SITE.adminWaLocal,
    ctaLabel: en ? "View Order Status →" : "Lihat Status Pesanan →",
    details,
  };
}

function pediaLifecycleLine(ctx: PediaBuyerContext): string {
  if (ctx.locale === "en") {
    if (ctx.status === "completed") return "completed";
    if (ctx.status === "partial") return "partially completed — we are following up";
    if (ctx.status === "canceled") return "canceled — we are following up";
    if (ctx.status === "needs_check") return "being checked by our team";
    if (ctx.status === "expired") return "expired";
    if (ctx.status === "in_progress") return "in progress";
    return "queued and will be processed automatically";
  }
  if (ctx.status === "completed") return "selesai";
  if (ctx.status === "partial") return "selesai sebagian — sedang kami tindak lanjuti";
  if (ctx.status === "canceled") return "dibatalkan — sedang kami tindak lanjuti";
  if (ctx.status === "needs_check") return "sedang kami cek";
  if (ctx.status === "expired") return "kedaluwarsa";
  if (ctx.status === "in_progress") return "sedang berjalan";
  return "masuk antrean dan akan diproses otomatis";
}

export type PediaEmailPayload = { subject: string; text: string; html: string };

function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] || "Kak";
}

/** Render shell bersama lalu terjemahkan footer/labelnya untuk pembeli EN. */
function renderNotice(ctx: PediaBuyerContext, params: Omit<BrandedNoticeContext, "orderCode" | "orderUrl" | "supportWa">): { html: string; text: string } {
  return localizeShell(renderBrandedNotice({ ...pediaBrandedFields(ctx), ...params }), ctx.locale);
}

/** Paid → Market shell: title/subtitle/pill + greeting + lifecycle + eta. */
function paidEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const en = ctx.locale === "en";
  const eta = ctx.status === "completed" ? null : etaLine(ctx.etaStart, ctx.etaFinish, ctx.locale);
  const queueLine = en ? "queued and will be processed automatically" : "masuk antrean dan akan diproses otomatis";
  const rendered = renderNotice(ctx, {
    title: en ? "Payment Received" : "Pembayaran Diterima",
    subtitle: en ? "Your order is queued and will be processed automatically." : "Pesananmu masuk antrean dan diproses otomatis.",
    status: { label: en ? "Payment received" : "Pembayaran diterima", tone: "success" },
    paragraphs: en ? [
      `Hi ${firstWord(ctx.displayName)}, we have received your payment for your Pedia order.`,
      `${pediaLifecycleLine(ctx) === queueLine ? "Your order is queued and will be processed automatically." : `Current status: ${pediaLifecycleLine(ctx)}.`} The latest status is always on the order page.`,
    ] : [
      `Halo ${firstWord(ctx.displayName)}, pembayaran untuk pesanan Pedia kamu sudah kami terima.`,
      `${pediaLifecycleLine(ctx) === queueLine ? "Pesanan masuk antrean dan akan diproses otomatis." : `Status saat ini: ${pediaLifecycleLine(ctx)}.`} Status terbaru selalu ada di halaman pesanan.`,
    ],
    callout: eta ? { text: eta, tone: "info" } : null,
  });
  return { subject: en ? `Payment received — ${orderCode}` : `Pembayaran diterima — ${orderCode}`, text: rendered.text, html: rendered.html };
}

/** Processing ("Diproses" = accepted, not necessarily running yet). */
function processingEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const en = ctx.locale === "en";
  const eta = etaLine(ctx.etaStart, ctx.etaFinish, ctx.locale);
  // Info callout when there is no progress yet (or a finish estimate exists).
  const showEta = eta && (ctx.done == null || ctx.etaFinish);
  const rendered = renderNotice(ctx, {
    title: en ? "Order Processing" : "Pesanan Diproses",
    subtitle: en ? "Your order has been accepted and is being processed." : "Pesananmu sudah diterima sistem dan sedang diproses.",
    status: { label: en ? "Processing" : "Diproses", tone: "info" },
    paragraphs: en ? [
      `Hi ${firstWord(ctx.displayName)}, your Pedia order has been accepted and is being processed automatically.`,
      "The numbers below are the report at the time this email was sent. Follow the latest progress on the order page.",
    ] : [
      `Halo ${firstWord(ctx.displayName)}, pesanan Pedia kamu sudah diterima sistem dan sedang diproses otomatis.`,
      "Angka di bawah adalah laporan saat email ini dikirim. Pantau perkembangan terbaru di halaman pesanan.",
    ],
    callout: showEta ? { text: eta, tone: "info" } : null,
  });
  return { subject: en ? `Order processing — ${orderCode}` : `Pesanan sedang diproses — ${orderCode}`, text: rendered.text, html: rendered.html };
}

/** Completed → Market shell, Refill N Days terms (never "masa garansi"). */
function completedEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const en = ctx.locale === "en";
  const rendered = renderNotice(ctx, {
    title: en ? "Order Completed" : "Pesanan Selesai",
    subtitle: en ? "Thank you for ordering at AXVARA Pedia." : "Terima kasih sudah memesan di AXVARA Pedia.",
    status: { label: en ? "Completed" : "Selesai", tone: "success" },
    paragraphs: [en ? `Hi ${firstWord(ctx.displayName)}, your Pedia order is complete.` : `Halo ${firstWord(ctx.displayName)}, pesanan Pedia kamu sudah selesai.`],
    callout: ctx.refillDays > 0
      ? {
        text: en
          ? `This service includes ${refillLabel(ctx.refillDays)}. If the count drops during the refill period, request a refill from the order page.`
          : `Layanan ini memiliki ${refillLabel(ctx.refillDays)}. Bila jumlah turun dalam masa refill, ajukan refill dari halaman pesanan.`,
        tone: "info",
      }
      : null,
  });
  return { subject: en ? `Order completed — ${orderCode}` : `Pesanan selesai — ${orderCode}`, text: rendered.text, html: rendered.html };
}

/** Phase send boundary: single joined context, current paid state verified
 *  INSIDE the sender (no mail for unpaid), terminal suppression for stale
 *  phases, then fenced claim → transport → CAS settle. Returns true when
 *  the phase is sent or already durably sent/superseded.
 *
 *  Deferred retries rebuild from the durable row and apply the same rules. */
async function sendPediaPhase(
  db: Db,
  phase: "paid" | "processing" | "completed",
  orderCode: string,
  build: (ctx: PediaBuyerContext) => PediaEmailPayload,
  allow: (ctx: PediaBuyerContext) => boolean,
): Promise<boolean> {
  const { claimPediaEmail, settlePediaEmail, supersedePediaEmail, pediaEmailKey } = await import("@/lib/pedia/notify-channel");
  const key = pediaEmailKey(phase, orderCode);
  // Deterministic affordable budget BEFORE claim/transport: 1 context read +
  // claim + settle + transport slack. Never start a send the budget cannot finish.
  if (!db.canSpend(5)) return false;
  const live = await pediaBuyerContext(db, orderCode);
  if (!live || !live.email || !live.orderPaid) return false;
  // Eligibility and email body both use the live durable state.
  if (!allow(live)) {
    // Only terminal stale processing is superseded; a future phase remains due.
    if (phase !== "processing" || !isPediaTerminalStatus(live.status)) return false;
    const claim = await claimPediaEmail(db, phase, orderCode);
    if (claim) return supersedePediaEmail(db, key, claim.lease, `stale-at-${live.status}`);
    const existing = await db.queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key).catch(() => null);
    return String(existing?.status ?? "") === "sent";
  }
  const ctx = live;
  const claim = await claimPediaEmail(db, phase, orderCode);
  if (!claim) {
    const existing = await db.queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key).catch(() => null);
    return String(existing?.status ?? "") === "sent";
  }
  let payload: PediaEmailPayload;
  try {
    payload = build(ctx);
  } catch {
    await settlePediaEmail(db, key, claim.lease, false, "build_failed");
    return false;
  }
  try {
    const { sendPediaEmail } = await import("@/lib/pedia/email");
    const ok = await sendPediaEmail({ to: ctx.email, subject: payload.subject, text: payload.text, html: payload.html });
    const settled = await settlePediaEmail(db, key, claim.lease, ok, ok ? undefined : "send_failed");
    return ok && settled;
  } catch {
    await settlePediaEmail(db, key, claim.lease, false, "send_failed");
    return false;
  }
}

/** Pembeli: paid — independent of supplier success (fires on lunas sight,
 *  even when submit later fails). Durable fenced claim+settle
 *  (`email:pedia-paid:<code>`). */
export async function notifyPediaPaid(db: Db, orderCode: string, siteUrl?: string): Promise<boolean> {
  void siteUrl;
  return sendPediaPhase(db, "paid", orderCode,
    (ctx) => paidEmail(ctx, orderCode),
    // Paid confirms payment even if the lifecycle already advanced; the body
    // states the CURRENT lifecycle truthfully (never "diproses" for terminal).
    () => true,
  );
}

/** Processing waits for a durable receipt and complete, validated counts. */
export async function notifyPediaProcessing(
  db: Db, orderCode: string,
  counts?: { startCount: number | null; remains: number | null },
): Promise<boolean> {
  void counts;
  return sendPediaPhase(db, "processing", orderCode,
    (ctx) => processingEmail(ctx, orderCode),
    (ctx) => ["submitted", "in_progress"].includes(ctx.status) && ctx.hasReceipt &&
      Number.isSafeInteger(ctx.quantity) && ctx.quantity > 0 && ctx.startCount !== null && ctx.remains !== null,
  );
}

async function sendPediaTelegramCompleted(db: Db, orderCode: string): Promise<boolean> {
  if (process.env.TELEGRAM_BOT_ENABLED !== "true" || !process.env.TELEGRAM_BOT_TOKEN) return false;
  if (!db.canSpend(4)) return false;
  const ctx = await pediaBuyerContext(db, orderCode);
  if (!ctx || !ctx.orderPaid || ctx.status !== "completed" || ctx.salesChannel !== "telegram") return false;
  const chatId = String(ctx.telegramUserId ?? "").trim();
  if (!/^[1-9]\d*$/.test(chatId) || !Number.isSafeInteger(Number(chatId))) return false;
  const key = `telegram:pedia-completed:${orderCode}`;
  const lease = crypto.randomUUID();
  try {
    const existing = await db.queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key).catch(() => null);
    if (String(existing?.status ?? "") === "sent") return true;
    const claimed = await db.execRun(
      `INSERT INTO buyer_notice_log AS b
         (idempotency_key, order_code, channel, status, access_attempts, access_lease, access_retry_at)
       SELECT ?, code, 'telegram', 'sending', 1, ?, datetime('now','+1 minute')
       FROM orders WHERE code=? AND sales_channel='telegram' AND status='lunas' AND payment_status='paid'
       ON CONFLICT(idempotency_key) DO UPDATE SET
         status='sending', access_attempts=b.access_attempts+1, access_lease=excluded.access_lease,
         access_retry_at=datetime('now', CASE b.access_attempts
           WHEN 0 THEN '+1 minute' WHEN 1 THEN '+5 minutes'
           WHEN 2 THEN '+15 minutes' ELSE '+60 minutes' END),
         error=NULL, updated_at=datetime('now')
       WHERE b.access_attempts < 5
         AND (b.access_retry_at IS NULL OR datetime(b.access_retry_at) <= datetime('now'))
         AND (b.status='failed' OR (b.status='sending'
           AND julianday(b.updated_at) <= julianday('now','-10 minutes')))`,
      key, lease, orderCode,
    );
    if (!claimed.changes) return false;
  } catch {
    return false;
  }
  const { pediaRefillState } = await import("@/lib/pedia/refill-policy");
  const refill = pediaRefillState(ctx.itemRow ?? { status: ctx.status }, ctx.snapshot ?? {}, Boolean(ctx.apiRefill));
  const en = ctx.locale === "en";
  const { sendMessage } = await import("@/lib/telegram/api");
  const { pediaCompletedNoticeMessage } = await import("@/lib/telegram/messages/pedia");
  const { cb } = await import("@/lib/telegram/keyboards");
  const rows = [];
  if (refill.eligible) {
    rows.push([{ text: en ? "♻️ Request Refill" : "♻️ Ajukan Refill", callback_data: cb.pediaRefill(orderCode), style: "success" as const }]);
  }
  const reorderCb = ctx.productId && ctx.tierId ? cb.pediaSelect(ctx.productId, ctx.tierId) : cb.pediaHome();
  rows.push([{ text: en ? "🔁 Order Again" : "🔁 Pesan Lagi", callback_data: reorderCb }]);
  rows.push([
    { text: en ? "📋 View Order" : "📋 Lihat Pesanan", callback_data: cb.order(orderCode) },
    { text: en ? "🏠 Home" : "🏠 Menu", callback_data: cb.home() },
  ]);
  const sent = await sendMessage({
    chat_id: chatId,
    text: pediaCompletedNoticeMessage({
      orderCode,
      productName: ctx.productName,
      serviceName: ctx.serviceName,
      quantity: ctx.quantity,
      target: ctx.target,
      refillDays: ctx.refillDays,
      refillEligible: refill.eligible,
      locale: ctx.locale,
    }),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  }).catch(() => ({ ok: false }));
  await db.execRun(
    `UPDATE buyer_notice_log SET status=?, error=?, access_lease=NULL, updated_at=datetime('now')
     WHERE idempotency_key=? AND status='sending' AND access_lease=?`,
    sent.ok ? "sent" : "failed", sent.ok ? null : "telegram_send_failed", key, lease,
  ).catch(() => undefined);
  return sent.ok === true;
}

/** Pembeli: selesai — ONLY on confirmed completed. */
export async function notifyPediaCompleted(db: Db, orderCode: string): Promise<boolean> {
  const emailOk = await sendPediaPhase(db, "completed", orderCode,
    (ctx) => completedEmail(ctx, orderCode),
    (ctx) => ctx.status === "completed",
  );
  const tgOk = await sendPediaTelegramCompleted(db, orderCode).catch(() => false);
  return emailOk || tgOk;
}

/** Admin: antrean needs_check (MANUAL — bukan auto-refund). */
export async function notifyPediaNeedsCheck(db: Db, orderCode: string, reason: string): Promise<"sent" | "rejected" | "unknown"> {
  void db;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return "unknown";
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `🟡 <b>Pedia butuh tindakan manual</b>\n${escapeHtml(orderCode)}\nSebab: ${escapeHtml(reason.slice(0,500))}\n\nBuka Admin → Pedia → Pesanan.`,
    parse_mode: "HTML",
  }).catch(() => null);
  if (result?.ok) return "sent";
  return result && [400,403,429].includes(Number(result.error_code)) ? "rejected" : "unknown";
}

const PEDIA_LOW_BALANCE_STEP_IDR = 25_000;

/** Reset marker alert saldo IndoSMM saat saldo pulih (>= ambang) agar episode
 * menipis berikutnya tetap memberi kabar sekali. */
export async function clearPediaLowBalanceMarker(db?: Db, supplier: PediaProvider = "indosmm"): Promise<void> {
  if (!db || !isPediaProvider(supplier)) return;
  try {
    await db.execRun(
      `UPDATE store_settings SET value='', updated_at=datetime('now')
       WHERE key='pedia_indosmm_balance_alert_at' AND COALESCE(value,'')<>''`,
    );
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
  }
}

/** Admin: saldo supplier < ambang (keputusan owner 2026-11-27).
 *
 * Kirim sekali saat pertama turun di bawah ambang; tidak mengulang saat saldo
 * stagnan. Bunyi lagi hanya bila saldo TURUN ≥ Rp25.000 dari alert terakhir,
 * atau setelah pulih (>= ambang, marker direset oleh `clearPediaLowBalanceMarker`)
 * lalu menipis kembali. State `amount|timestamp_ms` disimpan di
 * `store_settings.pedia_indosmm_balance_alert_at` (tanpa migrasi skema; format
 * datetime lama dimigrasi diam-diam tanpa spam ganda).
 *
 * State wajib tersedia dan diklaim atomik SEBELUM jaringan. Saat D1/budget
 * gagal, alert saldo ditunda; jangan menganggap error baca sebagai belum ada
 * state atau tetap mengirim sesudah error tulis. Reservasi dipertahankan bila
 * Telegram gagal/ambigu untuk menghindari pengiriman ulang tiap tick.
 * Mengembalikan true hanya bila Telegram mengakui pesan. */
export async function notifyPediaLowBalance(balance: number, db?: Db, supplier: PediaProvider = "indosmm"): Promise<boolean> {
  if (!db || !isPediaProvider(supplier) || !Number.isFinite(balance) || balance < 0) return false;
  const key = "pedia_indosmm_balance_alert_at";
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) return false;
  const now = Date.now();
  const amount = Math.floor(Number(balance) || 0);
  try {
    const row = await db.queryFirst(
      `SELECT value FROM store_settings WHERE key=?`, key,
    );
    const raw = row ? String(row.value ?? "") : "";
    // Compare-and-set also handles two first-ever alerts racing on an absent row.
    const claim = (value: string) => db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
       WHERE COALESCE(store_settings.value,'')=?`,
      key, value, raw,
    );
    // Format baru `amount|ms`; format lama datetime `datetime('now')`.
    const { parseExpiry } = await import("@/lib/expiry");
    const parseLegacy = (s: string): number => parseExpiry(s) ?? NaN;
    let lastBalance = NaN;
    let lastMs = parseLegacy(raw);
    if (raw.includes("|")) {
      const [b, t] = raw.split("|");
      lastBalance = Number(b);
      lastMs = Number(t);
    }
    if (Number.isFinite(lastMs)) {
      // Format lama (amount tak diketahui) → bungkam + migrasi state agar
      // cek berikut konsisten tanpa spam ganda.
      if (!Number.isFinite(lastBalance)) {
        await claim(`${amount}|${lastMs}`);
        return false;
      }
      if (!(lastBalance - amount >= PEDIA_LOW_BALANCE_STEP_IDR)) return false;
    }
    const reserved = await claim(`${amount}|${now}`);
    if (reserved.changes !== 1) return false;
  } catch { return false; }
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `🔴 <b>Saldo IndoSMM menipis</b>\nSisa Rp ${Math.round(amount).toLocaleString("id-ID")}. Top up di panel provider sebelum order macet.`,
    parse_mode: "HTML",
  }).catch(() => null);
  return result?.ok === true;
}
