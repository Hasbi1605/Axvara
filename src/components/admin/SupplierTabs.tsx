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
    <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-admin-border bg-admin-subtle p-1" role="tablist" aria-label="Bagian panel supplier">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`h-9 whitespace-nowrap rounded-lg px-4 text-xs font-semibold transition ${isActive ? "bg-admin-primary text-admin-inverse" : "text-admin-muted hover:text-admin-fg"}`}
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
    return <span title={reason || "Tampil di storefront"} className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-admin-success">Live</span>;
  }
  if (s === "hidden_loser") {
    return <span title={reason || "Produk kalah pasangan"} className="rounded-md border border-admin-border bg-admin-subtle px-2 py-0.5 text-xs font-bold text-admin-muted">Hidden: kalah</span>;
  }
  if (s === "hidden_nocatalog") {
    return <span title={reason || "Tanpa pasangan katalog"} className="rounded-md border border-admin-border bg-admin-subtle px-2 py-0.5 text-xs font-bold text-admin-muted">Hidden: tanpa katalog</span>;
  }
  if (s === "hidden_soldout") {
    return <span title={reason || "Stok habis"} className="rounded-md border border-[#FFB800]/25 bg-[#FFB800]/10 px-2 py-0.5 text-xs font-bold text-admin-warning">Hidden: habis</span>;
  }
  return <span title={reason || "Nonaktif manual"} className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-xs font-bold text-admin-danger">Off</span>;
}
