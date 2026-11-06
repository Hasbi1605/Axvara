// Katalog koin crypto yang BOLEH pernah ditawarkan AXVARA (LOCAL ONLY).
// Sumber kebenaran tunggal: koin di luar peta ini tidak pernah tampil walau
// diaktifkan di dashboard NOWPayments. Daftar aktif/minimum realtime berasal
// dari snapshot D1 (market-snapshot.ts), bukan dari file ini.
//
// Sengaja DIKECUALIKAN:
//   btclightning — alamat bayar berupa invoice sekali pakai (kompatibilitas wallet).
//   usddtrc20, tusdtrc20 — riwayat de-peg; owner menyarankan dinonaktifkan.
//   Semua aset yang butuh memo / extra id (tidak ada di daftar kurasi ini).
// `logo`: berkas SVG ditambahkan tugas UI berikutnya (jangan diunduh di sini).

export type CryptoAssetGroup = "popular" | "stable";

export type CryptoAsset = {
  ticker: string; // kode NOWPayments lowercase
  symbol: string;
  name: string;
  network: string; // kode jaringan NOWPayments
  networkLabel: string;
  group: CryptoAssetGroup;
  order: number;
  logo: string;
};

type Seed = [ticker: string, symbol: string, name: string, network: string, networkLabel: string];

const POPULAR: Seed[] = [
  ["btc", "BTC", "Bitcoin", "btc", "Bitcoin"],
  ["eth", "ETH", "Ethereum", "eth", "Ethereum"],
  ["bnbbsc", "BNB", "BNB", "bsc", "BNB Smart Chain"],
  ["trx", "TRX", "TRON", "trx", "Tron"],
  ["ltc", "LTC", "Litecoin", "ltc", "Litecoin"],
  ["ton", "TON", "Toncoin", "ton", "TON"],
];

const STABLE: Seed[] = [
  ["usdtbsc", "USDT", "Tether USD", "bsc", "BNB Smart Chain"],
  ["usdttrc20", "USDT", "Tether USD", "trx", "Tron (TRC20)"],
  ["usdterc20", "USDT", "Tether USD", "eth", "Ethereum (ERC20)"],
  ["usdtmatic", "USDT", "Tether USD", "matic", "Polygon"],
  ["usdtarb", "USDT", "Tether USD", "arbitrum", "Arbitrum One"],
  ["usdtop", "USDT", "Tether USD", "op", "Optimism"],
  ["usdtton", "USDT", "Tether USD", "ton", "TON"],
  ["usdtarc20", "USDT", "Tether USD", "avaxc", "Avalanche C-Chain"],
  ["usdtcelo", "USDT", "Tether USD", "celo", "Celo"],
  ["usdc", "USDC", "USD Coin", "eth", "Ethereum (ERC20)"],
  ["usdcbsc", "USDC", "USD Coin", "bsc", "BNB Smart Chain"],
  ["usdcsol", "USDC", "USD Coin", "sol", "Solana"],
  ["usdcmatic", "USDC", "USD Coin", "matic", "Polygon"],
  ["usdcarb", "USDC", "USD Coin", "arbitrum", "Arbitrum One"],
  ["usdcop", "USDC", "USD Coin", "op", "Optimism"],
  ["usdcarc20", "USDC", "USD Coin", "avaxc", "Avalanche C-Chain"],
  ["usdcalgo", "USDC", "USD Coin", "algo", "Algorand"],
  ["daiarb", "DAI", "Dai", "arbitrum", "Arbitrum One"],
  ["pyusd", "PYUSD", "PayPal USD", "eth", "Ethereum (ERC20)"],
  ["fdusdbsc", "FDUSD", "First Digital USD", "bsc", "BNB Smart Chain"],
  ["fdusderc20", "FDUSD", "First Digital USD", "eth", "Ethereum (ERC20)"],
  ["usdp", "USDP", "Pax Dollar", "eth", "Ethereum (ERC20)"],
];

function build(seeds: Seed[], group: CryptoAssetGroup, startOrder: number): CryptoAsset[] {
  return seeds.map(([ticker, symbol, name, network, networkLabel], index) => ({
    ticker, symbol, name, network, networkLabel, group, order: startOrder + index,
    logo: `/payments/coins/${ticker}.svg`,
  }));
}

/** Urutan tampil: populer dulu, lalu stablecoin. */
export const CRYPTO_ASSETS: readonly CryptoAsset[] = Object.freeze([
  ...build(POPULAR, "popular", 1),
  ...build(STABLE, "stable", 101),
]);

const BY_TICKER: ReadonlyMap<string, CryptoAsset> = new Map(CRYPTO_ASSETS.map((asset) => [asset.ticker, asset]));

export function getCryptoAsset(ticker: unknown): CryptoAsset | null {
  if (typeof ticker !== "string") return null;
  return BY_TICKER.get(ticker.trim().toLowerCase()) ?? null;
}

export function isCuratedCryptoTicker(ticker: unknown): boolean {
  return getCryptoAsset(ticker) !== null;
}

export function listCryptoAssets(): readonly CryptoAsset[] {
  return CRYPTO_ASSETS;
}
