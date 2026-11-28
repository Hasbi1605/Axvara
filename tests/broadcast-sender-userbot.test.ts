import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendBroadcast } from '@/lib/broadcasts/sender';
import { editMessageReplyMarkup, getChat, sendMessage, sendPhoto } from '@/lib/telegram/api';

vi.mock('@/lib/telegram/api', () => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  getChat: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
}));
vi.mock('@/lib/whatsapp/gateway', () => ({ sendTextMessage: vi.fn() }));

const STAGING = '-1001234567890';
const CHANNEL_ID = '-1009876543210';
const markup = { inline_keyboard: [[{ text: 'Order', url: 'https://axvara.tech' }]] };
const promo = {
  kind: 'telegram_promo' as const,
  businessDate: '2026-11-28',
  slot: 'morning' as const,
  bannerUrl: 'https://axvara.tech/banners/ready-promo.jpg',
  bannerMode: 'link_preview' as const,
  captionHtml: '',
  messagesHtml: ['<b>DM</b>'],
  channelMessagesHtml: ['<b>Channel</b>'],
  channelReplyMarkup: markup,
  expiresAt: '2099-11-28T12:00:00+07:00',
};
const snapshot = { name: 'Promo', title: 'Promo', body: '', cta_label: '', cta_url: '', promo };
const row = { campaign_id: '22222222-2222-4222-8222-222222222222', recipient_id: '1', destination: '@axvaratech' };

