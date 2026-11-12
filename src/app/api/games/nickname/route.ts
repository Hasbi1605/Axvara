// POST /api/games/nickname — cek nickname varian Sekalipay (gratis).
// Jalur publik baru HANYA untuk SKU SK dengan `validation.available`; utilitas
// Digiflazz berbayar tidak lagi dipanggil dari route ini. Kegagalan supplier
// selalu `unavailable` dan tidak pernah memblokir checkout.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { checkSkGamesNickname } from "@/lib/games/nickname";
import { parseGamesSkContract, validateGamesSkTarget } from "@/lib/games/registry";
import { checkRateLimit } from "@/lib/rateLimit";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema = z.object({
  slug: z.string().trim().min(1).max(64),
  buyer_sku_code: z.string().trim().min(1).max(32).optional(),
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
}).strict();

export async function POST(request: NextRequest) {
  const locale = pediaApiLocale(request);
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success || !parsed.data.buyer_sku_code) {
    return NextResponse.json({ status: "invalid", message: pick(locale, "Data akun tidak valid.", "The account details are invalid.") },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  if (!checkRateLimit(request, "games:nickname_poll")) {
    return NextResponse.json({ status: "unavailable" }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "private, no-store" } });
  }
  const { slug, buyer_sku_code, fields } = parsed.data;
  const db = createDatabaseAccess();
  const product = await db.queryFirst(
    `SELECT buyer_sku_code, game_slug, supplier, enabled, supplier_active, required_fields_json
       FROM games_products WHERE buyer_sku_code=?`,
    buyer_sku_code,
  ).catch(() => null);
  const contract = product ? parseGamesSkContract(product.required_fields_json) : null;
  if (!product || String(product.supplier ?? "") !== "sekalipay" || Number(product.enabled) !== 1
    || Number(product.supplier_active) !== 1 || String(product.game_slug ?? "") !== slug) {
    return NextResponse.json({ error: "not_sellable" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const target = contract ? validateGamesSkTarget(contract, fields) : null;
  if (!contract || !target?.ok) {
    return NextResponse.json({ status: "invalid", message: pick(locale, "Data akun tidak valid.", "The account details are invalid.") },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  if (!contract.validation_available) {
    return NextResponse.json({ status: "unavailable" }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const variantId = Number(String(product.buyer_sku_code).replace(/^sk:/, ""));
  const cookie = request.cookies.get("axv_nck_device")?.value ?? "";
  const knownDevice = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cookie);
  const device = knownDevice ? cookie.toLowerCase() : crypto.randomUUID();
  const result = await checkSkGamesNickname(db, {
    variantId,
    contract,
    target: target.target,
    display: target.display,
    device,
  });
  const response = NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  if (!knownDevice) response.cookies.set("axv_nck_device", device, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  return response;
}
