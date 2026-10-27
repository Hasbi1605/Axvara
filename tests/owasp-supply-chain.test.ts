// owasp-supply-chain.test.ts — OWASP A03 supply-chain regression tests.
// Lockfile-pin tests read the real package-lock.json files. Gate-logic tests
// use mocked exec output (no live network): deterministic scenarios for
// clean reports, runtime high/critical, registry {error:E503}, malformed
// JSON, exec timeout, and missing metadata.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require("../scripts/security-dependencies.cjs") as {
  parseAuditOutput: (stdout: string) => { ok: boolean; report?: any; error?: string };
  classifyHighCritical: (report: any, scope: string) => any[];
  runGate: (
    execFn: (cwd: string, omitDev: boolean) => { exit: number; stdout: string; execError?: string },
    opts?: { rootOnly?: boolean },
  ) => { ok: boolean; runtimeHighCritical: any[]; devOnly: any; errors: string[] };
};

function readLockVersion(lockPath: string, pkgPath: string): string | null {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return lock.packages?.[pkgPath]?.version ?? null;
  } catch {
    return null;
  }
}

function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return true;
}

const cleanReport = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: { ...extra },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  });

const highReport = (name: string, severity = "high") =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      [name]: {
        name,
        severity,
        isDirect: true,
        via: [{ url: "https://github.com/advisories/GHSA-test", title: `${name} test advisory`, range: "<9.9.9" }],
        range: "<9.9.9",
        nodes: [`node_modules/${name}`],
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: severity === "high" ? 1 : 0, critical: severity === "critical" ? 1 : 0, total: 1 } },
  });

describe("owasp supply-chain: lockfile pins", () => {
  const rootLock = path.join(REPO_ROOT, "package-lock.json");
  const gwLock = path.join(REPO_ROOT, "gateway", "package-lock.json");

  it("root zod is patched past GHSA-mrhx-c7xc-m3w5 (<4.6.6)", () => {
    const v = readLockVersion(rootLock, "node_modules/zod");
    expect(v).toBeTruthy();
    expect(semverGte(v!, "4.6.6")).toBe(true);
  });

  it("root undici override is patched to >= 7.30.1 (miniflare 4 toolchain)", () => {
    const v = readLockVersion(rootLock, "node_modules/undici");
    expect(v).toBeTruthy();
    expect(semverGte(v!, "7.30.1")).toBe(true);
  });

  it("root miniflare is major-bumped to 4.x (nested zod/sharp advisories resolved)", () => {
    const mf = readLockVersion(rootLock, "node_modules/miniflare");
    expect(mf).toBeTruthy();
    expect(semverGte(mf!, "4.20260730.0")).toBe(true);
    const nestedZod = readLockVersion(rootLock, "node_modules/miniflare/node_modules/zod");
    expect(nestedZod).toBeNull();
    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(rootPkg.devDependencies.miniflare).toBe("4.20260730.0");
  });

  it("root sharp stays patched to >= 0.35.5 (no MF4 regression)", () => {
    const copies = ["node_modules/sharp", "node_modules/miniflare/node_modules/sharp", "node_modules/next/node_modules/sharp"];
    let seen = 0;
    for (const pkgPath of copies) {
      const v = readLockVersion(rootLock, pkgPath);
      if (v) {
        seen++;
        expect(semverGte(v, "0.35.5")).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("gateway fastify is patched to >= 5.12.6", () => {
    const v = readLockVersion(gwLock, "node_modules/fastify");
    expect(v).toBeTruthy();
    expect(semverGte(v!, "5.12.6")).toBe(true);
  });

  it("gateway fast-uri is patched (>= 4.2.3 / nested >= 3.1.9)", () => {
    const v4 = readLockVersion(gwLock, "node_modules/fast-uri");
    const v3 = readLockVersion(gwLock, "node_modules/ajv/node_modules/fast-uri");
    expect(v4).toBeTruthy();
    expect(semverGte(v4!, "4.2.3")).toBe(true);
    if (v3) expect(semverGte(v3, "3.1.9")).toBe(true);
  });

  it("gateway music-metadata is patched to >= 11.16.0", () => {
    const v = readLockVersion(gwLock, "node_modules/music-metadata");
    expect(v).toBeTruthy();
    expect(semverGte(v!, "11.16.0")).toBe(true);
  });

  it("gateway sharp is patched to >= 0.35.5", () => {
    const v = readLockVersion(gwLock, "node_modules/sharp");
    expect(v).toBeTruthy();
    expect(semverGte(v!, "0.35.5")).toBe(true);
  });

  it("contracts preserved: Next 15.5.28, nop 1.13.x, Baileys rc14, Node 22.x", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const gwPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "gateway", "package.json"), "utf8"));
    expect(rootPkg.dependencies.next).toBe("15.5.28");
    expect(rootPkg.devDependencies["@cloudflare/next-on-pages"]).toBe("1.13");
    expect(gwPkg.dependencies["@whiskeysockets/baileys"]).toBe("7.0.0-rc14");
    expect(gwPkg.engines.node).toBe("22.x");
  });
});

