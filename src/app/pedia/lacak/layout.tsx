import type { Metadata } from "next";

// Halaman lacak adalah client component, jadi metadata-nya dipasang lewat layout (2026-11-01).
export const metadata: Metadata = {
  title: "Lacak pesanan",
  description: "Cek status pesanan AXVARA Pedia dengan kode pesanan dan kontak checkout, tanpa login.",
  alternates: { canonical: "/lacak" },
};

export default function PediaTrackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
