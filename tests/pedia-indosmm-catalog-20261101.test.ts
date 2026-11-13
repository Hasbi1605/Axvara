import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import manifest from "@/lib/pedia/curation-20261101.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { pediaTargetExample } from "@/lib/pedia/platforms";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// 2026-11-01 (owner): katalog IndoSMM lebih kaya + label drop/refill + kesehatan layanan.
const m85 = fs.readFileSync("drizzle/migrations/0085_pedia_service_health.sql", "utf8");
const m86 = fs.readFileSync("drizzle/migrations/0086_pedia_indosmm_catalog_20261101.sql", "utf8");
const ids = [...new Set(manifest.services.map((s) => s.service_id))];

describe("Pedia IndoSMM catalog 2026-11-01", () => {
  it("manifest: valid labels, honest refill copy, reachable packages, supported targets", () => {
    expect(manifest.services.length).toBeGreaterThan(100);
    const names = new Set<string>();
    for (const s of manifest.services) {
      expect(["no_drop", "less_drop", "high_drop", "unknown"]).toContain(s.drop_label);
      expect(names.has(`${s.product_slug}|${s.public_name}`), s.public_name).toBe(false);
      names.add(`${s.product_slug}|${s.public_name}`);
      expect(s.public_name).toMatch(s.refill_days > 0 ? /Refill (\d+ Days|Lifetime)/ : /No Refill/);
      expect(s.terms).toContain(s.refill_days > 0 ? "halaman Refill Pedia" : "No Refill: jumlah yang drop tidak diisi ulang.");
      if (s.refill_days > 0) expect(s.terms).toContain(s.evidence.api_refill ? "diproses otomatis" : "diproses admin");
      // White label: tidak ada nama/kata supplier pada teks publik.
      for (const text of [s.public_name, s.description, s.terms, s.instructions]) expect(text).not.toMatch(/supplier|indosmm|penyedia/i);
      expect(s.evidence.success_rate ?? 0).toBeGreaterThanOrEqual(85);
    }
    for (const p of manifest.new_products) {
      const parsed = detectPediaLink(pediaTargetExample(p.platform, p.target_kind), p.platform);
      expect(parsed && pediaTargetMatches(p.target_kind, parsed.targetKind), p.slug).toBe(true);
      expect(p.description).toContain("tidak bisa ditentukan");
    }
    expect(manifest.deactivate_service_ids).toEqual(expect.arrayContaining([4899, 8063]));
  });

  it("0085 adds health table and tier columns to an existing tiers table", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE pedia_tiers(id INTEGER PRIMARY KEY, supplier TEXT, supplier_service_id INTEGER)");
      db.exec(m85);
      expect(db.prepare("SELECT COUNT(*) n FROM pedia_service_stats").get().n).toBeGreaterThan(1000);
      db.exec("INSERT INTO pedia_tiers(id,supplier,supplier_service_id,drop_label,speed_per_day) VALUES(1,'indosmm',1,'high_drop','10K/hari')");
      expect(() => db.exec("INSERT INTO pedia_tiers(id,drop_label) VALUES(2,'bogus')")).toThrow(/CHECK/);
    } finally { db.close(); }
  });

  it("0086 activates priced tiers from live mirrors, deactivates failing services, keeps old orders, is idempotent", () => {
    const f = createD1Fixture();
    try {
      const products = new Set(manifest.services.map((s) => s.product_slug));
      let pid = 1;
      for (const slug of products) {
        if (manifest.new_products.some((p) => p.slug === slug)) continue;
        const [metric] = slug.split("-");
        f.sql.prepare("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,is_active) VALUES(?,?,?,?,?,?,?,1)").run(pid++, slug, "instagram", metric, "post", slug, JSON.stringify([1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 100000]));
      }
      for (const id of [...ids, ...manifest.deactivate_service_ids]) f.sql.prepare("INSERT OR IGNORE INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES('indosmm',?,'x','c','Default',5000,1,100000000,0,1)").run(id);
      f.sql.exec("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,is_active) VALUES(900,'likes-page-facebook','facebook','likes','profile','Page',' [100,1000]',1)");
      f.sql.exec(`INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,package_prices_json) VALUES(900,900,'standar','indosmm',${manifest.deactivate_service_ids[0]},'G3',20,1000,1,'{"100":2000}')`);
      f.sql.exec("INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES('AXP-OLD','','62812','a@b.c','[]',2000,'qris','lunas','pedia')");
      f.sql.exec("INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status) VALUES('AXP-OLD',900,900,'{}','t','t',100,1,2000,'indosmm',1,1,'completed')");
      const oldOrder = f.sql.prepare("SELECT * FROM pedia_order_items").get();
      f.sql.exec(m86);
      expect(f.sql.prepare("SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE id=900").get()).toEqual({ is_active: 0, auto_disabled_reason: "supplier_health_20261101" });
      expect(f.sql.prepare("SELECT is_active FROM pedia_products WHERE id=900").get()?.is_active).toBe(0);
      const active = f.sql.prepare("SELECT t.*,s.rate_idr_per_1k FROM pedia_tiers t JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id WHERE t.is_active=1").all();
      expect(active.length).toBeGreaterThan(80);
      for (const t of active) {
        expect(t.drop_label).toBeTruthy();
        for (const [q, price] of Object.entries(JSON.parse(String(t.package_prices_json)))) expect(price).toBe(computePediaPrice({ supplierRatePer1k: Number(t.rate_idr_per_1k), quantity: Number(q), markupPct: Number(t.markup_pct), minProfitRp: Number(t.min_profit_rp) }));
      }
      // Manual-refill tiers (no API refill) are now sellable with a clear refill route.
      expect(active.some((t) => Number(t.refill_days) > 0)).toBe(true);
      expect(f.sql.prepare("SELECT COUNT(*) n FROM pedia_products WHERE slug LIKE 'comments-%' AND is_active=1").get()?.n).toBe(manifest.new_products.length);
      expect(f.sql.prepare("SELECT * FROM pedia_order_items").get()).toEqual(oldOrder);
      const count = f.sql.prepare("SELECT COUNT(*) n FROM pedia_tiers").get()?.n;
      f.sql.exec(m86);
      expect(f.sql.prepare("SELECT COUNT(*) n FROM pedia_tiers").get()?.n).toBe(count);
      expect(f.sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(m86).not.toMatch(/UPDATE\s+(pedia_order_items|orders)\b|DELETE FROM/i);
    } finally { f.close(); }
  });
});
