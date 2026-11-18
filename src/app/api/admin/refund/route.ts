import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { hashShare, newShareToken, readEstimate, refundBody, refundNow, refundOrder, refundResponse, SHARE_SECONDS } from "@/lib/refund/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const parsed = await refundBody(req, "admin:refund");
  if (parsed.error) return parsed.error;
  if (!(await requireAdmin(req))) return refundResponse({ error: "admin" }, 401);
  const { code, action, item, claim } = parsed.data;
  const db = createDatabaseAccess();
  try {
    const order = await refundOrder(db, code);
    if (!order) return refundResponse({ error: "not_found" }, 404);
    const now = refundNow();
    if (action === "revoke") {
      await db.execRun("DELETE FROM market_refund_shares WHERE order_code=?", order.code);
      return refundResponse({ activeShare: false });
    }
    const estimate = await readEstimate(db, order, now);
    if (action === "lookup") {
      const share = await db.queryFirst("SELECT 1 FROM market_refund_shares WHERE order_code=? AND expires_at>?", order.code, now);
      return refundResponse({ estimate, activeShare: Boolean(share) });
    }
    if (estimate.state !== "ready") return refundResponse({ error: "unavailable" }, 409);
    if (action === "claim") {
      const line = estimate.lines.find(line => line.id === item);
      if (typeof claim !== "number" || !Number.isSafeInteger(claim) || !line || line.start == null || line.end == null || line.remaining == null
        || claim > now || claim < line.start || claim >= line.end || (line.warrantyEnd != null && claim >= line.warrantyEnd)
        || line.status === "no_warranty" || line.status === "review") return refundResponse({ error: "claim_invalid" }, 422);
      const saved = await db.execRun(`UPDATE market_refund_items SET claimed_at=? WHERE order_code=? AND item_index=? AND claimed_at IS NULL
        AND EXISTS (SELECT 1 FROM orders WHERE code=? AND status='lunas' AND payment_status='paid')`, claim, order.code, line.id, order.code);
      if (!saved.changes) return refundResponse({ error: "claim_saved" }, 409);
      return refundResponse({ estimate: await readEstimate(db, order, now) });
    }
    if (action === "share") {
      const selected = parsed.data.items;
      if (!Array.isArray(selected) || !selected.length || selected.some(id => !Number.isSafeInteger(id))) return refundResponse({ error: "select_items" }, 422);
      const ids = new Set(selected);
      const lines = estimate.lines.filter(line => ids.has(line.id) && line.amount != null);
      if (lines.length !== ids.size) return refundResponse({ error: "select_items" }, 422);
      const token = newShareToken();
      const snapshot = { ...estimate, lines, locale: order.locale === "en" ? "en" : "id" };
      const expires = now + SHARE_SECONDS;
      const saved = await db.execRun(`INSERT INTO market_refund_shares(order_code,token_hash,snapshot,expires_at)
        SELECT code,?,?,? FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'
        ON CONFLICT(order_code) DO UPDATE SET token_hash=excluded.token_hash,snapshot=excluded.snapshot,expires_at=excluded.expires_at`,
      await hashShare(token), JSON.stringify(snapshot), expires, order.code);
      return saved.changes ? refundResponse({ token, expires, activeShare: true }) : refundResponse({ error: "unavailable" }, 409);
    }
    return refundResponse({ error: "invalid" }, 400);
  } catch {
    return refundResponse({ error: "unavailable" }, 503);
  }
}
