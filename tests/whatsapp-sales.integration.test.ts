import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { SALES_CONFIG_KEY } from "@/lib/whatsapp/sales-notifications";
import { processWhatsAppOutboxRow, recoverStaleWhatsAppLeases } from "@/lib/whatsapp/outbox";
import { summarizeWebDelivery, notifyWebPaidAdmin } from "@/lib/telegram/order-notifications";
vi.mock("@/lib/whatsapp/gateway", async original => ({ ...await original<object>(), sendTextMessage: vi.fn(), salesGatewayControl: vi.fn() }));
vi.mock("@/lib/telegram/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/telegram/api")>(),
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));
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
function legacySale(status = "pending", key = CODE) {
  fixture.sql.prepare("INSERT INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status) VALUES(?,'whatsapp',?,'sale_completed','legacy sale',?)").run(`wa:sale-completed:${key}`, GROUP, status);
}
describe("retired completed purchase notifications", () => {
  it.each(["wa:payment_detected:legacy", "wa:qris-expired:legacy", "wa:text:wr-delivery:legacy", "wr-email:legacy"])(
    "quarantines historical sales text %s before calling the gateway", async key => {
      fixture.sql.prepare("INSERT INTO whatsapp_outbox(idempotency_key,destination,message_type,payload) VALUES(?,?,'text','sales fixture')").run(key, GROUP);
      const { sendTextMessage } = await import("@/lib/whatsapp/gateway");
      expect(await processWhatsAppOutboxRow(fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!)).toBe(true);
      expect(sendTextMessage).not.toHaveBeenCalled();
      expect(fixture.sql.prepare("SELECT status,last_error FROM whatsapp_outbox").get()).toEqual({status:"dead",last_error:"sales_notifications_retired"});
    },
  );
  it("never sends an existing purchase notification even when the group is enabled", async () => {
    legacySale();
    await processWhatsAppOutboxRow(fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!);
    expect(fixture.sql.prepare("SELECT status,last_error FROM whatsapp_outbox").get()).toEqual({status:"dead",last_error:"sales_notifications_retired"});
    const {sendTextMessage}=await import("@/lib/whatsapp/gateway");
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
  it("retires pending/failed purchases without touching sent, unknown/dead or active leases", async () => {
    for (const status of ["pending","failed","sent","dead","sending"]) legacySale(status,status);
    fixture.sql.exec("UPDATE whatsapp_outbox SET locked_until=datetime('now','+5 minutes') WHERE status='sending'");
    expect(await recoverStaleWhatsAppLeases()).toBe(2);
    const rows=fixture.sql.prepare("SELECT status FROM whatsapp_outbox ORDER BY id").all();
    expect(rows.map(r=>r.status)).toEqual(["dead","dead","sent","dead","sending"]);
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
  it("activates only the verified bot and canonical group with a typographic subject and preserves its first activation cutoff",async()=>{
    fixture.sql.prepare("DELETE FROM store_settings WHERE key=?").run(SALES_CONFIG_KEY);
    const {POST}=await import("@/app/api/admin/whatsapp-notifications/route");const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    const enable=(c="")=>POST(new NextRequest("http://localhost/api/admin/whatsapp-notifications",{method:"POST",headers:{cookie:c},body:JSON.stringify({action:"enable"})}));
    expect((await enable()).status).toBe(401);const c=await cookie();
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:"628111111111",groupName:"AXVARA'S",groupId:GROUP});expect((await enable(c)).status).toBe(409);
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:"6283181632507",groupName:"OTHER",groupId:GROUP});expect((await enable(c)).status).toBe(409);
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:"6283181632507",groupName:"AXVARA'S",groupSubject:"AXVARA’S",groupId:GROUP});
    const first=await enable(c);expect(first.status).toBe(200);const cutoff=(await first.json()).config.enabledAt;
    expect((await (await enable(c)).json()).config.enabledAt).toBe(cutoff);
  });
});


