# AIVault Hub — keputusan owner 15 November 2026

## Migrasi host + API key supplier — 20 November 2026

- AIVault memindahkan bot/API reseller: base URL kini `https://api.aivaulthub.store` (dokumentasi `/api/v1/docs`), key baru akun yang sama (`chat_id` sama). Key baru ditolak host lama (401 `invalid_api_key`); key lama di host lama masih hidup dengan saldo $0 dan stok basi, jadi **jangan kembali ke `reseller.aivaulthub.store`**.
- Kontrak tidak berubah (cek baca-saja 20 Nov): `/me`, `/products`, `/quote`, `POST /order`, `/order/{id}`, `/orders`; bentuk respons, header `X-API-Key`, rate limit 60/menit dan 12 `service_id` identik dengan mirror, jadi SKU `AV-*`, family, markup dan grosir tidak tersentuh. Field baru `description`/`instructions` (HTML Telegram) dan `bulk_discounts` diabaikan parser; belum dipakai.
- Riwayat order provider tidak ikut pindah (`/orders` host baru kosong). Saat cutover semua 11 `aivault_order_links` produksi `completed`, jadi tidak ada polling `provider_order_id` lama yang tertinggal; receipt lama tetap di D1 terenkripsi. Link lama yang di-Retry/poll di host baru akan 404 → needs_admin (fail-closed).
- Env Pages `AIVAULT_API_KEY` + `AIVAULT_BASE_URL` (production + preview, `secret_text`) diganti 20 Nov lewat `scripts/pages-env-restore.mjs --apply --only` dari `.pages-env-backup`; `.aivault-credentials` ikut diperbarui. Default kode `AIVAULT_DEFAULT_BASE_URL` = host baru. Nilai env berlaku di deployment CI berikutnya; status live belum diverifikasi oleh catatan ini.
- Tindak lanjut owner: perbarui salinan password manager; pertimbangkan rotasi key (key terkirim lewat chat) dan meminta AIVault mencabut key lama.

## Urutan `sort_order` saat insert pertama — 19 November 2026 (lokal)

- Insert produk baru di `projectAivaultCatalog` memakai `buildSupplierProductInsertSql` (`src/lib/supplier/product-insert.ts`) untuk mengalokasikan `sort_order` ekor kategori (`MAX(sort_order)` produk non-arsip kategori yang sama, default `0`, `+ 10 × rank`). Baris existing tidak pernah diubah `sort_order`-nya saat re-sync; migrasi data `0143_supplier_products_category_tail.sql` memindahkan baris lama `<= 0` ke ekor kategori (menjaga satu slot per `product_group`).

## Penyesuaian markup grosir proporsional — 19 November 2026 (lokal)

- Simpan markup dasar (per varian atau bulk) tanpa input tier menskalakan tier tersimpan dengan `markup_lama_tier × markup_dasar_baru / markup_dasar_lama` bila harga efektif memakai rumus dan markup lama > 0. Pembulatan 2 desimal menjaga tier turun ketat dan di bawah dasar; tier yang tidak muat dibuang (semua pada dasar 0%). Input tier eksplisit tetap divalidasi seperti sebelumnya; harga manual yang tetap berlaku tidak mengubah markup tier.
- Harga unit tier tetap di bawah harga dasar efektif dan tidak pernah di bawah `aivaultSellPrice(modal_usd, kurs, 0)` (ceil Rp100). Harga manual setara atau di bawah batas tersebut tidak menghasilkan tier aktif.
- Baris Markup AIVault menampilkan pratinjau harga tier untuk draf markup rumus, memakai helper yang sama dengan penyimpanan; validasi dialog **Grosir** tidak berubah.

## Status supplier di Admin Pesanan — 19 November 2026 (lokal)

