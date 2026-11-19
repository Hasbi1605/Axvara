# Operasional Workers Paid — 23 Oktober 2026

## Wave 1: Penghapusan batas hemat era Free (`W1`) — 19 November 2026 (lokal, belum deploy)

Aturan utama Workers Paid (keputusan owner 19 Nov 2026): hilangkan batas hemat era Free (budget 40 statement, cap 4/tick, cooldown 60 dtk, probe kuota harian D1 di middleware) selama tetap berada dalam kuota Paid (25 miliar baca / 50 juta tulis per bulan) dan batas rate limit eksternal:

- **A1 Budget cron:** `cron/lite` naik `40 → 300` statement (umum) dan `96 → 400` (`fulfillment`, `jaspay_catalog`); `cron/operations` `QUERY_BUDGET` naik `40 → 300` (runaway guard tetap aktif + deadline 45 dtk; budget terpisah `runPromo` broadcast `400` tidak diubah).
- **A2 Rekonsiliasi pembayaran latar:** `KLIKQRIS_BACKGROUND_LIMIT` `4 → 20`, `NOWPAYMENTS_BACKGROUND_LIMIT` `4 → 20`, `NOWPAYMENTS_LATE_LIMIT` `4 → 20` (jendela 6 jam tetap); Sekalipay gateway live `4 → 12` (`SEKALIPAY_GATEWAY_BACKGROUND_LIMIT = 12`), late tetap `4` (`SEKALIPAY_GATEWAY_LATE_LIMIT = 4`), stale tetap `5` (`SEKALIPAY_GATEWAY_STALE_LIMIT = 5`) agar tidak menghabiskan admission global `sekalipay_gateway_status_budget` 20 GET/menit.
- **A3 Polling & cooldown non-QRIS:** `/pesanan/[code]` non-QRIS dinamis `30 dtk → 8 dtk` (7,5 req/mnt/tab, di bawah `orders:lookup` 20/mnt); cooldown server `claimSekalipayGatewayPoll` & `NOWPAYMENTS_POLL_RECONCILE_MS` `60 dtk → 20 dtk` (≤3 GET/mnt/order; aturan late 6 jam `-21600` dtk tetap).
- **A4 Plafon per tick & email Resend:** `EXPIRY_PER_RUN` `10/4 → 30`, `ORPHAN_LEDGER_PER_RUN` `10 → 30`, `FULFILLMENT_PER_RUN` `4 → 20` (`processJobItems` lite `4 → 10` unit/job + cek deadline), WR/SK order `4 → 20`, Jaspay ambiguous `4 → 12`, `refreshDueSupplierOrders` `4 (max 8) → 12 (max 20)`, SK stale `3 → 12`, WR orphan delivery `4 (max 8) → 20`, Telegram retry/reminder `4 → 20`, invoice retry `2 → 12`. Loop email (`processCredentialAccessEmails` `2 → 15`/max `20`, `sendQrisExpiryNotifications` `2 → 15`, WR/SK credential email `4 → 15`/max `20`, `pedia/notify-retry` `RETRY_LIMIT` `2 → 6`) diberi jeda `1.000 ms` antaremail di produksi agar tetap ≤1 req/dtk di bawah batas default Resend (2 req/dtk/tim). `processDueWhatsAppOutbox` tetap `4`/tick (pacing anti-ban WA 6–9 dtk).
- **A5 Route admin interaktif:** 7 endpoint POST admin (`aivault/{orders,publish}`, `mirai/{orders,publish}`, `storebat/{orders,publish}`, `tunvn/orders`) beralih dari `createBudgetedDatabase(40, 0)` ke `createDatabaseAccess()` unbudgeted.
- **A7 & A8 Interval ringan:** `CRYPTO_REFRESH_AFTER_MS` `30 mnt → 10 mnt` (tetap serial FX + concurrency ≤2 sesuai G2), `CRYPTO_MARKET_MEMO_MS` `60 dtk → 15 dtk`; cek saldo TUNVN/AIVault/StoreBat/Mirai/IndoSMM `30 mnt → 5 mnt`; cek saldo WR/SK `60 mnt → 10 mnt` (juga dijalankan di `cron/lite` `wr_orders`/`sk_orders`, throttle alert 6 jam/drop-step tetap).
- **A11 Probe kuota harian D1:** `isD1InMaintenance` dihapus dari hot path `src/middleware.ts` (tidak ada lagi round-trip D1 per jendela 60 dtk di setiap halaman SSR; modul `d1-maintenance.ts` + rute `/maintenance` tetap untuk kompatibilitas).

