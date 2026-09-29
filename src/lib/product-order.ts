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
