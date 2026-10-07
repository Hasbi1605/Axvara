// /api/admin/pedia/products — CRUD produk kurasi + tingkat (§10 Produk, PD-40).
// GET: daftar produk + tingkatnya (termasuk pratinjau harga per paket +
// margin per paket; merah bila < min profit — dihitung di UI dari field).
// POST: buat produk. PUT: ubah produk / tingkat / urutan / aktif.
// Badge "Nonaktif otomatis" dibaca dari tiers.auto_disabled_reason.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { PRICE_GROUP_DEFAULTS, type PriceGroup } from "@/lib/pedia/pricing";
import { PEDIA_SEED_PRODUCTS } from "@/lib/pedia/seed";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const productSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  platform: z.string().trim().min(1).max(30),
  metric: z.string().trim().min(1).max(30),
  target_kind: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).optional().default(""),
  description_md: z.string().max(5000).optional().default(""),
  checklist_json: z.string().max(5000).optional().default("[]"),
  packages_json: z.string().max(500).optional().default("[100,250,500,1000]"),
  step: z.coerce.number().int().min(1).max(100000).default(1),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
  is_active: z.coerce.number().int().min(0).max(1).default(0),
  is_featured: z.coerce.number().int().min(0).max(1).default(0),
});

const tierSchema = z.object({
  product_id: z.coerce.number().int().min(1),
  tier: z.enum(["hemat", "standar", "premium"]),
  label_note: z.string().trim().max(120).optional().default(""),
  supplier_service_id: z.coerce.number().int().min(1),
  backup_service_id: z.coerce.number().int().min(1).optional().nullable(),
  price_group: z.enum(["G1", "G2", "G3"]),
  markup_pct: z.coerce.number().min(0).max(1000),
  min_profit_rp: z.coerce.number().int().min(0).max(10000000),
  refill_days: z.coerce.number().int().min(0).max(365).default(0),
  eta_start: z.string().trim().max(40).optional().default(""),
  eta_finish: z.string().trim().max(40).optional().default(""),
  is_active: z.coerce.number().int().min(0).max(1).default(0),
});

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  const products = await db.queryAll(`SELECT * FROM pedia_products ORDER BY sort_order, id`).catch(() => []);
  const tiers = await db.queryAll(
    `SELECT t.*, s.rate_idr_per_1k AS live_rate, s.name AS live_name,
            s.min_qty AS live_min, s.max_qty AS live_max, s.present AS live_present
       FROM pedia_tiers t
       LEFT JOIN pedia_supplier_services s
         ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
      ORDER BY t.product_id, t.tier`,
  ).catch(() => []);
  return NextResponse.json({ ok: true, products, tiers });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const db = createDatabaseAccess();

  // Seed kurasi awal §7.3 (nonaktif semua). Idempoten via INSERT OR IGNORE.
  if (body.action === "seed") {
    let products = 0;
    let tiers = 0;
    for (const [index, p] of PEDIA_SEED_PRODUCTS.entries()) {
      const r = await db.execRun(
        `INSERT OR IGNORE INTO pedia_products
           (slug, platform, metric, target_kind, name, tagline, checklist_json,
            packages_json, step, sort_order, is_active, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        p.slug, p.platform, p.metric, p.targetKind, p.name, p.tagline,
        JSON.stringify(p.checklist), JSON.stringify(p.packages), p.step, index,
      ).catch(() => null);
      if (Number(r?.changes || 0) > 0) products++;
      const row = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug=?`, p.slug).catch(() => null);
      const pid = Number(row?.id);
      if (!pid) continue;
      for (const t of p.tiers) {
        const def = PRICE_GROUP_DEFAULTS[t.group as PriceGroup];
        const tr = await db.execRun(
          `INSERT OR IGNORE INTO pedia_tiers
             (product_id, tier, label_note, supplier, supplier_service_id,
              price_group, markup_pct, min_profit_rp, refill_days,
              eta_start, eta_finish, package_prices_json, is_active)
           VALUES (?, ?, ?, 'providersmm', ?, ?, ?, ?, ?, ?, ?, '{}', 0)`,
          pid, t.tier, t.labelNote ?? "", t.serviceId, t.group,
          def.markup_pct, def.min_profit_rp, t.refillDays,
          t.etaStart ?? "", t.etaFinish ?? "",
        ).catch(() => null);
        if (Number(tr?.changes || 0) > 0) tiers++;
      }
    }
    return NextResponse.json({ ok: true, seeded_products: products, seeded_tiers: tiers });
  }

  if (body.kind === "tier") {
    const parsed = tierSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_tier" }, { status: 400 });
    }
    const t = parsed.data;
    const r = await db.execRun(
      `INSERT INTO pedia_tiers
         (product_id, tier, label_note, supplier, supplier_service_id, backup_service_id,
          price_group, markup_pct, min_profit_rp, refill_days, eta_start, eta_finish,
          package_prices_json, is_active)
       VALUES (?, ?, ?, 'providersmm', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      t.product_id, t.tier, t.label_note, t.supplier_service_id, t.backup_service_id ?? null,
      t.price_group, t.markup_pct, t.min_profit_rp, t.refill_days,
      t.eta_start, t.eta_finish, t.is_active,
    ).catch(() => null);
    if (!r) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    return NextResponse.json({ ok: true, id: r.lastInsertRowid });
  }

  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_product" }, { status: 400 });
  }
  const p = parsed.data;
  const r = await db.execRun(
    `INSERT INTO pedia_products
       (slug, platform, metric, target_kind, name, tagline, description_md,
        checklist_json, packages_json, step, sort_order, is_active, is_featured)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.slug, p.platform, p.metric, p.target_kind, p.name, p.tagline, p.description_md,
    p.checklist_json, p.packages_json, p.step, p.sort_order, p.is_active, p.is_featured,
  ).catch(() => null);
  if (!r) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  return NextResponse.json({ ok: true, id: r.lastInsertRowid });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const db = createDatabaseAccess();

  // PUT tingkat: kunci manual — bila admin mengaktifkan ulang tingkat yang
  // nonaktif otomatis, kunci margin dibuka (auto_disabled_reason=NULL).
  if (body.kind === "tier") {
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
    const fields: string[] = [];
    const params: unknown[] = [];
    const allow = ["label_note", "supplier_service_id", "backup_service_id", "price_group",
      "markup_pct", "min_profit_rp", "refill_days", "eta_start", "eta_finish", "is_active"] as const;
    for (const k of allow) {
      if (body[k] !== undefined) { fields.push(`${k}=?`); params.push(body[k]); }
    }
    if (!fields.length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
    // Aktivasi manual = buka kunci auto-disabled (PD-32/33: pulih hanya manual).
    if (Number(body.is_active) === 1) fields.push(`auto_disabled_reason=NULL`);
    fields.push(`updated_at=datetime('now')`);
    await db.execRun(`UPDATE pedia_tiers SET ${fields.join(", ")} WHERE id=?`, ...params, id).catch(() => null);
    // Hitung ulang harga paket tingkat ini setelah perubahan markup/layanan.
    const { applyProvidersmmDiff } = await import("@/lib/pedia/sync");
    const tier = await db.queryFirst(`SELECT supplier_service_id FROM pedia_tiers WHERE id=?`, id).catch(() => null);
    if (tier) {
      const live = await db.queryFirst(
        `SELECT service_id, name, type, category, rate_idr_per_1k AS rate,
                min_qty, max_qty, api_refill, api_cancel, api_dripfeed
           FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=?`,
        Number(tier.supplier_service_id),
      ).catch(() => null);
      if (live) await applyProvidersmmDiff(db, [live as never], []).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const fields: string[] = [];
  const params: unknown[] = [];
  const allow = ["slug", "platform", "metric", "target_kind", "name", "tagline",
    "description_md", "checklist_json", "packages_json", "step", "sort_order",
    "is_active", "is_featured"] as const;
  for (const k of allow) {
    if (body[k] !== undefined) { fields.push(`${k}=?`); params.push(body[k]); }
  }
  if (!fields.length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
  fields.push(`updated_at=datetime('now')`);
  await db.execRun(`UPDATE pedia_products SET ${fields.join(", ")} WHERE id=?`, ...params, id).catch(() => null);
  return NextResponse.json({ ok: true });
}
