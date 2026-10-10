// src/components/pedia/PediaBottomNav.tsx — Bottom nav mobile Pedia (PD-16).
// 2026-10-08 (owner): konsisten PENUH dengan MobileBottomNav pusat — ikon
// IosIcon (home/category/purchase-order/chat), aktif = cyan #00E5FF + titik,
// nonaktif putih 55%, animasi transition-all + active:scale-95, shell
// bg/backdrop-blur + border-t + shadow atas + safe-area.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";

const TABS: { href: string; label: string; icon: IosIconName; match: (p: string) => boolean }[] = [
  { href: "/pedia", label: "Beranda", icon: "home", match: (p) => p === "/pedia" },
  { href: "/pedia/layanan", label: "Layanan", icon: "category", match: (p) => p.startsWith("/pedia/p/") || p === "/pedia/layanan" },
  { href: "/pedia/lacak", label: "Pesanan", icon: "purchase-order", match: (p) => p.startsWith("/pedia/pesanan") || p === "/pedia/lacak" },
  { href: "/pedia/bantuan", label: "Bantuan", icon: "chat", match: (p) => p === "/pedia/bantuan" },
];

export function PediaBottomNav() {
  const path = usePathname() ?? "";
  // 2026-10-08: halaman order punya sticky bar sendiri (total + Bayar) —
  // bottom nav disembunyikan agar tidak menumpuk (dua fixed = jelek mobile).
  if (path.startsWith("/pedia/o/")) return null;
  return (
    <nav
      aria-label="Navigasi Pedia"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#080C1E]/92 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.6)] backdrop-blur-xl md:hidden"
    >
      <div className="flex items-center justify-around">
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <Link prefetch={false}
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className="flex flex-1 justify-center"
            >
              <span
                className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-1 transition-all duration-200 ${
                  on ? "text-[#00E5FF]" : "text-white/55 hover:text-white/90 active:scale-95"
                }`}
              >
                <span aria-hidden className="relative flex h-6 w-6 items-center justify-center">
                  <IosIcon
                    name={t.icon}
                    size={20}
                    tint={on ? "#00E5FF" : "white"}
                    className={on ? "" : "opacity-55"}
                  />
                </span>
                <span className={`mt-1 text-[10.5px] leading-none tracking-tight ${on ? "font-bold text-[#00E5FF]" : "font-medium"}`}>
                  {t.label}
                </span>
                {on && <span aria-hidden className="mt-1 h-1 w-1 rounded-full bg-[#00E5FF] shadow-[0_0_4px_#00E5FF]" />}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
