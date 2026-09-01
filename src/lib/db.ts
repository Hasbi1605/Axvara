// Edge-safe DB — prod: D1 binding, dev: in-memory seed from products.ts
// No fs / better-sqlite3 imports — fully edge-compatible for @cloudflare/next-on-pages.

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
  is_active: number | null;
  sort_order: number | null;
};

type D1 = {
  prepare: (sql: string) => {
    bind: (...p: unknown[]) => {
      all: () => Promise<{ results: unknown[] }>;
      first: () => Promise<unknown>;
      run: () => Promise<{ meta: { last_row_id: number; changes: number } }>;
    };
    all: () => Promise<{ results: unknown[] }>;
  };
};

function getD1(): D1 | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const env = process.env as unknown as Record<string, unknown>;
  return (g.DB as D1 | undefined) ?? (env.DB as D1 | undefined) ?? null;
}

// ---- In-memory fallback (dev without D1) ----
import { products as seedProducts } from "@/lib/products";
type Row = Record<string, unknown>;

function getSharedMem(): Row[] {
  const g = globalThis as unknown as { __AXVARA_MEM?: Row[] };
  if (g.__AXVARA_MEM) return g.__AXVARA_MEM;
  const catMap: Record<string, number> = {
    "ai-gateway": 1, "akun-premium": 2, "tools-pro": 3, "bundle-hemat": 4,
  };
  const rows: Row[] = seedProducts.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    compare_price: (p.comparePrice ?? null) as unknown,
    image_url: p.image,
    images: JSON.stringify(p.images ?? [p.image]),
    badge: p.badge ?? null,
    sold_count: p.soldCount ?? 0,
    stock: p.stock ?? -1,
    is_active: p.isActive === false ? 0 : 1,
    sort_order: p.sortOrder ?? i + 1,
    category_id: catMap[p.categorySlug] ?? 3,
    cat_slug: p.categorySlug,
  }));
  g.__AXVARA_MEM = rows;
  return rows;
}

// ---- Public API ----

export function getDbSync(): unknown {
  const d1 = getD1();
  if (d1) return d1;
  throw new Error("DB not initialized — use async query helpers");
}
export function isD1Mode(): boolean { return !!getD1(); }

export async function queryAll(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  const d1 = getD1();
  if (d1) {
    if (params.length) return ((await d1.prepare(sql).bind(...params).all()).results as Row[]) ?? [];
    return ((await d1.prepare(sql).all()).results as Row[]) ?? [];
  }
  // Dev fallback: in-memory
  const lower = sql.toLowerCase();
  if (lower.includes("from categories")) {
    return [
      { id: 1, slug: "ai-gateway", name: "AI Gateway" },
      { id: 2, slug: "akun-premium", name: "Akun Premium" },
      { id: 3, slug: "tools-pro", name: "Tools Pro" },
      { id: 4, slug: "bundle-hemat", name: "Bundle Hemat" },
    ];
  }
  if (lower.includes("from products")) {
    let rows = [...getSharedMem()];
    if (lower.includes("is_active=1")) rows = rows.filter((r) => (r.is_active as number) !== 0);
    if (lower.includes("c.slug=?") && params.length) {
      rows = rows.filter((r) => r.cat_slug === String(params[0]));
      params = params.slice(1);
    }
    if (lower.includes("like ?")) {
      const q = String((params as string[])[0] ?? "").replace(/%/g, "").toLowerCase();
      if (q) rows = rows.filter((r) => `${r.name} ${r.slug} ${r.badge ?? ""} ${r.description ?? ""}`.toLowerCase().includes(q));
    }
    rows.sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
    return rows;
  }
  return [];
}

export async function queryFirst(sql: string, ...params: unknown[]): Promise<Row | undefined> {
  const d1 = getD1();
  if (d1) return (await d1.prepare(sql).bind(...params).first()) as Row | undefined;
  const lower = sql.toLowerCase();
  if (lower.includes("from categories where slug=?")) {
    const map: Record<string, Row> = {
      "ai-gateway": { id: 1 }, "akun-premium": { id: 2 },
      "tools-pro": { id: 3 }, "bundle-hemat": { id: 4 },
    };
    return map[String(params[0])];
  }
  if (lower.includes("from products") && lower.includes("where") && lower.includes("id=?")) {
    const id = String(params[0]);
    const row = getSharedMem().find((r) => String(r.id) === id);
    if (row && lower.includes("select id from")) return { id: row.id };
    return row;
  }
  return undefined;
}

export async function execRun(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid?: number; changes?: number }> {
  const d1 = getD1();
  if (d1) {
    const r = await d1.prepare(sql).bind(...params).run();
    return {
      lastInsertRowid: (r as unknown as { meta: { last_row_id: number } }).meta?.last_row_id,
      changes: (r as unknown as { meta: { changes: number } }).meta?.changes,
    };
  }
  const lower = sql.toLowerCase();
  if (lower.startsWith("update products set")) {
    const id = String(params[params.length - 1]);
    const row = getSharedMem().find((r) => String(r.id) === id);
    if (!row) return { changes: 0 };
    if (lower.includes("is_active=?")) row.is_active = Number(params[0]) ? 1 : 0;
    return { changes: 1 };
  }
  if (lower.startsWith("insert into products")) {
    const mem = getSharedMem();
    const newId = mem.length + 1;
    const [category_id, name, slug, description, price, compare_price, image_url, images, badge, sold_count, stock, is_active, sort_order] = params as unknown[];
    const slugToCat: Record<number, string> = { 1: "ai-gateway", 2: "akun-premium", 3: "tools-pro", 4: "bundle-hemat" };
    mem.push({ id: newId, category_id, name, slug, description, price, compare_price, image_url, images, badge, sold_count, stock, is_active, sort_order, cat_slug: slugToCat[category_id as number] ?? "tools-pro" });
    return { lastInsertRowid: newId, changes: 1 };
  }
  if (lower.startsWith("delete from products")) {
    const delId = String(params[0]);
    const mem = getSharedMem();
    const idx = mem.findIndex((r) => String(r.id) === delId);
    if (idx >= 0) { mem.splice(idx, 1); return { changes: 1 }; }
    return { changes: 0 };
  }
  return { changes: 0 };
}
