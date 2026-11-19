import { createDatabaseAccess, type DatabaseAccess } from '@/lib/db-access';
import { BROADCAST_QUEUE_MODE_KEY, isBroadcastQueueModeOff } from './queue';
import { sendBroadcast, type SendOutcome } from './sender';
import type { BroadcastChannel, BroadcastSnapshot } from './model';

// Workers Paid: inter-recipient 250ms (4/s) -> 100ms (10/s), still well under
// Telegram's ~30 msg/s global limit. Same-chat pacing (sender.ts) stays 300ms.
export const TELEGRAM_RECIPIENT_PACE_MS = 100;
export const EMAIL_RECIPIENT_PACE_MS = 650;

const GLOBAL_LEASE_MS = 60_000;
const DELIVERY_LEASE_MS = 90_000;
const MAX_INLINE_PACE_WAIT_MS = 1_500;
const DEFAULT_BACKSTOP_LIMIT = 150;
const MAX_BACKSTOP_LIMIT = 200;
const DEFAULT_BACKSTOP_TIME_BUDGET_MS = 40_000;
const DEFAULT_QUEUE_BATCH_TIME_BUDGET_MS = 38_000;

export type ProcessBroadcastsOptions = {
  /**
   * When > 0 (cron backstop while queue mode is active), defer pending
   * telegram/email rows until both updated_at and next_attempt_at are at least
   * queueGraceMs in the past. WhatsApp rows are never deferred.
   */
  queueGraceMs?: number;
};

export type ProcessBroadcastsResult = {
  sent: number;
  unknown: number;
  failed: number;
  skipped: number;
  deferred: number;
};

export type ProcessBroadcastBatchResult = ProcessBroadcastsResult & {
  settled: boolean;
  state: string;
  retrySec?: number;
};

function eligibleSQL(channel: string) {
  if (channel === 'email') {
    return `EXISTS(SELECT 1 FROM newsletter_subscribers s WHERE CAST(s.id AS TEXT)=broadcast_deliveries.recipient_id AND lower(s.email)=broadcast_deliveries.destination AND s.status='active' AND s.unsubscribe_token=broadcast_deliveries.unsubscribe_token)`;
  }
  if (channel === 'telegram') {
    return `EXISTS(SELECT 1 FROM telegram_users t WHERE t.user_id=broadcast_deliveries.recipient_id AND t.chat_id=broadcast_deliveries.destination AND t.is_blocked=0 AND t.broadcast_opt_out=0)`;
  }
  return '1=1';
}

const ELIGIBLE_CASE_SQL = `CASE
  WHEN d.channel='email' THEN EXISTS(SELECT 1 FROM newsletter_subscribers s WHERE CAST(s.id AS TEXT)=d.recipient_id AND lower(s.email)=d.destination AND s.status='active' AND s.unsubscribe_token=d.unsubscribe_token)
  WHEN d.channel='telegram' THEN EXISTS(SELECT 1 FROM telegram_users t WHERE t.user_id=d.recipient_id AND t.chat_id=d.destination AND t.is_blocked=0 AND t.broadcast_opt_out=0)
  ELSE 1
END AS is_eligible`;

