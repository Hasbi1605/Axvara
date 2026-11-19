import { displaySoldCountSql } from "@/lib/product-groups";
import { wrNewSaleSql } from "@/lib/warung-rebahan/new-sales";
import { getD1, queryAll } from "@/lib/db";
import { cachePublicCatalog, getCatalogRevision } from "@/lib/catalog-cache";
import { effectiveVariantStockSql, purchasableStockSql } from "@/lib/catalog-availability";
import { notLoserProductSql } from "@/lib/supplier-pairs";
import { unwrapD1 } from "@/lib/db-access";

export type TelegramCatalogProduct = {
  id: number; name: string; name_en: string | null; category_id: number | null; sort_order: number;
  sold_count: number; whatsapp_alias: string | null; aliases: string | null; price: number | null;
  stock: number;
};

type CatalogMemoEntry = {
  revision: string;
  expiresAt: number;
  items: TelegramCatalogProduct[];
};

const ISOLATE_CATALOG_TTL_MS = 10_000;
const catalogMemoByD1 = new WeakMap<object, CatalogMemoEntry>();

function edgeCachePresent(): boolean {
  try {
    return Boolean((globalThis as unknown as { caches?: { default?: unknown } }).caches?.default);
  } catch {
    return false;
  }
}

function resolveMemoD1Key(): object | null {
  try {
    const raw = typeof getD1 === "function" ? getD1() : null;
    if (!raw) return null;
    return unwrapD1(raw) as object | null;
  } catch {
    return null;
  }
}

/** Public product data only; no customer, pending action or order state.
 * Sold-out rows are kept for the existing search 'habis' fallback.
 */
export async function readTelegramCatalog(): Promise<TelegramCatalogProduct[]> {
  const hasEdgeCache = edgeCachePresent();
  const d1Key = hasEdgeCache ? resolveMemoD1Key() : null;
  if (hasEdgeCache && d1Key) {
    const memo = catalogMemoByD1.get(d1Key);
    if (memo && Date.now() < memo.expiresAt) {
      const currentRev = await getCatalogRevision("market").catch(() => null);
      if (currentRev && currentRev === memo.revision) return memo.items;
    }
  }

  const response = await cachePublicCatalog("telegram:catalog", 180, async () => {
    const rows = await queryAll(`SELECT p.id,p.name,p.name_en,p.category_id,p.sort_order,${displaySoldCountSql("p")} AS sold_count,p.whatsapp_alias,p.aliases,
      MIN(CASE WHEN pv.id IS NOT NULL AND ${purchasableStockSql("pv")} THEN pv.price END) AS price,
      CASE
        WHEN COUNT(CASE WHEN pv.id IS NOT NULL AND ${purchasableStockSql("pv")} THEN 1 END) = 0 THEN 0
        WHEN MAX(CASE WHEN pv.id IS NOT NULL AND ${purchasableStockSql("pv")} AND ${effectiveVariantStockSql("pv")} = -1 THEN 1 ELSE 0 END) = 1 THEN -1
        ELSE COALESCE(SUM(CASE WHEN pv.id IS NOT NULL AND ${purchasableStockSql("pv")} THEN ${effectiveVariantStockSql("pv")} ELSE 0 END), 0)
      END AS total_stock
      FROM products p LEFT JOIN product_variants pv ON pv.product_id=p.id AND pv.is_active=1 AND ${wrNewSaleSql("pv")}
      WHERE p.is_active=1 AND p.telegram_enabled=1 AND ${notLoserProductSql("p")}
      GROUP BY p.id ORDER BY p.sort_order ASC,p.name ASC`);
    return Response.json(rows);
  }, "market");

  const cacheHeader = response.headers?.get?.("X-Axvara-Cache") ?? null;
  const revHeader = response.headers?.get?.("X-Axvara-Catalog-Revision") ?? null;
  const rows = await response.json() as Record<string, unknown>[];
  const items = rows.map(row => ({
    id: Number(row.id), name: String(row.name), name_en: row.name_en == null ? null : String(row.name_en), category_id: row.category_id == null ? null : Number(row.category_id),
    sort_order: Number(row.sort_order || 0), sold_count: Number(row.sold_count || 0),
    whatsapp_alias: row.whatsapp_alias == null ? null : String(row.whatsapp_alias),
    aliases: row.aliases == null ? null : String(row.aliases), price: row.price == null ? null : Number(row.price),
    stock: row.total_stock == null ? (row.price == null ? 0 : -1) : Number(row.total_stock),
  }));

  if (hasEdgeCache && d1Key && cacheHeader !== "BYPASS" && revHeader) {
    catalogMemoByD1.set(d1Key, {
      revision: revHeader,
      expiresAt: Date.now() + ISOLATE_CATALOG_TTL_MS,
      items,
    });
  }
  return items;
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

function normalizeSearchText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function phoneticFold(word: string): string {
  return word
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/x/g, "ks")
    .replace(/(.)\1+/g, "$1");
}

