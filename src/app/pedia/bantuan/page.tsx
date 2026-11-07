import type { Metadata } from "next";
import { PediaHelpContent } from "./help-content-client";

export const runtime = "edge";

// src/app/pedia/bantuan/page.tsx — Bantuan Pedia (PD-14).
// 2026-11-01 (owner): disamakan dengan "Cara order" Market — label kecil, judul,
// pengantar, kartu glass bernomor, FAQ accordion gaya Lacak, deret tombol.
// 2026-11-07: isi dipindah ke client agar bahasa mengikuti cookie axv_locale.
export const metadata: Metadata = {
  title: "Bantuan & cara order",
  description: "Cara memesan layanan AXVARA Pedia dan jawaban pertanyaan yang sering ditanyakan.",
  alternates: { canonical: "/bantuan" },
};

export default function PediaHelpPage() {
  return <PediaHelpContent />;
}
