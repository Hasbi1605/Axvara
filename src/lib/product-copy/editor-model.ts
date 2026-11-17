// src/lib/product-copy/editor-model.ts — Model editor S&K + deskripsi murni.
//
// Mengonversi teks tersimpan (heading format admin / deskripsi produk) menjadi
// daftar baris per bagian untuk textarea polos di CopyEditorSheet, serta
// menyusunnya kembali tanpa sintaks heading yang harus diketik admin.
import type { Locale } from "@/lib/i18n/locale";
import {
  COPY_SECTION_ORDER,
  classifyTermLines,
  copySectionTitles,
  parseAdminVariantCopy,
  parseProductDescription,
  type CopySectionKind,
} from "./format";
import { cleanSupplierLines } from "./text";

export type AdminCopyModel = {
  paket: string[];
  proses: string[];
  aturan: string[];
  garansi: string[];
  /** Langkah aktivasi; judul kelompok tetap ditulis sebagai baris berakhiran `:`. */
  activation: string[];
  notes: string[];
};

export type DescriptionCopyModel = {
  body: string;
  paket: string[];
  proses: string[];
  aturan: string[];
  garansi: string[];
  activation: string[];
};

const LIST_PREFIX_RE = /^(?:[-–—•·*▪]+\s*|\d{1,2}[.)](?![\d.])\s*)/u;
const DASH_BULLET_RE = /^\s*[-–—•·*▪]/u;
const NOTE_HEADING_RE = /^(?:catatan|note|notes|tips|info)$/i;
const TERMS_TITLE_RE = /^(?:syarat|s\s*&\s*k|snk|ketentuan|penting|catatan penting|terms(?:\s*(?:&|and)\s*conditions)?|important(?:\s*notes?)?)\b/i;
const ACTIVATION_TITLE_RE = /^(?:cara\s+(?:aktivasi|pakai|penggunaan|login|redeem|klaim)|how\s+to\s+(?:activate|use|claim|redeem|log\s*in|login))\b/i;

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function cleanItemLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const cleaned = normalizeLine(raw).replace(LIST_PREFIX_RE, "").trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function isHeadingLine(text: string): boolean {
  return text.length <= 48 && /:$/.test(text);
}

function stripHeadingColon(text: string): string {
  return text.replace(/\s*:$/, "").trim();
}

export function emptyAdminCopyModel(): AdminCopyModel {
  return { paket: [], proses: [], aturan: [], garansi: [], activation: [], notes: [] };
}

/** Pecah S&K + cara aktivasi tersimpan ke daftar baris per bagian untuk editor. */
export function splitAdminCopy(
  terms: string | null | undefined,
  activation: string | null | undefined,
): AdminCopyModel {
  const model = emptyAdminCopyModel();
  const parsed = parseAdminVariantCopy(terms, activation);
  if (!parsed) return model;

  for (const section of parsed.sections) {
    model[section.kind] = [...section.items];
  }
  for (const group of parsed.activation) {
    if (group.title) model.activation.push(`${group.title}:`);
    model.activation.push(...group.steps);
  }
  model.notes = [...parsed.notes];
  return model;
}

/** Susun model editor menjadi `{ terms, activation }` berformat heading standar. */
export function composeAdminCopy(
  model: AdminCopyModel,
  locale: Locale = "id",
): { terms: string; activation: string } {
  const titles = copySectionTitles(locale);
  const termBlocks: string[] = [];
  for (const kind of COPY_SECTION_ORDER) {
    const items = cleanItemLines(model[kind]);
    if (items.length > 0) {
      termBlocks.push([`${titles[kind]}:`, ...items.map((item) => `- ${item}`)].join("\n"));
    }
  }

  const groups: { title: string | null; steps: string[] }[] = [];
  const extraNotes: string[] = [];
  let inNotes = false;

  for (const raw of model.activation) {
    const trimmed = normalizeLine(raw);
    if (!trimmed) continue;
    const listed = LIST_PREFIX_RE.test(trimmed);
    const text = trimmed.replace(LIST_PREFIX_RE, "").trim();
    if (!text) continue;
    if (!listed && isHeadingLine(text)) {
      const heading = stripHeadingColon(text);
      inNotes = NOTE_HEADING_RE.test(heading);
      if (!inNotes) groups.push({ title: heading, steps: [] });
      continue;
    }
    if (inNotes) {
      extraNotes.push(text);
    } else {
      if (!groups.length) groups.push({ title: null, steps: [] });
      groups[groups.length - 1].steps.push(text);
    }
  }

  const activationBlocks = groups
    .filter((group) => group.steps.length > 0)
    .map((group) =>
      [...(group.title ? [`${group.title}:`] : []), ...group.steps.map((step, idx) => `${idx + 1}. ${step}`)].join("\n"),
    );

  const notes = [...cleanItemLines(model.notes), ...extraNotes];
  if (notes.length > 0) {
    const notesHeading = locale === "en" ? "Notes:" : "Catatan:";
    activationBlocks.push([notesHeading, ...notes.map((note) => `- ${note}`)].join("\n"));
  }

  return {
    terms: termBlocks.join("\n\n"),
    activation: activationBlocks.join("\n\n"),
  };
}

