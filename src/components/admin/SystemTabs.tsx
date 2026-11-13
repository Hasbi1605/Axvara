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
      <div className="inline-flex flex-wrap rounded-xl border border-admin-border bg-admin-subtle p-1" role="tablist" aria-label="Bagian sistem">
        {SYSTEM_TABS.map(([id, label]) => {
          const active = section === id;
          return (
            <button
              key={id}
              role="tab"
               aria-selected={active}
               tabIndex={active ? 0 : -1}
               onKeyDown={event => {
                 const index = SYSTEM_TABS.findIndex(([key]) => key === id);
                 const next = event.key === "Home" ? 0 : event.key === "End" ? SYSTEM_TABS.length - 1 : event.key === "ArrowRight" ? (index + 1) % SYSTEM_TABS.length : event.key === "ArrowLeft" ? (index + SYSTEM_TABS.length - 1) % SYSTEM_TABS.length : null;
                 if (next === null) return;
                 event.preventDefault();
                 (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next])?.focus();
                 onSection(SYSTEM_TABS[next][0]);
               }}
              onClick={() => onSection(id)}
              className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${active ? "bg-admin-primary text-admin-inverse" : "text-admin-muted hover:text-admin-fg"}`}
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
