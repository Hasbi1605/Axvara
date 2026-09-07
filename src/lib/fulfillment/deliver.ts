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
  adminDeliveryFailedNotification,
} from "@/lib/telegram/messages";
import { notifyTelegramBuyerPaid } from "@/lib/telegram/order-notifications";

type Row = Record<string, unknown>;

export type FulfillmentOrderItem = {
  product_id: number;
  variant_id?: number | null;
  qty?: number | null;
  fulfillment_mode?: unknown;
};

export type FulfillmentRecipient = {
  channel: "web" | "telegram" | "whatsapp";
  target: string;
};

/**
 * Resolve the delivery recipient for one order (issue #4).
 *
 * - telegram → Telegram chat id pembeli (bukan grup admin).
 * - whatsapp → nomor anggota grup (channel_member_id) atau customer_wa.
 * - web → nomor WA pembeli (jalur manual/admin; tidak ada push otomatis).
 * Target kosong berarti item tidak dapat dikirim otomatis dan diarahkan ke
 * `manual_required` — bukan dikirim ke penerima kosong.
 */
export function resolveRecipient(order: Row): FulfillmentRecipient {
  const channel = String(order.sales_channel || "telegram");
  if (channel === "whatsapp") {
    return {
      channel: "whatsapp",
      target: String(order.channel_member_id || order.customer_wa || ""),
    };
  }
  if (channel === "web") {
    return { channel: "web", target: String(order.customer_wa || "") };
  }
  return { channel: "telegram", target: String(order.telegram_chat_id || "") };
}

/** Parse order.items into a normalized per-item list. */
export function parseOrderItems(raw: unknown): FulfillmentOrderItem[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const productId = Number(row.product_id || 0);
        if (!productId) return null;
        return {
          product_id: productId,
          variant_id: row.variant_id != null ? Number(row.variant_id) : null,
          qty: Math.max(1, Number(row.qty || 1)),
          fulfillment_mode: row.fulfillment_mode,
        } as FulfillmentOrderItem;
      })
      .filter((entry): entry is FulfillmentOrderItem => entry !== null);
  } catch {
    return [];
  }
}

/** Resolve one item's mode: snapshot → variant row → product fallback. */
export async function resolveItemMode(
  item: FulfillmentOrderItem,
  order: Row,
  productsById: Map<number, Row>,
): Promise<"manual" | "shared" | "unique"> {
  const snapshotModes = fulfillmentModesFromOrderSnapshot(order);
  const snapshot = item.variant_id != null ? snapshotModes.get(item.variant_id) : undefined;
  if (snapshot) return snapshot;
  if (typeof item.fulfillment_mode === "string" && ["manual", "shared", "unique"].includes(item.fulfillment_mode)) {
    return item.fulfillment_mode as "manual" | "shared" | "unique";
  }
  if (item.variant_id != null && isD1Mode()) {
    const variant = await queryFirst(
      `SELECT fulfillment_mode FROM product_variants WHERE id=? AND product_id=?`,
      item.variant_id,
      item.product_id,
    );
    const mode = String(variant?.fulfillment_mode || "");
    if (["manual", "shared", "unique"].includes(mode)) return mode as "manual" | "shared" | "unique";
  }
  const product = productsById.get(item.product_id);
  const fallback = String(product?.fulfillment_mode || "manual");
  return (["manual", "shared", "unique"].includes(fallback) ? fallback : "manual") as "manual" | "shared" | "unique";
}

/**
 * Ensure one fulfillment_items row per order item (issue #4).
 * Idempotent via UNIQUE(order_code, item_index); existing rows are kept so
 * retry/progress is never reset. Returns the rows in item order.
 */
