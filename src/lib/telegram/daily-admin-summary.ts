import type { D1 } from "@/lib/db";
import { QueryBudgetExceeded, unwrapD1, type DatabaseAccess } from "@/lib/db-access";
import { PAYMENT_ATTENTION_WHERE } from "@/lib/admin-overview-queries";
import { effectiveVariantStockSql, purchasableStockSql } from "@/lib/catalog-availability";
import { isNowpaymentsReadable } from "@/lib/payments/rails";
import { isPediaProxyConfigured } from "@/lib/pedia/proxy";
import { pediaBalanceAlertRp } from "@/lib/pedia/ops-config";
import { notLoserProductSql } from "@/lib/product-groups";
import { isSkSyncEnabled } from "@/lib/sekalipay/client";
import { skSaldoAlertThreshold } from "@/lib/sekalipay/saldo";
import { aivaultBalanceAlertThreshold, miraiBalanceAlertThreshold, storebatBalanceAlertThreshold, tunvnBalanceAlertThreshold } from "@/lib/supplier-balance-alert";
import { parseStoredSyncError, sanitizeSyncError } from "@/lib/sync-status";
import {
  formatAgeId,
  NEVER_SUCCEEDED_GRACE_MS,
  parseEpisodeState,
  parseTimestampMs,
  SYNC_SOURCE_LABELS,
  SYNC_STALENESS_THRESHOLDS_MS,
  type SyncSourceId,
} from "@/lib/sync-staleness";
import { sendMessage } from "@/lib/telegram/api";
import { escapeHtml, formatRupiah, truncate } from "@/lib/telegram/messages/format";
import { isAivaultConfigured, isAivaultSyncEnabled } from "@/lib/aivault/client";
import { isStorebatConfigured, isStorebatSyncEnabled } from "@/lib/storebat/client";
import { isMiraiConfigured, isMiraiSyncEnabled } from "@/lib/mirai/client";
import { isGamesSkCatalogConfigured } from "@/lib/games/sk-catalog-sync";
import { isTunvnConfigured, isTunvnSyncEnabled } from "@/lib/tunvn/client";
import { isWrEnabled, isWrSyncEnabled } from "@/lib/warung-rebahan/client";
import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";
import { WR_SYNC_STALE_ALERT_MINUTES } from "@/lib/warung-rebahan/order";
import { getSaldoThreshold } from "@/lib/warung-rebahan/saldo";

export const DAILY_ADMIN_SUMMARY_STATE_KEY = "admin_daily_summary_state";
export const DAILY_SUMMARY_START_HOUR_WIB = 7;
export const DAILY_SUMMARY_END_HOUR_WIB = 12;
export const DAILY_SUMMARY_CLAIM_TTL_MS = 120_000;
const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;
const MAX_TELEGRAM_HTML_CHARS = 3800;

const sentDateByD1 = new WeakMap<D1, string>();

type SummaryState = {
  sent_date?: string;
  claiming_until?: number;
  sent_at?: string;
};

export type DailyAdminSummaryData = {
  yesterdayWib: string;
  todayWib: string;
  yesterday: {
    paidOrders: number;
    revenue: number;
    webOrders: number;
    webRevenue: number;
    telegramOrders: number;
    telegramRevenue: number;
    whatsappOrders: number;
    whatsappRevenue: number;
    expiredOrders: number;
    cancelledOrders: number;
  };
  stuck: {
    count: number;
    codes: string[];
    paymentAttention: number;
  };
  balances: {
    label: string;
    formatted: string;
    isLow: boolean;
    thresholdFormatted: string;
    error?: string | null;
  }[];
  sync: {
    currentlyStale: { label: string; ageLabel: string; error?: string | null }[];
    recoveredLast24h: string[];
  };
  lowStock: {
    id: number;
    name: string;
    sold30d: number;
    effectiveStock: number;
  }[];
};

export type DailyAdminSummaryResult = {
  due: boolean;
  sent: boolean;
  skipped?: "disabled" | "already_sent" | "claimed" | "cas_lost" | "query_budget" | "send_failed";
  date?: string;
  error?: string;
  summary?: DailyAdminSummaryData;
};

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

export function wibDateInfo(now = new Date()) {
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  const wibYesterday = new Date(wibNow.getTime() - DAY_MS);
  const todayWib = wibNow.toISOString().slice(0, 10);
  const yesterdayWib = wibYesterday.toISOString().slice(0, 10);
  const hourWib = wibNow.getUTCHours();

  const [y, m, d] = yesterdayWib.split("-").map(Number);
  const yesterdayStartUtcMs = Date.UTC(y, m - 1, d) - WIB_OFFSET_MS;

  return {
    todayWib,
    yesterdayWib,
    hourWib,
    yesterdayLabel: `${d} ${MONTHS_ID[m - 1] ?? ""} ${y}`,
    yesterdayPaidLowerBound: toSqliteUtc(yesterdayStartUtcMs - DAY_MS),
    yesterdayPaidUpperBound: new Date(yesterdayStartUtcMs + 2 * DAY_MS).toISOString(),
    cancelledLowerBound: toSqliteUtc(yesterdayStartUtcMs - 7 * DAY_MS),
    thirtyDaysLowerBound: toSqliteUtc(now.getTime() - 31 * DAY_MS),
    thirtyDaysIso: new Date(now.getTime() - 30 * DAY_MS).toISOString(),
  };
}

