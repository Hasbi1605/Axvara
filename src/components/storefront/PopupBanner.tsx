"use client";
import { useEffect, useState } from "react";

type Banner = {
  id: number;
  title: string;
  body?: string | null;
  image_url?: string | null;
  cta_label?: string | null;
  cta_href?: string | null;
  is_active: number;
  delay_ms?: number | null;
};

export function PopupBanner() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem("axvara-banner-dismissed");
    if (dismissed) return;
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
          setBanner(b);
          const delay = Math.min(10000, Math.max(0, b.delay_ms ?? 1500));
          openTimer = setTimeout(() => {
            if (!disposed) setOpen(true);
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
  }, []);

  if (!banner || !open) return null;

  const close = () => {
    setOpen(false);
    try { sessionStorage.setItem("axvara-banner-dismissed", "1"); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#070a1e]/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-[520px] overflow-hidden rounded-[24px] border border-white/10 bg-[#0f1430] shadow-[0_24px_64px_rgba(0,0,0,0.5)] animate-[fadeInUp_0.32s_var(--ease-apple)]">
        <button onClick={close} className="absolute right-3 top-3 z-10 w-8 h-8 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 flex items-center justify-center" aria-label="Tutup">✕</button>
        {banner.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner.image_url} alt={banner.title} className="w-full aspect-[16/9] object-cover" />
        )}
        <div className="p-5 sm:p-6">
          <h3 className="font-display font-bold text-white text-lg leading-tight">{banner.title}</h3>
          {banner.body && <p className="mt-2 text-sm leading-6 text-white/60 line-clamp-3">{banner.body}</p>}
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
