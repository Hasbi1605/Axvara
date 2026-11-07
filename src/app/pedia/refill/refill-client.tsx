"use client";

// src/app/pedia/refill/refill-client.tsx — Cek & ajukan refill pesanan Pedia (2026-11-01).
// Akses sama dengan status/refill existing: kode AXP + kontak checkout penuh,
// diverifikasi server. Kontak hanya disimpan sessionStorage (buyer-session).
import { useEffect, useRef, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { readPediaContact, rememberPediaContact } from "@/lib/pedia/buyer-session";
import { refillReasonText, refillStatusLabel, type PediaRefillState } from "@/lib/pedia/refill-policy";
import { pediaRefillRules, pediaRefillSteps, pediaTerms, refillLabel } from "@/lib/pedia/terms";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy, pediaNumber } from "@/lib/pedia/copy";
import { formatWibDateTime } from "@/lib/utils";

type RefillOrder = { code: string; product_name: string; quantity: number; target: string; status: string; refill: PediaRefillState };

const CODE_RE = /^AXP-\d{8}-[A-Z0-9]{8}$/;
const STATUS_TEXT_ID: Record<string, string> = { awaiting_payment: "Menunggu bayar", queued: "Diproses", submitting: "Diproses", submitted: "Diproses", in_progress: "Sedang dikirim", completed: "Selesai", partial: "Selesai sebagian", canceled: "Dibatalkan", needs_check: "Diperiksa admin", expired: "Kedaluwarsa" };
const STATUS_TEXT_EN: Record<string, string> = { awaiting_payment: "Waiting to pay", queued: "Processing", submitting: "Processing", submitted: "Processing", in_progress: "Being delivered", completed: "Completed", partial: "Partially completed", canceled: "Canceled", needs_check: "Checked by admin", expired: "Expired" };
const input = "mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/55 focus:border-[#00E5FF]/50 disabled:opacity-60";
const iso = (value: string | null) => formatWibDateTime(value);

