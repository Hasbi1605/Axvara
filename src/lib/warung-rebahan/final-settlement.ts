import type { DatabaseAccess } from "@/lib/db-access";
import { PURCHASE_PAID_SQL_ALIASED } from "@/lib/suppliers/purchase-state";

// Prefix through final CAS <=8; link replay <=4; strict aggregate + notice <=14.
export const WR_LINK_SETTLE_FLOOR = 4;
export const WR_AGGREGATE_FLOOR = 14;
export const WR_FINAL_FLOOR = 8 + WR_LINK_SETTLE_FLOOR + WR_AGGREGATE_FLOOR;

const liveLink = `l.status='failed' AND l.wr_order_id IS NULL AND l.request_sent_at IS NULL`;
const manual = `(i.status='manual_required' OR COALESCE(i.last_error,'') LIKE 'manual_handover:%' OR i.delivered_message_id IS 'manual')`;
const unbound = `l.fulfillment_item_id IS NULL AND NOT EXISTS (SELECT 1 FROM fulfillment_items r WHERE r.wr_link_id=l.id)`;
// Freeze whether fallback was ever admissible: a bound/conflicting link must
// not become legacy work just because its pointer(s) disappear before replay.
export const WR_FINAL_MARKER_SQL = `? || CASE WHEN ?=1 AND ${unbound.replaceAll("l.", "wr_order_links.")} THEN ':u' ELSE ':b' END`;
const owns = `i.order_code=l.order_code AND i.sk_link_id IS NULL AND i.tunvn_link_id IS NULL
  AND ((l.fulfillment_item_id=i.id AND (i.wr_link_id IS NULL OR i.wr_link_id=l.id))
       OR (l.fulfillment_item_id IS NULL AND i.wr_link_id=l.id))
  AND NOT EXISTS (SELECT 1 FROM fulfillment_items r WHERE r.wr_link_id=l.id AND r.id<>i.id)
  AND NOT EXISTS (SELECT 1 FROM wr_order_links w WHERE w.fulfillment_item_id=i.id AND w.id<>l.id)
  AND NOT EXISTS (SELECT 1 FROM sk_order_links s WHERE s.fulfillment_item_id=i.id)
  AND NOT EXISTS (SELECT 1 FROM tunvn_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index)`;
const orderProtected = `o.fulfillment_status IN ('delivered','manual_required')`;
export const NO_ACTIVE_WR_SIBLINGS = `NOT EXISTS (SELECT 1 FROM fulfillment_items a
  WHERE a.order_code=o.code AND a.status IN ('queued','sending','retry'))
  AND NOT EXISTS (SELECT 1 FROM wr_order_links a WHERE a.order_code=o.code
    AND (a.status NOT IN ('failed','completed') OR a.wr_final_settle_token IS NOT NULL))`;
const proof = `i.status='failed' AND NOT ${manual}
  AND substr(i.last_error,1,length('wr_final:' || l.id || ':'))='wr_final:' || l.id || ':'
  AND length(i.last_error)=length('wr_final:' || l.id || ':')+36`;
// Keep the complete set of unbound handoffs, not just the last writer. Bound
// handoffs keep their proof on the item and do not depend on the link error text.
const unboundIds = `COALESCE(NULLIF(substr(wr_aggregate_refresh_token,37),''),'[]')`;
const unboundProof = `EXISTS (SELECT 1 FROM json_each(${unboundIds}) p JOIN wr_order_links l ON l.id=p.value
  WHERE p.type='integer'
  AND l.order_code=o.code AND ${liveLink} AND ${unbound})`;
const aggregateProof = `(${unboundProof} OR EXISTS (SELECT 1 FROM fulfillment_items i JOIN wr_order_links l
  ON l.order_code=i.order_code AND (i.wr_link_id=l.id OR l.fulfillment_item_id=i.id)
  WHERE i.order_code=o.code AND ${liveLink} AND ${owns} AND ${proof}))`;

