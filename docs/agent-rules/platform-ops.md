# Aturan agent — Workers Paid, unit unik, operasional D1

### Workers Logs `axvara-mcp` + runbook log Pages — 20 November 2026 (keputusan owner; berlaku setelah rilis CI)

- **Keputusan owner:** aktifkan Workers Logs persisten (retensi 7 hari, dashboard Observability) di Worker `axvara-mcp` dengan invocation logs otomatis **ON**. Konfigurasi di `mcp-worker/wrangler.toml`: `[observability] enabled = true`, `head_sampling_rate = 1`, dan `[observability.logs] invocation_logs = true`. Sampling 1 agar kegagalan langka (queue/cron) tidak terlewat; turunkan hanya bila pemakaian bersama menuntut.
- **Estimasi volume:** `axvara-mcp` ≈ 1.440 cron/hari (tiap menit) + fetch `/mcp` + batch queue ≈ **~2.190 invocation/hari**, kira-kira **0,05–0,4 GB/bulan** (teks sanitized, tanpa body). Masih jauh di bawah jatah Workers Paid **50 GB/bulan**; pricing berbasis GB mulai **1 Des 2026** ($0,25/GB ingest, $0,10/GB-month storage). Angka ini proyeksi dari hitungan invocation, bukan billing resmi — verifikasi **Billable Usage** setelah 24 jam dan 7 hari.
- **Batas privasi (hasil WL-1):** 74 `console.*` di `src/**`+`mcp-worker/**` — tidak ada yang mencetak body/PIN/proof/API key; `mcp-worker` memakai `sanitizeError`/`sanitizeQueueText`. Risiko utama Workers Logs adalah **URL invocation**, bukan console. Jangan log body/credential baru di Worker.
- **Hasil cek pasca-deploy 20 Nov 2026 11:40 UTC (API telemetry read-only):** deployment `axvara-mcp` 11:35:24Z, settings `observability.enabled=true`, `logs.persist=true`, `invocation_logs=true`, `redact_query_string=false`; event `scheduled` dan `fetch` masuk. Probe `POST /mcp` dengan Bearer palsu → header `authorization` tersimpan sebagai `********` (disensor Cloudflare), jadi invocation logs tetap ON. Yang tersimpan: URL, method, header lain termasuk `cf-connecting-ip`/`x-real-ip` (IP pemanggil — hanya agent/cron milik owner), status respons.
- **Cek pasca-deploy (WAJIB):** dashboard Cloudflare → Workers → `axvara-mcp` → **Observability**; buka satu invocation fetch `/mcp` dan periksa apakah nilai header `authorization` (Bearer agent token) tersimpan. Jika **ya**, set `[observability.logs] invocation_logs = false` lewat CI dan pertahankan app log tersanitasi saja. Jika ragu, perlakukan sebagai bocor.
- **Rollback:** set `[observability] enabled = false` (atau `[observability.logs] invocation_logs = false`) lalu redeploy via CI `git push origin main`. **JANGAN** hapus blok config — default Wrangler untuk Worker baru adalah `enabled = true`.
- **Pages tidak punya log persisten:** Workers Logs/Logpush/Tail Workers ditandai unsupported untuk Pages Functions di matrix kompatibilitas Cloudflare; log hanya live per-deployment. Runbook insiden Pages: (1) dashboard → Pages project `axvara` → deployment aktif → **View details** → **Functions**; (2) `set -a; source .cf-credentials; set +a` lalu `npx wrangler pages deployment tail <DEPLOYMENT_ID> --project-name=axvara` (hapus secret setelah selesai). Batas: tidak disimpan, log disembunyikan bila Function >100 req/dtk selama 5 menit, maksimal 10 penonton per deployment. Korelasi dengan MCP pakai request ID acak, bukan identitas pembeli.
- **temp-mail:** `temp-mail/wrangler.jsonc` sudah punya `observability.enabled = true` (tidak diubah paket ini); review privasi email terpisah bila hendak menyesuaikan `invocation_logs`.
- **Follow-up opsional (belum dikerjakan, murni higiene):** token masih di query string beberapa route Pages (WA webhook `?token=`, `/api/orders/[code]/credentials ?token=`, unsubscribe, `lacak-pesanan ?wa=/?email=`). Karena log Pages tidak dipersistenkan, ini bukan bukti kebocoran log saat ini; pindahkan bila kelak Pages dimigrasikan ke Worker persisten.

### Penjaga webhook Bot Telegram (`tg_webhook`) — 20 November 2026 (lokal, belum deploy)

- **Insiden 20 Nov 2026 12:40–12:58 WIB:** edge Cloudflare mengembalikan HTTP 500 ke pengiriman webhook Telegram (request tidak pernah mencapai Pages Functions; situs dari SIN normal). Karena Telegram mengirim update berurutan per bot, satu update gagal menahan seluruh antrean pembeli ~18 menit (`pending_update_count` naik ke 10). Pemulihan manual yang berhasil: `deleteWebhook(drop_pending_updates:false)` lalu `setWebhook(url, secret_token, max_connections:40, allowed_updates:["message","callback_query"], drop_pending_updates:false)` → antrean mengalir habis dalam ~15 detik.
- **Guard otomatis (`src/lib/telegram/webhook-guard.ts`, job `cron/lite?job=tg_webhook`):**
  - Dijadwalkan setiap 1 menit di `mcp-worker/src/cron.ts` (`group: "notify"`, `alarm: "soft"`). Wajib ringan (1 panggilan `getWebhookInfo` saat sehat; ≤3 saat auto-kick), **tidak pernah** melempar exception (catch → `{ status, error }` tersanitasi), dan **tidak pernah** mencatat token/secret.
  - **Kondisi tertahan (`isStuck`):** `pending_update_count >= 3` DAN `last_error_date` dalam 180 detik terakhir. **Salah URL (`isWrongUrl`):** `url !== canonicalWebhookUrl()` (`${siteOrigin()}/api/telegram/webhook`, berbagi single source dengan `/api/admin/telegram/setup`).
  - **Auto-recover:** paling banyak 1× per 5 menit (CAS di `store_settings.tg_webhook_guard_state` `last_kick_at`). Memanggil `deleteWebhook({ drop_pending_updates: false })` lalu `setWebhook(...)` dengan parameter kanonis dan `drop_pending_updates: false`. **Dilarang keras** mengirim `drop_pending_updates: true`. Jika `setWebhook` gagal, coba ulang 1× seketika agar webhook tidak tertinggal kosong; bila kedua percobaan gagal, kirim alert kritis ke `TELEGRAM_ADMIN_CHAT_ID`.
  - **Notifikasi admin:** mengirim `"⚠️ Bot Telegram tertahan: {pending} update antre · error terakhir {hh:mm WIB}: {message} · webhook dipasang ulang otomatis"` (rate-limit 1×/30 menit selama tertahan) dan `"✅ Bot Telegram pulih (antrean kosong)"` sekali saat `pending_update_count` kembali ke 0 setelah alert tertahan.
  - **`GET /api/admin/bot/health`:** ikut melaporkan `pending_update_count`, `last_error_date`, `last_error_message`, dan `last_auto_kick_at` pada objek `webhook`.

