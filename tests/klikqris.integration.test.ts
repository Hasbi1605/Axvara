import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createChannelOrderAtomic } from "@/lib/commerce";
import { createActiveQrisInvoice, createDanaQrisInvoice, calculateCrc16 } from "@/lib/payments/dana-qris";
import { klikQrisMoney, klikQrisTime, validKlikQrisImage, reconcileKlikQrisPayment } from "@/lib/payments/klikqris";
import { POST as callback } from "@/app/api/payments/klikqris/callback/route";

const mocks=vi.hoisted(()=>({ ensure:vi.fn(async()=>true),send:vi.fn(async()=>({ok:true})),pedia:vi.fn(async()=>({})),
 wrCreate:vi.fn(async()=>0),wrProcess:vi.fn(async()=>({processed:0})),skCreate:vi.fn(async()=>0),skProcess:vi.fn(async()=>({processed:0})) }));
vi.mock("@/lib/fulfillment/deliver",()=>({ensureFulfillmentForPaidOrder:mocks.ensure}));
vi.mock("@/lib/telegram/api",()=>({sendMessage:mocks.send,sendPhoto:vi.fn(async()=>({ok:true})),sendChatAction:vi.fn(),showLoadingBar:vi.fn(),safeEditOrSend:vi.fn()}));
vi.mock("@/lib/warung-rebahan/order",()=>({createWrOrderLinksForOrder:mocks.wrCreate,processWrPendingOrders:mocks.wrProcess}));
vi.mock("@/lib/warung-rebahan/client",()=>({isWrAutoOrderEnabled:()=>true}));
vi.mock("@/lib/sekalipay/order",()=>({createSkOrderLinksForOrder:mocks.skCreate,processSkPendingOrders:mocks.skProcess}));
vi.mock("@/lib/sekalipay/client",()=>({isSkAutoOrderEnabled:()=>true}));
vi.mock("@/lib/pedia/dispatch",()=>({processPediaPaidOrders:mocks.pedia}));
vi.mock("@/lib/auth",async original=>({...await original<object>(),requireAdmin:vi.fn(async()=>({email:"fixture@example.test"}))}));
const A="AXV-20261018-AAAAAAA1",B="AXV-20261018-BBBBBBB2",signature="fixture-private-signature-12345678901234567890";
let fixture:ReturnType<typeof createD1Fixture>;
let remote:Map<string,Record<string,unknown>>;
let fetchMock:import("vitest").Mock<(url:string|URL|Request,init?:RequestInit)=>Promise<Response>>;
let failStatus:boolean,failCreateAfterSave:boolean;
const details=(code:string)=>({order_id:code,amount:"1000.00",total_amount:"1089.00",status:"PENDING",signature,
  qris_url:"https://klikqris.com/storage/qris_api/fixture.png",expired_at:new Date(Date.now()+3600000).toISOString(),paid_at:null as string|null});
