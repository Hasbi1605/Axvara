"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IosIcon, type IosIconName } from "@/components/admin/AdminIcon";
import { SupplierDropdown, SUPPLIER_ITEMS } from "./SupplierDropdown";
import { Button, Badge, TooltipProvider, Tooltip, TooltipTrigger, TooltipContent, Sheet, SheetContent, SheetTitle } from "./ui";
import { useToast } from "@/components/ui/Toast";
import { AdminThemeMenu, navigateWithDraftGuard } from "./AdminWorkspace";

export type AdminSection = "summary" | "products" | "orders" | "categories" | "payments" | "warung" | "sekalipay" | "tunvn" | "pairs" | "links" | "pedia" | "games" | "articles" | "banners" | "broadcasts" | "subscribers" | "bot" | "agent" | "settings";

const navigationGroups: { label: string; items: [AdminSection, string, IosIconName][] }[] = [
  { label: "Operasional", items: [
    ["summary", "Ringkasan", "dashboard"],
    ["orders", "Pesanan", "purchase-order"],
  ] },
  { label: "Katalog", items: [
    ["products", "Produk", "box"],
    ["categories", "Kategori", "category"],
    ["pedia", "Pedia", "lightning-bolt"],
    ["games", "Games", "star"],
  ] },
  { label: "Pembayaran", items: [
    ["payments", "Metode & Rekonsiliasi", "credit-card"],
  ] },
  // Grup Supplier dirender khusus sebagai dropdown (SupplierDropdown) agar
  // sidebar tidak memanjang: Warung Rebahan, Sekalipay, TUNVN, WR vs SK,
  // Link Supplier. Lihat render di bawah.
  { label: "Supplier", items: [] },
  { label: "Konten", items: [
    ["articles", "Artikel", "news"],
    ["banners", "Banner", "image"],
    ["broadcasts", "Siaran", "email"],
  ] },
  { label: "Otomasi", items: [
    ["bot", "Kanal & Fulfillment", "bot"],
  ] },
  { label: "Sistem", items: [
    // Integrasi Agent (token MCP, diatur sekali) dan Subscriber Email (daftar
    // baca-saja) dulu punya slot sidebar sejajar Pesanan/Produk padahal bukan
    // tempat kerja harian. Keduanya kini tab di dalam Pengaturan Toko —
    // nilai section-nya tetap sah agar tautan lama tidak mati.
    ["settings", "Pengaturan Toko", "settings"],
  ] },
];

const navigation: [AdminSection, string, IosIconName][] = [
  ...navigationGroups.flatMap((group) => group.items),
  ...SUPPLIER_ITEMS.map((item) => [item.id, item.label, item.icon] as [AdminSection, string, IosIconName]),
];

// Section yang sah tapi tidak punya entri sidebar (kini tab di Pengaturan).
// Tanpa ini header mobile menampilkan judul kosong saat ?section=agent dibuka
// dari tautan lama.
const sectionFallbackTitles: Partial<Record<AdminSection, [string, IosIconName]>> = {
  agent: ["Integrasi Agent", "chatbot"],
  subscribers: ["Subscriber Email", "email"],
};

