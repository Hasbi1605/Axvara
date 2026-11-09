// POST /api/games/lookup — lacak pesanan Games dengan kode + kontak checkout.
// Respons generik anti-oracle; tanpa modal/margin/seller/kode cadangan.
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http-body";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { lookupGamesOrder } from "@/lib/games/lookup";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().trim().min(1).max(32),
  contact: z.string().trim().min(1).max(254),
});

export async function POST(req: NextRequest) {
  const locale = pediaApiLocale(req);
  const response = await lookup(req, locale);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function lookup(req: NextRequest, locale: ReturnType<typeof pediaApiLocale>) {
  if (!checkRateLimit(req, "games:lookup")) {
    return NextResponse.json({ error: pick(locale, "Terlalu sering, coba lagi 1 menit.", "Too many requests, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await readJsonBody(req, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: pick(locale, "Kode pesanan dan kontak checkout wajib diisi.", "Order code and checkout contact are required.") }, { status: 400 });
  }
  const code = parsed.data.code.trim().toUpperCase();
  if (!/^AXG-\d{8}-[A-Z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: pick(locale, "Format kode tidak valid.", "Invalid code format.") }, { status: 400 });
  }
  return lookupGamesOrder(code, parsed.data.contact, req);
}
