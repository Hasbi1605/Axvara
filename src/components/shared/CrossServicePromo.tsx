import { ArrowUpRight } from "lucide-react";
import { AXVARA_SERVICES, type AxvaraService } from "@/lib/site";

export function CrossServicePromo({ current }: { current: AxvaraService }) {
  const service = AXVARA_SERVICES.find((item) => item.id !== current)!;
  return (
    <a href={`${service.href}?utm_source=${current === "market" ? "axvara" : "pedia"}&utm_medium=cross_promo`}
      className="group flex min-h-[80px] min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition hover:border-[#00E5FF]/30 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] sm:px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={service.icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 brightness-0 invert" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-wider text-[#00E5FF]">Layanan AXVARA</span>
        <span className="block text-sm font-semibold leading-5 text-white">{service.name}</span>
        <span className="block text-xs leading-5 text-white/60">{service.description}</span>
      </span>
      <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60" />
    </a>
  );
}
