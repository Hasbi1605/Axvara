// Kepemilikan field produk/varian Warung Rebahan.
//
// Sinkronisasi WR menimpa harga, stok, durasi, dan garansi setiap sweep.
// Validasi harus ada di API — mendisable input di UI tidak mengikat klien lain
// (agent CMS, curl, tab lama yang masih terbuka).
//
// Revisi 2026-11-18 (keputusan owner):
//   - `name` dan `slug` produk WR dibuka untuk admin (sync hanya mengisi saat INSERT).
//   - `label` varian WR dibuka untuk admin; sync WR/SK hanya menimpa `label`
//     bila belum dikustomisasi admin (masih sama dengan nama supplier
//     sebelumnya atau NULL/kosong).
//
// Kontrak:
//   WR-owned    : harga jual, stok, durasi, garansi, deskripsi bawaan,
//                 S&K varian (terms) + cara aktivasi (delivery_terms, read-only
//                 dari wr_variants, tak bisa diedit admin). PDP menampilkan
//                 versi Axvara dari src/lib/product-copy/curated.ts selama
//                 teks WR masih sama dengan saat dikurasi (sidik jari);
//                 bila WR mengubahnya, teks WR yang dirapikan yang tampil.
//   Admin-owned : nama, slug, label varian (dipertahankan lintas sync bila
//                 berbeda dari nama supplier sebelumnya), foto, badge,
//                 sort_order, is_active, admin_description_override,
//                 (sejak migrasi 0040 berisi deskripsi versi Axvara untuk
//                 produk WR — tetap milik admin, bebas diubah/dikosongkan),
//                 S&K + cara aktivasi per varian (product_variants.admin_terms,
//                 admin_activation, admin_copy_fingerprint — migrasi 0041,
//                 hanya ditulis PUT /api/admin/variant-copy; tampil selama
//                 teks WR belum berubah sejak disimpan),
//                 HARGA CORET (compare_price/comparePrice) — milik admin agar
//                 katalog bisa pasang diskon/badge seperti produk manual.
//                 Sync TIDAK PERNAH menulis coret BARU (lihat sync.ts:
//                 UPDATE/INSERT varian hanya menyentuh label/price/stock/
//                 durasi/garansi), jadi nilai admin aman lintas sweep.
//                 PENGECUALIAN 2026-10-06 (insiden Alight/Viu): harga jual baru
//                 yang menyamai/melampaui coret lama DITOLAK CHECK
//                 (compare_price > price) — tulis harga markup/sync sekaligus
//                 me-NULL-kan coret yang tak lagi valid agar harga otoritatif
//                 selalu tembus (coret valid dipertahankan).
//                 MINIMUM BELI (min_qty, migrasi 0034) — milik admin, generik
//                 per varian (GSuite = 50). Sync tidak pernah menyentuh kolom
//                 ini, jadi sengaja TIDAK masuk WR_OWNED_VARIANT_FIELDS.
//                 MODAL MANUAL (manual_cost, migrasi 0058) — milik admin per
//                 varian untuk produk manual (varian WR/SK memakai modal
//                 supplier dari wr_variants/sk_products dan mengabaikan
//                 manual_cost masuk). Sync tidak pernah menyentuh kolom ini,
//                 jadi sengaja TIDAK masuk WR_OWNED_VARIANT_FIELDS.
//   Markup      : hanya lewat panel WR (wr_variants.markup_percent/fixed).

/** Field varian yang hanya boleh ditulis oleh sync WR. */
export const WR_OWNED_VARIANT_FIELDS = [
  "price",
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
export const WR_OWNED_PRODUCT_FIELDS = ["description", "price", "stock"] as const;

export const WR_OWNERSHIP_MESSAGE =
  "Produk ini dikelola otomatis oleh Warung Rebahan. Deskripsi bawaan, harga, stok, durasi, dan garansi ikut katalog WR — ubah markup di tab Warung Rebahan. Yang tetap milik Anda: nama, slug, nama varian, foto, badge, kategori, urutan, aktif/nonaktif, harga coret, min. beli, 'Deskripsi khusus (override)', dan S&K + cara aktivasi per varian.";

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
  // Validasi API men-trim string masuk; spasi di ujung teks WR bukan perubahan.
  return (a ?? "").trim() !== (b ?? "").trim();
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