describe("owasp supply-chain: gate validation (mocked, no network)", () => {
  it("accepts a clean advisory report", () => {
    const r = gate.parseAuditOutput(cleanReport());
    expect(r.ok).toBe(true);
    expect(gate.classifyHighCritical(r.report, "root:runtime")).toEqual([]);
  });

  it("rejects registry {error:E503} JSON as an error, not a clean pass", () => {
    const r = gate.parseAuditOutput(JSON.stringify({ error: { code: "E503", summary: "Service Unavailable" } }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/E503/);
  });

  it("rejects malformed JSON", () => {
    expect(gate.parseAuditOutput("<html>proxy error</html>").ok).toBe(false);
    expect(gate.parseAuditOutput("").ok).toBe(false);
  });

  it("rejects malformed collections/counts and inconsistent clean-looking reports", () => {
    const good = JSON.parse(cleanReport());
    for (const vulnerabilities of [[], { zod: null }, { zod: { severity: "unrecognized" } }]) {
      expect(gate.parseAuditOutput(JSON.stringify({ ...good, vulnerabilities })).ok).toBe(false);
    }
    expect(gate.parseAuditOutput(JSON.stringify({ ...good, metadata: { vulnerabilities: {} } })).ok).toBe(false);
    expect(gate.parseAuditOutput(JSON.stringify({ ...good, metadata: { vulnerabilities: { ...good.metadata.vulnerabilities, high: 1, total: 1 } } })).ok).toBe(false);
    expect(gate.runGate(() => ({ exit: 2, stdout: cleanReport() }), { rootOnly: true }).ok).toBe(false);
  });

  it("rejects reports missing metadata.vulnerabilities", () => {
    const r = gate.parseAuditOutput(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/metadata/);
  });

  it("classifies runtime high and critical advisories from real-shaped data", () => {
    const r = gate.parseAuditOutput(highReport("zod", "critical"));
    expect(r.ok).toBe(true);
    const found = gate.classifyHighCritical(r.report, "root:runtime");
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("zod");
    expect(found[0].severity).toBe("critical");
    expect(found[0].advisories[0].url).toContain("GHSA-test");
  });

  it("runGate fails closed when runtime scan flags high (mocked exec)", () => {
    const execFn = (cwd: string, omitDev: boolean) => ({
      exit: omitDev ? 1 : 0,
      stdout: omitDev ? highReport("fastify") : cleanReport(),
    });
    const result = gate.runGate(execFn, { rootOnly: true });
    expect(result.ok).toBe(false);
    expect(result.runtimeHighCritical.map((f: any) => f.name)).toContain("fastify");
  });

  it("runGate fails closed on E503 registry error and sanitizes output", () => {
    const execFn = () => ({
      exit: 1,
      stdout: JSON.stringify({ error: { code: "E503", summary: "x", detail: "token=SECRET_LEAK_TEST" } }),
    });
    const result = gate.runGate(execFn, { rootOnly: true });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("SECRET_LEAK_TEST");
  });

  it("runGate fails closed on exec timeout without leaking stderr", () => {
    const execFn = () => ({ exit: 1, stdout: "", execError: "ETIMEDOUT" });
    const result = gate.runGate(execFn, { rootOnly: true });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/ETIMEDOUT/);
  });

  it("runGate passes on clean mocked scans", () => {
    const execFn = () => ({ exit: 0, stdout: cleanReport() });
    const result = gate.runGate(execFn, { rootOnly: true });
    expect(result.ok).toBe(true);
    expect(result.runtimeHighCritical).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
