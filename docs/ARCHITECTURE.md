# ARCHITECTURE.md — AXVARA

## Workspace admin: tema, dialog native dan guard draft (13 November 2026, implementasi lokal)

- Route baru `src/app/(shop)/admin/layout.tsx` (edge) membaca cookie
  `axvara-admin-theme` (`light|dark`, selain itu `system`) lalu membungkus
  `AdminWorkspace` (`src/components/admin/AdminWorkspace.tsx`). Cookie ditulis
  klien: `Path=/admin; Max-Age=31536000; SameSite=Lax` (+`Secure` di HTTPS); bukan
  data sensitif dan tidak dibaca API. Wrapper tema/toast hanya aktif bila
  `usePathname()==="/admin"`; `/admin/payments/test` dirender apa adanya.
- `AdminWorkspace` mengekspor `useAdminDraft(dirty, busy)`, `navigateWithDraftGuard`
  dan `pushAdminHistory(url)` (pushState yang mempertahankan `history.state` Next +
  `adminIndex`). Guard memakai event cancelable `axvara:admin-navigate`, popstate
  capture + Navigation API `navigate`/`traverseTo` (bila ada) dan `beforeunload`.
  Navigasi section `page.tsx`, tab Pembayaran (`payment_tab`) dan tab Pedia memakai
  `pushAdminHistory`; Metode Pembayaran kini menyimpan tab di URL.
- `src/components/ui/Dialog.tsx`: native `<dialog>` `showModal()` (fallback `open`),
  scroll-lock berhitung untuk nested modal, restore fokus, Escape/backdrop, `busy`.
  `ConfirmDialog` memakai komponen ini; `window.confirm` di editor teks varian
  diganti ConfirmDialog. Toast admin dirender sebagai popover top-layer agar tetap
  di atas modal native.
- Tailwind `admin.*` + `src/components/admin/admin.css` (lihat DESIGN). Tidak ada
  dependency, env, migrasi, flag atau perubahan auth/Access/sesi.
- Kontrak API admin pesanan (perbaikan audit F1/F4/F5):
  - `PATCH /api/admin/orders/[code]` menolak 409 perubahan status legacy untuk
    `payment_method` `nowpayments:*`/`sekalipay_gateway:*` (termasuk batal; status
    mengikuti rekonsiliasi provider) dan menolak `status:"lunas"` generik untuk
    `qris` ("Gunakan ACC QRIS dengan catatan verifikasi mutasi."). Jalur `paid_qris`
    + ledger existing, no-op/pending, regex AXV-only dan guard WhatsApp tidak berubah.
  - `GET /api/admin/orders`: `kind=games` (`order_kind='games'`); `method` menerima
    ID berkolon `nowpayments:<x>`/`sekalipay_gateway:<x>`; `method=manual` kini
    mengecualikan QRIS, NOWPayments dan gateway. Where/bindings tetap dipakai
    bersama list/stats/pagination/CSV.
  - UI Pesanan: jenis `games` (prefix AXG) berlabel sendiri tanpa ACC/Tolak/buyer
    input/handover (endpoint detail Market tetap AXV-only); provider modern tidak
    menampilkan aksi manual.

## Temp mail publik terisolasi (12 November 2026, implementasi lokal)

- Koreksi CI12November2026: D1 terpisah bukan berarti database kosong. Prototipe
  sudah memiliki `messages(id TEXT,inbox,sender,subject,text,received_at,expires_at)`.
  Rilis0001 gagal membuat indeks `recipient`; tabel prototipe tidak diubah. Worker
  dan SQL kini memakai `temp_mail_messages` + `idx_temp_mail_*`, tidak membaca/
  menyalin/menghapus pesan prototipe. Metadata produksi read-only membuktikan
  `d1_migrations` kosong dan Worker penerima belum ada sebelum koreksi0001.
  Test workerd mencakup DB kosong, schema existing+row sentinel privat, migrasi idempoten,
  ingestion/list/detail/expiry/cap/dedupe dan cleanup yang tidak menyentuh legacy.
- Source `temp-mail/src/worker.mjs` dan `temp-mail/public/` berjalan sebagai satu
  Worker `axvara-temp-mail`: Static Assets web `mail.axvara.tech`, handler HTTP
  `/api/*`, handler `email()` dan cleanup hourly. Tidak menambah route Next/Pages,
  mengubah MCP cron, atau memasang server SMTP/VPS.
- Penerima `isturaiky.page` memakai catch-all apex Email Routing menuju Worker.
  Cloudflare subdomain hanya literal rule, bukan catch-all; `mail.axvara.tech`
  adalah hostname WEB, bukan domain alamat email. MX Zoho apex AXVARA tetap utuh.
- D1 terpisah `axvara-temp-mail` UUID `a507b69c-7493-4e76-9d63-68a38d9202de`,
  binding `DB`, migrasi `temp-mail/migrations/`; tidak memakai `axvara-db` atau
  `drizzle/`. Binding lain: `ASSETS`, limiter API native namespace1001;
  vars publik `MAIL_DOMAIN`/`RESERVED_MAILBOXES`, tanpa secret/env Pages baru.
- Empat literal forwarding privat existing dipertahankan. API/ingestion menolak
  nama reserved dan domain asing. API hanya config/random/open/list/detail,
  tidak ada enumerasi inbox global, delete, kirim/reply, raw MIME atau lampiran.
  JSON no-store/noindex, UI text-only/CSP; MIME diurai `postal-mime` lokal paket
  `temp-mail` (bukan parser rumahan). Pesan expired tidak dikembalikan saat GET.
- Pipeline `ci.yml`: install root + parser MIME sebelum test root, audit runtime
  terpisah, preflight routing sebelum build/deploy, lalu migrasi D1 temp mail,
  deploy Worker/custom domain dan `ci-temp-mail-routing.cjs --apply` setelah deploy
  existing Pages/MCP. Catch-all hanya diaktifkan setelah deployed domain/reserved/
  DB tepat; script tidak mengubah literal rules/MX dan membaca ulang hasilnya.
  DNS belum ready, route privat hilang/tidak dikecualikan, API gagal/parsial, atau
  catch-all milik layanan lain menghentikan aktivasi, bukan menimpa layanan lain.
- QA memakai fixture lokal tanpa email/transaksi produksi. Publikasi CI bukan
  bukti deployment/penerimaan SMTP; setup dan rollback catch-all ada di
  `temp-mail/README.md`, aturan operasi di `docs/agent-rules/temp-mail.md`.

Preferensi web (11 November 2026, implementasi lokal; deployment belum diverifikasi):
`resolveBuyerPreferences(cookie)` hanya membaca cookie valid `axv_locale`/`axv_currency`,
fallback `id`/`IDR`. Quote Market, display-prices dan `pediaApiLocale` tidak lagi
membaca Accept-Language atau negara Cloudflare; modul `i18n/server-country.ts` dihapus.
`DisplayPreferencesProvider` memakai default tetap tanpa probe POST `[0]`; request
konversi USD eksplisit tetap tersedia. `resolvedLocale`/`resolvedCurrency` pada context
berisi default tetap untuk kompatibilitas pemanggil checkout/kontrol; cookie manual
tetap menang. `/api/display-prices` tetap private/no-store dengan `Vary: Cookie` saja.
Tidak ada route/env/migrasi baru, perubahan FX/charge/snapshot pesanan atau preferensi
bot. Ketentuan ini menggantikan deteksi otomatis pada snapshot LOC1 dan UI lama di bawah.

Expiry supplier/manual (revisi 9 November 2026, implementasi lokal, deployment belum diverifikasi): `db/orders-create.ts` dan `commerce.ts` menentukan TTL Market baru web/Telegram dari metadata pemilik produk (`isManualProductForBulk`): supplier WR/SK gateway (`sekalipay_gateway:*`) 30 menit, crypto/QRIS 60 menit, manual/mixed semua metode 15 menit; guard batch mengikat metadata agar perubahan source tidak mereservasi stok dengan TTL yang salah. Telegram tetap hanya menawarkan QRIS + crypto; WhatsApp tidak berubah. `dana-qris.ts` membatasi invoice 15 menit/deadline order tanpa menimpa deadline order yang sudah ada; legacy NULL mendapat deadline invoice. Renewal QRIS existing tetap satu kali dan tidak mengubah deadline order. KlikQRIS juga tidak menimpa deadline order; invoice tetap dibatasi provider. NOWPayments ceiling 60 menit, dibatasi order dan `valid_until` provider; `expiration_estimate_date`/`expirationEstimateDate` pada create floating-rate hanya divalidasi formatnya, bukan batas pembayaran. Estimasi yang sudah lewat tidak memendekkan/menolak invoice. Retry/reconcile tetap memakai deadline tersimpan, termasuk validasi legacy fixed-rate; finalisasi hanya dapat memendekkan deadline order. Gateway view/reconcile tetap minimum order/provider. Pedia create memulai 30 menit untuk gateway, 60 menit untuk crypto/QRIS, lalu `shortenToProviderDeadline` memendekkan sesuai transaksi/provider (QRIS 15 menit). Tanpa migrasi/schema/env/route/auth baru; deadline lama tidak diperpanjang, late review dan no-rePOST tetap. Verifikasi revisi dicatat di CHANGELOG; tidak ada perubahan UI dan browser checkout baru belum dijalankan.

Market nama/S&K admin/email EN fase 3 (LOKAL, 7 November 2026, belum deploy): migrasi 0105 menambah `products.name_en`, `product_variants.admin_terms_en`, `admin_activation_en` (admin-owned, tidak di `WR_OWNED_PRODUCT_FIELDS`; sync tidak menulis). 0106 mengisi 7 nama non-token dan 9 varian admin EN secara idempoten. `productDisplayName()` di `src/lib/i18n/product-name.ts` memilih `name_en` lalu terjemahan token; dipakai kartu/PDP/modal/cart/checkout/order/Telegram/SEO, sementara `name` tersimpan tidak berubah. `PUT/GET /api/products/[id]` membawa `nameEn`; `PUT /api/admin/variant-copy` membawa `terms_en`/`activation_en` dengan fingerprint yang sama; `resolveVariantCopyDetailed` hanya memakai EN admin saat salinan ID valid, lalu kurasi EN, lalu teks WR. Email pembeli memakai `order.locale` di `email-forward.ts` (credential/order-ready/branded/notice chrome), `notify-buyer.ts`, QRIS expiry, WR/SK delivery, dan access PIN; sender/recipient/secret/rate-limit/delivery semantics tidak berubah.

Metadata, coming-soon, dan email Pedia per locale (LOKAL, 7 November 2026, belum deploy): `generateMetadata` pada `src/app/pedia/layout.tsx`, `layanan`, `bantuan`, `ketentuan`, `lacak/layout`, `refill`, `o/[slug]`, `p/[platform]`, dan layout server baru `pesanan/[code]/layout.tsx` memakai `requestLocale()` (`src/lib/i18n/server-locale.ts`, cookie-only, gagal = id) dan helper `src/lib/pedia/metadata.ts`; canonical/robots existing dipertahankan apa adanya. Halaman `page.tsx` (coming-soon saat `PEDIA_ENABLED!=true`) memakai `pediaCopy(locale)`. Email: `POST /api/pedia/orders` menulis `orders.locale` (kolom existing) dari `quote.locale ?? locale`; `pediaBuyerContext` membaca `o.locale` dan `src/lib/pedia/notify.ts` memilih subject/body/details/CTA/footer ID atau EN (nama layanan EN via `pediaServiceName`), dengan footer shell Market diterjemahkan lokal di `localizeShell` (modul bersama tidak diubah). `src/lib/pedia/followup.ts` meng-join `orders` untuk locale pesan pembeli (ORDER BY `f.created_at`), notis admin tetap ID. Sender/penerima/claim-settle/idempotency tidak berubah; tidak ada migrasi/kolom/env baru.

Market konten EN fase 2 (LOKAL, 7 November 2026, belum deploy): migrasi 0103 menambah `products.description_en` (admin-owned; sync WR/SK tidak menulis, `WR_OWNED_PRODUCT_FIELDS` tidak berubah) dan 0104 mengisi 71 produk dengan `UPDATE ... WHERE slug=? AND description_en IS NULL`. `PUT /api/products/[id]` menerima `descriptionEn` (trim, maks 2000, kosong → NULL); `GET` mengembalikan `description_en`. `/api/products` mengirim `descriptionEn`; `/api/catalog` mengirim `copy` (ID) + `copy_en` sehingga cache publik 10-30 dtk tidak perlu bervariasi per cookie. Klien (PDP, QuickVariantModal, ProductCopy, Telegram, SEO meta/JSON-LD) memilih EN bila ada, fallback ID. `src/lib/product-copy/curated-en.ts` berisi 95 entri EN berkunci fingerprint yang sama; `resolveVariantCopyDetailed(..., locale)` memilih EN hanya saat fingerprint cocok. Badge (`badge-copy.ts`), label varian (`variant-copy.ts`, render-only) dan `bundle-hemat` → "Value Bundles" melengkapi permukaan EN. Konten admin per-varian (`admin_terms`/`admin_activation`) dan email pembeli tetap ID.

Pedia rail pembayaran gateway + crypto (LOKAL, 7 November 2026, belum deploy): `POST /api/pedia/quote` menyertakan `paymentMethods` dari `buildMethodCatalog(total)` (baris QRIS Pedia selalu ditambahkan karena QRIS Pedia memakai provider aktif `createActiveQrisInvoice`, bukan tabel `payment_methods` Market) dan menandatangani baris tersedia + `locale` di token Pedia (`src/lib/pedia/quote.ts`); verifikasi memakai `isCanonicalMethodOption` sehingga gateway net+fee=total dan snapshot crypto (base/surcharge/total, aset, jaringan, FX) harus kanonis. `POST /api/pedia/orders` memvalidasi pilihan lewat `resolvePediaMethodSelection` (`src/lib/pedia/payment-methods.ts`: config live `isNowpaymentsConfigured`/`cryptoRailEnabled`/`isSekalipayGatewayConfigured`, snapshot segar `getCryptoMarketSnapshot`, `isCryptoTotalStillPayable`, `isFxSnapshotAcceptable`, `listSekalipayMethods`) — tanpa fallback ke rail lain. Invoice memakai adapter Market (`createNowpaymentsInvoice` USD fee-merchant floating, `createSekalipayGatewayInvoice`), `orders.payment_method` = `qris|nowpayments:<ticker>|sekalipay_gateway:<channel>`, `payment_account` = `QRIS|NOWPayments|Sekalipay`; kegagalan ambigu mempertahankan klaim (tanpa POST ulang), definitif membatalkan order lewat `transitionPendingOrder` + `expirePediaCheckouts`. Expiry order dipendekkan ke `min(15 menit, deadline tx)` oleh `shortenToProviderDeadline` dan tidak pernah dipanjangkan. `GET /api/pedia/orders/[code]` mengembalikan `payment_method` + `payment` view kanonis (`buildNowpaymentsPaymentView`/`buildSekalipayGatewayPaymentView`) sambil merekonsiliasi lewat klaim `claimNowpaymentsPollReconcile`/`claimSekalipayGatewayPoll`; `qris` hanya untuk provider QRIS. UI: `order-client` memuat daftar metode lewat quote ringan saat "Pilih metode lain" dibuka (promise dipakai ulang oleh create; QRIS tetap tanpa request tambahan) dan halaman pesanan merender `GatewayPaymentPanel` + `usePaymentConsent`. Paid transition pedia sudah memakai payload `null` di `sekalipay-gateway.ts`/`nowpayments.ts` → `processPediaPaidOrders` (paid-fulfillment + cron `lite`). Shared edit (tanpa ubah signature): `isValidBuyerOrderCode` di `src/lib/security.ts` dipakai consent/IPN/callback gateway; dua regex kode di `sekalipay-gateway.ts` menerima AXP. Tidak ada skema/migrasi baru.

Market ID/EN fase 1 (LOKAL, 7 November 2026, belum deploy): sumber locale tetap `axv_locale` (chrome/beranda/formMessage) dan `order.locale` (halaman pesanan/lacak), keduanya di `src/lib/i18n/locale.ts`; tidak ada route/API/schema/env baru. `src/lib/i18n/catalog-copy.ts` menampung chrome toko + banner/community/help sheet; `src/lib/i18n/market-categories.ts` memetakan slug kategori produksi ke EN (unknown → nama DB); `src/lib/i18n/order-copy.tsx` menampung salinan order/lacak/akses/PIN/kredensial/reminder/device/warranty dan dipilih dari `order.locale` atau `useDisplayLocale()`. `ProductCard`/PDP memakai `marketCategoryName(slug, locale)`; `CommunityBar`/`CrossServicePromo` menerima prop `locale` opsional dengan fallback `useDisplayLocale`; `PopupBanner` memakai `useDisplayLocale`. `WrCredentialsPanel`/`WarrantyClaimAccordion` menerima prop `locale` opsional. Halaman statis `cara-order`/`garansi-replace`/`artikel` menjadi client yang membaca `useDisplayLocale` (metadata dipindah ke `layout.tsx` server), dan `ServicesMenu`/`CrossServicePromo` memakai `axvaraServiceCopy` + fallback `useDisplayLocale` sehingga navbar/kartu Pedia yang tidak mengirim prop ikut cookie. Konten produk/S&K/aktivasi, email pembeli, admin, dan Pedia tidak termasuk fase ini.

Pedia ID/EN + mata uang tampilan (LOKAL, 7 November 2026, belum deploy): `src/app/pedia/layout.tsx` memasang `DisplayPreferencesProvider` (Market) sehingga `PediaNavbar`/`PediaBottomNav`/halaman klien Pedia memakai `useDisplayLocale` dan `useDisplayPrices` yang sama; cookie tetap `axv_locale`/`axv_currency`, tanpa state atau endpoint baru selain `POST /api/display-prices` yang sudah ada. Kamus chrome `src/lib/pedia/copy.ts` (`pediaCopy`, `fill`, `pediaNumber`, `pediaServiceName`, `pediaServiceText`, `pediaTargetKindLabel`, `pediaChecklistText`); varian EN untuk istilah/refill (`terms.ts`), bantuan (`help-content.ts`), ringkasan platform (`platforms.ts`), label gagal komentar (`custom-comments.ts`), dan status refill (`refill-policy.ts`). Teks layanan dari DB/snapshot diterjemahkan saat render (`localizePediaServiceCopy`), jadi tidak ada migrasi/skema baru dan snapshot pesanan lama tetap terbaca. Harga hanya tampilan: `money()` per komponen memilih `useDisplayPrices().text` saat `currency=USD`, selain itu format IDR existing. Pesan pembeli dari route `/api/pedia/*` memakai `pediaApiLocale(request)` + `pick(locale, id, en)` (`src/lib/pedia/api-locale.ts`): cookie `axv_locale` + `Accept-Language`, tanpa cookie = Indonesia; status code/field/klaim/rate-limit tidak berubah. Rail pembayaran Pedia masih QRIS saja (fase B belum dikerjakan).

Telegram hanya QRIS + Crypto (LOKAL, 7 November 2026, belum deploy; revisi 8 November 2026: pindah metode setelah kegagalan DEFINITIF): `freezePayq1` memakai `buildMethodOptions(subtotal, { includeGateway:false })`, jadi `sekalipay_gateway:*` tidak pernah masuk payq1/keyboard Telegram meski flag gateway menyala; web tetap memakai builder default (gateway ikut). `selectedSnapshotOf`/`dispatchPayq1Creating` menolak gateway (notis `method_unavailable` + `pmentry`) sebelum order/TX. Kegagalan create crypto diklasifikasikan `isDefinitiveNowpaymentsFailure(orderCode, message)` (`src/lib/telegram/payment-create.ts`) dengan kontrak yang SAMA dengan web/Pedia: TX klaim `initializing|pending` atau pesan `nowpayments_network_ambiguous`/`nowpayments_finalize_failed_manual_review` = AMBIGU; selain itu DEFINITIF. Definitif: order dibatalkan (`transitionPendingOrder` dengan items Market, restock sekali via guard atomik), TX non-terminal ditandai `failed`+`last_error`, anchor dilepas (`clearPayq1AfterDurableTx`), notis `create_failed` + tombol `pmentry` → quote/nonce baru. Ambigu: order+klaim dipertahankan, anchor `creating` TIDAK dilepas (pmentry `namespace_busy`) sehingga tidak ada invoice/order kedua; `pgo:`/`refresh:` tetap GET-only pada order yang sama. QRIS dari offer beku: menekan baris QRIS (`pm:`) melepas draft payq1 (CAS) dan langsung merutekan ke jalur QRIS legacy (`handlePayWithQris` untuk single, `handleCartCheckout`/`cconfirm` untuk cart) dengan guard existing; `pgo:` dengan `sel==="qris"` hanya fallback keyboard/state lama. Notis `create_failed` definitif memasang tombol `pmentry`; memo (`nowpayments_extra_id_unsupported`) tetap TX failed + order batal + anchor lepas dan kini juga menampilkan tombol. Legacy Telegram gateway order/invoice tetap dirender/direkonsiliasi dari binding tersimpan; tanpa migrasi.

Nominal crypto tampil dibulatkan ke atas (LOKAL, 7 November 2026, belum deploy): `displayCryptoAmount(payAmountText, usdTotalText)` di `src/lib/payments/crypto-display.ts` memilih presisi terpendek (mulai 2 desimal) yang kelebihan AKTUAL ≤ US$0,01 dari rasio USD/koin tersimpan; seluruh perbandingan memakai BigInt/string eksak (tanpa Number/float atau kurs live). Dipakai `GatewayPaymentPanel` (tampilan + nilai Salin) dan instruksi Telegram `showProviderInvoiceStatus`. `pay_amount_text`/provider/underpaid check tidak berubah.

Kurasi kanal gateway & copy gangguan (LOKAL, 7 November 2026, belum deploy; revisi sore: DANA_REALTIME ditampilkan lagi): `listSekalipayCatalog` mengecualikan HANYA `SHOPEEPAY_REALTIME` secara eksak (`/^SHOPEEPAY_REALTIME$/i`) dan menawarkan `SHOPEEPAY` biasa (label "ShopeePay") serta `DANA_REALTIME` (label "DANA") di Market web dan Pedia. Bukti produksi read-only: POST create `DANA_REALTIME` konsisten HTTP500 (order `AXV-20261107-0F943ABA`, `AXV-20261107-49A6C50F`), GET by ref 404, kanal lain 201 — owner tetap memilih menampilkannya dan menerima pembeli pindah metode setelah error. Telegram TIDAK terpengaruh: `freezePayq1` memakai `buildMethodOptions(..., { includeGateway:false })` (`src/lib/telegram/payment-quote.ts:208`) sehingga gateway tidak pernah ditawarkan di bot. `gatewayDisplayName`/`GATEWAY_DISPLAY_NAMES` tetap map ID eksak; tidak ada migrasi. Picker mengurutkan E-Wallet dari LABEL tampilan (`EWALLET_FIRST`), sehingga ShopeePay→DANA→GoPay→OVO. `paymentMethodProblem(locale)` di `src/app/api/orders/route.ts` menjadi copy 503 untuk gateway/crypto gagal/ambigu/initializing (ID/EN); jalur QRIS mempertahankan copy persiapannya. Klien checkout Market (`src/app/(shop)/checkout/page.tsx`) dan Pedia (`src/app/pedia/o/[slug]/order-client.tsx`) merespons `error_code: "payment_method_unavailable"` dengan membuang quote (+prefetch Pedia), mengosongkan metode gagal, memuat ulang daftar metode, dan mengambil quote baru; submit berikut memakai token baru. Reuse `orders.quote_id` UNIQUE (`route.ts:197-198`, `drizzle/schema.sql:120-121`) dan semantik klaim server TIDAK diubah. Batas Pedia (diperbaiki 7 November 2026): `createSekalipayGatewayInvoice` melempar `sekalipay_gateway_create_rejected` hanya untuk rejeksi provider yang terbaca (bukan `PAYMENT_ALREADY_EXISTS`, `DUPLICATE_REF_ID`, 502/504, timeout/jaringan, atau `skg_proxy_unreadable_response` — semua itu tetap `create_ambiguous`). Rute Pedia memanggil `confirmGatewayInvoiceAbsent(orderCode)` (GET read-only ber-admission; hanya 404 JSON = `absent`) lalu `markGatewayInvoiceCreateRejected` (TX `failed` + `last_error`, hanya baris `initializing` tanpa invoice id) dan baru membatalkan order + `expirePediaCheckouts`; GET rate-limited/error/200 atau mark gagal = klaim dipertahankan (perilaku lama). Guard duplicate-target (`src/app/api/pedia/orders/route.ts:250-254,275-276`) tidak diubah. Callback/reconcile telat aman: callback tetap 503/200 manual review (`callback/route.ts:45-52`), TX `failed` tidak dipoll (`payment-view.ts:45,56`), dan `order_status !== 'pending'` memblokir paid (`sekalipay-gateway.ts:409-440`). Market web tidak ikut membatalkan (tanpa guard duplikat); reuse `orders.quote_id` tidak diubah.

UI pembayaran pending gateway/crypto (LOKAL, 7 November 2026, belum deploy): `usePaymentConsent` menerima `navigate` (default `window.location.assign`) dan, setelah 200, memakai `payment.payment_link ?? payment.checkout_url` (https saja) ketika `payment.state === "pending"` untuk lanjut ke provider di tab yang sama setelah `onAccepted`; tanpa tautan hanya `refresh()`; 409 tetap stale+refresh tanpa auto-approve, dan in-flight/`busy` dijaga selama navigasi. Halaman `/pesanan/[code]` memakai `compactPayment` untuk QRIS DAN gateway/crypto pending (judul dari `orderPanelCopy.title`, detak 1 dtk saat `payment.state=pending`), sementara `GatewayPaymentPanel` memakai satu kartu terpusat untuk gateway dan grid dua kolom QR+detail untuk crypto. Tidak ada perubahan route, schema, env, HMAC/claim/retry, atau perilaku server; `lacak-pesanan-client` tetap memakai header non-ringkas dan `GatewayPaymentPanel` yang sama.

Katalog kurasi gateway Sekalipay (LOKAL, 6 November 2026, DIGANTI 7 November 2026 — lihat paragraf kurasi teratas; belum deploy): `listSekalipayCatalog` (`src/lib/payments/sekalipay-gateway.ts`) menyaring kanal `SHOPEEPAY` biasa (case-insensitive, eksak — bukan substring) sehingga hanya `SHOPEEPAY_REALTIME` yang ditawarkan; tidak ada fallback ke kanal biasa. [DIGANTI 7 Nov 2026: sekarang sebaliknya — `SHOPEEPAY` biasa ditawarkan, `SHOPEEPAY_REALTIME`/`DANA_REALTIME` dikecualikan.] `gatewayDisplayName(code, name)` memakai Map ID kanal eksak `SHOPEEPAY_REALTIME`→"ShopeePay" dan `DANA_REALTIME`→"DANA" (input dinormalisasi huruf/spasi); nama/label kanal tak dikenal — termasuk `constructor`/`__proto__` — dikembalikan apa adanya tanpa fallback nama atau pemotongan sufiks. ID kanal, fee/min/max tetap nilai provider. `listSekalipayMethods` mewarisi filter sehingga create web/admin/Telegram tidak menerima kanal biasa; `buildMethodCatalog`/`buildMethodOptions` tidak diubah bentuknya. `buildSekalipayGatewayPaymentView` menormalisasi label saat baca saja; `payment_transactions` tidak dimigrasi/dimutasi dan callback/reconcile tetap memakai channel tersimpan. Urutan E-Wallet (ShopeePay→DANA→GoPay→OVO, lalu sisanya tersedia-dulu) diterapkan di display `PaymentMethodPicker`, bukan di kontrak quote/token; VA/Lainnya/Crypto tidak berubah. Flag `SEKALIPAY_GATEWAY_ENABLED`/`NOWPAYMENTS_ENABLED` tidak berubah.

Finalisasi/pemulihan invoice gateway (LOKAL, 6 November 2026, belum deploy): `paymentUrl` tetap wajib https kanonis `sekalipay.com` untuk `payment_link`; `checkout_url` opsional kini lewat `optionalCheckoutUrl` — hanya URL kanonis yang disimpan, link app (`app.shopeepay.co.id`) diredaksi ke null tanpa menambah host allowlist. `is_sandbox` dari respons create disimpan pada probe finalisasi; GET `payment/{ref}` boleh tanpa field itu (dokumentasi resmi: sama seperti create tanpa `is_sandbox`); bila ada wajib boolean dan cocok dengan mode create-time tersimpan, yang juga dipakai menerima `completed`. Reconcile baris `initializing` tanpa mode sandbox tersimpan tetap fail-closed (GET tidak boleh mengarang mode); marker substantif dipertahankan. Create retry tetap GET-only tanpa POST ulang; validasi binding/expiry, consent, callback, late review, dan budget status tidak berubah. Bukti fokus 4 file/97 tes lulus; tidak ada mutasi produksi.

Verifikasi integrasi PM final pada tree ini (6 November 2026): `NODE_ENV=test npx vitest run --run --maxWorkers=2` 361 file/4817 tes lulus (111,07 dtk; dua timeout run pertama hanya persaingan sumber daya — kedua file 16/16 terpisah lalu full hijau); `npm run lint` exit0 (warning existing, tidak ada di 3 file produksi berubah); `npx tsc --noEmit` exit0; `npm audit --audit-level=high` exit0 (0 high/critical, 6 moderate existing minimatch/tooling); `env -u NODE_ENV npm run build:pages` exit0/148 edge routes. Chromium pada Pages/workerd hasil build, fixture mock-or-deny + signed app/Access, flag publik OFF: 1280 EN/390 ID tujuh wallet urut ShopeePay→DANA→GoPay→OVO→LinkAja→Virgo→AstraPay tanpa SHOPEEPAY biasa/teks Realtime, ID/fee persis, VA10/Crypto28 tetap; keyboard panah fokus cyan2px; 360 quote sintetis ShopeePay nonaktif tetap posisi pertama (Min74000/shortfall10000) dan keyboard native melewati ke DANA; CSS/JS200 tanpa error baru. Order mock saja (subtotal64000 OVO estimasi1920→final provider2420/total66420): POST201→fee_consent_required tanpa link, consent nominal tepat POST200→link kanonik, reload invoice sama/GET200, hanya satu POST create; tidak menavigasi/membayar, mengirim pesan/email, atau memutasi produksi/reset klaim/mengubah env/flag. Redaksi app URL + GET tanpa sandbox tercakup 97 tes fokus termasuk workerd, bukan transaksi produksi baru. Legacy produksi tetap manual review tanpa reset. Log `/var/folders/bs/x8qyjdq510sbmbj6pmmvpd3w0000gn/T/opencode/ewallet-*-final.log`; screenshot `.playwright-mcp/ewallet-final-{desktop,mobile,mobile-disabled}.png`.

Status 6 November 2026: baseline UI/logo terdeploy pada `e2aa02a375d4dd7dab0ed33a1499f6262e433f5f` (Pages `8d7a4469-3d89-414e-bf3e-89dc8c4bf0d5`); proxy VPS `/skg/*` terpasang dan halaman/API tes admin `770a051` kini terdeploy. Konfigurasi khusus tes admin, kedua rail publik tetap `false`. Koreksi signature POST `38d2878` aktif di canonical `d2edb1924250472af223cfce0b955e2412bca1ee` (success `2026-11-06T15:40:46.22327Z`; bukti read-only invoice tersimpan, bukan paid/settlement); kontrak dan batas bukti di §16.20–16.21. Parser/kurasi baru masih menunggu publikasi. Catatan lokal lama di bawah adalah snapshot historis, bukan status rilis terkini.

UI gateway lokal 6 November: `PaymentMethodPicker` memakai `GatewayPanel`/`GatewayRow` pada grup VA/E-Wallet/Lainnya di atas Crypto, pencarian bila >8 baris dan ubin logo/monogram dari helper dekoratif `gatewayShortName`/`methodMonogram`. Semua nominal berasal dari `parsePayOptions`; ringkasan checkout menampilkan subtotal/biaya/total, sedangkan `GatewayPaymentPanel` mempertahankan consent wajib sebelum membuka tautan. Tidak ada route, schema, dependency, env baru atau perubahan HMAC/claim/retry. QA runtime lokal memakai artefak Pages, snapshot katalog dan invoice mock dengan batas outbound tertutup.

Crypto multi-koin (LOKAL, 5 November 2026, belum deploy; revisi 7 November 2026: lantai US$2 dihapus, lalu biaya layanan diganti model per koin 1% + biaya tetap — lihat §16.23/§16.24): migrasi `0102_crypto_surcharge.sql` (+ `drizzle/schema.sql`) menambah rincian biaya layanan di `payment_transactions`; invoice baru floating + fee merchant; token/Telegram/web generik per ticker kurasi; env `NOWPAYMENTS_PAY_CURRENCY` dihapus. Lihat §16.19.

FX otomatis + snapshot koin crypto (LOKAL, 5 November 2026, belum deploy): migrasi `0101_crypto_market_snapshot.sql` (+ `drizzle/schema.sql`) menambah tabel satu-baris `crypto_market_snapshot` (`id=1`: `fx_rate_text`, `fx_source`, `fx_effective_at`, `coins_json`, `coins_refreshed_at`, `last_error`, `last_attempt_at`, `lease_until`, `updated_at`). Kurs USD/IDR tidak lagi manual dari env: cron lite `cleanup` (tick 5 menit existing, tanpa trigger baru) memanggil `refreshCryptoMarketSnapshot` (`src/lib/payments/market-snapshot-refresh.ts`) hanya bila kurs atau koin lebih tua dari 30 menit/kosong. Detail di §16.18.

Koreksi lokal 5 November: halaman pesanan memakai `parseExpiry` untuk expiry order dan countdown QRIS; tanggal SQL D1 tanpa zona ditafsirkan UTC, tanggal hilang/invalid gagal tertutup di tampilan. Snapshot lokal tanpa expiry order valid dilewati dan GET server ditunggu; expiry QR tidak dianggap expiry order. Tidak mengubah penyimpanan atau TTL server; browser/build ulang menunggu.

Checkout client memakai preferensi bahasa eksplisit, lalu locale quote, dengan default otomatis sebelum quote; `lib/i18n/checkout-copy.ts` hanya memetakan pesan lokal yang dikenal. Perubahan tampilan tidak menjadi dependency fetch quote dan tidak mengubah snapshot finansial. Diverifikasi browser nyata secara lokal (5 November 2026).

Consent fee Telegram lokal menggunakan WebCrypto HMAC-SHA256 Edge, tag tetap 8 byte/16 hex terikat order, pemilik, invoice dan total tampil; perbandingan tag melalui verifikasi HMAC native. Perubahan ini belum menjadi bukti Pages build/deployment.

Kontrak opsi quote gateway (5 November 2026, lokal): `listSekalipayCatalog(amount)` (src/lib/payments/sekalipay-gateway.ts) mengembalikan semua kanal merchant dengan biaya DIKENAL (parser ketat) dan batas valid sebagai `available:true` (biaya/total dari matematika server yang sama) atau `available:false` dengan `reason` `below_min|above_max` dan `shortfall = min - subtotal` (hanya below_min, dihitung server). Batas INKLUSIF: tersedia iff `min <= subtotal <= max`; biaya tak dikenal, batas cacat, QRIS atau `payment_type` tak dikenal tetap disembunyikan (fail closed); `payment_type` hilang → grup `other`. `listSekalipayMethods` tetap HANYA yang tersedia (dipakai create web dan TG). `buildMethodOptions(subtotal)` (default; dipakai TG dan token) hanya memuat opsi tersedia; `buildMethodCatalog(subtotal)` (hanya quote web) menambah kanal nonaktif. Respons quote menambah field tampilan top-level `group: va|ewallet|other` dan `limits {min,max}` pada opsi gateway serta `unavailable_reason`/`shortfall` pada yang nonaktif (tanpa `estimated_fee`/`estimated_total`); `signed payment_methods` memuat HANYA yang tersedia dan TIDAK memuat `group`/`limits`/alasan, sehingga create menolak ID nonaktif seperti metode tak dikenal, ditambah guard eksplisit dan validasi ulang batas LIVE di create (stale quote → 503 sebelum pesanan). Tidak ada perubahan schema, penyedia POST, reconcile, HMAC, claim/retry, atau consent. Katalog merchant asli belum terverifikasi (IP belum di-whitelist); semua tes memakai fixture kontrak. UI: `PaymentMethodPicker` (QRIS langsung + akordeon grup lain), `BulkPriceTiers` (baris tier), `PreferenceControls` (bendera + menu) — lihat docs/DESIGN.md; `public/flags/*` dari flag-icons (MIT).

Revisi visual lokal (4 November 2026): `PreferenceControls` memakai satu komponen dengan prop `variant` (`nav` ≥sm di `Navbar`, `sheet` <sm sebagai baris pertama `Footer` non-Pedia); panel hanya dirender saat terbuka sehingga tidak ada radio/ID ganda, dan catatan FX memakai `useDisplayPrices([0])` yang sama (satu POST `/api/display-prices` hanya saat USD dipilih dan panel terbuka; bukan otoritas quote). `ServicesMenu` menerima `locale` opsional (Market saja). Halaman `/pesanan/[code]` memakai locale pesanan tersimpan untuk chrome ringkasan/footer. Tidak ada perubahan API, schema, FX, harga grosir, penyedia, atau kontrak finansial. Preview lokal interaktif adalah alat QA sementara di luar repo (tidak ada route/env/kontrak baru di aplikasi; tidak dilacak git).

Integrasi UI lokal: `(shop)/layout.tsx` memasang `DisplayPreferencesProvider`; `useDisplayPrices`, `usePreferences`, `usePaymentConsent`, `bulk-display` dan `payment-ui` mendukung `Price`, `BulkPriceTiers`, `PaymentMethodPicker`, `GatewayPaymentPanel`, `PreferenceControls` serta `admin/BulkTierEditor`. Checkout mengirim ID `paymentMethods` dan quote bertanda tangan; `expected_price` tetap base. Pesanan/lookup memakai `order.payment` + locale tersimpan. Belum ada bukti deploy produksi; QA browser nyata lokal 1280/390 lulus (5 November 2026), editor admin tidak diverifikasi.

`POST /api/display-prices`: edge, body JSON ≤2048 byte, 1–64 integer IDR aman, satu snapshot FX server (`loadCurrentFxSnapshot()`: snapshot D1 otomatis ≤24 jam → pasangan env darurat `USD_IDR_RATE`/`USD_FX_EFFECTIVE_AT` → null; lihat §16.18) menghasilkan sen USD untuk tampilan saja; missing/stale → null/IDR fallback. Respons private/no-store, tanpa provider (membaca D1 satu baris, memo isolate 60 dtk); rate limit `display:prices` 120/menit per isolate best-effort. Katalog publik tetap cache netral preferensi; tidak ada cookie default yang dipaksa, tidak ada FX klien, dan endpoint bukan otoritas quote/charge.

R3 koreksi lokal: predicate notifier/queue-probe bersama mencakup terminal gateway/crypto dengan atau tanpa ledger; CAS notice memeriksa ulang paid/review. Retry teks dan pengiriman pertama berbagi klaim percobaan; saved-only retry meneruskan captured DatabaseAccess ke view dan marker, dengan admission delapan statement sebelum kerja per rail baru (QRIS lima).

R2 koreksi lokal: callback/reconcile mengganti hanya placeholder probe/finalize teknis dengan review konflik; review lain sticky. CAS finalisasi pin invoice, order, net, channel dan fee estimasi; retry GET saja. Dispatch tidak langsung GET pasca POST ambigu; refresh/cron bertanggung jawab recovery.

TG-R1 lokal: `src/lib/payments/method-options.ts` `buildMethodOptions(idrSubtotal)` = tail quote-route verbatim (QRIS-first + gateway strict-fee + `buildCryptoOffer` + minimum), dipakai web route + TG; TG `src/lib/telegram/payment-quote.ts` freeze `payq1:{v,nonce,exp,tag,linesHash,cart,methods,sel,contact,st}` (16KiB/64-method, 600s, namespace-guard CAS) + `handlers/payment-methods.ts` render/seleksi `pm:<nonce>:<index>` (frozen-only, legacy QRIS tak tersentuh).

TG2c1 buyer transaction locale fixture lokal: `orderLocaleOf(row)` dari `orders.locale` tersimpan di-thread ke handlers invoice/cart-invoice/orders/discovery/retry/notifier/credential-delivery + messages invoice/status/credential + keyboards buyer; admin/grup/WA tidak berubah.

TG2b bulk Telegram fixture lokal: `resolveBulkPrice` di cart/qty/invoice +
guard atomik `createChannelOrderAtomic` pin base/konfigurasi tier
(per-varian agregat) dan locale TG; invoice QRIS terima net diskon.

TG2a read-commerce locale fixture lokal: `render-prefs.ts` (`tgCtxFor` prefs+FX
sekali per handler; `tgDisplayPrice` satu harga display, `tgUsdAlternate`
alternatif jujur) di-thread ke handlers catalog/discovery/cart/command/callback +
keyboards/messages ID/EN; invoice/order-status tetap TG2b/c.

TG1 lokal (+correction1): migrasi 0100 display_currency + store preferences (lang:/cur: owned chat, payload onboarding:* di pending_action, konsumsi sekali; route tidak pre-answer lang:/cur:).

BULK1d lokal (8 November 2026): editor grosir dipasang di modal produk yang live (`ProductEditorModal` → `ProductVariantRows`/`SingleVariantFields`); `VariantEditor` ditandai tidak dipakai. Kontrak admin sama (`PUT /api/products/:id`, `POST/PUT /api/admin/variants`, `bulk_pricing: { enabled, tiers }`, omitted=preserved), ditambah **kode error baru `bulk_pricing_supplier_forbidden` (400, pesan "Harga grosir hanya untuk produk manual.")** bila `enabled=true` dikirim untuk produk supplier; `enabled=false` tetap diterima untuk membersihkan data lama. Identitas supplier = `products.source != 'manual'` OR `wr_product_id`/`sk_product_id` terisi OR `wr_auto_managed`/`sk_auto_managed = 1` (SK memakai source='manual' + sk_product_id), dievaluasi oleh `isManualProductForBulk` di `src/lib/bulk-pricing.ts`. Jalur harga memakai `resolveBulkPriceForProduct`/`bulkOwnerFromJoinedRow`: katalog (`mapVariant` — choke point untuk PDP, `/api/catalog`, dan `getActiveVariant` yang dipakai seluruh handler Telegram), quote `/api/checkout/quote`, recheck `/api/orders`, `src/lib/db/orders-create.ts`, `src/lib/commerce.ts`, dan `src/lib/telegram/cart.ts`; data tier tersimpan pada varian supplier tidak dipakai dan tidak dihapus. `POST /api/products` tetap tidak menerima bulk (editor menunggu produk tersimpan). Tidak ada migrasi baru.

BULK1c lokal (+correction1): protected admin API (`PUT /api/products/:id` + `POST/PUT /api/admin/variants`) persists bulk per varian (GET raw+corrupt flag; default off create; omitted=merged-validated; strict zod; guards atomic dalam batch + 409; audit console.info). UI/TG belum dihubungkan.

BULK1b lokal: quote menormalisasi alias produk dan menyimpan `base_price`/`applied_tier_min_qty` bersama harga efektif bertanda tangan; order baru memvalidasi konfigurasi dan guard D1 mengikat konfigurasi saat reservasi. Retry order tersimpan tidak dihitung ulang; integrasi admin/UI/TG belum dilakukan.

BULK1a lokal menambah migrasi 0099: `product_variants.bulk_pricing_enabled` dan `bulk_pricing_tiers` ber-constraint; `src/lib/bulk-pricing.ts` memvalidasi tier dan katalog memproyeksikan konfigurasi valid. Checkout/admin belum memakai tier.

LOC1 lokal: `src/lib/i18n` memproses cookie `axv_locale`/`axv_currency`, Accept-Language dan `getRequestContext().cf.country` native; quote mengembalikan `displayPreferences` tanpa menyimpan mata uang ke order atau mengubah rail. UI/Telegram belum terhubung.

S3d2 lokal menambahkan migrasi 0098 `payment_transactions.fixed_rate` nullable dan policy crypto buyer-fee/fixed-rate; review sticky dan batas provider tidak bisa diperpanjang. Fixture lokal, belum untuk produksi.

S3d1 lokal: preflight NOWPayments membutuhkan `NOWPAYMENTS_OUTCOME_CURRENCY` operator-verified dan meminta minimum fixed-rate/buyer-fee; response JSON numerik dibaca sebagai token teks eksak. Create/quote fee policy dan produksi belum diaktifkan; lihat §16 untuk handoff env.

S3c lokal: admission status merchant memakai satu counter D1; claim/reconcile/paid memakai accessor cron berbudget. Fixture cron dan workerd memeriksa batas, expiry dan paid atomik; belum dipublikasikan.

S3b lokal dalam pengerjaan: order gateway memakai quote bertanda tangan, view buyer dan endpoint consent; verifikasi race/retry belum lengkap dan belum untuk publikasi.

S3a lokal: quote menandatangani snapshot merchant `{channel,estimated_fee,estimated_total,idr_subtotal}`; kegagalan daftar metode tidak memblokir rail lain. Order/UI gateway belum terhubung.

Sekalipay merchant S2b lokal memakai migrasi 0097 untuk invoice/consent fee; create satu POST dan retry GET, callback HMAC dan reconcile GET memakai guard paid atomik. Ini fixture, bukan deployment atau integrasi checkout.

W3 backend lokal: checkout quote/order crypto menyimpan snapshot USD dan locale, status provider durable dan rekonsiliasi pada job payments; migrasi 0094–0096. UI/Telegram dan publikasi belum dilakukan; §16.17 adalah snapshot W1 historis.

## AXVARA Games — arsitektur (9 November 2026)

Spesifikasi produk/desain lengkap: `docs/GAMES.md`. Backend inti, admin dan API
pembeli B1 QRIS + B2 gateway/crypto + S1 routing/nickname sudah diimplementasikan lokal (§16.25–§16.29); belum ada bukti
deployment Games. Daftar berikut mempertahankan snapshot rancangan awal;
status implementasi terkini mengikuti seksi §16 tersebut.

- **Route (rencana):** `src/app/games/{page,[slug],pesanan/[code],lacak,bantuan,ketentuan}`
  mengikuti pola `src/app/pedia/*`; API `src/app/api/games/*` untuk quote/order dan
  `POST /api/games/digiflazz/webhook`.
- **Egress Digiflazz:** whitelist IP Digiflazz = VPS `13.228.147.90`; Pages tidak punya
  IP tetap, jadi panggilan runtime lewat route proxy baru di VPS (usulan `/dgf/*`,
  header `x-proxy-token`, allowlist eksak `cek-saldo`, `price-list`, `transaction`),
  mengikuti pola `/skg/*`. Key Digiflazz tetap server-side.
- **Data (rencana D1):** katalog game & SKU (kode buyer, modal, status seller, harga
  referensi pembanding, harga jual hasil rumus), pesanan game (ID akun, nickname,
  harga terkunci, metode bayar) dan dispatch Digiflazz (`ref_id` unik, status,
  SN/keterangan, `max_price`, percobaan cek).
- **Harga:** sinkron `price-list` terjadwal dan di-cache (bukan per page view; batas rate
  Digiflazz). Harga jual = referensi Oura −2% dengan batas bawah modal + biaya kanal +
  3%. Sumber harga referensi (input admin vs impor berkala) masih keputusan terbuka.
- **Dispatch:** hanya setelah pembayaran terverifikasi; pending/timeout dicek ulang
  dengan `ref_id` yang sama, tidak membeli ulang; webhook memverifikasi
  `X-Hub-Signature` HMAC-SHA1 body mentah dan idempoten.
- **Pembayaran:** memakai rail existing (QRIS provider tersimpan, gateway Sekalipay
  VA/e-wallet, NOWPayments crypto) tanpa rail baru.
- **Sudah ada (9 Nov 2026):** `src/lib/games/pricing.ts` (fungsi murni `computeGamesSellPrice`/`gamesPriceFloor`, tanpa I/O) + `tests/games-pricing.test.ts`. Rencana fase G1–G8: `docs/GAMES.md` §11.
- **Env (rencana, semua `secret_text`):** kredensial Digiflazz + secret webhook + URL/token
  proxy `/dgf`; dicatat di §16 saat benar-benar dipasang.

## Koreksi order Pedia - 3 November 2026

Revert paket UX `1b0efde` sesuai keputusan owner, mempertahankan panel deskripsi
`3820cbc` dan memadatkan layout-nya. Katalog kembali ke kontrak sebelumnya tanpa
field `min_order_rp` atau perluasan kandidat `quick_quantities`; contoh jumlah
berasal dari paket existing. `ServicePicker` kembali ke grup Refill/No Refill
(tanpa Sorotan), dan `OrderClient` mengembalikan langkah ringkasan serta aturan
waktu sebelumnya. `ServiceInfoCard` menyajikan label–nilai satu kolom mobile dan
dua kolom mulai sm; Speed/Avg time tetap field terpisah. Tanpa route, schema,
env, migrasi atau perubahan harga/pembayaran. Implementasi untuk publikasi CI;
deployment belum diverifikasi.

## PDP varian dan komponen layanan bersama - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. `product-detail-client.tsx`
tidak lagi memakai varian aktif pertama untuk fallback S&K multi-varian.
`selectedVariant` tetap sumber harga/cart/checkout dan kini menentukan detail
varian. Salinan bersama hanya ditampilkan jika identik dan tersedia di semua
varian; salinan kosong tidak mengambil varian lain. `mergeProductCopy` existing
dipakai terpisah untuk copy varian dan ketentuan tingkat produk pada multi-varian,
tanpa perubahan parser, API atau data produk. `VariantIdentity` mengumumkan nama
pilihan; modal pemilih existing dipakai ulang. Disclosure mobile mempertahankan
state ketika pilihan berganti. Bagian perbandingan hanya diganti label tampilnya.

`CommunityBar`/`PediaServiceCards`/`CrossServicePromo` tetap dua kolom di semua
lebar (koreksi owner, tanpa reflow 480px); compact
`ProductCard` dan rail terkait memakai ukuran desktop mulai sm. `ServicesMenu`
tidak lagi membutuhkan prop compact; Market dan Pedia berbagi label Layanan serta
nama aksesibel Layanan AXVARA, dengan perilaku keyboard existing. Tidak ada route,
dependency, env atau perubahan flow pembayaran untuk perbaikan UI ini.

## Koreksi orbit responsif dan cancel pencarian — 31 Oktober 2026

Implementasi lokal untuk publikasi CI. `PediaHomeClient` tidak lagi menyembunyikan
orbit di bawah lg: satu instance dengan flex center/mobile dan end/desktop, hero
overflow-hidden menjaga lebar kecil. Mesin animasi tidak berubah. CSS bersama
`header input[type="search"]::-webkit-search-cancel-button` meniadakan appearance
bawaan agar tidak menduplikasi clear custom Navbar/PediaNavbar. Tanpa perubahan
route permanen, state, API, env, dependency atau pembayaran.

## Interaksi storefront — 31 Oktober 2026

Implementasi lokal untuk publikasi CI, bukan bukti deployment. Navbar Market memakai
form pencarian native; input beranda memfilter Zustand `useSearch`, sedangkan
submit dari rute lain memakai router ke `/#katalog` tanpa membuang query. Gulir
hanya saat mulai mengetik di beranda atau submit, dengan preferensi reduced motion.
Orbit Market/Pedia memasang listener media query yang dibersihkan saat unmount;
start/tick tetap dijaga visibility/intersection/preferensi, tanpa loop baru.
`usePediaPrices` menambah aksi retry lokal: hapus hasil gagal, abort request lama,
debounce300ms dan GET endpoint harga yang sama. Respons stale tetap diabaikan;
preview/jumlah kosong atau non-integer tidak meminta harga. OrderClient menyajikan retry melalui
live status tanpa mengubah draf atau memanggil quote/order. Tidak ada route API,
schema, env, dependency, cron, provider atau kontrak pembayaran baru.

## Proof pembeli dan email kredensial, 28 Oktober 2026

✅ Implementasi lokal untuk publikasi CI, menggantikan kontrak PIN checkout
27Oktober. Migrasi0081/0082 dan formatpin6/code26 tetap; factory baru version1/pin6,
legacy v0 kontak, kode26 tetap derivasi lama. HMAC PIN30bit campuran huruf/angka
memakai BUYER_ORDER_ACCESS_SECRET existing; tidak ada env/key/dependency baru.

`order-access.ts` memisahkan purpose. Sesi `p1` HMAC256/domain buyer-status-session
terikat order+versi+expiry24jam hanya diterima bila handler eksplisit
allowStatusSession pada GET status Market/Pedia. Prefix b1 lama ditolak. Checkout
quote valid dapat menerbitkan sesi status setelah order durable, tetapi tidak
lagi mengembalikan buyer_access_code. Lookup status memakai kontak penuh. Mutasi
cancel/reissue/refill tidak menerima sesi status sebagai proof.

Tab checkout Market asli mendapatkan proof c1 terpisah, hanya dari respons POST
create durable atau retry quote yang sama melalui SELECT quote_id dari jti token
bertanda tangan. Domain buyer-checkout-credentials, HMAC256 atas order+versi,
HMAC domain buyer-quote-binding atas quote_id tersimpan dan expiry tetap24jam.
Tidak diterbitkan oleh lookup/status/admin/Pedia/Telegram, tidak ada endpoint
refresh. Token p1/b1 tidak dapat dipromosikan. Client menyimpan c1 sessionStorage/
memori tab dan mengirim x-checkout-credential-grant hanya ke credentials POST.
PIN tidak ikut dikembalikan atau disimpan. Order/quote/versi lain, missing quote,
expiry atau signature salah ditolak; key hilang503. Rotasi versi mencabut c1.

CredentialsPOST memakai field contact dan access_code terpisah untuk pin6;
required invoice dari path. Guard lunas/kredensial siap mendahului kebutuhan PIN,
tanpa membaca plaintext sebelum proof. Admission D1 order+versi10/15menit diambil
sebelum compare PIN+kontak, lintasIP dan fail-closed503. Sukses decrement slot
sendiri, kegagalan generik404. Session p1/b1 tidak diterima pada jalur kredensial.
c1 checkout asli yang valid dapat menggantikan kontak+PIN setelah paid/ready;
tidak mengonsumsi atau mereset counter PIN, tidak diterima pada mutasi/status.
Legacy v0 tetap kontak, code26 tetap strong-code kompatibel. Pedia tidak memiliki
kredensial akun sehingga lookup/status/refill memakai kontak, tanpa PIN buntu.

Migrasi0083 menambah wr_credential_tokens.buyer_access_version default0.
PIN6 token baru hanya diterbitkan setelah proof kontak+PIN atau c1 valid: INSERT SELECT CAS
memastikan versi akses order masih sama/paid. Verifier join orders mewajibkan
versi token sama dengan versi order untuk pin6; writer lama/default0 tidak bisa
melewati cutover di sela migrasi dan deployment. Token legacy/code26 tetap valid
sampai expiry/revokasi. Client memakai x-credential-token di GET, query token hanya
kompatibilitas. AdminView tetap Access+sesi aplikasi tanpa capability pembeli.

Browser menyimpan hanya kontak/sesi status, c1 checkout atau capability di sessionStorage/
memori tab. PIN yang diketik pembeli hanya React state, tidak sessionStorage,
localStorage atau fragment. Kartu PIN pada pesanan dihapus; formulir lacak punya
invoice/kontak/PIN, dan panel kredensial memverifikasi dua field terakhir.
Form lacak tanpa helper di bawah field; label PIN menjelaskan sumber email checkout,
pesan validasi dan aturan PIN opsional untuk status tetap dipertahankan.
Tidak ada PIN dalam respons buyer, tautan, log, history atau pesan Telegram.

### Email PIN hanya bersama kredensial

Email produk siap existing (buildCredentialReadyTemplate/buildOrderReadyTemplate)
tetap memuat kredensial lengkap inline dan PIN versi tersimpan. Email pembayaran
atau status Pedia tidak membawa PIN. Factory/order API tidak lagi membuat antrean
atau menjadwalkan email PIN. Prefix lama email:access_pin: tidak diproses lagi;
metadata dan kolom access_attempts/retry_at/lease tetap, tanpa DROP/backfill.

Rotasi admin tetap POST privat/no-store/CAS+revoke capability+audit. Bila order
paid dengan kredensial tersedia, batch yang sama mengantrekan prefix baru
email:credential_access:order:vN. Setelah event audit, sender membaca versi aktual,
menghentikan job superseded, mendekripsi snapshot WR/generic sesaat dan merender
email kredensial lengkap+PIN. Tidak ada plaintext credential/PIN di antrean.

Resend memakai lease CAS, increment durable sebelum jaringan, timeout8detik,
max5attempt/backoff1/5/15/60menit, Resend idempotency order+versi+HMAC isi tanpa PIN. Notify
cron existing bounded2, deadline/canSpend menjaga8 statement per email ditambah2
probe awal; operasi gate minimal10 statement. Probe existing menyertakan antrean
resend tanpa query tambahan saat kosong. Tidak ada trigger/loop baru. WA nonaktif.

Key buyer tetap secret_text dari .buyer-access-credentials ignored/chmod600,
produksi67/128 termasuk4 sistem. Password/JWT tidak memutar key buyer. Rotasi key
buyer membatalkan seluruh kode/PIN/sesi; recovery harus memulihkan key yang sama.
Tidak ada perubahan WAF/MFA admin atau provider/supplier pembayaran.
[Runbook](../issue/buyer-contact-pin-2026-10-28.md).

Toolchain tetap Miniflare4.20260730.0/Undici7.30.1/Sharp0.35.5,
next-on-pages1.13.16/Next15.5.28/Node22; tiga advisory dev sebelumnya tetap ditutup.

## Admin Cloudflare Access — 27 Oktober 2026

✅ Konfigurasi edge aktif; implementasi origin/fixture lokal, publikasi CI.
`src/lib/cloudflare-access.ts` memverifikasi assertion header atau tepat satu
cookie `CF_Authorization` melalui jose RS256, issuer team tetap, audience app
tepat dan email sama dengan `ADMIN_EMAIL`. Claim exp/iat/sub/email wajib.
JWKS hanya `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, timeout5s,
cache10menit/cooldown30s; redirect ditolak dan cookie/header request pengguna
tidak diteruskan. Fetch/key-refresh gagal menolak admin, tanpa cache abadi.

Pemeriksaan berada di `checkAdminSession` setelah JWT/idle/revokasi aplikasi,
sehingga API campuran, requireAdminDetailed, `/me` dan `/refresh` sama-sama
terlindungi. GET/POST login juga memerlukan Access sebelum body/password/D1;
burst5/menit tetap mendahului verifikasi. Konfigurasi produksi hilang/parsial
menolak503; hanya non-produksi tanpa kedua env boleh memakai login fixture lama.
Token palsu/kedaluwarsa menolak401 `access_required`; gangguan503
`access_unavailable`. `admin-auth-fetch` mengenali penolakan Access dan redirect
edge lewat navigasi penuh `/admin`, tanpa memutar cookie saat gagal. Logout
tetap boleh mencabut sesi aplikasi tanpa Access.

### Konfigurasi Pages dan Cloudflare (§16)

- `ADMIN_EMAIL` existing diganti ke email owner, password/hash/JWT secret tetap.
- Dua Pages **secret_text** baru: `CF_ACCESS_TEAM_DOMAIN` (hostname team tanpa
  skema/path) dan `CF_ACCESS_AUD` (audience64hex aplikasi admin, bukan launcher).
  Sesudah tambahan key buyer: produksi63 variabel +4 sistem =67/128 Workers
  Paid; preview tetap.
- Team `axvara-admin-9d00b9.cloudflareaccess.com`; app AXVARA Admin melindungi
  `/admin`, `/api/auth`, `/api/admin` pada apex/www/Pedia. Policy hanya email owner,
  PIN email IdP + independent MFA wajib (TOTP/biometrik/security key), sesi8jam.
  Cookie HttpOnly/binding aktif, Path tidak dibatasi agar API campuran mendapat
  cookie; origin tetap memeriksa tanda tangan. UI admin host alternatif diarahkan
  ke apex sebelum rewrite Pedia, API alias Pages tetap ditolak tanpa token valid.
- App Launcher terpisah dengan policy satu owner dan MFA disabled hanya untuk
  enrollment. Audience berbeda tidak diterima origin. Jangan blanket `/api`,
  karena pembeli/cron/webhook/supplier-sync/agent memiliki kontrak tersendiri.
- Detail enrollment, pemulihan manual, revokasi, bukti dan residual:
  [runbook](../issue/admin-access-2026-10-27.md). Tidak ada migrasi, env seed,
  dependency, cron atau perubahan langganan. Deploy hanya push main via CI.

## WR receipt timeout dan pemulihan invoice — 27 Oktober 2026

✅ Implementasi/fixture lokal; rilis melalui CI. `warung-rebahan/order` menulis
request_sent_at sebelum POST dan menghentikan jaringan jika persist gagal.
Timeout/5xx ambigu mempertahankan bukti kirim tanpa pembelian ulang; respons atau
error terlambat dibatasi status claimed dan invoice kosong agar terminal tidak
diturunkan. Common reconciler hanya memakai ID invoice yang sudah terikat,
menolak ID duplikat di feed, membaca transaksi sekali per batch, dan memeriksa
budget sesuai jalur completion/failure. Cron tetap40 statement, tanpa trigger baru.
Completion rekonsiliasi mengantrekan delivery durable dan menyerahkan pengiriman
pada worker existing; kegagalan tidak memperbarui ciphertext milik completed.

`POST /api/admin/warung/orders/:id/sync-now` tetap menerima body kosong untuk
invoice existing; body opsional `{wr_order_id:string}` (maks1000 byte aktual,
ID1..120 alnum/underscore/hyphen) hanya untuk pemilihan invoice oleh admin.
Missing-ID memerlukan status submitted/ordering/claimed dengan bukti kirim,
order lokal lunas/paid, satu transaksi exact-ID, paid, status dikenal, satu
produk dengan qty/unit-price/total integer cocok snapshot. Verifikasi memakai
variant_id eksplisit atau nama produk/varian/type/duration/warranty lengkap dan
unik pada mirror WR; harga mirror wajib cocok. Assignment satu UPDATE CAS
memeriksa ulang snapshot/status/paid dan NOT EXISTS pemilik invoice lain.
Konflik409, upstream gagal502, body invalid400/413; tidak mengubah order lama
yang sudah berinvoice lain. Setelah binding, common completion existing berlaku.
Input ada di `SupplierLinkActions`; status buyer/refresh mengakui missing-ID serta
claimed terkirim sebagai masih berjalan, tetapi tidak memilih invoice otomatis.

`POST /api/webhook/warung` membalas503 untuk event terminal yang belum diterapkan
ke link, termasuk failed/refunded. HMAC/body mentah dan retry upstream tetap.
API WR resmi hanya50 transaksi terbaru, products tanpa variant_id dan created_at
tanpa zona dapat terjadi: tidak ada auto-match berdasarkan nama/waktu, kalibrasi
zona atau asumsi exclusive-writer. Tanpa korelasi upstream, pemilihan admin tetap
diperlukan; ini mencegah salah kirim akun pembelian manual supplier.
Tidak ada env, secret, migrasi, deployment proxy atau order supplier QA baru.
Bukti recovery/QA: [laporan](../issue/wr-timeout-recovery-2026-10-27.md).

## Hardening keamanan OWASP — 27 Oktober 2026

✅ Implementasi/fixture lokal, publikasi CI. [Laporan audit](../issue/owasp-audit-2026-10-27.md)
memetakan seluruh kategori Top10:2025 beserta batas bukti operasional.

- `GET /api/products/:id` adalah endpoint editor admin: requireAdmin mendahului
  query, respons privat/no-store; modal dan varian nonaktif tidak dibuka ke anonim.
- Artikel publik API memakai `publicArticle` whitelist; list tidak memuat body,
  detail tetap memuat konten/sumber terbit tetapi tanpa reviewer/email/idempotency/
  jadwal internal. Penulis publik AXVARA juga dipakai SSR/JSON-LD. Admin list
  `?all=1` dan detail bersesi sah mempertahankan data editor dengan private/no-store.
- `db/orders-create` mengikat harga item quote, produk induk aktif, varian aktif,
  relasi product_id, mode/stok/minimum dalam operation_guards pada batch reservasi.
  Pembacaan harga awal hanya untuk pesan UX; error/race tidak melewati guard atomik.
  Gagal reservasi membaca ulang pemenang quote sebelum409, termasuk stok terakhir.
  `commerce.createChannelOrderAtomic` mengikat harga dari snapshot items per baris
  dengan produk/varian; `createPendingChannelOrder` juga memeriksa harga, parent
  aktif, relasi dan mode dalam guard atomik. TG/WA mempertahankan reuse order lama.
- `bounded-body` menghitung byte stream dan membatalkan pembacaan saat melebihi
  batas; Content-Length hanya petunjuk penolakan awal. `http-body` memberi400/413.
  JSON quote/order Market/Pedia32.000byte; login/lookup/kredensial/cancel/refill/
  subscriber8.000byte. Webhook KlikQRIS16.000, pembayaran/WR/SK32.000, TG/WA64.000,
  emailWR128.000byte mempertahankan raw text untuk signature. Supplier-sync2MiB
  untuk chunk katalog; MCP8MiB untuk media base64. RPC ID harus scalar/null.
- Wrapper middleware memasang header keamanan pada semua jalur return, termasuk
  rewrite Pedia dan penolakan CSRF; CSP maintenance yang lebih ketat dipertahankan.
  `unsafe-inline` Next masih residual hardening, bukan bukti XSS pada audit ini.
- Migrasi0080: security_auth_attempts(client_hash PK,window_id,attempts1..10) dan
  security_events(id,event,subject_hash,route,method,created_at), indeks window/time.
  `login-guard` memakai HMAC terpisah domain login:v1 atas IP kanonis dan satu
  UPSERT kondisional sebelum verifikasi. Maks10 gagal/in-flight per jendela tetap
  15menit lintas isolate; burst5/menit existing tetap. Produksi tanpa D1/error
  admission503, limit429+Retry-After. Sukses hanya DELETE hash+jendela sendiri;
  request jendela lama tidak menghapus counter jendela baru. GET challenge dan
  malformed tidak mereset, malformed tidak mencapai verifikasi mahal. Tidak ada
  lock akun global; NAT berbagi batas dan IP terdistribusi tetap residual.
  Challenge password-proof baru menyimpan admin_subject HMAC domain
  admin-challenge:v1, bukan email plaintext; JWT lama tetap diterima hanya sampai
  expiry5menit aslinya. Email salah menjalankan jalur verifikasi yang sama sebelum
  respons401, tanpa delay khusus yang membedakan akun.
- security-events menyimpan login gagal/sukses dan `admin_authorized` untuk mutasi
  serta baca sensitif setelah sesi sah, satu event/request. Route berupa label
  tetap tanpa ID/query; subjek sesi HMAC, tanpa IP/kontak/kredensial/body mentah.
  Polling/read admin biasa dikecualikan. Event berarti otorisasi lolos, bukan hasil
  mutasi. Kegagalan simpan fallback console tidak mengubah keputusan otorisasi.
  Login yang sudah dibatasi hanya console agar flood tidak menulis D1 tanpa batas.
- Cleanup hourly existing menambah maksimal200 counter login>24jam dan500 event
  keamanan>30hari; window aktif tetap. Total budget heavy cleanup8→10 statement.
  Tanpa env/cron/secret baru; penerimaan alert dan retensi console produksi belum
  diverifikasi. Tidak ada pembayaran/supplier nyata untuk pengujian.
- CI `security-dependencies.cjs` membaca audit runtime/full root+gateway tanpa
  mutasi lockfile, sebelum build/deploy. High/critical runtime atau error registry,
  JSON/schema/count tidak konsisten maupun exit tak dikenal menghentikan rilis.
  Regresi deterministik memakai mocked runner; audit registry nyata diverifikasi
  terpisah. Tiga high dev sebelumnya ditutup oleh Miniflare4 dan patch transitif;
  [bukti kompatibilitas](security/dependency-audit-2026-10-27.md) mencatat Pages
  tetap memakai adapter existing. Next15/Baileys/Node22 dipertahankan.

## Pembatas checkout durable — 27 Oktober 2026

✅ Implementasi terverifikasi; publikasi melalui CI. Migrasi0079 menambah
checkout_attempts(scope,subject_hash,window_id,orders_created), PK(scope,subject_hash),
dan checkout_claims(quote_id,claim_token,created_at_ms), PK(quote_id), beserta indeks
window_id/created_at_ms untuk cleanup bounded. Hash subjek memakai HMAC-SHA256
dengan ADMIN_JWT_SECRET existing; nilai kontak/IP mentah tidak ditulis ke tabel.
IPv6 dikanonisasi dan email di-trim/lowercase. Sentinel tanpa IP hanya diabaikan
di dev; produksi tetap memakai bucket bersama bila header tepercaya hilang.

POST /api/orders dan /api/pedia/orders menjalankan guard sesudah lookup order
existing dan validasi baca, sebelum reservasi/klaim order. Market memakai
quote.quote_id; Pedia memakai pedia:<jti>. Satu d1.batch mengklaim quote dengan
nonce request, menaikkan counter hanya untuk pemilik nonce dan memakai CHECK
operation_guards untuk rollback seluruh batch bila batas ip5/wa3/email3 per
jendela tetap15menit terlampaui. Retry paralel quote yang sama hanya menghitung
satu slot; reuse tidak terhalang kuota penuh. Counter tidak boleh mundur ke
jendela lama ketika request tertunda. Admission dan pembuatan order berada di
batch berbeda: kegagalan stok sesudah admission tetap menghabiskan satu slot;
retry memakai klaim yang sama. Unique quote_id order tetap penjaga satu order.

Batas terlampaui memberi429+Retry-After; error limiter yang belum dapat membuktikan
admission memberi503+Retry-After60, tanpa order/invoice/reservasi baru. Dev tanpa
D1 boleh bypass, produksi tanpa D1 ditolak. Tidak ada fail-open error D1.
Jalur !claimed Pedia juga membaca ulang pemenang quote agar race tetap200 reused.

runMaintenanceCleanup existing membersihkan maksimal200 klaim dan200 counter
berumur>24jam per housekeeping hourly; umur ini melebihi validitas quote maksimal
1jam. Budget heavy cleanup naik6→8 statement; throttle/cron existing tetap.
Verifikasi meliputi flood rotasi kontak, klaim baru paralel, retry quote paralel
Market/Pedia, write/missing-table failure, batas jendela dan cleanup bounded.
Batas per IP tidak membuktikan sumber serangan ataupun memblokir semua bot
multi-IP. Rincian bukti dan pembersihan produksi: [laporan insiden](../issue/checkout-abuse-2026-10-27.md).

## Konfigurator Pedia — 27 Oktober 2026

✅ Implementasi; publikasi melalui CI. [Kontrak UX](pedia/purchase-ux-2026-10-27.md)
menggantikan layout konfigurator20–22 Oktober. `components/pedia/NeedPicker.tsx`
menangani kebutuhan, ekspansi mobile dan posisi gulir pilihan. `PlatformPageClient`
menyimpan `Map<slug, PediaOrderDraft>` dalam ref; pergantian kebutuhan menyimpan
draf sebelum remount `OrderClient` dan memulihkan fokus tombol aktif. Tidak ada
localStorage/sessionStorage, mount paralel atau request harga untuk draf tersembunyi.
Draf memuat slug/targetKind/tierId/qty/target/checks/wa/email, bukan quote/agree/
attempted. Slug dan target kind harus cocok; validasi tier/batas tetap saat lanjut.

`ServicePicker` menampilkan filter dan sort sebelum baris, menambahkan pilihan di
luar filter ke atas tanpa memasukkannya ke hitungan hasil filter, serta menyembunyikan
filter redundan. `OrderClient` memakai grid≥1280px; satu ringkasan dalam DOM dengan
CTA desktop dan CTA mobile terpisah secara media query. ResizeObserver menonaktifkan
sticky rail jika tidak muat; fallback tanpa API tetap statis. Detail/terms terbuka,
instructions hanya tahapTarget, rendering copy tetap escaped/pre-line. Endpoint
prices/quote/orders, pembayaran, supplier, snapshot, cron, env dan schema tidak
berubah; preview embedded tetap tidak memanggil API harga/order.

Revisi 13 November 2026 (implementasi lokal; publikasi melalui CI): `NeedPicker`
mengelompokkan produk dengan `groupPediaMetrics` (dari `src/lib/pedia/display-name.ts`)
menjadi satu pill per `product.metric` berlabel `pediaMetricLabel`, bukan per produk.
`ServicePicker` menerima `products` opsional, meratakan tier dari semua produk bermetrik
sama (dengan `quantity_step` diwarisi produk pemilik) dan memakai `pediaVariantNames`
untuk label pendek; delapan baris awal, pilihan aktif selalu terlihat, tombol lipat
`aria-expanded`. `shortPediaName` hanya mengubah tampilan: nama sumber, slug, dan ID
order tetap. Nama lengkap asli tetap dirender `ServiceInfoCard`. Handoff lintas produk
memakai `onProductChange(slug, draft, selectedTierId)`: `ServicePicker` memanggil
`onSelect(tier.id, owner.slug)`, `OrderClient` meneruskan slug pemilik ke
`PlatformPageClient`, yang menyimpan draf sumber lalu draf tujuan hanya bila
`selectedTierId` memang milik produk tujuan. Kontrak katalog/prices/quote/orders,
pembayaran, supplier, snapshot, cron, env dan schema tidak berubah.

## GoPay pribadi dan callback bertanda tangan — 27 Oktober 2026

✅ Implementasi terverifikasi; receiver Pages dirilis melalui CI. Provider baru
dipilih kembali `gopay`, merchant **Axvara Digital/G564039370**, NMID
`ID1024342457479`, nomor082135277434. Sumber privat `.gopay-credentials`
(ignored/chmod600) berasal dari QR owner yang CRC/merchant/NMID-nya dibaca dan
dicocokkan dengan profil/sesi/outlet GoBiz. Pages mengubah tiga secret_text
existing `GOPAY_STATIC_QRIS`, `GOPAY_QRIS_ENABLED=true`,
`QRIS_ACTIVE_PROVIDER=gopay`; `GOPAY_POLLER_SECRET` dan semua secret KlikQRIS
tetap. Tidak memakai API/key/langganan AutoGoPay; docs-nya menjadi referensi pola.

`createActiveQrisInvoice` membaca provider ledger sebelum selector invoice baru,
sehingga retry setelah switch tetap pada rail tersimpan, termasuk GET-only untuk
initializing KlikQRIS. Pilihan GoPay eksplisit gagal tertutup bila konfigurasi
kurang. Create/reuse menolak perubahan requested_amount; allocator race membaca
pemenang sesuai provider, menyimpan merchant GoPay dari payload dan payment_account
GoPay Merchant. QR dihitung lokal, tanpa POST generate ke GoBiz. Maksimal satu
reissue setelah expiry invoice, selama order hidup; tidak memperpanjang deadline.
Reissue GoPay tidak membutuhkan konfigurasi DANA.

`POST /api/webhook/gopay` wajib dua header: `x-poller-secret` dan
`x-poller-signature`, HMAC-SHA256 hex lowercase atas byte UTF-8 body mentah dengan
secret existing yang sama. Diperiksa sebelum JSON/event ditulis. Payload baru
mempertahankan amount/order_code/event_id/payment.id dan menambah merchant_id,
currency=IDR, transaction_status=settlement|capture, paid_at ISO berzona.
Server memeriksa identitas dari qris_payload tersimpan, nominal persis, waktu
bayar ≥issued−60detik dan ≤deadline invoice/order, serta waktu masa depan maksimal
60detik. Order_code berbeda tidak fallback ke kandidat nominal lain. Event ID
tetap untuk retry; ACK hanya setelah paid/event/outbox atomik atau keputusan
manual unmatched tersimpan. Paid memakai waktu mutasi. Fulfillment memakai
schedulePaidFulfillment/waitUntil existing, materialisasi/bind supplier dahulu,
satu link per supplier/order; replay tidak menjadwalkan pembelian baru.

Poller `/Users/macbookair/axvara-gopay-poller` menambah durable-store,
poll-safety dan gobiz-transport. Gate per merchant15/30/60detik menurut invoice
terbaru <2/<5/≥5menit, minimum konfigurasi15detik dan jitter loop0–3detik. Wake
dibatasi gate dan timer digabung; idle60detik hanya membaca Pages, tanpa GoBiz.
Invoice/status/waktu/currency/merchant feed tak valid ditolak; beberapa mutasi
cocok tidak dipilih sembarang. `.session*.poll-state` chmod600/fsync+rename
menyimpan nextPollAt/backoff/streak/hold dan digest sesi; restart tidak mereset
batas. Sesi pengganti manual melepas hold, bukan restart biasa atau hapus state.
Koreksi29Oktober: di dalam gate merchant, SDK `refreshSession()` memeriksa expiry
sebelum GET feed; token valid di luar buffer tidak membuat request refresh.
SDK merchantid0.1.1 tetap melakukan satu refresh+retry401; tidak ada refresh
kedua manual sesudah kegagalan, backoff auth10menit, error biasa30detik→5menit. Refresh token mati,
persist gagal atau restriction403/423 menjeda akun sampai sesi diganti manual.
Token di-fsync sebelum callback SDK berhasil. Transport hanya GET feed ke
api.gojekapi.com dan POST token refresh ke api.gobiz.co.id, redirect manual;
tidak mengirim transfer/pembuatan QR upstream. Login OTP tetap manual, cooldown
request120detik dan challenge5menit; deviceId dipertahankan.

Urutan rollout wajib: backup dan rilis seluruh dist poller bertanda tangan di
VPS dahulu, ubah tiga secret Pages, lalu push main untuk receiver/Pages melalui
CI. Poller baru kompatibel receiver lama; receiver baru menolak poller tanpa
signature. Pertahankan dua file sesi, env dan state; jangan rollback poller lama
sesudah receiver baru. Snapshot source lengkap dapat diekstrak ke direktori
kosong dari `issue/patches/gopay-hardening-2026-10-27.patch`; folder poller bukan
repo Git. Rincian dan batas verifikasi: `issue/gopay-return-2026-10-27.md`.
Lanjutkan snapshot dengan `issue/patches/gopay-session-expiry-2026-10-29.patch`.
Rilis expiry29Oktober terpasang di VPS09:50UTC, 24 test poller lulus; refresh sesi
201 terverifikasi, tetapi belum ada invoice aktif untuk bukti pembayaran otomatis.
Detail insiden: `issue/gopay-session-expiry-2026-10-29.md`.

Referensi pola: https://autogopay.site/docs/webhook dan
https://autogopay.site/docs/gopay/qris-generate. Batas server di atas adalah
kebijakan AXVARA, bukan pengakuan batas resmi GoPay atau jaminan anti-suspend.

Proxy WR/SK — 26 Oktober 2026: dispatcher egress dipakai bersama dan ditutup
saat shutdown; URL proxy terkonfigurasi yang invalid menghentikan startup.
VPS tanpa URL proxy memakai IP tetapnya secara langsung. Diff removal WR/SK
dipotong terpisah maksimal 200 ID per request, hanya ACK sukses memajukan
snapshot; sisa ID dan payload induk berubah tetap pulih setelah restart.
Validasi body menghitung byte UTF-8, path SK menolak traversal. Rilis wajib
menyalin seluruh `dist/` (index/diff-sync/psmm/psmm-diff dan modul tambahan),
backup dahulu, pertahankan `.env`, snapshot dan direktori idempotensi durable.
Tes transport memakai MockAgent tanpa jaringan; tidak menambah retry pembelian.

Perbaikan VPS GoPay 25 Oktober: dedupe mutasi hanya setelah respons Pages
HTTP 2xx + JSON `ok:true` dengan status `paid|already_paid|duplicate|unmatched`.
HTTP 4xx/5xx, redirect, atau respons rusak tetap retry pada cadence existing dengan event ID
sama. `/tick` legacy menjadi alias wake berantrean (`status:true,queued:true,eta_ms`)
agar tidak menjalankan poll/refresh sesi paralel atau melewati jarak minimum.
Source `axvara-gopay-poller/src/pages-forward.ts`; rilis VPS terpasang
25 Oktober, 21.21 WIB. Deploy seluruh dist ke
`/opt/axvara/gopay/app/dist`, tanpa mengubah sesi/env atau membuat invoice baru.

## Dispatch KlikQRIS bertahan setelah request berakhir — 25 Oktober 2026

✅ Implementasi; publikasi CI. `payments/paid-fulfillment.ts` mengambil request
context sebelum memulai task, lalu mendaftarkan promise yang sama melalui
`ctx.waitUntil`; dev/test tanpa context menunggu task tersebut. Transisi paid
atomik tetap mendahului penjadwalan. Callback/status/cron dapat merespons tanpa
menahan jaringan supplier dan notifikasi; replay paid tidak menjadwalkan ulang.
Cron existing tetap memulihkan outbox/link yang belum selesai.

Market mematerialisasi `fulfillment_items`, membuat/mengikat link WR/SK sebelum
memulai fulfillment umum. Pembelian dan fulfillment berjalan sebagai task yang
hasilnya ditangani; `processWrPendingOrders`/`processSkPendingOrders` menerima
filter internal `orderCode` + batas1–4 (default4), jalur immediate memakai order
saat ini dan limit1 per supplier agar tidak menguras antrean lain atau melampaui
jendela background. Cron tetap default4/budget existing. Tidak ada scheduler,
flag/env, migrasi, perubahan nominal atau reset kunci idempotensi baru.

Recovery ambigu SK mencatat `ambiguous_lookup_http_<status>` atau
`ambiguous_lookup_unavailable` pada link tanpa mengubah status/request_sent_at/
ref_id. Hasil404 bukan izin POST ulang. Kasus25Oktober: POST proxy terputus sebelum
forward; owner mengizinkan pemulihan, GET TRX_NOT_FOUND + riwayat/mutasi tanpa debit
diverifikasi, satu pembelian dengan ref_id semula diselesaikan webhook dan email.
Detail bukti/ruang lingkup: `issue/sk-vps-reliability-2026-10-25.md`.


Kontrak transport: HTTP5xx generik mempertahankan fence ambiguitas. Classifier
SK tidak lagi menganggap semua503 penolakan pra-charge; hanya kode eksplisit
PRODUCT_TEMPORARILY_UNAVAILABLE. `createOrder`/`createSkTransaction` menolak
receipt tanpa ID atau ref_id SK yang berbeda sebagai NetworkError. Proxy
unreadable2xx write memakai502 + marker `wr_proxy_unreadable_response: network_error`
atau SK setara; kata network menjaga Pages lama selama rollout. Error bisnis
terkonfirmasi tetap mengikuti penanganan saldo/stok existing.

## Aktivasi manual pemilihan WR/SK — 25 Oktober 2026

✅ Implementasi; publikasi CI. Statistik `supplier-pairs.ts` membaca `products.is_active`
per sisi dalam SELECT agregat existing. Prioritas sebelum stok/modal/preferensi:
OFF/OFF→NULL, WR OFF→SK, SK OFF→WR. OFF tidak pernah diaktifkan oleh selector.
`PUT /api/products/[id]` setelah perubahan aktivasi/varian/harga-stok dan DELETE
arsip D1 menjalankan `decideDirtyWinners` terbatas pada product ID terkait
(maks10pasangan); kegagalan hanya menunda rekalkulasi karena simpan sudah durable.
Daftar admin dimuat ulang oleh hook existing; cache publik Market30detik tetap.

Migrasi0078 + schema menambahkan trigger `pair_dirty_product_active_update` hanya
pada perubahan `is_active`, mengganti token versi dan `pending=1` secara atomik.
Migrasi juga mengantrekan ulang seluruh keputusan lama; cron lite cleanup existing
menguras maks10/tick, sweep hourly tetap cadangan. Ack tidak menghapus token;
CAS pembaruan pemenang/ack tetap menolak hasil basi. Tidak menambah cron/env,
menulis stok, mengubah flag supplier atau snapshot/pengiriman order lama.

## Siaran admin dan event anggota — 24 Oktober 2026

✅ Admin menambah lazy component `BroadcastManager` pada `?section=broadcasts` dan
menu Konten. API private no-store `/api/admin/broadcasts` wajib requireAdmin untuk
GET/POST save/archive/review/send/cancel. Migrasi0077 dan schema menambah pustaka,
campaign/snapshot dan recipient delivery, dispatch lock/pacing, unsubscribe token
newsletter serta opt-out Telegram. Worker bounded bergabung cron lite promo existing;
welcome memakai outbox/notify_b existing. Tidak menambah env, cron, DM WA atau resource.
Kontrak rinci di §16.13 dan `issue/broadcasts-welcome-2026-10-24.md`.

## Notifikasi penjualan dan pengaturan grup — 24 Oktober 2026

✅ Diimplementasikan; publikasi CI. Kontrak kanonis terbaru ada di §16.12 dan
`issue/whatsapp-sales-notifications-2026-10-24.md`. `gateway/` kini source gateway
kanonis dalam repo AXVARA; folder saudara lama hanya arsip session lokal. Pengiriman
grup baru default mati sampai owner pairing nomor pilihan admin (awal6283181632507)
dan aktivasi admin. Nomor dapat diganti lewat panel tanpa edit kode/env.
Catatan DM/rollout gateway lama di bawah adalah histori, bukan instruksi membuka
DM atau bukti koneksi nomor baru. Verifikasi buyer normal tetap kontak/capability;
akses admin baru memvalidasi sesi admin pada server.

## Kontrak banner carousel — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. `GET /api/banners?active=1` hanya memberi
banner aktif beserta settings publik, no-store agar konfigurasi/order baru terlihat
pada kunjungan berikutnya. Semua variasi query lain wajib admin; active=0 tidak lagi
membuka draf. Satu fetch ditunda sesudah render beranda, tanpa polling server baru.
`PUT /api/banners/settings` authenticated menyimpan satu JSON tervalidasi pada key
store_settings.banner_carousel, default1500ms/6000ms/autoplaytrue/max_show_per_session1.
Tanpa migrasi/env/dependensi baru. Kolom delay/max/urutan lama dipertahankan; input
legacy tervalidasi namun diabaikan pada tulis isi, bukan otoritas konfigurasi.

`POST /api/banners/reorder` authenticated menerima {ids,expected_ids}: permutasi penuh
unik maksimal1000ID. Invalid400; snapshot basi409. Guard snapshot urutan sebagai
statement pertama D1batch, staging posisi negatif unik, normalisasi0..N−1 dan hapus
guard atomik; error membatalkan semuanya. Create/delete ikut guard/batch yang sama,
create append, edit mempertahankan posisi. Retri internal maksimal5 untuk konflik
snapshot penulis konten; drag basi tidak diputar ulang. Dev memory meniru commit
sinkron dan pemeriksaan snapshot; produksi tanpa D1 gagal. Index unik0064 tetap.

Revisi responsif11November2026 (lokal; deployment belum diverifikasi): kartu448px
dibatasi min(92dvh,100% area tersedia), dengan padding safe-area atas/bawah.
Grid minmax(0,1fr)/auto memisahkan media+caption dari footer checkbox/CTA yang tidak
ikut scroll. Grid slide memberi gambar sisa tinggi; object-contain mempertahankan
rasio asli tanpa crop/distorsi, dengan ruang putih samping bila perlu (menggantikan
aturan selalu full-width/h-auto24Oktober). Caption maksimal30dvh overflow-y-auto,
tabIndex0 dan fokus terlihat untuk scroll keyboard; footer tidak menutupi konten.
Counter tepat di bawah gambar, panah di atas gambar dengan batas awal/akhir,
caption rata tengah tanpa separator, checkbox sebelum CTA biru full-width atau
tombol tutup Saya Paham bila CTA kosong. Tidak mengubah API/storage/timing carousel.
Judul mengikuti tinggi teks alami; deskripsi memiliki margin atas8px tanpa slot kosong.

Popup memakai key sessionStorage.axvara-banner-carousel-shows dan key hide per-ID
existing24jam. Batas sesi lama per-banner dipensiunkan. Satu pembukaan per mount/
kunjungan SPA, tidak memunculkan modal berikutnya sesudah tutup. Kontak/transaksi
lain tidak berubah. Autoplay satu timer terlihat; pause fokus/hover/manual/hidden,
reduced-motion manual; preload/decode hanya gambar tetangga berikut. Navigasi menunggu
decode gambar tujuan sebelum commit; versi permintaan menolak hasil lama. Node DOM
slide lama tetap dipertahankan sebagai lapisan dekoratif aria-hidden/noninteraktif,
bukan salinan gambar baru. Slide tujuan tetap transparan sampai elemen gambar aktual
selesai load; CTA/hide ditahan selama tahap ini. Baru kemudian dissolve420ms berjalan,
blur2px dan geseran12px. Tinggi stage berubah ke tinggi alami slide baru secara halus;
setelah selesai, lapisan/timer/tinggi eksplisit dibersihkan. Input cepat digabung ke
tujuan terbaru setelah transisi berjalan selesai. Tutup/hide/pindah route/unmount
membatalkan permintaan tertunda; decode gagal tetap memakai fallback gambar existing.
Browser tanpa decode memakai preload biasa. Revisi owner: tombol
putar/jeda dihapus; setelah fokus/interaksi manual putaran tidak dilanjutkan otomatis
atau melalui UI, sampai popup ditutup. Konfigurasi autoplay admin tetap. Hook useModalA11y
menjaga Escape/trap/restore. Pointer horizontal45px dan dominan terhadap vertikal,
touch-action:pan-y; CTA tidak menjadi pegangan geser. Admin memakai dnd-kit existing,
rollback/resync jika reorder gagal dan mengabaikan respons load lama.


## Integritas audit dan Pedia tanpa wallet — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. [Kontrak Pedia terkini](pedia/manual-resolution-2026-10-24.md)
menggantikan ketentuan kredit/deposit/refund otomatis pada bagian historis §16.10.
Migrasi 0075 menambah `pedia_followups` (unik order, terminal+queue atomik, catatan
admin/aktor/waktu, klaim notifikasi) dan `order_contact_attempts` (order+hash client,
jendela 15 menit, 20 kegagalan). Tabel kredit/ledger lama dipertahankan sebagai
arsip beku. Quote berkredit baru ditolak; retry terpersisten mempertahankan payable.
GET status Pedia memerlukan `x-order-contact` dan private/no-store. Client menyimpan
kontak tab 24 jam; riwayat lookup tujuh hari. Endpoint kredit lama POST 410.

Telegram menambah guard pending chat sebagai anggota pertama batch commerce;
loser menerima kode order pemenang tanpa invoice/job/kompensasi kedua. Predikat
pending reusable mengecualikan deadline lewat. Klaim update non-UNIQUE error
menghasilkan 503 sebelum routing. /batal membersihkan conversational state saja.

GET /api/orders/[code] mendelegasikan kontrak kanonis /api/orders?code= agar flags,
deadline dan progres unit sama. Lookup membawa unique_units_progress ke panel;
polling lima detik, visibility pause, single-flight/generation dan Retry-After.
Verifikasi kredensial WA penuh sama dengan lookup/cancel; capability tetap sah.
Dependensi memakai patch kompatibel Next15.5.28/sharp0.35.5, Vitest4.1.12/Vite8.3.5,
serta override transitif terarah (lihat package.json/lock), tanpa migrasi Tailwind
atau adapter mayor. PostCSS aman juga terwakili pada lockfile, bukan hanya dedupe disk.



Admin memuat section/editor berat saat dibuka dengan fallback Suspense; Ringkasan
serta Pesanan tetap tersedia pada bundle awal. Build lokal menunjukkan First Load JS
/admin turun dari420kB menjadi145kB (route258kB→31,8kB); ini ukuran
build, bukan pengukuran latensi/biaya produksi. Filter/paginasi OrdersManager dan
rekonsiliasi mengabaikan respons generasi lama. Facet global memakai cache privat
terenkripsi 60 detik (otorisasi selalu diperiksa), metrik daftar tetap mengikuti
filter. Tanggal UTC memakai batas mentah setengah terbuka yang menerima format
ISO/SQLite. PDP/cart memakai stok efektif unique dan memperbarui metadata saat
repeat-add. Issue quote membawa variant_id/min_qty; perubahan harga serta baris
ringkasan memakai identitas produk+varian. Pemulihan minimum direct-buy mengganti
qty URL lalu meminta quote baru, tanpa membuat order atau invoice.

## Pembelian beberapa kredensial unik — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Web dan Telegram mendukung total
maksimal sepuluh unit stok unik per pesanan, termasuk beberapa varian,
mengikuti stok efektif dan minimum pembelian. Pembeli tetap melihat satu
baris produk ×jumlah, satu order dan satu invoice. Reservasi seluruh unit
mengikuti urutan stok admin dalam batch atomik; kekurangan satu unit
membatalkan seluruh batch sebelum invoice. Retry checkout memakai order lama.

Setiap akun memiliki item pengiriman, ikatan inventory, snapshot terenkripsi,
lease dan retry sendiri. Unit yang sudah terkirim tidak dikirim ulang; unit
yang gagal mempertahankan inventory yang sama. Pembatalan/expiry pending
melepaskan seluruh reservasi dan mengembalikan qty stok sekali. Akun diberi
nomor, tombol salin per akun, progres “2 dari 3 akun siap”, dan panduan identik
cukup sekali di panel. Pengiriman web memakai email per unit agar kegagalan
satu email tidak mengulang unit lain; tanda terima menampilkan baris belanja
aslinya. Pesanan lama mempertahankan interpretasi sebelumnya. Alur WA existing
masih satu unit dan kill-switch DM tidak diubah. [Kontrak unit](UNIQUE-UNITS.md).

## Workers Paid: pembayaran dan pengiriman cepat — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Webhook tetap jalur utama untuk
konfirmasi pembayaran dan pengiriman seketika. Cron existing berjalan setiap
menit untuk cadangan KlikQRIS tanpa halaman pembeli terbuka, expiry,
fulfillment, WR/SK, Pedia dan notifikasi. Pemeriksaan KlikQRIS hanya GET invoice
pending yang masih berlaku, maksimal empat per tick, berbagi klaim atomik
dengan polling halaman; gagal konfirmasi tetap pending. Batas bayar 15 menit,
penanganan late payment manual dan larangan pembelian ulang ambigu tetap.

Pedia memeriksa supplier setiap menit selama 15 menit pertama, lalu dua menit
hingga umur satu jam dan lima menit sesudahnya; kegagalan status diberi jeda
lima menit. Status halaman terlihat diperbarui lima detik saat menunggu bayar,
sepuluh detik ketika diproses, dan segera setelah tab kembali terlihat.
Terminal/needs_check berhenti polling. Katalog tetap mengikuti diff VPS dan
sweep hourly; cleanup/publikasi artikel tetap lima menitan. Ini target latensi
pemicu, bukan janji waktu selesai supplier atau email.

Monitor membaca paket dan periode tagihan aktual: Paid memakai jatah D1
bulanan, Free memakai batas harian. Rincian biaya, batas kerja dan rollback:
[operasional Paid](PAID-OPERATIONS.md).


## Penyederhanaan pilihan layanan Pedia — 22 Oktober 2026

✅ Implementasi; publikasi melalui CI. Koreksi owner22 Oktober: judul “Apa yang ingin ditingkatkan?” kembali ke ukuran24px/bold semula tanpa garis cyan. Yang diperkecil adalah pill kebutuhan Followers/Likes/dll: tinggi32px, teks12px, ikon13px dan padding12px; permukaan gradasi halus dengan highlight inset, pilihan aktif cyan/violet dan glow tipis. Gulir horizontal serta fokus keyboard tetap, scrollbar visual disembunyikan. Label tombol jumlah memakai `k` kecil untuk ribuan (`1k`, `2k`, `2.5k`); angka di bawah 1.000 tetap utuh, nilai input/perhitungan serta teks batas dan harga memakai angka aslinya. Pengantar panjang jumlah dihapus; batas tampil sesuai min/max layanan terpilih (“Layanan terpilih menerima 100–50.000 per pesanan.”), termasuk kelipatan bila perlu; sebelum memilih layanan ada petunjuk singkat tanpa angka asumsi. “Pilih layanan · harga untuk …” berada di kiri dan filter ringkas di kanan saat muat, bertumpuk pada mobile. Kategori **Semua/Global/Indonesia/Refill** memakai satu state eksklusif: tepat satu pill aktif, klik pill aktif mempertahankannya; Refill berarti semua wilayah dengan refill>0. Pemilihan kategori tidak mengganti layanan atau jumlah. Hitungan hasil, Reset filter dan pengaturan jenis akun/urutan berada sesudah daftar. Beranda, data katalog, validasi batas, quote/consent/retry dan pembayaran tetap.

Tipografi harga 22 Oktober mengikuti AXVARA pusat: harga kartu/daftar layanan Inter bold 700, 14px mobile/17px mulai sm, tracking −0.02em dan line-height 1 tanpa tabular-nums; total ringkasan Space Grotesk bold 700/18px, total ringkas mobile 14px; nominal QRIS/pembayaran diterima Space Grotesk bold 700/24px dengan kelas `leading-8`; line-height aktual mengikuti `.font-display` global seperti pusat. Acuan aktual: ProductCard storefront, total checkout pusat dan nominal QRIS pusat. Ini menggantikan ukuran harga pada redesain 20 Oktober; susunan beranda/checkout, nominal dan format jumlah tetap.


## Redesain alur pembelian Pedia — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. Keputusan owner: **beranda tetap seperti sebelumnya, tanpa jalan pintas**. Sesudah klik layanan/platform, konfigurator mengikuti referensi “Redesign SMM Panel Purchase Flow”: **Layanan → Target → Kontak → Bayar**. Kebutuhan pertama langsung terbuka (deep link mengikuti slug); jumlah/layanan tetap dipilih eksplisit. Tab kebutuhan berikon, perbandingan layanan tetap terbuka, validasi per tahap, ringkasan desktop340px, CTA di dasar panel desktop/fixed mobile dengan safe-area. Link dan checklist produk berada di tahap Target; WA/email, kredit dan consent di tahap Kontak. Kembali mempertahankan isian produk yang sama, tanpa melewati tahap mendatang; setelah POST ambigu semua navigasi langkah terkunci. Preview admin embedded tetap tanpa request harga/order atau kontak.

Halaman pesanan memakai timeline vertikal + progres server dan panel QRIS di kanan desktop/atas mobile (container1000px, rail380px, QR240px), countdown deadline, Simpan QRIS/Cek pembayaran, serta Pesan lagi pada status terminal. Partial/kredit/refill/needs_check dan snapshot lama tetap dilayani. QR/nominal/status berasal dari server, tanpa simulasi atau reset expiry. Kontrak API, quote/consent/retry, supplier IndoSMM untuk order baru, env/cron/ledger tidak berubah. Spesifikasi [redesain pembelian](pedia/purchase-flow-redesign-2026-10-20.md) menggantikan bagian UI checkout/status versi15–19 Oktober di bawah; desain beranda existing dipertahankan.


## Pedia IndoSMM untuk penjualan baru — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. IndoSMM menjadi supplier tunggal untuk katalog/harga/quote/order baru dan kurasi admin. ProviderSMM dipertahankan untuk retry checkout tersimpan, dispatch/status/refill/recovery historis; quote lama tanpa order perlu memilih ulang sebelum debit/reservasi/invoice. Migrasi 0073 menonaktifkan penjualan ProviderSMM, menambah 53 kebutuhan/61 mapping IndoSMM (termasuk tujuh pengganti) dan 18 platform; owner drafts serta snapshot order lama dipertahankan. Produk premium supplier Canva/Gemini/CapCut dikecualikan. API/description review belum membuktikan kualitas; tanpa order berbayar. Spesifikasi terkini: [IndoSMM 20 Oktober](pedia/indosmm-only-2026-10-20.md).


## Pedia dan loading — 19 Oktober 2026

✅ Implementasi; publikasi melalui CI. `BrandLoader` dan CSS ring/pulse dipakai pada loading bersama dengan logo AXVARA; reduced motion, navigasi cepat dan pemulihan navigasi dipertahankan. Konfigurator memakai jumlah sebelum tier, total jumlah sama, ikon semantik dan filter ringkas; kontrak quote/payment/dispatch tidak berubah. Parser menambah target `short` YouTube serta `artist`/`playlist` Spotify. Short mempertahankan URL `/shorts/`, video legacy tetap menerima Shorts.

Migrasi data **0070_pedia_catalog_breadth.sql** menambah 17 produk kebutuhan/23 mapping dari manifest server-only `curation-20261019.json` (kapasitas gabungan 55/154). Generator terpisah tidak menulis ulang migrasi 0066. Mirror current/present/Default/rate/batas/paket/refill API menjadi gate aktivasi. Konflik slug owner dilewati; ID/mapping/snapshot order lama tidak diubah. Schema tabel, env, cron, proxy dan supplier tetap.

Tab admin Kurasi: GET existing `/api/admin/pedia/services?view=shortlist&product_id=&quantity=` setelah auth membaca maksimal 200 kandidat awal (+1 penanda limit), menghasilkan maksimal 20 kandidat beragam wilayah/API refill dengan estimasi modal jumlah sama; tanpa jaringan supplier atau write. `curation-shortlist.ts` menyaring ketidakcocokan jelas dan memberi peringatan; bukan bukti kualitas atau pengganti review deskripsi. `PediaCurationPanel` menyiapkan copy editable, simpan melalui POST tier existing sebagai nonaktif/refill0/recommended0, lalu editor existing. POST tier kini menyimpan field copy dan batas yang tervalidasi, bukan mengabaikannya. Preview tetap tanpa API; dispatch/payment tetap asal.

Rincian, bukti kurasi dan budget sampling: [spesifikasi 19 Oktober](pedia/catalog-ux-2026-10-19.md). Konfigurator 16 Oktober di bawah adalah riwayat. Tidak ada migrasi SMM Sekalipay, env produksi atau kontrak lintas-repo baru.

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator Pedia 2026-10-16 ✅ implementasi, publikasi melalui CI: `PlatformPageClient` memakai `pediaPlatform` untuk header/kartu kebutuhan tanpa pilihan otomatis; route platform dan deep link order tetap berbagi `OrderClient`. `ServicePicker` menampilkan tiga layanan awal, filter terlipat, perbandingan penuh, serta pilihan aktif ringkas pada semua viewport. `OrderClient` mendekatkan jumlah/target/checklist dalam satu panel, menaruh copy literal escaped di disclosure setelah input, dan menyediakan ringkasan brand dengan rail desktop sticky. `usePediaPrices` existing memasok total jumlah yang sama; harga paket tersimpan hanya fallback untuk jumlah persis yang valid, min/max/step tidak cocok diberi status, harga lain menunggu respons. State quote/consent/lock/retry dan preview embedded tanpa API tetap dipertahankan; tanpa route, schema, env produksi, atau kontrak antar-repo baru.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Revisi halaman bantuan Pedia 2026-11-01 (implementasi; publikasi melalui CI): `/pedia/bantuan` dan `/pedia/ketentuan` mengikuti pola Market `/cara-order` dan `/garansi-replace` (label kecil, judul, pengantar, kartu glass `max-w-[920px]`, deret tombol). Bantuan memuat bagian `#cara-order` empat langkah Pedia (Layanan → Target → Kontak → Bayar) dan FAQ accordion gaya Lacak; isinya di `src/lib/pedia/help-content.ts`. Ketentuan mempertahankan ketujuh poin lama yang dikelompokkan per topik. FAQ Lacak tidak lagi menyebut PIN (Pedia tanpa PIN) dan menambah cara membatalkan pesanan. Footer di layout Pedia mengarahkan "Cara order" ke `/bantuan#cara-order`; tautan Pedia di footer/`AXVARA_SERVICES` memakai URL kanonis subdomain (`pedia.axvara.tech/lacak`, bukan `/pedia/lacak`). Halaman bantuan, ketentuan, katalog (kini `h1`) dan lacak (lewat `lacak/layout.tsx`) punya title dan canonical sendiri. Tidak ada perubahan API/order/pembayaran.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

**Stack:** Next.js 15 (App Router) + Cloudflare Pages + D1 + R2
**Tanggal:** 5 September 2026
**Status:** Implemented — Pages + D1 + R2 + Remote MCP + custom domain dan DNSSEC aktif

---

## 1. Ringkasan Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Edge (CDN)                  │
│ axvara.tech → Cloudflare DNS/SSL → Pages → Edge CDN    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Cloudflare Pages — Next.js (SSG + Functions)          │
│  • Storefront (SSG + ISR)                               │
│  • /api/* via Pages Functions (Workers)                 │
│  • Admin UI (client) + API routes                       │
└──────┬──────────────────────┬───────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐       ┌──────────────┐
│ Cloudflare D1│       │ Cloudflare R2│
│ (SQLite)     │       │ (S3-comp)    │
│ • products   │       │ • produk/*   │
│ • categories │       │ • bukti/*    │
│ • orders     │       │ • qris/*     │
│ • articles   │       │ • articles/* │
│ • banners    │       │ • banners/*  │
│ • subscribers│       │              │
│ • agent auth │       │              │
│ • users/admin│       │              │
└──────────────┘       └──────────────┘
       │
       ▼
┌──────────────────┐
│ Baileys Gateway  │
│ Heroku           │
│ quoted reply +   │
│ media sementara  │
└──────────────────┘
```

**Kenapa ini, bukan VPS?**
- Daftar tanpa kartu kredit, tidak ditolak seperti Oracle
- Bandwidth unlimited, CDN otomatis di Indonesia (Pages)
- Tidak perlu ngurus Linux, Nginx, SSL, security patch
- Gratis selamanya untuk skala MVP–menengah (lihat VPS-RESEARCH.md)

---

## 2. Tech Stack Detail

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| Framework | Next.js 15 App Router | Edge routes untuk katalog dan checkout di Cloudflare Pages |
| Bahasa | TypeScript | Type-safe, DX |
| Styling | Tailwind CSS + CSS Modules | Utility + glassmorphism custom |
| Animasi | CSS + imperative `requestAnimationFrame` + IntersectionObserver | Motion Apple-style tanpa render React per frame; pause saat offscreen |
| State | Zustand (keranjang/pencarian) + Fetch API | Ringan, tanpa Redux |
| Database | Cloudflare D1 (SQLite) | Gratis 5GB, 5M reads/hari, serverless |
| Storage | Cloudflare R2 | Gratis 10GB, S3-compatible, untuk foto & bukti |
| Auth Admin | JWT httpOnly + idle JWT terikat sesi + PBKDF2/SHA-256 Edge-safe | Cookie-only, idle 2h server-enforced, rotasi password mencabut sesi |
| Deploy | Cloudflare Pages (via Git) | Auto deploy, preview URL |
| Domain | .TECH Domains registrar + Cloudflare DNS | Nameserver Cloudflare, auto SSL, integrasi Pages |
| Ikon | Aset SVG/PNG lokal + Lucide React | Menghindari request ikon pihak ketiga saat runtime |
| Font | Apple SF Pro system stack | Konsisten dengan desain storefront |
| Validasi | Zod | Schema checkout & produk |
| Gateway WhatsApp | Baileys di Heroku | Webhook grup, quoted reply, media bukti sementara, dan pesan fulfillment |

Logo Pedia (2 November 2026, glyph dipublikasi CI commit `7774b0c`): `PlatformIcon` tetap memakai SVG lokal. Coub/Lazada/Rutube/SnackVideo memakai glyph logo asli satu warna sesuai registri, tanpa background aplikasi/gradasi atau perubahan route/API/order. Pemetaan 34 platform, sumber resmi/mirror dan ketentuan aset di `docs/PEDIA-DESIGN.md` bagian Ikon platform; tidak ada fetch logo pihak ketiga saat runtime.

Koreksi cache 2 November: glyph commit `7774b0c` sudah dipublikasi CI, tetapi `/icons/*` memakai cache browser/CDN satu hari + SWR tujuh hari (`public/_headers`). `PlatformIcon` menambah `?v=20261102` hanya pada empat SVG pengganti; versi wajib dinaikkan bila artwork tersebut diubah. URL 30 platform lain dan header global tetap. Pemeriksaan produksi membuktikan URL Lazada lama berisi LA (`HIT`) dan query baru berisi glyph terbaru; perbaikan URL disiapkan untuk publikasi CI.

---

## 3. Struktur Folder

```
axvara/
├── docs/
│   ├── PRD.md
│   ├── DESIGN.md
│   ├── ARCHITECTURE.md
│   └── VPS-RESEARCH.md
├── public/
│   ├── fonts/                   # Variable fonts self-hosted (2026-10-12): inter/space-grotesk/jetbrains-mono latin .woff2 via next/font/local — tanpa fetch Google saat build
│   ├── qris/README.md           # tidak ada QRIS statis publik
│   └── logo/
│       └── axvara-wordmark.svg
├── src/app/                     # Next.js App Router
│   ├── layout.tsx               # ROOT MINIMAL (2026-10-08, PEDIA §9.2): font + metadata global SAJA. TANPA chrome toko/Pedia — keduanya di layout masing-masing di bawah agar tidak saling mewarisi.
│   ├── (shop)/                  # Toko pusat axvara.tech (route group — URL tidak berubah)
│   │   ├── layout.tsx           # Chrome toko (Navbar/Footer/CartDrawer/MobileBottomNav/dll) + metadata OG toko
│   │   ├── page.tsx             # Homepage (server, edge): muat katalog D1 via handler GET /api/products → HomeClient + JSON-LD Organization/WebSite/ItemList (2026-09-24)
│   │   ├── home-client.tsx      # Homepage interaktif (kategori, cari, load more); `initialProducts` dari server, fallback fetch
│   │   ├── artikel/[slug]/      # Artikel publik Markdown/legacy JSON
│   │   ├── cara-order/          # Panduan order
│   │   ├── garansi-replace/     # Ketentuan layanan & garansi third-party (acuan klaim, garansi ikut deskripsi produk)
│   │   ├── produk/[slug]/       # PDP: server component SEO (metadata/JSON-LD/h1 D1) + client interaktif
│   │   │   ├── checkout/        # Checkout revamp ala Sekalipay 2026-09-23 — ① Metode (QRIS auto-select) → ② Data minimal WA+Email wajib tanpa Nama (fallback prefix email) → S&K → 1 CTA; rail kanan DESKTOP ONLY (hidden lg:block, ringkasan+S&K+CTA), mobile accordion ringkasan + S&K kiri + sticky CTA; 1 handler submit
│   │   ├── pesanan/[code]/      # Status + QRIS dinamis + polling lunas (dari checkout); pesanan/layout.tsx = noindex
│   │   ├── lacak-pesanan/       # Lacak mandiri kode + No. WA/email via POST /api/orders/lookup + timeline + auto-refresh
│   │   ├── link/                # Link-in-bio pengganti Linktree (bio IG): 6 tombol + share, tanpa chrome global
│   │   ├── admin/
│   │   │   └── page.tsx         # Shell + modul admin berbasis query section
│   │   ├── mcp/route.ts         # MCP HTTP katalog toko
│   │   └── r2/[...key]/route.ts # R2 publik catch-all
│   ├── pedia/                   # Axvara Pedia pedia.axvara.tech (2026-10-08, PEDIA-PRD; spesifikasi: docs/PEDIA-PRD.md, docs/PEDIA-DESIGN.md)
│   │   ├── layout.tsx           # .pedia-root + Spotlight bersama + PediaNavbar + PediaBottomNav + Footer bersama; bukan Navbar/keranjang Market; <main> polos 1:1 Market (2026-10-12, tanpa max-width/padding — tiap halaman mengatur container sendiri: katalog 1280px, lacak 720px)
│   │   ├── page.tsx + home-client.tsx  # Beranda existing tetap: hero/Typewriter/orbit/tali + promo Market/Telegram + katalog platform; tanpa jalan pintas redesain
│   │   ├── p/[platform]/        # Header platform + OrderClient bersama; tab kebutuhan langsung dalam tahap Layanan
│   │   ├── o/[slug]/            # Deep link konfigurator bersama platform; layanan/qty null, Layanan → Target → Kontak → Bayar, quote+consent/retry sama
│   │   ├── pesanan/[code]/      # Status: panel QRIS/countdown + timeline vertikal/progres server/refill/kredit/needs_check; auto-refresh existing
│   │   ├── lacak/               # Form glass kode AXP + kontak (lookupPediaOrder) → status; axp-track-recent (5), axp-orders (20) terlipat, FAQ
│   │   └── bantuan/ + ketentuan/ + layanan/  # Bantuan (3 grup), S&K 7 poin, semua layanan
│   ├── llms.txt/route.ts        # GEO: profil toko + produk yang bisa dibeli (markdown, cache 10 mnt)
│   ├── robots.ts / sitemap.ts   # robots: tutup /admin, /api/ (kecuali 3 endpoint baca publik), /checkout, /pesanan/; crawler AI eksplisit
│   ├── api/
│   │   ├── products/
│   │   ├── categories/
│   │   ├── orders/              # POST create, GET list, PATCH confirm
│   │   ├── checkout/quote/       # Quote harga/stok/payment bertanda tangan
│   │   ├── display-prices/       # Konversi tampilan server private/no-store (bukan quote)
│   │   ├── payment-methods/      # GET publik + PUT admin
│   │   ├── store-settings/       # GET publik + PUT admin
│   │   ├── subscribers/          # POST publik + GET admin
│   │   ├── articles/            # CRUD editorial admin/public
│   │   ├── banners/             # CRUD carousel + settings/reorder admin
│   │   ├── upload/              # Media admin ke R2
│   │   ├── agent/               # Content API scoped Bearer token
│   │   ├── cron/                # Publish artikel + expire order terjadwal
│   │   │   └── auth/
│   │   ├── pedia/               # API Pedia (docs/PEDIA-PRD.md §9.7): catalog/ticker/quote/orders/[code]+refill/credits/check, lookup di orders/lookup, admin pedia/*
│   └── globals.css
├── src/components/
│   ├── ui/                      # Button, Input, Badge, Modal, Drawer, Toast,
│   │                            # NavigationProgress (bar + skeleton rute + pil koneksi lambat)
│   ├── storefront/              # Navbar, Hero, ProductCard, CartDrawer, CheckoutForm, QrisDisplay,
│   │                            # MobileBottomNav (Beranda · Kategori · Pesanan · Bantuan) + HelpSheet + CategorySheet,
│   │                            # DeviceOrders ("Pesanan di perangkat ini" di /lacak-pesanan),
│   │                            # QuickVariantModal (beli cepat + mode select untuk PDP mobile),
│   │                            # ProductCopy (deskripsi + S&K + cara aktivasi PDP, panel lipat mobile),
│   │                            # Skeletons (satu bentuk skeleton per halaman: overlay navigasi + loading halaman)
│   └── admin/                   # Shell, login gate, hooks (useAdminAuth/useProductManager),
│       └── sections/            # satu komponen per section admin (page.tsx tinggal shell + routing)
│       ├── PediaManager.tsx     # shell admin Pedia: status strip + 4 tab (Pesanan · Produk · Layanan IndoSMM · Pengaturan); ?tab= lama dipetakan
│       ├── pedia/               # OrdersPanel/ProductsPanel/ProductEditor/ServicesPanel/SettingsPanel/shared: per-tab loading, payload mutasi tetap
│   ├── shared/                  # ServicesMenu + CrossServicePromo (Market/Pedia; URL src/lib/site.ts)
│   ├── pedia/                   # PediaNavbar (client + field cari pill ala Market via usePediaSearch), PediaBottomNav, Typewriter, LinkPasteHero (komponen hidup, tak dipakai beranda sejak 2026-10-12), PlatformGrid, PediaOrbit (kembar OrbitHero: 8 sosmed + inti mark Pedia), PediaServiceCards (Market + Bot Telegram), PediaWhatsAppLink (CTA Hubungi Admin → hub /wa), OrderTicker (tidak dirender), StatusWidgets
├── src/hooks/
│   ├── useDesktopMotion.ts      # Media query dinamis ≥768px/fine/hover/tanpa reduced motion; shared Spotlight/ScrollRope
│   ├── useModalA11y.ts          # Escape + focus trap + scroll lock + restore fokus — SATU
│                                # implementasi untuk CartDrawer, PopupBanner, QuickVariantModal.
│                                # Sebelumnya disalin manual sehingga a11y tiap modal berbeda.
│   ├── useLoadingStage.ts       # tahap tunggu (8 dtk lambat, 20 dtk macet) untuk label bertahap
│   └── usePendingNavigation.ts  # router.push + status pending tombol CTA sampai rute tujuan tampil
├── src/lib/
│   ├── local-orders.ts          # salinan lokal pesanan perangkat ini (localStorage axvara-orders,
│   │                            # tanpa WA/email): pengingat, titik tab Pesanan, DeviceOrders
│   ├── db.ts                    # BARREL — entry point publik tunggal (jangan impor db/* langsung)
│   ├── db/                      # client (+state dev in-memory), expiry, errors, orders-create,
│   │                            # orders-transition, types
│   ├── commerce.ts              # createChannelOrderAtomic: reservasi stok + inventory + INSERT
│   │                            # order dalam SATU d1.batch, dipakai web/Telegram/WhatsApp
│   ├── payments/
│   │   ├── dana-qris.ts        # invoice + reissue QRIS, masa hidup order vs invoice
│   │   └── dana-history.ts     # predikat riwayat nominal untuk webhook/retry/guard atomik
│   ├── fulfillment/
│   │   ├── deliver.ts           # BARREL
│   │   └── delivery/            # claim, send, process, ensure, reconcile, handover,
│   │                            # inventory-binding, manifest, types
│   ├── telegram/
│   │   ├── messages.ts          # BARREL
│   │   ├── messages/            # format, catalog (detail ringkas; detail varian di keyboard), purchase, status, group, help, admin
│   │   └── handlers/            # command, callback (guard ownerBound), catalog, discovery,
│   │                            # orders, invoice, cart, cart-invoice, shared
│   ├── whatsapp/
│   │   ├── gateway.ts           # auth timing-safe + isPrivateIp (kontrol SSRF)
│   │   └── handlers/            # catalog, payment, proof, admin, shared
│   ├── r2.ts                    # R2 client (S3 API)
│   ├── product-copy/            # Salinan produk PDP (2026-09-24): text (pembersih teks pemasok +
│   │                            # sidik jari), format (parser deskripsi + fallback, aman client),
│   │                            # curated (S&K/aktivasi versi Axvara, SERVER-ONLY), resolve
│   │                            # (dipakai /api/catalog; jangan impor dari catalog.ts/komponen)
│   ├── config.ts                # payment methods, site config
│   ├── fetch-timeout.ts         # fetchWithTimeout + FetchTimeoutError (fetch browser tak punya batas waktu)
│   ├── utils.ts                 # formatRupiah, generateOrderCode
│   ├── pedia/                   # Lib Pedia: quote JWE+legacy/pricing, link (deteksi+mask), proxy router IndoSMM via VPS, ops-config (env efektif),
│   │                            # dispatch (job+poll), credits (PDK-), notify/email (Email B), seed (9 produk/27 jasa/39 tingkat), lookup (PD-13)
├── stores/
│   ├── cart.ts                  # Zustand cart store (localStorage) — badge/judul pakai lineCount() = jumlah baris varian (2026-09-19); count() sum-qty hanya untuk subtotal
│   ├── navigation.ts            # status navigasi sejak klik sampai pathname berubah (dibaca NavigationProgress)
│   ├── search.ts                # Zustand query search navbar Market (dibaca katalog Market)
│   └── pedia-search.ts          # Zustand query search navbar Pedia 1:1 Market (2026-10-12; dibaca home-client + scroll ke #pedia-catalog)
├── drizzle/                     # atau raw SQL — schema D1
└── wrangler.json                # Cloudflare bindings + Pages output
```

### 3.0 Aturan modul (pasca refactor)

**Pedia working-tree 2026-10-12: implementasi lokal, BELUM deployed; tidak ada flag diubah.** Menggantikan spec overhaul 2026-10-11; riwayat QA/deploy lama bukan bukti diff ini live. Schema 0059 sudah memiliki identitas supplier gabungan/status submitting/featured, tidak ada migrasi baru untuk perubahan ini. Detail UI: `docs/PEDIA-DESIGN.md`; kontrak/gate: `docs/PEDIA-PRD.md` dan §16.10.

- `GET /api/pedia/catalog` cache 60 detik, tanpa identitas/rate/nama/order supplier publik. Tier aktif wajib supplier penjualan `indosmm`, layanan `present=1`, tipe `Default`, rate positif dan min/max valid; harga finite positif, jumlah dalam batas/paket/step. Tier tanpa paket valid dan produk tanpa paket tersedia dihilangkan. Key bounds `(supplier,service_id)`; min/max boleh publik. Endpoint katalog memakai data D1 tersimpan, bukan live probe gate IndoSMM per request.
- Server meneruskan seluruh katalog; client awal maks 8 featured atau fallback 6 Jelajahi layanan tanpa klaim laris. Cari/filter/Tampilkan semua menjangkau semua produk terbit. `catalogCard()` memasangkan harga/jumlah/tier/refill dari satu paket; tagline TIDAK dirender di kartu/detail sejak 2026-10-12 (hapus AI slop; field tetap di DB/admin). `description_md` adalah field katalog publik opsional (`string|null`), ditampilkan pada detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan render Markdown/HTML; tidak ditambahi link-helper teknis. `ServicesMenu`/`CrossServicePromo` memakai `AXVARA_SERVICES` di site.ts; URL absolut, UTM promo, komunitas satu sumber. Kedua layout memakai satu `Footer` dengan newsletter dan bantuan kedua host; AppSwitcher dihapus, bukan disimpan. Revisi footer 2026-10-15 (implementasi; publikasi CI): navigasi Layanan AXVARA berasal dari `AXVARA_SERVICES`, tanpa kategori/tautan Semua produk/artikel dan tanpa fetch `/api/categories`. Ikon WhatsApp sesudah Facebook memakai SVG `currentColor` satu tone dengan sosial lainnya dan URL absolut `${SITE.webUrl}${waHubLink()}` (pesan default Halo AXVARA); teks chat/jam layanan dihapus. Pill Grup WA/Bot Order Telegram di bawah ikon memakai settings `whatsappGroupUrl` (fallback `WA_GROUP_HREF`)/`TG_BOT_HREF` dan aset brand lokal; bot tetap kanal Market. Navigasi layanan/bantuan dua kolom di mobile, empat kolom utama di desktop; form subscriber tetap same-origin.
- `OrderClient` tier/jumlah awal null, radio native, paket-only; pergantian tier yang tak mendukung jumlah mereset quantity null. Satu CTA per viewport meminta quote (25 detik), lalu order (60 detik) jika total sama dan tanpa kredit. Total berubah atau input kredit menghentikan langkah sebelum order dan meminta Setujui & lanjut ke pembayaran. Perubahan input membatalkan quote/respons lama; quote server 30 menit, client refresh 29 menit sebelum percobaan pertama.
- Ref in-flight mencegah klik ganda; percobaan order mengunci data. Ambigu/network/5xx serta 408/429 mempertahankan token/kontak untuk retry, 4xx lain membuka kunci/membuang quote. Ini pagar client, **bukan atomisitas penuh order/kredit/invoice**. Order tutup hanya pesan dekat CTA disabled, kontak/kredit/S&K tidak dirender, tanpa banner berulang di hero/judul.
- Admin GET produk menyertakan `live_type/rate/min/max/present` untuk readiness. ID admin wajib desimal positif kanonik, tanpa nol awal/notasi eksponen/pecahan. PUT parsial memvalidasi hanya field yang dikirim tanpa mereset field lain; paket wajib bilangan positif sesuai `step`, checklist berupa array objek `id/label` dengan ID unik setelah trim dan field bantuan opsional bertipe string. Edit tier atau paket/step produk langsung menghitung ulang harga tersimpan pada tier terdampak; harga derived tidak dapat diedit lewat PUT. Supplier hilang tidak dihidupkan ulang: harga dikosongkan dan tier `present=0` dinonaktifkan. **Simpan dan reprice berurutan, tidak atomik:** `500 reprice_failed` berarti edit sudah tersimpan tetapi harga mungkin belum seluruhnya diperbarui. Guard margin menyimpan penonaktifan sebelum harga baru agar replay setelah kegagalan tidak melewati pemeriksaan harga lama.
- GET admin gagal mengembalikan `500 load_failed`, bukan daftar kosong sukses; PUT/recovery gagal memberi `save_failed`, UI menampilkan feedback + Muat ulang, dan resync dengan `errors` dianggap berhasil sebagian. `mark_submitted/resubmit` memeriksa hasil update berpagar status (race → 409); resubmit dan cancel+kredit mewajibkan `confirm=true`. Konfirmasi UI recovery berupa form; ConfirmDialog dipakai untuk resync, kredit manual, pengaturan, bukan semua edit.
- Pengaturan disimpan ke `store_settings`, default valid + riwayat saldo 7 hari + overview per-provider saldo live/cache/error; bukan bulk override tingkat atau saldo live header global. Jalur reprice/quote/order masih membaca `PEDIA_MIN_ORDER_RP` dari env, field minimum tersimpan belum menggantikannya; ambang cron masih env. Tidak ada kontrak konsumsi default oleh seluruh jalur harga.
- (Histori 2026-10-12; UI admin digantikan redesign 13 November 2026 — §16.10c-ter.) Admin punya create produk/tingkat nonaktif, filter supplier/kompatibilitas/mapping, pilihan provider+service berpasangan, preview storefront tersimpan terpenuhi, API refill terpisah dari masa kurasi. `PediaManager` membentuk `PediaCatalogProduct` dari produk/tier tersimpan dan paket layak, termasuk tingkat nonaktif untuk kurasi; memakai `ProductCard`/`catalogCard` aktual + `OrderClient` embedded dalam mode preview aman. Draf tetap privat, tidak membuka route publik; navigasi kartu dicegah, pemesanan disabled, interaksi preview tidak memanggil API quote/order. Mobile CTA inline, bukan fixed; tautan kembali tidak dirender. Save/reload memperbarui preview; input belum disimpan tidak ikut, unsaved live preview di luar scope. Pengaturan menyajikan overview saldo live/cache/error/pricing/sync per provider, bukan header global. `mark_submitted` memverifikasi status/ID desimal positif kanonik pada provider asal dan konflik; `resubmit/cancel_credit` hanya sebelum `submit_attempts>0` atau supplier ID ada, bukan retry buta setelah timeout.

Route API dan modul besar dipecah per domain, tetapi **path publik lama dipertahankan sebagai
barrel** (`src/lib/db.ts`, `src/lib/fulfillment/deliver.ts`, `src/lib/telegram/messages.ts`).
Impor dari barrel, bukan dari file internal di dalam foldernya — itu yang menjaga satu titik
perubahan bila struktur internal digeser lagi. Handler webhook tidak boleh dipanggil langsung dari
`route.ts`: Telegram hanya mengekspos `handleCommand`/`handleCallback` supaya guard kepemilikan
`ownerBound` tidak bisa dilewati.

Pada admin, `onUnauthorized` bergantung pada setter `setAuthed` yang stabil, bukan objek hasil `useAdminAuth`. Dengan demikian `load` tetap stabil dan effect pemuatan tidak berulang setiap render; test komponen memeriksa jumlah request sesudah autentikasi dan perpindahan menu.

Revisi Telegram29Oktober2026 (lokal, publikasi CI): `catalog.ts` menampilkan
produk+varian sekaligus, memakai `formatVariantLabel`/stok efektif dan resolver
ketentuan web. `variantsKeyboard` membawa label kanonis/harga tanpa menempel
durasi non-WR/garansi berulang; varian habis di akhir memakai `noop`.
`checkout-approval.ts` membuat tag SHA25612karakter dari produk/varian/jumlah/harga
(bukan otorisasi). `checkout-email.ts` memvalidasi relasi/kebutuhan email
fail-closed dan fingerprint email; callback email membawa nonce acak, sedangkan
`telegram_users.pending_action` mengikat nonce+fingerprint. Claim CAS email/state
sebelum factory mempertahankan snapshot email yang ditampilkan. Callback basi
kembali ke ringkasan; retry order aktif didahulukan. Callback tetap ≤64byte,
ownership/chat pribadi wajib, tidak membawa kontak/PIN/c1.

Mutasi cart memakai SQL atomik dengan guard stok/minimum/kanal; pembersihan
checkout memakai snapshot baris agar tidak menghapus edit concurrent. Guard
commerce memeriksa `telegram_enabled` dalam batch order. Cancel ledger/order/
stok/inventory memakai satu batch guarded. Setup invoice gagal tanpa ledger
memakai `transitionPendingOrder` ditambah guard ketiadaan invoice dalam batch
yang sama; ledger apa pun atau hasil ambigu mempertahankan reservasi dan kode.
Initializing KlikQRIS dipulihkan hanya GET, bukan POST ulang.

Notifikasi paid memakai `buyer_notice_log` existing dengan key
`telegram:paid:<order>`, `access_lease`/`access_attempts`/`access_retry_at`:
claim CAS, lease basi10menit, maksimal5percobaan/backoff1/5/15/60menit,
settlement fenced, maksimal4 kandidat dalam budget40statement existing.
Penerima kredensial/paid hanya ID pribadi kanonis `telegram_user_id`; stored
chat_id tidak menjadi fallback akun lain. Input WA cadangan hanya saat idle.
Status/resend menyajikan semua item dan error parsial secara eksplisit.
Semantik transport bounded at-least-once, bukan exactly-once. Tidak ada schema,
env, trigger cron, integrasi gateway atau UI web baru.

**Status aktual Pedia 2 November 2026 (backend + UI lokal, publikasi CI):**
`order_kind='pedia'` tidak pernah masuk outbox Market — guard no-op di
`ensureFulfillmentForPaidOrder`/`ensureFulfillmentItems`/reconcile/process/
handover (baris salah lama dibiarkan inert), DANA bercabang seperti
GoPay/KlikQRIS (fulfillment null + hanya scheduler Pedia). Admin orders
mengembalikan `order_kind` + ringkasan `pedia` + nama ternormalisasi server;
handover AXP 409. Lookup/status Pedia jujur (counts supplier durable, nama
snapshot, ETA tier saat ini dapat kosong, null tetap null). Email paid/processing/completed memakai pagar fenced
existing (`buyer_notice_log`: lease UUID, attempts+1 sebelum transport,
maks 5, backoff 1/5/15/60, due/stale guard, settle CAS; klaim gagal =
tidak kirim; `sendPediaEmail` memakai forward sender ke API Resend tanpa
idempotency key, sehingga transport bounded at-least-once, bukan exactly-once): paid
independen dari supplier, processing menunggu resi durable dan jumlah awal/sisa
valid pada `submitted`/`in_progress` (integer aman, awal ≥0, sisa 0..jumlah,
jumlah positif; 0 valid); belum siap tidak mengklaim percobaan dan email
terkirim lama tidak dikirim ulang. Perubahan lokal, deployment belum diverifikasi;
(Pending mempertahankan status + refresh lease; tanpa resi/ambigu tidak
kirim; completed lama tidak diemail retroaktif), stale terminal disupresi,
selesai hanya completed; tampilan seperti Market (`renderBrandedNotice` +
field opsional `status`/`details`/`ctaLabel` — tanpa opsi output Market
byte-identik; completed memakai `Refill N Days`); konteks gabungan tunggal
(1 read) + gate budget realistis; recovery di tick Pedia existing (sighting
paid hilang ≤24 jam maksimal 5; discovery ≤2/fase, paid/completed ≤24 jam,
processing siap berresi tanpa batas 24 jam; ledger due existing tetap retry
setelah 24 jam); start_count
hanya number/string (boolean/object/array ditolak), safe-nonnegative-integer
(blank/missing/invalid/negatif/pecahan tidak menulis); slot NULL/0 menerima
positif tervalidasi berikutnya, positif terkonfirmasi dipertahankan, real 0
settled valid. Koreksi historis HANYA script operator satu-kali
`scripts/pedia-recount-start-count.mjs` (dry-run default; target D1 dan
allowlist maksimal 50 kode wajib; termasuk row historis tanpa marker; wajib
status terminal supplier; outage maksimal tiga pembacaan/item/invocation,
exit gagal, tanpa retry otomatis atau marker; status-read +
tulis count-only; tanpa dispatch/bayar/email/refill/mutasi kontrak; tanpa
cron/migrasi/lease-100-tahun baru). Cron tidak memindai terminal; active
poll didahulukan; UI unknown self-retry 10 dtk, terminal perlu dibuka ulang
setelah koreksi. Bukti lokal 2026-11-03: fixture; IndoSMM 503 — tanpa sentuh produksi;
payload/prod row belum diverifikasi. DANA
memanggil scheduler Pedia satu kali; cron tetap fallback.
UI: `src/components/pedia/status-view.ts` (helper murni: URL, header,
progres, estimasi, polling 5/10/30 dtk), halaman Pedia aktual, redirect
Market AXP, lacak AXP, admin kind-aware (tanpa handover/kredensial Market).
Tanpa migrasi/env/cron baru; deployment belum diverifikasi.

**Digantikan koreksi owner terakhir29Oktober:** `showLoadingBar` memulihkan
frame0/40/70/100%, timer400/500/400/300ms, delete dalam finally. Wrapper
`withLoadingIndicator` menjalankan animasi best-effort sebelum callback existing;
barrier callback sekarang no-op. Jalur invoice satuan/keranjang memanggil bar
“💳 Memuat QRIS pembayaran” sesudah order/reservasi durable dan sebelum create
provider existing; error dekorasi tidak membatalkan transaksi. Tidak menambah
retry provider atau mengubah snapshot/CAS. `soldout` dijawab tepat satu kali
oleh webhook lewat answerCallbackQuery(show_alert=true), tidak diteruskan ke
handler pembelian. Guard grup/claim webhook tetap mendahului alert.
Paragraf loading paralel berikut adalah histori, bukan kontrak terkini:
`command.ts` (/start) dan `catalog.ts` (handleShowProduct) memakai
`api.ts::withLoadingIndicator` dengan callback kerja
langsung berjalan bersama send loading (tanpa debounce300ms). Callback menerima
barrier `beforeResult`, dipanggil sebelum sendPhoto/safeEditOrSend hasil atau
pesan produk tidak tersedia. Barrier menunggu send awal selesai, tanpa mematikan
animasi selama upload hasil; maksimal3edit berjarak1200ms lalu “Masih memuat…”.
Send awal tidak dibatalkan saat data siap, memakai timeout existing10detik agar
ID pesan dari respons lambat tetap tersedia untuk cleanup. Selesai/gagal
membatalkan timer/edit aktif (timeout5detik) lalu delete (timeout existing10detik).
Error dekorasi ditelan tanpa menelan error kerja. Timeout kirim tetap ambigu:
tidak ada retry otomatis atau klaim mampu menghapus pesan tanpa ID respons.
Tanpa progres persentase, timer transaksi baru, atau background task tak ditunggu.
`safeEditOrSend` mengirim langsung bila message_id=0; pagination/stepper dan
ringkasan checkout/email dari callback memakai ID pesan existing. Respons input
teks tanpa ID tetap pesan baru; invoice/kredensial tetap terpisah. Argumen ID hanya
untuk presentasi, CAS/email/tag/nonce/ownership dan HTML1024/4096 tetap diuji.
Ikon dan kelompok ringkasan hanya mengubah teks; pembayaran/cancel/fulfillment,
pending_action dan guard finansial tidak diubah.

### 3.1 Runtime performa storefront

- `OrbitHero` hanya satu instance untuk desktop/mobile, memutakhirkan DOM lewat refs, memakai 30 fps untuk auto-rotate dan refresh-rate penuh saat drag/inertia, menghormati reduced motion, serta menghentikan rAF ketika hero offscreen/tab tersembunyi. Drag hanya aktif untuk `(pointer: fine)`; layar sentuh memakai `touch-action: pan-y` dan tidak menangkap swipe vertikal. Hemat mobile 2026-09-29 (laporan owner HP lag): hot path compositor-only (transform + opacity) — tanpa filter/blur/backdrop-filter/display per frame; mobile (coarse/≤640px) 8 planet + tanpa trail/label dinamis/shadow dinamis/star-dust + 24fps; glow hero cyan 44px (gold mati) di mobile. Dikunci tests/orbit-mobile-perf.regression.test.ts.
- `ScrollRope` dan `Spotlight` event-driven; tidak mempertahankan loop idle. ScrollRope tidak memasang listener pada viewport mobile.
- Kartu berulang memakai `ax-glass-card` tanpa `backdrop-filter`; blur penuh dipertahankan untuk navbar, drawer, modal, dan overlay.
- Homepage/detail merender skeleton sampai respons D1 tersedia. Seed produk hanya menjadi database in-memory saat development dan tidak pernah dipakai sebagai fallback UI produksi.
- **Umpan balik jaringan lambat (2026-09-24, PR loading storefront).** Route dinamis (`/`, `/produk/[slug]`, `/artikel*`, `/pesanan/[code]`) tidak di-prefetch dan App Router menunggu respons server SEBELUM URL berubah, jadi dulu halaman lama diam total setelah klik (`RouteLoading` lama baru menyala setelah halaman baru tampil). Kini `NavigationProgress` (layout root) menangkap klik `<a>`/`<Link>` internal di fase capture + `startNavigation()` untuk `router.push`, lalu setelah 120 ms menampilkan bar cyan yang merayap + skeleton rute tujuan (`Skeletons.tsx`, `fixed` di bawah navbar, z-35 agar tombol CTA pending di halaman lama tetap terlihat); 8 dtk → pil "Koneksi lambat", 20 dtk → "Coba lagi" (navigasi keras ke URL tujuan) / "Batal". Selesai saat pathname/search berubah. **Sengaja tanpa `loading.tsx`:** boundary Suspense membuat respons awal streaming, sehingga `notFound()` produk/artikel nonaktif menjadi 200 + noindex (Next 15.5 tanpa PPR juga streaming untuk bot) dan katalog SSR berpindah ke `<div hidden>` di akhir HTML. `/produk/tidak-ada` tetap 404.
- PDP (`produk/[slug]/page.tsx`) memanggil handler `/api/products?slug=` + `/api/catalog?slug=` di server (pola beranda) dan mengoper `initialProducts`/`initialCatalog` ke client: PDP tampil lengkap dari satu respons navigasi, tanpa skeleton kedua + dua round-trip klien. Gagal = undefined → client fetch seperti dulu (h1 sr-only hanya dirender pada jalur cadangan ini agar tidak ada h1 ganda).
- Fetch storefront memakai `fetchWithTimeout` (quote 25 dtk, `POST /api/orders` 60 dtk, lookup/pesanan/varian 20–25 dtk) sehingga permintaan menggantung berakhir dengan pesan + "Coba lagi", bukan spinner selamanya. Polling `/pesanan/[code]` melewati tick bila permintaan sebelumnya belum selesai.
- Cache publik ditetapkan langsung oleh Edge handler: produk aktif 30 detik, kategori aktif60detik; banner aktif no-store sejak24Oktober. Respons admin atau varian produk non-eksplisit tetap `private, no-store`. **Pengecualian PDP by-slug (2026-10-02, insiden Head 18 Bulan):** `GET /api/catalog?slug=` = `s-maxage=10, SWR 30` dan `GET /api/products?active=1&slug=` = `max-age=10, s-maxage=10, SWR 30` — daftar katalog tetap 30 detik, hanya halaman produk yang 10 detik agar angka stok segar tepat setelah ada yang beli.
- Middleware hanya menambahkan `unsafe-eval` pada CSP saat `NODE_ENV=development`, karena React Refresh membutuhkannya. Header production tetap ketat.
- **Optimasi LCP/Speed Index mobile beranda (2026-10-06, PageSpeed mobile 85 vs desktop 99 — LCP 3,9 dtk, SI 4,5 dtk).** 4 kartu pertama `loading=eager + fetchPriority=high` (Next otomatis menerbitkan 4 preload `imageSrcSet` responsif — LCP tidak antre lazy queue), kartu 5+ tetap lazy; kartu ke-9+ `content-visibility:auto + containIntrinsicSize: auto 420px` (browser melewatkan layout/paint kartu jauh); animasi OrbitHero mobile (lite/coarse/≤640px) ditunda via `requestIdleCallback` (timeout 2,5 dtk, fallback 1,2 dtk) agar thread utama fokus ke paint pertama — desktop + reduced-motion tidak berubah; font JetBrains Mono `preload:false` (hanya kode pesanan/timer QRIS, bukan critical path) — Inter + Space Grotesk tetap preload. Dikunci `tests/storefront-catalog-ux.behavior.test.tsx` (+2), `tests/orbit-mobile-perf.regression.test.ts` (+1), `tests/home-ssr-catalog.behavior.test.tsx`.

---

## 4. Skema Database (D1 — SQLite)

```sql
-- Kategori
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Slug adalah identitas stabil. Edit label tidak mengubah slug; ikon dipilih
-- eksplisit dari katalog aset lokal dan tidak diturunkan dari nama/slug.

-- Produk
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,          -- dalam rupiah, tanpa desimal (89000)
  compare_price INTEGER,           -- harga coret
  image_url TEXT,                  -- R2 URL
  images TEXT,                     -- JSON array URL tambahan
  stock INTEGER DEFAULT -1,        -- -1 = unlimited (digital)
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Pesanan
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,       -- AXV-20260831-0012
  customer_name TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  customer_email TEXT,
  items TEXT NOT NULL,             -- JSON [{product_id, name, price, qty}]
  subtotal INTEGER NOT NULL,
  payment_method TEXT NOT NULL,    -- ewallet | seabank | qris | bank_other
  payment_account TEXT,            -- nomor tujuan (082135277434 / 901812349386)
  proof_url TEXT,                  -- R2 URL bukti transfer manual; null untuk QRIS
  status TEXT DEFAULT 'pending',   -- pending | lunas | dibatalkan | kadaluarsa
  admin_note TEXT,                 -- lisensi/key yang dikirim
  quote_id TEXT,                   -- jti quote signed; unique untuk idempotensi
  expires_at TEXT,                 -- QRIS 15 menit SEMUA kanal (keputusan owner 2026-10-11; dulu Telegram/Web 60 menit); manual 24 jam.
                                   -- Ditulis ISO UTC, BUKAN datetime('now',...) yang formatnya
                                   -- spasi dan ditafsirkan Date.parse sebagai waktu lokal.
  qris_reissue_count INTEGER NOT NULL DEFAULT 0, -- migrasi 0024; batas MAX_QRIS_REISSUES = 1 (reissue tetap didukung bila order masih hidup <15 menit)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;

-- Guard CHECK membuat batch D1 gagal/rollback jika precondition stok/status gagal.
CREATE TABLE operation_guards (
  operation_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- Admin
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Payment Methods (konfigurasi dinamis)
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,             -- ewallet | seabank | qris | bca ...
  label TEXT NOT NULL,             -- "DANA / Gopay / Shopeepay"
  account_number TEXT,             -- "082135277434"
  account_name TEXT,               -- "Brotherstore06"
  qris_url TEXT,                   -- legacy; QRIS dinamis tidak menyimpan aset di sini
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'footer',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE store_settings (
  key TEXT PRIMARY KEY,            -- store_name | tagline | whatsapp_number | ...
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed payment_methods:
-- ewallet | DANA / Gopay / Shopeepay | 082135277434 | Brotherstore06
-- seabank | SeaBank                  | 901812349386 | Brotherstore06
-- qris    | QRIS Dinamis             | -            | DANA Business | qris_url NULL
```

**AXVARA Games (migrasi 0107 + 0108 + 0109, §16.25–§16.29):** tabel `games_products`
(kolom `display_group`/`display_order` ditambahkan 0108), `games_reference_prices`
(sumber kebenaran harga pembanding Oura per `buyer_sku_code`), `games_order_items`
(1 baris per pesanan Games, FK `orders.code`), dan `games_dispatch_attempts`
(`ref_id` unik per percobaan). Definisi kanonis ada di `drizzle/schema.sql`; 0108
bersifat aditif — `CREATE TABLE IF NOT EXISTS` untuk tabel referensi, sedangkan
`ALTER TABLE` kolom baru dicatat ledger migrasi D1 dan tidak dijalankan ulang manual.
0109 menambah `games_nickname_cache` (PK namespace lookup + customer_no, ref unik,
hasil/nickname/checked_at/expiry) dan `games_nickname_checks` (ref unik, slug/SKU,
modal/status/rc, IP HMAC/perangkat acak/timestamp). Claim cache dan admission log
satu batch atomik; pending/ambigu tidak kedaluwarsa agar tidak membeli dua kali.
Migrasi0111 `games_reference_seed` hanya seed198 referensi Oura ke tabel0108 dengan
`ON CONFLICT DO NOTHING` (edit admin dipertahankan); tidak menambah schema atau
mengubah `games_products`/enabled. Harga jual baru dihitung sinkron berikutnya (§16.27).

---

## 5. API Contract (MVP)

| Method | Path | Deskripsi | Auth |
|--------|------|-----------|------|
| GET | /api/products | List produk (filter category, search, active). Daftar `active=1` MENAMPILKAN produk habis di akhir (`soldOut: true`, urutan ready → habis → nonaktif, kontrak 2026-10-01). Permintaan katalog admin juga menerima `lowStockVariants` per produk = jumlah varian aktif berstok 0–5, satuan yang sama dengan `low_stock` di `/api/admin/overview`, PLUS `liveStatus`/`liveReason` per produk (admin-only: live/hidden_soldout/loser/off + sebab) + array `pairs` ringkas untuk resolver pecundang | - |
| POST | /api/products/reorder | Geser produk TEPAT satu posisi dalam bucket status (kanonis `src/lib/product-order.ts`). Bila arah melewati batas halaman admin saat ini → respons sertakan `newPage` agar hook pindah halaman mengikuti produk (2026-10-01). Untuk lompat jauh (30→1) pakai field angka Urutan, bukan ↑↓ | - |
| GET | /api/products/:slug | Detail produk | - |
| GET | /api/categories | List kategori | - |
| POST/PUT/DELETE | /api/categories[?id=] | Kelola kategori | admin |
| POST | /api/subscribers | Simpan email unik dari form footer | - |
| GET | /api/subscribers | List pelanggan email | admin |
| GET/POST/PUT/DELETE | /api/articles[?id=] | Publikasi dan CRUD editorial | public/admin |
| GET/POST/PUT/DELETE | /api/banners[?id=] | Carousel banner + settings publik aktif | public/admin |
| PUT | /api/banners/settings | Konfigurasi popup bersama | admin |
| POST | /api/banners/reorder | Urutan atomik + expected_ids | admin |
| POST | /api/checkout/quote | Validasi produk/stok/harga, metode aktif, dan terbitkan signed quote 60 menit | - |
| POST | /api/display-prices | Konversi display-only IDR ke sen USD dari snapshot server, private/no-store | - |
| GET/POST/PUT | /api/payment-methods[?id=] | Baca metode aktif / tambah bank / kelola rekening dan QRIS | public/admin |
| GET/PUT | /api/store-settings | Baca identitas storefront / perbarui nama, kontak, footer, logo | public/admin |
| POST | /api/orders | Verifikasi signed quote, buat pesanan idempotent, reservasi stok atomik | - |
| POST | /api/orders/lookup | Lacak mandiri: verifikasi pasangan kode + WA (normalisasi 08/+62/62, constant-time) atau email checkout (cocok penuh, huruf kecil; sejak 2026-09-25, field `contact`, field `wa` lama tetap diterima, helper `src/lib/order-contact.ts`), 404 generik anti-enumerasi, WA/email mask, rate-limit `orders:lookup` | - |
| GET | /api/orders?code= | Cek status pesanan via code. WA/email dimask; flag boolean dari satu query gabungan (hanya order `lunas`): `credentials_ready` = detail akun (WR atau isi produk non-WR) sudah siap diambil sehingga storefront tahu kapan panel retrieval boleh tampil, `queued_delivery` = ada baris antrean (Made By Order), `instant_delivery` (2026-09-25) = SEMUA baris dikirim dari stok sendiri (varian non-WR `shared`/`unique`) sehingga halaman memeriksa rapat; `supplier_owned`/`supplier_running` (2026-10-13) = order milik pipeline WR/SK dan linknya masih berjalan — halaman menampilkan skeleton menyiapkan + poll rapat yang memicu tarikan status vendor (gerbang 20 dtk/order di `store_settings`), tanpa pernah menampilkan kalimat stok/admin untuk order supplier; plus `fulfillment_status` | - |
| GET | /api/orders/:code | Kembaran segmen dari `?code=` untuk halaman pesanan yang sama. **Invarian (audit 2026-09-20): isinya WAJIB sepadan — `proof_url` TIDAK pernah ikut di kedua endpoint.** Nilai itu adalah kunci objek R2 privat yang hanya boleh dibaca admin lewat `/api/admin/bukti/*`; membocorkannya memberi penebak kode order nama berkas bukti bayar milik orang lain. Dikunci `tests/audit-2026-09-20.regression.test.ts` | - |
| GET | /api/payments/qris/:code/image | Render PNG QRIS dinamis untuk invoice aktif | code order |
| POST | /api/payments/qris/:code/reissue | Terbitkan QRIS baru untuk order yang masih hidup tetapi QR-nya sudah kedaluwarsa (<15 menit). Hanya boleh saat invoice lama SUDAH mati — syarat itulah yang mencegah pemegang kode order lain membatalkan QR yang sedang dipakai. Maks 1x/order, rate limit 5/menit/IP | code order |
| POST | /api/orders/[code]/cancel | Batal mandiri pembeli (2026-10-11): verifikasi kode + WA/email checkout pola lookup (404 generik), hanya pending+unpaid, CAS `transitionPendingOrder` (kalah race vs webhook = 409), stok kembali detik itu juga; tombol di `/pesanan/[code]` + `/lacak-pesanan` | kontak checkout |
| POST | /api/webhook/dana | Terima notifikasi QRIS Hook, dedup, cocokkan nominal, lunasi order | X-Webhook-Secret |
| POST | /api/proof/upload | ⏸️ maintenance 2026-09-17: selalu 503 (upload bukti disembunyikan di WEB; QRIS saja) | same-origin |
| GET | /api/admin/bukti/:key | Preview/download bukti | admin |
| POST | /api/upload | Upload WebP produk/artikel/banner ke R2 | admin |
| * | /api/agent/* | Context, artikel, media, dan audit | agent scope |
| POST | /api/cron/publish-scheduled | Publish artikel dan kedaluwarsakan order jatuh tempo | cron secret |
| POST | /api/auth/login | Admin login, set cookie | - |
| GET | /api/admin/overview | KPI, antrean tindakan, dan health flag tanpa secret | admin |
| GET | /api/admin/orders | List pesanan dengan search/filter/channel/date, pagination, dan CSV | admin |
| PATCH | /api/admin/orders/:id | Update status (lunas/batal) + admin_note | admin |
| GET/POST | /api/admin/payments/events | Audit aman QRIS Hook + retry exact-match | admin |
| POST | /api/admin/products | Create produk + upload image ke R2 | admin |
| PUT | /api/admin/products/:id | Update produk | admin |
| DELETE | /api/admin/products/:id | Soft delete | admin |

**Validasi POST /api/orders (maintenance 2026-09-17: QRIS saja — non-QRIS 503):**
```ts
{
  customer_name: string (min 3),
  customer_wa: string (regex 08..., 10-15 digit),
  customer_email?: string (email),
  items: { product_id: number, qty: number }[] (min 1),
  payment_method: "qris", // ewallet/bank:* ditolak 503 selama maintenance
  proof_url?: string | null // proof apa pun ditolak 503 selama maintenance
  quote_token: string // signed HS256, snapshot item/subtotal/payment account; quote tanpa QRIS ditolak 503
}
```

**Kontrak UI media/admin:**

- Cover produk pertama dan cover artikel dinormalisasi browser ke WebP 1600×900. Sejak implementasi 2026-10-21 (publikasi CI), `useProductManager.handleUpload` memakai `toWebpOriginalRatio` untuk foto produk kedua dan seterusnya, berdasarkan jumlah foto existing + indeks batch; rasio asli dipertahankan dengan sisi terpanjang maksimal 1920 px, sama seperti banner. Konversi berada dalam penanganan error upload agar kegagalan melepas status uploading tanpa mengubah galeri tersimpan.
- PDP `product-detail-client.tsx` mempertahankan cover 4:3 `object-cover`; foto tambahan memakai tinggi otomatis dan `object-contain`. Thumbnail galeri dan preview `ProductEditorModal` juga menampilkan foto tambahan utuh. Kontrak URL/urutan `image` + `images`, batas delapan foto, API/R2/schema tetap; file lama yang sudah tercrop perlu upload ulang dari sumber asli, tidak direkonstruksi otomatis.
- Revisi24Oktober: popup maksimal448px, image block/w-full/h-auto dengan rasio natural; tanpa tinggi tetap, crop atau letterbox. Seluruh isi dapat digulir dalam max92dvh; close tetap terjangkau. Panah menumpang gambar, counter langsung di bawahnya, teks dan checkbox/CTA terpusat tanpa separator.
- `PopupBanner` hanya fetch/render pada pathname homepage (`/`), sehingga promosi tidak menghalangi checkout, status pesanan, detail produk, atau workflow admin. Checkbox kecil "Jangan tampilkan lagi" di bawah banner menyimpan penanda `axvara-banner-<id>-hide-until` di localStorage selama 24 jam (per banner id; langsung pindah ke info tetangga, atau tutup bila semua disembunyikan).
- Bukti pembayaran tetap privat melalui `/api/admin/bukti/:key`; UI membedakan belum diunggah, URL tidak valid, file R2 hilang, dan preview tersedia.
- Kategori D1 menjadi sumber tunggal kapsul katalog dan menu Jelajah footer. Nama, ikon, serta `sort_order` dapat diedit; slug tetap stabil ketika nama berubah, dan penghapusan ditolak selama kategori masih dipakai produk. Taksonomi 2026-09-28 (migrasi 0046): AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat — slug lama (`ai-gateway`, `akun-premium`, `tools-pro`) dialias di kode (`LEGACY_CATEGORY_SLUG_ALIASES`) agar filter lama tidak 404. Daftar produk admin punya kolom Urutan + tombol ↑↓ per baris + field angka Urutan tampil 0–999999 di modal edit. Reorder 2026-09-29 (fix laporan owner "semua 0, ↑↓ diam + refresh"): geser delta ±1 dari baseline tetangga global via SATU PUT `/api/products/[id]` (tetangga tak disentuh; tetap gerak walau baseline kembar 0 — swap 0↔0 tidak mengubah `ORDER BY sort_order,id`), sukses tanpa fetch ulang (realtime, halaman/scroll/focus utuh, rollback saat gagal), migrasi 0047 backfill 0→unik mengikuti id (idempoten, nilai admin utuh). Urutan tampil admin (`filtered`: aktif → ready → sortOrder → id) dicerminkan storefront (`home-client`, minus cabang aktif karena katalog publik hanya aktif). Display 2026-09-29: kolom Urutan memajang nomor posisi 1..N (pos+1, selalu rapi), bukan raw sort_order — raw adalah kunci teknis yang boleh kembar/lompat (delta geser, backfill parsial, edit manual) dan hanya tampil di tooltip + hint modal edit. Exact-step 2026-09-29 (laporan owner: ↑↓ skip 2–3 posisi + modal ≠ tabel): satu-satunya jalur reorder = POST /api/products/reorder — server baca urutan kanonis (`src/lib/product-order.ts`, dipakai juga home-client + hook + tombol), tukar tepat satu tetangga se-bucket status (aktif-ready / aktif-habis / nonaktif tidak saling melewati; batas = 409 + tombol mati + tooltip jujur), lalu normalisasi seluruh key 10,20,30… dalam satu batch D1 atomik (tiap klik = tepat 1 posisi); response kembalikan key final → hook realtime tanpa fetch ulang; modal read-only displayPosition (Simpan tidak kirim kunci posisi); produk baru (`POST /api/products` tanpa sortOrder) dan sync WR dialokasikan MAX+10 (masuk akhir, tanpa tabrakan); migrasi 0048 normalisasi key kembar produksi → unik 10,20,30… (urutan tampil dipertahankan, idempoten). Anti-429 + lompat 2026-09-29 (laporan owner: 429 saat ↑↓ + 30→1 harus 29× klik): BUKAN kuota cron — bucket `products:write` 20/mnt berbagi dengan simpan produk + tiap klik tulis ulang 51 baris. Kini scope `products:reorder` 120/mnt + hanya baris berubah yang ditulis; badge posisi = input ketik (Enter = `targetPosition` 1 request, dijepit ke bucket + `clamped`);   request client antre berurutan (tanpa race, 429 jujur tanpa reset posisi). Selip restok 2026-10-02 (laporan owner: Netflix/Capcut posisi 6/8 habis → restok terdampar 20+): saat sync mendeteksi transisi agregat parent 0→ready, `sort_order` diselipkan kembali via `reinsertionKey()` (fungsi murni `product-order.ts`: belakang jangkar ≤ key lama, maju sampai slot longgar, hormati key tetangga habis/pecundang) + helper `restock-reinsert.ts` (`maybeReinsertRestockedProduct`: 2 query + 1 write HANYA saat transisi; tanpa write bila slot kosong) — hook di loop WR + SK setelah batch per produk (budget-guarded, best-effort, tanpa migrasi).
- Email form footer dinormalisasi lowercase, dideduplikasi oleh unique index, dibatasi per IP, dan hanya dapat dibaca melalui panel/API admin terautentikasi.
- Sidebar admin dikelompokkan menurut pekerjaan. `AdminOverview` menjadi action center; `OrdersManager` memegang filter/pagination/detail; `PaymentReconciliation` hanya menampilkan metadata event aman, bukan payload mentah atau secret.
- Ikon admin memakai `IosIcon` (Icons8 iOS 11 Glyph PNG lokal di `public/icons/ios11/`, tint via CSS filter) dengan prinsip hemat: ikon hanya untuk aksi nyata (tambah, simpan, hapus, tutup, cari) dan pesan status (error/sukses), bukan dekorasi label/statistik. Badge `ChannelBadge`/`StatusBadge`/`MethodBadge` adalah teks + warna (tanpa ikon). Dialog memakai judul + tombol tutup saja (tanpa header-ikon), backdrop `bg-black/60` + blur, radius `rounded-2xl` (konfirmasi) / `rounded-3xl` (form), dan rhythm root `mt-4` + `space-y-4` agar tidak terlihat AI slop.
- Bukti QRIS adalah referensi visual saja. Tombol approval manual tidak dirender untuk order QRIS; pencocokan ulang tetap menuntut satu invoice DANA aktif dengan nominal persis.
- Editor varian memakai form-card responsif dengan CTA eksplisit dan menyimpan inventory fulfillment per SKU. Dialog mengunci body, mendukung Escape, dan meminta konfirmasi sebelum membuang perubahan. Sejak 2026-09-28 mode single/non-varian (toggle OFF) paritas penuh: Min. Beli + Masa Garansi + Cara Pengiriman + Template pesan memakai blok yang sama (`SingleVariantFields`, `WarrantyFields` bersama) dan selalu disimpan sebagai 1 varian `Default` eksplisit (SKU `DEFAULT-*`, update in-place via id — bukan insert baru, karena stok fulfillment keyed by variant_id); toggle ON↔OFF menyalin nilai dua arah agar tidak reset.
- Angka Terjual bisa diedit admin (2026-09-29): kolom Terjual di tabel (ketik + Enter → PATCH `/api/products/[id]/sold-count`, SET absolut, realtime + rollback) + field Terjual di modal edit (ikut payload PUT). Milik admin untuk semua produk (manual + WR — sync/cron tidak pernah tulis kolom ini). Order lunas tetap `sold_count += qty` di atas angka manual (increment otomatis utuh, bestseller Telegram + kartu storefront ikut angka final).
- Daftar Produk: tab status toko Live/Hidden/Nonaktif/Semua (2026-10-01, live): admin tidak lagi menebak kenapa produk toggle-ON tidak tampil di toko. Default = Live (yang tampil di toko SAAT INI = `isLiveProduct` versi admin: aktif + tidak hidden pecundang + ≥1 varian beli). Hidden = toggle ON tapi tak tampil (sebab jujur per baris: "Kalah dari {nama}" / "Varian ada tapi stok habis" / "Nonaktif tapi stok tersedia"); Nonaktif = toggle OFF. Badge count (live/hidden/off) + kartu "Hidden otomatis" (bukan "aktif" yang menipu). Hanya 1 request list: status dihitung dari respons `GET /api/products` admin (`liveStatus`/`liveReason` + `pairs`, publik tidak menerimanya). Pagination admin 20/50/100 per halaman (persist `axvara-admin-per-page`, default 20; ganti tab/reset filter kembali ke hal. 1; `safePage` clamp + auto-koreksi + preferensi basi 8→20). Reorder ↑↓ pindah halaman bila melewati batas (2026-10-01: batas tab/halaman baru = default + delta). Ringkasan Produk hanya tampil di tab Live (angka = yang tampil di toko). Filter chip `low_stock` warisan tetap jalan.
- `store_settings` adalah override D1 untuk identitas serta tautan dukungan storefront. API publik read-only memakai cache singkat dan PUT memerlukan sesi admin; fallback `SITE` menjaga storefront tetap tersedia jika tabel belum siap.

---

## 6. Flow Teknis Checkout

```
[Client] Keranjang (Zustand + localStorage) / Beli Langsung (produk D1 aktif)
   ↓ POST /api/checkout/quote { slug/id, qty, expected_price }
[Server] Validasi produk aktif, stok, harga, dan payment_methods D1
   ↓ response quote HS256 60 menit + snapshot authoritative
[Client] Konfirmasi perubahan harga → QRIS auto-select (E-Wallet/Bank maintenance 2026-09-17: tampil disabled + badge di WEB, dihilangkan di WA/TELE)
   ↓ POST /api/orders { customer (nama opsional fallback prefix email, email SELALU wajib), item IDs/qty, payment_method, proof_url, quote_token }
[Server] Verifikasi signature+expiry+isi item → tolak non-QRIS 503 → D1 batch guard+decrement+INSERT order
   ├─ QRIS: alokasikan kode unik 1–299 → EMVCo dynamic payload + ledger 15 menit
   │    ↓ client: layar "Pesanan dibuat · Membuka halaman pembayaran" sampai /pesanan tampil
   │      (keranjang dikosongkan di balik layar ini; `qris` respons create disimpan di salinan lokal)
   │    ↓ /pesanan/[code] menampilkan QR dari salinan lokal segar (≤10 mnt, ada `qris`) lalu
   │      diganti data server; PNG ber-placeholder + "Muat ulang QRIS"; polling 5 detik
   │    ↓ QRIS Hook → POST /api/webhook/dana → exact amount + event dedup → lunas atomik
   └─ Manual: ⏸️ maintenance 2026-09-17 (upload disembunyikan WEB, endpoint 503, order manual 503)
        ↓ cron: jatuh tempo → status kadaluarsa + restore stok dalam satu batch
```

**Anti-tamper:** Harga, rekening, subtotal, dan item order terikat ke quote server; body client tidak dapat mengganti snapshot. Quote id unik membuat retry idempotent — checkout mengandalkan ini saat `POST /api/orders` timeout/putus jaringan: pesan "Tekan Bayar lagi — pesanan yang sama dilanjutkan, tidak dibuat dobel" (token quote yang sama → `orders.quote_id` UNIQUE mengembalikan pesanan yang sudah ada). Reservasi/restore stok memakai batch D1 dengan guard CHECK agar kegagalan rollback seluruh operasi; stok `-1` tetap unlimited.

**Laporan pendapatan (issue #12, review R9 2026-09-08):** sumber waktu kanonis `src/lib/revenue.ts` — `orders.paid_at` (ditulis sekali saat transisi lunas via COALESCE-guard di semua jalur QRIS/manual/admin, dalam batch yang sama dengan flip status) dengan bucket WIB (`datetime(..., '+7 hours')` di SQL, helper `isSameWibDay/isSameWibMonth` di dev-fallback). Hierarki: ledger `paid_at` → `paid_at` order → `reviewed_at` bukti → `updated_at` fallback. Migrasi `0016_revenue_paid_at.sql` membackfill data lama (QRIS dari ledger, manual dari `reviewed_at`, sisa lunas dari `updated_at`, non-lunas tetap NULL, idempoten). Overview menandai `revenue_timezone: Asia/Jakarta` + `revenue_from/to` agar mudah diaudit.

**Dashboard untung (revisi 2026-10-15, implementasi; publikasi via CI):** `src/lib/dashboard-report.ts` membaca satu query agregat CTE dengan fakta per item lunas; respons dibatasi agregat (bukan seluruh order mentah). `orders.paid_at`/ledger pembayaran tetap menentukan kalender WIB. Modal link WR/SK dialokasikan ke baris supplier yang bersangkutan; modal stok sendiri dari snapshot, fallback katalog untuk riwayat tanpa snapshot. Pedia memakai `supplier_charge`, fallback rate snapshot × quantity, dan kelompok supplier tersendiri. Biaya supplier dinormalisasi ke rupiah utuh untuk konsistensi tampilan. Pembagian nominal pembayaran/biaya supplier mempertahankan setiap rupiah (sisa pembulatan pada baris terakhir); supplier/channel/Top 5/series memakai fakta yang sama. Item campuran tidak disembunyikan oleh keberadaan link supplier pada item lain. Jumlah pesanan per supplier menghitung pesanan yang mengandung item asal itu; pada keranjang campuran jumlah kelompok tidak dijumlahkan sebagai total order.

`GET /api/admin/overview` mempertahankan field `revenue/cost/profit _today/_week/_month/_total`, breakdown seluruh waktu dan `daily_series` 30 hari untuk kompatibilitas; menambahkan `period_reports.{today,week,month}` berisi `{orders,revenue,cost,profit,estimated_orders,series,suppliers,channels,top_products}`. UI memakai laporan periode untuk SEMUA panel. `today.series` per jam WIB sampai jam berjalan; minggu/bulan harian sampai tanggal berjalan. Top 5 mencakup seluruh transaksi periode (batas 500 order dihapus). Query gagal tidak diganti dengan untung 0; UI menampilkan pesan gagal beserta tombol muat ulang. Grafik `OverviewCharts.tsx` mengukur container, mendukung nilai rugi dan sumbu order tersendiri; donat memakai omzet nonnegatif, batang untung mendukung rugi. Pergantian periode memakai payload yang sama, tanpa polling atau cron tambahan.

**Kompatibilitas D1 (recovery 2026-10-15):** D1 menolak enam SELECT dalam satu compound UNION (`too many terms in compound SELECT`), meski node:sqlite menerima. Tiga agregat ringkasan/supplier/channel kini berada di CTE `totals`, lalu digabung dengan Top 5/harian/per jam dalam empat cabang hasil; setiap compound tetap di bawah batas lima. Tetap satu query dan fakta yang sama, tanpa mengubah kontrak API atau menambah cron. `tests/dashboard-report.d1-runtime.test.ts` menjalankan SQL aktual pada D1 workerd melalui Miniflare (devDependency eksplisit yang versinya sudah tersedia di lock adapter), menguji katalog kosong dan keranjang campuran WR/SK/stok sendiri beserta konservasi nominal di seluruh periode. Test SQLite tetap berjalan untuk cakupan kasus bisnis lain.

**Laporan historis dan unduhan (2026-10-15, publikasi CI):** overview menerima `period=today|week|month` (default week) ATAU pasangan `date_from/date_to` kalender YYYY-MM-DD, inklusif WIB, maksimal 366 hari; parameter ganda/kombinasi periode-rentang/tanggal invalid/masa depan ditolak 400 sebelum query. `selected_report` menambahkan `from/to/timezone/generated_at` pada PeriodReport, dengan series per jam untuk today dan harian untuk rentang lain. Field kompatibilitas `period_reports` tetap tersedia. Query pilihan memfilter tanggal pembayaran sebelum ekspansi item; operasi stok/antrean tetap kondisi kini. Request generation mencegah respons lambat menimpa pilihan terbaru; panel finansial/ekspor disembunyikan saat loading/gagal. Toolbar `AdminOverview` menerapkan bulan saat berubah, atau pasangan tanggal lengkap setelah validasi client; isian parsial/invalid mempertahankan laporan terakhir tanpa request. Tidak ada tombol Terapkan/card filter. Tombol unduh PDF/Excel dikelompokkan tepat di samping pemilih bulan/tanggal pada toolbar yang sama; hanya dirender saat laporan siap, termasuk bila payload lama masih tersimpan saat loading/gagal. `AdminPage` merender metadata `selected_report` sejajar sesi admin hanya setelah laporan siap; loading/gagal menyembunyikan metadata lama. Teks total/pending/pill low_stock dan kartu estimasi dihapus dari UI; field API dan catatan estimasi ekspor tetap tersedia.

Pedia memakai nilai penjualan = pembayaran merchant + kredit digunakan (atau subtotal bila kredit penuh tanpa ledger); pembulatan invoice ikut omzet seperti Market. `merchant_paid/credit_used` pada ringkasan memisahkan penyelesaian pembayaran dari nilai jual, dihitung sekali per order agar keranjang campuran tidak menggandakan nominal. Snapshot biaya tetap berlaku. `ReportExportActions` memuat `src/lib/reports/export.ts` saat klik; pdf-lib dan write-excel-file/universal dimuat dinamis di browser, tanpa endpoint/cron/kredensial tambahan. PDF A4 berpaginasi dan XLSX lima sheet memakai satu model tabel dari respons layar, bukan CSV 5000 order. XLSX memakai sel numerik dan label String (bukan Formula); Unicode dipertahankan. PDF Helvetica mempertahankan teks Latin dan mengabaikan glyph dekoratif yang tidak didukung agar emoji tidak menggagalkan dokumen. Nama file mencantumkan tanggal awal/akhir; waktu pembuatan dan modal estimasi ada pada Ringkasan.

**Snapshot modal pembayaran (0063):** tabel tambahan `order_item_costs(order_code,item_index,product_id,variant_id,source,supplier_variant_id,unit_cost,created_at)` dengan PK `(order_code,item_index)`. `PAID_ORDER_COST_SNAPSHOT_SQL` dijalankan dalam batch transisi lunas QRIS/ACC maupun konfirmasi manual bersama order/outbox; `INSERT OR IGNORE` mempertahankan snapshot pertama. Tautan varian tidak memakai FK agar penghapusan katalog tidak menghapus modal historis; FK order tetap berlaku. Harga supplier link aktual mengungguli snapshot katalog. Snapshot tidak dibackfill sebagai fakta historis: data lama tanpa snapshot tetap memakai estimasi yang dilabeli, supplier nonterminal/charge Pedia belum ada juga estimasi. Migrasi hanya CREATE TABLE IF NOT EXISTS, diterapkan CI sebelum Pages; tanpa rebuild/rename tabel atau eksekusi migrasi produksi manual.

**Checkout invalid (2026-10-15):** handler submit bersama memvalidasi WA/email sebelum membuat order. Sesudah error ter-render, field pertama difokuskan dengan `preventScroll` dan wrapper label/input/hint digulir ke tengah viewport; wrapper memiliki scroll-margin navbar/CTA, reduced motion memakai scroll langsung. Error terhubung lewat aria-describedby, sticky CTA mobile juga menjelaskan perlunya melengkapi data.

**Monitoring & ketahanan notifikasi (issue #13, review R10/R11 2026-09-08):** status layanan jujur empat tingkat di `src/lib/service-health.ts` (`configured/healthy/degraded/unknown`) — overview memakai pengukuran (antrean fulfillment/outbox + usia, kirim terakhir, event QRIS 7 hari) dan mengembalikan `system_details` berdetail di samping boolean kompatibel; `last_match` mencakup event `matched`, kesehatan fulfillment membaca `fulfillment_items` + usia antrean tertua via `evaluateQueue` (macet = degraded; `manual_required` = needsAction → degraded langsung tanpa menunggu usia, review R11 lanjutan), dan `fulfillment_attention` = JUMLAH ORDER butuh tindakan (COUNT DISTINCT, tanpa hitung ganda job+item; rincian `fulfillment_attention_by_status`, `fulfillment_jobs_attention` untuk diagnosis); kartu Kesehatan sistem tiga warna (hijau/kuning/merah) + tooltip + legenda. Bot health memaparkan usia antrean tertua + event QRIS. Notifikasi penting WhatsApp ("Pembayaran Diterima") masuk `whatsapp_outbox` idempoten (`UNIQUE idempotency_key`, klaim lease `sending` + `worker_id`/`locked_until`, backoff 1-5-15-60, `dead`, migrasi 0019 rebuild CHECK prod), recovery lease basi oleh runtime (bukan hanya cron, review R10 lanjutan) + `claimErrors` terpisah, dan diproses cron operations 5-menit. Serah terima manual: `POST /api/admin/orders/[code]/handover` (item_index+note, admin-only, 90-hari TTL bukti, review R3 lanjutan) + tombol "Serahkan manual" di OrdersManager. Kesehatan sesi Baileys dinyatakan eksplisit sebagai milik gateway Heroku eksternal (dilaporkan endpoint `/health` gateway), bukan diklaim hijau dari Pages.

**Panel QRIS pending ringkas (2026-10-15, implementasi; publikasi CI):** halaman `/pesanan/[code]` memilih layout compact hanya saat `order.status=pending`, ada invoice QRIS dan order belum kedaluwarsa. Header kecil, container 760px, QR frame 224/240px dan layout dua kolom mulai `sm`; judul/kode dipusatkan pada semua ukuran dengan grid kolom penyeimbang ikon (32px mobile/40px desktop), satu pill pending di atas Total bayar pada mobile maupun desktop (status QR hangus tetap di header semua ukuran); kotak gambar/placeholder tetap persegi dan download tetap `order.qris.image_url`. Info bayar memakai payable_amount/kode unik/expiry yang sama. Ringkasan direuse pada `MobileCollapsible` tertutup untuk pending dan kartu terbuka setelah lunas. CTA berganti label Simpan QRIS/Cek Pembayaran dengan handler/download existing; status polling tetap live, timestamp dipertahankan untuk pembaca layar. Navigasi sekunder dipadatkan, Lacak Status hanya pada status lain. Gate qrisExpired/reissueAllowed, pembatalan berkontak/konfirmasi, interval polling serta panel akun/garansi/auto-scroll tidak diganti; tanpa route/env/migrasi baru.

**Auto-scroll kredensial Market (2026-10-15, implementasi; publikasi CI):** `WrCredentialsPanel` menyimpan ref section hasil dan penanda scroll per kode, menjadwalkan satu `requestAnimationFrame` saat credentials nonkosong terpasang, serta membatalkan frame saat cleanup. Target dihitung dari posisi panel + scroll halaman − jarak navbar 96px, dijepit minimum 0, melalui `window.scrollTo`; smooth/default atau instant/reduced-motion (CSS global smooth tidak dibiarkan menghidupkan animasi kembali). Kedua pemanggil `/pesanan/[code]` dan hasil `/lacak-pesanan` memberi `key={order.code}` supaya state/token/isi akun lama tidak dipakai saat kode berubah. Callback scroll hasil lacak melewati ringkasan jika section isi akun sudah tampil; jika belum, scroll hasil tetap tersedia dan menghormati reduced motion. Tidak ada API/polling/migrasi baru; verifikasi kontak/token server tetap menjadi gate isi akun.

**Proteksi garansi third-party:** `/garansi-replace` adalah acuan tunggal ketentuan layanan & garansi (AXVARA third-party independen, garansi 1x24 jam–30 hari mengikuti deskripsi tiap produk, klaim = penggantian/perbaikan, proses 1–3 hari sesuai antrean/stok/gangguan pihak terkait, solusi refund bila gangguan masih terjadi setelah maksimal 3 hari; tanpa refund otomatis). Checkout mewajibkan checkbox persetujuan sebelum order dibuat; detail produk, footer, dan halaman sukses pesanan menautkan kembali ke halaman tersebut. Revisi 2026-10-16 ✅ implementasi, publikasi CI: `marketWarrantyClaim` di `lib/warranty-policy.ts` memuat `eligibility` dengan teks "pengajuan garansi hanya untuk produk bergaransi", dua bukti wajib (invoice/bukti pemesanan + screenshot), catatan durasi/refund dan penutup. `WarrantyClaimBody` dipakai halaman ketentuan (default `size="sm"`, 14px); accordion memakai `size="xs"` (12px, `leading-relaxed`) agar sama dengan isi S&K/aktivasi sejak revisi 2026-10-16; `WarrantyClaimAccordion` memakai `MobileCollapsible` (tertutup, keyboard/ARIA), dengan `className` opsional untuk jarak saat embedded. `WrCredentialsPanel` merender satu accordion di dalam kartu setelah semua S&K/aktivasi dan sebelum catatan simpan, termasuk di dalam form verifikasi. Kedua halaman Market hanya merender fallback di luar kartu bila lunas dan `credentialsReady=false`, sehingga tidak ada duplikasi. Berlaku retroaktif pada tampilan order lama dan semua supplier, tanpa migrasi/data produk/refund API baru; formatter Telegram/WhatsApp tetap memakai catatan durasi/refund yang sama.

---

## 7. R2 Storage Layout

```
R2 bucket: axvara-assets
├── produk/
│   ├── chatgpt-plus-1bln-abc123.webp
│   └── ...
├── bukti/
│   ├── AXV-20260831-0012-x7k9p2.webp
│   └── ...
├── articles/
│   ├── covers/*.webp
│   └── content/*.webp
└── banners/*.webp
```

- Upload via Pages Function dengan `AWS SDK S3` ke R2 binding
- Nama file: `{order_code}-{random6}.{ext}` untuk bukti
- Content-Type di-set; produk/banner publik dan bukti pembayaran private melalui route admin

---

## 8. Deploy ke Cloudflare Pages

### Wrangler Config (`wrangler.json`)

```json
{
  "name": "axvara",
  "compatibility_date": "2026-08-31",
  "pages_build_output_dir": ".vercel/output/static"
}
```

### Jalur CI/CD

1. `npx wrangler d1 create axvara-db`
2. Database baru: `npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote`; database lama jalankan migrasi `0002`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`
3. `npx wrangler r2 bucket create axvara-assets`
4. Push ke `main`; `.github/workflows/ci.yml` menjalankan test → type-check → build Pages → `wrangler d1 migrations apply` → deploy Pages → deploy MCP Worker
5. GitHub Actions menggunakan Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`; Git integration bawaan Pages tidak menjalankan deployment agar CI/CD tidak ganda
6. Setelah push berhasil, agent berhenti tanpa polling workflow. `npm run deploy`/`deploy:mcp` hanya jalur recovery manual atas instruksi eksplisit
7. Custom domain `axvara.tech` dan `www.axvara.tech` aktif melalui CNAME proxied; `www` memiliki redirect 308 ke apex. DNSSEC Cloudflare aktif dan memerlukan publikasi DS di registrar
8. Secrets Pages: `ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256`, `ADMIN_JWT_SECRET`, `CRON_SECRET`, dan `WHATSAPP_WEBHOOK_TOKEN`; URL service Baileys disimpan sebagai `WHATSAPP_GATEWAY_URL`. Nilai `ADMIN_PASSWORD_SHA256` memakai format PBKDF2/SHA-256; satu pasang quote pembungkus dari paste shell/JSON dinormalisasi sebelum verifikasi. Pada hash PBKDF2, browser membentuk proof HMAC atas challenge JWT berlaku 5 menit; Pages memverifikasi proof secara ringan tanpa menjalankan derivasi PBKDF2 berat.

### Aset statis di luar worker (2026-10-10)

`npm run build:pages` = `next-on-pages` lalu `scripts/patch-pages-routes.js`,
yang menambah `/icons/*`, `/brand/*`, `/og/*`, `/banners/*`, `/favicon.svg`,
dan file verifikasi Google ke `exclude` di `.vercel/output/static/_routes.json`
(bawaan hanya `/_next/static/*`). File itu disajikan CDN langsung tanpa
menyalakan Pages Functions + middleware (dulu ±4.800 request/hari ikut
menghabiskan jatah CPU Workers Free ~10 ms dan bisa kena 1102). Cache +
`nosniff` untuk path tersebut diatur di `public/_headers`. Aturan: hanya file
statis `public/` boleh masuk daftar — jangan path yang punya route dinamis.

Hemat CPU lain (Workers Free, 2026-10-10): `<Link prefetch={false}>` di semua
link storefront/Pedia (prefetch otomatis kartu produk dulu memicu belasan
render RSC per kunjungan beranda); `decideAllWinners` (aksi `pairs` di
`/api/supplier-sync`) kini 1 SELECT agregat + UPDATE hanya baris berubah
(dulu ±9 query × 33 pasangan ≈ 300 round-trip → rutin `exceededCpu`).

### Build Adapter

- Opsi A: `@cloudflare/next-on-pages` (Next.js di Pages Functions)
- Opsi B: Next.js static export + Pages Functions terpisah untuk API
- Rekomendasi MVP: Opsi A untuk DX paling simpel

---

## 9. Keamanan MVP

- Admin auth: JWT httpOnly cookie-only 8 jam + idle JWT HS256 2 jam terikat `sid` yang sama (nilai sembarang ditolak server), refresh aktivitas tervalidasi penuh sebelum memutar idle baru, rotasi password mencabut seluruh sesi lama via claim `av` stateless, Bearer admin tanpa cookie ditolak (integrasi MCP/agent memakai Bearer scope via `requireAgent`, bukan JWT admin), rate limit 5/min
- Upload: cek magic bytes (bukan cuma ext), max 5MB, sanitize filename
- D1: prepared statement, no string concat
- Pembanding rahasia: SEMUA kredensial bearer/HMAC memakai `constantTimeEqual`
  (`src/lib/security.ts`) — webhook DANA, Telegram, WhatsApp, Warung Rebahan,
  DAN cron. Audit 2026-09-20 menemukan `/api/cron/operations` +
  `/api/cron/publish-scheduled` masih memakai `!==` pada bearer `CRON_SECRET`
  (satu-satunya pemegangnya adalah Worker `axvara-mcp`, sehingga bocornya
  secret ini membuka seluruh endpoint operasi); keduanya kini seragam dan
  tetap fail-closed ketika `CRON_SECRET` kosong.
- Waktu tampil (audit 2026-09-20): D1 menulis `datetime('now')` sebagai UTC
  berformat spasi (`YYYY-MM-DD HH:MM:SS`), sedangkan `new Date(nilai)` di JS
  membacanya sebagai waktu LOKAL — di perangkat WIB seluruh timestamp mundur
  7 jam dan tanggalnya salah bila melewati tengah malam. Rumah kanonis untuk
  SEMUA tampilan adalah `formatWibDateTime` (`src/lib/utils.ts`): ia mem-parse
  lewat `parseExpiry` (sumber yang sama dengan cron/webhook) lalu mengunci
  `timeZone: "Asia/Jakarta"` supaya admin dari zona mana pun melihat jam
  operasional toko. Dilarang memformat hasil `new Date(<string timestamp>)`
  langsung di komponen.
- Proteksi trafik & efisiensi query (issue #14, diverifikasi 7 Sep 2026 dari
  docs Cloudflare D1 Limits + WAF rate limiting rules — bukan asumsi):
  - WAF Free TERSEDIA: 1 rate limiting rule, counting IP, periode 10 dtk /
    1 mnt, aksi Block. Klaim lama "WAF tidak tersedia" salah. Rule ke-1
    TERPASANG 7 Sep 2026 via API (ruleset "AXVARA API rate limit",
    `dff7ff5c17e34a97ac13b3264ca6a916`): `(http.request.uri.path wildcard
    r"/api/*")`, 100 request / 10 dtk / IP → Block 429 selama 10 dtk.
    Mencakup checkout/quote/upload/login sekaligus tanpa menambah rule.
    Batas Free yang memaksa bentuk ini: period hanya boleh 10 dtk dan
    characteristics wajib `cf.colo.id + ip.src` (API menolak period 60 dan
    `ip.src` saja). Verifikasi: GET entrypoint `http_ratelimit` = 1 rule enabled.
  - In-memory `src/lib/rateLimit.ts` hanyalah lapis kedua (defense in depth
    per isolate, bukan proteksi DDoS global): checkout:orders 10/mnt,
    checkout:quote 20/mnt, proof:upload 5/mnt, upload:admin 20/mnt,
    orders:lookup 20/mnt, auth:login 5/mnt, newsletter:subscribe 5/mnt, semua
    429 + `Retry-After: 60`. IP anti-spoof: `cf-connecting-ip` utama,
    fallback hanya `x-real-ip`; `x-forwarded-for` TIDAK dipakai (spoofable).
    Tidak ada ketergantungan eksklusif pada counter per-isolate — WAF adalah
    lapis pertama yang global.
  - Lapis ketiga khusus pembuatan order (27 Okt 2026, insiden flood order
    fiktif): limiter durable D1 `checkout_attempts` (migrasi 0079) bersama
    Market+Pedia — 5 order baru/IP, 3/WA, 3/email per 15 menit, hash saja.
    Inilah lapis yang menahan script lintas-isolate dengan kontak berputar;
    retry checkout yang sama dikecualikan. Kontrak penuh di bagian
    "Pembatas order fiktif durable" di atas.
  - Batch cron operations (RR5-02/03, 9 Sep 2026): `createBudgetedDatabase`
    di `src/lib/db-access.ts` menangkap satu binding D1 untuk seluruh call tree
    invocation. Batas 40 statement, termasuk setiap anggota batch dan query
    yang gagal; dua statement khusus disisihkan untuk checkpoint fase.
    Wrapper menolak query/batch sebelum dispatch bila melewati batas, tanpa
    mengganti `globalThis.DB`. `query_budget_used` adalah jumlah statement
    yang diajukan; batch yang rollback dihitung penuh secara konservatif,
    sehingga dapat lebih besar dari jumlah statement yang sempat dieksekusi.
    `cron_phase`/`cron_deferred` menentukan urutan eksekusi nyata. Expiry
    memakai sinyal pending/init-basi/manual-WA terpisah; initializing tanpa
    pending lain tetap dipulihkan. `publish-scheduled` tetap cadangan order
    tanpa ledger. Helper expiry, invoice/notifikasi Telegram, dan outbox WA
    memakai binding berbudget yang sama.
    Pemulihan orphan hanya membaca order dan membuat/membaca job (3 query).
    Materialisasi dibatasi dua baris baru per job/run, membaca produk hanya
    untuk baris yang belum ada. Baris tersimpan adalah checkpoint materialisasi;
    `item_cursor` (migrasi 0022) menyimpan posisi pengiriman. Admission sebelum
    provider menyisihkan biaya jalur gagal dan finalisasi (frame 6; shared/manual
    sampai 8, unique sampai 12 statement). Yield normal mengembalikan job
    queued tanpa menambah attempt; attempt job bertambah saat ada kegagalan.
    `AUTO_FULFILLMENT_ENABLED=false` tetap mengisi item untuk admin secara
    bertahap tanpa mengirim; pemindaian hanya memilih job yang masih kekurangan
    baris agar job lengkap tidak menahan antrean berikutnya. Ini batas kerja per invocation, bukan janji
    throughput atau durasi pemulihan antrean. Bukti dan durasi simulasi:
    [laporan RR5](REVIEW-ROUND5-EXECUTION-2026-09-09.md).
  - **Deadline wall-clock + poison-pill guard (18 Sep 2026, live).** Budget D1
    tidak membatasi waktu tunggu jaringan, dan penanda fase dulu hanya ditulis
    di ekor handler. Akibatnya (insiden 17–18 Sep): satu run merangkai
    banyak panggilan luar (notify sampai 14 × 10 s Telegram/WA, fase WR
    order + `/transactions` + `/products` + `/balance`), mencapai wallTime
    ~125 s, dipotong platform (`outcome: canceled`, cpuTime hanya ~175 ms),
    lalu run berikutnya membaca fase yang sama dan mengulang pekerjaan berat
    yang sama tiap 5 menit. `cron_phase` beku di `warung_rebahan` sejak
    17 Sep 13:06 UTC dan baris `trigger='cron'` terakhir di `wr_sync_log`
    adalah 17 Sep 11:37 UTC — sync otomatis WR mati ~16 jam meski cron
    tetap dipanggil dan auth benar. Dua obatnya: (1) `writeCronPhase`
    dipanggil DI AWAL run (fase dimajukan + `cron_deferred` dikosongkan)
    sehingga run yang mati tidak bisa mengunci rotasi; ekor menimpa dengan
    nilai final saat run selesai normal. (2) Deadline lunak
    `RUN_DEADLINE_MS = 45_000`: setiap unit kerja jaringan (batch Telegram,
    outbox WA, item fulfillment, tiap langkah WR) hanya dimulai bila sisa
    waktu cukup, sisanya menjadi `deferred` jujur untuk run 5 menit
    berikutnya. Respons cron menyertakan `run_duration_ms` +
    `run_deadline_ms`. Timeout API WR juga diturunkan 30 s → 12 s
    (`WR_API_TIMEOUT_MS`); referensi: sweep katalog penuh 48 produk ~10 s
    total termasuk ~250 statement D1 (`wr_sync_log.duration_ms`).
  - **Lease pengiriman kredensial WR + guard zero-missing (18 Sep 2026, live).**
    `processCredentialDelivery` kini MENYIMPAN lease-nya
    (`delivery_next_attempt_at`, 2 menit) dan
    `recoverStaleCredentialDeliveries` mengembalikan baris `sending` yang
    lease-nya habis ke `failed` agar masuk antrean lagi dengan backoff;
    hitungan antrean cron ikut memasukkan baris tersebut. Sebelumnya lease
    dihitung lalu dibuang dan recovery hanya memungut `('queued','failed')`,
    sehingga run yang dibunuh meninggalkan pengiriman menggantung permanen
    (bukti prod: link `AXV-20260917-0D35043E` di `sending` sejak 17 Sep).
    Sekalian ditutup: delivery web menganggap `issueCredentialToken()`
    bernilai `null` sebagai gagal padahal `null` juga berarti "token valid
    sudah ada" — membuat SETIAP retry web pasti gagal; sekarang dibedakan
    lewat `hasValidCredentialToken()`. Di `syncProducts`, zero-missing hanya
    berjalan bila sweep dimulai dari awal daftar dalam run itu
    (`startAt === 0`); tanpa syarat ini run lanjutan dari cursor lolos
    sebagai "sweep penuh" dan me-nol-kan stok varian yang tidak pernah
    dilihatnya (terbukti 4 varian pada test regresi).
  - Recovery sending basi WA mandiri (RR3-06): gerbang cron =
    pending/failed > 0 ATAU sending-lease-kedaluwarsa > 0 (COUNT sendiri),
    sehingga antrean yang seluruhnya sending basi tetap dipulihkan via
    entrypoint cron. Lease aktif tidak pernah dicuri.
  - Notifikasi Telegram per jenis (RR3-09): antrean created / paid buyer /
    paid admin dihitung terpisah (bukan hanya marker order-created);
    `retryPendingTelegramNotifications(limit, {created,paid,paidAdmin})`
    hanya membayar SELECT ke jenis yang antre.
  - Retry foto invoice Telegram (RR3-05, migrasi 0021):
    `orders.telegram_invoice_sent_at` (NULL = belum terbukti sampai) +
    `telegram_invoice_attempts` (maks 5). Checkout menandai pending
    sebelum sendPhoto dan sent hanya bila {ok:true}; {ok:false} melempar
    agar update failed + 500 (redelivery nyata) dan stok/reservasi
    DIPERTAHANKAN untuk invoice aktif. `retryTelegramInvoiceDelivery`
    mengirim ulang foto yang SAMA (nominal/expiry dari ledger, caption
    dari DB) tanpa order kedua; cron menyapu ≤2 invoice/run dalam budget.
    Semantik jujur: Telegram tidak memberi exactly-once untuk sendPhoto —
    retry dibatasi + dideduplikasi marker DB + guard double-tap order.
    Sejak 2026-11-03 (insiden API Telegram lambat → 3 foto QRIS sama):
    sendPhoto memakai timeout 25 detik; hasil AMBIGU (timeout/jaringan,
    tanpa `error_code` Telegram) TIDAK dilempar/dikirim ulang — marker
    ditandai sent dan satu teks cadangan berisi link QRIS yang sama
    dikirim (`settleAmbiguousInvoiceSend`). Hanya penolakan pasti
    Telegram (ada `error_code`) yang memakai retry di atas; berlaku juga
    untuk Cek Pembayaran dan perpanjangan QRIS di `handlers/orders.ts`.
  - Handover manual dan agregasi (RR5-01/04/05/07/08):
    `fulfillmentLineMismatches` memeriksa item_index, product_id, variant_id,
    serta qty integer positif yang harus persis sama, termasuk qty berlebih.
    Kontrak yang sama dipakai cron dan seluruh cabang handover/recovery.
    Mismatch ditahan sebelum pengiriman otomatis dan tidak diperbaiki dengan
    mengarang qty baru pada item delivered. Handover mengembalikan 409
    `handover_incomplete` bila rincian belum cocok, dan 409
    `handover_recovery_pending` bila penulisan lanjut belum pulih; error
    tak terduga menjadi 500, bukan sukses hanya berdasarkan satu status item.
    Audit memakai substring literal `instr` (kompatibel dengan batas pola D1).
    Identitas audit per order/item stabil; pelaku/waktu diambil dari fakta
    `manual_handover` milik request pemenang CAS, juga pada retry admin berbeda.
    Catatan legacy dipertahankan; bila fakta pelaku tidak tersedia, recovery
    menandainya sebagai legacy, bukan mengaku admin retry sebagai penyerah.
    Respons sukses memisahkan `item_status`, `fulfillment_status`, dan `complete`.
    UI selalu POST pemulihan saat semua item telah delivered; toast sukses
    akhir memerlukan konfirmasi status bisnis delivered, termasuk cabang
    beberapa item. Mutasi order/job dilakukan dalam satu batch D1 saat lease
    masih dimiliki, kemudian lease dilepas tanpa write lanjutan. Settlement
    inventory unique/item juga atomik dan berpagar lease. Cron menyapu split
    historis job delivered/order tertinggal tanpa mengirim kredensial lagi.
    `processJob` D1 mendelegasikan ke `processJobItems`; flag WhatsApp false
    mengarahkan ke manual di kedua entrypoint. Proof hold tetap menghalangi
    pengiriman otomatis WA pada rail manual ketika diaktifkan. Fallback dev
    tanpa D1 tetap memakai jalur legacy in-memory.
  - Revokasi sesi fail-closed (RR3-04): `readRevokedVersionFromStore`
    melempar kegagalan baca (bukan `.catch(() => null)` menjadi versi 0);
    `sessionBumpFor` mengembalikan -2 → `expectedAuthVersion` tak
    mungkin-cocok → requireAdmin/refresh MENOLAK sesi logout saat store
    revokasi tak terbaca, tanpa mutasi dan tanpa token baru.
  - Fencing worker menyeluruh (RR3-08): kepemilikan lease melindungi
    SELURUH mutasi turunan processJob (job + agregat order + error) — bila
    job bukan retry milik sendiri (lease hilang), worker lama berhenti
    sebelum menyentuh order. Order campuran tetap `manual_required`
    (guard `NOT IN ('delivered','manual_required')`, bukan daftar
    pengecualian baru).
  - Agregat fulfillment berpagar lease (review R4 lanjutan 2026-09-08):
    `processJob` menulis parent (delivered/retry) hanya bila `locked_until`
    miliknya masih berlaku (`scheduleRetryFenced`); worker basi yang kembali
    membawa kegagalan mendapat 0 row — job/item/order TETAP delivered.
  - Klasifikasi error webhook di `src/lib/telegram/webhook-errors.ts` (bukan
    di route — validator Next.js menolak field export tambahan; R5-fix
    2026-09-08): transient-by-cause (jejak jaringan selalu transient
    termasuk TypeError fetch; bug tipe murni permanen; default transient).
  - N+1 dihapus: quote memakai 2 query `IN` (produk + varian) untuk berapa
    pun item; expiry cron JOIN order dalam 1 query; keranjang Telegram 1 JOIN
    varian + 1 DELETE batch; PDP memakai `?slug=` exact (1 baris) dan related
    `?cat=` kategori sama (hanya yang bisa dibeli — stok habis TIDAK PERNAH
    tampil di Produk Serupa, kontrak 2026-10-01; filler katalog lain hanya
    bila kategori sama < 4, hemat rows-read) — tidak ada lagi fetch seluruh
    katalog per halaman.
  - Batas D1 yang dipatuhi kode: 100 bound parameter/query (batch IN
    dipotong), LIKE max 50 byte (pola search dipotong 40 char).
- CSP header via Next.js middleware
- Jangan commit `.env`, `wrangler.toml` dengan secrets — pakai Pages Variables
  - R3 (lokal, 4 Nov 2026) kirim invoice rail baru (gateway/crypto): view status
    tersimpan dirender sebagai TEKS (bukan foto QRIS). `showProviderInvoiceStatus`
    mengembalikan hasil kirim; view live (detail crypto / prompt konsen fee /
    detail gateway) dengan ok:true menandai `telegram_invoice_sent_at`. Penolakan
    pasti (ada `error_code`) tetap pending untuk `retryTelegramInvoiceDelivery`
    (ceiling 5, selektor cron yang sama diperluas ke nowpayments/sekalipay_gateway;
    klaim CAS pada `telegram_invoice_attempts`; render `savedOnly` tanpa
    GET/POST/re-quote/reservasi). Hasil ambigu (tanpa error_code) diselesaikan
    sekali: marker + nudge same-order tanpa nominal/alamat/link, tidak dikirim ulang.
    Reminder rail baru: teks generik saved-locale + tombol refresh. Batas: notifikasi
    PUSH kedaluwarsa/batal untuk rail baru belum ada (QRIS_EXPIRY_NOTICE_WHERE dibagi
    dengan probe antrean cron operations; perlu perubahan terpisah); pembeli melihat
    teks kedaluwarsa generik saat membuka/refresh. Dev/test lokal, belum publik.

---

## 10. Observability & Next Step

- Cloudflare Web Analytics (gratis, privacy-friendly) untuk traffic
- D1 + R2 metrics di dashboard Cloudflare
- P1: tambah logging terstruktur + alert WA jika error rate naik

---

## 11. Estimasi Biaya

| Item | Free Tier | Estimasi MVP |
|------|-----------|-------------|
| Pages | 500 builds/bulan, unlimited bandwidth | Rp 0 |
| D1 | 5GB storage, 5M reads/hari | Rp 0 (ratusan produk + ribuan order aman) |
| R2 | 10GB, 10M reads/bulan | Rp 0 |
| Domain utama axvara.tech | Dibeli terpisah; DNS/SSL Cloudflare gratis | Biaya registrar tahunan |
| Hostname Pages bawaan axvara.pages.dev | Gratis; redirect ke axvara.tech | Rp 0 |
| **Total infra** | | **Rp 0/bulan** |

Jika melebihi free tier (misal 100k order/bulan): D1 $5/bulan, R2 $0.015/GB — masih sangat murah.

---

## 12. Editorial CMS dan Remote MCP

Artikel memakai `status` sebagai sumber kebenaran (`draft`, `review`, `scheduled`, `published`, `rejected`); `is_published` dipertahankan selama migrasi kompatibilitas. Slug dan excerpt dibuat server-side dari judul/konten dan tidak menjadi field editorial. Editor visual Tiptap menyimpan Markdown sebagai format kanonis; renderer token-based tidak mengeksekusi raw HTML dan tetap membaca JSON Tiptap lama. Konten agent hanya boleh membuat atau memperbarui Draft, wajib menyertakan sumber, idempotency key, dan audit trail.

Migrasi database lama: jalankan sekali dan berurutan `drizzle/migrations/0002_editorial_agent.sql`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`. Database baru memakai `drizzle/schema.sql`.

Agent Content API berada di `/api/agent/*` dan memvalidasi Bearer token yang di-hash dalam `agent_tokens`; ia adalah satu-satunya jalur bagi agent ke D1/R2. Scope tersedia: `context:read`, `articles:read`, `articles:write`, `articles:submit`, `articles:schedule`, `articles:publish`, `media:write`, `audit:read`. `/api/agent/media` menerima file WebP multipart dari agent yang dapat membaca filesystem lokal, sedangkan `/api/agent/media/import` mengambil WebP dari URL HTTPS publik untuk agent berbasis remote URL.

Route Edge `/mcp` adalah endpoint Streamable HTTP JSON-RPC utama dan ikut deployment Pages, sehingga tidak membutuhkan service tambahan. URL publik tunggalnya `https://axvara.tech/mcp`; hostname `axvara.pages.dev` diarahkan permanen ke domain utama dan tidak menjadi endpoint client. Ia meneruskan tool ke Content API internal dan tidak memberi agent akses D1/R2 langsung.

`mcp-worker/` adalah gateway cron aktif di `https://axvara-mcp.sailinnadia1.workers.dev/mcp` dan memakai `https://axvara.tech` sebagai origin Content API. `upload_article_image` tetap menerima base64 WebP untuk payload kecil. Jalur utama yang tahan terhadap batas JSON client adalah `import_article_image_from_url`; server membatasi sumber ke HTTPS publik tanpa kredensial/custom port/IP literal, memvalidasi ulang maksimal tiga redirect, membatasi respons 5 MB saat streaming, dan memeriksa WebP melalui header serta magic bytes sebelum menyimpan ke R2. File lokal memakai multipart Content API karena remote MCP tidak dapat membaca path filesystem milik agent. Konversi PNG/JPG dilakukan oleh agent sebelum upload agar runtime tetap ringan. Deploy dari root:

```bash
npm run deploy:mcp
```

Konfigurasi client menggunakan header `Authorization: Bearer ${AXVARA_AGENT_TOKEN}`. Raw token hanya dikembalikan sekali ketika admin membuatnya.

Trigger `*/5 * * * *` pada MCP Worker memanggil `/api/cron/publish-scheduled`. Set nilai acak yang sama sebagai secret Pages `CRON_SECRET` dan Worker `AXVARA_CRON_SECRET`; jangan simpan nilainya di Git.

**Cron operations dipecah satu fase per request (live 2026-10-04, Workers Free plan).** Insiden 3 Okt 2026 13:25–16:50 UTC (20:25–23:50 WIB): 41 run beruntun `/api/cron/operations` dibunuh runtime Pages dengan `exceededResources` → HTTP 503 (CPU 10–20 ms, durasi ~0,3 dtk) karena satu request memikul expiry + fulfillment + sync WR 49 produk + sync SK ~160 varian + notify + cleanup. Heartbeat `cron_last_hit_at` tetap segar (ditulis di depan handler) sementara `wr_sync_log`/`cron_deferred` di ekor tak pernah tertulis, dan Worker membuang status respons sehingga tak ada alarm. Kontrak baru:

- `mcp-worker/src/cron.ts` `runOperationsTick()` memanggil `POST /api/cron/operations?phase=<fase>` **berurutan** untuk `expiry → fulfillment → warung_rebahan → sekalipay → notify → cleanup` (satu request = jatah CPU sendiri). Fase gagal tidak menghentikan fase berikut.
- `?phase=` menjalankan TEPAT satu fase: tanpa rotasi/deferred/anti-starvation, tidak menulis `cron_phase`/`cron_deferred`, dan menulis penanda run selesai `store_settings.cron_last_ok_at` di ekor. Nama fase tak dikenal → 400 `invalid_phase`. Tanpa `?phase=` perilaku rotasi lama tetap (pemanggilan manual/kompatibilitas).
- Sync katalog dipotong kecil: WR 10 produk, SK 25 varian per request. Respons `more: true` bila potongan berhenti di plafon (cursor tersimpan); Worker mengulang `?phase=…&continue=1` (hanya sync — order/reconcile/delivery/saldo tidak diulang) maks 10 potongan/fase/tick, sehingga satu putaran penuh selesai dalam satu tick.
- Interval putaran katalog WR/SK **15 menit** (dulu 30). Ambang kode `CATALOG_SYNC_INTERVAL_MS` = **14 menit** (sejak 4 Okt): log sync ditulis beberapa detik setelah tick mulai, jadi ambang 15 menit membuat putaran nyata tiap 20 menit (terukur 05:20 → 05:40 WIB). Cursor > 0 tetap melanjutkan tanpa menunggu interval.
- Alarm: bila ada fase gagal (non-2xx / fetch gagal), Worker mengirim pesan ke `TELEGRAM_ADMIN_CHAT_ID` hanya pada tick menit kelipatan 30 (stateless, maks 2 pesan/jam selama insiden). Butuh secret Worker `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` (nilai sama dengan Pages); tanpa keduanya alarm dilewati diam.
- Cara baca: `cron_last_hit_at` segar + `cron_last_ok_at` basi = request dibunuh di tengah (CPU/`exceededResources`); keduanya basi = pemicu Worker mati. Bukti platform: Cloudflare GraphQL `pagesFunctionsInvocationsAdaptiveGroups` status `exceededResources`.
- Tradeoff: ±10–15 request Pages per tick (bukan 1) — tetap jauh di bawah kuota 100k/hari; batas CPU per fase belum diukur per fase, jadi bila `exceededResources` masih muncul langkah berikutnya adalah memindah diff katalog ke VPS proxy.

**Revisi 2026-10-04 pagi (insiden 02:00–05:20 WIB: request fase WR/SK gabungan order+sync masih `exceededResources`, 24–30/jam):**

- Fase WR/SK dibelah `part=orders` (recover klaim, teruskan order lunas, reconcile, kirim kredensial/email, saldo; respons `*_sync_skipped="part_orders"`) dan `part=sync` (katalog saja + watchdog sync basi; pemenang pasangan WR vs SK dihitung sekali saat sweep SK tuntas). `part` lain / fase lain → 400 `invalid_part`. Urutan Worker per tick: `expiry → fulfillment → WR orders → SK orders → notify → WR sync (potongan) → SK sync (potongan) → cleanup` — order lunas tetap diteruskan walau sync kena limit.
- **Potongan katalog dari proxy VPS (tanpa state):** mode `?phase=` memanggil `syncProducts`/`syncSkProducts` dengan `useProxySlices`. Proxy `POST /wr/products-slice` dan `GET /sk/catalog-slice` mengambil katalog penuh, mengurutkan dengan aturan yang SAMA dengan sync Pages, lalu mengembalikan potongan (WR ~13 KB vs 71 KB; SK ~26 KB vs 93 KB). SK mode potongan selalu scope penuh kategori (tanpa delta `updated_since`). Potongan terakhir membawa `meta.all_variant_ids` (seluruh id varian upstream/scope saat itu) → zero-missing kini berjalan aman di akhir sweep berpotongan (sejak 3 Okt malam sweep berpotongan tidak pernah zero-missing). Proxy lama/mode langsung (404/405) → fallback fetch penuh. Kontrak proxy: `axvara-wr-proxy/AGENTS.md`.
- **Penanda langkah:** mode `?phase=` menulis `console.log("[cron] <fase>[:part][:cont] step=<langkah> t=<ms>")` (auth_ok, phase_state, watchdog_done, queues_counted, wr_import_*, wr_recover_done, wr_orders_done, wr_sync_done, wr_tail_done, sk_*, phases_done) tanpa D1. Request yang dibunuh: `wrangler pages deployment tail <deployment-id> --project-name axvara --format json` memperlihatkan langkah terakhir yang sempat jalan.
- **Alarm ber-state (Workers KV `axvara-cron-state`, binding `CRON_STATE`, key `cron_alarm_v1`):** 1 pesan saat gangguan mulai (2 tick gagal beruntun), pengingat tiap 6 jam bila masih gagal, 1 pesan `✅ Cron AXVARA pulih` setelah 3 tick sukses beruntun (beserta durasi). KV hanya ditulis saat transisi (hemat kuota tulis gratis 1.000/hari). Telegram gagal saat alarm mulai → dicoba lagi tick berikut. Tanpa binding KV → fallback stateless :00/:30. Watchdog "Sync basi" tetap jadi cadangan.

**Sync katalog DIFF dari VPS (live 2026-10-04 siang).** Penanda langkah 4 Okt 10.15 WIB membuktikan potongan 10 produk tetap dibunuh `exceededCpu` saat platform ketat: `warung_rebahan:sync` mati SETELAH `phases_done` (route cron raksasa ±1 dtk hanya untuk menyala + kerja per produk), `sekalipay:sync` mati di tengah sweep. Kontrak baru:

- VPS (`axvara-wr-proxy/src/diff-sync.ts`) tiap **3 menit** mengambil katalog WR + SK (scope `Aplikasi Premium`), membandingkan hash per produk WR / per varian SK dengan snapshot TERKONFIRMASI (file `state/diff-state.json` di VPS), lalu `POST /api/supplier-sync` HANYA entitas berubah + `removed_variant_ids`. Potongan maks 8 produk WR / 20 baris SK (dibagi dua tiap gagal, naik lagi saat sukses). Snapshot maju hanya untuk entitas yang dibalas 2xx. Katalog kosong → siklus dilewati; penghapusan >50% → ditahan (sweep pengaman yang memutuskan). Heartbeat kiriman kosong tiap ≤6 mnt. Setelah SK berubah → request terpisah `{supplier:"sk",action:"pairs"}` menghitung ulang pemenang WR vs SK.
- `src/app/api/supplier-sync/route.ts` (edge, impor minimal, tanpa fase/budget cron): header `x-supplier-sync-token` = secret Pages `SUPPLIER_SYNC_TOKEN` (konstan-waktu; kosong → 503). Batas 10 produk WR / 30 baris SK / 200 id dihapus (413). Menerapkan lewat `syncProducts`/`syncSkProducts` opsi `applyOnly` (logika tulis/markup/restok/agregat yang SAMA, tanpa fetch/cursor/server_time/zero-missing penuh; varian dihapus → `zeroVariantsByIds`/`zeroSkVariantsByIds`). Tiap penerapan (termasuk heartbeat) menulis `*_sync_state.diff_last_at`; penerapan yang benar-benar mengubah sesuatu menulis juga `diff_last_change_at` + `diff_last_change` (JSON produk/varian/stok/harga/dihapus), error → `diff_last_error`. **Sejak 4 Okt 12.40 WIB diff TIDAK menulis `*_sync_log`** — log khusus sweep penuh berpotongan + manual (dulu heartbeat 0/0 dan delta 1 varian menutupi kartu admin). `GET /api/admin/{warung,sekalipay}/sync-log` mengembalikan `diff` (`src/lib/supplier/diff-status.ts`, sehat = `diff_last_at` < 10 mnt); kartu "Sync terakhir" (`src/components/admin/SupplierSyncStatus.tsx`) menampilkan Diff VPS (cek + perubahan terakhir) · Sync penuh (cadangan 60 mnt) · Manual. Watchdog sync basi WR (90 mnt) memakai `diff_last_at` bila log sweep tampak basi tapi diff sehat.
- Cron: selama `diff_last_at` < 10 mnt, sweep berpotongan turun menjadi PENGAMAN tiap 60 mnt (diukur dari `*_sync_state.products_full_sweep_at`, ditulis tiap sweep penuh tuntas); diff basi → otomatis kembali 14 mnt. Alarm Worker: kegagalan langkah `:sync` baru dialarmkan setelah 6 tick beruntun (30 mnt); langkah lain tetap 2 tick.
- Kesegaran: perubahan stok/harga supplier tampil ±3–6 mnt. Panggilan supplier ±480/hari masing-masing (setara skema potongan).

## 13. Bot Telegram + DANA Dynamic QRIS + Fulfillment

Implementasi native TypeScript di codebase AXVARA. Repo `mocasus/telegram-auto-order-bot` hanya referensi UX; tidak ada dependency, subtree, atau source copy.

### Arsitektur

- **Bot:** Webhook di `POST /api/telegram/webhook`, bukan long polling. Wrapper `fetch` kecil atas Telegram Bot API tanpa framework.
- **Payment:** `src/lib/payments/dana-qris.ts` mengubah payload merchant DANA Business menjadi EMVCo dynamic QRIS, menyuntikkan nominal unik, dan menghitung ulang CRC16. Tidak ada API/payment gateway pihak ketiga.
- **Authority:** QRIS Hook Android mengirim JSON ke `POST /api/webhook/dana` dengan `X-Webhook-Secret`. Event dideduplikasi dan hanya nominal persis dari satu invoice DANA aktif yang dapat melunasi order.
- **Setup Android:** gunakan URL publik `https://axvara.tech/api/webhook/dana`, isi field secret aplikasi dengan nilai rahasia Pages Secret `DANA_WEBHOOK_SECRET` (bukan teks nama variabel tersebut), aktifkan Notification Access + merchant DANA + QRIS Hook Active, dan matikan Debug Mode agar delivery tidak dilewati. Admin menampilkan URL kanonis, nama header, health, dan event masuk tanpa mengekspos nilai secret.
- **Fulfillment:** AES-256-GCM via WebCrypto, fingerprint SHA-256 untuk deduplikasi. Tiga mode: `manual`, `shared`, `unique`. Outbox pattern dengan `fulfillment_jobs` (per order, kompatibilitas) + `fulfillment_items` per (order, item) sejak migrasi 0015: setiap item punya status/mode/penerima sendiri, order selesai hanya setelah seluruh item terminal sukses.
- **Rekonsiliasi:** `POST /api/cron/operations` menangani stale initializing, order QRIS yang mencapai batas akhir, due jobs, stale locks, serta retry notifikasi order/paid Telegram dan order/paid-admin WhatsApp. DANA tidak menyediakan status polling; webhook adalah authority pembayaran. **ACC manual QRIS (2026-10-01):** bila hook gagal total (tidak ada event) padahal dana benar masuk, admin ACC dari baris Pesanan — `PATCH /api/admin/orders/[code]` dengan `action:"paid_qris"` memakai `transitionPendingPaymentToPaid` yang SAMA dengan webhook (ledger + job + `ensureFulfillmentForPaidOrder` + link WR/SK + notif WA), catatan mutasi wajib + `[ACC-QRIS manual email]` di admin_note.
- **Notifikasi Telegram:** order Telegram mengirim notifikasi grup `TELEGRAM_ADMIN_CHAT_ID` segera setelah ledger QRIS terbentuk. Kolom marker idempoten pada `orders` mencegah duplikat. Setelah QRIS Hook mengubah order menjadi `paid`, buyer otomatis menerima pesan berhasil tanpa menekan cek status; untuk fulfillment manual pesan yang sama baru meminta nomor WA dan menampilkan kontak admin.
- **Menu perintah, bahasa & mata uang (2026-11-12, implementasi lokal):** `setMyCommands` (`src/lib/telegram/api.ts`) mendaftarkan `/start`, `/katalog`, `/cari`, `/cart`, `/orders`, `/pesanan`, `/bantuan`, `/garansi`, `/bahasa`, dan `/currency`. `/chatid` dihapus sehingga bot tidak lagi membalas ID grup. `/bahasa` dan tombol **🌐 Bahasa / Language** pada `homeKeyboard` membuka pemilih `lang:id`/`lang:en` existing lewat callback `langmenu`; pemilihan memakai callback `lang:` lama. `/currency` tanpa argumen dan tombol **💱 Mata Uang / Currency** membuka `currencyKeyboard` lewat callback `curmenu`, menampilkan nilai tersimpan secara jujur (`null` = belum dipilih; render-prefs tetap memakai IDR), dan pemilihan memakai callback `cur:` lama. Locale dan display currency independen: `cur:` tidak mengubah locale, `lang:` tidak mengubah currency, dan keduanya tidak mengubah total/charge order. Membuka atau menyimpan pemilih tidak mengubah `pending_action`/sesi order. Refresh registry dapat memakai `POST /api/admin/telegram/setup` atau operasi admin `setMyCommands` langsung. Pada 12 November 2026, registry produksi diperbarui langsung dan `getMyCommands` mengembalikan 10 perintah identik termasuk `/currency`, tanpa `/chatid`; URL webhook tetap, tanpa pesan dikirim. Bukti registry bukan bukti deployment handler/pemilih baru.

- **Paritas pengiriman Telegram = Web (2026-10-04, laporan owner Prime Video SK):** pesan lunas Telegram memakai profil per order `telegramPaidDeliveryProfile` (`src/lib/telegram/order-notifications.ts`, dari varian tiap baris lewat `buyerDeliveryKind` — BUKAN snapshot `fulfillment_mode`, yang selalu `manual` untuk WR/SK): `instant` (stok sendiri shared/unique, WR restock, SK auto) → "dikirim otomatis ke chat ini"; `queued` (WR MBO / SK non-auto) → pesan tunggu Made By Order maks 12 jam + janji kirim OTOMATIS ke chat ini; `manual` (baris diserahkan admin) → teks lama + minta WA cadangan (HANYA untuk baris manual lokal). Kredensial supplier ke chat pribadi pembeli memakai satu template `supplierCredentialMessage` (`messages/status.ts`): WR via `deliverTelegramCredential` (pipeline `wr_order_links.delivery_*` lama), SK via `deliverSkCredentialToBuyer` → `sendSkCredentialTelegram` (`src/lib/sekalipay/deliver.ts`, idempoten `telegram:sk-credential:<order>:<item>` di `buyer_notice_log`) — dipanggil `handleSkOrderCompleted` + reconcile cron `reconcilePendingSkCredentialEmails` (kini juga Telegram; baris yang pasti tak terkirim — web tanpa email / Telegram tanpa chat pribadi — tidak dipungut). Private-only tetap: order dari grup tanpa START tidak pernah dikirimi kredensial ke id grup; saat pembeli START, `ensurePrivateRecipient` mengantrekan ulang delivery WR `no_private_telegram_chat` (attempt di-reset) dan reconcile SK mengirim di run berikutnya. Webhook miss: SK punya `reconcileFreshSkOrders` (link processing 2 mnt–1 jam, maks 3/run, cron fase SK langkah 3a); WR fresh dibatasi <1 jam (maks 6), reconcile stuck WR/SK `ORDER BY RANDOM()` agar antrean MBO panjang tidak menyumbat. `notifyBuyerSkProcessing` tidak dikirim ke Telegram (dulu bocor kata "Pemasok" + "email ini") dan dilewati bila item SK sudah terkirim; kabar saldo habis WR/SK tidak lagi menyebut pemasok.
- **Salinan email pembeli Telegram (2026-11-04, keputusan owner):** `telegramEmailCopyTarget` (`src/lib/telegram/email-copy.ts`) mengembalikan `orders.customer_email` hanya untuk order `sales_channel='telegram'` non-Pedia dengan email valid DAN minimal satu baris wajib email (`needsEmailForVariant`, data sama dengan `readCheckoutEmail`); gagal baca = null. Bila berhak, setelah DM Telegram sukses jalur kirim juga mengirim email yang sama dengan web: non-WR `sendItem` → `sendWebDeliveryEmail` (kunci `email:fulfillment-item:<id>`), WR `processCredentialDelivery` → `deliverWebCredentialViaEmail`, SK `deliverSkCredentialToBuyer` → `sendSkCredentialEmail`; `sendToBuyer` (notify-buyer) mengirim salinan `email:<refKey>` untuk semua kabar (serah terima, gagal kirim, bukti) dan opsi `emailOnly`; `ensureFulfillmentForPaidOrder` → `followUpTelegramEmail` mengirim tanda terima email-only bila tidak semua baris terkirim otomatis + emailnya terkirim (DM lunas tetap `notifyTelegramBuyerPaid`, tanpa ping admin web). DM tetap otoritatif: kegagalan email tidak mengubah status/retry DM; belum ada retry cron khusus email salinan non-WR/SK.
- **Self-heal kredensial WR lama (2026-10-04, F111FD64):** cron fase WR `repairUnboundCompletedWrLinks` memungut link `completed` yang belum terikat item (≤14 hari, maks 2/run), menarik ulang `/transactions` dan memanggil `handleWrOrderCompleted` (formatter baru + bind + settle) tanpa kirim ulang; tidak ada di upstream → `last_error=repair_tx_missing` (tidak dipungut lagi).
- **Fallback kredensial Telegram (2026-10-04, permintaan owner):** WR + SK + tombol ambil ulang memakai `src/lib/telegram/credential-delivery.ts`: `sendTelegramCredential` mencoba target berurutan `telegram_users.chat_id` → `orders.telegram_user_id` (jalur yang sama dengan produk stok sendiri) → `orders.telegram_chat_id` bila pribadi, sampai satu berhasil; id grup tidak pernah dipakai; semua gagal → throw (WR backoff 1/5/15/60 mnt, SK reconcile dengan backoff 10 mnt). Tombol **📦 Ambil Detail Produk** (callback `cred:<kode>`, ownerBound: pemilik + chat pribadi) di pesan lunas + status order lunas mengirim ulang semua `fulfillment_items.delivered_ciphertext` (WR/SK/stok sendiri/serah terima admin) ke chat bot; belum siap → pesan tunggu. Interaksi pribadi pembeli (`ensurePrivateRecipient`) mengantrekan ulang SEMUA delivery WR Telegram yang `failed` (attempt reset) dan melepas backoff kirim SK yang gagal.
- **Katalog Telegram memfilter pecundang pasangan WR/SK (2026-10-04):** `notLoserProductSql()` (`src/lib/supplier-pairs.ts`, aturan Opsi B sama dengan `/api/products` + promo digest) dipasang di `listTelegramProducts` (katalog + kategori), `handleSearchResults`, dan `getBestsellers`; `handleShowProduct` mengarahkan id pecundang ke pemenang via `winnerForLoserProduct` (cermin 308 PDP).
- **Garansi kosong tidak ditulis (2026-10-04):** `buyerWarrantyLabel()` (`src/lib/catalog.ts`) = `""` untuk `warranty_type='none'` — Telegram (detail + tombol varian + snapshot invoice), snapshot order web (`commerce.ts`), dan WA (detail/varian/pembayaran) tidak lagi menampilkan "Tanpa Garansi" (SK menulis garansi di S&K, bukan kolom). Admin tetap bisa mengisi garansi terstruktur manual; sync SK tidak menimpanya.

### Tabel Baru (migrasi 0005)

| Tabel | Tujuan |
|---|---|
| `telegram_users` | Profil user Telegram minimal |
| `telegram_updates` | Idempotency + lease untuk webhook |
| `payment_transactions` | Ledger lintas-channel (base amount, payable amount unik, payload/URL QRIS, expiry) |
| `dana_webhook_events` | Dedup/audit minimal event QRIS Hook dan order hasil pencocokan |
| `payment_invoice_history` | Riwayat nominal, waktu terbit, dan expiry setiap QRIS; trigger insert/update ledger menjaganya dalam transaksi yang sama (migrasi 0025) |
| `dana_qris_legacy_ranges` | Rentang nominal dengan riwayat lama yang sudah terhapus oleh reissue; wajib verifikasi mutasi manual (migrasi 0025) |
| `fulfillment_inventory` | Vault secret terenkripsi per produk |
| `fulfillment_jobs` | Outbox delivery per order dengan retry (kompatibilitas) |
| `fulfillment_items` | Status/mode/penerima per item order (migrasi 0015). **Ringkasan status: satu order HANYA `delivered` bila SEMUA item delivered; campuran delivered+manual = `manual_required` (pelanggaran ini menutupi item manual yang belum diserahkan). Per-item klaim CAS (`sending` + locked_until) + agregat parent berpagar lease (R4 lanjutan); serah terima manual via `POST /api/admin/orders/[code]/handover`.** Migrasi 0043: `delivered_ciphertext`/`delivered_iv` = salinan terenkripsi isi yang dikirim ke pembeli (ciphertext sumber disalin untuk shared/unique; isi "Detail untuk pembeli" dienkripsi untuk serah terima admin), dibaca `/api/orders/[code]/credentials` setelah verifikasi WA/token. |
| `dana_webhook_events.reviewed_by/review_note` | Audit verifikasi manual nominal dipakai-ulang (migrasi 0017, review R1) |
| `whatsapp_outbox.worker_id/locked_until` + status `sending` | Lease klaim worker anti-kirim-ganda (migrasi 0018, rebuild CHECK prod 0019, review R10 lanjutan: recovery lease basi oleh runtime + claimErrors terpisah) |
| `admin_session_revocations` | Pencabutan sesi admin lintas instance/restart (migrasi 0020, review R8 lanjutan: logout menolak cookie basi di worker baru; TTL 90 hari dibersihkan cron) |
| `store_settings` | Override nama, tagline, WhatsApp, jam dukungan, footer, dan logo storefront |
| `supplier_links` | Shortlink internal `axvara.tech/go/*` (migrasi 0056, 2026-10-03): pembungkus link supplier + artikel AXVARA panjang agar tampil pendek di PDP/email/panel; `slug` unik + `destination` (URL/absolut atau path internal) + `title` + `is_active` + `click_count`/`last_clicked_at`; CRUD hanya admin, pembeli hanya redirect (bukan SaaS publik) |
| (indeks log) | Migrasi 0057 (2026-10-04, darurat kuota D1 Free 5 jt rows_read/hari): `wr_sync_log`/`sk_sync_log(sync_type, created_at)` + `wr_saldo_log`/`sk_saldo_log(source, created_at)`. Tanpa indeks, setiap query "baris terbaru" cron/watchdog membaca + mengurutkan seluruh tabel (±800–2.900 baris) dan menyumbang >50% rows_read setelah cron dipecah per fase. Aturan: query "terbaru" baru di tabel log wajib punya indeks pendukung |
| `telegram_promo_digests` | Ledger Daily Promo dua slot (`business_date + slot` unik), snapshot product IDs, marker/attempt/error terpisah untuk bubble lengkap dan ringkas (migrasi 0044) |

Kolom baru di `products`: `fulfillment_mode`, `shared_secret_ciphertext`, `shared_secret_iv`, `telegram_enabled`.
Kolom baru di `orders`: `sales_channel`, `telegram_chat_id`, `telegram_user_id`, `payment_status`, `fulfillment_status`, `telegram_order_notified_at`, dan `telegram_paid_notified_at`.

### Route Baru

| Method | Path | Auth | Tujuan |
|---|---|---|---|
| POST | `/api/telegram/webhook` | Telegram secret header | Webhook bot |
| POST | `/api/webhook/dana` | X-Webhook-Secret | Notifikasi pembayaran dari QRIS Hook |
| GET | `/api/payments/qris/:code/image` | kode order | PNG QRIS dinamis selama invoice aktif |
| POST | `/api/cron/operations` | CRON_SECRET | Rekonsiliasi |
| GET/POST | `/api/admin/telegram/setup` | admin | Setup webhook |
| GET | `/api/admin/bot/health` | admin | Health check tanpa secret |
| GET | `/api/admin/overview` | admin | KPI/action queue lintas channel |
| GET/POST | `/api/admin/payments/events` | admin | Event QRIS Hook aman + retry exact-match |
| GET/POST/DELETE | `/api/admin/fulfillment` | admin | Inventory management + template pesan serah terima varian Made By Order (`action:"set_handover_template"`, migrasi 0043). Impor/revoke varian unique OTOMATIS menyelaraskan kolom `stock` → unit `available` (2026-10-02, insiden Head 18 Bulan); GET membawa `variant_stock` + `stock_mismatch` untuk banner selisih admin. Revisi sore: penjumlahan kartu `variant_stock` memakai stok EFEKTIF per varian (unique = min kolom vs available) + `purchasableStockSql` menolak unique tanpa unit — kartu/bot/`llms.txt`/SEO seragam |
| GET/POST | `/api/admin/orders/:code/handover` | admin | Kirim ke pembeli: GET item + `label` + `template_text` terisi; POST `{item_index, note?, buyer_message?}` → isi dienkripsi, dikirim ke pembeli (email/DM), tampil di halaman pesanan |
| GET/PUT | `/api/store-settings` | public/admin | Identitas storefront / update terautentikasi |
| GET | `/api/catalog[?slug=]` | public | Katalog produk/varian aktif terpusat. Detail `?slug=` (sejak 2026-09-24): tiap varian membawa `copy` (S&K berkelompok + cara aktivasi versi Axvara, atau teks WR yang dirapikan) dan `terms`/`delivery_terms` mentah dikosongkan (`null`) |
| GET/PUT | `/api/admin/variant-copy` | admin | S&K + cara aktivasi versi admin per varian (`admin_terms`, `admin_activation`, `admin_copy_fingerprint`, 0041). GET memberi status/sumber dan teks editor, PUT menyimpan suntingan supplier dengan review/fingerprint. **2026-10-15:** stok sendiri memakai `SharedVariantCopyFields` pada tab Varian (single/multi), disimpan bersama batch POST/PUT produk lewat `manualCopyUpdate` hanya untuk varian tanpa WR/SK ID, fingerprint kosong; input kosong menghapus field, input tidak dikirim mempertahankan field, GET detail publik tidak mengirim field editor mentah. Link/akun/key unik tetap di inventory; impor/revoke merupakan aksi terpisah yang langsung tersimpan. Save foto/badge tidak mencap ulang override supplier. |
| GET/POST/PUT/DELETE | `/api/admin/variants` | admin | Kelola SKU, durasi, garansi, harga, stok, dan mode fulfillment varian |
| POST | `/api/whatsapp/webhook` | Shared Baileys webhook token | Command grup, order, pembayaran, dan intake bukti |
| POST | `/api/admin/proofs/:id` | admin | CAS approve/reject bukti dari baris Pesanan dan otorisasi pembayaran manual |
| POST | `/api/cron/lite?job=expiry\|fulfillment\|wr_orders\|sk_orders\|pedia_orders\|promo\|notify_a\|notify_b\|notify\|cleanup` | Bearer `CRON_SECRET` | Langkah cron INTI ramping (2026-10-05, Workers Free ~10 ms CPU): impor minimal + modul dinamis per job, budget 40 statement, penanda `store_settings.cron_lite_<job>_ok_at`. Dipanggil Worker SEBELUM route besar `/api/cron/operations` (yang tetap jalan sebagai pelengkap; idempoten). Alarm Telegram: langkah lite inti = hard (2 tick), `lite:promo` (Daily Promo Digest, ledger bersama fase notify → tidak kirim ganda) + `notify_a`/`notify_b` = soft (6 tick), langkah route besar lain tidak dialarmkan | **Revisi 5 Okt malam:** job `notify` (alarm soft) + `cleanup` (tanpa alarm) ikut lite; route besar `/api/cron/operations` hanya dipanggil Worker di tick menit :00 UTC (sekali per jam, `isHeavyTick`) sebagai pelengkap (stranded ledger, manual-WA, saldo, watchdog, sync cadangan). Tradeoff: fallback sync saat diff VPS berhenti jadi per jam (bukan 15 mnt). Latar: 583/589 request `exceededResources` 24 jam = route besar tiap 5 mnt. **Revisi 9 Okt pagi (insiden 09:50 WIB: 4 langkah lite 503 bareng, pulih sendiri ~30 mnt):** `notify` dipecah `notify_a` (retry Telegram + invoice) + `notify_b` (QRIS + reminder + WA outbox) — satu-satunya job yang mengipas 5 sub-kerjaan/5 import dalam 1 request; `job=notify` lama tetap sebagai alias gabungan A→B. Worker memanggil a/b terpisah + jeda `STEP_DELAY_MS` 2 dtk antar langkah lite (8+ request sedetik saat cold = berebut CPU isolate yang sama). Throttle saldo SMM disamakan WR/SK: 6 jam ATAU turun Rp5.000, state `amount|ms` di `pedia_balance_alert_at` (dulu tiap 1 jam → spam 9×/8 jam saat saldo Rp 0). **Revisi 9 Okt sore (kasus AXV-20261009-DA1ACF56):** probe yatim lunas-tanpa-link (reconcileMissingWrLinks/SkLinks) jalan TANPA gate due di lite wr/sk_orders (hasil ikut buka gate proses + kunci orphan_links_healed) dan fase route besar (wr/sk_orphan_links_healed) — SK cermin WR.
| GET | `/go/:slug` | publik | Shortlink internal `axvara.tech/go/*` (2026-10-03, migrasi 0056): redirect 307 ke destination + `click_count`/`last_clicked_at`; 404 bila slug tak ada/nonaktif/format salah; `X-Robots-Tag: noindex` (tak masuk sitemap) |
| GET/POST/PUT/DELETE | `/api/admin/supplier-links` | admin | CRUD tabel `supplier_links` (tab admin "Link Supplier"): slug lowercase-dash (min 2, reserved: admin/api/go/produk/artikel/…), destination URL/path internal, toggle `is_active`; POST duplikat → 409 |

### Environment Baru

Semua nilai nyata di Cloudflare Pages Secrets:

```
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ADMIN_CHAT_ID
DANA_STATIC_QRIS, DANA_WEBHOOK_SECRET
FULFILLMENT_ENCRYPTION_KEY
TELEGRAM_BOT_ENABLED, TELEGRAM_PROMO_DIGEST_ENABLED, DANA_QRIS_ENABLED, AUTO_FULFILLMENT_ENABLED
```

`TELEGRAM_ADMIN_CHAT_ID` adalah satu tujuan untuk seluruh notifikasi admin yang berasal
dari order web, order Telegram saat invoice dibuat, order WhatsApp saat dibuat
(`Order Baru — WhatsApp`) dan saat lunas (`Lunas — WhatsApp` via QRIS Hook /
retry admin / approve bukti), serta kegagalan delivery. Grup privat
wajib memakai ID numerik negatif (`-100...`), bukan link undangan. Bot tidak lagi
menyediakan `/chatid` (dihapus 12 November 2026); ambil ID grup dari klien Telegram
atau metadata update webhook yang tersedia bagi admin, lalu simpan sebagai secret tersebut. Username
support manusia `@axvara_support` ditampilkan bersama tombol WhatsApp admin pada
pesan setelah pembayaran berhasil.

Daily Promo Digest (`src/lib/telegram/promo-digest.ts`) berjalan di fase `notify`
cron operations, sesudah notifikasi transaksional. `Intl.DateTimeFormat` dengan
`Asia/Jakarta` membuka jendela retry pagi 09.00–11.59 dan sore 17.00–19.59.
Produk dipilih dari varian aktif yang stoknya unlimited atau memenuhi `min_qty`;
minimum tiga, target empat. `PRIMARY KEY (business_date, slot)` mengunci snapshot
pilihan. `full_message_id` dan `short_message_id` ditulis segera setelah masing-masing
send sukses, sehingga kegagalan bubble kedua hanya mengulang bubble kedua. Bubble
kedua = versi WA siap copy-paste (2026-10-03): isi sama persis dengan pesan utama,
bold pakai `*` literal, dikirim tanpa `parse_mode` HTML (nama produk ber-`&`/`<`
tidak bikin Telegram tolak pesan). Ikon kategori: cek spesifik dulu (Desain/Video,
Stream, Produktivitas, Developer, Bundle) baru AI pakai batas kata — "desain"
mengandung substring "ai". Flag
`TELEGRAM_PROMO_DIGEST_ENABLED` default mati mencegah outbound saat setup belum siap.

### Feature Flags
Rollout bertahap: `TELEGRAM_BOT_ENABLED=false`, `TELEGRAM_PROMO_DIGEST_ENABLED=false`, `DANA_QRIS_ENABLED=false`, `AUTO_FULFILLMENT_ENABLED=false`. Semua default off di contoh environment; secret produksi dikelola di Pages.

### Proteksi Garansi BOT

**Pengiriman kredensial lengkap (2026-10-17 ✅ implementasi, publikasi CI):** `messages/credential.ts` membentuk bagian kredensial → S&K → penggunaan/aktivasi → klaim garansi. `orders/credential-terms.ts` mengekspor `resolveCredentialTermsForVariants` untuk lookup katalog per ID yang sudah diketahui (satu query JOIN, resolver/fingerprint/merge sama dengan panel website); `resolveCredentialTermsByItem` tetap memetakan hasil ke indeks order untuk API website. WR membaca ID varian lokal berdasarkan `wr_variant_id` link asal; SK dan shared/unique memakai `fulfillment_items.variant_id`. Tombol ambil ulang mengambil copy seluruh varian terkirim dalam satu query, lalu memasangkan per item. Legacy dan serah terima admin berisi detail (`notifyBuyerHandover`) memakai resolver indeks order. Notice handover baru ditandai sent setelah seluruh bagian sukses; handover tanpa isi tetap berupa kabar penyerahan existing. Cadangan deskripsi/admin dipakai bila copy kosong/gagal dibaca; kredensial tetap dapat dikirim. Copy adalah katalog terkini saat pengiriman/ambil ulang, bukan snapshot baru. Tidak ada migrasi/env/kontrak proxy baru.

`credentialMessages` mengemas bagian menjadi array HTML ≤4096 karakter per pesan (lebih ketat daripada panjang teks setelah parsing Telegram), mempertahankan semua karakter kredensial, code point Unicode, entitas/tag utuh dan identitas order pada lanjutan. `sendTelegramCredentialParts` hanya menerima ID chat positif dan mengirim berurutan tanpa preview tautan. `sendTelegramCredential` mencoba seluruh bagian pada tiap target pribadi sesuai fallback existing; baru sukses setelah semua bagian berhasil. SK menyelesaikan notice sesudah seluruh bagian, stok sendiri menyelesaikan item/job sesudah seluruh bagian, WR mempertahankan retry delivery existing; kegagalan parsial dapat mengulang bagian yang sudah sampai saat fallback/retry (bukan exactly-once per bubble). Budget admission fulfillment Telegram menambah satu statement katalog; reserve WR bertambah satu. Kebijakan klaim memakai `marketWarrantyClaim` bersama website; teks delivery lama “Refund tidak berlaku” dihapus. Ambil ulang melengkapi pesanan lama tanpa broadcast otomatis. Verifikasi fixture/Obscura bukan bukti pesan transaksi produksi.

- `/start` tampil bersih (welcome simpel) + tombol `📜 Garansi & Ketentuan` dan `🛍️ Lanjut Belanja`.
- Command `/garansi` (terdaftar di menu) mengirim ketentuan third-party + 6 syarat klaim (ganti/perbaikan, bukti invoice + screenshot, proses 1–3 hari dan solusi refund jika gangguan berlanjut setelah maksimal 3 hari; garansi ikut deskripsi produk, revisi 2026-10-15).
- Konfirmasi beli memakai tombol `✅ Saya Paham, Lanjut Bayar` + tombol `📜 Syarat Garansi`; invoice/pre-bayar menegaskan lanjut bayar = setuju ketentuan.
- Detail produk menunjuk garansi ikut deskripsi + `/garansi`; pesan delivery/manual mengingatkan simpan invoice untuk klaim.

### Pengiriman non-WR ke pembeli web + Kirim ke pembeli (2026-09-25, migrasi 0043)

Laporan owner, 2026-09-25.
Temuan read-only produksi: 100% item non-WR kanal web berakhir `manual_required`
karena `send.ts` memaksa semua item web ke antrean admin
(`web_channel_requires_manual_handover`), padahal checkout web mewajibkan email dan
badge storefront menjanjikan "Kirim otomatis". Perubahan:
- **Kirim otomatis lewat email.** Item web mode `shared`/`unique` dikirim oleh
  `sendWebDeliveryEmail` (`src/lib/fulfillment/delivery/buyer-email.ts`) dengan template
  **"Pesanan Siap"** (`buildOrderReadyTemplate`). Emailnya sekaligus memuat tanda terima
  pembayaran, jadi pembeli menerima SATU email (keputusan owner). Idempoten per item lewat
  `buyer_notice_log` kunci `email:fulfillment-item:<id>`: baris `sent` tidak dikirim ulang
  saat retry (kirim sukses tetapi tulis status gagal). Resend gagal → jadwal retry
  1/5/15/60 menit → `failed` + alarm admin + kabar pembeli (mesin lama). Mode `manual`
  (Made By Order) → `manual_required` di semua kanal. Order web tanpa email valid →
  `manual_required` dengan `web_no_buyer_email`.
- **Tanda terima terpisah hanya bila perlu.** `ensureFulfillmentForPaidOrder` kini
  mengirim tanda terima web SETELAH upaya kirim pertama, dan melewatkannya bila semua baris
  sudah `delivered` otomatis (`webOrderAutoDelivered`: `delivered_message_id LIKE 'item:%'`).
  Made By Order, pesanan campuran, kirim tertunda, dan `AUTO_FULFILLMENT_ENABLED` mati
  tetap menerima tanda terima.
- **Salinan isi terkirim** (`fulfillment_items.delivered_ciphertext/iv`). Isinya ciphertext
  pesan bersama atau unit stok yang disalin apa adanya saat kirim, jadi halaman pesanan tetap
  menampilkan isi yang sama walau pesan bersama diganti kemudian. `/api/orders/[code]/credentials`
  (POST verifikasi 6 digit WA atau email checkout, GET capability token yang diverifikasi dulu) mengembalikan
  detail WR + salinan ini dengan `label` baris pesanan. `credentials_ready`
  (`GET /api/orders?code=`, `/api/orders/lookup`) dan `issueCredentialToken` kini juga
  menghitung salinan ini. **Paritas WR-SK (2026-10-03, kasus F111FD64):** `handleWrOrderCompleted`
  kini bind link→item otomatis (`bindWrLinkToFulfillmentItem`, idempoten) + menulis
  ciphertext ke baris item (pola `settleSkFulfillmentItem`) sehingga panel membaca kredensial
  WR — sebelumnya WR hanya flip status dan panel tidak pernah melihat kredensial meski link
  completed. `readDeliveredSnapshots` mengecualikan item `wr:%` (anti-duplikat: link WR sudah
  dibaca dari `wr_order_links`); item `sk:%` tetap dibaca (SK tanpa jalur link di credentials).
- **Kirim ke pembeli** (dulu "Serahkan manual"). `GET /api/admin/orders/[code]/handover`
  mengembalikan `label`, `has_content`, dan `template_text`, yaitu
  `product_variants.handover_template` yang placeholder `{email}`, `{nama}`, `{kode}`,
  `{produk}`-nya sudah diisi di server. `POST` menerima `buyer_message` (≤4000). Isi itu
  dienkripsi (`encryptSecret`, tanpa kunci → `storage_error`, tidak pernah disimpan polos) di
  UPDATE yang sama dengan flip `delivered`. `notifyBuyerHandover` mengirim isi itu lewat email
  "Pesanan Siap" (web) atau DM Telegram (di-escape). Isi **tidak pernah** masuk outbox WA
  (`whatsappFallback:false`), karena outbox menyimpan teks polos dan bot WA mati: order web
  tanpa email → `buyer_notified:false`. Tanpa isi, pembeli menerima kabar "Pesanan
  Diserahkan". Template per varian disunting di panel varian Made By Order
   (`ProductVariantRows`) dan disimpan lewat `POST /api/admin/fulfillment`
   `action:"set_handover_template"` (≤2000; kosong = hapus).
- **Notif admin "Lunas — Web"** (menggantikan ping serah terima terpisah, 2026-09-25): lihat
  subbagian berikut.
- **Semua email pembeli bermerek.** `renderBrandedNotice` (shell Midnight + Cyan, logo,
  tombol Lihat Pesanan, blok bantuan WA) dipakai untuk tanda terima, serah terima, bukti
  ditolak, bukti menunggu Hook, pengiriman tertunda, dan pengingat QRIS kedaluwarsa. Isi di-escape
  dan tanpa emoji.
- **Teks pembeli.** Blok pengiriman di `/pesanan/[code]` menyebut email sebagai
  tujuan (WA hanya untuk order lama tanpa email); sejak 2026-09-25 produk kirim otomatis
  dan detailnya tampil dalam hitungan detik; sejak sore 2026-10-02 fase menyiapkan
  ±30 dtk pertama = skeleton tanpa teks pengiriman (tanpa bacaan yang bisa hilang
  saat panel muncul); sejak 2026-10-02 judul +
  nada dibedakan per keadaan — "Pesanan Made By Order" (C1 manual by design, tanpa alasan
  stok) vs "Pengiriman oleh Admin" (C2 instan-gagal: "Stok otomatis habis, jadi admin
  menyiapkan manual"), jalur otomatis tidak pernah menyebut admin/12 jam (lihat Storefront di
  bagian Warung Rebahan). PDP menampilkan "Tergantung varian" untuk
  varian campuran sebelum pembeli memilih. Dulu ringkasannya mengikuti varian pertama, jadi
  Canva tampil "Kirim otomatis" walau 2 dari 3 variannya Made By Order.
- Dikunci oleh `tests/nonwr-web-delivery.integration.test.ts`,
  `tests/nonwr-handover-content.integration.test.ts`, `tests/admin-handover-dialog.behavior.test.tsx`,
  dan `tests/nonwr-delivery-copy.test.tsx`. Item web `manual_required` lama di produksi tidak
  dikirim ulang otomatis; admin menyelesaikannya lewat Kirim ke pembeli.

### Notif admin order web: "Lunas — Web" (2026-09-25)

Laporan owner: order web tidak pernah muncul di grup `Axvara_Notif`, order Telegram muncul.
Notif lama "Order Baru — Web" (`POST /api/orders`) membangun tombol dengan
`SITE_URL ?? fallback`. SITE_URL kosong di worker (§16.4), jadi tombol "Panel Admin" menjadi
URL relatif dan Telegram menolak SELURUH pesan. Hasil kirim diabaikan: tanpa log, penanda,
atau retry. Notif Telegram/WA memakai `||` sehingga tetap jalan.
- Keputusan owner: order web **hanya dinotif saat lunas**. "Order Baru — Web" dihapus dari
  `POST /api/orders` (11 dari 20 order web dua minggu terakhir tidak dibayar).
- `notifyWebPaidAdmin` (`order-notifications.ts`) dipanggil `ensureFulfillmentForPaidOrder`
  setelah upaya kirim pertama, sehingga pesannya memuat status kirim (`summarizeWebDelivery`):
  jumlah item terkirim otomatis ke email, perlu **Kirim ke pembeli**, sudah diserahkan admin,
  sedang dikirim, atau diproses Warung Rebahan. Judulnya "Lunas — Web", atau "Lunas — Web ·
  perlu dikirim admin" bila ada item `manual_required`/`failed`.
- Sekali per order lewat `buyer_notice_log` kunci `admin-paid:<kode>` (kanal telegram). Kolom
  `error` menyimpan alasan penolakan Telegram, jadi kegagalan berikutnya bisa dibaca di D1.
- URL tombol lewat `siteOrigin()` (`src/lib/site-url.ts`), selalu absolut. Tombol WA
  (`webPaidAdminKeyboard`) hanya dipasang untuk nomor `62…` yang valid. Bila Telegram tetap
  menolak tombol (400 Bad Request), pesan dikirim ulang **tanpa tombol**. Timeout tidak diulang
  seketika (pesan bisa saja sudah sampai); cron yang mengulang.
- Cron `operations` (fase notify) menghitung `paid_admin_web` dengan
  `WEB_PAID_ADMIN_PENDING_WHERE`: order web lunas dalam 6 jam terakhir tanpa ledger `sent`.
  `retryPendingTelegramNotifications` menerima `paidAdminWeb`; pemanggil lama yang memberi
  `only` tanpa kunci ini tidak membaca antrean web (anggaran query RR3-01). Order lama
  (>6 jam) tidak pernah dikirim ulang, jadi deploy tidak membanjiri grup.
- Dikunci oleh `tests/web-paid-admin-notif.integration.test.ts` (termasuk cron sungguhan).

## 14. Varian Produk Terpusat dan Bot Grup WhatsApp AXVARA (Terimplementasi)

Sistem varian produk terpusat dan bot WhatsApp telah diimplementasikan sesuai `docs/WHATSAPP-GROUP-BOT-PLAN.md`:

### Arsitektur
- **D1 sebagai Source of Truth:** `products` menyimpan produk induk (`name`, `whatsapp_alias`, search `aliases`, description, image, badge), sedangkan `product_variants` menyimpan SKU yang dapat dibeli (label, duration, warranty, price, stock, `min_qty` (migrasi 0034, milik admin, default 1 — GSuite 50), fulfillment_mode, sort_order). `whatsapp_alias` hanya mengatur nama presentasi di daftar/header WhatsApp dan fallback ke `name` bila kosong; `aliases` tetap khusus kata kunci pencarian bot.
- **Nama publik Antigravity (migrasi 0045):** `gemini-ai-antigravity` ditampilkan sebagai `Gemini AI Antigravity` tanpa suffix `(WR)`. Identitas integrasi tidak bergantung pada nama; `source='warung_rebahan'`, `wr_product_id`, dan registry WR tetap menjadi authority.
- **CMS Web:** Modal card-based `VariantEditor` di `/admin` mengelola SKU/durasi/garansi/harga/stok dengan tombol aksi konsisten; form produk memiliki field Alias WhatsApp. Menu **Pesanan** memakai tab Web/Telegram/WhatsApp, pagination, thumbnail bukti, dan aksi setujui/tolak bukti WhatsApp langsung pada baris pesanan; halaman **Bukti Bayar** terpisah telah dihapus. Menu **Bot & Otomasi** memilih target varian untuk mode `manual/shared/unique`, shared secret terenkripsi, dan inventory unik. Pembuatan produk juga membuat varian default secara atomik. Produk/varian yang dihapus diarsipkan (`is_active=0`) agar relasi historis tetap utuh; edit harga/stok melalui form produk hanya disinkronkan bila produk masih mempunyai satu varian default. Sejak fix Canva Sep 2026: `PUT /api/products/:id` yang membawa `variants` eksplisit TIDAK lagi menilai/menulis kolom legacy `price/stock/compare_price` — master dihitung ulang dari varian aktif (`MIN(price)`, agregat stok, `compare_price` NULL untuk multi-varian), sehingga save produk multi-varian tidak lagi 409. Guard 409 hanya berlaku untuk edit legacy TANPA `variants`. Client `useProductManager` mode varian tidak lagi mengirim kolom legacy.
- **Service Bersama:** `src/lib/catalog.ts` menyediakan query terpusat untuk web, Telegram, dan WhatsApp. `src/lib/warranty-policy.ts` mengekstrak kebijakan garansi kanonis dengan formatter Telegram (HTML) dan WhatsApp (bold `*`).
- **Website:** Halaman detail `/produk/[slug]` mendukung variant selector interaktif; cart Zustand membedakan item berdasarkan kombinasi `product_id + variant_id`; checkout quote mendukung variant_id.
- **Telegram Bot:** Menambahkan langkah pemilihan varian sebelum konfirmasi beli (`TELEGRAM_VARIANT_FLOW`). Menggunakan harga dan konfigurasi varian.
- **Navigasi & marketing Telegram Fase 1:** label menu bawah (`MENU_LABEL_*`: 🛍 Katalog · 🔎 Cari · 🛒 Keranjang · 📦 Pesanan · ❓ Bantuan terpusat di `keyboards.ts` dan tetap di-route sebagai teks di webhook untuk keyboard lama); `/start` hanya mengirim satu foto welcome + `homeKeyboard` tanpa bubble "Menu cepat" tambahan; command `/cari`+`/search`, `/orders`+`/riwayat`, `/cart`+`/keranjang`; welcome landing `/start` menampilkan 3 bestseller by `sold_count`; `Terjual X` (compact `1.5rb+` di ≥1000) di kartu produk; riwayat `/orders` 10 terakhir by `telegram_user_id` dengan keyboard `myOrdersKeyboard` (detail + `reorder:*` → beli lagi); pencarian nama/alias via `pending_action=search:` + `/batal`; breadcrumb `breadcrumbLine` (`Langkah X/4`) di pilihan varian (2), langsung qty (3) tanpa konfirmasi tambahan, invoice (4). Payment/fulfillment tidak berubah.
- **Keranjang + reminder Telegram Fase 2 (tanpa review/promo):** tabel `telegram_carts` (migrasi 0014, `UNIQUE(user_id, variant_id)`, CHECK qty 1–100, maks 20 baris/user; maksimal 1 baris fulfillment `unique` per keranjang karena `findReservedForOrder` + `fulfillment_jobs` memakai satu `order_code`); lib `src/lib/telegram/cart.ts` (`addToCart`/`setCartLineQty`/`removeFromCart`/`clearCart`/`getCartSummary` dengan pembersihan baris basi); tombol `🛒 + Keranjang` (`cadd:*`) di langkah qty berdampingan dengan Bayar QRIS langsung; `/cart` memakai `cartKeyboard` (➖/➕/❌ per baris, `ccheckout`, `cclear`) lalu ringkasan `cartCheckoutSummaryMessage` + konfirmasi `cconfirm` sebelum invoice terbit; checkout gabungan `createAndSendCartInvoice` = SATU order + SATU `createDanaQrisInvoice` + SATU `createFulfillmentJob` mode dominan (unique > shared > manual; campuran → job manual + snapshot `mixed` informatif), stok finite dipotong per baris dengan rollback kompensasi; cart dikosongkan hanya setelah invoice terbit; reminder pending via `sendPendingOrderReminders` di cron operasi (maks 2x/order, interval ≥60 mnt, JOIN invoice aktif `pt.status='pending'` + `expires_at` masa depan, claim CAS `telegram_reminder_count`, copy eskalatif `orderReminderMessage`).
- **Input jumlah + konfirmasi email Telegram (2026-09-27):** qty tetap memakai
  stepper, ditambah callback owner-bound `qinput:<productId>:<variantId>` yang
  memasang `pending_action=qty_for:*` dan mengirim ForceReply dengan rentang
  live (`min_qty` sampai min(stok,100)); input di luar rentang ditolak tanpa
  clamp diam-diam. Varian Invite/Link/`require_email` memakai CTA **Lanjut Isi
  Email**; `email_for:*` menyimpan email lalu menampilkan alamat masked. Callback
  owner-bound `epay:*` memanggil kembali `handlePayWithQris(...,
  emailConfirmed=true)`, sehingga guard stok, minimum, pending-order, dan
  atomisitas invoice tetap dilalui. `eedit:*` membuka ForceReply email baru dan
  `qty:*` kembali ke jumlah; tidak ada email mentah di callback data.
- **Daily Promo Digest (2026-09-27, revamp 2026-09-29, revamp 2026-10-01):** fase notify cron membuat dua materi siap
  salin pada 09.00/17.00 WIB. Sejak 2026-10-01 (permintaan owner, contoh ceklis WR/SEKUDIL): SEMUA produk ready masuk pesan (bukan 12+12 paruh; `selectPromoProducts` = seluruh kandidat; histori/seed dipertahankan tapi tidak memotong); format Axvara dipertahankan (judul + hook 2026-09-29 + kelompok per kategori + harga tegas varian purchasable termurah tanpa "Mulai"/disclaimer + CTA bot + web) — hanya baris produk + ✅. Kandidat = produk ready non-pecundang (`telegram_enabled=1`, pecundang supplier-pair dikecualikan). Dua bubble memakai ledger migrasi 0044;
  retry parsial tidak mengirim ulang bubble yang sudah memiliki `message_id`.
- **Flow order Telegram (WA parity, payment khusus QRIS):** `/katalog` menampilkan daftar datar nama produk + harga (tanpa kategori wajib; kategori hanya filter opsional). **Sejak 2026-09-24 katalog, filter kategori, pencarian, dan bestseller `/start` hanya memuat produk yang BISA DIBELI** (`listTelegramProducts` + `purchasableStockSql` di `src/lib/catalog-availability.ts`: varian aktif dengan stok -1 atau ≥ `min_qty`),   memakai snapshot katalog publik 30 detik sejak 2026-10-17 (Cache API per lokasi; tanpa Cache API baca D1 langsung), dengan harga = varian tersedia termurah. Detail/checkout tetap membaca dan memvalidasi stok/harga aktual. Definisi "tersedia" ini web + Telegram SAMA (2026-10-01, revisi keputusan owner yang mengubah revisi 2026-09-30): daftar web (`GET /api/products?active=1`) MENAMPILKAN produk habis di akhir dengan `soldOut: true` (badge habis, tanpa tombol beli; urutan ready → habis → nonaktif via `sortProductsForDisplay`) untuk trust + mengurangi komplain "kok kemarin ada, sekarang hilang"; Telegram + `llms.txt` tetap hanya produk yang bisa dibeli (chatbot tidak bisa menjelaskan barang yang tidak bisa dibeli; tanpa `soldOut`). PDP langsung (`/produk/[slug]`) + search (`?q=`) tetap bisa akses produk habis. Kartu habis otomatis tampil lagi sebagai ready saat restok (tanpa cron/state). Dikunci oleh `tests/seo-geo.regression.test.ts` + `tests/catalog-available-price.regression.test.ts`. Halaman dari tombol lama dibatasi ke halaman terakhir yang ada. Detail produk tanpa deskripsi, menampilkan foto produk web + list garansi per varian dari `product_variants` yang sama dengan web/WA. Alur beli: `Produk → Varian → Qty stepper (➖ / jumlah / ➕, angka manual 1–100) → QRIS DANA dinamis`; tidak ada SeaBank/e-wallet di Telegram. CTA jumlah langsung menerbitkan satu pesan QRIS tanpa layar pemilihan metode dan tanpa kewajiban menekan cek status. QRIS Hook melunasi order atomik, menambah `sold_count`, lalu mengirim pesan sukses otomatis. Untuk fulfillment manual, pending input WA baru dipasang setelah `paid`; buyer juga mendapat tombol WhatsApp admin dan `@axvara_support` — input WA reply-only tanpa tombol loop. Order-created ke grup admin dan paid ke buyer memakai marker D1 idempoten serta retry cron; paid juga dikirim sebagai pesan `Pembayaran diterima — Telegram` tersendiri ke grup admin via `telegram_paid_admin_notified_at` (migrasi 0013) agar status grup tidak tertinggal menunggu bayar. Guard anti-double-tap memakai ulang order pending chat+varian yang sama; varian stok unik dibatasi qty 1. Sapaan WIB dinamis (Pagi/Siang/Sore/Malam + tanggal/jam) hanya di welcome/bantuan — katalog tampil bersih tanpa pengulangan sapaan/tanggal/jam.
- **WhatsApp Bot:** Webhook di `POST /api/whatsapp/webhook` via Baileys gateway Heroku. Mendukung:
  - `list` (header `LIST MENU AXVARA`, nama alias/fallback produk aktif tanpa kategori/harga, lalu footer promosi Telegram dan website resmi)
  - Pencarian nama produk/alias → detail bergaya garis dengan header alias dan varian bernomor
  - Pemilihan angka terikat per `conversation_id + member_id`
  - Pilihan `QRIS` / `SEABANK` / `EWALLET` → pending order idempotent + satu instruksi pembayaran terpilih di grup
  - `garansi` / `/garansi` → kebijakan garansi kanonis
   - Reply otomatis mengutip pesan pembeli; intake screenshot cukup memakai caption nama metode (kode order ditentukan dari sesi/order aktif), dedup, R2 private, notifikasi admin
   - Order WA mengumumkan `Order Baru — WhatsApp` ke grup Telegram admin segera setelah order dibuat (best-effort + retry cron via marker `telegram_order_notified_at`, migrasi 0023); saat lunas via QRIS Hook / retry admin / approve bukti, grup menerima `Pembayaran diterima — WhatsApp` (`telegram_paid_admin_notified_at`, cron yang sama dengan Telegram)
   - Admin pada `WHATSAPP_ADMIN_NUMBERS` dapat reply `.d` ke pesan pembayaran atau mengetik `.d AXV-...` untuk menandai fulfillment order lunas sebagai `delivered`; command non-admin berhenti sebelum pencarian produk
- **Feature Flags:** 10 feature flags independen di `src/lib/feature-flags.ts` untuk rollout aman bertahap (semua default `false`).
- **Minimum pembelian per varian (migrasi 0034, 2026-09-17):** `product_variants.min_qty` (default 1, CHECK ≥ 1, milik admin — sync WR tidak pernah menulisnya) adalah mode generik untuk aturan grosir: GSuite dikunci 50 via UPDATE migrasi, produk lain tinggal set angka dari admin (plafon 100 = plafon channel). Penegakan berlapis server-side: quote 409 `below_minimum` (qty agregat per baris) → orders 409 (hitung ulang DB) → guard atomik `COALESCE(min_qty,1)` di `createOrderWithStock` + `createChannelOrderAtomic` (batch gagal total bila di bawah min). Plafon web naik 20 → 100/baris (paritas Telegram) agar min-besar bisa dibeli dari web; verifier quote ikut 100. Telegram: stepper dibuka di min, tolak ketik/invoice/keranjang di bawah min; WhatsApp (qty selalu 1): varian min>1 ditolak jelas sejak pilih varian + saat bayar, diarahkan ke web/Telegram bulk.

### Status Rollout Produksi WhatsApp

Mulai 5 September 2026, Baileys gateway produksi berjalan di Heroku dan seluruh fitur transaksi WhatsApp aktif untuk GID pada `WHATSAPP_GROUP_ALLOWLIST`. Flag aktif meliputi `PRODUCT_VARIANTS_READ`, `WHATSAPP_ENABLED`, `WHATSAPP_GROUP_DISCOVERY`, `WHATSAPP_GROUP_PAYMENT`, `WHATSAPP_PROOF_INTAKE`, `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT`, dan `WHATSAPP_FULFILLMENT`. **Sejak 19 Sep 2026 `WHATSAPP_CREDENTIAL_DM_ENABLED=false` (default mati)** — auto-DM kredensial ke buyer dimatikan pasca-restriction nomor BOT; grup tetap penuh, kredensial via email + panel + manual HP. Outbound `/send` dan `/send-image` wajib memakai shared gateway token; pesan inbound di-cache terbatas selama 20 menit agar balasan dapat memakai quoted message Baileys. Target kirim dinormalisasi di adapter via `normalizeWhatsAppTarget` (2026-09-18 sore, live): nomor HP mentah (`628…`/`08…`, seperti tersimpan di outbox) menjadi JID DM `<62…>@s.whatsapp.net` — Baileys baru melempar `jidDecode(...)` undefined untuk target tanpa domain (bukti prod: 2 baris `wr-web-ready` gagal 4x sejak 13:20 UTC 18 Sep). Pola DM ketat (`^62\\d{9,13}$`/`^0\\d{9,13}$`); JID grup (`@g.us`) dan ID non-pola dikembalikan apa adanya agar gateway yang menolak, bukan salah alamat.
- **Hardening umur nomor gateway (19 Sep 2026, deploy DITUNDA sampai restriction lepas — deploy = restart = reconnect saat dibatasi = memperpanjang).** `axvara-wa-gateway/src/index.ts`: (1) 401/loggedOut = TIDAK reconnect otomatis (hammer = signature bot; diam + terpantau, pairing manual oleh owner); (2) 515 reconnect cepat 1 dtk; sisanya exponential backoff + jitter (maks ~60 dtk); (3) teardown socket lama (`end()` + hapus listener) sebelum bikin baru — anti zombie socket / konflik sesi; (4) `cachedGroupMetadata` TTL 5 mnt (hemat fetch partisipan tiap kirim, sesuai FAQ resmi); (5) jeda baca acak 1–2,5 dtk sebelum teruskan inbound; (6) antrean outbound serial + jeda 4–8 dtk + cooldown 15 mnt setelah 3 sinyal bahaya (`gateway_cooldown_active`, `/send` 429 saat cooldown); (7) `/health` memaparkan `lastDisconnectCode/lastDisconnectAt/reconnectCount`. Jangan ganti string browser, jangan hapus `baileys_auth_keys`, satu socket per dyno.

### Tabel Baru (migrasi 0007)
| Tabel | Tujuan |
|---|---|
| `product_variants` | SKU varian produk (harga, stok, durasi, garansi, fulfillment). Migrasi 0043: `handover_template` (milik admin, varian Made By Order non-WR; ditulis hanya lewat `POST /api/admin/fulfillment` action `set_handover_template`) |
| `whatsapp_sessions` | Sesi percakapan per anggota grup WhatsApp (TTL 15 menit) |
| `whatsapp_inbox_events` | Idempotency / dedup webhook WhatsApp |
| `whatsapp_outbox` | Antrean pengiriman pesan WhatsApp dengan retry |
| `payment_proofs` | Metadata bukti pembayaran grup WhatsApp (R2 private, review queue) |

### Migrasi 0008 — Multi-channel Orders Rebuild
Migrasi `0008_orders_multichannel.sql` melakukan SQLite table rebuild pada tabel `orders` agar constraint `sales_channel` menerima `'web'`, `'telegram'`, dan `'whatsapp'`. Menambahkan kolom identitas channel kanonis `channel_conversation_id` dan `channel_member_id`, memigrasikan data lama dengan `PRAGMA defer_foreign_keys=ON` agar referensi `orders(code)` tetap valid, memperbarui indeks order, serta menambahkan unique partial index agar hanya satu bukti `submitted/approved` aktif per order.

Karena D1 tetap menjalankan `DROP TABLE` sebagai implicit delete walaupun pemeriksaan FK ditunda, migrasi memindahkan sementara `order_code` pada `payment_transactions`, `fulfillment_jobs`, dan `payment_proofs` ke namespace khusus sebelum parent lama dihapus. Setelah `orders_new` menjadi `orders`, seluruh key anak dikembalikan dan `PRAGMA defer_foreign_keys=OFF` memaksa validasi sebelum commit. Regression test menjalankan migrasi terhadap fixture dengan ketiga tabel anak berisi data, memeriksa `foreign_key_check`, preservasi row, pemetaan Telegram, dan insert channel WhatsApp.

### Migrasi 0009 — Alias WhatsApp dan Repair Status
Migrasi `0009_whatsapp_alias_order_state.sql` menambah `products.whatsapp_alias`, mengisi alias ringkas untuk katalog yang sudah ada, mengubah sesi aktif lama ke provider `baileys`, serta menyelaraskan `orders.payment_status` historis dengan status `kadaluarsa`, `dibatalkan`, dan `lunas`. Counter Telegram pada Bot & Otomasi membaca `orders.status`, sehingga pesanan kedaluwarsa tidak lagi muncul sebagai pending.

### Migrasi 0010 — DANA Dynamic QRIS

Migrasi `0010_dana_dynamic_qris.sql` menambah `unique_code` dan `qris_payload` pada ledger, unique partial index untuk nominal invoice DANA aktif, dan `dana_webhook_events` untuk dedup/audit hook. Konfigurasi `payment_methods.qris` dipindahkan ke `QRIS Dinamis` dengan `qris_url=NULL`; seluruh aset QRIS statis publik dihapus.

### Keamanan Webhook & Gateway WhatsApp
- **Autentikasi Webhook:** Membandingkan `WHATSAPP_WEBHOOK_TOKEN` via `timingSafeEqual` (constant-time comparison). Gateway Baileys mengirim header `x-webhook-token`; header/query/payload fallback tetap tersedia untuk diagnosis. Body dibatasi 64 KB dan diparse tanpa side effect sebelum autentikasi; permintaan tanpa token atau dengan token salah ditolak HTTP 401 sebelum menyentuh D1. Arah Pages→Heroku memakai nilai yang sama pada `x-gateway-token` dan endpoint kirim menolak request tanpa token.
- **Kontrak Baileys:** `sender` dipetakan sebagai ID grup (`conversationId`), `member` sebagai nomor pengirim (`memberId`), `inboxid` sebagai ID pesan/referensi quoted reply (`inboxId`), dan `reply` sebagai stanza yang dikutip pembeli. Karena Baileys 7 memakai LID di grup, gateway memilih PN dari `participantAlt` saat `participant` berakhiran `@lid` agar allowlist admin berbasis nomor tetap akurat.
- **Inbox & Order Idempotency:** Event tanpa `inboxid` ditolak. Event yang sama dideduplikasi; event gagal dapat direclaim oleh satu retry. Satu pesan `pay` memakai `conversation + member + inboxid + variant` sebagai idempotency key, sementara pesan `pay` baru tetap dapat membuat pembelian ulang varian yang sama. Pending order lama hanya dipakai ulang jika masih unpaid dan belum kedaluwarsa. Webhook membatasi 12 event per anggota/grup per menit; cron menghapus session yang lewat masa simpan dan inbox dedupe lebih dari tujuh hari.
- **Media Bukti & Anti-SSRF:** Gateway Baileys mengunduh image message dan menyediakan token URL acak sekali pakai selama 10 menit. Pages hanya menerima HTTPS, memvalidasi anti-SSRF terhadap private IP/loopback, men-stream maksimal 5 MB, memverifikasi magic bytes (JPG/PNG/WebP), menghitung SHA-256, lalu menyimpan privat di Cloudflare R2 prefix `bukti/whatsapp/`. Shared gateway token tidak pernah diteruskan ke URL media.
- **Review & Otoritas Pembayaran:** Bukti QRIS hanya evidence opsional dan tidak dapat melunasi order. `POST /api/webhook/dana` adalah satu-satunya authority QRIS; SeaBank/e-wallet tetap memakai review admin CAS. Pembayaran QRIS yang sudah terdeteksi tidak ditahan oleh kewajiban screenshot WhatsApp.
- **Lifecycle Stok & Pembayaran:** QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Telegram/Web 60 menit dengan 1x perpanjangan QR — window 60 menit itu yang membuat 1 order iseng mengunci stok 1 jam). QR mati = order kedaluwarsa = stok dilepas via cron ±5 menit. Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`: verifikasi kode + WA/email checkout pola lookup, 404 generik anti-oracle, hanya pending+unpaid, CAS `transitionPendingOrder` yang sama dengan admin sehingga kalah race vs webhook = 409 jujur + stok tidak ganda + ledger paid tidak tersentuh). QRIS Hook memperbarui ledger+order dalam satu batch guard. Cron memakai deadline order DANA (fallback invoice untuk legacy tanpa deadline), memeriksa deadline ulang dalam batch sebelum melepas stok. Migrasi 0026 menyesuaikan deadline WA/QR pengganti yang sudah pending dan menambah `payment_transactions.expiry_notice_state` (`renewable`/`terminal`). `src/lib/payments/qris-expiry-notifications.ts` mengirim tombol pembaruan hanya bersama pesan kedaluwarsa pertama Telegram; kegagalan kirim tetap pending, dan pesan terminal WA memakai outbox idempoten per order. Marker reset saat reissue bersama reset delivery foto Telegram, tanpa membuat QR tambahan. Helper memakai budget D1 request yang sama (1 list + maksimal 2 query per pesan). Notifikasi mengikuti cron 5 menit; deadline penerimaan pembayaran tidak menunggu cron. `GET /api/orders?code=...` dan `/api/orders/[code]` mengembalikan `expires_at` dan `qris_reissue_allowed` untuk halaman pesanan. Rail manual WhatsApp tanpa ledger tetap memakai TTL sebelumnya.
- **Proteksi Kredensial Fulfillment:** Job hanya dapat di-claim setelah order `lunas/paid`; mode dipatok oleh `variant_snapshot` order dan shared secret diambil dari varian terpilih. Varian shared tanpa secret terenkripsi dan varian unique tanpa inventory gagal tertutup sebelum order bot dibuat. Pengiriman WhatsApp selalu via pesan langsung (DM) ke `channel_member_id`/`customer_wa`, tidak pernah ke grup. Gate `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT` menahan job sampai bukti diserahkan, dan `WHATSAPP_FULFILLMENT` dapat memaksa jalur manual selama rollout.

### Migrasi 0025 — Riwayat penerbitan QRIS

`payment_transactions` tetap satu baris per order. `invoice_issued_at` menyimpan waktu penerbitan QR terkini, sedangkan `created_at` tetap waktu pembuatan ledger. Trigger insert/update menyalin setiap nominal ke `payment_invoice_history` (kunci provider/order/nominal); reissue tidak pernah memakai kembali nominal milik order yang sama. Allocator mengutamakan nominal yang belum pernah dipakai. Jika pool mengharuskan pemakaian nominal order lain, webhook dan retry otomatis menolak lewat predikat bersama `DANA_AMOUNT_REUSED_SQL`; hanya verifikasi mutasi admin yang dapat melewati pemeriksaan reuse. Waktu event juga harus berada pada atau setelah `invoice_issued_at`, termasuk di dalam guard pelunasan atomik.

Migrasi mengisi riwayat yang masih tersedia. Untuk order dengan `qris_reissue_count>0` sebelum migrasi, nominal sebelumnya tidak bisa dipulihkan dari ledger: rentang harga dasar +1 sampai +299 dicatat di `dana_qris_legacy_ranges`, sehingga pembayaran dalam rentang itu memerlukan verifikasi manual. Order terminal tidak diaktifkan kembali. `publish-scheduled` tetap menyerahkan order yang memiliki ledger aktif ke cron operasi. Test integrasi menjalankan checkout → QR expired → kedua cron → reissue → webhook, juga pelepasan stok tepat sekali pada deadline order.

## 15. Warung Rebahan H2H Reseller Layer (Terimplementasi)

Axvara menjadi reseller layer di atas Warung Rebahan H2H API (`https://warungrebahan.com/api/v1`).
Blueprint lengkap: `docs/WARUNG-REBAHAN-INTEGRATION.md`. Implementasi Sep 2026 mencakup
Fase 1–4 (foundation, sync, auto-order, saldo+admin); storefront tidak diubah karena produk
WR masuk tabel `products`/`product_variants` yang sudah ada (badge "Stok Habis" existing dipakai).

### Arsitektur

- **Modul:** `src/lib/warung-rebahan/` — `client.ts` (fetch edge + HMAC webhook + error
  classification + mode proxy Opsi A), `sync.ts` (upsert produk/varian + exclusion +
  markup + agregat induk + sync cursor budget-aware), `order.ts` (link pending +
  claim/lease exact-once + retry backoff + reconcile stuck + reconciler lunas-tanpa-link),
  `deliver.ts` (enkripsi akun AES-256-GCM + delivery Telegram/WhatsApp/Web +
  token kapabilitas + antrean delivery durable + agregat order), `saldo.ts`
  (check + alert + estimasi).
- **Routes:** `POST /api/webhook/warung` (HMAC, rate-limit, monotonik + event log,
  selalu 200 pasca-verifikasi); pembeli `GET/POST /api/orders/[code]/credentials`
  (retrieval via verifikasi WA / capability token); admin
  `GET /api/admin/warung/saldo`, `POST /api/admin/warung/sync` (rate-limit products:write),
  `GET /api/admin/warung/sync-log`, `GET /api/admin/warung/orders` (ciphertext disamarkan,
  cari manual by invoice WR `?q=#RBHN-…` + tampilkan buyer Axvara untuk forward email WR),
  `POST /api/admin/warung/orders/[id]/retry` (CAS — race kalah → 409),
  `POST /api/admin/warung/orders/[id]/void` (2026-09-28: batalkan link WR tertahan → terminal `failed` + `last_error='cancelled_by_admin'`, CAS sama seperti retry; tanpa status baru agar CHECK tidak perlu ALTER),
  `POST /api/admin/warung/orders/[id]/sync-now` (2026-10-03, kasus F111FD64: tarik status SATU link processing langsung dari /transactions — webhook completed WR sering tidak sampai sehingga buyer menunggu 1 jam sia-sia; read-only upstream + idempoten, 409 bila status bukan processing/submitted/ordering),
  `GET/POST/DELETE /api/admin/warung/exclusions`, `GET/PUT /api/admin/warung/markup`,
  `GET/POST /api/admin/warung/credentials` (retrieval + resend admin).
- **Storefront:** `WrCredentialsPanel.tsx` di halaman pesanan (lunas): verifikasi
  No. WA atau email checkout (email sejak 2026-09-25; order tanpa email tidak pernah cocok) →
  tampilkan detail akun + capability token (sessionStorage). Setelah checkout di tab yang sama
  panel membuka otomatis memakai kontak checkout (`sessionStorage`
  `axvara-checkout-contact:<kode>` via `checkoutContactKey`). Sejak 2026-09-25 kontak itu
  TIDAK dihapus saat dipakai dan bertahan sampai tab ditutup: dulu muat ulang di tengah
  verifikasi pertama membuat token tidak pernah tersimpan (server tidak menerbitkan token
  kedua, `issueCredentialToken` idempoten) sehingga panel kembali ke form kosong. Token
  tersimpan yang ditolak server (401/403) dibuang lalu panel jatuh ke kontak checkout;
  429/5xx/jaringan tidak membuang token.
  Panel HANYA dirender bila `credentials_ready === true` dari `GET /api/orders?code=`
  (flag boolean: ada `wr_order_links` `completed` + `wr_account_details` ATAU item non-WR
   `delivered` bersalinan, dievaluasi hanya untuk order `lunas`, `.catch` → `false` pada D1
  pra-0027). Order lunas tanpa kredensial mendapat blok pengiriman berisi
  tujuan pengiriman (email checkout tersamar; WA hanya order lama tanpa email) — bukan
  form verifikasi yang pasti gagal `not_ready`. Judul + teksnya dinamis per cabang
  (`delivery.title`, revisi copy A/B/C1/C2 2026-10-02, copy email 2026-10-07):
  `fulfillment_status='delivered'` → "Pengiriman Produk" + order ber-email:
  "Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil
  di halaman ini." + cek spam/promosi; order lama tanpa email: "Produk sudah
  dikirim ke WhatsApp …" (tanpa cek spam);
  `queued_delivery` (C1 Made By Order, manual by design) → "Pesanan Made By Order" tanpa
  alasan stok + "Umumnya kurang dari 1 jam, maksimal 12 jam" (tanpa jam layanan spesifik);
  `instant_delivery` + `manual_required` (C2 instan-gagal) → "Pengiriman oleh Admin" +
  alasan "Stok otomatis habis, jadi admin menyiapkan manual" + plafon yang sama;
  **Pagar supplier (2026-10-13): kedua cabang C1/C2 di atas HANYA untuk order
  non-supplier.** Order supplier (`supplier_owned` dari flag API) tidak pernah
  menampilkan kalimat stok/admin/Made By Order — selama link supplier masih
  berjalan (`supplier_running`) tampilannya skeleton menyiapkan yang sama
  dengan stok sendiri, lalu "Pengiriman Otomatis" versi lambat. Akar insiden:
  pipeline fulfillment generik sempat memvonis item SK `manual_required`
  dalam jendela balapan sebelum link ter-bind, dan halaman salah
  menerjemahkannya sebagai stok habis;
  `instant_delivery` belum selesai → skeleton "Menyiapkan detail produkmu…" TANPA teks
  pengiriman selama ±30 dtk pertama (sore 2026-10-02: tanpa bacaan yang bisa hilang
  saat panel muncul), lewat ±30 dtk → "Pengiriman Otomatis" + "Masih mengirim otomatis
  — butuh waktu lebih lama" (tetap tanpa admin/12 jam; order ber-email ditambah
  kalimat email + halaman ini);
  selain itu (produk WR) → estimasi 5–15 menit.
  Selama `lunas && !credentials_ready`, halaman mem-poll `GET /api/orders?code=`: order
  `instant_delivery` yang belum `delivered`/`manual_required`/`failed` dicek rapat dulu
  2 dtk ×5 lalu 5 dtk ×4 (±30 dtk, 9 permintaan — tetap di bawah `orders:lookup` 20/mnt
  walau bertemu sisa polling pending 5 dtk; di produksi item terkirim 0–4 dtk setelah
  lunas), lalu tiap 20 dtk maksimal 30 kali (±10 mnt); antrean dan kirim otomatis yang
  diserahkan ke admin hanya 3 percobaan. **Sejak 2026-10-13 order supplier yang
  linknya berjalan ikut jadwal rapat yang sama**, dan setiap poll memicu tarikan
  status vendor di server (lihat "Penyegar status supplier" di bawah), sehingga
  panel muncul hitungan detik setelah vendor `COMPLETED` — paritas SK untuk WR.
  Retrieval tetap wajib verifikasi WA/email atau capability token.
  Display dinormalisasi di USE-time via `normalizeAccountDetailsForDisplay`
  (2026-09-18 sore, live): data lama tersimpan sebagai JSON mentah
  `{"product":..,"details":"email:..\r\npassword:.."}` diformat rapi di SEMUA
  kanal (panel, WA, email, Telegram) tanpa migrasi data — envelope dikupas
  (maks 3 lapis), `\r\n` dinormalisasi SEBELUM split, pembungkus
  `{product,details}` hanya memakai `details`-nya, label ganda dibuang.
  Ciphertext TIDAK diubah (format simpan tetap).
- **Kelas pengiriman + auto-order antrean (18 Sep 2026, live; sumber kebenaran
  delivery_mode API sejak 2026-10-11).** `wr_delivery_class`
  membedakan `restock` (instan) dari `made_by_order` (dikerjakan manusia di sisi
  supplier; estimasi supplier 6–12 jam, "<1 jam bila lancar"). Sejak 2026-10-11
  kelas diturunkan dari `delivery_mode` resmi API WR (`wr_delivery_mode`:
  auto→restock, manual/mixed→made_by_order; migrasi 0060) dan mengalahkan
  seed/tebakan/kunci admin — bukan lagi tebakan semata. Gate lama hanya
  meneruskan `restock`, sehingga link kelas antrean diam di `pending` selamanya:
  tidak ada request keluar dan pembeli menunggu sampai admin sadar. Sejak
  2026-09-18 SELURUH kelas diteruskan otomatis; `WARUNG_REBAHAN_AUTO_ORDER_MBO=false`
  adalah saklar mundur tanpa deploy. Satu sumber copy + ambang ada di
  `src/lib/warung-rebahan/delivery-class.ts`: `WR_QUEUED_MAX_HOURS = 12` (plafon
  janji pembeli), `WR_QUEUED_ALERT_HOURS = 13` (ambang alert internal, sengaja di
  atas plafon agar tidak alert fatigue), `deliveryEtaForBuyer()`, dan
  `isQueuedFulfillment()` (varian WR non-restock ATAU varian non-WR `manual`).
  Ekspektasi waktu WAJIB tampil SEBELUM bayar: PDP (badge, tanpa ikon
  checklist ganda sejak 2026-09-19) dan checkout (blok "Made By Order"
  dari flag `queued_delivery` per baris di respons quote; kalimat ETA modal
  dihapus 2026-09-19). `GET /api/orders?code=`
  mengirim `queued_delivery` dan `instant_delivery` (satu query gabungan dengan
  `credentials_ready`, CTE `lines` dari `json_each(orders.items)`), dan halaman pesanan memakainya untuk memilih
  teks serta memperpendek polling ke 3 percobaan (polling tidak mungkin menutup
  12 jam — kabarnya lewat WA/email). Nama supplier tidak pernah muncul di copy
  pembeli; keterangan "third-party independen" DIPERTAHANKAN di `/garansi-replace`
  sebagai dasar klaim garansi, dan masa garansi kelas antrean dinyatakan mulai saat
  detail akun diserahkan.
- **Pengawasan antrean (18 Sep 2026, live).** `notifyWebBuyerCredentialsReady()`
  mengantrekan pesan WA idempoten (`wr-web-ready:<order>`) saat detail akun siap
  untuk channel web — isinya kabar + tautan invoice. DM kredensial (`wr-delivery`,
  `wr-web-ready`) TANPA footer `/garansi` sejak 19 Sep (keputusan owner — perintah
  itu untuk grup via webhook `/garansi`, bukan DM buyer; handler grup tak tersentuh).
- **Pemantauan wajib sepekan (19–26 Sep 2026, keputusan owner).**
  Setiap hari cek: (1) sweep sync tercatat (`wr_sync_log trigger='cron'`
  tiap ~30 mnt, bukan hanya `manual`); (2) `whatsapp_outbox` tanpa `failed/dead`
  ber-`last_error='whatsapp_not_connected'` (tanda gateway 401 loop kambuh);
  (3) `wr_order_links` tanpa `delivery_status` menggantung di `queued/failed/sending`
  melewati backoff; (4) pairing ulang gateway HANYA dengan sesi yang sama
  (jangan hapus kunci auth manual — sesi `registered:false` + `me.id` terisi
  = minta pairing code baru di HP yang sama via `pair-d1.ts`, bukan sesi mati).
  Bila `connected:false` >30 menit → restart dyno (`heroku restart`), bila 401 loop
  persisten → pairing ulang + catat di CHANGELOG.
- **Kredensial 3 jalur (18 Sep 2026, live — keputusan owner, Fase B).** Isi
  detail akun dikirim LANGSUNG, bukan hanya kabar: (a) WA via outbox durable
  (`deliverWebCredentialViaWhatsApp`, kunci `wr-delivery:<code>[:pN]`, potong
  1500 char/bagian, hanya DM `customer_wa`); (b) email via Resend
  (`deliverWebCredentialViaEmail`, template "Detail Akun Siap" berisi isi +
  peringatan jangan bagikan, idempoten `wr-cred-email:<code>` di
  `wr_email_forward_log`, migrasi 0038 membuka kind `credential_ready` +
  channel `email-credential` — CHECK lama menolak INSERT diam-diam sehingga
  retry mengirim ganda, tertangkap test sebelum live; pembeli tanpa email
  dilewati diam); (c) panel web: `WrCredentialsPanel` dipakai ulang di hasil
  `/lacak-pesanan` dengan `prefillWa` dari input lookup + auto-verify sekali
  (verifikasi tetap di server via `/api/orders/[code]/credentials`; lookup
  sudah `constantTimeEqual` penuh sehingga setara halaman pesanan).
  `formatWrAccountDetails` memakai key map normalisasi (`akses otp`/URL/
  username tampil rapi, key asing dikapitalisasi — bukan JSON mentah).
  Aturan settled: dua-duanya gagal = throw agar retry; satu gagal = catat
  `web_push_partial` tapi settled (token + panel tetap jalan).
  `alertAgingWrOrders()`
  memberi tahu admin via Telegram bila link masih `processing/submitted/ordering/claimed`
  melewati `WR_QUEUED_ALERT_HOURS`, idempoten lewat kolom `aging_alerted_at`
  (migrasi 0037) dan ditandai SEBELUM kirim agar kegagalan notifikasi tidak
  menghasilkan ping berulang tiap 5 menit. Panel admin menampilkan umur tiap baris
  antrean (merah + "lewat batas" di ≥13 jam). Ambang alert saldo default naik
  50.000 → 250.000 karena modal varian termahal Rp200.000 — ambang lama memberi
  rasa aman palsu saat auto-order kelas antrean dibuka.
- **Admin UI:** tab "Warung Rebahan" (`WarungRebahanManager.tsx`, section `warung` di
  `AdminShell` + `admin/page.tsx`): **tab dalam-halaman Ringkas/Antrean/Markup/Aturan (2026-10-01, cermin SystemTabs)** — Ringkas default (saldo + estimasi + sync terakhir + force sync), Antrean (order + retry + void + pagination 20 + total, sandbox SK di tab Antrean SK), Markup (sub-tab status Live/Hidden/Off + badge + pagination 20/50/100, tombol Simpan tetap ada di semua tab), Aturan (exclusions). Lazy-load per tab (fetch saat dibuka pertama, cache + guard ref anti-fetch-ganda; mount hanya Ringkas). Antrean order + retry + void (tombol Batal → terminal `failed` + `last_error='cancelled_by_admin'`, CAS; 2026-09-28), exclusions, markup per varian. **Bulk markup (2026-10-01):** `POST /api/admin/warung/markup/bulk` — 1 request untuk ≤200 varian (formula harga SAMA dengan PUT satuan via `calculateSellPrice`; default hanya % yang berubah, Rp dipertahankan kecuali `update_fixed=true`; respons jujur `{ updated, failed[] }`; harga katalog ikut berubah) + toolbar bersama `BulkMarkupToolbar.tsx` (checkbox per baris + "Set semua tampil" + preset 20/30/50 + % manual + reset Rp + konfirmasi hitungan eksplisit). **API markup (2026-10-01):** `variant_status` + `variant_reason` per baris (hierarki off > kalah > tanpa-katalog > habis > live) + `total` hasil filter, limit 200 (1 fetch, filter klien). **API orders (2026-10-01):** `total` + `page` + `per_page` (halaman 2+ dulu hilang). Komponen bersama `SupplierTabs.tsx` (tab + `VariantStatusBadge`). Auto-revive `blocked_balance` dibatasi umur 24 jam (`WR_BLOCKED_MAX_AGE_HOURS`) + hanya order lunas; buyer dikabari sekali saat masuk blocked (idempoten `wr-blocked:<kode>`). Antrean order punya kolom cari
  invoice WR (`#RBHN-…` / kode Axvara, debounce 400ms, LIKE di-escape) +
  baris buyer (nama · WA · email · channel) — jembatan manual forward email WR
  ke buyer Axvara sebelum bot email otomatis fase 2. Health WR ikut `GET /api/admin/bot/health`.
- **Cron:** fase baru `warung_rebahan` disisipkan `fulfillment → warung_rebahan → notify`
  (`src/app/api/cron/operations/route.ts`): sync produk tiap 30 mnt, proses order due (maks 4),
  reconcile processing >1 jam via `/transactions` + reconcile FRESH processing >3 mnt
  (2026-10-03, kasus F111FD64: webhook completed WR sering tidak sampai padahal
  dashboard WR sudah COMPLETED hitungan menit setelah lunas — maks 4 link/run,
  read-only + idempoten), cek saldo tiap 1 jam. COUNT WR dihitung
  query terpisah agar DB pre-migrasi tidak meruntuhkan query gabungan; fase no-op bila
  master switch mati atau tabel WR belum ada.
- **Budget WAKTU sweep katalog (akar "sync tersendat", diperbaiki 2026-09-20):** sweep penuh
  = 48 produk / 87 varian = **~366 query D1 berurutan**, sehingga durasinya ditentukan latensi
  D1, bukan jumlah pekerjaan. Terukur di produksi dengan beban identik: **12 dtk saat D1 sehat
  (~33 ms/query) vs 115-122 dtk saat D1 lambat (~314 ms/query)**; 68 dari 391 sweep (17%)
  melewati deadline run 45 dtk. Run yang terpotong mati SEBELUM ekor menulis `wr_sync_log` +
  penanda fase, sehingga sweep tak tercatat, fase terkunci, dan jeda sync melonjak 39-40 mnt
  → 163/305 mnt. Aturan sekarang: `syncProducts` menerima `timeBudgetMs` dan mengecek sisa
  waktu TIAP iterasi memakai latensi terukur run itu sendiri (adaptif, bukan konstanta), lalu
  berhenti di produk utuh terakhir + simpan cursor + `budgetYielded=true` — jalur yang sama
  dengan saat budget query habis. Cron mengoper `timeLeftMs() - TIME_WR_SWEEP_RESERVE`
  (cadangan 8 dtk untuk reconcile/saldo/delivery + ekor). Force Sync admin sengaja TIDAK
  memasang `timeBudgetMs` (bukan invocation cron yang dibunuh platform).
  **Pelajaran:** gerbang budget query saja tidak cukup — biaya nyata sweep adalah WAKTU,
  dan seluruh perbaikan sebelumnya hanya mengatur KAPAN sweep dimulai.
- **Batching D1 sweep katalog (akar latensi, diperbaiki 2026-09-22):** butir di atas
  mengelola AKIBAT (sweep berhenti sebelum dibunuh); butir ini memangkas SEBABNYA.
  Terukur: `sql_duration_ms` D1 produksi hanya **0,12–0,19 ms**, tetapi sweep memakai
  **~197 ms per query** — jadi **99,9% durasi sweep adalah menunggu jaringan**, bukan
  kerja database. Penyebabnya D1 primary di **SIN** (`served_by_colo: SIN`,
  `read_replication: null`) sementara Pages Function jalan di colo terdekat pemanggil,
  sehingga tiap round-trip menyeberang benua. Bukti beban IDENTIK (48 produk/87 varian):
  **8.551 ms (178 ms/produk) vs 122.473 ms (2.552 ms/produk)** — selisih 14x tanpa
  perubahan pekerjaan. Perbaikan: tulis satu produk dikumpulkan sebagai rencana
  (`SqlWrite`) lalu dikirim SATU `d1.batch()`, dan baris pembanding (`wr_variants` +
  registry `wr_products` + verifikasi tautan katalog) di-prefetch massal via `IN (...)`
  (dipotong per 50 id — D1 menolak >100 bound parameter). Terukur pada fixture 48/87:
  **642 → 117 round-trip (−82%)** dengan baris tertulis tetap 12 (guard kuota tidak
  bergeser). **Cakupan batch SENGAJA per produk, bukan per sweep:** `batch()` adalah
  transaksi, jadi satu produk bermasalah tidak boleh membatalkan produk lain — jalur lama
  mencatat error per produk lalu lanjut, dan sifat itu dipertahankan. Varian/produk BARU
  tetap berurutan karena butuh `lastInsertRowid` untuk menautkan barisnya. Bila `batch()`
  gagal, tulis diulang satu per satu agar statement `optional` (dulu `.catch()`) kembali
  toleran seperti sebelum batching. Efek samping penting: round-trip yang turun ikut
  menurunkan CPU — produksi mencatat **270 invocation `exceededResources` dengan
  `cpuTimeP50` mentok 10.000 µs**, yaitu plafon CPU Workers Free, pada irama cron 5 menit.
  Karena itu **menaikkan `RUN_DEADLINE_MS` justru berbahaya** (lebih banyak produk per run
  = lebih banyak CPU = lebih banyak run dibunuh sebelum menulis log); pengikatnya CPU dan
  round-trip, bukan deadline. Dikunci oleh
  `tests/warung-rebahan/sync-roundtrip.regression.test.ts`.
- **Kejujuran status pengiriman + jalan keluar admin (audit UX 2026-09-22):** pola akar yang
  ditutup di sini bukan satu bug, melainkan **server sudah tahu jawabannya tetapi UI
  membuangnya**. (1) `deliverWhatsAppCredential` dulu `return` diam saat kill-switch
  `WHATSAPP_CREDENTIAL_DM_ENABLED` mati, sehingga `processCredentialDelivery` tetap menulis
  `delivery_status='delivered'` walau NOL pesan terkirim — pembeli kanal WhatsApp melihat
  "Selesai" dan menerima nihil. Kini **throw** (`whatsapp_credential_dm_disabled`) → retry →
  `failed` → antrean handover. Bedakan tegas dengan `deliverWebCredentialViaWhatsApp` yang
  MEMANG boleh skip diam: kanal web punya token capability + panel pesanan + email sebagai
  jalur pengambilan, kanal WhatsApp tidak punya jalur lain. (2) `fulfillment_status='failed'`
  (ditulis `warung-rebahan/order.ts` saat attempt WR habis dan `deliver.ts` saat delivery
  habis 5 percobaan) tidak punya tombol apa pun di admin padahal
  `recordManualHandoverDetailed` menerimanya — order lunas yang gagal kirim = jalan buntu
  yang hanya bisa dipulihkan lewat operasi DB. (3) Jalur fulfillment modern
  (`delivery/send.ts:processItem`) membuang `adminChatId` dengan `void`, jadi kegagalan
  terminal tidak pernah membunyikan Telegram — padahal jalur legacy mengirimnya; kini
  `scheduleItemRetry` mengembalikan `true` HANYA pada transisi terminal (berbasis
  `meta.changes`, sehingga fence yang kalah race tidak mengirim alert ganda). (4) Gerbang
  retry link WR di UI **terbalik** terhadap API: `blocked_balance` (retryable,
  `attempt_count` masih 0) tak pernah dapat tombol, sedangkan `failed` selalu dapat tombol
  padahal route menolaknya dengan `max_attempts_reached` — `failed` hanya ditulis ketika
  `attempt >= max_attempts`. Kini UI memakai `RETRYABLE_WR_STATUS` yang wajib identik dengan
  `RETRYABLE` route plus cek kuota percobaan, dan status `claimed`/`submitted`/
  `blocked_balance` akhirnya punya label + bisa difilter (`allowed` di
  `admin/warung/orders`). (5) Approve screenshot QRIS membalas `payment_updated:false`
  (QRIS Hook tetap otoritatif) tetapi admin selalu melihat toast "dikonfirmasi lunas" —
  kabar palsu yang bisa memicu pengiriman sebelum uang masuk. (6) `proofRejectionReason` dan
  `fulfillment_status` sudah di-parse `normalizeOrder` tetapi tidak pernah dirender; modal
  Detail juga kehilangan tombol Tolak + handover sehingga alur wajar "buka Detail untuk
  memeriksa dulu" justru mematikan aksinya. (7) Produk WR: blok harga/stok **mode single**
  tidak ikut terkunci seperti Nama/Slug, jadi admin yang mematikan toggle Variasi mengedit
  nilai yang dijamin ditolak 409; dan `field` pada respons 409 dibuang sehingga admin tidak
  tahu field mana pemicunya. Dikunci oleh `tests/admin-ux-dead-end.regression.test.ts`,
  `tests/admin-failed-order-actionable.behavior.test.tsx`, dan
  `tests/warung-rebahan/wa-credential-killswitch.regression.test.ts`.
- **Pembeli berhenti menunggu dalam sunyi + atomisitas jalur uang (audit ronde 2, 2026-09-23):**
  ronde 1 menutup kebohongan status di sisi ADMIN; ronde 2 menemukan lubang yang sama di sisi
  PEMBELI. (1) `handleOrderCancel` (Telegram) dulu memulihkan stok LEBIH DULU, lalu
  `UPDATE orders` bergerbang `status='pending'`, lalu `UPDATE payment_transactions` **tanpa
  gerbang apa pun**. Bila webhook DANA melunasi order tepat di sela itu: stok menggelembung,
  order tetap sah `lunas`, tetapi ledger-nya ditimpa `cancelled` — order lunas tanpa transaksi
  `paid`, fulfillment yatim. Kini pembatalan **mengklaim lebih dulu** (CAS `status='pending'
  AND payment_status IN ('unpaid','pending')`); bila kalah balapan, handler berhenti tanpa
  menyentuh stok maupun ledger, dan UPDATE ledger diberi gerbang
  `status IN ('pending','unpaid','expired')` agar baris `paid` tidak pernah tertimpa.
  (2) **Harga basi**: token quote berlaku 1 jam (`createCheckoutQuoteToken`) sementara sync WR
  menulis ulang harga varian tiap ~5 menit; `sameItems` hanya menyamakan identitas + qty dan
  `createOrderWithStock` **tidak punya satu pun guard harga**, sehingga order + invoice QRIS
  bisa terbit dari `quote.subtotal` yang usang (harga naik = toko rugi, turun = pembeli
  dirugikan). Kini harga DB dibandingkan dengan harga quote → `409 price_changed`, dan
  checkout memuat ulang quote agar pembeli melihat nominal baru, bukan buntu di pesan error.
  (3) **Kabar ke pembeli** lewat `src/lib/notify-buyer.ts` (kanal ditentukan dari
  `orders.sales_channel`; Telegram hanya ke chat pribadi terverifikasi, **web lewat email
  Resend sejak 2026-09-24** (lihat entri audit ronde 4), WA lewat outbox durable yang
  idempoten): serah terima manual dulu menandai item `delivered` tanpa satu pun
  pesan padahal pesan lunas Telegram sudah berjanji "Produk akan dikirim admin melalui DM
  Telegram pribadi ini"; penolakan bukti hanya menulis `status='rejected'` sehingga pembeli
  melihat "Pending" selamanya tanpa alasan; dan persetujuan screenshot QRIS membalas
  `payment_updated:false` (Hook tetap otoritatif) tanpa memberi tahu pembeli harus menunggu
  apa. Semua kabar best-effort dan tidak pernah melempar — kegagalan kirim tidak boleh
  membatalkan serah terima/review yang sudah sah tercatat. (4) **Guard order ganda**: jalur
  keranjang menegakkan satu pending per chat, tetapi beli-langsung dan katalog hanya
  mencocokkan `variant_id` — satu chat bisa memegang 2 order pending + 2 QRIS aktif dengan
  stok tertahan ganda. Kini ketiganya per-chat, dengan varian yang sama tetap diprioritaskan
  agar kirim-ulang invoice (RR3-05) tidak bergeser. (5) Pencocokan produk pending memakai
  `items LIKE '%"product_id":1%'` yang juga cocok dengan `10`/`11`/`100` karena JSON tersimpan
  tanpa spasi — pembeli produk #10 ditolak gara-gara pending produk #1; kini LIKE berpembatas.
  Dikunci oleh `tests/buyer-silence-and-atomicity.regression.test.ts`.
- **Audit ronde 3 — nama pembeli, uang tanpa pasangan, dan kegagalan yang terlihat (2026-09-23):**
  **Prioritas kanal (keputusan owner):** WEB + TELEGRAM wajib sempurna; WhatsApp bukan kanal
  utama untuk 2-5 bulan ke depan (bot sedang mati, grup dikunci admin-only), jadi temuan
  khusus-WA sengaja TIDAK dikerjakan. (1) Revamp checkout `3d83dd9` menghapus field nama dan
  memakai `email.split("@")[0]` mentah sebagai `customer_name` — prefix email BUKAN nama:
  `budi123@…` tersimpan sebagai "budi123" dan `first.last+promo@…` sebagai
  "first.last+promo", lalu merembes ke sapaan halaman pesanan, notifikasi Telegram admin,
  prefill tombol WA follow-up, pencarian admin, dan ekspor CSV. Kini `deriveNameFromEmail`
  (`src/lib/utils.ts`) membuang plus-addressing + angka, mengubah pemisah jadi spasi, lalu
  mengapitalkan; UX revamp (form tanpa nama) dipertahankan, dan nama yang diisi pembeli
  sendiri TIDAK PERNAH disentuh. (2) Cabang `unmatched` webhook DANA dulu berakhir sunyi
  total — uang MASUK tetapi tidak cocok dengan invoice mana pun, pembeli menunggu sampai
  order kedaluwarsa dan admin hanya tahu bila mengintip `dana_webhook_events`. Kini admin
  di-ping Telegram dengan nominal + sebab (`amount_reused_requires_review` /
  `event_predates_invoice` / `no_active_exact_amount`); ack webhook tetap 2xx agar DANA tidak
  retry. (3) Kegagalan pengiriman terminal kini mengabari PEMBELI
  (`notifyBuyerDeliveryFailed`), bukan hanya admin, dan halaman lacak pesanan membedakan
  lunas-terkirim dari **lunas-tetapi-gagal-kirim** — `/api/orders/lookup` sudah mengembalikan
  `fulfillment_status`, tetapi halaman itu dulu hanya membaca status pembayaran sehingga
  order gagal tampil hijau "Lunas" selamanya (pembeli yang menghapus chat jadi buta total).
  **DITOLAK setelah ditelaah:** klaim "retry WR spam-klik = amplifikasi upstream" — usulannya
  (`attempt_count+1` di route retry) justru MENGHITUNG GANDA karena penaikan counter milik
  worker saat mengklaim dan `handleInsufficientBalance` sengaja mengembalikannya; amplifikasi
  sendiri sudah tertutup CAS (klik bersamaan → 409, dikunci
  `admin-retry-race.regression.test.ts`) dan status `claimed` yang bukan anggota `RETRYABLE`
  (klik berurutan → 409). Dikunci oleh `tests/round3-name-and-money-silence.regression.test.ts`.
- **F7 — pengingat kedaluwarsa QRIS akhirnya sampai ke pembeli WEB (2026-09-23):**
  `QRIS_EXPIRY_NOTICE_WHERE` dulu memfilter `sales_channel IN ('telegram','whatsapp')` sehingga
  kanal web tidak pernah masuk hasil query. Ironisnya justru pembeli WEB yang boleh
  memperpanjang QRIS (`qris_reissue_allowed` hanya mengecualikan WhatsApp, dan gerbang
  `reissueDanaQrisInvoice` memakai `sales_channel!='whatsapp'`), tetapi mereka tidak pernah
  diberi tahu bahwa QR-nya hangus — baru tahu bila kebetulan membuka halaman lagi; tab yang
  sudah ditutup berarti tidak tahu sama sekali. Kebalikannya terjadi di WhatsApp: hanya dapat
  kabar terminal, tidak pernah kabar "masih bisa diselamatkan".
  Jalur untuk web adalah **email (Resend, `sendForwardEmail`)** karena web tidak punya kanal
  chat; email selalu terisi untuk order web sejak revamp checkout 2026-09-23 mewajibkannya.
  Dua nada dipisah sesuai apa yang masih bisa dilakukan pembeli: renewable = ajakan menekan
  "Perpanjang QRIS" di `/pesanan/[code]`, terminal = pesanan sudah mati. Kegagalan kirim tidak
  menandai, agar cron berikutnya mencoba lagi. Dikunci oleh
  `tests/qris-expiry-web-email.integration.test.ts`.
- **Perbaikan antrean notifikasi kedaluwarsa (2026-09-23, live bersama F7 12:58 UTC):**
  8 menit setelah F7 live, antreannya terlihat tersumbat permanen. Migrasi 0026 hanya menandai
  riwayat `terminal` saat kolom dibuat, sehingga 8 order web yang expired sesudahnya (15–23 Sep)
  langsung ikut antre saat kanal web dimasukkan. Dua baris terdepan (urutan terlama-dulu,
  `LIMIT 2`) tidak punya email. Baris tanpa email dulu dilewati tanpa menandai, jadi keduanya
  terpilih ulang setiap cron dan tidak ada notifikasi lain, termasuk Telegram, yang bisa lewat.
  Aturan sekarang, semuanya di `QRIS_EXPIRY_NOTICE_WHERE` sehingga hitungan `qris_notice` cron
  ikut akurat: (1) antrean **hanya berisi baris yang punya tujuan kirim** (web: email; Telegram:
  chat id; WA: conversation). Baris tanpa tujuan tidak dipilih, tidak memakan query, dan tidak
  ditandai, jadi bila email terisi kemudian kabarnya tetap terkirim. Menandainya justru
  memakan kuota query yang dibutuhkan fase expiry (dikunci `cron-budget.integration.test.ts`);
  (2) cabang terminal hanya untuk order dengan `orders.expires_at` <24 jam, karena kabar
  "pesanan kedaluwarsa" yang basi hanyalah spam; (3) urutan: renewable dulu, lalu
  `pt.expires_at` **terbaru** dulu, supaya baris yang gagal terus (bot diblokir, email
  ditolak) tenggelam ke belakang dan tidak menahan kabar baru. Dikunci oleh
  `tests/qris-expiry-queue-blocking.regression.test.ts`.
- **Audit ronde 4 — kabar kegagalan akhirnya sampai (2026-09-24, PR ronde 4):**
  (1) **Kabar pembeli kanal WEB lewat email.** `sendToBuyer` dulu mengirim kabar web lewat
  outbox WhatsApp, padahal bot WA mati (outbox produksi 18–19 Sep: 3 baris `dead`,
  `whatsapp_not_connected`). Akibatnya serah terima, bukti ditolak, bukti menunggu Hook,
  dan gagal kirim **tidak pernah sampai** ke pembeli web. Kini web → email Resend ke
  `orders.customer_email` (wajib sejak revamp checkout); order web lama tanpa email tetap
  jatuh ke outbox WA. Email dan DM Telegram diberi kunci idempoten di tabel baru
  **`buyer_notice_log`** (migrasi 0039: `idempotency_key` PK, `channel` email/telegram,
  `status` sending/sent/failed). Baris `failed` dan `sending` basi >10 menit boleh diklaim
  ulang. Teks email tanpa ajakan "balas pesan ini" (pengirim noreply), menautkan
  `/pesanan/[code]`, timeout 8 dtk. (2) **Kegagalan WR mengabari pembeli (T-H1).**
  Dulu `handleWrOrderFailed` dan jalur percobaan-habis di `order.ts` hanya mem-ping
  admin; `notifyBuyerDeliveryFailed` di `send.ts` tidak pernah tercapai untuk item WR
  (`return false` sebelum lease). Kini `refreshOrderAggregate` mengabari pembeli saat
  agregat pertama kali menjadi `failed` (titik tunggal untuk webhook, reconciler, dan cart
  campuran), dan jalur percobaan-habis ikut memanggilnya; ledger menjaga satu kabar per
  order. (3) **Tanda terima pembayaran web (B-H1):** `ensureFulfillmentForPaidOrder`
  mengirim email "Pembayaran diterima" untuk kanal web (idempoten
  `payment-received:<code>`, tanpa fallback WA). (4) **`/pesanan/[code]` mengenal gagal
  kirim (W-H1):** `GET /api/orders?code=` dan `/api/orders/[code]` kini mengembalikan
  `fulfillment_status`; halaman tidak lagi merayakan "Pembayaran Dikonfirmasi 🎉 … 5–15
  menit" untuk order `failed`, melainkan status merah + langkah hubungi admin (pola
  `/lacak-pesanan`). (5) **Antrean kedaluwarsa (B-H2/B-H3):** peringkat dihitung per jalur
  (`ROW_NUMBER() OVER (PARTITION BY status='pending')`), jadi renewable yang gagal terus
  tidak lagi menahan kabar terminal; `hasTime(10 dtk)` dicek sebelum tiap kiriman dan email
  kedaluwarsa memakai timeout 8 dtk (dulu 20 dtk × 2 bisa melewati deadline run 45 dtk).
  (6) Handover mengembalikan `buyer_notified` dan panel admin menampilkan peringatan bila
  kabar gagal (T-M5). (7) Telegram: `wa_after_paid` hanya menangkap teks mirip nomor
  telepon sehingga tombol menu tidak lagi dibalas "Nomor WA tidak valid" (T-M4); label
  harga tombol memakai `buttonPrice` (nominal utuh bila bukan kelipatan ribuan, dulu
  Rp7.500 tampil "Rp8rb") (T-M3). **Ditolak setelah diverifikasi:** email-gate Telegram
  "fail-open saat DB timeout" (T-H3; setiap query sudah `.catch(() => null)` dan
  `wr_type` dimuat dari varian, jadi timeout justru membuat bot MEMINTA email), hero
  search mati (W-M1; `Hero.tsx` tidak dirender di mana pun, homepage memakai
  `OrbitHero`), dan `ctaDisabled` hardcode QRIS (W-M4; `submit()` sendiri meng-hardcode
  `payMethod="qris"`, jadi checkout memang sengaja QRIS-only). Dikunci oleh
  `tests/round4-buyer-notices.regression.test.ts`, `tests/round4-telegram.regression.test.ts`,
  `tests/order-page-delivery-failed.behavior.test.tsx`, dan
  `tests/qris-expiry-queue-blocking.regression.test.ts`.
- **Permintaan owner 2026-09-24 — pengingat pesanan, SEO & GEO, katalog Telegram (PR 2026-09-24):**
  (1) **Pengingat melayang pesanan belum dibayar** (`src/components/storefront/PendingOrderReminder.tsx`,
  dipasang di layout root): membaca kode pesanan terbaru dari salinan lokal checkout
  (`axvara-orders`, hanya yang dibuat <30 menit — order QRIS mati 15 menit sejak 2026-10-11), lalu **selalu** memastikan status + tenggat ke
  `GET /api/orders?code=` (salinan lokal tidak pernah diperbarui dan bisa sudah dibayar dari
  perangkat lain). Tampil dengan hitung mundur QRIS (atau tenggat pesanan bila QR hangus dan
  perpanjangan masih boleh), satu ketukan ke `/pesanan/[code]`; disembunyikan di `/checkout`,
  `/pesanan/*`, `/admin`; cek ulang tiap 30 dtk saat tab terlihat (jauh di bawah limit
  `orders:lookup` 20/mnt); tombol ✕ menyembunyikan per pesanan per sesi. Salinan lokal checkout
  tidak lagi menyimpan WA/email pembeli. (2) **SEO & GEO:** beranda dirender server (HTML dulu
  "0 produk" tanpa link produk — crawler tanpa JS/crawler AI melihat toko kosong); JSON-LD
  Organization + WebSite + ItemList; default OG/Twitter dengan gambar `public/og/axvara-og.png`
  1200×630 (tanpa canonical/og:url di root agar tidak diwarisi semua halaman); JSON-LD produk
  memakai URL gambar absolut (dulu relatif `/r2/...`, ditolak Google) dan AXVARA sebagai
  `offers.seller` (bukan `brand`); **artikel kini punya `generateMetadata`** (dulu semua artikel
  berjudul beranda, tanpa canonical/gambar); canonical di halaman statis; `/checkout` dan
  `/pesanan/*` noindex (layout segmen); `robots.txt` menutup halaman transaksi, membuka
  `/api/products|categories|store-settings` untuk renderer Google, dan mengizinkan crawler AI
  secara eksplisit; `/llms.txt` baru. (3) **Katalog Telegram** hanya produk yang bisa dibeli
  (produksi 24 Sep: 20 dari 48 produk tersedia; 28 lainnya jalan buntu). (4) **Paginasi katalog
  Telegram tidak lagi membuat pesan baru:** `safeEditOrSend` dulu mengirim pesan baru untuk
  kegagalan edit apa pun; ketuk ▶️ dua kali = dua callback halaman yang sama → edit kedua ditolak
  `message is not modified` → pesan katalog baru. Kini "not modified" = berhasil, dan fallback
  pesan baru hanya untuk HTTP 400 (pesan target foto/terhapus), tidak untuk 429/5xx/timeout.
  Tombol produk yang sudah nonaktif dijawab, bukan diam. Dikunci oleh
  `tests/telegram-catalog-stock.regression.test.ts`, `tests/telegram-safe-edit.regression.test.ts`,
  `tests/seo-geo.regression.test.ts`, `tests/home-ssr-catalog.behavior.test.tsx`, dan
  `tests/pending-order-reminder.behavior.test.tsx`.
- **Hook payment:** setelah lunas di 4 jalur (webhook DANA, retry admin, approve bukti,
  konfirmasi admin) → `createWrOrderLinksForOrder` + `processWrPendingOrders` best-effort;
  cron memproses sisanya. Produk WR dikenali dari `product_variants.wr_variant_id`.
  **2026-10-09 (kasus AXV-20261009-DA1ACF56):** webhook bisa gagal tepat di langkah
  create-link (lunas durable, link tidak ada, COUNT due = 0) → gate `due > 0` di cron
  menutup `processWrPendingOrders` yang di dalamnya ada `reconcileMissingWrLinks` →
  yatim selamanya. Probe yatim (`reconcileMissingWrLinks`/`reconcileMissingSkLinks`)
  kini jalan TANPA gate due di lite `wr_orders`/`sk_orders` (hasilnya ikut membuka gate
  proses + kunci respons `orphan_links_healed`) dan di fase route besar
  (`wr_orphan_links_healed`/`sk_orphan_links_healed`); SK cermin WR.

### Skema (migrasi 0027 Ralph: final = 0027 + 0028 + 0029; schema.sql bootstrap)

`wr_products` (registry + link `axvara_product_id` + flag excluded), `wr_variants`
(registry + `markup_percent/fixed` + `axvara_sell_price` + link varian), `wr_order_links`
(order Axvara ↔ order WR, **exactly-once**: pending→claimed→submitted→ordering→
processing→completed/failed, retry/blocked_balance, `idempotency_key` UNIQUE,
lease `lease_owner/lease_expires_at` 5 mnt, kunci `request_sent_at` anti-resend,
delivery durable `delivery_status/attempt_count/next_attempt_at`, akun terenkripsi,
`fulfillment_item_id` milik fulfillment per-item), `wr_sync_log`, `wr_saldo_log`,
`wr_exclusions` (**KOSONG** — seed Canva/Gemini 0027 dihapus 0028), `wr_sync_state`
(cursor/generation/snapshot sync), `wr_credential_tokens` (hash + expiry 30 hari +
revoke), `wr_webhook_events` (log monotonik anti-replay).
Kolom baru: `products(source, wr_product_id, wr_auto_managed)`,
`product_variants(wr_variant_id, wr_auto_managed)`,
`fulfillment_items(wr_link_id)` — item milik WR diselesaikan via link, dilewati
`processItem` generik; agregat order di-refresh dari item (bukan status link).
Varian hilang dari API di-nol-kan stoknya (tidak dihapus). Seluruh tabel di atas
ada di `drizzle/schema.sql` — bootstrap baru langsung final tanpa migrasi manual.
Migrasi 0030 menambahkan `products.admin_description_override` (lihat kepemilikan
field di bawah).

### Kepemilikan field produk WR (migrasi 0030)

Sync menimpa field miliknya setiap sweep, jadi batas kepemilikan ditegakkan di
API (`src/lib/warung-rebahan/ownership.ts`), bukan hanya disable input di UI —
agent CMS, curl, dan tab admin lama tidak terikat aturan UI.

| Pemilik | Field |
| --- | --- |
| WR (read-only di admin) | `name`, `slug`, `description`, harga & stok master, label varian, harga varian, stok varian, durasi, garansi, S&K varian (`terms`) + cara aktivasi (`delivery_terms`, read-only dari `wr_variants`) |
| Admin | foto/`images`, `badge`, kategori, `sort_order`, `is_active`, `admin_description_override`, S&K + cara aktivasi versi admin per varian (`product_variants.admin_terms`/`admin_activation`/`admin_copy_fingerprint`, migrasi 0041; varian WR tetap hanya lewat `PUT /api/admin/variant-copy`, stok sendiri juga lewat batch Simpan Produk), **harga coret (`compare_price`)** — milik admin agar katalog WR bisa pasang diskon/badge seperti produk manual (2026-09-17); insiden Alight/Viu 2026-10-06: harga jual baru yang menyamai/melampaui coret lama DITOLAK CHECK `compare_price > price` sehingga UPDATE katalog gagal (markup panel 200 OK tapi storefront macet — `.catch` menelan error D1, registry berubah, `product_variants.price` tetap). Kini SETIAP tulis harga (PUT/bulk markup WR+SK + sweep sync WR+SK) me-NULL-kan coret yang tak lagi membentuk diskon valid (`CASE WHEN compare_price <= harga_baru THEN NULL`) — coret basi hilang, coret valid dipertahankan. Sync TETAP tidak menulis coret baru (hanya NULL-kan yang basi agar harga otoritatif tembus); input Harga Coret di modal edit selalu terbuka (label "✎ bisa diedit") |
| Panel WR | markup (`wr_variants.markup_percent/markup_fixed`) |

Guard dipasang di **kedua jalur tulis varian**: `PUT /api/products/:id` dan
`/api/admin/variants` (PUT tunggal + POST batch, dipakai `VariantEditor`).
Menutup hanya salah satunya tidak cukup — panel varian lama akan tetap
menjadi pintu belakang untuk perubahan yang pasti hilang di sweep berikutnya.

`PUT /api/products/:id` membalas **409** dengan `{error, field}` bila request
mengubah field WR-owned pada produk `wr_auto_managed=1`; mengirim ulang nilai
yang sama tidak dianggap pelanggaran (form admin mengirim payload utuh).
`admin_description_override` adalah teks milik admin: bila terisi, itulah yang
tampil di storefront dan `GET /api/products`; sync TIDAK PERNAH menulis kolom
tersebut. Resolusi "override menang atas `description`" dipusatkan di
`displayDescription()` pada `src/lib/catalog.ts`, sehingga **seluruh kanal**
(web, PDP `/produk/[slug]` termasuk meta SEO/Open Graph/JSON-LD, `/api/catalog`,
bot Telegram, bot WhatsApp) menampilkan teks yang sama — bukan hanya web.
Setiap pembaca deskripsi produk baru WAJIB memakai helper ini, bukan membaca
kolom `description` langsung. `GET /api/products/:id` memisahkan keduanya
(`description` = teks yang tampil, `wrDescription` = teks WR,
`adminDescriptionOverride`, `wrManaged`).
Badge "WR • dikelola otomatis" hanya tampil di editor produk admin — storefront
tidak menampilkan penanda WR apa pun.

### S&K varian WR di PDP (tanpa migrasi) + label garansi kanonis

S&K WR adalah data **per varian** (`terms` + `delivery_terms`, 87/87 dan 37/87
varian terisi di prod) yang hidup di tabel cermin `wr_variants` milik sync.
`product_variants` sengaja TIDAK diberi kolom baru (hindari dual-write/drift):
`getProductDetail`/`getActiveVariant` di `src/lib/catalog.ts` LEFT JOIN
`wr_variants` via `wr_variant_id` dan memaparkannya di `VariantSummary.terms` /
`.delivery_terms`. PDP `/produk/[slug]` merender section "Syarat & Ketentuan"
**terikat varian terpilih** (fallback varian aktif pertama) — desktop di kolom
kiri bawah deskripsi, mobile sebagai panel terlipat. Varian manual (tanpa
`wr_variant_id`) mendapat `null`.

### Salinan produk versi Axvara (2026-09-24, live)

Penerapan data 2026-10-21 ✅ live: Muse manual (`muse-ai-1-miliar-token`,
produk112/varian248) menggunakan `products.description` serta
`product_variants.admin_terms` / `admin_activation` / fingerprint kosong,
melalui kontrak stok sendiri existing. Patch sekali jalan dengan guard
ID/slug/source/isi awal: `issue/muse-ai-copy-2026-10-21.sql`; revisi ringkas
owner melalui `issue/muse-ai-copy-compact-2026-10-21.sql` dengan guard
timestamp versi awal, bukan migrasi schema. Resolver `/api/catalog?slug=`
menampilkan lima poin paket/aturan/garansi serta empat langkah aktivasi.
Harga/stok/foto/pengiriman serta
garansi tidak berubah. Dasar penulisan dan batas bukti ada di
`issue/muse-ai-copy-2026-10-21.md`.
Revisi 23 Oktober ✅ live menambahkan asal Meta, ekosistem WhatsApp/Instagram/Threads/
Facebook dan contoh promosi/konten pada pengantar. Patch data sekali jalan
`issue/muse-ai-meta-copy-2026-10-23.sql` hanya menyunting description/updated_at,
dengan guard timestamp dan isi lengkap owner agar tidak menimpa perubahan baru;
S&K/panduan varian tetap. Bukan migrasi schema atau perubahan kontrak aplikasi.

Permintaan owner: deskripsi, S&K, dan cara aktivasi seragam untuk produk WR
maupun non-WR, tanpa kalimat berulang, dalam suara Axvara, **tanpa
menghilangkan maksud/ketegasan pemasok**. Kode di `src/lib/product-copy/`:

| Bagian | Sumber | Mekanisme |
| --- | --- | --- |
| S&K + cara aktivasi varian WR | `wr_variants` (milik sync, tidak disentuh) | `resolve.ts` menghitung `supplierFingerprint(wr_terms, wr_delivery_terms)` (`text.ts`: cyrb53 atas kata+angka per baris — kebal huruf besar/emoji/tanda baca/spasi, berubah bila kata/angka berubah). Urutan: **suntingan admin** (kolom varian migrasi 0041, lihat di bawah) → entri `curated.ts` (83 pasangan teks prod + 12 SK 2026-09-30) → `supplierVariantCopy()` di `format.ts`: teks WR dirapikan (tanpa emoji, huruf tebal Unicode dinormalkan NFKC, huruf besar berteriak jadi kalimat, baris ganda dibuang), dikelompokkan heuristik, baris aturan di teks aktivasi dipindah ke S&K. Suntingan admin dan kurasi hanya berlaku selama sidik jari sama dengan saat ditulis — aturan baru pemasok tidak pernah tertutup salinan lama. **Varian SK** mengalir lewat JOIN `sk_products` di `catalog.ts` (`terms=sk_description`, `delivery_terms=sk_seller_note`) sehingga mesin yang sama berlaku; `buyerDeliveryKind` kenal SK (`auto`=instan). |
| S&K + cara aktivasi versi admin per varian (WR & non-WR) | `product_variants.admin_terms`, `admin_activation`, `admin_copy_fingerprint` (migrasi **0041**, milik admin) | Tab **Deskripsi & S&K** di editor produk (`sections/ProductCopyTab.tsx`, terpisah dari tab Varian sejak 2026-09-24 agar baris varian hanya berisi harga/stok/garansi/pengiriman): kolom deskripsi (+ deskripsi khusus untuk WR) lalu daftar varian, masing-masing panel `VariantCopyEditor.tsx` yang terbuka berisi salinan yang sedang tampil; entri dimuat saat modal dibuka (`useVariantCopyEntries` di `ProductEditorModal`) sehingga tab langsung menampilkan jumlah varian aktif yang perlu ditinjau. Disimpan HANYA lewat `PUT /api/admin/variant-copy` (tombol sendiri) yang mencap `admin_copy_fingerprint` = sidik jari teks WR saat itu (`''` untuk varian non-WR). Sync WR dan `PUT /api/products/:id` tidak pernah menulis kolom ini, jadi menyimpan foto/badge tidak diam-diam mencap ulang suntingan yang dijeda. Teks yang isinya sama dengan salinan otomatis tidak disimpan (NULL), teks kosong = kembali otomatis. Bila WR mengubah teks sesudahnya: storefront kembali ke teks WR terbaru, editor menampilkan peringatan + teks asli WR, daftar produk admin memberi badge "S&K perlu ditinjau · N varian" (`copyReview` di `GET /api/products` admin, juga untuk teks WR yang belum punya versi Axvara) sampai admin menyimpan ulang. |
| Deskripsi produk WR | `products.admin_description_override` (milik admin) | Migrasi **0040** (data-only) mengisi versi Axvara untuk 47 produk WR hanya bila override masih kosong; `description` milik WR tetap utuh. |
| Deskripsi + S&K produk non-WR | `products.description` (milik admin) | Migrasi 0040 mengganti 2 produk (Canva, GSuite) hanya bila isinya masih persis teks lama. Migrasi **0042** menambah S&K Canva (undangan dikirim lewat email + pastikan email aktif, keputusan owner) dengan guard yang sama. S&K yang berlaku untuk semua varian ditulis di sini; yang khusus satu varian lewat editor varian. |

Kontrak data (`format.ts`, aman untuk browser): `VariantCopy = { source:
"admin"|"axvara"|"pemasok", sections: {kind: paket|proses|aturan|garansi, items}[],
activation: {title|null, steps}[], notes }`. `withVariantCopy()` dipanggil
route `/api/catalog?slug=` — BUKAN `catalog.ts`, karena `catalog.ts` ikut
diimpor komponen client dan `curated.ts` tidak boleh masuk bundle browser
(diverifikasi `next build`); ia juga mengosongkan kolom mentah WR & admin
sebelum dikirim. Bot Telegram/WhatsApp tidak menampilkan deskripsi maupun S&K
(tetap seperti sebelumnya).

**Koreksi editor 29 Oktober 2026 (implementasi lokal, menggantikan kontrak editor
WR-only di tabel snapshot di atas).** GET/PUT variant-copy dan badge `copyReview`
JOIN `sk_products`, dengan fallback WR nonblank lalu `sk_description`/`sk_seller_note`
seperti katalog. `VariantCopyEntry` menambah `supplier`, `supplierKey` dan teks
efektif `effectiveTerms`/`effectiveActivation`. PUT wajib `supplier_key` yang sama
dengan sumber saat dibaca; mismatch 409. UPDATE kondisional memeriksa override lama,
ID supplier dan teks sumber mentah dalam statement yang sama; zero changes 409.
Fingerprint SK tidak lagi kosong; supplier tanpa teks tetap fingerprint kosong.
Sync tetap memiliki mirror, hanya kolom admin yang disunting. Stok sendiri tetap
disimpan lewat batch Simpan Produk sebagaimana kontrak 15 Oktober.

Editor mempertahankan draft saat reload konflik; override stale ditampilkan
sebagai draft dijeda, versi efektif dan sumber asli dapat dibandingkan. Preview
memakai `parseAdminVariantCopy` + `parseProductDescription` + `mergeProductCopy`
dan renderer storefront. Deskripsi di preview adalah form belum tersimpan, bukan
janji snapshot pascabayar. `useVariantCopyEntries` mengagregasi dirty/saving agar
modal menahan Simpan Produk dan penutupan saat saving, serta meminta konfirmasi
sebelum membuang draft; beforeunload melindungi refresh. Tidak mengubah resolver
pascabayar katalog terkini atau `formatSkLicenses()` seller_note transaksi.

Format editor varian (`serializeVariantCopy()` ⇄ `parseAdminVariantCopy()`,
bolak-balik tanpa kehilangan isi untuk ke-83 salinan kurasi — dikunci test):
S&K = judul `Detail paket:` / `Proses & pengiriman:` / `Aturan pakai:` /
`Garansi:` lalu baris `- ` (baris tanpa judul dikelompokkan otomatis); cara
aktivasi = baris bernomor, judul bebas menjadi judul kelompok langkah, judul
`Catatan:` untuk catatan. Batas 4.000 karakter per kolom
(`VARIANT_COPY_MAX_CHARS`).

Format deskripsi (juga untuk admin, dijelaskan di editor produk): paragraf
pembuka → baris `- ` untuk keunggulan → opsional judul baris `Syarat &
Ketentuan:` / `Cara Aktivasi:`. `parseProductDescription()` memindahkan dua
bagian itu ke kartu S&K/aktivasi PDP (digabung dengan S&K varian WR, tiap
baris tampil sekali lewat `mergeProductCopy()`), sisanya tetap di kartu
deskripsi. Meta SEO/OG memakai `descriptionSummary()` (paragraf pembuka saja).

Penjaga: `tests/product-copy-content.test.ts` membandingkan setiap salinan
dengan snapshot teks WR produksi (`tests/fixtures/product-copy-snapshot.json`)
— semua angka, URL, dan keluarga aturan (larangan, kewajiban, tanpa garansi,
refund, batas perangkat, sanksi, platform, dst.) wajib terbawa; gaya seragam
(tanpa emoji/huruf besar berteriak/bahasa gaul/titik di akhir poin).
**Pengecualian 2026-10-03 (keputusan owner):** halaman docs/tutorial supplier
(`sekalipay.com/docs/*`) BOLEH diganti artikel AXVARA (syarat: URL
`axvara.tech/artikel/` wajib ada di salinan) — customer yang klik link itu
melihat nav belanja supplier. Catatan
harga internal pemasok untuk reseller ("harga naik karena VCC susah")
sengaja tidak ditampilkan ke pembeli. **Saat WR mengubah teks** (badge "S&K
perlu ditinjau"): cara tercepat, tulis ulang versi Axvara di editor varian
admin. Kurasi permanen di kode tetap bisa: ekspor ulang pasangan teks
(read-only) ke snapshot, tulis entri baru di `curated.ts` dengan kunci sidik
jari barunya, jalankan test. Suntingan admin tidak diperiksa test integritas —
admin bertanggung jawab membawa angka, larangan, dan batas garansi WR (editor
menampilkan teks asli WR sebagai pembanding).

`formatWarranty()` untuk tipe `limited` SELALU membentuk kanonis
`Garansi {value} {unit}` dari field terstruktur ("Garansi 12 Hari") — label
mentah WR ("12 Hari", ambigu dengan durasi) hanya dipakai untuk tipe `custom`.
Satu helper dipakai web + Telegram + WA sekaligus; label ditampilkan dengan
ikon shield agar setara badge "Garansi N Hari" di web WR.

### Force Sync melaporkan status apa adanya

`POST /api/admin/warung/sync` mengembalikan `status` `success` | `partial` |
`failed` (sama dengan yang ditulis ke `wr_sync_log`) dan `ok:false` saat gagal
total. Sebelumnya route selalu `{ok:true}` sehingga admin melihat "Sync selesai"
walaupun seluruh katalog gagal. Batch yang berhenti di batas budget
(`budgetYielded`) dilaporkan `partial`, bukan sukses penuh.


### Proteksi

- `WARUNG_REBAHAN_ENABLED=false` mematikan segalanya (sync/order/webhook/cron no-op).
- API key server-only, outbound hanya ke `warungrebahan.com` (assert host, https saja),
  timeout 30 dtk. Mode proxy Opsi A: API key dipegang proxy Heroku; Pages cukup
  `WARUNG_REBAHAN_PROXY_URL` (https) + `WARUNG_REBAHAN_PROXY_TOKEN` — kontrak
  dikunci di `client.test.ts` (endpoint allowlist + shape respons).
- Webhook HMAC-SHA256 (`X-Rebahan-Signature`, secret = API key), 401 bila salah;
  event monotonik (completed tidak bisa diregresi failed terlambat) + event log.
- Detail akun dienkripsi sebelum disimpan; decrypt hanya server-side saat delivery.
- Pembeli web TIDAK bisa membuka kredensial hanya dengan kode order: verifikasi
  6 digit WA atau email checkout (sekali) atau capability token (30 hari, hash-only, revoke).
  Admin punya retrieval/resend fallback.
- Exact-once: klaim atomik (UPDATE bersyarat, lease 5 mnt, fencing `request_sent_at`),
  idempotency `wr:order:variant:item`, dedup webhook `event_id`, admin retry CAS→409.
- Markup default 50% + pembulatan 500; exclusion kosong default (Canva/Gemini ikut).
- Saldo habis → tunda 1 jam + notif admin (bukan retry cepat); gagal 3x → failed + admin
  putuskan manual (tanpa auto-refund). Order failed WR → `fulfillment_status='failed'`,
  status uang `lunas` tidak diubah otomatis.

### Bot email WR→buyer (white-label, 2026-09-17)

Email WR (`info@warungrebahan.com`) masuk mailbox ingest, bukan ke buyer —
bot meneruskannya sebagai email branding Axvara (nol jejak "Warung Rebahan"):

- **Ingest:** filter Gmail `from:info@warungrebahan.com` → label `WR-INGEST` +
  Skip Inbox. Apps Script `docs/WR-EMAIL-FORWARDER.gs.js` (trigger per-menit)
  POST subject + body ke `POST /api/webhook/wr-email` dengan
  `WR_EMAIL_WEBHOOK_SECRET`, lalu cap label `WR-SENT`. Hanya 5xx/429/timeout
  yang di-retry; Gmail TIDAK pernah dipanggil dari Pages (tidak edge-safe).
- **Parse:** `src/lib/warung-rebahan/email-forward.ts` ambil invoice
  `RBHN-…` (kunci join), status, produk/varian, email tujuan invite, total.
  Dua template Axvara: `order_update` (Pesanan Diproses) + `invite_sent`
  (Invite Terkirim) — link invoice + kontak selalu ke Axvara.
- **Join + kirim:** invoice → `wr_order_links.wr_order_id` → buyer
  (`orders.customer_email`). Kirim via Resend (`RESEND_API_KEY` +
  `FORWARD_FROM_EMAIL`, mis. `noreply@axvara.id` — JANGAN SMTP Gmail
  pribadi). Buyer tanpa email → fallback teks ke WA via `whatsapp_outbox`
  (idempoten `wr-email:order:invoice:kind`, diproses cron).
- **Idempoten:** `wr_email_forward_log.gmail_message_id` UNIQUE (migrasi
  0036) — retry forwarder = `duplicate` tanpa kirim ulang. Status:
  `forwarded` / `duplicate` / `unmatched` (invoice tak dikenal, untuk
  reconciler manual) / `skipped` (tanpa invoice) / `held` 202 (Resend belum
  dikonfigurasi / buyer tanpa kontak — tidak hilang).
- **Env baru** (`secret_text`, lihat `.env.example`): `WR_EMAIL_WEBHOOK_SECRET`,
  `RESEND_API_KEY`, `FORWARD_FROM_EMAIL`.
- **Batas LIKE D1** (50 byte) berlaku untuk param `?q=` pencarian admin WR.

## Motion drag kredensial (2026-10-23)

`components/admin/sections/CredentialQueue.tsx` memisahkan interaksi sortable dari panel penyimpanan. Dependensi @dnd-kit/core6.3.1, sortable10.0.0, utilities3.2.2: PointerSensor (aktivasi6px), KeyboardSensor + sortableKeyboardCoordinates, verticalListSortingStrategy, overlay portal body, transform220ms. ID item dimemoisasi selama hover agar useSortable tidak mereset transisi. AutoScroller hanya diizinkan pada elemen daftar melalui canScroll, interval10ms/acceleration8/threshold vertikal25%; ancestor modal/window tidak ikut scroll. Drag preview tidak mengubah inventory; drop memanggil onMove existing sekali, cancel tidak menyimpan. prefers-reduced-motion menghapus transisi/drop animation. Backend, migrasi0074 dan prioritas pemenuhan tetap existing; tidak ada perubahan kontrak/env/cron.

## Prioritas inventory pribadi (2026-10-23)

Migrasi `0074_inventory_priority.sql` menambah `fulfillment_inventory.sort_order` nullable serta indeks `(product_id,variant_id,status,COALESCE(sort_order,id),id)`. NULL memakai ID lama sehingga FIFO tersimpan tanpa rewrite kredensial; impor baru otomatis berada di belakang slot existing. GET admin fulfillment mengembalikan stok tersedia sesuai prioritas. POST `action:reorder` menerima `product_id`, `variant_id`, `inventory_ids` (permutasi lengkap daftar hingga 100 entri). Auth admin dan validasi cakupan/ID unik wajib; posisi baru memakai slot lama, bukan mengubah ID/isi/status/jumlah stok.

`reorderInventory` membaca daftar available varian lalu menjalankan satu UPDATE dengan CTE current/expected/requested materialized. Seluruh snapshot ID/posisi harus tetap cocok; checkout yang mereservasi unit atau reorder admin lain membuat UPDATE no-op dan respons409, bukan perubahan parsial. Reservasi web (`db/orders-create`) dan kanal (`commerce`, `reserveInventory`) serta pemilihan unit terikat memakai `COALESCE(sort_order,id),id`, dengan prioritas unit khusus varian atas pool legacy tetap. Kredensial reserved/delivered tidak berubah. UI NonWrFulfillmentPanel mengirim urutan via panah maupun CredentialQueue sortable pointer/keyboard, rollback dan refresh saat gagal; ID yang dikirim tidak memuat plaintext.

## 15b. Sekalipay Reseller API — Supplier Kedua Paralel WR (2026-09-30, Fase 1)

Axvara menjadi reseller layer di atas Sekalipay (`https://sekalipay.com/api`,
docs `https://sekalipay.com/api-docs`) SEBAGAI SUPPLIER KEDUA yang paralel
dengan WR — bukan failover order otomatis (keputusan owner). Netflix WR vs
Netflix SK tetap dua baris di admin (nama publik bersih tanpa suffix, badge admin
+ slug `-wr`/`-sk`). Pasangan terdaftar memilih satu wakil katalog otomatis dari
sisi yang aktif manual, kemudian stok/modal/preferensi; snapshot order tetap
mengikat supplier semula.

### Recovery invoice SK setelah dispatch terputus (2026-10-23, implementasi; publikasi CI)

Insiden `AXV-20261022-1976A303`: link 48 tetap `claimed`, `request_sent_at` terisi, lease sudah habis, invoice NULL; GET supplier dengan `sk:<order_code>:1095:1` membuktikan transaksi `completed` beserta lisensi. Link 29 memiliki pola sama tetapi itemnya sudah delivered dengan penanda `manual_handover` (penanda DB tidak menjadi bukti bahwa owner melakukan klik pada sesi ini). Commit dispatch 22 Oktober mempercepat awal pembelian, tetapi recovery lama hanya mengantrekan klaim tanpa `request_sent_at` dan rekonsiliasi hanya membaca invoice tersimpan.

- `bindSkInvoiceByRef` mencocokkan ref dengan kebutuhan canonical (`order_code`, varian, jumlah; fallback link legacy tanpa `idempotency_key`) dan mengikat invoice lewat UPDATE bersyarat tanpa mengganti invoice berbeda. Webhook memanggilnya **setelah signature valid**, sebelum paid/completed/canceled/item.sent; referensi tidak ditemukan/konflik mendapat HTTP500 agar supplier dapat retry.
- `recoverStaleSkClaims` mempertahankan pemulihan klaim belum terkirim, lalu memilih maksimal tiga klaim terkirim dengan lease basi atau submitted/ordering yang due. Klaim cooldown atomik `next_attempt_at=now+1minute` mencegah pembacaan serentak dan memberi giliran kandidat lain saat lookup gagal. GET memakai ref_id asli; invoice disimpan sebelum handler completion/failure mencari link. Hasil belum terminal pindah processing; timeout/404 tidak membeli ulang atau mereset attempt/ref. Guard admission memakai budget D1 existing, tanpa cron/env/migrasi baru.
- Penyegar bersama dan tiga endpoint pembeli (`GET /api/orders?code`, `GET /api/orders/[code]`, `POST /api/orders/lookup`) juga menerima claimed-terkirim/submitted/ordering tanpa invoice. Kandidat memakai invoice bila ada atau ref_id canonical; GET detail mengikat invoice sebelum completion dan menjaga kecocokan ref. Polling read-only boleh berjalan sebelum lease habis, dengan gerbang existing 20 detik/order: halaman terbuka tidak perlu menunggu cron. Kandidat batch cron mendapat jalur yang sama.
- Respons POST dan penulisan status error hanya mengubah link yang masih `claimed`; webhook yang sudah membawa link ke processing/completed/failed tidak ditimpa respons terlambat. Pengiriman kredensial memeriksa penanda `manual_handover:` pada item supaya pemulihan order lama tidak mengirim ulang penyerahan admin.
- Recovery operasional link 48 memakai invoice yang dikonfirmasi supplier, UPDATE bersyarat pada order paid/claimed tanpa invoice, lalu cron lite existing untuk mengambil lisensi dan mengirim. Verifikasi D1 sesudahnya: supplier completed, item/order delivered, ciphertext tersedia, ledger email sk-credential sent (23 Okt 06:23 WIB). Link 29 dibiarkan untuk recovery baru yang mempertahankan isi item yang sudah delivered. Ini pemulihan transaksi existing, bukan order supplier baru.

### Ketahanan antrean SK (2026-10-19, implementasi; publikasi CI)

Insiden `AXV-20261019-98C8CC33`: probe 12 order lunas terbaru berjalan dua kali sebelum dispatch, memakai 35 dari 38 statement kerja; admission pembelian membutuhkan enam statement sehingga tidak pernah mulai. Retry admin memakai akses DB tanpa budget lokal dan baru mengirim pembelian pertama. Perbaikan:

- `reconcileMissingSkLinks` menyaring order lunas/paid tujuh hari dengan `json_each` + registry auto + `NOT EXISTS sk_order_links` dalam satu statement, memakai indeks existing. JSON rusak/non-object dilewati. LIMIT diterapkan sesudah filter yatim, sehingga order lama tidak tertutup 12 riwayat terbaru; seluruh status link existing mencegah pembuatan ulang.
- `processSkPendingOrders(..., {skipOrphanProbe:true})` membolehkan pemanggil mengelola satu probe sendiri. Cron lite memproses link due terlebih dahulu, lalu menyembuhkan maksimal empat order yatim tanpa bergantung pada COUNT due. Bila belum ada pembelian pada tick itu, link pulih diproses segera; bila sudah ada, tetap due untuk tick berikutnya. Maksimal empat upaya pembelian per tick. Cron besar juga melewati probe internal sesudah probe eksplisitnya.
- `QueryBudgetExceeded` pada probe/SELECT antrean/admission diteruskan agar lite mengembalikan `budget_exhausted:true`; tidak diterjemahkan menjadi antrean kosong. Cadangan ekor dan plafon 40 statement tidak dinaikkan. Tidak ada cron, env, migrasi atau kontrak proxy baru; retry due diperiksa langsung memakai `next_attempt_at` tanpa UPDATE normalisasi timestamp setiap tick.
- Klaim, ref_id, recovery ambigu, backoff dan pengiriman kredensial tidak di-reset. Order completed/failed existing tetap dipertahankan. Pengujian menggunakan supplier/email stub, bukan order berbayar atau kirim ulang transaksi produksi yang sudah ditangani owner.

### Kontrak upstream (beda dari WR — jangan disamakan)
- **Auth:** header `X-APIKEY` (WR: body `api_key`). Key SK disuntik
  server-side oleh proxy Heroku (`SK_API_KEY` dyno); Pages tidak menyimpan key.
- **Baca = GET + query** (`GET /v1/balance`, `GET /v1/item?per_page=all`,
  delta `?updated_since=<server_time>`, `GET /v1/trx/{ref_id}`); WR semua POST.
- **Tulis = POST JSON** (`POST /v1/trx {ref_id, carts[]}`, `POST
  /v1/order/sandbox {ref_id, items[]}`). `ref_id` IDEMPOTEN di sisi SK
  (`422 REF_ID_ALREADY_EXIST` = ambil detail, bukan order ganda) — kunci
  `sk:<order_code>:<sk_variant_id>:<qty>` (maks 191 char).
- **Validasi 422 SEBELUM potong saldo** (`REQUIRED_FIELD_MISSING` +
  `field: carts.0.note`). Fase 1 (auto) tidak pernah mengirim note.
- **503 `PRODUCT_TEMPORARILY_UNAVAILABLE`** = ditolak di depan, saldo tidak
  terpotong → retry normal, bukan failed permanen.
- **order_process:** `auto` (lisensi langsung), `manual` (admin kirim, event
  per-item `order.item.sent`), `h2h` (SN per-unit `units[]`), `smm`. Fase 1
  HANYA `auto`; sisanya tercatat di registry tanpa pasangan katalog.
- **Webhook event:** `order.paid/completed/canceled` + `order.item.sent` +
  `webhook.test`. Signature `SHA256(ref_id:invoice:status:secret)` dengan
  status event-dependent (`data.status` / `item.sent` / `test`), header
  `X-Signature/X-Timestamp/X-Event`, jawab 2xx cepat + proses async + dedup
  `sk_webhook_events` + retry exponential 5x dari SK.

### Arsitektur terpasang (cermin WR, scope lebih kecil)
- **Proxy:** route `/sk/*` di proxy WR/SK — pass-through
  method+query+body di bawah prefix `/v1/`, key disuntik server-side, egress
  IP VPS yang SAMA (`13.228.147.90`, tanpa add-on baru sejak migrasi
  AWS 2026-10-02 — lihat §16.8). `GET /sk/health` tanpa bocor key.
- **Modul `src/lib/sekalipay/`:** `client.ts` (fetch edge + klasifikasi error
  + signature), `sync.ts` (registry per-varian + katalog hanya auto + nama
  bersih tanpa suffix + markup 50% + cursor + zero-missing sweep-penuh), `order.ts`
  (exactly-once claim/lease + reconcile via `GET /v1/trx` + blocked 24 jam),
  `deliver.ts` (lisensi → `fulfillment_items.delivered_ciphertext/iv`
  sehingga panel/email/token yang SUDAH ada langsung jalan; agregat via
  `refreshOrderAggregate` yang sama), `saldo.ts` (check + alert Rp250rb).
- **Kepemilikan (cermin 0030):** SK = stok/modal/label/seller_note/process;
  Admin = foto/badge/sort/is_active/markup/tampil. Sync tidak pernah menulis
  `sold_count`, `admin_*`, `require_email`, `min_qty`, `fulfillment_mode`.
- **Fulfillment generik dilewati untuk item SK** (`sk_link_id NOT NULL` di
  `send.ts` + `process.ts`, pola `wr_link_id`) — diselesaikan via
  `sk_order_links`, agregat order dari seluruh item (mixed cart jujur).
- **Hook lunas 4 jalur** (webhook DANA, konfirmasi admin, approve bukti,
  retry payments/events) membuat link SK best-effort SETELAH link WR —
  SK mati tidak mengganggu WR/non-WR.
- **Cron fase `sekalipay`** (`fulfillment → warung_rebahan → SEKALIPAY →
  notify`): order due + sync 30 mnt + reconcile + saldo 1 jam, budget +
  deadline + cadangan ekor yang sama. Fase hanya masuk rotasi bila relevan
  (SK aktif/ada kerja/deferred lama) — saat SK mati rotasi IDENTIK baseline
  (nol query/deferred ekstra, dikunci test R12).
- **Admin:** tab **Sekalipay** setara WR (saldo + kapasitas, Force Sync +
  sync manual/cron terpisah, antrean + umur + retry/void CAS, exclusion rules,
  markup per varian + **bulk markup cermin WR** via `POST /api/admin/sekalipay/markup/bulk`, toolbar bersama yang sama) + **tab dalam-halaman Ringkas/Antrean/Markup/Aturan/Audit/Alat (2026-10-01, cermin WR)** — sandbox di tab Antrean, mutasi + transaksi di Audit, cek akun + lock + detail di Alat (semua lazy-load) + fitur khas SK: mutasi saldo audit, cek akun validasi,
  stock-lock 10 mnt, daftar transaksi SK, detail capability per varian,
  sandbox order. API `/api/admin/sekalipay/*`, rate-limit
  `webhook:sekalipay` 60/mnt.
- **DB (migrasi 0049 + 0050):** tabel `sk_products/sk_order_links/sk_sync_log/
  sk_saldo_log/sk_webhook_events/sk_sync_state/sk_exclusions`, kolom `sk_*`
  katalog + registry capability (`sk_description/min_order/status/
  required_fields/validation`) + `fulfillment_items.sk_link_id`, CHECK
  `source` + `sekalipay` (rebuild 12-langkah pola 0029 + namespace negatif
  pola 0008 + `foreign_key_check` ekor; bootstrap baru inline di `schema.sql`).
- **Env (`secret_text`):** `SEKALIPAY_ENABLED/AUTO_ORDER_ENABLED=false`
  default, `SEKALIPAY_PROXY_URL/TOKEN`, `SEKALIPAY_WEBHOOK_SECRET`, markup +
  ambang + kategori default (lihat `.env.example`).
- **Paritas email + flag SK (2026-10-02):** flag `queued/instant_delivery` di
  `GET /api/orders?code=` membaca `sk_products.sk_order_process` (SK auto =
  instan walau `fulfillment_mode` lokal `manual`; SK non-auto = antrean;
   varian hilang = bukan instan palsu) — halaman lunas SK auto skeleton "Menyiapkan
   detail produkmu…" + polling rapat, bukan Made By Order 12 jam.
  `handleSkOrderCompleted` bind link → item + tulis `sk_link_id` (fulfillment
  generik lewati, pola `wr_link_id`) + kirim email kredensial template
  "Pesanan Siap" Axvara yang SAMA PERSIS dengan WR/non-WR (logo + tanda
  terima + blok kredensial + CTA, idempoten `email:sk-credential:<order>:<item>`
  di `buyer_notice_log`) + reconcile cron `reconcilePendingSkCredentialEmails`;
  `webOrderAutoDelivered` hitung `sk:%` sebagai auto (tanpa email tanda terima
  ganda); event `order.paid/item.sent` → email "Pesanan Diproses"
  (`notifyBuyerSkProcessing`, idempoten per invoice); saldo habis → email
   pembeli `sk-blocked` (cermin WR). TANPA ingest Gmail SK — webhook adalah
   source of truth (lisensi sudah di payload `order.completed`).
- **Paritas instan penuh WR≈SK (2026-10-13, insiden Prime Video SK + Bstation WR):**
  (1) **Bind saat link dibuat** — `createWrOrderLink`/`createSkOrderLink` langsung
  mengaitkan link ke `fulfillment_items` (`wr_link_id`/`sk_link_id` +
  `fulfillment_item_id`, idempoten) begitu link lahir, bukan menunggu completed.
  Pipeline fulfillment generik karena itu melewati item supplier sejak detik
  pertama; vonis `manual_required` palsu dari jendela balapan (yang tampil
  sebagai "Stok otomatis habis" di halaman SK) tidak pernah lahir.
  (2) **Penyegar status supplier bersama** (`src/lib/orders/supplier-refresh.ts`):
  `maybeRefreshSupplierOrder` menarik status vendor SEKARANG (WR `/transactions`,
  SK `/v1/trx`, read-only + monotonik) di balik gerbang throttle per-order 20 dtk
  yang disimpan di `store_settings` (`supplier_refresh_at:<kode>`, klaim CAS
  satu pernyataan — pola klaim fulfillment). Pemicunya: poll pembeli di
  `GET /api/orders?code=`, `/api/orders/[code]`, `/api/orders/lookup` (respons
  dihitung ulang setelah refresh agar tidak basi), penjamin massal
  `refreshDueSupplierOrders` (limit 4, kandidat dibaca 1 query per supplier,
  gerbang dibaca batch) di cron lite `wr_orders`+`sk_orders`, dan webhook tetap
  jalur tercepat bila sampai. `refreshSupplierOrderNow` ikut memproses antrean
  pengiriman kredensial WR agar email/panel menyusul di invocation yang sama.
  Tanpa timer server; biaya tetap berapa pun jumlah poll (gerbang menahan).
  (3) **Formatter WR bentuk `{label, value}`** dikenali `labeledFieldOf`:
  dirender "Label: nilai" per baris (pemisah antar-field kini newline, bukan
  " · "), key `product` pembungkus dibuang — nol teks "Product:/Label:/Value:"
  mentah di panel/email/WA/Telegram, termasuk order lama (normalisasi USE-time).
  (4) **S&K pasca-bayar**: endpoint kredensial melampirkan `terms` per item dari
  `resolveCredentialTermsByItem` (`src/lib/orders/credential-terms.ts`) — resolver
  yang sama dengan PDP (admin → kurasi → teks supplier, pagar sidik jari) atas
  `wr_terms/wr_delivery_terms` atau `sk_description/sk_seller_note`; panel
  menggabungkan pula S&K/aktivasi dari deskripsi produk via `mergeProductCopy` (2026-10-15, paritas PDP, termasuk stok sendiri); panel
  merender blok terlipat "Syarat & Ketentuan" + "Cara Penggunaan / Aktivasi" DI BAWAH
  kredensial (kredensial tetap bersih, S&K tidak disimpan ke ciphertext).
  (5) `settleSkFulfillmentItem` berpagar `manual_handover:%` seperti WR (supplier
  tidak menimpa serah terima admin), dan admin SK mendapat route
  `POST /api/admin/sekalipay/orders/[id]/sync-now` sehingga tombol "Cek status"
  tampil untuk kedua supplier.
 - **White-label link docs supplier (2026-10-03, keputusan owner):** teks SK
   untuk Netflix menunjuk `sekalipay.com/docs/tutorial-login-netflix` — customer
   yang klik melihat nav "Belanja Sekarang" dan bisa order langsung di supplier.
   Kini PDP + email/panel rewrite link itu ke artikel AXVARA
   `/artikel/cara-login-netflix-setelah-order-di-axvara` (ditulis ulang +
   foto white-label, id draft 23): kurasi `curated.ts` 2 entri Netflix +
   `rewriteSupplierDocsLinks()` di `format.ts` (dipakai fallback PDP
   `supplierVariantCopy()` + email/panel `formatSkLicenses()` di `deliver.ts`)
   sehingga tahan sync (teks supplier ditimpa tiap sweep). Mailbox OTP
   (`netflix-codes.sekalipay.com`, tanpa brand/nav belanja) + bot Viu
   DIPERTAHANKAN — bukan toko kompetitor. Test: `product-copy-content`
   (pengecualian docs→artikel) + `sk-saldo-branding` (9).
   **2026-10-19 pola yang sama untuk Disney+ (permintaan owner):** link
   `sekalipay.com/docs/tutorial-login-disney` di-rewrite ke shortlink
   `axvara.tech/go/disney-login` → artikel AXVARA
   `/artikel/cara-login-disney-setelah-order-di-axvara` (ditulis ulang + 6 foto
   white-label di R2, draf id 26 status review, sumber riset = URL docs
   supplier); kurasi `curated.ts` 2 entri sharing Premium 3U menunjuk
   `go/disney-login`; seed `supplier_links` 44 slug (migrasi 0056 + schema +
   dev-fallback in-memory). **Pelajaran 404 (hari yang sama):** seed
   `disney-login` yang dititipkan ke migrasi 0056 TIDAK masuk D1 produksi
   karena 0056 sudah tercatat diterapkan sebelum baris itu ada (CI tidak
   menjalankan ulang file lama) — diperbaiki migrasi BARU 0071. Aturan:
   JANGAN titip seed ke migrasi yang sudah live, selalu file migrasi baru.
   **2026-11-02 audit katalog publik live (99 produk/105 varian):** cross-sell
   "halaman Jaspay" di 10 varian premium di-drop display-only di
   `supplierVariantCopy()` (raw + fingerprint utuh); bare
   `netflix-codes.sekalipay.com` → `go/otp`; shorts Alight Motion baru
   `YKOMcipD3ig` → `go/alight-shorts`; OTP admin Muse
   `inbox.hypathia.web.id` → `go/otp-hypathia` (seed migrasi BARU 0092 +
   schema + dev-fallback = 46 slug). Matriks:
   `issue/supplier-white-label-2026-11-02.md`.
 - **Anti-spam notif saldo SK 1:1 WR (2026-10-03, sesi ses_f029e):** throttle SK
   cuma 1 jam + state di `sk_saldo_log` (CHECK source rapuh) = spam 24x/hari
   (bukti screenshot: Rp41.900 × 5 dalam 4 jam). Kini `saldo.ts` pakai
   `sk_sync_state key='low_saldo_notified'` (`amount|timestamp_ms`): kirim ulang
   hanya bila 6 jam berlalu ATAU saldo turun melewati kelipatan Rp5.000
   (maks 4x/hari, stagnan = 1x). Threshold + gate cek 1x/jam cron tidak berubah.

## 16. Insiden operasional 2026-09-14 + arsitektur proxy terpisah (WAJIB DIBACA agent)

Hari ini prod lumpuh total (login 503, bot WA/Telegram mati, QRIS hilang, varian
tidak tampil, pagination lama kembali) lalu dipulihkan. Tiga akar + aturan
kerasnya agar tidak terulang:

### 16.1 Arsitektur proxy WR terpisah (hasil permanen hari ini)
- Akun Heroku #1 (`terry.delvon0805@gmail.com`): `axvara-wa-gateway` = WhatsApp SAJA
  (route `/wr/*` mengembalikan 410 `wr_proxy_moved`).
- **Sejak 2026-10-02 proxy pindah ke AWS** (lihat §16.8): VPS `t4g.nano`
  Singapore `i-022790eb6bb0b1be3`, EIP `13.228.147.90`,
  URL `https://wr-proxy.axvara.tech` (Caddy + Let's Encrypt). Source tetap
  `/Users/macbookair/axvara-wr-proxy/` (deploy via rsync + systemd, bukan
  `git push heroku`). Akun Heroku #2 (`sailinnadia1@gmail.com`) + add-on
  QuotaGuard Spike DIHAPUS TOTAL 2026-10-02 (verifikasi: `heroku apps` =
  kosong, `heroku addons --all` = No add-ons; tagihan $5/mo ke kartu
  berhenti). IP lama `54.88.136.216, 54.84.188.199` hapus dari whitelist
  WR/SK setelah verifikasi VPS hijau (WR Rp47.820, SK Rp44.250).
- Jangan satukan lagi: restart gateway WA tidak boleh memutus sync WR.

### 16.2 Env Pages WAJIB `secret_text` (bukan `plain_text`)
Terbukti berulang: entri `plain_text` (FLAG, URL proxy) hilang dari deployment
berikutnya, `secret_text` terbawa. **Semua env Pages ditulis sebagai
`secret_text`, tanpa kecuali** — termasuk flag boolean dan URL. Secret Pages
bersifat write-only (GET selalu tampil kosong): verifikasi lewat perilaku
(endpoint 200), bukan lewat GET.

**Insiden 9–10 November 2026 (WAJIB dibaca sebelum menyentuh env Pages):** sebuah sesi
menulis env baru dengan `structuredClone(GET project).deployment_configs` lalu PATCH
utuh (production+preview). Karena GET tidak pernah mengembalikan nilai `secret_text`,
PATCH itu MENGOSONGKAN nilai SEMUA secret project; deploy berikutnya (37a8c40,
16:15Z) kehilangan konfigurasi pembayaran, Pedia, Digiflazz, cron. Pemulihan:
rollback Pages ke deployment 272caee0 + rollback Worker `axvara-mcp` ke versi
sebelum rotasi CRON, nonaktifkan workflow CI, tulis ulang nilai dari sumber lokal/VPS
per kunci, lalu roll-forward. `FULFILLMENT_ENCRYPTION_KEY`, hash password admin dan
`ADMIN_JWT_SECRET` tidak punya salinan → diganti baru atas keputusan owner (stok
fulfillment lama dicabut; kredensial terkirim lama tidak bisa dibuka ulang).
Aturan: PATCH env HANYA berisi kunci yang nilainya dikirim,
`{"deployment_configs":{"production":{"env_vars":{"KEY":{"type":"secret_text","value":"…"}}}}}`;
JANGAN pernah mengirim balik objek `deployment_configs`/`env_vars` hasil GET; verifikasi
himpunan nama kunci sebelum/sesudah. Secret tanpa salinan lokal wajib di-backup owner
(password manager) saat dibuat.

#### Cadangan & pemulihan env (10 November 2026)

- `.pages-env-backup` lokal di-ignore oleh `.pages-env-backup*`, izin `600`;
  simpan juga salinannya di password manager owner. Blok `[production]`,
  `[preview]`, `[worker:axvara-mcp]` memakai `KEY=VALUE` literal, bukan sintaks
  shell: jangan `source`, echo, log, stage atau commit berkas ini. Karakter `=`
  dan `#` di dalam nilai dipertahankan; komentar hanya baris berawalan `#`.
- Setiap secret baru maupun perubahan nilai env Pages WAJIB ditambahkan/diperbarui
  di `.pages-env-backup` saat nilai tersedia; GET Cloudflare tidak bisa mengambil
  kembali nilai `secret_text`. Kunci yang belum dipulihkan tetap komentar
  `# KEY= (TIDAK DIPASANG - alasan)`, bukan assignment kosong atau nilai tebakan.
- `node scripts/pages-env-restore.mjs [path-backup]` default **DRY-RUN**:
  hanya nama/jumlah kunci, tanpa jaringan atau membaca kredensial Cloudflare.
  Filter: `--env production|preview` dan `--only KEY1,KEY2`.
- Setelah pemeriksaan owner, `node scripts/pages-env-restore.mjs --apply --env
  production --only KEY1,KEY2` membaca Global API Key/email dari `.cf-credentials`.
  Semua blok terpilih dipreflight: kunci wajib sudah ada di project. PATCH dibuat
  baru per environment, HANYA assignment dari berkas bertipe `secret_text`;
  objek/nilai hasil GET tidak pernah dikirim balik. Himpunan nama production dan
  preview diperiksa sebelum/sesudah setiap PATCH, termasuk respons gagal;
  perubahan himpunan atau API gagal menghentikan operasi tanpa retry otomatis.
- Script tidak deploy atau mengubah Worker. `AXVARA_CRON_SECRET` dipulihkan
  manual dengan `wrangler secret put AXVARA_CRON_SECRET --config
  mcp-worker/wrangler.toml`, menggunakan nilai yang sama dengan Pages
  `CRON_SECRET`; token bot/admin chat ID Worker juga dicadangkan untuk pemulihan
  manual bila diperlukan. Jangan mencetak nilainya. Rilis berikutnya tetap CI;
  verifikasi metadata bukan bukti nilai runtime sudah aktif.
- Snapshot cadangan lokal 10 November: production72/79, preview18/24, Worker3/3
  assignment nonkosong. Nama sama dengan metadata dikurangi komentar TIDAK
  DIPASANG; ini bukti sumber pemulihan + nama, bukan pembacaan balik secret API.

Cara mengubah satu env tanpa merusak yang lain (2026-09-18, runbook historis): pakai
`wrangler pages secret put <KEY> --project-name axvara` (satu kunci per
operasi). Larangan PATCH sebagian pada runbook lama digantikan aturan whitelist
di atas; yang dilarang mutlak adalah mengirim ulang nilai hasil GET atau
menghapus kunci lain. Setelah `secret put`/PATCH whitelist, nilai baru baru
terbaca oleh **deployment berikutnya**: dorong satu commit agar CI membuat
deployment baru, jangan `wrangler pages deployment create` (lihat 16.3).

Nilai yang diset 2026-09-18 (semua `secret_text`): `WARUNG_REBAHAN_AUTO_ORDER_ENABLED=true`
(gate auto-order — ini yang membelanjakan saldo sungguhan),
`WARUNG_REBAHAN_AUTO_ORDER_MBO=true` (kelas antrean ikut auto-order; set `false`
sebagai saklar mundur tanpa deploy), dan `WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD=250000`
(sebelumnya tidak ada di Pages sehingga memakai default kode). Total secret
produksi menjadi 38.

### 16.2a Switch build publik maintenance pembayaran (2026-10-18)

✅ Diimplementasikan, publikasi melalui CI. `NEXT_PUBLIC_PAYMENTS_MAINTENANCE` merupakan **nilai build nonrahasia**, `"false"` pada rilis KlikQRIS (sebelumnya `"true"`) di langkah build artefak Pages di `ci.yml`; tidak disimpan sebagai env runtime Pages dan tidak mengubah aturan `secret_text` untuk env Pages. Next menanam nilai yang sama pada bundle UI dan API; `false`/tidak diset memulihkan perilaku biasa setelah build/deploy baru. Mengubah secret runtime saja tidak membuka artefak lama. Dev mengaktifkan melalui prefix env; test menguji kedua mode eksplisit. Tidak memakai D1 atau TTL. Pemulihan lewat perubahan nilai CI + verifikasi + push, bukan deploy manual.

Sumber copy/URL/guard: `lib/payment-maintenance.ts`. `shared/PaymentMaintenanceNotice.tsx` menyediakan banner dan panel manual. Layout `(shop)`/Pedia menampilkan banner sesudah navbar; checkout Market dan formulir pilihan layanan Pedia digantikan panel manual sebelum hook checkout berjalan. Katalog/pelacakan tetap tersedia. `POST /api/orders`, `/api/pedia/orders`, `/api/payments/qris/[code]/reissue` memberi 503 JSON `reason: payment_maintenance`, `error` publik dan `manual_order_url`, private/no-store sebelum parsing/query/order/debit/reservasi. Guard inti `createQrisInvoice`/`reissueDanaQrisInvoice` menolak dengan `payment_maintenance` sebelum ledger.

`telegram/payment-maintenance.ts` memberi pemberitahuan dan keyboard WA absolut, katalog, Pesanan saya; dipakai `/start`, home, single/cart checkout dan renew sebelum perubahan finansial. Handler pembayaran WA berhenti sebelum session/order dan mengirim tautan hub. Endpoint webhook/polling merchant, status order, pengiriman dan cleanup tidak digate; invoice lama tidak dihapus dan stok/kredit tetap mengikuti lifecycle existing. Bukan maintenance D1, tidak auto-resume atau menambah broadcast/cron/kontrak lintas-repo.

### 16.3 Jangan redeploy wrangler tanpa direktori
`wrangler pages deployment create` tanpa argumen me-redeploy artefak LAMA =
rollback prod (hari ini menimpa build CI PR#1: pagination angka + badge lama
kembali). **Deploy HANYA via CI** (`git push origin main`). Pengecualian
recovery butuh instruksi eksplisit pemilik.

### 16.4 SITE_URL bisa kosong di worker
`process.env.SITE_URL` berupa string kosong (bukan null) sehingga `?? fallback`
tidak menolong → URL relatif → Telegram "URL host is empty". Pola wajib untuk
URL absolut: `const raw=(process.env.SITE_URL??"").trim().replace(/\/$/,"");
const site=/^https?:\/\//i.test(raw)?raw:"https://axvara.tech"`.
Sejak 2026-09-25 pola ini tersedia sebagai `siteOrigin()` (`src/lib/site-url.ts`) dan dipakai
notif "Lunas — Web" serta setup webhook Telegram (`/api/admin/telegram/setup`). Kode baru yang
membuat URL absolut di server wajib memakainya.

### 16.5 Ekosistem 5 folder (detail di masing-masing AGENTS.md)
`axvara` (toko + source WA `gateway/`, akun#1) · `axvara-wa-gateway` (arsip sesi/source lama sejak24Oktober) · `axvara-qris-gateway`
(riset QRIS, `.env` = sumber nilai Pages) · `axvara-wr-proxy` (source proxy
WR/SK — live di VPS AWS sejak 2026-10-02, lihat §16.8) · `axvara-tg-bot`
(kredensial Telegram). Kredensial Heroku dua akun di
`.heroku-credentials` (git-ignored, pola sama dengan `.cf-credentials`).
Perintah akun #2 wajib prefix `HEROKU_API_KEY=<kunci-akun-2>`; jangan
`heroku login` ulang (merusak sesi akun #1).

Kredensial AWS (VPS proxy, 2026-10-04): `.aws-credentials` (git-ignored,
pola sama dengan `.cf-credentials`; `set -a; source .aws-credentials; set +a`), IAM user
`kiro-monitor`: `ReadOnlyAccess` + baca billing/kredit + start/stop/reboot
khusus `i-022790eb6bb0b1be3`.
Akses isi VPS lewat SSH `ec2-user@13.228.147.90` + `~/.ssh/axvara-sg-proxy.pem`.
Root hanya via `aws login` (sesi berumur pendek); key admin permanen
`nasikuning` DINONAKTIFKAN 2026-10-04.

### 16.6 Perilaku sync WR satu sweep (Opsi A, 2026-09-14)
- `WR_SYNC_PRODUCTS_PER_RUN = 48` + plafon khusus katalog +800 query
  (`raiseCeilingForCatalogSync`, hanya jalur sync produk; budget cron umum +
  order/fulfillment tetap 40).
- Satu sweep ≈ 410 query. **Koreksi 2026-09-20 (terukur, bukan estimasi):**
  angka "~200 writes" di atas terlalu optimistis — sebelum guard bersyarat
  satu sweep TANPA perubahan apa pun menulis **398 baris** (96 `wr_variants`
  + 96 `product_variants` + 96 agregat `products` + 48 `wr_products` + 48
  deskripsi + state/log), karena semua `UPDATE` berjalan tanpa syarat dan
  `last_synced_at`/`updated_at` selalu disegarkan. Dikali ~56 sweep/hari =
  ~28k rows-written/hari, cocok dengan puncak GraphQL Analytics produksi
  (28.518 pada 18 Sep = **28,5% kuota Free 100k/hari**). Sejak 1 Sep 2026
  kuota tulis habis = query D1 **diblokir** (toko mati sampai tengah malam
  UTC), bukan sekadar peringatan.
  Sejak 2026-09-20 setiap `UPDATE` sync memakai guard null-safe (`IS NOT`)
  sehingga baris yang nilainya identik tidak ditulis ulang: sweep tanpa
  perubahan turun ke **12 baris (−97%)**, sementara perubahan nyata tetap
  merambat ke tiga lapis (`wr_variants` → `product_variants` → agregat
  induk). `last_synced_at` sengaja ikut tidak disegarkan saat tidak ada
  perubahan — kolom itu tidak dibaca kode mana pun (kesegaran sync dibaca
  dari `wr_sync_log`, bukan dari kolom ini).
  Dikunci oleh `tests/warung-rebahan/sync-write-quota.regression.test.ts`.
  Cursor antar-run tetap sebagai fallback.
- **Round-trip (2026-09-22):** angka "≈410 query" di atas adalah jumlah
  STATEMENT, dan itu bukan lagi jumlah perjalanan jaringan. Sejak sweep
  memakai `d1.batch()` per produk + prefetch massal, sweep 48/87 terukur
  **117 round-trip (dari 642, −82%)** sementara jumlah statement-nya tetap.
  Yang menentukan durasi sweep adalah round-trip, bukan statement: kerja SQL
  D1 hanya 0,15 ms/query sedangkan satu round-trip ke primary SIN ~197 ms.
- Produk BARU WR otomatis masuk katalog tiap sync (`products_new`): registry
  baru → baris katalog (slug anti-bentrok `-wr`, markup default 50%) +
  varian-variannya; kena exclusion → registry saja.
- Endpoint `sync-log` memfilter baris `saldo` (kartu admin tidak 0/0/0);
  notif saldo rendah di-throttle (maks 1 pesan/6 jam, ulang bila turun ≥Rp5rb).
- Migrasi 0031: kolom `wr_sync_log.trigger` (`manual`/`cron`, default manual
  untuk histori lama). Kartu admin tampil dua-baris (🔵 manual terakhir +
  🟢 cron terakhir) agar sync manual tidak menutupi jejak cron otomatis.
- Anti-starvation cron (2026-09-16, diperbaiki 2026-09-18): job `queued`
  milik order final (dibatalkan/kadaluarsa) dibersihkan + `pendingJobs` hanya
  order lunas/paid; slot `warung_rebahan` dijamin bila sync basi >45 menit
  (guard histori agar budget R12 deterministik di fixture tanpa WR).
  Koreksi 18 Sep: syarat lama `pendingWrDue === 0 && pendingWrDelivery === 0`
  DIBUANG — syarat itu memveto dirinya sendiri karena fase WR menangani order
  DAN sync, sehingga selama ada order WR menggantung guard tidak pernah
  menyala (sync mati 2,5 jam setelah perbaikan deadline 18 Sep, dua order
  Meitu 04:38–07:14 UTC). Fase WR juga didahulukan ke depan urutan eksekusi
  saat sync basi (admission sync memakai budget baseline 40 + deadline 45 s,
  sehingga bila jalan belakangan sisa budget/waktu sering habis dan sweep
   di-skip diam-diam). Skip sweep karena budget/deadline WAJIB ditandai
   (`cron_deferred` + `results.wr_sync_skipped = "deadline"|"query_budget"`).
 - Observability skip jujur + heartbeat (2026-09-19, live): gap sync
   07:12→10:24 UTC tak terlihat karena SEMUA jalur skip selain
   budget/deadline mengembalikan `synced:0 + skipped:null` yang ambigu
   (fase tak aktif / interval 30 mnt belum tempo / switch mati / tabel belum
   siap). Kini `results.wr_sync_skipped` terisi di semua jalur: `"disabled"`
   (master switch mati / tabel WR belum ada), `"phase_inactive"` (fase tak
   aktif, rotasi normal), `"interval"` (sweep terakhir <30 mnt — kondisi
   tersering), `"sync_disabled"` (`WARUNG_REBAHAN_SYNC_ENABLED=false`),
   ditambah `"deadline"`/`"query_budget"` yang sudah ada. `results.
   wr_last_sync_at` = `created_at` sweep terakhir agar respons tunggal cukup
   untuk diagnosa. Heartbeat `store_settings.cron_last_hit_at` ditulis tiap
   hit (1 statement, best-effort): cara baca — heartbeat segar + sync basi =
   run kepotong (deploy); keduanya basi = pemicu Worker mati. Revisi 19 Sep
   sore: `wr_last_sync_at` dibaca DI DEPAN (sebelum cabang fase) sehingga
   respons `phase_inactive`/`sync_disabled` pun membawa posisi sweep terakhir
   dan bisa dinilai basi vs segar dari JSON saja. Nilai `wr_sync_skipped`
   penuh: `disabled`/`phase_inactive`/`interval`/`sync_disabled`/
   `budget_yielded` (sweep dicoba tapi berhenti di plafon)/`attempted_failed`
   (sweep dicoba tapi menyimpan error + `wr_sync_errors` 3 pertama)/
   `deadline`/`query_budget`. Kontrak respons
   ini bagian dari diagnosis definitif di bawah (`wr_products_synced` /
   `wr_sync_skipped` / `wr_last_sync_at`).

   Watchdog sync basi (anti-macet struktural, 2026-09-19): empat insiden
   berulang (poison-pill, guard veto, env mati, gap misterius) semuanya butuh
   forensik manual karena tak ada yang memberi tahu pemilik. `alertStaleWrSync`
   (`src/lib/warung-rebahan/order.ts`, ambang `WR_SYNC_STALE_ALERT_MINUTES=90`
   = 3x interval normal) berjalan di fase WR aktif setelah blok sync: bila
   sweep terakhir >90 menit + belum pernah alert untuk kebasian ini → tandai
   `wr_sync_state(sync_stale_alerted_at)` DULU lalu ping Telegram admin berisi
   umur basi + waktu sweep terakhir + `wr_sync_skipped` run ini + arahan
  (cek respons cron / Force Sync). Idempoten per episode (maks 1 ping;
  sweep sukses me-reset via pengosongan state), best-effort ≤4 query di
  dalam `budget.fits(4)`, hasil di `results.wr_sync_stale_alerted`. Ritme
   normal tak pernah menyentuh 90 menit → tanpa alert palsu.
   Sweep resumable + admission proporsional (2026-09-20, akar ketiga gap
   misterius): sweep cron terbukti 50–116 detik (`duration_ms`) sementara
   gerbang lama hanya menuntut sisa 14 detik — sweep dimulai, kepotong
   platform/deploy di tengah, cursor+log hanya ditulis di ujung = NOL jejak
   + ulang dari awal + kepotong lagi (fetch 200 tiap 5 mnt di log proxy =
   kerja terbuang). Kini (a) checkpoint cursor + `products_progress_at` tiap
   8 produk (`WR_SYNC_CHECKPOINT_EVERY`) — run berikut melanjutkan; (b)
   ~~admission = durasi sukses terakhir × 1,5~~ **DIBUANG 2026-09-20 — lihat
   blok "Budget WAKTU sweep katalog" di atas**: gerbang itu diukur terhadap
   `RUN_DEADLINE_MS` (45 dtk), sehingga estimasi >45 dtk MUSTAHIL terpenuhi
   (ambang mati: `duration_ms > 30.000`). Produksi: 69 dari 104 sweep (66%)
   melewatinya. Karena jalur skip tidak menulis `wr_sync_log`, `duration_ms`
   terakhir membeku selamanya dan sweep tak pernah jalan lagi = sync MATI
   PERMANEN (pulih hanya via Force Sync manual). Penggantinya adalah budget
   waktu DI DALAM sweep, yang membuat durasi tercatat selalu ≤ budget
   sehingga tidak ada nilai beku yang bisa mengunci; (c) partial log + `budget_yielded`
   saat yield dengan kemajuan >0.
   **Aturan umum yang dipetik:** jangan pernah membuat gerbang admission yang
   inputnya HANYA bisa diperbarui oleh pekerjaan yang digerbanginya sendiri —
   itu resep deadlock. Batasi pekerjaannya dari dalam, bukan tolak dari depan.
   **Resume sweep parsial (2026-09-20):** sweep yang berhenti karena WAKTU
   punya `errors` kosong sehingga tercatat `success`; tanpa penanganan khusus
   gerbang interval 30 menit membacanya sebagai "baru sukses" dan menahan
   lanjutannya, sehingga katalog 48 produk butuh ~90 menit (4 potongan × 30
   mnt) padahal kerjanya ~2 menit CPU. Cron karena itu melanjutkan SEGERA
   bila `products_cursor > 0`. Sinyalnya sengaja **cursor**, bukan
   `products_snapshot_complete`: penanda itu di-seed `'0'` oleh migrasi 0029
   sehingga DB yang belum pernah sync tidak bisa dibedakan dari sweep parsial
   yang tertunda. `syncProducts` juga menurunkan penanda ke `'0'` saat sweep
   berhenti di tengah (sebelumnya hanya pernah dinaikkan ke `'1'`).
   Revisi permanen malam 19 Sep (pelajaran insiden 18:26→23:32, 5 jam tanpa
   ping): evaluasi watchdog PINDAH ke depan handler SETIAP RUN (bukan hanya
   fase WR aktif) dengan konteks seadanya (`pre_phase` bila fase WR tak
   aktif); blok 3c menjadi refresh konteks presisi 1x (`refreshStaleWrSyncContext`,
   state `sync_stale_alert_context`) saat fase WR aktif mengetahui
   `wr_sync_skipped` run itu. Hemat budget: skip total bila switch WR mati
   (0 query — pelajaran RR5-02: query depan mencuri slot fulfillment drain
   20-baris); 1 query baca bila tanpa histori. Urutan penting: blok depan
   berjalan SEBELUM `wrTablesReady` didefinisikan → pakai probe `.catch`
   langsung, JANGAN referensi variabel itu (ReferenceError tertelan catch =
   watchdog mati diam — tertangkap test sebelum live). Revisi 20 Sep pagi
   (bukti prod: ping 06:32 "Sebab terakhir: -"): `alertStaleWrSync` kini
   MENCATAT konteks awal (`sync_stale_alert_context`, "pre_phase" bila buta)
   saat menandai episode, dan refresh dilonggarkan — setiap run ber-sebab
   presisi boleh mengoreksi 1x per episode (syarat fase-WR-aktif dicabut,
   karena run-run basi justru jarang memegang fase WR). Force Sync
   dashboard (`POST /api/admin/warung/sync`) mem-bypass gerbang 30-menit dan
   melaporkan status jujur (success/partial/failed + errors) — pemulihan
   mandiri pemilik tanpa keahlian teknis.
 - Pelajaran Fase A 18 Sep (PENTING — cek env SEBELUM tuduh kode): sync mati
   8+ jam setelah semua guard benar ternyata karena `WARUNG_REBAHAN_ENABLED` /
   `SYNC_ENABLED` tidak `"true"` di Pages — `isWrEnabled()` false membuat fase
   WR return awal TANPA JEJAK (semua jalur skip menandai deferred; deferred
   kosong = return awal, bukan tersendat). Dua vonis salah yang sempat terjadi:
   (1) "fase bergerak = fase bekerja" — ekor + poison-pill guard jalan selalu,
   fase berpindah tiap 5 menit walau fase WR no-op; (2) "`wr_saldo_log
   api_check` = bukti cron" — refresh manual dashboard memakai source yang
   sama. Bukti kerja WR yang benar = baris `wr_sync_log trigger='cron'` +
   perubahan status link + `reconcile` menarik order. Diagnosis definitif =
   tembak `POST /api/cron/operations` langsung dan baca respons
   (`wr_products_synced` / `wr_sync_skipped`); 401 = rotasi CRON_SECRET
   (Pages + Worker + lokal harus sama; Pages secret baru terbaca deployment
   berikutnya, jadi rotasi selalu diikuti commit pemicu deploy).
- Koreksi vonis 2026-09-17 (PENTING — jangan ulangi salah baca ini):
  `store_settings.cron_phase` yang menunjuk `notify` dengan `updated_at` lama
  BUKAN bukti cron macet. Nilai itu = giliran BERIKUTNYA dalam rotasi 5 fase
  (expiry → fulfillment → warung_rebahan → notify → cleanup), bukan fase yang
  sedang jalan. Bukti cron hidup yang benar = baris `wr_sync_log
  trigger='cron'` tiap ~30 menit (12 jam terakhir 2026-09-16/17 penuh tanpa
  jam kosong: 48 produk + 87 varian `success` tiap run) + `cron_phase.value`
  yang berpindah + `updated_at` segar. Jangan vonis "cron mati" dari satu
  snapshot `cron_phase` tanpa cek distribusi `wr_sync_log` per jam.

### 16.8 Migrasi proxy WR/SK ke AWS (2026-10-02, live)

**Rilis keandalan 26 Oktober 2026:** satu dispatcher egress, shutdown terkontrol,
marker502 `*_proxy_unreadable_response: network_error` untuk WR order/SK v1/trx
2xx tak terbaca, byte UTF-8/path normalization dan removal independen≤200 per ACK.
Sisa ID varian dan hash payload induk dipertahankan setelah kegagalan/restart.
Deploy seluruh dist + backup terpisah; state SMM durable tidak direset. Rincian
bukti/rollback di `issue/sk-vps-reliability-2026-10-25.md`.

Motivasi: add-on QuotaGuard Spike (~$5/mo) adalah third-party sehingga
TIDAK tercover student credit Heroku dan selalu lari ke kartu kredit.
Penggantinya: VPS `t4g.nano` Singapore (`i-022790eb6bb0b1be3`, 0.5GB +
1GB swap, 8GB gp3, ~$5/mo dibayar kredit AWS $143.60 — tahan ~28 bulan).

- **URL baru:** `https://wr-proxy.axvara.tech` (EIP `13.228.147.90`, DNS A
  unproxied, Caddy + Let's Encrypt auto-renew). Kontrak TIDAK berubah
  (`POST /wr/:endpoint` + `/sk/*` + `x-proxy-token`, key server-side).
- **Deploy:** rsync `package.json` + `dist/` (build lokal, bukan di nano)
  ke `/opt/axvara/wr-proxy/`, env `/opt/axvara/wr-proxy/.env` (`chmod 600`,
  TANPA `QUOTAGUARDSTATIC_URL` = direct via IP VPS), systemd `wr-proxy` +
  `caddy` (`Restart=always`, MemoryMax 350M/100M). SSH `ec2-user@` terbatas
  IP rumah; keypair `axvara-sg-proxy` (`~/.ssh/axvara-sg-proxy.pem`).
- **Node 20 wajib** (`nodejs20` AL2023, bukan paket `nodejs` default v18);
  `dnf update` OOM di nano — install bertahap + `max_parallel_downloads=1`.
- **Whitelist:** `13.228.147.90` DITAMBAHKAN di dashboard WR + SK
  (screenshot owner 2026-10-02, keduanya hijau via proxy baru: WR balance
  Rp47.820, SK Rp50.000). IP QuotaGuard lama + add-on + app Heroku
  DIHAPUS TOTAL 2026-10-02 (bukan "setelah pantau" — verifikasi langsung
  hijau hari yang sama).
- **Pages Secrets dialihkan:** `WARUNG_REBAHAN_PROXY_URL` +
  `SEKALIPAY_PROXY_URL` → `https://wr-proxy.axvara.tech` (token sama).
  Secret baru terbaca deployment berikutnya — commit ini pemicunya.
- Catatan OpenClaw: instance lama `t4g.medium` us-east-1 + EIP-nya sudah
  di-terminate/release (backup parsial 540MB di
  `/Users/macbookair/aws-backup-openclaw-20261002/`, tanpa node_modules/
  cache/biner).

### 16.8a WR Jaspay terpisah - 2 November 2026

Status: transport proxy sudah dirilis ke VPS; implementasi/verifikasi terpadu
Pages masih lokal. Dokumentasi resmi tetap base `/api/v1`; tidak memakai atau
menebak `/api/v3`. Allowlist proxy menambah hanya
`POST /wr/jaspay/{products,order,status,orders}` dengan token/key existing,
marker write ambigu existing dan tanpa retry proxy. Rilis seluruh empat modul
dist mempertahankan `.env`/state; baseline index pra-tugas identik dengan produksi
dan tiga modul lain tidak berubah. Backup `dist.backup-jaspay-20261102`, service
active, health200, Jaspay tanpa token401, hash seluruh modul cocok. Bukan bukti
transaksi supplier atau deployment Pages.

Kontrak integrasi Pages: gunakan mirror/link WR existing, bukan provider/tabel
order baru. ID produk/varian memakai namespace `jaspay:` dengan komponen product/
package ter-encode; order Premium lama tidak dipindahkan. Katalog Jaspay terpisah
dari sweep/diff Premium; pengosongan stok Premium harus mengecualikan namespace
ini. Availability dipetakan ke stok unlimited `-1` atau0, bukan `max_quantity`.
Migrasi0091 menambah hanya `wr_variants.wr_max_quantity` nullable dengan CHECK
positif; cap Jaspay missing/invalid gagal tertutup saat penjualan. Validasi jumlah
wajib server-side, termasuk akumulasi baris keranjang varian sama. Harga memakai
markup existing, original_price tidak menimpa compare_price admin, after_note
menjadi ketentuan dan duration memakai parser existing.

Order Jaspay membawa product/package/quantity dan `ref_id` deterministik dari
idempotency key; password/email_invite tidak dikirim. Receipt hilang hanya boleh
diulang melalui kontrak duplicate-ref dengan input/ref persis sama; known invoice
JSP hanya melalui status Jaspay, tidak memakai nama/waktu/feed50terbaru untuk
korelasi. Lease, budget, CAS kepemilikan dan sent fence Premium tetap berlaku.
Webhook memverifikasi HMAC-SHA256 body mentah dari X-Digitals-Signature, dengan
alias legacy hanya jika primary absen; Jaspay memakai data.invoice. Partial atau
accounts/count/status tidak koheren disimpan terenkripsi untuk tindak lanjut
admin tanpa menyelesaikan seluruh item, membeli ulang atau refund buyer otomatis.
Copy publik white-label: Diproses otomatis; waktu proses mengikuti antrean, bukan
stok instan atau proses admin. Tidak ada env/cron/secret baru.

Pengaman lanjutan sesudah review read-only (2 November 2026): cap Jaspay juga
dicek di guard atomik `createOrderWithStock` (EXISTS `wr_max_quantity >= qty`
pada batch reservasi yang sama; cap NULL ditolak). Sync Jaspay memakai SKU
`WR-J` + SHA-256 ID varian, tidak pernah me-remap baris SKU milik varian lain,
memaksa stok0 bila cap baru invalid, dan menjalankan zero-missing (stok `!=0`,
termasuk -1) hanya setelah feed lengkap tanpa error/berhenti budget. Completed
hanya bila akun yang benar-benar berisi >= qty dan qty laporan sama; selain itu
payload lengkap (tanpa potongan) disimpan terenkripsi secara monotonik: replay
dengan akun lebih sedikit tidak menimpa bukti. `jaspay.failed`/`jaspay.refunded`
menjadi failed nyata (link + item) tanpa refund buyer otomatis; completed tidak
diregresi. Recovery duplicate-ref mengklaim lease sendiri (bukan `claimed`) dan
bind ber-CAS pemilik+status. Poll invoice dikenal memakai antrean jatuh tempo
`next_attempt_at` (backoff 2/10/60 menit menurut umur), tanpa batas 24 jam;
reconcile `/transactions` Premium mengecualikan `jaspay:%`, dan refresh order
memakai status Jaspay per invoice.

### 16.7 Health anti-false-alarm + kelas pengiriman WR (2026-09-16)
- Query health `tgQueue`/`fulfillmentQueue`/`oldestDue` JOIN orders dan hanya
  menghitung order lunas+paid. Sebelumnya 7 `failed` order final menyeret
  Telegram ke `degraded` padahal bot sehat (webhook 0 pending, no error).
- Migrasi 0032: `wr_variants(wr_delivery_class, wr_delivery_source)`.
  API WR DULU tidak memberi penanda auto/manual — desain hibrida: seed 17 nama
  screenshot admin (`screenshot`) + `guessDeliveryClass()` untuk sisanya dan
  varian baru (`system`) + kunci manual owner (`admin`). Sync TIDAK PERNAH
  menimpa yang sudah terisi (pola override 0030). Default ragu = manual.
- Migrasi 0060 (2026-10-11, live): `wr_variants.wr_delivery_mode` (tanpa
  CHECK) — API WR KINI mengirim `delivery_mode` per varian ("auto" = dikirim
  otomatis begitu lunas, "manual" = dikerjakan admin WR, "mixed" = tergantung
  ketersediaan, diperlakukan antrean/under-promise). Itu SUMBER KEBENARAN
  kelas: sync menurunkannya via `deliveryClassFromApiMode()` (auto→restock,
  manual/mixed→made_by_order) dan MENIMPA seed/tebakan/kunci admin bila ada;
  kunci admin hanya bertahan untuk varian tanpa delivery_mode. Pra-0060
  (kolom belum ada di D1) sync memakai fallback per statement tanpa kolom
  baru — sync tetap jalan + tetap membetulkan kelas. Audit 2026-10-10:
  62/92 varian salah kelas (mis. Vidio Mobile tampil "Kirim otomatis" padahal
  manual) — penyebab keluhan "katanya instan tapi harus nunggu".
- Penyederhanaan paten ala SK (2026-10-13, migrasi 0061): mesin tebakan
  (`guessDeliveryClass` + daftar nama screenshot) + tombol kunci kelas admin
  + badge sumber ("tebakan/daftar WR/kunci admin") DIHAPUS. Kelas kini murni
  turunan `delivery_mode` (auto→AUTO/`restock`; manual/mixed→MANUAL/
  `made_by_order`; tanpa mode → default deterministik MANUAL), badge panel
  hanya **AUTO / MANUAL** persis `ProcessBadge` SK, route markup tidak lagi
  menerima `delivery_class`. `wr_delivery_source` di-rebuild CHECK hanya
  `('api')` (0061 menormalkan nilai warisan; kelas/mode/data dipertahankan).
  Koreksi kelas selanjutnya = koreksi di dashboard WR. Email wajib:
  web SELALU minta email (revamp 2026-09-23); Telegram/WA + API orders memakai
  `needsEmailForVariant()` (tipe Invite/Link WR atau produk `require_email`).
  `email_invite` hanya dikirim ke WR untuk tipe Invite/Link
  (`wrTypeUsesEmailInvite()`); Private/Sharing di-omit total (temuan admin
  2026-10-07: TARGET ACCOUNT INVITATION nyasar di dashboard WR).
- Badge pengiriman per varian TANPA emoji (2026-09-17, anti AI slop):
  restock = "Kirim otomatis" (pill emerald), selainnya = "Dikirim admin"
  (pill gold). Web: badge di kartu varian PDP + QuickVariantModal. Telegram/WA:
  baris teks polos sendiri per varian. Admin: badge RESTOK/MBO + sumber +
  tombol kunci teks AUTO/MANUAL di tabel markup (PUT `delivery_class`). Kunci:
  `PUT /api/admin/warung/markup {wr_variant_id, delivery_class}` → source
  'admin'.
- Gate auto-order per kelas: `processWrPendingOrders` hanya memproses link
  `restock`; MBO/NULL tetap pending (antre manual). Jangan bypass gate tanpa
  persetujuan owner — MBO = antrean manusia di sisi WR (slow).
- `email_invite` (uji live 2026-09-16, dipersempit 2026-10-07 temuan admin WR
  kasus RBHN-20261005-0127B5): HANYA varian bertipe Invite/Link yang dikirimi
  `email_invite` (`wrTypeUsesEmailInvite`; Link dipertahankan karena tipe nyata
  di API WR — fixture sync memakai `type:"Link"` UUID Canva asli). Private/
  Sharing/dll di-omit total (bukan string kosong) — `processOneLink` cek
  `wv.wr_type` per link sebelum meneruskan `customer_email`. Tanpa email,
  WR 422 "Email Invite is required" dan retry tidak sembuh (saldo aman,
  tidak terpotong). Checkout produk Invite/Link wajib meminta email pembeli.
  UX tetap 1-field (tanpa copy/field baru, keputusan owner 2026-10-07).
- Email wajib SEBELUM bayar (migrasi 0033, 2026-09-16): `products.require_email`
  (toggle admin, untuk non-WR) + `telegram_users.buyer_email` (sekali isi,
  dipakai ulang). Aturan: varian WR Invite/Link OTOMATIS butuh (dari
  `wr_type`, tanpa setting) ATAU produk `require_email=1`. Quote menghitung
  `emailRequired` (1 query IN, tetap hemat); form web validasi + label
  dinamis; `POST /api/orders` 422 guard hitung-ulang DB (jangan percaya
  flag client); Telegram minta via `pending_action=email_for:/emailcart:`
  lalu lanjut invoice otomatis + `customerEmail` diteruskan ke WR;
  WA grup (tanpa form) menolak jelas + arahkan web/Telegram. Jangan ubah
  menjadi opsional-sesudah-bayar: order lunas tanpa email = macet WR.
- Toggle admin `require_email` (fix 2026-09-25): daftar produk admin
  (`GET /api/products`) tidak membawa kolom ini, jadi editor membacanya dari
  `GET /api/products/:id` (`requireEmail`). Simpan hanya mengirim
  `requireEmail` bila nilainya sudah termuat (detail gagal dibaca = kunci
  tidak dikirim, `PUT` tidak menyentuh kolom). `POST /api/products` menerima
  `requireEmail` (default `false`). Dulu centang selalu tampil mati setelah
  refresh dan Simpan berikutnya diam-diam menulis 0.
- Matriks sandbox (2026-09-16, `WARUNG_REBAHAN_SANDBOX=true` → `client.ts`
  tambah `is_test` ke payload `/order`; saldo tidak terpotong, respons
  valid): 3 restock (Prime Video Private, I Love PDF Sharing, Canva Edu
  Link) → `processing` TEST-ORD-*; 3 MBO (Picsart, Express VPN, Zoom 14D)
  → gate menolak (link pending, nol API call); Remini Link tanpa email →
  pending; quote apple-music `emailRequired:true`. Sandbox WAJIB dimatikan
  lagi setelah tes (flag global — order pembeli asli ikut jadi test bila
  lupa). TEST-ORD-* fiktif (WR tak mencatat order test): bukti = validasi
  lolos, bukan delivery. Cara: secret ON → push kosong (deploy) → order
  test via D1 + PATCH lunas → cek link → secret OFF → push kosong → hapus
  order/link/job/item test.

---

## Kontrak navigasi panel admin (2026-09-19)

Panel admin adalah satu route (`src/app/admin/page.tsx`) yang berpindah section
lewat query `?section=<AdminSection>`. Sebagian kartu Ringkasan juga membawa
**parameter filter**; supaya kartu tidak menjadi tombol hias, setiap parameter
WAJIB punya pembaca di section tujuan.

| Pemicu | URL | Dibaca oleh |
|---|---|---|
| Kartu "Pesanan pending" | `?section=orders&status=pending` | `OrdersManager.tsx` (`initial.get("status")`) |
| Kartu "Bukti manual" | `?section=orders&proof=submitted&method=manual` | `OrdersManager.tsx` (`proof`, `method`) |
| Kartu "QRIS perlu dicek" | `?section=payments&payment_tab=qris&event_status=attention` | `PaymentMethodsManager.tsx` + `PaymentReconciliation.tsx` |
| Deep-link stok menipis (pill Ringkasan dihapus 2026-10-15) | `?section=products&low_stock=1` | `page.tsx` → `useProductManager.onlyLowStock` |
| Kartu "Fulfillment" | `?section=bot` | belum ada filter (lihat `issue/audit-admin-panel-2026-09-19.md` A5) |

Section `agent` dan `subscribers` (2026-09-20) tidak lagi punya entri sidebar —
keduanya tab di dalam `settings` (`src/components/admin/SystemTabs.tsx`).
Nilainya TETAP sah di `ADMIN_SECTIONS` supaya tautan lama membuka tab yang
benar, dan `AdminShell` menyimpan judul fallback untuk header mobile.

`GET /api/admin/orders` (2026-09-20): blok `stats` memakai `where` + `bindings`
yang sama dengan daftar, sedangkan `counts.channels` sengaja TETAP global
karena menjadi sumber angka tab kanal (pemilih). Mengubah `counts` menjadi
ikut filter akan membuat tab kanal menampilkan 0 dan tidak bisa dipakai
kembali.

Aturan turunan:
1. `navigateAdmin()` memakai `pushState`, yang **tidak** memicu `popstate`.
   Karena itu filter lintas-section harus diterapkan langsung di
   `navigateAdmin` DAN disinkronkan ulang di listener `popstate` (tombol
   back/forward browser), bukan salah satu saja.
2. Setiap filter yang aktif wajib terlihat sebagai chip yang bisa dilepas.
   Filter tanpa kontrol di layar (dulu: `proof`) menyaring daftar secara
   diam-diam sehingga pesanan tampak hilang.
3. Satuan metrik harus sama antar-layar. "Stok menipis" = **varian aktif
   berstok 0–5** pada field API Ringkasan (`/api/admin/overview`, tanpa pill UI sejak 2026-10-15) maupun Produk
   (`lowStockVariants` dari `/api/products`).

### 16.9 Rail QRIS GoPay (2026-10-02 Fase 0 — ledger multi-provider, default mati)

**Kontrak terkini27Oktober2026:** invoice baru memilih GoPay pribadi Axvara
Digital/G564039370 (nomor082135277434), payload dari `.gopay-credentials` ke
GOPAY_STATIC_QRIS secret_text, GOPAY_QRIS_ENABLED=true dan QRIS_ACTIVE_PROVIDER=gopay.
Pilihan GoPay tidak lengkap gagal tertutup, tanpa fallback DANA. Callback wajib
HMAC x-poller-signature selain x-poller-secret, serta bukti merchant/order/waktu
settlement. Poller bertanda tangan dirilis dahulu; gate/backoff/hold durable dan
cadence minimal15detik/adaptif menggantikan wake10detik/refresh manual lama.
Seluruh kontrak, rollout dan rollback ada di bagian GoPay27Oktober di awal dokumen;
rincian bertanggal2–16Oktober di bawah adalah riwayat, bukan pilihan aktif baru.

**Perbaikan live25 Oktober 2026:** ACK poller wajib HTTP2xx + JSON ok:true/status
paid|already_paid|duplicate|unmatched; kegagalan tidak masuk seenTx dua jam.
Retry memakai event ID sama pada cadence existing. POST redirect manual;
`/tick` legacy mengantrekan wake loop tunggal (queued/eta_ms), bukan polling
paralel. Seluruh dist termasuk pages-forward.js dirilis ke /opt/axvara/gopay/app.

Motivasi: lepas dari HP Android (QRIS Hook DANA) untuk order pribadi —
poller server memantau mutasi GoBiz milik sendiri.

- **Ledger generik:** `payment_transactions.provider` = `dana` | `gopay`;
  allocator + causal guard + history + reissue berlaku per provider.
  Unique index terpisah (`..._active_dana_amount` / `..._active_gopay_amount`)
  sehingga nominal GoPay BOLEH sama dengan nominal DANA — matcher WAJIB
  filter provider di semua query kandidat.
- **Rail aktif order baru:** `QRIS_ACTIVE_PROVIDER` (`dana` default =
  perilaku lama; `gopay` bila `GOPAY_QRIS_ENABLED=true` + secret).
  `createDanaQrisInvoice()` = wrapper tipis (signature tetap); Telegram/WA/
  web memakai `createActiveQrisInvoice()`. Rollback = 1 env.
- **Webhook GoPay:** `POST /api/webhook/gopay` (HMAC `x-poller-secret` =
  `GOPAY_POLLER_SECRET`, BUKAN publik) — cermin webhook DANA + `order_code`
  langsung bila poller menyertakan. Event tercatat `provider='gopay'` di
  tabel `dana_webhook_events` (nama tabel dipertahankan).
- **Legacy ranges hanya DANA** (`pt.provider='dana'` di predikat) — riwayat
  GoPay selalu lengkap sejak awal (tidak ada reissue penghapus).
- **Poller:** folder `axvara-gopay-poller/` (Fastify `:3002`, systemd terpisah
  di VPS yang sama dengan wr-proxy, session `chmod 600`, **interval 15 detik
  + jitter 0–3 detik + zero poll saat idle + backoff exponential 30s→5 menit
  (patch anti-ban 2026-10-02, konsensus komunitas gobiz-payment)**, read-only,
  401 → backoff + notif, JANGAN loop login). Fase 0 = skeleton
  (`/health` + `/tick`); Fase 1 = login OTP 1x + polling GoBiz beneran.
- **Idle 60 dtk + wake (2026-10-10, insiden 1102 Workers Free):** tanpa invoice
  pending poller tidur `IDLE_POLL_INTERVAL_MS` (default 60 dtk; dulu ~16 dtk =
  ±5.100 request/hari ke `/pending`). Ada pending/error = 15 dtk + jitter seperti
  biasa. Pages membangunkan poller via `POST https://wr-proxy.axvara.tech/gopay/wake`
  (Caddy `handle /gopay/wake` → `127.0.0.1:3002/wake`, header `x-poller-secret`
  sama, 401 tanpa secret) dari `src/lib/payments/gopay-wake.ts`
  (`scheduleGopayWake`, `waitUntil`, timeout 1,5 dtk, dedupe isolate 3 dtk,
  best-effort) saat: QR GoPay terbit (`createQrisInvoice`) / diterbitkan ulang
  (`reissueDanaQrisInvoice`), tombol web "Cek Status Sekarang"
  (`GET /api/orders?code=…&wake=1`, hanya invoice GoPay pending; polling
  otomatis halaman TIDAK mengirim `wake`), dan tombol Telegram "Periksa
  Pembayaran" (`handleOrderRefresh`). Poller tetap satu-satunya pemanggil
  GoBiz (tanpa poll paralel) dengan jarak minimum `WAKE_MIN_GAP_MS` 10 dtk.
  Env opsional Pages: `GOPAY_POLLER_WAKE_URL` (default URL di atas).
- **Sesi GoBiz (insiden 2026-10-10):** refresh token BERROTASI tiap auto-refresh
  library (~25 mnt). Poller WAJIB menulis sesi lewat `onTokenRefreshed`
  (atomik tmp+rename, chmod 600) — tanpa itu restart memuat token basi dan
  poller mati. Refresh token mati = status `session_dead_login_required` +
  notif Telegram. Login ulang di VPS: `cd /opt/axvara/gopay/app && set -a && . ./.env && set +a`
  lalu `node dist/login.js request <nomor tanpa 0>` → `node dist/login.js verify <otp>`
  → `sudo systemctl restart gopay-poller` (deviceId lama dipertahankan).
- **Env (`secret_text`):** `GOPAY_STATIC_QRIS`, `GOPAY_POLLER_SECRET`,
  `GOPAY_QRIS_ENABLED=false`, `QRIS_ACTIVE_PROVIDER=dana`.
  **Sejak 2026-10-02 sore (uji Rp5.137 hijau end-to-end):**
  `QRIS_ACTIVE_PROVIDER=gopay` — order baru via GoPay, DANA fallback.
  Rollback = 1 env kembali ke `dana` + deploy.
- **Ganti merchant GoPay 2026-10-16 ✅ live:** QRIS GoPay aktif kini merchant
  **axvara.tech** (`G284624569`, NMID `ID1026616934059`); secret Pages
  `GOPAY_STATIC_QRIS` diganti ke payload merchant baru (nilai hanya di secret,
  tidak di repo). Poller mendukung **dua akun bersamaan** agar invoice lama
  tidak yatim: Pages `GET /api/webhook/gopay/pending` kini menyertakan
  `merchant_id` yang dibaca dari `qris_payload` tersimpan tiap invoice
  (`getGopayInvoiceMerchantId`, CRC wajib valid; payload rusak/tidak dikenal →
  `null`, tidak pernah fallback ke merchant konfigurasi saat ini). Poller
  (`axvara-gopay-poller/src/merchant-routing.ts`) mengelompokkan invoice per
  merchant; respon Pages lama tanpa field tetap dirutekan ke merchant utama
  legacy. Tiap merchant punya file sesi + state backoff/401 sendiri:
  utama `GOPAY_MERCHANT_ID`+`SESSION_PATH` (`/opt/axvara/gopay/.session`),
  kedua `GOPAY_SECONDARY_MERCHANT_ID`+`GOPAY_SECONDARY_SESSION_PATH`
  (`/opt/axvara/gopay/.session-axvara-tech`); sesi kedua wajib merchant dan
  path berbeda, token hasil refresh hanya menulis file akunnya sendiri.
  `merchant_id` null/tidak dikenal tidak mengkueri akun mana pun dan tidak
  meneruskan pembayaran. Health poller menampilkan `merchantSessions[]`.
  Rollback QR: kembalikan secret `GOPAY_STATIC_QRIS` ke payload lama +
  redeploy; invoice yang sudah terbit tetap dirutekan sesuai merchant
  tersimpannya selama sesi akun itu masih dikonfigurasi di poller.
- **Migrasi 0054:** index gopay + trigger `IN ('dana','gopay')` + kolom
  `provider` di events. Issue: `issue/qris-gopay-ganti-hp-hook-2026-10-02.md`.

### 16.10 Pedia Dua Provider dan Handoff (Working-Tree 2026-10-12)

- **Rebuild kurasi 2026-10-14 (keputusan owner):** plafon Hemat/Standar/Premium dibuang. Migrasi **0062** rebuild `pedia_tiers`: CHECK 3-nama hilang, `UNIQUE(product_id, supplier, supplier_service_id)`, kolom kurasi `public_name/description_md/region/quality/speed_note/drop_risk/is_recommended/sort_order` (diterapkan ke prod via API per-statement + pola rename — `DROP TABLE` induk gagal FK dari `pedia_order_items`; tabel lama tersimpan sebagai `pedia_tiers_old0062`, id tier yang dirujuk order lama PERTAHANKAN persis). Katalog publik kini mengirim daftar layanan per produk (nama publik + deskripsi bahasa manusia + atribut + `price_per_1k` dari rate live + `quick_quantities`), rekomendasi lebih dulu; UI order = `ServicePicker` (rekomendasi utama, tombol lihat-semua, filter wilayah/refill/kualitas, urut) + jumlah bebas (chip cepat + input angka; validasi min–max layanan; produk `step=1`). Harga acuan client = harga paket tersimpan bila jumlah persis paket, selainnya estimasi per-1.000 — selisih tetap memicu consent quote. 34 layanan aktif terkurasi nama/atribut/deskripsi publik; glosarium istilah di halaman order. Mesin uang (quote JWE/dispatch/kredit) tidak berubah kontraknya.

**Deployed 2026-10-14** (proxy dua-provider live di VPS; flag order/dispatch Pages DIBUKA; lihat butir rilis di bawah). Yang masih pending: API key IndoSMM valid (key lama ditolak upstream) + bukti IDR/rate per 1.000, serta top-up saldo ProviderSMM untuk order nyata pertama.

| Boundary | Kontrak aktual |
|---|---|
| Pages → VPS | `callPediaProxy` merutekan `providersmm` ke `POST /psmm/:action`, `indosmm` ke `/indosmm/:action`; allowlist services/add/status/refill/refill_status/cancel/balance, JSON inbound → form upstream |
| Auth | Pages `WARUNG_REBAHAN_PROXY_URL/TOKEN` existing; header `x-proxy-token` divalidasi terhadap VPS `WR_PROXY_TOKEN` |
| Secret VPS saja | `PROVIDERSMM_API_KEY`, `INDOSMM_API_KEY`; key/action pemanggil ditimpa server; tidak dikirim Pages/git/log |
| Gate IndoSMM | services/add perlu `INDOSMM_RATE_PER_1000_VERIFIED=true` serta balance terbaru `currency === "IDR"`; gagal 503 `indosmm_pricing_unverified`; tanpa konversi kurs. balance/status/refill/refill_status/cancel recovery tidak memakai gate itu |
| Diff VPS → Pages | Tiap 10 menit, header `x-supplier-sync-token`, body `{source: "providersmm"|"indosmm", currency:"IDR", services:[], removed_service_ids:[], heartbeat?}`; input divalidasi sebelum tulis, max 100 services + 100 removed/request, non-2xx bila apply parsial |
| State/compat | D1 key `(supplier,service_id)`, harga IDR per 1k. Legacy ProviderSMM tanpa currency tetap IDR; IndoSMM wajib currency. Snapshot terpisah `state/psmm-diff-state.json` / `state/indosmm-diff-state.json` (`PSMM_DIFF_STATE_FILE`/`INDOSMM_DIFF_STATE_FILE`), batch maju hanya 2xx |

- Marker diff memakai prefix `pedia_diff` / `pedia_indosmm_diff`; saldo, `*_balance_checked_at` dan `*_balance_alert_at` terpisah per provider. Lite cron cek saldo maksimum sekali/30 menit/provider; hanya saldo IDR valid masuk log, alert throttle 6 jam atau turun melintasi Rp5.000. Overview admin menampilkan live/cache/error/pricing_verified/last_sync per provider; IndoSMM pricing_verified memerlukan services berhasil melewati gate, `/health` proxy hanya konfigurasi key.
- Receiver menggunakan upsert/removed/reprice per provider, bukan migrasi identity baru. Resync admin eksplisit supplier, katalog nonkosong tervalidasi, potongan 100; tidak menandai missing dari resync manual (missing ditangani diff). Diff VPS membatasi kedua array secara independen: layanan `chunkMax` dinormalisasi 1..100 (default 50), removals maksimum 100 per batch. Antrean dan snapshot maju hanya untuk potongan yang mendapat ack 2xx; sisa termasuk >100 removals dilanjutkan pada batch berikutnya, bukan batas pending. Katalog kosong atau >50% missing tetap ditahan di proxy.
- Quote baru `EncryptJWT`, JWE compact `dir/A256GCM`, key SHA-256 dari `ADMIN_JWT_SECRET`, TTL 30 menit; mengikat `refill_days` dan `min_profit_rp` selain provider/service/rate. Verifier tetap membaca HS256 legacy belum kedaluwarsa dan default supplier legacy ke ProviderSMM; token baru menyembunyikan identitas/modal, legacy signed payload masih terbaca sampai expiry. Order menolak provider/service yang berubah sejak quote walau harganya sama (`409 service_changed`).
- Order item menyimpan kolom provider/service/rate/order supplier serta snapshot `refill_days/min_profit_rp` dari quote, sehingga edit tier tidak mengganti ketentuan yang disetujui. Dispatch dan polling memakai asal item, refill/status refill memakai provider asal; remapping tier hanya order baru. Quote/order legacy tanpa field tersebut masih fallback tier. Refill `requested/submitted/needs_check` tetap diblokir berapa pun usianya; hanya refill belum pernah diajukan atau hasil terminal konklusif dapat diklaim, dengan jeda 24 jam dan masa refill dihitung dari waktu order dibuat. ID/key refill ambigu tidak diganti. Supplier order ID tersimpan di kolom saat add sukses; recovery `mark_submitted` juga mengisi snapshot JSON.
- D1 CAS `queued → submitting` + increment attempts + lease **5 menit sebelum** jaringan; hanya order lunas. Max 20 queued dan 20 polling/cycle, bukan batch status 100. Add timeout Pages 30 detik (proxy upstream 20 detik), status 20 detik. Error eksplisit supplier, timeout/5xx/unreadable/ID hilang atau lease submitting basi → needs_check, tanpa retry/failover otomatis. Poll gagal memperpanjang lease; refill_status hingga 5 item berbatas budget. Normalisasi spasi status dan Cancelled/Canceled. Terminal/kredit/notifikasi tidak menjadi satu transaksi end-to-end karena perubahan ini.
- Proxy reservation durable di `SMM_IDEMPOTENCY_DIR` (default `state/smm-idempotency`, subfolder `psmm`/`indosmm`), hash action+key dan fingerprint parameter, exclusive create + fsync file/direktori **sebelum upstream**, sukses disimpan atomik tanpa TTL/eviction. Add wajib Idempotency-Key stabil kode order 1..120 karakter (tidak dipotong); refill/cancel dedupe hanya jika header diberikan. Replay sukses tidak memanggil upstream; pending/corrupt/ambigu → 409 needs_check, key sama payload beda → 409 conflict, storage gagal sebelum submit → 503. Hanya rejection eksplisit 2xx error string tanpa order/refill melepas reservation otomatis; Pages tetap needs_check.
- Jangan hapus pending/corrupt, mengganti provider/key atau reset direktori idempotensi untuk retry ambigu. Backup seluruh state; single-VPS durable storage bukan dedupe lintas host, cache in-memory lama tidak dapat dipulihkan, belum ada endpoint reconcile/pruning. `mark_submitted` recovery memverifikasi ID/status/conflict provider asal; resubmit/cancel+kredit dibatasi belum pernah mencoba add (`submit_attempts=0`, tanpa ID). Dedupe proxy tidak menjamin exactly-once end-to-end atau atomisitas order/kredit/invoice.
- Rollout terpisah: siapkan backup state dan handoff secret server-side/bukti unit dulu; receiver Pages kompatibel sebelum diff IndoSMM proxy. Review mapping/ETA/refill/margin dan kurasi produksi, verifikasi mock serta QA fully hydrated/HTTP/CSS/Obscura/build, baru deployment dan aktivasi owner. Tidak ada secret/gate/deploy/push yang dilakukan saat sinkronisasi docs ini.
- **Rilis 2026-10-14 (keputusan owner):** build proxy dua-provider TERDEPLOY ke VPS (`/health`: `indosmm:true`). Key IndoSMM pertama ditolak upstream ("Invalid API key"); **key baru owner (14 Okt) VALID** — `balance` membalas `currency:"IDR"`, satuan rate terverifikasi per-1.000 dari katalog nyata, `INDOSMM_RATE_PER_1000_VERIFIED=true` dinyalakan, services 4.411 layanan ter-sync ke D1 (4.074 baris), dan **12 peringkat `indosmm` terkurasi live** berdampingan ProviderSMM (katalog 17 produk). Saldo kedua provider masih Rp0 (belum diisi owner) → pengiriman order nyata pertama menunggu top-up, tanpa saldo jatuh `needs_check`. Flag Pages `PEDIA_ORDERS_ENABLED=true` + `PEDIA_DISPATCH_ENABLED=true` DIBUKA (PATCH env + redeploy build yang sama agar terbaca; `ordersEnabled:true` terverifikasi di HTML prod + quote live mengembalikan token). Saldo ProviderSMM Rp0 atas pilihan owner — order nyata pertama menunggu top-up (tanpa saldo → `needs_check` admin). Kurasi gelombang 1: platform **X** live (Followers #592/#594, Likes #597/#600, Views #447 ProviderSMM; harga dihitung rumus §7.2 dari rate live). UX dirilis bersamaan: kartu katalog panel visual brand 16:10, skeleton Pedia (`PediaCatalogSkeleton`/`PediaOrderSkeleton` + `routeSkeletonKind` pedia di NavigationProgress yang kini juga terpasang di layout Pedia), overlay transisi tengah `CrossAppTransition` ("Memuat AXVARA Pedia/Market") di kedua layout, footer bersama dipadatkan (tautan rapat di desktop, kartu newsletter `self-start`), halaman pesanan Pedia memakai skeleton + modal refill sebaris (tanpa `window.prompt`/nomor WA hardcoded).
- Hasil final aktual MAIN 2026-10-12 setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Bukti supplier live currency/rate-unit dan kurasi awal produksi/approval owner tetap pending.

### Banner dan rekonsiliasi admin (2026-10-15, publikasi CI)

- Migrasi aditif 0064 mempertahankan ID/konten dan urutan tayang lama (`sort_order ASC,id DESC`), menormalkan posisi ke 0..N-1 lalu memasang unique index `banners_sort_order_unique`. Katalog >1000 banner ditolak agar posisi 0..999 tetap valid. Tidak ada rebuild/FK rename.
- Sejak24Oktober helper banner-order memakai guard snapshot+batch staging/normalisasi atomik untuk seluruh mutasi. Reorder menerima permutasi penuh+expected_ids, create append, edit mempertahankan posisi dan delete merapatkan daftar. Kolom dan index0064 dipertahankan; input urutan/timing legacy tidak lagi mengatur isi.
- `AdminStatusSwitch` menyediakan track/knob yang sama dengan Produk, role switch, checked/busy/disabled dan relasi error; digunakan Banner di sebelah Edit dan publikasi produk Pedia. Mutasi banner tetap parsial is_active, konten editor yang belum disimpan tetap dipertahankan.
- Pedia admin memakai helper lokal `DataTable` untuk Produk/Layanan/Pesanan/Kredit/harga tingkat/riwayat saldo: glass wrapper, header/cell/divider seragam dan overflow-x terlokalisasi. Filter/aksi dirapikan; endpoint, lifecycle request, preview tersimpan dan guard recovery tetap sama.
- Sejak24Oktober popup memuat seluruh banner aktif yang tidak disembunyikan ke satu carousel; cap sesi global dihitung sekali per pembukaan. Ref tetap membatasi satu popup per dokumen, penutupan tidak memicu modal berikutnya.
- Events QRIS mengekspos `provider` (null legacy menjadi dana), health berisi provider efektif dari `activeQrisProvider()`, boolean konfigurasi dan waktu event per provider. Tidak ada secret/payload mentah di respons, konfigurasi bukan bukti kesehatan poller GoBiz. Panduan dan ACC mengikuti merchant invoice; engine pembayaran dan guard retry tidak diubah.


### 16.11 PG KlikQRIS — 2026-10-18

**Sejak27Oktober2026:** order baru kembali ke GoPay pribadi atas instruksi owner.
Bagian ini tetap berlaku untuk invoice KlikQRIS tersimpan dan rekonsiliasi lama;
key/merchant/enabled/callback tetap, initializing hanya recovery GET ID yang sama.
Jangan mengubah invoice lama menjadi GoPay atau mengulang POST create.

Sumbatan antrean expiry 2026-10-18: jalur batal mandiri/admin tidak menutup
ledger `payment_transactions`, sehingga order terminal meninggalkan ledger
`pending` yatim. Guard `transitionPendingPaymentOrder` mensyaratkan order
`pending`, jadi yatim selalu no-op; kandidat `runExpiry` diurutkan deadline
terlama dengan LIMIT kecil sehingga 6 yatim produksi (5 GoPay + 1 KlikQRIS)
menyumbat slot teratas setiap tick dan pesanan hidup AXV-20261018-AB4D407F
tidak pernah ter-expiry/stoknya tidak kembali walau cron sehat. `runExpiry`
kini menyapu yatim lewat deadline menjadi `expired` + `last_error
orphan_terminal_order` (maks 10/tick) **tanpa menyentuh stok** — stok sudah
dilepas saat pembatalan, melepas ulang berarti dobel — lalu kandidat expiry
utama disaring `o.status='pending'` dengan `EXPIRY_PER_RUN` 4→10. Respons
menambah `orphan_ledgers_swept`; idempoten dan di dalam budget 40 statement.

Deteksi lunas cepat 2026-10-18: callback gateway teramati tiba ±28 detik sesudah
`paid_at`, jadi polling halaman yang sudah berjalan ikut memicu reconcile
KlikQRIS ter-throttle. `claimKlikQrisPollReconcile` mengklaim jendela ±10 detik
secara atomik lewat `last_checked_at` transaksi `pending`; hanya pemenang klaim
yang memanggil GET status gateway, polling lain tetap membaca D1 lokal seperti
sebelumnya. Berlaku pada GET `/api/orders` (Market, poll 5 detik) dan GET
`/api/pedia/orders/[code]` (poll 10 detik). Tombol manual `wake=1` tidak
terikat klaim dan tetap memeriksa seketika. Klaim menulis 1 baris per jendela
per order dan tidak menambah baris baca, cron, atau jadwal baru; transisi lunas
juga menyegarkan `last_checked_at` sehingga tidak ada loop. Teks pemberitahuan
batas bayar di bawah QR halaman pembayaran Market/Pedia dihapus atas keputusan
owner; batas 15 menit, countdown, dan penanganan pembayaran terlambat tidak
berubah, dan notice yang sama di invoice Telegram/WA dipertahankan.

Batal mandiri Pedia (31 Oktober 2026): `POST /api/pedia/orders/[code]/cancel`
(runtime edge, scope rate limit `pedia:cancel` 10/menit). Kode + kontak/akses
diverifikasi dengan `newOrderAccessFailure`/`buyerOrderAccessMatches` seperti
refill; hanya `orders.order_kind='pedia'` berstatus `pending`. Transisi lewat
`transitionPendingOrder(code,"dibatalkan","buyer_cancel",items)` (guard
`operation_guards`, kalah balapan vs pembayaran = 409), item ditutup oleh
`expirePediaCheckouts`. `GET /api/pedia/orders/[code]` menambah
`buyer_canceled:boolean`. Tanpa migrasi/env/cron; invoice provider tidak
dibatalkan dan pembayaran terlambat tetap masuk Rekonsiliasi.

Koreksi runtime/checkout 2026-10-18: `fetch` API dan PNG memakai
`redirect: "manual"` lalu menolak non-2xx. Runtime workerd yang dipakai menolak
`redirect: "error"` sebelum jaringan (direproduksi lokal); penolakan ini sempat
tersamarkan sebagai `klikqris_network_ambiguous` dan meninggalkan ledger
initializing. Tidak mengikuti Location atau meneruskan secret ke host lain.
Test adapter aktual di workerd mencakup POST, PNG, reuse dan penolakan 302.

POST `/api/orders` mengecek quote existing setelah validasi token/keranjang,
sebelum validasi harga/reservasi baru, lalu menyertakan QR KlikQRIS yang berhasil
dipulihkan pada respons `200 reused:true`. Guard UNIQUE tetap menangani race;
retry initializing hanya GET order ID yang sama, bukan POST atau provider baru.
Stok terakhir yang sudah terreservasi tidak menghalangi retry pesanan asal.
GET `/api/orders?code=...&wake=1` dapat memulihkan ledger initializing KlikQRIS
melalui GET provider dan memuat ulang detail QR; polling tanpa wake tidak
memanggil provider. Field tambahan `qris_preparation_error` hanya boolean untuk
notice UI, tanpa detail rahasia; `expires_at` KlikQRIS memakai deadline ledger
15 menit juga saat initializing, sehingga tidak menampilkan TTL order generik
24 jam. Tidak memulihkan pesanan terminal atau mengulang POST untuk 404 ambigu.
Halaman pesanan tanpa QR menawarkan aksi manual ini dan tidak menjanjikan
verifikasi bukti pembayaran. Cleanup/stok/pembayaran terlambat tetap existing.

✅ Diimplementasikan, publikasi melalui CI. Mode **in-house PG**, bukan MY PG/sandbox. `lib/payments/klikqris.ts` terisolasi untuk `POST https://klikqris.com/api/qris/create` dan `GET /api/qris/status/{order_id}`, auth header `x-api-key` + `id_merchant`; create body order_id/amount/id_merchant/keterangan/callback_url dan whatsapp_buyer opsional sejak24Oktober. Credential lokal `.klikqris-credentials` git-ignored/chmod600; Pages `secret_text`: `KLIKQRIS_API_KEY`, `KLIKQRIS_MERCHANT_ID`, `KLIKQRIS_ENABLED=true`, `QRIS_ACTIVE_PROVIDER=klikqris`. Tidak ada key di proxy/VPS/bot credential repo lain, browser, log atau respons publik. Build maintenance `false` membuka pembayaran; env runtime tidak mengganti nilai build. Memilih KlikQRIS tanpa config gagal tertutup, bukan fallback ke merchant bermasalah.

Notifikasi buyer24Oktober: adapter membaca `customer_wa` bersama status/deadline
order sebelum klaim, memakai `parseBuyerContact` untuk menerima hanya WA Indonesia
valid dan maksimal15digit, dinormalisasi62 tanpa plus. Hanya pemenang klaim POST
create menyertakan `whatsapp_buyer`; field diabaikan jika kontak kosong/invalid,
email/JID/ID chat. Tidak membaca email/nama/target supplier untuk request ini,
tidak menambah query terpisah atau kolom baru. Berlaku pada Market/Pedia serta
kanal bot yang sudah menyimpan WA; Telegram tanpa WA tidak dipaksa mengisi nomor.
Reuse pending/paid dan recovery initializing tetap tanpa POST; nomor baru setelah
invoice terbit tidak dibackfill. Respons publik invoice tidak menambah nomor.
Pengiriman success/expired berada di KlikQRIS sesuai template/langganan/sesi
pengirim dashboard, bukan outbox/pacing gateway grup AXVARA. Tidak menambah DM
melalui gateway AXVARA, flag/env/cron/dependensi atau mengubah verifikasi paid.
Sumber parameter: panel WhatsApp KlikQRIS pada screenshot owner24Oktober;
halaman dokumentasi API publik saat pemeriksaan belum mencantumkan field ini.
Owner mengonfirmasi setting expiry gateway15menit pada24Oktober; TTL API tetap
dibaca per invoice dan di-cap oleh deadline lokal, bukan diasumsikan dari dashboard.

`createActiveQrisInvoice` merutekan invoice baru; retry invoice lama mempertahankan provider ledger. Satu klaim `operation_guards` + INSERT initializing atomik sebelum POST, order ID stabil, satu pemenang. Timeout/hasil ambigu tidak di-POST ulang: recovery memakai GET ID sama. Status initializing/pending KlikQRIS tidak memicu kompensasi stok catch Telegram/web, dan cleanup stale-init/expiry existing tetap penjamin. Cron lite expiry menyertakan KlikQRIS pada tick existing agar pengembalian stok tidak menunggu route cadangan per jam; transisi bersyarat tetap mengembalikan sekali. Finalisasi ledger + deadline order dibatch dan difence agar cancel/expiry tidak dihidupkan kembali. Tidak mengklaim exactly-once jaringan provider.

`total_amount` harus integer Rupiah >= requested amount; nominal request/order/merchant wajib cocok, signature disimpan privat, timestamp provider tanpa zona dibaca WIB. **Keputusan owner: tetap 15 menit**, cap paling awal dengan deadline order existing/expiry provider; retry tidak memperpanjang. Provider uji memberi 60 menit: QR yang sudah disimpan tetap mungkin dibayar setelah batas AXVARA. Pelunasan seperti itu masuk manual review, tanpa revive/refund/fulfillment otomatis. Migrasi 0069 menambah satu kolom nullable `payment_transactions.provider_qris_url`, tanpa mengubah data/trigger/index rail lama. `qris_url` adalah proxy AXVARA `/api/payments/qris/[code]/image`; menerima kode AXV dan AXP. Proxy hanya mengambil HTTPS storage KlikQRIS (tanpa redirect), maksimum 2MB, wajib magic PNG, private/no-store. API key/signature tidak dikirim pada fetch gambar atau ke pembeli.

Callback `POST /api/payments/klikqris/callback` menerima JSON <=16KB dan signature constant-time, memeriksa nominal/merchant yang dikirim, lalu **wajib** cek status API autentikasi. Gagal API tidak berarti paid (503 agar provider retry). Merchant/order/requested/total/signature status harus cocok. Confirmed paid memakai event unik `klikqris:<order>:paid` di `dana_webhook_events` provider klikqris; raw_text/hash tidak memuat signature/key. Shared transition atomik melunasi order+ledger+event dan membuat outbox Market. Pedia memakai antreannya sendiri (tidak membuat/mengirim fulfillment Market dengan ID sama); materialisasi WR/SK idempoten + cron existing. Duplikat tidak mengirim ulang produk. EXPIRED gateway tidak memotong lifecycle lokal lebih awal; cron existing memegang pengembalian stok/kredit.

**Dispatch seketika pasca-lunas (2026-10-22):** jalur KlikQRIS sebelumnya hanya *membuat* link WR/SK (`create*OrderLinksForOrder`) tanpa memanggil prosesornya — tidak seperti webhook DANA/GoPay dan retry manual admin yang langsung memanggil `process*PendingOrders`. Akibatnya order SK lunas menunggu tick cron lite 5 menit berikutnya (teramati 25–228 detik antre `pending` sesudah link dibuat pada 20–21 Okt, nol kegagalan POST), sementara klik Retry admin terlihat "memperbaiki" karena route retry memang memanggil prosesor seketika. Kini `reconcileKlikQrisPayment` memanggil `processWrPendingOrders`/`processSkPendingOrders` (`skipOrphanProbe:true`, hanya bila auto-order aktif dan link baru >0) tepat setelah link dibuat — paritas dengan DANA/GoPay. Kegagalan dispatch tetap best-effort: cron lite `sk_orders`/`wr_orders` menjadi penjamin, klaim/ref_id idempoten mencegah beli ganda, dan callback duplikat berhenti di `already_paid` sebelum dispatch ulang.

Pembayaran terkonfirmasi yang melewati deadline atau kalah cancel/expiry disimpan failed dengan last_error `klikqris_late_payment_manual_review`/`klikqris_payment_race_manual_review`, plus satu notifikasi admin pada insert pertama. Notifikasi gagal tidak dipaksa ulang pada setiap callback; entry Rekonsiliasi tetap durable. Admin API/UI melarang retry pencocokan nominal dan confirm_match KlikQRIS agar tidak diarahkan ke rail DANA/GoPay. Tindak lanjut: periksa pembayaran, status order dan stok untuk penyelesaian manual. Jangan menghidupkan order expired otomatis.

Callback per invoice memakai SITE.webUrl kanonis. Pemeriksaan manual web/Pedia `wake=1` dan tombol Telegram refresh memakai API status; polling browser biasa membaca DB dan — sejak deteksi lunas cepat 2026-10-18 — menumpang reconcile KlikQRIS ter-throttle ±10 detik/order lewat klaim `last_checked_at`. Tidak ada worker/cron/polling baru. Webhook/poller/kredensial DANA/GoPay tetap untuk invoice lama. Rollback invoice baru: ubah QRIS_ACTIVE_PROVIDER + rilis CI; jangan cabut KLIKQRIS_ENABLED/key/merchant/callback selama invoice lama/late reconciliation masih perlu dikonfirmasi. Dokumentasi sumber: https://klikqris.com/dokumentasi-api. Uji produksi hanya membuat invoice unpaid berlabel AXVARA-INTEGRATION (callback probe diabaikan); tidak membayar atau menyimulasikan uang produksi sebagai paid.

Koreksi kapasitas env Pages 2026-10-18: penambahan tiga secret KlikQRIS membawa
konfigurasi produksi menjadi 61 + empat variabel sistem = 65 dan publish gagal.
Hanya `PEDIA_DISPATCH_ENABLED` yang tidak dikonsumsi runtime dihapus, sehingga
60 + 4 = 64; keempat env pemilihan/config KlikQRIS serta secret DANA/GoPay lama
tetap tersimpan sebagai `secret_text`. Guard CI dan bukti insiden ada di §17.2.

### 16.10b Pedia IndoSMM: kesehatan layanan, drop label, refill (1 November 2026)
- Tabel `pedia_service_stats(supplier,service_id)` (0085): avg_time (snapshot
  Daftar Layanan), orders_7d, success/cancel/refill rate, ai_score. Cron lite
  `pedia_orders` memanggil `refreshPediaServiceStats` maks 1×/jam (penanda
  `store_settings.pedia_service_stats_refreshed_at`, satu upsert `json_each`,
  hanya layanan yang dirujuk tier) dari `ai.indosmm.web.id/api/analysis?period=168`
  (publik, tanpa key; gagal parse = tidak menulis).
- `pedia_tiers.drop_label` (no_drop/less_drop/high_drop/unknown) + `speed_per_day`.
  Katalog publik menambah `drop_label`, `speed_per_day`, `avg_time`, `refill_mode`,
  `success_pct`, `refill_pct` (statistik hanya bila ≥5 order/7 hari).
- Refill: `src/lib/pedia/refill-policy.ts` dipakai GET status (`order.refill`),
  POST refill dan halaman `/pedia/refill`. Mode `api` bila mirror `api_refill=1`,
  `manual` bila bergaransi tanpa tombol API (`refill_status='manual_requested'`,
  Telegram admin, admin `refill_resolve` completed/rejected), `none` untuk No Refill.
- Komentar custom (0087): `pedia_tiers.input_kind='comments'`, quote field `comments`
  → `custom_comments` di token/snapshot → dispatch `add` + `comments` (newline).
  Tipe layanan wajib cocok (`pediaServiceTypeFor`): comments↔"Custom Comments",
  lainnya↔"Default" di katalog, harga, quote, order, sync, admin.
- Kebijakan supplier jual (12 November 2026, implementasi lokal): `src/lib/pedia/sales-policy.ts`
  menetapkan `PEDIA_SALE_PROVIDER='providersmm'` dan `PEDIA_LEGACY_PROVIDER='indosmm'`
  sebagai satu-satunya sumber gate katalog/pembanding/quote/order/draft admin/shortlist/overview.
  Penjualan baru IndoSMM ditolak 409 `provider_retired`, tetapi retry order tersimpan
  dicari berdasarkan `quote_id` sebelum gate. Tier/produk/snapshot lama tidak di-remap;
  dispatch/poll/refill tetap memakai kolom supplier pada item.
- Diff VPS ProviderSMM kembali ditulis ke cermin D1 melalui `applyPediaDiff`
  (`/api/supplier-sync`), bukan lagi 200 `ignored`. Jalur IndoSMM tetap ada untuk
  perawatan order/mirror lama. Penanda checkpoint per supplier
  (`pedia_diff_*` ProviderSMM, `pedia_indosmm_diff_*` IndoSMM); validasi IDR/batas
  100 dan ack non-2xx pada tulis parsial dipertahankan, dan tidak ada penghapusan
  katalog otomatis dari delta yang tidak memuat ID. Overview admin mengikuti
  supplier jual aktif.

### 16.10c-ter IndoSMM kembali satu-satunya supplier; kode ProviderSMM dihapus (13 November 2026)
Implementasi lokal; publikasi lewat CI. Bagian 12 November (16.10b/16.10c-bis) adalah snapshot historis yang digantikan.
- `src/lib/pedia/sales-policy.ts`: `PEDIA_SALE_PROVIDER='indosmm'`, tanpa supplier riwayat. Katalog publik,
  pembanding harga, quote, order, draft/aktivasi admin, shortlist, dan overview hanya IndoSMM. Baris
  supplier lain yang masih aktif di D1 tidak dijual; retry order tersimpan tetap dicari lewat `quote_id`
  sebelum gate.
- Dihapus: `src/lib/pedia/auto-catalog.ts`, `metadata-refresh.ts`, `supplier-descriptions.ts`; client
  `/psmm/*` dan `callPsmmProxy`; jalur materialisasi/deskripsi/`managedTermsFresh`; checkpoint
  `pedia_diff_*`; kolom/field API khusus katalog otomatis. PEDIA_PROVIDERS = `["indosmm"]`.
- `/api/supplier-sync` membalas HTTP 200 `{ok:true, ignored:true}` untuk `source:"providersmm"` TANPA
  tulis D1 (sementara sampai VPS berhenti mengirim; hapus cabang sesudahnya). Diff IndoSMM tidak
  berubah: validasi IDR/batas 100, checkpoint `pedia_indosmm_diff_*`, ack non-2xx pada tulis parsial.
- **VPS 13 November 2026 (owner-approved).** `PROVIDERSMM_API_KEY` di `.env` proxy
  (`/opt/axvara/wr-proxy`) dikomentari (backup `.env.bak-psmm-20261113050941`), service restart;
  `/health` = `psmm:false`, `indosmm/sekalipay/skg/dgf:true`; log pasca-restart hanya loop diff
  IndoSMM 10 mnt + WR/SK 3 mnt, tanpa error; hanya polling baca yang sedang berjalan. Kode psmm di
  repo proxy belum dibersihkan (follow-up), sehingga cabang 200-`ignored` receiver tetap dipertahankan
  sebagai fallback tanpa tulis D1.
- Skema 0117 (kolom `managed`/`managed_snapshot_at`) dipertahankan karena prod sudah menerapkannya,
  tetapi inert sejak 13 November; tidak ada migrasi baru. Pembersihan data/reaktivasi tier = paket terpisah.
- Item order dengan `supplier` yang tidak dikenal build ini dirender generik dan tidak pernah dispatch
  (`needs_check`); jangan hapus/remap baris sebelum migrasi pembersihan.
- Nilai operasional minimum order dan ambang alert saldo dibaca dari env melalui
  `src/lib/pedia/ops-config.ts`; GET `/api/admin/pedia/settings` mengembalikan nilai EFEKTIF itu.
- **Migrasi data (B2).** `0119_pedia_providersmm_purge.sql` menghapus data provider lama secara
  idempoten/FK-safe: guard order legacy (expired + belum dibayar/dikirim) dihitung ke tabel sementara,
  dependen order dihapus berurutan, lalu tier psmm tanpa referensi, produk yang hanya berisi tier psmm
  (auto/`psmm-`/seluruh tier psmm) tanpa order, mirror/statistik/saldo psmm, dan key `store_settings`
  `pedia_pending:*`/`pedia_psmm_*`/`pedia_managed_*`/`pedia_diff_*`/`pedia_balance_alert_at`/
  `pedia_balance_checked_at`. `0120_pedia_indosmm_reactivate.sql` mengaktifkan kembali 21 tier kurasi
  IndoSMM (5 alasan NULL + 16 margin pulih) yang lolos mirror/rate/tipe/margin dan tidak ada di 0089;
  guard `is_active=0` membuat re-run no-op. Prefix `pedia_indosmm_*`, kolom 0117, arsip 0062,
  IndoSMM/Market/Games tidak disentuh.
- **UI admin (P3, 13 November 2026).** `PediaManager.tsx` kini hanya shell + status strip (saldo
  IndoSMM + "Periksa", produk dijual `<siap>/<total>`, pesanan perlu tindakan → tab Pesanan
  terfilter) dan 4 tab: **Pesanan · Produk · Layanan IndoSMM · Pengaturan**. `?tab=` lama dipetakan
  (`services`/`curation` → Layanan IndoSMM, `credits` → Produk); default Pesanan bila ada tindakan,
  selain itu Produk. Panel di `src/components/admin/pedia/{OrdersPanel,ProductsPanel,ProductEditor,
  ServicesPanel,SettingsPanel,shared}.tsx`; tiap tab memuat datanya sendiri (Pesanan/Pengaturan tidak
  menunggu katalog). Tab "Arsip lama" (kredit) dihapus — API kredit tidak berubah; kurasi menjadi mode
  "Bandingkan per kebutuhan" di Layanan IndoSMM; minimum order dan ambang saldo read-only "dari
  konfigurasi server". Tidak ada kartu/label/supplier ProviderSMM; payload mutasi, guard, dan
  konfirmasi API tetap. Status: implementasi lokal; publikasi melalui CI.

### 16.10c-bis Katalog otomatis Pedia + deskripsi resmi + gate syarat (12 November 2026) — HISTORI, digantikan 13 November 2026
Implementasi lokal; publikasi lewat CI. Bootstrap produksi, deployment, dan QA admin produksi belum dijalankan.

**Kebijakan supplier.** `src/lib/pedia/sales-policy.ts` menetapkan `PEDIA_SALE_PROVIDER='providersmm'`
dan `PEDIA_LEGACY_PROVIDER='indosmm'` sebagai satu-satunya gate katalog/pembanding/quote/order/draft
admin/shortlist/overview. Penjualan baru IndoSMM ditolak 409 `provider_retired`, tetapi retry order
tersimpan dicari lewat `quote_id` sebelum gate. Diff VPS ProviderSMM ditulis ke cermin D1
(`applyPediaDiff`, `/api/supplier-sync`, checkpoint `pedia_diff_*`; IndoSMM `pedia_indosmm_diff_*`).
Tier/produk/snapshot lama tidak di-remap; dispatch/poll/refill memakai supplier item.

**Skema (0117).** `pedia_products.managed` dan `pedia_tiers.managed` (`curated` default / `auto`) plus
`pedia_tiers.managed_snapshot_at` (versi `fetched_at` snapshot resmi saat rekonsiliasi). Deskripsi TIDAK
disimpan di tabel; satu snapshot JSON tervalidasi ada di `store_settings.pedia_psmm_desc_snapshot`.

**Materialisasi (`src/lib/pedia/auto-catalog.ts`).** `planManagedService` memetakan platform/metrik/target
dari registri existing (`platforms.ts`, `link.ts`, `bounds.ts`, `pricing.ts`) secara deterministik dan
qualifier-aware; slug `psmm-<service_id>`, satu produk/tier per layanan, G2 default, paket kanonis dari
batas API, `input_kind='comments'` hanya untuk Custom Comments. Fail-closed: `type_unsupported`,
`platform_*`, `metric_*`, `target_unmapped`, `premium_tool_excluded`, `bounds_invalid`,
`description_missing`/`description_oversize`, `packages_empty`, `terms_conflict`, `warranty_unconfirmed`.
Hanya alasan mesin yang boleh pulih; `manual`/`margin`/`NULL` tidak pernah dihidupkan mesin, tetapi baris
dijeda tetap direkonsiliasi metadata + cap versinya (inactive + alasan manusia + basis harga admin
dipertahankan, CAS `is_active`+reason). `materializeManagedCatalog` idempoten, maks 25/pemanggilan.

**Refill.** Durasi hanya dijanjikan bila sumber menyebut durasi eksplisit DAN anchor eksplisit yang
koheren ("sejak pesanan dibuat"/"setelah pesanan selesai"); `No Refill`/`Tidak Bergaransi` menang lebih
dulu; klaim tanpa durasi atau `api_refill` boolean saja = `warranty_unconfirmed`; durasi "bulan" tidak
dikonversi paksa.

**Deskripsi resmi (`src/lib/pedia/supplier-descriptions.ts`).** Fetch tetap `https://providersmm.id/services`,
`redirect:'manual'`, timeout 15 dtk, batas 3 MiB; parse native `HTMLRewriter` global workerd
(`td[data-filter-table-service-id]`, `div.desc-content`, `br`→newline), normalisasi dan sanitasi
kontak/URL promosi sambil mempertahankan contoh URL target. Setiap baris dicatat `ok|empty|oversize`;
teks >3000 karakter = `oversize` dan barisnya TIDAK dijual (tidak pernah dipotong); cakupan divalidasi per
baris (`count_mismatch` ±5% menolak snapshot). Snapshot dibaca sekali per request; tanpa fetch per pembeli.

**Metadata (`src/lib/pedia/metadata-refresh.ts`).** Throttle >6 jam via
`store_settings.pedia_psmm_desc_last_at`, satu fetch per refresh. Snapshot + enqueue SEMUA layanan present
(`pedia_pending:<id>`) + penanda kesegaran ditulis dalam SATU `D1.batch` (`commitSnapshotAtomically`);
kegagalan statement mana pun me-rollback ketiganya sehingga last-good lama tetap otoritatif. Tanpa D1
native = `kept_last_good`. Refresh dipicu heartbeat `supplier-sync` terautentikasi (delta kosong) dan
resync admin pertama; jalur delta hanya membaca snapshot tersimpan.

**Antrean durable.** Satu baris `store_settings.pedia_pending:<id>` berisi token generasi acak; enqueue =
upsert token (`INSERT…SELECT`, bukan loop per ID) dan ack `DELETE … WHERE key=? AND value=?` (CAS), jadi
enqueue ID yang sama antara pembacaan cermin dan ack tidak hilang. Drain 20/request memutuskan
aktif/nonaktif dari `present` cermin terkini (`present=0`/hilang selalu `service_missing`); sisa tetap
pending untuk tick berikut tanpa memutar ulang awalan.

**Gate penjualan.** `GET /api/pedia/catalog` hanya menyajikan produk+tier `managed='auto'` supplier jual
dengan layanan live valid, deskripsi `ok`, dan cap `managed_snapshot_at` = versi snapshot aktif
(`managedTermsFresh`, fail-closed: cap kosong/tidak cocok = tidak dijual). Quote menandatangani
`terms_version` = versi snapshot; quote/order baru menolak (409 `service_unavailable`) token tanpa versi
atau versi yang tidak lagi cocok, SETELAH lookup retry order tersimpan (retry lama tetap 200). Snapshot
copy memakai deskripsi resmi; nama/deskripsi publik white-label; payload tanpa ID/biaya supplier.

**Admin.** *(Histori 12 November 2026; API `managed_*`/resync sudah dihapus 13 November dan UI-nya
digantikan — lihat §16.10c-ter.)* `/api/admin/pedia/overview` menambah `managed_products/managed_tiers/managed_active/
managed_blocked` + `catalog.{blocked,blocked_total,queue_pending,description_fresh_at}`;
`GET /api/admin/pedia/services` menambah `tier_managed/tier_active/tier_disabled_reason/description_status`
dan filter `?managed=` yang diterapkan di SQL sebelum `COUNT`/`LIMIT` (default semua tipe). `POST` resync
resumable (`cursor`/`done`, maks 25 layanan/request, validasi katalog+duplikat sebelum tulis, sumber gagal
tidak menyapu). `PUT /api/admin/pedia/products`: baris/produk `auto` hanya menerima pricing, jeda, dan
tampilan aman (field sumber dibuang sebelum gate); aktivasi menolak baris diblokir mesin atau belum layak
via `managedActivationEligible` (cap versi = snapshot aktif, cermin valid, `planManagedService` eligible)
→ 409 `managed_ineligible` tanpa mutasi.

**UI admin (`src/components/admin/PediaManager.tsx`).** *(Histori 12 November 2026; "Tarik ulang"/
kartu katalog otomatis sudah dihapus dan UI digantikan 13 November — §16.10c-ter.)* Ringkasan diagnostik
berlabel manusiawi; "Tarik ulang" resumable (`busy` terpisah dari progres yang dipertahankan, lanjut dari cursor terakhir supplier
yang sama, `refresh` hanya request pertama, cursor tidak maju = error, sukses `done` mengaktifkan kembali
tombol + memuat ulang). Filter kelayakan server-side; filter kompatibilitas default OFF; filter supplier
kedua provider untuk diagnosa riwayat.

**Fixture & tes.** `scripts/pedia-managed-fixture.mjs` (aman, tanpa supplier/secret, mencap versi baris
auto) + `tests/helpers/pedia-managed-fixture.ts`; `tests/fixtures/pedia-psmm-services.html` tersanitasi.

### 16.10d Copy layanan Pedia — migrasi 0093 (3 November 2026)
Implementasi lokal; publikasi lewat CI; deployment belum diverifikasi. Data-only, tanpa kolom/env/cron baru.
- Sumber: `scripts/generate-pedia-copy-20261103.mjs --from-cache` (offline: cache nama layanan 1 Nov + `names-20261102.json`; fungsi `classifySource` membaca token Real Look/Real People/Real Human/Real/HQ, with posts, old accounts, mix/bot, Instant Start dan mengabaikan active/buzzer) → manifest `src/lib/pedia/copy-20261103.json`; tanpa argumen skrip membuat `drizzle/migrations/0093_pedia_service_copy_20261103.sql` dari manifest. Tabel keputusan per tier ada di skrip dan wajib didukung token sumber (skrip gagal bila tidak).
- Hasil aktual (artefak): 280 tier aktif terpetakan, 132 berubah — 112 nama (101 mendapat `· Instant Start`, 22 diganti karakteristiknya), 56 deskripsi (23 tabel keputusan, 33 pembersihan "label Real"/"akun real/aktif"/"menurut keterangan layanan"), 23 `quality` disesuaikan dengan kata pada nama; 199 UPDATE.
- Guard: `id AND supplier='indosmm' AND supplier_service_id` + `public_name`/`description_md` lama persis (deskripsi: daftar teks historis), sehingga edit admin tidak ditimpa dan hasil idempoten. Tidak menyentuh `pedia_order_items.snapshot_json`; order lama memakai `service_copy` beku. Tier 285/svc 5834 tidak disentuh (refill 90 vs 30 belum diputuskan owner).
- Katalog `GET /api/pedia/catalog` kini membaca `refill_anchor` (kolom existing) untuk kalimat `refillPromise()`; `whiteLabel()` menambah aturan kosmetik atribusi/label. Generator kurasi lama diperbaiki agar deskripsi tak lagi memuat "label Real".
- UI: chip `Instant Start` (`hasInstantStart`), istilah per kata nama (`serviceTermNames`), satu blok Refill di `/pedia/pesanan/[code]` (status penuh `PediaRefillState`, GET tetap DB-only/no-store/kontak-gated).
- Tes: `tests/pedia-copy-20261103.test.ts` (token + negatif, manifest, migrasi sqlite: guard/idempoten/edit admin/snapshot/285), `tests/pedia-copy-ui.behavior.test.tsx` (chip/Start time/refill/blok refill/live in_progress→completed).
- Verifikasi akhir lokal (3 Nov 2026; bukan deployed/live): vitest penuh 312 file/3975 tes, tsc, `build:pages` lulus; Chromium 89/89 + 16/16 kasus perbaikan; smoke D1 workerd (Miniflare lokal, skrip sementara di luar repo) menerapkan 0090→0093 nyata: koreksi tier 47/388, edit admin + snapshot tak berubah, idempoten, tier 285 tetap 90, CAS `start_count` 0→8278 dengan positif konflik dipertahankan dan konkuren tanpa geser. Batas: tanpa D1 remote/produksi; migrasi remote tetap lewat CI; sumber cache 1 Nov.

### 16.10b Nama layanan Pedia + perapian — migrasi 0089 (2 November 2026)
Data-only: UPDATE `pedia_tiers.public_name`/`is_active` per id dengan guard `COALESCE(public_name,label_note)` = nama ekspor, idempoten, tanpa DELETE/remap supplier. Order lama memakai snapshot. Katalog publik menambah `price_ref {qty,price}` khusus produk `metric='comments'` (jumlah acuan 10 bila valid, selain itu minimum), dihitung `computePediaPrice` yang sama dengan quote. Generator/manifest: `scripts/curate-pedia-names-20261102.py`, `src/lib/pedia/names-20261102.json`.

### 16.10c Info layanan Pedia terpadu - migrasi 0090 (2 November 2026)

> Pembaruan UI 2 November 2026 (lokal, belum diverifikasi deploy; koreksi
> filter refill 2026-11-02 sore): urutan `ServiceInfoCard` kini grid angka
> layanan + caption estimasi, pemisah, Info layanan (deskripsi, kualitas,
> Refill, Drop, Syarat khusus), statistik Pengajuan Refill lalu Arti istilah.
> `DUPLICATE_TERMS` hanya membuang baris generik persis (caption estimasi,
> rentang jumlah sama dengan Min / Max); kalimat refill generated Inggris
> hanya dibuang bila label + N + mode persis sama dengan tier saat ini
> (N/refill_mode/Lifetime tak cocok, refill_days<=0, dan syarat kustom tetap
> tampil). Pencocokan persis juga untuk tiga kalimat generik kurasi dan
> "Refill N hari …" hanya bila N = `refill_days`; Kelipatan N serta syarat
> tanpa-refill/refund tetap tampil. Label drop tidak tersedia memakai kalimat
> tunggal di baris Drop. Tombol varian PDP desktop kini memakai outline
> `focus-visible` cyan. `DROP_MEANING` dan `PEDIA_TERMS` HQ/Real/No Refill
> dipersingkat; `whiteLabel()` tidak berubah. PDP: `ProductCopy.tsx` mengekspor
> `SECTION_HEADING` dan `linkLabel` (hanya URL YouTube → "Tonton video panduan";
> URL lain, termasuk path `/clearcookies` dan slug `/go/...`, tampil utuh; href tidak berubah) dan merender langkah tunggal
> sebagai paragraf. Tidak ada schema, route, env atau API baru.

Koreksi owner 2 November (lokal, deployment belum diverifikasi): container Cara
Aktivasi desktop di `product-detail-client.tsx` kembali ke sub-kartu glass semula,
baik copy varian maupun copy produk; aktivasi tunggal tanpa S&K tetap memakai
pemisah lama. `ProductCopy.tsx`, fokus keyboard varian dan panel Pedia tidak diubah.

> Snapshot implementasi SEBELUM koreksi sore (urutan lama: "grid statistik
> lalu glosarium"): `ServiceInfoCard` merender deskripsi tier dan copy produk
> khusus sebagai teks escaped, syarat lengkap yang unik (hanya duplikat template persis dibuang), garansi/drop, grid statistik lalu
> glosarium kontekstual `PEDIA_TERMS` termasuk HQ/Real. `ServicePicker` menghubungkan
> radio terpilih ke wrapper panel melalui aria-describedby. `OrderClient` menghapus
> duplikasi deskripsi di ringkasan dan memindahkan detail bawah ke panel; Tentang
> layanan sebelum memilih mengabaikan hanya boilerplate produk persis.

`refill_pct` tetap kontrak katalog existing (gate >=5 order), ditampilkan sebagai
Pengajuan Refill 7 hari tanpa klasifikasi risiko/drop, hanya pada layanan refill
dan nilai finite0..100. Tidak mengubah refresh statistik/admin atau snapshot order.
Migrasi0090 adalah UPDATE data-only dengan guard supplier/service ID/copy lama
(tier47/service7887 khusus akun lama); template Real tidak lagi menjanjikan akun
aktif. Copy admin berbeda dan order lama tidak ditulis. Tidak ada kolom baru,
perubahan proxy, impor otomatis deskripsi dashboard, env atau cron baru.

### 16.10a FK tier pesanan Pedia — migrasi 0084 (1 November 2026)
Rebuild 0062 me-rename `pedia_tiers` ke arsip; SQLite/D1 ikut menulis ulang FK
`pedia_order_items.tier_id` ke `pedia_tiers_archive0062_prev2` (36 tier lama).
Akibatnya checkout tier yang dibuat sesudah 0062 (146 dari 152 tier aktif pada
1 November) gagal `FOREIGN KEY constraint failed` di batch klaim dan dibalas 503
"Pesanan belum tersimpan". Migrasi 0084 me-rebuild `pedia_order_items` dengan
definisi schema.sql (FK ke `pedia_tiers`), menyalin semua baris dan memasang ulang
dua indeks; tabel arsip tier tidak disentuh, tidak ada tabel anak ber-FK ke
tabel ini. Route `POST /api/pedia/orders` kini mencatat pesan error D1 batch
(tanpa kontak/target) ke console. Aturan: rebuild tabel induk di D1 wajib
memeriksa `pragma_foreign_key_list` tabel anak sesudahnya; rename tabel induk
ke arsip memindahkan FK anak ke arsip tersebut.

## 17. Penghematan rows_read D1 Free — 2026-10-16

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. Laporan pekerjaan:
`issue/d1-read-budget-2026-10-16.md`. Audit produksi membedakan kuota rows_read
(5 juta/hari, reset 07.00 WIB) dari jumlah statement, CPU Workers, dan rows_written.
Perbaikan log 0057 tetap terpasang; snapshot audit terakhir 4.582.928 rows_read.

- **Pedia:** `src/lib/pedia/catalog-queries.ts` mengawali query batas/rate dari
  tier dan produk aktif, lalu mencari mirror dengan pasangan `(supplier,service_id)`.
  Layanan supplier tak terpakai tidak dibaca untuk katalog. DTO, harga, bounds,
  guard present/Default/rate, dan pemisahan provider tetap. Percobaan baca produksi
  sebelum patch: 414 rows_read untuk 129 layanan rujukan vs rata-rata lama 5.024.
- **GoPay pending:** `/api/webhook/gopay/pending` menggunakan indeks unik existing
  `payment_transactions_active_gopay_amount` dengan predikat partial index eksplisit
  `provider='gopay' AND status IN ('initializing','pending')` dan filter pending.
  Invoice initializing tetap tidak dikirim; auth, expiry order/invoice, merchant
  dari QR tersimpan dan batas 50 tidak berubah. Tidak ada perubahan kontrak poller.
- **Cache katalog:** `src/lib/catalog-cache.ts` memakai Cache API `caches.default`
  secara eksplisit di dalam handler, sehingga panggilan SSR langsung ke handler
  Market ikut terlindungi. TTL Market 30 detik, by-slug 10, Pedia/kategori 60.
  Hanya katalog publik (`active=1` pada Market, kategori tanpa `all=1`); admin
  melewati cache dan autentikasi tetap dilakukan. Key Market mengikat search,
  kategori, slug dan flag varian; prefix kontrak `d1-v1` perlu direvisi bila DTO
  berubah. Cache per lokasi Cloudflare; bukan penyimpanan global atau jaminan hit
  lintas lokasi/deployment. Miss paralel digabung per proses (maks 128 key pending).
  Respons gagal/degraded/private/berkuki tidak disimpan; kegagalan Cache API
  memakai pembacaan langsung. `X-Axvara-Cache` HIT/MISS/BYPASS untuk diagnosis,
  Age mempertahankan umur respons. Cache tidak dipakai untuk quote, checkout,
  status pembayaran, capability atau kredensial. Dev tanpa binding/Cache API
  tetap membaca langsung; `CF-Cache-Status: DYNAMIC` tidak berarti cache internal
  ini miss. Harga/stok checkout tetap divalidasi melalui query aktual.
- **Admin:** section selain Ringkasan tidak memanggil overview. Periode standar
  memakai `selectedReportFromFinancial` dari fact set yang sama, bukan CTE kedua.
  Rentang historis tetap memakai perhitungan terpilih dan kontrak legacy respons
  tetap lengkap. Revisi 2026-10-19: `readOverviewFinancialReport` menahan hasil
  privat maksimal lima menit di memori dan Cache API internal terenkripsi, dengan key
  hari WIB/jam dan generated_at snapshot aktual. Auth/revocation diperiksa setiap
  request; cache gagal dihapus agar retry dapat pulih. Pemanggil laporan lain
  tetap memiliki kontrak pembacaan baru.
- **Cron:** `src/lib/cron-queues.ts` memilih probe sesuai forced phase; mode rotasi
  lama tetap membaca seluruh sinyal admission/anti-starvation. Probe WR/SK tidak
  dibayar oleh fase lain. Watchdog, expiry, order, delivery, retry dan pemulihan
  yatim tetap berjalan; gerbang due tidak dipasang kembali pada probe yatim.
  `src/lib/maintenance-cleanup.ts` dipakai lite dan heavy, memakai marker sukses
  UTC `store_settings.maintenance_cleanup_at`; empat DELETE housekeeping maksimal
  sekali per jam pada run berurutan, termasuk data DANA >30 hari. Tick di antaranya
  hanya membaca marker. Kegagalan tidak memajukan marker; run paralel dapat
  melakukan cleanup idempoten bersamaan. Anggaran heavy cleanup menjadi 6 statement
  (marker + empat DELETE + marker selesai). Tidak ada throttle baru pada jalur uang.
- **Pairs:** agregat stok terbatas dan unlimited digabung satu pass per sisi
  pasangan, tetap satu SELECT dan UPDATE hanya bila berubah. Semua pasangan
  tetap dihitung pada versi 16 Oktober; revisi 17 Oktober memakai antrean
  invalidasi di bawah untuk diff dan mempertahankan sweep penuh sebagai cadangan.
- **Migrasi 0067:** indeks Pedia bernama baru pada tabel aktif memperbaiki kasus
  indeks lama masih milik arsip 0062; indeks mapping supplier+service, created_at
  event DANA, recent-paid recovery (status/payment_status + ekspresi tanggal),
  serta registry WR/SK by axvara_variant_id. Tidak DROP/rebuild tabel atau mengubah
  FK, state, harga, kredit, reservasi, maupun indeks unik nominal QRIS. CI menerapkan
  migrasi sebelum kode Pages; migration test memastikan idempotensi dan FK.
- **Observability:** `db/read-metrics.ts` mencatat metadata queryAll ≥1.000 rows_read
  di kedua akses database melalui log `[d1-read]` (scope tetap + jumlah baca/tulis).
  Tidak mencatat SQL, parameter, hasil, secret atau menulis telemetri ke D1;
  kegagalan log tidak menggagalkan query. first/batch tetap dianalisis via Cloudflare
  Query Insights. Ini pelengkap budget statement, bukan hard stop kuota baris.

Tidak ada env/binding/secret/flag/cron Worker/kontrak antar-repo baru. Verifikasi
biaya baca menggunakan D1/workerd dengan ribuan layanan tak terpakai, riwayat
GoPay terminal dan order lunas lama; cache diuji pada Cache API workerd asli.
Penurunan harian dan CPU produksi sesudah rilis belum diukur.


### 17.1 Penghematan lanjutan — 2026-10-17

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. Baseline audit pukul
11.04 WIB: 1.030.021 reads / 3.977 writes sejak reset; jam 10–11 menyumbang
511.960 reads. Pengukuran ini mendahului rilis lanjutan, bukan bukti penurunan
harian pascarilis. Laporan: `issue/d1-read-budget-phase2-2026-10-17.md`.

- **Ringkasan lengkap:** `admin-overview-cache.ts` menahan seluruh respons D1
  maksimal 60 detik di memori privat per binding/proses; key mencakup email admin,
  periode/rentang kanonik, hari dan jam. Auth, revocation dan validasi parameter
  selalu berjalan sebelum lookup. Miss paralel digabung, maksimal 16 key; error
  atau hasil query parsial tidak disimpan. TTL juga dibatasi expiry snapshot
  keuangan asal agar pergantian periode tidak memperpanjang batas umur data. Revisi 2026-10-19: keuangan maksimal lima menit, sementara respons
  operasional tetap maksimum 60 detik. Periode berbagi agregat; ekspor mengikuti
  laporan terpilih existing.
- **SQL Ringkasan:** `admin-overview-queries.ts` memulai attention dari status
  bermasalah di jobs/items, lalu lookup order paid dan COUNT DISTINCT kode order.
  Ringkasan status jobs hanya membaca status aktif; delivered tetap diabaikan
  oleh evaluator antrean dan sinyal kirim sukses tetap diukur terpisah. SUM omzet
  lama yang tidak dipakai respons dihapus; angka finansial tetap fact set existing.
- **Telegram:** `telegram/catalog-snapshot.ts` memakai satu key publik
  `telegram-catalog-v1`, TTL 30 detik, untuk daftar, filter kategori, pencarian dan
  bestseller. Snapshot minimal menyertakan ID/nama/kategori/urutan/terjual/alias
  dan harga varian tersedia termurah; baris habis disimpan dengan harga null
  untuk jawaban pencarian “habis”. Tidak menyertakan data pelanggan/pesanan/
  kredensial. Kegagalan Cache API membaca D1 langsung; checkout/detail/state
  percakapan tidak memakai snapshot. Cache per lokasi Cloudflare, bukan global.
- **SQL katalog/recipient:** filter pecundang mematerialisasi ID SK bila winner
  NULL/WR dan ID WR bila winner SK, lalu NOT IN; ID pasangan wajib NOT NULL.
  Aturan Opsi B dan redirect tombol lama tetap. Inventory unique memakai EXISTS
  dan indeks `(product_id,variant_id,status)`; indeks orders
  `(sales_channel,telegram_user_id,status,payment_status)` mendukung pencarian
  order paid pembeli saat recipient privat dipastikan. Tidak mengubah penerima.
- **Pasangan berubah:** migrasi `0068_d1_read_budget_phase2.sql` menambah tabel
  `supplier_pair_dirty(pair_id,version,pending)` dan indeks pending. Trigger SQL
  atomik menandai perubahan produk/varian, stok/modal registry WR/SK dan preferensi
  pasangan. UPDATE nilai identik tidak menandai ulang. Token versi acak diganti
  pada invalidasi; hasil ack menyetel pending=0 sambil mempertahankan token,
  mencegah proses lama mengakui generasi baru. Seed migrasi menandai semua pasangan.
  Request VPS `action:pairs` membaca maksimal 10 pasangan pending; UPDATE keputusan
  dan ack disyaratkan versi teramati. Error dipropagasikan sebagai non-2xx (503),
  tanpa membuang pending. Sisa/budget habis diproses berikutnya. Cron lite cleanup
  existing tiap lima menit juga menguras maksimal 10 selama budget cukup, setelah
  housekeeping: perubahan WR saja dan kegagalan request pasangan tidak bergantung
  pada diff SK baru. Saat bersih, satu SELECT indeks membaca nol baris statistik.
  Sweep penuh cron existing tetap ada dan tulisnya dijaga versi agar tidak menimpa
  keputusan dari data lebih baru. Tidak mengubah pemilihan stok/modal, flag,
  jadwal Worker atau request/response sukses VPS; tidak perlu deploy proxy.
- **Pengukuran:** `[catalog-cache]` scope/status dan `[overview-cache]` status
  melengkapi `[d1-read]`; tanpa key, SQL, parameter, isi hasil atau write telemetry.
  Query first/batch tetap memakai Query Insights untuk atribusi biaya.
- **Monitor akun:** `.github/workflows/d1-usage.yml` berjalan jam `:17` UTC
  (`:17` WIB juga), serta workflow_dispatch. Node 22 menjalankan
  `scripts/d1-usage-check.cjs --report /tmp/d1-usage.json --check` dengan Secrets CI
  existing `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, `CLOUDFLARE_ACCOUNT_ID`;
  alternatif CLI menerima API_TOKEN. Hanya Cloudflare GraphQL Analytics, tanpa SQL
  aplikasi/deploy/env Pages baru. Menjumlahkan seluruh database akun sejak 00.00
  UTC (07.00 WIB), laju satu jam terakhir dari bucket tertutup (jeda ingest lima
  menit), proyeksi rata-rata/terkini, sisa anggaran/jam dan estimasi habis bersyarat.
  Limit Free: 5 juta reads dan 100 ribu writes/hari. Setelah jam pertama, proyeksi
  melampaui salah satu limit atau penggunaan ≥90% membuat status risk; limit
  tercapai exhausted. Analytics kosong unknown, respons invalid/gagal membuat job
  gagal, tanpa klaim kuota aman. Status risk/exhausted/unknown menghasilkan warning
  dan exit 1; error exit 2. Laporan agregat tampil di Actions summary dan artifact
  tujuh hari. Notifikasi mengikuti pengaturan GitHub owner; jadwal dapat terlambat,
  analytics dapat delayed/sampled. Ini alarm berkala, bukan alarm Telegram atau
  jaminan realtime, dan tidak menambah polling browser/tulis D1.

Uji D1/workerd dengan fixture besar: filter katalog 40.220→2.040 rows_read,
inventory 250.050→100, attention 24.997→10, tick pasangan bersih 0; hasil bisnis
sebelum/sesudah setara. EXPLAIN memakai indeks recipient baru, dan trigger migrasi
benar-benar dijalankan di workerd. Angka fixture tidak mewakili total produksi.
Target operasional ≤3 juta reads/hari (rata-rata 125 ribu/jam) membutuhkan satu
siklus produksi 07.00–07.00; risiko limit tetap bergantung trafik dan cache hit.


### 17.2. Kapasitas variabel Pages Free — 2026-10-18

Run CI 39128121106 (`47d118d`) lulus test/type-check/build/migrasi tetapi gagal
publish Pages: 65 variabel melebihi batas Free 64. Metadata project membuktikan
61 env produksi; Pages menambahkan `CF_PAGES`, `CF_PAGES_BRANCH`,
`CF_PAGES_COMMIT_SHA`, `CF_PAGES_URL`. Ini batas variabel, bukan kuota D1.

`PEDIA_DISPATCH_ENABLED` dihapus dari env produksi karena tidak ada konsumen di
kode runtime. Catatan flag dibuka 14 Oktober pada §16.10 adalah histori, bukan
gate dispatch aktual; `runPediaOrders` cron lite tetap memanggil
`processPediaPaidOrders` untuk antrean existing. Tidak mengubah penerimaan order
`PEDIA_ORDERS_ENABLED`, secret provider lama/baru, ataupun env preview. Sesudah
penghapusan: 60 konfigurasi + 4 sistem = 64; tidak ada ruang untuk env tambahan.

Guard read-only `scripts/ci-pages-env-check.cjs` berjalan di `ci.yml` push/main
sesudah type-check, sebelum build dan migrasi. GET project API menggunakan
Secrets CI Cloudflare existing, memvalidasi metadata produksi, menghitung
union nama konfigurasi + empat sistem tanpa menggandakan override. Total >64
atau API/auth/metadata gagal menghentikan rilis; tepat 64 menghasilkan warning.
Output hanya jumlah/limit; nilai env dan respons/error mentah tidak dicetak.
Tidak ada query D1, mutasi konfigurasi otomatis, secret runtime baru atau deploy
manual. Perubahan env produksi dilakukan terarah melalui API PATCH, hanya key
usang bernilai null; metadata env lain dan preview diperiksa tetap sama.

Referensi: [batas Workers](https://developers.cloudflare.com/workers/platform/limits/),
[sistem Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[penghapusan env dengan null](https://developers.cloudflare.com/api/typescript/resources/pages/subresources/projects/methods/edit/).
Publikasi ulang tetap melalui push main dan CI; push bukan bukti deploy sukses.

### 17.3. Biaya admin dan polling pembayaran — 2026-10-19

✅ Implementasi; publikasi melalui CI. Audit GraphQL 22.36 WIB mencatat 3.918.472
reads (78,37%); Insights sampled menunjukkan laporan keuangan termahal sekitar
21–22 ribu reads/eksekusi. Sampling bukan persentase atribusi tepat.

- `dashboard-report.ts` mematerialisasi `bindings` agar resolusi link WR/SK tidak
  diulang per ekspresi. Fact set, alokasi nominal/kode unik, modal snapshot,
  Pedia/kredit, WIB dan kontrak output tetap. Rentang historis dihitung baru.
- Agregat keuangan overview disimpan maksimal **300 detik**, di memori per binding
  dan melalui `admin-report-cache.ts` pada named Cache API
  `axvara-private-financial-v1`. Hanya agregat laporan, bukan baris pesanan/kontak/
  kredensial. Payload dienkripsi **AES-256-GCM**, IV acak 12 byte dan AAD URL cache;
  key turunan SHA-256 domain-separated dari `ADMIN_JWT_SECRET` existing (fallback
  `JWT_SECRET`). URL internal berisi digest scope+key, tanpa parameter/admin/secret
  literal. Scope mencakup versi laporan, hari WIB dan jam UTC; key rotation juga
  mengubah URL. Tidak ada secret/env Pages baru. Bukan respons HTTP publik, dan
  lookup hanya setelah auth/revocation/validasi route.
- `generatedAt` di ciphertext menentukan expiry absolut; hit di proses lain atau
  perpindahan periode tidak memperpanjang TTL. Entri tua/masa depan/rusak atau
  kegagalan Cache API membaca D1 langsung; kegagalan kalkulasi tidak disimpan.
  Memory cache memakai expiry sumber sesudah edge hit, bukan waktu lookup baru.
  Cache API per lokasi Cloudflare, tanpa jaminan shared global atau single-flight
  lintas isolate. Hasil runtime fallback tetap tersedia saat Cache API gagal.
- Seluruh respons Ringkasan tetap cache memori **≤60 detik**, dibatasi pula expiry
  keuangan sumber. Respons HTTP `Cache-Control: private, no-store`. Status/antrean
  operasional tidak disimpan lima menit. Checkout/status pembayaran/daftar order
  tidak memakai cache laporan; ekspor memakai laporan terpilih di layar.
- `/api/admin/orders` menggabungkan tiga facet global dalam satu GROUP BY
  `(COALESCE(sales_channel,'web'),status,LOWER(payment_method))`; reducer menghitung
  counts kanal/status dan urutan metode. Pagination total berasal dari agregat
  metrik berfilter existing, menghapus COUNT terpisah. Daftar, filter, ekspor CSV,
  lookup supplier dan status recovery tetap segar.
- Migrasi aditif **0072_d1_admin_read_budget.sql** + schema menambah
  `orders(created_at DESC)` dan `fulfillment_inventory(order_code,status)`.
  Ini melayani daftar terbaru dan subquery reservasi setiap polling KlikQRIS.
  Tidak menyunting migrasi lama, order/ledger/stok, cron, flag atau kontrak VPS.
- Kesehatan jobs/items dan attention memakai `INDEXED BY` indeks status existing
  serta `CROSS JOIN` ke orders supaya planner tidak mulai dari seluruh order
  lunas atau full-scan riwayat antrean pada distribusi status timpang.

Verifikasi biaya/kesetaraan memakai D1/workerd, termasuk Cache API/enkripsi asli,
riwayat inventory, antrean kosong/aktif dan migrasi baru. Hasil dan batas bukti:
`issue/d1-read-budget-2026-10-19.md`. Target harian tetap perlu satu siklus
07.00–07.00 produksi; hasil fixture/push tidak membuktikan target tercapai.

### 17.4. Permintaan client sesuai kebutuhan — 2026-10-19

✅ Implementasi; publikasi melalui CI. `src/app/(shop)/admin/page.tsx` menjalankan
`useProductManager.load()` setelah auth hanya ketika `tab === "products"`.
Load mengambil `/api/products` dan `/api/categories?all=1` untuk daftar/editor;
menu Ringkasan/Pesanan/lainnya tidak memicunya. Masuk Produk dari sidebar, URL,
back/forward dan kembali dari menu lain memuat data baru satu kali; render biasa
atau mengubah filter lokal tidak memuat ulang. Save/reorder/retry tetap memakai
handler existing. Error katalog dibatasi ke menu Produk agar respons gagal yang
tiba sesudah pindah menu tidak mengganggu layar lain. CategoryManager mandiri
mempertahankan kebutuhan API kategorinya sendiri.

`src/app/(shop)/pesanan/[code]/page.tsx` memasang `visibilitychange` untuk dua
siklus polling. Pending menjalankan interval 5 detik QR dinamis/30 detik lainnya
hanya ketika terlihat. Hidden membersihkan interval; visible memicu GET biasa
segera lalu melanjutkan interval, tanpa `wake=1`, POST invoice atau reissue.
Load awal tetap membaca status sekali, termasuk jika halaman awalnya hidden.

Polling lunas/belum ada kredensial membersihkan timeout saat hidden, mempertahankan
attempts/urutan delay cepat-lambat dan maksimum existing. Visible mengecek segera
bila jatah belum habis; event visible berulang dan request in-flight tidak
menumpuk timer/request. Guard `pollOrder` juga menolak auto-poll saat hidden.
Order dibatalkan/kedaluwarsa, kredensial siap atau unmount membersihkan timer/listener; waktu tersembunyi
tidak menghabiskan atau mereset jatah. Request yang sudah dimulai tidak dibatalkan;
responsnya tetap boleh memperbarui status. Countdown tetap berbasis waktu absolut.
Cek manual tetap `wake=1` dan berbagi pengunci request dengan polling otomatis;
webhook/cron/fulfillment/expiry/email tidak berubah.

Tanpa route/komponen/env/migrasi/cron baru. Penghematan dibuktikan melalui jumlah
request fixture; total rows_read/hari tetap perlu satu siklus produksi 07.00–07.00.

## 18. Halaman maintenance kuota D1 — 2026-10-17

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. `src/middleware.ts`
memeriksa ketersediaan D1 sebelum render halaman GET/HEAD dan rewrite Pedia.
`src/lib/d1-maintenance.ts` memakai binding DB seperti client existing, tanpa
mengimpor seed/helper order. Probe `SELECT key FROM store_settings LIMIT 1`
membaca paling banyak satu baris (teruji D1/workerd), tanpa COUNT atau write.
Hasil ditahan maksimal 60 detik per binding/proses, miss paralel digabung; Cache
API per origin/lokasi mengurangi probe lintas proses. Batas ini bukan satu
probe global: cold start/lokasi baru atau kegagalan cache dapat menambah probe.
Tidak ada polling browser. Deteksi/pemulihan dapat tertunda hingga 60 detik pada
request berikutnya. Cache dibatasi reset berikutnya dan key memakai hari UTC.

Hanya error resmi Cloudflare `exceeded D1's free tier daily row read limit`
atau `row write limit` (termasuk nested cause) mengaktifkan maintenance. Error
SQL, CPU, storage atau jaringan lain tetap memakai penanganan existing; probe
error lain ditahan 10 detik. Dev tanpa binding mempertahankan seed existing.
Tidak ada flag/env/secret, binding, migrasi atau jadwal cron baru. Ini menangani
kuota D1; kehabisan request/CPU Worker yang mencegah middleware berjalan tidak
dapat ditangani oleh halaman ini.

`src/lib/maintenance-page.ts` menghasilkan HTML+CSS mandiri, status 503,
Retry-After 60, private/no-store dan noindex. Tidak ada layout React, script,
fetch katalog/settings atau penulisan pesanan. Estimasi 07.00–08.00 WIB
menggunakan tanggal reset UTC berikutnya; situs pulih berdasarkan hasil probe,
bukan menunggu paksa sampai 08.00. Metadata error database tidak ditampilkan.
`/maintenance` (`src/app/maintenance/route.ts`, GET/HEAD edge) adalah dokumen
preview/fallback yang selalu menampilkan layar ini, bukan endpoint health;
middleware melewatkannya sebelum rewrite di kedua host agar tidak berulang.
Navigasi RSC saat kuota habis diarahkan 307 ke `/maintenance`, sedangkan
navigasi dokumen mempertahankan URL dengan HTML 503.

Tombol manual menuju hub absolut `https://axvara.tech/wa` dari `lib/site.ts`, sehingga
host Pedia tidak salah rewrite. `/wa` dan `/pedia/wa` saat maintenance menampilkan
hub mandiri tanpa D1: nomor berstatus active dari SUPPORT_WA_NUMBERS, pesan
`pesan` terbatas 300 karakter/URL-encoded, support Telegram (bukan bot order),
dan jam layanan. Ini mempertahankan pilihan nomor di hub dan tidak menyatakan
admin online 24 jam. API, webhook, supplier-sync, cron, MCP, R2, aset dan metode
mutasi tidak diganti HTML atau mendapat probe baru. CSRF serta routing normal
tetap. Tab yang sudah terbuka tetap memakai perilaku API existing sampai
navigasi/reload; ini bukan penghentian otomatis seluruh request atau bot.

Dokumentasi error resmi: https://developers.cloudflare.com/d1/observability/debug-d1/
dan https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/.
Pengujian meliputi dua jenis quota error/cause, pengecualian error lain, TTL/UTC
rollover/pemulihan/coalescing/cache failure, protocol bypass/CSRF/Pedia, link WA
aktif/escaping dan D1/Cache API workerd. Obscura memeriksa route preview nyata
dan middleware aktual yang dibundel dengan fixture DB kuota lokal di
320/390/1280px; fixture bukan secret/flag produksi.

Perbaikan publikasi 2026-10-17: tahap migrasi tetap berada sebelum Pages.
`scripts/ci-d1-migrations.cjs` mendapat bukti melalui GitHub CLI read-only:
rilis `ci.yml` terbaru yang sukses, event push/main, job verify-and-deploy sukses,
dan tahap migrasi serta deploy Pages sukses. Commit baseline wajib ancestor
HEAD; fingerprint git dari `drizzle/migrations`, `drizzle/schema.sql` dan
`wrangler.json` harus identik dan lengkap. Hanya kondisi tersebut menghindari
query D1 yang tidak diperlukan pada rilis kode saja. Jika bukti/API/history
tidak tersedia atau DB files berbeda, Wrangler `d1 migrations apply --remote`
tetap dijalankan dan exit gagal tetap menggagalkan deploy. Tidak ada
continue-on-error, penundaan migrasi baru atau deploy manual. Checkout history
penuh; permission Actions read dan GH_TOKEN dari token otomatis workflow
bukan Pages env/secret baru. `--check-only` menampilkan keputusan tanpa
menjalankan Wrangler. Bukti ini mengasumsikan database produksi tidak di-restore/
recreate di luar CI; setelah operasi tersebut pemeriksaan remote wajib dilakukan.
Push bukan bukti halaman maintenance sudah aktif.

Bukti insiden: run 38941622661 (830a573) gagal 17 Okt 00.44 WIB di query D1
[code 7500], deploy Pages/MCP skipped; pemeriksaan publik 17 Okt 05.49 WIB:
home 200, /maintenance 404, API katalog 500. Baseline run 38936424025 (ed2c41c)
migrasi+Pages sukses dan fingerprint DB identik; dry-run helper aktual memutuskan
tidak perlu remote query. Ini membuktikan penghalang rilis, bukan cache browser
atau hasil produksi patch terbaru.

### Notifikasi saldo Pedia tanpa spam saat D1 gagal — 2026-10-17

`lib/pedia/notify.ts` tidak lagi menganggap error baca sebagai state kosong atau
menelan error tulis lalu tetap mengirim. Alert admin nonkritis ditunda bila DB
tidak diberikan, baca gagal atau reservasi gagal (termasuk kuota/query budget).
State `amount|ms` memakai upsert compare-and-set terhadap value yang dibaca;
`changes === 1` wajib sebelum Telegram, sehingga dua tick yang membaca value
lama sama tidak sama-sama mengirim. Kunci per provider, parsing UTC legacy,
ambang env serta throttle enam jam/penurunan Rp5.000 dipertahankan. Migrasi
format legacy juga conditional dan tidak mengirim ulang. `true` hanya bila
respons Telegram ok; penolakan/timeout tetap menahan reservasi untuk menghindari
retry ambigu tiap tick. Ini dapat menunda alert sampai jadwal pengingat berikut,
bukan jaminan exactly-once atau mekanisme retry notifikasi pembeli.

`api/cron/lite` (sejak 13 November 2026) hanya memantau saldo IndoSMM; tidak
ada lagi cek/alert supplier lama. Bila baca/tulis checkpoint 30 menit gagal,
tidak ada panggilan proxy pada tick itu. Tidak ada tabel, env Pages, kontrak
proxy, jadwal cron, dispatch atau jalur uang baru. Tes menginjeksi error
read/write/budget, dua cron paralel, 12 tick lima-menit saat DB terblokir lalu
pulih, serta Telegram menolak.

Indeks `idx_orders_telegram_pending_chat` pada migrasi0075 mempersempit guard/precheck ke chat terkait. EXPLAIN fixture berubah dari pencarian seluruh status pending menjadi pencarian chat+status+payment_status; ini bukti plan lokal, bukan angka penghematan produksi.


### 16.12 Notifikasi grup WA dan admin Telegram — 24 Oktober 2026

✅ Diimplementasikan, publikasi lewat CI; koneksi/aktivasi mengikuti panel owner.
Source gateway kanonis `gateway/{src,scripts,package*.json,Procfile,tsconfig.json}`.
Baileys7.0.0-rc14/Node22, Heroku app existing `axvara-wa-gateway` akun#1 dan
Postgres existing. `.github/workflows/ci.yml` menguji/build gateway; sesudah migrasi
D1, `scripts/ci-whatsapp-gateway.cjs` mengunggah tar allowlist lewat Heroku API lalu
Pages/MCP. Tidak memakai remote Heroku atau session lokal. Build/release proof +
Git ancestor/diff memungkinkan skip bila source sama; rollback slug/API gagal
bukan bukti skip. Agent tetap berhenti setelah git push, tidak memantau rilis.
GitHub secret `HEROKU_API_KEY_AKUN1` dari `.heroku-credentials` ignored. Pages tiga
secret_text existing WHATSAPP_GATEWAY_URL (Heroku existing), WHATSAPP_WEBHOOK_TOKEN
(sama AXVARA_WEBHOOK_TOKEN Heroku), WHATSAPP_BOT_NUMBER=6283181632507; tidak menambah
env Pages. DATABASE_URL/URL/token/TARGET_GROUP_ID Heroku existing dipertahankan.
Nomor awal6283181632507 dipakai hanya untuk bootstrap kompatibel. Nomor sesi aktif
dibaca dari `axvara_wa_runtime`, bukan env WA_BOT_NUMBER/WHATSAPP_BOT_NUMBER lama.

- Auth/key Postgres berprefix nomor terpilih, ditangkap immutable per auth state;
  default6283181632507: tetap memakai kredensial existing, tidak menghapus key lama.
  `axvara_wa_control` menyimpan grup pin/pacing/pause/last send/ACK;
  `axvara_wa_delivery` menyimpan key/fingerprint/target/payload/status/messageid.
  Advisory lock runtime tunggal melarang socket ganda lintas nomor; lock default
  lama juga dipertahankan untuk rolling upgrade. Flush credentials serial,
  reconnect timer tunggal/backoff, metadata grup cache5menit + invalidasi event,
  getMessage dari payload durable. 401/403/440/500 berhenti, 515 restart normal;
  code401 sendiri bukan bukti ban. Tidak ada pairing code/QR dalam log.
- Admin-only GET/POST `/api/admin/whatsapp-notifications`: status, pair, enable,
  disable. Proxy gateway token-only `/notification-status`, `/notification-pair`,
  `/send-promo` (foto+caption katalog; revisi11November2026 lokal).
  `/send-notification` lama kini410 setelah pemeriksaan token, tidak mengirim
  transaksi. Pair eksplisit owner; grup pertama nama unik AXVARA'S
  setelah NFKC/trim/kapitalisasi/penyetaraan apostrof ’/‘/ʼ → ', lalu pinID PG.
  `gateway/src/group-target.ts` menolak nama ganda setelah normalisasi, substring
  dan nama lain; metadata pin memakai pencocokan sama, tidak rebind ID otomatis.
  `/notification-status` memberi groupName kanonis AXVARA'S dan groupSubject asli
  hanya setelah identitas/izin grup lolos; Pages tetap memvalidasi groupName kanonis.
  Aktif hanya connected + nomor cocok + grup tepat +
  tidak blocked. Semua grup memvalidasi keanggotaan nomor aktif melalui PN/LID;
  grup announcement juga mewajibkan bot admin. Owner harus memenuhi izin grup.
- Internal store_settings.whatsapp_sales_notifications menyimpan
  enabled/enabledAt/groupId/botNumber/botRevision; tidak dibocorkan settings publik.
  Legacy tanpa identitas dibaca sebagai nomor awal/revisi initial. Disabled boleh
  groupId null sebelum grup terverifikasi. Nama key dan enabledAt tetap untuk
  kompatibilitas; saklar sekarang mengontrol katalog, bukan transaksi. Klik aktif
  berulang tidak mereset enabledAt. Katalog hanya dicoba dalam jendela slot dan
  snapshot nomor/revisi; tidak menyalakan flag commerce/DM legacy.
- **Ganti nomor bot24Oktober:** admin POST action:number menerima newBotNumber dan
  identitas nomor/revisi yang sedang ditinjau. Normalisasi08→62, +/spasi/()- dibuang,
  10–15digit internasional; invalid400, tab basi409. D1 config dinonaktifkan memakai
  CAS value sebelum token-only gateway POST `/notification-number`; timeout/gagal
  tetap dijeda. Gateway menjadi otoritas pilihan nomor. GET memuat nomor aktual;
  tidak perlu env Pages/Heroku baru atau migrasi D1.
  `axvara_wa_runtime` PG singleton id1 menyimpan phone/revision/group_id/updated_at;
  dibuat idempotent saat startup, group pin diambil dari control nomor awal sekali.
  Pin grup global bertahan lintas nomor. Pergantian PG `FOR UPDATE` memeriksa
  expected phone/revision, menyalin max pacing/cooldown lama dan baru, mengganti
  phone/revisi UUID atomik; auth/outbox/delivery tidak dihapus. Nomor sama no-op.
  Satu mutex mencakup status/pair/ganti nomor/send termasuk outbound legacy;
  pergantian menunggu send, membatalkan reconnect, menutup listener/socket lama,
  menunggu flush credential lalu memuat prefix terpilih. Event/cache/inbound lama
  dijaga identitas socket; hasil send terlambat tetap mencatat nomor asal.
  Gagal/commit ambigu menghentikan socket dan membaca ulang identitas PG; Cek
  koneksi lalu Hubungkan memulihkan sesi tersimpan tanpa menghapus riwayat.
  Pair dan pengiriman grup mengikat botNumber/botRevision. Default request lama hanya
  diterima selama nomor/revisi bootstrap belum berubah. A→B→A tidak menghidupkan
  permintaan lama. Aktivasi admin CAS menyimpan identitas gateway; outbox membawa
  identitas aktivasi itu, mismatch ditunda tanpa menghabiskan attempt. Katalog
  pending hanya dilanjutkan bila snapshot sesuai dan belum kedaluwarsa;
  sent/unknown tidak replay.
  UI dinamis, form inline, membersihkan kode pairing saat identitas berubah;
  status aktif hanya bila config sesuai gateway. Rollback sesudah pergantian wajib
  ke rilis kompatibel runtime/revisi, bukan kode nomor tetap sebelum fitur ini.
- Revisi11November2026 (lokal, deployment belum diverifikasi): producer
  `enqueueCompletedSales`/formatter transaksi dihapus. Recovery outbox existing
  menandai pending/failed `sale_completed` dead/sales_notifications_retired;
  lease aktif/sent/dead tetap, sending basi menjadi dead. Processor juga menolak
  kirim transaksi lama, termasuk bila recovery gagal. Tidak menghapus ledger.
- `src/lib/whatsapp/promo-digest.ts` pada `notify_b` existing memakai maksimal4
  statement enqueue: konfigurasi, cek key murah, kandidat katalog, INSERT OR IGNORE.
  `loadPromoProducts` dibagi dengan Telegram: semua produk aktif/telegram_enabled,
  varian aktif yang stoknya memenuhi min_qty atau unlimited, harga minimum yang
  purchasable, pecundang pasangan supplier tidak ikut, urutan sort_order/id.
  Minimal3produk seperti Telegram; flag/token Telegram tidak menjadi gate WA.
  Key unik D1/PG `wa:promo:YYYY-MM-DD:morning|evening`, message_type promo_digest,
  snapshot immutable caption+botNumber+botRevision+expiresAt. Slot WIB09.00/17.00,
  retry dalam jendela Telegram sampai12.00/20.00; lewat jendela dead/promo_expired.
  Nonaktif/grup/identitas berbeda menunda tanpa memakan attempt, bukan memindahkan
  katalog lama ke sesi baru. Hasil ambigu tetap dead/manual, key tidak dibuat ulang.
  Tidak ada env, trigger, migrasi atau budget baru.
- `/send-promo` memakai mutex/validasi grup dan identitas serta ledger/pacing PG
  existing. Key harus slot WIB saat ini. Media berasal hanya dari URL tetap
  `https://axvara.tech/banners/ready-promo.webp` (lampiran owner1536x1024, WebP210332B),
  fetch timeout8detik/tanpa redirect, image/webp/nonkosong/maks5MB. Kegagalan gambar
  terjadi sebelum claim, sehingga retry aman tanpa mengirim teks tanpa foto.
  Satu Baileys sendMessage(image,caption); fingerprint mengikat target+konten.
  settleDelivery menyimpan proto pesan gambar pada payload PG untuk getMessage
  (retry dekripsi), tanpa mengubah fingerprint atau mengirim ulang slot.
- D1 CAS/lease + durable claim PG sebelum send; key/target/payload harus cocok.
  Sent replay mengembalikan messageid, unknown/sending tidak send ulang. Satu
  percobaan baru/60detik adalah batas beban, bukan angka aman resmi. Offline/
  paced/cooldown menunda tanpa menghabiskan attempt. Timeout HTTP retry key sama
  untuk membaca hasil; interrupted sending PG menjadi unknown. Explicit unknown
  D1 menjadi dead/manual_check_required. Hasil ambigu menjeda15menit; sinyal
  pembatasan24jam + tutup socket. ACK bukan bukti semua penerima membaca.
  Legacy send/image hanya grup existing/pin; DM ditolak gateway. /wr/* tetap410.
- Notifikasi pembayaran admin Telegram Web/TG/WA memuat pembayaran LUNAS,
  status pesanan, paid_at WIB; order-created memakai created_at WIB (kosong tidak dipalsukan). Klasifikasi mendahulukan
  immutable order_item_costs.source lalu mapping/link/status. Placeholder supplier
  manual_required tetap otomatis; gagal supplier perlu pemeriksaan, bukan kirim
  manual. Semua unit delivered selesai; missing unit tidak dianggap selesai.
- Tombol Lihat pesanan pembeli URL /lacak-pesanan?code=<code>&admin=1 tidak memuat
  kontak/token. POST lookup dan POST credentials adminView=true memakai
  requireAdmin sebelum DB read, private/no-store, tanpa capability buyer.
  UI admin tidak membaca/menulis riwayat kontak/capability dan membersihkan detail
  saat auth ditolak; buyer biasa tetap harus verifikasi kontak/token existing.
- Satu field admin whatsappGroupUrl → store_settings.whatsapp_group_url melalui
  PUT /api/store-settings authenticated. Regex HTTPS chat.whatsapp.com kode20–32
  alnum, optional ?mode=gi_t; unknown scheme/host/userinfo ditolak. GET hanya
  whitelist settings/no-store. Footer Market/Pedia dan LinkBio useStoreSettings:
  cache30detik + in-flight dedupe/revision guard, publish saat save, tab lain
  storage/focus/visibility, tanpa polling server. WA_GROUP_HREF hanya fallback;
  mengubah undangan publik tidak mengganti grup ID notifikasi.

Aktivasi: Admin/Pengaturan Toko → Hubungkan nomor bot → tautkan dari WA nomor
6283181632507 → bot anggota/admin pengirim grup AXVARA'S → Cek koneksi → Aktifkan.
Belum ada pesan produksi saat QA, gateway lama disconnected401. Recovery unknown
wajib periksa pesan grup + PG/D1 dahulu, jangan reset row/ID untuk resend. Rollback
melalui CI, pertahankan state/key PG dan D1; jangan kembali membuka DM. Rujukan
library/WhatsApp dan bukti QA: issue/whatsapp-sales-notifications-2026-10-24.md.


### 16.13 Siaran admin dan welcome anggota — 24 Oktober 2026

- `src/lib/broadcasts/{model,validation,store,sender,worker}.ts` memisahkan validasi,
  snapshot atomik dan pengiriman. API requireAdmin; D1 wajib, error ambigu503 tetap
  menyisakan ID client. UUID kampanye + fingerprint mengikat template/revisi/kanal
  dan identitas WA yang ditinjau. D1 batch insert campaign preparing, INSERT SELECT
  penerima aktif, lalu queued bersifat atomik; replay ID yang sama tidak menambah
  penerima atau mengirim ulang. Template revision CAS, arsip mempertahankan riwayat.
- Tabel0077: broadcast_templates, broadcast_campaigns, broadcast_deliveries,
  broadcast_dispatch_control. Delivery unik campaign/channel/recipient; snapshot
  pesan dan token email tidak berubah karena edit template. Kampanye queued bisa
  dihentikan, hanya pending dibatalkan. Riwayat30 terakhir + agregat sekali, library200.
- Existing lite promo menjalankan worker maks8 penerima,20detik, budget40statement
  dan sisa envelope40detik job. Lease singleton60detik; CAS delivery lease90detik.
  Per-request timeout6detik email,10detik TG,15detik gateway. Email pacing650ms,
  TG150ms dan Retry-After durable; throttle satu kanal tidak menutup kanal lain.
  Jeda ini batas operasional, bukan jaminan kuota/inbox/no-ban. Tidak ada paid TG
  broadcast atau loop poll baru. Sesudah claim, unsubscribe/opt-out diperiksa di SQL.
- Email individual memakai RESEND_API_KEY/FORWARD_FROM_EMAIL existing; HTML escaped,
  text dan List-Unsubscribe/One-Click. Key `broadcast/<campaign>/<subscriber-id>`
  stabil, retry jaringan/5xx maksimal23jam dari attempt pertama (margin atas cache
  idempotensi24jam). Lewat jendela atau crash ambigu lama → unknown/manual.
  Penggantian sender di env saat retry bisa ditolak provider; jangan ganti payload
  demi melewati konflik key. 429 mengikuti Retry-After tanpa menghabiskan attempt.
- Newsletter random token32byte/64hex, backfill0077, tidak dibuka admin GET/list.
  `/api/subscribers/unsubscribe?token=...`: GET form konfirmasi inert, POST update
  statusunsubscribed, private no-store/no-referrer/CSP. Resubscribe merotasi token;
  antrean token lama dilewati. Telegram user_id positif/kanonik dan chat_id=user_id,
  is_blocked0/broadcast_opt_out0;403 skip+blocked,429 defer, ambiguity unknown.
  Private incoming dapat clear blocked; `/stop`/`/siaran_on` tidak menghapus pending
  action atau menonaktifkan kabar pesanan. Group ID tidak dijadikan tujuan pribadi.
- Gateway `/send-broadcast` key `wa:broadcast:<UUIDv4>`, `/send-welcome` key
  `wa:welcome:<sha256>`; revisi11November2026 `/send-promo` key tanggal/slot,
  `/send-notification` invoice lama dipensiunkan410. Semua route token-only,
  session mutex, nomor/revisi aktif, grup pin/izin terverifikasi, deliveryClaim PG,
  shared pacing60detik/cooldown/unknown. Key lintas namespace ditolak. Siaran lama
  sesudah ganti bot dipertahankan untuk owner Hentikan+Tinjau baru; tidak pindah
  otomatis. Sambutan basi identitas menjadi dead; sent/unknown tidak diulang.
- `group-participants.update` add menginvalidasi cache dan memverifikasi grup,
  menyingkirkan bot sendiri PN/LID, meneruskan maksimal100 kontak batch ke Pages
  `/api/whatsapp/group-events` (header token existing). Tidak menahan session mutex
  selama HTTP, karena Pages memanggil status. Pages memverifikasi ulang group/phone/
  revision, menulis outbox group_welcome dengan SHA256(group,phone,revision,hariUTC,
  sorted unique memberIDs). Pesan+identitas dibekukan JSON, ID anggota tidak disimpan
  dalam payload. Event duplikat batch/hari sama dedupe; join ulang hari sama/batch
  sama tidak disambut lagi. Belum ada backfill event saat socket offline atau
  ingress gagal sebelum D1 menyimpan; pengiriman sesudah enqueue memakai retry
  outbox existing dan ledger PG. Satu sambutan per batch, nama max3 dan sanitasi
  formatting/control; fallback Kak, tidak menjadikan nomor sebagai nama.
- Webhook chat lama menghapus welcome berdasar sesi, pencarian hanya `cari <produk>`;
  chat, emote, reaction/stiker biasa tidak menimbulkan balasan. Perintah/admin/proof
  lama tetap mengikuti gate existing; flags commerce tidak diaktifkan. Sambutan
  baru independen flag commerce dan mengikuti koneksi/keanggotaan grup.
- Rollout hanya CI main: migrasi0077 lalu gateway dan Pages; tidak mengirim siaran
  uji produksi atau mengubah sesi/koneksi saat QA. Rollback wajib kompatibel runtime
  nomor/revisi serta ledger; pertahankan tabel/snapshot/token/outbox.

### 16.14 Digiflazz buyer - preflight lokal, 2 November 2026

`scripts/digiflazz-preflight.mjs` adalah alat Node stdlib, bukan runtime Pages.
`--init` membuat JSON `.digiflazz-credentials` privat600/git-ignored (exclusive
create; username/key kosong + webhook secret acak32byte). `--check` memakai
Development Key; Production Key hanya dengan `--check --production`. Signature
MD5 dibuat lokal, hanya username/signature terbatas dikirim lewat stdin SSH ke
`ec2-user@13.228.147.90`, key existing `~/.ssh/axvara-sg-proxy.pem`; key supplier
tidak dikirim/disimpan di VPS atau argv. Tidak ada env Pages baru.

Node remote sementara hanya POST `/v1/cek-saldo` dan `/v1/price-list` pada host
HTTPS Digiflazz tetap, tanpa redirect/retry/write transaksi. Timeout15detik dan
respons1MiB per request, SSH40detik. Laporan saldo + seluruh SKU kategori Games
(tanpa batas50, mencakup seller/deskripsi) tidak menulis D1, tidak menghitung
availability/region atau mengimpor katalog. Error HTTP hanya mengekspos status
dan endpoint allowlist, tanpa body upstream.
Snapshot SSH2November: Node20.20.2, service active, health200/staticProxyfalse,
egress langsung13.228.147.90. Cek API Development berikutnya lulus: saldo0,
73 produk akun, 9 Games dari2brand; Production HTTP400 pada `cek-saldo`. Snapshot publik
4.380 produk/150brand disimpan lokal git-ignored `.digiflazz-catalog*`, bukan impor
runtime/konfigurasi seller. Pemilihan seller menunggu sesi dashboard terautentikasi.

Tidak mengubah proxy WR/SK, service VPS, schema/order/checkout, cron, route webhook
atau produk publik. Webhook jangan diaktifkan sebelum penerima dengan verifikasi
HMAC-SHA1 body mentah + korelasi transaksi durable tersedia. Test fixture mencakup
signature, mode, privasi file/secret, allowlist, HTTP/error/ukuran respons dan
program remote offline; bukan transaksi supplier development/live. Runbook dan
gerbang integrasi berikutnya: `docs/agent-rules/digiflazz.md`.

### Payout — persiapan kontrak lokal, 4 November 2026

Invoice/reconcile yang diuji lokal bukan withdrawal dan bukan bukti payout live; tidak ada implementasi inisiasi atau scheduling payout dalam paket ini. Payout dapat ditunda terpisah dari rollout pembayaran, tetapi aktivasinya wajib menunggu konfigurasi owner dan konfirmasi provider.

Menurut [withdrawal Sekalipay](https://merchant.sekalipay.com/id/dokumentasi/withdrawal) (snapshot publik 3 November), nominal net Rp10.000–Rp10.000.000 menuju bank/DANA yang diverifikasi di dashboard, bukan tujuan yang ditentukan API; biaya withdrawal di atas net, terpisah dari fee invoice pembeli. Tidak ada idempotency withdrawal yang didokumentasikan: timeout/5xx tidak boleh di-retry otomatis. Klaim durable satu inisiasi hanyalah desain masa depan, belum diimplementasikan; hasil ambigu diperiksa manual lewat riwayat dan saldo. `approved`/`queued` bukan selesai, dan `manual_payout_pending` dapat memerlukan tindakan provider. Status akun dan limit aktual belum diverifikasi.

NOWPayments API key pembayaran bukan JWT atau sesi 2FA dashboard; jangan menyimpan JWT/TOTP atau melewati 2FA. Aset, jaringan, alamat, whitelist, minimum, custody dan outcome/routing harus dikonfirmasi owner/provider; penerimaan Bitget belum terbukti. Outcome/net bukan harga/fee pembeli. Tidak ada pilihan jaringan, alamat, threshold atau cadence yang ditebak; threshold/cadence hanya keputusan owner bila payout terjadwal kelak diinginkan.

### 16.15 NOWPayments — snapshot persiapan lokal, 3 November 2026

Sumber kredensial tunggal `.nowpayments-credentials`, format shell `KEY=value`,
chmod600 dan di-ignore melalui `.nowpayments-credentials*`. Field lokal:
`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` dan
`NOWPAYMENTS_API_BASE_URL=https://api.nowpayments.io/v1`. API key dan IPN secret
final berasal dari salinan owner; key hasil OCR awal ditolak dan sudah diganti.
Tidak ada nilai secret dalam dokumentasi, Git, log atau bundle publik.

Pemeriksaan sementara memakai Python stdlib melalui HTTPS langsung ke host API
resmi, GET saja, tanpa mengikuti redirect atau mencetak header/body sensitif.
`GET /status` dan `/currencies` HTTP200; `GET /merchant/coins` dengan API key final
HTTP200 (`selectedCurrencies`:357entri). Ini membuktikan akses API saja, bukan
keberhasilan pembayaran, IPN, settlement atau withdrawal. Tidak ada skrip runtime
baru, env Pages, route, cron, migrasi, invoice/order atau perubahan dashboard.

IPN URL belum tersedia dan dibiarkan kosong. Implementasi berikutnya memerlukan
keputusan aset/jaringan, custody/payout dan wallet owner, adapter invoice terikat
order serta receiver terverifikasi/idempoten dengan rekonsiliasi API. Dokumentasi
dan fixture kontrak harus selesai sebelum rollout CI. Jangan menerbitkan URL
callback atau mengisi secret Pages seolah receiver sudah tersedia. Runbook dan
sumber resmi: `docs/agent-rules/payments.md`.

### 16.17 Snapshot historis W1 NOWPayments + shell gateway — 3 November 2026

**S3d1 lokal supersedes preflight W1:** `NOWPAYMENTS_OUTCOME_CURRENCY` wajib berupa kode outcome yang diverifikasi operator sebelum aktivasi; belum ada perubahan env produksi. Flag create buyer-fee/fixed-rate dan persetujuan buyer masih paket berikutnya.

Implementasi LOCAL/fixture, flag default OFF, tanpa rollout: `drizzle/migrations/0094_nowpayments_rails.sql`
+ mirror `drizzle/schema.sql` (kolom nullable `currency/pay_currency/pay_network/price_amount_text/pay_amount_text/
actually_paid_text/outcome_* /fee_paid_by_user/provider_payment_id/pay_address/last_reconciled_at` + unique index
`payment_transactions_provider_payment`); `src/lib/payments/{decimal,rails,nowpayments,sekalipay-gateway}.ts`;
route `src/app/api/payments/nowpayments/ipn/route.ts`; generalisasi `transitionPendingPaymentToPaid`
(`paymentMethod`, event mode `received_text` untuk crypto, satu batch paid+outbox dipertahankan).
Semantik: klaim initializing → satu POST → GET recovery by payment id; preflight dinamis; fail-closed tanpa
tebakan FX; IPN HMAC-SHA512 canonical + dedupe + waitUntil reconcile + cron-recoverable; finished + gross cukup
→ paid sekali; partial/under/late/unknown → manual review. Gateway Sekalipay selalu `not_configured`.
QRIS tidak berubah; TTL 15 menit; checkout/TG/cron/admin UI milik W3. Blokir manual (gateway docs, Bitget,
payout 2FA/IP) di runbook pembayaran.

### 16.16 Sekalipay payment gateway — snapshot penyimpanan saja, 3 November 2026

API key dan secret key owner hanya disimpan lokal di
`.sekalipay-gateway-credentials` (format shell, chmod600, git-ignored
`.sekalipay-gateway-credentials*`). Field lokal `SEKALIPAY_GATEWAY_API_KEY` dan
`SEKALIPAY_GATEWAY_SECRET_KEY` sengaja terpisah dari env/kredensial Sekalipay
supplier existing. Tidak ada key gateway dikirim ke proxy supplier atau Pages.
Tidak ada request API, tes kredensial, perubahan dashboard, runtime, bot, env,
route, schema atau metode pembayaran. NOWPayments crypto + Sekalipay gateway
non-QRIS di web/bot Telegram masih rencana owner; instruksi saat ini hanya simpan,
bukan memulai integrasi. Detail: `docs/agent-rules/payments.md`.

### 16.18 FX USD/IDR otomatis + snapshot koin crypto — 5 November 2026 (LOKAL, belum deploy)

- **Tabel** `crypto_market_snapshot` (migrasi `0101`, satu baris `id=1`). Tidak ada rahasia. Lease (`lease_until`) + `last_attempt_at` membuat refresh paralel antar-isolate hanya dikerjakan satu pemenang; penulisan akhir CAS pada lease milik sendiri.
- **Katalog koin kurasi** `src/lib/payments/crypto-assets.ts`: 28 koin (6 populer + 22 stable) dengan `ticker`, `symbol`, `name`, `network`, `networkLabel`, `group`, `order`, `logo` (`/payments/coins/<ticker>.svg`, berkas SVG menyusul tugas UI). Dikecualikan: `btclightning`, `usddtrc20`, `tusdtrc20`, dan aset yang butuh memo/extra id. Koin di luar peta ini tidak pernah ditawarkan.
- **Refresh** (`market-snapshot-refresh.ts`): hanya butuh `NOWPAYMENTS_API_KEY` (tidak bergantung `NOWPAYMENTS_ENABLED`; tanpa key = no-op). Kurs = dua GET `/estimate` ke `usdtbsc` (1.000.000 IDR dan 100 USD) → `IDR/USD = 10000 × est_usd / est_idr` dengan bigint, dibulatkan half-up 2 desimal, `fx_source="nowpayments-estimate"`. Ditolak bila di luar 5000–50000 atau berubah >10% dari kurs tersimpan ≤24 jam (nilai lama dipertahankan + `last_error`). Koin = `/merchant/coins` ∩ kurasi → `/min-amount?currency_from=<t>&currency_to=<outcome>&fiat_equivalent=usd` (bentuk floating/merchant-fee, tanpa `is_fixed_rate`/`is_fee_paid_by_user`), concurrency ≤6, timeout 8 dtk/request, total 30 dtk; `currency_to` = `NOWPAYMENTS_OUTCOME_CURRENCY` valid, fallback `usdtbsc`. Koin yang min-nya gagal dihilangkan; bila `/merchant/coins` gagal, semua min gagal, atau deadline total lewat, daftar sebelumnya dipertahankan. Biaya 3–4 statement D1 (baca, lease, tulis).
- **Cron**: dipanggil di akhir `runCleanup` pada `POST /api/cron/lite?job=cleanup` (tick 5 menit existing). Dipilih karena job ini ringan, berjalan di request sendiri sehingga jaringan refresh tidak menyentuh payments/expiry/fulfillment, dan tidak menambah trigger. Semua error/timeout/budget habis ditelan di hook (hasil cleanup tetap dikembalikan; kunci tambahan `crypto_market` hanya muncul bila ada pekerjaan).
- **Pembaca** `src/lib/payments/market-snapshot.ts`: `getCryptoMarketSnapshot(db)` dan `loadCurrentFxSnapshot()` dengan memo per-isolate 60 dtk. Urutan kurs: D1 segar (≤24 jam, `USD_FX_MAX_AGE_MS`) → pasangan env darurat `USD_IDR_RATE`/`USD_FX_EFFECTIVE_AT` (`source="operator-fixed"`, override manual) → null (fail closed: IDR saja, crypto tersembunyi). Koin lebih tua dari 2 jam dikembalikan KOSONG dengan `coinsStale:true`. `loadFxSnapshot()` di `fx.ts` kini hanya pembaca env darurat; `buildCryptoOffer`/`buildCryptoCatalog` (lihat §16.19) dan `displayUsdCents(idr, fx)` menerima kurs eksplisit; konsumen: `/api/display-prices`, `/api/checkout/quote`, `/api/orders`, `buildMethodOptions/Catalog` (web + Telegram freeze), `tgCtxFor`.
- **Cek kurs saat create** (`isFxSnapshotAcceptable`, `crypto-preflight.ts`): token quote valid diterima bila snapshot saat ini ada, `effective_at` bertanda ≤24 jam, dan selisih relatif ≤2% terhadap kurs bertanda; selain itu `409 quote_stale` (tanpa snapshot saat ini tetap 503). Harga USD yang ditagih tetap angka bertanda. Validator token (`src/lib/auth.ts`) menerima `source` `operator-fixed` dan `nowpayments-estimate`. Jalur create Telegram tidak membandingkan kurs saat ini sama sekali (snapshot beku di payq1 + TTL 10 menit adalah otoritas); perilaku itu dipertahankan dan tidak diubah.
- **Env**: tidak ada env baru. `USD_IDR_RATE`/`USD_FX_EFFECTIVE_AT` menjadi cadangan darurat. Migrasi 0101 harus diterapkan CI sebelum fitur dipakai; sebelum itu pembaca gagal-baca → env darurat.

### 16.19 Crypto multi-koin, kurs mengambang, biaya layanan 1,5% — 5 November 2026 (LOKAL, belum deploy; angka 1,5%/lantai US$2 DIGANTI 7 November 2026 — lihat §16.23 dan §16.24)

Menggantikan kontrak satu-koin USDT-BSC di §16.17/§16.18 (catatan "buyer-fee/fixed-rate" dan `NOWPAYMENTS_PAY_CURRENCY` kini histori).

- **Modul harga** `src/lib/payments/crypto-pricing.ts` (murni, BigInt; revisi 7 November 2026 = per koin, lihat §16.24): `CRYPTO_SURCHARGE_BPS=100` (proporsional 1%; snapshot 5 Nov: 150, 7 Nov pagi: 200), `CRYPTO_FIXED_FEE_CENTS={usdtbsc:8,bnbbsc:8,eth:17}` + `CRYPTO_DEFAULT_FIXED_FEE_CENTS=20`, `cryptoFixedFeeCents(ticker)` (case-insensitive, tak dikenal → 20), `CRYPTO_MIN_TOTAL_USD_CENTS` **dihapus 7 Nov 2026**, buffer minimum ×115/100. `cryptoPricing(base, ticker, bps?)` → `{baseCents, fixedCents, surchargeCents, totalCents, surchargeBps}` dengan `total=ceil((base+fixed)*10000/(10000-bps))`; `cryptoRequiredTotalCents(minUsdText)=ceil(min×1,15) ke sen` (tanpa lantai); `minIdrSubtotalForTotal(required, ticker, fx)` (subtotal IDR terkecil yang lolos, hanya tampilan "Min."); `centsToUsdText`. `cryptoSurchargeCents`/`bpsPercentText` dihapus 7 Nov 2026. Lihat §16.23/§16.24.
- **Penawaran** `crypto-preflight.ts`: `buildCryptoCatalog(idrSubtotal, fx, coins)` → satu entri per koin snapshot, urut katalog kurasi (populer `order` 1–6, lalu stablecoin 101+). Tersedia: `{id:"nowpayments:<ticker>", kind:"crypto", label:<simbol>, sublabel:<label jaringan>, group, logo, currency:"USD", amount_text:<TOTAL>, pay_currency, network, base_cents, surcharge_cents, total_cents, surcharge_bps:100 (per koin, §16.24), fee_payer:"merchant", fixed_rate:false, sender_gas_extra:true, usd:{cents:<base>, rate_*, source, effective_at, idr_subtotal, pay_currency, network}}`. Nonaktif: `{available:false, unavailable_reason:"below_min", min_total_cents, min_total_text, min_idr_subtotal}` tanpa `amount_text`/`usd`. `isCryptoTotalStillPayable(total, ticker, coins)` = cek ulang minimum×1,15 terhadap snapshot SAAT INI (create web + validasi Telegram; lantai US$2 dihapus 7 Nov 2026, lihat §16.23). `cryptoRailEnabled()` = hanya `NOWPAYMENTS_OUTCOME_CURRENCY` valid (menggantikan `cryptoAssetEnabled`/`NOWPAYMENTS_PAY_CURRENCY`). `USD_CRYPTO_*` di `fx.ts` dihapus.
- **Katalog quote** `method-options.ts`: `buildMethodCatalog` = QRIS → gateway → crypto (semua koin snapshot termasuk nonaktif; tanpa panggilan provider — hanya `getCryptoMarketSnapshot()`); butuh `isNowpaymentsConfigured()` + kurs; kosong/basi/tanpa kurs → tanpa crypto. `buildMethodOptions` (Telegram + token) hanya yang tersedia.
- **Token quote** (`src/lib/auth.ts`): metode crypto membawa `id`, `kind`, `currency:"USD"`, `amount_text`(total), `pay_currency`, `network`, `fee_payer:"merchant"`, `fixed_rate:false`, `base_cents`, `surcharge_cents`, `total_cents`, `surcharge_bps`, `sender_gas_extra`, `usd`. Validator tunggal `isValidCryptoMethod` (dipakai token DAN payq1): ticker kurasi persis, `pay_currency`=ticker, jaringan = jaringan kurasi (metode & `usd`), base = `idrToUsdCents(subtotal, kurs bertanda)`, biaya = rumus per koin `cryptoPricing(base, ticker)`, total > 0 (lantai US$2 dihapus 7 Nov 2026), `amount_text` = total 2dp, bps = `CRYPTO_SURCHARGE_BPS` (§16.24). Metode non-crypto tidak boleh membawa field crypto. HMAC/claim/kedaluwarsa tidak berubah.
- **Token quote ringkas** (6 November 2026, lokal; bentuk blok diperbarui 7 November 2026 untuk biaya per koin): JWT TIDAK lagi memuat satu metode penuh per koin (28 koin ≈ 23.000 karakter > batas `quote_token` 8000 di `/api/orders`). `createCheckoutQuoteToken` memvalidasi input penuh dengan `quoteSchema`, memastikan semua metode kripto kontigu dan identik pada field bersama (usd/base/kebijakan) — TOTAL boleh berbeda per koin karena biaya tetap beda ticker — lalu menandatangani satu blok `crypto {items:[{ticker,total_cents}], at, usd, base_cents, surcharge_bps, ...}`; `verifyCheckoutQuoteToken` memvalidasi blok dengan skema strict (1..64 item unik kurasi), menurunkan `surcharge_cents = total - base_cents` dan `amount_text`, mengembangkannya ke metode penuh pada indeks `at`, lalu menjalankan `quoteSchema` yang sama (bentuk `CheckoutQuotePayload` tidak berubah; token bentuk penuh lama tetap lolos; kedua bentuk sekaligus ditolak). Batas 8000 dan body limit tidak diubah; payq1 Telegram terpisah.
- **Create web** (`src/app/api/orders/route.ts`): `nowpayments:<ticker>` (id non-kurasi → 409 `quote_stale`); semua cek token di atas, lalu (order BARU saja, bukan retry `quote_id` yang sama) koin harus ada di snapshot segar & `isCryptoTotalStillPayable` & kurs ≤2% (`isFxSnapshotAcceptable`) → selain itu 409 `quote_stale`; tanpa kurs/konfigurasi → 503.
- **Adapter** `nowpayments.ts` `createNowpaymentsInvoice`: opsi `feePayer:"merchant"`, `fixedRate:false` wajib untuk mode USD; `expectedUsd` = `{cents(base), priceText(TOTAL), surchargeBps, surchargeCents, totalCents, rate_*, idrSubtotal, payCurrency, network}` diverifikasi ulang (kurasi, jaringan, rumus ceil; cek lantai `nowpayments_below_floor` DIHAPUS 7 Nov 2026, lihat §16.23). Klaim `initializing` menulis `fee_paid_by_user=0`, `fixed_rate=0`, `crypto_base_usd_cents/crypto_surcharge_usd_cents/crypto_surcharge_bps` SEBELUM tepat satu POST `{price_amount:<total>, price_currency:"usd", pay_currency:<ticker>, is_fixed_rate:false, is_fee_paid_by_user:false}`. Preflight `checkNowpaymentsMinimum`: `/min-amount` bentuk mengambang (`...&fiat_equivalent=usd`, tanpa flag) — total < `fiat_equivalent` provider → tolak tanpa POST. Validasi respons: `pay_currency`=ticker, `price_amount/currency`, `pay_amount>0`; fixed/fee-by-user = true → `nowpayments_policy_unverified` (review manual); `valid_until` tidak wajib; `payin_extra_id` tidak kosong → tx `failed` + `nowpayments_extra_id_unsupported`, tanpa alamat tersimpan, error dilempar apa adanya (web: order dibatalkan + 503 generik; Telegram: order dibatalkan + notice `method_unavailable`). Baris tersimpan menolak koin/jaringan lain pada retry (`nowpayments_invoice_mismatch`).
- **Rekonsiliasi**: baris 0/0 — provider melaporkan `is_fixed_rate`/`is_fee_paid_by_user` = true → `nowpayments_policy_manual_review` (sticky); deadline `valid_until` TIDAK diperiksa (hanya baris 1/1 lama), batas tetap `min(tx.expires_at, order.expires_at)` + late→manual review; gross `actually_paid` ≥ `pay_amount` tetap syarat paid; paid tidak pernah turun. Baris 1/1 lama tetap memakai cek lamanya (flag + deadline).
- **Skema**: migrasi `0102_crypto_surcharge.sql` + mirror `drizzle/schema.sql` — `payment_transactions.crypto_base_usd_cents`, `crypto_surcharge_usd_cents`, `crypto_surcharge_bps` (INTEGER nullable; total = `price_amount_text`). CI harus menerapkan 0102 sebelum rilis (view crypto membaca kolom ini).
- **View pembeli** (`payment-view.ts`): label/simbol/`network_label`/`logo` dari katalog kurasi (fallback aman untuk ticker tak dikenal), `amount_text`=total, `base_amount_text`, `surcharge_amount_text`, `surcharge_bps`, `fee_payer` (`merchant` baris 0/0, `buyer` baris 1/1 lama), `fixed_rate`; `fee_unknown` dihapus. Web (`GatewayPaymentPanel`, `lacak-pesanan`) menampilkan rincian subtotal + biaya layanan + total dan instruksi "kirim tepat `<jumlah> <SIMBOL>` lewat jaringan `<label>` saja"; `method-logos.ts` memetakan logo koin dari katalog (`/payments/coins/<ticker>.svg`).
- **Picker web** (`PaymentMethodPicker.tsx`, `payment-ui.ts`): menerima banyak opsi crypto; koin nonaktif tampil dengan "Min. US$…" + alasan, radio `disabled` (tak dapat dipilih klik/keyboard); CTA/total mengikuti `amount_text` koin terpilih; ringkasan menampilkan baris biaya layanan. Dipoles 6 November 2026 (presentasi saja, tanpa perubahan kontrak quote/create): header total USD + chip logo bulat, subgrup Populer/Stablecoin, SATU baris per simbol (`SingleRow` radio langsung; `ExpandRow` + `NetworkChip` radiogroup untuk simbol multi-jaringan tanpa bawaan). Revisi terbaru menghapus pencarian/filter beserta state/helper/copy terkait dari seluruh grup pembayaran; semua simbol dan jaringan tetap tersedia. Panel pesanan crypto (`GatewayPaymentPanel.tsx`) memakai logo koin, baris "Jaringan" berlabel, QR alamat lokal (`qrcode` dimuat dinamis, hanya tahap pending) dan satu baris peringatan; spesifikasi visual di `docs/DESIGN.md`.
- **Telegram**: `paymentMethodOfferKeyboard` menampilkan satu entri `Crypto (USD) · <total> USD` (`pmc:<nonce>`); `cryptoCoinKeyboard` (Populer → Stablecoin, 2/baris, label `BTC` / `USDT · BSC`, Kembali `pmb:<nonce>`); tap koin = `pm:<nonce>:<index>` (reuse freeze/consent/claim). Handler `handlePayCryptoMenu` (callback.ts `pmc`/`pmb`, ownerBound) hanya merender ulang dari array beku. `validateFrozenSelectionLive` menolak koin yang hilang dari snapshot / di bawah minimum baru (`method_unavailable`); dispatch memakai ticker/jaringan dari id beku → katalog kurasi. `PAYQ1_MAX_BYTES` 64 KB, `PAYQ1_MAX_METHODS` 96 (indeks `pm:` tetap 2 digit). Pesan status pending memuat jumlah+simbol+jaringan+peringatan+baris biaya layanan.
- **Env**: `NOWPAYMENTS_PAY_CURRENCY` dihapus (jangan diset di Pages); `NOWPAYMENTS_OUTCOME_CURRENCY` tetap wajib. Tidak ada env/cron baru. Daftar koin yang boleh dibeli = toggle dashboard NOWPayments ∩ katalog kurasi.
- **Bukti**: tes fixture lokal (Vitest + Miniflare/workerd; fetch di-mock, tanpa jaringan nyata): `tests/crypto-multicoin.test.ts`, `tests/payment-fx.test.ts`, `tests/payment-rails-checkout.integration.test.ts`, `tests/nowpayments.*`, `tests/telegram-*`, `tests/web-payment-*`. BUKAN bukti perilaku akun NOWPayments live atau deployment.

### 16.39 Perbaikan query Ringkasan dan review gabungan — 11 November 2026

- Pemeriksaan SELECT baca-saja pada D1 produksi mereproduksi kegagalan
  `VIEWs and/or subqueries nested too deep: SQLITE_ERROR` pada SQL finansial lama,
  termasuk rentang historis. Bukan kegagalan login; API/UI tetap fail-closed dan
  tidak mengganti angka gagal dengan nol atau snapshot lama.
- `dashboard-report.ts` mempertahankan satu query dan fakta/alokasi biaya existing.
  Ringkasan/supplier/channel memakai satu pembacaan scoped dengan dimensi tiga
  baris; daily/hourly satu pembacaan facts dengan dimensi dua baris. Tidak lagi
  menggandakan rantai CTE untuk setiap cabang UNION; batas lima compound term tetap.
- SQL baru berhasil di D1 produksi. Seluruh baris enam jenis laporan standar
  (76 baris) dan rentang1–10November (22 baris, tanpa hourly hari kini) identik
  dengan cabang query lama yang dieksekusi terpisah. Hanya agregat dibaca; tidak
  ada order, pengiriman, env, migrasi atau data produksi diubah.
- Runtime workerd lokal menerima SQL lama, jadi tidak cukup untuk mereproduksi
  batas server tersebut. Regresi menambahkan schema aplikasi lengkap dan batas
  dua referensi masing-masing facts/scoped, selain tes nilai/alokasi existing.
- Diff sesi `ses_e3a0deff6ffeBormj3Yw9ZDMIV` ditinjau langsung tanpa subagent;
  kontrak lease/fence, retry ambigu, saldo, receipt parsial dan handover §16.38
  dipertahankan. Instruksi11November mengizinkan satu commit/push gabungan;
  larangan publikasi10November di bawah adalah snapshot review sebelumnya.
- Chromium halaman admin aktual1280/390 dengan auth/API fixture: filter periode,
  error500/503, hilangkan data lama, Retry keyboard, WR409→sukses, Retry SK dan
  Cek status TUNVN lulus; tombol48px/fokus3px/tanpa overflow, CSS/JS200.
  Auth asli tanpa sesi tetap401. Ini bukan login Access atau transaksi produksi;
  publikasi melalui CI, deployment belum diverifikasi.
- Verifikasi gabungan akhir: full411file/5660tes, type-check/ESLint18file dan
  build:pages173edge route lulus; audit high exit0/6moderate tooling existing.
  Warning build/Vitest existing tidak diubah; `git diff --check` bersih.

### 16.38 Recovery supplier dan crosscheck regresi — 10 November 2026 (snapshot lokal sebelum publikasi gabungan §16.39)

- `warung-rebahan/order.ts` dan `sekalipay/order.ts`: claim fresh CAS attempt/due,
  takeover pre-send tidak menambah attempt, crash pre-send mengembalikan satu attempt.
  Send wajib lease owner belum expired, request_sent_at NULL, lunas/paid dan tanpa
  handover. Seleksi memfilter eligibility sebelum LIMIT4; fence tetap memeriksa race.
  Manual ownership dicocokkan lewat fi.*_link_id, link.fulfillment_item_id atau
  mapping katalog (LEFT JOIN), bukan hanya mapping current. Balance revive LIMIT8
  setelah filter TTL24jam/paid/fence/invoice/manual, lalu CAS mengulang guard.
- WR Premium tidak berubah kontrak POST/invite/restock/MBO/receipt. Jaspay sent-claimed
  expired bisa recovery dengan input/ref asli; Premium missing invoice tidak direplay.
  Tidak mencocokkan feed berdasarkan produk/waktu. Auto-order off menutup replay.
- SK preflight memakai GET /v1/item/{id} dan /v1/balance existing: identity, auto,
  status on bila ada, harga positif finite, stok-1/unlimited atau cukup, saldo aktual.
  Kegagalan pre-send menunda3menit dan refund attempt; saldo kurang blocked_balance.
  Marker preflight_insufficient_balance dipertahankan saat revive untuk mencegah
  alert admin setiap3menit; sukses POST membersihkannya. Buyer notice existing tetap.
  Legacy blocked memakai snapshot sk_cost; blok preflight memeriksa harga live lagi.
  TTL blok preflight memakai created_at link (immutable), bukan updated_at yang
  disegarkan tiap retry; legacy tetap TTL updated_at. Link pra-send tua perlu admin.
  Error sesudah POST mempertahankan send/ref dan GET reconcile; hanya error kelas
  SkTemporarilyUnavailableError dengan pesan eksak PRODUCT_TEMPORARILY_UNAVAILABLE
  melepas fence. Klasifikasi regex saldo/stok client bukan bukti aman untuk rePOST.
- `sekalipay/deliver.ts`: receipt harus berisi lisensi cukup untuk quantity dan tidak
  mencampur variant lain; licenses kosong boleh fallback product_license. Kosong tetap
  processing/completed_without_license; parsial/salah variant tersimpan AES-GCM dengan
  completed_partial_license, belum settle/kirim. Completion/failure tetap monotonik;
  failure tidak menimpa item delivered/manual. Delivery/aggregate/ledger existing dipakai.
- `fulfillment/delivery/handover.ts`: CAS recheck lunas/paid, menolak WR/SK
  ordering/submitted/processing dan claimed dengan active lease atau send fence,
  baik item sudah bound maupun belum. Supplier failed masih boleh handover.
- `tunvn/orders.ts`: whitelist pra-send <24jam dari orders.created_at pulih saat due,
  bukan generic dispatch_unconfirmed tanpa receipt. Receipt ciphertext+IV+HTTP status
  diproses ulang lokal tanpa POST. needs_admin backoff3menit, processing1menit;
  Buff timeout/JSON invalid/429/5xx/success false tetap processing dan polling GET.
  Pagar paid/disable/manual/snapshot/budget40 dan dua order manual owner tetap.
  Menggantikan larangan auto-requeue §16.35/16.37 hanya pada scope whitelist tersebut.
- Kontrak GET SK dicrosscheck terhadap docs publik /api-docs/items/detail,
  /transactions/detail dan /webhook/events; tanpa mengakses akun supplier produksi.
  Tes baru supplier-dispatch.workerd menjalankan tiga dispatcher bersamaan per
  supplier dengan D1 native/budget40: satu POST, run berikut nol POST, remapped manual
  nol POST. Tes SQLite mencakup race, unpaid starvation, terminal/webhook, receipt,
  saldo top-up, input/ref dan snapshot immutable. Bukan bukti transaksi live/deployment.
- UI SupplierLinkActions: copy error preflight/receipt SK dan poll TUNVN, tombol aksi
  type=button/48px. Browser komponen aktual + CSS build pada1280/390, Retry keyboard,
  SK Retry/Cek status, toast/callback, tanpa submit form/overflow/pageerror; API fixture,
  bukan seluruh halaman admin/auth. Tanpa schema/env/dependency/proxy/cron baru.
  Error409 fixture menampilkan error tanpa callback, tombol disabled saat busy lalu
  pulih, fokus3px; console409 disengaja. Full411 file/5659 tes, tsc/ESLint file berubah
  dan build:pages lulus; audit high exit0 dengan6moderate existing. Belum dipublikasikan.

### 16.37 TUNVN modal dinamis tanpa ceiling snapshot — 10 November 2026 (lokal)

- `tunvn/orders.ts` tidak membandingkan harga preflight dengan `link.cost_usdt`
  untuk menolak pembelian akun/Buff. Biaya snapshot immutable tetap mengikat
  identitas order/link, bukan batas modal. Receipt menyimpan charged_usdt aktual;
  account completed tidak diberi error charged_above_preflight lagi.
- Preflight tetap menolak harga nonfinite/nonpositif sebagai catalog_unavailable
  atau buff_unavailable; saldo dibandingkan harga aktual, stok/fundable, enkripsi,
  paid/disable/ownership dan fence/CAS unchanged. Tanpa replay pasca-send/409/timeout.
- `cost_changed` dipertahankan hanya untuk kompatibilitas Retry historis melalui
  TUNVN_RETRYABLE_SQL existing. UI menjelaskan Retry memakai harga terkini, bukan
  cap lama. Tidak auto-requeue atau mutasi order yang tertahan di produksi.
- Harga katalog tetap mengikuti modal/FX/markup pada sync3menit §16.34, dengan
  override manual admin. Tidak repricing total order yang sudah dibuat/dibayar;
  margin aktual order itu dapat berbeda dari target markup. Snapshot bukan cap.
- Tidak ada schema/migrasi/env/cron/dependency baru. Fixture SQLite/workerd dan
  browser lokal, bukan bukti pembelian/notifikasi produksi atau deployment CI.

### 16.36 TUNVN processing notice dan klasifikasi otomatis — 10 November 2026 (lokal)

- `notifyBuyerTunvnProcessing` dipanggil setelah receipt akun lengkap atau batch Buff
  tersimpan; poll Buff mencoba lagi bila notis belum terkirim. Guard membaca paid web,
  disable0, send fence/attempt dan accepted link nonterminal, item bukan delivered/
  sending. Admission6 statement berbagi budget40 dispatcher; tidak menambah job/env.
- `sendToBuyer`/`buyer_notice_log` existing dengan ref `tunvn-processing:<order>:<link>`
  memberi best-effort dedupe, bukan jaminan exactly-once transport. Tidak ada fallback
  WA atau notis proses Telegram; paid DM existing sudah menyebut otomatis. Email
  ID/EN dari locale order, tanpa input/receipt/kredensial/provider ID. Kegagalan email
  tidak membuka fence atau menggagalkan receipt/delivery; akun tidak memiliki retry
  email proses setelah link completed. Tidak ada replay/backfill order manual owner.
- `VariantSummary.automatic_delivery` optional berasal dari `tunvnEligibility` atas
  row server (SKU+slug+konfigurasi current), bukan request buyer. Catalog detail/active
  variant membawa metadata untuk derivasi; SKU TUNVN tetap kosong di publik. Kelas
  internal `instant` berarti pengiriman otomatis, copy TUNVN khusus tidak menjanjikan
  waktu instan. Quote meniadakan queued_delivery bagi current eligible; paid profile
  Telegram memakai predicate sama. Muse account asli/legacy bundle tidak ikut.
- Status GET `/api/orders` dan POST lookup mengenali snapshot eligibility versi1
  dengan biaya positif dan pembelian tidak disable sebagai supplier-owned; queued
  false pada baris tersebut, instant tetap false. Tidak menambah supplier refresh
  atau POST dari polling buyer; cron TUNVN tetap penjamin. Bukti status hanya boolean,
  private snapshot/input tetap diredaksi dan proof guard tidak berubah.
- `ProductVariantRows` menyembunyikan kontrol mode/inventory lokal untuk SKU TUNVN
  current pada slug yang sesuai, memberi penjelasan otomatis. Mode tersimpan tetap
  manual; API/DB dispatch fence, harga, stok, aktivasi dan autentikasi tidak berubah.
- Verifikasi: SQLite/workerd + regression notis/ledger/locale/budget, katalog/quote/
  Telegram/status/lookup dan editor. Chromium fixture checkout/status/admin1280/390
  tanpa MBO/overflow, Tab dan CSS/JS200; bukan QA PDP penuh, transaksi supplier/email
  nyata atau bukti deployment. Publikasi hanya melalui CI main, tanpa migrasi baru.

### 16.35 TUNVN retry pra-beli — 10 November 2026 (lokal, publikasi CI)

- `tunvn/orders.ts` membedakan whitelist error preflight dari error ambigu tanpa
  menyimpan exception/body mentah. `insufficient_balance` hanya dari saldo valid
  di bawah biaya; balance_unavailable berbeda. Biaya snapshot tidak diubah.
- Predicate `TUNVN_RETRYABLE_SQL` dipakai GET capability dan UPDATE CAS: needs_admin,
  attempt0, seluruh send/receipt/ID/completion NULL, lease expired/null, paid Market
  web/Telegram tanpa disable, item manual belum delivered/sending dan tanpa pemilik
  lain/credential. Legacy error generik tetap harus memenuhi seluruh pagar.
- POST `/api/admin/tunvn/orders` menambah `{id,action:'retry'}`, requireAdmin +
  body2KB + budget40 existing. CAS pending lalu dispatcher/preflight lama; penolakan
  409 no_safe_retry, diterima mengembalikan status/error aktual (bisa masih gagal
  preflight). Tidak reset attempt/fence/receipt atau retry transport setelah send.
- GET admin Pesanan memuat link TUNVN beserta item_index/can_retry/can_reconcile/
  purchase_disabled tanpa invite/ciphertext. GET panel TUNVN juga mengirim capability
  dan disable. UI Retry/Cek status memakai endpoint existing; tidak ada void/buy.
  Order TUNVN tanpa disable tidak memakai handover generik; order disable/mixed
  tetap dapat mencatat handover. CAS handover menolak link pending/claimed/processing
  sehingga handover yang menang mencegah retry, retry yang menang mencegah handover.
- Operasi produksi atas instruksi owner: dua order Muse `AXV-20261110-81C2FADA` /
  `AXV-20261110-9C9B8FF4` diberi supplier_purchase_disabled=1 untuk penanganan manual
  owner via Telegram supplier; readback attempt0/sendNULL. Tidak mengubah status,
  menghapus receipt/fence, membeli, atau mengirim notifikasi. Bukan fixture QA.
- Tanpa schema/migrasi/env/cron/dependency baru. Bukti fixture SQLite/workerd +
  Chromium admin desktop/mobile dan full suite/build di CHANGELOG; belum bukti deploy.

### 16.34 TUNVN auto-sync katalog — 10 November 2026 (lokal, publikasi CI)

- Worker menambahkan `lite:tunvn_catalog` setiap3menit, soft alarm existing,
  setelah job order. Route `/api/cron/lite?job=tunvn_catalog` memakai Bearer cron
  existing dan budget40, gate TUNVN existing; tanpa konfigurasi no-op. FX memakai
  snapshot pasar segar melalui objek D1 ber-budget, bukan kurs konstanta/env baru.
- `publishTunvnCatalog` dipakai bersama cron (`force:false`) dan admin (force).
  Setting lease90detik `tunvn_catalog_lease` berisi owner acak+until, claim SQL
  atomik dan release hanya pemilik. Mirror throttle2menit memberi toleransi jitter
  scheduler3menit; admin force tidak boleh melangkahi lease. Bukan realtime push.
- Mirror harga/stok API penuh divalidasi sebelum upsert; kosong/parsial invalid
  ditolak tanpa sweep. Hilang pada respons penuh valid menjadi stok0. Cadangan
  statement diperiksa sebelum mirror write, sehingga proyeksi+release+checkpoint
  muat40; katalog membesar di luar ceiling menghasilkan error, bukan batch parsial.
- Buff probe `/api/buff/check` mengirim `AXVARA 1` tanpa charge, memvalidasi tepat
  satu breakdown kode/qty/valid dan boolean fundable. Harga unit aktual disimpan
  sebagai `tunvn_cost_usdt`, lalu FX/markup/ceilRp100 atau override admin. Panel
  dan PATCH markup juga memakai unit1/modal tersimpan, bukan snapshot0,0588.
  Fundable false stok0, true -1. Probe gagal tidak mereset stok/harga/modal Buff;
  akun yang sudah tersinkron tetap valid, keseluruhan run503 tanpa heartbeat sukses.
- Harga manual/markup memakai CAS observed values saat upsert; status aktif/copy
  tetap milik admin. Parent ChatGPT/Muse merangkum varian aktif dengan sentinel
  unlimited benar, tanpa mengubah identitas/harga varian Muse account. Bundle
  retired tetap nonaktif/tersembunyi dari editor.
- Factory order web/Telegram mengikat tidak adanya lease katalog aktif ke guard
  reservasi D1 atomik, hanya untuk SKU TUNVN. Ini mencegah old sell price/new modal
  saat mirror dan proyeksi sedang diperbarui; retry setelah sync, bukan invoice
  atau pembelian supplier saat QA. Tidak mengubah snapshot/order yang sudah ada.
- Tanpa schema/migrasi/env/trigger/VPS baru. Route error503 memakai alarm existing;
  tidak ada klaim deploy/live, transaksi produksi atau sinkronisasi instan.

### 16.33 TUNVN T2B: dispatch fenced — 10 November 2026 (implementasi lokal)

- Migrasi0116 menambah `orders.supplier_purchase_disabled` (tes admin=1), tabel
  `tunvn_order_links` UNIQUE(order_code,item_index), kind/source/qty/private code,
  total `cost_usdt`/currency USDT, status pending/claimed/processing/completed/
  needs_admin, attempt/due/lease/fence, provider group/batch/order IDs, encrypted
  receipt + IV/http_status dan metadata numerik aman. `fulfillment_items` memiliki
  `tunvn_link_id`; schema bootstrap sama. Tidak rebuild `order_item_costs`.
- `buyer-fields.ts` memperluas opt-in versi1 dengan `cost_usdt` total dari mirror
  account/per-unit Buff. Factory web/Telegram membaca ulang dan mengikat biaya
  serta config dalam guard batch atomik. Stamp lama tanpa biaya tidak dipromosikan.
  Factory tes admin membuang stamp dan menyimpan disable durable.
- `tunvn/purchase.ts`: POST /api/buy USDT, /api/buff/order satu CODE QTY, /check
  tanpa charge dan GET /status exactbatch, native AbortSignal timeout15detik
  mencakup response body, redirect manual/tanpa retry. GET catalog20detik/saldo
  15detik di client juga mencakup body. Tidak ada deposit/history auto-match.
- `tunvn/orders.ts`: paid Market web/Telegram + snapshot/version/identitas tepat,
  sumber manual non-WR/SK, varian aktif/preset/qty, item belum dimiliki supplier
  lain. Preflight key enkripsi/harga/stock/fundable/saldo, lalu CAS lease90detik
  dan request_sent_at durable sebelum fetch. Max1 link/invocation, klaim aktif
  tidak dicuri. Fence tidak direset meski error/lease kedaluwarsa. HTTP409 hanya
  dijelaskan dalam prosa docs resmi, tanpa kode mesin pasti: needs_admin/nol
  automatic replay, bukan pencocokan pesan yang dikarang (ceiling3 tidak dilampaui).
- Seluruh response pembelian terbaca dienkripsi sebelum parsing, juga partial/
  ekstra/error/body invalid. Receipt durable+HTTP status dapat diproses ulang
  tanpa POST. Account lengkap menyalin hanya qty dibeli ke snapshot generic;
  parsial needs_admin, bonus tersimpan terenkripsi untuk admin, bukan dikirim
  diam-diam. DB/crypto gagal setelah send tidak membuka fence. Tidak log body.
- Buff200/202 hanya processing jika batch diketahui; poll1/batch/invocation
  dengan due1menit, batch/order/code/qty/USDT harus tepat. done+is_done baru
  completed; pending tetap, failed/needs_check needs_admin. Generic delivery
  menangani notis noncredential idempoten tanpa invite/PIN; akun memakai email
  PIN6/c1 dan private Telegram existing tanpa mengubah guard akses buyer.
- Paid scheduling mengikat supplier sebelum generic item manual; stamped pending
  tidak diklaim generic. `tunvn_orders` ditambahkan ke allowlist route lite dan
  `mcp-worker/src/cron.ts` existing;40statement/job, tanpa cron/env/trigger baru.
  Completion mengantrekan lagi generic job yang sudah terminal akibat review.
- Route `/api/admin/tunvn/orders`: requireAdmin + no-store; GET100 metadata aman,
  POST `{id,action:'reveal'|'reconcile'}` pada snapshot T2B, ditambah retry pra-beli
  oleh §16.35, berbatas2KB. Reveal dekripsi privat dan
  audit otorisasi POST existing; reconcile hanya poll batch Buff diketahui di
  budget40, tanpa POST pembelian. Panel Ringkasan menampilkan status/cost/ID;
  kasus tanpa ID diselesaikan admin di luar alur otomatis.
- Batas upstream: tidak ada idempotency atau parameter max_price; preflight
  bukan jaminan harga charge. Dana/stok/harga dapat berubah setelah read, biaya
  aktual disimpan dalam metadata receipt; penanda account charge di atas snapshot
  dihapus oleh revisi §16.37 (snapshot kini histori saja).
  Tidak auto-refund/deposit. Snapshot saldo9November bukan bukti saldo sekarang.
- Lokal/uncommitted, focused SQLite/workerd/tsc/lint saja; PM menjalankan full
  suite/build/T3 browser fixture. Bukan bukti migrasi remote, deployment, atau
  pengiriman/pembayaran produksi. Tidak membaca kredensial atau mengganti env.

### 16.32 TUNVN T2A: katalog gabungan + input varian — 10 November 2026 (histori lokal)

- Revisi owner10November: GET authenticated `/api/products/[id]` dan
  `/api/admin/variants?product_id=` mengecualikan tepat empat SKU retired
  `TUNVN-BUFF-{5,10,20,30}B`, bukan semua varian nonaktif. Editor tidak lagi
  menawarkan bundle lama. Arsip DB/FK/snapshot order tetap utuh; migrasi0115
  dan guard aktivasi existing tetap berlaku. Buff1B/akun Muse dan varian nonaktif
  lain masih dapat diedit. Tanpa schema/env/migrasi baru; belum bukti deploy.
- Mengganti kontrak split/bundle pada snapshot16.30/16.31: migrasi0114 memindahkan
  kedua varian dan mirror link ke `chatgpt-tunvn` (ChatGPT Private), ID/SKU/harga/
  histori tetap; produk duplikat nonaktif saja. UPDATE merge aman diulang.
- Migrasi0115 (ALTER dijalankan sekali oleh ledger migrasi existing) menambah
  `product_variants.buyer_field_key TEXT NULL CHECK(NULL|'muse_invite_code')`,
  `max_qty INTEGER NULL CHECK(1..100)` dan `telegram_carts.buyer_fields TEXT '{}'`.
  Buff1B baru manual/nonaktif, input on/max30; bundle lama nonaktif/histori tetap.
  Trigger menyamakan permintaan terbit dengan status varian akun dan menolak
  reaktivasi bundle lama. Schema bootstrap memuat kontrak yang sama.
- `publishTunvnCatalog` konvergen ke satu produk, mempertahankan copy, status,
  override harga dan preset admin. Harga Buff per-unit40%/ceil100 lalu qty1..30;
  account Muse dasar tidak berubah. Kedua API editor varian dan Products
  menyimpan preset/cap; SKU TUNVN existing tidak boleh diubah dari editor.
- Helper `src/lib/buyer-fields.ts`: validasi trim/enam ASCII alnum/case, satu
  kode per checkout, perbandingan snapshot config, redaksi dan eligibility.
  Web quote menandatangani `buyer_field_key`, `max_qty`, `buyer_fields`; create
  order memeriksa nilai/qty dan `createOrderWithStock` membaca ulang config serta
  memberi SQL guard identitas/config dalam batch reservasi. Qty duplikat
  diagregasi sebelum validasi batas. Stamp client tidak dipercaya.
- Telegram `handlers/buyer-input.ts` memakai pending action
  `buyerinput:<product>:<variant>:<qty>` tanpa nilai kode dalam callback/URL;
  private-only, CAS saat konsumsi, tidak mengganti anchor payment creating.
  Cart menyimpan kode secara privat; approval digest mengikat config/nilai/cap;
  `createChannelOrderAtomic` memberi guard dan snapshot yang sama. WA menolak
  varian input-required sebelum order/invoice, bukan mengabaikan field.
- `orders.items[].tunvn_eligibility` server-only: `{version:1,kind:'account'|
  'buff',source_product_id:number|null,source_variant_id:number,
  source_unit_b:number|null,quantity:number}`; account source86/83 + slug
  canonical, Buff SKU1B + unit1 + preset + cap30. `source_variant_id` adalah ID
  varian AXVARA immutable, bukan ID upstream tambahan. Buyer values berada di
  `items[].buyer_fields.muse_invite_code`. Tidak ada backfill order/bundle lama.
- API buyer status/lookup dan admin list meredaksi nilai/stamp. GET baru pada
  `/api/admin/orders/[code]` membutuhkan `requireAdmin`, `Cache-Control:no-store`
  dan mengirim `buyerInputs` untuk detail saja. Tidak masuk template email/notis.
- Pada snapshot T2A, T2B masih pending dan fulfillment manual (diganti §16.33).
  Tidak ada env/secret/payment rail baru. PM
  menjalankan final full suite/build dan T3 browser fixture; T2A bukan bukti
  live, pembayaran/dispatch produksi, atau migrasi remote telah diterapkan.

### 16.30 Supplier TUNVN PREHUB — setup awal tersembunyi, 9 November 2026 (histori)

- Fondasi supplier ketiga dari reseller Telegram TUNVN PREHUB atas instruksi owner "setup dulu, jangan tampilkan produknya". Tidak ada route/UI/cron/checkout/Telegram yang membaca data TUNVN; tidak ada env Pages yang dipasang.
- Klien `src/lib/tunvn/client.ts` (edge, `fetchWithTimeout`): hanya GET read-only `/api/products` + `/api/balance` ke `TUNVN_BASE_URL` (default `https://tunvnmmo.duckdns.org`, wajib HTTPS) dengan header `X-API-Key` dari `TUNVN_API_KEY`; tanpa retry, 401/403 → `config`, 429/5xx/timeout/JSON rusak → `ambiguous`. `POST /api/buy`/`/api/deposit`/Buff Token SENGAJA belum diimplementasikan.
- Gate: `TUNVN_ENABLED==="true"` (master) + `TUNVN_SYNC_ENABLED==="true"` (sync) + key — semua default mati; tanpa konfigurasi lengkap semua fungsi no-op tanpa fetch. Kredensial lokal `.tunvn-credentials` (ignored, chmod 600); env Pages kelak wajib `secret_text`.
- Mirror `tunvn_products` (migrasi `0110_tunvn_hidden_catalog.sql`, identik `drizzle/schema.sql`): ID upstream unik, harga VND/USDT + stok + diskon bertingkat apa adanya (tanpa konversi kurs/margin), `visible` selalu 0 dari sync. `syncTunvnCatalog` (`src/lib/tunvn/sync.ts`) meniru throttle CAS + upsert chunk `json_each` Games; SENGAJA belum dipanggil pemanggil mana pun.
- Probe read-only 2026-11-09 (bukan deployment): docs terbaca, 19 produk, kurs 25.494 VND/USDT, saldo akun 0 VND / 0,0099 USDT. Aturan lengkap: `docs/agent-rules/tunvn.md`.

### 16.31 TUNVN: katalog ChatGPT + Buff Muse + panel admin — 9 November 2026 (histori)

- Instruksi owner menggantikan batas 16.30 HANYA untuk scope ini: dua produk ChatGPT TUNVN diterbitkan dan Buff Token menjadi varian produk Muse manual; produk TUNVN lain tetap tersembunyi.
- Markup disetujui: ChatGPT 35%, Buff 40% (`src/lib/tunvn/pricing.ts`: ceil Rp100 dari modal USDT × kurs × (1+markup)). Kurs acuan 9 Nov 2026 Rp18.086/USDT; publikasi ulang memakai FX snapshot AXVARA (`loadCurrentFxSnapshot`, fail-closed). Harga awal: Business Rp112.400, GPay Rp121.200, Buff 5B/10B/20B/30B Rp7.500/Rp14.900/Rp29.800/Rp44.700.
- Gambar ChatGPT memakai aset produk ChatGPT AXVARA existing `/r2/products/f87f491ee2f9034845db18eb08c9236d.webp` (sama dengan WR id 12 dan SK id 85 nonaktif; konfirmasi owner + D1 read-only).
- Migrasi 0112: `tunvn_products` +kolom link/harga; `product_variants` +kolom `tunvn_*`; seed produk `chatgpt-business-1-bulan-tunvn`/`chatgpt-gpay-1-bulan-tunvn` + varian `TUNVN-86`/`TUNVN-83` dan `TUNVN-BUFF-*` pada produk `muse-ai-1-miliar-token`. `publishTunvnCatalog` menerbitkan ulang idempoten dari mirror + FX segar.
- Panel admin: section `tunvn`; sidebar admin kini grup Supplier dropdown (WR/SK/TUNVN/WR vs SK/Link) via `SupplierDropdown`. API `/api/admin/tunvn/{products,balance,buff,publish}` requireAdmin; probe buff `POST /api/buff/check` read-only-efek (tanpa debit).
- Env Pages dipasang `secret_text` production+preview: `TUNVN_API_KEY`, `TUNVN_BASE_URL`, `TUNVN_ENABLED=true`, `TUNVN_SYNC_ENABLED=true` (75→79 env), berlaku deployment CI berikutnya. Dispatch order otomatis (`/api/buy`, `/api/buff/order`) BELUM dibangun; fulfillment manual, saldo wallet 0 VND / 0,0099 USDT saat aktivasi.
- Revisi owner di hari yang sama: semua TUNVN dimulai **nonaktif** (seed 0112 direvisi sebelum sempat diterapkan CI; migrasi 0113 memaksa nonaktif sebagai pengaman — terbukti D1 produksi belum punya baris TUNVN dan katalog publik tidak memuatnya). Migrasi 0113 menambah `tunvn_products.admin_name/admin_description/publish_requested` + `product_variants.tunvn_admin_price_idr`. Panel kini mengendalikan per produk: markup, nama/deskripsi publik, saklar Diminta terbit + Produk aktif (keduanya wajib untuk tampil), dan per varian Buff: markup, harga manual, label, status aktif — lewat PATCH `/api/admin/tunvn/products/[id]` + `/api/admin/tunvn/buff/[sku]` (requireAdmin). `publishTunvnCatalog` menghormati semua kontrol admin dan tidak pernah memaksa aktif.

### 16.29 AXVARA Games S1: host, nickname berbiaya dan SKU utilitas — 9 November 2026 (lokal, belum deploy)

- HERO-FIX10November2026 (lokal): GamesPage mengirim slug/name/icon dari registry
  sebagai `GamesHome.orbitGames`, terpisah dari katalog enabled. PediaOrbit mendapat
  props aditif items/brand/mark; default Pedia tetap sama, Games menambah href planet
  tanpa pointer capture pada link. Mesin/orb/kelas planet tidak diduplikasi.
  `getGamesDetail` mengembalikan detail dengan products=[] untuk registry kosong;
  page200/header/state segera tersedia, metadata noindex, tanpa form/nickname request.
  Slug asing tetap null/404 dan sitemap enabled-only tidak berubah. Hero serta dua
  CrossServicePromo mengikuti Pedia/CommunityBar; gating PEDIA_ENABLED tetap utuh.

- `SITE.gamesUrl=https://games.axvara.tech`; middleware `GAMES_HOST` opsional (default sama,
  `secret_text` bila dipasang) rewrite root/path halaman ke `/games/*` tanpa flag enable.
  `/games/*` di host lain308, localhost/127.* tetap lokal. API/_next/aset/brand/R2/MCP
  tidak direwrite; `/admin` produksi tetap apex. Wrapper security headers berlaku semua return.
- Metadata halaman UI memakai `gamesMetadata(path,title,description)` untuk canonical/OG;
  `src/app/games/sitemap.ts` merupakan nested metadata route Next15 `/games/sitemap.xml`,
  hanya root+slug registry dengan SKU enabled non-utilitas. Robots adalah handler biasa
  `src/app/games/robots.txt/route.ts` (bukan nested `robots.ts`, yang tidak didukung Next).
  Host Games rewrite `/sitemap.xml`/`/robots.txt` ke dua route itu; apex SEO tidak berubah.
- `POST /api/games/nickname` edge: stream8.000byte `{slug,fields}`; validasi registry dahulu,
  P9 testing/kredensial/proxy kosong => unavailable tanpa supplier. Hasil ok+nickname / unavailable /
  invalid+message ID/EN (`axv_locale`). FF/FF MAX share `ffcekusername`, ML `mlcekusername`,
  PUBG `pubgcekusername`. `sendTransaction` ref `NCK-UUID`, max_price modal katalog (fallback
  snapshot5/24/80); biaya>80 gagal tertutup sehingga500cek <=Rp40.000/hari.
- Migrasi `drizzle/migrations/0109_games_nickname.sql` + schema §4: D1 claim/cache per
  lookup SKU+customer_no plain (ID game bukan secret), sukses24jam, rc54 invalid1jam,
  gagal final lainnya60detik. IP HMAC memakai secret existing; cookie UUID `axv_nck_device`
  httpOnly/SameSite=Lax/Secure pada HTTPS. Log adalah counter durable: IP10/perangkat5 per
  rolling15menit + global500/hari UTC dalam batch yang sama. Limit/error D1 => unavailable,
  tidak429 dan tidak fail-open. Cache hit tidak memakai slot. Biaya log = batas modal saat
  admission, bukan bukti settlement, termasuk pending/gagal demi konservatisme.
- Pending satu recheck setelah1,5detik dengan payload/ref sama. Salah korelasi/ref/SKU,
  timeout, SN sukses kosong atau masih pending => klaim ambigu tanpa expiry; tidak ref baru.
  S1b lokal: request berikutnya setelah `checked_at` berumur minimal60detik memakai CAS
  ref+checked_at+status pending/ambiguous untuk satu re-poll; payload/ref/max_price dari
  log asli tidak berubah. Hanya satu panggilan per re-poll (tanpa retry1,5detik tambahan),
  tanpa slot global500 atau log biaya baru karena lookup ref existing bukan pembelian baru.
  IP10/perangkat5 per15menit memakai scope `games:nickname_poll{,_device}` existing
  rateLimit (best-effort per isolate, terpisah dari admission berbayar D1; bukan limit global).
  Pagar60detik tetap durable D1; respons lama tidak dapat menimpa pemilik CAS baru.
  Limit/error/testing => unavailable tanpa panggilan. rc54 resmi "Nomor Tujuan Salah" saja => invalid; rc55 gangguan
  => unavailable. SN dibersihkan HTML/kontrol, trim/max64; nickname quote klien hanya display.
- Utilitas (tiga kode di atas atau nama `/cek\s*username/i`) tidak masuk katalog/sitemap,
  quote/order baru409 `not_sellable`, PATCH enabled409, enable-wave dilewati. Riwayat/reuse
  order tersimpan tidak diubah. GET admin products mengembalikan `nickname_checks.today/week`
  count+cost (hari UTC/7hari kalender); GamesManager menampilkan satu baris batas modal.
- Operasi PM9November2026 sekitar21.40–22.05WIB: CNAME `games` ke `axvara.pages.dev`
  (proxied) dan custom domain Pages `games.axvara.tech` ditambahkan. Status awal
  `initializing`; aktif/DNS end-to-end belum diverifikasi, jangan klaim live.
  Env Development dipasang sebagai metadata Pages produksi (§16.25), berlaku pada
  deployment CI berikutnya, bukan bukti runtime terbarui. Access admin belum mencakup
  host Games: `/admin` produksi tetap ke apex; `/api/admin` fail-closed, tanpa bypass.

### 16.28 AXVARA Games B1 + B2: API pembeli dan rail pembayaran — 9 November 2026 (lokal, belum deploy)

#### B2 terkini: gateway/crypto dan pemisahan quote/kontak
- `POST /api/games/quote` kini tanpa kontak: `{slug,buyer_sku_code,fields,nickname?,locale?}` → `paymentMethods` seperti Pedia (katalog+fee/total), `game`/`sku` ringkas, `quote_token` JWE 30 menit. Kontak tidak ada dalam token. `POST /api/games/orders` menerima `{quote_token,payment_method,whatsapp,email}`, memvalidasi/menormalisasi kontak seperti Pedia sebelum admission. Kontrak ini menggantikan bentuk B1 di snapshot bawah.
- `buildMethodCatalog` + `serializePediaQuoteMethods`/`resolvePediaMethodSelection` dipakai ulang; hanya available masuk token, baris diverifikasi `isCanonicalMethodOption`. Hilang/tidak kanonis/tidak ada pilihan → 409 `quote_stale`, tanpa fallback. Kurasi DANA/ShopeePay, harga crypto per koin, snapshot/minimum tetap sumber bersama (§16.20/§16.22); tidak ada daftar kanal/rumus Games. Token maksimal30.000 karakter (fixture katalog28koin sekitar23k), stream JSON tetap32.000byte, lookup/consent8.000byte.
- Order Games baru QRIS15/gateway30/crypto60 menit, minimum deadline provider, tidak pernah diperpanjang. Claim order+item tetap batch atomik berpagar SKU/target, tanpa stok Market. Saved retry non-QRIS hanya view tersimpan (metode awal tetap meski request berubah); gateway/crypto create memakai adapter existing. Gagal rail503 `error_code:payment_method_unavailable` + kode/status_url. Definitif mengikuti Pedia (gateway rejeksi terbaca+GET absence+mark rejected, atau preclaim; crypto klasifikasi existing); cancel `transitionPendingOrder(...,[])` dan expire item. Ambigu tidak dibatalkan/tidak di-POST ulang.
- `games/lookup.ts` membangun payment view kanonis hanya setelah proof penuh (atau create milik request). Status polling memakai klaim durable existing; gateway known-id initializing dipulihkan GET-only. Consent memakai endpoint bersama. `isValidBuyerOrderCode` dan empat guard gateway menerima AXV|AXP|AXG; `isValidOrderCode` tetap AXV-only, route Market tetap menolak AXG/AXP.
- Paid gateway reconcile menjadwalkan Games hanya setelah transisi paid berhasil; crypto IPN memakai scheduler existing. Keduanya mengirim fulfillment=null untuk Games (tanpa outbox Market), replay tidak menjadwalkan kedua kali. Late/underpaid/mismatch tidak dispatch; mismatch identitas/nominal crypto khusus Games diberi marker durable manual review, error Market/Pedia tidak diubah. Cron `games_orders` tetap recovery.
- Bukti B2 lokal: 67 file/1016 tes fokus hijau termasuk Games/Pedia/payments/security dan dua workerd. Tanpa dev server/full suite/build/deploy, transaksi produksi, env/migrasi atau UI baru; full suite/build diteruskan ke PM.

#### Snapshot B1 (kontrak quote/kontak dan QRIS-only diganti B2 di atas)

- **API edge dinamis:** `GET /api/games/catalog`, `GET /api/games/catalog/[slug]`,
  `POST /api/games/quote`, `POST /api/games/orders`, `GET /api/games/orders/[code]`,
  `POST /api/games/lookup`; bentuk request/response lengkap di `docs/GAMES.md` §12.8.
  Semua katalog/quote/status sukses `private,no-store`; lookup selalu no-store.
- **Registry tunggal** `games/registry.ts`: FF/FF MAX playerId 6–14 digit, ML userId
  1–12 + zoneId 1–6 (concat tanpa pemisah), PUBG playerId 6–15; rentang konservatif
  agar tidak menganggap rentang observasi R1 sebagai batas universal.
- **P9:** `games/ordering.ts` menutup quote/order 503 `games_preview` bila testing
  `true` atau username/key kosong; katalog tetap terbaca dengan `ordering_open=false`.
  Tidak ada env/migrasi baru atau perubahan guard kode shared gateway/crypto.
- **Quote/order:** JWE A256GCM 30 menit (`games/quote.ts`, key diturunkan dari
  `ADMIN_JWT_SECRET`) mengikat SKU/harga/ID akun/kontak/locale, B1 hanya QRIS.
  Prefix AXG; quantity 1, `max_price=min(unit_price,ceil(cost_snapshot*1.05))`,
  deadline 15 menit. `checkout-guard` existing berbagi batas 5/IP,3/WA,3/email
  per 15 menit; klaim `games:<jti>`, error D1 503. Satu `d1.batch` insert orders
  kind games + item awaiting_payment; SKU live dan duplicate target+SKU dipagar
  dalam batch, tanpa reservasi Market. Reuse quote 200, baru 201, `quote_stale` /
  `duplicate_active_order` 409; gagal invoice 503 menyertakan kode order tersimpan.
  Invoice `createActiveQrisInvoice` mempertahankan rail/nominal saat retry.
- **Status/lacak:** kontak WA/email penuh seperti Pedia; data supplier sensitif
  tidak dipublikasi. `games/status.ts`: awaiting_payment/processing/success+SN/
  needs_admin/expired, tidak sukses sebelum item sukses; paid belum dipromosi
  tetap processing. `games/lookup.ts` menggabungkan order, item dan ledger QRIS.
- **Expiry/paid:** `games/expire.ts` di job lite expiry existing (5 transisi/20 item,
  hanya unpaid terminal yang disapu); shared transition tidak restock games/pedia.
  Callback KlikQRIS dan endpoint gambar QRIS menerima AXG secara lokal; DANA,
  GoPay, KlikQRIS paid menjadwalkan games, tanpa job Market/WR/SK. Semua jalur
  Market/Pedia existing dipertahankan; cron games_orders tetap pemulihan.
- **Limiter in-memory** `rateLimit.ts`: games:quote 30, games:orders 10,
  games:status 30, games:lookup 20, games:wake 6 per IP/menit, melengkapi admission
  D1 (bukan pengganti). Body JSON buyer 32.000, lookup 8.000 byte.
- **Bukti/batas:** tests/games-{orders,registry,cancel-stock.regression,qris.integration}.test.ts
  + `games-checkout.workerd.test.ts` (D1 workerd, handler quote/order/reuse/status/expiry
  asli; adapter HTTP Next memakai primitive native) dan regresi Games/Pedia/QRIS/cron lokal; tidak ada transaksi, env, deployment atau
  UI Games dalam B1. Paket gateway/crypto, nickname dan UI menyusul.

### 16.27 AXVARA Games admin data P1–P3 — 9 November 2026 (lokal → CI)

- **Seed A2 (lokal, belum deploy):** `drizzle/migrations/0111_games_reference_seed.sql`
  berisi198 SKU utama (FF16/FF MAX8/ML156/PUBG18), source `ourastore.com riset 2026-11-09`,
  captured_at/updated_at tetap `2026-11-09T08:28:15Z`. Generator stdlib offline
  `scripts/generate-games-reference-seed.mjs <reference.json> <skus.json>` membaca JSON
  saja, menolak kode tidak valid/duplikat, memilih exact, kode utama menurut aturan
  `isBackup` catalog-sync, non-utilitas via guard bersama, empat brand gelombang1,
  harga Oura integer>0 dan rasio Oura/modal `[0.5,3.0]`.383 kandidat:198 dipilih,
  168 cadangan+16 bukan exact+1 rasio ditolak (alasan pertama per kandidat).
  SQL deterministik urut kode, `ON CONFLICT(buyer_sku_code) DO NOTHING`, tanpa raw
  JSON di repo. Tidak menimpa admin/mengaktifkan SKU/menghitung ulang katalog:
  `syncGamesCatalog` berikutnya menghitung `sell_price` dan cermin referensi existing.
  Nomor0110 milik migrasi lain; A2 tidak menyentuhnya dan tidak bergantung padanya.

- **Schema (migrasi 0108 `games_admin`)**: tabel `games_reference_prices(buyer_sku_code PK, price>0, source, captured_at, updated_at)` = sumber kebenaran harga Oura; kolom `games_products.display_group` (CHECK NULL/`special`/`bestseller`) + `display_order`. Cermin `games_products.reference_price` dan `sell_price` diisi sinkron/admin, bukan sumber kebenaran.
- **Sinkron diubah:** `syncGamesCatalog` membaca `games_reference_prices` (bukan kolom cermin), menulis `reference_price` + `sell_price` saat upsert; `enabled`, `display_group`, `display_order` tidak pernah disentuh. Referensi untuk kode yang belum tersinkron tetap tersimpan dan berlaku saat SKU muncul.
- **Helper murni** `src/lib/games/admin.ts`: `GAMES_WAVE1_BRANDS` (FREE FIRE, Free Fire Max, MOBILE LEGENDS, PUBG MOBILE; case-insensitive), `effectiveGroup` (override admin → Membership/WDP/Twilight → `all`), `isHealthyForWave` (`seller_active=1 AND cost>0 AND sell_price>=floor AND sell_price<=reference`), `gamesMargin` (`cost, sell, floor, margin_rp, margin_pct, source, competitive`), `listGamesProducts`, `gamesAdminSyncStatus`, `enableGamesWave1`.
- **API admin (edge, pola Pedia: `requireAdmin` + audit `admin_authorized`, body 8.000 byte)**:
  - `GET /api/admin/games/products` → `{items(+margin+effectiveGroup), total, limit, offset, brands, sync:{last_sync_at dari store_settings.games_catalog_sync_at, counts:{total,enabled,seller_active,with_reference}}}`; `limit` ≤200.
  - `PATCH /api/admin/games/products` → `enabled`/`reference_price`/`display_group`/`display_order`; upsert/delete `games_reference_prices` (`source='admin'`, `captured_at=now`), hitung ulang `sell_price` (`computeGamesSellPrice`), cermin kolom, satu `d1.batch`. 400 validasi ketat, 404 `not_found`, 409 `not_sellable` saat `enabled=true` tanpa seller aktif/modal.
  - `POST /api/admin/games/products/enable-wave` `{dry_run?}` → `{eligible, enabled_now, skipped_unhealthy}`; hanya brand gelombang 1 yang sehat; tidak pernah menonaktifkan.
- **UI:** tab admin "Games" (`src/components/admin/GamesManager.tsx`, lazy di `admin/page.tsx`, sidebar grup Katalog) — status sinkron, filter brand/cari, tabel modal/harga Oura/harga jual/margin/sumber/seller/grup, edit harga Oura inline, toggle aktif, aktivasi gelombang 1 dua tahap (dry_run → konfirmasi).
- **Bukti:** `tests/games-admin.test.ts`, `tests/games-admin-migration.test.ts`, `tests/games-catalog-sync.test.ts` diperbarui. Belum deployment, belum ada data produksi, dan harga Oura gelombang 1 belum diisi.

### 16.26 AXVARA Games tahap B: dispatch, seller cadangan, webhook — 9 November 2026 (lokal → CI)

- `src/lib/games/dispatch.ts` `processGamesPaidOrders`: promosi `awaiting_payment`→`queued` untuk order `lunas/paid`, klaim berpagar (`changes===1`, lease 300 dtk), attempt `ref_id=<order>-<n>` (maks 1 aktif, dipakai ulang bila sudah ada), `sendTransaction` dengan `max_price`; satu fungsi transisi `applyGamesTransactionResult` untuk dispatch/poll/webhook. Sukses→`success`+SN; Pending→`pending`; Gagal attempt 1 + cadangan aktif & `backup_cost ≤ max_price`→attempt 2 kode `…b`; selain itu `needs_check` + Telegram admin (`src/lib/games/notify.ts`). Transport ambigu→`pending` dicek ulang dengan ref sama; `submitting` basi dengan attempt→`pending` (tanpa ref baru), tanpa attempt→`queued`. Poll backoff 60/120/300 dtk, pending >24 jam→`needs_check`. Idle gate 1 statement; budget 40 statement dijaga `canSpend` (maks 10 dispatch/10 poll per run).
- Pemicu: `schedulePaidFulfillment(code,'games')` (`src/lib/payments/paid-fulfillment.ts`) + cron lite `games_orders` (alarm hard, setelah `pedia_orders`).
- Webhook `POST /api/games/digiflazz/webhook` (edge): batas 16.000 byte, `X-Hub-Signature: sha1=HMAC-SHA1` constant-time (401), secret kosong 503, ping 200 setelah tanda tangan valid, dedupe `dana_webhook_events` provider `digiflazz` key `digiflazz:<ref>:<status>` (`matched/ignored` final → duplicate; error apply → `failed` + 503 agar dikirim ulang).
- Catatan: semua status Gagal dianggap final tanpa memeriksa `rc` (tindak lanjut: allowlist rc transien). Webhook dashboard Digiflazz tetap Non Aktif sampai env + deploy terverifikasi; periksa apakah ping Digiflazz bertanda tangan.

### 16.25 AXVARA Games tahap A + proxy Digiflazz `/dgf/*` — 9 November 2026

- **Proxy (terpasang di VPS):** `POST /dgf/v1/{cek-saldo,price-list,transaction}`, token `WARUNG_REBAHAN_PROXY_TOKEN`, body bertanda tangan Pages diteruskan byte-per-byte; bukti: `/health dgf:true`, cek-saldo Development 200, tanpa token 401. Detail `axvara-wr-proxy/AGENTS.md`.
- **Kode (lokal → CI):** `src/lib/games/digiflazz.ts` (md5 murni TS, sign, `callDigiflazz` → ok/ambiguous/config/http_error/api_error, `checkBalance`, `fetchPrepaidPriceList`, `sendTransaction`), `src/lib/games/catalog-sync.ts` (`syncGamesCatalog`: CAS `store_settings.games_catalog_sync_at` ≥9 mnt, upsert `json_each` per 50 baris, kode `…b` → kolom cadangan, katalog Games kosong = tidak mengubah apa pun, `enabled`/`reference_price` tidak disentuh).
- **Migrasi 0107** `games_products`, `games_order_items`, `games_dispatch_attempts` (§12.2 `docs/GAMES.md`); `orders.order_kind` tanpa CHECK sehingga `'games'` diterima.
- **Cron:** lite job `games_catalog` (`mcp-worker` langkah `everyMinutes:10`, alarm soft); tanpa `DIGIFLAZZ_USERNAME`/`DIGIFLAZZ_API_KEY` → 200 `skipped:not_configured`.
- **Env dipasang PM9November2026 sekitar21.40–22.05WIB (`secret_text` di Pages produksi):**
  `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` (Development Key), `DIGIFLAZZ_WEBHOOK_SECRET`,
  `DIGIFLAZZ_TESTING=true`. Snapshot jumlah75env dikonfigurasi,79/128 termasuk4sistem.
  Berlaku pada deployment CI berikutnya; runtime/sinkron belum terverifikasi. Proxy memakai
  `WARUNG_REBAHAN_PROXY_URL/TOKEN` existing. Setelah env terambil runtime, cron
  `games_catalog` mulai memakai Development Key; P9 tetap pratinjau karena testing=true,
  nickname selalu unavailable tanpa panggilan berbayar. Tidak mengklaim katalog tersinkron.
- **Gerbang owner (keputusan9November malam):** owner memilih tidak merotasi key;
  gerbang7.1 ditutup oleh owner, bukan bukti rotasi. Webhook dashboard tetap non-aktif
  (7.2 terbuka); belum deposit/Production (7.3) atau transaksi nyata (7.4).
  Rujukan `docs/games-paseo-brief.md` §7 dan GAMES §12.6; tidak mengaktifkan sebagai QA.

### 16.20 Sekalipay payment gateway via proxy VPS `/skg/*` — 6 November 2026

- Koreksi insiden tes owner: canonical deployment `770a0519587ac05f7b50bc183e790b81c4482a0e` success dibuat `2026-11-06T14:19:49.545708Z`; tes ShopeePay21:57WIB kemudian mendapat upstreamPOST401, diikuti GET404, TXinitializing/tanpa invoice. Kontrak resmi https://merchant.sekalipay.com/id/dokumentasi/authentication membedakan whitelist (POSTHMAC rawbody; GETkey saja) dari Enhanced (canonical method/path/params/timestamp). Adapter sebelumnya salah menerapkan Enhanced pada whitelist; GET katalog200 tidak menguji secret/signature.
- `gatewayTransport` kini menyimpan `body=JSON.stringify(params)` sekali; POST melalui proxy VPS whitelist memakai `gatewayHmac(secret, body)` lalu mengirim string itu identik. GET dan direct tanpa proxy mempertahankan Enhanced/header existing. Tidak menambah env/mode/fallback otomatis; bila akun proxied berubah ke Enhanced, mode eksplisit diperlukan. Proxy tidak perlu diubah/restart; tetap meneruskan body/header. Tidak mengganti key atau membuka rail publik/bot.
- Verifikasi koreksi: regression oracle `node:crypto` memverifikasi byte mentah termasuk Unicode/plus/URL, gagal dengan kode lama401 dan lulus setelah perbaikan. Saved retry tetap satuPOST, direct Enhanced dan recovery GET/error ambigu tetap lulus. Focused4file/77tes termasuk workerd, full361file/4804tes, lint/tsc/build Pages148edge routes lulus; audit0high/critical/6moderate dev-chain existing. Browser N/A (transport backend saja, UI tidak berubah). Tidak membuat invoice nyata atau mutasi order untuk QA; order percobaan lama tidak di-POST ulang/reset. Koreksi aktif di canonical `d2edb1924250472af223cfce0b955e2412bca1ee` (success `2026-11-06T15:40:46.22327Z`; bukti read-only invoice tersimpan berhasil dibuat), bukan bukti pembayaran/settlement live. Paragraf bukti rilis sebelumnya di bawah tetap snapshot bertanggal.

- Status terkini: seluruh empat modul `dist` dipasang di VPS setelah izin restart terkontrol owner dan upstream aktif0; satu link WR processing lama tanpa lease aktif dipertahankan. Backup penuh `dist.backup-skg-admin-20261106`, env/state tidak diubah. Restart pertama rollback karena health terlalu dini; percobaan berikutnya memakai retry health terikat, service active, `skg:true`, hash seluruh modul cocok lokal. GET melalui hostname publik tanpa token401, bertanda tangan200/18kanal. Bukan bukti invoice atau settlement. Catatan lokal/QA di bawah merupakan snapshot sebelum pemasangan; batas publik terbaru mengikuti §16.21.

- Revisi UI terbaru 6 November: `PaymentMethodPicker` tidak memiliki pencarian di VA/E-Wallet/Lainnya maupun Crypto. `method-logos.ts` memetakan label server secara persis ke SVG/WebP lokal, termasuk BNC (NEO), Permata Alternative, DANA/ShopeePay Realtime, Virgo dan AstraPay; seluruh 18 label snapshot merchant memiliki logo, label ambigu tetap monogram. Tidak mengubah kontrak quote/create, routing, fee, limit, consent atau env. Verifikasi revisi ini: 360 file/4794 tes, typecheck/lint/build Pages lulus (145 edge routes); Chromium ID/EN 1280/390/360 tanpa input pencarian/monogram kanal dikenal/overflow/error konsol, semua logo decode, keyboard/fokus/jaringan eksplisit/deselect/inert/reduced-motion lulus; preview :3003 diperbarui dengan D1 lokal/provider mock. Bukti QA sebelumnya di bawah adalah snapshot sebelum revisi ini, bukan aktivasi produksi.
- Keputusan owner 6 November 2026: suspensi merchant Sekalipay dicabut dan metode VA/E-Wallet/lainnya (non-QRIS) akan ditampilkan di atas Crypto. Aturan 5 November "disembunyikan" digantikan; rail baru aktif hanya setelah deploy + env + verifikasi akses/visual (bukan di commit ini).
- Dashboard merchant hanya me-whitelist IP VPS `13.228.147.90` dan Cloudflare Pages tidak punya egress IP tetap, sehingga seluruh panggilan gateway lewat proxy `axvara-wr-proxy` (route `ALL /skg/*`, `https://wr-proxy.axvara.tech`). Kontrak proxy: allowlist `GET /skg/v1/gateway/payment-methods`, `POST /skg/v1/gateway/payment`, `GET /skg/v1/gateway/payment/<ref>` (`<ref>` `^[A-Za-z0-9_-]{1,80}$`); wajib header `x-proxy-token`; hanya meneruskan `X-API-Key`/`X-Timestamp`/`X-Signature` (+Accept/Content-Type) dan body MENTAH apa adanya ke `https://sekalipay.com/api/v1/gateway/...`. Respons: status/JSON upstream diteruskan; POST 2xx tak terbaca = 502 `{"message":"skg_proxy_unreadable_response: network_error"}`; jaringan/timeout = 504 `{"message":"skg_proxy_timeout"}`; auth proxy gagal = 401 `{"status":false,"reason":"unauthorized"}`; path salah = 404 `unknown_skg_path`.
- Transport tunggal `gatewayTransport` di adapter: bila `SEKALIPAY_PROXY_URL` (origin https murni: tanpa kredensial/port/path/query/fragment) dan `SEKALIPAY_PROXY_TOKEN` (env Pages yang sama dengan supplier SK) keduanya terisi dan valid, panggilan ke `${origin}/skg/v1/gateway/<path>` dengan `x-proxy-token`. Hanya bila KEDUA env kosong boleh langsung ke `https://sekalipay.com/api/v1/gateway/<path>` (harness/tes lokal); konfigurasi parsial/invalid melempar `sekalipay_gateway_proxy_config_error` sebelum fetch, tanpa fallback langsung. POST via proxy whitelist memakai HMAC atas body mentah, direct Enhanced atas path kanonis upstream `api/v1/gateway/<path>`; body diserialisasi sekali (`JSON.stringify`) dan dikirim identik. `SEKALIPAY_GATEWAY_API_KEY` diteruskan sebagai `X-API-Key`; `SEKALIPAY_GATEWAY_SECRET_KEY` tetap di Pages untuk HMAC, tidak dikirim atau disimpan di VPS. Kedua env gateway bertipe secret_text.
- Semantik error: POST `payment` dengan proxy 502 (marker `skg_proxy_unreadable_response`), 504, atau error jaringan/timeout = `sekalipay_gateway_create_ambiguous` (klaim durable `initializing` dipertahankan, tanpa POST ulang, pemulihan GET/refresh/cron/review manual seperti sebelumnya). Proxy 401 `unauthorized` atau 404 `unknown_skg_path` (baca maupun tulis) = `sekalipay_gateway_proxy_config_error` (fail closed, bukan penolakan bisnis; rail katalog tersembunyi, tanpa retry otomatis). Baca (methods/status) lain tetap penanganan lama: kegagalan katalog hanya menyembunyikan rail gateway, QRIS/crypto tidak terpengaruh. Validasi `payment_link` host `sekalipay.com` dan `redirect:"manual"` tidak berubah.
- Bukti akses: GET katalog bertanda tangan dari VPS pada 6 November HTTP200/status:true, 18 kanal (10 VA/8 E-Wallet), tanpa invoice nyata. Jalur `/skg/*` belum dipasang; env/flag gateway Pages tidak diubah. Tes transport memakai fetch mock. Verifikasi akhir lokal: 360 file/4794 tes lulus, typecheck/lint/build Pages lulus (145 edge routes); QA Chromium EN1280/390 dan ID1280/360, pencarian/empty/reset, keyboard/fokus, exclusive-open/deselect, inert, reduced-motion (`transition-property:none`), SVG BSI berhasil decode, tanpa overflow/error konsol terkait checkout. Consent total akhir diuji dengan invoice mock/D1 lokal; bukan bukti deployment, pembayaran atau settlement nyata.

### 16.23 Keputusan owner 7 November 2026: tanpa lantai US$2, biaya layanan crypto 2% sementara [bagian biaya 2% DIGANTI §16.24; bagian lantai US$2 masih berlaku]
- **Lantai US$2 dihapus.** `CRYPTO_MIN_TOTAL_USD_CENTS` dihapus dari `crypto-pricing.ts`; `cryptoRequiredTotalCents(minUsdText)` = `ceil(min×1,15)` saja (null bila minimum tidak valid). Pemakaian yang dibersihkan: `crypto-preflight.ts` (`isCryptoTotalStillPayable` menolak hanya total ≤ 0), `auth.ts` (`isValidCryptoMethod` tanpa cek lantai), `src/app/api/orders/route.ts` (re-check create tanpa lantai), `nowpayments.ts` (error `nowpayments_below_floor` dihapus). Ketersediaan crypto kini murni minimum provider per koin × 1,15; buffer, fail-closed minimum/kurs/konfigurasi, cek snapshot segar dan `409 quote_stale` tidak berubah.
- **`CRYPTO_SURCHARGE_BPS` 150 → 200 (HISTORIS, diganti §16.24)**: `surcharge=ceil(base*200/10000)`, `total=base+surcharge`, `price_amount` provider = total; kebijakan provider tetap `is_fixed_rate:false`/`is_fee_paid_by_user:false`.
- **Kompatibilitas**: read path memakai `payment_transactions.crypto_surcharge_bps` tersimpan (`payment-view.ts` → `payCopy`/`orderPanelCopy`/status Telegram), bukan konstanta; invoice 150/200 bps lama tetap menampilkan nominal tersimpannya dan tetap direkonsiliasi tanpa menulis ulang baris. Konstanta hanya untuk invoice/token BARU.
- Token quote crypto lama (bps 150/200) ditolak validator baru (409 muat ulang) saat deploy; invoice/order tersimpan tetap dilayani. Status: implementasi + tes lokal; belum deployment atau transaksi.

### 16.24 Keputusan owner 7 November 2026: biaya layanan crypto per koin (1% + biaya tetap)
Menggantikan biaya rata 2% di §16.23. Tujuan: merchant menerima minimal nilai barang setelah potongan proses NOWPayments + fee payout.
- **Rumus** (`src/lib/payments/crypto-pricing.ts`, BigInt sen USD): `CRYPTO_SURCHARGE_BPS = 100` (proporsional 1%) + biaya tetap per ticker. `total = ceil((base + fixed) * 10000 / (10000 - bps))`; `surcharge = total - base`. `cryptoPricing(baseCents, ticker, bps?)` → `{baseCents, fixedCents, surchargeCents, totalCents, surchargeBps}`; `minIdrSubtotalForTotal(requiredTotalCents, ticker, fx)`. `cryptoSurchargeCents` dihapus.
- **Tabel tetap** `CRYPTO_FIXED_FEE_CENTS = {usdtbsc:8, bnbbsc:8, eth:17}` (sen USD, termasuk cadangan payout), ticker lain `CRYPTO_DEFAULT_FIXED_FEE_CENTS = 20`; `cryptoFixedFeeCents(ticker)` case-insensitive, kosong/tak dikenal → 20.
- **Bukti read-only 7 November 2026**: invoice USDT-BSC paid 2,26 → custody 2,18140899 (rugi 0,0786); estimasi BNB-BSC 0,90 → 0,86296 (0,037), ETH 1,13 → 0,9756 (0,154); fee payout USDT-BSC ≈0,0215. Angka BNB/ETH = estimasi dari titik sampel; koin lain 20c sampai dikalibrasi dashboard NOWPayments.
- **Pemanggil ticker**: `src/app/api/orders/route.ts`, `src/lib/payments/nowpayments.ts`, `crypto-preflight.ts`, `src/lib/auth.ts`, `src/lib/pedia/payment-methods.ts`, `src/lib/telegram/handlers/payment-dispatch.ts`. Validasi fail-closed tetap: `surcharge_bps === CRYPTO_SURCHARGE_BPS` + base/surcharge/total dihitung ulang; token bps 150/200 ditolak.
- **Tanpa migrasi**: kolom existing menyimpan `crypto_surcharge_bps = 100` dan `crypto_surcharge_usd_cents` = biaya penuh (proporsional + tetap); baris lama tetap dibaca/direkonsiliasi dari kolom tersimpan.
- **Copy**: label generik "Biaya layanan crypto"/"Crypto service fee" (+ nominal), tanpa persentase; `bpsPercentText` dihapus. `cryptoCaption`/`cryptoServiceFeeRow`/`approxWithFee`/`totalWithFee` tidak lagi menerima parameter bps.
- **Token ringkas**: blok `crypto` memuat `items[{ticker,total_cents}]` (total berbeda per koin) + field bersama; lihat §16.19.
- Status: implementasi + tes lokal; belum deployment atau transaksi.

### 16.22 Rail non-QRIS publik — 7 November 2026
- Keputusan owner 7 November 2026: rail non-QRIS (Sekalipay gateway VA/E-Wallet + crypto NOWPayments) dibuka ke PUBLIK web + bot Telegram. Pages produksi `SEKALIPAY_GATEWAY_ENABLED=true` dan `NOWPAYMENTS_ENABLED=true` (`secret_text`, PATCH metadata 71 env tetap) — berlaku pada deployment CI berikutnya; belum ada bukti transaksi publik paid/settlement. Kill-switch: set flag ke `false` (`secret_text`) lalu rilis CI; read/reconcile invoice tersimpan tidak bergantung flag. Status "kedua rail publik tetap `false`" pada §16.21 dan catatan status di atas adalah snapshot 6 November.

### 16.21 Tes pembayaran admin terisolasi — 6 November 2026 (versi `770a051` terdeploy; koreksi POST §16.20 aktif via canonical `d2edb19`)

- Route edge dinamis baru: `src/app/(shop)/admin/payments/test/page.tsx`, `/api/admin/payments/test/quote` dan `/api/admin/payments/test/orders`. Halaman server memeriksa `requireAdmin`, redirect unauthorized ke `/admin`, noindex/nofollow, notice saat nonaktif. `PaymentTestScope.tsx` menyediakan context defaultfalse hanya untuk memilih endpoint UI; bukan otorisasi. Checkout existing dipakai ulang, termasuk keranjang, quote, harga, stok, instruksi dan notifikasi nyata.
- Dua route API me-re-export handler existing. Handler mengenali pathname admin eksak, memanggil `requireAdmin` (JWT aplikasi+idle+revokasi/password dan Access produksi), lalu meneruskan boolean internal `adminTest` ke katalog/preflight/create adapter. Tidak membaca switch header/body/query. `admin_payment_test?: true` divalidasi schema dan ditandatangani dalam quote, termasuk bentuk crypto ringkas; create memeriksa kesamaan scope SEBELUM saved-order retry. Salah scope403, sesi tidak sah401. Quote sukses `private, no-store`; limiter/body limit/anti-abuse existing tetap.
- Gate `PAYMENT_ADMIN_TEST_ENABLED` defaultoff hanya untuk admin. Halaman, quote dan order baru memerlukannya; saved-order retry tetap admin meski flag mati, tanpa POST/reservasi ulang. Default semua helper/public/TG tetap memakai flag publik masing-masing. Tidak ada perubahan schema, cron baru, dependency, signature provider, durable claim/ambiguity, consent final, minimum/fee, fulfillment atau payout.
- Handoff Pages produksi (semua `secret_text`): tambah `PAYMENT_ADMIN_TEST_ENABLED=true`, `NOWPAYMENTS_ENABLED=false`, `SEKALIPAY_GATEWAY_ENABLED=false`, `NOWPAYMENTS_OUTCOME_CURRENCY=usdtbsc`, `NOWPAYMENTS_API_KEY`/`NOWPAYMENTS_IPN_SECRET` dari `.nowpayments-credentials`, `SEKALIPAY_GATEWAY_API_KEY`/`SEKALIPAY_GATEWAY_SECRET_KEY` dari `.sekalipay-gateway-credentials`. PATCH hanya delapan entri, tidak mengirim ulang nilai secret existing yang disamarkan; metadata seluruh env existing tetap. Sesudahnya71env+4system=75/128 pada plan Paid existing. Proxy URL/token supplier existing dipertahankan. Env baru berlaku pada deployment berikutnya; jangan mengaktifkan kedua flag publik untuk mengatasi masalah tes.
- Bootstrap memakai fungsi `refreshCryptoMarketSnapshot` existing dengan adapter D1 hanya tabel snapshot dan outbound GET estimate/merchant/coins/min-amount; tidak menjalankan cleanup/order/fulfillment produksi. FX awal429, retry bootstrap dijeda/serial berhasil: `fx_effective_at=coins_refreshed_at=2026-11-06T13:55:17.602Z`,21koin, `coins_min_omitted_7`. Koin gagal tidak ditebak. Cron lite cleanup existing berjalan dengan read API key tanpa flag publik; aturan lease, freshness24jam/2jam dan fail-closed tetap. Snapshot juga dapat mengaktifkan tampilan USD existing, bukan rail pembayaran publik.
- Per-invoice callback tetap `${SITE.webUrl}/api/payments/nowpayments/ipn` dan `/api/payments/sekalipay-gateway/callback`; secret/HMAC, binding invoice/order/amount, dedupe/reconcile tersimpan tidak tergantung flag create. GET live405 dan POST tanpa signature401 sebelum akses DB. Access live302ke login pada kedua path admin baru, tidak pada callback; jangan blanket `/api` atau mengubah MFA. Kesiapan path/konfigurasi bukan bukti callback paid atau settlement.
- Verifikasi770a051: `tests/admin-payment-test.integration.test.ts` (auth/revokasi/Access, isolasi bot/publik, signed scope/replay, dua provider/create sekali, retry/kill-switch), UI scope tests, fixture workerd/Chromium ID1280/390/360 (OVO consent + crypto pending/refresh/resume/expiry; assets200, keyboard/fokus, tanpa overflow/error terkait). Full361file/4803tes, lint/tsc/build Pages148edge routes lulus; audit0high/critical,6moderate dev-chain existing. Proxy `npm test`/tsc lulus. Tidak membuat invoice/pembayaran produksi untuk QA; fitur admin770a051 dan koreksi POST §16.20 (canonical `d2edb19`) sudah terdeploy, dengan bukti read-only invoice tersimpan — bukan paid/settlement. Kill-switch memerlukan perubahan env dan rilis CI, jangan hapus kredensial callback/status.

### 16.40 AXVARA Games — katalog/transaksi Sekalipay SK-only (12 November 2026, lokal, belum deploy)
- **Sumber data:** migrasi aditif `drizzle/migrations/0118_games_sekalipay.sql` (0117 tetap milik Pedia) menambah `supplier` (default `digiflazz`), `supplier_active`, `sk_variant_id/sk_sku/sk_product_id/sk_product_name/game_slug`, `product_type_name`, `image_url`, `required_fields_json`, `validation_json`, `min_order` pada `games_products`; snapshot `supplier/sk_variant_id/target_snapshot/fields_snapshot/sk_invoice/supplier_ref` pada `games_order_items`; `supplier/sk_invoice/request_sent_at/payload_snapshot/dispatch_status/units_json` pada `games_dispatch_attempts`. Indeks unik varian hanya `WHERE supplier='sekalipay'`; baris lama tidak diubah.
- **Stok:** `-1` dipertahankan dari upstream sebagai tak terbatas (sama dengan preflight premium/live); `0`, negatif lain, dan nilai rusak menjadi tidak tersedia. Predikat katalog/quote/order konsisten.
- **Sync:** `src/lib/games/sk-catalog-sync.ts` `GET v1/item?category=Game&per_page=all` lewat transport SK existing; completeness memakai metadata MENTAH (`variant count === meta.total_items`, non-delta). Upsert `json_each` atomik, chunk 250 baris/80KB, admission sisa statement sebelum CAS/throttle; snapshot parsial tidak pernah menonaktifkan. `enabled=1` hanya saat insert; update tidak pernah mengubah `enabled`. Deaktivasi hanya setelah snapshot lengkap. Cron lite `games_catalog` memanggil fungsi ini (tidak ada price-list Digiflazz).
- **Katalog publik:** `src/lib/games/catalog.ts` membaca DB: home `getGamesCatalog` (semua game enabled+berharga), detail `getGamesDetail` (hanya SK rows per `game_slug`, termasuk admin-disabled dengan `availability_reason`; baris Digiflazz legacy tidak dirender di katalog publik). Sitemap hanya slug `supplier='sekalipay'`; registry hanya override metadata empat slug lama bila SK-nya ada. Kontrak field dinormalisasi (`note`/`zone_id`, teks, batas 50/20); deskripsi plain text; gambar hanya allowlist `https://sekalipay.com/images/products/*`. Sitemap/metadata membaca slug DB, bukan registry empat game; registry hanya override aset/nama legacy.
- **Order baru:** gate `gamesOrderingOpen` = `GAMES_SK_ENABLED==='true'` + SK enabled/transport + bukan sandbox. Quote menandatangani `supplier`, `sk_variant_id`, `target_snapshot`, `contract_digest`, `cost_snapshot`, `customer_no` display; order membuat satu batch atomik yang memeriksa ulang supplier/enabled/active/stok/min_order/`game_slug`/`required_fields_json`/harga/modal. SKU Digiflazz dan token lama ditolak. Tidak ada env yang dipasang.
- **Dispatch:** `src/lib/games/sk-dispatch.ts` + `dispatch.ts` per item supplier. Ref kompak `AXG`; preflight live (status/stock/min_order/kontrak/harga/saldo) sebelum fence; fence mengikat attempt+item+lease+order paid; tidak ada POST kedua (GET ref sama). Parser sukses hanya completed+SN sah+unit konsisten+biaya terverifikasi; biaya aktual disimpan di `attempts.price` sebagai deteksi pasca-debit (SK tidak punya `max_price`). Attempt/order legacy Digiflazz tetap memakai jalur lama. Tidak ada seller cadangan SK.
- **Webhook:** `POST /api/webhook/sekalipay` memeriksa signature existing, lalu ref Games dikenal diproses lebih dulu (GET by ref, invoice tersimpan otoritas, hint salah ditolak 503 tanpa mutasi) dan dedupe `dana_webhook_events` provider `sekalipay_games`; ref premium/unknown tetap jalur lama. Nickname publik memakai `validateSkAccount` gratis dengan cache/rate-limit; modul nickname Digiflazz lama tidak dipakai route baru.
- **Admin:** `GET /api/admin/games/products` hanya supplier `sekalipay` (counts supplier/contract/availability), `PATCH` menolak legacy `legacy_parked`, `POST .../enable-wave` 410 `bulk_activation_retired`. Tab Games menampilkan varian/stok/kontrak/deskripsi; kontrol harga Oura/grup/urutan/enabled tetap. Baris Digiflazz tidak dihapus.
- **Batas bukti final terintegrasi (12 November 2026, setelah fix stok -1 dispatch):** full suite serial parent `npx vitest run --run --maxWorkers=1` **438 file/5.923 tes lulus** (228,77 dtk), lalu `npm run build:pages` penuh **PASS 173 edge route** (Next compile/lint/typecheck + konversi; 19,02 dtk hanya durasi konversi, bukan total build). Pemulihan jujur: default-worker suite timeout fixture workerd `telegram-bulk-checkout` 5 dtk, run 2-worker gagal 2 fixture workerd `telegram-payment-rails`; keduanya lulus saat ditargetkan dan serial penuh lulus tanpa perubahan kode/assertion/timeout. Checkpoint 419/5.760 pra-integrasi dan 438/5.920 pra-fix stok tetap histori. QA browser publik 1280/390 lulus; admin diuji pada artefak Next lokal 8792 dengan fixture jaringan browser (bukan auth/backend persist/produksi). Tidak ada deployment/push, env/secret, aktivasi gate, atau transaksi supplier nyata. Angka 47 produk/1.619 varian adalah snapshot bertanggal. Gate produksi `GAMES_SK_ENABLED` masih kosong.
