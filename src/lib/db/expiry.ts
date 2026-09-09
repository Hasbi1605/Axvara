// Predikat kadaluarsa kanonis dipisah ke modul kecil sendiri karena dipakai
// lintas fitur (ledger QRIS, order manual, sesi, lock, reminder). Menaruhnya
// di satu tempat mencegah ada cabang yang diam-diam memakai perbandingan
// string mentah yang tidak pernah cocok dengan nilai ISO. PURE MOVE: nilai
// konstanta dan komentar penjelas dipertahankan persis.

/**
 * Canonical expiry predicate for every payment/order TTL comparison.
 *
 * All writers persist `expires_at` as an ISO-8601 UTC string
 * (`new Date(...).toISOString()`, e.g. `2026-09-07T07:16:59.000Z`), while
 * SQLite's `datetime('now')` returns `YYYY-MM-DD HH:MM:SS`. A raw string
 * comparison (`expires_at < datetime('now')`) therefore never matches an
 * ISO value because `'T' (0x54)` sorts after `' ' (0x20)`; such invoices
 * would stay `pending` forever, keep their unique QRIS amount reserved,
 * and diverge from their order. `datetime(expires_at)` normalizes both
 * ISO-8601 (`T`/`Z`/milliseconds) and legacy space-separated values into
 * the same `YYYY-MM-DD HH:MM:SS` domain before comparing.
 *
 * Keep every new expiry check on this predicate (or an equivalent JS
 * `Date.parse(...) <= Date.now()` comparison) so QRIS ledgers, manual
 * orders, sessions, locks, and reminders expire with identical semantics.
 */
export const D1_EXPIRY_PREDICATE = "datetime(expires_at) < datetime('now')";
export const D1_NOT_EXPIRED_PREDICATE =
  "(expires_at IS NULL OR datetime(expires_at) >= datetime('now'))";
