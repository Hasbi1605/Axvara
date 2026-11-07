import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";

// Halaman lacak adalah client component, jadi metadata-nya dipasang lewat layout (2026-11-01).
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "track", "/lacak");
}

export default function PediaTrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
