"use client";
import { Suspense, lazy, useEffect, useState, useCallback, useRef } from "react";
import type { ReportSelection } from "@/lib/revenue";
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
import { navigateWithDraftGuard, pushAdminHistory } from "@/components/admin/AdminWorkspace";

// Section berat di-lazy agar bundle awal admin ringan (temuan audit: 15
// section diimpor statis sekaligus). Ringkasan + Pesanan tetap statis karena
// jalur utama; sisanya dimuat saat section dibuka dengan fallback spinner.
function sectionFallback(label: string) {
  return (
    <div className="mt-4 flex min-h-48 items-center justify-center gap-3 text-sm text-admin-muted" role="status">
      <Spinner size={20} /> Memuat {label}…
    </div>
  );
}
const CategoryManagerLazy = lazy(() => import("@/components/admin/CategoryManager").then((m) => ({ default: m.CategoryManager })));
const PaymentMethodsManagerLazy = lazy(() => import("@/components/admin/PaymentMethodsManager").then((m) => ({ default: m.PaymentMethodsManager })));
const SupplierTopupManagerLazy = lazy(() => import("@/components/admin/SupplierTopupManager").then((m) => ({ default: m.SupplierTopupManager })));
const WarungRebahanManagerLazy = lazy(() => import("@/components/admin/WarungRebahanManager").then((m) => ({ default: m.WarungRebahanManager })));
const SekalipayManagerLazy = lazy(() => import("@/components/admin/SekalipayManager").then((m) => ({ default: m.SekalipayManager })));
const ProductGroupsManagerLazy = lazy(() => import("@/components/admin/ProductGroupsManager").then((m) => ({ default: m.ProductGroupsManager })));
const SupplierLinksManagerLazy = lazy(() => import("@/components/admin/SupplierLinksManager").then((m) => ({ default: m.SupplierLinksManager })));
const PediaManagerLazy = lazy(() => import("@/components/admin/PediaManager").then((m) => ({ default: m.PediaManager })));
const GamesManagerLazy = lazy(() => import("@/components/admin/GamesManager").then((m) => ({ default: m.GamesManager })));
const AivaultManagerLazy = lazy(() => import("@/components/admin/AivaultManager").then(m=>({default:m.AivaultManager})));
const StorebatManagerLazy = lazy(() => import("@/components/admin/StorebatManager").then(m=>({default:m.StorebatManager})));
const MiraiManagerLazy = lazy(() => import("@/components/admin/MiraiManager").then(m=>({default:m.MiraiManager})));
const TunvnManagerLazy = lazy(() => import("@/components/admin/TunvnManager").then((m) => ({ default: m.TunvnManager })));
const BotAutomationManagerLazy = lazy(() => import("@/components/admin/BotAutomationManager"));
const ArticlesManagerLazy = lazy(() => import("@/components/admin/ArticlesManager").then((m) => ({ default: m.ArticlesManager })));
const BroadcastManagerLazy = lazy(() => import("@/components/admin/BroadcastManager").then((m) => ({ default: m.BroadcastManager })));
const BannerManagerLazy = lazy(() => import("@/components/admin/BannerManager").then((m) => ({ default: m.BannerManager })));
const NewsletterSubscribersLazy = lazy(() => import("@/components/admin/NewsletterSubscribers").then((m) => ({ default: m.NewsletterSubscribers })));
const AgentIntegrationLazy = lazy(() => import("@/components/admin/AgentIntegration").then((m) => ({ default: m.AgentIntegration })));
const StoreSettingsManagerLazy = lazy(() => import("@/components/admin/StoreSettingsManager").then((m) => ({ default: m.StoreSettingsManager })));
const ProductsSectionLazy = lazy(() => import("@/components/admin/sections/ProductsSection").then((m) => ({ default: m.ProductsSection })));
const ExpensesManagerLazy = lazy(() => import("@/components/admin/finance/ExpensesManager").then((m) => ({ default: m.ExpensesManager })));
const ExpenseFormSheetLazy = lazy(() => import("@/components/admin/finance/ExpenseFormSheet").then((m) => ({ default: m.ExpenseFormSheet })));
const ProductEditorModalLazy = lazy(() => import("@/components/admin/ProductEditorModal").then((m) => ({ default: m.ProductEditorModal })));

