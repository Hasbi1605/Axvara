// Heroku source builds run only in the existing main CI. Never upload local sessions or credentials.
const { execFileSync } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

async function deployGateway(env = process.env, fetchFn = fetch) {
  if (!env.HEROKU_API_KEY) throw new Error("Heroku CI secret is required");
  const app = "axvara-wa-gateway";
  const api = async (path, body) => {
    const range = path === "builds" && !body ? "created_at ..; order=desc,max=200" : path === "releases" ? "version ..; order=desc,max=200" : undefined;
    const endpoint = path === "sources" ? path : `apps/${app}/${path}`;
    const r = await fetchFn(`https://api.heroku.com/${endpoint}`, {
      method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${env.HEROKU_API_KEY}`, Accept: "application/vnd.heroku+json; version=3", "Content-Type": "application/json", ...(range ? { Range: range } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`Heroku API HTTP ${r.status}`);
    return r.json();
  };
  const directory = mkdtempSync(join(tmpdir(), "axvara-wa-source-"));
  try {
    const builds = await api("builds");
    if (!Array.isArray(builds)) throw new Error("Invalid Heroku build metadata");
    const lastBuild = builds.filter(build => build.status === "succeeded")
      .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))[0];
    const baseline = lastBuild?.source_blob?.version;
    const releases = await api("releases");
    if (!Array.isArray(releases)) throw new Error("Invalid Heroku release metadata");
    const currentRelease = releases.filter(release => release.status === "succeeded").sort((a, b) => b.version - a.version)[0];
    if (lastBuild?.slug?.id && currentRelease?.slug?.id === lastBuild.slug.id && /^[a-f0-9]{40}$/i.test(baseline || "")) {
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", baseline, "HEAD"], { stdio: "ignore" });
        execFileSync("git", ["diff", "--quiet", baseline, "HEAD", "--", "gateway", "scripts/ci-whatsapp-gateway.cjs"], { stdio: "ignore" });
        console.log("WhatsApp gateway unchanged since its successful Heroku source build; release skipped.");
        return;
      } catch { /* No complete release proof or changed source: build again. */ }
    }
    const archive = join(directory, "source.tgz");
    execFileSync("tar", ["-czf", archive, "-C", "gateway", "package.json", "package-lock.json", "Procfile", "tsconfig.json", "src", "scripts"]);
    const source = await api("sources", {});
    const upload = await fetchFn(source.source_blob.put_url, { method: "PUT", headers: { "Content-Type": "" }, body: readFileSync(archive), signal: AbortSignal.timeout(60_000) });
    if (!upload.ok) throw new Error("Gateway source upload failed");
    const build = await api("builds", { source_blob: { url: source.source_blob.get_url, version: env.GITHUB_SHA || "unknown" } });
    for (let tries = 0; tries < 90; tries++) {
      const status = await api(`builds/${build.id}`);
      if (status.status === "succeeded") { console.log("WhatsApp gateway build and release succeeded."); return; }
      if (status.status === "failed") throw new Error("WhatsApp gateway build failed; inspect Heroku build output privately");
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    throw new Error("WhatsApp gateway build deadline exceeded");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { deployGateway };
if (require.main === module) deployGateway().catch(error => { console.error(error.message); process.exitCode = 1; });
