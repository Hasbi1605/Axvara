// src/lib/catalog-availability.ts — SATU definisi "varian bisa dibeli".
//
// Dipakai kartu katalog web (`/api/products`), bot Telegram, dan JSON-LD PDP
// agar ketiganya tidak pernah berbeda pendapat soal stok (2026-09-24). Aturan
// sama dengan PDP/keranjang/checkout (2026-09-20): stok tak terbatas (-1),
// atau stok ≥ minimum beli. Varian stok 3 dengan min 50 tidak bisa dibeli
// dalam jumlah berapa pun, jadi dianggap habis.
//
// Hanya kolom stok — status aktif varian tetap dicek pemanggil di JOIN.
export function purchasableStockSql(alias = "pv"): string {
  return `(${alias}.stock=-1 OR ${alias}.stock >= MAX(1, COALESCE(${alias}.min_qty, 1)))`;
}

/** Padanan JS untuk data varian yang sudah dimuat. */
export function isPurchasableStock(stock: number, minQty?: number | null): boolean {
  if (stock === -1) return true;
  return stock >= Math.max(1, Number(minQty ?? 1) || 1);
}
