"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleHelp, CreditCard, Gamepad2, IdCard, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { Typewriter } from "@/components/pedia/Typewriter";
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

function GamesOrbit({ games }: { games: GamesCatalogGame[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = container.current; if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0; let started = 0; let angle = 0; let visible = true;
    const draw = () => { const radius = root.clientWidth * .36; root.querySelectorAll<HTMLElement>("[data-planet]").forEach((element, index) => { const a = angle + index * Math.PI / 2; element.style.transform = `translate(-50%, -50%) translate(${Math.cos(a) * radius}px, ${Math.sin(a) * radius * .4}px)`; }); };
    const tick = (time: number) => { if (!visible || document.hidden || motion.matches) { frame = 0; return; } if (started) angle += Math.min(time - started, 100) * .00008; started = time; draw(); frame = requestAnimationFrame(tick); };
    const sync = () => { cancelAnimationFrame(frame); frame = 0; started = 0; draw(); if (visible && !document.hidden && !motion.matches) frame = requestAnimationFrame(tick); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); observer.observe(root);
    motion.addEventListener("change", sync); window.addEventListener("resize", sync); document.addEventListener("visibilitychange", sync); sync();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); motion.removeEventListener("change", sync); window.removeEventListener("resize", sync); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return <div ref={container} className="relative mx-auto h-[280px] w-[280px] sm:h-[400px] sm:w-[400px]" aria-label="AXVARA Games">
    {[54, 72, 91].map((size) => <div key={size} className="pointer-events-none absolute left-1/2 top-1/2 rounded-[50%] border border-white/15" style={{ width: `${size}%`, height: `${size * 0.4}%`, transform: "translate(-50%, -50%)" }} />)}
    <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-200/20 bg-[#101b32] shadow-[0_0_80px_rgba(0,229,255,.22)] sm:h-32 sm:w-32">
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/games-mark.svg" alt="" className="h-14 w-14 brightness-0 invert sm:h-20 sm:w-20" />
    </div>
    {games.slice(0, 4).map((game) => <Link data-planet key={game.slug} href={`/games/${game.slug}`} aria-label={game.name} className={`absolute left-1/2 top-1/2 z-10 flex flex-col items-center ${focus}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}<img src={game.icon ?? ""} alt="" className="h-11 w-11 rounded-full border-2 border-white/50 object-cover shadow-xl sm:h-14 sm:w-14" />
      <span className="absolute top-full mt-1 whitespace-nowrap rounded-full border border-white/10 bg-[#0F1430] px-2 py-1 text-[9px] text-white/80">{game.name}</span>
    </Link>)}
  </div>;
}

export function GamesHome({ games, orderingOpen }: { games: GamesCatalogGame[]; orderingOpen: boolean }) {
  const locale = useDisplayLocale();
  const t = gamesCopy(locale);
  const [expanded, setExpanded] = useState(false);
  const steps = [Gamepad2, IdCard, CreditCard, Sparkles];
  return <>
    {!orderingOpen && <div className="border-b border-[#FFB800]/20 bg-[#FFB800]/[.07] px-4 py-3 text-center text-sm text-[#ffe2a1]" role="status">{t.notice}</div>}
    <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_75%_45%,rgba(0,229,255,.12),transparent_45%),radial-gradient(ellipse_at_12%_75%,rgba(255,184,0,.07),transparent_40%)]">
      <div className="mx-auto grid max-w-[1280px] items-center gap-2 px-5 py-12 sm:px-6 md:grid-cols-2 md:py-16 lg:px-8">
        <div className="relative z-10"><p className="mb-5 text-xs font-bold tracking-[.25em] text-[#FFB800]">{t.eyebrow}</p><h1 className="font-display text-[36px] font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">{t.heroFirst}<br />{t.heroSecond}<Typewriter locale={locale} words={t.words} screenReaderText={t.words.join(", ")} /></h1><p className="mt-5 max-w-md text-sm leading-7 text-white/60 sm:text-base">{t.heroBody}</p><a href="#games-catalog" className={`mt-7 inline-flex min-h-12 items-center gap-3 rounded-full bg-[#00E5FF] px-6 text-sm font-bold text-[#080C1E] ${focus}`}>{t.catalog}<ArrowRight size={18} /></a></div>
        <GamesOrbit games={games} />
      </div>
    </section>
    <div className="mx-auto max-w-[1280px] space-y-20 px-5 py-16 sm:px-6 lg:px-8">
      {games.length > 8 && <section><h2 className="font-display text-2xl font-bold">{t.popular}</h2><p className="mt-2 text-sm text-white/50">{t.popularSub}</p><div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">{games.slice(0, 8).map((game) => <GameCard key={game.slug} game={game} large />)}</div></section>}
      <section id="games-catalog" className="scroll-mt-24"><h2 className="font-display text-2xl font-bold">{t.catalog}</h2><p className="mt-2 text-sm text-white/50">{t.catalogSub}</p>{games.length ? <><div className="mt-6 grid grid-cols-3 gap-x-3 gap-y-7 sm:grid-cols-4 sm:gap-6 lg:grid-cols-6">{(expanded ? games : games.slice(0, 12)).map((game) => <GameCard key={game.slug} game={game} />)}</div>{games.length > 12 && !expanded && <button onClick={() => setExpanded(true)} className={`mt-8 min-h-11 rounded-full border border-white/20 px-6 text-sm ${focus}`}>{t.more}</button>}</> : <p className="mt-6 rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center text-white/60">{t.empty}</p>}</section>
      <section><h2 className="font-display text-2xl font-bold">{t.how}</h2><p className="mt-2 text-sm text-white/50">{t.howSub}</p><div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{t.steps.map((step, i) => { const Icon = steps[i]; return <div key={step} className="ax-glass rounded-2xl border border-white/10 p-5"><Icon size={20} strokeWidth={1.75} className="text-[#00E5FF]" /><span className="mt-6 block text-xs text-[#FFB800]">0{i + 1}</span><h3 className="mt-2 font-display text-sm font-bold sm:text-base">{step}</h3><p className="mt-2 text-xs leading-5 text-white/60">{t.stepDescriptions[i]}</p></div>; })}</div></section>
      <section className="rounded-[28px] border border-white/10 bg-[radial-gradient(ellipse_at_top_right,rgba(0,229,255,.13),transparent_55%)] p-6 sm:p-10"><div className="grid gap-8 md:grid-cols-2"><div><h2 className="font-display text-2xl font-bold">{t.trust}</h2><p className="mt-3 max-w-md text-sm leading-7 text-white/60">{t.trustBody}</p></div><div className="space-y-4 text-sm"><p className="flex items-center gap-3"><Zap size={20} strokeWidth={1.75} className="text-[#FFB800]" />{t.automatic}</p><p className="flex items-center gap-3"><ShieldCheck size={20} strokeWidth={1.75} className="text-[#00E5FF]" />{t.payments}</p><div className="flex flex-wrap items-center gap-3">{["/brand/qris.svg", "/payments/bca.svg", "/payments/gopay.svg", "/payments/usdt.png"].map((src) => <div key={src} className={`flex h-10 w-16 items-center justify-center rounded-lg p-2 ${src.includes("qris") ? "bg-[#27304b]" : "bg-white"}`}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt={src.split("/").pop()?.split(".")[0]?.toUpperCase()} className="max-h-full max-w-full" /></div>)}</div><a href={SITE.webUrl + waHubLink()} className={`inline-flex min-h-11 items-center gap-2 text-[#00E5FF] ${focus}`}><CircleHelp size={20} strokeWidth={1.75} />{t.whatsapp}<ArrowRight size={16} /></a></div></div></section>
      <section><h2 className="font-display text-2xl font-bold">{t.faq}</h2><div className="mt-6 divide-y divide-white/10 border-y border-white/10">{t.questions.map((question, i) => <details key={question} className="group py-4"><summary className={`cursor-pointer list-none py-2 font-display font-semibold ${focus}`}>{question}<span className="float-right text-[#00E5FF] group-open:rotate-45">+</span></summary><p className="max-w-2xl pb-2 pt-2 text-sm leading-7 text-white/60">{t.answers[i]}</p></details>)}</div></section>
    </div>
  </>;
}
