# Roadmap refactor & fondasi fitur AXVARA

Dibuat: 21 November 2026 (malam). Pemilik keputusan: owner. Penyusun: PM (Opus).
Sumber: empat peta baca-saja (lampiran `issue/refactor-2026-11/`) dan tiga review
independen atas draf dokumen ini (Wonder, Sol, DeepSeek; semuanya *OK-with-changes*,
koreksinya sudah dimasukkan). Basis kode: `ad711d6f`.

Dokumen ini adalah **sumber kebenaran urutan kerja** refactor sampai fondasi fitur besar
siap. Setiap sesi/agent yang mengerjakan langkah di sini WAJIB:
1. membaca dokumen ini lebih dulu;
2. mengerjakan **hanya** langkah berikutnya yang belum selesai dan prasyaratnya terpenuhi;
3. memperbarui tabel status §10 di commit langkah itu.

Mengubah urutan, scope, atau aturan di sini hanya dengan keputusan owner yang dicatat di
§11. Lampiran adalah snapshot bertanggal: konfirmasi nomor baris di source sebelum dipakai.

---

## 1. Tujuan

1. Merapikan dan menguji jalur uang (supplier, order, cron) sampai fitur berikut bisa
   dibangun **tanpa menyalin logika lama lagi**:
   - login member biasa;
   - program reseller, dashboard reseller, dan **API key reseller**;
   - affiliate;
   - supplier baru dengan produk baru, termasuk **virtual number** (sewa nomor, tunggu
     OTP, lalu selesai, batal, atau refund).
2. Bergerak cepat dengan **regresi minimal**. Setiap langkah dijaga test pengaman, audit
   paralel, verifikasi silang dua agen, dan review independen.

## 2. Bukan tujuan

Hal-hal berikut dilarang dikerjakan dalam roadmap ini.

- Membangun fitur reseller/affiliate/member/API/virtual number. Roadmap ini hanya
  menyiapkan fondasinya. Tiap fitur mendapat dokumen issue sendiri (§8).
- Mengubah perilaku yang terlihat pembeli/admin pada langkah kelas **E**.
- Merefactor area stabil yang tidak punya tekanan fitur tetapi berisiko tinggi:
  - PIN/proof/akses order pembeli (`src/lib/order-access.ts`, cookie perangkat);
  - rail pembayaran (`src/lib/payments/*`);
  - auth admin dan Cloudflare Access (`src/lib/auth.ts`, `src/lib/cloudflare-access.ts`);
  - internal TUNVN PREHUB dan Pedia;
  - pipeline copy/white-label;
  - file data copy (`src/lib/product-copy/curated*.ts`, `storebat/copy.ts`, `pedia/copy.ts`).
- Membuat "framework" besar: class hierarchy supplier, DI container, ORM baru, atau
  registry job dengan import statis (§3.6). Yang boleh hanya fungsi kecil dan konfigurasi
  konstanta.
- Menaikkan budget statement D1 global, mengubah jadwal cron, atau menambah cron baru.
  Satu-satunya pengecualian adalah floor percobaan terakhir WR di 2C (D1).

## 3. Kontrak yang dibekukan (berlaku untuk SEMUA langkah)

Melanggar satu butir saja berarti langkahnya gagal, walaupun test hijau.

### Jalur uang (`docs/agent-rules/supplier-wr-sk.md`)
1. **Setelah pembelian mungkin terkirim:**
   - jangan reset bukti kirim untuk membeli lagi;
   - jangan membuat identitas pembelian baru;
   - jangan melakukan replay buta.

   Pertahankan bukti kirim. Gunakan hanya pemulihan supplier yang sudah disetujui, dengan
   identitas/payload, guard, batas waktu, dan batas percobaan yang berlaku:
   - AIVault: replay dengan `external_order_id` yang sama.
   - Mirai: replay key/body yang sama, hanya setelah lookup GET 404 yang memenuhi syarat.
   - StoreBat: replay key/body yang sama, hanya setelah match eksak `failed_no_charge`
     tanpa order dan masih dalam batas attempt. Status 404 saja tidak cukup.
   - TUNVN: tidak ada auto-replay.

   `WrNetworkError` yang bukan `preSend` tetap dianggap ambigu, dan batas bukti penolakan
   definitif dari FX-20 tetap berlaku.
2. **Pemulihan per supplier tidak boleh disatukan**, dan tidak boleh ada fallback
   antar-supplier:
   - **WR Premium tanpa invoice:** hanya diikat lewat pilihan admin atas invoice eksak,
     dengan guard ownership/binding. Bila invoice sudah ada, rekonsiliasi read-only
     berdasarkan ID tersebut.
   - **Jaspay tanpa invoice:** hanya replay ref dan payload identik, sesuai lease dan
     jendela recovery. Bila invoice sudah ada, GET status invoice eksak.
   - **SK tanpa invoice:** pulih dengan GET ref stabil, bukan POST ulang. Status 404 atau
     timeout tidak membuka fence. Poll invoice SK yang sudah terikat tetap read-only.
3. **Lease dan dispatch:**
   - Hanya pemilik lease yang masih berlaku yang dapat memenangkan CAS fence sebelum POST.
     Eligibility/handover dicek ulang saat menulis.
   - Owner yang basi atau kalah tidak mengirim, tidak me-reset fence, dan tidak melepas
     lease pihak lain.
   - Receipt/terminal otoritatif yang datang terlambat tetap boleh masuk lewat CAS
     identitas/status supplier, tanpa harus punya lease pembelian yang hidup.
   - Replay atau CAS yang kalah tidak membatalkan lease aktif.
   - Lease recovery Jaspay tetap terpisah.
4. **Admin Retry WR/SK** hanya untuk state yang diizinkan, dengan seluruh syarat ini:
   `orders.status='lunas'`, `payment_status='paid'`, `supplier_purchase_disabled=0`, tanpa
   `request_sent_at`, **dan** tanpa invoice/provider order ID.
   - Guard yang sama diulang di CAS, termasuk state/attempt dan aturan void SK.
   - Pertahankan cek enablement yang ada, semantik NULL/empty, response/urutan cek tiap
     route, dan pemisahan reset `failed` dari retry biasa.
   - Reconcile bukan jalur re-arm.
