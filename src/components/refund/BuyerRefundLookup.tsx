"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { Locale } from "@/lib/i18n/locale";
import { MARKET_INVOICE, type Estimate } from "@/lib/refund/calculate";
import { requestRefund } from "@/lib/refund/client";
import { refundButton, refundInput, RefundResult } from "./RefundResult";

export function BuyerRefundLookup({ initialCode, locale }: { initialCode: string; locale: Locale }) {
  const [code, setCode] = useState(initialCode);
  const [lookup, setLookup] = useState<{ code: string } | null>(initialCode ? { code: initialCode } : null);
  const [result, setResult] = useState<{ estimate: Estimate; locale?: Locale }>();
  const [busy, setBusy] = useState(Boolean(initialCode));
  const [error, setError] = useState("");
  const t = (id: string, en: string) => locale === "en" ? en : id;

  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    void requestRefund("/api/refund", lookup, controller.signal).then(body => {
      if (controller.signal.aborted) return;
      if (!body.estimate) throw new Error("unavailable");
      setResult({ estimate: body.estimate, locale: body.locale });
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "unavailable");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [lookup]);

  const check = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const clean = code.trim().toUpperCase();
    if (!MARKET_INVOICE.test(clean)) { setError("format"); return; }
    setCode(clean); setResult(undefined); setError(""); setBusy(true);
    setLookup({ code: clean });
  };
  const errors: Record<string, string> = {
    format: t("Masukkan nomor invoice AXV yang valid.", "Enter a valid AXV invoice number."),
    not_found: t("Invoice Market tidak ditemukan. Cek lagi nomornya.", "Market invoice not found. Check the number and try again."),
    rate: t("Terlalu sering. Coba lagi sebentar.", "Too many requests. Try again shortly."),
  };
  const retry = error && error !== "format" && error !== "not_found";

  return <div className="space-y-4">
    <form method="post" onSubmit={check} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-2 text-xs font-semibold text-white/80">
          {t("Nomor invoice AXVARA", "AXVARA invoice number")}
          <input autoCapitalize="characters" spellCheck={false} autoComplete="off" placeholder="AXV-…" maxLength={32} className={refundInput} value={code} required aria-invalid={error === "format" || error === "not_found"} onChange={event => {
            setCode(event.target.value); setLookup(null); setResult(undefined); setBusy(false); setError("");
          }} />
        </label>
        <button type="submit" className={`${refundButton} shrink-0 bg-cyan-300/15`} disabled={busy}><Search size={16} aria-hidden />{retry ? t("Coba lagi", "Try again") : t("Cek Invoice", "Check Invoice")}</button>
      </div>
      {!lookup && !error && <p className="text-xs text-white/65">{t("Masukkan nomor invoice untuk melihat estimasi refund.", "Enter your invoice number to see the estimate.")}</p>}
      {busy && <p role="status" className="text-sm text-white/65">{t("Memuat…", "Loading…")}</p>}
      {error && <p role="alert" className="text-sm text-rose-200">{errors[error] ?? t("Belum bisa dimuat. Coba lagi.", "Couldn’t load. Try again.")}</p>}
    </form>
    {result && <div className="border-t border-white/10 pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <RefundResult estimate={result.estimate} locale={result.locale ?? locale} />
    </div>}
  </div>;
}
