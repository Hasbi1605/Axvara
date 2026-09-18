// src/lib/warung-rebahan/terms-display.ts — Lapisan tampil S&K WR ala Axvara.
//
// Masalah: `wr_terms` / `wr_delivery_terms` ditulis mentah oleh supplier
// (CAPS semua, "!!!!!", "DILARANG KERAS", "GARANSI HANGUS!", "denda 100k",
// singkatan "tnggal/bkn/incor", istilah "backfree/maximum login" tanpa
// penjelasan). Ditampilkan apa adanya di PDP, nadanya mengintimidasi dan
// bikin pembeli gagal beli — padahal SUBSTANSINYA wajib tetap sampai
// (jumlah device, larangan ubah akun, kapan garansi berlaku).
//
// Desain: formatter MURNI (tanpa I/O, edge-safe) yang dipakai saat RENDER.
// Database TIDAK disentuh — `wr_terms` milik sync, tetap read-only
// (lihat ownership.ts). Jadi update supplier di sweep berikutnya tetap
// masuk, dan tone Axvara tidak hilang.
//
// Kontrak nada: TEGAS tapi tidak membentak.
// - Pertahankan kata perintah: Wajib / Jangan / Hanya / Tidak berlaku.
// - Buang shouting: CAPS-lock kalimat, "!!!!", "DILARANG KERAS",
//   "TIDAK ADA TOLERANSI", "HANGUS!", "denda", "bl4ckmarket".
// - Setiap larangan = aturan + konsekuensi spesifik + jalan keluar
//   (chat admin). Bukan ancaman, tapi kepastian.

export type TermsSection = {
  /** Judul kelompok: "Akun & Login" | "Perangkat" | "Garansi" | "Cara Pakai" | "Lainnya" */
  title: string;
  items: string[];
};

export type DisplayTerms = {
  /** 2-4 highlight tegas, SELALU terlihat tanpa expand. */
  highlights: string[];
  /** Kelompok lengkap — SEMUA baris asli tercakup, tak ada yang dibuang. */
  sections: TermsSection[];
  /** Total baris aturan (untuk label "Lihat semua N ketentuan"). */
  totalRules: number;
  /** Langkah aktivasi bernomor, dari delivery_terms. Kosong bila tak ada. */
  steps: string[];
};

// ---- Kamus perluasan singkatan/typo supplier → bahasa pembeli ----

const ABBREV: Array<[RegExp, string]> = [
  [/\btnggal\b/gi, "tinggal"],
  [/\bbkn\b/gi, "bukan"],
  [/\bga\b/gi, "tidak"],
  [/\bgada\b/gi, "tidak ada"],
  [/\bklo\b/gi, "kalau"],
  [/\bkalo\b/gi, "kalau"],
  [/\bincor\b/gi, "incorrect password"],
  [/\bcancle\b/gi, "cancel"],
  [/\bsnk\b/gi, "S&K"],
  [/\bno rush\b/gi, "tidak bisa diburu-buru"],
  [/\bno komplain\b/gi, "di luar garansi"],
  [/\bno garansi\b/gi, "tanpa garansi"],
  [/\bfish\b/gi, "koin"],
  [/\bhh\s*otp(?:\s*manual)?\b/gi, "Kode OTP manual"],
  [/\bmenganti\b/gi, "mengganti"],
  [/\bresiko\b/gi, "risiko"],
  [/\bverif\b/gi, "verifikasi"],
  [/\bbilling\b/gi, "tagihan"],
  [/\bno gar\b/gi, "tanpa garansi"],
  [/\bpo\b/gi, "pre-order"],
  [/\bjaspay\b/gi, "jasa bayar"],
  [/\bss login\b/gi, "screenshot saat login"],
  [/\bdl\b/gi, "dulu"],
  [/\bdlu\b/gi, "dulu"],
  [/\bkrna\b/gi, "karena"],
  [/\bkarna\b/gi, "karena"],
  [/\bg[o0]\b/gi, "Go"],
  [/\b3u\b/gi, "3 user"],
  [/\b4u\b/gi, "4 user"],
  [/\b6u\b/gi, "6 user"],
  [/\b10u\b/gi, "10 user"],
  [/\b1p1u\b/gi, "1 profil 1 user"],
  // "made by order (fresh)" generik → dibuatkan baru. Pola spesifik produk
  // (mis. "Made by order agar fresh") ditangani rewriteTone dengan kalimat
  // lebih kaya; yang generik dirapikan di sini.
  [/\bmade by order\s*\(fresh\)/gi, "Dibuatkan baru setelah kamu bayar"],
  [/\bmade by order\s*\(no rush\)/gi, "Dibuatkan baru, tidak bisa diburu-buru"],
];