beforeEach(async()=>{
 fixture=createD1Fixture();stubFulfillmentKey();await insertTestProduct(fixture.sql,"manual",1);
 remote=new Map();failStatus=false;failCreateAfterSave=false;mocks.ensure.mockClear();mocks.send.mockClear();mocks.pedia.mockClear();
 mocks.wrCreate.mockClear();mocks.wrProcess.mockClear();mocks.skCreate.mockClear();mocks.skProcess.mockClear();
 mocks.wrCreate.mockResolvedValue(0);mocks.skCreate.mockResolvedValue(0);
 vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE","false");vi.stubEnv("QRIS_ACTIVE_PROVIDER","klikqris");
 vi.stubEnv("KLIKQRIS_ENABLED","true");vi.stubEnv("KLIKQRIS_API_KEY","fixture-private-api-key");vi.stubEnv("KLIKQRIS_MERCHANT_ID","123456789");
 vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID","999");vi.stubEnv("PRODUCT_VARIANTS_READ","true");
 const {clearRateLimitBucketsForTest}=await import("@/lib/rateLimit");clearRateLimitBucketsForTest();
 fetchMock=vi.fn(async(url: string|URL|Request,init?:RequestInit)=>{
  const target=String(url);
  if(target.endsWith("/api/qris/create")){
   const body=JSON.parse(String(init?.body));const row={...details(body.order_id),amount:String(body.amount),total_amount:String(body.amount+89)};remote.set(body.order_id,row);
   if(failCreateAfterSave)throw new Error("Network timeout after provider accepted create");
   return Response.json({status:true,data:row},{status:201});
  }
  if(target.includes("/api/qris/status/")){
   if(failStatus)throw new Error("Status API network failure");
   const row=remote.get(decodeURIComponent(target.split("/").at(-1)!));
   return row?Response.json({status:true,data:row}):Response.json({status:false},{status:404});
  }
  if(target==="https://klikqris.com/storage/qris_api/fixture.png")return new Response(new Uint8Array([137,80,78,71,13,10,26,10,1]),{headers:{"content-type":"image/png"}});
  throw new Error("Unexpected network request");
 });vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{fixture.close();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function seed(code=A,channel:"telegram"|"web"|"whatsapp"="telegram"){
 await createChannelOrderAtomic({orderCode:code,lines:[{productId:1,variantId:1,qty:1,fulfillmentMode:"manual",stock:100}],
  items:[{product_id:1,variant_id:1,qty:1,price:1000,name:"Fixture"}],variantSnapshot:"{}",subtotal:1000,
  primaryVariantId:1,customerName:"Fixture",salesChannel:channel,paymentMethod:"qris",paymentAccount:"QRIS",fulfillmentStatus:"not_required"});
}
async function checkout(code=A){await seed(code);return createActiveQrisInvoice(code,1000);}
const row=(code=A)=>fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
const tx=(code=A)=>fixture.sql.prepare("SELECT * FROM payment_transactions WHERE order_code=?").get(code)!;
function paid(code=A){Object.assign(remote.get(code)!,{status:"SUCCESS",paid_at:new Date().toISOString()});}
async function hook(overrides:Record<string,unknown>={},code=A){
 return callback(new NextRequest("https://axvara.tech/api/payments/klikqris/callback",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({order_id:code,status:"PAID",amount:1000,total_amount:1089,signature,...overrides})}));
}
const posts=()=>fetchMock.mock.calls.filter(([url])=>String(url).endsWith("/create")).length;

describe("Paid background payment recovery",()=>{
 const run=async()=>{
  vi.stubEnv("CRON_SECRET","fixture-cron");
  const {POST}=await import("@/app/api/cron/lite/route");
  return POST(new NextRequest("https://axvara.tech/api/cron/lite?job=payments",{method:"POST",headers:{authorization:"Bearer fixture-cron"}}));
 };
 it("confirms a closed-page payment, dispatches immediately and never reissues or delivers twice",async()=>{
  await checkout();paid();mocks.skCreate.mockResolvedValue(1);fetchMock.mockClear();
  expect(await (await run()).json()).toMatchObject({ok:true,payments_checked:1,payments_confirmed:1,payments_failed:0});
  expect(row().status).toBe("lunas");expect(mocks.ensure).toHaveBeenCalledTimes(1);expect(mocks.skProcess).toHaveBeenCalledTimes(1);
  expect(posts()).toBe(0);
  expect(await (await run()).json()).toMatchObject({payments_checked:0});
  expect(mocks.ensure).toHaveBeenCalledTimes(1);
 });
 it("backs off failed confirmation, reports failure and preserves unpaid stock/reservations",async()=>{
  await checkout();paid();failStatus=true;fetchMock.mockClear();
  const stock=fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock;
  const response=await run();expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ok:false,payments_checked:1,payments_failed:1});
  expect(row().status).toBe("pending");expect(mocks.ensure).not.toHaveBeenCalled();expect(posts()).toBe(0);
  expect(await (await run()).json()).toMatchObject({payments_checked:0});
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(stock);
 });
 it("shares the atomic status gate across simultaneous ticks and skips recent visible-page checks",async()=>{
  await checkout();fetchMock.mockClear();
  await Promise.all([run(),run()]);
  expect(fetchMock.mock.calls.filter(([u])=>String(u).includes("/status/"))).toHaveLength(1);
  expect(await (await run()).json()).toMatchObject({payments_checked:0});
 });
 it("excludes expired, canceled and initializing invoices without making any upstream request",async()=>{
  await checkout(A);await checkout(B);
  fixture.sql.prepare("UPDATE orders SET expires_at=datetime('now','-1 minute') WHERE code=?").run(A);
  fixture.sql.prepare("UPDATE payment_transactions SET status='initializing' WHERE order_code=?").run(B);
  fetchMock.mockClear();expect(await (await run()).json()).toMatchObject({payments_checked:0});
  expect(fetchMock).not.toHaveBeenCalled();expect(row(A).status).toBe("pending");
  fixture.sql.prepare("UPDATE payment_transactions SET status='pending' WHERE order_code=?").run(B);
  fixture.sql.prepare("UPDATE orders SET status='dibatalkan' WHERE code=?").run(B);
  expect(await (await run()).json()).toMatchObject({payments_checked:0});expect(fetchMock).not.toHaveBeenCalled();
 });
 it("caps background checks at four pending invoices per invocation",async()=>{
  for(let n=1;n<=6;n++)await checkout(`AXV-20261023-CAP0000${n}`);
  fetchMock.mockClear();expect(await (await run()).json()).toMatchObject({payments_checked:4});
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(await (await run()).json()).toMatchObject({payments_checked:2});
  expect(posts()).toBe(0);
 });
});

