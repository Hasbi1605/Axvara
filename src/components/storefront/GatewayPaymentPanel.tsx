"use client";

import { useEffect, useRef, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { parseExpiry } from "@/lib/expiry";
import { InlineSpinner } from "@/components/storefront/Skeletons";
import { orderPanelCopy, usdFor, type CryptoView, type GatewayView, type PayLocale, type PaymentView } from "@/lib/payment-ui";

/**
 * Panel pembayaran non-QRIS di halaman pesanan (gateway + crypto). Hanya
 * menampilkan data dari `order.payment` (tampilan aman server); tautan, VA,
 * alamat dan tombol muncul HANYA pada tahap yang mengizinkannya. Tahap
 * terminal/pemeriksaan (expired, failed, manual_review, paid) tidak
 * merender detail apa pun. Persetujuan biaya memakai kontak checkout lewat
 * rute server yang ada; tidak ada PIN, tidak ada kontak di URL.
 *
 * Hierarki tahap pending mengikuti blok QRIS: chip "Menunggu bayar", label
 * total + nominal besar, hitung mundur, aksi utama, cek pembayaran, lalu baris
 * status otomatis. Crypto memakai dua kolom (QR + rincian) seperti QRIS.
 */
type Props = {
  payment: PaymentView;
  locale: PayLocale;
  now: number;
  checking: boolean;
  onCheck: () => void;
  /** Kontak checkout sudah tersimpan di tab ini (kalau tidak, panel meminta). */
  contactKnown: boolean;
  consent: { busy: boolean; error: string | null; stale: boolean; onApprove: (expectedTotal: number, contact: string) => void };
};

const BTN = "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:opacity-50";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]";

function useCopy() {
  const [status, setStatus] = useState<{ key: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (key: string, value: string) => {
    let ok = false;
    try { await navigator.clipboard.writeText(value); ok = true; } catch { ok = false; }
    setStatus({ key, ok });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 3_000);
  };
  return { status, copy };
}

