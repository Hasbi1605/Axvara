"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { SITE, SUPPORT_WA_NUMBERS, supportTelegramLink, whatsappLink } from "@/lib/site";
import { useStoreSettings } from "@/hooks/useStoreSettings";

// Hub pemilih nomor WA admin (2026-10-10, keputusan owner): SEMUA tombol WA
// (web, /link, footer, lacak, pesanan, keyboard Telegram) mendarat di sini —
// suspend satu nomor tidak mematikan traffic. Gaya kartu = /link.
export function WaHubClient() {
  const params = useSearchParams();
  const settings = useStoreSettings();
  const pesan = useMemo(() => {
    const raw = (params.get("pesan") ?? "").trim().slice(0, 300);
    return raw || "Halo AXVARA";
  }, [params]);

  return (
    <div className="relative mx-auto w-full max-w-[480px] overflow-x-clip px-5 pb-14 pt-10 sm:pt-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="absolute left-1/2 top-[-140px] h-[340px] w-[520px] -translate-x-1/2 rounded-full opacity-25 blur-[70px]" style={{ background: "radial-gradient(ellipse at center, #25D366, transparent 70%)" }} />
      </div>

      <div className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/whatsapp-circle.svg" alt="WhatsApp" width={64} height={64} className="h-16 w-16 rounded-full object-cover shadow-[0_12px_40px_rgba(37,211,102,0.25)]" draggable={false} />
        <h1 className="mt-4 font-display text-[22px] font-bold tracking-[-0.01em] text-white">Chat WhatsApp Admin</h1>
        <p className="mt-1.5 text-[13px] leading-6 text-white/55">Pilih nomor yang aktif.</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">{settings.supportHours}</span>
        </div>
      </div>

      <nav aria-label="Nomor WhatsApp admin" className="mt-7 flex flex-col gap-2.5">
        {SUPPORT_WA_NUMBERS.map((n) => {
          const active = n.status === "active";
          return (
            <a
              key={n.intl}
              href={whatsappLink(n.intl, pesan)}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-[64px] items-center gap-3.5 rounded-2xl border border-[#25D366]/25 bg-[#25D366]/[0.07] px-4 py-3.5 text-left backdrop-blur-xl transition duration-300 hover:border-[#25D366]/50 hover:bg-[#25D366]/[0.12] active:scale-[0.98]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/whatsapp-circle.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" draggable={false} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-semibold leading-tight text-white">
                  {n.label}
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-[#25D366]/15 text-[#4ade80]" : "bg-[#FFB800]/15 text-[#FFD66B]"}`}>
                    {active ? "Aktif" : "Suspend sementara"}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-xs leading-tight text-white/50">{n.local} • {n.hint}</span>
              </span>
              <span aria-hidden className="flex h-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] px-3 text-xs font-bold text-white/70 transition group-hover:bg-[#25D366]/20 group-hover:text-white">Chat</span>
            </a>
          );
        })}
        <a
          href={supportTelegramLink()}
          target="_blank"
          rel="noreferrer"
          className="group flex min-h-[64px] items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left backdrop-blur-xl transition duration-300 hover:border-[#229ED9]/40 active:scale-[0.98]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/telegram.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-full object-cover" draggable={false} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight text-white">Support Telegram</span>
            <span className="mt-0.5 block truncate text-xs leading-tight text-white/50">@{SITE.supportTelegram} • tidak pernah suspend</span>
          </span>
          <span aria-hidden className="flex h-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] px-3 text-xs font-bold text-white/70 transition group-hover:text-white">Chat</span>
        </a>
      </nav>

      <p className="mt-6 text-center text-xs text-white/35">© 2026 {settings.name}</p>
    </div>
  );
}
