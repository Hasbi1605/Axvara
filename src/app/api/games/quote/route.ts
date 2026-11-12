// POST /api/games/quote — quote bertanda tangan untuk satu varian Sekalipay H2H.
// Order baru hanya menerima supplier SK; baris/quote Digiflazz lama tidak
// pernah di-remap. Field divalidasi dari kontrak per-varian (teks), target
// disimpan di token sehingga perubahan kontrak/harga = quote_stale saat order.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { gamesOrderingOpen, gamesPreviewResponse } from "@/lib/games/ordering";
import { createGamesQuoteToken } from "@/lib/games/quote";
import {
  gamesRegistryGame,
  gamesSkContractDigest,
  parseGamesSkContract,
  validateGamesSkTarget,
} from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import { serializePediaQuoteMethods } from "@/lib/pedia/payment-methods";
import { buildMethodCatalog } from "@/lib/payments/method-options";
import type { Locale } from "@/lib/i18n/locale";
import { isGamesNicknameProduct, sanitizeGamesNickname } from "@/lib/games/sellable";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  slug: z.string().trim().min(1).max(64),
  buyer_sku_code: z.string().trim().min(1).max(32),
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
  nickname: z.string().trim().max(64).optional(),
  locale: z.enum(["id", "en"]).optional(),
});

export async function POST(req: NextRequest) {
  const locale = pediaApiLocale(req);
  if (!checkRateLimit(req, "games:quote")) {
    return NextResponse.json({ error: pick(locale, "Terlalu banyak permintaan, coba lagi 1 menit.", "Too many requests, try again in 1 minute.") }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (!gamesOrderingOpen()) {
    return NextResponse.json(gamesPreviewResponse(locale), { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
  const body = await readJsonBody(req);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? pick(locale, "Validasi gagal", "Validation failed") }, { status: 400 });
  }
  const { slug, buyer_sku_code, fields, nickname } = parsed.data;
  const quoteLocale: Locale = parsed.data.locale ?? locale;
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  }
  const db = createDatabaseAccess();
  const product = await db.queryFirst(
    `SELECT id, buyer_sku_code, product_name, sk_product_name, game_slug, cost, sell_price, supplier,
            supplier_active, stock, min_order, required_fields_json, enabled
       FROM games_products WHERE buyer_sku_code=?`,
    buyer_sku_code,
  ).catch(() => null);
  if (product && isGamesNicknameProduct(product)) {
    return NextResponse.json({ error: "not_sellable" }, { status: 409 });
  }
  const contract = product ? parseGamesSkContract(product.required_fields_json) : null;
  if (!product || String(product.supplier ?? "") !== "sekalipay" || Number(product.enabled) !== 1
    || Number(product.supplier_active) !== 1 || !(Number(product.stock) === -1 || Number(product.stock) > 0) || Number(product.min_order) !== 1
    || Number(product.cost) <= 0 || Number(product.sell_price) <= 0
    || String(product.game_slug ?? "") !== slug || !contract?.supported) {
    return NextResponse.json({
      error: "sku_unavailable",
      message: pick(locale, "Nominal ini sedang tidak tersedia. Pilih nominal lain.", "This amount is unavailable. Choose another amount."),
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const target = validateGamesSkTarget(contract, fields);
  if (!target.ok) {
    return NextResponse.json({
      error: "invalid_fields",
      field: target.field,
      message: pick(locale, "Data akun tidak valid. Periksa ID/server.", "The account details are invalid. Check the ID/server."),
    }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }
  const unitPrice = Number(product.sell_price);
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
    return NextResponse.json({ error: "sku_unavailable", message: pick(locale, "Nominal ini sedang tidak tersedia.", "This amount is unavailable.") }, { status: 409 });
  }
  const cost = Number(product.cost);
  const variantId = Number(String(product.buyer_sku_code).replace(/^sk:/, ""));
  if (!Number.isSafeInteger(variantId) || variantId <= 0) {
    return NextResponse.json({ error: "sku_unavailable" }, { status: 409 });
  }
  const customerNickname = nickname ? sanitizeGamesNickname(nickname) || null : null;
  let catalog: Awaited<ReturnType<typeof buildMethodCatalog>> = [];
  try { catalog = await buildMethodCatalog(unitPrice); } catch { /* Native QRIS remains available. */ }
  if (!catalog.some((method) => method.id === "qris")) {
    catalog.unshift({ id: "qris", kind: "qris", label: "QRIS", sublabel: null,
      account_number: "qris", account_name: "QRIS", qris_url: null, currency: "IDR", available: true });
  }
  const paymentMethods = serializePediaQuoteMethods(catalog.filter((method): method is Exclude<typeof method, { available: false }> => method.available));
  const registry = gamesRegistryGame(slug);
  const { token, quoteId } = await createGamesQuoteToken({
    supplier: "sekalipay",
    sk_variant_id: variantId,
    target_snapshot: target.target,
    contract_digest: await gamesSkContractDigest(product.required_fields_json),
    cost_snapshot: cost,
    product_id: Number(product.id),
    buyer_sku_code: String(product.buyer_sku_code),
    slug,
    customer_no: target.display,
    customer_nickname: customerNickname,
    unit_price: unitPrice,
    total: unitPrice,
    methods: paymentMethods.map((method) => method.id),
    payment_methods: paymentMethods,
    locale: quoteLocale,
  });
  return NextResponse.json({
    ok: true,
    quote_token: token,
    quote_id: quoteId,
    total: unitPrice,
    payable: unitPrice,
    currency: "IDR",
    locale: quoteLocale,
    game: { slug, name: registry?.name ?? String(product.sk_product_name ?? product.product_name ?? ""), publisher: registry?.publisher ?? "" },
    sku: { buyer_sku_code: String(product.buyer_sku_code), name: String(product.product_name), price: unitPrice },
    paymentMethods: catalog,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
