// src/lib/product-copy/format.ts — Struktur salinan produk yang tampil di PDP.
//
// Murni & aman untuk browser: parser deskripsi (dipakai PDP + meta SEO) dan
// fallback "teks pemasok dirapikan" untuk S&K/cara aktivasi yang belum
// dikurasi. Data kurasi Axvara TIDAK diimpor di sini (lihat resolve.ts).
import { cleanSupplierLines, type CleanLine } from "./text";

export type CopySectionKind = "paket" | "proses" | "aturan" | "garansi";
export type CopySection = { kind: CopySectionKind; items: string[] };
export type ActivationGroup = { title: string | null; steps: string[] };
export type VariantCopy = {
  /** admin = disunting di panel; axvara = kurasi di kode; pemasok = teks WR dirapikan. */
  source: "admin" | "axvara" | "pemasok";
  sections: CopySection[];
  activation: ActivationGroup[];
  notes: string[];
};

export const COPY_SECTION_ORDER: CopySectionKind[] = ["paket", "proses", "aturan", "garansi"];
export const COPY_SECTION_TITLES: Record<CopySectionKind, string> = {
  paket: "Detail paket",
  proses: "Proses & pengiriman",
  aturan: "Aturan pakai",
  garansi: "Garansi",
};

const GARANSI_RE = /garansi|backfree|back\s*free|\bbf\b|refund|ganti rugi|nogar/i;
const RULE_START_RE = /^(?:dilarang|jangan|wajib|tidak boleh|hanya|maks(?:imal|imum)?\b|max\b|pastikan|harus)/i;
const ATURAN_RE = /dilarang|jangan|wajib|tidak boleh|tidak bisa|tidak disarankan|hanya (?:boleh|bisa|login|di)\b|maks(?:imal|imum)?\b|\bmax\b|pastikan|harus|risiko|resiko|toleransi|denda|suspend|banned/i;
const PAKET_RE = /masa aktif|durasi|paket|\bplan\b|berupa|mendapatkan|dapat akun|include|termasuk/i;
const PROSES_RE = /proses|made by order|pre[\s-]?order|\bpo\b|\bh-1\b|antri|antre|malam|sore|no rush|tanya(?:kan)? stok|estimasi|dikirim|diberikan/i;
const STEP_RE = /^(?:buka|klik|tap|ketuk|pilih|masukkan|masukan|isi|ketik|login|log in|masuk|sign|install|instal|download|unduh|reinstall|uninstall|hapus|clear|ambil|salin|copy|tempel|paste|kirim|cek|tunggu|redeem|tukar|aktifkan|verifikasi|scan|pindai|join|gabung|terima|lalu|kemudian|setelah|sebelum|update|perbarui|logout|keluar|done|selesai)\b/i;

/** Tebak bagian S&K untuk baris yang belum dikurasi (teks WR baru / tulisan admin). */
export function classifyTermLine(line: string): CopySectionKind {
  // "Dilarang ganti password (ketahuan = nogar)" tetap aturan, bukan garansi.
  if (RULE_START_RE.test(line.trim())) return "aturan";
  if (GARANSI_RE.test(line)) return "garansi";
  if (ATURAN_RE.test(line)) return "aturan";
  if (PAKET_RE.test(line)) return "paket";
  if (PROSES_RE.test(line)) return "proses";
  return "paket";
}

function isHeading(text: string): boolean {
  return text.length <= 48 && /:$/.test(text);
}

function stripHeading(text: string): string {
  return text.replace(/\s*:$/, "").trim();
}

function lineKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Susun bagian S&K dalam urutan tetap; bagian kosong dibuang. */
export function buildSections(entries: Partial<Record<CopySectionKind, readonly string[]>>): CopySection[] {
  return COPY_SECTION_ORDER
    .map((kind) => ({ kind, items: [...(entries[kind] ?? [])].filter((item) => item.trim()) }))
    .filter((section) => section.items.length > 0);
}

