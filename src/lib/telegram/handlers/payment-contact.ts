// src/lib/telegram/handlers/payment-contact.ts — R2 contact stage (CAS).
// Narrow: gateway-only phone collection into payq1 contact.phone via CAS.
// No payphone overwrite, no draft discard, no order writes. Crypto never
// reaches here (email-only rules). Phone bounded + validated.
import { execRun } from "@/lib/db";
import { sendMessage } from "@/lib/telegram/api";
import { tgCtxFor } from "@/lib/telegram/render-prefs";
import { paymentMethodNoticeMessage } from "@/lib/telegram/messages/purchase";
import type { Payq1State } from "@/lib/telegram/payment-quote";
import type { Locale } from "@/lib/i18n/locale";

export function isValidContactPhone(raw: string): boolean {
  return /^\+?[0-9]{8,20}$/.test(raw.trim());
}

export async function requestPayq1Contact(
  chatId: number,
  messageId: number,
  from: { id: number; first_name: string; username?: string },
  locale: Locale,
  currentRaw: string,
  current: Payq1State,
  email: string,
): Promise<void> {
  if (current.st !== "quoted") return;
  const next: Payq1State = {
    ...current,
    st: "contact",
    contact: { email, phone: null },
  };
  const nextRaw = `payq1:${JSON.stringify(next)}`;
  await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    nextRaw, String(from.id), currentRaw,
  ).catch(() => ({ changes: 0 }));
  const ctx = await tgCtxFor(from.id).catch(() => ({ locale }));
  await sendMessage({
    chat_id: chatId,
    text: locale === "en"
      ? `This payment method needs a WhatsApp number for provider delivery.\n\nReply here with an active number (8-20 digits, e.g. <code>081234567890</code>). Your email <code>${email.replace(/</g, "&lt;")}</code> is already saved.`
      : `Metode pembayaran ini membutuhkan nomor WhatsApp untuk pengiriman provider.\n\nBalas di sini dengan nomor aktif (8-20 digit, mis. <code>081234567890</code>). Email <code>${email.replace(/</g, "&lt;")}</code> sudah tersimpan.`,
    parse_mode: "HTML",
  });
  void messageId;
  void ctx;
}

export async function handlePayq1PhoneInput(
  text: string,
  chatId: number,
  from: { id: number; first_name: string; username?: string },
): Promise<boolean> {
  const { readPayq1State } = await import("@/lib/telegram/payment-quote");
  const stored = await readPayq1State(String(from.id)).catch(() => null);
  if (!stored?.state || stored.state.st !== "contact") return false;
  const phone = text.trim();
  const ctx = await tgCtxFor(from.id);
  if (!isValidContactPhone(phone)) {
    await sendMessage({
      chat_id: chatId,
      text: ctx.locale === "en"
        ? "Invalid number format. Reply with 8-20 digits, or type /batal to cancel."
        : "Format nomor tidak valid. Balas dengan 8-20 digit, atau ketik /batal untuk batal.",
      parse_mode: "HTML",
    });
    return true;
  }
  const next: Payq1State = {
    ...stored.state,
    contact: { email: stored.state.contact.email, phone },
  };
  const nextRaw = `payq1:${JSON.stringify(next)}`;
  const claimed = await execRun(
    `UPDATE telegram_users SET pending_action=?, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    nextRaw, String(from.id), stored.raw,
  ).catch(() => ({ changes: 0 }));
  if ((claimed.changes ?? 0) < 1) {
    await sendMessage({
      chat_id: chatId,
      text: paymentMethodNoticeMessage("not_ready", { locale: ctx.locale }),
      parse_mode: "HTML",
    });
    return true;
  }
  await sendMessage({
    chat_id: chatId,
    text: ctx.locale === "en"
      ? `Number saved. Press the Continue button again to create the payment.`
      : `Nomor tersimpan. Tekan tombol Lanjut lagi untuk membuat pembayaran.`,
    parse_mode: "HTML",
  });
  return true;
}
