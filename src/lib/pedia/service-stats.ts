// src/lib/pedia/service-stats.ts — Kesehatan layanan IndoSMM (2026-11-01).
//
// Sumber: alat publik "Rekomendasi Layanan by AI" IndoSMM
// (ai.indosmm.web.id/api/analysis, tanpa login/API key). Data 7 hari per
// layanan: jumlah order, success/cancel/refill rate dan AI score. Bukan API
// resmi; format bisa berubah, jadi parse defensif dan gagal tanpa menulis.
// Disegarkan maks 1×/jam dari cron lite `pedia_orders` dalam satu statement
// (json_each), hanya untuk layanan yang dirujuk tier Pedia. avg_time berasal
// dari snapshot Daftar Layanan (migrasi 0085) dan tidak ditimpa di sini.
import type { createDatabaseAccess } from "@/lib/db-access";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

type Db = ReturnType<typeof createDatabaseAccess>;
export const PEDIA_STATS_URL = "https://ai.indosmm.web.id/api/analysis?period=168&minOrders=3";
const KEY = "pedia_service_stats_refreshed_at";
const pct = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; };

export type PediaServiceHealth = "sehat" | "cukup" | "berisiko" | "belum_ada_data";

/** Badge kesehatan dari data 7 hari (sama dengan audit kurasi 2026-11-01). */
export function pediaServiceHealth(s: { orders_7d?: unknown; success_rate?: unknown; cancel_rate?: unknown; ai_score?: unknown } | null | undefined): PediaServiceHealth {
  const orders = Number(s?.orders_7d) || 0;
  if (!s || orders <= 0 || s.success_rate == null) return "belum_ada_data";
  const success = Number(s.success_rate), cancel = Number(s.cancel_rate ?? 100), score = Number(s.ai_score ?? 0);
  if (orders >= 10 && success >= 95 && cancel <= 5 && score >= 80) return "sehat";
  if (success >= 85 && score >= 65) return "cukup";
  return "berisiko";
}

export function parsePediaStats(payload: unknown): { analyzedAt: string; rows: [number, number, number | null, number | null, number | null, number | null][] } | null {
  const data = payload as { services?: unknown; analyzedAt?: unknown; periodHours?: unknown };
  if (!data || !Array.isArray(data.services) || typeof data.analyzedAt !== "string" || Number(data.periodHours) !== 168) return null;
  const rows: [number, number, number | null, number | null, number | null, number | null][] = [];
  for (const raw of data.services.slice(0, 5000)) {
    const s = raw as Record<string, unknown>;
    const id = Number(s.id), orders = Number(s.orderCount);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(orders) || orders < 0) continue;
    const score = Number(s.aiScore);
    rows.push([id, orders, pct(s.successRate), pct(s.cancelRate), pct(s.refillRate), Number.isFinite(score) ? Math.round(score) : null]);
  }
  return rows.length ? { analyzedAt: data.analyzedAt.slice(0, 40), rows } : null;
}

/** Segarkan statistik bila sudah lewat 1 jam. Mengembalikan jumlah layanan diperbarui, atau alasan dilewati. */
export async function refreshPediaServiceStats(db: Db, fetcher: typeof fetchWithTimeout = fetchWithTimeout): Promise<number | "not_due" | "unavailable"> {
  const last = await db.queryFirst(`SELECT 1 AS due FROM store_settings WHERE key=? AND datetime(value) > datetime('now','-1 hour')`, KEY);
  if (last) return "not_due";
  // Klaim jendela dahulu agar sumber tidak dipanggil tiap tick saat gagal.
  await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,datetime('now'),datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, KEY);
  let parsed: ReturnType<typeof parsePediaStats> = null;
  try {
    const res = await fetcher(PEDIA_STATS_URL, { headers: { accept: "application/json" }, redirect: "manual" }, 15_000);
    if (res.ok) parsed = parsePediaStats(await res.json());
  } catch { parsed = null; }
  if (!parsed) return "unavailable";
  const result = await db.execRun(
    `INSERT INTO pedia_service_stats(supplier,service_id,orders_7d,success_rate,cancel_rate,refill_rate,ai_score,period_hours,analyzed_at,updated_at)
     SELECT 'indosmm', CAST(json_extract(j.value,'$[0]') AS INTEGER), json_extract(j.value,'$[1]'), json_extract(j.value,'$[2]'),
            json_extract(j.value,'$[3]'), json_extract(j.value,'$[4]'), json_extract(j.value,'$[5]'), 168, ?, datetime('now')
       FROM json_each(?) j
      WHERE CAST(json_extract(j.value,'$[0]') AS INTEGER) IN (SELECT supplier_service_id FROM pedia_tiers WHERE supplier='indosmm')
     ON CONFLICT(supplier,service_id) DO UPDATE SET orders_7d=excluded.orders_7d, success_rate=excluded.success_rate,
       cancel_rate=excluded.cancel_rate, refill_rate=excluded.refill_rate, ai_score=excluded.ai_score,
       period_hours=excluded.period_hours, analyzed_at=excluded.analyzed_at, updated_at=excluded.updated_at`,
    parsed.analyzedAt, JSON.stringify(parsed.rows),
  );
  return Number(result.changes) || 0;
}
