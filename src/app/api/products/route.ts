import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun, getD1, isD1Mode } from "@/lib/db";
import { isVariantsReadEnabled } from "@/lib/catalog";
import { requireAdmin } from "@/lib/auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

export const runtime = "edge";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.toLowerCase().trim() ?? "";
  const cat = searchParams.get("cat") ?? "";
  const active = searchParams.get("active");
  // The explicit active=1 path is public and always returns the same safe
  // subset, so it can skip auth work and be cached independently.
  const isPublicCatalog = active === "1";
  const variantCatalog = isPublicCatalog && isD1Mode() && isVariantsReadEnabled();
  const isAdminRequest = isPublicCatalog
    ? false
    : !!(await import("@/lib/auth").then((m) => m.requireAdmin(req).catch(() => null)));

  let sql = variantCatalog
    ? `SELECT p.*, c.slug as cat_slug,
              MIN(pv.price) as min_price,
              MAX(pv.price) as max_price,
              COUNT(pv.id) as variant_count,
              CASE
                WHEN MAX(CASE WHEN pv.stock=-1 THEN 1 ELSE 0 END)=1 THEN -1
                ELSE SUM(CASE WHEN pv.stock>0 THEN pv.stock ELSE 0 END)
              END as variant_stock,
              MIN(pv.compare_price) as variant_compare_price
       FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       INNER JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=1
       WHERE 1=1`
    : `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE 1=1`;
  const params: unknown[] = [];
  // F08: public always is_active=1, admin can see all
  if (!isAdminRequest || active === "1") sql += ` AND p.is_active=1`;
  else if (active === "0") sql += ` AND p.is_active=0`;
  if (cat && cat !== "semua") { sql += ` AND c.slug=?`; params.push(cat); }
  if (q) { sql += ` AND (lower(p.name) LIKE ? OR lower(p.description) LIKE ? OR lower(p.slug) LIKE ? OR lower(COALESCE(p.badge,'')) LIKE ?)`; const like=`%${q}%`; params.push(like,like,like,like); }
  if (variantCatalog) sql += ` GROUP BY p.id`;
  sql += ` ORDER BY p.sort_order ASC, p.id ASC`;
  const rows = await queryAll(sql, ...params);
  const data = rows.map((r: Record<string, unknown>) => {
    let images: string[] = [];
    let aliases: string[] = [];
    try { images = r.images ? JSON.parse(String(r.images)) : []; } catch { images = []; }
    try { aliases = r.aliases ? JSON.parse(String(r.aliases)) : []; } catch { aliases = []; }
    const primary = (r.image_url as string) ?? images[0] ?? "";
    if (primary && !images.includes(primary)) images.unshift(primary);
    const variantCount = variantCatalog ? Number(r.variant_count || 0) : undefined;
    const price = variantCatalog ? Number(r.min_price) : Number(r.price);
    return {
      id: String(r.id),
      slug: r.slug,
      name: r.name,
      whatsappAlias: String(r.whatsapp_alias || "").trim() || undefined,
      aliases: Array.isArray(aliases) ? aliases.map(String) : [],
      description: r.description ?? "",
      price,
      minPrice: variantCatalog ? Number(r.min_price) : undefined,
      maxPrice: variantCatalog ? Number(r.max_price) : undefined,
      variantCount,
      comparePrice: variantCatalog && variantCount === 1
        ? (r.variant_compare_price == null ? undefined : Number(r.variant_compare_price))
        : r.compare_price ?? undefined,
      categorySlug: (r.cat_slug as string) ?? "tools-pro",
      image: primary,
      images: images.slice(0,8),
      badge: (r.badge as string) ?? undefined,
      soldCount: (r.sold_count as number) ?? 0,
      stock: variantCatalog ? Number(r.variant_stock ?? 0) : (r.stock as number) ?? -1,
      isActive: (r.is_active as number) !== 0,
      sortOrder: r.sort_order,
    };
  });
  return NextResponse.json(
    { products: data },
    {
      headers: {
        "Cache-Control": isPublicCatalog
          ? "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
          : "private, no-store, max-age=0",
      },
    }
  );
}

const variantInputSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  sku: z.string().trim().min(1).max(50).optional(),
  label: z.string().trim().min(1).max(100),
  price: z.coerce.number().int().min(0).max(999_999_999),
  comparePrice: z.coerce.number().int().min(0).max(999_999_999).nullable().optional(),
  stock: z.coerce.number().int().min(-1).max(999999).default(-1),
  duration_value: z.coerce.number().int().nonnegative().nullable().optional(),
  duration_unit: z.enum(["day", "month", "year", "lifetime", "custom"]).nullable().optional(),
  duration_label: z.string().trim().max(100).nullable().optional(),
  warranty_type: z.enum(["none", "limited", "full", "custom"]).default("none"),
  warranty_value: z.coerce.number().int().nonnegative().nullable().optional(),
  warranty_unit: z.enum(["day", "month", "year", "lifetime"]).nullable().optional(),
  warranty_label: z.string().trim().max(100).nullable().optional(),
  fulfillment_mode: z.enum(["manual", "shared", "unique"]).default("manual"),
  is_active: z.coerce.number().int().min(0).max(1).default(1),
  sort_order: z.coerce.number().int().min(0).max(999999).default(0),
});

const productSchema = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug format invalid").min(3).max(80),
  description: z.string().trim().max(2000).optional().default(""),
  whatsappAlias: z.string().trim().max(50).nullable().optional(),
  price: z.coerce.number().int().min(0).max(999_999_999).optional().default(0),
  comparePrice: z.coerce.number().int().min(0).max(999_999_999).nullable().optional(),
  categorySlug: z.string().trim().max(40).optional().default("tools-pro"),
  imageUrl: z.string().trim().max(600).nullable().optional(),
  images: z.array(z.string().trim().max(600)).max(8).optional().default([]),
  badge: z.string().trim().max(32).nullable().optional(),
  soldCount: z.coerce.number().int().min(0).max(999999).optional().default(0),
  stock: z.coerce.number().int().min(-1).max(999999).optional().default(-1),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional().default(0),
  variants: z.array(variantInputSchema).optional(),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(rateLimitKey(req, "products:write"), 20)) return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body tidak valid" }, { status: 400 }); }
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  const { name, slug, description, whatsappAlias, price, comparePrice, categorySlug, imageUrl, images, badge, soldCount, stock, isActive, sortOrder, variants } = parsed.data as z.infer<typeof productSchema> & { comparePrice?: number | null };

  const hasExplicitVariants = Array.isArray(variants) && variants.length > 0;
  if (hasExplicitVariants) {
    const activeVars = variants.filter(v => (v.is_active ?? 1) !== 0);
    if (activeVars.length === 0) {
      return NextResponse.json({ error: "Minimal satu varian harus aktif." }, { status: 400 });
    }
  }

  const effectivePrice = hasExplicitVariants
    ? Math.min(...variants.filter(v => (v.is_active ?? 1) !== 0).map(v => v.price))
    : Number(price);

  if (comparePrice && comparePrice <= effectivePrice) return NextResponse.json({ error: "Harga coret harus lebih besar dari harga jual" }, { status: 400 });

  const catRow = await queryFirst("SELECT id FROM categories WHERE slug=?", categorySlug ?? "tools-pro") as { id: number } | undefined;
  if (!catRow) return NextResponse.json({ error: "Kategori tidak dikenal. Buat atau pilih kategori yang tersedia." }, { status: 400 });
  const category_id = catRow.id;
  const imgArr = Array.isArray(images) ? images.slice(0,8) : [];
  // F10: strict allowlist — only /r2/* or known CDNs
  const urlOk = (u: string) => {
    if (u.startsWith("/r2/")) return true;
    try {
      const url = new URL(u);
      return ["images.unsplash.com", "picsum.photos"].includes(url.hostname) && url.protocol === "https:";
    } catch { return false; }
  };
  if (imgArr.some(u => !urlOk(u))) return NextResponse.json({ error: "URL gambar tidak diizinkan — hanya /r2/* atau CDN resmi" }, { status: 400 });
  if (imageUrl && !urlOk(imageUrl)) return NextResponse.json({ error: "URL gambar utama tidak diizinkan" }, { status: 400 });
  const primary = imageUrl ?? imgArr[0] ?? null;
  try {
    const values = [
      category_id, name, slug, description ?? "", whatsappAlias || null, Number(effectivePrice),
      comparePrice ? Number(comparePrice) : null, primary, JSON.stringify(imgArr),
      badge ?? null, soldCount ? Number(soldCount) : 0,
      stock != null ? Number(stock) : -1, isActive === false ? 0 : 1,
      sortOrder ? Number(sortOrder) : 0,
    ];
    const insertSql = `INSERT INTO products (
      category_id,name,slug,description,whatsapp_alias,price,compare_price,image_url,images,
      badge,sold_count,stock,is_active,sort_order
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const d1 = getD1();
    if (d1) {
      const statements = [
        d1.prepare(insertSql).bind(...values),
      ];

      if (hasExplicitVariants) {
        variants.forEach((v, idx) => {
          const autoSku = (v.sku?.trim() || `${slug.toUpperCase()}-${idx + 1}`).replace(/[^A-Z0-9-]/g, "");
          statements.push(
            d1.prepare(
              `INSERT INTO product_variants (
                 product_id, sku, label, duration_value, duration_unit, duration_label,
                 warranty_type, warranty_value, warranty_unit, warranty_label,
                 price, compare_price, stock, fulfillment_mode, is_active, sort_order
               )
               SELECT p.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
               FROM products p WHERE p.slug=?`
            ).bind(
              autoSku,
              v.label.trim(),
              v.duration_value ?? null,
              v.duration_unit || null,
              v.duration_label?.trim() || null,
              v.warranty_type || "none",
              v.warranty_value ?? null,
              v.warranty_unit || null,
              v.warranty_label?.trim() || null,
              Number(v.price),
              v.comparePrice ? Number(v.comparePrice) : null,
              v.stock != null ? Number(v.stock) : -1,
              v.fulfillment_mode || "manual",
              v.is_active ?? 1,
              v.sort_order ?? idx,
              slug
            )
          );
        });
      } else {
        statements.push(
          d1.prepare(
            `INSERT INTO product_variants (
               product_id, sku, label, price, compare_price, stock,
               fulfillment_mode, is_active, sort_order
             )
             SELECT p.id, 'DEFAULT-' || p.id, 'Default', p.price, p.compare_price,
                    p.stock, 'manual', p.is_active, 0
             FROM products p WHERE p.slug=?`,
          ).bind(slug),
        );
      }

      const results = await d1.batch(statements);
      return NextResponse.json({ id: results[0]?.meta?.last_row_id });
    }

    const res = await execRun(insertSql, ...values);
    const newId = res.lastInsertRowid;
    if (hasExplicitVariants) {
      for (let idx = 0; idx < variants.length; idx++) {
        const v = variants[idx];
        const autoSku = (v.sku?.trim() || `${slug.toUpperCase()}-${idx + 1}`).replace(/[^A-Z0-9-]/g, "");
        await execRun(
          `INSERT INTO product_variants (
             product_id, sku, label, duration_value, duration_unit, duration_label,
             warranty_type, warranty_value, warranty_unit, warranty_label,
             price, compare_price, stock, fulfillment_mode, is_active, sort_order
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId,
          autoSku,
          v.label.trim(),
          v.duration_value ?? null,
          v.duration_unit || null,
          v.duration_label?.trim() || null,
          v.warranty_type || "none",
          v.warranty_value ?? null,
          v.warranty_unit || null,
          v.warranty_label?.trim() || null,
          Number(v.price),
          v.comparePrice ? Number(v.comparePrice) : null,
          v.stock != null ? Number(v.stock) : -1,
          v.fulfillment_mode || "manual",
          v.is_active ?? 1,
          v.sort_order ?? idx
        );
      }
    } else {
      await execRun(
        `INSERT INTO product_variants (
           product_id, sku, label, price, compare_price, stock,
           fulfillment_mode, is_active, sort_order
         ) VALUES (?, ?, 'Default', ?, ?, ?, 'manual', ?, 0)`,
        newId,
        `DEFAULT-${newId}`,
        price,
        comparePrice ? Number(comparePrice) : null,
        stock != null ? Number(stock) : -1,
        isActive === false ? 0 : 1
      );
    }
    return NextResponse.json({ id: newId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "slug sudah dipakai" }, { status: 409 });
    console.error("500 src/app/api/products/route.ts :", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }
}
