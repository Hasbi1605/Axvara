// Pages adds these runtime variables to the configured secrets/text bindings.
// Read configuration metadata only; never print values or mutate the project.
const SYSTEM_VARIABLES = ["CF_PAGES", "CF_PAGES_BRANCH", "CF_PAGES_COMMIT_SHA", "CF_PAGES_URL"];
const FREE_VARIABLE_LIMIT = 64;
const { cloudflareAuth, readWorkersPlan, cloudflareMetadataGet } = require("./cloudflare-plan.cjs");

function variableBudget(project, limit = FREE_VARIABLE_LIMIT) {
  const variables = project?.deployment_configs?.production?.env_vars;
  if (!variables || typeof variables !== "object" || Array.isArray(variables)
    || Object.values(variables).some(value => !value || !["plain_text", "secret_text"].includes(value.type))) {
    throw new Error("Pages production environment metadata unavailable");
  }
  const configured = Object.keys(variables).length;
  const total = new Set([...Object.keys(variables), ...SYSTEM_VARIABLES]).size;
  return { configured, total, limit, remaining: limit - total };
}

async function checkPagesEnvironment(env = process.env, fetchFn = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const headers = cloudflareAuth(env);
  const plan = await readWorkersPlan(env, fetchFn);
  const response = await cloudflareMetadataGet(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/axvara`, headers, fetchFn);
  if (!response.ok) throw new Error(`Pages configuration HTTP ${response.status}`);
  const body = await response.json();
  if (body?.success !== true || !body.result || (body.errors && (!Array.isArray(body.errors) || body.errors.length))) {
    throw new Error("Pages configuration API failed");
  }
  const budget = variableBudget(body.result, plan.variableLimit);
  if (body.result.deployment_configs.production.env_vars.BUYER_ORDER_ACCESS_SECRET?.type !== "secret_text") {
    throw new Error("Pages buyer access secret metadata unavailable");
  }
  return { ...budget, plan: plan.name };
}

async function main() {
  const report = await checkPagesEnvironment();
  console.log(`Pages production variables: ${report.total}/${report.limit} (${report.configured} configured + Pages system variables).`);
  if (report.remaining < 0) {
    console.error("::error::Pages variables exceed the active Workers plan limit. Remove unused configuration before deployment.");
    process.exitCode = 1;
  } else if (report.remaining === 0) {
    console.log("::warning::Pages variable capacity is full; adding another secret/text variable will block deployment.");
  }
}

module.exports = { SYSTEM_VARIABLES, FREE_VARIABLE_LIMIT, variableBudget, checkPagesEnvironment };
if (require.main === module) main().catch(error => {
  // Only locally defined reasons/status codes are safe; never print raw errors.
  const message = error?.message;
  const known = ["Cloudflare account ID missing or invalid", "Cloudflare credentials missing", "Cloudflare subscription metadata incomplete", "Cloudflare paid billing period unavailable", "Pages configuration API failed", "Pages production environment metadata unavailable", "Pages buyer access secret metadata unavailable"];
  const reason = known.includes(message) || /^(Pages configuration|Cloudflare subscription API) HTTP [1-5]\d{2}$/.test(message)
    ? message : ["AbortError", "TimeoutError"].includes(error?.name) ? "metadata request timed out" : "metadata request or response unavailable";
  console.error(`Pages environment check failed: ${reason}; deployment stopped.`);
  process.exitCode = 1;
});
