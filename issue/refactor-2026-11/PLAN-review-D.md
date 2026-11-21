> Review independen atas draf `issue/2026-11-21-refactor-roadmap.md` (21 Nov 2026). Koreksinya sudah dimasukkan ke versi yang di-commit; baris yang dirujuk adalah baris draf.

# PLAN-REVIEW-D — review of `issue/2026-11-21-refactor-roadmap.md`

Reviewer D. Read-only. Base `ad711d6f`. Doc reviewed as uncommitted at 334 lines.
Sources checked: `AGENTS.md`, `docs/agent-rules/{platform-ops,supplier-wr-sk,payments,admin-security,buyer-credentials}.md`, `docs/ARCHITECTURE.md`, the four maps in `issue/refactor-2026-11/`, `issue/2026-11-21-audit-followups.md`, and the source files the roadmap names.
Emphasis per packet: Phase 3 hotspots, Phase 1 T4–T6 vs MAP-1, the 2A block vs MAP-2.

**Verdict: OK-with-changes.** The ordering spine (T → E → B, one module per commit, characterization gate) is sound and matches all four maps. Nothing here is a rework. There is **one structural defect** (a circular prerequisite between 3B and F1), **one factual error** in §3.10 that an agent would act on, and a set of frozen-contract gaps that admit a real regression in an otherwise "behavior-preserving" step. Fix the blocking items before banking §4.6's "fast" cadence.

Line numbers below are `issue/2026-11-21-refactor-roadmap.md:<line>` unless stated otherwise.

---

## Blocking

### B-1. Circular prerequisite: 3B depends on F1, F1 depends on 3B (§6:200 vs §6:218)

§6:200 — `3B | orders/route.ts → … | M | Prasyarat F1.`
§6:218 — `F1 | placeOrder(actor, lines, paymentInstruction) … | 3B, T5 + characterization web+TG | D3`

Both directions are stated, so no agent can start either. Read literally, Fase 3 cannot begin 3B until Fase 4 ships F1, and Fase 4 cannot begin F1 until 3B ships.

What is actually true (MAP-1 (d)§6, and `src/app/api/orders/route.ts:171-635`): 3B is a mechanical split of the handler into `checkout/*` modules; F1 is a *new* `placeOrder` service that the split route then delegates to. So 3B must come first, and F1's prerequisite should be `3B + T5`, not the reverse.

**Replacement text** for §6:200 `Catatan wajib` column:
> `Prasyarat T5. Menjadi prasyarat F1 (bukan sebaliknya): setelah 3B, handler `POST` menjadi thin wrapper yang nanti memanggil `placeOrder`. Handler `POST`/`GET` tetap di route (thin wrapper, bukan `export {…} from`). Slot checkout tetap tanpa budget.`

And for §6:218 `Prasyarat` column: `3B, T5` stays — but add one clause so the direction is unambiguous:
> `3B (selesai), T5 + characterization web+TG`

### B-2. §3.10 states a wrong test count and, worse, invites the wrong reading

§3:70 — "`src/app/api/orders/route.ts` tetap mengekspor `POST`/`GET` di path yang sama **(40 file test mengimpornya)**".

Measured on `ad711d6f`:
- test files that actually import the module (`from "@/app/api/orders/route"` or `import("@/app/api/orders/route")`) = **27**
- test files that merely mention the path string (`readFileSync("src/app/api/orders/route.ts")` or a substring assertion in the same file) = **39**

(The exact `POST` vs `GET` split is not cleanly attributable per file because several tests import both handlers from *other* routes in the same file; the two totals above are the defensible numbers.)

The number matters because it is the justification for "keep the export here". The weaker count still supports the constraint, but a wrong count in a frozen contract invites an agent to conclude the rule is negotiable when they hit a file that only greps the text. (Origin: MAP-1 carries the same overstated "40 test files import here" at `MAP-1-hotspots.md:431,464,484` — the roadmap inherited it. Fix both, or say "27 import / 39 read as text".)

**Replacement text** for §3:70:
> `10. `src/app/api/orders/route.ts` tetap mengekspor `POST`/`GET` di path yang sama (27 file test mengimpor modul ini; 39 file membaca path sebagai teks). GET tetap kompatibel dengan `orders/lookup` (7 field respons identik: `credentials_ready`, `supplier_owned`, `supplier_running`, `unique_units_progress`, `qris_reissue_allowed`, `automatic_progress`, `fulfillment_status`).`