export function classifyTermLines(lines: readonly string[]): CopySection[] {
  const buckets: Partial<Record<CopySectionKind, string[]>> = {};
  for (const line of lines) {
    const kind = classifyTermLine(line);
    (buckets[kind] ??= []).push(line);
  }
  return buildSections(buckets);
}

function splitDelivery(lines: CleanLine[], seen: Set<string>): { groups: ActivationGroup[]; rules: string[] } {
  const groups: ActivationGroup[] = [];
  const rules: string[] = [];
  let current: ActivationGroup | null = null;
  for (const line of lines) {
    if (isHeading(line.text)) {
      current = { title: stripHeading(line.text), steps: [] };
      groups.push(current);
      continue;
    }
    const key = lineKey(line.text);
    if (seen.has(key)) continue;
    seen.add(key);
    if (current) {
      current.steps.push(line.text);
    } else if (line.numbered || STEP_RE.test(line.text)) {
      if (!groups.length || groups[0].title !== null) groups.unshift({ title: null, steps: [] });
      groups[0].steps.push(line.text);
    } else {
      rules.push(line.text);
    }
  }
  return { groups: groups.filter((g) => g.steps.length > 0), rules };
}

/**
 * Rewrite link supplier → shortlink axvara.tech/go/* (2026-10-03, keputusan
 * owner; shortlink 2026-10-03 — sebelumnya artikel AXVARA full path).
 *
 * Yang di-rewrite (white-label, tahan sync — teks supplier ditimpa tiap sweep):
 * 1. Halaman docs/tutorial Sekalipay (sekalipay.com/docs/*tutorial-login-netflix*)
 *    → go/netflix-login. Customer yang klik link docs melihat nav
 *    "Belanja Sekarang" dan bisa order langsung di supplier.
 * 2. Video tutorial login Alight Motion supplier (youtu.be/8emqddsjPsE +
 *    varian youtube.com/watch?v=.../embed/.../shorts/... dengan ID yang sama,
 *    berikut query `?si=...`) → go/alight-login.
 *    Screenshot owner: blok "CARA AKTIVASI" PDP masih menampilkan link
 *    youtu.be mentah ke channel supplier.
 * 3. Mailbox OTP supplier (screenshot owner 2026-10-03: sengare.art Zoom,
 *    fnstore.my.id + losantoz.com iQiyi — tidak ada di kurasi/snapshot,
 *    hanya muncul dari teks supplier live) → go/otp-sengare, go/mail-fnstore,
 *    go/mail-losantoz. Mailbox Netflix + bototp ikut: go/otp, go/otp-bot.
 * 4. Mailbox Prime Video (oliesmail.com) → go/mail-olies.
 *
 * Yang DIPERTAHANKAN mentah (keputusan owner):
 * - netflix.com/clearcookies + /youraccount — biarkan apa adanya;
 * - domain resmi produk lain (microsoft.com, ...) + tutorial umum LAIN
 *   (youtube / youtu.be ID berbeda) + bot Telegram operasional;
 * - genjos / generator.email / 2fa.live — belum muncul di teks tampil,
 *   dibungkus belakangan bila muncul.
 *
 * Dipakai di DUA jalur: fallback PDP (supplierVariantCopy, pre-bayar) dan
 * email/panel pasca-bayar (formatSkLicenses di sekalipay/deliver.ts)
 * agar kedua sisi konsisten.
 */