### Kuota menit GitHub Actions — 20 November 2026

- **Pengamatan 20 Nov 2026 (estimasi dari durasi job, bukan angka billing resmi):** 1–20 Nov ≈ 2.816 menit (`AXVARA CI/CD` 266 run ≈ 2.745 mnt, D1 usage monitor 68, backup 3); proyeksi akhir bulan ≈ 4.400 menit. Kuota bawaan repo privat: Free 2.000/bulan, Pro 3.000/bulan; kelebihan Linux ditagih ~US$0,008/menit bila budget mengizinkan, bila tidak run tidak dijalankan. Satu run CI ≈ 10–19 mnt (test 12,5 mnt di runner 2-core).
- **Cek pemakaian (lokal, 0 menit Actions):** `node scripts/gh-actions-usage.mjs [--month YYYY-MM] [--limit 2000]`. Angka resmi: `gh auth refresh -h github.com -s user` lalu `node scripts/gh-actions-usage.mjs --official`, atau GitHub Settings → Billing.
- **Hemat:** commit yang hanya mengubah `docs/**` / `*.md` tidak memicu `ci.yml` (`paths-ignore`). Gabungkan perubahan kecil dalam satu push; setiap push ke `main` membatalkan run sebelumnya (`cancel-in-progress`) tetapi menit run yang dibatalkan tetap terpakai.
- **Bila kuota habis (urutan):** (1) owner menaikkan budget Actions di GitHub Billing (mis. US$5–10/bulan ≈ 600–1.250 menit) atau upgrade Pro; (2) alihkan runner tanpa edit workflow: set repo variable `CI_RUNS_ON` ke JSON label runner sendiri, mis. `["self-hosted","axvara"]` (runner self-hosted gratis; hapus variable untuk kembali ke `ubuntu-latest`); runner perlu Node 22, akses jaringan ke Cloudflare/Heroku/GitHub, dan tidak boleh menyimpan secret di disk di luar mekanisme Actions; (3) deploy manual hanya sebagai recovery atas permintaan eksplisit owner (aturan AGENTS.md tetap).

### Telegram post-purchase & batas hemat Free dilonggarkan — 19 November 2026 (lokal, belum deploy)

- **Batas Telegram (Workers Paid):** `retryPendingTelegramNotifications`/`sendPendingOrderReminders` per panggilan `20 → 50`, `retryInvoicePendingTelegramInvoices` `12 → 25` (`attempts<5` + backoff claim provider 60 dtk tetap). `cron/lite` `notify_a` memakai 50/25; `notify_b` pengingat 50. Cadence lama 60 mnt diganti TG-POLISH-B (lihat `payments.md`). Pemanggil lama tetap memakai default fungsi; jangan menaikkan lagi tanpa mengukur 429.
- **`cron/operations`:** `TIME_TELEGRAM_BATCH` `12_000 → 4_000` dan gerbang pre-batch `budget.fits(1 + 4×units)`/`1+4×12` dihapus saat ukuran antrean tak diketahui; batas nyata adalah `hasTime` per item + `canSpend` per order di dalam `retryPending…`/`sendPendingOrderReminders`/`retryInvoice…`. `COST_PER_NOTIFICATION` dihapus. Jangan menghapus `RUN_DEADLINE_MS` 45 dtk atau guard `canSpend` runaway.
- **Broadcast pacing:** `TELEGRAM_RECIPIENT_PACE_MS` `250 → 100` ms (≈10 penerima/dtk, di bawah ~30 msg/dtk Telegram). `TELEGRAM_SAME_CHAT_PACE_MS = 300` ms dan backoff `retry_after` 429 TIDAK berubah.
- **Tab Pesanan/garansi/restok/.txt:** lihat ARCHITECTURE §16.63. Migrasi `0144_telegram_restock_alerts.sql` forward-only; cron `notify_b` menjalankan `processDueRestockAlerts` (maks 50/tick, klaim atomik, 403 → cancelled, 429 → rollback+stop). Klaim garansi memakai `pending_action="wclaim:<code>"` + forward ke `TELEGRAM_ADMIN_CHAT_ID` (rate-limit 3/order/24 jam di `buyer_notice_log`), tanpa tabel baru. Pengiriman fulfillment awal sengaja tidak diubah.

### Wave 2 (B1/B2) supplier multi-link & cron fase paralel — 19 November 2026 (lokal, belum deploy)

- Supplier TUNVN/AIVault/StoreBat/Mirai memproses hingga 8 link + 8 order yatim per panggilan dengan stop pada deadline, budget D1 dan HTTP `429`; fence kirim tidak berubah. Detail di ARCHITECTURE bagian Wave 2.
- Cron Worker: fase `core` (`payments → expiry → fulfillment`) dan `heavy` **wajib tetap berurutan**; jangan paralelkan `payments` dengan `expiry` (order yang dibayar mepet deadline bisa ke-expire). Fase `orders`/`catalog`/`notify` paralel maks 4. Probe sintetis berjalan setelah fase lite, sebelum heavy.

### B3 Aktivasi produksi `queue_fulfillment_mode = 'active'` — 19 November 2026 (live di D1 produksi)

- **Keputusan owner (`2026-11-19 14:04:40 UTC` / `21:04:40 WIB`):** `store_settings.queue_fulfillment_mode` dinaikkan dari `shadow` ke **`active`** di D1 produksi (`axvara-db`) untuk seluruh `order_kind` (`apps`, `pedia`, `games`).
- **Bukti mode `shadow` 34 jam (`2026-11-18 03:59:31 UTC` – `2026-11-19 14:00 UTC`):** `axvara-order-fulfillment` **43** `WriteMessage` = **43** `ReadMessage` = **43** `DeleteMessage` (0 retry, 0 backlog), DLQ `axvara-order-fulfillment-dlq` **0**, HTTP `POST /api/internal/queue/fulfill` **43/43 HTTP 200** (0 auth-fail `401/403`, 0 `400`, 0 `5xx`), `axvara-mcp` 2.142 request / **0 error**, D1 cross-check 34 order lunas + `supplier_settled` = 43 pesan dengan **0 duplikasi** di `buyer_notice_log` & `fulfillment_send_claims`. (Batas bukti: Workers Logs `observability` belum aktif di `axvara-mcp`, sehingga isi body JSON `dry_run_ok` per pesan tidak tersimpan.)
- **Rollback instan:** `UPDATE store_settings SET value='off', updated_at=datetime('now') WHERE key='queue_fulfillment_mode'` (origin `/api/internal/queue/fulfill` membaca mode langsung dari D1 tanpa cache 30 dtk; producer mengikuti dalam ≤30 dtk; cron backstop 1 menit tetap berjalan).

