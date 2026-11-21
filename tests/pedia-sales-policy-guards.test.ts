// tests/pedia-sales-policy-guards.test.ts — AU-J2-4 (absorbs AU-J2-16):
// INDO-POLICY-20 single-supplier rule and the env-backed Pedia money guards had
// zero direct test importers. These pin the retired-provider payload, the
// premium-tool exclusion and the effective min-order / balance-alert values
// used by quote/order/pricing/cron.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PEDIA_SALE_PROVIDER,
  PEDIA_SALE_RETIRED,
  isPediaPremiumToolCandidate,
  isPediaSaleProvider,
} from "@/lib/pedia/sales-policy";
import { PEDIA_BALANCE_ALERT_RP_DEFAULT, pediaBalanceAlertRp, pediaMinOrderRp } from "@/lib/pedia/ops-config";
import { PEDIA_MIN_ORDER_RP_DEFAULT, computePediaPrice } from "@/lib/pedia/pricing";

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("Pedia sale policy (INDO-POLICY-20)", () => {
  it("only IndoSMM is a sale provider and the match is exact", () => {
    expect(PEDIA_SALE_PROVIDER).toBe("indosmm");
    expect(isPediaSaleProvider("indosmm")).toBe(true);
    for (const retired of ["jap", "providersmm", "IndoSMM", "indosmm ", "", null, undefined, 0]) {
      expect(isPediaSaleProvider(retired)).toBe(false);
    }
  });

  it("exposes the exact retired-provider rejection payload consumed by admin products", () => {
    expect(PEDIA_SALE_RETIRED).toEqual({
      error: "provider_retired",
      message: "Layanan ini sudah tidak dijual. Muat ulang katalog dan pilih layanan lain.",
    });
  });

  it("excludes premium tools by product name or category, case-insensitively", () => {
    expect(isPediaPremiumToolCandidate("Canva Pro 1 Tahun", "Design")).toBe(true);
    expect(isPediaPremiumToolCandidate("Gemini Advanced", "")).toBe(true);
    expect(isPediaPremiumToolCandidate("", "CapCut")).toBe(true);
    expect(isPediaPremiumToolCandidate("CANVA", "other")).toBe(true);
    expect(isPediaPremiumToolCandidate("Netflix Premium", "Streaming")).toBe(false);
    expect(isPediaPremiumToolCandidate(null, null)).toBe(false);
    expect(isPediaPremiumToolCandidate(undefined, undefined)).toBe(false);
    // Substring match is the documented behaviour (e.g. "canvas" contains "canva").
    expect(isPediaPremiumToolCandidate("Canvas bag", "")).toBe(true);
  });
});

describe("Pedia ops-config money guards", () => {
  it("falls back to the production defaults when env is unset, empty, zero or non-numeric", () => {
    expect(pediaMinOrderRp()).toBe(PEDIA_MIN_ORDER_RP_DEFAULT);
    expect(pediaBalanceAlertRp()).toBe(PEDIA_BALANCE_ALERT_RP_DEFAULT);

    for (const value of ["", "0", "abc", "NaN"]) {
      vi.stubEnv("PEDIA_MIN_ORDER_RP", value);
      vi.stubEnv("PEDIA_BALANCE_ALERT_RP", value);
      expect(pediaMinOrderRp()).toBe(PEDIA_MIN_ORDER_RP_DEFAULT);
      expect(pediaBalanceAlertRp()).toBe(PEDIA_BALANCE_ALERT_RP_DEFAULT);
    }
  });

  it("accepts numeric env overrides and feeds them straight into pricing", () => {
    vi.stubEnv("PEDIA_MIN_ORDER_RP", "2500");
    vi.stubEnv("PEDIA_BALANCE_ALERT_RP", "150000");
    expect(pediaMinOrderRp()).toBe(2500);
    expect(pediaBalanceAlertRp()).toBe(150000);
    // The min-order override is the hard floor on the sale price.
    expect(computePediaPrice({
      supplierRatePer1k: 1000,
      quantity: 1,
      markupPct: 20,
      minProfitRp: 0,
      minOrderRp: pediaMinOrderRp(),
    })).toBe(2500);
  });
});