export async function ensureFulfillmentItems(order: Row): Promise<Row[]> {
  const orderCode = String(order.code);
  const items = parseOrderItems(order.items);
  const recipient = resolveRecipient(order);
  const existing = await queryAll(
    `SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);
  if (existing.length > 0 && existing.length === items.length) return existing;
  const have = new Set(existing.map((row) => Number(row.item_index)));
  const productsById = new Map<number, Row>();
  for (const item of items) {
    if (!productsById.has(item.product_id)) {
      const product = await queryFirst(`SELECT * FROM products WHERE id=?`, item.product_id);
      if (product) productsById.set(item.product_id, product);
    }
  }
  for (let index = 0; index < items.length; index++) {
    if (have.has(index)) continue;
    const item = items[index];
    const mode = await resolveItemMode(item, order, productsById);
    const inventory = mode === "unique"
      ? await queryFirst(
          `SELECT id FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`,
          orderCode,
        ).catch(() => null)
      : null;
    await execRun(
      `INSERT OR IGNORE INTO fulfillment_items
        (order_code, item_index, product_id, variant_id, qty, fulfillment_mode,
         inventory_id, recipient_channel, recipient_target, status, attempt_count, next_attempt_at)
       VALUES (?,?,?,?,?,?,?,?,?,'queued',0,datetime('now'))`,
      orderCode, index, item.product_id, item.variant_id ?? null, item.qty ?? 1, mode,
      inventory ? Number(inventory.id) : null,
      recipient.channel, recipient.target || null,
    ).catch(() => {});
  }
  return queryAll(
    `SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => existing);
}

/** True when every item row reached a successful terminal state. */
export function allItemsSettled(rows: Row[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => ["delivered", "manual_required"].includes(String(row.status)));
}

// In-memory fallback for dev
function getJobsMem(): Row[] {
  const g = process as unknown as { __AXVARA_FULFILLMENT_JOBS?: Row[] };
  if (!g.__AXVARA_FULFILLMENT_JOBS) g.__AXVARA_FULFILLMENT_JOBS = [];
  return g.__AXVARA_FULFILLMENT_JOBS;
}

// Retry schedule in minutes
const RETRY_DELAYS = [1, 5, 15, 60];
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

function fulfillmentModeFromOrderSnapshot(order: Row): string | null {
  return fulfillmentModesFromOrderSnapshot(order).get(-1)
    ?? fulfillmentModesFromOrderSnapshot(order).get(
      Number(order.variant_id || 0) || -1,
    )
    ?? null;
}

/**
 * Read per-item modes from the order snapshot. Supports the legacy
 * single-item shape (`{fulfillment_mode}`), the Telegram cart shape
 * (`{lines:[{variant_id, fulfillment_mode}]}`), and per-item entries
 * embedded in items[] itself (resolved separately).
 */
function fulfillmentModesFromOrderSnapshot(order: Row): Map<number, "manual" | "shared" | "unique"> {
  const modes = new Map<number, "manual" | "shared" | "unique">();
  if (!order.variant_snapshot) return modes;
  try {
    const snapshot = JSON.parse(String(order.variant_snapshot)) as {
      fulfillment_mode?: unknown;
      variant_id?: unknown;
      lines?: { variant_id?: unknown; fulfillment_mode?: unknown }[];
    };
    const single = String(snapshot.fulfillment_mode || "");
    if (["manual", "shared", "unique"].includes(single)) {
      const key = Number(snapshot.variant_id ?? order.variant_id ?? -1);
      modes.set(Number.isFinite(key) ? key : -1, single as "manual" | "shared" | "unique");
    }
    for (const line of snapshot.lines ?? []) {
      const mode = String(line.fulfillment_mode || "");
      if (!["manual", "shared", "unique"].includes(mode)) continue;
      modes.set(Number(line.variant_id), mode as "manual" | "shared" | "unique");
    }
  } catch {
    /* snapshot rusak → fallback ke variant/product */
  }
  return modes;
}

/**
 * Create a fulfillment job for an order. Idempotent (UNIQUE on order_code).
 */