- Admin Pesanan kini memuat link AIVault sebagai kotak status saja (label status, `last_error`, ID provider, petunjuk Supplier → AIVault → Antrean). Tidak ada Retry/Cek status di Pesanan; aksi tetap di Antrean. "Kirim ke pembeli" disembunyikan selama link pending/claimed/processing (cermin CAS `handover.ts`) dan tampil saat needs_admin.
- Resolusi manual turunan (19 Nov 2026, lokal): link belum `completed` yang item `fulfillment_items(order_code, item_index)`-nya sudah `delivered` ditandai `resolved_manually: true` di Pesanan dan `GET /api/admin/aivault/orders` (Pesanan: kotak netral "Diselesaikan manual · sudah dikirim ke pembeli" tanpa `last_error`/petunjuk Antrean; Antrean: badge netral "Diselesaikan manual" tanpa `· lewat batas`/Retry, "Lihat receipt" tetap bila ada; `estimated = 0` di Ringkasan; tidak masuk daftar macet Ringkasan Harian).

## Aktivasi dari menu Produk — 19 November 2026 (keputusan owner)

- `PUT /api/products/[id]` dengan `isActive:true` tanpa varian eksplisit kini hanya mengaktifkan **satu** varian AV (ID terkecil, SKU `AV-<service_id>`) bila belum ada varian aktif, sama seperti TUNVN, StoreBat, dan Mirai. Sebelumnya semua varian AV ikut aktif. Varian lain diaktifkan admin dari Markup/Produk.

## Panel supplier bersama — 19 November 2026 (lokal)

- Supplier → AIVault memakai Ringkas · Antrean · Markup · Alat yang sama dengan TUNVN, StoreBat, dan Mirai. **Grosir** tetap aksi per varian di Markup: dialog menampilkan simulasi harga, menyimpan `bulk_markup_tiers` saja, dan tidak menutup saat penyimpanan ditolak. Status induk tetap dikelola dari Produk.

## Retry katalog pasca-audit — 19 November 2026 (lokal)

- Lease dan throttle sukses tetap 45 detik; kegagalan katalog memperpendek klaim miliknya menjadi 10 detik setelah gagal. Error durable memuat kode upstream/D1 yang aman, bukan body/secret.

## Penanda sukses katalog, error saldo beruntun, & watchdog basi — 18 November 2026 (lokal)

- `publishAivaultCatalog` (`src/lib/aivault/catalog.ts`) menulis `store_settings.aivault_catalog_success_at` (ms epoch) dan mengosongkan `aivault_catalog_last_error` HANYA setelah `syncAivaultCatalog` + `projectAivaultCatalog` selesai tanpa error; `aivault_catalog_sync_at` tetap menjadi klaim throttle (kini memperbarui `updated_at=datetime('now')`). `/api/admin/aivault/products` mengutamakan `aivault_catalog_success_at`.
- Watchdog `checkSyncStaleness` (`src/lib/sync-staleness.ts`, dipanggil di akhir `cleanup`) memantau `aivault_catalog_success_at` dengan ambang 15 menit (grace 1 jam bila belum pernah sukses). `checkAivaultLowBalance` mencatat `aivault_balance_error` `{ at, error, streak }` saat gagal beruntun dan `aivault_balance_last_ok_at` saat sukses.

## Sinkronisasi katalog 1 menit + drain grup segera — 17 November 2026 (lokal)

- `mcp-worker/src/cron.ts` menjalankan `lite:aivault_catalog` setiap 1 menit (menghapus `everyMinutes: 3`), budget tetap 40 tanpa env/trigger baru.
- `src/lib/aivault/sync.ts` mengekspor `AIVAULT_CATALOG_MIN_INTERVAL_MS = 45_000` (diturunkan dari `120_000`); `src/lib/aivault/catalog.ts` menurunkan lease `aivault_catalog_lease` dari `90_000` menjadi `45_000` ms (`now + 45_000`).
- `POST /api/cron/lite?job=aivault_catalog` yang sukses langsung menjalankan `drainDirtyGroupsIfBudget(db, result)` bila `db.canSpend(4)`. Implementasi lokal + test; belum deploy ke Pages/Workers.

## Pengingat saldo rendah Telegram admin — 17 November 2026 (lokal)

- `checkSupplierLowBalance` (`src/lib/supplier-balance-alert.ts`) dijalankan di
  akhir cron lite `aivault_orders` hanya saat `isAivaultConfigured()` dan
  `db.canSpend(5)`, tanpa menambah trigger cron/env Pages baru.
