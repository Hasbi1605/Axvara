import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, isD1Mode } from "@/lib/db";
import { isVariantsReadEnabled } from "@/lib/catalog";
import { createCheckoutQuoteToken } from "@/lib/auth";
import { isDanaQrisConfigured } from "@/lib/payments/dana-qris";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  product_id: z.coerce.number().int().min(1).optional(),
  variant_id: z.coerce.number().int().min(1).optional(),
  slug: z.string().trim().min(1).max(100).optional(),
  qty: z.coerce.number().int().min(1).max(20),
  expected_price: z.coerce.number().int().min(0).optional(),
}).refine((item) => item.product_id || item.slug, "Produk tidak valid");

const schema = z.object({ items: z.array(itemSchema).min(1).max(20) });

type QuoteIssue = {
  product_id?: number;
  type: "missing" | "inactive" | "out_of_stock" | "insufficient_stock" | "invalid_quantity" | "variant_required";
  message: string;
};

type PriceChange = {
  product_id: number;
  name: string;
  previous_price: number;
  current_price: number;
  message: string;
};

export async function POST(req: NextRequest) {
  // Quote tanpa limit = enumerasi harga/stok gratis (issue #14): 20/mnt/IP
  // sebagai lapis kedua setelah 1 rule WAF Free (lihat ARCHITECTURE §9).
  if (!checkRateLimit(req, "checkout:quote")) {
    return NextResponse.json({ error: "Terlalu banyak permintaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  // Batasi body agar quote 20 item tidak dipakai untuk membanjiri D1.
  const rawLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(rawLength) && rawLength > 32_000) {
    return NextResponse.json({ error: "Payload terlalu besar" }, { status: 413 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }

  const aggregate = new Map<string, z.infer<typeof itemSchema>>();
  for (const item of parsed.data.items) {
    const key = item.variant_id
      ? `${item.slug ? `slug:${item.slug}` : `id:${item.product_id}`}:var:${item.variant_id}`
      : item.slug ? `slug:${item.slug}` : `id:${item.product_id}`;
    const current = aggregate.get(key);
    aggregate.set(key, current ? { ...current, qty: current.qty + item.qty } : item);
  }

  let subtotal = 0;
  const quotedItems: { product_id: number; variant_id?: number; name: string; price: number; qty: number; stock: number; image: string }[] = [];
  const issues: QuoteIssue[] = [];
  const changes: PriceChange[] = [];
  const variantsRequired = isD1Mode() && isVariantsReadEnabled();

  // N+1 guard (issue #14): D1 Free hanya 50 query/invocation. Quote 20
  // item × (1 produk + 1 varian) = 40 query berurutan sudah mendekati batas
  // sebelum menghitung payment_methods. Kumpulkan dulu semua id/slug unik,
  // lalu ambil produk + varian dalam 2 query IN — total tetap 3 query untuk
  // berapa pun jumlah item.
  // D1 membatasi 100 bound parameter per query (issue #14): 20 slug × ~50
  // byte masih aman, tapi potong batch agar pola IN (...) tidak pernah
  // melewati batas saat item bertambah.
  const productIds = new Set<number>();
  const productSlugs = new Set<string>();
  const variantIds = new Set<number>();
  for (const item of aggregate.values()) {
    if (item.variant_id) variantIds.add(item.variant_id);
    if (item.slug) productSlugs.add(item.slug.slice(0, 100));
    else if (item.product_id) productIds.add(item.product_id);
  }
  const productById = new Map<number, Record<string, unknown>>();
  const productBySlug = new Map<string, Record<string, unknown>>();
  if (productIds.size > 0) {
    const rows = await queryAll(
      `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id IN (${[...productIds].map(() => "?").join(",")})`,
      ...[...productIds],
    );
    for (const row of rows) {
      productById.set(Number(row.id), row);
      productBySlug.set(String(row.slug), row);
    }
  }
  if (productSlugs.size > 0) {
    const rows = await queryAll(
      `SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug IN (${[...productSlugs].map(() => "?").join(",")})`,
      ...[...productSlugs],
    );
    for (const row of rows) {
      productById.set(Number(row.id), row);
      productBySlug.set(String(row.slug), row);
    }
  }
  const variantById = new Map<number, Record<string, unknown>>();
  if (variantIds.size > 0) {
    const rows = await queryAll(
      `SELECT * FROM product_variants WHERE id IN (${[...variantIds].map(() => "?").join(",")})`,
      ...[...variantIds],
    );
    for (const row of rows) variantById.set(Number(row.id), row);
  }

  for (const item of aggregate.values()) {
    if (item.qty > 20) {
      issues.push({ product_id: item.product_id, type: "invalid_quantity", message: "Maksimal 20 unit per produk." });
      continue;
    }
    const row = item.slug ? productBySlug.get(item.slug) : item.product_id ? productById.get(item.product_id) : undefined;

    if (!row) {
      issues.push({ product_id: item.product_id, type: "missing", message: "Produk tidak ditemukan." });
      continue;
    }
    const productId = Number(row.id);
    if (Number(row.is_active) === 0) {
      issues.push({ product_id: productId, type: "inactive", message: `${row.name} sedang nonaktif.` });
      continue;
    }

    if (variantsRequired && !item.variant_id) {
      issues.push({
        product_id: productId,
        type: "variant_required",
        message: `Pilih varian ${row.name} dari halaman detail produk.`,
      });
      continue;
    }

    let effectivePrice = Number(row.price);
    let effectiveStock = row.stock == null ? -1 : Number(row.stock);
    let displayName = String(row.name);

    // If variant_id is provided, validate variant against product
    if (item.variant_id) {
      const variantRow = variantById.get(item.variant_id);
      if (!variantRow || Number(variantRow.product_id) !== productId) {
        issues.push({ product_id: productId, type: "missing", message: `Varian tidak ditemukan untuk ${row.name}.` });
        continue;
      }
      if (Number(variantRow.is_active) === 0) {
        issues.push({ product_id: productId, type: "inactive", message: `${row.name} — ${variantRow.label} sedang nonaktif.` });
        continue;
      }
      effectivePrice = Number(variantRow.price);
      effectiveStock = variantRow.stock == null ? -1 : Number(variantRow.stock);
      displayName = `${row.name} — ${variantRow.label}`;
    }

    if (effectiveStock !== -1 && effectiveStock <= 0) {
      issues.push({ product_id: productId, type: "out_of_stock", message: `${displayName} stok habis.` });
      continue;
    }
    if (effectiveStock !== -1 && item.qty > effectiveStock) {
      issues.push({ product_id: productId, type: "insufficient_stock", message: `${displayName} stok tersisa ${effectiveStock} (diminta ${item.qty}).` });
      continue;
    }

    if (item.expected_price != null && item.expected_price !== effectivePrice) {
      changes.push({
        product_id: productId,
        name: displayName,
        previous_price: item.expected_price,
        current_price: effectivePrice,
        message: `Harga ${displayName} berubah.`,
      });
    }
    subtotal += effectivePrice * item.qty;
    quotedItems.push({
      product_id: productId,
      variant_id: item.variant_id,
      name: displayName,
      price: effectivePrice,
      qty: item.qty,
      stock: effectiveStock,
      image: String(row.image_url ?? ""),
    });
  }

  const paymentMethods = (await queryAll("SELECT * FROM payment_methods WHERE is_active=1 ORDER BY sort_order ASC"))
    .map((row) => ({
      id: String(row.id),
      label: String(row.label ?? ""),
      account_number: String(row.account_number ?? ""),
      account_name: String(row.account_name ?? ""),
      qris_url: row.qris_url ? String(row.qris_url) : null,
    }))
    .filter((method) => method.id !== "qris" || isDanaQrisConfigured());

  if (issues.length > 0) {
    return NextResponse.json({ ok: false, issues, items: quotedItems, subtotal, paymentMethods }, { status: 409 });
  }
  if (paymentMethods.length === 0) {
    return NextResponse.json({ error: "Metode pembayaran sedang tidak tersedia." }, { status: 503 });
  }

  const signed = await createCheckoutQuoteToken({
    items: quotedItems.map(({ product_id, variant_id, name, price, qty }) => ({ product_id, variant_id, name, price, qty })),
    subtotal,
    payment_methods: paymentMethods.map(({ id, account_number }) => ({ id, account_number })),
  });

  return NextResponse.json({
    ok: true,
    items: quotedItems,
    subtotal,
    paymentMethods,
    changes,
    quoteToken: signed.token,
    quoteExpiresAt: new Date(signed.expiresAt * 1000).toISOString(),
  });
}
