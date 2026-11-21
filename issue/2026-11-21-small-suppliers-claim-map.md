# Cakupan characterization test 4 supplier kecil (2026-11-21)

Sumber: CT-A. Test: `tests/characterization/small-suppliers-claim.test.ts` (describe.each AIVault/StoreBat/Mirai/TUNVN) — suite kontrak untuk refactor #4.


Task: CT-A, writer (tests only). Branch main @579ae1a4 (clean). No `src/`, schema, scripts, package or existing-test edits. Only new file(s).

## Deliverable

- `tests/characterization/small-suppliers-claim.test.ts` — one `describe.each` contract suite over an adapter table for AIVault, Storebat, Mirai, TUNVN (20 tests × 4 suppliers = 80).
- Adapter table encodes per-supplier seed, link table, provider column, mock fetch (ok/retryable/preflight), purchase counter and row accessors.

## Orientation (axgraph, required)

`~/.local/bin/axgraph affected "<path>::<symbol>()" --depth 1` for `retryAivaultOrder()`, `retryStorebatOrder()`, `retryMiraiOrder()`, `retryTunvnOrder()` shows each is called by its admin route (`src/app/api/admin/{aivault,storebat,mirai,tunvn}/orders/route.ts` POST) and imported by the supplier order tests. The suite calls the lib-level retry entry points those routes delegate to.

## Coverage map (invariant → existing test or new test)

New = `tests/characterization/small-suppliers-claim.test.ts`.
Existing names are shortened but verbatim enough to locate (`grep -n`).

| # | Invariant | AIVault | Storebat | Mirai | TUNVN |
|---|---|---|---|---|---|
| 1 | Paid gating + create idempotency | EXISTING `aivault-orders`: “never buys unpaid/disabled/wrong_sku/…” (it.each); NEW contract test 1 | EXISTING `storebat-orders`: “blocks missing snapshot, unpaid order, …”; NEW test 1 | EXISTING `mirai-orders`: “never buys %s” (unpaid); NEW test 1 | EXISTING `tunvn-orders`: “does not buy %s” (unpaid) + “competing workers and paid replays produce one link and one POST”; NEW test 1 |
| 2 | Two concurrent processes → one POST | EXISTING `aivault-orders`: “competing ticks buy once, seal full receipts …”; NEW test 2 | EXISTING `storebat-orders`: “concurrent paid passes fence a single purchase …”; NEW test 2 | EXISTING `mirai-orders`: “buys N codes once under concurrent ticks …”; NEW test 2 | EXISTING `tunvn-orders`: “competing workers and paid replays …”; NEW test 2 |
| 3a | Future `next_attempt_at` not claimed | NEW test 3 | NEW test 3 | NEW test 3 | NEW test 3 |
| 3b | Unexpired foreign lease not claimed | NEW test 4 | NEW test 4 | NEW test 4 | NEW test 4 |
| 4 | Expired lease reclaimable | NEW test 5 | NEW test 5 | NEW test 5 | EXISTING `tunvn-orders`: “reclaims an expired pre-send lease”; NEW test 5 |
| 5 | Stale/taken-over owner cannot settle/deliver | NEW test 6 | NEW test 6 | NEW test 6 | NEW test 6 |
| 6a | Retryable failure → attempt++, lease cleared, future backoff | EXISTING `aivault-orders`: “timeout retries the SAME external ID …” / “momentary stock 0 auto-retries …”; NEW test 7 | EXISTING `storebat-orders`: “polls pending no earlier than next tick …” (scheduling) and replay tests; NEW test 7 | EXISTING `mirai-orders`: “honors Retry-After on 429 …”; NEW test 7 | EXISTING only covers post-send fencing (“does not replay HTTP %i”) + pre-send auto-recovery; NEW test 7 |
| 6b | Attempts exhausted → needs_admin, lease cleared | EXISTING `aivault-orders`: “%s exhausts at three total attempts”; NEW test 8 | EXISTING `storebat-orders`: “%s only replays exact body after failed_no_charge, max 3”; NEW test 8 | EXISTING `mirai-orders`: “honors Retry-After … exhausts at max 3”; NEW test 8 | NEW test 8 (TUNVN cannot reach 3 POSTs; the guard `attempt_count>=3` is exercised directly) |
| 7 | Success: completed, lease cleared, provider id, sealed credentials, fulfillment requeued | EXISTING `aivault-orders`: “competing ticks …” and “accepts the live HTTP201 first-send shape …”; NEW test 9 | EXISTING `storebat-orders`: “concurrent paid passes fence …”; NEW test 9 | EXISTING `mirai-orders`: “buys N codes once …”; NEW test 9 | EXISTING `tunvn-orders`: “competing workers …” and “encrypts all partial and extra accounts …”; NEW test 9 |
| 8a | Admin retry re-arms a retryable pre-send needs_admin | EXISTING `aivault-orders`: “admin can retry a pre-send balance failure …”; NEW test 10 | EXISTING `storebat-orders`: “admin can retry only pre-send balance failure …”; NEW test 10 | EXISTING `mirai-orders`: “preflight fails safely … allows admin retry only pre-send”; NEW test 10 | EXISTING `tunvn-orders` “safe admin retry” + “retries a legacy cost_changed …”; NEW test 10 |
| 8b | Retry refuses on ANY violated condition (10 cases) | EXISTING `aivault-orders`: “HTTP %s stops safely” (retry false after send); NEW violation matrix | EXISTING `storebat-orders`: “status %s needs admin and forbids retry after send”; NEW violation matrix | EXISTING `mirai-orders`: “HTTP %s … no retry storm”; NEW violation matrix | EXISTING `tunvn-orders`: `it.each([...12 changes...])("refuses retry with %s")`; NEW matrix re-pins uniformly |

