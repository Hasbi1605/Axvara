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
    fetch("/api/banners?active=1")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        const b = (j.banners as Banner[])?.[0];
        if (!b) return;
        setBanner(b);
        const delay = Math.min(10000, Math.max(0, b.delay_ms ?? 1500));
        const t = setTimeout(() => setOpen(true), delay);
        return () => clearTimeout(t);
      })
      .catch(() => {});
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
