import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {createD1Fixture,insertTestOrder,stubFulfillmentKey} from "./helpers/d1-fixture";
import {createBudgetedDatabase,createDatabaseAccess} from "@/lib/db-access";
import {processTunvnOrders} from "@/lib/tunvn/orders";
import {notifyBuyerTunvnProcessing} from "@/lib/notify-buyer";
import {sendForwardEmail} from "@/lib/warung-rebahan/forward-sender";

vi.mock("@/lib/warung-rebahan/forward-sender",()=>({sendForwardEmail:vi.fn(async()=>({ok:true,providerId:"fixture-mail"}))}));
let fixture:ReturnType<typeof createD1Fixture>;
let done:boolean,balance:number;
const code="AXV-20261110-NOTIFY01";
const mail=vi.mocked(sendForwardEmail);
const tick=async()=>{const b=createBudgetedDatabase(40,2,fixture.db);await processTunvnOrders(b.access);expect(b.used).toBeLessThanOrEqual(38);};
const due=()=>fixture.sql.exec("UPDATE tunvn_order_links SET next_attempt_at=datetime('now','-1 minute')");
const linkId=()=>Number(fixture.sql.prepare("SELECT id FROM tunvn_order_links").get()!.id);
beforeEach(()=>{
  vi.clearAllMocks();done=false;balance=100;stubFulfillmentKey();
  for(const [key,value] of Object.entries({TUNVN_ENABLED:"true",TUNVN_SYNC_ENABLED:"true",TUNVN_API_KEY:"fixture",TUNVN_BASE_URL:"https://supplier.test"}))vi.stubEnv(key,value);
  fixture=createD1Fixture();
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price) VALUES(1,'Muse','muse-ai-1-miliar-token',1500);
    INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,buyer_field_key,max_qty,tunvn_buff_quantity_b)
    VALUES(1,1,'TUNVN-BUFF-1B','Buff',1500,'manual','muse_invite_code',30,1)`);
  insertTestOrder(fixture.sql,code,{status:"lunas",channel:"web",items:[{product_id:1,variant_id:1,name:"Muse Buff",qty:1,price:1500,fulfillment_mode:"manual",buyer_field_key:"muse_invite_code",max_qty:30,buyer_fields:{muse_invite_code:"Ab12Cd"},tunvn_eligibility:{version:1,kind:"buff",source_product_id:null,source_variant_id:1,source_unit_b:1,quantity:1,cost_usdt:2}}]});
  fixture.sql.exec("UPDATE orders SET customer_email='buyer@example.test'");
  vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>{
    const path=new URL(String(url)).pathname;
    if(path==="/api/balance")return Response.json({success:true,balance_usdt:balance,balance_vnd:0});
    if(path==="/api/buff/check")return Response.json({success:true,fundable:true,sell_price_usdt:2,orders_breakdown:[{invite_code:"Ab12Cd",quantity_b:1,valid:true}]});
    if(path==="/api/buff/order")return Response.json({batch_id:"FIXTURE_BATCH"},{status:202});
    if(path==="/api/buff/status")return Response.json({success:true,batch_id:"FIXTURE_BATCH",is_done:done,orders:[{invite_code:"Ab12Cd",quantity_b:1,currency:"usdt",order_code:"FIXTURE_ORDER",status:done?"done":"pending"}]});
    throw new Error("unexpected fixture transport");
  }));
});
afterEach(()=>{fixture.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});

it("sends processing once on accepted Buff202, before completion, with no private inputs or supplier branding",async()=>{
  await tick();expect(mail).toHaveBeenCalledOnce();
  expect(mail.mock.calls[0][0]).toMatchObject({to:"buyer@example.test",subject:expect.stringContaining("sedang diproses")});
  expect(JSON.stringify(mail.mock.calls)).not.toMatch(/Ab12Cd|FIXTURE_BATCH|TUNVN|PIN|password|Made By Order/);
  expect(mail.mock.calls[0][0].text).toContain("tidak memerlukan kredensial akun");
  due();await tick();expect(mail).toHaveBeenCalledOnce();done=true;due();await tick();expect(mail).toHaveBeenCalledOnce();
  expect(fixture.sql.prepare("SELECT status FROM tunvn_order_links").get()!.status).toBe("completed");
  expect(await notifyBuyerTunvnProcessing(code,linkId(),createDatabaseAccess(fixture.db))).toBe(false);
});
it("retries a failed processing mail on the next status poll, not the purchase",async()=>{
  mail.mockResolvedValueOnce({ok:false,error:"fixture-unavailable"});await tick();
  expect(fixture.sql.prepare("SELECT status FROM buyer_notice_log").get()!.status).toBe("failed");
  due();await tick();expect(mail).toHaveBeenCalledTimes(2);
  expect(fixture.sql.prepare("SELECT status FROM buyer_notice_log").get()!.status).toBe("sent");
  expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith("/buff/order"))).toHaveLength(1);
});
it.each(["manual","delivered","completed","unpaid","telegram"])("suppresses processing for %s orders",async(state)=>{
  await tick();mail.mockClear();fixture.sql.exec("DELETE FROM buyer_notice_log");
  if(state==="manual")fixture.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
  if(state==="delivered")fixture.sql.exec("UPDATE fulfillment_items SET status='delivered'");
  if(state==="completed")fixture.sql.exec("UPDATE tunvn_order_links SET status='completed'");
  if(state==="unpaid")fixture.sql.exec("UPDATE orders SET payment_status='pending'");
  if(state==="telegram")fixture.sql.exec("UPDATE orders SET sales_channel='telegram'");
  expect(await notifyBuyerTunvnProcessing(code,linkId(),createDatabaseAccess(fixture.db))).toBe(false);expect(mail).not.toHaveBeenCalled();
});
it("sends only the manual-handling notice on insufficient balance, never a processing announcement",async()=>{
  balance=0;await tick();
  expect(fixture.sql.prepare("SELECT status,last_error,request_sent_at FROM tunvn_order_links").get()).toMatchObject({status:"needs_admin",last_error:"insufficient_balance",request_sent_at:null});
  expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).endsWith("/buff/order"))).toBe(false);
  expect(await notifyBuyerTunvnProcessing(code,linkId(),createDatabaseAccess(fixture.db))).toBe(false);
  expect(mail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    to:"buyer@example.test",subject:`Pengiriman pesanan ${code} bermasalah`,text:expect.stringContaining("akan mengirimkannya manual"),
  }));
  expect(fixture.sql.prepare("SELECT idempotency_key,status FROM buyer_notice_log WHERE channel='email'").all()).toEqual([
    {idempotency_key:`email:delivery-failed:${code}`,status:"sent"},
  ]);
});
it("renders English using the immutable order locale",async()=>{
  fixture.sql.exec("UPDATE orders SET locale='en'");await tick();
  expect(mail.mock.calls[0][0]).toMatchObject({subject:expect.stringContaining("is being processed"),text:expect.stringContaining("No account credentials are needed")});
});
it("announces accepted account preparation without including credentials",async()=>{
  fixture.sql.exec("UPDATE products SET slug='chatgpt-tunvn'; UPDATE product_variants SET sku='TUNVN-86',tunvn_source_product_id=86,buyer_field_key=NULL,max_qty=NULL,tunvn_buff_quantity_b=NULL");
  fixture.sql.prepare("UPDATE orders SET items=?").run(JSON.stringify([{product_id:1,variant_id:1,qty:1,price:1500,fulfillment_mode:"manual",tunvn_eligibility:{version:1,kind:"account",source_product_id:86,source_variant_id:1,source_unit_b:null,quantity:1,cost_usdt:2}}]));
  vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>{
    const path=new URL(String(url)).pathname;
    if(path==="/api/products")return Response.json({success:true,products:[{id:86,name:"Account",price_vnd:50000,price_usdt:2,stock:10}]});
    if(path==="/api/balance")return Response.json({success:true,balance_usdt:100,balance_vnd:0});
    if(path==="/api/buy")return Response.json({success:true,order:{order_group:"FIXTURE_GROUP",quantity:1,total_items:1,total_price:2,currency:"usdt"},items:["private-account-secret"]});
    throw new Error("unexpected fixture transport");
  }));
  await tick();expect(mail).toHaveBeenCalledOnce();expect(JSON.stringify(mail.mock.calls)).not.toMatch(/private-account-secret|FIXTURE_GROUP|token Muse|TUNVN/);
  expect(fixture.sql.prepare("SELECT status FROM tunvn_order_links").get()!.status).toBe("completed");
});
