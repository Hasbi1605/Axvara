import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { createStorebatOrderLinks, processStorebatOrders, retryStorebatOrder } from "@/lib/storebat/orders";
import { publishStorebatCatalog } from "@/lib/storebat/catalog";
import { createD1Fixture, insertTestOrder, stubFulfillmentKey } from "./helpers/d1-fixture";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { product, buff, stubStorebatEnv } from "./helpers/storebat-fixture";

const code="AXV-20261118-SBTEST01", key=`${code}-0`;
let f: ReturnType<typeof createD1Fixture>;
let buy: () => Response, poll: () => Response, lookup: () => Response, unit: number, balance: number;
const order = (status="COMPLETED")=>({id:21,product_id:121,quantity:2,status,delivery_type:"supplier_api",customer_reference:key,idempotency_key:key,amount_usd:1,items:[{account_data:"fixture-A"},{account_data:"fixture-B"},{account_data:"fixture-extra"}]});
const muse = (state="succeeded", refunded_usd="0")=>({id:31,service:"muse_buff",unit:"billion_tokens",state,status:state,quantity:2,idempotency_key:key,amount_usd:"0.196",refunded_usd});
const response = (o: object) => Response.json({success:true,order:o});
const recovered = (state: string, order: object | null = null) => Response.json({success:true,results:[{request_status:state,idempotency_key:key,order}]});
const link=()=>f.sql.prepare("SELECT * FROM storebat_order_links").get();
const due=()=>f.sql.exec("UPDATE storebat_order_links SET next_attempt_at=datetime('now','-1 second')");
const purchases=()=>vi.mocked(fetch).mock.calls.filter(([url,init])=>new URL(String(url)).pathname.endsWith("/orders") && init?.method==="POST");
const tick=async()=>{const b=createBudgetedDatabase(40,2,f.db);await processStorebatOrders(b.access,{orderCode:code});expect(b.used).toBeLessThanOrEqual(38);};
function item(isBuff = false) {
  const v=f.sql.prepare("SELECT v.id,v.product_id,p.storebat_family FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?").get(isBuff?"SB-BUFF":"SB-121")!;
  return { product_id:Number(v.product_id),variant_id:Number(v.id),name:"Fixture",price:isBuff?2800:13500,qty:2,
    ...(isBuff ? {buyer_fields:{muse_invite_code:"a1B2c3"},buyer_field_key:"muse_invite_code",max_qty:30} : {}),
    storebat_eligibility:{version:1,kind:isBuff?"muse_buff":"product",sku:isBuff?"SB-BUFF":"SB-121",product_id:isBuff?124:121,family:v.storebat_family,source_variant_id:v.id,quantity:2,cost_usd:isBuff?0.196:1,fx_idr_per_usd:20000} };
}
const paid=(isBuff=false)=>insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item(isBuff)]});
beforeEach(async()=>{
  f=createD1Fixture();stubStorebatEnv();stubFulfillmentKey();
  f.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(1,'Fixture','order-root',100); INSERT INTO product_variants(id,product_id,sku,label,price) VALUES(1,1,'FIXTURE','Fixture',100)");
  buy=()=>response(order());poll=()=>response(order());lookup=()=>recovered("uncertain");unit=0.5;balance=5;
  vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
    const p=new URL(String(url)).pathname;
    if(p.endsWith("/products")) return Response.json({success:true,products:[product()],services:[buff]});
    if(p.endsWith("/muse-buff/quote")) return Response.json({success:true,quote:{product_id:124,quantity:2,unit:"billion_tokens",price_per_billion:"0.098",total_usd:"0.196"}});
    if(p.endsWith("/quote")) return Response.json({success:true,quote:{product_id:121,quantity:2,unit_price:unit,total:unit*2,stock:5,delivery_type:"supplier_api"},wallet_balance:balance});
    if(p.endsWith("/me")) return Response.json({success:true,wallet_balance:balance});
    if(p.endsWith("/lookup")) { expect(new URL(String(url)).searchParams.get("idempotency_key")).toBe(key);return lookup(); }
    if(p.endsWith("/orders") && init?.method==="POST"){expect(link()?.request_sent_at).toBeTruthy();expect(Number(link()?.attempt_count)).toBeGreaterThan(0);return buy();}
    if(/\/orders\/(21|31|123|456)$/.test(p)) return poll();
    throw new Error("unmocked request");
  }));
  expect(await publishStorebatCatalog(createDatabaseAccess(f.db),20000,{force:true})).toMatchObject({ok:true});
  f.sql.exec("UPDATE products SET is_active=1 WHERE storebat_family IS NOT NULL; UPDATE product_variants SET is_active=1 WHERE storebat_product_id IS NOT NULL");
  vi.mocked(fetch).mockClear();
});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("concurrent paid passes fence a single purchase and deliver only requested credentials",async()=>{
  paid();await Promise.all([tick(),tick(),tick()]);expect(purchases()).toHaveLength(1);
  expect(link()).toMatchObject({status:"completed",attempt_count:1,idempotency_key:key,provider_order_id:21});
  expect(JSON.parse(String(purchases()[0][1]?.body))).toEqual({product_id:121,quantity:2,idempotency_key:key,customer_reference:key});
  expect(await decryptSecret(String(link()?.receipt_ciphertext),String(link()?.receipt_iv))).toContain("fixture-extra");
  const row=f.sql.prepare("SELECT delivered_ciphertext,delivered_iv FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(row.delivered_ciphertext),String(row.delivered_iv))).toBe("fixture-A\n\nfixture-B");
});
it("polls pending no earlier than next tick without buying again",async()=>{
  paid();buy=()=>response(order("PAID_PENDING_DELIVERY"));await tick();expect(link()).toMatchObject({status:"processing",provider_order_id:21});
  await tick();expect(vi.mocked(fetch).mock.calls).toHaveLength(2);due();await tick();expect(link()?.status).toBe("completed");expect(purchases()).toHaveLength(1);
});
it.each([400,401,402,403,404,409,422])("status %s needs admin and forbids retry after send",async status=>{
  paid();buy=()=>Response.json({error:"fixture"},{status});await tick();
  expect(link()).toMatchObject({status:"needs_admin",attempt_count:1,last_error:status===402?"blocked_balance":`http_${status}`});
  expect(await retryStorebatOrder(createDatabaseAccess(f.db),Number(link()?.id))).toBe(false);
});
it.each(["AWAITING_ACTIVATION_INFO","AWAITING_ACTIVATION","CANCELLED"])("blocks delivery for %s",async status=>{
  paid();buy=()=>response(order(status));await tick();expect(link()?.status).toBe("needs_admin");
  expect(f.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items").get()?.delivered_ciphertext).toBeNull();
});
it("blocks missing snapshot, unpaid order, activation product and price increases",async()=>{
  insertTestOrder(f.sql,code,{status:"pending",channel:"web",items:[item()]});await tick();expect(link()).toBeUndefined();
  f.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'; UPDATE storebat_products SET delivery_type='activation'");await tick();
  expect(link()?.last_error).toBe("activation_required");expect(purchases()).toHaveLength(0);
  f.sql.exec("UPDATE storebat_products SET delivery_type='supplier_api'; UPDATE storebat_order_links SET status='pending',next_attempt_at=datetime('now')");unit=0.51;await tick();
  expect(link()?.last_error).toBe("price_increased");expect(purchases()).toHaveLength(0);
});
it("timeout adopts lookup ID then polls exact order, never purchases again",async()=>{
  paid();buy=()=>{throw new Error("fixture timeout");};await tick();expect(link()).toMatchObject({status:"processing",attempt_count:1});
  lookup=()=>recovered("completed",{id:21});due();await tick();expect(link()).toMatchObject({status:"processing",provider_order_id:21});
  due();await tick();expect(link()?.status).toBe("completed");expect(purchases()).toHaveLength(1);
});
it.each(["timeout","5xx","429","invalid_json"])("%s only replays exact body after failed_no_charge, max 3",async fault=>{
  paid();lookup=()=>recovered("failed_no_charge");buy=()=>{
    if(fault==="timeout")throw new Error("fixture timeout");
    if(fault==="5xx")return new Response("bad",{status:503});
    if(fault==="429")return new Response("slow",{status:429,headers:{"Retry-After":"900"}});
    return new Response("not json",{status:201});
  };
  await tick();if(fault==="429")expect(f.sql.prepare("SELECT unixepoch(next_attempt_at)-unixepoch('now') AS delay FROM storebat_order_links").get()?.delay).toBeGreaterThan(850);
  for(let i=0;i<4;i++){due();await tick();}
  expect(purchases()).toHaveLength(3);expect(new Set(purchases().map(([,init])=>init?.body)).size).toBe(1);
  expect(link()).toMatchObject({status:"needs_admin",last_error:"attempts_exhausted",attempt_count:3});
});
it.each(["in_progress","uncertain","not_found"])("lookup %s never authorizes replay",async status=>{
  paid();buy=()=>new Response("",{status:503});lookup=()=>status==="not_found"?new Response("",{status:404}):recovered(status);
  await tick();due();await tick();expect(link()).toMatchObject({status:"processing",last_error:"lookup_unconfirmed"});expect(purchases()).toHaveLength(1);
});
it.each(["succeeded","failed_refunded","review_required"])("Muse pending polls %s with preserved invite and no fake credentials",async state=>{
  paid(true);buy=()=>response(muse("pending"));poll=()=>response(muse(state,state==="failed_refunded"?"0.196":"0"));await tick();
  expect(JSON.parse(String(purchases()[0][1]?.body))).toEqual({invite_code:"a1B2c3",quantity:2,idempotency_key:key});
  due();await tick();expect(link()).toMatchObject({kind:"muse_buff",status:state==="succeeded"?"completed":"needs_admin",refunded_usd:state==="failed_refunded"?0.196:0});
  expect(f.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items").get()?.delivered_ciphertext).toBeNull();
});
it("admin can retry only pre-send balance failure and link retains frozen FX",async()=>{
  paid();balance=0;await tick();expect(link()).toMatchObject({status:"needs_admin",last_error:"blocked_balance",attempt_count:0,request_sent_at:null});
  balance=5;f.sql.exec("UPDATE product_variants SET storebat_fx_idr_per_usd=99999");expect(await retryStorebatOrder(createDatabaseAccess(f.db),Number(link()?.id))).toBe(true);
  expect(await createStorebatOrderLinks(code,createDatabaseAccess(f.db))).toBe(0);expect(link()).toMatchObject({status:"completed",fx_idr_per_usd:20000});
});
it("new web orders replace forged eligibility and exclude admin test purchases",async()=>{
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-buyer-key");
  const {createOrderWithStock}=await import("@/lib/db/orders-create");
  const snapshot={...item(true),storebat_eligibility:{...item(true).storebat_eligibility,cost_usd:0.01}};
  const create=(code:string,adminPaymentTest=false)=>createOrderWithStock({code,quoteId:`quote-${code}`,customerName:"Fixture",customerWa:"628000000000",customerEmail:"buyer@example.test",items:[snapshot as Parameters<typeof createOrderWithStock>[0]["items"][number]],subtotal:5600,paymentMethod:"qris",paymentAccount:"QRIS",proofUrl:null,adminPaymentTest});
  await create(code);
  const stored=()=>f.sql.prepare("SELECT items,supplier_purchase_disabled FROM orders ORDER BY id").all();
  expect(JSON.parse(String(stored()[0].items))[0].storebat_eligibility).toEqual(item(true).storebat_eligibility);
  await create("AXV-20261118-SBTEST02",true);
  expect(JSON.parse(String(stored()[1].items))[0].storebat_eligibility).toBeUndefined();
  expect(stored()[1].supplier_purchase_disabled).toBe(1);
});
it("does not replay Muse if the stored invite was edited after send",async()=>{
  paid(true);buy=()=>{throw new Error("fixture loss");};lookup=()=>recovered("failed_no_charge");await tick();
  f.sql.exec(`UPDATE orders SET items=json_set(items,'$[0].buyer_fields.muse_invite_code','ZZ9911')`);
  due();await tick();expect(purchases()).toHaveLength(1);expect(link()?.last_error).toBe("snapshot_mismatch");
});

it("Blocker 1: Muse Buff OpenAPI payloads handle create+GET pending -> success and pending -> refund",async()=>{
  // Use exact B/openapi.json MuseOrder response examples (status/state/fulfillment_status)
  const museItem=(qty=20)=>({
    ...item(true),
    qty,
    storebat_eligibility:{...item(true).storebat_eligibility,quantity:qty,cost_usd:4},
  });
  const baseFetch=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async(url,init)=>{
    if(new URL(String(url)).pathname.endsWith("/muse-buff/quote")){
      return Response.json({success:true,quote:{product_id:124,quantity:20,unit:"billion_tokens",price_per_billion:"0.2",total_usd:"4.0"}});
    }
    return baseFetch(url,init);
  });

  const openApiPending={
    success:true,
    idempotent:false,
    order:{
      id:456,status:"AWAITING_ACTIVATION",state:"queued",quantity:20,amount_usd:"4.0",
      price_per_billion:"0.2",refunded_usd:"0",created_at:"2026-01-01 12:00:00",
      customer_reference:"",idempotency_key:key,service:"muse_buff",unit:"billion_tokens",
      payment_status:"paid",fulfillment_status:"pending",
    },
  };
  const openApiSuccess={
    success:true,
    order:{
      id:456,status:"COMPLETED",state:"done",quantity:20,amount_usd:"4.0",
      price_per_billion:"0.2",refunded_usd:"0",created_at:"2026-01-01 12:00:00",
      customer_reference:"",idempotency_key:key,service:"muse_buff",unit:"billion_tokens",
      payment_status:"paid",fulfillment_status:"succeeded",
    },
  };
  const openApiRefund={
    success:true,
    order:{
      id:456,status:"REFUNDED",state:"refunded",quantity:20,amount_usd:"4.0",
      price_per_billion:"0.2",refunded_usd:"4.0",created_at:"2026-01-01 12:00:00",
      customer_reference:"",idempotency_key:key,service:"muse_buff",unit:"billion_tokens",
      payment_status:"paid",fulfillment_status:"failed_refunded",
    },
  };

  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[museItem(20)]});
  buy=()=>Response.json(openApiPending);
  poll=()=>Response.json(openApiPending);
  await tick();
  expect(link()).toMatchObject({status:"processing",provider_order_id:456,last_error:null});

  // Next poll while still pending must reach GET /muse-buff/orders/456 (not short-circuit cached receipt)
  due();await tick();
  expect(link()).toMatchObject({status:"processing",provider_order_id:456});
  expect(vi.mocked(fetch).mock.calls.filter(([u])=>new URL(String(u)).pathname.endsWith("/muse-buff/orders/456"))).toHaveLength(1);

  // Success GET completes
  poll=()=>Response.json(openApiSuccess);
  due();await tick();
  expect(link()).toMatchObject({status:"completed",provider_order_id:456,refunded_usd:0});
  expect(purchases()).toHaveLength(1);

  // Refund GET settles needs_admin failed_refunded with refunded_usd=4
  f.sql.exec("DELETE FROM fulfillment_items; DELETE FROM fulfillment_jobs; DELETE FROM storebat_order_links; DELETE FROM orders;");
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[museItem(20)]});
  buy=()=>Response.json(openApiPending);
  poll=()=>Response.json(openApiRefund);
  await tick();
  expect(link()).toMatchObject({status:"processing",provider_order_id:456});
  due();await tick();
  expect(link()).toMatchObject({status:"needs_admin",last_error:"failed_refunded",refunded_usd:4});
});

