> Lampiran roadmap `issue/2026-11-21-refactor-roadmap.md`. Snapshot baca-saja pada commit ad711d6f (21 Nov 2026); nomor baris bisa bergeser — konfirmasi di source sebelum dipakai.

# MAP-2 — small suppliers (AIVault / StoreBat / Mirai / TUNVN): duplication map & refactor #4 design

Base: `main @ad711d6f` (FX-20 only touched WR/SK). Read-only: no repo edits, no commit/push/deploy.
Safety net: `tests/characterization/small-suppliers-claim.test.ts` (CT-A, 80 tests, passes on this base).

## Callers (axgraph + source-confirmed)

- Cron: `src/app/api/cron/lite/route.ts:670-708` dynamically imports and calls `processTunvnOrders` (670-673), `processAivaultOrders` (682-685), `processStorebatOrders` (694-697), `processMiraiOrders` (706-709), all with `{ deadlineMs: deadline - 5_000 }`.
- Paid path: `src/lib/payments/paid-fulfillment.ts:53-73` imports `create*OrderLinks` + `process*Orders` for all four; create is called at 55/58/61/64, then each process in the 73 loop.
- Admin retry: `src/app/api/admin/{aivault,storebat,mirai,tunvn}/orders/route.ts` -> `retry*Order` at lines 47/47/73/48; TUNVN admin reconcile calls `processTunvnOrders(db,{reconcileId})` at line 58.
- `axgraph affected "src/lib/<s>/orders.ts::retry<X>Order()" --depth 1` confirms each admin POST is the only direct caller. No Telegram/WhatsApp caller found by grep; paid path + cron are the only process entry points.

## 1. Duplication inventory

Legend: **I** identical, **P** same-with-params, **D** genuinely different.

### 1a. Order admission / paid gating

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| JS paid predicate | `orders.ts:9` | `:17` | `:25-30` | `:39-41` | **I** (SB writes `Number(x)===0`, rest `!Number(x)`) |
| SQL paid fragment | inline `:41` (create SQL `:38-45`), `:21` (retryable) | named `PAID` `:13`, used `:37,:47` | inline `:98-101`, `:69` | inline `:81`, `:15` | **P**; TUNVN create at `:81` omits `sales_channel IN (...)` (JS `paid()` at `:40` gates first) |
| `lines()` JSON-item parse | `:10` | `:18` | `:32-38` | `:36` | **P** (record-normalise vs raw) |
| eligible-line validation | `:11-18` | `:19-26` | `:41-63` | `:43-57` | **D** (supplier snapshot contracts) |
| create links | `:27-44` | `:36-49` | `:74-106` | `:59-89` | **P** skeleton; **D** columns/eligibility; TUNVN extra fulfillment rebind `:85-86` |

Measured statements for one `create*Links`: AIVault 2, StoreBat 2, Mirai 2, TUNVN 3 (`SELECT orders` + `INSERT` for the first three; TUNVN adds `UPDATE fulfillment_items`).

### 1b. Claim CAS / lease

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| claim UPDATE | `:118-120` | `:150-152` | `:340-344` | `:193-195` | **I** for AV/SB/MR; **D** TUNVN |
| lease duration | `+90 seconds` `:119` | `:151` | `:341` | `:194` | **I** |
| claim predicate | `status IN (pending,claimed,processing)`, `next_attempt<=now`, `lease NULL/expired` | same `:152` | same `:342-344` | same core **plus** `AUTO_RECOVERY_SQL` OR-group; reconcile branch `kind='buff' AND provider_batch_id IS NOT NULL AND status IN (processing,needs_admin)`; `status=CASE WHEN status='processing' OR ?=1 THEN 'processing' ELSE 'claimed' END` | **D** TUNVN |

