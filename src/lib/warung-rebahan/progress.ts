import type { DatabaseAccess } from "@/lib/db-access";
import type { JaspayOrderResult } from "./client";

export type AutomaticProgressItem = {
  label: string;
  stage: "preparing" | "queued" | "running" | "ready" | "needs_check" | "failed";
  ready: number;
  total: number;
  queuePosition: number | null;
  updatedAt: string | null;
};

const count = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;

/** An allowlisted, credential-free snapshot; never persist raw provider JSON here. */
export async function persistJaspayProgress(
  link: Record<string, unknown>, result: JaspayOrderResult, db: DatabaseAccess,
): Promise<void> {
  const total = Math.max(1, Number(link.quantity) || 1);
  const phase = ["preparing", "queued", "running"].includes(String(result.phase)) ? result.phase : null;
  const snapshot = {
    phase,
    queuePosition: phase === "queued" && Number.isInteger(result.queue_position) && Number(result.queue_position) > 0
      ? Math.min(Number(result.queue_position), 1_000_000) : null,
    done: count(result.progress?.done, total),
    success: count(result.progress?.success ?? result.success_count, total),
    updatedAt: new Date().toISOString(),
  };
  await db.execRun(`UPDATE wr_order_links SET jaspay_progress=?
    WHERE id=? AND wr_order_id=? AND wr_variant_id LIKE 'jaspay:%'
      AND status NOT IN ('completed','failed')
      AND (jaspay_progress IS NULL OR COALESCE(json_extract(jaspay_progress,'$.done'),0)<=?)`,
    JSON.stringify(snapshot), Number(link.id), result.invoice, snapshot.done);
}

/** Safe for the existing authenticated/masked order status serializers. */
export async function readAutomaticProgress(code: string, db: Pick<DatabaseAccess, "queryAll">): Promise<AutomaticProgressItem[]> {
  const rows = await db.queryAll(`SELECT w.status,w.quantity,w.last_error,w.jaspay_progress,
      p.name,pv.label FROM wr_order_links w
    LEFT JOIN product_variants pv ON pv.wr_variant_id=w.wr_variant_id
    LEFT JOIN products p ON p.id=pv.product_id
    WHERE w.order_code=? AND w.wr_variant_id LIKE 'jaspay:%' ORDER BY w.id LIMIT 20`, code);
  return rows.map(row => {
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(String(row.jaspay_progress ?? "{}")) ?? {}; } catch { /* Pre-snapshot order. */ }
    const total = Math.max(1, Number(row.quantity) || 1);
    const phase = ["preparing", "queued", "running"].includes(String(snapshot.phase)) ? snapshot.phase as "preparing" | "queued" | "running" : "preparing";
    const stage = row.status === "completed" ? "ready" : row.status === "failed" ? "failed"
      : /^jaspay_(partial|completed)_manual:/.test(String(row.last_error ?? "")) ? "needs_check" : phase;
    return {
      label: [row.name, row.label].filter(Boolean).join(" — ") || "Produk digital",
      stage,
      ready: stage === "ready" ? total : count(snapshot.success, total), total,
      queuePosition: stage === "queued" && typeof snapshot.queuePosition === "number" && snapshot.queuePosition > 0 ? snapshot.queuePosition : null,
      updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null,
    };
  });
}
