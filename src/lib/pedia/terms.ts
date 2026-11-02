// src/lib/pedia/terms.ts — Arti istilah SMM untuk pembeli Pedia (2026-11-01).
// Keputusan owner: istilah tetap memakai bahasa SMM (Drop, Less Drop, High
// Drop, Refill, No Refill, …) karena itu yang dikenal pembeli/reseller;
// AXVARA hanya menambahkan penjelasan singkat. Label drop adalah estimasi, bukan jaminan.
// White label (owner 2026-11-01): teks pembeli tidak menyebut supplier.

export type PediaDropLabel = "no_drop" | "less_drop" | "high_drop" | "unknown";

export const DROP_LABEL: Record<PediaDropLabel, string> = {
  no_drop: "No Drop",
  less_drop: "Less Drop",
  high_drop: "High Drop",
  unknown: "Drop belum diketahui",
};

export const DROP_MEANING: Record<PediaDropLabel, string> = {
  no_drop: "Saat ini belum terlihat drop, tetapi drop tetap bisa terjadi kapan saja.",
  less_drop: "Bisa drop sedikit, dan masih mungkin drop lebih banyak di kemudian hari.",
  high_drop: "Saat ini drop besar. Pilih hanya bila menerima risikonya; drop tidak bisa dikomplain kecuali layanan punya Refill.",
  unknown: "Belum ada info drop untuk layanan ini. Anggap drop bisa terjadi.",
};

export function isDropLabel(value: unknown): value is PediaDropLabel {
  return value === "no_drop" || value === "less_drop" || value === "high_drop" || value === "unknown";
}

/** Label garansi singkat: "Refill 30 Days", "Refill Lifetime", "No Refill". */
export function refillLabel(days: number): string {
  if (!days || days <= 0) return "No Refill";
  if (days >= 3650) return "Refill Lifetime";
  return `Refill ${days} Days`;
}

export const PEDIA_TERMS: { term: string; meaning: string }[] = [
  { term: "HQ", meaning: "High Quality, label kualitas layanan. Bukan jaminan akun lama, berpostingan, aktif, atau bebas Drop." },
  { term: "Real", meaning: "Label karakter akun pada layanan. Bukan jaminan akun aktif, interaksi organik, atau bebas Drop." },
  { term: "Drop", meaning: "Jumlah followers, likes, atau views berkurang setelah pesanan selesai. Semua layanan bisa drop; yang berbeda seberapa besar." },
  { term: "Drop rate", meaning: "Persentase jumlah yang berkurang setelah pengiriman. Persentase pengajuan Refill bukan pengukuran langsung Drop rate." },
  { term: "Pengajuan Refill", meaning: "Persentase pesanan layanan ini yang diajukan Refill dalam 7 hari terakhir, bukan persentase followers, likes, atau views yang hilang." },
  { term: "No Drop", meaning: DROP_MEANING.no_drop },
  { term: "Less Drop", meaning: DROP_MEANING.less_drop },
  { term: "High Drop", meaning: DROP_MEANING.high_drop },
  { term: "Refill", meaning: "Isi ulang gratis untuk jumlah yang drop, selama masa refill. Ajukan lewat halaman Refill atau halaman pesanan." },
  { term: "Refill 30 Days / 365 Days", meaning: "Masa refill 30 atau 365 hari sejak pesanan dibuat (atau selesai, sesuai ketentuan layanan). Setelah masa itu habis, refill tidak bisa diajukan." },
  { term: "Refill Lifetime", meaning: "Refill selama layanan masih tersedia. Bila layanan ditutup, refill ikut berakhir." },
  { term: "No Refill", meaning: "Tanpa garansi. Jumlah yang drop tidak diisi ulang, bahkan bila drop segera setelah selesai. Biasanya lebih murah." },
  { term: "Success rate", meaning: "Persentase pesanan layanan ini yang selesai penuh dalam 7 hari terakhir. Makin tinggi, makin jarang gagal atau dibatalkan." },
  { term: "Start time", meaning: "Perkiraan waktu sebelum pengiriman mulai, setelah pembayaran terkonfirmasi." },
  { term: "Avg time", meaning: "Rata-rata waktu pesanan selesai untuk 1.000 unit. Jumlah lebih besar biasanya lebih lama." },
  { term: "Speed", meaning: "Perkiraan jumlah yang dikirim per hari. Pengiriman bertahap biasanya terlihat lebih alami." },
  { term: "Min / Max", meaning: "Jumlah terkecil dan terbesar dalam satu pesanan untuk layanan itu." },
];

export const PEDIA_REFILL_STEPS: [string, string][] = [
  ["Cek jumlah yang drop", "Bandingkan jumlah sekarang dengan jumlah setelah pesanan selesai. Refill hanya untuk layanan yang punya Refill dan masih dalam masa refill."],
  ["Ajukan refill", "Masukkan kode pesanan dan kontak checkout di halaman ini. Refill bisa diajukan 1× per 24 jam per pesanan."],
  ["AXVARA mengisi ulang", "Refill otomatis biasanya mulai dalam 24 jam. Layanan dengan refill manual diproses admin, biasanya dalam 1×24 jam."],
  ["Pantau hasilnya", "Status refill tampil di halaman ini dan di halaman pesanan."],
];

export const PEDIA_REFILL_RULES = [
  "Refill hanya menutup jumlah yang drop dari pesanan ini. Contoh: akun 1.000 followers, beli 1.000, lalu turun ke 1.800. Yang bisa direfill 200, bukan lebih.",
  "Jika jumlah turun di bawah jumlah sebelum pesanan, naikkan dulu ke jumlah awal sebelum mengajukan refill.",
  "Akun atau postingan harus tetap publik dan link tidak diganti. Target privat, dihapus, atau ganti username membuat refill ditolak.",
  "Layanan No Refill dan masa refill yang sudah habis tidak bisa diajukan refill.",
];

// White label (owner 2026-11-01): teks pembeli 100% AXVARA, tanpa menyebut
// supplier/nama penyedia. Dipakai pada katalog publik dan snapshot copy pesanan,
// sehingga teks lama di DB/snapshot pun tidak bocor.
const WHITE_LABEL: [RegExp, string][] = [
  [/\s*\((?:label|klaim) (?:supplier|penyedia)\)/gi, ""],
  [/Estimasi (?:supplier|penyedia)/gi, "Estimasi"],
  [/Start time dan speed dari (?:supplier|penyedia)/gi, "Start time dan speed"],
  [/(?:Supplier|Penyedia) tidak memberi label drop/gi, "Belum ada label drop"],
  [/(?:Supplier|Penyedia) menyebut ([^,.\n]+), tetapi API refill belum tersedia/gi, "Info $1 belum dapat diajukan otomatis"],
  [/,?\s*(?:menurut|dari|oleh|ke|di) (?:supplier|penyedia)\b/gi, ""],
  [/\b(?:IndoSMM|ProviderSMM|indosmm|providersmm)\b/g, "AXVARA"],
  [/\b(?:supplier|penyedia)\b/gi, "sistem"],
];
export function whiteLabel(text: string): string;
export function whiteLabel(text: string | null): string | null;
export function whiteLabel(text: string | null): string | null {
  if (text == null) return text;
  let out = text;
  for (const [re, to] of WHITE_LABEL) out = out.replace(re, to);
  return out.replace(/ {2,}/g, " ").replace(/ ([.,;:])/g, "$1");
}
