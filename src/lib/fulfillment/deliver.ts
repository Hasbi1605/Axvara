import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
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
 * Resolve the delivery recipient for one order (issues #4, #5).
 *
 * - telegram → telegram_user_id pembeli (chat pribadi terverifikasi).
 *   telegram_chat_id TIDAK dipakai sebagai penerima kredensial: dari grup,
 *   chat_id adalah ID grup, sehingga memakainya membocorkan kredensial ke
 *   seluruh anggota grup. Order grup menyimpan chat pribadi setelah buyer
 *   menekan START (ensurePrivateRecipient) atau item diarahkan manual.
 * - whatsapp → nomor anggota grup (channel_member_id) atau customer_wa.
 * - web → nomor WA pembeli (jalur manual/admin; tidak ada push otomatis).
 * Target kosong berarti item tidak dapat dikirim otomatis dan diarahkan ke
 * `manual_required` — bukan dikirim ke penerima kosong/grup.
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
  // Private-only: telegram_user_id adalah identitas pembeli terverifikasi
  // (from.id saat START/callback di chat pribadi). telegram_chat_id hanya
  // dipakai untuk membalas pesan operasional non-kredensial.
  return { channel: "telegram", target: String(order.telegram_user_id || "") };
}

/**
 * Bind the verified private chat of a Telegram buyer to their user id
 * (issue #5). Called on every private START/callback/message BEFORE any
 * order or delivery work:
 * - telegram_users.chat_id = chat pribadi terakhir yang terverifikasi.
 * - paid orders of this buyer with no usable private recipient inherit it
 *   (CAS: only when the stored target is empty or a negative group id),
 *   so credentials created from a group checkout find the private chat as
 *   soon as the buyer presses START — without ever trusting a group id.
 */