5. **Budget statement pada langkah E dibekukan.** Yang tidak boleh berubah:
   - jumlah statement per cabang;
   - komposisi batch (N anggota = N statement);
   - titik dan ambang admission (mis. `canSpend(6)` dispatch WR);
   - reserved tail;
   - ceiling, termasuk 300/400 per cron dan ceiling sync WR;
   - urutan kerja;
   - perilaku deferral/throw.

   Helper hasil ekstraksi tidak boleh menambah round-trip, termasuk `SELECT 1`. Perubahan
   budget hanya boleh di langkah B yang disetujui eksplisit (2C).

### Platform (`docs/agent-rules/platform-ops.md`, MAP-1 §Global constraints)
6. `src/app/api/cron/lite/route.ts` tidak boleh punya import statis ke
   telegram/whatsapp/fulfillment/warung-rebahan/sekalipay/payments. Ini dijaga
   `tests/cron-lite.integration.test.ts`. Badan job tetap dicapai lewat `await import()`.
   Dispatcher boleh berupa `if/else` atau `switch`, tetapi tidak boleh berupa map import
   statis.
7. Hal-hal berikut tidak boleh berubah:
   - nama job/fase sebagai string (mis. `LITE_JOBS`);
   - path route;
   - bentuk **dan urutan kunci/elemen** JSON respons;
   - sinyal `more:true`;
   - `RUN_DEADLINE_MS`;
   - auth `CRON_SECRET` dengan `constantTimeEqual`;
   - `bumpCatalogRevision` paling banyak 1× per run dan hanya saat ada perubahan;
   - kunci penanda: `cron_lite_<job>_ok_at` (hanya saat sukses, tidak pada 503),
     `cron_last_hit_at` (setiap run), dan `cron_last_ok_at` (hanya bila `?phase=` selesai).
8. Urutan potongan katalog `POST /wr/products-slice` dan `GET /sk/catalog-slice` tetap
   sama dengan repo `axvara-wr-proxy`.
9. Specifier `@/lib/warung-rebahan/sync` tetap mengekspor seluruh simbol yang ada sekarang
   (barrel eager, tidak lazy). Specifier ini dipakai `vi.mock(importOriginal)` dan bundle
   workerd.
10. **Sync WR/Jaspay:**
    - a. Zero-missing **hanya** boleh dijalankan bila sweep penuh tervalidasi dalam run itu
      (`startAt===0 && sweepComplete`), atau bila slice terakhir membawa daftar id
      otoritatif. Pemecahan tahap tidak boleh me-reset cursor/`startAt` atau memindahkan
      panggilan zero-missing keluar dari cabang `sweepComplete`.
    - b. Mode diff (`applyOnly`, dari `POST /api/supplier-sync`) tidak menulis
      `wr_sync_log`/`sk_sync_log`.
    - c. `raiseCeilingForCatalogSync` (+800) adalah hook pada objek `DatabaseAccess`
      pemanggil. Modul hasil ekstraksi wajib memakai objek akses yang sama. Membungkus ulang
      objek itu menghilangkan plafon, sehingga sweep selalu parsial.
    - d. Predikat `IS NOT` pada UPDATE sync adalah kontrak kuota tulis D1: sweep tanpa
      perubahan upstream hanya menulis sekitar 12 baris. Jangan menyederhanakan UPDATE
      saat memindahkannya.
11. `src/app/api/orders/route.ts` tetap mengekspor `POST`/`GET` di path yang sama: 27 file
    test mengimpor modul ini dan 39 file membaca path-nya sebagai teks. Bentuknya harus
    wrapper tipis, bukan `export {…} from`.

    GET tetap kompatibel dengan `orders/lookup`. Tujuh field respons harus identik:
    `credentials_ready`, `supplier_owned`, `supplier_running`, `unique_units_progress`,
    `qris_reissue_allowed`, `automatic_progress`, `fulfillment_status`.

    Slot checkout tetap memakai `createDatabaseAccess()` tanpa budget.

### Test dan dokumen
12. Assertion lama tidak boleh dilemahkan atau dihapus. Test yang membaca source sebagai
    teks **dipindah targetnya** ke file baru pada commit yang sama. Aturan ini juga berlaku
    untuk path, nomor baris, dan nama fungsi yang dikutip `docs/agent-rules/*.md` dan
    `docs/ARCHITECTURE.md`.
13. Test characterization (`tests/characterization/*`) adalah kontrak.
    - Assertion-nya hanya boleh diubah pada langkah **B** yang disetujui, dengan alasan
      tertulis.
    - Baseline jumlahnya: 80 test supplier kecil = (9 kasus tetap + 11 `RETRY_VIOLATIONS`)
      × 4 supplier.
    - Menambah kasus mengubah baseline dan harus dicatat.
    - `it.todo`, `skip`, atau judul test bukan bukti acceptance.

### Identitas & API (berlaku mulai Fase 4)
14. Auth aktor baru (member, reseller, API key) tidak boleh memakai JWT
    admin/`requireAdmin`, Cloudflare Access admin, `ADMIN_JWT_SECRET`, atau PIN/proof
    pembeli. Secret dan cakupan cookie terpisah per jenis aktor.
15. API key hanya disimpan sebagai hash, mengikuti bentuk `src/lib/agent-auth.ts`, dan
    harus punya scope serta expiry. Setiap pembuatan order lewat API wajib membawa
    `Idempotency-Key` dari pemanggil (unik per API key). Retry dengan key yang sama tidak
    boleh membuat order kedua.
16. Kolom identitas/atribusi di `orders` (`member_id`, `affiliate_member_id`) bersifat
    aditif dan nullable. Checkout tamu dan jalur web/Telegram lama tidak berubah.
17. Payload token quote bertanda tangan yang sudah terbit (`src/lib/auth.ts`
    `createCheckoutQuoteToken`/`verifyCheckoutQuoteToken`) tetap harus bisa diverifikasi
    sampai kedaluwarsa alaminya. F1/F2 tidak boleh mengubah bentuk payload tanpa masa
    transisi baca-ganda.

## 4. Kelas langkah dan protokol anti-regresi

| Kelas | Definisi | Boleh beruntun? |
|---|---|---|
| **T** (test-only) | Menambah test/baseline. Tanpa perubahan `src/`. | Ya, paralel. |
| **E** (ekstraksi) | Memindah/menyatukan kode tanpa mengubah salah satu dari hal berikut: perilaku, statement count per cabang, urutan panggilan supplier, jumlah baris yang ditulis D1, urutan kunci/elemen JSON respons. | Ya, bila gerbang §4.6 lolos. |
| **B** (perilaku) | Memperbaiki bug atau mengubah aturan. Selalu commit terpisah dari ekstraksi. | Hanya satu langkah B jalur uang "in flight" per rilis. |

