import type { DatabaseAccess } from "@/lib/db-access";
import {
  checkSupplierLowBalance,
  parseBalanceThreshold,
  type CheckSupplierLowBalanceOptions,
  type SupplierBalanceCheckResult,
} from "@/lib/supplier-balance-alert";
import { fetchPixelverifCredits, isPixelverifConfigured } from "./client";

export const PIXELVERIF_BALANCE_ALERT_CREDITS = 5;

export function pixelverifBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.PIXELVERIF_BALANCE_ALERT_CREDITS, PIXELVERIF_BALANCE_ALERT_CREDITS);
}

export function formatPixelverifBalanceCredits(amount: number): string {
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${formatted} credits`;
}

export async function fetchPixelverifBalanceCredits(): Promise<number> {
  const res = await fetchPixelverifCredits();
  if (res.kind !== "ok") throw new Error(res.kind);
  return res.data.credits_remaining;
}

export function pixelverifBalanceAlertOptions(now?: number): Omit<CheckSupplierLowBalanceOptions, "supplier"> & { supplier: "pixelverif" } {
  return {
    supplier: "pixelverif",
    label: "Pixel Verification",
    fetchBalance: fetchPixelverifBalanceCredits,
    threshold: pixelverifBalanceAlertThreshold(),
    step: 1,
    format: formatPixelverifBalanceCredits,
    now,
  };
}

export async function checkPixelverifLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  if (!isPixelverifConfigured()) return { checked: false };
  return checkSupplierLowBalance(db, pixelverifBalanceAlertOptions(now));
}
