/**
 * scripts/dedupe-postcss.js — Issue #15.
 *
 * Next 15.5.x mem-pin postcss 8.4.31 (exact, bukan range) di dalam paketnya,
 * sehingga npm selalu memasang salinan nested
 * `node_modules/next/node_modules/postcss` yang rentan terhadap 4 advisory
 * (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp,
 * GHSA-r28c-9q8g-f849). `npm audit fix --force` ingin men-downgrade Next ke
 * 9.3.4 (breaking) dan `overrides` tidak mempan karena pin exact + bug
 * arborist npm 11 — jadi pendekatan kompatibel terkecil adalah menghapus
 * salinan nested dan membiarkan `require("postcss")` dari Next jatuh ke
 * salinan root `node_modules/postcss` (8.5.x, sudah aman) via resolusi
 * Node standar. API PostCSS 8.4 ↔ 8.5 kompatibel penuh (minor bump).
 *
 * Berjalan otomatis sebagai `postinstall` — berlaku di dev maupun CI
 * (`npm ci` menjalankan postinstall). Idempoten dan tidak pernah gagal
 * (peringatan saja bila struktur berubah di Next mendatang).
 */
const fs = require("fs");
const path = require("path");

const nested = path.join(__dirname, "..", "node_modules", "next", "node_modules", "postcss");
const rootPkgPath = path.join(__dirname, "..", "node_modules", "postcss", "package.json");

try {
  if (!fs.existsSync(nested)) {
    console.log("[dedupe-postcss] nested postcss sudah tidak ada — OK");
    process.exit(0);
  }
  let rootVersion = "unknown";
  try {
    rootVersion = JSON.parse(fs.readFileSync(rootPkgPath, "utf8")).version;
  } catch {
    console.warn("[dedupe-postcss] root postcss tidak ditemukan, nested dibiarkan");
    process.exit(0);
  }
  // Guard: hanya dedupe bila root sudah versi aman (>= 8.5.23 menutup 4 GHSA).
  const [major, minor, patch] = rootVersion.split(".").map(Number);
  const safe =
    Number.isFinite(major) &&
    (major > 8 || (major === 8 && (minor > 5 || (minor === 5 && patch >= 23))));
  if (!safe) {
    console.warn(`[dedupe-postcss] root postcss ${rootVersion} belum aman — nested dibiarkan`);
    process.exit(0);
  }
  const nestedVersion = JSON.parse(
    fs.readFileSync(path.join(nested, "package.json"), "utf8"),
  ).version;
  fs.rmSync(nested, { recursive: true, force: true });
  console.log(`[dedupe-postcss] hapus nested postcss ${nestedVersion}, Next pakai root ${rootVersion}`);
} catch (err) {
  console.warn(`[dedupe-postcss] lewati: ${err && err.message ? err.message : err}`);
}
