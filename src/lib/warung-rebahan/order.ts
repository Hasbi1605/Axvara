// src/lib/warung-rebahan/order.ts — Auto-order H2H: Axvara lunas → order ke WR.
// Idempoten: link dibuat sekali per (order_code, wr_variant_id); retry dengan
// exponential backoff 1/5/15 menit; saldo habis menunda 1 jam (bukan retry cepat).

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import {
  createOrder,
  fetchTransactions,
  isWrAutoOrderEnabled,
  isWrEnabled,
  WrInsufficientBalanceError,
  WrOutOfStockError,
  type WrTransaction,
} from "./client";

export type OrderItemLike = {
  product_id?: number;
  variant_id?: number | null;
  qty?: number;
  price?: number;
  name?: string;
  [key: string]: unknown;
};

export type ProcessResult = {
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
};

export const WR_RETRY_DELAYS_MINUTES = [1, 5, 15];
export const WR_MAX_ATTEMPTS = 3;

type Row = Record<string, unknown>;

function nextAttemptIso(attempt: number): string {
  const minutes =
    WR_RETRY_DELAYS_MINUTES[Math.min(Math.max(attempt - 1, 0), WR_RETRY_DELAYS_MINUTES.length - 1)];
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Ambil wr_variant_id untuk varian Axvara (null bila bukan produk WR). */
export async function resolveWrVariantId(
  axvaraVariantId: number,
  db: DatabaseAccess,
): Promise<{ wrVariantId: string; wrCost: number } | null> {
  const row = await db
    .queryFirst(
      `SELECT pv.wr_variant_id, wv.wr_price
       FROM product_variants pv
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
       WHERE pv.id=? AND pv.wr_variant_id IS NOT NULL`,
      axvaraVariantId,
    )
    .catch(() => null);
  if (!row || !row.wr_variant_id) return null;
  return { wrVariantId: String(row.wr_variant_id), wrCost: Number(row.wr_price || 0) };
}

/**
 * Dipanggil setelah payment confirmed (QRIS hook / retry admin / approve bukti /
 * konfirmasi admin). Membuat link pending untuk tiap item WR — idempoten via
 * UNIQUE(order_code, wr_variant_id) implisit (cek eksistensi dulu).
 */
export async function createWrOrderLink(
  orderCode: string,
  items: OrderItemLike[],
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  let created = 0;
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveWrVariantId(variantId, db);
    if (!resolved) continue;
    const qty = Math.max(1, Number(item.qty || 1));
    const existing = await db
      .queryFirst(
        `SELECT id FROM wr_order_links WHERE order_code=? AND wr_variant_id=?`,
        orderCode,
        resolved.wrVariantId,
      )
      .catch(() => null);
    if (existing) continue;
    await db.execRun(
      `INSERT INTO wr_order_links
        (order_code, wr_variant_id, quantity, wr_cost, status, attempt_count,
         max_attempts, next_attempt_at)
       VALUES (?,?,?,?, 'pending', 0, ?, datetime('now'))`,
      orderCode,
      resolved.wrVariantId,
      qty,
      resolved.wrCost * qty,
      WR_MAX_ATTEMPTS,
    );
    created++;
  }
  return created;
}

/** Cek cepat apakah order mengandung item WR (untuk hook payment). */
export function hasWrItems(items: OrderItemLike[]): boolean {
  return items.some((item) => Number(item.variant_id || 0) > 0 && (item as { source?: string }).source === "warung_rebahan");
}

/**
 * Deteksi item WR dari DB (lebih akurat dari snapshot: cek wr_variant_id).
 * Dipakai hook payment yang hanya punya orderCode.
 */
export async function createWrOrderLinksForOrder(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const order = await db
    .queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order) return 0;
  let items: OrderItemLike[] = [];
  try {
    const parsed = JSON.parse(String(order.items || "[]"));
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return 0;
  }
  // Perkaya: tandai item yang variannya punya wr_variant_id.
  const enriched: OrderItemLike[] = [];
  for (const item of items) {
    const variantId = Number(item.variant_id || 0);
    if (!variantId) continue;
    const resolved = await resolveWrVariantId(variantId, db);
    if (resolved) enriched.push(item);
  }
  return createWrOrderLink(orderCode, enriched, db);
}

