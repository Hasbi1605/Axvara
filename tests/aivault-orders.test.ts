import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {createD1Fixture,insertTestOrder,stubFulfillmentKey} from "./helpers/d1-fixture";
import {createDatabaseAccess,createBudgetedDatabase} from "@/lib/db-access";
import {processAivaultOrders,retryAivaultOrder,matchesAivaultReceiptReference} from "@/lib/aivault/orders";
import {decryptSecret} from "@/lib/fulfillment/crypto";
import {processItem} from "@/lib/fulfillment/delivery/send";
vi.mock("@/lib/auth",()=>({requireAdmin:vi.fn(async()=>({sid:"fixture"}))}));
vi.mock("@/lib/fulfillment/delivery/buyer-email",async original=>({...await original<object>(),sendWebDeliveryEmail:vi.fn(async()=>({ok:true}))}));
let f:ReturnType<typeof createD1Fixture>,postStatus:number,post:Record<string,unknown>,poll:Record<string,unknown>,stock:number,fundable:boolean,timeout:boolean;
const sid="service_gemini_plus_6m",code="AXV-20261115-AVTEST01";
const item=()=>({product_id:1,variant_id:1,name:"Gemini",price:13500,qty:1,aivault_eligibility:{version:1,service_id:sid,source_variant_id:1,quantity:1,cost_usd:0.5}});
const link=()=>f.sql.prepare("SELECT * FROM aivault_order_links").get()!;
const due=()=>f.sql.exec("UPDATE aivault_order_links SET next_attempt_at=datetime('now','-1 minute'),lease_expires_at=NULL");
const tick=async()=>{const b=createBudgetedDatabase(40,2,f.db);await processAivaultOrders(b.access);expect(b.used).toBeLessThanOrEqual(38);};
const buys=()=>vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==="POST");
beforeEach(()=>{
  f=createD1Fixture();vi.stubEnv("AIVAULT_ENABLED","true");vi.stubEnv("AIVAULT_SYNC_ENABLED","true");vi.stubEnv("AIVAULT_API_KEY","fixture");vi.stubEnv("AIVAULT_BASE_URL","https://supplier.test");stubFulfillmentKey();
  f.sql.exec(`INSERT INTO products(id,name,slug,price,stock,aivault_family) VALUES(1,'Gemini','gemini-plus-av',13500,10,'gemini');INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,aivault_service_id) VALUES(1,1,'AV-${sid}','6 Bulan',13500,10,'manual','${sid}');INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json) VALUES('${sid}','Gemini',10,0.5,'[]');`);
  postStatus=201;stock=10;fundable=true;timeout=false;
  post={success:true,order_id:"API_TEST",external_order_id:`${code}-0`,service_id:sid,quantity:1,total_cost:0.5,currency:"USD",products:["buyer-secret"]};
  poll={order_id:"API_TEST",service_id:sid,quantity:1,total_cost:0.5,currency:"USD",status:"delivered",products:["buyer-secret"]};
  vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith("/quote"))return Response.json({service_id:sid,quantity:1,currency:"USD",stock,sufficient_balance:fundable,pricing:{unit_price:0.5,final_total:0.5}});
    if(init?.method==="POST"){expect(link().request_sent_at).toBeTruthy();if(timeout)throw new Error("fixture timeout");return Response.json(post,{status:postStatus});}
    if(path.endsWith("/order/API_TEST") || path.endsWith("/order/API1VLJZG0"))return Response.json(poll);
    throw new Error("Unexpected fixture request");
  }));
});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
it("competing ticks buy once, seal full receipts and queue purchased credentials",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});await Promise.all([tick(),tick(),tick()]);expect(buys()).toHaveLength(1);expect(link()).toMatchObject({status:"completed",attempt_count:1});
  expect(JSON.parse(String(buys()[0][1]?.body))).toEqual({service_id:sid,quantity:1,external_order_id:`${code}-0`});
  expect(JSON.stringify(link())).not.toContain("buyer-secret");expect(await decryptSecret(String(link().receipt_ciphertext),String(link().receipt_iv))).toContain("buyer-secret");
  const fi=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(await decryptSecret(String(fi.delivered_ciphertext),String(fi.delivered_iv))).toBe("buyer-secret");await tick();expect(buys()).toHaveLength(1);
});
it("queued orders poll once only when due and complete without another purchase",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post={...post,status:"queued",products:[]};await tick();expect(link().status).toBe("processing");await tick();expect(fetch).toHaveBeenCalledTimes(2);due();await tick();expect(link().status).toBe("completed");expect(buys()).toHaveLength(1);
});
it.each([[402,"insufficient_balance"],[409,"price_conflict"],[401,"http_401"],[400,"http_400"],[404,"http_404"]])("HTTP %s stops safely",async(status,error)=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});postStatus=Number(status);post={error:"fixture"};await tick();due();await tick();expect(buys()).toHaveLength(1);expect(link()).toMatchObject({status:"needs_admin",last_error:error,attempt_count:1});expect(await retryAivaultOrder(createDatabaseAccess(f.db),Number(link().id))).toBe(false);
});
it("timeout retries the SAME external ID even after debit depleted stock/balance",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});timeout=true;await tick();expect(link()).toMatchObject({status:"pending",attempt_count:1});await tick();expect(buys()).toHaveLength(1);timeout=false;stock=0;fundable=false;post={...post,idempotent_replay:true};due();await tick();expect(link()).toMatchObject({status:"completed",attempt_count:2});expect(buys().map(([,i])=>JSON.parse(String(i?.body)).external_order_id)).toEqual([`${code}-0`,`${code}-0`]);
});
it.each(["timeout","5xx","429","invalid_json"])("%s exhausts at three total attempts",async fault=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});if(fault==="timeout")timeout=true;else if(fault==="5xx")postStatus=500;else if(fault==="429")postStatus=429;else {const original=vi.mocked(fetch).getMockImplementation()!;vi.mocked(fetch).mockImplementation(async(url,init)=>init?.method==="POST" ? new Response("{broken-json",{status:201}) : original(url,init));}
  for(let i=0;i<5;i++){await tick();due();}expect(buys()).toHaveLength(3);expect(link()).toMatchObject({status:"needs_admin",last_error:"attempts_exhausted",attempt_count:3});
});
it.each(["unpaid","disabled","wrong_sku","legacy","source","inactive"])("never buys %s",async fault=>{
  const row=item();if(fault==="legacy")delete (row as Partial<typeof row>).aivault_eligibility;
  insertTestOrder(f.sql,code,{status:fault==="unpaid" ? "pending" : "lunas",channel:"web",items:[row]});
  if(fault==="disabled")f.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");if(fault==="wrong_sku")f.sql.exec("UPDATE product_variants SET sku='WR-SKU'");if(fault==="source")f.sql.exec("UPDATE products SET source='warung_rebahan'");if(fault==="inactive")f.sql.exec("UPDATE product_variants SET is_active=0");await tick();expect(buys()).toHaveLength(0);
});
it("admin can retry a pre-send balance failure without changing identity",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});fundable=false;await tick();expect(link()).toMatchObject({status:"needs_admin",attempt_count:0,request_sent_at:null});fundable=true;expect(await retryAivaultOrder(createDatabaseAccess(f.db),Number(link().id))).toBe(true);expect(link().status).toBe("completed");
});
it("new web orders strip forged eligibility and stamp server costs; admin test stays disabled",async()=>{
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-buyer-key");const {createOrderWithStock}=await import("@/lib/db/orders-create");
  const {aivault_eligibility:ignored,...line}=item();void ignored;
  await createOrderWithStock({code,quoteId:"fixture-quote",customerName:"Fixture",customerWa:"628000000000",customerEmail:"buyer@example.test",items:[line],subtotal:13500,paymentMethod:"qris",paymentAccount:"QRIS",proofUrl:null});
  expect(JSON.parse(String(f.sql.prepare("SELECT items FROM orders").get()?.items))[0].aivault_eligibility).toEqual(item().aivault_eligibility);
});
it("generic delivery refuses an AV snapshot before a durable completion",async()=>{
  const order=insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});
  const {ensureFulfillmentItems}=await import("@/lib/fulfillment/delivery/inventory-binding");const db=createDatabaseAccess(f.db);await ensureFulfillmentItems(order,db);const row=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;
  expect(await processItem(order,row,undefined,db)).toBe(false);
});
it("all AIVault admin endpoints deny unauthenticated requests",async()=>{
  const {requireAdmin}=await import("@/lib/auth");vi.mocked(requireAdmin).mockResolvedValueOnce(null);
  const products=await import("@/app/api/admin/aivault/products/route");expect((await products.GET(new NextRequest("https://fixture.test"))).status).toBe(401);
  for(const path of ["balance","orders","publish"]){const route=path==="balance" ? await import("@/app/api/admin/aivault/balance/route") : path==="orders" ? await import("@/app/api/admin/aivault/orders/route") : await import("@/app/api/admin/aivault/publish/route");for(const method of ["GET","POST"] as const){if(method in route){vi.mocked(requireAdmin).mockResolvedValueOnce(null);expect((await (route as unknown as Record<string,(r:NextRequest)=>Promise<Response>>)[method](new NextRequest("https://fixture.test"))).status).toBe(401);}}}
  vi.mocked(requireAdmin).mockResolvedValueOnce(null);const patch=await import("@/app/api/admin/aivault/products/[id]/route");expect((await patch.PATCH(new NextRequest("https://fixture.test"),{params:Promise.resolve({id:sid})})).status).toBe(401);
});

