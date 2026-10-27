# Dependency Audit — 2026-10-27 (OWASP A03:2025)

Scope: dependency/CI remediation prepared by Task A2/Spark in an isolated worktree,
reviewed and integrated into `/Users/macbookair/axvara` by Sol. Spark did not edit
main, commit, push or deploy. Broader application fixes are described in the
[main audit report](../../issue/owasp-audit-2026-10-27.md).

## 1. Raw evidence (before)

Root (`npm audit --omit=dev`, production):
- `zod@4.5.4` — HIGH, GHSA-mrhx-c7xc-m3w5 (memory exhaustion on oversized
  constrained collections, range `<4.6.6`, patched `4.6.6`).

Root full scan additionally flagged dev-only (miniflare toolchain):
- `undici@6.28.1` — HIGH, GHSA-xjj6-f33q-929c + moderate GHSA-4qv8-2p9j-2685.
- `miniflare@3.20250718.3` / `@cloudflare/next-on-pages@1.13.16` — HIGH via
  bundled `zod@3.22.3` node + undici (fixAvailable wants SemVer-major
  `miniflare@4.20260730.0`).

Gateway (full + `--omit=dev` identical — all runtime):
- `fastify@5.12.3` — MODERATE, GHSA-4mh8-r7rc-xpvc (HTTP/2 trailer DoS,
  `<5.12.5`) + LOW GHSA-389g-gv7q-r4x8 (header schema bypass, `>=5.12.2 <5.12.6`).
- `fast-uri@4.1.4` + nested `3.1.7` (via ajv) — MODERATE/LOW batch:
  GHSA-hrr3-gc8f-f4qj, GHSA-jvvf-x445-j334, GHSA-w74x-v6f9-j3xg,
  GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp.
- `music-metadata@11.15.0` (via Baileys `^11.12.3`) — MODERATE,
  GHSA-f94x-6692-553q (MP4 infinite loop) + GHSA-5gfj-9q3v-qfp3 (EBML memory).
- `sharp@0.35.4` (optional via Baileys `*`) — HIGH, GHSA-wq5f-xc86-pv6w
  (librsvg CVE-2026-96889, `<0.35.5`).

Caveat (per brief): scanner version-match is not proof of runtime
reachability; exposure conditions are noted per advisory below.

## 2. Initial runtime fixes (before the toolchain follow-up)

Root `package.json`:
- `zod`: `^4.5.4` → `^4.6.6` (resolves to **4.6.7**).
- `overrides.miniflare.undici`: `6.28.1` → **`6.29.1`** (2026-10-27 Task A2).
- This initial patch deferred the Miniflare major; §2b records the subsequent verified fix.

## 2b. Toolchain major (2026-10-27 Spark follow-up, per PM design approval)

Root `package.json` (user + PM explicitly authorized necessary major + verification):
- `devDependencies.miniflare`: `3.20250718.3` → **`4.20260730.0`**.
- `overrides["@cloudflare/next-on-pages"].miniflare`: **`4.20260730.0`**
  (nop 1.13.16 stays — its dist never imports miniflare at runtime; only a
  `Json` type import in `next-dev`. Pages deploy/runtime artifact unchanged).
- Top-level `overrides.undici`: **`7.30.1`** (MF4 declares undici 7.28.0,
  flagged by 18 advisories `>=7.0.0 <7.30.1`; 7.30.1 engines `node>=20.18.1`,
  CI 22.x stays supported) and `overrides.sharp`: **`0.35.5`**
  (MF4 declares sharp 0.35.2, flagged GHSA-wq5f-xc86-pv6w `<0.35.5` +
  GHSA-rgj7-g3m4-5g8c `<0.35.4`; top-level form required — parent-scoped
  `overrides.miniflare` children silently did NOT apply, verified via
  `npm explain`; redundant parent-scoped key removed).
- Resolved flat tree: miniflare 4.20260730.0, undici 7.30.1, sharp 0.35.5
  (single copies, no nesting), workerd 1.20260730.1, ws 8.21.0,
  youch 4.1.0-beta.10, zod 4.6.7 (only copy — nested zod GONE),
  nop 1.13.16, next 15.5.28.

Results after major (verified live 2026-10-27):
- `npm audit --json` full root: **0 vulns** (exit 0). `npm audit --omit=dev`: **0 vulns**.
- `node scripts/security-dependencies.cjs --root-only`: PASS (exit 0).
- `npx vitest run tests/owasp-supply-chain.test.ts`: 19/19 pass.
- PM integration: `npx tsc --noEmit` passes after explicitly typing the workerd fixture request.
- All workerd/D1 fixtures pass in the integrated full suite. The KlikQRIS local
  fixture now pins supported compatibility date `2026-08-06`; production
  `wrangler` compatibility and adapter are unchanged.
- `npm run build:pages`: PASS (13.97s, 10 prerendered routes, 536 static
  assets, `patch-pages-routes` excludes applied).

Gateway `gateway/package.json`:
- `fastify`: `^5.3.3` → `^5.12.6` (resolves to **5.12.7**).
- Transitives via `npm update` (no manifest edit needed):
  `fast-uri` **4.2.3**, nested `ajv` fast-uri **3.1.9**,
  `music-metadata` **11.16.1**, `sharp` **0.35.5**.

Preserved contracts: `next 15.5.28`, Pages adapter `1.13.x`, Baileys
`7.0.0-rc14`, gateway Node `22.x`, session/runtime behavior untouched.

## 3. Results (after, verified 2026-10-27)

