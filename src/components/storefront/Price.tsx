"use client";

import type { DisplayPrices } from "@/hooks/useDisplayPrices";
import { catalogCopy } from "@/lib/i18n/catalog-copy";

/**
 * Harga presentasional: teks sudah ditentukan pemilik koleksi lewat
 * `useDisplayPrices` (cents dari server). USD yang masih dimuat tampil sebagai
 * kerangka berlebar tetap (tanpa loncatan tata letak); gagal/FX tak tersedia =
 * Rupiah apa adanya, dengan SATU catatan per grup lewat <PriceNote />.
 */
export function Price({ idr, prices, className, equivalentClassName }: {
  idr: number;
  prices: DisplayPrices;
  className?: string;
  /** Bila diisi, setara mata uang lain ("≈ …") ditampilkan di bawah/sebelah harga utama. */
  equivalentClassName?: string;
}) {
  if (prices.currency === "USD" && prices.status === "loading") {
    return (
      <span className={className} aria-busy="true">
        <span aria-hidden className="inline-block h-[0.9em] w-[5.5em] max-w-full rounded bg-white/10 align-middle motion-safe:animate-pulse" />
        <span className="sr-only">…</span>
      </span>
    );
  }
  const equivalent = equivalentClassName ? prices.equivalent(idr) : null;
  return (
    <>
      <span className={className}>{prices.text(idr)}</span>
      {equivalent && <span className={equivalentClassName}>{equivalent}</span>}
    </>
  );
}

/** Catatan jujur sekali per grup harga: USD dipilih tetapi server belum bisa mengonversi. */
export function PriceNote({ prices, className = "text-[11px] text-white/45" }: { prices: DisplayPrices; className?: string }) {
  if (prices.currency !== "USD" || prices.status !== "unavailable") return null;
  return <p role="status" className={className}>{catalogCopy(prices.locale).pricesInIdr}</p>;
}
