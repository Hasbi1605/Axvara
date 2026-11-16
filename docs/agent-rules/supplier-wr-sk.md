# Aturan agent — Supplier WR/SK, proxy VPS, dispatch

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
- Katalog mempunyai job lite ber-cursor satu produk/tick, budget40, setiap menit
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
