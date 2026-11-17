import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueWhatsAppPromoBot, parsePromoBotConfig, PROMO_BOT_CONFIG_KEY } from "@/lib/whatsapp/promo-bot";
import { enqueueWhatsAppPromo } from "@/lib/whatsapp/promo-digest";
import { processWhatsAppOutboxRow } from "@/lib/whatsapp/outbox";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { GET, POST } from "@/app/api/admin/whatsapp-promo-bot/route";
import { WA_GROUP_HREF } from "@/lib/site";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn(), gatewayConfig: () => ({ url: "https://gateway.test", token: "fixture" }), salesGatewayControl: vi.fn(async () => ({ botNumber: "6283181632507" })) }));
const config = { enabled: true, botNumber: "628123456789", botRevision: "initial", groups: [{ id: "123@g.us", subject: "One" }, { id: "123-456@g.us", subject: "Two" }] };
let fixture: ReturnType<typeof createD1Fixture>;
let connected = true, blocked = false;
let groups = config.groups.map(g => ({ ...g, size: 10, canSend: true }));
const row = () => fixture.sql.prepare("SELECT * FROM whatsapp_outbox ORDER BY id LIMIT 1").get()!;
const stored = () => JSON.parse(String(fixture.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(PROMO_BOT_CONFIG_KEY)?.value));
const setConfig = (patch: Partial<typeof config>) => fixture.sql.prepare("UPDATE store_settings SET value=? WHERE key=?").run(JSON.stringify({ ...config, ...patch }), PROMO_BOT_CONFIG_KEY);
const post = (action: string, extra = {}) => POST(new NextRequest("http://localhost/api/admin/whatsapp-promo-bot", { method: "POST", body: JSON.stringify({ action, botNumber: config.botNumber, botRevision: config.botRevision, ...extra }) }));
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-17T02:00:00Z"));
  fixture = createD1Fixture(); connected = true; blocked = false; groups = config.groups.map(g => ({ ...g, size: 10, canSend: true }));
  fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,?)").run(PROMO_BOT_CONFIG_KEY, JSON.stringify(config));
  fixture.sql.exec(`INSERT INTO products(id,slug,name,price) VALUES (1,'a','One',100),(2,'b','Two',200),(3,'c','Three',300);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES (1,1,'a','A',100,-1),(2,2,'b','B',200,-1),(3,3,'c','C',300,-1);`);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/groups")) return Response.json({ groups });
    if (url.endsWith("/number")) return Response.json({ configured: true, connected: false, blocked, botNumber: "628222222222", botRevision: "11111111-2222-4333-8444-555555555555" });
    return Response.json({ configured: true, connected, blocked, botNumber: config.botNumber, botRevision: config.botRevision, ...(url.endsWith("/pair") ? { pairingCode: "12345678" } : {}) });
  }));
});
afterEach(() => { fixture.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("strictly parses configuration and fails closed", () => {
  expect(parsePromoBotConfig(JSON.stringify(config))).toEqual(config);
  for (const patch of [{ enabled: "true" }, { botNumber: null }, { botNumber: "08123456789" }, { botRevision: "bad" }, { groups: [{ id: "1@s.whatsapp.net", subject: "x" }] }, { groups: [config.groups[0], config.groups[0]] }, { groups: Array.from({ length: 21 }, (_, i) => ({ id: `${i}@g.us`, subject: "x" })) }]) expect(parsePromoBotConfig(JSON.stringify({ ...config, ...patch }))).toBeNull();
  expect(parsePromoBotConfig("{" )).toBeNull();
});
it("queues every selected group idempotently using five statements and current join link, not the AXVARA'S caption", async () => {
  const db = createDatabaseAccess(); const before = fixture.control.queries;
  expect(await enqueueWhatsAppPromoBot(db)).toBe(2); expect(fixture.control.queries - before).toBe(5);
  expect(row()).toMatchObject({ message_type: "promo_bot_digest", idempotency_key: "wa:promo2:2026-11-17:morning:123" });
  expect(JSON.parse(String(row().payload)).message).toContain(`\n\nJoin Grup WA: ${WA_GROUP_HREF}`);
  expect(await enqueueWhatsAppPromoBot(db)).toBe(0);
  fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('whatsapp_group_url',?)").run("https://chat.whatsapp.com/newlink");
  vi.setSystemTime(new Date("2026-11-17T10:00:00Z")); expect(await enqueueWhatsAppPromoBot(db)).toBe(2);
  expect(String(fixture.sql.prepare("SELECT payload FROM whatsapp_outbox ORDER BY id DESC LIMIT 1").get()?.payload)).toContain("newlink");
  fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('whatsapp_sales_notifications',?)").run(JSON.stringify({ enabled: true, enabledAt: new Date().toISOString(), groupId: "999@g.us", botNumber: "6283181632507", botRevision: "initial" }));
  expect(await enqueueWhatsAppPromo(db)).toBe(1);
  expect(String(fixture.sql.prepare("SELECT payload FROM whatsapp_outbox WHERE message_type='promo_digest'").get()?.payload)).not.toContain("Join Grup WA");
});
it("skips disabled, insufficient budget/products and outside windows", async () => {
  const db = createDatabaseAccess(); setConfig({ enabled: false }); expect(await enqueueWhatsAppPromoBot(db)).toBe(0);
  setConfig({}); expect(await enqueueWhatsAppPromoBot({ ...db, canSpend: () => false })).toBe(0);
  vi.setSystemTime(new Date("2026-11-17T05:00:00Z")); expect(await enqueueWhatsAppPromoBot(db)).toBe(0);
  vi.setSystemTime(new Date("2026-11-17T02:00:00Z")); fixture.sql.exec("UPDATE products SET is_active=0 WHERE id=3"); expect(await enqueueWhatsAppPromoBot(db)).toBe(0);
});
it.each([{ enabled: false }, { groups: [] }, { botRevision: "11111111-2222-4333-8444-555555555555" }])("rechecks disabled/changed config %j", async patch => {
  await enqueueWhatsAppPromoBot(createDatabaseAccess()); setConfig(patch);
  expect(await processWhatsAppOutboxRow(row())).toBe(false); expect(row()).toMatchObject({ status: "failed", attempt_count: 0, last_error: "promo_bot_disabled_or_changed" }); expect(sendTextMessage).not.toHaveBeenCalled();
});
it.each(["notification_paced", "whatsapp_not_connected"])("durably retries %s then dispatches via second bot", async error => {
  await enqueueWhatsAppPromoBot(createDatabaseAccess()); vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: false, error });
  await processWhatsAppOutboxRow(row()); expect(row()).toMatchObject({ status: "failed", attempt_count: 0 });
  vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: true, messageId: "sent" }); await processWhatsAppOutboxRow(row()); expect(row().status).toBe("sent");
  expect(sendTextMessage).toHaveBeenLastCalledWith(expect.objectContaining({ promoBotNotification: true, botNumber: config.botNumber, target: "123@g.us" }));
});
it.each(["promo_group_not_allowed", "promo_expired", "delivery_outcome_unknown"])("quarantines %s without retry", async error => {
  await enqueueWhatsAppPromoBot(createDatabaseAccess()); vi.mocked(sendTextMessage).mockResolvedValue({ ok: false, error, outcomeUnknown: error === "delivery_outcome_unknown" });
  await processWhatsAppOutboxRow(row()); expect(row()).toMatchObject({ status: "dead", last_error: error === "delivery_outcome_unknown" ? "delivery_outcome_unknown:manual_check_required" : error });
});
it("expires old promos and rejects malformed payloads", async () => {
  await enqueueWhatsAppPromoBot(createDatabaseAccess()); vi.setSystemTime(new Date("2026-11-17T05:00:00Z")); await processWhatsAppOutboxRow(row()); expect(row().last_error).toBe("promo_expired");
  fixture.sql.exec("UPDATE whatsapp_outbox SET status='pending',payload='{}'"); await processWhatsAppOutboxRow(row()); expect(row().last_error).toBe("invalid_promo_payload"); expect(sendTextMessage).not.toHaveBeenCalled();
});
it("loads status/groups with no-store and pairs only the current identity", async () => {
  const response = await GET(new NextRequest("http://localhost/api/admin/whatsapp-promo-bot?groups=1")); expect(response.headers.get("cache-control")).toContain("no-store"); expect((await response.json()).groups).toHaveLength(2);
  expect((await (await post("pair")).json()).gateway.pairingCode).toBe("12345678"); expect((await post("pair", { botRevision: "stale" })).status).toBe(409);
});
it("validates fresh writable groups and pauses on save", async () => {
  expect((await post("save_groups", { groupIds: ["123@g.us"] })).status).toBe(200); expect(stored()).toMatchObject({ enabled: false, groups: [config.groups[0]] });
  expect((await post("save_groups", { groupIds: ["999@g.us"] })).status).toBe(409);
  groups[0].canSend = false; expect((await post("save_groups", { groupIds: ["123@g.us"] })).status).toBe(409);
  expect((await post("save_groups", { groupIds: ["bad"] })).status).toBe(400);
  expect((await post("save_groups", { groupIds: ["123@g.us", "123@g.us"] })).status).toBe(400);
});
it("gates enable on connected, unblocked, selected groups and matching identity", async () => {
  expect((await post("enable")).status).toBe(200);
  connected = false; expect((await post("enable")).status).toBe(409); connected = true;
  blocked = true; expect((await post("enable")).status).toBe(409); blocked = false;
  setConfig({ groups: [] }); expect((await post("enable")).status).toBe(409);
  setConfig({ botNumber: "628999999999" }); expect((await post("enable")).status).toBe(409);
  expect((await post("disable")).status).toBe(200); expect(stored().enabled).toBe(false);
});
it("rejects invalid/main numbers and stores the replacement identity disabled", async () => {
  expect((await post("number", { newBotNumber: "x" })).status).toBe(400);
  expect((await post("number", { newBotNumber: "6283181632507" })).status).toBe(409);
  expect((await post("number", { newBotNumber: "08222222222" })).status).toBe(200); expect(stored()).toMatchObject({ enabled: false, botNumber: "628222222222", groups: [] });
});
it("CAS refuses a concurrent settings write", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => { if (String(args[0]).endsWith("/status")) setConfig({ enabled: false }); return original(...args); }));
  expect((await post("enable")).status).toBe(409); expect(stored().enabled).toBe(false);
});
it("number control pauses durably before an ambiguous gateway failure", async () => {
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).endsWith("/number")) { expect(stored().enabled).toBe(false); throw new Error("timeout"); }
    return original(...args);
  }));
  expect((await post("number", { newBotNumber: "628222222222" })).status).toBe(503);
  expect(stored()).toMatchObject({ enabled: false, groups: [] });
});
it("authenticates both routes before gateway or database work", async () => {
  const { requireAdmin } = await import("@/lib/auth");
  vi.mocked(requireAdmin).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
  expect((await GET(new NextRequest("http://localhost/api/admin/whatsapp-promo-bot"))).status).toBe(401);
  expect((await post("enable")).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
});
it("real send adapter selects promo-bot endpoint without changing main endpoint", async () => {
  vi.stubEnv("WHATSAPP_GATEWAY_URL", "https://fixture.test"); vi.stubEnv("WHATSAPP_WEBHOOK_TOKEN", "fixture");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, id: "ok" })));
  const actual = await vi.importActual<typeof import("@/lib/whatsapp/gateway")>("@/lib/whatsapp/gateway");
  await actual.sendTextMessage({ target: "123@g.us", message: "catalog", promoBotNotification: true, botNumber: config.botNumber, botRevision: "initial" });
  expect(fetch).toHaveBeenCalledWith("https://fixture.test/promo-bot/send-promo", expect.objectContaining({ headers: expect.objectContaining({ "x-gateway-token": "fixture" }) }));
  vi.unstubAllEnvs();
});
