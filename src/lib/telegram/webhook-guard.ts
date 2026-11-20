// src/lib/telegram/webhook-guard.ts — Deteksi antrean webhook Telegram tertahan & pemulihan otomatis
import type { DatabaseAccess } from "@/lib/db-access";
import {
  canonicalWebhookUrl,
  deleteWebhook,
  getWebhookInfo,
  sendMessage,
  setWebhook,
} from "@/lib/telegram/api";

/** Timeout = ambigu: saat Bot API hang Telegram menahan lalu tetap mengirim pesan
 * (insiden 20 Nov 2026). Untuk alert guard, anggap sudah terkirim agar run tiap
 * menit tidak menumpuk salinan; kehilangan satu alert lebih baik daripada spam. */
function alertDelivered(res: { ok?: boolean; description?: string }): boolean {
  return res.ok === true || res.description === "Request timeout";
}
export const TG_WEBHOOK_GUARD_STATE_KEY = "tg_webhook_guard_state";
export const STUCK_PENDING_THRESHOLD = 3;
export const STUCK_ERROR_WINDOW_MS = 180_000;
export const KICK_COOLDOWN_MS = 5 * 60_000;
export const ALERT_COOLDOWN_MS = 30 * 60_000;

export type TgWebhookGuardState = {
  last_kick_at?: number | null;
  last_alert_at?: number | null;
  stuck_alert_active?: boolean;
  last_kick_reason?: "stuck" | "wrong_url" | null;
  last_kick_ok?: boolean | null;
};

export type TgWebhookGuardResult = {
  status:
    | "skipped"
    | "healthy"
    | "recovered"
    | "stuck_kicked"
    | "stuck_cooldown"
    | "wrong_url_kicked"
    | "wrong_url_cooldown"
    | "kick_failed"
    | "info_failed"
    | "error";
  skipped?: string;
  url?: string;
  pending_update_count?: number;
  is_stuck?: boolean;
  is_wrong_url?: boolean;
  kicked?: boolean;
  kick_ok?: boolean;
  alerted?: boolean;
  recovery_alerted?: boolean;
  error?: string;
};

