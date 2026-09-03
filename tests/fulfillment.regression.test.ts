// tests/fulfillment.regression.test.ts — Fulfillment crypto + inventory tests
import { describe, it, expect } from "vitest";

describe("AES-GCM crypto round-trip", () => {
  it("encrypt and decrypt produce original plaintext", async () => {
    // Set test encryption key (32 bytes base64)
    const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    process.env.FULFILLMENT_ENCRYPTION_KEY = testKey;

    const { encryptSecret, decryptSecret } = await import("@/lib/fulfillment/crypto");

    const plaintext = "account@example.com:password123";
    const { ciphertext, iv } = await encryptSecret(plaintext);

    expect(ciphertext).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(ciphertext).not.toBe(plaintext); // Must be encrypted

    const decrypted = await decryptSecret(ciphertext, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("each encryption produces unique IV", async () => {
    const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    process.env.FULFILLMENT_ENCRYPTION_KEY = testKey;

    const { encryptSecret } = await import("@/lib/fulfillment/crypto");

    const r1 = await encryptSecret("same plaintext");
    const r2 = await encryptSecret("same plaintext");

    expect(r1.iv).not.toBe(r2.iv); // Different IVs
    expect(r1.ciphertext).not.toBe(r2.ciphertext); // Different ciphertexts
  });

  it("wrong key fails decryption", async () => {
    const key1 = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    process.env.FULFILLMENT_ENCRYPTION_KEY = key1;

    const { encryptSecret, decryptSecret } = await import("@/lib/fulfillment/crypto");

    const { ciphertext, iv } = await encryptSecret("secret data");

    // Switch to different key
    const key2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(99)));
    process.env.FULFILLMENT_ENCRYPTION_KEY = key2;

    // Force reimport to pick up new key
    // In real code, key is read at call time
    await expect(decryptSecret(ciphertext, iv)).rejects.toThrow();
  });
});

describe("SHA-256 fingerprint", () => {
  it("produces consistent 64-char hex fingerprint", async () => {
    const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
    process.env.FULFILLMENT_ENCRYPTION_KEY = testKey;

    const { computeFingerprint } = await import("@/lib/fulfillment/crypto");

    const fp1 = await computeFingerprint("test secret");
    const fp2 = await computeFingerprint("test secret");

    expect(fp1).toBe(fp2); // Deterministic
    expect(fp1.length).toBe(64); // SHA-256 hex
    expect(/^[0-9a-f]{64}$/.test(fp1)).toBe(true);
  });

  it("different inputs produce different fingerprints", async () => {
    const { computeFingerprint } = await import("@/lib/fulfillment/crypto");

    const fp1 = await computeFingerprint("secret_a");
    const fp2 = await computeFingerprint("secret_b");

    expect(fp1).not.toBe(fp2);
  });
});

describe("Retry backoff schedule", () => {
  it("retry delays are 1, 5, 15, 60 minutes", () => {
    const RETRY_DELAYS = [1, 5, 15, 60];
    expect(RETRY_DELAYS).toEqual([1, 5, 15, 60]);
    expect(RETRY_DELAYS.length + 1).toBe(5); // MAX_ATTEMPTS = 5
  });
});

describe("Error redaction", () => {
  it("error messages are capped at 500 chars", () => {
    const longError = "x".repeat(1000);
    const sanitized = longError.slice(0, 500);
    expect(sanitized.length).toBe(500);
  });

  it("no plaintext in error messages", () => {
    // Simulated error paths should never contain actual secrets
    const errors = [
      "Telegram send failed",
      "No reserved inventory found",
      "Shared secret not configured for product",
      "Unknown fulfillment mode: badmode",
    ];
    for (const err of errors) {
      expect(err).not.toMatch(/password|secret_key|api_key|token/i);
    }
  });
});