export async function processWrPendingOrders(
  database?: DatabaseAccess,
): Promise<ProcessResult> {
  const db = database ?? createDatabaseAccess();
  const result: ProcessResult = { processed: 0, succeeded: 0, retried: 0, failed: 0 };
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return result;
  const due = await db
    .queryAll(
      `SELECT * FROM wr_order_links
       WHERE status IN ('pending','retry')
         AND attempt_count < max_attempts
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
       ORDER BY next_attempt_at ASC, id ASC LIMIT 4`,
    )
    .catch(() => [] as Row[]);
  for (const link of due) {
    if (!db.canSpend(6)) break;
    result.processed++;
    const outcome = await processOneLink(link, db);
    if (outcome === "succeeded") result.succeeded++;
    else if (outcome === "retried") result.retried++;
    else result.failed++;
  }
  return result;
}

async function processOneLink(link: Row, db: DatabaseAccess): Promise<"succeeded" | "retried" | "failed"> {
  const { execRun } = db;
  const id = Number(link.id);
  const attempt = Number(link.attempt_count || 0) + 1;
  // Klaim CAS: hanya pending/retry yang belum diklaim worker lain.
  const claimed = await execRun(
    `UPDATE wr_order_links SET status='ordering', attempt_count=?,
      updated_at=datetime('now')
     WHERE id=? AND status IN ('pending','retry')`,
    attempt,
    id,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!claimed.changes) return "retried";
  try {
    const order = await createOrder({
      variant_id: String(link.wr_variant_id),
      quantity: Math.max(1, Number(link.quantity || 1)),
    });
    await execRun(
      `UPDATE wr_order_links SET status='processing', wr_order_id=?,
        last_error=NULL, updated_at=datetime('now') WHERE id=?`,
      String(order.order_id),
      id,
    );
    await db
      .execRun(
        `INSERT INTO wr_saldo_log (balance, source, note) VALUES (?,'order_deduct',?)`,
        Math.floor(Number(order.current_balance ?? 0)),
        `order ${String(link.order_code)} → ${String(order.order_id)}`,
      )
      .catch(() => undefined);
    return "succeeded";
  } catch (error) {
    return handleOrderError(id, link, error, attempt, db);
  }
}

async function handleOrderError(
  id: number,
  link: Row,
  error: unknown,
  attempt: number,
  db: DatabaseAccess,
): Promise<"retried" | "failed"> {
  const { execRun } = db;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  if (error instanceof WrInsufficientBalanceError) {
    // JANGAN retry cepat — beri waktu admin top up 1 jam.
    await execRun(
      `UPDATE wr_order_links SET status='retry', last_error=?,
        next_attempt_at=datetime('now','+60 minutes'), updated_at=datetime('now')
       WHERE id=?`,
      `saldo_wr_habis: ${message}`,
      id,
    );
    await notifyAdmin(
      `💰 <b>Saldo Warung Rebahan habis</b>\nOrder <code>${String(link.order_code)}</code> tertunda 1 jam. Segera top up.`,
    );
    return "retried";
  }
  if (error instanceof WrOutOfStockError) {
    // Nol-kan stok varian agar storefront jujur; retry ikut jadwal normal.
    await execRun(
      `UPDATE product_variants SET stock=0, updated_at=datetime('now')
       WHERE wr_variant_id=?`,
      String(link.wr_variant_id),
    ).catch(() => undefined);
    await execRun(
      `UPDATE wr_variants SET wr_stock=0, updated_at=? WHERE wr_variant_id=?`,
      new Date().toISOString(),
      String(link.wr_variant_id),
    ).catch(() => undefined);
  }
  if (attempt >= Number(link.max_attempts || WR_MAX_ATTEMPTS)) {
    await execRun(
      `UPDATE wr_order_links SET status='failed', last_error=?, updated_at=datetime('now') WHERE id=?`,
      message,
      id,
    );
    await notifyAdmin(
      `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n${escapeHtml(message)}`,
    );
    // Tandai order Axvara agar admin tahu perlu penanganan manual.
    await execRun(
      `UPDATE orders SET fulfillment_status='failed', updated_at=datetime('now')
       WHERE code=? AND status='lunas'`,
      String(link.order_code),
    ).catch(() => undefined);
    return "failed";
  }
  await execRun(
    `UPDATE wr_order_links SET status='retry', last_error=?,
      next_attempt_at=?, updated_at=datetime('now') WHERE id=?`,
    message,
    nextAttemptIso(attempt),
    id,
  );
  return "retried";
}