Consequence if unfixed: an agent splitting 3B trusts "40", checks off 27, and may also "clean up" `orders/lookup` while they are there — which is exactly the cross-screen drift the doc exists to prevent.

### B-3. §3 misses the destructive-guard and diff-mode invariants of `sync.ts` (a 3D agent can break the catalog)

§3.5–§3.10 (:57-71) covers budgets, import isolation, job names, proxy slice order, the barrel, and the two route exports. For 3D (WR `sync.ts`, size **L**, 7 commits) the genuinely destructive invariants are absent:

1. **Zero-missing is only legal after a full sweep validated in this run.** `src/lib/warung-rebahan/sync.ts:1372` (`fullSweepInThisRun = sweepComplete && startAt === 0`) and 1393-1413 gate `zeroMissingVariants`. A stage-level split that resets `startAt`, or that moves the zeroing call out of the `sweepComplete` branch, silently zeroes ~60 variants that the run never saw. This is the single highest-blast-radius invariant in the file — `MAP-1-hotspots.md` calls it "DESTRUCTIVE GUARD" (line 10-11, 1393-1395).
2. **Diff mode (`applyOnly`) must never write `*_sync_log`.** `sync.ts:1342-1345`. It is deliberate and undocumented outside the code comment; the admin card reads sweep logs only.
3. **`raiseCeilingForCatalogSync(+800)` mutates the caller's budget ceiling in place** (`sync.ts:1157-1158`, hook at `src/lib/db-access.ts:86-90`). Re-wrapping the `DatabaseAccess` inside a new module turns the +800 into a no-op and makes 48-product sweeps budget-yield into partials forever (~90 min to refresh a 48-product catalog; `ARCHITECTURE.md` §16.6).
4. **Write-quota `IS NOT` predicates** are behavior, not style: a sweep without upstream changes must write ~12 rows, not 398 (`ARCHITECTURE.md` §16.6; guarded by `tests/warung-rebahan/sync-write-quota.regression.test.ts`). Dropping one predicate in a moved `UPDATE` re-inflates D1 writes ~33×.

**Replacement text** — add to §3 after item 10:
> `10a. WR/Jaspay sync: zero-missing HANYA boleh dieksekusi bila sweep penuh tervalidasi DALAM run itu (`startAt===0 && sweepComplete`) atau bila slice terakhir membawa daftar id otoritatif; pemecahan tahap tidak boleh me-reset cursor/startAt atau memindah panggilan zero-missing keluar dari cabang sweepComplete.`
> `10b. Mode diff (`applyOnly` dari `POST /api/supplier-sync`) tidak menulis `wr_sync_log`/`sk_sync_log`; ia hanya menulis `diff_last_at`/`diff_last_change*`/`diff_last_error` di state.`
> `10c. `raiseCeilingForCatalogSync` adalah hook pada objek `DatabaseAccess` pemanggil (+800 statement khusus sync katalog). Modul hasil ekstraksi wajib memakai objek akses yang sama; membungkus ulang akses = plafon hilang = sweep selalu parsial.`
> `10d. Predikat `IS NOT` pada setiap UPDATE sync adalah kontrak kuota tulis D1 (~12 baris per sweep tanpa perubahan). Jangan menyederhanakan UPDATE saat memindahnya.`

### B-4. T4 and T6 are under-specified relative to the gaps they must close

§6:152 — T4 "`Snapshot golden results cron operations + gap per job cron/lite (termasuk asimetri publish katalog 4 supplier)`"; §6:153 — T6 covers WR `sync.ts` per tahap + `SupplierAdminPanel`.

Against MAP-1, that instruction is not executable:

