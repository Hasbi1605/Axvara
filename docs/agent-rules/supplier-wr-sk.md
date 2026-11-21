# Aturan agent — Supplier WR/SK, proxy VPS, dispatch

## B5/R2 22 Nov (lokal)

- Di `src/lib/sekalipay/order.ts`, UPDATE receipt pembelian dan `bindSkInvoiceByRef` sama-sama menolak invoice yang sudah dimiliki link SK lain dalam statement yang sama. Replay pada link yang sama tetap sah selama tak ada pemilik lain.
- Recovery ambigu tetap GET dengan ref stabil. Pass nonterminal hanya memajukan link ke `processing` bila invoice yang baru diikat masih cocok, tanpa menulis ulang invoice. Konflik/CAS kalah bukan sukses dan tidak membuka POST ulang; `request_sent_at` tetap. Tidak ada statement tambahan, migrasi, atau koreksi riwayat.

## B4b 22 Nov (lokal)

- WR mengosongkan `lease_owner` dan `lease_expires_at` hanya di UPDATE advance otoritatif yang menang, termasuk completion baru Premium dan Jaspay. Replay, refresh akun pada status `completed`, CAS kalah, dan lease recovery Jaspay tidak berubah. Fence `request_sent_at` dan `attempt_count` tetap; tidak ada statement, bind, atau POST tambahan. SK tidak berubah.

## B4 22 Nov (snapshot sebelum B4b)

- `src/lib/suppliers/purchase-state.ts` memuat rank status vendor dan CAS berdasarkan invoice terikat + status sebelumnya. Lookup, deduplikasi, replay, audit, dan efek lanjutan tetap di wrapper `deliver.ts` masing-masing supplier.
- Hanya SK yang mengosongkan lease saat CAS advance menang (H5). WR tetap tidak melepas lease pada CAS ini; perubahan itu beserta jalur completion Premium/Jaspay masuk B4b.

## B3b/R1 22 Nov (lokal)

- UPDATE bulk klaim kedaluwarsa WR/SK hanya mengembalikan link tanpa bukti
  kirim dan tanpa invoice (NULL atau `''`) ke `pending` bila order terkait
  masih `lunas`/`paid` dengan `supplier_purchase_disabled=0`. Guard dicek
  di UPDATE yang sama; pengembalian satu attempt dengan batas bawah nol
  tetap berlaku. Rekonsiliasi sent/ref tidak memakai guard baru ini.

## B2b 22 Nov (lokal)

- CAS penerimaan invoice dari POST awal WR Premium dan Jaspay menerima `NULL`
  atau `''` warisan, serta invoice yang sama. Invoice berbeda atau sudah dimiliki
  link lain tetap ditolak. Bukti kirim dipertahankan; tidak ada jalur beli ulang
  baru. Recovery exact-ref Jaspay tetap memakai ref dan body identik.

## FX-20 — 21 November 2026 (lokal)

- WR Premium/Jaspay: `WrNetworkError` yang mungkin sudah terkirim masuk
  `submitted`, tetap menyimpan `request_sent_at`. Guard URL pra-kirim tidak
  menambah ambiguitas; aturan pesan/5xx dan retry konfigurasi tetap berlaku.
  Jaspay tetap pulih via exact-ref. Sweep klaim usang hanya requeue bila tanpa invoice.
- Admin Retry WR/SK mensyaratkan order `lunas`/`paid` dan pembelian supplier
  aktif saat baca dan saat CAS. SK menghapus lease saat status maju; receipt
  yang kalah CAS dihitung `retried`, bukan sukses.
- H4 ditunda: kehabisan percobaan WR masih bisa menandai mixed cart gagal dan
  mengabari pembeli saat item lain masih antre. Penyelesaian per item + agregat
  perlu cadangan statement pada percobaan terakhir; admission tidak diubah.

## Kabar saldo WR tertahan — FX-15 (21 November 2026, lokal)

- `blocked_balance`: pembeli web hanya menerima email jika ada; tanpa email,
  gunakan halaman pesanan, bukan fallback WhatsApp. DM privat Telegram tetap
  untuk order Telegram. Untuk tindak lanjut, gunakan Admin → Warung Rebahan →
  Antrean → **Saldo habis**; antrean ini tidak bergantung pada hasil notifikasi.

## Kontrak katalog VPS–Pages — 21 November 2026 (lokal)

- Hanya potongan `/wr/products-slice` dan `/sk/catalog-slice` mendapat batas
  Pages `min(35 dtk, sisa budget sweep)`: proxy punya 30 dtk upstream, dan
  cron menyisakan 8 dtk dari deadline 45 dtk. Timeout bukan fallback atau bukti
  stok hilang; 404/405 proxy lama tetap fallback. Timeout order tetap 12 dtk.
