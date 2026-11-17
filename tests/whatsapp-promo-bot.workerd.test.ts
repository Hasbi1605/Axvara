import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueWhatsAppPromoBot } from "@/lib/whatsapp/promo-bot";

it("D1 json_each inserts twenty distinct targets once across concurrent cron ticks", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2026-08-06", d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const binding = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
    await binding.batch(tables.map(row => binding.prepare(row.sql)));
    const groups = Array.from({ length: 20 }, (_, i) => ({ id: `${123000 + i}@g.us`, subject: `Group ${i}` }));
    await binding.batch([
      binding.prepare("INSERT INTO store_settings(key,value) VALUES('whatsapp_promo_bot',?)").bind(JSON.stringify({ enabled: true, botNumber: "628123456789", botRevision: "initial", groups })),
      binding.prepare("INSERT INTO products(id,name,slug,price) VALUES(1,'Canva','canva',2000),(2,'Claude','claude',195000),(3,'Netflix','netflix',18500)"),
      binding.prepare("INSERT INTO product_variants(product_id,sku,label,price,stock) VALUES(1,'C','Ready',2000,-1),(2,'AI','Ready',195000,5),(3,'N','Ready',18500,1)"),
    ]);
    const db = {
      ...createDatabaseAccess(),
      queryFirst: async (sql: string, ...params: unknown[]) => binding.prepare(sql).bind(...params).first<Record<string, unknown>>(),
      queryAll: async (sql: string, ...params: unknown[]) => (await binding.prepare(sql).bind(...params).all<Record<string, unknown>>()).results,
      execRun: async (sql: string, ...params: unknown[]) => (await binding.prepare(sql).bind(...params).run()).meta,
    };
    const now = new Date("2026-11-17T02:00:00Z");
    expect((await Promise.all([enqueueWhatsAppPromoBot(db, now), enqueueWhatsAppPromoBot(db, now)])).reduce((a, b) => a + b)).toBe(20);
    expect(await db.queryFirst("SELECT count(*) AS n, count(DISTINCT destination) AS destinations FROM whatsapp_outbox")).toEqual({ n: 20, destinations: 20 });
    expect((await db.queryFirst("SELECT payload FROM whatsapp_outbox LIMIT 1"))?.payload).toContain("Join Grup WA:");
    await binding.prepare("UPDATE store_settings SET value=? WHERE key='whatsapp_promo_bot'").bind(JSON.stringify({ enabled: true, enabledAt: "2026-11-17T02:32:00.000Z", botNumber: "628123456789", botRevision: "initial", groups: [{ id: "999000@g.us", subject: "Extra" }] })).run();
    expect(await enqueueWhatsAppPromoBot(db, new Date("2026-11-17T02:32:00Z"))).toBe(0);
    expect(await enqueueWhatsAppPromoBot(db, new Date("2026-11-17T10:00:00Z"))).toBe(1);
  } finally { fixture.close(); await runtime.dispose(); }
}, 20000);
