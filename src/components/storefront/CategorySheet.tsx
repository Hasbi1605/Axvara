"use client";

// Panel "Kategori" dari bottom nav mobile (2026-10-03, keputusan owner):
// menggantikan tab Keranjang yang redundan (drawer yang sama sudah dibuka
// dari tombol Keranjang navbar yang selalu sticky + tiap kartu produk).
// Cermin HelpSheet: bottom-sheet solid #0B1025, focus trap + Escape +
// scroll lock via useModalA11y, portal ke document.body.
//
// Komunikasi ke katalog lewat CustomEvent `axvara:category` (bukan store
// baru): home-client mendengarkan event ini agar sheet tetap berfungsi walau
// dibuka dari rute mana pun, tanpa mengikat nav ke state katalog.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IosIcon, categoryIcon } from "@/components/ui/IosIcon";
import { useModalA11y } from "@/hooks/useModalA11y";
import { categories as fallbackCategories } from "@/lib/products";

export const AXVARA_CATEGORY_EVENT = "axvara:category";

export function requestCategory(slug: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(AXVARA_CATEGORY_EVENT, { detail: slug }));
}

type CategoryItem = { slug: string; name: string; icon?: string | null };

export function CategorySheet({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<CategoryItem[]>([
    { slug: "semua", name: "Semua Produk", icon: "✦" },
    // Fallback lokal sudah diawali "Semua" — buang agar tidak ganda.
    ...fallbackCategories
      .filter((c) => c.slug !== "semua")
      .map((c) => ({ slug: c.slug, name: c.name, icon: c.icon ?? null })),
  ]);
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/categories")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !Array.isArray(j.categories)) return;
        const apiCats = (j.categories as { slug: string; name: string; icon?: string }[]).map((c) => ({
          slug: c.slug,
          name: c.name,
          icon: c.icon ?? null,
        }));
        const deduped = apiCats.filter((c) => c.slug !== "semua");
        setItems([{ slug: "semua", name: "Semua Produk", icon: "✦" }, ...deduped]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (slug: string) => {
    requestCategory(slug);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-sheet-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-t-[24px] border border-white/10 p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-left shadow-[0_24px_64px_rgba(0,0,0,0.6)] animate-[fadeInUp_0.25s_var(--ease-apple)]"
        style={{ background: "#0B1025" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="category-sheet-title" className="text-base font-bold text-white">Kategori</h2>
            <p className="mt-0.5 text-xs text-white/45">Pilih kategori untuk memfilter katalog.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup kategori"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white"
          >
            <span aria-hidden><IosIcon name="close" size={14} tint="white" /></span>
          </button>
        </div>

        <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          {items.map((item) => (
            <li key={item.slug}>
              <button
                type="button"
                onClick={() => pick(item.slug)}
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.05]"
              >
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
                  <IosIcon name={categoryIcon(item.slug, item.icon)} size={18} tint="#00E5FF" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{item.name}</span>
                </span>
                <span aria-hidden className="shrink-0"><IosIcon name="chevron-right" size={14} tint="white" className="opacity-40" /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
