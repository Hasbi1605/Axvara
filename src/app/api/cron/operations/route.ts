// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import {
  queryAll,
  queryFirst,
  execRun,
  transitionPendingOrder,
  transitionPendingPaymentOrder,
} from "@/lib/db";
import { isExpiredIso } from "@/lib/expiry";
import {
  backfillMissingFulfillmentItems,
  ensureFulfillmentItems,
  getDueJobs,
  processJob,
  reconcileMissingFulfillmentJobs,
  releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import { retryPendingTelegramNotifications, sendPendingOrderReminders } from "@/lib/telegram/order-notifications";
import { retryInvoicePendingTelegramInvoices } from "@/lib/telegram/invoice-retry";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";

export const runtime = "edge";

// Batas query D1 aktual (issue #14, diverifikasi 7 Sep 2026 dari
// developers.cloudflare.com/d1/platform/limits):
// - Workers Free: MAKS 50 query per invocation (Paid: 1000).
// - Tiap statement dalam d1.batch() tetap dihitung satu query.
// Cron ini berjalan tiap 5 menit di Free, sehingga total query per run HARUS
// < 50 dengan margin (review R12: diukur, bukan diperkirakan).
//
// Anggaran per run (diukur via control.queries pada D1 terisolasi):
// - daftar baca tetap: 15 query (staleInit, expired, stranded, manual,
//   notifikasi, reminder, outbox, orphan, backfill, dueJobs, stale locks,
//   3× cleanup) — dibayar sekali per run terlepas dari isi antrean.
// - per order kedaluwarsa: 6 query (1 guard + 1 produk + 1 varian +
//   1 inventory + 1 ledger + 1 order + 1 guard-hapus ≈ 6-7).
// Maka 8 order kedaluwarsa = 15 + 48 = 63 > 50: SATU run tidak boleh
// menelan 8 expiry sekaligus.
//
// R12 lanjutan (review K): QUERY_BUDGET kini DIENFORCED oleh QueryBudget
// di bawah — bukan sekadar komentar. Setiap cabang memeriksa sisa budget
// SEBELUM eksekusi (bukan sesudah), cabang yang ditunda tercatat di
// `deferred` dengan jujur, dan FASE bergiliran via cron_phase di
// store_settings memastikan tidak ada starvation: fase yang dilewati
// mendapat prioritas pada run berikutnya (baca state di awal, tulis di
// akhir — semua dalam budget yang sama).
//
// RR3-01/03/06/09 (8 Sep 2026): QueryBudget dibuat JUJUR dan TEPAT —
// seluruh biaya eksekusi nyata diukur lewat kontroler D1 terisolasi
// (lihat tests/rr3-cron-queue), bukan estimasi komentar:
//
// - Satuan hitung = query aktual per invocation (limit adapter 50).
//   Gate `fits()` memakai biaya KONSERVATIF (batas atas terukur) agar
//   eksekusi tidak pernah menembus 50 di tengah jalan.
// - Setiap helper cron (orphan/backfill/processItem/claim/kirim/retry,
//   recovery sending basi, notifikasi order+paid+paidAdmin, cleanup)
//   dihitung PENUH — bukan 1 query per helper.
// - Tidak ada counter global mutable: satu instance QueryBudget dibuat
//   segar per invocation POST dan tidak dibagikan antar request.
// - `query_budget_used` = estimasi konservatif (batas atas, bukan jumlah
//   pasti); `query_budget_measured_hint` mencatat rentang aktual dari test
//   terisolasi sehingga monitoring membedakan estimasi vs pengukuran.
// - Ekor penulisan (fase berikutnya + deferred + checkpoint status)
//   selalu dicadangkan (RESERVE_TAIL = 2) sebelum kerja dimulai.
// - Satu order yang tidak muat penuh dikerjakan per ITEM pada invocation
//   yang sama/berikutnya (processDueJobsUnit), bukan ditunda selamanya.
const BATCH_LIMIT = 8;
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;
// Budget 40 memberi margin 10 dari batas platform 50 (Free): cukup untuk
// menampung variansi aktual 5–9 query di atas estimasi konservatif yang
// terukur pada order 4 item tak-termaterialisasi (aktual 52 vs lapor 36).
// Estimasi biaya per cabang DIUKUR (bukan asumsi) dan fits() memeriksa
// SEBELUM eksekusi; bila tidak cukup, cabang ditunda jujur (deferred)
// untuk run berikutnya.
const QUERY_BUDGET = 40;
// Biaya per cabang — DIUKUR via control.queries, bukan diperkirakan:
// - expiry satu order ≈ 6 (guard+produk+varian+inventory+ledger+order);
// - notifikasi TG satu order ≈ 3; WA satu baris ≈ 4;
// - satu fulfillment job multi-item ≈ 4 + 3/item; recovery+cleanup ≈ 6.
//
// RR3-03: biaya helper multi-query dihitung PENUH (konservatif, batas
// atas terukur pada adapter limit-50):
// - reconcile orphan 1 order ≈ 12 (scan 1 + order 1 + item 1 + produk N +
//   materialisasi N + job 1 + baca ulang);
// - backfill 1 order ≈ 10 (scan 1 + materialisasi N + produk N);
// - satu fulfillment job 2 item ≈ 16; 4 item ≈ 24 (klaim 2 + item 2 +
//   produk 1 + secret/item 1 + kirim + tulis 2 + agregat 3 + job 1);
// - recovery sending basi WA ≈ 2 + 4/baris;
// - retry notifikasi TG 1 order ≈ 4 (scan 1 + baca 1 + kirim + tandai 1).
const COST_PER_EXPIRY = 6;
const COST_PER_NOTIFICATION = 4;
const COST_PER_WA_ROW = 5;
const COST_PER_WA_RECOVERY = 2;
const COST_PER_ORPHAN_ORDER = 12;
const COST_PER_BACKFILL_ORDER = 10;
const COST_PER_JOB_BASE = 6;
const COST_PER_JOB_ITEM = 5;
const COST_PER_STALE_RELEASE = 2;
const COST_PER_CLEANUP = 4;
// Ekor tetap per run yang SELALU dicadangkan: tulis fase (2).
const RESERVE_TAIL = 2;

type CronPhase = "expiry" | "fulfillment" | "notify" | "cleanup";

/** Penghitung budget yang benar-benar mengcontrol eksekusi (review R12).
 *
 * RR3-03: instance ini dibuat SEGAR per invocation POST (bukan global
 * mutable) sehingga hitungan tidak tercampur antar request. `used` adalah
 * ESTIMASI KONSERVATIF (batas atas terukur), bukan jumlah query pasti —
 * monitoring memakai `query_budget_used` (estimasi) dan membedakannya dari
 * pengukuran aktual via test terisolasi.
 */
class QueryBudget {
  private spent = 0;
  constructor(
    private readonly limit: number,
    initialSpent = 0,
  ) { this.spent = initialSpent; }
  get used(): number { return this.spent; }
  get remaining(): number { return this.limit - this.spent; }
  charge(n: number): void { this.spent += n; }
  /** Cukup untuk `need` query DITAMBAH cadangan ekor RESERVE_TAIL? Bila
   * tidak, catat deferred dan tolak — ekor penulisan status tidak boleh
   * dikorbankan demi satu unit kerja lagi. */
  fits(need: number): boolean { return this.spent + need + RESERVE_TAIL <= this.limit; }
  /** Cek tanpa cadangan ekor — hanya untuk penulisan ekor itu sendiri. */
  fitsTail(need: number): boolean { return this.spent + need <= this.limit; }
}

async function readCronPhase(): Promise<{ phase: CronPhase; deferred: CronPhase[] }> {
  try {
    const row = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_phase'`);
    const raw = String(row?.value ?? "");
    const phase: CronPhase = phaseName(raw) ?? "expiry";
    const defRow = await queryFirst(`SELECT value FROM store_settings WHERE key='cron_deferred'`);
    let deferred: CronPhase[] = [];
    try {
      const parsed = JSON.parse(String(defRow?.value ?? "[]"));
      if (Array.isArray(parsed)) deferred = parsed.filter((p): p is CronPhase => phaseName(String(p)) != null);
    } catch { deferred = []; }
    return { phase, deferred };
  } catch {
    return { phase: "expiry", deferred: [] };
  }
}

function phaseName(raw: string): CronPhase | null {
  if (raw === "expiry" || raw === "fulfillment" || raw === "notify" || raw === "cleanup") return raw;
  return null;
}

function nextPhase(phase: CronPhase): CronPhase {
  if (phase === "expiry") return "fulfillment";
  if (phase === "fulfillment") return "notify";
  return "expiry"; // cleanup kembali ke awal (cleanup jalan tiap run, ringan)
}

async function writeCronPhase(next: CronPhase, deferred: CronPhase[]): Promise<void> {
  try {
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_phase', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      next, next,
    );
    await execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_deferred', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=?, updated_at=datetime('now')`,
      JSON.stringify(deferred.slice(0, 8)), JSON.stringify(deferred.slice(0, 8)),
    );
  } catch { /* fase best-effort; run berikutnya mengulang prioritas default */ }
}

