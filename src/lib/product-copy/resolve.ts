// src/lib/product-copy/resolve.ts — Pilih salinan S&K + cara aktivasi per varian.
//
// Server-only (menarik data kurasi): dipanggil route /api/catalog, bukan
// catalog.ts, karena catalog.ts ikut diimpor komponen client.
import type { ProductDetail, VariantSummary } from "@/lib/catalog";
import { CURATED_VARIANT_COPY, type CuratedVariantCopy } from "./curated";
import { buildSections, supplierVariantCopy, type ActivationGroup, type VariantCopy } from "./format";
import { supplierFingerprint } from "./text";

const CURATED = new Map(CURATED_VARIANT_COPY.map((entry) => [entry.key, entry]));

export function curatedToCopy(entry: CuratedVariantCopy): VariantCopy {
  const activation: ActivationGroup[] = entry.grupLangkah
    ? entry.grupLangkah.map((group) => ({ title: group.judul, steps: [...group.langkah] }))
    : entry.langkah?.length
      ? [{ title: null, steps: [...entry.langkah] }]
      : [];
  return {
    source: "axvara",
    sections: buildSections({ paket: entry.paket, proses: entry.proses, aturan: entry.aturan, garansi: entry.garansi }),
    activation,
    notes: [...(entry.catatan ?? [])],
  };
}

/**
 * Salinan Axvara bila teks pemasok masih sama dengan saat dikurasi; selain
 * itu teks pemasok yang dirapikan (tidak pernah disembunyikan).
 */
export function resolveVariantCopy(terms: string | null | undefined, deliveryTerms: string | null | undefined): VariantCopy | null {
  const key = supplierFingerprint(terms, deliveryTerms);
  if (!key) return null;
  const curated = CURATED.get(key);
  return curated ? curatedToCopy(curated) : supplierVariantCopy(terms, deliveryTerms);
}

export type StorefrontVariant = VariantSummary & { copy: VariantCopy | null };
export type StorefrontProductDetail = Omit<ProductDetail, "variants"> & { variants: StorefrontVariant[] };

/** Detail produk untuk storefront: teks mentah WR diganti salinan siap tampil. */
export function withVariantCopy(detail: ProductDetail): StorefrontProductDetail {
  return {
    ...detail,
    variants: detail.variants.map((variant) => ({
      ...variant,
      terms: null,
      delivery_terms: null,
      copy: resolveVariantCopy(variant.terms, variant.delivery_terms),
    })),
  };
}
