"use client";

import type { ReactNode } from "react";
import { useStoreSettings } from "@/hooks/useStoreSettings";
import { whatsappLink } from "@/lib/site";

export function StoreWhatsAppLink({ message, className, children }: { message?: string; className?: string; children: ReactNode }) {
  const settings = useStoreSettings();
  const greeting = message ? `Halo ${settings.name}, ${message}` : `Halo ${settings.name}`;
  return <a href={whatsappLink(settings.whatsappNumber, greeting)} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}