**Protokol tiap langkah (wajib, berurutan):**
1. **Peta dan test dulu.** Bila cakupan kurang, langkah T didahulukan. Gap test sudah
   terdaftar di Fase 1.
2. **Paket kerja** dari PM dengan acceptance criteria yang bisa dicek (template §9).
3. **Writer** sesuai routing di §7. Setiap writer memegang satu area file. Keluaran writer
   adalah working tree, diff, dan laporan; writer tidak pernah commit atau push.
4. **Verifikasi silang.** Reviewer independen (agen yang berbeda dari writer, mode
   baca-saja) memeriksa diff terhadap §3 dan acceptance criteria. Untuk langkah B jalur
   uang dibutuhkan dua pemeriksa independen: satu membuat repro, satu memverifikasi dari
   source (pola FX-20).
5. **PM** menjalankan verifikasi sesuai tabel dampak di AGENTS.md pada tree final:
   - test terkait, **full suite** `npx vitest run --run`, dan `npx tsc --noEmit -p .`;
   - test workerd bila menyentuh D1/Workers;
   - build target bila perlu (`npm run build:pages`), terutama untuk routing/toolchain dan
     sebelum rilis;
   - browser nyata bila interaksi UI berubah.

   PM juga memastikan langkah T tidak mengubah `src/`, lalu memperbarui dokumen: PRD bila
   flow/requirement berubah, ARCHITECTURE bila struktur/skema/route/cron berubah, aturan
   area bila kontrak berubah, path yang dikutip dokumen (§3.12), dan `CHANGELOG.md`.
   Setelah itu baru commit.
6. **Gerbang langkah jalur uang berikutnya.** Ini pengecualian tercatat atas AGENTS.md
   "berhenti setelah push": satu kali pembacaan di awal langkah berikutnya, bukan
   pemantauan.
   - Setelah push diterima, catat SHA sebagai *dipublikasikan, rilis belum terverifikasi*.
     Akhiri sesi tanpa polling.
   - Di awal langkah uang berikutnya, PM memeriksa **sekali** untuk SHA rilis kode/skema
     prasyarat: run `ci.yml` (event push `main`) berstatus success, langkah Pages (dan
     migrasi bila relevan) sukses, dan bukti health/admin read-only sejak deploy tidak
     menunjukkan regresi baru. Catat SHA, run ID, dan hasilnya.
   - Commit docs-only bukan rilis.
   - Bila run pending/missing/cancelled, SHA tidak cocok, ada tahap yang gagal, atau
     kesehatan belum terbukti, gerbang tertahan. Eskalasi ke owner. Jangan polling, jangan
     deploy manual, jangan lanjut.
   - Bila Pages sukses tetapi tahap sesudahnya gagal, perlakukan sebagai rilis parsial.
7. **Batas review:** maksimal dua ronde review→fix per paket. Sisa temuan ditriase PM:
   blocker dikerjakan, nit dicatat. Blocker yang masih tersisa setelah dua ronde berarti
   rilis ditahan dan dieskalasi.
8. **Status:** bedakan *lokal*, *dipublikasikan (push)*, dan *terdeploy terverifikasi*.
   Jangan menandai live dari bukti lokal atau push saja.

**Kecepatan** (keputusan owner 21 Nov: "cepat tapi tetap hati-hati"):
- Langkah T dan E non-uang boleh paralel dan beruntun dalam satu hari.
- Langkah E jalur uang boleh beruntun bila gerbang 6 lolos.
- Langkah B jalur uang: satu per rilis.

**Mode malam lokal (21→22 Nov, owner tidur, keputusan owner):**
- Tidak ada push sampai owner mengetik "gas push".
- Setiap langkah dibuat sebagai commit lokal sendiri agar regresi bisa di-bisect.
- Karena tidak ada deploy di antara langkah, gerbang 6 diganti dengan:
  1. full suite dan review independen per langkah;
  2. sebelum "gas push", **review terintegrasi** oleh reviewer baru atas seluruh rentang
     commit lokal, ditambah full suite, workerd, dan `npm run build:pages`.
- Langkah B jalur uang tetap satu per commit. Bila ada lebih dari satu B dalam satu push,
  urutannya dicatat di §10 untuk triase.

## 5. Ringkasan temuan yang membentuk urutan

- **Churn 60 hari:** `cron/lite` 54 commit, `orders/route.ts` 44, `cron/operations` 37,
  WR `sync.ts` 24, `SupplierAdminPanel` 5 (MAP-1).
- **Empat supplier kecil** menduplikasi inti paid-gating/claim, bukan kebijakan lengkap.
  Settle, owner guard (StoreBat lebih ketat), retry/backoff, recovery, dan receipt berbeda
  per supplier. TUNVN punya status CASE, auto-recovery, dan reconcile sendiri (MAP-2).
- **WR/SK** berbagi mekanika lease/fence/backoff/admin-retry, tetapi pemulihannya berbeda
  menurut kontrak owner dan tidak boleh disatukan (MAP-3 §1).
- **Fondasi fitur yang belum ada** (MAP-4):
  - satu fungsi `placeOrder` lintas kanal (sekarang web, Telegram, Games, dan Pedia
    membuat order sendiri-sendiri);
  - seam harga per tier (sekarang harga dimaterialisasi per varian saat sync);
  - identitas member (sekarang pembeli tanpa akun);
  - ledger saldo pelanggan;
  - kontrak supplier multi-langkah;
  - kanal `api` (CHECK `orders.sales_channel` saat ini hanya web/telegram/whatsapp, dan
    `customer_wa NOT NULL`).
- **Bug terbuka yang dijadwalkan:** **H4** (keranjang campuran ditandai gagal prematur),
  **R1** (sweep klaim basi tanpa syarat lunas/aktif), **R2** (receipt SK tanpa guard
  kepemilikan invoice lintas-link), **B4b** (lease WR tidak dibersihkan saat advance
  menang). Lihat `issue/2026-11-21-audit-followups.md`.

## 6. Fase dan langkah