- **(c)§5 gap 6 is the whole point of T4 and is not stated.** The only way a 1,344-line handler split can be proven behavior-preserving is "snapshot the **full** `results` object per phase for a fixed fixture". Measured on `ad711d6f`: the object carries **72 distinct keys** — 33 initialized in the skeleton (`src/app/api/cron/operations/route.ts:239-282`) plus 39 assigned by phases (`results.<key> =`), e.g. `wr_sync_resume`, `sk_credential_emails_sent`, `checkout_pin_emails_sent`, `qris_expiry_notifications`. Today only 3 keys have any test (`query_budget_used`: `tests/cron-budget.integration.test.ts:128`, `tests/rr5-remediation.integration.test.ts:178,230`). An agent told only "snapshot golden results" can reasonably snapshot 5 interesting keys and call T4 done.
- **(a)§5 gaps 2, 3, 4 are not named**: prefetch chunking above 50 ids (`sync.ts:155`), `runWrites` batch-fail→sequential fallback tolerance (`sync.ts:114-147`), and `refreshAllParentAggregates` having **zero** tests (`sync.ts:1471-1481`, 0 external refs).
- **`syncProducts` budget test exists and is the T6 baseline** but is not cited: `tests/warung-rebahan/sync.test.ts:472` ("Opsi A: 48 produk tuntas SATU sweep") + `sync-time-budget.regression.test.ts:75`.
- **(e)§5 lists 5 specific gaps** (`runWrSkSync` status matrix, `applyBulkMarkup` partial-failure copy, `runSandbox`, `loadStandard` per-section errors, pagination clamp). T6 says only "gap `SupplierAdminPanel` (`admin-stability` canary)", which an agent can satisfy with the existing canary alone and skip all five.

**Replacement text** for §6:152-153:
> `| T4 | (i) Snapshot golden SELURUH objek `results` cron operations — 72 kunci terukur (33 di skeleton `route.ts:239-282` + 39 di-assign fase), bukan subset; (ii) matriks "kapan `cron_lite_<job>_ok_at` TIDAK ditulis" untuk semua job inti; (iii) asimetri publish katalog 4 supplier: `storebat_catalog` `!("unchanged" in synced)` vs 3 lainnya, dan `mirai/storebat` 503-on-!ok vs `tunvn/aivault` lanjut; (iv) `sampleWhatsAppGateway` (3 nilai sampel + guard 5 menit) & nested 400-budget `processBroadcasts` | MAP-1 (b)§5 gap 1-6, (c)§5 gap 1-6 | 3A, 3C |`
> `| T6 | (i) WR `sync.ts` per tahap: cursor resume, zero-missing hanya pada sweep penuh, prefetch >50 id, `runWrites` batch-gagal→fallback, `refreshAllParentAggregates` (0 test), `bumpCatalogRevision` hanya-saat-berubah, `applyOnly` tanpa `*_sync_log`; (ii) `SupplierAdminPanel`: matriks 3 pesan `runWrSkSync`, copy gagal-sebagian `applyBulkMarkup`, `runSandbox`, `loadErrors` per seksi, clamp pagination | MAP-1 (a)§5 gap 1-6, (e)§5 gap 1-5 | 3D, 3E |`

Without this, T6 can pass green while 3D has no protection on the destructive guard, and T4 can pass green while 3C has no protection on 69 of the 72 response keys.

---

## Should-fix

### S-1. §3 has no invariant for the cron *marker* vocabulary, which several tests assert by name

§3:7 lists job/phase names as strings. It does not list the durable side effects whose names are equally frozen: `cron_lite_<job>_ok_at` (`src/app/api/cron/lite/route.ts:302-308`; asserted in `tests/cron-lite-subjobs.integration.test.ts:92,143`, `tests/telegram-webhook-guard.test.ts:501,530`, `tests/product-copy-review-alert.test.ts:216`), `cron_last_hit_at` / `cron_last_ok_at` (`cron/operations/route.ts:315-320, 1508-1511`). A split that renames the key or writes it in a shared helper with a `job` accumulator changes prod observability and breaks 5 tests.

**Replacement text** — extend §3 item 7:
> `7. Nama job/fase (string, mis. `LITE_JOBS`), path route, bentuk JSON respons, sinyal `more:true`, `RUN_DEADLINE_MS`, auth `CRON_SECRET`, `bumpCatalogRevision` ≤1×/run, dan **kunci penanda** `cron_lite_<job>_ok_at` (hanya sukses, tidak pada 503), `cron_last_hit_at` (setiap run), `cron_last_ok_at` (hanya `?phase=` yang selesai).`

