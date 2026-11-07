// src/lib/pedia/metadata.ts — Metadata halaman Pedia ID/EN (2026-11-07).
// Canonical/robots TIDAK diubah kecuali route yang memang sudah punya canonical;
// helper ini hanya menyediakan title/description/OpenGraph per locale.
import type { Metadata } from "next";
import type { Locale } from "@/lib/i18n/locale";

const OG_IMAGE = {
  url: "/brand/pedia-icon-512.png",
  width: 512,
  height: 512,
  alt: "Axvara Pedia — Layanan sosial media",
};

type PageKey = "catalog" | "help" | "terms" | "track" | "refill" | "order" | "platform";

const COPY: Record<"id" | "en", Record<PageKey, { title: string; description: string }>> = {
  id: {
    catalog: { title: "Katalog layanan", description: "Pilih platform media sosial dan bandingkan layanan followers, likes, dan views AXVARA Pedia." },
    help: { title: "Bantuan & cara order", description: "Cara memesan layanan AXVARA Pedia dan jawaban pertanyaan yang sering ditanyakan." },
    terms: { title: "Ketentuan layanan", description: "Ketentuan layanan AXVARA Pedia: syarat target, refill, pesanan sebagian, dan konten yang dilarang." },
    track: { title: "Lacak pesanan", description: "Cek status pesanan AXVARA Pedia dengan kode pesanan dan kontak checkout, tanpa login." },
    refill: { title: "Refill pesanan", description: "Ajukan refill AXVARA Pedia untuk layanan bergaransi yang drop, dengan kode pesanan dan kontak checkout." },
    order: { title: "Pesan layanan", description: "Atur jumlah, tempel link target, pilih layanan, lalu bayar dengan QRIS atau metode lain yang tersedia." },
    platform: { title: "Layanan platform", description: "Bandingkan layanan followers, likes, dan views per platform di AXVARA Pedia." },
  },
  en: {
    catalog: { title: "Service catalog", description: "Choose a social media platform and compare followers, likes, and views services from AXVARA Pedia." },
    help: { title: "Help & how to order", description: "How to order AXVARA Pedia services and answers to frequently asked questions." },
    terms: { title: "Service terms", description: "AXVARA Pedia service terms: target requirements, refill, partially completed orders, and prohibited content." },
    track: { title: "Track order", description: "Check an AXVARA Pedia order status with the order code and checkout contact, without logging in." },
    refill: { title: "Order refill", description: "Request an AXVARA Pedia refill for guaranteed services that dropped, using the order code and checkout contact." },
    order: { title: "Order a service", description: "Set the quantity, paste the target link, choose a service, then pay with QRIS or another available method." },
    platform: { title: "Platform services", description: "Compare followers, likes, and views services per platform on AXVARA Pedia." },
  },
};

export function pediaSiteMetadata(locale: Locale): { titleDefault: string; titleTemplate: string; description: string; ogLocale: "id_ID" | "en_US" } {
  const en = locale === "en";
  return {
    titleDefault: en ? "Axvara Pedia — Affordable social media services" : "Axvara Pedia — Layanan sosial media termurah",
    titleTemplate: "%s · Axvara Pedia",
    description: en
      ? "Followers, likes, and views catalog. Compare quantity, price, start estimate, and terms for each package before ordering."
      : "Katalog followers, likes, dan views. Bandingkan jumlah, harga, estimasi proses, dan ketentuan setiap paket sebelum memesan.",
    ogLocale: en ? "en_US" : "id_ID",
  };
}

/** Metadata satu halaman: title/description/OG lokal; canonical hanya bila diberikan. */
export function pediaPageMetadata(locale: Locale, page: PageKey, canonical?: string): Metadata {
  const entry = COPY[locale === "en" ? "en" : "id"][page];
  const site = pediaSiteMetadata(locale);
  return {
    title: entry.title,
    description: entry.description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      type: "website",
      siteName: "Axvara Pedia",
      locale: site.ogLocale,
      title: entry.title,
      description: entry.description,
      images: [OG_IMAGE],
    },
  };
}
