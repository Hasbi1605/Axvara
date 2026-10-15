// POST /api/pedia/orders — Buat order Pedia (PD-21/25, §9.2/9.7).
// Publik + rate-limit pedia:orders 10/mnt/IP. Guard ganda sebelum invoice:
// (1) quote JWT valid; (2) harga terkini: bila paket dihapus supplier→404,
// harga berubah→409 price_changed (banding, bukan diam-diam — pola orders),
// margin tersisa < min→410 pedia_guard_margin; (3) email+WA wajib;
// (4) order/job/kredit/ledger disimpan dalam satu batch D1 atomik.
// Order memakai tabel `orders` existing (order_kind='pedia') agar webhook
// DANA/GoPay + fulfillment existing langsung bekerja. Job Pedia dibuat di
// transaksi checkout; dispatch menunggu order lunas.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { verifyPediaQuoteToken } from "@/lib/pedia/quote";
import { pediaBounds } from "@/lib/pedia/bounds";
import { computePediaPrice, pediaMargin } from "@/lib/pedia/pricing";
import { generateOrderCode } from "@/lib/security";
import { isPediaProvider } from "@/lib/pedia/proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const schema = z.object({
  customer_wa: z.string().trim().transform((s) => s.replace(/\s|-/g, ""))
    .refine((s) => /^(\+62|62|0)8\d{8,13}$/.test(s), "No WA harus 08... atau +62... (10-15 digit)"),
  customer_email: z.string().trim().email("Tulis email aktif yang benar sebelum bayar.").max(160),
  quote_token: z.string().trim().min(20, "Quote checkout wajib disertakan").max(20000),
});

function normalizeWa(raw: string): string {
  let wa = raw.replace(/\s|-/g, "");
  if (wa.startsWith("+62")) wa = wa.slice(1);
  else if (wa.startsWith("0")) wa = "62" + wa.slice(1);
  return wa;
}

