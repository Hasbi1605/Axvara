// src/components/pedia/PlatformGrid.tsx — Grid platform + ProductCard (PD-01/03).
import Link from "next/link";

export const PEDIA_PLATFORMS = [
  { id: "instagram", label: "Instagram", color: "#D62976" },
  { id: "tiktok", label: "TikTok", color: "#25F4EE" },
  { id: "youtube", label: "YouTube", color: "#FF0000" },
  { id: "facebook", label: "Facebook", color: "#1877F2" },
  { id: "threads", label: "Threads", color: "#FFFFFF" },
  { id: "spotify", label: "Spotify", color: "#1DB954" },
  { id: "shopee", label: "Shopee", color: "#EE4D2D" },
  { id: "x", label: "X", color: "#FFFFFF" },
] as const;

export function PlatformGrid() {
  return (
    <div>
      <p className="text-sm font-semibold text-white/70">atau pilih platform</p>
      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {PEDIA_PLATFORMS.map((p) => (
          <Link
            key={p.id}
            href={`/pedia/p/${p.id}`}
            className="group flex h-[84px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent transition hover:-translate-y-0.5"
            aria-label={`Layanan ${p.label}`}
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/5 text-lg font-bold" style={{ color: p.color }} aria-hidden="true">
              {p.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="text-[12.5px] font-medium text-white/70 group-hover:text-white">{p.label}</span>
            <span className="h-0.5 w-0 rounded-full transition-all group-hover:w-6" style={{ background: p.color }} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export type ProductCardData = {
  slug: string;
  name: string;
  tagline: string | null;
  platform: string;
  badges: string[];
  minPrice: number | null;
};

export function ProductCard({ p }: { p: ProductCardData }) {
  const plat = PEDIA_PLATFORMS.find((x) => x.id === p.platform);
  return (
    <Link
      href={`/pedia/o/${p.slug}`}
      className="ax-glass-card flex items-center gap-3 rounded-[20px] p-4 transition hover:border-white/20"
      aria-label={`${p.name} — ${p.tagline ?? ""}`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm font-bold" style={{ color: plat?.color ?? "#fff" }} aria-hidden="true">
        {p.platform.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold text-white">{p.name}</span>
        {p.tagline && <span className="block truncate text-[13px] text-white/55">{p.tagline}</span>}
        {p.badges.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {p.badges.slice(0, 2).map((b) => (
              <span key={b} className="rounded-full bg-[var(--px-violet-soft)] px-2 py-0.5 text-[11px] font-semibold text-white">{b}</span>
            ))}
          </span>
        )}
        <span className="mt-1 block font-display text-[18px] font-bold text-white">
          {p.minPrice != null ? `mulai Rp${p.minPrice.toLocaleString("id-ID")}` : "Lihat harga"}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-white/30">→</span>
    </Link>
  );
}
