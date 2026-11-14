"use client";
import { useEffect, useRef, type PointerEvent } from "react";
import { GameImage } from "@/components/games/GameImage";
import type { GamesDetailGame } from "@/lib/games/catalog";
import type { gamesCopy } from "@/lib/games/copy";
import { TrustIcons } from "./TrustIcons";
import styles from "./detail.module.css";

export function GameHero({ game, t }: { game: GamesDetailGame; t: ReturnType<typeof gamesCopy> }) {
  const card = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    card.current?.style.removeProperty("--tilt-x");
    card.current?.style.removeProperty("--tilt-y");
  };
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.addEventListener("change", reset);
    return () => { reduced.removeEventListener("change", reset); reset(); };
  }, []);
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { x: Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1)), y: Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1)) };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      card.current?.style.setProperty("--tilt-x", `${-pointer.current.y * 10}deg`);
      card.current?.style.setProperty("--tilt-y", `${pointer.current.x * 10}deg`);
      frame.current = null;
    });
  };
  return <header data-game-header className="relative overflow-hidden rounded-3xl bg-[#0F1430]">
    <div className="relative aspect-[16/9] max-h-[440px] w-full sm:aspect-[21/9]">
      <GameImage src={game.banner} fallbackSrc={game.icon} banner name={game.name} className="h-full w-full text-4xl" imageClassName="object-[center_30%]" eager />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#0F1430] via-[#080C1E]/20 to-transparent" />
    </div>
    <div className="relative -mt-12 grid grid-cols-[96px_minmax(0,1fr)] items-end gap-x-4 gap-y-4 px-5 pb-6 sm:-mt-20 sm:grid-cols-[152px_minmax(0,1fr)] sm:gap-x-7 sm:px-8 sm:pb-8">
      <div className={`${styles.perspective} h-24 w-24 sm:h-[152px] sm:w-[152px]`} onPointerMove={tilt} onPointerLeave={reset} onPointerCancel={reset}>
        <div className={`${styles.floating} h-full w-full`}><div ref={card} data-game-icon-card className={`${styles.iconCard} h-full w-full`}><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full text-3xl sm:text-5xl" eager /></div></div>
      </div>
      <div className="min-w-0 pb-1"><h1 className="font-display text-2xl font-bold leading-tight sm:text-4xl">{game.name}</h1>{game.publisher && <p className="mt-2 text-xs text-white/60 sm:text-sm">{game.publisher}</p>}</div>
      <div className="col-span-2 -mt-1 sm:col-span-1 sm:col-start-2 sm:-mt-3"><TrustIcons t={t} /></div>
    </div>
  </header>;
}
