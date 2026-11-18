import type { AutomaticProgressItem } from "@/lib/warung-rebahan/progress";

const IN_PROGRESS = new Set<AutomaticProgressItem["stage"]>(["preparing", "queued", "running"]);

export function AutomaticOrderProgress({ items, locale = "id" }: { items: AutomaticProgressItem[]; locale?: "id" | "en" }) {
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
  return <section className="mt-6 space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left" aria-label={en ? "Product progress" : "Progres produk"} aria-live="polite">
    {items.map((item, index) => {
      const ready = item.stage === "ready";
      const attention = item.stage === "needs_check" || item.stage === "failed";
      const percent = ready ? 100 : Math.min(99, Math.floor(item.ready / Math.max(1, item.total) * 100));
      return <div key={index}>
        <p className="break-words text-sm font-medium text-white/90">{item.label}</p>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className={attention ? "text-[#FFB800]" : ready ? "text-emerald-300" : "text-[#00E5FF]"}>{labels[item.stage]}</span>
          {ready && <span className="ml-auto font-mono text-sm tabular-nums text-emerald-300">100%</span>}
        </div>
        {!attention && item.total === 1 && !ready && (
          <div role="progressbar" aria-label={`${item.label}: ${labels[item.stage]}`} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/3 rounded-full bg-[#00E5FF] motion-safe:animate-[order-progress_1.8s_ease-in-out_infinite_alternate]" />
          </div>
        )}
        {!attention && (item.total > 1 || ready) && <>
          <div role="progressbar" aria-label={item.label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#00E5FF] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
          {item.total > 1 && <p className="mt-2 text-xs text-white/70">{en ? `${item.ready} of ${item.total} ready` : `${item.ready} dari ${item.total} siap`}</p>}
        </>}
        {item.stage === "queued" && item.queuePosition !== null && <p className="mt-2 text-xs text-white/70">{en ? `Queue position: ${item.queuePosition}` : `Urutan antrean: ${item.queuePosition}`}</p>}
        {attention && <p className="mt-2 text-xs text-white/70">{en ? "You don't need to order again." : "Kamu tidak perlu memesan ulang."}</p>}
      </div>;
    })}
    {working && <div className="border-t border-white/10 pt-4 text-xs leading-5 text-white/70">
      <p><span className="font-semibold text-white/90">Made by order</span>{en
        ? " — being created automatically by our bot. Estimated 15 minutes–1 hour. Product details will appear here and in your email once ready."
        : " — sedang dibuat otomatis oleh bot. Estimasi 15 menit–1 jam. Detail produk tampil di sini dan di email begitu siap."}</p>
      <p className="mt-1">{en ? "Not done after 1 hour? " : "Lebih dari 1 jam belum selesai? "}<a href="/wa" className="font-medium text-[#00E5FF] underline-offset-2 hover:underline">{en ? "Contact admin" : "Hubungi admin"}</a></p>
    </div>}
  </section>;
}
