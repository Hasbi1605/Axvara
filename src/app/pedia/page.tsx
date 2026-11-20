// src/app/pedia/page.tsx — Beranda Pedia (PD-01, DESIGN §6.1).
// SSR katalog (≤60 baris, berindeks) — tanpa fetch client untuk katalog.
import { requestLocale } from "@/lib/i18n/server-locale";
import { pediaCopy } from "@/lib/pedia/copy";
import { PediaHomeClient } from "./home-client";
import { loadPublicPediaProducts } from "@/lib/pedia/public-catalog";
import { pediaCatalogSummary } from "@/lib/pedia/catalog-summary";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function PediaHome() {
  // AC-23: flag mati → halaman "Segera hadir", tanpa error.
  if (process.env.PEDIA_ENABLED !== "true") {
    // Halaman "segera hadir" mengikuti cookie bahasa (default Indonesia).
    const copy = pediaCopy(await requestLocale());
    return (
      <div className="mx-auto max-w-xl pt-16 text-center">
        <h1 className="font-display text-[28px] font-bold text-white">{copy.comingSoonTitle}</h1>
        <p className="mt-2 text-sm text-white/60">{copy.comingSoonBody}</p>
        <a href="https://axvara.tech?utm_source=pedia&utm_medium=coming_soon" className="mt-6 inline-flex h-12 items-center rounded-[14px] bg-[#00E5FF] px-6 text-sm font-bold text-[#070a1e]">
          {copy.comingSoonBack}
        </a>
      </div>
    );
  }
  const products = await loadPublicPediaProducts();
  return <PediaHomeClient products={products.map(pediaCatalogSummary)} />;
}
