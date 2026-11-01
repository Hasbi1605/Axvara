import fs from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/lib/pedia/names-20261102.json";

const sql = fs.readFileSync("drizzle/migrations/0089_pedia_service_names_20261102.sql", "utf8");

describe("Pedia service names 2026-11-02 (0089)", () => {
  it("uses [Metrik] [Wilayah] [Kualitas] names without refill/drop or legacy noise", () => {
    expect(manifest.rename.length).toBeGreaterThan(200);
    for (const r of manifest.rename) {
      expect(r.new).toMatch(/\b(Global|Indonesia|Campuran)\b/);
      expect(r.new).not.toMatch(/Ekonomis|Murah|\bMax \d|Mulai \d|Refill|No Drop|Less Drop|High Drop|Tayangan/);
      expect(r.new.length).toBeLessThanOrEqual(120);
    }
  });

  it("keeps one service per need group and never renames a deactivated tier", () => {
    const renamed = new Set(manifest.rename.map((r) => r.id));
    expect(manifest.deactivate.every((d) => !renamed.has(d.id))).toBe(true);
    const ids = [...manifest.rename, ...manifest.deactivate].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("guards every update on the exported name so later admin edits are not overwritten", () => {
    const lines = sql.split("\n").filter((l) => l.startsWith("UPDATE"));
    expect(lines).toHaveLength(manifest.rename.length + manifest.deactivate.length);
    expect(lines.every((l) => /WHERE id=\d+ AND .*COALESCE\(public_name,label_note\)='/.test(l))).toBe(true);
    expect(sql).not.toMatch(/DELETE FROM|DROP (TABLE|INDEX)|supplier_service_id\s*=/);
  });
});
