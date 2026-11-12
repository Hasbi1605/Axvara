/* eslint-disable @typescript-eslint/no-require-imports -- CI scripts use CommonJS. */
const { readFileSync } = require("node:fs");
const { parseConfigFileTextToJson } = require("typescript");
const { cloudflareAuth } = require("./cloudflare-plan.cjs");

async function configureRouting(config, env = process.env, fetchFn = fetch, apply = false) {
  const domain = config.vars?.MAIL_DOMAIN;
  const reserved = new Set((config.vars?.RESERVED_MAILBOXES || "").split(",").map(value => value.trim().toLowerCase()));
  if (domain !== "isturaiky.page" || config.name !== "axvara-temp-mail"
    || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== "DB"
    || config.d1_databases[0].database_name !== "axvara-temp-mail"
    || config.d1_databases[0].database_id !== "a507b69c-7493-4e76-9d63-68a38d9202de"
    || !["aws-root", "aws-billing", "aws-security", "kiro"].every(name => reserved.has(name))) {
    throw new Error("Temp mail domain or private-address exclusions invalid");
  }
  const headers = cloudflareAuth(env);
  async function api(path, method = "GET", data) {
    const response = await fetchFn(`https://api.cloudflare.com/client/v4/${path}`, {
      method, headers: { ...headers, "Content-Type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Temp mail routing API unavailable");
    const body = await response.json();
    if (body?.success !== true || body.errors?.length || body.result == null
      || (Array.isArray(body.result) && body.result_info?.total_count > body.result.length)) {
      throw new Error("Temp mail routing API incomplete");
    }
    return body.result;
  }
  const zones = await api(`zones?name=${domain}`);
  if (!Array.isArray(zones) || zones.length !== 1 || zones[0].name !== domain
    || zones[0].status !== "active" || zones[0].account?.id !== env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error("Temp mail receiving zone unavailable");
  }
  const base = `zones/${zones[0].id}/email/routing`;
  const routing = await api(base);
  if (routing.enabled !== true || routing.status !== "ready") throw new Error("Temp mail receiving DNS not ready");
  const rules = await api(`${base}/rules?per_page=200`);
  if (!Array.isArray(rules)) throw new Error("Temp mail rules unavailable");
  const literals = rules.filter(rule => !rule.matchers?.some(matcher => matcher.type === "all"));
  for (const name of ["aws-root", "aws-billing", "aws-security", "kiro"]) {
    if (!literals.some(rule => rule.enabled === true && rule.matchers?.length === 1
      && rule.matchers[0].type === "literal" && rule.matchers[0].field === "to"
      && rule.matchers[0].value === `${name}@${domain}` && rule.actions?.length === 1
      && rule.actions[0].type === "forward" && rule.actions[0].value?.length === 1
      && typeof rule.actions[0].value[0] === "string")) {
      throw new Error("A required private forwarding rule is missing or disabled");
    }
  }
  for (const rule of literals.filter(rule => rule.enabled)) {
    const matchers = rule.matchers;
    if (!Array.isArray(matchers) || matchers.length !== 1 || matchers[0].type !== "literal"
      || matchers[0].field !== "to" || !matchers[0].value?.endsWith(`@${domain}`)
      || !reserved.has(matchers[0].value.slice(0, -domain.length - 1).toLowerCase())) {
      throw new Error("An existing private route is not excluded from public inboxes");
    }
  }
  const catchAll = await api(`${base}/rules/catch_all`);
  const isOurs = rule => rule.enabled === true && rule.actions?.length === 1
    && rule.actions[0].type === "worker" && rule.actions[0].value?.length === 1
    && rule.actions[0].value[0] === config.name;
  if (!isOurs(catchAll) && !(catchAll.enabled === false && catchAll.actions?.length === 1
    && catchAll.actions[0].type === "drop")) throw new Error("Existing catch-all belongs to another service");
  if (!apply) return { applied: false, privateRules: literals.length };

  const settings = await api(`accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${config.name}/settings`);
  const binding = name => settings.bindings?.find(value => value.name === name);
  if (binding("MAIL_DOMAIN")?.text !== domain
    || binding("RESERVED_MAILBOXES")?.text !== config.vars.RESERVED_MAILBOXES
    || binding("DB")?.id !== config.d1_databases?.[0]?.database_id) {
    throw new Error("Deployed receiver configuration does not match routing");
  }
  const updated = await api(`${base}/rules/catch_all`, "PUT", {
    name: "AXVARA public temp mail", enabled: true,
    matchers: [{ type: "all" }], actions: [{ type: "worker", value: [config.name] }],
  });
  if (!isOurs(updated) || !isOurs(await api(`${base}/rules/catch_all`))) {
    throw new Error("Temp mail catch-all activation unconfirmed");
  }
  const after = await api(`${base}/rules?per_page=200`);
  if (!Array.isArray(after)) throw new Error("Private routes could not be verified");
  const fingerprint = rows => JSON.stringify(rows.map(({ id, name, enabled, priority, matchers, actions }) => (
    { id, name, enabled, priority, matchers, actions }
  )).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  if (fingerprint(literals) !== fingerprint(after.filter(rule => !rule.matchers?.some(matcher => matcher.type === "all")))) {
    throw new Error("Private routing changed during temp mail activation");
  }
  return { applied: true, privateRules: literals.length };
}

module.exports = { configureRouting };
if (require.main === module) {
  const parsed = parseConfigFileTextToJson("temp-mail/wrangler.jsonc", readFileSync("temp-mail/wrangler.jsonc", "utf8"));
  if (parsed.error) throw new Error("Temp mail configuration invalid");
  configureRouting(parsed.config, process.env, fetch, process.argv.includes("--apply")).then(result => {
    console.log(`Temp mail routing ${result.applied ? "activated" : "preflight passed"}; ${result.privateRules} private rules preserved.`);
  }).catch(() => {
    console.error("Temp mail routing failed; inspect domain, private-address exclusions and deployed bindings. No provider response or secrets logged.");
    process.exitCode = 1;
  });
}
