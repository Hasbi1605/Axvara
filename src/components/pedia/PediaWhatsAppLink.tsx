"use client";

import type { ReactNode } from "react";
import { waHubLink } from "@/lib/site";

// Kembar StoreWhatsAppLink Market untuk hero Pedia — lewat hub /wa
// (bukan wa.me langsung) agar suspend satu nomor tak mematikan tombol.
export function PediaWhatsAppLink({ message, className, children }: { message?: string; className?: string; children: ReactNode }) {
  const greeting = message ? `Halo AXVARA Pedia, ${message}` : "Halo AXVARA Pedia";
  return <a href={waHubLink(greeting)} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}
