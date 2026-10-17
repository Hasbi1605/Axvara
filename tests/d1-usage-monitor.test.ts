import { createRequire } from "node:module";
import { expect,it,vi } from "vitest";
const {projectUsage,readUsage}=createRequire(import.meta.url)("../scripts/d1-usage-check.cjs");
const now=new Date("2026-10-17T04:17:00Z");
const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_KEY:"never-print-key",CLOUDFLARE_EMAIL:"admin@example.test"};
it("projects both read/write budgets and UTC reset with a recent traffic surge",()=>{
  const report=projectUsage({now,daily:{rowsRead:1_000_000,rowsWritten:4000},recent:{rowsRead:500_000,rowsWritten:1000},recentSeconds:3600});
  expect(report.status).toBe("risk");
  expect(report.resetAt).toBe("2026-10-18T00:00:00.000Z");
  expect(report.metrics.rowsRead.projectedRecent).toBeGreaterThan(5_000_000);
  expect(report.metrics.rowsRead.exhaustedAt).toBe("2026-10-17T12:17:00.000Z");
});
it("does not turn the first few minutes into a noisy projection, but exhaustion always alerts",()=>{
  const early=new Date("2026-10-17T00:05:00Z");
  expect(projectUsage({now:early,daily:{rowsRead:100_000,rowsWritten:0},recent:{rowsRead:100_000,rowsWritten:0},recentSeconds:300}).status).toBe("warming_up");
  expect(projectUsage({now:early,daily:{rowsRead:5_000_000,rowsWritten:0},recent:{rowsRead:0,rowsWritten:0},recentSeconds:300}).status).toBe("exhausted");
});
it("fetches account analytics only and excludes partial/lagging buckets",async()=>{
  const fetchFn=vi.fn(async()=>Response.json({data:{viewer:{accounts:[{
    daily:[{sum:{rowsRead:300000,rowsWritten:1000}},{sum:{rowsRead:200000,rowsWritten:500}}],recent:[{sum:{rowsRead:100000,rowsWritten:100}}],
  }]}}}));
  const report=await readUsage(env,now,fetchFn);
  expect(report.metrics.rowsRead.used).toBe(500000);
  const [url,options]=fetchFn.mock.calls[0] as unknown as [string,{body:string}];
  expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
  const body=JSON.parse(options.body);
  expect(body.variables.end).toBe("2026-10-17T04:10:00.000Z");
  expect(body.variables.recent).toBe("2026-10-17T03:10:00.000Z");
  expect(JSON.stringify(report)).not.toContain(env.CLOUDFLARE_API_KEY);
});
it.each([
  {errors:[{message:"unavailable"}],data:null},
  {data:{viewer:{accounts:[]}}},
  {data:{viewer:{accounts:[{daily:[{sum:{rowsRead:-1,rowsWritten:0}}],recent:[]}]}}},
])("rejects missing/invalid analytics instead of claiming unused quota",async response=>{
  await expect(readUsage(env,now,async()=>Response.json(response))).rejects.toThrow();
});
it("empty analytics are unknown, not a safe balance",async()=>{
  const report=await readUsage(env,now,async()=>Response.json({data:{viewer:{accounts:[{daily:[],recent:[]}]}}}));
  expect(report.status).toBe("unknown");
});
