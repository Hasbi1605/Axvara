"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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

export function PopupBanner() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith("/admin");
  const isHome = pathname === "/";
  const [banner, setBanner] = useState<Banner | null>(null);
  const [open, setOpen] = useState(false);
  const [imageRatio, setImageRatio] = useState<number | null>(null);

  useEffect(() => {
    setOpen(false);
    setBanner(null);
    setImageRatio(null);
    if (isAdmin || !isHome) return;

    const controller = new AbortController();
    let disposed = false;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // Defer banner fetch to avoid blocking initial page load
    const doFetch = () => {
      fetch("/api/banners?active=1", { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => {
          if (disposed) return;
          const b = (j.banners as Banner[])?.[0];
          if (!b) return;
          const storageKey = `axvara-banner-${b.id}-shows`;
          const shown = Number(sessionStorage.getItem(storageKey) ?? 0);
          const maximum = Math.min(10, Math.max(1, b.max_show_per_session ?? 1));
          if (shown >= maximum) return;
          setBanner(b);
          const delay = Math.min(10000, Math.max(0, b.delay_ms ?? 1500));
          openTimer = setTimeout(() => {
            if (!disposed) {
              setOpen(true);
              try { sessionStorage.setItem(storageKey, String(shown + 1)); } catch {}
            }
          }, delay);
        })
        .catch(() => {});
    };

    // Use requestIdleCallback to fetch banner only when browser is idle
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(doFetch, { timeout: 3000 });
    } else {
      fallbackTimer = setTimeout(doFetch, 2000);
    }

    return () => {
      disposed = true;
      controller.abort();
      if (idleId !== null && "cancelIdleCallback" in window) {
        (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
      }
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (openTimer !== null) clearTimeout(openTimer);
    };
  }, [isAdmin, isHome]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (isAdmin || !isHome || !banner || !open) return null;

  const close = () => {
    setOpen(false);
  };
  const adaptiveWidth = imageRatio
    ? Math.min(960, Math.max(320, Math.round(imageRatio * 520)))
    : 520;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-label={banner.title}>
      <div className="absolute inset-0 bg-[#070a1e]/70 backdrop-blur-sm" onClick={close} />
      <div
        className="relative max-h-[92dvh] max-w-[94vw] overflow-y-auto rounded-[24px] border border-white/10 bg-[#0f1430] shadow-[0_24px_64px_rgba(0,0,0,0.5)] animate-[fadeInUp_0.32s_var(--ease-apple)]"
        style={{ width: `min(94vw, ${adaptiveWidth}px)` }}
      >
        <button onClick={close} className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/80 backdrop-blur-md hover:bg-black/75 hover:text-white" aria-label="Tutup banner">✕</button>
        {banner.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <div className="flex w-full justify-center overflow-hidden bg-black/15">
            <img
              src={banner.image_url}
              alt={banner.title}
              className="block h-auto max-h-[62dvh] max-w-full object-contain"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight) setImageRatio(image.naturalWidth / image.naturalHeight);
              }}
            />
          </div>
        )}
        <div className="p-5 sm:p-6">
          <h3 className="font-display font-bold text-white text-lg leading-tight">{banner.title}</h3>
          {banner.body && <p className="mt-2 text-sm leading-6 text-white/60">{banner.body}</p>}
          {banner.cta_href && banner.cta_label && (
            <a href={banner.cta_href} onClick={close} className="mt-4 inline-flex h-10 px-5 rounded-full bg-[#00E5FF] text-[#070a1e] text-sm font-bold hover:bg-[#00D0E8] items-center justify-center">
              {banner.cta_label}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
