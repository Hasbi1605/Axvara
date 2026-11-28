import { editMessageReplyMarkup, getChat, sendMessage, sendPhoto } from '@/lib/telegram/api';
import { getWrProxyUrl } from '@/lib/warung-rebahan/client';
import type { TelegramApiResponse, TelegramMessage } from '@/lib/telegram/types';
import { sendTextMessage } from '@/lib/whatsapp/gateway';
import {
  broadcastText,
  escapeHtml,
  unsubscribeUrl,
  type BroadcastChannel,
  type BroadcastPromoPayload,
  type BroadcastSnapshot,
} from './model';

export type SendOutcome = {
  state: 'sent' | 'retry' | 'unknown' | 'failed' | 'skipped';
  providerId?: string;
  error?: string;
  retryAfter?: number;
  blocked?: boolean;
  consumeAttempt?: boolean;
};

type PromoProgress = {
  photoId: string | null;
  sentChunks: number;
  lastMessageId?: string;
  /** Jalur userbot (channel saja): id numerik channel hasil getChat. */
  channelChatId?: string;
  stagingMessageId?: string;
  channelMessageId?: string;
  buttonsAttached?: boolean;
  buttonsFailed?: boolean;
};

function parsePromoProgress(raw?: string | null): PromoProgress {
  if (!raw) return { photoId: null, sentChunks: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<PromoProgress>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const channelChatId = str(parsed.channelChatId);
    const stagingMessageId = str(parsed.stagingMessageId);
    const channelMessageId = str(parsed.channelMessageId);
    return {
      photoId: typeof parsed.photoId === 'string' && parsed.photoId ? parsed.photoId : null,
      sentChunks: typeof parsed.sentChunks === 'number' && Number.isInteger(parsed.sentChunks) && parsed.sentChunks >= 0 ? parsed.sentChunks : 0,
      ...(typeof parsed.lastMessageId === 'string' && parsed.lastMessageId ? { lastMessageId: parsed.lastMessageId } : {}),
      ...(channelChatId ? { channelChatId } : {}),
      ...(stagingMessageId ? { stagingMessageId } : {}),
      ...(channelMessageId ? { channelMessageId } : {}),
      ...(parsed.buttonsAttached === true ? { buttonsAttached: true } : {}),
      ...(parsed.buttonsFailed === true ? { buttonsFailed: true } : {}),
    };
  } catch {
    return { photoId: null, sentChunks: 0 };
  }
}

function serializePromoProgress(progress: PromoProgress): string | undefined {
  return progress.photoId || progress.sentChunks > 0 || progress.channelChatId || progress.stagingMessageId || progress.channelMessageId
    ? JSON.stringify(progress)
    : undefined;
}

function classifyTelegramError(
  result: TelegramApiResponse<TelegramMessage>,
  providerId?: string,
  options?: { isChannel?: boolean },
): SendOutcome {
  if (result.error_code === 429) {
    return {
      state: 'retry',
      error: 'telegram_rate_limited',
      retryAfter: Math.max(1, Math.min(86400, Number(result.parameters?.retry_after) || 60)),
      consumeAttempt: false,
      ...(providerId ? { providerId } : {}),
    };
  }
  if (result.error_code === 401) {
    return {
      state: 'retry',
      error: 'telegram_not_authorized',
      retryAfter: 3600,
      consumeAttempt: false,
      ...(providerId ? { providerId } : {}),
    };
  }
  if (result.error_code === 403) {
    if (options?.isChannel) {
      return {
        state: 'failed',
        error: 'telegram_channel_not_admin',
        ...(providerId ? { providerId } : {}),
      };
    }
    return {
      state: 'skipped',
      error: 'telegram_blocked',
      blocked: true,
      ...(providerId ? { providerId } : {}),
    };
  }
  if (result.error_code === 400) {
    return {
      state: 'failed',
      error: options?.isChannel ? 'telegram_channel_unavailable' : 'telegram_recipient_unavailable',
      ...(providerId ? { providerId } : {}),
    };
  }
  return {
    state: 'unknown',
    error: 'telegram_delivery_unknown',
    ...(providerId ? { providerId } : {}),
  };
}

export const TELEGRAM_SAME_CHAT_PACE_MS = 300;

const USERBOT_FORWARD_TIMEOUT_MS = 25_000;
const STAGING_CHAT_ID_PATTERN = /^-100\d{5,20}$/;
const CHANNEL_NUMERIC_ID_PATTERN = /^-100\d{5,20}$/;
// Status proxy yang BERARTI userbot pasti tidak memposting apa pun, sehingga
// aman jatuh ke jalur bot langsung. Selain ini (502 outcome_unknown, 5xx lain,
// 429, timeout) hasilnya ambigu: JANGAN fallback agar tidak dobel posting.
const USERBOT_DEFINITE_REJECT_STATUSES = new Set([400, 401, 403, 404, 409, 503]);

