"use client";

// src/hooks/useModalA11y.ts — Satu implementasi perilaku aksesibilitas modal.
//
// Sebelumnya perilaku ini disalin manual: CartDrawer punya focus trap +
// Escape + scroll lock lengkap, PopupBanner hanya Escape + scroll lock (tanpa
// trap dan tanpa mengembalikan fokus), dan QuickVariantModal tidak punya
// apa pun. Tiga salinan berarti perbaikan a11y di satu modal tidak ikut
// melindungi modal lain. Hook ini menjadi sumber tunggal.
//
// Kontrak yang dijamin saat `active` true:
// 1. Escape menutup modal (memanggil onClose).
// 2. Tab/Shift+Tab terkurung di dalam container (focus trap).
// 3. Scroll body terkunci dan dipulihkan ke nilai sebelumnya.
// 4. Fokus awal pindah ke initialFocus (atau container) setelah paint.
// 5. Fokus dikembalikan ke elemen pemicu saat modal ditutup/unmount.

import { useEffect, type RefObject } from "react";

/**
 * Selector elemen yang bisa menerima fokus keyboard di dalam modal.
 * Sengaja TIDAK memakai pemeriksaan `offsetParent`/getComputedStyle:
 * keduanya bergantung pada layout, bernilai null untuk elemen
 * `position: fixed`, dan tidak tersedia di jsdom — sehingga trap akan diam-diam
 * kosong. Penyaringan visibilitas cukup lewat atribut.
 */
export const FOCUSABLE_SELECTOR =
  'a[href]:not([hidden]),button:not([disabled]):not([hidden]),input:not([disabled]):not([hidden]):not([type="hidden"]),select:not([disabled]):not([hidden]),textarea:not([disabled]):not([hidden]),[tabindex]:not([tabindex="-1"]):not([hidden])';

export type ModalA11yOptions = {
  /** Aktif hanya saat modal benar-benar terpasang dan terlihat. */
  active: boolean;
  /** Container modal — batas focus trap. */
  containerRef: RefObject<HTMLElement | null>;
  /** Dipanggil saat Escape ditekan. */
  onClose: () => void;
  /** Elemen yang difokuskan pertama; default container. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function useModalA11y({ active, containerRef, onClose, initialFocusRef }: ModalA11yOptions): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // setTimeout 0: elemen modal baru saja dirender, fokus langsung pada
    // commit render bisa mengenai node yang belum terpasang di document.
    const focusTimer = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? containerRef.current;
      target?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        // Tanpa kandidat fokus, Tab tetap tidak boleh lolos ke latar.
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      // Fokus di luar container (mis. masih di body setelah render) juga
      // ditarik masuk, bukan hanya kasus tepi first/last.
      if (!container.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [active, containerRef, onClose, initialFocusRef]);
}
