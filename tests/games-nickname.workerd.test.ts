import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("runs migration0109, durable paid-check admission and cache in real workerd D1", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {checkGamesNickname,gamesNicknameSummary} from './src/lib/games/nickname';
      import {gamesRegistryGame} from './src/lib/games/registry';
      import {createDatabaseAccess} from './src/lib/db-access';
      export default {async fetch(req,env){
        globalThis.DB=env.DB;
        const db=createDatabaseAccess();
        if(new URL(req.url).pathname==='/summary') return Response.json(await gamesNicknameSummary(db));
        const body=await req.json();
        return Response.json(await checkGamesNickname(db,gamesRegistryGame('free-fire'),body.id,body.ip,body.device));
      }};` },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    plugins: [{ name: "framework-adapter", setup(b) {
      b.onResolve({ filter: /^server-only$|^next\/server$/ }, args => ({ path: args.path, namespace: "framework" }));
      b.onLoad({ filter: /.*/, namespace: "framework" }, args => ({ contents: args.path === "server-only" ? "" : "export const NextResponse=Response; export const NextRequest=Request;" }));
    } }],
  });
  let calls = 0;
  const refs: string[] = [];
  const runtime = new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script: compiled.outputFiles[0].text, d1Databases: ["DB"],
    bindings: { NODE_ENV: "test", ADMIN_JWT_SECRET: "workerd-nickname-fixture", DIGIFLAZZ_USERNAME: "fixture", DIGIFLAZZ_API_KEY: "fixture",
      DIGIFLAZZ_TESTING: "false", WARUNG_REBAHAN_PROXY_URL: "https://supplier.test", WARUNG_REBAHAN_PROXY_TOKEN: "fixture" },
    outboundService: async (req: Request) => {
      expect(new URL(req.url).pathname).toBe("/dgf/v1/transaction");
      const p = await req.json() as Record<string, unknown>;
      expect(p.max_price).toBe(5); expect(p.ref_id).toMatch(/^NCK-/);
      calls++;
      refs.push(String(p.ref_id));
      return Response.json({ data: { ...p, status: "Sukses", rc: "00", sn: "Fixture Player", price: 5 } });
    },
  });
  try {
    const db = await runtime.getD1Database("DB");
    const schema = readFileSync("drizzle/schema.sql", "utf8");
    // Single batch through Miniflare's synchronous D1 proxy (see games-checkout.workerd).
    await db.batch([
      db.prepare(schema.match(/CREATE TABLE IF NOT EXISTS games_products \([\s\S]*?\n\);/)![0]),
      ...readFileSync("drizzle/migrations/0109_games_nickname.sql", "utf8").split(";").filter(s => s.trim()).map((ddl) => db.prepare(ddl)),
    ]);
    const post = (id: string, device = "device") => runtime.dispatchFetch("https://fixture.test/check", {
      method: "POST", body: JSON.stringify({ id, ip: "192.0.2.1", device }),
    });
    const results = await Promise.all([post("123456789"), post("123456789")]);
    expect(await results[0].json()).toMatchObject({ status: expect.stringMatching(/ok|unavailable/) });
    expect(await results[1].json()).toMatchObject({ status: expect.stringMatching(/ok|unavailable/) });
    expect(calls).toBe(1);
    expect(await (await post("123456789")).json()).toEqual({ status: "ok", nickname: "Fixture Player" });
    for (let i = 0; i < 4; i++) expect(await (await post(`22222222${i}`)).json()).toMatchObject({ status: "ok" });
    expect(await (await post("333333333")).json()).toEqual({ status: "unavailable" });
    expect(calls).toBe(5);
    expect(await (await runtime.dispatchFetch("https://fixture.test/summary")).json()).toEqual({ today: { count: 5, cost: 25 }, week: { count: 5, cost: 25 } });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM games_nickname_cache WHERE result='pending'").first()).toEqual({ n: 0 });
    await db.prepare("UPDATE games_nickname_cache SET result='ambiguous',nickname=NULL,checked_at=0 WHERE customer_no='123456789'").run();
    const polled = await Promise.all([post("123456789"), post("123456789"), post("123456789")]);
    for (const response of polled) expect(await response.json()).toMatchObject({ status: expect.stringMatching(/ok|unavailable/) });
    expect(calls).toBe(6); expect(refs[5]).toBe(refs[0]);
    expect(await (await runtime.dispatchFetch("https://fixture.test/summary")).json()).toEqual({ today: { count: 5, cost: 25 }, week: { count: 5, cost: 25 } });
  } finally { await runtime.dispose(); }
}, 30_000);
