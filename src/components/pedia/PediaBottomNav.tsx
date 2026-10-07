// src/components/pedia/PediaBottomNav.tsx — Bottom nav mobile Pedia (PD-16).
// Pola MobileBottomNav toko pusat, 4 tab, indikator violet.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/pedia", label: "Beranda", match: (p: string) => p === "/pedia" },
  { href: "/pedia/layanan", label: "Layanan", match: (p: string) => p.startsWith("/pedia/p/") || p === "/pedia/layanan" },
  { href: "/pedia/lacak", label: "Pesanan", match: (p: string) => p.startsWith("/pedia/pesanan") || p === "/pedia/lacak" },
  { href: "/pedia/bantuan", label: "Bantuan", match: (p: string) => p === "/pedia/bantuan" },
];

export function PediaBottomNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Navigasi Pedia" className="ax-glass-strong fixed inset-x-0 bottom-0 z-40 md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="grid grid-cols-4">
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-white" : "text-white/50"}`}
            >
              <span className={`h-1 w-8 rounded-full ${on ? "bg-[var(--px-violet)]" : "bg-transparent"}`} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