const ADMIN_SECTIONS: AdminSection[] = ["summary","expenses","products","orders","categories","payments","topup","warung","sekalipay","tunvn","aivault","storebat","mirai","pairs","links","pedia","games","articles","banners","broadcasts","subscribers","bot","agent","settings"];

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
  // Panel "Catat pengeluaran" dari Ringkasan (dimuat saat pertama dibuka).
  const [expenseSheet, setExpenseSheet] = useState<"closed" | "open" | "idle">("closed");
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
    navigateWithDraftGuard(() => {
    setTab(section);
    // Filter yang dibawa antar-section harus ikut berpindah, bukan hanya
    // tersimpan di URL: pushState tidak memicu popstate.
    if (section === "products") { setOnlyLowStock(params.low_stock === "1"); setProductPage(()=>1); }
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("section", section);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    pushAdminHistory(`${url.pathname}?${url.searchParams}`);
    });
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
    if(auth.authed) void loadOverview();
    return () => { ++requests.current; };
  },[auth.authed, loadOverview]);

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
      {tab==="summary" && <AdminOverview data={overview} loading={overviewLoading} error={overviewError} onRetry={loadOverview} selection={reportSelection} onSelectionChange={changeReportSelection}
        onRecordExpense={() => setExpenseSheet("open")} onNavigate={(section, params) => navigateAdmin(section, params)} />}
      {expenseSheet !== "closed" && <Suspense fallback={null}><ExpenseFormSheetLazy open={expenseSheet === "open"} onOpenChange={(open) => setExpenseSheet(open ? "open" : "idle")}
        onSaved={(result) => { toast.success(result.recurring ? "Pengeluaran dicatat dan akan berulang tiap bulan." : "Pengeluaran dicatat."); void loadOverview(); }} /></Suspense>}
      {tab==="expenses" && <Suspense fallback={sectionFallback("pengeluaran")}><ExpensesManagerLazy onChanged={loadOverview} /></Suspense>}
      {tab==="orders" && <OrdersManager onChanged={loadOverview} />}
      {tab==="categories" && <Suspense fallback={sectionFallback("kategori")}>{<CategoryManagerLazy />}</Suspense>}
      {tab==="payments" && <Suspense fallback={sectionFallback("pembayaran")}>{<PaymentMethodsManagerLazy onChanged={loadOverview} />}</Suspense>}
      {tab==="topup" && <Suspense fallback={sectionFallback("saldo supplier")}><SupplierTopupManagerLazy /></Suspense>}
      {tab==="warung" && <Suspense fallback={sectionFallback("Warung Rebahan")}>{<WarungRebahanManagerLazy />}</Suspense>}
      {tab==="sekalipay" && <Suspense fallback={sectionFallback("Sekalipay")}>{<SekalipayManagerLazy />}</Suspense>}
      {tab==="pairs" && <Suspense fallback={sectionFallback("grup produk")}>{<ProductGroupsManagerLazy />}</Suspense>}
      {tab==="links" && <Suspense fallback={sectionFallback("tautan supplier")}>{<SupplierLinksManagerLazy />}</Suspense>}
      {tab==="pedia" && <Suspense fallback={sectionFallback("Pedia")}>{<PediaManagerLazy initialTab={new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("tab") ?? undefined} />}</Suspense>}
      {tab==="games" && <Suspense fallback={sectionFallback("Games")}>{<GamesManagerLazy />}</Suspense>}
      {tab==="aivault" && <Suspense fallback={sectionFallback("AIVault")}><AivaultManagerLazy /></Suspense>}
      {tab==="storebat" && <Suspense fallback={sectionFallback("StoreBat")}><StorebatManagerLazy /></Suspense>}
      {tab==="mirai" && <Suspense fallback={sectionFallback("Mirai")}><MiraiManagerLazy /></Suspense>}
      {tab==="tunvn" && <Suspense fallback={sectionFallback("TUNVN")}>{<TunvnManagerLazy />}</Suspense>}
      {tab==="broadcasts" && <Suspense fallback={sectionFallback("siaran")}><BroadcastManagerLazy /></Suspense>}
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
          error={pm.listError}
          onRetry={pm.load}
          prods={pm.prods}
          cats={pm.cats}
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
          onRestore={pm.restoreProduct}
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
          bulkFocus={pm.bulkFocus}
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
        title={pm.deleteTarget?.archivedAt ? "Hapus permanen produk?" : "Arsipkan produk?"}
        description={pm.deleteTarget?.archivedAt ? `“${pm.deleteTarget.name}” akan dihapus permanen beserta variannya. Tindakan ini tidak bisa dibatalkan.` : "Produk disembunyikan dari daftar & toko, bisa dipulihkan dari tab Arsip; sync supplier tidak akan memunculkannya lagi."}
        confirmLabel={pm.deleteTarget?.archivedAt ? "Hapus permanen" : "Arsipkan produk"}
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
