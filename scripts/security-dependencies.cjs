#!/usr/bin/env node
// security-dependencies.cjs — OWASP A03 supply-chain gate (read-only).
// Runs `npm audit --json` (+ --omit=dev) for root and gateway/.
// Never installs, updates, or mutates lockfiles. Fails closed on runtime
// high/critical advisories or on any registry/audit error.
// JSON contract: { ok, runtimeHighCritical, devOnly, errors }
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const GATEWAY_DIR = path.join(REPO_ROOT, "gateway");

// A valid advisory report MUST have this shape. Registry failures (E503,
// EAI_AGAIN, ENETUNREACH, timeouts) often still print JSON like
// { "error": { "code": "E503", ... } } — that is NOT a clean report and
// must fail the gate, never pass as "0 vulns".
function parseAuditOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, error: "audit returned malformed JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "audit returned malformed JSON" };
  }
  if (parsed.error) {
    const code =
      parsed.error && typeof parsed.error.code === "string"
        ? parsed.error.code.replace(/[^A-Z0-9_]/gi, "").slice(0, 24)
        : "UNKNOWN";
    return { ok: false, error: `registry audit error: ${code}` };
  }
  if (parsed.auditReportVersion !== 2) {
    return { ok: false, error: "audit returned unexpected report version" };
  }
  if (!parsed.vulnerabilities || typeof parsed.vulnerabilities !== "object" || Array.isArray(parsed.vulnerabilities)) {
    return { ok: false, error: "audit report missing vulnerabilities object" };
  }
  const meta = parsed.metadata && parsed.metadata.vulnerabilities;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { ok: false, error: "audit report missing metadata.vulnerabilities" };
  }
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (![...severities, "total"].every(key => Number.isSafeInteger(meta[key]) && meta[key] >= 0)
    || meta.total !== severities.reduce((sum, key) => sum + meta[key], 0)) {
    return { ok: false, error: "audit report has invalid severity counts" };
  }
  const entries = Object.values(parsed.vulnerabilities);
  if (entries.some(v => !v || typeof v !== "object" || Array.isArray(v) || !severities.includes(v.severity))
    || severities.some(severity => entries.filter(v => v.severity === severity).length !== meta[severity])) {
    return { ok: false, error: "audit report findings disagree with metadata" };
  }
  return { ok: true, report: parsed };
}

function classifyHighCritical(report, scope) {
  const out = [];
  for (const [name, v] of Object.entries(report.vulnerabilities)) {
    if (!v || typeof v !== "object") continue;
    const sev = String(v.severity || "").toLowerCase();
    if (sev !== "high" && sev !== "critical") continue;
    const advisories = (Array.isArray(v.via) ? v.via : [])
      .filter((x) => x && typeof x === "object")
      .map((x) => ({ url: x.url, title: x.title, range: x.range }));
    out.push({
      scope,
      name,
      severity: sev,
      isDirect: !!v.isDirect,
      range: v.range,
      nodes: Array.isArray(v.nodes) ? v.nodes : [],
      advisories,
    });
  }
  return out;
}

