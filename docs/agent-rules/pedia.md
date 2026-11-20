# Aturan agent — Pedia (SMM)

## Simpan harga kurasi dari admin — 21 November 2026 (lokal)

- POST tier menyimpan `input_kind`, `drop_label`, `speed_per_day` dan harga paket pada INSERT yang sama; bila tidak ada paket yang dapat dihargai, gagal tanpa menulis tier. Custom Comments memakai batas jumlah yang sama dengan quote.
- PUT menyimpan edit tier bersama harganya; edit paket/step produk dan reprice semua tier memakai satu batch D1. Gagal tulis berarti rollback, bukan `saved:true`; naikkan revisi katalog hanya setelah berhasil.

## Expiry tanpa restock lintas katalog — 18 November 2026 (lokal)

Guard SQL apps/legacy NULL kini berlaku di **kedua** helper bersama,
`transitionPendingOrder` dan `transitionPendingPaymentOrder`, termasuk cron
expiry/`stale_initializing`. Pedia dan Games tidak boleh menulis stok produk/
varian atau sold_count Market dari ID item; pertahankan daftar restock kosong
pada caller Pedia. Fixture ID bertabrakan + Games `items=[]` dan D1 native
terverifikasi lokal; bukan koreksi data/deployment produksi.

## Keputusan owner 13 November 2026 — IndoSMM satu-satunya supplier (menggantikan bagian 12 November)

Bagian 12 November di bawah adalah **snapshot historis yang digantikan**; jangan
menghidupkan kembali katalog otomatis/ProviderSMM dari catatan itu.

- **Supplier jual.** `src/lib/pedia/sales-policy.ts`: `PEDIA_SALE_PROVIDER='indosmm'`
  satu-satunya gate katalog/pembanding/quote/order/draft-aktivasi admin/shortlist/overview.
  Katalog publik menampilkan tier kurasi IndoSMM yang aktif dan punya cermin live
  (batas/harga); baris supplier lain yang masih aktif di D1 TIDAK pernah dijual.
  Retry order tersimpan tetap dicari lewat `quote_id` LEBIH DULU sebelum gate.
- **ProviderSMM dihapus dari kode.** `auto-catalog.ts`, `metadata-refresh.ts`,
  `supplier-descriptions.ts`, proxy `/psmm/*`, jalur materialisasi/deskripsi,
  `pedia_diff_*`, dan panel/endpoint khusus katalog otomatis sudah tidak ada.
  Jangan menambah cabang supplier baru.
- **Diff VPS supplier lama (sementara).** `/api/supplier-sync` membalas HTTP 200
  `{ok:true, ignored:true}` untuk `source:"providersmm"` TANPA menulis D1, agar
  snapshot VPS maju tanpa retry berulang; hapus cabang ini setelah VPS berhenti
  mengirim. Diff IndoSMM tidak berubah (validasi IDR/batas 100, checkpoint
  `pedia_indosmm_diff_*`, ack non-2xx pada tulis parsial).
- **VPS 13 November 2026.** `PROVIDERSMM_API_KEY` di `/opt/axvara/wr-proxy/.env`
  dikomentari (backup `.env.bak-psmm-20261113050941`), service restart, `/health`
  kini `psmm:false`; log hanya loop diff IndoSMM 10 mnt + WR/SK 3 mnt. Kode psmm di
  repo proxy BELUM dibersihkan (follow-up), jadi cabang 200-`ignored` di
  `/api/supplier-sync` tetap dipertahankan sebagai fallback tanpa tulis D1.
- **Skema 0117 tetap.** Kolom `managed`/`managed_snapshot_at` dipertahankan karena
  prod sudah menerapkan 0117, tetapi **inert sejak 13 November 2026** (tidak
  dibaca/ditulis jalur jual). Migrasi data ada di paket B2 di bawah.
- **Order lama.** `pedia_order_items.supplier` yang tidak dikenal build ini
  dirender generik dan TIDAK pernah dispatch (`needs_check`); jangan hapus/remap
  baris sebelum migrasi pembersihan data dijalankan.
