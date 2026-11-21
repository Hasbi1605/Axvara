> Lampiran roadmap `issue/2026-11-21-refactor-roadmap.md`. Snapshot baca-saja pada commit ad711d6f (21 Nov 2026); nomor baris bisa bergeser — konfirmasi di source sebelum dipakai.

> **Ralat (review D, 21 Nov):** klaim "40 file test mengimpor `orders/route.ts`" di dokumen ini salah — terukur 27 file mengimpor modul, 39 file membaca path sebagai teks.

# MAP-1 — Refactor map for 5 hotspot files

Task MAP-1 · read-only auditor · workspace `wks_a21b24c4de746811` · cwd `/Users/macbookair/axvara`
Base commit `ad711d6f` (main, working tree clean at start and end; no `src/`, `tests/`, or docs changes made by this task).
Scope reference: `issue/2026-11-21-audit-followups.md:6-13` (items #1, #2, and #5 of the deferred refactor list).

Conventions in this document:
- `file:line` all refer to base `ad711d6f`.
- **[fact]** = verified by reading the source / running the command; **[guess]** = inference not executed.
- "Source-text test" = a test that does `readFileSync("<path>")` and asserts substrings — these break when code moves, even when behavior is identical.

---

## Global constraints that shape every split

1. **Workers bundle + dynamic-import boundary (cron routes).** `tests/cron-lite.integration.test.ts:459-464` asserts `src/app/api/cron/lite/route.ts` has **no static import** matching `/telegram|whatsapp|fulfillment|warung-rebahan|sekalipay|payments/`. Every job body must keep being reached via `await import(...)` inside `POST`. A "job registry with static imports" refactor is not behavior-preserving here — it changes cold-start CPU, which is the documented reason the route exists (`src/app/api/cron/lite/route.ts:1-42`).
2. **`vi.mock` importOriginal contract.** `tests/cron-phase-split.integration.test.ts:47-50` does `vi.mock("@/lib/warung-rebahan/sync", importOriginal)` and spreads `...actual`. Any split of `sync.ts` must keep **all** current exports resolvable from the exact specifier `@/lib/warung-rebahan/sync` (barrel), or that test's spread loses symbols.
3. **Source-text assertions pin paths.** Moving a body out of a hotspot file breaks the tests listed under each target (§5). The roadmap must include *updating the `read()` target path* in the same commit — that is a test-location change, not an assertion weakening.
4. **Retained hard contracts** (do not change in any split): route paths, `Authorization: Bearer <CRON_SECRET>` with `constantTimeEqual`, job/phase names as strings, `more:true` chunking signal, per-invocation statement budgets, `RUN_DEADLINE_MS = 45_000`, D1 write-quota `IS NOT` guards, `bumpCatalogRevision` ≤1×/run and only on change (`docs/agent-rules/platform-ops.md` B-H), VPS proxy call order (`/wr/products-slice`, `/sk/catalog-slice`) matching `/Users/macbookair/axvara-wr-proxy` per `AGENTS.md`.

---

## (a) `src/lib/warung-rebahan/sync.ts` — 1,933 lines, 24 commits/60d

Churn note: 24 commits in 60 days (this task's brief said ~1,930 lines; measured 1,933).

### 1) Structure

| Lines | Section | Symbols |
|---|---|---|
| 1-24 | Header + imports | imports `EACH` from `./client` (`fetchJaspayProducts`, `fetchProducts`, `fetchProductsSlice`, `isWrSyncEnabled`), `./delivery-class`, `./new-sales`, `@/lib/sync-status`, `@/lib/db-access` |
| 26-66 | Public types + tunables | `SyncResult` (26-41), `COST_PER_WR_PRODUCT_SYNC=3` (44), `COST_PER_WR_VARIANT_SYNC=2` (45), `COST_WR_EXCLUSION_FETCH=1` (46), `WR_SYNC_PRODUCTS_PER_RUN=48` (50), `WR_SYNC_CATALOG_BUDGET_EXTRA=800` (55), `WR_SYNC_MIN_PRODUCTS_GUARD=1` (58), `WR_SYNC_CHECKPOINT_EVERY=8` (66) |
| 68-161 | Write infrastructure | `Row` (68), `SqlWrite` (85-98, incl. `optional`/`catalogDisplay`/`preMigrationFallback`), `runWrites()` (114-147; `d1.batch()` per product, sequential fallback), `placeholders()` (150), `PREFETCH_PARAM_CHUNK=50` (155), `chunked()` (157) |
| 163-176 | Env defaults (read per call) | `defaultMarkupPercent` (`WARUNG_REBAHAN_DEFAULT_MARKUP_PERCENT`), `defaultMarkupFixed` (`..._FIXED`), `defaultCategoryId` (`..._CATEGORY_ID`) |
| 178-330 | Pure mapping (no DB) | `calculateSellPrice` (182), `generateProductSlug` (191), `parseWrDuration` (203), `parseWrWarranty` (224), `mapWrCategory` (259), `isExcluded` (292, DB-backed but small) |
| 331-527 | Product planners/upserts | `planLinkedProductWrites` (331), `upsertWrProduct` (365-470), `createAxvaraCatalogForWr` (485-526, slug anti-collision `-wr`) |
| 528-712 | Variant planners | `VariantOutcome` (528), `planExistingVariantWrites` (535-683; delivery_mode→class + `preMigrationFallback` for 0060; compare_price neutrality 626-640), `upsertWrVariant` (685-705) |
| 713-841 | New variant (sequential; needs `lastInsertRowid`) | `insertNewVariant` (713-841; deterministic SKU 727-733) |
| 843-900 | Parent aggregate | `planParentAggregateWrite` (851-881), `refreshParentAggregates` (884-891) |
| 893-975 | Prefetch | `prefetchVariantRows` (902-926), `prefetchProductRows` (937-966) |
| 968-1011 | Destructive-guard zeroing | `zeroMissingVariants` (976-1011; never touches `jaspay:%`) |
| 1013-1064 | Sync state + response validation | `readSyncState` (1014), `writeSyncState` (1032), `validateCatalogResponse` (1054) |
| 1066-1425 | **Main sweep** | `SyncOptions` (1066-1113: `maxProducts`, `allowZeroMissing`, `trigger`, `timeBudgetMs`, `useProxySlices`, `applyOnly`), `syncProducts` (1114-1425) |
| 1427-1506 | Tail helpers | `zeroVariantsByIds` (1434-1468, chunked ≤50, jaspay-filtered), `refreshAllParentAggregates` (1471-1481), `logSync` (1483-1506 → `wr_sync_log`) |
| 1508-1933 | **Jaspay (WR3) — independent engine** | banner comment 1508-1520, `JaspaySyncResult` (1521), `jaspaySku` (1532), `upsertJaspayProduct` (1538), `syncJaspayCatalog` (1568-1933) |

Internal stages of `syncProducts` (1114-1425) — this is what "pecah per tahap sync" means:
- 1119-1157 setup: `db`, `trigger`, `applyOnly`, `maxProducts` clamp ≤48, time budget, `raiseCeilingForCatalogSync(800)` (1157-1158 **[fact]** duck-typed hook: `src/lib/db-access.ts:86-90`)
- 1159-1178 fetch: `useProxySlices` → `fetchProductsSlice(cursor, maxProducts, timeLeft)` else `fetchFn()`; error → `logSync(failed)`
- 1179-1198 validate + generation + exclusion cache (1 query)
- 1200-1218 ordering/cursor + prefetch (variant rows, product rows)
- 1220-1324 per-product loop: budget admission `canSpend(cost+4)` (1235), **time admission** measured per product (1243-1249), exclusion, hot path `planLinkedProductWrites`, variant plan/insert, parent aggregate, `runWrites` batch, checkpoint every 8 (1320-1323)
- 1325-1364 `applyOnly` (diff from VPS) early-return branch: `zeroVariantsByIds`, `diff_last_at`, `diff_last_change*` (no `*_sync_log` — deliberate, 1342-1345)
- 1365-1425 sweep completion: `fullSweepInThisRun` guard (1372), cursor/generation/snapshot markers, zero-missing + `refreshAllParentAggregates`, `logSync`, `bumpCatalogRevision("market")`

### 2) Inputs / outputs / shared mutable state

- **In:** `DatabaseAccess` (optionally absent → `createDatabaseAccess()`), `fetchFn`, `SyncOptions`. Proxy network via `./client` only (`POST /wr/products-slice`, `GET /wr/jaspay/products` through `wrFetch`).
- **Out (D1 writes):** `wr_products`, `products` (description only), `product_variants`, `wr_variants`, `wr_sync_state` (`products_cursor`, `products_generation`, `products_snapshot_complete`, `products_progress_at`, `products_full_sweep_at`, `diff_last_*`), `wr_sync_log`, plus `store_settings` via `@/lib/sync-status` (`jaspay_catalog_*`).
- **Reads:** `wr_exclusions` (1×/run, cached), `wr_products`/`products`/`wr_variants` (prefetch), `wr_sync_state`.
- **Shared mutable state:** no module-level `let` (verified `grep '^let |^var '` → none). State is all in D1 + the `DatabaseAccess` budget counter. The budget ceiling is **mutated in place** (`raiseCeilingForCatalogSync`, +800) — a split must pass the *same access object* through, not re-wrap it.
- **Within-run locals that cross stages:** `seenVariantIds`, `cachedRules`, `cursor`, `processedInRun`, `metaChanged`, `slice`. These are the natural seams: they must be threaded via an explicit state object if stages become separate modules.
- **Env:** only 3 `WARUNG_REBAHAN_DEFAULT_*`; `WARUNG_REBAHAN_ENABLED`/`..._SYNC_ENABLED` are read inside `./client` (`isWrSyncEnabled`).

### 3) External contracts that MUST NOT change

- Exported names and the specifier `@/lib/warung-rebahan/sync` (constraint #2 above). External importers **[fact]**: `src/app/api/admin/warung/markup/route.ts:14` + `.../markup/bulk/route.ts:17` (`calculateSellPrice`), `src/app/api/admin/warung/sync/route.ts:21`, `src/app/api/supplier-sync/route.ts:114`, `src/app/api/cron/lite/route.ts:243`, `src/app/api/cron/operations/route.ts:961,1086`; ~20 test files (list under §5).
- `SyncResult` / `JaspaySyncResult` **field names** — the admin route derives `status` from `result.errors`, `result.budgetYielded`, `result.synced` (`src/app/api/admin/warung/sync/route.ts:22-30`) and is locked by `tests/warung-rebahan/sync-honesty.regression.test.ts:47-105` (whole-module mock with that exact shape).
- `syncProducts` option semantics: `applyOnly` (diff path, `src/app/api/supplier-sync/route.ts:114-117`), `timeBudgetMs` (cron passes `deadline − TIME_WR_SWEEP_RESERVE`), `maxProducts` chunk (10 for phased cron, 48 default), `useProxySlices` (must stay `POST /wr/products-slice` with same params — `AGENTS.md` lintas-repo rule).
- `raiseCeilingForCatalogSync` structural hook (duck-typed; adding a nominal type would break `src/lib/db-access.ts:86-90` and `tests/warung-rebahan/sync.test.ts:472-500` "Opsi A 48 produk tuntas SATU sweep").
- Write-quota guards: every `UPDATE` keeps `IS NOT` predicates (§16.6 ARCHITECTURE; locked by `sync-write-quota.regression.test.ts`). Removing an `optional`/`preMigrationFallback` changes failure semantics.
- `bumpCatalogRevision("market")` call sites (1360, 1421, 1882, 1928) keep the "only when changed" conditions.
- Source-text negatives that constrain what may live in this file: must **not** contain `min_qty` (`tests/variant-min-qty.test.ts:63-64`), must **not** contain `manual_cost` (`tests/dashboard-profit-week.test.ts:106`), must **not** match `admin_terms|admin_activation|admin_copy_fingerprint` (`tests/variant-admin-copy.integration.test.ts:311`), and every `UPDATE products SET <cols>` must not include `name` (`tests/supplier-badge.test.ts:52-60` — regex scans this file only).

### 4) Callers

`axgraph affected "src/lib/warung-rebahan/sync.ts::syncProducts()" --depth 1` and `::syncJaspayCatalog()`:
- **runtime:** `cron/operations` (961 `syncProducts`, 1086 `syncJaspayCatalog`), `cron/lite` (243 `syncJaspayCatalog`), `admin/warung/sync` (Force Sync), `supplier-sync` (diff); `admin/warung/markup[/bulk]` (pure `calculateSellPrice`).
- **tests (direct imports):** `sync.test.ts`, `sync-honesty`, `sync-roundtrip`, `sync-time-budget`, `sync-write-quota`, `warung-rebahan/{hardening,ownership,incident-20261010,jaspay,jaspay-automatic-sales,jaspay-review-fixes,wr-migrations}`, `product-archive-sync`, `catalog-proxy-slice`, `catalog-cache-invalidation`, `supplier-diff-status`, `p1-cache-cron-regression`, `variant-admin-copy.integration`, `d1-limits-and-trigger-upsert` (`zeroVariantsByIds`), `markup-bulk`, `jaspay-catalog.workerd`.
- `axgraph affected ::upsertWrVariant()` → only `sync.test.ts`; `::zeroMissingVariants()` → `syncProducts` (1402) + `jaspay.regression.test.ts`. **[fact]** `refreshParentAggregates`, `readSyncState`, `validateCatalogResponse`, `COST_WR_EXCLUSION_FETCH`, `WR_SYNC_MIN_PRODUCTS_GUARD`, `COST_PER_WR_PRODUCT_SYNC`, `WR_SYNC_CATALOG_BUDGET_EXTRA`, `upsertWrVariant`, `mapWrCategory`, `parseWrDuration`, `parseWrWarranty`, `generateProductSlug` have **0** external users except `sync.test.ts` + `calculateSellPrice` (2 admin routes + 2 tests). That means these can be moved freely (re-exported via barrel) with only intra-test imports to keep.

### 5) Test coverage per section

| Section | Test file:describe |
|---|---|
| pricing/parsing/slug/category | `tests/warung-rebahan/sync.test.ts:41` "Warung Rebahan pricing & parsing" |
| new product / exclusion / idempotent / compare_price / zero-missing / SKU collision / registry reset | `sync.test.ts:83` "Warung Rebahan product sync" (16 `it`) |
| resumable cursor + checkpoint | `sync.test.ts:540` "sync resumable (anti-gap-tanpa-jejak)" |
| batch vs sequential parity | `sync-roundtrip.regression.test.ts:70` |
| time budget + snapshot-complete marker | `sync-time-budget.regression.test.ts:75` |
| write quota / `IS NOT` guards | `sync-write-quota.regression.test.ts:62` |
| admin status honesty | `sync-honesty.regression.test.ts:47` |
| proxy slice mode | `catalog-proxy-slice.regression.test.ts` |
| diff/`applyOnly` + `diff_last_at` gating | `supplier-diff-status.regression.test.ts`, `catalog-cache-invalidation.test.ts` |
| Jaspay rotation, 40-statement budget, cap fail-closed, migration 0121 | `jaspay-catalog.workerd.test.ts` (native D1/Miniflare), `jaspay.regression`, `jaspay-automatic-sales`, `jaspay-review-fixes`, `p1-cache-cron-regression.test.ts:344` |
| ownership fields (`admin_*` untouched) | `warung-rebahan/ownership.regression.test.ts` |
| `zeroVariantsByIds` chunk + jaspay filter | `d1-limits-and-trigger-upsert.test.ts`, `jaspay.regression.test.ts` |

**Gaps that should get a characterization test BEFORE splitting** (fail=red, pass=green pin):
1. `applyOnly` diff path × `maxProducts`/`timeBudgetMs` interaction — today only `supplier-diff-status` covers diff state markers, not the loop's admission behavior under a tight budget.
2. `prefetchVariantRows/prefetchProductRows` chunking above 50 ids — no test crosses `PREFETCH_PARAM_CHUNK` (all fixtures are small). Splitting this module makes the chunk boundary a real module boundary; pin it.
3. `runWrites` batch-fail → sequential fallback preserving `optional` tolerance — `sync-roundtrip:93` covers "one product fails doesn't cancel others", but **not** the batch-rejects-then-retry path (the `catch` at 121-123). [guess: exercised only incidentally]
4. `refreshAllParentAggregates` — **no test at all** (0 external refs, called once at 1409).
5. Jaspay `jaspay_sku_identity_conflict` and the pre-0091 fail-closed branch (1688-1697) — covered? `jaspay-review-fixes` mentions fixes; verify before moving.
6. `bumpCatalogRevision` "only when changed" is asserted for SK/`catalog-cache-invalidation`, but for WR sweep the condition (`newProducts||newVariants||stockChanges||priceChanges||metaChanged`) has no direct test. Pin it (spy on `bumpCatalogRevision`).

### 6) Proposed split

Target layout (new folder, barrel keeps the old specifier):

```
src/lib/warung-rebahan/sync/
  index.ts        # re-export * exactly the current surface (barrel; keeps vi.mock+importOriginal)
  types.ts        # SyncResult, JaspaySyncResult, VariantOutcome, SyncOptions, SqlWrite, Row
  constants.ts    # COST_*, WR_SYNC_*, PREFETCH_PARAM_CHUNK
  writes.ts       # runWrites, placeholders, chunked
  pricing.ts      # calculateSellPrice, defaultMarkup*, generateProductSlug, parseWrDuration, parseWrWarranty, mapWrCategory
  exclusion.ts    # isExcluded
  product.ts      # planLinkedProductWrites, upsertWrProduct, createAxvaraCatalogForWr
  variant.ts      # planExistingVariantWrites, upsertWrVariant, insertNewVariant, planParentAggregateWrite, refreshParentAggregates
  prefetch.ts     # prefetchVariantRows, prefetchProductRows
  state.ts        # readSyncState, writeSyncState, validateCatalogResponse, logSync
  sweep.ts        # syncProducts (+ thin stage helpers runFetchStage/runProductLoop/runFinalize)
  zeroing.ts      # zeroMissingVariants, zeroVariantsByIds, refreshAllParentAggregates
  jaspay-catalog.ts # jaspaySku, upsertJaspayProduct, syncJaspayCatalog   (NOT jaspay.ts — taken)
src/lib/warung-rebahan/sync.ts  # becomes `export * from "./sync/index"` (one line) — path & specifier preserved
```

What goes where: pure mapping → `pricing.ts` (zero imports of DB, this unlocks real wins for `admin/markup*` if they later import the leaf); planners → `product.ts`/`variant.ts` (depend on `pricing`, `types`, `writes`); `sweep.ts` depends on all of the above (one-directional, no cycles).

**Commit ordering (one module per commit, each green on the focused suite):**
1. `types.ts` + `constants.ts` + `writes.ts` + barrel; `sync.ts` → re-export. Run `sync.test.ts`, `sync-roundtrip`, `sync-honesty`.
2. `pricing.ts` + `exclusion.ts`; update `admin/warung/markup*` to import the leaf (optional, same commit) — run `sync.test.ts:41`, `markup-bulk`, `wr-migrations`.
3. `product.ts`; run `sync.test.ts:83`, `ownership`.
4. `variant.ts`; run `sync.test.ts:83,540`, `sync-write-quota`.
5. `prefetch.ts` + `state.ts` + `zeroing.ts`; run `sync-roundtrip`, `sync-time-budget`, `d1-limits-and-trigger-upsert`.
6. `sweep.ts` (the 1,067-line function becomes 3 stage functions); run full `tests/warung-rebahan/**` + `catalog-proxy-slice` + `supplier-diff-status` + `p1-cache-cron`.
7. `jaspay-catalog.ts` last (independent engine, its own workerd test); run `jaspay*` + `jaspay-catalog.workerd`.

**Specific risks**
- **Circular import** if `pricing.ts` ever needs `types.ts` from a module that imports `pricing`; keep `types`/`constants` leaf-only.
- **Barrel cost:** `sync.ts` as `export *` keeps *every* submodule loaded whenever any symbol is imported. Today that is already one 1,933-line module, so bundle/CPU is neutral — but do **not** "optimize" by making the barrel lazy; `vi.mock(importOriginal)` and `admin/warung/markup` static import rely on eager resolution.
- **`raiseCeilingForCatalogSync` type-cast** at 1157 must move verbatim (it is cast through `unknown`).
- **Source-text negatives** (`min_qty`, `manual_cost`, `admin_terms`, `UPDATE products SET` w/o `name`): after the split those strings live in other files and the assertions silently stop guarding them. Update those tests to read the new files (`variant.ts`, `product.ts`) in the same commit — otherwise we weaken the safety net.
- **`jaspay-catalog.workerd.test.ts` bundles `./src/lib/warung-rebahan/sync` with esbuild** (line 8-9). A barrel that pulls 12 modules into the bundle is fine, but any new `node:`-only import in a submodule would break that workerd bundle.

### 7) Effort / writer

**L** (1,933 lines, 7 new modules, 20+ dependent tests, workerd bundling). Writer: **strong implementer with WR/vendor-API context** (Sol-tier), not a mechanical split — the stage seams (`cursor`, `seenVariantIds`, budget ceiling) are semantic, and `sync-time-budget`/`sync-write-quota` will catch subtle drift.

---

## (b) `src/app/api/cron/operations/route.ts` — 1,532 lines, 37 commits/60d

### 1) Structure

| Lines | Section | Symbols |
|---|---|---|
| 1-25 | Imports | 17 static: `@/lib/cron-queues` (`operationQueueProbeSql`), `payments/stale-initializing`, `fulfillment/units`, `next/server`, `@/lib/db`, `@/lib/db-access`, `@/lib/expiry`, **entire** `@/lib/fulfillment/deliver` (6 symbols), `@/lib/telegram/api`, `@/lib/telegram/messages`, `payments/qris-expiry-notifications`, `telegram/order-notifications` (3), `telegram/invoice-retry`, `@/lib/security`, `whatsapp/outbox` |
| 27-126 | Constants + phase machinery | `QUERY_BUDGET=300` (31), `RUN_DEADLINE_MS=45_000` (40), `TIME_*` (44-63), `EXPIRY_PER_RUN=30` (64), `FULFILLMENT_PER_RUN=20` (65), `WA_OUTBOX_PER_RUN=4` (66), `COST_*` (68-74), `RESERVE_TAIL=2` (75), `CATALOG_SYNC_INTERVAL_MS=14m` (85), `DIFF_FRESH_MS=10m` (91), `BACKUP_SWEEP_INTERVAL_MS=60m` (92), `WR_CRON_CHUNK=10`/`SK_CRON_CHUNK=25` (124-125), `CronPhase` (126) |
| 94-136 | Sweep gate + cost | `catalogSweepDue()` (98-118), `expiryCost()` (130-135) |
| 137-187 | Phase persistence | `readCronPhase` (137), `phaseName` (155), `nextPhase` (160), `writeCronPhase` (172) |
| 188-1532 | **POST** (one function, nested closures) | see below |

`POST` (188-1532) inner sections:
- 189-196 auth; 198-222 `?phase=`/`?part=`/`continue=1` parsing + 400s; 224-237 `runStartedAt`, `step` logger, `timeLeftMs`, `hasTime`; 239-282 the `results` skeleton (≈40 fixed keys — a **contract**)
- 284-320 budget `createBudgetedDatabase(300, 2)`, poison-pill advance-before-work (298-308), `cron_last_hit_at` heartbeat (315-320)
- 322-372 stale-sync watchdog (WR); 374-447 queue probes (`operationQueueProbeSql`, WR due/delivery/blocked, SK due/blocked) and derived `pending*` counters
- 449-561 ordering/anti-starvation: `ordered`, `activePhases` (max 3), fulfillment slot guarantee (473-485), WR sync guarantee + front-of-queue reorder (486-533), SK guarantee (535-561)
- phase closures: `runExpiry` 565-768, `runNotify` 769-867, `runFulfillment` 868-923, `runWarungRebahan` 924-1274, `runCleanup` 1275-1292, `runSekalipay` 1293-1482
- 1483-1498 executor loop + deadline defer; 1500-1520 tail (`budget.beginTail()`, `cron_last_ok_at` vs `writeCronPhase`, `query_budget_used`, `run_duration_ms`, `deferred`); 1522-1525 catch → 500 `partial_failure`; 1527-1531 response with `note:"partial_run_more_pending"` when `deferred` non-empty

### 2) Inputs / outputs / shared mutable state

- **In:** `NextRequest` (query `phase`, `part`, `continue`); env `CRON_SECRET`, `AUTO_FULFILLMENT_ENABLED`, `WARUNG_REBAHAN_{SYNC,AUTO_ORDER}_ENABLED`, `SEKALIPAY_{ENABLED,SYNC_ENABLED,AUTO_ORDER_ENABLED}`.
- **Out:** mutates almost every operational table (orders/payment_transactions/fulfillment_jobs/_items/wr_order_links/wr_sync_state/wr_sync_log/sk_*/whatsapp_outbox/store_settings); network: Telegram sendMessage, telegram retry/reminders/invoices, QRIS expiry notices, WA outbox, supplier sync + saldo, `decideAllWinners`.
- **Shared mutable state (verified capture analysis, [fact]):** every phase closure mutates `results`, `deferredOut` (array), reads `activePhases` (Set) and `budget`. Closure capture counts per phase:

| phase | lines | # captured outer bindings | notable |
|---|---|---|---|
| `runExpiry` | 565-768 | 13 | `expiryCost`, `hasTime`, `pendingExpiry*` |
| `runNotify` | 769-867 | 21 | `FULFILLMENT_PER_RUN`, `WA_OUTBOX_PER_RUN`, `COST_PER_WA_*`, 7 `pending*` |
| `runFulfillment` | 868-923 | 15 | `COST_PER_{JOB_FRAME,DELIVERY_ITEM,ORPHAN_LIGHT,STALE_RELEASE}` |
| `runWarungRebahan` | 924-1274 | 20 | `catalogSweepDue`, `execRun`, `step`, `timeLeftMs`, `forcedPhase`, `syncOnly`, `ordersOnly`, `WR_CRON_CHUNK` |
| `runCleanup` | 1275-1292 | 9 | `pending{Jobs,Notify,ExpiryAny}`, `waWorkPending` |
| `runSekalipay` | 1293-1482 | 21 | same shape as WR + `SK_CRON_CHUNK`, `pendingSk*` |

That table *is* the refactor problem: bodies cannot move to another module without an explicit `OperationsContext` carrying `{ budget, database, results, deferredOut, activePhases, hasTime, timeLeftMs, step, counts, flags }`.

### 3) External contracts that MUST NOT change

- `POST /api/cron/operations`; `?phase=expiry|fulfillment|warung_rebahan|sekalipay|notify|cleanup` (400 `invalid_phase`), `?part=orders|sync` only for WR/SK (400 `invalid_part`), `&continue=1` (sync continuation). Worker calls exactly these (`mcp-worker/src/cron.ts:165-171`, `CRON_STEPS` 100-107).
- `constantTimeEqual` + fail-closed `!cronSecret ||` (`tests/audit-2026-09-20.regression.test.ts:99-120` reads this file as text).
- Response JSON keys + `more:true` (worker only reads `more` — `mcp-worker/src/cron.ts:188-189`). Asserted keys: `query_budget_used` (`cron-budget.integration.test.ts:128`, `rr5-remediation:178,230`), `wr_products_synced`/`wr_sync_skipped` values (`warung-rebahan/cron.test.ts:53,116,179`; `cron-deadline-poison:131-217`; `cron-phase-split:145,195,226`), `fulfillment_orphans_healed`, `telegram_pending_reminders_sent`, `repaired_legacy_expiry`/`legacy_expiry_repair`, `sk_sync_skipped`.
- Phase rotation in `store_settings` (`cron_phase`, `cron_deferred`), poison-pill ordering (advance at 298-308 **before** heavy work), `cron_last_hit_at` every run, `cron_last_ok_at` only when `forcedPhase` completes (1504-1511).
- `catalogSweepDue` 14m/60m + `products_cursor` resume signal, and the deadline pass-through shape `timeBudgetMs: Math.max(0, timeLeftMs() - TIME_WR_SWEEP_RESERVE)` — both **asserted as source text** in `tests/warung-rebahan/sync-time-budget.regression.test.ts:167-200` against this exact path.
- **Source-text assertions against this file** (moving code breaks them → must retarget):
  - `tests/traffic-query.regression.test.ts:86-90` `const EXPIRY_PER_RUN = 30`, not `BATCH_LIMIT * 4`; `:117` `JOIN orders o ON o.code=pt.order_code`
  - `tests/payment-expiry.regression.test.ts:54-57,87-91` `isExpiredIso`, `transitionPendingPaymentOrder`, no `expires_at < datetime('now')`, `repaired_legacy_expiry`, `legacy_expiry_repair`, `o.status IN ('kadaluarsa','dibatalkan')`
  - `tests/fulfillment-outbox.regression.test.ts:59-70` `fulfillment_orphans_healed`, `reconcileOrphanLight(String(orphan.code), database)`, `COST_PER_ORPHAN_LIGHT`, heal-before-`getDueJobs`
  - `tests/fulfillment-per-item.regression.test.ts:142` `processJobItems(Number(job.id)`
  - `tests/monitoring-health.regression.test.ts:124-129` `processDueWhatsAppOutbox`, `whatsapp_outbox_sent`
  - `tests/telegram-bot.regression.test.ts:949-950` `sendPendingOrderReminders`, `telegram_pending_reminders_sent`
  - `tests/migration-and-atomicity.regression.test.ts:412-420` `transitionPendingPaymentOrder`, **not** `checkStatus`
  - `tests/whatsapp-admin-notifications.integration.test.ts:198-200` `sales_channel IN ('telegram','whatsapp')` (concatenated with `cron-queues.ts`, so it may live in either)
  - `tests/games-admin-report.integration.test.ts:183-187` regex for the exact bounded orphan SQL (`SELECT o.code FROM orders o LEFT JOIN fulfillment_jobs fj … ORDER BY o.created_at ASC LIMIT ?`)
  - `tests/audit-2026-09-20.regression.test.ts:114` `!cronSecret ||`
  - `tests/warung-rebahan/sync-time-budget.regression.test.ts:167-200` (see above)
- `vi.mock("@/lib/warung-rebahan/sync")` from `cron-phase-split:47` must stay effective → WR phase must keep `await import("@/lib/warung-rebahan/sync")` at that specifier (961). Same for `@/lib/sekalipay/sync` (1322).

### 4) Callers

`axgraph affected "…/cron/operations/route.ts::POST()" --depth 1` → **no code callers** (HTTP-only). Real caller: `mcp-worker/src/cron.ts` heavy group (`CRON_STEPS:100-107`) called once/hour (`isHeavyTick`, `HEAVY_EVERY_MINUTES=60`). Test callers import `POST` directly in ~15 files (list §5).

### 5) Test coverage per section

| Phase | Test file:describe |
|---|---|
| phase split / part / continue / worker tick | `cron-phase-split.integration.test.ts:83` "route ?phase=", `:267` "Worker runOperationsTick" |
| expiry | `payment-expiry.regression.test.ts`, `cron-budget.integration.test.ts:61`, `klikqris.integration.test.ts`, `fx1-cron-recovery.integration.test.ts` |
| fulfillment | `fulfillment-outbox.regression.test.ts:52`, `fulfillment-per-item.regression.test.ts:138`, `unique-units.integration.test.ts`, `product-archive.integration.test.ts` |
| WR phase (sync + orders + reconcile + saldo) | `warung-rebahan/cron.test.ts:46,146`, `warung-rebahan/sync-time-budget.regression.test.ts:170,188` (text), `cron-deadline-poison.integration.test.ts` (skip observability, anti-starvation, watchdog, poison-pill, deadline) |
| SK phase | `sekalipay/sk-claimed-recovery`, `sekalipay/sk-queue-budget`, `rr4-cron-scale`, `rr5-remediation` |
| notify | `rr3-cron-queue.integration.test.ts`, `rr3-invoice-retry.integration.test.ts`, `telegram-bot.regression.test.ts`, `web-paid-admin-notif.integration.test.ts`, `whatsapp-admin-notifications.integration.test.ts`, `telegram-promo-broadcast.test.ts:267` |
| cleanup | `warung-rebahan/cron.test.ts`, `rr4/rr5` |
| budget/tail | `cron-budget.integration.test.ts:77,89,131,163`, `rr5-remediation:178,230` |

**Gaps (add characterization before splitting):**
1. `budget.beginTail()` / 2 reserved statements — no test asserts the tail always gets its 2 writes when phases exhaust the budget (`rr5` approximates).
2. `runCleanup` gating matrix (`fulfilOrNotifyWaiting` + `COST_PER_CLEANUP=10`) — partially in `rr4-cron-scale`; pin the "deferred cleanup is normal" branch.
3. `runNotify` QRIS-expiry branch (`noticeCount`, pre-check `budget.fits(5)` + `TIME_TELEGRAM_BATCH`) — no direct test.
4. `part=sync` → `decideAllWinners` only when `more !== true` (1410-1419) — only `cron-phase-split:220` touches part semantics.
5. Watchdog context-refresh (1228-1237) vs front watchdog (322-372) interplay — `cron-deadline-poison:319-350` covers partly.
6. Whole-request golden: for a fixed fixture, snapshot the **full** `results` object (all ~40 keys) per phase. Cheapest way to guarantee a behavior-preserving split of a 1,344-line handler.

### 6) Proposed split

```
src/app/api/cron/operations/route.ts     # POST: auth, parse, build ctx, run phases in `ordered`, tail, response
src/lib/cron/operations-context.ts       # createOperationsContext(): { budget, database, results, deferredOut, activePhases, hasTime, timeLeftMs, step, counts, flags } + result skeleton
src/lib/cron/phase-state.ts              # CronPhase, phaseName, nextPhase, readCronPhase, writeCronPhase, poison-pill helpers, heartbeat
src/lib/cron/queue-probes.ts             # WR/SK due/delivery/blocked probes + pending* derivation  (extend existing src/lib/cron-queues.ts? that file holds SQL only — keep separate)
src/lib/cron/scheduling.ts               # ordering, 3-slot selection, fulfillment/WR/SK anti-starvation guarantees (pure over counts + ordered[])
src/lib/cron/catalog-sweep.ts            # catalogSweepDue, CATALOG_SYNC_INTERVAL_MS, DIFF_FRESH_MS, BACKUP_SWEEP_INTERVAL_MS
src/lib/cron/phases/{expiry,notify,fulfillment,warung-rebahan,sekalipay,cleanup}.ts   # export async function run(ctx)
```

What moves where: the six closures keep their bodies **verbatim** but take `ctx` instead of capturing; `deferredOut.push(...)`/`results.X=` become `ctx.deferred(...)`/`ctx.result(...)` to keep one writer. The route keeps: auth, query parsing, `results` skeleton import (to preserve key order in JSON), executor loop, tail, error handling.

**Commit ordering:**
1. `phase-state.ts` + `catalog-sweep.ts` (pure-ish, no closure); retarget `sync-time-budget` text test.
2. `operations-context.ts` (no behavior change; route builds ctx but phases still inline).
3. `scheduling.ts` (ordering/anti-starvation) — `cron-deadline-poison:71-108` + `warung-rebahan/cron:146`.
4. One commit per phase, smallest first: `cleanup` → `fulfillment` → `notify` → `expiry` → `warung_rebahan` → `sekalipay`. Each: move body, retarget its source-text assertions, run its focused suite.
5. Final: route.ts shrinks to ~250 lines; run `cron-*`, `rr3/rr4/rr5`, `warung-rebahan/**`, `sekalipay/**`, `payment-expiry`, `fulfillment-*`, `telegram-*`, `whatsapp-*`.

**Specific risks**
- **Source-text tests** (§3) are the #1 blocker: 8 test files read this path. Retarget each `read()` in the *same* commit that moves the string, and assert the new file. Do not delete assertions.
- **Statement budget is per-invocation, shared across phases.** Any "small helper refactor" that adds a query (even a `SELECT 1`) changes admission for downstream phases. Rule: no new statements; helpers must be pure.
- **Deadline semantics**: `hasTime` is wall-clock from `runStartedAt`; a helper module must not compute its own start time.
- **`deferredOut` is an array with `.includes()` dedupe**; converting to a `Set` changes response order → worker doesn't care, tests might (`cron-phase-split:116,129` compare arrays). Keep insertion semantics.
- **Circular import** `phases/warung-rebahan` ↔ `catalog-sweep` is fine one-way; but `operations-context` must not import a phase.
- Not in scope but adjacent: `runExpiry`/`runFulfillment`/`runCleanup` **also exist in cron/lite** with different bodies (see cross-cutting #4) — unify only after both routes are split.

### 7) Effort / writer

**L** (1,344-line handler with 9-24 captures per closure, 8 source-text test files). Writer: **strong implementer with Workers/D1 cron context** (Sol-tier) — a mechanical mid-tier will silently change admission order. Recommend one phase per commit with the golden `results` snapshot from §5 gap 6.

---

## (c) `src/app/api/cron/lite/route.ts` — 983 lines, **54 commits/60d (highest churn)**

### 1) Structure

| Lines | Section | Symbols |
|---|---|---|
| 1-42 | Contract header (job list + per-job caps, aliases `notify` legacy) | — |
| 44-46 | Imports (only 3; enforced) | `next/server`, `@/lib/security`, `@/lib/db-access` (`createBudgetedDatabase`, `QueryBudgetExceeded`, `unwrapD1`, `DatabaseAccess`) |
| 48-60 | Job registry + caps | `LITE_JOBS` (50, 23 names), `LiteJob`, `EXPIRY_PER_RUN=30`, `ORPHAN_LEDGER_PER_RUN=30`, `FULFILLMENT_PER_RUN=20`, `FULFILLMENT_ITEMS_PER_JOB=10`, `WR_SK_BALANCE_CHECK_INTERVAL_MS=10m`, `INDOSMM_BALANCE_CHECK_INTERVAL_MS=5m`, `JASPAY_PRODUCTS_PER_TICK=10` |
| 61-69 | Items parser | `Items`, `parseItems` (duplicate of `src/lib/telegram/order-notifications.ts:40` — see cross-cutting #1) |
| 71-310 | **POST dispatcher** | auth 72-78; `invalid_job` 78; budget 82 (`400` for `fulfillment`/`jaspay_catalog`, else `300`); `result`+`failedCore` 83-84; 22 `if/else if` job branches 86-291; catch 292-298 (`QueryBudgetExceeded` → `budget_exhausted` 200, else 500); `failedCore` → 503 299-301; `cron_lite_<job>_ok_at` marker 302-308 |
| 312-360 | Shared helpers | `Db` alias, `saveServiceHealth` (314-322), `sampleWhatsAppGateway` (324-348), `drainDirtyGroupsIfBudget` (350-360) |
| 362-475 | `runExpiry` | orphan ledger sweep, stale-initializing, expired candidates, `sekalipay_gateway` expired, `expireGamesCheckouts`, `bumpCatalogRevision("market", {metered:true})` when restocked (470-473) |
| 477-495 | `runFulfillment` | gate `AUTO_FULFILLMENT_ENABLED`, `releaseStaleJobs`, `getDueJobs`, `processJobItems` |
| 497-508 | `monitorRecovery` | higher-order "guard + failedCore.push + recordSyncError" |
| 510-591 | `runWrOrders` | `recoverStaleClaims` → `reconcileBlockedBalance` → orphan probe (no due gate) → retry/process → `refreshDueSupplierOrders` → `reconcileStuckWrOrders(minAge 2)` → `reconcileJaspayAmbiguous(12)` → credential deliver/requeue → saldo 10m |
| 593-648 | `runSkOrders` | mirror + `alertAgingSkOrders` + `settleExhaustedSkRetries` + double-pass when orphans healed |
| 650-667 | `runSupplierBalanceCheck` | generic prefix writer for tunvn/aivault/storebat/mirai |
| 669-715 | `run{Tunvn,Aivault,Storebat,Mirai}Orders` | `process*Orders({deadlineMs: deadline-5_000})` + balance check |
| 717-787 | `runPediaOrders` | dispatch, IndoSMM balance (5m CAS), `refreshPediaServiceStats` |
| 789-830 | `runPromo` | `enqueueDueTelegramPromo`, `sendDueDailyAdminSummary`, **nested 400-statement budget** `createBudgetedDatabase(400, 4, unwrapD1(db.getD1()))` (811) + `processBroadcasts` (~40 s envelope) |
| 832-922 | `runNotifyA` (842-863), `runNotifyB` (865-917), `runNotify` (919-922) | ordered sub-jobs with per-job `guard(key, fn, core)` and `hasTime` |
| 924-960 | `runCleanup` | `runMaintenanceCleanup` → stamp deletion → `checkSyncStaleness` → `materializeRecurring` → `decideDirtyWinners` → `checkCopyReviewChanges` → `runCryptoMarketRefresh` |
| 962-983 | `runCryptoMarketRefresh` | `refreshCryptoMarketSnapshot`, swallows `QueryBudgetExceeded` |

Catalog jobs (aivault/storebat/mirai/tunvn 162-241) are four near-identical blocks: `isConfigured`/`isSyncEnabled` → `skipped:"not_configured"` → `loadCurrentFxSnapshot` + `parseRateRational` → `fx_unavailable` 503 + `recordSyncError` → `publish*Catalog` → 503 on `ok:false` → `drainDirtyGroupsIfBudget`. `games_catalog` (259-266) and `games_orders` (267-274) are separate thinner branches.

### 2) Inputs / outputs / shared mutable state

- **In:** `?job=` (must be in `LITE_JOBS`), `Bearer CRON_SECRET`; env `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` (payments reserve, 89), `AUTO_FULFILLMENT_ENABLED`, `WARUNG_REBAHAN_AUTO_ORDER_ENABLED`, `SEKALIPAY_AUTO_ORDER_ENABLED`, `WHATSAPP_ENABLED`+`WHATSAPP_GATEWAY_URL`.
- **Out:** one `job`'s work per request. Writes: orders/payment_transactions/fulfillment_*/wr_*/sk_*/pedia_*/games_*/whatsapp_outbox/broadcast_*/store_settings. Network: provider reconciles, Telegram, Resend email, WA gateway `/health`, VPS proxy (via libs), Digiflazz/SK/Digiflazz-games.
- **Shared mutable state:** `job`, `db` (one budget wrapper), `result` (accumulated, returned verbatim), `failedCore` (array → 503), `deadline = now + 45_000` (per request, 72), and inside `runPromo` a **second nested budget** `broadcastDb` derived from `unwrapD1(db.getD1())` (811). No module-level `let`.
- **Per-job budget:** `400` for `fulfillment`|`jaspay_catalog`, `300` otherwise (82) — this is the Workers-Paid runaway guard, documented `docs/agent-rules/platform-ops.md` (Wave 1 A1).

### 3) External contracts that MUST NOT change

- `POST /api/cron/lite?job=<name>`; 401 `unauthorized`, 400 `invalid_job`; 200 `{ok:true, job, …}`; 503 `{ok:false, failed_subjobs:[…]}` **without** the `cron_lite_<job>_ok_at` marker (`cron-lite-subjobs.integration.test.ts:92,143` assert absence); `QueryBudgetExceeded` → 200 `budget_exhausted` (`:265`).
- `LITE_JOBS` membership — the exact 23 strings are the Worker's contract (`mcp-worker/src/cron.ts:71-97`, incl. `everyMinutes:5` for `cleanup`, `10` for `games_catalog`). Order is not asserted but alias set is: `notify` = `notify_b` then `notify_a` (919-922; comment 13-17 explains Worker now calls a/b separately but `notify` must stay for heavy tick).
- Per-job response field names read by tests: `payments_deferred` (90-94), `failed_subjobs`, `skipped`, `more` (**lite never sets `more`** [fact] — chunked continuation is operations-only), `pairs_decided`/`pairs_changed`, `wr_saldo_*`/`sk_saldo_*`, `indosmm_balance`, `pedia_stats`, `recovery_failed`, `copy_review`, `crypto_market`, `staleness`, `budget_exhausted`, `credentials_queued/delivered/requeued`.
- Per-step alarm labels in the Worker (`alarm: "hard"|"soft"|"none"`) map 1:1 to job names — renaming a job silently unmonitors it (`docs/agent-rules/platform-ops.md` F1).
- Forbidden static imports (test-enforced, `cron-lite.integration.test.ts:459-464`) → every job module must be dynamically imported.
- `sendPendingOrderReminders(50, db, hasTime)` **exact substring** (`telegram-bot.regression.test.ts:948`).
- Ordering rules inside `notify_b`: `maintenance_cleanup` core guard first (877-882), `checkout_pin_emails` before `whatsapp_outbox` (886-903), `restock_alerts` last (`docs/agent-rules/platform-ops.md` Wave 2 + TG-POLISH-B).
- `WR_SK_BALANCE_CHECK_INTERVAL_MS = 10m` / IndoSMM `5m` (A7/A8) and `processDueWhatsAppOutbox(4, …)` anti-ban (§Wave 1).
- Aliased duplicate job branches must keep `skipped:"not_configured"` (string asserted indirectly through `cron-lite` fixtures).

### 4) Callers

`axgraph affected "…/cron/lite/route.ts::POST()" --depth 1` → only `tests/broadcast-queue.test.ts:21` (graph is alias-limited; source grep is authoritative). Real caller: `mcp-worker/src/cron.ts:165` (`step.lite` → `/api/cron/lite?job=`), plus ~30 test files importing `POST` dynamically (heaviest: `cron-lite`, `cron-lite-subjobs`, `sekalipay-gateway` ×3, `klikqris` ×3, `paid-plan-caps-w1`, `paid-plan-wave2-b1-b2`, `unique-units` ×2, `crypto-market-cron` ×2, `overview-health` ×2, `telegram-webhook-guard` ×2, `transaction-recovery`, `incident-20261010`, `p1-cache-cron:365`, `product-copy-review-alert:193`, `supplier-balance-alert:40`, `sync-staleness:354`, `daily-admin-summary:298`, `catalog-cache-invalidation:333`, `games-orders:637`, `pedia-cancel-stock:42`, `payment-rails-checkout:653`, `sk-queue-budget:43`, `sk-claimed-recovery:572`, `fx1-cron-recovery:30`).

### 5) Test coverage per section

| Job(s) | Tests |
|---|---|
| auth / invalid job / no heavy static imports | `cron-lite.integration.test.ts:250,459` |
| `payments` | `cron-lite-subjobs:65,98`, `klikqris.integration:100,120,422`, `sekalipay-gateway:319,401,1174` |
| `expiry` | `cron-lite:285`, `unique-units:101`, `klikqris:422` |
| `fulfillment` | `cron-lite`, `unique-units` |
| `wr_orders`/`sk_orders` | `cron-lite:333,470,496`, `cron-lite-subjobs:33,47`, `warung-rebahan/incident-20261010`, `warung-rebahan/transaction-recovery:212`, `sk-claimed-recovery`, `sk-queue-budget` |
| `tunvn_orders`/`aivault_orders`/`storebat_orders`/`mirai_orders` | `supplier-balance-alert.test.ts:522` ("/api/cron/lite supplier balance wiring"), `cron-phase-split` |
| `{tunvn,aivault,storebat,mirai}_catalog` | `cron-lite:25,56,71,91,162` |
| `jaspay_catalog` | `cron-lite:91`, `p1-cache-cron:365`, `jaspay-catalog.workerd` |
| `pedia_orders` | `cron-lite:346,363`, `cron-lite-subjobs:123`, `paid-plan-caps-w1`, `pedia-cancel-stock` |
| `promo` | `cron-lite:394`, `daily-admin-summary`, `broadcast-queue`, `telegram-promo-broadcast` |
| `notify_a`/`notify_b`/`notify` | `cron-lite:426,448`, `cron-lite-subjobs:149,179,213,237,265`, `fx1-cron-recovery`, `paid-plan-wave2-b1-b2` |
| `tg_webhook` | `telegram-webhook-guard:491,521`, `overview-health` |
| `cleanup` | `cron-lite:188,426`, `product-copy-review-alert:190`, `sync-staleness`, `crypto-market-cron:32` |
| `games_orders`/`games_catalog` | `cron-lite:208,235`, `games-orders:637` |

**Gaps (add characterization before splitting):**
1. **`sampleWhatsAppGateway`** (`/health` sample, 324-348) — no direct test; only runs under `job=cleanup`. Pin it (fetch stub, 3 sample values, 5-minute guard).
2. **`runPromo` broadcast backstop** — `broadcast-queue` covers the worker; the nested 400 budget + `remainingMs` envelope (811-821) is untested.
3. **`finish` marker matrix** — which jobs skip `cron_lite_*_ok_at` on failure: tested only for `payments`, `pedia_orders`, `tg_webhook`. Pin all core-failure jobs.
4. **`games_catalog` unchanged/dirty-group skip condition** differs from the other 4 catalog branches (198 `!("unchanged" in synced)`; others unconditional) — [fact] an intentional asymmetry, but untested; pin it so a "helpful" refactor does not unify them.
5. `tunvn_catalog`/`aivault_catalog` **no early-return on `ok===false`** vs `mirai`/`storebat` returning 503 (162-241) — also asymmetric and untested; pin.
6. `drainDirtyGroupsIfBudget` failure isolation (`QueryBudgetExceeded` rethrow vs swallow, 350-360) — partly in `cron-lite:91`.

### 6) Proposed split

```
src/app/api/cron/lite/route.ts          # auth, LITE_JOBS check, budget, dispatch table, markers — keep the 3 dynamic anchors
src/lib/cron/lite/jobs.ts              # `LITE_JOBS` + `LiteJob` type only (static, tiny; not "heavy")
src/lib/cron/lite/context.ts           # LiteContext { job, db, deadline, result, failedCore } + saveServiceHealth + monitorRecovery + drainDirtyGroupsIfBudget + parseItems
src/lib/cron/lite/jobs/payments.ts     # branch 86-156 (incl. `admit`, reserve math)
src/lib/cron/lite/jobs/expiry.ts       # 362-475
src/lib/cron/lite/jobs/fulfillment.ts  # 477-495
src/lib/cron/lite/jobs/wr-orders.ts    # 510-591
src/lib/cron/lite/jobs/sk-orders.ts    # 593-648
src/lib/cron/lite/jobs/small-suppliers.ts # 650-715 (balance check + 4 orders)
src/lib/cron/lite/jobs/pedia.ts        # 723-787
src/lib/cron/lite/jobs/catalog.ts      # 162-241 → one `publishCatalogJob(ctx, spec)` factory + games branches 259-274
src/lib/cron/lite/jobs/promo.ts        # 789-830
src/lib/cron/lite/jobs/notify.ts       # 842-922
src/lib/cron/lite/jobs/cleanup.ts      # 924-983
```
The dispatcher must keep being written as `if/else + await import()` (constraint #1). A `switch` is fine; a static-import map is not.

**Commit ordering:**
1. `jobs.ts` + `context.ts` (no move) — run `cron-lite`, `cron-lite-subjobs`.
2. `payments.ts` (most intricate, own reserve math) — `cron-lite-subjobs:65,98`, `klikqris`, `sekalipay-gateway`.
3. `expiry.ts` + `fulfillment.ts` — `cron-lite:285`, `unique-units`.
4. `wr-orders.ts` + `sk-orders.ts` — `incident-20261010`, `transaction-recovery`, `sk-claimed-recovery`.
5. `small-suppliers.ts` + `pedia.ts` — `supplier-balance-alert`, `pedia-*`.
6. `catalog.ts` **with the characterization from gap 4/5 first** (this is the only place a "dedupe" is tempting and wrong).
7. `notify.ts` (a/b/combined) — `cron-lite:426-448`, `fx1`, `wave2`.
8. `promo.ts` + `cleanup.ts` — `daily-admin-summary`, `broadcast-queue`, `crypto-market-cron`, `sync-staleness`, `product-copy-review-alert`.

**Specific risks**
- **Highest churn (54/60d)** → rebase per commit; the split will be obsolete if landed as one big diff. One job per commit, each ≤1 day of drift.
- `LITE_JOBS` has a duplicate `/wr/sk orders` list line in the header comment (1-42) that must stay in sync — cosmetic but a reviewer trap.
- Any accidental static import of `@/lib/telegram*` etc. breaks `cron-lite:459-464` **and** the CPU rationale; run that test after every commit.
- **Correction (3A-4):** `runSupplierBalanceCheck` catches ordinary failures as `*_balance_error: "balance_failed"`, but rethrows `QueryBudgetExceeded`. The route turns that exception into a successful budget yield, not HTTP 500. The extraction preserves both paths.
- `runPromo` nested budget uses `unwrapD1(db.getD1())` (811); the context must expose the raw D1 or the nested budget cannot be built.
- `runWrOrders`/`runSkOrders` import `orders` module namespace (`await import("@/lib/warung-rebahan/order")` then `order.process…`) — an object-spread refactor here is the one place where a typo won't be caught by types.

### 7) Effort / writer

**M-L** (983 lines but 23 mechanical handlers; the risk is contract strings, not logic). Writer: **mid-tier with a strict checklist** works, provided the source-text test list is in the brief. Highest-churn file → land early in the roadmap, in small commits.

---

## (d) `src/app/api/orders/route.ts` — 906 lines, 44 commits/60d

### 1) Structure

| Lines | Section | Symbols |
|---|---|---|
| 1-25 | Imports | 24 static (zod, `@/lib/db` `createOrderWithStock`/`queryAll`/`queryFirst`/`StockReservationError`/`transitionPendingOrder`, `order-access` ×7, `payments/qris`, `crypto-preflight`, `crypto-pricing`, `checkout-guard`, `http-body`, …) |
| 29-40 | `paymentMethodProblem(locale)` | buyer copy for gateway/crypto failure |
| 42-70 | `schema` (zod) | `customer_name?`, `customer_wa` (normalize + regex), `customer_email` required, `items[]` (product_id|slug, qty 1..100, `buyer_fields`), `payment_method`, `proof_url`, `quote_token` |
| 72-78 | `closedCheckoutResponse(status, locale)` | 409 `checkout_order_closed` |
| 80-164 | `existingCheckoutResponse(existing)` | re-read fresh row (84-88) → closed 409 → buyer session + credential grant (92-93) → per-provider saved-retry: `sekalipay_gateway` preclaim (99-102), `klikqris` reissue (103-115), `nowpayments` reconcile+view (116-134), `sekalipay_gateway` init→create/reconcile (135-161) → generic `reused:true` (163) |
| 166-169 | Note | rate-limit single implementation |
| 171-635 | **POST** | see stages below |
| 637-905 | **GET** | status page view builder (see stages) |

POST stages: maintenance 172 → rate limit 173 → body+validate 175-178 → access-config 180-183 → method classification 185-204 (`isCryptoMethod`, `isGatewayMethod`, proof_url disabled) → quote verify 206-209 → slug→id canonicalization + cart equality 211-222 → buyer-code/muse guard 223-229 → saved-retry dispatch 231-232 → email guard 234-276 → min-qty/max-cap guard 278-343 → price-change guard 345-385 → WA normalize 387-390 → signed-method checks 392-400 → crypto preflight (402-468) / gateway preflight (469-476) / qris check (477-481) → **checkout slot** 489-503 → `createOrderWithStock` 513-543 (with 409/UNIQUE recovery) → invoice issuance per rail 545-612 (qris, nowpayments, gateway) → funnel + 201 response 614-634.

GET stages: rate limit 638 → code lookup 641-651 → access 652-654 → provider `wake=1` paths 655-725 (gopay, klikqris, nowpayments, sekalipay_gateway, klikqris poll) → PII masking 726-730 → readiness flag SQL 731-814 (one big `WITH lines …` query) → supplier refresh 815-849 → unique-units progress 850-857 → payment view 858-863 → response 864-902.

### 2) Inputs / outputs / shared mutable state

- **In:** JSON body (zod) + `quote_token` (HMAC via `verifyCheckoutQuoteToken`); IP from `clientIp(req)` for rate-limit/checkout subject.
- **Out:** creates `orders` + reserves `product_variants.stock` + `payment_transactions` (via rails) + `checkout_guard`/`operation_guards` rows; response 201 (create) / 200 (reuse) / 409 / 422 / 429 / 503.
- **Shared mutable state:** none module-level. Within GET, `row` is mutated via `Object.assign` (676, 695, 705, 722) and the derived flags (`credentialsReady`, `queuedDelivery`, `instantDelivery`, `supplierOwned`, `supplierRunning`, `hasAutomaticProgress`) are recomputed after a supplier refresh (822-849). Two DB handles: module-level `queryFirst/queryAll` (unbudgeted `getD1()`) and a `createDatabaseAccess()` for `consumeCheckoutSlot` (490) / `maybeRefreshSupplierOrder` (826).
- **Env:** none read directly in this file [fact: `grep process.env` → 0]. Gates come from `payment-maintenance`, `*Configured()` helpers.

### 3) External contracts that MUST NOT change

- `POST /api/orders` response 201: `{ code, buyer_access_session, checkout_credential_grant, subtotal, status:"pending", locale, qris: {payable_amount,unique_code,image_url,expires_at}|null, payment? }` (620-634); reused 200 adds `reused:true` (108-163). Error codes: `checkout_order_closed` (409), `price_changed` (409), `quote_stale` (409), `payment_method_unavailable` (503, `error_code`), 422 min/email, 429 `Retry-After`, 503 maintenance. `Cache-Control: private, no-store` on all order responses.
- `GET /api/orders?code=AXV-…` body `order.{code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,locale,created_at,expires_at,qris_preparation_error,credentials_ready,buyer_pin_required,queued_delivery,instant_delivery,supplier_owned,supplier_running,fulfillment_status,automatic_progress,unique_units_progress,qris_reissue_allowed,qris,payment?}` (864-902). Locked by `order-instant-delivery.integration.test.ts:62` (instant), `warung-rebahan/credentials.regression.test.ts:172` (credentials_ready), `sk-order-flags-credential.test.ts:70` (SK auto vs queued), `round4-buyer-notices.regression.test.ts:210` (fulfillment_status), `unique-units.integration.test.ts` (unique_units_progress), `qris-channel-policy`, `qris-core`, `owasp-*`, `web-payment-order.behavior.test.tsx:33,469` (polling contract).
- **`GET` duplicates `src/app/api/orders/lookup/route.ts:99-158`** (flags + supplier refresh) — 6 of the fields computed twice. Any shared-helper extraction must keep both responses byte-compatible.
- Source-text assertions (retarget if moved): `security.regression.test.ts:183-190,258-295` (`proof_url`, `payment_method !== "qris"`, `503`, exact zod line, `quoteHasQris`, no `accountMap`, `payment_method: z.string().trim().max(64)`, `payment_method !== "qris" && !isCryptoMethod && !isGatewayMethod`, no `bank:bca`); `variant-min-qty.test.ts:78-84` (`minimal pembelian`, `min_qty`, `qtyByVariant`, `qty: z.coerce.number().int().min(1).max(100)`); `buyer-silence-and-atomicity.regression.test.ts:84-98` (`price_changed` **before** `await createOrderWithStock(`, `SELECT pv.id, pv.price, pv.bulk_pricing_enabled, pv.bulk_pricing_tiers`, `JOIN products p ON p.id = pv.product_id`, `resolveBulkPriceForProduct`); `round3-name-and-money-silence.regression.test.ts:31-44` (`deriveNameFromEmail`, regex on `customer_name?.trim()…deriveNameFromEmail`, no `split("@"`); `traffic-query.regression.test.ts:38-42` (`checkRateLimit`); `qris-core.regression.test.ts:89` (file in loop); `migration-and-atomicity.regression.test.ts:448-451` (`quote_id`, and `src/lib/whatsapp/handlers/{payment,catalog}.ts` must not exist — unrelated but same test).
- **D1 expression-depth 100** guard: `createOrderWithStock` throws 500 when conditions are grouped flatly (`docs/agent-rules/platform-ops.md`; `tests/market-order-reservation.workerd.test.ts`). A refactor that reshapes the SQL call site is out of scope.
- Signed-token authority: **no** client-supplied price/currency may win (402-468) — this logic must remain a pure function of the verified quote.

### 4) Callers

`axgraph affected "…/orders/route.ts::POST()" --depth 1` → `tests/admin-payment-test.integration.test.ts:10` (graph under-reports; source grep authoritative). Real callers: checkout page (`fetchWithTimeout("/api/orders")`, asserted `buyer-silence:105-112`), `/pesanan/[code]` polling, `lacak-pesanan`. Test importers of `POST`/`GET`: 40 files listed under §5.

### 5) Test coverage per section

| Section | Tests |
|---|---|
| quote integrity / stock lifecycle | `checkout-integrity.regression.test.ts:9,135` |
| compact quote token 28 coins E2E create | `quote-token-compact.test.ts:183` |
| bulk tiers / stale price / saved retry | `bulk-checkout.integration.test.ts` (8 `it`) |
| unique units reservation + caps | `unique-units.integration.test.ts` (9 `it`) |
| min_qty / max cap re-enforced | `variant-min-qty.test.ts:67-93` |
| checkout slot / anti-abuse | `checkout-guard.integration.test.ts`, `owasp-access-and-checkout.integration.test.ts` |
| buyer access code / PIN | `buyer-access-code.integration`, `buyer-pin.integration`, `buyer-paid-pin.integration` |
| credential grant | `checkout-credential-grant.integration.test.ts` |
| payment rails create | `payment-rails-checkout.integration.test.ts`, `sekalipay-gateway.integration`, `sekalipay-method-limits`, `sekalipay-quote`, `crypto-multicoin`, `klikqris.integration` |
| QRIS routing/channel | `qris-core.regression.test.ts:83`, `qris-channel-policy.integration.test.ts:54` |
| GET status flags | `order-instant-delivery:62`, `warung-rebahan/credentials:172`, `sk-order-flags-credential:70`, `round4-buyer-notices:210`, `nonwr-handover-content:144-146`, `web-payment-order.behavior` |
| maintenance / rate limit / security | `payment-maintenance.test.tsx`, `traffic-query.regression`, `security.regression`, `owasp-request-boundaries` |
| name sanity | `round3-name-and-money-silence` |
| WR/SK per-channel behaviour | `warung-rebahan/{jaspay-automatic-sales,transaction-recovery}`, `sekalipay/sk-claimed-recovery` |

**Gaps (add characterization before splitting):**
1. `existingCheckoutResponse` provider matrix — only `klikqris`/saved-retry is partly covered (`bulk-checkout:86`, `sekalipay-gateway:366`). **No test** for the `sekalipay_gateway` preclaim-orphan 503 (99-102) nor the generic tail (163). Pin all five returns.
2. `paymentMethodProblem` copy per locale — asserted nowhere.
3. `closedCheckoutResponse` 409 `checkout_order_closed` — `checkout-integrity` may cover; verify before moving.
4. GET `wake=1` gopay → `scheduleGopayWake` (658-662) — no test.
5. GET `qris_preparation_error` boolean (663-677) — no test.
6. `qris_reissue_allowed` cap `MAX_QRIS_REISSUES` — asserted? (`qris-channel-policy` maybe). Verify.
7. Route-level **golden response snapshot** for POST (201 + each 409/422/429/503 variant) and GET (pending/lunas × provider) — the cheapest guarantee for a 465-line handler.

### 6) Proposed split

```
src/app/api/orders/route.ts                 # keeps `export async function POST/GET` (40 test files import here); body → ~40 lines each, delegating
src/lib/orders/checkout/validate.ts         # schema + method classification + buyer/muse guard
src/lib/orders/checkout/guards.ts           # email, min_qty/max cap, price_changed (pure over quote+rows)
src/lib/orders/checkout/methods.ts          # crypto preflight (402-468) + gateway preflight (469-476) + qris check → `resolveCheckoutMethod(quote, selected, …)`
src/lib/orders/checkout/create.ts           # slot + createOrderWithStock error recovery (489-543)
src/lib/orders/checkout/invoice.ts          # per-rail issuance (545-612) → `issueCheckoutInvoice(rail, …)`
src/lib/orders/checkout/response.ts         # reused/closed/created response builders (72-164, 614-634)
src/lib/orders/status-flags.ts              # the `WITH lines …` query + supplier-refresh re-query, shared with `orders/lookup/route.ts:99-158`
src/lib/orders/detail-view.ts               # GET body builder (637-905) — takes a row + flags
```

**Commit ordering:**
1. `status-flags.ts` + `detail-view.ts`, and make `orders/lookup/route.ts` use them (pure dedupe, no route change) — `order-instant-delivery`, `credentials.regression`, `round4`, `sk-order-flags`, `nonwr-handover`.
2. `response.ts` (closed/reused/created builders) — `checkout-integrity`, `bulk-checkout`.
3. `guards.ts` (email/min/price) — `variant-min-qty`, `buyer-silence`, `bulk-checkout`.
4. `methods.ts` (crypto/gateway) — `quote-token-compact:183`, `sekalipay-gateway`, `sekalipay-method-limits`, `crypto-multicoin`, `payment-rails-checkout`.
5. `create.ts` + `invoice.ts` — `checkout-guard`, `unique-units`, `owasp-access-and-checkout`.
6. `validate.ts`, route thin; retarget source-text tests in each commit (`security`, `variant-min-qty`, `buyer-silence`, `round3`, `traffic-query`, `qris-core`, `migration-and-atomicity`) to the new files.

**Specific risks**
- **40 test files import `{ POST, GET }` from this exact path.** Keep the handlers exported here (a thin `export async function POST(req){return handleCheckout(req)}` is safe; a pure `export { POST } from "./handler"` is **[guess]** risky with Next's route-module static analysis — do not do it).
- 24 static imports here; extraction to `src/lib/orders/**` keeps bundle identical but watch for **circular import** `lib/orders/*` ↔ `lib/db` (the route already imports both). Keep `status-flags` leaf-only.
- GET mutates `row`; a `detail-view(row)` builder must receive the **post-refresh** row or it will regress `credentials_ready` (`order-instant-delivery`/`credentials` will catch it).
- Checkout slot uses an unbudgeted `createDatabaseAccess()` (490) — do not "helpfully" switch it to the request budget.
- `closedCheckoutResponse` returns `NextResponse` (needs `next/server`) — keep response shaping in the route layer or accept a `next` import inside lib (currently `lib/` does import `next/server` elsewhere — acceptable but adds to edge bundle).

### 7) Effort / writer

**M** (single file, 906 lines, clear stage boundaries, but 40 dependent test files and a signed-token authority path). Writer: **mid-tier** with the guard ordering stated explicitly ("price_changed must remain before createOrderWithStock").

---

## (e) `src/components/admin/SupplierAdminPanel.tsx` — 1,154 lines, 5 commits/60d

Lowest churn of the five — safe to schedule last.

### 1) Structure

| Lines | Section | Symbols |
|---|---|---|
| 1-23 | Imports | 14 modules; data layer `./supplier-admin-data` (types + `SUPPLIERS`, `catalogItems`, `inferVariantStatus`, `supplierRequest`, `mapSupplierError`, `supplierMoney`, `supplierTime`), UI kit `./ui`, `SupplierTabs`, `SupplierPriceRow`, `BulkMarkupDialog`, `BulkMarkupToolbar`, `SupplierOrderQueue`, `SupplierSyncStatus` |
| 25-33 | Constants | `PANEL_TABS` (ringkas/antrean/markup/alat), `MarkupSubTab`, `WR_SK_ORDER_PER_PAGE=20` |
| 35-83 | Small presentational | `aivaultBulkMarkupPreview` (35-45), `DeliveryBadge` (47), `ProcessBadge` (53), `FamilyCard` (61), `SupplierDescription` (78) |
| 85-1154 | `SupplierAdminPanel({supplier})` | 43 `useState` (90-136) + 9 `useRef` (95, 138-145) |
| 147-290 | Loaders | `loadStandard` (148-187, non-WR/SK eager `Promise.allSettled` of 4 endpoints), `loadWrSkSaldo` (190), `loadWrSkLogs` (206), `loadWrSkOrders` (236), `loadWrSkMarkups` (260), `loadWrSkExclusions` (284) |
| 292-369 | Effects | mount (293), debounce ×2 (305,311), lazy-tab fetch guards (318,327,335), `openTab` (341), `refreshActive` (352), bulk-clear (367) |
| 371-592 | Mutations | `mutateStandard` (372-405), `runWrSkSync` (408-438), `runWrSkOrderAction` (440-459), `saveWrSkMarkup` (461-488), `applyBulkMarkup` (490-520), `addExclusion` (522-547), `deleteExclusion` (549-562), `runSandbox` (564-592) |
| 594-777 | Derived | `items` memo, `allFamilies`, `searchMatchedEntries` (614-662), `markupCounts`, `markupFiltered`, pagination, `pagedGroups` (689-714), counts/flags (716-734), `priceRow()` renderer (738-777) |
| 779-1154 | Render | header (780-787), status live region (788-795), `ringkas` tab (797-860), `antrean` (862-893), `markup` (895-1052), `alat` (1054-1127), dialogs (1130-1152) |

### 2) Inputs / outputs / shared mutable state

- **In:** props `{ supplier: Supplier }` (6 values: warung/sekalipay/aivault/tunvn/storebat/mirai); `const config = SUPPLIERS[supplier]` drives everything; `isWrSk = Boolean(config.lazy)`.
- **Out (network):** `/api/admin/{supplier}/{products,balance,orders,buff}` (standard), `{saldo,sync-log,orders?status&per_page&page&q,markup?limit&q,exclusions,sandbox,sync}` (WR/SK), `PUT markup`, `POST markup/bulk`, `POST exclusions` / `DELETE exclusions?id=`. Shapes typed in `supplier-admin-data.ts:33-75` (`Catalog` 33, `Balance` 37, `SyncLogCounts` 44, `BuffData` 47, `OrderLink` 57).
- **Shared mutable state (React):** the whole component is one state bag. Guards: `generation` ref (stale-render cancellation), `actionPending` ref (single-flight), `orderRequest`/`markupRequest` (last-write-wins), `lastOrderFetchKey`/`lastMarkupFetchKey` (dedupe), `loadedTabs` set (lazy loading), `markupTabTouched` (auto-select only until user acts). Splitting tabs requires this bag to become a hook/context.

### 3) External contracts that MUST NOT change

- Named export `SupplierAdminPanel` + prop name `supplier`; 6 wrapper managers import it (`AivaultManager.tsx:3,6`, `MiraiManager.tsx:3,6`, `SekalipayManager.tsx:3,48`, `StorebatManager.tsx:3,6`, `TunvnManager.tsx:3,6`, `WarungRebahanManager.tsx:3,51`).
- Endpoint paths/verbs and response field names (table above) — admin API side is covered by `tests/supplier-panel-tabs.behavior.test.tsx:296` ("kontrak API tab (variant_status + total + pagination)") and `supplier-price-ui.behavior.test.tsx:276` (V3 parity sub-tabs 20/50/100 + bulk).
- Source-text assertion: `tests/markup-bulk.test.ts:171-178` reads **this file** and expects `BulkMarkupToolbar` and `/markup/bulk`; it also asserts wrappers contain `<SupplierAdminPanel supplier="warung"` / `"sekalipay"` (168-170).
- a11y/behavior locked by `tests/supplier-panel-tabs.behavior.test.tsx`, `supplier-price-ui.behavior.test.tsx`, `aivault-bulk-ui.behavior.test.tsx`, `admin-stability.behavior.test.tsx`, `destructive-actions.behavior.test.tsx`, `admin-round2-ui3-corrections.behavior.test.tsx`, `admin-ux-dead-end.regression.test.ts`.

### 4) Callers

`axgraph affected "…/SupplierAdminPanel.tsx::SupplierAdminPanel()" --depth 1` → the 6 managers (`calls` + `imports`). No other callers. Test renderers reach the panel through those wrappers (§5).

### 5) Test coverage

| Area | Tests |
|---|---|
| tabs + lazy loading | `supplier-panel-tabs.behavior.test.tsx:64,243` |
| price rows / markups / pagination / bulk | `supplier-price-ui.behavior.test.tsx:51,113,276` |
| bulk UI (AIVault) | `aivault-bulk-ui.behavior.test.tsx:30` |
| stability (loader identity, no double fetch) | `admin-stability.behavior.test.tsx:33,67,107` |
| destructive actions (void/retry/exclusion confirm) | `destructive-actions.behavior.test.tsx` |
| dead-end states | `admin-ux-dead-end.regression.test.ts` |
| toolbar presence (source text) | `markup-bulk.test.ts:160-178` |

**Gaps:**
1. **`runWrSkSync` status matrix** (`success`/`partial`/`failed` copy, 408-438) — no test asserts the three messages.
2. `applyBulkMarkup` partial-failure copy (`updated`/`failed[]`, 490-520) — untested.
3. `runSandbox` (564-592) — untested.
4. `loadStandard` `loadErrors` per section (`Katalog/Saldo/Antrean/Probe Buff`, 183-186) — untested.
5. WR/SK pagination boundary (`markupSafePage` clamp, 681-686) — untested.

### 6) Proposed split

```
src/components/admin/supplier/panel-context.ts   # useSupplierPanel(supplier): { config,isWrSk,state,loaders,actions,derived }  (the 43-state bag + single-flight refs)
src/components/admin/supplier/badges.tsx         # DeliveryBadge, ProcessBadge, FamilyCard, SupplierDescription
src/components/admin/supplier/RingkasTab.tsx     # 797-860
src/components/admin/supplier/AntreanTab.tsx     # 862-893
src/components/admin/supplier/MarkupTab.tsx      # 895-1052  (keeps `BulkMarkupToolbar` + `/markup/bulk`)
src/components/admin/supplier/AlatTab.tsx        # 1054-1127
src/components/admin/SupplierAdminPanel.tsx      # shell: props → hook → tabs + dialogs (keeps named export)
```
Data layer `supplier-admin-data.ts` already centralises types/requests — do **not** touch it (it is the shared "small framework" for 4 small suppliers + WR/SK).

**Commit ordering:** (1) `badges.tsx` + `panel-context.ts` with loaders/actions moved but tabs still inline; (2) `MarkupTab` (largest, has the source-text test) with `markup-bulk.test.ts` retarget; (3) `Ringkas`+`Antrean`; (4) `Alat`; (5) shell cleanup.

**Specific risks**
- **Hook-capture drift**: loaders close over `supplier`, `orderQueryLive`, `markupQueryLive`, `orderStatus`, `orderPage`; moving to a hook must preserve dependency arrays exactly, or the lazy-fetch dedupe (`lastOrderFetchKey`) starts double-fetching — `admin-stability.behavior.test.tsx:33` is the canary, run it after every commit.
- Single-flight `actionPending` ref is the only thing preventing double `PUT markup`; a per-tab split must share it (context), not duplicate it.
- `UI/CSS change` rule: `AGENTS.md` requires **real-browser** desktop/mobile verification for UI changes. A behavior-preserving split still counts as UI-touching → one Playwright/Paseo pass per PR, screenshots not a substitute for interaction.
- `markup-bulk.test.ts` reads this exact path; retarget to `MarkupTab.tsx` in the same commit.

### 7) Effort / writer

**M** (frontend-only, 1,154 lines, but 43-state hook extraction + 7 behavior test files). Writer: **frontend mid-tier** with browser verification available (Paseo/Playwright MCP present).

---

## Cross-cutting: duplicated helpers worth sharing later (no new framework)

Ordered by value/risk. All **[fact]** from source; **do not** bundle into the first split — each is a separate later step.

1. **`parseItems(raw)`** — identical implementations at `src/app/api/cron/lite/route.ts:62-69` and `src/lib/telegram/order-notifications.ts:40` (`JSON.parse` + `Array.isArray` guard). Extract to `src/lib/orders/items-json.ts`.
2. **Service-health writer** — `saveServiceHealth` is local to `cron/lite:314-322` while keys live in `src/lib/service-health.ts:17-19` and the reader is `src/app/api/admin/overview/route.ts:290-292`. Move the writer into `service-health.ts` (`readTelegramWebhookHealth` already there).
3. **WR/SK saldo-check block** — 4 copies: `cron/lite:573-589`, `cron/lite:630-646`, `cron/operations:1254-1269`, `cron/operations:1449-1464` (same `WARUNG_REBAHAN/WR_SALDO_LOG` + interval + `parseExpiry` dance), plus `INDOSMM_BALANCE_CHECK_INTERVAL_MS` in two routes vs `SUPPLIER_BALANCE_CHECK_INTERVAL_MS` in `src/lib/supplier-balance-alert.ts:23`. One `checkSupplierSaldo(db, source, {intervalMs})`.
4. **Same-named phase functions with different bodies** — `runExpiry` (`lite:362` vs `operations:565`), `runFulfillment` (`lite:477` vs `operations:868`), `runCleanup` (`lite:926` vs `operations:1275`). Do **not** unify blindly: lite's expiry also sweeps orphan ledgers + games; operations' also sends Telegram and repairs stranded ledgers. Only the *shape* (guard + defer) should be shared after both routes are split.
5. **`hasTime(ms)`** — `lite:874` (per-notify closure) and `operations:237` (from `runStartedAt`); `src/app/api/internal/queue/fulfill/route.ts:104` uses a third variant (40 s). A `deadlineFrom(start, ms)` helper is worth it only once (b) is split.
6. **Failure-guard pattern** — `monitorRecovery` (`lite:497-508`) vs `guard(key, fn, core)` closures (`lite:844-850`, `867-873`): same "catch → push failedCore → write sanitized error". One helper with `{core,label,recordSyncError}` options.
7. **Catalog publish branch ×4** — `lite:162-241` (aivault/storebat/mirai/tunvn) is the same 8-step script with 2 asymmetries (gaps c-4/c-5). A `publishCatalogJob(ctx, {configured,syncEnabled,publish,recordKey})` factory is justified **after** the characterization pins the asymmetries.
8. **Dirty-group drain** — `drainDirtyGroupsIfBudget` (`lite:350-360`) vs inline `decideDirtyWinners` in `runCleanup` (`lite:948-949`) vs `decideAllWinners` in operations (`1411-1417`, `1471-1478`). One `drainSupplierPairs(db, {mode:"dirty"|"all"})`. `src/lib/supplier-pairs.ts` already owns the decisions.
9. **Order readiness flags (SQL + refresh)** — `src/app/api/orders/route.ts:758-807` and `847-857` vs `src/app/api/orders/lookup/route.ts:110-126` and `141-157`. Same 4 subqueries + same refresh. One `src/lib/orders/status-flags.ts` (already proposed inside (d)).
10. **Deadline pass-through to catalog sweep** — `timeBudgetMs: Math.max(0, timeLeftMs() - TIME_WR_SWEEP_RESERVE)` appears twice in operations (1079, 1384) and once in WR/SK sync consumers; belongs with `catalog-sweep.ts`.
11. **Lite/ops result-key vocabulary** — `whatsapp_outbox_{sent,dead,recovered,claim_errors,paused}` is written in operations (841-845) and read/logged in lite cleanup; the worker alarm only cares about HTTP status, so a shared `waOutboxResult()` mapper is cosmetic — low priority.
12. **`supplierRequest` wrapper** (`src/components/admin/supplier-admin-data.ts:150`) is already shared — keep it; it is the correct example of "one small helper, no framework".

---

## Commands run (evidence) and cleanup

Read-only work. No background processes, dev servers, or deploys were started, so nothing had to be stopped.

```
wc -l src/lib/warung-rebahan/sync.ts src/app/api/cron/operations/route.ts \
      src/app/api/cron/lite/route.ts src/app/api/orders/route.ts \
      src/components/admin/SupplierAdminPanel.tsx          # 1933 / 1532 / 983 / 906 / 1154
git log --oneline -1                                     # ad711d6f (base)
git log --oneline --since='60 days ago' -- <each file>    # 24 / 37 / 54 / 44 / 5
~/.local/bin/axgraph affected "src/lib/warung-rebahan/sync.ts::syncProducts()" --depth 1
~/.local/bin/axgraph affected "src/lib/warung-rebahan/sync.ts::syncJaspayCatalog()" --depth 1
~/.local/bin/axgraph affected "src/lib/warung-rebahan/sync.ts::upsertWrVariant()" --depth 1
~/.local/bin/axgraph affected "src/lib/warung-rebahan/sync.ts::zeroMissingVariants()" --depth 1
~/.local/bin/axgraph affected "src/app/api/cron/lite/route.ts::POST()" --depth 1
~/.local/bin/axgraph affected "src/app/api/cron/operations/route.ts::POST()" --depth 1
~/.local/bin/axgraph affected "src/app/api/orders/route.ts::POST()" --depth 1
~/.local/bin/axgraph affected "src/components/admin/SupplierAdminPanel.tsx::SupplierAdminPanel()" --depth 1
grep -rn ... (callers, source-text tests, LITE_JOBS, env reads, duplicated helpers)
python3 heredoc: closure-capture analysis of operations phase functions (counts in §b-2)
sed -n ranges: mcp-worker/src/cron.ts:40-215 (step order), db-access.ts (budget API),
               orders/lookup/route.ts:28-201, service-health.ts, supplier-admin-data.ts:1-120
git status --short                                       # clean before and after
```

Graph caveat: `axgraph` reports few importers for the Next route modules (alias/entrypoint artifacts) and for `sync.ts` reported only test importers for `upsertWrVariant`/`zeroMissingVariants`. Every caller claim above is corroborated by `grep` over `src/`, `mcp-worker/`, `tests/`; treat the matrix as orientation only, as instructed.

---

## Top 5 risks across targets

1. **Source-text tests pin file paths, not behavior** — 8 test files read `cron/operations/route.ts`, 8 read `cron/lite/route.ts`, 7 read `orders/route.ts`, 4 read `sync.ts`, 1 reads `SupplierAdminPanel.tsx`. A behavior-preserving move silently *weakens* the suite unless each `read()` is retargeted in the same commit. This is the single largest under-estimated cost of the roadmap.
2. **`cron/lite` highest churn (54 commits/60d)** — a large split will conflict with in-flight work. Land it in one-job-per-commit slices; otherwise the branch goes stale before review.
3. **Per-invocation statement budget is shared state** — `createBudgetedDatabase(...)` ceilings (300/400, `RESERVE_TAIL=2`, and `raiseCeilingForCatalogSync(+800)` in WR sync) cross every proposed module boundary. Any "helper that adds one query" changes admission order for expiry/fulfillment/payments and is a production risk, not a style issue.
4. **`vi.mock("@/lib/warung-rebahan/sync", importOriginal)`** (`cron-phase-split:47`) — a non-barrel split (or a renamed specifier) drops symbols from the spread and breaks the Worker tick tests; also `jaspay-catalog.workerd.test.ts` esbuild-bundles that exact path.
5. **Two acceptance paths share one contract**: WR/SK proxy slice order (`/wr/products-slice`, `/sk/catalog-slice`) must stay matched with `/Users/macbookair/axvara-wr-proxy`, and `orders` GET must stay byte-compatible with `orders/lookup` because the order page polls both. A split that "cleans up" either side without cross-repo/contract review regresses buyer-visible behavior.

Effort summary: (a) **L**/strong-WR writer · (b) **L**/strong-Workers writer · (c) **M-L**/mid-tier + strict checklist (land early) · (d) **M**/mid-tier · (e) **M**/frontend mid-tier + real-browser verification.
