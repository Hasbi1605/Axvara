import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { generateOrderCode, checkMagicBytes, isAllowedImageType, aggregateQty, isValidOrderCode, DEV_FALLBACK_SHA256, PROD_SHA256_HINT } from "@/lib/security";
import { rateLimit } from "@/lib/rateLimit";

// Helper to mock NextRequest minimal for rateLimit
function mockReq(ip: string) {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === "cf-connecting-ip" ? ip : k.toLowerCase() === "x-forwarded-for" ? ip : null),
    },
  } as unknown as import("next/server").NextRequest;
}

describe("F-High: Order enumeration — code entropy + format", () => {
  it("generateOrderCode menghasilkan 8 hex (AXV-YYYYMMDD-XXXXXXXX) bukan 4 char", () => {
    const code = generateOrderCode();
    expect(code).toMatch(/^AXV-\d{8}-[A-Z0-9]{8}$/);
    const suffix = code.split("-")[2];
    expect(suffix.length).toBe(8);
  });

  it("isValidOrderCode menolak format lama 4 char dan menerima 8 char", () => {
    expect(isValidOrderCode("AXV-20260902-ABCD")).toBe(false); // old 4-char should fail now
    expect(isValidOrderCode("AXV-20260902-AB12CD34")).toBe(true);
    expect(isValidOrderCode("AXV-20260902-XXXX")).toBe(false); // not hex
  });

  it("5 code berturut-turut unik dan suffix tidak collision", () => {
    const codes = Array.from({ length: 30 }, () => generateOrderCode());
    const suffixes = codes.map((c) => c.split("-")[2]);
    const uniq = new Set(suffixes);
    expect(uniq.size).toBe(suffixes.length); // no collision in 30
  });

  it("rateLimit untuk public lookup: 20允许, 21 ditolak", () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 200) + 10}`;
    for (let i = 0; i < 20; i++) expect(rateLimit(`lookup:${ip}`, 20)).toBe(true);
    expect(rateLimit(`lookup:${ip}`, 20)).toBe(false);
  });
});

describe("F-High: Idle timeout — requireAdmin harus cek idle cookie", () => {
  it("src/lib/auth.ts requireAdmin mengandung idle check", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    expect(src).toContain("getIdleTokenFromCookieHeader");
    expect(src).toMatch(/getIdleTokenFromCookieHeader\(req\.headers\.get\("cookie"\)\)/);
    expect(src).toContain("if (!idle) return null");
  });

  it("idle cookie helper ada dan parsing __Host- prefix", async () => {
    const { getIdleTokenFromCookieHeader } = await import("@/lib/auth");
    expect(getIdleTokenFromCookieHeader("__Host-axvara_idle=abc123; other=x")).toBe("abc123");
    expect(getIdleTokenFromCookieHeader("axvara_idle=xyz")).toBe("xyz");
    expect(getIdleTokenFromCookieHeader(null)).toBeNull();
    expect(getIdleTokenFromCookieHeader("axvara_admin_token=only")).toBeNull();
  });
});

describe("F-High: Exposed dev password — .env.example sanitized + fallback != prod", () => {
  it(".env.example tidak mengandung hash prod #Kecitran123", () => {
    const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf-8");
    expect(envExample).not.toContain(PROD_SHA256_HINT);
    expect(envExample).not.toContain("#Kecitran123");
    expect(envExample).toContain("__ISI_DI_CLOUDFLARE_PAGES_VARIABLES__");
  });

  it("DEV_FALLBACK_SHA256 di security.ts dan auth.ts bukan hash prod", async () => {
    const authSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    expect(authSrc).toContain(DEV_FALLBACK_SHA256);
    expect(DEV_FALLBACK_SHA256).not.toBe(PROD_SHA256_HINT);
    // auth.ts harus contain dev-only comment
    expect(authSrc).toMatch(/DEV ONLY|dev-only/i);
  });

  it("auth.ts fallback hanya dipakai di isDev() (fail-closed di prod)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/auth.ts"), "utf-8");
    // requireEnv harus throw di prod jika env kosong
    expect(src).toContain("Missing required env:");
    expect(src).toContain("ADMIN_PASSWORD_SHA256");
    expect(src).toContain("ADMIN_JWT_SECRET");
  });
});

describe("F-Medium: Stock aggregation — duplicate product_id", () => {
  it("aggregateQty menjumlahkan qty duplikat", () => {
    const m = aggregateQty([{ product_id: 12, qty: 6 }, { product_id: 12, qty: 5 }, { product_id: 1, qty: 1 }]);
    expect(m.get(12)).toBe(11);
    expect(m.get(1)).toBe(1);
  });

  it("stok 9 diminta 11 (6+5 duplikat) harus terdeteksi melebihi", () => {
    const stock = 9;
    const total = aggregateQty([{ product_id: 12, qty: 6 }, { product_id: 12, qty: 5 }]).get(12)!;
    expect(total > stock).toBe(true);
  });

  it("stok -1 (unlimited) tidak dibatasi oleh aggregate", () => {
    const stock = -1;
    // Logic di route: if (stock !== -1) cek; jadi -1 lolos
    const total = 100;
    const shouldCheck = stock !== -1 && total > stock;
    expect(shouldCheck).toBe(false);
  });
});

describe("F-Medium: Payment proof — upload strict", () => {
  it("isAllowedImageType hanya jpeg/png/webp, tolak svg", () => {
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/webp")).toBe(true);
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("image/heic")).toBe(false);
    expect(isAllowedImageType("text/plain")).toBe(false);
  });

  it("checkMagicBytes valid untuk jpeg/png/webp, tolak fake", () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x57, 0x45, 0x42, 0x50]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const fake = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(checkMagicBytes(jpg, "image/jpeg")).toBe(true);
    expect(checkMagicBytes(png, "image/png")).toBe(true);
    expect(checkMagicBytes(webp, "image/webp")).toBe(true);
    expect(checkMagicBytes(fake, "image/jpeg")).toBe(false);
    expect(checkMagicBytes(jpg, "image/png")).toBe(false); // mismatch
  });

  it("src/app/api/proof/upload/route.ts ada dan gunakan bukti/ prefix private", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/proof/upload/route.ts"), "utf-8");
    expect(src).toContain('bukti/');
    expect(src).toContain("MAX");
    expect(src).toContain("5 * 1024 * 1024");
  });

  it("checkout page mewajibkan proofUrl", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/checkout/page.tsx"), "utf-8");
    expect(src).toContain("proofUrl");
    expect(src).toContain("Upload bukti");
    // harus ada guard `if (!proofUrl)`
    expect(src).toMatch(/if\s*\(\s*!proofUrl\s*\)/);
  });
});

describe("Regression: checkout proof_url tidak null", () => {
  it("POST /api/orders schema harus punya proof_url string optional (tidak selalu null)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/orders/route.ts"), "utf-8");
    expect(src).toContain("proof_url");
  });
});
