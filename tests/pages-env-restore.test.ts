import { describe, expect, it, vi } from "vitest";
import { buildPayload, parseBackup, parseOptions, restore } from "../scripts/pages-env-restore.mjs";

const text = "# local only\n[production]\nA=private=value==#literal\nB=false\n# MISSING=\n\n[preview]\nA=preview-value\n[worker:axvara-mcp]\nAXVARA_CRON_SECRET=worker-value\n";
const credentials = { CLOUDFLARE_API_KEY: "fixture-api-key", CLOUDFLARE_EMAIL: "owner@example.test" };
const project = { deployment_configs: {
  production: { env_vars: { A: { type: "secret_text", value: "" }, B: { type: "secret_text", value: "" } }, fail_open: false },
  preview: { env_vars: { A: { type: "secret_text", value: "" } } },
} };
const ok = (result: unknown) => Response.json({ success: true, result });
const account = () => ok([{ id: "a".repeat(32) }]);

describe("Pages env backup restore", () => {
  it("parses blocks/comments and preserves literal values containing '=' and '#'", () => {
    expect(parseBackup(text)).toEqual({ production: { A: "private=value==#literal", B: "false" },
      preview: { A: "preview-value" }, "worker:axvara-mcp": { AXVARA_CRON_SECRET: "worker-value" } });
    expect(parseBackup("[production]\r\nA=  literal spaces  \r\n").production.A).toBe("  literal spaces  ");
  });

  it.each(["A=value", "[other]\nA=value", "[production]\nA=", "[production]\nA=   ",
    "[production]\nA=x\nA=y", "[production]\n[production]\nA=x", "[production]\nA=x\0y", "[production]\nbad=x"])(
    "rejects malformed/duplicate/empty input without leaking values", input => {
      expect(() => parseBackup(input)).toThrow();
      try { parseBackup(input); } catch (error) { expect(String(error)).not.toContain(input); }
    });

  it("builds only supplied keys as secret_text without GET metadata", () => {
    expect(buildPayload("production", { A: "exact=secret" }, ["A", "B"])).toEqual({
      deployment_configs: { production: { env_vars: { A: { type: "secret_text", value: "exact=secret" } } } },
    });
    expect(() => buildPayload("production", { UNKNOWN: "private" }, ["A"])).toThrow("unknown project key");
    expect(() => buildPayload("production", { A: "" }, ["A"])).toThrow();
    expect(() => buildPayload("production", { A: "line\nbreak" }, ["A"])).toThrow();
    expect(() => buildPayload("worker:axvara-mcp", { A: "private" }, ["A"])).toThrow();
  });

  it("defaults to dry-run without fetch or credentials and prints names only", async () => {
    const fetchFn = vi.fn();
    const log = vi.fn();
    await restore(parseBackup(text), { fetchFn, log });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("DRY-RUN production: 2 keys: A, B");
    expect(log.mock.calls.flat().join("\n")).toContain("wrangler secret put AXVARA_CRON_SECRET");
    for (const value of ["private=value", "preview-value", "worker-value"]) expect(log.mock.calls.flat().join()).not.toContain(value);
  });

  it("filters --only/--env and rejects unknown options/keys", async () => {
    const options = parseOptions(["/tmp/fixture", "--only", "B", "--env", "production"]);
    expect(options).toEqual({ path: "/tmp/fixture", apply: false, env: "production", only: ["B"] });
    const log = vi.fn();
    await restore(parseBackup(text), { ...options, log });
    expect(log.mock.calls[0][0]).toBe("DRY-RUN production: 1 keys: B");
    expect(() => parseOptions(["--env", "worker:axvara-mcp"])).toThrow();
    expect(() => parseOptions(["--only", ""])).toThrow();
    expect(() => parseOptions(["--oops"])).toThrow();
    await expect(restore(parseBackup(text), { only: ["UNKNOWN"], log })).rejects.toThrow("Unknown key selection");
    await expect(restore(parseBackup(text), { only: ["B"], env: "preview", log })).rejects.toThrow("Unknown key selection");
  });

  it("PATCHes each selected Pages env only, then verifies both name sets; never touches Worker", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(account())
      .mockImplementation(async (_url: string, init: RequestInit) => ok(init.method === "PATCH" ? {} : project));
    const log = vi.fn();
    await restore(parseBackup(text), { apply: true, only: ["A"], credentials, fetchFn, log });
    const patches = fetchFn.mock.calls.filter(([, init]) => init.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(JSON.parse(patches[0][1].body)).toEqual(buildPayload("production", { A: "private=value==#literal" }, ["A"]));
    expect(JSON.parse(patches[1][1].body)).toEqual(buildPayload("preview", { A: "preview-value" }, ["A"]));
    expect(fetchFn.mock.calls).toHaveLength(8);
    expect(fetchFn.mock.calls.every(([url]) => !url.includes("workers"))).toBe(true);
    expect(log.mock.calls.flat().join()).not.toContain("private=value");
  });

  it("preflights all blocks before any PATCH, rejecting unknown project keys", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(account()).mockResolvedValue(ok(project));
    const backup = parseBackup(text);
    backup.preview.EXTRA = "secret-not-in-project";
    await expect(restore(backup, { apply: true, credentials, fetchFn, log: vi.fn() })).rejects.toThrow("unknown project key");
    expect(fetchFn.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(false);
  });

  it("stops if names change before PATCH", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(account()).mockResolvedValueOnce(ok(project))
      .mockResolvedValue(ok({ deployment_configs: { ...project.deployment_configs, preview: { env_vars: {} } } }));
    await expect(restore(parseBackup(text), { apply: true, credentials, fetchFn, log: vi.fn() })).rejects.toThrow("before PATCH");
    expect(fetchFn.mock.calls.some(([, init]) => init.method === "PATCH")).toBe(false);
  });

  it("stops after the first PATCH if names change; no second environment write", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(account()).mockResolvedValueOnce(ok(project))
      .mockResolvedValueOnce(ok(project)).mockResolvedValueOnce(ok({}))
      .mockResolvedValue(ok({ deployment_configs: { ...project.deployment_configs, production: { env_vars: {} } } }));
    await expect(restore(parseBackup(text), { apply: true, credentials, fetchFn, log: vi.fn() })).rejects.toThrow("after PATCH");
    expect(fetchFn.mock.calls.filter(([, init]) => init.method === "PATCH")).toHaveLength(1);
  });

  it("verifies names even after failed PATCH and never includes raw API errors", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(account()).mockResolvedValueOnce(ok(project))
      .mockResolvedValueOnce(ok(project)).mockResolvedValueOnce(Response.json({ success: false, errors: [{ message: "private-secret-echo" }] }, { status: 400 }))
      .mockResolvedValueOnce(ok(project));
    await expect(restore(parseBackup(text), { apply: true, credentials, fetchFn, log: vi.fn() }))
      .rejects.toThrow("Cloudflare PATCH failed; no response values logged");
    expect(fetchFn).toHaveBeenCalledTimes(5);
    expect(fetchFn.mock.lastCall?.[1].method).toBe("GET");
  });
});
