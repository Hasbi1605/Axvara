"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { pediaMargin } from "@/lib/pedia/pricing";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PEDIA_PROVIDERS, type PediaProvider } from "@/lib/pedia/proxy";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { ProductCard, catalogCard } from "@/components/pedia/PlatformGrid";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import { IosIcon } from "@/components/ui/IosIcon";
import { AdminStatusSwitch } from "./AdminStatusSwitch";

type SubTab = "products" | "services" | "orders" | "credits" | "settings";
type Product = {
  id: number; slug: string; platform: string; metric: string; target_kind: string;
  name: string; tagline: string | null; description_md?: string | null;
  checklist_json?: string; packages_json: string; step: number;
  sort_order: number; is_active: number; is_featured: number;
};
type Tier = {
  id: number; product_id: number; tier: string; label_note: string | null;
  supplier: PediaProvider; supplier_service_id: number; backup_service_id: number | null;
  price_group: string; markup_pct: number; min_profit_rp: number;
  refill_days: number; eta_start: string | null; eta_finish: string | null;
  package_prices_json: string; is_active: number; auto_disabled_reason: string | null;
  live_rate?: number | null; live_min?: number | null; live_max?: number | null;
  live_present?: number | null; live_name?: string | null; live_type?: string | null;
  live_api_refill?: number | null;
};
type Row = Record<string, unknown>;
type Catalog = { products: Product[]; tiers: Tier[] };
const TABS: [SubTab, string][] = [["products", "Produk"], ["services", "Layanan Supplier"], ["orders", "Pesanan"], ["credits", "Kredit"], ["settings", "Pengaturan"]];
const TIER_ORDER = ["hemat", "standar", "premium"];
const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "threads", "shopee", "spotify", "x", "telegram"];
const STATUS: Record<string, string> = {
  awaiting_payment: "Menunggu pembayaran", queued: "Antrean", submitting: "Sedang dikirim",
  submitted: "Diproses", in_progress: "Berjalan", completed: "Selesai", partial: "Selesai sebagian",
  canceled: "Dibatalkan", needs_check: "Perlu diperiksa", expired: "Kedaluwarsa",
};
const INPUT = "mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition focus:border-[#00E5FF]/50 [color-scheme:dark]";
const BUTTON = "inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50";
const PRIMARY = "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#00E5FF] px-4 text-sm font-bold text-[#07101f] transition hover:bg-[#00E5FF]/90 disabled:opacity-50";
const EDIT = "inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-bold text-[#080C1E] shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40";
const PROVIDER_NAMES = { providersmm: "ProviderSMM", indosmm: "IndoSMM" };
type ServiceSelection = { supplier: PediaProvider; service_id: number };
type ProviderHealth = { supplier: PediaProvider; balance: { value: number | null; stale: boolean }; error: string | null; pricing_verified: boolean; last_sync_at: string | null };

function parse<T>(raw: unknown, fallback: T): T {
  try { return JSON.parse(String(raw)) ?? fallback; } catch { return fallback; }
}
function packagesOf(p: Product): number[] {
  const values = parse<unknown>(p.packages_json, []);
  return Array.isArray(values) ? values.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}
function usablePackages(p: Product, t: Tier): number[] {
  const prices = parse<Record<string, number>>(t.package_prices_json, {});
  return packagesOf(p).filter((qty) => PEDIA_PROVIDERS.includes(t.supplier) && qty % p.step === 0 && t.live_present === 1 && t.live_type === "Default" &&
    t.live_rate != null && Number.isFinite(Number(t.live_rate)) && Number(t.live_rate) > 0 &&
    t.live_min != null && t.live_max != null && qty >= t.live_min && qty <= t.live_max &&
    Number.isFinite(Number(prices[qty])) && Number(prices[qty]) > 0 && pediaMargin({ supplierRatePer1k: Number(t.live_rate), quantity: qty, sellPrice: Number(prices[qty]) }) >= t.min_profit_rp);
}
function availability(p: Product, tiers: Tier[]) {
  return tiers.some((t) => t.is_active && usablePackages(p, t).length) ? "Siap dijual" : "Belum siap";
}
function tabOf(value?: string | null): SubTab {
  return TABS.some(([id]) => id === value) ? value as SubTab : "products";
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const messages: Record<string, string> = {
      unauthorized: "Sesi admin berakhir. Masuk kembali.", save_failed: "Perubahan gagal disimpan.", load_failed: "Data gagal dimuat. Coba lagi.",
      not_found: "Data tidak ditemukan. Muat ulang daftar.", proxy_failed: "Supplier belum dapat dihubungi. Coba lagi.",
      max_attempts: "Batas percobaan tercapai.", not_needs_check: "Status pesanan sudah berubah. Muat ulang daftar.",
      reprice_failed: "Perubahan tersimpan, tetapi harga belum berhasil diperbarui. Muat ulang dan tarik ulang layanan.",
      save_partial: "Sebagian pengaturan tersimpan. Muat ulang sebelum menyimpan kembali.",
      unsupported_currency: "Mata uang akun belum terverifikasi IDR. Harga rupiah tidak boleh digunakan.",
      pricing_unverified: "Satuan tarif per 1.000 IndoSMM belum terverifikasi di VPS.",
      provider_unavailable: "Provider tidak dapat dihubungi. Mapping belum disimpan.",
      service_unavailable: "Layanan tidak tersedia atau tidak kompatibel dengan link dan jumlah.",
      supplier_service_pair_required: "Pilih supplier dan ID layanan bersama.",
      reconcile_required: "Hasil pengiriman ambigu. Rekonsiliasi ID order di provider asal; jangan kirim ulang atau batalkan kredit secara buta.",
      supplier_order_conflict: "ID order sudah terhubung ke pesanan lain pada provider ini.",
      sync_failed: "Sinkronisasi gagal dan mungkin tersimpan sebagian. Muat ulang data.",
    };
    const error = new Error(messages[data?.error] || (Array.isArray(data?.errors) && data.errors.length ? "Sinkronisasi hanya berhasil sebagian. Muat ulang sebelum mencoba lagi." : `Permintaan gagal${data?.error ? `: ${data.error}` : ". Coba lagi."}`));
    Object.assign(error, { saved: data?.saved === true, id: data?.id });
    throw error;
  }
  return data as T;
}