export function sanitizeGuardError(value: unknown): string {
  let text = String(value ?? "");
  for (const secret of [
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_WEBHOOK_SECRET,
    process.env.CRON_SECRET,
  ]) {
    if (!secret) continue;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "g"), "[REDACTED]");
  }
  return text
    .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "https://api.telegram.org/bot[REDACTED]")
    .replace(/\bBearer\s+[^\s"',;<>]+/gi, "Bearer [REDACTED]")
    .replace(
      /([\w-]*(?:token|secret|key|authorization)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&<>]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function parseWebhookGuardState(raw: unknown): TgWebhookGuardState {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      last_kick_at:
        typeof parsed.last_kick_at === "number" && Number.isFinite(parsed.last_kick_at)
          ? parsed.last_kick_at
          : null,
      last_alert_at:
        typeof parsed.last_alert_at === "number" && Number.isFinite(parsed.last_alert_at)
          ? parsed.last_alert_at
          : null,
      stuck_alert_active: parsed.stuck_alert_active === true,
      last_kick_reason:
        parsed.last_kick_reason === "stuck" || parsed.last_kick_reason === "wrong_url"
          ? parsed.last_kick_reason
          : null,
      last_kick_ok: typeof parsed.last_kick_ok === "boolean" ? parsed.last_kick_ok : null,
    };
  } catch {
    return {};
  }
}

function formatWibHm(ms: number): string {
  return new Date(ms + 7 * 3_600_000).toISOString().slice(11, 16);
}

async function casGuardState(
  db: DatabaseAccess,
  expectedRaw: string | null,
  nextState: TgWebhookGuardState,
): Promise<string | null> {
  const nextRaw = JSON.stringify(nextState);
  const res =
    expectedRaw === null
      ? await db.execRun(
          `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
           WHERE COALESCE(store_settings.value, '') = ''`,
          TG_WEBHOOK_GUARD_STATE_KEY,
          nextRaw,
        )
      : await db.execRun(
          `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
           WHERE store_settings.value = ?`,
          TG_WEBHOOK_GUARD_STATE_KEY,
          nextRaw,
          expectedRaw,
        );
  return Number(res.changes ?? 0) > 0 ? nextRaw : null;
}

async function upsertGuardState(db: DatabaseAccess, nextState: TgWebhookGuardState): Promise<void> {
  await db.execRun(
    `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    TG_WEBHOOK_GUARD_STATE_KEY,
    JSON.stringify(nextState),
  );
}

export async function guardTelegramWebhook(
  db: DatabaseAccess,
  opts?: { nowMs?: number },
): Promise<TgWebhookGuardResult> {
  try {
    if (process.env.TELEGRAM_BOT_ENABLED !== "true") {
      return { status: "skipped", skipped: "bot_disabled" };
    }
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
    if (!botToken || !webhookSecret) {
      return { status: "skipped", skipped: "not_configured" };
    }

    const nowMs = opts?.nowMs ?? Date.now();
    const infoRes = await getWebhookInfo();
    if (!infoRes.ok || !infoRes.result) {
      return {
        status: "info_failed",
        error: sanitizeGuardError(infoRes.description || "getWebhookInfo_failed"),
      };
    }

    const info = infoRes.result;
    const canonicalUrl = canonicalWebhookUrl();
    const actualUrl = String(info.url ?? "").trim();
    const pendingRaw = Number(info.pending_update_count ?? 0);
    const pending = Number.isFinite(pendingRaw) && pendingRaw > 0 ? Math.floor(pendingRaw) : 0;
    const lastErrorSec =
      typeof info.last_error_date === "number" &&
      Number.isFinite(info.last_error_date) &&
      info.last_error_date > 0
        ? info.last_error_date
        : null;
    const hasRecentError =
      lastErrorSec !== null && nowMs - lastErrorSec * 1000 <= STUCK_ERROR_WINDOW_MS;
    const isStuck = pending >= STUCK_PENDING_THRESHOLD && hasRecentError;
    const isWrongUrl = actualUrl !== canonicalUrl;

    const row = await db.queryFirst(
      `SELECT value FROM store_settings WHERE key=?`,
      TG_WEBHOOK_GUARD_STATE_KEY,
    );
    const rawState = row?.value == null ? null : String(row.value);
    const state = parseWebhookGuardState(rawState);
    const adminChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();

    if (!isStuck && !isWrongUrl) {
      if (pending === 0 && state.stuck_alert_active) {
        let recoveryAlerted = false;
        if (adminChatId) {
          const recRes = await sendMessage({
            chat_id: adminChatId,
            text: "✅ Bot Telegram pulih (antrean kosong)",
            disable_web_page_preview: true,
          });
          recoveryAlerted = alertDelivered(recRes);
        }
        if (recoveryAlerted || !adminChatId) {
          await upsertGuardState(db, {
            ...state,
            stuck_alert_active: false,
            last_alert_at: null,
          });
        }
        return {
          status: "recovered",
          url: actualUrl,
          pending_update_count: 0,
          kicked: false,
          recovery_alerted: recoveryAlerted,
        };
      }
      return {
        status: "healthy",
        url: actualUrl,
        pending_update_count: pending,
        kicked: false,
      };
    }

    const reason: "stuck" | "wrong_url" = isStuck ? "stuck" : "wrong_url";
    const canKick = !state.last_kick_at || nowMs - state.last_kick_at >= KICK_COOLDOWN_MS;
    let kicked = false;
    let kickOk = false;
    let kickError: string | undefined;
    let latestState: TgWebhookGuardState = state;

    if (canKick) {
      const claimedState: TgWebhookGuardState = {
        ...state,
        last_kick_at: nowMs,
        last_kick_reason: reason,
        last_kick_ok: null,
      };
      const claimedRaw = await casGuardState(db, rawState, claimedState);
      if (claimedRaw !== null) {
        kicked = true;
        // Selalu drop_pending_updates:false agar tidak ada update pembeli yang terbuang.
        await deleteWebhook();
        let setRes = await setWebhook(canonicalUrl, webhookSecret);
        if (!setRes.ok) {
          // Retry segera sekali lagi; jangan biarkan webhook dalam kondisi terhapus.
          setRes = await setWebhook(canonicalUrl, webhookSecret);
        }
        if (setRes.ok) {
          kickOk = true;
        } else {
          kickOk = false;
          kickError = sanitizeGuardError(setRes.description || "setWebhook_failed");
          if (adminChatId) {
            await sendMessage({
              chat_id: adminChatId,
              text: `🚨 KRITIS: Pemasangan ulang webhook Bot Telegram GAGAL setelah deleteWebhook (${pending} update antre) · error: ${kickError}`,
              disable_web_page_preview: true,
            });
          }
        }
        latestState = { ...claimedState, last_kick_ok: kickOk };
        await upsertGuardState(db, latestState);
      }
    }

    let alerted = false;
    const alertDue = !latestState.last_alert_at || nowMs - latestState.last_alert_at >= ALERT_COOLDOWN_MS;
    if (isStuck && !kickError && alertDue && adminChatId) {
      const hhmm = formatWibHm(lastErrorSec! * 1000);
      const errMsg = sanitizeGuardError(info.last_error_message || "unknown error") || "unknown error";
      const alertText = `⚠️ Bot Telegram tertahan: ${pending} update antre · error terakhir ${hhmm} WIB: ${errMsg} · webhook dipasang ulang otomatis`;
      const alertRes = await sendMessage({
        chat_id: adminChatId,
        text: alertText,
        disable_web_page_preview: true,
      });
      if (alertDelivered(alertRes)) {
        alerted = true;
        latestState = {
          ...latestState,
          last_alert_at: nowMs,
          stuck_alert_active: true,
        };
        await upsertGuardState(db, latestState);
      }
    }

    return {
      status: kickError
        ? "kick_failed"
        : kicked
          ? isStuck
            ? "stuck_kicked"
            : "wrong_url_kicked"
          : isStuck
            ? "stuck_cooldown"
            : "wrong_url_cooldown",
      url: actualUrl,
      pending_update_count: pending,
      is_stuck: isStuck,
      is_wrong_url: isWrongUrl,
      kicked,
      ...(kicked ? { kick_ok: kickOk } : {}),
      alerted,
      ...(kickError ? { error: kickError } : {}),
    };
  } catch (error) {
    return {
      status: "error",
      error: sanitizeGuardError(error instanceof Error ? error.message : "guard_failed") || "guard_failed",
    };
  }
}
