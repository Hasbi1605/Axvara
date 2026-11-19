// src/lib/product-copy/resolve.ts — Pilih salinan S&K + cara aktivasi per varian.
//
// Server-only (menarik data kurasi): dipanggil route /api/catalog, bukan
// catalog.ts, karena catalog.ts ikut diimpor komponen client.
//
// Urutan: suntingan admin (migrasi 0041) → kurasi di kode → teks WR dirapikan.
// Saat pemasok mengubah teksnya, suntingan admin tetap tampil ke pembeli
// (tidak jatuh ke teks mentah supplier), namun ditandai stale/changed agar
// admin meninjau ulang. Kurasi di kode tetap berhenti saat sidik jari berubah.
import type { ProductDetail, VariantSummary } from "@/lib/catalog";
import { CURATED_VARIANT_COPY, type CuratedVariantCopy } from "./curated";
import { CURATED_VARIANT_COPY_EN, type CuratedVariantCopyEn } from "./curated-en";
import type { Locale } from "@/lib/i18n/locale";
import { buildSections, parseAdminVariantCopy, supplierVariantCopy, type ActivationGroup, type VariantCopy } from "./format";
import { sanitizeSupplierCopy, type SupplierLinkMap } from "./sanitize";
import { supplierFingerprint } from "./text";
import { deriveSkDuration } from "@/lib/catalog-duration";

const CURATED = new Map(CURATED_VARIANT_COPY.map((entry) => [entry.key, entry]));

export function curatedToCopy(entry: CuratedVariantCopy, locale: Locale = "id", english?: CuratedVariantCopyEn): VariantCopy {
  // EN memakai field Inggris bila ada; field yang belum diterjemahkan jatuh ke ID.
  const source = locale === "en" && english
    ? {
        paket: english.paket ?? entry.paket,
        proses: english.proses ?? entry.proses,
        aturan: english.aturan ?? entry.aturan,
        garansi: english.garansi ?? entry.garansi,
        langkah: english.langkah ?? entry.langkah,
        grupLangkah: english.grupLangkah ?? entry.grupLangkah,
        catatan: english.catatan ?? entry.catatan,
      }
    : entry;
  const activation: ActivationGroup[] = source.grupLangkah
    ? source.grupLangkah.map((group) => ({ title: group.judul, steps: [...group.langkah] }))
    : source.langkah?.length
      ? [{ title: null, steps: [...source.langkah] }]
      : [];
  return {
    source: "axvara",
    sections: buildSections({ paket: source.paket, proses: source.proses, aturan: source.aturan, garansi: source.garansi }),
    activation,
    notes: [...(source.catatan ?? [])],
  };
}

/** Kolom milik admin di product_variants (migrasi 0041). */
export type AdminCopyInput = {
  terms: string | null | undefined;
  activation: string | null | undefined;
  /** Sidik jari teks WR saat admin menyimpan ("" untuk varian non-WR). */
  fingerprint: string | null | undefined;
  termsEn?: string | null;
  activationEn?: string | null;
};

export type VariantCopyStatus = "admin" | "axvara" | "pemasok" | "none";

export type VariantCopyReviewKind = "changed" | "raw" | null;

export type VariantCopyResolution = {
  copy: VariantCopy | null;
  status: VariantCopyStatus;
  /** Ada suntingan admin, tapi WR sudah mengubah teksnya sejak disimpan. */
  adminStale: boolean;
  /** Salinan tanpa suntingan admin (kurasi atau teks WR dirapikan). */
  auto: VariantCopy | null;
  supplierKey: string;
  /**
   * Jenis tinjauan (16 November 2026): "changed" = teks supplier berubah sejak
   * suntingan/tanda tinjau admin; "raw" = teks supplier tampil apa adanya dan
   * belum ditandai oke; null = tidak perlu ditinjau.
   */
  reviewKind: VariantCopyReviewKind;
  /** Teks supplier apa adanya sudah cocok dengan sidik jari yang ditandai admin. */
  reviewed: boolean;
};

