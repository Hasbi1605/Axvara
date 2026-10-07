// GET /api/pedia/catalog — Katalog publik (PD-01/03, §9.7).
// Publik, cache CDN 60 dtk. HANYA produk + tingkat AKTIF.
// TIDAK PERNAH memuat supplier_service_id, nama layanan supplier, rate,
// atau supplier_order_id (AC-16 — dikunci test snapshot).
import { NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export type PediaCatalogTier = {
  id: number;
  tier: string;
  label_note: string | null;
  refill_days: number;
  eta_start: string | null;
  eta_finish: string | null;
  prices: Record<string, number>;
};

export type PediaCatalogProduct = {
  slug: string;
  platform: string;
  metric: string;
  target_kind: string;
  name: string;
  tagline: string | null;
  packages: number[];
  step: number;
  checklist: { id: string; label: string; help?: string }[];
  is_featured: number;
  tiers: PediaCatalogTier[];
  min_price: number | null;
};

function parseJsonArray(raw: unknown): number[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch { return []; }
}

function parseJson(raw: unknown, fallback: unknown): unknown {
  try {
    const v = JSON.parse(String(raw ?? ""));
    return v ?? fallback;
  } catch { return fallback; }
}

export async function GET() {
  if (process.env.PEDIA_ENABLED !== "true") {
    return NextResponse.json({ error: "pedia_disabled" }, { status: 503 });
  }
  const db = createDatabaseAccess();
  const products = await db.queryAll(
    `SELECT id, slug, platform, metric, target_kind, name, tagline,
            packages_json, step, checklist_json, is_featured
       FROM pedia_products WHERE is_active=1 ORDER BY sort_order, id`,
  ).catch(() => []);
  const tiers = await db.queryAll(
    `SELECT id, product_id, tier, label_note, refill_days, eta_start, eta_finish,
            package_prices_json, supplier_service_id
       FROM pedia_tiers WHERE is_active=1`,
  ).catch(() => []);
  // Batas layanan supplier (min–max) untuk menyembunyikan paket di luar rentang.
  const bounds = await db.queryAll(
    `SELECT service_id, min_qty, max_qty FROM pedia_supplier_services WHERE supplier='providersmm'`,
  ).catch(() => []);
  const boundByService = new Map<number, { min: number; max: number }>();
  for (const b of bounds) {
    boundByService.set(Number(b.service_id), { min: Number(b.min_qty), max: Number(b.max_qty) });
  }
  const tiersByProduct = new Map<number, PediaCatalogTier[]>();
  const tierService = new Map<number, number>();
  for (const t of tiers) {
    const prices = parseJson(t.package_prices_json, {}) as Record<string, number>;
    const list = tiersByProduct.get(Number(t.product_id)) ?? [];
    list.push({
      id: Number(t.id), tier: String(t.tier),
      label_note: t.label_note != null ? String(t.label_note) : null,
      refill_days: Number(t.refill_days) || 0,
      eta_start: t.eta_start != null ? String(t.eta_start) : null,
      eta_finish: t.eta_finish != null ? String(t.eta_finish) : null,
      prices: Object.fromEntries(
        Object.entries(prices).map(([k, v]) => [k, Number(v) || 0]),
      ),
    });
    tiersByProduct.set(Number(t.product_id), list);
    tierService.set(Number(t.id), Number(t.supplier_service_id));
  }
  const out: PediaCatalogProduct[] = [];
  for (const p of products) {
    const allPackages = parseJsonArray(p.packages_json);
    // Paket di luar rentang min–max layanan disembunyikan (PRD §7.3).
    // Bila layanan belum tersinkron (bounds kosong) tampilkan semua.
    const pt = tiersByProduct.get(Number(p.id)) ?? [];
    if (pt.length === 0) continue;
    const packages = allPackages.filter((qty) => pt.some((t) => {
      const b = boundByService.get(tierService.get(t.id) ?? -1);
      if (!b) return true;
      return qty >= b.min && qty <= b.max;
    }));
    if (packages.length === 0) continue;
    // Saring harga paket yang disembunyikan dari tiap tingkat.
    for (const t of pt) {
      for (const k of Object.keys(t.prices)) {
        if (!packages.includes(Number(k))) delete t.prices[k];
      }
    }
    const minPrice = Math.min(...pt.flatMap((t) => Object.values(t.prices)).filter((v) => v > 0));
    out.push({
      slug: String(p.slug), platform: String(p.platform), metric: String(p.metric),
      target_kind: String(p.target_kind), name: String(p.name),
      tagline: p.tagline != null ? String(p.tagline) : null,
      packages, step: Number(p.step) || 1,
      checklist: (parseJson(p.checklist_json, []) as { id: string; label: string; help?: string }[]),
      is_featured: Number(p.is_featured) || 0,
      tiers: pt,
      min_price: Number.isFinite(minPrice) ? minPrice : null,
    });
  }
  return NextResponse.json({ ok: true, products: out }, {
    headers: { "CDN-Cache-Control": "max-age=60", "Cache-Control": "public, max-age=60" },
  });
}
