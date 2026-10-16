import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Plan = { required: boolean; reason: string; baseline?: string; runId?: number };
const { migrationPlan } = createRequire(import.meta.url)("../scripts/ci-d1-migrations.cjs") as {
  migrationPlan: (options: { repository: string; execute: (file: string, args: string[]) => string }) => Plan;
};
const baseline = "a".repeat(40), current = "b".repeat(40);
const fingerprint = `100644 blob 123\tdrizzle/migrations/0067_indexes.sql\n100644 blob 456\tdrizzle/schema.sql\n100644 blob 789\twrangler.json`;
function proof(options: { changed?: boolean; ghError?: boolean; noRun?: boolean; missingStep?: boolean; wrongHead?: boolean; nonAncestor?: boolean; incomplete?: boolean } = {}) {
  const commands: [string, string[]][] = [];
  const execute = (file: string, args: string[]) => {
    commands.push([file, args]);
    if (file === "gh") {
      if (options.ghError) throw new Error("unavailable");
      if (args[1] === "list") return JSON.stringify(options.noRun ? [] : [{ databaseId: 123, headSha: baseline, headBranch: "main", event: "push", conclusion: "success" }]);
      return JSON.stringify({ headSha: options.wrongHead ? current : baseline, headBranch: "main", event: "push", conclusion: "success", jobs: [{ name: "verify-and-deploy", conclusion: "success", steps: [
        { name: "Apply pending D1 migrations", conclusion: options.missingStep ? "skipped" : "success" }, { name: "Deploy Cloudflare Pages", conclusion: "success" },
      ] }] });
    }
    if (args[0] === "rev-parse") return current;
    if (args[0] === "merge-base") { if (options.nonAncestor) throw new Error("not an ancestor"); return ""; }
    if (args[0] === "ls-tree") {
      if (options.incomplete) return "";
      return fingerprint + (options.changed && args[3] === current ? "\n100644 blob 999\tdrizzle/migrations/0068_new.sql" : "");
    }
    throw new Error("unexpected command");
  };
  return { execute, commands };
}

describe("CI database proof", () => {
  it("avoids D1 only when exact files match a proven applied production release", () => {
    const fx = proof();
    expect(migrationPlan({ repository: "Hasbi1605/Axvara", execute: fx.execute })).toEqual({ required: false, reason: "identical_to_applied_production_database", baseline, runId: 123 });
    expect(fx.commands.every(([file]) => ["git", "gh"].includes(file))).toBe(true);
    const listing = fx.commands.find(([file, args]) => file === "gh" && args[1] === "list")![1];
    for (const value of ["ci.yml", "main", "push", "success"]) expect(listing).toContain(value);
  });

  it.each([
    ["new migration", { changed: true }], ["GitHub unavailable", { ghError: true }], ["first release", { noRun: true }],
    ["skipped migration step", { missingStep: true }], ["mismatching run", { wrongHead: true }],
    ["unrelated history", { nonAncestor: true }], ["missing schema/config", { incomplete: true }],
  ] as const)("requires Wrangler instead of bypassing the guard on %s", (_name, options) => {
    expect(migrationPlan({ repository: "Hasbi1605/Axvara", execute: proof(options).execute }).required).toBe(true);
  });

  it("requires Wrangler for changed schema or binding configuration as well as new migration files", () => {
    for (const file of ["drizzle/schema.sql", "wrangler.json"]) {
      const fx = proof();
      const execute = (command: string, args: string[]) => {
        const result = fx.execute(command, args);
        return command === "git" && args[0] === "ls-tree" && args[3] === current ? result.replace(`\t${file}`, `changed\t${file}`) : result;
      };
      expect(migrationPlan({ repository: "Hasbi1605/Axvara", execute }).required).toBe(true);
    }
  });

  it("does not call external commands for an invalid repository and preserves migration-before-deploy ordering", () => {
    const execute = () => { throw new Error("must not run"); };
    expect(migrationPlan({ repository: "", execute }).required).toBe(true);
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow.indexOf("Apply pending D1 migrations")).toBeLessThan(workflow.indexOf("Deploy Cloudflare Pages"));
    const source = readFileSync("scripts/ci-d1-migrations.cjs", "utf8");
    expect(source).toContain("process.exitCode = result.status ?? 1");
    expect(source).not.toContain("continue-on-error");
  });

  it("the CLI propagates migration failure and --check-only never runs the migration command", () => {
    const directory = mkdtempSync(join(tmpdir(), "axvara-ci-migration-"));
    try {
      // Substitute only npx; this test cannot contact D1 or run a real migration.
      writeFileSync(join(directory, "npx"), "#!/bin/sh\nexit 42\n", { mode: 0o755 });
      const script = resolve("scripts/ci-d1-migrations.cjs");
      const env = { ...process.env, GITHUB_REPOSITORY: "", PATH: directory };
      const failed = spawnSync(process.execPath, [script], { env, encoding: "utf8" });
      expect(failed.status).toBe(42);
      const readOnly = spawnSync(process.execPath, [script, "--check-only"], { env, encoding: "utf8" });
      expect(readOnly.status).toBe(0);
      expect(JSON.parse(readOnly.stdout)).toEqual({ required: true, reason: "missing_repository" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