function userbotConfig(): { stagingChatId: string; proxyUrl: string; proxyToken: string } | null {
  if (process.env.TELEGRAM_CHANNEL_USERBOT_ENABLED !== 'true') return null;
  const stagingChatId = (process.env.TELEGRAM_PROMO_STAGING_CHAT_ID || '').trim();
  if (!STAGING_CHAT_ID_PATTERN.test(stagingChatId)) return null;
  const proxyUrl = getWrProxyUrl();
  const proxyToken = (process.env.WARUNG_REBAHAN_PROXY_TOKEN || '').trim();
  if (!proxyUrl || !proxyToken) return null;
  return { stagingChatId, proxyUrl, proxyToken };
}

/**
 * Jalur channel via userbot (bot tidak bisa memposting custom emoji ke channel):
 * bot kirim ke supergroup staging -> userbot Premium forward (drop_author) ke
 * channel lewat proxy VPS `/tgu/forward` -> bot pasang tombol inline.
 * Mengembalikan `null` bila harus jatuh ke jalur bot langsung (tidak ada post
 * di channel), atau SendOutcome final.
 */
async function sendChannelPromoViaUserbot(
  destination: string,
  promo: BroadcastPromoPayload,
  message: string,
  progress: PromoProgress,
  config: { stagingChatId: string; proxyUrl: string; proxyToken: string },
): Promise<SendOutcome | null> {
  const linkPreview = promo.bannerMode === 'link_preview';
  if (!progress.channelMessageId) {
    if (!progress.channelChatId) {
      if (CHANNEL_NUMERIC_ID_PATTERN.test(destination)) {
        progress.channelChatId = destination;
      } else {
        try {
          const chat = await getChat(destination);
          const id = chat.ok && chat.result ? String(chat.result.id) : '';
          if (!CHANNEL_NUMERIC_ID_PATTERN.test(id)) return null;
          progress.channelChatId = id;
        } catch {
          return null;
        }
      }
    }
    if (!progress.stagingMessageId) {
      try {
        const staged = await sendMessage(linkPreview
          ? {
              chat_id: config.stagingChatId,
              text: message,
              parse_mode: 'HTML',
              link_preview_options: { url: promo.bannerUrl, prefer_large_media: true, show_above_text: true },
            }
          : {
              chat_id: config.stagingChatId,
              text: message,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            });
        if (!staged.ok || !staged.result?.message_id) return null;
        progress.stagingMessageId = String(staged.result.message_id);
      } catch {
        return null;
      }
    }
    // VPS hanya menerima ^[A-Za-z0-9:_-]{8,128}$ — buang '@' dan karakter lain dari username channel.
    const idempotencyKey = ['promo', destination.toLowerCase().replace(/[^a-z0-9_-]/g, ''), promo.businessDate, promo.slot, progress.stagingMessageId].join(':').slice(0, 128);
    let response: Response;
    try {
      response = await fetch(config.proxyUrl + '/tgu/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-proxy-token': config.proxyToken },
        body: JSON.stringify({
          fromChatId: config.stagingChatId,
          messageId: Number(progress.stagingMessageId),
          toChatId: progress.channelChatId,
          idempotencyKey,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(USERBOT_FORWARD_TIMEOUT_MS),
      });
    } catch {
      return { state: 'unknown', error: 'telegram_userbot_outcome_unknown', providerId: serializePromoProgress(progress) };
    }
    if (USERBOT_DEFINITE_REJECT_STATUSES.has(response.status)) return null;
    const body = response.status === 200
      ? await response.json().catch(() => null) as { ok?: boolean; messageId?: unknown; channelMessageId?: unknown } | null
      : null;
    const rawId = body?.messageId ?? body?.channelMessageId;
    const channelMessageId = typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0
      ? String(rawId)
      : typeof rawId === 'string' && /^\d+$/.test(rawId) ? rawId : '';
    if (response.status !== 200 || !channelMessageId) {
      return { state: 'unknown', error: 'telegram_userbot_outcome_unknown', providerId: serializePromoProgress(progress) };
    }
    progress.channelMessageId = channelMessageId;
    progress.sentChunks = 1;
    progress.lastMessageId = channelMessageId;
  }
  if (!progress.buttonsAttached && !progress.buttonsFailed && promo.channelReplyMarkup) {
    let attached = false;
    try {
      const edited = await editMessageReplyMarkup({
        chat_id: progress.channelChatId!,
        message_id: Number(progress.channelMessageId),
        reply_markup: promo.channelReplyMarkup,
      });
      attached = edited.ok;
    } catch {
      attached = false;
    }
    if (attached) progress.buttonsAttached = true;
    else {
      // Post sudah ada di channel: jangan pernah diposting ulang.
      progress.buttonsFailed = true;
      return { state: 'sent', error: 'telegram_userbot_buttons_failed', providerId: serializePromoProgress(progress) };
    }
  }
  return { state: 'sent', providerId: serializePromoProgress(progress) };
}

