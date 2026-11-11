import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveBuyerPreferences, preferenceCookie } from "@/lib/i18n/locale";
import { pediaApiLocale } from "@/lib/pedia/api-locale";
import { loadFxSnapshot } from "@/lib/payments/fx";
import { displayUsdCents, formatIdr, formatUsdCents, formatCryptoAmount, formatBuyerDate } from "@/lib/i18n/format";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const cf = vi.hoisted(() => ({ country: "US" as string | undefined, unavailable: false }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => { if (cf.unavailable) throw new Error("no context"); return { cf: { country: cf.country } }; } }));
afterEach(() => { vi.unstubAllEnvs(); cf.country = "US"; cf.unavailable = false; });

it("resolves independent cookies with fixed Indonesia/IDR defaults", () => {
  expect(resolveBuyerPreferences("axv_locale=id; axv_currency=USD")).toEqual({ locale: "id", currency: "USD" });
  expect(resolveBuyerPreferences("axv_locale=en")).toEqual({ locale: "en", currency: "IDR" });
  expect(resolveBuyerPreferences("axv_locale=%zz; axv_locale=en; axv_currency=bad; axv_currency=USD")).toEqual({ locale: "en", currency: "USD" });
  for (const invalid of ["", "axv_locale=%zz; axv_currency=bad", undefined]) {
    expect(resolveBuyerPreferences(invalid)).toEqual({ locale: "id", currency: "IDR" });
  }
  expect(resolveBuyerPreferences("axv_currency=USD")).toEqual({ locale: "id", currency: "USD" });
  expect(preferenceCookie("axv_currency", "USD", true)).toBe("axv_currency=USD; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
});

it("Pedia ignores browser language without overriding a manual choice", () => {
  const request = (cookie = "") => new NextRequest("https://axvara.tech/api/pedia/quote", { headers: { "accept-language": "en-US,en;q=0.9", cookie } });
  expect(pediaApiLocale(request())).toBe("id");
  expect(pediaApiLocale(request("axv_locale=invalid"))).toBe("id");
  expect(pediaApiLocale(request("axv_locale=en"))).toBe("en");
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

it("actual quote ignores browser language/country/body and preserves explicit preferences", async () => {
  const fixture = createD1Fixture();
  try {
    await insertTestProduct(fixture.sql);
    vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "false"); vi.stubEnv("NOWPAYMENTS_ENABLED", "false"); vi.stubEnv("USD_IDR_RATE", "");
    const { POST } = await import("@/app/api/checkout/quote/route");
    const request = (cookie = "") => new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json", "cf-ipcountry": "US", "accept-language": "en-US", cookie }, body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1, expected_price: 10000 }], locale: "en", currency: "USD", country: "US" }) });
    const res = await POST(request()); expect(res.status).toBe(200);
    const first = await res.json();
    expect(first.displayPreferences).toEqual({ locale: "id", currency: "IDR", usdAvailable: false, usdCents: null });
    const { verifyCheckoutQuoteToken } = await import("@/lib/auth");
    expect((await verifyCheckoutQuoteToken(first.quoteToken))?.locale).toBe("id");
    const manual = await POST(request("axv_locale=en; axv_currency=USD")); expect(manual.status).toBe(200);
    const chosen = await manual.json();
    expect(chosen.displayPreferences).toEqual({ locale: "en", currency: "USD", usdAvailable: false, usdCents: null });
    expect((await verifyCheckoutQuoteToken(chosen.quoteToken))?.locale).toBe("en");
    cf.unavailable = true;
    const local = await POST(request()); expect(local.status).toBe(200);
    expect((await local.json()).displayPreferences).toEqual({ locale: "id", currency: "IDR", usdAvailable: false, usdCents: null });
    vi.stubEnv("USD_IDR_RATE", "16000"); vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 1000).toISOString());
    const fresh = await POST(request()); expect((await fresh.json()).displayPreferences).toMatchObject({ usdAvailable: true, usdCents: "63" });
  } finally { fixture.close(); }
});