### S-2. The `E` class definition does not mention the two other things that must stay identical

§4 row `E` (:85) defines E as "tanpa mengubah perilaku, statement count, atau urutan panggilan supplier". For 3A/3C/3D that is incomplete:
- **D1 write *row* count** (not statements) is a quota contract (§16.6, 12 vs 398 rows). Covered by B-3's 10d but belongs in the class definition too.
- **Response key *order*** — the `results` object is built literally (`route.ts:239-282`) and returned verbatim; a `deferredOut` → `Set` conversion also changes array order, and `tests/cron-phase-split.integration.test.ts:116,129` compares arrays. MAP-1 (b)§6 flags this; the roadmap does not.

**Replacement text** for the `E` row (:85):
> `**E** (ekstraksi) | Memindah/menyatukan kode tanpa mengubah perilaku, statement count, urutan panggilan supplier, jumlah baris yang ditulis D1, atau urutan kunci/elemen JSON respons.`

### S-3. 3C's `deferredOut`/`activePhases` instruction is right but the ordering hazard is under-stated

§6:201 — "Fase dipindah verbatim dengan `ctx`; urutan `deferredOut` dipertahankan; satu fase per commit, terkecil dulu."

The measured capture counts (`MAP-1-hotspots.md` §b-2) are 13/21/15/20/9/21 outer bindings per phase, and every phase mutates two shared accumulators. "Terkecil dulu" plus "verbatim" is compatible with an agent extracting `runCleanup` (9 captures) first, then discovering the `ctx` shape must change when they reach `runSekalipay` (21 captures) — producing a 6-commit sequence where commit 1's `ctx` is rewritten 4 times. That is mechanical churn in the highest-risk file, and each rewrite is a fresh regression surface.

**Replacement text** — add to §6:201 `Catatan wajib`:
> `Bentuk `OperationsContext` dibekukan di commit pertama berdasarkan capture gabungan keenam fase (MAP-1 (b)§2: budget, database, results, deferredOut, activePhases, hasTime, timeLeftMs, step, counts, flags). Urutan ekstraksi: cleanup → fulfillment → notify → expiry → warung_rebahan → sekalipay; `ctx` tidak boleh berubah bentuk setelah commit ke-2.`

### S-4. 2A is scoped to Tier-1 but the acceptance criterion silently assumes Tier-2 measurements

§6:164-167 — "Modul kecil `src/lib/suppliers/link-lease.ts` (Tier-1 saja: `isPaidOrder`, `PAID_ORDER_SQL`, konfigurasi tabel tertutup, `claimLink`) … Statement count per jalur identik dengan T1/T2. Tier-2 helper opsional, hanya bila terbukti identik."

MAP-2 §4 (measured, `MAP-2-small-suppliers.md:231-247`) gives per-path totals that include Tier-2 code — e.g. `process*Orders` success = 21 (AV/SB/MR) / 23 (TUNVN), of which `processLink` is 18-19. A Tier-1-only change touches only the claim UPDATE inside `processLink`. So the acceptance number an agent will compare against must be the **Tier-1-affected subset**, not the whole-path total; otherwise "identik dengan T1" is unfalsifiable for a Tier-1 commit and an agent may widen scope to make the numbers match.

Also: `link-lease.ts` lives in `src/lib/suppliers/`, which **does not exist yet** (`ls src/lib/suppliers` → not found). Not an error, but the packet should say "folder baru".

**Replacement text** for §6:166:
> `Statement count per jalur **yang tersentuh Tier-1** (claim UPDATE: 1 statement, tanpa SELECT sebelum claim) identik dengan T1/T2; total `process*Orders` (MAP-2 §4: 21/21/21/23) tidak boleh berubah sebagai efek samping. Tier-2 helper opsional, hanya bila terbukti identik, dalam commit terpisah. Modul baru: folder `src/lib/suppliers/` belum ada — buat di commit A1.`

### S-5. `documents to update` is missing for the 5 files whose paths appear in agent-rules

§9 DoD says "`docs/ARCHITECTURE.md` untuk struktur folder/route, `docs/agent-rules/*` untuk aturan". After 3A-3D the moved bodies no longer live at the cited paths, and the rule files cite them by path:

