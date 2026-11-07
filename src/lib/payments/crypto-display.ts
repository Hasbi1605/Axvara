/**
 * Tampilan nominal koin crypto ke pembeli (murni presentasi).
 *
 * Nominal yang DISIMPAN, dikirim ke NOWPayments, dan dipakai untuk cek
 * paid/underpaid TIDAK berubah; hanya angka yang dilihat/disalin pembeli.
 *
 * Pilih presisi tampil TERPENDEK (mulai 2 desimal) yang kelebihan nominal
 * hasil pembulatan KE ATAS benar-benar ≤ US$0,01 menurut rasio tersimpan
 * USD/koin — bukan heuristik per-langkah 1%. Semua perbandingan uang memakai
 * BigInt/string eksak; Number/float dan kurs live tidak dipakai. Dengan unit
 * koin A pada skala s dan total USD U pada skala u, kandidat B diterima bila
 * (B-A)*U*100 ≤ A*10^u. Input invalid/zero/tanpa presisi yang cukup
 * dikembalikan apa adanya (fail closed).
 */

import { parseDecimalParts } from "@/lib/payments/decimal";

const AMOUNT_RE = /^([0-9]+)(?:\.([0-9]+))?$/;
/** Batas trust-boundary teks desimal yang sama dengan `parseDecimalParts`. */
const MAX_TEXT_LENGTH = 64;
const MAX_DECIMALS = 18;

/** Format nilai `scaled` berskala `scale`, tanpa nol di belakang. */
function formatScaled(scaled: bigint, scale: number): string {
  const digits = scaled.toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, "") || "0";
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * `payAmountText` (mis. "2.24671004") + `usdTotalText` (total USD tersimpan) ->
 * nominal tampil yang dibulatkan ke atas. Kandidat 2 desimal dicoba lebih
 * dulu; kandidat pertama yang kelebihannya ≤ US$0,01 dipakai.
 */
export function displayCryptoAmount(payAmountText: string, usdTotalText: string | null): string {
  const text = String(payAmountText ?? "");
  if (text.length > MAX_TEXT_LENGTH) return payAmountText;
  const amount = AMOUNT_RE.exec(text);
  const usd = parseDecimalParts(usdTotalText);
  if (!amount || !usd || usd.scaled <= BigInt(0)) return payAmountText;
  const frac = amount[2] ?? "";
  if (frac.length < 2 || frac.length > MAX_DECIMALS) return payAmountText;
  const units = BigInt(amount[1] + frac);
  if (units <= BigInt(0)) return payAmountText;

  const scale = frac.length;
  const usdScale = BigInt(10) ** BigInt(usd.scale);
  for (let decimals = 2; decimals <= scale; decimals++) {
    const step = BigInt(10) ** BigInt(scale - decimals);
    const rounded = ((units + step - BigInt(1)) / step) * step;
    // (B-A)*U*100 ≤ A*10^u ⇔ kelebihan nominal ≤ US$0,01 pada rasio tersimpan.
    if ((rounded - units) * usd.scaled * BigInt(100) <= units * usdScale) {
      return formatScaled(rounded, scale);
    }
  }
  return payAmountText;
}
