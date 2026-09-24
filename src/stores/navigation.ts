"use client";
import { create } from "zustand";

// Navigasi App Router ke route dinamis menunggu respons server SEBELUM URL
// berubah, jadi pembeli di jaringan lambat melihat halaman lama diam setelah
// klik. Store ini menandai navigasi sejak klik sampai pathname berubah;
// `NavigationProgress` membaca status ini untuk bar, skeleton, dan pesan
// koneksi lambat.

export type NavigationState = {
  active: boolean;
  href: string | null;
  /** Skeleton rute tujuan menutupi halaman lama; false bila pemanggil punya layar sendiri. */
  overlay: boolean;
  startedAt: number;
  start: (href: string, options?: { overlay?: boolean }) => void;
  done: () => void;
};

export const useNavigation = create<NavigationState>((set) => ({
  active: false,
  href: null,
  overlay: true,
  startedAt: 0,
  start: (href, options) => set({ active: true, href, overlay: options?.overlay ?? true, startedAt: Date.now() }),
  done: () => set({ active: false, href: null, overlay: true, startedAt: 0 }),
}));

/**
 * URL tujuan relatif terhadap lokasi sekarang, atau null bila klik ini tidak
 * memicu navigasi antar-halaman (origin lain, hanya beda hash, URL sama).
 */
export function internalNavigationTarget(href: string, current: Location = window.location): URL | null {
  let url: URL;
  try {
    url = new URL(href, current.href);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return url;
}

/** Mulai indikator navigasi untuk `router.push` terprogram. */
export function startNavigation(href: string, options?: { overlay?: boolean }): boolean {
  if (typeof window === "undefined" || !internalNavigationTarget(href)) return false;
  useNavigation.getState().start(href, options);
  return true;
}