| Rule file | cites |
|---|---|
| `docs/agent-rules/platform-ops.md` | `src/app/api/cron/lite/route.ts`, `src/app/api/cron/operations/route.ts` |
| `docs/agent-rules/supplier-wr-sk.md` | `:64` `src/lib/warung-rebahan/sync.ts` **plus internal function names** `planExistingVariantWrites`, `syncJaspayCatalog`, `planSkCatalogRefreshWrite`; `:129` `zeroVariantsByIds` |
| `docs/agent-rules/payments.md` | `:131` `src/app/api/orders/route.ts:553-570` (**line range**), `:154` path + `crypto-preflight.ts` |

Two extra problems the barrel does not fix:
- **Line-range citations die immediately.** `payments.md:131` points at `orders/route.ts:553-570`, which is the invoice-issuance block that 3B moves to `src/lib/orders/checkout/invoice.ts`. A barrel keeps the *path* valid but the cited lines will hold something else.
- **Internal symbol names move.** `supplier-wr-sk.md:64` names `planExistingVariantWrites` (currently `sync.ts:535`), which 3D relocates to `sync/variant.ts`. Rule text naming a function that no longer exists at that path is a correctness doc that reads as stale.

`docs/ARCHITECTURE.md` references `cron/lite/route.ts` 9×, `cron/operations` 16×, `api/orders/route.ts` 4×, `warung-rebahan/sync.ts` 1×, `SupplierAdminPanel` 1×. Nothing says these citations must be repointed, so a rule could end up pointing at a one-line barrel. Per §3.11 the same logic already applies to tests; extend it to docs.

**Replacement text** — add to §9 DoD:
> - [ ] Setiap path `src/app/api/cron/{lite,operations}/route.ts`, `src/lib/warung-rebahan/sync.ts`, `src/app/api/orders/route.ts`, `src/components/admin/SupplierAdminPanel.tsx` yang dirujuk `docs/agent-rules/*.md` dan `docs/ARCHITECTURE.md` dipindah/diperbarui ke lokasi baru pada commit yang sama (aturan §3.11 juga berlaku untuk dokumen).

### S-6. AGENTS.md conflict: §6/§4.5 says PM commits, but AGENTS.md makes commit+push the default for any code change

`AGENTS.md:70` — "Setelah perubahan kode/dokumentasi, verifikasi sesuai dampak, dan changelog selesai, otomatis commit lalu `git push origin main` … Audit baca-saja tidak menghasilkan commit".

The roadmap's §7:242 says "Writer tidak commit/push; PM yang commit" and §4.5:99 repeats PM-only commit. Within one workspace that is consistent with AGENTS.md (the PM session is the one doing the code change). But the doc never says *whose* push satisfies AGENTS.md, and §4.6:100-102 then adds a CI check that AGENTS.md:71 explicitly forbids ("Begitu `git push` berhasil diterima GitHub, **berhenti**. Jangan memantau/polling").

Two things to state plainly, because agents will read both docs:
1. Writers must never push (roadmap) — fine, but say that a writer's output is a working tree + diff, not a commit, so no agent claims a commit as "done".
2. §4.6 is a *one-shot read at the start of the next money step*, not monitoring — the doc already says this parenthetically at §4:102. Make it a named exception so it cannot be read as "poll CI".

**Replacement text** for §4.6 (first clause):
> `6. **Gerbang langkah jalur uang berikutnya (pengecualian tercatat atas AGENTS.md:71 — satu pembacaan, bukan pemantauan):** di awal langkah berikutnya, baca SEKALI status run `ci.yml` untuk commit rilis sebelumnya; jangan menunggu, jangan polling, jangan mengulang. Gagal → stop, tangani dulu.`

And add to §7:242:
> `Writer tidak commit/push; keluaran writer = working tree + diff + laporan. Hanya sesi PM yang commit+push, memenuhi AGENTS.md:70.`

---

## Nit

### N-1. §6:187 says "kedua `it.todo` H4", but only one `it.todo` exists

§6:187 — "Acceptance: **kedua** `it.todo` H4 jadi test lulus".

