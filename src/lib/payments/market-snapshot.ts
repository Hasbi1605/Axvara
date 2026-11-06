// Pembaca snapshot pasar crypto: kurs USD/IDR otomatis + katalog koin (LOCAL ONLY).
// Ditulis oleh refresh cron (market-snapshot-refresh.ts) ke tabel satu-baris
// `crypto_market_snapshot` (migrasi 0101); modul ini hanya MEMBACA dan ringan
// (tanpa impor adapter NOWPayments) agar aman di route edge publik.
//
// Urutan kurs (fail closed): snapshot D1 segar (<=24h, source
// "nowpayments-estimate") -> pasangan env darurat USD_IDR_RATE/USD_FX_EFFECTIVE_AT
// (source "operator-fixed", override manual) -> null (IDR saja, crypto tersembunyi).
// Koin: daftar aktif ∩ kurasi dengan minimum USD. Bila lebih tua dari 2 jam
// (CRYPTO_COINS_MAX_AGE_MS) pembaca mengembalikan `coins: []` + `coinsStale:true`
// (kosong, bukan basi) supaya UI tidak menawarkan koin yang mungkin sudah nonaktif.
// Memo per-isolate 60 dtk menghemat baca D1; kunci memo = objek D1 sehingga
// fixture test berbeda tidak saling bocor.

import { getD1 } from "@/lib/db/client";
import type { D1 } from "@/lib/db/types";
import { parseDecimalParts } from "./decimal";
import { isCuratedCryptoTicker } from "./crypto-assets";
import { loadFxSnapshot, parseFxTimestamp, parseRateRational, USD_FX_MAX_AGE_MS, type FxSnapshot } from "./fx";

export const CRYPTO_FX_SOURCE = "nowpayments-estimate" as const;
export const CRYPTO_REFRESH_AFTER_MS = 30 * 60_000;
export const CRYPTO_COINS_MAX_AGE_MS = 2 * 60 * 60_000;
export const CRYPTO_MARKET_MEMO_MS = 60_000;

export type CryptoMarketRow = {
  fx_rate_text: string | null;
  fx_source: string | null;
  fx_effective_at: string | null;
  coins_json: string | null;
  coins_refreshed_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  lease_until: string | null;
};
export type CryptoMarketCoin = { ticker: string; minUsdText: string };
export type CryptoMarketSnapshot = {
  /** Kurs yang dipakai: D1 segar -> env darurat -> null. */
  fx: FxSnapshot | null;
  /** Koin aktif ∩ kurasi; KOSONG bila stale (>2 jam) atau belum pernah di-refresh. */
  coins: CryptoMarketCoin[];
  coinsRefreshedAt: string | null;
  coinsStale: boolean;
  lastError: string | null;
};

export const MARKET_ROW_SQL = `SELECT fx_rate_text, fx_source, fx_effective_at, coins_json, coins_refreshed_at,
  last_error, last_attempt_at, lease_until FROM crypto_market_snapshot WHERE id=1`;

/** Kurs dari baris D1, atau null bila hilang/tidak valid/basi/bertanggal masa depan. */
export function fxFromMarketRow(row: CryptoMarketRow | null, now: number): FxSnapshot | null {
  if (!row || row.fx_source !== CRYPTO_FX_SOURCE || !row.fx_rate_text || !row.fx_effective_at) return null;
  const rational = parseRateRational(row.fx_rate_text);
  const effectiveAt = parseFxTimestamp(row.fx_effective_at);
  if (!rational || !effectiveAt) return null;
  const at = Date.parse(effectiveAt);
  if (at > now || now - at > USD_FX_MAX_AGE_MS) return null;
  return {
    rateText: row.fx_rate_text.trim(), rateNum: String(rational.num), rateDen: String(rational.den),
    effectiveAt, source: CRYPTO_FX_SOURCE,
  };
}

export function parseMarketCoins(raw: string | null): CryptoMarketCoin[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: CryptoMarketCoin[] = [];
    for (const item of parsed) {
      const ticker = String((item as { ticker?: unknown })?.ticker ?? "").toLowerCase();
      const min = (item as { min_usd_text?: unknown })?.min_usd_text;
      if (!isCuratedCryptoTicker(ticker) || seen.has(ticker) || !parseDecimalParts(min)) continue;
      seen.add(ticker);
      out.push({ ticker, minUsdText: String(min) });
    }
    return out;
  } catch {
    return [];
  }
}

export function resolveMarketSnapshot(row: CryptoMarketRow | null, now: number): CryptoMarketSnapshot {
  const fx = fxFromMarketRow(row, now) ?? loadFxSnapshot(now);
  const refreshedMs = row?.coins_refreshed_at ? Date.parse(row.coins_refreshed_at) : NaN;
  const coinsFresh = Number.isFinite(refreshedMs) && refreshedMs <= now && now - refreshedMs <= CRYPTO_COINS_MAX_AGE_MS;
  return {
    fx,
    coins: coinsFresh ? parseMarketCoins(row?.coins_json ?? null) : [],
    coinsRefreshedAt: row?.coins_refreshed_at ?? null,
    coinsStale: !coinsFresh,
    lastError: row?.last_error ?? null,
  };
}

let memo: { db: D1 | null; at: number; row: CryptoMarketRow | null } | null = null;

/** Hapus memo (setelah refresh menulis, dan di test). */
export function resetCryptoMarketMemo(): void {
  memo = null;
}

async function readRow(db: D1 | null): Promise<{ ok: true; row: CryptoMarketRow | null } | { ok: false }> {
  if (!db) return { ok: true, row: null };
  try {
    return { ok: true, row: (await db.prepare(MARKET_ROW_SQL).first() as CryptoMarketRow | null) ?? null };
  } catch {
    return { ok: false }; // tabel belum ada / D1 gagal: env darurat, jangan di-memo
  }
}

export async function getCryptoMarketSnapshot(
  db: D1 | null = getD1(),
  opts: { now?: number; noMemo?: boolean } = {},
): Promise<CryptoMarketSnapshot> {
  const now = opts.now ?? Date.now();
  if (!opts.noMemo && opts.now === undefined && memo && memo.db === db && now - memo.at >= 0 && now - memo.at < CRYPTO_MARKET_MEMO_MS) {
    return resolveMarketSnapshot(memo.row, now);
  }
  const read = await readRow(db);
  if (!read.ok) return resolveMarketSnapshot(null, now);
  if (!opts.noMemo && opts.now === undefined) memo = { db, at: now, row: read.row };
  return resolveMarketSnapshot(read.row, now);
}

/** FX tunggal untuk semua konsumen (display, quote, create, Telegram). */
export async function loadCurrentFxSnapshot(db: D1 | null = getD1(), now?: number): Promise<FxSnapshot | null> {
  return (await getCryptoMarketSnapshot(db, now === undefined ? {} : { now })).fx;
}
