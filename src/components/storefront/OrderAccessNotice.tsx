"use client";

import { useState } from "react";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { orderCopy } from "@/lib/i18n/order-copy";
import type { Locale } from "@/lib/i18n/locale";

export function OrderAccessNotice({ accessCode, locale }: { accessCode: string; locale?: Locale }) {
  const displayLocale = useDisplayLocale();
  const t = orderCopy(locale ?? displayLocale);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(accessCode); setCopied(true); setCopyError(false); }
    catch { setCopied(false); setCopyError(true); }
  }
  if (!accessCode) return null;
  const isPin = accessCode.length === 6;
  return <section aria-label={isPin ? t.accessNotice.pinLabel : t.accessNotice.codeLabel} className="ax-glass-card my-4 rounded-2xl px-4 py-2 text-left">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="text-xs font-medium text-white/60">{isPin ? t.accessNotice.pinLabel : t.accessNotice.codeLabel}</h2>
      {isPin && <p className="select-all font-mono text-base font-semibold tracking-[0.12em] text-white">{accessCode}</p>}
      <button type="button" onClick={() => void copy()} aria-label={copied ? t.common.copied : isPin ? t.accessNotice.copyPin : t.accessNotice.copyCode} className="ml-auto min-h-11 min-w-11 rounded-lg px-1 text-xs font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]">{copied ? t.common.copied : isPin ? t.common.copy : t.accessNotice.copyCode}</button>
    </div>
    {!isPin && <p className="break-all font-mono text-base font-semibold tracking-wide text-white select-all">{accessCode}</p>}
    <p className="pb-1 text-[11px] leading-5 text-white/50">{isPin ? t.accessNotice.pinBody : t.accessNotice.codeBody}</p>
    {copyError && <p role="alert" className="mt-2 text-xs text-amber-200">{t.accessNotice.copyError}</p>}
  </section>;
}