- **Nilai operasional.** Minimum order dan ambang alert saldo selalu dari env
  (`src/lib/pedia/ops-config.ts`: `PEDIA_MIN_ORDER_RP`, `PEDIA_BALANCE_ALERT_RP`);
  GET admin settings mengembalikan nilai EFEKTIF itu, bukan nilai tersimpan.

### Migrasi data B2 — purge ProviderSMM + reaktivasi kurasi IndoSMM (13 November 2026)

- **`0119_pedia_providersmm_purge.sql`.** Idempoten + FK-safe. Menghapus HANYA
  order legacy yang cocok guard (`item status='expired'` + `supplier_order_id IS NULL`,
  order `order_kind='pedia'`, `paid_at IS NULL`, `payment_status='expired'`,
  `status IN ('expired','kadaluarsa')`) beserta dependennya (payments, invoice
  history, notice log, claims, followups, credits/ledger, dst.), lalu tier
  `providersmm` tanpa referensi order, produk yang hanya berisi tier supplier lama
  (auto/`psmm-`, atau seluruh tier-nya psmm) tanpa order, mirror/statistik/saldo
  providersmm, dan key `store_settings` `pedia_pending:*`, `pedia_psmm_*`,
  `pedia_managed_*`, `pedia_diff_*`, `pedia_balance_alert_at`,
  `pedia_balance_checked_at`. Prefix `pedia_indosmm_*`, kolom 0117,
  `pedia_tiers_archive0062*`, IndoSMM/Market/Games tidak disentuh. Item/order yang
  tidak cocok guard bertahan, sehingga tier/produknya ikut bertahan.
- **`0120_pedia_indosmm_reactivate.sql`.** Daftar ID dihitung dari SELECT baca-saja
  produksi memakai helper repo (`pediaBounds`/`computePediaPrice`/`passesMarginGuard`,
  minimum order env): curated indosmm nonaktif, alasan NULL/margin, mirror `present=1`,
  rate>0, tipe cocok, margin paket termurah lulus, bukan premium tool, dan bukan ID
  yang dinonaktifkan 0089. Hasil aktual 13 November: **21 tier** (5 alasan NULL +
  16 margin pulih); 149 dari 190 kandidat adalah deaktivasi sengaja 0089 sehingga
  tidak dihidupkan. Tabel lengkap: `B2-reactivation.md` (orchestration).
  Guard `supplier='indosmm' AND managed='curated' AND is_active=0` membuat re-run
  tidak mengubah apa pun.
- **UI admin (13 November 2026).** `PediaManager.tsx` = `PageHeader` + 3 StatCard
  (saldo IndoSMM dengan aksi outline "Periksa", produk siap dijual, perlu tindakan)
  dan 4 tab **Perlu tindakan · Produk · Layanan IndoSMM · Pengaturan**; `?tab=` lama
  dipetakan (`orders` → Perlu tindakan, `services`/`curation` → Layanan IndoSMM,
  `credits` → Produk), default Perlu tindakan bila ada tindakan. Panel di
  `src/components/admin/pedia/` (`OrdersPanel`, `ProductsPanel`, `ProductEditor`,
  `ServicesPanel`, `SettingsPanel`, `shared`), tiap tab memuat datanya sendiri dan
  TIDAK merender judul/deskripsi sendiri (satu PageHeader per halaman). Tab "Perlu
  tindakan" HANYA memuat pesanan yang memerlukan tindakan dengan seluruh guard aksi
  existing; riwayat penuh ada di Pesanan utama (`/admin?section=orders&kind=pedia`)
  dan ditautkan dari toolbar. Tab "Arsip lama" dihapus (API kredit tetap); kurasi =
  "Bandingkan per kebutuhan" di Layanan IndoSMM; minimum order/ambang saldo read-only
  dari konfigurasi server. Payload mutasi dan guard API tidak berubah. Implementasi
  lokal; UI3 belum di-commit dan publikasi melalui CI.

## Keputusan owner 12 November 2026 — katalog otomatis Pedia (ProviderSMM)

Satu fitur (implementasi lokal; publikasi lewat CI). Bootstrap produksi, deployment, dan
QA admin produksi belum dijalankan — jangan klaim live/terverifikasi.