/** QR alamat tujuan (SVG lokal via `qrcode`, tanpa layanan luar). Gagal/belum siap = tanpa QR; alamat tetap bisa disalin. */
function useAddressQr(address: string): string | null {
  const [qr, setQr] = useState<{ address: string; src: string } | null>(null);
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void import("qrcode")
      .then((mod) => mod.toString(address, { type: "svg", margin: 1, errorCorrectionLevel: "M" }))
      .then((svg) => { if (!cancelled) setQr({ address, src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` }); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [address]);
  return qr && qr.address === address ? qr.src : null;
}

function timeLeft(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.floor(((parseExpiry(expiresAt) ?? now) - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function clock(expiresAt: string) {
  const parsed = parseExpiry(expiresAt);
  if (parsed === null) return null;
  return `${new Date(parsed).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" })} WIB`;
}

function CheckButton({ checking, onCheck, c, compact }: { checking: boolean; onCheck: () => void; c: ReturnType<typeof orderPanelCopy>; compact?: boolean }) {
  return (
    <button type="button" onClick={onCheck} disabled={checking} className={`${BTN} border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 ${compact ? "min-w-0 whitespace-nowrap px-2 text-xs" : ""} ${FOCUS}`}>
      {checking && <InlineSpinner />}{checking ? c.checking : c.check}
    </button>
  );
}

function Deadline({ expiresAt, now, c }: { expiresAt: string | null; now: number; c: ReturnType<typeof orderPanelCopy> }) {
  if (!expiresAt) return null;
  const at = clock(expiresAt);
  if (!at) return null;
  return <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#FFB800]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#FFB800]" />{c.payBefore(at)} · {timeLeft(expiresAt, now)}</p>;
}

/** Hitung mundur tahap pending: titik gold berdenyut + "Berlaku mm:ss · sebelum HH.MM WIB". */
function PendingCountdown({ expiresAt, now, c, align = "center" }: { expiresAt: string | null; now: number; c: ReturnType<typeof orderPanelCopy>; align?: "center" | "start" }) {
  if (!expiresAt) return null;
  const left = timeLeft(expiresAt, now);
  const at = clock(expiresAt);
  return (
    <p className={`mt-1 flex items-center gap-1.5 text-[11px] text-[#FFB800] ${align === "start" ? "justify-center sm:justify-start" : "justify-center"}`}>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#FFB800]" />
      {at ? c.expiresIn(left, at) : left}
    </p>
  );
}

/** Baris status otomatis (spinner) yang sama untuk gateway dan crypto. */
function AutoStatus({ c }: { c: ReturnType<typeof orderPanelCopy> }) {
  return (
    <p role="status" aria-live="polite" className="mt-2 flex items-start justify-center gap-1.5 text-[10px] leading-4 text-white/50">
      <InlineSpinner className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{c.autoStatus}</span>
    </p>
  );
}

function LockedNote({ c }: { c: ReturnType<typeof orderPanelCopy> }) {
  return <p className="mt-3 border-t border-white/10 pt-3 text-[10px] leading-4 text-white/40">{c.locked}</p>;
}

const CARD = "mt-3 w-full rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 sm:p-4";
const CHIP = "inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]";

function GatewayPanel({ view, locale, now, checking, onCheck, contactKnown, consent }: Omit<Props, "payment"> & { view: GatewayView }) {
  const c = orderPanelCopy(locale);
  const { status, copy } = useCopy();
  const [contact, setContact] = useState("");
  const link = view.paymentLink ?? view.checkoutUrl;

  if (view.state === "initializing") {
    return <section aria-label={c.h1.preparing} className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left"><CheckButton checking={checking} onCheck={onCheck} c={c} /></section>;
  }

  if (view.state === "fee_consent_required") {
    const total = view.total;
    return (
      <section aria-label={c.gateway.consentTitle} className="mt-4 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 text-left">
        <p className="text-sm font-semibold text-white">{c.gateway.consentTitle}</p>
        {consent.stale && <p role="status" className="mt-3 rounded-lg border border-[#FFB800]/25 bg-[#FFB800]/10 px-3 py-2 text-xs text-[#FFD66B]">{c.gateway.stale}</p>}
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-white/60">{c.subtotal}</dt><dd className="tabular-nums text-white">{formatRupiah(view.subtotal)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-white/60">{view.fee !== null ? c.feeFor(view.label) : c.estFee}</dt><dd className="tabular-nums text-white">{view.fee !== null ? formatRupiah(view.fee) : view.estimatedFee !== null ? formatRupiah(view.estimatedFee) : "—"}</dd></div>
          <div className="flex justify-between gap-3 border-t border-white/10 pt-2"><dt className="font-semibold text-white">{c.finalTotal}</dt><dd className="font-display text-xl font-bold tabular-nums text-white">{total !== null ? formatRupiah(total) : "—"}</dd></div>
        </dl>
        <Deadline expiresAt={view.expiresAt} now={now} c={c} />
        {total === null ? (
          <div className="mt-3"><p role="status" className="mb-2 text-xs text-amber-200">{c.gateway.totalUnavailable}</p><CheckButton checking={checking} onCheck={onCheck} c={c} /></div>
        ) : (
          <form className="mt-4" onSubmit={(event) => { event.preventDefault(); consent.onApprove(total, contact); }}>
            {!contactKnown && (
              <div className="mb-3">
                <label htmlFor="consent-contact" className="block text-xs font-medium text-white/70">{c.gateway.contactLabel}</label>
                <input id="consent-contact" value={contact} onChange={(event) => setContact(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="0812… / nama@email.com" aria-describedby="consent-contact-help" className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-[#00E5FF]/50" />
                <p id="consent-contact-help" className="mt-1 text-[11px] text-white/45">{c.gateway.contactHelp}</p>
              </div>
            )}
            {consent.error && <p role="alert" className="mb-2 text-xs text-red-300">{consent.error}</p>}
            <button type="submit" disabled={consent.busy} className={`${BTN} w-full bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] ${FOCUS}`}>
              {consent.busy && <InlineSpinner tone="dark" />}{consent.busy ? c.gateway.approving : c.gateway.approve(formatRupiah(total))}
            </button>
          </form>
        )}
      </section>
    );
  }

  if (view.state === "pending") {
    return (
      <section aria-label={c.h1.pendingGateway} className={`${CARD} text-center`}>
        <span className={CHIP}>{c.awaitingPay}</span>
        <p className="mt-2 break-words text-sm font-semibold text-white">{view.label}</p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.totalPay}</p>
        <p className="font-display text-2xl font-bold leading-8 tabular-nums text-white">{formatRupiah(view.total ?? view.subtotal)}</p>
        {view.fee !== null && view.fee > 0 && <p className="text-[11px] text-white/50">{c.subtotal} {formatRupiah(view.subtotal)} · {c.fee} {formatRupiah(view.fee)}</p>}
        <PendingCountdown expiresAt={view.expiresAt} now={now} c={c} />
        {view.virtualAccount && (
          <div className="mt-3 text-left">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{c.gateway.virtualAccount}</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-sm text-white">{view.virtualAccount}</code>
              <button type="button" onClick={() => void copy("va", view.virtualAccount as string)} className={`${BTN} border border-white/15 text-white/80 hover:bg-white/10 ${FOCUS}`}>{c.gateway.copy}</button>
            </div>
            <p role="status" aria-live="polite" className="mt-1 min-h-4 text-[11px] text-white/60">{status?.key === "va" ? (status.ok ? c.gateway.copied : c.gateway.copyFailed) : ""}</p>
          </div>
        )}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className={`${BTN} mt-3 h-12 w-full bg-[#00E5FF] text-[#080C1E] hover:bg-[#00D0E8] ${FOCUS}`}>
            {c.gateway.openLink(view.label)} <span aria-hidden>↗</span>
          </a>
        ) : !view.virtualAccount ? (
          <p role="status" className="mt-3 text-xs text-amber-200">{c.gateway.noLink}</p>
        ) : null}
        <button type="button" onClick={onCheck} disabled={checking} className={`${BTN} mt-2 w-full border border-white/15 text-white/80 hover:bg-white/10 ${FOCUS}`}>
          {checking && <InlineSpinner />}{checking ? c.checking : c.check}
        </button>
        <AutoStatus c={c} />
        <LockedNote c={c} />
      </section>
    );
  }
  return null;
}

function CryptoPanel({ view, locale, now, checking, onCheck }: Omit<Props, "payment" | "contactKnown" | "consent"> & { view: CryptoView }) {
  const c = orderPanelCopy(locale);
  const { status, copy } = useCopy();
  const pendingAddress = view.state === "pending" ? view.payAddress : "";
  const qrSrc = useAddressQr(pendingAddress);
  if (view.state === "preparing") {
    return <section aria-label={c.h1.preparing} className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-left"><CheckButton checking={checking} onCheck={onCheck} c={c} /></section>;
  }
  if (view.state === "confirming") {
    return (
      <section aria-label={c.h1.confirming} className="mt-4 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 text-left">
        <CheckButton checking={checking} onCheck={onCheck} c={c} />
      </section>
    );
  }
  if (view.state !== "pending") return null;
  const symbol = view.symbol || view.payCurrency.toUpperCase();
  const networkLabel = view.networkLabel || (view.network ? view.network.toUpperCase() : "—");
  const missing = !view.payAddress || !view.payAmountText;
  const usdText = view.usdText ? usdFor(view.usdText, locale) : "";
  const breakdown = view.baseText && view.surchargeText && view.surchargeBps !== null
    ? c.crypto.approxWithFee(usdText, view.surchargeBps)
    : usdText ? c.crypto.approx(usdText) : "";
  if (missing) {
    return (
      <section aria-label={c.h1.pendingCrypto} className={`${CARD} text-center`}>
        <span className={CHIP}>{c.awaitingPay}</span>
        <p role="status" className="mt-3 text-xs text-amber-200">{c.lead.preparing}</p>
        <PendingCountdown expiresAt={view.expiresAt} now={now} c={c} />
        <div className="mt-3"><CheckButton checking={checking} onCheck={onCheck} c={c} /></div>
        <AutoStatus c={c} />
        <LockedNote c={c} />
      </section>
    );
  }
  return (
    <section aria-label={c.h1.pendingCrypto} className={`${CARD} text-left`}>
      <div className="grid items-start gap-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-5">
        <div className="flex flex-col items-center">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{c.crypto.scanAddress}</p>
          <div className="mt-2 h-[180px] w-[180px] rounded-xl bg-white p-2 sm:h-[200px] sm:w-[200px]">
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrSrc} alt={c.crypto.qrAlt} width={200} height={200} data-testid="crypto-qr" className="h-full w-full rounded-lg object-contain" draggable={false} />
            ) : (
              <div aria-hidden className="ax-skeleton h-full w-full rounded-lg" />
            )}
          </div>
          <span data-testid="crypto-network" className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#FFB800]/30 bg-[#FFB800]/10 px-2 py-0.5 text-[11px] font-semibold text-[#FFB800]">
            {view.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logo} alt="" aria-hidden width={16} height={16} className="h-4 w-4 shrink-0 rounded-full object-contain" draggable={false} />
            )}
            <span className="break-all">{symbol} · {networkLabel}</span>
          </span>
        </div>
        <div className="min-w-0 text-center sm:text-left">
          <span className={CHIP}>{c.awaitingPay}</span>
          <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.crypto.sendExactly}</p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {view.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logo} alt="" aria-hidden width={28} height={28} data-testid="crypto-logo" className="h-7 w-7 shrink-0 rounded-full object-contain" draggable={false} />
            )}
            <p className="min-w-0 font-mono text-2xl font-bold tabular-nums text-white" data-testid="crypto-amount"><span className="break-all">{view.payAmountText}</span>{" "}<span className="whitespace-nowrap">{symbol}</span></p>
            <button type="button" onClick={() => void copy("amount", view.payAmountText)} className={`inline-flex h-9 shrink-0 items-center rounded-lg border border-white/15 px-2.5 text-[11px] font-semibold text-white/80 transition hover:bg-white/10 ${FOCUS}`}>{c.crypto.copy}</button>
          </div>
          {breakdown && <p className="mt-1 text-[11px] leading-4 text-white/50" data-testid="crypto-breakdown">{breakdown}</p>}
          <PendingCountdown expiresAt={view.expiresAt} now={now} c={c} align="start" />
          <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.crypto.address}</p>
          <code className="mt-1 block min-w-0 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[12px] leading-5 text-white" data-testid="crypto-address">{view.payAddress}</code>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void copy("address", view.payAddress)} className={`${BTN} min-w-0 whitespace-nowrap border border-white/15 px-2 text-xs text-white/80 hover:bg-white/10 ${FOCUS}`}>{c.crypto.copyAddress}</button>
            <CheckButton checking={checking} onCheck={onCheck} c={c} compact />
          </div>
          <AutoStatus c={c} />
          <p role="status" aria-live="polite" className="mt-1 min-h-4 text-[11px] text-white/60">{status ? (status.ok ? c.crypto.copied : c.crypto.copyFailed) : ""}</p>
        </div>
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#FFB800]/25 bg-[#FFB800]/[0.08] px-3 py-2 text-left text-[11px] leading-4 text-[#FFD66B]">
        <span aria-hidden className="shrink-0">⚠</span>
        <span>{c.crypto.onlyAccepted(symbol, networkLabel)}</span>
      </div>
      <LockedNote c={c} />
    </section>
  );
}

export function GatewayPaymentPanel(props: Props) {
  const { payment, ...rest } = props;
  return payment.kind === "gateway"
    ? <GatewayPanel view={payment} {...rest} />
    : <CryptoPanel view={payment} locale={rest.locale} now={rest.now} checking={rest.checking} onCheck={rest.onCheck} />;
}
