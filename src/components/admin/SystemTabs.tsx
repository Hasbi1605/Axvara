"use client";

import type { AdminSection } from "@/components/admin/AdminShell";

// Integrasi Agent (token MCP, diatur sekali) dan Subscriber Email (daftar
// baca-saja) dulu memakan slot sidebar sejajar Pesanan/Produk. Keduanya kini
// tab di bawah Pengaturan Toko. Nilai `section` TIDAK berubah, sehingga
// tautan/bookmark lama (?section=agent) tetap membuka layar yang benar.
export const SYSTEM_TABS: [AdminSection, string][] = [
  ["settings", "Identitas Toko"],
  ["agent", "Integrasi Agent"],
  ["subscribers", "Subscriber Email"],
];

export function SystemTabs({
  section,
  onSection,
  children,
}: {
  section: AdminSection;
  onSection: (section: AdminSection) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4">
      <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="Bagian sistem">
        {SYSTEM_TABS.map(([id, label]) => {
          const active = section === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onSection(id)}
              className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${active ? "bg-[#00E5FF] text-[#07101f]" : "text-white/55 hover:text-white"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {children}
    </section>
  );
}
