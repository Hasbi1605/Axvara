import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";

it("native D1: concurrent claims, failed retry, stale takeover, replay and migration idempotency", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {sendFencedCredential} from './src/lib/fulfillment/delivery/send-fence';
      import {createDatabaseAccess} from './src/lib/db-access';
      export default {async fetch(req,env){
        const body=await req.json(); const db=createDatabaseAccess(env.DB);
        const fence=new Date(Date.now()+60000).toISOString();
        await db.execRun("UPDATE fulfillment_items SET locked_until=?,status='sending' WHERE id=1",fence);
        let calls=0;
        const run=()=>sendFencedCredential(db,1,fence,body.channel,['fixture-part'],async()=>{
          calls++; return body.mode==='unknown'?{ok:false}:body.mode==='rejected'?{ok:false,definiteFailure:true}:{ok:true,messageId:'native-1'};
        });
        const results=await Promise.allSettled([run(),run()]);
        return Response.json({calls,results:results.map(r=>r.status),row:await db.queryFirst('SELECT * FROM fulfillment_send_claims WHERE item_id=1 AND channel=?',body.channel)});
      }}
    ` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": "{}" },
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  try {
    const db = await runtime.getD1Database("DB");
    await db.prepare("CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,status TEXT,locked_until TEXT)").run();
    await db.prepare("INSERT INTO fulfillment_items VALUES(1,'sending',NULL)").run();
    const migration = readFileSync("drizzle/migrations/0135_fulfillment_send_claims.sql", "utf8");
    expect(readFileSync("drizzle/schema.sql", "utf8").match(/CREATE TABLE IF NOT EXISTS fulfillment_send_claims \([\s\S]*?\n\);/)?.[0])
      .toBe(migration.slice(migration.indexOf("CREATE TABLE")).trim());
    await db.prepare(migration).run();
    await db.prepare(migration).run();
    const call = async (channel: string, mode = "success") => {
      const result = await runtime.dispatchFetch("https://fixture.test/send", { method: "POST", body: JSON.stringify({ channel, mode }) });
      expect(result.status).toBe(200);
      return await result.json() as { calls: number; row: Record<string, unknown> };
    };
    for (const channel of ["telegram", "whatsapp"]) {
      const first = await call(channel);
      expect(first.calls).toBe(1);
      expect(first.row).toMatchObject({ status: "sent", part_count: 1, attempt_count: 1 });
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
      // A definite rejection releases immediately; run one request so its
      // second executor may legitimately retry the failed first claim.
      const rejected = await call(channel, "rejected");
      expect(rejected.calls).toBeGreaterThanOrEqual(1);
      expect(rejected.row.status).toBe("failed");
      expect((await call(channel)).calls).toBe(1);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
      const unknown = await call(channel, "unknown");
      expect(unknown.calls).toBe(1);
      expect(unknown.row.status).toBe("sending");
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("UPDATE fulfillment_send_claims SET updated_at=datetime('now','-599 seconds')").run();
      expect((await call(channel)).calls).toBe(0);
      await db.prepare("UPDATE fulfillment_send_claims SET updated_at=datetime('now','-601 seconds')").run();
      expect((await call(channel)).calls).toBe(1);
      await db.prepare("DELETE FROM fulfillment_send_claims").run();
    }
  } finally { await runtime.dispose(); }
}, 30_000);