- Checkpoint `store_settings.aivault_balance_checked_at` ditulis sebelum
  `fetchAivaultBalance()` + `parseAivaultBalance` (USD, maks 1×/30 menit);
  gagal/non-`ok`/shape tidak valid mencatat `aivault_balance_error` tanpa alert.
- Ambang opsional `AIVAULT_BALANCE_ALERT_USD` (default `5`, finite `>= 0`;
  tidak dipasang ke Pages), langkah penurunan `1` USD, format
  `💰 <b>Saldo AIVault menipis</b>`. Throttle CAS 6 jam atau turun `>= 1` USD
  via `store_settings.aivault_balance_alert_at` (`amount|ms`); mengirim ke
  `TELEGRAM_ADMIN_CHAT_ID` hanya saat `TELEGRAM_BOT_ENABLED=true`.

## Harga grosir AIVault berbasis markup % — 17 November 2026 (lokal)

Keputusan owner 17 November 2026 mengecualikan AIVault dari aturan "grosir
hanya untuk produk manual" (8 November); WR dan Sekalipay-SK tetap dilarang.
Setiap tier grosir AIVault menyimpan persentase markup (`bulk_markup_tiers_json`
pada `aivault_products`, NULL = nonaktif, 1–5 tier, `min_qty` 2–100 naik ketat,
`markup_percent` 0–1000 turun ketat), bukan harga rupiah tetap. Publisher dan
`PATCH /api/admin/aivault/products/[id]` menurunkan harga rupiah varian lewat
`aivaultSellPrice(unit_price_usd, fx_idr_per_usd, tier.markup_percent)` (ceil
Rp100), membuang tier dengan harga `>=` harga dasar efektif, mengklem agar
non-increasing, membatasi `max_qty <= 100` (batas `purchase.ts`), dan memeriksa
`markup_percent < markup_dasar` saat harga manual NULL (400
`bulk_markup_not_below_base`). API produk/varian generik menolak perubahan
`bulk_pricing` pada produk `aivault_family` atau SKU `AV-` dengan 409
`bulk_pricing_aivault_managed`; `isManualProductForBulk` tetap true agar
storefront/quote/order/Telegram membaca `bulk_pricing_*` tersimpan. Migrasi
`0131_aivault_bulk_markup.sql` menambah kolom dan mengisi tier awal Gemini 6M
(5+/10+/50+ = markup 58/47/36). Status: implementasi lokal; publikasi via CI.

## Kurs modal dibekukan per link — 16 November 2026 (lokal)

Migrasi0130 menambah `aivault_order_links.fx_idr_per_usd`; backfill sekali dari
kurs produk lalu fallback snapshot D1 yang tersedia. Link baru menyimpan kurs
saat dibuat. Laporan mengutamakan kurs link; rantai katalog/snapshot lama hanya
fallback bila NULL. Mengganti aturan kurs katalog dinamis di bagian Ringkasan
di bawah, tanpa mengubah harga jual atau dispatch. Migrasi/deployment produksi
belum diverifikasi.

## Pengiriman langsung paid/Retry — 16 November 2026

Jalur paid mencoba delivery lagi sesudah proses pembelian AIVault; Retry admin
yang completed juga memanggil pipeline buyer existing. Dedupe/CAS, PIN dan
antrean durable tidak berubah; kirim gagal bukan alasan membeli ulang.
Queued upstream tetap dipoll exact ID minimal1menit; jalur cron tetap memakai
fulfillment existing, tanpa delivery tak berbudget di job40statement. Lokal,
publikasi CI; bukan bukti deployment atau pengiriman produksi.

## Grup produk lintas supplier —16 November2026

AIVault dapat dikelompokkan2–10 produk lintas supplier melalui admin
Supplier→Grup produk; tidak ada grup AIVault otomatis. Nonaktif/Arsip selalu
kalah; Manual live menang, lalu stok→modal per30hari→prefer dalam margin.
Modal `unit_price_usd × fx_idr_per_usd` (fallback snapshot D1id1), dinormalisasi
day/month/year; lifetime/custom/NULL tidak. Perubahan mirror/FX/varian menandai
antrean grup. Tidak memindahkan order historis, dispatch atau failover supplier.
Migrasi0129/kode/QA lokal; publikasi CI, deployment belum terverifikasi.
Kontrak lengkap: ARCHITECTURE “Grup produk lintas supplier”.


