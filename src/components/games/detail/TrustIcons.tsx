"use client";
import { useId } from "react";
import type { gamesCopy } from "@/lib/games/copy";
import styles from "./detail.module.css";

export function TrustIcons({ t }: { t: Pick<ReturnType<typeof gamesCopy>, "trustInstant" | "trustSupport" | "trustSecure"> }) {
  const id = useId().replace(/:/g, "");
  return <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-[13px] font-medium text-white/85 sm:text-sm">
    <span className="inline-flex items-center gap-2">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="shrink-0">
        <defs><linearGradient id={`${id}-gold`} x2="0" y2="1"><stop stopColor="#FFB800" /><stop offset="1" stopColor="#FF8A00" /></linearGradient></defs>
        <path d="m17 2-11 13h8l-3 11L25 10h-9z" fill={`url(#${id}-gold)`} className={styles.bolt} />
        <path d="M2 9h5M1 19h5" fill="none" stroke="#FFB800" strokeWidth="2" strokeLinecap="round" className={styles.speed} />
        <path d="m17 4-6 9h5" fill="none" stroke="#FFF1B8" strokeWidth="1.4" strokeLinecap="round" opacity=".65" />
      </svg>{t.trustInstant}
    </span>
    <span className="inline-flex items-center gap-2">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="shrink-0">
        <defs><linearGradient id={`${id}-chat`} x2="1" y2="1"><stop stopColor="#00E5FF" /><stop offset="1" stopColor="#3B82F6" /></linearGradient></defs>
        <path d="M5 7h18a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-3l-5 3v-3H5a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z" fill="#3B82F6" opacity=".22" />
        <path d="M6 3h16a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H11l-6 4v-4a4 4 0 0 1-4-4V7a5 5 0 0 1 5-4Z" fill={`url(#${id}-chat)`} />
        <g fill="white"><circle cx="8" cy="12" r="1.5" className={styles.dot} /><circle cx="14" cy="12" r="1.5" className={styles.dot} /><circle cx="20" cy="12" r="1.5" className={styles.dot} /></g>
      </svg>{t.trustSupport}
    </span>
    <span className="inline-flex items-center gap-2">
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="shrink-0">
        <defs><linearGradient id={`${id}-seal`} x2="1" y2="1"><stop stopColor="#3B82F6" /><stop offset="1" stopColor="#00E5FF" /></linearGradient></defs>
        <path d="m14 1 3.2 2.3 4-.2 1 3.8 3.4 2-.9 3.8 1.6 3.6-2.8 2.8-.4 4-3.8 1.1-2.5 3-3.7-1.5-3.7 1.5-2.5-3-3.8-1.1-.4-4L1 16.3l1.6-3.6-.9-3.8 3.4-2 1-3.8 4 .2Z" fill={`url(#${id}-seal)`} className={styles.seal} />
        <circle cx="14" cy="14" r="8.5" fill="white" opacity=".1" />
        <path d="m8.8 14 3.4 3.4 7-7" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" className={styles.check} />
      </svg>{t.trustSecure}
    </span>
  </div>;
}
