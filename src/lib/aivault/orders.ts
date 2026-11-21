import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { encryptSecret, decryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { isAivaultConfigured, isAivaultSyncEnabled, fetchAivaultQuote, fetchAivaultOrder, parseAivaultQuote, validServiceId, validProviderId, numeric, record } from "./client";
import { buyAivaultProduct } from "./purchase";
type Row = Record<string, unknown>;
export const AIVAULT_ORDERS_PER_RUN = 8;
export const AIVAULT_ORPHANS_PER_RUN = 8;
const paid = (o: Row) => o.status === "lunas" && o.payment_status === "paid" && (o.order_kind ?? "apps") === "apps" && !Number(o.supplier_purchase_disabled) && ["web","telegram"].includes(String(o.sales_channel));
function lines(o: Row): Row[] { try { const v: unknown = JSON.parse(String(o.items)); return Array.isArray(v) ? v.map(x => record(x) ? x : {}) : []; } catch { return []; } }
export function eligibleAivaultLine(value: unknown): Row | null {
  if (!record(value) || !record(value.aivault_eligibility) || value.unique_units) return null;
  const e = value.aivault_eligibility;
  return e.version === 1 && validServiceId(e.service_id) && e.source_variant_id === value.variant_id && e.quantity === value.qty
    && Number.isSafeInteger(value.qty) && Number(value.qty) >= 1 && Number(value.qty) <= 100
    && Number.isSafeInteger(value.variant_id) && Number(value.variant_id)>0 && Number.isSafeInteger(value.product_id) && Number(value.product_id)>0
    && typeof e.cost_usd === "number" && Number.isFinite(e.cost_usd) && e.cost_usd>0 ? e : null;
}
export const AIVAULT_RETRYABLE_SQL = `status='needs_admin' AND attempt_count=0 AND request_sent_at IS NULL AND provider_order_id IS NULL
  AND receipt_ciphertext IS NULL AND receipt_iv IS NULL AND completed_at IS NULL
  AND last_error IN ('quote_unavailable','stock_unavailable','insufficient_balance','price_conflict','price_increased','preflight_unavailable')
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=aivault_order_links.order_code AND o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram'))
  AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.aivault_link_id=aivault_order_links.id AND f.order_code=aivault_order_links.order_code AND f.item_index=aivault_order_links.item_index
    AND f.status IN ('queued','retry','failed','manual_required') AND f.fulfillment_mode='manual' AND f.delivered_ciphertext IS NULL AND f.delivered_iv IS NULL
    AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.storebat_link_id IS NULL AND f.mirai_link_id IS NULL AND f.inventory_id IS NULL)`;
export async function createAivaultOrderLinks(code: string, db: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  if (!db.d1 || !isAivaultConfigured() || !isAivaultSyncEnabled() || !db.canSpend(5)) return 0;
  const order = await db.queryFirst("SELECT * FROM orders WHERE code=?",code);
  if (!order || !paid(order)) return 0;
  const rows = lines(order).flatMap((item, index) => {
    const e = eligibleAivaultLine(item);
    return e
      ? [{ index, variant: item.variant_id, product: item.product_id, service: e.service_id, qty: item.qty, cost: e.cost_usd, key: `${code}-${index}` }]
      : [];
  });
  if (!rows.length) return 0;
  const r = await db.execRun(`INSERT OR IGNORE INTO aivault_order_links(order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,external_order_id,fx_idr_per_usd)
    SELECT o.code,j.value->>'index',j.value->>'variant',j.value->>'product',j.value->>'service',j.value->>'qty',j.value->>'cost',j.value->>'key',
      COALESCE((SELECT fx_idr_per_usd FROM aivault_products WHERE service_id=(j.value->>'service')),
        (SELECT CASE WHEN CAST(fx_rate_text AS REAL)>0 THEN CAST(fx_rate_text AS REAL) END FROM crypto_market_snapshot WHERE id=1))
    FROM orders o JOIN json_each(?) j
    WHERE o.code=? AND o.items=? AND o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram')`,JSON.stringify(rows),code,order.items);
  return Number(r.changes ?? 0);
}
async function settle(db: DatabaseAccess, link: Row, status: string, error: string | null) {
  const result=await db.execRun(`UPDATE aivault_order_links SET status=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,
    next_attempt_at=datetime('now',CASE WHEN ?='pending' THEN '+'||MAX(1,attempt_count*2)||' minutes' ELSE '+1 minute' END),
    completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END,updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND status!='completed'`,status,error,status,status,link.id,link.lease_owner);
  if (!result.changes) return;
  if (status === "needs_admin") {
    await db.execRun("UPDATE fulfillment_items SET status='manual_required',last_error='supplier_needs_admin',locked_until=NULL WHERE aivault_link_id=? AND status NOT IN ('delivered','sending') AND delivered_ciphertext IS NULL AND delivered_iv IS NULL AND EXISTS(SELECT 1 FROM aivault_order_links WHERE id=? AND status='needs_admin' AND lease_owner IS NULL)",link.id,link.id);
    const { escalateSupplierManual } = await import("@/lib/fulfillment/supplier-escalation");
    await escalateSupplierManual(db,String(link.order_code),"aivault",link.id);
  }
}
/** Pre-send failures (no POST yet): auto re-preflight 5x over ~30 min (2,4,8,16 min) before needs_admin; attempt_count untouched. */
async function retryPreflight(db: DatabaseAccess, link: Row, error: string) {
  const n=Number(link.preflight_attempts ?? 0)+1;
  if (n>=5) return settle(db,link,"needs_admin",error);
  await db.execRun(`UPDATE aivault_order_links SET preflight_attempts=?,status='pending',last_error=?,lease_owner=NULL,lease_expires_at=NULL,
    next_attempt_at=datetime('now','+'||?||' minutes'),updated_at=datetime('now') WHERE id=? AND lease_owner=? AND status!='completed'`,n,error,2**n,link.id,link.lease_owner);
}
async function deferRetry(db: DatabaseAccess, link: Row) {
  await settle(db,link,Number(link.attempt_count)>=3 ? "needs_admin" : "pending", Number(link.attempt_count)>=3 ? "attempts_exhausted" : "retry_same_external_id");
}
async function saveReceipt(db: DatabaseAccess, link: Row, r: { status: number; text: string }) {
  const sealed = await encryptSecret(r.text);
  return (await db.execRun(`UPDATE aivault_order_links SET receipt_ciphertext=?,receipt_iv=?,receipt_http_status=?,updated_at=datetime('now')
    WHERE id=? AND lease_owner=? AND attempt_count=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now')`,sealed.ciphertext,sealed.iv,r.status,link.id,link.lease_owner,link.attempt_count)).changes;
}
/** Replays omit external_order_id; a present value and a stored provider ID must still match. */
export function matchesAivaultReceiptReference(link: Row, json: Row, poll = false): boolean {
  if (link.provider_order_id != null && json.order_id!==link.provider_order_id) return false;
  return poll ? json.order_id===link.provider_order_id
    : json.external_order_id===link.external_order_id
      || (!Object.hasOwn(json,"external_order_id") && json.idempotent_replay===true);
}
/** false means safe idempotent replay, never a fresh external ID. Entire body already sealed. */
async function interpret(db: DatabaseAccess, link: Row, r: { status: number; text: string }, poll = false): Promise<boolean> {
  if (r.status===429 || r.status>=500) return false;
  if (r.status<200 || r.status>=300) {
    const error = r.status===402 ? "insufficient_balance" : r.status===409 ? "price_conflict" : `http_${r.status}`;
    await settle(db,link,"needs_admin",error); return true;
  }
  let json: unknown;
  try { json=JSON.parse(r.text); } catch { return false; }
  if (!record(json)) return false;
  const provider=validProviderId(json.order_id) ? json.order_id : null;
  const cost=numeric(json.total_cost);
  // The exact GET ID or POST echo/explicit replay must match the durable link.
  if (!provider || !matchesAivaultReceiptReference(link,json,poll)
    || json.service_id!==link.service_id || json.quantity!==link.quantity || json.currency!=="USD" || cost===null || cost<=0) {
    await settle(db,link,"needs_admin","receipt_identity_mismatch"); return true;
  }
  const products=Array.isArray(json.products) ? json.products : [];
  const credentials=products.every(x => typeof x==="string" && x.trim()) ? products as string[] : [];
  await db.execRun(`UPDATE aivault_order_links SET provider_order_id=?,receipt_json=? WHERE id=? AND lease_owner=? AND status!='completed'`,provider,JSON.stringify({ received:credentials.length, requested:link.quantity, charged_usd:cost }),link.id,link.lease_owner);
  // Keep the in-memory row in sync: a later transient D1 fault must poll the
  // known ID instead of downgrading a fulfilled order to needs_admin.
  link.provider_order_id=provider;
  if (json.status === "failed") { await settle(db,link,"needs_admin","provider_failed"); return true; }
  if (["queued","processing","pending"].includes(String(json.status))) { await settle(db,link,"processing",null); return true; }
  const success = poll ? json.status==="delivered" && r.status===200 : [200,201].includes(r.status) && json.success===true && (json.status==null || json.status==="delivered");
  if (!success || credentials.length<Number(link.quantity)) { await settle(db,link,"needs_admin","incomplete_receipt"); return true; }
  const secret=await encryptSecret(credentials.slice(0,Number(link.quantity)).join("\n\n"));
  const saved=await db.execRun(`UPDATE fulfillment_items SET delivered_ciphertext=?,delivered_iv=?,status='queued',last_error=NULL,locked_until=NULL
    WHERE aivault_link_id=? AND order_code=? AND item_index=? AND status NOT IN ('delivered','sending') AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND storebat_link_id IS NULL AND mirai_link_id IS NULL AND inventory_id IS NULL
    AND EXISTS(SELECT 1 FROM aivault_order_links WHERE id=? AND lease_owner=? AND status!='completed' AND datetime(lease_expires_at)>datetime('now'))`,secret.ciphertext,secret.iv,link.id,link.order_code,link.item_index,link.id,link.lease_owner);
  if (!saved.changes) { await settle(db,link,"needs_admin","fulfillment_owned_elsewhere"); return true; }
  // Queue before clearing the lease; a crash repeats this step from the encrypted receipt.
  await db.execRun(`UPDATE fulfillment_jobs SET status='queued',attempt_count=0,next_attempt_at=datetime('now'),locked_until=NULL WHERE order_code=? AND status IN ('delivered','manual_required','failed')`,link.order_code);
  await settle(db,link,"completed",null);
  return true;
}
async function processLink(db: DatabaseAccess, id: number, deadlineMs = Infinity): Promise<{ claimed: boolean; rateLimited: boolean }> {
  const owner=crypto.randomUUID();
  const claimed=await db.execRun(`UPDATE aivault_order_links SET lease_owner=?,lease_expires_at=datetime('now','+90 seconds'),status='claimed'
    WHERE id=? AND status IN ('pending','claimed','processing') AND datetime(next_attempt_at)<=datetime('now') AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))`,owner,id);
  if (!claimed.changes) return { claimed: false, rateLimited: false };
  const link=await db.queryFirst("SELECT * FROM aivault_order_links WHERE id=? AND lease_owner=?",id,owner);
  if (!link) return { claimed: true, rateLimited: false };
  let sent=false;
  let rateLimited=false;
  try {
    const order=await db.queryFirst("SELECT * FROM orders WHERE code=?",link.order_code);
    const item=order ? lines(order)[Number(link.item_index)] : null, e=eligibleAivaultLine(item);
    if (!order || !paid(order) || !item || !e || e.service_id!==link.service_id || e.cost_usd!==link.cost_usd || item.variant_id!==link.variant_id || item.product_id!==link.product_id || item.qty!==link.quantity || link.external_order_id!==`${link.order_code}-${link.item_index}`) { await settle(db,link,"needs_admin","snapshot_mismatch"); return { claimed: true, rateLimited: false }; }
    let fulfillment=await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",link.order_code,link.item_index);
    if (!fulfillment) { await ensureFulfillmentItems(order,db); fulfillment=await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",link.order_code,link.item_index); }
    if (!fulfillment) { await settle(db,link,"pending","fulfillment_missing"); return { claimed: true, rateLimited: false }; }
    if (fulfillment.product_id!==link.product_id || fulfillment.variant_id!==link.variant_id || fulfillment.qty!==link.quantity || fulfillment.fulfillment_mode!=="manual" || ["delivered","sending"].includes(String(fulfillment.status)) || fulfillment.inventory_id || fulfillment.wr_link_id || fulfillment.sk_link_id || fulfillment.tunvn_link_id || fulfillment.storebat_link_id || fulfillment.mirai_link_id || (fulfillment.aivault_link_id && fulfillment.aivault_link_id!==id)) { await settle(db,link,"needs_admin","fulfillment_owned_elsewhere"); return { claimed: true, rateLimited: false }; }
    const bound=await db.execRun(`UPDATE fulfillment_items SET aivault_link_id=? WHERE id=? AND (aivault_link_id IS NULL OR aivault_link_id=?) AND wr_link_id IS NULL AND sk_link_id IS NULL AND tunvn_link_id IS NULL AND storebat_link_id IS NULL AND mirai_link_id IS NULL AND inventory_id IS NULL AND status NOT IN ('delivered','sending')`,id,fulfillment.id,id);
    if (!bound.changes) { await settle(db,link,"needs_admin","fulfillment_owned_elsewhere"); return { claimed: true, rateLimited: false }; }
    if (link.provider_order_id) {
      if (Date.now()>=deadlineMs) { await settle(db,link,"processing","poll_deferred"); return { claimed: true, rateLimited: false }; }
      // One GET per invocation. next_attempt_at enforces a >=1 minute poll gap.
      const response=await fetchAivaultOrder(String(link.provider_order_id));
      if (response.status===429) rateLimited=true;
      if (!await saveReceipt(db,link,response)) return { claimed: true, rateLimited };
      if (!await interpret(db,link,response,true)) await settle(db,link,"processing","poll_unavailable");
      return { claimed: true, rateLimited };
    }
    if (link.receipt_ciphertext && link.receipt_iv && link.receipt_http_status) {
      const response={ status:Number(link.receipt_http_status),text:await decryptSecret(String(link.receipt_ciphertext),String(link.receipt_iv)) };
      if (await interpret(db,link,response)) return { claimed: true, rateLimited: false };
    }
    if (Number(link.attempt_count)>=3) { await settle(db,link,"needs_admin","attempts_exhausted"); return { claimed: true, rateLimited: false }; }
    if (Date.now()>=deadlineMs) { await settle(db,link,"pending","dispatch_deferred"); return { claimed: true, rateLimited: false }; }
    await encryptSecret("aivault-encryption-preflight");
    const variant=await db.queryFirst(`SELECT pv.*,p.source,p.is_active AS product_active,p.archived_at,p.aivault_family,p.tunvn_family,p.storebat_family,p.mirai_family,p.wr_product_id,p.sk_product_id,p.wr_auto_managed,p.sk_auto_managed
      FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=? AND pv.product_id=?`,link.variant_id,link.product_id);
    const identityOk=!!variant && variant.sku===`AV-${link.service_id}` && variant.aivault_service_id===link.service_id && !!variant.aivault_family && variant.fulfillment_mode==="manual" && variant.source==="manual" && !variant.wr_variant_id && !variant.sk_variant_id && !variant.tunvn_buff_quantity_b && !variant.tunvn_source_product_id && !variant.storebat_product_id && !variant.mirai_package_code && !variant.wr_product_id && !variant.sk_product_id && !Number(variant.wr_auto_managed) && !Number(variant.sk_auto_managed) && !variant.tunvn_family && !variant.storebat_family && !variant.mirai_family;
    // A POST that was already sent is recovered through the idempotent replay;
    // disabling or archiving the variant only stops NEW sales.
    const saleActive=Boolean(link.request_sent_at) || (!!variant && variant.is_active===1 && variant.product_active===1 && variant.archived_at==null);
    if (!identityOk || !saleActive) { await settle(db,link,"needs_admin","source_changed"); return { claimed: true, rateLimited: false }; }
    if (!link.request_sent_at) {
    const quote=await fetchAivaultQuote(String(link.service_id),Number(link.quantity));
    if (quote.kind==="ambiguous" && quote.reason==="http_429") rateLimited=true;
    const q=quote.kind==="ok" ? parseAivaultQuote(quote.json) : null;
    let error: string | null=null;
    if (!q || q.service_id!==link.service_id || q.quantity!==link.quantity) error="quote_unavailable";
    // Owner decision 2026-11-21: cap the live quote against the paid snapshot
    // (StoreBat/Mirai parity). More than 2% above `cost_usd` never POSTs.
    else if (q.final_total > Number(link.cost_usd) * 1.02 + 1e-9) error="price_increased";
    else if (q.stock<Number(link.quantity)) error="stock_unavailable";
    else if (!q.sufficient_balance) error="insufficient_balance";
    else if (q.price_conflict) error="price_conflict";
    if (error) { await (["quote_unavailable","stock_unavailable"].includes(error) ? retryPreflight(db,link,error) : settle(db,link,"needs_admin",error)); return { claimed: true, rateLimited }; }
    }
    if (Date.now()>=deadlineMs) { await settle(db,link,"pending","dispatch_deferred"); return { claimed: true, rateLimited: false }; }
    const activeFence=link.request_sent_at ? "" : "AND v.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL";
    const fenced=await db.execRun(`UPDATE aivault_order_links SET request_sent_at=COALESCE(request_sent_at,?),attempt_count=attempt_count+1,receipt_ciphertext=NULL,receipt_iv=NULL,receipt_http_status=NULL
      WHERE id=? AND lease_owner=? AND status='claimed' AND attempt_count=? AND attempt_count<3 AND datetime(lease_expires_at)>datetime('now')
      AND EXISTS(SELECT 1 FROM orders WHERE code=? AND items=? AND status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0)
      AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.id=? AND f.aivault_link_id=? AND f.status NOT IN ('delivered','sending') AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.tunvn_link_id IS NULL AND f.storebat_link_id IS NULL AND f.mirai_link_id IS NULL AND f.inventory_id IS NULL AND f.fulfillment_mode='manual' AND f.product_id=aivault_order_links.product_id AND f.variant_id=aivault_order_links.variant_id AND f.qty=aivault_order_links.quantity)
      AND EXISTS(SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.product_id=? AND v.aivault_service_id=? AND v.sku=? ${activeFence} AND v.fulfillment_mode='manual' AND p.source='manual' AND p.aivault_family IS ? AND v.wr_variant_id IS NULL AND v.sk_variant_id IS NULL AND v.tunvn_buff_quantity_b IS NULL AND v.tunvn_source_product_id IS NULL AND v.storebat_product_id IS NULL AND v.mirai_package_code IS NULL AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0 AND p.tunvn_family IS NULL AND p.storebat_family IS NULL AND p.mirai_family IS NULL)`,new Date().toISOString(),id,owner,link.attempt_count,link.order_code,order.items,fulfillment.id,id,link.variant_id,link.product_id,link.service_id,variant.sku,variant.aivault_family);
    if (!fenced.changes) { await settle(db,link,"needs_admin","send_guard_changed"); return { claimed: true, rateLimited: false }; }
    link.attempt_count=Number(link.attempt_count)+1; sent=true;
    const response=await buyAivaultProduct(String(link.service_id),Number(link.quantity),String(link.external_order_id));
    if (response.status===429) rateLimited=true;
    if (!await saveReceipt(db,link,response)) return { claimed: true, rateLimited };
    if (!await interpret(db,link,response)) await deferRetry(db,link);
  } catch {
    // Fixed metadata only; provider bodies/credentials never enter logs/errors.
    if (link.provider_order_id) await settle(db,link,"processing","poll_unavailable").catch(()=>{});
    else if (sent || link.request_sent_at) await deferRetry(db,link).catch(()=>{});
    else await retryPreflight(db,link,"preflight_unavailable").catch(()=>{});
  }
  return { claimed: true, rateLimited };
}
export async function retryAivaultOrder(db: DatabaseAccess, id: number): Promise<boolean> {
  if (!db.d1 || !isAivaultConfigured() || !isAivaultSyncEnabled() || !db.canSpend(30)) return false;
  const r=await db.execRun(`UPDATE aivault_order_links SET status='pending',last_error=NULL,preflight_attempts=0,next_attempt_at=datetime('now'),lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND ${AIVAULT_RETRYABLE_SQL}`,id);
  if (!r.changes) return false;
  await processLink(db,id); return true;
}
export async function processAivaultOrders(db: DatabaseAccess = createDatabaseAccess(), options: { orderCode?: string; deadlineMs?: number; limit?: number } = {}): Promise<number> {
  const deadlineMs = options.deadlineMs ?? Infinity;
  if (!db.d1 || !isAivaultConfigured() || !isAivaultSyncEnabled() || !db.canSpend(35) || Date.now() >= deadlineMs) return 0;
  // Match eligibleAivaultLine BEFORE LIMIT so an invalid older snapshot cannot
  // monopolize the 8 orphan slots and starve a valid younger order (TUNVN F5a).
  const item = "CASE WHEN j.type='object' THEN j.value ELSE '{}' END";
  const field = (path: string) => `json_extract(${item},'$.${path}')`;
  const type = (path: string) => `json_type(${item},'$.${path}')`;
  const integer = (path: string) => `(${type(path)}='integer' AND ${field(path)} BETWEEN 1 AND 9007199254740991)`;
  const orphans = options.orderCode ? [{ code: options.orderCode }] : await db.queryAll(`SELECT o.code FROM orders o WHERE o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram')
    AND json_type(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END)='array'
    AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
      WHERE j.type='object'
        AND ${type('aivault_eligibility')}='object'
        AND ${type('aivault_eligibility.version')}='integer' AND ${field('aivault_eligibility.version')}=1
        AND ${type('aivault_eligibility.service_id')}='text' AND length(CAST(${field('aivault_eligibility.service_id')} AS BLOB)) BETWEEN 1 AND 160
          AND ${field('aivault_eligibility.service_id')} NOT GLOB '*[^A-Za-z0-9_-]*'
        AND ${integer('aivault_eligibility.source_variant_id')} AND ${field('aivault_eligibility.source_variant_id')}=${field('variant_id')}
        AND ${integer('aivault_eligibility.quantity')} AND ${field('aivault_eligibility.quantity')}=${field('qty')}
        AND ${integer('qty')} AND ${field('qty')} BETWEEN 1 AND 100
        AND ${integer('variant_id')} AND ${integer('product_id')}
        AND ${type('aivault_eligibility.cost_usd')} IN ('integer','real') AND ${field('aivault_eligibility.cost_usd')}>0 AND ${field('aivault_eligibility.cost_usd')}<=1.7976931348623157e308
        AND (${type('unique_units')} IS NULL OR ${type('unique_units')} IN ('null','false')
          OR (${type('unique_units')}='integer' AND ${field('unique_units')}=0)
          OR (${type('unique_units')}='text' AND ${field('unique_units')}=''))
        AND NOT EXISTS(SELECT 1 FROM aivault_order_links l WHERE l.order_code=o.code AND l.item_index=CAST(j.key AS INTEGER)))
    ORDER BY o.id LIMIT ?`, AIVAULT_ORPHANS_PER_RUN);
  for (const orphan of orphans) {
    if (Date.now() >= deadlineMs || !db.canSpend(30)) break;
    await createAivaultOrderLinks(String(orphan.code), db);
  }
  if (!db.canSpend(25) || Date.now() >= deadlineMs) return 0;
  const maxLinks = Math.max(1, Math.min(AIVAULT_ORDERS_PER_RUN, Math.floor(options.limit ?? AIVAULT_ORDERS_PER_RUN)));
  const due = await db.queryAll(`SELECT id FROM aivault_order_links WHERE status IN ('pending','claimed','processing') AND datetime(next_attempt_at)<=datetime('now')
    AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now')) ${options.orderCode ? "AND order_code=?" : ""} ORDER BY next_attempt_at,id LIMIT ?`, ...(options.orderCode ? [options.orderCode] : []), maxLinks);
  let processed = 0;
  for (const link of due) {
    if (processed > 0 && (Date.now() >= deadlineMs || !db.canSpend(25))) break;
    const res = await processLink(db, Number(link.id), deadlineMs);
    if (res.claimed) processed++;
    if (res.rateLimited) break;
  }
  return processed;
}
