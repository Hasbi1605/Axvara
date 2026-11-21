// Biaya query konservatif per entitas (lihat plan §6).
export const COST_PER_WR_PRODUCT_SYNC = 3;
export const COST_PER_WR_VARIANT_SYNC = 2;
export const COST_WR_EXCLUSION_FETCH = 1;
// Ukuran batch produk per run sync (bounded agar order tidak starvation).
// Opsi A 2026-09-14: 48 = seluruh katalog WR saat ini dalam SATU sweep.
// Cursor antar-run tetap disimpan sebagai fallback bila run terpotong.
export const WR_SYNC_PRODUCTS_PER_RUN = 48;
// Plafon tambahan khusus sync katalog (lihat raiseCeilingForCatalogSync):
// Produk baru ~15 query/produk (upsert produk + kategori + 2 varian +
// agregat + log) — jauh di atas estimasi admission konservatif. 48 × 16 +
// margin = 800. Hanya untuk sync produk.
export const WR_SYNC_CATALOG_BUDGET_EXTRA = 800;
// Generasi: bila upstream mengembalikan data yang bentuknya berubah total
// (mis. array kosong padahal sebelumnya 48 produk), sweep ditandai parsial.
export const WR_SYNC_MIN_PRODUCTS_GUARD = 1;
// Checkpoint kemajuan sweep (anti-gap-tanpa-jejak, 2026-09-20). Sweep cron
// memakan 50–116 detik sementara plafon platform ~125 detik dan deploy bisa
// me-recycle Functions kapan saja. Dulu cursor + logSync HANYA ditulis di
// ujung — run kepotong = NOL jejak + ulang dari awal + kepotong lagi (tiga
// gap misterius 19–20 Sep, fetch 200 tiap 5 mnt di log proxy sebagai bukti
// kerja terbuang). Kini cursor + penanda kemajuan disimpan tiap N produk
// (6 tulis/run — murah) sehingga run berikut MELANJUTKAN, bukan mengulang.
export const WR_SYNC_CHECKPOINT_EVERY = 8;

/** D1 menolak query dengan >100 bound parameter, jadi prefetch dipotong. */
export const PREFETCH_PARAM_CHUNK = 50;