type LinkWork = { id: number; token: string; code: string };
type LinkOutcome = { orderToken: string } | "protected" | "conflict" | "ineligible" | "race";

export async function settleWrFinalLink(db: DatabaseAccess, { id, token, code }: LinkWork): Promise<LinkOutcome> {
  const sql = `FROM wr_order_links l JOIN orders o ON o.code=l.order_code
    WHERE l.id=? AND substr(l.wr_final_settle_token,1,36)=? AND o.code=? AND ${liveLink}`;
  const args = [id, token, code];
  const definitelyProtected = `((${orderProtected}) OR EXISTS (SELECT 1 FROM fulfillment_items i
    WHERE (i.id=l.fulfillment_item_id OR i.wr_link_id=l.id) AND ${owns} AND (i.status='delivered' OR ${manual})))`;
  const match = await db.queryFirst(`SELECT (${PURCHASE_PAID_SQL_ALIASED}) AS eligible, ${definitelyProtected} AS protected,
    (${unbound} AND substr(l.wr_final_settle_token,37)=':u') AS unbound, (SELECT i.id FROM fulfillment_items i WHERE
      (i.id=l.fulfillment_item_id OR i.wr_link_id=l.id) AND ${owns}) AS item_id ${sql}`, ...args);
  if (!match) return "race";
  if (!Number(match.eligible)) return "ineligible";
  const ack = `UPDATE wr_order_links SET wr_final_settle_token=NULL WHERE id=? AND substr(wr_final_settle_token,1,36)=?`;
  if (Number(match.protected)) {
    const cleared = await db.execRun(`${ack} AND EXISTS (SELECT 1 ${sql} AND ${PURCHASE_PAID_SQL_ALIASED} AND ${definitelyProtected})`, id, token, ...args);
    return Number(cleared.changes) ? "protected" : "race";
  }
  const itemId = Number(match.item_id);
  const legacy = Number(match.unbound) === 1;
  const tag = `wr_final:${id}:${token}`;
  if (!legacy) {
    if (!itemId) return "conflict";
    await db.execRun(`UPDATE fulfillment_items AS i SET status='failed',last_error=?,locked_until=NULL,
      next_attempt_at=NULL,updated_at=datetime('now') WHERE i.id=? AND NOT ${manual}
      AND EXISTS (SELECT 1 ${sql} AND ${PURCHASE_PAID_SQL_ALIASED} AND NOT (${orderProtected}) AND ${owns}
        AND (i.status IN ('queued','retry') OR (${proof} AND i.last_error<>?)))`, tag, itemId, ...args, tag);
  }
  // Handoff and ACK are in one D1 transaction. ACK's predicate proves the new
  // generation was published even if the previous statement returned zero rows.
  const d1 = db.getD1();
  if (!d1) throw new Error("wr_final_settlement_requires_d1");
  const nonce = crypto.randomUUID();
  const eligible = legacy ? `(${unbound} AND substr(l.wr_final_settle_token,37)=':u')` : `EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.id=? AND ${owns}
    AND i.status='failed' AND NOT ${manual} AND i.last_error=?)`;
  const results = await d1.batch([
    d1.prepare(`UPDATE orders SET wr_aggregate_refresh_token=? || ${legacy ? `json_insert(${unboundIds}, '$[#]', CAST(? AS INTEGER))` : `COALESCE(substr(wr_aggregate_refresh_token,37),'')`}
      WHERE code=? AND EXISTS (SELECT 1 ${sql} AND ${PURCHASE_PAID_SQL_ALIASED} AND NOT (${orderProtected}) AND ${eligible})`)
      .bind(nonce, ...(legacy ? [id] : []), code, ...args, ...(legacy ? [] : [itemId, tag])),
    d1.prepare(`${ack} AND EXISTS (SELECT 1 FROM orders o WHERE o.code=? AND substr(o.wr_aggregate_refresh_token,1,36)=?)`)
      .bind(id, token, code, nonce),
  ]);
  return Number(results[1].meta.changes) ? { orderToken: nonce } : "race";
}

