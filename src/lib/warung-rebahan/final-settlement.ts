import type { DatabaseAccess } from "@/lib/db-access";
import { PURCHASE_PAID_SQL_ALIASED } from "@/lib/suppliers/purchase-state";

// Prefix through final CAS <=8; link replay <=4; strict aggregate + notice <=14.
export const WR_LINK_SETTLE_FLOOR = 4;
export const WR_AGGREGATE_FLOOR = 14;
export const WR_FINAL_FLOOR = 8 + WR_LINK_SETTLE_FLOOR + WR_AGGREGATE_FLOOR;

const liveLink = `l.status='failed' AND COALESCE(l.wr_order_id,'')='' AND l.request_sent_at IS NULL`;
const manual = `(i.status='manual_required' OR COALESCE(i.last_error,'') LIKE 'manual_handover:%' OR i.delivered_message_id IS 'manual')`;
const unbound = `l.fulfillment_item_id IS NULL AND NOT EXISTS (SELECT 1 FROM fulfillment_items r WHERE r.wr_link_id=l.id)`;
// Freeze whether fallback was ever admissible: a bound/conflicting link must
// not become legacy work just because its pointer(s) disappear before replay.
export const WR_FINAL_MARKER_SQL = `? || CASE WHEN ?=1 AND ${unbound.replaceAll("l.", "wr_order_links.")} THEN ':u' ELSE ':b' END`;
const owns = `i.order_code=l.order_code AND i.sk_link_id IS NULL AND i.tunvn_link_id IS NULL
  AND (i.aivault_link_id IS NULL AND i.storebat_link_id IS NULL AND i.mirai_link_id IS NULL AND i.pixelverif_link_id IS NULL AND i.inventory_id IS NULL)
  AND ((l.fulfillment_item_id=i.id AND (i.wr_link_id IS NULL OR i.wr_link_id=l.id))
       OR (l.fulfillment_item_id IS NULL AND i.wr_link_id=l.id))
  AND NOT EXISTS (SELECT 1 FROM fulfillment_items r WHERE r.wr_link_id=l.id AND r.id<>i.id)
  AND NOT EXISTS (SELECT 1 FROM wr_order_links w WHERE w.fulfillment_item_id=i.id AND w.id<>l.id)
  AND NOT EXISTS (SELECT 1 FROM sk_order_links s WHERE s.fulfillment_item_id=i.id)
  AND NOT EXISTS (SELECT 1 FROM pixelverif_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index)
  AND NOT EXISTS (
    SELECT 1 FROM tunvn_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index
    UNION ALL SELECT 1 FROM aivault_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index
    UNION ALL SELECT 1 FROM storebat_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index
    UNION ALL SELECT 1 FROM mirai_order_links t WHERE t.order_code=i.order_code AND t.item_index=i.item_index)`;
const orderProtected = `o.fulfillment_status IN ('delivered','manual_required')`;
const anyFailedItem = `EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.order_code=o.code AND i.status='failed')`;
const failedItem = `EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.order_code=o.code AND i.status='failed' AND NOT ${manual})`;
const noUnownedFailure = `(NOT ${anyFailedItem} OR o.wr_aggregate_refresh_token IS NOT NULL)`;
export const NO_ACTIVE_WR_SIBLINGS = `NOT EXISTS (SELECT 1 FROM fulfillment_items a
  WHERE a.order_code=o.code AND a.status IN ('queued','sending','retry'))
  AND NOT EXISTS (SELECT 1 FROM wr_order_links a WHERE a.order_code=o.code
    AND (a.status NOT IN ('failed','completed') OR a.wr_final_settle_token IS NOT NULL))`;
const proof = `i.status='failed' AND NOT ${manual}
  AND substr(i.last_error,1,length('wr_final:' || l.id || ':'))='wr_final:' || l.id || ':'
  AND length(i.last_error)=length('wr_final:' || l.id || ':')+36`;
