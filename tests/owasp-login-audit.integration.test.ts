import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createDatabaseAccess } from "@/lib/db-access";
import { loginClientHash, admitLogin, resetLogin, LOGIN_WINDOW_MS } from "@/lib/login-guard";
import { POST, GET } from "@/app/api/auth/login/route";
import { createAdminToken, createIdleToken, requireAdmin, createAdminPasswordProofChallenge } from "@/lib/auth";
import { runMaintenanceCleanup } from "@/lib/maintenance-cleanup";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("ADMIN_JWT_SECRET", "owasp-login-fixture-secret");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", createHash("sha256").update("fixture-correct-password").digest("hex"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External calls forbidden in auth fixtures"); }));
  clearRateLimitBucketsForTest();
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function request(ip: string, password = "fixture-wrong-password") {
  return new NextRequest("https://axvara.test/api/auth/login?private=do-not-log", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email: "admin@example.test", password }),
  });
}

it("public password-proof challenges bind the account without disclosing its email", async () => {
  const challenge = await createAdminPasswordProofChallenge("private-owner@example.test");
  const payload = JSON.parse(Buffer.from(challenge.split(".")[1], "base64url").toString());
  expect(payload.admin_subject).toMatch(/^[a-f0-9]{64}$/);
  expect(payload).not.toHaveProperty("email");
  expect(JSON.stringify(payload)).not.toContain("private-owner");
});

it("20 simultaneous attempts across isolate resets admit only ten verifications", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => {
    clearRateLimitBucketsForTest();
    return POST(request("203.0.113.11"));
  }));
  expect(results.filter(r => r.status === 401)).toHaveLength(10);
  expect(results.filter(r => r.status === 429)).toHaveLength(10);
  expect(fx.sql.prepare("SELECT attempts FROM security_auth_attempts").get()?.attempts).toBe(10);
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events WHERE event='login_failed'").get()?.n).toBe(10);
});

it("a valid login clears only its own client, while challenge/malformed requests never reset it", async () => {
  const db = createDatabaseAccess(fx.db);
  const attacker = await loginClientHash("203.0.113.12"), owner = await loginClientHash("203.0.113.13");
  for (let n = 0; n < 10; n++) await admitLogin(db, attacker);
  await admitLogin(db, owner);
  expect((await GET(new NextRequest("https://axvara.test/api/auth/login"))).status).toBe(200);
  expect((await POST(request("203.0.113.13", "fixture-correct-password"))).status).toBe(200);
  expect(fx.sql.prepare("SELECT client_hash FROM security_auth_attempts WHERE client_hash=?").get(owner)).toBeUndefined();
  expect((await admitLogin(db, attacker)).allowed).toBe(false);
  const malformed = new NextRequest("https://axvara.test/api/auth/login", { method: "POST", body: "{}" });
  expect((await POST(malformed)).status).toBe(400);
  expect((await admitLogin(db, attacker)).allowed).toBe(false);
  const history = JSON.stringify(fx.sql.prepare("SELECT * FROM security_events").all());
  for (const secret of ["203.0.113", "fixture-correct-password", "admin@example.test", "do-not-log"]) expect(history).not.toContain(secret);
  expect(history).toContain("login_succeeded");
});

it("admission store errors return 503 before verification/session cookies", async () => {
  fx.control.fail = sql => sql.includes("INSERT INTO security_auth_attempts");
  const response = await POST(request("203.0.113.14", "fixture-correct-password"));
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events").get()?.n).toBe(0);
});

it("canonical IPv6 buckets persist across module reload and older-window resets cannot delete newer admission", async () => {
  const db = createDatabaseAccess(fx.db);
  const hash = await loginClientHash("2001:db8::1");
  expect(hash).toBe(await loginClientHash("2001:0db8:0000:0000:0000:0000:0000:0001"));
  expect(new Set(await Promise.all(["::1", "::2", "2001:db8::1"].map(loginClientHash))).size).toBe(3);
  const now = Math.floor(Date.now() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  await admitLogin(db, hash, now);
  await admitLogin(db, hash, now + LOGIN_WINDOW_MS);
  await resetLogin(db, hash, now / LOGIN_WINDOW_MS);
  expect(fx.sql.prepare("SELECT attempts,window_id FROM security_auth_attempts WHERE client_hash=?").get(hash)).toMatchObject({ attempts: 1, window_id: now / LOGIN_WINDOW_MS + 1 });
  vi.resetModules();
  const fresh = await import("@/lib/login-guard");
  for (let n = 0; n < 9; n++) expect((await fresh.admitLogin(db, hash, now + LOGIN_WINDOW_MS)).allowed).toBe(true);
  expect((await fresh.admitLogin(db, hash, now + LOGIN_WINDOW_MS)).allowed).toBe(false);
});

it("admin telemetry records authorization once per request without IDs/query/tokens and omits polling reads", async () => {
  const session = await createAdminToken("admin@example.test"), idle = await createIdleToken(session.sid);
  const req = new Request("https://axvara.test/api/admin/orders/AXV-PRIVATE?contact=private@example.test", {
    method: "PATCH", headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  });
  expect(await requireAdmin(req)).not.toBeNull();
  expect(await requireAdmin(req)).not.toBeNull();
  const polling = new Request("https://axvara.test/api/admin/overview", { headers: req.headers });
  expect(await requireAdmin(polling)).not.toBeNull();
  const rows = fx.sql.prepare("SELECT * FROM security_events").all();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ event: "admin_authorized", route: "/api/admin/*", method: "PATCH" });
  for (const secret of ["AXV-PRIVATE", "private@example.test", session.sid, session.token, idle]) expect(JSON.stringify(rows)).not.toContain(secret);
  fx.control.fail = sql => sql.includes("INSERT INTO security_events");
  expect(await requireAdmin(new Request(req.url, { method: "PATCH", headers: req.headers }))).not.toBeNull();
});

