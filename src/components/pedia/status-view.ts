// src/components/pedia/status-view.ts — Logika tampilan status Pedia (murni, tanpa React).
// Dipakai halaman status pembeli, OrdersManager admin dan pengalihan Market.
// Prinsip: angka tidak diketahui tetap null (bukan 0), ETA hanya dari field
// eta_start/eta_finish apa adanya, tanpa hitungan jam dari avg_time/speed.
import { SITE } from "@/lib/site";

export const PEDIA_CODE_RE = /^AXP-\d{8}-[A-Z0-9]{8}$/;

export const normalizePediaCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");
export const isPediaCode = (raw: string) => PEDIA_CODE_RE.test(normalizePediaCode(raw));

/** Halaman status Pedia (host Pedia merewrite /pesanan → /pedia/pesanan). Tanpa kontak/token/PIN di URL. */
export const pediaOrderUrl = (code: string) => `${SITE.pediaUrl}/pesanan/${encodeURIComponent(normalizePediaCode(code))}`;
/** Form lacak Pedia. Hanya kode; kontak tidak pernah dibawa lintas host. */
export const pediaTrackUrl = (code: string) => `${SITE.pediaUrl}/lacak?code=${encodeURIComponent(normalizePediaCode(code))}`;

export const PEDIA_TERMINAL = ["completed", "partial", "canceled", "expired"] as const;
const PROCESSING = ["submitting", "submitted", "in_progress", "completed", "partial"];

/** Interval polling halaman status (ms); null = berhenti (status akhir).
 *  UNKNOWN/undefined (fetch awal gagal, data null) memakai 10 detik agar
 *  halaman bisa self-retry tanpa refresh manual; terminal tetap berhenti. */
export function pediaPollMs(status: string | undefined): number | null {
  if ((PEDIA_TERMINAL as readonly string[]).includes(String(status ?? ""))) return null;
  if (!status) return 10_000;
  if (status === "awaiting_payment") return 5_000;
  if (status === "needs_check") return 30_000;
  return 10_000;
}

export type PediaHeader = { title: string; lead: string | null };

/** Judul + kalimat pembuka menurut status Pedia aktual (bukan "Lunas" generik). */
export function pediaHeader(status: string): PediaHeader {
  switch (status) {
    case "completed": return { title: "Pesanan Selesai 🎉", lead: null };
    case "partial": return { title: "Pesanan Selesai Sebagian", lead: null };
    case "canceled": return { title: "Pesanan Dibatalkan", lead: null };
    case "needs_check": return { title: "Pesanan Sedang Dicek", lead: null };
    case "in_progress": return { title: "Pesanan Berjalan", lead: "Pesanan sedang berjalan. Progres diperbarui otomatis." };
    case "submitting":
    case "submitted": return { title: "Pesanan Diproses", lead: "Pesanan sedang dikirim ke sistem dan diproses otomatis." };
    default: return { title: "Pembayaran Diterima", lead: "Pesanan masuk antrean dan akan diproses otomatis." };
  }
}

export const formatCount = (value: number) => value.toLocaleString("id-ID");

export type PediaProgress = {
  /** Jumlah masuk yang terkonfirmasi, null = belum diketahui. */
  done: number | null;
  /** Persen 0–100 hanya bila `done` diketahui; selain itu null (tanpa bar). */
  percent: number | null;
};

/** Selesai 100% HANYA bila status completed terkonfirmasi; selain itu null tetap null. */
export function pediaProgress(input: { status: string; quantity: number; done: number | null | undefined; percent: number | null | undefined }): PediaProgress {
  if (input.status === "completed") return { done: input.quantity, percent: 100 };
  const done = typeof input.done === "number" && Number.isFinite(input.done) ? Math.max(0, input.done) : null;
  if (done === null) return { done: null, percent: null };
  const fromQty = input.quantity > 0 ? (done / input.quantity) * 100 : null;
  const raw = typeof input.percent === "number" && Number.isFinite(input.percent) ? input.percent : fromQty;
  return { done, percent: raw === null ? null : Math.max(0, Math.min(100, raw)) };
}

/** Angka opsional dari API: hanya bilangan bulat >= 0; selain itu null (bukan 0). */
export function knownCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * ETA jujur. Hanya eta_finish / eta_start dari tier apa adanya; tanpa hitung
 * jam dari avg_time/speed. null = tidak ada baris estimasi.
 */
export function pediaEstimate(input: { status: string; eta_start: string | null | undefined; eta_finish: string | null | undefined }): string | null {
  const finish = input.eta_finish?.trim();
  if (finish) return `Perkiraan selesai: ${finish}. Estimasi mengikuti antrean.`;
  const start = input.eta_start?.trim();
  const beforeProgress = ["paid", "queued", "submitting", "submitted"].includes(input.status);
  if (start && beforeProgress) {
    if (start === "Mengikuti antrean layanan") return `Perkiraan mulai: ${start}. Estimasi layanan, bukan jaminan.`;
    return `Perkiraan mulai: ${start} setelah pembayaran. Estimasi layanan, bukan jaminan.`;
  }
  return null;
}

export function stepThreeLabel(status: string): string {
  if (status === "submitting" || status === "submitted") return "Diproses";
  if (status === "in_progress") return "Berjalan";
  return "Sedang diproses";
}

export const isProcessingStatus = (status: string) => PROCESSING.includes(status);

/** Jam terakhir dicek (WIB) untuk baris kesegaran. */
export function formatCheckedTime(at: Date): string {
  return `${at.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} WIB`;
}

/** Pengalihan lintas host (Market → Pedia). Dipisah agar bisa diuji tanpa navigasi jsdom. */
export function redirectBrowser(url: string, mode: "replace" | "assign" = "replace"): void {
  if (mode === "assign") window.location.assign(url);
  else window.location.replace(url);
}
