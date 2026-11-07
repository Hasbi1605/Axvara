"use client";

import { useState } from "react";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { orderCopy } from "@/lib/i18n/order-copy";

export function OrderAccessNotice({ accessCode }: { accessCode: string }) {
  const t = orderCopy(useDisplayLocale());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(accessCode); setCopied(true); setCopyError(false); }
    catch { setCopied(false); setCopyError(true); }
  }
  if (!accessCode) return null;
  const isPin = accessCode.length === 6;
  return <section aria-label={isPin ? t.accessNotice.pinLabel : t.accessNotice.codeLabel} className="mb-4 rounded-2xl border border-[#00E5FF]/25 bg-[#0B1529] p-4 text-left">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-white">{isPin ? t.accessNotice.pinLabel : t.accessNotice.codeLabel}</h2>
      <button type="button" onClick={() => void copy()} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]">{copied ? t.common.copied : isPin ? t.accessNotice.copyPin : t.accessNotice.copyCode}</button>
    </div>
    <p className={`mt-2 break-all font-mono font-semibold text-white select-all ${isPin ? "text-2xl tracking-[0.18em]" : "text-base tracking-wide"}`}>{accessCode}</p>
    <p className="mt-2 text-xs leading-5 text-white/65">{isPin ? t.accessNotice.pinBody : t.accessNotice.codeBody}</p>
    {copyError && <p role="alert" className="mt-2 text-xs text-amber-200">{t.accessNotice.copyError}</p>}
  </section>;
}
