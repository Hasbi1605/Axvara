import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cara Order | AXVARA",
  description: "Panduan memesan produk digital di AXVARA.",
  alternates: { canonical: "/cara-order" },
};

export default function CaraOrderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