**Supplier jual.** `src/lib/pedia/sales-policy.ts`: `PEDIA_SALE_PROVIDER='providersmm'`,
`PEDIA_LEGACY_PROVIDER='indosmm'`. Konstanta ini satu-satunya gate katalog/pembanding/quote/
order/draft-aktivasi admin/shortlist/overview; jangan menyebar cabang supplier baru. Penjualan
baru IndoSMM → 409 `provider_retired`; URUTAN ORDER WAJIB: lookup order tersimpan via `quote_id`
LEBIH DULU, baru gate. Dispatch/poll/refill/refund supplier-generic via
`pedia_order_items.supplier`; jangan remap tier/produk/snapshot lama. Diff VPS ProviderSMM
ditulis ke cermin D1 (`applyPediaDiff`, checkpoint `pedia_diff_*`; IndoSMM `pedia_indosmm_diff_*`),
validasi IDR/batas 100/ack non-2xx parsial dipertahankan; jangan hapus katalog dari delta tanpa ID.

**Skema 0117.** `managed` (`curated` default / `auto`) di `pedia_products` DAN `pedia_tiers`,
plus `pedia_tiers.managed_snapshot_at`. Deskripsi BUKAN tabel: satu snapshot JSON tervalidasi di
`store_settings.pedia_psmm_desc_snapshot`.

**Materialisasi (`auto-catalog.ts`).** Satu produk+tier `auto` per layanan, slug
`psmm-<service_id>`, G2 default, paket kanonis dari batas API, `input_kind='comments'` hanya
Custom Comments; maks 25/pemanggilan. Kepemilikan diperiksa SEBELUM mutasi; baris kurasi tidak
pernah diubah. Hanya alasan mesin (`service_missing`, `description_*`, `warranty_unconfirmed`,
`terms_conflict`, `type_unsupported`, `platform_*`, `metric_*`, `target_unmapped`,
`premium_tool_excluded`, `bounds_invalid`, `packages_empty`, `invalid_service`) boleh pulih;
`manual`/`margin`/`NULL` tidak pernah dihidupkan mesin. Baris dijeda tetap direkonsiliasi metadata
+ cap versinya sambil mempertahankan `is_active=0`, alasan manusia persis, dan basis
markup/min-profit admin (CAS `is_active`+reason); rencana tidak layak hanya mencap versi.
Mapping qualifier-aware dan hanya target yang dideteksi `detectPediaLink` (Facebook Story,
Spotify album, SnackVideo konten-video ditahan); nama dibersihkan dari badge/emoji supplier.

**Refill.** Durasi hanya dijanjikan bila eksplisit DAN anchor eksplisit koheren; `No Refill`/
`Tidak Bergaransi` menang lebih dulu; klaim tanpa durasi / `api_refill` saja =
`warranty_unconfirmed`; "bulan" tidak dikonversi paksa. Jangan parse nama/deskripsi ke
`refill_days`/min/max tanpa durasi + anchor.

**Deskripsi resmi.** `https://providersmm.id/services`, `HTMLRewriter` native workerd, redirect
manual, timeout 15 dtk, batas 3 MiB; status per baris `ok|empty|oversize`; >3000 karakter =
`oversize` (tidak dijual, TIDAK dipotong); cakupan ±5% per baris; contoh URL target dipertahankan,
kontak/tautan promosi dibuang; `whiteLabel()` di ingest/render. Snapshot dibaca SEKALI per request,
tanpa fetch per pembeli.

**Commit atomik.** Snapshot + enqueue SEMUA layanan present (`pedia_pending:<id>`) + penanda
`pedia_psmm_desc_last_at` dalam SATU `D1.batch`; kegagalan statement mana pun me-rollback
ketiganya (last-good lama tetap otoritatif). Tanpa D1 native = `kept_last_good`. Refresh otomatis
dari heartbeat `supplier-sync` terautentikasi (throttle >6 jam) dan resync admin pertama.

