import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";

const IN_PROGRESS = new Set<AutomaticProgressItem["stage"]>(["preparing", "queued", "running"]);

export function AutomaticOrderProgress({ items, locale = "id", className = "" }: { items: AutomaticProgressItem[]; locale?: "id" | "en"; className?: string }) {
  const en = locale === "en";
  const labels = en ? {
    preparing: "Preparing your product", queued: "Waiting in the queue", running: "Creating your product",
    ready: "Product ready", needs_check: "We're checking your product", failed: "Product needs attention",
  } : {
    preparing: "Menyiapkan produkmu", queued: "Menunggu giliran", running: "Membuat produkmu",
    ready: "Produk siap", needs_check: "Produk sedang diperiksa", failed: "Produk perlu diperiksa",
  };
  // Catatan ekspektasi (keputusan owner 18 Nov 2026): tampil selama masih ada
  // item yang sedang dibuat; hilang begitu semua siap/perlu diperiksa.
  const working = items.some((item) => IN_PROGRESS.has(item.stage));
  // Short automatic-processing profile (1–5 min; admin after 15 min) vs Made by order (15 min–1 hr; admin after 1 hr).
  const shortEstimate = working && items.filter((item) => IN_PROGRESS.has(item.stage)).every((item) => item.estimateProfile === "short");
  return <section className={`mt-6 space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left${className ? ` ${className}` : ""}`} aria-label={en ? "Product progress" : "Progres produk"} aria-live="polite">
    {items.map((item, index) => {
      const ready = item.stage === "ready";
      const attention = item.stage === "needs_check" || item.stage === "failed";
      const hasStep = item.stage === "running" && item.total === 1 && Boolean(item.step && item.step.current > 0);
      const hasStepTotal = hasStep && Boolean(item.step?.total && item.step.total > 0);
      const stepPercent = hasStepTotal
        ? Math.min(95, Math.max(5, Math.round((item.step!.current / item.step!.total!) * 100)))
        : null;
      const percent = ready
        ? 100
        : stepPercent !== null
          ? stepPercent
          : Math.min(99, Math.floor(item.ready / Math.max(1, item.total) * 100));
      const determinate = !attention && (item.total > 1 || ready || stepPercent !== null);
      const attentionText = attention && item.attentionNote
        ? (en ? item.attentionNote.en : item.attentionNote.id)
        : null;
      return <div key={index}>
        <p className="break-words text-sm font-medium text-white/90">{item.label}</p>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className={attention ? "text-[#FFB800]" : ready ? "text-emerald-300" : "text-[#00E5FF]"}>{labels[item.stage]}</span>
          {hasStep && (
            <span className="ml-auto font-mono text-xs tabular-nums text-white/65">
              {hasStepTotal
                ? (en ? `Step ${item.step!.current} of ${item.step!.total}` : `Langkah ${item.step!.current} dari ${item.step!.total}`)
                : (en ? `Step ${item.step!.current}` : `Langkah ${item.step!.current}`)}
            </span>
          )}
          {ready && <span className="ml-auto font-mono text-sm tabular-nums text-emerald-300">100%</span>}
        </div>
        {!attention && !determinate && (
          <div role="progressbar" aria-label={`${item.label}: ${labels[item.stage]}`} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 rounded-full bg-[#00E5FF] motion-safe:animate-[order-progress_1.8s_ease-in-out_infinite_alternate]" />
          </div>
        )}
        {determinate && <>
          <div role="progressbar" aria-label={item.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#00E5FF] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          {item.total > 1 && <p className="mt-2 text-xs text-white/70">{en ? `${item.ready} of ${item.total} ready` : `${item.ready} dari ${item.total} siap`}</p>}
        </>}
        {item.stage === "queued" && item.queuePosition !== null && <p className="mt-2 text-xs text-white/70">{en ? `Queue position: ${item.queuePosition}` : `Urutan antrean: ${item.queuePosition}`}</p>}
        {attention && (
          attentionText ? (
            <div className="mt-2 space-y-1.5 rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-100/90">
              <p>{attentionText}</p>
              <p><a href="/wa" className="font-semibold text-[#00E5FF] underline-offset-2 hover:underline">{en ? "Contact admin" : "Hubungi admin"}</a></p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-white/70">{en ? "You don't need to order again." : "Kamu tidak perlu memesan ulang."}</p>
          )
        )}
      </div>;
    })}
    {working && <div className="border-t border-white/10 pt-4 text-xs leading-5 text-white/70">
      <p><span className="font-semibold text-white/90">{shortEstimate ? (en ? "Processed automatically" : "Diproses otomatis") : "Made by order"}</span>{en
        ? ` — being created automatically by our bot. Estimated ${shortEstimate ? "1–5 minutes" : "15 minutes–1 hour"}. Product details will appear here and in your email once ready.`
        : ` — sedang dibuat otomatis oleh bot. Estimasi ${shortEstimate ? "1–5 menit" : "15 menit–1 jam"}. Detail produk tampil di sini dan di email begitu siap.`}</p>
      <p className="mt-1">{en ? `Not done after ${shortEstimate ? "15 minutes" : "1 hour"}? ` : `Lebih dari ${shortEstimate ? "15 menit" : "1 jam"} belum selesai? `}<a href="/wa" className="font-medium text-[#00E5FF] underline-offset-2 hover:underline">{en ? "Contact admin" : "Hubungi admin"}</a></p>
    </div>}
  </section>;
}
