"use client";

// Indikator navigasi global (menggantikan RouteLoading).
//
// RouteLoading lama baru menyala SETELAH pathname berubah — yaitu setelah
// halaman baru tampil — jadi selama menunggu server (route dinamis tanpa
// prefetch) halaman lama diam total dan pembeli di jaringan lambat mengira
// klik tidak jalan. Kini indikator mulai saat klik:
// 1. bar cyan di atas yang terus bergerak sampai rute baru dirender;
// 2. skeleton rute tujuan menutupi halaman lama (tanpa loading.tsx, agar
//    HTML server + status 404 produk/artikel tidak berubah jadi streaming);
// 3. setelah 8 dtk pesan "koneksi lambat", setelah 20 dtk tombol Coba lagi.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { internalNavigationTarget, useNavigation } from "@/stores/navigation";
import { InlineSpinner, RouteSkeleton, routeSkeletonKind } from "@/components/storefront/Skeletons";
import { SLOW_MS, STUCK_MS, useLoadingStage } from "@/hooks/useLoadingStage";

/** Navigasi yang sudah di-prefetch selesai sebelum ini — tanpa kedipan. */
export const SHOW_DELAY_MS = 120;
const FINISH_MS = 360;

function navigableAnchor(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download") || anchor.hasAttribute("data-no-progress")) return null;
  return anchor;
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = useNavigation((s) => s.active);
  const href = useNavigation((s) => s.href);
  const overlay = useNavigation((s) => s.overlay);
  const start = useNavigation((s) => s.start);
  const done = useNavigation((s) => s.done);
  const [visible, setVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const visibleRef = useRef(false);
  const stage = useLoadingStage(active, [SLOW_MS, STUCK_MS]);
  const routeKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  const mountedRoute = useRef(routeKey);

  // Capture phase: berjalan sebelum <Link> memanggil preventDefault untuk
  // navigasi client, jadi semua Link/anchor internal tertangkap tanpa diubah.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = navigableAnchor(event);
      if (!anchor) return;
      const url = internalNavigationTarget(anchor.href);
      if (url) start(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [start]);

  // URL berubah = rute tujuan sudah dirender (termasuk tombol kembali).
  useEffect(() => {
    if (mountedRoute.current === routeKey) return;
    mountedRoute.current = routeKey;
    done();
  }, [routeKey, done]);

  useEffect(() => {
    if (active) {
      setFinishing(false);
      const timer = setTimeout(() => { visibleRef.current = true; setVisible(true); }, SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (!visibleRef.current) return;
    setFinishing(true);
    const timer = setTimeout(() => { visibleRef.current = false; setVisible(false); setFinishing(false); }, FINISH_MS);
    return () => clearTimeout(timer);
  }, [active]);

  if (!visible) return null;
  const targetPath = href ? new URL(href, "http://axvara.local").pathname : "";
  const showOverlay = active && overlay && routeSkeletonKind(targetPath) !== null;

  return (
    <>
      <div className="fixed top-0 inset-x-0 z-[90] h-[3px] pointer-events-none" aria-hidden>
        <div className={`ax-nav-bar h-full origin-left bg-[#00E5FF] shadow-[0_0_12px_rgba(0,229,255,0.9)] ${finishing ? "ax-nav-bar-done" : ""}`} />
      </div>
      {active && <span role="status" className="sr-only">Memuat halaman…</span>}
      {showOverlay && (
        <div data-testid="route-skeleton" className="fixed inset-x-0 top-[64px] bottom-0 z-[35] overflow-hidden bg-[#080C1E] animate-[axFadeIn_0.15s_ease-out]">
          <RouteSkeleton pathname={targetPath} />
        </div>
      )}
      {active && stage >= 1 && (
        <div role="status" aria-live="polite" className="fixed left-1/2 top-[76px] z-[90] w-max max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-full border border-[#FFB800]/30 bg-[#0B1025]/95 px-4 py-2 text-xs text-white/85 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          {stage === 1 ? (
            <span className="flex items-center gap-2"><InlineSpinner className="w-3.5 h-3.5" />Koneksi lambat — halaman masih dimuat…</span>
          ) : (
            <span className="flex items-center gap-3">
              <span>Halaman belum terbuka.</span>
              <button type="button" onClick={() => { if (href) window.location.assign(href); }} className="font-semibold text-[#00E5FF]">Coba lagi</button>
              <button type="button" onClick={done} className="text-white/50 hover:text-white">Batal</button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
