"use client";
import { useEffect, useState, useCallback } from "react";
import { AdminShell, type AdminSection } from "@/components/admin/AdminShell";
import { AgentIntegration } from "@/components/admin/AgentIntegration";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ArticlesManager } from "@/components/admin/ArticlesManager";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { BannerManager } from "@/components/admin/BannerManager";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";
import { NewsletterSubscribers } from "@/components/admin/NewsletterSubscribers";
import BotAutomationManager from "@/components/admin/BotAutomationManager";
import { AdminOverview, EMPTY_ADMIN_OVERVIEW, type AdminOverviewData } from "@/components/admin/AdminOverview";
import { OrdersManager } from "@/components/admin/OrdersManager";
import { StoreSettingsManager } from "@/components/admin/StoreSettingsManager";
import { AdminAuthChecking, AdminLoginGate } from "@/components/admin/AdminLoginGate";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import { WarungRebahanManager } from "@/components/admin/WarungRebahanManager";
import { ProductEditorModal } from "@/components/admin/ProductEditorModal";
import { useProductManager } from "@/components/admin/useProductManager";
import { useAdminAuth } from "@/components/admin/useAdminAuth";

const ADMIN_SECTIONS: AdminSection[] = ["summary","products","orders","categories","payments","warung","articles","banners","subscribers","bot","agent","settings"];

export default function AdminPage() {
  const toast = useToast();
  const [tab, setTab] = useState<AdminSection>("summary");
  const [overview, setOverview] = useState<AdminOverviewData>(EMPTY_ADMIN_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(true);

  const loadOverview = useCallback(async()=>{
    setOverviewLoading(true);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const data = await response.json().catch(()=>({})) as Partial<AdminOverviewData> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Gagal memuat ringkasan");
      setOverview({ ...EMPTY_ADMIN_OVERVIEW, ...data, channels: { ...EMPTY_ADMIN_OVERVIEW.channels, ...data.channels }, systems: { ...EMPTY_ADMIN_OVERVIEW.systems, ...data.systems } });
    } catch { /* Ringkasan gagal tidak memblokir menu operasional lain. */ }
    finally { setOverviewLoading(false); }
  }, []);

  // Katalog produk (state + handler) di hook tersendiri; onUnauthorized memaksa sesi
  // kembali ke gerbang login bila fetch kategori membalas 401.
  const auth = useAdminAuth(toast, () => Promise.all([load(), loadOverview()]).then(() => undefined));
  const { setAuthed } = auth;
  const onUnauthorized = useCallback(() => setAuthed(false), [setAuthed]);
  const pm = useProductManager(toast, onUnauthorized);
  const { load } = pm;

  const navigateAdmin = useCallback((section: AdminSection, params: Record<string,string> = {}) => {
    setTab(section);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("section", section);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams}`);
  }, []);

  useEffect(()=>{
    const syncSection=()=>{
      const section=new URLSearchParams(window.location.search).get("section") as AdminSection|null;
      if(section&&ADMIN_SECTIONS.includes(section))setTab(section);
    };
    syncSection();
    window.addEventListener("popstate",syncSection);
    return()=>window.removeEventListener("popstate",syncSection);
  },[]);

  useEffect(()=>{ if(auth.authed) { void load(); void loadOverview(); } },[auth.authed, load, loadOverview]);

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
      <div className="mt-4 flex items-center gap-2 text-[11px] text-white/35">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Masuk sebagai <span className="text-white/60">{auth.authEmail || "admin"}</span> <span className="opacity-40">·</span> maks. 8 jam <span className="opacity-40">·</span> idle 2 jam
      </div>

      {pm.listError && <div className="mt-4 rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200 flex items-center justify-between gap-3"><span>{pm.listError}</span><button onClick={pm.load} className="h-8 px-3 rounded-full bg-white text-[#070a1e] text-xs font-bold shrink-0 transition hover:bg-white/90">Coba lagi</button></div>}

      {tab==="summary" && <AdminOverview data={overview} loading={overviewLoading} onNavigate={navigateAdmin} />}
      {tab==="orders" && <OrdersManager onChanged={loadOverview} />}
      {tab==="categories" && <CategoryManager />}
      {tab==="payments" && <PaymentMethodsManager />}
      {tab==="warung" && <WarungRebahanManager />}
      {tab==="agent" && <AgentIntegration />}
      {tab==="bot" && <BotAutomationManager />}
      {tab==="settings" && <StoreSettingsManager />}

      {tab==="products" && (
        <ProductsSection
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
          onQueryChange={pm.setQ}
          onPageChange={pm.setPage}
          onNew={pm.openNew}
          onEdit={pm.openEdit}
          onDelete={pm.setDeleteTarget}
          onToggleActive={pm.toggleActive}
        />
      )}

      {tab==="articles" && <ArticlesManager />}

      {tab==="banners" && <BannerManager />}

      {tab==="subscribers" && <NewsletterSubscribers />}

      {(pm.editing || pm.showNew) && (
        <ProductEditorModal
          editing={Boolean(pm.editing)}
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
