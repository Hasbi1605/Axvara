import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryFirst, execRun } from "@/lib/db";
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
  return NextResponse.json({ product: { id: String(row.id), slug: row.slug, name: row.name, description: row.description ?? "", price: row.price, comparePrice: row.compare_price ?? undefined, categorySlug: row.cat_slug as string, image: primary, images: images.slice(0,8), badge: row.badge as string ?? undefined, soldCount: row.sold_count as number ?? 0, stock: row.stock as number ?? -1, isActive: (row.is_active as number) !== 0, sortOrder: row.sort_order } });
}

const updateSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80).optional(),
  description: z.string().trim().max(2000).optional(),
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
  const existing = await queryFirst("SELECT id FROM products WHERE id=?", id) as { id: number } | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.price != null && data.comparePrice != null && data.comparePrice <= data.price) {
    return NextResponse.json({ error: "Harga coret harus lebih besar dari harga jual" }, { status: 400 });
  }
  const urlOk = (u: string) => {
    if (u.startsWith("/r2/")) return true;
    try { const url = new URL(u); return ["images.unsplash.com","picsum.photos","cdn.axvara.id"].includes(url.hostname) && url.protocol==="https:"; } catch { return false; }
  };
  if (data.images && data.images.some(u => !urlOk(u))) return NextResponse.json({ error: "URL gambar tidak diizinkan" }, { status: 400 });
  if (data.imageUrl && !urlOk(data.imageUrl)) return NextResponse.json({ error: "URL gambar utama tidak diizinkan" }, { status: 400 });
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = { name:"name", slug:"slug", description:"description", price:"price", comparePrice:"compare_price", imageUrl:"image_url", badge:"badge", soldCount:"sold_count", stock:"stock", isActive:"is_active", sortOrder:"sort_order" };
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
      else if (k==="comparePrice") { fields.push(`${col}=?`); vals.push(v ? Number(v) : null); }
      else { fields.push(`${col}=?`); vals.push(v); }
    }
  }
  if (data.images !== undefined) { fields.push("images=?"); vals.push(JSON.stringify(Array.isArray(data.images) ? data.images.slice(0,8) : [])); }
  if (fields.length) {
    fields.push("updated_at=datetime('now')");
    vals.push(id);
    try { await execRun(`UPDATE products SET ${fields.join(",")} WHERE id=?`, ...vals); }
    catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await execRun("DELETE FROM products WHERE id=?", id);
  return NextResponse.json({ ok: true });
}