export const AXVARA_NETFLIX_GUIDE_PATH = "/artikel/cara-login-netflix-setelah-order-di-axvara";
export const AXVARA_ALIGHT_GUIDE_PATH = "/artikel/cara-login-alight-motion-setelah-order-di-axvara";
// Canonical SEO tetap path /artikel (sitemap + metadata tidak berubah); yang
// tampil ke pembeli = shortlink /go (alias 307). Konstanta GO_* = teks tampil.
export const GO_NETFLIX_LOGIN = "axvara.tech/go/netflix-login";
export const GO_ALIGHT_LOGIN = "axvara.tech/go/alight-login";
export const GO_OTP = "axvara.tech/go/otp";
export const GO_OTP_BOT = "axvara.tech/go/otp-bot";
export const GO_OTP_SENGARE = "axvara.tech/go/otp-sengare";
export const GO_OTP_GENJOS = "axvara.tech/go/otp-genjos";
export const GO_OTP_SEKALICHAT = "axvara.tech/go/otp-sekalichat";
export const GO_OTP_WAROENG = "axvara.tech/go/otp-waroeng";
export const GO_OTP_RUNCUBES = "axvara.tech/go/otp-runcubes";
export const GO_OTP_GENERATOR = "axvara.tech/go/otp-generator";
export const GO_OTP_2FA = "axvara.tech/go/otp-2fa";
export const GO_MAIL_OLIES = "axvara.tech/go/mail-olies";
export const GO_MAIL_FNSTORE = "axvara.tech/go/mail-fnstore";
export const GO_MAIL_LOSANTOZ = "axvara.tech/go/mail-losantoz";
export const GO_OTP_SPOTIFY = "axvara.tech/go/otp-spotify";
export const GO_BOT_VIU = "axvara.tech/go/bot-viu";
export const GO_BOT_ALIGHT = "axvara.tech/go/bot-alight";
export const GO_BOT_SCRIBD = "axvara.tech/go/bot-scribd";
export const GO_TUTOR_CANVA = "axvara.tech/go/tutor-canva";
export const GO_TUTOR_REMINI = "axvara.tech/go/tutor-remini";
export const GO_TUTOR_SCRIBD = "axvara.tech/go/tutor-scribd";
export const GO_TUTOR_ARCADE = "axvara.tech/go/tutor-arcade";
export const GO_TUTOR_VISION_TV = "axvara.tech/go/tutor-vision-tv";
export const GO_TUTOR_VISION_TV2 = "axvara.tech/go/tutor-vision-tv2";

const SUPPLIER_DOCS_RE = /https?:\/\/(?:www\.)?sekalipay\.com\/docs\/[^\s),]*/gi;
const BARE_SUPPLIER_DOCS_RE = /(?<!\/)sekalipay\.com\/docs\/[^\s),]*/gi;