function enableUserbot() {
  vi.stubEnv('TELEGRAM_CHANNEL_USERBOT_ENABLED', 'true');
  vi.stubEnv('TELEGRAM_PROMO_STAGING_CHAT_ID', STAGING);
  vi.stubEnv('WARUNG_REBAHAN_PROXY_URL', 'https://proxy.example.test/');
  vi.stubEnv('WARUNG_REBAHAN_PROXY_TOKEN', 'proxy-token');
}
function forwardResponse(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}
function mockStagingOk() {
  vi.mocked(getChat).mockResolvedValue({ ok: true, result: { id: Number(CHANNEL_ID), type: 'channel' } });
  vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true, result: { message_id: 55 } as never });
}

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_ENABLED', 'true');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'fixture');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('channel promo via userbot forward', () => {
  it('flag off keeps the direct bot path unchanged', async () => {
    vi.stubEnv('TELEGRAM_PROMO_STAGING_CHAT_ID', STAGING);
    vi.stubEnv('WARUNG_REBAHAN_PROXY_URL', 'https://proxy.example.test');
    vi.stubEnv('WARUNG_REBAHAN_PROXY_TOKEN', 'proxy-token');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true, result: { message_id: 7 } as never });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out).toEqual({
      state: 'sent',
      providerId: JSON.stringify({ photoId: null, sentChunks: 1, lastMessageId: '7' }),
      channelDelivery: { via: 'bot', buttons: 'attached' },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMessage).mock.calls[0][0]).toMatchObject({ chat_id: '@axvaratech', reply_markup: markup });
    expect(getChat).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores the userbot when the staging chat id is malformed or proxy is unset', async () => {
    enableUserbot();
    vi.stubEnv('TELEGRAM_PROMO_STAGING_CHAT_ID', '12345');
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 7 } as never });
    await sendBroadcast('telegram_channel', row, snapshot);
    vi.stubEnv('TELEGRAM_PROMO_STAGING_CHAT_ID', STAGING);
    vi.stubEnv('WARUNG_REBAHAN_PROXY_TOKEN', '');
    await sendBroadcast('telegram_channel', row, snapshot);
    expect(getChat).not.toHaveBeenCalled();
    expect(vi.mocked(sendMessage).mock.calls.every(([p]) => p.chat_id === '@axvaratech')).toBe(true);
  });

  it('happy path: staging send, forward, then buttons; persists progress', async () => {
    enableUserbot();
    mockStagingOk();
    const fetcher = forwardResponse(200, { ok: true, messageId: 321 });
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(editMessageReplyMarkup).mockResolvedValue({ ok: true });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out.state).toBe('sent');
    expect(JSON.parse(out.providerId!)).toEqual({
      photoId: null, sentChunks: 1, lastMessageId: '321',
      channelChatId: CHANNEL_ID, stagingMessageId: '55', channelMessageId: '321', buttonsAttached: true,
    });
    expect(getChat).toHaveBeenCalledWith('@axvaratech');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const staged = vi.mocked(sendMessage).mock.calls[0][0];
    expect(staged).toMatchObject({
      chat_id: STAGING, text: '<b>Channel</b>', parse_mode: 'HTML',
      link_preview_options: { url: promo.bannerUrl, prefer_large_media: true, show_above_text: true },
    });
    expect(staged).not.toHaveProperty('reply_markup');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proxy.example.test/tgu/forward');
    expect((init.headers as Record<string, string>)['x-proxy-token']).toBe('proxy-token');
    expect(JSON.parse(String(init.body))).toEqual({
      fromChatId: STAGING, messageId: 55, toChatId: CHANNEL_ID,
      idempotencyKey: 'promo:axvaratech:2026-11-28:morning:55',
    });
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({ chat_id: CHANNEL_ID, message_id: 321, reply_markup: markup });
    expect(out.channelDelivery).toEqual({ via: 'userbot', buttons: 'attached' });
  });

  it.each([503, 409, 403, 400])('falls back to the direct bot path on definite rejection %i', async (status) => {
    enableUserbot();
    mockStagingOk();
    vi.stubGlobal('fetch', forwardResponse(status, { error: status === 409 ? 'telegram_rejected' : 'userbot_not_ready', retryAfter: 5 }));
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true, result: { message_id: 9 } as never });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out.state).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[1][0]).toMatchObject({ chat_id: '@axvaratech', reply_markup: markup });
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(JSON.parse(out.providerId!)).toMatchObject({ sentChunks: 1, lastMessageId: '9', stagingMessageId: '55' });
    expect(out.channelDelivery).toEqual({
      via: 'bot_fallback',
      buttons: 'attached',
      reason: status === 409 ? 'telegram_rejected' : 'userbot_not_ready',
    });
  });

  it('derives a safe fallback reason from the status when the proxy body has no usable code', async () => {
    enableUserbot();
    mockStagingOk();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 404 })));
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true, result: { message_id: 9 } as never });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out.channelDelivery).toEqual({ via: 'bot_fallback', buttons: 'attached', reason: 'userbot_route_missing' });
  });

  it('falls back when the staging send or getChat fails', async () => {
    enableUserbot();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(getChat).mockResolvedValue({ ok: true, result: { id: Number(CHANNEL_ID), type: 'channel' } });
    vi.mocked(sendMessage)
      .mockResolvedValueOnce({ ok: false, error_code: 400 })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 9 } as never });
    const stagingFailed = await sendBroadcast('telegram_channel', row, snapshot);
    expect(stagingFailed.state).toBe('sent');
    expect(stagingFailed.channelDelivery).toMatchObject({ via: 'bot_fallback', reason: 'staging_failed' });
    expect(fetcher).not.toHaveBeenCalled();
    vi.mocked(getChat).mockResolvedValue({ ok: false, error_code: 400 });
    vi.mocked(sendMessage).mockClear().mockResolvedValueOnce({ ok: true, result: { message_id: 10 } as never });
    const lookupFailed = await sendBroadcast('telegram_channel', row, snapshot);
    expect(lookupFailed.state).toBe('sent');
    expect(lookupFailed.channelDelivery).toMatchObject({ via: 'bot_fallback', reason: 'channel_lookup_failed' });
    expect(vi.mocked(sendMessage).mock.calls).toHaveLength(1);
    expect(vi.mocked(sendMessage).mock.calls[0][0].chat_id).toBe('@axvaratech');
  });

  it('returns unknown without any direct send on 502 outcome_unknown', async () => {
    enableUserbot();
    mockStagingOk();
    vi.stubGlobal('fetch', forwardResponse(502, { error: 'outcome_unknown' }));
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out).toMatchObject({ state: 'unknown', error: 'telegram_userbot_outcome_unknown' });
    expect(out.channelDelivery).toEqual({ via: 'userbot', buttons: 'n/a', reason: 'telegram_userbot_outcome_unknown' });
    expect(JSON.parse(out.providerId!)).toMatchObject({ channelChatId: CHANNEL_ID, stagingMessageId: '55' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it('returns unknown without any direct send when fetch throws, and a retry reuses staging + idempotency key', async () => {
    enableUserbot();
    mockStagingOk();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const first = await sendBroadcast('telegram_channel', row, snapshot);
    expect(first).toMatchObject({ state: 'unknown', error: 'telegram_userbot_outcome_unknown' });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const fetcher = forwardResponse(200, { ok: true, messageId: '400' });
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(editMessageReplyMarkup).mockResolvedValue({ ok: true });
    const second = await sendBroadcast('telegram_channel', { ...row, provider_id: first.providerId }, snapshot);
    expect(second.state).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(getChat).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).idempotencyKey)
      .toBe('promo:axvaratech:2026-11-28:morning:55');
    // Kontrak VPS tg-userbot: idempotencyKey ^[A-Za-z0-9:_-]{8,128}$ (tanpa '@').
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)).idempotencyKey)
      .toMatch(/^[A-Za-z0-9:_-]{8,128}$/);
  });

  it('resumes after staging is done without a second staging send', async () => {
    enableUserbot();
    const fetcher = forwardResponse(200, { ok: true, messageId: 77 });
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(editMessageReplyMarkup).mockResolvedValue({ ok: true });
    const providerId = JSON.stringify({ photoId: null, sentChunks: 0, channelChatId: CHANNEL_ID, stagingMessageId: '55' });
    const out = await sendBroadcast('telegram_channel', { ...row, provider_id: providerId }, snapshot);
    expect(out.state).toBe('sent');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(getChat).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('resumes after forward is done and only attaches the buttons', async () => {
    enableUserbot();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(editMessageReplyMarkup).mockResolvedValue({ ok: true });
    const providerId = JSON.stringify({
      photoId: null, sentChunks: 1, lastMessageId: '321', channelChatId: CHANNEL_ID, stagingMessageId: '55', channelMessageId: '321',
    });
    const out = await sendBroadcast('telegram_channel', { ...row, provider_id: providerId }, snapshot);
    expect(out.state).toBe('sent');
    expect(fetcher).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.providerId!)).toMatchObject({ buttonsAttached: true });
  });

  it('multi-chunk channel promo uses the direct path', async () => {
    enableUserbot();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 3 } as never });
    const out = await sendBroadcast('telegram_channel', row, { ...snapshot, promo: { ...promo, channelMessagesHtml: ['a', 'b'] } });
    expect(out.state).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(getChat).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(out.channelDelivery).toEqual({ via: 'bot', buttons: 'attached' });
  });

  it('reports a failed direct send after a userbot fallback', async () => {
    enableUserbot();
    mockStagingOk();
    vi.stubGlobal('fetch', forwardResponse(503, { error: 'userbot_not_ready' }));
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error_code: 403 });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out).toMatchObject({ state: 'failed', error: 'telegram_channel_not_admin' });
    expect(out.channelDelivery).toEqual({ via: 'bot_fallback', buttons: 'n/a', reason: 'telegram_channel_not_admin' });
  });

  it('buttons failure still reports sent and never reposts', async () => {
    enableUserbot();
    mockStagingOk();
    const fetcher = forwardResponse(200, { ok: true, messageId: 321 });
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(editMessageReplyMarkup).mockResolvedValue({ ok: false, error_code: 400 });
    const out = await sendBroadcast('telegram_channel', row, snapshot);
    expect(out).toMatchObject({ state: 'sent', error: 'telegram_userbot_buttons_failed' });
    expect(JSON.parse(out.providerId!)).toMatchObject({ channelMessageId: '321', buttonsFailed: true });
    expect(out.channelDelivery).toEqual({ via: 'userbot', buttons: 'failed', reason: 'telegram_userbot_buttons_failed' });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never uses the userbot for DMs', async () => {
    enableUserbot();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, result: { message_id: 4 } as never });
    const out = await sendBroadcast('telegram', { ...row, destination: '11' }, snapshot);
    expect(out.state).toBe('sent');
    expect(out).not.toHaveProperty('channelDelivery');
    expect(vi.mocked(sendMessage).mock.calls[0][0]).toMatchObject({ chat_id: '11', text: '<b>DM</b>' });
    expect(getChat).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
