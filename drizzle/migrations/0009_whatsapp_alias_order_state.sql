-- 0009_whatsapp_alias_order_state.sql
-- Dedicated WhatsApp display labels plus repair for historical channel order state.

ALTER TABLE products ADD COLUMN whatsapp_alias TEXT;

-- Preserve the compact WhatsApp catalogue labels that were previously derived
-- in application code. New products deliberately fall back to their web name
-- until an admin fills the WhatsApp alias field.
UPDATE products
SET whatsapp_alias = CASE name
  WHEN 'ChatGPT Plus 1 Bulan' THEN 'CHATGPT'
  WHEN 'Claude Pro 1 Bulan' THEN 'CLAUDE'
  WHEN 'AI Gateway 1 Juta Token' THEN 'AI GATEWAY'
  WHEN 'AI Gateway 5 Juta Token' THEN 'AI GATEWAY'
  WHEN 'AI Gateway 10 Juta Token' THEN 'AI GATEWAY'
  WHEN 'Midjourney Basic 1 Bulan' THEN 'MIDJOURNEY'
  WHEN 'Canva Pro 1 Tahun' THEN 'CANVA'
  WHEN 'CapCut Pro 1 Bulan' THEN 'CAPCUT'
  WHEN 'Perplexity Pro 1 Tahun' THEN 'PERPLEXITY'
  WHEN 'Bundle Creator 3-in-1' THEN 'BUNDLE CREATOR'
  WHEN 'Adobe CC All Apps 1 Bulan' THEN 'ADOBE'
  WHEN 'Notion Plus 1 Tahun' THEN 'NOTION'
  WHEN 'Bundle AI Master' THEN 'BUNDLE AI MASTER'
  WHEN 'YouTube Premium 1 Bulan' THEN 'YOUTUBE'
  WHEN 'Netflix Premium 1 Bulan' THEN 'NETFLIX'
  WHEN 'Spotify Premium 1 Bulan' THEN 'SPOTIFY'
  WHEN 'Gemini Advanced 1 Bulan' THEN 'GEMINI'
  WHEN 'VPN Premium 1 Tahun' THEN 'VPN'
  WHEN 'Microsoft 365 Family 1 Tahun' THEN 'MICROSOFT 365'
  WHEN 'Figma Professional 1 Bulan' THEN 'FIGMA'
  WHEN 'Bundle Productivity' THEN 'BUNDLE PRODUCTIVITY'
  WHEN 'Bundle Streaming Hemat' THEN 'BUNDLE STREAMING'
  WHEN 'Cursor Pro 1 Bulan' THEN 'CURSOR'
  WHEN 'Grammarly Premium 1 Tahun' THEN 'GRAMMARLY'
  ELSE NULL
END
WHERE whatsapp_alias IS NULL;

-- Older expiry paths changed the order status but left payment_status pending.
-- Align both state columns so admin counters do not report stale pending orders.
UPDATE orders SET payment_status='expired', updated_at=datetime('now')
WHERE status='kadaluarsa' AND payment_status IN ('unpaid','pending');

UPDATE orders SET payment_status='failed', updated_at=datetime('now')
WHERE status='dibatalkan' AND payment_status IN ('unpaid','pending');

UPDATE orders SET payment_status='paid', updated_at=datetime('now')
WHERE status='lunas' AND payment_status!='paid';

-- The production WhatsApp bridge now runs Baileys on Heroku. Preserve any
-- active member selection created before the provider switch.
DELETE FROM whatsapp_sessions AS old
WHERE old.provider='fonnte' AND EXISTS (
  SELECT 1 FROM whatsapp_sessions AS current
  WHERE current.provider='baileys'
    AND current.conversation_id=old.conversation_id
    AND current.member_id=old.member_id
);
UPDATE whatsapp_sessions SET provider='baileys' WHERE provider='fonnte';