Measured: `grep -rn "it.todo" tests/` → exactly one, `tests/characterization/wr-sk-state-machine.test.ts:378`. A full run of `tests/characterization/` yields `51 tests | 2 todo` for that file — so there *are* 2 todo entries, but 1 in source: the second comes from `describe.each(["premium","jaspay"])` at `:315` expanding the single `it.todo` body. MAP-3 §5.4 also says "H4's existing two TODO bodies", which is the expansion, not two sources.

**Replacement text** for §6:187:
> `Acceptance: satu `it.todo` H4 (`wr-sk-state-machine.test.ts:378`, diekspansi 2× oleh `describe.each` premium/jaspay) menjadi test lulus, `

### N-2. §5:139 "80 test" is right; the arithmetic behind it is not obvious and an agent may "round" it

§5:139 — "Test characterization: 4 supplier kecil (80 test)" — and `MAP-2:6`. Verified (`small-suppliers-claim.test.ts`, one `describe.each` over `FACTORIES` = 4 suppliers at `:432-437`): **10** `it(` blocks, of which one is `it.each(RETRY_VIOLATIONS)` with **11** cases (`:625`, list at `:439-450`) ⇒ 20 per supplier × 4 = **80**. Confirmed by run: `80 tests` pass.

Accurate as written. The nit is only that an agent adding one `it` "for all four suppliers" makes it 84 and then updates the doc, eroding a fixed characterization baseline. Worth one clause: "80 = (9 kasus tetap + 11 `RETRY_VIOLATIONS`) × 4 supplier; menambah kasus mengubah baseline, minta persetujuan PM."

### N-3. §6 F8 and the §2 ban are only reconciled in parentheses

§2:38 bans "registry job dengan import statis"; §6:225 allows "Registry job cron berbasis data (opsional)" with "(Tetap memakai `await import()` (§3.6))". Consistent, but an agent reading F8 alone sees a registry and may build static imports. Already linked; consider hoisting "(§3.6)" to the start of the cell. Nit.

### N-4. `--incremental false` in the DoD command is redundant but harmless

§4:98 — `npx tsc --noEmit -p . --incremental false`. Verified it runs and exits 0 on this tree; `tsconfig.json:18` already sets `"incremental": true` and a `tsconfig.tsbuildinfo` exists, so the flag only forces a cold build (slower, same verdict). If the intent is a cold check, say why; otherwise drop the flag for speed. Nit.

### N-5. §6:191 "2A dan 2B boleh dikerjakan paralel" vs §7:242 "Maksimal dua writer aktif"

2A and 2B in parallel = 2 writers + at least 1 reviewer each = 3-4 agents, which is exactly the §7:243 cap of four. It fits, but only if the reviewers are the same two agents. State it, or a third reviewer gets recruited and the cap is breached. Nit.

---

## Over-scope / under-scope (max 5)

1. **Under-scope — 3E is ranked last and listed as "M (UI)"** while §5:115 counts it as a hotspot (5 commits/60d). Keeping it last is right (lowest churn), but it ships a 43-`useState` hook extraction with real-browser verification. That is not a same-day M alongside 3C/3D. Recommend §6:210 wording: "3E dikerjakan **sendiri**, bukan paralel dengan 3C/3D, karena verifikasi browser nyata per commit".
2. **Under-scope — no step owns `orders/lookup` dedupe.** MAP-1 cross-cutting #9 says GET `/api/orders` and `/lookup` duplicate the readiness SQL + refresh; 7 response fields are literally identical (measured). 3B's `status-flags.ts` is the natural home, but §6:200 does not mention `lookup`. If it is not in 3B scope, the duplication the roadmap exists to kill survives. Add to 3B `Catatan wajib`: "sekalian menyatukan `orders/lookup:110-158` ke `status-flags.ts`, respons kedua route tidak berubah".
3. **Over-scope — T1's "dicatat sebagai angka yang di-assert" for every path.** MAP-3 §3's ledger already gives exact numbers per path; re-deriving all of them as assertions before 2A is a large T step whose output is mostly duplicated from MAP-3. Recommend narrowing T1 to the paths 2A/2B/2C actually touch (2A: claim + `processLink` subset; 2B: claim/fence/advance; 2C: final attempt) and citing MAP-3 §3 for the rest.
4. **Consider deferring — F8 (data-driven job registry).** §6:225 conditions it on "supplier ke-6", which is outside this roadmap's horizon. Keeping it in the table is fine; keeping it in §10 status is noise. Nit-level; listing it here only so it is explicitly deferred, not silently dropped.
5. **Add — one step for the `pedia_credits` precedent check before F5.** §6:221 (F5) says the customer ledger is "**bukan** generalisasi `pedia_credits`". `drizzle/schema.sql:1566` does define `pedia_credits`, so the statement is correct; but no step verifies that the shape chosen for F5 will not later need the same fields. Cheap: have F5's packet require a one-paragraph diff against `pedia_credits` columns. Not blocking.

