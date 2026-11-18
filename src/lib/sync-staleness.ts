import { QueryBudgetExceeded, type DatabaseAccess } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";
import { formatWibDateTime } from "@/lib/utils";
import { parseStoredSyncError, sanitizeSyncError } from "@/lib/sync-status";
import { isSkSyncEnabled } from "@/lib/sekalipay/client";
import { isWrSyncEnabled } from "@/lib/warung-rebahan/client";
import { isTunvnConfigured, isTunvnSyncEnabled } from "@/lib/tunvn/client";
import { isAivaultConfigured, isAivaultSyncEnabled } from "@/lib/aivault/client";
import { isGamesSkCatalogConfigured } from "@/lib/games/sk-catalog-sync";
import { isPediaProxyConfigured } from "@/lib/pedia/proxy";
import { isNowpaymentsReadable } from "@/lib/payments/rails";
import { CRYPTO_REFRESH_AFTER_MS } from "@/lib/payments/market-snapshot";

export const STALE_MIN_THRESHOLD_MS = 15 * 60_000;
export const STALE_REMINDER_INTERVAL_MS = 6 * 60 * 60_000;
export const NEVER_SUCCEEDED_GRACE_MS = 60 * 60_000;

/**
 * Ambang batas basi per sumber: max(15 menit, 3 × interval normal).
 * - WR (`alertStaleWrSync`): ditangani watchdog WR existing di `/api/cron/operations`
 *   (90 menit, `wr_sync_state.sync_stale_alerted_at`) dan dikecualikan di sini
 *   untuk menghindari alert Telegram ganda.
 * - SK diff: VPS diff 1 menit → max(15m, 3×1m) = 15 menit; fallback sweep
 *   per jam (bila `diff_last_at` belum ada) → 90 menit.
 * - Jaspay: cron lite 1 menit → max(15m, 3×1m) = 15 menit.
 * - TUNVN: cron lite 1 menit → max(15m, 3×1m) = 15 menit.
 * - AIVault: cron lite 1 menit → max(15m, 3×1m) = 15 menit.
 * - Games (SK): cron lite 10 menit → max(15m, 3×10m) = 30 menit.
 * - Pedia (IndoSMM diff): VPS diff 10 menit → max(15m, 3×10m) = 30 menit.
 * - FX Pasar Crypto (`crypto_market_snapshot`): refresh 30 menit → max(15m, 3×30m) = 90 menit.
 */
export const SYNC_STALENESS_THRESHOLDS_MS = {
  sk_diff: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 60_000),
  sk_sweep: 90 * 60_000,
  jaspay: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 60_000),
  tunvn: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 60_000),
  tunvn_buff: STALE_MIN_THRESHOLD_MS,
  aivault: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 60_000),
  games_sk: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 10 * 60_000),
  pedia_indosmm: Math.max(STALE_MIN_THRESHOLD_MS, 3 * 10 * 60_000),
  crypto_market: Math.max(STALE_MIN_THRESHOLD_MS, 3 * CRYPTO_REFRESH_AFTER_MS),
} as const;

export type SyncSourceId = "sk" | "jaspay" | "tunvn" | "tunvn_buff" | "aivault" | "games_sk" | "pedia_indosmm" | "crypto_market";

export const SYNC_SOURCE_LABELS: Record<SyncSourceId, string> = {
  sk: "Sekalipay",
  jaspay: "Jaspay",
  tunvn: "TUNVN",
  tunvn_buff: "TUNVN (Muse Buff)",
  aivault: "AIVault",
  games_sk: "Games",
  pedia_indosmm: "Pedia (IndoSMM)",
  crypto_market: "FX Pasar Crypto",
};

export interface SyncStalenessResult {
  checked: boolean;
  sources: string[];
  alerted: string[];
  reminded: string[];
  recovered: string[];
  skipped?: string;
  error?: string;
}

export type StaleEpisodeState = {
  alerted_at?: number | null;
  enabled_since?: number | null;
  last_stale_at?: number | null;
  last_recovered_at?: number | null;
};

type SourceProbe = {
  id: SyncSourceId;
  label: string;
  lastSuccessMs: number | null;
  lastError: string | null;
  thresholdMs: number;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{10,16}$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return parseExpiry(trimmed);
}

export function formatAgeId(ms: number): string {
  const safe = Math.max(0, ms);
  const totalMinutes = Math.floor(safe / 60_000);
  if (totalMinutes < 1) return "< 1 menit";
  if (totalMinutes < 60) return `${totalMinutes} menit`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
}

function formatWibSuccess(ms: number | null): string {
  if (ms === null) return "Belum pernah";
  const iso = new Date(ms).toISOString();
  const formatted = formatWibDateTime(iso);
  return formatted ? `${formatted} WIB` : iso;
}