## Modal di Ringkasan admin — 16 November 2026 (lokal)

- `financialReportSql` (`src/lib/dashboard-report.ts`) kini punya bucket supplier
  `aivault` sendiri, bukan `manual`. Baris dikenali AIVault bila ada
  `aivault_order_links` untuk `(order_code,item_index)`, item punya
  `aivault_eligibility`, atau `product_variants.aivault_service_id IS NOT NULL`;
  hanya bila baris bukan Pedia dan tidak terikat link WR/SK.
- Modal = `ROUND(cost_usd × fx)`. Sumber cost berurutan: link (total per baris,
  TIDAK dikali qty lagi) → snapshot eligibility → `aivault_products.unit_price_usd`
  × qty. Disimpan sebagai `own_cost` dengan `cost_pool` NULL agar alokasi existing
  tidak berubah.
- Kurs = `aivault_products.fx_idr_per_usd` (join `service_id`), fallback
  `crypto_market_snapshot.fx_rate_text`. Ini kurs katalog terakhir, bukan kurs
  persis saat order. `estimated` true bila link tidak ada/`status != 'completed'`
  atau kurs tidak tersedia.
- Tanpa migrasi D1; batas compound SELECT (<5) dan referensi `facts`/`scoped`
  tetap. `PeriodReport.suppliers`, `profit_by_supplier` overview, label ekspor,
  dan baris UI Ringkasan ikut ditambah `aivault` (opsional untuk payload cache
  lama).
- Status: implementasi lokal + test; belum publikasi/deploy. Bukan bukti angka
  produksi.

## Panel Markup, sinkron harga Produk dan salinan — 15 November 2026 (lokal)

- Harga manual supplier (`aivault_admin_price_idr`/`tunvn_admin_price_idr`) dari
  menu Produk (`PUT /api/products/[id]`, `/api/admin/variants` PUT/POST batch)
  HANYA ditulis bila harga yang dikirim berbeda dari baris tersimpan. Simpan
  ulang form Produk tidak lagi membekukan harga rumus menjadi override.
- SKU varian supplier tersimpan (`AV-<service_id>` dengan huruf kecil/underscore,
  `TUNVN-*`) dipertahankan apa adanya saat Produk disimpan; regex sanitasi lama
  akan mengubah `AV-service_gemini_plus_6m` menjadi `AV-6` (memutus sync/PATCH).
  Cek produksi baca-saja 15 Nov: 7 SKU AV masih utuh, tidak ada kerusakan.
- Panel Markup TUNVN/AIVault memakai baris bersama `SupplierPriceRow`: Simpan
  eksplisit per baris, hanya field berubah yang dikirim; harga manual kosong =
  rumus, klien menolak 0. GET panel menambah `product_archived` (+ `excluded`,
  `supplier_description` untuk TUNVN; `muse_product.archived` untuk Buff).
- AIVault: judul grup panel memakai nama produk AXVARA (fallback nama family);
  API AIVault tidak punya deskripsi produk (dicek baca-saja 15 Nov) — salinan
  ditulis admin.
- Migrasi `0127_supplier_copy_id_en.sql` mengisi deskripsi produk ID/EN 5 family
  (gemini, notion, udemy, adobe-express, apple-music; hanya menimpa template
  `aivaultDefaultDescription`) dan S&K + cara aktivasi ID/EN 6 varian `AV-*`
  (hanya bila kosong) dari screenshot owner 15 Nov. Gemini = salinan varian
  manual Gemini Plus 6 Bulan + aturan AIVault (garansi 24 jam cek bot, satu kali
  klaim, akun tanpa konflik Google One). Adobe 12 Bulan diturunkan dari materi 6
  Bulan tanpa klaim jeda tagihan. ChatGPT Plus (Apple Pay) belum diisi.
