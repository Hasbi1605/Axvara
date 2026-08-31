-- AXVARA D1 Schema — lihat docs/ARCHITECTURE.md
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  compare_price INTEGER,
  image_url TEXT,
  images TEXT,
  stock INTEGER DEFAULT -1,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  customer_email TEXT,
  items TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_account TEXT,
  proof_url TEXT,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  account_number TEXT,
  account_name TEXT,
  qris_url TEXT,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO categories (name, slug, icon, sort_order) VALUES
  ('AI Gateway','ai-gateway','⚡',1),
  ('Akun Premium','akun-premium','◆',2),
  ('Tools Pro','tools-pro','◈',3),
  ('Bundle Hemat','bundle-hemat','⬢',4);
INSERT OR IGNORE INTO payment_methods (id, label, account_number, account_name, sort_order) VALUES
  ('qris','QRIS','', 'Brotherstore06', 1),
  ('ewallet','DANA / Gopay / Shopeepay','082135277434','Brotherstore06',2),
  ('seabank','SeaBank','901812349386','Brotherstore06',3);
