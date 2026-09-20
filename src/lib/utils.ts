import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { parseExpiry } from "@/lib/expiry";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRupiah(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Zona waktu operasional toko — sama dengan REVENUE_TZ_OFFSET (+7) di server. */
export const WIB_TIME_ZONE = "Asia/Jakarta";

/**
 * Rumah kanonis format timestamp D1 untuk SEMUA tampilan (admin + storefront).
 *
 * D1 menulis `datetime('now')` sebagai UTC berformat spasi
 * ("2026-09-19 16:25:13"), sedangkan `new Date(...)` di JS membaca bentuk itu
 * sebagai waktu LOKAL. Di perangkat Indonesia (WIB) hasilnya mundur 7 jam —
 * order jam 23.25 tampil 16.25, dan lewat tengah malam tanggalnya ikut salah.
 * Menambahkan `timeZone: "Asia/Jakarta"` saja TIDAK cukup: yang rusak adalah
 * parsing-nya, bukan formatting-nya.
 *
 * `parseExpiry` (src/lib/expiry.ts) sudah menormalkan bentuk spasi maupun
 * ISO-8601 ke millis UTC yang benar — helper ini memakai sumber yang sama
 * dengan cron/webhook agar tampilan dan logika server tidak pernah berbeda.
 *
 * Mengembalikan `null` bila nilai kosong/tidak terbaca supaya tiap pemanggil
 * memilih fallback-nya sendiri ("—", nilai mentah, "Belum disimpan").
 */
export function formatWibDateTime(
  value: unknown,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string | null {
  const parsed = parseExpiry(value);
  if (parsed === null) return null;
  return new Intl.DateTimeFormat("id-ID", { ...options, timeZone: WIB_TIME_ZONE }).format(parsed);
}

// BUG-05 fix: re-export dari security.ts (crypto-safe, 8 hex) — jangan duplikasi weak version
export { generateOrderCode } from "@/lib/security";
