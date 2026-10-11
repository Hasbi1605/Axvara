import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { TG_BOT_HREF } from "@/lib/site";

export function CommunityBar() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <CrossServicePromo current="market" />

        {/* Telegram Bot */}
        <a
          href={TG_BOT_HREF}
          target="_blank"
          rel="noreferrer"
          className="group min-h-[80px] flex-1 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-2xl ax-glass-card border border-white/10 hover:border-[#26A5E4]/30 hover:bg-white/[0.06] transition text-left"
        >
          <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 shadow-[0_4px_14px_rgba(38,165,228,0.35)] bg-[#2AABEE] flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/telegram.svg" alt="" width={36} height={36} className="w-full h-full object-cover" draggable={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-wider text-white/60">Kanal order Market</span>
            <span className="font-semibold text-sm text-white leading-5">Bot Telegram</span>
            <span className="block text-xs text-white/60 leading-5">Order aplikasi dan tools premium</span>
          </span>
        </a>
      </div>
    </div>
  );
}
