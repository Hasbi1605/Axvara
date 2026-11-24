import { describe, expect, it } from "vitest";
import {
  cleanBase32,
  counterToBytes,
  decodeBase32,
  errorMessageFor,
  formatOtpDisplay,
  generateTotp,
  maskSecret,
  parseInputLines,
  parseOtpAuthUri,
  parseSingleLine,
} from "../2fa/public/totp.js";

// RFC 6238 Appendix B official ASCII test seeds encoded in Base32:
// SHA-1   (20 bytes): "12345678901234567890"
const SEED_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
// SHA-256 (32 bytes): "12345678901234567890123456789012"
const SEED_SHA256 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
// SHA-512 (64 bytes): "1234567890123456789012345678901234567890123456789012345678901234"
const SEED_SHA512 =
  "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";

describe("AXVARA 2FA TOTP engine (RFC 6238 / RFC 4226 / RFC 4648)", () => {
  it("matches all RFC 6238 Appendix B test vectors for SHA-1, SHA-256, and SHA-512", async () => {
    const vectors: Array<[number, string, string, string]> = [
      [59, "94287082", "46119246", "90693936"],
      [1111111109, "07081804", "68084774", "25091201"],
      [1111111111, "14050471", "67062674", "99943326"],
      [1234567890, "89005924", "91819424", "93441116"],
      [2000000000, "69279037", "90698825", "38618901"],
      [20000000000, "65353130", "77737706", "47863826"],
    ];

    for (const [sec, sha1, sha256, sha512] of vectors) {
      const ts = sec * 1000;
      expect((await generateTotp(SEED_SHA1, { digits: 8, period: 30, algorithm: "SHA-1", timestampMs: ts })).code).toBe(sha1);
      expect((await generateTotp(SEED_SHA256, { digits: 8, period: 30, algorithm: "SHA-256", timestampMs: ts })).code).toBe(sha256);
      expect((await generateTotp(SEED_SHA512, { digits: 8, period: 30, algorithm: "SHA-512", timestampMs: ts })).code).toBe(sha512);
    }
  });

  it("produces standard 6-digit codes, nextCode preview, and accurate remaining seconds", async () => {
    const res = await generateTotp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", {
      digits: 6,
      period: 30,
      algorithm: "SHA-1",
      timestampMs: 59_000,
      includeNext: true,
    });
    expect(res.code).toBe("287082"); // last 6 digits of 94287082
    expect(res.remaining).toBe(1);
    expect(res.counter).toBe(1);
    expect(res.nextCode).toHaveLength(6);

    const nextDirect = await generateTotp(SEED_SHA1, {
      digits: 6,
      period: 30,
      algorithm: "SHA-1",
      timestampMs: 60_000,
    });
    expect(res.nextCode).toBe(nextDirect.code);
    expect(nextDirect.remaining).toBe(30);
  });

  it("handles Base32 normalization, permissive non-multiple-of-8 secrets, and rejects invalid inputs", () => {
    expect(cleanBase32(" jbsw-y3dp ehpk 3pxp== ")).toBe("JBSWY3DPEHPK3PXP");
    const decoded = decodeBase32("JBSWY3DPEHPK3PXP");
    expect(new TextDecoder().decode(decoded)).toBe("Hello!\xde\xad\xbe\xef".slice(0, 6) + new TextDecoder().decode(decoded.slice(6)));
    expect(decoded.length).toBe(10);

    // Non-canonical length (22 chars, mod 6) still decodes permissively like 2fa.live / Google Authenticator.
    expect(decodeBase32("JBSWY3DPEHPK3PXPJBSWY3").length).toBe(13);

    expect(() => decodeBase32("123456")).toThrow("otp_not_secret");
    expect(() => decodeBase32("123 456")).toThrow("otp_not_secret");
    expect(() => decodeBase32("ABC")).toThrow("invalid_length");
    expect(() => decodeBase32("INVALID0189SECRET")).toThrow("invalid_base32");
  });

  it("encodes 64-bit counters beyond 32-bit Unix timestamps accurately", () => {
    const bytes = counterToBytes(666_666_666);
    expect(bytes).toEqual(new Uint8Array([0, 0, 0, 0, 0x27, 0xbc, 0x86, 0xaa]));
    const huge = counterToBytes(0x1_0000_0005);
    expect(huge).toEqual(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 5]));
  });

  it("parses otpauth://totp URIs including issuer, account label, digits, period, and algorithm", () => {
    const parsed = parseOtpAuthUri(
      "otpauth://totp/OpenAI:buyer%40axvara.tech?secret=JBSWY3DPEHPK3PXP&issuer=OpenAI&digits=8&period=60&algorithm=SHA256",
    );
    expect(parsed).toEqual({
      secret: "JBSWY3DPEHPK3PXP",
      label: "OpenAI · buyer@axvara.tech",
      digits: 8,
      period: 60,
      algorithm: "SHA-256",
      fromUri: true,
    });

    expect(parseOtpAuthUri("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP")).toEqual({
      error: "unsupported_otpauth_type",
    });
  });

  it("parses single, bulk, and email|password|secret lines without exposing the password segment", () => {
    const accountLine = parseSingleLine("buyer@gmail.com|SuperSecretPass!99|JBSW Y3DP EHPK 3PXP");
    expect(accountLine).toEqual({
      ok: true,
      secret: "JBSWY3DPEHPK3PXP",
      label: "buyer@gmail.com",
      digits: 6,
      period: 30,
      algorithm: "SHA-1",
      fromUri: false,
    });
    expect(JSON.stringify(accountLine)).not.toContain("SuperSecretPass!99");

    const colonLine = parseSingleLine("ChatGPT Plus: JBSWY3DPEHPK3PXP");
    expect(colonLine?.ok).toBe(true);
    expect(colonLine && "label" in colonLine ? colonLine.label : "").toBe("ChatGPT Plus");

    const otpLine = parseSingleLine("482910");
    expect(otpLine).toEqual({ ok: false, raw: "482910", error: "otp_not_secret" });
    expect(errorMessageFor("otp_not_secret")).toContain("6 digit");
  });

  it("caps bulk batches at 50 lines and formats display/masked strings cleanly", () => {
    const lines = Array.from({ length: 55 }, () => "JBSWY3DPEHPK3PXP").join("\n");
    const batch = parseInputLines(lines);
    expect(batch.truncated).toBe(true);
    expect(batch.totalLines).toBe(55);
    expect(batch.items).toHaveLength(50);

    expect(formatOtpDisplay("123456")).toBe("123 456");
    expect(formatOtpDisplay("12345678")).toBe("1234 5678");
    expect(maskSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW···3PXP");
  });
});