Kode langkah dipakai di commit message, CHANGELOG, dan §10.

### Fase 0: Selesai (21 Nov 2026)
- [x] Audit FX-18/FX-19, beserta follow-up yang dicatat.
- [x] Test characterization: 4 supplier kecil (80 test) dan state machine WR/SK.
- [x] FX-20: perbaikan H1, H2 (pengaman), H3, H5/R3, H6, H7. H4 ditunda.
- [x] Empat peta baca-saja dan tiga review roadmap.

### Fase 1: Jaring pengaman lanjutan (kelas T, paralel)
Gap test yang terdaftar ditutup **sebelum** langkah E yang bergantung padanya. Bila
langkah T menemukan dugaan bug baru, catat sebagai `it.todo` dan laporkan. Jangan
perbaiki diam-diam, dan jangan ubah `src/`.

**T1: baseline statement per cabang** (prasyarat 2A, 2B, 2C)
- Lingkup: jalur yang disentuh 2A/2B/2C. Jalur lain cukup dirujuk ke MAP-3 §3.
- Ukur dan **assert** delta statement per cabang pada basis tetap, memakai fixture
  terinstrumentasi, ditambah cross-check jalur kritis di workerd.
- Cabang yang diukur: WR Premium biasa/invite; Jaspay receipt/processing/completion;
  claim fresh/inline/loss untuk WR dan SK; final attempt stock/non-stock; SK proof dengan
  settlement ketat; recovery terminal dan 404/ref.
- Catat juga: scope hitungan (scan/tail dipisah), anggota batch, failed submission,
  reserved tail, outcome break/throw, dan urutan panggilan supplier.
- T1 **tidak** mengesahkan floor 24 untuk H4. Floor itu diukur di C2.

**T2: gap supplier kecil** (prasyarat A1–A4; MAP-2 §6)
- Statement count `create*Links`, dispatch sukses/retryable, dan `retry*`. Yang dipakai
  sebagai acuan adalah **subset yang disentuh Tier-1** (claim UPDATE = 1 statement, tanpa
  pre-read), sedangkan total `process*Orders` (21/21/21/23) tidak boleh berubah.
- Settle saat lease kedaluwarsa tetapi pemiliknya sama.
- Order lunas dengan kanal tidak valid menghasilkan 0 link.
- TUNVN: `reconcileId` dan autopolicy.
- Muse Buff StoreBat: regresi yang ada dijalankan.
- Rate-limit stop per supplier, serta urutan deadline/limit.

**T3: matriks WR/SK per langkah B** (prasyarat B1–B5, 2C; MAP-3 §5)
- Sebelum B1: admin status paid/disabled/void/invoice/fence dan race CAS, response,
  backoff/rank.
- Sebelum B2: dua runner/owner lama; drift expiry/due/attempt/invoice; veto handover
  forward dan reverse; matriks transport H1; wire:
  - Premium tanpa invoice tidak POST dan tidak auto-bind;
  - Jaspay replay identik, dengan batas dan guard lease;
  - SK duplicate/404 GET-only, dan lost receipt bukan sukses.
- Sebelum B3: sweep NULL vs `''`, refund/last attempt, dan link yang sudah terkirim tetap
  recoverable.
- Sebelum B4: advance terminal/processing, replay, loss, dan webhook yang menang.
- Kasus acceptance untuk B3b, B4b, B5, dan 2C disiapkan sebagai test berbadan `it.fails`
  (gagal = bug tereproduksi; diratifikasi PM 21 Nov), lalu dibalik menjadi `it` biasa dan
  dibuktikan lulus di langkah B masing-masing.

**T4: cron** (prasyarat 3A, 3C; MAP-1 (b)§5, (c)§5)
- (i) Snapshot golden **seluruh** objek `results` cron operations, yaitu 72 kunci terukur
  (33 di skeleton dan 39 yang di-assign fase), termasuk urutan kunci.
- (ii) Matriks kapan `cron_lite_<job>_ok_at` **tidak** ditulis.
- (iii) Perilaku publish katalog 4 supplier. **Koreksi 22 Nov (T4, diverifikasi Wonder):**
  keempatnya seragam mengembalikan 503 pada `ok:false` sebelum marker/pairs drain
  (`lite/route.ts` cabang aivault/storebat/mirai/tunvn). Klaim MAP-1 bahwa tunvn/aivault
  lanjut itu salah. Asimetri nyata yang tersisa: `storebat` memakai
  `!("unchanged" in synced)`. Perilaku 503 seragam adalah kontrak saat ini dan dipertahankan 3A.
- (iv) `sampleWhatsAppGateway` dan nested budget 400 `processBroadcasts`.

**T5: order web** (prasyarat 3B; MAP-1 (d)§5)
- Urutan guard: `price_changed` harus sebelum `createOrderWithStock`.
- Respons reused/closed/created.
- GET pasca-refresh (`credentials_ready`).
- Paritas 7 field dengan `orders/lookup`.

**T6: sync WR dan panel admin** (prasyarat 3D, 3E; MAP-1 (a)§5, (e)§5)
- (i) WR `sync.ts` per tahap: cursor resume, zero-missing hanya pada sweep penuh, prefetch
  lebih dari 50 id, `runWrites` batch-gagal→fallback, `refreshAllParentAggregates` (saat
  ini 0 test), `bumpCatalogRevision` hanya saat berubah, `applyOnly` tanpa `*_sync_log`,
  dan ceiling +800. Baseline yang sudah ada dirujuk: `sync.test.ts` "48 produk tuntas
  SATU sweep" dan `sync-time-budget`.
- (ii) `SupplierAdminPanel`: matriks 3 pesan `runWrSkSync`, copy gagal-sebagian
  `applyBulkMarkup`, `runSandbox`, `loadErrors` per seksi, clamp pagination, ditambah
  canary `admin-stability`.

**T7: order Telegram** (prasyarat F1; MAP-4 §1)
- Pembuatan order lewat `commerce.ts` `createChannelOrderAtomic`: sukses, idempotent
  `isExisting`, race stok.

### Fase 2: Supplier & state machine (jalur uang)

