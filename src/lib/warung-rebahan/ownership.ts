// Kepemilikan field produk/varian Warung Rebahan.
//
// Sinkronisasi WR menimpa label, harga, stok, durasi, dan garansi setiap
// sweep. Sebelum ini, admin masih bisa mengedit field-field tersebut dari
// panel; hasilnya tampak tersimpan lalu hilang diam-diam pada sync berikutnya.
// Validasi harus ada di API — mendisable input di UI tidak mengikat klien lain
// (agent CMS, curl, tab lama yang masih terbuka).
//
// Kontrak:
//   WR-owned    : label varian, harga jual, stok, durasi, garansi, deskripsi,
//                 S&K varian (terms) + cara aktivasi (delivery_terms, read-only
//                 dari wr_variants — tampil di PDP, tak bisa diedit admin).
//   Admin-owned : foto, badge, sort_order, is_active, admin_description_override.
//   Markup      : hanya lewat panel WR (wr_variants.markup_percent/fixed).

/** Field varian yang hanya boleh ditulis oleh sync WR. */
export const WR_OWNED_VARIANT_FIELDS = [
  "label",
  "price",
  "compare_price",
  "comparePrice",
  "stock",
  "duration_value",
  "duration_unit",
  "duration_label",
  "warranty_type",
  "warranty_value",
  "warranty_unit",
  "warranty_label",
] as const;

/** Field produk yang hanya boleh ditulis oleh sync WR. */
export const WR_OWNED_PRODUCT_FIELDS = ["name", "slug", "description", "price", "comparePrice", "stock"] as const;

export const WR_OWNERSHIP_MESSAGE =
  "Produk ini dikelola otomatis oleh Warung Rebahan. Harga, stok, label, durasi, dan garansi ikut katalog WR — ubah markup di tab Warung Rebahan. Untuk deskripsi sendiri, isi 'Deskripsi khusus (override)'.";

type Row = Record<string, unknown> | undefined | null;

/** True bila baris produk/varian berasal dari WR dan dikelola otomatis. */
export function isWrManaged(row: Row): boolean {
  if (!row) return false;
  return Number(row.wr_auto_managed ?? 0) === 1 || String(row.source ?? "") === "warung_rebahan";
}

function changed(incoming: unknown, current: unknown): boolean {
  if (incoming === undefined) return false;
  const a = incoming === null ? null : typeof incoming === "number" ? incoming : String(incoming);
  const b = current === null || current === undefined ? null : typeof current === "number" ? current : String(current);
  if (a === null && b === null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) !== Number(b);
  return a !== b;
}

/**
 * Kembalikan nama field WR-owned pertama yang diubah request, atau null bila
 * request hanya menyentuh field milik admin. Nilai yang SAMA dengan isi
 * database bukan pelanggaran: klien admin mengirim form utuh, dan menolaknya
 * akan memblokir perubahan badge/foto yang sah.
 */
export function findWrOwnedViolation(
  incoming: Record<string, unknown>,
  current: Record<string, unknown>,
  fields: readonly string[],
): string | null {
  for (const field of fields) {
    if (!(field in incoming)) continue;
    const currentKey = field === "comparePrice" ? "compare_price" : field;
    if (changed(incoming[field], current[currentKey])) return field;
  }
  return null;
}
