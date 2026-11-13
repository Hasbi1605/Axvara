"use client";
import { navigateWithDraftGuard, pushAdminHistory } from "./AdminWorkspace";

import { useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Button, Card, PageHeader, Skeleton, StatCard, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { ProductsPanel } from "./pedia/ProductsPanel";
import { OrdersPanel } from "./pedia/OrdersPanel";
import { ServicesPanel } from "./pedia/ServicesPanel";
import { SettingsPanel, type SettingsData } from "./pedia/SettingsPanel";
import { usePanel, needsAction, productStatus, type Catalog, type ProviderHealth, type Row } from "./pedia/shared";

type Tab = "action" | "products" | "services" | "settings";
const TABS: [Tab, string][] = [["action", "Perlu tindakan"], ["products", "Produk"], ["services", "Layanan IndoSMM"], ["settings", "Pengaturan"]];
/** Alias URL lama tetap bekerja: `tab=orders`/`tab=credits`/`tab=curation`. */
function tabOf(value?: string | null): Tab | null {
  if (value === "orders") return "action";
  if (value === "credits") return "products";
  if (value === "curation") return "services";
  return TABS.some(([id]) => id === value) ? value as Tab : null;
}

export function PediaManager({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab | null>(() => tabOf(initialTab ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"))));
  const [compare, setCompare] = useState(() => initialTab === "curation" || (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("tab") === "curation" || new URLSearchParams(window.location.search).get("view") === "compare"))), [editing, setEditing] = useState<number | null>(null);
  const previousInitial = useRef(initialTab);
  const catalog = usePanel<Catalog>("/api/admin/pedia/products", { products: [], tiers: [] });
  const orders = usePanel<{ rows: Row[] }>("/api/admin/pedia/orders?status=&supplier=", { rows: [] });
  const health = usePanel<{ providers: ProviderHealth[] }>("/api/admin/pedia/overview", { providers: [] });
  const settings = usePanel<SettingsData>("/api/admin/pedia/settings", { settings: {}, balance_history: [] });
  const attention = orders.data.rows.filter(needsAction).length;
  useEffect(() => { if (!orders.loading && tab === null) setTab(attention ? "action" : "products"); }, [orders.loading, attention, tab]);
  useEffect(() => {
    if (previousInitial.current === initialTab) return;
    previousInitial.current = initialTab; setTab(tabOf(initialTab));
    const params = new URLSearchParams(window.location.search);
    setCompare(initialTab === "curation" || params.get("view") === "compare");
  }, [initialTab]);
  useEffect(() => {
    const sync = () => { const params = new URLSearchParams(window.location.search), value = params.get("tab"); setTab(tabOf(value)); setCompare(value === "curation" || params.get("view") === "compare"); };
    window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(next: Tab, comparison = false) {
    navigateWithDraftGuard(() => {
    setTab(next); setCompare(comparison);
    const url = new URL(window.location.href);
    url.searchParams.set("section", "pedia"); url.searchParams.set("tab", next); url.searchParams.delete("status");
    if (comparison) url.searchParams.set("view", "compare"); else url.searchParams.delete("view");
    pushAdminHistory(`${url.pathname}?${url.searchParams}${url.hash}`);
    });
  }
  const provider = health.data.providers.find(p => p.supplier === "indosmm"), balance = provider?.balance.value;
  const lowBalance = balance != null && settings.data.settings.pedia_balance_alert_rp != null && balance < settings.data.settings.pedia_balance_alert_rp;
  const sellable = catalog.data.products.filter(p => productStatus(p, catalog.data.tiers.filter(t => t.product_id === p.id)).label === "Siap dijual").length;
  const total = catalog.data.products.length;
  return <div className="min-w-0 space-y-6">
    <PageHeader title="Pedia" description="Katalog layanan SMM dari supplier IndoSMM: produk, varian, harga, dan pesanan yang perlu tindakan." />
    <section aria-label="Ringkasan Pedia" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Card className="min-w-0 p-4">
        <p className="text-sm font-medium text-admin-muted">Saldo IndoSMM</p>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-admin-fg">{health.loading ? <Skeleton className="h-8 w-24" /> : health.error ? "—" : balance == null ? "Belum terbaca" : formatRupiah(balance)}</div>
        <p className="mt-1 text-xs text-admin-muted">
          {health.loading ? "Memuat saldo…" : provider?.balance.stale ? "Saldo tersimpan" : "Saldo terkini"}
          {provider?.balance.history?.[0]?.created_at ? ` · diperiksa ${formatWibDateTime(provider.balance.history[0].created_at)}` : ""}
          {lowBalance ? " · di bawah ambang" : ""}
        </p>
        <Button variant="outline" size="sm" className="mt-3" disabled={health.loading || health.busy} onClick={() => void health.load()}>Periksa</Button>
      </Card>
      <StatCard label="Produk siap dijual" value={catalog.loading ? <Skeleton className="h-8 w-16" /> : catalog.error ? "—" : sellable} hint={catalog.loading ? "Memuat produk…" : `dari ${total} produk`} />
      <StatCard label="Perlu tindakan" value={orders.loading ? <Skeleton className="h-8 w-16" /> : orders.error ? "—" : attention} hint="Pesanan Pedia yang menunggu admin" />
    </section>
    <Tabs value={tab ?? ""} onValueChange={value => navigate(value as Tab)}>
      <TabsList aria-label="Bagian Pedia" className="md:w-fit">
        {TABS.map(([id, label]) => <TabsTrigger key={id} value={id} aria-current={tab === id ? "page" : undefined}>{label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
    {tab === null && <div role="status" className="flex items-center gap-2 py-4 text-sm text-admin-muted"><Skeleton className="h-4 w-40" /><span>Memuat pesanan…</span></div>}
    {tab === "products" && <ProductsPanel catalog={catalog} editing={editing} onEdit={setEditing} onBrowse={() => navigate("services")} />}
    {tab === "action" && <OrdersPanel panel={orders} />}
    {tab === "services" && <><ServicesPanel catalog={catalog.data} compare={compare} onCompare={value => navigate("services", value)} onAssigned={async id => { await catalog.load(); setEditing(id); navigate("products"); }} />{catalog.error && <div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">
      <p>Produk tujuan belum dimuat.</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => void catalog.load()}>Coba lagi</Button>
    </div>}</>}
    {tab === "settings" && <SettingsPanel health={health} settings={settings} />}
  </div>;
}