/** Penjelasan inline untuk istilah supplier yang asing bagi pembeli awam. */
const GLOSSARY: Array<{ re: RegExp; explain: string }> = [
  { re: /back\s*free|backfree/i, explain: "akun kembali ke versi gratis" },
  { re: /maximum login/i, explain: "terlalu sering login / pindah device" },
  { re: /screen limit/i, explain: "batas layar yang sedang nonton" },
  { re: /made by order/i, explain: "dibuatkan baru setelah kamu bayar" },
  { re: /anti limit/i, explain: "risiko limit lebih kecil" },
  { re: /restock/i, explain: "stok siap" },
];

function expandAbbreviations(s: string): string {
  let out = s;
  for (const [re, to] of ABBREV) out = out.replace(re, to);
  return out;
}

/** Normalisasi satu baris mentah → kalimat tegas ala Axvara. */
export function normalizeRule(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  // Buang prefix numbering mentah ("1.", "1)", "•", "-", "—", "●", emoji panah).
  // HATI-HATI: "25 - 30 hari" BUKAN numbering — pola angka-titik/strip hanya
  // dianggap prefix bila diikuti tepat 1 kata lalu akhir/pendek. Pola aman:
  // strip hanya bila cocok "^\d+[.\)]\s" atau bullet eksplisit.
  s = s
    .replace(/^\s*\d+\s*[.\)]\s+/u, "")
    .replace(/^\s*(?:•|●|▪|-{1,2}|—+|📥|⚠️|🚫|🌀)\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // Turunkan shouting: kalimat FULL-CAPS (>60% huruf & panjang >12) → Title-ish.
  const letters = s.replace(/[^A-Za-z]/g, "");
  const upper = s.replace(/[^A-Z]/g, "");
  if (letters.length > 12 && upper.length / letters.length > 0.6) {
    s = s.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, p1: string, p2: string) => p1 + p2.toUpperCase());
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  // Kompres tanda seru/tanya beruntun.
  s = s.replace(/!{2,}/g, "!").replace(/\?{2,}/g, "?");
  // URUTAN: rewrite dulu (pola masih mentah supplier), baru kembangkan
  // singkatan — kalau dibalik, "no garansi" keburu jadi "tanpa garansi"
  // dan pola BF/NO tidak ketemu pasangannya.
  s = rewriteTone(s);
  s = expandAbbreviations(s);
  // Kapital awal + titik akhir untuk kerapian list.
  s = s.charAt(0).toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += ".";
  // Stabilkan spasi ganda sisa rewrite.
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}

/**
 * Terjemahan nada: ancaman generik → aturan + konsekuensi spesifik.
 * URUTAN PENTING: pola paling spesifik dulu, sapuan umum terakhir.
 * Semua pola di bawah terbukti muncul di data prod (87 varian, 2026-09-18).
 */
