"use client";

import { CrossServicePromo } from "@/components/shared/CrossServicePromo";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

/** Kartu ganda beranda Pedia — cermin CommunityBar Market (kembar compact
 *  min-h-[64px], satu gaya ax-glass-card): kiri = AXVARA Market, kanan =
 *  AXVARA Games (koreksi owner 14 Nov 2026: Bot Telegram diganti; setiap
 *  layanan kini menautkan dua layanan AXVARA lainnya). */
export function PediaServiceCards() {
  const locale = useDisplayLocale();
  return (
    <div className="flex flex-row gap-2 sm:gap-3">
      <CrossServicePromo current="pedia" target="market" locale={locale} />
      <CrossServicePromo current="pedia" target="games" locale={locale} />
    </div>
  );
}
