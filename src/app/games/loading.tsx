"use client";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";

export default function GamesLoading() {
  const t = gamesCopy(useDisplayLocale());
  return <div role="status" aria-label={t.catalogLoading} className="mx-auto max-w-[1280px] space-y-8 px-4 py-8 motion-safe:animate-pulse sm:px-6 lg:px-8"><span className="sr-only">{t.catalogLoading}</span><div className="h-48 rounded-3xl bg-white/5" /><div className="h-8 w-48 rounded-lg bg-white/5" /><div className="grid grid-cols-3 gap-4 sm:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-square rounded-2xl bg-white/5" />)}</div></div>;
}
