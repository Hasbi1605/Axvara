import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const environments = ["production", "preview"];
const keyPattern = /^[A-Z][A-Z0-9_]*$/;

export function parseBackup(text) {
  /** @type {Record<string, Record<string, string>>} */
  const blocks = {};
  let current;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const header = raw.match(/^\[(production|preview|worker:axvara-mcp)\]$/);
    if (header) {
      if (Object.hasOwn(blocks, header[1])) throw new Error(`Duplicate block at line ${index + 1}`);
      current = blocks[header[1]] = {};
      continue;
    }
    const entry = raw.match(/^([A-Z][A-Z0-9_]*)=(.+)$/);
    if (!current || !entry || !entry[2].trim() || raw.includes("\0") || Object.hasOwn(current, entry[1])) {
      throw new Error(`Invalid or duplicate assignment at line ${index + 1}`);
    }
    // Literal values: no shell expansion, quote removal, or splitting on further '='.
    current[entry[1]] = entry[2];
  }
  if (!environments.some(env => blocks[env])) throw new Error("No Pages environment block");
  return blocks;
}

export function parseOptions(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    apply: { type: "boolean", default: false }, env: { type: "string" }, only: { type: "string" },
  } });
  if (positionals.length > 1 || (values.env && !environments.includes(values.env))) throw new Error("Invalid arguments");
  const only = values.only === undefined ? undefined : values.only.split(",");
  if (only && (!only.length || only.some(key => !keyPattern.test(key)))) throw new Error("Invalid key selection");
  return { apply: values.apply, env: values.env, only, path: positionals[0] };
}

export function buildPayload(env, values, projectKeys) {
  if (!environments.includes(env) || !values || !projectKeys) throw new Error("Invalid environment metadata");
  const allowed = new Set(projectKeys);
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([key, value]) => !keyPattern.test(key) || !allowed.has(key)
    || typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value))) {
    throw new Error("Empty, invalid, or unknown project key");
  }
  return { deployment_configs: { [env]: { env_vars: Object.fromEntries(entries.map(([key, value]) =>
    [key, { type: "secret_text", value }])) } } };
}

function names(project) {
  return Object.fromEntries(environments.map(env => {
    const vars = project?.deployment_configs?.[env]?.env_vars;
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) throw new Error("Missing project metadata");
    return [env, Object.keys(vars).sort()];
  }));
}

/**
 * @param {Record<string, Record<string, string>>} backup
 * @param {{apply?: boolean, env?: string, only?: string[], credentials?: Record<string, string>, fetchFn?: typeof fetch, log?: (message: string) => void}} options
 */
export async function restore(backup, { apply = false, env, only, credentials, fetchFn = fetch, log = console.log } = {}) {
  if (env !== undefined && !environments.includes(env)) throw new Error("Invalid environment");
  const selected = Object.fromEntries(environments.filter(e => (!env || env === e) && backup[e]).map(e =>
    [e, Object.fromEntries(Object.entries(backup[e]).filter(([key]) => !only || only.includes(key)))]));
  if (!Object.keys(selected).length || (only && (!only.length || only.some(key => !keyPattern.test(key)
    || !Object.values(selected).some(values => Object.hasOwn(values, key)))))) throw new Error("Unknown key selection");
  for (const [e, values] of Object.entries(selected)) {
    log(`${apply ? "APPLY" : "DRY-RUN"} ${e}: ${Object.keys(values).length} keys: ${Object.keys(values).sort().join(", ")}`);
  }
  log("Worker is manual only: wrangler secret put AXVARA_CRON_SECRET --config mcp-worker/wrangler.toml");
  if (!apply) return;

  const auth = credentials ?? parseEnv(await readFile(new URL("../.cf-credentials", import.meta.url), "utf8"));
  if (!auth.CLOUDFLARE_API_KEY?.trim() || !auth.CLOUDFLARE_EMAIL?.trim()) throw new Error("Cloudflare credentials missing");
  const headers = { "X-Auth-Key": auth.CLOUDFLARE_API_KEY, "X-Auth-Email": auth.CLOUDFLARE_EMAIL, "Content-Type": "application/json" };
  async function api(url, method = "GET", body) {
    try {
      const response = await fetchFn(url, { method, headers, redirect: "error", signal: AbortSignal.timeout(30_000),
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok || data?.success !== true || !data.result || data.errors?.length) throw new Error();
      return data.result;
    } catch {
      throw new Error(`Cloudflare ${method} failed; no response values logged`);
    }
  }
  const accounts = await api("https://api.cloudflare.com/client/v4/accounts");
  if (!Array.isArray(accounts) || accounts.length !== 1 || !/^[a-f0-9]{32}$/.test(accounts[0].id)) throw new Error("Expected one Cloudflare account");
  const url = `https://api.cloudflare.com/client/v4/accounts/${accounts[0].id}/pages/projects/axvara`;
  const baseline = names(await api(url));
  // Validate every requested block before the first write; never replay GET values.
  const payloads = Object.entries(selected).filter(([, values]) => Object.keys(values).length)
    .map(([e, values]) => [e, buildPayload(e, values, baseline[e])]);
  if (!payloads.length) throw new Error("No selected keys");
  for (const [e, payload] of payloads) {
    if (JSON.stringify(names(await api(url))) !== JSON.stringify(baseline)) throw new Error("Project keys changed before PATCH; stop");
    try {
      await api(url, "PATCH", payload);
    } finally {
      if (JSON.stringify(names(await api(url))) !== JSON.stringify(baseline)) throw new Error("Project keys changed after PATCH; stop");
    }
    log(`Verified ${e}: production ${baseline.production.length}, preview ${baseline.preview.length} project names unchanged. Values require a new deployment to verify.`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const backup = parseBackup(await readFile(options.path ?? new URL("../.pages-env-backup", import.meta.url), "utf8"));
  await restore(backup, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error("Pages env restore failed; stop and inspect backup/project metadata. No values logged.");
  process.exitCode = 1;
});
