import type { DatabaseAccess } from "@/lib/db-access";
import { pixelverifBuyerErrorMessage } from "@/lib/pixelverif/copy";
import type { JaspayOrderResult } from "./client";
import { decodeJaspayVariantId, jaspayAmount } from "./jaspay";

export type AutomaticProgressItem = {
  label: string;
  stage: "preparing" | "queued" | "running" | "ready" | "needs_check" | "failed";
  ready: number;
  total: number;
  queuePosition: number | null;
  updatedAt: string | null;
  /** Neutral time-estimate profile for buyer UI ("short" = 1–5 min automatic processing; absent = Jaspay 15m–1h). */
  estimateProfile?: "short";
  /** Optional safe numeric step progress during "running" (never raw provider text). */
  step?: { current: number; total: number | null };
  /** Optional allowlisted, whitelabel buyer guidance when stage is "needs_check" / "failed". */
  attentionNote?: { id: string; en: string };
};

const count = (value: unknown, maximum: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, maximum) : 0;

/** An allowlisted, credential-free snapshot; never persist raw provider JSON here. */
export async function persistJaspayProgress(
  link: Record<string, unknown>, result: JaspayOrderResult, db: DatabaseAccess, receiptOnly = false,
): Promise<boolean> {
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
  const identity = decodeJaspayVariantId(String(link.wr_variant_id));
  const receiptMatches = identity && identity.product === result.product && result.quantity === total;
  const invoiceTotal = receiptMatches ? jaspayAmount(result.total) ?? null : null;
  const refund = receiptMatches ? jaspayAmount(result.refunded) ?? null : null;
  // One guarded write for polling: financial evidence can also arrive after fulfillment.
  // A conflicting charge cannot move the frozen total or its cumulative refund.
  if (receiptOnly && invoiceTotal === null && refund === null) return false;
  const applied = await db.execRun(`WITH incoming(snapshot,done,charge,refund) AS (VALUES (?,?,?,?))
    UPDATE wr_order_links SET
      jaspay_progress=CASE WHEN snapshot IS NOT NULL AND status NOT IN ('completed','failed')
        AND COALESCE(json_extract(jaspay_progress,'$.done'),0)<=done THEN snapshot ELSE jaspay_progress END,
      jaspay_invoice_total=COALESCE(jaspay_invoice_total,charge),
      jaspay_refunded_total=CASE WHEN (charge IS NULL OR jaspay_invoice_total IS NULL OR charge=jaspay_invoice_total)
        AND refund BETWEEN COALESCE(jaspay_refunded_total,0) AND COALESCE(jaspay_invoice_total,charge)
        THEN refund ELSE jaspay_refunded_total END
    FROM incoming WHERE id=? AND wr_order_id=? AND wr_variant_id=? AND quantity=?`,
    receiptOnly ? null : JSON.stringify(snapshot), snapshot.done, invoiceTotal, refund,
    Number(link.id), result.invoice, String(link.wr_variant_id), total);
  return Number(applied.changes) > 0;
}

/**
 * Pixel Verification lines (README "Queue Position"): provider `pending` →
 * queued with the 1-based queue_position (null tolerated), `processing` →
 * running, completed → ready, needs_admin → needs_check. Only stored,
 * allowlisted columns are read — never the receipt body.
 */
async function readPixelverifProgress(code: string, db: Pick<DatabaseAccess, "queryAll">): Promise<AutomaticProgressItem[]> {
  const rows = await db.queryAll(`SELECT l.status,l.queue_position,l.progress_step,l.last_error,l.last_error_code,l.receipt_json,l.provider_order_id,l.updated_at,p.name,pv.label
    FROM pixelverif_order_links l
    LEFT JOIN product_variants pv ON pv.id=l.variant_id
    LEFT JOIN products p ON p.id=l.product_id
    WHERE l.order_code=? ORDER BY l.item_index LIMIT 20`, code).catch(() => []);
  return rows.map(row => {
    let receipt: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(String(row.receipt_json ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) receipt = parsed as Record<string, unknown>;
    } catch { /* No poll yet. */ }
    const providerStatus = String(receipt.status ?? "");
    const status = String(row.status);
    const stage: AutomaticProgressItem["stage"] = status === "completed" ? "ready"
      : status === "needs_admin" ? "needs_check"
      : !row.provider_order_id ? "preparing"
      : providerStatus === "processing" ? "running" : "queued";
    const position = Number(row.queue_position);
    const rawStep = Number(row.progress_step ?? receipt.current_step);
    const rawTotal = Number(receipt.total_steps);
    const stepCurrent = Number.isSafeInteger(rawStep) && rawStep > 0 && rawStep <= 100 ? rawStep : null;
    const stepTotal = Number.isSafeInteger(rawTotal) && rawTotal > 0 && rawTotal <= 100 ? rawTotal : null;
    const step = stage === "running" && stepCurrent !== null
      ? { current: stepTotal !== null ? Math.min(stepCurrent, stepTotal) : stepCurrent, total: stepTotal }
      : undefined;
    const errCode = stage === "needs_check"
      ? String(row.last_error_code || row.last_error || "").trim()
      : "";
    const noteId = errCode ? pixelverifBuyerErrorMessage(errCode, "id") : undefined;
    const noteEn = errCode ? pixelverifBuyerErrorMessage(errCode, "en") : undefined;
    const attentionNote = noteId ? { id: noteId, en: noteEn ?? noteId } : undefined;
    return {
      label: [row.name, row.label].filter(Boolean).join(" — ") || "Produk digital",
      stage,
      ready: stage === "ready" ? 1 : 0,
      total: 1,
      queuePosition: stage === "queued" && Number.isSafeInteger(position) && position > 0 && position < 1_000_000 ? position : null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      estimateProfile: "short",
      ...(step ? { step } : {}),
      ...(attentionNote ? { attentionNote } : {}),
    };
  });
}

/** Safe for the existing authenticated/masked order status serializers. */
export async function readAutomaticProgress(code: string, db: Pick<DatabaseAccess, "queryAll">): Promise<AutomaticProgressItem[]> {
  return [...await readJaspayProgress(code, db), ...await readPixelverifProgress(code, db)];
}

async function readJaspayProgress(code: string, db: Pick<DatabaseAccess, "queryAll">): Promise<AutomaticProgressItem[]> {
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
