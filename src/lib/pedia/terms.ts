// src/lib/pedia/terms.ts — Arti istilah SMM untuk pembeli Pedia (2026-11-01).
// Keputusan owner: istilah tetap memakai bahasa SMM (Drop, Less Drop, High
// Drop, Refill, No Refill, …) karena itu yang dikenal pembeli/reseller;
// AXVARA hanya menambahkan penjelasan singkat. Label drop adalah estimasi, bukan jaminan.
// Nada (owner 2026-11-02): ringkas dan percaya diri tanpa mengulang peringatan;
// risiko drop disebut sekali di kondisi Drop, bukan di setiap definisi.
// White label (owner 2026-11-01): teks pembeli tidak menyebut supplier.

export type PediaDropLabel = "no_drop" | "less_drop" | "high_drop" | "unknown";

export const DROP_LABEL: Record<PediaDropLabel, string> = {
  no_drop: "No Drop",
  less_drop: "Less Drop",
  high_drop: "High Drop",
  unknown: "Drop belum diketahui",
};

export const DROP_MEANING: Record<PediaDropLabel, string> = {
  no_drop: "Perkiraan jumlah tetap stabil setelah pesanan selesai; bukan janji bebas drop.",
  less_drop: "Perkiraan drop ringan.",
  high_drop: "Perkiraan drop tinggi. Pengisian ulang hanya tersedia bila layanan punya Refill.",
  unknown: "Label drop belum tersedia; jumlah masih dapat berkurang setelah pengiriman.",
};

/** Label & arti drop versi pembeli EN; default tetap Indonesia. */
const DROP_LABEL_EN: Record<PediaDropLabel, string> = {
  no_drop: "No Drop",
  less_drop: "Less Drop",
  high_drop: "High Drop",
  unknown: "Drop not known yet",
};

const DROP_MEANING_EN: Record<PediaDropLabel, string> = {
  no_drop: "Quantity is expected to stay stable after the order completes; not a drop-free promise.",
  less_drop: "Light drop expected.",
  high_drop: "High drop expected. Refill is only available when the service has Refill.",
  unknown: "No drop label yet; the quantity can still decrease after delivery.",
};

export function pediaDropLabel(label: PediaDropLabel, locale: "id" | "en"): string {
  return locale === "en" ? DROP_LABEL_EN[label] : DROP_LABEL[label];
}

export function pediaDropMeaning(label: PediaDropLabel, locale: "id" | "en"): string {
  return locale === "en" ? DROP_MEANING_EN[label] : DROP_MEANING[label];
}

export function isDropLabel(value: unknown): value is PediaDropLabel {
  return value === "no_drop" || value === "less_drop" || value === "high_drop" || value === "unknown";
}

/** Label garansi singkat: "Refill 30 Days", "Refill Lifetime", "No Refill". */
export function refillLabel(days: number): string {
  if (!days || days <= 0) return "No Refill";
  if (days >= 3650) return "Refill Lifetime";
  return `Refill ${days} Days`;
}

/** Kalimat janji refill untuk layanan. Anchor dari tier/snapshot; anchor tidak dikenal → tanpa klausa "sejak". */
export function refillPromise(days: number, anchor?: "created" | "completed" | null, locale: "id" | "en" = "id"): string {
  if (!days || days <= 0) return locale === "en" ? "No Refill: dropped quantity is not topped up." : "No Refill: jumlah yang drop tidak diisi ulang.";
  if (locale === "en") {
    if (days >= 3650) return "Refill while the service is still available.";
    const sinceEn = anchor === "completed" ? " since the order was completed" : anchor === "created" ? " since the order was created" : "";
    return `Refill ${days} days${sinceEn}, while the service is still available.`;
  }
  if (days >= 3650) return "Refill selama layanan masih tersedia.";
  const since = anchor === "completed" ? " sejak pesanan selesai" : anchor === "created" ? " sejak pesanan dibuat" : "";
  return `Refill ${days} hari${since}, selama layanan masih tersedia.`;
}