function rewriteTone(s: string): string {
  let out = s;

  // 1. Ancaman sapu-jagat "TIDAK ADA TOLERANSI... HANGUS" → hapus ancamannya,
  //    ganti konsekuensi spesifik + jalan keluar. (Netflix, WeTV, Bstation)
  out = out.replace(
    /tidak ada toleransi[^.!?]*[.!?]\s*melanggar[^.!?]*\?\s*akun kami tarik dan garansi hangus!?/gi,
    "Kalau aturan di atas dilanggar, akun bisa kami tarik dan garansi tidak berlaku",
  );
  out = out.replace(/tidak ada toleransi[^.!?]*[.!?]?/gi, "");
  out = out.replace(/melanggar salah satu peraturan di ?atas\?\s*/gi, "");
  out = out.replace(/akun kami tarik dan garansi hangus!?/gi, "akun bisa kami tarik dan garansi tidak berlaku");

  // 2. "denda 100k dan garansi hangus" → Axvara tidak pernah mendenda.
  //    (WeTV) — ganti jadi konsekuensi garansi saja.
  out = out.replace(/melanggar\s*=\s*denda\s*100k\s*dan\s*garansi\s*hangus/gi, "Kalau dilanggar, garansi tidak berlaku");
  out = out.replace(/denda\s*100k[^.!?]*[.!?]?/gi, "");
  out = out.replace(/sanksi\s*\/\s*denda[^.!?]*[.!?]?/gi, "");

  // 3. "MELANGGAR = suspend = tanpa ganti rugi" (Crunchyroll) → spesifik.
  out = out.replace(/melanggar\s*=\s*akun kena suspend\s*=\s*tanpa ganti rugi!?/gi, "Kalau dilanggar, akun bisa kena suspend dan tidak diganti");

  // 4. "GARANSI HANGUS jika melanggar S&K" generik (Bstation) → spesifik.
  //    Termasuk varian "Garansi hangus jika..." kapital normal.
  out = out.replace(/garansi hangus jika melanggar s&k[^.!?]*/gi, "Garansi tidak berlaku kalau aturan di bawah ini dilanggar");
  out = out.replace(/garansi hangus/gi, "garansi tidak berlaku");
  // Sisa ancaman denda/sanksi generik (Bstation ekor kalimat).
  out = out.replace(/segala bentuk kecurangan[^.!?]*[.!?]?/gi, "");
  out = out.replace(/tindakan yang dapat merugikan seller[^.!?]*[.!?]?/gi, "");

  // 5. "DILARANG KERAS X" → "Jangan X" + alasan bila polanya dikenal.
  out = out.replace(/dilarang keras menggunakan vpn[^.!?]*!?/gi, "Jangan gunakan VPN apa pun saat login — akun bisa error dan garansi tidak berlaku");
  out = out.replace(/dilarang keras\s*/gi, "Jangan ");

  // 6. "JANGAN ..." caps → "Jangan ..." + konsekuensi untuk pola dikenal.
  out = out.replace(/jangan gunakan pin\b/gi, "Jangan pakai PIN");
  out = out.replace(/hanya 1 device\b/gi, "Gunakan di 1 device saja");
  out = out.replace(/dilarang sign out\b/gi, "Jangan sign out / keluar akun");

  // 7. "Jangan beli kalau tidak paham / Beli = ngerti" (ChatGPT voucher,
  //    GitHub student) → tetap tegas, tanpa mengusir.
  out = out.replace(/jangan beli (kalau|kalo) tidak paham cara pakai/gi, "Pastikan kamu sudah paham cara redeem sebelum beli");
  out = out.replace(/beli\s*=\s*ngerti (cara redeem|pakai)/gi, "Dengan membeli, kamu dianggap sudah paham $1");
  out = out.replace(/beli\s*=\s*ngerti pakai/gi, "Dengan membeli, kamu dianggap sudah paham cara pakainya");
  out = out.replace(/tidak include tutorial|tidak termasuk tutorial[^.!?]*/gi, "Tutorial redeem tidak termasuk — pastikan kamu sudah paham caranya");

  // 8. "risiko blackmarket" → jujur third-party, tanpa kata menakutkan.
  out = out.replace(/pahami[^\n]*resiko bl4ckmarket/gi, "Ini akun third-party (bukan official), jadi ada risiko kebijakan official berubah sewaktu-waktu");
  out = out.replace(/bl4ckmarket/gi, "third-party");

  // 9. Garansi backfree / maximum login → jelaskan istilahnya inline.
  //    (CapCut, Loklok, Spotify, Vidio, Gemini)
  //    NOTE: pola BF/NO disingkat dipadankan SEBELUM lowercase - lihat rewrite
  //    dilakukan pada string asli; pemadanan di sini case-insensitive.
  out = out.replace(/garansi hanya back\s*free\s*\(balik free\)/gi, "Garansi hanya berlaku kalau akun kembali ke versi gratis (backfree)");
  out = out.replace(/garansi hanya back\s*free/gi, "Garansi hanya berlaku kalau akun kembali ke versi gratis (backfree)");
  out = out.replace(/garansi hanya jika back\s*free\s*\(balik free\)[^.!?]*/gi, "Garansi hanya berlaku kalau akun kembali ke versi gratis (backfree), bukan untuk suspend");
  out = out.replace(/garansi\s*bf\s*>\s*maximum\s*no\s*garansi!?/gi, "Garansi hanya untuk backfree (akun kembali ke gratis). Tidak berlaku untuk maximum login (terlalu sering login / pindah device)");
  // Sisa generik "Garansi BF" tanpa pola lengkap → tetap dijelaskan.
  out = out.replace(/garansi\s*bf\b/gi, "Garansi backfree (akun kembali ke gratis)");
  out = out.replace(/maximum login tidak termasuk\s*garansi/gi, "Maximum login (terlalu sering login / pindah device) tidak termasuk garansi");
  out = out.replace(/maksimum\s*=\s*kebanyakan login/gi, "Maximum login artinya terlalu sering login / pindah-pindah device");
  out = out.replace(/resiko backfree\s*no komplain/gi, "Risiko akun kembali ke gratis (backfree) di luar garansi");
  out = out.replace(/fixing garansi sesuai stok produk, no req refund/gi, "Penggantian garansi mengikuti stok yang tersedia, bukan refund dana");
  out = out.replace(/tidak menerima komplain limit karena ini akun sharing[^.!?]*/gi, "Limit layar pada akun sharing bukan termasuk garansi");

  // 10. "NO GARANSI, NO KOMPLAIN / tanpa garansi" → tetap sampaikan, tegas.
  //     (ChatGPT Gcash, HBO, Upcloud) — jangan dilembutkan jadi bergaransi.
  //     Pola "maksimum = kebanyakan login" dijelaskan searah.
  out = out.replace(/maximum\s*=\s*kebanyakan login/gi, "Maximum login artinya terlalu sering login / pindah-pindah device");
  out = out.replace(/no garansi,?\s*no komplain!?/gi, "Produk ini tanpa garansi dan tanpa komplain");
  out = out.replace(/tidak ada garansi setelah sukses login/gi, "Tidak ada garansi setelah login berhasil");
  out = out.replace(/tidak ada garansi,?\s*beli langsung (nonton|dipakai)/gi, "Produk ini tanpa garansi — beli langsung $1");

  // 11. "Wajib ..." caps → "Wajib ..." rapi + alasan singkat bila dikenal.
  out = out.replace(/wajib update apps? ke versi terbaru!?(\s*\([^)]*\))?/gi, "Wajib update aplikasi ke versi terbaru sebelum login");
  out = out.replace(/menghindari email tidak terdaftar/gi, "agar tidak error 'email tidak terdaftar'");
  out = out.replace(/wajib ss login!?/gi, "Wajib kirim screenshot saat login (bukti untuk klaim garansi)");
  out = out.replace(/wajib login pertama lewat hp, jangan laptop\/pc dlu[^.!?]*/gi, "Wajib login pertama lewat HP (jangan laptop/PC dulu) agar Gmail tidak terkunci");

  // 12. Login/network yang bertele-tele (Netflix/Spotify) → padatkan tanpa
  //     menghilangkan langkah.
  out = out.replace(/pastikan login pertama kali menggunakan data seluler[^.!?]*/gi, "Login pertama wajib pakai data seluler (hotspot HP), jangan WiFi");
  out = out.replace(/tidak semua wifi dapat digunakan( untuk)? login[^.!?]*/gi, "Tidak semua WiFi bisa dipakai login");
  out = out.replace(/sebelum login wajib uninstall[^.!?]*/gi, "Sebelum login, uninstall dulu aplikasinya lalu install ulang");
  out = out.replace(/wajib uninstall & clear data sebelum login/gi, "Sebelum login, uninstall aplikasi + hapus datanya dulu");
  out = out.replace(/sebelum login mode pesawat dulu 1 kali/gi, "Sebelum login, nyalakan mode pesawat sekali lalu matikan lagi");
  out = out.replace(/login wajib menggunakan data \(jangan wifi rumah\)/gi, "Login wajib pakai data seluler, jangan WiFi rumah");

  // 13. Larangan akun umum → "Jangan ..." + konsekuensi garansi.
  out = out.replace(/dilarang mengubah password/gi, "Jangan ganti password");
  out = out.replace(/dilarang mengganti password/gi, "Jangan ganti password");
  out = out.replace(/dilarang ganti password/gi, "Jangan ganti password");
  out = out.replace(/dilarang ganti email \/ password/gi, "Jangan ganti email / password");
  out = out.replace(/dilarang ganti email/gi, "Jangan ganti email");
  out = out.replace(/dilarang ganti data akun[^.!?]*/gi, "Jangan ganti data akun");
  out = out.replace(/dilarang (mengubah|mengotak[-\s]?atik|mengubah-ubah) (informasi akun|data akun|data)[^.!?]*/gi, "Jangan ubah data akun (email, password, billing)");
  out = out.replace(/dilarang (mengutak[-\s]?atik|mengubah) (billing|pembayaran|payment)[^.!?]*/gi, "Jangan ubah menu pembayaran / langganan");
  out = out.replace(/dilarang (menautkan|menghubungkan) akun [xX]\b[^.!?]*/gi, "Jangan tautkan akun ke X");
  out = out.replace(/dilarang (menggunakan|digunakan untuk|dipakai untuk) ([^.]*?(api|coding|tools coding|model fable|generate gambar))[^.!?]*/gi, "Jangan dipakai untuk $2");
  out = out.replace(/dilarang jual sharing[^.!?]*/gi, "Jangan dijual / dishare lagi — bisa limit dan garansi tidak berlaku");
  out = out.replace(/dilarang meminjamkan dan membagikan password[^.!?]*/gi, "Jangan pinjamkan / bagikan password ke orang lain");
  out = out.replace(/dilarang (menghapus) riwayat nonton[^.!?]*/gi, "Jangan hapus riwayat nonton pengguna lain");
  out = out.replace(/dilarang tekan "sign out all devices"[^.!?]*/gi, 'Jangan tekan "sign out all devices"');
  out = out.replace(/dilarang (mengganti|mengubah)[^.!?]*otp[^.!?]*/gi, "OTP hanya diberi 1x kesempatan — jangan dipakai berulang");

  // 14. Batas device/user sharing → angka dipertahankan, nada dirapikan.
  out = out.replace(/maksimal login \d+ user\/device[^.!?]*/gi, (m) => `${m.charAt(0).toUpperCase() + m.slice(1)} — lebih dari itu akun bisa suspend dan garansi tidak berlaku`);
  out = out.replace(/lebih dari itu menyebabkan suspend & no garansi/gi, "lebih dari itu akun bisa suspend dan garansi tidak berlaku");
  out = out.replace(/1 akun untuk \d+-\d+ user saja!?/gi, (m) => `1 akun dipakai ${m.match(/\d+-\d+/)?.[0] ?? ""} user saja`);
  out = out.replace(/1x checkout untuk 1 device/gi, "1x checkout untuk 1 device");
  out = out.replace(/1 kali checkout untuk 1 device/gi, "1x checkout untuk 1 device");

  // 15. Durasi/hitung bulan generik → pertahankan angka.
  out = out.replace(/25\s*-\s*30 hari (dihitung|terhitung) 1 bulan/gi, "25–30 hari dihitung 1 bulan");

  // 16. "kebijakan aplikasi dapat berubah... di luar kendali seller"
  //     (WeTV) → versi Axvara yang sudah ada di warranty-policy.
  out = out.replace(/kebijakan aplikasi dapat berubah[^.!?]*/gi, "Kebijakan official bisa berubah sewaktu-waktu di luar kendali kami");
  out = out.replace(/tidak ada garansi untuk perubahan kebijakan[^.!?]*/gi, "perubahan kebijakan official bukan termasuk garansi");
  out = out.replace(/akun bisa saja sewaktu-waktu backfree\/suspend[^.!?]*/gi, "Akun bisa saja sewaktu-waktu kembali ke gratis / suspend");

  // 17. "langsung lapor admin / hubungi admin" → tambah kode pesanan.
  out = out.replace(/langsung lapor admin( di wa)?/gi, "langsung lapor ke admin dengan kode pesanan");
  out = out.replace(/langsung hubungi admin/gi, "langsung hubungi admin dengan kode pesanan");
  out = out.replace(/lapor kepada admin/gi, "lapor ke admin dengan kode pesanan");

  // 18. "Beli langsung pakai karena banned" (ChatGPT) → urgensi jujur.
  out = out.replace(/beli langsung (pake|pakai) krn gada yg tau kapan ada banned( massal)?/gi, "Langsung dipakai setelah dibeli — tidak ada yang tahu kapan ada banned massal");

  return out.trim().replace(/\s{2,}/g, " ");
}

