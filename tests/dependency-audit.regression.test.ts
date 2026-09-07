import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const pkg = () => JSON.parse(read("package.json"));
const lockfile = () => read("package-lock.json");

// Issue #15 — dependensi rentan. Audit 2026-09-07 menemukan PostCSS
// transitif via Next (nested node_modules/next/node_modules/postcss 8.4.31,
// advisory GHSA-qx2v-qp2m-jg93 + GHSA-6g55-p6wh-862q + GHSA-fxqj-rqcc-2cmp +
// GHSA-r28c-9q8g-f849). Kriteria: audit terbaru, pembaruan kompatibel
// terkecil, tanpa `npm audit fix --force`, kompatibel Next + adapter
// Cloudflare + build, dan bedakan advisory vs eksploitasi terbukti.
describe("Issue #15 — advisory PostCSS dibedakan dari eksploitasi terbukti", () => {
  it("PostCSS tidak pernah memproses CSS dari pembeli (build-time only)", () => {
    // Seluruh advisory PostCSS mensyaratkan CSS yang dikontrol penyerang
    // masuk ke postcss().process(). Di AXVARA satu-satunya input CSS adalah
    // file statis repo (globals.css + Tailwind), bukan body request.
    const srcFiles = [
      ...listFiles("src/app/api"),
      ...listFiles("src/lib"),
    ].filter((f) => f.endsWith(".ts"));
    for (const f of srcFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/from ["']postcss["']/);
      expect(src, f).not.toMatch(/require\(["']postcss["']\)/);
      expect(src, f).not.toMatch(/\.process\(.*css/i);
    }
    // Upload publik hanya gambar (magic bytes), bukan CSS.
    expect(read("src/app/api/proof/upload/route.ts")).toContain("ALLOWED");
    expect(read("src/app/api/upload/route.ts")).toContain("ALLOWED_TYPES");
  });

  it("Next memanggil PostCSS dengan `from` = path file (jalur GHSA-fxqj tidak kena)", () => {
    // GHSA-fxqj-rqcc-2cmp hanya meledak bila `from` unset. Loader Next
    // selalu menyetel from/to = resourcePath (file CSS repo sendiri).
    const loader = read("node_modules/next/dist/build/webpack/loaders/postcss-loader/src/index.js");
    expect(loader).toContain("from: file");
    expect(loader).toContain("to: file");
  });

  it("pinning kompatibel: Next 15.5.x + dedupe postinstall, bukan Next 16", () => {
    // `npm audit fix --force` ingin memasang next@16.3.4 (breaking).
    // Perbaikan yang benar: Next tetap 15.5.x + script postinstall
    // `scripts/dedupe-postcss.js` menghapus salinan nested 8.4.31 yang
    // dipin exact oleh Next, sehingga require("postcss") dari Next jatuh
    // ke salinan root 8.5.x yang aman — tanpa major bump.
    const p = pkg();
    expect(p.dependencies.next).toMatch(/^15\.5\./);
    expect(p.scripts.postinstall).toContain("dedupe-postcss");
    expect(p.devDependencies.postcss).toMatch(/^\^8\.5\./);
    expect(fs.existsSync(path.join(process.cwd(), "scripts/dedupe-postcss.js"))).toBe(true);
    // Kondisi runtime aktual: tidak ada lagi nested rentan di disk, dan
    // Next me-resolve postcss ke salinan root yang aman.
    const nestedPkg = path.join(process.cwd(), "node_modules/next/node_modules/postcss/package.json");
    expect(fs.existsSync(nestedPkg)).toBe(false);
    const rootVersion: string = JSON.parse(read("node_modules/postcss/package.json")).version;
    expect(rootVersion).toMatch(/^8\.5\.([2-9]\d|\d{2,})/);
    // package-lock diselaraskan agar audit membaca versi aman.
    const lock = JSON.parse(lockfile());
    const nestedLock = lock.packages["node_modules/next/node_modules/postcss"];
    expect(nestedLock && nestedLock.version).toMatch(/^8\.5\./);
  });

  it("sisa advisory dev-only (esbuild/undici/ws/cookie via next-on-pages) tidak menyentuh runtime produksi", () => {
    // Kriteria #15: bedakan advisory dependency dengan eksploitasi
    // aplikasi yang terbukti. Sisa temuan audit penuh semuanya dev-only:
    // - esbuild GHSA-67mh: server dev `serve` + CORS — AXVARA tidak pernah
    //   memakai esbuild serve; produksi = artefak statis Pages.
    // - undici/ws/cookie via miniflare via @cloudflare/next-on-pages:
    //   harness build lokal; runtime produksi = Cloudflare Workers
    //   (bukan undici/ws/miniflare dari node_modules).
    // Tidak ada jalur HTTP produksi yang meneruskan Set-Cookie upstream
    // lewat parseSetCookie undici — cookie sesi ditulis langsung via
    // header Set-Cookie di src/lib/auth.ts.
    const authSrc = read("src/lib/auth.ts");
    expect(authSrc).not.toMatch(/from ["']undici["']/);
    expect(authSrc).not.toMatch(/parseSetCookie|getSetCookies/);
    // next-on-pages tetap devDependency (alat build), bukan dependency.
    const p = pkg();
    expect(p.devDependencies["@cloudflare/next-on-pages"]).toBeTruthy();
    expect(p.dependencies["@cloudflare/next-on-pages"]).toBeUndefined();
  });
});

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}