export const PEDIA_TERMS: { term: string; meaning: string }[] = [
  { term: "HQ", meaning: "High Quality, kategori kualitas layanan." },
  { term: "Real", meaning: "Akun Real (Real Accounts), bukan akun campuran." },
  { term: "Real Look", meaning: "Akun dengan tampilan profil seperti akun asli." },
  { term: "Real People", meaning: "Akun Real People, bukan akun campuran." },
  { term: "Real Human", meaning: "Akun Real Human, bukan akun campuran." },
  { term: "Campuran", meaning: "Gabungan beberapa jenis akun dalam satu pesanan." },
  { term: "Akun berpostingan", meaning: "Akun pengirim sudah memiliki postingan." },
  { term: "Akun lama", meaning: "Akun pengirim bukan akun baru." },
  { term: "Instant Start", meaning: "Pesanan langsung masuk antrean kirim setelah pembayaran terkonfirmasi." },
  { term: "Drop", meaning: "Jumlah followers, likes, atau views berkurang setelah pesanan selesai. Semua layanan bisa drop; yang berbeda seberapa besar." },
  { term: "Drop rate", meaning: "Persentase jumlah yang berkurang setelah pengiriman. Persentase pengajuan Refill bukan pengukuran langsung Drop rate." },
  { term: "Pengajuan Refill", meaning: "Persentase pesanan layanan ini yang diajukan Refill dalam 7 hari terakhir, bukan persentase followers, likes, atau views yang hilang." },
  { term: "No Drop", meaning: DROP_MEANING.no_drop },
  { term: "Less Drop", meaning: DROP_MEANING.less_drop },
  { term: "High Drop", meaning: DROP_MEANING.high_drop },
  { term: "Refill", meaning: "Isi ulang gratis untuk jumlah yang drop, selama masa refill. Ajukan lewat halaman Refill atau halaman pesanan." },
  { term: "Refill 30 Days / 365 Days", meaning: "Refill N hari sejak pesanan dibuat atau selesai (sesuai layanan), selama layanan masih tersedia. Setelah masa itu habis, refill tidak bisa diajukan." },
  { term: "Refill Lifetime", meaning: "Refill selama layanan masih tersedia. Bila layanan ditutup, refill ikut berakhir." },
  { term: "No Refill", meaning: "Tanpa garansi refill: jumlah yang drop tidak diisi ulang." },
  { term: "Success rate", meaning: "Persentase pesanan layanan ini yang selesai penuh dalam 7 hari terakhir. Makin tinggi, makin jarang gagal atau dibatalkan." },
  { term: "Start time", meaning: "Perkiraan waktu sebelum pengiriman mulai, setelah pembayaran terkonfirmasi." },
  { term: "Avg time", meaning: "Rata-rata waktu pesanan selesai untuk 1.000 unit. Jumlah lebih besar biasanya lebih lama." },
  { term: "Speed", meaning: "Perkiraan jumlah yang dikirim per hari. Pengiriman bertahap biasanya terlihat lebih alami." },
  { term: "Min / Max", meaning: "Jumlah terkecil dan terbesar dalam satu pesanan untuk layanan itu." },
];

/** Nama istilah (PEDIA_TERMS) yang relevan untuk nama layanan: kata kualitas + keterangan bermakna. */
export function serviceTermNames(fullName: string, quality?: string | null): string[] {
  const [head, ...notes] = fullName.split(/\s*·\s*/);
  const word = /\bReal Look\b/.test(head) ? "Real Look" : /\bReal People\b/.test(head) ? "Real People" : /\bReal Human\b/.test(head) ? "Real Human"
    : /\bReal\b/.test(head) ? "Real" : /\bHQ\b/.test(head) ? "HQ" : quality === "real" ? "Real" : quality === "hq" ? "HQ" : null;
  const out = word ? [word] : [];
  for (const note of notes.map((n) => n.trim())) {
    if (note === "Campuran" || note === "Instant Start") out.push(note);
    else if (note === "Akun berpostingan") out.push(note);
    else if (note === "Akun lama") out.push(note);
    else if (note === "Akun lama berpostingan") out.push("Akun lama", "Akun berpostingan");
  }
  return out;
}
/** True bila nama layanan memuat keterangan "Instant Start" (fakta sumber, bukan janji waktu). */
export const hasInstantStart = (fullName: string) => fullName.split(/\s*·\s*/).slice(1).some((n) => n.trim() === "Instant Start");

export const PEDIA_REFILL_STEPS: [string, string][] = [
  ["Cek jumlah yang drop", "Bandingkan jumlah sekarang dengan jumlah setelah pesanan selesai. Refill hanya untuk layanan yang punya Refill dan masih dalam masa refill."],
  ["Ajukan refill", "Masukkan kode pesanan dan kontak checkout di halaman ini. Refill bisa diajukan 1× per 24 jam per pesanan."],
  ["Refill diproses", "Refill otomatis biasanya mulai dalam 24 jam. Layanan dengan refill manual diproses admin, biasanya dalam 1×24 jam."],
  ["Pantau hasilnya", "Status refill tampil di halaman ini dan di halaman pesanan."],
];

export const PEDIA_REFILL_RULES = [
  "Refill hanya menutup jumlah yang drop dari pesanan ini. Contoh: akun 1.000 followers, beli 1.000, lalu turun ke 1.800. Yang bisa direfill 200, bukan lebih.",
  "Jika jumlah turun di bawah jumlah sebelum pesanan, naikkan dulu ke jumlah awal sebelum mengajukan refill.",
  "Akun atau postingan harus tetap publik dan link tidak diganti. Target privat, dihapus, atau ganti username membuat refill ditolak.",
  "Layanan No Refill dan masa refill yang sudah habis tidak bisa diajukan refill.",
];