### Wave 1 penghapusan batas hemat Free (Workers Paid) — 19 November 2026 (publikasi via CI `47dbe565`)

- **Budget cron (A1):** `src/app/api/cron/lite/route.ts` memakai `createBudgetedDatabase(job === "fulfillment" || job === "jaspay_catalog" ? 400 : 300)` (sebelumnya `96`/`40`); `src/app/api/cron/operations/route.ts` `QUERY_BUDGET = 300` (sebelumnya `40`). Budget tetap dipertahankan sebagai runaway guard berbatas bersama deadline 45 dtk; budget terpisah `runPromo` broadcast (`400`) tidak berubah.
- **Plafon per tick & Resend pacing (A4):** `EXPIRY_PER_RUN = 30`, `ORPHAN_LEDGER_PER_RUN = 30`, `FULFILLMENT_PER_RUN = 20` (`FULFILLMENT_ITEMS_PER_JOB = 10` di lite), WR/SK `process*PendingOrders` max `20`, `reconcileJaspayAmbiguous` `12`, `refreshDueSupplierOrders` `12` (max `20`, throttle 20 dtk tetap), SK `recoverStaleSkClaims` `LIMIT 12`, WR orphan delivery `20`, Telegram retry/reminder `20`, invoice retry `12`. Loop email (`processCredentialAccessEmails` `15`/max `20`, `sendQrisExpiryNotifications` `15`, WR `processDueCredentialDeliveries` & SK `reconcilePendingSkCredentialEmails` `15`/max `20`, `pedia/notify-retry` `RETRY_LIMIT = 6`) mem-pace `1.000 ms` antaremail di produksi agar tetap ≤1 req/dtk (batas default Resend 2 req/dtk/tim). `processDueWhatsAppOutbox` **tetap 4/tick** di lite & operations (anti-ban WA 6–9 dtk).
- **Admin interaktif unbudgeted (A5):** 7 route POST admin (`aivault/{orders,publish}`, `mirai/{orders,publish}`, `storebat/{orders,publish}`, `tunvn/orders`) memakai `createDatabaseAccess()` unbudgeted agar Publish/Retry tidak pernah 503 karena budget 40 statement.
- **Interval saldo & pasar (A7/A8):** `CRYPTO_REFRESH_AFTER_MS = 10 * 60_000` (sebelumnya 30 mnt, pacing G2 tetap), `CRYPTO_MARKET_MEMO_MS = 15_000` (sebelumnya 60 dtk); `SUPPLIER_BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000` dan IndoSMM `5 * 60 * 1000` (sebelumnya 30 mnt); WR/SK saldo `10 * 60 * 1000` (sebelumnya 60 mnt, kini juga dicek di `cron/lite` `wr_orders`/`sk_orders`; throttle alert Telegram 6 jam/drop-step tetap).
- **Hapus probe kuota harian D1 dari middleware (A11):** `src/middleware.ts` tidak lagi memanggil `isD1InMaintenance` pada halaman SSR (Free-tier daily row limit tidak berlaku di Workers Paid). Modul `src/lib/d1-maintenance.ts` dan rute `/maintenance` tetap dipertahankan.

### Queue pengiriman siaran/promo (`axvara-broadcast`) & penghapusan batas hemat Free — 19 November 2026 (lokal, belum deploy)

- **Workers Paid:** batas hemat era Free (`Math.min(8, limit)`, cadangan 11 detik Telegram, batas 20 detik, budget bersama 40 statement untuk dispatch) **dihapus** dari jalur pengiriman siaran/promo.
- **Resource Cloudflare Queues WAJIB dibuat PM sebelum deploy** (CI `wrangler pages deploy` + `wrangler deploy --config mcp-worker/wrangler.toml` gagal bila resource belum ada):
  - `axvara-broadcast` (producer binding `BROADCAST_QUEUE` di `wrangler.json`; consumer di `mcp-worker/wrangler.toml`: `max_batch_size = 10`, `max_batch_timeout = 1`, `max_concurrency = 1`, `max_retries = 3`, `dead_letter_queue = "axvara-broadcast-dlq"`).
  - `axvara-broadcast-dlq` (consumer DLQ log + `ack()` saja tanpa alert Telegram/retry; cron backstop menyelesaikan sisa baris `pending`).
- **Kontrak consumer/origin:** `mcp-worker/src/queue.ts` merutekan `batch.queue` (`axvara-order-fulfillment` & DLQ-nya utuh; `axvara-broadcast` diproses berurutan/konkurensi 1 ke `POST ${AXVARA_API_ORIGIN}/api/internal/queue/broadcast` dengan `Bearer ${AXVARA_CRON_SECRET}`, skema ketat `v:1`, `kind:'broadcast_deliveries'`, `campaignId` UUID, `deliveryIds` 1..50 integer positif, `enqueuedAt`; pesan cacat → `ack()`).
- **Origin & pacing:** `/api/internal/queue/broadcast` memakai DB unbudgeted Paid (2 statement/penerima hot path: CAS claim + update final), lease global `broadcast_dispatch_control` + CAS per delivery, pacing Telegram ~250 ms antarpenerima + ~300 ms antarpesan chat sama (foto→teks), Email 650 ms, 429 menghentikan batch & mengembalikan `settled:false` + `retrySec` tanpa kirim ulang foto (`provider_id`), tidak pernah mengirim ulang `'sending'` atau `'unknown'`.
- **Producer & saklar:** `enqueueDueTelegramPromo` dan `launchBroadcast` (hanya `telegram`/`email`; WA tidak berubah) mendorong chunk `≤ 50` ID/pesan (default 20, dikelompokkan per kanal) via `sendBatch` (`≤ 100` pesan/call); binding absen atau gagal kirim hanya dicatat di log (cron backstop mengambil alih). Saklar `store_settings.broadcast_queue_mode = 'off'` mematikan producer dan membuat origin `ack` (`queue_disabled`, cron-only); default aktif. `telegram_promo_broadcast_enabled` tetap utuh.
- **Cron backstop `runPromo`:** `enqueueDueTelegramPromo` dan `sendDueDailyAdminSummary` tetap memakai `db` 40 statement (guard 1 statement saat sudah di-enqueue/nonaktif, 6 statement saat enqueue tanpa binding / +1 statement select ID saat binding aktif), sementara `processBroadcasts` mendapat budget terpisah `createBudgetedDatabase(400, 4, unwrapD1(...))` + wall time hingga ~40 detik/tick, dengan grace 2 menit (`BROADCAST_BACKSTOP_GRACE_MS`) untuk `telegram`/`email` saat queue aktif (pre-check 1 query agar tick idle tidak mengunci lease global; WA tetap segera tanpa tunggu 2 menit).

