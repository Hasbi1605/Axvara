import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { checkGamesNickname } from "@/lib/games/nickname";
import { gamesRegistryGame, validateGamesFields } from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const schema = z.object({ slug: z.string().trim().min(1).max(40), fields: z.record(z.string(), z.union([z.string(), z.number()])) }).strict();

export async function POST(request: NextRequest) {
  const locale = pediaApiLocale(request);
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  const game = parsed.success ? gamesRegistryGame(parsed.data.slug) : null;
  const validated = game && parsed.success ? validateGamesFields(game, parsed.data.fields) : null;
  if (!game || !validated?.ok) return NextResponse.json({ status: "invalid", message: validated && !validated.ok
    ? validated.message[locale] : pick(locale, "Data akun tidak valid.", "The account details are invalid.") }, { headers: { "Cache-Control": "private, no-store" } });
  const cookie = request.cookies.get("axv_nck_device")?.value ?? "";
  const knownDevice = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cookie);
  const device = knownDevice ? cookie.toLowerCase() : crypto.randomUUID();
  const result = await checkGamesNickname(createDatabaseAccess(), game, validated.customerNo, request.headers.get("cf-connecting-ip") ?? "", device);
  const response = NextResponse.json(result.status === "invalid" ? { ...result, message: pick(locale, "ID tidak ditemukan", "ID not found") } : result,
    { headers: { "Cache-Control": "private, no-store" } });
  if (!knownDevice) response.cookies.set("axv_nck_device", device, { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
  return response;
}
