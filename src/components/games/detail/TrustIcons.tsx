"use client";
import { useEffect, useId, useRef } from "react";
import type { gamesCopy } from "@/lib/games/copy";
import styles from "./detail.module.css";

export function TrustIcons({ t }: { t: Pick<ReturnType<typeof gamesCopy>, "trustInstant" | "trustSupport" | "trustSecure"> }) {
  const id = useId().replace(/:/g, "");
  const row = useRef<HTMLDivElement>(null);
  // Perf HP kelas bawah (15 Nov 2026): animasi SVG ini digambar ulang CPU tiap frame. Jeda saat baris
  // di luar layar atau selama scroll (lanjut 150 ms setelah scroll berhenti). Atribut DOM langsung,
  // tanpa state React, agar scroll tidak memicu render ulang.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let visible = true, scrolling = false, timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => el.toggleAttribute("data-paused", !visible || scrolling);
    const onScroll = () => { scrolling = true; sync(); clearTimeout(timer); timer = setTimeout(() => { scrolling = false; sync(); }, 150); };
    window.addEventListener("scroll", onScroll, { passive: true });
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }) : null;
    io?.observe(el);
    return () => { window.removeEventListener("scroll", onScroll); io?.disconnect(); clearTimeout(timer); };
  }, []);
  const item = "inline-flex items-center gap-1 whitespace-nowrap min-[375px]:gap-1.5 sm:gap-2";
  return <div ref={row} data-trust-row className={`${styles.trustRow} mt-4 flex flex-wrap justify-between gap-x-1 gap-y-3 text-[11px] font-medium text-white/85 min-[375px]:gap-x-2 min-[375px]:text-[11.5px] min-[400px]:text-xs sm:justify-start sm:gap-x-6 sm:text-sm`}>
    <span className={item} style={{ ["--trust-delay" as string]: "0s" }}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="h-[18px] w-[18px] shrink-0 sm:h-6 sm:w-6">
        <defs><linearGradient id={`${id}-gold`} x2="0" y2="1"><stop stopColor="#FFB800" /><stop offset="1" stopColor="#FF8A00" /></linearGradient></defs>
        <path d="m17 2-11 13h8l-3 11L25 10h-9z" fill={`url(#${id}-gold)`} className={styles.bolt} />
        <path d="M2 9h5M1 19h5" fill="none" stroke="#FFB800" strokeWidth="2" strokeLinecap="round" className={styles.speed} />
        <path d="m17 4-6 9h5" fill="none" stroke="#FFF1B8" strokeWidth="1.4" strokeLinecap="round" opacity=".65" />
      </svg>{t.trustInstant}
    </span>
    <span className={item} style={{ ["--trust-delay" as string]: "2s" }}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="h-[18px] w-[18px] shrink-0 sm:h-6 sm:w-6">
        <defs><linearGradient id={`${id}-chat`} x2="1" y2="1"><stop stopColor="#00E5FF" /><stop offset="1" stopColor="#3B82F6" /></linearGradient></defs>
        <path d="M5 7h18a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-3l-5 3v-3H5a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z" fill="#3B82F6" opacity=".22" />
        <g className={styles.bubble}><path d="M6 3h16a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H11l-6 4v-4a4 4 0 0 1-4-4V7a5 5 0 0 1 5-4Z" fill={`url(#${id}-chat)`} />
        <g fill="white"><circle cx="8" cy="12" r="1.5" className={styles.dot} /><circle cx="14" cy="12" r="1.5" className={styles.dot} /><circle cx="20" cy="12" r="1.5" className={styles.dot} /></g></g>
      </svg>{t.trustSupport}
    </span>
    <span className={item} style={{ ["--trust-delay" as string]: "4s" }}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 28 28" className="h-[18px] w-[18px] shrink-0 sm:h-6 sm:w-6">
        <defs><linearGradient id={`${id}-seal`} x2="1" y2="1"><stop stopColor="#3B82F6" /><stop offset="1" stopColor="#00E5FF" /></linearGradient></defs>
        <path d="m14 1 3.2 2.3 4-.2 1 3.8 3.4 2-.9 3.8 1.6 3.6-2.8 2.8-.4 4-3.8 1.1-2.5 3-3.7-1.5-3.7 1.5-2.5-3-3.8-1.1-.4-4L1 16.3l1.6-3.6-.9-3.8 3.4-2 1-3.8 4 .2Z" fill={`url(#${id}-seal)`} className={styles.seal} />
        <circle cx="14" cy="14" r="8.5" fill="white" opacity=".1" />
        <path d="m8.8 14 3.4 3.4 7-7" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" pathLength="1" className={styles.check} />
      </svg>{t.trustSecure}
    </span>
  </div>;
}
