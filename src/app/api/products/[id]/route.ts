import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun, getD1, isD1Mode } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await queryFirst("SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const images: string[] = row.images ? JSON.parse(String(row.images)) : [];
  const primary = (row.image_url as string) ?? images[0] ?? "";
  let aliases: string[] = [];
  try { aliases = row.aliases ? JSON.parse(String(row.aliases)) : []; } catch { aliases = []; }
  return NextResponse.json({ product: { id: String(row.id), slug: row.slug, name: row.name, whatsappAlias: String(row.whatsapp_alias || "").trim() || undefined, aliases, description: row.description ?? "", price: row.price, comparePrice: row.compare_price ?? undefined, categorySlug: row.cat_slug as string, image: primary, images: images.slice(0,8), badge: row.badge as string ?? undefined, soldCount: row.sold_count as number ?? 0, stock: row.stock as number ?? -1, isActive: (row.is_active as number) !== 0, sortOrder: row.sort_order } });
}

const updateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
  whatsappAlias: z.string().trim().max(50).nullable().optional(),
  price: z.coerce.number().int().min(1000).max(999_999_999).optional(),
  comparePrice: z.coerce.number().int().min(1000).max(999_999_999).nullable().optional(),
  categorySlug: z.string().trim().max(40).optional(),
  imageUrl: z.string().trim().max(600).nullable().optional(),
  images: z.array(z.string().trim().max(600)).max(8).optional(),
  badge: z.string().trim().max(32).nullable().optional(),
  soldCount: z.coerce.number().int().min(0).max(999999).optional(),
  stock: z.coerce.number().int().min(-1).max(999999).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
}).strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const data = parsed.data;
  const existing = await queryFirst(
    "SELECT id, price, compare_price, stock FROM products WHERE id=?",
    id,
  ) as { id: number; price: number; compare_price: number | null; stock: number } | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.isActive === true && isD1Mode()) {
    const activeVariant = await queryFirst(
      "SELECT id FROM product_variants WHERE product_id=? AND is_active=1 LIMIT 1",
      id,
    );
    if (!activeVariant) {
      return NextResponse.json(
        { error: "Aktifkan minimal satu varian sebelum mengaktifkan produk." },
        { status: 409 },
      );
    }
  }
  const nextPrice = data.price ?? Number(existing.price);
  const nextComparePrice = data.comparePrice !== undefined
    ? data.comparePrice
    : existing.compare_price;
  if (nextComparePrice != null && nextComparePrice <= nextPrice) {
    return NextResponse.json({ error: "Harga coret harus lebih besar dari harga jual" }, { status: 400 });
  }
  const variantSummary = isD1Mode()
    ? await queryFirst(
        `SELECT COUNT(*) as variant_count,
                MAX(CASE WHEN sku LIKE 'DEFAULT-%' THEN id END) as default_variant_id
         FROM product_variants WHERE product_id=?`,
        id,
      )
    : null;
  const defaultVariant = Number(variantSummary?.variant_count || 0) === 1
    && variantSummary?.default_variant_id
    ? Number(variantSummary.default_variant_id)
    : null;
  const changesLegacyCommerceFields =
    (data.price !== undefined && Number(data.price) !== Number(existing.price))
    || (data.comparePrice !== undefined && (data.comparePrice ?? null) !== (existing.compare_price ?? null))
    || (data.stock !== undefined && Number(data.stock) !== Number(existing.stock));
  if (isD1Mode() && changesLegacyCommerceFields && !defaultVariant) {
    return NextResponse.json(
      { error: "Harga dan stok dikelola per varian. Gunakan tombol Varian pada produk ini." },
      { status: 409 },
    );
  }
  const urlOk = (u: string) => {
    if (u.startsWith("/r2/")) return true;
    try { const url = new URL(u); return ["images.unsplash.com","picsum.photos"].includes(url.hostname) && url.protocol==="https:"; } catch { return false; }
  };
  if (data.images && data.images.some(u => !urlOk(u))) return NextResponse.json({ error: "URL gambar tidak diizinkan" }, { status: 400 });
  if (data.imageUrl && !urlOk(data.imageUrl)) return NextResponse.json({ error: "URL gambar utama tidak diizinkan" }, { status: 400 });
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = { name:"name", slug:"slug", description:"description", whatsappAlias:"whatsapp_alias", price:"price", comparePrice:"compare_price", imageUrl:"image_url", badge:"badge", soldCount:"sold_count", stock:"stock", isActive:"is_active", sortOrder:"sort_order" };
  if (data.categorySlug) {
    const cat = await queryFirst("SELECT id FROM categories WHERE slug=?", data.categorySlug) as { id:number }|undefined;
    if (cat) { fields.push("category_id=?"); vals.push(cat.id); }
    else return NextResponse.json({ error: "Kategori tidak dikenal" }, { status: 400 });
  }
  for (const [k,col] of Object.entries(map)) {
    const v = (data as Record<string, unknown>)[k];
    if (v !== undefined) {
      if (k==="isActive") { fields.push(`${col}=?`); vals.push(v ? 1:0); }
      else if (k==="imageUrl") { fields.push(`${col}=?`); vals.push((v as string | null) ?? null); }
      else if (k==="whatsappAlias") { fields.push(`${col}=?`); vals.push(String(v || "").trim() || null); }
      else if (k==="comparePrice") { fields.push(`${col}=?`); vals.push(v ? Number(v) : null); }
      else { fields.push(`${col}=?`); vals.push(v); }
    }
  }
  if (data.images !== undefined) { fields.push("images=?"); vals.push(JSON.stringify(Array.isArray(data.images) ? data.images.slice(0,8) : [])); }
  if (fields.length) {
    fields.push("updated_at=datetime('now')");
    try {
      const d1 = getD1();
      if (d1) {
        const statements = [
          d1.prepare(`UPDATE products SET ${fields.join(",")} WHERE id=?`).bind(...vals, id),
        ];
        if (defaultVariant && changesLegacyCommerceFields) {
          const variantFields: string[] = [];
          const variantValues: unknown[] = [];
          if (data.price !== undefined) { variantFields.push("price=?"); variantValues.push(data.price); }
          if (data.comparePrice !== undefined) { variantFields.push("compare_price=?"); variantValues.push(data.comparePrice ?? null); }
          if (data.stock !== undefined) { variantFields.push("stock=?"); variantValues.push(data.stock); }
          variantFields.push("updated_at=datetime('now')");
          statements.push(
            d1.prepare(`UPDATE product_variants SET ${variantFields.join(",")} WHERE id=?`).bind(
              ...variantValues,
              defaultVariant,
            ),
          );
        }
        await d1.batch(statements);
      } else {
        await execRun(`UPDATE products SET ${fields.join(",")} WHERE id=?`, ...vals, id);
      }
    }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
      console.error("500 src/app/api/products/[id]/route.ts :", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const product = await queryFirst("SELECT id FROM products WHERE id=?", id);
  if (!product) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d1 = getD1();
  if (d1) {
    // Variants and historical orders reference the product graph. Archive it
    // instead of issuing a FK-breaking hard delete.
    await d1.batch([
      d1.prepare("UPDATE products SET is_active=0, updated_at=datetime('now') WHERE id=?").bind(id),
      d1.prepare("UPDATE product_variants SET is_active=0, updated_at=datetime('now') WHERE product_id=?").bind(id),
    ]);
    return NextResponse.json({ ok: true, action: "archived" });
  }
  await execRun("DELETE FROM products WHERE id=?", id);
  return NextResponse.json({ ok: true });
}
