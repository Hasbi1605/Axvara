import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
// POST /api/admin/variants — Create variant or batch save
// PUT /api/admin/variants?id= — Update variant
// DELETE /api/admin/variants?id= — Deactivate/delete variant
// GET /api/admin/variants?product_id= — List variants for a product

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun, getD1, D1Statement } from "@/lib/db";
import { isEnabled } from "@/lib/feature-flags";
import { bulkOwnerFromProductRow, isManualProductForBulk } from "@/lib/bulk-pricing";
import {
  WR_OWNED_VARIANT_FIELDS,
  WR_OWNERSHIP_MESSAGE,
  findWrOwnedViolation,
  isWrManaged,
} from "@/lib/warung-rebahan/ownership";

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

const BulkTierInputSchema = z.object({
  min_qty: z.number().int(),
  unit_price: z.number().int(),
}).strict();

const BulkPricingInputSchema = z.object({
  enabled: z.boolean(),
  tiers: z.array(BulkTierInputSchema).max(5),
}).strict();

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
  // Minimum pembelian per baris (migrasi 0034, generik — GSuite = 50).
  // Batas 100 = plafon channel (web/Telegram) agar aturan tetap bisa dibeli.
  min_qty: z.number().int().min(1).max(100).default(1),
  max_qty: z.number().int().min(1).max(100).nullable().optional(),
  buyer_field_key: z.literal("muse_invite_code").nullable().optional(),
  // Modal manual per unit (migrasi 0058, milik admin — sync tak menyentuh).
  manual_cost: z.number().int().min(0).max(999_999_999).default(0),
  // Bulk pricing per varian (migrasi 0099, milik admin — sync tak menyentuh,
  // bukan WR-owned). Omitted = preserved (client lama aman).
  bulk_pricing: BulkPricingInputSchema.optional(),
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
  if (v.sku === "TUNVN-BUFF-1B" && v.max_qty !== undefined && v.max_qty !== 30) return "Buff Muse dibatasi 30 unit.";
  if (v.max_qty != null && v.max_qty < v.min_qty) return "Maksimum di bawah minimum.";
  if (/^TUNVN-BUFF-(5|10|20|30)B$/.test(v.sku) && v.is_active === 1) return "Paket lama sudah dipensiunkan.";
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

  const productId = request.nextUrl.searchParams.get("product_id");
  if (!productId) return NextResponse.json({ error: "product_id_required" }, { status: 400 });

  const product = await queryFirst(`SELECT id, name, aliases FROM products WHERE id=?`, Number(productId));
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

  const variants = await queryAll(
    `SELECT id, product_id, sku, label,
            duration_value, duration_unit, duration_label,
            warranty_type, warranty_value, warranty_unit, warranty_label,
            price, compare_price, stock, min_qty, max_qty, buyer_field_key, manual_cost, fulfillment_mode, admin_terms, admin_activation,
            bulk_pricing_enabled, bulk_pricing_tiers,
            CASE WHEN shared_secret_ciphertext IS NOT NULL AND shared_secret_iv IS NOT NULL THEN 1 ELSE 0 END
              AS shared_secret_configured,
            is_active, sort_order, created_at, updated_at
     FROM product_variants
     WHERE product_id=? AND sku NOT IN ('TUNVN-BUFF-5B','TUNVN-BUFF-10B','TUNVN-BUFF-20B','TUNVN-BUFF-30B')
     ORDER BY sort_order ASC, price ASC, id ASC`,
    Number(productId),
  );

  // Raw stored bulk config (GET admin): enabled+tiers apa adanya; bentuk
  // valid-JSON tapi tier-shape salah => corrupt flag, tampil jujur bukan 500.
  const withBulk = (variants as Record<string, unknown>[]).map((row) => {
    let enabled = Number(row.bulk_pricing_enabled ?? 0) === 1;
    let tiers: unknown = [];
    let corrupt = false;
    try {
      tiers = JSON.parse(String(row.bulk_pricing_tiers ?? "[]"));
    } catch { enabled = false; tiers = []; corrupt = Number(row.bulk_pricing_enabled ?? 0) === 1; }
    if (Array.isArray(tiers)) {
      const badShape = tiers.some((t) => !t || typeof t !== "object" || Array.isArray(t)
        || Object.keys(t as object).length !== 2
        || !Number.isSafeInteger((t as Record<string, unknown>).min_qty)
        || !Number.isSafeInteger((t as Record<string, unknown>).unit_price));
      if (badShape) { enabled = false; tiers = []; corrupt = Number(row.bulk_pricing_enabled ?? 0) === 1; }
    } else { enabled = false; tiers = []; corrupt = Number(row.bulk_pricing_enabled ?? 0) === 1; }
    return {
      ...row,
      bulk_pricing: { enabled, tiers },
      ...(corrupt ? { bulk_pricing_corrupt: true } : {}),
    };
  });

  let aliases: string[] = [];
  try {
    aliases = typeof product.aliases === "string" ? JSON.parse(product.aliases) : (product.aliases as string[] || []);
  } catch { aliases = []; }

  return NextResponse.json({ variants: withBulk, aliases });
}

