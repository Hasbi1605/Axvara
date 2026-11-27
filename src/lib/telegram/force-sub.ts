// src/lib/telegram/force-sub.ts — Smart Force-Join channel resmi (@axvaratech)
// dan penyimpanan konfigurasi channel Telegram di store_settings (tanpa env Pages baru).
//
// Kontrak keamanan & pengalaman pembeli:
// 1. Hanya aktif bila `forceSubEnabled=true` dan `channelUsername` valid.
// 2. Cache verifikasi di `telegram_users.channel_joined_checked_at` (default 6 jam)
//    agar klik katalog/produk tidak menambah round-trip Telegram di setiap aksi;
//    `/start` dan tombol `fsub:check` selalu cek live ke Telegram Bot API.
// 3. Fail-open: bila `getChatMember` gagal (timeout, 400/403 karena bot belum admin,
//    429, 5xx), pembeli TIDAK PERNAH terkunci; admin diberi peringatan ter-throttle
//    1x per 6 jam ke `TELEGRAM_ADMIN_CHAT_ID`.
// 4. Bypass ketat: perintah/callback pasca-bayar (/orders, cred:, refresh:, qrenew:,
//    cancel:, claim:, pdrf:, /bantuan, /bahasa, /stop, input buyer/checkout aktif)
//    tidak pernah melewati gate ini (ditegakkan di router command.ts & callback.ts).

import { createDatabaseAccess, unwrapD1, type DatabaseAccess } from "@/lib/db-access";
import { getD1, isD1Mode } from "@/lib/db";
import type { Locale } from "@/lib/i18n/locale";
import { SITE } from "@/lib/site";
import * as tgApi from "@/lib/telegram/api";
import { escapeHtml } from "@/lib/telegram/messages/format";
import type { InlineKeyboardMarkup, TelegramChatMember } from "@/lib/telegram/types";

export const TELEGRAM_CHANNEL_CONFIG_KEY = "telegram_channel_config";
export const TELEGRAM_FORCE_SUB_ALERT_KEY = "tg_force_sub_alert_state";
export const DEFAULT_FORCE_SUB_CACHE_TTL_SEC = 21_600; // 6 jam
export const MIN_FORCE_SUB_CACHE_TTL_SEC = 300; // 5 menit
export const MAX_FORCE_SUB_CACHE_TTL_SEC = 86_400; // 24 jam
export const FORCE_SUB_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const TELEGRAM_CHANNEL_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export type TelegramChannelConfig = {
  channelUsername: string;
  channelTitle: string;
  forceSubEnabled: boolean;
  channelPromoEnabled: boolean;
  cacheTtlSeconds: number;
};

export type ForceSubCheckResult = {
  allowed: boolean;
  config: TelegramChannelConfig;
  source: "disabled" | "cache" | "live" | "fail_open";
  reason?: string;
};

export type ChannelAdminVerifyResult = {
  ok: boolean;
  channelUsername: string;
  botUsername: string | null;
  isAdmin: boolean;
  canPostMessages: boolean;
  status: string | null;
  error?: string;
};

const CONFIG_MEMO_TTL_MS = 30_000;
const NO_D1_MEMO_KEY = {};
type ConfigMemoEntry = { loadedAt: number; value: TelegramChannelConfig };
let configMemoByD1 = new WeakMap<object, ConfigMemoEntry>();

function memoKeyFor(db?: DatabaseAccess): object {
  try {
    const raw = db ? db.getD1() : typeof getD1 === "function" ? getD1() : null;
    if (raw) return unwrapD1(raw) as object;
  } catch { /* fallback */ }
  return NO_D1_MEMO_KEY;
}

export function clearTelegramChannelConfigMemo(): void {
  configMemoByD1 = new WeakMap<object, ConfigMemoEntry>();
}

