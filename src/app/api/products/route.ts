import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.toLowerCase().trim() ?? "";
  const cat = searchParams.get("cat") ?? "";
  const active = searchParams.get("active");
  const isAdminRequest = !!(await import("@/lib/auth").then((m) => m.requireAdmin(req).catch(() => null)));

  let sql = `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE 1=1`;
  const params: unknown[] = [];
  // F08: public always is_active=1, admin can see all
  if (!isAdminRequest || active === "1") sql += ` AND p.is_active=1`;
  else if (active === "0") sql += ` AND p.is_active=0`;
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

const productSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug format invalid").min(3).max(80),
  description: z.string().trim().max(2000).optional().default(""),
  price: z.coerce.number().int().min(1000).max(999_999_999),
  comparePrice: z.coerce.number().int().min(1000).max(999_999_999).nullable().optional(),
  categorySlug: z.string().trim().max(40).optional().default("tools-pro"),
  imageUrl: z.string().trim().max(600).nullable().optional(),
  images: z.array(z.string().trim().max(600)).max(8).optional().default([]),
  badge: z.string().trim().max(32).nullable().optional(),
  soldCount: z.coerce.number().int().min(0).max(999999).optional().default(0),
  stock: z.coerce.number().int().min(-1).max(999999).optional().default(-1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional().default(0),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const { name, slug, description, price, comparePrice, categorySlug, imageUrl, images, badge, soldCount, stock, isActive, sortOrder } = parsed.data as z.infer<typeof productSchema> & { comparePrice?: number | null };

  if (comparePrice && comparePrice <= price) return NextResponse.json({ error: "Harga coret harus lebih besar dari harga jual" }, { status: 400 });

  const catRow = await queryFirst("SELECT id FROM categories WHERE slug=?", categorySlug ?? "tools-pro") as { id: number } | undefined;
  const category_id = catRow?.id ?? 3;
  const imgArr = Array.isArray(images) ? images.slice(0,8) : [];
  // F10: strict allowlist — only /r2/* or known CDNs
  const urlOk = (u: string) => {
    if (u.startsWith("/r2/")) return true;
    try {
      const url = new URL(u);
      return ["images.unsplash.com", "picsum.photos", "cdn.axvara.id"].includes(url.hostname) && url.protocol === "https:";
    } catch { return false; }
  };
  if (imgArr.some(u => !urlOk(u))) return NextResponse.json({ error: "URL gambar tidak diizinkan — hanya /r2/* atau CDN resmi" }, { status: 400 });
  if (imageUrl && !urlOk(imageUrl)) return NextResponse.json({ error: "URL gambar utama tidak diizinkan" }, { status: 400 });
  const primary = imageUrl ?? imgArr[0] ?? null;
  try {
    const res = await execRun(`INSERT INTO products (category_id,name,slug,description,price,compare_price,image_url,images,badge,sold_count,stock,is_active,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, category_id, name, slug, description ?? "", Number(price), comparePrice ? Number(comparePrice) : null, primary, JSON.stringify(imgArr), badge ?? null, soldCount ? Number(soldCount) : 0, stock != null ? Number(stock) : -1, isActive === false ? 0 : 1, sortOrder ? Number(sortOrder) : 0);
    return NextResponse.json({ id: res.lastInsertRowid });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
    console.error("500 src/app/api/products/route.ts :", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }
}
