"use client";

import { useState } from "react";
import { orderAccessHeaders, readCheckoutCredentialGrant } from "@/lib/order-access-client";
import { requestRefund } from "@/lib/refund/client";
import type { Estimate } from "@/lib/refund/calculate";
import type { Locale } from "@/lib/i18n/locale";
import { RefundResult } from "./RefundResult";

export function BuyerEstimate({ code, locale, adminView, contact }: { code: string; locale: Locale; adminView?: boolean; contact?: string }) {
  const [estimate, setEstimate] = useState<Estimate>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const en = locale === "en";
  if (adminView) return <a className="inline-flex min-h-11 items-center font-semibold text-cyan-200 underline underline-offset-4" href={`/admin/refund?code=${encodeURIComponent(code)}`}>Hitung Refund</a>;
  const load = async () => {
    if (estimate) { setEstimate(undefined); return; }
    setBusy(true);
    setError("");
    try {
      const grant = readCheckoutCredentialGrant(code);
      setEstimate((await requestRefund("/api/refund", { code }, { ...orderAccessHeaders(code, contact), ...(grant ? { "x-checkout-credential-grant": grant } : {}) })).estimate);
    } catch (error) { setError(error instanceof Error ? error.message : "unavailable"); }
    finally { setBusy(false); }
  };
  return <div className="mt-1">
    <button type="button" aria-expanded={!!estimate} disabled={busy} onClick={() => void load()} className="inline-flex min-h-11 items-center rounded-md font-semibold text-cyan-200 underline decoration-cyan-200/40 underline-offset-4 transition-colors hover:text-white focus-visible:outline-cyan-300 disabled:opacity-60 motion-reduce:transition-none">{busy ? (en ? "Loading…" : "Memuat…") : estimate ? (en ? "Hide estimate" : "Tutup estimasi") : (en ? "Check refund estimate" : "Cek Estimasi Refund")}</button>
    {estimate && <div className="mt-2 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"><RefundResult estimate={estimate} locale={locale} /></div>}
    {error && <p role="alert" className="text-xs text-white/75">{error === "access" ? <a href="/lacak-pesanan" className="underline">{en ? "Verify your order first." : "Verifikasi di Lacak Pesanan."}</a> : (en ? "Couldn’t load. Try again." : "Belum bisa dimuat. Coba lagi.")}</p>}
  </div>;
}
