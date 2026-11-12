// Start from the curated catalog, never the complete supplier mirror.
// Supplier is part of the key: the two providers may reuse service IDs.
export const PEDIA_CATALOG_BOUNDS_SQL = `SELECT DISTINCT
    s.supplier, s.service_id, s.min_qty, s.max_qty, s.rate_idr_per_1k, s.api_refill,
    st.avg_time, st.orders_7d, st.success_rate, st.refill_rate
  FROM pedia_tiers t
  JOIN pedia_products p ON p.id=t.product_id AND p.is_active=1
  JOIN pedia_supplier_services s
    ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id
  LEFT JOIN pedia_service_stats st
    ON st.supplier=s.supplier AND st.service_id=s.service_id
  WHERE t.is_active=1 AND s.present=1
    AND s.type=(CASE WHEN t.input_kind='comments' THEN 'Custom Comments' ELSE 'Default' END)
    AND s.rate_idr_per_1k>0`;

/**
 * PSMM-P5 (2026-11-12): katalog publik hanya menawarkan baris katalog OTOMATIS
 * (`managed='auto'`) milik supplier penjualan, dengan layanan live yang cocok.
 * Baris kurasi (termasuk ProviderSMM lama) tetap ada di DB untuk order
 * tersimpan dan admin, tetapi TIDAK pernah ditawarkan ke pembeli — jadi tidak
 * ada tawaran ganda lama-vs-otomatis.
 *
 * `managedEligibilitySql(aliasT, aliasS)` mengembalikan klausa SQL yang dipakai
 * bersama oleh katalog, quote, dan order agar gate tidak tersebar/berbeda.
 * `saleProvider` diikat pemanggil (`PEDIA_SALE_PROVIDER`) — tidak di-hardcode.
 */
export function managedEligibilitySql(saleProvider: string, t = "t", s = "s"): string {
  return `${t}.managed='auto' AND ${t}.is_active=1 AND ${t}.supplier='${saleProvider.replace(/'/g, "''")}'
    AND ${s}.present=1 AND ${s}.rate_idr_per_1k>0
    AND ${s}.type=(CASE WHEN ${t}.input_kind='comments' THEN 'Custom Comments' ELSE 'Default' END)`;
}

export type ManagedEligibilityInput = {
  managed?: unknown;
  is_active?: unknown;
  supplier?: unknown;
  input_kind?: unknown;
  /** Baris cermin live. */
  present?: unknown;
  rate_idr_per_1k?: unknown;
  type?: unknown;
  min_qty?: unknown;
  max_qty?: unknown;
};

/**
 * Cermin klausa SQL di atas untuk jalur yang sudah memuat baris tier+live
 * (quote/order). Mengembalikan alasan penolakan atau `null` bila layak jual.
 */
export function managedEligibilityReason(tier: ManagedEligibilityInput, saleProvider: string): string | null {
  if (String(tier.managed ?? "curated") !== "auto") return "not_managed";
  if (Number(tier.is_active ?? 0) !== 1) return "inactive";
  if (String(tier.supplier ?? "") !== saleProvider) return "not_sale_provider";
  if (Number(tier.present ?? 0) !== 1) return "service_missing";
  if (!Number.isFinite(Number(tier.rate_idr_per_1k)) || Number(tier.rate_idr_per_1k) <= 0) return "rate_invalid";
  const expectedType = tier.input_kind === "comments" ? "Custom Comments" : "Default";
  if (String(tier.type ?? "") !== expectedType) return "type_mismatch";
  if (!Number.isSafeInteger(Number(tier.min_qty)) || !Number.isSafeInteger(Number(tier.max_qty))
    || Number(tier.min_qty) <= 0 || Number(tier.max_qty) < Number(tier.min_qty)) return "bounds_invalid";
  return null;
}

/** Deskripsi resmi wajib berstatus `ok` (bukan empty/oversize/missing) untuk jual. */
export function managedDescriptionUsable(status: string | undefined): boolean {
  return status === "ok";
}

/**
 * PSMM-FINAL-PATCH C: gate konsistensi syarat material. Baris auto dicap
 * `managed_snapshot_at` = `fetched_at` snapshot resmi saat terakhir
 * direkonsiliasi.
 *
 * FAIL CLOSED (PSMM-ACCEPTANCE-CLOSE 2): fitur ini belum pernah deploy, jadi
 * TIDAK ada baris auto sah yang boleh lolos tanpa cap. Cap kosong/hilang atau
 * berbeda dari versi snapshot aktif = tidak boleh dijual. Hanya cap non-kosong
 * yang SAMA PERSIS dengan versi aktif yang lolos.
 */
export function managedTermsFresh(tier: { managed_snapshot_at?: unknown }, snapshotVersion: string | null): boolean {
  const active = snapshotVersion == null ? "" : String(snapshotVersion);
  const stamped = tier.managed_snapshot_at == null ? "" : String(tier.managed_snapshot_at);
  if (!active || !stamped) return false;
  return stamped === active;
}
