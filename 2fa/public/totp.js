// RFC 4648 Base32 + RFC 4226 HOTP / RFC 6238 TOTP (100% Web Crypto client-side).

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP = Object.create(null);
for (let i = 0; i < BASE32_ALPHABET.length; i += 1) {
  BASE32_LOOKUP[BASE32_ALPHABET[i]] = i;
}

export const SUPPORTED_ALGORITHMS = new Set(["SHA-1", "SHA-256", "SHA-512"]);
export const SUPPORTED_DIGITS = new Set([6, 7, 8]);
export const MAX_BATCH_LINES = 50;

const MIN_BASE32_CHARS = 8;
const MAX_BASE32_CHARS = 256;
const keyCache = new Map();

export function normalizeAlgorithm(raw) {
  const s = String(raw || "SHA-1").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s === "SHA1") return "SHA-1";
  if (s === "SHA256") return "SHA-256";
  if (s === "SHA512") return "SHA-512";
  return null;
}

export function cleanBase32(input) {
  return String(input || "")
    .trim()
    .replace(/[\s-]+/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();
}

export function isDigitsOnlyOtp(input) {
  const compact = String(input || "").trim().replace(/[\s-]+/g, "");
  return /^\d{6,8}$/.test(compact);
}

export function decodeBase32(input) {
  const clean = cleanBase32(input);
  if (!clean) {
    throw new Error("empty_secret");
  }
  if (isDigitsOnlyOtp(input)) {
    throw new Error("otp_not_secret");
  }
  if (clean.length < MIN_BASE32_CHARS || clean.length > MAX_BASE32_CHARS) {
    throw new Error("invalid_length");
  }

  let bits = 0;
  let value = 0;
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let idx = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const code = BASE32_LOOKUP[clean[i]];
    if (code === undefined) {
      throw new Error("invalid_base32");
    }
    value = (value << 5) | code;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  if (idx === 0) {
    throw new Error("invalid_base32");
  }
  return out;
}

export function counterToBytes(counter) {
  if (!Number.isFinite(counter) || counter < 0) {
    throw new Error("invalid_counter");
  }
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  view.setUint32(0, hi, false);
  view.setUint32(4, lo, false);
  return new Uint8Array(buf);
}

async function importHmacKey(secretClean, algorithm, cryptoObj) {
  const cacheKey = `${algorithm}:${secretClean}`;
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey);
  }
  const bytes = decodeBase32(secretClean);
  const cryptoKey = await cryptoObj.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: { name: algorithm } },
    false,
    ["sign"],
  );
  if (keyCache.size > 200) {
    keyCache.clear();
  }
  keyCache.set(cacheKey, cryptoKey);
  return cryptoKey;
}

export async function generateHotp(secret, counter, options = {}) {
  const digits = Number(options.digits ?? 6);
  const algorithm = normalizeAlgorithm(options.algorithm ?? "SHA-1");
  const cryptoObj = options.crypto || globalThis.crypto;

  if (!SUPPORTED_DIGITS.has(digits)) throw new Error("invalid_digits");
  if (!algorithm || !SUPPORTED_ALGORITHMS.has(algorithm)) throw new Error("invalid_algorithm");
  if (!cryptoObj?.subtle) throw new Error("webcrypto_unavailable");

  const secretClean = cleanBase32(secret);
  const cryptoKey = await importHmacKey(secretClean, algorithm, cryptoObj);
  const msg = counterToBytes(counter);
  const sig = new Uint8Array(await cryptoObj.subtle.sign("HMAC", cryptoKey, msg));

  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);

  const mod = 10 ** digits;
  return String(binary % mod).padStart(digits, "0");
}

