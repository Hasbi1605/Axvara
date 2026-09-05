"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";

export type AdminSection = "summary" | "products" | "orders" | "categories" | "payments" | "articles" | "banners" | "subscribers" | "bot" | "agent" | "settings";

const navigationGroups: { label: string; items: [AdminSection, string, IosIconName][] }[] = [
  { label: "Operasional", items: [
    ["summary", "Ringkasan", "dashboard"],
    ["orders", "Pesanan", "purchase-order"],
  ] },
  { label: "Katalog", items: [
    ["products", "Produk", "box"],
    ["categories", "Kategori", "category"],
  ] },
  { label: "Pembayaran", items: [
    ["payments", "Metode & Rekonsiliasi", "credit-card"],
  ] },
  { label: "Konten", items: [
    ["articles", "Artikel", "news"],
    ["banners", "Banner", "image"],
    ["subscribers", "Subscriber Email", "news"],
  ] },
  { label: "Otomasi", items: [
    ["bot", "Kanal & Fulfillment", "bot"],
  ] },
  { label: "Sistem", items: [
    ["agent", "Integrasi Agent", "bot"],
    ["settings", "Pengaturan Toko", "settings"],
  ] },
];

const navigation = navigationGroups.flatMap((group) => group.items);

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
  const [collapsed, setCollapsed] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem("axvara-admin-sidebar") === "collapsed");
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobilePanelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const toggle = () => setCollapsed((current) => {
    const next = !current;
    localStorage.setItem("axvara-admin-sidebar", next ? "collapsed" : "expanded");
    return next;
  });

  const sidebar = (
    <aside aria-label="Navigasi admin" className={`flex h-full w-[260px] shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-[#090e25] p-3 transition-[width] duration-200 ${collapsed ? "lg:w-[72px]" : "lg:w-[260px]"}`}>
      <div className="flex h-10 items-center justify-between px-2">
        <Link href="/admin?section=summary" className="font-semibold tracking-[.12em] text-white">
          <span className={collapsed ? "lg:hidden" : ""}>AXVARA</span>
          {collapsed && <span className="hidden lg:inline">A</span>}
        </Link>
        <button
          onClick={toggle}
          className="hidden h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white lg:flex"
          aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
          title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
        >
          <IosIcon name="menu" size={14} tint="white" />
        </button>
        <button onClick={() => setMobileOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 lg:hidden" aria-label="Tutup navigasi admin">
          <IosIcon name="close" size={14} tint="white" />
        </button>
      </div>
      <nav className="mt-4 space-y-3">
        {navigationGroups.map((group) => <div key={group.label}>
          <p className={`mb-1 px-3 text-[9px] font-bold uppercase tracking-[0.14em] text-white/25 ${collapsed ? "lg:hidden" : ""}`}>{group.label}</p>
          <div className="space-y-1">{group.items.map(([id, label, icon]) => {
            const active = section === id;
            const badge = badges[id] ?? 0;
            return (
              <button
                key={id}
                onClick={() => { onSection(id); setMobileOpen(false); }}
                title={collapsed ? label : undefined}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left text-sm transition ${active ? "bg-[#00E5FF] font-bold text-[#070a1e]" : "text-white/65 hover:bg-white/[0.08] hover:text-white"}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <IosIcon name={icon} size={16} tint={active ? "black" : "white"} className={active ? "" : "opacity-80"} />
                </span>
                <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>{label}</span>
                {badge > 0 && <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${active ? "bg-[#07101f]/15 text-[#07101f]" : "bg-[#FFB800]/15 text-[#FFCF55]"} ${collapsed ? "lg:hidden" : ""}`}>{badge > 99 ? "99+" : badge}</span>}
              </button>
            );
          })}</div>
        </div>)}
      </nav>
      <div className="mt-auto space-y-1 border-t border-white/10 pt-3">
        <Link href="/" className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-white/65 hover:bg-white/5 hover:text-white">
          <IosIcon name="external-link" size={16} tint="white" className="opacity-80" />
          <span className={collapsed ? "lg:hidden" : ""}>Lihat Toko</span>
        </Link>
        <p className={`flex items-center gap-1.5 px-3 py-1 text-[11px] text-emerald-300/70 ${collapsed ? "lg:hidden" : ""}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Sesi aktif
        </p>
        <button
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.assign("/"); }}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-red-300 hover:bg-red-500/10"
          aria-label="Keluar dari admin"
        >
          <IosIcon name="exit" size={16} tint="white" className="[&>img]:!invert-0 w-4 h-4 rounded-full bg-red-500/15 flex items-center justify-center p-0.5" />
          <span className={collapsed ? "lg:hidden" : ""}>Keluar</span>
          {collapsed && <span className="hidden items-center justify-center lg:inline-flex"><IosIcon name="exit" size={14} tint="white" /></span>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-[#070a1e]">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-3 border-b border-white/10 bg-[#090e25]/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-white" aria-label="Buka navigasi admin"><IosIcon name="menu" size={16} tint="white" /></button>
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <IosIcon name={navigation.find(([id]) => id === section)?.[2] ?? "dashboard"} size={16} tint="white" />
          {navigation.find(([id]) => id === section)?.[1]}
        </span>
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)}>
          <div ref={mobilePanelRef} role="dialog" aria-modal="true" aria-label="Menu admin" className="h-full w-[260px]" onClick={(event) => event.stopPropagation()}>{sidebar}</div>
        </div>
      )}
      <main className="min-w-0 flex-1 pt-12 lg:pt-0">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