| Scope | `audit --omit=dev` | `audit` full |
|---|---|---|
| Root | **0 vulns** ✅ | **0 vulns** ✅ (after §2b toolchain major) |
| Gateway | **0 vulns** ✅ | **0 vulns** ✅ |

Before §2b: root full was 3 high dev-only (miniflare toolchain). After: zero.

Gate runner: `node scripts/security-dependencies.cjs` → PASS (exit 0),
lockfile hashes unchanged (read-only verified).

## 4. Resolved + residual notes

0. **RESOLVED 2026-10-27 (§2b): Root dev-only `miniflare@3.20250718.3` +
    `@cloudflare/next-on-pages@1.13.16` + nested `zod@3.22.3`** — major-bumped
    to miniflare 4.20260730.0 with nop held at 1.13.16 (no runtime import of
    miniflare in nop dist — verified). Full root audit is now 0 (no
    "cleared"-by-suppression claim: scanner genuinely reports zero).
    Reachability truth for the old flag: GHSA-mrhx fix commit a0ebf97 is
    v4-only (`$ZodArray`/`handleArrayResult` symbols absent from zod 3.22.3 and
    the miniflare bundle); miniflare's `z.array(...)` option schemas were
    unconstrained at sampled call sites, so the CWE family applied in
    principle to dev-loopback emulation input — but no public app route ever
    reached it, and the code is now gone from the tree. Latest stable zod 3.x
    (3.25.76) would still satisfy `<4.6.6`, so no 3.x pin could have cleared it.
1. **Fixture compatibility resolved by PM:** the local KlikQRIS fixture uses
    `2026-08-06`, supported by the pinned workerd. The actual adapter's network,
    redirect rejection and private-signature assertions still run; no skipped
    fixture or changed production compatibility flag.

2. **GHSA-mrhx reachability (root zod)**: prior `4.5.4` was a direct prod dep
   used by API validation routes — reachable in principle on crafted oversized
   payloads; now patched to `4.6.7`. PM flash update 2026-10-27: core main has
   added stream caps, so the unbounded-body precondition for this advisory is
   additionally fixed at the app layer. No exploit observed.
3. **Gateway fastify HTTP/2 trailer DoS**: gateway serves HTTP/1.1 on Heroku;
   trailer path likely unreached, but patched anyway (`5.12.7`).
4. **Gateway music-metadata MP4/EBML**: reached only if Baileys processes
   crafted audio payloads; patched to `11.16.1` within Baileys' `^11.12.3` range.
5. **Gateway sharp/librsvg (CORRECTED per PM flash 2026-10-27)**: sharp IS
   dynamically used via Baileys `extractImageThumb`, so this was NOT a dead
   optional dep — classification corrected from "unreached" to "reachable in
   principle via image-thumbnail path". Patched to `0.35.5` (fixes
   CVE-2026-96889). Residual note: SVG-rendering prerequisites are gated by
   the internal `/send-image` raster-QRIS caller, which narrows but does not
   eliminate the thumbnail attack surface; no exploit observed.

## 5. Dependency files integrated

- `package.json`, `package-lock.json` (root: zod range + undici override)
- `gateway/package.json`, `gateway/package-lock.json` (fastify range + transitives)
- `scripts/security-dependencies.cjs` (NEW — read-only audit gate runner)
- `tests/owasp-supply-chain.test.ts` (19 regression tests, including gate failures)
- `.github/workflows/ci.yml` (NEW step `Dependency audit gate` before build)
- `docs/security/dependency-audit-2026-10-27.md` (this file)
- `CHANGELOG.md` (top entry)

## 6. Verification

- `node scripts/security-dependencies.cjs` → PASS (exit 0), recorded
  2026-10-27: runtime high/critical 0 root+gateway; full audit counts 0 in
  both root and gateway after the verified toolchain upgrade.
- Gate hardened 2026-10-27 per PM review: `parseAuditOutput` rejects
  `{error:E503}`-style registry JSON, malformed JSON, missing
  `metadata.vulnerabilities`, and wrong report versions — nonzero npm exit is
  accepted ONLY for valid advisory reports; exec/stderr sanitized to error
  codes (no raw output, no secret leakage). Runner exposes pure
  `parseAuditOutput`/`classifyHighCritical` + injectable `runGate(execFn)`
  with `require.main===module` guard.
- `npx vitest run tests/owasp-supply-chain.test.ts` → 16/16 pass, fully
  mocked (no live network in unit suite; 177ms).
- `npx tsc --noEmit` → exit 0. Gateway `npm test` 12/12 + `tsc` build pass
  (earlier run). Full root suite + build:pages + Obscura: PM-owned at
  integration (not re-run here per host-contention note).
- No live requests, supplier/paid orders, or credential reads performed.

PM integration verification27Oktober:
- Gate diperketat lagi untuk collections/counts invalid, metadata yang tidak
  cocok dengan findings, serta exit npm di luar0/1; fixture critical mempunyai
  metadata severity yang sesuai.17 test supply-chain deterministik tercakup.
- Seluruh3230test/267file pass; typecheck exit0; gateway12test/build pass;
  build:pages dan MCP dry-run exit0. Gate registry aktual ok:true tanpa runtime
  high/critical atau error; tiga high dev-only tetap didokumentasikan.
- Obscura admin/artikel/Pedia dan HTTP home+CSS200 diperiksa PM, batas lengkap di
  [laporan utama](../../issue/owasp-audit-2026-10-27.md). Publikasi melalui push main,
  tanpa deploy manual atau pemantauan sesudah push.
