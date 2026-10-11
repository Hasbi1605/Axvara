// src/components/pedia/PlatformGrid.tsx — Grid platform + ProductCard (PD-01/03).
// Ikon = logo asli tiap platform (Simple Icons, CC0 — 2026-10-08, permintaan
// owner), fill currentColor + warna brand per platform.
import Link from "next/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

export const PEDIA_PLATFORMS = [
  { id: "instagram", label: "Instagram", color: "#D62976" },
  { id: "tiktok", label: "TikTok", color: "#FE2C55" },
  { id: "youtube", label: "YouTube", color: "#FF0000" },
  { id: "facebook", label: "Facebook", color: "#1877F2" },
  { id: "threads", label: "Threads", color: "#FFFFFF" },
  { id: "spotify", label: "Spotify", color: "#1DB954" },
  { id: "shopee", label: "Shopee", color: "#EE4D2D" },
  { id: "x", label: "X", color: "#FFFFFF" },
] as const;

export function PlatformIcon({ id, size = 28 }: { id: string; size?: number }) {
  // Ikon = file SVG per platform (fill warna brand ditulis langsung di file —
  // <img> eksternal tidak mewarisi currentColor parent).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/icons/platforms/${id}.svg`} alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />;
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
  badges: string[];
  minPrice: number | null;
  minQuantity?: number;
  minTier?: string;
};

export function catalogCard(p: PediaCatalogProduct): ProductCardData {
  const lowest = p.tiers.flatMap((t) => Object.entries(t.prices).filter(([, price]) => price > 0).map(([qty, price]) => ({ qty: Number(qty), price, tier: t.tier })))
    .sort((a, b) => a.price - b.price || a.qty - b.qty)[0];
  return { slug: p.slug, name: p.name, platform: p.platform, tagline: null, badges: [], minPrice: lowest?.price ?? null, minQuantity: lowest?.qty, minTier: lowest?.tier };
}

export function ProductCard({ p }: { p: ProductCardData }) {
  return (
    <Link prefetch={false}
      href={`/pedia/o/${p.slug}`}
      className="flex h-full items-start gap-3 rounded-xl border border-white/15 bg-white/[0.02] p-5 transition-colors hover:border-white/30 hover:bg-white/[0.04]"
      aria-label={`${p.name} — lihat paket`}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5" aria-hidden="true">
        <PlatformIcon id={p.platform} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold leading-snug text-white">{p.name}</span>
        <span className="mt-3 block text-lg font-semibold tabular-nums text-white">
          {p.minPrice != null ? `Mulai Rp${p.minPrice.toLocaleString("id-ID")}` : "Lihat harga"}
        </span>
        {p.minQuantity != null && <span className="mt-1 block text-xs text-white/65">Untuk {p.minQuantity.toLocaleString("id-ID")} · paket <span className="capitalize">{p.minTier}</span></span>}
        <span className="mt-4 block text-sm font-medium text-[#00E5FF]">Lihat paket →</span>
      </span>
    </Link>
  );
}
