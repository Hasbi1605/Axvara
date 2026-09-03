import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst } from "@/lib/db";
import { createCheckoutQuoteToken } from "@/lib/auth";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const itemSchema = z.object({
  product_id: z.coerce.number().int().min(1).optional(),
  slug: z.string().trim().min(1).max(100).optional(),
  qty: z.coerce.number().int().min(1).max(20),
  expected_price: z.coerce.number().int().min(0).optional(),
}).refine((item) => item.product_id || item.slug, "Produk tidak valid");

const schema = z.object({ items: z.array(itemSchema).min(1).max(20) });

type QuoteIssue = {
  product_id?: number;
  type: "missing" | "inactive" | "out_of_stock" | "insufficient_stock" | "invalid_quantity";
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
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }

  const aggregate = new Map<string, z.infer<typeof itemSchema>>();
  for (const item of parsed.data.items) {
    const key = item.slug ? `slug:${item.slug}` : `id:${item.product_id}`;
    const current = aggregate.get(key);
    aggregate.set(key, current ? { ...current, qty: current.qty + item.qty } : item);
  }

  let subtotal = 0;
  const quotedItems: { product_id: number; name: string; price: number; qty: number; stock: number; image: string }[] = [];
  const issues: QuoteIssue[] = [];
  const changes: PriceChange[] = [];

  for (const item of aggregate.values()) {
    if (item.qty > 20) {
      issues.push({ product_id: item.product_id, type: "invalid_quantity", message: "Maksimal 20 unit per produk." });
      continue;
    }
    const row = (item.slug
      ? await queryFirst("SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=?", item.slug)
      : await queryFirst("SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", item.product_id)) as Record<string, unknown> | undefined;

    if (!row) {
      issues.push({ product_id: item.product_id, type: "missing", message: "Produk tidak ditemukan." });
      continue;
    }
    const productId = Number(row.id);
    if (Number(row.is_active) === 0) {
      issues.push({ product_id: productId, type: "inactive", message: `${row.name} sedang nonaktif.` });
      continue;
    }
    const stock = row.stock == null ? -1 : Number(row.stock);
    if (stock !== -1 && stock <= 0) {
      issues.push({ product_id: productId, type: "out_of_stock", message: `${row.name} stok habis.` });
      continue;
    }
    if (stock !== -1 && item.qty > stock) {
      issues.push({ product_id: productId, type: "insufficient_stock", message: `${row.name} stok tersisa ${stock} (diminta ${item.qty}).` });
      continue;
    }

    const price = Number(row.price);
    if (item.expected_price != null && item.expected_price !== price) {
      changes.push({
        product_id: productId,
        name: String(row.name),
        previous_price: item.expected_price,
        current_price: price,
        message: `Harga ${row.name} berubah.`,
      });
    }
    subtotal += price * item.qty;
    quotedItems.push({
      product_id: productId,
      name: String(row.name),
      price,
      qty: item.qty,
      stock,
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
    .filter((method) => method.id !== "qris" || Boolean(method.qris_url));

  if (issues.length > 0) {
    return NextResponse.json({ ok: false, issues, items: quotedItems, subtotal, paymentMethods }, { status: 409 });
  }
  if (paymentMethods.length === 0) {
    return NextResponse.json({ error: "Metode pembayaran sedang tidak tersedia." }, { status: 503 });
  }

  const signed = await createCheckoutQuoteToken({
    items: quotedItems.map(({ product_id, name, price, qty }) => ({ product_id, name, price, qty })),
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
