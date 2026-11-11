import { expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { enqueueWhatsAppPromo } from "@/lib/whatsapp/promo-digest";
import { recoverStaleWhatsAppLeases } from "@/lib/whatsapp/outbox";

it("D1 claims one catalog snapshot across concurrent ticks and retires legacy purchase notices", async () => {
  const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2026-08-06", d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const binding = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
    await binding.batch(tables.map(row => binding.prepare(row.sql)));
    await binding.batch([
      binding.prepare("INSERT INTO store_settings(key,value) VALUES('whatsapp_sales_notifications',?)").bind(JSON.stringify({ enabled: true, enabledAt: "2026-11-01T00:00:00Z", groupId: "123@g.us", botNumber: "6283181632507", botRevision: "initial" })),
      binding.prepare("INSERT INTO products(id,name,slug,price) VALUES(1,'Canva','canva',2000),(2,'Claude','claude',195000),(3,'Netflix','netflix',18500)"),
      binding.prepare("INSERT INTO product_variants(product_id,sku,label,price,stock) VALUES(1,'C','Ready',2000,-1),(2,'AI','Ready',195000,5),(3,'N','Ready',18500,1)"),
      binding.prepare("INSERT INTO whatsapp_outbox(idempotency_key,channel,destination,message_type,payload,status) VALUES('old-sale','whatsapp','123@g.us','sale_completed','old','pending')"),
    ]);
    const db = {
      ...createDatabaseAccess(),
      queryFirst: async (sql: string, ...params: unknown[]) => binding.prepare(sql).bind(...params).first<Record<string, unknown>>(),
      queryAll: async (sql: string, ...params: unknown[]) => (await binding.prepare(sql).bind(...params).all<Record<string, unknown>>()).results,
      execRun: async (sql: string, ...params: unknown[]) => (await binding.prepare(sql).bind(...params).run()).meta,
    };
    const now = new Date("2026-11-11T02:00:00Z");
    expect((await Promise.all([enqueueWhatsAppPromo(db, now), enqueueWhatsAppPromo(db, now)])).reduce((a,b)=>a+b)).toBe(1);
    expect((await db.queryAll("SELECT payload FROM whatsapp_outbox WHERE message_type='promo_digest'"))[0].payload).toContain("READY PAGI INI");
    expect(await recoverStaleWhatsAppLeases(db)).toBe(1);
    expect(await db.queryFirst("SELECT status,last_error FROM whatsapp_outbox WHERE idempotency_key='old-sale'")).toEqual({ status: "dead", last_error: "sales_notifications_retired" });
  } finally { fixture.close(); await runtime.dispose(); }
}, 20000);
