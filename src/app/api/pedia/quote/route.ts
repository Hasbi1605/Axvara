// POST /api/pedia/quote — Quote bertanda tangan (PD-20, §9.7).
// Publik + rate-limit pedia:quote 30/mnt/IP. Validasi target, qty (min–max
// layanan, kelipatan step produk), kredit → quote JWT 30 menit.
import { pediaServiceTypeFor } from "@/lib/pedia/custom-comments";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { computePediaPrice } from "@/lib/pedia/pricing";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { isPediaProvider } from "@/lib/pedia/proxy";
import { isPediaSaleProvider } from "@/lib/pedia/sales-policy";
import { capturePediaServiceCopy } from "@/lib/pedia/service-copy";
import { pediaBounds } from "@/lib/pedia/bounds";
import { managedTermsFresh } from "@/lib/pedia/catalog-queries";
import { readJsonBody } from "@/lib/http-body";
import { checkCustomComments, CUSTOM_COMMENT_MAX_LINES } from "@/lib/pedia/custom-comments";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import { buildMethodCatalog } from "@/lib/payments/method-options";
import { serializePediaQuoteMethods } from "@/lib/pedia/payment-methods";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  product_slug: z.string().trim().min(1).max(80).optional(),
  product_id: z.coerce.number().int().min(1).optional(),
  tier_id: z.coerce.number().int().min(1),
  quantity: z.coerce.number().int().min(1).max(100_000_000),
  target: z.string().trim().min(1).max(600),
  credit_code: z.string().trim().max(20).optional().default(""),
  comments: z.string().max(9000).optional(),
}).refine((v) => v.product_slug || v.product_id, "Produk tidak valid");

