import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueCompletedSales, salesNotificationMessage, SALES_CONFIG_KEY } from "@/lib/whatsapp/sales-notifications";
import { processWhatsAppOutboxRow } from "@/lib/whatsapp/outbox";
import { summarizeWebDelivery, notifyWebPaidAdmin } from "@/lib/telegram/order-notifications";
vi.mock("@/lib/whatsapp/gateway", async original => ({ ...await original<object>(), sendTextMessage: vi.fn(), salesGatewayControl: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));
const CODE = "AXV-20261024-1234ABCD";
const GROUP = "120363123456789012@g.us";
let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture(); stubFulfillmentKey();
  await insertTestProduct(fixture.sql, "manual");
  fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,?)").run(SALES_CONFIG_KEY, JSON.stringify({ enabled:true, enabledAt:"2026-10-24T00:00:00Z", groupId:GROUP }));
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech"); vi.stubEnv("ADMIN_PASSWORD_SHA256", "c".repeat(64)); vi.stubEnv("ADMIN_JWT_SECRET", "test-notifications-secret-1234567890");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true"); vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture"); vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1001");
  vi.clearAllMocks();
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); });
function order(items?: Record<string,unknown>[]) {
  insertTestOrder(fixture.sql, CODE, { status:"lunas", channel:"web", items });
  fixture.sql.prepare("UPDATE orders SET customer_name='Rani Putri',customer_email='buyer@test.example',paid_at='2026-10-24 00:01:00' WHERE code=?").run(CODE);
}
function item(index=0,status="delivered") {
  fixture.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,status,updated_at) VALUES(?,?,1,1,?,'2026-10-24 00:37:00')").run(CODE,index,status);
}
async function cookie() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(await createIdleToken(sid))}`;
}
describe("completed purchase notifications", () => {
  it("queues once after every unique unit is delivered; stores completion time and hides private data", async () => {
    order([{name:"Gemini Pro",product_id:1,variant_id:1,qty:2,price:10000,fulfillment_mode:"unique",unique_units:true}]); item();
    expect(await enqueueCompletedSales()).toBe(0);
    item(1,"retry"); expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE fulfillment_items SET status='delivered'");
    const both = await Promise.all([enqueueCompletedSales(),enqueueCompletedSales()]); expect(both.reduce((a,b)=>a+b)).toBe(1);
    const queued=fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!;
    expect(queued.destination).toBe(GROUP); expect(queued.message_type).toBe("sale_completed");
    expect(queued.payload).toContain("PESANAN BERHASIL DIPROSES - WEB"); expect(queued.payload).toContain("07.37 WIB"); expect(queued.payload).toContain("R***");
    for (const value of [CODE,"Rani Putri","buyer@test.example","628000000000"]) expect(queued.payload).not.toContain(value);
    fixture.sql.exec("UPDATE fulfillment_items SET updated_at='2026-10-24 01:00:00'");
    expect(await enqueueCompletedSales()).toBe(0); expect(fixture.sql.prepare("SELECT payload FROM whatsapp_outbox").get()?.payload).toBe(queued.payload);
  });
  it("does not publish unpaid, failed, disabled or historical orders",async()=>{
    order(); item();
    fixture.sql.exec("UPDATE orders SET payment_status='pending'"); expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE orders SET payment_status='paid',paid_at='2026-10-23 23:59:59'"); expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE orders SET paid_at='2026-10-24 00:01:00'; UPDATE fulfillment_items SET status='failed'"); expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE fulfillment_items SET status='delivered'; DELETE FROM store_settings WHERE key='whatsapp_sales_notifications'"); expect(await enqueueCompletedSales()).toBe(0);
  });
  it("publishes Pedia only at completed, without exposing its target or supplier details",async()=>{
    order([{name:"Followers Instagram",qty:100,price:10}]);
    fixture.sql.exec(`UPDATE orders SET order_kind='pedia';
      INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name) VALUES(1,'followers-ig','instagram','followers','profile','Followers');
      INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp) VALUES(1,1,'standar','indosmm',1,'G3',0,1000);
      INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,completed_at)
      VALUES('${CODE}',1,1,'{}','https://instagram.com/private-target','https://instagram.com/private-target',100,10,1000,'indosmm',1,1000,'partial','2026-10-24 00:45:00');`);
    expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE pedia_order_items SET status='canceled'");expect(await enqueueCompletedSales()).toBe(0);
    fixture.sql.exec("UPDATE pedia_order_items SET status='completed'");expect(await enqueueCompletedSales()).toBe(1);
    const payload=String(fixture.sql.prepare("SELECT payload FROM whatsapp_outbox").get()?.payload);
    expect(payload).toContain("07.45 WIB");expect(payload).not.toContain("private-target");expect(payload).not.toContain("indosmm");
  });
  it("labels each channel without leaking fields outside the catalog whitelist",()=>{
    for (const [sales_channel, label] of [["web","WEB"],["telegram","TELEGRAM"],["whatsapp","WHATSAPP"]]) {
      const text=salesNotificationMessage({sales_channel,items:JSON.stringify([{name:"Canva",qty:1,price:10000,target:"SECRET",email:"SECRET",credentials:"SECRET"}]),customer_email:"SECRET",telegram_user_id:"SECRET",code:CODE,subtotal:10000},"2026-10-24 00:37:00","TRX-PUBLIC");
      expect(text).toContain(`DIPROSES - ${label}`); expect(text).not.toContain("SECRET"); expect(text).not.toContain(CODE);
    }
  });
  it("passes a stable gateway key, defers offline sends without exhausting attempts, quarantines explicit unknown",async()=>{
    order();item();await enqueueCompletedSales();
    const {sendTextMessage}=await import("@/lib/whatsapp/gateway");
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ok:false,error:"whatsapp_not_connected"});
    const row=fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!;
    await processWhatsAppOutboxRow(row);
    expect(fixture.sql.prepare("SELECT attempt_count FROM whatsapp_outbox").get()?.attempt_count).toBe(0);
    expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({idempotencyKey:`wa:sale-completed:${CODE}`,salesNotification:true,target:GROUP}));
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ok:false,error:"delivery_outcome_unknown",outcomeUnknown:true});
    await processWhatsAppOutboxRow(fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!);
    expect(fixture.sql.prepare("SELECT status,last_error FROM whatsapp_outbox").get()).toMatchObject({status:"dead",last_error:"delivery_outcome_unknown:manual_check_required"});
  });
});
describe("admin classification and safe tracking access",()=>{
  it("supplier manual_required without link is automatic; delivered WR is complete, auto failures need inspection",()=>{
    expect(summarizeWebDelivery([{status:"manual_required",supplier_source:"sk"}])).toMatchObject({needsAdmin:false,orderStatus:"DIPROSES OTOMATIS"});
    expect(summarizeWebDelivery([{status:"delivered",wr_link_id:7}])).toMatchObject({needsAdmin:false,orderStatus:"SELESAI"});
    expect(summarizeWebDelivery([{status:"failed",supplier_source:"wr"}])).toMatchObject({needsAdmin:false,orderStatus:"PERLU PEMERIKSAAN ADMIN"});
    expect(summarizeWebDelivery([{status:"manual_required",fulfillment_mode:"manual"}])).toMatchObject({needsAdmin:true});
  });
  it("uses a stored supplier snapshot before a link exists and includes paid time",async()=>{
    order();item(0,"manual_required");
    fixture.sql.prepare("INSERT INTO order_item_costs(order_code,item_index,product_id,variant_id,source) VALUES(?,0,1,1,'sk')").run(CODE);
    await notifyWebPaidAdmin(CODE);
    const {sendMessage}=await import("@/lib/telegram/api");
    const call=vi.mocked(sendMessage).mock.calls[0][0];
    expect(call.text).not.toContain("perlu dikirim admin"); expect(call.text).toContain("DIPROSES OTOMATIS"); expect(call.text).toContain("07.01 WIB");
    const urls=JSON.stringify(call.reply_markup); expect(urls).toContain("admin=1"); expect(urls).not.toContain("buyer@test.example");
  });
  it("requires an existing admin session for lookup and credentials, and denies a revoked session",async()=>{
    order();item();
    const {POST}=await import("@/app/api/orders/lookup/route");
    const lookup=(c="")=>POST(new NextRequest("http://localhost/api/orders/lookup",{method:"POST",headers:{cookie:c,"content-type":"application/json"},body:JSON.stringify({code:CODE,adminView:true})}));
    expect((await lookup()).status).toBe(401);
    const c=await cookie();const response=await lookup(c);expect(response.status).toBe(200);expect((await response.json()).order.code).toBe(CODE);
    const {POST:credentials}=await import("@/app/api/orders/[code]/credentials/route");
    const r=await credentials(new NextRequest(`http://localhost/api/orders/${CODE}/credentials`,{method:"POST",body:JSON.stringify({adminView:true})}),{params:Promise.resolve({code:CODE})});expect(r.status).toBe(401);
    const {bumpAuthVersion,verifyAdminToken}=await import("@/lib/auth");
    const payload=await verifyAdminToken(decodeURIComponent(c.split(';')[0].split('=')[1]));
    await bumpAuthVersion(payload!.sid);expect((await lookup(c)).status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("opens delivered credentials for an admin without issuing a buyer capability",async()=>{
    order();item();
    const {encryptSecret}=await import("@/lib/fulfillment/crypto");const encrypted=await encryptSecret("Email: fixture@example.test");
    fixture.sql.prepare("UPDATE fulfillment_items SET delivered_ciphertext=?,delivered_iv=?").run(encrypted.ciphertext,encrypted.iv);
    const {POST}=await import("@/app/api/orders/[code]/credentials/route");
    const response=await POST(new NextRequest(`http://localhost/api/orders/${CODE}/credentials`,{method:"POST",headers:{cookie:await cookie()},body:JSON.stringify({adminView:true})}),{params:Promise.resolve({code:CODE})});
    expect(response.status).toBe(200);const body=await response.json();expect(JSON.stringify(body.credentials)).toContain("fixture@example.test");expect(body.capability_token).toBeUndefined();
  });
});
describe("central group link and notification controls",()=>{
  it("stores one validated invitation URL behind admin auth; public settings expose the link without gateway configuration",async()=>{
    const {PUT,GET}=await import("@/app/api/store-settings/route");
    const {DEFAULT_STORE_SETTINGS}=await import("@/lib/site");const invitation="https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV";
    const put=(link:string,c="")=>PUT(new NextRequest("http://localhost/api/store-settings",{method:"PUT",headers:{cookie:c},body:JSON.stringify({...DEFAULT_STORE_SETTINGS,whatsappGroupUrl:link})}));
    expect((await put(invitation)).status).toBe(401);const c=await cookie();
    for(const bad of ["javascript:alert(1)","https://chat.whatsapp.com.evil.test/ABCDEFGHIJKLMNOPQRSTUV","https://user@chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV","https://example.test/"]) expect((await put(bad,c)).status).toBe(400);
    expect((await put(invitation,c)).status).toBe(200);
    const response=await GET();const body=await response.json();expect(body.settings.whatsappGroupUrl).toBe(invitation);
    expect(JSON.stringify(body)).not.toContain(GROUP);expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fixture.sql.prepare("SELECT value FROM store_settings WHERE key='whatsapp_group_url'").get()?.value).toBe(invitation);
  });
  it("activates only the verified bot and exact group and preserves its first activation cutoff",async()=>{
    fixture.sql.prepare("DELETE FROM store_settings WHERE key=?").run(SALES_CONFIG_KEY);
    const {POST}=await import("@/app/api/admin/whatsapp-notifications/route");const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    const enable=(c="")=>POST(new NextRequest("http://localhost/api/admin/whatsapp-notifications",{method:"POST",headers:{cookie:c},body:JSON.stringify({action:"enable"})}));
    expect((await enable()).status).toBe(401);const c=await cookie();
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:"628111111111",groupName:"AXVARA'S",groupId:GROUP});expect((await enable(c)).status).toBe(409);
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:"6283181632507",groupName:"AXVARA'S",groupId:GROUP});
    const first=await enable(c);expect(first.status).toBe(200);const cutoff=(await first.json()).config.enabledAt;
    expect((await (await enable(c)).json()).config.enabledAt).toBe(cutoff);
  });
});
