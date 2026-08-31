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
  badge TEXT,
  sold_count INTEGER DEFAULT 0,
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
INSERT OR IGNORE INTO categories (id, name, slug, icon, sort_order) VALUES
  (1,'AI Gateway','ai-gateway','⚡',1),
  (2,'Akun Premium','akun-premium','◆',2),
  (3,'Tools Pro','tools-pro','◈',3),
  (4,'Bundle Hemat','bundle-hemat','⬢',4);

-- Seed 24 produk (idempotent)
INSERT OR IGNORE INTO products (id, category_id, name, slug, description, price, compare_price, image_url, badge, sold_count, stock, sort_order) VALUES
  (1,2,'ChatGPT Plus 1 Bulan','chatgpt-plus-1-bulan','Akses GPT-4o penuh, private account, garansi full.',89000,300000,'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=450&fit=crop','Terlaris',342,48,1),
  (2,2,'Claude Pro 1 Bulan','claude-pro-1-bulan','Anthropic Claude 3.5 Sonnet unlimited, untuk coding & writing.',95000,320000,'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=450&fit=crop','Baru',128,22,2),
  (3,1,'AI Gateway 1 Juta Token','ai-gateway-1jt-token','Gateway hemat GPT-4o, Claude, Gemini — 1 key untuk semua model.',75000,NULL,'https://images.unsplash.com/photo-1639322537224-f012857c7c2e?w=600&h=450&fit=crop',NULL,512,999,3),
  (4,2,'Midjourney Basic 1 Bulan','midjourney-1-bulan','Generate 200+ gambar AI, fast mode, private.',110000,180000,'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=450&fit=crop',NULL,87,15,4),
  (5,3,'Canva Pro 1 Tahun','canva-pro-1-tahun','Invite team, semua template & Brand Kit premium.',45000,600000,'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop','Hemat 92%',412,60,5),
  (6,3,'CapCut Pro 1 Bulan','capcut-pro-1-bulan','No watermark, AI tools, cloud 100GB.',35000,120000,'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop&crop=center',NULL,234,33,6),
  (7,2,'Perplexity Pro 1 Tahun','perplexity-pro-1-tahun','AI search pro, GPT-4o + Claude + Gemini.',125000,800000,'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600&h=450&fit=crop',NULL,76,18,7),
  (8,4,'Bundle Creator 3-in-1','bundle-creator-3in1','ChatGPT Plus + Canva Pro + CapCut Pro — hemat 60%.',135000,450000,'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=600&h=450&fit=crop','Bundle',189,27,8),
  (9,1,'AI Gateway 5 Juta Token','ai-gateway-5jt-token','Untuk developer & agency — 5jt token, key anti-limit.',299000,500000,'https://images.unsplash.com/photo-1639322537504-fcfecb546b11?w=600&h=450&fit=crop',NULL,64,40,9),
  (10,3,'Adobe CC All Apps 1 Bulan','adobe-cc-1-bulan','Photoshop, Illustrator, Premiere — full.',150000,800000,'https://images.unsplash.com/photo-1626785774573-6dd65b279390?w=600&h=450&fit=crop',NULL,45,12,10),
  (11,3,'Notion Plus 1 Tahun','notion-plus-1-tahun','AI blocks, unlimited upload, team 10 orang.',65000,400000,'https://images.unsplash.com/photo-1454165205744-3b78555e5572?w=600&h=450&fit=crop',NULL,92,25,11),
  (12,4,'Bundle AI Master','bundle-ai-master','GPT Plus + Claude Pro + Midjourney + Perplexity — ultimate.',299000,1200000,'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=600&h=450&fit=crop','Ultimate',58,9,12),
  (13,2,'YouTube Premium 1 Bulan','youtube-premium-1-bulan','No ads, background play, YouTube Music included.',25000,70000,'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=600&h=450&fit=crop','Hemat',267,50,13),
  (14,2,'Netflix Premium 1 Bulan','netflix-premium-1-bulan','4K UHD, 4 device, private profile.',35000,186000,'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&h=450&fit=crop',NULL,198,30,14),
  (15,2,'Spotify Premium 1 Bulan','spotify-premium-1-bulan','No ads, offline, high quality.',20000,55000,'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=600&h=450&fit=crop',NULL,312,55,15),
  (16,2,'Gemini Advanced 1 Bulan','gemini-advanced-1-bulan','Google Gemini 1.5 Pro + 2TB Drive.',89000,300000,'https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?w=600&h=450&fit=crop',NULL,71,16,16),
  (17,3,'VPN Premium 1 Tahun','vpn-premium-1-tahun','Nord/Express style, 60+ negara, no log.',99000,1200000,'https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&h=450&fit=crop',NULL,39,20,17),
  (18,3,'Microsoft 365 Family 1 Tahun','microsoft-365-1-tahun','Word, Excel, PowerPoint + 1TB OneDrive (6 user).',75000,1300000,'https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=600&h=450&fit=crop',NULL,84,28,18),
  (19,3,'Figma Professional 1 Bulan','figma-professional-1-bulan','Team library, unlimited projects, dev mode.',55000,220000,'https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=600&h=450&fit=crop',NULL,53,14,19),
  (20,1,'AI Gateway 10 Juta Token','ai-gateway-10jt-token','Enterprise — 10jt token, priority & log dashboard.',549000,900000,'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=450&fit=crop','Enterprise',22,100,20),
  (21,4,'Bundle Productivity','bundle-productivity','Notion + Microsoft 365 + VPN — kerja tanpa batas.',149000,2800000,'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=600&h=450&fit=crop',NULL,41,11,21),
  (22,4,'Bundle Streaming Hemat','bundle-streaming','YouTube Premium + Netflix + Spotify — nonton & denger puas.',65000,311000,'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&h=450&fit=crop',NULL,156,35,22),
  (23,2,'Cursor Pro 1 Bulan','cursor-pro-1-bulan','AI code editor — Tab, Chat, Composer premium.',85000,320000,'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&h=450&fit=crop',NULL,67,19,23),
  (24,3,'Grammarly Premium 1 Tahun','grammarly-premium-1-tahun','AI writing, plagiarism check, tone rewrite.',95000,1440000,'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=600&h=450&fit=crop',NULL,48,21,24);
INSERT OR IGNORE INTO payment_methods (id, label, account_number, account_name, sort_order) VALUES
  ('qris','QRIS','', 'Brotherstore06', 1),
  ('ewallet','DANA / Gopay / Shopeepay','082135277434','Brotherstore06',2),
  ('seabank','SeaBank','901812349386','Brotherstore06',3);
