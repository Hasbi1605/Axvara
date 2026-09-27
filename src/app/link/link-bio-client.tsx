"use client";

import { useCallback, useEffect, useState } from "react";
import { SITE, adminWaLink, supportTelegramLink } from "@/lib/site";
import { useStoreSettings } from "@/hooks/useStoreSettings";
import { useToast } from "@/components/ui/Toast";

const WA_GROUP_HREF = "https://chat.whatsapp.com/D0GGXwVjJkL3qjxvacDRAP?s=cl&p=a&mlu=4&ilr=4";
const TG_BOT_HREF = `https://t.me/${SITE.adminTelegram}?start=beli`;
const LINK_URL = `${SITE.webUrl}/link`;

type BioLink = {
  href: string;
  external?: boolean;
  label: string;
  hint: string;
  icon: "globe" | "telegram" | "whatsapp" | "track" | "support-wa" | "support-tg";
  feature?: boolean;
};

function iconSrc(icon: BioLink["icon"]): string {
  if (icon === "telegram") return "/brand/telegram.svg";
  if (icon === "whatsapp") return "/brand/whatsapp-circle.svg";
  if (icon === "support-wa") return "/brand/support-wa-question.png";
  if (icon === "support-tg") return "/brand/support-telegram-question.png";
  return "";
}

function IconBadge({ icon, feature }: { icon: BioLink["icon"]; feature?: boolean }) {
  const src = iconSrc(icon);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" draggable={false} />;
  }
  const glyph =
    icon === "globe" ? (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#00E5FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5s1.2-6.1 3.6-8.5Z" />
      </svg>
    ) : icon === "track" ? (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#00E5FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 7.5h13v9H6.5A2.5 2.5 0 0 1 4 14V7.5Z" />
        <path d="M17 10h2.6a1.5 1.5 0 0 1 1.4 2v4.5h-2.5" />
        <circle cx="8" cy="17.5" r="1.6" />
        <circle cx="17.5" cy="17.5" r="1.6" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke={feature ? "#229ED9" : "#25D366"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.9A8 8 0 1 1 21 12Z" />
        <path d="M9 11.5c.8 1.6 2 2.8 3.6 3.6l1.4-1.4 2 1c-.3 1.2-1.4 1.9-2.6 1.6-2.8-.7-5-2.9-5.7-5.7-.3-1.2.4-2.3 1.6-2.6l1 2L9 11.5Z" />
      </svg>
    );
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06]">
      {glyph}
    </span>
  );
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
    { href: "/", label: "Katalog Web", hint: "Semua tools premium + checkout QRIS", icon: "globe", feature: true },
    { href: TG_BOT_HREF, external: true, label: "Bot Telegram", hint: "Auto order 24 jam", icon: "telegram", feature: true },
    { href: WA_GROUP_HREF, external: true, label: "Grup WhatsApp", hint: "Info promo & restock", icon: "whatsapp" },
    { href: "/lacak-pesanan", label: "Lacak Pesanan", hint: "Cek status dengan kode + WA/email", icon: "track" },
    { href: adminWaLink("Halo AXVARA, saya butuh bantuan."), external: true, label: "WA Admin", hint: settings.supportHours, icon: "support-wa" },
    { href: supportTelegramLink(), external: true, label: "Telegram Bantuan", hint: `@${SITE.supportTelegram}`, icon: "support-tg" },
  ];

  return (
    <main className="relative mx-auto w-full max-w-[480px] px-5 pb-14 pt-10 sm:pt-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]">
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
            className={`group flex min-h-[64px] items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left backdrop-blur-xl transition duration-300 animate-[fadeInUp_0.45s_var(--ease-apple)_both] active:scale-[0.98] ${
              link.feature
                ? "border-[#00E5FF]/25 bg-[#00E5FF]/[0.08] shadow-[0_8px_28px_rgba(0,229,255,0.12)] hover:border-[#00E5FF]/50 hover:bg-[#00E5FF]/[0.12]"
                : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]"
            }`}
          >
            <IconBadge icon={link.icon} feature={link.feature} />
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
    </main>
  );
}
