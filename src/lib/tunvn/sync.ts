// src/lib/tunvn/sync.ts — sinkron katalog mirror TERSEMBUNYI TUNVN.
//
// Mirror dipanggil publikasi admin dan cron tunvn_catalog. Proyeksi Market
// ada di catalog.ts; sinkron mirror tidak mengaktifkan produk/varian.
//
// Anggaran D1 mengikuti pola Games (chunk json_each, bukan 1 statement/baris)
// dan klaim throttle CAS di store_settings mencegah dua isolate menumpuk.

import type { DatabaseAccess } from "@/lib/db-access";
import { fetchTunvnProducts, isTunvnSyncEnabled, type TunvnProduct } from "./client";

export const TUNVN_CATALOG_SETTING_KEY = "tunvn_catalog_sync_at";
// Cron is every 1 minute; a 45-second floor tolerates normal scheduling jitter.
export const TUNVN_CATALOG_MIN_INTERVAL_MS = 45_000;
const CHUNK = 50;
const DESCRIPTION_MAX = 2_000;
const NAME_MAX = 300;

export type TunvnCatalogSyncResult =
  | { skipped: "not_configured" | "throttled" | "claimed_elsewhere" }
  | { ok: false; error: string; detail?: string }
  | { ok: true; fetched: number; upserted: number; deactivated: number; invalid: number; usdt_vnd: number | null };

export async function syncTunvnCatalog(
  db: DatabaseAccess,
  opts: { now?: number; force?: boolean; reserveStatements?: number } = {},
): Promise<TunvnCatalogSyncResult> {
  if (!isTunvnSyncEnabled()) return { skipped: "not_configured" };
  const now = opts.now ?? Date.now();

  const prev = await db.queryFirst("SELECT value FROM store_settings WHERE key=?", TUNVN_CATALOG_SETTING_KEY);
  const prevValue = prev ? String(prev.value ?? "") : null;
  const last = prevValue === null ? NaN : Number(prevValue);
  if (!opts.force && Number.isFinite(last) && now - last >= 0 && now - last < TUNVN_CATALOG_MIN_INTERVAL_MS) {
    return { skipped: "throttled" };
  }
  const claim = prevValue === null
    ? await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(key) DO NOTHING", TUNVN_CATALOG_SETTING_KEY, String(now))
    : await db.execRun("UPDATE store_settings SET value=?, updated_at=datetime('now') WHERE key=? AND value=?", String(now), TUNVN_CATALOG_SETTING_KEY, prevValue);
  if (claim.changes !== 1) return { skipped: "claimed_elsewhere" };

  const listed = await fetchTunvnProducts();
  if (listed.kind !== "ok") {
    const detail = listed.kind === "api_error" ? listed.detail
      : listed.kind === "http_error" ? `http_${listed.status}` : listed.reason;
    return { ok: false, error: `products_${listed.kind}`, detail: detail.slice(0, 200) };
  }
  // Daftar kosong = kemungkinan salah akun/gangguan, bukan "semua hilang".
  if (listed.items.length === 0) return { ok: false, error: "empty_tunvn_catalog" };
  if (listed.invalid > 0) return { ok: false, error: "invalid_tunvn_catalog" };
  // ponytail: full mirror must fit40 statements; add chunk continuation if it grows.
  if (!db.canSpend(Math.ceil(listed.items.length / CHUNK) + 1 + (opts.reserveStatements ?? 0))) {
    return { ok: false, error: "catalog_budget_exceeded" };
  }

  const syncedAt = new Date(now).toISOString();
  const rows = listed.items.map((p: TunvnProduct) => ({
    sid: p.supplier_product_id,
    name: p.name.slice(0, NAME_MAX),
    desc: p.description.slice(0, DESCRIPTION_MAX),
    vnd: p.price_vnd,
    usdt: p.price_usdt,
    stock: p.stock,
    dthr: p.discount_threshold,
    dvnd: p.discount_price_vnd,
    duthr: p.discount_threshold_usdt,
    dusdt: p.discount_price_usdt,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.execRun(UPSERT_SQL, syncedAt, syncedAt, JSON.stringify(chunk));
    upserted += chunk.length;
  }

  // Baris yang pernah disinkron tetapi absen pada run penuh ini dianggap
  // hilang dari katalog upstream: stok nol + tetap tersembunyi (bukan hapus,
  // agar integrasi masa depan masih punya jejak harga terakhir).
  const gone = await db.execRun(
    `UPDATE tunvn_products SET stock=0, visible=0, updated_at=datetime('now')
      WHERE synced_at IS NOT NULL AND synced_at < ? AND stock<>0`,
    syncedAt,
  );

  return {
    ok: true,
    fetched: listed.items.length,
    upserted,
    deactivated: Number(gone.changes ?? 0),
    invalid: listed.invalid,
    usdt_vnd: listed.usdt_vnd,
  };
}

// visible TIDAK PERNAH ditulis di sini selain literal 0 pada INSERT; cabang
// UPDATE tidak menyentuh visible sehingga nilai admin masa depan pun tidak
// diturunkan/dinaikkan oleh sync.
const UPSERT_SQL = `INSERT INTO tunvn_products
  (supplier_product_id, name, description, price_vnd, price_usdt, stock,
   discount_threshold, discount_price_vnd, discount_threshold_usdt, discount_price_usdt,
   visible, synced_at, updated_at)
SELECT json_extract(value,'$.sid'), json_extract(value,'$.name'), json_extract(value,'$.desc'),
  json_extract(value,'$.vnd'), json_extract(value,'$.usdt'), json_extract(value,'$.stock'),
  json_extract(value,'$.dthr'), json_extract(value,'$.dvnd'), json_extract(value,'$.duthr'),
  json_extract(value,'$.dusdt'), 0, ?, ?
FROM json_each(?) WHERE true
ON CONFLICT(supplier_product_id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  price_vnd = excluded.price_vnd,
  price_usdt = excluded.price_usdt,
  stock = excluded.stock,
  discount_threshold = excluded.discount_threshold,
  discount_price_vnd = excluded.discount_price_vnd,
  discount_threshold_usdt = excluded.discount_threshold_usdt,
  discount_price_usdt = excluded.discount_price_usdt,
  synced_at = excluded.synced_at,
  updated_at = excluded.updated_at`;