## Queue pengiriman siaran/promo (`axvara-broadcast`, BQ1) — 19 November 2026 (lokal, belum deploy)

- `wrangler.json` menambah producer binding Pages `BROADCAST_QUEUE` → `axvara-broadcast`; `mcp-worker/wrangler.toml` menambah consumer `axvara-broadcast` (`max_batch_size = 10`, `max_batch_timeout = 1`, `max_concurrency = 1`, `max_retries = 3`, `dead_letter_queue = "axvara-broadcast-dlq"`) dan DLQ `axvara-broadcast-dlq` (`max_batch_size = 10`, `max_batch_timeout = 5`, `max_retries = 2`, log+ack saja). Resource Queue wajib dibuat PM sebelum deploy.
- Origin `POST /api/internal/queue/broadcast` (DB unbudgeted Paid, 2 statement/penerima hot path, lease global + CAS per delivery, pacing TG 300 ms chat sama / 250 ms antarpenerima, Email 650 ms) memproses ~388 penerima Telegram dalam ≤ ~5 menit. Batas Free pada `processBroadcasts` dihapus; `cron/lite?job=promo` menyediakan backstop dengan budget terpisah 400 statement + ~40 detik/tick (grace 2 menit saat queue aktif; WA tetap segera). Saklar `store_settings.broadcast_queue_mode = 'off'` mengembalikan ke cron-only.

## Consumer Queue pengiriman instan & DLQ (`axvara-mcp`, Paket C-H) — 18 November 2026 (lokal, belum deploy)

- `mcp-worker/wrangler.toml` menambahkan dua consumer Queue (`axvara-order-fulfillment` dengan `max_batch_size = 5`, `max_batch_timeout = 1`, `max_retries = 4`, `dead_letter_queue = "axvara-order-fulfillment-dlq"`; serta `axvara-order-fulfillment-dlq` dengan `max_batch_size = 5`, `max_batch_timeout = 5`, `max_retries = 2`) dan variabel `QUEUE_CONSUMER_MODE = "active"`.
- `mcp-worker/src/queue.ts` (diekspor melalui `queue()` di `mcp-worker/src/index.ts`) memproses batch paralel terbatas (`≤ 5`), timeout fetch `45` detik ke `POST /api/internal/queue/fulfill` (`Bearer AXVARA_CRON_SECRET`), backoff `5/15/45/120` detik, `settled: false` di `attempts ≥ 5` → log error `unsettled_to_dlq` dan retry agar masuk DLQ existing (`max_retries=4`, cron backstop tetap), validasi skema ketat pra-fetch, sakelar darurat `QUEUE_CONSUMER_MODE = "off"` (`ack()` tanpa fetch), serta alert Telegram admin tersanitasi pada DLQ (`ack()` hanya setelah Telegram berhasil; gagal kirim → `retry()`). Resource Queue dibuat manual oleh PM sebelum push; producer Pages dan endpoint origin dikerjakan di paket C-S.

Rollback P2: endpoint non-dry-run membaca mode D1 segar, bukan memo producer30s;
off/shadow/canary tidak cocok/absen → `queue_disabled`+ack. Pass sudah dimulai
tetap dapat memulai sub-pekerjaan sampai deadline40s dan I/O tidak dibatalkan.
blocked_balance retry sesuai next_attempt_at, unknown/unfenced status manual.
Retry memproses WR/SK existing; SK delivery mencoba semua completed sampai
deadline, notice eligible belum sent tetap pending. Tidak ada resource/env baru.

## Cache katalog berbasis revisi (Paket B-H) — 18 November 2026 (lokal, belum deploy)

