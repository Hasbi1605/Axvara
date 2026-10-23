import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {createD1Fixture,stubFulfillmentKey} from "./helpers/d1-fixture";
import {createOrderWithStock,transitionPendingOrder} from "@/lib/db";
import {createDatabaseAccess} from "@/lib/db-access";
import {importInventory,reorderInventory} from "@/lib/fulfillment/inventory";
import {createChannelOrderAtomic} from "@/lib/commerce";
import {ensureFulfillmentForPaidOrder,ensureFulfillmentItems,processJobItems} from "@/lib/fulfillment/deliver";
import {expandDeliveryLines} from "@/lib/fulfillment/units";
import {readDeliveredSnapshots} from "@/lib/fulfillment/delivery/buyer-email";
import {sendMessage} from "@/lib/telegram/api";

vi.mock("@/lib/telegram/api",()=>({sendMessage:vi.fn(async(_params:unknown)=>({ok:true,result:{message_id:1}}))}));
let fx:ReturnType<typeof createD1Fixture>;
const code="AXV-20261023-UNITS001";
beforeEach(async()=>{
 fx=createD1Fixture();stubFulfillmentKey();vi.stubEnv("AUTO_FULFILLMENT_ENABLED","true");vi.stubEnv("PRODUCT_VARIANTS_READ","true");vi.stubEnv("TELEGRAM_BOT_ENABLED","false");
 vi.mocked(sendMessage).mockReset().mockResolvedValue({ok:true,result:{message_id:1}} as never);
 vi.stubGlobal("fetch",vi.fn(async()=>{throw Error("No real network in fixture")}));
 fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Muse','muse',1000,100);
 INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'MUSE','Muse',1000,100,'unique'),(2,1,'OTHER','Other',1000,100,'unique')`);
 await importInventory(1,Array.from({length:11},(_,i)=>`UNIT-${i+1}`),1);
 fx.sql.exec("UPDATE product_variants SET stock=11 WHERE id=1");
});
afterEach(()=>{fx.close();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks()});
const items=(qty=3)=>[{product_id:1,variant_id:1,name:"Muse",price:1000,qty}];
const web=(orderCode=code,qty=3)=>createOrderWithStock({code:orderCode,quoteId:`q-${orderCode}`,customerName:"Buyer",customerWa:"6281234567890",customerEmail:"buyer@example.test",items:items(qty),subtotal:qty*1000,paymentMethod:"qris",paymentAccount:"Fixture",proofUrl:null});
const order=()=>fx.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
const inventory=()=>fx.sql.prepare("SELECT status,COUNT(*) AS n FROM fulfillment_inventory GROUP BY status").all();

it("keeps one shopping line, reserves three prioritized credentials and binds three independent units",async()=>{
 await reorderInventory(1,1,[3,1,2,4,5,6,7,8,9,10,11]);await web();
 expect(JSON.parse(String(order().items))).toMatchObject([{name:"Muse",qty:3,unique_units:true}]);
 expect(inventory()).toContainEqual({status:"reserved",n:3});
 const units=await ensureFulfillmentItems(order(),createDatabaseAccess(fx.db));
 expect(units.map(u=>u.qty)).toEqual([1,1,1]);expect(units.map(u=>u.inventory_id)).toEqual([3,1,2]);
 const expanded=expandDeliveryLines([...JSON.parse(String(order().items)),{product_id:2,variant_id:5,qty:1}]);
 expect(expanded).toHaveLength(4);expect(expanded[1].variant_id).toBe(5); // Supplier indexes stay stable.
 expect(expandDeliveryLines(items())).toHaveLength(1); // Legacy data is never implicitly split.
});
it("reserves the ten-unit boundary as ten distinct items without consuming the last available credential",async()=>{
 await web(code,10);
 const units=await ensureFulfillmentItems(order(),createDatabaseAccess(fx.db));
 expect(units).toHaveLength(10);expect(new Set(units.map(u=>u.inventory_id)).size).toBe(10);
 expect(units.every(u=>u.qty===1)).toBe(true);
 expect(inventory()).toContainEqual({status:'reserved',n:10});expect(inventory()).toContainEqual({status:'available',n:1});
});
it("minute cron completes ten unique units across bounded invocations without duplicate sends",async()=>{
 await web(code,10);vi.stubEnv('CRON_SECRET','fixture-cron');
 fx.sql.exec(`UPDATE orders SET status='lunas',payment_status='paid',sales_channel='telegram',telegram_user_id='12345',telegram_chat_id='12345' WHERE code='${code}';
 INSERT INTO fulfillment_jobs(order_code,variant_id,sales_channel,status,next_attempt_at) VALUES('${code}',1,'telegram','queued',datetime('now'))`);
 const {POST}=await import('@/app/api/cron/lite/route');
 for(let tick=0;tick<5&&order().fulfillment_status!=='delivered';tick++){
  const result=await POST(new NextRequest('https://fixture/api/cron/lite?job=fulfillment',{method:'POST',headers:{authorization:'Bearer fixture-cron'}}));
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({ok:true});
 }
 expect(order().fulfillment_status).toBe('delivered');
 expect(inventory()).toContainEqual({status:'delivered',n:10});
 const accounts=vi.mocked(sendMessage).mock.calls.map(([params])=>String(params.text)).filter(text=>text.includes('UNIT-'));
 expect(accounts).toHaveLength(10);expect(new Set(accounts).size).toBe(10);
});
it("two checkouts competing for the last three credentials yield one whole reservation",async()=>{
 fx.sql.exec("DELETE FROM fulfillment_inventory WHERE id>3; UPDATE product_variants SET stock=3 WHERE id=1");
 const results=await Promise.allSettled([web(code,2),web("AXV-20261023-UNITS002",2)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(1);
 expect(inventory()).toContainEqual({status:"reserved",n:2});expect(inventory()).toContainEqual({status:"available",n:1});
 expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(1);
});
it("an inventory shortage rolls back the order and all stock even when the stock counter claims enough",async()=>{
 fx.sql.exec("DELETE FROM fulfillment_inventory WHERE id>2; UPDATE product_variants SET stock=100 WHERE id=1");
 await expect(web()).rejects.toThrow("Stok atau status");
 expect(inventory()).toEqual([{status:"available",n:2}]);expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()?.n).toBe(0);
 expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
});
it("rejects more than ten units before reserving anything",async()=>{
 await expect(web(code,11)).rejects.toThrow("Stok atau status");expect(inventory()).toEqual([{status:"available",n:11}]);
});
it("quotes quantity three as one line but rejects eleven combined unique units",async()=>{
 vi.stubEnv("ADMIN_JWT_SECRET","fixture-unique-units-jwt-secret-long-enough-for-tests");
 fx.sql.exec("INSERT INTO payment_methods(id,label,account_number,account_name,is_active) VALUES('bank-fixture','Fixture','1','Fixture',1)");
 const {POST}=await import("@/app/api/checkout/quote/route");
 const quote=(lines:unknown[])=>POST(new NextRequest("https://fixture/api/checkout/quote",{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:lines})}));
 const accepted=await quote(items());expect(accepted.status).toBe(200);expect(await accepted.json()).toMatchObject({subtotal:3000,items:[{qty:3}]});
 const rejected=await quote(items(11));expect(rejected.status).toBe(409);expect(await rejected.json()).toMatchObject({issues:[{type:'invalid_quantity'}]});
 await importInventory(1,Array.from({length:5},(_,i)=>`OTHER-${i}`),2);
 const combined=await quote([...items(6),{...items(5)[0],variant_id:2}]);expect(combined.status).toBe(409);
});
it("cancellation returns all three credentials and stock exactly once",async()=>{
 await web();const stock=Number(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock);
 await transitionPendingOrder(code,"dibatalkan","test",items());
 await transitionPendingOrder(code,"dibatalkan","test",items()).catch(()=>false);
 expect(inventory()).toEqual([{status:"available",n:11}]);
 expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(stock+3);
});
it("expiry releases every reserved unit without a second stock increment on the next tick",async()=>{
 await web();vi.stubEnv("CRON_SECRET","fixture-cron");
 fx.sql.exec(`UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code='${code}';
 INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at)
 VALUES('${code}','klikqris','inhouse','${code}','1',3000,3001,'pending',datetime('now','-1 minute'))`);
 const {POST}=await import("@/app/api/cron/lite/route");const tick=()=>POST(new NextRequest("https://fixture/api/cron/lite?job=expiry",{method:"POST",headers:{authorization:"Bearer fixture-cron"}}));
 expect(await (await tick()).json()).toMatchObject({expired_payments:1});expect(await (await tick()).json()).toMatchObject({expired_payments:0});
 expect(inventory()).toEqual([{status:"available",n:11}]);expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(11);
});
it("a failed third unit retries the same credential while the first two remain delivered",async()=>{
 await web();fx.sql.exec(`UPDATE orders SET status='lunas',payment_status='paid',sales_channel='telegram',telegram_chat_id='12345',telegram_user_id='12345' WHERE code='${code}'`);
 let failed=false;
 vi.mocked(sendMessage).mockImplementation(async params=>{
  if(String(params.text).includes('UNIT-3')&&!failed){failed=true;return {ok:false,description:'fixture send failure'} as never;}
  return {ok:true,result:{message_id:1}} as never;
 });
 await ensureFulfillmentForPaidOrder(code);
 const before=fx.sql.prepare("SELECT inventory_id,status FROM fulfillment_items WHERE order_code=? ORDER BY item_index").all(code);
 expect(before.map(u=>u.status)).toEqual(['delivered','delivered','retry']);
 vi.mocked(sendMessage).mockClear();
 const job=fx.sql.prepare("SELECT id FROM fulfillment_jobs WHERE order_code=?").get(code)!;
 await processJobItems(Number(job.id),order(),{},10,undefined,createDatabaseAccess(fx.db));
 const after=fx.sql.prepare("SELECT inventory_id,status FROM fulfillment_items WHERE order_code=? ORDER BY item_index").all(code);
 expect(after.map(u=>u.inventory_id)).toEqual(before.map(u=>u.inventory_id));expect(after.map(u=>u.status)).toEqual(['delivered','delivered','delivered']);
 const messages=vi.mocked(sendMessage).mock.calls.map(([p])=>String(p.text));
 expect(messages.some(t=>t.includes('UNIT-3'))).toBe(true);expect(messages.some(t=>t.includes('UNIT-1')||t.includes('UNIT-2'))).toBe(false);
 const snapshots=await readDeliveredSnapshots(code,createDatabaseAccess(fx.db));
 expect(snapshots.map(u=>u.label)).toEqual(['Muse — Akun 1 dari 3','Muse — Akun 2 dari 3','Muse — Akun 3 dari 3']);
});
it("Telegram atomic checkout reserves multiple units while preserving an idempotent single order",async()=>{
 const input={orderCode:code,idempotencyKey:'tg-unique',lines:[{productId:1,variantId:1,qty:3,fulfillmentMode:'unique',stock:11}],items:items(),variantSnapshot:'{}',subtotal:3000,primaryVariantId:1,customerName:'Buyer',salesChannel:'telegram' as const,telegramChatId:'12345',telegramUserId:'12345',paymentMethod:'qris',paymentAccount:'Fixture',fulfillmentStatus:'reserved'};
 await createChannelOrderAtomic(input);await createChannelOrderAtomic(input);
 expect(inventory()).toContainEqual({status:'reserved',n:3});expect(JSON.parse(String(order().items))).toMatchObject([{qty:3,unique_units:true}]);
 expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(8);
});

it("Telegram cart combines unique variants, retains quantities and enforces the total cap",async()=>{
 await importInventory(1,Array.from({length:5},(_,i)=>`CART-OTHER-${i}`),2);
 const {addToCart,setCartLineQty,getCartSummary}=await import("@/lib/telegram/cart");
 expect(await addToCart('12345',1,1,3)).toMatchObject({ok:true});
 expect(await addToCart('12345',1,2,4)).toMatchObject({ok:true});
 expect((await getCartSummary('12345')).lines.map(l=>l.qty)).toEqual([3,4]);
 expect(await addToCart('12345',1,1,4)).toMatchObject({ok:false,reason:'unique_limit'});
 expect(await setCartLineQty('12345',1,6)).toBe(true);
 expect(await setCartLineQty('12345',1,7)).toBe(false);
 expect((await getCartSummary('12345')).totalQty).toBe(10);
});

it("lookup and both public status URLs report the same multi-unit progress",async()=>{
 await web();await ensureFulfillmentItems(order(),createDatabaseAccess(fx.db));
 fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
 fx.sql.prepare("UPDATE fulfillment_items SET status='delivered',delivered_ciphertext='fixture' WHERE order_code=? AND item_index=0").run(code);
 const {clearRateLimitBucketsForTest}=await import('@/lib/rateLimit');clearRateLimitBucketsForTest();
 const {GET}=await import('@/app/api/orders/route');const {GET:segment}=await import('@/app/api/orders/[code]/route');const {POST:lookup}=await import('@/app/api/orders/lookup/route');
 const a=await GET(new NextRequest('http://fixture/api/orders?code='+code));const b=await segment(new NextRequest('http://fixture/api/orders/'+code),{params:Promise.resolve({code})});
 const c=await lookup(new NextRequest('http://fixture/api/orders/lookup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,contact:'buyer@example.test'})}));
 for(const response of [a,b,c]){expect(response.status).toBe(200);expect((await response.json()).order.unique_units_progress).toEqual({ready:1,total:3});expect(response.headers.get('cache-control')).toContain('no-store')}
});
