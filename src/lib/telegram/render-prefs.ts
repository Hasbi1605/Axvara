// TG2a: per-update buyer preference context (locale + display currency) + FX.
// Resolved ONCE per handler/update: command and callback handlers call
// `tgCtxFor(from?.id ?? chatId)` first, then pass the result into
// message/keyboard builders. Nothing here guesses from hint/IP/browser.
// Displays only — no order creation, no charge.
import type { DisplayCurrency, Locale } from "@/lib/i18n/locale";
import { readTgPreferences } from "@/lib/telegram/preferences";
import { idrToUsdCents, type FxSnapshot } from "@/lib/payments/fx";
import { loadCurrentFxSnapshot } from "@/lib/payments/market-snapshot";
import { formatIdr, formatUsdCents } from "@/lib/i18n/format";

export type TgRenderPrefs = { locale: Locale; displayCurrency: DisplayCurrency | null };

/** Saved prefs once; unsaved => locale "id" with currency null (honest
 * IDR fallback rendered by callers). */
export async function tgRenderPrefs(from?: { id: number } | null): Promise<TgRenderPrefs> {
  if (!from) return { locale: "id", displayCurrency: null };
  const saved = await readTgPreferences(String(from.id));
  return { locale: saved.locale ?? "id", displayCurrency: saved.currency };
}

/** TG2a per-update context: saved prefs + FX snapshot, resolved ONCE per
 * handler. `userId` is the private owner id (from.id, falling back to chatId
 * for legacy callers); group chats simply have no saved row => id/IDR. */
export type TgCtx = { locale: Locale; displayCurrency: DisplayCurrency | null; fx: FxSnapshot | null };

export async function tgCtxFor(userId: number | null | undefined): Promise<TgCtx> {
  const prefs = await tgRenderPrefs(userId == null ? null : { id: userId });
  const fx = prefs.displayCurrency === "USD" ? await loadCurrentFxSnapshot() : null;
  return { locale: prefs.locale, displayCurrency: prefs.displayCurrency, fx };
}

/** ONE primary display-currency price for buttons/lines. USD only when the
 * buyer chose USD AND the FX snapshot is fresh; otherwise honest IDR. The
 * caller converts an already-summed integer IDR subtotal — never per-unit
 * then multiply. USD text is display-only ("USD", never "USDT"); the real
 * rail currency is unchanged (QRIS/gateway IDR, crypto USD). */
export function tgDisplayPrice(idr: number, ctx: Pick<TgCtx, "locale" | "displayCurrency" | "fx">): string {
  if (ctx.displayCurrency === "USD" && ctx.fx) {
    try {
      return formatUsdCents(idrToUsdCents(idr, ctx.fx), ctx.locale);
    } catch { /* fall through to honest IDR */ }
  }
  return formatIdr(idr, ctx.locale);
}

/** Optional honest USD alternate for detail/cart summary lines. Returns the
 * exact `≈ USD` text when USD is chosen and FX is fresh; `usdUnavailable`
 * when USD is stored but FX is missing/stale (caller renders the fallback
 * line once and keeps the stored USD choice — no fake rate, no $0). */
export function tgUsdAlternate(
  idrSubtotal: number,
  ctx: Pick<TgCtx, "locale" | "displayCurrency" | "fx">,
): { usdEquivalentText: string | null; usdUnavailable: boolean } {
  if (ctx.displayCurrency !== "USD") return { usdEquivalentText: null, usdUnavailable: false };
  if (!ctx.fx) return { usdEquivalentText: null, usdUnavailable: true };
  try {
    return { usdEquivalentText: formatUsdCents(idrToUsdCents(idrSubtotal, ctx.fx), ctx.locale), usdUnavailable: false };
  } catch {
    return { usdEquivalentText: null, usdUnavailable: true };
  }
}
