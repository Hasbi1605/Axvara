import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const row = db.prepare("SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?").get(params.id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const images: string[] = row.images ? JSON.parse(String(row.images)) : [];
  const primary = (row.image_url as string) ?? images[0] ?? "";
  return NextResponse.json({ product: { id: String(row.id), slug: row.slug, name: row.name, description: row.description ?? "", price: row.price, comparePrice: row.compare_price ?? undefined, categorySlug: row.cat_slug as string, image: primary, images: images.slice(0,8), badge: row.badge as string ?? undefined, soldCount: row.sold_count as number ?? 0, stock: row.stock as number ?? -1, isActive: (row.is_active as number) !== 0, sortOrder: row.sort_order } });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  const body = await req.json();
  const existing = db.prepare("SELECT id FROM products WHERE id=?").get(params.id) as { id: number } | undefined;
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = { name:"name", slug:"slug", description:"description", price:"price", comparePrice:"compare_price", imageUrl:"image_url", badge:"badge", soldCount:"sold_count", stock:"stock", isActive:"is_active", sortOrder:"sort_order" };
  if (body.categorySlug) {
    const cat = db.prepare("SELECT id FROM categories WHERE slug=?").get(body.categorySlug) as { id:number }|undefined;
    if (cat) { fields.push("category_id=?"); vals.push(cat.id); }
  }
  for (const [k,col] of Object.entries(map)) {
    if (body[k] !== undefined) {
      if (k==="isActive") { fields.push(`${col}=?`); vals.push(body[k] ? 1:0); }
      else if (k==="imageUrl") { fields.push(`${col}=?`); vals.push(body[k] ?? null); }
      else if (k==="comparePrice") { fields.push(`${col}=?`); vals.push(body[k] ? Number(body[k]) : null); }
      else fields.push(`${col}=?`), vals.push(body[k]);
    }
  }
  if (body.images !== undefined) { fields.push("images=?"); vals.push(JSON.stringify(Array.isArray(body.images) ? body.images.slice(0,8) : [])); }
  if (fields.length) { fields.push("updated_at=datetime('now')"); vals.push(params.id); db.prepare(`UPDATE products SET ${fields.join(",")} WHERE id=?`).run(...vals); }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const db = getDb();
  db.prepare("DELETE FROM products WHERE id=?").run(params.id);
  return NextResponse.json({ ok: true });
}
