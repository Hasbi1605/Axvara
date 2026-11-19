# Aturan agent — Supplier TUNVN PREHUB (reseller Telegram)

## Aktivasi satu saklar varian — keputusan owner opsi B, 19 November 2026 (lokal)

- TUNVN mengikuti AIVault, StoreBat, dan Mirai: panel supplier memakai `product_variants.is_active` saja sebagai saklar varian; status induk dikelola dari menu Produk. Varian hanya terlihat bila aktif, induk aktif, dan induk tidak diarsipkan. `tunvn_products.visible` mencerminkan status ini, bukan gerbang terpisah. Produk/varian baru tetap nonaktif; sinkronisasi tidak mengaktifkan apa pun.
- Migrasi `0142_tunvn_single_key_activation.sql` melepas trigger `tunvn_variant_publication`, menonaktifkan hanya varian akun aktif yang mirror-nya tidak menyatakan pernah diminta terbit (termasuk mirror hilang dan #60), lalu menghitung ulang `visible`. Migrasi tidak pernah mengaktifkan apa pun atau mengubah status induk. Kolom `publish_requested` dipertahankan untuk kompatibilitas skema, tetapi tidak lagi dibaca/ditulis backend setelah migrasi.
- `PATCH /api/admin/tunvn/products/[id]` hanya menerima `is_active` untuk aktivasi; `axvara_is_active` dan `publish_requested` ditolak. #60 tetap dikecualikan, varian belum dipetakan tidak bisa diaktifkan, dan induk Arsip harus dipulihkan dulu.
- UI lokal U3 mengganti tab Katalog lama dengan panel Ringkas · Antrean · Markup · Alat bersama. Deskripsi supplier tetap terlipat di baris Markup dan bukan copy pembeli. Buff tetap di Markup; Periksa status tetap di Antrean dan hanya membaca batch yang telah diketahui. #60 tidak muncul di daftar atau hitungan panel.

## Retry katalog akun pasca-audit — 19 November 2026 (lokal)

- Lease dan throttle akun yang sukses tetap 45 detik; kegagalan akun memperpendek klaim miliknya menjadi 10 detik setelah gagal. Error D1 menyimpan kelas kegagalan, bukan body/secret. Backoff probe Buff tetap tiga menit dan terpisah dari heartbeat akun.

## Probe orphan eligible F5a — 18 November 2026 (lokal)

`processTunvnOrders` menyeleksi hanya apps lunas/paid non-disable dari
web/Telegram, dengan snapshot baris eligible tanpa link sebelum LIMIT1.
JSON rusak, scalar, ID/qty/cost invalid, akun#60/unique, atau konfigurasi/kode
Buff invalid tidak boleh menghalangi orphan valid yang lebih muda. SQL memakai
snapshot server dengan ID akun numerik; validasi JS/sent-fence/receipt,
satu link/run dan budget40 existing tetap. Test fixture + native D1 lokal;
tidak ada transaksi/env/migrasi atau deployment produksi.

## Penanda sukses katalog, error saldo beruntun, & watchdog basi — 18 November 2026 (lokal)

- `publishTunvnCatalog` mencatat `tunvn_catalog_success_at` setelah mirror dan proyeksi akun, termasuk recompute, selesai. Gangguan Muse Buff tidak memblokir heartbeat akun/drain grup cron dan bukan bukti stok berubah. Gangguan `/api/products`, FX, atau proyeksi akun tetap gagal seperti sebelumnya. `/api/admin/tunvn/products` mengutamakan penanda sukses akun.
- Probe Buff tanpa debit: `tunvn_buff_sync_at` hanya maju setelah probe valid dan proyeksi selesai; `tunvn_buff_last_error` menyimpan alasan tersanitasi (mis. `buff_ambiguous:http_502`). Sesudah gagal, cron tetap mempertahankan snapshot Buff dan menunggu 3 menit sebelum probe lagi; force admin boleh bypass dan tetap menampilkan kegagalan Buff. Tidak mengubah saklar/guard pembelian.
- Watchdog cleanup dan Ringkasan Harian memisahkan `TUNVN (Muse Buff)` dari akun (ambang 15 menit masing-masing, grace 1 jam bila belum pernah sukses). `checkTunvnLowBalance` tetap mencatat `tunvn_balance_error` `{ at, error, streak }` saat gagal beruntun dan `tunvn_balance_last_ok_at` saat sukses.

## Sinkronisasi katalog 1 menit + throttle probe Buff 3 menit — 17 November 2026 (lokal)

- `mcp-worker/src/cron.ts` menjalankan `lite:tunvn_catalog` setiap 1 menit (menghapus `everyMinutes: 3`), budget tetap 40 tanpa env/trigger baru.
- `src/lib/tunvn/sync.ts`: `TUNVN_CATALOG_MIN_INTERVAL_MS` diturunkan dari `120_000` menjadi `45_000` (45 detik) agar tick 1 menit toleran jitter.
- `src/lib/tunvn/catalog.ts`: `tunvn_catalog_lease` diturunkan dari `90_000` menjadi `45_000` ms (`now + 45_000`). Pada mode cron (`opts.force` false), probe `checkTunvnBuff(1)` (`/api/buff/check`) dibatasi via `store_settings.tunvn_buff_sync_at` (`TUNVN_BUFF_MIN_INTERVAL_MS = 180_000` ms / 3 menit), kecuali saat `opts.force === true`, varian `TUNVN-BUFF-1B` belum ada/modal kosong, atau `now - lastBuffSync >= 180_000`. Jika probe dithrottle setelah sukses, harga `TUNVN-BUFF-1B` tetap dihitung ulang dari `tunvn_cost_usdt`, `tunvn_markup_percent`, `tunvn_admin_price_idr`, dan `idrPerUsdt` segar tanpa memanggil `/api/buff/check` serta mempertahankan `stock` tersimpan.
- `POST /api/cron/lite?job=tunvn_catalog` yang sukses langsung menjalankan `drainDirtyGroupsIfBudget(db, result)` bila `db.canSpend(4)`. Implementasi lokal + test; publikasi melalui CI.

## Sync katalog gagal karena trigger grup — 17 November 2026 (fix lokal)

- Sejak 2026-11-17 11:10 UTC setiap `tunvn_catalog` gagal 500 `UNIQUE
  constraint failed: product_group_dirty.group_id`: harga #83 berubah saat
  produk 117 sudah anggota grup ChatGPT Plus (37), trigger `pg_dirty_tunvn_update`
  (`INSERT OR REPLACE`) terpicu dari UPSERT mirror dan dipaksa ABORT. Mirror +
  stok seluruh produk TUNVN membeku (checkpoint throttle tetap maju karena klaim
  ditulis sebelum fetch). Upstream sendiri sehat (#83 stok14).
- Fix: migrasi `0132_product_group_dirty_upsert.sql` (lihat ARCHITECTURE grup
  produk). Percepatan interval sync tidak menolong kegagalan semacam ini; cek
  respons `/api/cron/lite?job=tunvn_catalog` dan `tunvn_products.synced_at`.

## Pengingat saldo rendah Telegram admin — 17 November 2026 (lokal)

- `checkSupplierLowBalance` (`src/lib/supplier-balance-alert.ts`) dijalankan di
  akhir cron lite `tunvn_orders` hanya saat `isTunvnConfigured()` dan
  `db.canSpend(5)`, tanpa menambah trigger cron/env Pages baru.
- Checkpoint `store_settings.tunvn_balance_checked_at` ditulis sebelum
  `fetchTunvnBalance()` (maks 1×/30 menit); gagal/non-`ok` mencatat
  `tunvn_balance_error` tanpa alert.
- Ambang opsional `TUNVN_BALANCE_ALERT_USDT` (default `5`, finite `>= 0`;
  tidak dipasang ke Pages), langkah penurunan `1` USDT, format
  `💰 <b>Saldo TUNVN menipis</b>`. Throttle CAS 6 jam atau turun `>= 1` USDT
  via `store_settings.tunvn_balance_alert_at` (`amount|ms`); mengirim ke
  `TELEGRAM_ADMIN_CHAT_ID` hanya saat `TELEGRAM_BOT_ENABLED=true`.

## Kurs modal dibekukan per link — 16 November 2026 (lokal)

Migrasi0130 menambah `tunvn_order_links.fx_idr_per_usdt`; backfill sekali dari
kurs katalog/varian Buff lalu fallback snapshot D1 yang tersedia. Link baru
menyimpan kurs saat dibuat. Laporan memakai kurs link terlebih dahulu; rantai
katalog/snapshot lama hanya fallback bila NULL. Ini mengganti aturan kurs
katalog dinamis pada bagian Ringkasan di bawah, bukan harga jual atau dispatch.
Belum merupakan bukti migrasi/deployment produksi.

## Grup produk lintas supplier —16 November2026

TUNVN dapat menjadi anggota grup2–10 bersama WR/SK/AIVault/Manual dari admin
Supplier→Grup produk. Tidak dibuat grup TUNVN otomatis. Nonaktif/Arsip selalu
kalah; Manual live menang, lalu stok→modal per30hari→prefer dalam margin.
Modal akun `price_usdt × fx_idr_per_usdt`, Buff `tunvn_cost_usdt ×
tunvn_fx_idr_per_usdt`, fallback snapshot D1id1; durasi day/month/year dinormalisasi,
lifetime/custom/NULL tidak. Mirror/FX/varian menandai antrean grup. Keputusan
katalog tidak memindahkan supplier/order historis atau menambah retry pembelian.
Migrasi0129/kode/QA lokal; publikasi CI, deployment belum terverifikasi.
Kontrak lengkap: ARCHITECTURE “Grup produk lintas supplier”.


## Pengiriman langsung setelah Retry/pembelian — 16 November 2026 (lokal)

- Retry admin yang menghasilkan link `completed` langsung menjalankan
  `ensureFulfillmentForPaidOrder` (email/WA/Telegram kredensial di request yang sama);
  jalur bayar baru menjalankan delivery lagi setelah pembelian TUNVN order itu.
  Cron tetap backstop; jangan menambah delivery tak berbudget di route cron lite.
  Detail ARCHITECTURE §16.35a.

## Modal di Ringkasan admin — 16 November 2026 (lokal)

- `financialReportSql` (`src/lib/dashboard-report.ts`) kini punya bucket supplier
  `tunvn` sendiri, bukan `manual`. Baris dikenali TUNVN bila ada
  `tunvn_order_links` untuk `(order_code,item_index)`, item punya
  `tunvn_eligibility`, atau `product_variants.sku LIKE 'TUNVN-%'`; hanya bila
  baris bukan Pedia dan tidak terikat link WR/SK.
- Modal = `ROUND(cost_usdt × fx)`. Sumber cost berurutan: link (total per baris,
  TIDAK dikali qty lagi) → snapshot eligibility → harga katalog terkini (akun
  `price_usdt`; Buff `tunvn_cost_usdt`) × qty. Disimpan sebagai `own_cost` dengan
  `cost_pool` NULL agar alokasi existing tidak berubah.
- Kurs = `tunvn_products.fx_idr_per_usdt` (Buff: `pv.tunvn_fx_idr_per_usdt`),
  fallback `crypto_market_snapshot.fx_rate_text`. Ini kurs katalog terakhir, bukan
  kurs persis saat order. `estimated` true bila link tidak ada/`status !=
  'completed'` atau kurs tidak tersedia.
- Tanpa migrasi D1; batas compound SELECT (<5) dan referensi `facts`/`scoped`
  tetap. `PeriodReport.suppliers`, `profit_by_supplier` overview, label ekspor,
  dan baris UI Ringkasan ikut ditambah `tunvn` (opsional untuk payload cache lama).
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
- TUNVN: PATCH produk/Buff menormalkan `admin_price_idr: 0` → NULL (ikut rumus);
  PATCH Buff kini menghitung ulang `products.price/stock` induk dalam satu batch.
  Tab ke-2 panel bernama **Katalog** (permintaan terbit + saklar produk induk);
  nama/deskripsi/label diatur dari menu Produk. #60 disembunyikan dari panel.
  VND tidak ditampilkan. Deskripsi supplier mentah tampil terlipat di Katalog
  sebagai rujukan admin, bukan untuk pembeli.
- Migrasi `0127_supplier_copy_id_en.sql`: deskripsi produk ID/EN 13 family (hanya
  menimpa template `tunvnDefaultDescription`; produk owner Muse tidak disentuh)
  dan S&K + cara aktivasi ID/EN 25 varian `TUNVN-*` (hanya bila kosong). Link
  pihak ketiga memakai shortlink `axvara.tech/go/*`: existing `otp-generator`,
  `otp-2fa`, `grok-web`; baru `claude-api`, `claude-api-docs`, `mail-fvia`,
  `mail-dongvan`, `muse-login`. Parser S&K kini mengenali judul EN (Package
  details/Process & delivery/Usage rules/Warranty). Gemini #115 meniru varian
  manual Gemini Plus 6 Bulan (hold link 1 jam), bukan garansi 24 jam supplier.
- Migrasi `0128_supplier_copy_followup.sql` mengosongkan harga manual Buff
  `TUNVN-BUFF-1B` yang terkunci 1500 (hanya bila masih 1500); cron
  `tunvn_catalog` tiap 3 menit menghitung ulang harga dari rumus.

## Arsip Produk — keputusan owner 15 November 2026 (lokal)

`products.archived_at` (migrasi0126) memisahkan Arsip dari Nonaktif. Identitas
supplier parent/varian dan relasi histori tetap disimpan: lookup sync tidak
boleh mengecualikan Arsip lalu membuat pengganti. Penulisan katalog, varian
baru, proyeksi harga/stok, aktivasi dan restock melewati parent Arsip; mirror
supplier boleh terus sinkron. Panel/editor mengembalikan409 “Pulihkan dari
Arsip dulu” saat aktivasi. Pulihkan tetap nonaktif; produk supplier tidak pernah
eligible hapus permanen. Lihat PRD “Siklus Arsip Produk” dan ARCHITECTURE “Arsip
Produk admin”. Implementasi/migrasi baru lokal; tanpa perubahan produksi.

## Revisi owner 15 November 2026: semua produk TUNVN masuk katalog (lokal)

- Owner memutuskan SELURUH produk mirror `tunvn_products` (kecuali #60 API TEST,
  dikecualikan permanen) menjadi produk katalog AXVARA di menu admin "Produk",
  pola WR/SK. Produk serupa dikelompokkan sebagai varian satu produk induk
  ("family") lewat peta statis `src/lib/tunvn/families.ts`; id tak terpetakan
  memakai fallback 1:1 `slugify(nama)+"-tunvn"` (collision-safe).
- Semua produk/varian BARU dibuat `is_active=0`. Sync tidak pernah mengaktifkan
  apa pun; admin mengaktifkan dari menu Produk (saklar produk/varian) atau panel
  TUNVN (saklar varian). Nama/deskripsi/gambar/kategori ditulis SEKALI saat
  produk dibuat, lalu milik admin — publish tidak menimpanya.
- Markup default 35% (`tunvn_products.markup_percent`); harga manual admin
  (`tunvn_admin_price_idr`) selalu menang. Gambar disalin dari produk kandidat
  (`imageFromSlugs`) saat pembuatan; ChatGPT memakai aset `f87f491e…webp` yang
  sudah disetujui.
- Identitas durable baru: `products.tunvn_family` + `product_variants.
  tunvn_source_product_id` (migrasi `0123_tunvn_full_catalog.sql`). Eligibility
  dan dispatch akun memakai SKU `TUNVN-{id}` + kolom tersebut, BUKAN slug —
  menggantikan pengecekan `chatgpt-tunvn`/83/86 di kode lama. #60 tetap ditolak
  di eligibility, purchase, publisher, dan panel.
- Muse: produk owner `muse-ai-1-miliar-token` tidak berubah nama/deskripsi/
  gambar/status dan TIDAK diberi `tunvn_family`; lima varian akun baru menempel
  nonaktif. Buff (`TUNVN-BUFF-1B`) tetap perilaku lama (markup 40%, probe tanpa
  charge).
- Panel TUNVN: GET products mengembalikan join varian/family + hitungan
  (`mapped`, `active_variants`); PATCH `/products/[id]` menerima markup,
  harga manual, label, `is_active` varian (menyetel `publish_requested`) untuk
  SEMUA id terpetakan, 409 bila varian belum ada. Tab Markup menampilkan kartu
  per family; `load()` memakai `Promise.allSettled` dan pesan error menyebut
  bagian + status HTTP (error panel "Permintaan gagal" kini menyebut bagian +
  HTTP; penyebab produksi belum dipastikan).
- Dispatch otomatis: `eligibleTunvnLine` menerima sumber id akun positif apa pun
  selain 60; validasi varian dan send-fence mencocokkan
  `tunvn_source_product_id`. Buff tidak berubah. Tidak ada pembelian/transaksi
  untuk QA.
- Pembersihan produksi 15 Nov 2026 (owner): produk sisa
  `chatgpt-gpay-1-bulan-tunvn` (id118, nonaktif, 0 varian, 0 order, tanpa
  referensi FK) DIHAPUS dari D1 lewat DELETE bersyarat; digantikan ChatGPT
  Private #117. Produk bernama sama lintas supplier (WR/SK/TUNVN/AIVault) sengaja
  TIDAK dihapus — dibedakan lewat badge/filter; menghapus produk family TUNVN/
  AIVault akan dibuat ulang sync, jadi butuh daftar abaikan bila kelak diminta.
  Varian bundle Buff 5/10/20/30B tetap arsip.
- Status: implementasi lokal + test; belum publikasi, migrasi remote,
  deployment, atau transaksi produksi. Detail teknis di ARCHITECTURE §16.43.

## Publikasi gabungan 11 November 2026

- Owner mengizinkan satu commit/push recovery yang sudah direview langsung bersama
  fix Ringkasan, tanpa subagent. Batas24jam, larangan rebuy ambigu dan dua order
  manual tetap; bukan izin transaksi/deposit/notifikasi produksi. ARCHITECTURE16.39.

## Recovery otomatis terbatas 10 November 2026 (snapshot lokal sebelum publikasi gabungan)

- Menggantikan retry-admin-only di bawah hanya untuk whitelist pra-send yang lolos
  TUNVN_RETRYABLE_SQL dan orders.created_at <24jam: cron boleh mencoba3menit kemudian.
  dispatch_unconfirmed tanpa receipt tetap tidak auto-retry; order tua perlu admin.
- dispatch_unconfirmed dengan receipt ciphertext/IV/HTTP status boleh diproses ulang
  lokal tanpa POST pembelian. Buff timeout/invalid JSON/429/5xx/success false tetap
  processing dan polling, bukan rebuy. Paid/disable/ownership/budget40 tetap wajib.
- Dua order manual owner tetap dikecualikan. Tidak ada mutasi/notifikasi/transaksi
  produksi, schema/env/proxy/cron baru. Bukti dan batas di ARCHITECTURE16.38.

## Revisi owner 10 November 2026: modal dinamis tanpa ceiling snapshot (lokal)

- Hapus penolakan dispatch/retry hanya karena modal aktual naik dari snapshot;
  berlaku akun dan Buff. Snapshot biaya tetap immutable untuk histori, bukan cap.
- Harga katalog naik/turun dari modal x FX x markup admin melalui sync3menit
  existing (override harga manual tetap). Total order yang sudah dibuat/dibayar
  tidak dihitung ulang; margin order tersebut dapat berbeda dari target markup.
- Preflight tetap memvalidasi harga positif/finite, saldo terhadap harga aktual,
  stok/fundable, identitas, disable, lease dan fence anti-pembelian ganda. Harga
  tidak valid menjadi catalog_unavailable/buff_unavailable, bukan cost_changed.
- Order historis cost_changed dapat Retry admin existing memakai harga terkini,
  hanya pra-send yang lolos CAS; tidak auto-replay, reset fence atau mutasi produksi.
  Dua order manual owner tetap dikecualikan. Publikasi CI, belum bukti deployment.

## Notifikasi proses dan label otomatis — 10 November 2026 (lokal)

- Email proses web hanya sesudah receipt akun lengkap/batch Buff diterima; ID/EN
  mengikuti order.locale, dedupe ledger order/link existing. Buff gagal kirim
  dicoba saat poll berikutnya, tidak membeli ulang. Disable/terminal/unpaid atau
  item delivered/sending disuppress; dua order manual owner tidak di-backfill.
- Tidak mengirim invite code, provider ID, supplier, PIN/password pada notis ini.
  Telegram tetap paid DM existing tanpa tambahan notis proses; aturan wajib-email
  tetap. Tidak mengaktifkan WA, ChatGPT atau bundle retired untuk QA.
- Katalog current eligible memakai marker server `automatic_delivery`; quote,
  paid profile Telegram dan status/lacak tidak menyebut MBO untuk otomatisasi sah.
  EN "Automatic delivery", ETA tanpa janji instan. Muse account asli tetap manual.
  Status memakai snapshot versi1 berbiaya/non-disable, bukan backfill snapshot lama.
- Editor TUNVN menjelaskan otomatis dan tidak menawarkan inventory stok lokal;
  mode DB manual tetap. Tidak mengubah send fence/lease/receipt/harga/aktivasi/env.
  Detail ARCHITECTURE16.36; fixture bukan bukti email/deployment produksi.

## Revisi owner 10 November 2026: retry pra-beli dan dua order manual

- Jangan proses/retry `AXV-20261110-81C2FADA` atau `AXV-20261110-9C9B8FF4`:
  owner menangani sendiri melalui Telegram TUNVN. D1 keduanya sudah diberi
  `supplier_purchase_disabled=1`; hanya flag dan updated_at diubah, bukan status
  pengiriman, receipt, fence, notifikasi atau pembelian. Readback attempt0/sendNULL.
- Perbaikan lokal: kegagalan preflight memiliki alasan aman terpisah; saldo
  terkonfirmasi kurang = `insufficient_balance`, gagal baca saldo bukan saldo0.
  Error generik historis tidak membuktikan penyebab saldo kurang.
- Admin Pesanan dan panel TUNVN menampilkan penyebab + Retry hanya jika SQL CAS
  membuktikan needs_admin/attempt0/tanpa send, receipt, provider ID atau completion,
  lease tidak aktif, paid eligible dan item belum dikirim/dimiliki supplier lain.
  Legacy dispatch_unconfirmed boleh hanya dengan bukti pra-kirim yang sama.
- Retry authenticated memakai endpoint existing dan preflight harga/saldo aktual;
  snapshot biaya tetap histori tanpa ceiling (revisi owner di atas). Tanpa reset
  fence/receipt/counter atau replay HTTP409/timeout pembelian.
  Klaim handover manual menolak pending/claimed/processing agar tidak balapan retry.
  Disable pembelian tetap mengalahkan retry/cron dan UI menyebut penanganan manual.
- Tidak menjalankan dua order produksi sebagai QA. Tes SQLite/workerd dan browser
  fixture bukan bukti transaksi supplier atau deployment; tanpa env/migrasi baru.

## Revisi owner 10 November 2026: S&K dan penggunaan Buff versi AXVARA

- Copy ID/EN varian279 `TUNVN-BUFF-1B` diisi melalui kolom `admin_terms` /
  `admin_activation` (+ EN), fingerprint non-WR/SK kosong. Jangan menimpa
  copy/garansi akun Muse asli248; sync katalog tetap mempertahankan override.
- Rujukan PRD bagian Copy Buff Muse: Invite friends, kode6 case-preserving,
  jumlah1..30, satu kode/checkout, kolom Kode Invite Muse, Lacak Pesanan dan
  dukungan AXVARA. Tidak menyalin promo30B, harga/saldo USDT, daftar kode atau
  perintah bot supplier; tidak mengarang SLA/refund/garansi/masa berlaku token.
- Harga, stok, saklar aktif dan ChatGPT tidak diubah dalam pengisian copy.

## Revisi owner 10 November 2026: aktifkan hanya Buff Muse (produksi)

- Owner mengizinkan hanya `TUNVN-BUFF-1B` aktif; ChatGPT Business/GPay tetap
  nonaktif sampai instruksi berikutnya. Bundle5/10/20/30B tetap nonaktif dan
  akun Muse asli tidak diubah. Keputusan ini mengganti batas nonaktif Buff1B.
- D1 varian279 pada produk112 diaktifkan, agregat parent Muse dihitung ulang;
  harga/modal/markup/stok varian tidak diubah. Snapshot Rp1.500/unit, qty1..30,
  preset `muse_invite_code`, stok-1 = layanan, bukan stok token fisik.
- Terverifikasi GET katalog publik Muse200 memuat hanya varian248+279,
  Buff aktif dengan preset/max_qty; ChatGPT Private404. Probe tanpa charge
  `AXVARA 1` mendapat HTTP502, snapshot dipertahankan. Bukan bukti supplier sehat,
  saldo cukup, fulfillment berhasil, atau cron auto-sync sudah terdeploy.
- Tanpa invoice/pembelian/notifikasi eksternal, perubahan env atau deploy manual.

## Revisi owner 10 November 2026: cron katalog otomatis (lokal)

- Job `tunvn_catalog` terpisah dari order, Worker existing setiap3menit/budget40;
  gate/env existing, FX segar wajib. Berlaku melalui CI, belum bukti live.
- Mirror stok/modal ChatGPT dan proyeksi jual diperbarui; Buff memakai probe
  tanpa charge `AXVARA 1` dengan validasi breakdown tepat, bukan harga statis atau
  membagi probe20B. Fundable false stok0, true -1. API gagal bukan stoknol:
  snapshot terakhir tetap, run503/health tidak dicatat sukses.
- Copy/saklar/harga override/markup admin dan akun Muse asli tetap milik admin;
  tidak aktifkan produk/bundle. CAS melindungi harga manual yang diedit saat sync.
- Lease90detik via store_settings mencegah publikasi tumpang tindih; guard order
  TUNVN web/Telegram menolak saat lease aktif untuk menghindari snapshot separuh.
  Error katalog invalid/kosong dan budget tidak cukup tidak memulai sweep parsial.
- Tanpa secret/env/migrasi/VPS/trigger baru atau pembelian untuk QA. Jangan klaim
  realtime instan; nilai masih dapat berubah antar tick, preflight paid tetap.

## Revisi owner 10 November 2026: hapus bundle Buff lama dari editor

- Hanya Buff per1B yang ditawarkan; bundle5/10/20/30B tidak muncul lagi pada
  kedua endpoint daftar varian editor admin. Akun Muse asli tetap tersedia.
- ID/baris bundle nonaktif tetap arsip demi FK dan snapshot pesanan historis;
  jangan hapus fisik, aktifkan ulang, atau mengubah status Buff1B dalam cleanup.
- Filter hanya empat SKU retired, bukan semua varian nonaktif. Tanpa migrasi
  atau mutasi produksi; publikasi lewat CI, deployment belum diverifikasi.

## Revisi 10 November 2026: T2B dispatch (implementasi LOKAL, belum publikasi)

- Migrasi0116 menambah `tunvn_order_links` UNIQUE(order_code,item_index), lease
  CAS90detik, fence `request_sent_at`, receipt terenkripsi dan link item;
  `orders.supplier_purchase_disabled=1` untuk invoice tes admin. Hanya paid
  Market web/Telegram dan opt-in versi1 baru dengan snapshot `cost_usdt` total
  positif yang boleh membeli. Stamp lama tanpa biaya tidak di-backfill.
- Factory web/Telegram mengikat biaya sumber/config atomik; preflight enkripsi,
  identitas aktif, stok, harga, fundable dan saldo USDT sebelum POST. Biaya
  tersimpan di link, bukan rebuild `order_item_costs`. API tidak mendukung
  max_price/idempotency; race harga/saldo sesudah preflight tetap mungkin.
- Fence disimpan sebelum fetch, tanpa retry transport. Timeout/body rusak/5xx/
  receipt hilang menjadi needs_admin, bukan pembelian kedua/refund/deposit.
  Docs resmi hanya memberi uraian409, bukan payload/kode mesin yang tepat:
  **409 juga needs_admin, nol replay otomatis** sampai kontrak no-charge dapat
  diverifikasi (tetap di bawah ceiling3; jangan menebak pesan Inggris/Vietnam).
- Semua response pembelian yang terbaca disegel utuh sebelum parsing, termasuk
  parsial/bonus/error; raw plaintext tidak disimpan atau dilog. Receipt lengkap
  sejumlah dibeli masuk snapshot fulfillment terenkripsi/pipeline email PIN6,
  c1 dan Telegram privat existing. Parsial needs_admin; ekstra tetap terenkripsi
  hanya admin, bukan kebijakan bonus pembeli baru. Receipt durable dapat diproses
  ulang tanpa POST. Key/DB hilang sesudah charge tetap fenced, perlu admin.
- Buff200/202+batch hanya processing; GET status harus cocok batch/order/code/
  qty/currency tersimpan sebelum done. pending dipoll sekali/invocation dengan
  jeda1menit; failed/needs_check memerlukan admin tanpa rebuy. Penyelesaian
  noncredential/notis putih-label tanpa nilai kode atau PIN/kredensial palsu.
- Paid scheduler memproses maksimal1 link TUNVN; sisa job `tunvn_orders` pada
  router lite/Worker menit existing, budget40 statement, tanpa timer/env baru.
  Generic delivery tidak mengambil baris supplier pending sebagai manual.
- `/api/admin/tunvn/orders` GET authenticated/no-store:100 link terbaru, biaya,
  status, ID tepat dan metadata receipt tanpa input/ciphertext. POST `reconcile`
  hanya GET batch Buff yang diketahui; POST `reveal` privat melalui requireAdmin
  + audit otorisasi existing. Pada snapshot T2B belum ada buy/retry atau auto-match
  history; revisi retry pra-beli di atas mengganti hanya batas retry itu.
- Belum commit/push/deploy/migrasi remote atau transaksi produksi. PM memiliki
  full suite/build dan T3 QA browser; bukti fokus ada di T2B-evidence.md.

## Histori T2A 10 November 2026: katalog/input (lokal saat T2B masih pending)

- Keputusan ini mengganti snapshot split/nonaktif 9 November hanya pada kontrak
  terkait. Satu produk publik **ChatGPT Private**, slug `chatgpt-tunvn`, varian
  Business/GPay 1 bulan. SKU/ID/harga/histori lama tetap; migrasi 0114 hanya
  memindahkan relasi dan memensiunkan produk duplikat, tanpa menghapus order.
  Nama supplier/SKU internal tidak dikirim ke pembeli (slug disetujui owner).
- Awal tetap nonaktif. Admin Produk dapat mengaktifkan produk beserta varian
  awal; panel TUNVN mengatur satu saklar produk bersama dan permintaan terbit
  per varian. Varian yang dimatikan tidak mematikan saudara aktif; publish
  menghormati status, copy dan harga override admin, bukan mengaktifkan massal.
- Muse account asli tidak diubah. Buff baru hanya `TUNVN-BUFF-1B`, jumlah 1..30
  berarti 1..30B untuk satu kode; markup 40%, pembulatan Rp100 **per unit**
  (Rp1.500/unit pada FX18.086), tanpa diskon 30B. Empat SKU bundle lama hanya
  nonaktif; ID, harga override dan snapshot historis tidak dihapus/dibeli ulang.
- Migrasi 0115 menambah `buyer_field_key`/`max_qty` varian dan `buyer_fields`
  keranjang Telegram. Preset generik default NULL/off, awal hanya Buff1B:
  `muse_invite_code`, enam ASCII alnum, trim, case-preserving. Editor varian
  dapat menghidupkan/mematikan preset; bukan form builder/regex arbitrer.
- Web meminta satu kode checkout dan quote baru setelah perubahan kode.
  Server mengikat config/nilai/qty agregat ke quote dan reservasi atomik.
  Telegram meminta kode hanya di private chat; callback/notis tidak memuat
  nilainya. WA menolak varian yang memerlukan input sebelum order/invoice.
  Kode hanya tersimpan di cart Telegram/snapshot order privat; tidak masuk
  daftar publik, URL, log atau email. Detail admin authenticated/no-store
  membaca nilai; daftar order/admin dan buyer status meredaksinya.
- NEW order saja memperoleh `tunvn_eligibility` versi1 server-side dengan kind,
  source product/variant/unit dan quantity immutable. Stamp client dibuang;
  order lama, bundle lama dan Muse account dasar tidak di-backfill/dispatch.
- Otomatisasi setelah paid disetujui owner tetapi **T2B belum diimplementasikan**
  pada paket ini; fulfillment masih manual. T2B wajib pagar durable sebelum
  POST, fail-closed saat ambigu dan receipt akun terenkripsi. Bukan izin
  tes transaksi/deposit produksi. Tidak mengubah env/secret/cron/payment rail.
- Status bukti: lokal saja; focused tests/tsc/lint di evidence T2A. PM memiliki
  full suite/build dan QA browser fixture sebelum publikasi; belum klaim live.

## Revisi owner: semua TUNVN nonaktif + kontrol penuh panel — 9 November 2026

- Owner bertanya apakah katalog sudah tampil publik dan meminta **di-disable
  dulu**. Jawaban terbukti: migrasi 0112 belum pernah diterapkan ke D1
  produksi (query read-only: produk ChatGPT TUNVN + varian `TUNVN-*` tidak
  ada; katalog publik 94 item tanpa TUNVN), jadi belum tampil — tetapi seed
  awal 0112 tadinya `is_active=1`, sehingga sebelum CI menerapkan 0112/0113
  seed direvisi nonaktif dan migrasi **0113** memaksa semua baris TUNVN
  nonaktif sebagai pengaman.
- Kontrol admin kini setara kebutuhan WR/SK untuk scope TUNVN: per produk
  mirror admin dapat mengatur **markup %**, **nama publik**, **deskripsi
  publik** (kolom `tunvn_products.admin_*`, tidak ditimpa sync), serta dua
  saklar **Diminta terbit** (`publish_requested`) + **Produk aktif** (harus
  keduanya menyala agar tampil). Produk tanpa pemetaan terbit (selain ChatGPT
  #86/#83) hanya bisa diatur markup/nama/deskripsinya dan tetap tersembunyi.
- `publishTunvnCatalog` tidak pernah memaksa aktif: membuat produk/varian
  nonaktif, menghormati markup/copy/harga manual admin, dan mematikan produk
  yang permintaan terbitnya dicabut. Harga ChatGPT dihitung ulang dari modal
  × FX segar × markup admin; PATCH panel memakai FX tersimpan terakhir.
- Buff: per varian admin dapat mengatur markup, harga manual
  (`tunvn_admin_price_idr`, kosong = rumus), label, dan status aktif lewat
  `/api/admin/tunvn/buff/[sku]`; harga manual + status aktif bertahan dari
  publikasi ulang. PATCH produk: `/api/admin/tunvn/products/[id]`
  (id = supplier_product_id, requireAdmin, zod strict).
- Fleksibilitas yang SENGAJA belum setara WR/SK: antrean order/rekonsiliasi,
  aturan markup massal berbasis modal, audit modal supplier, dan dispatch
  otomatis — belum ada karena TUNVN belum punya dispatch (`/api/buy`,
  `/api/buff/order` belum dibangun) dan saldo wallet masih kosong.

## Aktivasi katalog + panel admin — 9 November 2026 (instruksi owner, mengganti batas setup awal)

- Owner menyetujui markup **ChatGPT 35%** dan **Buff Token Muse AI 40%**,
  memerintahkan katalog ChatGPT diterbitkan, Buff menjadi varian produk Muse
  manual owner, panel admin TUNVN dibuat, supplier digabung ke dropdown
  sidebar, dan API dipasang di Pages agar siap order. Batas lama "jangan
  tampilkan produknya" di bawah diganti HANYA untuk scope ini: produk TUNVN
  lain tetap tersembunyi.
- Kurs acuan hitung 9 Nov 2026: **USDT Rp18.086** (CoinGecko Rp18.091,
  Pintu Rp18.090, CoinMarketCap Rp18.086,3, INDODAX Rp18.071). Rumus
  `src/lib/tunvn/pricing.ts`: jual = ceil Rp100 (modal USDT × kurs ×
  (1+markup)). Publikasi ulang memakai FX snapshot AXVARA segar
  (`loadCurrentFxSnapshot`), fail-closed tanpa kurs.
- Harga terbit awal (kurs 18.086): ChatGPT Business 1M (TUNVN #86, 4,60
  USDT) **Rp112.400**; ChatGPT GPay (TUNVN #83, 4,96 USDT) **Rp121.200**;
  Buff (modal probe `/api/buff/check` 0,0588 USDT/1B): 5B **Rp7.500**, 10B
  **Rp14.900**, 20B **Rp29.800**, 30B **Rp44.700**.
- Gambar produk ChatGPT TUNVN memakai aset existing yang sama dengan produk
  ChatGPT AXVARA dari WR (id 12) dan SK (id 85) yang sedang nonaktif:
  `/r2/products/f87f491ee2f9034845db18eb08c9236d.webp` (konfirmasi owner +
  query D1 read-only 9 Nov 2026). Jangan membuat/mengunduh logo baru.
- Buff adalah varian baru produk manual owner **Muse AI 1 Miliar Token**
  (slug `muse-ai-1-miliar-token`, D1 id 112): SKU `TUNVN-BUFF-{5,10,20,30}B`
  dengan kolom `product_variants.tunvn_*` (migrasi 0112). Varian lama produk
  itu tidak diubah.
- Migrasi `0112_tunvn_catalog_publish.sql`: kolom link/harga di
  `tunvn_products` + `product_variants.tunvn_*`, seed produk
  `chatgpt-business-1-bulan-tunvn` + `chatgpt-gpay-1-bulan-tunvn` (kategori
  ai-chatbot, aktif) beserta varian `TUNVN-86`/`TUNVN-83`. `publishTunvnCatalog`
  (panel admin) menyinkronkan mirror lalu menerbitkan ulang secara idempoten.
- Panel admin: section `tunvn` (sidebar kini grup **Supplier** dropdown:
  Warung Rebahan, Sekalipay, TUNVN, WR vs SK, Link Supplier). Komponen
  `TunvnManager` (tab Ringkasan/Katalog ChatGPT/Buff Muse/Publikasi) +
  API `/api/admin/tunvn/{products,balance,buff,publish}` (semua requireAdmin).
- Env Pages DIPASANG 9 Nov 2026 sebagai `secret_text` (production+preview):
  `TUNVN_API_KEY`, `TUNVN_BASE_URL`, `TUNVN_ENABLED=true`,
  `TUNVN_SYNC_ENABLED=true` (total env 75→79). Berlaku pada deployment CI
  berikutnya. Kredensial lokal tetap `.tunvn-credentials`; jangan echo.
- **Batasan order**: belum ada dispatch otomatis TUNVN — `POST /api/buy` dan
  `POST /api/buff/order` belum diimplementasikan; produk terbit ber-fulfillment
  manual dan saldo wallet TUNVN saat aktivasi 0 VND / 0,0099 USDT. Isi saldo
  dan bangun dispatch (pola klaim durable supplier existing) sebelum
  mengandalkan order otomatis; jangan POST tulis untuk QA.
- Probe Buff 9 Nov 2026: `/api/buff/check` 10B/20B konsisten 0,0588 USDT/1B
  (390 VND/1B), `fundable:true`; invite contoh dokumentasi sempat gagal
  ambil harga sekali — probe panel bersifat best-effort bertanda stale.

## Setup awal — 9 November 2026 (fondasi tersembunyi, belum aktif)

- Owner memberi API key reseller TUNVN PREHUB (bot Telegram, 42.033 monthly
  users; admin @tunvn2002) dan dokumentasi
  `https://tunvnmmo.duckdns.org/api/docs`, dengan instruksi eksplisit:
  **setup dulu saja, jangan tampilkan produknya**. Keputusan ini TIDAK diganti
  oleh snapshot/probe di bawah; produk TUNVN hanya boleh tampil setelah
  instruksi owner berikutnya.
- Kredensial lokal: `axvara/.tunvn-credentials` (git-ignored
  `.tunvn-credentials*`, chmod 600) berisi `TUNVN_API_KEY` +
  `TUNVN_BASE_URL`. Jangan commit/echo nilainya, jangan salin ke
  browser/bundle publik/docs. Env Pages BELUM dipasang pada setup awal;
  kelak wajib `secret_text`: `TUNVN_API_KEY`, opsional `TUNVN_BASE_URL`,
  dan flag di bawah.
- Gate berlapis, semuanya default mati: `isTunvnEnabled()` hanya
  `TUNVN_ENABLED==="true"`; `isTunvnSyncEnabled()` juga mensyaratkan
  `TUNVN_SYNC_ENABLED==="true"`; `isTunvnConfigured()` tambahan mensyaratkan
  key non-kosong + base URL HTTPS valid. Tanpa konfigurasi lengkap, client
  dan sync no-op total tanpa fetch.
- Kode setup awal: klien read-only `src/lib/tunvn/client.ts` (GET
  `/api/products`, `/api/balance`; parser murni), sync mirror
  `src/lib/tunvn/sync.ts`, tabel mirror `tunvn_products` (migrasi
  `0110_tunvn_hidden_catalog.sql` + `drizzle/schema.sql`). Sync SENGAJA
  tidak dipanggil route/cron/UI mana pun dan selalu menulis `visible=0`;
  cabang UPDATE tidak menyentuh `visible`. Tidak ada integrasi ke
  `products`/`product_variants`/katalog/checkout/Telegram, tidak ada
  endpoint `POST /api/buy`, `POST /api/deposit`, atau Buff Token.
- Kontrak upstream (docs dibaca + probe read-only 2026-11-09): header
  `X-API-Key`; `GET /api/products` → `{success, products[{id,name,
  price_vnd,price_usdt,discount_threshold,discount_price_vnd,
  discount_threshold_usdt,discount_price_usdt,stock,description}],
  usdt_vnd}`; `GET /api/balance` → `{success,user_id,username,balance_vnd,
  balance_usdt,usdt_vnd}`; `GET /api/rate` publik. Probe: 19 produk,
  kurs 25.494 VND/USDT, akun `Axvara_support`, saldo 0 VND / 0,0099 USDT.
  Ini bukti baca-saja tanggal tersebut, bukan saldo/katalog permanen.
- Keamanan upstream: 5 key salah dalam 60 detik memicu blokir sementara.
  Jangan menebak key, jangan retry 401/403, jangan membuat panggilan
  tulis untuk QA. `POST /api/buy` mendebit saldo wallet dan mengembalikan
  kredensial akun pada `items[]` — implementasinya kelak wajib mengikuti
  pola dispatch supplier existing (klaim durable, tanpa POST ulang saat
  ambigu), dan `items[]` adalah kredensial pembeli (lihat
  `docs/agent-rules/buyer-credentials.md`) — jangan dicatat mentah.
- Mata uang: harga upstream VND/USDT apa adanya. Jangan mengonversi
  VND→IDR atau mengarang harga jual; rumus margin/kurs adalah keputusan
  owner pada fase aktivasi.
