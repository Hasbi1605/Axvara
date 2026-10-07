// POST /api/pedia/orders — Buat order Pedia (PD-21/25, §9.2/9.7).
// Publik + rate-limit pedia:orders 10/mnt/IP. Guard ganda sebelum invoice:
// (1) quote JWT valid; (2) harga terkini: bila paket dihapus supplier→404,
// harga berubah→409 price_changed (banding, bukan diam-diam — pola orders),
// margin tersisa < min→410 pedia_guard_margin; (3) email+WA wajib;
// (4) konsumsi kredit atomik (UPDATE ... WHERE remaining>=).
// Order memakai tabel `orders` existing (order_kind='pedia') agar webhook
// DANA/GoPay + fulfillment existing langsung bekerja. Job Pedia dibuat di
// webhook pelunasan (lihat patch webhook dana/gopay M4).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { computePediaPrice, pediaMargin } from "@/lib/pedia/pricing";
import { generateOrderCode } from "@/lib/security";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  customer_wa: z.string().trim().transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), "No WA harus 08... atau +62... (10-15 digit)"),
  customer_email: z.string().trim().email("Tulis email aktif yang benar sebelum bayar.").max(160),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(8000),
});

function normalizeWa(raw: string): string {
  let wa = raw.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);
  return wa;
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req, "pedia:orders")) {
    return NextResponse.json({ error: "Terlalu banyak percobaan, coba lagi 1 menit." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  if (process.env.PEDIA_ENABLED !== "true" || process.env.PEDIA_ORDERS_ENABLED !== "true") {
    return NextResponse.json({ error: "Pedia belum dibuka untuk order." }, { status: 503 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const { customer_wa, customer_email, quote_token } = parsed.data;
  const quote = await verifyPediaQuoteToken(quote_token);
  if (!quote) {
    return NextResponse.json({ error: "Quote checkout tidak valid atau sudah kedaluwarsa. Muat ulang checkout." }, { status: 409 });
  }
  const db = createDatabaseAccess();
  const minOrderRp = Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000;

  // Hitung ulang dari DB (JANGAN percaya angka client/quote — pola orders):
  const product = await db.queryFirst(`SELECT * FROM pedia_products WHERE id=? AND is_active=1`, quote.product_id).catch(() => null);
  const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`, quote.tier_id, quote.product_id).catch(() => null);
  if (!product || !tier) {
    return NextResponse.json({ error: "Produk atau tingkat sudah tidak tersedia. Muat ulang katalog." }, { status: 404 });
  }
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=? AND present=1`,
    Number(tier.supplier_service_id),
  ).catch(() => null);
  if (!live) {
    return NextResponse.json({ error: "Layanan sedang tidak tersedia. Coba lagi nanti." }, { status: 409 });
  }
  const qty = quote.quantity;
  const minQty = Number(live.min_qty) || 1;
  const maxQty = Number(live.max_qty) || qty;
  const step = Number(product.step) || 1;
  if (qty < minQty || qty > maxQty || qty % step !== 0) {
    return NextResponse.json({ error: "Jumlah tidak lagi valid untuk layanan ini. Muat ulang checkout." }, { status: 409 });
  }
  // Paket dihapus supplier sejak quote dibuat → 404 (bukan diam-diam).
  const prices = JSON.parse(String(tier.package_prices_json ?? "{}")) as Record<string, number>;
  if (!(String(qty) in prices)) {
    return NextResponse.json({ error: "Paket ini sudah tidak tersedia. Pilih paket lain." }, { status: 404 });
  }
  const freshTotal = computePediaPrice({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity: qty,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp,
  });
  // Guard margin di jalur uang (PD-33): bila margin tersisa < min sejak quote,
  // TOLAK dengan 410 (bukan kirim rugi) — kunci tier untuk admin.
  const margin = pediaMargin({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity: qty, sellPrice: freshTotal,
  });
  if (margin < Number(tier.min_profit_rp)) {
    await db.execRun(
      `UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin', updated_at=datetime('now')
        WHERE id=? AND is_active=1`,
      Number(tier.id),
    ).catch(() => null);
    return NextResponse.json({ error: "pedia_guard_margin", message: "Kualitas ini baru saja dinonaktifkan otomatis (margin). Pilih kualitas lain." }, { status: 410 });
  }
  if (freshTotal !== quote.total) {
    return NextResponse.json({
      error: "price_changed",
      message: "Harga berubah sejak halaman checkout dibuka. Muat ulang agar kamu membayar harga terbaru.",
    }, { status: 409 });
  }

  // Kredit: konsumsi atomik (race dua tab → satu menang; sisa dikembalikan).
  let creditUsed = 0;
  if (quote.credit_code_hash) {
    const credit = await db.queryFirst(
      `SELECT id, remaining FROM pedia_credits
        WHERE code_hash=? AND datetime(expires_at) > datetime('now')`,
      quote.credit_code_hash,
    ).catch(() => null);
    const want = Math.min(Number(credit?.remaining ?? 0), quote.credit_used, freshTotal);
    if (want > 0 && credit) {
      const r = await db.execRun(
        `UPDATE pedia_credits SET remaining=remaining-? WHERE id=? AND remaining>=?`,
        want, Number(credit.id), want,
      ).catch(() => ({ changes: 0 }));
      if (Number((r as { changes?: number })?.changes ?? 0) === 1) {
        creditUsed = want;
      }
    }
  }
  const payable = freshTotal - creditUsed;

  // AC-06 / PD-09: guard link ganda — tolak order baru untuk
  // (target_normalized, product_id) yang masih aktif (queued…in_progress).
  const dup = await db.queryFirst(
    `SELECT order_code FROM pedia_order_items
      WHERE target_normalized=? AND product_id=?
        AND status IN ('queued','submitting','submitted','in_progress')
      ORDER BY id DESC LIMIT 1`,
    quote.target_normalized, quote.product_id,
  ).catch(() => null);
  if (dup) {
    return NextResponse.json({
      error: "duplicate_active_order",
      message: `Link ini masih diproses di pesanan ${String(dup.order_code)}. Tunggu selesai dulu, ya.`,
      order_code: String(dup.order_code),
    }, { status: 409 });
  }

  const wa = normalizeWa(customer_wa);
  // Kode order prefiks AXP- (dibedakan dari AXV-, PRD §8).
  const code = generateOrderCode().replace(/^AXV-/, "AXP-");
  const quoteIdRow = `pedia:${quote.jti}`;

  try {
    // sales_channel='web' (CHECK existing) + order_kind='pedia' (migrasi
    // 0059) sebagai pembeda. Kode order prefiks AXP- (generator di bawah).
    await db.execRun(
      `INSERT INTO orders
         (code, quote_id, customer_name, customer_wa, customer_email, items,
          subtotal, payment_method, payment_account, status, sales_channel, order_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'qris', 'qris', 'pending', 'web', 'pedia')`,
      code, quoteIdRow, "", wa, customer_email.trim(),
      JSON.stringify([{
        product_id: quote.product_id, variant_id: null, qty: 1,
        price: freshTotal, name: String(product.name),
        pedia: {
          tier_id: quote.tier_id, quantity: qty,
          target: quote.target_normalized,
          unit_price: quote.unit_price, credit_used: creditUsed,
        },
      }]),
      freshTotal,
    );
  } catch {
    const existing = await db.queryFirst(`SELECT code, subtotal, status FROM orders WHERE quote_id=?`, quoteIdRow).catch(() => null);
    if (existing) {
      return NextResponse.json({ code: existing.code, subtotal: existing.subtotal, status: existing.status, reused: true }, { status: 200 });
    }
    return NextResponse.json({ error: "Kode pesanan bentrok, coba lagi." }, { status: 409 });
  }

  // Baris job Pedia (dibuat kini sebagai 'queued' agar idempoten
  // INSERT OR IGNORE; kolom mengikuti skema 0059 persis).
  await db.execRun(
    `INSERT OR IGNORE INTO pedia_order_items
       (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized, quantity,
        unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot,
        status, submit_attempts)
     VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, 'providersmm', ?, ?, 'queued', 0)`,
    code, quote.product_id, quote.tier_id, quote.target_raw, quote.target_normalized,
    qty, quote.unit_price, freshTotal, creditUsed,
    Number(quote.supplier_service_id), Number(quote.supplier_rate_snapshot),
  ).catch(() => null);

  // Invoice QRIS via rail aktif (pola /api/orders). Kredit-penuh (payable=0)
  // tidak butuh invoice — pelunasan internal langsung (lihat M4 settle).
  let qris: { payable_amount: number; unique_code: number; image_url: string; expires_at: string } | null = null;
  if (payable > 0) {
    try {
      const { createActiveQrisInvoice } = await import("@/lib/payments/dana-qris");
      const inv = await createActiveQrisInvoice(code, payable);
      qris = {
        payable_amount: inv.payableAmount, unique_code: inv.uniqueCode,
        image_url: inv.qrisUrl, expires_at: inv.expiresAt,
      };
    } catch {
      return NextResponse.json({ error: "QRIS dinamis sedang tidak tersedia. Coba lagi sebentar." }, { status: 503 });
    }
  } else {
    // Lunas oleh kredit penuh: catat ledger + transisi paid (internal, tanpa webhook).
    const creditRow = await db.queryFirst(
      `SELECT id FROM pedia_credits WHERE code_hash=?`, quote.credit_code_hash,
    ).catch(() => null);
    if (creditRow) {
      await db.execRun(
        `INSERT INTO pedia_credit_ledger (credit_id, order_code, delta) VALUES (?, ?, ?)`,
        Number(creditRow.id), code, -creditUsed,
      ).catch(() => null);
    }
    await db.execRun(
      `UPDATE orders SET status='lunas', paid_at=datetime('now') WHERE code=? AND status='pending'`,
      code,
    ).catch(() => null);
    await db.execRun(
      `UPDATE pedia_order_items SET status='queued' WHERE order_code=? AND status='queued'`,
      code,
    ).catch(() => null);
  }

  return NextResponse.json({
    code, subtotal: freshTotal, credit_used: creditUsed, payable,
    status: payable > 0 ? "pending" : "lunas",
    qris,
  }, { status: 201 });
}
