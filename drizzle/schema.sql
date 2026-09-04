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
  aliases TEXT DEFAULT '[]',
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
  quote_id TEXT,
  expires_at TEXT,
  sales_channel TEXT NOT NULL DEFAULT 'web'
    CHECK (sales_channel IN ('web','telegram','whatsapp')),
  telegram_chat_id TEXT,
  telegram_user_id TEXT,
  channel_conversation_id TEXT,
  channel_member_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','pending','paid','expired','failed','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (fulfillment_status IN (
      'not_required','reserved','queued','sending','delivered',
      'manual_required','retry','failed'
    )),
  variant_id INTEGER REFERENCES product_variants(id),
  variant_snapshot TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_channel
  ON orders(sales_channel, channel_conversation_id);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status, payment_status);
CREATE TABLE IF NOT EXISTS operation_guards (
  operation_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
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
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'footer',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO categories (id, name, slug, icon, sort_order) VALUES
  (1,'AI Gateway','ai-gateway','lightning-bolt',1),
  (2,'Akun Premium','akun-premium','crown',2),
  (3,'Tools Pro','tools-pro','shield',3),
  (4,'Bundle Kucing','bundle-hemat','packaging',4);

-- Seed 24 produk (idempotent)
INSERT OR IGNORE INTO products (id, category_id, name, slug, description, price, compare_price, image_url, badge, sold_count, stock, sort_order) VALUES
  (1,2,'ChatGPT Plus 1 Bulan','chatgpt-plus-1-bulan','Akses GPT-4o penuh, private account, garansi full.',89000,300000,'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=450&fit=crop','Terlaris',342,48,1),
  (2,2,'Claude Pro 1 Bulan','claude-pro-1-bulan','Anthropic Claude 3.5 Sonnet unlimited, untuk coding & writing.',95000,320000,'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=450&fit=crop','Baru',128,22,2),
  (3,1,'AI Gateway 1 Juta Token','ai-gateway-1jt-token','Gateway hemat GPT-4o, Claude, Gemini — 1 key untuk semua model.',75000,NULL,'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&h=450&fit=crop',NULL,512,999,3),
  (4,2,'Midjourney Basic 1 Bulan','midjourney-1-bulan','Generate 200+ gambar AI, fast mode, private.',110000,180000,'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=450&fit=crop',NULL,87,15,4),
  (5,3,'Canva Pro 1 Tahun','canva-pro-1-tahun','Invite team, semua template & Brand Kit premium.',45000,600000,'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop','Hemat 92%',412,60,5),
  (6,3,'CapCut Pro 1 Bulan','capcut-pro-1-bulan','No watermark, AI tools, cloud 100GB.',35000,120000,'https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop&crop=center',NULL,234,33,6),
  (7,2,'Perplexity Pro 1 Tahun','perplexity-pro-1-tahun','AI search pro, GPT-4o + Claude + Gemini.',125000,800000,'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600&h=450&fit=crop',NULL,76,18,7),
  (8,4,'Bundle Creator 3-in-1','bundle-creator-3in1','ChatGPT Plus + Canva Pro + CapCut Pro — hemat 60%.',135000,450000,'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=600&h=450&fit=crop','Bundle',189,27,8),
  (9,1,'AI Gateway 5 Juta Token','ai-gateway-5jt-token','Untuk developer & agency — 5jt token, key anti-limit.',299000,500000,'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=450&fit=crop',NULL,64,40,9),
  (10,3,'Adobe CC All Apps 1 Bulan','adobe-cc-1-bulan','Photoshop, Illustrator, Premiere — full.',150000,800000,'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=600&h=450&fit=crop',NULL,45,12,10),
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
INSERT OR IGNORE INTO payment_methods (id, label, account_number, account_name, qris_url, sort_order) VALUES
  ('qris','QRIS','', 'Brotherstore06','/qris/axvara-qris.jpg',1),
  ('ewallet','DANA / Gopay / Shopeepay','082135277434','Brotherstore06',NULL,2),
  ('seabank','SeaBank','901812349386','Brotherstore06',NULL,3);

-- Artikel & Banner CMS
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  cover_url TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  author_type TEXT DEFAULT 'admin',
  author_name TEXT,
  source_urls TEXT,
  idempotency_key TEXT,
  scheduled_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  is_published INTEGER DEFAULT 0,
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS articles_idempotency_key_unique
  ON articles(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  scopes TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS article_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id),
  actor_type TEXT NOT NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  cta_label TEXT,
  cta_href TEXT,
  is_active INTEGER DEFAULT 0,
  delay_ms INTEGER DEFAULT 1500,
  max_show_per_session INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Telegram & KlikQRIS tables (migration 0005)
CREATE TABLE IF NOT EXISTS telegram_users (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  pending_action TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing','done','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  provider TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  requested_amount INTEGER NOT NULL,
  payable_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'initializing',
  provider_signature TEXT,
  qris_url TEXT,
  direct_url TEXT,
  expires_at TEXT,
  paid_at TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_order_id),
  UNIQUE(order_code)
);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_expires ON payment_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions(order_code);
CREATE TABLE IF NOT EXISTS fulfillment_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','delivered','revoked')),
  order_code TEXT,
  reserved_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, secret_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_product_status
  ON fulfillment_inventory(product_id, status);
