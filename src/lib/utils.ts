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

/** Nama tampilan terakhir bila email tidak menyisakan apa pun yang layak. */
export const FALLBACK_CUSTOMER_NAME = "Pembeli Axvara";

/**
 * Turunkan nama orang yang layak tampil dari alamat email.
 *
 * KENAPA ADA (regresi revamp checkout 2026-09-23): form web tidak lagi meminta
 * nama, dan fallback-nya `email.split("@")[0]` mentah. Prefix email BUKAN nama:
 * `budi123@…` menjadi "budi123" dan `first.last+promo@…` menjadi
 * "first.last+promo". Nilai itu tersimpan di `orders.customer_name` lalu
 * merembes ke sapaan halaman pesanan ("Terima kasih, budi123!"), notifikasi
 * Telegram admin, prefill tombol WA follow-up, pencarian admin, dan ekspor CSV.
 *
 * Pembersihan sengaja konservatif — tujuannya membuat nama LAYAK TAMPIL, bukan
 * menebak identitas: buang plus-addressing, ubah pemisah menjadi spasi, buang
 * angka di ujung, lalu kapitalkan. Nama yang diisi pembeli sendiri TIDAK
 * PERNAH disentuh fungsi ini.
 */
export function deriveNameFromEmail(email: string): string {
  const local = String(email || "").trim().split("@")[0] ?? "";
  // Plus-addressing adalah tag, bukan bagian nama.
  const withoutTag = local.split("+")[0] ?? "";
  const words = withoutTag
    .replace(/[._\-]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-zA-Z ]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 1)
    .slice(0, 3)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  const name = words.join(" ").trim();
  return name.length >= 2 ? name.slice(0, 80) : FALLBACK_CUSTOMER_NAME;
}

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
