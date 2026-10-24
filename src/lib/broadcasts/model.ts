export const CHANNELS = ['whatsapp','email','telegram'] as const;
export type BroadcastChannel = typeof CHANNELS[number];
export type BroadcastContent = { name: string; title: string; body: string; cta_label: string; cta_url: string };
export type BroadcastTemplate = BroadcastContent & { id: string; revision: number; archived: number };
export type BroadcastSnapshot = BroadcastContent & { wa?: { destination: string; botNumber: string; botRevision: string } };
export const CHANNEL_LABELS = { whatsapp: 'Grup WhatsApp', email: 'Subscriber email', telegram: 'Pengguna Telegram' };
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function broadcastText(content: BroadcastContent) {
  return [content.title, content.body, ...(content.cta_url ? [content.cta_label + ': ' + content.cta_url] : [])].filter(Boolean).join('\n\n');
}
export function escapeHtml(value: string) {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export function unsubscribeUrl(token: string) { return 'https://axvara.tech/api/subscribers/unsubscribe?token=' + token; }
