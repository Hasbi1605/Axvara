import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { POST } from "@/app/api/pedia/orders/route";
import * as qris from "@/lib/payments/dana-qris";

const fixtures: ReturnType<typeof createD1Fixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function seed() {
  clearRateLimitBucketsForTest();
  vi.stubEnv("PEDIA_ENABLED", "true"); vi.stubEnv("PEDIA_ORDERS_ENABLED", "true"); vi.stubEnv("ADMIN_JWT_SECRET", "atomic-checkout-test-secret");
  const f=createD1Fixture();fixtures.push(f);
  f.sql.exec(`INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES(1,'followers-instagram','instagram','followers','profile','Followers','[100]',1,1);
    INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active) VALUES(1,1,'standar','indosmm',1,'G3',0,1000,1);
    INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',1,'Private','Private','Default',10000,1,1000,1);
    INSERT INTO pedia_credits(id,code_hash,code_hint,email,amount,remaining,source_kind,expires_at) VALUES(1,'credit-hash','XXXX','a@b.com',10000,10000,'admin','2099-01-01');`);
  vi.spyOn(qris,"createActiveQrisInvoice").mockImplementation(async(code,amount)=>({orderCode:code,requestedAmount:amount,payableAmount:amount+1,uniqueCode:1,qrisPayload:"test",qrisUrl:"/qr.png",expiresAt:"2099-01-01",isExisting:false}));
  return f;
}
async function token(creditUsed=500,target="https://www.instagram.com/buyer/") {
  return (await createPediaQuoteToken({product_id:1,tier_id:1,quantity:150,target_raw:target,target_normalized:target,unit_price:2500/150,total:2500,credit_code_hash:creditUsed ? "credit-hash" : null,credit_used:creditUsed,supplier:"indosmm",supplier_service_id:1,supplier_rate_snapshot:10000,refill_days:0,min_profit_rp:1000})).token;
}
const order=(t:string)=>POST(new Request("http://x/api/pedia/orders",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({quote_token:t,customer_wa:"081234567890",customer_email:"a@b.com"})}) as never);
const left=(f:ReturnType<typeof seed>)=>Number(f.sql.prepare("SELECT remaining FROM pedia_credits WHERE id=1").get()?.remaining);

