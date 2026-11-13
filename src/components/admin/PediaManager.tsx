"use client";

import { useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { ProductsPanel } from "./pedia/ProductsPanel";
import { OrdersPanel } from "./pedia/OrdersPanel";
import { ServicesPanel } from "./pedia/ServicesPanel";
import { SettingsPanel, type SettingsData } from "./pedia/SettingsPanel";
import { BUTTON, usePanel, needsAction, productStatus, type Catalog, type ProviderHealth, type Row } from "./pedia/shared";

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
    setTab(next); setOnlyAction(action); setCompare(comparison);
    const url = new URL(window.location.href);
    url.searchParams.set("section", "pedia"); url.searchParams.set("tab", next);
    if (action) url.searchParams.set("status", "action"); else url.searchParams.delete("status");
    if (comparison) url.searchParams.set("view", "compare"); else url.searchParams.delete("view");
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams}${url.hash}`);
  }
  const provider = health.data.providers.find(p => p.supplier === "indosmm"), balance = provider?.balance.value;
  const lowBalance = balance != null && settings.data.settings.pedia_balance_alert_rp != null && balance < settings.data.settings.pedia_balance_alert_rp;
  const sellable = catalog.data.products.filter(p => productStatus(p, catalog.data.tiers.filter(t => t.product_id === p.id)).label === "Siap dijual").length;
  return <div className="mt-5 min-w-0 space-y-4 [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#00E5FF] [&_summary:focus-visible]:outline [&_summary:focus-visible]:outline-2 [&_summary:focus-visible]:outline-[#00E5FF]">
    <header><h2 className="font-display text-xl font-semibold text-white">Pedia</h2><p className="mt-1 text-xs text-white/55">Supplier: IndoSMM</p></header>
    <section aria-label="Ringkasan Pedia" className="grid grid-cols-[1.4fr_1fr_1fr] divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/[0.025] md:grid-cols-3">
      <div className="flex min-w-0 flex-col items-start justify-between gap-1 p-3 md:flex-row md:items-center md:gap-3"><div><p className="text-xs text-white/55">Saldo IndoSMM</p><p className={`mt-1 text-sm font-semibold ${lowBalance ? "text-amber-300" : "text-white"}`}>{health.loading ? "Memeriksa..." : balance == null ? "Belum tersedia" : formatRupiah(balance)}{lowBalance && <span className="mt-1 block text-[11px] font-normal">Di bawah ambang</span>}</p><p className="mt-1 text-[11px] text-white/45">{provider?.balance.history?.[0]?.created_at ? `Diperiksa ${formatWibDateTime(provider.balance.history[0].created_at)}` : "Belum ada waktu pemeriksaan"}{provider?.balance.stale ? " · tersimpan" : ""}</p></div><button className={`${BUTTON} mt-1 md:mt-0`} disabled={health.loading} onClick={() => void health.load()}>Periksa</button></div>
      <div className="p-3"><p className="text-xs text-white/55">Produk dijual</p><p className="mt-1 text-sm font-semibold text-white">{catalog.loading ? "Memuat..." : catalog.error ? "Belum tersedia" : `${sellable} / ${catalog.data.products.length}`}</p></div>
      <button className="min-w-0 p-3 text-left transition hover:bg-white/[0.04]" onClick={() => navigate("orders", true)}><span className="block text-xs text-white/55">Pesanan perlu tindakan</span><span className={`mt-1 block text-sm font-semibold ${attention ? "text-amber-300" : "text-white"}`}>{orders.loading ? "Memuat..." : orders.error ? "Belum tersedia" : `${attention} →`}</span></button>
    </section>
    <nav aria-label="Bagian Pedia" className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1 md:flex md:w-fit">{TABS.map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)} className={`min-h-11 rounded-lg px-4 text-xs font-semibold transition ${tab === id ? "bg-[#00E5FF] text-[#07101f]" : "text-white/60 hover:text-white"}`}>{label}</button>)}</nav>
    {tab === null && <p role="status" className="py-4 text-sm text-white/60">Memuat pesanan...</p>}
    {tab === "products" && <ProductsPanel catalog={catalog} editing={editing} onEdit={setEditing} onBrowse={() => navigate("services")} />}
    {tab === "orders" && <OrdersPanel panel={orders} onlyAction={onlyAction} />}
    {tab === "services" && <><ServicesPanel catalog={catalog.data} compare={compare} onCompare={value => navigate("services", false, value)} onAssigned={async id => { await catalog.load(); setEditing(id); navigate("products"); }} />{catalog.error && <p role="alert" className="text-sm text-red-300">Produk tujuan belum dimuat. <button className={BUTTON} onClick={() => void catalog.load()}>Muat ulang produk</button></p>}</>}
    {tab === "settings" && <SettingsPanel health={health} settings={settings} />}
  </div>;
}
