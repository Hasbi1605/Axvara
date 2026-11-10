// src/lib/tunvn/pricing.ts — rumus harga jual TUNVN (keputusan owner 9 Nov 2026).
//
// Markup bawaan yang disetujui owner:
// - Produk akun ChatGPT TUNVN: markup 35% di atas modal USDT.
// - Buff Token Muse AI: markup 40% di atas modal USDT per 1B token.
// Markup per produk/varian dapat diubah admin dari panel TUNVN dan disimpan
// di tunvn_products.markup_percent / product_variants.tunvn_markup_percent;
// nilai di sini hanya bawaan awal dan fallback.
//
// Modal dalam USDT (price_usdt API = harga Telegram bot, terverifikasi sama
// 2026-11-09). Konversi memakai kurs IDR per USDT yang diteruskan pemanggil
// (FX snapshot AXVARA); fungsi ini murni dan tidak membaca env/jaringan.
// Harga akhir dibulatkan ke atas ke kelipatan Rp100 agar tidak pernah di
// bawah markup yang berlaku.

export const TUNVN_CHATGPT_MARKUP_PERCENT = 35;
export const TUNVN_BUFF_MARKUP_PERCENT = 40;

/** Modal Buff per 1B dari probe /api/buff/check 2026-11-09: 10B dan 20B
 *  sama-sama 0,05883 USDT/1B (390 VND/1B). Snapshot awal; panel admin wajib
 *  menampilkan probe langsung dan angka ini hanya fallback tampilan. */
export const TUNVN_BUFF_COST_USDT_PER_B = 0.0588;

export const TUNVN_MARKUP_MIN = 0;
export const TUNVN_MARKUP_MAX = 1000;

export function isValidTunvnMarkup(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= TUNVN_MARKUP_MIN && value <= TUNVN_MARKUP_MAX;
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} tidak valid`);
}

/** Harga jual IDR = ceil100(modal USDT × kurs × (1 + markup/100)). */
export function tunvnSellPriceIdr(costUsdt: number, idrPerUsdt: number, markupPercent: number): number {
  assertPositive("costUsdt", costUsdt);
  assertPositive("idrPerUsdt", idrPerUsdt);
  if (!isValidTunvnMarkup(markupPercent)) throw new RangeError("markupPercent tidak valid");
  const raw = costUsdt * idrPerUsdt * (1 + markupPercent / 100);
  if (!Number.isFinite(raw) || raw <= 0) throw new RangeError("harga tidak valid");
  return Math.ceil(raw / 100) * 100;
}

export function tunvnChatGptSellPriceIdr(costUsdt: number, idrPerUsdt: number, markupPercent = TUNVN_CHATGPT_MARKUP_PERCENT): number {
  return tunvnSellPriceIdr(costUsdt, idrPerUsdt, markupPercent);
}

export function tunvnBuffSellPriceIdr(quantityB: number, idrPerUsdt: number, opts: { costUsdtPerB?: number; markupPercent?: number } = {}): number {
  if (!Number.isInteger(quantityB) || quantityB < 1 || quantityB > 30) throw new RangeError("quantityB harus 1–30");
  const costPerB = opts.costUsdtPerB ?? TUNVN_BUFF_COST_USDT_PER_B;
  return tunvnSellPriceIdr(costPerB * quantityB, idrPerUsdt, opts.markupPercent ?? TUNVN_BUFF_MARKUP_PERCENT);
}

/** Varian Buff yang diterbitkan sebagai varian produk Muse manual. */
export const TUNVN_BUFF_VARIANT_B = [1] as const;
