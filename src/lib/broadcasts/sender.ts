import { sendMessage, sendPhoto } from '@/lib/telegram/api';
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
};

function parsePromoProgress(raw?: string | null): PromoProgress {
  if (!raw) return { photoId: null, sentChunks: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<PromoProgress>;
    return {
      photoId: typeof parsed.photoId === 'string' && parsed.photoId ? parsed.photoId : null,
      sentChunks: typeof parsed.sentChunks === 'number' && Number.isInteger(parsed.sentChunks) && parsed.sentChunks >= 0 ? parsed.sentChunks : 0,
      ...(typeof parsed.lastMessageId === 'string' && parsed.lastMessageId ? { lastMessageId: parsed.lastMessageId } : {}),
    };
  } catch {
    return { photoId: null, sentChunks: 0 };
  }
}

function serializePromoProgress(progress: PromoProgress): string | undefined {
  return progress.photoId || progress.sentChunks > 0 ? JSON.stringify(progress) : undefined;
}

function classifyTelegramError(result: TelegramApiResponse<TelegramMessage>, providerId?: string): SendOutcome {
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
      error: 'telegram_recipient_unavailable',
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

async function sendTelegramPromo(
  destination: string,
  promo: BroadcastPromoPayload,
  existingProviderId?: string | null,
): Promise<SendOutcome> {
  const progress = parsePromoProgress(existingProviderId);
  if (Date.now() >= Date.parse(promo.expiresAt)) {
    return { state: 'skipped', error: 'promo_slot_expired', providerId: serializePromoProgress(progress) };
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
        return classifyTelegramError(photoRes, serializePromoProgress(progress));
      }
      progress.photoId = String(photoRes.result.message_id);
      sentInCall = true;
    } catch {
      return { state: 'unknown', error: 'telegram_delivery_unknown', providerId: serializePromoProgress(progress) };
    }
  }
  for (let i = progress.sentChunks; i < promo.messagesHtml.length; i++) {
    if (sentInCall) {
      await new Promise<void>((resolve) => setTimeout(resolve, TELEGRAM_SAME_CHAT_PACE_MS));
    }
    try {
      // Mode link_preview: chunk pertama membawa banner sebagai pratinjau
      // besar DI ATAS teks (satu bubble). Chunk lanjutan tanpa pratinjau.
      const msgRes = await sendMessage(linkPreview && i === 0
        ? {
            chat_id: destination,
            text: promo.messagesHtml[i],
            parse_mode: 'HTML',
            link_preview_options: { url: promo.bannerUrl, prefer_large_media: true, show_above_text: true },
          }
        : {
            chat_id: destination,
            text: promo.messagesHtml[i],
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          });
      if (!msgRes.ok || !msgRes.result?.message_id) {
        return classifyTelegramError(msgRes, serializePromoProgress(progress));
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
  if (channel === 'telegram') {
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
      return sendTelegramPromo(row.destination, snapshot.promo, row.provider_id);
    }
    const result = await sendMessage({
      chat_id: row.destination,
      text: snapshot.title + '\n\n' + snapshot.body + '\n\nBerhenti siaran: /stop',
      ...(snapshot.cta_url ? { reply_markup: { inline_keyboard: [[{ text: snapshot.cta_label, url: snapshot.cta_url }]] } } : {}),
    });
    if (result.ok && result.result?.message_id) return { state: 'sent', providerId: String(result.result.message_id) };
    return classifyTelegramError(result);
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
