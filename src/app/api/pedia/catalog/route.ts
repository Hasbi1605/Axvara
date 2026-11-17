// GET /api/pedia/catalog — Katalog publik (PD-01/03, §9.7).
// Publik, cache CDN 60 dtk. HANYA produk + tingkat AKTIF.
// TIDAK PERNAH memuat supplier_service_id, nama layanan supplier, rate,
// atau supplier_order_id (AC-16 — dikunci test snapshot).
import { NextResponse } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { PEDIA_SALE_PROVIDER } from "@/lib/pedia/sales-policy";
import { pediaBounds } from "@/lib/pedia/bounds";
import { PEDIA_CATALOG_BOUNDS_SQL } from "@/lib/pedia/catalog-queries";
import { pediaMinOrderRp } from "@/lib/pedia/ops-config";
import { whiteLabel } from "@/lib/pedia/terms";
import { CUSTOM_COMMENT_MAX_LINES } from "@/lib/pedia/custom-comments";

// Produk komentar: jumlah acuan 10 bila valid, selain itu minimum layanan.
function commentRefQty(products: Record<string, unknown>[], t: Record<string, unknown>, limits: { min: number; max: number; step: number }): number | null {
  const p = products.find((x) => Number(x.id) === Number(t.product_id));
  if (!p || String(p.metric) !== "comments") return null;
  const ok = (q: number) => q >= limits.min && q <= limits.max && q % (limits.step || 1) === 0;
  return ok(10) ? 10 : ok(limits.min) ? limits.min : null;
}

export const runtime = "edge";
export const dynamic = "force-dynamic";

export type PediaCatalogTier = {
  id: number;
  tier: string;
  label_note: string | null;
  refill_days: number;
  /** Titik awal masa refill (kolom refill_anchor); opsional untuk fixture lama. */
  refill_anchor?: "created" | "completed";
  eta_start: string | null;
  eta_finish: string | null;
  prices: Record<string, number>;
  min_qty?: number;
  max_qty?: number;
  quantity_step?: number;
  /** Kurasi publik (0062): nama + deskripsi bahasa manusia per layanan.
   *  Opsional di tipe agar fixture/preview lama tetap valid; route selalu mengisi. */
  public_name?: string | null;
  description?: string | null;
  terms?: string | null;
  instructions?: string | null;
  recommendation_note?: string | null;
  region?: "indonesia" | "global" | "mixed";
  quality?: "ekonomis" | "standar" | "hq" | "real";
  speed_note?: string | null;
  drop_risk?: "rendah" | "sedang" | "tinggi";
  recommended?: boolean;
  /** 2026-11-01: label drop supplier (No Drop/Less Drop/High Drop), speed, avg time,
   *  jalur refill (api/manual) dan data terukur 7 hari. Semua opsional untuk fixture lama. */
  drop_label?: "no_drop" | "less_drop" | "high_drop" | "unknown";
  speed_per_day?: string | null;
  avg_time?: string | null;
  refill_mode?: "api" | "manual" | "none";
  /** Persen sukses / persen pesanan yang diajukan refill di supplier (7 hari). */
  success_pct?: number | null;
  /** "comments" = pembeli menulis komentar custom (satu per baris). */
  input_kind?: "comments" | null;
  refill_pct?: number | null;
  /** Harga jual per 1.000 unit dari rate live (markup tier ini). */
  price_per_1k?: number | null;
  /** Harga acuan jumlah kecil untuk produk komentar (owner 2026-11-02): harga
   *  per 1.000 komentar terlihat mahal, jadi kartu memakai harga nyata untuk
   *  10 komentar (atau minimum layanan). Rumus sama dengan quote. */
  price_ref?: { qty: number; price: number } | null;
  /** Jumlah contoh untuk chip cepat UI (tetap tunduk min–max + step). */
  quick_quantities?: number[];
};

