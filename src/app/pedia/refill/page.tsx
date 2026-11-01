import type { Metadata } from "next";
import { PediaRefillClient } from "./refill-client";

export const runtime = "edge";

// src/app/pedia/refill/page.tsx — Halaman Refill Pedia (2026-11-01).
export const metadata: Metadata = {
  title: "Refill pesanan",
  description: "Ajukan refill AXVARA Pedia untuk layanan bergaransi yang drop, dengan kode pesanan dan kontak checkout.",
  alternates: { canonical: "/refill" },
};

export default function PediaRefillPage() {
  return <PediaRefillClient />;
}
