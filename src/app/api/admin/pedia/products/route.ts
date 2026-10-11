// /api/admin/pedia/products — CRUD produk kurasi + tingkat (§10 Produk, PD-40).
// GET: daftar produk + tingkatnya (termasuk pratinjau harga per paket +
// margin per paket; merah bila < min profit — dihitung di UI dari field).
// POST: buat produk. PUT: ubah produk / tingkat / urutan / aktif.
// Badge "Nonaktif otomatis" dibaca dari tiers.auto_disabled_reason.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createDatabaseAccess } from "@/lib/db-access";
import { computePediaPrice, PRICE_GROUP_DEFAULTS, type PriceGroup } from "@/lib/pedia/pricing";
import { PEDIA_SEED_PRODUCTS } from "@/lib/pedia/seed";
import { isPediaProvider, PEDIA_PROVIDERS } from "@/lib/pedia/proxy";
import { providerPricingGate } from "../_shared";
import type { DatabaseAccess } from "@/lib/db-access";

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
  checklist_json: z.string().max(5000).refine((raw) => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) && v.every((c) => c && typeof c.id === "string" && c.id.trim().length > 0 && c.id.length <= 120 &&
        typeof c.label === "string" && c.label.trim().length > 0 && c.label.length <= 500 &&
        (c.help === undefined || (typeof c.help === "string" && c.help.length <= 2000))) &&
        new Set(v.map((c) => c.id.trim())).size === v.length;
    } catch { return false; }
  }, "Checklist harus memiliki id unik (1-120 karakter), label (1-500 karakter), dan bantuan teks opsional (maksimal 2000 karakter)").optional().default("[]"),
  packages_json: z.string().max(500).refine((raw) => {
    try { const v = JSON.parse(raw); return Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n > 0); } catch { return false; }
  }, "Paket harus berupa array bilangan positif").optional().default("[100,250,500,1000]"),
  step: z.coerce.number().int().min(1).max(100000).default(1),
  sort_order: z.coerce.number().int().min(0).max(100000).default(0),
  is_active: z.coerce.number().int().min(0).max(1).default(0),
  is_featured: z.coerce.number().int().min(0).max(1).default(0),
});

