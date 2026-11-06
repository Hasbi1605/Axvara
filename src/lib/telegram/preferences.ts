// TG1 onboarding/preferences: locale + display currency store.
// Scope: /start language gate + independent /currency|settings control.
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import { execRun, isD1Mode, queryFirst } from "@/lib/db";

export type TgPreferences = { locale: Locale | null; currency: DisplayCurrency | null };

export function isValidTgLocale(value: unknown): value is Locale {
  return value === "id" || value === "en";
}

export function isValidTgCurrency(value: unknown): value is DisplayCurrency {
  return value === "IDR" || value === "USD";
}

export function tgDefaultCurrency(locale: Locale): DisplayCurrency {
  return locale === "en" ? "USD" : "IDR";
}

export async function readTgPreferences(userId: string): Promise<TgPreferences> {
  if (!isD1Mode()) return { locale: null, currency: null };
  const row = await queryFirst(
    `SELECT locale, display_currency FROM telegram_users WHERE user_id=?`,
    userId,
  );
  const locale = row?.locale;
  const currency = row?.display_currency;
  return {
    locale: isValidTgLocale(locale) ? locale : null,
    currency: isValidTgCurrency(currency) ? currency : null,
  };
}

/** Save explicit language choice; seed currency once if still unset. */
export async function saveTgLocaleChoice(userId: string, locale: Locale): Promise<boolean> {
  if (!isD1Mode() || !isValidTgLocale(locale)) return false;
  const res = await execRun(
    `UPDATE telegram_users SET locale=?, display_currency=COALESCE(display_currency, ?), updated_at=datetime('now') WHERE user_id=?`,
    locale, tgDefaultCurrency(locale), userId,
  );
  return (res.changes ?? 0) > 0;
}

/** Locale-only change: currency column untouched. */
export async function saveTgLocaleOnly(userId: string, locale: Locale): Promise<boolean> {
  if (!isD1Mode() || !isValidTgLocale(locale)) return false;
  const res = await execRun(
    `UPDATE telegram_users SET locale=?, updated_at=datetime('now') WHERE user_id=?`,
    locale, userId,
  );
  return (res.changes ?? 0) > 0;
}

/** Currency-only change: locale column untouched. */
export async function saveTgCurrencyChoice(userId: string, currency: DisplayCurrency): Promise<boolean> {
  if (!isD1Mode() || !isValidTgCurrency(currency)) return false;
  const res = await execRun(
    `UPDATE telegram_users SET display_currency=?, updated_at=datetime('now') WHERE user_id=?`,
    currency, userId,
  );
  return (res.changes ?? 0) > 0;
}

/** Effective prefs for rendering (null = unset; caller chooses fallback). */
export async function tgPrefsOrNull(userId: string | null | undefined): Promise<TgPreferences> {
  if (userId == null || String(userId).trim() === "") return { locale: null, currency: null };
  return readTgPreferences(String(userId));
}

/** Official Telegram deep-link payload charset: A-Z a-z 0-9 _ - (<=64).
 * Unknown payloads never become state or flows. */
const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function normalizeStartPayload(raw: string): string | null {
  const text = raw.trim();
  if (!START_PAYLOAD_RE.test(text)) return null;
  if (/^(beli|start)$/i.test(text)) return null;
  return text;
}

/** Persist validated onboarding payload in owned pending_action namespace.
 * /start without payload clears stale onboarding state. */
export async function saveOnboardingPayload(userId: string, payload: string | null): Promise<boolean> {
  if (!isD1Mode()) return false;
  const value = payload == null ? null : `onboarding:${payload}`;
  const res = await execRun(
    `UPDATE telegram_users SET pending_action=CASE WHEN ? IS NULL THEN NULL ELSE ? END, updated_at=datetime('now')
     WHERE user_id=? AND (pending_action IS NULL OR pending_action NOT LIKE 'email%' AND pending_action NOT LIKE 'qty%' AND pending_action NOT LIKE 'search%' AND pending_action NOT LIKE 'wa_%' AND pending_action NOT LIKE 'payq1:%"st":"creating"%')`,
    value, value, userId,
  ).catch(() => ({ changes: 0 }));
  return (res.changes ?? 0) > 0;
}

/** CAS-consume saved onboarding payload exactly once; duplicate => null. */
export async function consumeOnboardingPayload(userId: string): Promise<string | null> {
  if (!isD1Mode()) return null;
  const row = await queryFirst(`SELECT pending_action FROM telegram_users WHERE user_id=?`, userId).catch(() => null);
  const action = row?.pending_action ? String(row.pending_action) : "";
  const match = /^onboarding:([A-Za-z0-9_-]{1,64})$/.exec(action);
  if (!match) return null;
  const claimed = await execRun(
    `UPDATE telegram_users SET pending_action=NULL, updated_at=datetime('now') WHERE user_id=? AND pending_action=?`,
    userId, action,
  ).catch(() => ({ changes: 0 }));
  return (claimed.changes ?? 0) > 0 ? match[1] : null;
}
