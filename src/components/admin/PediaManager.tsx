"use client";
import { navigateWithDraftGuard, pushAdminHistory } from "./AdminWorkspace";

import { useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Button, Card, CardContent, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";
import { ProductsPanel } from "./pedia/ProductsPanel";
import { OrdersPanel } from "./pedia/OrdersPanel";
import { ServicesPanel } from "./pedia/ServicesPanel";
import { SettingsPanel, type SettingsData } from "./pedia/SettingsPanel";
import { usePanel, needsAction, productStatus, type Catalog, type ProviderHealth, type Row } from "./pedia/shared";

type Tab = "orders" | "products" | "services" | "settings";
const TABS: [Tab, string][] = [["orders", "Pesanan"], ["products", "Produk"], ["services", "Layanan IndoSMM"], ["settings", "Pengaturan"]];
function tabOf(value?: string | null): Tab | null {
  if (value === "credits") return "products";
  if (value === "curation") return "services";
  return TABS.some(([id]) => id === value) ? value as Tab : null;
}

export function PediaManager({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab | null>(() => tabOf(initialTab ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"))));
  const [compare, setCompare] = useState(() => initialTab === "curation" || (typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("tab") === "curation" || new URLSearchParams(window.location.search).get("view") === "compare"))), [onlyAction, setOnlyAction] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("status") === "action"), [editing, setEditing] = useState<number | null>(null);
  const previousInitial = useRef(initialTab);
  const catalog = usePanel<Catalog>("/api/admin/pedia/products", { products: [], tiers: [] });
  const orders = usePanel<{ rows: Row[] }>("/api/admin/pedia/orders?status=&supplier=", { rows: [] });
  const health = usePanel<{ providers: ProviderHealth[] }>("/api/admin/pedia/overview", { providers: [] });
  const settings = usePanel<SettingsData>("/api/admin/pedia/settings", { settings: {}, balance_history: [] });
  const attention = orders.data.rows.filter(needsAction).length;
  useEffect(() => { if (!orders.loading && tab === null) setTab(attention ? "orders" : "products"); }, [orders.loading, attention, tab]);
  useEffect(() => {
    if (previousInitial.current === initialTab) return;
    previousInitial.current = initialTab; setTab(tabOf(initialTab));
    const params = new URLSearchParams(window.location.search);
    setCompare(initialTab === "curation" || params.get("view") === "compare"); setOnlyAction(params.get("status") === "action");
  }, [initialTab]);
  useEffect(() => {
    const sync = () => { const params = new URLSearchParams(window.location.search), value = params.get("tab"); setTab(tabOf(value)); setCompare(value === "curation" || params.get("view") === "compare"); setOnlyAction(params.get("status") === "action"); };
    window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(next: Tab, action = false, comparison = false) {
    navigateWithDraftGuard(() => {
    setTab(next); setOnlyAction(action); setCompare(comparison);
    const url = new URL(window.location.href);
    url.searchParams.set("section", "pedia"); url.searchParams.set("tab", next);
    if (action) url.searchParams.set("status", "action"); else url.searchParams.delete("status");
    if (comparison) url.searchParams.set("view", "compare"); else url.searchParams.delete("view");
    pushAdminHistory(`${url.pathname}?${url.searchParams}${url.hash}`);
    });
  }
  const provider = health.data.providers.find(p => p.supplier === "indosmm"), balance = provider?.balance.value;
  const lowBalance = balance != null && settings.data.settings.pedia_balance_alert_rp != null && balance < settings.data.settings.pedia_balance_alert_rp;
  const sellable = catalog.data.products.filter(p => productStatus(p, catalog.data.tiers.filter(t => t.product_id === p.id)).label === "Siap dijual").length;
  return <div className="mt-5 min-w-0 space-y-6">
    <header>
      <h2 className="text-lg font-semibold text-admin-fg">Pedia</h2>
      <p className="mt-1 text-sm text-admin-muted">Supplier: IndoSMM</p>
    </header>
    <section aria-label="Ringkasan Pedia" className="grid gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs text-admin-muted">Saldo IndoSMM</p>
          <p className={`text-2xl font-semibold tabular-nums ${lowBalance ? "text-admin-warning" : "text-admin-fg"}`}>{health.loading ? "…" : balance == null ? "—" : formatRupiah(balance)}</p>
          {lowBalance && <p className="text-xs text-admin-warning">Di bawah ambang</p>}
          <p className="text-xs text-admin-muted">{provider?.balance.history?.[0]?.created_at ? `Diperiksa ${formatWibDateTime(provider.balance.history[0].created_at)}` : "Belum ada waktu pemeriksaan"}{provider?.balance.stale ? " · tersimpan" : ""}</p>
          <Button variant="outline" size="sm" disabled={health.loading} onClick={() => void health.load()}>Periksa</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs text-admin-muted">Produk dijual</p>
          <p className="text-2xl font-semibold tabular-nums text-admin-fg">{catalog.loading ? "…" : catalog.error ? "—" : `${sellable} / ${catalog.data.products.length}`}</p>
          <p className="text-xs text-admin-muted">Siap dijual / total produk</p>
        </CardContent>
      </Card>
      <Card className="transition-colors hover:border-admin-accent/40">
        <CardContent className="p-0">
          <Button variant="ghost" className="h-auto w-full flex-col items-start gap-1 rounded-xl p-4 text-left" onClick={() => navigate("orders", true)}>
            <span className="text-xs font-normal text-admin-muted">Pesanan perlu tindakan</span>
            <span className={`text-2xl font-semibold tabular-nums ${attention ? "text-admin-warning" : "text-admin-fg"}`}>{orders.loading ? "…" : orders.error ? "—" : attention}</span>
            <span className="text-xs font-normal text-admin-muted">Buka daftar tindakan</span>
          </Button>
        </CardContent>
      </Card>
    </section>
    <div className="overflow-x-auto">
      <Tabs value={tab ?? ""} onValueChange={value => navigate(value as Tab)}>
        <TabsList aria-label="Bagian Pedia" className="md:w-fit">
          {TABS.map(([id, label]) => <TabsTrigger key={id} value={id} aria-current={tab === id ? "page" : undefined}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
    </div>
    {tab === null && <div role="status" className="space-y-2 py-4"><Skeleton className="h-4 w-40" /><span className="sr-only">Memuat pesanan...</span></div>}
    {tab === "products" && <ProductsPanel catalog={catalog} editing={editing} onEdit={setEditing} onBrowse={() => navigate("services")} />}
    {tab === "orders" && <OrdersPanel panel={orders} onlyAction={onlyAction} />}
    {tab === "services" && <><ServicesPanel catalog={catalog.data} compare={compare} onCompare={value => navigate("services", false, value)} onAssigned={async id => { await catalog.load(); setEditing(id); navigate("products"); }} />{catalog.error && <div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">
      <p>Produk tujuan belum dimuat.</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => void catalog.load()}>Coba lagi</Button>
    </div>}</>}
    {tab === "settings" && <SettingsPanel health={health} settings={settings} />}
  </div>;
}
