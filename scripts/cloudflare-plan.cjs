// Read subscription metadata only. Never print provider responses or secrets.
const { setTimeout: delay } = require("node:timers/promises");

// GET only: retry transport/timeouts and temporary HTTP failures, never writes.
async function cloudflareMetadataGet(url, headers, fetchFn = fetch) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (attempt === 2 || !(response.status === 408 || response.status === 429 || response.status >= 500)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt === 2 || !["TypeError", "AbortError", "TimeoutError"].includes(error?.name)) throw error;
    }
    console.warn(`Cloudflare metadata GET retry ${attempt + 2}/3.`);
    await delay(500 * (attempt + 1));
  }
}

function cloudflareAuth(env) {
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID || "")) throw new Error("Cloudflare account ID missing or invalid");
  if (env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) return { "X-Auth-Key": env.CLOUDFLARE_API_KEY, "X-Auth-Email": env.CLOUDFLARE_EMAIL };
  if (env.CLOUDFLARE_API_TOKEN) return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  throw new Error("Cloudflare credentials missing");
}

async function readWorkersPlan(env, fetchFn = fetch, now = new Date()) {
  const response = await cloudflareMetadataGet(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/subscriptions`, cloudflareAuth(env), fetchFn);
  if (!response.ok) throw new Error(`Cloudflare subscription API HTTP ${response.status}`);
  const body = await response.json();
  if (body.success !== true || body.errors?.length || !Array.isArray(body.result)
    || body.result.some(s => !s || typeof s.rate_plan?.id !== "string" || typeof s.state !== "string")
    || (body.result_info?.total_count > body.result.length)) throw new Error("Cloudflare subscription metadata incomplete");
  const paid = body.result.find(s => s.rate_plan.id === "workers_paid" && s.state === "Paid");
  if (!paid) return { name: "free", variableLimit: 64 };
  const start = Date.parse(paid.current_period_start), end = Date.parse(paid.current_period_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now.getTime() || end <= now.getTime()) {
    throw new Error("Cloudflare paid billing period unavailable");
  }
  return { name: "paid", variableLimit: 128, periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString() };
}
module.exports = { cloudflareAuth, readWorkersPlan, cloudflareMetadataGet };
