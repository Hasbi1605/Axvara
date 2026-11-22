import type { DatabaseAccess } from "@/lib/db-access";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Read through the caller's metered query; admission and saldo calls stay outside. */
export async function supplierSaldoCheckDue(queryFirst: DatabaseAccess["queryFirst"], supplier: "wr" | "sk") {
  const table = supplier === "wr" ? "wr_saldo_log" : "sk_saldo_log";
  const lastCheck = await queryFirst(
    `SELECT created_at FROM ${table} WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`,
  ).catch(() => null);
  const { parseExpiry } = await import("@/lib/expiry");
  const lastTs = parseExpiry(lastCheck?.created_at);
  return lastTs == null || lastTs < Date.now() - CHECK_INTERVAL_MS;
}
