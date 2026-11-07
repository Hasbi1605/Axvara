import type { Metadata } from "next";
import { PediaTermsContent } from "./terms-content-client";

export const runtime = "edge";

// src/app/pedia/ketentuan/page.tsx — S&K Pedia (PRD §11).
// 2026-11-01 (owner): struktur mengikuti "Ketentuan layanan & garansi" Market —
// label kecil, pengantar, kartu glass per topik, catatan amber, deret tombol.
// Isi ketujuh poin lama dipertahankan, hanya dikelompokkan per topik.
// 2026-11-07: isi dipindah ke client agar bahasa mengikuti cookie axv_locale.
export const metadata: Metadata = {
  title: "Ketentuan layanan",
  description: "Ketentuan layanan AXVARA Pedia: syarat target, refill, pesanan sebagian, dan konten yang dilarang.",
  alternates: { canonical: "/ketentuan" },
};

export default function PediaTermsPage() {
  return <PediaTermsContent />;
}