it("audits CSV export and single-order buyer input, but not orders list polling", async () => {
  const { GET: list } = await import("@/app/api/admin/orders/route");
  const { GET: detail } = await import("@/app/api/admin/orders/[code]/route");
  const session = await createAdminToken("admin@example.test");
  const idle = await createIdleToken(session.sid);
  const code = "AXV-20261121-PRIVATE1";
  fx.sql.prepare(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method)
    VALUES (?,'Fixture','628123456789','private@example.test',?,5000,'qris')`)
    .run(code, JSON.stringify([{ variant_id: 1, buyer_fields: { muse_invite_code: "private-muse-invite" } }]));
  const request = (path: string) => new NextRequest(`https://axvara.test/api/admin/orders${path}`, {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  });
  const events = () => fx.sql.prepare("SELECT event,route,method FROM security_events ORDER BY id").all();
  const csv = await list(request("?export=csv&q=private"));
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(await csv.text()).toContain("private@example.test");
  expect(events()).toHaveLength(1);
  const buyer = await detail(request(`/${code}`), { params: Promise.resolve({ code }) });
  expect(await buyer.json()).toMatchObject({ buyerInputs: [{ value: "private-muse-invite" }] });
  expect((await list(request("?page=1"))).status).toBe(200);
  expect(events()).toEqual(Array.from({ length: 2 }, () => ({ event: "admin_authorized", route: "/api/admin/sensitive-read", method: "GET" })));
});

it("cleanup is bounded and preserves active login windows and recent audit history", async () => {
  const now = Math.floor(Date.now() / LOGIN_WINDOW_MS), old = now - 200;
  for (let n = 0; n < 205; n++) fx.sql.prepare("INSERT INTO security_auth_attempts VALUES(?,?,1)").run(`old-${n}`, old);
  fx.sql.prepare("INSERT INTO security_auth_attempts VALUES('active',?,10)").run(now);
  // Owner decision 2026-11-21 keeps security_events for 90 days, so seed
  // genuinely expired rows (100 days) to exercise the bounded 500/run prune.
  for (let n = 0; n < 505; n++) fx.sql.exec("INSERT INTO security_events(event,subject_hash,route,method,created_at) VALUES('login_failed','hash','/api/auth/login','POST',datetime('now','-100 days'))");
  fx.sql.exec("INSERT INTO security_events(event,subject_hash,route,method) VALUES('login_succeeded','hash','/api/auth/login','POST')");
  await runMaintenanceCleanup(createDatabaseAccess(fx.db));
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_auth_attempts").get()?.n).toBe(6);
  expect(fx.sql.prepare("SELECT attempts FROM security_auth_attempts WHERE client_hash='active'").get()?.attempts).toBe(10);
  // 505 expired - 500 bounded + 1 recent.
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events").get()?.n).toBe(6);
  // A 90-day window keeps 40-day-old rows (regression guard against the old
  // 30-day policy). The second tick also drains the 5 rows left by the bound.
  fx.sql.exec("INSERT INTO security_events(event,subject_hash,route,method,created_at) VALUES('login_failed','hash','/api/auth/login','POST',datetime('now','-40 days'))");
  fx.sql.exec("UPDATE store_settings SET value=datetime('now','-61 minutes') WHERE key='maintenance_cleanup_at'");
  await runMaintenanceCleanup(createDatabaseAccess(fx.db));
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM security_events").get()?.n).toBe(2);
  expect(fx.sql.prepare("SELECT julianday('now')-julianday(MAX(created_at)) AS age FROM security_events WHERE event='login_failed'").get()?.age).toBeGreaterThan(39);
});
