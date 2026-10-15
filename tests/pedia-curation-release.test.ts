import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import manifest from "@/lib/pedia/curation-20261015.json";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { pediaPlatform, pediaTargetExample } from "@/lib/pedia/platforms";

const migration = fs.readFileSync("drizzle/migrations/0066_pedia_catalog_expansion.sql", "utf8");
const pairs = new Map(manifest.products.flatMap((p) => p.services.map((s) => [`${s.supplier}:${s.service_id}`, s] as const)));
function supplierSql(s: { supplier: string; service_id: number }) {
  return `INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('${s.supplier}',${s.service_id},'private upstream name','Private','Default',${1000 + s.service_id},1,100000000,1)`;
}
function statements(sql: string) {
  const result: string[] = [];
  let text = "", quoted = false, comment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (comment) { if (c === "\n") { comment = false; text += "\n"; } continue; }
    if (!quoted && c === "-" && sql[i + 1] === "-") { comment = true; i++; continue; }
    text += c;
    if (c === "'") {
      if (quoted && sql[i + 1] === "'") { text += sql[++i]; continue; }
      quoted = !quoted;
    }
    if (!quoted && c === ";") { result.push(text); text = ""; }
  }
  if (text.trim()) result.push(text);
  return result;
}

describe("Reviewed two-provider Pedia release", () => {
  it("has orderable target examples and distinct curated offers across every published platform", () => {
    expect(new Set(manifest.products.map((p) => p.platform)).size).toBe(16);
    expect(new Set(manifest.products.flatMap((p) => p.services.map((s) => s.supplier)))).toEqual(new Set(["providersmm", "indosmm"]));
    for (const p of manifest.products) {
      expect(pediaPlatform(p.platform), p.slug).toBeTruthy();
      const target = detectPediaLink(pediaTargetExample(p.platform, p.target_kind), p.platform);
      expect(target?.platform, p.slug).toBe(p.platform);
      expect(target && pediaTargetMatches(p.target_kind, target.targetKind), p.slug).toBe(true);
      expect(new Set(p.services.map((s) => s.public_name)).size, p.slug).toBe(p.services.length);
      expect(p.services.filter((s) => s.is_recommended).length).toBe(1);
      for (const s of p.services) {
        expect(s.description.length).toBeGreaterThan(15);
        expect(s.terms.toLowerCase()).toContain("refill");
        expect(s.instructions).toContain("https://");
        expect(p.packages.some((q) => q >= s.min_qty_override && q <= s.max_qty_override && q % s.quantity_step === 0), `${p.slug}:${s.service_id}`).toBe(true);
      }
    }
  });

  it("migrates real rows idempotently, preserves historical IDs/terms, and prices each quantity like the quote", () => {
    const f = createD1Fixture();
    try {
      for (const s of pairs.values()) f.sql.exec(supplierSql(s));
      // Upgrade the deployed 0064 shape before applying catalog data. This
      // catches ALTER compatibility rather than only testing a fresh schema.
      for (const column of ["terms_md","instructions_md","recommendation_note","min_qty_override","max_qty_override","quantity_step","target_format","refill_anchor"]) f.sql.exec(`ALTER TABLE pedia_tiers DROP COLUMN ${column}`);
      for (const column of ["completed_at","credit_return_token"]) f.sql.exec(`ALTER TABLE pedia_order_items DROP COLUMN ${column}`);
      f.sql.exec(fs.readFileSync("drizzle/migrations/0065_pedia_service_copy.sql", "utf8"));
      const p = manifest.products[0], s = p.services[0];
      f.sql.prepare("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,is_active) VALUES(50,?,?,?,?,?,1)").run(p.slug, p.platform, p.metric, p.target_kind, "Old product name");
      f.sql.prepare("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active) VALUES(99,50,'standar',?,?,'G3',20,1000,7,1)").run(s.supplier, s.service_id);
      f.sql.exec("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method) VALUES('AXP-20261015-TEST0001','','6281234567890','[]',1000,'qris')");
      f.sql.exec("INSERT INTO pedia_order_items(order_code,product_id,tier_id,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,snapshot_json) VALUES('AXP-20261015-TEST0001',50,99,'https://instagram.com/test','https://instagram.com/test',100,10,1000,'indosmm',1,1000,'{}')");
      f.sql.exec(migration);
      expect(f.sql.prepare("SELECT id FROM pedia_tiers WHERE product_id=50 AND supplier=? AND supplier_service_id=?").get(s.supplier, s.service_id)?.id).toBe(99);
      expect(JSON.parse(String(f.sql.prepare("SELECT snapshot_json FROM pedia_order_items").get()?.snapshot_json))).toMatchObject({ refill_days: 7, min_profit_rp: 1000 });
      const active = f.sql.prepare("SELECT t.*,s.rate_idr_per_1k FROM pedia_tiers t JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id WHERE t.is_active=1").all();
      expect(active.length).toBe(manifest.products.reduce((n, product) => n + product.services.length, 0));
      for (const t of active) {
        const prices = JSON.parse(String(t.package_prices_json));
        expect(Object.keys(prices).length).toBeGreaterThan(0);
        for (const [qty, total] of Object.entries(prices)) expect(total).toBe(computePediaPrice({ supplierRatePer1k: Number(t.rate_idr_per_1k), quantity: Number(qty), markupPct: Number(t.markup_pct), minProfitRp: Number(t.min_profit_rp) }));
      }
      f.sql.exec(migration);
      expect(f.sql.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE is_active=1").get()?.n).toBe(active.length);
      expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { f.close(); }
  });

  it("executes the actual migration under D1/workerd, including large copy batches and live-only activation", async () => {
    const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2024-11-01", d1Databases: ["DB"] });
    try {
      const db = await runtime.getD1Database("DB");
      const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
      await db.prepare("CREATE TABLE orders(code TEXT PRIMARY KEY)").run();
      for (const table of ["pedia_supplier_services", "pedia_products", "pedia_tiers", "pedia_order_items"]) {
        const sql = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
        expect(sql, table).toBeTruthy();
        await db.prepare(sql!).run();
      }
      const values = [...pairs.values()];
      for (let i = 0; i < values.length; i += 30) await db.batch(values.slice(i, i + 30).map((s) => db.prepare(supplierSql(s))));
      // One newly published GitHub service disappears before migration: do not
      // expose a purchasable shell or revive an absent upstream row.
      await db.prepare("UPDATE pedia_supplier_services SET present=0 WHERE supplier='indosmm' AND service_id=8160").run();
      for (const sql of statements(migration)) await db.prepare(sql).run();
      const actual = await db.prepare("SELECT COUNT(*) AS n FROM pedia_tiers WHERE is_active=1").first<{ n: number }>();
      expect(actual?.n).toBe(manifest.products.reduce((n, p) => n + p.services.length, 0) - 1);
      expect((await db.prepare("SELECT is_active FROM pedia_products WHERE slug='followers-github'").first<{ is_active: number }>())?.is_active).toBe(0);
      expect((await db.prepare("SELECT present FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=8160").first<{ present: number }>())?.present).toBe(0);
    } finally { await runtime.dispose(); }
  }, 60000);
});
