"use client";
import Link from "next/link";
import { CreditCard, Gamepad2, IdCard, Sparkles } from "lucide-react";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { gamesCopy } from "@/lib/games/copy";
import { GameImage } from "./GameImage";

export const gamesFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00E5FF]";
export function GameCard({ game, t }: { game: GamesCatalogGame; t: ReturnType<typeof gamesCopy> }) {
  const sellable = game.sellable_count > 0 && game.min_price !== null;
  const status = sellable ? `${t.startingAt} Rp${game.min_price!.toLocaleString("id-ID")}` : t.comingSoon;
  return <Link href={`/games/${game.slug}`} aria-label={`${game.name} ${status}`} className={`group relative block aspect-[2/3] min-w-0 rounded-2xl bg-[#080C1E] transition-[transform,box-shadow] duration-300 ease-out [@media(hover:hover)_and_(pointer:fine)]:hover:scale-[1.045] hover:shadow-[0_0_24px_rgba(0,229,255,.2)] focus-visible:scale-[1.045] focus-visible:shadow-[0_0_24px_rgba(0,229,255,.2)] motion-reduce:!transform-none motion-reduce:transition-none ${gamesFocus}`}>
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl border-[3px] border-[#00E5FF] opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
    <span className="absolute inset-0 overflow-hidden rounded-2xl bg-[#0F1430] transition-[inset,border-radius] duration-300 ease-out group-hover:inset-[6px] group-hover:rounded-xl group-focus-visible:inset-[6px] group-focus-visible:rounded-xl motion-reduce:transition-none">
      {game.portrait ? <GameImage src={game.portrait} name={game.name} framed={false} className="h-full w-full" /> : <>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 scale-125 opacity-60 blur-2xl"><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full text-2xl" /></span>
        <GameImage src={game.icon} name={game.name} framed={false} className="aspect-square w-full text-2xl [mask-image:linear-gradient(black_65%,transparent)]" imageClassName="!object-contain" />
      </>}
      <span data-game-overlay className="absolute inset-0 bg-gradient-to-t from-[#080C1E] via-[#080C1E]/25 to-transparent opacity-100 transition-opacity duration-300 ease-out [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:!opacity-100 group-focus-visible:!opacity-100 motion-reduce:transition-none" />
      <span data-game-overlay className="absolute inset-x-0 bottom-0 p-3 opacity-100 transition-[opacity,transform] duration-300 ease-out sm:p-3.5 [@media(hover:hover)_and_(pointer:fine)]:translate-y-3 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:!translate-y-0 group-hover:!opacity-100 group-focus-visible:!translate-y-0 group-focus-visible:!opacity-100 motion-reduce:!transform-none motion-reduce:transition-none">
        <span className="line-clamp-2 font-display text-sm font-bold leading-snug text-white sm:text-base">{game.name}</span>
        <span className="mt-1 block truncate text-xs text-white/70">{game.publisher}</span>
        <span className={sellable ? "mt-2 block text-xs tabular-nums text-white/85" : "mt-2 inline-block rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70"}>{status}</span>
      </span>
    </span>
  </Link>;
}

export function HowToTopUp({ t }: { t: ReturnType<typeof gamesCopy> }) {
  const icons = [Gamepad2, IdCard, CreditCard, Sparkles];
  return <section><h2 className="font-display text-2xl font-bold">{t.how}</h2><p className="mt-2 text-sm text-white/55">{t.howSub}</p>
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{t.steps.map((step, i) => { const Icon = icons[i]; return <div key={step} className="ax-glass rounded-2xl border border-white/10 p-5"><Icon size={20} strokeWidth={1.75} className="text-[#00E5FF]" /><span className="mt-6 block text-xs text-[#FFB800]">0{i + 1}</span><h3 className="mt-2 font-display text-sm font-bold sm:text-base">{step}</h3><p className="mt-2 text-xs leading-5 text-white/60">{t.stepDescriptions[i]}</p></div>; })}</div>
  </section>;
}