const tierSchema = z.object({
  product_id: z.coerce.number().int().min(1),
  tier: z.enum(["hemat", "standar", "premium"]),
  label_note: z.string().trim().max(120).optional().default(""),
  supplier: z.enum(PEDIA_PROVIDERS).default("providersmm"),
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

async function reprice(db: DatabaseAccess, id: number, isTier: boolean) {
  const affected = await db.queryAll(
    `SELECT t.*, p.packages_json, p.step, s.rate_idr_per_1k AS live_rate, s.present AS live_present,
            s.type AS live_type, s.min_qty AS live_min, s.max_qty AS live_max
       FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id
       LEFT JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
      WHERE ${isTier ? "t.id" : "t.product_id"}=?`, id,
  );
  for (const tier of affected) {
    if (!isPediaProvider(tier.supplier) || Number(tier.live_present) !== 1 || tier.live_type !== "Default" || !Number.isFinite(Number(tier.live_rate)) || Number(tier.live_rate) <= 0) {
      await db.execRun(`UPDATE pedia_tiers SET package_prices_json='{}', is_active=0,
        auto_disabled_reason='service_missing', updated_at=datetime('now') WHERE id=?`, tier.id);
      continue;
    }
    const prices = Object.fromEntries((JSON.parse(String(tier.packages_json)) as number[])
      .filter((qty) => qty % Number(tier.step) === 0 && qty >= Number(tier.live_min) && qty <= Number(tier.live_max))
      .map((quantity) => [quantity, computePediaPrice({
        quantity, supplierRatePer1k: Number(tier.live_rate), markupPct: Number(tier.markup_pct),
        minProfitRp: Number(tier.min_profit_rp), minOrderRp: Number(process.env.PEDIA_MIN_ORDER_RP || 1000),
      })]));
    await db.execRun(`UPDATE pedia_tiers SET package_prices_json=?, rate_snapshot=?, updated_at=datetime('now') WHERE id=?`, JSON.stringify(prices), Number(tier.live_rate), tier.id);
  }
}

async function validateMapping(db: DatabaseAccess, tier: Record<string, unknown>): Promise<string | null> {
  if (!isPediaProvider(tier.supplier)) return "invalid_provider";
  const gate = await providerPricingGate(tier.supplier);
  if (gate) return gate;
  for (const id of [tier.supplier_service_id, tier.backup_service_id].filter((id) => id != null)) {
    const service = await db.queryFirst(`SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=?`, tier.supplier, id);
    if (!service || Number(service.present) !== 1 || service.type !== "Default" || !Number.isFinite(Number(service.rate_idr_per_1k)) || Number(service.rate_idr_per_1k) <= 0) return "service_unavailable";
  }
  return null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createDatabaseAccess();
  try {
  const products = await db.queryAll(`SELECT * FROM pedia_products ORDER BY sort_order, id`);
  const tiers = await db.queryAll(
    `SELECT t.*, s.rate_idr_per_1k AS live_rate, s.name AS live_name, s.type AS live_type,
            s.min_qty AS live_min, s.max_qty AS live_max, s.present AS live_present,
            s.api_refill AS live_api_refill, s.api_cancel AS live_api_cancel
       FROM pedia_tiers t
       LEFT JOIN pedia_supplier_services s
         ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
      ORDER BY t.product_id, t.tier`,
   );
  return NextResponse.json({ ok: true, products, tiers });
  } catch { return NextResponse.json({ error: "load_failed" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const db = createDatabaseAccess();

  // Seed kurasi awal §7.3 (nonaktif semua). Idempoten via INSERT OR IGNORE.
  if (body.action === "seed") {
    try {
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
      );
      if (Number(r?.changes || 0) > 0) products++;
      const row = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug=?`, p.slug);
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
        );
        if (Number(tr?.changes || 0) > 0) tiers++;
      }
    }
    return NextResponse.json({ ok: true, seeded_products: products, seeded_tiers: tiers });
    } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
  }

  if (body.kind === "tier") {
    const parsed = tierSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_tier" }, { status: 400 });
    }
    const t = parsed.data;
    try {
    if (!await db.queryFirst(`SELECT id FROM pedia_products WHERE id=?`, t.product_id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const mappingError = await validateMapping(db, t);
    if (mappingError) return NextResponse.json({ error: mappingError }, { status: 400 });
    const r = await db.execRun(
      `INSERT INTO pedia_tiers
         (product_id, tier, label_note, supplier, supplier_service_id, backup_service_id,
          price_group, markup_pct, min_profit_rp, refill_days, eta_start, eta_finish,
          package_prices_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      t.product_id, t.tier, t.label_note, t.supplier, t.supplier_service_id, t.backup_service_id ?? null,
      t.price_group, t.markup_pct, t.min_profit_rp, t.refill_days,
      t.eta_start, t.eta_finish, t.is_active,
    ).catch(() => null);
    if (!r) return NextResponse.json({ error: "save_failed" }, { status: 500 });
    try { await reprice(db, Number(r.lastInsertRowid), true); }
    catch { return NextResponse.json({ error: "reprice_failed", saved: true, id: r.lastInsertRowid }, { status: 500 }); }
    return NextResponse.json({ ok: true, id: r.lastInsertRowid });
    } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }
  }

  const parsed = productSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_product" }, { status: 400 });
  }
  const p = parsed.data;
  if ((JSON.parse(p.packages_json) as number[]).some((qty) => qty % p.step !== 0)) return NextResponse.json({ error: "Paket harus sesuai kelipatan jumlah" }, { status: 400 });
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

  const id = z.coerce.number().int().positive().safeParse(body.id);
  if (!id.success) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const isTier = body.kind === "tier";
  const parsed = (isTier ? tierSchema.partial() : productSchema.partial()).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  // Partial schemas still contain defaults; only write fields actually submitted.
  const values = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => body[key] !== undefined));
  const table = isTier ? "pedia_tiers" : "pedia_products";
  try {
    const current = await db.queryFirst(`SELECT * FROM ${table} WHERE id=?`, id.data);
    if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (isTier) {
      if ((values.supplier !== undefined) !== (values.supplier_service_id !== undefined)) return NextResponse.json({ error: "supplier_service_pair_required" }, { status: 400 });
      const merged = { ...current, ...values };
      if (values.supplier !== undefined && values.supplier !== current.supplier && values.backup_service_id === undefined) values.backup_service_id = null;
      if (values.supplier !== undefined || values.backup_service_id !== undefined) {
        const mappingError = await validateMapping(db, { ...merged, ...values });
        if (mappingError) return NextResponse.json({ error: mappingError }, { status: 400 });
      }
      else if (values.is_active === 1 && isPediaProvider(current.supplier)) {
        const gate = await providerPricingGate(current.supplier);
        if (gate) return NextResponse.json({ error: gate }, { status: 400 });
      }
    }
    if (!isTier) {
      const merged = { ...current, ...values };
      const packages = JSON.parse(String(merged.packages_json)) as number[];
      if (packages.some((qty) => qty % Number(merged.step) !== 0)) return NextResponse.json({ error: "Paket harus sesuai kelipatan jumlah" }, { status: 400 });
    }
    const allow = isTier
      ? ["label_note", "supplier", "supplier_service_id", "backup_service_id", "price_group", "markup_pct", "min_profit_rp", "refill_days", "eta_start", "eta_finish", "is_active"]
      : ["slug", "platform", "metric", "target_kind", "name", "tagline", "description_md", "checklist_json", "packages_json", "step", "sort_order", "is_active", "is_featured"];
    const keys = allow.filter((key) => values[key] !== undefined);
    if (!keys.length) return NextResponse.json({ error: "no_changes" }, { status: 400 });
    const fields = keys.map((key) => `${key}=?`);
    // Old supplier prices must not survive a saved mapping whose reprice fails.
    if (isTier && (values.supplier !== undefined || values.supplier_service_id !== undefined || values.markup_pct !== undefined || values.min_profit_rp !== undefined)) fields.push("package_prices_json='{}'");
    if (isTier && values.is_active === 1) fields.push("auto_disabled_reason=NULL");
    fields.push("updated_at=datetime('now')");
    const result = await db.execRun(`UPDATE ${table} SET ${fields.join(", ")} WHERE id=?`, ...keys.map((key) => values[key]), id.data);
    if (!result.changes) return NextResponse.json({ error: "save_failed" }, { status: 500 });
  } catch { return NextResponse.json({ error: "save_failed" }, { status: 500 }); }

  // Reprice only this product/tier; never upsert a missing supplier back to present.
  // Prices are derived, not an editable PUT field. Report partial persistence honestly.
  if (isTier || values.packages_json !== undefined || values.step !== undefined) {
    try {
      await reprice(db, id.data, isTier);
    } catch { return NextResponse.json({ error: "reprice_failed", saved: true, id: id.data }, { status: 500 }); }
  }
  return NextResponse.json({ ok: true });
}
