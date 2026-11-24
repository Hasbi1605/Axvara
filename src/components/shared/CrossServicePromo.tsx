"use client";

import { ArrowUpRight } from "lucide-react";
import { AXVARA_SERVICES, type AxvaraService } from "@/lib/site";
import type { Locale } from "@/lib/i18n/locale";
import { axvaraServiceCopy } from "@/lib/i18n/service-copy";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

export function CrossServicePromo({ current, target, locale }: { current: AxvaraService; target?: AxvaraService; locale?: Locale }) {
  const displayLocale = useDisplayLocale();
  const resolved = locale ?? displayLocale;
  const service = AXVARA_SERVICES.find((item) => target ? item.id === target : item.id !== current)!;
  const localized = axvaraServiceCopy(service, resolved);
  return (
    <a href={`${service.href}?utm_source=${current === "market" ? "axvara" : current}&utm_medium=cross_promo`}
      className="group flex min-h-[64px] min-w-0 flex-1 items-center gap-2 rounded-2xl ax-glass-card border border-white/10 px-2.5 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] sm:gap-3 sm:px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={service.icon} alt="" width={36} height={36} className="h-7 w-7 shrink-0 brightness-0 invert sm:h-9 sm:w-9" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] font-semibold leading-5 text-white sm:text-sm">{localized.name}</span>
        <span className="block text-[11px] leading-[1.4] text-white/60 sm:text-xs sm:leading-5 line-clamp-2">{localized.description}</span>
      </span>
      <ArrowUpRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-white/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none sm:block" />
    </a>
  );
}