### Katalog live di browser pembeli — 19 November 2026

- Respons `cachePublicCatalog` ke browser selalu `Cache-Control: no-cache`; jangan menambah `max-age`/`stale-while-revalidate` browser untuk katalog publik. Freshness berasal dari cache edge berbasis revisi + `bumpCatalogRevision`, bukan TTL browser.
- Halaman pembeli memantau `GET /api/catalog/revision` lewat `useCatalogRevisionWatcher` (30 dtk saat tab terlihat, plus focus/bfcache/online). Jalur mutasi stok/harga baru WAJIB mem-bump revisi agar tab terbuka ikut diperbarui; refresh harus senyap (tanpa skeleton) dan tidak menggantikan validasi quote/checkout. Detail ARCHITECTURE §16.62.

### Batas kedalaman ekspresi D1 — 19 November 2026

- Tiap sambungan `AND` pada rantai datar menambah kedalaman ekspresi. Setelah penambahan kondisi StoreBat/Mirai, guard `createOrderWithStock` melebihi batas D1 100 tingkat dan `POST /api/orders` gagal 500. Kelompokkan kondisi berdasarkan snapshot supplier saat menambah syarat.
- `tests/market-order-reservation.workerd.test.ts` menjalankan reservasi aktual di D1 lokal melalui Miniflare. Runtime ini menerapkan batas 100 tingkat, sementara fixture `node:sqlite` standar menerima ekspresi yang lebih dalam.

### Prioritas Workers Paid dan kuota D1 — 19 November 2026 (keputusan owner)

- Utamakan kelancaran dan operasi real-time. Tambahan read/write D1 dapat diterima selama proyeksi tetap dalam jatah bulanan Workers Paid (**25 miliar baca / 50 juta tulis**), dipantau lewat `.github/workflows/d1-usage.yml`. Optimalkan hanya bila proyeksi mendekati jatah atau latensi memburuk.
- Biaya scan orphan StoreBat, Mirai, AIVault dan TUNVN diterima: audit produksi mengukur 3.088/3.088/3.098/3.118 baris dibaca per probe idle (~3 ms/query). Empat job tiap menit memproyeksikan ~17,8 juta baca/hari atau ~534 juta/30 hari (~2% jatah baca bulanan), bukan hasil pengukuran pemakaian bulanan. Jalur dispatch tetap.

### Anggaran watchdog — 19 November 2026 (lokal)

- `cleanup` menjalankan watchdog sesudah maintenance maksimal 10 statement, sebelum materialisasi pengeluaran dan drain grup/copy/FX. Cadangan invalidasi revisi katalog dipertahankan saat drain. Budget request tetap 40 (2 statement tail); urutan job Worker tidak berubah.

### Cache edge Games ditunda — 18 November 2026

- Keputusan owner+PM: `/api/games/catalog` dan `/api/games/catalog/[slug]` tetap `private, no-store` tanpa `cachePublicCatalog`. Data 7 hari: ±2 + 5 request (vs 576 `/api/catalog`), 1 order Games sepanjang masa — manfaat cache ≈0, risiko harga basi tetap ada. Pertimbangkan lagi bila trafik Games ratusan–ribuan request/hari; scope revisi `games` + bump di sync Games sudah tersedia. Wajib `npm run build:pages` sebelum push perubahan route (insiden `15d275e8`).

### C-H consumer Queue pengiriman instan & DLQ (`axvara-mcp`) — 18 November 2026 (lokal, belum deploy)

- `mcp-worker/wrangler.toml` mendefinisikan consumer `axvara-order-fulfillment` (`max_batch_size = 5`, `max_batch_timeout = 1`, `max_retries = 4`, `dead_letter_queue = "axvara-order-fulfillment-dlq"`), consumer DLQ `axvara-order-fulfillment-dlq` (`max_batch_size = 5`, `max_batch_timeout = 5`, `max_retries = 2`), dan `[vars] QUEUE_CONSUMER_MODE = "active"`. Resource Queue wajib dibuat PM sebelum push; jangan menghapus/mengubah binding tersebut tanpa memperbarui kontrak producer di paket C-S.
- `mcp-worker/src/queue.ts` + `index.ts` (`queue(batch, env, ctx)`): validasi pesan skema v1 (`AXV|AXP|AXG`, `order_paid|supplier_settled`, `apps|pedia|games`, `shadow|active`) sebelum fetch; `QUEUE_CONSUMER_MODE = "off"` me-`ack()` tanpa memanggil origin; paralel terbatas `≤ 5` dengan timeout `45` detik; `settled: true` (`done|async_polling|manual_required|not_paid|dry_run_ok|queue_disabled`) → `ack()`, `settled: false` → `retry({ delaySeconds: max(retrySec, backoff(attempts)) })` hingga `attempts < 5`; pada `attempts ≥ 5` log error `unsettled_to_dlq` + retry backoff agar `max_retries=4` existing mengirim ke DLQ (cron backstop tetap), `400` → `ack()`, `401/403/5xx`/timeout/network → `retry` backoff `5, 15, 45, 120` detik.
- Consumer DLQ mengirim Telegram admin (`TELEGRAM_ADMIN_CHAT_ID`) dengan sanitasi error/secret/PII (`sanitizeError` dari `cron.ts` + redaksi token langsung/email); `ack()` hanya setelah kirim Telegram sukses, selain itu `retry()`. Log per pesan terstruktur tanpa PII/secret.

### C-S Queue producer/origin — 18 November 2026 (lokal, belum deploy)

Binding Pages `ORDER_FULFILLMENT_QUEUE`→`axvara-order-fulfillment` bukan env
secret. PM menyiapkan resource/consumer C-H; C-S tidak mengubah mcp-worker.
Setting `queue_fulfillment_mode` off/shadow/active/canary:<kind> memo30detik
default off; hanya winner paid/supplier enqueue. Shadow endpoint dry-run hanya
1read; active XOR legacy kecuali fallback send-error ambigu (CAS/C0 tetap).
Gateway payment cron mode read ikut DB40statement, fallback legacy tanpa
executor khusus defer ke cron fulfillment (`cron_deferred`), tidak unmetered.

