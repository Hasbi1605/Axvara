// Pages adds these runtime variables to the configured secrets/text bindings.
// Read configuration metadata only; never print values or mutate the project.
const SYSTEM_VARIABLES = ["CF_PAGES", "CF_PAGES_BRANCH", "CF_PAGES_COMMIT_SHA", "CF_PAGES_URL"];
const FREE_VARIABLE_LIMIT = 64;
const { cloudflareAuth, readWorkersPlan } = require("./cloudflare-plan.cjs");

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
  const response = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/axvara`, {
    headers, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Pages configuration HTTP ${response.status}`);
  const body = await response.json();
  if (body?.success !== true || !body.result || (body.errors && (!Array.isArray(body.errors) || body.errors.length))) {
    throw new Error("Pages configuration API failed");
  }
  return { ...variableBudget(body.result, plan.variableLimit), plan: plan.name };
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
if (require.main === module) main().catch(() => {
  // API errors may contain sensitive metadata; expose no raw response/errors.
  console.error("Pages environment check failed: configuration unavailable; deployment stopped.");
  process.exitCode = 1;
});
