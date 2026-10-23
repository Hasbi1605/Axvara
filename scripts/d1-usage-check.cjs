#!/usr/bin/env node
// Read Cloudflare account analytics, never query/write the application database.
const fs = require("node:fs");
const { cloudflareAuth, readWorkersPlan } = require("./cloudflare-plan.cjs");
const READ_LIMIT = 5_000_000, WRITE_LIMIT = 100_000;

function projectUsage({ now, daily, recent, recentSeconds, plan = { name: "free" } }) {
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const periodStart = plan.name === "paid" ? new Date(plan.periodStart) : start;
  const periodEnd = plan.name === "paid" ? new Date(plan.periodEnd) : new Date(start.getTime()+86400000);
  const elapsed = (now - periodStart) / 1000, remaining = (periodEnd - now) / 1000;
  const duration = (periodEnd - periodStart) / 1000;
  const metrics = {};
  const limits = plan.name === "paid" ? [["rowsRead", 25_000_000_000], ["rowsWritten", 50_000_000]] : [["rowsRead", READ_LIMIT], ["rowsWritten", WRITE_LIMIT]];
  for (const [key, limit] of limits) {
    const used = daily[key], rate = recent[key] / Math.max(1, recentSeconds);
    const projectedRecent = used + rate * remaining;
    const projectedAverage = elapsed > 0 ? used * duration / elapsed : used;
    metrics[key] = { used, limit, percent: used / limit * 100, recentPerHour: rate * 3600,
      projectedRecent: Math.round(projectedRecent), projectedAverage: Math.round(projectedAverage),
      safePerHour: Math.max(0, limit-used) * 3600 / Math.max(1, remaining),
      exhaustedAt: rate > 0 && used < limit && projectedRecent >= limit
        ? new Date(now.getTime() + (limit-used)/rate*1000).toISOString() : null };
  }
  const exceeded = Object.values(metrics).some(m => m.used >= m.limit);
  // First-hour catch-up is noisy. Actual exhaustion always alerts immediately.
  const risk = elapsed >= 3600 && Object.values(metrics).some(m => m.percent >= 90 || m.projectedRecent >= m.limit || m.projectedAverage >= m.limit);
  return { observedAt: now.toISOString(), resetAt: periodEnd.toISOString(), periodStart: periodStart.toISOString(), plan: plan.name,
    status: exceeded ? (plan.name === "paid" ? "included_usage_exceeded" : "exhausted") : risk ? "risk" : elapsed < 3600 ? "warming_up" : "within_budget", metrics };
}

function validRows(rows) {
  return Array.isArray(rows) && rows.every(row => row && row.sum && ["rowsRead","rowsWritten"].every(k =>
    Number.isSafeInteger(row.sum[k]) && row.sum[k] >= 0));
}

async function readUsage(env, now = new Date(), fetchFn = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const headers = { "Content-Type": "application/json", ...cloudflareAuth(env) };
  const plan = await readWorkersPlan(env, fetchFn, now);
  const start = new Date(now); start.setUTCHours(0,0,0,0);
  if (plan.name === "paid") start.setTime(Date.parse(plan.periodStart));
  // Ignore the latest partial bucket plus five minutes of ingestion lag.
  const end = new Date(Math.floor(now.getTime()/300000)*300000-300000);
  const recentStart = new Date(Math.max(start.getTime(),end.getTime()-3600000));
  const recentEnd = new Date(Math.max(recentStart.getTime(),end.getTime()));
  const query = `query($account: string!, $start: Time!, $now: Time!, $recent: Time!, $end: Time!) {
    viewer { accounts(filter:{accountTag:$account}) {
      daily:d1AnalyticsAdaptiveGroups(limit:100,filter:{datetime_geq:$start,datetime_lt:$now}) {
        dimensions {databaseId} sum {rowsRead rowsWritten}
      }
      recent:d1AnalyticsAdaptiveGroups(limit:1000,filter:{datetime_geq:$recent,datetime_lt:$end}) {
        dimensions {datetimeFiveMinutes} sum {rowsRead rowsWritten}
      }
    }}
  }`;
  const response = await fetchFn("https://api.cloudflare.com/client/v4/graphql", { method:"POST", headers,
    body:JSON.stringify({ query, variables:{ account, start:start.toISOString(), now:now.toISOString(), recent:recentStart.toISOString(), end:recentEnd.toISOString() } }),
    signal:AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cloudflare analytics HTTP ${response.status}`);
  const body = await response.json();
  const accounts = body.data?.viewer?.accounts;
  if (body.errors?.length || !Array.isArray(accounts) || accounts.length !== 1) throw new Error("Cloudflare analytics response incomplete");
  const data = accounts[0];
  if (!validRows(data.daily) || !validRows(data.recent)) throw new Error("Cloudflare analytics metrics invalid");
  if (data.daily.length >= 100 || data.recent.length >= 1000) throw new Error("Cloudflare analytics result may be truncated");
  const sum = rows => rows.reduce((out,row) => ({ rowsRead:out.rowsRead+row.sum.rowsRead, rowsWritten:out.rowsWritten+row.sum.rowsWritten }), { rowsRead:0,rowsWritten:0 });
  const report = projectUsage({ now, daily:sum(data.daily), recent:sum(data.recent), recentSeconds:(recentEnd-recentStart)/1000, plan });
  // Empty datasets must never be presented as evidence that a running store is safe.
  if (!data.daily.length || (!data.recent.length && report.status !== "exhausted")) report.status = "unknown";
  return { ...report, recentFrom:recentStart.toISOString(), recentTo:recentEnd.toISOString(),
    databaseCount:data.daily.length, source:"Cloudflare GraphQL Analytics; delayed/sampled estimates, not an invoice. Paid period totals may include pre-upgrade Free usage; projections are conditional." };
}

function summary(report) {
  const number = value => Math.round(value).toLocaleString("en-US");
  return `D1 ${report.plan}: **${report.status}**\n\nObserved UTC: ${report.observedAt}; period end UTC: ${report.resetAt}. Paid allowances are included usage, not a service cutoff.\n\n`
    + "| Metric | Used | Included | Recent/hour | Projected at period end |\n|---|---:|---:|---:|---:|\n"
    + Object.entries(report.metrics).map(([key,m]) => `| ${key} | ${number(m.used)} | ${number(m.limit)} | ${number(m.recentPerHour)} | ${number(m.projectedRecent)} |`).join("\n")
    + `\n\n${report.source}\n`;
}

async function main() {
  const args=process.argv.slice(2), path=args[args.indexOf("--report")+1];
  const report=await readUsage(process.env);
  if (args.includes("--report")) { if (!path || path.startsWith("--")) throw new Error("Report path required"); fs.writeFileSync(path,JSON.stringify(report,null,2)); }
  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary(report));
  if (["risk","exhausted","included_usage_exceeded","unknown"].includes(report.status)) {
    console.log(`::warning title=D1 usage::Status ${report.status}. Inspect the report and recent/hour projection for the active plan's period.`);
    if (args.includes("--check")) process.exitCode=1;
  }
}
module.exports={ projectUsage, readUsage, summary };
if (require.main===module) main().catch(() => { console.error("D1 usage monitoring failed: analytics unavailable or configuration invalid; no safe-quota claim."); process.exitCode=2; });
