-- AIVault bulk (grosir) pricing markup tiers per service (owner decision 2026-11-17).
ALTER TABLE aivault_products ADD COLUMN bulk_markup_tiers_json TEXT;
UPDATE aivault_products SET bulk_markup_tiers_json='[{"min_qty":5,"markup_percent":58},{"min_qty":10,"markup_percent":47},{"min_qty":50,"markup_percent":36}]' WHERE service_id='service_gemini_plus_6m';
