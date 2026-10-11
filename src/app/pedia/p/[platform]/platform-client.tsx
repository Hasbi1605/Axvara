// Filter jenis client untuk halaman platform.
"use client";

import { useState } from "react";
import { ProductCard, PlatformIcon, catalogCard } from "@/components/pedia/PlatformGrid";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const KINDS = ["Semua", "Followers", "Likes", "Views", "Lainnya"] as const;

const KIND_MATCH: Record<string, string[]> = {
  Followers: ["followers", "subscribers", "members"],
  Likes: ["likes"],
  Views: ["views", "plays"],
};

export function PlatformPageClient({ platform, name, products }: { platform: string; name: string; products: PediaCatalogProduct[] }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("Semua");
  const filtered = products.filter((p) => {
    if (kind === "Semua") return true;
    if (kind === "Lainnya") {
      return !Object.values(KIND_MATCH).flat().includes(p.metric);
    }
    return (KIND_MATCH[kind] ?? []).includes(p.metric);
  });
  return (
    <div className="pt-8">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5" aria-hidden="true">
          <PlatformIcon id={platform} size={24} />
        </span>
        <div>
          <h1 className="font-display text-[22px] font-bold text-white sm:text-[32px]">{name}</h1>
          <p className="text-sm text-white/55">Pilih layanan untuk {name}.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Filter jenis">
        {KINDS.map((k) => (
          <button
            key={k} aria-pressed={kind === k} onClick={() => setKind(k)}
            className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${kind === k ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}
          >
            {k}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-white/55">Belum ada layanan untuk ini. Lihat platform lain.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProductCard
              key={p.slug}
              p={catalogCard(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
