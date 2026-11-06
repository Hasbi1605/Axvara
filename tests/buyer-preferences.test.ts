import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveBuyerPreferences, preferenceCookie, normalizeCountry } from "@/lib/i18n/locale";
import { loadFxSnapshot } from "@/lib/payments/fx";
import { displayUsdCents, formatIdr, formatUsdCents, formatCryptoAmount, formatBuyerDate } from "@/lib/i18n/format";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const cf = vi.hoisted(() => ({ country: "US" as string | undefined, unavailable: false }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => { if (cf.unavailable) throw new Error("no context"); return { cf: { country: cf.country } }; } }));
afterEach(() => { vi.unstubAllEnvs(); cf.country = "US"; cf.unavailable = false; });

it("resolves independent cookies, weighted languages and real-country fallback", () => {
  expect(resolveBuyerPreferences("axv_locale=id; axv_currency=USD", "en-US", "ID")).toEqual({ locale: "id", currency: "USD" });
  expect(resolveBuyerPreferences("axv_locale=en", "id", "ID")).toEqual({ locale: "en", currency: "IDR" });
  expect(resolveBuyerPreferences("axv_locale=%zz; axv_locale=en; axv_currency=bad; axv_currency=USD", "id", "ID")).toEqual({ locale: "en", currency: "USD" });
  expect(resolveBuyerPreferences("", "fr, en-US;q=0.3, id-ID;q=0.9", "US")).toEqual({ locale: "id", currency: "USD" });
  expect(resolveBuyerPreferences("", "en;q=0, id;q=0.5", "US")).toEqual({ locale: "id", currency: "USD" });
  for (const invalid of ["XX", "ZZ", "T1", "AA", undefined]) {
    expect(normalizeCountry(invalid)).toBeNull();
    expect(resolveBuyerPreferences("", "fr", invalid)).toEqual({ locale: "id", currency: "IDR" });
  }
  expect(resolveBuyerPreferences("", "fr", "US")).toEqual({ locale: "en", currency: "USD" });
  expect(preferenceCookie("axv_currency", "USD", true)).toBe("axv_currency=USD; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
});

it("formats exact cents and verbatim crypto; stale/missing FX stays unavailable", () => {
  expect(formatUsdCents(BigInt("123456789012345"), "en")).toBe("$1,234,567,890,123.45");
  expect(formatUsdCents(BigInt(-5), "en")).toBe("-$0.05");
  expect(formatUsdCents(BigInt(123456), "id")).toContain("1.234,56");
  expect(formatIdr(250000, "id")).toContain("250.000");
  expect(formatCryptoAmount("0.0000012300", "USDT")).toBe("0.0000012300 USDT");
  expect(formatBuyerDate(new Date("2026-01-01T00:00:00Z"), "en")).toContain("2026");
  vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60000).toISOString());
  expect(displayUsdCents(250000, loadFxSnapshot())).toBe(BigInt(1563));
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 90000000).toISOString()); expect(displayUsdCents(250000, loadFxSnapshot())).toBeNull();
  vi.stubEnv("USD_IDR_RATE", ""); expect(displayUsdCents(250000, loadFxSnapshot())).toBeNull();
});

it("actual quote uses native country only, ignores forged body and preserves USD preference when FX unavailable", async () => {
  const fixture = createD1Fixture();
  try {
    await insertTestProduct(fixture.sql);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); vi.stubEnv("NOWPAYMENTS_ENABLED", "false"); vi.stubEnv("USD_IDR_RATE", "");
    const { POST } = await import("@/app/api/checkout/quote/route");
    const request = () => new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json", "cf-ipcountry": "ID" }, body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: 10000 }], locale: "id", currency: "IDR", country: "ID" }) });
    const res = await POST(request()); expect(res.status).toBe(200);
    const first = await res.json();
    expect(first.displayPreferences).toEqual({ locale: "en", currency: "USD", usdAvailable: false, usdCents: null });
    const { verifyCheckoutQuoteToken } = await import("@/lib/auth");
    expect((await verifyCheckoutQuoteToken(first.quoteToken))?.locale).toBe("en");
    cf.unavailable = true;
    const local = await POST(request()); expect(local.status).toBe(200);
    expect((await local.json()).displayPreferences).toEqual({ locale: "id", currency: "IDR", usdAvailable: false, usdCents: null });
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
    const fresh = await POST(request()); expect((await fresh.json()).displayPreferences).toMatchObject({ usdAvailable: true, usdCents: "63" });
  } finally { fixture.close(); }
});