// Versi pembeli EN (2026-11-07). Kunci, urutan, angka, dan fakta kebijakan sama
// persis dengan versi Indonesia; hanya bahasanya yang berbeda.
const PEDIA_TERMS_EN: { term: string; meaning: string }[] = [
  { term: "HQ", meaning: "High Quality, a service quality category." },
  { term: "Real", meaning: "Real Accounts, not mixed accounts." },
  { term: "Real Look", meaning: "Accounts whose profile looks like a real account." },
  { term: "Real People", meaning: "Real People accounts, not mixed accounts." },
  { term: "Real Human", meaning: "Real Human accounts, not mixed accounts." },
  { term: "Campuran", meaning: "A combination of several account types in one order." },
  { term: "Akun berpostingan", meaning: "The sending accounts already have posts." },
  { term: "Akun lama", meaning: "The sending accounts are not new accounts." },
  { term: "Instant Start", meaning: "The order enters the delivery queue right after payment is confirmed." },
  { term: "Drop", meaning: "Followers, likes, or views can decrease after the order completes. Every service can drop; only the size differs." },
  { term: "Drop rate", meaning: "Percentage of the quantity lost after delivery. The Refill request percentage is not a direct measurement of drop rate." },
  { term: "Pengajuan Refill", meaning: "Percentage of orders for this service that requested a Refill in the last 7 days, not the percentage of followers, likes, or views lost." },
  { term: "No Drop", meaning: DROP_MEANING_EN.no_drop },
  { term: "Less Drop", meaning: DROP_MEANING_EN.less_drop },
  { term: "High Drop", meaning: DROP_MEANING_EN.high_drop },
  { term: "Refill", meaning: "Free top-up for dropped quantity during the refill period. Request it from the Refill page or the order page." },
  { term: "Refill 30 Days / 365 Days", meaning: "Refill N days since the order was created or completed (depending on the service), while the service is still available. After that period, no refill can be requested." },
  { term: "Refill Lifetime", meaning: "Refill while the service is still available. If the service is closed, refills end too." },
  { term: "No Refill", meaning: "No refill guarantee: dropped quantity is not topped up." },
  { term: "Success rate", meaning: "Percentage of orders for this service fully completed in the last 7 days. Higher means fewer failures or cancellations." },
  { term: "Start time", meaning: "Estimated time before delivery starts, after payment is confirmed." },
  { term: "Avg time", meaning: "Average time to complete an order of 1,000 units. Larger quantities usually take longer." },
  { term: "Speed", meaning: "Estimated quantity delivered per day. Gradual delivery usually looks more natural." },
  { term: "Min / Max", meaning: "Smallest and largest quantity in one order for that service." },
];

const PEDIA_REFILL_STEPS_EN: [string, string][] = [
  ["Check the dropped quantity", "Compare the current count with the count after the order completed. Refill only applies to services with Refill that are still inside the refill period."],
  ["Request a refill", "Enter the order code and checkout contact on this page. A refill can be requested once per 24 hours per order."],
  ["Refill is processed", "Automatic refills usually start within 24 hours. Services with manual refill are processed by admin, usually within 24 hours."],
  ["Track the result", "The refill status appears on this page and on the order page."],
];

const PEDIA_REFILL_RULES_EN = [
  "Refill only covers the quantity that dropped from this order. Example: an account with 1,000 followers, buy 1,000, then it drops to 1,800. Only 200 can be refilled, not more.",
  "If the count fell below the count before the order, raise it back to the starting count before requesting a refill.",
  "The account or post must stay public and the link must not change. A private or deleted target, or a changed username, makes the refill fail.",
  "No Refill services and refill periods that have ended cannot be refilled.",
];

export function pediaTerms(locale: "id" | "en"): { term: string; meaning: string }[] {
  return locale === "en" ? PEDIA_TERMS_EN : PEDIA_TERMS;
}
export function pediaRefillSteps(locale: "id" | "en"): [string, string][] {
  return locale === "en" ? PEDIA_REFILL_STEPS_EN : PEDIA_REFILL_STEPS;
}
export function pediaRefillRules(locale: "id" | "en"): string[] {
  return locale === "en" ? PEDIA_REFILL_RULES_EN : PEDIA_REFILL_RULES;
}

// White label (owner 2026-11-01): teks pembeli 100% AXVARA, tanpa menyebut
// supplier/nama penyedia. Dipakai pada katalog publik dan snapshot copy pesanan,
// sehingga teks lama di DB/snapshot pun tidak bocor.
const WHITE_LABEL: [RegExp, string][] = [
  // Kosmetik (3 Nov): hanya atribusi/label; masa, anchor, dan syarat refill tidak berubah.
  [/Tanpa refill dari AXVARA/g, "No Refill"],
  [/(Refill \d+ (?:hari|Days)) dari AXVARA/g, "$1"],
  [/,\s*label Real\./g, ", Real."],
  [/Label karakter akun pada layanan\.?/g, ""],
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
