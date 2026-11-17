import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Miniflare } from "miniflare";

it("synthetic contracts and cancellation primitives execute in native workerd without network", async () => {
  const compiled = ts.transpileModule(readFileSync("mcp-worker/src/synthetic.ts", "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export /gm, ""); // helper module, not Worker entrypoint exports
  // Installed Miniflare supports through 2026-08-06; no newer API is used here.
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", script: `${compiled}
    export default { async fetch() {
      const calls = [];
      const outcomes = await runSyntheticProbes({ AXVARA_API_ORIGIN: "https://fixture.test", AXVARA_CRON_SECRET: "fixture" }, async (url, init) => {
        calls.push(url); init.signal.throwIfAborted();
        if (url.endsWith("/")) return new Response("<title>AXVARA</title>", { headers: { "content-type": "text/html" } });
        if (url.includes("/api/products")) return Response.json({ products: [{ id: 13, slug: "native-fixture", stock: 0 }] });
        if (url.endsWith("/api/checkout/quote") && init.headers.authorization === "Bearer fixture")
          return Response.json({ ok: false, issues: [{ type: "out_of_stock", message: "Habis" }] }, { status: 409 });
        throw new Error("unexpected endpoint");
      });
      return Response.json({ outcomes, calls });
    } };` });
  try {
    const response = await runtime.dispatchFetch("https://fixture.test/run");
    const body = await response.json() as { outcomes: { ok: boolean; status: number }[]; calls: string[] };
    expect(body.outcomes.map(o => o.ok)).toEqual([true, true, true]);
    expect(body.outcomes[2].status).toBe(409);
    expect(body.calls).toHaveLength(3);
    expect(body.calls.some(url => url.includes("/api/orders"))).toBe(false);
  } finally { await runtime.dispose(); }
}, 20000);
