import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { supplierFingerprint } from "@/lib/product-copy/text";
import { createD1Fixture } from "./helpers/d1-fixture";

it("runs the four-statement alert, retry, CAS and prune on native D1/workerd with a mocked sender", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {checkCopyReviewChanges} from './src/lib/product-copy/review-alert';
      import {createBudgetedDatabase} from './src/lib/db-access';
      export default {async fetch(request,env){
        const input=await request.json();
        globalThis.__sent=[]; globalThis.__sendOk=input.sendOk!==false;
        const run=async()=>{const b=createBudgetedDatabase(4,0,env.DB);
          return {result:await checkCopyReviewChanges(b.access,input.now),used:b.used};};
        const runs=await Promise.all(Array.from({length:input.concurrent?2:1},run));
        return Response.json({runs,messages:globalThis.__sent});
      }};` },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ TELEGRAM_BOT_ENABLED: "true", TELEGRAM_ADMIN_CHAT_ID: "-1000" }) },
    plugins: [{ name: "mock-telegram", setup(b) {
      b.onResolve({ filter: /telegram\/api$/ }, () => ({ path: "sender", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        export async function sendMessage(params){globalThis.__sent.push(params);return {ok:globalThis.__sendOk};}` }));
    } }],
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { sql: string }[];
    await db.batch(tables.map(row => db.prepare(row.sql)));
    await db.batch([
      db.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Native D1','native',10000,10)"),
      db.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id,admin_copy_fingerprint) VALUES(1,1,'native','1 Month',10000,10,'sk-native','previous')"),
      db.prepare("INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_description) VALUES('sk-native','native','Native D1','1 Month',10000,'Changed supplier rules')"),
    ]);
    const now = 1_800_000_000_000;
    const windowMs = 30 * 60 * 1000;
    async function call(input: { now: number; sendOk?: boolean; concurrent?: boolean }) {
      const response = await runtime.dispatchFetch("https://fixture.test/alert", { method: "POST", body: JSON.stringify(input) });
      expect(response.status).toBe(200);
      return await response.json() as { runs: { result: Record<string, unknown>; used: number }[]; messages: { text: string }[] };
    }
    const failed = await call({ now, sendOk: false });
    expect(failed.runs).toEqual([{ result: { checked: true, changed: 1, alerted: 0, error: "telegram_failed" }, used: 3 }]);
    expect(await db.prepare("SELECT value FROM store_settings WHERE key='copy_review_alerted'").first()).toBeNull();
    const retry = await call({ now: now + windowMs, concurrent: true });
    expect(retry.runs.filter(run => run.result.checked)).toHaveLength(1);
    expect(retry.runs.every(run => run.used <= 4)).toBe(true);
    expect(retry.messages).toHaveLength(1);
    expect(retry.messages[0].text).toContain("• Native D1 — 1 Month (SK)");
    const key = supplierFingerprint("Changed supplier rules", null);
    expect(await db.prepare("SELECT value FROM store_settings WHERE key='copy_review_alerted'").first("value")).toBe(JSON.stringify({ 1: key }));
    expect((await call({ now: now + windowMs + 1 })).runs[0].result).toEqual({ checked: false, skipped: "interval" });
    await db.prepare("UPDATE product_variants SET admin_copy_fingerprint=? WHERE id=1").bind(key).run();
    const prune = await call({ now: now + 2 * windowMs });
    expect(prune.runs).toEqual([{ result: { checked: true, changed: 0, alerted: 0 }, used: 4 }]);
    expect(prune.messages).toHaveLength(0);
    expect(await db.prepare("SELECT value FROM store_settings WHERE key='copy_review_alerted'").first("value")).toBe("{}");
  } finally { fixture.close(); await runtime.dispose(); }
}, 30000);
