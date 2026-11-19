import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
// PATCH /api/admin/tunvn/products/[id] — kontrol per produk mirror TUNVN.
// id = supplier_product_id. Revisi owner 15 Nov 2026: berlaku untuk SEMUA
// supplier id yang sudah dipetakan ke varian (bukan hanya 86/83). Varian
// diidentifikasi kolom tunvn_source_product_id; #60 (API TEST) ditolak.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { isTunvnExcludedProduct, tunvnDefaultDescription } from "@/lib/tunvn/families";
import { isValidTunvnMarkup, tunvnSellPriceIdr } from "@/lib/tunvn/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  markup_percent: z.number().min(0).max(1000).optional(),
  admin_price_idr: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
  admin_name: z.string().trim().max(160).nullable().optional(),
  admin_description: z.string().trim().max(4000).nullable().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "Tidak ada perubahan.");

const selectMirror = `SELECT id,supplier_product_id,name,description,price_vnd,price_usdt,stock,
  discount_threshold,discount_price_vnd,discount_threshold_usdt,discount_price_usdt,
  axvara_product_id,markup_percent,sell_price_idr,fx_idr_per_usdt,admin_name,admin_description,
  visible,synced_at,created_at,updated_at FROM tunvn_products WHERE supplier_product_id=?`;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supplierId = Number((await params).id);
  if (!Number.isSafeInteger(supplierId) || supplierId < 1) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  if (isTunvnExcludedProduct(supplierId)) return NextResponse.json({ error: "excluded_product" }, { status: 409 });
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = patchSchema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;
  if (body.markup_percent !== undefined && !isValidTunvnMarkup(body.markup_percent)) {
    return NextResponse.json({ error: "invalid_markup", message: "Markup harus 0–1000%." }, { status: 400 });
  }
  const db = createDatabaseAccess();
  try {
    const mirror = await db.queryFirst(selectMirror, supplierId);
    if (!mirror) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const variant = await db.queryFirst(
      "SELECT * FROM product_variants WHERE tunvn_source_product_id=? OR sku=? ORDER BY tunvn_source_product_id IS NULL LIMIT 1",
      supplierId, `TUNVN-${supplierId}`,
    );
    const variantWrites = body.admin_price_idr !== undefined || body.label !== undefined || body.is_active !== undefined;
    if (!variant && variantWrites) {
      return NextResponse.json({ error: "variant_missing", message: "Jalankan Sinkron dulu agar varian TUNVN ini dibuat." }, { status: 409 });
    }
    const product = variant
      ? await db.queryFirst("SELECT id, name, archived_at FROM products WHERE id=?", variant.product_id)
      : mirror.axvara_product_id
        ? await db.queryFirst("SELECT id, name, archived_at FROM products WHERE id=?", mirror.axvara_product_id)
        : null;

    if (product?.archived_at && body.is_active === true) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });

    const markup = body.markup_percent ?? Number(mirror.markup_percent ?? 35);
    // 0 dari panel berarti "ikut rumus", bukan harga gratis; kolom override
    // disimpan NULL agar markup/kurs/modal kembali memengaruhi harga.
    const rawAdminPrice = body.admin_price_idr !== undefined
      ? body.admin_price_idr
      : variant?.tunvn_admin_price_idr != null ? Number(variant.tunvn_admin_price_idr) : null;
    const adminPrice = rawAdminPrice === null || Number(rawAdminPrice) === 0 ? null : Number(rawAdminPrice);
    const fx = Number(mirror.fx_idr_per_usdt ?? 0);
    const cost = Number(mirror.price_usdt ?? 0);
    let sell: number | null = null;
    if (adminPrice !== null) sell = adminPrice;
    else if (fx > 0 && cost > 0) sell = tunvnSellPriceIdr(cost, fx, markup);

    const writes: [string, unknown[]][] = [[
      `UPDATE tunvn_products SET markup_percent=?,admin_name=?,admin_description=?,
         sell_price_idr=COALESCE(?,sell_price_idr),updated_at=datetime('now') WHERE supplier_product_id=?`,
      [markup,
        body.admin_name === undefined ? mirror.admin_name : body.admin_name || null,
        body.admin_description === undefined ? mirror.admin_description : body.admin_description || null,
        sell, supplierId],
    ]];
    if (product) {
      // Copy hanya berubah bila admin mengirimkannya; publish tidak menulis ulang.
      if (body.admin_name !== undefined) writes.push(["UPDATE products SET name=? WHERE id=?", [body.admin_name || String(product.name), product.id]]);
      if (body.admin_description !== undefined) writes.push(["UPDATE products SET description=? WHERE id=?", [body.admin_description || tunvnDefaultDescription(String(product.name)), product.id]]);
    }
    if (variant) {
      writes.push([
        `UPDATE product_variants SET label=?, tunvn_admin_price_idr=?,
           price=COALESCE(?,price), is_active=COALESCE(?,is_active), updated_at=datetime('now') WHERE id=?`,
        [body.label ?? String(variant.label), adminPrice, sell,
          body.is_active === undefined ? null : Number(body.is_active), variant.id],
      ]);
    }
    writes.push([
      `UPDATE tunvn_products SET visible=CASE WHEN EXISTS(
         SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
          WHERE pv.tunvn_source_product_id=tunvn_products.supplier_product_id AND pv.is_active=1 AND p.is_active=1 AND p.archived_at IS NULL
       ) THEN 1 ELSE 0 END WHERE supplier_product_id=?`,
      [supplierId],
    ]);
    if (product) {
      writes.push([
        `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1) THEN -1
             ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
           updated_at=datetime('now') WHERE id=?`,
        [product.id, product.id, product.id, product.id],
      ]);
    }
    if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
    await db.d1.batch(writes.map(([sql, values]) => db.d1!.prepare(sql).bind(...values)));
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
    return NextResponse.json({ ok: true, item: await db.queryFirst(selectMirror, supplierId), fx_missing: !(fx > 0) });
  } catch (error) { if (String(error).includes("product_archived")) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 }); return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
