// src/lib/pedia/supplier-descriptions.ts — Ingest deskripsi resmi ProviderSMM
// (PSMM-P3, 2026-11-12; revisi review-1).
//
// Sumber TETAP: https://providersmm.id/services.
//
// Batas keras:
// - Hanya satu origin+path allowlist, https saja, tanpa redirect ke host lain.
// - Timeout 15 dtk, batas byte ~3 MiB (content-length ditolak lebih dulu,
//   stream dibatalkan bila melewati batas).
// - Parser native `HTMLRewriter` (global workerd) — tanpa jsdom/dependency baru.
// - SETIAP baris layanan (td ber-ID) dicatat dengan status eksplisit, terpisah
//   dari deskripsi non-kosong. Validasi kelengkapan memakai jumlah baris, bukan
//   jumlah deskripsi (karena sebagian layanan memang tanpa deskripsi).
// - ID dibaca utuh dari atribut (`getAttribute`), bukan per potongan teks.
//   Identitas di-reset per baris (`tr`), ID duplikat/tidak sah menolak snapshot.
// - Teks > 3000 karakter ditandai `oversize` dan TIDAK dipotong: pemotongan
//   diam-diam bisa membuang syarat penting di ujung deskripsi.

export const DESCRIPTIONS_SOURCE_URL = "https://providersmm.id/services";
export const DESCRIPTIONS_MAX_BYTES = 3 * 1024 * 1024;
export const DESCRIPTIONS_TIMEOUT_MS = 15_000;
/** Batas field per baris; konsisten dengan batas copy layanan (3000). */
export const DESCRIPTION_MAX_CHARS = 3000;

export type DescriptionStatus = "ok" | "empty" | "oversize";
export type DescriptionEntry = { status: "ok"; text: string } | { status: "empty" | "oversize"; text: string };

export type ParsedDescriptions = {
  /** Semua service_id yang muncul sebagai baris katalog (valid, unik). */
  ids: Set<number>;
  entries: Map<number, DescriptionEntry>;
};

export type DescriptionFetch =
  | { ok: true; parsed: ParsedDescriptions; fetchedAt: string }
  | { ok: false; error: "not_supported" | "http" | "too_large" | "redirect" | "timeout" | "unreadable" | "empty" | "count_mismatch" | "duplicate_id" | "invalid_id" };

/** Minimal HTMLRewriter surface yang dipakai (workerd global, bukan import). */
type Element = { getAttribute: (name: string) => string | null; append: (t: string) => void };
type RewriterHandler = { element?: (el: Element) => void; text?: (t: { text: string; lastInTextNode?: boolean }) => void };
type Rewriter = { on: (selector: string, handler: RewriterHandler) => Rewriter; transform: (r: Response) => Response };
type RewriterCtor = new () => Rewriter;

function rewriter(): RewriterCtor | null {
  const g = globalThis as unknown as { HTMLRewriter?: RewriterCtor };
  return typeof g.HTMLRewriter === "function" ? g.HTMLRewriter : null;
}

/**
 * Ekstrak baris layanan + deskripsi per service_id.
 * Urutan dokumen: `tr` → `td[data-filter-table-service-id]` → … → `div.desc-content`.
 * Identitas di-reset di setiap `tr` agar deskripsi baris tanpa ID tidak
 * ditempelkan ke baris sebelumnya.
 */