// Video login Alight Motion milik supplier (ID 8emqddsjPsE): semua bentuk URL
// YouTube untuk ID ini di-rewrite, ID lain tidak tersentuh.
const ALIGHT_YOUTUBE_RE =
  /https?:\/\/(?:www\.)?(?:youtu\.be\/8emqddsjPsE[^\s),\"']*|youtube\.com\/(?:watch\?[^\s),\"']*v=8emqddsjPsE[^\s),\"']*|embed\/8emqddsjPsE[^\s),\"']*|shorts\/8emqddsjPsE[^\s),\"']*))/gi;
const BARE_ALIGHT_YOUTUBE_RE =
  /(?<!\/)(?:youtu\.be\/8emqddsjPsE[^\s),\"']*|(?:www\.)?youtube\.com\/(?:watch\?[^\s),\"']*v=8emqddsjPsE[^\s),\"']*|embed\/8emqddsjPsE[^\s),\"']*|shorts\/8emqddsjPsE[^\s),\"']*))/gi;

// Mailbox OTP supplier: full URL + bare domain (tanpa skema). Pola bare
// memakai lookbehind agar tidak makan ekor URL berskema. Cakupan = AUDIT D1
// PROD LIVE 2026-10-03 (seluruh wr_terms/wr_delivery_terms/sk_seller_note/
// sk_description ber-link, termasuk produk off/restok).
const MAILBOX_HOSTS = [
  "netflix-codes\\.sekalipay\\.com\\/mailbox",
  "bototp\\.site",
  "sengare\\.art\\/check-inbox",
  "genjos\\.xoftware\\.my\\.id\\/mailbox",
  "tmail\\.sekalichat\\.com",
  "waroengmail\\.com",
  "tmail\\.runcubesapps\\.com(?:\\/mailbox)?",
  "generator\\.email",
  "2fa\\.live",
  "oliesmail\\.com",
  "fnstore\\.my\\.id",
  "losantoz\\.com",
  "docdownloader\\.com",
  "pastebin\\.com",
  "drive\\.google\\.com",
  "support\\.microsoft\\.com",
  "app\\.remini\\.ai",
  "leonardo\\.ai",
  "blackbox\\.ai",
  "grok\\.com",
  "rctiplus\\.com\\/login",
  "ibispaint\\.com",
  "film\\.wetv\\.vip",
  "dramaku\\.world",
];
const MAILBOX_RE = new RegExp(`https?:\\/\\/(?:www\\.)?(?:${MAILBOX_HOSTS.join("|")})[^\\s),\"']*`, "gi");
const BARE_MAILBOX_RE = new RegExp(
  `(?<!\\/)(?:${MAILBOX_HOSTS.map((h) => `(?<![a-z0-9_@])${h}`).join("|")})[^\\s),\"']*`,
  "gi",
);

// Bot Telegram supplier (handle @... + t.me/...): full + bare.
const BOT_HANDLES = [
  "autoresetpwspotify_bot",
  "sekalipayviu_bot",
  "alightmotion321_bot",
  "Scribd_Downloaderbot",
];
const BOT_RE = new RegExp(
  `(?:https?:\\/\\/t\\.me\\/(?:${BOT_HANDLES.join("|")})[^\\s),\"']*|(?<![a-z0-9_@])@(?:${BOT_HANDLES.join("|")})\\b)`,
  "gi",
);

// Tutorial YouTube supplier (ID spesifik dari audit live; ID lain tak tersentuh).
const TUTOR_IDS: [RegExp, string][] = [
  [/p_xpw5M1zaU/, GO_TUTOR_CANVA],
  [/J07zn3FAJyY/, GO_TUTOR_REMINI],
  [/8nMzvoauNVk/, GO_TUTOR_SCRIBD],
  [/IbSEx5_pUr8/, GO_TUTOR_ARCADE],
  [/XzMXIty8kr4/, GO_TUTOR_VISION_TV],
  [/Ylrroy1fJAE/, GO_TUTOR_VISION_TV2],
];
const TUTOR_RE =
  /https?:\/\/(?:www\.)?(?:youtu\.be\/[A-Za-z0-9_-]{6,}[^\s),\"']*|youtube\.com\/(?:watch\?[^\s),\"']*|embed\/[A-Za-z0-9_-]{6,}[^\s),\"']*|shorts\/[A-Za-z0-9_-]{6,}[^\s),\"']*))/gi;
const BARE_TUTOR_RE =
  /(?<!\/)(?:youtu\.be\/[A-Za-z0-9_-]{6,}[^\s),\"']*|(?:www\.)?youtube\.com\/(?:watch\?[^\s),\"']*|embed\/[A-Za-z0-9_-]{6,}[^\s),\"']*|shorts\/[A-Za-z0-9_-]{6,}[^\s),\"']*))/gi;

function tutorGoSlug(match: string): string | null {
  // Alight Motion ditangani pola ID-spesifik existing (jangan dobel).
  if (/8emqddsjPsE/.test(match)) return null;
  // Office fBOfOmj9Uj8 sudah kurasi manual (go/office-install) — lewati agar
  // tidak menimpa teks kurasi yang sudah pendek.
  if (/fBOfOmj9Uj8/.test(match)) return null;
  for (const [id, go] of TUTOR_IDS) if (id.test(match)) return go;
  return null;
}

function mailboxGoSlug(match: string): string {
  const lower = match.toLowerCase();
  if (lower.includes("netflix-codes.sekalipay.com/mailbox")) return GO_OTP;
  if (lower.includes("bototp.site")) return GO_OTP_BOT;
  if (lower.includes("sengare.art/check-inbox")) return GO_OTP_SENGARE;
  if (lower.includes("genjos.xoftware.my.id/mailbox")) return GO_OTP_GENJOS;
  if (lower.includes("tmail.sekalichat.com")) return GO_OTP_SEKALICHAT;
  if (lower.includes("waroengmail.com")) return GO_OTP_WAROENG;
  if (lower.includes("tmail.runcubesapps.com")) return GO_OTP_RUNCUBES;
  if (lower.includes("generator.email")) return GO_OTP_GENERATOR;
  if (lower.includes("2fa.live")) return GO_OTP_2FA;
  if (lower.includes("oliesmail.com")) return GO_MAIL_OLIES;
  if (lower.includes("fnstore.my.id")) return GO_MAIL_FNSTORE;
  if (lower.includes("losantoz.com")) return GO_MAIL_LOSANTOZ;
  // Domain resmi/tutorial umum (bukan mailbox, tapi ikut dipendekkan agar
  // PDP rapi — slug deskriptif, bukan go generik).
  if (lower.includes("docdownloader.com")) return "axvara.tech/go/doc-scribd";
  if (lower.includes("pastebin.com")) return "axvara.tech/go/netflix-solusi";
  if (lower.includes("drive.google.com")) return "axvara.tech/go/grok-error";
  if (lower.includes("support.microsoft.com")) return "axvara.tech/go/ms-family";
  if (lower.includes("app.remini.ai")) return "axvara.tech/go/remini-web";
  if (lower.includes("leonardo.ai")) return "axvara.tech/go/leonardo-web";
  if (lower.includes("blackbox.ai")) return "axvara.tech/go/blackbox-web";
  if (lower.includes("grok.com")) return "axvara.tech/go/grok-web";
  if (lower.includes("rctiplus.com/login")) return "axvara.tech/go/rcti-login";
  if (lower.includes("ibispaint.com")) return "axvara.tech/go/ibis-tutor";
  if (lower.includes("film.wetv.vip")) return "axvara.tech/go/wetv-redeem";
  if (lower.includes("dramaku.world")) return "axvara.tech/go/dramaku";
  return match;
}

function botGoSlug(match: string): string {
  const lower = match.toLowerCase();
  if (lower.includes("autoresetpwspotify_bot")) return GO_OTP_SPOTIFY;
  if (lower.includes("sekalipayviu_bot")) return GO_BOT_VIU;
  if (lower.includes("alightmotion321_bot")) return GO_BOT_ALIGHT;
  if (lower.includes("scribd_downloaderbot")) return GO_BOT_SCRIBD;
  return match;
}

export function rewriteSupplierDocsLinks(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  let out = String(raw);
  // Varian Netflix → shortlink.
  out = out.replace(SUPPLIER_DOCS_RE, (match) =>
    /tutorial-login-netflix|panduan-login-netflix/i.test(match) ? GO_NETFLIX_LOGIN : match,
  );
  out = out.replace(BARE_SUPPLIER_DOCS_RE, (match) =>
    /tutorial-login-netflix|panduan-login-netflix/i.test(match) ? GO_NETFLIX_LOGIN : match,
  );
  // Video Alight Motion supplier → shortlink (ID spesifik, query ?si= ikut).
  out = out.replace(ALIGHT_YOUTUBE_RE, GO_ALIGHT_LOGIN);
  out = out.replace(BARE_ALIGHT_YOUTUBE_RE, GO_ALIGHT_LOGIN);
  // Mailbox + domain resmi/tutorial supplier → shortlink (full + bare).
  out = out.replace(MAILBOX_RE, (match) => mailboxGoSlug(match));
  out = out.replace(BARE_MAILBOX_RE, (match) => mailboxGoSlug(match));
  // Bot Telegram supplier → shortlink.
  out = out.replace(BOT_RE, (match) => botGoSlug(match));
  // Tutorial YouTube supplier (ID audit live) → shortlink.
  out = out.replace(TUTOR_RE, (match) => tutorGoSlug(match) ?? match);
  out = out.replace(BARE_TUTOR_RE, (match) => tutorGoSlug(match) ?? match);
  return out;
}

/**
 * Fallback untuk S&K + cara aktivasi WR yang belum punya salinan Axvara:
 * isi pemasok dipertahankan utuh, hanya dirapikan (tanpa emoji/huruf besar
 * berteriak/baris ganda) dan dikelompokkan. Baris aturan di teks aktivasi
 * dipindah ke S&K agar tidak tampil dua kali.
 */
export function supplierVariantCopy(terms: string | null | undefined, deliveryTerms: string | null | undefined): VariantCopy | null {
  const termLines = cleanSupplierLines(rewriteSupplierDocsLinks(terms));
  const deliveryLines = cleanSupplierLines(rewriteSupplierDocsLinks(deliveryTerms));
  if (!termLines.length && !deliveryLines.length) return null;
  const seen = new Set(termLines.map((line) => lineKey(line.text)));
  const { groups, rules } = splitDelivery(deliveryLines, seen);
  return {
    source: "pemasok",
    sections: classifyTermLines([...termLines.map((line) => line.text), ...rules]),
    activation: groups,
    notes: [],
  };
}

// ---- Teks editor admin (S&K + cara aktivasi per varian) ----
//
// Format yang sama dengan hasil serializeVariantCopy(), jadi editor dibuka
// dengan salinan yang sedang tampil dan admin cukup mengubah seperlunya:
//   S&K       : judul "Detail paket:" / "Proses & pengiriman:" / "Aturan
//               pakai:" / "Garansi:" lalu baris "- ". Baris tanpa judul
//               dikelompokkan otomatis.
//   Aktivasi  : baris bernomor; judul baris bebas menjadi judul kelompok
//               langkah, judul "Catatan:" untuk catatan.

const SECTION_BY_HEADING: Record<string, CopySectionKind> = {
  "detail paket": "paket",
  paket: "paket",
  detail: "paket",
  "proses & pengiriman": "proses",
  "proses dan pengiriman": "proses",
  proses: "proses",
  pengiriman: "proses",
  "aturan pakai": "aturan",
  aturan: "aturan",
  garansi: "garansi",
};
const NOTE_HEADING = /^(?:catatan|note|notes|tips|info)$/i;
const ADMIN_LIST_PREFIX = /^(?:[-–—•·*▪]+\s*|\d{1,2}[.)](?![\d.])\s*)/u;

/** Batas panjang tiap kolom editor (salinan terpanjang saat ini ±1.500 karakter). */
export const VARIANT_COPY_MAX_CHARS = 4000;

/** Satu varian di editor admin (respons /api/admin/variant-copy). */
export type VariantCopyEntry = {
  variantId: number;
  label: string;
  isActive: boolean;
  wrManaged: boolean;
  status: "admin" | "axvara" | "pemasok" | "none";
  /** Ada suntingan admin, tapi WR mengubah teks sejak disimpan (suntingan dijeda). */
  adminStale: boolean;
  needsReview: boolean;
  hasOverride: boolean;
  adminTerms: string;
  adminActivation: string;
  /** Salinan otomatis (kurasi atau teks WR dirapikan) dalam format editor. */
  autoTerms: string;
  autoActivation: string;
  /** Teks asli WR saat ini, untuk pembanding. */
  supplierTerms: string;
  supplierActivation: string;
};

type AdminLine = { text: string; heading: string | null };

function adminLines(raw: string | null | undefined): AdminLine[] {
  if (!raw) return [];
  const out: AdminLine[] = [];
  for (const original of raw.split(/\r?\n/)) {
    const trimmed = original.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const listed = ADMIN_LIST_PREFIX.test(trimmed);
    const text = trimmed.replace(ADMIN_LIST_PREFIX, "").trim();
    if (!text) continue;
    out.push({ text, heading: !listed && isHeading(text) ? stripHeading(text) : null });
  }
  return out;
}

/** Salinan varian → dua teks editor admin. Kebalikan dari parseAdminVariantCopy(). */
export function serializeVariantCopy(copy: VariantCopy | null | undefined): { terms: string; activation: string } {
  if (!copy) return { terms: "", activation: "" };
  const terms = copy.sections
    .map((section) => [`${COPY_SECTION_TITLES[section.kind]}:`, ...section.items.map((item) => `- ${item}`)].join("\n"))
    .join("\n\n");
  const blocks = copy.activation.map((group) =>
    [...(group.title ? [`${group.title}:`] : []), ...group.steps.map((step, i) => `${i + 1}. ${step}`)].join("\n"),
  );
  if (copy.notes.length) blocks.push(["Catatan:", ...copy.notes.map((note) => `- ${note}`)].join("\n"));
  return { terms, activation: blocks.join("\n\n") };
}

/** Teks editor admin → salinan varian; null bila keduanya kosong. */
export function parseAdminVariantCopy(terms: string | null | undefined, activation: string | null | undefined): VariantCopy | null {
  const seen = new Set<string>();
  const fresh = (text: string) => {
    const key = lineKey(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  const buckets: Partial<Record<CopySectionKind, string[]>> = {};
  let kind: CopySectionKind | null = null;
  for (const line of adminLines(terms)) {
    if (line.heading !== null) {
      kind = SECTION_BY_HEADING[line.heading.toLowerCase()] ?? null;
      continue;
    }
    if (!fresh(line.text)) continue;
    (buckets[kind ?? classifyTermLine(line.text)] ??= []).push(line.text);
  }

  const groups: ActivationGroup[] = [];
  const notes: string[] = [];
  let inNotes = false;
  for (const line of adminLines(activation)) {
    if (line.heading !== null) {
      inNotes = NOTE_HEADING.test(line.heading);
      if (!inNotes) groups.push({ title: line.heading, steps: [] });
      continue;
    }
    if (!fresh(line.text)) continue;
    if (inNotes) notes.push(line.text);
    else {
      if (!groups.length) groups.push({ title: null, steps: [] });
      groups[groups.length - 1].steps.push(line.text);
    }
  }

  const sections = buildSections(buckets);
  const activationGroups = groups.filter((group) => group.steps.length > 0);
  if (!sections.length && !activationGroups.length && !notes.length) return null;
  return { source: "admin", sections, activation: activationGroups, notes };
}

// ---- Deskripsi produk ----

export type DescriptionBlock = { type: "p"; text: string } | { type: "list"; items: string[] };
export type ParsedDescription = {
  /** Isi sebelum judul bagian: paragraf pembuka + daftar keunggulan, urutan asli. */
  blocks: DescriptionBlock[];
  /** Bagian berjudul lain (mis. "Contoh:") — tetap tampil di kartu deskripsi. */
  sections: { title: string; items: string[] }[];
  /** Isi bagian "Syarat & Ketentuan:" — dipindah ke kartu S&K. */
  terms: string[];
  /** Isi bagian "Cara Aktivasi:" — dipindah ke blok cara aktivasi. */
  activation: string[];
};

const DESC_BULLET = /^\s*(?:[-–—•·*▪✓✔]|\p{Extended_Pictographic})/u;
const DASH_BULLET = /^\s*[-–—•·*▪]/u;
const TERMS_TITLE = /^(?:syarat|s\s*&\s*k|snk|ketentuan|penting|catatan penting)\b/i;
const ACTIVATION_TITLE = /^cara\s+(?:aktivasi|pakai|penggunaan|login|redeem|klaim)\b/i;

/**
 * Deskripsi → blok terstruktur. Konvensi (juga untuk admin produk non-WR):
 * paragraf pembuka, baris "- " untuk keunggulan, lalu baris judul
 * "Syarat & Ketentuan:" / "Cara Aktivasi:" untuk memisahkan bagian yang
 * tampil terlipat di mobile.
 */
export function parseProductDescription(raw: string | null | undefined): ParsedDescription {
  const parsed: ParsedDescription = { blocks: [], sections: [], terms: [], activation: [] };
  if (!raw || !raw.trim()) return parsed;
  let target: string[] | null = null;
  for (const original of raw.split(/\r?\n/)) {
    if (!original.trim()) continue;
    const [clean] = cleanSupplierLines(original);
    if (!clean) continue;
    const text = clean.text;
    // Judul boleh diawali emoji ("⚠️ PENTING:"), tapi tidak diawali "- ".
    if (!DASH_BULLET.test(original) && isHeading(text)) {
      const title = stripHeading(text);
      if (TERMS_TITLE.test(title)) target = parsed.terms;
      else if (ACTIVATION_TITLE.test(title)) target = parsed.activation;
      else {
        const section = { title, items: [] as string[] };
        parsed.sections.push(section);
        target = section.items;
      }
      continue;
    }
    if (target) {
      target.push(text);
      continue;
    }
    const last = parsed.blocks[parsed.blocks.length - 1];
    if (DESC_BULLET.test(original) || clean.numbered) {
      if (last?.type === "list") last.items.push(text);
      else parsed.blocks.push({ type: "list", items: [text] });
    } else {
      parsed.blocks.push({ type: "p", text });
    }
  }
  return parsed;
}

/** Paragraf pembuka saja (tanpa daftar/bagian) — untuk meta description SEO. */
export function descriptionSummary(raw: string | null | undefined): string {
  const { blocks } = parseProductDescription(raw);
  const paragraphs = blocks.filter((b): b is { type: "p"; text: string } => b.type === "p").map((b) => b.text);
  if (paragraphs.length) return paragraphs.join(" ");
  const firstList = blocks.find((b) => b.type === "list");
  return firstList && firstList.type === "list" ? firstList.items.join(", ") : "";
}

// ±46 karakter per baris teks xs di kotak deskripsi mobile (lebar 360px).
const MOBILE_CHARS_PER_LINE = 46;
const MOBILE_VISIBLE_LINES = 6;

/** Perkiraan tinggi deskripsi di mobile melebihi area yang terlihat saat dilipat. */
export function isLongDescription(parsed: ParsedDescription): boolean {
  const lines = (text: string) => Math.max(1, Math.ceil(text.length / MOBILE_CHARS_PER_LINE));
  const estimate = parsed.blocks.reduce((n, b) => n + (b.type === "p" ? lines(b.text) : b.items.reduce((m, item) => m + lines(item), 0)), 0)
    + parsed.sections.reduce((n, s) => n + 1 + s.items.reduce((m, item) => m + lines(item), 0), 0);
  return estimate > MOBILE_VISIBLE_LINES;
}

function toActivationGroups(lines: readonly string[]): ActivationGroup[] {
  return lines.length ? [{ title: null, steps: [...lines] }] : [];
}

/**
 * Gabungkan salinan varian (WR) dengan bagian S&K/aktivasi dari deskripsi
 * (produk non-WR, atau override admin). Tiap baris tampil sekali saja.
 */
export function mergeProductCopy(variantCopy: VariantCopy | null | undefined, description: ParsedDescription): {
  sections: CopySection[];
  activation: ActivationGroup[];
  notes: string[];
  fromVariant: boolean;
} {
  const seen = new Set<string>();
  const keep = (item: string) => {
    const key = lineKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const buckets: Partial<Record<CopySectionKind, string[]>> = {};
  for (const section of variantCopy?.sections ?? []) {
    for (const item of section.items) if (keep(item)) (buckets[section.kind] ??= []).push(item);
  }
  for (const section of classifyTermLines(description.terms)) {
    for (const item of section.items) if (keep(item)) (buckets[section.kind] ??= []).push(item);
  }
  const variantActivation = (variantCopy?.activation ?? [])
    .map((group) => ({ title: group.title, steps: group.steps.filter(keep) }))
    .filter((group) => group.steps.length > 0);
  const descActivation = description.activation.filter(keep);
  const notes = (variantCopy?.notes ?? []).filter(keep);
  const activation = variantActivation.length ? variantActivation : toActivationGroups(descActivation);
  if (variantActivation.length) notes.push(...descActivation);
  return {
    sections: buildSections(buckets),
    activation,
    notes,
    fromVariant: Boolean(variantCopy?.sections.length || variantCopy?.activation.length || variantCopy?.notes.length),
  };
}