**Antrean durable.** Token generasi acak per ID; enqueue = upsert token (`INSERT…SELECT`, bukan
loop per ID), ack CAS `DELETE … WHERE key=? AND value=?` sehingga enqueue ID yang sama tidak
hilang. Drain `MANAGED_DRAIN_PER_CALL=20` per request, memutuskan aktif/nonaktif dari `present`
cermin terkini (`present=0`/hilang = `service_missing`), sisa tetap pending. Kegagalan baca/tulis
selalu dilaporkan (`errors`), bukan ack palsu.

**Gate penjualan.** Katalog/quote/order baru hanya menerima baris `auto` supplier jual dengan
layanan live valid, deskripsi `ok`, dan cap `managed_snapshot_at` = versi snapshot aktif;
`managedTermsFresh` FAIL CLOSED (cap kosong/beda = tidak dijual). Quote menandatangani
`terms_version`; quote/order baru menolak token tanpa versi/beda versi (409 `service_unavailable`)
SETELAH retry order tersimpan dilayani. Snapshot copy memakai deskripsi resmi; payload publik tanpa
ID/biaya/nama supplier.

**Admin.** Overview: `managed_products/managed_tiers/managed_active/managed_blocked` +
`catalog.{blocked,blocked_total,queue_pending,description_fresh_at}`. Services GET:
`tier_managed/tier_active/tier_disabled_reason/description_status` + filter `?managed=` di SQL
sebelum `COUNT`/`LIMIT`; default semua tipe (kompatibilitas OFF), filter supplier kedua provider
untuk diagnosa riwayat. Resync resumable (`cursor`/`done`, 25/request, validasi penuh, sumber gagal
tidak menyapu). Products PUT: baris/produk `auto` hanya menerima pricing, jeda, tampilan aman
(field sumber dibuang sebelum gate); aktivasi menolak alasan mesin/`margin` ATAU
`managedActivationEligible` gagal (cap versi, cermin valid, `planManagedService` eligible) → 409
`managed_ineligible` tanpa mutasi; jeda/pricing/unpause sah tetap boleh.

**UI & fixture.** *(Histori 12 November 2026; digantikan redesign admin 13 November.)* `PediaManager`: ringkasan berlabel manusiawi, "Tarik ulang" resumable (`busy`
terpisah dari progres dipertahankan, lanjut cursor terakhir, `refresh` request pertama, cursor
tidak maju = error, sukses `done` mengaktifkan kembali + reload). Fixture dev aman:
`scripts/pedia-managed-fixture.mjs` (mencap versi baris auto); helper
`tests/helpers/pedia-managed-fixture.ts`. Comment Likes/Invites belum didukung.

## Perluasan bersama 9 November 2026: Games B2
- Atas keputusan owner di `payments.md`, guard pembayaran bersama kini menerima AXV|AXP|AXG (consent/IPN/callback dan helper gateway); `isValidOrderCode` tetap AXV-only. Ini memperluas snapshot AXV|AXP fase B di bawah, tanpa mengubah katalog, metode, TTL, klaim, restock atau fulfillment Pedia. Games memakai ulang serializer/validator Pedia dan adapter pembayaran existing, bukan cabang finansial baru.

## Keputusan owner 7 November 2026 (final i18n Pedia): metadata, coming-soon, email pembeli
- Metadata setiap route Pedia memakai `generateMetadata` + `requestLocale()` (cookie `axv_locale`; gagal baca = ID). Canonical dan robots TIDAK boleh berubah: jangan menambah/menghapus `alternates.canonical`, dan jangan menambahkan `robots` baru. Route yang page-nya client (status pesanan) menaruh metadata di layout server.
- Halaman "segera hadir" (`PEDIA_ENABLED!=true`) wajib ID/EN dari kamus `pediaCopy`; jangan menulis string baru langsung di page.
- Email pembeli memakai `orders.locale` (kolom existing, default `id`) yang diisi saat create dari locale quote bertanda tangan (`quote.locale ?? locale` request). JANGAN menambah kolom/migrasi baru untuk locale; jangan mengubah sender, penerima, idempotency key, claim/settle, atau retry.
- Bahasa email: subject, judul, paragraf, label detail, CTA, dan footer ID/EN. Nama/deskripsi layanan EN memakai penerjemah fase A (`pediaServiceName`/`pediaServiceText`); angka, batas, dan fakta kebijakan tidak berubah. Pesan followup pembeli mengikuti locale order; notis admin (Telegram/queue) tetap Indonesia.
- Shell email bersama (`renderBrandedNotice` di `src/lib/warung-rebahan/email-forward.ts`) TIDAK diubah oleh Pedia; footer EN diterjemahkan di lapisan `src/lib/pedia/notify.ts`. Jika teks footer shell berubah, tes `tests/pedia-email-locale.integration.test.ts` harus ikut diperbarui (kontrak terpantau).
- Bukti: suite Pedia 57 file/799 tes (metadata ID/EN + canonical, coming-soon, email ID/EN + subject, followup, notis admin, locale create); payment group 22/370; full suite 372/4994 dengan 3 kegagalan hanya file Market (`variant-copy-editor`); tsc error hanya di file tes Market; lint/diff-check bersih. Belum deployment/browser.

