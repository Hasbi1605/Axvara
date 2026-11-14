import type { gamesCopy } from "@/lib/games/copy";
import styles from "./InstantBadge.module.css";

/** Stiker raster ID/EN; label aksesibel tetap dibaca sekali bersama nominal. */
export function InstantBadge({ t, selected }: { t: Pick<ReturnType<typeof gamesCopy>, "instant" | "instantTop" | "instantBottom">; selected: boolean }) {
  const locale = t.instantBottom === "INSTANT" ? "en" : "id";
  return <span data-instant-badge data-selected={selected} className={`${styles.badge} shrink-0`}>
    <img
      src={`/brand/games/ui/instant-badge-${locale}.webp`}
      alt=""
      aria-hidden="true"
      width={60}
      height={20}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={styles.artwork}
    />
    <span className="sr-only">{t.instant}</span>
  </span>;
}
