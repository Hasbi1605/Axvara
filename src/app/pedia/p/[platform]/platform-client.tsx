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
  const [query, setQuery] = useState("");
  const filtered = products.filter((p) => {
    if (!`${p.name} ${p.platform} ${p.metric}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (kind === "Semua") return true;
    if (kind === "Lainnya") {
      return !Object.values(KIND_MATCH).flat().includes(p.metric);
    }
    return (KIND_MATCH[kind] ?? []).includes(p.metric);
  });
  return (
    <div className="pt-6">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-[#00E5FF]/10 to-white/[0.025] p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5" aria-hidden="true">
          <PlatformIcon id={platform} size={24} />
        </span>
        <div>
          <h1 className="font-display text-[22px] font-bold text-white sm:text-[32px]">{name}</h1>
          <p className="text-sm text-white/55">Pilih layanan untuk {name}.</p>
        </div>
      </div>
      <label className="mt-5 block text-sm text-white/70">Cari layanan {name}<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama layanan" className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-white/[0.03] px-3 text-base text-white" /></label>
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
        <div className="mt-6 text-sm text-white/65"><p>Tidak ada layanan yang sesuai pencarian.</p><button type="button" onClick={() => { setKind("Semua"); setQuery(""); }} className="min-h-11 text-[#00E5FF]">Reset pencarian</button><a href="/pedia" className="ml-4 inline-flex min-h-11 items-center text-[#00E5FF]">Lihat platform lain</a></div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">
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