- `src/lib/catalog-cache.ts` memindah cache edge ke namespace `d1-v2` yang dikunci oleh `catalog_revision_market`, `catalog_revision_pedia`, dan `catalog_revision_games` (`store_settings`), dengan memoization per-isolate `REVISION_MEMO_TTL_MS = 5_000` ms (`WeakMap<D1Database, ...>` via `unwrapD1`) sehingga pembacaan revisi maksimal 1 query / `≤3` `rows_read` per 5 detik per isolate aktif (~50–150 ribu `rows_read`/hari) dan staleness maksimum lintas lokasi `≤5` detik (0 detik pada isolate yang sama).
- TTL `caches.default` dinaikkan ke Market list `300` dtk, `?slug=` `120` dtk, kategori `600` dtk, snapshot Telegram `180` dtk, Pedia `300` dtk, dan daftar Games `/api/games/catalog` `300` dtk (mempertahankan `Cache-Control` browser asli `5–30` dtk via `X-Axvara-Origin-Cache-Control` agar CDN/browser tidak mewarisi TTL internal). Estimasi dampak setelah rilis + selesainya paket B-S (`/api/catalog`, `/api/games/catalog/[slug]`, PDP deduplication): penghematan baca D1 katalog ~65–80% (~400–550 juta `rows_read`/30 hari; belum diukur di produksi).
- `bumpCatalogRevision(scope)` menulis maksimal 1 baris (`INSERT ... ON CONFLICT DO UPDATE`, ~200–500 tulis/hari atau <0,03% kuota 50 juta `rows_written`/30 hari) HANYA ketika mutasi nyata (`changed > 0`), bukan pada no-op sync/tick. Rincian kontrak: ARCHITECTURE §16.58.

## Probe sintetis A-S — 18 November 2026 (lokal, belum deploy)

Sebelum seluruh job existing: home dan produk paralel, kemudian0–3PDP dinamis
dan quote. Tiga outcome masuk F1 yang sama: error/timeout/kontrak hard2;
sukses>4000ms soft6; reminder6jam/recovery3 tetap. Timeout10detik per fase
(termasuk body dan PDP+quote), total20detik independen dari durasi tick berat.
Job order dapat tertunda hingga20detik, tidak dipotong. Budget internal habis
mencatat skip `alarm:none` tanpa mengubah counter (bukan status sehat). ID
daftar katalog boleh angka atau string desimal kanonik. Katalog kosong/rusak
tetap gagal; quote yang bergantung padanya dilewati (`catalog_unavailable`,
`alarm:none`). 409 quote terstruktur sehat bila tidak ada target layak/stok berubah.

Autentikasi synthetic: header1+Bearer secret cron existing constant-time,
tanpa secret valid tetap rate limit pembeli. Quote memakai metode lokal dan
snapshot crypto/FX saja (`includeGateway=false`), **0 fetch provider**;200 wajib
token+QRIS available. Tidak menguji kesehatan gateway/crypto eksternal.
JWT stateless dan SELECT-only fixture membuktikan **0 D1 rows_written/quote**
(termasuk0quote/rate-limit/admission/order/reservasi), sehingga1440/hari tetap0
write quote; read produk/varian/metode/FX dan cache katalog tetap berbiaya.
Tidak ada funnel emitter baseline; helper guard tersedia untuk B-S.

Request tambahan3–6/tick (3 dasar+0–3PDP), umumnya4/tick=5760/hari=172800/30hari;
plafon6/tick=8640/hari=259200/30hari, sebelum skip/timeout. F1 dapat menulis KV
untuk counter/episode, bukan D1; tidak ada state alarm kedua/env/trigger baru.
CSP publik menyiapkan dua origin Analytics saja; belum aktivasi dashboard.
Rincian target, body contract dan batas bukti: ARCHITECTURE bagian A-S.

Alarm F1 P2: watermark waktu jadwal tiap label bertahan setelah sukses/recovery;
baca ulang KV ketika commit/ack Telegram lalu merge hanya step due yang lebih
baru, sehingga hasil tick :00 lambat tidak menggulung :01–:05. Hard2/soft6/
recovery3/reminder6jam tetap. KV eventual tanpa CAS masih punya race get/put
pendek lintas isolate yang diterima PM, bukan exactly-once/linearizable. Write
watermark tiap tick sehat ~1440/hari (KV, bukan D1); tidak ada DO/binding baru.

