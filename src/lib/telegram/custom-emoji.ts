// src/lib/telegram/custom-emoji.ts — Dekorasi custom emoji (animasi) terpusat.
//
// Dipanggil dari `callApi` (api.ts) untuk setiap request keluar:
// - Teks/caption ber-`parse_mode: "HTML"`: emoji standar yang ada di peta
//   dibungkus `<tg-emoji emoji-id="…">😀</tg-emoji>`. Emoji di dalam tag,
//   `<code>`, `<pre>` atau `<tg-emoji>` yang sudah ada tidak disentuh.
// - Tombol inline/reply: emoji di AWAL teks tombol dipindah ke
//   `icon_custom_emoji_id` (ikon animasi di depan teks) lalu dibuang dari
//   teks agar tidak tampil dobel. Tombol yang sudah punya ikon dibiarkan.
//
// Peta kosong atau `TELEGRAM_CUSTOM_EMOJI=off` → payload tidak berubah sama
// sekali. Fallback ke emoji standar saat Telegram menolak ada di api.ts.

import { CUSTOM_EMOJI_MAP } from "./custom-emoji-map";

const VS16 = "️";
/**
 * Penanda "biarkan emoji ini statis" (U+2063 INVISIBLE SEPARATOR) tepat di
 * depan emoji. Dekorator tidak membungkus emoji itu dan penandanya dibuang.
 * Dipakai header kategori promo (owner 28 Nov 2026).
 */
export const PLAIN_EMOJI_MARK = "\u2063";

/** Batas aman jumlah custom emoji per pesan; sisanya tetap emoji standar. */
export const MAX_CUSTOM_EMOJI_PER_TEXT = 50;

export type CustomEmojiMap = Readonly<Record<string, string>>;

function stripVs(emoji: string): string {
  return emoji.split(VS16).join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledMap {
  ids: Map<string, string>;
  /** Cocok dengan emoji di peta, dengan/tanpa U+FE0F di posisi mana pun. */
  pattern: RegExp | null;
}

const compiledCache = new WeakMap<object, CompiledMap>();

function compile(map: CustomEmojiMap): CompiledMap {
  const cached = compiledCache.get(map);
  if (cached) return cached;
  const ids = new Map<string, string>();
  for (const [emoji, id] of Object.entries(map)) {
    const key = stripVs(emoji);
    if (key && typeof id === "string" && /^\d+$/.test(id)) ids.set(key, id);
  }
  const alternatives = [...ids.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) =>
      Array.from(key)
        .map((ch) => `${escapeRegExp(ch)}${VS16}?`)
        .join(""),
    );
  const compiled: CompiledMap = {
    ids,
    pattern: alternatives.length ? new RegExp(alternatives.join("|"), "gu") : null,
  };
  compiledCache.set(map, compiled);
  return compiled;
}