// Keep one witness per handed-off link, including original ownership, item tag,
// and whether its cause was already the literal Void text. No vendor text or PII.
// Pre-FX-21 UUID/array markers still settle live proofs, but cannot attest to a
// missing historical source. Keep that uncertainty when appending a new witness.
const markerPayload = (column: string) => `COALESCE(NULLIF(substr(${column},37),''),'[]')`;
const payload = markerPayload("o.wr_aggregate_refresh_token");
const witnessRows = `json_each(${payload},'$.links')`;
const legacyIds = `CASE WHEN json_type(${payload})='array' THEN ${payload} ELSE json_extract(${payload},'$.legacy') END`;
const legacyMarker = `(json_type(${payload})='array' OR json_extract(${payload},'$.legacy') IS NOT NULL)`;
const isVoid = `(l.last_error IS 'cancelled_by_admin')`;
const witnessItem = `json_extract(p.value,'$[0]')`;
const witnessVoid = `json_extract(p.value,'$[2]')`;
const witnessTag = `'wr_final:' || l.id || ':' || json_extract(p.value,'$[1]')`;
const witnessLink = `l.id=CAST(p.key AS INTEGER) AND l.order_code=o.code`;
const witnessLive = `${liveLink} AND ${isVoid}=${witnessVoid}`;
const unboundProof = `(EXISTS (SELECT 1 FROM ${witnessRows} p JOIN wr_order_links l ON ${witnessLink}
    WHERE ${witnessItem} IS NULL AND ${witnessLive} AND ${unbound})
  OR EXISTS (SELECT 1 FROM json_each(${legacyIds}) p JOIN wr_order_links l ON l.id=p.value
    WHERE p.type='integer' AND l.order_code=o.code AND ${liveLink} AND NOT ${isVoid} AND ${unbound}
    AND NOT EXISTS (SELECT 1 FROM ${witnessRows} w WHERE w.key=CAST(l.id AS TEXT))))`;
const aggregateProof = `(${unboundProof} OR EXISTS (SELECT 1 FROM ${witnessRows} p
  JOIN wr_order_links l ON ${witnessLink} JOIN fulfillment_items i ON i.id=${witnessItem}
  WHERE ${witnessLive} AND ${owns} AND i.status='failed' AND NOT ${manual} AND i.last_error=${witnessTag})
  OR (${legacyMarker} AND EXISTS (SELECT 1 FROM fulfillment_items i JOIN wr_order_links l
  ON l.order_code=i.order_code AND (i.wr_link_id=l.id OR l.fulfillment_item_id=i.id)
  WHERE i.order_code=o.code AND ${liveLink} AND NOT ${isVoid} AND ${owns} AND ${proof}
    AND NOT EXISTS (SELECT 1 FROM ${witnessRows} w WHERE w.key=CAST(l.id AS TEXT)))))`;

const invoiceUnique = `NOT EXISTS (SELECT 1 FROM wr_order_links w WHERE w.wr_order_id=l.wr_order_id AND w.id<>l.id)`;
const boundInvoice = `(COALESCE(l.wr_order_id,'')!='' AND l.request_sent_at IS NOT NULL AND ${invoiceUnique})`;
// With no original item ID, accept only the completion writer's canonical
// two-way binding and matching encrypted delivery from the newly owned invoice.
const reboundCompletion = `(${boundInvoice} AND l.status='completed' AND l.completed_at IS NOT NULL
    AND (i.id=l.fulfillment_item_id AND i.wr_link_id=l.id)
    AND i.id=(SELECT r.id FROM fulfillment_items r JOIN product_variants v ON v.id=r.variant_id
      WHERE r.order_code=l.order_code AND v.wr_variant_id=l.wr_variant_id ORDER BY r.item_index LIMIT 1)
    AND (i.status='delivered' AND NOT ${manual} AND i.delivered_message_id='wr:' || i.id)
    AND (i.delivered_ciphertext=l.wr_account_details AND i.delivered_iv=l.wr_account_iv))`;
const witnessItems = `FROM wr_order_links l LEFT JOIN fulfillment_items i ON i.id=COALESCE(${witnessItem},l.fulfillment_item_id)
  WHERE ${witnessLink}`;
const witnessOwnership = `NOT EXISTS (SELECT 1 FROM ${witnessRows} p WHERE NOT EXISTS (
  SELECT 1 ${witnessItems} AND ((${witnessItem} IS NULL AND ${unbound}) OR (${owns}))))`;
const voided = `(l.status='failed' AND l.request_sent_at IS NULL AND ${isVoid} AND ${witnessVoid}=0
  AND (COALESCE(l.wr_order_id,'')='' OR ${invoiceUnique}))`;
const handedOver = `(i.status='delivered' AND i.delivered_message_id='manual' AND i.last_error LIKE 'manual_handover:%')`;
// Every source must be explained. Missing, moved or multiply owned rows and
// replaced error text without authoritative terminal evidence are not handback.
const allSuperseded = `(json_type(${payload})='object' AND NOT ${legacyMarker}
  AND EXISTS (SELECT 1 FROM ${witnessRows}) AND NOT EXISTS (SELECT 1 FROM ${witnessRows} p
    WHERE NOT EXISTS (SELECT 1 ${witnessItems} AND (
      (${witnessItem} IS NULL AND ${unbound} AND (${voided} OR (${boundInvoice} AND l.status IN ('completed','failed'))))
      OR (${owns} AND CASE WHEN ${witnessItem} IS NULL THEN ${reboundCompletion} ELSE (
        ${handedOver}
        OR (${voided} AND i.status='failed' AND NOT ${manual} AND i.last_error=${witnessTag})
        OR (${boundInvoice} AND ((l.status='completed' AND i.status='delivered' AND i.delivered_message_id='wr:' || i.id)
          OR (l.status='failed' AND i.status='failed' AND NOT ${manual} AND i.last_error IS l.last_error AND i.last_error IS NOT ${witnessTag})))
      ) END)))))`;
