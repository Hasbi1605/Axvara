"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CircleHelp, CreditCard, Gamepad2, IdCard, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Typewriter } from "@/components/pedia/Typewriter";
import { PediaOrbit } from "@/components/pedia/PediaOrbit";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { SITE, waHubLink } from "@/lib/site";

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00E5FF]";

function GameCard({ game, large = false }: { game: GamesCatalogGame; large?: boolean }) {
  return <Link href={`/games/${game.slug}`} className={`group min-w-0 rounded-2xl ${focus}`}>
    <div className={`overflow-hidden rounded-2xl border border-white/10 bg-[#0F1430] ${large ? "aspect-[4/3]" : "aspect-square"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={game.icon ?? ""} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none" />
    </div><span className="mt-3 block truncate font-display text-sm font-bold text-white sm:text-base">{game.name}</span><span className="mt-1 block truncate text-xs text-white/50">{game.publisher}</span>
  </Link>;
}

export function GamesHome({ games, orbitGames, orderingOpen }: { games: GamesCatalogGame[]; orbitGames: readonly Pick<GamesCatalogGame, "slug" | "name" | "icon">[]; orderingOpen: boolean }) {
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const [expanded, setExpanded] = useState(false);
  const orbitItems = useMemo(() => orbitGames.map((game, ring) => ({ label: game.name, icon: game.icon ?? "", color: "#00E5FF", ring, href: `/games/${game.slug}` })), [orbitGames]);
  const steps = [Gamepad2, IdCard, CreditCard, Sparkles];
  return <>
    {!orderingOpen && <div className="border-b border-[#FFB800]/20 bg-[#FFB800]/[.07] px-4 py-3 text-center text-sm text-[#ffe2a1]" role="status">{t.notice}</div>}
    <section className="relative overflow-hidden mx-auto max-w-[1280px] px-4 pb-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,229,255,0.08),transparent_65%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-display text-[clamp(32px,9.3vw,40px)] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[clamp(48px,4.85vw,62px)]"><span className="block">{t.heroFirst}</span><span className="block">{t.heroSecond}</span><Typewriter locale={locale} words={t.words} screenReaderText={t.words.join(", ")} /></h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-white/60">{t.heroBody}</p>
          <div className="mt-6 flex flex-wrap gap-3"><a href="#games-catalog" className={`inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#080C1E] ${focus}`}>{t.catalog}</a><a href={SITE.webUrl + waHubLink()} className={`inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-6 text-sm font-medium text-white/85 ${focus}`}>{t.whatsapp}</a></div>
          <p className="mt-5 text-xs leading-5 text-white/45">{t.heroTrust}</p>
        </div>
        <div className="flex min-w-0 justify-center lg:justify-end shrink-0 mt-6 lg:mt-0"><PediaOrbit items={orbitItems} brand="Games" mark="/brand/games-mark.svg" /></div>
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2"><div className="flex flex-row gap-2 sm:gap-3"><CrossServicePromo current="games" target="market" locale={locale} /><CrossServicePromo current="games" target="pedia" locale={locale} /></div></div>
    <div className="mx-auto max-w-[1280px] space-y-20 px-5 py-16 sm:px-6 lg:px-8">
      {games.length > 8 && <section><h2 className="font-display text-2xl font-bold">{t.popular}</h2><p className="mt-2 text-sm text-white/50">{t.popularSub}</p><div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">{games.slice(0, 8).map((game) => <GameCard key={game.slug} game={game} large />)}</div></section>}
      <section id="games-catalog" className="scroll-mt-24"><h2 className="font-display text-2xl font-bold">{t.catalog}</h2><p className="mt-2 text-sm text-white/50">{t.catalogSub}</p>{games.length ? <><div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-7 sm:grid-cols-4 sm:gap-6 lg:grid-cols-6">{(expanded ? games : games.slice(0, 12)).map((game) => <GameCard key={game.slug} game={game} />)}</div>{games.length > 12 && !expanded && <button onClick={() => setExpanded(true)} className={`mt-8 min-h-11 rounded-full border border-white/20 px-6 text-sm ${focus}`}>{t.more}</button>}</> : <p className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.empty}</p>}</section>
      <section><h2 className="font-display text-2xl font-bold">{t.how}</h2><p className="mt-2 text-sm text-white/50">{t.howSub}</p><div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{t.steps.map((step, i) => { const Icon = steps[i]; return <div key={step} className="ax-glass rounded-2xl border border-white/10 p-5"><Icon size={20} strokeWidth={1.75} className="text-[#00E5FF]" /><span className="mt-6 block text-xs text-[#FFB800]">0{i + 1}</span><h3 className="mt-2 font-display text-sm font-bold sm:text-base">{step}</h3><p className="mt-2 text-xs leading-5 text-white/60">{t.stepDescriptions[i]}</p></div>; })}</div></section>
      <section className="rounded-[28px] border border-white/10 bg-[radial-gradient(ellipse_at_top_right,rgba(0,229,255,.13),transparent_55%)] p-6 sm:p-10"><div className="grid gap-8 md:grid-cols-2"><div><h2 className="font-display text-2xl font-bold">{t.trust}</h2><p className="mt-3 max-w-md text-sm leading-7 text-white/60">{t.trustBody}</p></div><div className="space-y-4 text-sm"><p className="flex items-center gap-3"><Zap size={20} strokeWidth={1.75} className="text-[#FFB800]" />{t.automatic}</p><p className="flex items-center gap-3"><ShieldCheck size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{t.payments}</p><div className="flex flex-wrap items-center gap-3">{["/brand/qris.svg", "/payments/bca.svg", "/payments/gopay.svg", "/payments/usdt.png"].map((src) => <div key={src} className={`flex h-10 w-16 items-center justify-center rounded-lg p-2 ${src.includes("qris") ? "bg-[#27304b]" : "bg-white"}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={src.split("/").pop()?.split(".")[0]?.toUpperCase()} className="max-h-full max-w-full" /></div>)}</div><a href={SITE.webUrl + waHubLink()} className={`inline-flex min-h-11 items-center gap-2 text-[#00E5FF] ${focus}`}><CircleHelp size={20} strokeWidth={1.75} />{t.whatsapp}<ArrowRight size={16} /></a></div></div></section>
      <section><h2 className="font-display text-2xl font-bold">{t.faq}</h2><div className="mt-6 divide-y divide-white/10 border-y border-white/10">{t.questions.map((question, i) => <details key={question} className="group py-4"><summary className={`cursor-pointer list-none py-2 font-display font-semibold ${focus}`}>{question}<span className="float-right text-[#00E5FF] group-open:rotate-45">+</span></summary><p className="max-w-2xl pb-2 pt-2 text-sm leading-7 text-white/60">{t.answers[i]}</p></details>)}</div></section>
    </div>
  </>;
}
