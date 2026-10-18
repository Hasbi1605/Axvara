// KlikQRIS PG API: https://klikqris.com/dokumentasi-api (in-house mode).
// Never expose the API key, stored signature, or raw provider JSON to buyers.
import { getD1, queryFirst, execRun, transitionPendingPaymentToPaid } from "@/lib/db";
import { constantTimeEqual } from "@/lib/security";
import { assertPaymentsAvailable } from "@/lib/payment-maintenance";
import { SITE } from "@/lib/site";
import type { DanaQrisInvoice } from "./dana-qris";

type Row = Record<string, unknown>;
const BASE = "https://klikqris.com";
const LOCAL_TTL_MS = 15 * 60_000;
function dbTime(value: unknown): number {
  const text=String(value || "");
  return Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(" ", "T")+"Z" : text);
}
export const KLIKQRIS_CALLBACK_PATH = "/api/payments/klikqris/callback";
export function isKlikQrisConfigured(): boolean {
  return process.env.KLIKQRIS_ENABLED === "true" && Boolean(process.env.KLIKQRIS_API_KEY?.trim())
    && /^[0-9]+$/.test(process.env.KLIKQRIS_MERCHANT_ID || "");
}
export function klikQrisMoney(value: unknown): number {
  if (!/^[0-9]+(?:\.0{1,2})?$/.test(String(value))) throw new Error("klikqris_invalid_amount");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 999_999_999) throw new Error("klikqris_invalid_amount");
  return number;
}
export function klikQrisTime(value: unknown): number {
  const text = String(value || "").trim();
  const result = Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text) ? text.replace(" ", "T") + "+07:00" : text);
  if (!Number.isFinite(result)) throw new Error("klikqris_invalid_time");
  return result;
}
export function validKlikQrisImage(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || !["klikqris.com", "www.klikqris.com"].includes(url.hostname)
    || url.username || url.password || (url.port && url.port !== "443") || !url.pathname.startsWith("/storage/")) throw new Error("klikqris_invalid_image");
  return url.href;
}
async function api(path: string, data?: Row): Promise<Row> {
  if (!isKlikQrisConfigured()) throw new Error("klikqris_not_configured");
  let response: Response;
  try {
    response = await fetch(`${BASE}/api/qris/${path}`, {
      // workerd rejects redirect:"error" before sending the request. Manual
      // mode preserves our no-redirect policy; non-2xx responses fail below.
      method: data ? "POST" : "GET", redirect: "manual", cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json",
        "x-api-key": process.env.KLIKQRIS_API_KEY!, id_merchant: process.env.KLIKQRIS_MERCHANT_ID! },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new Error("klikqris_network_ambiguous"); }
  if (!response.ok) throw new Error(`klikqris_http_${response.status}`);
  const json = await response.json().catch(() => null) as { status?: unknown; data?: Row } | null;
  if (json?.status !== true || !json.data || typeof json.data !== "object" || Array.isArray(json.data)) throw new Error("klikqris_invalid_response");
  return json.data;
}
function validateDetails(data: Row, orderCode: string, amount: number, merchantId: string): void {
  if (data.order_id !== orderCode || klikQrisMoney(data.amount) !== amount
    || (data.id_merchant != null && String(data.id_merchant) !== merchantId)
    || (data.merchant_id != null && String(data.merchant_id) !== merchantId)) throw new Error("klikqris_invoice_mismatch");
  if (klikQrisMoney(data.total_amount) < amount) throw new Error("klikqris_invoice_mismatch");
}
function invoice(row: Row, existing: boolean): DanaQrisInvoice {
  return { orderCode: String(row.order_code), requestedAmount: Number(row.requested_amount), payableAmount: Number(row.payable_amount),
    uniqueCode: Number(row.unique_code), qrisPayload: "", qrisUrl: String(row.qris_url), expiresAt: String(row.expires_at), isExisting: existing };
}

export async function createKlikQrisInvoice(orderCode: string, requestedAmount: number): Promise<DanaQrisInvoice> {
  assertPaymentsAvailable(); klikQrisMoney(requestedAmount);
  const d1 = getD1(); if (!d1) throw new Error("klikqris_requires_d1");
  let tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=?", orderCode);
  // A retry after switching gateway must retain the original invoice rail.
  if (tx && tx.provider !== "klikqris") {
    const legacy = await import("./dana-qris");
    if (tx.provider === "dana") return legacy.createDanaQrisInvoice(orderCode, requestedAmount);
    if (tx.provider === "gopay") return legacy.createGopayQrisInvoice(orderCode, requestedAmount);
    throw new Error("klikqris_provider_conflict");
  }
  if (!isKlikQrisConfigured()) throw new Error("klikqris_not_configured");
  const merchant = process.env.KLIKQRIS_MERCHANT_ID!;
  if (tx && (Number(tx.requested_amount) !== requestedAmount || tx.merchant_id !== merchant)) throw new Error("klikqris_invoice_mismatch");
  if (tx && ["paid", "pending"].includes(String(tx.status))) {
    if (tx.status !== "paid" && dbTime(tx.expires_at) <= Date.now()) throw new Error("klikqris_invoice_terminal");
    return invoice(tx, true);
  }
  if (tx && tx.status !== "initializing") throw new Error("klikqris_invoice_terminal");
  let claimed = false;
  if (!tx) {
    const order = await queryFirst("SELECT status,payment_status,expires_at FROM orders WHERE code=?", orderCode);
    const deadline = Math.min(Date.now() + LOCAL_TTL_MS, order?.expires_at ? dbTime(order.expires_at) : Infinity);
    if (!order || order.status !== "pending" || !["pending", "unpaid"].includes(String(order.payment_status)) || !(deadline > Date.now())) throw new Error("klikqris_order_terminal");
    const guard = `${orderCode}:klikqris:claim`;
    try {
      await d1.batch([
        d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
          SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('pending','unpaid')
          AND (expires_at IS NULL OR julianday(expires_at)>julianday('now')))
          AND NOT EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=?) THEN 1 ELSE 0 END`).bind(guard, orderCode, orderCode),
        d1.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,requested_amount,status,expires_at)
          VALUES(?,'klikqris','inhouse',?,?,?,'initializing',?)`).bind(orderCode, orderCode, merchant, requestedAmount, new Date(deadline).toISOString()),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
      ]);
      claimed = true;
    } catch (error) {
      if (!/UNIQUE|CHECK constraint|operation_guards/i.test(error instanceof Error ? error.message : "")) throw error;
    }
    tx = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='klikqris'", orderCode);
    if (!tx) throw new Error("klikqris_order_conflict");
    if (tx.status === "pending" || tx.status === "paid") return invoice(tx, true);
  }
  if (!(dbTime(tx!.expires_at) > Date.now())) throw new Error("klikqris_invoice_terminal");
  // Only the durable claim winner may POST. Ambiguous attempts recover by GET,
  // never by repeating create or switching gateways.
  try {
    const data = claimed ? await api("create", { order_id: orderCode, id_merchant: merchant, amount: requestedAmount,
      keterangan: `Pembayaran AXVARA ${orderCode}`, callback_url: SITE.webUrl + KLIKQRIS_CALLBACK_PATH })
      : await api(`status/${encodeURIComponent(orderCode)}`);
    validateDetails(data, orderCode, requestedAmount, merchant);
    const amount = klikQrisMoney(data.total_amount), signature = String(data.signature || "");
    if (data.status !== "PENDING" || signature.length < 16 || signature.length > 2048) throw new Error("klikqris_invalid_invoice");
    const imageSource = validKlikQrisImage(data.qris_url);
    const expires = new Date(Math.min(klikQrisTime(data.expired_at), dbTime(tx!.expires_at))).toISOString();
    if (Date.parse(expires) <= Date.now()) throw new Error("klikqris_invoice_terminal");
    const imageUrl = `${SITE.webUrl}/api/payments/qris/${encodeURIComponent(orderCode)}/image`;
    const guard = `${orderCode}:klikqris:finish:${crypto.randomUUID()}`;
    await d1.batch([
      d1.prepare(`INSERT INTO operation_guards(operation_id,valid) SELECT ?,CASE WHEN EXISTS(
        SELECT 1 FROM orders o JOIN payment_transactions pt ON pt.order_code=o.code
        WHERE o.code=? AND o.status='pending' AND o.payment_status IN ('pending','unpaid')
        AND pt.provider='klikqris' AND pt.status='initializing' AND julianday(pt.expires_at)>julianday('now')) THEN 1 ELSE 0 END`).bind(guard, orderCode),
      d1.prepare(`UPDATE payment_transactions SET status='pending',payable_amount=?,unique_code=?,provider_signature=?,provider_qris_url=?,
        qris_url=?,expires_at=?,invoice_issued_at=COALESCE(invoice_issued_at,datetime('now')),last_error=NULL,updated_at=datetime('now')
        WHERE order_code=? AND provider='klikqris' AND status='initializing'`).bind(amount, amount-requestedAmount, signature, imageSource, imageUrl, expires, orderCode),
      d1.prepare("UPDATE orders SET payment_method='qris',payment_account='KlikQRIS',expires_at=?,updated_at=datetime('now') WHERE code=? AND status='pending'").bind(expires, orderCode),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard),
    ]);
    const saved = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='klikqris'", orderCode);
    if (!saved) throw new Error("klikqris_invoice_missing");
    return invoice(saved, !claimed);
  } catch (error) {
    const reason = error instanceof Error && /^klikqris_[a-z0-9_]+$/.test(error.message) ? error.message : "klikqris_invoice_incomplete";
    await execRun("UPDATE payment_transactions SET last_error=?,updated_at=datetime('now') WHERE order_code=? AND provider='klikqris' AND status='initializing'", reason, orderCode).catch(() => {});
    const saved = await queryFirst("SELECT * FROM payment_transactions WHERE order_code=? AND provider='klikqris'", orderCode).catch(() => null);
    if (saved && saved.status === "pending" && dbTime(saved.expires_at) > Date.now()) return invoice(saved, true);
    throw new Error(reason);
  }
}

