// PATCH /api/admin/tunvn/products/[id] — kontrol admin per produk TUNVN.
// id = supplier_product_id. Mengatur: markup, nama/deskripsi publik, dan
// permintaan terbit. Harga dihitung ulang dari FX tersimpan terakhir (panel
// menampilkan kursnya); aktivasi publik tetap dua lapis (permintaan terbit +
// produk Market aktif) agar tidak ada produk tampil tanpa sengaja.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { tunvnDefaultDescription, TUNVN_CHATGPT_PRODUCTS } from "@/lib/tunvn/catalog";
import { isValidTunvnMarkup, tunvnChatGptSellPriceIdr } from "@/lib/tunvn/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  markup_percent: z.number().optional(),
  admin_name: z.string().trim().max(160).nullable().optional(),
  admin_description: z.string().trim().max(4000).nullable().optional(),
  publish_requested: z.boolean().optional(),
  axvara_is_active: z.boolean().optional(),
}).strict().refine(
  (v) => ["markup_percent", "admin_name", "admin_description", "publish_requested", "axvara_is_active"].some((k) => v[k as keyof typeof v] !== undefined),
  { message: "Tidak ada perubahan." },
);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supplierId = Number((await params).id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = patchSchema.safeParse(await readJsonBody(request).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body", message: parsed.error.issues[0]?.message }, { status: 400 });
  const body = parsed.data;
  if (body.markup_percent !== undefined && !isValidTunvnMarkup(body.markup_percent)) {
    return NextResponse.json({ error: "invalid_markup", message: "Markup harus 0–1000%." }, { status: 400 });
  }

  const db = createDatabaseAccess();
  try {
    const mirror = await db.queryFirst("SELECT * FROM tunvn_products WHERE supplier_product_id=?", supplierId);
    if (!mirror) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const spec = TUNVN_CHATGPT_PRODUCTS.find((p) => p.supplier_product_id === supplierId);

    const markup = body.markup_percent !== undefined ? body.markup_percent : Number(mirror.markup_percent ?? 35);
    const requested = body.publish_requested !== undefined ? (body.publish_requested ? 1 : 0) : Number(mirror.publish_requested ?? 0);
    const fx = Number(mirror.fx_idr_per_usdt ?? 0);
    const hasFx = Number.isFinite(fx) && fx > 0;
    const sell = mirror.price_usdt !== null && hasFx
      ? tunvnChatGptSellPriceIdr(Number(mirror.price_usdt), fx, markup) : null;

    await db.execRun(
      `UPDATE tunvn_products SET markup_percent=?, admin_name=?, admin_description=?, publish_requested=?,
         sell_price_idr=COALESCE(?, sell_price_idr), updated_at=datetime('now') WHERE supplier_product_id=?`,
      markup,
      body.admin_name !== undefined ? (body.admin_name || null) : (mirror.admin_name ?? null),
      body.admin_description !== undefined ? (body.admin_description || null) : (mirror.admin_description ?? null),
      requested, sell, supplierId,
    );

    // Terapkan ke produk Market terbit (bila sudah dibuat publish/seed).
    let productId = mirror.axvara_product_id !== null && mirror.axvara_product_id !== undefined ? Number(mirror.axvara_product_id) : 0;
    if (!productId && spec) {
      const bySlug = await db.queryFirst("SELECT id FROM products WHERE slug=?", spec.slug);
      productId = bySlug ? Number(bySlug.id) : 0;
      if (productId) await db.execRun("UPDATE tunvn_products SET axvara_product_id=? WHERE supplier_product_id=?", productId, supplierId);
    }
    if (productId && spec) {
      const displayName = String(body.admin_name !== undefined ? body.admin_name : mirror.admin_name || "").trim() || spec.name;
      const displayDescription = String(body.admin_description !== undefined ? body.admin_description : mirror.admin_description || "").trim() || tunvnDefaultDescription(spec.label);
      if (body.axvara_is_active === true && requested !== 1) {
        return NextResponse.json({ error: "publish_not_requested", message: "Nyalakan permintaan terbit sebelum mengaktifkan produk." }, { status: 409 });
      }
      const activate = body.axvara_is_active !== undefined ? (body.axvara_is_active ? 1 : 0) : null;
      await db.execRun(
        `UPDATE products SET name=?, description=?, price=COALESCE(?, price),
           is_active=CASE WHEN ? = 0 THEN 0 ELSE COALESCE(?, is_active) END, updated_at=datetime('now') WHERE id=?`,
        displayName, displayDescription, sell, requested, activate, productId,
      );
      const productState = await db.queryFirst("SELECT is_active FROM products WHERE id=?", productId);
      const productActive = Number(productState?.is_active ?? 0) === 1;
      await db.execRun(
        `UPDATE product_variants SET price=COALESCE(?, price),
           is_active=CASE WHEN ? = 1 AND ? = 1 THEN is_active ELSE 0 END, updated_at=datetime('now') WHERE sku=?`,
        sell, requested, productActive ? 1 : 0, `TUNVN-${supplierId}`,
      );
      if (requested === 1 && productActive && body.axvara_is_active === true) {
        await db.execRun("UPDATE product_variants SET is_active=1, updated_at=datetime('now') WHERE sku=?", `TUNVN-${supplierId}`);
      }
      const variantState = await db.queryFirst("SELECT is_active FROM product_variants WHERE sku=?", `TUNVN-${supplierId}`);
      const visible = requested === 1 && productActive && Number(variantState?.is_active ?? 0) === 1 ? 1 : 0;
      await db.execRun("UPDATE tunvn_products SET visible=? WHERE supplier_product_id=?", visible, supplierId);
    } else if (requested === 0) {
      await db.execRun("UPDATE tunvn_products SET visible=0 WHERE supplier_product_id=?", supplierId);
    }

    const updated = await db.queryFirst("SELECT * FROM tunvn_products WHERE supplier_product_id=?", supplierId);
    return NextResponse.json({ ok: true, item: updated, fx_missing: !hasFx });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }
}
