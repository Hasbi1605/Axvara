# B-S evidence — 18 November 2026

## Scope / outcome

Worktree `/Users/macbookair/axvara-up-bs`, branch `feat/up-bs`, baseline `2609f22d`.
Tidak commit/push/deploy, tidak akses/mutasi produksi, tidak membaca kredensial.
Tidak mengubah `catalog-cache.ts`, file B-H, mcp-worker, atau fulfillment/delivery.
PM menyetujui tambahan ownership `telegram/handlers/payment-dispatch.ts` dan satu
PK read background per pemenang paid bila binding hadir. PM juga menyetujui UA
`axvara-synth/` sebagai suppress analitik saja, tanpa secret cron pada halaman publik.

Implementasi:
- Binding `FUNNEL_ANALYTICS`→`axvara_funnel_v1`, skema 10 blobs/3 doubles/1 index.
- Tahap view/quote/order/paid: web Market/Pedia/Games dan Market Telegram.
- Shared paid helper hanya pemenang kedua transisi atomik; no-op/error binding
  tidak memengaruhi respons. Tidak ada kontak/target/IP/UA mentah/order code.
- Uang hanya bucket; kode metode tak dikenal→none. Quote belum memilih metode.
- React.cache RSC per request berbagi pasangan query SEO metadata+render PDP;
  tidak ada cache lintas request. Tidak memasang cache katalog menunggu B-H.
- PRD, ARCHITECTURE (skema+SQL API), README, platform-ops dan CHANGELOG diperbarui.

## Commands / actual results

```sh
npx vitest run tests/funnel-analytics.test.ts tests/pdp-seo-cache.test.tsx \
 tests/product-groups-pdp.test.ts tests/product-seo.regression.test.ts \
 tests/checkout-quote-sk.integration.test.ts tests/payment-rails-checkout.integration.test.ts \
 tests/games-orders.test.ts tests/pedia-orders.test.ts \
 tests/telegram-payment-crash-recovery.test.ts tests/payment-review.integration.test.ts \
 tests/telegram-payment-terminal-and-fence.test.ts tests/telegram-bulk-checkout.integration.test.ts \
 tests/pedia-payment-rails.integration.test.ts tests/games-payment-rails.integration.test.ts \
 tests/nowpayments.integration.test.ts tests/sekalipay-gateway.integration.test.ts \
 tests/rate-limit-scopes.test.ts
```

Final run `07:16:26`: **17 files / 436 tests passed**, exit0 (3.49s).
New tests cover fixed fields four stages, ignored PII-shaped extra properties,
normalized methods/buckets, absent binding+zero paid query, context binding,
sync/async write failure, authenticated/UA synthetic exclusion, actual Market
view/quote/order routes including write failure/replay, three order kinds paid
concurrency, manual confirmation, admin/callback race and metadata failure.
PDP test uses Next's actual compiled React RSC `cache` with a scoped dispatcher:
one SEO query pair for metadata+render, fresh data after dispatcher/request reset;
UA propagation verified. React18 non-RSC unit fallback remains uncached.

- `npx tsc --noEmit --incremental false`: exit0 on final code/tests.
- ESLint tracked changed TS/TSX plus new helper/tests (`--quiet`): exit0.
- `npm run build:pages`: exit0, **187 edge routes**, completed build in18.34s
  after Next/Vercel build. Existing `<img>`, tool deprecation/workspace-root warnings;
  no new error. Build used final production code; only tests/docs changed afterward.
- `npx --yes wrangler@4.128.0 types .qa-bs-probe/bindings.d.ts --config wrangler.json`:
  exit0, Pages config accepted; generated `FUNNEL_ANALYTICS: AnalyticsEngineDataset`
  alongside DB/R2. Artifact renamed `bindings.txt` so QA output does not enter the
  project's `**/*.ts` compilation. No deployment/resource command or production API.
- `git diff --check`: clean. Dataset ingest/SQL API not executed against Cloudflare.
- `npm audit --audit-level=high --json`: exit1; **16 high / 5 moderate / 0 critical**
  in existing dev/toolchain dependency graph (Pages adapter, ESLint/Tailwind,
  Vite/Vitest/transitives). No dependency/lockfile changes. Do not treat audit as pass.
- `git ls-files` credential-name check empty; staged file list empty. No secrets
  added, no root-global AGENTS recreated. Full suite belongs to PM integration,
  not this writer's focused scope.

Logs (local only):
`/private/var/folders/bs/x8qyjdq510sbmbj6pmmvpd3w0000gn/T/opencode/`
`B-S-tests-final.log`, `B-S-build.log`, `B-S-audit.json`, `B-S-bindings.log`.

## Browser / UI

Own dev server from this worktree only:
`node ./node_modules/next/dist/bin/next dev --port 3122 --hostname 127.0.0.1`.
No D1/production binding; ordinary dev seed. Server stopped by Ctrl-C and terminal
returned to prompt; port3122 no longer listening. Terminal id:
`e60585a0-9c2f-4b57-b5a0-8b324c0ac033`.

```sh
node /Users/macbookair/.config/opencode/skills/paseo-orchestrator/tools/ui-probe.cjs \
 http://127.0.0.1:3122/produk/chatgpt-plus-1-bulan \
 --out /Users/macbookair/axvara-up-bs/.qa-bs-probe --name pdp --wait 2500
```

Tier1 Chrome desktop1440×900/mobile390×844: exit0, no horizontal overflow,
console/page errors0 both; screenshots inspected. Small tap targets24/20 are
existing controls (not changed by this no-visual-diff task), not an all-a11y pass.
Artifacts intentionally untracked `.qa-bs-probe/`: screenshots, metrics.json,
interactions.json. Exclude these binary QA artifacts from integration commit.

Additional actual Chrome interaction script on1440/390 (exit0):
- PDP HTTP200; one visible `ChatGPT Plus 1 Bulan` H1 and Product JSON-LD.
- Focus gallery next button, Enter→2/3, previous click→1/3.
- Desktop `Beli Langsung` / mobile `Beli Sekarang` navigate to local
  `/checkout?buy=chatgpt-plus-1-bulan`; **zero POST orders**, no invoice/payment.
- Relevant Next CSS/JS all200 (desktop10 assets/mobile7), console/page errors0.
- Initial probe context close caused dev `aborted/ECONNRESET` uncaught log during
  in-flight request; later settled interaction runs clean. No telemetry error or
  browser-visible regression. Existing root-lockfile warning not altered.

## Boundaries / integration notes

- No live WAE ingest/resource or SQL API evidence; dataset auto-create first write
  follows configured binding, not a deployment claim.
- Paid is one initiation per CAS winner, **not guaranteed exactly-once delivery**:
  crash/WAE failure can lose data. HTTP caches/sampling/bots affect view counts;
  no cohort/unique buyer identifier or revenue ledger. Financial source stays D1.
- Web order counts successful new201 only; replay200 does not backfill a missed
  invoice event. Telegram order counts atomic INSERT winner before provider call.
- Quote outcomes cover Market final validation and Pedia minimum; early invalid
  payload/target/errors are not a comprehensive failure taxonomy.
- WA purchase retired; no new WA funnel purchase path revived. Legacy paid remains
  tagged whatsapp. Admin payment test stays410. Daily summary unchanged.
- Merge `orders-transition.ts` with B-H minimally: B-S adds import and four
  isolated trackPaidOrder calls; B-H revision invalidation must remain.
- DESIGN=N/A: no layout/style/token/assets changed. Runtime D1 schema migration
  QA=N/A: no schema migration; native CAS still exercised through SQLite fixture.