export function customEmojiEnabled(map: CustomEmojiMap = CUSTOM_EMOJI_MAP): boolean {
  const flag = (process.env.TELEGRAM_CUSTOM_EMOJI ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return false;
  return compile(map).ids.size > 0;
}

// Segmen yang tidak boleh diubah: tg-emoji yang sudah ada, blok code/pre,
// lalu tag HTML apa pun (atribut href dll.).
const PROTECTED_RE = /<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>|<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>|<[^>]*>/gi;

/** Bungkus emoji yang dikenal pada teks HTML dengan `<tg-emoji>`. */
export function decorateHtmlText(text: string, map: CustomEmojiMap = CUSTOM_EMOJI_MAP): string {
  const { ids, pattern } = compile(map);
  if (!pattern || !text) return text;
  let budget = MAX_CUSTOM_EMOJI_PER_TEXT;
  const replacePlain = (segment: string) =>
    segment.replace(pattern, (match, offset: number, whole: string) => {
      if (offset > 0 && whole[offset - 1] === PLAIN_EMOJI_MARK) return match;
      if (budget <= 0) return match;
      const id = ids.get(stripVs(match));
      if (!id) return match;
      budget -= 1;
      return `<tg-emoji emoji-id="${id}">${match}</tg-emoji>`;
    });

  let out = "";
  let last = 0;
  PROTECTED_RE.lastIndex = 0;
  for (let m = PROTECTED_RE.exec(text); m; m = PROTECTED_RE.exec(text)) {
    out += replacePlain(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return (out + replacePlain(text.slice(last))).split(PLAIN_EMOJI_MARK).join("");
}

interface ButtonLike {
  text: string;
  icon_custom_emoji_id?: string;
}

/**
 * Pindahkan emoji pembuka teks tombol ke `icon_custom_emoji_id`.
 * "🏠 Menu" → { text: "Menu", icon_custom_emoji_id: "…" }.
 */
export function decorateButton<B extends ButtonLike>(button: B, map: CustomEmojiMap = CUSTOM_EMOJI_MAP): B {
  const { ids, pattern } = compile(map);
  if (!pattern || !button || typeof button.text !== "string" || button.icon_custom_emoji_id) return button;
  const leading = new RegExp(`^\\s*(?:${pattern.source})`, "u").exec(button.text);
  if (!leading) return button;
  const id = ids.get(stripVs(leading[0].trim()));
  const rest = button.text.slice(leading[0].length).trim();
  if (!id || !rest) return button;
  return { ...button, text: rest, icon_custom_emoji_id: id };
}

export function decorateReplyMarkup<T>(markup: T, map: CustomEmojiMap = CUSTOM_EMOJI_MAP): T {
  if (!markup || typeof markup !== "object") return markup;
  const record = markup as Record<string, unknown>;
  for (const key of ["inline_keyboard", "keyboard"] as const) {
    const rows = record[key];
    if (Array.isArray(rows)) {
      return {
        ...record,
        [key]: rows.map((row) =>
          Array.isArray(row) ? row.map((btn) => decorateButton(btn as ButtonLike, map)) : row,
        ),
      } as T;
    }
  }
  return markup;
}

/**
 * Dekorasi body request Bot API. Mengembalikan body yang sama (identitas
 * referensi) bila tidak ada yang berubah, sehingga pemanggil bisa tahu
 * apakah fallback emoji standar diperlukan.
 */
export function applyCustomEmoji<T extends Record<string, unknown> | undefined>(
  body: T,
  map: CustomEmojiMap = CUSTOM_EMOJI_MAP,
): T {
  if (!body || !customEmojiEnabled(map)) return body;
  let changed = false;
  const next: Record<string, unknown> = { ...body };
  const isHtml = (mode: unknown) => mode === "HTML";

  for (const field of ["text", "caption"] as const) {
    const value = next[field];
    if (typeof value === "string" && isHtml(next.parse_mode)) {
      const decorated = decorateHtmlText(value, map);
      if (decorated !== value) {
        next[field] = decorated;
        changed = true;
      }
    }
  }

  const media = next.media;
  if (media && typeof media === "object" && !Array.isArray(media)) {
    const m = media as Record<string, unknown>;
    if (typeof m.caption === "string" && isHtml(m.parse_mode)) {
      const decorated = decorateHtmlText(m.caption, map);
      if (decorated !== m.caption) {
        next.media = { ...m, caption: decorated };
        changed = true;
      }
    }
  }

  if (next.reply_markup != null) {
    const decorated = decorateReplyMarkup(next.reply_markup, map);
    if (JSON.stringify(decorated) !== JSON.stringify(next.reply_markup)) {
      next.reply_markup = decorated;
      changed = true;
    }
  }

  return (changed ? next : body) as T;
}

const TG_EMOJI_TAG_RE = /<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi;

function stripMarkupIcons(markup: unknown): unknown {
  if (!markup || typeof markup !== "object") return markup;
  const record = markup as Record<string, unknown>;
  for (const key of ["inline_keyboard", "keyboard"] as const) {
    const rows = record[key];
    if (Array.isArray(rows)) {
      return {
        ...record,
        [key]: rows.map((row) =>
          Array.isArray(row)
            ? row.map((btn) => {
                if (!btn || typeof btn !== "object" || !("icon_custom_emoji_id" in btn)) return btn;
                const { icon_custom_emoji_id: _drop, ...rest } = btn as Record<string, unknown>;
                return rest;
              })
            : row,
        ),
      };
    }
  }
  return markup;
}

/** True bila body sudah memuat custom emoji (tag `<tg-emoji>` atau ikon tombol). */
export function hasCustomEmoji(body: Record<string, unknown> | undefined): boolean {
  if (!body) return false;
  return /<tg-emoji\b|"icon_custom_emoji_id"/i.test(JSON.stringify(body));
}

/**
 * Lepas SEMUA custom emoji (hasil dekorasi maupun yang dipasang langsung,
 * mis. logo produk) → emoji standar. Dipakai fallback saat Telegram menolak.
 */
export function stripCustomEmoji<T extends Record<string, unknown> | undefined>(body: T): T {
  if (!body || !hasCustomEmoji(body)) return body;
  const next: Record<string, unknown> = { ...body };
  for (const field of ["text", "caption"] as const) {
    if (typeof next[field] === "string") next[field] = (next[field] as string).replace(TG_EMOJI_TAG_RE, "$1");
  }
  const media = next.media;
  if (media && typeof media === "object" && !Array.isArray(media)) {
    const m = media as Record<string, unknown>;
    if (typeof m.caption === "string") next.media = { ...m, caption: m.caption.replace(TG_EMOJI_TAG_RE, "$1") };
  }
  if (next.reply_markup != null) next.reply_markup = stripMarkupIcons(next.reply_markup);
  return next as T;
}