- `/api/supplier-sync` saat supplier mati → `409 {ok:false,applied:false,error:"supplier_disabled",supplier}`.
  Proxy lama tidak mengakui 409 sebagai tersimpan tapi masih mengulang. Revisi
  VPS terpisah: jeda per supplier (mis. 5 menit, terkonfigurasi dan berbatas),
  jangan ubah snapshot/tombstone atau ukuran batch pada respons ini; supplier
  lain tetap berjalan. `pairs` yang gagal transient tetap 503 dengan cron
  cleanup sebagai backstop, tanpa perubahan kontrak write.

## Perbaikan audit H2 — 21 November 2026 (lokal)

- Refresh topup SK setelah kegagalan baca channel (create berakhir `unknown` tanpa status/rentang tervalidasi) kini memanggil `fetchSkTopupChannels()` lagi dan menolak `channel_unavailable`/`amount_out_of_range` sebelum `POST v1/balance`, tidak lagi langsung repost. Status: implementasi lokal + test.

## Topup saldo SK dari admin — 20 November 2026 (keputusan owner, lokal)

- Admin boleh membuat **invoice topup saldo reseller SK** dari AXVARA tanpa membuka web SK. AXVARA hanya membuat invoice + melacak status; **owner membayar sendiri** (link/QR). Tidak ada payout otomatis, tidak ada POST order/dispatch baru.
- Channel TIDAK di-hardcode: `fetchSkTopupChannels()` membaca `GET v1/balance/channels`, lalu server memvalidasi `status:"on"` dan nominal integer dalam `[minimum,maximum]` sebelum `POST v1/balance`. `ref_id` server-side `AXVTU-YYYYMMDD-<8hex>` (tidak pernah `GW-`, tidak dari klien); refresh yang gagal ambigu **mengulang ref_id yang sama**, tidak pernah membuat ref baru.
- Konfirmasi lunas hanya dari mutasi `credit` topup yang `invoice`-nya cocok dengan `supplier_ref`. Jika invoice sudah diketahui, cek mutasi dan kedaluwarsa sebelum mencoba mengambil ulang link dengan ref yang sama. Duplikat ref atau gagal mengambil link bukan bukti invoice yang sudah diketahui gagal dibayar. Saat create, 4xx definitif = `failed` tanpa retry; timeout/network/5xx = `unknown` (aman refresh).
- Gate SK = `isSkEnabled() && isSkConfigured() && !isSkSandbox()`; tidak ada env baru. Slot maks 3 invoice non-terminal per supplier direservasi atomik sebelum panggilan supplier; refresh ≥10 detik dan hasil lebih lambat tidak dapat menimpa `paid`. Test memakai mock fetch dan fixture DB; **jangan** memanggil POST tulis SK nyata untuk QA. Detail ARCHITECTURE §16.65.
- `failed` dengan `supplier_ref` hanya boleh dicek lewat mutasi kredit invoice yang cocok. Tanpa kredit tetap `failed`; jangan expire, tampilkan ulang instruksi bayar, atau POST lagi.

## Panel admin bersama — 19 November 2026 (keputusan owner, lokal)

- Ringkas/Antrean/Markup/Alat memakai `SupplierAdminPanel` dengan saldo IDR,
  kapasitas, riwayat sync, aturan exclusion, dan sandbox SK. Ringkas membaca
  saldo dan sync-log. Antrean, markup, dan exclusion dimuat saat tab dibuka.
- Produk WR/SK baru tetap auto-aktif dengan auto-hide saat stok habis. Harga
  tetap memakai markup persen dan nominal dibulatkan ke kelipatan Rp500.
  Badge AUTO/MANUAL, kontrak sync, Retry, dan Batal memakai aturan WR/SK.
- Markup satuan/bulk menyimpan cermin dan harga varian storefront dalam satu batch per item. Bulk melaporkan item yang rollback di `failed`; revisi katalog Market dinaikkan bila ada yang berhasil.
- Retry SK menghormati status pembayaran, permintaan terkirim, dan invoice.
  Batal antrean nonterminal tetap memakai endpoint void dan konfirmasi admin.
  Pengujian admin memakai fixture tanpa transaksi supplier.

## Kepemilikan nama, slug, label varian & modal WR/SK — 18 November 2026 (keputusan owner, lokal)