export async function ensurePrivateRecipient(
  telegramUserId: string,
  privateChatId: string,
): Promise<void> {
  if (!telegramUserId || !privateChatId) return;
  if (Number(privateChatId) < 0) return; // never bind a group id
  await execRun(
    `UPDATE telegram_users SET chat_id=?, updated_at=datetime('now')
     WHERE user_id=? AND (chat_id IS NULL OR chat_id!=? OR CAST(chat_id AS INTEGER) < 0)`,
    privateChatId, telegramUserId, privateChatId,
  ).catch(() => {});
  await execRun(
    `UPDATE orders SET telegram_chat_id=?
     WHERE sales_channel='telegram' AND telegram_user_id=?
       AND status='lunas' AND payment_status='paid'
       AND (telegram_chat_id IS NULL OR telegram_chat_id!=? OR CAST(telegram_chat_id AS INTEGER) < 0)
       AND fulfillment_status NOT IN ('delivered')`,
    privateChatId, telegramUserId, privateChatId,
  ).catch(() => {});
  await execRun(
    `UPDATE fulfillment_items SET recipient_target=?
     WHERE recipient_channel='telegram' AND recipient_target!=?
       AND (recipient_target IS NULL OR CAST(recipient_target AS INTEGER) < 0)
       AND order_code IN (
         SELECT code FROM orders
         WHERE sales_channel='telegram' AND telegram_user_id=?
           AND status='lunas' AND payment_status='paid'
       )`,
    privateChatId, privateChatId, telegramUserId,
  ).catch(() => {});
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
          qty: Number(row.qty ?? 1),
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
  productsById: Map<number, Row>, database: DatabaseAccess = createDatabaseAccess()
): Promise<"manual" | "shared" | "unique"> {
  const { queryFirst, isD1Mode } = database;
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
export async function ensureFulfillmentItems(
  order: Row, database: DatabaseAccess = createDatabaseAccess(), maxNewItems = Infinity,
): Promise<Row[]> {
  const { queryAll, queryFirst, execRun } = database;
  const orderCode = String(order.code);
  const items = parseOrderItems(order.items);
  const existing = await queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
  if (existing.length === items.length) return existing;
  const have = new Set(existing.map((row) => Number(row.item_index)));
  const taken = new Set(existing.map((row) => Number(row.inventory_id || 0)).filter((id) => id > 0));
  const recipient = resolveRecipient(order);
  const productsById = new Map<number, Row>();
  let created = 0;
  for (let index = 0; index < items.length; index++) {
    if (have.has(index)) continue;
    // At most five statements to resolve/bind/insert one line; keep enough
    // room to reread rows and finish the job without calling a provider.
    if (created >= maxNewItems || !database.canSpend(5 + COST_PER_JOB_FRAME + 1)) break;
    const item = items[index];
    if (!Number.isSafeInteger(item.qty) || Number(item.qty) < 1) throw new Error("invalid_fulfillment_quantity");
    if (!productsById.has(item.product_id)) {
      const product = await queryFirst(`SELECT * FROM products WHERE id=?`, item.product_id);
      if (product) productsById.set(item.product_id, product);
    }
    const mode = await resolveItemMode(item, order, productsById, database);
    const inventory = mode === "unique"
      ? await claimInventoryForItem(orderCode, item.product_id, item.variant_id ?? null, taken, database)
      : null;
    if (inventory) taken.add(Number(inventory.id));
    await execRun(
      `INSERT OR IGNORE INTO fulfillment_items
       (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,inventory_id,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
       VALUES(?,?,?,?,?,?,?,?,?,'queued',0,datetime('now'))`,
      orderCode, index, item.product_id, item.variant_id ?? null, item.qty, mode,
      inventory ? Number(inventory.id) : null, recipient.channel, recipient.target || null,
    );
    created++;
  }
  if (!created) return existing;
  return queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
}

/**
 * Klaim satu unit inventory untuk satu baris item (review R3).
 * - Eksplisit per (order, product, variant): unit khusus varian diutamakan,
 *   unit legacy tanpa variant_id adalah pool terakhir yang deterministik
 *   (id terkecil) — bukan pilihan acak by order_code.
 * - Unik: id dalam `taken` (sudah terikat ke baris lain order ini) dilewati.
 * - Divalidasi ulang sebelum kirim oleh processItem (inventoryMatchesItem).
 * Mengembalikan baris inventory atau null bila tidak ada unit yang cocok.
 */
async function claimInventoryForItem(
  orderCode: string,
  productId: number,
  variantId: number | null,
  taken: Set<number>, database: DatabaseAccess = createDatabaseAccess()
): Promise<Row | null> {
  const { queryAll } = database;
  const candidates = variantId == null
    ? await queryAll(
        `SELECT * FROM fulfillment_inventory
         WHERE order_code=? AND product_id=? AND status='reserved'
         ORDER BY id ASC`,
        orderCode, productId,
      ).catch(() => [] as Row[])
    : await queryAll(
        `SELECT * FROM fulfillment_inventory
         WHERE order_code=? AND product_id=? AND status='reserved'
           AND (variant_id=? OR variant_id IS NULL)
         ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC`,
        orderCode, productId, variantId, variantId,
      ).catch(() => [] as Row[]);
  for (const row of candidates) {
    const id = Number(row.id);
    if (taken.has(id)) continue;
    const rowVariant = row.variant_id == null ? null : Number(row.variant_id);
    // Kecocokan: unit khusus varian hanya untuk varian itu; unit legacy
    // (variant_id NULL) boleh dipakai varian mana pun sebagai fallback.
    if (rowVariant !== null && variantId !== null && rowVariant !== variantId) continue;
    if (rowVariant !== null && variantId === null) continue;
    return row;
  }
  return null;
}

/**
 * Validasi kecocokan inventory ↔ item sebelum dekripsi/pengiriman.
 * Menolak unit milik varian lain; unit legacy (variant_id NULL) diterima
 * sebagai fallback deterministik.
 */
function inventoryMatchesItem(inventory: Row, productId: number, variantId: number | null): boolean {
  if (Number(inventory.product_id) !== Number(productId)) return false;
  if (inventory.variant_id == null) return true;
  if (variantId == null) return false;
  return Number(inventory.variant_id) === Number(variantId);
}

/**
 * True when every item row reached a successful terminal state.
 * manual_required counts as settled (it waits for a legitimate handover),
 * but NOT as delivered — see allItemsDelivered.
 */
export function allItemsSettled(rows: Row[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => ["delivered", "manual_required"].includes(String(row.status)));
}

/**
 * True only when EVERY item row is delivered AND no item still waits for a
 * manual handover. Invariant (review R2): an order is NOT delivered while
 * any item is manual_required, queued, retry, sending, failed — or a line
 * that should exist has no row at all. A mixed shared/manual order with
 * rows [delivered, manual_required] therefore aggregates to
 * manual_required, never delivered.
 */
export function allItemsDelivered(rows: Row[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => String(row.status) === "delivered");
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
  salesChannel = "telegram", database: DatabaseAccess = createDatabaseAccess()
): Promise<number | null> {
  const { execRun, isD1Mode } = database;
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
export async function claimJob(jobId: number, database: DatabaseAccess = createDatabaseAccess(), countAttempt = true): Promise<Row | null> {
  const { queryFirst, execRun, isD1Mode } = database;
  const lockUntil = new Date(Date.now() + 60_000).toISOString();

  if (isD1Mode()) {
    // datetime() menormalkan ISO-8601 (T/Z/millis, format tulis lock) dan
    // legacy space-separated ke domain yang sama (issue #7): perbandingan
    // string mentah tidak pernah cocok untuk ISO sehingga lock kedaluwarsa
    // tertahan berjam-jam. Lock aktif tetap tidak bisa direbut (CAS).
    const result = await execRun(
      `UPDATE fulfillment_jobs SET status='sending', locked_until=?, attempt_count=attempt_count+${countAttempt ? 1 : 0}, updated_at=datetime('now')
       WHERE id=? AND status IN ('queued','retry') AND (locked_until IS NULL OR datetime(locked_until) < datetime('now'))`,
      lockUntil, jobId,
    );
    if (!result.changes) return null;
    return (await queryFirst(`SELECT * FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending'`, jobId, lockUntil)) ?? null;
  }

  const job = getJobsMem().find(
    (r) => Number(r.id) === jobId && (r.status === "queued" || r.status === "retry"),
  );
  if (!job) return null;
  job.status = "sending";
  job.locked_until = lockUntil;
  job.attempt_count = (Number(job.attempt_count) || 0) + (countAttempt ? 1 : 0);
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
 * Hasil mutasi job berpagar (RR4-05): bukan void buta, melainkan status
 * yang menyatakan apakah worker masih berwenang dan transisi mana yang
 * terjadi. Pemanggil WAJIB memakai hasil ini sebelum menyentuh agregat
 * order — jeda antara mutasi job dan agregasi harus diproteksi ulang.
 */
export type FencedJobMutation =
  | { owned: true; transition: "retry" | "failed" }
  | { owned: false };

/**
 * scheduleRetry yang dipagar lease (R4): worker basi yang lease-nya sudah
 * direbut pemilik baru (locked_until berbeda) mendapat 0 row — parent yang
 * sudah delivered TIDAK turun menjadi retry, dan error basi tidak menimpa
 * penanda pemilik baru. Tanpa fence = varian tanpa lease memakai jalur lama.
 *
 * RR4-05: mengembalikan FencedJobMutation agar pemanggil tahu (a) apakah
 * worker masih pemilik (owned), dan (b) apakah job menjadi retry atau
 * terminal failed. Jangan menambah 'failed' ke daftar status milik tanpa
 * bukti kepemilikan — bukti di sini adalah baris yang benar-benar diubah
 * oleh CAS milik worker ini (changes > 0).
 */
/** Commit the aggregate while the lease still belongs to this worker, then
 * release the lease in the SAME D1 transaction. No writes follow its release. */
async function writeJobOutcome(
  jobId: number, lease: string, status: "queued" | "retry" | "failed" | "delivered" | "manual_required",
  aggregate: string | null, database: DatabaseAccess,
  options: { error?: string; attempts?: number; delay?: number; clearCursor?: boolean } = {},
): Promise<boolean> {
  const statements: { sql: string; params: unknown[] }[] = [];
  if (aggregate !== null) statements.push({
    sql: `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now')
          WHERE code=(SELECT order_code FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending')
          AND status='lunas' AND payment_status='paid'
          AND (COALESCE(fulfillment_status,'none')!='delivered' OR ?='delivered')`,
    params: [aggregate, jobId, lease, aggregate],
  });
  statements.push({
    sql: `UPDATE fulfillment_jobs SET status='${status}', locked_until=NULL,
          last_error=?, attempt_count=COALESCE(?,attempt_count),
          item_cursor=CASE WHEN ? THEN NULL ELSE item_cursor END,
          next_attempt_at=datetime('now', ?), updated_at=datetime('now')
          WHERE id=? AND locked_until=? AND status='sending'`,
    params: [options.error ?? null, options.attempts ?? null, options.clearCursor ? 1 : 0,
      `+${options.delay ?? 0} minutes`, jobId, lease],
  });
  if (database.d1) {
    const results = await database.d1.batch(statements.map(({ sql, params }) => database.d1!.prepare(sql).bind(...params)));
    return Boolean(results.at(-1)?.meta.changes);
  }
  for (const statement of statements) await database.execRun(statement.sql, ...statement.params);
  return true;
}

export async function scheduleRetryFenced(
  jobId: number, error: string, lease?: string,
  database: DatabaseAccess = createDatabaseAccess(), countFailure = false,
): Promise<FencedJobMutation> {
  if (database.d1 && lease) {
    const job = await database.queryFirst(`SELECT attempt_count FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending'`, jobId, lease);
    if (!job) return { owned: false };
    const attempts = Number(job.attempt_count ?? 0) + (countFailure ? 1 : 0);
    const transition = attempts >= MAX_ATTEMPTS ? "failed" : "retry";
    const owned = await writeJobOutcome(jobId, lease, transition, transition, database, {
      error: error.slice(0, 500), attempts,
      delay: transition === "retry" ? RETRY_DELAYS[Math.max(0, Math.min(attempts - 1, RETRY_DELAYS.length - 1))] : 0,
    });
    return owned ? { owned: true, transition } : { owned: false };
  }
  await scheduleRetry(jobId, error);
  const after = await database.queryFirst(`SELECT status FROM fulfillment_jobs WHERE id=?`, jobId);
  return { owned: true, transition: after?.status === "failed" ? "failed" : "retry" };
}

/** Conservative admission reserve for item claims, inventory repair, retries,
 * cursor writes and settlement. The scoped database enforces the actual cap. */
export const COST_PER_DELIVERY_ITEM = 12;
/** Claim/read plus final reconciliation, including the atomic outcome batch. */
export const COST_PER_JOB_FRAME = 6;

/**
 * Hasil pemrosesan per-item (RR4-01): berapa item yang selesai diupayakan,
 * apakah masih ada sisa, dan apakah worker masih pemilik.
 */
export type JobUnitResult =
  | { done: true; attempted: number; finished: boolean }
  | { done: false; reason: "not_owned" | "not_paid" | "no_work" | "item_failed" | "budget_yield"; attempted: number; finished: boolean };

/**
 * Proses SEBANYAK maxItems item berikutnya dari satu job (RR4-01).
 *
 * Unit kerja yang benar-benar bisa dilanjutkan: item yang sudah delivered/
 * manual_required dilewati (TIDAK dikirim ulang), item berikutnya diklaim
 * dan dikirim satu per satu, dan `item_cursor` (index berikutnya)
 * disimpan ke DB setiap selesai satu item — sehingga invocation berikutnya
 * (bahkan setelah restart worker) melanjutkan dari posisi yang benar.
 *
 * - `shouldContinue` dipanggil SEBELUM tiap item: kembalikan false untuk
 *   yield (budget habis). Yield BUKAN kegagalan provider: attempt job tidak
 *   dikonsumsi untuk item yang belum dicoba, dan item yang sudah delivered
 *   tidak diulang.
 * - Agregat job/order HANYA ditulis bila seluruh item terminal (selesai)
 *   ATAU ada kegagalan item yang butuh status retry/failed. Yield murni
 *   (semua item yang dicoba sukses tetapi masih ada sisa) TIDAK menulis
 *   retry — job kembali queued dan melepas lease agar cron berikutnya
 *   dapat melanjutkan tanpa menghabiskan jatah kegagalan.
 *
 * Kepemilikan lease antar invocation: klaim job per invocation (bukan
 * dipertahankan lintas cron). Tiap panggilan mengklaim ulang (CAS) bila
 * status masih queued/retry/sending-lease-lewat; item delivered tidak
 * disentuh ulang. Ini membuat retry budget hanya dikonsumsi oleh
 * kegagalan nyata, bukan oleh yield.
 */
export async function processJobItems(
  jobId: number, order: Row, product: Row, maxItems: number,
  shouldContinue?: () => boolean, database: DatabaseAccess = createDatabaseAccess(),
): Promise<JobUnitResult> {
  const { queryAll, queryFirst, execRun } = database;
  const empty = (reason: "not_paid" | "no_work" | "not_owned" | "budget_yield"): JobUnitResult => ({ done: false, reason, attempted: 0, finished: false });
  if (order.status !== "lunas" || order.payment_status !== "paid") return empty("not_paid");
  const orderCode = String(order.code);
  const channel = String(order.sales_channel || "telegram");
  if (channel === "whatsapp" && isEnabled("WHATSAPP_FULFILLMENT") && order.payment_method !== "qris" && isEnabled("WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT")) {
    if (!database.canSpend(1)) return empty("budget_yield");
    const proof = database.d1 ? await queryFirst(`SELECT id FROM payment_proofs WHERE order_code=? AND status IN ('submitted','approved')`, orderCode) : true;
    if (!proof) return empty("no_work");
  }
  if (!database.canSpend(COST_PER_JOB_FRAME)) return empty("budget_yield");
  const itemRows = await ensureFulfillmentItems(order, database, Number.isFinite(maxItems) ? Math.max(1, maxItems) : Infinity);
  if (!itemRows.length) return empty("budget_yield");
  // Admission includes claim + final reconciliation even if no item fits.
  if (!database.canSpend(COST_PER_JOB_FRAME)) return empty("budget_yield");
  const claimed = await claimJob(jobId, database, false);
  if (!claimed) return empty("not_owned");
  const lease = String(claimed.locked_until ?? "");
  if (fulfillmentLineMismatches(order.items, itemRows).some((m) => m.kind !== "missing")) {
    const owned = await writeJobOutcome(jobId, lease, "manual_required", "manual_required", database, { error: "fulfillment_manifest_mismatch" });
    return empty(owned ? "no_work" : "not_owned");
  }
  const start = Number(claimed.item_cursor ?? 0);
  let attempted = 0;
  let failure: string | null = null;
  const pending = itemRows.filter((row) => !["delivered", "manual_required"].includes(String(row.status)));
  const todo = pending.filter((r) => Number(r.item_index) >= start).concat(pending.filter((r) => Number(r.item_index) < start));
  for (const row of todo.slice(0, Math.max(0, maxItems))) {
    // Worst-case item recovery + finalization are reserved before any provider call.
    // Shared/manual need at most eight statements including a failed settle,
    // retry, cursor and error reread; unique may also repair an inventory binding.
    const itemCost = row.fulfillment_mode === "unique" ? COST_PER_DELIVERY_ITEM : 8;
    if (!database.canSpend(itemCost + COST_PER_JOB_FRAME) || (shouldContinue && !shouldContinue())) break;
    if (row.status === "failed") { failure ??= String(row.last_error || "item failed"); continue; }
    const ok = await processItem(order, row, process.env.TELEGRAM_ADMIN_CHAT_ID, database, { jobId, lease });
    attempted++;
    const checkpoint = await execRun(`UPDATE fulfillment_jobs SET item_cursor=? WHERE id=? AND locked_until=? AND status='sending'`, Number(row.item_index) + 1, jobId, lease);
    if (!checkpoint.changes) return { done: false, reason: "not_owned", attempted, finished: false };
    if (!ok) failure ??= String((await queryFirst(`SELECT last_error FROM fulfillment_items WHERE id=?`, Number(row.id)))?.last_error || "item delivery failed");
  }
  const rows = await queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
  const mismatches = fulfillmentLineMismatches(order.items, rows);
  const missingOnly = mismatches.length > 0 && mismatches.every((m) => m.kind === "missing");
  if (mismatches.length && !missingOnly) {
    const owned = await writeJobOutcome(jobId, lease, "manual_required", "manual_required", database, { error: "fulfillment_manifest_mismatch" });
    return { done: false, reason: owned ? "no_work" : "not_owned", attempted, finished: false };
  }
  if (!mismatches.length && allItemsSettled(rows)) {
    const aggregate = allItemsDelivered(rows) ? "delivered" : "manual_required";
    const owned = await writeJobOutcome(jobId, lease, "delivered", aggregate, database, { clearCursor: true });
    return owned ? { done: true, attempted, finished: true } : { done: false, reason: "not_owned", attempted, finished: false };
  }
  if (failure) {
    const outcome = await scheduleRetryFenced(jobId, failure, lease, database, true);
    return { done: false, reason: outcome.owned ? "item_failed" : "not_owned", attempted, finished: false };
  }
  // A normal checkpoint is not a failed delivery attempt.
  const owned = await writeJobOutcome(jobId, lease, "queued", null, database);
  return { done: false, reason: owned ? "budget_yield" : "not_owned", attempted, finished: false };
}

/** Direct and cron delivery share the same policy and state transitions. */
export async function processJob(
  jobId: number, order: Row, product: Row,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  // Dev's in-memory adapter has no per-item table; preserve its existing path.
  if (!database.d1) {
    if (order.status !== "lunas" || order.payment_status !== "paid") return false;
    const claimed = await claimJob(jobId, database);
    return claimed ? processLegacyJob(jobId, order, product, claimed) : false;
  }
  const result = await processJobItems(jobId, order, product, Infinity, undefined, database);
  return result.done;
}

async function processItem(order: Row, itemRow: Row, adminChatId?: string, database: DatabaseAccess = createDatabaseAccess(), parent?: { jobId: number; lease: string }): Promise<boolean> {
  const { queryFirst, execRun, isD1Mode } = database;
  const orderCode = String(order.code);
  const itemId = Number(itemRow.id);
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  // Immediate pass (no due-gate): retry rows become deliverable the
  // moment their cause is fixed (secret configured, recipient restored).
  // next_attempt_at only paces the cron, never blocks a live payment path.
  // Lease fencing (review R4): the claim only wins when the row is
  // queued/retry with no active lease. An ACTIVE `sending` lease is never
  // stolen. Every state-changing write below is fenced by the exact
  // locked_until value this worker holds (? fence): if a newer worker
  // re-claimed the row after our claim expired, our writes affect zero
  // rows and the result is dropped — a stale worker can never overwrite a
  // new worker's progress (delivered rows, error markers, retries).
  const lockRequested = lockUntil;
  const claim = await execRun(
    `UPDATE fulfillment_items SET status='sending', locked_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
      WHERE id=? AND status IN ('queued','retry')
        AND (locked_until IS NULL OR datetime(locked_until) < datetime('now'))
        ${parent ? "AND EXISTS (SELECT 1 FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending')" : ""}`,
    lockUntil, itemId, ...(parent ? [parent.jobId, parent.lease] : []),
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!claim.changes) {
    if (String(itemRow.status) === "sending") return true;
    // A retry row claimed/locked by another worker is not our failure.
    if (String(itemRow.status) === "retry") return true;
    return false;
  }
  // Read only the claim we actually won; never adopt a newer worker's lease.
  const claimed = await queryFirst(`SELECT * FROM fulfillment_items WHERE id=? AND locked_until=? AND status='sending'`, itemId, lockRequested);
  if (!claimed) return false;
  const leaseFence = lockRequested;
  const item = claimed;

  const mode = String(order.sales_channel) === "whatsapp" && !isEnabled("WHATSAPP_FULFILLMENT") ? "manual" : String(item.fulfillment_mode || "manual");
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
    // Web items have no push channel (review R3): route them straight to
    // the admin handover queue instead of burning the retry budget on a
    // delivery that can never succeed. manual_required IS the final,
    // actionable state for web — the admin hands the credential over and
    // records it in admin_note.
    if (recipientChannel === "web") {
      await execRun(
        `UPDATE fulfillment_items SET status='manual_required', last_error='web_channel_requires_manual_handover:serahkan manual via admin_note', locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
        itemId, leaseFence,
      );
      return true;
    }
    if (mode === "manual") {
      await execRun(
        `UPDATE fulfillment_items SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
        itemId, leaseFence,
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
      // Fenced write: only applies while THIS worker still holds the lease.
      const settled = await execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
        `item:${itemId}`, itemId, leaseFence,
      );
      if (!settled.changes) throw new Error("lease_lost_during_delivery");
      return true;
    }
    if (mode === "unique") {
      // One reserved inventory row per unique item, bound explicitly at
      // materialization (claimInventoryForItem) and re-validated here
      // before decrypt/send (review R3). A row pointing at another
      // variant's unit (legacy mis-binding) is NOT sent — it fails closed
      // with inventory_mismatch so an admin can reconcile instead of the
      // buyer receiving the wrong credential.
      // Catatan urutan: baris item diproses berurutan (item_index naik),
      // sehingga baris pertama mengonsumsi unit cocoknya dulu via
      // markDelivered (reserved→delivered). Baris kedua yang menunjuk unit
      // yang SAMA melihatnya sudah tidak reserved → mismatch, bukan kirim
      // ulang secret yang sama.
      const bound = Number(item.inventory_id || 0) > 0
        ? await queryFirst(
            `SELECT * FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='reserved'`,
            Number(item.inventory_id || 0), orderCode,
          )
        : null;
      let inventoryItem = bound && inventoryMatchesItem(bound, productId, variantId || null) ? bound : null;
      if (bound && !inventoryItem) {
        // Ikatan menunjuk unit varian lain (pemetaan salah historis) —
        // JANGAN kirim secret yang salah. Namun sebelum gagal, periksa dulu
        // apakah unit yang BENAR untuk baris ini masih tersedia: bila ya,
        // pakai unit benar itu (perilaku menyembuhkan, bukan macet); bila
        // tidak, gagal tertutup mismatch untuk rekonsiliasi admin.
        const correct = await findReservedForOrderVariant(orderCode, productId, variantId || null, database);
        if (correct && inventoryMatchesItem(correct, productId, variantId || null)) {
          const takenElsewhere = await queryFirst(
            `SELECT id FROM fulfillment_items WHERE order_code=? AND id!=? AND inventory_id=?`,
            orderCode, itemId, Number(correct.id),
          );
          if (!takenElsewhere) {
            const rebound = await execRun(`UPDATE fulfillment_items SET inventory_id=? WHERE id=? AND locked_until=?`, Number(correct.id), itemId, leaseFence);
            if (!rebound.changes) throw new Error("lease_lost_during_delivery");
            inventoryItem = correct;
          }
        }
        if (!inventoryItem) {
          throw new Error(`inventory_mismatch:unit ${Number(item.inventory_id)} bukan milik varian ${variantId || "-"} (perlu rekonsiliasi admin)`);
        }
      }
      if (!bound) {
        const fallback = await findReservedForOrderVariant(orderCode, productId, variantId || null, database);
        if (fallback && inventoryMatchesItem(fallback, productId, variantId || null)) {
          // Perbaiki ikatan baris ini ke unit yang cocok agar retry
          // berikutnya deterministik (bukan pencarian ulang tiap proses).
          // Unit yang sudah terikat ke baris LAIN order ini tidak boleh
          // direbut — satu unit = satu kebutuhan pengiriman (review R3).
          const takenElsewhere = await queryFirst(
            `SELECT id FROM fulfillment_items WHERE order_code=? AND id!=? AND inventory_id=?`,
            orderCode, itemId, Number(fallback.id),
          );
          if (!takenElsewhere) {
            const rebound = await execRun(`UPDATE fulfillment_items SET inventory_id=? WHERE id=? AND locked_until=?`, Number(fallback.id), itemId, leaseFence);
            if (!rebound.changes) throw new Error("lease_lost_during_delivery");
            inventoryItem = fallback;
          } else {
            throw new Error(`inventory_mismatch:unit ${Number(fallback.id)} sudah terikat ke baris lain order ${orderCode} (perlu rekonsiliasi admin)`);
          }
        }
      }
      if (!inventoryItem) throw new Error("No reserved inventory found");
      const plaintext = await decryptSecret(
        String(inventoryItem.secret_ciphertext),
        String(inventoryItem.secret_iv),
      );
      await sendToRecipient(recipientChannel, recipientTarget, orderCode, plaintext, qty);
      const d1 = database.d1;
      // Keep inventory and item settlement atomic, both under the item lease.
      // A worker resuming after its lease was taken cannot consume the unit.
      if (d1) {
        const settled = await d1.batch([
          d1.prepare(`UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
            WHERE id=? AND order_code=? AND status='reserved'
              AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND inventory_id=? AND locked_until=? AND status='sending')`)
            .bind(Number(inventoryItem.id), orderCode, itemId, Number(inventoryItem.id), leaseFence),
          d1.prepare(`UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now')
            WHERE id=? AND locked_until=? AND status='sending'
              AND EXISTS(SELECT 1 FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='delivered')`)
            .bind(`item:${itemId}`, itemId, leaseFence, Number(inventoryItem.id), orderCode),
        ]);
        if (!settled.at(-1)?.meta.changes) throw new Error("lease_lost_during_delivery");
      } else {
        await markDelivered(Number(inventoryItem.id), database);
        await execRun(`UPDATE fulfillment_items SET status='delivered', locked_until=NULL WHERE id=? AND locked_until=?`, itemId, leaseFence);
      }
      return true;
    }
    throw new Error(`Unknown fulfillment mode: ${mode}`);
  } catch (error) {
    const errMsg = (error instanceof Error ? error.message : "Unknown delivery error").slice(0, 500);
    // A lost lease is not a delivery failure: the new owner proceeds, and
    // this worker must not consume the retry budget or overwrite its error.
    if (errMsg === "lease_lost_during_delivery") return false;
    if (errMsg.startsWith("inventory_mismatch")) {
      await execRun(
        `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
         next_attempt_at=datetime('now', '+60 minutes'), updated_at=datetime('now') WHERE id=? AND locked_until=?`,
        errMsg, itemId, leaseFence,
      ).catch(() => undefined);
      return false;
    }
    await scheduleItemRetry(itemId, errMsg, leaseFence, database);
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
    // Web has no push channel: a web item can only settle via an explicit
    // admin handover (recorded through the admin orders UI, which writes
    // the credential into admin_note and flips the item to delivered).
    // Auto-delivery must NEVER push it — and must never spin forever in
    // retry either. Mark it manual_required immediately so the order
    // surfaces in the admin handover queue with a clear action.
    throw new Error("web_channel_requires_manual_handover:serahkan manual via admin_note");
  }
  const sendResult = await sendMessage({
    chat_id: target,
    text: deliveryMessage(plaintext),
    parse_mode: "HTML",
  });
  if (!sendResult.ok) throw new Error(sendResult.description || "Telegram send failed");
}

async function scheduleItemRetry(itemId: number, error: string, leaseFence?: string, database: DatabaseAccess = createDatabaseAccess()): Promise<void> {
  const { queryFirst, execRun } = database;
  const item = await queryFirst(`SELECT attempt_count, locked_until FROM fulfillment_items WHERE id=?`, itemId);
  const attempts = Number(item?.attempt_count ?? 0);
  // Fence: never touch a row whose lease moved on (a newer worker owns it).
  const fenceSql = leaseFence ? ` AND locked_until=?` : ``;
  const fenceArgs = leaseFence ? [leaseFence] : [];
  if (attempts >= MAX_ATTEMPTS) {
    await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?${fenceSql}`,
      error, itemId, ...fenceArgs,
    );
    return;
  }
  const delayMinutes = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)];
  await execRun(
    `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
     next_attempt_at=datetime('now', '+${delayMinutes} minutes'), updated_at=datetime('now') WHERE id=?${fenceSql}`,
    error, itemId, ...fenceArgs,
  );
}

async function findReservedForOrderVariant(
  orderCode: string,
  productId: number,
  variantId: number | null, database: DatabaseAccess = createDatabaseAccess()
): Promise<Row | null | undefined> {
  const { queryFirst, isD1Mode } = database;
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
  // rows keep their progress. A materialization failure is NOT success:
  // without one row per ordered line the order must not proceed to
  // delivered, so bail out and let the next run retry (review R2).
  try {
    await ensureFulfillmentItems(order);
  } catch {
    return false;
  }
  const materialized = await queryAll(
    `SELECT product_id, variant_id FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`,
    orderCode,
  ).catch(() => [] as Row[]);
  const orderedLines = parseOrderItems(order.items);
  const materializationComplete =
    materialized.length === orderedLines.length
    && orderedLines.every((line, index) =>
      Number(materialized[index]?.product_id) === Number(line.product_id)
      && Number(materialized[index]?.variant_id ?? 0) === Number(line.variant_id ?? 0),
    );
  if (!materializationComplete) return false;

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
      ? (allItemsDelivered(itemRows) ? "delivered" : "manual_required")
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

/** Create/read an orphan's durable job in three statements. Item materialization
 * and delivery are separate bounded steps in processJobItems on subsequent work. */
export async function reconcileOrphanLight(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  // Create the durable queue entry FIRST. Materialization resumes in small
  // units via processJobItems; it must never happen under a flat orphan cost.
  const order = await database.queryFirst(`SELECT * FROM orders WHERE code=? AND status='lunas' AND payment_status='paid'`, orderCode);
  if (!order) return false;
  const items = parseOrderItems(order.items);
  if (!items.length) return false;
  await createFulfillmentJob(orderCode, null, "queued", Number(order.variant_id || items[0].variant_id || 0) || null,
    String(order.sales_channel || "telegram"), database);
  return Boolean(await database.queryFirst(`SELECT id FROM fulfillment_jobs WHERE order_code=?`, orderCode));
}

export const COST_PER_ORPHAN_LIGHT = 3;

/** Repair historical job/order splits without sending credentials again. */
export async function reconcileSettledJobs(limit = 2, database: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  if (!database.canSpend(1)) return 0;
  const orders = await database.queryAll(
    `SELECT o.*, fj.id AS job_id FROM orders o JOIN fulfillment_jobs fj ON fj.order_code=o.code
     WHERE o.status='lunas' AND o.payment_status='paid' AND fj.status='delivered'
       AND COALESCE(o.fulfillment_status,'none') NOT IN ('delivered','manual_required') LIMIT ?`, limit,
  );
  let repaired = 0;
  for (const order of orders) {
    if (!database.canSpend(4)) break;
    const rows = await database.queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, order.code);
    const complete = fulfillmentLineMismatches(order.items, rows).length === 0;
    const aggregate = complete && allItemsDelivered(rows) ? "delivered" : "manual_required";
    const d1 = database.d1;
    if (d1) await d1.batch([
      d1.prepare(`UPDATE orders SET fulfillment_status=?,updated_at=datetime('now') WHERE code=?
        AND COALESCE(fulfillment_status,'none') NOT IN ('delivered','manual_required')
        AND EXISTS(SELECT 1 FROM fulfillment_jobs WHERE id=? AND status='delivered')`).bind(aggregate, order.code, order.job_id),
      d1.prepare(`UPDATE fulfillment_jobs SET status=?,last_error=?,updated_at=datetime('now') WHERE id=? AND status='delivered'`)
        .bind(complete && allItemsSettled(rows) ? "delivered" : "manual_required", complete ? null : "fulfillment_manifest_mismatch", order.job_id),
    ]);
    else await database.execRun(`UPDATE orders SET fulfillment_status=? WHERE code=?`, aggregate, order.code);
    repaired++;
  }
  return repaired;
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
 * Fence (review R4): orders whose fulfillment already settled (delivered /
 * manual_required AND every item row delivered) are SKIPPED — a deleted job
 * row is history, not work. Without this fence the reconciler would mint a
 * fresh job and the requeue path could resend secrets already handed out.
 *
 * Idempotency: ensureFulfillmentForPaidOrder inserts exactly one job row
 * (UNIQUE order_code); already-delivered orders are skipped by callers that
 * check fulfillment_status, and processJob claims each job via CAS, so a
 * retry or a recovered worker reuses progress instead of resending what
 * already shipped. No singular-delivery promise is made about the provider:
 * after an ambiguous crash the retry budget bounds redelivery; reconcile
 * against provider logs when in doubt (see releaseStaleJobs).
 */
export async function reconcileMissingFulfillmentJobs(limit = 8): Promise<number> {
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
      // Fence: settled orders (delivered/manually handed over, all items
      // delivered) need NO job — skip instead of resurrecting work that
      // could resend. Deliberately separate queries (not JOIN) so a read
      // failure fails OPEN toward healing rather than silently skipping.
      const settled = await queryFirst(
        `SELECT fulfillment_status FROM orders WHERE code=?`, String(orphan.code),
      ).catch(() => null);
      const agg = String(settled?.fulfillment_status ?? "");
      if (agg === "delivered" || agg === "manual_required") {
        const open = await queryFirst(
          `SELECT id FROM fulfillment_items WHERE order_code=? AND status NOT IN ('delivered','failed','manual_required')`,
          String(orphan.code),
        ).catch(() => ({ id: 1 }));
        if (!open) continue; // truly settled — leave history alone
      }
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
export async function backfillMissingFulfillmentItems(limit = 8): Promise<number> {
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
 *
 * JOIN sudah membawa kolom order yang dibutuhkan processJob (issue #14),
 * sehingga cron tidak perlu query order + produk per job (N+1) — cukup
 * memakai baris yang sudah ada. Default limit diselaraskan ke BATCH_LIMIT
 * cron (8) agar satu run tidak menembus 50 query/invocation D1 Free.
 */
export async function getDueJobs(limit = 8, database: DatabaseAccess = createDatabaseAccess()): Promise<Row[]> {
  const { queryAll, isD1Mode } = database;
  if (isD1Mode()) {
    return queryAll(
      `SELECT fj.*, o.telegram_chat_id, o.telegram_user_id, o.subtotal, o.code as order_code_ref
       FROM fulfillment_jobs fj
       JOIN orders o ON o.code = fj.order_code
       WHERE fj.status IN ('queued','retry')
       AND o.status='lunas' AND o.payment_status='paid'
       AND (fj.locked_until IS NULL OR datetime(fj.locked_until) < datetime('now'))
       AND datetime(fj.next_attempt_at) <= datetime('now')
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
 * Release stale locks (jobs AND items stuck in 'sending' past their lock —
 * review R4: previously only the job row recovered while the item row stayed
 * `sending` forever, so the next run sent nothing).
 *
 * Recovery rules:
 * - Lease active → never stolen (CAS on datetime(locked_until)).
 * - Lease expired → row returns to retry with its progress intact
 *   (delivered rows untouched, attempt_count preserved for the retry
 *   budget, next_attempt_at due immediately so recovery does not wait out
 *   a backoff for a worker that is already dead).
 * - The item recovery is fenced by the job row: an item is only released
 *   when its parent job is itself being released or already retryable
 *   (queued/retry). A `sending` item under a `delivered` job is left alone
 *   — the job finished, the item row is historical.
 * - Unknown provider outcome is explicit: recovery CANNOT know whether the
 *   dead worker's send reached Telegram/WhatsApp before dying. Recovered
 *   rows carry last_error='stale_lock_recovered:delivery_outcome_unknown'
 *   so the admin can reconcile against provider logs; resend is bounded by
 *   the normal attempt budget and makes no singular-delivery promise.
 */
export async function releaseStaleJobs(database: DatabaseAccess = createDatabaseAccess()): Promise<number> {
  const { execRun, isD1Mode } = database;
  if (isD1Mode()) {
    const jobs = await execRun(
      `UPDATE fulfillment_jobs SET status='retry', locked_until=NULL, updated_at=datetime('now')
       WHERE status='sending' AND datetime(locked_until) < datetime('now')`,
    );
    const items = await execRun(
      `UPDATE fulfillment_items
       SET status='retry', locked_until=NULL,
           next_attempt_at=datetime('now'),
           last_error='stale_lock_recovered:delivery_outcome_unknown',
           updated_at=datetime('now')
       WHERE status='sending' AND datetime(locked_until) < datetime('now')
         AND EXISTS(
           SELECT 1 FROM fulfillment_jobs fj
           WHERE fj.order_code=fulfillment_items.order_code
             AND fj.status IN ('queued','retry','sending')
         )`,
    );
    return (jobs.changes ?? 0) + (items.changes ?? 0);
  }

  let count = 0;
  const now = new Date();
  for (const job of getJobsMem()) {
    if (job.status === "sending" && job.locked_until && new Date(String(job.locked_until)) < now) {
      job.status = "retry";
      job.locked_until = null;
      count++;
    }
  }
  return count;
}

/**
 * Release stale per-item locks held in memory (dev fallback parity).
 * Production D1 path is folded into releaseStaleJobs above.
 */
export function releaseStaleItemsMem(rows: Row[]): number {
  const now = new Date();
  let count = 0;
  for (const row of rows) {
    if (String(row.status) === "sending" && row.locked_until && new Date(String(row.locked_until)) < now) {
      row.status = "retry";
      row.locked_until = null;
      row.next_attempt_at = new Date().toISOString();
      row.last_error = "stale_lock_recovered:delivery_outcome_unknown";
      count++;
    }
  }
  return count;
}

/**
 * Catat penyerahan manual satu item oleh admin (review R3/D — tindakan
 * handover yang nyata, bukan sekadar menulis admin_note).
 *
 * Kontrak:
 * - Hanya untuk order lunas (status='lunas', payment_status='paid').
 * - Item harus milik order tersebut (order_code + item_index cocok) dan
 *   masih menunggu penyerahan (status manual_required/retry/queued).
 * - Idempoten: item yang sudah delivered → true tanpa efek samping
 *   (klik dua kali tidak menggandakan pengiriman/konsumsi stok).
 * - Status pembayaran TIDAK diubah — hanya status pengiriman.
 * - Inventory unique yang diserahkan manual ikut ditandai delivered agar
 *   tidak dikirim ganda oleh retry otomatis; stok varian tidak dipotong
 *   lagi (sudah dipotong saat checkout).
 * - Jejak audit: admin_note order ditambah + last_error item mencatat
 *   siapa menyerahkan dan kapan.
 * Mengembalikan true bila item kini delivered (termasuk sudah delivered
 * sebelumnya), false bila prasyarat tidak terpenuhi.
 */
/**
 * Hasil handover yang jujur (RR3-02/07): bukan boolean buta, melainkan
 * status yang membedakan "item tercatat" dari "seluruh order tuntas" dan
 * dari "manifest belum lengkap".
 *
 * RR4-03: tambah `reconcile_failed` — item sudah delivered tetapi penulisan
 * lanjutan (agregat/audit) masih gagal SETELAH dicoba ulang. Cabang
 * delivered dan kalah-CAS WAJIB mempropagasi ini (bukan void healed).
 */
export type ManualHandoverResult =
  | { ok: true; complete: boolean }
  | { ok: false; reason: "not_found" | "not_paid" | "bad_state" | "incomplete_manifest" | "storage_error" | "reconcile_failed" };

/**
 * Cocokkan baris fulfillment terhadap manifest order (RR3-02): setiap baris
 * order (product_id + variant_id + qty) HARUS punya baris fulfillment
 * dengan identitas yang sama. Mengembalikan daftar index yang hilang/salah.
 *
 * RR4-04: cocokkan JUMLAH UNIT juga. Kontrak representasi: SATU baris
 * fulfillment mewakili SELURUH qty baris order itu (kolom qty disalin dari
 * order saat materialisasi — bukan dipecah per unit). Bila baris fulfillment
 * qty-nya lebih kecil dari kebutuhan order (data tidak konsisten, mis.
 * qty 2 vs 1), baris itu DILAPORKAN hilang agar agregat tidak delivered
 * sebelum kekurangan unit diselesaikan — bukan ditimpa qty-nya (fakta
 * pengiriman tidak boleh dipalsukan) dan bukan mereset item benar.
 */
export type FulfillmentLineMismatch = { index: number; kind: "missing" | "identity" | "quantity" | "unexpected"; expectedQty: number; actualQty: number };
export async function findMissingFulfillmentLines(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<number[]> {

  return (await findFulfillmentLineMismatches(orderCode, database)).map((m) => m.index);
}
export async function findFulfillmentLineMismatches(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<FulfillmentLineMismatch[]> {
  const { queryAll, queryFirst } = database;
  const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode);
  if (!order) return [];
  const rows = await queryAll(
    `SELECT item_index, product_id, variant_id, qty FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode,
  );
  return fulfillmentLineMismatches(order.items, rows);
}

export function fulfillmentLineMismatches(rawItems: unknown, rows: Row[]): FulfillmentLineMismatch[] {
  const expected = parseOrderItems(rawItems);
  const byIndex = new Map(rows.map((r) => [Number(r.item_index), r]));
  const missing: FulfillmentLineMismatch[] = [];
  expected.forEach((line, index) => {
    const row = byIndex.get(index);
    if (!row) { missing.push({ index, kind: "missing", expectedQty: Math.max(1, Number(line.qty || 1)), actualQty: 0 }); return; }
    if (Number(row.product_id) !== Number(line.product_id)
      || Number(row.variant_id ?? 0) !== Number(line.variant_id ?? 0)) {
      missing.push({ index, kind: "identity", expectedQty: Math.max(1, Number(line.qty || 1)), actualQty: Number(row.qty ?? 0) });
      return;
    }
    const need = Number(line.qty);
    const have = Number(row.qty);
    // Nilai legacy tidak valid (qty 0/negatif/NaN → have 0) juga short.
    if (!Number.isSafeInteger(need) || need < 1 || !Number.isSafeInteger(have) || have !== need) {
      missing.push({ index, kind: "quantity", expectedQty: need, actualQty: have });
    }
  });
  for (const row of rows) {
    const index = Number(row.item_index);
    if (!Number.isInteger(index) || index < 0 || index >= expected.length) {
      missing.push({ index, kind: "unexpected", expectedQty: 0, actualQty: Number(row.qty) });
    }
  }
  return missing;
}

/**
 * Selesaikan penulisan handover yang tertunda secara idempoten (RR3-07):
 * inventory → audit → agregat order → job. Tiap langkah aman diulang
 * (guard status/CAS); tidak ada pengiriman ulang kredensial dan tidak ada
 * pemotongan stok ganda. Mengembalikan true bila seluruh efek samping kini
 * konsisten (atau sudah konsisten sebelumnya).
 *
 * RR4-03: stempel audit STABIL per fakta handover — pemanggil memberikan
 * stamp kejadian awal; retry memakai stamp yang SAMA sehingga tidak tercipta
 * marker audit kedua. Marker recovery (bila perlu) dicatat terpisah dengan
 * awalan berbeda, bukan sebagai handover baru.
 */
/** Reconcile side effects from the ORIGINAL recorded fact. A literal prefix is
 * the event identity; unlike LIKE it has no pattern-length/wildcard semantics. */
export async function reconcileHandoverWrites(
  orderCode: string, itemIndex: number, reviewer: string, stamp: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<boolean> {
  const { queryFirst, queryAll, execRun } = database;
  const item = await queryFirst(
    `SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?`, orderCode, itemIndex,
  );
  if (!item || String(item.status) !== "delivered") return false;
  const noteRow = await queryFirst(`SELECT admin_note FROM orders WHERE code=?`, orderCode);
  const prefix = `handover item ${itemIndex} oleh `;
  const oldNote = String(noteRow?.admin_note ?? "");
  const recorded = String(item.last_error ?? "").match(/^manual_handover:([^:]+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  // A legacy delivered row without a handover fact is recorded as recovery,
  // not attributed to the current admin as a new physical handover.
  const actor = recorded?.[1] ?? "legacy (pelaku tidak tercatat)";
  const occurredAt = recorded?.[2] ?? String(item.updated_at ?? "waktu tidak tercatat");
  const marker = ` [${prefix}${actor} ${occurredAt}]`;
  const missing = await findMissingFulfillmentLines(orderCode, database);
  const remaining = await queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
  const complete = missing.length === 0 && allItemsDelivered(remaining);
  const aggregate = complete ? "delivered" : "manual_required";
  const statements: { sql: string; params: unknown[] }[] = [];
  if (Number(item.inventory_id || 0) > 0) statements.push({
    sql: `UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
          WHERE id=? AND status='reserved' AND order_code=?`, params: [Number(item.inventory_id), orderCode],
  });
  if (!oldNote.includes(prefix)) statements.push({
    sql: `UPDATE orders SET admin_note=COALESCE(admin_note,'') || ?, updated_at=datetime('now')
          WHERE code=? AND instr(COALESCE(admin_note,''), ?)=0`, params: [marker, orderCode, prefix],
  });
  statements.push({ sql: `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`, params: [aggregate, orderCode] });
  if (complete) statements.push({
    sql: `UPDATE fulfillment_jobs SET status='delivered', locked_until=NULL, item_cursor=NULL, updated_at=datetime('now')
          WHERE order_code=? AND status!='delivered'`, params: [orderCode],
  });
  try {
    if (database.d1) await database.d1.batch(statements.map(({ sql, params }) => database.d1!.prepare(sql).bind(...params)));
    else for (const statement of statements) await execRun(statement.sql, ...statement.params);
  } catch { return false; }
  return true;
}

/** Compatibility helper: use the winning item's durable timestamp. */
export async function readHandoverStamp(
  orderCode: string, itemIndex: number, reviewer: string, fallbackStamp: string,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<string> {
  const item = await database.queryFirst(`SELECT last_error, updated_at FROM fulfillment_items WHERE order_code=? AND item_index=?`, orderCode, itemIndex);
  return String(item?.last_error ?? "").match(/^manual_handover:[^:]+:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/)?.[1]
    ?? String(item?.updated_at ?? fallbackStamp);
}

export async function recordManualHandover(
  orderCode: string,
  itemIndex: number,
  adminEmail: string,
  note?: string | null,
): Promise<boolean> {
  const result = await recordManualHandoverDetailed(orderCode, itemIndex, adminEmail, note);
  return result.ok;
}

/**
 * Catat penyerahan manual satu item oleh admin (review R3/D — tindakan
 * handover yang nyata, bukan sekadar menulis admin_note).
 *
 * Kontrak:
 * - Hanya untuk order lunas (status='lunas', payment_status='paid').
 * - Item harus milik order tersebut (order_code + item_index cocok) dan
 *   masih menunggu penyerahan (status manual_required/retry/queued).
 * - Idempoten: item yang sudah delivered → sukses tanpa efek samping
 *   (klik dua kali tidak menggandakan pengiriman/konsumsi stok).
 * - Status pembayaran TIDAK diubah — hanya status pengiriman.
 * - Inventory unique yang diserahkan manual ikut ditandai delivered agar
 *   tidak dikirim ganda oleh retry otomatis; stok varian tidak dipotong
 *   lagi (sudah dipotong saat checkout).
 * - Jejak audit: admin_note order ditambah + last_error item mencatat
 *   siapa menyerahkan dan kapan.
 *
 * RR3-02: sebelum menyelesaikan agregat, manifest dicocokkan terhadap
 * order (item_index, product_id, variant_id, jumlah). Bila materialisasi
 * terputus (baris hilang/salah), agregat TIDAK delivered — handover
 * mencoba memulihkan baris yang hilang secara idempoten
 * (ensureFulfillmentItems) dan melaporkan `incomplete_manifest` bila
 * masih belum lengkap.
 *
 * RR3-07: seluruh penulisan lanjutan (inventory, audit, agregat order,
 * job) diverifikasi; bila salah satunya gagal, handover mengembalikan
 * `storage_error` (JANGAN klaim sukses) dan pemanggilan ulang
 * menyelesaikan sisanya via reconcileHandoverWrites tanpa efek ganda.
 *
 * Mengembalikan { ok:true } bila item kini delivered (termasuk sudah
 * delivered sebelumnya), { ok:false, reason } bila prasyarat tak terpenuhi.
 */
export async function recordManualHandoverDetailed(
  orderCode: string,
  itemIndex: number,
  adminEmail: string,
  note?: string | null, database: DatabaseAccess = createDatabaseAccess()
): Promise<ManualHandoverResult> {
  const { queryAll, queryFirst, execRun } = database;
  const reviewer = String(adminEmail || "").trim().slice(0, 120);
  if (!reviewer) return { ok: false, reason: "not_found" };
  const order = await queryFirst(
    `SELECT code, status, payment_status FROM orders WHERE code=?`,
    orderCode,
  );
  if (!order) return { ok: false, reason: "not_found" };
  if (String(order.status) !== "lunas" || String(order.payment_status) !== "paid") {
    return { ok: false, reason: "not_paid" };
  }
  const item = await queryFirst(
    `SELECT * FROM fulfillment_items WHERE order_code=? AND item_index=?`,
    orderCode, itemIndex,
  );
  if (!item) return { ok: false, reason: "not_found" };
  const firstStamp = new Date().toISOString();
  if (String(item.status) === "delivered") {
    // Idempoten TETAPI sembuhkan agregat yang tertinggal (RR3-07): item
    // delivered + agregat manual_required = penulisan lanjutan yang gagal
    // dan belum pernah dicoba ulang.
    // RR4-03: hasil reconcile DIPROPAGASI — bila DB masih gagal, kembalikan
    // reconcile_failed (JANGAN klaim sukses). Stamp stabil: baca marker yang
    // sudah tercatat untuk item ini (fakta awal), bukan stamp baru.
    const stableStamp = await readHandoverStamp(orderCode, itemIndex, reviewer, firstStamp, database);
    const healed = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stableStamp, database).catch(() => false);
    if (!healed) return { ok: false, reason: "reconcile_failed" };
    if ((await findMissingFulfillmentLines(orderCode, database)).length) return { ok: false, reason: "incomplete_manifest" };
    const remaining = await database.queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
    return { ok: true, complete: allItemsDelivered(remaining) };
  }
  if (!["manual_required", "retry", "queued", "failed"].includes(String(item.status))) {
    return { ok: false, reason: "bad_state" };
  }
  const stamp = firstStamp;
  const audit = `manual_handover:${reviewer}:${stamp}${note ? `:${String(note).slice(0, 200)}` : ""}`;
  try {
    const flipped = await execRun(
      `UPDATE fulfillment_items
       SET status='delivered', delivered_message_id='manual', locked_until=NULL,
           last_error=?, updated_at=datetime('now')
       WHERE order_code=? AND item_index=? AND status IN ('manual_required','retry','queued','failed')`,
      audit, orderCode, itemIndex,
    );
    if (!flipped.changes) {
      // Kalah race dengan worker lain yang baru menyelesaikan — baca ulang:
      // bila kini delivered, anggap sukses idempoten TETAPI tetap sembuhkan
      // agregat; kegagalan reconcile dipropagasi (RR4-03).
      const fresh = await queryFirst(
        `SELECT status FROM fulfillment_items WHERE order_code=? AND item_index=?`,
        orderCode, itemIndex,
      );
      if (String(fresh?.status) === "delivered") {
        const healed = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stamp, database).catch(() => false);
        if (!healed) return { ok: false, reason: "reconcile_failed" };
        if ((await findMissingFulfillmentLines(orderCode, database)).length) return { ok: false, reason: "incomplete_manifest" };
        const remaining = await database.queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode);
        return { ok: true, complete: allItemsDelivered(remaining) };
      }
      return { ok: false, reason: "bad_state" };
    }
  } catch {
    return { ok: false, reason: "storage_error" };
  }
  // RR3-02: pulihkan baris yang hilang sebelum menilai agregat — INSERT
  // yang tertelan di tengah (partial materialization) tidak boleh membuat
  // order dinyatakan selesai.
  try {
    const fullOrder = await queryFirst(`SELECT * FROM orders WHERE code=?`, orderCode);
    if (fullOrder) await ensureFulfillmentItems(fullOrder, database).catch(() => {});
  } catch { /* lanjut ke penilaian manifest di bawah */ }
  const missing = await findMissingFulfillmentLines(orderCode, database);
  if (missing.length > 0) {
    // Manifest belum lengkap: item ini TETAP tercatat delivered (fakta
    // penyerahan tidak dihapus), tetapi agregat TIDAK boleh delivered.
    // Baris yang hilang tetap queued/retry untuk pemulihan berikutnya.
    try {
      await execRun(
        `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
    } catch { return { ok: false, reason: "storage_error" }; }
    return { ok: false, reason: "incomplete_manifest" };
  }
  // RR3-07: selesaikan seluruh penulisan lanjutan; kegagalan di sini =
  // storage_error yang jujur (bukan sukses palsu), dan retry berikutnya
  // menyembuhkan via reconcileHandoverWrites.
  const reconciled = await reconcileHandoverWrites(orderCode, itemIndex, reviewer, stamp, database).catch(() => false);
  if (!reconciled) return { ok: false, reason: "storage_error" };
  const remaining = await queryAll(
    `SELECT status FROM fulfillment_items WHERE order_code=?`,
    orderCode,
  ).catch(() => [] as Row[]);
  const complete = remaining.length > 0 && remaining.every((row) => String(row.status) === "delivered");
  return { ok: true, complete };
}
