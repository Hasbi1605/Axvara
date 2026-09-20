// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import { transitionPendingOrder as rawTransitionPendingOrder, transitionPendingPaymentOrder as rawTransitionPendingPaymentOrder } from "@/lib/db";
import { createBudgetedDatabase, QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { isExpiredIso } from "@/lib/expiry";
import {
  COST_PER_JOB_FRAME, COST_PER_DELIVERY_ITEM, COST_PER_ORPHAN_LIGHT,
  getDueJobs, ensureFulfillmentItems, processJobItems, reconcileOrphanLight, reconcileSettledJobs, releaseStaleJobs,
} from "@/lib/fulfillment/deliver";
import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import { QRIS_EXPIRY_NOTICE_WHERE, sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";
import { retryPendingTelegramNotifications, sendPendingOrderReminders } from "@/lib/telegram/order-notifications";
import { retryInvoicePendingTelegramInvoices } from "@/lib/telegram/invoice-retry";
import { constantTimeEqual } from "@/lib/security";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";

export const runtime = "edge";

// A request-scoped D1 wrapper counts all nested queries, including batch members.
// Budget 40 leaves ten queries of platform margin; two are reserved for phase state.
const QUERY_BUDGET = 40;
// Deadline wall-clock per invocation (2026-09-18). D1 punya budget statement,
// tetapi TIDAK ada yang membatasi waktu tunggu jaringan: notify bisa
// merangkai 14 panggilan Telegram/WA @10 s dan fase WR 3 panggilan @12 s
// dalam satu invocation. Insiden 17–18 Sep: run cron mencapai wallTime
// 125.003 ms lalu dipotong platform (outcome `canceled`, cpuTime hanya
// ~175 ms) sehingga penanda fase di ekor tidak pernah tertulis. 45 s memberi
// margin besar terhadap plafon itu; pekerjaan yang tidak kebagian waktu
// menjadi `deferred` jujur dan dilanjutkan run berikutnya (5 menit lagi).
const RUN_DEADLINE_MS = 45_000;
// Ambang waktu minimum sebelum memulai satu unit kerja jaringan.
const TIME_TELEGRAM_BATCH = 12_000;
const TIME_WA_BATCH = 12_000;
const TIME_FULFILLMENT_UNIT = 10_000;
const TIME_WR_NETWORK = 14_000;
const TIME_WR_LIGHT = 8_000;
/**
 * Cadangan waktu yang TIDAK boleh dipakai sweep katalog: sisa langkah fase WR
 * (reconcile, saldo, delivery) + ekor handler yang menulis `wr_sync_log` dan
 * penanda fase. Sweep yang memakan seluruh sisa deadline akan dibunuh
 * platform tepat sebelum hasilnya tercatat — persis pola kegagalan yang
 * membuat sync terlihat "rusak di tengah jalan tanpa sebab".
 */
const TIME_WR_SWEEP_RESERVE = 8_000;
const TIME_SINGLE_MESSAGE = 3_000;
const EXPIRY_PER_RUN = 4;
const FULFILLMENT_PER_RUN = 4;
const COST_PER_NOTIFICATION = 4;
const COST_PER_WA_ROW = 5;
const COST_PER_WA_RECOVERY = 2;
const COST_PER_STALE_RELEASE = 2;
const COST_PER_CLEANUP = 4;
const COST_PER_WR_WORK = 8;
const RESERVE_TAIL = 2;
type CronPhase = "expiry" | "fulfillment" | "warung_rebahan" | "notify" | "cleanup";

// Expiry restores each distinct product/variant inside one atomic batch.
// Charge its real size, rather than assuming every order contains one item.
function expiryCost(raw: unknown): number {
  try {
    const items = JSON.parse(String(raw ?? "[]")) as { product_id: number; variant_id?: number }[];
    return 6 + new Set(items.map((i) => i.variant_id ? `v:${i.variant_id}` : `p:${i.product_id}`)).size;
  } catch { return 6; }
}

async function readCronPhase(database: DatabaseAccess): Promise<{ phase: CronPhase; deferred: CronPhase[] }> {
  const { queryFirst } = database;
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
  if (raw === "expiry" || raw === "fulfillment" || raw === "warung_rebahan" || raw === "notify" || raw === "cleanup") return raw;
  return null;
}

function nextPhase(phase: CronPhase): CronPhase {
  if (phase === "expiry") return "fulfillment";
  // WR disisipkan SETELAH fulfillment dan SEBELUM notify: order WR perlu
  // diproses sebelum notifikasi dikirim (plan §10).
  if (phase === "fulfillment") return "warung_rebahan";
  if (phase === "warung_rebahan") return "notify";
  return "expiry"; // cleanup kembali ke awal (cleanup jalan tiap run, ringan)
}

async function writeCronPhase(next: CronPhase, deferred: CronPhase[], database: DatabaseAccess): Promise<void> {
  const { execRun } = database;
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
  // Pembanding kanonis (src/lib/security.ts) — sama dengan webhook DANA/
  // Telegram/WhatsApp. `!==` membocorkan posisi byte pertama yang berbeda.
  if (!cronSecret || !constantTimeEqual(auth ?? "", `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runStartedAt = Date.now();
  /** Sisa waktu invocation (ms) sebelum deadline lunak. */
  const timeLeftMs = () => RUN_DEADLINE_MS - (Date.now() - runStartedAt);
  /** true bila masih ada waktu untuk satu unit kerja seukuran `needMs`. */
  const hasTime = (needMs: number) => timeLeftMs() >= needMs;

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
    whatsapp_outbox_paused: 0,
    whatsapp_rows_cleaned: 0,
    wr_products_synced: 0,
    // Observability sync (issue wr-sync-observability, 2026-09-19): alasan
    // skip sweep dilaporkan jujur — tanpa ini `synced:0 + skipped:null`
    // ambigu untuk 4 kondisi berbeda (fase tak aktif / interval belum tempo /
    // switch mati / tabel belum siap) dan gap 3 jam tak terlihat. Nilai:
    // "disabled" | "phase_inactive" | "interval" | "sync_disabled" |
    // "budget_yielded" | "attempted_failed" | "deadline" | "query_budget".
    wr_sync_skipped: null as string | null,
    // `created_at` sweep products terakhir (atau null) — respons tunggal
    // cukup untuk diagnosa tanpa query D1 tambahan.
    wr_last_sync_at: null as string | null,
    wr_orders_processed: 0,
    wr_orders_succeeded: 0,
    wr_saldo_balance: null as number | null,
    wr_saldo_low: false,
  };

  try {
    // Fase + budget (review R12): baca fase, hitung antrean tiap cabang
    // (1 query/cabang, murah), lalu eksekusi sesuai prioritas:
    // deferred-dulu → fase-giliran → sisanya bila budget cukup.
    const budget = createBudgetedDatabase(QUERY_BUDGET, RESERVE_TAIL);
    const database = budget.access;
    const { queryAll, queryFirst, execRun } = database;
    const transitionPendingPaymentOrder = (input: Parameters<typeof rawTransitionPendingPaymentOrder>[0]) => rawTransitionPendingPaymentOrder(input, database.d1);
    const transitionPendingOrder = (code: string, status: "kadaluarsa", note: null, items: { product_id: number; variant_id?: number; qty: number }[]) => rawTransitionPendingOrder(code, status, note, items, database.d1);
    const deferredOut: CronPhase[] = [];
    const { phase: storedPhase, deferred: storedDeferred } = await readCronPhase(database);

    // POISON-PILL GUARD (2026-09-18). `writeCronPhase` hanya dipanggil di ekor
    // handler, jadi run yang dibunuh platform di tengah jalan meninggalkan
    // fase + deferred yang sama untuk run berikutnya. Insiden 17 Sep 13:06 UTC
    // → 18 Sep 04:55 UTC: fase terkunci di `warung_rebahan`, tiap run 5 menit
    // mengulang pekerjaan berat yang sama, dipotong pada ~125 s, dan sync
    // otomatis WR tidak pernah tercatat selama ~16 jam (baris cron terakhir
    // di wr_sync_log: 17 Sep 11:37 UTC). Majukan rotasi + kosongkan deferred
    // SEKARANG; ekor menimpa dengan nilai final bila run selesai normal.
    // Konsekuensi yang disengaja: run yang mati kehilangan hint deferred-nya,
    // tetapi rotasi tetap bergerak sehingga tidak ada fase yang mengunci cron.
    await writeCronPhase(nextPhase(storedPhase), [], database);

    // HEARTBEAT (issue wr-sync-observability, 2026-09-19): bukti "pemicu
    // memanggil + handler hidup sampai sini". 1 statement ringan, best-effort.
    // Tanpa ini run yang kepotong deploy vs pemicu yang mati terlihat identik
    // (keduanya: tanpa baris sync baru). Baca: `cron_last_hit_at` segar +
    // sync basi = run kepotong; keduanya basi = pemicu mati.
    try {
      await execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_last_hit_at', datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      );
    } catch { /* heartbeat tak boleh menggagalkan run */ }

    // WATCHDOG SYNC BASI — SETIAP RUN (permanen, 2026-09-19 malam). Pelajaran
    // insiden 18:26→23:32 UTC: watchdog lama hanya berjalan di fase WR AKTIF,
    // sehingga run-run bergiliran fase lain tidak pernah mengevaluasinya dan
    // pemilik tak dapat ping selama 5 jam basi. Evaluasi di sini memakai
    // konteks seadanya (fase WR mungkin tak aktif → skipped="phase_inactive"
    // sebagai konteks); blok 3c di fase WR memperkaya konteks + me-reset
    // episode saat sweep sukses.
    // HEMAT BUDGET (pelajaran RR5-02): watchdog depan berjalan SEBELUM
    // admission budget fase mana pun, jadi tiap query-nya mencuri slot
    // fulfillment pada drain 20-baris yang pas-pasan. Maka: (a) skip total
    // bila switch WR mati (alertStaleWrSync return 0 juga — tanpa query);
    // (b) SATU query baca last_sync; bila null (tak ada histori: fixture
    // non-WR, DB baru) → selesai, 1 query tanpa efek. Hanya bila histori ADA,
    // evaluasi alert (1-2 query tambahan yang memang dibutuhkan).
    // CATATAN URUTAN: blok ini berjalan SEBELUM `wrTablesReady` didefinisikan
    // di bawah (perhitungan antrean), jadi JANGAN referensikannya — pakai
    // probe tabel langsung dengan `.catch(() => null)` (DB pra-0027 → null
    // → skip, sama seperti guard tabel di runWarungRebahan).
    try {
      const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
      if (isWrEnabled()) {
        const staleRow = await queryFirst(
          `SELECT created_at FROM wr_sync_log
           WHERE sync_type='products' AND status IN ('success','partial')
           ORDER BY created_at DESC LIMIT 1`,
        ).catch(() => null);
        if (typeof staleRow?.created_at === "string") {
          results.wr_last_sync_at = String(staleRow.created_at);
          const { alertStaleWrSync } = await import("@/lib/warung-rebahan/order");
          results.wr_sync_stale_alerted = await alertStaleWrSync(
            String(staleRow.created_at),
            typeof results.wr_sync_skipped === "string" ? String(results.wr_sync_skipped) : "pre_phase",
            database,
          );
        }
      }
    } catch { /* watchdog tak boleh menggagalkan run */ }

    // Hitung antrean dalam SATU query gabungan (1 query, bukan 8 — RR3-01/
    // RR3-03): tiap COUNT adalah subselect murah atas indeks status. Tanpa
    // ini, 10 query baca di depan + heater + 3 scan = 14 query sebelum satu
    // pun item terkirim, sehingga order 4 item (23 query kirim) tak muat.
    // RR3-06: kandidat sending basi dihitung SENDIRI (bukan dari pending/
    // failed) agar recovery tidak bergantung pada hadirnya pesan baru.
    // RR3-09: antrean notifikasi dihitung per JENIS (created / paid buyer /
    // paid admin), bukan hanya marker order-created.
    // WR: satu COUNT murah untuk link due — query TERPISAH agar DB lama
    // tanpa tabel WR (pre-migrasi 0027) tidak meruntuhkan seluruh query
    // gabungan di atas (satu subselect gagal = semua COUNT null).
    const queueRow = await queryFirst(
      `SELECT
        (SELECT COUNT(*) FROM payment_transactions WHERE status='pending') AS expiry,
        (SELECT COUNT(*) FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE ${QRIS_EXPIRY_NOTICE_WHERE}) AS qris_notice,
        (SELECT COUNT(*) FROM payment_transactions WHERE status='initializing' AND created_at < datetime('now', '-5 minutes')) AS expiry_init,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='whatsapp' AND status='pending' AND expires_at IS NOT NULL
          AND datetime(expires_at) <= datetime('now')
          AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=orders.code)) AS expiry_manual_wa,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status IN ('pending','failed') AND attempt_count < 5 AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS wa,
        (SELECT COUNT(*) FROM whatsapp_outbox WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))) AS wa_stale,
        (SELECT COUNT(*) FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid') AS jobs,
        (SELECT COUNT(*) FROM orders WHERE sales_channel IN ('telegram','whatsapp') AND telegram_order_notified_at IS NULL) AS created,
        (SELECT COUNT(*) FROM orders WHERE sales_channel='telegram' AND status='lunas' AND payment_status='paid' AND telegram_paid_notified_at IS NULL) AS paid,
        (SELECT COUNT(*) FROM orders WHERE sales_channel IN ('telegram','whatsapp') AND status='lunas' AND payment_status='paid' AND telegram_paid_admin_notified_at IS NULL) AS paid_admin,
        (SELECT COUNT(*) FROM fulfillment_jobs WHERE status='sending') AS stale`,
    ).catch(() => null);
    // DB lama tanpa tabel WR: query terpisah gagal → 0 (bukan null-kan semua).
    const wrDueRow = await queryFirst(
      `SELECT COUNT(*) AS wr_due FROM wr_order_links
       WHERE status IN ('pending','retry') AND attempt_count < max_attempts
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ).catch(() => null);
    // Antrean delivery kredensial + blocked_balance (P0-6/P1-8): fase WR
    // tetap aktif selama ada pekerjaan ini walau order kosong. Baris 'sending'
    // dengan lease kedaluwarsa IKUT dihitung (2026-09-18): tanpa itu, delivery
    // yang ditinggalkan run yang dibunuh tidak pernah mengaktifkan fase WR.
    const wrDeliveryRow = await queryFirst(
      `SELECT COUNT(*) AS wr_delivery_due FROM wr_order_links
       WHERE (delivery_status IN ('queued','failed')
              OR delivery_status='sending')
         AND (delivery_next_attempt_at IS NULL
              OR datetime(delivery_next_attempt_at) <= datetime('now'))`,
    ).catch(() => null);
    const wrBlockedRow = await queryFirst(
      `SELECT COUNT(*) AS wr_blocked FROM wr_order_links WHERE status='blocked_balance'`,
    ).catch(() => null);
    // DB lama tanpa tabel WR: seluruh query gabungan gagal → queueRow null →
    // semua pending 0 (perilaku lama) dan fase WR menjadi no-op via guard tabel.
    const wrTablesReady = wrDueRow != null;
    const wrDeliveryReady = wrDeliveryRow != null;
    const pendingExpiry = Number(queueRow?.expiry ?? 0);
    // RR4-06: sinyal expiry per JENIS — initializing basi dan manual-WA
    // kedaluwarsa dihitung SENDIRI, bukan dari ada/tidaknya pending lain.
    const pendingExpiryInit = Number((queueRow as Record<string, unknown> | null)?.expiry_init ?? 0);
    const pendingExpiryManualWa = Number((queueRow as Record<string, unknown> | null)?.expiry_manual_wa ?? 0);
    const pendingExpiryAny = pendingExpiry + pendingExpiryInit + pendingExpiryManualWa;
    const pendingQrisNotice = Number(queueRow?.qris_notice ?? 0);
    let pendingWa = Number(queueRow?.wa ?? 0);
    const pendingStaleWa = Number(queueRow?.wa_stale ?? 0);
    const pendingJobs = Number(queueRow?.jobs ?? 0);
    const pendingCreated = Number(queueRow?.created ?? 0);
    const pendingPaid = Number(queueRow?.paid ?? 0);
    const pendingPaidAdmin = Number(queueRow?.paid_admin ?? 0);
    const pendingStale = Number(queueRow?.stale ?? 0);
    // pendingNotify = seluruh jenis pekerjaan notifikasi (RR3-09).
    const pendingNotify = pendingCreated + pendingPaid + pendingPaidAdmin;
    const pendingWrDue = wrTablesReady ? Number(wrDueRow?.wr_due ?? 0) : 0;
    const pendingWrDelivery = wrDeliveryReady ? Number(wrDeliveryRow?.wr_delivery_due ?? 0) : 0;
    const pendingWrBlocked = wrTablesReady ? Number((wrBlockedRow as Record<string, unknown> | null)?.wr_blocked ?? 0) : 0;
    const pendingWrAny = pendingWrDue + pendingWrDelivery + pendingWrBlocked;

    // Urutan eksekusi: deferred tersimpan dulu (anti-starvation — expiry
    // yang terus berdatangan tidak membuat kanal lain kelaparan), lalu fase
    // giliran, lalu sisanya. Setiap cabang dieksekusi HANYA bila fits().
    // RR3-01: fulfillment SELALU aktif tiap run selama ada job due
    // (pendingJobs > 0) — fase bergiliran tidak boleh membuat antrean
    // pengiriman tertunda selamanya sementara fase lain kosong/ringan.
    const ordered: CronPhase[] = [];
    for (const d of storedDeferred) if (!ordered.includes(d)) ordered.push(d);
    if (!ordered.includes(storedPhase)) ordered.push(storedPhase);
    for (const p of ["expiry", "fulfillment", "warung_rebahan", "notify", "cleanup"] as CronPhase[]) {
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
    // Jaminan anti-starvation WR (2026-09-16, diperbaiki 2026-09-18): sync
    // produk cron pernah MATI TOTAL karena fulfillment mengusir
    // warung_rebahan dari 3 slot tiap run. Bila sync produk terakhir >45
    // menit lalu, paksa satu slot untuk warung_rebahan dengan mengorbankan
    // fase non-fulfillment terakhir (pola sama seperti jaminan fulfillment).
    //
    // 2026-09-18: syarat `pendingWrDue === 0 && pendingWrDelivery === 0`
    // DIBUANG. Syarat itu membuat guard memveto dirinya sendiri: fase WR
    // menangani order DAN sync, jadi selama ada order WR menggantung (dua
    // order Meitu 04:38–07:14 UTC) guard tidak pernah menyala dan sync tetap
    // mati 2,5 jam. Adanya order due bukan alasan membiarkan katalog basi.
    //
    // Fase WR juga dipindah ke DEPAN urutan eksekusi saat sync terlambat:
    // gerbang admission sync memakai budget baseline (40 statement) dan
    // deadline 45 detik, jadi bila ia baru dijalankan setelah expiry/notify,
    // sisa budget/waktunya sering tidak cukup dan sweep di-skip diam-diam.
    const wrEverSyncedProbe = wrTablesReady ? await queryFirst(
      `SELECT 1 AS x FROM wr_sync_log WHERE sync_type='products' LIMIT 1`,
    ).catch(() => null) : null;
    if (wrEverSyncedProbe) {
      const wrStale = await queryFirst(
        `SELECT created_at FROM wr_sync_log WHERE sync_type='products'
         ORDER BY id DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry((wrStale as Record<string, unknown> | null)?.created_at);
      if (lastTs == null || lastTs < Date.now() - 45 * 60 * 1000) {
        if (!activePhases.has("warung_rebahan")) {
          const actives = ordered.filter((p) => activePhases.has(p));
          const victim = [...actives].reverse().find((p) => p !== "fulfillment" && p !== "warung_rebahan");
          if (victim) {
            activePhases.delete(victim);
            activePhases.add("warung_rebahan");
            const idx = deferredOut.indexOf("warung_rebahan");
            if (idx >= 0) deferredOut.splice(idx, 1);
            if (!deferredOut.includes(victim)) deferredOut.push(victim);
          }
        }
        // Dahulukan eksekusinya agar sweep bertemu budget + waktu yang segar.
        if (activePhases.has("warung_rebahan")) {
          const at = ordered.indexOf("warung_rebahan");
          if (at > 0) {
            ordered.splice(at, 1);
            ordered.unshift("warung_rebahan");
          }
        }
      }
    }

    let waWorkPending = pendingWa + pendingStaleWa;
    const runExpiry = async () => {
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
      // RR4-06: sinyalnya per jenis (pending/init-basi/manual-WA) — initializing
      // basi dipulihkan walau tidak ada pending lain.
      const expiryDue = pendingExpiryAny > 0;
      if (activePhases.has("expiry") && expiryDue && budget.fits(4)) {
        staleInit = await queryAll(
          `SELECT pt.order_code, o.items FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status='initializing' AND pt.created_at < datetime('now', '-5 minutes')
           LIMIT ?`,
          EXPIRY_PER_RUN,
        );
        expiredCandidates = await queryAll(
          `SELECT pt.order_code, pt.provider, pt.provider_order_id, pt.merchant_id,
                  COALESCE(CASE WHEN pt.provider='dana' THEN o.expires_at END,pt.expires_at) AS expires_at,
                  pt.status, o.items, o.telegram_chat_id
           FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status='pending'
             AND julianday(COALESCE(CASE WHEN pt.provider='dana' THEN o.expires_at END,pt.expires_at))<=julianday('now')
           ORDER BY julianday(COALESCE(CASE WHEN pt.provider='dana' THEN o.expires_at END,pt.expires_at)) ASC
           LIMIT ?`,
          EXPIRY_PER_RUN * 2,
        );

        expiryListed = true;
      } else if (pendingExpiryAny > 0) {
        deferredOut.push("expiry");
      }
      let staleTransitions = 0;
      for (const tx of staleInit) {
        if (!budget.fits(expiryCost(tx.items))) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
        const order = { items: tx.items };
        if (order) {
          try {
            const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

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

      // 2. A dead QR may be renewed while its order still owns the stock.
      // Close DANA ledger + order only at the ORDER deadline (legacy fallback:
      // invoice deadline when the order has none). Keep the JS check as well.
      const expiredPayments = expiredCandidates
        .filter((tx) => isExpiredIso(tx.expires_at))
        .slice(0, EXPIRY_PER_RUN);
      let expiredTransitions = 0;
      for (const tx of expiredPayments) {
        if (!budget.fits(expiryCost(tx.items))) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
        // Deadline: transisi DB murah, tetapi cabang non-DANA mengirim pesan
        // Telegram (10 s timeout) — jangan mulai bila waktu tidak cukup.
        if (!hasTime(TIME_SINGLE_MESSAGE)) {
          if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
          break;
        }
        const order = { items: tx.items, telegram_chat_id: tx.telegram_chat_id };
        if (order) {
          try {
            const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

            const changed = await transitionPendingPaymentOrder({
              orderCode: String(tx.order_code),
              expectedTransactionStatus: "pending",
              transactionStatus: "expired",
              expiredOnly: true,
              orderStatus: "kadaluarsa",
              paymentStatus: "expired",
              items,
            });
            if (!changed) continue;
            expiredTransitions++;
            if (tx.provider !== "dana" && order.telegram_chat_id) {
              await sendMessage({ chat_id: String(order.telegram_chat_id),
                text: orderExpiredMessage(String(tx.order_code)), parse_mode: "HTML" }).catch(() => {});
            }
          } catch { /* ok */ }
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

      } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
        deferredOut.push("expiry");
      }
      // Deklarasi dipulihkan (terpotong saat edit RR4-06): loop stranded di bawah.
      let repairedLegacy = 0;
      for (const row of strandedCandidates) {
        if (!budget.fits(expiryCost(row.items))) break;
        try {
          const items = JSON.parse(String(row.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

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
      // RR4-06: gerbangnya sinyal manual-WA SENDIRI (pendingExpiryManualWa),
      // bukan ada/tidaknya ledger pending lain.
      if (activePhases.has("expiry") && expiryListed && pendingExpiryManualWa > 0 && budget.fits(1)) {
        manualCandidates = await queryAll(
          `SELECT o.code, o.items, o.expires_at
           FROM orders o
           WHERE o.sales_channel='whatsapp' AND o.status='pending'
             AND o.expires_at IS NOT NULL
             AND NOT EXISTS(SELECT 1 FROM payment_transactions pt WHERE pt.order_code=o.code)
           LIMIT ?`,
          EXPIRY_PER_RUN * 2,
        );

      }
      const expiredManualWhatsApp = manualCandidates
        .filter((order) => isExpiredIso(order.expires_at))
        .slice(0, EXPIRY_PER_RUN);
      let expiredStaticCount = 0;
      for (const order of expiredManualWhatsApp) {
        if (!budget.fits(expiryCost(order.items))) break;
        try {
          const items = JSON.parse(String(order.items ?? "[]")) as { product_id: number; variant_id?: number; qty: number }[];

          await transitionPendingOrder(String(order.code), "kadaluarsa", null, items);
          expiredStaticCount++;
        } catch { /* another worker may have transitioned it */ }
      }
      results.expired_manual_whatsapp_orders = expiredStaticCount;

      // Sinyal deferred expiry jujur: masih ada sisa antrean setelah batas
      // (semua jenis: pending + init-basi + manual-WA — RR4-06).
      if (pendingExpiryAny > staleTransitions + expiredTransitions + repairedLegacy + expiredStaticCount) {
        if (!deferredOut.includes("expiry")) deferredOut.push("expiry");
      }

    };
    const runNotify = async () => {
      // Invoice-expired notice and terminal notice survive delivery failures.
      const noticeCount = pendingQrisNotice + Number(results.expired_payments);
      if (activePhases.has("notify") && noticeCount > 0 && budget.fits(5) && hasTime(TIME_TELEGRAM_BATCH)) {
        const notices = await sendQrisExpiryNotifications(2, database);
        results.qris_expiry_notifications = notices.sent;
        pendingWa += notices.whatsappQueued;
        waWorkPending += notices.whatsappQueued;
        if (noticeCount > Number(results.qris_expiry_notifications) && !deferredOut.includes("notify")) deferredOut.push("notify");
      } else if (noticeCount > 0 && !deferredOut.includes("notify")) deferredOut.push("notify");
      // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
      // RR3-09: retry notifikasi mencakup created + paid buyer + paid admin
      // (hitung pendingNotify di atas = ketiganya). Daftar dibaca HANYA bila
      // fase notify aktif DAN antrean jenis itu > 0 (RR3-01: tanpa guard ini,
      // 3 list kosong × tiap run = 12 query baca yang mengusir job kirim).
      // Biaya konservatif: 1 list + per order 4 (baca+validasi+kirim+tandai).
      if (activePhases.has("notify") && pendingNotify > 0) {
        const units = Math.min(FULFILLMENT_PER_RUN, pendingNotify);
        if (budget.fits(1 + COST_PER_NOTIFICATION * units) && hasTime(TIME_TELEGRAM_BATCH)) {
          const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN, {
            created: pendingCreated > 0, paid: pendingPaid > 0, paidAdmin: pendingPaidAdmin > 0,
          }, database);

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
        if (budget.fits(1 + COST_PER_NOTIFICATION * 2) && hasTime(TIME_TELEGRAM_BATCH)) {
          try {
            const invoiceSent = await retryInvoicePendingTelegramInvoices(2, database);

            results.telegram_invoice_retried = invoiceSent;
          } catch { /* cron berikutnya retry */ }
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      }

      if (activePhases.has("notify")) {
        if (budget.fits(1 + COST_PER_NOTIFICATION * FULFILLMENT_PER_RUN) && hasTime(TIME_TELEGRAM_BATCH)) {
          const reminders = await sendPendingOrderReminders(FULFILLMENT_PER_RUN, database);

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
      if (activePhases.has("notify") && waWorkPending > 0) {
        const waUnits = Math.min(FULFILLMENT_PER_RUN, Math.max(pendingWa, pendingStaleWa > 0 ? 1 : 0));
        if (budget.fits(COST_PER_WA_RECOVERY + waUnits * COST_PER_WA_ROW) && hasTime(TIME_WA_BATCH)) {
          try {
            const waOutbox = await processDueWhatsAppOutbox(FULFILLMENT_PER_RUN, database);

            results.whatsapp_outbox_sent = waOutbox.sent;
            results.whatsapp_outbox_dead = waOutbox.dead;
            results.whatsapp_outbox_recovered = waOutbox.recovered ?? 0;
            results.whatsapp_outbox_claim_errors = waOutbox.claimErrors ?? 0;
            results.whatsapp_outbox_paused = waOutbox.paused ?? 0;
          } catch { /* antrean bertahan; cron berikutnya retry */ }
          const waLeft = pendingWa - (Number(results.whatsapp_outbox_sent) + Number(results.whatsapp_outbox_dead));
          if ((waLeft > 0 || pendingStaleWa > Number(results.whatsapp_outbox_recovered)) && !deferredOut.includes("notify")) deferredOut.push("notify");
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      } else if (waWorkPending > 0 && !deferredOut.includes("notify")) {
        deferredOut.push("notify");
      }

    };
    const runFulfillment = async () => {
      // Materialization and delivery are resumable units in the same request budget.
      if (activePhases.has("fulfillment")) {
        if (pendingStale > 0 && budget.fits(COST_PER_STALE_RELEASE)) {
          results.stale_locks_released = await releaseStaleJobs(database);
        }
        if (budget.fits(1 + COST_PER_ORPHAN_LIGHT)) {
          const orphans = await queryAll(
            `SELECT o.code FROM orders o LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
             WHERE o.status='lunas' AND o.payment_status='paid' AND fj.order_code IS NULL
             ORDER BY o.created_at ASC LIMIT ?`, FULFILLMENT_PER_RUN,
          );
          for (const orphan of orphans) {
            if (!budget.fits(COST_PER_ORPHAN_LIGHT)) { deferredOut.push("fulfillment"); break; }
            try { if (await reconcileOrphanLight(String(orphan.code), database)) results.fulfillment_orphans_healed = Number(results.fulfillment_orphans_healed) + 1; }
            catch { deferredOut.push("fulfillment"); }
          }
        }
        if (budget.fits(5)) results.fulfillment_aggregates_repaired = await reconcileSettledJobs(2, database);
        if (budget.fits(1)) {
          const jobs = process.env.AUTO_FULFILLMENT_ENABLED === "true"
            ? await getDueJobs(FULFILLMENT_PER_RUN, database)
            : await queryAll(
              `SELECT fj.* FROM fulfillment_jobs fj JOIN orders o ON o.code=fj.order_code
               WHERE fj.status IN ('queued','retry') AND o.status='lunas' AND o.payment_status='paid'
                 AND (fj.locked_until IS NULL OR datetime(fj.locked_until)<datetime('now'))
                 AND (SELECT COUNT(*) FROM fulfillment_items fi WHERE fi.order_code=o.code)
                   < json_array_length(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END)
               ORDER BY fj.created_at ASC, fj.id ASC LIMIT ?`, FULFILLMENT_PER_RUN,
            );
          for (const job of jobs) {
            if (!budget.fits(2 + COST_PER_JOB_FRAME + COST_PER_DELIVERY_ITEM)) { deferredOut.push("fulfillment"); break; }
            // Pengiriman item memanggil kanal luar (Telegram/WA) — hormati
            // deadline invocation agar run tidak dipotong platform.
            if (!hasTime(TIME_FULFILLMENT_UNIT)) { deferredOut.push("fulfillment"); break; }
            const order = await queryFirst(`SELECT * FROM orders WHERE code=?`, String(job.order_code));
            if (!order) continue;
            // processJobItems resolves each item's product; no eager products scan.
            try {
              if (process.env.AUTO_FULFILLMENT_ENABLED !== "true") {
                // Populate the admin queue in bounded steps, without dispatching.
                await ensureFulfillmentItems(order, database, 2);
                continue;
              }
              const unit = await processJobItems(Number(job.id), order, {}, 2, undefined, database);
              if (unit.done || unit.attempted > 0) results.due_jobs_processed = Number(results.due_jobs_processed) + 1;
              if (!unit.finished && !["not_owned", "not_paid", "no_work"].includes("reason" in unit ? unit.reason : "")) deferredOut.push("fulfillment");
            } catch { deferredOut.push("fulfillment"); }
          }
          if (jobs.length >= FULFILLMENT_PER_RUN) deferredOut.push("fulfillment");
        }
      } else if (pendingJobs > 0 || pendingStale > 0) deferredOut.push("fulfillment");

    };
    const runWarungRebahan = async () => {
      // === FASE WARUNG_REBAHAN: sync produk + order pending + saldo ===
      // No-op total bila master switch mati atau tabel WR belum ada (DB lama
      // sebelum migrasi 0027): jangan bakar budget, jangan deferred palsu.
      const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
      if (!isWrEnabled() || !wrTablesReady) {
        // Dulu: return diam tanpa jejak (pelajaran Fase A 18 Sep — env mati
        // = seluruh fase no-op total, vonis salah "kode rusak"). Kini jujur.
        if (results.wr_sync_skipped == null) results.wr_sync_skipped = "disabled";
        return;
      }
      // Posisi sweep terakhir DIBACA DI DEPAN (1 query murah) agar SEMUA
      // respons — termasuk phase_inactive/sync_disabled — membawa
      // `wr_last_sync_at`. Tanpa ini diagnosa "kapan terakhir?" butuh query
      // D1 tambahan, dan respons phase_inactive tak bisa dinilai
      // (basi vs segar) dari JSON saja.
      try {
        const lastSyncRow = await queryFirst(
          `SELECT created_at FROM wr_sync_log
           WHERE sync_type='products' AND status IN ('success','partial')
           ORDER BY created_at DESC LIMIT 1`,
        ).catch(() => null);
        if (typeof lastSyncRow?.created_at === "string") results.wr_last_sync_at = String(lastSyncRow.created_at);
      } catch { /* last_sync_at best-effort, tak boleh menggagalkan fase */ }
      if (!activePhases.has("warung_rebahan")) {
        if (pendingWrAny > 0 && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
        // Fase tak aktif = rotasi normal, BUKAN kegagalan — tapi laporkan
        // agar `synced:0` tidak ambigu dengan skip lain.
        if (results.wr_sync_skipped == null) results.wr_sync_skipped = "phase_inactive";
        return;
      }
      if (!budget.fits(COST_PER_WR_WORK)) {
        if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
        return;
      }
      try {
        const { syncProducts, WR_SYNC_PRODUCTS_PER_RUN } = await import("@/lib/warung-rebahan/sync");
        const { processWrPendingOrders, retryFailedWrOrders, reconcileStuckWrOrders, reconcileBlockedBalance, recoverStaleClaims, alertAgingWrOrders } = await import("@/lib/warung-rebahan/order");
        const { processDueCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
        const { checkAndLogSaldo } = await import("@/lib/warung-rebahan/saldo");
        const syncOn = process.env.WARUNG_REBAHAN_SYNC_ENABLED !== "false";
        const autoOrder = process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true";

        // 0. Recover lease basi (worker crash) + pulihkan blocked_balance
        //    setelah top-up — murah, selalu jalan bila fase aktif.
        if (budget.fits(4)) {
          try {
            await recoverStaleClaims(database);
            await reconcileBlockedBalance(database);
          } catch { /* best-effort */ }
        }

        // 1. Kapasitas ORDER diprioritaskan SEBELUM sync produk (P0-4):
        //    sync katalog besar tidak boleh membuat WR order starvation.
        if (autoOrder && pendingWrDue > 0 && budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_NETWORK)) {
          try {
            await retryFailedWrOrders(database);
            const processed = await processWrPendingOrders(database);
            results.wr_orders_processed = processed.processed;
            results.wr_orders_succeeded = processed.succeeded;
            results.wr_orders_blocked = processed.blocked;
            results.wr_orders_reconciled = (processed.reconciled ?? 0) + Number(results.wr_orders_reconciled ?? 0);
            if (processed.processed > processed.succeeded && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
          } catch { if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan"); }
        }

        // 2. Product & stock sync — tiap 30 menit, RESUMABLE via cursor
        //    (P0-4): katalog lebih besar dari budget maju lintas invocation.
        //    Sweep penuh 48 produk memakan ~10 s (lihat wr_sync_log
        //    duration_ms): wajib punya sisa waktu, kalau tidak run dipotong
        //    platform sebelum log/penanda tertulis.
        if (!syncOn) {
          // Saklar sync dimatikan eksplisit — bedakan dari "disabled" (master
          // switch / tabel belum siap) agar diagnosa env tepat sasaran.
          if (results.wr_sync_skipped == null) results.wr_sync_skipped = "sync_disabled";
        } else if (budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_NETWORK)) {
          const lastSync = await queryFirst(
            `SELECT created_at FROM wr_sync_log
             WHERE sync_type='products' AND status IN ('success','partial')
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
          // Bandingkan sebagai UTC via parseExpiry (baris lama format spasi).
          const { parseExpiry } = await import("@/lib/expiry");
          const lastTs = parseExpiry(lastSync?.created_at);
          // Selalu laporkan posisi terakhir — respons tunggal cukup untuk
          // diagnosa ("kapan sweep terakhir?") tanpa query D1 tambahan.
          if (typeof lastSync?.created_at === "string") results.wr_last_sync_at = String(lastSync.created_at);
          // Sweep yang BELUM tuntas tidak boleh ikut menunggu interval 30
          // menit. Saat D1 lambat, sweep berhenti karena WAKTU dengan
          // `errors` kosong sehingga tercatat `success` — gerbang interval
          // lalu membacanya sebagai "baru saja sukses" dan menahan
          // lanjutannya setengah jam. Efeknya katalog 48 produk butuh ~90
          // menit (4 potongan × 30 mnt) padahal kerjanya hanya ~2 menit CPU,
          // dan selama itu harga/stok separuh katalog basi.
          // Sinyalnya `products_cursor`, BUKAN `products_snapshot_complete`.
          // Penanda snapshot ambigu: migrasi 0029 menyeednya '0' sehingga DB
          // yang belum pernah sync tidak bisa dibedakan dari sweep parsial
          // yang tertunda. Cursor tidak ambigu — ia ditulis `0` tepat ketika
          // sweep mencapai ujung daftar, jadi `cursor > 0` berarti PASTI ada
          // potongan katalog yang belum tersentuh pada sweep berjalan.
          const cursorRow = await queryFirst(
            `SELECT value FROM wr_sync_state WHERE key='products_cursor'`,
          ).catch(() => null);
          const resumeNow = Number(cursorRow?.value ?? 0) > 0;
          if (resumeNow) results.wr_sync_resume = true;
          if (resumeNow || lastTs == null || lastTs < Date.parse(thirtyMinAgo)) {
            // CATATAN (2026-09-20): admission proporsional berbasis
            // `duration_ms × 1,5` DIBUANG — ia mematikan sync secara PERMANEN.
            // `hasTime()` diukur terhadap RUN_DEADLINE_MS = 45 dtk, jadi
            // estimasi apa pun di atas 45 dtk tidak akan PERNAH terpenuhi.
            // Ambangnya `duration_ms > 30.000`; pada data produksi 69 dari 104
            // sweep (66%) melewatinya — termasuk seluruh blok 00:12–07:07 UTC
            // (114–116 dtk). Karena jalur skip TIDAK menulis `wr_sync_log`,
            // `duration_ms` terakhir membeku selamanya: satu-satunya penulis
            // nilai itu adalah sweep, dan sweep tidak pernah diizinkan jalan
            // lagi. Deadlock tertutup — pemulihan hanya lewat Force Sync manual.
            //
            // Penggantinya bukan gerbang di depan, melainkan budget waktu DI
            // DALAM sweep (lihat `timeBudgetMs`): sweep selalu boleh mulai,
            // mengerjakan sebanyak yang muat, lalu berhenti sendiri di produk
            // utuh terakhir + menyimpan cursor + MENULIS log. Dengan begitu
            // durasi tercatat selalu ≤ budget dan tidak ada nilai beku yang
            // bisa mengunci run berikutnya.
            try {
              // Budget WAKTU sweep = sisa deadline invocation dikurangi
              // cadangan ekor. Tanpa ini sweep berjalan tanpa batas waktu
              // (hanya batas budget query) dan run dibunuh platform SEBELUM
              // `wr_sync_log` + penanda fase tertulis — akar \"sync tersendat
              // berminggu-minggu\": beban identik terukur 12 dtk saat D1 sehat
              // vs 115-122 dtk saat D1 lambat.
              const syncResult = await syncProducts(database, undefined, {
                maxProducts: WR_SYNC_PRODUCTS_PER_RUN,
                trigger: "cron",
                timeBudgetMs: Math.max(0, timeLeftMs() - TIME_WR_SWEEP_RESERVE),
              });
              results.wr_products_synced = syncResult.synced;
              if (typeof syncResult.synced === "number" && syncResult.synced > 0) {
                // Sweep sukses me-reset episode basi watchdog: sweep berikut
                // yang basi lagi akan alert ulang (state = lastSync LAMA).
                // Konteks koreksi ikut dibersihkan agar episode baru segar.
                await execRun(
                  `INSERT INTO wr_sync_state (key, value) VALUES ('sync_stale_alerted_at','')
                   ON CONFLICT(key) DO UPDATE SET value=''`,
                ).catch(() => undefined);
                await execRun(
                  `INSERT INTO wr_sync_state (key, value) VALUES ('sync_stale_alert_context','')
                   ON CONFLICT(key) DO UPDATE SET value=''`,
                ).catch(() => undefined);
              }
              if (syncResult.budgetYielded) {
                if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
                // Respons jujur penuh: budget-yield HANYA mendorong deferred
                // tanpa mengisi skipped — masih ambigu di JSON. attempted
                // sweep yang tak tuntas = "budget_yielded".
                if (results.wr_sync_skipped == null) results.wr_sync_skipped = "budget_yielded";
              }
              if (syncResult.errors.length) {
                if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
                // Sama: errors tanpa skipped = ambigu. Sweep dicoba tapi
                // menyimpan error = "attempted_failed" (lebih informatif
                // daripada interval/disabled, jadi TIMPA).
                results.wr_sync_skipped = "attempted_failed";
                results.wr_sync_errors = syncResult.errors.slice(0, 3);
              }
            } catch { if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan"); }
          } else {
            // Interval 30 menit belum jatuh tempo — kondisi normal tersering.
            // Dulu: tanpa jejak (skipped tetap null) sehingga gap abnormal
            // tak bisa dibedakan dari rotasi sehat.
            if (results.wr_sync_skipped == null) results.wr_sync_skipped = "interval";
          }
        } else if (syncOn) {
          // Skip karena budget/waktu habis. WAJIB ditandai: tanpa ini sweep
          // hilang diam-diam (cron_deferred kosong padahal katalog basi) dan
          // tidak ada yang mendorong fase WR ke depan pada run berikutnya.
          if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
          results.wr_sync_skipped = budget.fits(COST_PER_WR_WORK) ? "deadline" : "query_budget";
        }

        // 3. Reconcile processing/ambigu menggantung >1 jam via /transactions.
        if (autoOrder && budget.fits(3) && hasTime(TIME_WR_LIGHT)) {
          try {
            results.wr_orders_reconciled = Number(results.wr_orders_reconciled ?? 0) + await reconcileStuckWrOrders(database);
          } catch { /* best-effort; run berikutnya retry */ }
        }

        // 3b. Peringatan umur antrean: link yang masih diproses melewati
        //     ambang internal (di atas plafon janji pembeli). Murni D1 +
        //     Telegram, idempoten via aging_alerted_at.
        if (budget.fits(4)) {
          try {
            results.wr_orders_aging_alerted = await alertAgingWrOrders(database);
          } catch { /* best-effort */ }
        }

        // 3c. Watchdog sync basi — REFRESH konteks (anti-macet struktural):
        //     evaluasi utama SUDAH berjalan di depan handler setiap run
        //     (lihat blok watchdog di atas) agar tak tergantung fase WR aktif
        //     — pelajaran insiden 18:26→23:32 UTC (5 jam tanpa ping karena
        //     watchdog lama hanya hidup di fase WR). Di sini, bila fase WR
        //     aktif dan `wr_sync_skipped` run ini terisi, segarkan konteks
        //     alert bila episode masih terbuka (state = last_sync yang sama).
        //     Ritme normal 30 mnt ≪ 90 mnt → tak ada alert palsu.
        if (budget.fits(4) && typeof results.wr_last_sync_at === "string") {
          try {
            const { refreshStaleWrSyncContext } = await import("@/lib/warung-rebahan/order");
            await refreshStaleWrSyncContext(
              String(results.wr_last_sync_at),
              typeof results.wr_sync_skipped === "string" ? String(results.wr_sync_skipped) : null,
              database,
            );
          } catch { /* watchdog tak boleh menggagalkan fase */ }
        }

        // 4. Delivery kredensial durable (P0-6): antrean queued/failed +
        //    pemulihan lease 'sending' yang basi (run sebelumnya dibunuh).
        if (budget.fits(4) && hasTime(TIME_WR_LIGHT)) {
          try {
            const delivery = await processDueCredentialDeliveries(database);
            results.wr_deliveries_processed = delivery.processed;
            results.wr_deliveries_delivered = delivery.delivered;
            results.wr_deliveries_lease_recovered = delivery.recovered;
            if (delivery.processed > delivery.delivered && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
          } catch { /* best-effort */ }
        }

        // 4. Saldo check — tiap 1 jam.
        if (budget.fits(3) && hasTime(TIME_WR_LIGHT)) {
          const lastCheck = await queryFirst(
            `SELECT created_at FROM wr_saldo_log WHERE source='api_check'
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const { parseExpiry } = await import("@/lib/expiry");
          const lastTs = parseExpiry(lastCheck?.created_at);
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          if (lastTs == null || lastTs < oneHourAgo) {
            try {
              const saldo = await checkAndLogSaldo(database);
              results.wr_saldo_balance = saldo.balance;
              results.wr_saldo_low = saldo.isLow;
            } catch { /* API down: sync berikutnya retry; bukan deferred */ }
          }
        }
      } catch {
        if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
      }
    };
    const runCleanup = async () => {
      // === FASE CLEANUP: ringan, jalan tiap run bila budget sisa ===
      // RR3-01: JANGAN paksakan cleanup tiap run — 4 query kosong tiap run =
      // setengah item kirim. Cleanup jalan bila (a) tidak ada pekerjaan
      // fulfillment/notify yang menunggu, ATAU (b) budget tersisa longgar
      // (sisa ≥ 10 setelah cadangan ekor). Deferred cleanup adalah normal,
      // bukan kegagalan.
      const fulfilOrNotifyWaiting = pendingJobs > 0 || pendingNotify > 0 || waWorkPending > 0 || pendingExpiryAny > 0;
      if (!fulfilOrNotifyWaiting && budget.fits(COST_PER_CLEANUP)) {
        const expiredSessions = await execRun(
          `DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')`,
        );
        const oldInboxEvents = await execRun(
          `DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')`,
        );
        await execRun(`DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')`);

        // Cleanup revokasi sesi kedaluwarsa (R8): anggaran cron yang sama.
        await execRun(`DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')`)
          .catch(() => ({ changes: 0 as number | undefined }));

        results.whatsapp_rows_cleaned = Number(expiredSessions.changes || 0)
          + Number(oldInboxEvents.changes || 0);
      } else if (!deferredOut.includes("cleanup")) {
        deferredOut.push("cleanup");
      }

    };
    const phases = { expiry: runExpiry, notify: runNotify, fulfillment: runFulfillment, warung_rebahan: runWarungRebahan, cleanup: runCleanup };
    // Execute in the persisted priority order, so busy expiry cannot always
    // consume the budget before a deferred delivery or notification gets a turn.
    for (const phase of ordered) {
      // Deadline invocation: berhenti menambah pekerjaan baru dan tandai
      // sisanya deferred, supaya ekor (penanda fase) SELALU kebagian jalan.
      if (!hasTime(TIME_SINGLE_MESSAGE)) {
        if (!deferredOut.includes(phase)) deferredOut.push(phase);
        continue;
      }
      try { await phases[phase](); }
      catch (error) {
        if (!(error instanceof QueryBudgetExceeded)) throw error;
        deferredOut.push(phase);
      }
    }

    // Tail cannot be consumed by helpers: two final statements are reserved.
    budget.beginTail();
    const deferred = [...new Set(deferredOut)];
    await writeCronPhase(nextPhase(storedPhase), deferred, database);
    results.query_budget_used = budget.used;
    results.query_budget_limit = QUERY_BUDGET;
    results.query_budget_note = "submitted_statements_including_batch_members";
    results.run_duration_ms = Date.now() - runStartedAt;
    results.run_deadline_ms = RUN_DEADLINE_MS;
    if (deferred.length > 0) results.deferred = deferred;

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