export function AdminShell({
  section,
  onSection,
  children,
  badges = {},
}: {
  section: AdminSection;
  onSection: (section: AdminSection) => void;
  children: React.ReactNode;
  badges?: Partial<Record<AdminSection, number>>;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const toast = useToast();

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("axvara-admin-sidebar") === "collapsed"); } catch { /* Sidebar remains expanded if storage is blocked. */ }
  }, []);

  const toggle = () => setCollapsed((current) => {
    const next = !current;
    try { localStorage.setItem("axvara-admin-sidebar", next ? "collapsed" : "expanded"); } catch { /* Keep the preference in memory. */ }
    return next;
  });

  const sidebar = (mobile = false) => (
    <aside aria-label="Navigasi admin" className={`flex h-full shrink-0 flex-col overflow-y-auto border-r border-admin-border/60 bg-admin-card p-3 ${mobile ? "w-full" : collapsed ? "w-[72px]" : "w-[248px]"}`}>
      <div className={`flex h-10 items-center justify-between ${collapsed && !mobile ? "px-1" : "px-2"}`}>
        <Link href="/admin?section=summary" className={`font-semibold tracking-[.12em] text-admin-fg ${collapsed && !mobile ? "lg:hidden" : ""}`}>
          <span className={collapsed ? "lg:hidden" : ""}>AXVARA <span className="ml-1 text-xs font-normal tracking-normal text-admin-muted">Admin</span></span>
          {collapsed && <span className="hidden lg:inline">A</span>}
        </Link>
         <Button variant="ghost" size="icon"
          onClick={toggle}
          className="hidden items-center justify-center rounded-md text-admin-muted hover:bg-admin-subtle hover:text-admin-fg lg:flex"
          aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
          title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
        >
          <IosIcon name="menu" size={14} tint="white" />
         </Button>
      </div>
      <nav className="mt-4 space-y-3">
        {navigationGroups.map((group) => <div key={group.label}>
           <p className={`mb-1 px-3 text-xs font-medium text-admin-muted ${collapsed ? "lg:hidden" : ""}`}>{group.label}</p>
          {group.label === "Supplier" ? (
            <SupplierDropdown
              section={section}
              collapsed={!mobile && collapsed}
              badges={badges}
              onSection={(next) => { onSection(next); setMobileOpen(false); }}
            />
          ) : (
          <div className="space-y-1">{group.items.map(([id, label, icon]) => {
               const active = section === id || id === "settings" && ["agent", "subscribers"].includes(section);
            const badge = badges[id] ?? 0;
            return (
               <Tooltip key={id}><TooltipTrigger asChild><Button variant="ghost"
                onClick={() => { onSection(id); setMobileOpen(false); }}
                 title={collapsed ? label : undefined}
                 aria-label={label}
                aria-current={active ? "page" : undefined}
                 className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${active ? "bg-admin-subtle font-semibold text-admin-fg" : "text-admin-muted hover:bg-admin-subtle hover:text-admin-fg"}`}
              >
                 <span aria-hidden="true" className="flex w-5 shrink-0 items-center justify-center">
                  <IosIcon name={icon} size={16} tint={active ? "black" : "white"} className={active ? "" : "opacity-80"} />
                </span>
                <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>{label}</span>
                 {badge > 0 && <Badge variant="warning" className={collapsed ? "lg:hidden" : ""}>{badge > 99 ? "99+" : badge}</Badge>}
               </Button></TooltipTrigger>{collapsed && !mobile && <TooltipContent side="right">{label}</TooltipContent>}</Tooltip>
            );
          })}</div>
          )}
        </div>)}
      </nav>
      <div className="mt-auto space-y-1 border-t border-admin-border pt-3">
        <Tooltip><TooltipTrigger asChild><Link href="/" aria-label="Lihat Toko" className="flex h-10 items-center gap-3 rounded-md px-3 text-sm text-admin-muted hover:bg-admin-subtle hover:text-admin-fg">
          <IosIcon name="external-link" size={16} tint="white" className="opacity-80" />
          <span className={collapsed ? "lg:hidden" : ""}>Lihat Toko</span>
        </Link></TooltipTrigger>{collapsed && !mobile && <TooltipContent side="right">Lihat Toko</TooltipContent>}</Tooltip>
        <p className={`flex items-center gap-1.5 px-3 py-1 text-xs text-admin-success ${collapsed ? "lg:hidden" : ""}`}>
           <span className="h-1.5 w-1.5 rounded-md bg-admin-success" /> Sesi aktif
        </p>
         <Tooltip><TooltipTrigger asChild><Button variant="ghost"
          onClick={() => navigateWithDraftGuard(() => { void fetch("/api/auth/logout", { method: "POST" }).then(response => { if (!response.ok) throw new Error(); location.assign("/"); }).catch(() => toast.error("Gagal keluar. Coba lagi; sesi belum diubah.")); })}
           className="flex h-10 w-full justify-start gap-3 px-3 text-sm font-semibold text-admin-danger hover:bg-admin-danger/10"
          aria-label="Keluar dari admin"
        >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-admin-danger/15">
             <IosIcon name="exit" size={15} />
          </span>
          <span className={collapsed ? "lg:hidden" : ""}>Keluar</span>
         </Button></TooltipTrigger>{collapsed && !mobile && <TooltipContent side="right">Keluar</TooltipContent>}</Tooltip>
      </div>
    </aside>
  );

  return (
    <TooltipProvider delayDuration={250}><div className="flex min-h-screen bg-admin-bg">
      <a href="#admin-content" className="sr-only z-50 rounded-md bg-admin-primary p-3 text-admin-inverse focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Lewati ke konten</a>
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar()}</div>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-admin-border/60 bg-admin-card px-4 lg:hidden">
        <Button ref={mobileTrigger} variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Buka navigasi admin"><IosIcon name="menu" size={16} /></Button>
        <span className="flex items-center gap-2 text-sm font-semibold text-admin-fg">
          <IosIcon name={navigation.find(([id]) => id === section)?.[2] ?? sectionFallbackTitles[section]?.[1] ?? "dashboard"} size={16} tint="white" />
          {navigation.find(([id]) => id === section)?.[1] ?? sectionFallbackTitles[section]?.[0]}
        </span><div className="ml-auto"><AdminThemeMenu /></div>
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); mobileTrigger.current?.focus(); }} className="w-[280px]"><SheetTitle className="sr-only">Menu admin</SheetTitle>{sidebar(true)}</SheetContent></Sheet>
      <section id="admin-content" aria-label="Konten admin" tabIndex={-1} className="min-w-0 flex-1 pt-14 lg:pt-0">
        <header className="sticky top-0 z-30 hidden h-16 items-center gap-3 border-b border-admin-border/60 bg-admin-card px-6 lg:flex"><span className="text-sm text-admin-muted">Ruang kerja</span><span className="text-admin-border">/</span><span className="text-sm font-medium">{navigation.find(([id]) => id === section)?.[1] ?? sectionFallbackTitles[section]?.[0]}</span><div className="ml-auto"><AdminThemeMenu /></div></header>
        <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
      </section>
    </div></TooltipProvider>
  );
}
