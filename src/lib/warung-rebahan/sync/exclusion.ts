import type { DatabaseAccess } from "@/lib/db-access";
import type { Row } from "./types";

/**
 * Cek exclusion via tabel wr_exclusions (LIKE case-insensitive).
 * Pattern disimpan lowercase-safe: bandingkan lower(nama) LIKE lower(pattern).
 * `cachedRules`: cache sekali per run (P0-4) — null = baca dari DB.
 */
export async function isExcluded(
  productName: string,
  db: DatabaseAccess,
  cachedRules?: { pattern: string; reason: string | null }[] | null,
): Promise<{ excluded: boolean; reason: string | null }> {
  const rules =
    cachedRules ??
    ((await db
      .queryAll(`SELECT pattern, reason FROM wr_exclusions`)
      .catch(() => [] as Row[])) as { pattern: string; reason: string | null }[]);
  const lowered = productName.toLowerCase();
  for (const rule of rules) {
    const pattern = String(rule.pattern || "").toLowerCase();
    // Ubah pola LIKE %x% menjadi contains-check sederhana (cukup untuk pola
    // prefix/suffix/contains; pola kompleks tetap dicoba via SQL di bawah).
    const stripped = pattern.replace(/^%+|%+$/g, "");
    const startsWild = pattern.startsWith("%");
    const endsWild = pattern.endsWith("%");
    let matched = false;
    if (startsWild && endsWild) matched = lowered.includes(stripped);
    else if (startsWild) matched = lowered.endsWith(stripped);
    else if (endsWild) matched = lowered.startsWith(stripped);
    else matched = lowered === stripped;
    if (matched) {
      return { excluded: true, reason: rule.reason ? String(rule.reason) : null };
    }
  }
  return { excluded: false, reason: null };
}