function parseSqlTimestampMs(value: unknown): number {
  if (!value) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  if (text.includes('T') || /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    return Date.parse(text) || 0;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
    return Date.parse(text.replace(' ', 'T') + 'Z') || 0;
  }
  return Date.parse(text) || 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function releaseControlLease(
  db: DatabaseAccess,
  token: string,
  telegramAfterIso: string | null,
  emailAfterIso: string | null,
): Promise<void> {
  await db.execRun(
    `UPDATE broadcast_dispatch_control
     SET worker_token=NULL,
         lease_until=NULL,
         telegram_after=CASE
           WHEN ? IS NOT NULL AND (telegram_after IS NULL OR julianday(?) > julianday(telegram_after))
           THEN ? ELSE telegram_after END,
         email_after=CASE
           WHEN ? IS NOT NULL AND (email_after IS NULL OR julianday(?) > julianday(email_after))
           THEN ? ELSE email_after END
     WHERE id=1 AND worker_token=?`,
    telegramAfterIso,
    telegramAfterIso,
    telegramAfterIso,
    emailAfterIso,
    emailAfterIso,
    emailAfterIso,
    token,
  );
}

/**
 * Queue origin processor: processes a bounded slice of delivery IDs for a
 * single campaign with global lease coordination, per-delivery CAS, global
 * Telegram pacing (250ms inter-recipient, 300ms same-chat in sender), and
 * immediate stop + settled:false on 429/retryable deferral.
 */
export async function processBroadcastDeliveryBatch(
  db: DatabaseAccess,
  campaignId: string,
  deliveryIds: readonly number[],
  options: { timeBudgetMs?: number } = {},
): Promise<ProcessBroadcastBatchResult> {
  const out: ProcessBroadcastsResult = { sent: 0, unknown: 0, failed: 0, skipped: 0, deferred: 0 };
  const timeBudgetMs = Math.max(1_000, options.timeBudgetMs ?? DEFAULT_QUEUE_BATCH_TIME_BUDGET_MS);
  const uniqueIds = Array.from(new Set(deliveryIds));
  if (!uniqueIds.length) return { ...out, settled: true, state: 'done' };
  if (!db.getD1()) throw new Error('broadcast_db_unavailable');

  const now = () => new Date().toISOString();
  const started = Date.now();

  const campaign = await db.queryFirst(
    `SELECT c.id, c.status, c.snapshot_json,
            (SELECT value FROM store_settings WHERE key=?) AS queue_mode
     FROM broadcast_campaigns c
     WHERE c.id=?`,
    BROADCAST_QUEUE_MODE_KEY,
    campaignId,
  );
  if (!campaign) return { ...out, settled: true, state: 'campaign_not_found' };
  if (isBroadcastQueueModeOff(campaign.queue_mode)) {
    return { ...out, settled: true, state: 'queue_disabled' };
  }
  const campaignStatus = String(campaign.status);
  if (campaignStatus === 'preparing') {
    return { ...out, settled: false, state: 'campaign_preparing', retrySec: 5 };
  }
  if (campaignStatus !== 'queued') {
    return { ...out, settled: true, state: `campaign_${campaignStatus}` };
  }

  const snapshot = JSON.parse(String(campaign.snapshot_json)) as BroadcastSnapshot;
  const placeholders = uniqueIds.map(() => '?').join(',');

  // Fast path: expired promo slot skips remaining pending rows without taking the global lease.
  if (snapshot.promo?.expiresAt && Date.now() >= parseSqlTimestampMs(snapshot.promo.expiresAt)) {
    const expired = await db.execRun(
      `UPDATE broadcast_deliveries
       SET status='skipped', last_error='promo_slot_expired', lease_until=NULL, updated_at=?
       WHERE campaign_id=? AND status='pending' AND id IN (${placeholders})`,
      now(),
      campaignId,
      ...uniqueIds,
    );
    out.skipped += Number(expired.changes ?? 0);
    await db.execRun(
      `UPDATE broadcast_campaigns SET status='completed'
       WHERE id=? AND status='queued'
         AND NOT EXISTS(SELECT 1 FROM broadcast_deliveries d WHERE d.campaign_id=broadcast_campaigns.id AND d.status IN ('pending','sending'))`,
      campaignId,
    );
    return { ...out, settled: true, state: 'promo_expired' };
  }

  let rows = await db.queryAll(
    `SELECT d.*, ${ELIGIBLE_CASE_SQL}
     FROM broadcast_deliveries d
     WHERE d.campaign_id=? AND d.id IN (${placeholders})
     ORDER BY d.id`,
    campaignId,
    ...uniqueIds,
  );

  const hasPending = rows.some((r) => r.status === 'pending' && r.channel !== 'whatsapp');
  const hasExpiredSending = rows.some(
    (r) =>
      r.status === 'sending' &&
      r.channel !== 'whatsapp' &&
      r.lease_until &&
      parseSqlTimestampMs(r.lease_until) <= Date.now(),
  );
  const hasActiveSending = rows.some(
    (r) =>
      r.status === 'sending' &&
      r.channel !== 'whatsapp' &&
      (!r.lease_until || parseSqlTimestampMs(r.lease_until) > Date.now()),
  );

  if (!hasPending && !hasExpiredSending) {
    if (hasActiveSending) {
      return { ...out, settled: true, state: 'already_claimed' };
    }
    return { ...out, settled: true, state: 'done' };
  }

  const token = crypto.randomUUID();
  const lock = await db.execRun(
    `UPDATE broadcast_dispatch_control SET worker_token=?, lease_until=?
     WHERE id=1 AND (lease_until IS NULL OR julianday(lease_until)<=julianday(?))`,
    token,
    new Date(Date.now() + GLOBAL_LEASE_MS).toISOString(),
    now(),
  );
  if (!lock.changes) {
    const holder = await db.queryFirst('SELECT lease_until FROM broadcast_dispatch_control WHERE id=1');
    const remainingMs = parseSqlTimestampMs(holder?.lease_until) - Date.now();
    const retrySec = remainingMs > 0 ? Math.max(10, Math.min(45, Math.ceil(remainingMs / 1000))) : 15;
    return { ...out, settled: false, state: 'lease_busy', retrySec };
  }

  let telegramAfterMs = 0;
  let emailAfterMs = 0;
  let touchedTelegram = false;
  let touchedEmail = false;
  let rateLimitedRetrySec: number | null = null;
  let hasRemainingPending = false;
  let earliestFutureSec: number | null = null;

  try {
    const control = await db.queryFirst(
      'SELECT email_after, telegram_after FROM broadcast_dispatch_control WHERE id=1 AND worker_token=?',
      token,
    );
    if (!control) {
      return { ...out, settled: false, state: 'lease_lost', retrySec: 10 };
    }
    telegramAfterMs = parseSqlTimestampMs(control.telegram_after);
    emailAfterMs = parseSqlTimestampMs(control.email_after);

    if (hasExpiredSending) {
      const currentIso = now();
      const recovered = await db.execRun(
        `UPDATE broadcast_deliveries
         SET status=CASE WHEN channel='email' AND julianday(first_attempt_at)>julianday(?,'-23 hours') THEN 'pending' ELSE 'unknown' END,
             last_error='delivery_interrupted', lease_until=NULL, next_attempt_at=?, updated_at=?
         WHERE campaign_id=? AND id IN (${placeholders}) AND status='sending' AND julianday(lease_until)<=julianday(?)`,
        currentIso,
        currentIso,
        currentIso,
        campaignId,
        ...uniqueIds,
        currentIso,
      );
      if (Number(recovered.changes ?? 0) > 0) {
        rows = await db.queryAll(
          `SELECT d.*, ${ELIGIBLE_CASE_SQL}
           FROM broadcast_deliveries d
           WHERE d.campaign_id=? AND d.id IN (${placeholders})
           ORDER BY d.id`,
          campaignId,
          ...uniqueIds,
        );
      }
    }

    for (const row of rows) {
      if (row.status !== 'pending' || row.channel === 'whatsapp') continue;
      const channel = row.channel as BroadcastChannel;

      if (snapshot.promo?.expiresAt && Date.now() >= parseSqlTimestampMs(snapshot.promo.expiresAt)) {
        const expired = await db.execRun(
          `UPDATE broadcast_deliveries
           SET status='skipped', last_error='promo_slot_expired', lease_until=NULL, updated_at=?
           WHERE campaign_id=? AND status='pending' AND id IN (${placeholders})`,
          now(),
          campaignId,
          ...uniqueIds,
        );
        out.skipped += Number(expired.changes ?? 0);
        break;
      }

      if (
        channel === 'email' &&
        row.first_attempt_at &&
        Date.now() - parseSqlTimestampMs(row.first_attempt_at) >= 23 * 3_600_000
      ) {
        await db.execRun(
          "UPDATE broadcast_deliveries SET status='unknown', last_error='email_retry_window_elapsed', updated_at=? WHERE id=? AND status='pending'",
          now(),
          row.id,
        );
        out.unknown++;
        continue;
      }

      if (Number(row.is_eligible) === 0) {
        await db.execRun(
          "UPDATE broadcast_deliveries SET status='skipped', last_error='recipient_unsubscribed', updated_at=? WHERE id=? AND status='pending'",
          now(),
          row.id,
        );
        out.skipped++;
        continue;
      }

      const rowWaitMs = parseSqlTimestampMs(row.next_attempt_at) - Date.now();
      if (rowWaitMs > MAX_INLINE_PACE_WAIT_MS) {
        hasRemainingPending = true;
        const sec = Math.ceil(rowWaitMs / 1000);
        earliestFutureSec = earliestFutureSec === null ? sec : Math.min(earliestFutureSec, sec);
        continue;
      }

      const channelAfterMs = channel === 'telegram' ? telegramAfterMs : channel === 'email' ? emailAfterMs : 0;
      const channelWaitMs = channelAfterMs - Date.now();
      if (channelWaitMs > MAX_INLINE_PACE_WAIT_MS) {
        rateLimitedRetrySec = Math.max(rateLimitedRetrySec ?? 0, Math.ceil(channelWaitMs / 1000));
        hasRemainingPending = true;
        break;
      }

      const waitMs = Math.max(0, rowWaitMs, channelWaitMs);
      if (Date.now() - started + waitMs >= timeBudgetMs) {
        hasRemainingPending = true;
        break;
      }
      if (waitMs > 0) {
        await sleep(waitMs);
        if (snapshot.promo?.expiresAt && Date.now() >= parseSqlTimestampMs(snapshot.promo.expiresAt)) {
          const expired = await db.execRun(
            `UPDATE broadcast_deliveries
             SET status='skipped', last_error='promo_slot_expired', lease_until=NULL, updated_at=?
             WHERE campaign_id=? AND status='pending' AND id IN (${placeholders})`,
            now(),
            campaignId,
            ...uniqueIds,
          );
          out.skipped += Number(expired.changes ?? 0);
          break;
        }
      }

      const claimIso = now();
      const claim = await db.execRun(
        `UPDATE broadcast_deliveries
         SET status='sending', attempts=attempts+1,
             first_attempt_at=COALESCE(first_attempt_at,?),
             lease_until=?, updated_at=?
         WHERE id=? AND campaign_id=? AND status='pending'
           AND EXISTS(SELECT 1 FROM broadcast_campaigns c WHERE c.id=campaign_id AND c.status='queued')
           AND ${eligibleSQL(channel)}`,
        claimIso,
        new Date(Date.now() + DELIVERY_LEASE_MS).toISOString(),
        claimIso,
        row.id,
        campaignId,
      );
      if (!claim.changes) {
        // Safely mark freshly opted-out/unsubscribed rows skipped without touching claimed/canceled rows.
        const lateSkip = await db.execRun(
          `UPDATE broadcast_deliveries
           SET status='skipped', last_error='recipient_unsubscribed', updated_at=?
           WHERE id=? AND status='pending' AND NOT (${eligibleSQL(channel)})`,
          now(),
          row.id,
        );
        if (lateSkip.changes) out.skipped++;
        continue;
      }

      let result: SendOutcome;
      try {
        result = await sendBroadcast(
          channel,
          {
            campaign_id: String(row.campaign_id),
            recipient_id: String(row.recipient_id),
            destination: String(row.destination),
            unsubscribe_token: String(row.unsubscribe_token || ''),
            provider_id: row.provider_id ? String(row.provider_id) : null,
          },
          snapshot,
        );
      } catch {
        result = { state: 'unknown', error: 'delivery_unknown' };
      }

      if (result.blocked) {
        await db.execRun(
          'UPDATE telegram_users SET is_blocked=1 WHERE user_id=? AND chat_id=?',
          row.recipient_id,
          row.destination,
        );
      }

      let retrySec = 60;
      if (result.state === 'retry') {
        retrySec = Math.max(1, Math.min(86_400, Number(result.retryAfter) || 60));
        const nextAfterMs = Date.now() + retrySec * 1000;
        if (channel === 'telegram') {
          telegramAfterMs = Math.max(telegramAfterMs, nextAfterMs);
          touchedTelegram = true;
        } else if (channel === 'email') {
          emailAfterMs = Math.max(emailAfterMs, nextAfterMs);
          touchedEmail = true;
        }
        const col = channel === 'email' ? 'email_after' : 'telegram_after';
        await db.execRun(
          `UPDATE broadcast_dispatch_control SET ${col}=? WHERE id=1 AND worker_token=?`,
          new Date(nextAfterMs).toISOString(),
          token,
        );
      } else {
        const paceMs = channel === 'email' ? EMAIL_RECIPIENT_PACE_MS : TELEGRAM_RECIPIENT_PACE_MS;
        const nextAfterMs = Date.now() + paceMs;
        if (channel === 'telegram') {
          telegramAfterMs = Math.max(telegramAfterMs, nextAfterMs);
          touchedTelegram = true;
        } else if (channel === 'email') {
          emailAfterMs = Math.max(emailAfterMs, nextAfterMs);
          touchedEmail = true;
        }
      }

      const status = result.state === 'retry' ? 'pending' : result.state;
      await db.execRun(
        `UPDATE broadcast_deliveries
         SET status=?, provider_id=?, last_error=?, lease_until=NULL,
             attempts=attempts-?,
             first_attempt_at=CASE WHEN ? THEN NULL ELSE first_attempt_at END,
             next_attempt_at=?, updated_at=?
         WHERE id=? AND status='sending'`,
        status,
        result.providerId || null,
        result.error || null,
        result.consumeAttempt === false ? 1 : 0,
        result.consumeAttempt === false && !row.first_attempt_at ? 1 : 0,
        new Date(Date.now() + retrySec * 1000).toISOString(),
        now(),
        row.id,
      );

      if (result.state === 'retry') {
        out.deferred++;
        rateLimitedRetrySec = retrySec;
        hasRemainingPending = true;
        break;
      }
      out[result.state]++;
    }

    await db.execRun(
      `UPDATE broadcast_campaigns SET status='completed'
       WHERE id=? AND status='queued'
         AND NOT EXISTS(SELECT 1 FROM broadcast_deliveries d WHERE d.campaign_id=broadcast_campaigns.id AND d.status IN ('pending','sending'))`,
      campaignId,
    );
  } finally {
    await releaseControlLease(
      db,
      token,
      touchedTelegram && telegramAfterMs > 0 ? new Date(telegramAfterMs).toISOString() : null,
      touchedEmail && emailAfterMs > 0 ? new Date(emailAfterMs).toISOString() : null,
    );
  }

  if (rateLimitedRetrySec !== null) {
    return { ...out, settled: false, state: 'rate_limited', retrySec: rateLimitedRetrySec };
  }
  if (hasRemainingPending) {
    const retrySec =
      earliestFutureSec !== null && Number.isFinite(earliestFutureSec)
        ? Math.max(2, Math.min(86_400, earliestFutureSec))
        : 2;
    return { ...out, settled: false, state: 'deadline_yield', retrySec };
  }
  return { ...out, settled: true, state: 'done' };
}

/**
 * Cron backstop worker (Workers Paid). Uncapped by Free-era 8-row/11s limits;
 * uses global lease, per-row CAS, SQL budget, wall-time budget, and optional
 * queueGraceMs so it finishes missed/DLQ deliveries without racing the queue.
 */
export async function processBroadcasts(
  db: DatabaseAccess = createDatabaseAccess(),
  limit = DEFAULT_BACKSTOP_LIMIT,
  timeBudgetMs = DEFAULT_BACKSTOP_TIME_BUDGET_MS,
  options: ProcessBroadcastsOptions = {},
): Promise<ProcessBroadcastsResult> {
  const out: ProcessBroadcastsResult = { sent: 0, unknown: 0, failed: 0, skipped: 0, deferred: 0 };
  if (!db.getD1() || !db.canSpend(7) || timeBudgetMs <= 0) return out;
  const now = () => new Date().toISOString();
  const started = Date.now();
  const queueGraceMs = Math.max(0, Math.floor(options.queueGraceMs ?? 0));
  if (queueGraceMs > 0) {
    const checkNow = now();
    const checkCutoff = new Date(Date.now() - queueGraceMs).toISOString();
    const hasWork = await db.queryFirst(
      `SELECT 1 AS ok WHERE
         EXISTS(SELECT 1 FROM broadcast_deliveries WHERE status='sending' AND julianday(lease_until)<=julianday(?))
         OR EXISTS(
           SELECT 1 FROM broadcast_deliveries d JOIN broadcast_campaigns c ON c.id=d.campaign_id
           WHERE d.status='pending' AND c.status='queued'
             AND (
               (json_extract(c.snapshot_json,'$.promo.expiresAt') IS NOT NULL AND julianday(json_extract(c.snapshot_json,'$.promo.expiresAt'))<=julianday(?))
               OR (
                 julianday(d.next_attempt_at)<=julianday(?)
                 AND (d.channel='whatsapp' OR (julianday(d.updated_at)<=julianday(?) AND julianday(d.next_attempt_at)<=julianday(?)))
               )
             )
         )
         OR EXISTS(
           SELECT 1 FROM broadcast_campaigns c
           WHERE c.status='queued'
             AND NOT EXISTS(SELECT 1 FROM broadcast_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))
         )`,
      checkNow,
      checkNow,
      checkNow,
      checkCutoff,
      checkCutoff,
    );
    if (!hasWork || !db.canSpend(7)) return out;
  }
  const token = crypto.randomUUID();
  const lock = await db.execRun(
    `UPDATE broadcast_dispatch_control SET worker_token=?, lease_until=?
     WHERE id=1 AND (lease_until IS NULL OR julianday(lease_until)<=julianday(?))`,
    token,
    new Date(Date.now() + GLOBAL_LEASE_MS).toISOString(),
    now(),
  );
  if (!lock.changes) return out;

  let telegramAfterMs = 0;
  let emailAfterMs = 0;
  let touchedTelegram = false;
  let touchedEmail = false;

  try {
    const control = await db.queryFirst(
      'SELECT * FROM broadcast_dispatch_control WHERE id=1 AND worker_token=?',
      token,
    );
    if (!control) return out;
    telegramAfterMs = parseSqlTimestampMs(control.telegram_after);
    emailAfterMs = parseSqlTimestampMs(control.email_after);

    // No blind retry for Telegram/WA after an interrupted send. Email retries only
    // inside Resend's 24-hour dedupe window, with an extra hour of margin.
    const recoverIso = now();
    await db.execRun(
      `UPDATE broadcast_deliveries
       SET status=CASE WHEN channel='email' AND julianday(first_attempt_at)>julianday(?,'-23 hours') THEN 'pending' ELSE 'unknown' END,
           last_error='delivery_interrupted', lease_until=NULL, next_attempt_at=?, updated_at=?
       WHERE status='sending' AND julianday(lease_until)<=julianday(?)`,
      recoverIso,
      recoverIso,
      recoverIso,
      recoverIso,
    );

    const currentIso = now();
    const expiredPromo = await db.execRun(
      `UPDATE broadcast_deliveries SET status='skipped', last_error='promo_slot_expired', lease_until=NULL, updated_at=?
       WHERE status='pending' AND campaign_id IN (
         SELECT id FROM broadcast_campaigns WHERE status='queued'
           AND json_extract(snapshot_json,'$.promo.expiresAt') IS NOT NULL
           AND julianday(json_extract(snapshot_json,'$.promo.expiresAt'))<=julianday(?)
       )`,
      currentIso,
      currentIso,
    );
    out.skipped += Number(expiredPromo.changes ?? 0);

    const graceClause =
      queueGraceMs > 0
        ? ` AND (d.channel='whatsapp' OR (julianday(d.updated_at)<=julianday(?) AND julianday(d.next_attempt_at)<=julianday(?)))`
        : '';
    const graceCutoffIso = queueGraceMs > 0 ? new Date(Date.now() - queueGraceMs).toISOString() : null;
    const selectNow = now();
    const effectiveLimit = Math.max(1, Math.min(MAX_BACKSTOP_LIMIT, Math.floor(limit)));

    const selectParams: unknown[] = [
      selectNow,
      control.email_after ?? null,
      control.email_after ?? null,
      selectNow,
      control.telegram_after ?? null,
      control.telegram_after ?? null,
      selectNow,
    ];
    if (graceCutoffIso) selectParams.push(graceCutoffIso, graceCutoffIso);
    selectParams.push(effectiveLimit);

    const rows = await db.queryAll(
      `SELECT d.*, c.snapshot_json, ${ELIGIBLE_CASE_SQL}
       FROM broadcast_deliveries d JOIN broadcast_campaigns c ON c.id=d.campaign_id
       WHERE d.status='pending' AND c.status='queued' AND julianday(d.next_attempt_at)<=julianday(?)
         AND (d.channel!='email' OR ? IS NULL OR julianday(?)<=julianday(?,'+1 second'))
         AND (d.channel!='telegram' OR ? IS NULL OR julianday(?)<=julianday(?,'+1 second'))${graceClause}
       ORDER BY d.id LIMIT ?`,
      ...selectParams,
    );

    for (const row of rows) {
      if (!db.canSpend(5)) break;
      const channel = row.channel as BroadcastChannel;
      const snapshot = JSON.parse(String(row.snapshot_json)) as BroadcastSnapshot;
      if (snapshot.promo?.expiresAt && Date.now() >= parseSqlTimestampMs(snapshot.promo.expiresAt)) {
        await db.execRun(
          "UPDATE broadcast_deliveries SET status='skipped', last_error='promo_slot_expired', updated_at=? WHERE id=? AND status='pending'",
          now(),
          row.id,
        );
        out.skipped++;
        continue;
      }
      // A late retry must not outlive the provider's idempotency protection.
      if (
        channel === 'email' &&
        row.first_attempt_at &&
        Date.now() - parseSqlTimestampMs(row.first_attempt_at) >= 23 * 3_600_000
      ) {
        await db.execRun(
          "UPDATE broadcast_deliveries SET status='unknown', last_error='email_retry_window_elapsed', updated_at=? WHERE id=? AND status='pending'",
          now(),
          row.id,
        );
        out.unknown++;
        continue;
      }
      if (Number(row.is_eligible) === 0) {
        await db.execRun(
          "UPDATE broadcast_deliveries SET status='skipped', last_error='recipient_unsubscribed', updated_at=? WHERE id=? AND status='pending'",
          now(),
          row.id,
        );
        out.skipped++;
        continue;
      }
      const afterMs = channel === 'email' ? emailAfterMs : channel === 'telegram' ? telegramAfterMs : 0;
      const delay = afterMs ? afterMs - Date.now() : 0;
      if (delay > MAX_INLINE_PACE_WAIT_MS) continue;
      if (Date.now() - started + Math.max(0, delay) >= timeBudgetMs) break;
      if (delay > 0) {
        await sleep(delay);
        if (snapshot.promo?.expiresAt && Date.now() >= parseSqlTimestampMs(snapshot.promo.expiresAt)) {
          await db.execRun(
            "UPDATE broadcast_deliveries SET status='skipped', last_error='promo_slot_expired', updated_at=? WHERE id=? AND status='pending'",
            now(),
            row.id,
          );
          out.skipped++;
          continue;
        }
      }
      const claimIso = now();
      const claim = await db.execRun(
        `UPDATE broadcast_deliveries
         SET status='sending', attempts=attempts+1,
             first_attempt_at=COALESCE(first_attempt_at,?),
             lease_until=?, updated_at=?
         WHERE id=? AND status='pending'
           AND EXISTS(SELECT 1 FROM broadcast_campaigns c WHERE c.id=campaign_id AND c.status='queued')
           AND ${eligibleSQL(channel)}`,
        claimIso,
        new Date(Date.now() + DELIVERY_LEASE_MS).toISOString(),
        claimIso,
        row.id,
      );
      if (!claim.changes) continue;

      let result: SendOutcome;
      try {
        result = await sendBroadcast(
          channel,
          {
            campaign_id: String(row.campaign_id),
            recipient_id: String(row.recipient_id),
            destination: String(row.destination),
            unsubscribe_token: String(row.unsubscribe_token || ''),
            provider_id: row.provider_id ? String(row.provider_id) : null,
          },
          snapshot,
        );
      } catch {
        result = { state: 'unknown', error: 'delivery_unknown' };
      }

      if (result.blocked && db.canSpend(2)) {
        await db.execRun(
          'UPDATE telegram_users SET is_blocked=1 WHERE user_id=? AND chat_id=?',
          row.recipient_id,
          row.destination,
        );
      }

      const retrySec =
        result.state === 'retry'
          ? Math.max(1, Math.min(86_400, Number(result.retryAfter) || 60))
          : 60;
      if (result.state === 'retry' && (channel === 'email' || channel === 'telegram')) {
        const nextAfterMs = Date.now() + retrySec * 1000;
        if (channel === 'telegram') {
          telegramAfterMs = Math.max(telegramAfterMs, nextAfterMs);
          touchedTelegram = true;
        } else {
          emailAfterMs = Math.max(emailAfterMs, nextAfterMs);
          touchedEmail = true;
        }
        if (db.canSpend(2)) {
          await db.execRun(
            `UPDATE broadcast_dispatch_control SET ${channel === 'email' ? 'email_after' : 'telegram_after'}=? WHERE id=1 AND worker_token=?`,
            new Date(nextAfterMs).toISOString(),
            token,
          );
        }
      } else if (channel === 'email' || channel === 'telegram') {
        const paceMs = channel === 'email' ? EMAIL_RECIPIENT_PACE_MS : TELEGRAM_RECIPIENT_PACE_MS;
        const nextAfterMs = Date.now() + paceMs;
        if (channel === 'telegram') {
          telegramAfterMs = Math.max(telegramAfterMs, nextAfterMs);
          touchedTelegram = true;
        } else {
          emailAfterMs = Math.max(emailAfterMs, nextAfterMs);
          touchedEmail = true;
        }
      }

      const status = result.state === 'retry' ? 'pending' : result.state;
      await db.execRun(
        `UPDATE broadcast_deliveries
         SET status=?, provider_id=?, last_error=?, lease_until=NULL,
             attempts=attempts-?,
             first_attempt_at=CASE WHEN ? THEN NULL ELSE first_attempt_at END,
             next_attempt_at=?, updated_at=?
         WHERE id=? AND status='sending'`,
        status,
        result.providerId || null,
        result.error || null,
        result.consumeAttempt === false ? 1 : 0,
        result.consumeAttempt === false && !row.first_attempt_at ? 1 : 0,
        new Date(Date.now() + retrySec * 1000).toISOString(),
        now(),
        row.id,
      );
      if (result.state === 'retry') out.deferred++;
      else out[result.state]++;
    }

    if (db.canSpend(2)) {
      await db.execRun(
        `UPDATE broadcast_campaigns SET status='completed'
         WHERE status='queued'
           AND NOT EXISTS(SELECT 1 FROM broadcast_deliveries d WHERE d.campaign_id=broadcast_campaigns.id AND d.status IN ('pending','sending'))`,
      );
    }
  } finally {
    if (db.canSpend(1)) {
      await releaseControlLease(
        db,
        token,
        touchedTelegram && telegramAfterMs > 0 ? new Date(telegramAfterMs).toISOString() : null,
        touchedEmail && emailAfterMs > 0 ? new Date(emailAfterMs).toISOString() : null,
      );
    }
  }
  return out;
}
