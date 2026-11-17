# Aturan agent — Workers Paid, unit unik, operasional D1

### B-H cache edge berbasis revisi & invalidasi — 18 November 2026 (lokal, belum deploy)

- `src/lib/catalog-cache.ts` (`d1-v2/{scope}/{rev}/{key}`): tiga kunci revisi di `store_settings` (`catalog_revision_market`, `catalog_revision_pedia`, `catalog_revision_games`) dengan memoization per-isolate 5 detik (`WeakMap` lewat `unwrapD1`), coalescing pembacaan in-flight, dan restorasi header `Cache-Control` browser asli melalui `X-Axvara-Origin-Cache-Control`.
- **Aturan `bumpCatalogRevision(scope)`:** maksimal 1 statement tulis `UPSERT` (`store_settings`) per eksekusi bermutasi (`changed > 0`); dilarang memanggil pada tick/sync no-op (`changed === 0`), replay idempoten, atau kegagalan. Pada `games/sk-catalog-sync.ts`, pembaruan `catalog_revision_games` saat berubah digabung dalam batch atomik penanda sukses yang sama (0 statement ekstra).
- Setiap jalur tulis baru yang mengubah tampilan katalog (`products`, `product_variants`, `categories`, `fulfillment_items`, `supplier_pairs`/`product_groups`, `wr_*`/`sk_*`/`tunvn_*`/`aivault_*`/`pedia_*`/`games_*` aktif) wajib memanggil `bumpCatalogRevision` dengan scope yang sesuai (`market` / `pedia` / `games`). Scope B-H tidak mengubah `/api/catalog`, `/api/games/catalog/[slug]`, PDP, `wrangler.json`, `fulfillment/delivery/**`, maupun `mcp-worker/`.

### A-S probe sintetis — 18 November 2026 (lokal)

- Home/katalog/quote hanya setelah seluruh `CRON_STEPS`, outcome `synth:*`
  memakai F1/KV existing (hard2/soft6/recovery3/reminder6jam), bukan alarm kedua.
- Timeout10detik/fase mencakup body/PDP, plafon20detik serta sisa jendela55detik
  tick. Skip budget `alarm:none` tidak dianggap sukses/tidak mereset counter;
  jangan mengurangi/menghentikan job order demi probe.
- Quote synthetic wajib header1+Bearer cron secret constant-time;0D1write,
 0kuota pembeli/admission/reservasi/funnel,0provider fetch (gateway excluded,
  crypto/FX snapshot-only). Guard `isSyntheticRequest` dapat dipakai B-S.
 200 memerlukan token+QRIS lokal available;409 issues valid sehat; katalog
  kosong/rusak bukan sehat. Maks3PDP dinamis, tidak ada ID hardcode.
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
- `src/app/api/cron/lite/route.ts`: kegagalan subjob inti (`payments` pass NOWPayments/Sekalipay gateway, `pedia_orders` dispatch, `notify*` `telegram_retry`/`whatsapp_outbox`) tetap menjalankan subjob lain lalu membalas `503` `{ ok: false, failed_subjobs }` tanpa menulis `cron_lite_*_ok_at`. Yield `QueryBudgetExceeded` dan error subjob opsional tetap `200`.
- `src/lib/sync-staleness.ts` dipanggil di akhir `runCleanup` (`job=cleanup`, guard `db.canSpend(6)`) tanpa env/migrasi baru: memantau sumber aktif (SK, Jaspay, TUNVN, AIVault, Games SK, Pedia IndoSMM diff bila ada penanda, FX `crypto_market_snapshot`; WR tetap ditangani `alertStaleWrSync` agar tidak alert ganda) dengan CAS episode di `store_settings`, grace 1 jam bila belum pernah sukses, pengingat 6 jam, dan notifikasi pulih ke `TELEGRAM_ADMIN_CHAT_ID` saat `TELEGRAM_BOT_ENABLED=true`.
### Alarm cron per step — 18 November 2026 (lokal, F1)

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
- Target ≤3 juta reads/hari harus diukur satu siklus 07.00–07.00 produksi,
  jangan menyamakan hasil benchmark fixture atau push dengan bukti tercapai.