`ownerGuard` / ownership fences:

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| settle WHERE | `:50` `id+owner+status!='completed'` | `:54` `id+owner+status='claimed'+unexpired` | `:127` `id+owner+status!='completed'` | `:94` `id+owner+status!='completed'` | **P** (SB stricter) |
| saveReceipt WHERE | `:70-71` `+attempt_count=?+status!='completed'+unexpired` | `:68-69` `+attempt_count=?+status='claimed'+unexpired` | `:182-183` same as AV | `:245-247` no owner/attempt guard; only `request_sent_at IS NOT NULL AND receipt_ciphertext IS NULL` | **P**; **D** TUNVN |
| provider-id UPDATE | `:99` `id+owner+status!='completed'` | `:104`/`:136` `${ownerGuard}` | `:282-283` `id+owner+status!='completed'` | `:145,:156,:162,:183` only `id+owner` | **P**; **D** TUNVN (weaker) |
| fulfillment delivery UPDATE | `:108-110` `... EXISTS(id+owner+status!='completed'+unexpired)` | `:113-115` `... EXISTS(${ownerGuard})` | `:307-312` same as AV | `:149` `... EXISTS(id+owner)` | **P**; **D** TUNVN |

### 1c. Settle / backoff / needs_admin

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| `settle` | `:46-56` | `:51-60` | `:108-148` | `:91-101` | **P** skeleton, **D** timing/guards |
| next-attempt math | pending -> `MAX(1,attempt*2)` minutes, else +1 min (`:48`) | `+? seconds`, caller passes delay default 60 (`:53`), `backoff` 120/240s (`:62`) | `max(60,attempt*120)` s or caller delay (`:113-121`), `deferRetry` `:150-175` | `+3 minutes` needs_admin else `+1 minute` (`:93`) | **D** |
| needs_admin item update | `:53` (+`delivered_ciphertext/iv IS NULL`) | `:56-57` (no delivered-null predicate) | `:138-141` (no delivered-null predicate) | `:97` (no delivered-null predicate) | **P** with one real param |
| escalation | `:54-55` | `:58-59` | `:145-146` | `:98-99` | **I** `escalateSupplierManual(db,code,supplier,id)` |
| preflight retry | `retryPreflight` `:59-64` (5 preflight attempts) | none | none | none | **D** (AIVault only) |
| job requeue on completion | `:113` (after delivery) | `:117` | `:329-331` | inside `settle` *before* link update `:92` | **P** SQL, **D** placement |

### 1d. RETRYABLE_SQL / admin retry

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| retryable SQL | `:19-26` | `:28-34` | `:65-72` | `:10-22` (+`AUTO_RECOVERY_SQL :23-26`) | **P** skeleton |
| provider-null columns | `provider_order_id` | `provider_order_id` | `provider_order_code` | `provider_order_group`, `provider_batch_id`, `provider_order_code` | **D** |
| receipt-null columns | ciphertext, iv | ciphertext, iv | ciphertext, iv | ciphertext, iv, http_status, json | **P** |
| retryable error list | quote_unavailable, stock_unavailable, insufficient_balance, price_conflict, price_increased, preflight_unavailable | quote_unavailable, stock_unavailable, blocked_balance, price_increased, preflight_unavailable | package_unavailable, stock_unavailable, insufficient_balance, balance_unavailable, package_quantity_invalid, price_increased, preflight_unavailable | insufficient_balance, balance_unavailable, catalog_unavailable, stock_unavailable, buff_unavailable, cost_changed, dispatch_unconfirmed | **D** semantics |
| fulfillment binding predicate | `:24-25` (6 unowned cols) | `:34` (6 unowned cols) | `:70-71` | `:18-20` (6 unowned cols) | **P** |
| retry function | `:194-198` | `:244-249` | `:625-636` | `:259-265` | **P**; AIVault additionally resets `preflight_attempts=0` |

### 1e. Accept / seal / deliver / rebind / requeue

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| receipt seal to link | `saveReceipt :68-72` | `:66-70` | `:177-193` | inline `:245-247` | **P**; **D** TUNVN |
| provider parse/accept | `interpret :81-115` | `acceptOrder :86-121` + `recover :123-147` | `interpret :223-335` | `finishReceipt :136-165`, `pollBuff :167-190` | **D** |
| credential seal | `:107-114` (`\n\n`) | `:112-118` (`\n\n`, Muse = null) | `:305-322` (`\n`) | `:148-152` (`\n\n`) | **P** skeleton, **D** separator/buff |
| fulfillment rebind | `:134-135` (`id`, `OR aivault_link_id=?`) | `:166-168` (+ product/variant/qty + ownerGuard) | `:415-424` | create-time bind `:85-86` + `:215` (`tunvn_link_id IS NULL`, no OR-equal) | **P**; **D** TUNVN |
| requeue jobs SQL | `:113` | `:117` | `:329-331` | `:92` | **I** SQL |

