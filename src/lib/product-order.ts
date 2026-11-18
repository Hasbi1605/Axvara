/**
 * Urutan kanonis produk yang dipakai storefront + admin.
 *
 * `sort_order` adalah KUNCI slot yang diatur admin (independen dari stok/status);
 * posisi tampil pada daftar menerapkan kategori lalu status (aktif+ready di depan,
 * aktif+habis sesudahnya, nonaktif paling belakang), lalu `sort_order`, lalu `id`.
 */
export type OrderableProduct = {
  id: string | number;
  isActive?: boolean;
  is_active?: number;
  stock?: number | null;
  sortOrder?: number | null;
  sort_order?: number | null;
  categorySlug?: string | null;
  category_id?: number | string | null;
};

export type OrderableCategory = {
  id: number | string;
  slug: string;
  name: string;
  sort_order?: number | null;
  icon?: string | null;
};

export function sortCategoriesForDisplay<T extends OrderableCategory>(categories: T[]): T[] {
  return categories.slice().sort((a, b) =>
    Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || Number(a.id) - Number(b.id));
}

export function productCategoryKey(product: OrderableProduct): string {
  return product.categorySlug ? `slug:${product.categorySlug}` : `id:${product.category_id ?? "unknown"}`;
}

/** Kategori tak dikenal/kosong tetap terlihat di kelompok terakhir. */
export function groupProductsByCategory<T extends OrderableProduct, C extends OrderableCategory>(products: T[], categories: C[]): { category: C | null; products: T[] }[] {
  const bySlug = new Map(categories.map(category => [category.slug, category]));
  const byId = new Map(categories.map(category => [String(category.id), category]));
  const groups = new Map<C | null, T[]>();
  for (const product of products) {
    const category = (product.categorySlug ? bySlug.get(product.categorySlug) : byId.get(String(product.category_id))) ?? null;
    const items = groups.get(category) ?? [];
    items.push(product);
    groups.set(category, items);
  }
  return [...sortCategoriesForDisplay(categories), null]
    .filter(category => groups.has(category))
    .map(category => ({ category, products: sortProductsForDisplay(groups.get(category)!) }));
}

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