export function parseEpisodeState(raw: string | null): StaleEpisodeState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as StaleEpisodeState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      alerted_at: typeof parsed.alerted_at === "number" && Number.isFinite(parsed.alerted_at) ? parsed.alerted_at : null,
      enabled_since: typeof parsed.enabled_since === "number" && Number.isFinite(parsed.enabled_since) ? parsed.enabled_since : null,
      last_stale_at: typeof parsed.last_stale_at === "number" && Number.isFinite(parsed.last_stale_at) ? parsed.last_stale_at : null,
      last_recovered_at: typeof parsed.last_recovered_at === "number" && Number.isFinite(parsed.last_recovered_at) ? parsed.last_recovered_at : null,
    };
  } catch {
    return {};
  }
}

function serializeEpisodeState(state: StaleEpisodeState): string {
  const out: Record<string, number> = {};
  if (typeof state.alerted_at === "number" && Number.isFinite(state.alerted_at)) out.alerted_at = state.alerted_at;
  if (typeof state.enabled_since === "number" && Number.isFinite(state.enabled_since)) out.enabled_since = state.enabled_since;
  if (typeof state.last_stale_at === "number" && Number.isFinite(state.last_stale_at)) out.last_stale_at = state.last_stale_at;
  if (typeof state.last_recovered_at === "number" && Number.isFinite(state.last_recovered_at)) out.last_recovered_at = state.last_recovered_at;
  return JSON.stringify(out);
}

