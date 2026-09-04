// POST /api/admin/variants — Create variant or batch save
// PUT /api/admin/variants?id= — Update variant
// DELETE /api/admin/variants?id= — Deactivate/delete variant
// GET /api/admin/variants?product_id= — List variants for a product

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun, getD1, D1Statement } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";

export const runtime = "edge";

async function requireAdmin(request: NextRequest): Promise<boolean> {
  try {
    const { requireAdmin: checkAuth } = await import("@/lib/auth");
    const result = await checkAuth(request);
    return !!result;
  } catch {
    return false;
  }
}

const SingleVariantSchema = z.object({
  id: z.number().int().positive().optional(),
  product_id: z.number().int().positive(),
  sku: z.string().min(1).max(50).regex(/^[A-Z0-9-]+$/i, "SKU: hanya huruf, angka, dan dash"),
  label: z.string().min(1).max(100),
  duration_value: z.number().int().nonnegative().nullable().optional(),
  duration_unit: z.enum(["day", "month", "year", "lifetime", "custom"]).nullable().optional(),
  duration_label: z.string().max(100).nullable().optional(),
  warranty_type: z.enum(["none", "limited", "full", "custom"]).default("none"),
  warranty_value: z.number().int().nonnegative().nullable().optional(),
  warranty_unit: z.enum(["day", "month", "year", "lifetime"]).nullable().optional(),
  warranty_label: z.string().max(100).nullable().optional(),
  price: z.number().int().nonnegative(),
  compare_price: z.number().int().positive().nullable().optional(),
  stock: z.number().int().min(-1).default(-1),
  fulfillment_mode: z.enum(["manual", "shared", "unique"]).default("manual"),
  is_active: z.number().int().min(0).max(1).default(1),
  sort_order: z.number().int().nonnegative().default(0),
});

const BatchVariantSchema = z.object({
  product_id: z.number().int().positive(),
  aliases: z.array(z.string().trim().min(1).max(50)).optional(),
  variants: z.array(SingleVariantSchema).min(1, "Minimal 1 varian"),
});

