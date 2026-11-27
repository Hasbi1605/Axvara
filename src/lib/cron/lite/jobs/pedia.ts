import { QueryBudgetExceeded } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";

const INDOSMM_BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// pedia_orders (PEDIA M4, PD-30–33): dispatch + poll + alert saldo.
// Budget: klaim atomik + ≤20 item + poll ≤20 + saldo maks. 1×/5 mnt + penanda.
// Saldo dicek via proxy /indosmm/balance; bila < ambang (env
// PEDIA_BALANCE_ALERT_RP) → ping admin sekali + ulang hanya jika turun
// ≥ Rp25.000 atau sesudah pulih (>= ambang, marker direset) — `notifyPediaLowBalance`
// & `clearPediaLowBalanceMarker`, kunci store_settings `pedia_indosmm_balance_alert_at`.
export async function run(ctx: LiteContext): Promise<Record<string, unknown>> {
  const { db, failedCore } = ctx;
  const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
  const out: Record<string, unknown> = {};
  try {
    // Teruskan budgeted access: statement dispatch+poll ikut budget lite job
    // (dulu koneksi sendiri → tak terhitung, rawan jebol diam-diam).
    const r = await processPediaPaidOrders(undefined, db);
    Object.assign(out, r);
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    out.dispatch_error = error instanceof Error ? error.message.slice(0, 80) : "failed";
    failedCore.push("dispatch");
  }
  // 2026-11-13 (owner): IndoSMM satu-satunya supplier. Independent checkpoint
  // and currency gate: do not convert undocumented USD account balances.
  if (db.canSpend(5)) {
    try {
      const key = "pedia_indosmm_balance_checked_at";
      const last = await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, key);
      const { parseExpiry } = await import("@/lib/expiry");
      const ms = parseExpiry(String(last?.value ?? ""));
      if (ms === null || Date.now() - ms > INDOSMM_BALANCE_CHECK_INTERVAL_MS) {
        const nowMs = Date.now();
        await db.execRun(`INSERT INTO store_settings (key,value,updated_at) VALUES (?,datetime('now'),datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, key);
        const { callPediaProxy } = await import("@/lib/pedia/proxy");
        const res = await callPediaProxy<{ balance?: string | number; currency?: string }>("indosmm", "balance", {}, 15_000);
        const v = res.ok ? Number(res.data.balance) : NaN;
        if (res.ok && res.data.currency?.toUpperCase() === "IDR" && Number.isFinite(v) && v >= 0) {
          out.indosmm_balance = v;
          await db.execRun(`INSERT INTO pedia_supplier_balance_log (supplier,balance) VALUES ('indosmm',?)`, v);
          if (db.canSpend(1)) {
            const { recordSyncSuccess } = await import("@/lib/sync-status");
            await recordSyncSuccess(db, "pedia_indosmm_balance", nowMs);
          }
          const { pediaBalanceAlertRp } = await import("@/lib/pedia/ops-config");
          if (v < pediaBalanceAlertRp()) {
            const { notifyPediaLowBalance } = await import("@/lib/pedia/notify");
            out.indosmm_balance_alerted = await notifyPediaLowBalance(v, db, "indosmm");
          } else if (db.canSpend(1)) {
            const { clearPediaLowBalanceMarker } = await import("@/lib/pedia/notify");
            await clearPediaLowBalanceMarker(db, "indosmm");
          }
        } else {
          const err = res.ok ? "unsupported_currency_or_balance" : res.kind;
          out.indosmm_balance_error = err;
          const { recordSyncError } = await import("@/lib/sync-status");
          await recordSyncError(db, "pedia_indosmm_balance", err, nowMs);
        }
      }
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out.indosmm_balance_error = "balance_failed";
      const { recordSyncError } = await import("@/lib/sync-status");
      await recordSyncError(db, "pedia_indosmm_balance", error);
    }
  }
  // 2026-11-01: kesehatan layanan IndoSMM 7 hari (maks 1×/jam, 3 statement).
  if (db.canSpend(3)) {
    try {
      const { refreshPediaServiceStats } = await import("@/lib/pedia/service-stats");
      out.pedia_stats = await refreshPediaServiceStats(db);
    } catch (error) {
      if (error instanceof QueryBudgetExceeded) throw error;
      out.pedia_stats = "failed";
    }
  }
  return out;
}
