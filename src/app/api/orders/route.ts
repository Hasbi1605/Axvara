import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOrderWithStock, queryFirst, StockReservationError } from "@/lib/db";
import { generateOrderCode as generateCode, aggregateQty } from "@/lib/security";
import { verifyCheckoutQuoteToken } from "@/lib/auth";

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
  payment_method: z.string().trim().regex(/^(qris|ewallet|bank:[a-z0-9][a-z0-9_-]{0,31})$/, "Metode pembayaran tidak valid"),
  proof_url: z.string().trim().min(1, "Bukti transfer wajib diupload").max(600),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(8000),
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

  const { customer_name, customer_wa, customer_email, items, payment_method, proof_url, quote_token } = parsed.data;

  // Proofs are private R2 objects. External URLs would bypass the protected
  // admin viewer and could be used as a tracking pixel.
  if (!proof_url.startsWith("/r2/bukti/") || proof_url.includes("..")) {
    return NextResponse.json({ error: "URL bukti tidak valid" }, { status: 400 });
  }

  const quote = await verifyCheckoutQuoteToken(quote_token);
  if (!quote) {
    return NextResponse.json({ error: "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout." }, { status: 409 });
  }

  const requested = aggregateQty(items as { product_id: number; qty: number }[]);
  const quoted = aggregateQty(quote.items);
  const sameItems = requested.size === quoted.size
    && [...requested.entries()].every(([productId, qty]) => quoted.get(productId) === qty);
  if (!sameItems) {
    return NextResponse.json({ error: "Isi keranjang berubah setelah harga dikunci. Muat ulang checkout." }, { status: 409 });
  }

  // Normalize WA to 62
  let wa = customer_wa.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);

  const code = generateCode();
  const pm = String(payment_method);
  const paymentId = pm.startsWith("bank:") ? pm.slice(5) : pm;
  const payment = quote.payment_methods.find((method) => method.id === paymentId);
  if (!payment) {
    return NextResponse.json({ error: "Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout." }, { status: 409 });
  }

  try {
    await createOrderWithStock({
      code,
      quoteId: quote.quote_id,
      customerName: customer_name,
      customerWa: wa,
      customerEmail: customer_email || null,
      items: quote.items,
      subtotal: quote.subtotal,
      paymentMethod: pm,
      paymentAccount: payment.account_number,
      proofUrl: proof_url,
    });
  } catch (e: unknown) {
    if (e instanceof StockReservationError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      const existing = await queryFirst("SELECT code,subtotal,status FROM orders WHERE quote_id=?", quote.quote_id);
      if (existing) {
        return NextResponse.json({ code: existing.code, subtotal: existing.subtotal, status: existing.status, reused: true }, { status: 200 });
      }
      return NextResponse.json({ error: "Kode pesanan bentrok, coba lagi." }, { status: 409 });
    }
    console.error("POST /api/orders insert failed:", msg);
    return NextResponse.json({ error: "Terjadi kesalahan pada server. Coba lagi." }, { status: 500 });
  }

  // Keep the request alive until Telegram accepts the notification attempt.
  // Failure stays isolated inside notifyAdminTelegram and never rolls back the order.
  const itemsForNotif = quote.items as { name: string; price: number; qty: number }[];
  await notifyAdminTelegram({ code, customerName: customer_name, customerWa: wa, items: itemsForNotif, subtotal: quote.subtotal, paymentMethod: pm });

  return NextResponse.json({ code, subtotal: quote.subtotal, status: "pending" }, { status: 201 });
}

/** Best-effort Telegram notification to admin for web orders */
async function notifyAdminTelegram(params: {
  code: string;
  customerName: string;
  customerWa: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  paymentMethod: string;
}) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!adminChatId || !botToken || process.env.TELEGRAM_BOT_ENABLED !== "true") return;

  try {
    const { adminWebOrderNotification } = await import("@/lib/telegram/messages");
    const { webOrderAdminKeyboard } = await import("@/lib/telegram/keyboards");
    const { sendMessage } = await import("@/lib/telegram/api");

    const productNames = params.items.map((i) => `${i.name} ×${i.qty}`).join(", ");
    const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";

    await sendMessage({
      chat_id: adminChatId,
      text: adminWebOrderNotification({
        orderCode: params.code,
        productNames,
        amount: params.subtotal,
        customerName: params.customerName,
        customerWa: params.customerWa,
        paymentMethod: params.paymentMethod,
      }),
      parse_mode: "HTML",
      reply_markup: webOrderAdminKeyboard({
        customerWa: params.customerWa,
        customerName: params.customerName,
        orderCode: params.code,
        siteUrl,
      }),
    });
  } catch {
    // Admin notification is best-effort — never block order response
  }
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 20)) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (code) {
    if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
    const row = (await queryFirst("SELECT * FROM orders WHERE code=?", code)) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
    // PII minimal on public endpoint: mask WA + email
    const waFull = String(row.customer_wa ?? "");
    const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
    const emailFull = String(row.customer_email ?? "");
    const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
    return NextResponse.json({
      order: {
        code: row.code,
        customer_name: row.customer_name,
        customer_wa: waMasked,
        customer_wa_full: undefined,
        customer_email: emailMasked,
        items: JSON.parse(String(row.items || "[]")),
        subtotal: row.subtotal,
        payment_method: row.payment_method,
        payment_account: row.payment_account,
        status: row.status,
        created_at: row.created_at,
      },
    });
  }
  // Without code, don't leak all orders — require admin endpoint
  return NextResponse.json({ error: "Gunakan ?code=AXV-... atau akses via admin." }, { status: 400 });
}
