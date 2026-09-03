// src/lib/fulfillment/crypto.ts — AES-256-GCM encryption + SHA-256 fingerprint
// Edge-compatible via WebCrypto API. No Node.js crypto module.

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const TAG_LENGTH = 128; // 128-bit auth tag

function getEncryptionKey(): string {
  const key = process.env.FULFILLMENT_ENCRYPTION_KEY;
  if (!key) throw new Error("FULFILLMENT_ENCRYPTION_KEY not configured");
  return key;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  // Normalize base64url to base64
  const normalized = base64Key.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const raw = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

  if (raw.length !== 32) {
    throw new Error(`Encryption key must be exactly 32 bytes, got ${raw.length}`);
  }

  return crypto.subtle.importKey("raw", raw, { name: ALGORITHM, length: KEY_LENGTH }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext secret. Returns { ciphertext, iv } as base64 strings.
 * Each call generates a fresh random IV.
 */
export async function encryptSecret(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(getEncryptionKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoded,
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt a secret from its ciphertext and IV (both base64).
 * Returns plaintext string. Throws on wrong key or tampered data.
 */
export async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await importKey(getEncryptionKey());
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ciphertextBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBytes, tagLength: TAG_LENGTH },
    key,
    ciphertextBytes,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Compute SHA-256 fingerprint of plaintext. Used to prevent duplicate imports
 * without storing the plaintext.
 */
export async function computeFingerprint(plaintext: string): Promise<string> {
  const encoded = new TextEncoder().encode(plaintext);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
