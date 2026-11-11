import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture,insertTestOrder,stubFulfillmentKey } from "./helpers/d1-fixture";
import { createBudgetedDatabase,createDatabaseAccess } from "@/lib/db-access";
import { createTunvnOrderLinks,processTunvnOrders,retryTunvnOrder } from "@/lib/tunvn/orders";
import { decryptSecret,encryptSecret } from "@/lib/fulfillment/crypto";
import { ensureFulfillmentItems } from "@/lib/fulfillment/delivery/inventory-binding";
import { processItem } from "@/lib/fulfillment/delivery/send";
import { readDeliveredSnapshots } from "@/lib/fulfillment/delivery/buyer-email";

vi.mock("@/lib/auth",()=>({requireAdmin:vi.fn(async()=>({sid:"fixture"}))}));
vi.mock("@/lib/telegram/api",()=>({sendMessage:vi.fn(async()=>({message_id:1}))}));
vi.mock("@/lib/notify-buyer",()=>({notifyBuyerBuffCompleted:vi.fn(async()=>true),notifyBuyerTunvnProcessing:vi.fn(async()=>true)}));
vi.mock("@/lib/fulfillment/delivery/buyer-email",async original=>({
  ...await original<object>(),sendWebDeliveryEmail:vi.fn(async()=>({ok:true})),
}));

type Row=Record<string,unknown>;
let fixture:ReturnType<typeof createD1Fixture>;
let purchase:Row,status:Row,stock:number,balance:number,price:number,purchaseStatus:number;
let transport:ReturnType<typeof vi.fn<(url:unknown,init?:RequestInit)=>Promise<Response>>>;
const response=(json:unknown,status=200)=>new Response(JSON.stringify(json),{status});
const account=(qty=1):Row=>({product_id:1,variant_id:1,name:"ChatGPT Private",qty,price:10000,fulfillment_mode:"manual",
  tunvn_eligibility:{version:1,kind:"account",source_product_id:86,source_variant_id:1,source_unit_b:null,quantity:qty,cost_usdt:qty*2}});
const buff=(qty=1):Row=>({product_id:2,variant_id:2,name:"Buff",qty,price:2000,fulfillment_mode:"manual",buyer_field_key:"muse_invite_code",max_qty:30,buyer_fields:{muse_invite_code:"Ab12Cd"},
  tunvn_eligibility:{version:1,kind:"buff",source_product_id:null,source_variant_id:2,source_unit_b:1,quantity:qty,cost_usdt:qty*2}});
const seed=(items:Row[]=[account()],code="AXV-20261110-TEST0001")=>insertTestOrder(fixture.sql,code,{status:"lunas",channel:"web",items});
const link=()=>fixture.sql.prepare("SELECT * FROM tunvn_order_links ORDER BY id LIMIT 1").get()!;
const due=()=>fixture.sql.exec("UPDATE tunvn_order_links SET next_attempt_at=datetime('now','-1 minute'),lease_expires_at=NULL");
const buys=()=>transport.mock.calls.filter(([url])=>/\/api\/(buy|buff\/order)$/.test(String(url))).length;
const tick=()=>processTunvnOrders(createDatabaseAccess(fixture.db));