### 1f. Process loop / deadline / limit

| Fragment | AIVault | StoreBat | Mirai | TUNVN | Class |
|---|---|---|---|---|---|
| entry guards | `:202` `canSpend(35)` | `:253` `canSpend(33)` | `:640` `canSpend(35)` | `:268-270` `canSpend(30)` | **P** |
| orphan query | `:209-232` (+`canSpend(30)`) | `:255-262` (+`canSpend(30)`) | `:642-657` (+`canSpend(30)`) | `:268-307` (+`canSpend(30)`, skipped on reconcile) | **D** predicates/skeleton |
| due query | `:233-234` (`canSpend(25)`) | `:263-264` (`canSpend(27)`) | `:669-673` (`canSpend(25)`) | `:308-309` (`canSpend(30)`) | **P**; TUNVN adds reconcile/AUTO_RECOVERY branch |
| loop / limit | `:235-243`, 8/run | `:265-273`, 8/run | `:674-686`, 8/run | `:310-319`, 8/run, reconcile limit=1 | **P**; **D** reconcile |
| rate-limited break | `:241-242` | `:271-272` | `:684-685` | `:317-318` | **I** |

### 1g. Copied logic outside `orders.ts` (non-goals for #4)

| Area | Files | Class / note |
|---|---|---|
| transport config/helpers (`record`, `numeric`, base URL, 15s timeout, `redirect:"manual"`) | `aivault/client.ts:2-22`, `storebat/client.ts:2-32`, `mirai/client.ts:2-31,104-105`, `tunvn/client.ts:39-146` | **P**; endpoints/parsers differ. Non-goal. |
| purchase request builders | `aivault/purchase.ts:5-11`, `storebat/purchase.ts:4-8`, `mirai/purchase.ts:50-64`, `tunvn/purchase.ts:22-39` | **P** skeleton. Non-goal. |
| family/slug fallback + FNV hash + sell price | `aivault/families.ts:26-40`, `mirai/families.ts:65-129`, `storebat/families.ts:79-81` (imports AIVault), `tunvn/families.ts:179-202` | copied. Non-goal (pricing/copy). |
| markup + `operation_guards` batch | `aivault/markup.ts:95-172`, `storebat/markup.ts:82-116`, `mirai/markup.ts:75-126`, `tunvn/markup.ts:175-343` | copied. Non-goal. |
| sync throttle CAS + chunked `json_each` upsert | `aivault/sync.ts:1-43`, `storebat/sync.ts:15-47`, `mirai/sync.ts:12-152`, `tunvn/sync.ts:40-132` | copied. Non-goal. |
| catalog publish / parent refresh / SKU SQL | supplier `catalog.ts` files | non-goal. |

## 2. Proposed shared module API

`src/lib/suppliers/link-lease.ts`. Tier 1 is what refactor #4 needs; Tier 2 is optional follow-up (separate commits, only if the team wants more dedup). No classes, no framework, no dynamic SQL builder.

### Tier 1 — paid fragment + claim CAS (refactor #4)

```ts
export type SupplierLinkKey = "aivault" | "storebat" | "mirai" | "tunvn";

/** JS form of the four identical paid gates. */
export function isPaidOrder(row: Record<string, unknown>): boolean;

/** Unqualified columns: `... FROM orders WHERE ${PAID_ORDER_SQL}`. */
export const PAID_ORDER_SQL: string;
/** `o.`-qualified: `... FROM orders o WHERE ${PAID_ORDER_SQL_ALIASED}`. */
export const PAID_ORDER_SQL_ALIASED: string;

export type LinkTableConfig = {
  readonly table:
    | "aivault_order_links"
    | "storebat_order_links"
    | "mirai_order_links"
    | "tunvn_order_links";
  readonly claimStatusSql: string;                 // "'claimed'" | tunvn CASE
  readonly claimStatusParams: readonly unknown[];  // [] | [0] / [1]
  readonly claimWhereSql: string;                  // common due predicate | tunvn AUTO_RECOVERY
  readonly claimWhereParams: readonly unknown[];
};

export const LINK_TABLES: Readonly<Record<SupplierLinkKey, LinkTableConfig>>;
export const TUNVN_RECONCILE: LinkTableConfig;      // same table, reconcile WHERE

/** One UPDATE. Returns the owner when claimed, null otherwise. */
export async function claimLink(
  db: DatabaseAccess,
  cfg: LinkTableConfig,
  id: number,
  owner: string = crypto.randomUUID(),
): Promise<string | null>;
```