export type PediaCatalogProduct = {
  slug: string;
  platform: string;
  metric: string;
  target_kind: string;
  name: string;
  tagline: string | null;
  description_md?: string | null;
  packages: number[];
  step: number;
  checklist: { id: string; label: string; help?: string }[];
  is_featured: number;
  tiers: PediaCatalogTier[];
  min_price: number | null;
  /** Gambar kartu Axvara-style per platform (2026-10-15, permintaan owner):
   *  path R2 statis `/r2/products/pedia-platform-<platform>.webp`, bukan kolom
   *  DB — 8 platform berbagi 1 gambar yang sama (17 produk, 1 gambar per
   *  platform), jadi konstanta kode lebih tepat daripada kolom per baris. */
  image: string | null;
};

function parseJsonArray(raw: unknown): number[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b) : [];
  } catch { return []; }
}

function parseJson(raw: unknown, fallback: unknown): unknown {
  try {
    const v = JSON.parse(String(raw ?? ""));
    return v ?? fallback;
  } catch { return fallback; }
}

/** Gambar kartu Axvara-style per platform (2026-10-15, permintaan owner).
 *  Satu sumber dengan `PLATFORM_CARD_IMAGE` di PlatformGrid — path R2 statis,
 *  bukan kolom DB (8 platform berbagi 1 gambar yang sama). Platform tak dikenal
 *  → null (kartu fallback ke panel gradasi lama). */
const PEDIA_PLATFORM_CARD_SLUGS = new Set([
  "instagram", "tiktok", "youtube", "facebook", "threads", "spotify", "shopee", "x",
]);

/** Shopee/Spotify memakai path -v2 (cache-busting 2026-10-15 — sinkron
 *  dengan PLATFORM_CARD_IMAGE di PlatformGrid). */
const PEDIA_PLATFORM_CARD_V2 = new Set(["spotify", "shopee"]);

function platformCardImage(platform: string): string | null {
  if (!PEDIA_PLATFORM_CARD_SLUGS.has(platform)) return null;
  const suffix = PEDIA_PLATFORM_CARD_V2.has(platform) ? "-v2" : "";
  return `/r2/products/pedia-platform-${platform}${suffix}.webp`;
}

export async function GET() {
  if (process.env.PEDIA_ENABLED !== "true") {
    return NextResponse.json({ error: "pedia_disabled" }, { status: 503 });
  }
  const { cachePublicCatalog } = await import("@/lib/catalog-cache");
  return cachePublicCatalog("pedia:catalog", 300, readCatalog, "pedia");
}

