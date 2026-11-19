export type SupplierProductInsertOptions = {
  familyColumn: "storebat_family" | "mirai_family" | "aivault_family";
  hasDescriptionEn: boolean;
  imageExpr: string;
  whereFilter?: string;
  conflictMode: "insert_or_ignore" | "on_conflict_do_nothing";
};

/**
 * Build a single-statement CTE INSERT for supplier catalog syncs.
 * Allocates distinct category-tail `sort_order` values (+10 per new product)
 * relative to non-archived products in the same category, without modifying
 * existing products' `sort_order`.
 */
export function buildSupplierProductInsertSql(options: SupplierProductInsertOptions): string {
  const { familyColumn, hasDescriptionEn, imageExpr, whereFilter = "", conflictMode } = options;
  const insertVerb = conflictMode === "insert_or_ignore" ? "INSERT OR IGNORE INTO" : "INSERT INTO";
  const onConflictClause = conflictMode === "on_conflict_do_nothing" ? "\nWHERE 1=1\nON CONFLICT DO NOTHING" : "";
  const descriptionEnCol = hasDescriptionEn ? ",description_en" : "";
  const descriptionEnSelect = hasDescriptionEn ? ",\n    json_extract(j.value,'$.description_en') AS description_en" : "";
  const descriptionEnInsert = hasDescriptionEn ? ",\n  t.description_en" : "";

  return `WITH candidates AS (
  SELECT
    COALESCE((SELECT id FROM categories WHERE id=json_extract(j.value,'$.category')),(SELECT id FROM categories ORDER BY id LIMIT 1)) AS resolved_category_id,
    json_extract(j.value,'$.name') AS name,
    json_extract(j.value,'$.slug') AS slug,
    json_extract(j.value,'$.description') AS description${descriptionEnSelect},
    MIN(json_extract(j.value,'$.price')) AS price,
    ${imageExpr} AS image_url,
    json_extract(j.value,'$.key') AS family_key,
    MIN(CAST(j.key AS INTEGER)) AS first_idx
  FROM json_each(?) j
  ${whereFilter}
  GROUP BY json_extract(j.value,'$.key')
),
to_insert AS (
  SELECT
    c.*,
    ROW_NUMBER() OVER (PARTITION BY c.resolved_category_id ORDER BY c.first_idx ASC) AS slot_rank
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.${familyColumn} = c.family_key OR p.slug = c.slug
  )
)
${insertVerb} products(category_id,name,slug,description${descriptionEnCol},price,image_url,stock,is_active,sort_order,source,fulfillment_mode,telegram_enabled,${familyColumn})
SELECT
  t.resolved_category_id,
  t.name,
  t.slug,
  t.description${descriptionEnInsert},
  t.price,
  t.image_url,
  0,
  0,
  MAX(0, COALESCE((SELECT MAX(p.sort_order) FROM products p WHERE p.archived_at IS NULL AND p.category_id IS t.resolved_category_id), 0)) + (t.slot_rank * 10),
  'manual',
  'manual',
  1,
  t.family_key
FROM to_insert t${onConflictClause}`;
}