- Migrasi `0128_supplier_copy_followup.sql` (keputusan owner 15 Nov malam):
  ChatGPT Plus AIVault diisi dari materi supplier (garansi penuh 30 hari, larangan
  9Router, 2FA via `go/otp-2fa`); hold link Gemini AIVault disamakan **1 jam**
  seperti TUNVN/manual (hanya bila teks masih hasil 0127).

## Arsip Produk — keputusan owner 15 November 2026 (lokal)

`products.archived_at` (migrasi0126) memisahkan Arsip dari Nonaktif. Identitas
supplier parent/varian dan relasi histori tetap disimpan: lookup sync tidak
boleh mengecualikan Arsip lalu membuat pengganti. Penulisan katalog, varian
baru, proyeksi harga/stok, aktivasi dan restock melewati parent Arsip; mirror
supplier boleh terus sinkron. Panel/editor mengembalikan409 “Pulihkan dari
Arsip dulu” saat aktivasi. Pulihkan tetap nonaktif; produk supplier tidak pernah
eligible hapus permanen. Lihat PRD “Siklus Arsip Produk” dan ARCHITECTURE “Arsip
Produk admin”. Implementasi/migrasi baru lokal; tanpa perubahan produksi.

## Family eksplisit ChatGPT Plus + slug fallback pendek — 15 November 2026 (lokal)

- Upstream menambah `service_chatgpt_plus_1m` ("ChatGPT Plus 1 Month (Apple
  Pay)") setelah peta statis, sehingga fallback membuat produk id174 dengan slug
  hex-encoded penuh dan tanpa gambar. Peta `src/lib/aivault/families.ts` kini
  memuat family eksplisit `chatgpt-plus` → nama "ChatGPT Plus", slug
  `chatgpt-plus-av`, label "Plus 1 Bulan (Apple Pay)", images
  `["chatgpt-plus-1-bulan","chatgpt-tunvn","chatgpt-sk","chatgpt-premium"]`.
- Slug fallback 1:1 sekarang `slugify(nama)` + "-" + 8 hex FNV-1a32(service id)
  + "-av" (≤80 karakter). Key `service:${serviceId}` TIDAK berubah agar identitas
  fallback lama tidak pindah. Kolisi hash32 sangat kecil; publisher memakai
  `INSERT OR IGNORE` + kepemilikan family eksplisit sehingga tidak pernah
  mengambil alih produk WR/SK/TUNVN/AIVault lain.
- Migrasi `0125_aivault_chatgpt_plus_family.sql` memindahkan HANYA baris lama
  yang tepat (`aivault_family='service:service_chatgpt_plus_1m'`, nonaktif,
  belum ada `chatgpt-plus-av`): family/slug/nama ke ChatGPT Plus, deskripsi
  diganti hanya bila masih auto-default nama lama, `image_url` diisi aset
  ChatGPT yang disetujui bila kosong, `images` menjadi JSON array berisi aset
  yang sama bila masih NULL/''/'[]', lalu label varian nonaktif menjadi
  "Plus 1 Bulan (Apple Pay)". Tidak menambah DDL/kolom atau mengaktifkan apa pun.
- Status: perubahan lokal + test; migrasi remote/deploy belum dilakukan.

## Bukti live 15 Nov 2026 — laporan PM

- PM melaporkan kode `bef50574` sudah dipush ke main dan menjalankan SATU
  pembelian Gemini Plus6M (`service_gemini_plus_6m`), qty1, external ID
  `AXV-QA-20261115-GEMINI-1`, provider ID `API1VLJZG0`. Bukti ini mengonfirmasi
  kontrak provider; tidak sendiri membuktikan status CI/deployment/env AXVARA.
  Patch kompatibilitas receipt sesudah bukti ini masih lokal, belum commit/push.
- POST pertama HTTP201: `success:true`, `order_id`, `service_id`, `quantity:1`,
  `total_cost:0.5`, `new_balance:2.0`, `currency:"USD"`, `price_breakdown`,
  `external_order_id` identik, dan `products` satu string. Produk Gemini nyata
  berupa URL redeem HTTPS (PM melaporkan panjang86karakter); nilai/URL asli
  tidak dicatat di repo, log atau fixture.
