-- Ikon kategori kini disimpan eksplisit (tidak diturunkan dari slug) dan email
-- langganan footer tersedia untuk panel admin.
UPDATE categories SET icon = 'lightning-bolt' WHERE slug = 'ai-gateway';
UPDATE categories SET icon = 'crown' WHERE slug = 'akun-premium';
UPDATE categories SET icon = 'shield' WHERE slug = 'tools-pro';
UPDATE categories SET name = 'Bundle Kucing', icon = 'packaging' WHERE slug IN ('bundle-hemat', 'bundle-kucing');

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'footer',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