export async function parseSupplierDescriptions(html: string | Response): Promise<ParsedDescriptions> {
  const Ctor = rewriter();
  if (!Ctor) throw new Error("htmlrewriter_unavailable");
  const ids = new Set<number>();
  const rawText = new Map<number, string>();
  const seen = new Set<number>();
  let duplicate = false;
  let invalid = false;
  let currentId: number | null = null;

  const rw = new Ctor()
    .on("tr", { element() { currentId = null; } })
    .on("td[data-filter-table-service-id]", {
      element(el) {
        const attr = el.getAttribute("data-filter-table-service-id");
        const id = Number(String(attr ?? "").trim());
        if (!Number.isSafeInteger(id) || id <= 0) { invalid = true; currentId = null; return; }
        if (seen.has(id)) { duplicate = true; currentId = null; return; }
        seen.add(id);
        ids.add(id);
        currentId = id;
        rawText.set(id, "");
      },
    })
    .on("div.desc-content", {
      text(t) {
        if (currentId == null) return;
        if (t.text) rawText.set(currentId, (rawText.get(currentId) ?? "") + t.text);
      },
    })
    .on("div.desc-content br", {
      element() { if (currentId != null) rawText.set(currentId, (rawText.get(currentId) ?? "") + "\n"); },
    });

  const response = typeof html === "string"
    ? new Response(html, { headers: { "content-type": "text/html; charset=UTF-8" } })
    : html;
  await rw.transform(response).text();

  if (duplicate) throw new Error("duplicate_id");
  if (invalid) throw new Error("invalid_id");
  const entries = new Map<number, DescriptionEntry>();
  for (const id of ids) {
    const text = normalizeDescription(rawText.get(id) ?? "");
    if (!text) entries.set(id, { status: "empty", text: "" });
    else if (text.length > DESCRIPTION_MAX_CHARS) entries.set(id, { status: "oversize", text });
    else entries.set(id, { status: "ok", text });
  }
  return { ids, entries };
}

/** `br` → newline, rapikan spasi, buang baris kosong berlebih (TANPA memotong). */
export function normalizeDescription(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SUPPLIER_CONTACT_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|discord\.gg|prnt\.sc|prntscr\.com|providersmm\.(?:id|com))\S*/gi;

/**
 * Sanitasi teks resmi untuk tampilan pembeli.
 * - Buang tautan kontak/promosi supplier (Telegram/WhatsApp/screenshot
 *   provider/domain supplier) yang tidak dibutuhkan pembeli.
 * - Pertahankan contoh URL target (instagram/youtube/dll.) karena dibutuhkan
 *   pembeli untuk format pesanan.
 * - Neutralkan ajakan menghubungi admin/CS supplier. Atribusi penyedia
 *   dinetralkan lebih lanjut oleh `whiteLabel()` di jalur render.
 */
export function sanitizeSupplierDescription(raw: string): string {
  let text = String(raw ?? "").replace(SUPPLIER_CONTACT_RE, "");
  text = text
    .replace(/\b(?:admin|cs|contact|kontak|hubungi)\b[^\n]{0,60}?(?:supplier|penyedia|providersmm|kami)\b/gi, "")
    .replace(/(?:supplier|penyedia|providersmm)\s+(?:kami|kita)\b/gi, "");
  return normalizeDescription(text);
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const length = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > cap) throw new Error("too_large");
  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > cap) throw new Error("too_large");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error("too_large"); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(merged);
}

/**
 * Ambil + parse deskripsi resmi sekali. `expectedCount` = jumlah layanan valid
 * dari katalog; validasi memakai JUMLAH BARIS (bukan non-kosong). Selisih >5%
 * (min 5) = snapshot tidak lengkap → gagal, last-good dipertahankan pemanggil.
 */
export async function fetchSupplierDescriptions(expectedCount: number): Promise<DescriptionFetch> {
  if (!rewriter()) return { ok: false, error: "not_supported" };
  let res: Response;
  try {
    res = await fetch(DESCRIPTIONS_SOURCE_URL, {
      redirect: "manual",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(DESCRIPTIONS_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "timeout" };
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return { ok: false, error: "redirect" };
  if (!res.ok) return { ok: false, error: "http" };
  let html: string;
  try {
    html = await readCapped(res, DESCRIPTIONS_MAX_BYTES);
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message === "too_large" ? "too_large" : "unreadable" };
  }
  let parsed: ParsedDescriptions;
  try {
    parsed = await parseSupplierDescriptions(html);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return { ok: false, error: message === "duplicate_id" || message === "invalid_id" ? message : "unreadable" };
  }
  if (parsed.ids.size === 0) return { ok: false, error: "empty" };
  if (expectedCount > 0) {
    const diff = Math.abs(parsed.ids.size - expectedCount);
    if (diff > Math.max(5, Math.floor(expectedCount * 0.05))) return { ok: false, error: "count_mismatch" };
  }
  return { ok: true, parsed, fetchedAt: new Date().toISOString() };
}