export async function generateTotp(secret, options = {}) {
  const period = Number(options.period ?? 30);
  const digits = Number(options.digits ?? 6);
  const algorithm = normalizeAlgorithm(options.algorithm ?? "SHA-1");
  const timestampMs = Number(options.timestampMs ?? Date.now());

  if (!Number.isInteger(period) || period < 5 || period > 300) {
    throw new Error("invalid_period");
  }

  const seconds = Math.floor(timestampMs / 1000);
  const counter = Math.floor(seconds / period);
  const elapsed = ((seconds % period) + period) % period;
  const remaining = period - elapsed;
  const msIntoPeriod = ((timestampMs % (period * 1000)) + period * 1000) % (period * 1000);
  const progress = 1 - msIntoPeriod / (period * 1000);

  const code = await generateHotp(secret, counter, {
    digits,
    algorithm,
    crypto: options.crypto,
  });

  let nextCode = null;
  if (options.includeNext) {
    nextCode = await generateHotp(secret, counter + 1, {
      digits,
      algorithm,
      crypto: options.crypto,
    });
  }

  return {
    code,
    nextCode,
    remaining,
    period,
    progress,
    counter,
    digits,
    algorithm,
  };
}

export function formatOtpDisplay(code) {
  const s = String(code || "");
  if (s.length === 6) return `${s.slice(0, 3)} ${s.slice(3)}`;
  if (s.length === 8) return `${s.slice(0, 4)} ${s.slice(4)}`;
  return s;
}

