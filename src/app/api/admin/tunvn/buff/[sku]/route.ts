import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
// PATCH /api/admin/tunvn/buff/[sku] — kontrol admin varian Buff Muse.
// Mengatur markup per varian, harga manual (override, kosong = ikut rumus),
// dan status aktif varian. Harga rumus memakai FX tersimpan pada varian.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { isValidTunvnMarkup, tunvnBuffSellPriceIdr } from "@/lib/tunvn/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  markup_percent: z.number().optional(),
  admin_price_idr: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  is_active: z.boolean().optional(),
  label: z.string().trim().min(1).max(120).optional(),
}).strict().refine(
  (v) => ["markup_percent", "admin_price_idr", "is_active", "label"].some((k) => v[k as keyof typeof v] !== undefined),
  { message: "Tidak ada perubahan." },
);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ sku: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sku = (await params).sku;
  if (sku !== "TUNVN-BUFF-1B") return NextResponse.json({ error: "invalid_sku" }, { status: 400 });
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = patchSchema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", message: parsed.error.issues[0]?.message }, { status: 400 });
  const body = parsed.data;
  if (body.markup_percent !== undefined && !isValidTunvnMarkup(body.markup_percent)) {
    return NextResponse.json({ error: "invalid_markup", message: "Markup harus 0–1000%." }, { status: 400 });
  }
  const db = createDatabaseAccess();
  try {
    const variant = await db.queryFirst("SELECT * FROM product_variants WHERE sku=?", sku);
    if (!variant) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (body.is_active === true && await db.queryFirst("SELECT id FROM products WHERE id=? AND archived_at IS NOT NULL", variant.product_id)) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });
    const quantityB = Number(variant.tunvn_buff_quantity_b ?? 0);
    const markup = body.markup_percent !== undefined ? body.markup_percent : Number(variant.tunvn_markup_percent ?? 40);
    // 0 dari panel berarti "ikut rumus", bukan harga gratis; kolom override
    // disimpan NULL agar markup/kurs/modal kembali memengaruhi harga.
    const rawAdminPrice = body.admin_price_idr !== undefined
      ? body.admin_price_idr
      : (variant.tunvn_admin_price_idr ?? null);
    const adminPrice = rawAdminPrice === null || Number(rawAdminPrice) === 0 ? null : Number(rawAdminPrice);
    const fx = Number(variant.tunvn_fx_idr_per_usdt ?? 0);
    const cost = Number(variant.tunvn_cost_usdt ?? 0);
    const hasFx = Number.isFinite(fx) && fx > 0 && quantityB >= 1 && Number.isFinite(cost) && cost > 0;
    const sell = adminPrice !== null
      ? adminPrice
      : hasFx ? tunvnBuffSellPriceIdr(quantityB, fx, { markupPercent: markup, costUsdtPerB: cost / quantityB }) : null;
    if (sell === null && body.admin_price_idr !== undefined && adminPrice === null) {
      return NextResponse.json({ error: "fx_missing", message: "Kurs tersimpan belum ada; jalankan Publikasi sekali atau isi harga manual." }, { status: 409 });
    }
    // Varian + ringkasan produk induk dalam SATU batch, rumus sama dengan
    // PATCH /api/admin/tunvn/products/[id] (MIN harga aktif, stok -1 bila ada
    // varian aktif tanpa batas, selain itu SUM stok aktif).
    const d1 = db.d1;
    if (d1) {
      await d1.batch([
        d1.prepare(
          `UPDATE product_variants SET tunvn_markup_percent=?, tunvn_admin_price_idr=?,
             price=COALESCE(?, price), is_active=?, label=?, updated_at=datetime('now') WHERE sku=?`,
        ).bind(
          markup, adminPrice,
          sell,
          body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(variant.is_active ?? 0),
          body.label !== undefined ? body.label : String(variant.label),
          sku,
        ),
        d1.prepare(
          `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
             stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1) THEN -1
               ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
             updated_at=datetime('now') WHERE id=?`,
        ).bind(variant.product_id, variant.product_id, variant.product_id, variant.product_id),
      ]);
    } else {
      await db.execRun(
        `UPDATE product_variants SET tunvn_markup_percent=?, tunvn_admin_price_idr=?,
           price=COALESCE(?, price), is_active=?, label=?, updated_at=datetime('now') WHERE sku=?`,
        markup, adminPrice,
        sell,
        body.is_active !== undefined ? (body.is_active ? 1 : 0) : Number(variant.is_active ?? 0),
        body.label !== undefined ? body.label : String(variant.label),
        sku,
      );
      await db.execRun(
        `UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=? AND is_active=1),price),
           stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=? AND is_active=1 AND stock=-1) THEN -1
             ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=? AND is_active=1),0) END,
           updated_at=datetime('now') WHERE id=?`,
        variant.product_id, variant.product_id, variant.product_id, variant.product_id,
      );
    }
    const updated = await db.queryFirst("SELECT * FROM product_variants WHERE sku=?", sku);
    const { bumpCatalogRevision } = await import("@/lib/catalog-cache");
    await bumpCatalogRevision("market", db);
    return NextResponse.json({ ok: true, variant: updated });
  } catch (error) { if (String(error).includes("product_archived")) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
