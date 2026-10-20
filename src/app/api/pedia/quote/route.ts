// POST /api/pedia/quote — Quote bertanda tangan (PD-20, §9.7).
// Publik + rate-limit pedia:quote 30/mnt/IP. Validasi target, qty (min–max
// layanan, kelipatan step produk), kredit → quote JWT 30 menit.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { isPediaSaleProvider, PEDIA_SALE_PROVIDER } from "@/lib/pedia/sales-policy";
import { capturePediaServiceCopy } from "@/lib/pedia/service-copy";
import { pediaBounds } from "@/lib/pedia/bounds";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  product_slug: z.string().trim().min(1).max(80).optional(),
  product_id: z.coerce.number().int().min(1).optional(),
  tier_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
  target: z.string().trim().min(1).max(600),
  credit_code: z.string().trim().max(20).optional().default(""),
}).refine((v) => v.product_slug || v.product_id, "Produk tidak valid");

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "pedia:quote")) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    return NextResponse.json({ error: "Pedia belum dibuka untuk order." }, { status: 503 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const { tier_id, quantity, target, credit_code } = parsed.data;
  const db = createDatabaseAccess();

  const product = parsed.data.product_slug
    ? await db.queryFirst(
      `SELECT * FROM pedia_products WHERE slug=? AND is_active=1`, parsed.data.product_slug,
    ).catch(() => null)
    : await db.queryFirst(
      `SELECT * FROM pedia_products WHERE id=? AND is_active=1`, parsed.data.product_id,
    ).catch(() => null);
  if (!product) return NextResponse.json({ error: "Produk tidak tersedia." }, { status: 404 });
  const product_id = Number(product.id);
  const tier = await db.queryFirst(
    `SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`,
    tier_id, product_id,
  ).catch(() => null);
  if (!tier) return NextResponse.json({ error: "Tingkat kualitas tidak tersedia." }, { status: 404 });
  if (!isPediaProvider(tier.supplier)) return NextResponse.json({ error: "Layanan sedang tidak tersedia." }, { status: 409 });
  // INDO-POLICY-20: quotes are issued for the sale supplier only. Tier rows
  // still read both providers from DB (historical recovery), but a new quote
  // from the retired provider must requote on IndoSMM instead.
  if (!isPediaSaleProvider(tier.supplier)) return NextResponse.json({ error: "provider_retired", message: `Layanan ${String(tier.supplier)} sudah tidak dijual. Pilih layanan ${PEDIA_SALE_PROVIDER} yang tersedia.` }, { status: 409 });
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type='Default' AND rate_idr_per_1k>0`,
    tier.supplier, Number(tier.supplier_service_id),
  ).catch(() => null);
  if (!live) return NextResponse.json({ error: "Layanan sedang tidak tersedia." }, { status: 409 });

  // Validasi target: parser server + kecocokan target_kind (PD-02/AC-03).
  const detected = detectPediaLink(target, String(product.platform));
  if (!detected) {
    return NextResponse.json({ error: "unrecognized_link", message: "Kami belum mengenali link ini. Pilih platformnya di bawah." }, { status: 422 });
  }
  const needKind = String(product.target_kind);
  const kindOk = pediaTargetMatches(needKind, detected.targetKind, { platform: String(product.platform), metric: String(product.metric) });
  if (detected.platform !== String(product.platform) || !kindOk) {
    return NextResponse.json({
      error: "target_mismatch",
      message: `Ini link ${detected.targetKind}. Produk ini untuk ${needKind}. Mau tambah layanan yang cocok?`,
      detected: { platform: detected.platform, target_kind: detected.targetKind },
    }, { status: 422 });
  }

  // Qty: min–max layanan + kelipatan step produk (PD-06).
  const limits = pediaBounds(live, tier, Number(product.step));
  const minQty = limits?.min ?? 1;
  const maxQty = limits?.max ?? 0;
  const step = limits?.step ?? 1;
  if (!limits || quantity < minQty || quantity > maxQty) {
    return NextResponse.json({
      error: "quantity_out_of_range",
      message: `Minimal ${minQty}, maksimal ${maxQty} untuk kualitas ini.`,
    }, { status: 422 });
  }
  if (quantity % step !== 0) {
    return NextResponse.json({
      error: "quantity_step",
      message: `Jumlah harus kelipatan ${step}.`,
    }, { status: 422 });
  }

  const minOrderRp = Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000;
  const total = computePediaPrice({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp,
  });
  const unitPrice = total / quantity;
  if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: "Layanan sedang tidak tersedia." }, { status: 409 });

  // Kredit (terlipat "Punya kode kredit?" — PD-11). Sisa kredit yang tidak
  // habis tetap tersimpan (hanya dipakai sebesar total).
  let creditUsed = 0;
  let creditHash: string | null = null;
  let creditRemaining: number | null = null;
  if (credit_code) {
    const { checkPediaCredit, sha256Hex } = await import("@/lib/pedia/credits");
    const check = await checkPediaCredit(db, credit_code);
    if (!check || check.remaining <= 0) {
      return NextResponse.json({ error: "Kode kredit tidak valid atau sudah habis." }, { status: 422 });
    }
    creditUsed = Math.min(check.remaining, total);
    creditHash = await sha256Hex(credit_code.trim().toUpperCase());
    creditRemaining = check.remaining - creditUsed;
  }

  const { token, quoteId } = await createPediaQuoteToken({
    product_id, tier_id, quantity,
    target_raw: target.slice(0, 600),
    target_normalized: detected.normalized,
    unit_price: unitPrice, total,
    credit_code_hash: creditHash, credit_used: creditUsed,
    supplier: tier.supplier,
    supplier_service_id: Number(tier.supplier_service_id),
    supplier_rate_snapshot: Number(live.rate_idr_per_1k),
    refill_days: Number(tier.refill_days) || 0,
    min_profit_rp: Number(tier.min_profit_rp) || 0,
    supplier_target: tier.target_format === "username" ? new URL(detected.normalized).pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") : detected.normalized,
    refill_anchor: tier.refill_anchor === "completed" ? "completed" : "created",
    service_copy: capturePediaServiceCopy(product, tier),
  });
  return NextResponse.json({
    ok: true, quote_token: token, quote_id: quoteId,
    total, payable: total - creditUsed, credit_used: creditUsed,
    credit_remaining: creditRemaining,
  });
}