export async function settleWrFinalAggregate(db: DatabaseAccess, code: string, token: string): Promise<string> {
  const generation = token.slice(0, 36);
  const matches = `substr(o.wr_aggregate_refresh_token,1,36)=?`;
  const guard = { sql: `${matches} AND ${PURCHASE_PAID_SQL_ALIASED} AND (${aggregateProof}) AND ${NO_ACTIVE_WR_SIBLINGS}`, params: [generation] };
  const { refreshOrderAggregate } = await import("./deliver");
  const outcome = await refreshOrderAggregate(code, db, { guard, legacySql: unboundProof });
  if (outcome === "changed" || outcome === "already_valid") {
    const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
    if (!await notifyBuyerDeliveryFailed(code, db, { ...guard, sql: `${guard.sql} AND o.fulfillment_status='failed'` })) return "notice_pending";
  } else if (outcome !== "protected") return outcome;
  const cleared = await db.execRun(`UPDATE orders AS o SET wr_aggregate_refresh_token=NULL WHERE code=? AND
    ${outcome === "protected" ? `${matches} AND ${PURCHASE_PAID_SQL_ALIASED} AND (${orderProtected})` : `(${guard.sql}) AND o.fulfillment_status='failed'`}
    AND NOT EXISTS (SELECT 1 FROM buyer_notice_log n WHERE n.idempotency_key IN ('email:delivery-failed:' || o.code, 'telegram:delivery-failed:' || o.code)
      AND n.status='sending')`, code, generation);
  return Number(cleared.changes) ? outcome : "race";
}

// Durable keyset cursors round-robin conflicts/unknown notices instead of holding page 1.
// One candidate per lane per tick bounds network/time and leaves dispatch headroom.
export async function replayWrFinalSettlement(db: DatabaseAccess) {
  const out = { deferred: 0, pending: 0, settled: 0, reasons: {} as Record<string, number> };
  for (const lane of ["link", "order"] as const) {
    if (!db.canSpend(2)) { out.deferred++; break; }
    const key = `wr_final_replay_${lane}`;
    const candidate = await db.queryFirst(lane === "link"
      ? `SELECT id,order_code AS code,wr_final_settle_token AS token FROM wr_order_links INDEXED BY idx_wr_final_settle_pending
         WHERE wr_final_settle_token IS NOT NULL AND id>COALESCE((SELECT CAST(value AS INTEGER) FROM wr_sync_state WHERE key=?),0) ORDER BY id LIMIT 1`
      : `SELECT o.code, o.wr_aggregate_refresh_token AS token FROM orders o INDEXED BY idx_wr_aggregate_refresh_pending
         WHERE o.wr_aggregate_refresh_token IS NOT NULL AND o.code>COALESCE((SELECT value FROM wr_sync_state WHERE key=?),'')
         AND ${NO_ACTIVE_WR_SIBLINGS} ORDER BY o.code LIMIT 1`, key);
    if (candidate && !db.canSpend(1 + (lane === "link" ? WR_LINK_SETTLE_FLOOR : WR_AGGREGATE_FLOOR))) { out.deferred++; continue; }
    // Advance before work: an interrupted/conflicting row returns on wraparound.
    if (candidate) await db.execRun(`INSERT INTO wr_sync_state(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, String(lane === "link" ? candidate.id : candidate.code));
    else await db.execRun(`UPDATE wr_sync_state SET value='' WHERE key=? AND value<>''`, key);
    if (!candidate) continue;
    const code = String(candidate.code);
    const token = String(candidate.token);
    const result = lane === "link" ? await settleWrFinalLink(db, { id: Number(candidate.id), code, token: token.slice(0, 36) }) : await settleWrFinalAggregate(db, code, token);
    if (typeof result !== "string" || ["protected", "changed", "already_valid"].includes(result)) out.settled++;
    else {
      out.pending++;
      out.reasons[result] = (out.reasons[result] ?? 0) + 1;
    }
  }
  return out;
}
