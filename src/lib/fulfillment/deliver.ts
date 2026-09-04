// src/lib/fulfillment/deliver.ts — Outbox delivery: claim job, send via Telegram, retry
// Decrypts secrets in memory only. Never logs plaintext.

import { queryFirst, queryAll, execRun, isD1Mode } from "@/lib/db";
import { decryptSecret } from "./crypto";
import { findReservedForOrder, markDelivered } from "./inventory";
import { sendMessage } from "@/lib/telegram/api";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { isEnabled } from "@/lib/feature-flags";
import {
  deliveryMessage,
  manualFulfillmentBuyerMessage,
  adminOrderNotification,
  adminDeliveryFailedNotification,
  orderPaidMessage,
} from "@/lib/telegram/messages";
import { orderPaidKeyboard } from "@/lib/telegram/keyboards";

type Row = Record<string, unknown>;

// In-memory fallback for dev
function getJobsMem(): Row[] {
  const g = process as unknown as { __AXVARA_FULFILLMENT_JOBS?: Row[] };
  if (!g.__AXVARA_FULFILLMENT_JOBS) g.__AXVARA_FULFILLMENT_JOBS = [];
  return g.__AXVARA_FULFILLMENT_JOBS;
}

// Retry schedule in minutes
const RETRY_DELAYS = [1, 5, 15, 60];
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/**
 * Create a fulfillment job for an order. Idempotent (UNIQUE on order_code).
 */