// Each panel owns its request lifecycle; obsolete searches cannot replace newer results.
function usePanel<T>(url: string, initial: T) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const generation = useRef(0);
  const writing = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = await request<T>(url);
      if (current === generation.current) setData(next);
      return true;
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "Gagal memuat data.");
      return false;
    } finally { if (current === generation.current) setLoading(false); }
  }, [url]);
  useEffect(() => { const pending = generation; void load(); return () => { pending.current++; }; }, [load]);
  async function write(path: string, body: Row, message: string, method = "PUT") {
    if (writing.current) return null;
    writing.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const result = await request<Row>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const refreshed = await load();
      if (Array.isArray(result.errors) && result.errors.length) throw new Error("Sinkronisasi hanya berhasil sebagian. Muat ulang sebelum mencoba lagi.");
      setSuccess(`${message}${refreshed ? "" : " Daftar belum berhasil dimuat ulang."}`);
      return result;
    } catch (e) {
      const saved = e instanceof Error && "saved" in e && e.saved === true;
      await load();
      setError(e instanceof Error ? e.message : "Gagal menyimpan perubahan.");
      return saved ? { saved: true, id: "id" in e ? e.id : undefined } : null;
    }
    finally { writing.current = false; setBusy(false); }
  }
  return { data, loading, busy, error, success, load, write, setError, setSuccess };
}
function Feedback({ panel }: { panel: { loading: boolean; busy: boolean; error: string; success: string; load: () => Promise<boolean> } }) {
  return <div aria-live="polite" className="space-y-2 text-sm">
    {panel.loading && <p role="status" className="text-white/65">Memuat data...</p>}
    {panel.busy && <p role="status" className="text-[#00E5FF]">Menyimpan perubahan...</p>}
    {panel.error && <p role="alert" className="text-red-300">{panel.error} <button type="button" disabled={panel.busy || panel.loading} onClick={() => void panel.load()} className="underline">Muat ulang</button></p>}
    {panel.success && <p role="status" className="text-emerald-300">{panel.success}</p>}
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 text-xs font-medium text-white/65">{label}{children}</label>;
}
function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="mt-4 min-w-0">
    <header className="mb-4"><h3 className="text-sm font-semibold text-white">{title}</h3><p className="mt-1 text-xs leading-5 text-white/40">{description}</p></header>{children}
  </section>;
}
function DataTable({ title, columns, children, minWidth = "min-w-[760px]" }: { title: string; columns: string[]; children: ReactNode; minWidth?: string }) {
  return <div className="ax-glass min-w-0 overflow-hidden rounded-[20px]">
    <div className="overflow-x-auto" role="region" aria-label={title} tabIndex={0}>
      <table className={`w-full text-left text-sm text-white/60 ${minWidth}`}>
        <caption className="sr-only">{title}</caption>
        <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.08em] text-white/40"><tr>{columns.map(column => <th key={column} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column}</th>)}</tr></thead>
        <tbody className="divide-y divide-white/5 [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_tr]:transition-colors [&_tr:hover]:bg-white/[0.03]">{children}</tbody>
      </table>
    </div>
  </div>;
}
function SupplierField({ value, onChange, label = "Supplier" }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <Field label={label}><select className={INPUT} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Semua supplier</option>{PEDIA_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_NAMES[provider]}</option>)}</select></Field>;
}