const noInFlightNotice = `NOT EXISTS (SELECT 1 FROM buyer_notice_log n WHERE n.idempotency_key IN
  ('email:delivery-failed:' || o.code, 'telegram:delivery-failed:' || o.code) AND n.status='sending')`;

type LinkWork = { id: number; token: string; code: string };
type LinkOutcome = { orderToken: string } | "protected" | "conflict" | "ineligible" | "race";

export async function settleWrFinalLink(db: DatabaseAccess, { id, token, code }: LinkWork): Promise<LinkOutcome> {
  const sql = `FROM wr_order_links l JOIN orders o ON o.code=l.order_code
    WHERE l.id=? AND substr(l.wr_final_settle_token,1,36)=? AND o.code=? AND ${liveLink}`;
  const args = [id, token, code];
  const legacyUnbound = `(${unbound} AND substr(l.wr_final_settle_token,37)=':u')`;
  const ownedItem = `FROM fulfillment_items i WHERE (i.id=l.fulfillment_item_id OR i.wr_link_id=l.id) AND ${owns}`;
  const definitelyProtected = `((${orderProtected} AND (${legacyUnbound} OR EXISTS (SELECT 1 ${ownedItem})))
    OR EXISTS (SELECT 1 ${ownedItem} AND (i.status='delivered' OR ${manual})))`;
  const match = await db.queryFirst(`SELECT (${PURCHASE_PAID_SQL_ALIASED}) AS eligible, ${definitelyProtected} AS protected,
    ${legacyUnbound} AS unbound, (SELECT i.id ${ownedItem}) AS item_id ${sql}`, ...args);
  if (!match) return "race";
  if (!Number(match.eligible)) return "ineligible";
  const ack = `UPDATE wr_order_links SET wr_final_settle_token=NULL WHERE id=? AND substr(wr_final_settle_token,1,36)=?`;
  const itemId = Number(match.item_id);
  const legacy = Number(match.unbound) === 1;
  const tag = `wr_final:${id}:${token}`;
  if (!legacy && !itemId) return "conflict";
  const protectedLink = Number(match.protected) === 1;
  if (protectedLink) {
    const cleared = await db.execRun(`${ack} AND EXISTS (SELECT 1 ${sql} AND ${PURCHASE_PAID_SQL_ALIASED} AND ${definitelyProtected} AND ${noUnownedFailure}
      AND NOT EXISTS (SELECT 1 ${ownedItem} AND i.status='failed' AND NOT ${manual} AND i.last_error=?))`, id, token, ...args, tag);
    if (Number(cleared.changes)) return "protected";
    // A partial handover after the item CAS may have protected the order.
    // Pass responsibility on only if the already-written exact item proof survives.
    if (legacy) return "race";
  } else if (!legacy) {
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
  const eligible = legacy ? legacyUnbound : `EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.id=? AND ${owns}
    AND i.status='failed' AND NOT ${manual} AND i.last_error=?)`;
  const mayHandoff = protectedLink ? "o.fulfillment_status='manual_required'" : `NOT (${orderProtected})`;
  const results = await d1.batch([
    d1.prepare(`UPDATE orders SET wr_aggregate_refresh_token=? || json_set(
        CASE WHEN wr_aggregate_refresh_token IS NULL THEN json_object('links',json('{}'))
          WHEN json_type(${markerPayload("wr_aggregate_refresh_token")})='array'
            THEN json_object('links',json('{}'),'legacy',json(${markerPayload("wr_aggregate_refresh_token")}))
          ELSE json_remove(substr(wr_aggregate_refresh_token,37),'$.handback') END,
        '$.links.' || CAST(? AS INTEGER), json((SELECT json_array(CAST(? AS INTEGER),?,${isVoid}) FROM wr_order_links l WHERE l.id=?)))
      WHERE code=? AND EXISTS (SELECT 1 ${sql} AND ${PURCHASE_PAID_SQL_ALIASED} AND ${mayHandoff} AND ${eligible})`)
      .bind(nonce, id, legacy ? null : itemId, token, id, code, ...args, ...(legacy ? [] : [itemId, tag])),
    d1.prepare(`${ack} AND EXISTS (SELECT 1 FROM orders o WHERE o.code=? AND substr(o.wr_aggregate_refresh_token,1,36)=?)`)
      .bind(id, token, code, nonce),
  ]);
  return Number(results[1].meta.changes) ? { orderToken: nonce } : "race";
}

export async function settleWrFinalAggregate(db: DatabaseAccess, code: string, token: string): Promise<string> {
  const generation = token.slice(0, 36);
  const matches = `substr(o.wr_aggregate_refresh_token,1,36)=?`;
  const ready = `${matches} AND ${PURCHASE_PAID_SQL_ALIASED} AND ${NO_ACTIVE_WR_SIBLINGS}`;
  const handback = `json_extract(${payload},'$.handback') IS 1`;
  // The durable handback generation still owns the normal failure notice key;
  // clearing before the strict ledger claim would lose the notice on a crash.
  const handedBack = token[36] === "{" && (JSON.parse(token.slice(36)) as { handback?: number }).handback === 1;
  const terminalItems = `EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.order_code=o.code)`;
  if (handedBack) return finishSupersededAggregate(db, code, { sql: `${ready} AND ${handback} AND ${allSuperseded} AND ${terminalItems}`, params: [generation] });
  const guard = { sql: `${ready} AND ${aggregateProof} AND ${witnessOwnership}`, params: [generation] };
  const { refreshOrderAggregate } = await import("./deliver");
  const outcome = await refreshOrderAggregate(code, db, { guard, legacySql: unboundProof, supersededSql: allSuperseded, failedItemSql: failedItem });
  if (outcome === "superseded") {
    const changed = await db.execRun(`UPDATE orders AS o SET wr_aggregate_refresh_token=? || json_set(${payload},'$.handback',1)
      WHERE code=? AND ${ready} AND ${allSuperseded} AND ${terminalItems} AND NOT (${aggregateProof}) AND ${noInFlightNotice}`,
    crypto.randomUUID(), code, generation);
    return Number(changed.changes) ? "superseded" : "race";
  }
  const noticeSql = outcome === "protected_notice"
    ? `${guard.sql} AND o.fulfillment_status='manual_required' AND ${failedItem}`
    : `${guard.sql} AND o.fulfillment_status='failed'`;
  if (outcome === "changed" || outcome === "already_valid" || outcome === "protected_notice") {
    const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
    if (!await notifyBuyerDeliveryFailed(code, db, { ...guard, sql: noticeSql })) return "notice_pending";
  } else if (outcome !== "protected") return outcome;
  const cleared = await db.execRun(`UPDATE orders AS o SET wr_aggregate_refresh_token=NULL WHERE code=? AND
    ${outcome === "protected" ? `${ready} AND ${orderProtected} AND NOT ${anyFailedItem} AND ${witnessOwnership}` : noticeSql}
    AND ${noInFlightNotice}`, code, generation);
  return Number(cleared.changes) ? outcome : "race";
}

async function finishSupersededAggregate(db: DatabaseAccess, code: string, guard: { sql: string; params: unknown[] }) {
  // Match normal item-based aggregation. An authoritative delivered/manual
  // order is not overwritten; an explicitly failed sibling can still need the
  // ordinary failure notice after a partial admin handover (manual_required).
  const notice = `(${failedItem} AND o.fulfillment_status!='delivered')`;
  const updated = await db.execRun(`UPDATE orders AS o SET
    fulfillment_status=CASE WHEN ${orderProtected} THEN fulfillment_status
      WHEN ${failedItem} THEN 'failed'
      WHEN NOT EXISTS (SELECT 1 FROM fulfillment_items i WHERE i.order_code=o.code AND i.status!='delivered') THEN 'delivered'
      ELSE 'manual_required' END,
    updated_at=datetime('now') WHERE code=? AND (${guard.sql})`, code, ...guard.params);
  if (!Number(updated.changes)) return "race";
  const pending = (await db.queryFirst(`SELECT ${notice} AS due FROM orders o WHERE code=? AND (${guard.sql})`, code, ...guard.params))?.due;
  if (pending == null) return "race";
  if (Number(pending)) {
    const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
    if (!await notifyBuyerDeliveryFailed(code, db, { ...guard, sql: `${guard.sql} AND ${notice}` })) return "notice_pending";
  }
  const cleared = await db.execRun(`UPDATE orders AS o SET wr_aggregate_refresh_token=NULL WHERE code=? AND (${guard.sql})
    AND ${Number(pending) ? notice : `NOT ${anyFailedItem}`} AND ${noInFlightNotice}`, code, ...guard.params);
  return Number(cleared.changes) ? "already_valid" : "race";
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
    if (typeof result !== "string" || ["protected", "protected_notice", "changed", "already_valid"].includes(result)) out.settled++;
    else {
      out.pending++;
      out.reasons[result] = (out.reasons[result] ?? 0) + 1;
    }
  }
  return out;
}
