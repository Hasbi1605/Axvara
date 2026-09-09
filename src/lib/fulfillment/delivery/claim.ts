// src/lib/fulfillment/delivery/claim.ts — Siklus hidup job: buat, klaim, lease, retry, recovery.
//
// MENGAPA dipisah: seluruh transisi status job (queued→sending→retry/failed/
// delivered) dan disiplin lease/fencing (CAS locked_until) adalah satu domain
// konkurensi tersendiri. Mengumpulkannya membuat aturan "lease aktif tak pernah
// direbut" dan normalisasi datetime() lintas format waktu (issue #7) mudah
// diaudit tanpa tercampur logika pengiriman kredensial. NOL perubahan perilaku:
// SQL, urutan statement, dan pesan tetap identik dengan versi monolit.

import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import type { FencedJobMutation, Row } from "./types";
import { getJobsMem, MAX_ATTEMPTS, RETRY_DELAYS } from "./types";

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
export async function writeJobOutcome(
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