- **Buka kunci WR (`src/lib/warung-rebahan/ownership.ts`):** `name` dan `slug` produk WR serta `label` varian WR dihapus dari `WR_OWNED_PRODUCT_FIELDS` / `WR_OWNED_VARIANT_FIELDS` (`PUT /api/products/[id]` dan `/api/admin/variants` mengizinkan edit dengan validasi format + keunikan slug `409` yang sama; sync WR hanya mengisi `name`/`slug` saat `INSERT` dan tidak pernah menimpa baris yang sudah ada). `WR_OWNERSHIP_MESSAGE` menegaskan `nama, slug, nama varian` milik admin; harga jual, stok, durasi, garansi, dan deskripsi bawaan WR tetap `409`.
- **Pertahankan rename admin lintas sync WR/SK (`src/lib/warung-rebahan/sync.ts`, `src/lib/sekalipay/sync.ts`):** semua jalur update `product_variants.label` (WR `planExistingVariantWrites` yang dipakai full sweep/products-slice/diff `applyOnly`/upsert, `syncJaspayCatalog`, serta SK `planSkCatalogRefreshWrite`) hanya menulis `label` bila `label IS NULL OR label='' OR label IS <nama supplier sebelumnya>` (`wr_variants.wr_variant_name` / `sk_products.sk_variant_name` dari row yang sudah di-prefetch sebelum batch meng-update tabel cermin) dengan guard WHERE `((label IS NULL OR label='' OR label IS ?) AND label IS NOT ?)` agar sweep tanpa perubahan tidak memicu tulis ulang. `INSERT` pertama tetap memakai nama supplier.
- **Modal supplier & `manual_cost` (`src/app/api/products/[id]/route.ts`, `src/app/api/admin/variants/route.ts`):** `GET` mengekspos `supplier_cost: number | null` dan `supplier_cost_source: "WR" | "SK" | null` via `LEFT JOIN wr_variants`/`sk_products` (presedensi WR → SK, selaras `src/lib/orders/cost-snapshot.ts`). `PUT /api/products/[id]` dan `POST`/`PUT /api/admin/variants` mengabaikan `manual_cost` masuk untuk varian bertaut `wr_variant_id`/`sk_variant_id` (mempertahankan nilai tersimpan tanpa error).

## Sekalipay juga supplier AXVARA Games — 18 November 2026

- Supplier order Games = Sekalipay H2H (sejak P3 12 Nov 2026; produksi 18 Nov: `games_products` 1.644 baris `sekalipay` + 601 baris `digiflazz` legacy yang tidak dijual). Gerbang order (`src/lib/games/ordering.ts`): `GAMES_SK_ENABLED=true` + `SEKALIPAY_ENABLED=true` + transport/kredensial SK + bukan `SEKALIPAY_SANDBOX`; kredensial/`DIGIFLAZZ_TESTING` bukan gerbang lagi. Kontrak transaksi/webhook `sekalipay_games` dan pemulihan admin GET-only di GAMES §13–15.

## Gate seragam supplier_purchase_disabled & bersih-bersih supplier_pair_dirty — 18 November 2026 (lokal, G1)

- B1 (lokal): predikat paid/enabled bersama WR/SK ada di `src/lib/suppliers/purchase-state.ts`; urutan validasi dan CAS Retry tetap milik route masing-masing.
- CAS klaim fresh/inline (`claimFreshPurchase`, `claimStalePurchase`) dan penanda kirim (`fencePurchaseSend`) berada di `src/lib/suppliers/purchase-state.ts`, dipanggil dari alur WR/SK di bawah.
- WR (`src/lib/warung-rebahan/order.ts`: `createWrOrderLink`, `createWrOrderLinksForOrder`, `reconcileMissingWrLinks`, `processWrPendingOrders`, `claimLink`, `processOneLink`, `recoverJaspayByExactRef`, `reconcileBlockedBalance`, `retryFailedWrOrders`) dan SK (`src/lib/sekalipay/order.ts`: `createSkOrderLink`, `createSkOrderLinksForOrder`, `reconcileMissingSkLinks`, `processSkPendingOrders`, `claimSkLink`, `processOneSkLink`, `reconcileBlockedSkBalance`, `retryFailedSkOrders`) wajib menyaring `orders.status='lunas' AND orders.payment_status='paid' AND supplier_purchase_disabled=0` (seragam dengan `src/lib/tunvn/orders.ts` dan `src/lib/aivault/orders.ts`). Order bertanda `supplier_purchase_disabled=1` tidak dibuatkan link baru maupun mengirim POST pembelian; link/riwayat yang sudah ada tidak dimutasi.
- Migrasi `drizzle/migrations/0134_retire_supplier_pair_dirty.sql` (selaras `drizzle/schema.sql`) menghapus 14 trigger `pair_dirty_*` (`DROP TRIGGER IF EXISTS`) dan mengosongkan antrean lama (`DELETE FROM supplier_pair_dirty`), sambil mempertahankan tabel `supplier_pairs`/`supplier_pair_dirty` untuk kompatibilitas shim/histori. Tidak ada kode aktif yang membaca/menulis `supplier_pair_dirty` selain klasifikasi telemetry `src/lib/db/read-metrics.ts`.
## Garansi bukan masa aktif — keputusan owner 18 November 2026 (G4, lokal)

- Jangan menyalin `warranty_value/unit/type` ke `duration_value/unit/label` di
  editor atau API. Masa aktif diisi sendiri pada mode tunggal/multi, boleh kosong;
  durasi tersimpan tidak berubah saat form hanya dibuka/disimpan. Nilai legacy
  lifetime/custom dan labelnya dipertahankan hingga admin menyunting masa aktif.
- WR-owned tetap readOnly/disabled dan guard API existing tidak dilemahkan.
  Normalisasi modal grup/30hari memakai durasi, bukan garansi. Tidak menebak atau
  backfill durasi historis, tidak menyentuh sync supplier atau algoritme grup.
