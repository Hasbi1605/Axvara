// src/components/admin/SupplierTabs.tsx — Tab dalam-halaman bersama WR + SK
// (keputusan owner 2026-10-01, cermin SystemTabs Pengaturan Toko).
//
// BEDA dengan SystemTabs: ini state LOKAL dalam manager (tidak menyentuh
// routing/sidebar/URL) — pindah menu = kembali ke tab default. Satu pola,
// dua isi (WR 4 tab, SK 5 tab).

"use client";

export type SupplierTabId = "ringkas" | "antrean" | "markup" | "aturan" | "audit" | "alat";

export function SupplierTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: SupplierTabId; label: string; count?: number }[];
  active: SupplierTabId;
  onChange: (tab: SupplierTabId) => void;
}) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="Bagian panel supplier">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`h-9 whitespace-nowrap rounded-lg px-4 text-xs font-semibold transition ${isActive ? "bg-[#00E5FF] text-[#07101f]" : "text-white/55 hover:text-white"}`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 ? ` (${tab.count})` : ""}
          </button>
        );
      })}
    </div>
  );
}

/** Badge status varian markup — cermin LiveStatusBadge halaman Produk. */
export function VariantStatusBadge({ status, reason }: { status?: string; reason?: string }) {
  const s = status ?? "live";
  if (s === "live") {
    return <span title={reason || "Tampil di storefront"} className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Live</span>;
  }
  if (s === "hidden_loser") {
    return <span title={reason || "Produk kalah pasangan"} className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">Hidden: kalah</span>;
  }
  if (s === "hidden_nocatalog") {
    return <span title={reason || "Tanpa pasangan katalog"} className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] font-bold text-white/45">Hidden: tanpa katalog</span>;
  }
  if (s === "hidden_soldout") {
    return <span title={reason || "Stok habis"} className="rounded-full border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-bold text-[#FFD66B]">Hidden: habis</span>;
  }
  return <span title={reason || "Nonaktif manual"} className="rounded-full border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-300">Off</span>;
}
