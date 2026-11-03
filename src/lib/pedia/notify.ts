// src/lib/pedia/notify.ts — Notifikasi Telegram Pedia (PEDIA-PRD II/§9.5).
//
// Pembeli: pembayaran, selesai, atau penyelesaian manual melalui outbox.
// + 2 ke admin (needs_check konfirmasi ganda resubmit/cancel; saldo < ambang).
// TIDAK ADA spam per-paket kecil. Email pembeli dikirim bersamaan (M5).

import { escapeHtml } from "@/lib/telegram/messages/format";
import type { createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider, type PediaProvider } from "@/lib/pedia/proxy";
import { SITE } from "@/lib/site";
import { readPediaServiceCopy } from "@/lib/pedia/service-copy";
import { refillLabel, whiteLabel } from "@/lib/pedia/terms";
import { renderBrandedNotice } from "@/lib/warung-rebahan/email-forward";

type Db = ReturnType<typeof createDatabaseAccess>;

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
};

function sanitizePublicText(value: unknown, max = 200): string {
  return whiteLabel(String(value ?? "")).trim().slice(0, max);
}

function etaLine(etaStart: string | null, etaFinish: string | null): string | null {
  const start = (etaStart ?? "").trim();
  const finish = (etaFinish ?? "").trim();
  if (finish) return `Perkiraan selesai: ${finish}. Estimasi mengikuti antrean.`;
  if (start) {
    if (start === "Mengikuti antrean layanan") return start + ".";
    return `Perkiraan mulai: ${start} setelah pembayaran. Estimasi layanan, bukan jaminan.`;
  }
  return null;
}

/** Single joined buyer context: ONE budgeted read (orders ⨝ pedia item ⨝
 *  product/tier). Snapshot names (never live tier edits except the
 *  pre-existing eta/label read); supplier identity, wholesale cost and raw
 *  IDs never exposed. Counts keep null (unknown ≠ 0). */
