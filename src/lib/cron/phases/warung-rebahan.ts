// src/lib/cron/phases/warung-rebahan.ts — operations WR phase
// (3C warung_rebahan, class E: pure move, no behavior change).
//
// BEFORE: `runWarungRebahan` lived inline in src/app/api/cron/operations/route.ts.
// AFTER: `run(ctx)` owns the verbatim body; the route dispatch returns
// this promise directly. The supplier imports stay in-branch in original order.

import { catalogSweepDue, CATALOG_SYNC_INTERVAL_MS } from "@/lib/cron/catalog-sweep";
import type { OperationsContext } from "@/lib/cron/operations-context";
import { supplierSaldoCheckDue } from "@/lib/cron/saldo-check";

const TIME_WR_NETWORK = 14_000;
const TIME_WR_LIGHT = 8_000;
const TIME_WR_SWEEP_RESERVE = 8_000;
const COST_PER_WR_WORK = 8;
const WR_CRON_CHUNK = 10;

export async function run(ctx: OperationsContext): Promise<void> {
  const { budget, database, results, deferredOut, activePhases, hasTime, timeLeftMs, step } = ctx;
  const { syncOnly, ordersOnly, forcedPhase, wrTablesReady } = ctx.flags;
  const { pendingWrAny, pendingWrDue } = ctx.counts;
  const { queryAll, queryFirst, execRun } = database;

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
          if (await supplierSaldoCheckDue(queryFirst, "wr")) {
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
}
