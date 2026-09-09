import { getD1, queryAll, queryFirst } from "@/lib/db";

export const DANA_QRIS_PROVIDER = "dana";
export const DANA_QRIS_MODE = "dynamic-qris";
export const DANA_QRIS_EXPIRY_MINUTES = 15;
/**
 * Masa hidup ORDER untuk pembayaran QRIS — sengaja BERBEDA dari
 * DANA_QRIS_EXPIRY_MINUTES di atas.
 *
 * Dulu keduanya disamakan: pembuatan invoice menimpa `orders.expires_at`
 * dengan expiry invoice 15 menit, sehingga saat QR mati order langsung
 * kedaluwarsa, cron membatalkannya, dan stok dilepas. Akibatnya pembeli yang
 * telat bayar wajib mengulang seluruh alur dan tidak pernah bisa memakai
 * QRIS baru untuk order yang sama.
 *
 * 60 menit = 4 jendela QR 15 menit, selaras dengan MAX_QRIS_REISSUES.
 * Ini juga batas atas lama stok tertahan oleh order yang belum dibayar.
 */
export const QRIS_ORDER_WINDOW_MINUTES = 60;
/** Batas penerbitan ulang QRIS per order (3 reissue + 1 invoice asli). */
export const MAX_QRIS_REISSUES = 3;
export const DANA_QRIS_MAX_UNIQUE_CODE = 299;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 999_999_999;

type Tlv = { tag: string; value: string };

export type DanaQrisInvoice = {
  orderCode: string;
  requestedAmount: number;
  payableAmount: number;
  uniqueCode: number;
  qrisPayload: string;
  qrisUrl: string;
  expiresAt: string;
  isExisting: boolean;
};

export type DanaWebhookPayment = {
  amount: number;
  senderName: string | null;
  rawText: string | null;
  sourceEventId: string | null;
};

/**
 * Batas kausalitas pencocokan pembayaran (masalah #2).
 *
 * QRIS Hook hanya meneruskan nominal + teks notifikasi tanpa stempel waktu
 * tepercaya dari DANA, sehingga "kapan uang benar-benar masuk" tidak dapat
 * diobservasi langsung. Yang dapat diobservasi adalah kapan *server*
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
 * - received_at bukan waktu pembayaran DANA. Nominal yang pernah digunakan
 *   invoice lain wajib direkonsiliasi manual; riwayat ledger harus disimpan.
 * - Kedua timestamp berasal dari database yang sama, sehingga tidak ada
 *   toleransi yang membolehkan event mendahului invoice.
 */
export const DANA_MATCH_CLOCK_SKEW_MS = 0;

export type DanaMatchCandidate = {
  orderCode: string;
  invoiceCreatedAt: unknown;
  invoiceExpiresAt: unknown;
};

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
  skewMs = DANA_MATCH_CLOCK_SKEW_MS,
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

/** Convert the private DANA Business merchant payload into a one-time amount QRIS. */
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

function randomUniqueCode(): number {
  const bytes = new Uint16Array(1);
  crypto.getRandomValues(bytes);
  return 1 + (bytes[0] % DANA_QRIS_MAX_UNIQUE_CODE);
}

function publicQrisUrl(orderCode: string): string {
  const siteUrl = (process.env.SITE_URL || "https://axvara.tech").replace(/\/$/, "");
  return `${siteUrl}/api/payments/qris/${encodeURIComponent(orderCode)}/image`;
}

export function isDanaQrisEnabled(): boolean {
  return process.env.DANA_QRIS_ENABLED === "true";
}

export function isDanaQrisConfigured(): boolean {
  return isDanaQrisEnabled()
    && Boolean(process.env.DANA_STATIC_QRIS?.trim())
    && Boolean(process.env.DANA_WEBHOOK_SECRET?.trim());
}

