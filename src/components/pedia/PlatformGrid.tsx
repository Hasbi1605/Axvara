// src/components/pedia/PlatformGrid.tsx — Grid platform + ProductCard (PD-01/03).
// Ikon = logo asli tiap platform (Simple Icons, CC0 — 2026-10-08, permintaan
// owner), fill currentColor + warna brand per platform.
import Link from "next/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { PEDIA_PLATFORM_CONFIG } from "@/lib/pedia/platforms";

export const PEDIA_PLATFORMS = PEDIA_PLATFORM_CONFIG;

export function PlatformIcon({ id, size = 28, className }: { id: string; size?: number; className?: string }) {
  // Ikon = file SVG per platform (fill warna brand ditulis langsung di file —
  // <img> eksternal tidak mewarisi currentColor parent).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/platforms/${id}.svg`} alt="" width={size} height={size} className={className} style={{ width: size, height: size }} draggable={false} />;
}

export function PlatformGrid() {
  return (
    <div>
      <p className="text-sm font-semibold text-white/70">atau pilih platform</p>
      <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {PEDIA_PLATFORMS.map((p) => (
          <Link prefetch={false}
            key={p.id}
            href={`/pedia/p/${p.id}`}
            className="group flex h-[84px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-transparent transition hover:-translate-y-0.5"
            aria-label={`Layanan ${p.label}`}
          >
            <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-white/5" aria-hidden="true">
              <PlatformIcon id={p.id} size={28} />
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
  metric: string;
  badges: string[];
  minPrice: number | null;
  minQuantity?: number;
  minTier?: string;
  refillDays?: number;
  /** Jumlah layanan terkurasi di dalam produk + harga per 1.000 termurah. */
  serviceCount?: number;
  pricePer1k?: number | null;
  /** Gambar kartu Axvara-style per platform (2026-10-15, permintaan owner):
   *  tile 1600x900 R2 `/r2/products/pedia-platform-<platform>.webp`.
   *  null → fallback panel gradasi brand lama. */
  image?: string | null;
};

/** Path gambar kartu per platform — satu sumber dengan `platformCardImage`
 *  di catalog API (keduanya path R2 statis, bukan kolom DB).
 *  Shopee/Spotify memakai suffix -v2 (cache-busting 2026-10-15: route /r2
 *  immutable 1 thn, timpa path yang sama tidak menembus cache browser). */
export const PLATFORM_CARD_IMAGE: Record<string, string> = {
  instagram: "/r2/products/pedia-platform-instagram.webp",
  tiktok: "/r2/products/pedia-platform-tiktok.webp",
  youtube: "/r2/products/pedia-platform-youtube.webp",
  facebook: "/r2/products/pedia-platform-facebook.webp",
  threads: "/r2/products/pedia-platform-threads.webp",
  spotify: "/r2/products/pedia-platform-spotify-v2.webp",
  shopee: "/r2/products/pedia-platform-shopee-v2.webp",
  x: "/r2/products/pedia-platform-x.webp",
};

export function catalogCard(p: PediaCatalogProduct): ProductCardData {
  const lowest = p.tiers.flatMap((t) => Object.entries(t.prices).filter(([qty, price]) => p.packages.includes(Number(qty)) && price > 0).map(([qty, price]) => ({ qty: Number(qty), price, tier: t.tier, refillDays: t.refill_days })))
    .sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
  const per1k = p.tiers.map((t) => t.price_per_1k ?? Infinity).filter((v) => Number.isFinite(v));
  return {
    slug: p.slug, name: p.name, platform: p.platform, metric: p.metric, tagline: p.tagline?.trim() || null, badges: [],
    minPrice: lowest?.price ?? null, minQuantity: lowest?.qty, minTier: lowest?.tier, refillDays: lowest?.refillDays,
    serviceCount: p.tiers.length,
    pricePer1k: per1k.length ? Math.min(...per1k) : null,
    image: p.image ?? PLATFORM_CARD_IMAGE[p.platform] ?? null,
  };
}

/** Warna brand per platform untuk panel visual kartu (satu sumber dengan orbit). */
export const PLATFORM_VISUAL: Record<string, { color: string; label: string }> = {
  instagram: { color: "#D62976", label: "Instagram" },
  tiktok: { color: "#FE2C55", label: "TikTok" },
  youtube: { color: "#FF0000", label: "YouTube" },
  facebook: { color: "#1877F2", label: "Facebook" },
  threads: { color: "#FFFFFF", label: "Threads" },
  spotify: { color: "#1DB954", label: "Spotify" },
  shopee: { color: "#EE4D2D", label: "Shopee" },
  x: { color: "#FFFFFF", label: "X" },
};

/** Kata metrik ramah untuk panel visual (bukan jargon internal). */
const METRIC_WORD: Record<string, string> = {
  followers: "Followers", likes: "Likes", views: "Views", subscribers: "Subscriber", plays: "Plays",
};

export function ProductCard({ p, index = 0 }: { p: ProductCardData; index?: number }) {
  const config = PEDIA_PLATFORM_CONFIG.find((platform) => platform.id === p.platform);
  const visual = PLATFORM_VISUAL[p.platform] ?? { color: config?.color ?? "#00E5FF", label: config?.label ?? p.platform };
  const metricWord = METRIC_WORD[p.metric] ?? p.metric;
  // 4 kartu pertama eager + fetchPriority high ala Market (LCP di atas lipatan).
  const eager = index < 4;
  return (
    <Link prefetch={false}
      href={`/pedia/o/${p.slug}`}
      className="group ax-glass-card flex h-full min-w-0 flex-col overflow-hidden rounded-[16px] transition-all duration-300 hover:-translate-y-1 hover:border-[#00E5FF]/30 hover:shadow-[0_12px_32px_rgba(0,229,255,0.08)] sm:rounded-[22px]"
      aria-label={`${p.name} — lihat paket`}
    >
      {/* Panel visual ala kartu Market (gambar 16:10): tile Axvara-style per
          platform (2026-10-15, permintaan owner) + label platform & metrik —
          mata membaca gambar dulu, bukan daftar harga. null → gradasi lama. */}
      <span className="relative m-1 block aspect-[16/10] overflow-hidden rounded-[12px] bg-white/[0.03] sm:m-1.5 sm:rounded-[16px]" aria-hidden="true">
        {p.image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.image}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              loading={eager ? "eager" : "lazy"}
              // React 18 tak kenal fetchPriority (baru React 19) — pola yang
              // sama dipakai Market (ProductCard.tsx); warning jsdom-only.
              fetchPriority={eager ? "high" : "auto"}
              decoding="async"
            />
            <span className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white/85 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">{visual.label}</span>
            <span className="absolute bottom-3 right-4 font-display text-lg font-bold text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">{metricWord}</span>
          </>
        ) : (
          <span className="block h-full w-full" style={{ background: `linear-gradient(135deg, ${visual.color}2E 0%, rgba(15,20,48,0.9) 58%, rgba(22,29,74,0.95) 100%)` }}>
            <span className="absolute -right-6 -top-8 h-32 w-32 rounded-full opacity-25 blur-2xl transition duration-500 group-hover:opacity-40" style={{ background: visual.color }} />
            <span className="absolute left-4 top-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/30 shadow-lg backdrop-blur-sm transition duration-500 group-hover:scale-105">
              <PlatformIcon id={p.platform} size={26} />
            </span>
            <span className="absolute bottom-3 left-4 text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">{visual.label}</span>
            <span className="absolute bottom-3 right-4 font-display text-lg font-bold text-white/85">{metricWord}</span>
          </span>
        )}
        <span className="absolute right-3 top-3 text-white/40 transition group-hover:text-[#00E5FF]">↗</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
        <span className="block break-words text-sm font-semibold leading-snug text-white sm:text-base">{p.name}</span>
        {/* 2026-10-12 (owner): tagline AI slop DIHAPUS dari kartu — judul langsung ke harga. */}
        <span className="mt-2 block font-bold text-[14px] sm:text-[17px] text-white tracking-[-0.02em] leading-none">
          {p.pricePer1k != null ? `Mulai Rp${p.pricePer1k.toLocaleString("id-ID")} /1.000` : p.minPrice != null ? `Mulai Rp${p.minPrice.toLocaleString("id-ID")}` : "Lihat harga"}
        </span>
        <span className="mt-1 block text-xs text-white/60">
          {p.serviceCount ? `${p.serviceCount} pilihan terkurasi` : "Pilihan terkurasi"}
          {p.minQuantity != null && <> · mulai {p.minQuantity.toLocaleString("id-ID")}</>}
        </span>
        <span className="mt-auto flex items-end justify-between gap-2 pt-3">
          {p.refillDays != null
            ? <span className={`inline-block rounded-md px-2 py-1 text-[11px] ${p.refillDays > 0 ? "bg-[#00E5FF]/10 text-[#00E5FF]" : "bg-[#FFB800]/10 text-[#FFB800]"}`}>{p.refillDays > 0 ? `Refill ${p.refillDays} hari` : "Tanpa refill"}</span>
            : <span />}
          <span className="text-xs font-semibold text-[#00E5FF]/80 transition group-hover:text-[#00E5FF]">Lihat layanan →</span>
        </span>
      </span>
    </Link>
  );
}

/** Skeleton kartu katalog (primitif ax-skeleton yang sama dengan Market). */
export function ProductCardSkeleton() {
  return (
    <div className="ax-glass-card overflow-hidden rounded-[16px] sm:rounded-[22px]" role="status" aria-label="Memuat layanan">
      <div className="ax-skeleton m-1 aspect-[16/10] rounded-[12px] sm:m-1.5 sm:rounded-[16px]" />
      <div className="space-y-2 px-3 pb-4 pt-1 sm:px-4">
        <div className="ax-skeleton h-4 w-2/3 rounded-full" />
        <div className="ax-skeleton h-5 w-1/2 rounded-full" />
        <div className="ax-skeleton h-3 w-1/3 rounded-full" />
      </div>
    </div>
  );
}