CREATE TABLE IF NOT EXISTS fulfillment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  variant_id INTEGER REFERENCES product_variants(id),
  inventory_id INTEGER REFERENCES fulfillment_inventory(id),
  sales_channel TEXT DEFAULT 'telegram',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','delivered','manual_required','retry','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_until TEXT,
  telegram_message_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_status ON fulfillment_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_next ON fulfillment_jobs(next_attempt_at);

-- Product Variants (migration 0007)
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,

  duration_value INTEGER,
  duration_unit TEXT CHECK (duration_unit IS NULL OR duration_unit IN ('day','month','year','lifetime','custom')),
  duration_label TEXT,

  warranty_type TEXT NOT NULL DEFAULT 'none' CHECK (warranty_type IN ('none','limited','full','custom')),
  warranty_value INTEGER,
  warranty_unit TEXT CHECK (warranty_unit IS NULL OR warranty_unit IN ('day','month','year','lifetime')),
  warranty_label TEXT,

  price INTEGER NOT NULL CHECK (price >= 0),
  compare_price INTEGER CHECK (compare_price IS NULL OR compare_price > price),
  stock INTEGER NOT NULL DEFAULT -1,

  fulfillment_mode TEXT NOT NULL DEFAULT 'manual' CHECK (fulfillment_mode IN ('manual','shared','unique')),
  shared_secret_ciphertext TEXT,
  shared_secret_iv TEXT,

  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);

-- WhatsApp sessions (migration 0007)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'fonnte',
  conversation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  selected_product_id INTEGER,
  numbered_variant_map TEXT,
  selected_variant_id INTEGER,
  variant_message_id TEXT,
  payment_message_id TEXT,
  current_order_id INTEGER,
  current_order_code TEXT,
  current_payment_transaction_id INTEGER,
  catalog_version TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, conversation_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_expiry ON whatsapp_sessions(expires_at);

-- WhatsApp inbox events (migration 0007)
CREATE TABLE IF NOT EXISTS whatsapp_inbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'fonnte',
  external_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'message',
  conversation_id TEXT,
  member_id TEXT,
  payload_hash TEXT,
  status TEXT NOT NULL DEFAULT 'processed' CHECK (status IN ('processed','failed','ignored')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, external_message_id)
);

-- WhatsApp outbox (migration 0007)
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  destination TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wa_outbox_status ON whatsapp_outbox(status, next_attempt_at);

-- Payment proofs (migration 0007)
CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  sales_channel TEXT NOT NULL DEFAULT 'whatsapp',
  conversation_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  reply_to_message_id TEXT,
  claimed_method TEXT NOT NULL CHECK (claimed_method IN ('QRIS','SEABANK','EWALLET')),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sales_channel, external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_order ON payment_proofs(order_code);
CREATE INDEX IF NOT EXISTS idx_payment_proofs_status ON payment_proofs(status);
