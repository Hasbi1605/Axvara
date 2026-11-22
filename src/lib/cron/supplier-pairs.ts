import type { DatabaseAccess } from "@/lib/db-access";

/** Admission, result fields and failure handling belong to the cron caller. */
export async function drainSupplierPairs(db: DatabaseAccess, { mode }: { mode: "dirty" | "all" }) {
  const pairs = await import("@/lib/supplier-pairs");
  return (mode === "dirty" ? pairs.decideDirtyWinners : pairs.decideAllWinners)(db);
}