export async function createFulfillmentJob(
  orderCode: string,
  inventoryId: number | null,
  fulfillmentMode: string,
): Promise<number | null> {
  const status = fulfillmentMode === "manual" ? "manual_required" : "queued";

  try {
    if (isD1Mode()) {
      const result = await execRun(
        `INSERT INTO fulfillment_jobs (order_code, inventory_id, status, attempt_count, next_attempt_at)
         VALUES (?, ?, ?, 0, datetime('now'))`,
        orderCode, inventoryId, status,
      );
      return result.lastInsertRowid ?? null;
    }

    const mem = getJobsMem();
    if (mem.some((r) => r.order_code === orderCode)) return null; // already exists
    const id = Math.max(0, ...mem.map((r) => Number(r.id) || 0)) + 1;
    mem.push({
      id, order_code: orderCode, inventory_id: inventoryId, status,
      attempt_count: 0, next_attempt_at: new Date().toISOString(),
      locked_until: null, telegram_message_id: null, last_error: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return id;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("UNIQUE")) return null; // duplicate
    throw error;
  }
}

/**
 * Claim a queued/retry job for processing. Returns the job or null.
 * Uses locked_until to prevent concurrent processing.
 */
export async function claimJob(jobId: number): Promise<Row | null> {
  const lockUntil = new Date(Date.now() + 60_000).toISOString();

  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_jobs SET status='sending', locked_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
       WHERE id=? AND status IN ('queued','retry') AND (locked_until IS NULL OR locked_until < datetime('now'))`,
      lockUntil, jobId,
    );
    if (!result.changes) return null;
    return (await queryFirst(`SELECT * FROM fulfillment_jobs WHERE id=?`, jobId)) ?? null;
  }

  const job = getJobsMem().find(
    (r) => Number(r.id) === jobId && (r.status === "queued" || r.status === "retry"),
  );
  if (!job) return null;
  job.status = "sending";
  job.locked_until = lockUntil;
  job.attempt_count = (Number(job.attempt_count) || 0) + 1;
  job.updated_at = new Date().toISOString();
  return { ...job };
}

/**
 * Mark a job as delivered.
 */
export async function markJobDelivered(jobId: number, telegramMessageId?: string): Promise<void> {
  if (isD1Mode()) {
    await execRun(
      `UPDATE fulfillment_jobs SET status='delivered', telegram_message_id=?, locked_until=NULL, updated_at=datetime('now')
       WHERE id=?`,
      telegramMessageId ?? null, jobId,
    );
    return;
  }

  const job = getJobsMem().find((r) => Number(r.id) === jobId);
  if (job) {
    job.status = "delivered";
    job.telegram_message_id = telegramMessageId ?? null;
    job.locked_until = null;
    job.updated_at = new Date().toISOString();
  }
}

/**
 * Schedule a job for retry or mark as failed if max attempts reached.
 */
export async function scheduleRetry(jobId: number, error: string): Promise<void> {
  const sanitizedError = error.slice(0, 500); // cap error length

  if (isD1Mode()) {
    const job = await queryFirst(`SELECT attempt_count FROM fulfillment_jobs WHERE id=?`, jobId);
    const attempts = Number(job?.attempt_count ?? 0);

    if (attempts >= MAX_ATTEMPTS) {
      await execRun(
        `UPDATE fulfillment_jobs SET status='failed', last_error=?, locked_until=NULL, updated_at=datetime('now')
         WHERE id=?`,
        sanitizedError, jobId,
      );
      return;
    }

    const delayMinutes = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
    await execRun(
      `UPDATE fulfillment_jobs SET status='retry', last_error=?, locked_until=NULL,
       next_attempt_at=datetime('now', '+${delayMinutes} minutes'), updated_at=datetime('now')
       WHERE id=?`,
      sanitizedError, jobId,
    );
    return;
  }

  const job = getJobsMem().find((r) => Number(r.id) === jobId);
  if (!job) return;
  const attempts = Number(job.attempt_count ?? 0);
  if (attempts >= MAX_ATTEMPTS) {
    job.status = "failed";
    job.last_error = sanitizedError;
    job.locked_until = null;
  } else {
    const delayMinutes = RETRY_DELAYS[Math.min(attempts - 1, RETRY_DELAYS.length - 1)];
    job.status = "retry";
    job.last_error = sanitizedError;
    job.locked_until = null;
    job.next_attempt_at = new Date(Date.now() + delayMinutes * 60_000).toISOString();
  }
  job.updated_at = new Date().toISOString();
}

/**
 * Process a single fulfillment job end-to-end.
 * Returns true if delivery succeeded, false otherwise.
 */
export async function processJob(
  jobId: number,
  order: Row,
  product: Row,
): Promise<boolean> {
  const claimed = await claimJob(jobId);
  if (!claimed) return false;

  const salesChannel = String(order.sales_channel || "telegram");
  const chatId = String(order.telegram_chat_id || "");
  const waRecipient = String(order.channel_member_id || order.customer_wa || "");
  const orderCode = String(order.code);
  const fulfillmentMode = String(product.fulfillment_mode || "manual");
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  // Gate 1: WhatsApp proof requirement before fulfillment
  if (salesChannel === "whatsapp" && isEnabled("WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT")) {
    const proof = isD1Mode()
      ? await queryFirst(
          `SELECT id, status FROM payment_proofs WHERE order_code=? AND status IN ('submitted','approved')`,
          orderCode,
        )
      : true;
    if (!proof) {
      await execRun(
        `UPDATE fulfillment_jobs SET status='queued', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        jobId,
      );
      return false; // Hold until proof is submitted/approved
    }
  }

  // Gate 2: WhatsApp fulfillment feature flag (if disabled, route to manual)
  if (salesChannel === "whatsapp" && !isEnabled("WHATSAPP_FULFILLMENT")) {
    await execRun(
      `UPDATE fulfillment_jobs SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      jobId,
    );
    await execRun(
      `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
      orderCode,
    );
    return true;
  }

  try {
    // Notify buyer: payment received
    if (salesChannel === "telegram" && chatId) {
      await sendMessage({
        chat_id: chatId,
        text: orderPaidMessage(orderCode, String(product.name)),
        parse_mode: "HTML",
        reply_markup: orderPaidKeyboard(orderCode),
      });
    }

    // Manual: stop here, notify admin
    if (fulfillmentMode === "manual") {
      await execRun(
        `UPDATE fulfillment_jobs SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        jobId,
      );
      if (salesChannel === "telegram" && chatId) {
        await sendMessage({
          chat_id: chatId,
          text: manualFulfillmentBuyerMessage(orderCode),
          parse_mode: "HTML",
          reply_markup: orderPaidKeyboard(orderCode),
        });
      }
      if (adminChatId) {
        await sendMessage({
          chat_id: adminChatId,
          text: adminOrderNotification({
            orderCode,
            productName: String(product.name),
            amount: Number(order.subtotal),
            telegramUser: String(order.telegram_user_id || order.customer_wa || ""),
            fulfillmentMode,
          }),
          parse_mode: "HTML",
        });
      }
      await execRun(
        `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
      return true;
    }

    // Shared: decrypt product shared secret
    if (fulfillmentMode === "shared") {
      const ct = String(product.shared_secret_ciphertext || "");
      const iv = String(product.shared_secret_iv || "");
      if (!ct || !iv) throw new Error("Shared secret not configured for product");
      const plaintext = await decryptSecret(ct, iv);

      if (salesChannel === "whatsapp") {
        if (!waRecipient) throw new Error("No WhatsApp recipient phone number");
        const sendResult = await sendTextMessage({
          target: waRecipient,
          message: `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}\n\nDetail akses/lisensi Anda:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
        });
        if (!sendResult.ok) throw new Error(sendResult.error || "WhatsApp direct delivery failed");
        await markJobDelivered(jobId, sendResult.messageId || "");
      } else {
        const sendResult = await sendMessage({
          chat_id: chatId,
          text: deliveryMessage(plaintext),
          parse_mode: "HTML",
        });
        if (!sendResult.ok) throw new Error(sendResult.description || "Telegram send failed");
        await markJobDelivered(jobId, String((sendResult.result as Record<string, unknown>)?.message_id ?? ""));
      }

      await execRun(
        `UPDATE orders SET fulfillment_status='delivered', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
      return true;
    }

    // Unique: decrypt reserved inventory
    if (fulfillmentMode === "unique") {
      const inventoryItem = await findReservedForOrder(orderCode);
      if (!inventoryItem) throw new Error("No reserved inventory found");
      const plaintext = await decryptSecret(
        String(inventoryItem.secret_ciphertext),
        String(inventoryItem.secret_iv),
      );

      if (salesChannel === "whatsapp") {
        if (!waRecipient) throw new Error("No WhatsApp recipient phone number");
        const sendResult = await sendTextMessage({
          target: waRecipient,
          message: `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}\n\nDetail akses/lisensi Anda:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
        });
        if (!sendResult.ok) throw new Error(sendResult.error || "WhatsApp direct delivery failed");
        await markDelivered(Number(inventoryItem.id));
        await markJobDelivered(jobId, sendResult.messageId || "");
      } else {
        const sendResult = await sendMessage({
          chat_id: chatId,
          text: deliveryMessage(plaintext),
          parse_mode: "HTML",
        });
        if (!sendResult.ok) throw new Error(sendResult.description || "Telegram send failed");
        await markDelivered(Number(inventoryItem.id));
        await markJobDelivered(jobId, String((sendResult.result as Record<string, unknown>)?.message_id ?? ""));
      }

      await execRun(
        `UPDATE orders SET fulfillment_status='delivered', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
      return true;
    }

    throw new Error(`Unknown fulfillment mode: ${fulfillmentMode}`);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown delivery error";
    await scheduleRetry(jobId, errMsg);

    // Notify admin on failure
    if (adminChatId) {
      try {
        await sendMessage({
          chat_id: adminChatId,
          text: adminDeliveryFailedNotification(orderCode, errMsg),
          parse_mode: "HTML",
        });
      } catch { /* admin notification is best-effort */ }
    }

    // Update order fulfillment status
    const job = isD1Mode()
      ? await queryFirst(`SELECT status FROM fulfillment_jobs WHERE id=?`, jobId)
      : getJobsMem().find((r) => Number(r.id) === jobId);
    const newStatus = String(job?.status ?? "retry");
    await execRun(
      `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`,
      newStatus, orderCode,
    );

    return false;
  }
}

/**
 * Get due jobs for cron processing.
 */
export async function getDueJobs(limit = 25): Promise<Row[]> {
  if (isD1Mode()) {
    return queryAll(
      `SELECT fj.*, o.telegram_chat_id, o.telegram_user_id, o.subtotal, o.code as order_code_ref
       FROM fulfillment_jobs fj
       JOIN orders o ON o.code = fj.order_code
       WHERE fj.status IN ('queued','retry')
       AND (fj.locked_until IS NULL OR fj.locked_until < datetime('now'))
       AND fj.next_attempt_at <= datetime('now')
       ORDER BY fj.next_attempt_at ASC
       LIMIT ?`,
      limit,
    );
  }

  return getJobsMem()
    .filter((r) => (r.status === "queued" || r.status === "retry"))
    .slice(0, limit);
}

/**
 * Release stale locks (jobs stuck in 'sending' past their lock).
 */
export async function releaseStaleJobs(): Promise<number> {
  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_jobs SET status='retry', locked_until=NULL, updated_at=datetime('now')
       WHERE status='sending' AND locked_until < datetime('now')`,
    );
    return result.changes ?? 0;
  }

  let count = 0;
  for (const job of getJobsMem()) {
    if (job.status === "sending" && job.locked_until && new Date(String(job.locked_until)) < new Date()) {
      job.status = "retry";
      job.locked_until = null;
      count++;
    }
  }
  return count;
}
