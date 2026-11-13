"use client";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { Badge } from "./ui/badge";
export type SupplierTabId = "ringkas" | "antrean" | "markup" | "aturan" | "audit" | "alat";
export function SupplierTabs({ tabs, active, onChange }: { tabs: { id: SupplierTabId; label: string; count?: number }[]; active: SupplierTabId; onChange: (tab: SupplierTabId) => void }) {
  return <Tabs value={active} onValueChange={value => onChange(value as SupplierTabId)}><TabsList aria-label="Bagian panel supplier">{tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}{tab.count != null && tab.count > 0 ? ` (${tab.count})` : ""}</TabsTrigger>)}</TabsList></Tabs>;
}
export function VariantStatusBadge({ status = "live", reason }: { status?: string; reason?: string }) {
  if (status === "live") return <Badge variant="success" title={reason || "Tampil di storefront"}>Live</Badge>;
  if (status === "hidden_loser") return <Badge variant="secondary" title={reason || "Produk kalah pasangan"}>Hidden: kalah</Badge>;
  if (status === "hidden_nocatalog") return <Badge variant="secondary" title={reason || "Tanpa pasangan katalog"}>Hidden: tanpa katalog</Badge>;
  if (status === "hidden_soldout") return <Badge variant="warning" title={reason || "Stok habis"}>Hidden: habis</Badge>;
  return <Badge variant="destructive" title={reason || "Nonaktif manual"}>Off</Badge>;
}