**2A: Helper bersama 4 supplier kecil (refactor #4), kelas E.** Lampiran MAP-2.
- Folder baru `src/lib/suppliers/` dibuat di A1. Isinya `link-lease.ts` **Tier-1 saja**:
  `isPaidOrder`, `PAID_ORDER_SQL`, konfigurasi tabel tertutup, dan `claimLink`.
  - Identifier SQL hanya konstanta compile-time. Nilai tetap bound parameter.
  - Perbedaan TUNVN ditulis eksplisit di konfigurasi.
- Urutan: **A1 AIVault → A2 Mirai → A3 StoreBat → A4 TUNVN**, satu supplier per commit.
- Settle, owner guard, retry/backoff, transport/recovery, receipt, delivery, dan Tier-2
  berada **di luar** 2A. Tier-2 hanya boleh diajukan sebagai paket terpisah, bukan
  dikerjakan saat review Tier-1.
- Helper ini **boleh digantikan** kontrak v2 (F3) untuk link multi-langkah. Jangan
  memperluasnya menjadi framework WR/SK.
- Acceptance: `tests/characterization/small-suppliers-claim.test.ts`, test supplier
  terkait, dan workerd lulus tanpa perubahan assertion. Statement count sesuai T1/T2.

**Hasil akhir 2A (22 Nov, sengaja asimetris; jangan "dirapikan" sebagai ekstraksi):**
AIVault dan Mirai memakai predikat JS + SQL + `claimLink` bersama. StoreBat memakai SQL +
`claimLink` bersama, tetapi cek JS `paid` tetap lokal karena lebih ketat (`=== 0`). TUNVN hanya
memakai predikat JS bersama; empat predikat SQL dan klaim CASE tetap milik adapter. Menyatukan
lebih jauh adalah perubahan kelas B.

**2B: State machine WR/SK (refactor #3).** Lampiran MAP-3 §6. Urutan default:
**B1 → B2 → B2b → B3 → B3b → B4 → B4b → B5 → 2C**.
- **B1 (E):** backoff/rank murni, predikat eligibility paid/enabled, dan wrapper admin
  retry.
- **B2 (E):** helper klaim fresh/inline dan send-fence di callsite nyata. Gate 6/6–14 dan
  seleksi due tidak berubah.
- **B2b (B):** CAS receipt Premium (`wr_order_id IS NULL OR =?`) diselaraskan dengan klaim/sweep
  (`COALESCE(wr_order_id,'')=''`) agar baris invoice kosong `''` (hanya data lama; tidak ada
  penulis `''`) tetap menerima invoice yang diterima. Tanpa jalur pembelian kedua (temuan T3,
  diverifikasi Wonder).
- **B3 (E):** ekstraksi sweep unsent.
- **B3b (B), yaitu R1:** tambah `EXISTS` lunas/paid/enabled **hanya** pada UPDATE bulk
  requeue klaim kedaluwarsa yang tanpa sent marker dan tanpa invoice. Bukan pada jalur
  read-only sent/ref. Refund attempt dan guard invoice tiap supplier dipertahankan.
- **B4 (E):** plumbing advance vendor (rank/CAS) di bawah wrapper per supplier.
- **B4b (B):** kosongkan lease WR hanya ketika advance otoritatif menang, termasuk CAS
  completion baru Premium dan Jaspay. Replay, refresh akun same-state, dan CAS yang kalah
  tidak melepas lease dan tidak mengubah fence/attempt.
- **B5 (B), yaitu R2:** guard ownership invoice lintas-link yang atomik pada receipt
  `processOneSkLink` dan `bindSkInvoiceByRef`. UPDATE processing di
  `reconcileAmbiguousSkLink` harus mensyaratkan invoice sudah terikat, bukan menulis ulang.
  Konflik bukan sukses dan bukan alasan retry beli; fence tetap. Jangan menambah unique
  index atau menulis ulang riwayat.
- Pemulihan Premium/Jaspay/SK tetap terpisah (§3.2).

**2C: H4, kelas B.** D1 disetujui owner 21 Nov. Lampiran MAP-3 §4.
- **Floor:** floor admission khusus percobaan terakhir WR dibuktikan dengan pengukuran.
  Angka 24 adalah hipotesis, bukan konstanta yang sudah disetujui.
  - Hitung prefix fresh/inline, stock/non-stock, dan tail notifikasi/replay.
  - Admit sebelum klaim/fence/HTTP, tanpa menaikkan budget global dan tanpa mengubah
    admission SK maupun WR non-final.
  - Pertahankan FIFO. Uji head-of-line deferral dan progres di tick berikutnya.
  - `canSpend` bukan reservasi. Bila meter dipakai paralel, buktikan reservasi nyata atau
    serialkan.
- **C1 (migrasi aditif):** kolom marker durable. Kode lama tetap kompatibel dengan skema
  baru. Belum ada penulis.
- **C2 (aktivasi):**
  - Simpan bukti *settlement-needed* secara atomik bersama CAS kegagalan definitif
    terakhir.
  - Settle item terikat dengan CAS paid/enabled, binding dua arah, dan proteksi
    delivered/sending/manual. Protected, conflict, atau CAS yang kalah bukan "unbound".
  - Fallback ke perilaku order lama hanya bila link benar-benar tidak terikat, dan dicek
    ulang saat menulis. Jangan memindai kegagalan historis.
  - Replay berdasarkan marker dibatasi, tanpa POST, lewat tick WR yang sudah ada, di luar
    seleksi due-purchase.
  - Aggregate memakai algoritme yang sama, tetapi dengan hasil strict: SQL gagal, CAS
    kalah, state sah, dan sibling masih aktif dibedakan. Jangan ACK atau kirim notice
    berdasarkan UPDATE yang errornya ditelan.
  - Kebijakan Retry (keputusan PM berdasarkan delegasi owner): pisahkan *link settlement
    pending* (Retry dipagari) dari *aggregate refresh pending* (tingkat order, Retry tidak
    dipagari).
  - Gunakan ledger notifikasi yang ada.
- **Acceptance:**
  - `it.todo` H4 (`wr-sk-state-machine.test.ts`, satu badan yang diekspansi
    premium/jaspay) menjadi test lulus.
  - Order single-item berakhir identik dengan sekarang.
  - Keranjang campuran tidak ditandai gagal sampai sibling terakhir selesai.
  - Paling banyak satu email gagal sukses terkirim dalam fixture.
  - Tidak ada POST tambahan.
  - Crash setelah link/item/aggregate bisa dipulihkan.
  - Threshold floor−1/floor teruji.
  - Kompatibilitas C1/C2 dan prosedur rollback terbukti sebelum aktivasi.

**Paralelisme fase 2:** 2A dan 2B boleh disiapkan paralel (file berbeda). Commit dan
rilisnya tetap berurutan sesuai gerbang. Kode tick WR di `cron/lite` dan
`cron/operations` dipakai 2C dan dipindah 3A/3C. **Satu pemilik:** selesaikan 2C dulu,
baru 3A job `wr_orders` dan 3C fase `warung_rebahan`, atau sebaliknya dengan rebase dan
verifikasi ulang C2. Jangan dikerjakan bersamaan.

### Fase 3: Pecah hotspot (kelas E)
Lampiran MAP-1. Di §6 tiap target ada struktur folder dan urutan commit.

| Kode | Target | Ukuran | Catatan wajib |
|---|---|---|---|
| 3A | `cron/lite/route.ts` → `src/lib/cron/lite/jobs/*` | M-L | Churn tertinggi, jadi dikerjakan awal. Satu job per commit. Dispatcher tetap `await import()` (§3.6). Publish katalog 4 supplier baru boleh difaktorkan setelah T4 (iii) mengunci asimetrinya. Job `wr_orders`/`sk_orders` mengikuti aturan pemilik tunggal di fase 2. |
| 3B | `orders/route.ts` → `src/lib/orders/checkout/*`, `status-flags.ts`, `detail-view.ts` | M | Prasyarat: T5. 3B adalah **prasyarat F1, bukan sebaliknya**. Sekaligus menyatukan readiness SQL `orders/lookup` ke `status-flags.ts`; respons kedua route tidak berubah (§3.11). Guard order dipertahankan: `price_changed` sebelum `createOrderWithStock`. |
| 3C | `cron/operations/route.ts` → `src/lib/cron/phases/*` | L | Bentuk `OperationsContext` **dibekukan di commit pertama** berdasarkan capture gabungan keenam fase (MAP-1 (b)§2). Urutan: cleanup → fulfillment → notify → expiry → warung_rebahan → sekalipay. `ctx` tidak berubah bentuk setelah commit ke-2. `deferredOut` tetap array dengan insertion order. |
| 3D | WR `sync.ts` → `src/lib/warung-rebahan/sync/*` + barrel | L | Ikuti urutan 7 commit MAP-1 (a)§6 dan §3.9–3.10. Tipe/konstanta leaf-only. Panggilan zero-missing tetap di cabang `sweepComplete`. |
| 3E | `SupplierAdminPanel.tsx` → `src/components/admin/supplier/*` | M (UI) | Dikerjakan **sendiri**, tidak paralel dengan 3C/3D. Writer UI = Sol. Verifikasi browser nyata desktop/mobile per commit. `actionPending` single-flight dibagi lewat context. `supplier-admin-data.ts` tidak disentuh. |

- Helper lintas-file (MAP-1 §Cross-cutting: `parseItems`, writer service-health, cek
  saldo supplier, `drainSupplierPairs`) dikerjakan **setelah** file sumbernya terpecah,
  masing-masing satu commit E.
- Badan `runExpiry`/`runFulfillment`/`runCleanup` di lite dan operations **tidak**
  disatukan karena isinya berbeda.
- Urutan yang disarankan: 3A (selain job WR/SK) dan 3B paralel dengan fase 2; lalu 3C dan
  3D; terakhir 3E.

### Fase 4: Fondasi fitur
Lampiran MAP-4 §7. Setiap F-langkah yang menyentuh skema dimulai dengan migrasi aditif.
Penulis diaktifkan di commit berikutnya, dan kompatibilitas downgrade/read harus diuji.
F1–F3 dan F4–F5 adalah dua jalur independen yang boleh sejajar (file dan skema tidak
beririsan). F6–F7 menunggu F1.

| Kode | Fondasi | Prasyarat | Keputusan |
|---|---|---|---|
| F1 | `placeOrder(actor, lines, paymentInstruction)` lintas kanal. `actor` memuat kanal dan konteks atribusi opsional (`memberId?`, `affiliateMemberId?`) yang ditulis ke kolom F4. Web route (setelah 3B) dan `commerce.ts` (Telegram) menjadi adapter tipis. Games/Pedia menyusul hanya bila fitur membutuhkan. Token quote mengikuti §3.17. | 3B, T5, T7 | D3 |
| F2 | Seam harga `resolveSellPrice({variantId, qty, tier})`. Default retail, sehingga web/Telegram identik. Materialisasi markup saat sync tetap menjadi harga dasar. | F1 (boleh bersamaan) | D2 |
| F3 | Kontrak adapter supplier v2 multi-langkah: `awaiting_event` dengan tenggat, artefak antara terenkripsi, poll/webhook, `cancel()`, dan hook refund ke agregat. **Bukti:** satu supplier fixture multi-langkah (bukan produksi) di test, mencakup `awaiting_event → event → completed` dan `cancel() → refund`, ditambah migrasi satu supplier kecil hasil 2A. Migrasi supplier kecil saja tidak cukup. | 2A | D5 |
| F4 | Identitas member: tabel `members`, kolom aditif nullable `orders.member_id` dan `orders.affiliate_member_id`, sesi terpisah dari admin (§3.14). | — | D4 |
| F5 | Ledger pelanggan append-only: akun, delta bertanda, `balance_after`, idempotency key, dan sumber. Tabel baru, **bukan** generalisasi `pedia_credits`; paket F5 memuat perbandingan kolom dengan `pedia_credits`. Inti ledger tidak diblokir D6/D7; yang diblokir hanya aturan posting komisi dan rail deposit. | F4 | D6, D7 |
| F6 | Kanal `api`: migrasi CHECK `orders.sales_channel` (rebuild tabel SQLite), kontrak kontak pembeli API (`customer_wa NOT NULL`), dan seluruh switch `sales_channel` di fulfillment/notify. | F1 | D3, D9 |
| F7 | API key reseller: tabel sendiri dengan bentuk `agent-auth.ts`, scope, rate limit per key, dan `Idempotency-Key` (§3.15). | F1, F2, F4, F5, F6 | D3, D8 |
| F8 | Registry job cron berbasis data (ditunda). Tetap wajib `await import()` (§3.6). Baru dibuka saat supplier ke-6 masuk. | — | — |

## 7. Tim & routing per jenis paket

Routing mengikuti skill `paseo-orchestrator` dan keputusan owner terbaru. Per 20 Nov,
Hydrogen/Neon sedang dijeda. Routing ini dibaca ulang setiap kali langkah dimulai.

| Jenis paket | Writer | Pemeriksa independen |
|---|---|---|
| T, dan E non-uang yang mekanis | DeepSeek | Wonder (baca-saja) |
| E/B jalur uang (2A–2C, job/fase uang 3A/3C, 3D, F1–F7) | Sol | Wonder; untuk B ditambah repro dari agen kedua |
| UI (3E, panel/dashboard) | Sol (ui-probe tier 1) | Verdict visual PM dan browser nyata |
| Peta/audit sebelum langkah besar | Wonder atau DeepSeek (baca-saja) | PM mengonfirmasi di source |

- Maksimal dua writer aktif bersamaan, dengan area file yang tidak beririsan.
- Maksimal empat agen, termasuk pemeriksa baca-saja.
- Kalau 2A dan 2B berjalan paralel, kedua writer berbagi reviewer yang sama.
- Hanya sesi PM yang commit/push, sesuai AGENTS.md.

## 8. Fitur setelah fondasi (di luar roadmap ini)

Urutan yang disarankan. Masing-masing butuh dokumen issue sendiri dengan PRD singkat:
1. Login member biasa (F4).
2. Program reseller dan dashboard reseller (F2, F4, F5).
3. API key reseller dan dokumentasi API publik (F6, F7).
4. Affiliate (F4, F5; atribusi lewat `actor` di F1).
5. Supplier baru: virtual number (F3), lalu supplier lain di atas kontrak v2.

## 9. Template paket kerja & Definition of Done

**Isi paket (PM → writer):**
- kode langkah dan kelas;
- tujuan;
- file IN dan OUT scope;
- butir §3 yang relevan;
- acceptance criteria per kasus (state → hasil);
- baseline T yang relevan (T1+T2 untuk 2A; T1+T3 untuk 2B; T4 untuk cron; T5 untuk order;
  T6 untuk sync/panel);
- nama file test yang harus lulus;
- orientasi `axgraph affected --depth 1` untuk simbol yang dipindah;
- larangan: commit, push, deploy, akses produksi;
- format laporan ringkas.

**Definition of Done per langkah:**
- [ ] Acceptance criteria dibuktikan oleh test yang lulus, bukan oleh klaim, TODO, atau
      skip.
- [ ] Langkah E: statement count per cabang, urutan panggilan supplier, baris D1 yang
      ditulis, dan JSON respons beserta urutannya identik dengan baseline T yang relevan.
- [ ] Reviewer independen tidak punya temuan blocking, atau temuannya sudah diperbaiki
      dalam paling banyak dua ronde.
- [ ] Verifikasi sesuai tabel dampak AGENTS.md lulus di tree akhir (full suite, tsc,
      workerd/build/browser bila relevan).
- [ ] Test source-text dan kutipan path di `docs/agent-rules/*.md` serta
      `docs/ARCHITECTURE.md` sudah dipindah ke lokasi baru (§3.12).
- [ ] Dokumen terkait dan `CHANGELOG.md` diperbarui.
- [ ] Baris status di §10 diperbarui: commit, tanggal, dan status lokal / push / deploy.

## 10. Status

Nilai status: `belum` / `lokal <sha>` / `push <sha>` / `deploy ✓ <sha>`.

| Kode | Kelas | Status | Catatan |
|---|---|---|---|
| Fase 0 | T/B | deploy ✓ `6ae08195`; push `ad711d6f` | 21 Nov |
| T1 | T | lokal (WR/SK `f3fd8cca`, supplier kecil commit T2) | Premium sukses 5 stmt (6 invite) di luar scan; angka Jaspay 29 khusus fixture, bukan batas umum |
| T2 | T | lokal | Terukur: create 2/2/2/3, process sukses 21/21/21/23, retryable 18/18/18/23, retry sukses 13/13/13/14, retry retryable 10/10/10/14 (menggantikan angka MAP-2). TUNVN menyelesaikan receipt terlambat pada lease kedaluwarsa pemilik sama = perilaku sah (§3.3), A4 tidak boleh menyamakan. Total TUNVN 23 memakai notify-buyer asli: perubahan notify bisa mengubahnya |
| T3 | T | lokal | 33 `it.fails` untuk B3b/B4b/B5/2C |
| T4 | T | lokal | 72 kunci + urutan; sebelum 3A masih wajib T4b |
| T4b | T | lokal (commit T4b); nit: drain-swallow belum assert drain dipanggil, `synced>=1` | Sisa gap sebelum 3A (review Wonder): asimetri drain `games_catalog`, isolasi kegagalan budget `drainDirtyGroupsIfBudget`, `applyOnly` saat budget habis |
| T5 | T | lokal (commit T5/T7) | Wonder APPROVE-WITH-NITS; race diperkuat barrier dua-kedatangan |
| T6 | T | lokal | |
| T7 | T | lokal (commit T5/T7) | |
| A1 AIVault | E | lokal (commit A1) | Wonder APPROVE |
| A2 Mirai | E | lokal (commit A2) | Wonder APPROVE |
| A3 StoreBat | E | lokal (commit A3) | Wonder APPROVE. Catatan: bila kelak predikat JS disatukan, bentuk ketat `=== 0` adalah kanonis dan itu perubahan kelas B |
| A4 TUNVN | E | lokal (commit A4) | Wonder APPROVE |
| B1 | E | lokal (commit B1) | Wonder APPROVE-WITH-NITS; rank status tetap lokal (di deliver.ts) |
| B2 | E | lokal (commit B2) | Wonder APPROVE. Tindak lanjut E kecil: fence menerima `db`, bukan `execRun` terlepas |
| B2b (invoice kosong) | B | lokal (commit B2b) | Premium + Jaspay; Sol repro + Wonder APPROVE |
| B3 | E | lokal (commit B3) | Wonder APPROVE |
| B3b (R1) | B | lokal (commit B3b) | Sol repro + Wonder APPROVE; expected-fail 33→29 |
| B4 | E | lokal (commit B4, 22 Nov) | Rank dan CAS invoice/status bersama; pelepasan lease tetap khusus SK; B4b terpisah |
| B4b (lease WR) | B | belum | |
| B5 (R2) | B | belum | |
| C1 (H4 migrasi) | B | belum | D1 disetujui |
| C2 (H4 aktivasi) | B | belum | D1 disetujui |
| 3A | E | 3A-1, 3A-2a promo, 3A-2b cleanup, 3A-3 notify, 3A-4a supplier kecil, 3A-4b Pedia lokal | Modul job baru tidak menambah import runtime selain yang sudah dimuat route; payments, expiry, fulfillment, WR/SK dan katalog masih inline |
| 3B | E | 3B-1..3B-4 lokal (GET flags/detail-view; respons POST; guard; metode) | 3B-4: fixture baru mengunci retry crypto tanpa baca snapshot pasar; berikutnya `create.ts` + `invoice.ts` |
| 3C | E | 3C-1, 3C-2 lokal (phase-state, catalog-sweep, OperationsContext beku) | Wonder APPROVE; berikutnya satu fase per commit |
| 3D | E | 3D-1, 3D-2 lokal (types/constants/writes; pricing/exclusion) | 3D-1 Wonder APPROVE; 3D-2 Spark APPROVE-WITH-NITS |
| 3E | E (UI) | belum | |
| F1–F7 | E/B | belum | menunggu konfirmasi D2–D9 |
| F8 | — | ditunda | |

## 11. Keputusan owner

**Sudah diputuskan:**
- 21 Nov: refactor dimulai segera, dengan ritme "cepat tapi hati-hati" lewat audit
  paralel, verifikasi silang, dan review independen.
- 21 Nov: FX-20 H1 boleh diperbaiki asal terbukti aman. Selesai di `ad711d6f`.
- 21 Nov: fitur yang akan datang adalah member, reseller dan dashboard-nya, API key
  reseller, affiliate, dan supplier baru (virtual number, dll).
- 21 Nov, **D1 disetujui:** percobaan terakhir WR boleh ditunda ke tick berikutnya bila sisa
  budget kurang dari floor (angkanya dari pengukuran), ditambah kolom marker durable
  aditif. Kebijakan Retry di 2C diputuskan PM: settlement link dipagari, aggregate tidak.
- 21 Nov malam: owner menyetujui semua langkah dan mengikuti rekomendasi PM. Kerja malam
  hanya lokal; push setelah owner mengetik "gas push" (§4, mode malam).

**Rekomendasi PM untuk D2–D9.** Owner sudah mendelegasikan keputusan ke rekomendasi PM.
Butir ini tetap **dikonfirmasi ulang sebelum F-langkahnya dimulai**, karena menyangkut
skema, uang, dan produk.

| Kode | Pertanyaan | Rekomendasi PM | Memblokir |
|---|---|---|---|
| D2 | Model harga reseller | Diskon % dari harga retail per tier reseller. Harga modal tidak pernah terlihat di API/dashboard. | F2 |
| D3 | Pembayaran via API | Potong saldo deposit (prepaid ledger). QRIS per order tidak dipakai untuk API. | F1, F6, F7 |
| D4 | Login member | Email OTP (kode sekali pakai lewat Resend). Checkout tamu tetap ada. | F4 |
| D5 | Virtual number | Hanya untuk member dengan saldo. Batal diizinkan sebelum OTP masuk. Bila OTP tidak datang sampai tenggat supplier, refund otomatis ke saldo member. | F3 |
| D6 | Komisi affiliate | Dihitung saat order terkirim (delivered). Masa tahan 7 hari sebelum bisa dicairkan. Payout manual oleh admin pada tahap awal. | F5 |
| D7 | Top-up saldo | Lewat rail yang sudah ada (QRIS GoPay/KlikQRIS dan Sekalipay gateway). Crypto menyusul. | F5 |
| D8 | Scope dan rate API key | Scope `catalog:read`, `orders:write`, `orders:read`, `balance:read`. Batas 60 req/menit per key, pembuatan order 10/menit. IP allowlist opsional. | F7 |
| D9 | Kontak pembeli via API | Default kontak akun reseller. Email pembeli akhir opsional untuk pengiriman kredensial. | F6 |

## 12. Risiko utama dan penjaganya

| Risiko | Penjaga |
|---|---|
| Pembelian ganda setelah ekstraksi helper klaim/fence | Characterization, matriks transport H1 dan wire (T3), reviewer mengecek §3.1–3.3 |
| Statement atau baris D1 tambahan "tak berbahaya" mengubah admission atau kuota | Baseline T1/T2/T4 di-assert; §3.5, §3.10d |
| Zero-missing katalog salah tempat, sehingga varian ter-nol-kan | §3.10a dan T6 (i) |
| Test atau dokumen diam-diam berhenti menjaga setelah file dipindah | §3.12 dan checklist DoD |
| Konflik di `cron/lite` (churn tertinggi) | Satu job per commit, 3A dikerjakan awal, pemilik tunggal untuk tick WR |
| Link macet atau tulisan parsial pada H4 | Floor terukur, marker durable, replay tanpa POST, aggregate strict (2C) |
| Banyak commit lokal masuk dalam satu push (mode malam) | Commit per langkah, review terintegrasi, full suite, workerd, dan build sebelum "gas push" |
| Fondasi dibangun di atas desain yang belum dikonfirmasi | F-langkah menunggu konfirmasi D2–D9 |
| Agent menyimpang dari scope | Dokumen ini, paket dengan scope IN/OUT, review independen |

## Lampiran
- `issue/refactor-2026-11/MAP-1-hotspots.md`: peta 5 hotspot. Catatan: klaim "40 file test
  mengimpor `orders/route.ts`" di sana salah. Angka yang benar: 27 file mengimpor, 39 file
  membaca sebagai teks.
- `issue/refactor-2026-11/MAP-2-small-suppliers.md`: duplikasi 4 supplier kecil dan
  rancangan helper.
- `issue/refactor-2026-11/MAP-3-wr-sk.md`: state machine WR/SK, budget statement, desain H4.
- `issue/refactor-2026-11/MAP-4-feature-readiness.md`: kesiapan fondasi fitur baru.
- `issue/refactor-2026-11/PLAN-review-{W,S,D}.md`: tiga review independen atas draf ini.
- `issue/2026-11-21-wr-sk-state-machine-map.md`, `issue/2026-11-21-small-suppliers-claim-map.md`:
  peta cakupan test characterization.
- `issue/2026-11-21-audit-followups.md`: tindak lanjut audit dan bug terbuka.