/** Durable checkout already exists: retry only its invoice, never debit again. */
async function checkoutResponse(db: DatabaseAccess, order: Record<string, unknown>, reused: boolean) {
  const job = await db.queryFirst(`SELECT credit_used FROM pedia_order_items WHERE order_code=?`, order.code);
  if (!job) return NextResponse.json({ error: "Pesanan perlu diperiksa admin.", code: order.code }, { status: 503 });
  const creditUsed = Number(job.credit_used), payable = Number(order.subtotal) - creditUsed;
  let qris = null;
  if (payable > 0 && order.status === "pending") {
    try {
      const { createActiveQrisInvoice } = await import("@/lib/payments/dana-qris");
      const inv = await createActiveQrisInvoice(String(order.code), payable);
      qris = { payable_amount: inv.payableAmount, unique_code: inv.uniqueCode, image_url: inv.qrisUrl, expires_at: inv.expiresAt };
    } catch {
      return NextResponse.json({ error: "Pesanan tersimpan. QRIS belum tersedia; coba lanjutkan lagi dengan data yang sama.", code: order.code }, { status: 503 });
    }
  }
  return NextResponse.json({ code: order.code, subtotal: order.subtotal, credit_used: creditUsed, payable, status: order.status, qris, reused }, { status: reused ? 200 : 201 });
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
  const reused = await db.queryFirst(`SELECT code, subtotal, status FROM orders WHERE quote_id=?`, `pedia:${quote.jti}`);
  if (reused) return checkoutResponse(db, reused, true);
  const minOrderRp = Number(process.env.PEDIA_MIN_ORDER_RP || 1000) || 1000;

  // Hitung ulang dari DB (JANGAN percaya angka client/quote — pola orders):
  const product = await db.queryFirst(`SELECT * FROM pedia_products WHERE id=? AND is_active=1`, quote.product_id).catch(() => null);
  const tier = await db.queryFirst(`SELECT * FROM pedia_tiers WHERE id=? AND product_id=? AND is_active=1`, quote.tier_id, quote.product_id).catch(() => null);
  if (!product || !tier) {
    return NextResponse.json({ error: "Produk atau tingkat sudah tidak tersedia. Muat ulang katalog." }, { status: 404 });
  }
  if (!isPediaProvider(tier.supplier) || tier.supplier !== quote.supplier || Number(tier.supplier_service_id) !== quote.supplier_service_id) {
    return NextResponse.json({ error: "service_changed", message: "Layanan berubah. Muat ulang checkout." }, { status: 409 });
  }
  const live = await db.queryFirst(
    `SELECT * FROM pedia_supplier_services WHERE supplier=? AND service_id=? AND present=1 AND type='Default' AND rate_idr_per_1k>0`,
    tier.supplier, Number(tier.supplier_service_id),
  ).catch(() => null);
  if (!live) {
    return NextResponse.json({ error: "Layanan sedang tidak tersedia. Coba lagi nanti." }, { status: 409 });
  }
  const qty = quote.quantity;
  const limits = pediaBounds(live, tier, Number(product.step));
  if (!limits || qty < limits.min || qty > limits.max || qty % limits.step !== 0) {
    return NextResponse.json({ error: "Jumlah tidak lagi valid untuk layanan ini. Muat ulang checkout." }, { status: 409 });
  }
  // Chip paket hanyalah contoh jumlah. Jumlah bebas yang ditandatangani quote
  // tetap sah sepanjang min–max/step layanan live dan margin diperiksa di sini.
  const freshTotal = computePediaPrice({
    supplierRatePer1k: Number(live.rate_idr_per_1k),
    quantity: qty,
    markupPct: Number(tier.markup_pct) || 0,
    minProfitRp: Number(tier.min_profit_rp) || 0,
    minOrderRp,
  });
  if (!Number.isFinite(freshTotal) || freshTotal <= 0) return NextResponse.json({ error: "Layanan sedang tidak tersedia." }, { status: 409 });
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

  // Claim order, job, debit and ledger in ONE D1 transaction. A rejected
  // duplicate target or a concurrently spent credit cannot leave a debit behind.
  if (!db.d1) return NextResponse.json({ error: "Checkout sementara tidak tersedia." }, { status: 503 });
  const creditUsed = quote.credit_used;
  if (!Number.isSafeInteger(creditUsed) || creditUsed < 0 || creditUsed > freshTotal || (creditUsed > 0 && !quote.credit_code_hash)) {
    return NextResponse.json({ error: "Kredit tidak valid. Periksa ulang pesanan." }, { status: 409 });
  }
  const payable = freshTotal - creditUsed;
  const code = generateOrderCode().replace(/^AXV-/, "AXP-");
  const quoteIdRow = `pedia:${quote.jti}`;
  const items = JSON.stringify([{
    product_id: quote.product_id, variant_id: null, qty: 1, price: freshTotal, name: String(product.name),
    pedia: { tier_id: quote.tier_id, quantity: qty, target: quote.target_normalized, unit_price: quote.unit_price, credit_used: creditUsed },
  }]);
  const snapshot = JSON.stringify({ supplier_target: quote.supplier_target ?? quote.target_normalized, refill_anchor: quote.refill_anchor ?? "created", supplier: quote.supplier, supplier_service_id: quote.supplier_service_id,
    refill_days: quote.refill_days ?? (Number(tier.refill_days) || 0), min_profit_rp: quote.min_profit_rp ?? (Number(tier.min_profit_rp) || 0), service_copy: quote.service_copy });
  const owned = `EXISTS(SELECT 1 FROM orders WHERE code=? AND quote_id=?)`;
  const statement = (sql: string, ...params: unknown[]) => db.d1!.prepare(sql).bind(...params);
  let claimed = false;
  try {
    const result = await db.d1.batch([
      statement(`INSERT INTO orders(code,quote_id,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,sales_channel,order_kind,payment_status,paid_at,expires_at)
        SELECT ?,?,'',?,?,?,?, 'qris','qris',?,'web','pedia',?,CASE WHEN ?=0 THEN datetime('now') ELSE NULL END,datetime('now','+15 minutes')
        WHERE NOT EXISTS(SELECT 1 FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ('awaiting_payment','queued','submitting','submitted','in_progress','needs_check'))
        AND (?=0 OR EXISTS(SELECT 1 FROM pedia_credits WHERE code_hash=? AND datetime(expires_at)>datetime('now') AND remaining>=?))`,
        code,quoteIdRow,normalizeWa(customer_wa),customer_email,items,freshTotal,payable ? "pending" : "lunas",payable ? "pending" : "paid",payable,
        quote.target_normalized,quote.product_id,creditUsed,quote.credit_code_hash,creditUsed),
      statement(`INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,credit_used,supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',0 WHERE ${owned}`,
        code,quote.product_id,quote.tier_id,snapshot,quote.target_raw,quote.target_normalized,qty,quote.unit_price,freshTotal,creditUsed,quote.supplier,quote.supplier_service_id,quote.supplier_rate_snapshot,code,quoteIdRow),
      statement(`UPDATE pedia_credits SET remaining=remaining-? WHERE code_hash=? AND remaining>=? AND ?>0 AND ${owned}`,
        creditUsed,quote.credit_code_hash,creditUsed,creditUsed,code,quoteIdRow),
      statement(`INSERT INTO pedia_credit_ledger(credit_id,order_code,delta) SELECT id,?,? FROM pedia_credits WHERE code_hash=? AND ?>0 AND ${owned}`,
        code,-creditUsed,quote.credit_code_hash,creditUsed,code,quoteIdRow),
    ]);
    claimed = Number(result[0]?.meta?.changes) === 1;
  } catch {
    const existing = await db.queryFirst(`SELECT code,subtotal,status FROM orders WHERE quote_id=?`,quoteIdRow).catch(() => null);
    if (existing) return checkoutResponse(db,existing,true);
    return NextResponse.json({ error: "Pesanan belum tersimpan. Coba lagi dengan data yang sama." }, { status: 503 });
  }
  if (!claimed) {
    const dup = await db.queryFirst(`SELECT order_code FROM pedia_order_items WHERE target_normalized=? AND product_id=? AND status IN ('awaiting_payment','queued','submitting','submitted','in_progress','needs_check') ORDER BY id DESC LIMIT 1`,quote.target_normalized,quote.product_id);
    if (dup) return NextResponse.json({ error: "duplicate_active_order", message: `Link ini masih diproses di pesanan ${String(dup.order_code)}. Tunggu selesai dulu, ya.`, order_code: dup.order_code }, { status: 409 });
    return NextResponse.json({ error: "credit_changed", message: "Saldo kredit berubah. Periksa ulang total sebelum melanjutkan." }, { status: 409 });
  }
  return checkoutResponse(db,{ code,subtotal:freshTotal,status:payable ? "pending" : "lunas" },false);
}