/** Pecah deskripsi produk menjadi isi deskripsi + S&K umum + langkah aktivasi. */
export function splitDescription(desc: string | null | undefined): DescriptionCopyModel {
  const raw = (desc ?? "").replace(/\r\n?/g, "\n");
  const bodyLines: string[] = [];
  let mode: "body" | "terms" | "activation" = "body";

  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      if (mode === "body") bodyLines.push("");
      continue;
    }
    const [clean] = cleanSupplierLines(line);
    if (clean && !DASH_BULLET_RE.test(line) && isHeadingLine(clean.text)) {
      const title = stripHeadingColon(clean.text);
      if (TERMS_TITLE_RE.test(title)) {
        mode = "terms";
        continue;
      }
      if (ACTIVATION_TITLE_RE.test(title)) {
        mode = "activation";
        continue;
      }
      mode = "body";
    }
    if (mode === "body") bodyLines.push(line);
  }

  const body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const parsed = parseProductDescription(raw);
  const buckets: Record<CopySectionKind, string[]> = { paket: [], proses: [], aturan: [], garansi: [] };
  for (const section of classifyTermLines(parsed.terms)) {
    buckets[section.kind] = [...section.items];
  }

  return {
    body,
    paket: buckets.paket,
    proses: buckets.proses,
    aturan: buckets.aturan,
    garansi: buckets.garansi,
    activation: [...parsed.activation],
  };
}

/** Susun kembali isi deskripsi + S&K umum + cara aktivasi untuk disimpan di form produk. */
export function composeDescription(model: DescriptionCopyModel, locale: Locale = "id"): string {
  const parts: string[] = [];
  const body = model.body.replace(/\r\n?/g, "\n").trim();
  if (body) parts.push(body);

  const termItems = COPY_SECTION_ORDER.flatMap((kind) => cleanItemLines(model[kind]));
  if (termItems.length > 0) {
    const termsHeading = locale === "en" ? "Terms & Conditions:" : "Syarat & Ketentuan:";
    parts.push([termsHeading, ...termItems.map((item) => `- ${item}`)].join("\n"));
  }

  const steps = cleanItemLines(model.activation);
  if (steps.length > 0) {
    const activationHeading = locale === "en" ? "How to Activate:" : "Cara Aktivasi:";
    parts.push([activationHeading, ...steps.map((step, idx) => `${idx + 1}. ${step}`)].join("\n"));
  }

  return parts.join("\n\n");
}

/** Ringkasan singkat S&K tingkat produk untuk baris "Berlaku untuk semua varian". */
export function summarizeDescriptionCopy(model: Pick<DescriptionCopyModel, "paket" | "proses" | "aturan" | "garansi" | "activation">): string {
  const termsCount = model.paket.length + model.proses.length + model.aturan.length + model.garansi.length;
  const stepsCount = model.activation.length;
  if (termsCount > 0 && stepsCount > 0) return `${termsCount} aturan · ${stepsCount} langkah`;
  if (termsCount > 0) return `${termsCount} aturan`;
  if (stepsCount > 0) return `${stepsCount} langkah`;
  return "";
}

/** Label varian yang bisa dibedakan (WR sering memakai label sama, mis. "Premium" 28 & 90 hari). */
export function variantCopyTitle(variant: { label: string; sku: string; duration_label?: string | null }): string {
  const label = variant.label.trim() || variant.sku;
  const duration = variant.duration_label?.trim();
  return duration && !label.toLowerCase().includes(duration.toLowerCase()) ? `${label} · ${duration}` : label;
}
