import type { DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";

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
  const events = await db.execRun("DELETE FROM dana_webhook_events WHERE created_at<datetime('now','-30 days')");
  const revoked = await db.execRun("DELETE FROM admin_session_revocations WHERE datetime(expires_at)<datetime('now')");
  // Failed deletes leave the marker unchanged so the next tick can recover.
  await db.execRun(`INSERT INTO store_settings(key,value,updated_at)
    VALUES('maintenance_cleanup_at',datetime('now'),datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`);
  const whatsapp = Number(sessions.changes || 0) + Number(inbox.changes || 0);
  return { rows_cleaned: whatsapp + Number(events.changes || 0) + Number(revoked.changes || 0), whatsapp_rows_cleaned: whatsapp };
}
