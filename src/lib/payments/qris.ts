import { assertPaymentsAvailable } from "@/lib/payment-maintenance";
import { getD1, queryAll, queryFirst } from "@/lib/db";

/** Rail GoPay Merchant (Fase 1): payload statis GoPay + mutasi GoBiz via poller. */
export const GOPAY_QRIS_PROVIDER = "gopay";
export const GOPAY_QRIS_MODE = "dynamic-qris";
export const GOPAY_MERCHANT_ID = "gopay-merchant";
/** Rail QRIS yang dapat menerbitkan invoice baru. Histori DANA dibaca dari ledger. */
export const QRIS_PROVIDERS = [GOPAY_QRIS_PROVIDER, "klikqris"] as const;
export type QrisProvider = (typeof QRIS_PROVIDERS)[number];
export function isQrisProvider(value: unknown): value is QrisProvider {
  return value === GOPAY_QRIS_PROVIDER || value === "klikqris";
}
export const QRIS_EXPIRY_MINUTES = 15;
/** Masa hidup order QRIS disamakan dengan QR (15 menit, keputusan owner 2026-10-11):
 * stok tidak lagi dikunci 60 menit oleh order yang tidak dibayar. Tidak ada
 * perpanjangan QR — QR mati = order kadaluarsa = stok kembali; pembeli yang
 * berubah pikiran membatalkan sendiri dari halaman pesanan. WA sudah 15 menit
 * sejak awal, kini Web/Telegram sama. */
export const QRIS_ORDER_WINDOW_MINUTES = 15;
/** Satu invoice asli dan maksimal satu QR pengganti. */
export const MAX_QRIS_REISSUES = 1;
/** Batas atas mutlak kode unik GoPay (dipakai validasi nominal maksimum). */
export const QRIS_MAX_UNIQUE_CODE = 999;
/**
 * Kode unik GoPay bertingkat (keputusan owner 22 Nov 2026, menutup MDR QRIS):
 * order kecil tetap maks +Rp299 agar tidak terasa memberatkan (keputusan
 * 6 Sep 2026); Rp10rb–<Rp50rb maks +Rp499; >=Rp50rb maks +Rp999.
 * KlikQRIS menentukan kode uniknya sendiri dan tidak terpengaruh.
 */
export const QRIS_UNIQUE_CODE_TIERS = [
  { below: 10_000, max: 299 },
  { below: 50_000, max: 499 },
] as const;
export function qrisMaxUniqueCode(requestedAmount: number): number {
  for (const tier of QRIS_UNIQUE_CODE_TIERS) if (requestedAmount < tier.below) return tier.max;
  return QRIS_MAX_UNIQUE_CODE;
}
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 999_999_999;

type Tlv = { tag: string; value: string };

export type QrisInvoice = {
  orderCode: string;
  requestedAmount: number;
  payableAmount: number;
  uniqueCode: number;
  qrisPayload: string;
  qrisUrl: string;
  expiresAt: string;
  isExisting: boolean;
};

type QrisWebhookFields = {
  amount: number;
  senderName: string | null;
  rawText: string | null;
  sourceEventId: string | null;
};

/**
 * Batas kausalitas pencocokan pembayaran (masalah #2).
 *
 * Event lama tidak selalu punya waktu mutasi tepercaya. Yang dapat
 * diobservasi adalah kapan *server*
 * pertama kali melihat event (`dana_webhook_events.created_at`). Syarat
 * kausalitas minimal yang dapat ditegakkan secara deterministik:
 *
 *   event diamati (received_at) >= invoice diterbitkan (created_at)
 *   — dalam praktik dengan toleransi jam miring kecil.
 *
 * Event yang diamati SEBELUM kandidat invoice dibuat tidak mungkin
 * merupakan pembayaran atas invoice tersebut: uang tidak dapat membayar
 * invoice yang belum ada. Mencocokkannya berarti pembayaran lama (atau
 * notifikasi terlambat dari invoice lain yang nominalnya sama) melunasi
 * order baru — tepat temuan audit #2.
 *
 * Batasan yang diakui (didokumentasikan, bukan disembunyikan):
 * - received_at bukan waktu pembayaran. Nominal yang pernah digunakan
 *   invoice lain wajib direkonsiliasi manual; riwayat ledger harus disimpan.
 * - Kedua timestamp berasal dari database yang sama, sehingga tidak ada
 *   toleransi yang membolehkan event mendahului invoice.
 */