## Keputusan owner 7 November 2026 (fase B): rail pembayaran Pedia = QRIS + Sekalipay gateway + crypto NOWPayments
- Checkout Pedia WEB menawarkan rail yang sama dengan Market web: QRIS (bawaan), Sekalipay gateway VA/e-wallet dari katalog kurasi yang SAMA (kanal `SHOPEEPAY` biasa + `DANA_REALTIME` berlabel "DANA"; `SHOPEEPAY_REALTIME` tidak pernah ditawarkan), dan crypto NOWPayments (USD, biaya layanan dari `CRYPTO_SURCHARGE_BPS` + `cryptoFixedFeeCents`/`cryptoPricing(base, ticker)`, minimum per koin ×1,15). Jangan hardcode 1,5%/2%/US$2 atau angka biaya tetap — pakai konstanta/helper (`CRYPTO_SURCHARGE_BPS`, `cryptoFixedFeeCents`, `cryptoPricing`, `cryptoRequiredTotalCents`). Saat `error_code: "payment_method_unavailable"` klien TIDAK pindah ke halaman pesanan: pesan server ditampilkan, quote+prefetch dibuang, metode dimuat ulang, `attempted` direset, dan metode gagal tidak dipilih ulang. **Kegagalan definitif** (`sekalipay_gateway_create_rejected` + GET read-only 404 via `confirmGatewayInvoiceAbsent`) membatalkan order + meng-expire item sehingga quote baru pada target sama bisa 201; selain itu (ambigu/timeout/504/proxy unreadable/GET rate-limited/error/200) klaim DIPERTAHANKAN dan order baru masih `409 duplicate_active_order`. Jangan menambah POST ulang atau membatalkan tanpa bukti GET; detail di `docs/agent-rules/payments.md` aturan teratas.
- Mesin Market dipakai ulang, bukan diduplikasi: `buildMethodCatalog` untuk katalog, bentuk token + `isCanonicalMethodOption` untuk baris bertanda tangan, `createNowpaymentsInvoice`/`createSekalipayGatewayInvoice` untuk invoice, `GatewayPaymentPanel` + `displayCryptoAmount` + `usePaymentConsent` (satu klik → redirect) untuk UI/persetujuan, `build*PaymentView` + klaim poll untuk status, dan rute `POST /api/orders/[code]/payment-consent`.
- Pilihan metode HARUS berasal dari token quote bertanda tangan; metode hilang/tidak sah = 409 `quote_stale` (tanpa fallback diam-diam). Kegagalan rail = 503 `error_code:"payment_method_unavailable"`; ambigu klaim dipertahankan tanpa POST ulang, definitif membatalkan order + item. Client kembali ke QRIS dan memuat ulang daftar metode.
- Pedia TIDAK pernah mereservasi stok Market: klaim order hanya menulis `orders` + `pedia_order_items` (tidak ada UPDATE `products`/`product_variants`). Semua cancel/expiry Pedia karena itu WAJIB memakai daftar restock KOSONG — `transitionPendingOrder(... , [])` di `src/app/api/pedia/orders/route.ts` (crypto definitif, gateway rejected, preclaim) dan `src/app/api/pedia/orders/[code]/cancel/route.ts` — dan `transitionPendingOrder` punya guard SQL `COALESCE(o.order_kind,'apps')!='pedia'` untuk pemanggil bersama (admin/cron/webhook/Telegram). Jangan pernah mengirim `orders.items` Pedia ke restock: `product_id` adalah id `pedia_products` yang bisa bertabrakan angka dengan `products.id` dan menambah stok Market (`tests/pedia-cancel-stock.regression.test.ts` mengunci ini).
- `orders.payment_method` = `qris` | `nowpayments:<ticker>` | `sekalipay_gateway:<channel>`; `payment_account` = `QRIS` | `NOWPayments` | `Sekalipay`. Saat lunas, transisi bersama menulis `crypto`/`sekalipay_gateway` (perilaku Market).
- Expiry order = `min(15 menit, deadline provider)` dan tidak pernah dipanjangkan; pembayaran telat/underpaid crypto → manual review TANPA dispatch. Dispatch Pedia tetap dipicu order `lunas` (`processPediaPaidOrders` via paid-fulfillment + cron), bukan oleh metode.
- Shared module HANYA boleh berubah aditif tanpa ubah signature. Yang disetujui fase B: `isValidBuyerOrderCode` (AXV|AXP) di `src/lib/security.ts` dipakai consent/IPN/callback gateway, serta dua regex kode order di `sekalipay-gateway.ts` menerima AXP. `isValidOrderCode` tetap AXV-only agar route Market tidak melebar.
- Kredit Pedia tetap pensiun (tanpa saldo/refund otomatis); Telegram/WA tidak berubah. Fase B ini lokal: belum deployment, belum ada transaksi provider nyata.

