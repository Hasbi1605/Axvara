"use client";

// Bottom-sheet "Kategori" for the AXVARA Games bottom nav. Same shell as the
// storefront CategorySheet (portal + focus trap/Escape via useModalA11y), but
// its rows are the game genres. Picking one filters the homepage catalog:
// on the homepage through the `axvara:games-genre` CustomEvent, elsewhere by
// navigating to `/games?genre=<slug>#games-catalog` (read by GamesHome).
import { useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Crosshair, Crown, LayoutGrid, Smile, Swords, Trophy, WandSparkles, X, type LucideIcon } from "lucide-react";
import { useModalA11y } from "@/hooks/useModalA11y";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { gamesCopy } from "@/lib/games/copy";
import { GAMES_GENRES, type GamesGenre } from "@/lib/games/genres";

export const AXVARA_GAMES_GENRE_EVENT = "axvara:games-genre";

/** Genre icons shared by the homepage chips and this sheet. */
export const GAMES_GENRE_ICONS: Record<GamesGenre, LucideIcon> = {
  all: LayoutGrid, moba: Swords, shooter: Crosshair, rpg: WandSparkles, sports: Trophy, strategy: Crown, casual: Smile,
};

export function isGamesGenre(value: unknown): value is GamesGenre {
  return typeof value === "string" && (GAMES_GENRES as readonly string[]).includes(value);
}

export function requestGamesGenre(genre: GamesGenre) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<GamesGenre>(AXVARA_GAMES_GENRE_EVENT, { detail: genre }));
}

export function GamesCategorySheet({ genres = GAMES_GENRES, onPick, onClose }: { genres?: readonly GamesGenre[]; onPick: (genre: GamesGenre) => void; onClose: () => void }) {
  const t = gamesCopy(useDisplayLocale());
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm md:hidden" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="games-category-sheet-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-[480px] overflow-y-auto rounded-t-[24px] border border-white/10 bg-[#0B1025] p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-left shadow-[0_24px_64px_rgba(0,0,0,0.6)] animate-[fadeInUp_0.25s_var(--ease-apple)] motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="games-category-sheet-title" className="text-base font-bold text-white">{t.categorySheetTitle}</h2>
            <p className="mt-0.5 text-xs text-white/45">{t.categorySheetLead}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          {genres.map((key) => {
            const Icon = GAMES_GENRE_ICONS[key];
            return (
              <li key={key}>
                <button type="button" onClick={() => onPick(key)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.05] focus-visible:bg-white/[0.08] focus-visible:outline-none">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10 text-[#00E5FF]"><Icon size={18} strokeWidth={2} /></span>
                  <span className="min-w-0 flex-1 text-sm font-semibold text-white">{t.genres[key]}</span>
                  <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-white/40" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
