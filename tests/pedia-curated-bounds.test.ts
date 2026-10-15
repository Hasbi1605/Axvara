import { describe, expect, it } from "vitest";
import { pediaBounds } from "@/lib/pedia/bounds";
import { capturePediaServiceCopy, readPediaServiceCopy } from "@/lib/pedia/service-copy";

describe("Curated supplier constraints", () => {
  it("keeps the stricter description limits and combines both steps", () => {
    expect(pediaBounds({ min_qty: 10, max_qty: 300000 }, { min_qty_override: 100, max_qty_override: 50000, quantity_step: 100 }, 30)).toEqual({ min: 100, max: 50000, step: 300 });
  });
  it("never expands supplier limits with curated overrides", () => {
    expect(pediaBounds({ min_qty: 100, max_qty: 500 }, { min_qty_override: 10, max_qty_override: 10000 })).toEqual({ min: 100, max: 500, step: 1 });
  });
  it.each([{ min_qty: 100, max_qty: 10 }, { min_qty: -1, max_qty: 100 }, { min_qty: 1, max_qty: Infinity }])("rejects invalid limits %j", (live) => { expect(pediaBounds(live, {})).toBeNull(); });
  it("keeps a bounded public snapshot and excludes internal supplier metadata", () => {
    const copy = capturePediaServiceCopy({ name: "Followers GitHub" }, { public_name: "Followers profil", terms_md: "Tanpa refill", instructions_md: "Gunakan link profil", supplier: "private", supplier_service_id: 12 });
    expect(readPediaServiceCopy(copy)).toEqual(copy);
    expect(JSON.stringify(copy)).not.toContain("supplier");
    expect(readPediaServiceCopy({ ...copy, terms: 123 })).toBeNull();
    expect(readPediaServiceCopy({ ...copy, terms: "a".repeat(3001) })).toBeNull();
  });
});
