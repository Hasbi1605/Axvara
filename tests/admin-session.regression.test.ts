// tests/admin-session.regression.test.ts — Issue #8: penguatan sesi admin
//
// Audit 7 Sep 2026: JWT valid + cookie idle sembarang tetap diterima.
// requireAdmin hanya memeriksa keberadaan cookie idle (`if (!idle) return
// null`) tanpa memvalidasi signature, expiry, binding sesi, maupun revokasi.
//
// Perilaku yang seharusnya setelah perbaikan:
// - Cookie idle adalah JWT HS256 (purpose admin_idle, exp 2 jam) yang
//   diterbitkan server saat login/refresh; nilai sembarang/palsu ditolak.
// - Idle terikat ke sesi login via `sid` yang sama dengan admin JWT.
// - Batas idle 2 jam ditegakkan di server (bukan hanya Max-Age cookie).
// - Refresh aktivitas memvalidasi penuh sebelum menerbitkan idle baru.
// - Token lama gugur setelah rotasi password (claim `av` = auth version).
// - Admin auth cookie-only; Bearer admin JWT tanpa cookie tidak diterima
//   (jalur integrasi resmi memakai agent Bearer tokens via requireAgent).
import { describe, expect, it, beforeEach, vi } from "vitest";

const EMAIL = "admin@axvara.tech";
const JWT_SECRET = "test-admin-session-secret-0123456789";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function setEnv(hash = HASH_A) {
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_JWT_SECRET = JWT_SECRET;
  process.env.ADMIN_PASSWORD_SHA256 = hash;
  vi.stubEnv("NODE_ENV", "test");
}

function reqWithCookies(cookie: string): Request {
  return new Request("https://axvara.tech/api/admin/overview", {
    headers: { cookie },
  });
}

async function loginPair() {
  const auth = await import("@/lib/auth");
  const { token, sid } = await auth.createAdminToken(EMAIL);
  const idle = await auth.createIdleToken(sid);
  return { auth, token, sid, idle };
}

function cookies(token: string, idle: string): string {
  return `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`;
}

