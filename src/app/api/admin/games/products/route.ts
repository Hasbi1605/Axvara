// /api/admin/games/products — daftar + edit SKU AXVARA Games (docs/GAMES.md
// §12.7 P1–P3). GET: item dengan margin & grup efektif + status sinkron.
// PATCH: enabled / harga referensi (Oura) / override grup & urutan.
// `games_reference_prices` adalah sumber kebenaran harga pembanding; PATCH
// menulis tabel itu, menghitung ulang sell_price, lalu mencerminkan keduanya.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { computeGamesSellPrice } from "@/lib/games/pricing";
import { effectiveGroup, gamesAdminSyncStatus, gamesMargin, listGamesProducts } from "@/lib/games/admin";
import { gamesSkAvailability, gamesSkContractSupported } from "@/lib/games/catalog";
import type { D1Statement } from "@/lib/db";
import { isGamesNicknameProduct } from "@/lib/games/sellable";
import { gamesNicknameSummary } from "@/lib/games/nickname";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  buyer_sku_code: z.string({ error: "Kode SKU wajib diisi." }).trim().min(1, "Kode SKU wajib diisi.").max(80, "Kode SKU terlalu panjang."),
  enabled: z.boolean({ error: "enabled harus boolean." }).optional(),
  reference_price: z.number({ error: "Harga Oura harus berupa angka." }).int("Harga Oura harus bilangan bulat.")
    .positive("Harga Oura harus lebih dari 0.").max(1_000_000_000, "Harga Oura terlalu besar.").nullable().optional(),
  display_group: z.enum(["special", "bestseller"], { error: "Grup harus special, bestseller, atau null." }).nullable().optional(),
  display_order: z.number({ error: "Urutan harus berupa angka." }).int("Urutan harus bilangan bulat.")
    .min(0, "Urutan tidak boleh negatif.").max(1_000_000, "Urutan terlalu besar.").nullable().optional(),
}).strict().refine(
  (value) => ["enabled", "reference_price", "display_group", "display_order"].some((key) => value[key as keyof typeof value] !== undefined),
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
  const db = createDatabaseAccess();
  try {
    const page = await listGamesProducts(db, {
      brand: params.get("brand"), q: params.get("q"),
      enabled: enabledRaw === null ? null : enabledRaw === "1",
      limit, offset,
    });
    const sync = await gamesAdminSyncStatus(db);
    const nickname_checks = await gamesNicknameSummary(db);
    return NextResponse.json({
      ok: true,
      items: page.items.map((row) => ({ ...row, effectiveGroup: effectiveGroup(row), margin: gamesMargin(row), contract_supported: gamesSkContractSupported(row), availability: gamesSkAvailability(row) })),
      total: page.total, limit: page.limit, offset: page.offset, brands: page.brands, sync, nickname_checks,
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
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }
  const patch = parsed.data;
  const db = createDatabaseAccess();
  if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
  const d1 = db.d1;
  try {
    const current = await db.queryFirst(
      `SELECT buyer_sku_code, product_name, cost, seller_active, supplier, supplier_active, required_fields_json
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
    if (patch.reference_price !== undefined) {
      const reference = patch.reference_price;
      const now = new Date().toISOString();
      if (reference === null) {
        statements.push(d1.prepare(`DELETE FROM games_reference_prices WHERE buyer_sku_code=?`).bind(patch.buyer_sku_code));
      } else {
        statements.push(d1.prepare(
          `INSERT INTO games_reference_prices(buyer_sku_code,price,source,captured_at,updated_at) VALUES(?,?,?,?,?)
           ON CONFLICT(buyer_sku_code) DO UPDATE SET price=excluded.price, source=excluded.source,
             captured_at=excluded.captured_at, updated_at=excluded.updated_at`,
        ).bind(patch.buyer_sku_code, reference, "admin", now, now));
      }
      sets.push("reference_price=?");
      values.push(reference);
      // Modal 0 (baris belum tersinkron) tidak bisa dihitung: mirror saja.
      const cost = Number(current.cost);
      if (cost > 0) {
        sets.push("sell_price=?");
        values.push(computeGamesSellPrice({ cost, referencePrice: reference }).price);
      }
    }
    sets.push("updated_at=datetime('now')");
    statements.push(d1.prepare(
      `UPDATE games_products SET ${sets.join(", ")} WHERE buyer_sku_code=?`,
    ).bind(...values, patch.buyer_sku_code));

    await d1.batch(statements);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
