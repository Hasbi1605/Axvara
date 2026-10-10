"use client";

import type { ReactNode } from "react";
import { useStoreSettings } from "@/hooks/useStoreSettings";
import { waHubLink } from "@/lib/site";

export function StoreWhatsAppLink({ message, className, children }: { message?: string; className?: string; children: ReactNode }) {
  const settings = useStoreSettings();
  const greeting = message ? `Halo ${settings.name}, ${message}` : `Halo ${settings.name}`;
  // 2026-10-10: lewat hub /wa (bukan wa.me langsung) — user pilih nomor aktif.
  return <a href={waHubLink(greeting)} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}
