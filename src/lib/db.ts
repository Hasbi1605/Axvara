import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DB_PATH = process.env.DATABASE_URL || join(process.cwd(), "data", "axvara.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = join(DB_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const isNew = !existsSync(DB_PATH);
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  if (isNew) {
    const schema = readFileSync(join(process.cwd(), "drizzle", "schema.sql"), "utf-8");
    _db.exec(schema);
  } else {
    // idempotent migrations
    try { _db.exec("ALTER TABLE products ADD COLUMN badge TEXT"); } catch {}
    try { _db.exec("ALTER TABLE products ADD COLUMN sold_count INTEGER DEFAULT 0"); } catch {}
    try { _db.exec("ALTER TABLE products ADD COLUMN images TEXT"); } catch {}
    try { _db.exec("ALTER TABLE products ADD COLUMN is_active INTEGER DEFAULT 1"); } catch {}
    // seed categories if missing
    try { _db.exec("INSERT OR IGNORE INTO categories (id,name,slug,icon,sort_order) VALUES (1,'AI Gateway','ai-gateway','⚡',1),(2,'Akun Premium','akun-premium','◆',2),(3,'Tools Pro','tools-pro','◈',3),(4,'Bundle Hemat','bundle-hemat','⬢',4)"); } catch {}
  }
  return _db;
}

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

export function mapDbProduct(row: DbProduct) {
  const images: string[] = row.images ? JSON.parse(row.images) : [];
  if (row.image_url && !images.includes(row.image_url)) images.unshift(row.image_url);
  return {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    description: row.description ?? "",
    price: row.price,
    comparePrice: row.compare_price ?? undefined,
    categorySlug: String(row.category_id === 1 ? "ai-gateway" : row.category_id === 2 ? "akun-premium" : row.category_id === 3 ? "tools-pro" : "bundle-hemat"),
    // legacy slug mapping via id fallback; proper join in API
    image: row.image_url ?? images[0] ?? "",
    images: images.slice(0, 8),
    badge: row.badge ?? undefined,
    soldCount: row.sold_count ?? 0,
    stock: row.stock ?? -1,
    isActive: row.is_active !== 0,
  };
}
