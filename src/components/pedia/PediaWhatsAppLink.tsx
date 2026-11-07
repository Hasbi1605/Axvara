"use client";

import type { ReactNode } from "react";
import { waHubLink } from "@/lib/site";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

// Kembar StoreWhatsAppLink Market untuk hero Pedia — lewat hub /wa
// (bukan wa.me langsung) agar suspend satu nomor tak mematikan tombol.
export function PediaWhatsAppLink({ message, className, children }: { message?: string; className?: string; children: ReactNode }) {
  const locale = useDisplayLocale();
  const greeting = message ? `${locale === "en" ? "Hello AXVARA Pedia" : "Halo AXVARA Pedia"}, ${message}` : (locale === "en" ? "Hello AXVARA Pedia" : "Halo AXVARA Pedia");
  return <a href={waHubLink(greeting)} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}
