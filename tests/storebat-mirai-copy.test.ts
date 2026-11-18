import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAdminVariantCopy } from "@/lib/product-copy/format";
import { STOREBAT_COPY, type CuratedFamilyCopy } from "@/lib/storebat/copy";
import { STOREBAT_FAMILY_SPECS, storebatFamily } from "@/lib/storebat/families";
import { MIRAI_COPY } from "@/lib/mirai/copy";
import { MIRAI_GROUP_SPECS, miraiFamily } from "@/lib/mirai/families";
import { createD1Fixture } from "./helpers/d1-fixture";

const M0141 = fs.readFileSync("drizzle/migrations/0141_storebat_mirai_supplier_links.sql", "utf8");
const M0127 = fs.readFileSync("drizzle/migrations/0127_supplier_copy_id_en.sql", "utf8");

function collectAllStrings(copyMap: Record<string, CuratedFamilyCopy>): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const [familyKey, fam] of Object.entries(copyMap)) {
    out.push({ path: `${familyKey}.description`, text: fam.description });
    out.push({ path: `${familyKey}.description_en`, text: fam.description_en });
    for (const [sku, v] of Object.entries(fam.variants)) {
      out.push({ path: `${familyKey}.${sku}.admin_terms`, text: v.admin_terms });
      out.push({ path: `${familyKey}.${sku}.admin_terms_en`, text: v.admin_terms_en });
      out.push({ path: `${familyKey}.${sku}.admin_activation`, text: v.admin_activation });
      out.push({ path: `${familyKey}.${sku}.admin_activation_en`, text: v.admin_activation_en });
    }
  }
  return out;
}

