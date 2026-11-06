// String-decimal math untuk nominal crypto (W1, LOCAL ONLY).
// Jangan pernah Number()/float untuk uang: parse ke {scaled, scale} dengan
// operasi string saja, lalu bandingkan/v alidasi lintas-skala secara eksak.
export type DecimalParts = { scaled: bigint; scale: number };

const DECIMAL_RE = /^[0-9]+(\.[0-9]+)?$/;

export function parseDecimalParts(value: unknown): DecimalParts | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!DECIMAL_RE.test(text) || text.length > 64) return null;
  const [whole, frac = ""] = text.split(".");
  if (frac.length > 18) return null;
  const trimmedFrac = frac.replace(/0+$/, "");
  const digits = whole.replace(/^0+(?=\d)/, "") + trimmedFrac;
  if (!/^[0-9]+$/.test(digits)) return null;
  try {
    return { scaled: BigInt(digits === "" ? "0" : digits), scale: trimmedFrac.length };
  } catch {
    return null;
  }
}

function pow10(exp: number): bigint {
  let result = BigInt(1);
  for (let i = 0; i < exp; i++) result *= BigInt(10);
  return result;
}

function align(left: DecimalParts, right: DecimalParts): [bigint, bigint] {
  let a = left.scaled;
  let b = right.scaled;
  if (left.scale > right.scale) {
    b *= pow10(left.scale - right.scale);
  } else if (right.scale > left.scale) {
    a *= pow10(right.scale - left.scale);
  }
  return [a, b];
}

/** -1 | 0 | 1, eksak lintas-skala. */
export function compareDecimalText(left: DecimalParts, right: DecimalParts): number {
  const [a, b] = align(left, right);
  return a === b ? 0 : a < b ? -1 : 1;
}

/** True bila `actual` numeric dan >= `expected` (tolerance = nol). */
export function isSufficientDecimal(actual: unknown, expected: unknown): boolean {
  const a = parseDecimalParts(actual);
  const e = parseDecimalParts(expected);
  if (!a || !e) return false;
  return compareDecimalText(a, e) >= 0;
}

/** Validasi ketat nominal provider: hanya digit + titik opsional, maks 18dp. */
export function isStrictDecimalText(value: unknown): boolean {
  return parseDecimalParts(value) !== null;
}
