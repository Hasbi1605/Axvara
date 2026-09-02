import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryAll, queryFirst, execRun } from "@/lib/db";
import { generateOrderCode as generateCode, aggregateQty } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  customer_name: z.string().trim().min(3).max(80),
  customer_wa: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), "No WA harus 08... atau +62... (10-15 digit)"),
  customer_email: z.string().trim().email().max(120).optional().or(z.literal("")),
  items: z.array(z.object({ product_id: z.coerce.number().int().min(1), qty: z.coerce.number().int().min(1).max(20) })).min(1).max(20),
  payment_method: z.enum(["qris", "ewallet", "bank:seabank", "bank:bca", "bank:mandiri", "bank:bri", "bank:bni", "qris", "ewallet"]),
  proof_url: z.string().trim().max(600).optional().nullable(),
});

// Simple in-memory rate limit per IP (edge isolate-safe best-effort) — with KV/WAF in prod
const hits = new Map<string, { c: number; t: number }>();
function rateLimit(ip: string, max = 10) {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > 60_000) {
    hits.set(ip, { c: 1, t: now });
    return true;
  }
  e.c++;
  if (e.c > max) return false;
  return true;
}
function clientIp(req: NextRequest) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}



export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 10)) return NextResponse.json({ error: "Terlalu banyak percobaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });

  const { customer_name, customer_wa, customer_email, items, payment_method, proof_url } = parsed.data;

  // Validate proof_url if provided — only /r2/ or https allowed
  if (proof_url && !/^(\/r2\/|https:\/\/)/.test(proof_url)) {
    return NextResponse.json({ error: "URL bukti tidak valid" }, { status: 400 });
  }

  const agg = aggregateQty(items as { product_id: number; qty: number }[]);

  // Server-authoritative pricing: fetch each product from DB
  let subtotal = 0;
  const snapshot: { product_id: number; name: string; price: number; qty: number }[] = [];
  for (const [pid, totalQty] of agg.entries()) {
    const row = (await queryFirst("SELECT p.*, c.slug as cat_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?", pid)) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: `Produk #${pid} tidak ditemukan` }, { status: 404 });
    if ((row.is_active as number) === 0) return NextResponse.json({ error: `${row.name} sedang nonaktif` }, { status: 400 });
    const stock = row.stock as number;
    if (stock !== -1 && stock !== null && stock <= 0) return NextResponse.json({ error: `${row.name} stok habis` }, { status: 400 });
    if (stock !== -1 && stock !== null && totalQty > stock) return NextResponse.json({ error: `${row.name} stok tersisa ${stock} (diminta ${totalQty})` }, { status: 400 });
    const price = Number(row.price);
    subtotal += price * totalQty;
    snapshot.push({ product_id: Number(row.id), name: String(row.name), price, qty: totalQty });
  }

  // Normalize WA to 62
  let wa = customer_wa.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);

  const code = generateCode();
  const pm = String(payment_method);
  const accountMap: Record<string, string> = {
    qris: "",
    ewallet: "082135277434",
    "bank:seabank": "901812349386",
    "bank:bca": "",
    "bank:mandiri": "",
    "bank:bri": "",
    "bank:bni": "",
  };
  const payment_account = accountMap[pm] ?? pm;

  try {
    await execRun(
      `INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,proof_url,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      code,
      customer_name,
      wa,
      customer_email || null,
      JSON.stringify(snapshot),
      subtotal,
      pm,
      payment_account,
      proof_url ?? null,
      "pending"
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) return NextResponse.json({ error: "Kode pesanan bentrok, coba lagi." }, { status: 409 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ code, subtotal, status: "pending" }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 20)) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (code) {
    if (!/^AXV-\d{8}-[A-Z0-9]{4,8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
    const row = (await queryFirst("SELECT * FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
    return NextResponse.json({
      order: {
        code: row.code,
        customer_name: row.customer_name,
        customer_wa: row.customer_wa,
        customer_email: row.customer_email,
        items: JSON.parse(String(row.items || "[]")),
        subtotal: row.subtotal,
        payment_method: row.payment_method,
        payment_account: row.payment_account,
        proof_url: row.proof_url,
        status: row.status,
        created_at: row.created_at,
      },
    });
  }
  // Without code, don't leak all orders — require admin endpoint
  return NextResponse.json({ error: "Gunakan ?code=AXV-... atau akses via admin." }, { status: 400 });
}