it.each([false,true])("web factory excludes admin test dispatch (%s)",async adminPaymentTest=>{
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-buyer-key");const {createOrderWithStock}=await import("@/lib/db/orders-create");
  const line={...item(),aivault_eligibility:{version:1,service_id:"forged",source_variant_id:1,quantity:1,cost_usd:0.01}};
  await createOrderWithStock({code,quoteId:"admin-fixture",customerName:"Fixture",customerWa:"628000000000",customerEmail:"buyer@example.test",items:[line],subtotal:13500,paymentMethod:"qris",paymentAccount:"QRIS",proofUrl:null,adminPaymentTest});
  const saved=f.sql.prepare("SELECT * FROM orders").get()!;expect(JSON.parse(String(saved.items))[0].aivault_eligibility).toEqual(adminPaymentTest ? undefined : item().aivault_eligibility);expect(saved.supplier_purchase_disabled).toBe(Number(adminPaymentTest));
});
it("Telegram factory stamps supplier costs and CAS rejects source identity races",async()=>{
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-buyer-key");const {createChannelOrderAtomic}=await import("@/lib/commerce");
  const input={orderCode:code,lines:[{productId:1,variantId:1,qty:1,fulfillmentMode:"manual",stock:10}],items:[item()],variantSnapshot:"{}",subtotal:13500,primaryVariantId:1,customerName:"Fixture",salesChannel:"telegram" as const,telegramChatId:"12345",telegramUserId:"12345",paymentMethod:"qris",paymentAccount:"QRIS",fulfillmentStatus:"queued"};
  await createChannelOrderAtomic(input);expect(JSON.parse(String(f.sql.prepare("SELECT items FROM orders").get()?.items))[0].aivault_eligibility).toEqual(item().aivault_eligibility);
  const batch=f.db.batch;f.db.batch=async statements=>{f.sql.exec("UPDATE product_variants SET aivault_service_id='changed'");return batch(statements);};
  await expect(createChannelOrderAtomic({...input,orderCode:"AV-RACED",telegramChatId:"67890",telegramUserId:"67890"})).rejects.toThrow();
  expect(f.sql.prepare("SELECT code FROM orders WHERE code='AV-RACED'").get()).toBeUndefined();
});
it("admin variant pricing is strict, atomic and keeps parent inactive",async()=>{
  f.sql.exec("UPDATE products SET is_active=0; UPDATE aivault_products SET axvara_product_id=1,fx_idr_per_usd=20000");
  const route=await import("@/app/api/admin/aivault/products/[id]/route");
  const call=(body:unknown)=>route.PATCH(new NextRequest(`https://fixture.test/api/admin/aivault/products/${sid}`,{method:"PATCH",body:JSON.stringify(body)}),{params:Promise.resolve({id:sid})});
  expect((await call({markup_percent:40,unknown:true})).status).toBe(400);
  expect((await call({markup_percent:40,admin_price_idr:null,is_active:true})).status).toBe(200);
  expect(f.sql.prepare("SELECT price,is_active FROM product_variants").get()).toMatchObject({price:14000,is_active:1});expect(f.sql.prepare("SELECT is_active FROM products").get()?.is_active).toBe(0);
  expect((await call({admin_price_idr:8000})).status).toBe(200);expect(f.sql.prepare("SELECT price,aivault_admin_price_idr FROM product_variants").get()).toMatchObject({price:8000,aivault_admin_price_idr:8000});
});
it("admin Products can activate the AIVault parent and keep SKU identity",async()=>{
  f.sql.exec("UPDATE products SET is_active=0; UPDATE product_variants SET is_active=0");vi.stubEnv("PRODUCT_VARIANTS_WRITE","true");
  const {PUT}=await import("@/app/api/products/[id]/route");const res=await PUT(new NextRequest("https://fixture.test/api/products/1",{method:"PUT",body:JSON.stringify({isActive:true})}),{params:Promise.resolve({id:"1"})});
  expect(res.status,await res.text()).toBe(200);expect(f.sql.prepare("SELECT is_active,stock FROM products").get()).toMatchObject({is_active:1,stock:10});expect(f.sql.prepare("SELECT is_active,aivault_service_id FROM product_variants").get()).toMatchObject({is_active:1,aivault_service_id:sid});
});
it("public catalog advertises automatic delivery without supplier SKU",async()=>{
  vi.stubEnv("PRODUCT_VARIANTS_READ","true");const {getProductDetail}=await import("@/lib/catalog");const detail=await getProductDetail("gemini-plus-av");expect(detail?.variants[0]).toMatchObject({sku:"",automatic_delivery:true});
});
it("completed AV credentials use generic web delivery and persisted snapshots",async()=>{
  const order=insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});await tick();const db=createDatabaseAccess(f.db);const fi=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;
  expect(await processItem(order,fi,undefined,db)).toBe(true);expect(f.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("delivered");
});
it.each([0,1])("buyer status hides supplier metadata and honors purchase disable (%s)",async disabled=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});f.sql.prepare("UPDATE orders SET supplier_purchase_disabled=?").run(disabled);
  const {GET}=await import("@/app/api/orders/route");const response=await GET(new NextRequest(`https://fixture.test/api/orders?code=${code}`));const body=await response.json();
  expect(response.status).toBe(200);expect(body.order).toMatchObject({supplier_owned:disabled===0,queued_delivery:disabled===1});expect(body.order.items[0]).not.toHaveProperty("aivault_eligibility");
});
it("poll network failures preserve processing even after the three-purchase limit",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post={...post,status:"queued",products:[]};await tick();f.sql.exec("UPDATE aivault_order_links SET attempt_count=3");due();
  const original=vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementationOnce(async()=>{throw new Error("poll timeout");});await tick();expect(link()).toMatchObject({status:"processing",last_error:"poll_unavailable",attempt_count:3});
  vi.mocked(fetch).mockImplementation(original);due();await tick();expect(link().status).toBe("completed");expect(buys()).toHaveLength(1);
});
it("seals extra credentials but releases only purchased quantity; partial receipts stop",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post.products=["buyer-secret","extra-admin-secret"];await tick();
  const fi=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(await decryptSecret(String(fi.delivered_ciphertext),String(fi.delivered_iv))).toBe("buyer-secret");expect(await decryptSecret(String(link().receipt_ciphertext),String(link().receipt_iv))).toContain("extra-admin-secret");
});
it("never delivers or repurchases an incomplete credential receipt",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post.products=[];await tick();due();await tick();expect(link()).toMatchObject({status:"needs_admin",last_error:"incomplete_receipt"});expect(buys()).toHaveLength(1);expect(f.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items").get()?.delivered_ciphertext).toBeNull();
});
it("a delayed admin-error write cannot downgrade a newer completed item",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});fundable=false;
  f.control.afterRun=async q=>{if(q.startsWith("UPDATE aivault_order_links SET status=")){f.sql.exec("UPDATE aivault_order_links SET status='completed'; UPDATE fulfillment_items SET status='queued',delivered_ciphertext='newer-sealed',delivered_iv='newer-iv'");}};
  await tick();expect(f.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get()).toMatchObject({status:"queued",delivered_ciphertext:"newer-sealed"});
});

