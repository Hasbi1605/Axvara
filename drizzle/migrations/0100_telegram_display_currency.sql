-- 0100_telegram_display_currency.sql — TG1 onboarding (LOCAL ONLY).
--
-- Adds TG display-currency column next to W3 locale (0095). Nullable = unset;
-- seeded ONCE from language choice (id->IDR, en->USD) only if still unset.
-- Later currency changes never touch locale and vice versa. Existing orders
-- and locale values untouched.
ALTER TABLE telegram_users ADD COLUMN display_currency TEXT CHECK (display_currency IN ('IDR','USD'));
