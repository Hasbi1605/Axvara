// POST /api/admin/games/products/bulk-markup — set markup dan/atau kategori
// untuk banyak varian sekaligus (docs/GAMES.md §14, packet G-BE B5).
//
// Keputusan G-BE (dokumentasi di evidence): kategori bulk memakai endpoint yang
// SAMA dengan `display_group` opsional, bukan endpoint saudara. Bulk kategori
// tidak boleh memaksa satu PATCH per SKU (1.644 baris = 1.644 request).
//
// Body: { skus: string[] (1–2000, "sk:<id>"), markup_percent?: number|null,
//         markup_fixed?: number|null, display_group?: kategori|null }
// Minimal satu dari markup_percent/markup_fixed/display_group harus ada.
// Markup dihitung ulang dalam SATU statement (parameter JSON via json_each).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { recomputeGamesSkPrices, writeVariantMarkup } from "@/lib/games/markup";
import { GAMES_DISPLAY_GROUP_VALUES } from "@/lib/games/variant-kind";
import { GAMES_MARKUP_MAX_FIXED, GAMES_MARKUP_MAX_PERCENT } from "@/lib/games/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const BULK_MARKUP_MAX_SKUS = 2000;

const percentSchema = z.number({ error: "Markup harus berupa angka." })
  .min(0, "Markup minimal 0%.").max(GAMES_MARKUP_MAX_PERCENT, "Markup maksimal 100%.")
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: "Markup maksimal 2 desimal." });

const fixedSchema = z.number({ error: "Markup tetap harus berupa angka." })
  .int("Markup tetap harus bilangan bulat.").min(0, "Markup tetap tidak boleh negatif.")
  .max(GAMES_MARKUP_MAX_FIXED, "Markup tetap terlalu besar.");

const schema = z.object({
  skus: z.array(z.string().trim().regex(/^sk:\d{1,18}$/, "Kode SKU harus sk:<id>."), { error: "skus wajib berupa array." })
    .min(1, "Pilih minimal 1 varian.").max(BULK_MARKUP_MAX_SKUS, `Maksimal ${BULK_MARKUP_MAX_SKUS} varian per permintaan.`),
  markup_percent: percentSchema.nullable().optional(),
  markup_fixed: fixedSchema.nullable().optional(),
  display_group: z.enum(GAMES_DISPLAY_GROUP_VALUES, { error: "Kategori tidak dikenal." }).nullable().optional(),
}).strict().refine(
  (value) => value.markup_percent !== undefined || value.markup_fixed !== undefined || value.display_group !== undefined,
  { message: "Tidak ada perubahan." },
);

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 64_000);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const error = issue?.code === "unrecognized_keys" ? "invalid_body" : issue?.message ?? "invalid_body";
    return NextResponse.json({ error, message: issue?.message ?? "Body tidak valid." }, { status: 400 });
  }
  const { display_group, markup_percent, markup_fixed } = parsed.data;
  const skus = [...new Set(parsed.data.skus)];
  const db = createDatabaseAccess();
  try {
    let changed = 0;
    const markupChanged = markup_percent !== undefined || markup_fixed !== undefined;
    if (display_group !== undefined) {
      const result = await db.execRun(
        `UPDATE games_products SET display_group=?, updated_at=datetime('now')
          WHERE supplier='sekalipay' AND buyer_sku_code IN (SELECT value FROM json_each(?))`,
        display_group, JSON.stringify(skus),
      );
      changed = Number(result.changes ?? 0);
    }
    if (markupChanged) {
      await writeVariantMarkup(db, skus, { percent: markup_percent, fixed: markup_fixed });
      changed = Math.max(changed, skus.length);
    }
    const repriced = markupChanged ? (await recomputeGamesSkPrices(db, { skus })).updated : 0;
    if (changed > 0 || repriced > 0) {
      const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
      await bumpCatalogRevision("games", db);
    }
    return NextResponse.json({ ok: true, updated: repriced, changed });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
