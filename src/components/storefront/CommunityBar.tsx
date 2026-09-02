"use client";

export function CommunityBar() {
  // WA Group → fallback ke WA admin sampai grup jadi. Telegram: segera hadir badge.
  const waHref = "https://wa.me/6282135277434?text=Halo%20AXVARA%2C%20saya%20mau%20join%20grup%20promo";
  const tgHref = "#";
  const tgComingSoon = (e: React.MouseEvent) => {
    e.preventDefault();
    alert("Bot Telegram AXVARA segera hadir. Hubungi Admin via WA untuk info terbaru.");
  };
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 -mt-1 mb-2">
      <div className="flex flex-row gap-2 sm:gap-3">
        {/* WA Group */}
        <a
          href={waHref}
          target="_blank"
          className="group flex-1 flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl ax-glass border border-white/10 hover:border-[#25D366]/30 hover:bg-white/[0.06] transition text-left"
        >
          <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 shadow-[0_4px_14px_rgba(37,211,102,0.35)] bg-white flex items-center justify-center p-0.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/whatsapp.svg" alt="WhatsApp" width={36} height={36} className="w-full h-full object-contain" draggable={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-[12px] sm:text-[13.5px] text-white tracking-[-0.01em] leading-tight">Grup WhatsApp</span>
            <span className="block text-[11px] sm:text-xs text-white/50 leading-tight sm:hidden">Join komunitas</span>
            <span className="hidden sm:block text-[11px] text-white/50 leading-tight">Info promo & restock</span>
          </span>
        </a>

        {/* Telegram Bot */}
        <a
          href={tgHref}
          onClick={tgComingSoon}
          className="group flex-1 flex items-center gap-3 px-3 sm:px-4 py-3 rounded-2xl ax-glass border border-white/10 hover:border-[#26A5E4]/30 hover:bg-white/[0.06] transition text-left"
        >
          <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 shadow-[0_4px_14px_rgba(38,165,228,0.35)] bg-[#2AABEE] flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/telegram.svg" alt="Telegram" width={36} height={36} className="w-full h-full object-cover" draggable={false} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-[12px] sm:text-[13.5px] text-white tracking-[-0.01em] leading-tight">Bot Telegram</span>
            <span className="block text-[11px] sm:text-xs text-white/50 leading-tight sm:hidden">Auto order 24 jam</span>
            <span className="hidden sm:block text-[11px] text-white/50 leading-tight">Order otomatis 24 jam</span>
          </span>
        </a>
      </div>
    </div>
  );
}
