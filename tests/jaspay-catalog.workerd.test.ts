import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import catalog from "./fixtures/wr-jaspay-catalog-20261114.json";
import { createD1Fixture } from "./helpers/d1-fixture";

it("runs the rotating Jaspay sync, progress migration and sale policy on native D1 within 40 statements", async () => {
  const compiled=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import {syncJaspayCatalog} from './src/lib/warung-rebahan/sync';
    import {createBudgetedDatabase} from './src/lib/db-access';
    export default {async fetch(request,env){
      const b=createBudgetedDatabase(40,2,env.DB);
      const feed=await request.json();
      const result=await syncJaspayCatalog(b.access,async()=>feed,{maxProducts:1});
      return Response.json({result,used:b.used});
    }};`},bundle:true,write:false,format:"esm",platform:"neutral",target:"es2022",
    plugins:[{name:"framework-marker",setup(b){b.onResolve({filter:/^server-only$/},()=>({path:"server-only",namespace:"framework"}));b.onLoad({filter:/.*/,namespace:"framework"},()=>({contents:""}));}}],
    define:{"process.env":JSON.stringify({WARUNG_REBAHAN_ENABLED:"true",WARUNG_REBAHAN_API_KEY:"fixture",TELEGRAM_BOT_ENABLED:"false"})}});
  const runtime=new Miniflare({modules:true,compatibilityDate:"2026-08-06",compatibilityFlags:["nodejs_compat"],script:compiled.outputFiles[0].text,d1Databases:["DB"]});
  const fixture=createD1Fixture();
  try {
    const db=await runtime.getD1Database("DB");
    const tables=fixture.sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {sql:string}[];
    await db.batch(tables.map(row=>db.prepare(row.sql)));
    await db.prepare("INSERT INTO categories(id,name,slug) VALUES(3,'Productivity','productivity')").run();
    // Exercise the actual ALTER against the pre-migration table.
    await db.prepare("ALTER TABLE wr_order_links DROP COLUMN jaspay_progress").run();
    for (const statement of readFileSync('drizzle/migrations/0121_jaspay_progress.sql','utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
    for(let i=0;i<10;i++) {
      const r=await runtime.dispatchFetch('https://fixture.test/sync',{method:'POST',body:JSON.stringify(catalog)});
      expect(r.status).toBe(200);
      const body=await r.json() as {result:{errors:string[];synced:number};used:number};
      expect(body.result.errors).toEqual([]);expect(body.result.synced).toBe(1);expect(body.used).toBeLessThanOrEqual(38);
    }
    expect(await db.prepare("SELECT COUNT(*) n FROM product_variants WHERE stock=-1 AND wr_variant_id LIKE 'jaspay:%'").first()).toMatchObject({n:17});
    expect(await db.prepare("SELECT duration_value FROM product_variants WHERE wr_variant_id='jaspay:scribd:'").first()).toMatchObject({duration_value:30});
  } finally {fixture.close();await runtime.dispose();}
},30000);
