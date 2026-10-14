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
//   otoritatif) → `orders.paid_at` (SEMUA jalur — ditulis sekali saat transisi
//   lunas via COALESCE, review R9) → `payment_proofs.reviewed_at` (jalur
//   manual, waktu admin mencocokkan mutasi) → `orders.updated_at` (fallback
//   data lama). orders.paid_at harus di atas reviewed_at: ia adalah waktu
//   pembayaran kanonis yang tidak bergerak saat admin menambah catatan,
//   retry notifikasi, atau fulfillment jalan belakangan.
// - Data lama tanpa `paid_at`: backfill sekali dari `reviewed_at`/`updated_at`
//   via migrasi 0016; baris yang tetap NULL memakai fallback saat baca agar
//   tidak ada pendapatan yang hilang dari laporan.
// - Minggu bisnis = Senin 00:00 – Minggu 23:59 WIB (keputusan owner 2026-10-07,
//   dashboard Fase 1). Bucket minggu di SQL memakai `date(..., 'weekday 0',
//   '-6 days')` = Senin minggu itu; di JS via `weekWibStartDateString`.
export const REVENUE_TZ_OFFSET = "+7 hours";

/** Ekspresi SQL: timestamp pembayaran dalam WIB dari kolom yang tersedia. */
export function revenuePaidAtWibSql(alias = "o"): string {
  return `datetime(COALESCE(pt.paid_at, ${alias}.paid_at, pp.reviewed_at, ${alias}.updated_at), '${REVENUE_TZ_OFFSET}')`;
}

/** Ekspresi SQL: tanggal WIB (YYYY-MM-DD) kapan pendapatan diakui. */
export function revenueDateWibSql(alias = "o"): string {
  return `date(${revenuePaidAtWibSql(alias)})`;
}

/** Ekspresi SQL: bulan WIB (YYYY-MM) kapan pendapatan diakui. */
export function revenueMonthWibSql(alias = "o"): string {
  return `strftime('%Y-%m', ${revenuePaidAtWibSql(alias)})`;
}

/**
 * Ekspresi SQL: tanggal Senin (YYYY-MM-DD) minggu WIB kapan pendapatan
 * diakui. Senin-start: mundur ((weekday+6)%7) hari dari tanggal WIB.
 * strftime('%w') = 0 (Minggu)..6 (Sabtu); Senin → mundur 0 hari.
 * Diverifikasi SQLite: Min 2026-10-04 (UTC) = Sen 5 Okt WIB → '2026-10-05';
 * Sab 10 Okt → '2026-10-05'; Min 11 Okt 23:59 WIB → '2026-10-05'.
 */
export function revenueWeekWibSql(alias = "o"): string {
  const paid = revenuePaidAtWibSql(alias);
  return `date(${paid}, '-' || ((CAST(strftime('%w', ${paid}) AS INTEGER) + 6) % 7) || ' days')`;
}

/** Hari WIB ini dalam UTC — untuk perbandingan `date(...) = '...'`. */
export function todayWibDateString(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export type ReportRange = { from: string; to: string };
export type ReportSelection = "today" | "week" | "month" | { date_from: string; date_to: string };

/** Calendar dates, inclusive in WIB. Custom future dates are rejected, not silently changed. */
export function resolveReportRange(selection: ReportSelection, now = new Date()): ReportRange {
  const today = todayWibDateString(now);
  if (typeof selection === "string") {
    if (!["today", "week", "month"].includes(selection)) throw new Error("Periode laporan tidak valid.");
    return { from: selection === "today" ? today : selection === "week" ? weekWibStartDateString(now) : `${today.slice(0, 7)}-01`, to: today };
  }
  const { date_from: from, date_to: to } = selection;
  const valid = (date: string) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && date >= "0001-01-01" && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!valid(from) || !valid(to)) throw new Error("Tanggal awal dan akhir wajib berupa tanggal kalender YYYY-MM-DD.");
  if (from > to) throw new Error("Tanggal awal tidak boleh setelah tanggal akhir.");
  if (to > today) throw new Error("Tanggal laporan tidak boleh di masa depan (WIB).");
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1 > 366)
    throw new Error("Rentang laporan maksimal 366 hari termasuk tanggal awal dan akhir.");
  return { from, to };
}

/** Historical months use the same custom range; the current month ends today WIB. */
export function reportMonthSelection(month: string, now = new Date()): ReportSelection {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Bulan laporan tidak valid.");
  const from = `${month}-01`, start = new Date(`${from}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== from) throw new Error("Bulan laporan tidak valid.");
  start.setUTCMonth(start.getUTCMonth() + 1, 0);
  const to = start.toISOString().slice(0, 10), today = todayWibDateString(now);
  const selection = { date_from: from, date_to: to > today ? today : to };
  resolveReportRange(selection, now);
  return selection;
}

/** Bulan WIB ini (YYYY-MM) — untuk perbandingan `strftime(...) = '...'`. */
export function currentWibMonthString(now = new Date()): string {
  return todayWibDateString(now).slice(0, 7);
}

/** Tanggal Senin (YYYY-MM-DD) minggu WIB yang memuat `now`. */
export function weekWibStartDateString(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3_600_000);
  // getUTCDay: 0=Minggu..6=Sabtu (atas waktu WIB yang digeser). Senin-start:
  // mundur (day+6)%7 hari.
  const back = (wib.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - back))
    .toISOString()
    .slice(0, 10);
}

/** True bila timestamp UTC jatuh pada hari WIB yang sama dengan `now`. */
export function isSameWibDay(ts: number, now: number): boolean {
  return todayWibDateString(new Date(ts)) === todayWibDateString(new Date(now));
}

/** True bila timestamp UTC jatuh pada bulan WIB yang sama dengan `now`. */
export function isSameWibMonth(ts: number, now: number): boolean {
  return currentWibMonthString(new Date(ts)) === currentWibMonthString(new Date(now));
}

/** True bila timestamp UTC jatuh pada minggu WIB yang sama (Senin-start). */
export function isSameWibWeek(ts: number, now: number): boolean {
  return weekWibStartDateString(new Date(ts)) === weekWibStartDateString(new Date(now));
}