`claimLink` emits exactly:

```sql
UPDATE ${cfg.table}
SET lease_owner=?, lease_expires_at=datetime('now','+90 seconds'), status=${cfg.claimStatusSql}
WHERE id=? AND ${cfg.claimWhereSql}
```

Bind order: `owner, ...cfg.claimStatusParams, id, ...cfg.claimWhereParams`. For AV/SB/MR the config is the common due predicate; for TUNVN, `claimWhereSql` carries the existing `AUTO_RECOVERY_SQL`/reconcile text and `claimStatusParams=[reconcile?1:0]`.

**Why each parameter exists (real difference, not speculative):**
- `table` — four different link tables; no shared name today.
- `claimStatusSql` + `claimStatusParams` — TUNVN is the only supplier that must preserve an existing `processing` state and force `processing` on reconcile (`orders.ts:194`); the other three always write `'claimed'`.
- `claimWhereSql` + `claimWhereParams` — TUNVN is the only one with an `OR AUTO_RECOVERY_SQL` branch and a reconcile predicate (`:195`); injecting it keeps the shared helper honest.
- `owner` argument — all four call `crypto.randomUUID()` today; leaving the default in place preserves behavior and lets the characterization tests inject a fixed owner if ever needed.

### Tier 2 — optional follow-ups (not required for #4)

```ts
export type OwnerFenceMode = "claimed_unexpired" | "not_completed" | "lease_owner";
export function ownerFence(cfg: Pick<LinkTableConfig, "table">, mode: OwnerFenceMode): string;

export type RetryableConfig = {
  readonly table: LinkTableConfig["table"];
  readonly providerNullSql: string;
  readonly receiptNullSql: string;
  readonly retryableErrorsSql: string;
  readonly fulfillmentBindingSql: string;
};
export function retryableWhereSql(cfg: RetryableConfig): string;

export type SettleConfig = LinkTableConfig & {
  readonly nextAttemptSql: string;            // literal chosen by supplier
  readonly requireClaimedUnexpired: boolean;  // StoreBat true
  readonly needsAdminItemExtraSql: string;    // AIVault delivered_* IS NULL
  readonly requeueJobsBeforeSettle: boolean;  // TUNVN true
};
export async function settleOwned(
  db: DatabaseAccess,
  cfg: SettleConfig,
  link: Record<string, unknown>,
  outcome: { status: "pending" | "processing" | "completed" | "needs_admin"; error: string | null },
): Promise<boolean>;

export async function requeueFulfillmentJobs(db: DatabaseAccess, orderCode: string): Promise<void>;

export type DeliverConfig = {
  readonly table: LinkTableConfig["table"];
  readonly linkColumn: "aivault_link_id" | "storebat_link_id" | "mirai_link_id" | "tunvn_link_id";
  readonly unownedSql: string;
};
export async function deliverSealedCredentials(
  db: DatabaseAccess,
  cfg: DeliverConfig,
  link: Record<string, unknown>,
  ciphertext: string | null,
  iv: string | null,
): Promise<boolean>;
```

Tier-2 params are justified by observed differences: `ownerFence` must preserve TUNVN's bare `id+owner` writes (`tunvn/orders.ts:145,149,162,183`); `SettleConfig.nextAttemptSql` covers four different backoff formulas; `requireClaimedUnexpired` is StoreBat's stricter guard (`storebat/orders.ts:54,71`); `needsAdminItemExtraSql` is AIVault's extra delivered-null predicate (`aivault/orders.ts:53`); `requeueJobsBeforeSettle` is TUNVN's placement in `settle` (`tunvn/orders.ts:92`); `providerNullSql`/`receiptNullSql`/`retryableErrorsSql` encode the concrete column and error-list differences in 1d.