## Keputusan owner 7 November 2026: Pedia memakai bahasa + mata uang Market (fase A)
- Ini MENGGANTIKAN catatan lama "Pedia tetap ID" (termasuk komentar scope di `src/lib/i18n/locale.ts`): seluruh teks pembeli Pedia mengikuti `axv_locale` (ID default) dan harga tampil mengikuti `axv_currency` lewat jalur FX Market. Admin/WA tetap Indonesia.
- Kontrol: `PreferenceControls` Market yang sama di `PediaNavbar` (desktop + mobile), provider `DisplayPreferencesProvider` dipasang di `src/app/pedia/layout.tsx`. Jangan membuat kontrol/endpoint preferensi kedua atau cookie baru.
- Sumber teks: chrome UI di `src/lib/pedia/copy.ts` (+ `terms.ts`, `help-content.ts`, `platforms.ts`, `refill-policy.ts`, `custom-comments.ts`) dengan kunci ID/EN; string baru wajib punya kedua bahasa (fallback ID boleh untuk teks data tak dikenal). Nama/deskripsi/syarat layanan dari DB/manifest diterjemahkan SAAT RENDER (`pediaServiceName`/`pediaServiceText`/`localizePediaServiceCopy`): jangan menambah kolom EN, mengubah migrasi 0086/0093/0102, atau menulis ulang `pedia_tiers` untuk terjemahan.
- Istilah SMM tetap bahasa supplier di kedua locale (No Drop, Less Drop, High Drop, Refill N Days, Refill Lifetime, No Refill, Drop rate, Start time, Speed, Avg time, Success rate); jangan menerjemahkan istilah ini ke bahasa Indonesia/alias baru. Angka, batas min/max, masa refill, anchor, dan fakta kebijakan tidak boleh berubah karena terjemahan; teks EN yang tidak dikenali jatuh ke Indonesia.
- Harga: USD hanya tampilan (server `POST /api/display-prices`, tanpa FX/`usdCents` → Rupiah). Quote, nominal tagihan, dan charge tetap IDR/QRIS; jangan memakai hasil tampilan sebagai nominal order/invoice.
- Galat pembeli dari `/api/pedia/*` memilih ID/EN dari cookie (`pediaApiLocale` + `pick`), tanpa cookie = Indonesia; jangan mengubah status code, `error`/`message` keys, atau field lain saat menerjemahkan.
- Fase B (rail Sekalipay gateway VA/e-wallet + crypto NOWPayments di checkout Pedia) DISETUJUI dan diimplementasikan 7 November 2026 — lihat seksi teratas. `payment_method` kini dinamis dari token; jangan mengembalikannya ke `qris` hardcoded.
- Bukti fase A: suite Pedia 50 file/762 tes lulus (termasuk `tests/pedia-i18n.behavior.test.tsx` untuk EN beranda/order, switcher, USD + fallback IDR); `npx tsc --noEmit` bersih untuk file Pedia; ESLint 0 error (warning lama tetap). Chromium lokal :3010 memverifikasi route Pedia 200, switcher EN→ID, dan cookie USD tanpa error konsol; harga USD di halaman order belum bisa dilihat lokal karena katalog D1 kosong. Deployment dan perubahan env/flags belum diverifikasi.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

