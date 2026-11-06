// Refresh snapshot pasar crypto dari NOWPayments (LOCAL ONLY), dipanggil cron
// lite `cleanup` (lihat src/app/api/cron/lite/route.ts) hanya bila jatuh tempo.
//   - Hanya butuh NOWPAYMENTS_API_KEY (jalur baca); TIDAK bergantung pada
//     NOWPAYMENTS_ENABLED karena tampilan USD butuh kurs walau crypto create off.
//   - Kurs: dua GET /estimate ke aset referensi tetap `usdtbsc` (1.000.000 IDR
//     dan 100 USD) -> IDR/USD dengan bigint (computeIdrPerUsd), 2 desimal.
//     Ditolak bila di luar 5000-50000, atau bila ada kurs tersimpan <=24h yang
//     berubah >10% (nilai lama dipertahankan + last_error). Kurs lama >24h
//     sudah tidak dipakai pembaca, jadi tidak lagi dijadikan jangkar.
//   - Koin: /merchant/coins ∩ kurasi (crypto-assets.ts) -> /min-amount bentuk
//     floating (tanpa is_fixed_rate / is_fee_paid_by_user), concurrency <=6,
//     timeout 8 dtk. Koin yang min-nya gagal DIHILANGKAN (tidak ditebak). Bila
//     merchant/coins gagal, atau SEMUA min gagal, atau deadline total terlewat,
//     daftar sebelumnya dipertahankan + last_error.
//   - Lease CAS (lease_until) agar isolate cron paralel tidak refresh ganda;
//     penulisan akhir juga CAS pada lease milik sendiri. 3-4 statement D1.

import type { DatabaseAccess } from "@/lib/db-access";
import { readBoundedText } from "@/lib/bounded-body";
import { isNowpaymentsReadable } from "./rails";
import { nowpaymentsOutcomeCurrency } from "./crypto-preflight";
import { nowpaymentsBaseUrl, parseNowpaymentsWire } from "./nowpayments";
import { getCryptoAsset, listCryptoAssets } from "./crypto-assets";
import { parseDecimalParts } from "./decimal";
import { computeIdrPerUsd, isRateWithin, parseFxTimestamp, parseRateRational, USD_FX_MAX_AGE_MS } from "./fx";
import {
  CRYPTO_FX_SOURCE, CRYPTO_REFRESH_AFTER_MS, MARKET_ROW_SQL, resetCryptoMarketMemo, type CryptoMarketRow,
} from "./market-snapshot";

export const FX_REFERENCE_TICKER = "usdtbsc" as const;
export const FX_REFERENCE_IDR_AMOUNT = "1000000";
export const FX_REFERENCE_USD_AMOUNT = "100";
const FX_MAX_JUMP = { num: 1, den: 10 } as const; // 10%
const REQUEST_TIMEOUT_MS = 8_000;
const TOTAL_DEADLINE_MS = 30_000;
const LEASE_MS = 90_000;
const MIN_RETRY_MS = 2 * 60_000;
const CONCURRENCY = 6;
const BODY_LIMIT = 64_000;

export type MarketRefreshResult = {
  status: "refreshed" | "not_due" | "skipped_no_key" | "skipped_budget" | "lease_busy";
  fx?: "updated" | "kept";
  coins?: number | "kept";
  errors?: string[];
};

export type MarketRefreshOptions = {
  now?: number;
  force?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  concurrency?: number;
};

type Json = Record<string, unknown>;

function ageMs(iso: string | null, now: number): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? now - ms : Infinity;
}

/** True bila kurs ATAU koin kosong / lebih tua dari 30 menit. */
export function isMarketRefreshDue(row: CryptoMarketRow | null, now: number): boolean {
  if (!row) return true;
  return ageMs(row.fx_effective_at, now) >= CRYPTO_REFRESH_AFTER_MS || ageMs(row.coins_refreshed_at, now) >= CRYPTO_REFRESH_AFTER_MS;
}

function positive(value: unknown): string | null {
  const parts = parseDecimalParts(value);
  return parts && parts.scaled > BigInt(0) ? String(value).trim() : null;
}

