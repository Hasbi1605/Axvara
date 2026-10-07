// POST /api/pedia/quote — Quote bertanda tangan (PD-20, §9.7).
// Publik + rate-limit pedia:quote 30/mnt/IP. Validasi target, qty (min–max
// layanan, kelipatan step produk), kredit → quote JWT 30 menit.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { detectPediaLink } from "@/lib/pedia/link";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { createPediaQuoteToken } from "@/lib/pedia/quote";

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
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=? AND present=1`,
    Number(tier.supplier_service_id),
  ).catch(() => null);
  if (!live) return NextResponse.json({ error: "Layanan sedang tidak tersedia." }, { status: 409 });

  // Validasi target: parser server + kecocokan target_kind (PD-02/AC-03).
  const detected = detectPediaLink(target);
  if (!detected) {
    return NextResponse.json({ error: "unrecognized_link", message: "Kami belum mengenali link ini. Pilih platformnya di bawah." }, { status: 422 });
  }
  const needKind = String(product.target_kind);
  const kindOk =
    needKind === detected.targetKind ||
    (needKind === "profile" && detected.targetKind === "channel") ||
    (needKind === "post" && (detected.targetKind === "video" || detected.targetKind === "reel")) ||
    (needKind === "video" && (detected.targetKind === "post" || detected.targetKind === "reel"));
  if (detected.platform !== String(product.platform) || !kindOk) {
    return NextResponse.json({
      error: "target_mismatch",
      message: `Ini link ${detected.targetKind}. Produk ini untuk ${needKind}. Mau tambah layanan yang cocok?`,
      detected: { platform: detected.platform, target_kind: detected.targetKind },
    }, { status: 422 });
  }

  // Qty: min–max layanan + kelipatan step produk (PD-06).
  const minQty = Number(live.min_qty) || 1;
  const maxQty = Number(live.max_qty) || quantity;
  const step = Number(product.step) || 1;
  if (quantity < minQty || quantity > maxQty) {
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
    supplier: "providersmm",
    supplier_service_id: Number(tier.supplier_service_id),
    supplier_rate_snapshot: Number(live.rate_idr_per_1k),
  });
  return NextResponse.json({
    ok: true, quote_token: token, quote_id: quoteId,
    total, payable: total - creditUsed, credit_used: creditUsed,
    credit_remaining: creditRemaining,
  });
}
