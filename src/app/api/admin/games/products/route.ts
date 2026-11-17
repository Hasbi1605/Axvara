// /api/admin/games/products — daftar + edit SKU AXVARA Games (docs/GAMES.md §14).
// GET: item dengan margin, markup efektif/sumber, region, grup efektif, dan
// status sinkron. PATCH: enabled / kategori / urutan / markup varian.
// Harga referensi Oura sudah dipensiunkan (OD1); `reference_price` DITOLAK
// sebagai key asing (`invalid_body`) dan nilai lamanya dipertahankan sebagai
// histori. Markup efektif = varian → game (`games_meta`) → global.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import {
  effectiveGroup,
  gamesAdminPricingContext,
  gamesAdminSyncStatus,
  gamesMargin,
  listGamesProducts,
} from "@/lib/games/admin";
import { gamesAdminGames } from "@/lib/games/admin-games";
import {
  gamesEffectiveMarkup,
  gamesRowMarkupPrice,
  readVariantMarkupMap,
  writeVariantMarkup,
} from "@/lib/games/markup";
import { gamesSkAvailability, gamesSkContractSupported } from "@/lib/games/catalog";
import type { D1Statement } from "@/lib/db";
import { isGamesNicknameProduct } from "@/lib/games/sellable";
import { gamesNicknameSummary } from "@/lib/games/nickname";
import {
  GAMES_DISPLAY_GROUP_VALUES,
  gamesEffectiveCategory,
  gamesRegionCode,
  gamesRegionTypeNames,
} from "@/lib/games/variant-kind";
import { GAMES_MARKUP_MAX_FIXED, GAMES_MARKUP_MAX_PERCENT } from "@/lib/games/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const markupPercentSchema = z.number({ error: "Markup harus berupa angka." })
  .min(0, "Markup minimal 0%.").max(GAMES_MARKUP_MAX_PERCENT, "Markup maksimal 100%.")
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, { message: "Markup maksimal 2 desimal." });

const markupFixedSchema = z.number({ error: "Markup tetap harus berupa angka." })
  .int("Markup tetap harus bilangan bulat.").min(0, "Markup tetap tidak boleh negatif.")
  .max(GAMES_MARKUP_MAX_FIXED, "Markup tetap terlalu besar.");

const patchSchema = z.object({
  buyer_sku_code: z.string({ error: "Kode SKU wajib diisi." }).trim().min(1, "Kode SKU wajib diisi.").max(80, "Kode SKU terlalu panjang."),
  enabled: z.boolean({ error: "enabled harus boolean." }).optional(),
  display_group: z.enum(GAMES_DISPLAY_GROUP_VALUES, { error: "Kategori tidak dikenal." }).nullable().optional(),
  display_order: z.number({ error: "Urutan harus berupa angka." }).int("Urutan harus bilangan bulat.")
    .min(0, "Urutan tidak boleh negatif.").max(1_000_000, "Urutan terlalu besar.").nullable().optional(),
  markup_percent: markupPercentSchema.nullable().optional(),
  markup_fixed: markupFixedSchema.nullable().optional(),
}).strict().refine(
  (value) => ["enabled", "display_group", "display_order", "markup_percent", "markup_fixed"]
    .some((key) => value[key as keyof typeof value] !== undefined),
  { message: "Tidak ada perubahan." },
);

