import type { DatabaseAccess } from "@/lib/db-access";
import { fetchStorebatBuff, fetchStorebatProducts, parseStorebatBuff, parseStorebatProducts, record } from "./client";

export const STOREBAT_SYNC_KEY = "storebat_catalog_sync_at";
export const STOREBAT_CATALOG_MIN_INTERVAL_MS = 45_000;
export const STOREBAT_ETAG_KEY = "storebat_catalog_etag";
export const STOREBAT_LEASE_KEY = "storebat_catalog_lease";
export const storebatLeaseGuard = `INSERT INTO operation_guards(operation_id,valid) SELECT ?,EXISTS(
  SELECT 1 FROM store_settings WHERE key='${STOREBAT_LEASE_KEY}' AND value=? AND json_extract(value,'$.until')>unixepoch('now')*1000)`;

export async function syncStorebatCatalog(db: DatabaseAccess, lease: string, now: number, etag: string | null) {
  if (!db.d1) return { error: "database_unavailable" } as const;
  const response = await fetchStorebatProducts(etag);
  if (response.kind === "not_modified") return { unchanged: true } as const;
  if (response.kind !== "ok") return { error: response.kind === "http_error" ? `products_http_${response.status}` : `products_${response.kind}` } as const;
  const rows = parseStorebatProducts(response.json);
  if (!rows?.some(row => !row.excluded)) return { error: "invalid_or_empty_catalog" } as const;
  const payload = response.json;
  const advertised = record(payload) && Array.isArray(payload.services) ? payload.services.find(s => record(s) && s.service === "muse_buff") : undefined;
  let buff = advertised === undefined ? null : parseStorebatBuff(advertised);
  if (advertised !== undefined && buff === null) return { error: "invalid_buff_catalog" } as const;
  if (advertised === undefined && !(record(payload) && Array.isArray(payload.services))) {
    // Ponytail: the normal feed carries Muse in the same ETag; probe only for servers omitting services.
    const result = await fetchStorebatBuff();
    const data = result.kind === "ok" ? result.json : null;
    if (!record(data) || data.success !== true || typeof data.available !== "boolean") return { error: "buff_catalog_unavailable" } as const;
    if (data.available && !(buff = parseStorebatBuff(data.service))) return { error: "invalid_buff_catalog" } as const;
  }
  if (!db.canSpend(Math.ceil(rows.length / 50) + 15)) return { error: "catalog_budget_exceeded" } as const;
  const d1 = db.d1, guard = crypto.randomUUID();
  const batch = [d1.prepare(storebatLeaseGuard).bind(guard,lease)];
  const at = new Date(now).toISOString();
  const fields = ["id", "name", "description", "price_usd", "standard_price_usd", "pricing_type", "price_tiers_json", "warranty_days", "delivery_type", "stock", "image_url", "api_test"];
  for (let i = 0; i < rows.length; i += 50) {
    const values = rows.slice(i,i+50).map(p => ({ ...p, price_tiers_json: JSON.stringify(p.price_tiers), api_test: Number(p.excluded) }));
    batch.push(d1.prepare(`INSERT INTO storebat_products(${fields.join(",")},last_seen_at)
      SELECT ${fields.map(f => `json_extract(value,'$.${f}')`).join(",")},? FROM json_each(?) WHERE true
      ON CONFLICT(id) DO UPDATE SET ${fields.slice(1).map(f => `${f}=excluded.${f}`).join(",")},last_seen_at=excluded.last_seen_at,disappeared=0,updated_at=datetime('now')`).bind(at,JSON.stringify(values)));
  }
  // Use the seen set rather than a timestamp equality; force sync may have the same timestamp.
  batch.push(d1.prepare(`UPDATE storebat_products SET stock=0,disappeared=1,updated_at=datetime('now') WHERE disappeared=0 AND id NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(rows.map(r=>r.id))));
  batch.push(buff === null ? d1.prepare("UPDATE storebat_services SET available=0,updated_at=datetime('now') WHERE service='muse_buff' AND available=1") :
    d1.prepare(`INSERT INTO storebat_services(service,price_per_billion) VALUES('muse_buff',?) ON CONFLICT(service) DO UPDATE SET price_per_billion=excluded.price_per_billion,available=1,updated_at=datetime('now') WHERE price_per_billion IS NOT excluded.price_per_billion OR available=0`).bind(buff));
  batch.push(d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guard));
  await d1.batch(batch);
  return { fetched: rows.length, etag: response.etag ?? "" } as const;
}