function validateCrossFields(v: z.infer<typeof SingleVariantSchema>): string | null {
  if (v.compare_price != null && v.compare_price <= v.price) {
    return `Varian "${v.label}": harga coret harus lebih besar dari harga jual.`;
  }
  if (v.duration_unit && v.duration_unit !== "lifetime" && v.duration_unit !== "custom" && v.duration_value == null) {
    return `Varian "${v.label}": nilai durasi wajib diisi jika unit durasi dipilih.`;
  }
  if (v.duration_value != null && !v.duration_unit) {
    return `Varian "${v.label}": unit durasi wajib dipilih jika nilai durasi diisi.`;
  }
  if (v.warranty_type === "limited" && (v.warranty_value == null || !v.warranty_unit)) {
    return `Varian "${v.label}": nilai dan unit garansi wajib diisi untuk garansi terbatas.`;
  }
  if (v.warranty_type === "custom" && !v.warranty_label) {
    return `Varian "${v.label}": label garansi wajib diisi jika tipe garansi custom.`;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const productId = request.nextUrl.searchParams.get("product_id");
  if (!productId) return NextResponse.json({ error: "product_id_required" }, { status: 400 });

  const product = await queryFirst(`SELECT id, name, aliases FROM products WHERE id=?`, Number(productId));
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  const variants = await queryAll(
    `SELECT id, product_id, sku, label,
            duration_value, duration_unit, duration_label,
            warranty_type, warranty_value, warranty_unit, warranty_label,
            price, compare_price, stock, fulfillment_mode,
            CASE WHEN shared_secret_ciphertext IS NOT NULL AND shared_secret_iv IS NOT NULL THEN 1 ELSE 0 END
              AS shared_secret_configured,
            is_active, sort_order, created_at, updated_at
     FROM product_variants
     WHERE product_id=? ORDER BY sort_order ASC, price ASC, id ASC`,
    Number(productId),
  );

  let aliases: string[] = [];
  try {
    aliases = typeof product.aliases === "string" ? JSON.parse(product.aliases) : (product.aliases as string[] || []);
  } catch { aliases = []; }

  return NextResponse.json({ variants, aliases });
}

export async function POST(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const raw = await request.json().catch(() => null);
  if (!raw) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  // Handle batch save
  if (Array.isArray(raw.variants)) {
    const parsed = BatchVariantSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const { product_id, aliases } = parsed.data;
    const variants = parsed.data.variants.map((variant) => ({
      ...variant,
      sku: variant.sku.toUpperCase(),
    }));

    // Check product exists
    const product = await queryFirst(`SELECT id, is_active FROM products WHERE id=?`, product_id);
    if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

    // Active product must have at least 1 active variant
    if (Number(product.is_active) === 1) {
      const activeCount = variants.filter((v) => v.is_active === 1).length;
      if (activeCount === 0) {
        return NextResponse.json({ error: "Produk aktif wajib memiliki minimal satu varian aktif." }, { status: 400 });
      }
    }

    // Cross-validate each variant & check SKU duplicates inside batch
    const seenSkus = new Set<string>();
    for (const v of variants) {
      const crossErr = validateCrossFields(v);
      if (crossErr) return NextResponse.json({ error: crossErr }, { status: 400 });
      const upperSku = v.sku.toUpperCase();
      if (seenSkus.has(upperSku)) {
        return NextResponse.json({ error: `SKU duplikat dalam daftar: ${upperSku}` }, { status: 400 });
      }
      seenSkus.add(upperSku);
    }

    // Check SKU collisions in DB with other products
    for (const v of variants) {
      const conflict = v.id
        ? await queryFirst(`SELECT id FROM product_variants WHERE sku=? AND id!=?`, v.sku, v.id)
        : await queryFirst(`SELECT id FROM product_variants WHERE sku=?`, v.sku);
      if (conflict) {
        return NextResponse.json({ error: `SKU ${v.sku} sudah digunakan oleh varian lain.` }, { status: 409 });
      }
    }

    // Execute atomic batch save
    const d1 = getD1();
    const now = new Date().toISOString();

    if (d1) {
      const statements: D1Statement[] = [];

      // Update aliases on product if provided
      if (aliases) {
        statements.push(
          d1.prepare(`UPDATE products SET aliases=?, updated_at=datetime('now') WHERE id=?`).bind(
            JSON.stringify(aliases),
            product_id,
          ),
        );
      }

      for (const v of variants) {
        if (v.id) {
          statements.push(
            d1.prepare(
              `UPDATE product_variants SET
                 sku=?, label=?, duration_value=?, duration_unit=?, duration_label=?,
                 warranty_type=?, warranty_value=?, warranty_unit=?, warranty_label=?,
                 price=?, compare_price=?, stock=?, fulfillment_mode=?, is_active=?,
                 sort_order=?, updated_at=datetime('now')
               WHERE id=? AND product_id=?`,
            ).bind(
              v.sku, v.label,
              v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
              v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
              v.price, v.compare_price ?? null, v.stock, v.fulfillment_mode, v.is_active,
              v.sort_order, v.id, product_id,
            ),
          );
        } else {
          statements.push(
            d1.prepare(
              `INSERT INTO product_variants (
                 product_id, sku, label, duration_value, duration_unit, duration_label,
                 warranty_type, warranty_value, warranty_unit, warranty_label,
                 price, compare_price, stock, fulfillment_mode, is_active, sort_order,
                 created_at, updated_at
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ).bind(
              product_id, v.sku, v.label,
              v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
              v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
              v.price, v.compare_price ?? null, v.stock, v.fulfillment_mode, v.is_active,
              v.sort_order, now, now,
            ),
          );
        }
      }

      // Keep legacy/admin summary columns aligned with the authoritative active
      // variants. Public channel reads still query product_variants directly.
      statements.push(
        d1.prepare(
          `UPDATE products
           SET price=COALESCE((
                 SELECT MIN(price) FROM product_variants
                 WHERE product_id=? AND is_active=1
               ),price),
               compare_price=CASE WHEN (
                 SELECT COUNT(*) FROM product_variants
                 WHERE product_id=? AND is_active=1
               )=1 THEN (
                 SELECT compare_price FROM product_variants
                 WHERE product_id=? AND is_active=1 LIMIT 1
               ) ELSE NULL END,
               stock=CASE WHEN EXISTS(
                 SELECT 1 FROM product_variants
                 WHERE product_id=? AND is_active=1 AND stock=-1
               ) THEN -1 ELSE COALESCE((
                 SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)
                 FROM product_variants WHERE product_id=? AND is_active=1
               ),0) END,
               updated_at=datetime('now')
           WHERE id=?`,
        ).bind(product_id, product_id, product_id, product_id, product_id, product_id),
      );

      await d1.batch(statements);
      return NextResponse.json({ ok: true, saved: variants.length });
    }

    // Dev fallback
    if (aliases) {
      await execRun(`UPDATE products SET aliases=? WHERE id=?`, JSON.stringify(aliases), product_id);
    }
    for (const v of variants) {
      if (v.id) {
        await execRun(
          `UPDATE product_variants SET sku=?, label=?, price=?, stock=?, is_active=?, sort_order=? WHERE id=?`,
          v.sku, v.label, v.price, v.stock, v.is_active, v.sort_order, v.id,
        );
      }
    }
    return NextResponse.json({ ok: true, saved: variants.length });
  }

  // Handle single variant create
  const parsed = SingleVariantSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const v = { ...parsed.data, sku: parsed.data.sku.toUpperCase() };
  const crossErr = validateCrossFields(v);
  if (crossErr) return NextResponse.json({ error: crossErr }, { status: 400 });

  const product = await queryFirst(`SELECT id FROM products WHERE id=?`, v.product_id);
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  const existingSku = await queryFirst(`SELECT id FROM product_variants WHERE sku=?`, v.sku);
  if (existingSku) return NextResponse.json({ error: "sku_already_exists" }, { status: 409 });

  const now = new Date().toISOString();
  const result = await execRun(
    `INSERT INTO product_variants (product_id, sku, label, duration_value, duration_unit, duration_label,
       warranty_type, warranty_value, warranty_unit, warranty_label,
       price, compare_price, stock, fulfillment_mode, is_active, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    v.product_id, v.sku, v.label,
    v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
    v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
    v.price, v.compare_price ?? null, v.stock, v.fulfillment_mode,
    v.is_active, v.sort_order, now, now,
  );

  return NextResponse.json({ ok: true, id: result.lastInsertRowid }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const body = await request.json();
  const parsed = SingleVariantSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const v = {
    ...parsed.data,
    ...(parsed.data.sku ? { sku: parsed.data.sku.toUpperCase() } : {}),
  };

  // Check existing variant
  const existing = await queryFirst(`SELECT * FROM product_variants WHERE id=?`, Number(id));
  if (!existing) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });

  // Merge with existing for cross field validation
  const merged = { ...existing, ...v } as z.infer<typeof SingleVariantSchema>;
  const crossErr = validateCrossFields(merged);
  if (crossErr) return NextResponse.json({ error: crossErr }, { status: 400 });

  // Active product check if deactivating
  if (v.is_active === 0 && Number(existing.is_active) === 1) {
    const product = await queryFirst(`SELECT id, is_active FROM products WHERE id=?`, Number(existing.product_id));
    if (product && Number(product.is_active) === 1) {
      const otherActive = await queryFirst(
        `SELECT COUNT(*) as count FROM product_variants WHERE product_id=? AND is_active=1 AND id!=?`,
        Number(existing.product_id),
        Number(id),
      );
      if (!otherActive || Number(otherActive.count) === 0) {
        return NextResponse.json({ error: "Produk aktif wajib memiliki minimal satu varian aktif." }, { status: 400 });
      }
    }
  }

  // Check SKU uniqueness if changed
  if (v.sku) {
    const skuConflict = await queryFirst(`SELECT id FROM product_variants WHERE sku=? AND id!=?`, v.sku, Number(id));
    if (skuConflict) return NextResponse.json({ error: "sku_already_exists" }, { status: 409 });
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  const fields: [string, unknown][] = [
    ["sku", v.sku], ["label", v.label],
    ["duration_value", v.duration_value], ["duration_unit", v.duration_unit], ["duration_label", v.duration_label],
    ["warranty_type", v.warranty_type], ["warranty_value", v.warranty_value], ["warranty_unit", v.warranty_unit], ["warranty_label", v.warranty_label],
    ["price", v.price], ["compare_price", v.compare_price], ["stock", v.stock],
    ["fulfillment_mode", v.fulfillment_mode], ["is_active", v.is_active], ["sort_order", v.sort_order],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) {
      updates.push(`${col}=?`);
      params.push(val ?? null);
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 });

  updates.push("updated_at=datetime('now')");
  params.push(Number(id));

  await execRun(`UPDATE product_variants SET ${updates.join(",")} WHERE id=?`, ...params);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const existing = await queryFirst(`SELECT id, product_id, is_active FROM product_variants WHERE id=?`, Number(id));
  if (!existing) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });

  // Ensure active product retains at least 1 variant
  const product = await queryFirst(`SELECT id, is_active FROM products WHERE id=?`, Number(existing.product_id));
  if (product && Number(product.is_active) === 1 && Number(existing.is_active) === 1) {
    const otherActive = await queryFirst(
      `SELECT COUNT(*) as count FROM product_variants WHERE product_id=? AND is_active=1 AND id!=?`,
      Number(existing.product_id),
      Number(id),
    );
    if (!otherActive || Number(otherActive.count) === 0) {
      return NextResponse.json({ error: "Produk aktif wajib memiliki minimal satu varian aktif." }, { status: 400 });
    }
  }

  // Inventory, jobs, and historical orders can all reference a variant. Keep
  // the stable SKU/ID for auditability and always archive instead of deleting.
  await execRun(`UPDATE product_variants SET is_active=0, updated_at=datetime('now') WHERE id=?`, Number(id));
  return NextResponse.json({ ok: true, action: "deactivated" });
}
