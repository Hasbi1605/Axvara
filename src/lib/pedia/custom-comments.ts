// src/lib/pedia/custom-comments.ts — Komentar custom Pedia (2026-11-01).
// Pembeli menulis satu komentar per baris; jumlah pesanan = jumlah baris.
// Dikirim ke supplier sebagai field `comments` (dipisah baris baru) oleh dispatch.
// Batas dijaga kecil agar quote terenkripsi + body order tetap di bawah 32 KB.
export const CUSTOM_COMMENT_MAX_LINES = 200;
export const CUSTOM_COMMENT_MAX_CHARS = 300;
export const CUSTOM_COMMENT_MAX_TOTAL = 8000;

export type CustomCommentCheck = { ok: true; lines: string[] } | { ok: false; error: string; lines: string[] };

export function parseCustomComments(raw: string): string[] {
  return String(raw ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).filter(Boolean);
}

/** Validasi teks komentar terhadap jumlah pesanan. Pesan sama untuk client dan server. */
export function checkCustomComments(raw: string, quantity: number | null): CustomCommentCheck {
  const lines = parseCustomComments(raw);
  if (!lines.length) return { ok: false, error: "Tulis komentar, satu komentar per baris.", lines };
  if (String(raw).length > CUSTOM_COMMENT_MAX_TOTAL) return { ok: false, error: `Total komentar maksimal ${CUSTOM_COMMENT_MAX_TOTAL.toLocaleString("id-ID")} karakter.`, lines };
  if (lines.length > CUSTOM_COMMENT_MAX_LINES) return { ok: false, error: `Maksimal ${CUSTOM_COMMENT_MAX_LINES} komentar per pesanan.`, lines };
  const long = lines.findIndex((l) => l.length > CUSTOM_COMMENT_MAX_CHARS);
  if (long >= 0) return { ok: false, error: `Komentar baris ${long + 1} terlalu panjang (maksimal ${CUSTOM_COMMENT_MAX_CHARS} karakter).`, lines };
  if (quantity != null && lines.length !== quantity) return { ok: false, error: `Jumlah komentar (${lines.length}) harus sama dengan jumlah pesanan (${quantity}).`, lines };
  return { ok: true, lines };
}

/** Tipe layanan supplier yang cocok dengan tier: komentar custom wajib tipe
 *  "Custom Comments", selain itu "Default". Mencegah komentar terkirim ke layanan
 *  yang mengabaikannya, atau layanan custom dipesan tanpa komentar. */
export function pediaServiceTypeFor(inputKind: unknown): "Default" | "Custom Comments" {
  return inputKind === "comments" ? "Custom Comments" : "Default";
}
/** SQL: `s` = pedia_supplier_services, `t` = pedia_tiers. */
export const PEDIA_SERVICE_TYPE_SQL = `s.type=(CASE WHEN t.input_kind='comments' THEN 'Custom Comments' ELSE 'Default' END)`;
