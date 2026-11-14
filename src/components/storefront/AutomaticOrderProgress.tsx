import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";

export function AutomaticOrderProgress({ items, locale = "id" }: { items: AutomaticProgressItem[]; locale?: "id" | "en" }) {
  const en = locale === "en";
  const labels = en ? {
    preparing: "Preparing your product", queued: "Waiting in the queue", running: "Creating your product",
    ready: "Product ready", needs_check: "We're checking your product", failed: "Product needs attention",
  } : {
    preparing: "Menyiapkan produkmu", queued: "Menunggu giliran", running: "Membuat produkmu",
    ready: "Produk siap", needs_check: "Produk sedang diperiksa", failed: "Produk perlu diperiksa",
  };
  return <section className="mt-6 space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left" aria-label={en ? "Product progress" : "Progres produk"} aria-live="polite">
    {items.map((item, index) => {
      const ready = item.stage === "ready";
      const attention = item.stage === "needs_check" || item.stage === "failed";
      const percent = ready ? 100 : Math.min(99, Math.floor(item.ready / Math.max(1, item.total) * 100));
      return <div key={index}>
        <p className="break-words text-sm font-medium text-white/90">{item.label}</p>
        <div className="mt-2 flex items-center gap-2 text-sm">
          {!ready && !attention && <span aria-hidden className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[#00E5FF]/25 border-t-[#00E5FF] motion-reduce:animate-none" />}
          <span className={attention ? "text-[#FFB800]" : ready ? "text-emerald-300" : "text-[#00E5FF]"}>{labels[item.stage]}</span>
          {ready && <span className="ml-auto font-mono text-sm tabular-nums text-emerald-300">100%</span>}
        </div>
        {!attention && (item.total > 1 || ready) && <>
          <div role="progressbar" aria-label={item.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#00E5FF] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-white/70">{en ? `${item.ready} of ${item.total} ready` : `${item.ready} dari ${item.total} siap`}</p>
        </>}
        {item.stage === "queued" && item.queuePosition !== null && <p className="mt-2 text-xs text-white/70">{en ? `Queue position: ${item.queuePosition}` : `Urutan antrean: ${item.queuePosition}`}</p>}
        <p className="mt-2 text-xs leading-5 text-white/70">{ready
          ? en ? "Your product details are available below." : "Detail produkmu tersedia di bawah."
          : attention ? en ? "We've recorded the issue and will follow it up. You don't need to order again." : "Kendalanya sudah tercatat dan akan kami tindak lanjuti. Kamu tidak perlu memesan ulang."
          : en ? "This page updates automatically. Your product details will appear here when ready." : "Halaman ini diperbarui otomatis. Detail produk akan muncul di sini setelah siap."}</p>
      </div>;
    })}
  </section>;
}
