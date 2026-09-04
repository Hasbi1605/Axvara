// POST /api/admin/variants — Create variant
// PUT /api/admin/variants?id= — Update variant
// DELETE /api/admin/variants?id= — Deactivate variant
// GET /api/admin/variants?product_id= — List variants for a product

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun, isD1Mode } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";

export const runtime = "edge";

// Auth check helper (reuse existing pattern)
async function requireAdmin(request: NextRequest): Promise<boolean> {
  // Import auth module dynamically to match project patterns
  try {
    const { requireAdmin: checkAuth } = await import("@/lib/auth");
    const result = await checkAuth(request);
    return !!result;
  } catch {
    return false;
  }
}

const VariantSchema = z.object({
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

export async function GET(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const productId = request.nextUrl.searchParams.get("product_id");
  if (!productId) return NextResponse.json({ error: "product_id_required" }, { status: 400 });

  const variants = await queryAll(
    `SELECT * FROM product_variants WHERE product_id=? ORDER BY sort_order ASC, price ASC, id ASC`,
    Number(productId)
  );

  return NextResponse.json({ variants });
}

export async function POST(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isEnabled("PRODUCT_VARIANTS_WRITE")) {
    return NextResponse.json({ error: "variants_not_enabled" }, { status: 503 });
  }

  const body = await request.json();
  const parsed = VariantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const v = parsed.data;

  // Validate compare_price > price
  if (v.compare_price != null && v.compare_price <= v.price) {
    return NextResponse.json({ error: "compare_price harus lebih besar dari price" }, { status: 400 });
  }

  // Validate product exists
  const product = await queryFirst(`SELECT id FROM products WHERE id=?`, v.product_id);
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  // Check SKU uniqueness
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
    v.is_active, v.sort_order, now, now
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
  const parsed = VariantSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed", details: parsed.error.flatten() }, { status: 400 });
  }

  const v = parsed.data;

  // Validate compare_price > price if both present
  if (v.compare_price != null && v.price != null && v.compare_price <= v.price) {
    return NextResponse.json({ error: "compare_price harus lebih besar dari price" }, { status: 400 });
  }

  // Check existing variant
  const existing = await queryFirst(`SELECT id, product_id FROM product_variants WHERE id=?`, Number(id));
  if (!existing) return NextResponse.json({ error: "variant_not_found" }, { status: 404 });

  // Check SKU uniqueness if changed
  if (v.sku) {
    const skuConflict = await queryFirst(`SELECT id FROM product_variants WHERE sku=? AND id!=?`, v.sku, Number(id));
    if (skuConflict) return NextResponse.json({ error: "sku_already_exists" }, { status: 409 });
  }

  // Build dynamic UPDATE
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

  // Check if variant has orders — if so, deactivate instead of delete
  const hasOrders = await queryFirst(
    `SELECT 1 FROM orders WHERE variant_id=? LIMIT 1`, Number(id)
  );

  if (hasOrders) {
    // Soft-deactivate only
    await execRun(`UPDATE product_variants SET is_active=0, updated_at=datetime('now') WHERE id=?`, Number(id));
    return NextResponse.json({ ok: true, action: "deactivated" });
  }

  await execRun(`DELETE FROM product_variants WHERE id=?`, Number(id));
  return NextResponse.json({ ok: true, action: "deleted" });
}