- POST identik dengan external ID yang SAMA HTTP200: `success:true`, order ID,
  service, quantity, total_cost, currency dan produk identik, `new_balance:2.0`,
  `idempotent_replay:true`; **tanpa external_order_id dan price_breakdown**.
  Saldo2.5→2.0 hanya sekali: idempotensi dikonfirmasi live oleh PM, bukan sekadar
  fixture. Replay tersebut bukan pembelian kedua; izin tes berbayar sudah dipakai.
- GET `/api/v1/order/API1VLJZG0` HTTP200: `order_id`, `status:"delivered"`,
  `service_id`, `quantity:1`, `total_cost:0.5`, `currency:"USD"`, `created_at`,
  dan produk yang sama; tidak membutuhkan success/external_order_id.
- Quote nyata mengirim `custom_pricing:null`. Parser existing menerima null
  seperti false/field absen, tanpa price_conflict, selama guard lain lulus.
- Validasi POST menerima external ID yang cocok, atau field external ID yang
  benar-benar absen DAN `idempotent_replay===true`. Nilai yang hadir tetapi
  berbeda/null tetap mismatch. Jika provider ID sudah tersimpan, order ID harus
  sama untuk POST maupun GET; service/jumlah/USD/biaya positif dan kecukupan
  products tetap wajib. Receipt penuh tetap disegel sebelum interpretasi.
- Writer hanya memakai fixture palsu untuk patch ini; tidak membuat pembelian,
  replay, polling atau panggilan provider nyata tambahan.

Histori sebelum publikasi `bef50574` (bukan status main saat ini):

Status: implementasi lokal di worktree `feat/aivault-supplier`; commit WIP lokal
dibuat PM, resolusi rebase ke main belum di-stage/continue oleh writer. Belum
push, migrasi remote, konfigurasi Pages, atau deployment. Migrasi0123 tetap
untuk TUNVN; AIVault memakai0124. Perilaku TUNVN dan AIVault dipertahankan pada
integrasi bersama; source dispatcher TUNVN tidak diubah.

- Supplier terpisah: `https://reseller.aivaulthub.store` (histori; host kini `https://api.aivaulthub.store`, lihat migrasi 20 Nov), dokumentasi `/api/v1/docs`,
  header `X-API-Key`. Kredensial sumber lokal `/Users/macbookair/axvara/.aivault-credentials`
  (`AIVAULT_API_KEY`, `AIVAULT_BASE_URL`), ignored `.aivault-credentials*`, chmod600.
  Jangan cetak key, body provider, atau kredensial pembeli; jangan menyalin key ke
  tracked file/browser. Base URL wajib HTTPS; redirect tidak diikuti.
- Env Pages kelak **secret_text**: `AIVAULT_API_KEY`, `AIVAULT_BASE_URL`
  (default domain di atas), `AIVAULT_ENABLED`, `AIVAULT_SYNC_ENABLED`. Default
  dua flag mati; konfigurasi tidak lengkap berarti tanpa fetch. Pemasangan env
  mengikuti backup lokal/password manager dan §16.2; belum dilakukan tugas ini.
- Semua produk supplier masuk mirror/admin Produk; produk AIVault terpisah dari
  WR/SK/TUNVN. Produk/varian baru **nonaktif**, sync tidak pernah mengaktifkan.
  Parent `source='manual'`, `fulfillment_mode='manual'`, `telegram_enabled=1`.
  `products.aivault_family`, varian `aivault_service_id` dan SKU `AV-<service_id>`
  menjaga identitas. Nama/deskripsi/kategori/gambar ditulis sekali; selanjutnya
  milik admin. Label dan status aktif juga tidak ditimpa sync.
- Family statis: Adobe Express6/12bulan; Gemini Plus6bulan; Apple Music5bulan;
  Notion Education Plus12bulan; Udemy1bulan. ID tak dikenal menjadi satu family
  per service, slug memakai nama + suffix ID injektif. Gambar memakai produk
  AXVARA existing (termasuk nonaktif) dari kandidat eksplisit, bukan unduhan baru.
