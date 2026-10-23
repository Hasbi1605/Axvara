"use client";
import { Suspense, lazy, useEffect, useState, useCallback, useRef } from "react";
import type { ReportSelection } from "@/lib/revenue";
import { formatWibDateTime } from "@/lib/utils";
import { AdminShell, type AdminSection } from "@/components/admin/AdminShell";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AdminOverview, EMPTY_ADMIN_OVERVIEW, type AdminOverviewData } from "@/components/admin/AdminOverview";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { AdminAuthChecking, AdminLoginGate } from "@/components/admin/AdminLoginGate";
import { useProductManager } from "@/components/admin/useProductManager";
import { useAdminAuth } from "@/components/admin/useAdminAuth";
import { SystemTabs, SYSTEM_TABS } from "@/components/admin/SystemTabs";

// Section berat di-lazy agar bundle awal admin ringan (temuan audit: 15
// section diimpor statis sekaligus). Ringkasan + Pesanan tetap statis karena
// jalur utama; sisanya dimuat saat section dibuka dengan fallback spinner.
function sectionFallback(label: string) {
  return (
    <div className="mt-4 flex min-h-48 items-center justify-center gap-3 text-sm text-white/45" role="status">
      <Spinner size={20} /> Memuat {label}…
    </div>
  );
}
const CategoryManagerLazy = lazy(() => import("@/components/admin/CategoryManager").then((m) => ({ default: m.CategoryManager })));
const PaymentMethodsManagerLazy = lazy(() => import("@/components/admin/PaymentMethodsManager").then((m) => ({ default: m.PaymentMethodsManager })));
const WarungRebahanManagerLazy = lazy(() => import("@/components/admin/WarungRebahanManager").then((m) => ({ default: m.WarungRebahanManager })));
const SekalipayManagerLazy = lazy(() => import("@/components/admin/SekalipayManager").then((m) => ({ default: m.SekalipayManager })));
const SupplierPairsManagerLazy = lazy(() => import("@/components/admin/SupplierPairsManager").then((m) => ({ default: m.SupplierPairsManager })));
const SupplierLinksManagerLazy = lazy(() => import("@/components/admin/SupplierLinksManager").then((m) => ({ default: m.SupplierLinksManager })));
const PediaManagerLazy = lazy(() => import("@/components/admin/PediaManager").then((m) => ({ default: m.PediaManager })));
const BotAutomationManagerLazy = lazy(() => import("@/components/admin/BotAutomationManager"));
const ArticlesManagerLazy = lazy(() => import("@/components/admin/ArticlesManager").then((m) => ({ default: m.ArticlesManager })));
const BannerManagerLazy = lazy(() => import("@/components/admin/BannerManager").then((m) => ({ default: m.BannerManager })));
const NewsletterSubscribersLazy = lazy(() => import("@/components/admin/NewsletterSubscribers").then((m) => ({ default: m.NewsletterSubscribers })));
const AgentIntegrationLazy = lazy(() => import("@/components/admin/AgentIntegration").then((m) => ({ default: m.AgentIntegration })));
const StoreSettingsManagerLazy = lazy(() => import("@/components/admin/StoreSettingsManager").then((m) => ({ default: m.StoreSettingsManager })));
const ProductsSectionLazy = lazy(() => import("@/components/admin/sections/ProductsSection").then((m) => ({ default: m.ProductsSection })));
const ProductEditorModalLazy = lazy(() => import("@/components/admin/ProductEditorModal").then((m) => ({ default: m.ProductEditorModal })));

const ADMIN_SECTIONS: AdminSection[] = ["summary","products","orders","categories","payments","warung","sekalipay","pairs","links","pedia","articles","banners","subscribers","bot","agent","settings"];

