"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";
import { ServicesMenu } from "@/components/shared/ServicesMenu";
import { PreferenceControls } from "@/components/storefront/PreferenceControls";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { GameImage } from "./GameImage";

export function GamesNavbar({ games }: { games: GamesCatalogGame[] }) {
  const t = gamesCopy(useDisplayLocale());
  const [mobileSearch, setMobileSearch] = useState(false);
  const [query, setQuery] = useState("");
  const matches = query.trim() ? games.filter((game) => game.name.toLowerCase().includes(query.trim().toLowerCase())) : [];
  const onSearch = (v: string) => {
    setQuery(v);
    if (v.trim()) document.getElementById("games-catalog")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const search = (mobile = false) => <div className="relative w-full">
    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-60"><IosIcon name="search" size={16} tint="white" /></span>
    <input aria-label={mobile ? t.searchToggle : t.searchAria} type="search" value={query} onChange={(event) => onSearch(event.target.value)} placeholder={mobile ? t.searchShort : t.searchPlaceholder} className={`w-full ${mobile ? "h-11 text-base" : "h-10 text-sm"} pl-10 pr-10 rounded-full bg-white/[0.06] border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#00E5FF]/40 ${mobile ? "" : "focus:bg-white/[0.08]"} transition`} />
    {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/15 transition" aria-label={t.clear}><X className="w-3.5 h-3.5 text-white/70" /></button>}
    {query.trim() && <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-2xl border border-white/15 bg-[#0F1430] p-2 shadow-xl">{matches.length ? matches.map((game) => <Link prefetch={false} key={game.slug} href={`/games/${game.slug}`} onClick={() => { setQuery(""); setMobileSearch(false); }} className="flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">{game.name}</Link>) : <p className="px-3 py-3 text-sm text-white/60">{t.noResults}</p>}</div>}
  </div>;
  return <header className="ax-glass-strong sticky top-0 z-50 border-b border-white/10">
    <div className="mx-auto flex h-[64px] max-w-[1280px] items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
      <Link prefetch={false} href="/games" className="flex min-w-0 shrink items-center gap-2 sm:gap-3" aria-label={`AXVARA Games ${t.home}`}>
        {/* 2026-11-10 (PM final, owner-delegated): mark Games = analog stick on the
            clean Pedia frame. File: public/brand/games-mark.svg (viewBox 144×128).
            currentColor tak turun ke <img>, jadi svg difilter putih via CSS
            (brightness(0) invert(1)) — pola sama persis dengan PediaNavbar. */}
        <GameImage src="/brand/games-mark.svg" name="AXVARA Games" framed={false} className="h-[32px] w-[36px] !bg-transparent" imageClassName="brightness-0 invert object-contain" eager />
        <span className="hidden whitespace-nowrap font-display text-[22px] font-[300] leading-none tracking-[0.16em] text-white md:inline">AXVARA GAMES</span>
        <span className="max-[343px]:hidden max-w-[130px] truncate whitespace-nowrap font-display text-[15px] font-[300] leading-none tracking-[0.12em] text-white md:hidden">AXVARA GAMES</span>
      </Link>
      <div className="hidden lg:flex min-w-0 flex-1 max-w-[520px] mx-2">{search()}</div>
      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2"><ServicesMenu active="games" />
        <button onClick={() => setMobileSearch((value) => !value)} className="lg:hidden shrink-0 w-11 h-11 rounded-full ax-glass flex items-center justify-center text-white/70" aria-label={t.searchToggle} aria-expanded={mobileSearch}>{mobileSearch ? <X className="w-4 h-4" /> : <IosIcon name="search" size={16} tint="white" />}</button>
        <nav aria-label={t.navigation} className="hidden items-center gap-1 text-sm text-white/70 xl:flex"><Link prefetch={false} href="/games/lacak" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">{t.trackFull}</Link><Link prefetch={false} href="/games/bantuan" className="rounded-full px-3 py-2 transition hover:bg-white/10 hover:text-white">{t.help}</Link></nav>
        <PreferenceControls />
      </div>
    </div>{mobileSearch && <div className="lg:hidden px-4 pb-3">{search(true)}</div>}
  </header>;
}

export function GamesBottomNav() {
  const t = gamesCopy(useDisplayLocale());
  const path = usePathname() ?? "/";
  const [hash, setHash] = useState("");
  useEffect(() => { const sync = () => setHash(window.location.hash); sync(); window.addEventListener("hashchange", sync); return () => window.removeEventListener("hashchange", sync); }, []);
  // Order bar (±64px + safe-area) replaces the global bottom nav only on game slug
  // pages (/games/[slug]); status/lacak/bantuan pages keep the nav (Lacak active on /pesanan/*).
  if (/^\/(?:games\/)?[a-z0-9-]+$/.test(path) && !["/games", "/lacak", "/bantuan", "/ketentuan", "/games/lacak", "/games/bantuan", "/games/ketentuan"].includes(path)) return null;
  const normalized = path.replace(/^\/games(?=\/|$)/, "") || "/";
  const tabs: { href: string; label: string; icon: IosIconName; active: boolean }[] = [
    { href: "/games", label: t.home, icon: "home", active: normalized === "/" && hash !== "#games-catalog" },
    { href: "/games#games-catalog", label: t.gamesTab, icon: "category", active: normalized === "/" && hash === "#games-catalog" },
    { href: "/games/lacak", label: t.track, icon: "purchase-order", active: normalized === "/lacak" || normalized.startsWith("/pesanan/") },
    { href: "/games/bantuan", label: t.help, icon: "chat", active: normalized === "/bantuan" },
  ];
  return <nav aria-label={t.navigation} className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#080C1E]/92 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.6)] backdrop-blur-xl md:hidden"><div className="flex items-center justify-around">{tabs.map((tab) => <Link prefetch={false} key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined} className="flex flex-1 justify-center"><span className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-1 transition-all duration-200 ${tab.active ? "text-[#00E5FF]" : "text-white/55 hover:text-white/90 active:scale-95"}`}><span aria-hidden className="relative flex h-6 w-6 items-center justify-center"><IosIcon name={tab.icon} size={20} tint={tab.active ? "#00E5FF" : "white"} className={tab.active ? "" : "opacity-55"} /></span><span className={`mt-1 text-[10.5px] leading-none tracking-tight ${tab.active ? "font-bold text-[#00E5FF]" : "font-medium"}`}>{tab.label}</span>{tab.active && <span aria-hidden className="mt-1 h-1 w-1 rounded-full bg-[#00E5FF] shadow-[0_0_4px_#00E5FF]" />}</span></Link>)}</div></nav>;
}