Decision: the contract suite intentionally re-pins some behavior already covered per supplier. That is the point of the requested single adapter-driven suite: after refactor #4, one run must prove all four suppliers still satisfy the same contract. No supplier-specific test was edited or expanded beyond this single new file.

## Per-supplier differences encoded in the adapter (not skipped)

- **Provider column**: AIVault/Storebat `provider_order_id` (Storebat numeric 21), Mirai `provider_order_code`, TUNVN `provider_order_group`.
- **TUNVN post-send failure**: a retryable HTTP 5xx after the send fence settles `needs_admin` (`incomplete_receipt`) instead of `pending/processing`; TUNVN never replays after `request_sent_at`. Test 7 therefore asserts the shared invariants (attempt_count 1, `request_sent_at` set, lease cleared, `next_attempt_at` future, last_error set) without asserting a specific retry status.
- **TUNVN exhaustion**: reached through the explicit `attempt_count>=3` guard because TUNVN has no 3-attempt POST loop; test 8 seeds `attempt_count=3` with no `request_sent_at`.
- **Storebat exhaustion**: the guard test lands `needs_admin` via the send-fence/`send_guard_changed` path rather than `attempts_exhausted`; test 8 asserts only status/attempt/lease.
- **Storebat kind**: the adapter exercises `kind='product'`; Muse Buff (`kind='muse_buff'`, invite sealing, GET polling) is left to existing `storebat-orders` “Muse pending polls %s …”. A second adapter entry would be the natural follow-up if buff is touched by the refactor.
- **Mirai pricing/stock preflight** uses VND/USDT (`miraiCostUsdtFromVnd(76000)=2.923077`) and `mirai_packages`; **AIVault** uses USD quote + 2% cap; **Storebat** uses USD quote/total + wallet balance; **TUNVN** uses catalog price_usdt + USDT balance. Each adapter’s mock returns valid shapes for its own preflight.
- **Binding timing**: TUNVN `create*Links` binds `fulfillment_items.tunvn_link_id` directly; AIVault/Storebat/Mirai bind inside `processLink`. Tests always create the link before processing, so all four reach the same observable state.

## Commands and actual results

- `npx vitest run tests/characterization/small-suppliers-claim.test.ts` → **80 passed / 80** (1 file).
- `npx vitest run tests/aivault-orders.test.ts tests/storebat-orders.test.ts tests/mirai-orders.test.ts tests/tunvn-orders.test.ts tests/tunvn-orders.workerd.test.ts tests/supplier-dispatch.workerd.test.ts tests/aivault-immediate-delivery.test.ts tests/storebat-immediate-delivery.test.ts tests/mirai-immediate-delivery.test.ts tests/tunvn-immediate-delivery.test.ts tests/fulfillment-lease.integration.test.ts` → **270 passed / 270**, 11 files passed.
- `npx tsc --noEmit -p .` → exit 0 (no output).
- `git status --short` → only `?? tests/characterization/`; `git diff --stat` empty. No `src/`, schema, scripts, package, CHANGELOG or docs edits. No commit/push/deploy.

## Open risks / suspected bugs

- None. No invariant looked violated; no `it.todo("BUG? …")` left.

## Cleanup

- No servers, terminals, browser tabs, background tasks or scratch files created. Only the deliverable test file and this evidence file were written. The read-only `axgraph` invocation exited normally.
