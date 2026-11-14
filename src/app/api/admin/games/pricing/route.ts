// GET/PUT /api/admin/games/pricing — markup default + pembulatan harga Games
// (keputusan owner OD1, docs/GAMES.md §14). PUT menyimpan setting lalu
// menghitung ulang SEMUA harga Sekalipay dalam satu statement.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { GAMES_MARKUP_MAX_PERCENT, GAMES_PRICE_ROUNDINGS } from "@/lib/games/pricing";
import {
  readGamesPricingSettings,
  recomputeGamesSkPrices,
  writeGamesPricingSettings,
} from "@/lib/games/markup";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const putSchema = z.object({
  markup_percent: z.number({ error: "Markup default harus berupa angka." })
    .min(0, "Markup minimal 0%.").max(GAMES_MARKUP_MAX_PERCENT, "Markup maksimal 100%.")
    .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: "Markup maksimal 2 desimal." })
    .optional(),
  rounding: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1000)], {
    error: `Pembulatan harus ${GAMES_PRICE_ROUNDINGS.join("/")}.`,
  }).optional(),
}).strict().refine(
  (value) => value.markup_percent !== undefined || value.rounding !== undefined,
  { message: "Tidak ada perubahan." },
);

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await readGamesPricingSettings(createDatabaseAccess());
  return NextResponse.json({ ok: true, ...settings });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 2_000);
  if (!body.ok) return body.response;
  const parsed = putSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({
      error: "invalid_body",
      message: parsed.error.issues[0]?.message ?? "Body tidak valid.",
    }, { status: 400 });
  }
  const db = createDatabaseAccess();
  try {
    const current = await readGamesPricingSettings(db);
    const settings = {
      markup_percent: parsed.data.markup_percent ?? current.markup_percent,
      rounding: parsed.data.rounding ?? current.rounding,
    };
    await writeGamesPricingSettings(db, settings);
    const { updated } = await recomputeGamesSkPrices(db, { all: true }, settings);
    return NextResponse.json({ ok: true, ...settings, updated });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
