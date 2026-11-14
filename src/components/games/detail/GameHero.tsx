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
  // Koreksi owner 14 Nov 2026 malam: banner full-bleed kiri–kanan tapi ramping (±200/280/330 px),
  // kartu ikon 3D lebih besar & miring, info game di container di bawah banner.
  return <header data-game-header className="relative">
    <div className="relative h-[190px] w-full overflow-hidden bg-[#0F1430] sm:h-[260px] lg:h-[330px]">
      <GameImage src={game.banner} fallbackSrc={game.icon} banner name={game.name} framed={false} className="h-full w-full text-4xl" imageClassName="object-[center_35%]" eager />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#080C1E] via-[#080C1E]/25 to-[#080C1E]/10" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#00E5FF]/25 to-transparent" />
    </div>
    <div className="relative mx-auto grid max-w-[1280px] grid-cols-[112px_minmax(0,1fr)] items-end gap-x-4 gap-y-1 px-4 sm:grid-cols-[176px_minmax(0,1fr)] sm:gap-x-7 sm:px-6 lg:grid-cols-[212px_minmax(0,1fr)] lg:px-8">
      <div className={`${styles.perspective} -mt-14 h-28 w-28 sm:-mt-24 sm:h-44 sm:w-44 lg:-mt-28 lg:h-[212px] lg:w-[212px]`} onPointerMove={tilt} onPointerLeave={reset} onPointerCancel={reset}>
        <div className={`${styles.floating} h-full w-full`}><div ref={card} data-game-icon-card className={`${styles.iconCard} h-full w-full`}><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full text-3xl sm:text-5xl" imageClassName="scale-[1.1]" eager /></div></div>
      </div>
      <div className="min-w-0 pb-1 pt-3 sm:pt-4"><h1 className="font-display text-2xl font-bold leading-tight sm:text-[34px]">{game.name}</h1>{game.publisher && <p className="mt-1 text-xs text-white/60 sm:text-sm">{game.publisher}</p>}</div>
      <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:-mt-1"><TrustIcons t={t} /></div>
    </div>
  </header>;
}
