"use client";

import { useCallback, useEffect, useState } from "react";
import { SITE, adminWaLink, supportTelegramLink } from "@/lib/site";
import { useStoreSettings } from "@/hooks/useStoreSettings";
import { useToast } from "@/components/ui/Toast";

const WA_GROUP_HREF = "https://chat.whatsapp.com/CzONe7Mx9Q7Eyt3k94C9ze?mode=gi_t";
const TG_BOT_HREF = `https://t.me/${SITE.adminTelegram}?start=beli`;
const LINK_URL = `${SITE.webUrl}/link`;

type BioLink = {
  href: string;
  external?: boolean;
  label: string;
  hint: string;
  icon: "globe" | "telegram" | "whatsapp" | "track" | "support-wa" | "support-tg" | "pedia";
};

function iconSrc(icon: BioLink["icon"]): string {
  if (icon === "telegram") return "/brand/telegram.svg";
  if (icon === "whatsapp") return "/brand/whatsapp-circle.svg";
  if (icon === "support-wa") return "/brand/support-wa-question.png";
  if (icon === "support-tg") return "/brand/support-telegram-question.png";
  if (icon === "globe") return "/brand/website-circle.png";
  if (icon === "track") return "/brand/track-circle.png";
  if (icon === "pedia") return "/brand/pedia-circle.svg";
  return "";
}

function IconBadge({ icon }: { icon: BioLink["icon"] }) {
  const src = iconSrc(icon);
  // Semua ikon kini solid-circle 160px — seragam dengan Telegram/WA/bantuan.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" draggable={false} />;
}

