// tests/pedia-managed-catalog.workerd.test.ts — PSMM-P2/P3 (2026-11-12; revisi review-1).
// Membuktikan parser native HTMLRewriter (workerd) + validasi respons benar di
// runtime Pages/Workers, memakai fixture kecil tersanitasi (bukan katalog live).
import { expect, it } from "vitest";
import { build, } from "esbuild";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";

const FIXTURE = readFileSync("tests/fixtures/pedia-psmm-services.html", "utf8");

async function makeRuntime(script: string, fixture = FIXTURE) {
  return new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-06",
    compatibilityFlags: ["nodejs_compat"],
    script,
    serviceBindings: { FIXTURE: async () => new Response(fixture, { headers: { "content-type": "text/html; charset=UTF-8" } }) },
  });
}

async function bundle(contents: string) {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    plugins: [{ name: "framework-marker", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
      b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
    } }],
  });
  return compiled.outputFiles[0].text;
}

it("native HTMLRewriter parses per-row service IDs and br-delimited description lines", async () => {
  const script = await bundle(`
    import { parseSupplierDescriptions, sanitizeSupplierDescription } from './src/lib/pedia/supplier-descriptions';
    export default { async fetch(req, env) {
      const res = await env.FIXTURE.fetch("https://providersmm.id/services");
      const parsed = await parseSupplierDescriptions(res);
      const out = {};
      for (const [id, entry] of parsed.entries) out[id] = { status: entry.status, sample: entry.text.slice(0, 60) };
      return Response.json({ typeofHR: typeof HTMLRewriter, ids: [...parsed.ids], out,
        sanitized11: sanitizeSupplierDescription(parsed.entries.get(11)?.text || "") });
    }};
  `);
  const mf = await makeRuntime(script);
  try {
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      typeofHR: string; ids: number[]; out: Record<string, { status: string; sample: string }>; sanitized11: string;
    };
    expect(data.typeofHR).toBe("function");
    // Semua baris ber-ID tercatat, termasuk yang deskripsinya kosong.
    expect(data.ids.sort((a, b) => a - b)).toEqual([5, 11, 59, 1068]);
    expect(data.out["59"]).toMatchObject({ status: "empty" });
    expect(data.out["11"]).toMatchObject({ status: "ok", sample: expect.stringContaining("Orderan diatas jam 20:00") });
    expect(data.out["11"].sample.split("\n").length).toBeGreaterThan(1);
    // ID dibaca utuh dari atribut (bukan per potongan teks).
    expect(data.out["1068"]).toMatchObject({ status: "ok" });
    // Contoh URL target dipertahankan; tautan kontak supplier dinetralkan.
    expect(data.sanitized11).toContain("https://www.instagram.com/p/CatGCies_OJ/");
    expect(data.sanitized11).not.toContain("t.me");
  } finally { await mf.dispose(); }
}, 30000);

it("validates row coverage independently of non-empty descriptions (620 rows / 44 empty)", async () => {
  // Bentuk nyata: 620 baris, 44 tanpa deskripsi. Validasi harus lulus walau
  // jumlah deskripsi (576) menyimpang 44 dari 620.
  const rows = Array.from({ length: 620 }, (_, i) => i + 1);
  const empty = new Set(rows.slice(0, 44));
  const html = `<table><tbody>${rows.map((id) => `<tr data-filter-table-category-id="1">
    <td data-filter-table-service-id="${id}">${id}</td>
    <td class="service-name">Instagram Followers</td>
    <td class="service-description-cell"><div class="desc-content" hidden>${empty.has(id) ? "" : `Teks ${id}.<br />Baris dua.`}</div></td>
  </tr>`).join("")}</tbody></table>`;
  const script = await bundle(`
    import { fetchSupplierDescriptions } from './src/lib/pedia/supplier-descriptions';
    export default { async fetch(req, env) {
      const real = globalThis.fetch;
      globalThis.fetch = () => env.FIXTURE.fetch("https://providersmm.id/services");
      const r = await fetchSupplierDescriptions(620);
      return Response.json(r.ok ? { ok: true, rows: r.parsed.ids.size, described: [...r.parsed.entries.values()].filter(e => e.status === "ok").length } : { ok: false, error: r.error });
    }};
  `);
  const mf = await makeRuntime(script, html);
  try {
    expect(await (await mf.dispatchFetch("http://localhost/")).json()).toEqual({ ok: true, rows: 620, described: 576 });
  } finally { await mf.dispose(); }
}, 30000);

it("rejects a duplicate service ID instead of merging rows", async () => {
  const html = `<table><tbody>
    <tr><td data-filter-table-service-id="7">7</td><td><div class="desc-content" hidden>A</div></td></tr>
    <tr><td data-filter-table-service-id="7">7</td><td><div class="desc-content" hidden>B</div></td></tr>
  </tbody></table>`;
  const script = await bundle(`
    import { fetchSupplierDescriptions } from './src/lib/pedia/supplier-descriptions';
    export default { async fetch(req, env) {
      globalThis.fetch = () => env.FIXTURE.fetch("https://providersmm.id/services");
      const r = await fetchSupplierDescriptions(0);
      return Response.json(r.ok ? { ok: true } : { ok: false, error: r.error });
    }};
  `);
  const mf = await makeRuntime(script, html);
  try {
    expect(await (await mf.dispatchFetch("http://localhost/")).json()).toEqual({ ok: false, error: "duplicate_id" });
  } finally { await mf.dispose(); }
}, 30000);

it("fetch validation rejects redirects, non-200, oversize and empty-source payloads", async () => {
  const script = await bundle(`
    import { fetchSupplierDescriptions } from './src/lib/pedia/supplier-descriptions';
    export default { async fetch(req, env) {
      const mode = new URL(req.url).searchParams.get("mode");
      globalThis.fetch = async () => {
        if (mode === "redirect") return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
        if (mode === "http500") return new Response("nope", { status: 500 });
        if (mode === "big") return new Response("x", { status: 200, headers: { "content-length": String(4 * 1024 * 1024) } });
        if (mode === "empty") return new Response("<html><body>tidak ada tabel</body></html>", { status: 200, headers: { "content-type": "text/html" } });
        return env.FIXTURE.fetch("https://providersmm.id/services");
      };
      const r = await fetchSupplierDescriptions(4);
      return Response.json(r.ok ? { ok: true, rows: r.parsed.ids.size } : { ok: false, error: r.error });
    }};
  `);
  const mf = await makeRuntime(script);
  try {
    const read = async (mode: string) => (await mf.dispatchFetch(`http://localhost/?mode=${mode}`)).json();
    expect(await read("redirect")).toEqual({ ok: false, error: "redirect" });
    expect(await read("http500")).toEqual({ ok: false, error: "http" });
    expect(await read("big")).toEqual({ ok: false, error: "too_large" });
    expect(await read("empty")).toEqual({ ok: false, error: "empty" });
    expect(await read("good")).toEqual({ ok: true, rows: 4 });
  } finally { await mf.dispose(); }
}, 30000);
