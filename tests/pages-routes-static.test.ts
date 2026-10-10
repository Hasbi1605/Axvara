import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchRoutes, STATIC_EXCLUDES } = require("../scripts/patch-pages-routes.js") as {
  patchRoutes: (r: { include?: string[]; exclude?: string[] }) => { include?: string[]; exclude: string[] };
  STATIC_EXCLUDES: string[];
};

// 2026-10-10 (insiden 1102): aset statis publik dilayani CDN, bukan worker.
describe("patch-pages-routes", () => {
  it("menambah pengecualian aset statis tanpa duplikat + mempertahankan bawaan", () => {
    const base = { version: 1, include: ["/*"], exclude: ["/_next/static/*"] };
    const out = patchRoutes(patchRoutes(base));
    expect(out.exclude[0]).toBe("/_next/static/*");
    for (const rule of ["/icons/*", "/brand/*", "/og/*", "/banners/*", "/favicon.svg"]) expect(out.exclude).toContain(rule);
    expect(new Set(out.exclude).size).toBe(out.exclude.length);
  });

  it("tidak pernah mengecualikan route dinamis", () => {
    for (const rule of STATIC_EXCLUDES) expect(rule).not.toMatch(/^\/(api|produk|pesanan|admin|go|r2|wa|artikel|pedia)\b/);
  });

  it("build:pages menjalankan patch setelah next-on-pages + _headers punya aturan aset", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["build:pages"]).toMatch(/next-on-pages && node scripts\/patch-pages-routes\.js/);
    const headers = readFileSync("public/_headers", "utf8");
    for (const p of ["/icons/*", "/brand/*", "/favicon.svg"]) expect(headers).toContain(`\n${p}\n`);
  });
});
