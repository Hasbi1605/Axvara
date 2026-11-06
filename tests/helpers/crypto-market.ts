// Seed snapshot pasar crypto (tabel crypto_market_snapshot, migrasi 0101) untuk tes.
// Tes tidak pernah memanggil jaringan: koin + kurs datang dari baris D1 fixture ini
// (sama seperti hasil refresh cron). Nilai di sini fixture berlabel, bukan data produksi.
import { resetCryptoMarketMemo } from "@/lib/payments/market-snapshot";

type SqlLike = { prepare: (query: string) => { run: (...params: unknown[]) => unknown } };

export const DEFAULT_TEST_COINS: { ticker: string; min_usd_text: string }[] = [
  { ticker: "btc", min_usd_text: "1.95" },
  { ticker: "eth", min_usd_text: "0.5" },
  { ticker: "trx", min_usd_text: "0.08" },
  { ticker: "usdtbsc", min_usd_text: "0.08" },
  { ticker: "usdttrc20", min_usd_text: "0.1" },
];

export function seedCryptoMarket(
  sql: SqlLike,
  /** `fx:false` = hanya koin (kurs jatuh ke pasangan env darurat, source operator-fixed). */
  opts: { coins?: { ticker: string; min_usd_text: string }[]; rate?: string; fx?: boolean; coinsAgeMs?: number; fxAgeMs?: number } = {},
): void {
  const now = Date.now();
  const iso = (age: number) => new Date(now - age).toISOString();
  sql.prepare(
    `INSERT OR REPLACE INTO crypto_market_snapshot(id,fx_rate_text,fx_source,fx_effective_at,coins_json,coins_refreshed_at,updated_at)
     VALUES(1,?,?,?,?,?,datetime('now'))`,
  ).run(
    opts.fx === false ? null : (opts.rate ?? "16000.00"), opts.fx === false ? null : "nowpayments-estimate", opts.fx === false ? null : iso(opts.fxAgeMs ?? 60_000),
    JSON.stringify(opts.coins ?? DEFAULT_TEST_COINS), iso(opts.coinsAgeMs ?? 60_000),
  );
  resetCryptoMarketMemo();
}
