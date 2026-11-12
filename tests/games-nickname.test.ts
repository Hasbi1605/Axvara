import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkGamesNickname, gamesNicknameSummary } from "@/lib/games/nickname";
import { gamesRegistryGame } from "@/lib/games/registry";
import { POST } from "@/app/api/games/nickname/route";
import { clearRateLimitBucketsForTest, rateLimit, RATE_LIMITS } from "@/lib/rateLimit";

const supplier = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/games/digiflazz", () => ({ isDigiflazzConfigured: () => Boolean(process.env.DIGIFLAZZ_USERNAME && process.env.DIGIFLAZZ_API_KEY), sendTransaction: supplier.send }));
let fx: ReturnType<typeof createD1Fixture>;
const device = "bd58417b-0508-4d68-9a7a-66252ea69d4c";
const game = gamesRegistryGame("free-fire")!;
const run = (id = "123456789", ip = "192.0.2.1", d = device) => checkGamesNickname(createDatabaseAccess(), game, id, ip, d);
const req = (body: unknown, cookie = "") => new NextRequest("https://games.axvara.tech/api/games/nickname", {
  method: "POST", headers: { "content-type": "application/json", cookie, "cf-connecting-ip": "192.0.2.1" }, body: JSON.stringify(body),
});
function tx(status = "Sukses", rc = "00", sn: string | null = "Nickname: <b>Player</b>") {
  supplier.send.mockImplementation(async (p: { ref_id: string; buyer_sku_code: string }) => ({ kind: "ok", tx: { ...p, status, rc, sn, price: 5 } }));
}
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("DIGIFLAZZ_TESTING", "false"); vi.stubEnv("DIGIFLAZZ_USERNAME", "fixture"); vi.stubEnv("DIGIFLAZZ_API_KEY", "fixture");
  vi.stubEnv("ADMIN_JWT_SECRET", "nickname-test-secret");
  supplier.send.mockReset(); tx();
  clearRateLimitBucketsForTest();
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("paid nickname endpoint", () => {
  it("validates registry before supplier; body stream is bounded at 8000 bytes", async () => {
    expect(await (await POST(req({ slug: "free-fire", fields: { playerId: "bad" } }))).json()).toMatchObject({ status: "invalid" });
    expect(await (await POST(req({ slug: "unknown", fields: {} }))).json()).toMatchObject({ status: "invalid" });
    expect((await POST(req({ slug: "free-fire", fields: { playerId: "x".repeat(8100) } }))).status).toBe(413);
    expect(supplier.send).not.toHaveBeenCalled();
  });
  it.each(["testing", "no-key", "no-db"])("fails closed in P9 %s without supplier", async mode => {
    if (mode === "testing") vi.stubEnv("DIGIFLAZZ_TESTING", "true");
    if (mode === "no-key") vi.stubEnv("DIGIFLAZZ_API_KEY", "");
    const db = createDatabaseAccess(mode === "no-db" ? null : fx.db);
    expect(await checkGamesNickname(db, game, "123456789", "192.0.2.1", device)).toEqual({ status: "unavailable" });
    expect(supplier.send).not.toHaveBeenCalled();
  });
  it("checks an SK variant for free, sets an httpOnly random device cookie and caches 24h", async () => {
    vi.stubEnv("SEKALIPAY_ENABLED", "true");
    vi.stubEnv("SEKALIPAY_API_KEY", "sk-test");
    vi.stubEnv("SEKALIPAY_PROXY_URL", "");
    fx.sql.exec(`INSERT INTO games_products(buyer_sku_code,product_name,game_slug,supplier,supplier_active,enabled,sk_variant_id,required_fields_json)
      VALUES('sk:101','86 Diamond','mobile-legends','sekalipay',1,1,101,
      '{"version":1,"fields":[{"key":"note","label":"User ID","required":true,"input":"text","min":1,"max":50},{"key":"zone_id","label":"Zone ID","required":true,"input":"text","min":1,"max":20}],"requires_zone_id":true,"validation_available":true,"open_denom":false,"supported":true,"reason":null}')`);
    const skFetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "ok", data: { display_name: "Player", account_name: "Player", region: null, cached: false } }), { status: 200 }));
    vi.stubGlobal("fetch", skFetchMock);
    const res = await POST(req({ slug: "mobile-legends", buyer_sku_code: "sk:101", fields: { note: "12345", zone_id: "6789" } }));
    expect(await res.json()).toEqual({ status: "ok", nickname: "Player" });
    expect(res.headers.get("set-cookie")).toMatch(/axv_nck_device=.*HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(skFetchMock).toHaveBeenCalledTimes(1);
    const row = fx.sql.prepare("SELECT * FROM games_nickname_cache WHERE game_key='sk:101'").get()!;
    expect(Number(row.expires_at) - Number(row.checked_at)).toBeGreaterThanOrEqual(86_399_000);
    expect(supplier.send).not.toHaveBeenCalled();
    // Cache module legacy berbayar tetap terisolasi dan tidak dipakai route baru.
    expect(await checkGamesNickname(createDatabaseAccess(), gamesRegistryGame("free-fire-max")!, "123456789", "other", device)).toEqual({ status: "ok", nickname: "Player" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
  });
  it("uses stored cost as max_price, never a markup; rejects costs above the global budget ceiling", async () => {
    fx.sql.prepare("INSERT INTO games_products(buyer_sku_code,product_name,cost) VALUES('ffcekusername','Cek Username',7)").run();
    await run();
    expect(supplier.send.mock.calls[0][0]).toMatchObject({ max_price: 7, buyer_sku_code: "ffcekusername", ref_id: expect.stringMatching(/^NCK-/) });
    expect((await gamesNicknameSummary(createDatabaseAccess())).today.cost).toBe(7);
    fx.sql.prepare("UPDATE games_products SET cost=81").run();
    expect(await run("222222222")).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
  });
  it("rechecks pending once using identical ref and payload, and caches final success", async () => {
    let n = 0;
    supplier.send.mockImplementation(async (p) => ({ kind: "ok", tx: { ...p, status: n++ ? "Sukses" : "Pending", rc: n === 1 ? "03" : "00", sn: "Player" } }));
    expect(await run()).toEqual({ status: "ok", nickname: "Player" });
    expect(supplier.send).toHaveBeenCalledTimes(2);
    expect(supplier.send.mock.calls[0][0]).toEqual(supplier.send.mock.calls[1][0]);
    expect((await gamesNicknameSummary(createDatabaseAccess())).today.count).toBe(1);
  });
  it.each(["pending", "timeout", "wrong-ref", "wrong-sku", "missing-sn"])("retains ambiguous %s claim without a new paid reference or a re-poll before 60s", async mode => {
    if (mode === "timeout") supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    else supplier.send.mockImplementation(async p => ({ kind: "ok", tx: { ...p,
      ...(mode === "wrong-ref" ? { ref_id: "wrong" } : {}), ...(mode === "wrong-sku" ? { buyer_sku_code: "wrong" } : {}),
      status: mode === "pending" ? "Pending" : "Sukses", rc: mode === "pending" ? "03" : "00", sn: mode === "missing-sn" ? null : "Player" } }));
    expect(await run()).toEqual({ status: "unavailable" });
    const calls = supplier.send.mock.calls.length;
    expect(await run()).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(calls);
    expect(fx.sql.prepare("SELECT expires_at FROM games_nickname_cache").get()?.expires_at).toBeNull();
  });
  it("re-polls the identical original payload after 60s with no new cost log, even if catalog cost changes", async () => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    const original = supplier.send.mock.calls[0][0];
    const summary = await gamesNicknameSummary(createDatabaseAccess());
    fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?").run(Date.now() - 60_000);
    fx.sql.prepare("INSERT INTO games_products(buyer_sku_code,product_name,cost) VALUES('ffcekusername','Utility',80)").run();
    tx();
    expect(await run()).toEqual({ status: "ok", nickname: "Player" });
    expect(supplier.send.mock.calls[1][0]).toEqual(original);
    expect(await gamesNicknameSummary(createDatabaseAccess())).toEqual(summary);
    expect(fx.sql.prepare("SELECT status FROM games_nickname_checks").get()?.status).toBe("ok");
  });
  it("claims one simultaneous stale pending re-poll with CAS, and does not repeat the initial 1.5s retry", async () => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    fx.sql.prepare("UPDATE games_nickname_cache SET result='pending',checked_at=?").run(Date.now() - 60_001);
    tx("Pending", "03", null);
    const results = await Promise.all([run(), run(), run()]);
    expect(results).toEqual([{ status: "unavailable" }, { status: "unavailable" }, { status: "unavailable" }]);
    expect(supplier.send).toHaveBeenCalledTimes(2); // initial paid call + exactly one free re-poll
    expect(supplier.send.mock.calls[1][0]).toEqual(supplier.send.mock.calls[0][0]);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_nickname_checks").get()?.n).toBe(1);
    await run(); expect(supplier.send).toHaveBeenCalledTimes(2);
  });
  it.each(["54", "55"])("settles the original cost log/cache from a re-poll rc%s", async rc => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?").run(Date.now() - 60_001);
    tx("Gagal", rc, null);
    expect(await run()).toEqual({ status: rc === "54" ? "invalid" : "unavailable" });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_nickname_checks").get()?.n).toBe(1);
    const row = fx.sql.prepare("SELECT result,expires_at FROM games_nickname_cache").get()!;
    expect(row.result).toBe(rc === "54" ? "invalid" : "unavailable");
    expect(Number(row.expires_at)).toBeGreaterThan(Date.now());
  });
  it.each(["ip", "device"])("applies best-effort %s re-poll admission before CAS or supplier", async scope => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    const checkedAt = Date.now() - 60_001;
    fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?").run(checkedAt);
    const { checkoutSubjects } = await import("@/lib/checkout-guard");
    const [subject] = await checkoutSubjects({ ip: "192.0.2.1", wa: "", email: "" });
    const s = scope === "ip" ? "games:nickname_poll" : "games:nickname_poll_device";
    const key = `${s}:${scope === "ip" ? subject.hash : device}`;
    for (let i = 0; i < RATE_LIMITS[s]; i++) rateLimit(key, RATE_LIMITS[s], 15 * 60_000);
    expect(await run()).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
    expect(fx.sql.prepare("SELECT checked_at FROM games_nickname_cache").get()?.checked_at).toBe(checkedAt);
  });
  it("does not apply the global paid cap or insert a paid log to a same-ref re-poll", async () => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?").run(Date.now() - 60_001);
    const insert = fx.sql.prepare("INSERT INTO games_nickname_checks(ref_id,slug,buyer_sku_code,cost,status,ip_hash,device_id,created_at) VALUES(?, 'free-fire','ffcekusername',5,'ok','other','other',?)");
    for (let i = 0; i < 499; i++) insert.run(`old-${i}`, Date.now());
    tx(); expect(await run()).toEqual({ status: "ok", nickname: "Player" });
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_nickname_checks").get()?.n).toBe(500);
    expect((await gamesNicknameSummary(createDatabaseAccess())).today.cost).toBe(2500);
  });
  it("fails closed on a re-poll CAS D1 failure and never polls in testing mode", async () => {
    supplier.send.mockResolvedValue({ kind: "ambiguous", reason: "timeout" });
    await run();
    fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?").run(Date.now() - 60_001);
    fx.control.fail = q => q.startsWith("UPDATE games_nickname_cache");
    expect(await run()).toEqual({ status: "unavailable" });
    fx.control.fail = null; vi.stubEnv("DIGIFLAZZ_TESTING", "true");
    expect(await run()).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
  });
  it("does not let a late response overwrite a newer CAS owner/result", async () => {
    supplier.send.mockImplementation(async p => {
      fx.sql.prepare("UPDATE games_nickname_cache SET checked_at=?,result='ok',nickname='Newer'").run(Date.now() + 60_000);
      return { kind: "ok", tx: { ...p, status: "Sukses", rc: "00", sn: "Old" } };
    });
    expect(await run()).toEqual({ status: "unavailable" });
    expect(fx.sql.prepare("SELECT result,nickname FROM games_nickname_cache").get()).toEqual({ result: "ok", nickname: "Newer" });
    expect(fx.sql.prepare("SELECT status FROM games_nickname_checks").get()?.status).toBe("submitting");
  });
  it("legacy module still treats only documented rc54 as invalid and caches it for one hour", async () => {
    tx("Gagal", "54", null);
    expect(await run("123456789")).toEqual({ status: "invalid" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
    const row = fx.sql.prepare("SELECT * FROM games_nickname_cache").get()!;
    expect(Number(row.expires_at) - Number(row.checked_at)).toBeGreaterThan(3_599_000);
    tx("Gagal", "55"); expect(await run("222222222")).toEqual({ status: "unavailable" });
    tx("Gagal", "44"); expect(await run("333333333")).toEqual({ status: "unavailable" });
  });
  it("expires success/invalid caches but not ambiguity", async () => {
    await run();
    fx.sql.prepare("UPDATE games_nickname_cache SET expires_at=0").run();
    await run();
    expect(supplier.send).toHaveBeenCalledTimes(2);
  });
  it.each(["ip", "device", "global"])("enforces durable %s admission and caps concurrent requests atomically", async scope => {
    const n = scope === "ip" ? 10 : scope === "device" ? 5 : 500;
    const now = Date.now();
    // Seed historical admissions; all counters are the audit log, no process memory.
    const { checkoutSubjects } = await import("@/lib/checkout-guard");
    const [subject] = await checkoutSubjects({ ip: "192.0.2.1", wa: "", email: "" });
    const insert = fx.sql.prepare("INSERT INTO games_nickname_checks(ref_id,slug,buyer_sku_code,cost,status,ip_hash,device_id,created_at) VALUES(?, 'free-fire','ffcekusername',5,'ok',?,?,?)");
    for (let i = 0; i < n - 1; i++) insert.run(`old-${i}`, scope === "ip" ? subject.hash : `ip-${i}`, scope === "device" ? device : `device-${i}`, now);
    const results = await Promise.all([run("111111111"), run("222222222")]);
    expect(results.filter(r => r.status === "ok")).toHaveLength(1);
    expect(supplier.send).toHaveBeenCalledTimes(1);
    expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM games_nickname_checks").get()?.n).toBe(n);
    expect(await run("333333333")).toEqual({ status: "unavailable" });
  });
  it("deduplicates a simultaneous account lookup and never dispatches after D1 failures", async () => {
    const results = await Promise.all([run(), run()]);
    expect(results.some(r => r.status === "ok")).toBe(true);
    expect(supplier.send).toHaveBeenCalledTimes(1);
    fx.control.fail = () => true;
    expect(await run("222222222")).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
  });
  it("keeps an in-flight claim if final persistence fails after the paid call", async () => {
    supplier.send.mockImplementation(async p => { fx.control.fail = q => q.startsWith("UPDATE games_nickname"); return { kind: "ok", tx: { ...p, status: "Sukses", rc: "00", sn: "Player" } }; });
    expect(await run()).toEqual({ status: "unavailable" });
    fx.control.fail = null;
    expect(await run()).toEqual({ status: "unavailable" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
  });
});
