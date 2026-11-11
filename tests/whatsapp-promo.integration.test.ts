import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueWhatsAppPromo } from "@/lib/whatsapp/promo-digest";
import { processWhatsAppOutboxRow } from "@/lib/whatsapp/outbox";
import { SALES_CONFIG_KEY } from "@/lib/whatsapp/sales-notifications";
import { sendTextMessage } from "@/lib/whatsapp/gateway";

vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn() }));
const GROUP = "120363123456789012@g.us";
const config = { enabled: true, enabledAt: "2026-11-01T00:00:00Z", groupId: GROUP, botNumber: "6283181632507", botRevision: "initial" };
let fixture: ReturnType<typeof createD1Fixture>;
const row = () => fixture.sql.prepare("SELECT * FROM whatsapp_outbox ORDER BY id DESC LIMIT 1").get()!;
const setConfig = (patch: Partial<typeof config>) => fixture.sql.prepare("UPDATE store_settings SET value=? WHERE key=?").run(JSON.stringify({ ...config, ...patch }), SALES_CONFIG_KEY);

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T02:00:00Z"));
  vi.stubEnv("PEDIA_PROMO_DIGEST_ENABLED", "false");
  fixture = createD1Fixture();
  fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES(?,?)").run(SALES_CONFIG_KEY, JSON.stringify(config));
  fixture.sql.exec(`INSERT INTO products(id,slug,name,price,category_id,sort_order) VALUES
    (1,'canva','Canva Pro / Premium',2000,1,1),(2,'claude','Claude Pro',195000,2,2),(3,'netflix','Netflix',18500,3,3),
    (4,'empty','Sold out',10,1,4),(5,'hidden','Hidden',1,1,5),(6,'loser','Supplier loser',1,1,6),(7,'inactive','Inactive',1,1,7);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty) VALUES
    (1,1,'SKU1','Ready',2000,1,1),(2,1,'SKU2','Cheap but empty',100,0,1),(3,2,'SKU3','Ready',195000,-1,1),
    (4,3,'SKU4','Ready',18500,5,5),(5,4,'SKU5','Below minimum',10,1,2),(6,5,'SKU6','Hidden',1,-1,1),
    (7,6,'SKU7','Loser',1,-1,1),(8,7,'SKU8','Inactive',1,-1,1);
    UPDATE products SET telegram_enabled=0 WHERE id=5;
    UPDATE products SET is_active=0 WHERE id=7;
    INSERT INTO supplier_pairs(wr_product_id,sk_product_id,winner) VALUES(1,6,'WR');`);
});
afterEach(() => { fixture.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("WhatsApp ready catalog", () => {
  it("queues one immutable snapshot per WIB date/slot even under concurrent ticks", async () => {
    const db = createDatabaseAccess();
    expect((await Promise.all([enqueueWhatsAppPromo(db), enqueueWhatsAppPromo(db)])).reduce((a,b)=>a+b)).toBe(1);
    const first = row();
    expect(first).toMatchObject({ destination: GROUP, message_type: "promo_digest", idempotency_key: "wa:promo:2026-11-11:morning" });
    const payload = JSON.parse(String(first.payload));
    expect(payload.message).toContain("🔥 *PRODUK AXVARA READY PAGI INI*");
    expect(payload.message).toContain("✅ Canva Pro / Premium — Rp2.000");
    expect(payload.message).toContain("✅ Claude Pro — Rp195.000");
    expect(payload.message).toContain("✅ Netflix — Rp18.500");
    expect(payload.message.split("\n").filter((s: string)=>/^-+$/.test(s))).toEqual(["-".repeat(52), "-".repeat(52)]);
    for (const hidden of ["Sold out", "Hidden", "Supplier loser", "Inactive"]) expect(payload.message).not.toContain(hidden);
    expect(payload).toMatchObject({ botNumber: config.botNumber, botRevision: config.botRevision, expiresAt: "2026-11-11T12:00:00+07:00" });
    fixture.sql.exec("UPDATE product_variants SET price=9999");
    expect(await enqueueWhatsAppPromo(db)).toBe(0); expect(row().payload).toBe(first.payload);
    vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
    expect(await enqueueWhatsAppPromo(db)).toBe(1);
    expect(JSON.parse(String(row().payload)).message).toContain("READY SORE INI");
    expect(row().idempotency_key).toBe("wa:promo:2026-11-11:evening");
  });

  it("skips outside the slot, disabled settings, insufficient budget or fewer than three ready products", async () => {
    const db = createDatabaseAccess();
    vi.setSystemTime(new Date("2026-11-11T01:59:59Z")); expect(await enqueueWhatsAppPromo(db)).toBe(0);
    vi.setSystemTime(new Date("2026-11-11T02:00:00Z"));
    setConfig({ enabled: false }); expect(await enqueueWhatsAppPromo(db)).toBe(0);
    setConfig({ enabled: true }); expect(await enqueueWhatsAppPromo({ ...db, canSpend: () => false })).toBe(0);
    fixture.sql.exec("UPDATE products SET is_active=0 WHERE id=3"); expect(await enqueueWhatsAppPromo(db)).toBe(0);
    expect(fixture.sql.prepare("SELECT count(*) n FROM whatsapp_outbox").get()?.n).toBe(0);
  });

  it("dispatches through the durable promo endpoint and retries offline without consuming attempts", async () => {
    await enqueueWhatsAppPromo(createDatabaseAccess());
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: false, error: "whatsapp_not_connected" });
    expect(await processWhatsAppOutboxRow(row())).toBe(false);
    expect(row()).toMatchObject({ status: "failed", attempt_count: 0 });
    expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ promoNotification: true, idempotencyKey: "wa:promo:2026-11-11:morning", target: GROUP, botNumber: config.botNumber, botRevision: "initial" }));
    vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: true, messageId: "WA-PROMO" });
    expect(await processWhatsAppOutboxRow(row())).toBe(true);
    expect(row()).toMatchObject({ status: "sent", provider_message_id: "WA-PROMO" });
  });

  it("never sends yesterday's catalog or a caption with malformed identity", async () => {
    await enqueueWhatsAppPromo(createDatabaseAccess());
    vi.setSystemTime(new Date("2026-11-11T05:00:00Z"));
    expect(await processWhatsAppOutboxRow(row())).toBe(true);
    expect(row()).toMatchObject({ status: "dead", last_error: "promo_expired" });
    fixture.sql.exec("UPDATE whatsapp_outbox SET status='pending',payload='{}'");
    expect(await processWhatsAppOutboxRow(row())).toBe(true);
    expect(row().last_error).toBe("invalid_promo_payload"); expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("respects pause/number revision changes and propagates database errors instead of dropping a valid promo", async () => {
    await enqueueWhatsAppPromo(createDatabaseAccess());
    for (const patch of [{ enabled: false }, { botRevision: "11111111-2222-4333-8444-555555555555" }]) {
      setConfig(patch); expect(await processWhatsAppOutboxRow(row())).toBe(false);
      expect(row()).toMatchObject({ status: "failed", attempt_count: 0 });
    }
    expect(sendTextMessage).not.toHaveBeenCalled(); setConfig({});
    fixture.control.fail = query => query.includes("SELECT value FROM store_settings");
    await expect(processWhatsAppOutboxRow(row())).rejects.toThrow("Injected database interruption");
    expect(row().status).toBe("sending");
  });

  it("quarantines explicit ambiguous delivery rather than creating a fresh send key", async () => {
    await enqueueWhatsAppPromo(createDatabaseAccess());
    vi.mocked(sendTextMessage).mockResolvedValue({ ok: false, error: "delivery_outcome_unknown", outcomeUnknown: true });
    await processWhatsAppOutboxRow(row());
    expect(row()).toMatchObject({ status: "dead", last_error: "delivery_outcome_unknown:manual_check_required" });
    expect(await enqueueWhatsAppPromo(createDatabaseAccess())).toBe(0);
  });

  it("the real adapter posts the complete caption and reviewed identity to /send-promo", async () => {
    vi.stubEnv("WHATSAPP_GATEWAY_URL", "https://fixture-gateway.test");
    vi.stubEnv("WHATSAPP_WEBHOOK_TOKEN", "fixture-only");
    const fetcher = vi.fn(async () => Response.json({ status: true, id: "WA-IMAGE" }));
    vi.stubGlobal("fetch", fetcher);
    const actual = await vi.importActual<typeof import("@/lib/whatsapp/gateway")>("@/lib/whatsapp/gateway");
    const payload = { target: GROUP, message: "*Ready*\n" + "-".repeat(52), promoNotification: true, idempotencyKey: "wa:promo:2026-11-11:morning", botNumber: config.botNumber, botRevision: "initial" };
    expect(await actual.sendTextMessage(payload)).toMatchObject({ ok: true, messageId: "WA-IMAGE" });
    expect(fetcher).toHaveBeenCalledWith("https://fixture-gateway.test/send-promo", expect.objectContaining({ body: JSON.stringify({ target: payload.target, message: payload.message, idempotencyKey: payload.idempotencyKey, botNumber: payload.botNumber, botRevision: payload.botRevision }) }));
  });
});