export async function retryFailedWrOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled() || !isWrAutoOrderEnabled()) return 0;
  // Samakan yang jatuh tempo agar ikut diproses di run berikutnya.
  const res = await db
    .execRun(
      `UPDATE wr_order_links SET next_attempt_at=datetime('now'), updated_at=datetime('now')
       WHERE status='retry' AND attempt_count < max_attempts
         AND datetime(next_attempt_at) <= datetime('now')`,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 300);
}

async function notifyAdmin(html: string): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true") return;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    await sendMessage({ chat_id: adminChatId, text: html, parse_mode: "HTML" });
  } catch {
    /* best-effort */
  }
}

/** Webhook order.processing: tandai link processing. */
export async function handleWrOrderProcessing(
  wrOrderId: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const res = await db
    .execRun(
      `UPDATE wr_order_links SET status='processing', updated_at=datetime('now')
       WHERE wr_order_id=? AND status IN ('ordering','pending','retry')`,
      wrOrderId,
    )
    .catch(() => ({ changes: 0 as number | undefined }));
  return Number(res.changes ?? 0) > 0;
}

/** Sinkronisasi status order processing yang menggantung >1 jam via /transactions. */
export async function reconcileStuckWrOrders(database?: DatabaseAccess): Promise<number> {
  const db = database ?? createDatabaseAccess();
  if (!isWrEnabled()) return 0;
  const stuck = await db
    .queryAll(
      `SELECT wr_order_id, order_code FROM wr_order_links
       WHERE status='processing'
         AND datetime(updated_at) <= datetime('now','-1 hour')
       LIMIT 8`,
    )
    .catch(() => [] as Row[]);
  if (!stuck.length) return 0;
  let transactions: WrTransaction[];
  try {
    transactions = await fetchTransactions();
  } catch {
    return 0;
  }
  const byId = new Map(transactions.map((t) => [String(t.order_id), t]));
  let reconciled = 0;
  // Diimpor lazy dari deliver.ts (hindari siklus: deliver tidak impor order).
  const { handleWrOrderCompleted, handleWrOrderFailed } = await import("./deliver");
  for (const row of stuck) {
    const tx = byId.get(String(row.wr_order_id || ""));
    if (!tx) continue;
    const status = String(tx.status || "").toLowerCase();
    if (status.includes("complet") || status.includes("success") || status.includes("done")) {
      await handleWrOrderCompleted(String(row.wr_order_id), tx.account_details ?? tx, db);
      reconciled++;
    } else if (status.includes("fail") || status.includes("cancel") || status.includes("refund")) {
      await handleWrOrderFailed(String(row.wr_order_id), status, db);
      reconciled++;
    }
  }
  return reconciled;
}

// handleWrOrderCompleted / handleWrOrderFailed ada di deliver.ts (butuh crypto +
// channel delivery). Re-export di sini agar cron/webhook cukup impor satu modul
// order; implementasi diimpor lazy untuk hindari siklus.
export type { WrOrderLinkRow } from "./deliver";
export {
  handleWrOrderCompleted,
  handleWrOrderFailed,
} from "./deliver";
