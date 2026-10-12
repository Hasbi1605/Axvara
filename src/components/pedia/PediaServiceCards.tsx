import { ArrowUpRight } from "lucide-react";
import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { TG_BOT_HREF } from "@/lib/site";

/** Kartu ganda beranda Pedia — cermin CommunityBar Market (kembar compact
 *  min-h-[64px], satu gaya ax-glass-card, panah ArrowUpRight sama):
 *  kiri = promo AXVARA Market, kanan = Bot Telegram Market. */
export function PediaServiceCards() {
  return (
    <div className="flex flex-row gap-2 sm:gap-3">
      <CrossServicePromo current="pedia" />

      <a
        href={`${TG_BOT_HREF}&utm_source=pedia&utm_medium=cross_promo`}
        target="_blank"
        rel="noreferrer"
        className="group flex min-h-[64px] min-w-0 flex-1 items-center gap-2.5 rounded-2xl ax-glass-card border border-white/10 px-3 py-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00E5FF] sm:gap-3 sm:px-4"
      >
        <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 shadow-[0_4px_14px_rgba(38,165,228,0.35)] bg-[#2AABEE] flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/telegram.svg" alt="" width={36} height={36} className="w-full h-full object-cover" draggable={false} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-5 text-white sm:text-sm">Bot Telegram</span>
          <span className="block text-[11px] leading-[1.4] text-white/60 sm:text-xs sm:leading-5 line-clamp-2">Order aplikasi dan tools premium</span>
        </span>
        <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/60" />
      </a>
    </div>
  );
}