- Test komponen/hook/API dan Chromium fixture lokal; belum bukti deployment.

## Refresh stok induk SK F5b — 18 November 2026 (lokal)

- `zeroSkVariantsByIds`, `zeroMissingSkVariants`, serta jalur tulis/diff
  `syncSkProducts` (`src/lib/sekalipay/sync.ts`) menyegarkan `products.stock`
  dan `products.price` induk dengan rumus yang sama dengan WR (`-1` bila ada
  varian aktif `-1`, else jumlah `stock > 0` varian aktif; `archived_at IS NULL`)
  melalui `planSkParentAggregateWrite` / `refreshSkParentAggregates` dalam chunk
  `≤50` statement (`≤100` parameter D1).
- Sweep penuh tuntas (`sweepComplete` & `allowZeroMissing`) juga menjalankan
  `refreshStaleSkParentAggregates` untuk memulihkan induk SK yang sudah basi
  sebelumnya tanpa migrasi DB.
- Error di jalur zero, refresh induk, maupun `planSkCatalogRefreshWrite` (serta
  `QueryBudgetExceeded` di `runSkWrites`) tidak ditelan agar `/api/supplier-sync`
  mengembalikan `500` dan `sk_sync_log` mencatat kegagalan.
- Fixture lokal; tanpa migrasi, perubahan produksi, commit, push, atau deploy.

## Stok efektif grup F5a — 18 November 2026 (lokal)

Winner WR/SK tidak boleh memakai mirror saja: batasi stok lokal setelah
reservasi dengan stok mirror aktif. −1 hanya tanpa plafon pada sisi itu;
lokal0 atau mirror nonaktif tetap0. Stok unique dibatasi inventory available
dan minimum beli. Tidak mengubah sinkronisasi/refresh parent SK (milik F5b),
identitas supplier, histori order atau retry/failover transaksi. Fixture dan
native D1 lokal; belum bukti deployment.

## Respons WR tak terbaca & retry admin SK — 18 November 2026 (lokal)

- WR proxy/direct: HTTP2xx tanpa JSON envelope dengan boolean `success` adalah
  `WrNetworkError` ambigu (`wr_network_response_unreadable`), bukan penolakan.
  Dispatcher mempertahankan `request_sent_at`; Premium tanpa ID tetap perlu
  rekonsiliasi exact invoice admin, tanpa POST pembelian kedua. Poll known-ID
  dan recovery exact-ref Jaspay existing tidak berubah. JSON valid
  `success:false` tetap memakai klasifikasi saldo/stok existing.
- Retry admin SK hanya order lunas/paid, link retryable, invoice kosong dan
  `request_sent_at IS NULL`, bukan `cancelled_by_admin%`. Invoice/sent ditolak
  409 `reconciliation_required`; pembatalan/nonpaid 409 `not_retryable`.
  Semua pagar diperiksa ulang di CAS UPDATE; retry tidak menghapus sent-fence.
  `failed` pra-kirim tanpa invoice/fence boleh reset attempt0 termasuk exhausted;
  status lain tidak mereset counter. Probe orphan tidak dijalankan dari retry.
- Fixture lokal; tanpa perubahan proxy, env, produksi atau deployment.

## Diff sync VPS 1 menit + trigger pairs WR/SK — 18 November 2026 (VPS terpasang)

- **Error removal & batas 100 param (18 Nov 2026, lokal F4):** `zeroSkVariantsByIds` (`src/lib/sekalipay/sync.ts`) dan `zeroVariantsByIds` (`src/lib/warung-rebahan/sync.ts`) dipotong per 50 ID tanpa `.catch(() => [])` / penelanan error `UPDATE product_variants`; `POST /api/supplier-sync` membalas HTTP 500 kapan pun `result.errors.length > 0` (termasuk bila `synced > 0`) karena `axvara-wr-proxy/src/diff-sync.ts` memajukan snapshot pada setiap 2xx.

- `axvara-wr-proxy/src/diff-sync.ts` & `src/index.ts` menurunkan interval diff
  WR/SK dari 3 menit menjadi 1 menit (`DEFAULT_DIFF_INTERVAL_MS = 60_000`, log
  `"diff sync started (1 min)"`) dan memicu `POST /api/supplier-sync`
  `{ supplier: "sk", action: "pairs" }` setiap WR atau SK menerapkan perubahan
  (`ok && (sent || removed)`), bukan hanya SK.
- Rilis VPS terverifikasi 18 Nov 2026 (`00:12 WIB`): backup penuh
  `/opt/axvara/wr-proxy/dist.backup-diff1m-20261118`, 4 modul `dist/*.js` cocok
  `sha256sum` lokal (`.env` dan `state/` utuh), `systemctl is-active wr-proxy`
  = `active`, `GET /health` HTTP 200 (`sekalipay:true,skg:true,dgf:true,indosmm:true`),
  `journalctl` mencatat `"diff sync started (1 min)"`.

