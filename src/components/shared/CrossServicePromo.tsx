import { ArrowUpRight } from "lucide-react";
import { AXVARA_SERVICES, type AxvaraService } from "@/lib/site";

export function CrossServicePromo({ current }: { current: AxvaraService }) {
  const service = AXVARA_SERVICES.find((item) => item.id !== current)!;
  return (
    <a href={`${service.href}?utm_source=${current === "market" ? "axvara" : "pedia"}&utm_medium=cross_promo`}
      className="group flex min-h-[64px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl ax-glass-card border border-white/10 px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] sm:gap-3 sm:px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={service.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 brightness-0 invert" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-5 text-white sm:text-sm">{service.name}</span>
        <span className="block text-[11px] leading-[1.4] text-white/60 sm:text-xs sm:leading-5 line-clamp-2">{service.description}</span>
      </span>
      <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60" />
    </a>
  );
}