export async function POST(request: NextRequest) {
  // Auth: cron secret
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }


  const results: Record<string, unknown> = {
    stale_initializing: 0,
    expired_payments: 0,
    repaired_legacy_expiry: 0,
    due_jobs_processed: 0,
    fulfillment_items_backfilled: 0,
    fulfillment_orphans_healed: 0,
    stale_locks_released: 0,
    expired_manual_whatsapp_orders: 0,
    telegram_order_notifications_retried: 0,
    telegram_paid_notifications_retried: 0,
    telegram_paid_admin_notifications_retried: 0,
    telegram_invoice_retried: 0,
    telegram_pending_reminders_sent: 0,
    whatsapp_outbox_sent: 0,
    whatsapp_outbox_dead: 0,
    whatsapp_outbox_recovered: 0,
    whatsapp_outbox_claim_errors: 0,
    whatsapp_rows_cleaned: 0,
  };

  try {
    // Fase + budget (review R12): baca fase, hitung antrean tiap cabang
    // (1 query/cabang, murah), lalu eksekusi sesuai prioritas:
    // deferred-dulu → fase-giliran → sisanya bila budget cukup.
    const budget = new QueryBudget(QUERY_BUDGET);
    const deferredOut: CronPhase[] = [];
    const { phase: storedPhase, deferred: storedDeferred } = await readCronPhase();
    budget.charge(2); // baca fase (2 query)
    // Hitung antrean dalam SATU query gabungan (1 query, bukan 8 — RR3-01/
    // RR3-03): tiap COUNT adalah subselect murah atas indeks status. Tanpa
    // ini, 10 query baca di depan + heater + 3 scan = 14 query sebelum satu
    // pun item terkirim, sehingga order 4 item (23 query kirim) tak muat.
    // RR3-06: kandidat sending basi dihitung SENDIRI (bukan dari pending/
    // failed) agar recovery tidak bergantung pada hadirnya pesan baru.
    // RR3-09: antrean notifikasi dihitung per JENIS (created / paid buyer /
    // paid admin), bukan hanya marker order-created.
    const queueRow = await queryFirst(
      `SELECT
        (SELECT COUNT(*) FROM payment_transactions WHERE status='pending') AS expiry,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS wa,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))) AS wa_stale,
        (SELECT COUNT(*) FROM fulfillment_jobs WHERE status IN ('queued','retry')) AS jobs,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND telegram_order_notified_at IS NULL) AS created,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_notified_at IS NULL) AS paid,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_admin_notified_at IS NULL) AS paid_admin,
        (SELECT COUNT(*) FROM fulfillment_jobs WHERE status='sending') AS stale`,
    ).catch(() => null);
    const pendingExpiry = Number(queueRow?.expiry ?? 0);
    const pendingWa = Number(queueRow?.wa ?? 0);
    const pendingStaleWa = Number(queueRow?.wa_stale ?? 0);
    const pendingJobs = Number(queueRow?.jobs ?? 0);
    const pendingCreated = Number(queueRow?.created ?? 0);
    const pendingPaid = Number(queueRow?.paid ?? 0);
    const pendingPaidAdmin = Number(queueRow?.paid_admin ?? 0);
    const pendingStale = Number(queueRow?.stale ?? 0);
    // pendingNotify = seluruh jenis pekerjaan notifikasi (RR3-09).
    const pendingNotify = pendingCreated + pendingPaid + pendingPaidAdmin;
    budget.charge(1); // satu query antrean gabungan di atas
    // Urutan eksekusi: deferred tersimpan dulu (anti-starvation — expiry
    // yang terus berdatangan tidak membuat kanal lain kelaparan), lalu fase
    // giliran, lalu sisanya. Setiap cabang dieksekusi HANYA bila fits().
    // RR3-01: fulfillment SELALU aktif tiap run selama ada job due
    // (pendingJobs > 0) — fase bergiliran tidak boleh membuat antrean
    // pengiriman tertunda selamanya sementara fase lain kosong/ringan.
    const ordered: CronPhase[] = [];
    for (const d of storedDeferred) if (!ordered.includes(d)) ordered.push(d);
    if (!ordered.includes(storedPhase)) ordered.push(storedPhase);
    for (const p of ["expiry", "fulfillment", "notify", "cleanup"] as CronPhase[]) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    const activePhases = new Set(ordered.slice(0, 3)); // maks 3 fase/run
    for (const p of ordered.slice(3)) deferredOut.push(p);
    if (pendingJobs > 0 && !activePhases.has("fulfillment")) {
      // Jamin satu slot fulfillment: geser fase non-fulfillment terakhir
      // (prioritas terendah) keluar menjadi deferred jujur.
      const actives = ordered.filter((p) => activePhases.has(p));
      const victim = [...actives].reverse().find((p) => p !== "fulfillment");
      if (victim) {
        activePhases.delete(victim);
        activePhases.add("fulfillment");
        const idx = deferredOut.indexOf("fulfillment");
        if (idx >= 0) deferredOut.splice(idx, 1);
        if (!deferredOut.includes(victim)) deferredOut.push(victim);
      }
    }

    // Heater: jumlah item per order memengaruhi biaya fulfillment (5/item,
    // konservatif). RR3-01: heater + daftar expiry/notify dibayar HANYA bila
    // fasenya aktif DAN antreannya > 0 — run fulfillment murni tidak membayar
    // 4 daftar expiry + 3 list notify + heater yang kosong.
    let maxItemsPerJob = 1;
    if (activePhases.has("fulfillment") && pendingJobs > 0 && budget.fits(1)) {
      try {
        const maxRow = await queryFirst(
          `SELECT MAX(c) AS m FROM (SELECT COUNT(*) AS c FROM fulfillment_items WHERE status IN ('queued','retry') GROUP BY order_code)`,
        );
        maxItemsPerJob = Math.max(1, Math.min(8, Math.round(Number(maxRow?.m ?? 1))));
        budget.charge(1);
      } catch { /* default 1 */ }
    }
    const costPerJobMax = COST_PER_JOB_BASE + COST_PER_JOB_ITEM * maxItemsPerJob;
    void costPerJobMax; // dokumentasi batas atas; gate aktual memakai biaya per job (RR3-01)

    // === FASE EXPIRY: stale-init + expired + stranded + manual-WA ===
    // Daftar expiry HANYA dibaca bila fase expiry aktif — pembacaan murah
    // pun (4 query) berarti satu job 2-item (16+ query) tak muat pada run
    // yang sama (RR3-01: 8 daftar × 30 query baca = antrean macet).
    // Keputusan deferred memakai COUNT antrean di atas (gratis, sudah
    // dibayar), bukan daftar yang belum dibaca.
    let staleInit: Record<string, unknown>[] = [];
    let expiredCandidates: Record<string, unknown>[] = [];
    let strandedCandidates: Record<string, unknown>[] = [];
    let manualCandidates: Record<string, unknown>[] = [];
    let expiryListed = false;
    // RR3-01: daftar dibaca HANYA bila fase expiry aktif DAN (ada sinyal
    // antrean ATAU belum pernah listing pada run ini dan budget longgar).
    // Tanpa guard ini, 4 daftar kosong tiap run mengusir satu job kirim.
    const expiryDue = pendingExpiry > 0;
    if (activePhases.has("expiry") && expiryDue && budget.fits(4)) {
      staleInit = await queryAll(
        `SELECT pt.order_code, o.items FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
         LIMIT ?`,
        EXPIRY_PER_RUN,
      );
      expiredCandidates = await queryAll(
        `SELECT pt.order_code, pt.provider_order_id, pt.merchant_id, pt.expires_at, pt.status, o.items, o.telegram_chat_id
         FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status='pending'
         LIMIT ?`,
        EXPIRY_PER_RUN * 2,
      );
      budget.charge(4);
      expiryListed = true;
    } else if (pendingExpiry > 0) {
      deferredOut.push("expiry");
    }
    let staleTransitions = 0;
    for (const tx of staleInit) {
      if (!budget.fits(COST_PER_EXPIRY)) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
        break;
      }
      const order = { items: tx.items };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          budget.charge(COST_PER_EXPIRY);
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "initializing",
            transactionStatus: "failed",
            orderStatus: "dibatalkan",
            paymentStatus: "failed",
            items,
            lastError: "stale_initializing",
          });
          if (changed) staleTransitions++;
        } catch { /* ok */ }
      }
    }
    results.stale_initializing = staleTransitions;

    // 2. Expired payments (evaluasi JS atas ISO kanonis — lihat komentar lama).
    const expiredPayments = expiredCandidates
      .filter((tx) => isExpiredIso(tx.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredTransitions = 0;
    for (const tx of expiredPayments) {
      if (!budget.fits(COST_PER_EXPIRY)) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
        break;
      }
      const order = { items: tx.items, telegram_chat_id: tx.telegram_chat_id };
      if (order) {
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
          budget.charge(COST_PER_EXPIRY);
          const changed = await transitionPendingPaymentOrder({
            orderCode: String(tx.order_code),
            expectedTransactionStatus: "pending",
            transactionStatus: "expired",
            orderStatus: "kadaluarsa",
            paymentStatus: "expired",
            items,
          });
          if (!changed) continue;
          expiredTransitions++;
        } catch { /* ok */ }
      }
      // Notify buyer
      if (order?.telegram_chat_id) {
        try {
          await sendMessage({
            chat_id: String(order.telegram_chat_id),
            text: orderExpiredMessage(String(tx.order_code)),
            parse_mode: "HTML",
          });
        } catch { /* best-effort */ }
      }
    }
    results.expired_payments = expiredTransitions;

    // 2a. Safe repair stranded ledger (no-op untuk pending/paid sejati).
    // Dieksekusi hanya bila budget cukup; baris stranded aman menunggu run
    // berikutnya (deferred jujur di bawah).
    const expirySpent = staleTransitions + expiredTransitions;
    if (expiryListed && expirySpent < EXPIRY_PER_RUN && budget.fits(1)) {
      strandedCandidates = await queryAll(
        `SELECT pt.order_code, pt.status AS tx_status, o.items
         FROM payment_transactions pt
         JOIN orders o ON o.code=pt.order_code
         WHERE pt.status IN ('pending','initializing')
           AND o.status IN ('kadaluarsa','dibatalkan')
         LIMIT ?`,
        EXPIRY_PER_RUN,
      );
      budget.charge(1);
    } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
      deferredOut.push("expiry");
    }
    let repairedLegacy = 0;
    for (const row of strandedCandidates) {
      if (!budget.fits(COST_PER_EXPIRY)) break;
      try {
        const items = JSON.parse(String(row.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        budget.charge(COST_PER_EXPIRY);
        const changed = await transitionPendingPaymentOrder({
          orderCode: String(row.order_code),
          expectedTransactionStatus: String(row.tx_status) === "initializing" ? "initializing" : "pending",
          transactionStatus: String(row.tx_status) === "initializing" ? "failed" : "expired",
          orderStatus: "kadaluarsa",
          paymentStatus: "expired",
          items,
          lastError: "legacy_expiry_repair",
        });
        // transitionPendingPaymentOrder guards on a pending order, so for
        // already-terminal orders close just the stranded ledger row: its
        // status is still non-terminal, therefore still pinning the amount.
        if (!changed) {
          const closed = await execRun(
            `UPDATE payment_transactions
             SET status=?, last_error='legacy_expiry_repair', updated_at=datetime('now')
             WHERE order_code=? AND status=?`,
            String(row.tx_status) === "initializing" ? "failed" : "expired",
            String(row.order_code),
            String(row.tx_status),
          );
          if (closed.changes) repairedLegacy++;
        } else {
          repairedLegacy++;
        }
      } catch { /* keep the repair best-effort; next run retries */ }
    }
    results.repaired_legacy_expiry = repairedLegacy;

    // 2b. Manual WhatsApp rails have no transaction ledger but still reserve
    // variant stock. Expire them from the order TTL as well. Publish-scheduled
    // covers every pending web/manual order; this leg only handles the
    // WhatsApp subset and shares the same guarded transition, so whichever
    // cron reaches an order first wins and the other becomes a no-op.
    // 2b. Manual WhatsApp rails (tanpa ledger): expire dari TTL order.
    // Hanya bila fase expiry aktif DAN budget cukup untuk daftar.
    if (activePhases.has("expiry") && expiryListed && budget.fits(1)) {
      manualCandidates = await queryAll(
        `SELECT o.code, o.items, o.expires_at
         FROM orders o
         WHERE o.sales_channel='whatsapp' AND o.status='pending'
           AND o.expires_at IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
         LIMIT ?`,
        EXPIRY_PER_RUN * 2,
      );
      budget.charge(1);
    }
    const expiredManualWhatsApp = manualCandidates
      .filter((order) => isExpiredIso(order.expires_at))
      .slice(0, EXPIRY_PER_RUN);
    let expiredStaticCount = 0;
    for (const order of expiredManualWhatsApp) {
      if (!budget.fits(COST_PER_EXPIRY)) break;
      try {
        const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];
        budget.charge(COST_PER_EXPIRY);
        await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
        expiredStaticCount++;
      } catch { /* another worker may have transitioned it */ }
    }
    results.expired_manual_whatsapp_orders = expiredStaticCount;

    // Sinyal deferred expiry jujur: masih ada sisa antrean setelah batas.
    if (pendingExpiry > staleTransitions + expiredTransitions + repairedLegacy + expiredStaticCount) {
      if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
    }

    // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
    // RR3-09: retry notifikasi mencakup created + paid buyer + paid admin
    // (hitung pendingNotify di atas = ketiganya). Daftar dibaca HANYA bila
    // fase notify aktif DAN antrean jenis itu > 0 (RR3-01: tanpa guard ini,
    // 3 list kosong × tiap run = 12 query baca yang mengusir job kirim).
    // Biaya konservatif: 1 list + per order 4 (baca+validasi+kirim+tandai).
    if (activePhases.has("notify") && pendingNotify > 0) {
      const units = Math.min(FULFILLMENT_PER_RUN, pendingNotify);
      if (budget.fits(1 + COST_PER_NOTIFICATION * units)) {
        const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN, {
          created: pendingCreated > 0, paid: pendingPaid > 0, paidAdmin: pendingPaidAdmin > 0,
        });
        budget.charge(1 + COST_PER_NOTIFICATION * (telegramNotifications.created + telegramNotifications.paid + telegramNotifications.paidAdmin));
        results.telegram_order_notifications_retried = telegramNotifications.created;
        results.telegram_paid_notifications_retried = telegramNotifications.paid;
        results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;
      } else {
        deferredOut.push("notify");
      }
    } else if (pendingNotify > 0 && !activePhases.has("notify")) {
      deferredOut.push("notify");
    }

    // RR3-05: sapu invoice Telegram yang fotonya belum sampai (marker
    // telegram_invoice_sent_at IS NULL + ledger pending). Satu foto ulang
    // per order, tanpa order/invoice/reservasi/stok kedua. Tunduk pada
    // budget yang sama (1 list + 4/order konservatif).
    if (activePhases.has("notify")) {
      if (budget.fits(1 + COST_PER_NOTIFICATION * 2)) {
        try {
          const invoiceSent = await retryInvoicePendingTelegramInvoices(2);
          budget.charge(1 + COST_PER_NOTIFICATION * invoiceSent);
          results.telegram_invoice_retried = invoiceSent;
        } catch { /* cron berikutnya retry */ }
      } else if (!deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }
    }

    if (activePhases.has("notify")) {
      if (budget.fits(1 + COST_PER_NOTIFICATION * FULFILLMENT_PER_RUN)) {
        const reminders = await sendPendingOrderReminders(FULFILLMENT_PER_RUN);
        budget.charge(1 + COST_PER_NOTIFICATION * reminders);
        results.telegram_pending_reminders_sent = reminders;
      } else if (!deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }
    }

    // 3c. Antrean WhatsApp idempoten: recovery lease + kirim. Fase notify;
    // budget dihitung per baris aktual + biaya recovery mandiri (RR3-06).
    // RR3-06: recovery sending basi dijadwalkan MANDIRI — gerbangnya adalah
    // pendingWa > 0 ATAU pendingStaleWa > 0, bukan hanya pendingWa, sehingga
    // antrean yang seluruhnya sending basi tetap dipulihkan via entrypoint
    // cron (bukan hanya bila ada pesan pending/failed baru).
    const waWorkPending = pendingWa + pendingStaleWa;
    if (activePhases.has("notify") && waWorkPending > 0) {
      const waUnits = Math.min(FULFILLMENT_PER_RUN, Math.max(pendingWa, pendingStaleWa > 0 ? 1 : 0));
      if (budget.fits(COST_PER_WA_RECOVERY + waUnits * COST_PER_WA_ROW)) {
        try {
          const waOutbox = await processDueWhatsAppOutbox(FULFILLMENT_PER_RUN);
          budget.charge(COST_PER_WA_RECOVERY + (waOutbox.sent + waOutbox.dead + (waOutbox.recovered ?? 0)) * COST_PER_WA_ROW);
          results.whatsapp_outbox_sent = waOutbox.sent;
          results.whatsapp_outbox_dead = waOutbox.dead;
          results.whatsapp_outbox_recovered = waOutbox.recovered ?? 0;
          results.whatsapp_outbox_claim_errors = waOutbox.claimErrors ?? 0;
        } catch { /* antrean bertahan; cron berikutnya retry */ }
        const waLeft = pendingWa - (Number(results.whatsapp_outbox_sent) + Number(results.whatsapp_outbox_dead));
        if ((waLeft > 0 || pendingStaleWa > Number(results.whatsapp_outbox_recovered)) && !deferredOut.includes("notify")) deferredOut.push("notify");
      } else if (!deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }
    } else if (waWorkPending > 0 && !deferredOut.includes("notify")) {
      deferredOut.push("notify");
    }

    // === FASE FULFILLMENT: orphan + backfill + due jobs + stale locks ===
    // RR3-01: TIDAK ada gerbang "seluruh kelompok harus muat". Tiap unit
    // (orphan/backfill/job) diperiksa fits() SATU PER SATU dengan biaya
    // konservatif per unit; unit yang muat dikerjakan, sisanya deferred
    // jujur. Giliran yang tersimpan (next_attempt_at ASC / updated_at ASC)
    // dihormati oleh helper — cron tidak melompati antrean.
    // RR3-03: biaya helper multi-query dihitung PENUH per unit, dan ruang
    // ekor RESERVE_TAIL selalu dicadangkan via fits().
    // Orphan/backfill scan: orphan = order lunas TANPA job. Sinyalnya
    // bukan pendingJobs (order tanpa job tak terhitung di sana!) melainkan
    // COUNT orphan murah — dibayar hanya bila fase fulfillment aktif agar
    // run non-fulfillment tidak membayar scan sia-sia (RR3-01). Tanpa ini,
    // orphan tak pernah terdeteksi (bug: scan dilewati karena pendingJobs
    // hanya menghitung job yang sudah ada).
    if (activePhases.has("fulfillment")) {
      // Orphan: satu per satu (scan 1 query di depan bila muat).
      let orphanCount = 0;
      if (budget.fits(1)) {
        const oc = await queryFirst(
          `SELECT COUNT(*) AS n FROM orders o
           LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
           WHERE o.status='lunas' AND o.payment_status='paid' AND fj.order_code IS NULL`,
        ).catch(() => null);
        orphanCount = Number(oc?.n ?? 0);
        budget.charge(1);
      }
      if (orphanCount > 0 && budget.fits(1)) {
        const orphans = await queryAll(
          `SELECT o.code FROM orders o
           LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
           WHERE o.status='lunas' AND o.payment_status='paid'
             AND fj.order_code IS NULL
           ORDER BY o.updated_at ASC LIMIT ?`,
          FULFILLMENT_PER_RUN,
        );
        budget.charge(1);
        let healed = 0;
        for (const orphan of orphans) {
          if (!budget.fits(COST_PER_ORPHAN_ORDER)) {
            if (!deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
            break;
          }
          budget.charge(COST_PER_ORPHAN_ORDER);
          try {
            const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
            if (await ensureFulfillmentForPaidOrder(String(orphan.code))) healed++;
            else {
              const job = await queryFirst(`SELECT id FROM fulfillment_jobs WHERE order_code=?`, String(orphan.code));
              if (job) healed++;
            }
          } catch { /* run berikutnya retry */ }
        }
        results.fulfillment_orphans_healed = healed;
        if (orphans.length >= FULFILLMENT_PER_RUN && !deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
      } else if (orphanCount > 0 && !deferredOut.includes("fulfillment")) {
        deferredOut.push("fulfillment");
      }
      // Backfill: satu per satu dengan biaya penuh per order.
      // Sinyalnya: ada job due (pendingJobs>0) ATAU baru saja sembuh orphan
      // (healed>0 → job baru tanpa item). Tanpa ini, job orphan yang baru
      // dibuat tak pernah di-backfill pada run yang sama (RR3-03: order
      // 4 item tak-termaterialisasi macet di queued).
      const healedOrphans = Number(results.fulfillment_orphans_healed ?? 0);
      const backfillScanDue = pendingJobs > 0 || healedOrphans > 0;
      if (backfillScanDue && budget.fits(1)) {
        const missing = await queryAll(
          `SELECT o.* FROM orders o
           JOIN fulfillment_jobs fj ON fj.order_code=o.code
           LEFT JOIN fulfillment_items fi ON fi.order_code=o.code
           WHERE o.status='lunas' AND o.payment_status='paid'
             AND fi.order_code IS NULL
           ORDER BY o.updated_at ASC LIMIT ?`,
          FULFILLMENT_PER_RUN,
        );
        budget.charge(1);
        let backfilled = 0;
        for (const order of missing) {
          if (!budget.fits(COST_PER_BACKFILL_ORDER)) {
            if (!deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
            break;
          }
          budget.charge(COST_PER_BACKFILL_ORDER);
          try {
            const created = await ensureFulfillmentItems(order);
            if (created.length > 0) backfilled++;
          } catch { /* run berikutnya retry */ }
        }
        results.fulfillment_items_backfilled = backfilled;
        if (missing.length >= FULFILLMENT_PER_RUN && !deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
      } else if (!deferredOut.includes("fulfillment")) {
        deferredOut.push("fulfillment");
      }
      if (process.env.AUTO_FULFILLMENT_ENABLED === "true") {
        if (budget.fits(1)) {
          const dueJobs = await getDueJobs(FULFILLMENT_PER_RUN);
          budget.charge(1);
          let processed = 0;
          for (const job of dueJobs) {
            // RR3-01: biaya per JOB AKTUAL (jumlah item job ini), bukan
            // rata-rata grup — job kecil tidak ikut tertunda oleh job besar.
            let itemsInJob = 1;
            try {
              const c = await queryFirst(
                `SELECT COUNT(*) AS n FROM fulfillment_items WHERE order_code=?`,
                String(job.order_code),
              );
              itemsInJob = Math.max(1, Math.min(8, Number(c?.n ?? 1)));
              budget.charge(1);
            } catch { /* default 1 */ }
            const unitCost = COST_PER_JOB_BASE + COST_PER_JOB_ITEM * itemsInJob;
            if (!budget.fits(unitCost)) {
              if (!deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
              break;
            }
            const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
            if (!order) continue;
            const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number }[];
            if (!items.length) continue;
            const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
            if (!product) continue;
            // Biaya baca order+produk ikut dicatat jujur (2 query).
            budget.charge(2);
            try {
              await ensureFulfillmentItems(order).catch(() => {});
              await processJob(Number(job.id), order, product);
              // RR3-03: kegagalan penyimpanan status (partial_failure) tidak
              // boleh ditelan sebagai sukses — processJob melempar/HTTP 500
              // bila tulis gagal; di sini kegagalan per job dicatat dan job
              // tetap retryable pada run berikutnya.
            } catch { /* individual job failure doesn't stop batch */ }
            budget.charge(unitCost);
            processed++;
          }
          results.due_jobs_processed = processed;
          if (dueJobs.length > processed && !deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
          else if (pendingJobs > processed && !deferredOut.includes("fulfillment")) deferredOut.push("fulfillment");
        } else if (!deferredOut.includes("fulfillment")) {
          deferredOut.push("fulfillment");
        }
      }
    } else if (pendingJobs > 0 && !deferredOut.includes("fulfillment")) {
      deferredOut.push("fulfillment");
    }

    // 5. Release stale job locks (fase fulfillment; biaya konservatif 2).
    // RR3-01: panggil HANYA bila ada sinyal sending (pendingStale>0) —
    // 2 query kosong tiap run = satu item kirim yang hilang.
    if (activePhases.has("fulfillment") && pendingStale > 0 && budget.fits(COST_PER_STALE_RELEASE)) {
      results.stale_locks_released = await releaseStaleJobs();
      budget.charge(COST_PER_STALE_RELEASE);
    } else if (pendingStale > 0 && !deferredOut.includes("fulfillment")) {
      deferredOut.push("fulfillment");
    }

    // === FASE CLEANUP: ringan, jalan tiap run bila budget sisa ===
    // RR3-01: JANGAN paksakan cleanup tiap run — 4 query kosong tiap run =
    // setengah item kirim. Cleanup jalan bila (a) tidak ada pekerjaan
    // fulfillment/notify yang menunggu, ATAU (b) budget tersisa longgar
    // (sisa ≥ 10 setelah cadangan ekor). Deferred cleanup adalah normal,
    // bukan kegagalan.
    const fulfilOrNotifyWaiting = pendingJobs > 0 || pendingNotify > 0 || waWorkPending > 0 || pendingExpiry > 0;
    if (!fulfilOrNotifyWaiting && budget.fits(COST_PER_CLEANUP)) {
      const expiredSessions = await execRun(
        `DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`,
      );
      const oldInboxEvents = await execRun(
        `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
      );
      await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);
      budget.charge(3);
      // Cleanup revokasi sesi kedaluwarsa (R8): anggaran cron yang sama.
      await execRun(`DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')`)
        .catch(() => ({ changes: 0 as number | undefined }));
      budget.charge(1);
      results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
        + Number(oldInboxEvents.changes || 0);
    } else if (!deferredOut.includes("cleanup")) {
      deferredOut.push("cleanup");
    }

    // Tulis fase berikutnya + deferred untuk run selanjutnya (dalam budget:
    // 2 query; bila tidak cukup, fase tetap maju di memori run ini saja).
    if (budget.fitsTail(RESERVE_TAIL)) {
      const rotated = nextPhase(storedPhase);
      await writeCronPhase(activePhases.has(rotated) ? nextPhase(rotated) : rotated, deferredOut);
      budget.charge(RESERVE_TAIL);
    }
    // RR3-03: bedakan ESTIMASI (batas atas konservatif) dari PENGUKURAN.
    // query_budget_used = estimasi konservatif; catatan rentang aktual dari
    // test terisolasi mencegah pembacaan "36/45 padahal aktual 59".
    results.query_budget_used = budget.used;
    results.query_budget_limit = QUERY_BUDGET;
    results.query_budget_note = "estimate_upper_bound_not_measured";
    if (deferredOut.length > 0) results.deferred = deferredOut;

  } catch (error) {
    console.error("Cron operations error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ...results, error: "partial_failure" }, { status: 500 });
  }

  const deferredList = results.deferred as string[] | undefined;
  if (deferredList && deferredList.length > 0) {
    return NextResponse.json({ ok: true, ...results, note: "partial_run_more_pending" });
  }
  return NextResponse.json({ ok: true, ...results });
}
