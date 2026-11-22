import { QueryBudgetExceeded } from "@/lib/db-access";
import { monitorRecovery, WR_SK_BALANCE_CHECK_INTERVAL_MS, type LiteContext } from "@/lib/cron/lite/context";

export async function run({ db, failedCore }: LiteContext): Promise<Record<string, unknown>> {
  const { isSkEnabled } = await import("@/lib/sekalipay/client");
  if (!isSkEnabled()) return { skipped: "disabled" };
  const order = await import("@/lib/sekalipay/order");
  const out: Record<string, unknown> = {};
  const recover = monitorRecovery(db, "sk_orders", out, failedCore);
  // Read-only watchdog is independent of the purchase flag or saturated queue.
  const aging = await recover("aging_alert", () => order.alertAgingSkOrders(db), 0);
  if (aging) out.aging_alerted = aging;
  await recover("stale_claims", () => order.recoverStaleSkClaims(db, { reportLookupFailure: true }), 0);
  await recover("blocked_balance", () => order.reconcileBlockedSkBalance(db, { reportLookupFailure: true }), 0);
  if (process.env.SEKALIPAY_AUTO_ORDER_ENABLED === "true") {
    // Existing due purchases get first use of the budget. Probe orphans once,
    // independently of queue size. If no buys ran, dispatch healed links now;
    // otherwise leave them due for the next tick.
    const processed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
    out.processed = processed.processed;
    out.succeeded = processed.succeeded;
    const exhausted = await recover("exhausted_retries", () => order.settleExhaustedSkRetries(db), 0);
    if (exhausted) out.exhausted_settled = exhausted;
    const orphanHealed = await recover("missing_links", () => order.reconcileMissingSkLinks(db), { orders: 0, links: 0 });
    if (orphanHealed.links > 0) out.orphan_links_healed = orphanHealed.links;
    if (orphanHealed.links > 0 && processed.processed === 0) {
      const healed = await order.processSkPendingOrders(db, { skipOrphanProbe: true });
      out.processed = processed.processed + healed.processed;
      out.succeeded = processed.succeeded + healed.succeeded;
    }
    // Penjamin status segar bersama (cermin WR di atas): SK yang webhook-nya
    // terlambat ikut tertarik di sini, bukan hanya di route besar.
    await recover("supplier_refresh", async () => {
      const { refreshDueSupplierOrders } = await import("@/lib/orders/supplier-refresh");
      const fresh = await refreshDueSupplierOrders(db, { limit: 12 });
      if (fresh.refreshed > 0) out.supplier_refreshed = fresh.refreshed;
    }, undefined);
    out.reconciled = await recover("stuck_links", () => order.reconcileStuckSkOrders(db, { reportLookupFailure: true }), 0);
  }
  // Paid plan: cek saldo SK maks tiap 10 menit (sebelumnya 60 menit hanya di cron/operations :00).
  if (db.canSpend(5)) {
    try {
      const lastCheck = await db.queryFirst(
        `SELECT created_at FROM sk_saldo_log WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`,
      ).catch(() => null);
      const { parseExpiry } = await import("@/lib/expiry");
      const lastTs = parseExpiry(lastCheck?.created_at);
      if (lastTs == null || lastTs < Date.now() - WR_SK_BALANCE_CHECK_INTERVAL_MS) {
        const { checkAndLogSkSaldo } = await import("@/lib/sekalipay/saldo");
        const saldo = await checkAndLogSkSaldo(db);
        out.sk_saldo_balance = saldo.balance;
        out.sk_saldo_low = saldo.isLow;
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
    }
  }
  return out;
}