## Kebijakan Pedia 24 Oktober 2026 (menggantikan kredit pada snapshot lama)
- Spec terkini `docs/pedia/manual-resolution-2026-10-24.md`: QRIS per order, tanpa wallet/deposit/kredit/refund otomatis.
- Partial/canceled disimpan atomik dengan antrean tindak lanjut manual; pembayaran paid tetap paid. Unknown remains jangan diasumsikan nol.
- Arsip kredit/ledger lama dipertahankan, tidak dapat dibelanjakan. Retry order yang sudah tersimpan mempertahankan nominal; quote lama berkredit tanpa order ditolak sebelum mutasi.
- Expiry reservasi pra-pensiun dibalik sekali hanya ke arsip beku + follow-up owner. Penyelesaian dengan pembeli di luar AXVARA, bukan saldo baru.
- Status Pedia wajib kontak checkout penuh; kredensial Market mengikuti aturan PIN/proof checkout 28 Oktober di atas beserta kompatibilitas legacy, bukan kontak saja untuk order PIN6. Pengecualian admin24Oktober: adminView hanya sesudah requireAdmin server-side, URL tanpa kontak/token buyer dan tidak menerbitkan capability buyer. Tidak menampilkan kode kredit lama ke browser.

### Email processing Pedia 3 November 2026 (lokal)
- Email processing menunggu paid, resi supplier durable, status submitted/in_progress dan jumlah awal/sisa tervalidasi dari DB; 0 valid. Jika belum lengkap jangan claim/bakar percobaan; discovery maksimal dua/fase memilih processing siap tanpa batas 24 jam, paid/completed tetap 24 jam. Email processing yang sudah terkirim tidak dikirim ulang. Ini tidak mengubah Telegram, paid/completed atau template; deployment belum diverifikasi.

### Histori Pedia (dipindah 2 November 2026)
- Snapshot Pedia 12, 15 dan 19 Oktober 2026 dipindah utuh tanpa perubahan isi ke `docs/agents-history.md` agar konteks agent lebih ringan. Itu bukti bertanggal, bukan status produksi atau izin rollout.
- Pengaman di sana (secret supplier hanya di VPS, idempotensi/reservasi durable proxy SMM, retry ambigu `needs_check`, quote JWE/snapshot order lama, larangan reset direktori idempotensi) tetap berlaku untuk jalur legacy yang kompatibel. Baca file itu sebelum menyentuh order/refill/recovery Pedia lama, proxy SMM atau kurasi.

### Copy layanan Pedia 3 November 2026 (terkini)
- Nama/deskripsi layanan hanya membawa karakteristik yang tertulis di sumber (Real Look, Real People, Real Human, Real, HQ, Akun berpostingan, Akun lama, Campuran, Instant Start). Jangan memakai "kelas/label Real", mengarang active/buzzer/story/kualitas, atau memberi kata Real/HQ pada sumber campuran/bot. Perubahan lewat manifest + `scripts/generate-pedia-copy-20261103.mjs`; migrasi 0093 sudah guard nama/deskripsi lama, jangan mengedit manual.
- `Instant Start` hanya segmen nama dari sumber; jangan mengisinya ke `eta_start` (dibaca dari tier hidup oleh API order sehingga mengubah janji order lama) dan jangan mengarang rentang.
- Kalimat refill: `Refill N hari [sejak pesanan dibuat|selesai], selama layanan masih tersedia.` memakai `refill_anchor` nyata; tanpa "dari/lewat AXVARA". Pembersihan teks historis hanya kosmetik, tanpa mengubah angka/anchor/kelayakan.
- Tier 285 / svc 5834: konflik sumber (nama 30 hari vs deskripsi 90 hari) belum diputuskan; kontrak tetap 90 sampai owner memutuskan. Jangan memperpanjang 30→35 hari hanya karena nama sumber.