export async function pediaBuyerContext(db: Db, orderCode: string): Promise<PediaBuyerContext | null> {
  if (!db.canSpend(1)) return null;
  const row = await db.queryFirst(
    `SELECT o.customer_name, o.customer_email, o.status AS order_status, o.payment_status, o.paid_at,
            i.status AS item_status, i.quantity, i.start_count, i.remains, i.target_normalized, i.supplier_order_id,
            i.snapshot_json, p.name AS product_name, t.tier AS tier_name, t.label_note,
            t.eta_start, t.eta_finish
       FROM orders o
       JOIN pedia_order_items i ON i.order_code=o.code
       JOIN pedia_products p ON p.id=i.product_id
       JOIN pedia_tiers t ON t.id=i.tier_id
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
  const fmt = (n: number) => n.toLocaleString("id-ID");
  const details = [
    { label: "Layanan", value: `${ctx.productName} · ${ctx.serviceName}` },
    { label: "Jumlah dipesan", value: fmt(ctx.quantity) },
    { label: "Jumlah awal", value: ctx.startCount != null ? fmt(ctx.startCount) : "Belum dilaporkan" },
  ];
  if (ctx.status !== "completed") {
    details.push({ label: "Sisa", value: ctx.remains != null ? fmt(ctx.remains) : "Belum dilaporkan" });
  }
  details.push({ label: "Masuk", value: ctx.done != null ? `${fmt(ctx.done)} dari ${fmt(ctx.quantity)}` : "Belum dikonfirmasi" });
  if (ctx.target) details.push({ label: "Link tujuan", value: ctx.target });
  return {
    orderCode: ctx.pediaUrl.split("/").pop() ?? "",
    orderUrl: ctx.pediaUrl,
    supportWa: SITE.adminWaLocal,
    ctaLabel: "Lihat Status Pesanan →",
    details,
  };
}

function pediaLifecycleLine(ctx: PediaBuyerContext): string {
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

/** Paid → Market shell: title/subtitle/pill + greeting + lifecycle + eta. */
function paidEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const eta = ctx.status === "completed" ? null : etaLine(ctx.etaStart, ctx.etaFinish);
  const shared = pediaBrandedFields(ctx);
  const rendered = renderBrandedNotice({
    ...shared,
    title: "Pembayaran Diterima",
    subtitle: "Pesananmu masuk antrean dan diproses otomatis.",
    status: { label: "Pembayaran diterima", tone: "success" },
    paragraphs: [
      `Halo ${firstWord(ctx.displayName)}, pembayaran untuk pesanan Pedia kamu sudah kami terima.`,
      `${pediaLifecycleLine(ctx) === "masuk antrean dan akan diproses otomatis" ? "Pesanan masuk antrean dan akan diproses otomatis." : `Status saat ini: ${pediaLifecycleLine(ctx)}.`} Status terbaru selalu ada di halaman pesanan.`,
    ],
    callout: eta ? { text: eta, tone: "info" } : null,
  });
  return { subject: `Pembayaran diterima — ${orderCode}`, text: rendered.text, html: rendered.html };
}

/** Processing ("Diproses" = accepted, not necessarily running yet). */
function processingEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const eta = etaLine(ctx.etaStart, ctx.etaFinish);
  const shared = pediaBrandedFields(ctx);
  // Info callout when there is no progress yet (or a finish estimate exists).
  const showEta = eta && (ctx.done == null || ctx.etaFinish);
  const rendered = renderBrandedNotice({
    ...shared,
    title: "Pesanan Diproses",
    subtitle: "Pesananmu sudah diterima sistem dan sedang diproses.",
    status: { label: "Diproses", tone: "info" },
    paragraphs: [
      `Halo ${firstWord(ctx.displayName)}, pesanan Pedia kamu sudah diterima sistem dan sedang diproses otomatis.`,
      "Angka di bawah adalah laporan saat email ini dikirim. Pantau perkembangan terbaru di halaman pesanan.",
    ],
    callout: showEta ? { text: eta, tone: "info" } : null,
  });
  return { subject: `Pesanan sedang diproses — ${orderCode}`, text: rendered.text, html: rendered.html };
}

/** Completed → Market shell, Refill N Days terms (never "masa garansi"). */
function completedEmail(ctx: PediaBuyerContext, orderCode: string): PediaEmailPayload {
  const shared = pediaBrandedFields(ctx);
  const rendered = renderBrandedNotice({
    ...shared,
    title: "Pesanan Selesai",
    subtitle: "Terima kasih sudah memesan di AXVARA Pedia.",
    status: { label: "Selesai", tone: "success" },
    paragraphs: [`Halo ${firstWord(ctx.displayName)}, pesanan Pedia kamu sudah selesai.`],
    callout: ctx.refillDays > 0
      ? { text: `Layanan ini memiliki ${refillLabel(ctx.refillDays)}. Bila jumlah turun dalam masa refill, ajukan refill dari halaman pesanan.`, tone: "info" }
      : null,
  });
  return { subject: `Pesanan selesai — ${orderCode}`, text: rendered.text, html: rendered.html };
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

/** Pembeli: selesai — ONLY on confirmed completed. */
export async function notifyPediaCompleted(db: Db, orderCode: string): Promise<boolean> {
  return sendPediaPhase(db, "completed", orderCode,
    (ctx) => completedEmail(ctx, orderCode),
    (ctx) => ctx.status === "completed",
  );
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

/** Admin: saldo supplier < ambang (throttle 1:1 WR/SK — 2026-10-09).
 *
 * Dulu ping tiap 1 jam (tanpa syarat turun) → spam 9×/8 jam saat saldo Rp 0
 * stagnan. Kini cermin `warung-rebahan/saldo.ts` + `sekalipay/saldo.ts`:
 * kirim ulang hanya bila (a) belum pernah kirim dalam 6 jam terakhir, atau
 * (b) saldo TURUN melewati kelipatan Rp5.000. State `amount|timestamp_ms`
 * disimpan di `store_settings.pedia_balance_alert_at` (kunci yang sama —
 * tanpa migrasi skema; format datetime lama tetap dibaca: timestamp tak
 * diketahui → tulis format baru, tanpa spam ganda).
 *
 * State wajib tersedia dan diklaim atomik SEBELUM jaringan. Saat D1/budget
 * gagal, alert saldo ditunda; jangan menganggap error baca sebagai belum ada
 * state atau tetap mengirim sesudah error tulis. Reservasi dipertahankan bila
 * Telegram gagal/ambigu untuk menghindari pengiriman ulang tiap tick.
 * Mengembalikan true hanya bila Telegram mengakui pesan. */
export async function notifyPediaLowBalance(balance: number, db?: Db, supplier: PediaProvider = "providersmm"): Promise<boolean> {
  if (!db || !isPediaProvider(supplier) || !Number.isFinite(balance) || balance < 0) return false;
  const key = supplier === "providersmm" ? "pedia_balance_alert_at" : "pedia_indosmm_balance_alert_at";
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
    // Pakai parseExpiry kanonis (SQLite `YYYY-MM-DD HH:MM:SS` = UTC):
    // `Date.parse` mentah menganggapnya waktu LOKAL (WIB = UTC+7) sehingga
    // selisihnya 7 jam > 6 jam → state kemarin dianggap basi → spam.
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
      if (now - lastMs < 6 * 60 * 60 * 1000) {
        // Dalam 6 jam: hanya bunyi lagi bila turun melewati kelipatan Rp5.000.
        // Format lama (amount tak diketahui) → bungkam + migrasi state di
        // bawah, JANGAN kirim (return sebelum tulis agar tidak spam ganda).
        if (!Number.isFinite(lastBalance)) {
          await claim(`${amount}|${lastMs}`);
          return false;
        }
        if (!(amount <= Math.floor(lastBalance / 5000) * 5000 - 5000)) return false;
      }
    }
    const reserved = await claim(`${amount}|${now}`);
    if (reserved.changes !== 1) return false;
  } catch { return false; }
  const { sendMessage } = await import("@/lib/telegram/api");
  const result = await sendMessage({
    chat_id: chatId,
    text: `🔴 <b>Saldo ${supplier === "providersmm" ? "ProviderSMM" : "IndoSMM"} menipis</b>\nSisa Rp ${Math.round(amount).toLocaleString("id-ID")}. Top up di panel provider sebelum order macet.`,
    parse_mode: "HTML",
  }).catch(() => null);
  return result?.ok === true;
}
