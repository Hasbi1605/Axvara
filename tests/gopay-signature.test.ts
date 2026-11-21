// tests/gopay-signature.test.ts — AU-J2-1: raw unit coverage for the GoPay
// poller HMAC gate (money webhook). The route-level integration test exercises
// the happy/tamper paths, but nothing pinned the verifier's own encoding,
// hex-format and byte-exactness rules. Independent digest computed with
// node:crypto so the test does not mirror the implementation.
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGopaySignature } from "@/lib/payments/gopay-signature";

const SECRET = "gopay-poller-fixture-secret";
const sign = (body: string, secret = SECRET, enc: "utf8" | "latin1" = "utf8") =>
  createHmac("sha256", secret).update(body, enc).digest("hex");

const BODY = JSON.stringify({
  amount: 9017,
  order_code: "AXV-20261121-GOPAY001",
  sender_name: "Budi",
  transaction_status: "settlement",
});

describe("verifyGopaySignature", () => {
  it("accepts an HMAC-SHA256 hex digest computed over the raw UTF-8 body", async () => {
    expect(await verifyGopaySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", async () => {
    expect(await verifyGopaySignature(BODY, sign(BODY, "other-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered amount even when the original signature is replayed", async () => {
    const signature = sign(BODY);
    const tampered = BODY.replace('"amount":9017', '"amount":1');
    expect(tampered).not.toBe(BODY);
    expect(await verifyGopaySignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a tampered transaction status even when the amount is unchanged", async () => {
    const signature = sign(BODY);
    const tampered = BODY.replace('"transaction_status":"settlement"', '"transaction_status":"capture"');
    expect(await verifyGopaySignature(tampered, signature, SECRET)).toBe(false);
  });

  it("is byte-exact: reordering or whitespace changes invalidate the digest", async () => {
    const signature = sign(BODY);
    const pretty = JSON.parse(BODY) as Record<string, unknown>;
    const spaced = JSON.stringify(pretty, null, 2);
    expect(await verifyGopaySignature(spaced, signature, SECRET)).toBe(false);
  });

  it("rejects missing, empty or malformed signatures before any HMAC work", async () => {
    for (const bad of ["", " ", "not-hex", "a".repeat(63), "a".repeat(65), "g".repeat(64)]) {
      expect(await verifyGopaySignature(BODY, bad, SECRET)).toBe(false);
    }
    // Uppercase hex is the same digest but the contract only accepts lowercase.
    expect(await verifyGopaySignature(BODY, sign(BODY).toUpperCase(), SECRET)).toBe(false);
  });

  it("verifies multibyte bodies as UTF-8 (not latin1)", async () => {
    const unicodeBody = JSON.stringify({ sender_name: "Budi — ✓", amount: 10_000 });
    expect(await verifyGopaySignature(unicodeBody, sign(unicodeBody), SECRET)).toBe(true);
    // A digest over the wrong byte encoding must not pass.
    expect(await verifyGopaySignature(unicodeBody, sign(unicodeBody, SECRET, "latin1"), SECRET)).toBe(false);
  });

  it("signs the empty body as an empty byte string (documents the verifier contract)", async () => {
    expect(await verifyGopaySignature("", sign(""), SECRET)).toBe(true);
  });

  it("a valid-format but wrong digest is rejected", async () => {
    expect(await verifyGopaySignature(BODY, "0".repeat(64), SECRET)).toBe(false);
  });
});
