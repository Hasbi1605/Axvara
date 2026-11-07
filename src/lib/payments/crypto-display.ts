/**
 * Tampilan nominal koin crypto ke pembeli (murni presentasi).
 *
 * Nominal yang DISIMPAN, dikirim ke NOWPayments, dan dipakai untuk cek
 * paid/underpaid TIDAK berubah; hanya angka yang dilihat/disalin pembeli.
 * Bulatkan KE ATAS ke desimal terkecil yang nilai satu unitnya ≤ ~US$0,01
 * (overpay < 1 sen), dibatasi presisi nominal asli. Tanpa teks tambahan.
 */

const AMOUNT_RE = /^([0-9]+)(?:\.([0-9]+))?$/;
/** Satu sen USD. */
const CENT_LIMIT = 0.01;
/**
 * Toleransi pemilihan digit (1% dari satu sen) HANYA untuk koin ≈US$1: rasio
 * USD/koin bisa 1,00146 sehingga 10^-2 × rate = 0,0100146 — owner tetap ingin
 * 2 desimal (contoh "2.24671004" + "2.25" → "2.25"), bukan digit ketiga.
 * Tidak dipakai untuk perhitungan uang; pembulatan tetap BigInt eksak.
 */
const CENT_TOLERANCE = CENT_LIMIT * 1.01;
const MAX_DECIMALS = 18;

/** Digit yang dibuang -> ceil membagi dengan 10^drop, lalu format ulang. */
function ceilDigits(whole: string, frac: string, decimals: number): string {
  if (decimals === frac.length) {
    const trimmed = frac.replace(/0+$/, "");
    return `${whole.replace(/^0+(?=\d)/, "")}${trimmed ? `.${trimmed}` : ""}`;
  }
  const drop = frac.length - decimals;
  const divisor = BigInt(10) ** BigInt(drop);
  const digits = (whole + frac).replace(/^0+(?=\d)/, "");
  const value = BigInt(digits || "0");
  const rounded = (value + divisor - BigInt(1)) / divisor;
  const text = rounded.toString().padStart(decimals + 1, "0");
  const integer = text.slice(0, text.length - decimals).replace(/^0+(?=\d)/, "") || "0";
  const fraction = text.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * `payAmountText` (mis. "2.24671004") + `usdTotalText` (total USD 2dp) ->
 * nominal tampil yang dibulatkan ke atas. Input invalid/zero/tanpa presisi
 * yang cukup dikembalikan apa adanya (fail closed, tidak pernah menebak).
 */
export function displayCryptoAmount(payAmountText: string, usdTotalText: string | null): string {
  const amount = AMOUNT_RE.exec(String(payAmountText ?? ""));
  const usd = usdTotalText === null || usdTotalText === undefined ? null : AMOUNT_RE.exec(String(usdTotalText));
  if (!amount || !usd) return payAmountText;
  const frac = amount[2] ?? "";
  if (frac.length < 2 || frac.length > MAX_DECIMALS) return payAmountText;
  const coin = Number(`${amount[1]}${frac ? `.${frac}` : ""}`);
  const total = Number(`${usd[1]}${usd[2] ? `.${usd[2]}` : ""}`);
  if (!Number.isFinite(coin) || !Number.isFinite(total) || coin <= 0 || total <= 0) return payAmountText;
  // Number HANYA untuk memilih jumlah desimal; pembulatan memakai string/BigInt.
  const rate = total / coin;
  if (!Number.isFinite(rate) || rate <= 0) return payAmountText;
  let decimals = 2;
  while (decimals < MAX_DECIMALS && 10 ** -decimals * rate > CENT_TOLERANCE) decimals++;
  if (decimals > frac.length) return payAmountText; // cap presisi asli tercapai
  return ceilDigits(amount[1], frac, decimals);
}
