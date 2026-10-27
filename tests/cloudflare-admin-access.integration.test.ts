import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";

const domain = "axvara-fixture.cloudflareaccess.com", audience = "a".repeat(64);
const owner = "owner@example.test", password = "fixture-unchanged-password";
let pair: Awaited<ReturnType<typeof generateKeyPair>>, attacker: typeof pair;
let jwk: Awaited<ReturnType<typeof exportJWK>>, fx: ReturnType<typeof createD1Fixture>;
let network: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256"); attacker = await generateKeyPair("RS256");
  jwk = { ...await exportJWK(pair.publicKey), kid: "fixture-key", alg: "RS256", use: "sig" };
});
beforeEach(() => {
  vi.resetModules(); fx = createD1Fixture();
  vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", domain); vi.stubEnv("CF_ACCESS_AUD", audience);
  vi.stubEnv("ADMIN_EMAIL", owner); vi.stubEnv("ADMIN_JWT_SECRET", "local-access-fixture-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", createHash("sha256").update(password).digest("hex"));
  network = vi.fn(async () => Response.json({ keys: [jwk] })); vi.stubGlobal("fetch", network);
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function access(claims: Record<string, unknown> = {}, key = pair.privateKey) {
  return new SignJWT({ email: owner, ...claims }).setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
    .setIssuer(`https://${domain}`).setAudience(audience).setSubject("fixture-owner")
    .setIssuedAt().setExpirationTime("1h").sign(key);
}
async function cookies() {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const session = await createAdminToken(owner);
  return `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
}
function login(token?: string, email = owner) {
  return new NextRequest("https://axvara.pages.dev/api/auth/login", { method: "POST", headers: {
    "content-type": "application/json", "cf-connecting-ip": "203.0.113.123",
    ...(token ? { "cf-access-jwt-assertion": token } : {}),
  }, body: JSON.stringify({ email, password }) });
}

it("validates the signed assertion or domain cookie with a pinned, cached JWKS and sends no user credentials upstream", async () => {
  const { checkCloudflareAccess } = await import("@/lib/cloudflare-access");
  const token = await access();
  const requests: HeadersInit[] = [{ "cf-access-jwt-assertion": token }, { cookie: `CF_Authorization=${token}; private=do-not-forward` }];
  for (const headers of requests) {
    expect(await checkCloudflareAccess(new Request("https://axvara.test/api/products/1", { headers }))).toEqual({ ok: true });
  }
  expect(network).toHaveBeenCalledTimes(1);
  const [url, init] = network.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe(`https://${domain}/cdn-cgi/access/certs`);
  expect(init.redirect).toBe("manual");
  const headers = new Headers(init.headers);
  expect(headers.has("cookie")).toBe(false); expect(headers.has("authorization")).toBe(false);
});

it("rejects forged, unsigned, wrong audience/issuer/email, expired, and service tokens", async () => {
  const { checkCloudflareAccess } = await import("@/lib/cloudflare-access");
  const base = () => new SignJWT({ email: owner }).setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
    .setIssuedAt().setSubject("fixture-owner").setIssuer(`https://${domain}`).setAudience(audience).setExpirationTime("1h");
  const tokens = [await access({}, attacker.privateKey), "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUudGVzdCJ9.",
    await base().setAudience("b".repeat(64)).sign(pair.privateKey), await base().setIssuer("https://attacker.test").sign(pair.privateKey),
    await access({ email: "someone-else@example.test" }), await base().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(pair.privateKey),
    await access({ email: undefined })];
  for (const token of tokens) expect(await checkCloudflareAccess(new Request("https://axvara.pages.dev/api/auth/login", {
    headers: { "cf-access-jwt-assertion": token },
  }))).toEqual({ ok: false, reason: "access_required" });
});

it("blocks direct Pages and Pedia login before password challenge/admission, even with the correct password", async () => {
  const { GET, POST } = await import("@/app/api/auth/login/route");
  for (const host of ["axvara.pages.dev", "pedia.axvara.tech"]) {
    expect((await GET(new NextRequest(`https://${host}/api/auth/login`))).status).toBe(401);
    const response = await POST(new NextRequest(`https://${host}/api/auth/login`, login()));
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
  }
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_auth_attempts").get()?.n).toBe(0);
  expect(network).not.toHaveBeenCalled();
});

it("requires both application cookies and Access for mixed API routes, while public catalog stays public", async () => {
  const cookie = await cookies();
  const { requireAdminDetailed } = await import("@/lib/auth");
  const req = new NextRequest("https://axvara.pages.dev/api/products/1", { headers: { cookie } });
  expect(await requireAdminDetailed(req)).toEqual({ ok: false, reason: "access_required" });
  const { GET } = await import("@/app/api/products/[id]/route");
  expect((await GET(req, { params: Promise.resolve({ id: "1" }) })).status).toBe(401);
  const token = await access();
  expect((await requireAdminDetailed(new Request(req.url, { headers: { cookie: `${cookie}; CF_Authorization=${token}` } }))).ok).toBe(true);
  expect((await requireAdminDetailed(new Request(req.url, { headers: { "cf-access-jwt-assertion": token } }))).ok).toBe(false);
  await insertTestProduct(fx.sql, "manual", 1);
  const publicList = await import("@/app/api/products/route");
  expect((await publicList.GET(new NextRequest("https://axvara.test/api/products"))).status).toBe(200);
});

it("keeps the password unchanged and revokes old-email sessions after switching ADMIN_EMAIL", async () => {
  const cookie = await cookies(); vi.stubEnv("ADMIN_EMAIL", "new-owner@example.test");
  const { POST } = await import("@/app/api/auth/login/route");
  const token = await access({ email: "new-owner@example.test" });
  const response = await POST(login(token, "new-owner@example.test"));
  expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("axvara_admin_token=");
  expect((await POST(login(token, owner))).status).toBe(401);
  const { requireAdminDetailed } = await import("@/lib/auth");
  expect((await requireAdminDetailed(new Request("https://axvara.test/api/admin/overview", {
    headers: { cookie, "cf-access-jwt-assertion": token },
  }))).ok).toBe(false);
});

it("fails closed on unavailable JWKS without issuing or refreshing cookies", async () => {
  network.mockRejectedValue(new Error("Fixture JWKS unavailable"));
  const token = await access(), cookie = await cookies();
  const { POST } = await import("@/app/api/auth/login/route");
  expect((await POST(login(token))).status).toBe(503);
  for (const path of ["me", "refresh"]) {
    const route = path === "me" ? await import("@/app/api/auth/me/route") : await import("@/app/api/auth/refresh/route");
    const response = await route.GET(new NextRequest(`https://axvara.test/api/auth/${path}`, { headers: { cookie, "cf-access-jwt-assertion": token } }));
    expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toBeNull();
  }
});

it("reports an expired Access session separately from the app session for renewal", async () => {
  const cookie = await cookies();
  const { GET } = await import("@/app/api/auth/me/route");
  const response = await GET(new NextRequest("https://axvara.test/api/auth/me", { headers: { cookie } }));
  expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ reason: "access_required" });
  expect(response.headers.get("x-axvara-admin-access")).toBe("access_required");
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("stops trusting cached keys after their ten-minute TTL when JWKS refresh fails", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const { checkCloudflareAccess } = await import("@/lib/cloudflare-access");
    const req = new Request("https://axvara.test/api/products/1", { headers: { "cf-access-jwt-assertion": await access() } });
    expect(await checkCloudflareAccess(req)).toEqual({ ok: true });
    vi.setSystemTime(Date.now() + 11 * 60_000); network.mockRejectedValue(new Error("Offline after cache TTL"));
    expect(await checkCloudflareAccess(req)).toEqual({ ok: false, reason: "access_unavailable" });
    expect(network).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it("production missing/partial config and malicious team domains fail closed; only unconfigured development bypasses", async () => {
  const { checkCloudflareAccess } = await import("@/lib/cloudflare-access");
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", ""); vi.stubEnv("CF_ACCESS_AUD", "");
  expect(await checkCloudflareAccess()).toEqual({ ok: false, reason: "access_unavailable" });
  vi.stubEnv("NODE_ENV", "test"); expect(await checkCloudflareAccess()).toEqual({ ok: true });
  vi.stubEnv("CF_ACCESS_AUD", audience);
  for (const value of ["", "127.0.0.1", "attacker.test", "https://axvara.cloudflareaccess.com", "axvara.cloudflareaccess.com/evil"]) {
    vi.stubEnv("CF_ACCESS_TEAM_DOMAIN", value);
    expect(await checkCloudflareAccess()).toEqual({ ok: false, reason: "access_unavailable" });
  }
  expect(network).not.toHaveBeenCalled();
});

it("redirects alternate-domain admin UI to the canonical protected hostname before Pedia rewrite", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PEDIA_ENABLED", "true");
  const { middleware } = await import("@/middleware");
  for (const host of ["pedia.axvara.tech", "release.axvara.pages.dev", "www.axvara.tech"]) {
    const response = await middleware(new NextRequest(`https://${host}/admin?section=orders`, { headers: { host } }));
    expect(response.status).toBe(307); expect(response.headers.get("location")).toBe("https://axvara.tech/admin?section=orders");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});
