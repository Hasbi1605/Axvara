-- 0006: Add pending_action to telegram_users for conversational state (e.g. WA input)
ALTER TABLE telegram_users ADD COLUMN pending_action TEXT DEFAULT NULL;
