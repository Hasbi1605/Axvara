import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Miniflare } from "miniflare";

it("the actual cache helper works with Cloudflare's Cache API across requests", async () => {
  const source = readFileSync("src/lib/catalog-cache.ts", "utf8")
    .replace('import { getD1 } from "@/lib/db";', "const getD1 = () => true;");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2024-11-01", script: `${compiled}
    let loads = 0;
    export default { async fetch(request) {
      return cachePublicCatalog("workerd-real-cache", 30, async () => Response.json({ loads: ++loads }));
    } };` });
  try {
    const first = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(first.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(await first.json()).toEqual({ loads: 1 });
    const second = await runtime.dispatchFetch("https://axvara.tech/catalog");
    expect(second.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(await second.json()).toEqual({ loads: 1 });
    expect(second.headers.has("X-Axvara-Cache-Stored-At")).toBe(false);
  } finally { await runtime.dispose(); }
}, 20000);
