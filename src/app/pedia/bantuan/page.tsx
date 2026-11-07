import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { PediaHelpContent } from "./help-content-client";

export const runtime = "edge";

// src/app/pedia/bantuan/page.tsx — Bantuan Pedia (PD-14).
// 2026-11-01 (owner): disamakan dengan "Cara order" Market — label kecil, judul,
// pengantar, kartu glass bernomor, FAQ accordion gaya Lacak, deret tombol.
// 2026-11-07: isi dipindah ke client agar bahasa mengikuti cookie axv_locale.
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "help", "/bantuan");
}

export default function PediaHelpPage() {
  return <PediaHelpContent />;
}
