// tests/auth-dev-secret.regression.test.ts — Fallback JWT development.
//
// Akar "login berhasil lalu langsung keluar lagi": fallback dev dulu diacak
// per module-instance (`Math.random()`), sehingga setiap isolate/bundle
// memegang secret berbeda. Cookie yang ditandatangani saat login gagal
// diverifikasi oleh /api/auth/me yang berjalan di isolate lain.
//
// Kontrak yang dikunci:
//  1. Dev tanpa ADMIN_JWT_SECRET: token TETAP dapat diverifikasi lintas
//     pembacaan modul (deterministik).
//  2. ADMIN_JWT_SECRET yang di-set TETAP menang atas fallback.
//  3. Production TANPA ADMIN_JWT_SECRET tetap fail-closed (melempar),
//     sehingga konstanta dev tidak pernah dipakai menandatangani produksi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("fallback JWT dev bersifat deterministik", () => {
  it("token dev tetap valid walau modul auth dimuat ulang (isolate berbeda)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_JWT_SECRET", "");
    vi.stubEnv("ADMIN_EMAIL", "dev@axvara.tech");

    const first = await import("@/lib/auth");
    const { token } = await first.createAdminToken("dev@axvara.tech");

    // Simulasi isolate/bundle kedua: modul dimuat ulang dari nol.
    vi.resetModules();
    const second = await import("@/lib/auth");
    const payload = await second.verifyAdminToken(token);

    expect(payload, "secret acak per-modul membuat verifikasi ini null").not.toBeNull();
    expect(payload?.email).toBe("dev@axvara.tech");
  });

  it("ADMIN_JWT_SECRET eksplisit tetap menang atas fallback dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_JWT_SECRET", "secret-lokal-yang-dipilih-admin");
    vi.stubEnv("ADMIN_EMAIL", "dev@axvara.tech");
    const withSecret = await import("@/lib/auth");
    const { token } = await withSecret.createAdminToken("dev@axvara.tech");

    // Secret berbeda → token lama harus DITOLAK (bukan diterima fallback).
    vi.resetModules();
    vi.stubEnv("ADMIN_JWT_SECRET", "secret-lain-sama-sekali-0123456789");
    const other = await import("@/lib/auth");
    expect(await other.verifyAdminToken(token)).toBeNull();
  });
});

describe("production tetap fail-closed", () => {
  it("tanpa ADMIN_JWT_SECRET, production melempar dan TIDAK memakai konstanta dev", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_JWT_SECRET", "");
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
    const auth = await import("@/lib/auth");
    await expect(auth.createAdminToken("admin@axvara.tech")).rejects.toThrow(/ADMIN_JWT_SECRET/);
  });
});
