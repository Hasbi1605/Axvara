"use client";
import Link from "next/link";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { gamesCopy } from "@/lib/games/copy";
import { GameImage } from "./GameImage";

export const gamesFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00E5FF]";
export function GameCard({ game, t }: { game: GamesCatalogGame; t: ReturnType<typeof gamesCopy> }) {
  const sellable = game.sellable_count > 0 && game.min_price !== null;
  const status = sellable ? `${t.startingAt} Rp${game.min_price!.toLocaleString("id-ID")}` : t.comingSoon;
  return <Link href={`/games/${game.slug}`} aria-label={`${game.name} ${status}`} className={`group relative block aspect-[2/3] min-w-0 rounded-2xl bg-[#080C1E] transition-[transform,box-shadow] duration-300 ease-out [@media(hover:hover)_and_(pointer:fine)]:hover:scale-[1.02] hover:shadow-[0_8px_28px_rgba(0,229,255,.12)] focus-visible:scale-[1.02] focus-visible:shadow-[0_8px_28px_rgba(0,229,255,.12)] motion-reduce:!transform-none motion-reduce:transition-none ${gamesFocus}`}>
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl border-[1.5px] border-[#00E5FF]/70 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
    <span className="absolute inset-0 overflow-hidden rounded-2xl bg-[#0F1430] transition-[inset,border-radius] duration-300 ease-out group-hover:inset-[4px] group-hover:rounded-[13px] group-focus-visible:inset-[4px] group-focus-visible:rounded-[13px] motion-reduce:transition-none">
      {game.portrait ? <GameImage src={game.portrait} name={game.name} framed={false} className="h-full w-full" imageClassName="transition-transform duration-500 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.08] group-focus-visible:scale-[1.08] motion-reduce:!transform-none motion-reduce:!transition-none" /> : <>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 scale-125 opacity-60 blur-2xl"><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full text-2xl" /></span>
        <GameImage src={game.icon} name={game.name} framed={false} className="aspect-square w-full text-2xl [mask-image:linear-gradient(black_65%,transparent)]" imageClassName="!object-contain" />
      </>}
      <span data-game-overlay className="absolute inset-0 bg-gradient-to-t from-[#080C1E] via-[#080C1E]/25 to-transparent opacity-100 transition-opacity duration-300 ease-out [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:!opacity-100 group-focus-visible:!opacity-100 motion-reduce:transition-none" />
      <span data-game-overlay className="absolute inset-x-0 bottom-0 p-2 opacity-100 transition-[opacity,transform] duration-300 ease-out sm:p-3.5 [@media(hover:hover)_and_(pointer:fine)]:translate-y-3 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:!translate-y-0 group-hover:!opacity-100 group-focus-visible:!translate-y-0 group-focus-visible:!opacity-100 motion-reduce:!transform-none motion-reduce:transition-none">
        <span className="line-clamp-2 font-display text-[11px] font-bold leading-tight text-white sm:text-base sm:leading-snug">{game.name}</span>
        <span className="mt-1 hidden truncate text-xs text-white/70 sm:block">{game.publisher}</span>
        <span className={sellable ? "mt-1 block text-[10px] tabular-nums text-white/85 sm:mt-2 sm:text-xs" : "mt-1 inline-block rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-white/70 sm:mt-2 sm:px-2 sm:py-1 sm:text-[11px]"}>{status}</span>
      </span>
    </span>
  </Link>;
}
