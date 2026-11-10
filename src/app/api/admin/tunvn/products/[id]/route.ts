import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { tunvnDefaultDescription, TUNVN_CHATGPT_PRODUCTS } from "@/lib/tunvn/catalog";
import { tunvnChatGptSellPriceIdr } from "@/lib/tunvn/pricing";

export const runtime = "edge";
export const dynamic = "force-dynamic";
const patchSchema = z.object({
  markup_percent: z.number().min(0).max(1000).optional(),
  admin_name: z.string().trim().max(160).nullable().optional(),
  admin_description: z.string().trim().max(4000).nullable().optional(),
  publish_requested: z.boolean().optional(),
  axvara_is_active: z.boolean().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "Tidak ada perubahan.");

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdmin(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supplierId = Number((await params).id);
  if (!Number.isSafeInteger(supplierId) || supplierId < 1) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const raw = await readJsonBody(request);
  if (!raw.ok) return raw.response;
  const parsed = patchSchema.safeParse(raw.data);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const body = parsed.data;
  const db = createDatabaseAccess();
  try {
    const mirror = await db.queryFirst("SELECT * FROM tunvn_products WHERE supplier_product_id=?", supplierId);
    if (!mirror) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const spec = TUNVN_CHATGPT_PRODUCTS.find(p => p.supplier_product_id === supplierId);
    const product = spec ? await db.queryFirst("SELECT id,is_active FROM products WHERE slug='chatgpt-tunvn'") : null;
    if (spec && !product) return NextResponse.json({ error: "not_published" }, { status: 404 });
    if (!spec && (body.axvara_is_active !== undefined || body.publish_requested === true)) return NextResponse.json({ error: "not_publishable" }, { status: 409 });
    const requested = body.publish_requested === undefined ? Number(mirror.publish_requested ?? 0) : Number(body.publish_requested);
    const other = spec ? await db.queryFirst("SELECT publish_requested FROM tunvn_products WHERE supplier_product_id=?", supplierId === 86 ? 83 : 86) : null;
    if (body.axvara_is_active === true && !requested && Number(other?.publish_requested) !== 1) return NextResponse.json({ error: "publish_not_requested" }, { status: 409 });
    const markup = body.markup_percent ?? Number(mirror.markup_percent ?? 35);
    const fx = Number(mirror.fx_idr_per_usdt ?? 0);
    const variant = spec ? await db.queryFirst("SELECT tunvn_admin_price_idr FROM product_variants WHERE sku=?", `TUNVN-${supplierId}`) : null;
    const sell = Number(variant?.tunvn_admin_price_idr) > 0 ? Number(variant?.tunvn_admin_price_idr)
      : fx > 0 && Number(mirror.price_usdt) > 0 ? tunvnChatGptSellPriceIdr(Number(mirror.price_usdt), fx, markup) : null;
    const writes: [string, unknown[]][] = [[`UPDATE tunvn_products SET markup_percent=?,admin_name=?,admin_description=?,publish_requested=?,sell_price_idr=COALESCE(?,sell_price_idr),updated_at=datetime('now') WHERE supplier_product_id=?`,
      [markup, body.admin_name === undefined ? mirror.admin_name : body.admin_name || null, body.admin_description === undefined ? mirror.admin_description : body.admin_description || null, requested, sell, supplierId]]];
    if (product && spec) {
      // Only explicit copy changes own the shared product; publishing never rewrites it.
      if (body.admin_name !== undefined) writes.push(["UPDATE products SET name=? WHERE id=?", [body.admin_name || spec.name, product.id]]);
      if (body.admin_description !== undefined) writes.push(["UPDATE products SET description=? WHERE id=?", [body.admin_description || tunvnDefaultDescription(spec.name), product.id]]);
      if (body.axvara_is_active !== undefined) writes.push(["UPDATE products SET is_active=? WHERE id=?", [Number(body.axvara_is_active), product.id]]);
      writes.push([`UPDATE product_variants SET price=COALESCE(?,price),is_active=CASE WHEN ? IS NULL THEN is_active ELSE ? END WHERE sku=?`, [sell, body.publish_requested === undefined ? null : requested, requested, `TUNVN-${supplierId}`]]);
      writes.push([`UPDATE tunvn_products SET visible=CASE WHEN publish_requested=1 AND EXISTS(SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.sku='TUNVN-'||tunvn_products.supplier_product_id AND pv.is_active=1 AND p.is_active=1) THEN 1 ELSE 0 END WHERE supplier_product_id IN (86,83)`, []]);
    }
    if (!db.d1) return NextResponse.json({ error: "database_unavailable" }, { status: 503 });
    await db.d1.batch(writes.map(([sql, values]) => db.d1!.prepare(sql).bind(...values)));
    return NextResponse.json({ ok: true, item: await db.queryFirst("SELECT * FROM tunvn_products WHERE supplier_product_id=?", supplierId), fx_missing: !(fx > 0) });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
}
