// src/lib/telegram/button-style.ts — Central Telegram Bot API 9.4+ button styling.
// Applies semantic colors (`primary`, `success`, `danger`) to outgoing inline and
// reply keyboard buttons that do not already declare an explicit `style`.

import type {
  AnyReplyMarkup,
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  ReplyKeyboardButton,
  ReplyKeyboardMarkup,
} from "./types";

export type TelegramButtonStyle = "primary" | "success" | "danger";

const DANGER_ACTIONS = new Set(["cancel", "cancelok", "cclear", "crm"]);
const DANGER_TEXT_RE = /\b(?:batal|batalkan|hapus|kosongkan|cancel|remove|clear)\b/i;

const SUCCESS_ACTIONS = new Set([
  "prd",
  "buy",
  "vars",
  "var",
  "pay",
  "epay",
  "cconfirm",
  "ccheckout",
  "pm",
  "pmc",
  "pmb",
  "pgo",
  "gconsent",
  "cadd",
  "claimstart",
  "confirm",
  "cfv",
]);
const SUCCESS_TEXT_RE = /\b(?:bayar|pay|checkout|beli|konfirmasi|lanjut ke pembayaran|qris|crypto|tambah ke keranjang|ajukan)\b/i;

function callbackAction(callbackData?: string): string {
  if (typeof callbackData !== "string") return "";
  const idx = callbackData.indexOf(":");
  return idx === -1 ? callbackData : callbackData.slice(0, idx);
}

function isSuccessAction(action: string): boolean {
  return SUCCESS_ACTIONS.has(action) || action.startsWith("pmentry");
}

function isExplicitStyle(style: unknown): style is TelegramButtonStyle {
  return style === "primary" || style === "success" || style === "danger";
}

function resolveInlineButtonStyle(button: InlineKeyboardButton): TelegramButtonStyle {
  if (isExplicitStyle(button.style)) return button.style;
  const action = callbackAction(button.callback_data);
  const text = button.text ?? "";
  if (DANGER_ACTIONS.has(action) || DANGER_TEXT_RE.test(text)) {
    return "danger";
  }
  if (isSuccessAction(action) || SUCCESS_TEXT_RE.test(text)) {
    return "success";
  }
  return "primary";
}

function resolveReplyButtonStyle(button: ReplyKeyboardButton): TelegramButtonStyle {
  if (isExplicitStyle(button.style)) return button.style;
  const text = button.text ?? "";
  if (DANGER_TEXT_RE.test(text)) return "danger";
  if (SUCCESS_TEXT_RE.test(text)) return "success";
  return "primary";
}

/**
 * Purely decorate every button in an inline or reply keyboard markup with a
 * Bot API 9.4+ `style` (`primary` | `success` | `danger`), preserving any
 * explicit `style` already set. Leaves `force_reply` and `remove_keyboard`
 * markups untouched.
 */
export function applyButtonStyles<T extends AnyReplyMarkup | Record<string, unknown> | undefined | null>(
  markup: T,
): T {
  if (!markup || typeof markup !== "object") return markup;
  if ("force_reply" in markup && markup.force_reply) return markup;
  if ("remove_keyboard" in markup && markup.remove_keyboard) return markup;

  if ("inline_keyboard" in markup && Array.isArray(markup.inline_keyboard)) {
    const inline = markup as InlineKeyboardMarkup;
    return {
      ...inline,
      inline_keyboard: inline.inline_keyboard.map((row) =>
        Array.isArray(row)
          ? row.map((btn) => ({ ...btn, style: resolveInlineButtonStyle(btn) }))
          : row,
      ),
    } as T;
  }

  if ("keyboard" in markup && Array.isArray(markup.keyboard)) {
    const reply = markup as ReplyKeyboardMarkup;
    return {
      ...reply,
      keyboard: reply.keyboard.map((row) =>
        Array.isArray(row)
          ? row.map((btn) => ({ ...btn, style: resolveReplyButtonStyle(btn) }))
          : row,
      ),
    } as T;
  }

  return markup;
}
