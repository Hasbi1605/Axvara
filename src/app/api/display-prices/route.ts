// POST /api/display-prices — DISPLAY-ONLY IDR -> USD cents for the web catalog.
// Never a quote, price authority or payment input: quote/orders/invoices stay
// immutable and the checkout quote remains the only source of payable amounts.
// No DB, no provider, no secrets, no cookies set. Preference resolution uses
// only explicit cookies, otherwise Indonesia/IDR. One FX snapshot per request.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/http-body";
import { checkRateLimit } from "@/lib/rateLimit";
import { resolveBuyerPreferences } from "@/lib/i18n/locale";
import { displayUsdCents } from "@/lib/i18n/format";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const MAX_AMOUNTS = 64;
// Ceiling = what idrToUsdCents accepts (non-negative safe integer; BigInt math).
const amountSchema = z.number().refine((value) => Number.isSafeInteger(value) && value >= 0);
const schema = z.object({ amounts: z.array(amountSchema).min(1).max(MAX_AMOUNTS) }).strict();

function privacyHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "Cache-Control": "private, no-store", Vary: "Cookie", ...extra };
}
function fail(error: string, status: number, extra?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: privacyHeaders(extra) });
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "display:prices")) {
    return fail("rate_limited", 429, { "Retry-After": "60" });
  }
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body.ok) {
    for (const [name, value] of Object.entries(privacyHeaders())) body.response.headers.set(name, value);
    return body.response;
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return fail("invalid_amounts", 400);

  const preferences = resolveBuyerPreferences(req.headers.get("cookie"));
  const fx = await loadCurrentFxSnapshot();
  return NextResponse.json({
    locale: preferences.locale,
    currency: preferences.currency,
    fx: { available: fx !== null, effectiveAt: fx?.effectiveAt ?? null },
    items: parsed.data.amounts.map((idr) => ({ idr, usdCents: displayUsdCents(idr, fx)?.toString() ?? null })),
  }, { headers: privacyHeaders() });
}
