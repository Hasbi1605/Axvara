import type { Estimate, EstimateLine } from "@/lib/refund/calculate";
import type { Locale } from "@/lib/i18n/locale";

export const refundButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:border-cyan-300/50 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50 motion-reduce:transition-none";
export const refundInput = "block min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#080C1E] px-3.5 text-base text-white [color-scheme:dark] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300";
export const idr = (amount: number) => `Rp${amount.toLocaleString("id-ID")}`;
export const formatWib = (seconds: number, locale: Locale = "id") => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
  timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short",
}).format(seconds * 1000) + " WIB";

export function remainingTime(seconds: number, locale: Locale) {
  const en = locale === "en";
  if (seconds === 0) return en ? "0 days" : "0 hari";
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600);
  if (!days && !hours) return en ? "< 1 hour" : "< 1 jam";
  return [days && `${days} ${en ? (days === 1 ? "day" : "days") : "hari"}`, hours && `${hours} ${en ? "h" : "jam"}`].filter(Boolean).join(" ");
}

export function RefundResult({ estimate, locale = "id", shared = false, actions }: {
  estimate: Estimate; locale?: Locale; shared?: boolean; actions?: (line: EstimateLine) => React.ReactNode;
}) {
  const en = locale === "en";
  if (estimate.state !== "ready") return <p role="status" className="text-sm text-white/70">{{
    unpaid: en ? "Invoice not paid." : "Invoice belum lunas.",
    refunded: en ? "This invoice has already been refunded." : "Invoice sudah direfund.",
    review: en ? "An admin needs to verify this order first." : "Perlu pengecekan admin.",
  }[estimate.state]}</p>;
  const locked = estimate.lines.filter(line => line.claim != null && line.amount != null);
  const hasAmount = estimate.lines.some(line => line.amount != null);
  const claimTotal = locked.length > 0 && (!shared || locked.length === estimate.lines.length);
  const total = (claimTotal ? locked : estimate.lines).reduce((sum, line) => sum + (line.amount ?? 0), 0);
  return <div className="space-y-4" aria-live="polite">
    {hasAmount && <div>
      <p className="text-xs font-medium text-white/65">{claimTotal ? (en ? "Claim estimate" : "Estimasi klaim") : (en ? "Estimated refund" : "Estimasi refund")}</p>
      <p className="mt-1 font-display text-3xl font-bold tracking-tight text-cyan-200 tabular-nums sm:text-4xl">{idr(total)}</p>
    </div>}
    <ul className="space-y-3">
      {estimate.lines.map(line => <li key={line.id} className="min-w-0 space-y-3 rounded-2xl border border-white/10 bg-black/15 p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-white">{line.name}{line.unitTotal && line.unitTotal > 1 ? ` · Unit ${line.unit}/${line.unitTotal}` : line.qty > 1 ? ` ×${line.qty}` : ""}</p>
          {line.amount != null && <span className="text-sm font-semibold tabular-nums text-cyan-200">{idr(line.amount)}</span>}
        </div>
        {line.status !== "ready" && <p className="text-xs text-white/65">{{
          waiting: en ? "Awaiting delivery." : "Belum dikirim.", review: en ? "Needs admin review." : "Perlu pengecekan admin.",
          no_warranty: en ? "No structured warranty on this invoice." : "Garansi tidak tercatat untuk estimasi.", warranty_ended: en ? "Warranty ended." : "Masa garansi berakhir.", ended: en ? "Plan ended." : "Masa aktif berakhir.",
        }[line.status]}</p>}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-3">
          <ResultField label={en ? "Product price" : "Harga produk"}>{idr(line.price)}</ResultField>
          {line.duration != null && <ResultField label={en ? "Plan duration" : "Durasi paket"}>{remainingTime(line.duration, locale)}</ResultField>}
          {line.remaining != null && <ResultField label={en ? "Remaining time" : "Sisa masa aktif"}>{remainingTime(line.remaining, locale)}</ResultField>}
          {line.start != null && <ResultField label={en ? "Start" : "Mulai"}>{formatWib(line.start, locale)}</ResultField>}
          {line.end != null && <ResultField label={en ? "End" : "Berakhir"}>{formatWib(line.end, locale)}</ResultField>}
          {line.warrantyEnd != null && <ResultField label={en ? "Warranty until" : "Garansi hingga"}>{formatWib(line.warrantyEnd, locale)}</ResultField>}
          {line.amount != null && <ResultField label={en ? "Refund rate" : "Rate refund"}>{line.rate / 100}%</ResultField>}
          {line.claim != null && <ResultField label={en ? "Claim received" : "Laporan diterima"}>{formatWib(line.claim, locale)}</ResultField>}
        </dl>
        {line.duration != null && line.remaining != null && <div aria-hidden className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${line.remaining / line.duration * 100}%` }} /></div>}
        {actions?.(line)}
      </li>)}
    </ul>
    <p className="text-xs text-white/65">{shared ? (en ? "Shared on" : "Dibagikan") : (en ? "Calculated on" : "Dihitung")} {formatWib(estimate.asOf, locale)}. {en ? "Estimate only." : "Bukan persetujuan refund."}</p>
  </div>;
}

function ResultField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 bg-[#10152A] px-3 py-2.5">
    <dt className="text-xs text-white/65">{label}</dt>
    <dd className="mt-0.5 break-words text-xs font-semibold leading-relaxed text-white tabular-nums sm:text-sm">{children}</dd>
  </div>;
}