async function sendTelegramPromo(
  destination: string,
  promo: BroadcastPromoPayload,
  existingProviderId?: string | null,
  options?: { isChannel?: boolean },
): Promise<SendOutcome> {
  const progress = parsePromoProgress(existingProviderId);
  if (Date.now() >= Date.parse(promo.expiresAt)) {
    return { state: 'skipped', error: 'promo_slot_expired', providerId: serializePromoProgress(progress) };
  }
  const isChannel = options?.isChannel === true;
  const messages = isChannel && promo.channelMessagesHtml?.length ? promo.channelMessagesHtml : promo.messagesHtml;
  // Hanya snapshot link_preview (satu bubble tanpa sendPhoto) yang punya satu
  // pesan utuh untuk di-stage; snapshot foto+caption lama tetap jalur langsung.
  if (
    isChannel && messages.length === 1 && promo.bannerMode === 'link_preview' &&
    !progress.photoId && (progress.sentChunks === 0 || progress.channelMessageId)
  ) {
    const userbot = userbotConfig();
    if (userbot) {
      const outcome = await sendChannelPromoViaUserbot(destination, promo, messages[0], progress, userbot);
      if (outcome) return outcome;
      // null = pasti tidak ada post userbot; lanjut jalur bot langsung di bawah.
    }
  }
  let sentInCall = false;
  const linkPreview = promo.bannerMode === 'link_preview';
  if (!linkPreview && !progress.photoId) {
    try {
      const photoRes = await sendPhoto({
        chat_id: destination,
        photo: promo.bannerUrl,
        caption: promo.captionHtml,
        parse_mode: 'HTML',
      });
      if (!photoRes.ok || !photoRes.result?.message_id) {
        return classifyTelegramError(photoRes, serializePromoProgress(progress), { isChannel });
      }
      progress.photoId = String(photoRes.result.message_id);
      sentInCall = true;
    } catch {
      return { state: 'unknown', error: 'telegram_delivery_unknown', providerId: serializePromoProgress(progress) };
    }
  }
  for (let i = progress.sentChunks; i < messages.length; i++) {
    if (sentInCall) {
      await new Promise<void>((resolve) => setTimeout(resolve, TELEGRAM_SAME_CHAT_PACE_MS));
    }
    try {
      const attachMarkup = isChannel && i === messages.length - 1 && promo.channelReplyMarkup
        ? { reply_markup: promo.channelReplyMarkup }
        : {};
      // Mode link_preview: chunk pertama membawa banner sebagai pratinjau
      // besar DI ATAS teks (satu bubble). Chunk lanjutan tanpa pratinjau.
      const msgRes = await sendMessage(linkPreview && i === 0
        ? {
            chat_id: destination,
            text: messages[i],
            parse_mode: 'HTML',
            link_preview_options: { url: promo.bannerUrl, prefer_large_media: true, show_above_text: true },
            ...attachMarkup,
          }
        : {
            chat_id: destination,
            text: messages[i],
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            ...attachMarkup,
          });
      if (!msgRes.ok || !msgRes.result?.message_id) {
        return classifyTelegramError(msgRes, serializePromoProgress(progress), { isChannel });
      }
      progress.sentChunks = i + 1;
      progress.lastMessageId = String(msgRes.result.message_id);
      sentInCall = true;
    } catch {
      return { state: 'unknown', error: 'telegram_delivery_unknown', providerId: serializePromoProgress(progress) };
    }
  }
  return { state: 'sent', providerId: serializePromoProgress(progress) };
}

