"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { usePaymentConsent } from "@/hooks/usePaymentConsent";
import { GatewayPaymentPanel } from "@/components/storefront/GatewayPaymentPanel";
import { gamesCopy } from "@/lib/games/copy";
import { readPediaContact, rememberPediaContact } from "@/lib/pedia/buyer-session";
import { isValidOrderContact, orderAccessHeaders, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";
import { normalizePaymentView, paymentMethodLabel } from "@/lib/payment-ui";
import { parseExpiry } from "@/lib/expiry";
import { formatRupiah } from "@/lib/utils";
import { SITE, waHubLink } from "@/lib/site";

type GamesStatus = "awaiting_payment" | "processing" | "success" | "needs_admin" | "expired";
type Order = { code: string; games_status: GamesStatus; game: { name: string; slug: string } | null; product_name: string; customer_no: string; customer_nickname: string | null; total: number; payment_method: string; sn: string | null; supplier_message: string | null; payment: unknown; qris: { image_url: string; payable_amount: number; unique_code: number | null; expires_at: string; status: string } | null };
const terminal = (status: GamesStatus) => status === "success" || status === "expired";
const button = "inline-flex min-h-11 items-center justify-center rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF] disabled:opacity-50";

export function GameStatus({ code }: { code: string }) {
  const locale = useDisplayLocale(); const t = gamesCopy(locale);
  const [order, setOrder] = useState<Order | null>(null); const [contact, setContact] = useState("");
  const [needsContact, setNeedsContact] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [copied, setCopied] = useState(""); const [now, setNow] = useState(Date.now());
  const proof = useRef(""); const pending = useRef(false); const active = useRef(true);
  const load = useCallback(async (override = "", wake = false) => {
    if (pending.current) return;
    const value = (override || proof.current || readOrderContact(code) || readPediaContact(code)).trim();
    if (!isValidOrderContact(value)) { setNeedsContact(true); return; }
    pending.current = true; setBusy(true);
    try {
      const res = await fetch(`/api/games/orders/${encodeURIComponent(code)}${wake ? "?wake=1" : ""}`, { cache: "no-store", headers: { ...orderAccessHeaders(code, value), "x-order-contact": value } });
      const data = await res.json();
      if (!res.ok) { if ([401, 404].includes(res.status)) { setNeedsContact(true); throw new Error(t.statusError); } throw new Error(data.error || t.loadError); }
      if (!data.order || !["awaiting_payment", "processing", "success", "needs_admin", "expired"].includes(data.order.games_status)) throw new Error(t.loadError);
      if (active.current) { proof.current = value; rememberPediaContact(code, value); rememberOrderContact(code, value); setOrder(data.order); setNeedsContact(false); setError(""); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t.loadError); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }, [code, t.statusError, t.loadError]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  useEffect(() => {
    if (!order || terminal(order.games_status)) return;
    const timer = setInterval(() => { if (!document.hidden) void load(); }, order.games_status === "awaiting_payment" ? 5000 : order.games_status === "needs_admin" ? 30000 : 10000);
    const visible = () => { if (!document.hidden) void load(); }; document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load, order]);
  useEffect(() => { if (order?.games_status !== "awaiting_payment") return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [order?.games_status]);
  const consent = usePaymentConsent({ code, locale, resolveContact: (input) => input.trim() || proof.current, refresh: () => load("", true), onAccepted: (value) => { proof.current = value; rememberPediaContact(code, value); } });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(value); } catch {} };
  const form = <form onSubmit={(event) => { event.preventDefault(); if (isValidOrderContact(contact)) void load(contact); else setError(t.trackContactInvalid); }} className="mx-auto max-w-lg space-y-4 px-4 py-12"><h1 className="font-display text-3xl font-bold">{t.statusTitle}</h1><p className="text-sm text-white/60">{t.contactPrompt}</p><label className="block text-sm">{t.contactField}<input required value={contact} onChange={(event) => setContact(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/15 bg-white/5 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" /></label>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}<button disabled={busy} className={button}>{t.viewOrder}</button></form>;
  if (needsContact) return form;
  if (!order) return <div className="mx-auto max-w-lg px-4 py-12"><p role={error ? "alert" : "status"}>{error || t.statusLoading}</p>{error && <button className={`${button} mt-4`} onClick={() => void load()}>{t.retry}</button>}</div>;
  const status = { awaiting_payment: t.awaiting, processing: t.processingStatus, success: t.success, needs_admin: t.needsAdmin, expired: t.expired }[order.games_status];
  const payment = normalizePaymentView(order.payment); const qris = order.qris;
  const remaining = qris && !["expired", "failed"].includes(qris.status) ? Math.max(0, Math.ceil(((parseExpiry(qris.expires_at) ?? 0) - now) / 1000)) : 0;
  const deadline = qris ? parseExpiry(qris.expires_at) : null;
  const dueTime = deadline === null ? null : new Intl.DateTimeFormat(locale === "en" ? "en-US" : "id-ID", { timeZone: "Asia/Jakarta", hour: "numeric", minute: "2-digit", hour12: locale === "en" }).format(deadline);
  const method = payment?.kind === "crypto" ? `${payment.symbol}${payment.networkLabel ? ` (${payment.networkLabel})` : ""}` : payment || order.payment_method === "qris" ? paymentMethodLabel(payment, order.payment_method).replace(/\s+realtime\b/ig, "") : t.noSelection;
  const tone = { awaiting_payment: "border-amber-400/30 bg-amber-400/10 text-amber-200", processing: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200", success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200", needs_admin: "border-orange-400/30 bg-orange-400/10 text-orange-200", expired: "border-white/15 bg-white/5 text-white/60" }[order.games_status];
  const paid = ["processing", "success", "needs_admin"].includes(order.games_status);
  const image = qris?.image_url && (() => { try { const url = new URL(qris.image_url, "https://x.invalid"); return url.pathname.startsWith("/api/payments/qris/") ? `${url.pathname}${url.search}` : qris.image_url; } catch { return ""; } })();
  return <div className="mx-auto max-w-[920px] px-4 py-12 sm:px-6"><p className="text-xs font-bold tracking-[.2em] text-[#FFB800]">AXVARA GAMES</p><h1 className="mt-3 font-display text-3xl font-bold">{order.games_status === "awaiting_payment" ? t.finishPayment : status}</h1><p className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{status}</p><ol aria-label={t.statusTitle} className="mt-6 grid grid-cols-3 gap-2">{[t.paidStep, t.processedStep, t.successStep].map((step, index) => { const complete = index === 0 ? paid : index === 1 ? order.games_status === "processing" || order.games_status === "success" : order.games_status === "success"; return <li key={step} className={`border-t-2 pt-2 text-xs ${complete ? "border-[#00E5FF] text-white" : "border-white/15 text-white/45"}`}>{step}</li>; })}</ol><div className="mt-6 grid gap-5 md:grid-cols-2">
    {order.games_status === "awaiting_payment" && qris && <section className="ax-glass rounded-2xl border border-white/10 p-6 text-center"><h2 className="font-display text-xl font-bold">QRIS</h2>{image && remaining > 0 && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="QRIS" className="mx-auto mt-4 h-56 w-56 max-w-full rounded-xl bg-white p-2" /></>}<p className="mt-4 font-display text-2xl font-bold">{formatRupiah(qris.payable_amount)}</p>{Boolean(qris.unique_code) && <p className="mt-1 text-xs text-white/60">{t.unique}: +{qris.unique_code}</p>}<p className="mt-2 text-sm text-white/80">{t.timeRemaining} {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</p>{dueTime && <p className="mt-1 text-xs text-white/55">{t.paymentDue} {dueTime} WIB</p>}</section>}
    {order.games_status === "awaiting_payment" && payment && <GatewayPaymentPanel payment={payment} locale={locale} now={now} checking={busy} onCheck={() => void load("", true)} contactKnown={Boolean(proof.current)} consent={{ busy: consent.busy, error: consent.error, stale: consent.stale, onApprove: (total, value) => void consent.approve(total, value) }} />}
    <section className="ax-glass rounded-2xl border border-white/10 p-6"><h2 className="font-display text-xl font-bold">{t.summary}</h2><dl className="mt-5 space-y-3 text-sm">{[[t.game, order.game?.name ?? "—"], [t.accountId, `${order.customer_no}${order.customer_nickname ? ` · ${order.customer_nickname}` : ""}`], [t.amountLabel, order.product_name], [t.method, method], [t.total, formatRupiah(order.total)]].map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt className="text-white/55">{key}</dt><dd className="break-all text-right">{value}</dd></div>)}<div className="flex justify-between gap-3"><dt className="text-white/55">{t.code}</dt><dd className="break-all text-right">{order.code} <button onClick={() => void copy(order.code)} className="min-h-11 text-[#00E5FF]">{copied === order.code ? t.copied : t.copy}</button></dd></div></dl></section>
    {order.games_status === "success" && (order.sn || order.supplier_message) && <section className="ax-glass rounded-2xl border border-white/10 p-6"><h2 className="font-display font-bold">{t.sn}</h2><p className="mt-3 whitespace-pre-wrap break-all text-sm">{[order.sn, order.supplier_message].filter(Boolean).join("\n")}</p><button onClick={() => void copy([order.sn, order.supplier_message].filter(Boolean).join("\n"))} className="mt-3 min-h-11 text-sm text-[#00E5FF]">{copied === [order.sn, order.supplier_message].filter(Boolean).join("\n") ? t.copied : t.copy}</button></section>}
  </div>{error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}<div className="mt-6 flex flex-wrap gap-3">{order.games_status === "needs_admin" && <a href={SITE.webUrl + waHubLink(`${t.supportMessage} ${order.code}`)} className={button}>{t.adminWhatsApp}</a>}{!terminal(order.games_status) && <button disabled={busy} onClick={() => void load("", true)} className={order.games_status === "needs_admin" ? "inline-flex min-h-11 items-center rounded-xl border border-white/20 px-5 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]" : button}>{t.checkStatus}</button>}{order.games_status === "expired" && order.game && <Link href={`/games/${order.game.slug}`} className={button}>{t.orderAgain}</Link>}</div></div>;
}
