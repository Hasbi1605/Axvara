import { operationQueueProbeSql } from "@/lib/cron-queues";

// POST /api/cron/operations — Reconciliation cron for payments and fulfillment
// Called by MCP Worker cron every 5 minutes. Handles:
// 1. Stale initializing payments
// 2. Expired payments/orders
// 3. Due fulfillment jobs
// 4. Stale job locks

import { NextRequest, NextResponse } from "next/server";
import { createBudgetedDatabase, QueryBudgetExceeded } from "@/lib/db-access";
import { catalogSweepDue, CATALOG_SYNC_INTERVAL_MS } from "@/lib/cron/catalog-sweep";
import { createOperationsContext, createOperationsResults } from "@/lib/cron/operations-context";
import { initialSchedule, isStalePromotion, promoteStalePhase } from "@/lib/cron/scheduling";
import { run as runCleanupPhase } from "@/lib/cron/phases/cleanup";
import { run as runWarungRebahanPhase } from "@/lib/cron/phases/warung-rebahan";
import { run as runExpiryPhase } from "@/lib/cron/phases/expiry";
import { run as runNotifyPhase } from "@/lib/cron/phases/notify";
import { run as runFulfillmentPhase } from "@/lib/cron/phases/fulfillment";
import { advanceCronPhase, nextPhase, phaseName, readCronPhase, writeCronHeartbeat, writeCronPhase, type CronPhase } from "@/lib/cron/phase-state";

import { QRIS_EXPIRY_NOTICE_WHERE } from "@/lib/payments/qris-expiry-notifications";
import { WEB_PAID_ADMIN_PENDING_WHERE } from "@/lib/telegram/order-notifications";
import { constantTimeEqual } from "@/lib/security";

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
const WR_SK_BALANCE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

// Sekalipay: biaya admission yang sama dengan WR per unit kerja fase.
const COST_PER_SK_WORK = 8;
const RESERVE_TAIL = 2;
// Potongan sweep per request di mode `?phase=` (Workers Free: ~10 ms CPU per
// request). Insiden 3 Okt 20:25–23:50 WIB: 41 run beruntun dibunuh runtime
// (`exceededResources` → 503) karena SATU request memikul expiry + fulfillment
// + sync WR 49 produk + sync SK 157 varian. Worker kini memanggil fase satu
// per satu dan mengulang fase sync selama respons `more: true`.
const SK_CRON_CHUNK = 25;


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
    const runExpiry = () => runExpiryPhase(ctx);
    const runNotify = () => runNotifyPhase(ctx);
    const runFulfillment = () => runFulfillmentPhase(ctx);
    const runWarungRebahan = () => runWarungRebahanPhase(ctx);
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