// Field sets reported by PM from the single authorized live Gemini purchase.
// Redeem URLs below are fake fixtures, never values returned by the supplier.
const fakeRedeemUrl="https://redeem.example.test/gemini/fixture-only";
const liveFirstReceipt=()=>({success:true,order_id:"API1VLJZG0",service_id:sid,quantity:1,total_cost:0.5,new_balance:2.0,currency:"USD",price_breakdown:{unit_price:0.5,base_total:0.5,final_total:0.5},external_order_id:`${code}-0`,products:[fakeRedeemUrl]});
const liveReplayReceipt=()=>({success:true,order_id:"API1VLJZG0",service_id:sid,quantity:1,total_cost:0.5,new_balance:2.0,currency:"USD",idempotent_replay:true,products:[fakeRedeemUrl]});
const livePollReceipt=()=>({order_id:"API1VLJZG0",status:"delivered",service_id:sid,quantity:1,total_cost:0.5,currency:"USD",created_at:"2026-11-15T10:00:00",products:[fakeRedeemUrl]});
it("accepts the live HTTP201 first-send shape and seals the fake redeem URL",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post=liveFirstReceipt();await tick();
  expect(link()).toMatchObject({status:"completed",provider_order_id:"API1VLJZG0",receipt_http_status:201});
  const fi=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(await decryptSecret(String(fi.delivered_ciphertext),String(fi.delivered_iv))).toBe(fakeRedeemUrl);
  expect(JSON.stringify(link())).not.toContain(fakeRedeemUrl);
});
it("accepts the live HTTP200 replay without external_order_id or price_breakdown after timeout",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});timeout=true;await tick();timeout=false;postStatus=200;post=liveReplayReceipt();due();await tick();
  expect(link()).toMatchObject({status:"completed",provider_order_id:"API1VLJZG0",attempt_count:2,receipt_http_status:200});
  expect(buys().map(([,i])=>JSON.parse(String(i?.body)).external_order_id)).toEqual([`${code}-0`,`${code}-0`]);
  const sealed=JSON.parse(await decryptSecret(String(link().receipt_ciphertext),String(link().receipt_iv)));
  expect(sealed).toEqual(liveReplayReceipt());expect(sealed).not.toHaveProperty("external_order_id");expect(sealed).not.toHaveProperty("price_breakdown");
});
it.each([{external_order_id:"different-order"},{external_order_id:null},{idempotent_replay:false},{idempotent_replay:"true"},{service_id:"different-service"},{service_id:null},{quantity:2},{currency:"INR"},{total_cost:0},{order_id:"../invalid"}])("rejects mismatched/incomplete replay identity %j",async over=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});postStatus=200;post={...liveReplayReceipt(),...over};await tick();
  expect(link()).toMatchObject({status:"needs_admin",last_error:"receipt_identity_mismatch"});expect(f.sql.prepare("SELECT delivered_ciphertext FROM fulfillment_items").get()?.delivered_ciphertext).toBeNull();
});
it("requires a replay provider ID to match an already stored ID for POST and GET",async()=>{
  const saved={external_order_id:`${code}-0`,provider_order_id:"API1VLJZG0"};
  expect(matchesAivaultReceiptReference(saved,liveReplayReceipt())).toBe(true);
  expect(matchesAivaultReceiptReference(saved,{...liveReplayReceipt(),order_id:"API_DIFFERENT"})).toBe(false);
  // Known IDs use exact GET polling; a replay-shaped body from another ID is held.
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post={...liveFirstReceipt(),status:"queued",products:[]};await tick();
  poll={...liveReplayReceipt(),order_id:"API_DIFFERENT",status:"delivered"};due();await tick();
  expect(link()).toMatchObject({status:"needs_admin",provider_order_id:"API1VLJZG0",last_error:"receipt_identity_mismatch"});expect(buys()).toHaveLength(1);
});
it("accepts the live delivered GET shape without external_order_id or success",async()=>{
  insertTestOrder(f.sql,code,{status:"lunas",channel:"web",items:[item()]});post={...liveFirstReceipt(),status:"queued",products:[]};await tick();
  poll=livePollReceipt();due();await tick();
  expect(link()).toMatchObject({status:"completed",provider_order_id:"API1VLJZG0"});expect(buys()).toHaveLength(1);
  const fi=f.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(await decryptSecret(String(fi.delivered_ciphertext),String(fi.delivered_iv))).toBe(fakeRedeemUrl);
});
