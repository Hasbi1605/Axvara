"use client";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Badge } from "./ui/badge";
export type SupplierTabId = "ringkas" | "antrean" | "markup" | "aturan" | "alat";
export function SupplierTabs({ tabs, active, onChange, children }: { tabs: { id: SupplierTabId; label: string; count?: number }[]; active: SupplierTabId; onChange: (tab: SupplierTabId) => void; children?: ReactNode }) {
  return <Tabs value={active} onValueChange={value => onChange(value as SupplierTabId)}>
    <TabsList aria-label="Bagian panel supplier">
      {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id} className="px-2.5 transition-none sm:px-3">{tab.label}{tab.count != null && tab.count > 0 ? ` (${tab.count})` : ""}</TabsTrigger>)}
    </TabsList>
    {children}
  </Tabs>;
}
export function VariantStatusBadge({ status = "live", reason }: { status?: string; reason?: string }) {
  if (status === "live") return <Badge variant="success" title={reason || "Tampil di storefront"}>Live</Badge>;
  if (status === "hidden_loser") return <Badge variant="secondary" title={reason || "Anggota grup lain dipilih"}>{reason?.startsWith("Kalah slot") ? "Kalah slot" : "Kalah grup"}</Badge>;
  if (status === "hidden_nocatalog") return <Badge variant="secondary" title={reason || "Tanpa pasangan katalog"}>Belum dipetakan</Badge>;
  if (status === "hidden_soldout") return <Badge variant="warning" title={reason || "Stok kurang"}>Stok kurang</Badge>;
  return <Badge variant="secondary" title={reason || "Nonaktif manual"}>Nonaktif</Badge>;
}
