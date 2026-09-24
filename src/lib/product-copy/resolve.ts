// src/lib/product-copy/resolve.ts — Pilih salinan S&K + cara aktivasi per varian.
//
// Server-only (menarik data kurasi): dipanggil route /api/catalog, bukan
// catalog.ts, karena catalog.ts ikut diimpor komponen client.
//
// Urutan: suntingan admin (migrasi 0041) → kurasi di kode → teks WR dirapikan.
// Suntingan admin dan kurasi sama-sama hanya berlaku selama sidik jari teks WR
// masih sama dengan saat ditulis; bila WR mengubah teksnya, keduanya dijeda
// dan teks WR terbaru yang tampil sampai admin meninjau ulang.
import type { ProductDetail, VariantSummary } from "@/lib/catalog";
import { CURATED_VARIANT_COPY, type CuratedVariantCopy } from "./curated";
import { buildSections, parseAdminVariantCopy, supplierVariantCopy, type ActivationGroup, type VariantCopy } from "./format";
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

/** Kolom milik admin di product_variants (migrasi 0041). */
export type AdminCopyInput = {
  terms: string | null | undefined;
  activation: string | null | undefined;
  /** Sidik jari teks WR saat admin menyimpan ("" untuk varian non-WR). */
  fingerprint: string | null | undefined;
};

export type VariantCopyStatus = "admin" | "axvara" | "pemasok" | "none";

export type VariantCopyResolution = {
  copy: VariantCopy | null;
  status: VariantCopyStatus;
  /** Ada suntingan admin, tapi WR sudah mengubah teksnya sejak disimpan. */
  adminStale: boolean;
  /** Salinan tanpa suntingan admin (kurasi atau teks WR dirapikan). */
  auto: VariantCopy | null;
  supplierKey: string;
};

export function resolveVariantCopyDetailed(
  terms: string | null | undefined,
  deliveryTerms: string | null | undefined,
  admin?: AdminCopyInput | null,
): VariantCopyResolution {
  const supplierKey = supplierFingerprint(terms, deliveryTerms);
  const curated = supplierKey ? CURATED.get(supplierKey) : undefined;
  const auto = !supplierKey ? null : curated ? curatedToCopy(curated) : supplierVariantCopy(terms, deliveryTerms);
  const adminCopy = admin ? parseAdminVariantCopy(admin.terms, admin.activation) : null;
  const adminFresh = adminCopy !== null && (admin?.fingerprint ?? "") === supplierKey;
  if (adminFresh) return { copy: adminCopy, status: "admin", adminStale: false, auto, supplierKey };
  return { copy: auto, status: auto ? auto.source : "none", adminStale: adminCopy !== null, auto, supplierKey };
}

export function resolveVariantCopy(
  terms: string | null | undefined,
  deliveryTerms: string | null | undefined,
  admin?: AdminCopyInput | null,
): VariantCopy | null {
  return resolveVariantCopyDetailed(terms, deliveryTerms, admin).copy;
}

/** Varian yang perlu ditinjau admin: teks WR tampil apa adanya, atau suntingannya dijeda. */
export function needsCopyReview(resolution: VariantCopyResolution): boolean {
  return resolution.status === "pemasok" || resolution.adminStale;
}

export function adminCopyOf(variant: Pick<VariantSummary, "admin_terms" | "admin_activation" | "admin_copy_fingerprint">): AdminCopyInput {
  return { terms: variant.admin_terms, activation: variant.admin_activation, fingerprint: variant.admin_copy_fingerprint };
}

export type StorefrontVariant = VariantSummary & { copy: VariantCopy | null };
export type StorefrontProductDetail = Omit<ProductDetail, "variants"> & { variants: StorefrontVariant[] };

/** Detail produk untuk storefront: teks mentah (WR & admin) diganti salinan siap tampil. */
export function withVariantCopy(detail: ProductDetail): StorefrontProductDetail {
  return {
    ...detail,
    variants: detail.variants.map((variant) => ({
      ...variant,
      terms: null,
      delivery_terms: null,
      admin_terms: undefined,
      admin_activation: undefined,
      admin_copy_fingerprint: undefined,
      copy: resolveVariantCopy(variant.terms, variant.delivery_terms, adminCopyOf(variant)),
    })),
  };
}