export async function createFulfillmentJob(
  orderCode: string,
  inventoryId: number | null,
  fulfillmentMode: string,
  variantId: number | null = null,
  salesChannel = "telegram",
): Promise<number | null> {
  // Jobs may be created before payment. They remain queued and are claimed
  // only after the linked order is authoritatively paid.
  const status = "queued";

  try {
    if (isD1Mode()) {
      const result = await execRun(
        `INSERT INTO fulfillment_jobs (
           order_code, variant_id, inventory_id, sales_channel,
           status, attempt_count, next_attempt_at
         ) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
        orderCode, variantId, inventoryId, salesChannel, status,
      );
      return result.lastInsertRowid ?? null;
    }

    const mem = getJobsMem();
    if (mem.some((r) => r.order_code === orderCode)) return null; // already exists
    const id = Math.max(0, ...mem.map((r) => Number(r.id) || 0)) + 1;
    mem.push({
      id, order_code: orderCode, variant_id: variantId, inventory_id: inventoryId,
      sales_channel: salesChannel, fulfillment_mode: fulfillmentMode, status,
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
 * Process a single fulfillment job end-to-end, item by item (issue #4).
 * Returns true only when EVERY item reached a successful terminal state
 * (delivered/manual_required). A failure on one item retries that item
 * alone; already-delivered items are never resent. The legacy single-item
 * path (no fulfillment_items rows, e.g. pre-migration jobs) keeps the
 * previous behavior via processLegacyJob below.
 */
export async function processJob(
  jobId: number,
  order: Row,
  product: Row,
): Promise<boolean> {
  // Never deliver credentials for an unpaid order, even if a job was queued
  // at invoice creation time.
  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    return false;
  }

  const salesChannel = String(order.sales_channel || "telegram");
  const orderCode = String(order.code);

  // A proof hold is not a delivery attempt. Check it before claiming so a
  // buyer waiting for review cannot exhaust the retry budget.
  if (
    salesChannel === "whatsapp"
    && String(order.payment_method) !== "qris"
    && isEnabled("WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT")
  ) {
    const proof = isD1Mode()
      ? await queryFirst(
          `SELECT id FROM payment_proofs WHERE order_code=? AND status IN ('submitted','approved')`,
          orderCode,
        )
      : true;
    if (!proof) return false;
  }

  // WhatsApp fulfillment feature flag (if disabled, route to manual)
  if (salesChannel === "whatsapp" && !isEnabled("WHATSAPP_FULFILLMENT")) {
    await execRun(
      `UPDATE fulfillment_jobs SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      jobId,
    );
    await execRun(
      `UPDATE fulfillment_items SET status='manual_required', locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND status IN ('queued','retry')`,
      orderCode,
    ).catch(() => {});
    await execRun(
      `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
      orderCode,
    );
    return true;
  }

  const itemRows = await queryAll(
    `SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);

  // Legacy job without per-item rows (pre-migration or single-item flows
  // that have not backfilled yet): keep previous single-item behavior, but
  // first materialize the per-item rows so the next run converges.
  if (!itemRows.length) {
    await ensureFulfillmentItems(order).catch(() => {});
    const fresh = await queryAll(
      `SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
      orderCode,
    ).catch(() => [] as Row[]);
    if (!fresh.length) {
      const claimedLegacy = await claimJob(jobId);
      if (!claimedLegacy) return false;
      return processLegacyJob(jobId, order, product, claimedLegacy);
    }
  }

  const claimed = await claimJob(jobId);
  if (!claimed) return false;

  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  let allOk = true;
  let firstError: string | null = null;

  const rows = await queryAll(
    `SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);
  for (const itemRow of rows) {
    const status = String(itemRow.status);
    if (status === "delivered" || status === "manual_required") continue;
    if (status === "failed") { allOk = false; firstError ??= String(itemRow.last_error || "item failed"); continue; }
    const ok = await processItem(order, itemRow, adminChatId);
    if (!ok) {
      allOk = false;
      const fresh = await queryFirst(`SELECT last_error FROM fulfillment_items WHERE id=?`, Number(itemRow.id));
      firstError ??= String(fresh?.last_error || itemRow.last_error || "item delivery failed");
    }
  }

  const settled = await queryAll(
    `SELECT status FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  if (allOk && allItemsSettled(settled)) {
    await markJobDelivered(jobId);
    await execRun(
      `UPDATE orders SET fulfillment_status='delivered', updated_at=datetime('now') WHERE code=?`,
      orderCode,
    );
    return true;
  }
  // Partial progress: keep the job retryable WITHOUT resetting delivered
  // items, surface the aggregate state on the order, and notify admin once.
  await scheduleRetry(jobId, firstError ?? "partial_item_failure");
  const orderStatus = settled.some((row) => String(row.status) === "failed")
    ? "failed"
    : settled.some((row) => ["delivered", "manual_required"].includes(String(row.status)))
      ? "retry"
      : String((await queryFirst(`SELECT status FROM fulfillment_jobs WHERE id=?`, jobId))?.status ?? "retry");
  await execRun(
    `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`,
    orderStatus, orderCode,
  );
  if (adminChatId && firstError) {
    try {
      await sendMessage({
        chat_id: adminChatId,
        text: adminDeliveryFailedNotification(orderCode, firstError),
        parse_mode: "HTML",
      });
    } catch { /* admin notification is best-effort */ }
  }
  return false;
}

/**
 * Deliver exactly one fulfillment_items row. Claim is per-item
 * (locked_until CAS) so concurrent workers never send the same item twice;
 * delivered rows are skipped by the caller and never re-entered here.
 */
async function processItem(order: Row, itemRow: Row, adminChatId?: string): Promise<boolean> {
  const orderCode = String(order.code);
  const itemId = Number(itemRow.id);
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  const claim = await execRun(
    `UPDATE fulfillment_items SET status='sending', locked_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
     WHERE id=? AND status IN ('queued','retry')
       AND (locked_until IS NULL OR datetime(locked_until) < datetime('now'))
       AND next_attempt_at <= datetime('now')`,
    lockUntil, itemId,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!claim.changes) return String(itemRow.status) === "sending";
  const item = (await queryFirst(`SELECT * FROM fulfillment_items WHERE id=?`, itemId)) ?? itemRow;

  const mode = String(item.fulfillment_mode || "manual");
  const recipientChannel = String(item.recipient_channel || order.sales_channel || "telegram");
  const recipientTarget = String(item.recipient_target || "");
  const productId = Number(item.product_id);
  const variantId = item.variant_id != null ? Number(item.variant_id) : 0;
  const qty = Math.max(1, Number(item.qty || 1));

  try {
    // Empty recipient → manual, never send to nobody (issue #4).
    if ((recipientChannel === "telegram" || recipientChannel === "whatsapp") && !recipientTarget) {
      throw new Error("no_recipient_for_channel");
    }
    if (mode === "manual") {
      await execRun(
        `UPDATE fulfillment_items SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        itemId,
      );
      return true;
    }
    if (mode === "shared") {
      const secret = variantId && isD1Mode()
        ? await queryFirst(
            `SELECT shared_secret_ciphertext, shared_secret_iv FROM product_variants WHERE id=? AND product_id=?`,
            variantId, productId,
          )
        : null;
      const ct = String(secret?.shared_secret_ciphertext || "");
      const iv = String(secret?.shared_secret_iv || "");
      if (!ct || !iv) throw new Error("Shared secret not configured for product");
      const plaintext = await decryptSecret(ct, iv);
      await sendToRecipient(recipientChannel, recipientTarget, orderCode, plaintext, qty);
      await execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        `item:${itemId}`, itemId,
      );
      return true;
    }
    if (mode === "unique") {
      // One reserved inventory row per unique item (reserved per order+variant
      // at checkout; see reserveInventoryForLine). Deliver each exactly once.
      const inventoryItem = await queryFirst(
        `SELECT * FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='reserved'`,
        Number(item.inventory_id || 0), orderCode,
      ) ?? await findReservedForOrderVariant(orderCode, productId, variantId || null);
      if (!inventoryItem) throw new Error("No reserved inventory found");
      const plaintext = await decryptSecret(
        String(inventoryItem.secret_ciphertext),
        String(inventoryItem.secret_iv),
      );
      await sendToRecipient(recipientChannel, recipientTarget, orderCode, plaintext, qty);
      await markDelivered(Number(inventoryItem.id));
      await execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        `item:${itemId}`, itemId,
      );
      return true;
    }
    throw new Error(`Unknown fulfillment mode: ${mode}`);
  } catch (error) {
    const errMsg = (error instanceof Error ? error.message : "Unknown delivery error").slice(0, 500);
    await scheduleItemRetry(itemId, errMsg);
    void adminChatId;
    return false;
  }
}

