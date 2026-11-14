"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Crosshair, Crown, LayoutGrid, Smile, Swords, Trophy, WandSparkles, type LucideIcon } from "lucide-react";
import { PediaOrbit, type OrbitItem } from "@/components/pedia/PediaOrbit";
import { Typewriter } from "@/components/pedia/Typewriter";
import { GameImage } from "@/components/games/GameImage";
import { GameCard, gamesFocus as focus } from "@/components/games/storefront";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import type { GamesCatalogGame } from "@/lib/games/catalog";
import { GAMES_GENRES, GAMES_GENRE_BY_SLUG, type GamesGenre } from "@/lib/games/genres";
import { GAMES_ORBIT_PHASE, GAMES_ORBIT_RINGS, selectPopularGames } from "@/lib/games/popular";
import { SITE, waHubLink } from "@/lib/site";

/** Ikon chip kategori — gaya chip disamakan dengan katalog Pedia/Market. */
const GENRE_ICONS: Record<GamesGenre, LucideIcon> = {
  all: LayoutGrid, moba: Swords, shooter: Crosshair, rpg: WandSparkles, sports: Trophy, strategy: Crown, casual: Smile,
};

export function GamesHome({ games, orbitGames, orderingOpen }: { games: GamesCatalogGame[]; orbitGames: readonly Pick<GamesCatalogGame, "slug" | "name" | "icon">[]; orderingOpen: boolean }) {
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const [genre, setGenre] = useState<GamesGenre>("all");
  /** Fade tepi kanan baris chip di HP sebagai petunjuk bisa digeser; hilang saat mentok kanan. */
  const [chipsAtEnd, setChipsAtEnd] = useState(false);
  // Orbit animasi (mesin PediaOrbit, rAF + reduced-motion statis) dengan art game penuh di tiap planet.
  const orbitItems = useMemo<OrbitItem[]>(() => orbitGames.slice(0, GAMES_ORBIT_RINGS.length).map((game, i) => ({
    label: game.name, icon: game.icon ?? "", color: "#00E5FF", ring: GAMES_ORBIT_RINGS[i], href: `/games/${game.slug}`,
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
        <div className="mt-2 flex min-w-0 shrink-0 justify-center lg:mt-0 lg:justify-end"><PediaOrbit items={orbitItems} ringPhase={GAMES_ORBIT_PHASE} brand="Games" mark="/brand/games-mark.svg" renderIcon={(item) => <GameImage src={item.icon || null} name={item.label} framed={false} className="h-full w-full rounded-full text-[11px]" eager />} /></div>
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2"><div className="flex flex-row gap-2 sm:gap-3"><CrossServicePromo current="games" target="market" locale={locale} /><CrossServicePromo current="games" target="pedia" locale={locale} /></div></div>
    <div className="mx-auto max-w-[1280px] space-y-20 px-5 py-16 sm:px-6 lg:px-8">
      {popular.length > 0 && <section aria-labelledby="games-popular">
        <h2 id="games-popular" className="flex items-center gap-2.5 font-display text-2xl font-bold">
          <span aria-hidden="true" className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
            <span className="ax-flame-glow absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255,140,0,.55),rgba(255,184,0,.18)_45%,transparent_70%)] blur-[6px]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/games/ui/fire-3d.webp" alt="" width={28} height={28} decoding="async" referrerPolicy="no-referrer" className="ax-flame relative h-7 w-7 drop-shadow-[0_2px_6px_rgba(255,120,0,.35)]" />
          </span>
          {t.popular}
        </h2>
        <p className="mt-2 text-sm text-white/50">{t.popularSub}</p>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-4 lg:grid-cols-3">{popular.map((game, i) => <Link key={game.slug} style={{ ["--sheen-delay" as string]: `${i * 0.15}s` }} href={`/games/${game.slug}`} className={`${popular.length % 2 === 1 && i === popular.length - 1 ? "max-sm:hidden " : ""}group relative flex min-h-[60px] min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-[#0F1430] p-2 sm:min-h-24 sm:gap-4 sm:rounded-2xl sm:p-3 transition-[transform,border-color,box-shadow] duration-300 [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5 hover:border-[#00E5FF]/50 hover:shadow-[0_0_24px_rgba(0,229,255,.12)] focus-visible:-translate-y-0.5 focus-visible:border-[#00E5FF]/50 focus-visible:shadow-[0_0_24px_rgba(0,229,255,.12)] motion-reduce:!transform-none motion-reduce:transition-none ${focus}`}>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 scale-150 opacity-75 saturate-150 blur-2xl"><GameImage src={game.icon} name={game.name} framed={false} className="h-full w-full" /></span>
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0px,transparent_12px,rgba(255,255,255,.04)_12px,rgba(255,255,255,.04)_24px)]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_18%,rgba(8,12,30,.65)_36%,rgba(8,12,30,.2)_100%)]" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <span className="ax-card-sheen absolute inset-y-0 left-0 w-1/4 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.10)_45%,rgba(160,240,255,.16)_50%,rgba(255,255,255,.10)_55%,transparent)]" />
            <span className="ax-card-sheen-hover absolute inset-y-0 left-0 w-1/4 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,.12)_45%,rgba(160,240,255,.2)_50%,rgba(255,255,255,.12)_55%,transparent)]" />
          </span>
          <GameImage src={game.icon} name={game.name} className="relative h-10 w-10 !rounded-lg !border-white/15 text-sm sm:h-[72px] sm:w-[72px] sm:!rounded-xl sm:text-xl" imageClassName="scale-[1.14] transition-transform duration-500 ease-out [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.2] group-focus-visible:scale-[1.2] motion-reduce:!transition-none" />
          <span className="relative min-w-0"><span className="line-clamp-2 font-display text-[12px] font-bold leading-tight text-white sm:line-clamp-1 sm:text-base">{game.name}</span><span className="mt-0.5 block truncate text-[10px] text-white/55 sm:mt-1 sm:text-sm">{game.publisher}</span></span>
        </Link>)}</div>
      </section>}
      <section id="games-catalog" aria-labelledby="games-catalog-heading" className="scroll-mt-24">
        <div className="flex items-baseline gap-3"><h2 id="games-catalog-heading" className="font-display text-2xl font-bold">{t.catalog}</h2><span aria-live="polite" aria-atomic="true" className="text-sm text-white/50">{filtered.length} {t.gamesCount}</span></div>
        {games.length ? <>
          <div role="group" aria-label={t.genresLabel} data-genre-chips data-at-end={chipsAtEnd} onScroll={(e) => { const el = e.currentTarget; setChipsAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4); }} className={`-mx-1 mt-5 flex gap-1.5 overflow-x-auto px-1 py-2 scrollbar-none sm:flex-wrap sm:gap-2 sm:overflow-visible sm:[mask-image:none] ${chipsAtEnd ? "" : "[mask-image:linear-gradient(to_right,black_78%,transparent)]"}`}>{genres.map((key) => { const Icon = GENRE_ICONS[key]; const active = genre === key; return <button key={key} type="button" aria-pressed={active} onClick={() => setGenre(key)} className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition motion-reduce:transition-none ${active ? "border-white bg-white text-[#080C1E] shadow" : "ax-glass-card border-white/10 text-white/70 hover:bg-white/10 hover:text-white"} ${focus}`}><Icon size={15} strokeWidth={2} aria-hidden="true" className={active ? "opacity-100" : "opacity-70"} />{t.genres[key]}</button>; })}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">{filtered.map((game) => <GameCard key={game.slug} game={game} t={t} />)}</div>
        </> : <p className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.empty}</p>}
      </section>
    </div>
  </>;
}
