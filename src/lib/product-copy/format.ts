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
 * Fallback untuk S&K + cara aktivasi WR yang belum punya salinan Axvara:
 * isi pemasok dipertahankan utuh, hanya dirapikan (tanpa emoji/huruf besar
 * berteriak/baris ganda) dan dikelompokkan. Baris aturan di teks aktivasi
 * dipindah ke S&K agar tidak tampil dua kali.
 */
export function supplierVariantCopy(terms: string | null | undefined, deliveryTerms: string | null | undefined): VariantCopy | null {
  const termLines = cleanSupplierLines(terms);
  const deliveryLines = cleanSupplierLines(deliveryTerms);
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
