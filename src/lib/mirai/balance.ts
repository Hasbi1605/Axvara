import type { DatabaseAccess } from "@/lib/db-access";
import {
  checkSupplierLowBalance,
  parseBalanceThreshold,
  SUPPLIER_BALANCE_ALERT_STEP_DEFAULT,
  type CheckSupplierLowBalanceOptions,
  type SupplierBalanceCheckResult,
} from "@/lib/supplier-balance-alert";
import { fetchMiraiBalance, isMiraiConfigured } from "./client";
import { miraiBalanceVndToUsdt } from "./pricing";

export const MIRAI_BALANCE_ALERT_USDT = 5;

export function miraiBalanceAlertThreshold(): number {
  return parseBalanceThreshold(process.env.MIRAI_BALANCE_ALERT_USDT, MIRAI_BALANCE_ALERT_USDT);
}

export function formatMiraiBalanceUsdt(amountUsdt: number): string {
  const formatted = Number.isInteger(amountUsdt) ? String(amountUsdt) : amountUsdt.toFixed(2);
  return `${formatted} USDT`;
}

export async function fetchMiraiBalanceUsdt(): Promise<number> {
  const res = await fetchMiraiBalance();
  if (res.kind !== "ok") throw new Error(res.kind);
  return miraiBalanceVndToUsdt(res.balance_vnd);
}

export function miraiBalanceAlertOptions(now?: number): Omit<CheckSupplierLowBalanceOptions, "supplier"> & { supplier: "mirai" } {
  return {
    supplier: "mirai",
    label: "Mirai",
    fetchBalance: fetchMiraiBalanceUsdt,
    threshold: miraiBalanceAlertThreshold(),
    step: SUPPLIER_BALANCE_ALERT_STEP_DEFAULT,
    format: formatMiraiBalanceUsdt,
    now,
  };
}

export async function checkMiraiLowBalance(
  db: DatabaseAccess,
  now?: number,
): Promise<SupplierBalanceCheckResult> {
  if (!isMiraiConfigured()) return { checked: false };
  return checkSupplierLowBalance(db, miraiBalanceAlertOptions(now));
}
