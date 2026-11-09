"use client";

import { useEffect, useRef, useState } from "react";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";
import type { AdminSection } from "./AdminShell";

export type SupplierSectionId = "warung" | "sekalipay" | "tunvn" | "pairs" | "links";

export const SUPPLIER_ITEMS: { id: SupplierSectionId; label: string; icon: IosIconName }[] = [
  { id: "warung", label: "Warung Rebahan", icon: "shopping-bag" },
  { id: "sekalipay", label: "Sekalipay", icon: "wallet" },
  { id: "tunvn", label: "TUNVN", icon: "send" },
  { id: "pairs", label: "WR vs SK", icon: "discount" },
  { id: "links", label: "Link Supplier", icon: "link" },
];

/** Dropdown grup Supplier pada sidebar admin: menampung semua panel supplier
 *  agar sidebar tidak memanjang. Item aktif tetap terlihat dari label grup. */
export function SupplierDropdown({
  section,
  collapsed,
  onSection,
  badges = {},
}: {
  section: AdminSection;
  collapsed: boolean;
  onSection: (section: AdminSection) => void;
  badges?: Partial<Record<AdminSection, number>>;
}) {
  const activeItem = SUPPLIER_ITEMS.find((item) => item.id === section);
  const [open, setOpen] = useState(Boolean(activeItem));
  const rootRef = useRef<HTMLDivElement>(null);

  const activeId = activeItem?.id;
  useEffect(() => { if (activeId) setOpen(true); }, [activeId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open ]);

  const totalBadge = SUPPLIER_ITEMS.reduce((sum, item) => sum + (badges[item.id] ?? 0), 0);

  return (
    <div ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        title={collapsed ? "Supplier" : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left text-sm transition ${activeItem ? "bg-[#00E5FF] font-bold text-[#070a1e]" : "text-white/65 hover:bg-white/[0.08] hover:text-white"}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <IosIcon name="box" size={16} tint={activeItem ? "black" : "white"} className={activeItem ? "" : "opacity-80"} />
        </span>
        <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>
          Supplier{activeItem ? <span className="block truncate text-[11px] font-semibold opacity-70">{activeItem.label}</span> : null}
        </span>
        {totalBadge > 0 && (
          <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${activeItem ? "bg-[#07101f]/15 text-[#07101f]" : "bg-[#FFB800]/15 text-[#FFCF55]"} ${collapsed ? "lg:hidden" : ""}`}>
            {totalBadge > 99 ? "99+" : totalBadge}
          </span>
        )}
        <span aria-hidden className={`text-[10px] leading-none ${collapsed ? "lg:hidden" : "opacity-60"}`}>{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className={`mt-1 space-y-1 ${collapsed ? "" : "ml-4 border-l border-white/10 pl-2"}`} role="group" aria-label="Panel supplier">
          {SUPPLIER_ITEMS.map((item) => {
            const active = section === item.id;
            const badge = badges[item.id] ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSection(item.id)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-9 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left text-[13px] transition ${active ? "bg-[#00E5FF] font-bold text-[#070a1e]" : "text-white/60 hover:bg-white/[0.08] hover:text-white"}`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5">
                  <IosIcon name={item.icon} size={14} tint={active ? "black" : "white"} className={active ? "" : "opacity-80"} />
                </span>
                <span className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                {badge > 0 && <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${active ? "bg-[#07101f]/15 text-[#07101f]" : "bg-[#FFB800]/15 text-[#FFCF55]"} ${collapsed ? "lg:hidden" : ""}`}>{badge > 99 ? "99+" : badge}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
