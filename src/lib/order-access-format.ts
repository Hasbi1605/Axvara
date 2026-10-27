const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeOrderAccessCode(value: unknown): string {
  if (typeof value !== "string" || value.length > 100) return "";
  const normalized = value.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return [6, 26].includes(normalized.length) && [...normalized].every(char => ALPHABET.includes(char)) ? normalized : "";
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

export function encodeOrderAccessPin(bytes: Uint8Array): string {
  // Six Crockford characters encode 30 pseudorandom bits, including leading zeros.
  const bits = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return [27, 22, 17, 12, 7, 2].map(shift => ALPHABET[(bits >>> shift) & 31]).join("");
}