describe("KlikQRIS invoice contract and durable creation",()=>{
 it.each(["081234567890","6281234567890","+6281234567890"," 0812-3456 7890 "])("sends the saved buyer phone %s in country-code format only on create",async phone=>{
  await seed(A,"web");
  fixture.sql.prepare("UPDATE orders SET customer_wa=? WHERE code=?").run(phone,A);
  const first=await createActiveQrisInvoice(A,1000);
  const [,init]=fetchMock.mock.calls[0];
  expect(JSON.parse(String(init?.body)).whatsapp_buyer).toBe("6281234567890");
  expect(JSON.stringify(first)).not.toContain("6281234567890");
  fixture.sql.prepare("UPDATE orders SET customer_wa='6289999999999' WHERE code=?").run(A);
  await createActiveQrisInvoice(A,1000);
  expect(posts()).toBe(1);
 });
 it.each(["","—","123456789","buyer@example.test","6281234567890@s.whatsapp.net","120363000000000000@g.us","call 081234567890","6281234567890123"])("omits absent or invalid buyer contact %s without blocking payment",async phone=>{
  await seed();fixture.sql.prepare("UPDATE orders SET customer_wa=? WHERE code=?").run(phone,A);
  expect((await createActiveQrisInvoice(A,1000)).payableAmount).toBe(1089);
  const [,init]=fetchMock.mock.calls[0];expect(JSON.parse(String(init?.body))).not.toHaveProperty("whatsapp_buyer");
 });
 it.each(["telegram","whatsapp"] as const)("uses the saved phone for %s orders",async channel=>{
  await seed(A,channel);fixture.sql.prepare("UPDATE orders SET customer_wa='6281234567890' WHERE code=?").run(A);
  await createActiveQrisInvoice(A,1000);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).whatsapp_buyer).toBe("6281234567890");
 });
 it("passes the Pedia checkout phone to KlikQRIS and reuses its invoice on retry",async()=>{
  vi.stubEnv("PEDIA_ENABLED","true");vi.stubEnv("PEDIA_ORDERS_ENABLED","true");
  fixture.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES(1,'followers-instagram','instagram','followers','profile','Followers','[100]',1,1);
   INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active) VALUES(1,1,'standar','indosmm',1,'G3',0,1000,1);
   INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',1,'Fixture','Fixture','Default',10000,1,1000,1);`);
  const {createPediaQuoteToken}=await import("@/lib/pedia/quote");
  const {token}=await createPediaQuoteToken({product_id:1,tier_id:1,quantity:150,target_raw:"https://instagram.com/buyer/",target_normalized:"https://instagram.com/buyer/",unit_price:2500/150,total:2500,credit_code_hash:null,credit_used:0,supplier:"indosmm",supplier_service_id:1,supplier_rate_snapshot:10000,refill_days:0,min_profit_rp:1000});
  const {POST}=await import("@/app/api/pedia/orders/route");
  const request=()=>new NextRequest("https://axvara.tech/api/pedia/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({quote_token:token,customer_wa:"0812-3456-7890",customer_email:"buyer@example.test"})});
  const response=await POST(request());expect(response.status).toBe(201);
  const result=await response.json();expect(result.qris.payable_amount).toBe(2589);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({order_id:result.code,whatsapp_buyer:"6281234567890"});
  expect((await POST(request())).status).toBe(200);expect(posts()).toBe(1);
 });
 it("uses provider total, authenticated headers, callback URL, local QR proxy and the 15-minute cap",async()=>{
  const result=await checkout();expect(result.payableAmount).toBe(1089);expect(result.uniqueCode).toBe(89);
  expect(result.qrisUrl).toBe(`https://axvara.tech/api/payments/qris/${A}/image`);
  expect(Date.parse(result.expiresAt)-Date.now()).toBeGreaterThan(14*60000);
  expect(Date.parse(result.expiresAt)-Date.now()).toBeLessThanOrEqual(15*60000);
  expect(row().expires_at).toBe(result.expiresAt);expect(row().payment_account).toBe("KlikQRIS");
  const [,init]=fetchMock.mock.calls[0];expect(init?.headers).toMatchObject({"x-api-key":"fixture-private-api-key",id_merchant:"123456789"});
  expect(JSON.parse(String(init?.body))).toMatchObject({order_id:A,amount:1000,callback_url:"https://axvara.tech/api/payments/klikqris/callback"});
  expect(JSON.stringify(result)).not.toContain(signature);expect(JSON.stringify(result)).not.toContain("fixture-private-api-key");
 });
 it("reuses the same invoice without a second POST or stock reservation",async()=>{
  const first=await checkout();const second=await createActiveQrisInvoice(A,1000);
  expect(second).toMatchObject({...first,isExisting:true});expect(posts()).toBe(1);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
 });
 it("recovers an ambiguous accepted create by GET without repeating POST",async()=>{
  await seed();failCreateAfterSave=true;
  fixture.sql.prepare("UPDATE orders SET customer_wa='081234567890' WHERE code=?").run(A);
  await expect(createActiveQrisInvoice(A,1000)).rejects.toThrow("klikqris_network_ambiguous");
  expect(tx().status).toBe("initializing");expect(row().status).toBe("pending");
  failCreateAfterSave=false;const recovered=await createActiveQrisInvoice(A,1000);
  expect(recovered.isExisting).toBe(true);expect(posts()).toBe(1);expect(tx().status).toBe("pending");
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).whatsapp_buyer).toBe("6281234567890");
  expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBeUndefined();
 });
 it("web checkout retry resumes the existing invoice and returns its QR without another reservation",async()=>{
  fixture.sql.exec("UPDATE product_variants SET price=1000,stock=1 WHERE id=1");
  const {createCheckoutQuoteToken}=await import("@/lib/auth");
  const {POST}=await import("@/app/api/orders/route");
  const {token}=await createCheckoutQuoteToken({items:[{product_id:1,variant_id:1,qty:1,price:1000,name:"Fixture"}],subtotal:1000,
   payment_methods:[{id:"qris",account_number:"-"}]});
  const request=()=>new NextRequest("https://axvara.tech/api/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({customer_wa:"081234567890",customer_email:"fixture@example.test",items:[{product_id:1,variant_id:1,qty:1}],payment_method:"qris",quote_token:token})});
  failCreateAfterSave=true;
  const failed=await POST(request());const first=await failed.json();expect(first).toMatchObject({error:expect.stringContaining("Tagihan sedang")});expect(failed.status).toBe(503);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).whatsapp_buyer).toBe("6281234567890");
  const reserved=fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock;
  expect(reserved).toBe(0);
  failCreateAfterSave=false;
  const retry=await POST(request());expect(retry.status).toBe(200);const body=await retry.json();
  expect(body).toMatchObject({code:first.code,reused:true,qris:{payable_amount:1089,image_url:expect.stringContaining("/image")}});
  expect(posts()).toBe(1);expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(reserved);
  expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM orders").get()!.n).toBe(1);
 });
 it("manual preparation recovers an initializing invoice while ordinary polling never contacts the gateway",async()=>{
  await seed(A,"web");failCreateAfterSave=true;await expect(createActiveQrisInvoice(A,1000)).rejects.toThrow();
  const {GET}=await import("@/app/api/orders/route");fetchMock.mockClear();
  const lookup=(wake=false)=>GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}${wake?"&wake=1":""}`));
  const pending=await (await lookup()).json();expect(pending.order.qris).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
  expect(pending.order.expires_at).toBe(tx().expires_at);
  const recovered=await (await lookup(true)).json();
  expect(recovered.order.qris).toMatchObject({payable_amount:1089,status:"pending"});
  expect(recovered.order.qris_preparation_error).toBe(false);expect(posts()).toBe(0);
  expect(fetchMock.mock.calls.filter(([url])=>String(url).includes("/status/"))).toHaveLength(1);
 });
 it("manual preparation leaves a missing upstream invoice ambiguous without a repeated POST",async()=>{
  await seed(A,"web");failCreateAfterSave=true;await expect(createActiveQrisInvoice(A,1000)).rejects.toThrow();
  remote.clear();fetchMock.mockClear();const {GET}=await import("@/app/api/orders/route");
  const response=await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}&wake=1`));
  const data=await response.json();expect(data.order.qris).toBeNull();expect(data.order.qris_preparation_error).toBe(true);
  expect(tx().status).toBe("initializing");expect(posts()).toBe(0);expect(row().status).toBe("pending");
 });
 it("allows only one create POST during concurrent initialization",async()=>{
  await seed();let release!:()=>void,started!:()=>void;
  const waiting=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r);
  const original=fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async(url,init)=>{if(String(url).endsWith("/create")){started();await waiting;}return original(url,init);});
  const first=createActiveQrisInvoice(A,1000);await begun;
  await expect(createActiveQrisInvoice(A,1000)).rejects.toThrow("klikqris_http_404");
  expect(row().status).toBe("pending");release();expect((await first).payableAmount).toBe(1089);expect(posts()).toBe(1);
 });
 it.each([false,true])("retains Telegram cart reservations on ambiguous creates (state read failure: %s)",async readFailure=>{
  const {createAndSendCartInvoice}=await import("@/lib/telegram/handlers/cart-invoice");
  failCreateAfterSave=true;
  let injected=false;fixture.control.fail=q=>{if(readFailure && !injected && q.includes("SELECT id FROM payment_transactions WHERE order_code=? AND provider='klikqris' AND status IN")){injected=true;return true;}return false;};
  await createAndSendCartInvoice(123,[{productId:1,variantId:1,productName:"Fixture",variantLabel:"Default",price:1000,qty:1,stock:100,minQty:1,fulfillmentMode:"manual"} as import("@/lib/telegram/cart").CartLine],{id:123,first_name:"Test"});
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
  expect(fixture.sql.prepare("SELECT status FROM orders").get()!.status).toBe("pending");
  expect(fixture.sql.prepare("SELECT status FROM payment_transactions").get()!.status).toBe("initializing");
  expect(posts()).toBe(1);
 });
 it("retains Telegram single-product reservations on an ambiguous gateway create",async()=>{
  const {createAndSendVariantInvoice}=await import("@/lib/telegram/handlers/invoice");
  const {getActiveVariant}=await import("@/lib/catalog");const variant=await getActiveVariant(1);expect(variant).toBeTruthy();
  failCreateAfterSave=true;
  await createAndSendVariantInvoice(123,1,1,"Fixture",variant!,{id:123,first_name:"Test"},1);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(99);
  expect(fixture.sql.prepare("SELECT status FROM orders").get()!.status).toBe("pending");expect(posts()).toBe(1);
 });
 it("keeps invoice captions within Telegram limits while warning about late payment",async()=>{
  const {invoiceMessage}=await import("@/lib/telegram/messages");
  const text=invoiceMessage({orderCode:A,productName:"Produk ".repeat(100),payableAmount:1089,expiresAt:new Date(Date.now()+900000).toISOString()});
  expect(text).toContain("pemeriksaan manual");expect(text.length).toBeLessThan(1024);
 });
 it("applies the additive migration without altering a legacy DANA invoice",async()=>{
  await seed();const qr="00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED","true");vi.stubEnv("DANA_STATIC_QRIS",qr+calculateCrc16(qr));vi.stubEnv("DANA_WEBHOOK_SECRET","fixture");
  const old=await createDanaQrisInvoice(A,1000);
  fixture.sql.exec("ALTER TABLE payment_transactions DROP COLUMN provider_qris_url");
  const {readFileSync}=await import("node:fs");fixture.sql.exec(readFileSync("drizzle/migrations/0069_klikqris_provider_image.sql","utf8"));
  expect(tx().provider).toBe("dana");expect(tx().payable_amount).toBe(old.payableAmount);expect(tx().provider_qris_url).toBeNull();
 });
 it("does not fall back to another gateway when explicit KlikQRIS configuration is missing",async()=>{
  await seed();vi.stubEnv("KLIKQRIS_API_KEY","");
  await expect(createActiveQrisInvoice(A,1000)).rejects.toThrow("klikqris_not_configured");expect(fetchMock).not.toHaveBeenCalled();
 });
 it("keeps an existing DANA invoice after the gateway selection changes",async()=>{
  await seed();const qr="00020101021153033605802ID6304";
  vi.stubEnv("DANA_QRIS_ENABLED","true");vi.stubEnv("DANA_STATIC_QRIS",qr+calculateCrc16(qr));vi.stubEnv("DANA_WEBHOOK_SECRET","fixture");
  const old=await createDanaQrisInvoice(A,1000);const reused=await createActiveQrisInvoice(A,1000);
  expect(reused.payableAmount).toBe(old.payableAmount);expect(tx().provider).toBe("dana");expect(posts()).toBe(0);
 });
 it("allows equal totals for different provider order IDs without cross-matching them",async()=>{
  await checkout(A);await checkout(B);paid(A);expect((await hook()).status).toBe(200);
  expect(row(A).status).toBe("lunas");expect(row(B).status).toBe("pending");
 });
 it.each(["1089.5",-1,NaN,"1e3",0,"1000.01"])("rejects malformed or fractional currency %s",value=>{expect(()=>klikQrisMoney(value)).toThrow();});
 it("interprets provider timestamps as WIB and rejects untrusted image destinations",()=>{
  expect(klikQrisTime("2026-10-18 19:00:00")).toBe(Date.parse("2026-10-18T12:00:00Z"));
  for(const url of ["http://klikqris.com/storage/a.png","https://127.0.0.1/storage/a.png","https://klikqris.com.evil.test/storage/a.png","https://klikqris.com/api/qris/create"]){expect(()=>validKlikQrisImage(url)).toThrow();}
 });
});

