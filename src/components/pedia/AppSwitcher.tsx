// src/components/pedia/AppSwitcher.tsx — Segmented pill Apps · Pedia · AI.
// Indikator aktif = pill latar --px-violet-soft + teks putih, geser 300ms
// --ease-apple. Dipakai di navbar Pedia (aktif pedia) + navbar axvara.tech
// (aktif apps, M6). AI = badge "Segera" → waitlist.
import Link from "next/link";

export type AppSwitchOption = "apps" | "pedia" | "ai";

const OPTIONS: { id: AppSwitchOption; label: string; href: string; badge?: string }[] = [
  { id: "apps", label: "Apps", href: "https://axvara.tech?utm_source=pedia&utm_medium=switcher" },
  { id: "pedia", label: "Pedia", href: "/pedia" },
  { id: "ai", label: "AI", href: "https://axvara.tech/ai?utm_source=pedia&utm_medium=switcher", badge: "Segera" },
];

export function AppSwitcher({ active, compact = false }: { active: AppSwitchOption; compact?: boolean }) {
  return (
    <nav aria-label="Pindah aplikasi Axvara" className="flex h-9 items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-1">
      {OPTIONS.map((o) => {
        const on = o.id === active;
        return (
          <Link
            key={o.id}
            href={o.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-all duration-300 ${
              on ? "bg-[var(--px-violet-soft)] text-white" : "text-white/55 hover:text-white"
            }`}
            style={on ? { transitionTimingFunction: "var(--ease-apple)" } : undefined}
          >
            {compact ? o.label.slice(0, 2) : o.label}
            {o.badge && !compact && (
              <span className="rounded-full bg-[#FFB800]/15 px-1.5 py-px text-[10px] font-bold text-[#FFCF55]">{o.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
