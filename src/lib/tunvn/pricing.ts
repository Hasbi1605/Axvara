// src/lib/tunvn/pricing.ts — rumus harga jual TUNVN (keputusan owner 9 Nov 2026).
//
// Markup yang disetujui owner:
// - Produk akun ChatGPT TUNVN: markup 35% di atas modal USDT.
// - Buff Token Muse AI: markup 40% di atas modal USDT per 1B token.
//
// Modal dalam USDT (price_usdt API = harga Telegram bot, terverifikasi sama
// 2026-11-09). Konversi memakai kurs IDR per USDT yang diteruskan pemanggil
// (FX snapshot AXVARA); fungsi ini murni dan tidak membaca env/jaringan.
// Harga akhir dibulatkan ke atas ke kelipatan Rp100 agar tidak pernah di
// bawah markup yang disetujui.

export const TUNVN_CHATGPT_MARKUP_PERCENT = 35;
export const TUNVN_BUFF_MARKUP_PERCENT = 40;

/** Modal Buff per 1B dari probe /api/buff/check 2026-11-09: 10B dan 20B
 *  sama-sama 0,05883 USDT/1B (390 VND/1B). Snapshot awal; panel admin wajib
 *  menampilkan probe langsung dan angka ini hanya fallback tampilan. */
export const TUNVN_BUFF_COST_USDT_PER_B = 0.0588;

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} tidak valid`);
}

/** Harga jual IDR = ceil100(modal USDT × kurs × (1 + markup/100)). */
export function tunvnSellPriceIdr(costUsdt: number, idrPerUsdt: number, markupPercent: number): number {
  assertPositive("costUsdt", costUsdt);
  assertPositive("idrPerUsdt", idrPerUsdt);
  if (!Number.isFinite(markupPercent) || markupPercent < 0) throw new RangeError("markupPercent tidak valid");
  const raw = costUsdt * idrPerUsdt * (1 + markupPercent / 100);
  if (!Number.isFinite(raw) || raw <= 0) throw new RangeError("harga tidak valid");
  return Math.ceil(raw / 100) * 100;
}

export function tunvnChatGptSellPriceIdr(costUsdt: number, idrPerUsdt: number): number {
  return tunvnSellPriceIdr(costUsdt, idrPerUsdt, TUNVN_CHATGPT_MARKUP_PERCENT);
}

export function tunvnBuffSellPriceIdr(quantityB: number, idrPerUsdt: number, costUsdtPerB = TUNVN_BUFF_COST_USDT_PER_B): number {
  if (!Number.isInteger(quantityB) || quantityB < 1 || quantityB > 30) throw new RangeError("quantityB harus 1–30");
  return tunvnSellPriceIdr(costUsdtPerB * quantityB, idrPerUsdt, TUNVN_BUFF_MARKUP_PERCENT);
}

/** Varian Buff yang diterbitkan sebagai varian produk Muse manual. */
export const TUNVN_BUFF_VARIANT_B = [5, 10, 20, 30] as const;