function parseSummaryState(raw: unknown): SummaryState {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as SummaryState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      sent_date: typeof parsed.sent_date === "string" ? parsed.sent_date : undefined,
      claiming_until: typeof parsed.claiming_until === "number" && Number.isFinite(parsed.claiming_until) ? parsed.claiming_until : undefined,
      sent_at: typeof parsed.sent_at === "string" ? parsed.sent_at : undefined,
    };
  } catch {
    return {};
  }
}

async function casSummaryState(
  db: DatabaseAccess,
  expectedRaw: string | null,
  nextValue: string,
): Promise<boolean> {
  const res = expectedRaw === null
    ? await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
         WHERE COALESCE(store_settings.value, '') = ''`,
        DAILY_ADMIN_SUMMARY_STATE_KEY,
        nextValue,
      )
    : await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
         WHERE store_settings.value = ?`,
        DAILY_ADMIN_SUMMARY_STATE_KEY,
        nextValue,
        expectedRaw,
      );
  return Number(res.changes ?? 0) === 1;
}

const SUMMARY_SETTINGS_KEYS = [
  "tunvn_balance_last_value",
  "tunvn_balance_last_ok_at",
  "tunvn_balance_error",
  "aivault_balance_last_value",
  "storebat_balance_last_value",
  "mirai_balance_last_value",
  "aivault_balance_last_ok_at",
  "storebat_balance_last_ok_at",
  "mirai_balance_last_ok_at",
  "aivault_balance_error",
  "storebat_balance_error",
  "mirai_balance_error",
  "pedia_indosmm_balance_last_error",
  "jaspay_catalog_success_at",
  "jaspay_catalog_last_error",
  "tunvn_catalog_success_at",
  "tunvn_catalog_last_error",
  "tunvn_buff_sync_at",
  "tunvn_buff_last_error",
  "aivault_catalog_success_at",
  "storebat_catalog_success_at",
  "mirai_catalog_success_at",
  "aivault_catalog_last_error",
  "storebat_catalog_last_error",
  "mirai_catalog_last_error",
  "games_sk_catalog_success_at",
  "games_sk_catalog_last_error",
  "pedia_indosmm_diff_last_at",
  "pedia_indosmm_diff_last_error",
  "sync_stale_state_sk",
  "sync_stale_state_jaspay",
  "sync_stale_state_tunvn",
  "sync_stale_state_tunvn_buff",
  "sync_stale_state_aivault",
  "sync_stale_state_storebat",
  "sync_stale_state_mirai",
  "sync_stale_state_games_sk",
  "sync_stale_state_pedia_indosmm",
  "sync_stale_state_crypto_market",
] as const;

function parseBalanceErrText(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; streak?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      const streak = Number(parsed.streak);
      const err = sanitizeSyncError(parsed.error);
      return Number.isInteger(streak) && streak > 1 ? `${err} (${streak}x)` : err;
    }
  } catch { /* fallback below */ }
  return sanitizeSyncError(raw);
}

function formatDecimalAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export async function collectDailyAdminSummaryData(
  db: DatabaseAccess,
  now = new Date(),
): Promise<DailyAdminSummaryData> {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const wib = wibDateInfo(now);

  // 1) Kemarin: order lunas + omzet + kanal
  const paidRow = await db.queryFirst(
    `SELECT
       COUNT(*) AS paid_orders,
       COALESCE(SUM(CAST(ROUND(COALESCE(pt.payable_amount, o.subtotal) +
         CASE WHEN o.order_kind='pedia' AND pt.payable_amount IS NOT NULL THEN COALESCE(pi.credit_used,0) ELSE 0 END) AS INTEGER)), 0) AS revenue,
       COALESCE(SUM(CASE WHEN o.sales_channel='telegram' THEN 1 ELSE 0 END), 0) AS tg_orders,
       COALESCE(SUM(CASE WHEN o.sales_channel='telegram' THEN CAST(ROUND(COALESCE(pt.payable_amount, o.subtotal) +
         CASE WHEN o.order_kind='pedia' AND pt.payable_amount IS NOT NULL THEN COALESCE(pi.credit_used,0) ELSE 0 END) AS INTEGER) ELSE 0 END), 0) AS tg_revenue,
       COALESCE(SUM(CASE WHEN o.sales_channel='whatsapp' THEN 1 ELSE 0 END), 0) AS wa_orders,
       COALESCE(SUM(CASE WHEN o.sales_channel='whatsapp' THEN CAST(ROUND(COALESCE(pt.payable_amount, o.subtotal) +
         CASE WHEN o.order_kind='pedia' AND pt.payable_amount IS NOT NULL THEN COALESCE(pi.credit_used,0) ELSE 0 END) AS INTEGER) ELSE 0 END), 0) AS wa_revenue,
       COALESCE(SUM(CASE WHEN COALESCE(o.sales_channel,'web') NOT IN ('telegram','whatsapp') THEN 1 ELSE 0 END), 0) AS web_orders,
       COALESCE(SUM(CASE WHEN COALESCE(o.sales_channel,'web') NOT IN ('telegram','whatsapp') THEN CAST(ROUND(COALESCE(pt.payable_amount, o.subtotal) +
         CASE WHEN o.order_kind='pedia' AND pt.payable_amount IS NOT NULL THEN COALESCE(pi.credit_used,0) ELSE 0 END) AS INTEGER) ELSE 0 END), 0) AS web_revenue
     FROM orders o
     LEFT JOIN payment_transactions pt ON pt.order_code = o.code
     LEFT JOIN pedia_order_items pi ON pi.order_code = o.code
     WHERE o.status = 'lunas'
       AND o.paid_at >= ?
       AND o.paid_at <= ?
       AND date(datetime(COALESCE(pt.paid_at, o.paid_at, (
         SELECT MAX(pp.reviewed_at) FROM payment_proofs pp WHERE pp.order_code = o.code AND pp.status = 'approved'
       ), o.updated_at), '+7 hours')) = ?`,
    wib.yesterdayPaidLowerBound,
    wib.yesterdayPaidUpperBound,
    wib.yesterdayWib,
  );

  // 2) Kemarin: kadaluarsa / dibatalkan
  const cancelledRow = await db.queryFirst(
    `SELECT
       COALESCE(SUM(CASE WHEN o.status='kadaluarsa' THEN 1 ELSE 0 END), 0) AS expired_orders,
       COALESCE(SUM(CASE WHEN o.status='dibatalkan' THEN 1 ELSE 0 END), 0) AS cancelled_orders
     FROM orders o INDEXED BY idx_orders_created_at
     WHERE o.created_at >= ?
       AND o.status IN ('kadaluarsa', 'dibatalkan')
       AND date(datetime(o.updated_at, '+7 hours')) = ?`,
    wib.cancelledLowerBound,
    wib.yesterdayWib,
  );

  // 3) Order macet (>30 menit lunas, item/link belum selesai/terkirim) — split <= 5 UNION ALL per query (batas compound D1)
  const stuckRowsA = await db.queryAll(
    `SELECT order_code, MIN(paid_ts) AS paid_ts FROM (
       SELECT fj.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM fulfillment_jobs fj INDEXED BY idx_fulfillment_jobs_status
       CROSS JOIN orders o ON o.code = fj.order_code
       WHERE fj.status IN ('queued','sending','retry','failed','manual_required')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND COALESCE(o.order_kind, 'apps') NOT IN ('pedia', 'games')
         AND o.fulfillment_status != 'delivered'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       UNION ALL
       SELECT fi.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM fulfillment_items fi INDEXED BY idx_fulfillment_items_next
       CROSS JOIN orders o ON o.code = fi.order_code
       WHERE fi.status IN ('queued','sending','retry','failed','manual_required')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND COALESCE(o.order_kind, 'apps') NOT IN ('pedia', 'games')
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       UNION ALL
       SELECT wr.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM wr_order_links wr INDEXED BY idx_wr_order_links_status
       CROSS JOIN orders o ON o.code = wr.order_code
       WHERE wr.status IN ('pending','claimed','submitted','ordering','processing','retry','failed','blocked_balance')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       UNION ALL
       SELECT wrd.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM wr_order_links wrd INDEXED BY idx_wr_links_delivery
       CROSS JOIN orders o ON o.code = wrd.order_code
       WHERE wrd.delivery_status IN ('queued','failed')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       UNION ALL
       SELECT sk.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM sk_order_links sk INDEXED BY idx_sk_order_links_status
       CROSS JOIN orders o ON o.code = sk.order_code
       WHERE sk.status IN ('pending','claimed','submitted','ordering','processing','retry','failed','blocked_balance')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
     ) GROUP BY order_code`,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
  );

  const stuckRowsB = await db.queryAll(
    `SELECT order_code, MIN(paid_ts) AS paid_ts FROM (
       SELECT * FROM (
         SELECT tl.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
         FROM tunvn_order_links tl INDEXED BY idx_tunvn_orders_due
         CROSS JOIN orders o ON o.code = tl.order_code
         WHERE tl.status IN ('pending','claimed','processing','needs_admin')
           AND o.status = 'lunas' AND o.payment_status = 'paid'
           AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
         UNION ALL
         SELECT al.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
         FROM aivault_order_links al INDEXED BY idx_aivault_orders_due
         CROSS JOIN orders o ON o.code = al.order_code
         WHERE al.status IN ('pending','claimed','processing','needs_admin')
           AND o.status = 'lunas' AND o.payment_status = 'paid'
           AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
         UNION ALL
         SELECT al.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
         FROM storebat_order_links al INDEXED BY idx_storebat_orders_due
         CROSS JOIN orders o ON o.code = al.order_code
         WHERE al.status IN ('pending','claimed','processing','needs_admin')
           AND o.status = 'lunas' AND o.payment_status = 'paid'
           AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
         UNION ALL
         SELECT ml.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
         FROM mirai_order_links ml INDEXED BY idx_mirai_orders_due
         CROSS JOIN orders o ON o.code = ml.order_code
         WHERE ml.status IN ('pending','claimed','processing','needs_admin')
           AND o.status = 'lunas' AND o.payment_status = 'paid'
           AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       )
       UNION ALL
       SELECT pi.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM pedia_order_items pi INDEXED BY idx_pedia_items_status
       CROSS JOIN orders o ON o.code = pi.order_code
       WHERE pi.status IN ('queued','submitting','submitted','in_progress','needs_check')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
       UNION ALL
       SELECT gi.order_code, COALESCE(o.paid_at, o.created_at) AS paid_ts
       FROM games_order_items gi INDEXED BY idx_games_items_dispatch
       CROSS JOIN orders o ON o.code = gi.order_code
       WHERE gi.status IN ('queued','submitting','pending','needs_check')
         AND o.status = 'lunas' AND o.payment_status = 'paid'
         AND datetime(COALESCE(o.paid_at, o.created_at)) <= datetime(?, '-30 minutes')
     ) GROUP BY order_code`,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
    nowIso,
  );

  const stuckMap = new Map<string, string>();
  for (const row of [...stuckRowsA, ...stuckRowsB]) {
    const code = String(row.order_code ?? "").trim();
    if (!code) continue;
    const paidTs = String(row.paid_ts ?? "");
    const existing = stuckMap.get(code);
    if (existing === undefined || (paidTs && paidTs < existing)) {
      stuckMap.set(code, paidTs);
    }
  }
  const stuckEntries = [...stuckMap.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));

  // 4) Batch baca store_settings untuk saldo TUNVN/AIVault & state sync-staleness
  const placeholders = SUMMARY_SETTINGS_KEYS.map(() => "?").join(",");
  const settingsRows = await db.queryAll(
    `SELECT key, value FROM store_settings WHERE key IN (${placeholders})`,
    ...SUMMARY_SETTINGS_KEYS,
  );
  const settingsMap = new Map<string, string>();
  for (const row of settingsRows) {
    if (typeof row.key === "string" && typeof row.value === "string") {
      settingsMap.set(row.key, row.value);
    }
  }
  const setting = (key: string): string | undefined => settingsMap.get(key);

  // 5) Saldo tersimpan WR/SK/IndoSMM + rekonsiliasi QRIS + status sync WR/SK/Crypto
  const opsRow = await db.queryFirst(
    `SELECT
       (SELECT balance FROM wr_saldo_log ORDER BY id DESC LIMIT 1) AS wr_balance,
       (SELECT balance FROM sk_saldo_log WHERE source='api_check' ORDER BY created_at DESC, id DESC LIMIT 1) AS sk_balance,
       (SELECT balance FROM pedia_supplier_balance_log WHERE supplier='indosmm' ORDER BY created_at DESC, id DESC LIMIT 1) AS pedia_balance,
       (SELECT COUNT(*) FROM dana_webhook_events WHERE ${PAYMENT_ATTENTION_WHERE}) AS payment_attention,
       (SELECT fx_effective_at FROM crypto_market_snapshot WHERE id=1) AS crypto_fx_at,
       (SELECT last_error FROM crypto_market_snapshot WHERE id=1) AS crypto_fx_err,
       (SELECT value FROM sk_sync_state WHERE key='diff_last_at') AS sk_diff_at,
       (SELECT value FROM sk_sync_state WHERE key='diff_last_error') AS sk_diff_err,
       (SELECT created_at FROM sk_sync_log WHERE sync_type='products' AND status IN ('success','partial') ORDER BY created_at DESC LIMIT 1) AS sk_log_at,
       (SELECT value FROM wr_sync_state WHERE key='diff_last_at') AS wr_diff_at,
       (SELECT value FROM wr_sync_state WHERE key='diff_last_error') AS wr_diff_err,
       (SELECT value FROM wr_sync_state WHERE key='sync_stale_alerted_at') AS wr_stale_alerted_at,
       (SELECT created_at FROM wr_sync_log WHERE sync_type='products' AND status IN ('success','partial') ORDER BY created_at DESC LIMIT 1) AS wr_log_at`,
  );

  const balances: DailyAdminSummaryData["balances"] = [];
  if (opsRow?.wr_balance != null) {
    const val = Number(opsRow.wr_balance);
    const thr = getSaldoThreshold();
    if (Number.isFinite(val)) {
      balances.push({
        label: "WR",
        formatted: formatRupiah(Math.floor(val)),
        isLow: val < thr,
        thresholdFormatted: formatRupiah(thr),
      });
    }
  }
  if (opsRow?.sk_balance != null) {
    const val = Number(opsRow.sk_balance);
    const thr = skSaldoAlertThreshold();
    if (Number.isFinite(val)) {
      balances.push({
        label: "SK",
        formatted: formatRupiah(Math.floor(val)),
        isLow: val < thr,
        thresholdFormatted: formatRupiah(thr),
      });
    }
  }
  const pediaErr = parseStoredSyncError(setting("pedia_indosmm_balance_last_error"))?.error ?? null;
  if (opsRow?.pedia_balance != null) {
    const val = Number(opsRow.pedia_balance);
    const thr = pediaBalanceAlertRp();
    if (Number.isFinite(val)) {
      balances.push({
        label: "IndoSMM",
        formatted: formatRupiah(Math.floor(val)),
        isLow: val < thr,
        thresholdFormatted: formatRupiah(thr),
        error: pediaErr,
      });
    }
  } else if (pediaErr) {
    const thr = pediaBalanceAlertRp();
    balances.push({
      label: "IndoSMM",
      formatted: "belum terbaca",
      isLow: false,
      thresholdFormatted: formatRupiah(thr),
      error: pediaErr,
    });
  }

  const tunvnValRaw = setting("tunvn_balance_last_value");
  const tunvnErr = parseBalanceErrText(setting("tunvn_balance_error"));
  const tunvnThr = tunvnBalanceAlertThreshold();
  if (tunvnValRaw !== undefined && tunvnValRaw !== "" && Number.isFinite(Number(tunvnValRaw))) {
    const val = Number(tunvnValRaw);
    balances.push({
      label: "TUNVN",
      formatted: `${formatDecimalAmount(val)} USDT`,
      isLow: val < tunvnThr,
      thresholdFormatted: `${formatDecimalAmount(tunvnThr)} USDT`,
      error: tunvnErr,
    });
  } else if (tunvnErr) {
    balances.push({
      label: "TUNVN",
      formatted: "belum terbaca",
      isLow: false,
      thresholdFormatted: `${formatDecimalAmount(tunvnThr)} USDT`,
      error: tunvnErr,
    });
  }

  const aivaultValRaw = setting("aivault_balance_last_value");
  const aivaultErr = parseBalanceErrText(setting("aivault_balance_error"));
  const aivaultThr = aivaultBalanceAlertThreshold();
  if (aivaultValRaw !== undefined && aivaultValRaw !== "" && Number.isFinite(Number(aivaultValRaw))) {
    const val = Number(aivaultValRaw);
    balances.push({
      label: "AIVault",
      formatted: `$${formatDecimalAmount(val)}`,
      isLow: val < aivaultThr,
      thresholdFormatted: `$${formatDecimalAmount(aivaultThr)}`,
      error: aivaultErr,
    });
  } else if (aivaultErr) {
    balances.push({
      label: "AIVault",
      formatted: "belum terbaca",
      isLow: false,
      thresholdFormatted: `$${formatDecimalAmount(aivaultThr)}`,
      error: aivaultErr,
    });
  }

  // 6) Sync status: sumber saat ini basi + sempat basi dalam 24 jam terakhir
  const currentlyStale: DailyAdminSummaryData["sync"]["currentlyStale"] = [];
  const recoveredLast24h: string[] = [];

  const skDiffMs = parseTimestampMs(opsRow?.sk_diff_at);
  const skLogMs = parseTimestampMs(opsRow?.sk_log_at);
  const pediaDiffMs = parseTimestampMs(setting("pedia_indosmm_diff_last_at"));

  const tunvnActive = isTunvnSyncEnabled() && isTunvnConfigured();
  const tunvnBuffSuccessMs = parseTimestampMs(setting("tunvn_buff_sync_at"));
  const tunvnBuffError = parseStoredSyncError(setting("tunvn_buff_last_error"))?.error ?? null;

  const syncCandidates: {
    id: SyncSourceId;
    active: boolean;
    lastSuccessMs: number | null;
    lastError: string | null;
    thresholdMs: number;
  }[] = [
    {
      id: "sk",
      active: isSkSyncEnabled(),
      lastSuccessMs: skDiffMs ?? skLogMs ?? null,
      lastError: parseStoredSyncError(opsRow?.sk_diff_err)?.error ?? null,
      thresholdMs: skDiffMs !== null ? SYNC_STALENESS_THRESHOLDS_MS.sk_diff : SYNC_STALENESS_THRESHOLDS_MS.sk_sweep,
    },
    {
      id: "jaspay",
      active: isWrSyncEnabled(),
      lastSuccessMs: parseTimestampMs(setting("jaspay_catalog_success_at")),
      lastError: parseStoredSyncError(setting("jaspay_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.jaspay,
    },
    {
      id: "tunvn",
      active: tunvnActive,
      lastSuccessMs: parseTimestampMs(setting("tunvn_catalog_success_at")),
      lastError: parseStoredSyncError(setting("tunvn_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.tunvn,
    },
    {
      id: "tunvn_buff",
      active: tunvnActive && (tunvnBuffSuccessMs !== null || tunvnBuffError !== null),
      lastSuccessMs: tunvnBuffSuccessMs,
      lastError: tunvnBuffError,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.tunvn_buff,
    },
    {
      id: "aivault",
      active: isAivaultSyncEnabled() && isAivaultConfigured(),
      lastSuccessMs: parseTimestampMs(setting("aivault_catalog_success_at")),
      lastError: parseStoredSyncError(setting("aivault_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.aivault,
    },
    {
      id: "storebat",
      active: isStorebatSyncEnabled() && isStorebatConfigured(),
      lastSuccessMs: parseTimestampMs(setting("storebat_catalog_success_at")),
      lastError: parseStoredSyncError(setting("storebat_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.storebat,
    },
    {
      id: "mirai",
      active: isMiraiSyncEnabled() && isMiraiConfigured(),
      lastSuccessMs: parseTimestampMs(setting("mirai_catalog_success_at")),
      lastError: parseStoredSyncError(setting("mirai_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.mirai,
    },
    {
      id: "games_sk",
      active: isGamesSkCatalogConfigured(),
      lastSuccessMs: parseTimestampMs(setting("games_sk_catalog_success_at")),
      lastError: parseStoredSyncError(setting("games_sk_catalog_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.games_sk,
    },
    {
      id: "pedia_indosmm",
      active: isPediaProxyConfigured() && pediaDiffMs !== null,
      lastSuccessMs: pediaDiffMs,
      lastError: parseStoredSyncError(setting("pedia_indosmm_diff_last_error"))?.error ?? null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.pedia_indosmm,
    },
    {
      id: "crypto_market",
      active: isNowpaymentsReadable(),
      lastSuccessMs: parseTimestampMs(opsRow?.crypto_fx_at),
      lastError: typeof opsRow?.crypto_fx_err === "string" && opsRow.crypto_fx_err.trim()
        ? sanitizeSyncError(opsRow.crypto_fx_err)
        : null,
      thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.crypto_market,
    },
  ];

  for (const src of syncCandidates) {
    const label = SYNC_SOURCE_LABELS[src.id];
    const episode = parseEpisodeState(setting(`sync_stale_state_${src.id}`) ?? null);
    let isStaleNow = false;
    if (src.active) {
      if (src.lastSuccessMs !== null) {
        const ageMs = Math.max(0, nowMs - src.lastSuccessMs);
        if (ageMs >= src.thresholdMs) {
          isStaleNow = true;
          currentlyStale.push({ label, ageLabel: formatAgeId(ageMs), error: src.lastError });
        }
      } else if (episode.enabled_since != null && nowMs - episode.enabled_since > NEVER_SUCCEEDED_GRACE_MS) {
        isStaleNow = true;
        currentlyStale.push({
          label,
          ageLabel: `${formatAgeId(nowMs - episode.enabled_since)} (belum pernah sukses)`,
          error: src.lastError,
        });
      }
    }
    if (!isStaleNow) {
      const staleWithin24h = episode.last_stale_at != null && nowMs - episode.last_stale_at <= DAY_MS;
      const recoveredWithin24h = episode.last_recovered_at != null && nowMs - episode.last_recovered_at <= DAY_MS;
      if (staleWithin24h || recoveredWithin24h) {
        recoveredLast24h.push(label);
      }
    }
  }

  // WR watchdog terpisah (`wr_sync_state` + `wr_sync_log`)
  if (isWrEnabled() && isWrSyncEnabled()) {
    const wrDiffMs = parseTimestampMs(opsRow?.wr_diff_at);
    const wrLogMs = parseTimestampMs(opsRow?.wr_log_at);
    const wrLastMs = wrDiffMs ?? wrLogMs ?? null;
    const wrThresholdMs = wrDiffMs !== null ? SYNC_STALENESS_THRESHOLDS_MS.sk_diff : WR_SYNC_STALE_ALERT_MINUTES * 60_000;
    const wrErr = parseStoredSyncError(opsRow?.wr_diff_err)?.error ?? null;
    const wrAlertedRaw = typeof opsRow?.wr_stale_alerted_at === "string" ? opsRow.wr_stale_alerted_at.trim() : "";
    if (wrLastMs !== null && nowMs - wrLastMs >= wrThresholdMs) {
      currentlyStale.push({ label: "Warung Rebahan", ageLabel: formatAgeId(nowMs - wrLastMs), error: wrErr });
    } else if (wrAlertedRaw) {
      const alertedTs = parseTimestampMs(wrAlertedRaw);
      const isStillSame = alertedTs !== null && (wrLastMs === null || wrLastMs <= alertedTs);
      if (isStillSame) {
        currentlyStale.push({ label: "Warung Rebahan", ageLabel: formatAgeId(nowMs - alertedTs), error: wrErr });
      }
    }
  }

  // 7) Top 5 produk terlaris 30 hari dengan stok efektif aktif <= 2
  const effective = effectiveVariantStockSql("pv");
  const buyable = purchasableStockSql("pv");
  const lowStockRows = await db.queryAll(
    `WITH sales_30d AS (
       SELECT
         COALESCE(
           CAST(json_extract(j.value, '$.product_id') AS INTEGER),
           (SELECT pv0.product_id FROM product_variants pv0 WHERE pv0.id = CAST(json_extract(j.value, '$.variant_id') AS INTEGER))
         ) AS product_id,
         SUM(MAX(1, CAST(COALESCE(json_extract(j.value, '$.qty'), 1) AS INTEGER))) AS sold_30d
       FROM orders o
       JOIN json_each(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END) j
       WHERE o.status = 'lunas'
         AND o.payment_status = 'paid'
         AND COALESCE(o.order_kind, 'apps') = 'apps'
         AND o.paid_at >= ?
         AND datetime(o.paid_at) >= datetime(?)
       GROUP BY 1
     )
     SELECT
       p.id,
       p.name,
       s.sold_30d,
       CASE
         WHEN MAX(CASE WHEN ${effective} = -1 THEN 1 ELSE 0 END) = 1 THEN -1
         ELSE COALESCE(SUM(CASE WHEN ${buyable} THEN ${effective} ELSE 0 END), 0)
       END AS effective_stock
     FROM sales_30d s
     JOIN products p ON p.id = s.product_id
     JOIN product_variants pv ON pv.product_id = p.id AND pv.is_active = 1 AND ${wrNewSaleSql("pv")}
     WHERE s.product_id IS NOT NULL
       AND p.is_active = 1
       AND p.archived_at IS NULL
       AND ${notLoserProductSql("p")}
     GROUP BY p.id
     HAVING effective_stock >= 0 AND effective_stock <= 2
     ORDER BY s.sold_30d DESC, effective_stock ASC, p.id ASC
     LIMIT 5`,
    wib.thirtyDaysLowerBound,
    wib.thirtyDaysIso,
  );

  const storebatValRaw = setting("storebat_balance_last_value");
  const storebatErr = parseBalanceErrText(setting("storebat_balance_error"));
  const storebatThr = storebatBalanceAlertThreshold();
  if (storebatValRaw !== undefined && storebatValRaw !== "" && Number.isFinite(Number(storebatValRaw))) {
    const val = Number(storebatValRaw);
    balances.push({
      label: "StoreBat",
      formatted: `$${formatDecimalAmount(val)}`,
      isLow: val < storebatThr,
      thresholdFormatted: `$${formatDecimalAmount(storebatThr)}`,
      error: storebatErr,
    });
  } else if (storebatErr) {
    balances.push({
      label: "StoreBat",
      formatted: "belum terbaca",
      isLow: false,
      thresholdFormatted: `$${formatDecimalAmount(storebatThr)}`,
      error: storebatErr,
    });
  }

  const miraiValRaw = setting("mirai_balance_last_value");
  const miraiErr = parseBalanceErrText(setting("mirai_balance_error"));
  const miraiThr = miraiBalanceAlertThreshold();
  if (miraiValRaw !== undefined && miraiValRaw !== "" && Number.isFinite(Number(miraiValRaw))) {
    const val = Number(miraiValRaw);
    balances.push({
      label: "Mirai",
      formatted: `${formatDecimalAmount(val)} USDT`,
      isLow: val < miraiThr,
      thresholdFormatted: `${formatDecimalAmount(miraiThr)} USDT`,
      error: miraiErr,
    });
  } else if (miraiErr) {
    balances.push({
      label: "Mirai",
      formatted: "belum terbaca",
      isLow: false,
      thresholdFormatted: `${formatDecimalAmount(miraiThr)} USDT`,
      error: miraiErr,
    });
  }


  return {
    yesterdayWib: wib.yesterdayWib,
    todayWib: wib.todayWib,
    yesterday: {
      paidOrders: Number(paidRow?.paid_orders ?? 0),
      revenue: Number(paidRow?.revenue ?? 0),
      webOrders: Number(paidRow?.web_orders ?? 0),
      webRevenue: Number(paidRow?.web_revenue ?? 0),
      telegramOrders: Number(paidRow?.tg_orders ?? 0),
      telegramRevenue: Number(paidRow?.tg_revenue ?? 0),
      whatsappOrders: Number(paidRow?.wa_orders ?? 0),
      whatsappRevenue: Number(paidRow?.wa_revenue ?? 0),
      expiredOrders: Number(cancelledRow?.expired_orders ?? 0),
      cancelledOrders: Number(cancelledRow?.cancelled_orders ?? 0),
    },
    stuck: {
      count: stuckEntries.length,
      codes: stuckEntries.slice(0, 5).map(([code]) => code),
      paymentAttention: Number(opsRow?.payment_attention ?? 0),
    },
    balances,
    sync: {
      currentlyStale,
      recoveredLast24h,
    },
    lowStock: lowStockRows.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      sold30d: Number(r.sold_30d ?? 0),
      effectiveStock: Number(r.effective_stock ?? 0),
    })),
  };
}

export function formatDailyAdminSummaryHtml(data: DailyAdminSummaryData, yesterdayLabel: string): string {
  const y = data.yesterday;
  const channelParts = [
    `Web ${y.webOrders} (${formatRupiah(y.webRevenue)})`,
    `Telegram ${y.telegramOrders} (${formatRupiah(y.telegramRevenue)})`,
  ];
  if (y.whatsappOrders > 0) {
    channelParts.push(`WA ${y.whatsappOrders} (${formatRupiah(y.whatsappRevenue)})`);
  }

  const lines: string[] = [
    `📊 <b>Ringkasan Harian AXVARA</b> — ${escapeHtml(yesterdayLabel)} (WIB)`,
    "",
    `💰 <b>Kemarin (00:00–24:00 WIB)</b>`,
    `• Order lunas: <b>${y.paidOrders}</b> · Omzet: <b>${escapeHtml(formatRupiah(y.revenue))}</b>`,
    `• Kanal: ${escapeHtml(channelParts.join(" · "))}`,
    `• Kadaluarsa: ${y.expiredOrders} · Dibatalkan: ${y.cancelledOrders}`,
    "",
    `⏳ <b>Order Macet (&gt;30 menit)</b>`,
  ];

  if (data.stuck.count === 0) {
    lines.push("• Tidak ada order macet");
  } else {
    const codeList = data.stuck.codes.map((c) => `<code>${escapeHtml(truncate(c, 32))}</code>`).join(", ");
    const extra = data.stuck.count > data.stuck.codes.length ? ` (+${data.stuck.count - data.stuck.codes.length} lainnya)` : "";
    lines.push(`• <b>${data.stuck.count}</b> order: ${codeList}${extra}`);
  }
  if (data.stuck.paymentAttention > 0) {
    lines.push(`• Rekonsiliasi QRIS perlu cek: <b>${data.stuck.paymentAttention}</b>`);
  }

  lines.push("", `🏦 <b>Saldo Supplier Tersimpan</b>`);
  if (data.balances.length === 0) {
    lines.push("• Belum ada data saldo tersimpan");
  } else {
    for (const b of data.balances) {
      const lowTag = b.isLow ? ` ⚠️ (di bawah ${escapeHtml(b.thresholdFormatted)})` : "";
      const errTag = b.error ? ` — <code>${escapeHtml(truncate(b.error, 48))}</code>` : "";
      lines.push(`• ${escapeHtml(b.label)}: <b>${escapeHtml(b.formatted)}</b>${lowTag}${errTag}`);
    }
  }

  lines.push("", `🔄 <b>Status Sinkronisasi</b>`);
  if (data.sync.currentlyStale.length === 0 && data.sync.recoveredLast24h.length === 0) {
    lines.push("• Semua sinkronisasi sehat (24 jam terakhir)");
  } else {
    for (const s of data.sync.currentlyStale) {
      const errTag = s.error ? ` — <code>${escapeHtml(truncate(s.error, 48))}</code>` : "";
      lines.push(`• Basi saat ini: <b>${escapeHtml(s.label)}</b> (${escapeHtml(s.ageLabel)})${errTag}`);
    }
    if (data.sync.recoveredLast24h.length > 0) {
      lines.push(`• Sempat basi 24j terakhir (pulih): ${data.sync.recoveredLast24h.map(escapeHtml).join(", ")}`);
    }
  }

  lines.push("", `📦 <b>Stok Menipis (≤2, Terlaris 30 Hari)</b>`);
  if (data.lowStock.length === 0) {
    lines.push("• Tidak ada produk laris dengan stok ≤2");
  } else {
    for (const item of data.lowStock) {
      lines.push(
        `• <b>${escapeHtml(truncate(item.name, 48))}</b> — stok <b>${item.effectiveStock}</b> (terjual 30h: ${item.sold30d})`,
      );
    }
  }

  // Pangkas aman per baris bila mendekati batas Telegram 4.096 karakter agar tag HTML tidak terpotong.
  const out: string[] = [];
  let len = 0;
  for (const line of lines) {
    const add = out.length === 0 ? line.length : line.length + 1;
    if (len + add > MAX_TELEGRAM_HTML_CHARS) {
      out.push("• <i>(ringkasan dipotong agar sesuai batas Telegram)</i>");
      break;
    }
    out.push(line);
    len += add;
  }
  return out.join("\n");
}

export async function sendDueDailyAdminSummary(
  db: DatabaseAccess,
  opts: { now?: Date } = {},
): Promise<DailyAdminSummaryResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const wib = wibDateInfo(now);

  if (wib.hourWib < DAILY_SUMMARY_START_HOUR_WIB || wib.hourWib >= DAILY_SUMMARY_END_HOUR_WIB) {
    return { due: false, sent: false };
  }

  const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  const botToken = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (process.env.TELEGRAM_BOT_ENABLED !== "true" || !chatId || !botToken) {
    return { due: true, sent: false, skipped: "disabled", date: wib.todayWib };
  }

  const d1 = unwrapD1(db.getD1());
  if (d1 && sentDateByD1.get(d1) === wib.todayWib) {
    return { due: true, sent: false, skipped: "already_sent", date: wib.todayWib };
  }

  if (!db.canSpend(1)) {
    return { due: true, sent: false, skipped: "query_budget", date: wib.todayWib };
  }

  const row = await db.queryFirst(
    `SELECT value FROM store_settings WHERE key=?`,
    DAILY_ADMIN_SUMMARY_STATE_KEY,
  );
  const rawState = row ? String(row.value ?? "") : null;
  const parsed = parseSummaryState(rawState);

  if (parsed.sent_date === wib.todayWib) {
    if (d1) sentDateByD1.set(d1, wib.todayWib);
    return { due: true, sent: false, skipped: "already_sent", date: wib.todayWib };
  }

  if (typeof parsed.claiming_until === "number" && parsed.claiming_until > nowMs) {
    return { due: true, sent: false, skipped: "claimed", date: wib.todayWib };
  }

  if (!db.canSpend(10)) {
    return { due: true, sent: false, skipped: "query_budget", date: wib.todayWib };
  }

  const claimValue = JSON.stringify({
    ...(parsed.sent_date ? { sent_date: parsed.sent_date } : {}),
    claiming_until: nowMs + DAILY_SUMMARY_CLAIM_TTL_MS,
  });
  const claimed = await casSummaryState(db, rawState, claimValue);
  if (!claimed) {
    return { due: true, sent: false, skipped: "cas_lost", date: wib.todayWib };
  }

  let data: DailyAdminSummaryData;
  try {
    data = await collectDailyAdminSummaryData(db, now);
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) throw error;
    throw error;
  }

  const text = formatDailyAdminSummaryHtml(data, wib.yesterdayLabel);
  const sentRes = await sendMessage({
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  }).catch((err) => ({ ok: false as const, description: err instanceof Error ? err.message : "send_error" }));

  if (!sentRes.ok) {
    // Lepas klaim agar tick berikutnya dalam jendela 07:00-11:59 WIB bisa mencoba ulang.
    if (db.canSpend(1)) {
      const releaseValue = parsed.sent_date ? JSON.stringify({ sent_date: parsed.sent_date }) : "";
      await casSummaryState(db, claimValue, releaseValue).catch(() => undefined);
    }
    return {
      due: true,
      sent: false,
      skipped: "send_failed",
      date: wib.todayWib,
      error: sanitizeSyncError(sentRes.description ?? "telegram_send_failed"),
    };
  }

  const doneValue = JSON.stringify({
    sent_date: wib.todayWib,
    sent_at: now.toISOString(),
  });
  await casSummaryState(db, claimValue, doneValue);
  if (d1) sentDateByD1.set(d1, wib.todayWib);

  return {
    due: true,
    sent: true,
    date: wib.todayWib,
    summary: data,
  };
}
