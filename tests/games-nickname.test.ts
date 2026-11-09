import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkGamesNickname, gamesNicknameSummary } from "@/lib/games/nickname";
import { gamesRegistryGame } from "@/lib/games/registry";
import { POST } from "@/app/api/games/nickname/route";

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
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.useRealTimers(); });

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
  it("returns sanitized SN, sets an httpOnly random device cookie, caches for 24h and shares FF MAX", async () => {
    const res = await POST(req({ slug: "free-fire", fields: { playerId: "123456789" } }));
    expect(await res.json()).toEqual({ status: "ok", nickname: "Player" });
    expect(res.headers.get("set-cookie")).toMatch(/axv_nck_device=.*HttpOnly/i);
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(await checkGamesNickname(createDatabaseAccess(), gamesRegistryGame("free-fire-max")!, "123456789", "other", device)).toEqual({ status: "ok", nickname: "Player" });
    expect(supplier.send).toHaveBeenCalledTimes(1);
    const row = fx.sql.prepare("SELECT * FROM games_nickname_cache").get()!;
    expect(Number(row.expires_at) - Number(row.checked_at)).toBeGreaterThanOrEqual(86_399_000);
    expect(await gamesNicknameSummary(createDatabaseAccess())).toEqual({ today: { count: 1, cost: 5 }, week: { count: 1, cost: 5 } });
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
  it.each(["pending", "timeout", "wrong-ref", "wrong-sku", "missing-sn"])("retains ambiguous %s claim indefinitely, without a second paid reference", async mode => {
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
  it("treats only documented rc54 as invalid, localizes and caches it for one hour", async () => {
    tx("Gagal", "54", null);
    expect(await (await POST(req({ slug: "free-fire", fields: { playerId: "123456789" } }, "axv_locale=en"))).json()).toEqual({ status: "invalid", message: "ID not found" });
    expect(await (await POST(req({ slug: "free-fire", fields: { playerId: "123456789" } }))).json()).toEqual({ status: "invalid", message: "ID tidak ditemukan" });
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