### Pedia IndoSMM 1 November 2026 (terkini)
- ProviderSMM diputus: jangan menambah cek saldo/notif/penjualan ProviderSMM. Diff VPS ProviderSMM dibalas 200 `ignored`; order/snapshot lama tetap dibaca.
- Istilah SMM keputusan owner tetap bahasa supplier (No Drop, Less Drop, High Drop, Refill N Days, Refill Lifetime, No Refill, Drop rate, Start time, Speed, Avg time, Success rate) dari `src/lib/pedia/terms.ts`; jangan menerjemahkan ke istilah Indonesia.
- Layanan High Drop/No Refill boleh dijual dengan label jelas. Refill manual (bergaransi tanpa tombol API) sah: admin meneruskan ke CS IndoSMM lalu `refill_resolve`.
- Statistik supplier dari alat publik IndoSMM bukan API resmi dan bukan uji kualitas AXVARA. Katalog baru lewat manifest + generator; jangan mengedit migrasi 0086 manual.
- Komentar custom: tier `input_kind='comments'` hanya boleh dipetakan ke layanan tipe "Custom Comments"; jangan menjual layanan Custom Comments tanpa kolom komentar.
- White label 100%: teks yang dilihat pembeli Pedia tidak boleh menyebut supplier/IndoSMM/ProviderSMM. Teks baru wajib lolos `whiteLabel()`/test leak; admin boleh menyebut IndoSMM.
- Nama layanan (2 November): [Metrik] [Wilayah] [Kualitas] (+ " · keterangan" bermakna); jangan memasukkan Refill/drop/"Ekonomis"/"Max N" ke nama karena sudah chip. Kurasi berikutnya satu layanan per (wilayah, masa refill, kualitas, keterangan); migrasi data memakai guard nama lama.
- Spec: `docs/pedia/indosmm-catalog-refill-2026-11-01.md`.

### Pedia IndoSMM 20 Oktober 2026
- Spec terkini `docs/pedia/indosmm-only-2026-10-20.md` menggantikan dua supplier aktif: hanya IndoSMM untuk penjualan baru, ProviderSMM tetap untuk riwayat/retry checkout tersimpan/dispatch/refill/recovery lama. Jangan ubah provider/snapshot order lama.
- Quote ProviderSMM tanpa order tersimpan ditolak 409 sebelum reservasi/debit/invoice; retry order tersimpan diperiksa dahulu. Kebijakan server berlaku meski tier lama aktif di DB.
- Migrasi 0073 menonaktifkan penjualan PSMM dan menambah tier IndoSMM baru, tidak remap tier lama. Konflik slug/draf owner dan tier IndoSMM existing dijaga. Produk premium Canva/Gemini/CapCut dikecualikan.
- Manifest 20 Oktober: 53 kebutuhan baru, tujuh pengganti, 61 mapping, 18 platform tambahan. Quote Threads dan Share Video Facebook tidak dipaksakan tanpa padanan terverifikasi. Registry/target/ikon diperluas; semua penawaran baru tanpa refill AXVARA. Nama API/deskripsi bukan bukti kualitas.
- API akun IDR 4.395 layanan/saldo0 dibaca saja. Tidak ada order berbayar, top-up, env/cron/proxy baru. Rencana sampling dua supplier 19 Oktober historis; saldo uji selanjutnya IndoSMM.
- FX-11 (lokal): transisi ke `needs_check` biasa (termasuk submit yang terputus) memberi kabar pembeli satu kali dengan petunjuk menghubungi admin dan tidak pesan ulang. Tidak menulis refund atau mengubah aturan `partial`/`canceled`.