export function maskSecret(secret) {
  const s = cleanBase32(secret);
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}···${s.slice(-4)}`;
}

export function parseOtpAuthUri(raw) {
  const trimmed = String(raw || "").trim();
  if (!/^otpauth:\/\//i.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "invalid_uri" };
  }

  const type = url.hostname.toLowerCase();
  if (type !== "totp") {
    return { error: "unsupported_otpauth_type" };
  }

  const secretParam = url.searchParams.get("secret") || "";
  const secret = cleanBase32(secretParam);
  try {
    decodeBase32(secret);
  } catch (err) {
    return { error: err?.message || "invalid_base32" };
  }

  let rawLabel = "";
  try {
    rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, "")).trim();
  } catch {
    rawLabel = url.pathname.replace(/^\/+/, "").trim();
  }
  const issuerParam = (url.searchParams.get("issuer") || "").trim();

  let label = rawLabel;
  if (issuerParam && rawLabel && !rawLabel.toLowerCase().startsWith(issuerParam.toLowerCase())) {
    label = `${issuerParam} · ${rawLabel}`;
  } else if (!rawLabel && issuerParam) {
    label = issuerParam;
  } else if (rawLabel.includes(":")) {
    const [iss, acct] = rawLabel.split(":", 2);
    label = acct?.trim() ? `${iss.trim()} · ${acct.trim()}` : iss.trim();
  }

  const digitsRaw = url.searchParams.get("digits");
  const periodRaw = url.searchParams.get("period");
  const algoRaw = url.searchParams.get("algorithm");

  const digits = digitsRaw ? Number(digitsRaw) : undefined;
  const period = periodRaw ? Number(periodRaw) : undefined;
  const algorithm = algoRaw ? normalizeAlgorithm(algoRaw) : undefined;

  if (digits !== undefined && !SUPPORTED_DIGITS.has(digits)) {
    return { error: "invalid_digits" };
  }
  if (period !== undefined && (!Number.isInteger(period) || period < 5 || period > 300)) {
    return { error: "invalid_period" };
  }
  if (algoRaw && !algorithm) {
    return { error: "invalid_algorithm" };
  }

  return {
    secret,
    label: label.slice(0, 80),
    digits,
    period,
    algorithm,
    fromUri: true,
  };
}

function isValidSecretCandidate(token) {
  try {
    decodeBase32(token);
    return true;
  } catch {
    return false;
  }
}

export function parseSingleLine(rawLine, defaults = {}) {
  const line = String(rawLine || "").trim();
  if (!line) return null;

  const defaultDigits = Number(defaults.digits ?? 6);
  const defaultPeriod = Number(defaults.period ?? 30);
  const defaultAlgorithm = normalizeAlgorithm(defaults.algorithm ?? "SHA-1") || "SHA-1";

  // 1. otpauth:// URI (direct or embedded inside a delimited line)
  const uriMatch = line.match(/otpauth:\/\/[^\s|;]+/i);
  if (uriMatch) {
    const parsed = parseOtpAuthUri(uriMatch[0]);
    if (parsed?.error) {
      return { ok: false, raw: line, error: parsed.error };
    }
    return {
      ok: true,
      secret: parsed.secret,
      label: parsed.label || "",
      digits: parsed.digits ?? defaultDigits,
      period: parsed.period ?? defaultPeriod,
      algorithm: parsed.algorithm ?? defaultAlgorithm,
      fromUri: true,
    };
  }

  // 2. Direct single secret (with optional spaces/dashes/padding)
  if (isDigitsOnlyOtp(line)) {
    return { ok: false, raw: line, error: "otp_not_secret" };
  }
  if (isValidSecretCandidate(line)) {
    return {
      ok: true,
      secret: cleanBase32(line),
      label: "",
      digits: defaultDigits,
      period: defaultPeriod,
      algorithm: defaultAlgorithm,
      fromUri: false,
    };
  }

  // 3. Delimited account formats: email|pass|SECRET, label: SECRET, email\tpass\tSECRET
  const sepRe = line.includes("|")
    ? /\|/
    : line.includes("\t")
      ? /\t/
      : line.includes(";")
        ? /;/
        : line.includes("=")
          ? /=/
          : line.includes(":")
            ? /:/
            : null;

  if (sepRe) {
    const parts = line.split(sepRe).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // Search from right to left so account/email/password columns on the left don't win.
      let chosenIdx = -1;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const clean = cleanBase32(parts[i]);
        if (clean.length >= 16 && isValidSecretCandidate(parts[i])) {
          chosenIdx = i;
          break;
        }
      }
      if (chosenIdx === -1) {
        for (let i = parts.length - 1; i >= 0; i -= 1) {
          if (isValidSecretCandidate(parts[i])) {
            chosenIdx = i;
            break;
          }
        }
      }
      if (chosenIdx !== -1) {
        // Pick a safe display label (prefer email or first column, never expose middle password column).
        let label = "";
        if (chosenIdx > 0) {
          const emailPart = parts.slice(0, chosenIdx).find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
          if (emailPart) {
            label = emailPart;
          } else if (chosenIdx === 1) {
            label = parts[0];
          } else {
            label = parts[0];
          }
        }
        return {
          ok: true,
          secret: cleanBase32(parts[chosenIdx]),
          label: label.slice(0, 80),
          digits: defaultDigits,
          period: defaultPeriod,
          algorithm: defaultAlgorithm,
          fromUri: false,
        };
      }
    }
  }

  // 4. Fallback error classification
  try {
    decodeBase32(line);
  } catch (err) {
    return { ok: false, raw: line, error: err?.message || "invalid_base32" };
  }
  return { ok: false, raw: line, error: "invalid_base32" };
}

export function parseInputLines(text, defaults = {}) {
  const rawLines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const truncated = rawLines.length > MAX_BATCH_LINES;
  const slice = rawLines.slice(0, MAX_BATCH_LINES);
  const items = slice.map((line, index) => ({
    lineNumber: index + 1,
    ...parseSingleLine(line, defaults),
  }));

  return {
    items,
    truncated,
    totalLines: rawLines.length,
  };
}

export function errorMessageFor(code) {
  switch (code) {
    case "otp_not_secret":
      return "Itu kode 6 digit, bukan kunci setup 2FA.";
    case "invalid_length":
      return "Kunci terlalu pendek (minimal 8 karakter Base32).";
    case "unsupported_otpauth_type":
      return "Hanya format otpauth://totp yang didukung.";
    case "invalid_uri":
      return "Format tautan otpauth:// tidak valid.";
    case "invalid_digits":
      return "Jumlah digit harus 6, 7, atau 8.";
    case "invalid_period":
      return "Interval harus antara 5–300 detik.";
    case "invalid_algorithm":
      return "Algoritma harus SHA-1, SHA-256, atau SHA-512.";
    default:
      return "Format kunci Base32 tidak valid (huruf A–Z dan angka 2–7).";
  }
}