export function normalizeChannelUsername(raw: unknown): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";
  text = text.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "");
  text = text.replace(/^@+/, "");
  text = text.split(/[/?#\s]/)[0] ?? "";
  return TELEGRAM_CHANNEL_USERNAME_RE.test(text) ? text : "";
}

export function clampForceSubTtl(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_FORCE_SUB_CACHE_TTL_SEC;
  return Math.max(MIN_FORCE_SUB_CACHE_TTL_SEC, Math.min(MAX_FORCE_SUB_CACHE_TTL_SEC, n));
}

export function defaultTelegramChannelConfig(): TelegramChannelConfig {
  return {
    channelUsername: SITE.channelTelegram,
    channelTitle: "Axvara Official",
    forceSubEnabled: false,
    channelPromoEnabled: false,
    cacheTtlSeconds: DEFAULT_FORCE_SUB_CACHE_TTL_SEC,
  };
}

export function parseTelegramChannelConfig(raw: unknown): TelegramChannelConfig {
  const fallback = defaultTelegramChannelConfig();
  if (raw == null || String(raw).trim() === "") return fallback;
  try {
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const username = normalizeChannelUsername(parsed.channelUsername);
    const title = String(parsed.channelTitle ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 80);
    return {
      channelUsername: username || fallback.channelUsername,
      channelTitle: title || fallback.channelTitle,
      forceSubEnabled: parsed.forceSubEnabled === true,
      channelPromoEnabled: parsed.channelPromoEnabled === true,
      cacheTtlSeconds: clampForceSubTtl(parsed.cacheTtlSeconds),
    };
  } catch {
    return fallback;
  }
}

export async function readTelegramChannelConfig(
  database?: DatabaseAccess,
  options?: { bypassMemo?: boolean },
): Promise<TelegramChannelConfig> {
  const db = database ?? createDatabaseAccess();
  if (!db.getD1()) return defaultTelegramChannelConfig();
  const key = memoKeyFor(db);
  const now = Date.now();
  if (!options?.bypassMemo && key !== NO_D1_MEMO_KEY) {
    const cached = configMemoByD1.get(key);
    if (cached && now - cached.loadedAt < CONFIG_MEMO_TTL_MS) return cached.value;
  }
  try {
    const row = await db.queryFirst(
      `SELECT value FROM store_settings WHERE key=?`,
      TELEGRAM_CHANNEL_CONFIG_KEY,
    );
    const value = parseTelegramChannelConfig(row?.value);
    if (key !== NO_D1_MEMO_KEY) configMemoByD1.set(key, { loadedAt: now, value });
    return value;
  } catch {
    return defaultTelegramChannelConfig();
  }
}

export async function saveTelegramChannelConfig(
  input: Partial<TelegramChannelConfig>,
  database?: DatabaseAccess,
): Promise<TelegramChannelConfig> {
  const db = database ?? createDatabaseAccess();
  const existing = await readTelegramChannelConfig(db, { bypassMemo: true });
  const username = input.channelUsername !== undefined
    ? normalizeChannelUsername(input.channelUsername)
    : existing.channelUsername;
  if (!username) {
    throw new Error("Username channel tidak valid (4–32 karakter huruf/angka/garis bawah, diawali huruf).");
  }
  const title = input.channelTitle !== undefined
    ? String(input.channelTitle).replace(/[\r\n]+/g, " ").trim().slice(0, 80)
    : existing.channelTitle;
  const next: TelegramChannelConfig = {
    channelUsername: username,
    channelTitle: title || "Axvara Official",
    forceSubEnabled: input.forceSubEnabled !== undefined ? Boolean(input.forceSubEnabled) : existing.forceSubEnabled,
    channelPromoEnabled: input.channelPromoEnabled !== undefined ? Boolean(input.channelPromoEnabled) : existing.channelPromoEnabled,
    cacheTtlSeconds: input.cacheTtlSeconds !== undefined ? clampForceSubTtl(input.cacheTtlSeconds) : existing.cacheTtlSeconds,
  };
  await db.execRun(
    `INSERT INTO store_settings(key, value, updated_at) VALUES(?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    TELEGRAM_CHANNEL_CONFIG_KEY,
    JSON.stringify(next),
  );
  clearTelegramChannelConfigMemo();
  return next;
}

export function isChatMemberJoined(member: TelegramChatMember | undefined | null): boolean {
  if (!member) return false;
  if (member.status === "creator" || member.status === "administrator" || member.status === "member") {
    return true;
  }
  if (member.status === "restricted") {
    return member.is_member === true;
  }
  return false;
}

function parseTimestampMs(raw: unknown): number {
  if (!raw) return 0;
  const text = String(raw).trim();
  if (!text) return 0;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
    return Date.parse(text.replace(" ", "T") + "Z") || 0;
  }
  return Date.parse(text) || 0;
}

function sanitizeAlertReason(raw: string): string {
  return raw
    .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "https://api.telegram.org/bot[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** Kirim peringatan ter-throttle (maks 1x / 6 jam via CAS D1) saat cek Force-Join fail-open. */
async function notifyForceSubFailureThrottled(
  config: TelegramChannelConfig,
  reason: string,
  database: DatabaseAccess,
): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (!adminChatId || process.env.TELEGRAM_BOT_ENABLED !== "true" || !process.env.TELEGRAM_BOT_TOKEN) return;
  if (!database.getD1()) return;
  try {
    const row = await database.queryFirst(
      `SELECT value FROM store_settings WHERE key=?`,
      TELEGRAM_FORCE_SUB_ALERT_KEY,
    );
    const prevRaw = typeof row?.value === "string" ? row.value : "";
    let prevAt = 0;
    if (prevRaw) {
      try {
        prevAt = Number((JSON.parse(prevRaw) as { at?: unknown })?.at || 0);
      } catch {
        prevAt = 0;
      }
    }
    const now = Date.now();
    if (prevAt > 0 && now - prevAt < FORCE_SUB_ALERT_COOLDOWN_MS) return;

    const nextState = JSON.stringify({ at: now, channel: config.channelUsername });
    const claim = prevRaw
      ? await database.execRun(
          `UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?`,
          nextState,
          TELEGRAM_FORCE_SUB_ALERT_KEY,
          prevRaw,
        )
      : await database.execRun(
          `INSERT OR IGNORE INTO store_settings(key, value, updated_at) VALUES(?, ?, datetime('now'))`,
          TELEGRAM_FORCE_SUB_ALERT_KEY,
          nextState,
        );
    if (!claim.changes) return;

    const safeReason = escapeHtml(sanitizeAlertReason(reason || "api_error"));
    const safeHandle = escapeHtml(config.channelUsername);
    const safeBot = escapeHtml(SITE.adminTelegram);
    await tgApi.sendMessage({
      chat_id: adminChatId,
      text: [
        `⚠️ <b>Cek wajib join @${safeHandle} gagal (fail-open aktif)</b>`,
        `Alasan: <code>${safeReason}</code>`,
        `Pembeli tetap bisa belanja agar toko tidak macet. Pastikan @${safeBot} sudah menjadi <b>Administrator</b> di @${safeHandle}.`,
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch {
    // Best-effort alert — never affect buyer path.
  }
}

/**
 * Periksa apakah user sudah bergabung ke channel resmi AXVARA.
 * - `bypassCache=true` untuk `/start` dan tombol `fsub:check`.
 * - `bypassCache=false` memakai cache `telegram_users.channel_joined_checked_at` (TTL default 6 jam).
 * - Selalu fail-open bila Telegram Bot API error / bot belum admin channel.
 */
export async function checkUserChannelMembership(params: {
  userId: number;
  bypassCache?: boolean;
  database?: DatabaseAccess;
  nowMs?: number;
}): Promise<ForceSubCheckResult> {
  const db = params.database ?? createDatabaseAccess();
  const config = await readTelegramChannelConfig(db);
  if (!config.forceSubEnabled || !config.channelUsername) {
    return { allowed: true, config, source: "disabled" };
  }
  if (!Number.isSafeInteger(params.userId) || params.userId <= 0) {
    return { allowed: true, config, source: "fail_open", reason: "invalid_user_id" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const useD1 = Boolean(db.getD1()) && isD1Mode();

  if (!params.bypassCache && useD1) {
    try {
      const row = await db.queryFirst(
        `SELECT channel_joined_checked_at FROM telegram_users WHERE user_id=?`,
        String(params.userId),
      );
      const checkedMs = parseTimestampMs(row?.channel_joined_checked_at);
      if (checkedMs > 0 && nowMs - checkedMs < config.cacheTtlSeconds * 1000) {
        return { allowed: true, config, source: "cache" };
      }
    } catch {
      // Kolom belum ada / DB sibuk: lanjut ke live check.
    }
  }

  if (typeof tgApi.getChatMember !== "function") {
    return { allowed: true, config, source: "fail_open", reason: "api_unavailable" };
  }

  let res;
  try {
    res = await tgApi.getChatMember(`@${config.channelUsername}`, params.userId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "network_error";
    void notifyForceSubFailureThrottled(config, reason, db);
    return { allowed: true, config, source: "fail_open", reason };
  }

  if (!res?.ok || !res.result) {
    const reason = res?.description || (res?.error_code ? `http_${res.error_code}` : "unknown_error");
    void notifyForceSubFailureThrottled(config, reason, db);
    return { allowed: true, config, source: "fail_open", reason };
  }

  if (isChatMemberJoined(res.result)) {
    if (useD1) {
      await db.execRun(
        `UPDATE telegram_users SET channel_joined_checked_at=?, updated_at=datetime('now') WHERE user_id=?`,
        new Date(nowMs).toISOString(),
        String(params.userId),
      ).catch(() => {});
    }
    return { allowed: true, config, source: "live" };
  }

  if (useD1) {
    await db.execRun(
      `UPDATE telegram_users SET channel_joined_checked_at=NULL, updated_at=datetime('now') WHERE user_id=?`,
      String(params.userId),
    ).catch(() => {});
  }
  return { allowed: false, config, source: "live", reason: res.result.status };
}

/** Verifikasi read-only dari Panel Admin: apakah bot sudah Admin & bisa kirim pesan di channel. */
export async function verifyBotChannelAdmin(channelUsername: string): Promise<ChannelAdminVerifyResult> {
  const normalized = normalizeChannelUsername(channelUsername);
  if (!normalized) {
    return {
      ok: false,
      channelUsername: "",
      botUsername: null,
      isAdmin: false,
      canPostMessages: false,
      status: null,
      error: "Username channel tidak valid.",
    };
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      channelUsername: normalized,
      botUsername: null,
      isAdmin: false,
      canPostMessages: false,
      status: null,
      error: "TELEGRAM_BOT_TOKEN belum dikonfigurasi.",
    };
  }
  const me = await tgApi.getMe();
  if (!me.ok || !me.result?.id) {
    return {
      ok: false,
      channelUsername: normalized,
      botUsername: null,
      isAdmin: false,
      canPostMessages: false,
      status: null,
      error: sanitizeAlertReason(me.description || "Gagal membaca identitas bot (getMe)."),
    };
  }
  const botUsername = me.result.username ? `@${me.result.username}` : `@${SITE.adminTelegram}`;
  const memberRes = await tgApi.getChatMember(`@${normalized}`, me.result.id);
  if (!memberRes.ok || !memberRes.result) {
    return {
      ok: false,
      channelUsername: normalized,
      botUsername,
      isAdmin: false,
      canPostMessages: false,
      status: null,
      error: sanitizeAlertReason(
        memberRes.description
          || `Bot ${botUsername} belum menjadi Administrator di @${normalized}.`,
      ),
    };
  }
  const status = memberRes.result.status;
  const isAdmin = status === "administrator" || status === "creator";
  const canPostMessages = status === "creator" || (status === "administrator" && memberRes.result.can_post_messages !== false);
  return {
    ok: isAdmin && canPostMessages,
    channelUsername: normalized,
    botUsername,
    isAdmin,
    canPostMessages,
    status,
    ...(isAdmin && canPostMessages
      ? {}
      : {
          error: !isAdmin
            ? `${botUsername} berstatus "${status}" di @${normalized}. Tambahkan ${botUsername} sebagai Administrator channel.`
            : `${botUsername} sudah Admin di @${normalized}, namun izin "Post Messages" belum aktif.`,
        }),
  };
}

export function forceSubGateMessage(config: TelegramChannelConfig, locale: Locale | null): string {
  const title = escapeHtml(config.channelTitle || "Axvara Official");
  const handle = escapeHtml(config.channelUsername);
  if (locale === "en") {
    return [
      "<b>📢 Join Channel First</b>",
      "",
      `Join <b>${title}</b> (@${handle}) for restock alerts, promos, and full access to the AXVARA bot.`,
      "",
      "Tap <b>Join Channel</b> below, then tap <b>✅ I've Joined</b>.",
    ].join("\n");
  }
  return [
    "<b>📢 Gabung Channel Dulu</b>",
    "",
    `Gabung ke <b>${title}</b> (@${handle}) untuk info restock, promo &amp; akses penuh bot AXVARA.`,
    "",
    "Ketuk <b>Gabung Channel</b> di bawah, lalu ketuk <b>✅ Saya Sudah Gabung</b>.",
  ].join("\n");
}

export function forceSubGateKeyboard(config: TelegramChannelConfig, locale: Locale | null): InlineKeyboardMarkup {
  const en = locale === "en";
  return {
    inline_keyboard: [
      [{
        text: en ? `📢 Join @${config.channelUsername}` : `📢 Gabung @${config.channelUsername}`,
        url: `https://t.me/${config.channelUsername}`,
        style: "primary",
      }],
      [{
        text: en ? "✅ I've Joined" : "✅ Saya Sudah Gabung",
        callback_data: "fsub:check",
        style: "success",
      }],
    ],
  };
}

export function forceSubNotJoinedAlert(config: TelegramChannelConfig, locale: Locale | null): string {
  return locale === "en"
    ? `You haven't joined @${config.channelUsername} yet. Tap Join first, then try again.`
    : `Kamu belum bergabung ke @${config.channelUsername}. Ketuk tombol Gabung dulu, lalu coba lagi.`;
}
