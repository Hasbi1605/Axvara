// src/lib/fulfillment/delivery/buyer-email.ts — Pengiriman produk non-WR ke
// pembeli WEB lewat email + pembaca isi yang sudah terkirim.
//
// Sebelum 2026-09-25 setiap item non-WR kanal web dipaksa `manual_required`
// (web dianggap tidak punya kanal kirim), padahal checkout web mewajibkan
// email dan badge storefront menjanjikan "Kirim otomatis". Kini item
// shared/unique kanal web dikirim lewat email "Pesanan Siap" yang sekaligus
// memuat tanda terima pembayaran (satu email, keputusan owner).
import type { DatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "../crypto";
import type { Row } from "./types";

const DELIVERY_EMAIL_TIMEOUT_MS = 8_000;

export function isValidBuyerEmail(raw: unknown): boolean {
  const email = String(raw ?? "").trim();
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type OrderLine = { name?: unknown; qty?: unknown; price?: unknown };

function orderLines(raw: unknown): OrderLine[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed as OrderLine[] : [];
  } catch {
    return [];
  }
}

/** "Canva Pro / Premium — Invite 1 Bulan ×2" untuk baris ke-i pesanan. */
export function orderLineLabel(items: unknown, itemIndex: number): string {
  const line = orderLines(items)[itemIndex];
  const name = String(line?.name ?? "").trim() || "Produk";
  const qty = Math.max(1, Number(line?.qty ?? 1) || 1);
  return qty > 1 ? `${name} ×${qty}` : name;
}

function paymentMethodLabel(method: unknown): string {
  const value = String(method ?? "").trim().toLowerCase();
  if (value === "qris") return "QRIS";
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function siteUrl(fallback: string): string {
  return (process.env.SITE_URL || fallback).replace(/\/$/, "");
}

/**
 * Kirim isi satu item ke email pembeli web. Melempar bila gagal supaya
 * pemanggil (processItem) menjadwalkan retry, lalu alarm admin + kabar
 * pembeli saat percobaan habis.
 *
 * Idempoten per item lewat buyer_notice_log: bila email item ini sudah
 * tercatat `sent` (mis. kirim sukses tetapi penulisan status gagal), retry
 * tidak mengirim email kedua. Tidak memakai klaim `sending`: lease item
 * sudah menjamin hanya satu worker yang memproses item ini.
 */
export async function sendWebDeliveryEmail(params: {
  database: DatabaseAccess;
  orderCode: string;
  itemId: number;
  plaintext: string;
}): Promise<void> {
  const { database, orderCode, itemId, plaintext } = params;
  const key = `email:fulfillment-item:${itemId}`;
  const ledger = await database
    .queryFirst(`SELECT status FROM buyer_notice_log WHERE idempotency_key=?`, key)
    .catch(() => null);
  if (String(ledger?.status ?? "") === "sent") return;

  const order = await database.queryFirst(
    `SELECT o.customer_name, o.customer_email, o.items, o.subtotal, o.payment_method,
            (SELECT pt.payable_amount FROM payment_transactions pt WHERE pt.order_code=o.code
              ORDER BY pt.id DESC LIMIT 1) AS payable_amount,
            (SELECT fi.item_index FROM fulfillment_items fi WHERE fi.id=?) AS item_index
     FROM orders o WHERE o.code=?`,
    itemId, orderCode,
  );
  if (!order) throw new Error("order_not_found");
  const to = String(order.customer_email ?? "").trim();
  if (!isValidBuyerEmail(to)) throw new Error("web_no_buyer_email");

  const { isForwardEmailConfigured, sendForwardEmail } = await import("@/lib/warung-rebahan/forward-sender");
  if (!isForwardEmailConfigured()) throw new Error("forward_email_not_configured");
  const { buildOrderReadyTemplate } = await import("@/lib/warung-rebahan/email-forward");
  const { SITE } = await import("@/lib/site");
  const label = orderLineLabel(order.items, Number(order.item_index ?? 0));
  const template = buildOrderReadyTemplate({
    axvaraOrderCode: orderCode,
    buyerName: String(order.customer_name ?? ""),
    invoiceUrl: `${siteUrl(SITE.webUrl)}/pesanan/${encodeURIComponent(orderCode)}`,
    supportWa: SITE.adminWaLocal,
    items: [{ label, details: plaintext }],
    receipt: {
      total: Number(order.payable_amount ?? order.subtotal ?? 0),
      method: paymentMethodLabel(order.payment_method),
      lines: orderLines(order.items).map((_, index) => orderLineLabel(order.items, index)),
    },
  });
  const sent = await sendForwardEmail({
    to, subject: template.subject, html: template.html, text: template.text, timeoutMs: DELIVERY_EMAIL_TIMEOUT_MS,
  }).catch((error: unknown) => ({ ok: false as const, providerId: undefined, error: error instanceof Error ? error.message : "resend_failed" }));
  await database.execRun(
    `INSERT INTO buyer_notice_log (idempotency_key, order_code, channel, status, provider_id, error)
     VALUES (?, ?, 'email', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET status=excluded.status, provider_id=excluded.provider_id,
       error=excluded.error, updated_at=datetime('now')`,
    key, orderCode, sent.ok ? "sent" : "failed", sent.providerId ?? null,
    sent.ok ? null : String(sent.error || "send_failed").slice(0, 300),
  ).catch(() => undefined);
  if (!sent.ok) throw new Error(`delivery_email_failed:${String(sent.error || "send_failed").slice(0, 200)}`);
}

export type DeliveredSnapshot = { itemIndex: number; label: string; details: string; completed_at: string | null; manual: boolean };

/**
 * Isi terkirim yang tersimpan terenkripsi per item (migrasi 0043). HANYA
 * untuk pemanggil yang sudah memverifikasi pembeli (WA/token) atau admin.
 */
export async function readDeliveredSnapshots(
  orderCode: string,
  database: DatabaseAccess,
  options: { manualOnly?: boolean } = {},
): Promise<DeliveredSnapshot[]> {
  const order = await database.queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode).catch(() => null);
  const rows = await database.queryAll(
    `SELECT item_index, delivered_ciphertext, delivered_iv, delivered_message_id, updated_at
     FROM fulfillment_items
     WHERE order_code=? AND status='delivered' AND delivered_ciphertext IS NOT NULL AND delivered_iv IS NOT NULL
       ${options.manualOnly ? "AND delivered_message_id='manual'" : ""}
     ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);
  const out: DeliveredSnapshot[] = [];
  for (const row of rows) {
    try {
      const details = await decryptSecret(String(row.delivered_ciphertext), String(row.delivered_iv));
      out.push({
        itemIndex: Number(row.item_index),
        label: orderLineLabel(order?.items, Number(row.item_index)),
        details,
        completed_at: row.updated_at ? String(row.updated_at) : null,
        manual: String(row.delivered_message_id ?? "") === "manual",
      });
    } catch { /* kunci rotasi / data korup: lewati, jangan bocorkan */ }
  }
  return out;
}

/**
 * true bila SEMUA baris pesanan sudah terkirim otomatis (email "Pesanan
 * Siap" yang memuat tanda terima). Dipakai untuk menahan email tanda terima
 * terpisah; serah terima admin (`delivered_message_id='manual'`) tidak
 * dihitung karena emailnya tidak memuat tanda terima.
 */
export async function webOrderAutoDelivered(orderCode: string, database: DatabaseAccess): Promise<boolean> {
  const row = await database.queryFirst(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='delivered' AND delivered_message_id LIKE 'item:%' THEN 1 ELSE 0 END) AS auto
     FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => null);
  const total = Number(row?.total ?? 0);
  return total > 0 && Number(row?.auto ?? 0) === total;
}