---

## Answers to the six checklist questions

1. **Factual errors** — one (§3.10 "40 file", actual 27 import / 39 read) = B-2; one inherited from MAP-1. Plus §6:187 "kedua `it.todo`" = N-1 (source has 1, expanded 2×). Everything else I spot-checked is accurate: 60-day churn (54/44/37/24/5) matches `git log`; `LITE_JOBS` has 23 entries as implied; the three WR/Jaspay/SK recovery contracts in §3.2 match `docs/agent-rules/supplier-wr-sk.md` and MAP-3 §1; §3.5's "admission `canSpend(6)` dispatch WR" matches `src/lib/warung-rebahan/order.ts:398`; §2's non-goal list matches the files that exist.
2. **Ordering/dependency errors** — one blocking: 3B ⇄ F1 circular = B-1. One unstated prerequisite: 3B should own the `orders/lookup` dedupe (over/under #2). 2A↔2B parallel is sound (different files: `src/lib/{aivault,storebat,mirai,tunvn}/orders.ts` vs `warung-rebahan/{order,deliver}.ts`, `sekalipay/{order,sync}.ts`); 3A/3B parallel with Fase 2 is sound on file identity.
3. **Frozen-contract gaps** — the WR sync destructive guard + diff-mode + +800 hook + `IS NOT` quota (B-3), and the cron marker keys (S-1). Both are "green tests, broken production" classes of gap.
4. **Ambiguity** — B-1 (direction), B-4 (what "snapshot"/"gap" means), S-3 (ctx shape freezes too late), S-4 (which statement count), S-6 (who commits/pushes; §4.6 vs AGENTS.md:71).
5. **Over/under-scope** — five items above; the two I would actually act on are #2 (`orders/lookup` in 3B) and #3 (narrow T1 to touched paths).
6. **AGENTS.md conflicts** — S-6 (commit/push ownership + §4.6 reading vs the no-monitoring rule; both reconcilable with one sentence each). Test rules: §3.11/§3.12 correctly encode AGENTS.md's "jangan mengubah assertion hanya supaya kode yang salah terlihat lulus" and the source-text-retarget rule. Docs rules: S-5.

---

## Commands run (evidence)

Read-only; nothing started, nothing to stop.

```
grep -n / sed -n on issue/2026-11-21-refactor-roadmap.md  (all §/line citations above)
wc -l issue/2026-11-21-refactor-roadmap.md                              # 334
grep -rl 'import("@/app/api/orders/route")\|from "@/app/api/orders/route"' tests   # 27
grep -rl "api/orders/route" tests                                      # 39
node -e '...LITE_JOBS...'                                              # 23
grep -rn "it\.todo" tests/                                             # 1 (line 378)
npx vitest run tests/characterization/                                 # 131 tests: 129 pass, 2 todo; 2 files pass
npx tsc --noEmit -p . --incremental false                              # exit 0
grep -rn "query_budget_used" tests                                     # 3 assertions only
grep -rn "sales_channel" drizzle/schema.sql | head                     # CHECK IN ('web','telegram','whatsapp') at :86
grep -n "customer_wa" drizzle/schema.sql                               # NOT NULL at :72
ls src/lib/agent-auth.ts src/lib/commerce.ts src/lib/cloudflare-access.ts  # all exist
ls src/lib/suppliers                                                   # absent (folder to be created)
grep -rl "<path>" docs/agent-rules docs/ARCHITECTURE.md                 # doc citations that go stale
git status --short                                                     # only the untracked roadmap + maps/; nothing touched by me
```