async function sendToRecipient(
  channel: string,
  target: string,
  orderCode: string,
  plaintext: string,
  qty: number,
): Promise<void> {
  const qtySuffix = qty > 1 ? ` (×${qty})` : "";
  if (channel === "whatsapp") {
    const sendResult = await sendTextMessage({
      target,
      message: `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}${qtySuffix}\n\nDetail akses/lisensi Anda:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
    });
    if (!sendResult.ok) throw new Error(sendResult.error || "WhatsApp direct delivery failed");
    return;
  }
  if (channel === "web") {
    // Web has no push channel: credentials are handed over by the admin
    // (manual_required), never auto-pushed. Reaching here means a routing
    // bug, so fail loudly into retry instead of silently dropping.
    throw new Error("web_channel_requires_manual_handover");
  }
  const sendResult = await sendMessage({
    chat_id: target,
    text: deliveryMessage(plaintext),
    parse_mode: "HTML",
  });
  if (!sendResult.ok) throw new Error(sendResult.description || "Telegram send failed");
}

async function scheduleItemRetry(itemId: number, error: string): Promise<void> {
  const item = await queryFirst(`SELECT attempt_count FROM fulfillment_items WHERE id=?`, itemId);
  const attempts = Number(item?.attempt_count ?? 0);
  if (attempts >= MAX_ATTEMPTS) {
    await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      error, itemId,
    );
    return;
  }
  const delayMinutes = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)];
  await execRun(
    `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
     next_attempt_at=datetime('now', '+${delayMinutes} minutes'), updated_at=datetime('now') WHERE id=?`,
    error, itemId,
  );
}

async function findReservedForOrderVariant(
  orderCode: string,
  productId: number,
  variantId: number | null,
): Promise<Row | undefined> {
  if (isD1Mode()) {
    return await queryFirst(
      `SELECT * FROM fulfillment_inventory
       WHERE order_code=? AND product_id=? AND status='reserved'
         AND (? IS NULL OR variant_id=? OR variant_id IS NULL)
       ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC LIMIT 1`,
      orderCode, productId, variantId, variantId, variantId,
    );
  }
  return findReservedForOrder(orderCode);
}

/**
 * Legacy single-item processing for jobs without fulfillment_items rows
 * (pre-migration data, or dev in-memory flows). Preserves the previous
 * items[0]-centered behavior exactly; new code paths always materialize
 * per-item rows first via ensureFulfillmentItems.
 */
async function processLegacyJob(
  jobId: number,
  order: Row,
  product: Row,
  claimed: Row,
): Promise<boolean> {
  const salesChannel = String(order.sales_channel || "telegram");
  const orderCode = String(order.code);
  const recipient = resolveRecipient(order);
  const chatId = recipient.channel === "telegram" ? recipient.target : String(order.telegram_chat_id || "");
  const waRecipient = recipient.channel === "whatsapp" ? recipient.target : String(order.channel_member_id || order.customer_wa || "");
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  // WhatsApp fulfillment feature flag (if disabled, route to manual)
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
    // A selected variant owns its fulfillment mode and shared secret. Product
    // fields are only the legacy fallback while variant rollout is disabled.
    const variantId = Number(order.variant_id || claimed.variant_id || 0);
    const variant = variantId && isD1Mode()
      ? await queryFirst(
          `SELECT fulfillment_mode, shared_secret_ciphertext, shared_secret_iv
           FROM product_variants WHERE id=? AND product_id=?`,
          variantId,
          Number(product.id),
        )
      : null;
    if (variantId && isD1Mode() && !variant) throw new Error("Selected fulfillment variant not found");

    const fulfillmentSource = variant ? { ...product, ...variant } : product;
    const snapshotMode = fulfillmentModeFromOrderSnapshot(order);
    const fulfillmentMode = String(
      (claimed.inventory_id || String(order.fulfillment_status) === "reserved")
        ? "unique"
        : snapshotMode || fulfillmentSource.fulfillment_mode || "manual",
    );

    // Manual: payment acknowledgement is handled independently from
    // auto-fulfillment, so stop here and leave the order for the admin.
    if (fulfillmentMode === "manual") {
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

    // Shared: decrypt product shared secret
    if (fulfillmentMode === "shared") {
      const ct = String(fulfillmentSource.shared_secret_ciphertext || "");
      const iv = String(fulfillmentSource.shared_secret_iv || "");
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
 * Idempotently create and immediately attempt fulfillment for a paid order.
 * Used by callbacks, reconciliation, and manual proof approval so every
 * authoritative payment path reaches the same channel/variant-aware outbox.
 */
export async function ensureFulfillmentForPaidOrder(orderCode: string): Promise<boolean> {
  const autoFulfillmentEnabled = process.env.AUTO_FULFILLMENT_ENABLED === "true";

  const order = await queryFirst(
    `SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'`,
    orderCode,
  );
  if (!order) return false;

  // Buyer payment acknowledgement must not depend on AUTO_FULFILLMENT_ENABLED.
  // It is durable/idempotent and retried by the operations cron when Telegram
  // is temporarily unavailable.
  if (String(order.sales_channel) === "telegram") {
    try {
      await notifyTelegramBuyerPaid(orderCode);
    } catch { /* Payment remains durable; notification cron retries it. */ }
  }

  let items: { product_id: number; variant_id?: number }[];
  try {
    items = JSON.parse(String(order.items ?? "[]"));
  } catch {
    return false;
  }
  if (!items.length) return false;

  const product = await queryFirst(`SELECT * FROM products WHERE id=?`, items[0].product_id);
  if (!product) return false;

  // Materialize per-item rows FIRST (issue #4): every item gets its own
  // status row with its own mode + recipient, so delivery below never
  // drops items[1..n]. Idempotent (UNIQUE order_code+item_index); legacy
  // rows keep their progress.
  await ensureFulfillmentItems(order).catch(() => {});

  const variantId = Number(order.variant_id || items[0].variant_id || 0) || null;
  const variant = variantId && isD1Mode()
    ? await queryFirst(`SELECT fulfillment_mode FROM product_variants WHERE id=? AND product_id=?`, variantId, items[0].product_id)
    : null;
  const inventory = await queryFirst(
    `SELECT id FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`,
    orderCode,
  );
  // Aggregate order status stays informative: delivered/manual_required only
  // when every item row settled (processJob enforces this); otherwise the
  // order mirrors the job/item aggregate instead of items[0].
  const itemRows = await queryAll(
    `SELECT status FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  const fulfillmentMode = itemRows.length
    ? allItemsSettled(itemRows)
      ? (itemRows.every((row) => String(row.status) === "manual_required") ? "manual_required" : "delivered")
      : String(order.fulfillment_status || "queued")
    : String(
        inventory
          ? "unique"
          : fulfillmentModeFromOrderSnapshot(order)
            || variant?.fulfillment_mode
            || product.fulfillment_mode
            || "manual",
      );

  await createFulfillmentJob(
    orderCode,
    inventory ? Number(inventory.id) : null,
    fulfillmentMode,
    variantId,
    String(order.sales_channel || "telegram"),
  );

  // Older manual jobs were inserted as manual_required before payment. Requeue
  // only when the order itself has not yet entered manual fulfillment.
  if (String(order.fulfillment_status || "") !== "manual_required") {
    await execRun(
      `UPDATE fulfillment_jobs
       SET status='queued', next_attempt_at=datetime('now'), locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND status='manual_required'`,
      orderCode,
    );
  }

  const job = await queryFirst(`SELECT id FROM fulfillment_jobs WHERE order_code=?`, orderCode);
  if (!job) return false;
  // When AUTO_FULFILLMENT_ENABLED is off, the durable part is done: the
  // queued outbox row plus the Telegram paid ack above. Delivery itself
  // waits for the flag (or the admin .d path) — the order is never lost,
  // and recovery below never sends credentials twice (claimed exactly
  // once via claimJob, settled via markJobDelivered idempotency below).
  if (!autoFulfillmentEnabled) return false;
  return processJob(Number(job.id), order, product);
}

/**
 * Reconcile paid orders that have no fulfillment job (issue #3).
 *
 * Covers every gap between "payment stored" and "job created": crashes in
 * legacy code paths, jobs deleted manually, and pre-fix rows. For each paid
 * order without a job row, reuses ensureFulfillmentForPaidOrder so routing,
 * idempotency, and the AUTO_FULFILLMENT_ENABLED gate stay identical to the
 * live payment paths. Returns the number of orders healed.
 *
 * Idempotency: ensureFulfillmentForPaidOrder inserts exactly one job row
 * (UNIQUE order_code); already-delivered orders are skipped by callers that
 * check fulfillment_status, and processJob claims each job exactly once, so
 * recovery never delivers credentials twice.
 */
export async function reconcileMissingFulfillmentJobs(limit = 25): Promise<number> {
  const orphans = await queryAll(
    `SELECT o.code FROM orders o
     LEFT JOIN fulfillment_jobs fj ON fj.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid'
       AND fj.order_code IS NULL
     ORDER BY o.updated_at ASC LIMIT ?`,
    limit,
  );
  let healed = 0;
  for (const orphan of orphans) {
    try {
      if (await ensureFulfillmentForPaidOrder(String(orphan.code))) healed++;
      else {
        // ensure returns false when auto-fulfillment is off yet still
        // creates the queued job — count it as healed if the row exists.
        const job = await queryFirst(
          `SELECT id FROM fulfillment_jobs WHERE order_code=?`,
          String(orphan.code),
        );
        if (job) healed++;
      }
    } catch { /* next cron run retries */ }
  }
  return healed;
}

/**
 * Backfill per-item rows for paid orders that have a job but no item rows
 * (pre-migration-0015 data, issue #4). Bounded and idempotent; each order
 * reuses ensureFulfillmentItems so mode/recipient resolution stays single.
 */
export async function backfillMissingFulfillmentItems(limit = 25): Promise<number> {
  const rows = await queryAll(
    `SELECT o.* FROM orders o
     JOIN fulfillment_jobs fj ON fj.order_code=o.code
     LEFT JOIN fulfillment_items fi ON fi.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid'
       AND fi.order_code IS NULL
     ORDER BY o.updated_at ASC LIMIT ?`,
    limit,
  ).catch(() => [] as Row[]);
  let backfilled = 0;
  for (const order of rows) {
    try {
      const created = await ensureFulfillmentItems(order);
      if (created.length > 0) backfilled++;
    } catch { /* next cron run retries */ }
  }
  return backfilled;
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
       AND o.status='lunas' AND o.payment_status='paid'
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
