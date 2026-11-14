"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleHelp, Flame, Plus, ShieldCheck, Zap } from "lucide-react";
import { PediaOrbit, type OrbitItem } from "@/components/pedia/PediaOrbit";
import { Typewriter } from "@/components/pedia/Typewriter";
import { GameImage } from "@/components/games/GameImage";
import { GameCard, HowToTopUp, gamesFocus as focus } from "@/components/games/storefront";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { GAMES_GENRES, GAMES_GENRE_BY_SLUG, type GamesGenre } from "@/lib/games/genres";
import { selectPopularGames } from "@/lib/games/popular";
import { SITE, waHubLink } from "@/lib/site";

export function GamesHome({ games, orbitGames, orderingOpen }: { games: GamesCatalogGame[]; orbitGames: readonly Pick<GamesCatalogGame, "slug" | "name" | "icon">[]; orderingOpen: boolean }) {
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const [genre, setGenre] = useState<GamesGenre>("all");
  // Orbit animasi (mesin PediaOrbit, rAF + reduced-motion statis) dengan art game penuh di tiap planet.
  const orbitItems = useMemo<OrbitItem[]>(() => orbitGames.slice(0, 4).map((game, ring) => ({
    label: game.name, icon: game.icon ?? "", color: "#00E5FF", ring, href: `/games/${game.slug}`,
  })), [orbitGames]);
  const popular = selectPopularGames(games);
  const genres = GAMES_GENRES.filter((key) => key === "all" || games.some((game) => GAMES_GENRE_BY_SLUG[game.slug] === key));
  const filtered = genre === "all" ? games : games.filter((game) => GAMES_GENRE_BY_SLUG[game.slug] === genre);
  return <>
    {!orderingOpen && <div className="border-b border-white/10 bg-white/[.03] px-4 py-3 text-center text-sm text-white/70" role="status">{t.notice}</div>}
    <section className="relative overflow-hidden mx-auto max-w-[1280px] px-4 pb-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,229,255,0.08),transparent_65%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-8">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-display text-[clamp(32px,9.3vw,40px)] font-bold leading-[1.08] tracking-[-0.02em] text-white sm:text-[56px] lg:text-[clamp(48px,4.85vw,62px)]"><span className="block">{t.heroFirst}</span><span className="block">{t.heroSecond}</span><Typewriter locale={locale} words={t.words} screenReaderText={t.words.join(", ")} /></h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-6 text-white/60">{t.heroBody}</p>
          <div className="mt-6 flex flex-wrap gap-3"><a href="#games-catalog" className={`inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-[#080C1E] ${focus}`}>{t.heroCta}</a><a href={SITE.webUrl + waHubLink()} className={`inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/5 px-6 text-sm font-medium text-white/85 ${focus}`}>{t.whatsapp}</a></div>
          <p className="mt-5 text-xs leading-5 text-white/45">{t.heroTrust}</p>
        </div>
        <div className="mt-2 flex min-w-0 shrink-0 justify-center lg:mt-0 lg:justify-end"><PediaOrbit items={orbitItems} brand="Games" mark="/brand/games-mark.svg" renderIcon={(item) => <GameImage src={item.icon || null} name={item.label} framed={false} className="h-full w-full rounded-full text-[11px]" eager />} /></div>
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2"><div className="flex flex-row gap-2 sm:gap-3"><CrossServicePromo current="games" target="market" locale={locale} /><CrossServicePromo current="games" target="pedia" locale={locale} /></div></div>
    <div className="mx-auto max-w-[1280px] space-y-20 px-5 py-16 sm:px-6 lg:px-8">
      {popular.length > 0 && <section aria-labelledby="games-popular">
        <h2 id="games-popular" className="flex items-center gap-2.5 font-display text-2xl font-bold"><Flame size={22} strokeWidth={1.75} aria-hidden="true" className="text-[#FFB800]" />{t.popular}</h2>
        <p className="mt-2 text-sm text-white/50">{t.popularSub}</p>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">{popular.map((game) => <Link key={game.slug} href={`/games/${game.slug}`} className={`group relative flex min-h-24 min-w-0 items-center gap-4 overflow-hidden rounded-2xl border border-white/10 bg-[#0F1430] p-3 transition-[transform,border-color,box-shadow] duration-300 [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 hover:border-[#00E5FF]/50 hover:shadow-[0_0_24px_rgba(0,229,255,.12)] focus-visible:-translate-y-0.5 focus-visible:border-[#00E5FF]/50 focus-visible:shadow-[0_0_24px_rgba(0,229,255,.12)] motion-reduce:!transform-none motion-reduce:transition-none ${focus}`}>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 scale-150 opacity-75 saturate-150 blur-2xl"><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full" /></span>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0px,transparent_12px,rgba(255,255,255,.04)_12px,rgba(255,255,255,.04)_24px)]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_18%,rgba(8,12,30,.65)_36%,rgba(8,12,30,.2)_100%)]" />
          <GameImage src={game.icon} name={game.name} className="h-16 w-16 !rounded-xl text-xl sm:h-[72px] sm:w-[72px]" imageClassName="transition-transform duration-300 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:!transform-none motion-reduce:transition-none" />
          <span className="relative min-w-0"><span className="block truncate font-display font-bold text-white">{game.name}</span><span className="mt-1 block truncate text-sm text-white/55">{game.publisher}</span></span>
        </Link>)}</div>
      </section>}
      <section id="games-catalog" aria-labelledby="games-catalog-heading" className="scroll-mt-24">
        <div className="flex items-baseline gap-3"><h2 id="games-catalog-heading" className="font-display text-2xl font-bold">{t.catalog}</h2><span aria-live="polite" aria-atomic="true" className="text-sm text-white/50">{filtered.length} {t.gamesCount}</span></div>
        <p className="mt-2 text-sm text-white/50">{t.catalogSub}</p>
        {games.length ? <>
          <div role="group" aria-label={t.genresLabel} className="-mx-1 mt-5 flex gap-2 overflow-x-auto px-1 py-2 sm:flex-wrap sm:overflow-visible">{genres.map((key) => <button key={key} type="button" aria-pressed={genre === key} onClick={() => setGenre(key)} className={`min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition-colors motion-reduce:transition-none ${genre === key ? "border-[#00E5FF]/50 bg-[#00E5FF]/15 text-white" : "border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"} ${focus}`}>{t.genres[key]}</button>)}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">{filtered.map((game) => <GameCard key={game.slug} game={game} t={t} />)}</div>
        </> : <p className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.empty}</p>}
      </section>
      <HowToTopUp t={t} />
      <section className="rounded-[28px] border border-white/10 bg-[radial-gradient(ellipse_at_top_right,rgba(0,229,255,.13),transparent_55%)] p-6 sm:p-10"><div className="grid gap-8 md:grid-cols-2"><div><h2 className="font-display text-2xl font-bold">{t.trust}</h2><p className="mt-3 max-w-md text-sm leading-7 text-white/60">{t.trustBody}</p></div><div className="space-y-4 text-sm"><p className="flex items-center gap-3"><Zap size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{t.automatic}</p><p className="flex items-center gap-3"><ShieldCheck size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{t.payments}</p><div className="flex flex-wrap items-center gap-3">{["/brand/qris.svg", "/payments/bca.svg", "/payments/gopay.svg", "/payments/usdt.png"].map((src) => { const name = src.split("/").pop()!.split(".")[0].toUpperCase(); return <span key={src} role="img" aria-label={name}><GameImage src={src} name={name} framed={false} className={`h-10 w-16 rounded-lg p-2 ${src.includes("qris") ? "" : "!bg-white"}`} imageClassName="object-contain" /></span>; })}</div><a href={SITE.webUrl + waHubLink()} className={`inline-flex min-h-11 items-center gap-2 text-[#00E5FF] ${focus}`}><CircleHelp size={20} strokeWidth={1.75} />{t.whatsapp}<ArrowRight size={16} /></a></div></div></section>
      <section><h2 className="font-display text-2xl font-bold">{t.faq}</h2><div className="mt-6 divide-y divide-white/10 border-y border-white/10">{t.questions.map((question, i) => <details key={question} className="group py-4"><summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-display font-semibold ${focus}`}>{question}<Plus size={20} strokeWidth={1.75} className="shrink-0 text-[#00E5FF] group-open:rotate-45" /></summary><p className="max-w-2xl pb-2 pt-2 text-sm leading-7 text-white/60">{t.answers[i]}</p></details>)}</div></section>
    </div>
  </>;
}
