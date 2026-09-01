import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryFirst, execRun } from "@/lib/db-edge";

export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.toLowerCase().trim() ?? "";
  const cat = searchParams.get("cat") ?? "";
  const active = searchParams.get("active");

  let sql = `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE 1=1`;
  const params: unknown[] = [];
  if (active === "1") { sql += ` AND p.is_active=1`; }
  if (cat && cat !== "semua") { sql += ` AND c.slug=?`; params.push(cat); }
  if (q) { sql += ` AND (lower(p.name) LIKE ? OR lower(p.description) LIKE ? OR lower(p.slug) LIKE ? OR lower(COALESCE(p.badge,'')) LIKE ?)`; const like=`%${q}%`; params.push(like,like,like,like); }
  sql += ` ORDER BY p.sort_order ASC, p.id ASC`;
  const rows = await queryAll(sql, ...params);
  const data = rows.map((r: Record<string, unknown>) => {
    const images: string[] = r.images ? JSON.parse(String(r.images)) : [];
    const primary = (r.image_url as string) ?? images[0] ?? "";
    if (primary && !images.includes(primary)) images.unshift(primary);
    return {
      id: String(r.id),
      slug: r.slug,
      name: r.name,
      description: r.description ?? "",
      price: r.price,
      comparePrice: r.compare_price ?? undefined,
      categorySlug: (r.cat_slug as string) ?? "tools-pro",
      image: primary,
      images: images.slice(0,8),
      badge: (r.badge as string) ?? undefined,
      soldCount: (r.sold_count as number) ?? 0,
      stock: (r.stock as number) ?? -1,
      isActive: (r.is_active as number) !== 0,
      sortOrder: r.sort_order,
    };
  });
  return NextResponse.json({ products: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, slug, description, price, comparePrice, categorySlug, imageUrl, images, badge, soldCount, stock, isActive, sortOrder } = body;
  if (!name || !slug || !price) return NextResponse.json({ error: "name, slug, price required" }, { status: 400 });
  const catRow = await queryFirst("SELECT id FROM categories WHERE slug=?", categorySlug ?? "tools-pro") as { id: number } | undefined;
  const category_id = catRow?.id ?? 3;
  const imgArr = Array.isArray(images) ? images.slice(0,8) : [];
  const primary = imageUrl ?? imgArr[0] ?? null;
  try {
    const res = await execRun(`INSERT INTO products (category_id,name,slug,description,price,compare_price,image_url,images,badge,sold_count,stock,is_active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, category_id, name, slug, description ?? "", Number(price), comparePrice ? Number(comparePrice) : null, primary, JSON.stringify(imgArr), badge ?? null, soldCount ? Number(soldCount) : 0, stock != null ? Number(stock) : -1, isActive === false ? 0 : 1, sortOrder ? Number(sortOrder) : 0);
    return NextResponse.json({ id: res.lastInsertRowid });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug already exists" }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