beforeEach(()=>{
  vi.stubEnv("TUNVN_ENABLED","true");vi.stubEnv("TUNVN_SYNC_ENABLED","true");vi.stubEnv("TUNVN_API_KEY","fixture-only");
  vi.stubEnv("TUNVN_BASE_URL","https://supplier.test");stubFulfillmentKey();
  fixture=createD1Fixture();
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,source) VALUES(1,'ChatGPT Private','chatgpt-tunvn',10000,'manual'),(2,'Muse','muse-ai-1-miliar-token',2000,'manual');
    INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode) VALUES(1,1,'TUNVN-86','Business',10000,'manual');
    INSERT INTO product_variants(id,product_id,sku,label,price,fulfillment_mode,buyer_field_key,max_qty,tunvn_buff_quantity_b) VALUES(2,2,'TUNVN-BUFF-1B','Buff',2000,'manual','muse_invite_code',30,1);`);
  stock=100;balance=100;price=2;purchaseStatus=200;
  purchase={success:true,order:{order_group:"ORD_FIXTURE",quantity:1,total_items:1,total_price:2,currency:"USDT"},items:["fixture@example.test | secret"]};
  status={success:true,batch_id:"BUFF_FIXTURE",is_done:false,orders:[{invite_code:"Ab12Cd",quantity_b:1,currency:"usdt",order_code:"TELE_FIXTURE",status:"pending"}]};
  transport=vi.fn(async(url:unknown,init?:RequestInit)=>{
    const path=new URL(String(url)).pathname;
    if(path==="/api/products")return response({success:true,products:[{id:86,name:"Account",price_vnd:50000,price_usdt:price,stock}]});
    if(path==="/api/balance")return response({success:true,balance_usdt:balance,balance_vnd:0,username:"fixture"});
    if(path==="/api/buff/check") {
      const qty=Number(JSON.parse(String(init?.body)).orders_text.split(" ")[1]);
      return response({success:true,fundable:true,sell_price_usdt:qty*price,orders_breakdown:[{invite_code:"Ab12Cd",quantity_b:qty,valid:true}]});
    }
    if(path==="/api/buff/status")return response(status);
    if(["/api/buy","/api/buff/order"].includes(path))return response(purchase,purchaseStatus);
    throw new Error("Unexpected fixture request");
  });
  vi.stubGlobal("fetch",transport);
});
afterEach(()=>{fixture.close();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});

describe("durable purchasing",()=>{
  it("competing workers and paid replays produce one link and one POST",async()=>{
    const order=seed();await Promise.all([createTunvnOrderLinks(String(order.code)),createTunvnOrderLinks(String(order.code))]);
    await Promise.all([tick(),tick(),tick()]);
    expect(buys()).toBe(1);expect(link().status).toBe("completed");
    expect(fixture.sql.prepare("SELECT count(*) n FROM tunvn_order_links").get()?.n).toBe(1);
    const req=transport.mock.calls.find(([url])=>String(url).endsWith("/buy"))!;
    expect(JSON.parse(String(req[1]?.body))).toEqual({product_id:86,quantity:1,currency:"usdt"});
  });
  it("persists the send fence before transport",async()=>{
    seed();const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>{if(String(url).endsWith("/buy"))expect(link()).toMatchObject({attempt_count:1,request_sent_at:expect.any(String)});return original(url,init);});
    await tick();expect(buys()).toBe(1);
  });
  it("supports the real web snapshot contract without an item-level mode",async()=>{
    const item=account();delete item.fulfillment_mode;seed([item]);await tick();
    expect(buys()).toBe(1);expect(link().status).toBe("completed");
  });
  it.each([false,true])("atomic web factory stamps cost and excludes admin tests (%s)",async adminPaymentTest=>{
    vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-only-buyer-key");
    fixture.sql.exec("INSERT INTO tunvn_products(supplier_product_id,name,price_usdt) VALUES(86,'Account',2)");
    const {createOrderWithStock}=await import("@/lib/db/orders-create");
    await createOrderWithStock({code:"AXV-20261110-FACTORY1",quoteId:"fixture-quote",customerName:"Fixture",customerWa:"628000000000",customerEmail:"buyer@example.test",items:[{product_id:1,variant_id:1,name:"ChatGPT Private",price:10000,qty:1}],subtotal:10000,paymentMethod:"qris",paymentAccount:"QRIS",proofUrl:null,adminPaymentTest});
    fixture.sql.exec("UPDATE orders SET status='lunas',payment_status='paid'");
    await tick();expect(buys()).toBe(adminPaymentTest?0:1);
    const saved=fixture.sql.prepare("SELECT * FROM orders").get()!;
    expect(saved.supplier_purchase_disabled).toBe(adminPaymentTest?1:0);
    expect(JSON.parse(String(saved.items))[0].tunvn_eligibility).toEqual(adminPaymentTest?undefined:expect.objectContaining({version:1,cost_usdt:2}));
  });
  it("reclaims an expired pre-send lease",async()=>{
    const order=seed();await createTunvnOrderLinks(String(order.code));
    fixture.sql.exec("UPDATE tunvn_order_links SET status='claimed',lease_owner='dead',lease_expires_at=datetime('now','-1 minute')");
    await tick();expect(buys()).toBe(1);expect(link().status).toBe("completed");
  });
  it("never replays an expired post-send lease",async()=>{
    const order=seed();await createTunvnOrderLinks(String(order.code));
    fixture.sql.exec("UPDATE tunvn_order_links SET status='claimed',attempt_count=1,request_sent_at=datetime('now'),lease_expires_at=datetime('now','-1 minute')");
    await tick();expect(buys()).toBe(0);expect(link()).toMatchObject({status:"needs_admin",last_error:"sent_without_receipt",attempt_count:1});
  });
  it.each([400,403,404,409,429,500,503])("does not replay HTTP %i based on status or prose",async http=>{
    seed();purchaseStatus=http;purchase={success:false,error:"Stock was just purchased by another buyer; safe to retry"};
    await tick();for(let i=0;i<4;i++){due();await tick();}
    expect(buys()).toBe(1);expect(link()).toMatchObject({status:"needs_admin",attempt_count:1,request_sent_at:expect.any(String)});
  });
  it.each(["timeout","unreadable","invalid_json"])("retains the fence after %s",async fault=>{
    seed();const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>{
      if(!String(url).endsWith("/buy"))return original(url,init);
      if(fault==="timeout")throw new Error("fixture timeout");
      if(fault==="unreadable")return {status:200,text:async()=>{throw new Error("fixture body fault");}} as unknown as Response;
      return new Response("fixture invalid");
    });
    await tick();due();await tick();expect(buys()).toBe(1);expect(link().status).toBe("needs_admin");
    expect(link().request_sent_at).toBeTruthy();
  });
  it.each(["stock","balance","encryption"])("fails preflight %s without purchase",async fault=>{
    seed();if(fault==="stock")stock=0;if(fault==="balance")balance=0;if(fault==="encryption")vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY","");
    await tick();expect(buys()).toBe(0);expect(link().status).toBe("needs_admin");expect(link().request_sent_at).toBeNull();
  });
  it.each([1,3])("accepts current account cost %s without changing the paid order or cost snapshot",async current=>{
    seed();const order=fixture.sql.prepare("SELECT items,subtotal FROM orders").get();price=current;(purchase.order as Row).total_price=current;
    await tick();due();await tick();
    expect(buys()).toBe(1);expect(link()).toMatchObject({status:"completed",last_error:null,cost_usdt:2});
    expect(JSON.parse(String(link().receipt_json)).charged_usdt).toBe(current);
    expect(fixture.sql.prepare("SELECT items,subtotal FROM orders").get()).toEqual(order);
  });
  it.each(["legacy","unpaid","admin_test","games","source","stale","bundle","disabled"])("does not buy %s",async kind=>{
    const item=account();if(kind==="legacy")delete item.tunvn_eligibility;
    if(kind==="stale")(item.tunvn_eligibility as Row).source_variant_id=99;
    const order=seed([item]);
    if(kind==="unpaid")fixture.sql.exec("UPDATE orders SET payment_status='pending'");
    if(kind==="admin_test")fixture.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
    if(kind==="games")fixture.sql.exec("UPDATE orders SET order_kind='games'");
    if(kind==="source")fixture.sql.exec("UPDATE products SET source='warung_rebahan',wr_product_id='wr-owned' WHERE id=1");
    if(kind==="bundle")fixture.sql.exec("UPDATE product_variants SET sku='TUNVN-BUFF-5B' WHERE id=1");
    if(kind==="disabled")fixture.sql.exec("UPDATE product_variants SET is_active=0 WHERE id=1");
    await processTunvnOrders(createDatabaseAccess(fixture.db),{orderCode:String(order.code)});expect(buys()).toBe(0);
  });
  it("does not work when existing configuration is off",async()=>{seed();vi.stubEnv("TUNVN_SYNC_ENABLED","false");await tick();expect(transport).not.toHaveBeenCalled();});
  it("encrypts all partial and extra accounts; releases only purchased complete quantity",async()=>{
    seed();purchase={success:true,order:{order_group:"ORD_EXTRA",quantity:1,total_items:2,total_price:2,currency:"usdt"},items:["purchased-secret","admin-only-extra"]};
    await tick();const stored=link();
    expect(stored.status).toBe("completed");expect(JSON.stringify(stored)).not.toContain("admin-only-extra");
    expect(await decryptSecret(String(stored.receipt_ciphertext),String(stored.receipt_iv))).toContain("admin-only-extra");
    const item=fixture.sql.prepare("SELECT * FROM fulfillment_items").get()!;
    expect(await decryptSecret(String(item.delivered_ciphertext),String(item.delivered_iv))).toBe("purchased-secret");
  });
  it("keeps partial credentials encrypted, never repurchases or pretends complete",async()=>{
    seed([account(2)]);purchase={success:true,order:{order_group:"ORD_PARTIAL",quantity:2,total_items:2,total_price:4,currency:"usdt"},items:["partial-secret"]};
    await tick();due();await tick();expect(link().status).toBe("needs_admin");expect(buys()).toBe(1);
    expect(await decryptSecret(String(link().receipt_ciphertext),String(link().receipt_iv))).toContain("partial-secret");
    expect(fixture.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get()).toMatchObject({status:"manual_required",delivered_ciphertext:null});
  });
  it("recovers a durable encrypted receipt without a new POST",async()=>{
    const order=seed();await createTunvnOrderLinks(String(order.code));
    const sealed=await encryptSecret(JSON.stringify(purchase));
    fixture.sql.prepare("UPDATE tunvn_order_links SET status='claimed',request_sent_at=datetime('now'),attempt_count=1,receipt_http_status=200,receipt_ciphertext=?,receipt_iv=?").run(sealed.ciphertext,sealed.iv);
    await tick();expect(buys()).toBe(0);expect(link().status).toBe("completed");
  });
  it("fences a DB fault after charge",async()=>{
    seed();fixture.control.fail=q=>q.includes("SET receipt_ciphertext=");await tick();fixture.control.fail=null;
    due();await tick();expect(buys()).toBe(1);expect(link().request_sent_at).toBeTruthy();expect(link().status).toBe("needs_admin");
  });
  it("processes at most one link per invocation and stays below 40 statements",async()=>{
    seed([account(),buff()]);const budget=createBudgetedDatabase(40,2,fixture.db);await processTunvnOrders(budget.access);
    expect(buys()).toBe(1);expect(budget.used).toBeLessThanOrEqual(38);
  });
  it("does not spend against an item bound to another supplier",async()=>{
    const order=seed();await ensureFulfillmentItems(order);fixture.sql.exec(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost) VALUES(123,'${order.code}','fixture',1); UPDATE fulfillment_items SET wr_link_id=123`);
    await tick();expect(buys()).toBe(0);expect(link().status).toBe("needs_admin");
  });
  it("rejects a mismatched fulfillment identity before spending",async()=>{
    const order=seed();await ensureFulfillmentItems(order);fixture.sql.exec("UPDATE fulfillment_items SET product_id=2,variant_id=2");
    await tick();expect(buys()).toBe(0);expect(link().status).toBe("needs_admin");
  });
  it("mixed manual and supplier lines keep independent ownership and indices",async()=>{
    const ordinary={product_id:2,variant_id:2,name:"Manual",price:2000,qty:1};
    const order=seed([ordinary,account()]);await ensureFulfillmentItems(order);await tick();
    const rows=fixture.sql.prepare("SELECT item_index,tunvn_link_id,status FROM fulfillment_items ORDER BY item_index").all();
    expect(rows[0]).toMatchObject({item_index:0,tunvn_link_id:null,status:"queued"});expect(rows[1].tunvn_link_id).toBe(link().id);
    expect(link()).toMatchObject({item_index:1,status:"completed"});expect(buys()).toBe(1);
  });
});

