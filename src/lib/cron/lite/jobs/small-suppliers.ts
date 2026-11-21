import { QueryBudgetExceeded } from "@/lib/db-access";
import type { LiteContext } from "@/lib/cron/lite/context";

type SmallSupplierJob = "tunvn_orders" | "aivault_orders" | "storebat_orders" | "mirai_orders";

export async function run(ctx: LiteContext, which: SmallSupplierJob): Promise<Record<string, unknown>> {
  const { db, deadline } = ctx;
  if (which === "tunvn_orders") return runTunvnOrders(db, deadline);
  if (which === "aivault_orders") return runAivaultOrders(db, deadline);
  if (which === "storebat_orders") return runStorebatOrders(db, deadline);
  return runMiraiOrders(db, deadline);
}

type Db = LiteContext["db"];

async function runSupplierBalanceCheck(
  db: Db,
  out: Record<string, unknown>,
  prefix: "tunvn" | "aivault" | "storebat" | "mirai",
  loadAndCheck: () => Promise<{ checked: boolean; balance?: number; alerted?: boolean; error?: string }>,
) {
  if (!db.canSpend(5)) return;
  try {
    const bal = await loadAndCheck();
    if (!bal.checked) return;
    if (bal.balance !== undefined) out[`${prefix}_balance`] = bal.balance;
    if (bal.alerted !== undefined) out[`${prefix}_balance_alerted`] = bal.alerted;
    if (bal.error !== undefined) out[`${prefix}_balance_error`] = bal.error;
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    out[`${prefix}_balance_error`] = "balance_failed";
  }
}

async function runTunvnOrders(db: Db, deadline: number) {
  const { processTunvnOrders } = await import("@/lib/tunvn/orders");
  const out: Record<string, unknown> = {
    tunvn_orders_processed: await processTunvnOrders(db, { deadlineMs: deadline - 5_000 }),
  };
  await runSupplierBalanceCheck(db, out, "tunvn", async () => {
    const { checkTunvnLowBalance } = await import("@/lib/supplier-balance-alert");
    return checkTunvnLowBalance(db);
  });
  return out;
}

async function runAivaultOrders(db: Db, deadline: number) {
  const { processAivaultOrders } = await import("@/lib/aivault/orders");
  const out: Record<string, unknown> = {
    aivault_orders_processed: await processAivaultOrders(db, { deadlineMs: deadline - 5_000 }),
  };
  await runSupplierBalanceCheck(db, out, "aivault", async () => {
    const { checkAivaultLowBalance } = await import("@/lib/supplier-balance-alert");
    return checkAivaultLowBalance(db);
  });
  return out;
}

async function runStorebatOrders(db: Db, deadline: number) {
  const { processStorebatOrders } = await import("@/lib/storebat/orders");
  const out: Record<string, unknown> = {
    storebat_orders_processed: await processStorebatOrders(db, { deadlineMs: deadline - 5_000 }),
  };
  await runSupplierBalanceCheck(db, out, "storebat", async () => {
    const { checkStorebatLowBalance } = await import("@/lib/supplier-balance-alert");
    return checkStorebatLowBalance(db);
  });
  return out;
}

async function runMiraiOrders(db: Db, deadline: number) {
  const { processMiraiOrders } = await import("@/lib/mirai/orders");
  const out: Record<string, unknown> = {
    mirai_orders_processed: await processMiraiOrders(db, { deadlineMs: deadline - 5_000 }),
  };
  await runSupplierBalanceCheck(db, out, "mirai", async () => {
    const { checkMiraiLowBalance } = await import("@/lib/mirai/balance");
    return checkMiraiLowBalance(db);
  });
  return out;
}