export async function POST(req: NextRequest) {
  const locale = pediaApiLocale(req);
  if (!checkRateLimit(req, "pedia:quote")) {
    return NextResponse.json({ error: pick(locale, "Terlalu banyak permintaan, coba lagi 1 menit.", "Too many requests, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    return NextResponse.json({ error: pick(locale, "Pedia belum dibuka untuk order.", "Pedia is not open for orders yet.") }, { status: 503 });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const { tier_id, quantity, target, credit_code } = parsed.data;
  if (credit_code) return NextResponse.json({ error: "credits_retired", message: pick(locale, "Kode kredit tidak lagi digunakan. Hubungi admin untuk penanganan kode lama.", "Credit codes are no longer used. Contact admin for old codes.") }, { status: 410 });
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  const db = createDatabaseAccess();

  const product = parsed.data.product_slug
    ? await db.queryFirst(
      `SELECT * FROM pedia_products WHERE slug=? AND is_active=1`, parsed.data.product_slug,
    ).catch(() => null)
    : await db.queryFirst(
      `SELECT * FROM pedia_products WHERE id=? AND is_active=1`, parsed.data.product_id,
    ).catch(() => null);
  if (!product) return NextResponse.json({ error: pick(locale, "Produk tidak tersedia.", "Product is not available.") }, { status: 404 });
  const product_id = Number(product.id);
  const tier = await db.queryFirst(
    `SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`,
    tier_id, product_id,
  ).catch(() => null);
  if (!tier) return NextResponse.json({ error: pick(locale, "Tingkat kualitas tidak tersedia.", "This quality level is not available.") }, { status: 404 });
  if (!isPediaProvider(tier.supplier)) return NextResponse.json({ error: pick(locale, "Layanan sedang tidak tersedia.", "The service is temporarily unavailable.") }, { status: 409 });
  // INDO-POLICY-20: quotes are issued for the sale supplier only. Tier rows
  // still read both providers from DB (historical recovery), but a new quote
  // from the retired provider must requote on IndoSMM instead.
  if (!isPediaSaleProvider(tier.supplier)) return NextResponse.json({ error: "provider_retired", message: pick(locale, "Layanan ini sudah tidak dijual. Pilih layanan lain yang tersedia.", "This service is no longer sold. Choose another available service.") }, { status: 409 });
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type=? AND rate_idr_per_1k>0`,
    tier.supplier, Number(tier.supplier_service_id), pediaServiceTypeFor(tier.input_kind),
  ).catch(() => null);
  if (!live) return NextResponse.json({ error: pick(locale, "Layanan sedang tidak tersedia.", "The service is temporarily unavailable.") }, { status: 409 });
  // PSMM-P5: hanya baris OTOMATIS yang layak dijual boleh di-quote. Tier kurasi
  // (termasuk ProviderSMM lama) dan baris nonaktif tidak dapat dipakai walau
  // id-nya dipalsukan/di-tebak dari katalog lama.
  if (String(tier.managed ?? "curated") !== "auto") {
    return NextResponse.json({ error: "provider_retired", message: pick(locale, "Layanan ini sudah tidak dijual. Pilih layanan lain yang tersedia.", "This service is no longer sold. Choose another available service.") }, { status: 409 });
  }
  // Deskripsi resmi wajib tersedia (status `ok`); dibaca sekali dari snapshot.
  const { loadSupplierSnapshot } = await import("@/lib/pedia/metadata-refresh");
  const snapshot = await loadSupplierSnapshot(db).catch(() => ({
    descriptions: new Map<number, string>(), statuses: new Map<number, "ok" | "empty" | "oversize">(), fetchedAt: null as string | null,
  }));
  const officialDescription = snapshot.descriptions.get(Number(tier.supplier_service_id)) ?? null;
  if (snapshot.statuses.get(Number(tier.supplier_service_id)) !== "ok" || !officialDescription) {
    return NextResponse.json({ error: "service_unavailable", message: pick(locale, "Detail layanan belum tersedia. Pilih layanan lain.", "Service details are not available yet. Choose another service.") }, { status: 409 });
  }
  // PSMM-FINAL-PATCH C: bila snapshot syarat resmi sudah berubah tetapi baris ini
  // belum direkonsiliasi (antrean belum mengurasnya), quote BARU ditolak agar
  // syarat lama (mis. janji garansi) tidak dipakai menjual. Order tersimpan
  // tidak terpengaruh karena retry-nya dilayani sebelum gate ini.
  if (!managedTermsFresh(tier, snapshot.fetchedAt)) {
    return NextResponse.json({ error: "service_unavailable", message: pick(locale, "Syarat layanan sedang diperbarui. Coba lagi beberapa saat.", "Service terms are being updated. Please try again shortly.") }, { status: 409 });
  }

  // Validasi target: parser server + kecocokan target_kind (PD-02/AC-03).
  const detected = detectPediaLink(target, String(product.platform));
  if (!detected) {
    return NextResponse.json({ error: "unrecognized_link", message: pick(locale, "Kami belum mengenali link ini. Pilih platformnya di bawah.", "We do not recognize this link. Choose the platform below.") }, { status: 422 });
  }
  const needKind = String(product.target_kind);
  const kindOk = pediaTargetMatches(needKind, detected.targetKind, { platform: String(product.platform), metric: String(product.metric) });
  if (detected.platform !== String(product.platform) || !kindOk) {
    return NextResponse.json({
      error: "target_mismatch",
      message: pick(locale, `Ini link ${detected.targetKind}. Produk ini untuk ${needKind}. Mau tambah layanan yang cocok?`, `This is a ${detected.targetKind} link. This product is for ${needKind}. Add a matching service instead?`),
      detected: { platform: detected.platform, target_kind: detected.targetKind },
    }, { status: 422 });
  }

  // Qty: min–max layanan + kelipatan step produk (PD-06).
  const limits = pediaBounds(tier.input_kind === "comments" ? { ...live, max_qty: Math.min(Number(live.max_qty), CUSTOM_COMMENT_MAX_LINES) } : live, tier, Number(product.step));
  const minQty = limits?.min ?? 1;
  const maxQty = limits?.max ?? 0;
  const step = limits?.step ?? 1;
  if (!limits || quantity < minQty || quantity > maxQty) {
    return NextResponse.json({
      error: "quantity_out_of_range",
      message: pick(locale, `Minimal ${minQty}, maksimal ${maxQty} untuk kualitas ini.`, `Minimum ${minQty}, maximum ${maxQty} for this quality.`),
    }, { status: 422 });
  }
  if (quantity % step !== 0) {
    return NextResponse.json({
      error: "quantity_step",
      message: pick(locale, `Jumlah harus kelipatan ${step}.`, `Quantity must be a multiple of ${step}.`),
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
  // Komentar custom: wajib untuk layanan input_kind=comments, satu per baris, jumlah = quantity.
  let customComments: string[] | undefined;
  if (tier.input_kind === "comments") {
    const checked = checkCustomComments(parsed.data.comments ?? "", quantity, locale);
    if (!checked.ok) return NextResponse.json({ error: "invalid_comments", message: checked.error }, { status: 422 });
    customComments = checked.lines;
  }
  if (!Number.isFinite(total) || total <= 0) return NextResponse.json({ error: pick(locale, "Layanan sedang tidak tersedia.", "The service is temporarily unavailable.") }, { status: 409 });

  // Fase B (2026-11-07): katalog metode bersama Market. Hanya opsi TERSEDIA yang
  // ditandatangani; kanal/koin di luar batas tetap tampil nonaktif di `paymentMethods`.
  let catalog: Awaited<ReturnType<typeof buildMethodCatalog>> = [];
  try {
    catalog = await buildMethodCatalog(total);
  } catch {
    catalog = [];
  }
  // Pedia QRIS memakai provider aktif (`createActiveQrisInvoice`), bukan tabel
  // `payment_methods` Market; baris QRIS selalu ditawarkan seperti perilaku
  // sebelum fase B. Kegagalan provider tetap fail-closed saat create.
  if (!catalog.some((method) => method.id === "qris")) {
    catalog = [{
      id: "qris", kind: "qris" as const, label: "QRIS", sublabel: null,
      account_number: "qris", account_name: "QRIS", qris_url: null,
      currency: "IDR" as const, available: true as const,
    }, ...catalog];
  }
  const availableMethods = catalog.filter((method): method is Exclude<typeof method, { available: false }> => method.available);

  const { token, quoteId } = await createPediaQuoteToken({
    product_id, tier_id, quantity,
    target_raw: target.slice(0, 600),
    target_normalized: detected.normalized,
    unit_price: unitPrice, total,
    credit_code_hash: null, credit_used: 0,
    supplier: tier.supplier,
    supplier_service_id: Number(tier.supplier_service_id),
    supplier_rate_snapshot: Number(live.rate_idr_per_1k),
    managed: "auto",
    // PSMM-ACCEPTANCE-CLOSE 1: ikat versi syarat resmi ke quote bertanda tangan.
    ...(snapshot.fetchedAt ? { terms_version: snapshot.fetchedAt } : {}),
    refill_days: Number(tier.refill_days) || 0,
    min_profit_rp: Number(tier.min_profit_rp) || 0,
    supplier_target: tier.target_format === "username" ? new URL(detected.normalized).pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") : detected.normalized,
    refill_anchor: tier.refill_anchor === "completed" ? "completed" : "created",
    service_copy: capturePediaServiceCopy(product, tier, officialDescription),
    ...(customComments ? { custom_comments: customComments } : {}),
    payment_methods: serializePediaQuoteMethods(availableMethods),
    locale,
  });
  return NextResponse.json({
    ok: true, quote_token: token, quote_id: quoteId,
    total, payable: total, credit_used: 0,
    locale, paymentMethods: catalog,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
