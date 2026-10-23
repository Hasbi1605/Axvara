import {createRequire} from "node:module";
import {expect,it,vi} from "vitest";
const require=createRequire(import.meta.url);
const {readWorkersPlan}=require("../scripts/cloudflare-plan.cjs");
const {readUsage,projectUsage}=require("../scripts/d1-usage-check.cjs");
const {checkPagesEnvironment}=require("../scripts/ci-pages-env-check.cjs");
const now=new Date("2026-10-23T10:00:00Z");
const env={CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CLOUDFLARE_API_TOKEN:"never-print-token"};
const subscription={state:"Paid",rate_plan:{id:"workers_paid"},current_period_start:"2026-09-30T00:00:00Z",current_period_end:"2026-10-30T00:00:00Z"};
const paid={name:"paid",variableLimit:128,periodStart:new Date(subscription.current_period_start).toISOString(),periodEnd:new Date(subscription.current_period_end).toISOString()};

it("detects Workers Paid separately from a domain Pro or R2 subscription",async()=>{
 expect(await readWorkersPlan(env,async()=>Response.json({success:true,result:[subscription]}),now)).toMatchObject(paid);
 expect(await readWorkersPlan(env,async()=>Response.json({success:true,result:[{state:"Paid",rate_plan:{id:"pro"}},{state:"Paid",rate_plan:{id:"r2_paid"}}]}),now)).toEqual({name:"free",variableLimit:64});
});
it.each([
 {success:false,result:[]},{success:true,result:null},{success:true,result:[{}]},
 {success:true,result:[{...subscription,current_period_end:"2026-10-01T00:00:00Z"}]},
 {success:true,result:[subscription],result_info:{total_count:2}},
])("rejects unavailable/incomplete subscription metadata",async body=>{
 await expect(readWorkersPlan(env,async()=>Response.json(body),now)).rejects.toThrow();
});
it("uses monthly D1 included usage instead of declaring a daily Free outage",async()=>{
 const report=projectUsage({now,plan:paid,daily:{rowsRead:12_000_000,rowsWritten:200_000},recent:{rowsRead:500_000,rowsWritten:1000},recentSeconds:3600});
 expect(report.status).toBe("within_budget");expect(report.resetAt).toBe(subscription.current_period_end.replace("Z",".000Z"));
 expect(report.metrics.rowsRead.limit).toBe(25_000_000_000);expect(report.metrics.rowsWritten.limit).toBe(50_000_000);
 expect(projectUsage({now,plan:paid,daily:{rowsRead:26_000_000_000,rowsWritten:0},recent:{rowsRead:0,rowsWritten:0},recentSeconds:3600}).status).toBe("included_usage_exceeded");
 const fetcher=vi.fn(async(url:string)=>Response.json(url.endsWith("/subscriptions")?{success:true,result:[subscription]}:{data:{viewer:{accounts:[{daily:[{sum:{rowsRead:12_000_000,rowsWritten:200_000}}],recent:[{sum:{rowsRead:500_000,rowsWritten:1000}}]}]}}}));
 expect((await readUsage(env,now,fetcher)).plan).toBe("paid");
 const body=JSON.parse((fetcher.mock.calls[1] as unknown as [string,{body:string}])[1].body);
 expect(body.variables.start).toBe("2026-09-30T00:00:00.000Z");
});
it("accepts 65 Pages variables only with verified Paid entitlement, without logging values",async()=>{
 const project={deployment_configs:{production:{env_vars:Object.fromEntries(Array.from({length:61},(_,i)=>[`V${i}`,{type:"secret_text",value:"private-value"}]))}}};
 const fetcher=async(url:string)=>Response.json(url.endsWith("/subscriptions")?{success:true,result:[{...subscription,current_period_start:"2020-01-01T00:00:00Z",current_period_end:"2099-01-01T00:00:00Z"}]}:{success:true,result:project});
 const report=await checkPagesEnvironment(env,fetcher);
 expect(report).toMatchObject({plan:"paid",total:65,limit:128,remaining:63});expect(JSON.stringify(report)).not.toContain("private-value");
});
