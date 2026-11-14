"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import type { gamesCopy } from "@/lib/games/copy";
import { GameCard, gamesFocus } from "./storefront";

/**
 * Karusel horizontal "Game lainnya" (koreksi owner 14 Nov 2026): swipe/scroll
 * dengan snap per kartu, panah ‹ › di desktop (redup di ujung), fade tepi
 * sebagai petunjuk masih ada kartu. Smooth scroll mengikuti reduced motion.
 */
export function GamesRail({ title, games, t }: { title: string; games: GamesCatalogGame[]; t: ReturnType<typeof gamesCopy> }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update, games.length]);
  const move = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: reduced ? "auto" : "smooth" });
  };
  const arrow = `hidden h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[.05] text-white/80 backdrop-blur-md transition hover:border-white/25 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30 sm:inline-flex ${gamesFocus}`;
  const fade = `${edge.start ? "" : "[--fade-l:48px]"} ${edge.end ? "" : "[--fade-r:48px]"}`;
  return <section aria-labelledby="games-rail-title">
    <div className="flex items-center justify-between gap-3">
      <h2 id="games-rail-title" className="font-display text-2xl font-bold">{title}</h2>
      <div className="flex gap-2">
        <button type="button" aria-label={t.railPrev} disabled={edge.start} onClick={() => move(-1)} className={arrow}><ChevronLeft size={18} strokeWidth={2} /></button>
        <button type="button" aria-label={t.railNext} disabled={edge.end} onClick={() => move(1)} className={arrow}><ChevronRight size={18} strokeWidth={2} /></button>
      </div>
    </div>
    <div
      ref={track}
      data-games-rail
      onScroll={update}
      className={`-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 py-3 scrollbar-none sm:-mx-1 sm:gap-4 sm:scroll-px-1 sm:px-1 [mask-image:linear-gradient(to_right,transparent,black_var(--fade-l,0px),black_calc(100%-var(--fade-r,0px)),transparent)] ${fade}`}
    >
      {games.map((game) => <div key={game.slug} className="w-[40%] shrink-0 snap-start sm:w-[28%] md:w-[22%] lg:w-[calc((100%-5*1rem)/6)]"><GameCard game={game} t={t} /></div>)}
    </div>
  </section>;
}