export function PediaRefillClient() {
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  const n = (value: number) => pediaNumber(value, locale);
  const statusText = locale === "en" ? STATUS_TEXT_EN : STATUS_TEXT_ID;
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [order, setOrder] = useState<RefillOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const load = async (c: string, k: string) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(c)}`, { headers: { "x-order-contact": k }, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 404 ? t.refillNotFound : data.error ?? t.refillLoadFailed);
      setOrder(data.order); rememberPediaContact(c, k);
    } catch (cause) {
      setOrder(null); setError(cause instanceof Error ? cause.message : t.refillConnection);
    } finally { busy.current = false; setLoading(false); }
  };

  useEffect(() => {
    const c = new URLSearchParams(location.search).get("code")?.trim().toUpperCase() ?? "";
    if (!CODE_RE.test(c)) return;
    setCode(c);
    const saved = readPediaContact(c);
    if (saved) { setContact(saved); void load(c, saved); }
    // `locale` hanya memengaruhi teks galat; muat ulang cukup sekali.
  }, []);

  const submit = async () => {
    if (!order || busy.current) return;
    busy.current = true; setLoading(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(order.code)}/refill`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? t.refillSubmitFailed);
      setNotice(data.message ?? t.refillSubmitted);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.refillSubmitFailed); }
    finally { busy.current = false; setLoading(false); }
    await load(order.code, contact);
  };

  const codeValid = CODE_RE.test(code.trim());
  const r = order?.refill;
  return <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">{t.refillKicker}</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">{t.refillTitle}</h1>
    <p className="mt-3 max-w-[62ch] text-sm leading-6 text-white/55">{t.refillIntro}</p>

    <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form onSubmit={(e) => { e.preventDefault(); if (codeValid && contact.trim()) void load(code.trim(), contact.trim()); }} className="ax-glass-card rounded-[22px] p-5 sm:p-6" aria-label={t.refillCheckTitle} aria-busy={loading} noValidate>
        <div className="mb-5 flex items-center gap-3"><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10"><IosIcon name="search" size={20} tint="#00E5FF" /></span><div><h2 className="text-sm font-semibold text-white">{t.refillCheckTitle}</h2><p className="text-xs text-white/45">{t.refillCheckSub}</p></div></div>
        <label htmlFor="pedia-refill-code" className="block text-xs font-medium text-white/60">{t.refillCode}</label>
        <input id="pedia-refill-code" value={code} disabled={loading} onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={32} placeholder="AXP-20261101-AB12CD34" className={`${input} font-mono font-semibold tracking-[0.06em] placeholder:font-sans placeholder:font-normal placeholder:tracking-normal`} />
        <label htmlFor="pedia-refill-contact" className="mt-4 block text-xs font-medium text-white/60">{t.refillContact}</label>
        <input id="pedia-refill-contact" value={contact} disabled={loading} onChange={(e) => { setContact(e.target.value); setError(null); }} autoComplete="off" maxLength={254} placeholder={t.statusRefillContactPlaceholder} className={input} />
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{error}</p>}
        <button type="submit" disabled={loading || !codeValid || !contact.trim()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-[#080C1E] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">{loading && !order ? t.refillCheckingButton : t.refillCheckButton}</button>
      </form>

      <section aria-live="polite" aria-label={t.refillStatusTitle} className="ax-glass-card rounded-[22px] p-5 sm:p-6">
        {!order || !r ? <><h2 className="text-sm font-semibold text-white">{t.refillStatusTitle}</h2><p className="mt-2 text-sm leading-6 text-white/55">{t.refillStatusEmpty}</p></> : <>
          <p className="font-mono text-xs font-semibold text-[#00E5FF]">{order.code}</p>
          <h2 className="mt-1 text-base font-semibold text-white">{order.product_name} · {n(order.quantity)}</h2>
          <p className="mt-0.5 break-all text-xs text-white/45">{order.target}</p>
          <dl className="mt-4 space-y-2 text-[13px]">
            <div className="flex justify-between gap-3"><dt className="text-white/55">{t.refillOrderRow}</dt><dd className="text-right text-white">{statusText[order.status] ?? order.status}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-white/55">{t.refillWarrantyRow}</dt><dd className={`text-right font-semibold ${r.days > 0 ? "text-[#00E5FF]" : "text-white/70"}`}>{refillLabel(r.days)}</dd></div>
            {r.ends_at && <div className="flex justify-between gap-3"><dt className="text-white/55">{t.refillUntilRow}</dt><dd className="text-right text-white">{iso(r.ends_at) ?? "-"}</dd></div>}
            {r.mode !== "none" && <div className="flex justify-between gap-3"><dt className="text-white/55">{t.refillRouteRow}</dt><dd className="text-right text-white">{r.mode === "api" ? t.refillRouteApi : t.refillRouteManual}</dd></div>}
            {r.status_label && <div className="flex justify-between gap-3"><dt className="text-white/55">{t.refillLastRow}</dt><dd className="text-right text-white">{(r.status ? refillStatusLabel(r.status, locale) : null) ?? r.status_label}{r.last_at ? ` · ${iso(r.last_at)}` : ""}</dd></div>}
          </dl>
          {notice && <p role="status" className="mt-4 rounded-xl border border-[#00E5FF]/25 bg-[#00E5FF]/10 p-3 text-xs leading-5 text-[#9df3ff]">{notice}</p>}
          {r.eligible
            ? <button type="button" onClick={() => void submit()} disabled={loading} className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#00E5FF] text-sm font-bold text-[#080C1E] transition hover:brightness-110 disabled:opacity-60">{loading ? t.refillApplying : t.refillApply}</button>
            : <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-white/65">{r.reason ? refillReasonText(r.reason, locale) : ""}{r.next_at ? fill(t.refillAgainAt, { when: iso(r.next_at) ?? "" }) : ""}</p>}
          <a href={`/pedia/pesanan/${encodeURIComponent(order.code)}`} className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-white/70 underline underline-offset-4 hover:text-white">{t.refillOpenOrder}</a>
        </>}
      </section>
    </div>

    <section aria-labelledby="pedia-refill-how" className="mt-10">
      <h2 id="pedia-refill-how" className="text-lg font-semibold text-white">{t.refillHowTitle}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{pediaRefillSteps(locale).map(([title, body], i) => <section key={title} className="rounded-[22px] ax-glass-card p-5 sm:p-6"><span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00E5FF]/[0.12] text-sm font-bold text-[#00E5FF]">{i + 1}</span><h3 className="mt-4 text-base font-semibold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{body}</p></section>)}</div>
    </section>

    <section className="mt-4 rounded-[22px] ax-glass-card p-5 sm:p-6" aria-labelledby="pedia-refill-rules">
      <h2 id="pedia-refill-rules" className="font-semibold text-white">{t.refillRulesTitle}</h2>
      <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-6 text-white/55">{pediaRefillRules(locale).map((rule) => <li key={rule}>{rule}</li>)}</ul>
    </section>

    <section id="istilah" className="mt-8 scroll-mt-24" aria-labelledby="pedia-refill-terms">
      <h2 id="pedia-refill-terms" className="text-lg font-semibold text-white">{t.refillTermsTitle}</h2>
      <div className="mt-3 space-y-2">{pediaTerms(locale).map(({ term, meaning }) => <details key={term} className="ax-glass-card rounded-2xl px-4 py-3"><summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex min-h-6 items-center justify-between gap-3">{term}<span aria-hidden="true" className="shrink-0"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary><p className="mt-3 text-[13px] leading-6 text-white/60">{meaning}</p></details>)}</div>
    </section>

    <div className="mt-8 flex flex-wrap gap-3">
      <a href="/pedia/lacak" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">{t.refillCtaTrack}</a>
      <a href="/pedia/ketentuan" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.refillCtaTerms}</a>
      <PediaWhatsAppLink message={t.refillAskMessage} className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.refillCtaAdmin}</PediaWhatsAppLink>
    </div>
  </div>;
}