**What stays per supplier:** eligibility snapshots, preflight/quotes/balance, receipt identity parsing and status mapping, provider transport, Muse Buff, TUNVN reconcile/buff polling, AIVault `retryPreflight`, all error-code selection, and every call-site ordering (e.g. StoreBat's `recover` before replay).

## 3. SQL safety (identifiers)

- The only identifiers that may be interpolated are module-level literals: the four table names in `LinkTableConfig["table"]` (a closed union), and literal fragments inside `LINK_TABLES` / `TUNVN_RECONCILE`.
- Callers pass a `LinkTableConfig` object, never a string. They select it with a compile-time key: `LINK_TABLES[supplier]` where `supplier: SupplierLinkKey`; TypeScript rejects arbitrary strings. TUNVN reconcile passes the exported `TUNVN_RECONCILE` constant, not a constructed value.
- No request/auth/admin input ever reaches `cfg.table`, `claimStatusSql`, or `claimWhereSql`. Today none of these functions take table names from input either; the refactor keeps that true by construction.
- All runtime values (`id`, `owner`, TUNVN `reconcile ? 1 : 0`) remain bound `?` parameters. `next_attempt`/backoff values already bind their delay in StoreBat/Mirai; keep that (no string-built numbers).
- Add a tiny unit test (plain Vitest) asserting `Object.keys(LINK_TABLES)` and `.table` values equal the four literals; this is a cheap guard against a future "dynamic table" change.

## 4. Migration order, verification, and statement/budget parity

Order by risk (lowest first), one supplier per commit:

1. **AIVault** — plain claim CAS, simplest owner fences, 61 tests + workerd.
2. **Mirai** — identical claim CAS; no Muse/lookup branch in dispatch; slightly heavier preflight.
3. **StoreBat** — same claim CAS, but `ownerGuard` is used in more places and Muse Buff/lookup recovery exist.
4. **TUNVN** — genuinely different claim (`CASE`, `AUTO_RECOVERY`, reconcile), post-send no-replay, buff polling. Last.

Per commit (replace only `paid`/`PAID` + claim UPDATE in that supplier; leave settle/owner guards untouched until Tier 2):
```bash
npx vitest run tests/characterization/small-suppliers-claim.test.ts \
  tests/<supplier>-orders.test.ts tests/<supplier>.workerd.test.ts tests/supplier-dispatch.workerd.test.ts
npx tsc --noEmit -p .
```
Use `tests/tunvn-orders.workerd.test.ts` for TUNVN. After all four, PM runs the full suite before push.

### Statement counts today (measured on ad711d6f)

Throwaway harness using `createD1Fixture().control.queries` (every prepared statement = 1, batch members = 1), `processXOrders(db,{orderCode})`, one paid order/link, no crash:

| Path | AIVault | StoreBat | Mirai | TUNVN |
|---|---|---|---|---|
| `create*Links` (1 call) | 2 | 2 | 2 | 3 |
| `process*Orders` success total | 21 | 21 | 21 | 23 |
|  — internal createLinks repeat | 2 | 2 | 2 | 3 |
|  — due SELECT | 1 | 1 | 1 | 1 |
|  — `processLink` | 18 | 18 | 18 | 19 |
| `process*Orders` retryable POST total | 18 | 18 | 18 | 23 |
|  — `processLink` | 15 | 15 | 15 | 19 |

Caveat: preflight-failure paths differ (AIVault `retryPreflight`, StoreBat balance lookup, Mirai packages+balance, TUNVN catalog+balance). Counts above are the success path and the post-POST retryable path. `retry*Order` adds exactly one UPDATE before calling `processLink` (AV `:196`, SB `:246`, MR `:629`, TV `:261`), so retry success = processLink + 1.

Budget guards that must not move: `db.canSpend()` admissions at AV create 5 (`:28`), process 35/30/25; SB create 3 (`:37`), process 33/30/27; MR create 5, process 35/30/25; TV create 5, process 30/30/30. Existing tick tests pin the ceiling: `tests/aivault-orders.test.ts:17`, `tests/storebat-orders.test.ts:19`, `tests/mirai-orders.test.ts:41-43`, `tests/tunvn-orders.test.ts:81,201,301` (`createBudgetedDatabase(40,2)`, `used <= 38`).

Requirements for the refactor:
- `claimLink` must stay exactly one UPDATE (same statement count; no SELECT before claim).
- `PAID_ORDER_SQL` must be inlined inside existing queries, not add a round-trip.
- Do not change D1 batch composition: `escalateSupplierManual` uses a 2-statement `db.d1.batch` (`supplier-escalation.ts:24-30`); keep it batched, do not split or serialize.
- Do not add/remove `canSpend` checks; cron relies on them to stop mid-batch.
- Preserve bind order/count exactly (`tests/helpers/d1-fixture.ts` throws on mismatch).

## 5. Explicit NON-goals

- Catalog sync (`sync.ts`), catalog publish/upsert (`catalog.ts`), parent-refresh/SKU SQL.
- Pricing, markup (`markup.ts`, `bulk.ts`, `pricing.ts`, `families.ts` sell price), family mapping/slugs/copy (`copy.ts`, labels, descriptions).
- Client transport/parsers (`client.ts`), purchase request builders (`purchase.ts`), provider receipt/identity semantics.
- Retry/backoff formulas, error-code taxonomy, needs_admin escalation policy, fulfillment delivery pipeline, notifications.
- Admin routes/UI, cron orchestration, schema/migrations, WR/SK, Games/Pedia/Temp-mail.
- Telegram/WhatsApp integration.
- Tier-2 helpers are out of scope for #4 unless explicitly chartered.

## 6. Risks and coverage

| Risk | Caught by |
|---|---|
| Claim CAS loses `next_attempt`/lease predicates | suite `does not claim … future next_attempt_at`, `… unexpired lease` |
| Claim stops reclaiming expired leases | suite `reclaims a link whose lease has expired` |
| Two workers double-claim | suite `claims one due link once under two concurrent process calls` |
| Owner fence lost / wrong mode | suite `does not settle or deliver for an owner whose lease was taken over mid-flight` |
| Paid fragment changes admission | suite `creates links only for a paid order …` |
| Backoff stops clearing lease / next_attempt | suite `backs off and clears the lease after a retryable supplier failure` |
| Exhaustion path weakens | suite `moves an attempts-exhausted link to needs_admin …` |
| Retry re-arms after send/provider | suite retry matrix (10 cases) incl. `request_sent_at`, provider id |
| Success path loses sealing/requeue | suite `completes a link, clears the lease, seals credentials …` |
| TUNVN claim CASE/AUTO_RECOVERY broken | suite expired-lease/concurrency/retry; plus `tests/tunvn-orders.test.ts` reclaim/reconcile cases |
| Statement budget / D1 batch changed | **not** covered by the suite (it uses unbudgeted `createDatabaseAccess`); existing `used<=38` tests catch only a ceiling breach. See gaps. |

### Gaps that need a test before migrating

1. **Exact statement-count parity** for `create*Links`, `process*` success/failure, and `retry*` per supplier. The suite never counts statements; existing tests only assert `used <= 38`. Add a test using `f.control.queries` deltas (as measured above) so a helper that adds a SELECT/UPDATE fails.
2. **Lease-expired-but-same-owner settle.** The suite mutates `lease_owner` (takeover), not expiry alone. Today StoreBat's `ownerGuard` refuses (`storebat/orders.ts:54,71`), while AIVault/Mirai/TUNVN `settle` only check `lease_owner` and `status!='completed'` (`aivault:50`, `mirai:127`, `tunvn:94`). Pin this asymmetry before touching settle.
3. **Paid order on a non-web/telegram channel → 0 links.** Suite covers unpaid/unknown payment, not channel. Important because TUNVN's create SQL omits `sales_channel` (`tunvn/orders.ts:81`) and relies on JS `paid()` (`:40`); adopting the shared fragment must not change the result.
4. **TUNVN `reconcileId` path** (claim WHERE, `status=CASE…`, limit=1, no orphan query) — only `tests/tunvn-orders.test.ts` admin-reconcile cases cover it; the contract suite does not.
5. **StoreBat Muse Buff** (`kind='muse_buff'`, invite ciphertext/fence, `/muse-buff/orders/{id}` GET, refund) — the adapter exercises `kind='product'` only; rely on `tests/storebat-orders.test.ts` Muse tests, but add a contract case if Tier-2 `deliverSealedCredentials` touches the null-credential path.
6. **Rate-limited early break** (`res.rateLimited` stops the batch) per supplier — not in the suite; existing 429 tests cover AIVault/TUNVN quote/catalog, not all four loops.
7. **Deadline ordering** (`dispatch_deferred`/`poll_deferred` before send) and `limit` clamping — not in the suite.