describe("safe admin retry",()=>{
  const post=async(action="retry")=>{
    const {POST}=await import("@/app/api/admin/tunvn/orders/route");
    return POST(new NextRequest("https://axvara.test/api/admin/tunvn/orders",{method:"POST",body:JSON.stringify({id:link().id,action})}));
  };
  it("shows the balance failure in both admin lists and retries only once after top-up",async()=>{
    seed();balance=0;await tick();
    expect(link()).toMatchObject({status:"needs_admin",last_error:"insufficient_balance",attempt_count:0,request_sent_at:null});
    const {GET}=await import("@/app/api/admin/tunvn/orders/route");
    expect((await (await GET(new NextRequest("https://axvara.test/api/admin/tunvn/orders"))).json()).items[0].can_retry).toBe(1);
    const list=await import("@/app/api/admin/orders/route");
    const admin=await (await list.GET(new NextRequest("https://axvara.test/api/admin/orders"))).json();
    expect(admin.orders[0].supplier_links[0]).toMatchObject({supplier:"tunvn",status:"needs_admin",last_error:"insufficient_balance",can_retry:true,item_index:0});
    expect(JSON.stringify(admin)).not.toMatch(/receipt_ciphertext|receipt_iv|tunvn_eligibility/);
    const stillEmpty=await post();expect(stillEmpty.status).toBe(200);
    expect((await stillEmpty.json()).link.last_error).toBe("insufficient_balance");expect(buys()).toBe(0);
    balance=100;const results=await Promise.all([post(),post()]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(buys()).toBe(1);expect(link().status).toBe("completed");
    expect((await post()).status).toBe(409);expect(buys()).toBe(1);
  });
  it("checks Buff wallet separately from an unfundable service, never calling an unreadable wallet insufficient",async()=>{
    seed([buff()]);const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>String(url).endsWith("/buff/check") ? response({success:true,fundable:false,sell_price_usdt:2,orders_breakdown:[{invite_code:"Ab12Cd",quantity_b:1,valid:true}]}) : original(url,init));
    balance=0;await tick();expect(link().last_error).toBe("insufficient_balance");
    balance=100;await post();expect(link().last_error).toBe("buff_unavailable");expect(buys()).toBe(0);
    transport.mockImplementation(async(url,init)=>String(url).endsWith("/balance") ? response({},502) : original(url,init));
    await post();expect(link().last_error).toBe("balance_unavailable");expect(buys()).toBe(0);
  });
  it("recovers a legacy generic failure without clearing a send fence",async()=>{
    seed();balance=0;await tick();fixture.sql.exec("UPDATE tunvn_order_links SET last_error='dispatch_unconfirmed'");
    balance=100;expect((await post()).status).toBe(200);expect(buys()).toBe(1);
  });
  it.each([
    "request_sent_at=datetime('now')","attempt_count=1","provider_batch_id='KNOWN'","provider_order_group='KNOWN'","provider_order_code='KNOWN'",
    "receipt_ciphertext='sealed'","receipt_iv='iv'","receipt_http_status=409","receipt_json='{}'","completed_at=datetime('now')",
    "lease_owner='other',lease_expires_at=datetime('now','+1 minute')","last_error='source_changed'",
  ])("refuses retry with %s",async change=>{
    seed();balance=0;await tick();fixture.sql.exec(`UPDATE tunvn_order_links SET ${change}`);
    expect((await post()).status).toBe(409);expect(buys()).toBe(0);
  });
  it.each(["unpaid","admin_test","delivered","sending","other_supplier","off","source_changed","snapshot_changed"])("does not purchase after %s",async state=>{
    seed();balance=0;await tick();balance=100;
    if(state==="unpaid")fixture.sql.exec("UPDATE orders SET payment_status='pending'");
    if(state==="admin_test")fixture.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
    if(state==="delivered"||state==="sending")fixture.sql.prepare("UPDATE fulfillment_items SET status=?").run(state);
    if(state==="other_supplier")fixture.sql.exec("INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost) SELECT 100,code,'fixture',1 FROM orders; UPDATE fulfillment_items SET wr_link_id=100");
    if(state==="off")vi.stubEnv("TUNVN_SYNC_ENABLED","false");
    if(state==="source_changed")fixture.sql.exec("UPDATE product_variants SET is_active=0");
    if(state==="snapshot_changed")fixture.sql.exec("UPDATE tunvn_order_links SET quantity=2");
    await post();expect(buys()).toBe(0);
  });
  it("retries a legacy cost_changed failure at the current price without rewriting its snapshot",async()=>{
    seed();balance=0;await tick();fixture.sql.exec("UPDATE tunvn_order_links SET last_error='cost_changed'");
    price=3;balance=100;(purchase.order as Row).total_price=3;
    expect((await post()).status).toBe(200);expect(buys()).toBe(1);
    expect(link()).toMatchObject({status:"completed",last_error:null,cost_usdt:2});
    expect((await post()).status).toBe(409);expect(buys()).toBe(1);
  });
  it("rechecks delivered state in retry CAS and rejects handover while dispatch owns the item",async()=>{
    const order=seed();balance=0;await tick();
    const db=createDatabaseAccess(fixture.db),write=db.execRun;
    db.execRun=async(sql,...params)=>{if(sql.includes("SET status='pending',last_error=NULL"))fixture.sql.exec("UPDATE fulfillment_items SET status='delivered'");return write(sql,...params);};
    expect(await retryTunvnOrder(db,Number(link().id))).toBe(false);expect(buys()).toBe(0);
    fixture.sql.exec("UPDATE fulfillment_items SET status='manual_required'; UPDATE tunvn_order_links SET status='pending'");
    const {recordManualHandoverDetailed}=await import("@/lib/fulfillment/delivery/handover");
    expect((await recordManualHandoverDetailed(String(order.code),0,"fixture@example.test")).ok).toBe(false);
    expect(fixture.sql.prepare("SELECT status FROM fulfillment_items").get()?.status).toBe("manual_required");
  });
  it("requires admin before retry",async()=>{
    seed();balance=0;await tick();const {requireAdmin}=await import("@/lib/auth");
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);expect((await post()).status).toBe(401);expect(buys()).toBe(0);
  });
});

