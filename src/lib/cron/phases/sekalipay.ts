// Operations SK phase; supplier imports stay lazy at their original call sites.
import { catalogSweepDue, CATALOG_SYNC_INTERVAL_MS } from "@/lib/cron/catalog-sweep";
import type { OperationsContext } from "@/lib/cron/operations-context";

// Sekalipay (0049): ambang yang sama dengan WR — unit jaringan SK ikut
// deadline 45 dtk + cadangan ekor yang sama agar tidak dipotong platform.
const TIME_SK_NETWORK = 14_000;
const TIME_SK_LIGHT = 8_000;
/**
 * Cadangan waktu yang TIDAK boleh dipakai sweep katalog: sisa langkah fase SK
 * (reconcile, saldo, delivery) + ekor handler yang menulis `sk_sync_log` dan
 * penanda fase. Sweep yang memakan seluruh sisa deadline akan dibunuh
 * platform tepat sebelum hasilnya tercatat — persis pola kegagalan yang
 * membuat sync terlihat "rusak di tengah jalan tanpa sebab".
 */
const TIME_WR_SWEEP_RESERVE = 8_000;

const WR_SK_BALANCE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

// Sekalipay: biaya admission yang sama dengan WR per unit kerja fase.
const COST_PER_SK_WORK = 8;

// Potongan sweep per request di mode `?phase=` (Workers Free: ~10 ms CPU per
// request). Insiden 3 Okt 20:25–23:50 WIB: 41 run beruntun dibunuh runtime
// (`exceededResources` → 503) karena SATU request memikul expiry + fulfillment
// + sync WR 49 produk + sync SK 157 varian. Worker kini memanggil fase satu
// per satu dan mengulang fase sync selama respons `more: true`.
const SK_CRON_CHUNK = 25;

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut, activePhases, hasTime, timeLeftMs, step } = ctx;
  const { part, syncOnly, ordersOnly, forcedPhase, skTablesReady } = ctx.flags;
  const { pendingSkAny, pendingSkDue } = ctx.counts;
  const { queryAll, queryFirst } = database;

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
}
