-- 0011_store_settings.sql — editable storefront identity and support details

CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('store_name', 'AXVARA'),
  ('tagline', 'Toko akun premium, AI gateway, dan tools pro.'),
  ('whatsapp_number', '089519388264'),
  ('support_hours', '09.00–23.00 WIB'),
  ('footer_text', 'AXVARA adalah third-party independen, tidak terafiliasi dengan brand manapun.'),
  ('logo_url', '');
