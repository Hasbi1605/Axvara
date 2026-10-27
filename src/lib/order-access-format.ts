const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeOrderAccessCode(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) return "";
  const normalized = value.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return normalized.length === 26 && [...normalized].every(char => ALPHABET.includes(char)) ? normalized : "";
}

export function formatOrderAccessCode(value: string): string {
  return normalizeOrderAccessCode(value).replace(/^(.{5})(.{5})(.{5})(.{5})(.{6})$/, "$1-$2-$3-$4-$5");
}

export function encodeOrderAccessCode(bytes: Uint8Array): string {
  let buffer = 0, bits = 0, out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(buffer >>> bits) & 31]; }
  }
  if (bits) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return formatOrderAccessCode(out);
}
