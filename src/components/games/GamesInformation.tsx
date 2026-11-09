"use client";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import { SITE, waHubLink } from "@/lib/site";

export function GamesInformation({ kind }: { kind: "help" | "terms" }) {
  const t = gamesCopy(useDisplayLocale());
  return <div className="mx-auto max-w-[920px] px-4 py-16 sm:px-6"><p className="text-xs font-bold tracking-[.2em] text-[#FFB800]">AXVARA GAMES</p><h1 className="mt-3 font-display text-3xl font-bold">{kind === "help" ? t.helpTitle : t.termsTitle}</h1><div className="mt-8 divide-y divide-white/10 border-y border-white/10">{kind === "help" ? t.helpQuestions.map((question, index) => <details key={question} className="py-4"><summary className="min-h-11 cursor-pointer py-2 font-display font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">{question}</summary><p className="pb-3 text-sm leading-7 text-white/65">{t.helpAnswers[index]}</p></details>) : t.termsItems.map((text, index) => <p key={text} className="flex gap-4 py-5 text-sm leading-7 text-white/70"><span className="font-display font-bold text-[#FFB800]">0{index + 1}</span>{text}</p>)}</div><a href={SITE.webUrl + waHubLink()} className="mt-7 inline-flex min-h-12 items-center rounded-xl border border-[#00E5FF]/40 px-5 text-sm font-semibold text-[#00E5FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF]">{t.whatsapp}</a></div>;
}
