import { afterEach, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueDueTelegramPromo, promoCampaignId } from "@/lib/telegram/promo-broadcast";
import { processBroadcasts } from "@/lib/broadcasts/worker";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("workerd D1: concurrent promo enqueue is idempotent and expired deliveries skip cleanly", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: "2026-08-06",
    d1Databases: ["DB"],
  });
  const fixture = createD1Fixture();
  try {
    const binding = await runtime.getD1Database("DB");
    const tables = fixture.sql
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { sql: string }[];
    await binding.batch(tables.map((row) => binding.prepare(row.sql)));
    await binding.batch([
      binding.prepare("INSERT OR IGNORE INTO broadcast_dispatch_control(id) VALUES(1)"),
      binding.prepare("INSERT INTO products(id,name,slug,price,is_active) VALUES(1,'Canva','canva',2000,1),(2,'Claude','claude',195000,1),(3,'Netflix','netflix',18500,1)"),
      binding.prepare("INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES(1,'C','Ready',2000,-1,1),(2,'AI','Ready',195000,5,1),(3,'N','Ready',18500,1,1)"),
      binding.prepare("INSERT INTO telegram_users(user_id,chat_id,is_blocked,broadcast_opt_out) VALUES('101','101',0,0),('102','102',0,0),('103','103',1,0),('104','104',0,1),('-10099','-10099',0,0)"),
    ]);

    vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "workerd-bot-token");

    const db = createDatabaseAccess(binding as never);
    const slotTime = new Date("2026-11-19T02:05:00Z"); // 09:05 WIB
    const [r1, r2] = await Promise.all([
      enqueueDueTelegramPromo(db, slotTime),
      enqueueDueTelegramPromo(db, slotTime),
    ]);
    expect(r1.enqueued + r2.enqueued).toBe(2);
    expect([r1.skipped, r2.skipped]).toContain("already_enqueued");

    const cid = promoCampaignId("2026-11-19", "morning");
    const deliveries = await db.queryAll("SELECT recipient_id, status FROM broadcast_deliveries WHERE campaign_id=? ORDER BY recipient_id", cid);
    expect(deliveries).toEqual([
      { recipient_id: "101", status: "pending" },
      { recipient_id: "102", status: "pending" },
    ]);

    // Deliver 1 user, then advance clock past 12:00 WIB so the 2nd is expired via SQL
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(slotTime);
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: { message_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const firstBatch = await processBroadcasts(db, 1, 20000);
    expect(firstBatch).toMatchObject({ sent: 1, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // one sendMessage (banner = link preview)

    vi.setSystemTime(new Date("2026-11-19T05:00:01Z")); // 12:00:01 WIB
    fetchMock.mockClear();
    const expiredBatch = await processBroadcasts(db, 8, 20000);
    expect(expiredBatch).toMatchObject({ sent: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    const finalRows = await db.queryAll("SELECT recipient_id, status, last_error FROM broadcast_deliveries WHERE campaign_id=? ORDER BY recipient_id", cid);
    expect(finalRows).toEqual([
      { recipient_id: "101", status: "sent", last_error: null },
      { recipient_id: "102", status: "skipped", last_error: "promo_slot_expired" },
    ]);
  } finally {
    fixture.close();
    await runtime.dispose();
  }
}, 20000);
