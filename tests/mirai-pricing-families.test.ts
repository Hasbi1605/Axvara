import { afterEach, describe, expect, it } from "vitest";
import {
  MIRAI_VND_PER_USDT,
  loadMiraiFxIdrPerUsdt,
  miraiBalanceVndToUsdt,
  miraiCostUsdtFromVnd,
  miraiSellPriceIdr,
} from "@/lib/mirai/pricing";
import {
  miraiFamily,
  miraiSlugHash,
  miraiVariantLabel,
  sortMiraiPackagesByQuota,
} from "@/lib/mirai/families";
import { miraiEligibility } from "@/lib/mirai/purchase";
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  delete process.env.USD_IDR_RATE;
  delete process.env.USD_FX_EFFECTIVE_AT;
  resetCryptoMarketMemo();
});

describe("MiraiAPI pricing & families", () => {
  it("converts VND to USDT with MIRAI_VND_PER_USDT=26000 and <=6 decimals", () => {
    expect(MIRAI_VND_PER_USDT).toBe(26000);
    expect(miraiCostUsdtFromVnd(6650)).toBe(0.255769);
    expect(miraiCostUsdtFromVnd(33250)).toBe(1.278846);
    expect(miraiCostUsdtFromVnd(356250)).toBe(13.701923);
    expect(miraiBalanceVndToUsdt(0)).toBe(0);
    expect(miraiBalanceVndToUsdt(130000)).toBe(5);
    expect(() => miraiCostUsdtFromVnd(0)).toThrow();
    expect(() => miraiBalanceVndToUsdt(-1)).toThrow();
  });

  it("computes ceil-100 IDR sell price and fails closed on invalid FX/markup", () => {
    const cost = miraiCostUsdtFromVnd(6650); // 0.255769 USDT
    // 0.255769 * 16000 * 1.35 = 5524.6104 -> ceil100 = 5600
    expect(miraiSellPriceIdr(cost, 16000)).toBe(5600);
    expect(miraiSellPriceIdr(cost, 16000, 0)).toBe(4100);
    expect(miraiSellPriceIdr(cost, 16000, 1000)).toBe(45100);

    expect(() => miraiSellPriceIdr(cost, 0, 35)).toThrow();
    expect(() => miraiSellPriceIdr(cost, -16000, 35)).toThrow();
    expect(() => miraiSellPriceIdr(cost, 16000, -1)).toThrow();
    expect(() => miraiSellPriceIdr(cost, 16000, 1001)).toThrow();
  });

  it("loads current AXVARA FX snapshot and fails closed when unavailable or stale", async () => {
    const f = createD1Fixture();
    try {
      const now = Date.now();
      expect(await loadMiraiFxIdrPerUsdt(f.db, now)).toBeNull();

      f.sql
        .prepare(
          `INSERT INTO crypto_market_snapshot(id, fx_rate_text, fx_source, fx_effective_at)
           VALUES(1, '16500', 'nowpayments-estimate', ?)`,
        )
        .run(new Date(now - 60_000).toISOString());
      expect(await loadMiraiFxIdrPerUsdt(f.db, now)).toBe(16500);

      // Stale (>24h) fails closed
      f.sql
        .prepare(`UPDATE crypto_market_snapshot SET fx_effective_at=? WHERE id=1`)
        .run(new Date(now - 25 * 60 * 60_000).toISOString());
      expect(await loadMiraiFxIdrPerUsdt(f.db, now)).toBeNull();
    } finally {
      f.close();
    }
  });

  it("maps static families by group, builds quota/duration labels, and hashes fallback slugs", () => {
    expect(
      miraiFamily({
        package_code: "GPT_10M",
        group: "gpt",
        name: "GPT 10M tokens · 1D",
        quota_tokens: 10_000_000,
        duration_seconds: 86400,
      }),
    ).toMatchObject({
      key: "gpt",
      name: "API GPT Token",
      slug: "api-gpt-token-mr",
      label: "10M Token · 1 Hari",
    });

    expect(
      miraiFamily({
        package_code: "CLAUDE_500M",
        group: "claude",
        name: "Claude 500M tokens · 6D",
        quota_tokens: 500_000_000,
        duration_seconds: 518400,
      }),
    ).toMatchObject({
      key: "claude",
      name: "API Claude Token",
      slug: "api-claude-token-mr",
      label: "500M Token · 6 Hari",
    });

    expect(
      miraiFamily({
        package_code: "FULL_100M",
        group: "full",
        name: "Full GPT + Claude 100M tokens · 3D",
        quota_tokens: 100_000_000,
        duration_seconds: 259200,
      }),
    ).toMatchObject({
      key: "full",
      name: "API GPT + Claude Token",
      slug: "api-gpt-claude-token-mr",
      label: "100M Token · 3 Hari",
    });

    expect(
      miraiFamily({
        package_code: "TAU_500M",
        group: "tau",
        name: "Trung Quốc 500M tokens · 7D",
        quota_tokens: 500_000_000,
        duration_seconds: 604800,
      }),
    ).toMatchObject({
      key: "tau",
      name: "API Model China Token",
      slug: "api-model-china-token-mr",
      label: "500M Token · 7 Hari",
    });

    expect(miraiVariantLabel(50_000_000, 172800)).toBe("50M Token · 2 Hari");
    expect(miraiVariantLabel(100_000_000, 345600)).toBe("100M Token · 4 Hari");

    const fbA = miraiFamily({
      package_code: "GEM_10M",
      group: "gemini_special",
      name: "Same Name",
      quota_tokens: 10_000_000,
      duration_seconds: 86400,
    });
    const fbB = miraiFamily({
      package_code: "GEM_20M",
      group: "gemini_special",
      name: "Same Name",
      quota_tokens: 20_000_000,
      duration_seconds: 86400,
    });
    expect(fbA.key).toBe("package:GEM_10M");
    expect(fbA.slug).toBe(`same-name-${miraiSlugHash("GEM_10M")}-mr`);
    expect(fbA.slug).not.toBe(fbB.slug);
  });

  it("sorts variants by quota ascending and builds mirai_eligibility v1", () => {
    const sorted = sortMiraiPackagesByQuota([
      { code: "GPT_500M", quota_tokens: 500_000_000, duration_seconds: 518400 },
      { code: "GPT_10M", quota_tokens: 10_000_000, duration_seconds: 86400 },
      { code: "GPT_100M", quota_tokens: 100_000_000, duration_seconds: 259200 },
      { code: "GPT_50M", quota_tokens: 50_000_000, duration_seconds: 172800 },
    ]);
    expect(sorted.map((p) => p.code)).toEqual(["GPT_10M", "GPT_50M", "GPT_100M", "GPT_500M"]);

    const row = {
      id: 42,
      sku: "MR-GPT_10M",
      mirai_package_code: "GPT_10M",
      mirai_family: "gpt",
      mirai_source_cost_usdt: 0.255769,
    };
    expect(miraiEligibility(row, 2)).toEqual({
      version: 1,
      package_code: "GPT_10M",
      mirai_family: "gpt",
      sku: "MR-GPT_10M",
      source_variant_id: 42,
      quantity: 2,
      cost_usdt: 0.511538,
    });
    expect(miraiEligibility({ ...row, sku: "AV-GPT_10M" }, 1)).toBeUndefined();
    expect(miraiEligibility({ ...row, mirai_family: null }, 1)).toBeUndefined();
    expect(miraiEligibility(row, 0)).toBeUndefined();
  });
});
