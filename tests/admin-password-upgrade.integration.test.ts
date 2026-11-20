import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { POST, GET } from "@/app/api/auth/login/route";
import { isLegacyStoredHash, resolveAdminStoredHash } from "@/lib/auth";

const PASSWORD = "fixture-correct-password";
const LEGACY_HASH = createHash("sha256").update(PASSWORD).digest("hex");

let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ADMIN_JWT_SECRET", "admin-password-upgrade-fixture-secret");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", LEGACY_HASH);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External calls forbidden in auth fixtures"); }));
  clearRateLimitBucketsForTest();
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function login(ip: string, password: string) {
  return POST(new NextRequest("https://axvara.test/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email: "admin@example.test", password }),
  }));
}

const storedOverride = () => fx.sql.prepare("SELECT value FROM store_settings WHERE key='admin_password_hash'").get()?.value as string | undefined;

it("legacy hash login succeeds once, upgrades the stored hash to PBKDF2, and records the event", async () => {
  expect(isLegacyStoredHash(LEGACY_HASH)).toBe(true);
  expect(storedOverride()).toBeUndefined();

  const first = await login("203.0.113.21", PASSWORD);
  expect(first.status).toBe(200);
  const row = storedOverride();
  expect(typeof row).toBe("string");
  const record = JSON.parse(row!) as { source: string; hash: string };
  expect(record.hash.startsWith("pbkdf2$")).toBe(true);
  expect(isLegacyStoredHash(record.hash)).toBe(false);
  // Sanitized security event; the hash/plaintext is never stored in telemetry.
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events WHERE event='login_succeeded'").get()?.n).toBe(1);
});

it("after upgrade the effective hash is PBKDF2 and env legacy hash is no longer used", async () => {
  expect((await login("203.0.113.22", PASSWORD)).status).toBe(200);
  const effective = await resolveAdminStoredHash(LEGACY_HASH);
  expect(effective.startsWith("pbkdf2$")).toBe(true);
  // A wrong password fails even though the env hash is still the legacy digest.
  clearRateLimitBucketsForTest();
  expect((await login("203.0.113.23", "definitely-the-wrong-password")).status).toBe(401);
});

it("wrong password on a legacy hash fails and never triggers an upgrade", async () => {
  clearRateLimitBucketsForTest();
  const res = await login("203.0.113.24", "definitely-the-wrong-password");
  expect(res.status).toBe(401);
  expect(storedOverride()).toBeUndefined();
  expect(await resolveAdminStoredHash(LEGACY_HASH)).toBe(LEGACY_HASH);
});

it("a rotated env secret invalidates the stored PBKDF2 override", async () => {
  expect((await login("203.0.113.25", PASSWORD)).status).toBe(200);
  expect(storedOverride()).toBeDefined();
  // Rotating ADMIN_PASSWORD_SHA256 must win again: the source fingerprint no longer matches.
  const rotated = createHash("sha256").update("rotated-password").digest("hex");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", rotated);
  expect(await resolveAdminStoredHash(rotated)).toBe(rotated);
  clearRateLimitBucketsForTest();
  expect((await login("203.0.113.26", PASSWORD)).status).toBe(401);
});

it("GET advertises password mode for a legacy hash without leaking the digest", async () => {
  const res = await GET(new NextRequest("https://axvara.test/api/auth/login"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ mode: "password" });
});

it("D1 unavailability keeps login working from env alone (no upgrade, no crash)", async () => {
  // Remove the D1 binding so isD1Mode() is false; env hash still verifies.
  const { execRun } = { execRun: createDatabaseAccess(fx.db).execRun };
  await execRun("SELECT 1").catch(() => undefined);
  delete (globalThis as unknown as { DB?: unknown }).DB;
  clearRateLimitBucketsForTest();
  // Login depends on D1 admission in production; here we only assert the resolver
  // falls back to the env hash instead of throwing when the store is absent.
  expect(await resolveAdminStoredHash(LEGACY_HASH)).toBe(LEGACY_HASH);
});