describe("KlikQRIS settlement boundaries",()=>{
 it("confirms server-side, atomically pays and enqueues one fulfillment job",async()=>{
  await checkout();paid();expect((await hook()).status).toBe(200);
  expect(row().status).toBe("lunas");expect(tx().status).toBe("paid");
  expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM fulfillment_jobs WHERE order_code=?").get(A)!.n).toBe(1);
  const event=fixture.sql.prepare("SELECT * FROM dana_webhook_events WHERE provider='klikqris'").get()!;
  expect(event.status).toBe("matched");expect(event.raw_text).not.toContain(signature);
 });
 it("dispatches newly created WR/SK supplier links immediately after KlikQRIS settlement — the manual Retry parity path",async()=>{
  mocks.skCreate.mockResolvedValue(1);mocks.wrCreate.mockResolvedValue(1);
  await checkout();paid();expect((await hook()).status).toBe(200);
  expect(mocks.skCreate).toHaveBeenCalledWith(A);expect(mocks.skProcess).toHaveBeenCalledWith(undefined,{skipOrphanProbe:true});
  expect(mocks.wrCreate).toHaveBeenCalledWith(A);expect(mocks.wrProcess).toHaveBeenCalledWith(undefined,{skipOrphanProbe:true});
  // Repeated callbacks must not dispatch twice (already_paid short-circuit).
  expect((await hook()).status).toBe(200);expect(mocks.skProcess).toHaveBeenCalledTimes(1);
 });
 it("does not dispatch upstream when settlement created no supplier link",async()=>{
  await checkout();paid();expect((await hook()).status).toBe(200);
  expect(mocks.skCreate).toHaveBeenCalledWith(A);expect(mocks.skProcess).not.toHaveBeenCalled();
  expect(mocks.wrProcess).not.toHaveBeenCalled();
 });
 it.each(["web","telegram","whatsapp"] as const)("retains %s fulfillment routing",async channel=>{
  await seed(A,channel);await createActiveQrisInvoice(A,1000);paid();await hook();
  expect(fixture.sql.prepare("SELECT sales_channel FROM fulfillment_jobs WHERE order_code=?").get(A)!.sales_channel).toBe(channel);
 });
 it("settles only Pedia's remaining payable amount without creating a Market fulfillment job",async()=>{
  const code="AXP-20261018-PPPPPPP1";
  await seed(code,"web");fixture.sql.prepare("UPDATE orders SET order_kind='pedia',subtotal=1500 WHERE code=?").run(code);
  await createActiveQrisInvoice(code,1000);paid(code);expect((await hook({},code)).status).toBe(200);
  expect(row(code).subtotal).toBe(1500);expect(tx(code).requested_amount).toBe(1000);expect(row(code).status).toBe("lunas");
  const {GET}=await import("@/app/api/payments/qris/[code]/image/route");
  expect((await GET(new NextRequest(`https://axvara.tech/api/payments/qris/${code}/image`),{params:Promise.resolve({code})})).status).toBe(200);
  expect(mocks.ensure).not.toHaveBeenCalled();expect(mocks.pedia).toHaveBeenCalledTimes(1);
  expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM fulfillment_jobs").get()!.n).toBe(0);
  expect(fixture.sql.prepare("SELECT sold_count FROM products WHERE id=1").get()!.sold_count).toBe(0);
 });
 it("deduplicates concurrent and repeated callbacks",async()=>{
  await checkout();paid();const responses=await Promise.all([hook(),hook()]);expect(responses.every(r=>r.status===200)).toBe(true);
  expect((await hook()).status).toBe(200);expect(mocks.ensure).toHaveBeenCalledTimes(1);
  expect(fixture.sql.prepare("SELECT COUNT(*) AS n FROM fulfillment_jobs").get()!.n).toBe(1);
 });
 it.each([{signature:"wrong"},{signature:null},{signature:""}])("rejects an invalid signature %s without querying provider status",async overrides=>{
  await checkout();paid();const before=fetchMock.mock.calls.length;expect((await hook(overrides)).status).toBe(401);
  expect(fetchMock.mock.calls.length).toBe(before);expect(row().status).toBe("pending");
 });
 it("does not trust a PAID callback while the authenticated API is still pending",async()=>{
  await checkout();const response=await hook();expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:"payment_not_yet_confirmed"});expect(row().status).toBe("pending");
 });
 it("fails closed on provider network failure and succeeds on a later confirmed callback",async()=>{
  await checkout();paid();failStatus=true;expect((await hook()).status).toBe(503);expect(row().status).toBe("pending");
  failStatus=false;expect((await hook()).status).toBe(200);expect(row().status).toBe("lunas");
 });
 it.each([{total_amount:1090},{amount:999},{merchant_id:"different"},{amount:"1000.50"}])("rejects mismatched callback fields %s",async overrides=>{
  await checkout();paid();expect((await hook(overrides)).status).toBe(400);expect(row().status).toBe("pending");
 });
 it.each([{order_id:B},{total_amount:"1090.00"},{amount:"999.00"},{signature:"different-private-signature"}])("rejects mismatched authenticated status %s",async overrides=>{
  await checkout();paid();Object.assign(remote.get(A)!,overrides);expect((await hook()).status).toBe(503);expect(row().status).toBe("pending");
 });
 it("keeps late payments in manual review without reviving an expired order or double-restoring stock",async()=>{
  await checkout();paid();const past=new Date(Date.now()-60000).toISOString();
  fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(past,A);
  fixture.sql.prepare("UPDATE payment_transactions SET expires_at=? WHERE order_code=?").run(past,A);
  vi.stubEnv("CRON_SECRET","fixture-cron");
  const {POST:expire}=await import("@/app/api/cron/lite/route");
  const expireRequest=()=>new NextRequest("https://axvara.tech/api/cron/lite?job=expiry",{method:"POST",headers:{authorization:"Bearer fixture-cron"}});
  expect(await (await expire(expireRequest())).json()).toMatchObject({expired_payments:1});
  expect(await (await expire(expireRequest())).json()).toMatchObject({expired_payments:0});
  expect(await (await hook()).json()).toMatchObject({status:"manual_review"});
  expect(await (await hook()).json()).toMatchObject({status:"manual_review"});
  expect(row().status).toBe("kadaluarsa");expect(tx().status).toBe("expired");expect(mocks.ensure).not.toHaveBeenCalled();expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()!.stock).toBe(100);
  expect(fixture.sql.prepare("SELECT last_error FROM dana_webhook_events WHERE provider='klikqris'").get()!.last_error).toBe("klikqris_late_payment_manual_review");
 });
 it("prevents amount-only admin retries from routing a KlikQRIS event to DANA",async()=>{
  await checkout();paid();fixture.sql.prepare("UPDATE orders SET expires_at=? WHERE code=?").run(new Date(Date.now()-60000).toISOString(),A);
  await hook();const event=fixture.sql.prepare("SELECT id FROM dana_webhook_events WHERE provider='klikqris'").get()!;
  const {POST}=await import("@/app/api/admin/payments/events/route");
  const response=await POST(new NextRequest("https://axvara.tech/api/admin/payments/events",{method:"POST",body:JSON.stringify({action:"retry_match",event_id:event.id})}));
  expect(response.status).toBe(409);expect(row().status).toBe("pending");
 });
 it("uses the bounded same-origin PNG proxy without exposing the provider signature",async()=>{
  await checkout();const {GET}=await import("@/app/api/payments/qris/[code]/image/route");
  const response=await GET(new NextRequest(`https://axvara.tech/api/payments/qris/${A}/image`),{params:Promise.resolve({code:A})});
  expect(response.status).toBe(200);expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer()).slice(0,8)).toEqual(new Uint8Array([137,80,78,71,13,10,26,10]));
 });
 it("does not poll KlikQRIS on routine status reads but confirms a manual check",async()=>{
   await checkout();paid();const {GET}=await import("@/app/api/orders/route");
   // Manual check stays immediate even inside the automatic-poll window.
   fixture.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now') WHERE order_code=?").run(A);
   const response=await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}&wake=1`));
   expect(response.status).toBe(200);expect(row().status).toBe("lunas");
  });
 it("automatic polling confirms a paid invoice within the throttle window and asks the gateway once",async()=>{
   await checkout();paid();const {GET}=await import("@/app/api/orders/route");
   const lookups=()=>fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/qris/status/")).length;
   const first=await (await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}`))).json();
   expect(first.order.status).toBe("lunas");expect(row().status).toBe("lunas");expect(lookups()).toBe(1);
 });
 it("automatic polling throttles repeated gateway checks and never POSTs",async()=>{
   await checkout();const {GET}=await import("@/app/api/orders/route");fetchMock.mockClear();
   const lookups=()=>fetchMock.mock.calls.filter(([url])=>String(url).includes("/api/qris/status/")).length;
   for(let i=0;i<3;i++){const body=await (await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}`))).json();expect(body.order.status).toBe("pending");}
   expect(lookups()).toBe(1);expect(posts()).toBe(0);expect(row().status).toBe("pending");
   // Once the window passes, the next automatic poll may ask again.
   fixture.sql.prepare("UPDATE payment_transactions SET last_checked_at=datetime('now','-11 seconds') WHERE order_code=?").run(A);
   await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}`));expect(lookups()).toBe(2);
 });
 it("concurrent automatic polls share one gateway check through the atomic claim",async()=>{
   await checkout();const {claimKlikQrisPollReconcile}=await import("@/lib/payments/klikqris");
   const claims=await Promise.all([claimKlikQrisPollReconcile(A),claimKlikQrisPollReconcile(A)]);
   expect(claims.filter(Boolean)).toHaveLength(1);
   expect(await claimKlikQrisPollReconcile(A)).toBe(false);
 });
 it("keeps automatic polling local for legacy DANA invoices",async()=>{
   await seed();const qr="00020101021153033605802ID6304";
   vi.stubEnv("DANA_QRIS_ENABLED","true");vi.stubEnv("DANA_STATIC_QRIS",qr+calculateCrc16(qr));vi.stubEnv("DANA_WEBHOOK_SECRET","fixture");
   await createDanaQrisInvoice(A,1000);fetchMock.mockClear();const {GET}=await import("@/app/api/orders/route");
   const body=await (await GET(new NextRequest(`https://axvara.tech/api/orders?code=${A}`))).json();
   expect(body.order.status).toBe("pending");expect(fetchMock).not.toHaveBeenCalled();
 });
});