function invoiceFromRow(row: Record<string, unknown>, isExisting: boolean): DanaQrisInvoice {
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

/** Allocate a collision-safe payable amount and persist it with the order. */
export async function createDanaQrisInvoice(orderCode: string, requestedAmount: number): Promise<DanaQrisInvoice> {
  if (!isDanaQrisConfigured()) throw new Error("dana_qris_not_configured");
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < MIN_AMOUNT || requestedAmount > MAX_AMOUNT - DANA_QRIS_MAX_UNIQUE_CODE) {
    throw new Error("invalid_qris_amount");
  }
  const d1 = getD1();
  if (!d1) throw new Error("dana_qris_requires_d1");

  const existing = await queryFirst(
    `SELECT order_code, requested_amount, payable_amount, unique_code, qris_payload, qris_url, expires_at, status
     FROM payment_transactions WHERE order_code=? AND provider='dana'`,
    orderCode,
  );
  if (existing) {
    if (!["pending", "paid"].includes(String(existing.status))) throw new Error("dana_qris_invoice_terminal");
    return invoiceFromRow(existing, true);
  }

  const staticPayload = process.env.DANA_STATIC_QRIS!.trim();
  const expiresAt = new Date(Date.now() + DANA_QRIS_EXPIRY_MINUTES * 60_000).toISOString();
  // Masa hidup ORDER sengaja lebih panjang dari masa hidup INVOICE supaya QR
  // yang mati tidak ikut mematikan order dan melepas stok (lihat konstanta).
  const orderExpiresAt = new Date(Date.now() + QRIS_ORDER_WINDOW_MINUTES * 60_000).toISOString();
  const qrisUrl = publicQrisUrl(orderCode);
  // Prefer unused amounts. Once the finite range is exhausted, reused
  // amounts remain payable but require an administrator's bank verification.
  const history = await queryAll(
    "SELECT DISTINCT payable_amount FROM payment_transactions WHERE provider='dana' AND payable_amount BETWEEN ? AND ?",
    requestedAmount + 1, requestedAmount + DANA_QRIS_MAX_UNIQUE_CODE,
  );
  const used = new Set(history.map(row => Number(row.payable_amount)));
  const start = randomUniqueCode();
  const codes = Array.from({ length: DANA_QRIS_MAX_UNIQUE_CODE }, (_, i) => 1 + ((start - 1 + i) % DANA_QRIS_MAX_UNIQUE_CODE))
    .sort((a, b) => Number(used.has(requestedAmount + a)) - Number(used.has(requestedAmount + b)));

  for (let attempt = 0; attempt < 40; attempt++) {
    const uniqueCode = codes[attempt];
    const payableAmount = requestedAmount + uniqueCode;
    const qrisPayload = makeDynamicQris(staticPayload, payableAmount);
    const guardId = `${orderCode}:dana-invoice`;
    try {
      await d1.batch([
        d1.prepare(
          `INSERT INTO operation_guards (operation_id,valid)
           SELECT ?,CASE WHEN EXISTS(
             SELECT 1 FROM orders WHERE code=? AND status='pending'
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
          orderCode, DANA_QRIS_PROVIDER, DANA_QRIS_MODE, orderCode, "dana-business",
          requestedAmount, payableAmount, uniqueCode, "pending", qrisPayload,
          qrisUrl, `/pesanan/${encodeURIComponent(orderCode)}`, expiresAt,
        ),
        d1.prepare(
          `UPDATE orders
           SET payment_method='qris', payment_account='DANA Business', payment_status='pending',
               expires_at=?, updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(orderExpiresAt, orderCode),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ]);
      return { orderCode, requestedAmount, payableAmount, uniqueCode, qrisPayload, qrisUrl, expiresAt, isExisting: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const winner = await queryFirst(
        `SELECT order_code, requested_amount, payable_amount, unique_code, qris_payload, qris_url, expires_at, status
         FROM payment_transactions WHERE order_code=? AND provider='dana'`,
        orderCode,
      );
      if (winner && ["pending", "paid"].includes(String(winner.status))) return invoiceFromRow(winner, true);
      if (/UNIQUE|payment_transactions_active_dana_amount/i.test(message)) continue;
      throw error;
    }
  }
  throw new Error("dana_qris_unique_amount_unavailable");
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

export type QrisReissueResult =  | { ok: true; invoice: DanaQrisInvoice; remaining: number }
  | { ok: false; reason: "order_not_reissuable" | "invoice_still_active" | "reissue_limit_reached" | "amount_unavailable" };

/**
 * Terbitkan QRIS BARU untuk order yang masih hidup.
 *
 * Kenapa perlu: `createDanaQrisInvoice` mengembalikan baris lama begitu
 * `payment_transactions` ada (`isExisting: true`), dan `invoice-retry.ts` hanya
 * mengirim ulang FOTO invoice yang sama. Jadi sebelum ini tidak ada satu pun
 * jalur di mana pembeli bisa memperoleh QR yang masih berlaku setelah 15 menit.
 *
 * Aturan yang ditegakkan:
 * 1. Order wajib masih `pending`, belum `paid`, dan belum melewati
 *    `orders.expires_at` (jendela order 60 menit).
 * 2. Invoice lama wajib SUDAH kedaluwarsa. Ini bukan sekadar kerapian: karena
 *    endpoint reissue tidak butuh login (pembeli hanya memegang kode order),
 *    syarat ini membuat pihak lain yang menebak kode TIDAK bisa membatalkan QR
 *    yang sedang aktif dipakai pembeli.
 * 3. Maksimal MAX_QRIS_REISSUES kali per order.
 *
 * `payment_transactions` punya UNIQUE(order_code), sehingga reissue meng-UPDATE
 * baris yang sama di tempat. Konsekuensi yang disengaja: nominal LAMA tidak
 * lagi cocok dengan invoice aktif mana pun, jadi pembayaran yang telat pada
 * nominal lama akan jatuh ke `no_active_exact_amount` di webhook dan masuk
 * rekonsiliasi manual — gagal-tertutup, bukan melunasi order yang salah.
 */
export async function reissueDanaQrisInvoice(orderCode: string): Promise<QrisReissueResult> {
  if (!isDanaQrisConfigured()) throw new Error("dana_qris_not_configured");
  const d1 = getD1();
  if (!d1) throw new Error("dana_qris_requires_d1");

  const row = await queryFirst(
    `SELECT o.code, o.status, o.payment_status, o.expires_at AS order_expires_at,
            o.qris_reissue_count,
            pt.requested_amount, pt.payable_amount, pt.status AS tx_status,
            pt.expires_at AS invoice_expires_at
     FROM orders o
     JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider='dana'
     WHERE o.code=?`,
    orderCode,
  );
  if (!row) return { ok: false, reason: "order_not_reissuable" };

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

  const staticPayload = process.env.DANA_STATIC_QRIS!.trim();
  const previousAmount = Number(row.payable_amount);
  const expiresAt = new Date(Date.now() + DANA_QRIS_EXPIRY_MINUTES * 60_000).toISOString();
  const qrisUrl = publicQrisUrl(orderCode);

  // Hindari nominal yang pernah dipakai order LAIN supaya webhook tidak
  // menolaknya sebagai `amount_reused_requires_review`, dan hindari nominal
  // yang baru saja dipakai order ini sendiri.
  const history = await queryAll(
    `SELECT DISTINCT payable_amount FROM payment_transactions
     WHERE provider='dana' AND payable_amount BETWEEN ? AND ?`,
    requestedAmount + 1, requestedAmount + DANA_QRIS_MAX_UNIQUE_CODE,
  );
  const used = new Set(history.map((historyRow) => Number(historyRow.payable_amount)));
  const start = randomUniqueCode();
  const codes = Array.from(
    { length: DANA_QRIS_MAX_UNIQUE_CODE },
    (_, index) => 1 + ((start - 1 + index) % DANA_QRIS_MAX_UNIQUE_CODE),
  )
    .filter((code) => requestedAmount + code !== previousAmount)
    .sort((a, b) => Number(used.has(requestedAmount + a)) - Number(used.has(requestedAmount + b)));

  for (let attempt = 0; attempt < Math.min(40, codes.length); attempt++) {
    const uniqueCode = codes[attempt];
    const payableAmount = requestedAmount + uniqueCode;
    const qrisPayload = makeDynamicQris(staticPayload, payableAmount);
    const guardId = `${orderCode}:dana-reissue:${usedReissues}`;
    try {
      await d1.batch([
        // Fencing pada qris_reissue_count: dua permintaan reissue bersamaan
        // hanya boleh menghasilkan SATU pemenang, kalau tidak QR yang tampil
        // di layar pembeli bisa berbeda dari nominal yang tersimpan.
        d1.prepare(
          `INSERT INTO operation_guards (operation_id, valid)
           SELECT ?, CASE WHEN EXISTS(
             SELECT 1 FROM orders o
             JOIN payment_transactions pt ON pt.order_code=o.code AND pt.provider='dana'
             WHERE o.code=? AND o.status='pending' AND o.payment_status IN ('unpaid','pending')
               AND o.qris_reissue_count=? AND pt.status='pending'
           ) THEN 1 ELSE 0 END`,
        ).bind(guardId, orderCode, usedReissues),
        d1.prepare(
          `UPDATE payment_transactions
           SET payable_amount=?, unique_code=?, qris_payload=?, qris_url=?,
               expires_at=?, last_error=NULL, updated_at=datetime('now')
           WHERE order_code=? AND provider='dana' AND status='pending'`,
        ).bind(payableAmount, uniqueCode, qrisPayload, qrisUrl, expiresAt, orderCode),
        d1.prepare(
          `UPDATE orders
           SET qris_reissue_count=qris_reissue_count+1, updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(orderCode),
        d1.prepare(`DELETE FROM operation_guards WHERE operation_id=?`).bind(guardId),
      ]);
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
      // dipakai invoice aktif order lain. Coba nominal berikutnya.
      if (/UNIQUE|payment_transactions_active_dana_amount/i.test(message)) continue;
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

export function parseDanaWebhook(body: unknown): DanaWebhookPayment | null {
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

// Re-export agar nama publik yang sudah dipakai webhook DANA + test tetap
// stabil, tetapi implementasinya satu di src/lib/security.ts.
export { constantTimeEqual } from "@/lib/security";

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
