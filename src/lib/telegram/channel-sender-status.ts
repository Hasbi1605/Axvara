// src/lib/telegram/channel-sender-status.ts — status "Pengirim channel" untuk promo
// Channel Telegram: konfigurasi jalur userbot, cek kesehatan userbot di VPS,
// catatan pengiriman terakhir (`store_settings.telegram_channel_last_delivery`),
// alert ke grup admin (`TELEGRAM_ADMIN_CHAT_ID`, "Axvara_Notif") dan pemantau
// kesehatan userbot (`store_settings.telegram_userbot_watch_state`).
//
// Aturan: tidak pernah melempar ke pemanggil pengiriman promo; tidak memuat
// secret/token pada teks alert; D1 minimal (1 baca + 1 tulis per outcome channel,
// 1 baca + 1 tulis per cek kesehatan ≤ tiap 30 menit).

import { getWrProxyUrl } from "@/lib/warung-rebahan/client";
import type { DatabaseAccess } from "@/lib/db-access";

export const TELEGRAM_CHANNEL_LAST_DELIVERY_KEY = "telegram_channel_last_delivery";
export const TELEGRAM_USERBOT_WATCH_KEY = "telegram_userbot_watch_state";
export const USERBOT_WATCH_INTERVAL_MS = 30 * 60 * 1000;
export const USERBOT_HEALTH_TIMEOUT_MS = 5_000;

const STAGING_CHAT_ID_PATTERN = /^-100\d{5,20}$/;

export type ChannelDeliveryVia = "userbot" | "bot_fallback" | "bot";
export type ChannelDeliveryButtons = "attached" | "failed" | "n/a";
export type ChannelAlertKind = "fallback" | "unknown" | "buttons" | "failed";

/** Metadata hasil kirim channel yang dibawa `SendOutcome` dari sender ke worker. */
export type ChannelDeliveryMeta = {
  via: ChannelDeliveryVia;
  buttons: ChannelDeliveryButtons;
  reason?: string;
};

export type ChannelLastDelivery = {
  at: string;
  slot: string;
  businessDate: string;
  via: ChannelDeliveryVia;
  state: string;
  buttons: ChannelDeliveryButtons;
  reason?: string;
  /** Jenis alert yang sudah dikirim untuk slot ini (dedupe satu alert per slot per jenis). */
  alerted?: ChannelAlertKind[];
};

export type UserbotHealth = { reachable: boolean; ready: boolean };

export type ChannelSenderStatus = {
  mode: "userbot" | "bot";
  configured: boolean;
  userbot: UserbotHealth | null;
  lastDelivery: ChannelLastDelivery | null;
};

export function userbotModeEnabled(): boolean {
  return process.env.TELEGRAM_CHANNEL_USERBOT_ENABLED === "true";
}

/** Konfigurasi lengkap jalur userbot; `null` bila flag off atau ada yang kurang. */
export function getUserbotConfig(): { stagingChatId: string; proxyUrl: string; proxyToken: string } | null {
  if (!userbotModeEnabled()) return null;
  const stagingChatId = (process.env.TELEGRAM_PROMO_STAGING_CHAT_ID || "").trim();
  if (!STAGING_CHAT_ID_PATTERN.test(stagingChatId)) return null;
  const proxyUrl = getWrProxyUrl();
  const proxyToken = (process.env.WARUNG_REBAHAN_PROXY_TOKEN || "").trim();
  if (!proxyUrl || !proxyToken) return null;
  return { stagingChatId, proxyUrl, proxyToken };
}

/**
 * Cek langsung `GET {proxy}/tgu/health` (timeout 5 dtk). Hanya HTTP 200 yang
 * dianggap terjangkau; 404/status lain/jaringan = tidak terjangkau.
 */
export async function checkUserbotHealth(): Promise<UserbotHealth> {
  const proxyUrl = getWrProxyUrl();
  const proxyToken = (process.env.WARUNG_REBAHAN_PROXY_TOKEN || "").trim();
  if (!proxyUrl || !proxyToken) return { reachable: false, ready: false };
  try {
    const response = await fetch(proxyUrl + "/tgu/health", {
      method: "GET",
      headers: { "x-proxy-token": proxyToken },
      redirect: "manual",
      signal: AbortSignal.timeout(USERBOT_HEALTH_TIMEOUT_MS),
    });
    if (response.status !== 200) return { reachable: false, ready: false };
    const body = await response.json().catch(() => null) as { ok?: unknown; ready?: unknown } | null;
    if (!body || typeof body !== "object") return { reachable: false, ready: false };
    return { reachable: true, ready: body.ok !== false && body.ready === true };
  } catch {
    return { reachable: false, ready: false };
  }
}

const VIA_VALUES = new Set<string>(["userbot", "bot_fallback", "bot"]);
const BUTTON_VALUES = new Set<string>(["attached", "failed", "n/a"]);
const ALERT_KINDS = new Set<string>(["fallback", "unknown", "buttons", "failed"]);