✅ Implementasi, publikasi melalui CI push main. Akun existing sudah Paid;
verifikasi lokal bukan bukti deployment atau batas biaya produksi tercapai.

Webhook tetap memverifikasi payment melalui API provider lalu langsung
memproses fulfillment/supplier. Tidak ada bypass status, reissue otomatis,
perubahan rail invoice lama, atau perpanjangan batas bayar 15 menit.

| Pekerjaan | Jadwal/batas |
|---|---|
| MCP scheduler | Setiap menit, CPU maksimal1000ms/invocation |
| KlikQRIS cadangan tanpa browser | `lite?job=payments`, maks 20 invoice pending/aktif terlama sejak pemeriksaan (W1, sebelumnya 4), GET saja; jendela 60 detik, CAS existing 10 detik |
| Expiry, fulfillment, WR/SK, Pedia, notify A/B, promo, Jaspay/TUNVN/AIVault catalog | Setiap menit; tanpa jeda 2 detik peninggalan Free (revisi lokal 17 Nov 2026 untuk TUNVN/AIVault dari 3 menit ke 1 menit, probe Buff TUNVN tetap 3 menit di cron; belum deploy) |
| Fulfillment cadangan | Budget 400 statement/invocation (W1, sebelumnya 96), maks 20 job dan maks 10 unit/job (+ deadline 45 dtk), lease/retry existing |
| Lite lain | Budget 300 statement (W1, sebelumnya 40; `jaspay_catalog` 400); runaway guard tetap aktif bersama deadline 45 dtk |
| Cleanup dan publish artikel | Lima menit |
| Ringkasan harian admin (`job=promo` existing) | Sekali/hari 07:00 WIB (catch-up s.d. 11:59 WIB, ≤12 statement D1, CAS `store_settings.admin_daily_summary_state`) |
| Backup harian D1 → R2 (`.github/workflows/d1-backup.yml`) | Sekali/hari `19:23 UTC` (`02:23 WIB`) + `workflow_dispatch` ke bucket privat `axvara-db-backups` (retensi 30 hari `daily/`) |
| Route besar/sweep katalog | Hanya menit00 UTC, bukan menit01–04; chunk maksimum10/fase |
| Request scheduler ke origin | Timeout45 detik, tanpa retry POST; server mungkin masih menyelesaikan kerja dengan lease existing |
| Supplier refresh WR/SK | Webhook/poll pembeli + cadangan setiap menit; gerbang CAS20 detik, termasuk batch cron |
| Supplier Pedia baru berjalan | Poll60 detik selama15 menit;120 detik hingga satu jam;300 detik sesudahnya |
| Pedia gagal/unknown status | Backoff300 detik, tanpa add/failover baru; klaim sebelum GET status |
| Halaman Pedia | Pending5 detik, berjalan10 detik; hidden berhenti, kembali terlihat cek segera; terminal/needs_check berhenti |

Callback, halaman dan cron dapat bersamaan. Transisi paid/outbox, klaim
inventory, item/job lease, gerbang refresh dan dedupe provider tetap berlaku.
Klaim submitting Pedia tetap lima menit; timeout/ambigu tetap needs_check.
Kasus late payment tetap rekonsiliasi manual. Kecepatan akhir mengikuti
provider, jaringan, antrean dan kanal email; satu menit bukan SLA penyelesaian.

## Biaya dan observasi

