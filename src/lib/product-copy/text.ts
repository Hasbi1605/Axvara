// src/lib/product-copy/text.ts — Pembersih teks pemasok + sidik jari S&K +
// autolink.
//
// Modul murni tanpa import: dipakai server (resolver salinan Axvara, render
// artikel) DAN browser (parser deskripsi PDP, RichText), jadi tidak boleh
// menarik data kurasi, komponen React, atau lucide-react. Pelajaran
// 2026-10-03: halaman artikel (server component) mengimpor linkifySegments
// dari ProductCopy.tsx ("use client" + lucide-react) → 500 di edge Pages
// walau `next build` hijau. Sejak itu autolink tinggal di sini.

// Zero-width, penanda arah (mis. U+200E di "klaim trial ‎Upcloud"), BOM,
// variation selector, dan keycap.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\uFE0E\uFE0F\u20E3]/g;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;
const BULLET_PREFIX = /^(?:[-–—•·*▪►▶→>✓✔✗✘]+\s*|\d{1,2}[.)](?![\d.])\s*)/u;
const NUMBERED_PREFIX = /^\s*(?:\d{1,2}[.)](?![\d.])|[①-⑳])/u;

// Dipulihkan setelah baris BERTERIAK diturunkan ke huruf kecil.
const ACRONYMS = [
  "PIN", "OTP", "VPN", "HD", "UHD", "4K", "TV", "PC", "VCC", "API", "AI", "WA",
  "IP", "QR", "URL", "PDF", "OS", "VIP", "SMS", "MFA", "IDE", "SSL", "VPS", "RAM",
  "GB", "TB", "iOS", "AWS", "GPT", "USD",
];
const ACRONYM_RE = new RegExp(
  `(^|[^\\p{L}\\p{N}])(${ACRONYMS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^\\p{L}\\p{N}])`,
  "giu",
);
const ACRONYM_CANON = new Map(ACRONYMS.map((a) => [a.toLowerCase(), a]));

export type CleanLine = { text: string; numbered: boolean };

function stripDecoration(line: string): string {
  return line.normalize("NFKC").replace(INVISIBLE, "").replace(PICTOGRAPHIC, " ");
}

function isShouting(line: string): boolean {
  const letters = line.match(/\p{L}/gu) ?? [];
  if (letters.length < 6) return false;
  const upper = letters.filter((ch) => ch !== ch.toLowerCase()).length;
  return upper / letters.length >= 0.7;
}

function capitalizeFirst(line: string): string {
  // Baris yang diawali angka ("25 - 30 hari") dibiarkan.
  const match = /^([^\p{L}\p{N}]*)(\p{L}+)/u.exec(line);
  if (!match) return line;
  const word = match[2];
  // "iOS", "iQIYI", "eBook": kata dengan huruf besar di tengah dibiarkan.
  if (word !== word.toLowerCase()) return line;
  return match[1] + word.charAt(0).toUpperCase() + line.slice(match[1].length + 1);
}

/** Turunkan baris HURUF BESAR ke kalimat biasa tanpa merusak akronim. */
export function deshout(line: string): string {
  if (!isShouting(line)) return line;
  const lowered = line
    .toLowerCase()
    .replace(/([.!?]\s+)(\p{L})/gu, (_m, gap: string, ch: string) => gap + ch.toUpperCase())
    .replace(ACRONYM_RE, (_m, pre: string, word: string) => pre + (ACRONYM_CANON.get(word.toLowerCase()) ?? word));
  return capitalizeFirst(lowered);
}

function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Baris teks pemasok yang layak tampil: tanpa emoji/penanda tak terlihat,
 * tanpa bullet/nomor mentah, tanpa huruf besar berteriak, tanpa baris ganda.
 * `numbered` mencatat apakah baris aslinya bernomor (petunjuk langkah).
 */
export function cleanSupplierLines(raw: string | null | undefined): CleanLine[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: CleanLine[] = [];
  for (const original of raw.split(/\r?\n/)) {
    const decorated = stripDecoration(original);
    const numbered = NUMBERED_PREFIX.test(decorated);
    let text = decorated.replace(/\s+/g, " ").trim();
    text = text.replace(BULLET_PREFIX, "").trim();
    text = text.replace(/([!?.])\1+/g, "$1").replace(/\s+([!?.,:;])/g, "$1");
    text = capitalizeFirst(deshout(text));
    const key = dedupeKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, numbered });
  }
  return out;
}

