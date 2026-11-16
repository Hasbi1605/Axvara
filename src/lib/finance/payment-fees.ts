import { z } from "zod";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { MDR_MAX_BPS, type PaymentFeeSettings } from "./types";

const bps = z.number().int().min(0).max(MDR_MAX_BPS);
export const paymentFeeSchema = z.object({ mdr_bps: z.object({ gopay: bps, klikqris: bps, dana: bps }).strict() }).strict();
export const defaultPaymentFees = (): PaymentFeeSettings => ({ mdr_bps: { gopay: 0, klikqris: 0, dana: 0 } });
export async function readPaymentFees(db: DatabaseAccess = createDatabaseAccess()): Promise<PaymentFeeSettings> {
  const row = await db.queryFirst("SELECT value FROM store_settings WHERE key='payment_mdr_bps'");
  if (!row) return defaultPaymentFees();
  return paymentFeeSchema.parse(JSON.parse(String(row.value)));
}
export async function savePaymentFees(value: PaymentFeeSettings, db: DatabaseAccess = createDatabaseAccess()) {
  const settings = paymentFeeSchema.parse(value);
  await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES('payment_mdr_bps',?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", JSON.stringify(settings));
  return settings;
}
/** Durable keys invalidate both overview cache layers across isolates. */
export async function financeCacheRevision(db: DatabaseAccess = createDatabaseAccess()): Promise<string> {
  const rows = await db.queryAll("SELECT key,value FROM store_settings WHERE key IN ('finance_revision','payment_mdr_bps') ORDER BY key");
  return JSON.stringify(rows);
}