export default function AdminPage() {
  const toast = useToast();
  // Section awal dari URL (temuan audit: deep link ?section=orders selalu
  // dibuka sebagai summary lalu menimpa URL — inisialisasi dari URL agar
  // kartu Ringkasan/deep link langsung ke tujuan).
  const [tab, setTab] = useState<AdminSection>(() => {
    if (typeof window === "undefined") return "summary";
    const section = new URLSearchParams(window.location.search).get("section") as AdminSection | null;
    return section && ADMIN_SECTIONS.includes(section) ? section : "summary";
  });
  const [overview, setOverview] = useState<AdminOverviewData>(EMPTY_ADMIN_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [reportSelection, setReportSelection] = useState<ReportSelection>("week");
  const overviewRequest = useRef(0);

  const loadOverview = useCallback(async()=>{
    const request = ++overviewRequest.current;
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const params = new URLSearchParams(typeof reportSelection === "string" ? { period: reportSelection } : reportSelection);
      const response = await fetch(reportSelection === "week" ? "/api/admin/overview" : `/api/admin/overview?${params}`, { cache: "no-store" });
      const data = await response.json().catch(()=>({})) as Partial<AdminOverviewData> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal memuat ringkasan");
      if (request !== overviewRequest.current) return;
      setOverview({ ...EMPTY_ADMIN_OVERVIEW, ...data, channels: { ...EMPTY_ADMIN_OVERVIEW.channels, ...data.channels }, systems: { ...EMPTY_ADMIN_OVERVIEW.systems, ...data.systems } });
    } catch { if (request === overviewRequest.current) setOverviewError("Ringkasan belum berhasil dimuat. Coba muat ulang."); }
    finally { if (request === overviewRequest.current) setOverviewLoading(false); }
  }, [reportSelection]);

  const changeReportSelection = (selection: ReportSelection) => {
    if (JSON.stringify(selection) === JSON.stringify(reportSelection)) return;
    ++overviewRequest.current;
    setOverviewLoading(true);
    setOverviewError(null);
    setReportSelection(selection);
  };

  // Katalog produk (state + handler) di hook tersendiri; onUnauthorized memaksa sesi
  // kembali ke gerbang login bila fetch kategori membalas 401.
  const auth = useAdminAuth(toast);
  const { setAuthed } = auth;
  const onUnauthorized = useCallback(() => setAuthed(false), [setAuthed]);
  const pm = useProductManager(toast, onUnauthorized);
  const { load, setOnlyLowStock, setPage: setProductPage } = pm;

  const navigateAdmin = useCallback((section: AdminSection, params: Record<string,string> = {}) => {
    setTab(section);
    // Filter yang dibawa antar-section harus ikut berpindah, bukan hanya
    // tersimpan di URL: pushState tidak memicu popstate.
    if (section === "products") { setOnlyLowStock(params.low_stock === "1"); setProductPage(()=>1); }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("section", section);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams}`);
  }, [setOnlyLowStock, setProductPage]);

  // Satu listener popstate untuk SELURUH state yang berasal dari URL: section
  // dan filter yang dibawanya (mis. kartu "Stok menipis" → ?low_stock=1).
  // Dua listener terpisah mem-parse URL yang sama dua kali per back/forward
  // dan memisahkan aturan yang sebenarnya satu: "URL adalah sumber kebenaran".
  useEffect(()=>{
    const syncFromUrl=()=>{
      const params=new URLSearchParams(window.location.search);
      const section=params.get("section") as AdminSection|null;
      if(section&&ADMIN_SECTIONS.includes(section))setTab(section);
      const lowStock=section==="products"&&params.get("low_stock")==="1";
      setOnlyLowStock(lowStock);
      if(lowStock)setProductPage(()=>1);
    };
    syncFromUrl();
    window.addEventListener("popstate",syncFromUrl);
    return()=>window.removeEventListener("popstate",syncFromUrl);
  },[setOnlyLowStock, setProductPage]);

  // Product data is only used by ProductsSection/editor. Refresh on each entry.
  useEffect(()=>{ if(auth.authed && tab === "products") void load(); },[auth.authed, tab, load]);
  useEffect(()=>{
    const requests = overviewRequest;
    if(auth.authed && tab === "summary") void loadOverview();
    return () => { ++requests.current; };
  },[auth.authed, tab, loadOverview]);

  if(auth.checkingAuth) return <AdminAuthChecking />;

  if(!auth.authed) return (
    <AdminLoginGate
      email={auth.email}
      pass={auth.pass}
      loginLoading={auth.loginLoading}
      loginError={auth.loginError}
      onEmailChange={auth.setEmail}
      onPassChange={auth.setPass}
      onLogin={auth.login}
    />
  );

  return (
    <AdminShell section={tab} onSection={(section)=>navigateAdmin(section)} badges={{ orders: overview.pending_orders, payments: overview.payment_attention, bot: overview.fulfillment_attention }}>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-white/35" data-testid="admin-session-header">
        <div className="flex flex-wrap items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Masuk sebagai <span className="text-white/60">{auth.authEmail || "admin"}</span> <span className="opacity-40">·</span> maks. 8 jam <span className="opacity-40">·</span> idle 2 jam
        </div>
        {tab === "summary" && !overviewLoading && !overviewError && overview.selected_report && <p>
          {overview.selected_report.from} – {overview.selected_report.to} · {overview.selected_report.timezone} · Dibuat {formatWibDateTime(overview.selected_report.generated_at)} WIB
        </p>}
      </div>

      {tab === "products" && pm.listError && <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"><span>{pm.listError}</span><button onClick={pm.load} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0 transition hover:bg-white/90">Coba lagi</button></div>}

      {tab==="summary" && <AdminOverview data={overview} loading={overviewLoading} error={overviewError} onRetry={loadOverview} selection={reportSelection} onSelectionChange={changeReportSelection} />}
      {tab==="orders" && <OrdersManager onChanged={loadOverview} />}
      {tab==="categories" && <Suspense fallback={sectionFallback("kategori")}>{<CategoryManagerLazy />}</Suspense>}
      {tab==="payments" && <Suspense fallback={sectionFallback("pembayaran")}>{<PaymentMethodsManagerLazy />}</Suspense>}
      {tab==="warung" && <Suspense fallback={sectionFallback("Warung Rebahan")}>{<WarungRebahanManagerLazy />}</Suspense>}
      {tab==="sekalipay" && <Suspense fallback={sectionFallback("Sekalipay")}>{<SekalipayManagerLazy />}</Suspense>}
      {tab==="pairs" && <Suspense fallback={sectionFallback("pasangan supplier")}>{<SupplierPairsManagerLazy />}</Suspense>}
      {tab==="links" && <Suspense fallback={sectionFallback("tautan supplier")}>{<SupplierLinksManagerLazy />}</Suspense>}
      {tab==="pedia" && <Suspense fallback={sectionFallback("Pedia")}>{<PediaManagerLazy initialTab={new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("tab") ?? undefined} />}</Suspense>}
      {tab==="bot" && <Suspense fallback={sectionFallback("otomasi bot")}>{<BotAutomationManagerLazy />}</Suspense>}
      {SYSTEM_TABS.some(([id])=>id===tab) && (
        <SystemTabs section={tab} onSection={navigateAdmin}>
          {tab==="settings" && <Suspense fallback={sectionFallback("pengaturan")}>{<StoreSettingsManagerLazy />}</Suspense>}
          {tab==="agent" && <Suspense fallback={sectionFallback("integrasi agent")}>{<AgentIntegrationLazy />}</Suspense>}
          {tab==="subscribers" && <Suspense fallback={sectionFallback("pelanggan email")}>{<NewsletterSubscribersLazy />}</Suspense>}
        </SystemTabs>
      )}

      {tab==="products" && (
        <Suspense fallback={sectionFallback("produk")}>
        <ProductsSectionLazy
          prods={pm.prods}
          paged={pm.paged}
          filtered={pm.filtered}
          q={pm.q}
          safePage={pm.safePage}
          totalPages={pm.totalPages}
          perPage={pm.perPage}
          loadingList={pm.loadingList}
          toggling={pm.toggling}
          activeProducts={pm.activeProducts}
          lowStock={pm.lowStock}
          soldProducts={pm.soldProducts}
          liveProducts={pm.liveProducts}
          hiddenProducts={pm.hiddenProducts}
          offProducts={pm.offProducts}
          liveTab={pm.liveTab}
          onLiveTabChange={pm.setLiveTab}
          perPageAdmin={pm.perPageAdmin}
          onPerPageChange={pm.setPerPageAdmin}
          onQueryChange={pm.setQ}
          onPageChange={pm.setPage}
          onlyLowStock={pm.onlyLowStock}
          supplierFilter={pm.supplierFilter}
          onSupplierFilterChange={pm.setSupplierFilter}
          onClearLowStock={()=>{
            pm.setOnlyLowStock(false);
            const url=new URL(window.location.href);
            url.searchParams.delete("low_stock");
            window.history.replaceState(null,"",`${url.pathname}?${url.searchParams}`);
          }}
          onNew={pm.openNew}
          onEdit={pm.openEdit}
          onDelete={pm.setDeleteTarget}
          onToggleActive={pm.toggleActive}
          reordering={pm.reordering}
          onMove={pm.moveProduct}
          onJump={pm.jumpProduct}
          onSoldCount={pm.saveSoldCount}
        />
        </Suspense>
      )}

      {tab==="articles" && <Suspense fallback={sectionFallback("artikel")}>{<ArticlesManagerLazy />}</Suspense>}

      {tab==="banners" && <Suspense fallback={sectionFallback("banner")}>{<BannerManagerLazy />}</Suspense>}


      {(pm.editing || pm.showNew) && (
        <Suspense fallback={null}>
        <ProductEditorModalLazy
          editing={Boolean(pm.editing)}
          editingId={pm.editing?.id}
          saving={pm.saving}
          uploading={pm.uploading}
          loadingVariants={pm.loadingVariants}
          hasMultiVariants={pm.hasMultiVariants}
          formError={pm.formError}
          form={pm.form}
          formImages={pm.formImages}
          formVariants={pm.formVariants}
          cats={pm.cats}
          onRequestClose={pm.requestCloseProductModal}
          onSetForm={pm.setForm}
          onSetFormImages={pm.setFormImages}
          onSetHasMultiVariants={pm.setHasMultiVariants}
          onSetFormVariants={pm.setFormVariants}
          onUpload={pm.handleUpload}
          onSave={pm.save}
        />
        </Suspense>
      )}

      <ConfirmDialog
        open={!!pm.deleteTarget}
        title="Arsipkan produk?"
        description={pm.deleteTarget ? `"${pm.deleteTarget.name}" akan dinonaktifkan dan disimpan sebagai arsip agar riwayat pesanan tetap aman.` : ""}
        confirmLabel="Arsipkan produk"
        cancelLabel="Batal"
        variant="danger"
        loading={pm.deleting}
        onClose={()=> !pm.deleting && pm.setDeleteTarget(null)}
        onConfirm={pm.confirmDelete}
      />

      <ConfirmDialog open={pm.confirmProductClose} title="Buang perubahan?" description="Perubahan pada produk ini belum disimpan." confirmLabel="Buang perubahan" cancelLabel="Lanjut mengedit" variant="danger" onClose={()=>pm.setConfirmProductClose(false)} onConfirm={()=>{pm.setConfirmProductClose(false);pm.closeModal();}} />

    </AdminShell>
  );
}