## Modal Jaspay dari tagihan exact — 18 November 2026

- `0136`: total terverifikasi dipatok ke invoice/produk/jumlah yang cocok; refund
  kumulatif tidak bisa mundur/melebihi total. `jaspay.refunded` bukan sendiri
  bukti produk gagal. Report memakai modal nett walau link masih diproses;
  katalog tanpa bukti tetap estimasi kecuali link gagal tanpa tagihan (Rp0).
- Admin `Cek status` Jaspay ber-ID hanya memeriksa `/jaspay/status` exact; untuk
  link terminal hanya memperbarui tagihan, tidak re-delivery atau re-POST order.

## Modal laporan supplier gagal — keputusan owner 16 November 2026 (lokal)

Link WR/SK `failed` tanpa keberhasilan dihitung modal Rp0 dan bukan estimasi
(saldo supplier dikembalikan). Retry existing mereset baris yang sama; laporan
juga mendahulukan link `completed` bila ada beberapa link historis. Link yang
terikat item tidak boleh memakai modal item lain. Order gagal lama tidak dihapus;
refund/replace nyata dicatat sebagai pengeluaran opsional bertaut kode order.
Ini kontrak laporan, bukan perubahan status supplier, retry atau dispatch.

## Penjualan WR manual tanpa pengganti Jaspay — keputusan owner 16 November 2026

- Menggantikan sebagian aturan14November "Premium manual/mixed/unknown dijeda":
  `made_by_order` dijual bila produk tidak tercakup Jaspay (`JASPAY_LEGACY_PRODUCTS`
  atau parent punya varian `jaspay:`). Kelas unknown tetap dijeda.
- Tanpa cadangan (pilihan owner): tercakup = tetap dijeda walau Jaspay habis/nonaktif.
- Produk Jaspay baru yang menggantikan MBO lama wajib ditambahkan ke pemetaan
  eksplisit; jangan mencocokkan nama. Gate tunggal `new-sales.ts`.

## Refresh mixed cart & progres Jaspay — 16 November 2026

API status/lookup tetap menyegarkan link supplier yang berjalan walau item lain
sudah punya kredensial (`credentials_ready` berarti ANY, bukan ALL). Gerbang
CAS20detik/order dan proof buyer existing tetap. Lacak Pesanan memakai progres
fase/antrean/jumlah nyata yang sama dengan halaman pesanan, terus polling bila
ada link/fase berjalan; satu akun tidak memakai persentase timer.100% hanya
completed koheren, partial tetap pemeriksaan. Tanpa env/cron atau rebuy baru;
verifikasi fixture lokal, deployment belum diverifikasi.

## Grup produk lintas supplier — keputusan owner16 November2026

- Menggantikan pasangan WR/SK/Opsi B; `supplier-pairs.ts` shim ke
  `product-groups.ts`. `supplier_pairs` tetap arsip, bukan target tulis baru.
- Nonaktif/Arsip selalu kalah, juga Manual/prefer. Manual live menang;
  berikutnya stok→modal per30hari→prefer dalam margin. Semua habis: prefer
  aktif→Manual aktif→position; semua nonaktif winnerNULL. Stok−1 ditulis∞.
  Unique tanpa inventory available dan stok di bawah minimum tidak live.
- Modal WR wajib lolos `wrNewSaleSql`; normalisasi day/month/year30/365,
  lifetime/custom/NULL tidak dinormalisasi. Lihat ARCHITECTURE Grup produk.
- Migrasi0129 menyalin33 pasangan dan mengganti Zoom15→113, Express VPN20→121,
  Wink25→115, Meitu26→114 dengan guard nama kedua sisi; MBO diarsipkan termasuk
  yang sudah OFF. Tidak memindahkan invoice/varian/order lama atau failover.
- Admin mengatur sendiri grup supplier lain; jangan otomatis mengelompokkan
  Grammarly/ChatGPT/Gemini/Canva. API pasangan lama410; bookmark section=pairs
  tetap, label Grup produk. Status lokal + QA, publikasi CI; belum bukti deploy.


## Tinjau S&K: tanda "teks supplier sudah oke" + formatter judul — 16 November 2026 (lokal)

- `resolveVariantCopyDetailed` menambah `reviewKind` (`changed`/`raw`/`null`) dan
  `reviewed`; `needsCopyReview()` = `reviewKind !== null`. Salinan yang tampil ke
  pembeli TIDAK berubah.
- `PUT /api/admin/variant-copy` menerima `action:"acknowledge"|"unacknowledge"`.
  Acknowledge menulis HANYA `admin_copy_fingerprint=supplierKey` (409
  `has_override`, 400 `not_pemasok`); unacknowledge mengosongkan fingerprint.
  Kolom EN dan teks admin tidak disentuh; CAS sumber+kolom admin sama. Jalur
  simpan teks lama (termasuk clear saat kosong/sama dengan otomatis) tetap.
