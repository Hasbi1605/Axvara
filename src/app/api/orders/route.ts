import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createOrderWithStock, queryAll, queryFirst, StockReservationError, transitionPendingOrder } from "@/lib/db";
import { generateOrderCode as generateCode, aggregateQty } from "@/lib/security";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { createDanaQrisInvoice, MAX_QRIS_REISSUES } from "@/lib/payments/dana-qris";
import { checkRateLimit } from "@/lib/rateLimit";

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
  items: z.array(z.object({
    product_id: z.coerce.number().int().min(1),
    variant_id: z.coerce.number().int().min(1).optional(),
    // Batas atas web = 100/baris (paritas Telegram) agar varian min-besar
    // (mis. GSuite min 50) tetap bisa dibeli dari web. Minimum per varian
    // ditegakkan ulang dari DB di bawah (JANGAN percaya angka client).
    qty: z.coerce.number().int().min(1).max(100),
  })).min(1).max(20),
  payment_method: z.string().trim().regex(/^(qris|ewallet|bank:[a-z0-9][a-z0-9_-]{0,31})$/, "Metode pembayaran tidak valid"),
  proof_url: z.string().trim().max(600).nullable().optional().default(null),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(8000),
});

// Rate-limit terpusat (issue #14): satu implementasi di src/lib/rateLimit.ts
// agar batas tidak tersebar + IP anti-spoof (cf-connecting-ip > x-real-ip,
// x-forwarded-for TIDAK dipakai karena dapat di-spoof client). WAF Free (1
// rule, counting IP) tetap menjadi lapis pertama; ini lapis kedua per isolate.

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "checkout:orders")) return NextResponse.json({ error: "Terlalu banyak percobaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });

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
  // Maintenance sementara (2026-09-17): jalur manual E-Wallet/Bank
  // dinonaktifkan di semua platform — hanya QRIS yang diterima.
  if (payment_method !== "qris") {
    return NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Silakan bayar via QRIS." }, { status: 503 });
  }
  if (proof_url) {
    return NextResponse.json({ error: "Upload bukti sedang dinonaktifkan. Silakan bayar via QRIS." }, { status: 503 });
  }
  if (proof_url && (!proof_url.startsWith("/r2/bukti/") || proof_url.includes(".."))) {
    return NextResponse.json({ error: "URL bukti tidak valid" }, { status: 400 });
  }

  const quote = await verifyCheckoutQuoteToken(quote_token);
  if (!quote) {
    return NextResponse.json({ error: "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout." }, { status: 409 });
  }

  const requested = aggregateQty(items);
  const quoted = aggregateQty(quote.items);
  const sameItems = requested.size === quoted.size
    && [...requested.entries()].every(([key, qty]) => quoted.get(key) === qty);
  if (!sameItems) {
    return NextResponse.json({ error: "Isi keranjang berubah setelah harga dikunci. Muat ulang checkout." }, { status: 409 });
  }

  // Email wajib (migrasi 0033): hitung ulang dari DB — JANGAN percaya flag
  // client. Invite/Link WR atau produk require_email=1 tanpa email valid =
  // 422 sebelum order dibuat (order lunas tanpa email = macet di WR).
  try {
    const { needsEmailForVariant } = await import("@/lib/warung-rebahan/delivery-class");
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    let emailNeeded = false;
    if (variantIds.length > 0) {
      const rows = await queryAll(
        `SELECT pv.id, wv.wr_type AS wr_type, p.require_email AS require_email
         FROM product_variants pv
         LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
         LEFT JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      for (const r of rows) {
        if (needsEmailForVariant({
          wrType: r.wr_type != null ? String(r.wr_type) : null,
          requireEmail: Number(r.require_email ?? 0),
        })) { emailNeeded = true; break; }
      }
    } else {
      const productIds = [...new Set(quote.items.map((i) => Number(i.product_id || 0)).filter((v) => v > 0))];
      if (productIds.length > 0) {
        const rows = await queryAll(
          `SELECT require_email FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
          ...productIds,
        );
        emailNeeded = rows.some((r) => Number(r.require_email ?? 0) === 1);
      }
    }
    const emailOk = typeof customer_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email.trim());
    if (emailNeeded && !emailOk) {
      return NextResponse.json({ error: "Produk ini dikirim via email invite — tulis email aktif yang benar sebelum bayar." }, { status: 422 });
    }
  } catch {
    // Guard email best-effort: bila query gagal (DB glitch), biarkan order
    // jalan agar checkout tidak mati total karena helper. Respons 422 di
    // atas sudah return langsung, jadi tidak perlu diteruskan.
  }

  // Minimum pembelian per varian (migrasi 0034): hitung ulang dari DB —
  // JANGAN percaya angka client. GSuite (min 50) yang lolos quote tapi
  // diubah client jadi qty kecil DITOLAK 409 di sini sebelum order dibuat.
  try {
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    if (variantIds.length > 0) {
      const rows = await queryAll(
        `SELECT pv.id, pv.min_qty AS min_qty, pv.label AS label, p.name AS product_name
         FROM product_variants pv
         LEFT JOIN products p ON p.id = pv.product_id
         WHERE pv.id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      const minById = new Map<number, { min: number; name: string }>();
      for (const r of rows) {
        minById.set(Number(r.id), {
          min: Math.max(1, Number(r.min_qty ?? 1) || 1),
          name: `${String(r.product_name ?? "Produk")} — ${String(r.label ?? "")}`.trim(),
        });
      }
      // Qty agregat per varian (keranjang bisa kirim baris ganda varian sama).
      const qtyByVariant = new Map<number, number>();
      for (const qi of quote.items) {
        const vid = Number(qi.variant_id || 0);
        if (vid > 0) qtyByVariant.set(vid, (qtyByVariant.get(vid) ?? 0) + Number(qi.qty || 0));
      }
      for (const [vid, qty] of qtyByVariant) {
        const rule = minById.get(vid);
        const need = rule?.min ?? 1;
        if (need > 1 && qty < need) {
          return NextResponse.json({ error: `${rule?.name ?? "Produk ini"} minimal pembelian ${need} (kamu pilih ${qty}). Tambah jumlahnya lalu checkout ulang.` }, { status: 409 });
        }
      }
    }
  } catch {
    // Guard best-effort: bila query gagal (DB glitch), biarkan guard atomik
    // createOrderWithStock yang memutuskan agar checkout tidak mati total.
  }

  // Harga BASI (2026-09-23): token quote berlaku 1 jam, sementara sync WR
  // menulis ulang harga varian tiap ~5 menit. `sameItems` di atas hanya
  // menyamakan identitas + qty, dan `createOrderWithStock` tidak punya satu
  // pun guard harga — jadi order dibuat dari `quote.subtotal` yang bisa sudah
  // usang, lalu invoice QRIS diterbitkan dari nominal usang itu. Bila harga
  // naik, toko rugi; bila turun, pembeli yang dirugikan.
  //
  // Sengaja MEMBANDINGKAN, bukan diam-diam memakai harga baru: nominal yang
  // dibayar harus sama dengan yang dilihat pembeli saat menekan bayar.
  try {
    const variantIds = [...new Set(quote.items.map((i) => Number(i.variant_id || 0)).filter((v) => v > 0))];
    if (variantIds.length > 0) {
      const rows = await queryAll(
        `SELECT id, price FROM product_variants WHERE id IN (${variantIds.map(() => "?").join(",")})`,
        ...variantIds,
      );
      const priceById = new Map<number, number>();
      for (const r of rows) priceById.set(Number(r.id), Number(r.price ?? 0));
      const stale = quote.items.find((qi) => {
        const vid = Number(qi.variant_id || 0);
        if (vid <= 0) return false;
        const live = priceById.get(vid);
        return live != null && live !== Number(qi.price ?? 0);
      });
      if (stale) {
        return NextResponse.json(
          {
            error: "price_changed",
            message: "Harga produk berubah sejak halaman checkout dibuka. Muat ulang agar kamu membayar harga terbaru.",
          },
          { status: 409 },
        );
      }
    }
  } catch {
    // Sama dengan guard lain: kegagalan query tidak boleh mematikan checkout.
  }

  // Normalize WA to 62
  let wa = customer_wa.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);

  // Maintenance sementara (2026-09-17): quote hanya boleh berisi QRIS.
  // Token lama yang masih membawa ewallet/bank ditolak agar tidak bisa
  // dipakai untuk membuat order manual selama maintenance.
  const quoteHasQris = quote.payment_methods.some((method) => method.id === "qris");
  if (!quoteHasQris) {
    return NextResponse.json({ error: "E-Wallet & Transfer Bank sedang maintenance. Muat ulang checkout dan bayar via QRIS." }, { status: 503 });
  }
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

  let qrisInvoice: Awaited<ReturnType<typeof createDanaQrisInvoice>> | null = null;
  if (pm === "qris") {
    try {
      qrisInvoice = await createDanaQrisInvoice(code, quote.subtotal);
    } catch (error) {
      console.error("DANA QRIS invoice setup failed:", error instanceof Error ? error.message : "unknown");
      try {
        await transitionPendingOrder(code, "dibatalkan", "dana_qris_setup_failed", quote.items);
      } catch { /* A concurrent terminal transition is safe. */ }
      return NextResponse.json({ error: "QRIS dinamis sedang tidak tersedia. Coba lagi sebentar." }, { status: 503 });
    }
  }

  // Keep the request alive until Telegram accepts the notification attempt.
  // Failure stays isolated inside notifyAdminTelegram and never rolls back the order.
  const itemsForNotif = quote.items as { name: string; price: number; qty: number }[];
  await notifyAdminTelegram({ code, customerName: customer_name, customerWa: wa, items: itemsForNotif, subtotal: qrisInvoice?.payableAmount ?? quote.subtotal, paymentMethod: pm });

  return NextResponse.json({
    code,
    subtotal: quote.subtotal,
    status: "pending",
    qris: qrisInvoice ? {
      payable_amount: qrisInvoice.payableAmount,
      unique_code: qrisInvoice.uniqueCode,
      image_url: qrisInvoice.qrisUrl,
      expires_at: qrisInvoice.expiresAt,
    } : null,
  }, { status: 201 });
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
  if (!checkRateLimit(req, "orders:lookup")) return NextResponse.json({ error: "Terlalu sering, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.trim();
  if (code) {
    if (!/^AXV-\d{8}-[A-Z0-9]{8}$/.test(code)) return NextResponse.json({ error: "Kode tidak valid" }, { status: 400 });
    const row = (await queryFirst(
      `SELECT o.*, pt.payable_amount, pt.unique_code, pt.qris_url AS dynamic_qris_url,
              pt.expires_at AS payment_expires_at, pt.status AS transaction_status
       FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       WHERE o.code=?`,
      code,
    )) as Record<string, unknown> | undefined;
    if (!row) return NextResponse.json({ error: "Pesanan tidak ditemukan" }, { status: 404 });
    // PII minimal on public endpoint: mask WA + email
    const waFull = String(row.customer_wa ?? "");
    const waMasked = waFull.length >= 7 ? waFull.slice(0, 5) + "****" + waFull.slice(-4) : waFull ? waFull.slice(0, 3) + "****" : "";
    const emailFull = String(row.customer_email ?? "");
    const emailMasked = emailFull.includes("@") ? emailFull.replace(/(^.).+(@.*)/, (_, a, b) => `${a}***${b}`) : emailFull ? "***" : null;
    // Panel "Detail Akun Digital" di /pesanan/[code] hanya boleh tampil bila
    // detail akun BENAR-BENAR sudah ada. Produk fulfillment manual tidak
    // pernah punya baris wr_order_links, jadi sebelumnya form verifikasi WA
    // muncul untuk semua order lunas dan selalu berakhir "not_ready" —
    // form mati yang bikin pembeli panik tepat setelah bayar.
    // Boolean saja (tanpa isi kredensial); retrieval tetap wajib verifikasi
    // WA/capability token di /api/orders/[code]/credentials.
    let credentialsReady = false;
    let queuedDelivery = false;
    if (String(row.status) === "lunas") {
      // Satu query untuk dua flag halaman pesanan (hemat statement):
      // - creds: detail akun sudah siap diambil pembeli.
      // - queued: ada baris yang dikerjakan sesuai antrean (varian WR non-restock
      //   atau varian manual) → teks estimasi TIDAK boleh bilang 5–15 menit.
      // .catch: D1 lama tanpa tabel WR (pra-0027) → kedua flag false, bukan 500.
      const flags = await queryFirst(
        `SELECT
          EXISTS(SELECT 1 FROM wr_order_links WHERE order_code=? AND status='completed'
                   AND wr_account_details IS NOT NULL) AS creds,
          EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(?) THEN ? ELSE '[]' END) je
                 JOIN product_variants pv
                   ON pv.id = CAST(json_extract(je.value,'$.variant_id') AS INTEGER)
                 LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
                 WHERE CASE WHEN pv.wr_variant_id IS NOT NULL
                            THEN COALESCE(wv.wr_delivery_class,'made_by_order') <> 'restock'
                            ELSE pv.fulfillment_mode = 'manual' END) AS queued`,
        code,
        String(row.items ?? "[]"),
        String(row.items ?? "[]"),
      ).catch(() => null);
      credentialsReady = Number(flags?.creds ?? 0) === 1;
      queuedDelivery = Number(flags?.queued ?? 0) === 1;
    }
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
        expires_at: row.expires_at,
        credentials_ready: credentialsReady,
        queued_delivery: queuedDelivery,
        qris_reissue_allowed: row.status === "pending" && row.sales_channel !== "whatsapp" && Number(row.qris_reissue_count || 0) < MAX_QRIS_REISSUES,
        qris: row.dynamic_qris_url ? {
          payable_amount: row.payable_amount,
          unique_code: row.unique_code,
          image_url: row.dynamic_qris_url,
          expires_at: row.payment_expires_at,
          status: row.transaction_status,
        } : null,
      },
    });
  }
  // Without code, don't leak all orders — require admin endpoint
  return NextResponse.json({ error: "Gunakan ?code=AXV-... atau akses via admin." }, { status: 400 });
}
