import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const { variableBudget, checkPagesEnvironment } = createRequire(import.meta.url)("../scripts/ci-pages-env-check.cjs") as {
  variableBudget: (project: unknown) => { configured: number; total: number; limit: number; remaining: number };
  checkPagesEnvironment: (env: Record<string, string>, fetchFn: typeof fetch) => Promise<ReturnType<typeof variableBudget>>;
};
const freePlan = Response.json({success:true,result:[]});
const metadataFetch = (response: Response) => vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith("/subscriptions") ? freePlan.clone() : response.clone());
const env = { NODE_ENV: "test" as const, CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_KEY: "private-key", CLOUDFLARE_EMAIL: "owner@example.test" };
const project = (count: number) => ({ deployment_configs: { production: { env_vars: Object.fromEntries(
  Array.from({ length: count }, (_, i) => [`VAR_${i}`, { type: i % 2 ? "secret_text" : "plain_text", value: "never-log-this" }]),
) } } });

describe("Pages variable preflight", () => {
  it("reproduces the failed deployment and accepts exactly the Free limit", () => {
    expect(variableBudget(project(61))).toEqual({ configured: 61, total: 65, limit: 64, remaining: -1 });
    expect(variableBudget(project(60))).toEqual({ configured: 60, total: 64, limit: 64, remaining: 0 });
    expect(JSON.stringify(variableBudget(project(58)))).not.toContain("never-log-this");
  });

  it("does not double count an explicitly configured Pages system variable", () => {
    const p = project(59);
    p.deployment_configs.production.env_vars.CF_PAGES = { type: "plain_text", value: "1" };
    expect(variableBudget(p)).toMatchObject({ configured: 60, total: 63, remaining: 1 });
  });

  it.each([null, {}, { deployment_configs: { production: {} } },
    { deployment_configs: { production: { env_vars: [] } } },
    { deployment_configs: { production: { env_vars: { BAD: null } } } },
    { deployment_configs: { production: { env_vars: { BAD: { type: "unknown" } } } } },
  ])("rejects incomplete configuration rather than reporting available capacity (%j)", p => {
    expect(() => variableBudget(p)).toThrow("metadata unavailable");
  });

  it("reads only project metadata using existing credentials", async () => {
    const fetchFn = metadataFetch(Response.json({ success: true, result: project(60) }));
    expect(await checkPagesEnvironment(env, fetchFn)).toMatchObject({ total: 64 });
    expect(fetchFn).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/axvara`,
      { headers: { "X-Auth-Key": "private-key", "X-Auth-Email": "owner@example.test" }, signal: expect.any(AbortSignal) },
    );
    // No method/body means GET; this preflight cannot edit env, query D1 or deploy.
  });

  it("supports API tokens and rejects missing credentials before requesting data", async () => {
    const fetchFn = metadataFetch(Response.json({ success: true, result: project(20) }));
    await checkPagesEnvironment({ CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: "token" }, fetchFn);
    expect(fetchFn.mock.calls[1][1]?.headers).toEqual({ Authorization: "Bearer token" });
    fetchFn.mockClear();
    await expect(checkPagesEnvironment({}, fetchFn)).rejects.toThrow();
    await expect(checkPagesEnvironment({ CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID }, fetchFn)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    new Response("private-provider-error", { status: 403 }),
    Response.json({ success: false, errors: [{ message: "private-provider-error" }] }),
    Response.json({ success: true, errors: [{ message: "private-provider-error" }], result: project(60) }),
    Response.json({ success: true, result: {} }),
    new Response("invalid-json"),
  ])("fails closed when the API is unavailable or incomplete", async response => {
    await expect(checkPagesEnvironment(env, metadataFetch(response))).rejects.toThrow();
  });

  it("runs before build/migrations and CLI failure returns nonzero without exposing values", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const start = workflow.indexOf("- name: Check Pages variable limit");
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(workflow.indexOf("- name: Build Cloudflare Pages artifact"));
    expect(start).toBeLessThan(workflow.indexOf("- name: Apply pending D1 migrations"));
    expect(workflow.slice(start, workflow.indexOf("- name: Build Cloudflare Pages artifact")))
      .toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'");
    const result = spawnSync(process.execPath, [resolve("scripts/ci-pages-env-check.cjs")], { env: { NODE_ENV: "test" }, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("deployment stopped");
    expect(result.stderr).not.toContain("private-key");
  });

  it("CLI stops an oversized release and accepts 64 variables without logging secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "axvara-pages-env-"));
    try {
      const preload = join(directory, "fetch.cjs");
      for (const count of [60, 61]) {
        writeFileSync(preload, `globalThis.fetch = async url => Response.json(String(url).endsWith("/subscriptions") ? {success:true,result:[]} : ${JSON.stringify({ success: true, result: project(count) })});`);
        const result = spawnSync(process.execPath, ["--require", preload, resolve("scripts/ci-pages-env-check.cjs")], {
          env, encoding: "utf8",
        });
        expect(result.status).toBe(count === 60 ? 0 : 1);
        expect(result.stdout).toContain(`${count + 4}/64`);
        expect(result.stdout + result.stderr).not.toContain("never-log-this");
        expect(result.stdout + result.stderr).not.toContain("private-key");
        expect(count === 60 ? result.stdout : result.stderr).toContain(count === 60 ? "::warning::" : "::error::");
      }
      writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("private-key"); };');
      const failed = spawnSync(process.execPath, ["--require", preload, resolve("scripts/ci-pages-env-check.cjs")], { env, encoding: "utf8" });
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain("deployment stopped");
      expect(failed.stderr).not.toContain("private-key");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
