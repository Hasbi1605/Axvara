// src/components/pedia/AppSwitcher.tsx — Segmented pill Apps · Pedia · AI.
// Dipakai di navbar Pedia (aktif pedia). Cross-host: pedia.axvara.tech dan
// axvara.tech adalah host berbeda — SEMUA href absolut agar tidak rewrite
// ke host yang salah (fix 2026-10-08: pill tidak bisa pindah halaman).
// AI = badge "Segera" → /ai (rute Pedia; dibuat saat AI diluncurkan).
import Link from "next/link";

export type AppSwitchOption = "apps" | "pedia" | "ai";

const OPTIONS: { id: AppSwitchOption; label: string; href: string; badge?: string }[] = [
  { id: "apps", label: "Apps", href: "https://axvara.tech/" },
  { id: "pedia", label: "Pedia", href: "https://pedia.axvara.tech/pedia" },
  { id: "ai", label: "AI", href: "https://pedia.axvara.tech/ai", badge: "Segera" },
];

export function AppSwitcher({ active, compact = false }: { active: AppSwitchOption; compact?: boolean }) {
  // 2026-10-08 (owner): tanpa highlight menyala — tab aktif = teks putih
  // biasa, tab lain redup. Tanpa pill ungu, tanpa aria-current menonjol.
  return (
    <nav aria-label="Pindah aplikasi Axvara" className="flex h-9 items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-1">
      {OPTIONS.map((o) => {
        const on = o.id === active;
        return (
          <Link
            key={o.id}
            href={o.href}
            className={`flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-semibold transition-colors ${
              on ? "text-white" : "text-white/55 hover:text-white"
            }`}
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