const intParam = (raw: string | null, fallback: number, min: number, max: number): number | null => {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
};

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const enabledRaw = params.get("enabled")?.trim() || null;
  if (enabledRaw !== null && enabledRaw !== "0" && enabledRaw !== "1") {
    return NextResponse.json({ error: "invalid_enabled", message: "enabled harus 0 atau 1." }, { status: 400 });
  }
  const limit = intParam(params.get("limit"), 50, 1, 200);
  const offset = intParam(params.get("offset"), 0, 0, 1_000_000);
  if (limit === null) return NextResponse.json({ error: "invalid_limit", message: "limit 1–200." }, { status: 400 });
  if (offset === null) return NextResponse.json({ error: "invalid_offset", message: "offset tidak valid." }, { status: 400 });
  const sellableRaw = params.get("sellable")?.trim() || null;
  if (sellableRaw !== null && sellableRaw !== "0" && sellableRaw !== "1") {
    return NextResponse.json({ error: "invalid_sellable", message: "sellable harus 0 atau 1." }, { status: 400 });
  }
  const sortRaw = params.get("sort")?.trim() || "default";
  if (sortRaw !== "default" && sortRaw !== "sellable") {
    return NextResponse.json({ error: "invalid_sort", message: "sort harus default atau sellable." }, { status: 400 });
  }
  const regionRaw = params.get("region")?.trim() || null;
  if (regionRaw !== null && !gamesRegionTypeNames(regionRaw)) {
    return NextResponse.json({ error: "invalid_region", message: "Region tidak dikenal." }, { status: 400 });
  }
  const db = createDatabaseAccess();
  try {
    const page = await listGamesProducts(db, {
      brand: params.get("brand"), q: params.get("q"),
      enabled: enabledRaw === null ? null : enabledRaw === "1",
      sellable: sellableRaw === null ? null : sellableRaw === "1",
      sort: sortRaw as "default" | "sellable",
      region: regionRaw,
      limit, offset,
    });
    const pricing = await gamesAdminPricingContext(db);
    const variantMarkup = await readVariantMarkupMap(db);
    const gamesPage = await gamesAdminGames(db);
    const sync = await gamesAdminSyncStatus(db);
    const nickname_checks = await gamesNicknameSummary(db);
    return NextResponse.json({
      ok: true,
      items: page.items.map((row) => {
        const gamePercent = pricing.gamePercent.get(String(row.game_slug ?? "").trim()) ?? null;
        const override = variantMarkup.get(String(row.buyer_sku_code ?? ""));
        const markup = gamesEffectiveMarkup(
          { markup_percent: override?.percent ?? null, markup_fixed: override?.fixed ?? null },
          gamePercent,
          pricing.settings,
        );
        return {
          ...row,
          effectiveGroup: effectiveGroup(row),
          category: gamesEffectiveCategory({
            displayGroup: row.display_group,
            productName: row.product_name,
            productTypeName: row.product_type_name,
          }),
          markup_source: markup.source,
          effective_markup_percent: markup.percent,
          markup_percent: override?.percent ?? null,
          markup_fixed: override?.fixed ?? 0,
          game_markup_percent: gamePercent,
          region: gamesRegionCode(row.product_type_name),
          margin: gamesMargin(row),
          contract_supported: gamesSkContractSupported(row),
          availability: gamesSkAvailability(row),
          sellable: row.enabled === 1 && row.supplier_active === 1 && (row.unlimited_stock === 1 || Number(row.stock) > 0),
        };
      }),
      total: page.total, limit: page.limit, offset: page.offset, brands: page.brands,
      // Ringkasan per game untuk tab "Game" (dipakai juga oleh StatCards admin).
      games: gamesPage.games,
      pricing: pricing.settings,
      sync, nickname_checks,
    });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await readJsonBody(request, 8_000);
  if (!body.ok) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Key asing (termasuk `reference_price` yang sudah dipensiunkan) = invalid_body.
    const error = issue?.code === "unrecognized_keys" ? "invalid_body" : issue?.message ?? "invalid_body";
    return NextResponse.json({ error, message: issue?.message ?? "Body tidak valid." }, { status: 400 });
  }
  const patch = parsed.data;
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  const d1 = db.d1;
  try {
    const current = await db.queryFirst(
      `SELECT buyer_sku_code, product_name, cost, seller_active, supplier, supplier_active, required_fields_json, game_slug
         FROM games_products WHERE buyer_sku_code=?`, patch.buyer_sku_code,
    );
    if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (String(current.supplier ?? "digiflazz") !== "sekalipay") {
      return NextResponse.json({
        error: "legacy_parked",
        message: "SKU Digiflazz bersifat legacy dan tidak dapat diubah dari panel katalog SK.",
      }, { status: 409 });
    }
    if (patch.enabled === true && (isGamesNicknameProduct(current) || Number(current.supplier_active) !== 1
      || Number(current.cost) <= 0 || !gamesSkContractSupported(current as unknown as Record<string, unknown>))) {
      return NextResponse.json(
        { error: "not_sellable", message: "SKU utilitas atau tanpa seller aktif/modal tidak bisa dijual." },
        { status: 409 },
      );
    }

    const statements: D1Statement[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.enabled !== undefined) { sets.push("enabled=?"); values.push(patch.enabled ? 1 : 0); }
    if (patch.display_group !== undefined) { sets.push("display_group=?"); values.push(patch.display_group); }
    if (patch.display_order !== undefined) { sets.push("display_order=?"); values.push(patch.display_order); }

    const markupChanged = patch.markup_percent !== undefined || patch.markup_fixed !== undefined;
    if (markupChanged) {
      const currentMarkup = await db.queryFirst(
        "SELECT markup_percent, markup_fixed FROM games_variant_markup WHERE buyer_sku_code=?",
        patch.buyer_sku_code,
      );
      const percent = patch.markup_percent !== undefined ? patch.markup_percent : asNumberOrNull(currentMarkup?.markup_percent);
      const fixed = patch.markup_fixed !== undefined ? patch.markup_fixed : asNumberOrNull(currentMarkup?.markup_fixed);
      const cost = Number(current.cost);
      if (cost > 0) {
        // Harga baru memakai markup efektif hasil PATCH (varian → game → global).
        const pricing = await gamesAdminPricingContext(db);
        const gamePercent = pricing.gamePercent.get(String(current.game_slug ?? "").trim()) ?? null;
        const price = gamesRowMarkupPrice(
          { cost, markup_percent: percent, markup_fixed: fixed },
          gamePercent,
          pricing.settings,
        );
        sets.push("sell_price=?");
        values.push(price);
      }
      // Override varian disimpan di tabel sendiri agar sinkron tidak menimpanya.
      await writeVariantMarkup(db, [patch.buyer_sku_code], { percent, fixed });
    }
    sets.push("updated_at=datetime('now')");
    statements.push(d1.prepare(
      `UPDATE games_products SET ${sets.join(", ")} WHERE buyer_sku_code=?`,
    ).bind(...values, patch.buyer_sku_code));

    await d1.batch(statements);
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("games", db);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