describe("manual bot-number replacement",()=>{
  const NEXT="628123456789",REV="11111111-2222-4333-8444-555555555555";
  const post=async(action:string,extra:Record<string,unknown>={},c="")=>{
    const {POST}=await import("@/app/api/admin/whatsapp-notifications/route");
    return POST(new NextRequest("http://localhost/api/admin/whatsapp-notifications",{method:"POST",headers:{cookie:c},body:JSON.stringify({action,...extra})}));
  };
  it("requires admin, validates numbers and rejects stale tabs before pausing",async()=>{
    const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    expect((await post("number",{newBotNumber:NEXT})).status).toBe(401);
    const c=await cookie();
    for(const value of ["invalid","123",null,"9".repeat(16)])expect((await post("number",{newBotNumber:value},c)).status).toBe(400);
    expect(salesGatewayControl).not.toHaveBeenCalled();
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:NEXT,botRevision:REV});
    expect((await post("number",{newBotNumber:NEXT},c)).status).toBe(409);
    expect(JSON.parse(String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(SALES_CONFIG_KEY)?.value)).enabled).toBe(true);
  });
  it("pauses before replacing the session, normalizes 08 and preserves existing deliveries",async()=>{
    const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    legacySale("sent");fixture.sql.exec("UPDATE whatsapp_outbox SET provider_message_id='KEEP'");
    vi.mocked(salesGatewayControl).mockImplementation(async(action,identity)=>{
      if(action==='number'){
        const paused=JSON.parse(String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(SALES_CONFIG_KEY)?.value));
        expect(paused.enabled).toBe(false);expect(identity).toEqual({botNumber:"6283181632507",botRevision:"initial",newBotNumber:NEXT});
        return {connected:false,botNumber:NEXT,botRevision:REV};
      }
      return {connected:true,botNumber:"6283181632507",botRevision:"initial",groupId:GROUP,groupName:"AXVARA'S"};
    });
    const result=await post("number",{newBotNumber:"08123456789"},await cookie());
    expect(result.status).toBe(200);expect((await result.json()).gateway.botNumber).toBe(NEXT);
    expect(fixture.sql.prepare("SELECT status,provider_message_id FROM whatsapp_outbox").get()).toEqual({status:'sent',provider_message_id:'KEEP'});
  });
  it("keeps notifications disabled when gateway replacement fails",async()=>{
    const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    vi.mocked(salesGatewayControl).mockResolvedValueOnce({connected:true,botNumber:"6283181632507",botRevision:"initial"}).mockRejectedValueOnce(new Error('timeout'));
    expect((await post('number',{newBotNumber:NEXT},await cookie())).status).toBe(503);
    expect(JSON.parse(String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(SALES_CONFIG_KEY)?.value)).enabled).toBe(false);
  });
  it("activates a configured replacement and binds outbox sends to its new revision",async()=>{
    const {salesGatewayControl,sendTextMessage}=await import("@/lib/whatsapp/gateway");
    vi.mocked(salesGatewayControl).mockResolvedValue({connected:true,botNumber:NEXT,botRevision:REV,groupId:GROUP,groupName:"AXVARA'S"});
    const c=await cookie();expect((await post('enable',{},c)).status).toBe(409);
    const response=await post('enable',{botNumber:NEXT,botRevision:REV},c);expect(response.status).toBe(200);
    const {config}=await response.json();expect(config).toMatchObject({botNumber:NEXT,botRevision:REV,enabled:true});expect(config.enabledAt).not.toBe('2026-10-24T00:00:00Z');
    fixture.sql.prepare("INSERT INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status) VALUES('wa:promo:2099-11-11:morning','whatsapp',?,'promo_digest',?,'pending')").run(GROUP,JSON.stringify({message:"ready",botNumber:NEXT,botRevision:REV,expiresAt:"2099-11-11T12:00:00+07:00"}));
    vi.mocked(sendTextMessage).mockResolvedValue({ok:false,error:'bot_configuration_changed'});
    await processWhatsAppOutboxRow(fixture.sql.prepare("SELECT * FROM whatsapp_outbox").get()!);
    expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({botNumber:NEXT,botRevision:REV}));
    expect(fixture.sql.prepare("SELECT attempt_count,status FROM whatsapp_outbox").get()).toEqual({attempt_count:0,status:'failed'});
  });
  it("does not overwrite a pause that races an activation",async()=>{
    const {salesGatewayControl}=await import("@/lib/whatsapp/gateway");
    vi.mocked(salesGatewayControl).mockImplementation(async()=>{
      fixture.sql.prepare("UPDATE store_settings SET value=? WHERE key=?").run(JSON.stringify({enabled:false,enabledAt:"2026-10-24T00:00:00Z",groupId:GROUP}),SALES_CONFIG_KEY);
      return {connected:true,botNumber:"6283181632507",botRevision:"initial",groupId:GROUP,groupName:"AXVARA'S"};
    });
    expect((await post('enable',{},await cookie())).status).toBe(409);
    expect(JSON.parse(String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(SALES_CONFIG_KEY)?.value)).enabled).toBe(false);
  });
});
