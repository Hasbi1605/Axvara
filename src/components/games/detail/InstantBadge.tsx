import type { gamesCopy } from "@/lib/games/copy";
import styles from "./detail.module.css";

export function InstantBadge({ t, selected }: { t: Pick<ReturnType<typeof gamesCopy>, "instant" | "instantTop" | "instantBottom">; selected: boolean }) {
  return <span data-instant-badge data-selected={selected} className={`inline-flex shrink-0 items-center gap-[3px] rounded-[5px] bg-white/[.07] px-1 py-[2px] text-[#00E5FF] sm:gap-1 sm:px-1.5 sm:py-[3px] ${selected ? styles.selectedBadge : ""}`}>
    <svg aria-hidden="true" width="23" height="24" viewBox="0 0 26 28" className="h-3 w-[11px] overflow-visible sm:h-[15px] sm:w-[14px]"><path d="m16 2-9 13h7l-2 11L25 10h-9z" fill="currentColor" className={styles.badgeBolt} /><path d="M2 9h6M1 14h4M2 19h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={styles.badgeSpeed} /></svg>
    <span aria-hidden="true" className="flex flex-col italic leading-none"><span className="text-[5.5px] font-medium sm:text-[6.5px]">{t.instantTop}</span><span className="text-[7.5px] font-extrabold tracking-wide sm:text-[9px]">{t.instantBottom}</span></span>
    <span className="sr-only">{t.instant}</span>
  </span>;
}
