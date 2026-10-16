// Avoid querying D1 for a code-only release when a successful production CI run
// already proves that the exact database files were applied. Any uncertainty
// falls back to Wrangler; migration failures still block deployment.
const { execFileSync, spawnSync } = require("node:child_process");

const DATABASE_PATHS = ["drizzle/migrations", "drizzle/schema.sql", "wrangler.json"];
const SHA = /^[a-f0-9]{40}$/;

function migrationPlan({ repository = process.env.GITHUB_REPOSITORY, cwd = process.cwd(), execute = execFileSync } = {}) {
  const required = reason => ({ required: true, reason });
  const command = (file, args) => execute(file, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
  try {
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository || "")) return required("missing_repository");
    const current = command("git", ["rev-parse", "HEAD"]);
    if (!SHA.test(current)) return required("invalid_checkout");
    const runs = JSON.parse(command("gh", ["run", "list", "--repo", repository, "--workflow", "ci.yml", "--branch", "main", "--event", "push", "--status", "success", "--limit", "1", "--json", "databaseId,headSha,headBranch,event,conclusion"]));
    const run = Array.isArray(runs) && runs[0];
    if (!run || !SHA.test(run.headSha || "") || !Number.isSafeInteger(run.databaseId) || run.databaseId <= 0
      || run.headBranch !== "main" || run.event !== "push" || run.conclusion !== "success") return required("no_successful_production_run");
    const details = JSON.parse(command("gh", ["run", "view", String(run.databaseId), "--repo", repository, "--json", "jobs,headSha,headBranch,event,conclusion"]));
    const job = Array.isArray(details.jobs) && details.jobs.find(job => job.name === "verify-and-deploy" && job.conclusion === "success");
    if (details.headSha !== run.headSha || details.conclusion !== "success" || details.headBranch !== "main" || details.event !== "push"
      || !job || !Array.isArray(job.steps)
      || !["Apply pending D1 migrations", "Deploy Cloudflare Pages"].every(name => job.steps.some(step => step.name === name && step.conclusion === "success"))) {
      return required("unproven_migration_or_deployment");
    }
    // Checkout fetch-depth:0 provides ancestry and tree objects for this proof.
    command("git", ["merge-base", "--is-ancestor", run.headSha, current]);
    const tree = sha => command("git", ["ls-tree", "-r", "--full-tree", sha, "--", ...DATABASE_PATHS]);
    const baseline = tree(run.headSha);
    const target = tree(current);
    if (!baseline.includes("\tdrizzle/schema.sql") || !baseline.includes("\twrangler.json") || !baseline.includes("\tdrizzle/migrations/")) {
      return required("incomplete_database_fingerprint");
    }
    if (baseline !== target) return required("database_files_changed");
    return { required: false, reason: "identical_to_applied_production_database", baseline: run.headSha, runId: run.databaseId };
  } catch {
    // Do not print raw gh output, environment values or credentials.
    return required("verification_unavailable");
  }
}

module.exports = { migrationPlan };

if (require.main === module) {
  const plan = migrationPlan();
  if (process.argv.includes("--check-only")) {
    // Read-only diagnostic: never runs Wrangler.
    console.log(JSON.stringify(plan));
  } else if (!plan.required) {
    console.log(`D1 database files unchanged since successful production run ${plan.runId} (${plan.baseline}); no pending migration changes.`);
  } else {
    console.log(`D1 migrations require a remote check (${plan.reason}).`);
    const result = spawnSync("npx", ["--yes", "wrangler@4.128.0", "d1", "migrations", "apply", "axvara-db", "--remote"], { stdio: "inherit" });
    process.exitCode = result.status ?? 1;
  }
}
