// src/app/pedia/pesanan/[code]/page.tsx — Status pesanan (PD-12, DESIGN §6.4).
// Panel QRIS, timeline/progres server, refill dan penyelesaian manual.
"use client";
export const runtime = "edge";

import { refillLabel, refillPromise } from "@/lib/pedia/terms";
import { refillReasonText, refillStatusLabel, type PediaRefillState } from "@/lib/pedia/refill-policy";
import { readPediaContact, rememberPediaContact } from "@/lib/pedia/buyer-session";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { InlineSpinner, PediaOrderSkeleton } from "@/components/storefront/Skeletons";
import { Check, Copy, QrCode } from "lucide-react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { detectPediaLink } from "@/lib/pedia/link";
import { parseExpiry } from "@/lib/expiry";
import { SITE, supportTelegramLink } from "@/lib/site";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { StatusPill } from "@/components/pedia/StatusWidgets";
import { GatewayPaymentPanel } from "@/components/storefront/GatewayPaymentPanel";
import { usePaymentConsent } from "@/hooks/usePaymentConsent";
import { normalizePaymentView, type PaymentView } from "@/lib/payment-ui";
import { formatCheckedTime, formatCount, isProcessingStatus, knownCount, pediaEstimate, pediaHeader, pediaPollMs, pediaProgress, stepThreeLabel } from "@/components/pedia/status-view";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";
import type { PediaServiceCopy } from "@/lib/pedia/service-copy";
import { localizePediaServiceCopy } from "@/lib/pedia/service-copy";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy, pediaServiceName } from "@/lib/pedia/copy";
import { isValidOrderContact, orderAccessHeaders, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";

type Status = {
  service_copy?: PediaServiceCopy | null;
  order_kind?: string; service_name?: string | null;
  product_slug?: string; code: string; product_name: string; tier_name: string; tier_note: string | null;
  quantity: number; target: string; status: string; done: number | null; percent: number | null;
  /** Dilaporkan layanan; null = belum diketahui (bukan 0). */
  start_count?: number | null; remains?: number | null; paid_at?: string | null;
  eta_start: string | null; eta_finish: string | null; refill_days: number;
  refill_eligible: boolean;
  refill?: Partial<PediaRefillState> | null;
  buyer_canceled?: boolean;
  qris: { payable_amount: number; unique_code?: number | null; image_url: string; expires_at: string; status: string } | null;
  /** Fase B: rail non-QRIS (view kanonis Market). */
  payment_method?: string;
  payment?: unknown;
};

// API mengirim URL absolut domain Market; CSP Pedia (img-src 'self') memblokirnya.
// Path QRIS identik di kedua host, jadi pakai same-origin.
const sameOriginQris = (url: string) => {
  try { const u = new URL(url, "https://x.invalid"); return u.pathname.startsWith("/api/payments/qris/") ? `${u.pathname}${u.search}` : url; } catch { return url; }
};

function QrisImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return (
    <div className="mx-auto mt-2 min-h-[224px] w-[224px] max-w-full rounded-xl bg-white p-2.5 sm:min-h-[240px] sm:w-[240px]">
      <div className="relative aspect-square w-full">
        {state !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#080C1E]/[0.04] text-[#080C1E]/60" role="status">
            {state === "loading" ? (
              <><InlineSpinner className="h-7 w-7" tone="dark" /><span className="text-xs font-medium">Memuat QRIS…</span></>
            ) : (
              <>
                <span className="text-xs font-semibold text-[#080C1E]/80">QRIS gagal dimuat</span>
                <button type="button" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }} className="h-9 rounded-xl bg-[#080C1E] px-4 text-xs font-bold text-white">Muat ulang QRIS</button>
              </>
            )}
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={url} src={url} alt={alt} onLoad={() => setState("ready")} onError={() => setState("error")} className={`h-full w-full rounded-xl object-contain transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`} />
      </div>
    </div>
  );
}

