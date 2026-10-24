"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { bannerSettingsSchema, DEFAULT_BANNER_SETTINGS } from "@/lib/banner-config";
import { usePathname } from "next/navigation";
import { useModalA11y } from "@/hooks/useModalA11y";

type Banner = {
  id: number;
  title: string;
  body?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  is_active: number;
  delay_ms?: number | null;
  max_show_per_session?: number | null;
};

export const BANNER_HIDE_DURATION_MS = 24 * 60 * 60 * 1000;

export function bannerHideKey(id: number) {
  return `axvara-banner-${id}-hide-until`;
}

export function isBannerHidden(id: number, now = Date.now()): boolean {
  try {
    const until = Number(localStorage.getItem(bannerHideKey(id)) ?? 0);
    return Number.isFinite(until) && until > 0 && now < until;
  } catch {
    return false;
  }
}

export function hideBannerFor24h(id: number, now = Date.now()): void {
  try {
    localStorage.setItem(bannerHideKey(id), String(now + BANNER_HIDE_DURATION_MS));
  } catch {}
}

export function unhideBanner(id: number): void {
  try {
    localStorage.removeItem(bannerHideKey(id));
  } catch {}
}

export const BANNER_SESSION_KEY = "axvara-banner-carousel-shows";
export const BANNER_TRANSITION_MS = 420;