it("Blocker 2: Order POST/GET without idempotency_key accepts exact OpenAPI GET and still rejects wrong key/reference",async()=>{
  const oneItem={...item(false),qty:1,storebat_eligibility:{...item(false).storebat_eligibility,quantity:1,cost_usd:5}};
  const baseFetch=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async(url,init)=>{
    if(new URL(String(url)).pathname.endsWith("/quote")){
      return Response.json({success:true,quote:{product_id:121,quantity:1,unit_price:5,total:5,stock:5,delivery_type:"stock"},wallet_balance:10});
    }
    return baseFetch(url,init);
  });

  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[oneItem]});
  // OpenAPI POST /orders omits order.idempotency_key; customer_reference matches
  buy=()=>Response.json({
    success:true,status:"ok",idempotent:false,balance_after:5,unit_price:5,standard_unit_price:5,pricing_type:"standard",total:5,
    order:{id:123,status:"PAID_PENDING_DELIVERY",product_id:121,product_name:"Example product",quantity:1,amount_usd:5,delivery_type:"stock",customer_reference:key,items:[]},
  });
  // Exact B/openapi.json GET /orders/{order_id} omits idempotency_key AND has empty customer_reference ""
  poll=()=>Response.json({
    success:true,
    order:{id:123,status:"COMPLETED",product_id:121,product_name:"Example product",quantity:1,amount_usd:5,delivery_type:"stock",customer_reference:"",items:[{id:1,account_data:"demo-account@example.test:demo-password"}]},
  });
  await tick();
  expect(link()).toMatchObject({status:"processing",provider_order_id:123});
  due();await tick();
  expect(link()).toMatchObject({status:"completed",provider_order_id:123});
  const fi=f.sql.prepare("SELECT delivered_ciphertext,delivered_iv FROM fulfillment_items").get()!;
  expect(await decryptSecret(String(fi.delivered_ciphertext),String(fi.delivered_iv))).toBe("demo-account@example.test:demo-password");

  // Mismatched idempotency_key or customer_reference still rejected
  f.sql.exec("DELETE FROM fulfillment_items; DELETE FROM fulfillment_jobs; DELETE FROM storebat_order_links; DELETE FROM orders;");
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[oneItem]});
  buy=()=>Response.json({
    success:true,
    order:{id:123,status:"COMPLETED",product_id:121,product_name:"Example product",quantity:1,amount_usd:5,delivery_type:"stock",customer_reference:"WRONG-REF",items:[{id:1,account_data:"bad"}]},
  });
  await tick();
  expect(link()).toMatchObject({status:"needs_admin",last_error:"receipt_identity_mismatch"});
});

