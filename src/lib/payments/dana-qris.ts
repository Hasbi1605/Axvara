import { getD1, queryFirst } from "@/lib/db";

export const DANA_QRIS_PROVIDER = "dana";
export const DANA_QRIS_MODE = "dynamic-qris";
export const DANA_QRIS_EXPIRY_MINUTES = 15;
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
  return 1 + (bytes[0] % 499);
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
  if (!Number.isSafeInteger(requestedAmount) || requestedAmount < MIN_AMOUNT || requestedAmount > MAX_AMOUNT - 499) {
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
  const qrisUrl = publicQrisUrl(orderCode);

  for (let attempt = 0; attempt < 40; attempt++) {
    const uniqueCode = randomUniqueCode();
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
        ).bind(expiresAt, orderCode),
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

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
