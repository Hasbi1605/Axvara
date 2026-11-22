import { operationQueueProbeSql } from "@/lib/cron-queues";
import { FAST_EXPIRY_RAILS_SQL, STALE_INITIALIZING_SQL } from "@/lib/payments/stale-initializing";

// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import { transitionPendingOrder as rawTransitionPendingOrder, transitionPendingPaymentOrder as rawTransitionPendingPaymentOrder } from "@/lib/db";
import { createBudgetedDatabase, QueryBudgetExceeded } from "@/lib/db-access";
import { catalogSweepDue, CATALOG_SYNC_INTERVAL_MS } from "@/lib/cron/catalog-sweep";
import { createOperationsContext, createOperationsResults } from "@/lib/cron/operations-context";
import { initialSchedule, isStalePromotion, promoteStalePhase } from "@/lib/cron/scheduling";
import { run as runCleanupPhase } from "@/lib/cron/phases/cleanup";
import { run as runFulfillmentPhase } from "@/lib/cron/phases/fulfillment";
import { advanceCronPhase, nextPhase, phaseName, readCronPhase, writeCronHeartbeat, writeCronPhase, type CronPhase } from "@/lib/cron/phase-state";
import { isExpiredIso } from "@/lib/expiry";

import { sendMessage } from "@/lib/telegram/api";
import { orderExpiredMessage } from "@/lib/telegram/messages";
import { QRIS_EXPIRY_NOTICE_WHERE, sendQrisExpiryNotifications } from "@/lib/payments/qris-expiry-notifications";
import { retryPendingTelegramNotifications, sendPendingOrderReminders, WEB_PAID_ADMIN_PENDING_WHERE } from "@/lib/telegram/order-notifications";
import { retryInvoicePendingTelegramInvoices } from "@/lib/telegram/invoice-retry";
import { constantTimeEqual } from "@/lib/security";
import { processDueWhatsAppOutbox } from "@/lib/whatsapp/outbox";

export const runtime = "edge";

// A request-scoped D1 wrapper counts all nested queries, including batch members.
// Paid plan: runaway guard 300 statements (no longer capped at Free-plan 50); two are reserved for phase state.
const QUERY_BUDGET = 300;
// Deadline wall-clock per invocation (2026-09-18). D1 punya budget statement,
// tetapi TIDAK ada yang membatasi waktu tunggu jaringan: notify bisa
// merangkai 14 panggilan Telegram/WA @10 s dan fase WR 3 panggilan @12 s
// dalam satu invocation. Insiden 17–18 Sep: run cron mencapai wallTime
// 125.003 ms lalu dipotong platform (outcome `canceled`, cpuTime hanya
// ~175 ms) sehingga penanda fase di ekor tidak pernah tertulis. 45 s memberi
// margin besar terhadap plafon itu; pekerjaan yang tidak kebagian waktu
// menjadi `deferred` jujur dan dilanjutkan run berikutnya (5 menit lagi).
const RUN_DEADLINE_MS = 45_000;
// Ambang waktu minimum sebelum memulai satu unit kerja jaringan. Workers Paid:
// 12 dtk -> 4 dtk; per-item `hasTime` tetap dijaga supaya batch berhenti rapi
// sebelum deadline 45 dtk, bukan melewatkan seluruh fase.
const TIME_TELEGRAM_BATCH = 4_000;
// Satu kabar kedaluwarsa: Telegram timeout 10 dtk, email 8 dtk.
const TIME_EXPIRY_NOTICE = 10_000;
const TIME_WA_BATCH = 12_000;

const TIME_WR_NETWORK = 14_000;
const TIME_WR_LIGHT = 8_000;
// Sekalipay (0049): ambang yang sama dengan WR — unit jaringan SK ikut
// deadline 45 dtk + cadangan ekor yang sama agar tidak dipotong platform.
const TIME_SK_NETWORK = 14_000;
const TIME_SK_LIGHT = 8_000;
/**
 * Cadangan waktu yang TIDAK boleh dipakai sweep katalog: sisa langkah fase WR
 * (reconcile, saldo, delivery) + ekor handler yang menulis `wr_sync_log` dan
 * penanda fase. Sweep yang memakan seluruh sisa deadline akan dibunuh
 * platform tepat sebelum hasilnya tercatat — persis pola kegagalan yang
 * membuat sync terlihat "rusak di tengah jalan tanpa sebab".
 */
const TIME_WR_SWEEP_RESERVE = 8_000;
const TIME_SINGLE_MESSAGE = 3_000;
const EXPIRY_PER_RUN = 30;
const FULFILLMENT_PER_RUN = 20;
const WA_OUTBOX_PER_RUN = 4;
const WR_SK_BALANCE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const COST_PER_WA_ROW = 5;
const COST_PER_WA_RECOVERY = 2;

const COST_PER_WR_WORK = 8;
// Sekalipay: biaya admission yang sama dengan WR per unit kerja fase.
const COST_PER_SK_WORK = 8;
const RESERVE_TAIL = 2;
// Potongan sweep per request di mode `?phase=` (Workers Free: ~10 ms CPU per
// request). Insiden 3 Okt 20:25–23:50 WIB: 41 run beruntun dibunuh runtime
// (`exceededResources` → 503) karena SATU request memikul expiry + fulfillment
// + sync WR 49 produk + sync SK 157 varian. Worker kini memanggil fase satu
// per satu dan mengulang fase sync selama respons `more: true`.
const WR_CRON_CHUNK = 10;
const SK_CRON_CHUNK = 25;