- FX-8b (lokal): simpan EN tanpa override ID mencatat sidik jari sumber pada
  jalur tunggal maupun bulk. Saat sumber berubah, EN tetap tampil, tetapi
  detail dan hitungan tinjauan admin menandainya `changed`. Data publik varian
  memakai allowlist dan penanda netral, bukan ID/keluarga/konfigurasi supplier.
- `GET /api/products` admin menambah `copyReviewChanged`/`copyReviewRaw` di
  samping total `copyReview`.
- Formatter supplier: baris judul-saja (S&K/Syarat/Ketentuan/Rules/Wajib
  diingat/Penting → aturan; Catatan/Note/Notes → notes) jadi penanda bagian,
  bukan butir, termasuk di teks aktivasi. Di bawah judul aturan, baris yang
  jelas garansi tetap masuk garansi. Kurasi dan `supplierFingerprint` tetap.
- Regresi dump read-only `/tmp/copy-rows.json` (194 varian `pemasok`): butir
  judul-saja 15→0 (varian 14→0), butir non-judul tetap 1.914, domain supplier 0.
- Status: implementasi lokal + test; tanpa migrasi, belum commit/deploy.

## Hapus tab Audit SK & Alat di panel Sekalipay — 16 November 2026 (lokal)

- Permintaan owner: hapus tab **Audit SK** (mutasi saldo + transaksi) dan
  **Alat** (cek akun/validate, stock-lock, detail varian) dari panel admin
  Sekalipay. Tab **Ringkas/Antrean/Markup/Aturan** tetap; exclusion rules tidak
  berubah.
- Route yang dihapus (tanpa pemakai lain, sudah dicek ulang dengan grep):
  `/api/admin/sekalipay/{mutations,transactions,validate,locks,variants}`.
  Fungsi client khusus yang ikut dihapus: `lockSkStock`, `listSkStockLocks`,
  `releaseSkStockLock`, `SkStockLock`, `fetchSkBalanceMutations`,
  `SkBalanceMutation`, `fetchSkTransactions`, `SkTransactionSummary`,
  `fetchSkValidationServices`, `SkValidationService`; helper
  `getSkBalanceMutations` di `src/lib/sekalipay/saldo.ts` juga dihapus.
- **Dipertahankan** karena masih dipakai fitur lain: `validateSkAccount`
  (validasi nickname Games, `src/lib/games/nickname.ts`) dan
  `fetchSkItemDetail` (dispatch Games & order SK). `SupplierTabId` tetap
  menyimpan `alat` karena dipakai panel TUNVN/AIVault; hanya `audit` yang
  dihapus dari tipe.
- Status: implementasi lokal + test; belum commit/deploy. Tidak menyentuh data,
  env, atau transaksi produksi. Jangan hidupkan kembali tab/route tanpa
  keputusan owner baru.

## Arsip Produk — keputusan owner 15 November 2026 (lokal)

`products.archived_at` (migrasi0126) memisahkan Arsip dari Nonaktif. Identitas
supplier parent/varian dan relasi histori tetap disimpan: lookup sync tidak
boleh mengecualikan Arsip lalu membuat pengganti. Penulisan katalog, varian
baru, proyeksi harga/stok, aktivasi dan restock melewati parent Arsip; mirror
supplier boleh terus sinkron. Panel/editor mengembalikan409 “Pulihkan dari
Arsip dulu” saat aktivasi. Pulihkan tetap nonaktif; produk supplier tidak pernah
eligible hapus permanen. Lihat PRD “Siklus Arsip Produk” dan ARCHITECTURE “Arsip
Produk admin”. Implementasi/migrasi baru lokal; tanpa perubahan produksi.

## Penjualan WR otomatis — keputusan owner 14 November 2026

- Owner menyetujui Jaspay sebagai jalur utama penawaran yang didukung, seluruh
  paket available masuk katalog dan Premium manual/mixed/unknown dijeda untuk
  pembelian baru. Premium restock otomatis dan SK tetap. Kebijakan harus dicek
  di katalog/quote/keranjang dan transaksi reservasi web/Telegram, termasuk qty
  Jaspay agregat. Bukan izin mengganti invoice/order/varian historis atau membeli
  ulang; penyelesaian order lama tetap jalur asal, tanpa gate penjualan baru.
- Default package eksplisit `id:""` sah sebagai `jaspay:<product>:` dan di-omit
  pada POST; ID hilang/malformed/lebih dari satu default ambigu ditolak. Paket
  baru tidak mewarisi garansi Premium; deskripsi/ketentuan Jaspay otoritatif.
- Owner mewajibkan gambar dan galeri Jaspay sama dengan produk MBO asal yang
  dijeda. Gunakan pemetaan ID supplier eksplisit; reuse parent aktif atau isi
  gambar tujuan yang kosong dari parent asal (termasuk nonaktif). Pertahankan
  gambar admin tujuan dan seluruh identitas/riwayat order lama.