export function parseChannelLastDelivery(raw: unknown): ChannelLastDelivery | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChannelLastDelivery> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.at !== "string" || typeof parsed.slot !== "string" || typeof parsed.businessDate !== "string") return null;
    if (typeof parsed.via !== "string" || !VIA_VALUES.has(parsed.via)) return null;
    if (typeof parsed.state !== "string") return null;
    const buttons = typeof parsed.buttons === "string" && BUTTON_VALUES.has(parsed.buttons) ? parsed.buttons : "n/a";
    const alerted = Array.isArray(parsed.alerted)
      ? parsed.alerted.filter((k): k is ChannelAlertKind => typeof k === "string" && ALERT_KINDS.has(k))
      : [];
    return {
      at: parsed.at,
      slot: parsed.slot,
      businessDate: parsed.businessDate,
      via: parsed.via as ChannelDeliveryVia,
      state: parsed.state,
      buttons: buttons as ChannelDeliveryButtons,
      ...(typeof parsed.reason === "string" && parsed.reason ? { reason: parsed.reason.slice(0, 60) } : {}),
      ...(alerted.length ? { alerted } : {}),
    };
  } catch {
    return null;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slotLabel(slot: string): string {
  return slot === "morning" ? "Pagi" : slot === "evening" ? "Sore" : slot;
}

function safeReason(reason: string | undefined): string {
  const text = String(reason ?? "").replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 60);
  return text || "tidak_diketahui";
}

/** Kirim alert singkat ke grup admin; `false` bila tidak dikonfigurasi/gagal. Tidak pernah melempar. */
export async function sendChannelAdminAlert(text: string): Promise<boolean> {
  const chatId = (process.env.TELEGRAM_ADMIN_CHAT_ID ?? "").trim();
  if (!chatId || process.env.TELEGRAM_BOT_ENABLED !== "true" || !process.env.TELEGRAM_BOT_TOKEN) return false;
  try {
    const { sendMessage } = await import("@/lib/telegram/api");
    const result = await sendMessage({ chat_id: chatId, text, parse_mode: "HTML" });
    return result?.ok === true;
  } catch {
    return false;
  }
}

export function channelAlertKinds(state: string, meta: ChannelDeliveryMeta): ChannelAlertKind[] {
  if (state === "failed") return ["failed"];
  if (state === "unknown") return ["unknown"];
  if (state !== "sent") return [];
  const kinds: ChannelAlertKind[] = [];
  if (meta.via === "bot_fallback") kinds.push("fallback");
  if (meta.buttons === "failed") kinds.push("buttons");
  return kinds;
}

export function channelAlertText(
  kind: ChannelAlertKind,
  slot: string,
  meta: ChannelDeliveryMeta,
  destination: string,
): string {
  const label = slotLabel(slot);
  const handle = /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(destination) ? "@" + destination.replace(/^@/, "") : "channel";
  switch (kind) {
    case "fallback":
      return `⚠️ Promo channel ${label} dikirim lewat bot cadangan (emoji tidak bergerak). Sebab: ${escapeHtml(safeReason(meta.reason))}.`;
    case "unknown":
      return meta.via === "userbot"
        ? `⚠️ Promo channel ${label}: hasil forward userbot tidak pasti — cek ${escapeHtml(handle)}.`
        : `⚠️ Promo channel ${label}: hasil kirim lewat bot tidak pasti — cek ${escapeHtml(handle)}.`;
    case "buttons":
      return `⚠️ Promo channel ${label} terkirim tanpa tombol (gagal pasang tombol).`;
    case "failed":
      return `⚠️ Promo channel ${label} gagal terkirim${meta.via === "bot_fallback" ? " (userbot terkendala, bot cadangan juga gagal)" : ""}. Sebab: ${escapeHtml(safeReason(meta.reason))}.`;
  }
}

/**
 * Catat hasil akhir promo channel (sent/unknown/failed) ke `store_settings` dan kirim
 * alert bila perlu (maks. satu per slot per jenis). Best-effort: error apa pun
 * ditelan agar pengiriman tidak terganggu.
 */