// ---- Klasifikasi baris → kelompok ----

type GroupKey = "account" | "device" | "warranty" | "usage" | "other";

const GROUP_TITLE: Record<GroupKey, string> = {
  account: "Akun & Login",
  device: "Perangkat",
  warranty: "Garansi",
  usage: "Cara Pakai",
  other: "Lainnya",
};

const GROUP_ORDER: GroupKey[] = ["account", "device", "warranty", "usage", "other"];

function classify(normalized: string): GroupKey {
  const s = normalized.toLowerCase();
  if (/(garansi|backfree|refund|komplain|fixing|penggantian|klaim|warranty|hangus|suspend|banned|tanpa garansi)/.test(s)) return "warranty";
  if (/(device|perangkat|1 device|2 device|\d+ user|tv|smart tv|wifi|data seluler|vpn|ip perangkat|install|uninstall|login pertama)/.test(s)) return "device";
  if (/(email|password|profil|pin\b|otp|akun|login|invite|link|redeem|family|billing|pembayaran|payment|membership|voucher)/.test(s)) return "account";
  if (/(dilarang|jangan|wajib|hanya|maksimal|durasi|masa aktif|checkout|nonton|download|browser|website|aplikasi|langkah|buka|klik|pilih|tunggu|diamkan|mode pesawat|banner|payment|plan)/.test(s)) return "usage";
  return "other";
}