async function casState(
  db: DatabaseAccess,
  key: string,
  expectedRaw: string | null,
  nextValue: string,
): Promise<boolean> {
  if (!db.canSpend(1)) return false;
  const res = expectedRaw === null
    ? await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
         WHERE COALESCE(store_settings.value, '') = ''`,
        key,
        nextValue,
      )
    : await db.execRun(
        `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
         WHERE store_settings.value = ?`,
        key,
        nextValue,
        expectedRaw,
      );
  return Number(res.changes ?? 0) === 1;
}

const SETTINGS_KEYS = [
  "jaspay_catalog_success_at",
  "jaspay_catalog_last_error",
  "tunvn_catalog_success_at",
  "tunvn_catalog_last_error",
  "tunvn_buff_sync_at",
  "tunvn_buff_last_error",
  "aivault_catalog_success_at",
  "aivault_catalog_last_error",
  "games_sk_catalog_success_at",
  "games_sk_catalog_last_error",
  "pedia_indosmm_diff_last_at",
  "pedia_indosmm_diff_last_error",
  "sync_stale_state_sk",
  "sync_stale_state_jaspay",
  "sync_stale_state_tunvn",
  "sync_stale_state_tunvn_buff",
  "sync_stale_state_aivault",
  "sync_stale_state_games_sk",
  "sync_stale_state_pedia_indosmm",
  "sync_stale_state_crypto_market",
] as const;

export async function checkSyncStaleness(
  db: DatabaseAccess,
  opts: { now?: number } = {},
): Promise<SyncStalenessResult> {
  if (!db) {
    return { checked: false, sources: [], alerted: [], reminded: [], recovered: [], skipped: "db_unavailable" };
  }
  const skOn = isSkSyncEnabled();
  const jaspayOn = isWrSyncEnabled();
  const tunvnOn = isTunvnSyncEnabled() && isTunvnConfigured();
  const aivaultOn = isAivaultSyncEnabled() && isAivaultConfigured();
  const gamesOn = isGamesSkCatalogConfigured();
  const pediaOn = isPediaProxyConfigured();
  const cryptoOn = isNowpaymentsReadable();

  if (!skOn && !jaspayOn && !tunvnOn && !aivaultOn && !gamesOn && !pediaOn && !cryptoOn) {
    return { checked: true, sources: [], alerted: [], reminded: [], recovered: [] };
  }
  if (!db.canSpend(6)) {
    return { checked: false, sources: [], alerted: [], reminded: [], recovered: [], skipped: "query_budget" };
  }

  const now = opts.now ?? Date.now();
  const alerted: string[] = [];
  const reminded: string[] = [];
  const recovered: string[] = [];
  const sources: string[] = [];

  try {
    const placeholders = SETTINGS_KEYS.map(() => "?").join(",");
    const settingsRows = await db.queryAll(
      `SELECT key, value FROM store_settings WHERE key IN (${placeholders})`,
      ...SETTINGS_KEYS,
    );
    const settingsMap = new Map<string, string>();
    for (const row of settingsRows) {
      if (typeof row.key === "string" && typeof row.value === "string") {
        settingsMap.set(row.key, row.value);
      }
    }
    const rawSetting = (key: string): string | null => settingsMap.get(key) ?? null;

    const probes: SourceProbe[] = [];

    if (skOn && db.canSpend(1)) {
      const skRow = await db.queryFirst(
        `SELECT
           (SELECT value FROM sk_sync_state WHERE key='diff_last_at') AS diff_at,
           (SELECT value FROM sk_sync_state WHERE key='diff_last_error') AS diff_err,
           (SELECT created_at FROM sk_sync_log WHERE sync_type='products' AND status IN ('success','partial') ORDER BY created_at DESC LIMIT 1) AS log_at`,
      ).catch(() => null);
      const diffMs = parseTimestampMs(skRow?.diff_at);
      const logMs = parseTimestampMs(skRow?.log_at);
      const lastSuccessMs = diffMs ?? logMs ?? null;
      const thresholdMs = diffMs !== null ? SYNC_STALENESS_THRESHOLDS_MS.sk_diff : SYNC_STALENESS_THRESHOLDS_MS.sk_sweep;
      const parsedErr = parseStoredSyncError(skRow?.diff_err);
      probes.push({
        id: "sk",
        label: "Sekalipay",
        lastSuccessMs,
        lastError: parsedErr?.error ?? null,
        thresholdMs,
      });
    }

    if (jaspayOn) {
      probes.push({
        id: "jaspay",
        label: "Jaspay",
        lastSuccessMs: parseTimestampMs(rawSetting("jaspay_catalog_success_at")),
        lastError: parseStoredSyncError(rawSetting("jaspay_catalog_last_error"))?.error ?? null,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.jaspay,
      });
    }

    if (tunvnOn) {
      probes.push({
        id: "tunvn",
        label: "TUNVN",
        lastSuccessMs: parseTimestampMs(rawSetting("tunvn_catalog_success_at")),
        lastError: parseStoredSyncError(rawSetting("tunvn_catalog_last_error"))?.error ?? null,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.tunvn,
      });
    }

    const buffSuccessMs = parseTimestampMs(rawSetting("tunvn_buff_sync_at"));
    const buffError = parseStoredSyncError(rawSetting("tunvn_buff_last_error"))?.error ?? null;
    if (tunvnOn && (buffSuccessMs !== null || buffError !== null)) {
      probes.push({
        id: "tunvn_buff",
        label: SYNC_SOURCE_LABELS.tunvn_buff,
        lastSuccessMs: buffSuccessMs,
        lastError: buffError,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.tunvn_buff,
      });
    }

    if (aivaultOn) {
      probes.push({
        id: "aivault",
        label: "AIVault",
        lastSuccessMs: parseTimestampMs(rawSetting("aivault_catalog_success_at")),
        lastError: parseStoredSyncError(rawSetting("aivault_catalog_last_error"))?.error ?? null,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.aivault,
      });
    }

    if (gamesOn) {
      probes.push({
        id: "games_sk",
        label: "Games",
        lastSuccessMs: parseTimestampMs(rawSetting("games_sk_catalog_success_at")),
        lastError: parseStoredSyncError(rawSetting("games_sk_catalog_last_error"))?.error ?? null,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.games_sk,
      });
    }

    if (pediaOn) {
      const pediaLastMs = parseTimestampMs(rawSetting("pedia_indosmm_diff_last_at"));
      if (pediaLastMs !== null) {
        probes.push({
          id: "pedia_indosmm",
          label: "Pedia (IndoSMM)",
          lastSuccessMs: pediaLastMs,
          lastError: parseStoredSyncError(rawSetting("pedia_indosmm_diff_last_error"))?.error ?? null,
          thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.pedia_indosmm,
        });
      }
    }

    if (cryptoOn && db.canSpend(1)) {
      const fxRow = await db.queryFirst(
        `SELECT fx_effective_at, last_error FROM crypto_market_snapshot WHERE id=1`,
      ).catch(() => null);
      const errRaw = typeof fxRow?.last_error === "string" && fxRow.last_error.trim()
        ? sanitizeSyncError(fxRow.last_error)
        : null;
      probes.push({
        id: "crypto_market",
        label: "FX Pasar Crypto",
        lastSuccessMs: parseTimestampMs(fxRow?.fx_effective_at),
        lastError: errRaw,
        thresholdMs: SYNC_STALENESS_THRESHOLDS_MS.crypto_market,
      });
    }

    const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
    const telegramReady = Boolean(chatId) && process.env.TELEGRAM_BOT_ENABLED === "true";
    let sendMessageFn: ((params: { chat_id: string; text: string; parse_mode: "HTML"; disable_web_page_preview: boolean }) => Promise<unknown>) | null = null;
    const sendTelegram = async (text: string) => {
      if (!telegramReady) return;
      if (!sendMessageFn) {
        const api = await import("@/lib/telegram/api");
        sendMessageFn = (params) => api.sendMessage(params);
      }
      await sendMessageFn({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }).catch(() => null);
    };

    for (const source of probes) {
      sources.push(source.id);
      const stateKey = `sync_stale_state_${source.id}`;
      const raw = rawSetting(stateKey);
      const state = parseEpisodeState(raw);

      if (source.lastSuccessMs === null) {
        if (state.enabled_since == null) {
          if (db.canSpend(1)) {
            await casState(
              db,
              stateKey,
              raw,
              serializeEpisodeState({
                enabled_since: now,
                last_stale_at: state.last_stale_at,
                last_recovered_at: state.last_recovered_at,
              }),
            );
          }
          continue;
        }
        const enabledAgeMs = Math.max(0, now - state.enabled_since);
        if (enabledAgeMs <= NEVER_SUCCEEDED_GRACE_MS) {
          continue;
        }
        const isReminder = state.alerted_at != null;
        if (isReminder && now - state.alerted_at! < STALE_REMINDER_INTERVAL_MS) {
          continue;
        }
        if (!telegramReady) continue;
        const claimed = await casState(
          db,
          stateKey,
          raw,
          serializeEpisodeState({
            alerted_at: now,
            enabled_since: state.enabled_since,
            last_stale_at: isReminder ? (state.last_stale_at ?? now) : now,
            last_recovered_at: state.last_recovered_at,
          }),
        );
        if (!claimed) continue;
        const lines = [
          `⚠️ <b>Sinkronisasi ${escapeHtml(source.label)} basi</b>${isReminder ? " (pengingat)" : ""}`,
          `Umur: ${escapeHtml(formatAgeId(enabledAgeMs))} (aktif tanpa sukses)`,
          `Sukses terakhir: Belum pernah`,
        ];
        if (source.lastError) {
          lines.push(`Error terakhir: <code>${escapeHtml(source.lastError)}</code>`);
        }
        await sendTelegram(lines.join("\n"));
        if (isReminder) reminded.push(source.id);
        else alerted.push(source.id);
        continue;
      }

      const ageMs = Math.max(0, now - source.lastSuccessMs);
      if (ageMs >= source.thresholdMs) {
        const isReminder = state.alerted_at != null;
        if (isReminder && now - state.alerted_at! < STALE_REMINDER_INTERVAL_MS) {
          continue;
        }
        if (!telegramReady) continue;
        const claimed = await casState(
          db,
          stateKey,
          raw,
          serializeEpisodeState({
            alerted_at: now,
            last_stale_at: isReminder ? (state.last_stale_at ?? now) : now,
            last_recovered_at: state.last_recovered_at,
          }),
        );
        if (!claimed) continue;
        const lines = [
          `⚠️ <b>Sinkronisasi ${escapeHtml(source.label)} basi</b>${isReminder ? " (pengingat)" : ""}`,
          `Umur: ${escapeHtml(formatAgeId(ageMs))} (ambang ${escapeHtml(formatAgeId(source.thresholdMs))})`,
          `Sukses terakhir: ${escapeHtml(formatWibSuccess(source.lastSuccessMs))}`,
        ];
        if (source.lastError) {
          lines.push(`Error terakhir: <code>${escapeHtml(source.lastError)}</code>`);
        }
        await sendTelegram(lines.join("\n"));
        if (isReminder) reminded.push(source.id);
        else alerted.push(source.id);
      } else if (state.alerted_at != null) {
        if (!telegramReady) continue;
        const claimed = await casState(
          db,
          stateKey,
          raw,
          serializeEpisodeState({
            last_stale_at: state.last_stale_at ?? state.alerted_at,
            last_recovered_at: now,
          }),
        );
        if (!claimed) continue;
        await sendTelegram(
          [
            `✅ <b>Sinkronisasi ${escapeHtml(source.label)} pulih</b>`,
            `Sukses terakhir: ${escapeHtml(formatWibSuccess(source.lastSuccessMs))}`,
          ].join("\n"),
        );
        recovered.push(source.id);
      } else if (state.enabled_since != null && db.canSpend(1)) {
        await casState(
          db,
          stateKey,
          raw,
          serializeEpisodeState({
            last_stale_at: state.last_stale_at,
            last_recovered_at: state.last_recovered_at,
          }),
        );
      }
    }

    return { checked: true, sources, alerted, reminded, recovered };
  } catch (error) {
    if (error instanceof QueryBudgetExceeded) {
      return { checked: false, sources, alerted, reminded, recovered, skipped: "query_budget" };
    }
    return {
      checked: false,
      sources,
      alerted,
      reminded,
      recovered,
      error: sanitizeSyncError(error),
    };
  }
}