export async function reconcileKlikQrisPayment(orderCode: string): Promise<string> {
  const tx = await queryFirst(`SELECT pt.*,o.status AS order_status,o.payment_status,o.expires_at AS order_expires_at,
    o.variant_id,o.sales_channel,o.order_kind,(SELECT id FROM fulfillment_inventory fi WHERE fi.order_code=o.code AND fi.status='reserved' LIMIT 1) AS inventory_id
    FROM payment_transactions pt JOIN orders o ON o.code=pt.order_code WHERE pt.order_code=? AND pt.provider='klikqris'`, orderCode);
  if (!tx) throw new Error("klikqris_transaction_missing");
  if (tx.status === "paid") return "already_paid";
  if (!tx.provider_signature || tx.status === "initializing") throw new Error("klikqris_invoice_initializing");
  if (String(tx.merchant_id) !== process.env.KLIKQRIS_MERCHANT_ID) throw new Error("klikqris_merchant_mismatch");
  const data = await api(`status/${encodeURIComponent(String(tx.provider_order_id))}`);
  validateDetails(data, String(tx.provider_order_id), Number(tx.requested_amount), String(tx.merchant_id));
  if (klikQrisMoney(data.total_amount) !== Number(tx.payable_amount)
    || (data.signature != null && !constantTimeEqual(String(data.signature), String(tx.provider_signature)))) throw new Error("klikqris_status_mismatch");
  const state = String(data.status).toUpperCase();
  if (state === "PENDING") return "pending";
  if (state === "EXPIRED") return "expired"; // Existing cron owns stock/credit expiry.
  if (!["SUCCESS", "PAID"].includes(state)) throw new Error("klikqris_unknown_status");
  const paidAt = new Date(klikQrisTime(data.paid_at)).toISOString();
  const eventKey = `klikqris:${tx.provider_order_id}:paid`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey));
  const hash = Array.from(new Uint8Array(digest), value=>value.toString(16).padStart(2,"0")).join("");
  const inserted = await execRun(`INSERT OR IGNORE INTO dana_webhook_events(event_key,payload_hash,amount,raw_text,provider,status,order_code)
    VALUES(?,?,?,?,'klikqris','received',?)`, eventKey, hash, tx.payable_amount,
    JSON.stringify({ order_id: tx.provider_order_id, status: state, total_amount: tx.payable_amount }), orderCode);
  const event = await queryFirst("SELECT id,status FROM dana_webhook_events WHERE event_key=?", eventKey);
  if (!event) throw new Error("klikqris_event_missing");
  if (event.status === "matched") return "already_paid";
  const deadline = Math.min(dbTime(tx.expires_at), dbTime(tx.order_expires_at));
  if (tx.status !== "pending" || tx.order_status !== "pending" || !(deadline > Date.now()) || Date.parse(paidAt) > deadline) {
    await manualReview(tx, Number(event.id), Number(inserted.changes || 0) > 0, "klikqris_late_payment_manual_review");
    return "manual_review";
  }
  const changed = await transitionPendingPaymentToPaid(orderCode, paidAt, tx.order_kind === "pedia" ? null : {
    variantId: tx.variant_id == null ? null : Number(tx.variant_id), inventoryId: tx.inventory_id == null ? null : Number(tx.inventory_id),
    salesChannel: String(tx.sales_channel),
  }, { id: Number(event.id) });
  if (!changed) {
    const paid = await queryFirst("SELECT status FROM payment_transactions WHERE order_code=?", orderCode);
    if (paid?.status === "paid") return "already_paid";
    await manualReview(tx, Number(event.id), Number(inserted.changes || 0) > 0, "klikqris_payment_race_manual_review");
    return "manual_review";
  }
  if (tx.order_kind !== "pedia") {
  try { const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver"); await ensureFulfillmentForPaidOrder(orderCode); } catch { /* Durable outbox is retried by cron. */ }
  try { const { createWrOrderLinksForOrder } = await import("@/lib/warung-rebahan/order"); await createWrOrderLinksForOrder(orderCode); } catch { /* Existing cron repairs missing links. */ }
  try { const { createSkOrderLinksForOrder } = await import("@/lib/sekalipay/order"); await createSkOrderLinksForOrder(orderCode); } catch { /* Existing cron repairs missing links. */ }
  }
  if (tx.order_kind === "pedia") {
    try { const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch"); await processPediaPaidOrders(); } catch { /* Existing cron dispatches the durable job. */ }
  }
  return "paid";
}
async function manualReview(tx: Row, eventId: number, notify: boolean, reason: string) {
  await execRun("UPDATE dana_webhook_events SET status='failed',last_error=?,processed_at=datetime('now') WHERE id=? AND status!='matched'", reason, eventId);
  await execRun("UPDATE payment_transactions SET last_error=?,updated_at=datetime('now') WHERE order_code=? AND status!='paid'", reason, tx.order_code);
  if (notify && process.env.TELEGRAM_ADMIN_CHAT_ID) {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({ chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
        text: `Pembayaran KlikQRIS perlu diperiksa manual.\nPesanan: ${tx.order_code}\nNominal: Rp ${Number(tx.payable_amount).toLocaleString("id-ID")}\nBatas bayar AXVARA 15 menit sudah lewat atau status pesanan berubah. Produk tidak dikirim otomatis. Periksa Metode & Rekonsiliasi.`,
      });
    } catch { /* The durable reconciliation entry remains visible. */ }
  }
}

export async function fetchKlikQrisImage(source: unknown): Promise<Uint8Array> {
  const url = validKlikQrisImage(source);
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("klikqris_image_unavailable");
  const reader=response.body.getReader(), chunks: Uint8Array[]=[]; let size=0;
  while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
    if(size>2_000_000){await reader.cancel();throw new Error("klikqris_image_too_large");}chunks.push(value); }
  const png=new Uint8Array(size);let offset=0;for(const chunk of chunks){png.set(chunk,offset);offset+=chunk.length;}
  if (![137,80,78,71,13,10,26,10].every((v,i)=>png[i]===v)) throw new Error("klikqris_invalid_png");
  return png;
}
