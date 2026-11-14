"use client";
import Link from "next/link";
import { CreditCard, Gamepad2, IdCard, Sparkles } from "lucide-react";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { gamesCopy } from "@/lib/games/copy";
import { GameImage } from "./GameImage";

export const gamesFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00E5FF]";
export function GameCard({ game, t }: { game: GamesCatalogGame; t: ReturnType<typeof gamesCopy> }) {
  const sellable = game.sellable_count > 0 && game.min_price !== null;
  return <Link href={`/games/${game.slug}`} className={`group min-w-0 rounded-2xl ${!sellable ? "opacity-70" : ""} ${gamesFocus}`}>
    <GameImage src={game.icon} name={game.name} className="aspect-square w-full text-2xl" imageClassName="transition duration-300 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none" />
    <span className="mt-3 block truncate font-display text-sm font-bold text-white sm:text-base">{game.name}</span>
    {sellable ? <span className="mt-1 block text-xs tabular-nums text-white/80">{t.startingAt} <span className="font-display">Rp{game.min_price!.toLocaleString("id-ID")}</span></span>
      : <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/55">{t.comingSoon}</span>}
  </Link>;
}

export function HowToTopUp({ t }: { t: ReturnType<typeof gamesCopy> }) {
  const icons = [Gamepad2, IdCard, CreditCard, Sparkles];
  return <section><h2 className="font-display text-2xl font-bold">{t.how}</h2><p className="mt-2 text-sm text-white/55">{t.howSub}</p>
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{t.steps.map((step, i) => { const Icon = icons[i]; return <div key={step} className="ax-glass rounded-2xl border border-white/10 p-5"><Icon size={20} strokeWidth={1.75} className="text-[#00E5FF]" /><span className="mt-6 block text-xs text-[#FFB800]">0{i + 1}</span><h3 className="mt-2 font-display text-sm font-bold sm:text-base">{step}</h3><p className="mt-2 text-xs leading-5 text-white/60">{t.stepDescriptions[i]}</p></div>; })}</div>
  </section>;
}