// execFn(cwd, omitDev) -> { exit: number, stdout: string } — injectable for tests.
function defaultExec(cwd, omitDev) {
  const cmdArgs = ["audit", "--json"];
  if (omitDev) cmdArgs.push("--omit=dev");
  try {
    const stdout = execFileSync("npm", cmdArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    return { exit: 0, stdout };
  } catch (err) {
    // Nonzero npm exit is allowed ONLY when stdout is a valid advisory
    // report (npm exits 1 when vulns are found). Anything else is an error.
    // Never surface raw stderr: it may contain paths, tokens, or env data.
    const stdout = err && err.stdout ? String(err.stdout) : "";
    if (stdout.trim().startsWith("{")) return { exit: err.status || 1, stdout };
    const code =
      err && err.code ? String(err.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 24) : "EXEC_FAILED";
    return { exit: err && err.status ? err.status : 1, stdout: "", execError: code };
  }
}

function lockfileHashes() {
  const crypto = require("node:crypto");
  const out = {};
  for (const p of [path.join(REPO_ROOT, "package-lock.json"), path.join(GATEWAY_DIR, "package-lock.json")]) {
    try {
      out[p] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
    } catch {
      out[p] = "missing";
    }
  }
  return out;
}

function runGate(execFn, { rootOnly = false } = {}) {
  const before = lockfileHashes();
  const errors = [];
  const runtimeHighCritical = [];
  const devOnly = { root: null, gateway: null };

  const scopes = [{ label: "root", dir: REPO_ROOT }];
  if (!rootOnly && fs.existsSync(path.join(GATEWAY_DIR, "package.json"))) {
    scopes.push({ label: "gateway", dir: GATEWAY_DIR });
  }

  for (const { label, dir } of scopes) {
    const prod = execFn(dir, true);
    if (prod.execError || ![0, 1].includes(prod.exit)) {
      errors.push(`audit execution failed [${label}]: ${prod.execError || "unexpected_exit"}`);
      continue;
    }
    const parsedProd = parseAuditOutput(prod.stdout);
    if (!parsedProd.ok) {
      errors.push(`audit report invalid [${label}:runtime]: ${parsedProd.error}`);
      continue;
    }
    runtimeHighCritical.push(...classifyHighCritical(parsedProd.report, `${label}:runtime`));

    const full = execFn(dir, false);
    if (full.execError || ![0, 1].includes(full.exit)) {
      errors.push(`audit execution failed [${label}]: ${full.execError || "unexpected_exit"}`);
      continue;
    }
    const parsedFull = parseAuditOutput(full.stdout);
    if (!parsedFull.ok) {
      errors.push(`audit report invalid [${label}:full]: ${parsedFull.error}`);
      continue;
    }
    const fullHigh = classifyHighCritical(parsedFull.report, `${label}:full`);
    const runtimeNames = new Set(
      runtimeHighCritical.filter((f) => f.scope.startsWith(label)).map((f) => f.name),
    );
    devOnly[label] = {
      counts: parsedFull.report.metadata.vulnerabilities,
      highCriticalNames: fullHigh.filter((f) => !runtimeNames.has(f.name)).map((f) => f.name),
    };
  }

  const after = lockfileHashes();
  for (const k of Object.keys(before)) {
    if (before[k] !== after[k]) errors.push(`lockfile mutated during read-only audit: ${k}`);
  }

  const ok = errors.length === 0 && runtimeHighCritical.length === 0;
  return { ok, runtimeHighCritical, devOnly, errors };
}

function printHuman(result) {
  if (result.runtimeHighCritical.length > 0) {
    console.log("DEPENDENCY GATE: FAIL — runtime high/critical advisories:");
    for (const f of result.runtimeHighCritical) {
      console.log(` - [${f.scope}] ${f.name} (${f.severity}, range ${f.range})`);
      for (const a of f.advisories) console.log(`     ${a.url} ${a.range}`);
    }
  }
  if (result.errors.length > 0) {
    console.log("DEPENDENCY GATE: FAIL — audit errors (fail-closed):");
    for (const e of result.errors) console.log(` - ${e}`);
  }
  if (result.ok) {
    console.log("DEPENDENCY GATE: PASS — no runtime high/critical advisories (root+gateway).");
    for (const [k, v] of Object.entries(result.devOnly)) {
      if (v && v.highCriticalNames.length > 0) {
        console.log(` note: dev-only high findings [${k}]: ${v.highCriticalNames.join(", ")} (warn, non-blocking)`);
      }
    }
  }
}

module.exports = { parseAuditOutput, classifyHighCritical, runGate, defaultExec };

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const result = runGate(defaultExec, { rootOnly: args.has("--root-only") });
  if (args.has("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printHuman(result);
  }
  process.exit(result.ok ? 0 : 1);
}
