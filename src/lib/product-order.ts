/**
 * Urutan kanonis produk yang dipakai storefront + admin reorder.
 *
 * `sort_order` hanyalah KUNCI urut; posisi yang dilihat manusia adalah index
 * setelah aturan status diterapkan. Produk aktif+ready selalu di depan,
 * aktif+habis sesudahnya, nonaktif paling belakang. Reorder hanya boleh
 * bertukar di bucket yang sama karena nilai sort_order tidak dapat melewati
 * aturan status tersebut.
 */
export type OrderableProduct = {
  id: string | number;
  isActive?: boolean;
  is_active?: number;
  stock?: number | null;
  sortOrder?: number | null;
  sort_order?: number | null;
};

function active(product: OrderableProduct): boolean {
  if (typeof product.isActive === "boolean") return product.isActive;
  return Number((product as { is_active?: unknown }).is_active ?? 1) !== 0;
}

export function productIsSoldOut(product: OrderableProduct): boolean {
  const stock = Number((product as { stock?: unknown }).stock ?? -1);
  return Number.isFinite(stock) && stock !== -1 && stock <= 0;
}

/**
 * Produk BISA DIBELI (keputusan owner 2026-10-01): stok -1 (tak terbatas)
 * atau > 0. Cermin `productIsSoldOut` di atas — dipakai Produk Serupa PDP
 * yang hanya menerima ringkasan kartu (tanpa min_qty per varian).
 * Checkout/quote/bot tetap otoritas akhir (mereka tahu min_qty).
 */
export function productIsBuyable(product: OrderableProduct): boolean {
  return !productIsSoldOut(product);
}

export function productSortOrder(product: OrderableProduct): number {
  const value = product.sortOrder ?? product.sort_order ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function productOrderBucket(product: OrderableProduct): string {
  return `${active(product) ? "active" : "inactive"}:${productIsSoldOut(product) ? "sold" : "ready"}`;
}

export function sortProductsForDisplay<T extends OrderableProduct>(products: T[]): T[] {
  return products.slice().sort((a, b) => {
    const byActive = Number(!active(a)) - Number(!active(b));
    if (byActive !== 0) return byActive;
    const bySold = Number(productIsSoldOut(a)) - Number(productIsSoldOut(b));
    if (bySold !== 0) return bySold;
    const byOrder = productSortOrder(a) - productSortOrder(b);
    if (byOrder !== 0) return byOrder;
    return Number(a.id) - Number(b.id);
  });
}

/** Tetangga satu langkah yang benar-benar dapat dilewati oleh sort_order. */
export function adjacentReorderProduct<T extends OrderableProduct>(
  products: T[],
  productId: string | number,
  direction: -1 | 1,
): T | null {
  const ordered = sortProductsForDisplay(products);
  const index = ordered.findIndex((product) => Number(product.id) === Number(productId));
  if (!Number.isInteger(index) || index < 0) return null;
  const current = ordered[index];
  const neighbor = ordered[index + direction];
  if (!neighbor) return null;
  if (productOrderBucket(current) !== productOrderBucket(neighbor)) return null;
  return neighbor;
}

/**
 * Kunci selipan saat produk kembali ready setelah habis (2026-10-02,
 * keputusan owner: restok kembali ke sekitar posisi semula, bukan ekor).
 *
 * `restockerKey` = sort_order lama yang TIDAK PERNAH diubah siapa pun
 * (sync/cron tidak menulis kolom itu — hanya reorder + edit produk).
 * `takenKeys` = sort_order produk lain yang menempati kunci (aktif saja;
 * ready maupun habis — yang habis tidak tampil tapi key-nya tetap ditempati,
 * jadi slot tidak boleh menimpanya).
 *
 * Aturan: selipkan TEPAT DI BELAKANG jangkar = kunci terbesar yang <= kunci
 * lama. Bila tidak ada jangkar di bawah (kunci lama paling kecil) → depan
 * (kunci terkecil - 10, min 0). Tanpa kunci sama sekali → kunci lama
 * dipertahankan.
 *
 * Ini fungsi MURNI (tanpa I/O) — pemanggil (sync) yang membaca kunci lama +
 * daftar kunci, lalu menulis 1 UPDATE hanya bila hasilnya berbeda.
 */
export function reinsertionKey(restockerKey: number, takenKeys: number[]): number {
  const oldKey = Number.isFinite(Number(restockerKey)) ? Number(restockerKey) : 0;
  const keys = takenKeys
    .map(Number)
    .filter((key) => Number.isFinite(key));
  if (keys.length === 0) return oldKey;
  const below = keys.filter((key) => key <= oldKey);
  if (below.length === 0) {
    const min = Math.min(...keys);
    return Math.max(0, min - 10);
  }
  const anchor = Math.max(...below);
  // Bila tidak ada tetangga di antara jangkar dan key lama (slot lama masih
  // kosong — tidak ada produk baru yang menyerobot), pertahankan key lama:
  // pemanggil tidak perlu write sama sekali.
  const intruder = keys.some((key) => key > anchor && key < oldKey) || keys.includes(oldKey);
  if (!intruder && anchor < oldKey) return oldKey;
  // Ada penyerobot (atau slot lama ditempati): maju dari jangkar sampai slot
  // longgar — tidak pernah menimpa key tetangga yang sudah ada.
  const taken = new Set(keys);
  let slot = anchor + 1;
  while (taken.has(slot)) slot += 1;
  return slot;
}