export default function PediaOrderStatusPage() {
  const { code } = useParams<{ code: string }>();
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  // Pesan galat dibekukan per bahasa agar useCallback `load` tidak dibuat ulang tiap render.
  const contactRequiredMsg = t.statusContactRequired;
  const loadFailedMsg = t.statusLoadFailed;
  const [contact, setContact] = useState("");
  const buyerContact = useRef("");
  const [needsContact, setNeedsContact] = useState(false);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refillMsg, setRefillMsg] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Kapan status terakhir terkonfirmasi server; gagal refresh tidak menghapus data lama.
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const request = useRef({ code: "", id: 0, active: false });
  const load = useCallback(async (manual = false, contactOverride = "") => {
    if (request.current.active && request.current.code === code) return;
    const id = request.current.id + 1;
    request.current = { code, id, active: true };
    setLoading(true);
    try {
      // Pedia: status/refill kontak saja, tanpa PIN. Kontak dari argumen,
      // memori tab, atau sesi pedia; tidak pernah baca PIN.
      const proof = (contactOverride || buyerContact.current || readOrderContact(code) || readPediaContact(code)).trim();
      if (proof && isValidOrderContact(proof)) {
        buyerContact.current = proof;
        setRefillContact(proof);
      }
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}${manual ? "?wake=1" : ""}`, { cache: "no-store", headers: { "x-order-contact": proof, ...orderAccessHeaders(code, proof) } });
      const d = await res.json();
      if (request.current.id !== id) return;
      if (res.status === 401 || res.status === 404) { setNeedsContact(true); throw new Error(d.error === "contact_required" ? contactRequiredMsg : d.error); }
      if (!res.ok) throw new Error(d.error ?? loadFailedMsg);
      setNeedsContact(false);
      if (rememberOrderContact(code, proof)) buyerContact.current = proof;
      setData(d.order);
      setCheckedAt(new Date());
      setError(null);
    } catch (e) {
      if (request.current.id === id) setError(e instanceof Error ? e.message : loadFailedMsg);
    } finally {
      if (request.current.id === id) {
        request.current.active = false;
        setLoading(false);
      }
    }
  }, [code, contactRequiredMsg, loadFailedMsg]);

  useEffect(() => { setData(null); setError(null); setCheckedAt(null); void load(); }, [load]);
  useEffect(() => {
    // awaiting 5s, berjalan 10s, needs_check 30s (admin bisa menyelesaikan); status akhir berhenti.
    // Tab tersembunyi dijeda dan dilanjutkan saat terlihat. Hanya membaca DB lewat API, tanpa fetch supplier.
    const interval = pediaPollMs(data?.status);
    if (interval === null) return;
    const tick = () => {
      if (document.hidden) return;
      void load();
    };
    const t = setInterval(tick, interval);
    const onVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisibility); };
  }, [load, data?.status]);

  const qrDeadline = data?.qris?.expires_at;
  const hasPayment = Boolean(data?.payment);
  useEffect(() => {
    if (data?.status !== "awaiting_payment" || (!qrDeadline && !hasPayment)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.status, qrDeadline, hasPayment]);

  const [refillOpen, setRefillOpen] = useState(false);
  const [refillContact, setRefillContact] = useState("");
  const [refillBusy, setRefillBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelContact, setCancelContact] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Harga tampil mengikuti preferensi Market (USD hanya tampilan; tagihan tetap QRIS/IDR).
  const display = useDisplayPrices([data?.qris ? Number(data.qris.payable_amount) : 0].filter((value) => Number.isFinite(value) && value > 0));
  const money = (value: number) => (display.currency === "USD" ? display.text(value) : formatRupiah(value));
  const cancelOrder = async () => {
    const contact = cancelContact.trim();
    if (cancelBusy) return;
    if (!isValidOrderContact(contact)) { setCancelError(t.statusCancelInvalidContact); return; }
    setCancelBusy(true); setCancelError(null);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}/cancel`, {
        method: "POST", headers: { "content-type": "application/json", ...orderAccessHeaders(code) },
        body: JSON.stringify({ contact }), cache: "no-store",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || t.statusCancelFailed);
      setConfirmingCancel(false); setCancelContact("");
      void load();
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : t.statusCancelFailed);
    } finally {
      setCancelBusy(false);
    }
  };
  const refill = async () => {
    const contact = refillContact.trim();
    if (!contact || refillBusy) return;
    setRefillBusy(true);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}/refill`, {
        method: "POST", headers: { "content-type": "application/json", ...orderAccessHeaders(code) },
        body: JSON.stringify({ contact }),
      });
      const d = await res.json();
      setRefillMsg(d.message ?? d.error ?? "");
      if (res.ok) { setRefillOpen(false); void load(); }
    } catch {
      setRefillMsg(t.statusRefillFailed);
    } finally {
      setRefillBusy(false);
    }
  };

  // Persetujuan biaya gateway (rute Market yang sama, satu klik → redirect).
  const consentHook = usePaymentConsent({
    code: typeof code === "string" ? code : "",
    locale,
    resolveContact: (input: string) => input.trim() || buyerContact.current || refillContact,
    refresh: () => load(true),
    onAccepted: (contact: string) => { buyerContact.current = contact; rememberPediaContact(String(code ?? ""), contact); },
  });

  if (needsContact && !data) return <form className="mx-auto max-w-md space-y-4 px-4 py-10" onSubmit={(e) => { e.preventDefault(); if (!isValidOrderContact(contact)) return; rememberPediaContact(code, contact.trim()); rememberOrderContact(code, contact.trim()); void load(false, contact.trim()); }}>
    <h1 className="font-display text-2xl font-semibold text-white">{t.statusViewOrder}</h1>
    <label className="block text-sm text-white/75" htmlFor="pedia-order-contact">{t.statusRefillContact}</label>
    <p className="text-xs leading-5 text-white/60">{t.trackContactHint}</p>
    <input id="pedia-order-contact" value={contact} onChange={e => setContact(e.target.value)} required maxLength={254} autoComplete="off" placeholder={t.statusRefillContactPlaceholder} className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white" />
    {error && <p role="alert" className="text-sm text-white/60">{error}</p>}
    <button disabled={loading} className="rounded-full bg-[#00E5FF] px-5 py-3 font-semibold text-[#070a1e]">{loading ? t.statusCheckingContact : t.statusViewOrder}</button>
  </form>;
  if (error && !data) return <p className="pt-10 text-center text-sm text-red-300">{error}</p>;
  if (!data) return <PediaOrderSkeleton label={t.statusLoadingOrder} />;

  const qrExpired = data.qris && (["expired", "failed"].includes(data.qris.status) || (parseExpiry(data.qris.expires_at) ?? 0) <= now);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* Kode tetap bisa disalin dari teks. */ }
  };

  const pending = data.status === "awaiting_payment";
  const expired = data.status === "expired";
  const paid = !pending && !expired;
  const complete = data.status === "completed";
  const terminal = ["completed", "partial", "canceled", "expired"].includes(data.status);
  const processing = isProcessingStatus(data.status);
  const progress = pediaProgress({ status: data.status, quantity: data.quantity, done: data.done, percent: data.percent });
  const startCount = knownCount(data.start_count);
  const remains = knownCount(data.remains);
  const header = pediaHeader(data.status, locale);
  const estimate = pediaEstimate({ status: data.status, eta_start: data.eta_start, eta_finish: data.eta_finish }, locale);
  const paidAtLabel = data.paid_at ? formatWibDateTime(data.paid_at, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const seconds = Math.max(0, Math.ceil(((parseExpiry(data.qris?.expires_at ?? "") ?? 0) - now) / 1000));
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const platform = detectPediaLink(data.target)?.platform;
  const timeline = [
    { label: locale === "en" ? "Order created" : "Pesanan dibuat", done: true, active: pending },
    { label: locale === "en" ? "Payment received" : "Pembayaran diterima", done: paid, active: paid && !processing && !terminal },
    { label: stepThreeLabel(data.status, locale), done: processing, active: processing && !terminal },
    { label: data.status === "partial" ? (locale === "en" ? "Partially completed" : "Selesai sebagian") : data.status === "canceled" ? (locale === "en" ? "Canceled" : "Dibatalkan") : locale === "en" ? "Completed" : "Selesai", done: terminal && !expired, active: false },
  ];
  const localizedCopy = localizePediaServiceCopy(data.service_copy, locale);
  const productName = localizedCopy?.product_name ?? pediaServiceName(data.product_name, locale);
  const serviceName = localizedCopy?.service_name ?? pediaServiceName(data.service_name ?? data.tier_note ?? data.tier_name, locale);
  const copyDescriptions = localizedCopy?.description;
  const copyTerms = localizedCopy?.terms;
  const payableAmount = data.qris ? Number(data.qris.payable_amount) : null;
  const paymentView: PaymentView | null = normalizePaymentView(data.payment);
  const compactPayment = pending && (Boolean(data.qris) || paymentView !== null);
  const paymentTitle = paymentView
    ? (paymentView.kind === "crypto" ? t.statusPaymentCrypto : fill(t.statusPaymentGateway, { label: paymentView.label }))
    : t.statusPaymentTitle;
  // Batal mandiri hanya saat pembayaran belum berjalan pasti (crypto confirming/manual review dikunci).
  const cancelAllowed = !paymentView || ["initializing", "fee_consent_required", "pending"].includes(paymentView.state);
  const isCancelled = data.status === "canceled" || data.buyer_canceled === true;
  const pollSeconds = (pediaPollMs(data.status) ?? 10_000) / 1000;
  const statusVisual = isCancelled
    ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
    : data.status === "needs_check"
      ? { icon: "/icons/ios11/clock-96.png", shell: "bg-violet-400/15", filter: "brightness(0) invert(1) opacity(.8)" }
      : data.status === "partial"
        ? { icon: "/icons/ios11/clock-96.png", shell: "bg-[#FFB800]/15", filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" }
        : paid
          ? { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
          : { icon: "/icons/ios11/clock-96.png", shell: expired ? "bg-white/10" : "bg-[#FFB800]/15", filter: expired ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };
  const isPendingQris = compactPayment && !qrExpired;
  const summaryContent = <>
    <dl className="space-y-2">
      <div className="flex justify-between gap-3 text-[13px] leading-5"><dt className="shrink-0 text-white/70">{t.statusService}</dt><dd className="min-w-0 break-words text-right font-medium text-white">{productName} · {serviceName}</dd></div>
      <div className="flex justify-between gap-3 text-[13px] leading-5"><dt className="shrink-0 text-white/70">{t.statusQtyOrdered}</dt><dd className="font-medium text-white">{formatCount(data.quantity, locale)}</dd></div>
      <div className="flex justify-between gap-3 text-[13px] leading-5"><dt className="shrink-0 text-white/70">{t.statusTarget}</dt><dd className="min-w-0 break-all text-right font-medium text-white">{data.target}</dd></div>
      {data.refill_days > 0 && <div className="flex justify-between gap-3 text-[13px] leading-5"><dt className="shrink-0 text-white/70">{t.statusRefill}</dt><dd className="font-medium text-white">{refillLabel(data.refill_days)}</dd></div>}
    </dl>
    {payableAmount !== null && <div className="mt-3 flex justify-between gap-3 border-t border-white/10 pt-3"><span className="text-sm text-white/60">{t.statusTotalQris}</span><span className="shrink-0 font-bold text-white">{money(payableAmount)}</span></div>}
  </>;
  const copyBlocks = ([[t.statusServiceDescription, copyDescriptions], [t.statusServiceTerms, copyTerms]] as const).filter(([, text]) => text);
  const title = isCancelled ? t.statusTitleCanceled : expired ? t.statusTitleExpired : paid ? header.title : t.statusTitleQrisPending;
  const codeButton = (cls: string) => <button type="button" onClick={() => void copy(data.code)} aria-label={t.statusCopyCode} className={cls}><span className="break-all">{data.code}</span>{copied ? <Check size={11} aria-hidden="true" className="ml-1 inline" /> : <Copy size={11} aria-hidden="true" className="ml-1 inline opacity-70" />}</button>;
  const linkClass = "flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl";
  return (
    <div className={`mx-auto px-4 sm:px-6 ${compactPayment ? "max-w-[760px] py-4 sm:py-6" : "max-w-[640px] py-10"}`}>
      <section aria-label={t.statusAria} className={`ax-glass-card text-center ${compactPayment ? "rounded-2xl p-4 sm:p-5" : "rounded-[28px] p-6 sm:p-8"}`}>
        {compactPayment ? (
          <div className="grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2 text-center sm:grid-cols-[40px_auto_40px] sm:justify-center sm:gap-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${statusVisual.shell}`}>
              <span className={isPendingQris ? "animate-[spin_3s_linear_infinite]" : undefined} role={isPendingQris ? "status" : undefined} aria-label={isPendingQris ? t.statusPendingSpin : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={statusVisual.icon} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <h1 className="font-display text-base font-bold leading-6 text-white sm:text-lg">{paymentTitle}</h1>
                {qrExpired && <span className="rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">{t.statusQrisInactive}</span>}
              </div>
              <div className="mt-1">{codeButton("font-mono text-[11px] font-semibold tracking-[0.04em] text-[#00E5FF]")}</div>
            </div>
          </div>
        ) : <>
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${statusVisual.shell}`}>
            <span className={pending ? "animate-[spin_3s_linear_infinite]" : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={statusVisual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
            </span>
          </div>
          <h1 className="mt-4 font-display text-2xl font-bold text-white">{title}</h1>
          <div className="mt-2">{codeButton("font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]")}</div>
          {isCancelled ? <div className="mt-3"><span className="inline-flex rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">{t.statusCanceledPill}</span>{paid && !data.buyer_canceled && paidAtLabel && <p className="mt-1.5 text-[11px] text-white/50">{fill(t.statusPaidAt, { time: paidAtLabel })}</p>}</div>
            : paid ? <div role="status" aria-live="polite" className="mt-3"><StatusPill status={data.status} locale={locale} />{paidAtLabel && <p className="mt-1.5 text-[11px] text-white/50">{fill(t.statusPaidAt, { time: paidAtLabel })}</p>}</div>
            : expired ? <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/50">{t.statusExpiredPill}</span>
            : <span className="mt-3 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/15 px-3 py-1.5 text-xs font-semibold text-[#FFB800]">{t.statusPendingPill}</span>}
          {(expired || data.buyer_canceled === true || (paid && !isCancelled && (header.lead || complete)) || (pending && !data.qris && !paymentView)) && <p className="mt-4 text-sm leading-6 text-white/60">
            {data.buyer_canceled ? t.statusCanceledNote : expired ? t.statusExpiredNote
              : complete ? fill(t.statusCompleteNote, { service: productName })
              : paid ? header.lead
              : t.statusQrisMissingNote}
          </p>}
        </>}

        {compactPayment && data.qris && (
          <section className="mt-3 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 sm:p-4" aria-label={t.statusQrisAria}>
            {qrExpired ? (
              <div className="py-2">
                <p className="font-display text-base font-bold text-white">{t.statusQrisExpiredTitle}</p>
                <p className="mx-auto mt-2 max-w-[360px] text-xs leading-relaxed text-white/55">{t.statusQrisExpiredNote}</p>
              </div>
            ) : (
              <div className="grid items-center gap-3 sm:grid-cols-[240px_minmax(0,1fr)] sm:gap-5">
                <div className="min-w-0 sm:h-[290px]">
                  <p className="text-xs font-semibold text-white/80">{t.statusScan}</p>
                  <QrisImage key={`${data.qris.image_url}|${data.qris.expires_at}`} src={sameOriginQris(data.qris.image_url)} alt={t.statusQrisAlt} />
                  <div className="mt-2 flex items-center justify-center gap-1.5" aria-label={t.statusNationalStandard}>
                    <img src="/brand/qris.svg" alt={t.statusQrisLogo} width={48} height={18} className="h-[18px] w-auto object-contain" draggable={false} />
                    <span className="text-[9px] text-white/55">{t.statusNationalStandard}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <span className="mb-2 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">{t.statusWaitingPay}</span>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{t.statusTotalPay}</p>
                  <p className="font-display text-2xl font-bold leading-8 text-white">{money(Number(data.qris.payable_amount))}</p>
                  {(data.qris.unique_code ?? 0) > 0 && <p className="text-[11px] text-white/50">{fill(t.statusUniqueCode, { code: "" }).replace(/\s*$/, "")} <span className="font-mono text-[#00E5FF]">+{data.qris.unique_code}</span></p>}
                  <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-[#FFB800]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFB800]" /><span>{fill(t.statusValidFor, { time: "" }).trim()} <span aria-label={t.statusTimeLeftAria}>{countdown}</span></span></div>
                  <p className="mt-1 text-[11px] text-white/50">{t.statusPayExactly}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a href={sameOriginQris(data.qris.image_url)} download={`AXVARA-${data.code}-QRIS.png`} className="inline-flex h-11 min-w-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/15 px-2 text-xs font-semibold text-white/75 hover:bg-white/10">{t.statusSaveQris}</a>
                    <button type="button" disabled={loading} onClick={() => void load(true)} className="inline-flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-2 text-xs font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:opacity-50">{loading && <InlineSpinner />}{loading ? t.statusChecking : t.statusCheckPayment}</button>
                  </div>
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] leading-4 text-white/50" aria-live="polite"><InlineSpinner className="h-3 w-3 shrink-0" /><span>{t.statusAutoCheck}</span></p>
                </div>
              </div>
            )}
          </section>
        )}

        {paymentView && pending && (
          <div className="mt-3 text-left">
            <GatewayPaymentPanel
              payment={paymentView}
              locale={locale}
              now={now}
              checking={loading}
              onCheck={() => void load(true)}
              contactKnown={Boolean(buyerContact.current || refillContact)}
              consent={{ busy: consentHook.busy, error: consentHook.error, stale: consentHook.stale, onApprove: (total, contact) => void consentHook.approve(total, contact) }}
            />
          </div>
        )}

        {error && <div role="alert" className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">{fill(t.statusError, { error })}</div>}

        {compactPayment ? (
          <div className="mt-3 text-left"><MobileCollapsible title={t.statusSummary} meta={t.statusSummaryMeta}>{summaryContent}</MobileCollapsible></div>
        ) : <div className="ax-glass-card mt-6 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.statusSummary}</p>
          <div className="mt-3">{summaryContent}</div>
        </div>}

        {paid && <div className="ax-glass-card mt-4 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.statusProgress}</p>
        <ol className="mt-4" aria-label={t.statusTimelineAria}>
          {timeline.map((step, i) => <li key={i} aria-current={step.active ? "step" : undefined} className="relative flex gap-4 pb-7 last:pb-0">
            {i < 3 && <span aria-hidden="true" className={`absolute bottom-0 left-[13px] top-7 w-px ${timeline[i + 1].done ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
            <span aria-hidden="true" className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${step.done ? "border-[#00E5FF] bg-[#0F273C] text-[#00E5FF]" : "border-white/15 bg-[#0F1430] text-white/45"} ${step.active ? "ring-4 ring-[#00E5FF]/15" : ""}`}>{step.done && !step.active ? <Check size={14} /> : i + 1}</span>
            <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${step.done ? "text-white" : "text-white/45"}`}>{step.label}</p>
              {i === 0 && <p className="mt-1 text-xs leading-5 text-white/50">{t.statusCodeHint}</p>}
              {i === 1 && pending && <p className="mt-1 text-xs leading-5 text-white/50">{t.statusAutoDetect}</p>}
              {i === 2 && processing && (progress.done === null
                ? <p className="mt-2 font-mono text-xs text-white/55">{t.statusQtyUnknown}</p>
                : <div className="mt-3"><div role="progressbar" aria-label={t.statusProgress} aria-valuenow={Math.round(progress.percent ?? 0)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#00E5FF] transition-[width] motion-reduce:transition-none" style={{ width: `${progress.percent ?? 0}%` }} /></div><p className="mt-2 font-mono text-xs text-white/55">{fill(t.statusEntered, { done: formatCount(progress.done, locale), total: formatCount(data.quantity, locale) })}</p></div>)}
              {i === 3 && complete && <p className="mt-1 text-xs leading-5 text-emerald-300">{t.statusCompletedNote}</p>}
            </div>
          </li>)}
        </ol>
          <dl aria-label={t.statusQtyAria} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([[t.statusStartCount, startCount], [t.statusOrdered, data.quantity], [t.statusRemaining, remains], [t.statusEnteredShort, progress.done]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <dt className="text-[10px] uppercase tracking-[0.08em] text-white/50">{label}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-white">{value === null ? <span className="text-xs font-normal text-white/50">{t.statusNotReported}</span> : formatCount(value, locale)}</dd>
            </div>)}
          </dl>
          {estimate && <p className="mt-4 text-xs leading-5 text-white/55">{estimate}</p>}
          {!terminal && checkedAt && <p className="mt-3 text-[11px] text-white/35">{fill(t.statusUpdated, { time: formatCheckedTime(checkedAt), seconds: pollSeconds })}{error ? t.statusUpdatedFailed : ""}</p>}
        </div>}
        <div className="text-left">
          {(data.status === "partial" || data.status === "canceled") && (
            <div className="mt-4 rounded-2xl border border-[#FFB800]/40 bg-[#FFB800]/5 p-4 text-sm text-white/80">
              <p>{data.status === "partial" ? t.statusPartialNote : t.statusCanceledPartialNote}</p>
              <a className="mt-3 inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 font-semibold" href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(fill(t.statusHelpPartial, { code: data.code }))}`}>{t.statusContactAdmin}</a>
            </div>
          )}
          {data.status === "needs_check" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
              {t.statusNeedsCheck}
            </div>
          )}
        </div>
        {paid && copyBlocks.length > 0 && <div className="mt-3 space-y-2 text-left">{copyBlocks.map(([label, text]) => <MobileCollapsible key={label} title={label}><p className="whitespace-pre-line break-words text-[13px] leading-6 text-white/70">{text}</p></MobileCollapsible>)}</div>}
          {paid && data.refill_days > 0 && (() => {
            // Satu blok refill: status + satu CTA; panduan /pedia/refill memakai backend yang sama.
            const r = data.refill;
            const reason = r?.reason ?? (data.refill_eligible ? null : data.status === "completed" ? "expired" : "not_completed");
            const when = (iso?: string | null) => iso ? `${formatWibDateTime(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} WIB` : null;
            const statusText = (r?.status ? refillStatusLabel(r.status, locale) : null) ?? r?.status_label;
            const note = reason === null ? (r?.ends_at ? fill(t.statusRefillApplyAt, { when: when(r.ends_at) ?? "" }) : t.statusRefillApplyNow)
              : reason === "not_completed" ? t.statusRefillAfterComplete
              : reason === "cooldown" ? (r?.next_at ? fill(t.statusRefillCooldown, { when: when(r.next_at) ?? "" }) : t.statusRefillCooldownDefault)
              : reason === "in_progress" ? `${statusText ?? t.statusRefillTitle}.`
              : reason === "expired" ? (r?.ends_at ? fill(t.statusRefillExpiredAt, { when: when(r.ends_at) ?? "" }) : t.statusRefillExpired)
              : refillReasonText(reason, locale);
            return <section aria-label={t.statusRefillTitle} className="ax-glass-card mt-4 rounded-2xl p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.statusRefillTitle}</p>
              <p className="mt-2 text-sm font-semibold text-white">{refillLabel(data.refill_days)} <span className="font-normal text-white/70">· {note}</span></p>
              <p className="mt-1 text-xs leading-5 text-white/55">{refillPromise(data.refill_days, undefined, locale)}{r?.mode === "manual" ? ` ${t.refillModeManual}` : r?.mode === "api" ? ` ${t.refillModeAuto}` : ""}</p>
              {statusText && reason !== "in_progress" && <p className="mt-1 text-xs text-white/55">{fill(t.statusRefillLast, { label: statusText })}</p>}
              {!refillOpen && reason !== "expired" && reason !== "in_progress" && <button type="button" onClick={() => setRefillOpen(true)} disabled={!data.refill_eligible} className="mt-3 min-h-11 w-full rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-sm font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:cursor-not-allowed disabled:opacity-45">{t.statusRefillOpen}</button>}
              {reason === "no_supplier_order" && <a href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(fill(t.statusHelpRefill, { code: data.code }))}`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-[#00E5FF] underline underline-offset-4">{t.statusRefillAskAdmin}</a>}
              {data.refill_eligible && refillOpen && (
                <div className="mt-3 rounded-[14px] border border-white/12 bg-white/[0.04] p-4" role="dialog" aria-label={t.statusRefillVerify}>
                  <label htmlFor="refill-contact" className="text-xs font-medium text-white/60">{t.statusRefillContact}</label>
                  <input
                    id="refill-contact"
                    value={refillContact}
                    onChange={(e) => setRefillContact(e.target.value)}
                    placeholder={t.statusRefillContactPlaceholder}
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3.5 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/50 focus:outline-none"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setRefillOpen(false)} disabled={refillBusy} className="h-10 rounded-xl border border-white/12 text-sm font-semibold text-white/70 disabled:opacity-50">{t.statusRefillCancel}</button>
                    <button type="button" onClick={() => void refill()} disabled={refillBusy || refillContact.trim().length < 6} className="h-10 rounded-xl bg-[#00E5FF] text-sm font-bold text-[#070a1e] disabled:opacity-50">{refillBusy ? t.statusRefillSending : t.statusRefillSubmit}</button>
                  </div>
                </div>
              )}
              {refillMsg && <p role="status" className="mt-2 text-[13px] text-white/70">{refillMsg}</p>}
              <p className="mt-2 text-[12px] leading-5 text-white/55"><a href={`/pedia/refill?code=${encodeURIComponent(code ?? "")}`} className="font-semibold text-[#00E5FF] underline underline-offset-2">{t.statusRefillGuide}</a></p>
            </section>;
          })()}
        {compactPayment ? (
          <div className="mt-3 text-left">
            {!confirmingCancel ? (
              <div className="grid grid-cols-2 gap-2.5">
                <a href="/pedia" className={`${linkClass} border border-white/10 bg-white/[0.03] px-2 text-[11px] font-medium text-white/60 transition hover:bg-white/[0.06] sm:text-xs`}>{t.statusContinueShopping}</a>
                {cancelAllowed
                  ? <button type="button" onClick={() => { setConfirmingCancel(true); setCancelError(null); setCancelContact((c) => c || buyerContact.current); }} className={`${linkClass} border border-red-400/15 bg-red-500/[0.04] px-2 text-[11px] font-medium text-red-200/80 transition hover:bg-red-500/[0.08] sm:text-xs`}>{t.statusCancelOrder}</button>
                  : <span className={`${linkClass} border border-white/10 px-2 text-[11px] font-medium text-white/35 sm:text-xs`}>{t.statusCancelOrder}</span>}
              </div>
            ) : (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.06] p-4" role="dialog" aria-label={t.statusCancelDialog}>
                <p className="text-sm font-semibold text-red-200">{fill(t.statusCancelConfirmTitle, { code: data.code })}</p>
                <p className="mt-1 text-xs leading-5 text-white/55">{t.statusCancelConfirmNote}</p>
                <label htmlFor="cancel-contact" className="mt-3 block text-xs font-medium text-white/60">{t.statusRefillContact}</label>
                <input id="cancel-contact" value={cancelContact} onChange={(e) => setCancelContact(e.target.value)} placeholder={t.statusRefillContactPlaceholder} autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/55 focus:border-red-400/40 focus:outline-none md:text-sm" />
                {cancelError && <p role="alert" className="mt-2 text-xs text-red-300">{cancelError}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <button type="button" onClick={() => { setConfirmingCancel(false); setCancelError(null); }} disabled={cancelBusy} className="flex h-10 items-center justify-center rounded-xl border border-white/10 px-3 text-sm font-semibold text-white/60 transition hover:bg-white/5 disabled:opacity-50">{t.statusCancelBack}</button>
                  <button type="button" onClick={() => void cancelOrder()} disabled={cancelBusy} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-500 px-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-50">{cancelBusy && <InlineSpinner />}{cancelBusy ? t.statusCanceling : t.statusCancelYes}</button>
                </div>
              </div>
            )}
          </div>
        ) : <div className="mt-6 grid grid-cols-2 gap-2.5">
          <a href="/pedia/lacak" className={`ax-glass-card ${linkClass} px-3 text-sm font-semibold text-white hover:bg-white/10`}>{t.statusTrack}</a>
          {terminal && data.product_slug ? <a href={`/pedia/o/${encodeURIComponent(data.product_slug)}`} className={`ax-glass-card ${linkClass} px-3 text-sm font-semibold text-white hover:bg-white/10`}>{t.statusOrderAgain}</a> : <a href="/pedia" className={`ax-glass-card ${linkClass} px-3 text-sm font-semibold text-white hover:bg-white/10`}>{t.statusContinueShopping}</a>}
        </div>}
        <div className={compactPayment ? "mt-4 border-t border-white/10 pt-3" : "mt-3"}>
          <p className="text-center text-[11px] text-white/35">{t.statusNeedHelp}</p>
          <div className={compactPayment ? "mt-2 flex items-center justify-center gap-3" : "mt-2 grid grid-cols-2 gap-2.5"}>
            <a href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(fill(t.statusHelpOrder, { code: data.code }))}`} className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#25D366]/40 hover:bg-white/[0.06]"><img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>WA Admin</span></a>
            <a href={supportTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-[13px] font-medium text-white/80 transition hover:border-[#2AABEE]/40 hover:bg-white/[0.06]"><img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /><span>Telegram</span></a>
          </div>
        </div>
        <p className={`${compactPayment ? "mt-1 text-[10px] leading-4" : "mt-4 text-[11px] leading-5"} text-center text-white/35`}> {t.statusFooter.split("{link}")[0]}<a href="/pedia/ketentuan" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">{t.statusFooterLink}</a>{t.statusFooter.split("{link}")[1]}</p>
      </section>
    </div>
  );
}
