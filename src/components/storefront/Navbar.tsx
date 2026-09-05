"use client";
import Link from "next/link";
import { X } from "lucide-react";
import { useCart } from "@/stores/cart";
import { useSearch } from "@/stores/search";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { IosIcon } from "@/components/ui/IosIcon";
import { useStoreSettings } from "@/hooks/useStoreSettings";

export function Navbar() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const count = useCart((s) => s.items.reduce((a, b) => a + b.qty, 0));
  const setDrawer = useCart((s) => s.setDrawer);
  const q = useSearch((s) => s.q);
  const setQ = useSearch((s) => s.setQ);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [shake, setShake] = useState(false);
  const storeSettings = useStoreSettings();
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      setShake(true);
      const t = setTimeout(() => setShake(false), 600);
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count]);

  const onSearch = (v: string) => {
    setQ(v);
    if (v.trim()) {
      document.getElementById("katalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (isAdmin) return null;

  return (
    <header className="sticky top-0 z-50 ax-glass-strong border-b border-white/10">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 h-[64px] flex items-center gap-4">
        <Link href="/" className="flex items-center gap-3 shrink-0 group" aria-label={storeSettings.name}>
          {/* Prism mark — wireframe, precise from chosen reference */}
          {storeSettings.logoUrl ? <span className="flex h-[32px] w-[36px] items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={storeSettings.logoUrl} alt="" className="h-full w-full object-contain" />
          </span> : <span className="w-[36px] h-[32px] text-white flex items-center justify-center">
            <svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
              <path d="M60 4 L6.5 104 L113.5 104 Z" />
              <path d="M60 4 L60 49.5" />
              <path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" />
              <path d="M35.8 78.5 L84.2 78.5" />
              <path d="M35.8 78.5 L6.5 104" />
              <path d="M84.2 78.5 L113.5 104" />
            </svg>
          </span>}
          <span className="max-w-[180px] truncate font-display font-[300] text-[22px] tracking-[0.16em] text-white leading-none">{storeSettings.name}</span>
          {/* VAULT badge removed */}
        </Link>

        <div className="hidden md:flex flex-1 max-w-[520px] mx-6">
          <div className="relative w-full">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Cari AI Gateway, ChatGPT Plus, Canva Pro..." className="w-full h-10 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40 focus:bg-white/[0.08] transition" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 transition" aria-label="Clear">
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button onClick={() => setMobileSearch((v) => !v)} className="md:hidden w-9 h-9 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label="Search">
            {mobileSearch ? <X className="w-4 h-4" /> : <IosIcon name="search" size={16} tint="white" />}
          </button>
          <nav className="hidden sm:flex items-center gap-1 text-sm text-white/70">
            <Link href="/#katalog" className="px-3 py-2 rounded-full hover:text-white hover:bg-white/10 transition">Katalog</Link>
            <Link href="/artikel" className="px-3 py-2 rounded-full hover:text-white hover:bg-white/10 transition">Artikel</Link>
          </nav>
          <button
            onClick={() => setDrawer(true)}
            className={`relative w-10 h-10 sm:w-auto sm:h-10 sm:px-4 rounded-full bg-[#00E5FF] text-[#080C1E] flex items-center justify-center gap-2 font-semibold text-sm shadow-[0_0_16px_rgba(0,229,255,0.35)] hover:shadow-[0_0_24px_rgba(0,229,255,0.45)] transition ${shake ? "animate-[cartShake_0.55s_cubic-bezier(0.34,1.56,0.64,1)]" : ""}`}
            aria-label="Keranjang"
          >
            <IosIcon name="shopping-bag" size={14} tint="black" />
            <span className="hidden sm:inline">Keranjang</span>
            {count > 0 && (
              <span className={`absolute -top-1 -right-1 sm:static sm:ml-1 min-w-[20px] h-5 px-1 rounded-full bg-[#FFB800] text-[#080C1E] text-xs font-bold flex items-center justify-center ${shake ? "animate-[cartPop_0.45s_ease-out]" : ""}`}>{count}</span>
            )}
          </button>
        </div>
      </div>
      {mobileSearch && (
        <div className="md:hidden px-4 pb-3">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60">
              <IosIcon name="search" size={16} tint="white" />
            </span>
            <input autoFocus value={q} onChange={(e) => onSearch(e.target.value)} placeholder="Cari produk..." className="w-full h-10 pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40" />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 transition" aria-label="Clear">
                <X className="w-3.5 h-3.5 text-white/70" />
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