export function PediaManager({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<SubTab>(tabOf(initialTab));
  const catalog = usePanel<Catalog>("/api/admin/pedia/products", { products: [], tiers: [] });
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [selectedService, setSelectedService] = useState<ServiceSelection | null>(null);
  useEffect(() => { setTab(tabOf(initialTab)); }, [initialTab]);
  useEffect(() => {
    const sync = () => setTab(tabOf(new URLSearchParams(window.location.search).get("tab")));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(next: SubTab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", "pedia"); url.searchParams.set("tab", next);
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams}${url.hash}`);
  }
  const tiersFor = (id: number) => catalog.data.tiers.filter((t) => t.product_id === id).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  const product = catalog.data.products.find((p) => p.id === editing);
  const filtered = catalog.data.products.filter((p) =>
    (!supplier || tiersFor(p.id).some((t) => t.supplier === supplier)) && (!platform || platform === p.platform) && (!status || (status === "Nonaktif" ? !p.is_active : status === availability(p, tiersFor(p.id)))) &&
    `${p.name} ${p.slug} ${p.platform} ${p.metric} ${tiersFor(p.id).map((t) => `${t.supplier}:${t.supplier_service_id}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="mt-5 min-w-0 space-y-4">
    <header><h2 className="font-display text-xl font-semibold text-white">Pedia</h2><p className="mt-1 text-xs text-white/40">Kelola produk kurasi, layanan supplier, pesanan, dan kredit.</p></header>
    <nav aria-label="Bagian Pedia" className="flex w-fit max-w-full flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
      {TABS.map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => navigate(id)} className={`min-h-9 whitespace-nowrap rounded-lg px-4 text-xs font-semibold transition ${tab === id ? "bg-[#00E5FF] text-[#07101f]" : "text-white/55 hover:text-white"}`}>{label}</button>)}
    </nav>
    {tab === "products" && <Panel title={product ? `Edit ${product.name}` : "Produk kurasi"} description={product ? "Simpan informasi produk dan setiap tingkat secara terpisah." : "Katalog, harga, layanan, dan status produk Pedia."}>
      <Feedback panel={catalog} />
      {creating && <ProductEditor product={{ id: 0, slug: "", platform: "instagram", metric: "followers", target_kind: "profile", name: "", tagline: "", packages_json: "[100,250,500,1000]", step: 1, sort_order: 0, is_active: 0, is_featured: 0 }} tiers={[]} busy={catalog.busy} onSave={async (body, message) => {
        const { id: _id, ...fields } = body; void _id;
        const result = await catalog.write("/api/admin/pedia/products", { ...fields, is_active: 0, is_featured: 0 }, message, "POST");
        if (result?.id) { setCreating(false); setEditing(Number(result.id)); }
        return result;
      }} onCreateTier={async () => null} onError={catalog.setError} onBrowse={() => { setCreating(false); navigate("services"); }} />}
      {creating && <button className={`${BUTTON} mb-3`} disabled={catalog.busy} onClick={() => setCreating(false)}>Batal buat produk</button>}
      {!creating && (product ? <>
        <button disabled={catalog.busy} onClick={() => setEditing(null)} className={`${BUTTON} my-3`}>Kembali ke daftar</button>
        <ProductEditor key={product.id} product={product} tiers={tiersFor(product.id)} busy={catalog.busy} onSave={(body, message) => catalog.write("/api/admin/pedia/products", body, message)} onCreateTier={(body) => catalog.write("/api/admin/pedia/products", body, "Tingkat dibuat. Periksa harga sebelum aktivasi.", "POST")} onError={catalog.setError} onBrowse={() => { setSelectedService(null); navigate("services"); }} />
      </> : <>
        <div className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_150px_160px_145px_auto]">
          <Field label="Cari produk"><input className={INPUT} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama, slug, atau ID layanan" /></Field>
          <Field label="Platform"><select className={INPUT} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="">Semua platform</option>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <SupplierField value={supplier} onChange={setSupplier} />
          <Field label="Ketersediaan"><select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua status</option>{["Siap dijual", "Belum siap", "Nonaktif"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <button className={`${PRIMARY} self-end`} aria-label="Buat produk" disabled={catalog.busy} onClick={() => setCreating(true)}><IosIcon name="plus" size={14} tint="black" />Buat produk</button>
        </div>
        {(query || platform || status || supplier) && <button className={`${BUTTON} mb-3`} onClick={() => { setQuery(""); setPlatform(""); setStatus(""); setSupplier(""); }}>Hapus filter</button>}
        <p className="mb-3 text-xs text-white/65">{filtered.length} dari {catalog.data.products.length} produk</p>
        {!catalog.loading && !catalog.error && catalog.data.products.length === 0 && <div className="space-y-3"><p className="text-sm text-white/65">Belum ada produk kurasi. Kurasi awal dimuat nonaktif.</p><button className={PRIMARY} disabled={catalog.busy} onClick={() => void catalog.write("/api/admin/pedia/products", { action: "seed" }, "Kurasi awal dimuat.", "POST")}>Muat kurasi awal</button></div>}
        {!catalog.loading && catalog.data.products.length > 0 && !filtered.length && <p className="text-sm text-white/65">Tidak ada produk yang cocok dengan filter.</p>}
        <DataTable title="Produk Pedia" columns={["Produk", "Platform", "Layanan supplier", "Harga mulai", "Kesiapan", "Aktif / Aksi"]}>
          {filtered.map((p) => {
            const pt = tiersFor(p.id), ready = availability(p, pt);
            const prices = pt.filter((t) => t.is_active).flatMap((t) => usablePackages(p, t).map((qty) => Number(parse<Record<string, number>>(t.package_prices_json, {})[qty])));
            return <tr key={p.id}>
              <td className="min-w-[230px]"><p className="font-semibold text-white">{p.name}</p><p className="mt-1 text-xs text-white/40">/{p.slug} · {p.is_active ? "Terbit" : "Draf"}</p>{p.is_featured ? <span className="mt-1 inline-block text-xs text-amber-300">Pilihan AXVARA</span> : null}</td>
              <td className="text-xs capitalize">{p.platform}</td>
              <td className="min-w-[180px] text-xs leading-5">{pt.length ? pt.map(t => <p key={t.id}>{PROVIDER_NAMES[t.supplier]} #{t.supplier_service_id}</p>) : "Belum ada layanan"}</td>
              <td className="whitespace-nowrap text-xs font-semibold text-white">{prices.length ? formatRupiah(Math.min(...prices)) : "Belum ada harga"}</td>
              <td className={`whitespace-nowrap text-xs ${ready === "Siap dijual" ? "text-emerald-300" : "text-amber-300"}`}>{ready}</td>
              <td><div className="flex items-center justify-end gap-3" role="group" aria-label={`Aksi ${p.name}`}>
                <AdminStatusSwitch checked={Boolean(p.is_active)} label={`${p.is_active ? "Nonaktifkan" : "Aktifkan"} ${p.name}`} disabled={catalog.busy || catalog.loading} busy={catalog.busy} onChange={() => void catalog.write("/api/admin/pedia/products", { id: p.id, is_active: p.is_active ? 0 : 1 }, `${p.name} ${p.is_active ? "dinonaktifkan" : "diaktifkan"}.`)} />
                <button className={EDIT} onClick={() => setEditing(p.id)} aria-label={`Edit ${p.name}`}><IosIcon name="edit" size={12} tint="black" />Edit</button>
              </div></td>
            </tr>;
          })}
        </DataTable>
      </>)}
    </Panel>}
    {tab === "services" && <PediaServicesPanel catalog={catalog.data} selected={selectedService} onSelect={setSelectedService} onAssigned={async (id) => { await catalog.load(); setEditing(id); navigate("products"); }} />}
    {tab === "orders" && <PediaOrdersPanel />}
    {tab === "credits" && <PediaCreditsPanel />}
    {tab === "settings" && <PediaSettingsPanel />}
  </div>;
}

function ProductEditor({ product: p, tiers, busy, onSave, onCreateTier, onError, onBrowse }: {
  product: Product; tiers: Tier[]; busy: boolean;
  onSave: (body: Row, message: string) => Promise<Row | null>; onError: (message: string) => void; onBrowse: () => void;
  onCreateTier: (body: Row) => Promise<Row | null>;
}) {
  const [checklist, setChecklist] = useState<Row[]>(() => parse<Row[]>(p.checklist_json, []));
  useEffect(() => { setChecklist(parse<Row[]>(p.checklist_json, [])); }, [p.checklist_json]);
  function saveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const packages = String(f.get("packages")).split(/[,\s]+/).filter(Boolean).map(Number);
    const step = Number(f.get("step"));
    const checks = checklist.map((item, i) => ({ ...item, id: item.id, label: String(f.get(`check_label_${i}`) ?? ""), help: String(f.get(`check_help_${i}`) ?? "") }));
    if (!Number.isSafeInteger(step) || step < 1 || !packages.length || packages.some((q) => !Number.isSafeInteger(q) || q < 1 || q % step !== 0)) return onError("Isi paket dengan bilangan positif yang merupakan kelipatan jumlah.");
    if (checks.some((c) => !c.label.trim() || typeof c.id !== "string")) return onError("Setiap poin checklist harus memiliki teks dan ID yang valid.");
    const body: Row = { id: p.id, packages_json: JSON.stringify([...new Set(packages)]), checklist_json: JSON.stringify(checks), is_active: f.has("is_active") ? 1 : 0, is_featured: f.has("is_featured") ? 1 : 0 };
    for (const key of ["name", "slug", "platform", "metric", "target_kind", "tagline", "description_md"]) body[key] = String(f.get(key) ?? "");
    body.step = step; body.sort_order = Number(f.get("sort_order"));
    void onSave(body, "Produk tersimpan.");
  }
  const text = (key: keyof Product, label: string, max: number, required = false) => <Field label={label}><input name={key} defaultValue={String(p[key] ?? "")} maxLength={max} required={required} className={INPUT} /></Field>;
  const previewTiers = tiers.map((t) => {
    const prices = parse<Record<string, number>>(t.package_prices_json, {});
    return { id: t.id, tier: t.tier, label_note: t.label_note, refill_days: t.refill_days, eta_start: t.eta_start, eta_finish: t.eta_finish,
      prices: Object.fromEntries(usablePackages(p, t).map((qty) => [qty, Number(prices[qty])])) };
  }).filter((t) => Object.keys(t.prices).length > 0);
  const previewProduct: PediaCatalogProduct = {
    slug: p.slug, platform: p.platform, metric: p.metric, target_kind: p.target_kind, name: p.name,
    tagline: p.tagline, description_md: p.description_md, step: p.step, is_featured: p.is_featured,
    checklist: parse<PediaCatalogProduct["checklist"]>(p.checklist_json, []), tiers: previewTiers,
    packages: packagesOf(p).filter((qty) => previewTiers.some((t) => t.prices[qty] > 0)),
    min_price: previewTiers.length ? Math.min(...previewTiers.flatMap((t) => Object.values(t.prices))) : null,
    image: null,
  };
  return <div className="space-y-5">
    <form key={JSON.stringify(p)} onSubmit={saveProduct} aria-label="Edit produk" className="space-y-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-white">Informasi produk</legend>
        {text("name", "Nama produk", 120, true)}{text("slug", "Slug", 80, true)}
        {text("platform", "Platform produk", 30, true)}{text("metric", "Jenis layanan (metric)", 30, true)}{text("target_kind", "Jenis target", 30, true)}{text("tagline", "Tagline (nonpublik)", 200)}
        <Field label="Paket jumlah (pisahkan dengan koma)"><input name="packages" required defaultValue={packagesOf(p).join(", ")} className={INPUT} /></Field>
        <Field label="Kelipatan jumlah"><input name="step" type="number" required min={1} max={100000} defaultValue={p.step} className={INPUT} /></Field>
        <Field label="Urutan produk"><input name="sort_order" type="number" required min={0} max={100000} defaultValue={p.sort_order} className={INPUT} /></Field>
        <div className="flex flex-wrap items-center gap-4 text-sm text-white/80"><label className="flex min-h-11 items-center gap-2"><input name="is_active" type="checkbox" disabled={!p.id} defaultChecked={!!p.is_active} />Terbit</label><label className="flex min-h-11 items-center gap-2"><input name="is_featured" type="checkbox" disabled={!p.id} defaultChecked={!!p.is_featured} />Produk unggulan</label></div>
        <Field label="Deskripsi (nonpublik)"><textarea name="description_md" defaultValue={p.description_md ?? ""} maxLength={5000} rows={4} className={INPUT} /></Field>
        <div className="space-y-3 sm:col-span-2"><h4 className="text-sm font-semibold text-white">Checklist sebelum bayar</h4>{checklist.map((item, i) => <div key={String(item.id)} className="grid items-end gap-3 border-t border-white/10 pt-3 sm:grid-cols-[1fr_1fr_auto]"><Field label={`Poin checklist ${i + 1}`}><input name={`check_label_${i}`} required maxLength={500} defaultValue={String(item.label ?? "")} className={INPUT} /></Field><Field label={`Bantuan checklist ${i + 1}`}><textarea name={`check_help_${i}`} maxLength={2000} rows={2} defaultValue={String(item.help ?? "")} className={INPUT} /></Field><button type="button" className={BUTTON} onClick={() => setChecklist(checklist.filter((_, index) => index !== i))} aria-label={`Hapus poin checklist ${i + 1}`}>Hapus</button></div>)}<button type="button" className={BUTTON} onClick={() => setChecklist([...checklist, { id: `check_${Date.now()}`, label: "" }])}>Tambah poin checklist</button><p className="text-xs text-white/65">ID, gambar, dan field tambahan dari checklist lama tetap dipertahankan.</p></div>
      </fieldset>
      <div className="sticky bottom-0 z-10 border-t border-white/10 bg-[#080C1E] py-3"><button className={PRIMARY} disabled={busy}>{busy ? "Menyimpan..." : "Simpan produk"}</button></div>
    </form>
    {!!p.id && <section aria-label="Pratinjau produk" className="space-y-2 border-t border-white/10 pt-4 text-sm text-white/80">
      <h4 className="font-semibold text-white">Pratinjau tersimpan</h4><p>{p.name} / {p.is_active ? "Terbit" : "Draf"} / {p.is_featured ? "Pilihan AXVARA" : "Katalog penuh"} / {availability(p, tiers)}</p>
      <p className="text-xs text-white/65">Preview hanya memakai data tersimpan, bukan input yang belum disimpan. Tingkat nonaktif dengan paket layak ikut ditampilkan untuk kurasi. Draf tetap privat; navigasi dan pemesanan dinonaktifkan.</p>
      <div className="max-w-sm" onClickCapture={(e) => e.preventDefault()}><ProductCard p={catalogCard(previewProduct)} /></div>
      {!previewTiers.length && <p className="text-xs text-amber-300">Belum ada paket layak untuk ditampilkan. Periksa mapping, batas jumlah, harga, dan margin tingkat.</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 font-semibold text-white">Pratinjau detail &amp; pesanan tersimpan</summary>
        <OrderClient key={JSON.stringify(previewProduct)} product={previewProduct} initialTarget="" ordersEnabled={false} embedded />
      </details>
    </section>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><h4 className="font-semibold text-white">Tingkat kualitas</h4><button type="button" disabled={busy} className={BUTTON} onClick={onBrowse}>Cari layanan supplier</button></div>
    {!tiers.length && <p className="text-sm text-white/65">Belum ada tingkat. Buat tingkat setelah produk tersimpan.</p>}
    {!!p.id && tiers.length < 3 && <details className="border-b border-white/10 pb-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white">Buat tingkat</summary><form aria-label="Buat tingkat" className="space-y-3" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      void onCreateTier({ kind: "tier", product_id: p.id, tier: String(f.get("tier")), supplier: String(f.get("supplier")), supplier_service_id: Number(f.get("supplier_service_id")), price_group: String(f.get("price_group")), markup_pct: Number(f.get("markup_pct")), min_profit_rp: Number(f.get("min_profit_rp")), refill_days: Number(f.get("refill_days")), is_active: 0 });
    }}><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <Field label="Tingkat baru"><select name="tier" className={INPUT}>{TIER_ORDER.filter((name) => !tiers.some((t) => t.tier === name)).map((name) => <option key={name}>{name}</option>)}</select></Field>
      <Field label="Supplier tingkat baru"><select name="supplier" className={INPUT}>{PEDIA_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_NAMES[provider]}</option>)}</select></Field>
      <Field label="ID layanan tingkat baru"><input name="supplier_service_id" type="number" required min={1} className={INPUT} /></Field>
      <Field label="Kelompok harga baru"><select name="price_group" className={INPUT}>{["G1", "G2", "G3"].map((group) => <option key={group}>{group}</option>)}</select></Field>
      <Field label="Markup baru (%)"><input name="markup_pct" type="number" required min={0} max={1000} step="any" defaultValue={20} className={INPUT} /></Field>
      <Field label="Minimum untung baru (Rp)"><input name="min_profit_rp" type="number" required min={0} max={10000000} defaultValue={1000} className={INPUT} /></Field>
      <Field label="Masa refill baru (hari)"><input name="refill_days" type="number" required min={0} max={365} defaultValue={0} className={INPUT} /></Field>
    </fieldset><p className="text-xs text-white/65">Tingkat dibuat nonaktif. ID layanan diverifikasi pada supplier terpilih; periksa modal, harga, ETA, dan ketentuan sebelum aktivasi.</p><button className={PRIMARY} disabled={busy}>Buat tingkat nonaktif</button></form></details>}
    {tiers.map((t) => <details key={t.id} className="border-b border-white/10 pb-3">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white"><span className="capitalize">{t.tier}</span> <span className="font-normal text-white/65">/ {PROVIDER_NAMES[t.supplier]} #{t.supplier_service_id} / {t.is_active ? usablePackages(p, t).length ? "Siap" : "Belum siap" : "Nonaktif"}</span></summary>
      {t.auto_disabled_reason && <p role="status" className="mb-3 text-sm text-amber-300">Nonaktif otomatis: {t.auto_disabled_reason === "margin" ? "margin tidak mencukupi" : "layanan supplier hilang"}. Aktivasi manual membuka kunci ini; periksa harga dan layanan terlebih dahulu.</p>}
      <p className="mb-3 break-words text-xs text-white/65">{t.live_name ?? "Layanan belum tersinkron"} / Batas {t.live_min ?? "-"} sampai {t.live_max ?? "-"}</p>
      <p className="mb-3 text-xs text-white/65">API refill: {t.live_api_refill === 1 ? "Didukung" : t.live_api_refill === 0 ? "Tidak didukung" : "Belum diketahui"}. Masa refill dikurasi terpisah, bukan garansi penuh. Mapping baru hanya untuk order baru; order lama memakai snapshot supplier asal.</p>
      <form key={JSON.stringify(t)} aria-label={`Edit tingkat ${t.tier}`} onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const body: Row = { kind: "tier", id: t.id, is_active: f.has("is_active") ? 1 : 0 };
        body.supplier = String(f.get("supplier"));
        for (const k of ["label_note", "price_group", "eta_start", "eta_finish"]) body[k] = String(f.get(k) ?? "");
        for (const k of ["supplier_service_id", "markup_pct", "min_profit_rp", "refill_days"]) body[k] = Number(f.get(k));
        body.backup_service_id = f.get("backup_service_id") ? Number(f.get("backup_service_id")) : null;
        void onSave(body, `Tingkat ${t.tier} tersimpan. Periksa status dan harga hasil pembaruan.`);
      }} className="space-y-4">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Catatan kualitas"><input name="label_note" maxLength={120} defaultValue={t.label_note ?? ""} className={INPUT} /></Field>
          <Field label="Supplier utama"><select name="supplier" defaultValue={t.supplier} className={INPUT} onChange={(e) => {
            const form = e.currentTarget.form;
            if (form) { (form.elements.namedItem("supplier_service_id") as HTMLInputElement).value = ""; (form.elements.namedItem("backup_service_id") as HTMLInputElement).value = ""; }
          }}>{PEDIA_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_NAMES[provider]}</option>)}</select></Field>
          <Field label="ID layanan utama"><input name="supplier_service_id" type="number" min={1} required defaultValue={t.supplier_service_id} className={INPUT} /></Field>
          <Field label="ID layanan cadangan"><input name="backup_service_id" type="number" min={1} defaultValue={t.backup_service_id ?? ""} className={INPUT} /></Field>
          <Field label="Kelompok harga"><select name="price_group" defaultValue={t.price_group} className={INPUT}>{["G1", "G2", "G3"].map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Markup (%)"><input name="markup_pct" type="number" step="any" min={0} max={1000} required defaultValue={t.markup_pct} className={INPUT} /></Field>
          <Field label="Minimum untung (Rp)"><input name="min_profit_rp" type="number" min={0} max={10000000} required defaultValue={t.min_profit_rp} className={INPUT} /></Field>
          <Field label="Masa refill kurasi (hari)"><input name="refill_days" type="number" min={0} max={365} required defaultValue={t.refill_days} className={INPUT} /></Field>
          <Field label="Estimasi mulai"><input name="eta_start" maxLength={40} defaultValue={t.eta_start ?? ""} className={INPUT} /></Field>
          <Field label="Estimasi selesai"><input name="eta_finish" maxLength={40} defaultValue={t.eta_finish ?? ""} className={INPUT} /></Field>
          <label className="flex min-h-11 items-center gap-2 text-sm text-white/80"><input name="is_active" type="checkbox" defaultChecked={!!t.is_active} />Tingkat aktif</label>
        </fieldset>
        <p className="text-xs text-white/40">Modal, harga dan margin tersimpan. Pratinjau diperbarui setelah simpan.</p><DataTable title={`Harga tingkat ${t.tier}`} columns={["Jumlah", "Modal", "Harga", "Margin", "Status paket"]} minWidth="min-w-[540px]">{packagesOf(p).map((qty) => {
          const price = Number(parse<Record<string, number>>(t.package_prices_json, {})[qty]);
          const margin = t.live_rate == null || !Number.isFinite(price) ? null : pediaMargin({ supplierRatePer1k: Number(t.live_rate), quantity: qty, sellPrice: price });
          return <tr key={qty} className="border-t border-white/5"><td className="py-2">{qty}</td><td>{t.live_rate == null ? "-" : formatRupiah(Number(t.live_rate) * qty / 1000)}</td><td>{price > 0 ? formatRupiah(price) : "Belum dihitung"}</td><td className={margin != null && margin < t.min_profit_rp ? "text-red-300" : ""}>{margin == null ? "-" : formatRupiah(Math.round(margin))}</td><td>{usablePackages(p, t).includes(qty) ? "Dalam batas" : "Tidak tersedia"}</td></tr>;
        })}</DataTable>
        <button disabled={busy} className={PRIMARY}>Simpan tingkat {t.tier}</button>
      </form>
    </details>)}
  </div>;
}

function PediaServicesPanel({ catalog, selected, onSelect, onAssigned }: { catalog: Catalog; selected: ServiceSelection | null; onSelect: (id: ServiceSelection | null) => void; onAssigned: (id: number) => Promise<void> }) {
  const [q, setQ] = useState(""), [search, setSearch] = useState(""), [platform, setPlatform] = useState(""), [page, setPage] = useState(1);
  const [indonesia, setIndonesia] = useState(false), [garansi, setGaransi] = useState(false), [type, setType] = useState("");
  const [productId, setProductId] = useState("");
  const [supplier, setSupplier] = useState("providersmm"), [compatible, setCompatible] = useState(true), [mapping, setMapping] = useState("");
  useEffect(() => { const timer = setTimeout(() => { setSearch(q); setPage(1); }, 300); return () => clearTimeout(timer); }, [q]);
  const params = new URLSearchParams({ q: search, platform, supplier, compatible: compatible ? "1" : "0", mapping, page: String(page), indonesia: indonesia ? "1" : "0", garansi: garansi ? "1" : "0", type });
  const panel = usePanel<{ rows: Row[]; total: number; diff: Record<string, string> }>(`/api/admin/pedia/services?${params}`, { rows: [], total: 0, diff: {} });
  const [confirmSync, setConfirmSync] = useState(false);
  return <Panel title="Layanan supplier" description="Cari layanan, bandingkan biaya dan batas jumlah, lalu hubungkan ke tingkat produk yang sudah ada.">
    <Feedback panel={panel} />
    <div className="my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_160px_160px_160px_160px]">
      <Field label="Cari layanan"><input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nama atau ID layanan" /></Field>
      <SupplierField value={supplier} onChange={(value) => { setSupplier(value); setPage(1); onSelect(null); }} />
      <Field label="Status mapping"><select className={INPUT} value={mapping} onChange={(e) => { setMapping(e.target.value); setPage(1); }}><option value="">Semua mapping</option><option value="mapped">Sudah dipakai</option><option value="unmapped">Belum dipakai</option></select></Field>
      <Field label="Platform layanan"><select className={INPUT} value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}><option value="">Semua platform</option>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <Field label="Tipe layanan"><select className={INPUT} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">Semua tipe</option>{["Default", "Custom Comments", "Package", "Subscriptions"].map((t) => <option key={t}>{t}</option>)}</select></Field>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-white/65"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={compatible} onChange={(e) => { setCompatible(e.target.checked); setPage(1); }} />Kompatibel link + jumlah</label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={indonesia} onChange={(e) => { setIndonesia(e.target.checked); setPage(1); }} />Indonesia</label><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={garansi} onChange={(e) => { setGaransi(e.target.checked); setPage(1); }} />Garansi disebut di nama</label><button className={BUTTON} disabled={panel.busy || !supplier} onClick={() => setConfirmSync(true)}>Tarik ulang {supplier ? PROVIDER_NAMES[supplier as PediaProvider] : "pilih supplier"}</button></div>
    <p className="mb-4 text-xs text-white/65">{panel.data.total} layanan / Cek terakhir: {formatWibDateTime(panel.data.diff[supplier === "indosmm" ? "pedia_indosmm_diff_last_at" : "pedia_diff_last_at"]) ?? "Belum tersedia"}</p>
    {selected != null && <form aria-label="Hubungkan layanan" className="mb-4 space-y-3 border-y border-[#00E5FF]/20 py-4" onSubmit={async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const result = await panel.write("/api/admin/pedia/products", { kind: "tier", id: Number(f.get("tier_id")), supplier: selected.supplier, supplier_service_id: selected.service_id, backup_service_id: null }, "Layanan utama diperbarui.");
      if (result && !result.saved) { onSelect(null); await onAssigned(Number(productId)); }
    }}><p className="text-sm font-semibold text-white">Pakai layanan {PROVIDER_NAMES[selected.supplier]} #{selected.service_id}</p><p className="text-xs text-white/65">Supplier dan layanan diganti bersama; cadangan dihapus, harga dihitung ulang. Order lama tetap memakai snapshot asal. Buat produk/tingkat melalui tab Produk bila belum ada.</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Produk tujuan"><select required className={INPUT} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Pilih produk</option>{catalog.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Tingkat tujuan"><select key={productId} name="tier_id" required className={INPUT} defaultValue=""><option value="">Pilih tingkat</option>{catalog.tiers.filter((t) => t.product_id === Number(productId)).sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier)).map((t) => <option key={t.id} value={t.id}>{t.tier}</option>)}</select></Field></div><div className="flex gap-2"><button className={PRIMARY} disabled={panel.busy}>Hubungkan layanan</button><button type="button" className={BUTTON} disabled={panel.busy} onClick={() => onSelect(null)}>Batal</button></div></form>}
    <DataTable title="Layanan supplier" columns={["Supplier / ID / layanan", "Biaya per 1.000", "Min / maks", "Dipakai di", "Aksi"]}>
      {panel.data.rows.map(r => <tr key={`${r.supplier}:${r.service_id}`}>
        <td className="min-w-[260px] max-w-md"><p className="font-semibold text-white">{String(r.name)}</p><p className="mt-1 text-xs text-white/40">{PROVIDER_NAMES[r.supplier as PediaProvider]} #{String(r.service_id)} · {Number(r.present) === 1 ? "Tersedia" : "Hilang dari supplier"}</p><p className="mt-1 text-xs">{String(r.type)} · API refill {r.api_refill === 1 ? "Ya" : "Tidak"}</p></td>
        <td className="whitespace-nowrap font-semibold text-white">{formatRupiah(Number(r.rate_idr_per_1k))}</td>
        <td className="whitespace-nowrap text-xs tabular-nums">{String(r.min_qty)} / {String(r.max_qty)}</td>
        <td className="min-w-[160px] text-xs">{String(r.used_in || "Belum dipakai")}</td>
        <td><button className={EDIT} disabled={panel.busy || panel.loading || !PEDIA_PROVIDERS.includes(r.supplier as PediaProvider) || Number(r.present) !== 1 || r.type !== "Default" || Number(r.rate_idr_per_1k) <= 0} onClick={() => onSelect({ supplier: r.supplier as PediaProvider, service_id: Number(r.service_id) })} aria-label={`Pakai layanan ${r.supplier} ${r.service_id}`}>Pakai</button></td>
      </tr>)}
    </DataTable>
    {!panel.loading && !panel.error && !panel.data.rows.length && <p className="py-4 text-sm text-white/65">Tidak ada layanan yang cocok.</p>}
    <div className="mt-4 flex items-center gap-3"><button className={BUTTON} disabled={page <= 1 || panel.loading} onClick={() => setPage(page - 1)}>Sebelumnya</button><span className="text-xs text-white/65">Halaman {page} / {Math.max(1, Math.ceil(panel.data.total / 50))}</span><button className={BUTTON} disabled={page * 50 >= panel.data.total || panel.loading} onClick={() => setPage(page + 1)}>Berikutnya</button></div>
    <ConfirmDialog open={confirmSync} title="Tarik ulang layanan?" description={`Hanya ${PROVIDER_NAMES[supplier as PediaProvider]}. Harga dan status tingkat dapat berubah; layanan hilang ditangani diff VPS, bukan daftar manual ini.`} confirmLabel="Tarik ulang" variant="default" loading={panel.busy} onClose={() => { if (!panel.busy) setConfirmSync(false); }} onConfirm={async () => { const result = await panel.write("/api/admin/pedia/services", { action: "resync", supplier }, "Layanan selesai disinkronkan.", "POST"); if (result) setConfirmSync(false); }} />
  </Panel>;
}

function PediaOrdersPanel() {
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const panel = usePanel<{ rows: Row[] }>(`/api/admin/pedia/orders?status=${status}&supplier=${supplier}`, { rows: [] });
  const [action, setAction] = useState<{ code: string; action: string; sid?: string } | null>(null);
  return <Panel title="Pesanan Pedia" description="Periksa pesanan bermasalah sebelum mengirim ulang. Pengiriman ulang dapat membuat tagihan supplier baru.">
    <Feedback panel={panel} /><div className="my-4 grid gap-3 sm:grid-cols-2"><Field label="Status pesanan"><select value={status} onChange={(e) => { setStatus(e.target.value); setAction(null); }} className={INPUT}><option value="">Semua status</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><SupplierField value={supplier} onChange={(value) => { setSupplier(value); setAction(null); }} /></div>
    {!panel.loading && !panel.error && !panel.data.rows.length && <p className="text-sm text-white/65">Belum ada pesanan Pedia untuk status ini.</p>}
    <DataTable title="Pesanan Pedia" columns={["Pesanan", "Produk / jumlah", "Tujuan", "Total", "Status"]}>
      {panel.data.rows.map(r => <Fragment key={String(r.order_code)}>
        <tr>
          <td className="min-w-[180px]"><p className="font-semibold text-white">{String(r.order_code)}</p><p className="mt-1 text-xs text-white/40">{formatWibDateTime(String(r.created_at ?? "")) ?? "-"}</p></td>
          <td className="min-w-[160px]"><p className="text-white">{String(r.product_name)}</p><p className="mt-1 text-xs">{String(r.quantity)} unit</p></td>
          <td className="max-w-xs break-all text-xs">{String(r.target_normalized)}</td>
          <td className="whitespace-nowrap font-semibold text-white">{formatRupiah(Number(r.total))}</td>
          <td className={`whitespace-nowrap text-xs ${r.status === "needs_check" ? "text-amber-300" : r.status === "completed" ? "text-emerald-300" : "text-white/60"}`}>{STATUS[String(r.status)] ?? "Status tidak dikenal"}</td>
        </tr>
        <tr><td colSpan={5}><div className="space-y-2 text-xs">
          <p className="break-words text-white/40">Snapshot asal: {PROVIDER_NAMES[r.supplier as PediaProvider] ?? "Supplier tidak valid"} / Layanan #{String(r.supplier_service_id)} / ID order {String(r.supplier_order_id ?? "Belum diketahui")}</p>
          <details><summary className="min-h-11 cursor-pointer py-3">Detail pesanan</summary><p>Mulai: {String(r.start_count ?? "-")} / Tersisa: {String(r.remains ?? "-")} / Biaya supplier: {r.supplier_charge == null ? "Belum tersedia" : formatRupiah(Number(r.supplier_charge))}</p><p>{formatWibDateTime(String(r.created_at ?? "")) ?? "-"}</p>{r.last_error ? <p className="mt-2 break-words text-red-300">Kendala: {String(r.last_error)}</p> : null}</details>
      {r.status === "needs_check" && <div className="space-y-3">
        <form aria-label={`Tandai sudah dibuat ${r.order_code}`} className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAction({ code: String(r.order_code), action: "mark_submitted", sid: String(new FormData(e.currentTarget).get("sid")) }); }}><Field label="ID order supplier"><input name="sid" required maxLength={60} className={INPUT} /></Field><button className={BUTTON} disabled={panel.busy}>Tandai sudah dibuat</button></form>
        {r.can_resubmit !== true && <p className="text-xs text-amber-300">Pengiriman sudah dicoba atau hasil belum pasti. Rekonsiliasi pada provider asal dan tandai ID order; retry/kredit diblokir agar tidak terjadi tagihan ganda.</p>}
        <div className="flex flex-wrap gap-2"><button disabled={panel.busy} className={BUTTON} onClick={async () => { const result = await panel.write(`/api/admin/pedia/orders/${encodeURIComponent(String(r.order_code))}`, { action: "check_balance" }, "Saldo diperiksa.", "POST"); if (result) panel.setSuccess(`Saldo ${PROVIDER_NAMES[r.supplier as PediaProvider]}: ${formatRupiah(Number((result.balance as Row)?.balance))}`); }}>Cek saldo supplier</button><button disabled={panel.busy || r.can_resubmit !== true} className={BUTTON} onClick={() => setAction({ code: String(r.order_code), action: "resubmit" })}>Kirim ulang</button><button disabled={panel.busy || r.can_resubmit !== true} className={`${BUTTON} text-red-300`} onClick={() => setAction({ code: String(r.order_code), action: "cancel_credit" })}>Batalkan + kredit</button></div>
      </div>}
        </div></td></tr>
      </Fragment>)}
    </DataTable>
    {action && <form aria-label="Verifikasi tindakan pesanan" className="mt-4 space-y-3 rounded-xl border border-amber-400/30 p-4" onSubmit={(e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      if (action.action === "resubmit" && (!f.has("checked_supplier") || !f.has("accept_charge"))) return;
      void panel.write(`/api/admin/pedia/orders/${encodeURIComponent(action.code)}`, { action: action.action, supplier_order_id: action.sid, confirm: true, ...(action.action === "resubmit" ? { checked_supplier: true, accept_charge: true } : {}) }, "Tindakan pesanan tersimpan.", "POST").then((result) => { if (result) setAction(null); });
    }}><p className="font-semibold text-white">Konfirmasi {action.code}</p><p className="text-sm text-white/65">{action.action === "resubmit" ? "Periksa dashboard supplier. Jangan kirim ulang pesanan yang sudah dibuat." : action.action === "cancel_credit" ? "Pesanan dibatalkan dan kredit penuh diterbitkan untuk pembeli." : `Tandai pesanan telah dibuat dengan ID ${action.sid}.`}</p>{action.action === "resubmit" && <><label className="flex min-h-11 items-center gap-2 text-sm text-white/80"><input name="checked_supplier" type="checkbox" required />Saya telah memastikan pesanan belum ada di supplier</label><label className="flex min-h-11 items-center gap-2 text-sm text-white/80"><input name="accept_charge" type="checkbox" required />Saya memahami risiko tagihan ganda</label></>}<div className="flex gap-2"><button disabled={panel.busy} className={PRIMARY}>Konfirmasi tindakan</button><button type="button" disabled={panel.busy} className={BUTTON} onClick={() => setAction(null)}>Batal</button></div></form>}
  </Panel>;
}

function PediaCreditsPanel() {
  const panel = usePanel<{ rows: Row[] }>("/api/admin/pedia/credits", { rows: [] });
  const [draft, setDraft] = useState<Row | null>(null), [code, setCode] = useState("");
  return <Panel title="Kredit Pedia" description="Pantau sisa kredit atau terbitkan kredit manual dengan alasan yang jelas."><Feedback panel={panel} />
    <details className="my-4 border-y border-white/10 py-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white">Terbitkan kredit manual</summary><form aria-label="Kredit manual" className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setDraft({ email: String(f.get("email")), amount: Number(f.get("amount")), reason: String(f.get("reason")) }); }}><fieldset disabled={panel.busy} className="grid gap-3 sm:grid-cols-2"><Field label="Email penerima"><input name="email" type="email" required maxLength={160} className={INPUT} /></Field><Field label="Jumlah kredit (Rp)"><input name="amount" type="number" required min={100} max={100000000} className={INPUT} /></Field><Field label="Alasan kredit"><textarea name="reason" required minLength={5} maxLength={300} className={INPUT} /></Field></fieldset><button className={PRIMARY} disabled={panel.busy}>Terbitkan kredit</button></form></details>
    {code && <p role="status" className="mb-4 break-all text-sm text-amber-300">Kode kredit baru: <strong className="font-mono">{code}</strong>. Sampaikan kode ini kepada penerima.</p>}
    {!panel.loading && !panel.error && !panel.data.rows.length && <p className="text-sm text-white/65">Belum ada kode kredit.</p>}
    <DataTable title="Daftar kredit Pedia" columns={["Kode", "Penerima", "Sisa kredit", "Jumlah awal", "Sumber", "Berlaku sampai"]}>
      {panel.data.rows.map(r => <tr key={Number(r.id)}>
        <td className="whitespace-nowrap font-mono text-white">****-{String(r.code_hint)}</td>
        <td className="break-all text-xs">{String(r.email)}</td>
        <td className="whitespace-nowrap font-semibold text-emerald-300">{formatRupiah(Number(r.remaining))}</td>
        <td className="whitespace-nowrap">{formatRupiah(Number(r.amount))}</td>
        <td className="whitespace-nowrap text-xs">{r.source_kind === "admin" ? "Manual admin" : r.source_kind === "partial" ? "Selesai sebagian" : "Pembatalan"}</td>
        <td className="whitespace-nowrap text-xs">{formatWibDateTime(String(r.expires_at)) ?? "-"}</td>
      </tr>)}
    </DataTable>
    <ConfirmDialog open={!!draft} title="Terbitkan kredit manual?" description={draft ? `${formatRupiah(Number(draft.amount))} untuk ${draft.email}. Kredit manual tidak dapat dibatalkan dari panel ini.` : ""} confirmLabel="Terbitkan" variant="default" loading={panel.busy} onClose={() => { if (!panel.busy) setDraft(null); }} onConfirm={async () => { if (!draft) return; const result = await panel.write("/api/admin/pedia/credits", draft, "Kredit manual diterbitkan.", "POST"); if (result) { setCode(String(result.credit_code)); setDraft(null); } }} />
  </Panel>;
}

function PediaSettingsPanel() {
  const panel = usePanel<{ settings: Record<string, number>; balance_history: Row[] }>("/api/admin/pedia/settings", { settings: {}, balance_history: [] });
  const health = usePanel<{ providers: ProviderHealth[] }>("/api/admin/pedia/overview", { providers: [] });
  const [draft, setDraft] = useState<Row | null>(null);
  const fields: [string, string, number, number][] = [
    ["pedia_markup_g1", "Markup G1 (%)", 0, 1000], ["pedia_markup_g2", "Markup G2 (%)", 0, 1000], ["pedia_markup_g3", "Markup G3 (%)", 0, 1000],
    ["pedia_min_profit_g1", "Minimum untung G1 (Rp)", 0, 10000000], ["pedia_min_profit_g2", "Minimum untung G2 (Rp)", 0, 10000000], ["pedia_min_profit_g3", "Minimum untung G3 (Rp)", 0, 10000000],
    ["pedia_min_order_rp", "Minimum order (Rp)", 500, 100000], ["pedia_balance_alert_rp", "Ambang saldo (Rp)", 10000, 100000000],
  ];
  return <Panel title="Pengaturan Pedia" description="Nilai tersimpan tidak menggantikan konfigurasi operasional server."><Feedback panel={panel} />
    <div className="my-4"><Feedback panel={health} /><div className="grid gap-3 sm:grid-cols-2">{health.data.providers.map((provider) => <section key={provider.supplier} className="min-w-0 rounded-xl border border-white/10 p-3 text-sm text-white/80"><h4 className="font-semibold text-white">{PROVIDER_NAMES[provider.supplier]}</h4><p>Saldo: {provider.balance.value == null ? "Belum tersedia" : formatRupiah(provider.balance.value)} {provider.balance.stale ? "(cache, bukan saldo live)" : "(live IDR)"}</p><p className="text-xs">Harga: {provider.pricing_verified ? "Gate pricing lolos" : "Belum terverifikasi"} / Sync {formatWibDateTime(provider.last_sync_at ?? "") ?? "Belum tersedia"}</p>{provider.error && <p role="status" className="mt-2 break-words text-amber-300">Kendala: {provider.error}</p>}</section>)}</div><button className={`${BUTTON} mt-3`} disabled={health.loading} onClick={() => void health.load()}>Periksa saldo dan health</button><p className="mt-2 text-xs text-white/65">IndoSMM memerlukan balance IDR dan gate tarif per 1.000 di VPS. Health/saldo tidak membuka flag order atau dispatch.</p></div>
    <p className="mt-3 text-sm leading-relaxed text-amber-200">Minimum order dan ambang notifikasi saldo aktif mengikuti konfigurasi server. Mengubah nilai di bawah tidak mengubah kedua batas operasional tersebut. Markup dan minimum untung setiap tingkat dikelola melalui editor produk.</p>
    {!panel.loading && Object.keys(panel.data.settings).length > 0 && <form className="my-4 space-y-4" aria-label="Pengaturan Pedia" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setDraft(Object.fromEntries(fields.map(([key]) => [key, Number(f.get(key))]))); }}><fieldset disabled={panel.busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label, min, max]) => <Field key={key} label={label}><input name={key} type="number" required min={min} max={max} step={key.includes("markup") ? "any" : 1} defaultValue={panel.data.settings[key]} className={INPUT} /></Field>)}</fieldset><p className="text-xs text-white/65">Default tidak mengubah semua tingkat secara otomatis. Harga paket mengikuti pengaturan tingkat dan sinkronisasi layanan.</p><button className={PRIMARY} disabled={panel.busy}>Simpan pengaturan</button></form>}
    <details className="border-t border-white/10 pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white">Riwayat saldo supplier (7 hari)</summary>{panel.data.balance_history.length ? <DataTable title="Riwayat saldo supplier" columns={["Supplier", "Saldo", "Waktu"]} minWidth="min-w-[480px]">{panel.data.balance_history.map((r, i) => <tr key={`${r.supplier}:${i}`}><td>{PROVIDER_NAMES[r.supplier as PediaProvider]}</td><td className="font-semibold text-white">{formatRupiah(Number(r.balance))}</td><td>{formatWibDateTime(String(r.created_at)) ?? "-"}</td></tr>)}</DataTable> : !panel.loading && !panel.error && <p className="text-sm text-white/65">Belum ada riwayat saldo.</p>}</details>
    <ConfirmDialog open={!!draft} title="Simpan pengaturan Pedia?" description="Nilai default harga dan ambang saldo akan diperbarui. Pengaturan tingkat tetap dikelola per produk." confirmLabel="Simpan" variant="default" loading={panel.busy} onClose={() => { if (!panel.busy) setDraft(null); }} onConfirm={async () => { if (draft && await panel.write("/api/admin/pedia/settings", draft, "Pengaturan tersimpan.")) setDraft(null); }} />
  </Panel>;
}
