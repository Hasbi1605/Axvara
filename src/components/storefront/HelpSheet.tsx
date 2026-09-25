"use client";

// Panel "Bantuan" dari bottom nav mobile (2026-09-25, keputusan owner): Cara
// Order, Garansi, dan Artikel tidak lagi memakan slot tab sendiri. Halaman-
// halaman itu tetap ditautkan dari footer, jadi SEO tidak berubah.
import Link from "next/link";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { useModalA11y } from "@/hooks/useModalA11y";
import { SITE, supportTelegramLink } from "@/lib/site";

const HELP_PAGES: { href: string; label: string; hint: string; icon: IosIconName }[] = [
  { href: "/cara-order", label: "Cara Order", hint: "Langkah beli sampai akun diterima", icon: "user-manual" },
  { href: "/garansi-replace", label: "Garansi & Replace", hint: "Syarat klaim dan cara penggantian", icon: "shield" },
  { href: "/artikel", label: "Artikel", hint: "Tips dan kabar seputar tools premium", icon: "news" },
];

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalA11y({ active: true, containerRef: panelRef, onClose, initialFocusRef: closeRef });

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-sheet-title"
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
            <h2 id="help-sheet-title" className="text-base font-bold text-white">Bantuan</h2>
            <p className="mt-0.5 text-xs text-white/45">Tim kami siap membantu di jam layanan.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup bantuan"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white"
          >
            <span aria-hidden><IosIcon name="close" size={14} tint="white" /></span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <StoreWhatsAppLink
            message="saya butuh bantuan"
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white transition hover:border-[#25D366]/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/whatsapp-circle.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /> WA Admin
          </StoreWhatsAppLink>
          <a
            href={supportTelegramLink()}
            target="_blank"
            rel="noreferrer"
            aria-label={`Telegram @${SITE.supportTelegram}`}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white transition hover:border-[#229ED9]/50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/telegram.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0 rounded-full object-cover" draggable={false} /> Telegram
          </a>
        </div>

        <ul className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
          {HELP_PAGES.map((page) => (
            <li key={page.href}>
              <Link href={page.href} onClick={onClose} className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.05]">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
                  <IosIcon name={page.icon} size={18} tint="#00E5FF" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{page.label}</span>
                  <span className="block truncate text-[11px] text-white/45">{page.hint}</span>
                </span>
                <span aria-hidden className="shrink-0"><IosIcon name="chevron-right" size={14} tint="white" className="opacity-40" /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
