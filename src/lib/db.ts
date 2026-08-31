// Dual DB: dev = better-sqlite3 local, prod (edge/Workers) = Cloudflare D1 via env.DB
// Edge-safe: do not import better-sqlite3 at top level.

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

function isEdge(): boolean {
  // Pages Functions / Workers: no Node fs for DB file, use D1 binding
  const env = (globalThis as unknown as Record<string, unknown>);
  return !!env.DB;
}

type D1 = {
  prepare: (sql: string) => {
    bind: (...p: unknown[]) => { all: () => Promise<{ results: unknown[]; success: boolean }>; first: () => Promise<unknown>; run: () => Promise<{ success: boolean; meta: { last_row_id: number; changes: number } }> };
    all: (...p: unknown[]) => Promise<{ results: unknown[] }>;
    first: (...p: unknown[]) => Promise<unknown>;
    run: (...p: unknown[]) => Promise<{ success: boolean }>;
  };
  exec: (sql: string) => Promise<unknown>;
  batch: (stmts: unknown[]) => Promise<unknown>;
};

function getD1(): D1 | null {
  const g = globalThis as unknown as Record<string, unknown>;
  return (g.DB as D1 | undefined) ?? null;
}

// Local Node DB — only loaded outside edge (dev). Guarded so edge bundler tree-shakes it.
let _local: unknown = null;
async function getLocalDb(): Promise<unknown> {
  if (_local) return _local;
  if (isEdge()) throw new Error("getLocalDb called on edge");
  const [{ default: Database }, fsMod, pathMod] = await Promise.all([
    import("better-sqlite3") as unknown as Promise<{ default: new (p:string)=> unknown }>,
    import("fs") as unknown as Promise<typeof import("fs")>,
    import("path") as unknown as Promise<typeof import("path")>,
  ]);
  const { readFileSync, existsSync, mkdirSync } = fsMod;
  const { join } = pathMod;
  const DB_PATH = process.env.DATABASE_URL || join(process.cwd(), "data", "axvara.db");
  const dir = join(DB_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const isNew = !existsSync(DB_PATH);
  const db = new (Database as unknown as new (path:string)=> { pragma:(s:string)=>void; exec:(s:string)=>void; prepare:(s:string)=>unknown }) (DB_PATH);
  (db as { pragma: (s:string)=>void }).pragma("journal_mode = WAL");
  if (isNew) {
    const sql = readFileSync(join(process.cwd(), "drizzle", "schema.sql"), "utf-8");
    (db as { exec: (s:string)=>void }).exec(sql);
  } else {
    try { (db as { exec:(s:string)=>void }).exec("ALTER TABLE products ADD COLUMN badge TEXT"); } catch {}
    try { (db as { exec:(s:string)=>void }).exec("ALTER TABLE products ADD COLUMN sold_count INTEGER DEFAULT 0"); } catch {}
    try { (db as { exec:(s:string)=>void }).exec("ALTER TABLE products ADD COLUMN images TEXT"); } catch {}
    try { (db as { exec:(s:string)=>void }).exec("ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1"); } catch {}
    try { (db as { exec:(s:string)=>void }).exec("INSERT OR IGNORE INTO categories (id,name,slug,icon,sort_order) VALUES (1,'AI Gateway','ai-gateway','⚡',1),(2,'Akun Premium','akun-premium','◆',2),(3,'Tools Pro','tools-pro','◈',3),(4,'Bundle Hemat','bundle-hemat','⬢',4)"); } catch {}
  }
  _local = db;
  return db;
}

export function getDbSync(): unknown {
  if (isEdge()) return getD1()!;
  // sync path only valid in dev after first async init; fallback to throw if not yet inited
  if (_local) return _local;
  throw new Error("DB not initialized — use async query helpers in API routes");
}

export function isD1Mode(): boolean { return isEdge(); }

export async function queryAll(sql: string, ...params: unknown[]): Promise<Record<string,unknown>[]> {
  if (isEdge()) {
    const d1 = getD1()!;
    if (params.length) {
      const res = await d1.prepare(sql).bind(...params).all();
      return (res.results as Record<string,unknown>[]) ?? [];
    }
    const res = await (d1.prepare(sql).all as unknown as () => Promise<{results:unknown[]}> )();
    return (res.results as Record<string,unknown>[]) ?? [];
  }
  const db = await getLocalDb() as { prepare: (s:string)=>{ all:(...p:unknown[])=>Record<string,unknown>[] } };
  return db.prepare(sql).all(...params) as Record<string,unknown>[];
}

export async function queryFirst(sql: string, ...params: unknown[]): Promise<Record<string,unknown> | undefined> {
  if (isEdge()) {
    const d1 = getD1()!;
    const res = await d1.prepare(sql).bind(...params).first();
    return (res as Record<string,unknown>) ?? undefined;
  }
  const db = await getLocalDb() as { prepare: (s:string)=>{ get:(...p:unknown[])=>Record<string,unknown>|undefined } };
  return db.prepare(sql).get(...params) as Record<string,unknown>|undefined;
}

export async function execRun(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid?: number; changes?: number }> {
  if (isEdge()) {
    const d1 = getD1()!;
    const res = await d1.prepare(sql).bind(...params).run();
    const r = res as unknown as { meta: { last_row_id: number; changes: number } };
    return { lastInsertRowid: r.meta?.last_row_id, changes: r.meta?.changes };
  }
  const db = await getLocalDb() as { prepare: (s:string)=>{ run:(...p:unknown[])=>{ lastInsertRowid:number; changes:number } } };
  const r = db.prepare(sql).run(...params);
  return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
}