export async function recordChannelPromoDelivery(
  db: DatabaseAccess,
  input: {
    slot: string;
    businessDate: string;
    state: string;
    destination: string;
    meta: ChannelDeliveryMeta | undefined;
    now?: number;
  },
): Promise<{ recorded: boolean; alerts: ChannelAlertKind[] }> {
  const { meta, state } = input;
  if (!meta || !(state === "sent" || state === "unknown" || state === "failed")) return { recorded: false, alerts: [] };
  try {
    if (!db.canSpend(2)) return { recorded: false, alerts: [] };
    const existing = parseChannelLastDelivery(
      (await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, TELEGRAM_CHANNEL_LAST_DELIVERY_KEY))?.value,
    );
    const sameSlot = existing && existing.slot === input.slot && existing.businessDate === input.businessDate;
    const alreadyAlerted = new Set<ChannelAlertKind>(sameSlot ? existing.alerted ?? [] : []);
    const fresh = channelAlertKinds(state, meta).filter((kind) => !alreadyAlerted.has(kind));
    const record: ChannelLastDelivery = {
      at: new Date(input.now ?? Date.now()).toISOString(),
      slot: input.slot,
      businessDate: input.businessDate,
      via: meta.via,
      state,
      buttons: meta.buttons,
      ...(meta.reason ? { reason: meta.reason.slice(0, 60) } : {}),
      ...(alreadyAlerted.size || fresh.length ? { alerted: [...alreadyAlerted, ...fresh] } : {}),
    };
    await db.execRun(
      `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
      TELEGRAM_CHANNEL_LAST_DELIVERY_KEY,
      JSON.stringify(record),
    );
    for (const kind of fresh) {
      await sendChannelAdminAlert(channelAlertText(kind, input.slot, meta, input.destination));
    }
    return { recorded: true, alerts: fresh };
  } catch {
    return { recorded: false, alerts: [] };
  }
}

type WatchState = { state: "ready" | "down"; reason: string | null; checkedAt: string; since: string };

function parseWatchState(raw: unknown): WatchState | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WatchState> | null;
    if (!parsed || (parsed.state !== "ready" && parsed.state !== "down")) return null;
    return {
      state: parsed.state,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : "",
      since: typeof parsed.since === "string" ? parsed.since : "",
    };
  } catch {
    return null;
  }
}

let lastWatchAttemptMs = 0;

/** Hanya untuk test. */
export function resetUserbotWatchMemo(): void {
  lastWatchAttemptMs = 0;
}

export type UserbotWatchResult = {
  checked: boolean;
  state?: "ready" | "down";
  alerted?: "down" | "recovered";
};

/**
 * Pemantau kesehatan userbot (dipanggil dari cron `promo` tiap menit, tetapi hanya
 * bekerja bila mode userbot aktif dan sudah ≥ 30 menit sejak cek terakhir).
 * Biaya D1: 0 statement bila memo isolate/interval belum lewat; selain itu 1 baca
 * + 1 tulis. Alert hanya pada transisi (siap → terkendala, terkendala → pulih);
 * bila kirim alert gagal, status tersimpan tidak maju sehingga dicoba lagi.
 */
export async function watchUserbotHealth(db: DatabaseAccess, now: number = Date.now()): Promise<UserbotWatchResult> {
  if (!userbotModeEnabled()) return { checked: false };
  if (now - lastWatchAttemptMs < USERBOT_WATCH_INTERVAL_MS) return { checked: false };
  if (!db.canSpend(2)) return { checked: false };
  lastWatchAttemptMs = now;

  const previous = parseWatchState(
    (await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, TELEGRAM_USERBOT_WATCH_KEY))?.value,
  );
  const previousChecked = previous?.checkedAt ? Date.parse(previous.checkedAt) : NaN;
  if (Number.isFinite(previousChecked) && now - previousChecked < USERBOT_WATCH_INTERVAL_MS) {
    lastWatchAttemptMs = previousChecked;
    return { checked: false };
  }

  const health = await checkUserbotHealth();
  const state: "ready" | "down" = health.reachable && health.ready ? "ready" : "down";
  const reason = state === "ready" ? null : health.reachable ? "not_ready" : "unreachable";

  let alerted: UserbotWatchResult["alerted"];
  let notified = true;
  if (state === "down" && previous?.state !== "down") {
    notified = await sendChannelAdminAlert(
      `⚠️ Userbot channel terkendala (${reason === "unreachable" ? "tidak terjangkau" : "belum siap"}). Promo channel akan jatuh ke bot cadangan (emoji tidak bergerak).`,
    );
    if (notified) alerted = "down";
  } else if (state === "ready" && previous?.state === "down") {
    notified = await sendChannelAdminAlert("✅ Userbot channel pulih — promo channel kembali lewat userbot.");
    if (notified) alerted = "recovered";
  }

  // Alert transisi gagal terkirim: pertahankan status lama agar dicoba lagi pada cek berikutnya.
  const storedState: "ready" | "down" = notified ? state : previous?.state ?? "ready";
  const storedReason = notified ? reason : previous?.reason ?? null;
  const nowIso = new Date(now).toISOString();
  const stored: WatchState = {
    state: storedState,
    reason: storedReason,
    checkedAt: nowIso,
    since: previous && previous.state === storedState && previous.since ? previous.since : nowIso,
  };
  await db.execRun(
    `INSERT INTO store_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`,
    TELEGRAM_USERBOT_WATCH_KEY,
    JSON.stringify(stored),
  );
  return { checked: true, state, ...(alerted ? { alerted } : {}) };
}
