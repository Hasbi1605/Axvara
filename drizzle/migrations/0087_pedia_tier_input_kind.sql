-- 0087_pedia_tier_input_kind.sql — Komentar custom Pedia (2026-11-01).
-- input_kind='comments': pembeli menulis komentar (1 per baris), layanan supplier
-- wajib bertipe 'Custom Comments'. NULL = cukup link (perilaku lama).

ALTER TABLE pedia_tiers ADD COLUMN input_kind TEXT CHECK (input_kind IS NULL OR input_kind IN ('comments'));