Sembilan lite job setiap menit + cleanup lima menitan =13.248 request
origin/hari. Dengan scheduler, publish dan seluruh chunk hourly pada plafon,
perkiraan batas request penjadwalan sekitar15.600/hari atau468.000/30 hari,
belum trafik pembeli/bot. Ini perhitungan jadwal, bukan metering tagihan.
Tidak ada panggilan gateway ketika tidak ada invoice due; pekerjaan berat
katalog tidak dipercepat. Jatah Workers Paid10juta request dan30juta CPU-ms
per bulan harus tetap diukur; jumlah request saja tidak membuktikan biayaCPU.
Revisi 17–18 Nov 2026: `tunvn_catalog` dan `aivault_catalog` naik
dari 3 menit menjadi setiap 1 menit (+1.920 request origin/hari dibanding 3 menitan),
probe Buff TUNVN cron tetap 3 menit (`tunvn_buff_sync_at`), dan `aivault_catalog` /
`tunvn_catalog` / `jaspay_catalog` langsung menguras `decideDirtyWinners` saat
sukses dengan `db.canSpend(4)` (backstop `cleanup` 5 menit tetap ada). Sisi
Pages/Workers masih lokal (belum deploy); diff sync 1 menit di `axvara-wr-proxy`
sudah terpasang di VPS pada 18 Nov 2026 (`dist.backup-diff1m-20261118`, `/health`
200, `"diff sync started (1 min)"`).

`scripts/cloudflare-plan.cjs` membaca langganan account. D1 monitor memakai
awal/akhir periode aktual dan jatah25miliar rows read/50juta rows written pada
Paid, bukan hard cutoff harian Free. Total Analytics bisa mencakup pemakaian
Free sebelum upgrade; tidak dihitung sebagai nilai invoice pasti. API,
periode atau dataset tidak lengkap tetap gagal/unknown. Preflight Pages
menegakkan128 variabel Paid atau64 Free, termasuk empat sistem Pages; tidak
menambah env atau menampilkan nilai secret. Workflow monitor tetap Analytics
per jam menit17, tanpa SQL/deploy. Alert email budget1/5/10 USD yang telah
dipasang menghitung biaya usage akun di luar langganan; bukan hard cap.

Revisi17November2026 (lokal): shared GET metadata subscriptions dan GET project
Pages memakai maksimal3 percobaan dengan timeout30detik/percobaan, backoff500/1000ms
untuk transport/timeout/HTTP408/429/5xx saja. Tidak mengubah/retry GraphQL Analytics,
write/migrasi/deploy. Entitlement/JSON/metadata tidak valid, auth dan kapasitas tetap
fail-closed. CLI guard hanya menampilkan alasan lokal/status HTTP aman, tanpa respons
mentah. Cek baca-saja17Nov setelah CI44096428572 gagal metadata: Paid88/128,
84konfigurasi+4sistem; alasan spesifik kegagalan lama tidak tersimpan pada log.

Verifikasi metadata produksi baca-saja23 Oktober: Paid,64/128 variabel;
Analytics periode30 September–30 Oktober sekitar76,3juta baca dan293ribu
tulis. Ini baseline sebelum rilis percepatan, bukan hasil setelah deployment.

## Publikasi dan rollback

Build Pages dan Worker melalui `.github/workflows/ci.yml` saja. Sesudah push
diterima, berhenti tanpa polling deployment. Jadwal cron dapat memerlukan
waktu propagasi Cloudflare. Rollback memakai rilis CI yang mengembalikan
cadence lima menit; pertahankan data order/inventory/provider. Jika kelak
turun paket Free, kembalikan cadence dan evaluasi CPU sebelum downgrade.

Sumber: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Verifikasi lokal rilis

Fixture SQLite menguji GET KlikQRIS tanpa halaman terbuka, batas empat dan
fairness, gagal konfirmasi/backoff, CAS pemanggil bersamaan, serta pengecualian
invoice expired/canceled/initializing. Scheduler menguji cadence satu menit,
cleanup lima menit, heavy tepat00 dan timeout; Pedia menguji poll progresif,
backoff serta lease paralel. Behavior test memeriksa5/10 detik, hidden/visible
dan berhenti pada terminal. Obscura memeriksa komponen status Pedia aktual
pending→in_progress→completed pada1440/390px melalui fixture inert; screenshot
diperiksa, tanpa overflow/exception JS. Ini bukti lokal, bukan pengukuran
latensi/biaya produksi sesudah rilis. Pada home/status aktual, Obscura CLI
masih mencatat warning hydration atribut xmlns SVG existing; tidak ada error
kompilasi dev. Hasil suite/build ada di CHANGELOG.
