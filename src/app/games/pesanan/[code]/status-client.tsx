"use client";
// Halaman pesanan AXVARA Games — hierarki, gaya dan tombol mengikuti halaman
// pesanan Pedia: kartu kaca terpusat, QRIS ringkas + "Cek Pembayaran" saat
// menunggu bayar, lalu status/timeline/SN setelah dibayar.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { usePaymentConsent } from "@/hooks/usePaymentConsent";
import { GatewayPaymentPanel } from "@/components/storefront/GatewayPaymentPanel";
import { QrisImage, sameOriginQris } from "@/components/storefront/QrisImage";
import { InlineSpinner, PediaOrderSkeleton } from "@/components/storefront/Skeletons";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";
import { fillGames, gamesManualRefundCopy, gamesOrderCopy, rememberGamesDeviceOrder } from "@/lib/games/order-copy";
import { isValidOrderContact, orderAccessHeaders, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";
import { normalizePaymentView, paymentMethodLabel } from "@/lib/payment-ui";
import { parseExpiry } from "@/lib/expiry";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { SITE, supportTelegramLink, waHubLink } from "@/lib/site";

type GamesStatus = "awaiting_payment" | "processing" | "success" | "needs_admin" | "expired";
type Order = { code: string; games_status: GamesStatus; manual_refund_required?: boolean; game: { name: string; slug: string } | null; product_name: string; customer_no: string; customer_nickname: string | null; total: number; payment_method: string; sn: string | null; supplier_message: string | null; paid_at?: string | null; payment: unknown; qris: { image_url: string; payable_amount: number; unique_code: number | null; expires_at: string; status: string } | null };
const STATUSES: GamesStatus[] = ["awaiting_payment", "processing", "success", "needs_admin", "expired"];
const terminal = (status: GamesStatus) => status === "success" || status === "expired";
const pollMs = (status: GamesStatus) => status === "awaiting_payment" ? 5000 : status === "processing" ? 10000 : status === "needs_admin" ? 30000 : null;
const linkClass = "flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl";

const VISUAL: Record<GamesStatus, { icon: string; shell: string; filter: string }> = {
  awaiting_payment: { icon: "/icons/ios11/clock-96.png", shell: "bg-[#FFB800]/15", filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" },
  processing: { icon: "/icons/ios11/clock-96.png", shell: "bg-[#00E5FF]/15", filter: "brightness(0) saturate(100%) invert(84%) sepia(61%) saturate(2400%) hue-rotate(140deg)" },
  success: { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" },
  needs_admin: { icon: "/icons/ios11/clock-96.png", shell: "bg-violet-400/15", filter: "brightness(0) invert(1) opacity(.8)" },
  expired: { icon: "/icons/ios11/clock-96.png", shell: "bg-white/10", filter: "brightness(0) invert(1) opacity(.55)" },
};
const PILL: Record<GamesStatus, string> = {
  awaiting_payment: "border-[#FFB800]/20 bg-[#FFB800]/15 text-[#FFB800]",
  processing: "border-[#00E5FF]/25 bg-[#00E5FF]/10 text-[#5cefff]",
  success: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  needs_admin: "border-violet-400/25 bg-violet-400/10 text-violet-200",
  expired: "border-white/10 bg-white/10 text-white/50",
};

export function GameStatus({ code }: { code: string }) {
  const locale = useDisplayLocale(); const t = gamesOrderCopy(locale);
  const [order, setOrder] = useState<Order | null>(null); const [contact, setContact] = useState("");
  const [needsContact, setNeedsContact] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [copied, setCopied] = useState(""); const [now, setNow] = useState(() => Date.now()); const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const proof = useRef(""); const pending = useRef(false); const active = useRef(true);
  const notFound = t.trackNotFound; const loadFailed = t.trackConnection;
  const load = useCallback(async (override = "", wake = false) => {
    if (pending.current) return;
    const value = (override || proof.current || readOrderContact(code)).trim();
    if (!isValidOrderContact(value)) { setNeedsContact(true); return; }
    pending.current = true; setBusy(true);
    try {
      const res = await fetch(`/api/games/orders/${encodeURIComponent(code)}${wake ? "?wake=1" : ""}`, { cache: "no-store", headers: { ...orderAccessHeaders(code, value), "x-order-contact": value } });
      const data = await res.json();
      if (!res.ok) { if ([401, 404].includes(res.status)) { setNeedsContact(true); throw new Error(notFound); } throw new Error(data.error || loadFailed); }
      if (!data.order || !STATUSES.includes(data.order.games_status)) throw new Error(loadFailed);
      if (active.current) {
        proof.current = value; rememberOrderContact(code, value);
        const next = data.order as Order;
        rememberGamesDeviceOrder(code, [next.game?.name, next.product_name].filter(Boolean).join(" — ") || code);
        setOrder(next); setNeedsContact(false); setError(""); setCheckedAt(new Date());
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : loadFailed); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }, [code, notFound, loadFailed]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  const status = order?.games_status;
  useEffect(() => {
    const interval = status ? pollMs(status) : null;
    if (interval === null) return;
    const tick = () => { if (!document.hidden) void load(); };
    const timer = setInterval(tick, interval);
    const visible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load, status]);
  useEffect(() => { if (status !== "awaiting_payment") return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [status]);
  const consent = usePaymentConsent({ code, locale, resolveContact: (input) => input.trim() || proof.current, refresh: () => load("", true), onAccepted: (value) => { proof.current = value; rememberOrderContact(code, value); } });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(value); } catch { /* teks tetap bisa disalin manual */ } };

  if (needsContact && !order) return <form onSubmit={(event) => { event.preventDefault(); if (isValidOrderContact(contact)) void load(contact.trim()); else setError(t.trackContactBad); }} className="mx-auto max-w-md space-y-4 px-4 py-10">
    <h1 className="font-display text-2xl font-semibold text-white">{t.track}</h1>
    <label className="block text-sm text-white/75" htmlFor="games-order-contact">{t.trackContact}</label>
    <p className="text-xs leading-5 text-white/60">{t.trackContactHint}</p>
    <input id="games-order-contact" required value={contact} onChange={(event) => setContact(event.target.value)} maxLength={254} autoComplete="off" placeholder={t.trackContactPlaceholder} className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white" />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <button disabled={busy} className="rounded-full bg-[#00E5FF] px-5 py-3 font-semibold text-[#070a1e] disabled:opacity-50">{busy ? t.checking : t.track}</button>
  </form>;
  if (!order) return error ? <div className="pt-10 text-center"><p role="alert" className="text-sm text-red-300">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-full bg-[#00E5FF] px-5 py-3 text-sm font-semibold text-[#070a1e]">{t.refresh}</button></div> : <PediaOrderSkeleton label={t.checking} />;

  const s = order.games_status;
  const refund = s === "needs_admin" && order.manual_refund_required === true ? gamesManualRefundCopy[locale] : null;
  const awaiting = s === "awaiting_payment"; const expired = s === "expired"; const paid = !awaiting && !expired;
  const payment = normalizePaymentView(order.payment); const qris = order.qris;
  const qrExpired = Boolean(qris) && (["expired", "failed"].includes(String(qris?.status)) || (parseExpiry(qris?.expires_at ?? "") ?? 0) <= now);
  const compact = awaiting && (Boolean(qris) || payment !== null);
  const seconds = Math.max(0, Math.ceil(((parseExpiry(qris?.expires_at ?? "") ?? 0) - now) / 1000));
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const method = payment?.kind === "crypto" ? `${payment.symbol}${payment.networkLabel ? ` (${payment.networkLabel})` : ""}` : payment || order.payment_method === "qris" ? paymentMethodLabel(payment, order.payment_method).replace(/\s+realtime\b/ig, "") : t.noSelection;
  const paymentTitle = payment ? (payment.kind === "crypto" ? t.payCrypto : fillGames(t.payGateway, { label: payment.label })) : t.payTitle;
  const paidAt = order.paid_at ? formatWibDateTime(order.paid_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const visual = VISUAL[s];
  const proofText = [order.sn, order.supplier_message].filter(Boolean).join("\n");
  const help = (text: string) => `${SITE.webUrl}${waHubLink(`${text} ${order.code}`)}`;
  const timeline = [
    { label: t.steps[0], done: true, active: awaiting },
    { label: t.steps[1], done: paid, active: false },
    { label: refund?.title ?? t.steps[2], done: paid && !refund, active: !refund && (s === "processing" || s === "needs_admin") },
    { label: t.steps[3], done: s === "success", active: false },
  ];
  const codeButton = (cls: string) => <button type="button" onClick={() => void copy(order.code)} aria-label={t.copyCode} className={cls}><span className="break-all">{order.code}</span>{copied === order.code ? <Check size={11} aria-hidden="true" className="ml-1 inline" /> : <Copy size={11} aria-hidden="true" className="ml-1 inline opacity-70" />}</button>;
  const rows: [string, string][] = [[t.game, order.game?.name ?? "—"], [t.accountId, `${order.customer_no}${order.customer_nickname ? ` · ${order.customer_nickname}` : ""}`], [t.amount, order.product_name || "—"], [t.method, method]];
  // Total = nominal yang benar-benar ditagih/dibayar: QRIS + kode unik, atau total gateway (+biaya).
  const paidTotal = qris ? Number(qris.payable_amount) : payment?.kind === "gateway" && payment.total ? payment.total : order.total;
  const summary = <>
    <dl className="space-y-2">{rows.map(([key, value]) => <div key={key} className="flex justify-between gap-3 text-[13px] leading-5"><dt className="shrink-0 text-white/70">{key}</dt><dd className="min-w-0 break-words text-right font-medium text-white">{value}</dd></div>)}</dl>
    <div className="mt-3 flex justify-between gap-3 border-t border-white/10 pt-3"><span className="text-sm text-white/60">{t.total}</span><span className="shrink-0 font-bold text-white">{formatRupiah(paidTotal)}</span></div>
  </>;

  return (
    <div className={`mx-auto px-4 sm:px-6 ${compact ? "max-w-[760px] py-4 sm:py-6" : "max-w-[640px] py-10"}`}>
      <section aria-label={t.summary} className={`ax-glass-card text-center ${compact ? "rounded-2xl p-4 sm:p-5" : "rounded-[28px] p-6 sm:p-8"}`}>
        {compact ? (
          <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2 text-center sm:grid-cols-[40px_auto_40px] sm:justify-center sm:gap-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${visual.shell}`}>
              <span className={!qrExpired ? "animate-[spin_3s_linear_infinite] motion-reduce:animate-none" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={visual.icon} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" style={{ filter: visual.filter }} draggable={false} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-base font-bold leading-6 text-white sm:text-lg">{paymentTitle}</h1>
              <div className="mt-1">{codeButton("font-mono text-[11px] font-semibold tracking-[0.04em] text-[#00E5FF]")}</div>
            </div>
          </div>
        ) : <>
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${visual.shell}`}>
            <span className={s === "processing" ? "animate-[spin_3s_linear_infinite] motion-reduce:animate-none" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={visual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: visual.filter }} draggable={false} />
            </span>
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-white">{refund?.title ?? t.titles[s]}</h1>
          <div className="mt-2">{codeButton("font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]")}</div>
          <div role="status" aria-live="polite" className="mt-3">
            <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${PILL[s]}`}>{refund?.pill ?? t.pills[s]}</span>
            {paid && paidAt && <p className="mt-1.5 text-[11px] text-white/50">{fillGames(t.paidAt, { time: paidAt })}</p>}
          </div>
          {s !== "awaiting_payment" && <p className="mt-4 text-sm leading-6 text-white/60">{refund?.text ?? t.leads[s]}</p>}
        </>}

        {compact && qris && (
          <section className="mt-3 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 sm:p-4" aria-label="QRIS">
            {qrExpired ? (
              <div className="py-2">
                <p className="font-display text-base font-bold text-white">{t.qrisExpiredTitle}</p>
                <p className="mx-auto mt-2 max-w-[360px] text-xs leading-relaxed text-white/55">{t.qrisExpiredNote}</p>
              </div>
            ) : (
              <div className="grid items-center gap-3 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-5">
                <div className="min-w-0 sm:h-[290px]">
                  <p className="text-xs font-semibold text-white/80">{t.scan}</p>
                  <QrisImage key={`${qris.image_url}|${qris.expires_at}`} src={sameOriginQris(qris.image_url)} alt={t.qrisAlt} loadingLabel={t.qrisLoading} failedLabel={t.qrisFailed} retryLabel={t.qrisRetry} />
                  <div className="mt-2 flex items-center justify-center gap-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/qris.svg" alt="QRIS" width={48} height={18} className="h-[18px] w-auto object-contain" draggable={false} />
                    <span className="text-[9px] text-white/55">{t.nationalStandard}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="mb-2 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">{t.waitingPay}</span>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{t.totalPay}</p>
                  <p className="font-display text-2xl font-bold leading-8 text-white">{formatRupiah(qris.payable_amount)}</p>
                  {(qris.unique_code ?? 0) > 0 && <p className="text-[11px] text-white/50">{t.uniqueCode} <span className="font-mono text-[#00E5FF]">+{qris.unique_code}</span></p>}
                  <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-[#FFB800]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFB800]" /><span>{t.validFor} <span aria-label={t.timeLeftAria}>{countdown}</span></span></div>
                  <p className="mt-1 text-[11px] text-white/50">{t.payExactly}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a href={sameOriginQris(qris.image_url)} download={`AXVARA-${order.code}-QRIS.png`} className="inline-flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/15 px-2 text-xs font-semibold text-white/75 hover:bg-white/10">{t.saveQris}</a>
                    <button type="button" disabled={busy} onClick={() => void load("", true)} className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-2 text-xs font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:opacity-50">{busy && <InlineSpinner />}{busy ? t.checking : t.checkPayment}</button>
                  </div>
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] leading-4 text-white/50" aria-live="polite"><InlineSpinner className="h-3 w-3 shrink-0" /><span>{t.autoCheck}</span></p>
                </div>
              </div>
            )}
          </section>
        )}

        {awaiting && payment && (
          <div className="mt-3 text-left">
            <GatewayPaymentPanel payment={payment} locale={locale} now={now} checking={busy} onCheck={() => void load("", true)} contactKnown={Boolean(proof.current)}
              consent={{ busy: consent.busy, error: consent.error, stale: consent.stale, onApprove: (total, value) => void consent.approve(total, value) }} />
          </div>
        )}

        {error && <div role="alert" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">{fillGames(t.error, { error })}</div>}

        {s === "success" && proofText && (
          <section aria-label={t.sn} className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-300/80">{t.sn}</p>
            <p className="mt-2 whitespace-pre-wrap break-all font-mono text-sm font-semibold text-white">{proofText}</p>
            <button type="button" onClick={() => void copy(proofText)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-emerald-400/25 px-4 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/10">{copied === proofText ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied === proofText ? t.copied : t.copy}</button>
          </section>
        )}

        {s === "needs_admin" && (
          <div className="mt-6 rounded-2xl border border-violet-400/25 bg-violet-400/[0.06] p-4 text-left text-sm text-white/75">
            <p className="font-semibold text-white">{refund?.pill ?? t.needsAdminTitle}</p>
            <a href={help(t.supportMessage)} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#080C1E]">{t.adminWhatsApp}</a>
          </div>
        )}

        {compact ? (
          <div className="mt-3 text-left"><MobileCollapsible title={t.summary} meta={t.summaryMeta}>{summary}</MobileCollapsible></div>
        ) : <div className="ax-glass-card mt-6 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.summary}</p>
          <div className="mt-3">{summary}</div>
        </div>}

        {paid && <div className="ax-glass-card mt-4 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.progress}</p>
          <ol className="mt-4" aria-label={t.timelineAria}>
            {timeline.map((step, i) => <li key={step.label} aria-current={step.active ? "step" : undefined} className="relative flex gap-4 pb-7 last:pb-0">
              {i < 3 && <span aria-hidden="true" className={`absolute bottom-0 left-[13px] top-7 w-px ${timeline[i + 1].done ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
              <span aria-hidden="true" className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${step.done ? "border-[#00E5FF] bg-[#0F273C] text-[#00E5FF]" : "border-white/15 bg-[#0F1430] text-white/45"} ${step.active ? "ring-4 ring-[#00E5FF]/15" : ""}`}>{step.done && !step.active ? <Check size={14} /> : i + 1}</span>
              <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${step.done ? "text-white" : "text-white/45"}`}>{step.label}</p>
                {i === 0 && <p className="mt-1 text-xs leading-5 text-white/50">{t.stepCodeHint}</p>}
                {i === 2 && s === "processing" && <p className="mt-1 text-xs leading-5 text-white/50">{t.stepProcessing}</p>}
                {i === 2 && s === "needs_admin" && !refund && <p className="mt-1 text-xs leading-5 text-violet-200/80">{t.stepNeedsAdmin}</p>}
              </div>
            </li>)}
          </ol>
          {!terminal(s) && checkedAt && <p className="mt-4 text-[11px] text-white/35">{fillGames(t.updated, { time: checkedAt.toLocaleTimeString(locale === "en" ? "en-US" : "id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), seconds: (pollMs(s) ?? 10000) / 1000 })}</p>}
          {!terminal(s) && <button type="button" disabled={busy} onClick={() => void load("", true)} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-sm font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:opacity-50">{busy && <InlineSpinner />}{busy ? t.checking : t.refresh}</button>}
        </div>}

        {compact
          ? <div className="mt-3 grid grid-cols-2 gap-2.5 text-left">
              <Link href="/games/lacak" className={`${linkClass} border border-white/10 bg-white/[0.03] px-2 text-[11px] font-medium text-white/60 transition hover:bg-white/[0.06] sm:text-xs`}>{t.track}</Link>
              <Link href={order.game ? `/games/${order.game.slug}` : "/games"} className={`${linkClass} border border-white/10 bg-white/[0.03] px-2 text-[11px] font-medium text-white/60 transition hover:bg-white/[0.06] sm:text-xs`}>{t.continueShopping}</Link>
            </div>
          : <div className="mt-6 grid grid-cols-2 gap-2.5">
              <Link href="/games/lacak" className={`ax-glass-card ${linkClass} px-3 text-sm font-semibold text-white hover:bg-white/10`}>{t.track}</Link>
              <Link href={order.game ? `/games/${order.game.slug}` : "/games"} className={`ax-glass-card ${linkClass} px-3 text-sm font-semibold text-white hover:bg-white/10`}>{terminal(s) ? t.orderAgain : t.continueShopping}</Link>
            </div>}

        <div className={compact ? "mt-4 border-t border-white/10 pt-3" : "mt-3"}>
          <p className="text-center text-[11px] text-white/35">{t.needHelp}</p>
          <div className={compact ? "mt-2 flex items-center justify-center gap-3" : "mt-2 grid grid-cols-2 gap-2.5"}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={help(t.supportMessage)} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></a>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
          </div>
        </div>
        <p className={`${compact ? "mt-1 text-[10px] leading-4" : "mt-4 text-[11px] leading-5"} text-center text-white/35`}>{t.footer.split("{link}")[0]}<Link href="/games/ketentuan" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">{t.footerLink}</Link>{t.footer.split("{link}")[1]}</p>
      </section>
    </div>
  );
}