describe("issue #8: cookie idle sembarang tidak boleh diterima", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv(HASH_A);
  });

  it("JWT valid + idle 'sembarang' ditolak", async () => {
    const { auth, token } = await loginPair();
    const res = await auth.requireAdmin(reqWithCookies(cookies(token, "sembarang")));
    expect(res).toBeNull();
  });

  it("idle dari sesi lain (sid tidak terikat) ditolak", async () => {
    const { auth, token } = await loginPair();
    const foreignIdle = await auth.createIdleToken("sid-lain-yang-valid");
    const res = await auth.requireAdmin(reqWithCookies(cookies(token, foreignIdle)));
    expect(res).toBeNull();
  });

  it("idle kedaluwarsa (>2 jam) ditolak walau JWT masih hidup", async () => {
    const { auth, token, sid } = await loginPair();
    const expiredIdle = await auth.createIdleToken(sid, {
      issuedAtMs: Date.now() - 3 * 60 * 60 * 1000,
    });
    const res = await auth.requireAdmin(reqWithCookies(cookies(token, expiredIdle)));
    expect(res).toBeNull();
  });

  it("idle bertanda tangan dengan secret lain ditolak", async () => {
    const { auth, token } = await loginPair();
    process.env.ADMIN_JWT_SECRET = "secret-lain-yang-salah-0123456789";
    const forgedIdle = await auth.createIdleToken("sembarang-sid");
    process.env.ADMIN_JWT_SECRET = JWT_SECRET;
    const res = await auth.requireAdmin(reqWithCookies(cookies(token, forgedIdle)));
    expect(res).toBeNull();
  });

  it("refresh dengan idle palsu 401 dan tidak menerbitkan idle baru", async () => {
    const { token } = await loginPair();
    const mod = await import("@/app/api/auth/refresh/route");
    const res = await mod.POST(
      reqWithCookies(cookies(token, "palsu")) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(401);
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""];
    expect(setCookies.join(";")).not.toContain("axvara_idle=");
  });

  it("refresh valid memutar idle baru yang terikat sid yang sama", async () => {
    const { auth, token, sid, idle } = await loginPair();
    const mod = await import("@/app/api/auth/refresh/route");
    const res = await mod.POST(
      reqWithCookies(cookies(token, idle)) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""];
    const joined = setCookies.join(";");
    const freshIdle = decodeURIComponent((joined.match(/axvara_idle=([^;]+)/) ?? [])[1] ?? "");
    expect(freshIdle).toBeTruthy();
    expect(freshIdle).not.toBe(idle);
    const parsed = await auth.verifyIdleToken(freshIdle);
    expect(parsed?.sid).toBe(sid);
  });

  it("token lama gugur setelah rotasi password (revokasi eksplisit)", async () => {
    const { auth, token, idle } = await loginPair();
    expect(await auth.requireAdmin(reqWithCookies(cookies(token, idle)))).not.toBeNull();
    // Rotasi password di Pages Secrets → seluruh sesi lama harus gugur.
    setEnv(HASH_B);
    const after = await auth.requireAdmin(reqWithCookies(cookies(token, idle)));
    expect(after).toBeNull();
    const detailed = await auth.requireAdminDetailed(reqWithCookies(cookies(token, idle)));
    expect(detailed).toEqual({ ok: false, reason: "revoked" });
    // Login baru dengan kredensial baru tetap bisa masuk.
    const fresh = await loginPair();
    expect(
      await fresh.auth.requireAdmin(
        reqWithCookies(cookies(fresh.token, fresh.idle)),
      ),
    ).not.toBeNull();
  });

  it("Bearer admin JWT tanpa cookie ditolak; jalur agent tidak tersentuh", async () => {
    const { auth, token } = await loginPair();
    const bearerOnly = new Request("https://axvara.tech/api/admin/overview", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await auth.requireAdmin(bearerOnly)).toBeNull();
    // requireAgent (jalur integrasi MCP resmi) tetap memakai Bearer dan tidak
    // ikut berubah oleh pengetatan sesi admin.
    const agentSrc = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/agent-auth.ts", "utf8"),
    );
    expect(agentSrc).toContain('auth.startsWith("Bearer ")');
  });

  it("logout mencabut sesi: replay cookie lama ditolak, sesi lain hidup", async () => {
    const first = await loginPair();
    const second = await loginPair();
    expect(await first.auth.requireAdmin(reqWithCookies(cookies(first.token, first.idle)))).not.toBeNull();
    expect(await second.auth.requireAdmin(reqWithCookies(cookies(second.token, second.idle)))).not.toBeNull();

    // R8: logout sesi pertama via route — replay cookie lamanya harus gugur.
    const logout = await import("@/app/api/auth/logout/route");
    const logoutReq = new Request("https://axvara.tech/api/auth/logout", {
      method: "POST",
      headers: { cookie: cookies(first.token, first.idle) },
    });
    const logoutRes = await logout.POST(logoutReq as unknown as import("next/server").NextRequest);
    expect(logoutRes.status).toBe(200);

    expect(await first.auth.requireAdmin(reqWithCookies(cookies(first.token, first.idle)))).toBeNull();
    expect(await first.auth.requireAdminDetailed(reqWithCookies(cookies(first.token, first.idle))))
      .toEqual({ ok: false, reason: "revoked" });
    // Sesi kedua (perangkat lain) tidak tersentuh logout sesi pertama.
    expect(await second.auth.requireAdmin(reqWithCookies(cookies(second.token, second.idle)))).not.toBeNull();
  });

  it("logout menghapus kedua cookie; alasan gagal dibedakan untuk UX", async () => {
    const logout = await import("@/app/api/auth/logout/route");
    const res = await logout.POST(
      reqWithCookies("axvara_admin_token=x; axvara_idle=y") as unknown as import("next/server").NextRequest,
    );
    const cleared = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""];
    expect(cleared.join(";")).toContain("Max-Age=0");

    const { auth, token, idle } = await loginPair();
    expect(await auth.requireAdminDetailed(reqWithCookies(cookies(token, idle)))).toMatchObject({ ok: true });
    expect(await auth.requireAdminDetailed(reqWithCookies(cookies(token, "sembarang")))).toEqual({
      ok: false,
      reason: "idle_timeout",
    });
    expect(await auth.requireAdminDetailed(reqWithCookies(""))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("alur resmi hijau: login → me → refresh → idle lama format baru valid", async () => {
    const { auth, token, idle } = await loginPair();
    const me = await import("@/app/api/auth/me/route");
    const meRes = await me.GET(
      reqWithCookies(cookies(token, idle)) as unknown as import("next/server").NextRequest,
    );
    expect(meRes.status).toBe(200);
    expect(await auth.verifyIdleToken(idle)).toMatchObject({ sid: expect.any(String) });
  });
});
