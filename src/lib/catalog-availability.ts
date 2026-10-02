// src/lib/catalog-availability.ts — SATU definisi "varian bisa dibeli".
//
// Dipakai kartu katalog web (`/api/products`), bot Telegram, dan JSON-LD PDP
// agar ketiganya tidak pernah berbeda pendapat soal stok (2026-09-24). Aturan
// sama dengan PDP/keranjang/checkout (2026-09-20): stok tak terbatas (-1),
// atau stok ≥ minimum beli. Varian stok 3 dengan min 50 tidak bisa dibeli
// dalam jumlah berapa pun, jadi dianggap habis.
//
// Revisi 2026-10-02 sore (laporan owner: Head HABIS tapi Stok total 21 +
// mobile masih "Sisa 1"): varian `unique` yang unit kredensialnya habis (0)
// = TAK TERBELI di SQL juga, bukan cuma di JS. Sebelumnya SQL hanya melihat
// kolom stock — varian stock=1/available=0 tetap "buyable" sehingga:
//  - variant_stock kartu ikut menjumlah stok phantom (1+20=21),
//  - available_min_price memakai harga varian yang tak bisa dibeli,
//  - bot Telegram + llms.txt + SEO ikut menganggapnya tersedia.
// Subquery COUNT per baris pv (bukan JOIN + GROUP BY yang mengubah bentuk
// baris): murah untuk daftar katalog (~90 varian) dan konsisten dengan pola
// /api/catalog?slug= yang sudah dipakai PDP.
//
// `stock` di bawah boleh kolom mentah ATAU angka efektif;
// `inventoryAvailable` null = perilaku lama (tanpa data inventory, mis.
// komponen client yang belum menerima field baru).
//
// Hanya kolom stok — status aktif varian tetap dicek pemanggil di JOIN.
export function purchasableStockSql(alias = "pv"): string {
  return `(
    ${alias}.stock=-1
    OR (
      ${alias}.stock >= MAX(1, COALESCE(${alias}.min_qty, 1))
      AND (
        ${alias}.fulfillment_mode <> 'unique'
        OR (SELECT COUNT(*) FROM fulfillment_inventory fi
            WHERE fi.product_id = ${alias}.product_id
              AND fi.variant_id = ${alias}.id
              AND fi.status = 'available') > 0
      )
    )
  )`;
}

/** Padanan JS untuk data varian yang sudah dimuat.
 *
 * Revisi sore 2026-10-02: `inventoryAvailable` hanya berlaku untuk varian
 * `unique` (satu secret per unit). Varian manual/shared/tak-bermode TIDAK
 * punya inventory — angka 0/null dari JOIN yang tidak memfilter mode adalah
 * "tidak ada data", bukan "habis". Tanpa pengecualian ini dua pemanggil ikut
 * rusak: SEO (`isPurchasableStock(stock, min)` tanpa argumen ke-3 → null →
 * aman) tidak kena, tapi pemanggil yang meneruskan inventory_available apa
 * adanya (mis. Invite manual 20 + available 0) akan dianggap habis.
 * Signature diperluas dengan `fulfillmentMode` (opsional, default =
 * perilaku lama) agar kompatibel dengan semua pemanggil lama.
 */
export function isPurchasableStock(stock: number, minQty?: number | null, inventoryAvailable?: number | null, fulfillmentMode?: string | null): boolean {
  if (
    fulfillmentMode != null
    && String(fulfillmentMode).trim().toLowerCase() === "unique"
    && inventoryAvailable != null
    && Number(inventoryAvailable) <= 0
    && stock !== 0
  ) return false;
  if (stock === -1) return true;
  return stock >= Math.max(1, Number(minQty ?? 1) || 1);
}
