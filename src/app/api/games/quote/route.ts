// POST /api/games/quote — quote bertanda tangan untuk satu SKU Games.
// Validasi registry (field + brand) dan SKU live; harga = sell_price.
// P9: selama Digiflazz belum siap, quote ditutup 503 `games_preview`.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { readJsonBody } from "@/lib/http-body";
import { gamesOrderingOpen, gamesPreviewResponse } from "@/lib/games/ordering";
import { createGamesQuoteToken } from "@/lib/games/quote";
import { gamesBrandMatches, gamesRegistryGame, validateGamesFields } from "@/lib/games/registry";
import { pediaApiLocale, pick } from "@/lib/pedia/api-locale";
import type { Locale } from "@/lib/i18n/locale";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WA_PATTERN = /^(\+62|62|0)8\d{8,13}$/;

const schemaFor = (locale: Locale) => z.object({
  slug: z.string().trim().min(1).max(40),
  buyer_sku_code: z.string().trim().min(1).max(32),
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
  whatsapp: z.string().trim().transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => WA_PATTERN.test(s), pick(locale, "No WA harus 08... atau +62... (10-15 digit)", "WhatsApp number must start with 08... or +62... (10-15 digits)")),
  email: z.string().trim().email(pick(locale, "Tulis email aktif yang benar.", "Enter a valid active email.")).max(160),
  nickname: z.string().trim().max(64).optional(),
  locale: z.enum(["id", "en"]).optional(),
});

function normalizeWa(raw: string): string {
  let wa = raw.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);
  return wa;
}

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
  const parsed = schemaFor(locale).safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? pick(locale, "Validasi gagal", "Validation failed") }, { status: 400 });
  }
  const { slug, buyer_sku_code, fields, whatsapp, email, nickname } = parsed.data;
  const quoteLocale: Locale = parsed.data.locale ?? locale;
  if (!process.env.ADMIN_JWT_SECRET && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: pick(locale, "Checkout sementara tidak tersedia.", "Checkout is temporarily unavailable.") }, { status: 503 });
  }
  const game = gamesRegistryGame(slug);
  if (!game) {
    return NextResponse.json({ error: "game_unavailable", message: pick(locale, "Game tidak ditemukan.", "Game not found.") }, { status: 404 });
  }
  const validated = validateGamesFields(game, fields);
  if (!validated.ok) {
    return NextResponse.json({ error: "invalid_fields", field: validated.field, message: validated.message[locale] }, { status: 422 });
  }
  const db = createDatabaseAccess();
  const product = await db.queryFirst(
    `SELECT id, buyer_sku_code, game_brand, cost, sell_price, seller_active, enabled FROM games_products WHERE buyer_sku_code=?`,
    buyer_sku_code,
  ).catch(() => null);
  if (!product || Number(product.enabled) !== 1 || !gamesBrandMatches(game, product.game_brand)
    || Number(product.seller_active) !== 1 || Number(product.cost) <= 0 || Number(product.sell_price) <= 0) {
    return NextResponse.json({
      error: "sku_unavailable",
      message: pick(locale, "Nominal ini sedang tidak tersedia. Pilih nominal lain.", "This amount is unavailable. Choose another amount."),
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  }
  const unitPrice = Number(product.sell_price);
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
    return NextResponse.json({ error: "sku_unavailable", message: pick(locale, "Nominal ini sedang tidak tersedia.", "This amount is unavailable.") }, { status: 409 });
  }
  const customerNickname = nickname && nickname.trim() ? nickname.trim() : null;
  const { token, quoteId } = await createGamesQuoteToken({
    product_id: Number(product.id),
    buyer_sku_code: String(product.buyer_sku_code),
    slug: game.slug,
    customer_no: validated.customerNo,
    customer_wa: normalizeWa(whatsapp),
    customer_email: email,
    customer_nickname: customerNickname,
    unit_price: unitPrice,
    total: unitPrice,
    methods: ["qris"],
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
    game: { slug: game.slug, name: game.name, publisher: game.publisher },
    payment_methods: [{ id: "qris", kind: "qris", label: "QRIS", currency: "IDR", available: true }],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
