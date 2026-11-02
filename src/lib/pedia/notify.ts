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
import { whiteLabel } from "@/lib/pedia/terms";

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

function countsLine(ctx: PediaBuyerContext): string | null {
  // Reported supplier counts only; unknown stays unknown, never 0.
  // Start count is shown independently when reported; sisa follows when known.
  const start = ctx.startCount != null
    ? `Jumlah awal: ${ctx.startCount.toLocaleString("id-ID")}` : null;
  if (ctx.remains != null && ctx.quantity > 0) {
    const done = ctx.done ?? Math.max(0, ctx.quantity - ctx.remains);
    const sisa = ctx.remains.toLocaleString("id-ID");
    return `${start ? `${start} · ` : ""}sisa ${sisa} · terkirim: ${done.toLocaleString("id-ID")} dari ${ctx.quantity.toLocaleString("id-ID")}.`;
  }
  if (start) return `${start}.`;
  if (ctx.done != null && ctx.quantity > 0) {
    return `Terkirim: ${ctx.done.toLocaleString("id-ID")} dari ${ctx.quantity.toLocaleString("id-ID")}.`;
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
            i.status AS item_status, i.quantity, i.start_count, i.remains, i.target_normalized,
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
  const rawStart = row.start_count != null ? Number(row.start_count) : NaN;
  const rawRemains = row.remains != null ? Number(row.remains) : NaN;
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

function paidBody(ctx: PediaBuyerContext): string {
  const lines = [
    `Halo ${ctx.displayName}, pembayaran untuk ${ctx.productName} (${ctx.serviceName}) sejumlah ${ctx.quantity.toLocaleString("id-ID")} sudah kami terima.`,
    // Truthful at send time: payment is confirmed; lifecycle follows the
    // CURRENT item state, never a stale queued promise when already terminal.
    `Status saat ini: ${pediaLifecycleLine(ctx)}.`,
  ];
  const counts = countsLine(ctx);
  if (counts) lines.push(counts);
  const eta = ctx.status === "completed" ? null : etaLine(ctx.etaStart, ctx.etaFinish);
  if (eta) lines.push(eta);
  else if (!counts) lines.push("Jumlah masuk belum dikonfirmasi.");
  lines.push(`Pantau status terkini di sini: ${ctx.pediaUrl}`);
  return whiteLabel(lines.join("\n"));
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

function processingBody(ctx: PediaBuyerContext): string {
  const lines = [
    `Halo ${ctx.displayName}, pesanan ${ctx.productName} (${ctx.serviceName}) sejumlah ${ctx.quantity.toLocaleString("id-ID")} sedang berjalan.`,
  ];
  const counts = countsLine(ctx);
  if (counts) lines.push(counts);
  else lines.push("Jumlah masuk belum dikonfirmasi.");
  const eta = etaLine(ctx.etaStart, ctx.etaFinish);
  if (eta) lines.push(eta);
  lines.push(`Pantau status terkini di sini: ${ctx.pediaUrl}`);
  return whiteLabel(lines.join("\n"));
}

function completedBody(ctx: PediaBuyerContext): string {
  const lines = [
    `Halo ${ctx.displayName}, pesanan ${ctx.productName} (${ctx.serviceName}) sejumlah ${ctx.quantity.toLocaleString("id-ID")} selesai.`,
  ];
  const counts = countsLine(ctx);
  if (counts) lines.push(counts);
  if (ctx.refillDays > 0) lines.push("Layanan ini memiliki masa refill. Ajukan refill dari halaman pesanan bila jumlah turun dalam masa garansi.");
  lines.push(`Lihat ringkasan di sini: ${ctx.pediaUrl}`);
  return whiteLabel(lines.join("\n"));
}

/** Phase send boundary: single joined context, current paid state verified
 *  INSIDE the sender (no mail for unpaid), terminal suppression for stale
 *  phases, then fenced claim → transport → CAS settle. Returns true when
 *  the phase is sent or already durably sent/superseded.
 *
 *  `ctxOverride` carries claim-time transition values (e.g. the just-reported
 *  supplier counts from pollOne) so the immediate email is point-in-time;
 *  deferred retries rebuild from the durable row and apply the same
 *  terminal-suppression rules. */
async function sendPediaPhase(
  db: Db,
  phase: "paid" | "processing" | "completed",
  orderCode: string,
  build: (ctx: PediaBuyerContext) => { subject: string; text: string },
  allow: (ctx: PediaBuyerContext) => boolean,
  ctxOverride?: (ctx: PediaBuyerContext) => Partial<PediaBuyerContext>,
): Promise<boolean> {
  const { claimPediaEmail, settlePediaEmail, supersedePediaEmail, pediaEmailKey } = await import("@/lib/pedia/notify-channel");
  const key = pediaEmailKey(phase, orderCode);
  // Deterministic affordable budget BEFORE claim/transport: 1 context read +
  // claim + settle + transport slack. Never start a send the budget cannot finish.
  if (!db.canSpend(5)) return false;
  const live = await pediaBuyerContext(db, orderCode);
  if (!live || !live.email || !live.orderPaid) return false;
  // allow() always evaluates the LIVE durable state (terminal suppression
  // must see completion even when the immediate body uses claim-time counts).
  if (!allow(live)) {
    // Only terminal stale processing is superseded; a future phase remains due.
    if (phase !== "processing" || !isPediaTerminalStatus(live.status)) return false;
    const claim = await claimPediaEmail(db, phase, orderCode);
    if (claim) return supersedePediaEmail(db, key, claim.lease, `stale-at-${live.status}`);
    const existing = await db.queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key).catch(() => null);
    return String(existing?.status ?? "") === "sent";
  }
  const ctx: PediaBuyerContext = { ...live, ...(ctxOverride?.(live) ?? {}) };
  const claim = await claimPediaEmail(db, phase, orderCode);
  if (!claim) {
    const existing = await db.queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key).catch(() => null);
    return String(existing?.status ?? "") === "sent";
  }
  let payload: { subject: string; text: string };
  try {
    payload = build(ctx);
  } catch {
    await settlePediaEmail(db, key, claim.lease, false, "build_failed");
    return false;
  }
  try {
    const { sendPediaEmail } = await import("@/lib/pedia/email");
    const ok = await sendPediaEmail({ to: ctx.email, subject: payload.subject, text: payload.text });
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
    (ctx) => ({ subject: `Pembayaran diterima — ${orderCode}`, text: paidBody(ctx) }),
    // Paid confirms payment even if the lifecycle already advanced; the body
    // states the CURRENT lifecycle truthfully (never "diproses" for terminal).
    () => true,
  );
}

/** Pembeli: processing — ONLY on actual supplier in_progress/processing.
 *  Stale at terminal (completed/partial/canceled/expired) is suppressed.
 *  `counts` carries the just-reported supplier values so the immediate mail
 *  is point-in-time (deferred retries rebuild from the durable row). */
export async function notifyPediaProcessing(
  db: Db, orderCode: string,
  counts?: { startCount: number | null; remains: number | null },
): Promise<boolean> {
  const override = counts ? (ctx: PediaBuyerContext): Partial<PediaBuyerContext> => {
    const startCount = counts.startCount != null && Number.isSafeInteger(counts.startCount) && counts.startCount >= 0 ? counts.startCount : null;
    const qty = ctx.quantity;
    const remains = counts.remains != null && Number.isSafeInteger(counts.remains) && counts.remains >= 0 && counts.remains <= qty ? counts.remains : null;
    return {
      startCount,
      remains,
      done: remains != null ? qty - remains : ctx.done,
    };
  } : undefined;
  return sendPediaPhase(db, "processing", orderCode,
    (ctx) => ({ subject: `Pesanan sedang berjalan — ${orderCode}`, text: processingBody(ctx) }),
    (ctx) => ctx.status === "in_progress",
    override,
  );
}

/** Pembeli: selesai — ONLY on confirmed completed. */
export async function notifyPediaCompleted(db: Db, orderCode: string): Promise<boolean> {
  return sendPediaPhase(db, "completed", orderCode,
    (ctx) => ({ subject: `Pesanan selesai — ${orderCode}`, text: completedBody(ctx) }),
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