Internal POST `/api/internal/queue/fulfill` Bearer CRON_SECRET constant-time,
schema strict/body2KiB/order lunas/deadline40detik berhenti memulai sub-pass.
Deadline absolut opsional ensure/process; default dan budget/fence C0 utuh.
Pedia/Games scoped satu order; pembelian satu link/supplier/pass, sisa pre-send retry
min60≥lease, termasuk push/buyer-notice600detik. Done/async/manual/not_paid/
dry_run_ok/queue_disabled ack, bukan janji semua multi-link selesai. Retry WR/SK
tetap menjalankan processor bila link existing; SK completed diproses semua
sampai deadline, notice eligible belum sent pending. blocked_balance retry
sesuai next_attempt_at; status tak dikenal/tanpa fence/lease valid manual. Log producer per
kind/source/mode/outcome+durasi legacy, tanpa PII; ukur link terakhir juga.
Shadow hanya transport, canary sesudah0auth-fail/0enqueue non-lunas/<1%error/
tanpa kenaikan push ganda. Origin membaca mode segar sebelum executor, sehingga
pesan active lama off/shadow/canary tak cocok tidak berjalan (queue_disabled).
Memo producer30detik tetap; pass sudah berjalan masih dapat memulai kerja sampai
deadline40detik dan I/O tidak dibatalkan. Fence tetap. Workerd lokal bukan bukti
rollout; full suite/publication oleh PM.

### B-S funnel WAE — 18 November 2026 (lokal)

`FUNNEL_ANALYTICS`→`axvara_funnel_v1` adalah binding Analytics Engine Pages,
bukan secret_text/env Pages baru. Dataset tercipta pada write pertama; jangan
membuat resource/migrasi atau mengakses produksi demi QA. Empat tahap tanpa PII,
nilai rupiah berupa bucket, error binding no-op; paid hanya pemenang kedua
transisi bersama (`trackPaidOrder` kini membaca `games_order_items` via
`LEFT JOIN` di query PK tunggal yang sama untuk dimensi `productId`/`variantId`/
`quantity` order `games` tanpa PII), +1 PK read background bila binding ada,
0 D1 write. Native WAE
best-effort+sampling, bukan ledger/ingest exactly-once. Binding absen0read.
UA probe `axvara-synth/` mengecualikan telemetri saja (boleh spoof untuk suppress),
di samping guard authenticated `isSyntheticRequest`; tidak melemahkan rate/auth.
PDP meneruskan UA, bukan secret cron ke katalog/PDP publik. Kontrak A-S tanpa
cron header pada halaman publik tetap. Jangan menyimpan kontak/target/order code
di dimensi baru. Query SQL API harian per metode ada di ARCHITECTURE B-S;
daily-admin-summary tidak diubah. Cache katalog bersama masih menunggu B-H.
### B-H cache edge berbasis revisi & invalidasi — 18 November 2026 (lokal, belum deploy)

- `src/lib/catalog-cache.ts` (`d1-v2/{scope}/{rev}/{key}`): tiga kunci revisi di `store_settings` (`catalog_revision_market`, `catalog_revision_pedia`, `catalog_revision_games`) dengan memoization per-isolate 5 detik (`WeakMap` lewat `unwrapD1`) dan coalescing pembacaan in-flight. (Histori: restorasi `Cache-Control` asli via `X-Axvara-Origin-Cache-Control` digantikan kebijakan browser `no-cache` 19 Nov.)
- **Aturan `bumpCatalogRevision(scope)`:** maksimal 1 statement tulis `UPSERT` (`store_settings`) per eksekusi bermutasi (`changed > 0`); dilarang memanggil pada tick/sync no-op (`changed === 0`), replay idempoten, atau kegagalan. Pada `games/sk-catalog-sync.ts`, pembaruan `catalog_revision_games` saat berubah digabung dalam batch atomik penanda sukses yang sama (0 statement ekstra).
- Setiap jalur tulis baru yang mengubah tampilan katalog (`products`, `product_variants`, `categories`, `fulfillment_items`, `supplier_pairs`/`product_groups`, `wr_*`/`sk_*`/`tunvn_*`/`aivault_*`/`pedia_*`/`games_*` aktif) wajib memanggil `bumpCatalogRevision` dengan scope yang sesuai (`market` / `pedia` / `games`). Perbaikan konsistensi invalidasi (18 Nov): (1) `/api/admin/fulfillment` (`import`/`DELETE`) mem-bump `market` **setelah** `syncUniqueVariantStock` menyinkronkan `product_variants.stock`; (2) `publishTunvnCatalog` tetap mem-bump `market` bila mutasi katalog sudah commit sebelum `buffError`; (3) `syncProducts` (WR) & `syncSkProducts` (SK) ikut memicu `bumpCatalogRevision("market")` maks 1×/run saat metadata katalog berubah (`description`, `label`, `duration_*`, `warranty_*`, `compare_price`); (4) `POST/PUT/DELETE /api/admin/supplier-links` mengosongkan memo `supplier_links` (`clearSupplierLinksMemo()`) sebelum bump `market`; (5) `POST /api/pedia/orders` guard margin (`410`) ikut mem-bump `pedia`. Scope B-H tidak mengubah `/api/catalog`, `/api/games/catalog/[slug]`, PDP, `wrangler.json`, `fulfillment/delivery/**`, maupun `mcp-worker/`.
- **Lanjutan B-C (18 November 2026, lokal):** `GET /api/catalog` (scope `market`, TTL `120` dtk `?slug=` / `300` dtk daftar, tetap locale-neutral) kini memakai `cachePublicCatalog` (`GET /api/games/catalog/[slug]` tetap `private, no-store`, tidak di-cache); emisi funnel `view` berjalan di luar loader pada status `200` baik `HIT` maupun `MISS` (tetap skip probe sintetis; 404 tidak di-cache).

### A-S probe sintetis — 18 November 2026 (lokal)

- Home/katalog/quote sebelum `CRON_STEPS`, outcome `synth:*`
  memakai F1/KV existing (hard2/soft6/recovery3/reminder6jam), bukan alarm kedua.
- Timeout10detik/fase mencakup body/PDP, plafon20detik independen dari job berat.
  Probe dapat menunda job order hingga20detik, bukan mengurangi/menghentikannya.
  Skip budget internal `alarm:none` tidak dianggap sukses/tidak mereset counter.
- Quote synthetic wajib header1+Bearer cron secret constant-time;0D1write,
 0kuota pembeli/admission/reservasi/funnel,0provider fetch (gateway excluded,
  crypto/FX snapshot-only). Guard `isSyntheticRequest` dapat dipakai B-S.
 200 memerlukan token+QRIS lokal available;409 issues valid sehat. Katalog
  menerima ID integer positif aman atau string desimal kanonik; jika kosong/rusak
  tetap hard dan quote dilewati (`catalog_unavailable`, `alarm:none`).
  Maks3PDP dinamis, tidak ada ID hardcode.
- Tambahan3–6request/tick (umumnya4=5760/hari), bukan0read atau +3pasti.
  Tidak ada env/secret/binding/trigger/migrasi baru, tanpa transaksi produksi.
  Rincian/batas target: ARCHITECTURE A-S dan PAID-OPERATIONS. Belum deploy.