- Katalog mempunyai job lite ber-cursor setiap menit [16Nov: beberapa produk/tick, budget96 — lihat platform-ops.md; awalnya satu produk/tick, budget40]
  sesudah order. Pengiriman otomatis memakai webhook + poll invoice dikenal;
  progress phase/antrean/hitungan nyata, bukan animasi persentase berbasis timer.
  Completed koheren saja berarti100%; partial/malformed tetap pengecualian aman.
- Implementasi lokal/publikasi CI terpisah dari bukti deployment/transaksi nyata.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

- `products.description_en` (0103), `products.name_en`, `product_variants.admin_terms_en`/`admin_activation_en` (0105) adalah kolom **admin-owned**: sync WR/SK tidak boleh menulisnya dan `WR_OWNED_PRODUCT_FIELDS` tidak memuatnya. Seed EN (0104 untuk deskripsi, 0106 untuk nama/S&K admin) hanya mengisi baris yang masih NULL; jangan pernah menimpa suntingan admin atau menganggapnya field supplier.

## Publikasi gabungan 11 November 2026

- Owner meminta review langsung sesi `ses_e3a0deff6ffeBormj3Yw9ZDMIV` tanpa
  subagent dan satu commit/push bersama fix Ringkasan admin. Larangan push pada
  snapshot10November berikut digantikan hanya untuk publikasi gabungan ini.
  Kontrak/restriksi transaksi produksi tetap; detail ARCHITECTURE16.39.

## Crosscheck recovery 10 November 2026 (snapshot lokal sebelum publikasi gabungan)

- Send WR/SK wajib lease owner/expiry, paid dan tanpa handover; eligible dipilih
  sebelum LIMIT. Kepemilikan mengikuti link/item durable dua arah atau mapping,
  bukan hanya katalog current. Crash sebelum send refund satu attempt; setelah
  send tidak pernah reset fence untuk recovery biasa. Saldo revival TTL24jam + CAS.
- SK melakukan GET detail/saldo sebelum satu POST. Preflight failure tidak memakan
  attempt, delay3menit; alert saldo admin/buyer dipertahankan tanpa spam tiap tick.
  TTL24jam blok preflight dihitung dari created_at link agar retry tidak memperbarui
  umurnya tanpa batas; blok legacy tetap updated_at. Order tua perlu retry admin.
  Error POST saldo/stok/validasi generik tetap ambigu, bukan alasan rePOST. Hanya
  PRODUCT_TEMPORARILY_UNAVAILABLE eksplisit boleh membuka retry biasa.
- Receipt SK harus cukup lisensi untuk quantity, tanpa campuran variant lain;
  empty licenses boleh fallback product_license. Parsial disimpan terenkripsi,
  belum settle/delivery; terminal/manual existing tidak diturunkan atau ditimpa.
  WR Premium missing-ID tetap admin exact invoice, Jaspay ref/input identik saja.
- Crosscheck langsung diff subagent, kontrak publik SK dan fixture native D1/SQLite;
  ARCHITECTURE16.38. Tidak membuat transaksi/notifikasi produksi; owner melarang push.

## WR Jaspay - 2 November 2026
- Dokumentasi resmi tetap base `/api/v1`; jangan menebak `/api/v3`. Jaspay adalah keluarga terpisah dari Akun Premium. Proxy mendukung `POST /wr/jaspay/{products,order,status,orders}` dengan token/key existing; rilis VPS2November terverifikasi health/hash, bukan bukti deployment Pages/transaksi nyata.
- Jangan memindahkan order Premium lama atau mencocokkan invoice dari nama/waktu/feed50terbaru. Identitas Jaspay memakai namespace `jaspay:` di mirror/link WR existing; stok available=-1 adalah unlimited, bukan `max_quantity`. Sweep/diff Premium tidak boleh menonaktifkan namespace Jaspay. Maksimum jumlah harus valid dan ditegakkan server-side termasuk baris keranjang ganda.
- `ref_id` supplier wajib stabil per idempotency key; missing receipt hanya boleh mengulang POST Jaspay dengan ref dan input persis sama berdasarkan kontrak duplicate-ref, bukan membeli ulang Premium. Invoice JSP diketahui hanya diperiksa melalui Jaspay status; lease/CAS/budget/sent fence existing dipertahankan.
- HMAC webhook `X-Digitals-Signature` memverifikasi body mentah; primary invalid tidak boleh fallback ke alias legacy. Event Jaspay memakai `data.invoice`. Partial/malformed credentials tetap terenkripsi untuk tindak lanjut admin, tidak menyelesaikan seluruh item, membeli ulang atau otomatis refund buyer. Teks pembeli white-label: Diproses otomatis, bukan admin/manual atau stok instan.
- Rilis proxy harus seluruh dist dengan backup serta env/state utuh. Backup VPS tugas ini `dist.backup-jaspay-20261102`; source lokal pra-tugas dipertahankan, tidak stage/commit perubahan pihak lain tanpa izin.