// Expiry restores each distinct product/variant inside one atomic batch.
// Charge its real size, rather than assuming every order contains one item.
function expiryCost(raw: unknown): number {
  try {
    const items = JSON.parse(String(raw ?? "[]")) as { product_id: number; variant_id?: number }[];
    return 6 + new Set(items.map((i) => i.variant_id ? `v:${i.variant_id}` : `p:${i.product_id}`)).size;
  } catch { return 6; }
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

  // Mode satu-fase (2026-10-04): `?phase=<nama>` menjalankan TEPAT satu fase
  // tanpa rotasi/deferred/anti-starvation — penjadwal (Worker) yang memegang
  // urutan. Tanpa parameter: perilaku lama (rotasi 3 fase/run) tetap utuh
  // untuk pemanggilan manual dan kompatibilitas.
  const phaseParam = request.nextUrl.searchParams.get("phase");
  const forcedPhase: CronPhase | null = phaseParam == null ? null : phaseName(phaseParam);
  // `continue=1`: potongan lanjutan sweep katalog dalam tick yang sama —
  // hanya sync; order/reconcile/delivery/saldo sudah dikerjakan potongan
  // pertama sehingga tidak diulang (hemat CPU + panggilan upstream).
  // `part` (2026-10-04, hanya fase WR/SK): `orders` = order/reconcile/
  // delivery/saldo TANPA sync katalog; `sync` = sync katalog saja (+ watchdog
  // + pemenang pasangan). Insiden 4 Okt 02:00–05:20 WIB: request fase WR/SK
  // gabungan tetap dibunuh `exceededResources`; memisahkan order dari sync
  // menjamin order lunas tetap diteruskan ke supplier walau sync kena limit.
  const partParam = request.nextUrl.searchParams.get("part");
  const part: "orders" | "sync" | null = partParam === "orders" || partParam === "sync" ? partParam : null;
  const isContinue = request.nextUrl.searchParams.get("continue") === "1";
  const syncOnly = forcedPhase != null && (isContinue || part === "sync");
  const ordersOnly = forcedPhase != null && part === "orders";
  if (phaseParam != null && forcedPhase == null) {
    return NextResponse.json({ error: "invalid_phase" }, { status: 400 });
  }
  if (partParam != null && (part == null || (forcedPhase !== "warung_rebahan" && forcedPhase !== "sekalipay"))) {
    return NextResponse.json({ error: "invalid_part" }, { status: 400 });
  }

  const runStartedAt = Date.now();
  // PENANDA LANGKAH (2026-10-04): satu baris log per langkah, tanpa D1. Saat
  // runtime membunuh request (`exceededResources`), `wrangler pages deployment
  // tail` memperlihatkan langkah TERAKHIR yang sempat jalan → bagian mana yang
  // boros CPU. Hanya di mode `?phase=` (pemanggilan cron Worker).
  const stepTag = forcedPhase ? `${forcedPhase}${part ? `:${part}` : ""}${isContinue ? ":cont" : ""}` : "rotation";
  const step = (name: string) => {
    if (forcedPhase) console.log(`[cron] ${stepTag} step=${name} t=${Date.now() - runStartedAt}ms`);
  };
  step("auth_ok");
  /** Sisa waktu invocation (ms) sebelum deadline lunak. */
  const timeLeftMs = () => RUN_DEADLINE_MS - (Date.now() - runStartedAt);
  const results = createOperationsResults();

  try {
    // Fase + budget (review R12): baca fase, hitung antrean tiap cabang
    // (1 query/cabang, murah), lalu eksekusi sesuai prioritas:
    // deferred-dulu → fase-giliran → sisanya bila budget cukup.
    const budget = createBudgetedDatabase(QUERY_BUDGET, RESERVE_TAIL);
    const database = budget.access;
    const { queryAll, queryFirst, execRun } = database;
    const deferredOut: CronPhase[] = [];
    const { phase: storedPhase, deferred: storedDeferred } = forcedPhase
      ? { phase: forcedPhase, deferred: [] as CronPhase[] }
      : await readCronPhase(database);
    if (forcedPhase) results.phase = forcedPhase;
    if (part) results.part = part;

    if (!forcedPhase) await advanceCronPhase(storedPhase, database);
    await writeCronHeartbeat(execRun);

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
    // Mode satu-fase: watchdog cukup dievaluasi di fase WR (sekali per tick),
    // bukan di setiap request fase lain.
    step("phase_state");
    if (!forcedPhase || (forcedPhase === "warung_rebahan" && !ordersOnly && !isContinue)) try {
      const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
      if (isWrEnabled()) {
        const staleRow = await queryFirst(
          `SELECT created_at FROM wr_sync_log
           WHERE sync_type='products' AND status IN ('success','partial')
           ORDER BY created_at DESC LIMIT 1`,
        ).catch(() => null);
        if (typeof staleRow?.created_at === "string") {
          results.wr_last_sync_at = String(staleRow.created_at);
          const { alertStaleWrSync, WR_SYNC_STALE_ALERT_MINUTES } = await import("@/lib/warung-rebahan/order");
          // Kiriman diff VPS tidak menulis wr_sync_log (2026-10-04). Bila log
          // sweep tampak basi tapi diff masih sehat, katalog TIDAK basi —
          // pakai penanda diff agar watchdog tidak alarm palsu.
          let freshness = String(staleRow.created_at);
          const { parseExpiry: parseWatch } = await import("@/lib/expiry");
          const logTs = parseWatch(freshness);
          if (logTs != null && logTs < Date.now() - WR_SYNC_STALE_ALERT_MINUTES * 60 * 1000) {
            const { readDiffStatus } = await import("@/lib/supplier/diff-status");
            const diff = await readDiffStatus(queryAll, "wr_sync_state");
            if (diff.healthy && diff.last_at) freshness = diff.last_at;
          }
          results.wr_sync_stale_alerted = await alertStaleWrSync(
            freshness,
            typeof results.wr_sync_skipped === "string" ? String(results.wr_sync_skipped) : "pre_phase",
            database,
          );
        }
      }
    } catch { /* watchdog tak boleh menggagalkan run */ }

    // Forced requests probe only their own phase. Legacy rotation retains all
    // queue signals for admission, deferred work and anti-starvation.
    step("watchdog_done");
    const queueSql = operationQueueProbeSql(forcedPhase, QRIS_EXPIRY_NOTICE_WHERE, WEB_PAID_ADMIN_PENDING_WHERE);
    const queueRow = queueSql ? await queryFirst(queueSql).catch(() => null) : null;
    const probeWr = forcedPhase == null || forcedPhase === "warung_rebahan";
    const probeSk = forcedPhase == null || forcedPhase === "sekalipay";
    // DB lama tanpa tabel WR: query terpisah gagal → 0 (bukan null-kan semua).
    const wrDueRow = probeWr ? await queryFirst(
      `SELECT COUNT(*) AS wr_due FROM wr_order_links
       WHERE status IN ('pending','retry') AND attempt_count < max_attempts
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ).catch(() => null) : null;
    // Antrean delivery kredensial + blocked_balance (P0-6/P1-8): fase WR
    // tetap aktif selama ada pekerjaan ini walau order kosong. Baris 'sending'
    // dengan lease kedaluwarsa IKUT dihitung (2026-09-18): tanpa itu, delivery
    // yang ditinggalkan run yang dibunuh tidak pernah mengaktifkan fase WR.
    const wrDeliveryRow = probeWr && !syncOnly ? await queryFirst(
      `SELECT COUNT(*) AS wr_delivery_due FROM wr_order_links
       WHERE (delivery_status IN ('queued','failed')
              OR delivery_status='sending')
         AND COALESCE(delivery_last_error,'')!='legacy_whatsapp_manual_handover'
         AND (delivery_next_attempt_at IS NULL
              OR datetime(delivery_next_attempt_at) <= datetime('now'))`,
    ).catch(() => null) : null;
    const wrBlockedRow = probeWr && !syncOnly ? await queryFirst(
      `SELECT COUNT(*) AS wr_blocked FROM wr_order_links WHERE status='blocked_balance'`,
    ).catch(() => null) : null;
    // Antrean SK (0049): SATU query gabungan dengan dua subselect murah
    // (bukan 2 query) agar hitungan antrean tidak memakan slot budget cron
    // (pelajaran R12: tiap query depan mengusir 1 order expiry per run).
    // DB pre-0049: query gagal → null → pending 0 (pola wrDueRow pre-0027).
    // Hemat: SK mati (default) = NOL query — hitungan hanya dibayar bila
    // SEKALIPAY_ENABLED=true (test R12 tanpa SK kembali ke baseline).
    const skQueueRow = probeSk && process.env.SEKALIPAY_ENABLED === "true"
      ? await queryFirst(
          `SELECT
             (SELECT COUNT(*) FROM sk_order_links
              WHERE status IN ('pending','retry') AND attempt_count < max_attempts
                AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))) AS sk_due,
             (SELECT COUNT(*) FROM sk_order_links WHERE status='blocked_balance') AS sk_blocked`,
        ).catch(() => null)
      : null;
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
    const pendingWa = Number(queueRow?.wa ?? 0);
    const pendingStaleWa = Number(queueRow?.wa_stale ?? 0);
    const pendingJobs = Number(queueRow?.jobs ?? 0);
    const pendingCreated = Number(queueRow?.created ?? 0);
    const pendingPaid = Number(queueRow?.paid ?? 0);
    const pendingPaidAdmin = Number(queueRow?.paid_admin ?? 0);
    const pendingPaidAdminWeb = Number(queueRow?.paid_admin_web ?? 0);
    const pendingPinEmail = Number(queueRow?.pin_due ?? 0);
    const pendingStale = Number(queueRow?.stale ?? 0);
    // pendingNotify = seluruh jenis pekerjaan notifikasi (RR3-09).
    const pendingNotify = pendingCreated + pendingPaid + pendingPaidAdmin + pendingPaidAdminWeb;
    const pendingWrDue = wrTablesReady ? Number(wrDueRow?.wr_due ?? 0) : 0;
    const pendingWrDelivery = wrDeliveryReady ? Number(wrDeliveryRow?.wr_delivery_due ?? 0) : 0;
    const pendingWrBlocked = wrTablesReady ? Number((wrBlockedRow as Record<string, unknown> | null)?.wr_blocked ?? 0) : 0;
    const pendingWrAny = pendingWrDue + pendingWrDelivery + pendingWrBlocked;
    // SK: fase aktif selama ada order due/blocked (pola WR di atas).
    const skTablesReady = skQueueRow != null;
    const pendingSkDue = skTablesReady ? Number(skQueueRow?.sk_due ?? 0) : 0;
    const pendingSkBlocked = skTablesReady ? Number(skQueueRow?.sk_blocked ?? 0) : 0;
    const pendingSkAny = pendingSkDue + pendingSkBlocked;

    // Urutan eksekusi: kebijakan murni di @/lib/cron/scheduling (3C);
    // probe async + eksekusi tetap di route ini.
    const { ordered, activePhases } = initialSchedule(
      { forcedPhase, storedPhase, storedDeferred, pendingJobs, pendingSkAny, skEnabled: process.env.SEKALIPAY_ENABLED === "true" },
      deferredOut,
    );
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
    const wrEverSyncedProbe = !forcedPhase && wrTablesReady ? await queryFirst(
      `SELECT 1 AS x FROM wr_sync_log WHERE sync_type='products' LIMIT 1`,
    ).catch(() => null) : null;
    if (wrEverSyncedProbe) {
      const wrStale = await queryFirst(
        `SELECT created_at FROM wr_sync_log WHERE sync_type='products'
         ORDER BY id DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry((wrStale as Record<string, unknown> | null)?.created_at);
      if (lastTs == null || isStalePromotion(lastTs, Date.now())) {
        promoteStalePhase(ordered, activePhases, deferredOut, "warung_rebahan", true);
      }
    }

    // Jaminan anti-starvation SK (0049, pola WR di atas): fase baru tidak
    // boleh kelaparan selamanya di luar 3 slot. Syarat: SK pernah sync +
    // sync terakhir >45 menit + ada pekerjaan SK menunggu.
    const skEverSyncedProbe = !forcedPhase && skTablesReady ? await queryFirst(
      `SELECT 1 AS x FROM sk_sync_log WHERE sync_type='products' LIMIT 1`,
    ).catch(() => null) : null;
    if (skEverSyncedProbe && pendingSkAny > 0) {
      const skStale = await queryFirst(
        `SELECT created_at FROM sk_sync_log WHERE sync_type='products'
         ORDER BY id DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry: parseSkExpiry } = await import("@/lib/expiry");
      const skLastTs = parseSkExpiry((skStale as Record<string, unknown> | null)?.created_at);
      if (skLastTs == null || isStalePromotion(skLastTs, Date.now())) {
        promoteStalePhase(ordered, activePhases, deferredOut, "sekalipay", false);
      }
    }

    step("queues_counted");
    const waWorkPending = pendingWa + pendingStaleWa;
    const ctx = createOperationsContext({
      budget, database, results, deferredOut, activePhases, timeLeftMs, step,
      counts: {
        pendingExpiry, pendingExpiryAny, pendingExpiryManualWa, pendingJobs, pendingStale, pendingNotify,
        pendingCreated, pendingPaid, pendingPaidAdmin, pendingPaidAdminWeb, pendingPinEmail, pendingQrisNotice,
        pendingStaleWa, pendingWa, waWorkPending, pendingWrAny, pendingWrDue, pendingSkAny, pendingSkDue,
      },
      flags: { forcedPhase, part, syncOnly, ordersOnly, wrTablesReady, skTablesReady },
    });
    const { hasTime } = ctx;
    const runExpiry = async () => {
      let marketRestocked = false;
      const onMarketChanged = () => { marketRestocked = true; };
      const expiryOpts = { onMarketChanged };
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
           WHERE ${STALE_INITIALIZING_SQL} AND o.status='pending'
           LIMIT ?`,
          EXPIRY_PER_RUN,
        );
        expiredCandidates = await queryAll(
          `SELECT pt.order_code, pt.provider, pt.provider_order_id, pt.merchant_id,
                  COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at) AS expires_at,
                  pt.status, o.items, o.telegram_chat_id
           FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status='pending'
             AND julianday(COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at))<=julianday('now')
           ORDER BY julianday(COALESCE(CASE WHEN pt.provider IN ('dana','gopay') THEN o.expires_at END,pt.expires_at)) ASC
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

            const changed = await rawTransitionPendingPaymentOrder({
              orderCode: String(tx.order_code),
              expectedTransactionStatus: "initializing",
              staleInitializingOnly: true,
              transactionStatus: "failed",
              orderStatus: "dibatalkan",
              paymentStatus: "failed",
              items,
              lastError: "stale_initializing",
            }, database.d1, expiryOpts);
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

            const changed = await rawTransitionPendingPaymentOrder({
              orderCode: String(tx.order_code),
              expectedTransactionStatus: "pending",
              transactionStatus: "expired",
              expiredOnly: true,
              orderStatus: "kadaluarsa",
              paymentStatus: "expired",
              items,
            }, database.d1, expiryOpts);
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
          `SELECT pt.order_code, pt.status AS tx_status
           FROM payment_transactions pt
           JOIN orders o ON o.code=pt.order_code
           WHERE pt.status IN ('pending','initializing')
             AND o.status IN ('kadaluarsa','dibatalkan')
             AND ${FAST_EXPIRY_RAILS_SQL}
           LIMIT ?`,
          EXPIRY_PER_RUN,
        );

      } else if (pendingExpiry > EXPIRY_PER_RUN && !deferredOut.includes("expiry")) {
        deferredOut.push("expiry");
      }
      // Deklarasi dipulihkan (terpotong saat edit RR4-06): loop stranded di bawah.
      let repairedLegacy = 0;
      for (const row of strandedCandidates) {
        if (!budget.fits(1)) break;
        try {
          // Never touch stock for a terminal order. Recheck the rail and order
          // under the write; known charges stay available for late review.
          const closed = await execRun(
            `UPDATE payment_transactions AS pt
               SET status=?, last_error='legacy_expiry_repair', updated_at=datetime('now')
               WHERE order_code=? AND status=? AND ${FAST_EXPIRY_RAILS_SQL}
                 AND EXISTS(SELECT 1 FROM orders o WHERE o.code=pt.order_code AND o.status IN ('kadaluarsa','dibatalkan'))`,
            String(row.tx_status) === "initializing" ? "failed" : "expired",
            String(row.order_code),
            String(row.tx_status),
          );
          if (closed.changes) repairedLegacy++;
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

          await rawTransitionPendingOrder(String(order.code), "kadaluarsa", null, items, database.d1, expiryOpts);
          expiredStaticCount++;
        } catch { /* another worker may have transitioned it */ }
      }
      results.expired_manual_whatsapp_orders = expiredStaticCount;

      if (marketRestocked && budget.fits(1)) {
        const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
        await bumpCatalogRevision("market", database, { metered: true });
      }

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
        const notices = await sendQrisExpiryNotifications(15, database, { hasTime: () => hasTime(TIME_EXPIRY_NOTICE) });
        results.qris_expiry_notifications = notices.sent;
        if (noticeCount > Number(results.qris_expiry_notifications) && !deferredOut.includes("notify")) deferredOut.push("notify");
      } else if (noticeCount > 0 && !deferredOut.includes("notify")) deferredOut.push("notify");
      // === FASE NOTIFY: notifikasi TG + reminder + outbox WA ===
      // RR3-09: retry notifikasi mencakup created + paid buyer + paid admin
      // (hitung pendingNotify di atas = ketiganya). Daftar dibaca HANYA bila
      // fase notify aktif DAN antrean jenis itu > 0 (RR3-01: tanpa guard ini,
      // 3 list kosong × tiap run = 12 query baca yang mengusir job kirim).
      // Biaya konservatif: 1 list + per order 4 (baca+validasi+kirim+tandai).
      if (activePhases.has("notify") && pendingNotify > 0) {
        // Workers Paid: the per-item budget check below is the real bound;
        // do not pre-reject the whole batch by an assumed unit count when the
        // queue size is unknown.
        if (hasTime(TIME_TELEGRAM_BATCH)) {
          const telegramNotifications = await retryPendingTelegramNotifications(FULFILLMENT_PER_RUN, {
            created: pendingCreated > 0, paid: pendingPaid > 0, paidAdmin: pendingPaidAdmin > 0, paidAdminWeb: pendingPaidAdminWeb > 0,
          }, database, hasTime);

          results.telegram_order_notifications_retried = telegramNotifications.created;
          results.telegram_paid_notifications_retried = telegramNotifications.paid;
          results.telegram_paid_admin_notifications_retried = telegramNotifications.paidAdmin;
          results.telegram_paid_admin_web_notifications_retried = telegramNotifications.paidAdminWeb;
        } else {
          deferredOut.push("notify");
        }
      } else if (pendingNotify > 0 && !activePhases.has("notify")) {
        deferredOut.push("notify");
      }

      // RR3-05: sapu invoice Telegram yang fotonya belum sampai (marker
      // telegram_invoice_sent_at IS NULL + ledger pending). Satu foto ulang
      // per order, tanpa order/invoice/reservasi/stok kedua. Workers Paid:
      // cap 12 -> 25; the per-order canSpend guard inside bounds the run.
      if (activePhases.has("notify")) {
        if (hasTime(TIME_TELEGRAM_BATCH)) {
          try {
            const invoiceSent = await retryInvoicePendingTelegramInvoices(25, database);

            results.telegram_invoice_retried = invoiceSent;
          } catch { /* cron berikutnya retry */ }
        } else if (!deferredOut.includes("notify")) {
          deferredOut.push("notify");
        }
      }

      if (activePhases.has("notify")) {
        if (hasTime(TIME_TELEGRAM_BATCH)) {
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
        const waUnits = Math.min(WA_OUTBOX_PER_RUN, Math.max(pendingWa, pendingStaleWa > 0 ? 1 : 0));
        if (budget.fits(COST_PER_WA_RECOVERY + waUnits * COST_PER_WA_ROW) && hasTime(TIME_WA_BATCH)) {
          try {
            const waOutbox = await processDueWhatsAppOutbox(WA_OUTBOX_PER_RUN, database);

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

      // Sapu bounded antrean PIN checkout (maks 15, jeda 1 dtk antaremail) bila fase notify
      // aktif dan budget/waktu tersisa; tanpa job/trigger/budget baru.
      if (pendingPinEmail > 0 && activePhases.has("notify") && budget.fits(10) && hasTime(9_000)) {
        try {
          const { processCredentialAccessEmails } = await import("@/lib/orders/access-email");
          const pin = await processCredentialAccessEmails(database, 15, undefined, { hasTime });
          results.checkout_pin_emails_sent = pin.sent;
          results.checkout_pin_emails_failed = pin.failed;
        } catch { if (!deferredOut.includes("notify")) deferredOut.push("notify"); }
      }

    };
    const runFulfillment = () => runFulfillmentPhase(ctx);
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
      if (!syncOnly) {
        try {
          const { replayWrFinalSettlement } = await import("@/lib/warung-rebahan/final-settlement");
          results.wr_final_settlement = await replayWrFinalSettlement(database);
        } catch {
          results.wr_final_settlement_error = true;
          if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
        }
      }
      if (!budget.fits(COST_PER_WR_WORK)) {
        if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
        return;
      }
      try {
        step("wr_import_start");
        const { syncProducts, WR_SYNC_PRODUCTS_PER_RUN } = await import("@/lib/warung-rebahan/sync");
        const { processWrPendingOrders, retryFailedWrOrders, reconcileStuckWrOrders, reconcileBlockedBalance, recoverStaleClaims, reconcileMissingWrLinks, alertAgingWrOrders } = await import("@/lib/warung-rebahan/order");
        const { processDueCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
        const { checkAndLogSaldo } = await import("@/lib/warung-rebahan/saldo");
        step("wr_import_done");
        const syncOn = process.env.WARUNG_REBAHAN_SYNC_ENABLED !== "false";
        const autoOrder = process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true";

        // 0. Recover lease basi (worker crash) + pulihkan blocked_balance
        //    setelah top-up — murah, selalu jalan bila fase aktif.
        if (!syncOnly && budget.fits(4)) {
          try {
            await recoverStaleClaims(database);
            await reconcileBlockedBalance(database);
          } catch { /* best-effort */ }
        }

        // 1. Kapasitas ORDER diprioritaskan SEBELUM sync produk (P0-4):
        //    sync katalog besar tidak boleh membuat WR order starvation.
        //    Probe yatim lunas-tanpa-link jalan DULUAN tanpa gate pendingWrDue
        //    (2026-10-09, kasus AXV-20261009-DA1A****): link yang gagal dibuat
        //    webhook + COUNT due = 0 membuat gate di bawah tidak pernah
        //    menyala bila probe ikut di dalamnya. Murah (1 SELECT indeks
        //    lunas + INSERT OR IGNORE idempoten); hasilnya ikut membuka gate.
        step("wr_recover_done");
        if (!syncOnly && autoOrder && budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_NETWORK)) {
          try {
            const healed = await reconcileMissingWrLinks(database);
            if (healed.links > 0) results.wr_orphan_links_healed = healed.links;
          } catch { /* best-effort; gate due di bawah tetap jalan */ }
        }
        if (!syncOnly && autoOrder && (pendingWrDue > 0 || Number(results.wr_orphan_links_healed ?? 0) > 0) && budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_NETWORK)) {
          try {
            await retryFailedWrOrders(database);
            const processed = await processWrPendingOrders(database, { skipOrphanProbe: true });
            results.wr_orders_processed = processed.processed;
            results.wr_orders_succeeded = processed.succeeded;
            results.wr_orders_blocked = processed.blocked;
            if (processed.finalDeferred) results.wr_final_dispatch_deferred = true;
            results.wr_orders_reconciled = (processed.reconciled ?? 0) + Number(results.wr_orders_reconciled ?? 0);
            if (processed.processed > processed.succeeded && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
          } catch { if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan"); }
        }

        // 2. Product & stock sync — tiap 30 menit, RESUMABLE via cursor
        //    (P0-4): katalog lebih besar dari budget maju lintas invocation.
        //    Sweep penuh 48 produk memakan ~10 s (lihat wr_sync_log
        //    duration_ms): wajib punya sisa waktu, kalau tidak run dipotong
        //    platform sebelum log/penanda tertulis.
        step("wr_orders_done");
        if (ordersOnly) {
          // part=orders: sync katalog dikerjakan request `part=sync` terpisah.
          if (results.wr_sync_skipped == null) results.wr_sync_skipped = "part_orders";
        } else if (!syncOn) {
          // Saklar sync dimatikan eksplisit — bedakan dari "disabled" (master
          // switch / tabel belum siap) agar diagnosa env tepat sasaran.
          if (results.wr_sync_skipped == null) results.wr_sync_skipped = "sync_disabled";
        } else if (budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_NETWORK)) {
          const lastSync = await queryFirst(
            `SELECT created_at FROM wr_sync_log
             WHERE sync_type='products' AND status IN ('success','partial')
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const thirtyMinAgo = new Date(Date.now() - CATALOG_SYNC_INTERVAL_MS).toISOString();
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
          void thirtyMinAgo;
          if (resumeNow || await catalogSweepDue("wr_sync_state", lastTs, queryAll)) {
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
                maxProducts: forcedPhase ? WR_CRON_CHUNK : WR_SYNC_PRODUCTS_PER_RUN,
                trigger: "cron",
                // Potongan dari proxy VPS: Pages tidak mem-parse katalog penuh.
                useProxySlices: forcedPhase != null,
                timeBudgetMs: Math.max(0, timeLeftMs() - TIME_WR_SWEEP_RESERVE),
              });
              // WR3: sync katalog Jaspay milik Pages (terpisah dari sweep
              // premium di atas; tanpa cron/flag baru). Bounded: berhenti
              // bila budget/waktu tak muat; premium tak tersentuh.
              if (syncOn && budget.fits(COST_PER_WR_WORK) && hasTime(TIME_WR_LIGHT)) {
                try {
                  const { syncJaspayCatalog } = await import("@/lib/warung-rebahan/sync");
                  const jaspay = await syncJaspayCatalog(database);
                  if (jaspay.synced > 0 || jaspay.rejected > 0) {
                    results.wr_jaspay_synced = jaspay.synced;
                    if (jaspay.rejected > 0) results.wr_jaspay_rejected = jaspay.rejected;
                  }
                  if (jaspay.errors.length && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
                } catch { /* best-effort; sweep premium di atas tetap tercatat */ }
              }
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
                // Mode satu-fase: sinyal ke Worker untuk memanggil potongan
                // berikutnya dalam tick yang sama.
                results.more = true;
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

        step("wr_sync_done");
        // part=sync / potongan lanjutan: cukup sync — langkah order dikerjakan
        // request `part=orders` (atau potongan pertama mode lama).
        if (syncOnly) return;

        // 3. Reconcile processing/ambigu menggantung >1 jam via /transactions.
        if (autoOrder && budget.fits(3) && hasTime(TIME_WR_LIGHT)) {
          try {
            results.wr_orders_reconciled = Number(results.wr_orders_reconciled ?? 0) + await reconcileStuckWrOrders(database);
          } catch { /* best-effort; run berikutnya retry */ }
        }

        // 3a. Reconcile FRESH processing links (2026-10-03, kasus F111FD64):
        //     webhook order.completed WR sering TIDAK SAMPAI (event terakhir
        //     28 Sep untuk order 3 Okt), padahal dashboard WR sudah COMPLETED
        //     hitungan menit setelah lunas. Tanpa ini buyer menunggu 1 jam
        //     (ambang reconcile lama) untuk kredensial yang sudah ada.
        //     Dibatasi: hanya link processing umur >3 menit (beri webhook
        //     kesempatan datang dulu — hemat 1 panggilan /transactions bila
        //     webhook sehat) + umur <1 jam (MBO lama ditangani langkah 3,
        //     urutan acak, agar tidak menyumbat slot link baru — 2026-10-04)
        //     + maks 6 link/run + budget/waktu sama. Read-only
        //     upstream + idempoten; SK tidak tersentuh (fase terpisah).
        if (autoOrder && budget.fits(4) && hasTime(TIME_WR_LIGHT)) {
          try {
            const { reconcileFreshWrLinks } = await import("@/lib/warung-rebahan/order");
            const fresh = await database.queryAll(
              `SELECT id, wr_order_id, order_code FROM wr_order_links
               WHERE status='processing'
                 AND datetime(COALESCE(request_sent_at, updated_at)) <= datetime('now','-3 minutes')
                 AND datetime(COALESCE(request_sent_at, updated_at)) > datetime('now','-1 hour')
               ORDER BY request_sent_at ASC, id ASC LIMIT 6`,
            ).catch(() => [] as { id: unknown; wr_order_id: unknown; order_code: unknown }[]);
            if (fresh.length) {
              const reconciled = await reconcileFreshWrLinks(
                fresh.map((row) => ({
                  id: Number(row.id),
                  wr_order_id: String(row.wr_order_id || ""),
                  order_code: String(row.order_code || ""),
                })),
                database,
              );
              results.wr_orders_reconciled = Number(results.wr_orders_reconciled ?? 0) + reconciled;
              results.wr_orders_reconciled_fresh = reconciled;
            }
          } catch { /* best-effort; run berikutnya retry */ }
        }

        // 3a'. Self-heal link completed yang belum terikat item (kredensial
        //      formatter lama / panel kosong, kasus F111FD64). Read-only
        //      upstream, tanpa kirim ulang; berhenti sendiri setelah terikat.
        if (autoOrder && budget.fits(4) && hasTime(TIME_WR_LIGHT)) {
          try {
            const { repairUnboundCompletedWrLinks } = await import("@/lib/warung-rebahan/order");
            results.wr_links_repaired = await repairUnboundCompletedWrLinks(database);
          } catch { /* best-effort */ }
        }

        // 3a''. WR3 Jaspay ambigu (bounded, fase WR yang sama — bukan cron
        //      baru): exact-ref POST identik / poll invoice JSP dikenal.
        if (autoOrder && budget.fits(6) && hasTime(TIME_WR_LIGHT)) {
          try {
            const { reconcileJaspayAmbiguous } = await import("@/lib/warung-rebahan/order");
            const healed = await reconcileJaspayAmbiguous(database, 4);
            if (healed.exactRef > 0) results.wr_jaspay_exact_ref = healed.exactRef;
            if (healed.polled > 0) results.wr_jaspay_polled = healed.polled;
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
        if (!ordersOnly && budget.fits(4) && typeof results.wr_last_sync_at === "string") {
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
            const { requeueOrphanCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
            const requeued = await requeueOrphanCredentialDeliveries(database);
            if (requeued > 0) results.wr_credentials_requeued = requeued;
            const delivery = await processDueCredentialDeliveries(database);
            results.wr_deliveries_processed = delivery.processed;
            results.wr_deliveries_delivered = delivery.delivered;
            results.wr_deliveries_lease_recovered = delivery.recovered;
            if (delivery.processed > delivery.delivered && !deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
          } catch { /* best-effort */ }
        }

        // 4. Saldo check — tiap 10 menit (Paid plan).
        if (budget.fits(3) && hasTime(TIME_WR_LIGHT)) {
          const lastCheck = await queryFirst(
            `SELECT created_at FROM wr_saldo_log WHERE source='api_check'
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const { parseExpiry } = await import("@/lib/expiry");
          const lastTs = parseExpiry(lastCheck?.created_at);
          if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
            try {
              const saldo = await checkAndLogSaldo(database);
              results.wr_saldo_balance = saldo.balance;
              results.wr_saldo_low = saldo.isLow;
            } catch { /* API down: sync berikutnya retry; bukan deferred */ }
          }
        }
        step("wr_tail_done");
      } catch {
        if (!deferredOut.includes("warung_rebahan")) deferredOut.push("warung_rebahan");
      }
    };
    const runCleanup = () => runCleanupPhase(ctx);

    const runSekalipay = async () => {
      // === FASE SEKALIPAY: sync produk + order pending + saldo ===
      // Cermin fase WR dengan scope lebih kecil (fase 1: katalog premium +
      // varian auto saja). No-op total bila master switch mati atau tabel SK
      // belum ada (DB pre-0049): jangan bakar budget, jangan deferred palsu.
      const { isSkEnabled } = await import("@/lib/sekalipay/client");
      if (!isSkEnabled() || !skTablesReady) {
        if (results.sk_sync_skipped == null) results.sk_sync_skipped = "disabled";
        return;
      }
      try {
        const lastSyncRow = await queryFirst(
          `SELECT created_at FROM sk_sync_log
           WHERE sync_type='products' AND status IN ('success','partial')
           ORDER BY created_at DESC LIMIT 1`,
        ).catch(() => null);
        if (typeof lastSyncRow?.created_at === "string") results.sk_last_sync_at = String(lastSyncRow.created_at);
      } catch { /* last_sync_at best-effort */ }
      if (!activePhases.has("sekalipay")) {
        if (pendingSkAny > 0 && !deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
        if (results.sk_sync_skipped == null) results.sk_sync_skipped = "phase_inactive";
        return;
      }
      if (!budget.fits(COST_PER_SK_WORK)) {
        if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
        return;
      }
      try {
        step("sk_import_start");
        const { syncSkProducts, SK_SYNC_PRODUCTS_PER_RUN } = await import("@/lib/sekalipay/sync");
        const { processSkPendingOrders, retryFailedSkOrders, reconcileStuckSkOrders, reconcileBlockedSkBalance, recoverStaleSkClaims, reconcileMissingSkLinks } = await import("@/lib/sekalipay/order");
        const { checkAndLogSkSaldo } = await import("@/lib/sekalipay/saldo");
        step("sk_import_done");
        const syncOn = process.env.SEKALIPAY_SYNC_ENABLED !== "false";
        const autoOrder = process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true";

        // 0. Recover lease basi + pulihkan blocked_balance setelah top-up.
        if (!syncOnly && budget.fits(4)) {
          try {
            await recoverStaleSkClaims(database);
            await reconcileBlockedSkBalance(database);
          } catch { /* best-effort */ }
        }

        // 1. Order didahulukan sebelum sync (pola WR P0-4). Probe yatim
        //    lunas-tanpa-link tanpa gate pendingSkDue (cermin WR 2026-10-09).
        if (!syncOnly && autoOrder && budget.fits(COST_PER_SK_WORK) && hasTime(TIME_SK_NETWORK)) {
          try {
            const healed = await reconcileMissingSkLinks(database);
            if (healed.links > 0) results.sk_orphan_links_healed = healed.links;
          } catch { /* best-effort; gate due di bawah tetap jalan */ }
        }
        if (!syncOnly && autoOrder && (pendingSkDue > 0 || Number(results.sk_orphan_links_healed ?? 0) > 0) && budget.fits(COST_PER_SK_WORK) && hasTime(TIME_SK_NETWORK)) {
          try {
            await retryFailedSkOrders(database);
            const processed = await processSkPendingOrders(database, { skipOrphanProbe: true });
            results.sk_orders_processed = processed.processed;
            results.sk_orders_succeeded = processed.succeeded;
            if (processed.processed > processed.succeeded && !deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
          } catch { if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay"); }
        }

        step("sk_orders_done");
        // 2. Sync katalog — tiap 15 menit, resumable via cursor. Sweep SK
        //    kecil (24 produk) tapi tetap pakai budget waktu DI DALAM sweep
        //    (pelajaran WR 2026-09-20: admission depan deadlock permanen).
        if (ordersOnly) {
          if (results.sk_sync_skipped == null) results.sk_sync_skipped = "part_orders";
        } else if (!syncOn) {
          if (results.sk_sync_skipped == null) results.sk_sync_skipped = "sync_disabled";
        } else if (budget.fits(COST_PER_SK_WORK) && hasTime(TIME_SK_NETWORK)) {
          const lastSync = await queryFirst(
            `SELECT created_at FROM sk_sync_log
             WHERE sync_type='products' AND status IN ('success','partial')
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const thirtyMinAgo = new Date(Date.now() - CATALOG_SYNC_INTERVAL_MS).toISOString();
          const { parseExpiry } = await import("@/lib/expiry");
          const lastTs = parseExpiry(lastSync?.created_at);
          if (typeof lastSync?.created_at === "string") results.sk_last_sync_at = String(lastSync.created_at);
          const cursorRow = await queryFirst(
            `SELECT value FROM sk_sync_state WHERE key='products_cursor'`,
          ).catch(() => null);
          const resumeNow = Number(cursorRow?.value ?? 0) > 0;
          void thirtyMinAgo;
          if (resumeNow || await catalogSweepDue("sk_sync_state", lastTs, queryAll)) {
            try {
              const syncResult = await syncSkProducts(database, undefined, {
                maxProducts: forcedPhase ? SK_CRON_CHUNK : SK_SYNC_PRODUCTS_PER_RUN,
                trigger: "cron",
                useProxySlices: forcedPhase != null,
                timeBudgetMs: Math.max(0, timeLeftMs() - TIME_WR_SWEEP_RESERVE),
              });
              results.sk_products_synced = syncResult.synced;
              if (syncResult.budgetYielded) {
                results.more = true;
                if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
                if (results.sk_sync_skipped == null) results.sk_sync_skipped = "budget_yielded";
              }
              if (syncResult.errors.length) {
                if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
                results.sk_sync_skipped = "attempted_failed";
                results.sk_sync_errors = syncResult.errors.slice(0, 3);
              }
            } catch { if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay"); }
          } else {
            if (results.sk_sync_skipped == null) results.sk_sync_skipped = "interval";
          }
        } else if (syncOn) {
          if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
          results.sk_sync_skipped = budget.fits(COST_PER_SK_WORK) ? "deadline" : "query_budget";
        }

        step("sk_sync_done");
        if (syncOnly) {
          // Pemenang pasangan WR vs SK = urusan katalog: hitung sekali saat
          // sweep SK tuntas (bukan tiap potongan).
          if (part === "sync" && results.more !== true && budget.fits(4) && hasTime(TIME_SK_LIGHT)) {
            try {
              const { decideAllWinners } = await import("@/lib/supplier-pairs");
              const pairs = await decideAllWinners(database);
              results.pairs_decided = pairs.decided;
              results.pairs_changed = pairs.changed;
            } catch { /* best-effort; sweep berikut retry */ }
            step("sk_pairs_done");
          }
          return;
        }

        // 3. Reconcile processing/ambigu menggantung >1 jam via GET /v1/trx.
        if (autoOrder && budget.fits(3) && hasTime(TIME_SK_LIGHT)) {
          try {
            results.sk_orders_reconciled = await reconcileStuckSkOrders(database);
          } catch { /* best-effort */ }
        }

        // 3a. Reconcile FRESH (2 mnt–1 jam): SK auto selesai hitungan detik,
        //     jadi webhook completed yang hilang tidak boleh membuat pembeli
        //     (terutama Telegram) menunggu ambang 1 jam di langkah 3.
        if (autoOrder && budget.fits(4) && hasTime(TIME_SK_LIGHT)) {
          try {
            const { reconcileFreshSkOrders } = await import("@/lib/sekalipay/order");
            results.sk_orders_reconciled_fresh = await reconcileFreshSkOrders(database);
          } catch { /* best-effort */ }
        }

        // 3b. Email kredensial SK yang tertunda (mis. Resend sempat mati saat
        // webhook completed): kirim ulang yang due, bounded. Tanpa ini order
        // SK lunas-terkirim-panel tapi buyer tidak pernah dapat email kredensial.
        if (budget.fits(4) && hasTime(TIME_SK_LIGHT)) {
          try {
            const { reconcilePendingSkCredentialEmails } = await import("@/lib/sekalipay/deliver");
            results.sk_credential_emails_sent = await reconcilePendingSkCredentialEmails(database);
          } catch { /* run berikutnya mencoba lagi */ }
        }

        // 4. Saldo check — tiap 10 menit (Paid plan).
        if (budget.fits(3) && hasTime(TIME_SK_LIGHT)) {
          const lastCheck = await queryFirst(
            `SELECT created_at FROM sk_saldo_log WHERE source='api_check'
             ORDER BY created_at DESC LIMIT 1`,
          ).catch(() => null);
          const { parseExpiry } = await import("@/lib/expiry");
          const lastTs = parseExpiry(lastCheck?.created_at);
          if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
            try {
              const saldo = await checkAndLogSkSaldo(database);
              results.sk_saldo_balance = saldo.balance;
              results.sk_saldo_low = saldo.isLow;
            } catch { /* API down: sync berikutnya retry; bukan deferred */ }
          }
        }

        // 5. Pemenang pasangan WR vs SK (migrasi 0053, keputusan owner
        //    2026-09-30): hitung ulang tiap fase SK aktif — murah (4 query
        //    ringan per pasangan), best-effort, 1 gagal tidak hentikan lain.
        //    Volatilitas stok ditangani karena dihitung dari stok+modal LIVE.
        step("sk_tail_done");
        if (!ordersOnly && budget.fits(4) && hasTime(TIME_SK_LIGHT)) {
          try {
            const { decideAllWinners } = await import("@/lib/supplier-pairs");
            const pairs = await decideAllWinners(database);
            results.pairs_decided = pairs.decided;
            results.pairs_changed = pairs.changed;
          } catch { /* best-effort; sweep berikut retry */ }
        }
      } catch {
        if (!deferredOut.includes("sekalipay")) deferredOut.push("sekalipay");
      }
    };
    const phases = { expiry: runExpiry, notify: runNotify, fulfillment: runFulfillment, warung_rebahan: runWarungRebahan, sekalipay: runSekalipay, cleanup: runCleanup };
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

    step("phases_done");
    // Tail cannot be consumed by helpers: two final statements are reserved.
    budget.beginTail();
    const deferred = [...new Set(deferredOut)];
    if (forcedPhase) {
      // Penanda RUN SELESAI (2026-10-04), terpisah dari heartbeat di depan:
      // heartbeat segar + `cron_last_ok_at` basi = run dibunuh di tengah
      // (mis. `exceededResources`), bukan pemicu mati.
      await execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES ('cron_last_ok_at', datetime('now'), datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')`,
      ).catch(() => undefined);
    } else {
      await writeCronPhase(nextPhase(storedPhase), deferred, database);
    }
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