### Ringkasan harian Telegram 07.00 WIB & backup harian D1 → R2 — 18 November 2026 (lokal, Paket A-H)

- **Ringkasan harian admin (`src/lib/telegram/daily-admin-summary.ts`):** menumpang `POST /api/cron/lite?job=promo` existing (impor dinamis di `runPromo`; tanpa env/cron/migrasi baru), hanya aktif saat `TELEGRAM_BOT_ENABLED=true`, `TELEGRAM_ADMIN_CHAT_ID` & `TELEGRAM_BOT_TOKEN` terisi, pada jendela `07:00–11:59 WIB` (catch-up bila tick 07.00 gagal; lewat 11:59 WIB dilewati hari itu). Memakai memo per-isolate (`unwrapD1` di `src/lib/db-access.ts`, 0 statement setelah terkirim) + CAS `store_settings.admin_daily_summary_state` (klaim 120 dtk; lepas bila kirim gagal; budget ≤12 statement D1). Isi 5 seksi HTML aman: (1) order lunas/omzet kemarin WIB per kanal + kadaluarsa/dibatalkan, (2) order lunas >30 menit macet + rekonsiliasi QRIS perlu cek, (3) saldo tersimpan WR/SK/IndoSMM/TUNVN/AIVault tanpa memanggil API supplier (`supplier-balance-alert.ts` kini menyimpan `<supplier>_balance_last_value` di upsert sukses yang sama tanpa statement ekstra), (4) sumber sync yang kini basi & sempat basi dalam 24 jam terakhir (`sync-staleness.ts` mempertahankan `last_stale_at`/`last_recovered_at` di JSON `sync_stale_state_*` tanpa statement ekstra), (5) maks 5 produk terlaris 30 hari berstatus aktif non-pecundang dengan stok efektif (`effectiveVariantStockSql`) `0..2`.
- **Backup harian D1 → R2 (`scripts/d1-backup-r2.cjs`, `.github/workflows/d1-backup.yml`):** berjalan harian `19:23 UTC` (`02:23 WIB`) + `workflow_dispatch` memakai Secrets CI existing (`CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, `CLOUDFLARE_ACCOUNT_ID`). Mengekspor `axvara-db` lewat REST API polling (`at_bookmark`→`current_bookmark`), memvalidasi ukuran minimal (`≥10.000` byte), `CREATE TABLE` tabel inti (`orders`, `products`, `payment_transactions`, `fulfillment_items`), dan terminasi `;` (anti-terpotong), mengompresi `gzip -9` + `SHA-256`, lalu mengunggah via `wrangler@4.128.0 r2 object put --remote` HANYA ke bucket privat `axvara-db-backups` (`daily/YYYY/MM/axvara-db-<ISO>.sql.gz`; menolak `axvara-assets`). Tidak pernah mencetak signed URL, isi dump, atau kredensial; `GITHUB_STEP_SUMMARY` hanya memuat key, ukuran raw/gzip, SHA-256, dan durasi.

### Penegakan batas D1 di fixture & hardening query/trigger — 18 November 2026 (lokal, F4)

- `tests/helpers/d1-fixture.ts` menegakkan batas D1 yang terverifikasi di `workerd` Miniflare: maks **100** bound parameter per statement (`>100` melempar `D1_ERROR: too many SQL variables`) dan maks **50 byte UTF-8** untuk pola `LIKE`/`GLOB` literal maupun bound `?` (`>50` melempar `D1_ERROR: LIKE or GLOB pattern too complex`).
- Query `IN (...)` berkapasitas >100 (`zeroSkVariantsByIds`, `zeroVariantsByIds`, `applyPediaDiff`, `revokeInventoryBatch`) wajib di-chunk ≤50 ID/statement (menyisakan ruang parameter non-ID) atau memakai `json_each(?)` (`publishTunvnCatalog`), tanpa `.catch(() => [])`; pencarian admin panjang memakai `INSTR(LOWER(...), ?) > 0` alih-alih `LIKE ?`.
- Migrasi `0133_payment_invoice_history_upsert.sql` mengganti `INSERT OR IGNORE` pada trigger `payment_invoice_history_{insert,update}` menjadi `ON CONFLICT(provider, order_code, payable_amount) DO NOTHING` agar aman di bawah `UPSERT` luar pada `payment_transactions`.

### Penanda sukses sync, 503 subjob inti cron lite, & watchdog basi — 18 November 2026 (lokal)

- Penanda sukses `<sumber>_success_at` (ms epoch `store_settings`) + error tersanitasi `<sumber>_last_error` (≤200 char, tanpa secret) ditulis lewat `src/lib/sync-status.ts` HANYA sesudah mirror + publish/proyeksi penuh berhasil (`tunvn_catalog`, `aivault_catalog`, `jaspay_catalog`, `games_sk_catalog`, `games_catalog`, `pedia_indosmm_balance`); checkpoint klaim throttle tetap ada. Saldo supplier (`supplier-balance-alert.ts`) mencatat `<supplier>_balance_error` `{ at, error, streak }` pada kegagalan beruntun tanpa alert baru, dan `<supplier>_balance_last_ok_at` saat sukses.
- Pengecualian TUNVN: kesehatan katalog akun dan probe Muse Buff terpisah. Jika akun sukses namun Buff gagal, respons cron tetap `ok:true` dengan `buff_error`; error akun tetap 503. Watchdog dan ringkasan membaca penanda Buff terpisah dalam query setting yang sama. Detail di aturan TUNVN.
- `src/app/api/cron/lite/route.ts`: kegagalan subjob inti (`payments` pass NOWPayments/Sekalipay gateway, `pedia_orders` dispatch, `notify*` `telegram_retry`/`whatsapp_outbox`) tetap menjalankan subjob lain lalu membalas `503` `{ ok: false, failed_subjobs }` tanpa menulis `cron_lite_*_ok_at`. Yield `QueryBudgetExceeded` dan error subjob opsional tetap `200`.
- `src/lib/sync-staleness.ts` dipanggil di akhir `runCleanup` (`job=cleanup`, guard `db.canSpend(6)`) tanpa env/migrasi baru: memantau sumber aktif (SK, Jaspay, TUNVN, AIVault, Games SK, Pedia IndoSMM diff bila ada penanda, FX `crypto_market_snapshot`; WR tetap ditangani `alertStaleWrSync` agar tidak alert ganda) dengan CAS episode di `store_settings`, grace 1 jam bila belum pernah sukses, pengingat 6 jam, dan notifikasi pulih ke `TELEGRAM_ADMIN_CHAT_ID` saat `TELEGRAM_BOT_ENABLED=true`.
### Alarm cron per step — 18 November 2026 (lokal, F1)

- Revisi P2 lokal: baca ulang KV setelah pipeline sebelum commit, gabung hanya
  outcome due milik tick; watermark `lastScheduledTime` per label (termasuk
  sukses/recovery) membuat hasil :00 terlambat tidak menimpa :01–:05. Ack Telegram
  baca ulang agar counter baru selama kirim tidak tertimpa snapshot lama.
  KV tanpa CAS/eventual consistency masih punya race get/put pendek lintas
  isolate yang diterima PM. Bukan lock/linearizability; tidak menambah DO/binding.
  Watermark sukses menyebabkan write KV tiap tick sehat (~1440/hari), bukan D1.

- `CRON_STATE` key `cron_alarm_v1` menyimpan counter per label step: hard setelah2
  dan soft setelah6 **eksekusi gagal beruntun step itu**. Tick non-due/step absen
  tidak mengubah counter; hanya respons sukses step yang sama mereset kegagalan.
  Campuran hard/soft tidak saling mereset. Episode pulih setelah setiap step
  terdampak mempunyai3 eksekusi sukses beruntun, bukan3 tick penjadwal umum.
- `publish-scheduled` tetap POST path/header existing setiap5menit, kini masuk
  pipeline outcome sebagai soft. Trigger menit, urutan job lite/order, cadence
  katalog dan heavy hourly tidak berubah; tidak ada env/binding baru.
- Non-2xx membawa field JSON `error` (fallback teks), diringkas maksimal120karakter
  sesudah redaksi bearer/token/key/secret dan secret Worker yang diketahui.
  Error jaringan/KV juga diredaksi. Body sukses tetap hanya menentukan `more`.
  Reminder6jam mencakup step baru yang gagal sejak pesan terakhir, termasuk yang
  kemudian pulih; riwayat recovery tidak dipotong8step. Tidak ada pesan tambahan
  setiap tick untuk perubahan identitas failure.
- Binding hilang, state korup, get/put gagal → log tersanitasi + fallback stateless
  hard **dan** soft pada :00/:30. Key belum ada bukan error. Ketika storage pulih,
  counter stateful kembali berjalan; tidak menganggap fallback sebagai ack KV.
- Write counter diverifikasi sebelum pengiriman; ack start/reminder/recovery
  hanya ditulis setelah Telegram berhasil. Ack gagal dapat menyebabkan pesan
  ulang pada tick berikut (KV+Telegram bukan transaksi atomik). Payload agregat
  lama tanpa `steps` mulai counter baru sekali, tanpa membuat recovery palsu;
  atribusi counter lama ke step tidak dapat dipastikan. Belum dipublikasikan.

### Sinkronisasi katalog 1 menit & drain grup segera — 17 November 2026 (lokal)

- `mcp-worker/src/cron.ts` menghapus `everyMinutes: 3` pada `lite:tunvn_catalog` dan `lite:aivault_catalog` sehingga keduanya berjalan setiap 1 menit di trigger `* * * * *` existing (`jaspay_catalog` tetap tiap menit). `cleanup` tetap 5 menit dan `games_catalog` tetap 10 menit.
- `src/app/api/cron/lite/route.ts` menambah `drainDirtyGroupsIfBudget(db, result)` setelah run `aivault_catalog`, `tunvn_catalog`, dan `jaspay_catalog` yang sukses (tidak skipped/503): memeriksa `db.canSpend(4)`, memanggil `decideDirtyWinners(db)` dari `@/lib/supplier-pairs`, menulis `pairs_decided` + `pairs_changed`, dan mengisolasi error non-`QueryBudgetExceeded` agar job katalog tetap 200. `decideDirtyWinners(db)` di `runCleanup` tetap sebagai backstop 5 menit.
- Budget statement tidak berubah (`jaspay_catalog` 96, `tunvn_catalog`/`aivault_catalog` 40). Implementasi Pages/Workers masih lokal + test (belum deploy ke Pages/Workers); diff sync 1 menit `axvara-wr-proxy` sudah dideploy ke VPS pada 18 Nov 2026 (`dist.backup-diff1m-20261118`, `sha256sum` cocok, `/health` 200, `"diff sync started (1 min)"`).

### Retry metadata Cloudflare —17November2026 (lokal)

- Shared GET metadata subscriptions + project Pages: maksimal3 percobaan,
  timeout30detik/percobaan, backoff500/1000ms hanya untuk transport/timeout atau
  HTTP408/429/5xx. Auth4xx/metadata/entitlement/kapasitas tetap fail-closed.
- Tidak me-retry write/GraphQL/migrasi/deploy, tidak mengubah env atau secret.
  Diagnosis CLI hanya alasan lokal/status HTTP aman; jangan log respons mentah.
- CI44096428572 gagal di guard metadata; alasan spesifik tidak disimpan log lama.
  Cek baca-saja17Nov lulus Paid88/128 (84+4), bukan bukti deploy atau izin bypass.

### Pengingat tinjauan S&K supplier —17 November2026 (lokal)

- Job lite `cleanup` lima-menitan existing menjalankan cek perubahan copy WR/SK
  setelah drain grup, sebelum refresh crypto. Budget tetap40; hanya jalan bila
  `db.canSpend(4)`. Empat statement maksimal: setting read/CAS/SELECT varian/map
  write. Tidak menambah trigger, env, secret atau migrasi; order tetap terpisah.
- `copy_review_checked_at` CAS di `store_settings` membatasi cek30menit dan satu
  pemenang run bersamaan. `copy_review_alerted` menyimpan JSON variantId→supplierKey
  hanya setelah Telegram `ok:true`; kirim gagal tidak mengubah map dan retry pada
  jendela berikutnya. Prune tanpa kirim boleh untuk varian yang bukan `changed`.
- Error terisolasi dalam hasil log `copy_review`, bukan kegagalan cleanup.
  Budget sibuk dapat menunda; jangan menaikkan budget atau menambah cron untuk
  mengatasinya. Detail/batas exactly-once dan mock QA ada di ARCHITECTURE §16.53;
  implementasi lokal, bukan bukti deployment atau pesan produksi.

### Keuangan admin: pengeluaran + untung bersih —16 November2026

Migrasi0130 menambah `operating_expenses`/`expense_recurring` dan kurs beku link
TUNVN/AIVault. Template berulang dimaterialisasi di job lite `cleanup` existing
(idempoten UNIQUE, maks3 bulan susulan, budget-aware); tanpa jadwal cron/env baru.
Cache Ringkasan memakai `store_settings.finance_revision` (trigger) + nilai MDR di
kunci snapshot; jangan menghapus trigger itu tanpa mengganti invalidasi cache.
Jangan menghapus order lama yang gagal di supplier untuk "membersihkan" laporan:
modal link `failed` tanpa link completed sudah Rp0.

### Jaspay katalog multi-produk per tick —16 November2026

Keputusan owner (Workers Paid): job lite `jaspay_catalog` memakai budget **96**
(sama dengan `fulfillment`; job lite lain tetap40) dan plafon10 produk/tick.
Cursor `wr_sync_state.jaspay_catalog_cursor` berputar wrap-around tanpa memproses
produk dua kali per tick dan kini memperbarui `updated_at`. Berhenti karena
budget sesudah >=1 produk = batas tick normal; cadangan4 statement disisakan
agar zero-missing (seen-set feed penuh) tetap jalan. Siklus11 produk ±3 tick
(sebelumnya ±11). Tanpa trigger/env baru; fetch feed tetap satu per tick.

### Antrean grup produk —16 November2026

Migrasi0129 menambah `product_group_dirty(group_id,version,pending)` menggantikan
antrean pasangan untuk keputusan katalog. Shim mempertahankan request/response
`action:pairs` dan cron existing; tanpa env/jadwal baru. Satu SELECT statistik,
drain maksimal10 **grup utuh**, bukan10 anggota. Budget existing, CAS versi pada
write+ack dan token tetap setelah ack wajib; error tidak dianggap daftar kosong.
Grup yatim juga dikuras. Trigger inventory/minimum/durasi/modal/FX/aktivitas/
anggota/prefer menjaga keputusan; mirror TUNVN/AIVault hanya grup terkait.
Status lokal (termasuk migrasi+replay D1/workerd), bukan bukti penggunaan atau
deployment produksi. Lihat ARCHITECTURE “Grup produk lintas supplier”.

### Batas pola LIKE/GLOB di D1 — 15 November 2026

- D1 produksi menolak literal `LIKE`/`GLOB` panjang (`LIKE or GLOB pattern too
  complex`, SQLITE_ERROR 7500; batas 50 byte) walau SQLite lokal/test lulus.
  Migrasi 0127 gagal di CI #713 dan #714 karenanya (rollback; deploy terhenti).
  #712 dibatalkan setelah push berikutnya sesuai `cancel-in-progress`, bukan
  kegagalan migrasi. Batas resmi: https://developers.cloudflare.com/d1/platform/limits/.
- Untuk mencocokkan teks panjang pakai `substr(col, -N)=…`, `instr`, atau
  kesamaan penuh. `tests/d1-migration-like-limit.test.ts` menolak literal >50
  byte di semua migrasi. Cek ekspresi baru dengan SELECT baca-saja bila ragu.

### Katalog Jaspay otomatis — 14 November 2026 (implementasi lokal)

- Worker menambah langkah lite `jaspay_catalog` pada trigger menit existing,
  sesudah seluruh job order, satu produk/tick dengan cursor durable dan budget40
  (cadangan2). Tidak menambah trigger jadwal/env/secret. Heavy sync existing
  tetap cadangan; hasil snapshot10 produk baru lengkap setelah hingga10 tick
  sukses, bukan segera terverifikasi live saat push.
- Progress aman menambah satu query hanya untuk order Jaspay; non-Jaspay tetap
  memakai jumlah read sebelumnya. Akun/kredensial tidak masuk JSON progres.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

### Workers Paid dan unit unik — 2026-10-23

- Revisi10November2026 lokal: Worker menambah job lite `tunvn_catalog` tiap3menit
  sesudah order, budget40/soft alarm existing; tanpa trigger/env baru. Mirror+
  proyeksi memesan sisa statement sebelum write. Detail aturan TUNVN/ARCH16.34;
  bukan bukti deployment. `tunvn_orders` tetap per tick menit secara terpisah.
- Paket Workers Paid aktif pada akun existing; CI membaca metadata langganan melalui `scripts/cloudflare-plan.cjs`, tanpa env/secret baru. Preflight variabel mengikuti Paid128/Free64; API/metadata gagal menghentikan rilis.
- Cron MCP existing setiap menit: payments/expiry/fulfillment/WR/SK/Pedia/notify/promo; cleanup dan publish artikel tetap lima menit, heavy hanya menit00. Tidak menambah trigger atau loop polling server tanpa batas. Cadangan KlikQRIS maksimal empat GET invoice aktif per tick, bukan create/reissue; validasi otoritatif dan late-payment manual tetap.
- Fulfillment lite mempunyai budget96 statement dan maksimal empat unit/job; job lain tetap40. Jalur immediate multi-unit yield sesudah40 detik sebelum unit berikutnya untuk menjaga lease. Jangan meniadakan budget, lease, snapshot, atau dedupe supplier.
- Unit unik baru ditandai server `unique_units:true` dan mode unique dalam `orders.items` yang tetap teragregasi. Manifest menambah unit ekstra SESUDAH index baris asli agar link supplier tetap benar. Total maksimal10 di web/Telegram, reservasi qty utuh atomik, bukan memotong stok dahulu lalu memilih satu akun. Jangan memecah/menulis ulang order lama, membuka DM WA, atau membeli ulang unit gagal.
- Monitor D1 memakai periode Paid dari metadata dan jatah25miliar baca/50juta tulis per bulan; Free tetap harian. Proyeksi bukan invoice, dapat mencakup pemakaian Free sebelum upgrade. Alert budget eksternal tetap email, tanpa pemutusan layanan.
- Rincian kontrak/rollback: `docs/PAID-OPERATIONS.md`, `docs/UNIQUE-UNITS.md`. Pengujian memakai fixture tanpa transaksi supplier berbayar.

### Operasional D1 lanjutan — 2026-10-17
- Migrasi 0068 menambah indeks inventory/recipient dan `supplier_pair_dirty`.
  Trigger invalidasi atomik mengganti token versi; ack hanya menyetel pending=0,
  jangan menghapus/reset token (pelindung race terhadap proses/sweep lama).
- Request VPS `action:pairs` tetap bentuk existing, kini menguras maksimal 10
  pasangan pending; error 503 menyisakan antrean. Cron lite cleanup existing
  juga menguras antrean tiap tick selama budget cukup, termasuk perubahan WR
  saja/retry; sweep penuh hourly tetap cadangan, tulisnya dijaga versi.
- `.github/workflows/d1-usage.yml` HANYA baca GraphQL Analytics akun per jam
  pada menit 17/manual; tidak query SQL/deploy. Memakai Secrets CI existing,
  laporan agregat dan warning/job gagal untuk risk/exhausted/unknown. Notifikasi
  mengikuti pengaturan GitHub owner; tidak ada pesan Telegram monitoring baru.
- **Historis (era Free):** target ≤3 juta reads/hari harus diukur satu siklus 07.00–07.00 produksi,
  jangan menyamakan hasil benchmark fixture atau push dengan bukti tercapai.