## WR timeout receipt — 27 Oktober 2026
- Missing-ID setelah timeout tidak boleh diikat otomatis lewat produk/waktu: WR
  tidak memberi korelasi request, akun supplier juga dapat digunakan manual.
  Admin memilih invoice lewat sync-now/SupplierLinkActions; exact-ID, identitas
  varian atau metadata mirror unik, qty/modal/paid serta CAS pemilik diperiksa.
- request_sent_at wajib durable sebelum POST; late result/error tidak menurunkan
  terminal. Rekonsiliasi known-ID tetap budget40 dengan delivery durable existing.
  Webhook terminal unmatched503, bukan ACK sukses tanpa persist. Feed WR50 terbaru
  tanpa zona/variant_id tetap didukung lewat pemilihan invoice eksplisit, bukan
  tebakan zona. Tidak membeli ulang saat invoice hilang atau di luar feed.

Proxy WR/SK — 26 Oktober 2026: dispatcher egress dipakai bersama dan ditutup
saat shutdown; URL proxy terkonfigurasi yang invalid menghentikan startup.
VPS tanpa URL proxy memakai IP tetapnya secara langsung. Diff removal WR/SK
dipotong terpisah maksimal 200 ID per request, hanya ACK sukses memajukan
snapshot; sisa ID dan payload induk berubah tetap pulih setelah restart.
Validasi body menghitung byte UTF-8, path SK menolak traversal. Rilis wajib
menyalin seluruh `dist/` (index/diff-sync/psmm/psmm-diff dan modul tambahan),
backup dahulu, pertahankan `.env`, snapshot dan direktori idempotensi durable.
Tes transport memakai MockAgent tanpa jaringan; tidak menambah retry pembelian.

## Keandalan dispatch supplier — 25 Oktober 2026
- FX-11b (lokal): hanya penolakan eksplisit SK `PRODUCT_TEMPORARILY_UNAVAILABLE` pada percobaan terakhir menulis bukti `final_rejection` sambil melepas sent-fence. Link yang masih tanpa invoice/fence hanya menjadi `failed` dalam transaksi yang sama dengan item terkait; agregat menunggu item lain dan notis admin/pembeli memakai kunci per order. Retry lama tanpa bukti atau tanpa item tetap nonterminal. Watchdog 13 jam memperingatkan sekali per link paid `submitted`/`ordering`/`processing` atau `pending`/`retry` yang kehabisan percobaan, tanpa mengubah status. GET 404/timeout tetap bukan izin replay.
- Setelah KlikQRIS paid, pekerjaan segera memakai `payments/paid-fulfillment.ts` + Cloudflare `ctx.waitUntil`; jangan mengikat POST supplier pada umur request browser. Materialisasi dan bind WR/SK mendahului fulfillment umum; immediate hanya order yang baru lunas, satu link/supplier, sisanya cron existing.
- HTTP5xx generik dan receipt tanpa order_id/invoice atau ref SK yang berbeda adalah ambigu: request_sent_at/ref_id dipertahankan, hanya rekonsiliasi. Hanya penolakan eksplisit SK PRODUCT_TEMPORARILY_UNAVAILABLE yang boleh retry biasa. Jangan mengubah404/timeout menjadi izin membeli ulang otomatis.
- Proxy WR/SK mengembalikan marker `wr_proxy_unreadable_response: network_error` / `sk_proxy_unreadable_response: network_error` untuk respons tulis2xx tak terbaca; kata network mempertahankan kompatibilitas Pages lama saat rollout. Sinkronkan kontrak di AGENTS proxy, README dan ARCHITECTURE.
- Pengujian supplier memakai fixture. Pemulihan order produksi hanya atas instruksi owner, verifikasi referensi/riwayat/debit dahulu, referensi tetap sama; jangan mencampur pemulihan dengan pengujian berbayar tambahan.

# Sekalipay Games H2H — transport dan batas bukti (12 November 2026, lokal)

- Games memakai transport SK existing (`SEKALIPAY_*`/proxy `/sk/*`), bukan pipeline
  lisensi premium `sk_order_links`. Cart H2H Games: satu item qty1, `note` dan
  `zone_id` sebagai field SIBLING (tidak digabung), nilai dari snapshot target
  immutable. Ref stabil kompak `AXG…` (≤50).
- Sent-fence `request_sent_at` + payload durable ditulis sebelum POST; setelah
  fence tidak boleh ada POST kedua. Timeout/5xx/ref sudah ada/404 memakai GET ref
  yang sama. Sukses hanya `completed` + H2H `completed` + SN nyata; partial/
  `failed:`/mismatch → `needs_check`. Tidak ada seller cadangan/refund otomatis.
- SK tidak punya `max_price` upstream: biaya aktual (amount, atau price+fees)
  diperiksa pasca-GET dan disimpan di `attempts.price` sebagai deteksi untuk
  review manual. Detail SK kadang hanya mengekspos `note`; bukti zone yang
  dikirim adalah payload snapshot, jangan mengarang field.
- Sync Games memakai kategori `Game` per_page=all dengan gate kelengkapan
  `meta.total_items`; Digiflazz price-list tidak dipanggil untuk Games.