export async function refreshCryptoMarketSnapshot(db: DatabaseAccess, opts: MarketRefreshOptions = {}): Promise<MarketRefreshResult> {
  if (!isNowpaymentsReadable()) return { status: "skipped_no_key" };
  if (!db.canSpend(4)) return { status: "skipped_budget" };
  const now = opts.now ?? Date.now();
  const row = (await db.queryFirst(MARKET_ROW_SQL)) as CryptoMarketRow | null;
  if (!opts.force) {
    if (!isMarketRefreshDue(row, now)) return { status: "not_due" };
    if (ageMs(row?.last_attempt_at ?? null, now) < MIN_RETRY_MS) return { status: "not_due" };
  }

  // Lease CAS: INSERT baru, atau UPDATE hanya bila lease kosong/kedaluwarsa DAN
  // percobaan terakhir sudah > MIN_RETRY (isolate lain yang baru selesai tidak diulang).
  const nowIso = new Date(now).toISOString();
  const lease = new Date(now + LEASE_MS).toISOString();
  const acquired = await db.execRun(
    `INSERT INTO crypto_market_snapshot (id, lease_until, last_attempt_at, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until, last_attempt_at=excluded.last_attempt_at, updated_at=datetime('now')
     WHERE (crypto_market_snapshot.lease_until IS NULL OR crypto_market_snapshot.lease_until <= ?)
       AND (crypto_market_snapshot.last_attempt_at IS NULL OR crypto_market_snapshot.last_attempt_at <= ?)`,
    lease, nowIso, nowIso, opts.force ? nowIso : new Date(now - MIN_RETRY_MS).toISOString(),
  );
  if ((acquired.changes ?? 0) < 1) return { status: "lease_busy" };

  const errors: string[] = [];
  let fxText = row?.fx_rate_text ?? null, fxSource = row?.fx_source ?? null, fxAt = row?.fx_effective_at ?? null;
  let coinsJson = row?.coins_json ?? null, coinsAt = row?.coins_refreshed_at ?? null;
  let fxUpdated = false, coinsCount: number | "kept" = "kept";
  try {
    const client = makeClient(opts);
    const outcome = nowpaymentsOutcomeCurrency() ?? FX_REFERENCE_TICKER;
    const [fxResult, listResult] = await Promise.all([
      refreshFx(client, row, now).then((v) => ({ v }), (e: unknown) => ({ e })),
      client.get("/merchant/coins").then((v) => ({ v }), (e: unknown) => ({ e })),
    ]);
    if ("e" in fxResult) errors.push(`fx_${errName(fxResult.e)}`);
    else { fxText = fxResult.v; fxSource = CRYPTO_FX_SOURCE; fxAt = nowIso; fxUpdated = true; }

    if ("e" in listResult) errors.push("coins_merchant_failed");
    else {
      const active = Array.isArray(listResult.v.selectedCurrencies)
        ? new Set((listResult.v.selectedCurrencies as unknown[]).map((t) => String(t).toLowerCase()))
        : null;
      if (!active) errors.push("coins_merchant_invalid");
      else {
        const candidates = listCryptoAssets().filter((asset) => active.has(asset.ticker)).map((asset) => asset.ticker);
        const fetched = await fetchMinimums(client, candidates, outcome, opts.concurrency ?? CONCURRENCY);
        if (fetched.deadline) errors.push("coins_deadline");
        else if (candidates.length > 0 && fetched.coins.length === 0) errors.push("coins_min_failed");
        else {
          coinsJson = JSON.stringify(fetched.coins);
          coinsAt = nowIso;
          coinsCount = fetched.coins.length;
          if (fetched.coins.length < candidates.length) errors.push(`coins_min_omitted_${candidates.length - fetched.coins.length}`);
        }
      }
    }
  } catch (error) {
    errors.push(`refresh_${errName(error)}`);
  }

  // Penulisan akhir CAS pada lease sendiri; tidak boleh melempar ke cron.
  const written = await db.execRun(
    `UPDATE crypto_market_snapshot SET fx_rate_text=?, fx_source=?, fx_effective_at=?, coins_json=?, coins_refreshed_at=?,
       last_error=?, lease_until=NULL, updated_at=datetime('now') WHERE id=1 AND lease_until=?`,
    fxText, fxSource, fxAt, coinsJson, coinsAt, errors.length ? errors.join(";").slice(0, 200) : null, lease,
  );
  resetCryptoMarketMemo();
  if ((written.changes ?? 0) < 1) return { status: "lease_busy", errors: [...errors, "lease_lost"] };
  return { status: "refreshed", fx: fxUpdated ? "updated" : "kept", coins: coinsCount, ...(errors.length ? { errors } : {}) };
}

