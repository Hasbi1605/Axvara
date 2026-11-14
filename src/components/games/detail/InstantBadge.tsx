import type { gamesCopy } from "@/lib/games/copy";
import styles from "./detail.module.css";

export function InstantBadge({ t, selected }: { t: Pick<ReturnType<typeof gamesCopy>, "instant" | "instantTop" | "instantBottom">; selected: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-md bg-white/[.06] px-2 py-1 text-[#00E5FF] ${selected ? styles.selectedBadge : ""}`}>
    <svg aria-hidden="true" width="23" height="24" viewBox="0 0 26 28"><path d="m16 2-9 13h7l-2 11L25 10h-9z" fill="currentColor" /><path d="M2 9h6M1 14h4M2 19h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    <span aria-hidden="true" className="flex flex-col italic leading-none"><span className="text-[8px] font-medium">{t.instantTop}</span><span className="mt-0.5 text-[11px] font-extrabold tracking-wide">{t.instantBottom}</span></span>
    <span className="sr-only">{t.instant}</span>
  </span>;
}