export function resolveVariantCopyDetailed(
  terms: string | null | undefined,
  deliveryTerms: string | null | undefined,
  admin?: AdminCopyInput | null,
  locale: Locale = "id",
): VariantCopyResolution {
  const supplierKey = supplierFingerprint(terms, deliveryTerms);
  const curated = supplierKey ? CURATED.get(supplierKey) : undefined;
  const auto = !supplierKey
    ? null
    : curated
      ? curatedToCopy(curated, locale, CURATED_VARIANT_COPY_EN[curated.key])
      : supplierVariantCopy(terms, deliveryTerms);
  const adminCopy = admin ? parseAdminVariantCopy(admin.terms, admin.activation) : null;
  const adminCopyEn = admin ? parseAdminVariantCopy(admin.termsEn, admin.activationEn) : null;
  const fingerprint = admin?.fingerprint ?? "";
  const hasAdmin = adminCopy !== null;
  const adminFresh = hasAdmin && fingerprint === supplierKey;
  const adminStale = !adminFresh && (hasAdmin || adminCopyEn !== null);
  // Suntingan admin tetap tampil walau sidik jari supplier berubah; EN hanya
  // memakai admin EN bila diisi, tanpa EN jatuh ke kurasi EN/WR.
  const copy = hasAdmin ? (locale === "en" ? adminCopyEn ?? auto : adminCopy) : auto;
  const status: VariantCopyStatus = hasAdmin
    ? (locale === "en" ? (adminCopyEn ? "admin" : auto ? auto.source : "none") : "admin")
    : auto ? auto.source : "none";
  // Tinjauan dihitung dari salinan ID (bukan locale): admin menyunting teks ID.
  // "reviewed" = teks supplier yang tampil persis sama dengan sidik jari yang
  // sudah ditandai admin, tanpa override ID.
  const idStatus: VariantCopyStatus = hasAdmin ? "admin" : auto ? auto.source : "none";
  const noOverride = !hasAdmin;
  const reviewed = noOverride && fingerprint !== "" && fingerprint === supplierKey && idStatus === "pemasok";
  let reviewKind: VariantCopyReviewKind = null;
  if (adminStale || (noOverride && fingerprint !== "" && fingerprint !== supplierKey && idStatus === "pemasok")) reviewKind = "changed";
  else if (idStatus === "pemasok" && !reviewed) reviewKind = "raw";
  return { copy, status, adminStale, auto, supplierKey, reviewKind, reviewed };
}

export function resolveVariantCopy(
  terms: string | null | undefined,
  deliveryTerms: string | null | undefined,
  admin?: AdminCopyInput | null,
  locale: Locale = "id",
): VariantCopy | null {
  return resolveVariantCopyDetailed(terms, deliveryTerms, admin, locale).copy;
}

/** Varian yang perlu ditinjau admin: teks supplier mentah belum ditandai oke,
 * atau supplier mengubah teks sejak suntingan/tanda tinjau terakhir. */
export function needsCopyReview(resolution: VariantCopyResolution): boolean {
  return resolution.reviewKind !== null;
}

export function adminCopyOf(variant: Pick<VariantSummary, "admin_terms" | "admin_activation" | "admin_copy_fingerprint" | "admin_terms_en" | "admin_activation_en">): AdminCopyInput {
  return { terms: variant.admin_terms, activation: variant.admin_activation, fingerprint: variant.admin_copy_fingerprint, termsEn: variant.admin_terms_en, activationEn: variant.admin_activation_en };
}

export type StorefrontVariant = VariantSummary & { copy: VariantCopy | null; copy_en: VariantCopy | null };
export type StorefrontProductDetail = Omit<ProductDetail, "variants"> & { variants: StorefrontVariant[] };

/**
 * Detail produk untuk storefront: teks mentah (WR & admin) diganti salinan
 * siap tampil. Kedua locale dikirim sekaligus agar cache publik `/api/catalog`
 * tidak bergantung cookie; klien memilih `copy_en` saat EN.
 * Salinan bersumber "pemasok" ikut disanitasi memakai link aktif.
 */
export function withVariantCopy(detail: ProductDetail, links?: SupplierLinkMap): StorefrontProductDetail {
  return {
    ...detail,
    variants: detail.variants.map((variant) => {
      const admin = adminCopyOf(variant);
      const copy = resolveVariantCopy(variant.terms, variant.delivery_terms, admin, "id");
      const copyEn = resolveVariantCopy(variant.terms, variant.delivery_terms, admin, "en");
      const skDuration = variant.sk_duration ?? deriveSkDuration(variant);
      return {
        ...variant,
        terms: null,
        delivery_terms: null,
        sk_description: undefined,
        sk_duration: skDuration ?? null,
        admin_terms: undefined,
        admin_activation: undefined,
        admin_terms_en: undefined,
        admin_activation_en: undefined,
        admin_copy_fingerprint: undefined,
        copy: links ? sanitizeSupplierCopy(copy, links) : copy,
        copy_en: links ? sanitizeSupplierCopy(copyEn, links) : copyEn,
      };
    }),
  };
}