function damerauLevenshtein(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[n][m];
}

export function parseSearchAliases(raw: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(x => String(x ?? "").trim()).filter(Boolean);
      }
    } catch { /* fall through to comma/line split */ }
  }
  return trimmed.split(/[,;\n|]+/).map(s => s.trim()).filter(Boolean);
}

function scoreSingleToken(candNorm: string, nq: string): number {
  if (!candNorm || !nq) return 0;
  if (candNorm === nq) return 100;
  const tokens = candNorm.split(" ").filter(Boolean);
  const joined = tokens.join("");
  if (joined === nq) return 95;
  if (tokens.some(t => t === nq)) return 90;
  if (candNorm.startsWith(nq)) return 85;
  if (joined.startsWith(nq) || tokens.some(t => t.startsWith(nq))) return 80;
  if (candNorm.includes(nq) || joined.includes(nq)) return 60;

  if (nq.length < 3 || nq.includes(" ")) return 0;
  const maxDist = nq.length >= 6 ? 2 : 1;
  const targets = new Set<string>([candNorm, joined, ...tokens]);
  for (let i = 0; i + 1 < tokens.length; i++) targets.add(`${tokens[i]}${tokens[i + 1]}`);
  const qFold = phoneticFold(nq);

  let bestScore = 0;
  for (const target of targets) {
    if (target.length < 3) continue;
    if (target.includes(" ") && Math.abs(target.length - nq.length) > maxDist) continue;
    const foldTarget = phoneticFold(target);
    if (foldTarget === qFold) {
      bestScore = Math.max(bestScore, 55);
      continue;
    }
    if (Math.abs(target.length - nq.length) > maxDist && Math.abs(foldTarget.length - qFold.length) > maxDist) continue;
    const rawDist = damerauLevenshtein(nq, target);
    const foldDist = damerauLevenshtein(qFold, foldTarget);
    const dist = Math.min(rawDist, foldDist);
    if (dist <= maxDist) {
      bestScore = Math.max(bestScore, dist === 0 ? 55 : dist === 1 ? 40 : 20);
    }
  }
  return bestScore;
}

export function scoreTelegramProduct(product: TelegramCatalogProduct, keyword: string): number {
  const nq = normalizeSearchText(keyword);
  if (!nq) return 0;
  const candidates = [
    product.name,
    product.name_en,
    product.whatsapp_alias,
    ...parseSearchAliases(product.aliases),
  ].filter((c): c is string => Boolean(c && c.trim()));

  const qTokens = nq.split(" ").filter(Boolean);
  let best = 0;
  for (const rawCand of candidates) {
    const candNorm = normalizeSearchText(rawCand);
    best = Math.max(best, scoreSingleToken(candNorm, nq));
    if (best >= 100) return best;
    if (qTokens.length > 1) {
      const subScores = qTokens.map(qt => scoreSingleToken(candNorm, qt));
      if (subScores.every(s => s > 0)) {
        best = Math.max(best, Math.min(58, Math.min(...subScores)));
      }
    }
  }
  return best;
}

export function searchTelegramCatalog(products: TelegramCatalogProduct[], keyword: string): TelegramCatalogProduct[] {
  const scored: { product: TelegramCatalogProduct; score: number }[] = [];
  for (const product of products) {
    const score = scoreTelegramProduct(product, keyword);
    if (score > 0) scored.push({ product, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score
      || b.product.sold_count - a.product.sold_count
      || a.product.sort_order - b.product.sort_order
      || a.product.name.localeCompare(b.product.name),
  );
  return scored.map(entry => entry.product);
}