export const QRIS_MATCH_CLOCK_SKEW_MS = 0;

/**
 * Parse a DB timestamp as UTC millis. Writers persist ISO-8601 UTC
 * (`toISOString()`), while D1 defaults (`datetime('now')`) are legacy
 * space-separated `YYYY-MM-DD HH:MM:SS` — which `Date.parse` reads as LOCAL
 * time. On a WIB host that shifts invoice times by +7h and makes a stale
 * event look newer than the invoice. Normalize: a space-separated value
 * without offset is UTC (D1 `datetime('now')` is UTC).
 */
export function parseDbTimeUtc(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  let text = String(value).trim();
  if (!text) return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)) {
    text = `${text.replace(" ", "T")}Z`;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function isCausallyPlausiblePayment(
  eventReceivedAt: unknown,
  invoiceCreatedAt: unknown,
  skewMs = QRIS_MATCH_CLOCK_SKEW_MS,
): boolean {
  const received = parseDbTimeUtc(eventReceivedAt);
  const invoiced = parseDbTimeUtc(invoiceCreatedAt);
  if (!Number.isFinite(received) || !Number.isFinite(invoiced)) return false;
  return received + skewMs >= invoiced;
}

export function calculateCrc16(input: string): string {
  let crc = 0xffff;
  for (let index = 0; index < input.length; index++) {
    crc ^= input.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function parseTlv(payload: string): Tlv[] {
  const fields: Tlv[] = [];
  let offset = 0;
  while (offset < payload.length) {
    if (offset + 4 > payload.length) throw new Error("invalid_qris_tlv_header");
    const tag = payload.slice(offset, offset + 2);
    const rawLength = payload.slice(offset + 2, offset + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(rawLength)) throw new Error("invalid_qris_tlv_tag");
    const length = Number(rawLength);
    const valueStart = offset + 4;
    const valueEnd = valueStart + length;
    if (valueEnd > payload.length) throw new Error("invalid_qris_tlv_length");
    fields.push({ tag, value: payload.slice(valueStart, valueEnd) });
    offset = valueEnd;
  }
  return fields;
}

function encodeTlv(field: Tlv): string {
  if (field.value.length > 99) throw new Error("qris_tlv_value_too_long");
  return `${field.tag}${String(field.value.length).padStart(2, "0")}${field.value}`;
}

/** Merchant asal invoice GoPay, bukan merchant dari konfigurasi saat ini. */
export function getGopayInvoiceMerchantId(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  try {
    const normalized = payload.trim();
    const fields = parseTlv(normalized);
    const crc = fields.at(-1);
    if (crc?.tag !== "63" || crc.value !== calculateCrc16(normalized.slice(0, -4))) return null;
    for (const field of fields) {
      if (Number(field.tag) < 26 || Number(field.tag) > 45) continue;
      const account = parseTlv(field.value);
      if (!account.some(value => value.tag === "00" && value.value === "COM.GO-JEK.WWW")) continue;
      const merchantId = account.find(value => value.tag === "02")?.value;
      return merchantId && /^G\d{9}$/.test(merchantId) ? merchantId : null;
    }
  } catch { /* Invoice rusak/tidak dikenali tidak boleh beralih merchant. */ }
  return null;
}

/** Convert a private static merchant payload into a one-time amount QRIS. */
export function makeDynamicQris(staticPayload: string, amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    throw new Error("invalid_qris_amount");
  }
  // Spaces may be part of merchant/city TLV values, so only trim transport
  // whitespace around the complete payload.
  const normalized = staticPayload.trim();
  const fields = parseTlv(normalized);
  const crc = fields.at(-1);
  if (!crc || crc.tag !== "63" || crc.value.length !== 4) throw new Error("invalid_qris_crc_tag");
  if (calculateCrc16(normalized.slice(0, -4)) !== crc.value.toUpperCase()) throw new Error("invalid_qris_crc");
  if (!fields.some((field) => field.tag === "53" && field.value === "360")) throw new Error("invalid_qris_currency");
  if (!fields.some((field) => field.tag === "58" && field.value === "ID")) throw new Error("invalid_qris_country");

  const withoutAmountOrCrc = fields.filter((field) => field.tag !== "54" && field.tag !== "63");
  const initiation = withoutAmountOrCrc.find((field) => field.tag === "01");
  if (!initiation) withoutAmountOrCrc.splice(1, 0, { tag: "01", value: "12" });
  else initiation.value = "12";

  const countryIndex = withoutAmountOrCrc.findIndex((field) => field.tag === "58");
  withoutAmountOrCrc.splice(countryIndex, 0, { tag: "54", value: String(amount) });
  const payloadWithoutChecksum = `${withoutAmountOrCrc.map(encodeTlv).join("")}6304`;
  return `${payloadWithoutChecksum}${calculateCrc16(payloadWithoutChecksum)}`;
}

/** amount → epoch ms pemakaian terakhir (tak terbaca = sekarang, paling dihindari). */
function lastUsedByAmount(rows: Record<string, unknown>[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) {
    const amount = Number(row.payable_amount);
    const julian = Number(row.last_used_jd);
    const at = row.last_used_jd != null && Number.isFinite(julian) ? (julian - 2440587.5) * 86_400_000 : Date.now();
    map.set(amount, Math.max(map.get(amount) ?? 0, at));
  }
  return map;
}

function randomUniqueCode(maxCode: number): number {
  const bytes = new Uint16Array(1);
  crypto.getRandomValues(bytes);
  return 1 + (bytes[0] % maxCode);
}

function publicQrisUrl(orderCode: string): string {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  return `${siteUrl}/api/payments/qris/${encodeURIComponent(orderCode)}/image`;
}

/** Wake poller GoPay (dynamic import: hindari siklus modul). Tidak pernah throw. */
async function wakeGopayPollerSafe(reason: string): Promise<void> {
  try {
    const { scheduleGopayWake } = await import("@/lib/payments/gopay-wake");
    await scheduleGopayWake(reason);
  } catch { /* best-effort */ }
}

export function isGopayQrisEnabled(): boolean {
  return process.env.GOPAY_QRIS_ENABLED === "true";
}

export function isGopayQrisConfigured(): boolean {
  return isGopayQrisEnabled()
    && Boolean(process.env.GOPAY_STATIC_QRIS?.trim())
    && Boolean(process.env.GOPAY_POLLER_SECRET?.trim());
}

/**
 * Pilih GoPay atau KlikQRIS secara eksplisit. Nilai kosong, lama, atau salah
 * tidak boleh mengalihkan uang ke merchant lain.
 */
export function activeQrisProvider(): QrisProvider | null {
  const wanted = (process.env.QRIS_ACTIVE_PROVIDER || "").trim().toLowerCase();
  return isQrisProvider(wanted) ? wanted : null;
}

/** Label akun tujuan QRIS yang disimpan di order (`payment_account`), mengikuti provider aktif. */
export function qrisPaymentAccountLabel(provider: QrisProvider | null = activeQrisProvider()): string {
  if (provider === GOPAY_QRIS_PROVIDER) return "GoPay Merchant";
  if (provider === "klikqris") return "KlikQRIS";
  return "";
}

function gopayStaticPayload(): string {
  return (process.env.GOPAY_STATIC_QRIS || "").trim();
}

function gopayMerchantId(): string {
  return getGopayInvoiceMerchantId(gopayStaticPayload()) || GOPAY_MERCHANT_ID;
}

export function isActiveQrisConfigured(): boolean {
  if (activeQrisProvider() === "klikqris") return process.env.KLIKQRIS_ENABLED === "true"
    && Boolean(process.env.KLIKQRIS_API_KEY?.trim()) && /^[0-9]+$/.test(process.env.KLIKQRIS_MERCHANT_ID || "");
  return activeQrisProvider() === "gopay" && isGopayQrisConfigured();
}

function invoiceFromRow(row: Record<string, unknown>, isExisting: boolean): QrisInvoice {
  return {
    orderCode: String(row.order_code),
    requestedAmount: Number(row.requested_amount),
    payableAmount: Number(row.payable_amount),
    uniqueCode: Number(row.unique_code),
    qrisPayload: String(row.qris_payload),
    qrisUrl: String(row.qris_url),
    expiresAt: String(row.expires_at),
    isExisting,
  };
}

/** Invoice baru mengikuti rail aktif; retry tetap mengikat provider tersimpan. */
export async function createActiveQrisInvoice(orderCode: string, requestedAmount: number): Promise<QrisInvoice> {
  assertPaymentsAvailable();
  const saved = await queryFirst("SELECT provider FROM payment_transactions WHERE order_code=?", orderCode);
  // Historical invoices are read from the order/status paths, never issued again.
  if (saved && !isQrisProvider(saved.provider)) throw new Error("qris_provider_conflict");
  const provider = saved ? saved.provider as QrisProvider : activeQrisProvider();
  if (!provider) throw new Error("qris_not_configured");
  if (provider === "klikqris") {
    const { createKlikQrisInvoice } = await import("./klikqris");
    return createKlikQrisInvoice(orderCode, requestedAmount);
  }
  return createGopayQrisInvoice(orderCode, requestedAmount);
}

export async function createGopayQrisInvoice(orderCode: string, requestedAmount: number): Promise<QrisInvoice> {
  assertPaymentsAvailable();
  const provider = GOPAY_QRIS_PROVIDER;
  if (!isGopayQrisConfigured()) throw new Error("qris_not_configured");
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < MIN_AMOUNT || requestedAmount > MAX_AMOUNT - QRIS_MAX_UNIQUE_CODE) {
    throw new Error("invalid_qris_amount");
  }
  const d1 = getD1();
  if (!d1) throw new Error("qris_requires_d1");

  const existing = await queryFirst(
    `SELECT order_code, requested_amount, payable_amount, unique_code, qris_payload, qris_url, expires_at, status
     FROM payment_transactions WHERE order_code=? AND provider=?`,
    orderCode, provider,
  );
  if (existing) {
    if (Number(existing.requested_amount) !== requestedAmount) throw new Error("qris_invoice_amount_mismatch");
    if (!["pending", "paid"].includes(String(existing.status))) throw new Error("qris_invoice_terminal");
    return invoiceFromRow(existing, true);
  }

  const staticPayload = gopayStaticPayload();
  if (!staticPayload) throw new Error("qris_not_configured");
  if (!getGopayInvoiceMerchantId(staticPayload)) throw new Error("gopay_invalid_merchant_qris");
  const order = await queryFirst("SELECT expires_at FROM orders WHERE code=?", orderCode);
  const orderDeadline = parseDbTimeUtc(order?.expires_at);
  const expiresAt = new Date(Math.min(Date.now() + QRIS_EXPIRY_MINUTES * 60_000, Number.isFinite(orderDeadline) ? orderDeadline : Infinity)).toISOString();
  const qrisUrl = publicQrisUrl(orderCode);
  const maxCode = qrisMaxUniqueCode(requestedAmount);
  // Least-recently-used: nominal yang belum pernah dipakai dahulu, lalu yang
  // terakhir dipakai paling lama. Nominal di luar DANA_AMOUNT_REUSE_WINDOW_HOURS
  // aman dicocokkan otomatis; hanya bila seluruh pool terpakai dalam jendela
  // itu pembayaran butuh verifikasi bank admin.
  const history = await queryAll(
    `SELECT payable_amount, MAX(julianday(COALESCE(expires_at,issued_at))) AS last_used_jd
     FROM payment_invoice_history WHERE provider=? AND payable_amount BETWEEN ? AND ?
     GROUP BY payable_amount`,
    provider, requestedAmount + 1, requestedAmount + maxCode,
  );
  const lastUsed = lastUsedByAmount(history);
  const start = randomUniqueCode(maxCode);
  const codes = Array.from({ length: maxCode }, (_, i) => 1 + ((start - 1 + i) % maxCode))
    .sort((a, b) => (lastUsed.get(requestedAmount + a) ?? 0) - (lastUsed.get(requestedAmount + b) ?? 0));

  for (let attempt = 0; attempt < 40; attempt++) {
    const uniqueCode = codes[attempt];
    const payableAmount = requestedAmount + uniqueCode;
    const qrisPayload = makeDynamicQris(staticPayload, payableAmount);
    const guardId = `${orderCode}:${provider}-invoice`;
    try {
      await d1.batch([
        d1.prepare(
           `INSERT INTO operation_guards (operation_id,valid)
            SELECT ?,CASE WHEN EXISTS(
              SELECT 1 FROM orders WHERE code=? AND status='pending' AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
            ) AND NOT EXISTS(
              SELECT 1 FROM payment_transactions WHERE order_code=?
            ) THEN 1 ELSE 0 END`,
        ).bind(guardId, orderCode, orderCode),
        d1.prepare(
           `INSERT INTO payment_transactions (
              order_code, provider, provider_mode, provider_order_id, merchant_id,
              requested_amount, payable_amount, unique_code, status, qris_payload,
              qris_url, direct_url, expires_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(
          orderCode, provider, GOPAY_QRIS_MODE, orderCode, gopayMerchantId(),
          requestedAmount, payableAmount, uniqueCode, "pending", qrisPayload,
          qrisUrl, `/pesanan/${encodeURIComponent(orderCode)}`, expiresAt,
        ),
        d1.prepare(
          `UPDATE orders
           SET payment_method='qris', payment_account=?, payment_status='pending',
               expires_at=COALESCE(expires_at,?), updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(qrisPaymentAccountLabel(provider), expiresAt, orderCode),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ]);
      // 2026-10-10: QR GoPay baru → bangunkan poller VPS (idle 60 dtk) agar
      // pembeli yang bayar cepat tetap terdeteksi ±15 dtk. Best-effort.
      await wakeGopayPollerSafe("invoice");
      return { orderCode, requestedAmount, payableAmount, uniqueCode, qrisPayload, qrisUrl, expiresAt, isExisting: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const winner = await queryFirst(
        `SELECT order_code, requested_amount, payable_amount, unique_code, qris_payload, qris_url, expires_at, status
         FROM payment_transactions WHERE order_code=? AND provider=?`,
        orderCode, provider,
      );
      if (winner && ["pending", "paid"].includes(String(winner.status))) {
        if (Number(winner.requested_amount) !== requestedAmount) throw new Error("qris_invoice_amount_mismatch");
        return invoiceFromRow(winner, true);
      }
      if (/UNIQUE|payment_transactions_active_gopay_amount/i.test(message)) continue;
      throw error;
    }
  }
  throw new Error("qris_unique_amount_unavailable");
}

/**
 * True bila timestamp masih di masa depan. Memakai `parseDbTimeUtc` (bukan
 * `Date.parse` langsung) agar baris lama berformat spasi "YYYY-MM-DD HH:MM:SS"
 * dibaca sebagai UTC — `Date.parse` menafsirkannya sebagai waktu LOKAL, yang
 * di WIB menggeser expiry 7 jam lebih awal. Nilai kosong dianggap masih
 * berlaku (fail-safe: tidak menganggap sesuatu kedaluwarsa tanpa bukti).
 */
function isStillInFuture(value: unknown, now = Date.now()): boolean {
  if (value === null || value === undefined || String(value).trim() === "") return true;
  const parsed = parseDbTimeUtc(value);
  return Number.isNaN(parsed) ? true : parsed > now;
}

export type QrisReissueResult =  | { ok: true; invoice: QrisInvoice; remaining: number }
  | { ok: false; reason: "order_not_reissuable" | "invoice_still_active" | "reissue_limit_reached" | "amount_unavailable" };

/**
 * Terbitkan QRIS BARU untuk order yang masih hidup.
 *
  * Kenapa perlu: `createGopayQrisInvoice` mengembalikan baris lama begitu
  * `payment_transactions` ada (`isExisting: true`), dan `invoice-retry.ts` hanya
  * mengirim ulang FOTO invoice yang sama. Reissue memberi QR baru tanpa
  * mengulang checkout — order tetap mati 15 menit dari awal bila tidak dibayar.
 *
 * Aturan yang ditegakkan:
  * 1. Order wajib masih `pending`, belum `paid`, dan belum melewati
  *    `orders.expires_at` (15 menit, sama dengan umur QR).
 * 2. Invoice lama wajib SUDAH kedaluwarsa. Ini bukan sekadar kerapian: karena
 *    endpoint reissue tidak butuh login (pembeli hanya memegang kode order),
 *    syarat ini membuat pihak lain yang menebak kode TIDAK bisa membatalkan QR
 *    yang sedang aktif dipakai pembeli.
 * 3. Maksimal MAX_QRIS_REISSUES kali per order.
 *
 * `payment_transactions` punya UNIQUE(order_code), sehingga reissue meng-UPDATE
 * baris yang sama di tempat. Trigger D1 menyimpan setiap penerbitan dalam
 * payment_invoice_history sebelum nominal lama hilang. Nominal lama tidak
 * boleh dipakai lagi oleh order ini; jika dipakai order lain setelah pool
 * habis, webhook dan retry admin mewajibkan rekonsiliasi manual.
 */
export async function reissueGopayQrisInvoice(orderCode: string): Promise<QrisReissueResult> {
  assertPaymentsAvailable();
  const d1 = getD1();
  if (!d1) throw new Error("qris_requires_d1");

  const row = await queryFirst(
    `SELECT o.code, o.status, o.payment_status, o.expires_at AS order_expires_at,
            o.qris_reissue_count, o.sales_channel,
            pt.requested_amount, pt.payable_amount, pt.status AS tx_status,
            pt.expires_at AS invoice_expires_at
     FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider='gopay'
     WHERE o.code=?`,
    orderCode,
  );
  if (!row || row.sales_channel === "whatsapp") return { ok: false, reason: "order_not_reissuable" };
  const detectedProvider = GOPAY_QRIS_PROVIDER;
  if (!isGopayQrisConfigured()) throw new Error("qris_not_configured");

  const orderAlive = String(row.status) === "pending"
    && ["unpaid", "pending"].includes(String(row.payment_status))
    && String(row.tx_status) === "pending"
    && isStillInFuture(row.order_expires_at);
  if (!orderAlive) return { ok: false, reason: "order_not_reissuable" };

  // Invoice yang masih berlaku tidak boleh diganti (lihat aturan 2 di atas).
  if (isStillInFuture(row.invoice_expires_at)) return { ok: false, reason: "invoice_still_active" };

  const usedReissues = Number(row.qris_reissue_count ?? 0);
  if (usedReissues >= MAX_QRIS_REISSUES) return { ok: false, reason: "reissue_limit_reached" };

  const requestedAmount = Number(row.requested_amount);
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < MIN_AMOUNT) {
    return { ok: false, reason: "order_not_reissuable" };
  }

  const staticPayload = gopayStaticPayload();
  if (!staticPayload) throw new Error("qris_not_configured");
  const previousAmount = Number(row.payable_amount);
  const orderDeadline = parseDbTimeUtc(row.order_expires_at);
  const expiresAt = new Date(Math.min(
    Date.now() + QRIS_EXPIRY_MINUTES * 60_000,
    Number.isFinite(orderDeadline) ? orderDeadline : Infinity,
  )).toISOString();
  const qrisUrl = publicQrisUrl(orderCode);

  const maxCode = qrisMaxUniqueCode(requestedAmount);
  // Hindari nominal yang pernah dipakai order LAIN supaya webhook tidak
  // menolaknya sebagai `amount_reused_requires_review`, dan hindari nominal
  // yang baru saja dipakai order ini sendiri.
  const history = await queryAll(
    `SELECT payable_amount, order_code, julianday(COALESCE(expires_at,issued_at)) AS last_used_jd FROM payment_invoice_history
     WHERE provider=? AND payable_amount BETWEEN ? AND ?`,
    detectedProvider, requestedAmount + 1, requestedAmount + maxCode,
  );
  const lastUsed = lastUsedByAmount(history);
  const usedByOrder = new Set(history.filter((h) => h.order_code === orderCode).map((h) => Number(h.payable_amount)));
  const start = randomUniqueCode(maxCode);
  const codes = Array.from(
    { length: maxCode },
    (_, index) => 1 + ((start - 1 + index) % maxCode),
  )
    .filter((code) => requestedAmount + code !== previousAmount && !usedByOrder.has(requestedAmount + code))
    .sort((a, b) => (lastUsed.get(requestedAmount + a) ?? 0) - (lastUsed.get(requestedAmount + b) ?? 0));

  for (let attempt = 0; attempt < Math.min(40, codes.length); attempt++) {
    const uniqueCode = codes[attempt];
    const payableAmount = requestedAmount + uniqueCode;
    const qrisPayload = makeDynamicQris(staticPayload, payableAmount);
    const guardId = `${orderCode}:${detectedProvider}-reissue:${usedReissues}`;
    try {
      await d1.batch([
        // Fencing pada qris_reissue_count: dua permintaan reissue bersamaan
        // hanya boleh menghasilkan SATU pemenang, kalau tidak QR yang tampil
        // di layar pembeli bisa berbeda dari nominal yang tersimpan.
        d1.prepare(
          `INSERT INTO operation_guards (operation_id, valid)
           SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM orders o
             JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider=?
             WHERE o.code=? AND o.status='pending' AND o.payment_status IN ('unpaid','pending')
               AND o.sales_channel!='whatsapp' AND o.qris_reissue_count=? AND o.qris_reissue_count<? AND pt.status='pending'
               AND (o.expires_at IS NULL OR julianday(o.expires_at)>julianday('now'))
               AND julianday(pt.expires_at)<=julianday('now')
               AND NOT EXISTS (
                 SELECT 1 FROM payment_invoice_history h
                 WHERE h.provider=pt.provider AND h.order_code=o.code AND h.payable_amount=?
               )
           ) THEN 1 ELSE 0 END`,
        ).bind(guardId, detectedProvider, orderCode, usedReissues, MAX_QRIS_REISSUES, payableAmount),
        d1.prepare(
          `UPDATE payment_transactions
           SET payable_amount=?, unique_code=?, qris_payload=?, qris_url=?,
               expires_at=?, invoice_issued_at=datetime('now'), expiry_notice_state=NULL, last_error=NULL, updated_at=datetime('now')
           WHERE order_code=? AND provider=? AND status='pending'`,
        ).bind(payableAmount, uniqueCode, qrisPayload, qrisUrl, expiresAt, orderCode, detectedProvider),
        d1.prepare(
          `UPDATE orders
           SET qris_reissue_count=qris_reissue_count+1,
               telegram_invoice_sent_at=NULL, telegram_invoice_attempts=0, updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(orderCode),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ]);
      await wakeGopayPollerSafe("reissue");
      return {
        ok: true,
        remaining: MAX_QRIS_REISSUES - (usedReissues + 1),
        invoice: {
          orderCode,
          requestedAmount,
          payableAmount,
          uniqueCode,
          qrisPayload,
          qrisUrl,
          expiresAt,
          isExisting: false,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Tabrakan pada index unique parsial payable_amount = nominal itu sedang
      // dipakai invoice aktif order lain (index per provider). Coba nominal
      // berikutnya.
      if (/UNIQUE|payment_transactions_active_gopay_amount/i.test(message)) continue;
      // Guard gagal = order sudah berubah (dibayar/dibatalkan) atau reissue
      // lain menang. Tidak ada efek samping karena batch dibatalkan penuh.
      if (/operation_guards|CHECK constraint/i.test(message)) {
        return { ok: false, reason: "order_not_reissuable" };
      }
      throw error;
    }
  }
  return { ok: false, reason: "amount_unavailable" };
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^Rp\s*/i, "").replace(/\./g, "").replace(/,00$/, "");
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseQrisWebhookFields(body: unknown): QrisWebhookFields | null {
  const root = asObject(body);
  if (!root) return null;
  const payment = asObject(root.payment);
  const notification = asObject(root.notification);
  const raw = asObject(root.raw);
  const rawTextValue = notification?.text ?? root.text ?? raw?.text;
  const rawText = typeof rawTextValue === "string" ? rawTextValue.slice(0, 2000) : null;
  let amount = parseAmount(payment?.amount ?? root.amount);
  if (!amount && rawText) {
    const match = rawText.match(/\bRp\s*([\d.]+(?:,00)?)/i);
    amount = match ? parseAmount(match[1]) : null;
  }
  if (!amount) return null;
  const senderValue = payment?.sender_name ?? payment?.senderName ?? root.sender_name ?? root.senderName;
  const eventValue = root.event_id ?? root.eventId ?? notification?.id ?? payment?.id ?? root.id;
  return {
    amount,
    senderName: typeof senderValue === "string" && senderValue.trim() ? senderValue.trim().slice(0, 160) : null,
    rawText,
    sourceEventId: typeof eventValue === "string" || typeof eventValue === "number" ? String(eventValue).slice(0, 200) : null,
  };
}

/**
 * Parser generik event pembayaran QRIS (dipakai webhook GoPay).
 * Poller GoPay mengirim {amount, order_code?} sehingga match bisa langsung
 * ke order tanpa tebak nominal; fallback nominal persis + causal guard tetap
 * berlaku bila order_code tidak disertakan.
 */
export type QrisWebhookPayment = QrisWebhookFields & {
  orderCode: string | null;
};
export function parseQrisWebhook(body: unknown): QrisWebhookPayment | null {
  const base = parseQrisWebhookFields(body);
  if (!base) return null;
  const root = asObject(body);
  const payment = root ? asObject(root.payment) : null;
  const codeValue = root?.order_code ?? root?.orderCode ?? payment?.order_code ?? payment?.orderCode ?? null;
  const orderCode = typeof codeValue === "string" && /^[A-Z0-9-]{4,40}$/i.test(codeValue.trim())
    ? codeValue.trim().toUpperCase().slice(0, 40)
    : null;
  return { ...base, orderCode };
}

// Keep the GoPay consumers on the canonical comparison implementation.
export { constantTimeEqual } from "@/lib/security";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
