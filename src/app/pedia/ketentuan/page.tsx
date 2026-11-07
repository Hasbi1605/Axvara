import type { Metadata } from "next";
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaPageMetadata } from "@/lib/pedia/metadata";
import { PediaTermsContent } from "./terms-content-client";

export const runtime = "edge";

// src/app/pedia/ketentuan/page.tsx — S&K Pedia (PRD §11).
// 2026-11-01 (owner): struktur mengikuti "Ketentuan layanan & garansi" Market —
// label kecil, pengantar, kartu glass per topik, catatan amber, deret tombol.
// Isi ketujuh poin lama dipertahankan, hanya dikelompokkan per topik.
// 2026-11-07: isi dipindah ke client agar bahasa mengikuti cookie axv_locale.
export async function generateMetadata(): Promise<Metadata> {
  return pediaPageMetadata(await requestLocale(), "terms", "/ketentuan");
}

export default function PediaTermsPage() {
  return <PediaTermsContent />;
}