async function POSTImpl(request: NextRequest) {
  const authed = await requireAdmin(request);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

    // Check product exists (sekaligus identitas supplier untuk guard grosir)
    const product = await queryFirst(
      `SELECT id, archived_at, is_active, source, wr_product_id, wr_auto_managed, sk_product_id, sk_auto_managed
         FROM products WHERE id=?`,
      product_id,
    );
    if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });

    if (product.archived_at && variants.some(v => v.is_active === 1)) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });

    // Keputusan owner 2026-11-08: harga grosir HANYA untuk produk manual.
    // Menonaktifkan (enabled=false) tetap boleh agar data lama bisa dibersihkan.
    if (!isManualProductForBulk(bulkOwnerFromProductRow(product as unknown as Record<string, unknown>))) {
      const enabling = variants.some((v) => (v as Record<string, unknown>).bulk_pricing !== undefined
        && ((v as Record<string, unknown>).bulk_pricing as { enabled?: unknown }).enabled === true);
      if (enabling) return NextResponse.json({ error: "bulk_pricing_supplier_forbidden", message: "Harga grosir hanya untuk produk manual." }, { status: 400 });
    }

    // Active product must have at least 1 active variant
    if (Number(product.is_active) === 1) {
      const activeCount = variants.filter((v) => v.is_active === 1).length;
      if (activeCount === 0) {
        return NextResponse.json({ error: "Produk aktif wajib memiliki minimal satu varian aktif." }, { status: 400 });
      }
    }

    // Cross-validate each variant & check SKU duplicates inside batch
    const seenSkus = new Set<string>();
    const tunvnIdentities = await queryAll("SELECT id,sku FROM product_variants WHERE product_id=? AND sku LIKE 'TUNVN-%'",product_id);
    for (const v of variants) {
      const identity = tunvnIdentities.find(row => Number(row.id) === v.id);
      if (identity && identity.sku !== v.sku) return NextResponse.json({ error:"Identitas varian tidak boleh diubah." },{ status:409 });
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

    // Guard kepemilikan WR untuk batch (lihat PUT di bawah): varian
    // auto-managed hanya boleh berubah lewat sync, bukan dari panel.
    // PENGECUALIAN: harga coret (compare_price/comparePrice) milik admin.
    // CATATAN: `variants` hasil Zod parse (bukan body mentah), tapi batch
    // selalu membawa SEMUA field varian (DTO penuh dari panel) — jadi
    // bandingkan nilai aktual; nilai SAMA dengan DB bukan pelanggaran
    // (findWrOwnedViolation sudah menangani itu).
    const wrExisting = await queryAll(
      `SELECT id, label, price, compare_price, stock, duration_value, duration_unit, duration_label,
              warranty_type, warranty_value, warranty_unit, warranty_label
       FROM product_variants WHERE product_id=? AND wr_auto_managed=1`,
      product_id,
    );
    if (wrExisting.length > 0) {
      const byId = new Map(wrExisting.map((row) => [Number(row.id), row]));
      for (const v of variants) {
        const current = v.id ? byId.get(Number(v.id)) : undefined;
        if (!current) continue;
        const violation = findWrOwnedViolation(v as Record<string, unknown>, current, WR_OWNED_VARIANT_FIELDS);
        if (violation) return NextResponse.json({ error: WR_OWNERSHIP_MESSAGE, field: violation }, { status: 409 });
      }
    }

    // Execute atomic batch save
    const d1 = getD1();
    const now = new Date().toISOString();
    // Batch snapshot SEKALI: observed triple per id. Guard operasional di
    // bawah memakai pola yang sama dengan PUT products/[id].
    const batchIds = variants.filter((vv) => vv.id).map((vv) => Number(vv.id));
    const batchRows = (batchIds.length ? await queryAll(
      `SELECT id, price, max_qty, bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE product_id=? AND id IN (${batchIds.map(() => "?").join(",")})`,
      product_id, ...batchIds,
    ).catch(() => []) : []) as Record<string, unknown>[];
    for (const variant of variants) {
      const stored = batchRows.find(row => Number(row.id) === variant.id);
      const maxQty = variant.max_qty === undefined ? stored?.max_qty : variant.max_qty;
      if (maxQty != null && Number(maxQty) < variant.min_qty) return NextResponse.json({ error:"Maksimum di bawah minimum." },{ status:400 });
    }
    const batchObserved = new Map(batchRows.map((row) => ([Number(row.id), {
      price: Number(row.price), enabled: Number(row.bulk_pricing_enabled ?? 0),
      tiersJson: String(row.bulk_pricing_tiers ?? "[]"),
    }] as const)));
    const bulkPrepBatch = new Map<number, { enabled: number; tiersJson: string }>();
    const rawOf = (vid: number): unknown =>
      (variants.find((vv) => vv.id === vid) as unknown as Record<string, unknown> | undefined)?.bulk_pricing;

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
        const rawBulk = (v as Record<string, unknown>).bulk_pricing as { enabled?: unknown; tiers?: unknown } | undefined;
        const obs = v.id ? batchObserved.get(Number(v.id)) : undefined;
        // Effective = explicit ?? stored (stored parsed defensif).
        const storedEnabled = obs?.enabled ?? 0;
        let storedTiers: unknown[] = [];
        try {
          const t = JSON.parse(obs?.tiersJson ?? "[]");
          if (Array.isArray(t)) storedTiers = t;
        } catch { storedTiers = []; }
        const effectiveRaw = rawBulk === undefined
          ? { enabled: storedEnabled === 1, tiers: storedTiers }
          : rawBulk;
        const { validateBulkPricing } = await import("@/lib/bulk-pricing");
        const checked = validateBulkPricing(effectiveRaw, Number(v.price));
        if (!checked) return NextResponse.json({ error: "bulk_pricing_invalid", message: `Varian "${v.label}": konfigurasi bulk tidak valid.` }, { status: 400 });
        if (checked.enabled) {
          for (const t of checked.tiers) {
            if (t.unit_price > Number(v.price)) {
              return NextResponse.json({ error: "bulk_pricing_invalid", message: `Varian "${v.label}": tier di atas harga.` }, { status: 400 });
            }
          }
        }
        const bulkEnabled = checked.enabled ? 1 : 0;
        const bulkTiersJson = JSON.stringify(checked.tiers);
        if (v.id) bulkPrepBatch.set(Number(v.id), { enabled: bulkEnabled, tiersJson: bulkTiersJson });
        if (v.id) {
          statements.push(
            d1.prepare(
                `INSERT INTO operation_guards (operation_id, valid) SELECT ?, CASE WHEN EXISTS(
                 SELECT 1 FROM product_variants WHERE id=? AND product_id=? AND price=? AND bulk_pricing_enabled=? AND bulk_pricing_tiers=?
               ) THEN 1 ELSE 0 END`,
            ).bind(
              `bulkbatch:${product_id}:${v.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
              Number(v.id), product_id, obs?.price ?? Number(v.price),
              obs?.enabled ?? 0, obs?.tiersJson ?? "[]",
            ),
          );
          statements.push(
            d1.prepare(
              `UPDATE product_variants SET
                 sku=?, label=?, duration_value=?, duration_unit=?, duration_label=?,
                 warranty_type=?, warranty_value=?, warranty_unit=?, warranty_label=?,
                 price=?, compare_price=?, stock=?, min_qty=?, manual_cost=?, fulfillment_mode=?, is_active=?,
                 sort_order=?,
                 bulk_pricing_enabled=?, bulk_pricing_tiers=?,
                 updated_at=datetime('now')
               WHERE id=? AND product_id=?`,
            ).bind(
              v.sku, v.label,
              v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
              v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
              v.price, v.compare_price ?? null, v.stock, v.min_qty ?? 1, v.manual_cost ?? 0, v.fulfillment_mode, v.is_active,
              v.sort_order, bulkEnabled, bulkTiersJson,
              v.id, product_id,
            ),
          );
        } else {
          statements.push(
            d1.prepare(
              `INSERT INTO product_variants (
                 product_id, sku, label, duration_value, duration_unit, duration_label,
                 warranty_type, warranty_value, warranty_unit, warranty_label,
                 price, compare_price, stock, min_qty, manual_cost, fulfillment_mode, is_active, sort_order,
                 bulk_pricing_enabled, bulk_pricing_tiers, created_at, updated_at
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            ).bind(
              product_id, v.sku, v.label,
              v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
              v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
              v.price, v.compare_price ?? null, v.stock, v.min_qty ?? 1, v.manual_cost ?? 0, v.fulfillment_mode, v.is_active,
              v.sort_order, bulkEnabled ?? 0, bulkTiersJson ?? "[]", now, now,
            ),
          );
        }
      }

      for (const v of variants) {
        if (v.buyer_field_key !== undefined || v.max_qty !== undefined) statements.push(d1.prepare(`UPDATE product_variants SET buyer_field_key=CASE WHEN ? THEN ? ELSE buyer_field_key END,max_qty=CASE WHEN ? THEN ? ELSE max_qty END WHERE product_id=? AND sku=?`).bind(v.buyer_field_key !== undefined ? 1 : 0,v.buyer_field_key ?? null,v.max_qty !== undefined ? 1 : 0,v.max_qty ?? null,product_id,v.sku));
        // Harga manual hanya ditulis bila harganya BERUBAH dari baris tersimpan:
        // batch dari panel Produk selalu membawa semua varian, jadi menulis
        // tanpa syarat membekukan harga rumus supplier menjadi override manual.
        const stored = v.id ? batchRows.find(row => Number(row.id) === Number(v.id)) : undefined;
        if (v.sku.startsWith("TUNVN-") && stored && Number(v.price) !== Number(stored.price)) statements.push(d1.prepare("UPDATE product_variants SET tunvn_admin_price_idr=? WHERE product_id=? AND sku=?").bind(v.price,product_id,v.sku));
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

      let batchOk = true;
      try {
        await d1.batch(statements);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/operation_guards|CHECK constraint/i.test(msg)) batchOk = false;
        else throw e;
      } finally {
        await d1.prepare("DELETE FROM operation_guards WHERE operation_id LIKE ?").bind(`bulkbatch:${product_id}:%`).run().catch(() => {});
      }
      if (!batchOk) {
        return NextResponse.json({ error: "stale_variant", message: "Varian berubah oleh admin lain. Muat ulang lalu simpan lagi." }, { status: 409 });
      }
      for (const [vid, prep] of bulkPrepBatch) {
        if (rawOf(vid) === undefined) continue;
        const obs = batchObserved.get(vid);
        if (!obs) continue;
        console.info("[admin-bulk-pricing]", JSON.stringify({
          route: "POST /api/admin/variants", variant: vid,
          before: { enabled: obs.enabled, tiers: obs.tiersJson, price: obs.price },
          after: { enabled: prep.enabled, tiers: prep.tiersJson },
        }));
      }
      return NextResponse.json({ ok: true, saved: variants.length });
    }

    // Dev fallback
    if (aliases) {
      await execRun(`UPDATE products SET aliases=? WHERE id=?`, JSON.stringify(aliases), product_id);
    }
    for (const v of variants) {
      if (v.id) {
        await execRun(
          `UPDATE product_variants SET sku=?, label=?, price=?, stock=?, min_qty=?, manual_cost=?, is_active=?, sort_order=? WHERE id=?`,
          v.sku, v.label, v.price, v.stock, v.min_qty ?? 1, v.manual_cost ?? 0, v.is_active, v.sort_order, v.id,
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

  const product = await queryFirst(
    `SELECT id, archived_at, source, wr_product_id, wr_auto_managed, sk_product_id, sk_auto_managed
       FROM products WHERE id=?`,
    v.product_id,
  );
  if (!product) return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  if (product.archived_at && v.is_active === 1) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });

  // Keputusan owner 2026-11-08: harga grosir HANYA untuk produk manual.
  // Varían baru pada produk supplier tidak boleh langsung aktif.
  if ((v as Record<string, unknown>).bulk_pricing !== undefined
    && ((v as Record<string, unknown>).bulk_pricing as { enabled?: unknown }).enabled === true
    && !isManualProductForBulk(bulkOwnerFromProductRow(product as unknown as Record<string, unknown>))) {
    return NextResponse.json({ error: "bulk_pricing_supplier_forbidden", message: "Harga grosir hanya untuk produk manual." }, { status: 400 });
  }

  const existingSku = await queryFirst(`SELECT id FROM product_variants WHERE sku=?`, v.sku);
  if (existingSku) return NextResponse.json({ error: "sku_already_exists" }, { status: 409 });

  // CREATE: bulk default off + '[]'. Opsional explicit bulk_config
  // validated vs base (helper kanonis); invalid => 400 tanpa write.
  // Unknown nested key ditolak passthrough agar tak ada field liar lolos.
  let bulkEnabled = 0;
  let bulkTiersJson = "[]";
  if (v.bulk_pricing !== undefined) {
    const { validateBulkPricing } = await import("@/lib/bulk-pricing");
    const checked = validateBulkPricing(v.bulk_pricing, Number(v.price));
    if (!checked) return NextResponse.json({ error: "bulk_pricing_invalid", message: "Konfigurasi bulk tidak valid untuk harga varian." }, { status: 400 });
    if (checked.enabled) {
      for (const t of checked.tiers) {
        if (t.unit_price > Number(v.price)) {
          return NextResponse.json({ error: "bulk_pricing_invalid", message: "Konfigurasi bulk tidak valid untuk harga varian." }, { status: 400 });
        }
      }
    }
    bulkEnabled = checked.enabled ? 1 : 0;
    bulkTiersJson = JSON.stringify(checked.tiers);
  }

  const now = new Date().toISOString();
  const result = await execRun(
    `INSERT INTO product_variants (product_id, sku, label, duration_value, duration_unit, duration_label,
       warranty_type, warranty_value, warranty_unit, warranty_label,
       price, compare_price, stock, min_qty, manual_cost, fulfillment_mode, is_active, sort_order,
       bulk_pricing_enabled, bulk_pricing_tiers, created_at, updated_at,buyer_field_key,max_qty)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    v.product_id, v.sku, v.label,
    v.duration_value ?? null, v.duration_unit ?? null, v.duration_label ?? null,
    v.warranty_type, v.warranty_value ?? null, v.warranty_unit ?? null, v.warranty_label ?? null,
    v.price, v.compare_price ?? null, v.stock, v.min_qty ?? 1, v.manual_cost ?? 0, v.fulfillment_mode,
    v.is_active, v.sort_order, bulkEnabled, bulkTiersJson, now, now,v.buyer_field_key ?? null,v.max_qty ?? null,
  );

  return NextResponse.json({ ok: true, id: result.lastInsertRowid }, { status: 201 });
}

async function PUTImpl(request: NextRequest) {
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
  if (String(existing.sku).startsWith("TUNVN-") && v.sku !== undefined && v.sku !== existing.sku) return NextResponse.json({ error:"Identitas varian tidak boleh diubah." },{ status:409 });

  if (v.is_active === 1 && await queryFirst("SELECT id FROM products WHERE id=? AND archived_at IS NOT NULL", existing.product_id)) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });

  // Merge with existing for cross field validation
  const merged = { ...existing, ...v } as z.infer<typeof SingleVariantSchema>;
  const crossErr = validateCrossFields(merged);
  if (crossErr) return NextResponse.json({ error: crossErr }, { status: 400 });

  // Varian milik sync WR: field harga/stok/label/durasi/garansi tidak boleh
  // ditulis dari sini. Route ini jalur tulis KEDUA di samping PUT /api/products/:id,
  // jadi tanpa guard yang sama ia menjadi pintu belakang untuk perubahan yang
  // pasti hilang di sweep sync berikutnya.
  // PENGECUALIAN: harga coret (compare_price) milik admin — boleh diubah.
  // CATATAN ZOD: `.partial()` tetap menerapkan `.default()` (stock → -1,
  // warranty → none, dst) sehingga `v` SELALU membawa field-field itu walau
  // request hanya mengirim compare_price. Bandingkan HANYA key yang benar-benar
  // ada di body mentah — kalau tidak, edit coret saja selalu 409 "stock".
  if (isWrManaged(existing)) {
    const rawBody = (body ?? {}) as Record<string, unknown>;
    const incomingOnly: Record<string, unknown> = {};
    for (const key of Object.keys(rawBody)) incomingOnly[key] = (v as Record<string, unknown>)[key];
    const violation = findWrOwnedViolation(incomingOnly, existing, WR_OWNED_VARIANT_FIELDS);
    if (violation) return NextResponse.json({ error: WR_OWNERSHIP_MESSAGE, field: violation }, { status: 409 });
  }

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

  // Bulk merge (PUT single): omitted => preserved (jangan reset client lama).
  // Toggle off => tiers TETAP tersimpan. Base change => revalidate active
  // config vs base HASIL dalam request yang sama; inconsistent => 400 atomic.
  // Effective = explicit ?? stored (stored parsed defensif; unparseable =>
  // anggap off/[] agar tak 500, GET menandai corrupt terpisah). Disabled
  // retained boleh stale dan TIDAK memblokir edit base; re-enable WAJIB
  // valid vs base hasil.
  const rawBulk = (body as Record<string, unknown>).bulk_pricing as { enabled?: unknown; tiers?: unknown } | undefined;
  // Keputusan owner 2026-11-08: harga grosir HANYA untuk produk manual.
  // Menonaktifkan (enabled=false) tetap boleh agar data lama bisa dibersihkan.
  if (rawBulk?.enabled === true) {
    const ownerRow = await queryFirst(
      `SELECT source, wr_product_id, wr_auto_managed, sk_product_id, sk_auto_managed
         FROM products WHERE id=?`,
      Number(existing.product_id),
    );
    if (!isManualProductForBulk(bulkOwnerFromProductRow(ownerRow as unknown as Record<string, unknown> | null))) {
      return NextResponse.json({ error: "bulk_pricing_supplier_forbidden", message: "Harga grosir hanya untuk produk manual." }, { status: 400 });
    }
  }
  const resultBase = v.price !== undefined ? Number(v.price) : Number(existing.price);
  const storedEnabled = Number((existing as Record<string, unknown>).bulk_pricing_enabled ?? 0) === 1 ? 1 : 0;
  const storedTiersJson = String((existing as Record<string, unknown>).bulk_pricing_tiers ?? "[]");
  let storedTiers: unknown[] = [];
  try { const t = JSON.parse(storedTiersJson); if (Array.isArray(t)) storedTiers = t; } catch { storedTiers = []; }
  const effectiveRaw = rawBulk === undefined
    ? { enabled: storedEnabled === 1, tiers: storedTiers }
    : rawBulk;
  const { validateBulkPricing } = await import("@/lib/bulk-pricing");
  const checkedAll = validateBulkPricing(effectiveRaw, resultBase);
  if (!checkedAll) return NextResponse.json({ error: "bulk_pricing_invalid", message: "Konfigurasi bulk tidak valid untuk harga varian." }, { status: 400 });
  if (checkedAll.enabled) {
    for (const t of checkedAll.tiers) {
      if (t.unit_price > resultBase) {
        return NextResponse.json({ error: "bulk_pricing_invalid", message: "Konfigurasi bulk tidak valid untuk harga varian." }, { status: 400 });
      }
    }
  }
  const bulkEnabled: number | null = rawBulk === undefined ? null : (checkedAll.enabled ? 1 : 0);
  const bulkTiersJson: string | null = rawBulk === undefined ? null : JSON.stringify(checkedAll.tiers);

  const updates: string[] = [];
  const params: unknown[] = [];
  // Harga manual hanya ditulis bila admin benar-benar mengubah harga; nilai
  // yang sama dengan baris tersimpan adalah simpan ulang panel, bukan edit.
  if (String(existing.sku).startsWith("TUNVN-") && v.price !== undefined && Number(v.price) !== Number(existing.price)) {
    updates.push("tunvn_admin_price_idr=?");
    params.push(v.price);
  }
  const fields: [string, unknown][] = [
    ["sku", v.sku], ["label", v.label],
    ["duration_value", v.duration_value], ["duration_unit", v.duration_unit], ["duration_label", v.duration_label],
    ["warranty_type", v.warranty_type], ["warranty_value", v.warranty_value], ["warranty_unit", v.warranty_unit], ["warranty_label", v.warranty_label],
    ["price", v.price], ["compare_price", v.compare_price], ["stock", v.stock],
    ["min_qty", v.min_qty], ["manual_cost", v.manual_cost], ["max_qty",v.max_qty], ["buyer_field_key",v.buyer_field_key],
    ["fulfillment_mode", v.fulfillment_mode], ["is_active", v.is_active], ["sort_order", v.sort_order],
  ];
  for (const [col, val] of fields) {
    if (val !== undefined) {
      updates.push(`${col}=?`);
      params.push(val ?? null);
    }
  }
  // CAS: WHERE mencakup observed triple agar concurrent base/config change
  // => 0 changes => 409, tanpa partial write. Single-row: gunakan
  // operation_guards precondition (pola PUT products/[id]) agar konsisten.
  if (bulkEnabled !== null) {
    updates.push("bulk_pricing_enabled=?", "bulk_pricing_tiers=?");
    params.push(bulkEnabled, bulkTiersJson);
  }

  if (updates.length === 0 && bulkEnabled === null) return NextResponse.json({ error: "no_fields_to_update" }, { status: 400 });

  updates.push("updated_at=datetime('now')");
  const d1put = getD1();
  if (d1put) {
    const guardId = `bulksingle:${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
      await d1put.batch([
        d1put.prepare(
          `INSERT INTO operation_guards (operation_id, valid) SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM product_variants WHERE id=? AND price=? AND bulk_pricing_enabled=? AND bulk_pricing_tiers=?
           ) THEN 1 ELSE 0 END`,
        ).bind(guardId, Number(id), Number(existing.price),
          Number(existing.bulk_pricing_enabled ?? 0), String(existing.bulk_pricing_tiers ?? "[]")),
        d1put.prepare(`UPDATE product_variants SET ${updates.join(",")} WHERE id=?`).bind(...params, Number(id)),
        d1put.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/operation_guards|CHECK constraint/i.test(msg)) {
        return NextResponse.json({ error: "stale_variant", message: "Varian berubah oleh admin lain. Muat ulang lalu simpan lagi." }, { status: 409 });
      }
      throw e;
    }
    await d1put.prepare("DELETE FROM operation_guards WHERE operation_id LIKE ?").bind(`bulksingle:${id}:%`).run().catch(() => {});
  } else {
    params.push(Number(id));
    await execRun(`UPDATE product_variants SET ${updates.join(",")} WHERE id=?`, ...params);
  }

  // Audit exact before/after bulk SAJA (tanpa secret): structured console
  // SETELAH commit valid. Gagal validasi/unauthorized = no write + no audit.
  if (bulkEnabled !== null) {
    console.info("[admin-bulk-pricing]", JSON.stringify({
      variant: Number(id),
      before: { enabled: Number(existing.bulk_pricing_enabled ?? 0), tiers: String(existing.bulk_pricing_tiers ?? "[]"), price: Number(existing.price) },
      after: { enabled: bulkEnabled, tiers: bulkTiersJson, price: resultBase },
    }));
  }

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

export async function POST(request: NextRequest) {
  try { return await POSTImpl(request); }
  catch (error) {
    if (String(error).includes("product_archived")) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });
    throw error;
  }
}

export async function PUT(request: NextRequest) {
  try { return await PUTImpl(request); }
  catch (error) {
    if (String(error).includes("product_archived")) return NextResponse.json({ error: ARCHIVED_MESSAGE }, { status: 409 });
    throw error;
  }
}