describe("Pedia checkout money transaction",()=>{
 it("parallel retries of a free quantity create one job, one debit, one ledger",async()=>{
  const f=seed(),t=await token();const results=await Promise.all([order(t),order(t)]);expect(results.map(r=>r.status).sort()).toEqual([200,201]);
  expect(left(f)).toBe(9500);expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(1);expect(f.sql.prepare("SELECT COUNT(*) n FROM pedia_order_items").get()?.n).toBe(1);
  expect(f.sql.prepare("SELECT delta FROM pedia_credit_ledger").get()?.delta).toBe(-500);
 });
 it("rejected duplicate target never consumes another credit",async()=>{
  const f=seed();expect((await order(await token())).status).toBe(201);const response=await order(await token());expect(response.status).toBe(409);expect((await response.json()).error).toBe("duplicate_active_order");expect(left(f)).toBe(9500);
 });
 it("job insertion failure rolls back order, debit and ledger",async()=>{
  const f=seed();f.control.fail=(q)=>q.includes("INSERT INTO pedia_order_items");expect((await order(await token())).status).toBe(503);expect(left(f)).toBe(10000);expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);expect(f.sql.prepare("SELECT COUNT(*) n FROM pedia_credit_ledger").get()?.n).toBe(0);
 });
 it("a spent credit requires review and cannot silently increase payable",async()=>{
  const f=seed(),t=await token();f.sql.exec("UPDATE pedia_credits SET remaining=100");const r=await order(t);expect(r.status).toBe(409);expect((await r.json()).error).toBe("credit_changed");expect(left(f)).toBe(100);expect(f.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
 });
 it("failed QR creation is recoverable by the same quote with one debit",async()=>{
  const f=seed(),t=await token();vi.mocked(qris.createActiveQrisInvoice).mockRejectedValueOnce(new Error("offline"));const fail=await order(t);expect(fail.status).toBe(503);const a=await fail.json();const retry=await order(t);expect(retry.status).toBe(200);expect((await retry.json()).code).toBe(a.code);expect(left(f)).toBe(9500);
 });
 it("full credit settles payment and records the same atomic ledger",async()=>{
  const f=seed();const r=await order(await token(2500));expect(r.status).toBe(201);expect((await r.json()).status).toBe("lunas");expect(left(f)).toBe(7500);expect(f.sql.prepare("SELECT payment_status FROM orders").get()?.payment_status).toBe("paid");expect(qris.createActiveQrisInvoice).not.toHaveBeenCalled();
 });
 it("expiration returns reserved credit once and frees the target",async()=>{
  const f=seed();const first=await order(await token());expect(first.status).toBe(201);f.sql.exec("UPDATE orders SET status='kadaluarsa',expires_at='2000-01-01'");
  const {expirePediaCheckouts}=await import("@/lib/pedia/expire");const {createDatabaseAccess}=await import("@/lib/db-access");
  await expirePediaCheckouts(createDatabaseAccess(f.db));await expirePediaCheckouts(createDatabaseAccess(f.db));expect(left(f)).toBe(10000);
  expect(f.sql.prepare("SELECT COUNT(*) n FROM pedia_credit_ledger WHERE delta>0").get()?.n).toBe(1);expect(f.sql.prepare("SELECT status FROM pedia_order_items").get()?.status).toBe("expired");
  expect((await order(await token())).status).toBe(201);
 });

 it.each(["indosmm", "providersmm"] as const)("%s: quote → QR → paid → dispatch → completed → refill preserves the public and private snapshots",async(provider)=>{
  const f=seed();f.sql.exec("INSERT INTO products(id,slug,name,price,sold_count,is_active) VALUES(1,'market-product','Market product',1000,0,1)");f.sql.prepare("UPDATE pedia_supplier_services SET supplier=?").run(provider);f.sql.prepare("UPDATE pedia_tiers SET supplier=?,target_format='username',refill_days=30,refill_anchor='completed',public_name='Nama tersimpan',terms_md='Refill 30 hari sejak pesanan selesai' ").run(provider);
  const {POST:quote}=await import("@/app/api/pedia/quote/route");const response=await quote(new Request("http://x",{method:"POST",body:JSON.stringify({product_id:1,tier_id:1,quantity:150,target:"https://instagram.com/buyer"})}) as never);expect(response.status).toBe(200);
  const r=await order((await response.json()).quote_token);expect(r.status).toBe(201);const {code}=await r.json();
  const {GET:status}=await import("@/app/api/pedia/orders/[code]/route");const get=()=>status(new Request("http://x") as never,{params:Promise.resolve({code})});
  expect((await (await get()).json()).order.status).toBe("awaiting_payment");
  f.sql.prepare("INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,payable_amount,status,expires_at) VALUES(?,'dana','static',?,'fixture',2500,2501,'pending','2099-01-01')").run(code,code);
  const {transitionPendingPaymentToPaid}=await import("@/lib/db");expect(await transitionPendingPaymentToPaid(code)).toBe(true);expect(f.sql.prepare("SELECT sold_count FROM products WHERE id=1").get()?.sold_count).toBe(0);
  f.sql.exec("UPDATE pedia_products SET name='Changed';UPDATE pedia_tiers SET public_name='Changed',terms_md='Changed',target_format='url',refill_anchor='created';UPDATE pedia_order_items SET created_at=datetime('now','-40 days')");
  const calls: unknown[][]=[];const {processPediaPaidOrders}=await import("@/lib/pedia/dispatch");
  const caller=vi.fn(async(action,params,_timeout,_key,source)=>{calls.push([action,params,source]);return {ok:true,data:action==='add'?{order:'SUPPLIER-1'}:{status:'Completed',remains:'0',start_count:'10'},status:200};});
  await processPediaPaidOrders(caller as never);f.sql.exec("UPDATE pedia_order_items SET lease_until=NULL");await processPediaPaidOrders(caller as never);
  expect(calls[0]).toEqual(['add',{service:1,link:'buyer',quantity:150},provider]);
  const publicStatus=(await (await get()).json()).order;expect(publicStatus.status).toBe('completed');expect(publicStatus.refill_eligible).toBe(true);expect(publicStatus.service_copy.service_name).toBe('Nama tersimpan');expect(publicStatus.service_copy.terms).toContain('sejak pesanan selesai');
  const proxy=await import("@/lib/pedia/proxy");const refillSpy=vi.spyOn(proxy,'callPediaProxy').mockResolvedValue({ok:true,data:{refill:'REFILL-1'},status:200} as never);
  const {POST:refill}=await import("@/app/api/pedia/orders/[code]/refill/route");const refillResponse=await refill(new Request("http://x",{method:'POST',body:JSON.stringify({contact:'a@b.com'})}) as never,{params:Promise.resolve({code})});
  expect(refillResponse.status).toBe(200);expect(refillSpy.mock.calls[0][0]).toBe(provider);expect(f.sql.prepare("SELECT refill_status FROM pedia_order_items").get()?.refill_status).toBe('submitted');
 });

});
