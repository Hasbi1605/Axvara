import { serializeVariantCopy, type VariantCopyEntry } from "./format";
import { needsCopyReview, resolveVariantCopyDetailed } from "./resolve";

export const VARIANT_COPY_SQL = `SELECT pv.id, pv.product_id, pv.label, pv.is_active, pv.wr_variant_id,
       pv.admin_terms, pv.admin_activation, pv.admin_terms_en, pv.admin_activation_en, pv.admin_copy_fingerprint,
        pv.sk_variant_id, sp.sk_description, sp.sk_seller_note,
        wv.wr_terms, wv.wr_delivery_terms
  FROM product_variants pv
  LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
  LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id`;

export const text = (value: unknown): string | null => {
  const s = value == null ? "" : String(value);
  return s.trim() ? s : null;
};

export function toEntry(row: Record<string, unknown>): VariantCopyEntry {
  const supplierTerms = text(row.wr_terms) ?? text(row.sk_description);
  const supplierActivation = text(row.wr_delivery_terms) ?? text(row.sk_seller_note);
  const adminTerms = text(row.admin_terms);
  const adminActivation = text(row.admin_activation);
  const adminTermsEn = text(row.admin_terms_en);
  const adminActivationEn = text(row.admin_activation_en);
  const resolution = resolveVariantCopyDetailed(supplierTerms, supplierActivation, {
    terms: adminTerms,
    activation: adminActivation,
    termsEn: adminTermsEn,
    activationEn: adminActivationEn,
    fingerprint: row.admin_copy_fingerprint == null ? null : String(row.admin_copy_fingerprint),
  });
  const auto = serializeVariantCopy(resolution.auto);
  const effective = serializeVariantCopy(resolution.copy);
  return {
    variantId: Number(row.id),
    label: String(row.label ?? ""),
    isActive: Number(row.is_active ?? 1) === 1,
    wrManaged: text(row.wr_variant_id) !== null,
    supplier: text(row.wr_variant_id) !== null ? "WR" : text(row.sk_variant_id) !== null ? "SK" : null,
    supplierKey: resolution.supplierKey,
    effectiveTerms: effective.terms,
    effectiveActivation: effective.activation,
    status: resolution.status,
    adminStale: resolution.adminStale,
    needsReview: needsCopyReview(resolution),
    reviewKind: resolution.reviewKind,
    reviewed: resolution.reviewed,
    hasOverride: adminTerms !== null || adminActivation !== null,
    adminTerms: adminTerms ?? "",
    adminActivation: adminActivation ?? "",
    adminTermsEn: adminTermsEn ?? "",
    adminActivationEn: adminActivationEn ?? "",
    autoTerms: auto.terms,
    autoActivation: auto.activation,
    supplierTerms: supplierTerms ?? "",
    supplierActivation: supplierActivation ?? "",
  };
}