describe("StoreBat & Mirai curated copy modules + 0141 supplier_links", () => {
  it("covers every static StoreBat family and SKU with matching category and images/imageUrl", () => {
    const staticSkus: string[] = [];
    for (const spec of STOREBAT_FAMILY_SPECS) {
      const famCopy = STOREBAT_COPY[spec.key];
      expect(famCopy, `missing STOREBAT_COPY for ${spec.key}`).toBeDefined();
      expect(famCopy.category_id).toBe(spec.category);
      expect(spec.images.length > 0 || Boolean(spec.imageUrl), `missing image/imageUrl for ${spec.key}`).toBe(true);
      if (spec.imageUrl) expect(spec.imageUrl).toMatch(/^\/r2\/products\/[a-f0-9]+\.webp$/);

      for (const idStr of Object.keys(spec.members)) {
        const id = Number(idStr);
        const sku = id === 124 ? "SB-BUFF" : `SB-${id}`;
        staticSkus.push(sku);
        expect(storebatFamily(id, "").key).toBe(spec.key);
        expect(famCopy.variants[sku], `missing variant copy for ${spec.key} ${sku}`).toBeDefined();
      }
    }

    const copySkus = Object.values(STOREBAT_COPY).flatMap((f) => Object.keys(f.variants));
    expect(copySkus.sort()).toEqual([...staticSkus].sort());
  });

  it("covers every static Mirai group and expected MR-* SKUs with matching category and images/imageUrl", () => {
    for (const [groupKey, spec] of Object.entries(MIRAI_GROUP_SPECS)) {
      const famCopy = MIRAI_COPY[groupKey];
      expect(famCopy, `missing MIRAI_COPY for ${groupKey}`).toBeDefined();
      expect(famCopy.category_id).toBe(spec.category);
      expect(spec.images.length > 0 || Boolean(spec.imageUrl), `missing image/imageUrl for mirai ${groupKey}`).toBe(true);
      if (spec.imageUrl) expect(spec.imageUrl).toMatch(/^\/r2\/products\/[a-f0-9]+\.webp$/);
      expect(miraiFamily({ package_code: "FIXTURE", group: groupKey, name: "Fixture", quota_tokens: 10_000_000, duration_seconds: 86400 })).toMatchObject({
        key: spec.key,
        category: spec.category,
      });
    }

    const expectedMiraiSkus = [
      "MR-GPT_10M", "MR-GPT_50M", "MR-GPT_100M", "MR-GPT_500M",
      "MR-CLAUDE_10M", "MR-CLAUDE_50M", "MR-CLAUDE_100M", "MR-CLAUDE_500M",
      "MR-FULL_10M", "MR-FULL_50M", "MR-FULL_100M", "MR-FULL_500M",
      "MR-TAU_50M", "MR-TAU_100M", "MR-TAU_500M",
    ];
    const actualMiraiSkus = Object.values(MIRAI_COPY).flatMap((f) => Object.keys(f.variants));
    expect(actualMiraiSkus.sort()).toEqual(expectedMiraiSkus.sort());
  });

  it("parses every StoreBat and Mirai variant copy in both ID and EN", () => {
    for (const [label, map] of [["storebat", STOREBAT_COPY], ["mirai", MIRAI_COPY]] as const) {
      for (const [familyKey, fam] of Object.entries(map)) {
        for (const [sku, v] of Object.entries(fam.variants)) {
          const parsedId = parseAdminVariantCopy(v.admin_terms, v.admin_activation);
          const parsedEn = parseAdminVariantCopy(v.admin_terms_en, v.admin_activation_en);
          expect(parsedId, `${label} ${familyKey} ${sku} ID parse`).not.toBeNull();
          expect(parsedEn, `${label} ${familyKey} ${sku} EN parse`).not.toBeNull();
          expect(parsedId!.sections.length, `${label} ${familyKey} ${sku} ID sections`).toBeGreaterThan(0);
          expect(parsedEn!.sections.length, `${label} ${familyKey} ${sku} EN sections`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never ships PM notes or StoreBat/VenteBot names in buyer-facing copy", () => {
    for (const [label, map] of [["storebat", STOREBAT_COPY], ["mirai", MIRAI_COPY]] as const) {
      for (const [familyKey, fam] of Object.entries(map)) {
        expect("notes" in fam, `${label}.${familyKey} leaked notes`).toBe(false);
        for (const [sku, v] of Object.entries(fam.variants)) {
          expect("notes" in v, `${label}.${familyKey}.${sku} leaked notes`).toBe(false);
          expect("label" in v, `${label}.${familyKey}.${sku} leaked label`).toBe(false);
          expect("name" in v, `${label}.${familyKey}.${sku} leaked name`).toBe(false);
        }
      }
      for (const { path: fieldPath, text } of collectAllStrings(map)) {
        expect(text, `${label}.${fieldPath} mentions StoreBat/VenteBot`).not.toMatch(/\b(?:storebat|ventebot)\b/i);
      }
    }
  });

  it("0141 seeds new supplier_links idempotently without duplicating earlier migrations, and resolves every axvara.tech/go/<slug> in copy", () => {
    const migrationsDir = "drizzle/migrations";
    const earlierSlugs = new Set<string>();
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql") || file.startsWith("0141_")) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      if (!sql.includes("supplier_links")) continue;
      for (const m of sql.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'/g)) {
        earlierSlugs.add(m[1]);
      }
    }

    const slugsIn0141 = [...M0141.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'/g)].map((m) => m[1]);
    expect(slugsIn0141.length).toBe(40);
    expect(new Set(slugsIn0141).size).toBe(slugsIn0141.length);
    for (const slug of slugsIn0141) {
      expect(earlierSlugs.has(slug), `0141 duplicates earlier migration slug: ${slug}`).toBe(false);
    }

    const allKnownMigrationSlugs = new Set([...earlierSlugs, ...slugsIn0141]);
    const referencedSlugs = new Set<string>();
    for (const map of [STOREBAT_COPY, MIRAI_COPY]) {
      for (const { text } of collectAllStrings(map)) {
        for (const m of text.matchAll(/axvara\.tech\/go\/([a-z0-9-]+)/g)) {
          referencedSlugs.add(m[1]);
        }
      }
    }
    expect(referencedSlugs.size).toBeGreaterThan(0);
    for (const slug of referencedSlugs) {
      expect(allKnownMigrationSlugs.has(slug), `missing migration for axvara.tech/go/${slug}`).toBe(true);
    }

    const fx = createD1Fixture();
    try {
      const m0127LinksOnly = M0127.split(";")[0] + ";";
      fx.sql.exec(m0127LinksOnly);
      fx.sql.exec(M0141);
      fx.sql.exec(M0141); // idempotent rerun

      for (const slug of slugsIn0141) {
        const row = fx.sql
          .prepare("SELECT COUNT(*) AS n, MIN(is_active) AS active FROM supplier_links WHERE slug=?")
          .get(slug) as { n: number; active: number };
        expect(row, slug).toEqual({ n: 1, active: 1 });
      }
      for (const slug of referencedSlugs) {
        const row = fx.sql
          .prepare("SELECT slug FROM supplier_links WHERE slug=? AND is_active=1")
          .get(slug);
        expect(row, `missing active supplier_links row for ${slug}`).toBeDefined();
      }
    } finally {
      fx.close();
    }
  });
});