describe("automatic recovery without a second purchase",()=>{
  it("recovers a fresh insufficient balance failure after top-up with a bounded delay",async()=>{
    seed();balance=0;await tick();balance=100;
    await tick();expect(buys()).toBe(0);
    due();const budget=createBudgetedDatabase(40,2,fixture.db);await processTunvnOrders(budget.access);
    expect(budget.used).toBeLessThanOrEqual(38);expect(buys()).toBe(1);expect(link().status).toBe("completed");
    due();await tick();expect(buys()).toBe(1);
  });
  it.each(["disabled","old","ambiguous","handover"])("does not auto-buy a %s preflight failure",async kind=>{
    seed();balance=0;await tick();balance=100;due();
    if(kind==="disabled")fixture.sql.exec("UPDATE orders SET supplier_purchase_disabled=1");
    if(kind==="old")fixture.sql.exec("UPDATE orders SET created_at=datetime('now','-25 hours')");
    if(kind==="ambiguous")fixture.sql.exec("UPDATE tunvn_order_links SET last_error='dispatch_unconfirmed'");
    if(kind==="handover")fixture.sql.exec("UPDATE fulfillment_items SET status='delivered',last_error='manual_handover:fixture'");
    await tick();expect(buys()).toBe(0);
  });
  it("recovers a saved account receipt after a transient settlement DB fault without POSTing again",async()=>{
    seed();fixture.control.fail=q=>q.includes("SET provider_order_group=");await tick();fixture.control.fail=null;
    expect(link()).toMatchObject({status:"needs_admin",last_error:"dispatch_unconfirmed",receipt_http_status:200,attempt_count:1});
    due();await tick();expect(link().status).toBe("completed");expect(buys()).toBe(1);
  });
  it("retries an unavailable read-only Buff preflight, without counting a purchase attempt",async()=>{
    seed([buff()]);const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>{if(String(url).endsWith("/buff/check"))throw new Error("fixture timeout");return original(url,init);});
    await tick();expect(link()).toMatchObject({status:"needs_admin",last_error:"buff_unavailable",attempt_count:0});
    purchase={success:true,batch_id:"BUFF_FIXTURE",currency:"usdt",sell_price_usdt:2,orders:[{invite_code:"Ab12Cd",quantity_b:1,order_code:"TELE_FIXTURE"}]};
    transport.mockImplementation(original);due();await tick();expect(link().status).toBe("processing");expect(buys()).toBe(1);
  });
});

