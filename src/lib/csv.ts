// src/lib/csv.ts — Sanitasi formula spreadsheet untuk ekspor CSV admin.
//
// Nilai dari pembeli (nama, WA, email, nama produk, dsb.) tidak boleh
// ditafsirkan sebagai formula saat CSV dibuka di Excel/Sheets/LibreOffice.
// Quoting (`"..."`) TIDAK cukup — sel `"=cmd|...` tetap dievaluasi.
//
// Aturan (praktik OWASP CSV Injection):
// - Setelah membuang whitespace/control character di depan (termasuk yang
//   bisa menyembunyikan trigger dari parser), jika karakter pertama adalah
//   `=`, `+`, `-`, atau `@`, awali sel dengan apostrof tunggal `'`. Apostrof
//   adalah escape resmi spreadsheet: sel ditampilkan tanpa apostrof dan TIDAK
//   dievaluasi sebagai formula; data asli tetap terbaca.
// - Nilai aman (huruf/angka biasa) tidak disentuh agar keterbacaan terjaga.
// - Diterapkan ke SEMUA sel termasuk header, agar perubahan header di masa
//   depan tidak membuka celah yang sama.
export function sanitizeCsvField(value: unknown): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFEFF]/g, "")
    .replace(/\r?\n/g, " ");
  const stripped = text.replace(/^[\s\u00A0\u2000-\u200B\u2028\u2029\uFEFF]+/, "");
  if (/^[=+\-@]/.test(stripped)) return `'${text}`;
  return text;
}

/** Quote satu sel CSV (RFC 4180) setelah sanitasi formula. */
export function csvCell(value: unknown): string {
  const text = sanitizeCsvField(value);
  return `"${text.replace(/"/g, '""')}"`;
}