export function PopupBanner() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const isHome = pathname === "/";
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_BANNER_SETTINGS);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [direction, setDirection] = useState(1);
  const [imageFailed, setImageFailed] = useState<number[]>([]);
  const [outgoing, setOutgoing] = useState<{ banner: Banner; index: number } | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const [stageHeight, setStageHeight] = useState<number>();
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const currentIndexRef = useRef(0);
  const targetIndexRef = useRef(0);
  const navigationVersion = useRef(0);
  const transitionTimer = useRef<ReturnType<typeof setTimeout>>();
  const transitioning = useRef(false);
  const queuedCommit = useRef<(() => void) | null>(null);
  const preparedImages = useRef(new Map<string, Promise<void>>());
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shownThisVisitRef = useRef(false);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const banner = banners[index];
  const cancelTransition = useCallback(() => {
    navigationVersion.current++;
    clearTimeout(transitionTimer.current);
    transitionTimer.current = undefined;
    transitioning.current = false;
    queuedCommit.current = null;
    setOutgoing(null);
    setStageHeight(undefined);
  }, []);
  const close = useCallback(() => { cancelTransition(); setOpen(false); }, [cancelTransition]);
  const beginTransition = useCallback(() => {
    if (!transitioning.current || transitionTimer.current !== undefined) return;
    setIncomingReady(true);
    transitionTimer.current = setTimeout(() => {
      transitionTimer.current = undefined;
      transitioning.current = false;
      setOutgoing(null);
      setStageHeight(undefined);
      const next = queuedCommit.current;
      queuedCommit.current = null;
      next?.();
    }, BANNER_TRANSITION_MS + 50);
  }, []);
  const prepareImage = useCallback((url?: string | null) => {
    if (!url) return;
    const cached = preparedImages.current.get(url);
    if (cached) return cached;
    const image = new Image();
    image.src = url;
    // Keep the current slide painted while the destination downloads/decodes.
    if (typeof image.decode !== "function") return;
    const ready = image.decode().catch(() => {}).then(() => {});
    preparedImages.current.set(url, ready);
    return ready;
  }, []);
  const move = useCallback((step: number, manual = true) => {
    if (manual) setPaused(true);
    if (banners.length < 2) return;
    const target = (targetIndexRef.current + step + banners.length) % banners.length;
    targetIndexRef.current = target;
    const version = ++navigationVersion.current;
    const commit = () => {
      if (version !== navigationVersion.current) return;
      // Coalesce rapid input without interrupting a partially painted dissolve.
      if (transitioning.current) { queuedCommit.current = commit; return; }
      const current = currentIndexRef.current;
      if (target === current) return;
      setDirection(step >= 0 ? 1 : -1);
      if (!reduced) {
        const height = slideRef.current?.getBoundingClientRect().height;
        setStageHeight(height || undefined);
        setOutgoing({ banner: banners[current], index: current });
        setIncomingReady(false);
        transitioning.current = true;
      }
      currentIndexRef.current = target;
      setIndex(target);
    };
    const ready = prepareImage(banners[target].image_url);
    if (ready) void ready.then(commit);
    else commit();
  }, [banners, prepareImage, reduced]);

  useLayoutEffect(() => {
    if (!outgoing || !slideRef.current) return;
    const image = slideRef.current.querySelector("img");
    if (!image || (image.complete && image.naturalWidth > 0)) beginTransition();
  }, [outgoing, index, beginTransition]);

  useLayoutEffect(() => {
    if (!outgoing || !incomingReady || !stageRef.current || !slideRef.current) return;
    // Flush the old explicit height before transitioning to the new natural one.
    stageRef.current.getBoundingClientRect();
    const height = slideRef.current.getBoundingClientRect().height;
    const frame = requestAnimationFrame(() => setStageHeight(height || undefined));
    return () => cancelAnimationFrame(frame);
  }, [outgoing, incomingReady, imageFailed, index]);

  useEffect(() => () => {
    navigationVersion.current++;
    clearTimeout(transitionTimer.current);
  }, []);

  useEffect(() => {
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const update = () => { setReduced(Boolean(media?.matches)); setHidden(document.visibilityState === "hidden"); };
    update();
    media?.addEventListener?.("change", update);
    document.addEventListener("visibilitychange", update);
    return () => { media?.removeEventListener?.("change", update); document.removeEventListener("visibilitychange", update); };
  }, []);

  useEffect(() => {
    cancelTransition();
    setOpen(false);
    if (isAdmin || !isHome) return;
    if (shownThisVisitRef.current) return;
    const controller = new AbortController();
    let disposed = false;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    // Defer the single request until after the home page's first paint.
    const fetchTimer = setTimeout(() => {
      fetch("/api/banners?active=1", { signal: controller.signal, cache: "no-store" })
        .then(response => response.ok ? response.json() : Promise.reject())
        .then(data => {
          if (disposed) return;
          const config = bannerSettingsSchema.safeParse(data.settings);
          const nextSettings = config.success ? config.data : DEFAULT_BANNER_SETTINGS;
          let shown = 0;
          try { shown = Number(sessionStorage.getItem(BANNER_SESSION_KEY) ?? 0) || 0; } catch {}
          if (shown >= nextSettings.max_show_per_session) return;
          const eligible = ((data.banners ?? []) as Banner[]).filter(item => item.is_active && !isBannerHidden(item.id));
          if (!eligible.length) return;
          setBanners(eligible);
          setSettings(nextSettings);
          setIndex(0);
          currentIndexRef.current = targetIndexRef.current = 0;
          setPaused(false);
          openTimer = setTimeout(() => {
            if (disposed || shownThisVisitRef.current) return;
            const current = eligible.filter(item => !isBannerHidden(item.id));
            if (!current.length) return;
            shownThisVisitRef.current = true;
            setBanners(current);
            setOpen(true);
            // Count the popup once, never once per slide/loop.
            try { sessionStorage.setItem(BANNER_SESSION_KEY, String(shown + 1)); } catch {}
          }, nextSettings.delay_ms);
        }).catch(() => {});
    }, 0);
    return () => { disposed = true; controller.abort(); clearTimeout(fetchTimer); clearTimeout(openTimer); };
  }, [isAdmin, isHome, cancelTransition]);

  useEffect(() => {
    if (!open || banners.length < 2) return;
    const url = banners[(index + 1) % banners.length]?.image_url;
    prepareImage(url);
  }, [open, banners, index, prepareImage]);

  const rotating = open && banners.length > 1 && settings.autoplay && !paused && !hovered && !hidden && !reduced;
  useEffect(() => {
    if (!rotating) return;
    const timer = setTimeout(() => move(1, false), settings.interval_ms);
    return () => clearTimeout(timer);
  }, [rotating, index, move, settings.interval_ms]);

  useModalA11y({ active: open && Boolean(banner) && !isAdmin && isHome, containerRef: panelRef, onClose: close, initialFocusRef: closeRef });
  if (isAdmin || !isHome || !banner || !open) return null;

  const hideCurrent = () => {
    cancelTransition();
    hideBannerFor24h(banner.id);
    setPaused(true);
    const rest = banners.filter(item => item.id !== banner.id);
    if (!rest.length) close();
    else {
      const nextIndex = Math.min(index, rest.length - 1);
      currentIndexRef.current = targetIndexRef.current = nextIndex;
      setBanners(rest); setIndex(nextIndex);
    }
  };
  const slides = outgoing
    ? [{ ...outgoing, decorative: true }, { banner, index, decorative: false }]
    : [{ banner, index, decorative: false }];
  const waitingForImage = Boolean(outgoing && !incomingReady);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Info AXVARA">
      <div aria-hidden="true" className="absolute inset-0 bg-[#070a1e]/75 backdrop-blur-sm" onClick={close} />
      <div ref={panelRef} tabIndex={-1} className="relative flex max-h-[92dvh] w-[448px] max-w-full flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_64px_rgba(0,0,0,0.5)] motion-safe:animate-[fadeInUp_0.24s_var(--ease-apple)]">
        <button ref={closeRef} onClick={close} className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/65 text-white hover:bg-black/85" aria-label="Tutup banner">✕</button>
        <div className="flex min-h-0 flex-col" role="region" aria-roledescription="carousel" aria-label="Informasi dan promo"
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setPaused(true)}
          onKeyDown={event => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); if (banners.length > 1) move(event.key === "ArrowRight" ? 1 : -1); }
          }}>
          <div className="min-h-0 max-h-[92dvh] overflow-y-auto overscroll-contain" style={{ touchAction: "pan-y" }}
            onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              if ((event.target as HTMLElement).closest("button,a,input,label")) return;
              setPaused(true);
              pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; suppressClick.current = false;
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => { pointer.current = null; }}
            onPointerUp={event => {
              const start = pointer.current; pointer.current = null;
              if (!start || start.id !== event.pointerId) return;
              const dx = event.clientX - start.x, dy = event.clientY - start.y;
              if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && banners.length > 1) { suppressClick.current = true; move(dx < 0 ? 1 : -1); }
            }}>
            <div ref={stageRef} className="banner-stage" data-banner-transition={outgoing ? "running" : undefined}
              style={{ height: stageHeight, "--banner-transition-duration": `${BANNER_TRANSITION_MS}ms`, "--banner-enter-from": direction > 0 ? "12px" : "-12px", "--banner-exit-to": direction > 0 ? "-12px" : "12px" } as CSSProperties}>
              {slides.map(({ banner: item, index: slideIndex, decorative }) => (
                <div key={item.id} ref={decorative ? undefined : slideRef} role={decorative ? undefined : "group"}
                  aria-hidden={decorative || undefined} aria-roledescription={decorative ? undefined : "slide"}
                  aria-label={decorative ? undefined : `${slideIndex + 1} dari ${banners.length}: ${item.title}`}
                  className={decorative ? "banner-slide-out" : `banner-slide${outgoing ? incomingReady ? " banner-slide-in" : " banner-slide-pending" : ""}`}>
                  <div className="relative" data-banner-media={decorative ? undefined : true}>
                    {item.image_url && !imageFailed.includes(item.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.image_url} alt={decorative ? "" : item.title} draggable={false} className="block h-auto w-full"
                        onLoad={decorative ? undefined : beginTransition}
                        onError={decorative ? undefined : () => { setImageFailed(current => [...current,item.id]); beginTransition(); }} />
                    ) : item.image_url ? <p className="flex h-40 items-center justify-center bg-slate-100 text-sm text-slate-600">Gambar tidak dapat dimuat.</p> : <div className="h-24 bg-gradient-to-br from-cyan-100 to-indigo-100" />}
                    {!decorative && banners.length > 1 && <>
                      {slideIndex > 0 && <button onClick={() => move(-1)} aria-label="Banner sebelumnya" className="absolute left-2 top-3/4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl leading-none text-white hover:bg-black/75">‹</button>}
                      {slideIndex < banners.length - 1 && <button onClick={() => move(1)} aria-label="Banner berikutnya" className="absolute right-2 top-3/4 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl leading-none text-white hover:bg-black/75">›</button>}
                    </>}
                  </div>
                  <div className="px-4 pb-4 pt-3 text-center sm:px-5" data-banner-caption={decorative ? undefined : true}>
                    <div className="mb-3 text-sm tabular-nums text-gray-500" aria-live={decorative ? undefined : rotating ? "off" : "polite"} aria-atomic={decorative ? undefined : true}>{slideIndex + 1}/{banners.length}</div>
                    <h3 className="font-display text-lg font-bold leading-7 text-[#151B2B]">{item.title}</h3>
                    {item.body && <p className="mt-2 whitespace-pre-line break-words text-sm leading-5 text-gray-500">{item.body}</p>}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4 text-center sm:px-5" data-banner-actions aria-busy={waitingForImage || undefined}>
              <label className="mx-auto flex min-h-11 w-fit cursor-pointer items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700">
                <input type="checkbox" checked={false} disabled={waitingForImage} onChange={hideCurrent} className="peer sr-only" />
                <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border border-gray-300 bg-gray-100 peer-focus-visible:ring-2 peer-focus-visible:ring-[#315DEA] peer-focus-visible:ring-offset-2" />
                Jangan tampilkan lagi
              </label>
              {banner.cta_href && banner.cta_label ? <a href={banner.cta_href} aria-disabled={waitingForImage || undefined} tabIndex={waitingForImage ? -1 : undefined}
                onClick={event => { if (waitingForImage) event.preventDefault(); else close(); }}
                className="mt-1 flex min-h-11 w-full items-center justify-center rounded-md bg-[#315DEA] px-4 py-2 text-center text-base font-semibold text-white hover:bg-[#254FD0]">{banner.cta_label}</a>
                : <button onClick={close} disabled={waitingForImage} className="mt-1 min-h-11 w-full rounded-md bg-[#315DEA] px-4 py-2 text-base font-semibold text-white hover:bg-[#254FD0]">Saya Paham</button>}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
