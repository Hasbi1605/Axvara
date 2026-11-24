import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { parseConfigFileTextToJson } from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let mf: Miniflare;

beforeAll(async () => {
  const inner = await build({
    entryPoints: ["2fa/src/worker.mjs"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
  });

  const indexHtml = readFileSync("2fa/public/index.html", "utf8");
  const stylesCss = readFileSync("2fa/public/styles.css", "utf8");

  const compiled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "js",
      contents: `
        import realWorker from "./axvara-2fa-entry.mjs";
        const STATIC = {
          "/": { body: ${JSON.stringify(indexHtml)}, type: "text/html; charset=utf-8" },
          "/index.html": { body: ${JSON.stringify(indexHtml)}, type: "text/html; charset=utf-8" },
          "/styles.css": { body: ${JSON.stringify(stylesCss)}, type: "text/css; charset=utf-8" },
        };
        export default {
          fetch(req, env, ctx) {
            const ASSETS = {
              async fetch(r) {
                const p = new URL(r.url).pathname;
                const hit = STATIC[p] || STATIC["/"];
                return new Response(hit.body, { status: 200, headers: { "content-type": hit.type } });
              },
            };
            return realWorker.fetch(req, { ...env, ASSETS }, ctx);
          },
        };
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    plugins: [
      {
        name: "entry",
        setup(b) {
          b.onResolve({ filter: /axvara-2fa-entry\.mjs$/ }, () => ({ path: "entry", namespace: "entry" }));
          b.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ contents: inner.outputFiles[0].text, loader: "js" }));
        },
      },
    ],
  });

  mf = new Miniflare({
    modules: true,
    compatibilityDate: "2025-09-01",
    script: compiled.outputFiles[0].text,
  });
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe("AXVARA 2FA Worker (workerd runtime & deploy contract)", () => {
  it("serves GET/HEAD /api/time with no-store and strict security headers", async () => {
    const before = Date.now();
    const res = await mf.dispatchFetch("https://2fa.axvara.tech/api/time");
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("style-src 'self'");
    const body = (await res.json()) as { now: number };
    expect(body.now).toBeGreaterThanOrEqual(before - 5000);
    expect(body.now).toBeLessThanOrEqual(after + 5000);

    const head = await mf.dispatchFetch("https://2fa.axvara.tech/api/time", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(Number(head.headers.get("x-axvara-time"))).toBeGreaterThan(0);
  });

  it("enforces method guards and rejects unknown /api/* endpoints", async () => {
    const postTime = await mf.dispatchFetch("https://2fa.axvara.tech/api/time", { method: "POST" });
    expect(postTime.status).toBe(405);

    const unknownApi = await mf.dispatchFetch("https://2fa.axvara.tech/api/secret");
    expect(unknownApi.status).toBe(404);

    const postRoot = await mf.dispatchFetch("https://2fa.axvara.tech/", { method: "POST" });
    expect(postRoot.status).toBe(405);
  });

  it("attaches strict CSP and appropriate Cache-Control to HTML vs static assets", async () => {
    const htmlRes = await mf.dispatchFetch("https://2fa.axvara.tech/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("cache-control")).toBe("no-store");
    expect(htmlRes.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(htmlRes.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await htmlRes.text()).toContain("AXVARA");

    const cssRes = await mf.dispatchFetch("https://2fa.axvara.tech/styles.css");
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(cssRes.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("declares isolated Worker config for 2fa.axvara.tech without D1 and wires CI deploy", () => {
    const parsed = parseConfigFileTextToJson("2fa/wrangler.jsonc", readFileSync("2fa/wrangler.jsonc", "utf8"));
    expect(parsed.error).toBeUndefined();
    const cfg = parsed.config;
    expect(cfg.name).toBe("axvara-2fa");
    expect(cfg.d1_databases).toBeUndefined();
    expect(cfg.assets?.directory).toBe("./public");
    expect(cfg.assets?.run_worker_first).toBe(true);
    expect(cfg.routes).toEqual([{ pattern: "2fa.axvara.tech", custom_domain: true }]);

    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("wrangler deploy --config 2fa/wrangler.jsonc");

    // Static CSP hygiene: no inline style= or inline event handlers in HTML
    const html = readFileSync("2fa/public/index.html", "utf8");
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