function errName(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z0-9_]{1,40}$/.test(message) ? message : "failed";
}

type Client = { get: (path: string) => Promise<Json>; expired: () => boolean };

function makeClient(opts: MarketRefreshOptions): Client {
  const timeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const started = Date.now();
  const total = opts.totalDeadlineMs ?? TOTAL_DEADLINE_MS;
  const base = nowpaymentsBaseUrl();
  return {
    expired: () => Date.now() - started > total,
    get: async (path) => {
      const doFetch = opts.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method: "GET", redirect: "manual", cache: "no-store",
          headers: { Accept: "application/json", "x-api-key": process.env.NOWPAYMENTS_API_KEY! },
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        throw new Error("network");
      }
      if (response.status >= 300 && response.status < 400) throw new Error("redirect");
      if (!response.ok) throw new Error(`http_${response.status}`);
      try {
        const json = parseNowpaymentsWire(await readBoundedText(response as unknown as Request, BODY_LIMIT));
        if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("invalid_response");
        return json as Json;
      } catch {
        throw new Error("invalid_response");
      }
    },
  };
}

async function estimate(client: Client, amount: string, from: "idr" | "usd"): Promise<string> {
  const json = await client.get(`/estimate?amount=${amount}&currency_from=${from}&currency_to=${FX_REFERENCE_TICKER}`);
  if (String(json.currency_from ?? "").toLowerCase() !== from || String(json.currency_to ?? "").toLowerCase() !== FX_REFERENCE_TICKER) {
    throw new Error("estimate_mismatch");
  }
  const value = positive(json.estimated_amount);
  if (!value) throw new Error("estimate_invalid");
  return value;
}

/** Hitung kurs baru (teks 2 desimal) atau lempar kode error pendek. */
async function refreshFx(client: Client, row: CryptoMarketRow | null, now: number): Promise<string> {
  const [estIdr, estUsd] = await Promise.all([
    estimate(client, FX_REFERENCE_IDR_AMOUNT, "idr"),
    estimate(client, FX_REFERENCE_USD_AMOUNT, "usd"),
  ]);
  const rate = computeIdrPerUsd(estIdr, estUsd);
  if (!rate) throw new Error("out_of_range");
  const next = parseRateRational(rate);
  const prev = row?.fx_rate_text ? parseRateRational(row.fx_rate_text) : null;
  const prevAt = row?.fx_effective_at ? parseFxTimestamp(row.fx_effective_at) : null;
  if (next && prev && prevAt && now - Date.parse(prevAt) <= USD_FX_MAX_AGE_MS && !isRateWithin(next, prev, FX_MAX_JUMP.num, FX_MAX_JUMP.den)) {
    throw new Error("jump_rejected");
  }
  return rate;
}

async function fetchMinimums(client: Client, tickers: string[], outcome: string, concurrency = CONCURRENCY) {
  const coins: { ticker: string; min_usd_text: string }[] = [];
  let deadline = false;
  let next = 0;
  const results = new Map<string, string>();
  const worker = async () => {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      if (client.expired()) { deadline = true; return; }
      try {
        const json = await client.get(`/min-amount?currency_from=${encodeURIComponent(ticker)}&currency_to=${encodeURIComponent(outcome)}&fiat_equivalent=usd`);
        const min = positive(json.fiat_equivalent);
        if (String(json.currency_from ?? "").toLowerCase() === ticker && min) results.set(ticker, min);
      } catch { /* min gagal: koin dihilangkan, tidak ditebak */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tickers.length) }, worker));
  for (const ticker of tickers) {
    const min = results.get(ticker);
    if (min && getCryptoAsset(ticker)) coins.push({ ticker, min_usd_text: min });
  }
  return { coins, deadline };
}
