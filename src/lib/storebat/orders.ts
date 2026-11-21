import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { encryptSecret, decryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { storebatEligibility } from "@/lib/buyer-fields";
import { claimLink, PAID_ORDER_SQL as PAID } from "@/lib/suppliers/link-lease";
import { isStorebatConfigured, isStorebatEnabled, fetchStorebatBalance, fetchStorebatQuote, parseStorebatBalance, parseStorebatQuote, fetchStorebatOrder, lookupStorebatOrder, money, positiveId, record, validInvite, validReference, type StorebatRaw } from "./client";
import { buyStorebatProduct } from "./purchase";

type Row = Record<string, unknown>;
type ReceiptSource = "purchase" | "poll" | "lookup";
export const STOREBAT_ORDERS_PER_RUN = 8;
export const STOREBAT_ORPHANS_PER_RUN = 8;
const ENABLED = () => isStorebatConfigured() && isStorebatEnabled();
const UNOWNED = "wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND aivault_link_id IS NULL AND mirai_link_id IS NULL AND inventory_id IS NULL";
const MANUAL_SOURCE = `p.source='manual' AND p.fulfillment_mode='manual' AND p.is_active=1 AND p.archived_at IS NULL AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.tunvn_family IS NULL AND p.aivault_family IS NULL AND p.mirai_family IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0
    AND v.is_active=1 AND v.fulfillment_mode='manual' AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL AND v.tunvn_source_product_id IS NULL AND v.tunvn_buff_quantity_b IS NULL AND v.aivault_service_id IS NULL AND v.mirai_package_code IS NULL`;
const paid = (o: Row) => o.status === "lunas" && o.payment_status === "paid" && Number(o.supplier_purchase_disabled) === 0 && (o.order_kind ?? "apps") === "apps" && ["web","telegram"].includes(String(o.sales_channel));
function lines(o: Row): unknown[] { try { const items: unknown = JSON.parse(String(o.items)); return Array.isArray(items) ? items : []; } catch { return []; } }
export function eligibleStorebatLine(item: unknown) {
  if (!record(item) || item.unique_units || !record(item.storebat_eligibility) || !positiveId(item.variant_id) || !positiveId(item.product_id)) return null;
  const e = item.storebat_eligibility, buff = e.kind === "muse_buff";
  if (e.version !== 1 || e.source_variant_id !== item.variant_id || e.quantity !== item.qty || typeof e.cost_usd !== "number" || !money(e.cost_usd) || typeof e.fx_idr_per_usd !== "number" || !money(e.fx_idr_per_usd) || !positiveId(item.qty) || !positiveId(e.product_id)) return null;
  const invite = buff && record(item.buyer_fields) ? item.buyer_fields.muse_invite_code : undefined;
  const checked = storebatEligibility({ id:item.variant_id, sku:e.sku, storebat_family:e.family, storebat_product_id:e.product_id, buyer_field_key:item.buyer_field_key, max_qty:item.max_qty },item.qty);
  if (!checked || checked.kind !== e.kind || (buff && !validInvite(invite))) return null;
  return { ...checked, cost_usd:e.cost_usd, fx_idr_per_usd:e.fx_idr_per_usd, invite:validInvite(invite) ? invite : undefined, variantId:item.variant_id, productId:item.product_id };
}
export const STOREBAT_RETRYABLE_SQL = `status='needs_admin' AND attempt_count=0 AND request_sent_at IS NULL AND provider_order_id IS NULL
  AND receipt_ciphertext IS NULL AND receipt_iv IS NULL AND completed_at IS NULL
  AND last_error IN ('quote_unavailable','stock_unavailable','blocked_balance','price_increased','preflight_unavailable')
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND order_code IN(SELECT code FROM orders WHERE ${PAID})
  AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.storebat_link_id=storebat_order_links.id AND f.order_code=storebat_order_links.order_code AND f.item_index=storebat_order_links.item_index
    AND f.status IN ('queued','retry','failed','manual_required') AND f.fulfillment_mode='manual' AND f.delivered_ciphertext IS NULL AND f.delivered_iv IS NULL AND ${UNOWNED})`;

export async function createStorebatOrderLinks(code: string, db: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  if (!db.d1 || !ENABLED() || !db.canSpend(3)) return 0;
  const order = await db.queryFirst(`SELECT items FROM orders WHERE code=? AND ${PAID}`,code);
  if (!order) return 0;
  const items = lines(order).flatMap((item, index) => {
    const e = eligibleStorebatLine(item), key = `${code}-${index}`;
    return e && validReference(key) ? [{ index, key, variant:e.variantId, product:e.productId, upstream:e.product_id, kind:e.kind, qty:e.quantity, cost:e.cost_usd, fx:e.fx_idr_per_usd }] : [];
  });
  if (!items.length) return 0;
  const r = await db.execRun(`INSERT INTO storebat_order_links(order_code,item_index,variant_id,product_id,storebat_product_id,kind,quantity,cost_usd,idempotency_key,fx_idr_per_usd)
    SELECT code,j.value->>'index',j.value->>'variant',j.value->>'product',j.value->>'upstream',j.value->>'kind',j.value->>'qty',j.value->>'cost',j.value->>'key',j.value->>'fx'
    FROM orders JOIN json_each(?) j WHERE code=? AND items=? AND ${PAID} ON CONFLICT(order_code,item_index) DO NOTHING`,JSON.stringify(items),code,order.items);
  return Number(r.changes ?? 0);
}

async function settle(db: DatabaseAccess, l: Row, status: string, error: string | null, delay = 60) {
  const r = await db.execRun(`UPDATE storebat_order_links SET status=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,
    next_attempt_at=datetime('now','+'||?||' seconds'),completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND status='claimed' AND datetime(lease_expires_at)>datetime('now')`,status,error,delay,status,l.id,l.lease_owner);
  if (r.changes && status === "needs_admin") {
    await db.execRun(`UPDATE fulfillment_items SET status='manual_required',last_error='supplier_needs_admin',locked_until=NULL
      WHERE storebat_link_id=? AND status NOT IN ('delivered','sending') AND EXISTS(SELECT 1 FROM storebat_order_links WHERE id=? AND status='needs_admin' AND lease_owner IS NULL)`,l.id,l.id);
    const { escalateSupplierManual } = await import("@/lib/fulfillment/supplier-escalation");
    await escalateSupplierManual(db,String(l.order_code),"storebat",l.id);
  }
}
const backoff = (l: Row, r?: StorebatRaw) => Math.max(Number(l.attempt_count) <= 1 ? 120 : 240, r?.retryAfter ?? 0);
const REVIEW = new Set([400,401,402,403,404,409,422]);
const errorCode = (status: number) => status === 402 ? "blocked_balance" : `http_${status}`;
function json(r: StorebatRaw): Row | null { try { const v: unknown = JSON.parse(r.text); return record(v) ? v : null; } catch { return null; } }
async function saveReceipt(db: DatabaseAccess, l: Row, r: StorebatRaw, source: ReceiptSource) {
  const sealed = await encryptSecret(r.text);
  return (await db.execRun(`UPDATE storebat_order_links SET receipt_ciphertext=?,receipt_iv=?,receipt_http_status=?,receipt_source=?,receipt_retry_after=?,updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND attempt_count=? AND status='claimed' AND datetime(lease_expires_at)>datetime('now')`,sealed.ciphertext,sealed.iv,r.status,source,r.retryAfter ?? 0,l.id,l.lease_owner,l.attempt_count)).changes === 1;
}
const ownerGuard = "id=? AND lease_owner=? AND status='claimed' AND datetime(lease_expires_at)>datetime('now')";

function museFulfillmentState(o: Row): string {
  if (typeof o.fulfillment_status === "string" && o.fulfillment_status) return o.fulfillment_status;
  if (o.state === "queued" || o.state === "pending") return "pending";
  if (o.state === "succeeded" || (o.state === "done" && o.status === "COMPLETED")) return "succeeded";
  if (o.state === "failed_refunded" || o.state === "refunded" || o.status === "REFUNDED") return "failed_refunded";
  return String(o.state ?? "");
}

function isPendingSavedOrder(v: Row | null, buff: boolean): boolean {
  if (!v || !record(v.order)) return false;
  return buff ? museFulfillmentState(v.order) === "pending" : v.order.status === "PAID_PENDING_DELIVERY";
}

async function acceptOrder(db: DatabaseAccess, l: Row, r: StorebatRaw): Promise<boolean> {
  if (REVIEW.has(r.status) || (r.status >= 300 && r.status < 400)) { await settle(db,l,"needs_admin",errorCode(r.status)); return true; }
  if (r.status < 200 || r.status >= 300) return false;
  const v = json(r), o = v?.order;
  if (v?.success !== true || !record(o)) return false;
  const buff = l.kind === "muse_buff", cost = money(o.amount_usd);
  const idemOk = o.idempotency_key == null
    ? (buff
        ? (l.provider_order_id != null && o.id === l.provider_order_id)
        : (o.customer_reference === l.idempotency_key || (l.provider_order_id != null && o.id === l.provider_order_id && !o.customer_reference)))
    : o.idempotency_key === l.idempotency_key;
  if (!positiveId(o.id) || (l.provider_order_id != null && o.id !== l.provider_order_id) || o.quantity !== l.quantity || !idemOk || !cost
    || (buff ? o.service !== "muse_buff" || o.unit !== "billion_tokens" : o.product_id !== l.storebat_product_id || (Boolean(o.customer_reference) && o.customer_reference !== l.idempotency_key))) {
    await settle(db,l,"needs_admin","receipt_identity_mismatch"); return true;
  }
  const status = buff ? museFulfillmentState(o) : o.status;
  const refunded = buff ? money(o.refunded_usd) : null;
  const accounts = Array.isArray(o.items) ? o.items.flatMap(i => record(i) && typeof i.account_data === "string" && i.account_data.trim() ? [i.account_data] : []) : [];
  if (!(await db.execRun(`UPDATE storebat_order_links SET provider_order_id=?,refunded_usd=?,receipt_json=? WHERE ${ownerGuard}`,o.id,refunded,JSON.stringify({ charged_usd:cost, received:accounts.length, requested:l.quantity }),l.id,l.lease_owner)).changes) return true;
  l.provider_order_id = o.id;
  if (!buff && (o.delivery_type === "activation" || ["AWAITING_ACTIVATION_INFO","AWAITING_ACTIVATION"].includes(String(status)))) { await settle(db,l,"needs_admin","activation_required"); return true; }
  if (status === (buff ? "pending" : "PAID_PENDING_DELIVERY")) { await settle(db,l,"processing",null); return true; }
  if (status !== (buff ? "succeeded" : "COMPLETED")) {
    await settle(db,l,"needs_admin",status === "CANCELLED" ? "provider_cancelled" : status === "failed_refunded" ? "failed_refunded" : status === "review_required" ? "review_required" : "unknown_order_state"); return true;
  }
  if (!buff && (!["stock","supplier_api"].includes(String(o.delivery_type)) || accounts.length < Number(l.quantity))) { await settle(db,l,"needs_admin","incomplete_receipt"); return true; }
  const secret = buff ? null : await encryptSecret(accounts.slice(0,Number(l.quantity)).join("\n\n"));
  const saved = await db.execRun(`UPDATE fulfillment_items SET delivered_ciphertext=?,delivered_iv=?,status='queued',last_error=NULL,locked_until=NULL
    WHERE storebat_link_id=? AND order_code=? AND item_index=? AND status NOT IN ('delivered','sending') AND ${UNOWNED}
      AND EXISTS(SELECT 1 FROM storebat_order_links WHERE ${ownerGuard})`,secret?.ciphertext ?? null,secret?.iv ?? null,l.id,l.order_code,l.item_index,l.id,l.lease_owner);
  if (!saved.changes) { await settle(db,l,"needs_admin","fulfillment_owned_elsewhere"); return true; }
  await db.execRun(`UPDATE fulfillment_jobs SET status='queued',attempt_count=0,next_attempt_at=datetime('now'),locked_until=NULL WHERE order_code=? AND status IN ('delivered','manual_required','failed')`,l.order_code);
  await settle(db,l,"completed",null);
  return true;
}

/** A lookup cannot authorize delivery. Only the exact order GET can settle an adopted ID. */
async function recover(db: DatabaseAccess, l: Row): Promise<{ retryPost: boolean; rateLimited: boolean }> {
  const r = await lookupStorebatOrder(String(l.idempotency_key));
  const rateLimited = r.status === 429;
  if (!await saveReceipt(db,l,r,"lookup")) return { retryPost: false, rateLimited };
  if (r.status !== 404 && (REVIEW.has(r.status) || (r.status >= 300 && r.status < 400))) { await settle(db,l,"needs_admin",errorCode(r.status)); return { retryPost: false, rateLimited }; }
  const v = r.status === 200 ? json(r) : null;
  const match = v?.success === true && Array.isArray(v.results) ? v.results.filter(x=>record(x) && x.idempotency_key === l.idempotency_key) : [];
  const found: Row | null = match.length === 1 ? match[0] : null;
  if (found?.request_status === "completed" && record(found.order) && positiveId(found.order.id)) {
    const o = found.order;
    const matches = (o.idempotency_key == null || o.idempotency_key === l.idempotency_key) && (o.quantity == null || o.quantity === l.quantity)
      && (l.kind === "muse_buff" ? o.service == null || o.service === "muse_buff" : o.product_id == null || o.product_id === l.storebat_product_id);
    if (!matches) { await settle(db,l,"needs_admin","receipt_identity_mismatch"); return { retryPost: false, rateLimited }; }
    await db.execRun(`UPDATE storebat_order_links SET provider_order_id=? WHERE ${ownerGuard}`,o.id,l.id,l.lease_owner);
    await settle(db,l,"processing",null); return { retryPost: false, rateLimited };
  }
  if (found?.request_status === "failed_no_charge" && found.order == null) {
    if (Number(l.attempt_count) < 3) return { retryPost: true, rateLimited };
    await settle(db,l,"needs_admin","attempts_exhausted"); return { retryPost: false, rateLimited };
  }
  // A missing/uncertain lookup is not proof of no debit. Bounded read-only recovery.
  const sent = Date.parse(String(l.request_sent_at));
  await settle(db,l,Date.now()-sent > 86_400_000 ? "needs_admin" : "processing","lookup_unconfirmed",backoff(l,r));
  return { retryPost: false, rateLimited };
}

async function processLink(db: DatabaseAccess, id: number, deadlineMs = Infinity): Promise<{ claimed: boolean; rateLimited: boolean }> {
  const owner = crypto.randomUUID();
  const claim = await claimLink(db, "storebat", id, owner);
  if (!claim.changes) return { claimed: false, rateLimited: false };
  const l = await db.queryFirst("SELECT * FROM storebat_order_links WHERE id=? AND lease_owner=?",id,owner);
  if (!l) return { claimed: true, rateLimited: false };
  let rateLimited = false;
  try {
    const order = await db.queryFirst("SELECT * FROM orders WHERE code=?",l.order_code);
    const e = order ? eligibleStorebatLine(lines(order)[Number(l.item_index)]) : null;
    if (!order || !paid(order) || !e || e.product_id !== l.storebat_product_id || e.variantId !== l.variant_id || e.productId !== l.product_id || e.kind !== l.kind || e.quantity !== l.quantity || e.cost_usd !== l.cost_usd || e.fx_idr_per_usd !== l.fx_idr_per_usd || l.idempotency_key !== `${l.order_code}-${l.item_index}`) {
      await settle(db,l,"needs_admin","snapshot_mismatch"); return { claimed: true, rateLimited: false };
    }
    let f = await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",l.order_code,l.item_index);
    if (!f) { await ensureFulfillmentItems(order,db); f = await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",l.order_code,l.item_index); }
    if (!f) { await settle(db,l,"pending","fulfillment_missing"); return { claimed: true, rateLimited: false }; }
    const bound = await db.execRun(`UPDATE fulfillment_items SET storebat_link_id=? WHERE id=? AND (storebat_link_id IS NULL OR storebat_link_id=?) AND ${UNOWNED} AND status NOT IN ('delivered','sending')
      AND fulfillment_mode='manual' AND product_id=? AND variant_id=? AND qty=? AND EXISTS(SELECT 1 FROM storebat_order_links WHERE ${ownerGuard})`,id,f.id,id,l.product_id,l.variant_id,l.quantity,id,owner);
    if (!bound.changes) { await settle(db,l,"needs_admin","fulfillment_owned_elsewhere"); return { claimed: true, rateLimited: false }; }
    await encryptSecret("storebat-encryption-preflight");
    if (l.receipt_ciphertext && l.receipt_iv && l.receipt_source !== "lookup") {
      const saved = { status:Number(l.receipt_http_status),text:await decryptSecret(String(l.receipt_ciphertext),String(l.receipt_iv)),retryAfter:Number(l.receipt_retry_after ?? 0) };
      // A previous invocation may have crashed after recording a terminal result.
      const v = saved.status >= 200 && saved.status < 300 ? json(saved) : null;
      if (!isPendingSavedOrder(v, l.kind === "muse_buff") && await acceptOrder(db,l,saved)) return { claimed: true, rateLimited: false };
      // A crash between saving a pending purchase receipt and adopting the ID still needs adoption.
      if (!l.provider_order_id && record(v?.order) && await acceptOrder(db,l,saved)) return { claimed: true, rateLimited: false };
    }
    if (positiveId(l.provider_order_id)) {
      if (Date.now() >= deadlineMs) { await settle(db,l,"processing","poll_deferred"); return { claimed: true, rateLimited: false }; }
      const response = await fetchStorebatOrder(l.provider_order_id,l.kind === "muse_buff");
      if (response.status === 429) rateLimited = true;
      if (await saveReceipt(db,l,response,"poll") && !await acceptOrder(db,l,response)) await settle(db,l,"processing","poll_unavailable",Math.max(60,response.retryAfter ?? 0));
      return { claimed: true, rateLimited };
    }
    if (l.request_sent_at) {
      if (Date.now() >= deadlineMs) { await settle(db,l,"processing","lookup_deferred"); return { claimed: true, rateLimited: false }; }
      const recovered = await recover(db,l);
      if (recovered.rateLimited) rateLimited = true;
      if (!recovered.retryPost) return { claimed: true, rateLimited };
    }
    if (Date.now() >= deadlineMs) { await settle(db,l,"pending","dispatch_deferred"); return { claimed: true, rateLimited: false }; }
    if (l.request_sent_at && e.kind === "muse_buff" && (!l.invite_ciphertext || !l.invite_iv || await decryptSecret(String(l.invite_ciphertext),String(l.invite_iv)) !== e.invite)) {
      await settle(db,l,"needs_admin","snapshot_mismatch"); return { claimed: true, rateLimited: false };
    }
    const v = await db.queryFirst(`SELECT v.*,p.storebat_family,m.delivery_type,m.api_test,m.disappeared,s.available AS buff_available
      FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN storebat_products m ON m.id=v.storebat_product_id
      LEFT JOIN storebat_services s ON v.storebat_product_id=124 AND s.service='muse_buff' WHERE v.id=? AND p.id=? AND ${MANUAL_SOURCE}`,e.variantId,e.productId);
    if (!v || v.sku !== e.sku || v.storebat_family !== e.family || v.storebat_product_id !== e.product_id || storebatEligibility(v,e.quantity)?.kind !== e.kind) { await settle(db,l,"needs_admin","source_changed"); return { claimed: true, rateLimited: false }; }
    if (v.delivery_type === "activation" && e.kind === "product") { await settle(db,l,"needs_admin","activation_required"); return { claimed: true, rateLimited: false }; }
    if (e.kind === "muse_buff" ? v.buff_available !== 1 : (v.api_test !== 0 || v.disappeared !== 0 || !["stock","supplier_api"].includes(String(v.delivery_type)))) { await settle(db,l,"needs_admin","stock_unavailable"); return { claimed: true, rateLimited: false }; }
    const quote = await fetchStorebatQuote(e.product_id,e.quantity,e.invite);
    if (quote.kind === "http_error" && quote.status === 429) { await settle(db,l,"pending","quote_rate_limited",backoff(l,{ status:429,text:"",retryAfter:quote.retryAfter })); return { claimed: true, rateLimited: true }; }
    const q = quote.kind === "ok" ? parseStorebatQuote(quote.json,e.product_id,e.quantity,e.kind === "muse_buff") : null;
    let error = !q ? (quote.kind === "http_error" ? errorCode(quote.status) : "quote_unavailable") : null;
    if (q) {
      if (q.unit*e.quantity > e.cost_usd+1e-9 || q.total > e.cost_usd+1e-9) error = "price_increased";
      else if (e.kind === "product" && q.delivery === "activation") error = "activation_required";
      else if (e.kind === "product" && (!["stock","supplier_api"].includes(String(q.delivery)) || !Number.isSafeInteger(q.stock) || Number(q.stock) < e.quantity)) error = "stock_unavailable";
      else {
        // Muse quote does not report balance in the published OpenAPI.
        const result = q.balance === null && e.kind === "muse_buff" ? await fetchStorebatBalance() : null;
        if (result?.kind === "http_error" && result.status === 429) { await settle(db,l,"pending","balance_rate_limited",Math.max(60,result.retryAfter ?? 0)); return { claimed: true, rateLimited: true }; }
        const balance = q.balance ?? (result?.kind === "ok" ? parseStorebatBalance(result.json)?.balance : null);
        if (balance == null || balance < q.total) error = balance == null ? "preflight_unavailable" : "blocked_balance";
      }
    }
    if (error) { await settle(db,l,"needs_admin",error); return { claimed: true, rateLimited: false }; }
    if (Date.now() >= deadlineMs || !ENABLED()) { await settle(db,l,"pending","dispatch_deferred"); return { claimed: true, rateLimited: false }; }
    const sentAt = new Date().toISOString();
    const invite = e.invite && !l.request_sent_at ? await encryptSecret(e.invite) : null;
    const fence = await db.execRun(`UPDATE storebat_order_links SET request_sent_at=COALESCE(request_sent_at,?),attempt_count=attempt_count+1,
      invite_ciphertext=COALESCE(invite_ciphertext,?),invite_iv=COALESCE(invite_iv,?),
      receipt_ciphertext=NULL,receipt_iv=NULL,receipt_http_status=NULL,receipt_source=NULL,receipt_retry_after=NULL,next_attempt_at=datetime('now','+'||CASE WHEN attempt_count=0 THEN 120 ELSE 240 END||' seconds')
      WHERE ${ownerGuard} AND attempt_count=? AND attempt_count<3 AND provider_order_id IS NULL
      AND EXISTS(SELECT 1 FROM orders WHERE code=? AND items=? AND ${PAID})
      AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND storebat_link_id=? AND status NOT IN ('delivered','sending') AND ${UNOWNED} AND fulfillment_mode='manual' AND product_id=storebat_order_links.product_id AND variant_id=storebat_order_links.variant_id AND qty=storebat_order_links.quantity)
      AND EXISTS(SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.id=? AND ${MANUAL_SOURCE}
        AND v.storebat_product_id=? AND p.storebat_family=? AND v.sku=? AND v.buyer_field_key IS ? AND v.max_qty IS ?
        AND CASE WHEN v.storebat_product_id=124 THEN EXISTS(SELECT 1 FROM storebat_services WHERE service='muse_buff' AND available=1)
          ELSE EXISTS(SELECT 1 FROM storebat_products m WHERE m.id=v.storebat_product_id AND m.api_test=0 AND m.disappeared=0 AND m.delivery_type IN ('stock','supplier_api')) END)`,sentAt,invite?.ciphertext ?? null,invite?.iv ?? null,id,owner,l.attempt_count,l.order_code,order.items,f.id,id,e.variantId,e.productId,e.product_id,e.family,e.sku,v.buyer_field_key,v.max_qty);
    if (!fence.changes) { await settle(db,l,"needs_admin","send_guard_changed"); return { claimed: true, rateLimited: false }; }
    l.attempt_count = Number(l.attempt_count)+1; l.request_sent_at ??= sentAt;
    const response = await buyStorebatProduct(e.product_id,e.quantity,String(l.idempotency_key),e.invite);
    if (response.status === 429) rateLimited = true;
    if (await saveReceipt(db,l,response,"purchase") && !await acceptOrder(db,l,response)) await settle(db,l,"processing","lookup_required",backoff(l,response));
  } catch {
    if (l.provider_order_id) await settle(db,l,"processing","poll_unavailable").catch(()=>{});
    else if (l.request_sent_at) await settle(db,l,"processing","lookup_required",backoff(l)).catch(()=>{});
    else await settle(db,l,"needs_admin","preflight_unavailable").catch(()=>{});
  }
  return { claimed: true, rateLimited };
}

export async function retryStorebatOrder(db: DatabaseAccess, id: number) {
  if (!db.d1 || !ENABLED() || !db.canSpend(30)) return false;
  const r = await db.execRun(`UPDATE storebat_order_links SET status='pending',last_error=NULL,next_attempt_at=datetime('now'),lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND ${STOREBAT_RETRYABLE_SQL}`,id);
  if (!r.changes) return false;
  await processLink(db,id); return true;
}

export async function processStorebatOrders(db: DatabaseAccess = createDatabaseAccess(), options: { orderCode?: string; deadlineMs?: number; limit?: number } = {}) {
  const deadlineMs = options.deadlineMs ?? Infinity;
  if (!db.d1 || !ENABLED() || !db.canSpend(33) || Date.now() >= deadlineMs) return 0;
  const orphans = options.orderCode ? [{ code:options.orderCode }] : await db.queryAll(`SELECT o.code FROM orders o WHERE ${PAID}
    AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j WHERE j.value->>'$.storebat_eligibility.version'=1 AND j.value->>'$.storebat_eligibility.cost_usd'>0
      AND NOT EXISTS(SELECT 1 FROM storebat_order_links l WHERE l.order_code=o.code AND l.item_index=CAST(j.key AS INTEGER))) ORDER BY o.id LIMIT ?`, STOREBAT_ORPHANS_PER_RUN);
  for (const orphan of orphans) {
    if (Date.now() >= deadlineMs || !db.canSpend(30)) break;
    await createStorebatOrderLinks(String(orphan.code),db);
  }
  if (!db.canSpend(27) || Date.now() >= deadlineMs) return 0;
  const maxLinks = Math.max(1, Math.min(STOREBAT_ORDERS_PER_RUN, Math.floor(options.limit ?? STOREBAT_ORDERS_PER_RUN)));
  const due = await db.queryAll(`SELECT id FROM storebat_order_links WHERE status IN ('pending','claimed','processing') AND datetime(next_attempt_at)<=datetime('now')
    AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now')) ${options.orderCode ? "AND order_code=?" : ""} ORDER BY next_attempt_at,id LIMIT ?`,...(options.orderCode ? [options.orderCode] : []), maxLinks);
  let processed = 0;
  for (const l of due) {
    if (processed > 0 && (Date.now() >= deadlineMs || !db.canSpend(27))) break;
    const res = await processLink(db, Number(l.id), deadlineMs);
    if (res.claimed) processed++;
    if (res.rateLimited) break;
  }
  return processed;
}
