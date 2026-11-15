import { createDatabaseAccess,type DatabaseAccess } from "@/lib/db-access";
import { encryptSecret,decryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { notifyBuyerTunvnProcessing } from "@/lib/notify-buyer";
import { isTunvnConfigured,isTunvnSyncEnabled,fetchTunvnProducts,fetchTunvnBalance } from "./client";
import { buyTunvnProduct,orderTunvnBuff,tunvnRequest,tunvnBuffText,parseTunvnResponse,tunvnProviderId } from "./purchase";

type Row=Record<string,unknown>;
// A retry never clears a send fence. Legacy preflight failures also have zero attempts.
export const TUNVN_RETRYABLE_SQL = `status='needs_admin' AND attempt_count=0 AND request_sent_at IS NULL
  AND provider_order_group IS NULL AND provider_batch_id IS NULL AND provider_order_code IS NULL
  AND receipt_ciphertext IS NULL AND receipt_iv IS NULL AND receipt_http_status IS NULL AND receipt_json IS NULL AND completed_at IS NULL
  AND last_error IN ('insufficient_balance','balance_unavailable','catalog_unavailable','stock_unavailable','buff_unavailable','cost_changed','dispatch_unconfirmed')
  AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=tunvn_order_links.order_code AND o.status='lunas' AND o.payment_status='paid'
    AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps' AND o.sales_channel IN ('web','telegram'))
  AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.tunvn_link_id=tunvn_order_links.id
    AND f.order_code=tunvn_order_links.order_code AND f.item_index=tunvn_order_links.item_index
    AND f.status IN ('queued','retry','failed','manual_required') AND f.fulfillment_mode='manual'
    AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.inventory_id IS NULL AND f.delivered_ciphertext IS NULL AND f.delivered_iv IS NULL)`;
// ponytail: recover pre-send failures for 24h; older orders need explicit admin Retry.
const AUTO_RECOVERY_SQL = `((${TUNVN_RETRYABLE_SQL}) AND last_error!='dispatch_unconfirmed'
  AND EXISTS(SELECT 1 FROM orders o WHERE o.code=tunvn_order_links.order_code AND datetime(o.created_at)>datetime('now','-24 hours')))
  OR (status='needs_admin' AND last_error='dispatch_unconfirmed' AND request_sent_at IS NOT NULL
    AND receipt_ciphertext IS NOT NULL AND receipt_iv IS NOT NULL AND receipt_http_status IS NOT NULL)`;
class PreflightError extends Error {}
export function tunvnOrderLines(order:Row):Row[] {
  try { const items:unknown=JSON.parse(String(order.items ?? "[]")); return Array.isArray(items) ? items.map(item=>item && typeof item==="object" && !Array.isArray(item) ? item : {}) : []; } catch { return []; }
}
function paid(order:Row):boolean {
  return order.status==="lunas" && order.payment_status==="paid" && (order.order_kind ?? "apps")==="apps"
    && !Number(order.supplier_purchase_disabled) && ["web","telegram"].includes(String(order.sales_channel));
}
export function eligibleTunvnLine(value:unknown):Row|null {
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const item=value as Row;
  const e=item.tunvn_eligibility as Row|undefined;
  if (!e || e.version!==1 || e.source_variant_id!==item.variant_id || e.quantity!==item.qty
    || !Number.isSafeInteger(item.qty) || Number(item.qty)<1 || Number(item.qty)>100
    || !Number.isSafeInteger(item.product_id) || !Number.isSafeInteger(item.variant_id) || !Number.isFinite(e.cost_usdt) || Number(e.cost_usdt)<=0) return null;
  const sourceId=Number(e.source_product_id);
  if (e.kind==="account" && Number.isSafeInteger(sourceId) && sourceId>=1 && sourceId!==60 && e.source_unit_b===null && !item.unique_units) return e;
  const fields=item.buyer_fields as Row|undefined;
  if (e.kind==="buff" && e.source_product_id===null && e.source_unit_b===1 && Number(item.qty)<=30
    && item.buyer_field_key==="muse_invite_code" && item.max_qty===30 && /^[A-Za-z0-9]{6}$/.test(String(fields?.muse_invite_code ?? ""))) return e;
  return null;
}

/** One durable line per invocation; cron repairs any interruption before binding. */
export async function createTunvnOrderLinks(orderCode:string,db:DatabaseAccess=createDatabaseAccess()):Promise<number> {
  if (!db.d1 || !isTunvnConfigured() || !isTunvnSyncEnabled() || !db.canSpend(5)) return 0;
  const order=await db.queryFirst("SELECT * FROM orders WHERE code=?",orderCode);
  if (!order || !paid(order)) return 0;
  const lines=tunvnOrderLines(order);
  const existing=await db.queryAll("SELECT item_index FROM tunvn_order_links WHERE order_code=?",orderCode);
  for (let index=0;index<lines.length;index++) {
    const item=lines[index],e=eligibleTunvnLine(item);
    if (!e || existing.some(row=>row.item_index===index)) continue;
    const result=await db.execRun(`INSERT OR IGNORE INTO tunvn_order_links(order_code,item_index,variant_id,product_id,kind,source_product_id,quantity,invite_code,cost_usdt)
      SELECT code,?,?,?,?,?,?,?,? FROM orders WHERE code=? AND items=? AND status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0 AND COALESCE(order_kind,'apps')='apps'`,
      index,item.variant_id,item.product_id,e.kind,e.source_product_id,item.qty,e.kind==="buff" ? (item.buyer_fields as Row).muse_invite_code : null,e.cost_usdt,orderCode,order.items);
    await db.execRun(`UPDATE fulfillment_items SET tunvn_link_id=(SELECT id FROM tunvn_order_links WHERE order_code=? AND item_index=?) WHERE order_code=? AND item_index=? AND wr_link_id IS NULL AND sk_link_id IS NULL AND status!='delivered'`,orderCode,index,orderCode,index);
    return Number(result.changes ?? 0);
  }
  return 0;
}

async function settle(db:DatabaseAccess,link:Row,status:"completed"|"processing"|"needs_admin",error:string|null):Promise<void> {
  if (status==="completed") await db.execRun(`UPDATE fulfillment_jobs SET status='queued',attempt_count=0,next_attempt_at=datetime('now'),locked_until=NULL WHERE order_code=? AND status IN ('delivered','manual_required','failed') AND EXISTS(SELECT 1 FROM tunvn_order_links WHERE id=? AND lease_owner=? AND status!='completed')`,link.order_code,link.id,link.lease_owner);
  const settled=await db.execRun(`UPDATE tunvn_order_links SET status=?,last_error=?,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=datetime('now',CASE WHEN ?='needs_admin' THEN '+3 minutes' ELSE '+1 minute' END),updated_at=datetime('now'),completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END
    WHERE id=? AND lease_owner=? AND status!='completed'`,status,error,status,status,link.id,link.lease_owner);
  if (!settled.changes) return;
  if (status==="needs_admin") await db.execRun(`UPDATE fulfillment_items SET status='manual_required',last_error='supplier_needs_admin',locked_until=NULL WHERE tunvn_link_id=? AND status NOT IN ('delivered','sending')`,link.id);
}

async function preflight(link:Row):Promise<number> {
  await encryptSecret("tunvn-encryption-preflight"); // Fail BEFORE any charge.
  let price:number;
  let fundable=true;
  if (link.kind==="account") {
    const catalog=await fetchTunvnProducts();
    if (catalog.kind!=="ok") throw new PreflightError("catalog_unavailable");
    const product=catalog.items.find(item=>item.supplier_product_id===link.source_product_id);
    if (!product?.price_usdt || product.stock<Number(link.quantity)) throw new PreflightError("stock_unavailable");
    price=product.price_usdt*Number(link.quantity);
  } else {
    let response, value:Row;
    try {
      response=await tunvnRequest("buff/check",{ orders_text:tunvnBuffText(String(link.invite_code),Number(link.quantity)) });
      value=parseTunvnResponse(response.text);
    } catch { throw new PreflightError("buff_unavailable"); }
    const rows=value.orders_breakdown as Row[]|undefined;
    if (response.status!==200 || value.success!==true || typeof value.fundable!=="boolean" || !Array.isArray(rows) || rows.length!==1
      || !rows[0] || rows[0].invite_code!==link.invite_code || rows[0].quantity_b!==link.quantity || rows[0].valid!==true) throw new PreflightError("buff_unavailable");
    price=Number(value.sell_price_usdt);
    fundable=value.fundable;
  }
  if (!Number.isFinite(price) || price<=0) throw new PreflightError(link.kind==="buff" ? "buff_unavailable" : "catalog_unavailable");
  const balance=await fetchTunvnBalance();
  if (balance.kind!=="ok") throw new PreflightError("balance_unavailable");
  if (balance.balance_usdt<price) throw new PreflightError("insufficient_balance");
  if (!fundable) throw new PreflightError("buff_unavailable");
  // Upstream has no max_price or idempotency parameter. A later price/balance
  // race cannot be prevented by this read-only preflight; never invent a cap.
  return price;
}

async function finishReceipt(db:DatabaseAccess,link:Row,json:Row,status:number):Promise<void> {
  if (link.kind==="account") {
    const order=json.order as Row|undefined;
    const items=Array.isArray(json.items) ? json.items.filter((item):item is string=>typeof item==="string" && item.trim().length>0) : [];
    const group=tunvnProviderId(order?.order_group);
    const cost=Number(order?.total_price);
    const complete=status===200 && json.success===true && group && order?.quantity===link.quantity && String(order?.currency).toLowerCase()==="usdt"
      && Number.isFinite(cost) && cost>0 && Number.isSafeInteger(order?.total_items) && Number(order?.total_items)>=Number(link.quantity)
      && items.length===Number(order?.total_items) && items.length>=Number(link.quantity);
    await db.execRun("UPDATE tunvn_order_links SET provider_order_group=?,receipt_json=? WHERE id=? AND lease_owner=?",group,JSON.stringify({ received:items.length,requested:link.quantity,total_items:Number.isSafeInteger(order?.total_items) ? order!.total_items : null,charged_usdt:Number.isFinite(cost) ? cost : null }),link.id,link.lease_owner);
    if (!complete) { await settle(db,link,"needs_admin","incomplete_receipt"); return; }
    await notifyBuyerTunvnProcessing(String(link.order_code),Number(link.id),db);
    const secret=await encryptSecret(items.slice(0,Number(link.quantity)).join("\n\n"));
    await db.execRun(`UPDATE fulfillment_items SET delivered_ciphertext=?,delivered_iv=?,status='queued',last_error=NULL,locked_until=NULL WHERE tunvn_link_id=? AND status NOT IN ('delivered','sending') AND EXISTS(SELECT 1 FROM tunvn_order_links WHERE id=? AND lease_owner=?)`,secret.ciphertext,secret.iv,link.id,link.id,link.lease_owner);
    await settle(db,link,"completed",null);
    return;
  }
  const batch=tunvnProviderId(json.batch_id);
  const orders=Array.isArray(json.orders) ? json.orders as Row[] : [];
  const row=orders[0];
  if (batch) await db.execRun("UPDATE tunvn_order_links SET provider_batch_id=? WHERE id=? AND lease_owner=?",batch,link.id,link.lease_owner);
  if (status===202 && batch && orders.length===0) { await settle(db,link,"processing","awaiting_exact_status"); await notifyBuyerTunvnProcessing(String(link.order_code),Number(link.id),db); return; }
  if (![200,202].includes(status) || !batch || orders.length!==1 || row?.invite_code!==link.invite_code || row?.quantity_b!==link.quantity || !tunvnProviderId(row?.order_code) || String(json.currency ?? row.currency).toLowerCase()!=="usdt") {
    await settle(db,link,"needs_admin","unconfirmed_buff_receipt"); return;
  }
  const cost=Number(json.sell_price_usdt);
  await db.execRun("UPDATE tunvn_order_links SET provider_order_code=?,receipt_json=? WHERE id=? AND lease_owner=?",row.order_code,JSON.stringify({ accepted:true,http_status:status,charged_usdt:Number.isFinite(cost) ? cost : null }),link.id,link.lease_owner);
  await settle(db,link,"processing",null);
  await notifyBuyerTunvnProcessing(String(link.order_code),Number(link.id),db);
}

async function pollBuff(db:DatabaseAccess,link:Row):Promise<void> {
  await notifyBuyerTunvnProcessing(String(link.order_code),Number(link.id),db);
  let response, json:Row;
  try {
    response=await tunvnRequest("buff/status",undefined,String(link.provider_batch_id));
    json=parseTunvnResponse(response.text);
  } catch { await settle(db,link,"processing","buff_status_unavailable"); return; }
  if (response.status===429 || response.status>=500 || (response.status===200 && json.success!==true)) {
    await settle(db,link,"processing","buff_status_unavailable"); return;
  }
  const rows=Array.isArray(json.orders) ? json.orders as Row[] : [];
  const row=rows[0];
  if (response.status!==200 || json.success!==true || json.batch_id!==link.provider_batch_id || rows.length!==1
    || row?.invite_code!==link.invite_code || row?.quantity_b!==link.quantity || !tunvnProviderId(row?.order_code) || (link.provider_order_code && row.order_code!==link.provider_order_code) || String(row.currency).toLowerCase()!=="usdt") {
    await settle(db,link,"needs_admin","buff_identity_mismatch"); return;
  }
  if (!link.provider_order_code) await db.execRun("UPDATE tunvn_order_links SET provider_order_code=? WHERE id=? AND lease_owner=?",row.order_code,link.id,link.lease_owner);
  if (row.status==="done" && json.is_done===true) {
    await db.execRun("UPDATE fulfillment_items SET last_error='tunvn_buff_complete',status='queued',locked_until=NULL WHERE tunvn_link_id=? AND status NOT IN ('delivered','sending') AND EXISTS(SELECT 1 FROM tunvn_order_links WHERE id=? AND lease_owner=?)",link.id,link.id,link.lease_owner);
    await settle(db,link,"completed",null);
  } else if (row.status==="pending" && json.is_done===false) await settle(db,link,"processing",null);
  else await settle(db,link,"needs_admin","buff_needs_admin");
}

async function processLink(db:DatabaseAccess,id:number,reconcile=false):Promise<void> {
  const owner=crypto.randomUUID();
  const claimed=await db.execRun(`UPDATE tunvn_order_links SET lease_owner=?,lease_expires_at=datetime('now','+90 seconds'),status=CASE WHEN status='processing' OR ?=1 THEN 'processing' ELSE 'claimed' END
    WHERE id=? AND ${reconcile ? "kind='buff' AND provider_batch_id IS NOT NULL AND status IN ('processing','needs_admin')" : `(status IN ('pending','claimed','processing') OR (${AUTO_RECOVERY_SQL})) AND datetime(next_attempt_at)<=datetime('now')`} AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))`,owner,reconcile ? 1 : 0,id);
  if (!claimed.changes) return;
  const link=await db.queryFirst("SELECT * FROM tunvn_order_links WHERE id=? AND lease_owner=?",id,owner);
  if (!link) return;
  try {
    const order=await db.queryFirst("SELECT * FROM orders WHERE code=?",link.order_code);
    const item=order ? tunvnOrderLines(order)[Number(link.item_index)] : null;
    const e=item ? eligibleTunvnLine(item) : null;
    if (!order || !paid(order) || !e || e.kind!==link.kind || e.source_product_id!==link.source_product_id || item!.variant_id!==link.variant_id
      || item!.product_id!==link.product_id || item!.qty!==link.quantity || e.cost_usdt!==link.cost_usdt
      || (link.kind==="buff" && (item!.buyer_fields as Row)?.muse_invite_code!==link.invite_code)) { await settle(db,link,"needs_admin","snapshot_mismatch"); return; }
    let fulfillment=await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",link.order_code,link.item_index);
    if (!fulfillment) {
      await ensureFulfillmentItems(order,db,1);
      fulfillment=await db.queryFirst("SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?",link.order_code,link.item_index);
    }
    if (!fulfillment) { await db.execRun("UPDATE tunvn_order_links SET status='pending',lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=?",id,owner); return; }
    if (fulfillment.product_id!==link.product_id || fulfillment.variant_id!==link.variant_id || fulfillment.qty!==link.quantity || fulfillment.fulfillment_mode!=="manual" || ["delivered","sending"].includes(String(fulfillment.status)) || fulfillment.wr_link_id || fulfillment.sk_link_id || fulfillment.inventory_id || (fulfillment.tunvn_link_id && fulfillment.tunvn_link_id!==id)) { await settle(db,link,"needs_admin","fulfillment_owned_elsewhere"); return; }
    if (fulfillment.tunvn_link_id==null) await db.execRun("UPDATE fulfillment_items SET tunvn_link_id=? WHERE id=? AND tunvn_link_id IS NULL AND wr_link_id IS NULL AND sk_link_id IS NULL",id,fulfillment.id);
    if (link.provider_batch_id && link.status==="processing") { await pollBuff(db,link); return; }
    if (link.request_sent_at) {
      if (link.receipt_ciphertext && link.receipt_iv && link.receipt_http_status) {
        await finishReceipt(db,link,parseTunvnResponse(await decryptSecret(String(link.receipt_ciphertext),String(link.receipt_iv))),Number(link.receipt_http_status));
      } else await settle(db,link,"needs_admin","sent_without_receipt");
      return;
    }
    if (Number(link.attempt_count)>=3) { await settle(db,link,"needs_admin","attempts_exhausted"); return; }
    const variant=await db.queryFirst(`SELECT pv.sku,pv.tunvn_buff_quantity_b,pv.tunvn_source_product_id,pv.buyer_field_key,pv.max_qty,pv.fulfillment_mode,pv.is_active,p.slug,p.is_active AS product_active,pv.wr_variant_id,pv.sk_variant_id,p.source,p.wr_product_id,p.sk_product_id,p.wr_auto_managed,p.sk_auto_managed FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=? AND pv.product_id=?`,link.variant_id,link.product_id);
    const valid=variant && variant.fulfillment_mode==="manual" && variant.is_active===1 && variant.product_active===1 && !variant.wr_variant_id && !variant.sk_variant_id && !variant.wr_product_id && !variant.sk_product_id && !Number(variant.wr_auto_managed) && !Number(variant.sk_auto_managed) && variant.source==="manual" && (link.kind==="account"
      ? variant.sku===`TUNVN-${link.source_product_id}` && Number(variant.tunvn_source_product_id)===Number(link.source_product_id)
      : variant.slug==="muse-ai-1-miliar-token" && variant.sku==="TUNVN-BUFF-1B" && variant.tunvn_buff_quantity_b===1 && variant.buyer_field_key==="muse_invite_code" && variant.max_qty===30);
    if (!valid) { await settle(db,link,"needs_admin","source_changed"); return; }
    await preflight(link);
    const sent=await db.execRun(`UPDATE tunvn_order_links SET request_sent_at=?,attempt_count=attempt_count+1 WHERE id=? AND lease_owner=? AND status='claimed' AND attempt_count<3 AND request_sent_at IS NULL
      AND datetime(lease_expires_at)>datetime('now')
      AND EXISTS(SELECT 1 FROM orders WHERE code=? AND status='lunas' AND payment_status='paid' AND supplier_purchase_disabled=0 AND items=?)
      AND EXISTS(SELECT 1 FROM fulfillment_items f WHERE f.id=? AND f.tunvn_link_id=? AND f.status NOT IN ('delivered','sending') AND f.fulfillment_mode='manual' AND f.wr_link_id IS NULL AND f.sk_link_id IS NULL AND f.inventory_id IS NULL AND f.product_id=tunvn_order_links.product_id AND f.variant_id=tunvn_order_links.variant_id AND f.qty=tunvn_order_links.quantity)
      AND EXISTS(SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=? AND pv.product_id=? AND pv.sku=? AND p.slug=? AND p.source='manual' AND pv.fulfillment_mode='manual' AND pv.is_active=1 AND p.is_active=1 AND pv.wr_variant_id IS NULL AND pv.sk_variant_id IS NULL AND p.wr_product_id IS NULL AND p.sk_product_id IS NULL AND p.wr_auto_managed=0 AND p.sk_auto_managed=0 AND pv.buyer_field_key IS ? AND pv.max_qty IS ? AND pv.tunvn_buff_quantity_b IS ? AND pv.tunvn_source_product_id IS ?)`,new Date().toISOString(),id,owner,link.order_code,order.items,fulfillment.id,id,link.variant_id,link.product_id,variant!.sku,variant!.slug,variant!.buyer_field_key,variant!.max_qty,variant!.tunvn_buff_quantity_b,variant!.tunvn_source_product_id ?? null);
    if (!sent.changes) return;
    link.attempt_count=Number(link.attempt_count)+1;
    const response=link.kind==="account" ? await buyTunvnProduct(Number(link.source_product_id),Number(link.quantity)) : await orderTunvnBuff(String(link.invite_code),Number(link.quantity));
    const sealed=await encryptSecret(response.text);
    // Retain the entire response, even partial/extra credentials or invalid JSON.
    const saved=await db.execRun("UPDATE tunvn_order_links SET receipt_ciphertext=?,receipt_iv=?,receipt_http_status=? WHERE id=? AND attempt_count=? AND request_sent_at IS NOT NULL AND receipt_ciphertext IS NULL",sealed.ciphertext,sealed.iv,response.status,id,link.attempt_count);
    if (!saved.changes) return;
    const json=parseTunvnResponse(response.text);
    await finishReceipt(db,link,json,response.status);
  } catch (error) {
    // Never log provider bodies, credential values, invite codes or raw exceptions.
    await settle(db,link,"needs_admin",error instanceof PreflightError ? error.message : "dispatch_unconfirmed").catch(()=>{});
  }
}

export async function retryTunvnOrder(db:DatabaseAccess,id:number):Promise<boolean> {
  if (!db.d1 || !isTunvnConfigured() || !isTunvnSyncEnabled() || !db.canSpend(30)) return false;
  const queued=await db.execRun(`UPDATE tunvn_order_links SET status='pending',last_error=NULL,next_attempt_at=datetime('now'),lease_owner=NULL,lease_expires_at=NULL,updated_at=datetime('now') WHERE id=? AND ${TUNVN_RETRYABLE_SQL}`,id);
  if (!queued.changes) return false;
  await processLink(db,id);
  return true;
}

export async function processTunvnOrders(db:DatabaseAccess=createDatabaseAccess(),options:{ orderCode?:string;reconcileId?:number }={}):Promise<number> {
  if (!db.d1 || !isTunvnConfigured() || !isTunvnSyncEnabled() || !db.canSpend(30)) return 0;
  const orphan=options.reconcileId ? null : options.orderCode ? { code:options.orderCode } : await db.queryFirst(`SELECT o.code FROM orders o WHERE o.status='lunas' AND o.payment_status='paid' AND o.supplier_purchase_disabled=0 AND COALESCE(o.order_kind,'apps')='apps'
    AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j WHERE json_extract(j.value,'$.tunvn_eligibility.version')=1 AND json_extract(j.value,'$.tunvn_eligibility.cost_usdt')>0 AND NOT EXISTS(SELECT 1 FROM tunvn_order_links l WHERE l.order_code=o.code AND l.item_index=CAST(j.key AS INTEGER))) ORDER BY o.id LIMIT 1`);
  if (orphan) await createTunvnOrderLinks(String(orphan.code),db);
  if (!db.canSpend(30)) return 0;
  const link=await db.queryFirst(`SELECT id FROM tunvn_order_links WHERE ${options.reconcileId ? "status IN ('processing','needs_admin') AND kind='buff' AND provider_batch_id IS NOT NULL" : `(status IN ('pending','claimed','processing') OR (${AUTO_RECOVERY_SQL})) AND datetime(next_attempt_at)<=datetime('now')`}
    AND (lease_expires_at IS NULL OR datetime(lease_expires_at)<datetime('now'))
    ${options.orderCode ? "AND order_code=?" : ""} ${options.reconcileId ? "AND id=?" : ""} ORDER BY next_attempt_at,id LIMIT 1`,...(options.orderCode ? [options.orderCode] : []),...(options.reconcileId ? [options.reconcileId] : []));
  if (!link) return 0;
  await processLink(db,Number(link.id),Boolean(options.reconcileId));
  return 1;
}
