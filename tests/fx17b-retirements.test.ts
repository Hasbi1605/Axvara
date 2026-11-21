import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/rateLimit";

const source = (path: string) => readFileSync(path, "utf8");

describe("FX-17b dead code retirement", () => {
  it.each([
    ["LaunchCards", ["src/components/storefront/LaunchCards.saved.tsx"]],
    ["LinkPasteHero", ["src/components/pedia/LinkPasteHero.tsx"]],
    ["dated generators", [
      "scripts/curate-pedia-indosmm-20261101.py",
      "scripts/curate-pedia-indosmm-20261101b.py",
      "scripts/curate-pedia-names-20261102.py",
      "scripts/generate-pedia-indosmm-20261020.mjs",
      "scripts/generate-pedia-indosmm-20261101.mjs",
      "scripts/generate-pedia-indosmm-20261101b.mjs",
      "scripts/generate-games-reference-seed.mjs",
    ]],
    ["proof upload", ["src/app/api/proof/upload/route.ts"]],
    ["Pedia credit check", ["src/app/api/pedia/credits/check/route.ts"]],
    ["admin payment test", [
      "src/app/api/admin/payments/test/quote/route.ts",
      "src/app/api/admin/payments/test/orders/route.ts",
    ]],
    ["admin supplier pairs", [
      "src/app/api/admin/supplier-pairs/route.ts",
      "src/app/api/admin/supplier-pairs/decide/route.ts",
    ]],
    ["Pedia ticker", ["src/components/pedia/OrderTicker.tsx", "src/app/api/pedia/ticker/route.ts"]],
  ])("removes %s from the source tree", (_name, paths) => {
    expect(paths.filter((path) => existsSync(path))).toEqual([]);
  });

  it("removes the orphan styles, parser exports and upload rate limit", () => {
    expect(source("src/app/globals.css")).not.toMatch(/ax-launch|--ax-angle|ax-spin|ax-sheen/);
    expect(source("src/lib/pedia/link.ts")).not.toMatch(/PEDIA_TARGET_KIND_LABEL|maskTargetForTicker/);
    expect(RATE_LIMITS).not.toHaveProperty("proof:upload");
  });

  it("keeps live checkout POST handlers without the unreachable sale-provider branches", () => {
    for (const path of ["src/app/api/pedia/quote/route.ts", "src/app/api/pedia/orders/route.ts"]) {
      const handler = source(path);
      expect(handler).toContain("export async function POST(");
      expect(handler).not.toMatch(/isPediaSaleProvider|PEDIA_SALE_RETIRED|provider_retired/);
    }
  });
});
