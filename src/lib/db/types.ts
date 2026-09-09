// Tipe bersama lapisan DB dipisah ke sini agar client, orders, dan barrel
// dapat berbagi kontrak D1 yang sama tanpa impor melingkar. PURE MOVE:
// definisi identik dengan versi lama di src/lib/db.ts — tidak ada perubahan
// perilaku, hanya pemindahan supaya modul lain lebih ringkas.

export type DbProduct = {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  compare_price: number | null;
  image_url: string | null;
  images: string | null;
  badge: string | null;
  sold_count: number | null;
  stock: number | null;
  aliases?: string | null;
  whatsapp_alias?: string | null;
  is_active: number | null;
  sort_order: number | null;
};

export type D1Result = { results?: unknown[]; meta: { last_row_id?: number; changes?: number } };
export type D1Statement = {
  bind: (...p: unknown[]) => D1Statement;
  all: () => Promise<{ results: unknown[] }>;
  first: () => Promise<unknown>;
  run: () => Promise<D1Result>;
};
export type D1 = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<D1Result[]>;
};

export type AtomicOrderItem = {
  product_id: number;
  variant_id?: number;
  name: string;
  price: number;
  qty: number;
};
