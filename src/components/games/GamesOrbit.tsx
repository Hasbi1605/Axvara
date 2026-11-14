"use client";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { GameImage } from "./GameImage";
import { gamesFocus } from "./storefront";

/** Four fixed safe quadrants: labels never sweep through the central mark. */
export function GamesOrbit({ games }: { games: readonly Pick<GamesCatalogGame, "slug" | "name" | "icon">[] }) {
  return <div data-games-orbit className="relative h-[300px] w-full max-w-[440px] sm:h-[340px]">
    <div aria-hidden="true" className="absolute inset-[15%] rounded-full border border-[#00E5FF]/15 bg-[#00E5FF]/[.02]" />
    <div aria-hidden="true" className="absolute inset-x-[3%] inset-y-[28%] -rotate-[25deg] rounded-[50%] border border-white/10" />
    <div aria-label="AXVARA Games" data-orbit-center className="absolute left-1/2 top-1/2 flex aspect-square w-[26%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[30%] border border-white/20 bg-white/[.07] shadow-[0_0_60px_rgba(0,229,255,.12)] backdrop-blur-xl">
      <GameImage src="/brand/games-mark.svg" name="AXVARA Games" className="h-[60%] w-[65%] !bg-transparent text-xl" imageClassName="brightness-0 invert object-contain" eager />
    </div>
    {games.slice(0, 4).map((game, i) => <a key={game.slug} href={`/games/${game.slug}`} aria-label={game.name} data-orbit-planet className={`absolute flex w-[32%] flex-col items-center gap-2 rounded-2xl py-2 text-center ${i < 2 ? "top-0" : "bottom-0"} ${i % 2 ? "right-0" : "left-0"} ${gamesFocus}`}>
      <GameImage src={game.icon} name={game.name} className="h-14 w-14 rounded-2xl border border-white/20 text-lg shadow-lg sm:h-16 sm:w-16" eager />
      <span className="max-w-full break-words rounded-full border border-white/10 bg-[#080C1E]/80 px-2.5 py-1 text-[11px] leading-4 text-white/75">{game.name}</span>
    </a>)}
  </div>;
}
