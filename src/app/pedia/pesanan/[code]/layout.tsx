import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";

// Metadata halaman status (page-nya client component, jadi layout server).
export const runtime = "edge";

export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "order");
}

export default function PediaOrderStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
