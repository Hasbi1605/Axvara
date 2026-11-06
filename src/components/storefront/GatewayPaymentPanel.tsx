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

function CheckButton({ checking, onCheck, c }: { checking: boolean; onCheck: () => void; c: ReturnType<typeof orderPanelCopy> }) {
  return (
    <button type="button" onClick={onCheck} disabled={checking} className={`${BTN} border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20 ${FOCUS}`}>
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
          <div className="flex justify-between gap-3"><dt className="text-white/60">{view.fee !== null ? c.fee : c.estFee}</dt><dd className="tabular-nums text-white">{view.fee !== null ? formatRupiah(view.fee) : view.estimatedFee !== null ? formatRupiah(view.estimatedFee) : "—"}</dd></div>
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
      <section aria-label={c.h1.pendingGateway} className="mt-4 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 text-left">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{c.methodLabel}</p>
        <p className="break-words text-sm font-semibold text-white">{view.label}</p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.totalPay}</p>
        <p className="font-display text-2xl font-bold tabular-nums text-white">{formatRupiah(view.total ?? view.subtotal)}</p>
        {view.fee !== null && view.fee > 0 && <p className="text-[11px] text-white/50">{c.subtotal} {formatRupiah(view.subtotal)} · {c.fee} {formatRupiah(view.fee)}</p>}
        <Deadline expiresAt={view.expiresAt} now={now} c={c} />
        {view.virtualAccount && (
          <div className="mt-3">
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
            {c.gateway.openLink} <span aria-hidden>↗</span>
          </a>
        ) : !view.virtualAccount ? (
          <p role="status" className="mt-3 text-xs text-amber-200">{c.gateway.noLink}</p>
        ) : null}
        <div className="mt-3"><CheckButton checking={checking} onCheck={onCheck} c={c} /></div>
        <p className="mt-2 text-[11px] leading-4 text-white/50">{c.autoStatus}</p>
        <p className="mt-1 text-[11px] leading-4 text-white/45">{c.locked}</p>
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
  return (
    <section aria-label={c.h1.pendingCrypto} className="mt-4 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 text-left">
      {view.baseText && view.surchargeText && view.surchargeBps !== null && (
        <div className="mb-2 space-y-0.5 text-xs text-white/70" data-testid="crypto-breakdown">
          <div className="flex justify-between gap-3"><span>{c.crypto.baseValue}</span><span className="tabular-nums">{usdFor(view.baseText, locale)}</span></div>
          <div className="flex justify-between gap-3"><span>{c.crypto.serviceFee(view.surchargeBps)}</span><span className="tabular-nums">{usdFor(view.surchargeText, locale)}</span></div>
        </div>
      )}
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/45">{view.baseText ? c.crypto.totalValue : c.crypto.orderValue}</p>
      <p className="font-display text-lg font-bold tabular-nums text-white">{usdFor(view.usdText, locale)}</p>
      {missing ? (
        <p role="status" className="mt-3 text-xs text-amber-200">{c.lead.preparing}</p>
      ) : (
        <>
          <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.crypto.sendExactly}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {view.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.logo} alt="" aria-hidden width={32} height={32} data-testid="crypto-logo" className="h-8 w-8 shrink-0 rounded-full object-contain" draggable={false} />
            )}
            <p className="min-w-0 flex-1 basis-40 font-mono text-xl font-bold tabular-nums text-white" data-testid="crypto-amount"><span className="break-all">{view.payAmountText}</span>{" "}<span className="whitespace-nowrap">{symbol}</span></p>
            <button type="button" onClick={() => void copy("amount", view.payAmountText)} className={`${BTN} shrink-0 border border-white/15 text-white/80 hover:bg-white/10 ${FOCUS}`}>{c.crypto.copyAmount}</button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-black/25 px-3 py-2" data-testid="crypto-network">
            <span className="text-[11px] uppercase tracking-[0.12em] text-white/50">{c.crypto.network}</span>
            <span className="text-right text-sm font-semibold text-white">{networkLabel}</span>
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/45">{c.crypto.address}</p>
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start">
            {qrSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrSrc} alt={c.crypto.qrAlt} width={132} height={132} data-testid="crypto-qr" className="h-[132px] w-[132px] shrink-0 self-center rounded-lg bg-white p-1.5 sm:self-start" draggable={false} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <code className="block min-w-0 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[13px] leading-5 text-white" data-testid="crypto-address">{view.payAddress}</code>
              <button type="button" onClick={() => void copy("address", view.payAddress)} className={`${BTN} w-full shrink-0 border border-white/15 text-white/80 hover:bg-white/10 ${FOCUS}`}>{c.crypto.copyAddress}</button>
            </div>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-4 text-[11px] text-white/60">{status ? (status.ok ? c.crypto.copied : c.crypto.copyFailed) : ""}</p>
        </>
      )}
      <Deadline expiresAt={view.expiresAt} now={now} c={c} />
      <p className="mt-3 text-[11px] leading-4 text-amber-200">{c.crypto.onlyAccepted(symbol, networkLabel)}</p>
      <div className="mt-3"><CheckButton checking={checking} onCheck={onCheck} c={c} /></div>
      <p className="mt-1 text-[11px] leading-4 text-white/45">{c.locked}</p>
    </section>
  );
}

export function GatewayPaymentPanel(props: Props) {
  const { payment, ...rest } = props;
  return payment.kind === "gateway"
    ? <GatewayPanel view={payment} {...rest} />
    : <CryptoPanel view={payment} locale={rest.locale} now={rest.now} checking={rest.checking} onCheck={rest.onCheck} />;
}