export function LinkBioClient() {
  const settings = useStoreSettings();
  const toast = useToast();
  const [shared, setShared] = useState(false);

  useEffect(() => {
    document.title = "AXVARA • Link Bio";
  }, []);

  const share = useCallback(async () => {
    const data = { title: "AXVARA • Link Bio", text: "Semua link AXVARA — katalog, bot Telegram, grup WA, dan bantuan.", url: LINK_URL };
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await (navigator as Navigator & { share: (d: typeof data) => Promise<void> }).share(data);
        return;
      }
      throw new Error("no-native-share");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(LINK_URL);
        setShared(true);
        toast.success("Tautan disalin — tempel di bio atau chat.");
        setTimeout(() => setShared(false), 2500);
      } catch {
        toast.error("Gagal membagikan — salin manual: axvara.tech/link");
      }
    }
  }, [toast]);

  const links: BioLink[] = [
    { href: "/", label: "Katalog Web", hint: "Semua tools premium", icon: "globe" },
    // 2026-10-08 (owner): kartu Pedia DISEMBUNYIKAN dari /link. Kode disimpan —
    // kembalikan 1 baris ini saat owner memutuskan memunculkan:
    // { href: "/pedia?utm_source=axvara&utm_medium=link_bio", label: "Axvara Pedia — naikkan sosmedmu", hint: "Followers, likes & views · QRIS", icon: "pedia" },
    { href: TG_BOT_HREF, external: true, label: "Bot Telegram", hint: "Auto order 24 jam", icon: "telegram" },
    { href: WA_GROUP_HREF, external: true, label: "Grup WhatsApp", hint: "Info promo & restock", icon: "whatsapp" },
    { href: "/lacak-pesanan", label: "Lacak Pesanan", hint: "Cek status dengan kode + WA/email", icon: "track" },
    // 2026-10-10: Support WA lewat hub /wa (pilih nomor aktif) — internal, tanpa external.
    { href: adminWaLink("Halo AXVARA, saya butuh bantuan."), label: "Support WhatsApp", hint: "Pilih nomor aktif", icon: "support-wa" },
    { href: supportTelegramLink(), external: true, label: "Support Telegram", hint: `@${SITE.supportTelegram}`, icon: "support-tg" },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[480px] overflow-x-clip px-5 pb-14 pt-10 sm:pt-14">
      {/* Meteor jatuh tipis — GPU-only (transform/opacity), dimatikan bila reduced-motion */}
      <div aria-hidden className="ax-meteors pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span className="ax-meteor" style={{ left: "12%", animationDelay: "0.6s", animationDuration: "7.5s" }} />
        <span className="ax-meteor" style={{ left: "48%", animationDelay: "2.8s", animationDuration: "9s" }} />
        <span className="ax-meteor" style={{ left: "78%", animationDelay: "4.5s", animationDuration: "8s" }} />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="absolute left-1/2 top-[-140px] h-[340px] w-[520px] -translate-x-1/2 rounded-full opacity-25 blur-[70px]" style={{ background: "radial-gradient(ellipse at center, #00E5FF, transparent 70%)" }} />
        <div className="absolute right-[-60px] top-[120px] h-[180px] w-[180px] rounded-full opacity-15 blur-[60px]" style={{ background: "radial-gradient(circle, #FFB800, transparent 70%)" }} />
      </div>

      <div className="flex flex-col items-center text-center animate-[fadeInUp_0.4s_var(--ease-apple)]">
        <button
          type="button"
          onClick={share}
          aria-label="Bagikan halaman link AXVARA"
          className="absolute right-5 top-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition hover:border-[#00E5FF]/40 hover:text-white sm:right-2"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {shared ? <path d="M4.5 12.5 10 18 19.5 6.5" /> : <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="5.5" r="2.4" /><circle cx="17.5" cy="18.5" r="2.4" /><path d="m8.2 10.8 7-4M8.2 13.2l7 4" /></>}
          </svg>
        </button>

        <span className="flex h-[76px] w-[84px] items-center justify-center rounded-[26px] border border-white/10 bg-white/[0.05] shadow-[0_12px_40px_rgba(0,229,255,0.18)] backdrop-blur-xl">
          {settings.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.logoUrl} alt="Logo AXVARA" className="h-[52px] w-[58px] object-contain" draggable={false} />
          ) : (
            <svg viewBox="0 0 120 110" className="h-[52px] w-[58px] text-white" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
              <path d="M60 4 L6.5 104 L113.5 104 Z" /><path d="M60 4 L60 49.5" /><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" /><path d="M35.8 78.5 L84.2 78.5" /><path d="M35.8 78.5 L6.5 104" /><path d="M84.2 78.5 L113.5 104" />
            </svg>
          )}
        </span>
        <h1 className="mt-4 font-display text-[22px] font-bold tracking-[-0.01em] text-white">@axvara.tech</h1>
        <p className="mt-1.5 text-[15px] font-semibold leading-6 text-white/85">Satu gerbang, semua tools premium</p>
        <p className="mt-1 text-[13px] leading-6 text-white/55">AI, streaming, desain, dan musik.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Order Tanpa Login</span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Bergaransi</span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Fast Respon</span>
        </div>
      </div>

      <nav aria-label="Link AXVARA" className="mt-7 flex flex-col gap-2.5">
        {links.map((link, i) => (
          <a
            key={link.label}
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
            style={{ animationDelay: `${80 + i * 60}ms` }}
            className="group flex min-h-[64px] items-center gap-3.5 rounded-2xl border border-[#00E5FF]/25 bg-[#00E5FF]/[0.08] px-4 py-3.5 text-left shadow-[0_8px_28px_rgba(0,229,255,0.12)] backdrop-blur-xl transition duration-300 animate-[fadeInUp_0.45s_var(--ease-apple)_both] hover:border-[#00E5FF]/50 hover:bg-[#00E5FF]/[0.12] active:scale-[0.98]"
          >
            <IconBadge icon={link.icon} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight text-white">{link.label}</span>
              <span className="mt-0.5 block truncate text-xs leading-tight text-white/50">{link.hint}</span>
            </span>
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white/50 transition group-hover:bg-[#00E5FF]/15 group-hover:text-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17 17 7M9 7h8v8" />
              </svg>
            </span>
          </a>
        ))}
      </nav>

      <button
        type="button"
        onClick={share}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-sm font-semibold text-white/70 transition hover:border-[#00E5FF]/40 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {shared ? <path d="M4.5 12.5 10 18 19.5 6.5" /> : <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="5.5" r="2.4" /><circle cx="17.5" cy="18.5" r="2.4" /><path d="m8.2 10.8 7-4M8.2 13.2l7 4" /></>}
        </svg>
        {shared ? "Tautan disalin" : "Bagikan halaman ini"}
      </button>

      <p className="mt-6 text-center text-xs text-white/35">© 2026 {settings.name}</p>
    </div>
  );
}
