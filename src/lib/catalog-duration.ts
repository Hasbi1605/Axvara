// src/lib/catalog-duration.ts — Derive duration from supplier text (SK only).

const SUPPLIER_DURATION_RE =
  /\b(?:durasi|masa[ \t]+aktif|duration|validity)\b[ \t]*(?:[:\-—–][ \t]*)*(\d+(?:[ \t]*[-–—][ \t]*\d+)?)[ \t]*(hari|days?|minggu|weeks?|bulan|months?|tahun|years?)\b/i;

const LABEL_HAS_DURATION_RE =
  /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:hari|bulan|tahun|minggu|days?|months?|years?|weeks?)\b/i;

const UNIT_ID_MAP: Record<string, string> = {
  hari: "Hari",
  day: "Hari",
  days: "Hari",
  minggu: "Minggu",
  week: "Minggu",
  weeks: "Minggu",
  bulan: "Bulan",
  month: "Bulan",
  months: "Bulan",
  tahun: "Tahun",
  year: "Tahun",
  years: "Tahun",
};

/**
 * Extract a normalized Indonesian duration string ("1 Bulan", "28-30 Hari",
 * "1 Tahun", "2 Minggu") from supplier description text when explicitly
 * labelled with Durasi / Masa aktif / Duration / Validity. Returns null when
 * no labelled duration is found.
 */
export function durationFromSupplierText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = SUPPLIER_DURATION_RE.exec(String(text));
  if (!match) return null;
  const parts = match[1].split(/[ \t]*[-–—][ \t]*/).map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const count = parts.join("-");
  const unit = UNIT_ID_MAP[match[2].toLowerCase()];
  if (!unit) return null;
  return `${count} ${unit}`;
}

/** True when a variant label already includes an explicit duration token. */
export function labelContainsDuration(label: string): boolean {
  return LABEL_HAS_DURATION_RE.test(label);
}

/**
 * Derive fallback duration for an SK variant only when all admin duration
 * fields (`duration_label`, `duration_value`, `duration_unit`) are empty.
 */
export function deriveSkDuration(v: {
  sk_variant_id?: unknown;
  duration_label?: string | null;
  duration_value?: number | null;
  duration_unit?: string | null;
  sk_description?: string | null;
  terms?: string | null;
}): string | null {
  const skId = v.sk_variant_id == null ? "" : String(v.sk_variant_id).trim();
  if (!skId) return null;
  const hasAdminDuration =
    (v.duration_label != null && String(v.duration_label).trim() !== "")
    || (v.duration_value != null && Number(v.duration_value) > 0)
    || (v.duration_unit != null && String(v.duration_unit).trim() !== "");
  if (hasAdminDuration) return null;
  return durationFromSupplierText(v.sk_description ?? v.terms ?? null);
}