it("Should-Fix 2/4/5: catalog 304 clears stale error, dirty trigger uses random hex, and cross-supplier guards block Mirai",async()=>{
  // Should-Fix 4: 304 Not Modified clears storebat_catalog_last_error
  f.sql.exec("INSERT OR REPLACE INTO store_settings(key,value) VALUES('storebat_catalog_last_error','previous_500'),('storebat_catalog_etag','\"v1\"'),('storebat_catalog_sync_at','0')");
  const baseFetch=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async(url,init)=>{
    if(new URL(String(url)).pathname.endsWith("/products")) return new Response(null,{status:304,headers:{ETag:'"v1"'}});
    return baseFetch(url,init);
  });
  const res304=await publishStorebatCatalog(createDatabaseAccess(f.db),20000,{force:false,now:Date.now()+120_000});
  expect(res304).toMatchObject({ok:true,unchanged:true,changed:0});
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='storebat_catalog_last_error'").get()?.value).toBe("");

  // Should-Fix 2: pg_dirty_storebat_variant_update uses randomblob(16) hex string
  f.sql.exec("INSERT INTO product_groups(id,name) VALUES(1,'G'); INSERT INTO product_group_members(group_id,product_id,position) SELECT 1,product_id,0 FROM product_variants WHERE sku='SB-121';");
  f.sql.exec("INSERT INTO product_group_dirty(group_id,version,pending) VALUES(1,'12345678901234567890abcdefabcdef',0) ON CONFLICT(group_id) DO UPDATE SET version=excluded.version,pending=0");
  f.sql.exec("UPDATE product_variants SET storebat_cost_usd=0.77 WHERE sku='SB-121'");
  const dirty=f.sql.prepare("SELECT version,pending FROM product_group_dirty WHERE group_id=1").get() as {version:string;pending:number};
  expect(dirty.pending).toBe(1);
  expect(dirty.version).toMatch(/^[0-9a-f]{32}$/);
  expect(dirty.version).not.toBe("12345678901234567890abcdefabcdef");

  // Should-Fix 5: StoreBat refuses variants that carry mirai_package_code
  vi.mocked(fetch).mockImplementation(baseFetch);
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item(false)]});
  f.sql.exec("UPDATE product_variants SET mirai_package_code='GPT_10M' WHERE sku='SB-121'");
  await tick();
  expect(link()).toMatchObject({status:"needs_admin",last_error:"source_changed"});
  expect(purchases()).toHaveLength(0);
});