// Sinyal prioritas highlight: aturan paling menentukan keputusan beli.
function highlightScore(normalized: string): number {
  const s = normalized.toLowerCase();
  let score = 0;
  if (/\b(1|2)\s*(x\s*)?(checkout|device|perangkat)\b/.test(s)) score += 6;
  if (/login di 1 device|1 device saja|hanya login/.test(s)) score += 6;
  if (/jangan ganti (email|password|email \/ password)/.test(s)) score += 6;
  if (/jangan (ubah|ganti|pakai|gunakan|tekan|hapus|tautkan|dipakai|dijual)/.test(s)) score += 4;
  if (/wajib (update|login|kirim|uninstall)/.test(s)) score += 4;
  if (/tanpa garansi|tidak berlaku|tidak termasuk garansi|di luar garansi/.test(s)) score += 5;
  if (/backfree|maximum login|screen limit|suspend/.test(s)) score += 4;
  if (/data seluler|jangan wifi/.test(s)) score += 3;
  if (/kode pesanan/.test(s)) score += 1;
  return score;
}

function splitLines(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Entry utama: terms + delivery_terms mentah → struktur tampil.
 * JAMINAN: setiap baris non-kosong dari input muncul tepat sekali di
 * sections atau steps (tak ada pesan supplier yang hilang).
 */
export function formatTermsForDisplay(
  terms: string | null | undefined,
  deliveryTerms: string | null | undefined,
): DisplayTerms | null {
  const rawRules = splitLines(terms);
  const rawSteps = splitLines(deliveryTerms);
  if (rawRules.length === 0 && rawSteps.length === 0) return null;

  const normalized = rawRules.map(normalizeRule).filter(Boolean);

  // Kelompokkan dengan dedup ringan (Netflix mengulang baris yang sama di
  // terms & delivery; delivery diproses terpisah sebagai steps).
  const seen = new Set<string>();
  const buckets = new Map<GroupKey, string[]>();
  for (const line of normalized) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const g = classify(line);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(line);
  }

  const sections: TermsSection[] = GROUP_ORDER.filter((g) => (buckets.get(g) || []).length > 0).map((g) => ({
    title: GROUP_TITLE[g],
    items: buckets.get(g)!,
  }));

  // Highlight: 3 aturan skor tertinggi lintas kelompok (maks 4 bila seri).
  const ranked = [...normalized].sort((a, b) => highlightScore(b) - highlightScore(a));
  const highlights: string[] = [];
  for (const line of ranked) {
    if (highlights.length >= 3) break;
    if (!highlights.includes(line)) highlights.push(line);
  }

  const steps = rawSteps.map(normalizeRule).filter(Boolean);

  return {
    highlights,
    sections,
    totalRules: normalized.length,
    steps,
  };
}

/** Satu baris glossary untuk istilah asing — dipakai di bawah highlight. */
export function glossaryFor(lines: string[]): string | null {
  const found: string[] = [];
  for (const { re, explain } of GLOSSARY) {
    if (lines.some((l) => re.test(l)) && !found.includes(explain)) found.push(explain);
  }
  if (found.length === 0) return null;
  return found.join("; ") + ".";
}