describe("Buff accepted is not delivered",()=>{
  beforeEach(()=>{purchase={success:true,batch_id:"BUFF_FIXTURE",currency:"usdt",sell_price_usdt:2,orders:[{invite_code:"Ab12Cd",quantity_b:1,order_code:"TELE_FIXTURE"}]};});
  it.each([1,3])("uses live Buff cost %s for four units, then completes without rebuy",async current=>{
    seed([buff(4)]);price=current;purchase.sell_price_usdt=current*4;(purchase.orders as Row[])[0].quantity_b=4;
    await tick();expect(link()).toMatchObject({status:"processing",cost_usdt:8,last_error:null});
    expect(JSON.parse(String(link().receipt_json)).charged_usdt).toBe(current*4);
    status.is_done=true;Object.assign((status.orders as Row[])[0],{quantity_b:4,status:"done"});due();await tick();
    expect(link().status).toBe("completed");expect(buys()).toBe(1);
  });
  it("checks balance against current Buff cost, not the lower snapshot",async()=>{
    seed([buff(4)]);price=3;balance=10;await tick();
    expect(link()).toMatchObject({status:"needs_admin",last_error:"insufficient_balance",attempt_count:0,request_sent_at:null});expect(buys()).toBe(0);
  });
  it.each([0,-1,null,"invalid"])("rejects invalid Buff cost %s before sending",async invalid=>{
    seed([buff()]);const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>String(url).endsWith("/buff/check") ? response({success:true,fundable:true,sell_price_usdt:invalid,orders_breakdown:[{invite_code:"Ab12Cd",quantity_b:1,valid:true}]}) : original(url,init));
    await tick();expect(link()).toMatchObject({status:"needs_admin",last_error:"buff_unavailable",attempt_count:0,request_sent_at:null});expect(buys()).toBe(0);
  });
  it.each([200,202])("polls exact batch only after accepted %i and completes only done",async code=>{
    seed([buff()]);purchaseStatus=code;if(code===202)purchase={batch_id:"BUFF_FIXTURE"};
    await tick();expect(link().status).toBe("processing");due();await tick();expect(link().status).toBe("processing");
    status.is_done=true;(status.orders as Row[])[0].status="done";due();await tick();
    expect(link().status).toBe("completed");expect(buys()).toBe(1);
    expect(fixture.sql.prepare("SELECT delivered_ciphertext,last_error FROM fulfillment_items").get()).toMatchObject({delivered_ciphertext:null,last_error:"tunvn_buff_complete"});
    expect(transport.mock.calls.some(([url])=>String(url)==="https://supplier.test/api/buff/status?batch_id=BUFF_FIXTURE")).toBe(true);
  });
  it.each(["failed","needs_check","needs_check_alerted"])("moves %s to admin without repurchase",async state=>{
    seed([buff()]);await tick();(status.orders as Row[])[0].status=state;due();await tick();due();await tick();
    expect(link().status).toBe("needs_admin");expect(buys()).toBe(1);
  });
  it.each(["timeout","invalid_json",429,503])("keeps polling after status %s without replaying a purchase",async fault=>{
    seed([buff()]);await tick();const original=transport.getMockImplementation()!;
    transport.mockImplementation(async(url,init)=>{
      if(!String(url).includes("/buff/status"))return original(url,init);
      if(fault==="timeout")throw new Error("fixture timeout");
      if(fault==="invalid_json")return new Response("invalid");
      return response({},Number(fault));
    });
    due();await tick();expect(link()).toMatchObject({status:"processing",last_error:"buff_status_unavailable",attempt_count:1});
    transport.mockImplementation(original);status.is_done=true;(status.orders as Row[])[0].status="done";
    due();await tick();expect(link().status).toBe("completed");expect(buys()).toBe(1);
  });
  it.each(["batch_id","invite_code","quantity_b","order_code"])("rejects mismatched %s",async field=>{
    seed([buff()]);await tick();if(field==="batch_id")status.batch_id="OTHER";else(status.orders as Row[])[0][field]=field==="quantity_b"?2:"OTHER";
    due();await tick();expect(link().status).toBe("needs_admin");expect(buys()).toBe(1);
  });
  it("admin reconcile only polls a known saved batch; GET excludes secrets",async()=>{
    const {GET,POST}=await import("@/app/api/admin/tunvn/orders/route");
    seed([buff()]);await tick();(status.orders as Row[])[0].status="needs_check";due();await tick();
    (status.orders as Row[])[0].status="done";status.is_done=true;
    const result=await POST(new NextRequest("https://axvara.test/api/admin/tunvn/orders",{method:"POST",body:JSON.stringify({id:link().id,action:"reconcile"})}));
    expect(result.status).toBe(200);expect(link().status).toBe("completed");expect(buys()).toBe(1);
    const listing=await GET(new NextRequest("https://axvara.test/api/admin/tunvn/orders"));
    expect(JSON.stringify(await listing.json())).not.toMatch(/Ab12Cd|receipt_ciphertext|receipt_iv|fixture-only/);
  });
  it("requires admin, offers no blind purchase and reveals receipts only by POST",async()=>{
    const {GET,POST}=await import("@/app/api/admin/tunvn/orders/route");const {requireAdmin}=await import("@/lib/auth");
    seed();await tick();
    const call=(action:string)=>POST(new NextRequest("https://axvara.test/api/admin/tunvn/orders",{method:"POST",body:JSON.stringify({id:link().id,action})}));
    expect((await call("buy")).status).toBe(400);expect((await call("reconcile")).status).toBe(409);
    const revealed=await call("reveal");expect((await revealed.json()).receipt).toContain("BUFF_FIXTURE");
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);expect((await GET(new NextRequest("https://axvara.test/api/admin/tunvn/orders"))).status).toBe(401);
  });
  it("delivers account snapshots through existing private pipeline, readable only after delivered",async()=>{
    purchase={success:true,order:{order_group:"ORD_FIXTURE",quantity:1,total_items:1,total_price:2,currency:"usdt"},items:["buyer-account-secret"]};
    const order=seed();await tick();expect(await readDeliveredSnapshots(String(order.code),createDatabaseAccess(fixture.db))).toEqual([]);
    const item=fixture.sql.prepare("SELECT * FROM fulfillment_items").get()!;
    expect(await processItem(order,item)).toBe(true);
    expect((await readDeliveredSnapshots(String(order.code),createDatabaseAccess(fixture.db)))[0].details).toBe("buyer-account-secret");
    expect(buys()).toBe(1);
  });
  it("keeps PIN/c1 verification authoritative for automatically purchased credentials",async()=>{
    vi.stubEnv("ADMIN_JWT_SECRET","fixture-admin-key");vi.stubEnv("BUYER_ORDER_ACCESS_SECRET","fixture-buyer-key");
    purchase={success:true,order:{order_group:"ORD_FIXTURE",quantity:1,total_items:1,total_price:2,currency:"usdt"},items:["private-credential"]};
    const order=seed();fixture.sql.exec("UPDATE orders SET buyer_access_version=1,buyer_access_format='pin6',quote_id='fixture-checkout'");
    await tick();await processItem(order,fixture.sql.prepare("SELECT * FROM fulfillment_items").get()!);
    const {POST}=await import("@/app/api/orders/[code]/credentials/route");
    const {createCheckoutCredentialGrant}=await import("@/lib/order-access");
    const saved=fixture.sql.prepare("SELECT * FROM orders").get()!;
    const call=(grant="")=>POST(new NextRequest(`https://axvara.test/api/orders/${order.code}/credentials`,{method:"POST",headers:{"content-type":"application/json","x-checkout-credential-grant":grant},body:"{}"}),{params:Promise.resolve({code:String(order.code)})});
    expect((await call()).status).toBe(404);
    const result=await call((await createCheckoutCredentialGrant(saved))!);expect(result.status).toBe(200);
    expect((await result.json()).credentials[0].details).toBe("private-credential");
  });
  it("retries only the noncredential notice after Buff completion, never the purchase",async()=>{
    const order=seed([buff()]);await tick();status.is_done=true;(status.orders as Row[])[0].status="done";due();await tick();
    const {notifyBuyerBuffCompleted}=await import("@/lib/notify-buyer");vi.mocked(notifyBuyerBuffCompleted).mockResolvedValueOnce(false);
    let item=fixture.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(await processItem(order,item)).toBe(false);
    item=fixture.sql.prepare("SELECT * FROM fulfillment_items").get()!;expect(item.last_error).toBe("supplier_delivery_deferred");
    expect(await processItem(order,item)).toBe(true);expect(buys()).toBe(1);expect(item.delivered_ciphertext).toBeNull();
  });
});