async function readCatalog() {
  const db = createDatabaseAccess();
  let failed = false;
  const unavailable = () => { failed = true; return []; };
  const products = await db.queryAll(
    `SELECT id, slug, platform, metric, target_kind, name, tagline, description_md,
            packages_json, step, checklist_json, is_featured
       FROM pedia_products WHERE is_active=1 ORDER BY sort_order, id`,
  ).catch(unavailable);
  const tiers = await db.queryAll(
    `SELECT id, product_id, tier, label_note, refill_days, refill_anchor, eta_start, eta_finish,
            package_prices_json, supplier, supplier_service_id,
            public_name, description_md, terms_md, instructions_md, recommendation_note, min_qty_override, max_qty_override, quantity_step, region, quality, speed_note, drop_risk, drop_label, speed_per_day, input_kind,
            is_recommended, sort_order, markup_pct, min_profit_rp
       FROM pedia_tiers WHERE is_active=1 ORDER BY is_recommended DESC, sort_order, id`,
  ).catch(unavailable);
  // Batas + rate live layanan supplier (min–max + harga per 1.000 terkini).
  const bounds = await db.queryAll(
    PEDIA_CATALOG_BOUNDS_SQL,
  ).catch(unavailable);
  const boundByService = new Map<string, { min: number; max: number; rate: number; apiRefill: boolean; avgTime: string | null; orders: number; success: number | null; refill: number | null }>();
  const num = (v: unknown) => v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  for (const b of bounds) {
    boundByService.set(`${b.supplier}:${b.service_id}`, { min: Number(b.min_qty), max: Number(b.max_qty), rate: Number(b.rate_idr_per_1k), apiRefill: Number(b.api_refill) === 1,
      avgTime: b.avg_time != null && /\d/.test(String(b.avg_time)) ? String(b.avg_time).slice(0, 40) : null, orders: Number(b.orders_7d) || 0, success: num(b.success_rate), refill: num(b.refill_rate) });
  }
  const { computePediaPrice } = await import("@/lib/pedia/pricing");
  const minOrderRp = pediaMinOrderRp();
  const tiersByProduct = new Map<number, PediaCatalogTier[]>();
  for (const t of tiers) {
    if (!isPediaProvider(t.supplier)) continue;
    // INDO-POLICY-20: public offers come from the sale supplier only.
    // Historical rows of a retired supplier stay in DB for saved orders and
    // admin, but are never offered to buyers.
    if (t.supplier !== PEDIA_SALE_PROVIDER) continue;
    const bound = boundByService.get(`${t.supplier}:${t.supplier_service_id}`);
    if (!bound || !Number.isSafeInteger(bound.min) || !Number.isSafeInteger(bound.max) || bound.min <= 0 || bound.max < bound.min) continue;
    // Komentar custom dibatasi 200 baris per pesanan (src/lib/pedia/custom-comments.ts).
    const limits = pediaBounds({ min_qty: bound.min, max_qty: t.input_kind === "comments" ? Math.min(bound.max, CUSTOM_COMMENT_MAX_LINES) : bound.max }, t);
    if (!limits) continue;
    const prices = parseJson(t.package_prices_json, {});
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) continue;
    const list = tiersByProduct.get(Number(t.product_id)) ?? [];
    const region = ["indonesia", "global", "mixed"].includes(String(t.region)) ? String(t.region) as PediaCatalogTier["region"] : "global";
    const quality = ["ekonomis", "standar", "hq", "real"].includes(String(t.quality)) ? String(t.quality) as PediaCatalogTier["quality"] : "standar";
    const dropRisk = ["rendah", "sedang", "tinggi"].includes(String(t.drop_risk)) ? String(t.drop_risk) as PediaCatalogTier["drop_risk"] : "sedang";
    list.push({
      id: Number(t.id), tier: String(t.tier),
      label_note: t.label_note != null ? whiteLabel(String(t.label_note)) : null,
      refill_days: Number(t.refill_days) || 0,
      refill_anchor: t.refill_anchor === "completed" ? "completed" : "created",
      eta_start: t.eta_start != null ? String(t.eta_start) : null,
      eta_finish: t.eta_finish != null ? String(t.eta_finish) : null,
      min_qty: limits.min, max_qty: limits.max, quantity_step: limits.step,
      prices: Object.fromEntries(
        Object.entries(prices).filter(([k, v]) => Number.isSafeInteger(Number(k)) && Number(k) >= limits.min && Number(k) <= limits.max && Number(k) % limits.step === 0 && typeof v === "number" && Number.isFinite(v) && v > 0),
      ),
      public_name: t.public_name != null && String(t.public_name).trim() ? whiteLabel(String(t.public_name)) : null,
      description: t.description_md != null && String(t.description_md).trim() ? whiteLabel(String(t.description_md)) : null,
      terms: t.terms_md != null ? whiteLabel(String(t.terms_md)) : null,
      instructions: t.instructions_md != null ? whiteLabel(String(t.instructions_md)) : null,
      recommendation_note: t.recommendation_note != null ? whiteLabel(String(t.recommendation_note)) : null,
      region, quality,
      speed_note: t.speed_note != null && String(t.speed_note).trim() ? String(t.speed_note) : null,
      drop_risk: dropRisk,
      drop_label: ["no_drop", "less_drop", "high_drop"].includes(String(t.drop_label)) ? String(t.drop_label) as PediaCatalogTier["drop_label"] : "unknown",
      speed_per_day: t.speed_per_day != null && String(t.speed_per_day).trim() ? String(t.speed_per_day).slice(0, 40) : null,
      avg_time: bound.avgTime,
      refill_mode: (Number(t.refill_days) || 0) <= 0 ? "none" : bound.apiRefill ? "api" : "manual",
      // Data terukur hanya ditampilkan bila sampel cukup (≥5 order/7 hari).
      success_pct: bound.orders >= 5 ? bound.success : null,
      refill_pct: bound.orders >= 5 ? bound.refill : null,
      input_kind: t.input_kind === "comments" ? "comments" : null,
      recommended: Number(t.is_recommended) === 1,
      price_per_1k: bound.rate > 0 ? computePediaPrice({
        supplierRatePer1k: bound.rate, quantity: 1000,
        markupPct: Number(t.markup_pct) || 0, minProfitRp: Number(t.min_profit_rp) || 0, minOrderRp,
      }) : null,
      price_ref: bound.rate > 0 && commentRefQty(products, t, limits) ? (() => { const q = commentRefQty(products, t, limits)!; return { qty: q, price: computePediaPrice({
        supplierRatePer1k: bound.rate, quantity: q,
        markupPct: Number(t.markup_pct) || 0, minProfitRp: Number(t.min_profit_rp) || 0, minOrderRp,
      }) }; })() : null,
      quick_quantities: [],
    });
    tiersByProduct.set(Number(t.product_id), list);
  }
  const out: PediaCatalogProduct[] = [];
  for (const p of products) {
    const allPackages = parseJsonArray(p.packages_json);
    const step = Number(p.step) || 1;
    const pt = tiersByProduct.get(Number(p.id)) ?? [];
    // Saring harga tersimpan ke paket produk + kelipatan step (kontrak lama
    // untuk pratinjau paket); DITAMBAH harga live per 1.000 untuk jumlah bebas.
    for (const t of pt) {
      const limits = pediaBounds({ min_qty: t.min_qty, max_qty: t.max_qty }, { quantity_step: t.quantity_step }, step);
      t.quantity_step = limits?.step ?? step;
      for (const k of Object.keys(t.prices)) {
        if (!allPackages.includes(Number(k)) || Number(k) % step !== 0) delete t.prices[k];
      }
      t.quick_quantities = allPackages.filter((qty) => qty >= (t.min_qty ?? 1) && qty <= (t.max_qty ?? qty) && qty % step === 0 && qty % (t.quantity_step ?? 1) === 0);
    }
    // Layanan tanpa harga tersimpan valid TIDAK ditawarkan (keamanan harga);
    // rekomendasi kurasi lebih dulu, lalu peringkat lama, lalu id.
    const availableTiers = pt
      .filter((t) => Object.keys(t.prices).length > 0)
      .sort((a, b) => Number(b.recommended) - Number(a.recommended)
        || (["hemat", "standar", "premium"].indexOf(a.tier) < 0 ? 3 : ["hemat", "standar", "premium"].indexOf(a.tier))
          - (["hemat", "standar", "premium"].indexOf(b.tier) < 0 ? 3 : ["hemat", "standar", "premium"].indexOf(b.tier))
        || a.id - b.id);
    const packages = allPackages.filter((qty) => availableTiers.some((t) => t.prices[String(qty)] > 0));
    if (!packages.length) continue;
    const minPrice = Math.min(...availableTiers.flatMap((t) => Object.values(t.prices)));
    out.push({
      slug: String(p.slug), platform: String(p.platform), metric: String(p.metric),
      target_kind: String(p.target_kind), name: whiteLabel(String(p.name)),
      tagline: p.tagline != null ? whiteLabel(String(p.tagline)) : null,
      description_md: p.description_md != null ? whiteLabel(String(p.description_md)) : null,
      packages, step: Number(p.step) || 1,
      checklist: ([parseJson(p.checklist_json, [])].flat().filter((c) => c && typeof c === "object") as { id: string; label: string; help?: string }[]).map((c) => ({ ...c, label: whiteLabel(String(c.label ?? "")), ...(typeof c.help === "string" ? { help: whiteLabel(c.help) } : {}) })),
      is_featured: Number(p.is_featured) || 0,
      tiers: availableTiers,
      min_price: Number.isFinite(minPrice) ? minPrice : null,
      image: platformCardImage(String(p.platform)),
    });
  }
  return NextResponse.json({ ok: true, products: out }, {
    headers: failed
      ? { "Cache-Control": "no-store" }
      : { "CDN-Cache-Control": "max-age=60", "Cache-Control": "public, max-age=30" },
  });
}