- USD≈USDT memakai **snapshot FX AXVARA**, fail-closed bila FX tidak tersedia.
  Harga katalog = tier qty1 × FX ×1,35, ceilRp100; markup awal35%, admin dapat
  override markup/manual per varian. Harga upstream INR bukan FX USD/IDR.
  Upsert mirror memakai json_each chunk50; publisher memakai jumlah statement
  tetap dan CAS input harga admin/markup. Lease90detik + throttle2menit disimpan
  pada store_settings; cron katalog tiap3menit, budget40 existing.
- GET `/api/v1/me`, `/products`, `/quote?service_id&quantity`, `/order/{id}`;
  POST `/api/v1/order` **hanya dispatcher paid web/Telegram** dengan
  `{service_id,quantity,external_order_id}`. External ID tetap
  `<order_code>-<item_index>`, unik dan tidak pernah diganti. Tidak memakai
  `accept_normal_price`; tidak mengimplementasikan key rotation/webhook.
- `aivault_eligibility` version1 dibuat server pada order BARU dari identitas
  SKU/service/family, source variant, jumlah dan biaya USD saat order dibuat.
  Admin payment test tidak mendapat marker, supplier_purchase_disabled tetap
  otoritatif. Marker dihapus dari respons buyer/admin list umum, bukan backfill
  order lama. Proof c1/p1, PIN dan akses kredensial mengikuti aturan existing.
- Preflight: enkripsi tersedia, identitas/aktivasi varian+parent masih sama,
  quote identitas/currency/jumlah benar, stok cukup, sufficient_balance=true,
  tidak membutuhkan normal-price override. Quote normal boleh menghilangkan
  custom_pricing (bentuk GET aktual15Nov). **custom_pricing=true/shape custom
  belum dapat dibuktikan aman: needs_admin**, bukan opt-in harga normal.
- Lease/CAS/sent fence dan increment attempt persisten sebelum POST. Semua
  response penuh dienkripsi sebelum JSON dibaca, termasuk error/partial.
  Receipt koheren dan products cukup → kredensial qty yang dibeli digabung
  `\n\n`, dienkripsi pada fulfillment_items dan dikirim pipeline existing.
  Extra credentials tetap hanya pada receipt privat admin. Tidak menambah
  notifikasi processing khusus supplier; delivery existing tetap digunakan.
- Queued → processing, GET exact provider_order_id minimal1menit sekali per
  invocation, tanpa beli lagi. Failed/partial/identity mismatch → needs_admin.
  402 insufficient_balance;409 price_conflict;400/401/403/404 → needs_admin.
  Timeout/5xx/429/invalid JSON pasca-send boleh replay **external ID yang sama**,
  maksimum3POST total, backoff2/4menit. Fence tidak dihapus; amount/jumlah tidak
  diubah. Pada replay sesudah fence, quote stok/saldo tidak diulang karena
  debit sukses sebelumnya dapat menghabiskannya; idempotensi provider adalah
  dasar keamanan replay. Snapshot, paid/disable, ownership dan identitas aktif
  tetap diperiksa. Admin retry hanya needs_admin pra-send/attempt0 yang aman.
- Admin Supplier→AIVault: Ringkas, Antrean100link, Markup per family, Alat sync.
  Semua API requireAdmin; input mutasi zod strict + body limit; reveal receipt
  POST privat/no-store melalui audit requireAdmin. UI memakai Promise.allSettled
  supaya kegagalan saldo tidak mengosongkan katalog; tampilkan bagian+HTTP status.
- Histori izin: owner mengizinkan **SATU pembelian nyata Gemini Plus6M**, **oleh
  PM sesudah deployment**, bukan oleh code writer. Izin sudah dipakai PM pada
  15Nov2026 sesuai bukti di atas; writer tetap hanya fixture untuk patch ini;
  jangan memanggil endpoint tulis provider, deploy atau migrasi remote untuk QA.
  Izin ini tidak mencakup pembelian produk lain atau pengulangan tes berbayar.