function fingerprintLines(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split(/\r?\n/)
    .map((line) => dedupeKey(stripDecoration(line)))
    .filter(Boolean)
    .join("\n");
}

// cyrb53 (domain publik): hash 53-bit sinkron, sama di workerd, Node, browser.
function cyrb53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Sidik jari PASANGAN S&K + cara aktivasi pemasok. Kebal terhadap perubahan
 * kosmetik (huruf besar, emoji, tanda baca, spasi), tapi berubah bila ada
 * kata/angka yang berubah — saat itu salinan Axvara lama tidak dipakai lagi.
 */
export function supplierFingerprint(terms: string | null | undefined, deliveryTerms: string | null | undefined): string {
  const a = fingerprintLines(terms);
  const b = fingerprintLines(deliveryTerms);
  if (!a && !b) return "";
  return cyrb53(`${a}\n\u0001\n${b}`).toString(36);
}

// ---- Autolink (2026-10-03, permintaan owner) ----

/** Satu segmen teks: string polos atau link yang aman diklik. */
export type RichSegment = { text: string; href: null } | { text: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
// Bare domain tanpa skema (netflix-codes.sekalipay.com/mailbox,
// www.netflix.com/clearcookies, oliesmail.com) + handle bot Telegram
// (@sekalipayviu_bot). Email (user@mail.com) SENGAJA bukan link — itu kredensial.
const BARE_RE = /(?:www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"')\]]*|[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}(?:\/[^\s<>"')\]]*)?|@[a-z0-9_]{4,}_?bot)\b/gi;

function normalizeHref(raw: string): string | null {
  let text = raw.trim().replace(/[.,;:!?)\]]+$/, "");
  if (!text) return null;
  if (text.startsWith("@")) return `https://t.me/${text.slice(1)}`;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

/**
 * Pecah teks menjadi segmen polos + link. Murni (tanpa DOM/React): aman dipakai
 * server (render artikel edge) maupun client (RichText PDP), dan hasilnya
 * dirender sebagai React node oleh pemanggil — tidak ada HTML mentah dari
 * teks supplier yang lolos ke halaman.
 */
export function linkifySegments(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  const pushText = (chunk: string) => {
    if (chunk) out.push({ text: chunk, href: null });
  };
  let rest = text;
  while (rest) {
    URL_RE.lastIndex = 0;
    BARE_RE.lastIndex = 0;
    const urlMatch = URL_RE.exec(rest);
    const bareMatch = BARE_RE.exec(rest);
    // Bare-domain tidak boleh makan ekor URL berskema ("https://youtu.be/x"
    // mengandung "youtu.be/x" sebagai kandidat bare — pilih yang berskema).
    let match: RegExpExecArray | null = null;
    let isUrl = false;
    if (urlMatch && bareMatch) {
      if (bareMatch.index >= urlMatch.index && bareMatch.index < urlMatch.index + urlMatch[0].length) {
        match = urlMatch;
        isUrl = true;
      } else if (urlMatch.index <= bareMatch.index) {
        match = urlMatch;
        isUrl = true;
      } else {
        match = bareMatch;
      }
    } else if (urlMatch) {
      match = urlMatch;
      isUrl = true;
    } else if (bareMatch) {
      match = bareMatch;
    }
    if (!match) {
      pushText(rest);
      break;
    }
    // Kandidat bare yang menempel di tengah kata/email (user@mail.com,
    // "masukkanemail") bukan link.
    if (!isUrl) {
      const before = rest[match.index - 1];
      if (before && /[a-z0-9_@]/i.test(before)) {
        pushText(rest.slice(0, match.index + match[0].length));
        rest = rest.slice(match.index + match[0].length);
        continue;
      }
    }
    const href = normalizeHref(match[0]);
    if (!href) {
      pushText(rest.slice(0, match.index + match[0].length));
      rest = rest.slice(match.index + match[0].length);
      continue;
    }
    pushText(rest.slice(0, match.index));
    // Teks tampil = tulisan supplier apa adanya (tanpa tanda baca ekor).
    const display = match[0].trim().replace(/[.,;:!?)\]]+$/, "");
    out.push({ text: display, href });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}
