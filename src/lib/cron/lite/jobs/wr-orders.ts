// src/lib/cron/lite/jobs/wr-orders.ts — WR orders job body (3A-7a,
// class E: pure move, no behavior change).
//
// BEFORE: `runWrOrders(db, failedCore)` lived inline in
// src/app/api/cron/lite/route.ts. AFTER: `run({db, failedCore})` owns the
// verbatim body; the route dispatches via dynamic `await import()` on the
// wr_orders branch only. C2 final-settlement replay stays first (after the
// WR enabled gate, outside AUTO_ORDER), then stale/balance recovery,
// orphan probe before due lookup, dispatch, refresh/stuck/Jaspay,
// credential delivery, and the 10-minute saldo check (shared constant).

import { QueryBudgetExceeded } from "@/lib/db-access";
import { monitorRecovery, WR_SK_BALANCE_CHECK_INTERVAL_MS, type LiteContext } from "@/lib/cron/lite/context";

export async function run({ db, failedCore }: LiteContext): Promise<Record<string, unknown>> {

  const { isWrEnabled } = await import("@/lib/warung-rebahan/client");
  if (!isWrEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/warung-rebahan/order");
  const out: Record<string, unknown> = {};
  const recover = monitorRecovery(db, "wr_orders", out, failedCore);
  const { replayWrFinalSettlement } = await import("@/lib/warung-rebahan/final-settlement");
  out.final_settlement = await recover("final_settlement", () => replayWrFinalSettlement(db), null);
  await recover("stale_claims", () => order.recoverStaleClaims(db), 0);
  await recover("blocked_balance", () => order.reconcileBlockedBalance(db, { reportLookupFailure: true }), 0);
  if (process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true") {
    // 2026-10-09 (kasus AXV-20261009-DA1A****): link WR tidak pernah dibuat
    // webhook + COUNT due = 0 → `processWrPendingOrders` tidak dipanggil →
    // `reconcileMissingWrLinks` di dalamnya tidak pernah jalan → yatim
    // selamanya. Probe yatim WAJIB jalan duluan tanpa gate due (murah: 1
    // SELECT indeks lunas + INSERT OR IGNORE idempoten), hasilnya ikut
    // menentukan gate proses di bawah.
    const orphanHealed = await recover("missing_links", () => order.reconcileMissingWrLinks(db), { orders: 0, links: 0 });
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    const due = await recover("due_lookup", () => db.queryFirst(
      `SELECT COUNT(*) AS n FROM wr_order_links
        WHERE status IN ('pending','retry') AND attempt_count < max_attempts
          AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`,
    ), null);
    // Link yatim yang baru dibuat SELALU due (next_attempt_at=now), tapi gate
    // ikut dibuka eksplisit agar tak bergantung pada asumsi itu + hemat 1
    // COUNT berikutnya bila tick ini hanya menyembuhkan.
    if (Number(due?.n ?? 0) > 0 || orphanHealed.links > 0) {
      out.retried = await order.retryFailedWrOrders(db);
      // skipOrphanProbe: probe di atas sudah jalan — probe ganda ikut
      // menghabiskan budget sebelum SELECT antrean (insiden 2026-10-10).
      const processed = await order.processWrPendingOrders(db, { skipOrphanProbe: true });
      out.processed = processed.processed;
      out.succeeded = processed.succeeded;
      if (processed.blocked) out.blocked = processed.blocked;
      if (processed.finalDeferred) out.final_dispatch_deferred = true;
    }
    // Penjamin status segar bersama (2026-10-13): tarik status vendor untuk
    // link yang masih berjalan (berbagi jatah dengan job sk_orders) agar WR
    // secepat SK terasa tanpa menunggu route besar per jam. Gerbang
    // 20 dtk/order di store_settings menjaga biaya tetap; vendor dibaca
    // sekali per tarikan.
    await recover("supplier_refresh", async () => {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 12 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    }, undefined);
    // 2 menit, bukan 1 jam (2026-10-10): webhook WR yang hilang/terputus
    // tidak lagi menahan kredensial varian instan sampai route besar jalan.
    out.reconciled = await recover("stuck_links", () => order.reconcileStuckWrOrders(db, { minAgeMinutes: 2, reportLookupFailure: true }), 0);
    // WR3 Jaspay (bounded, di job wr_orders yang sama — bukan cron baru):
    // link Jaspay ambigu => exact-ref identik / poll invoice dikenal.
    // Premium tak tersentuh; lease existing tetap.
    await recover("jaspay_recovery", async () => {
      const healed = await order.reconcileJaspayAmbiguous(db, 12);
      if (healed.exactRef > 0) out.jaspay_exact_ref = healed.exactRef;
      if (healed.polled > 0) out.jaspay_polled = healed.polled;
    }, undefined);
  }
  const { processDueCredentialDeliveries, requeueOrphanCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
  // Kredensial completed yang tidak pernah diantrekan (completion terputus).
  const requeued = await requeueOrphanCredentialDeliveries(db);
  if (requeued > 0) out.credentials_requeued = requeued;
  const delivery = await processDueCredentialDeliveries(db);
  out.credentials_delivered = delivery.delivered;
  // Paid plan: cek saldo WR maks tiap 10 menit (sebelumnya 60 menit hanya di cron/operations :00).
  if (db.canSpend(5)) {
    try {
      const lastCheck = await db.queryFirst(
        `SELECT created_at FROM wr_saldo_log WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry(lastCheck?.created_at);
      if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
        const { checkAndLogSaldo } = await import("@/lib/warung-rebahan/saldo");
        const saldo = await checkAndLogSaldo(db);
        out.wr_saldo_balance = saldo.balance;
        out.wr_saldo_low = saldo.isLow;
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return out;
}
