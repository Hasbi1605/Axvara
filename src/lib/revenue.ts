// src/lib/revenue.ts — Sumber waktu pendapatan kanonis (issue #12).
//
// Aturan bisnis:
// - Pendapatan memakai WAKTU PEMBAYARAN yang tetap (`paid_at`), bukan
//   `updated_at` yang berubah setiap ada pengiriman, catatan admin, retry
//   notifikasi, dsb. `paid_at` ditulis sekali saat transisi lunas
//   (COALESCE: pertahankan nilai pertama) dan tidak pernah diubah lagi.
// - Hari/bulan bisnis mengikuti zona waktu operasional: WIB (UTC+7).
//   D1 menyimpan UTC (`datetime('now')` / ISO `Z`), sehingga bucket dihitung
//   sebagai `datetime(<paid_at>, '+7 hours')` di SQL — tanpa mengubah nilai
//   tersimpan, dan tanpa tergantung zona server/edge.
// - Hierarki sumber waktu: `payment_transactions.paid_at` (jalur QRIS,
//   otoritatif) → `payment_proofs.reviewed_at` (jalur manual, waktu admin
//   mencocokkan mutasi) → `orders.updated_at` (fallback data lama).
// - Data lama tanpa `paid_at`: backfill sekali dari `reviewed_at`/`updated_at`
//   via migrasi 0016; baris yang tetap NULL memakai fallback saat baca agar
//   tidak ada pendapatan yang hilang dari laporan.
export const REVENUE_TZ_OFFSET = "+7 hours";

/** Ekspresi SQL: timestamp pembayaran dalam WIB dari kolom yang tersedia. */
export function revenuePaidAtWibSql(alias = "o"): string {
  return `datetime(COALESCE(pt.paid_at, pp.reviewed_at, ${alias}.updated_at), '${REVENUE_TZ_OFFSET}')`;
}

/** Ekspresi SQL: tanggal WIB (YYYY-MM-DD) kapan pendapatan diakui. */
export function revenueDateWibSql(alias = "o"): string {
  return `date(${revenuePaidAtWibSql(alias)})`;
}

/** Ekspresi SQL: bulan WIB (YYYY-MM) kapan pendapatan diakui. */
export function revenueMonthWibSql(alias = "o"): string {
  return `strftime('%Y-%m', ${revenuePaidAtWibSql(alias)})`;
}

/** Hari WIB ini dalam UTC — untuk perbandingan `date(...) = '...'`. */
export function todayWibDateString(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Bulan WIB ini (YYYY-MM) — untuk perbandingan `strftime(...) = '...'`. */
export function currentWibMonthString(now = new Date()): string {
  return todayWibDateString(now).slice(0, 7);
}

/** True bila timestamp UTC jatuh pada hari WIB yang sama dengan `now`. */
export function isSameWibDay(ts: number, now: number): boolean {
  return todayWibDateString(new Date(ts)) === todayWibDateString(new Date(now));
}

/** True bila timestamp UTC jatuh pada bulan WIB yang sama dengan `now`. */
export function isSameWibMonth(ts: number, now: number): boolean {
  return currentWibMonthString(new Date(ts)) === currentWibMonthString(new Date(now));
}
