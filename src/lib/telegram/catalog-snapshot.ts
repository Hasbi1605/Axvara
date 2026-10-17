import { queryAll } from "@/lib/db";
import { cachePublicCatalog } from "@/lib/catalog-cache";
import { purchasableStockSql } from "@/lib/catalog-availability";
import { notLoserProductSql } from "@/lib/supplier-pairs";

export type TelegramCatalogProduct = {
  id: number; name: string; category_id: number | null; sort_order: number;
  sold_count: number; whatsapp_alias: string | null; aliases: string | null; price: number | null;
};

/** Public product data only; no customer, pending action or order state.
 * Sold-out rows are kept for the existing search 'habis' fallback.
 */
export async function readTelegramCatalog(): Promise<TelegramCatalogProduct[]> {
  const response = await cachePublicCatalog("telegram-catalog-v1", 30, async () => {
    const rows = await queryAll(`SELECT p.id,p.name,p.category_id,p.sort_order,p.sold_count,p.whatsapp_alias,p.aliases,
      MIN(CASE WHEN pv.id IS NOT NULL AND ${purchasableStockSql("pv")} THEN pv.price END) AS price
      FROM products p LEFT JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=1
      WHERE p.is_active=1 AND p.telegram_enabled=1 AND ${notLoserProductSql("p")}
      GROUP BY p.id ORDER BY p.sort_order ASC,p.name ASC`);
    return Response.json(rows);
  });
  const rows = await response.json() as Record<string, unknown>[];
  return rows.map(row => ({
    id: Number(row.id), name: String(row.name), category_id: row.category_id == null ? null : Number(row.category_id),
    sort_order: Number(row.sort_order || 0), sold_count: Number(row.sold_count || 0),
    whatsapp_alias: row.whatsapp_alias == null ? null : String(row.whatsapp_alias),
    aliases: row.aliases == null ? null : String(row.aliases), price: row.price == null ? null : Number(row.price),
  }));
}

/** SQL LIKE's %/_ wildcards, without a user-controlled regex/backtracking. */
export function telegramSearchMatch(value: string | null, keyword: string): boolean {
  const input = Array.from((value ?? "").toLowerCase());
  const pattern = Array.from(`%${keyword.trim().toLowerCase()}%`);
  let i = 0, j = 0, star = -1, matched = 0;
  while (i < input.length) {
    if (j < pattern.length && (pattern[j] === "_" || pattern[j] === input[i])) { i++; j++; }
    else if (pattern[j] === "%") { star = j++; matched = i; }
    else if (star >= 0) { j = star + 1; i = ++matched; }
    else return false;
  }
  while (pattern[j] === "%") j++;
  return j === pattern.length;
}
