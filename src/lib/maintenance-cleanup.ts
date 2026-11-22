import type { DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";
import { PAYMENT_ATTENTION_WHERE } from "@/lib/admin-overview-queries";
import { purgeExpiredPixelverifInputs } from "./pixelverif/purge";

/** Rows deleted per table per tick. Cleanup runs hourly and is resumable, so a
 * backlog drains over several ticks without one long write burst. */
const PRUNE_BATCH = 500;

type PruneResult = { changes?: number };

/** Money/order
 * ledgers, webhook evidence under review, notice/dedupe ledgers and
 * `payment_invoice_history` are never touched here. Each prune is bounded and
 * skipped when the caller's statement budget is tight (reserving one statement
 * for the completion marker so the tick still advances); the next tick resumes. */
async function prune(db: DatabaseAccess, run: () => Promise<PruneResult>): Promise<number> {
  if (!db.canSpend(2)) return 0;
  return Number((await run()).changes || 0);
}

/** Lite + heavy share one completion marker. Expiry/fulfillment do not use
 * this throttle; only already-expired housekeeping records are removed here. */
export async function runMaintenanceCleanup(db: DatabaseAccess) {
  const previous = await db.queryFirst("SELECT value FROM store_settings WHERE key='maintenance_cleanup_at'");
  const last = parseExpiry(previous?.value);
  const elapsed = last == null ? Infinity : Date.now() - last;
  if (elapsed >= 0 && elapsed < 60 * 60 * 1000) {
    return { rows_cleaned: 0, whatsapp_rows_cleaned: 0, cleanup_skipped: "interval" };
  }
  const sessions = await db.execRun("DELETE FROM whatsapp_sessions WHERE datetime(expires_at)<datetime('now','-1 day')");
  const inbox = await db.execRun("DELETE FROM whatsapp_inbox_events WHERE created_at<datetime('now','-7 days')");
  const events = await db.execRun(`DELETE FROM dana_webhook_events WHERE julianday(created_at)<julianday('now','-30 days')
    AND NOT (${PAYMENT_ATTENTION_WHERE})`);
  const revoked = await db.execRun("DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')");
  // Quote validity is at most one hour. Keep admission keys for a day and
  // bound housekeeping so abuse cannot create an unbounded cleanup request.
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const claims = await db.execRun("DELETE FROM checkout_claims WHERE quote_id IN (SELECT quote_id FROM checkout_claims WHERE created_at_ms<? ORDER BY created_at_ms LIMIT 200)", cutoff);
  const attempts = await db.execRun("DELETE FROM checkout_attempts WHERE rowid IN (SELECT rowid FROM checkout_attempts WHERE window_id<? ORDER BY window_id LIMIT 200)", Math.floor(cutoff / 900_000));
  const login = await db.execRun("DELETE FROM security_auth_attempts WHERE client_hash IN (SELECT client_hash FROM security_auth_attempts WHERE window_id<? ORDER BY window_id LIMIT 200)", Math.floor(cutoff / 900_000));
  // Owner decision 2026-11-21: security audit trail kept 90 days (was 30),
  // oldest-first and bounded. Active login windows are handled above.
  const security = await db.execRun(
    `DELETE FROM security_events WHERE id IN (
      SELECT id FROM security_events WHERE julianday(created_at)<julianday('now','-90 days')
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  );
  // Diagnostic supplier sync/balance history (>30 days) with a floor that keeps
  // the newest row per type/status/source/supplier so a stalled source still
  // shows its last evidence. Admin cards read the latest row only.
  const syncLogs = await prune(db, () => db.execRun(
    `DELETE FROM wr_sync_log WHERE rowid IN (
      SELECT rowid FROM wr_sync_log
      WHERE julianday(created_at)<julianday('now','-30 days')
        AND id NOT IN (SELECT MAX(id) FROM wr_sync_log GROUP BY sync_type,status)
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  )) + await prune(db, () => db.execRun(
    `DELETE FROM sk_sync_log WHERE rowid IN (
      SELECT rowid FROM sk_sync_log
      WHERE julianday(created_at)<julianday('now','-30 days')
        AND id NOT IN (SELECT MAX(id) FROM sk_sync_log GROUP BY sync_type,status)
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  ));
  const balanceLogs = await prune(db, () => db.execRun(
    `DELETE FROM wr_saldo_log WHERE rowid IN (
      SELECT rowid FROM wr_saldo_log
      WHERE julianday(created_at)<julianday('now','-30 days')
        AND id NOT IN (SELECT MAX(id) FROM wr_saldo_log GROUP BY source)
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  )) + await prune(db, () => db.execRun(
    `DELETE FROM sk_saldo_log WHERE rowid IN (
      SELECT rowid FROM sk_saldo_log
      WHERE julianday(created_at)<julianday('now','-30 days')
        AND id NOT IN (SELECT MAX(id) FROM sk_saldo_log GROUP BY source)
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  )) + await prune(db, () => db.execRun(
    `DELETE FROM pedia_supplier_balance_log WHERE rowid IN (
      SELECT rowid FROM pedia_supplier_balance_log
      WHERE julianday(created_at)<julianday('now','-30 days')
        AND id NOT IN (SELECT MAX(id) FROM pedia_supplier_balance_log GROUP BY supplier)
      ORDER BY created_at LIMIT ${PRUNE_BATCH})`,
  ));
  const pixelPurged = await prune(db, () => purgeExpiredPixelverifInputs(db));

  // Webhook dedupe: Telegram retries and our own reset re-deliver within hours,
  // so 14 days is far beyond any live dedupe window. Orders stay idempotent
  // through their own guards even if an ancient update is replayed.
  const telegram = await prune(db, () => db.execRun(
    `DELETE FROM telegram_updates WHERE update_id IN (
      SELECT update_id FROM telegram_updates WHERE julianday(updated_at)<julianday('now','-14 days')
      ORDER BY updated_at LIMIT ${PRUNE_BATCH})`,
  ));
  // Finished broadcast campaigns only; in-flight rows of active campaigns are
  // left untouched regardless of age.
  const broadcasts = await prune(db, () => db.execRun(
    `DELETE FROM broadcast_deliveries WHERE rowid IN (
      SELECT d.rowid FROM broadcast_deliveries d
      JOIN broadcast_campaigns c ON c.id=d.campaign_id
      WHERE c.status='completed' AND d.status IN ('sent','failed','unknown','skipped','canceled')
        AND julianday(d.updated_at)<julianday('now','-90 days')
      ORDER BY d.updated_at LIMIT ${PRUNE_BATCH})`,
  ));
  // Failed deletes leave the marker unchanged so the next tick can recover.
  if (db.canSpend(1)) await db.execRun(`INSERT INTO store_settings(key,value,updated_at)
    VALUES('maintenance_cleanup_at',datetime('now'),datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  const whatsapp = Number(sessions.changes || 0) + Number(inbox.changes || 0);
  return { rows_cleaned: whatsapp + Number(events.changes || 0) + Number(revoked.changes || 0) + Number(claims.changes || 0) + Number(attempts.changes || 0) + Number(login.changes || 0) + Number(security.changes || 0) + syncLogs + balanceLogs + telegram + broadcasts + pixelPurged, whatsapp_rows_cleaned: whatsapp };
}
