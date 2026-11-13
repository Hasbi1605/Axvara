import fs from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/lib/pedia/curation-20261101b.json";
import { createD1Fixture } from "./helpers/d1-fixture";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { pediaTargetExample } from "@/lib/pedia/platforms";

// 2026-11-01 tahap 2: live/watchtime/komentar custom + pilihan lebih banyak.
const m87 = fs.readFileSync("drizzle/migrations/0087_pedia_tier_input_kind.sql", "utf8");
const m88 = fs.readFileSync("drizzle/migrations/0088_pedia_indosmm_catalog_20261101b.sql", "utf8");

describe("Pedia IndoSMM catalog 2026-11-01 tahap 2", () => {
  it("manifest: supported targets, white-label copy, custom comments capped at 200", () => {
    expect(manifest.services.length).toBeGreaterThan(100);
    for (const p of manifest.new_products) {
      const parsed = detectPediaLink(pediaTargetExample(p.platform, p.target_kind), p.platform);
      expect(parsed && pediaTargetMatches(p.target_kind, parsed.targetKind), p.slug).toBe(true);
    }
    for (const s of manifest.services) {
      for (const t of [s.public_name, s.description, s.terms, s.instructions]) expect(t).not.toMatch(/supplier|indosmm|penyedia/i);
      if (s.input_kind === "comments") { expect(s.product_slug).toMatch(/^comments-custom-/); expect(s.max_qty_override).toBeLessThanOrEqual(200); }
      else expect(s.product_slug).not.toMatch(/^comments-custom-/);
    }
  });

  it("0087+0088 activate comments tiers only on Custom Comments services, keep orders, idempotent", () => {
    const f = createD1Fixture();
    try {
      // Fixture schema already has input_kind; emulate a pre-0087 table to exercise the ALTER.
      f.sql.exec("ALTER TABLE pedia_tiers DROP COLUMN input_kind");
      f.sql.exec(m87);
      let id = 1;
      for (const slug of new Set(manifest.services.map((s) => s.product_slug))) {
        if (manifest.new_products.some((p) => p.slug === slug)) continue;
        f.sql.prepare("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,is_active) VALUES(?,?,?,?,?,?,?,1)").run(id++, slug, "instagram", "likes", "post", slug, JSON.stringify([1, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, 10000]));
      }
      for (const s of manifest.services) f.sql.prepare("INSERT OR IGNORE INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',?,'x','c',?,5000,1,1000000,1)").run(s.service_id, s.input_kind === "comments" ? "Custom Comments" : "Default");
      // One comments service is mirrored as Default: it must stay inactive.
      const wrong = manifest.services.find((s) => s.input_kind === "comments")!;
      f.sql.prepare("UPDATE pedia_supplier_services SET type='Default' WHERE service_id=?").run(wrong.service_id);
      f.sql.exec(m88);
      const active = f.sql.prepare("SELECT input_kind,supplier_service_id FROM pedia_tiers WHERE is_active=1").all() as { input_kind: string | null; supplier_service_id: number }[];
      expect(active.length).toBeGreaterThan(100);
      expect(active.some((t) => t.supplier_service_id === wrong.service_id)).toBe(false);
      expect(active.filter((t) => t.input_kind === "comments").length).toBeGreaterThan(0);
      const n = active.length; f.sql.exec(m88);
      expect((f.sql.prepare("SELECT COUNT(*) n FROM pedia_tiers WHERE is_active=1").get() as { n: number }).n).toBe(n);
      expect(m88).not.toMatch(/UPDATE\s+(pedia_order_items|orders)\b|DELETE FROM/i);
      expect(() => f.sql.exec("UPDATE pedia_tiers SET input_kind='bogus' WHERE id=(SELECT MIN(id) FROM pedia_tiers)")).toThrow(/CHECK/);
    } finally { f.close(); }
  });
});
