import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { configureRouting } = createRequire(import.meta.url)("../scripts/ci-temp-mail-routing.cjs") as {
  configureRouting: (settings: typeof config, environment: typeof env, fetchFn: typeof fetch, apply?: boolean) => Promise<unknown>;
};
const config = {
  name: "axvara-temp-mail", vars: { MAIL_DOMAIN: "isturaiky.page", RESERVED_MAILBOXES: "aws-root,aws-billing,aws-security,kiro" },
  d1_databases: [{ binding: "DB", database_name: "axvara-temp-mail", database_id: "a507b69c-7493-4e76-9d63-68a38d9202de" }],
};
const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CLOUDFLARE_API_TOKEN: "private-token" };
const privateRule = {
  id: "private", name: "Private forwarding", enabled: true, priority: 10,
  matchers: [{ type: "literal", field: "to", value: "aws-root@isturaiky.page" }],
  actions: [{ type: "forward", value: ["owner@example.test"] }],
};
const off = { id: "catch", enabled: false, matchers: [{ type: "all" }], actions: [{ type: "drop" }] };
const on = { ...off, enabled: true, actions: [{ type: "worker", value: [config.name] }] };
const privateRules = config.vars.RESERVED_MAILBOXES.split(",").map(name => ({
  ...privateRule, id: name, matchers: [{ type: "literal", field: "to", value: `${name}@isturaiky.page` }],
}));
function fixture(overrides: Record<string, unknown> = {}) {
  let applied = false;
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/client/v4/", "");
    const results: Record<string, unknown> = {
      zones: [{ id: "zone", name: config.vars.MAIL_DOMAIN, status: "active", account: { id: env.CLOUDFLARE_ACCOUNT_ID } }],
      "zones/zone/email/routing": { enabled: true, status: "ready" },
      "zones/zone/email/routing/rules": [...privateRules, applied ? on : off],
      "zones/zone/email/routing/rules/catch_all": applied ? on : off,
      [`accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${config.name}/settings`]: { bindings: [
        { name: "MAIL_DOMAIN", text: config.vars.MAIL_DOMAIN },
        { name: "RESERVED_MAILBOXES", text: config.vars.RESERVED_MAILBOXES },
        { name: "DB", id: config.d1_databases[0].database_id },
      ] },
    };
    if (init?.method === "PUT") {
      applied = true;
      return Response.json({ success: true, result: on });
    }
    return Response.json({ success: true, result: path in overrides ? overrides[path] : results[path] });
  });
  return fetchFn;
}

describe("temp mail release routing", () => {
  it("preflights without changing MX, private forwarding, catch-all or querying D1", async () => {
    const fetchFn = fixture();
    expect(await configureRouting(config, env, fetchFn)).toEqual({ applied: false, privateRules: 4 });
    expect(fetchFn.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(fetchFn.mock.calls.some(([url]) => /dns_records|\/d1\//.test(String(url)))).toBe(false);
  });

  it("activates only the catch-all after verifying deployed domain, exclusions and isolated DB", async () => {
    const fetchFn = fixture();
    expect(await configureRouting(config, env, fetchFn, true)).toEqual({ applied: true, privateRules: 4 });
    const writes = fetchFn.mock.calls.filter(([, init]) => init?.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toMatch(/\/email\/routing\/rules\/catch_all$/);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
      name: "AXVARA public temp mail", enabled: true, matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [config.name] }],
    });
  });

  it.each([
    { "zones/zone/email/routing": { enabled: true, status: "misconfigured" } },
    { "zones/zone/email/routing/rules": [...privateRules, { ...privateRule, matchers: [{ type: "literal", field: "to", value: "new-private@isturaiky.page" }] }] },
    { "zones/zone/email/routing/rules": privateRules.slice(1) },
    { "zones/zone/email/routing/rules/catch_all": { ...on, actions: [{ type: "forward", value: ["another@example.test"] }] } },
    { [`accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${config.name}/settings`]: { bindings: [] } },
  ])("refuses unsafe/incomplete routing before any write: %j", async overrides => {
    const fetchFn = fixture(overrides);
    await expect(configureRouting(config, env, fetchFn, true)).rejects.toThrow();
    expect(fetchFn.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses using the business email domain or missing private exclusions", async () => {
    const fetchFn = fixture();
    await expect(configureRouting({ ...config, vars: { ...config.vars, MAIL_DOMAIN: "axvara.tech" } }, env, fetchFn, true)).rejects.toThrow();
    await expect(configureRouting({ ...config, vars: { ...config.vars, RESERVED_MAILBOXES: "admin" } }, env, fetchFn, true)).rejects.toThrow();
    await expect(configureRouting({ ...config, d1_databases: [{ ...config.d1_databases[0], database_id: "c21453bf-68ab-4efd-8b0d-22fb360c4f33" }] }, env, fetchFn, true)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails on unreadable or paginated API responses without logging provider data", async () => {
    for (const response of [Response.json({ success: false, errors: [{ message: "never-log-this" }] }),
      Response.json({ success: true, result: [], result_info: { total_count: 201 } }), new Response("private", { status: 503 })]) {
      await expect(configureRouting(config, env, vi.fn(async () => response), true)).rejects.toThrow(/API (incomplete|unavailable)/);
    }
  });

  it("detects a concurrent change to private forwarding after activation", async () => {
    const real = fixture();
    let reads = 0;
    const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/rules?per_page=200") && ++reads === 2) {
        return Response.json({ success: true, result: [
          ...privateRules.slice(1), { ...privateRules[0], enabled: false }, on,
        ] });
      }
      return real(url, init);
    });
    await expect(configureRouting(config, env, fetchFn, true)).rejects.toThrow("Private routing changed");
    expect(fetchFn.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
});