export async function sendBroadcast(
  channel: BroadcastChannel,
  row: { campaign_id: string; recipient_id: string; destination: string; unsubscribe_token?: string; provider_id?: string | null },
  snapshot: BroadcastSnapshot,
): Promise<SendOutcome> {
  if (channel === 'whatsapp') {
    if (!snapshot.wa || snapshot.wa.destination !== row.destination) return { state: 'failed', error: 'whatsapp_target_changed' };
    const result = await sendTextMessage({ target: row.destination, message: broadcastText(snapshot), broadcastNotification: true, idempotencyKey: 'wa:broadcast:' + row.campaign_id, botNumber: snapshot.wa.botNumber, botRevision: snapshot.wa.botRevision });
    if (result.ok) return { state: 'sent', providerId: result.messageId };
    if (result.error === 'delivery_outcome_unknown') return { state: 'unknown', error: 'delivery_outcome_unknown' };
    if (result.error === 'idempotency_conflict') return { state: 'failed', error: 'idempotency_conflict' };
    return { state: 'retry', error: result.error === 'bot_configuration_changed' ? 'bot_changed_review_required' : 'whatsapp_not_ready', retryAfter: 60, consumeAttempt: false };
  }
  if (channel === 'telegram' || channel === 'telegram_channel') {
    const isChannel = channel === 'telegram_channel';
    if (process.env.TELEGRAM_BOT_ENABLED !== 'true' || !process.env.TELEGRAM_BOT_TOKEN) {
      return {
        state: 'retry',
        error: 'telegram_not_configured',
        retryAfter: 3600,
        consumeAttempt: false,
        ...(row.provider_id ? { providerId: row.provider_id } : {}),
      };
    }
    if (snapshot.promo?.kind === 'telegram_promo') {
      return sendTelegramPromo(row.destination, snapshot.promo, row.provider_id, { isChannel });
    }
    const result = await sendMessage({
      chat_id: row.destination,
      text: isChannel
        ? snapshot.title + '\n\n' + snapshot.body
        : snapshot.title + '\n\n' + snapshot.body + '\n\nBerhenti siaran: /stop',
      ...(snapshot.cta_url ? { reply_markup: { inline_keyboard: [[{ text: snapshot.cta_label, url: snapshot.cta_url }]] } } : {}),
    });
    if (result.ok && result.result?.message_id) return { state: 'sent', providerId: String(result.result.message_id) };
    return classifyTelegramError(result, undefined, { isChannel });
  }
  const key = process.env.RESEND_API_KEY?.trim(), from = process.env.FORWARD_FROM_EMAIL?.trim();
  if (!key || !from) return { state: 'retry', error: 'email_not_configured', retryAfter: 3600, consumeAttempt: false };
  if (!/^[a-f0-9]{64}$/.test(row.unsubscribe_token || '')) return { state: 'failed', error: 'unsubscribe_token_missing' };
  const unsubscribe = unsubscribeUrl(row.unsubscribe_token!);
  const text = broadcastText(snapshot) + '\n\nAnda menerima email ini karena berlangganan AXVARA.\nBerhenti berlangganan: ' + unsubscribe;
  const html = `<div style="font-family:system-ui;max-width:600px;margin:auto"><h1>${escapeHtml(snapshot.title)}</h1><p style="white-space:pre-wrap;line-height:1.7">${escapeHtml(snapshot.body)}</p>${snapshot.cta_url ? `<p><a href="${escapeHtml(snapshot.cta_url)}">${escapeHtml(snapshot.cta_label)}</a></p>` : ''}<hr><p>Anda menerima email ini karena berlangganan AXVARA. <a href="${escapeHtml(unsubscribe)}">Berhenti berlangganan</a></p></div>`;
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': 'broadcast/' + row.campaign_id + '/' + row.recipient_id }, body: JSON.stringify({ from: 'AXVARA <' + from + '>', to: [row.destination], subject: snapshot.title, text, html, headers: { 'List-Unsubscribe': '<' + unsubscribe + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }), redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const body = await response.json().catch(() => null) as { id?: string; name?: string } | null;
    if (response.ok && body?.id) return { state: 'sent', providerId: body.id };
    if (response.status === 429) return { state: 'retry', error: 'email_rate_limited', retryAfter: Math.max(1, Math.min(86400, Number(response.headers.get('retry-after')) || 60)), consumeAttempt: false };
    if ([401, 403].includes(response.status)) return { state: 'retry', error: 'email_not_authorized', retryAfter: 3600, consumeAttempt: false };
    if (response.status >= 500 || body?.name === 'concurrent_idempotent_requests') return { state: 'retry', error: 'email_provider_unavailable', retryAfter: 60 };
    if (response.ok) return { state: 'retry', error: 'email_response_unknown', retryAfter: 60 };
    return { state: 'failed', error: 'email_provider_rejected' };
  } catch { return { state: 'retry', error: 'email_delivery_unknown', retryAfter: 60 }; }
}
