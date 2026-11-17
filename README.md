# AXVARA — Gerbang Semua Tools Premium

## Bot Promo WhatsApp kedua (17 November 2026)

Implementasi lokal; publikasi via CI, pairing nomor promo dilakukan owner setelah
deploy. Admin → Pengaturan Toko → **Bot Promo WhatsApp** (di bawah notifikasi):
simpan nomor berbeda dari bot AXVARA'S, pairing, muat dan simpan maksimal20grup,
lalu aktifkan. Ganti nomor/simpan grup menjeda pengiriman. Katalog ready+gambar
sama,09.00/17.00 WIB (batas12.00/20.00), jeda sekitar1menit antargrup.
Hanya bot kedua menambah `Join Grup WA:` dari link Pengaturan Toko saat enqueue;
bot AXVARA'S/welcome tidak berubah. Konfigurasi `whatsapp_promo_bot`, outbox
`promo_bot_digest`, API admin `/api/admin/whatsapp-promo-bot`, gateway
`/promo-bot/*`; tanpa env Pages baru. Detail: ARCHITECTURE§16.12 dan
`docs/agent-rules/whatsapp-gateway.md`.

## Harga grosir AIVault berbasis markup % (17 November 2026)

Status: implementasi lokal; publikasi via CI, belum deployment produksi.

Aturan grosir kini mengizinkan varian supplier **AIVault Hub** memakai tier
berbasis **persentase markup** (`aivault_products.bulk_markup_tiers_json`,
migrasi `0131_aivault_bulk_markup.sql` dengan seed awal Gemini Plus 6M 5+/10+/50+
= markup 58/47/36), sementara WR dan Sekalipay-SK tetap dilarang. Harga grosir
rupiah diturunkan otomatis oleh publisher dan `PATCH /api/admin/aivault/products/[id]`
dari biaya USD + FX + markup tier (ceil Rp100) dengan `max_qty <= 100`.
Pengaturan dilakukan di **Admin → AIVault → Markup** (dialog **Grosir** +
pratinjau live); API produk/varian generik mengembalikan 409
`bulk_pricing_aivault_managed` jika mencoba mengubah `bulk_pricing` AIVault, dan
editor Produk menampilkan catatan read-only. Detail: `docs/agent-rules/aivault.md`
dan `docs/ARCHITECTURE.md` §16.50.

## Untung Bersih & Pengeluaran (16 November 2026)

Status: implementasi dan verifikasi lokal; publikasi lewat CI, bukan bukti deployment.

Ringkasan admin kini menampilkan Omzet → Modal → Untung kotor → Biaya pembayaran
→ Refund & replace → Operasional → **Untung bersih**. Menu baru **Pengeluaran**
(`?section=expenses`) mencatat hosting/kuota/AI/domain/iklan/refund/replace/lainnya
pada tanggal dibayar, termasuk pengeluaran berulang bulanan (dibuat otomatis oleh
cron lite `cleanup`). MDR per penyedia QRIS diatur di Pembayaran → Metode (default
0%). Migrasi `0130_finance_expenses.sql`; API `/api/admin/expenses*` dan
`/api/admin/payment-fees`. Modal order lama dibekukan (snapshot manual + kurs
TUNVN/AIVault), link supplier gagal tanpa retry = modal Rp0.
Rincian refund/replace dan operasional mengikuti rentang Ringkasan yang sama,
termasuk lintas bulan; catatan refund dari detail pesanan menyegarkan Ringkasan.

## WR manual tanpa pengganti Jaspay dijual lagi (16 November 2026)

Varian WR manual/Made By Order kembali tampil dan bisa dibeli bila produknya tidak
tergantikan Jaspay (pemetaan eksplisit `JASPAY_LEGACY_PRODUCTS` atau parent punya
paket `jaspay:`). Yang tergantikan tetap dijeda walau Jaspay habis. Gate tunggal di
`src/lib/warung-rebahan/new-sales.ts`; tanpa migrasi/env.

## PIN setelah pembayaran (16 November 2026)

PIN6 existing tersedia di halaman pesanan/lacak setelah lunas, termasuk saat
produk masih diproses, hanya untuk proof checkout asli atau capability akun
terverifikasi. Produk otomatis terbuka tanpa PIN selama akses sah berlaku;
perangkat lain/sesi berakhir memakai kontak checkout+PIN. Email produk siap
tetap salinan. Kartu minimalis memakai glass card standar, satu baris PIN/Salin
dan helper singkat. POST privat `/api/orders/[code]/pin` tidak menerima kontak/p1;
PIN tidak masuk status publik, URL/history/storage. Tanpa env/migrasi/cron baru.
Mengganti aturan email-only28Oktober; implementasi lokal, publikasi melalui CI,
deployment belum diverifikasi. Detail: `docs/agent-rules/buyer-credentials.md`.

## Pengiriman AI Vault & progres Jaspay (16 November 2026)

Jalur pembayaran AIVault mencoba pengiriman lagi setelah pembelian supplier,
seperti TUNVN; Retry admin yang selesai juga langsung mencoba kirim. Cron tetap
backstop, termasuk supplier yang masih queued (poll minimal1menit; penyelesaian
melalui cron tetap memakai antrean fulfillment). Tidak menambah pembelian ulang.
Refresh WR/SK tetap berjalan selama ada link aktif, walau item lain sudah siap.
Lacak Pesanan kini memakai progres Jaspay yang sama dengan halaman pesanan:
fase/antrean nyata, jumlah akun siap dan100% hanya setelah completed koheren.
Tanpa env/migrasi/cron baru; verifikasi lokal, deployment belum diverifikasi.

## Grup produk lintas supplier (16 November 2026)

Admin → Supplier → **Grup produk** (`/admin?section=pairs`, bookmark tetap)
menggantikan Pasangan WR/SK. Buat grup2–10 produk WR/SK/TUNVN/AIVault/Manual,
kelola anggota/nama/preferensi dan margin Rp0–1.000.000, hitung ulang atau hapus.
Satu produk hanya boleh masuk satu grup; keluarkan hingga <2 menghapus grup.

Nonaktif/Arsip **selalu kalah**, termasuk Manual dan preferensi admin. Manual
yang aktif dan benar-benar punya stok siap jual menang; berikutnya stok, modal
per30hari, lalu preferensi dalam margin. Semua habis menyisakan wakil aktif;
semua nonaktif tidak memiliki winner. Katalog web/shared/Telegram/promo memakai
filter yang sama; PDP pecundang menuju winner. Cache dapat tertinggal30detik.

Migrasi `0129_product_groups.sql` menyalin33 pasangan menjadi grup dan mengganti
MBO→Jaspay (Zoom15→113, Express VPN20→121, Wink25→115, Meitu26→114) dengan
guard ID+nama, mengarsipkan yang lama tanpa memindahkan histori order. Schema
menambah `product_groups`, `product_group_members`, `product_group_dirty`.
API admin baru `/api/admin/product-groups`, `/:id`, `/:id/members`, `/decide`;
API pasangan lama410. Tidak ada env/cron/proxy baru atau failover pesanan.
Detail kontrak/modal/CAS: ARCHITECTURE “Grup produk lintas supplier”.
Status implementasi dan QA lokal; publikasi hanya CI main, deployment belum
diverifikasi. Catatan pasangan WR/SK/Opsi B lama di bawah adalah histori.

## Panel harga supplier TUNVN/AIVault (15 November 2026, lokal saja)

Tab Markup TUNVN/AIVault memakai baris harga bersama (`SupplierPriceRow`):
Simpan per baris, harga manual kosong = rumus, tanpa VND. Simpan ulang di menu
Produk tidak lagi membekukan harga rumus menjadi manual dan tidak merusak SKU
`AV-<service_id>`. Migrasi `0127`/`0128` mengisi deskripsi, S&K, dan cara aktivasi
TUNVN + AIVault ID/EN dengan shortlink `axvara.tech/go/*`. Detail: ARCHITECTURE §16.45.

Koreksi CI15November2026: #712 dibatalkan karena push berikutnya; #713/#714
gagal menerapkan0127 (`LIKE or GLOB pattern too complex`, batas pola D1 50byte).
Pengaman template0127/0128 diganti `substr(description, -86)=…` dan test
menjaga panjang literal LIKE/GLOB semua migrasi. Isi salinan/suntingan admin
tetap dijaga; migrasi dan deploy menunggu CI berikutnya, bukan deploy manual
atau bukti deskripsi sudah tampil di produksi.

## Arsip Produk admin (15 November 2026, lokal saja)

Sampah pada Produk memindahkan parent dan variannya ke **Arsip**, terpisah dari
Nonaktif manual. Tab/kartu operasional mengecualikan Arsip; tab Arsip menjaga
badge supplier dan menyediakan Pulihkan (tetap nonaktif) serta Hapus permanen
bersyarat dengan alasan. Produk supplier atau yang memiliki riwayat/relasi tidak
boleh dihapus permanen. Sinkron WR/SK/Jaspay/TUNVN/AIVault tetap menemukan identitas
Arsip agar tidak membuat ulang, dan melewati penulisan katalog yang diarsipkan.

Migrasi `0126_product_archive.sql`: timestamp + indeks parsial + trigger pagar
aktivasi bersamaan. API admin memakai DELETE untuk arsip, PATCH
`{archived:false}` untuk pulihkan dan DELETE `?permanent=1` untuk hapus manual
eligible; batch mengulang pemeriksaan relasi. Aktivasi Arsip409 “Pulihkan dari
Arsip dulu”. Daftar admin menambah `archivedAt`, `canHardDelete`,
`hardDeleteReason` dan hitungan tab; katalog publik tetap tanpa field admin.
Tanpa env/secret baru. Implementasi dan verifikasi fixture lokal, belum migrasi
remote, publikasi atau deployment; tugas ini tidak commit/push.

Admin Produk15November2026 (lokal): asal WR cyan, SK ungu, TUNVN pink,
AIVault indigo, Manual slate/outline putus-putus. Badge pill bertitik dan nama
lengkap aksesibel membedakan supplier dari status Live/Stok habis/Nonaktif;
legenda dekat filter dan header varian memakai komponen bersama
`src/components/admin/supplier-style.tsx`. Tema terang/gelap/sistem tetap didukung.
Tidak ada perubahan kontrak API/filter atau publikasi/deployment pada tugas ini.

## AIVault Hub (15 November 2026, lokal saja)

Supplier baru AIVault terpisah dari WR/SK/TUNVN. Migrasi0124 menambah mirror,
link order durable dan penanda family/service/fulfillment;0123 dicadangkan untuk
TUNVN paralel. Katalog dibuat **nonaktif**, nama/deskripsi/gambar/label milik admin
sesudah pembuatan. Harga USD tierqty1 memakai FX AXVARA≈USDT +markup35%, ceilRp100,
atau override admin per varian. Tanpa FX tidak publish harga.

Supplier→AIVault menyediakan Ringkas/Antrean/Markup/Alat. Admin Produk tetap
memiliki badge dan filter terpisah untuk TUNVN dan AIVault. Semua API
`/api/admin/aivault/*` requireAdmin; reveal receipt audit POST privat. Checkout
baru web/Telegram mencatat eligibility internal, hanya paid dan tanpa disable
boleh membeli. Receipt penuh terenkripsi, queued dipoll exact ID tiap≥1menit,
pengiriman kredensial melalui pipeline existing. Timeout/5xx/429/invalidJSON
memakai ID eksternal yang sama, maksimum3attempt;402/409/identity/partial butuh
admin. Tidak memakai accept_normal_price atau webhook baru.

Cron lite `aivault_orders` tiapmenit, `aivault_catalog` tiap3menit, budget40.
Env kelak Pages secret_text: AIVAULT_API_KEY, AIVAULT_BASE_URL (default HTTPS
reseller.aivaulthub.store), AIVAULT_ENABLED, AIVAULT_SYNC_ENABLED; default mati,
tanpa konfigurasi tidak fetch. Lokal `.aivault-credentials*` ignored. **Commit WIP lokal dibuat PM;
resolusi rebase belum di-stage/continue oleh writer. Belum push/deploy/migrasi
remote/env Pages**. Satu tes berbayar Gemini Plus6M
hanya boleh dijalankan PM sesudah deployment. Detail ARCHITECTURE§16.44 dan
[aturan AIVault](docs/agent-rules/aivault.md).


## WR otomatis: Jaspay dan stok Premium (14 November 2026)

Implementasi lokal, publikasi melalui CI main; deployment belum diverifikasi.
Penjualan baru WR hanya Jaspay atau Premium restock otomatis. MBO Premium manual/
mixed/unknown dijeda dari kanal pembeli dan dipagar ulang pada reservasi atomik;
order lama, invoice, data supplier/admin dan jalur penyelesaiannya tetap utuh.

- Katalog Jaspay mendukung default package ID kosong, semua paket durasi,
  availability, batas jumlah agregat, ketentuan/garansi supplier dan markup
  existing. Tidak fallback ke manual. Varian baru memakai identitas baru pada
  parent yang dipetakan eksplisit; gambar/galeri MBO asal dipakai kembali,
  termasuk saat asal nonaktif, tanpa menimpa gambar tujuan milik admin.
- Worker menjalankan `jaspay_catalog` lite tiap menit, beberapa produk/tick (budget96 sejak 16 Nov 2026; dulu satu produk/tick) dengan
  cursor durable dan budget40 existing, sesudah job order. Hingga10 tick sukses
  untuk snapshot10 produk; tidak perlu env/secret/trigger jadwal baru.
- Migrasi0121 menambah JSON progres aman pada link WR dan mengantrekan ulang
  keputusan pasangan supplier. Webhook/poll invoice yang sama menyelesaikan
  pengiriman terenkripsi. Default package tidak dikirim sebagai package kosong.
- Status API menambah `automatic_progress` tanpa kredensial/invoice supplier;
  `/pesanan/[code]` menampilkan tahap/antrean nyata dan hitungan akun,100% hanya
  setelah completed. Mixed cart tetap diperbarui ketika item lain masih dibuat.
  Proof/PIN/capability/email/Telegram mengikuti aturan existing.
- Fixture: `tests/fixtures/wr-jaspay-catalog-20261114.json`; test utama
  `jaspay-automatic-sales`, `jaspay-catalog.workerd`, `automatic-order-progress`.
  Bukan tes transaksi supplier produksi. Rincian docs/ARCHITECTURE + PRD + DESIGN.

Header admin14November2026 (implementasi lokal, publikasi CI): seluruh section
memakai `PageHeader` bersama dengan titik awal seragam dan tinggi minimum
72px desktop/144px mobile. Baris identitas/durasi sesi dan metadata waktu laporan
Ringkasan dihapus dari tampilan. Kategori/Artikel memakai tombol tambah pada
toolbar tepat di atas daftar; Artikel/Banner menaruh header sebelum mini card.
Pengaturan Toko menaruh satu header sebelum tiga tab. Header tetap pada loading
Pembayaran dan mendahului error/retry Produk; auth, API, ekspor dan data tetap.
Deployment belum diverifikasi.

Admin round 2 — anatomi seragam + pensiun alur beli WA13November2026 (implementasi
lokal terintegrasi di `main`, termasuk UI1–UI4 dan koreksi review): setiap section
memakai satu PageHeader + StatCard netral + satu toolbar + tabel/kartu, warna hanya
untuk makna status dan label memakai bahasa manusia. Alur pembeli WhatsApp
(pencarian, pemesanan+pembayaran, bukti manual) DIHAPUS dari kode — bukan flag env;
katalog digest/siaran/sambutan grup, event grup, outbox dan perintah admin `.d`
tetap, dan hanya perintah eksplisit lama (list/cari/pay/metode/bukti) dijawab satu
arahan ke website/Telegram — angka biasa dan media balasan tidak dibalas. Rekonsiliasi punya
aksi "sudah dicek" ber-catatan yang hanya menutup event (order/ledger/status tidak
berubah) dan satu definisi "Perlu dicek" untuk badge sidebar + halaman; Kanal &
Fulfillment menampilkan "Perlu tindakan" dari `bot/health`; Games memakai hitungan
"Bisa dijual" yang sebenarnya dan UI harga Oura dihapus; API mati
(`games/products/enable-wave`, `pedia/credits`, `warung/credentials`) dan komponen
`VariantEditor`/`FulfillmentInventoryPanel` dihapus. Kontrak pembayaran, akses
pembeli, idempotensi order dan kredensial tidak berubah; tanpa env/migrasi baru.
Verifikasi akhir PM pada sumber terintegrasi: `npx vitest run --run` **436 file /
5925 tes PASS** dan `npm run build:pages` **exit 0** (**171 edge route**, 8 output
prerender) dengan warning non-blocking; review visual fixture browser PASS.
Rekonsiliasi juga diperkuat terhadap race: cek "belum direview" ikut di batch atomik
paid/order/job, dan retry/confirm hanya untuk provider legacy DANA/GoPay (provider
lain 409 `provider_requires_manual_review`). Build lokal bukan bukti CI/deployment;
deployment belum diverifikasi. Detail di DESIGN/ARCHITECTURE/PRD bagian teratas.

Admin shadcn/ui13November2026 (implementasi lokal, menunggu publikasi CI): seluruh
panel admin memakai primitive shadcn/ui di `src/components/admin/ui/` (Radix + cva +
sonner + lucide), dialog/konfirmasi Radix dengan API lama, menu tema di header, dan
guard `tests/admin-shadcn-ui.regression.test.ts` yang melarang kontrol HTML mentah/
warna palet/hex/glyph di admin. Dependency baru tercatat di ARCHITECTURE bagian
teratas; tanpa env/migrasi/perubahan API. Storefront tidak berubah.

Panel admin terpadu13November2026 (implementasi lokal, menunggu publikasi CI): semua
section admin memakai design system bergaya shadcn-admin dengan tema Terang/Gelap/
Ikuti sistem (cookie `axvara-admin-theme`, layout `src/app/(shop)/admin/layout.tsx`,
token `admin.*` + `src/components/admin/admin.css`), dialog native `ui/Dialog.tsx`,
guard draft lintas section/back-forward, serta perbaikan audit: PATCH pesanan
menolak aksi manual legacy untuk crypto/gateway dan lunas QRIS generik (409),
filter `kind=games`/metode berkolon, Games berlabel sendiri, rekening bank legacy
baca-saja. Storefront dan `/admin/payments/test` tidak ikut bertema. Tanpa env/
migrasi/dependency baru. Detail DESIGN/ARCHITECTURE bagian teratas.

Perbaikan CI temp mail12November2026 (lokal, menunggu publikasi CI): migrasi gagal
karena tabel prototipe `messages` existing berbeda kolom. Worker/migrasi sekarang
memakai `temp_mail_messages` + indeks khusus, tanpa mengubah/menyalin/menghapus data
lama. Histori migrasi produksi kosong dikonfirmasi baca-saja sebelum koreksi0001;
bukan perubahan Pedia/Games, schema toko, kredensial atau routing email privat.

Temp mail publik12November2026 (implementasi lokal, deployment belum diverifikasi):
web `mail.axvara.tech`, penerima `nama@isturaiky.page`, tanpa login; alamat custom/
acak dapat dibuka ulang, pesan terlihat24jam. Worker Static Assets + Email Worker
dan D1 `axvara-temp-mail` terpisah, tanpa VPS/ubah email Zoho atau DB toko. Empat
forwarding privat domain existing tetap dipertahankan dan dikecualikan dari inbox.
Source/setup/batas ada di `temp-mail/README.md`, aturan di
`docs/agent-rules/temp-mail.md`. CI main menginstal parser MIME, menguji/audit,
memeriksa routing, memigrasi DB terpisah, deploy lalu mengaktifkan catch-all;
tidak ada env/secret Pages baru. Inbox publik tidak memiliki kirim/hapus/lampiran.

Katalog ready WA11November2026 (implementasi lokal, deployment belum diverifikasi):
grup AXVARA'S tidak lagi menerima notifikasi pembelian berhasil, termasuk antrean
lama. Cron notify_b existing menyiapkan satu foto+caption katalog per09.00/17.00
WIB, dari kandidat/harga Telegram yang sama, garis52tanda hubung dan gambar owner
`public/banners/ready-promo.webp`. Saklar/nomor/revisi/grup existing tetap; sesi
WA harus tersambung dan diaktifkan owner. Retry hanya sampai12.00/20.00 WIB,
tanpa mengirim katalog basi atau replay hasil ambigu. Tanpa env/migrasi baru;
rincian ARCHITECTURE16.12 dan aturan gateway.

Default web11November2026 (implementasi lokal, deployment belum diverifikasi):
bahasa Indonesia dan mata uang IDR tanpa deteksi jaringan/IP, negara atau bahasa
browser. Cookie pilihan manual ID/EN dan IDR/USD tetap independen; tanpa cookie
tidak ada request deteksi atau penyimpanan default. Quote Market dan pesan API
Pedia mengikuti aturan yang sama; pesanan/invoice tersimpan, FX dan bot tidak berubah.
Rincian implementasi pada catatan preferensi web di awal ARCHITECTURE.

Perbaikan Ringkasan11November2026 (publikasi CI): D1 produksi menolak SQL lama
karena ekspansi subquery/CTE terlalu dalam. Agregasi dimensi kini membaca scoped
dan facts masing-masing dua kali, tetap satu query dan perhitungan existing.
SELECT produksi baca-saja lulus dan seluruh baris standar/historis identik dengan
cabang lama terpisah. Review langsung sesi supplier di bawah digabung dalam satu
commit sesuai instruksi terbaru; larangan commit/push10November adalah snapshot.
Tanpa mutasi/transaksi produksi atau env/migrasi baru; ARCHITECTURE16.39.
Deployment belum diverifikasi.

Crosscheck recovery supplier10November2026 (lokal, belum commit/push): WR/SK memakai
send fence ber-lease/paid/manual dan antrean eligible sebelum LIMIT. Guard mengikuti
link/item durable dua arah saat mapping katalog berubah. SK menambah GET detail/saldo
sebelum satu POST; saldo kurang auto-check3menit tanpa memakan attempt dan alert admin
tetap ada tanpa spam per retry. Receipt kosong/parsial/salah varian tidak menyelesaikan
order; timeout/error POST tetap fenced, bukan izin membeli ulang. WR Premium tidak
direplay; Jaspay ref/input identik tetap terpisah. TUNVN preflight whitelist <24jam
pulih otomatis, receipt tersimpan diproses lokal dan gangguan poll Buff dicoba lagi
tanpa rebuy. Budget40/paid snapshot/kanal kredensial tetap; ARCHITECTURE16.38.
Tidak ada transaksi, notifikasi atau perubahan produksi; deployment belum diverifikasi.

TUNVN modal dinamis10November2026 (lokal, publikasi CI): dispatch akun/Buff dan
Retry tidak lagi menolak kenaikan modal dari snapshot checkout. Harga katalog
tetap naik/turun dari modal x FX x markup admin melalui sync3menit (override manual
tetap); total order yang sudah dibuat/dibayar tidak berubah. Snapshot biaya tetap
histori; preflight harga valid/saldo aktual/stok/fundable dan fence/CAS tetap.
Order cost_changed lama dapat Retry admin existing tanpa menunggu harga turun;
tidak auto-replay atau memproses order disable/manual owner. Tanpa env/migrasi,
mutasi atau transaksi produksi; ARCHITECTURE16.37. Deployment belum diverifikasi.

TUNVN notifikasi/label10November2026 (lokal, publikasi CI): email web
"Pesanan Diproses" mengikuti locale order setelah receipt akun lengkap atau batch
Buff diterima; ledger existing mencegah pengiriman normal berulang. Email gagal
Buff dicoba pada poll berikut tanpa membeli lagi. Order disable/terminal tidak
menerima notis proses; tidak ada backfill dua order manual owner. Katalog memakai
marker server `automatic_delivery`, checkout tidak memberi peringatan MBO dan
status/lacak mengenali snapshot eligible tanpa menjanjikan durasi instan. Editor
TUNVN tidak menawarkan stok kredensial lokal; mode DB tetap manual. Muse account
asli tetap MBO. Tanpa env/migrasi baru; ARCHITECTURE16.36. Belum bukti deployment.

TUNVN retry10November2026 (implementasi lokal, publikasi CI): daftar Pesanan dan
panel TUNVN membedakan saldo kurang dari saldo gagal dibaca dan menampilkan Retry
hanya pada kegagalan pra-beli terbukti (attempt0, tanpa send/receipt/ID, paid eligible,
item belum dikirim). CAS/preflight tetap; biaya snapshot hanya histori sesuai
revisi modal dinamis di atas. HTTP409/timeout setelah
send tidak pernah direplay. Order disable menampilkan penanganan manual tanpa Retry.
Owner menangani `AXV-20261110-81C2FADA` dan `AXV-20261110-9C9B8FF4` sendiri via
Telegram TUNVN: kedua flag supplier_purchase_disabled sudah1 di D1, bukan diproses
ulang atau dipakai QA; status pengiriman/notifikasi tidak diubah. Tanpa env/migrasi
baru; rincian ARCHITECTURE16.35 dan aturan TUNVN. Belum bukti deployment.

TUNVN auto-sync10November2026 (lokal, publikasi CI): job `tunvn_catalog`
memakai Worker cron existing setiap3menit, terpisah dari `tunvn_orders`.
Stok/modal ChatGPT dari API, harga Buff dari probe tanpa charge `AXVARA 1`,
FX segar dan markup tersimpan; harga manual/copy/saklar admin tetap. Buff fundable
false menjadi stok0, true stok-1 (layanan, bukan stok akun). Error mempertahankan
snapshot terakhir dan memberi503, tanpa fallback modal statis. Lease90detik
mencegah sync tumpang tindih dan factory order TUNVN menolak snapshot parsial.
Budget40 tetap; tidak menambah trigger/env/VPS atau membeli untuk QA. Berkala,
bukan realtime instan; deployment belum diverifikasi. Detail ARCHITECTURE16.34.

Revisi Buff10November2026: editor Produk dan Varian hanya menawarkan Buff per1B;
bundle5/10/20/30B dihapus dari daftar edit. Baris nonaktif tetap menjadi arsip
relasi pesanan lama, tidak dihapus fisik. Akun Muse asli dan status Buff1B tidak
diubah. Tanpa migrasi/env baru; berlaku melalui CI berikutnya, bukan klaim live.

TUNVN katalog penuh (15 November 2026, **lokal; belum deploy**): seluruh produk
mirror `tunvn_products` (kecuali #60 API TEST) dipetakan ke produk katalog AXVARA
lewat peta family statis `src/lib/tunvn/families.ts` — produk serupa menjadi
varian satu produk induk, id tak dikenal memakai fallback 1:1 `-tunvn`. Migrasi
`0123_tunvn_full_catalog.sql` menambah `products.tunvn_family` +
`product_variants.tunvn_source_product_id` (identitas dispatch/eligibility
menggantikan slug `chatgpt-tunvn`/83/86), dan trigger publikasi digeneralisasi.
Semua produk/varian baru **nonaktif** (markup default 35%, gambar disalin dari
produk kandidat, nama/deskripsi milik admin setelah dibuat). Panel TUNVN tab
Markup menampilkan kartu per family dengan saklar varian, markup, dan harga
manual; daftar admin Produk memberi badge/filter TUNVN. Detail §16.43
`docs/ARCHITECTURE.md` dan `docs/agent-rules/tunvn.md`.

TUNVN T2B (10 November 2026, **diimplementasikan lokal; belum deploy**): order
Market baru paid dengan opt-in server versi1 + snapshot biaya USDT memakai
`tunvn_order_links` (migrasi0116, UNIQUE order/item, lease/CAS dan fence sebelum
POST). Tes admin, order lama/bundle/no-stamp tidak membeli. Preflight enkripsi/
stok/harga/funding; response utuh terenkripsi, akun lengkap diteruskan pipeline
email/PIN6/c1/Telegram privat existing, partial/bonus disimpan privat untuk admin.
Buff200/202 hanya processing; done wajib status batch/identitas tepat, tanpa
kredensial palsu. Maksimal1 link/invocation, job `tunvn_orders` di cron lite
40statement existing; tidak ada env/timer baru. Panel admin memiliki status,
metadata/cost/ID, POST reveal privat dan GET-only reconcile batch Buff diketahui;
tidak ada blind buy/retry. Timeout/receipt hilang/5xx/409 needs_admin tanpa rebuy
(payload mesin409 tidak dipublikasikan). API tidak punya idempotency/max_price,
sehingga race harga setelah preflight tetap ada. PM menjalankan final full suite/
build/browser T3; tidak ada klaim live atau transaksi produksi. Detail §16.33
`docs/ARCHITECTURE.md` dan `docs/agent-rules/tunvn.md`.

Histori TUNVN T2A (10 November 2026, **lokal saat T2B pending**): ChatGPT Private
menjadi satu produk `chatgpt-tunvn` dengan Business/GPay, mempertahankan ID/harga/
order lewat migrasi0114. Aktivasi lewat Produk (aktifkan produk/varian) atau
TUNVN (Diminta terbit per varian + saklar produk bersama); publish tidak memaksa
aktif/menimpa copy/harga manual. Migrasi0115 menambah preset varian opsional
`buyer_field_key`/`max_qty` dan `telegram_carts.buyer_fields`; hanya Buff1B
(`TUNVN-BUFF-1B`) awalnya meminta `muse_invite_code` (trim, enam ASCII alnum,
case-preserving), jumlah1..30, harga unit ceilRp100 lalu dikali qty. Muse account
asli tetap, bundle lama nonaktif tanpa menghapus histori. Web mengikat input ke
quote/order atomik, Telegram meminta secara privat, WA menolak sebelum invoice.
Kode tidak masuk URL/log/email/daftar publik; detail admin authenticated/no-store
memiliki akses privat. Eligibility versi1 hanya untuk snapshot order baru sah;
tidak backfill atau dispatch order lama. Dispatch otomatis belum ada pada T2A;
PM memiliki final full suite/build/browser QA. Tidak mengubah env/secret/rail.
Kontrak lengkap: `docs/ARCHITECTURE.md` §16.32 dan `docs/agent-rules/tunvn.md`.

Expiry pembayaran (revisi 9 November 2026, lokal; deployment belum diverifikasi): order Market baru web/Telegram supplier WR/SK VA/e-wallet 30 menit, crypto/QRIS 60 menit, manual/keranjang campuran semua metode 15 menit. Deadline invoice provider tetap berlaku lebih awal: QRIS 15 menit (maksimal satu renewal existing selama order hidup), gateway minimum order/provider, crypto minimum order/`valid_until` provider. `expiration_estimate_date`/`expirationEstimateDate` NOWPayments floating-rate hanya masa estimasi kurs, bukan expiry pembayaran; format timestamp tetap divalidasi. Pedia baru gateway 30 menit, crypto/QRIS 60 menit dipendekkan ke deadline transaksi/provider (QRIS 15 menit). Telegram tetap hanya menawarkan QRIS + crypto. WhatsApp dan deadline order/invoice lama tidak diubah; retry/reconcile serta pemeriksaan legacy fixed-rate tetap. Pembayaran telat tetap pemeriksaan manual, bukan auto-revive/pembelian supplier kedua. Verifikasi revisi ada di CHANGELOG; rincian dan pemulihan order owner: `docs/agent-rules/payments.md`.

Nama/S&K admin/email EN Market fase 3 (LOKAL 7 November 2026, belum deploy): `products.name_en` serta `product_variants.admin_terms_en`/`admin_activation_en` (migrasi 0105) adalah milik admin; migrasi 0106 mengisi 7 nama non-token dan 9 varian admin. Nama EN = `name_en` ?? terjemahan token, dipakai kartu/PDP/modal/cart/checkout/order/Telegram/SEO tanpa mengubah nama tersimpan; pencarian mencocokkan ID+EN. Endpoint produk menerima `nameEn`; endpoint variant-copy menerima EN dengan fingerprint sama. Email pembeli mengikuti `order.locale` (subject, isi, tombol), default ID; admin email tetap ID. Verifikasi: `market-content-en` 10/10, `buyer-email-en` 5/5, `variant-admin-copy` 17/17, `variant-copy-editor` 18/18, full 373 file/5004 tes, tsc/lint/diff-check bersih; browser belum dijalankan.

Metadata, datang-soon, dan email Pedia ID/EN (LOKAL 7 November 2026, belum deploy): seluruh route Pedia punya title/description/OpenGraph sesuai cookie `axv_locale` (server-side) tanpa mengubah canonical/robots; halaman "segera hadir" juga ID/EN. Email pembeli (pembayaran diterima/diproses/selesai + pesan penyelesaian manual) mengikuti bahasa order yang disimpan memakai kolom `orders.locale` yang sudah ada — subjek, isi, label ringkasan, tombol, dan nama layanan EN ikut diterjemahkan, sementara angka/batas/ketentuan tidak berubah dan notis admin tetap Indonesia. Pengiriman/retry email tidak berubah. Verifikasi: suite Pedia 57 file/799 tes; payment group 22 file/370 tes; full suite 372 file/4994 tes dengan 3 kegagalan hanya di file Market (`variant-copy-editor`) milik agen paralel; tsc bersih untuk file Pedia (1 error di file tes Market), lint exit0, diff-check bersih; browser/deployment belum.

Konten EN Market fase 2 (LOKAL 7 November 2026, belum deploy): deskripsi produk EN disimpan di `products.description_en` (migrasi 0103, admin-owned) dan diedit dari tab Deskripsi & S&K; migrasi 0104 mengisi 71 produk produksi tanpa menimpa suntingan admin. S&K/aktivasi kurasi punya 95 entri EN berkunci fingerprint yang sama dengan ID, dengan fallback ke teks WR bila fingerprint berubah. Badge dan label varian diterjemahkan saat render tanpa mengubah nilai tersimpan, dan kategori `bundle-hemat` menjadi "Value Bundles". `/api/products` mengirim `descriptionEn`; `/api/catalog` mengirim `copy` + `copy_en` agar cache publik tetap netral locale. Verifikasi: tes baru `market-content-en` 7/7, blok EN product-copy 532/532, batch fokus 609/609, full 369 file/4982 tes, tsc/lint/diff-check bersih; browser belum dijalankan. Email pembeli dan konten per-varian admin tetap ID.

Rail pembayaran Pedia (LOKAL 7 November 2026, belum deploy): checkout web Pedia kini menawarkan QRIS (bawaan), Sekalipay gateway VA/e-wallet (kurasi Market: `SHOPEEPAY` biasa, tanpa kanal realtime), dan crypto NOWPayments — memakai katalog, token bertanda tangan, adapter invoice, panel pesanan, dan persetujuan satu klik yang sama dengan Market (tanpa duplikasi rumus/biaya). Order menyimpan metode terpilih, expiry dipendekkan ke `min(15 menit, deadline provider)`, dan dispatch Pedia tetap dipicu saat order lunas. Underpaid/telat crypto tetap manual review tanpa dispatch; kredit Pedia tetap pensiun. Shared edit minimal: `isValidBuyerOrderCode` (AXV|AXP) untuk consent/IPN/callback gateway dan dua regex kode di `sekalipay-gateway.ts` menerima AXP. Verifikasi: 7 tes integrasi rail + 4 tes integrasi dispatch + 2 tes picker; suite Pedia 53 file/775 tes, full suite 367 file/4866 tes, tsc/lint/diff-check bersih; browser nyata dan deployment belum.

Cakupan bahasa EN Market fase 1 (LOKAL 7 November 2026, belum deploy): saat English dipilih (`axv_locale`) atau pesanan ber-locale EN, seluruh chrome pembeli Market — navbar/footer/kartu/PDP/keranjang, nama kategori, halaman pesanan & lacak, panel QRIS/gateway/crypto, form akses/PIN, kredensial akun, reminder/device orders, bantuan, garansi, hero/community/banner — tampil dalam bahasa Inggris. Modul salinan: `catalog-copy` (chrome), `market-categories` (EN by slug, fallback nama DB), dan `order-copy` (order/lacak/panel). Halaman statis cara-order/garansi-replace/artikel dan menu lintas-layanan (termasuk navbar/kartu Pedia) ikut locale. Salinan ID tidak berubah. Konten produk/S&K, email pembeli, admin, dan Pedia di luar fase ini. Verifikasi: tes baru `market-i18n` 8/8, batch Market UI 156/156, full 364 file/4853 tes, tsc/lint exit0; browser nyata belum dijalankan.

Pedia ikut bahasa + mata uang tampilan (LOKAL 7 November 2026, belum deploy): header Pedia memakai `PreferenceControls` Market yang sama (cookie `axv_locale`/`axv_currency`), sehingga beranda, katalog/platform, halaman order, status pesanan, lacak, refill, bantuan, dan ketentuan tampil ID/EN dengan default Indonesia. Nama/deskripsi/syarat layanan diterjemahkan saat render (snapshot lama ikut, tanpa migrasi) sementara angka, batas, dan kebijakan tetap. Harga Pedia tampil USD hanya sebagai tampilan lewat jalur FX Market; tanpa FX kembali Rupiah dan tagihan tetap IDR/QRIS. Galat `/api/pedia/*` yang ditampilkan ke pembeli mengikuti cookie bahasa. Rail pembayaran Pedia masih QRIS saja (fase B belum dikerjakan). Verifikasi: suite Pedia 50 file/762 tes lulus, tsc/lint bersih untuk file Pedia; Chromium lokal :3010 — route Pedia 200, switcher EN/ID berfungsi, USD tercatat di cookie, tanpa error konsol; harga USD di halaman order tidak dapat dilihat lokal (katalog D1 kosong); deployment belum.

Telegram hanya QRIS + Crypto (LOKAL 7 November 2026, belum deploy): bot tidak pernah menawarkan/membuat Sekalipay gateway meski flag menyala (web tetap menawarkannya); create gateway ditolak fail-closed. Invoice Telegram lama pada gateway tetap di-consent/refresh/reconcile. Setelah `create_failed` definitif, notis memberi tombol "Metode pembayaran lain" yang membuka quote/nonce baru (tanpa auto-create); klaim ambigu/TX tetap resume tanpa POST ulang. Batas: order-exists-no-TX tidak bisa dilepas, sehingga tombol bisa meminta menyelesaikan langkah saat ini.

Nominal crypto tampil dibulatkan ke atas (LOKAL 7 November 2026, belum deploy): pembeli melihat/menyalin presisi terpendek (mulai 2 desimal) yang kelebihan AKTUAL ≤ US$0,01 dari rasio USD/koin tersimpan, dipakai di panel pesanan web, hasil lacak, dan instruksi Telegram. Nominal tersimpan/provider serta cek underpaid tidak berubah; tanpa teks penjelasan tambahan.

Kurasi gateway & copy gangguan (LOKAL 7 November 2026, belum deploy; revisi sore: DANA ditampilkan lagi): kanal `SHOPEEPAY` biasa ditawarkan dengan label "ShopeePay" dan `DANA_REALTIME` kembali ditawarkan dengan label "DANA" di **Market web dan Pedia**; hanya `SHOPEEPAY_REALTIME` yang disembunyikan (exact-ID, flag `i`), tanpa fallback dua arah untuk ShopeePay. **Telegram tidak terpengaruh**: bot hanya menawarkan QRIS + Crypto (`buildMethodOptions(..., { includeGateway:false })`), jadi gateway/DANA tidak pernah muncul di sana. Bukti read-only: POST create `DANA_REALTIME` selalu HTTP500 (`AXV-20261107-0F943ABA`, `AXV-20261107-49A6C50F`), GET by ref 404, kanal lain 201 — owner sadar dan memilih tetap menampilkannya, asalkan pembeli melihat pesan gangguan dan bisa pindah metode. Invoice lama realtime tetap dibaca/consent/retry/reconcile. Copy 503 gateway/crypto gagal/ambigu/initializing: "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain." / "This payment method is having problems. Please try another payment method."; Telegram `create_failed` memakai kalimat yang sama untuk rail crypto, copy QRIS tetap. Klien checkout Market dan Pedia merespons `error_code: payment_method_unavailable` dengan membuang quote (+prefetch), mengosongkan metode gagal, memuat ulang daftar metode, lalu submit berikut memakai token quote baru; reuse `orders.quote_id`/klaim server tidak diubah. Batas Pedia (diperbaiki 7 November 2026): kegagalan gateway yang terbukti definitif (rejeksi provider terbaca + GET read-only 404) membatalkan order + meng-expire item, sehingga quote baru pada target yang sama bisa 201; kasus ambigu (timeout/jaringan, 502/504, respons proxy tak terbaca, `DUPLICATE_REF_ID`, GET rate-limited/error) tetap mempertahankan klaim dan masih `409 duplicate_active_order`. Tidak ada POST ulang ke provider. Verifikasi: fokus sekalipay 64 tes + checkout behavior 35 tes + Pedia picker 3 tes + Pedia gateway-create 7 tes, full suite dan tsc dilaporkan di CHANGELOG; browser/deployment belum.

Panel pembayaran pending gateway/crypto (LOKAL 7 November 2026, belum deploy): halaman `/pesanan/[code]` memakai header ringkas yang sama dengan QRIS (tepat satu h1, ikon jam berputar, judul "Pembayaran <label>"/"Pembayaran Crypto") dan panel mengikuti hierarkinya — gateway satu kartu terpusat (chip "Menunggu bayar", total besar, hitung mundur, VA, tombol utama, Cek Pembayaran sekunder, status otomatis, kunci metode); crypto dua kolom QR + rincian (chip jaringan, nominal mono + Salin, satu baris ≈USD + biaya layanan, alamat, Salin alamat/Cek Pembayaran, callout amber). Persetujuan total gateway tetap wajib tetapi satu klik: setelah 200 dengan `payment.state=pending` + tautan https, tab yang sama langsung diarahkan ke provider; tanpa tautan hanya membaca ulang status; 409 tetap menampilkan total baru tanpa persetujuan otomatis. Verifikasi: fokus 50 tes + full 361 file/4824 tes lulus, tsc/lint exit0; verifikasi browser nyata dan deployment belum dilakukan.

Katalog kurasi gateway Sekalipay (LOKAL 6 November 2026, DIGANTI 7 November 2026 — lihat paragraf kurasi teratas; belum deploy): tawaran baru hanya `SHOPEEPAY_REALTIME`; [DIGANTI 7 Nov 2026: sekarang `SHOPEEPAY` biasa yang ditawarkan; `SHOPEEPAY_REALTIME` disembunyikan, `DANA_REALTIME` kembali ditampilkan sore 7 Nov.] kanal `SHOPEEPAY` biasa disembunyikan tanpa fallback. Label pembeli realtime menjadi "ShopeePay"/"DANA" (tanpa kata Realtime) sementara ID kanal dan biaya/min/max provider tetap. Urutan E-Wallet web ShopeePay→DANA→GoPay→OVO untuk metode yang ada, termasuk yang nonaktif pada posisinya; QRIS/VA/Lainnya/Crypto tidak berubah. Filter/label ada di katalog bersama sehingga quote web/admin, create preflight, dan Telegram konsisten; invoice lama tetap dibaca/consent/retry/reconcile/callback tanpa migrasi atau mutasi DB. Verifikasi: 2 file fokus/71 tes + integrasi PM final 361 file/4817 tes (lint exit0 (warning existing), tsc/build Pages148 lulus, audit0 high/critical+6 moderate existing); Chromium fixture flag OFF 1280/390 menampilkan 7 wallet urut ShopeePay/DANA/GoPay/OVO/LinkAja/Virgo/AstraPay tanpa SHOPEEPAY biasa/teks Realtime, ID/fee persis, VA10/Crypto28 tetap; 360 ShopeePay nonaktif tetap posisi pertama dan keyboard melewati ke DANA; CSS/JS200 tanpa error baru. Belum ada deployment atau klaim live; parser/kurasi baru menunggu publikasi.

Finalisasi/pemulihan invoice gateway (LOKAL 6 November 2026, belum deploy): order admin nyata gagal karena `checkout_url` app (`app.shopeepay.co.id`) ditolak validator host `sekalipay.com`, dan GET payment-status resmi tidak mengirim `is_sandbox`. Kini `payment_link` tetap wajib kanonis, `checkout_url` non-kanonis diredaksi ke null, dan `is_sandbox` create-time disimpan saat probe sehingga GET tanpa field itu tetap dapat direkonsiliasi memakai mode tersimpan. Baris `initializing` lama tanpa mode create-time tetap fail-closed/manual review (recovery aman via GET tidak didukung), tanpa POST ulang atau mutasi produksi. Verifikasi fokus 4 file/97 tes (termasuk workerd) untuk redaksi app URL + GET tanpa sandbox, plus integrasi PM final 361/4817, lint exit0 (warning existing), tsc/build Pages148, audit0 high/critical+6 moderate existing; order mock hanya satu POST create, consent+link kanonik; bukan transaksi produksi baru; legacy produksi tetap manual review tanpa reset; belum deploy.

Koreksi tes ShopeePay6November2026: versi admin `770a051` sudah terdeploy; provider menolak create401 karena adapter menggunakan Enhanced HMAC pada akun IP whitelist. POST via proxy diperbaiki menjadi HMAC atas body JSON mentah yang diserialisasi sekali; direct Enhanced/GET tetap. GET katalog berhasil bukan bukti autentikasi POST. Tidak mengubah key/env/flag publik, tidak mengulang POST atau mereset klaim order lama. Status superseded: koreksi POST `38d2878` sudah aktif di canonical `d2edb1924250472af223cfce0b955e2412bca1ee` (success `2026-11-06T15:40:46.22327Z`); invoice tersimpan terbukti dibuat lewat GET, bukan bukti dibayar/settlement. Jangan terus mencoba checkout lama yang masih initializing. Rujukan: ARCHITECTURE §16.20 dan runbook pembayaran.

## Tes pembayaran admin — 6 November 2026
- Implementasi baru: `/admin/payments/test` memakai checkout/keranjang asli, login admin dan Cloudflare Access existing. Tambahkan produk ke keranjang, buka halaman ini, pilih metode/jaringan, lalu bayar sendiri. **Ini transaksi nyata; pesanan lunas tetap diproses dan dikirim.** Bukan sandbox atau URL rahasia.
- Keputusan owner 7 November 2026: rail non-QRIS (Sekalipay gateway VA/E-Wallet + crypto NOWPayments) dibuka ke PUBLIK web + bot Telegram. Pages produksi `SEKALIPAY_GATEWAY_ENABLED=true` dan `NOWPAYMENTS_ENABLED=true` (`secret_text`, PATCH metadata 71 env tetap) — berlaku pada deployment CI berikutnya; belum ada bukti transaksi publik paid/settlement. Kalimat flag `false` di bawah adalah snapshot 6 November.
- Quote/create ada di `/api/admin/payments/test/{quote,orders}`, server-side auth pada setiap request dan marker quote signed yang tidak bisa dipakai di checkout publik. Flag tes `PAYMENT_ADMIN_TEST_ENABLED=true` disiapkan; `NOWPAYMENTS_ENABLED=false` dan `SEKALIPAY_GATEWAY_ENABLED=false` tetap menutup web publik dan bot. Mematikan flag tes hanya menghentikan order baru; invoice tersimpan tetap dapat direkonsiliasi. Perubahan env memerlukan rilis CI.
- Delapan env produksi ditambah sebagai `secret_text` dari berkas kredensial ignored, termasuk outcome `usdtbsc`; env existing utuh, total75/128termasuk4system. Jangan menyalin key ke browser atau mengubah MFA. Daftar lengkap dan rollback: `docs/ARCHITECTURE.md` §16.21 dan `docs/agent-rules/payments.md`.
- Proxy `/skg/*` sudah terpasang dengan backup penuh/env+state utuh; health `skg:true`, auth401 dan GET katalog bertanda tangan200/18kanal. Snapshot produksi berhasil di-bootstrap dari GET provider (FX+21koin, timestamp `2026-11-06T13:55:17.602Z`; tujuh minimum gagal tidak ditampilkan). Cron existing menyegarkan tanpa flag publik. Callback live menolak signature hilang, Access tetap melindungi halaman/API admin.
- Verifikasi lokal versi770a051:361file/4803tes, lint/tsc/build Pages148edge routes lulus, audit0high/critical dan6moderate existing. Chromium fixture ID1280/390/360 memeriksa auth, public isolation, OVO consent, jaringan crypto/keyboard/fokus, pending/refresh/resume/expiry, assets200 dan tanpa overflow/error terkait. **Halaman tes770a051 dan koreksi POST (canonical `d2edb19`) sudah terdeploy; invoice tersimpan terbukti dibuat, tetapi belum ada bukti dibayar/settlement.** Parser/kurasi baru masih menunggu publikasi. Setelah push berhenti tanpa polling deployment.

> Catatan lokal bertanggal di bawah adalah snapshot historis. Baseline UI/logo sudah terdeploy pada `e2aa02a375d4dd7dab0ed33a1499f6262e433f5f` (Pages `8d7a4469-3d89-414e-bf3e-89dc8c4bf0d5`), bukan aktivasi rail publik. Kontrak yang tidak diganti tetap berlaku.

Koreksi lokal: expiry SQL UTC halaman pesanan kini ditafsirkan konsisten di WIB; expiry invalid/kosong gagal tertutup dan snapshot tanpa expiry order menunggu server. Browser/build ulang belum diverifikasi.

Checkout Market memiliki chrome ID/EN lokal tanpa mengubah quote atau pesanan ketika preferensi berganti.

Sekalipay payment gateway via proxy VPS (lokal 6 November 2026, belum deploy): suspensi merchant dicabut; grup Virtual Account/E-Wallet/Lainnya tampil di atas Crypto (grup kosong tersembunyi), memakai baris ringkas logo/nama/biaya dan animasi 220ms/reduced motion. Revisi terbaru menghapus pencarian di semua grup pembayaran; 18 label snapshot merchant mendapat logo asli lokal (BNC, Virgo, AstraPay, DANA/ShopeePay termasuk Realtime dan Permata Alternative), tanpa mengubah quote/routing. Karena dashboard merchant hanya me-whitelist IP VPS `13.228.147.90`, adapter `src/lib/payments/sekalipay-gateway.ts` memanggil `${SEKALIPAY_PROXY_URL}/skg/v1/gateway/*` (header `x-proxy-token` = `SEKALIPAY_PROXY_TOKEN`, env Pages yang sama dengan supplier SK; proxy di `/Users/macbookair/axvara-wr-proxy`). Tanpa kedua env langsung ke sekalipay.com untuk tes/lokal; env parsial/invalid ditolak sebelum fetch. GET katalog dari VPS terverifikasi HTTP200: 10 VA + 8 E-Wallet; tidak membuat invoice nyata. Jalur `/skg/*` belum dipasang di VPS; env gateway/flag Pages belum diubah. Rail baru boleh aktif setelah proxy terpasang dan `SEKALIPAY_GATEWAY_ENABLED=true` + `SEKALIPAY_GATEWAY_API_KEY`/`SEKALIPAY_GATEWAY_SECRET_KEY` (secret_text) terisi. Detail: docs/ARCHITECTURE.md §16.20.

Verifikasi revisi logo/tanpa pencarian lokal 6 November: `npx vitest run --run` 360 file/4794 tes lulus, `npx tsc --noEmit`, `npm run lint` dan `npm run build:pages` lulus (145 edge routes; warning existing). QA Chromium ID/EN pada 1280/390/360: 10 VA/8 E-Wallet/28 opsi crypto, semua logo decode tanpa monogram kanal dikenal, tidak ada pencarian, keyboard/fokus, jaringan eksplisit, deselect/inert/reduced-motion lulus; tanpa overflow/error konsol checkout. Consent invoice mock berasal dari QA sebelumnya. Audit dependency: 0 high/critical, 6 moderate existing pada rantai dev ESLint/TypeScript, belum diubah. Bukan bukti deployment atau pembayaran nyata. Preview lokal :3003 diperbarui memakai D1 lokal dan provider mock.

Crypto multi-koin (lokal 5 November 2026, belum deploy; revisi biaya 7 November 2026): quote web menawarkan satu opsi per koin kurasi yang aktif di akun NOWPayments (snapshot D1, tanpa panggilan provider saat quote); invoice baru memakai kurs mengambang + fee provider ditanggung merchant, pembeli menanggung lewat **biaya layanan crypto per koin** = 1% proporsional + biaya tetap per ticker (`CRYPTO_SURCHARGE_BPS=100` + `CRYPTO_FIXED_FEE_CENTS` usdtbsc 8c/bnbbsc 8c/eth 17c/lainnya 20c di `src/lib/payments/crypto-pricing.ts`, keputusan owner 7 November 2026; `total = ceil((base+tetap)*10000/9900)`; angka BNB/ETH estimasi dan koin lain menunggu kalibrasi dashboard NOWPayments). Copy pembeli memakai label generik "Biaya layanan crypto"/"Crypto service fee", bukan persentase. **Tanpa lantai US$2** — ketersediaan hanya minimum provider × 1,15 per koin, sehingga pesanan sub-US$2 bisa dibayar dengan koin ber-minimum rendah. Invoice lama memakai rincian biaya tersimpan (nilai 1,5%/2% tetap ditampilkan apa adanya). Env `NOWPAYMENTS_PAY_CURRENCY` DIHAPUS (tidak dipakai kode); `NOWPAYMENTS_OUTCOME_CURRENCY` tetap wajib (mis. `usdtbsc`) dan menentukan koin yang diterima owner. Migrasi `0102_crypto_surcharge.sql` (3 kolom rincian biaya layanan) tidak berubah. Telegram: satu entri "Crypto (USD)" → sub-keyboard koin. Status: tes fixture lokal; belum diverifikasi di akun NOWPayments live atau dideploy.

FX USD/IDR otomatis (lokal 5 November 2026, belum deploy): kurs tidak lagi diisi manual lewat `USD_IDR_RATE`/`USD_FX_EFFECTIVE_AT`. Cron lite `cleanup` me-refresh snapshot D1 `crypto_market_snapshot` (migrasi 0101) dari estimasi NOWPayments tiap ≥30 menit (butuh hanya `NOWPAYMENTS_API_KEY`), beserta daftar koin crypto kurasi + minimum USD. Pasangan env `USD_IDR_RATE`/`USD_FX_EFFECTIVE_AT` kini hanya cadangan darurat (dipakai bila snapshot D1 kosong/basi >24 jam); tanpa keduanya USD/crypto tersembunyi (IDR saja). Detail: docs/ARCHITECTURE.md §16.18.

Status 5 November 2026 (lokal, belum deploy): Vitest penuh 4547/4547 lulus, build Pages 145 edge routes sukses, review UI pembeli Opus disetujui (dua kondisi logo QRIS dan preferensi seluler terpenuhi), dan QA browser nyata 1280/390 pada preview lokal lulus: USD US$1,50 untuk Rp 24.000, ID/USD dan EN/IDR independen, preferensi tidak mengubah quote/keranjang/kontak/S&K, consent gateway dengan total tepat dan kasus 409, logo QRIS 1280/390/360, bottom sheet preferensi 390/360 tanpa geser horizontal, salin/DeviceOrders/grosir. Batas: editor admin tidak dirender dan tidak disetujui (`/admin` tidak dibuka); tidak ada deployment produksi atau bukti penyedia.

Preview lokal interaktif (alat QA sementara di luar repo, bukan fitur produk/route/env aplikasi): proxy fixture kecil di depan `wrangler pages dev` dengan D1/R2 lokal terisolasi dan data DEMO di memori (quote asli; daftar metode, pesanan, persetujuan, status pembayaran, VA/alamat/tautan palsu). Halaman bantuan `http://127.0.0.1:3000/__demo/help`; tautan bayar demo memakai HTTPS lokal self-signed (browser meminta konfirmasi sertifikat sekali). Penyedia, supplier, email, Telegram dan transfer nonaktif; lunas/pengiriman/kredensial/admin tidak disimulasikan. Bukan deployment produksi.

Revisi owner 5 November 2026 (snapshot lokal; picker gateway digantikan revisi 6 November di atas, persetujuan visual baru menunggu): picker checkout = QRIS langsung di atas semua grup (tanpa akordeon; satu badge "Paling cepat"/"Fastest" inline di kartu) + akordeon grup VA/E-Wallet/Transfer lainnya/Crypto dengan chip logo, semua metode merchant + biaya + batas min saat terbuka, metode di luar batas min/max nonaktif (server menghitung shortfall; hanya yang tersedia yang ditandatangani dan diterima create); grosir = daftar baris tier (R1); bahasa/mata uang = satu tombol bendera bulat + menu dua bagian di header semua lebar (footer tanpa baris). Saat snapshot 5 November katalog merchant belum terverifikasi dan tes memakai fixture; bukti akses terbaru ada di atas. Detail: docs/DESIGN.md, docs/ARCHITECTURE.md.

Penempatan UI lokal 4 November 2026 (riwayat; sebagian digantikan di atas): bahasa/mata uang = tombol teks di header ≥sm dan baris pertama footer (bottom sheet) di bawah sm; `BulkPriceTiers` aktif netral tanpa garis biru; halaman pesanan/pengingat/lacak/perangkat dirapikan tanpa perubahan kontrak. Picker checkout (R4–R6) memakai satu keluarga kartu metode dengan logo lokal (QRIS, USDT, bank/e-wallet yang dikenali dari label server; label lain glyph generik) dan `<details>` bila gateway >4; logo hanya dekorasi.

UI Market terintegrasi lokal: `BulkTierEditor`, `BulkPriceTiers`, `PaymentMethodPicker`, `GatewayPaymentPanel` dan `PreferenceControls`, dengan `DisplayPreferencesProvider` di shop layout. `POST /api/display-prices` memberi sen USD display-only dari FX server untuk katalog/PDP/keranjang; fallback IDR bila tidak tersedia, quote dan charge tetap otoritas server. Belum deploy ke produksi.

Persiapan payout hanya kontrak lokal: belum ada withdrawal otomatis atau bukti transfer live. Payout dapat ditunda terpisah dari rollout pembayaran; keputusan tujuan bank/DANA atau aset/jaringan/alamat/custody dan, bila perlu, ambang/cadence masih menunggu owner serta konfirmasi provider. Withdrawal Sekalipay ambigu tidak di-retry otomatis; rincian dan batas bukti di `docs/agent-rules/payments.md` dan `docs/ARCHITECTURE.md` §16.

R3 koreksi lokal: push terminal gateway/crypto, pagar retry dan akuntansi budget query diuji fixture/workerd; belum bukti deployment.

R2 koreksi lokal: konflik gateway tetap review selama finalisasi; POST ambigu dipulihkan lewat refresh/cron GET tanpa POST ulang (belum bukti produksi).

TG-R1 lokal: method-options bersama + frozen payq1 offer/seleksi Telegram (QRIS-first, tanpa create/consent; R2 menangani create).
TG2c1 buyer transaction locale fixture lokal: invoice/status/delivery pembeli ikut locale order tersimpan; charge QRIS tetap IDR; rail baru tetap TG2c2.
TG2b bulk Telegram fixture lokal: tier agregat per varian dijaga atomik; QRIS terima net diskon; invoice/status bilingual tetap TG2c.
TG2a read-commerce locale fixture lokal: copy baca ID/EN dari prefs tersimpan +
satu harga display per tombol; invoice/order-status tetap TG2b/c.
TG1 lokal (+correction1): chooser + payload tersimpan, jawaban callback tunggal.
BULK1d lokal (8 November 2026): editor harga grosir kini dirender di modal produk admin yang dipakai (`ProductEditorModal` → baris varian / field varian tunggal), HANYA untuk produk manual — produk WR/Sekalipay-SK tidak menampilkan editor dan API menolak `enabled=true` dengan 400 `bulk_pricing_supplier_forbidden` (menonaktifkan tetap boleh). Draft hanya dikirim saat diubah; data tier lama pada varian supplier diabaikan jalur harga (katalog/quote/order/Telegram). Belum dipublikasikan.

BULK1c lokal (+correction1): protected admin API persists bulk (default off, omitted=merged-validated, strict, guards atomic); UI/TG belum dihubungkan atau dipublikasikan.

BULK1b lokal menghitung dan menandatangani harga tier per varian pada quote/order; admin, UI dan Telegram belum terhubung atau dipublikasikan.

BULK1a lokal menyiapkan konfigurasi tier per varian dan proyeksi katalog melalui migrasi 0099; harga checkout/admin/UI belum dihubungkan.

LOC1 lokal menyiapkan preferensi bahasa/mata uang display independen dan metadata quote; UI/bot belum diterjemahkan atau dipublikasikan.

S3d2 kebijakan crypto buyer-fee/fixed-rate diuji lokal; belum diaktifkan atau dipublikasikan.

S3d1 fixture lokal membutuhkan `NOWPAYMENTS_OUTCOME_CURRENCY` yang diverifikasi operator untuk preflight crypto; kebijakan fee create/quote belum terhubung atau dipublikasikan.

S3c merchant lifecycle diuji dengan fixture lokal termasuk budget cron/workerd; belum diaktifkan atau dipublikasikan.

S3b order/consent gateway masih dalam pengerjaan lokal; belum siap diaktifkan atau dipublikasikan.

S3a lokal menambahkan opsi quote Sekalipay default-off dengan estimasi fee bertanda tangan; pembuatan order dan UI gateway belum terhubung.

Sekalipay merchant S2b hanya fixture lokal: migrasi 0097 menyiapkan invoice/consent, callback dan reconcile; belum ada checkout atau scheduling yang aktif.

W3 backend lokal: checkout crypto USD memakai snapshot kurs eksplisit dan locale order; UI/Telegram dan publikasi belum dilakukan. Migrasi berurutan 0094–0096. W1 di bawah merupakan snapshot historis.

## Snapshot historis implementasi lokal W1 NOWPayments - 3 November 2026

Lokal/fixture, flag default OFF: adapter invoice + rekonsiliasi GET + receiver IPN
terverifikasi (`src/lib/payments/nowpayments.ts`, route
`src/app/api/payments/nowpayments/ipn/route.ts`, migrasi `0094`); reconcile
tersimpan tetap jalan walau flag pembuatan baru OFF. QRIS tetap satu-satunya rail
publik; checkout/TG/cron/admin UI milik W3. Sekalipay gateway shell tanpa adapter
(kontrak belum terverifikasi). Blokir manual: runbook pembayaran.

## Supplier TUNVN PREHUB — katalog ChatGPT + Buff Muse + panel admin (revisi 9 November 2026)

Revisi instruksi owner di hari yang sama: dua produk ChatGPT TUNVN diterbitkan
(markup 35%, gambar memakai aset ChatGPT AXVARA existing
`/r2/products/f87f491ee2f9034845db18eb08c9236d.webp`), Buff Token Muse AI
menjadi varian produk Muse manual (markup 40%), panel admin section `tunvn`
dengan sidebar Supplier dropdown, dan env Pages `secret_text`
(`TUNVN_API_KEY`/`TUNVN_BASE_URL`/`TUNVN_ENABLED=true`/`TUNVN_SYNC_ENABLED=true`)
sudah dipasang (berlaku deployment CI berikutnya). Dispatch order otomatis
belum dibangun; fulfillment manual. Detail: `docs/agent-rules/tunvn.md`,
ARCHITECTURE §16.31, migrasi 0112.

## Supplier TUNVN PREHUB — setup awal tersembunyi (9 November 2026)

Fondasi reseller Telegram TUNVN PREHUB: kredensial lokal `.tunvn-credentials`
(chmod 600, git-ignored; `TUNVN_API_KEY` + `TUNVN_BASE_URL`), klien read-only
`src/lib/tunvn/client.ts`, sync mirror tersembunyi `src/lib/tunvn/sync.ts`, dan
tabel `tunvn_products` (migrasi 0110). Semua gate default mati
(`TUNVN_ENABLED`/`TUNVN_SYNC_ENABLED`, env Pages belum dipasang), sync selalu
`visible=0` dan belum dipanggil route/cron/UI mana pun — produk TUNVN tidak
tampil dan tidak bisa dibeli. Detail: `docs/agent-rules/tunvn.md` dan
ARCHITECTURE §16.30.

## Kredensial Sekalipay gateway - 3 November 2026

Hanya penyimpanan lokal: `.sekalipay-gateway-credentials` (chmod600/git-ignored),
field `SEKALIPAY_GATEWAY_API_KEY` dan `SEKALIPAY_GATEWAY_SECRET_KEY`, terpisah
dari Sekalipay supplier. Rencana owner: NOWPayments untuk crypto dan Sekalipay
gateway untuk non-QRIS pada web AXVARA/bot Telegram. Belum dikerjakan; tidak ada
request API atau perubahan env/dashboard/checkout/bot. Detail: runbook pembayaran
dan ARCHITECTURE §16.16.

## Persiapan NOWPayments - 3 November 2026

Kredensial hanya lokal di `.nowpayments-credentials` (chmod600, git-ignored):
`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `NOWPAYMENTS_API_BASE_URL`.
API key final diterima `GET /merchant/coins` HTTP200; belum ada invoice/transaksi,
env Pages, endpoint IPN atau pembayaran crypto di checkout. Kolom IPN URL belum
diisi sampai receiver tersedia dan dirilis. Wallet/jaringan serta pengaturan
custody/withdrawal belum diverifikasi. Langkah berikutnya di
[runbook pembayaran](docs/agent-rules/payments.md) dan ARCHITECTURE §16.15.

## Persiapan Digiflazz buyer - 2 November 2026

Preflight lokal baca-saja: `node scripts/digiflazz-preflight.mjs --init` membuat
JSON `.digiflazz-credentials` privat600/git-ignored tanpa overwrite. Isi username
dan Development Key dari dashboard di editor lokal, lalu jalankan
`node scripts/digiflazz-preflight.mjs --check`; `--check --production` hanya jika
sengaja memakai Production Key. Key tidak dimasukkan chat/log/argv atau dikirim ke
VPS. CLI mengambil saldo/katalog lewat SSH VPS ber-IP tetap, tanpa order/deposit/
restart atau perubahan proxy. Egress langsung teramati `13.228.147.90` pada
2November; cek Development berhasil (saldo0, 73 produk akun, 9 Games), sedangkan
Production HTTP400 pada `cek-saldo`. Laporan kini mencakup semua SKU kategori Games tanpa
batas50, bukan hanya ML/FF, termasuk seller/deskripsi. Kredensial terisi privat;
snapshot minimum harga publik 4.380 produk/150brand tersimpan lokal git-ignored
`.digiflazz-catalog-public-20261102.json`. Ini bukan pilihan seller akun;
mengganti/menambah seller memerlukan sesi dashboard login, bukan API key saja.
Webhook/checkout topup belum tersedia dan jangan diaktifkan; tidak ada env Pages
baru. Pengaturan dashboard, reminder saldo, pemilihan seller dan batas tahap
berikutnya: [runbook Digiflazz](docs/agent-rules/digiflazz.md), ARCHITECTURE §16.14.

## WR Jaspay - 2 November 2026

Proxy VPS sudah dirilis dan terverifikasi health/hash; implementasi/verifikasi
terpadu Pages masih lokal. Dokumentasi WR resmi tetap `/api/v1`, bukan `/api/v3`.
Jaspay memakai `/wr/jaspay/{products,order,status,orders}` pada proxy existing,
terpisah dari Akun Premium; tidak memindahkan order lama atau menebak invoice.
Namespace `jaspay:` memakai mirror/link WR existing; availability adalah stok
unlimited, sedangkan batas jumlah disimpan terpisah di migrasi0091 dan wajib
ditegakkan server-side termasuk baris keranjang ganda. Detail di ARCHITECTURE
§16.8a dan AGENTS; tidak ada env/cron/secret baru.

Ref supplier stabil per idempotency key. Receipt hilang hanya boleh exact replay
Jaspay sesuai kontrak duplicate-ref; Premium tetap tidak boleh blind retry.
Webhook memakai signature body mentah dan data.invoice Jaspay. Partial/malformed
credentials tetap encrypted untuk tindak lanjut admin, bukan penyelesaian semua
item/repurchase/refund otomatis. Buyer melihat Diproses otomatis, bukan nama
supplier atau janji stok instan. Tidak ada order supplier nyata untuk QA.

Rilis proxy menyalin seluruh dist dengan backup `dist.backup-jaspay-20261102`;
env/state utuh, empat hash cocok, service active/health200/Jaspay tanpa token401.
Ini bukan bukti deployment Pages atau transaksi end-to-end.

## Detail varian Market dan kartu responsif - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. S&K/cara aktivasi kini mengikuti
pilihan yang sama dengan harga/keranjang/checkout, tanpa fallback varian pertama
pada produk multi-varian. Belum memilih menampilkan ajakan memilih; copy kosong
diberi keterangan, bukan mengambil varian lain. Deskripsi umum/perbandingan dan
ketentuan produk dipisahkan dari detail varian, tanpa menghapus teks penting.

Kartu promosi Market/Pedia tetap kanan-kiri di mobile, judul tidak terpotong;
Deskripsi umum tampil sebelum S&K varian; Produk Serupa
memakai teks desktop lebih besar dengan tampilan mobile tetap. Dropdown navbar
Market/Pedia menampilkan Layanan pada desktop/mobile, mempertahankan keyboard,
fokus dan nama aksesibel. Tidak mengubah API, pembayaran atau akses pembeli.

## Copy layanan dan refill Pedia - 3 November 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Migrasi data-only
`0093_pedia_service_copy_20261103.sql` (dibuat `scripts/generate-pedia-copy-20261103.mjs`
dari `src/lib/pedia/copy-20261103.json`) memperbarui nama/deskripsi tier IndoSMM aktif
dengan guard nama/deskripsi lama; order lama dan tier 285 tidak berubah. Katalog membaca
`refill_anchor`; chip `Instant Start` berasal dari nama layanan; halaman pesanan punya
satu blok Refill. Detail: `docs/ARCHITECTURE.md` §16.10d dan `docs/PRD.md`.

## Koreksi order Pedia - 3 November 2026

Paket UX jumlah/Sorotan/waktu/ringkasan dibatalkan sesuai keputusan owner;
kontrak katalog, pilihan jumlah dan daftar layanan kembali ke sebelumnya.
Redesign panel deskripsi dipertahankan: panel netral, statistik label–nilai
satu kolom mobile/dua kolom mulai sm, Refill/Drop bertumpuk di mobile, arti istilah
fitur di disclosure. Padding dan jarak mobile dirapatkan. Penghapusan teks Harga
acuan dan hitungan layanan di judul tetap berlaku. Implementasi untuk publikasi CI;
deployment belum diverifikasi. Detail: `docs/PRD.md`, `docs/DESIGN.md` dan
`docs/ARCHITECTURE.md`; tanpa perubahan harga server, env atau migrasi baru.

## Info layanan Pedia terpadu - 2 November 2026

Implementasi lokal; deployment belum diverifikasi. Panel di bawah pilihan memuat
deskripsi, arti HQ/Real, syarat khusus, garansi/drop, statistik dan glosarium.
Detail bawah digabung dan ringkasan tidak mengulang deskripsi; syarat unik tetap
terlihat desktop/mobile. Statistik refill bernama Pengajuan Refill (7 hari), bukan
Drop rate, dan hilang pada No Refill. Migrasi0090 memperbaiki copy akun lama dan
template Real dengan guard identitas/copy lama; edit admin dan snapshot order
tetap. Deskripsi masih kurasi `pedia_tiers.description_md`, bukan impor dashboard
otomatis. API resmi tidak mendokumentasikan field deskripsi; sumber dashboard
historis dicatat di [spec](docs/pedia/indosmm-catalog-refill-2026-11-01.md).
Tidak ada env, cron, schema, harga atau kontrak pembayaran baru.

Penyempurnaan 2 November 2026 (lokal): `ServiceInfoCard` menaruh angka layanan
(Start time/Speed/Avg time/Min-Max/Success rate) di atas judul Info layanan dengan
satu caption estimasi; definisi HQ/Real/No Refill/Drop di `src/lib/pedia/terms.ts`
dipersingkat tanpa peringatan berulang (risiko drop hanya di baris Drop). Di PDP
Market, `ProductCopy.tsx` memakai judul bagian 13px huruf biasa, langkah aktivasi
tunggal tanpa nomor dan link YouTube berlabel singkat (`linkLabel`, URL lain tampil utuh).
Koreksi owner 2 November: kotak Cara Aktivasi desktop Market kembali bersarang
seperti semula; judul 13px, langkah tunggal, label link dan fokus keyboard cyan tetap.
Penyederhanaan panel deskripsi Pedia tidak dibatalkan.

## Logo platform Pedia - 2 November 2026

Glyph sudah dipublikasi oleh CI commit `7774b0c`; URL lama masih dapat tersimpan
di cache CDN/browser. Perbaikan cache-busting disiapkan untuk publikasi CI. Empat kotak
huruf Coub/Lazada/Rutube/SnackVideo diganti glyph logo asli satu warna per platform,
tanpa background aplikasi atau gradasi; sumber resmi/mirror dicatat dalam pemetaan.
Medium tetap memakai crop wordmark resmi; Website Traffic tetap globe generik.
`PlatformIcon` tetap memakai aset lokal SVG untuk semua platform, tanpa
request CDN pihak ketiga saat runtime. Empat logo pengganti memakai `?v=20261102`
di `PlatformIcon` agar melewati cache URL lama; naikkan versi jika SVG tersebut diubah.
Header cache global dan URL 30 logo lain tetap. Pemetaan 34 platform dan sumber: [Ikon platform](docs/PEDIA-DESIGN.md#ikon-platform---pemetaan-2-november-2026).

> **13 November 2026 (keputusan owner, implementasi lokal; publikasi CI):** IndoSMM kembali menjadi SATU-SATUNYA supplier dan katalog kurasi IndoSMM yang tersisa di D1 dipakai lagi untuk penjualan baru (`PEDIA_SALE_PROVIDER='indosmm'`). Kode ProviderSMM/otomatis DIHAPUS (`auto-catalog`, `metadata-refresh`, `supplier-descriptions`, proxy `/psmm/*`, jalur materialisasi/deskripsi, `pedia_diff_*`, panel khusus); diff VPS `source:"providersmm"` dibalas 200 `{ignored:true}` tanpa tulis D1 hanya selama VPS masih mengirim. Migrasi `0117` beserta kolom `managed`/`managed_snapshot_at` DIPERTAHANKAN (prod sudah menerapkannya) tetapi inert sejak 13 November. Order lama dengan supplier tak dikenal dirender generik dan tidak pernah dispatch. Minimum order/ambang saldo dibaca dari env (`ops-config`); GET admin settings mengembalikan nilai efektif. Bagian 12 November di bawah adalah snapshot historis yang digantikan. Bootstrap produksi, deployment, dan reaktivasi tier adalah paket data terpisah. Migrasi data `0119_pedia_providersmm_purge.sql` (purge idempoten/FK-safe data provider lama) dan `0120_pedia_indosmm_reactivate.sql` (21 tier kurasi IndoSMM kembali aktif; 149 kandidat lain sengaja tetap nonaktif karena 0089) menyusul. Panel admin Pedia (13 November 2026): shell + status strip (saldo IndoSMM, produk dijual x/y, pesanan perlu tindakan) dan 4 tab Pesanan·Produk·Layanan IndoSMM·Pengaturan (peta `?tab=` lama: services/curation → Layanan IndoSMM, credits → Produk), komponen `src/components/admin/pedia/{OrdersPanel,ProductsPanel,ProductEditor,ServicesPanel,SettingsPanel,shared}`, per-tab loading; "Arsip lama" dihapus (API kredit tetap), kurasi = "Bandingkan per kebutuhan", minimum order/ambang saldo read-only dari konfigurasi server, payload mutasi tidak berubah. Status: implementasi lokal; publikasi melalui CI.

## Katalog otomatis Pedia (ProviderSMM) — 12 November 2026

Implementasi lokal; publikasi lewat CI. Bootstrap produksi, deployment, dan QA
admin produksi belum dijalankan — ini bukan status live.

- **Supplier jual.** `src/lib/pedia/sales-policy.ts` menetapkan
  `PEDIA_SALE_PROVIDER='providersmm'` (IndoSMM = riwayat) sebagai satu-satunya
  sumber gate katalog, pembanding harga, quote, order, draft/aktivasi admin,
  shortlist kurasi, dan overview. Penjualan baru IndoSMM ditolak
  `409 provider_retired`, tetapi retry order tersimpan dicari lewat `quote_id`
  sebelum gate; dispatch/poll/refill tetap memakai supplier asli per item. Diff
  VPS ProviderSMM ditulis ke cermin D1 (`applyPediaDiff`, checkpoint
  `pedia_diff_*`), dan tier/produk/snapshot lama tidak pernah di-remap.
- **Skema.** Migrasi `0117` menambah `managed` (`curated` default / `auto`) pada
  `pedia_products` DAN `pedia_tiers`, serta `pedia_tiers.managed_snapshot_at`
  (versi snapshot resmi saat rekonsiliasi). Tidak ada tabel samping deskripsi.
- **Materialisasi.** `src/lib/pedia/auto-catalog.ts` membangkitkan satu
  produk+tier `managed='auto'` per layanan (slug `psmm-<service_id>`, G2 default,
  paket kanonis dari batas API, `input_kind='comments'` hanya untuk Custom
  Comments), maksimal 25/pemanggilan. Kepemilikan diperiksa sebelum mutasi; baris
  kurasi tidak pernah diubah; alasan mesin boleh pulih, sedangkan `manual`/
  `margin`/`NULL` tidak pernah dihidupkan mesin. Baris yang dijeda tetap
  direkonsiliasi metadata + cap versinya tanpa diaktifkan.
- **Deskripsi resmi.** `https://providersmm.id/services` diparse `HTMLRewriter`
  native workerd (allowlist, redirect manual, timeout 15 dtk, batas 3 MiB) menjadi
  SATU snapshot JSON tervalidasi di `store_settings` (≤1 MiB), bukan tabel. Baris
  >3000 karakter ditandai `oversize` dan tidak dijual (tidak dipotong). Snapshot
  dibaca sekali per request; tidak ada fetch per pembeli.
- **Refill.** Hanya dijanjikan bila sumber menyebut durasi eksplisit DAN anchor
  eksplisit yang koheren; `No Refill`/`Tidak Bergaransi` menang lebih dulu; klaim
  tanpa durasi (`api_refill` saja) = `warranty_unconfirmed` (tidak dijual); durasi
  "bulan" tidak dikonversi paksa.
- **Antrean durable.** Satu baris `store_settings.pedia_pending:<id>` berisi token
  generasi acak; enqueue = upsert token (`INSERT…SELECT`, bukan loop per ID) dan
  ack = `DELETE … WHERE key=? AND value=?` (CAS), sehingga enqueue ID yang sama di
  antara pembacaan cermin dan ack tidak hilang. Drain 20/request memutuskan
  aktif/nonaktif dari `present` cermin terkini (`present=0` tidak pernah
  dihidupkan ulang); sisa tetap pending untuk tick berikut.
- **Commit atomik.** Snapshot + enqueue SEMUA layanan present + penanda kesegaran
  ditulis dalam satu `D1.batch`; kegagalan statement mana pun me-rollback ketiganya
  sehingga last-good lama tetap otoritatif. Refresh berjalan otomatis dari
  heartbeat `supplier-sync` terautentikasi (throttle >6 jam) dan dari resync admin
  pertama.
- **Gate penjualan.** Katalog/quote/order baru hanya menerima baris `auto` supplier
  jual dengan layanan live valid, deskripsi `ok`, dan cap versi = snapshot aktif;
  gate fail-closed (baris tanpa cap tidak dijual). Quote menandatangani
  `terms_version` = versi snapshot, dan order BARU menolak token tanpa versi/beda
  versi (409 `service_unavailable`) setelah retry order tersimpan dilayani.
  Nama/deskripsi publik white-label; payload tanpa ID/biaya supplier.
- **Admin.** Ringkasan `managed_*`, alasan berlabel manusiawi, antrean, kesegaran
  deskripsi; resync "Tarik ulang" resumable (`cursor`/`done`, anti-loop, lanjut
  dari cursor terakhir, `refresh` hanya request pertama); filter kelayakan di SQL
  sebelum `COUNT`/`LIMIT` dengan default semua tipe (kompatibilitas OFF); filter
  supplier memuat kedua provider untuk diagnosa riwayat. Baris/produk `auto` hanya
  menerima pricing, jeda, dan tampilan aman; aktivasi menolak baris yang masih
  diblokir mesin atau belum layak (409 `managed_ineligible`).
- Fixture dev aman (tanpa supplier/secret): `node scripts/pedia-managed-fixture.mjs`.
  Comment Likes/Invites tetap tidak didukung.

## Pedia IndoSMM: katalog, drop/refill dan halaman Refill — 1 November 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Snapshot ini
mencatat kebijakan IndoSMM-only yang berlaku saat itu; keputusan 12 November 2026
di atas menggantikannya untuk penjualan baru. ProviderSMM
diputus: tidak ada cek saldo/notif Telegram, diff VPS ProviderSMM dibalas `ignored`.
Migrasi0085 menambah `pedia_service_stats` + `pedia_tiers.drop_label/speed_per_day`;
0086 menambah 124 layanan IndoSMM + 3 produk komentar, menonaktifkan 6 layanan
gagal. Istilah SMM (No Drop, Less Drop, High Drop, Refill 30 Days, No Refill) tampil
dengan penjelasan singkat; halaman `/refill` mendukung refill API dan manual.
Teks pembeli white label 100% AXVARA tanpa menyebut supplier. Revisi2November: migrasi0089 menyeragamkan nama ([Metrik] [Wilayah] [Kualitas], refill/drop hanya chip) dan merapikan layanan kembar 431→280; harga komentar per 10 komentar. Statistik layanan disegarkan cron lite existing maks 1×/jam dari alat publik
IndoSMM. Tahap 2: migrasi0087 `input_kind` (komentar custom satu per baris) dan0088 (+162 layanan, live views/likes, watchtime, komentar custom; 432 layanan aktif). Tidak ada env/secret/cron baru. Detail: [spec](docs/pedia/indosmm-catalog-refill-2026-11-01.md).

## Perbaikan checkout Pedia gagal tersimpan — 1 November 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Sebagian besar
layanan Pedia gagal dipesan dengan pesan "Pesanan belum tersimpan" karena FK
`pedia_order_items.tier_id` masih menunjuk tabel arsip tier sejak migrasi 0062.
Migrasi0084 me-rebuild tabel itu dengan FK ke `pedia_tiers` tanpa mengubah data;
route order mencatat error D1 ke console. Tidak ada env/cron/kontrak API baru.
Detail: ARCHITECTURE §16.10a.

## Status aktual Pedia vs handover Market — 2 November 2026 (backend + UI)

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi.
Guard fulfillment generik no-op untuk Pedia (tanpa baris Market baru), nama
email seperti Market, Telegram/admin API membaca item Pedia durable, lookup/
status jujur (counts durable, ETA tier saat ini yang dapat kosong, nama snapshot), halaman pembeli menampilkan
lifecycle aktual + 4 sel hitungan + polling 5/10/30 dtk (unknown/fetch-awal-gagal
self-retry 10 dtk, terminal berhenti), pintu Market
dialihkan ke host Pedia, email paid/processing/completed fenced (paid
independen, processing menunggu resi durable dan jumlah awal/sisa valid
pada submitted/in_progress (0 valid); belum siap tidak mengklaim percobaan,
discovery processing siap tetap bounded dua item/fase tanpa batas 24 jam,
sementara paid/completed tetap 24 jam; email terkirim lama tidak dikirim ulang;
stale terminal
disupresi; tampilan seperti Market; completed memakai Refill N Days;
bounded at-least-once melalui forward sender Resend tanpa idempotency key) +
retry bounded di cron existing; ledger due tetap retry lebih lama.
Kontrak cron: cron `pedia_orders`
tidak memindai item terminal; start_count validasi number/string-only
(boolean/object/array ditolak), safe-nonnegative-integer, slot NULL/0
dikoreksi positif, positif dipertahankan, real-0 settled; koreksi historis
HANYA script operator satu-kali `scripts/pedia-recount-start-count.mjs`
(dry-run default, allowlist wajib maksimal 50 kode, maksimal tiga status-read
per item per invocation, wajib status terminal supplier, count-only, tanpa
dispatch/bayar/email/refill atau marker). Setelah maintenance dan env proxy
existing tersedia, dari root jalankan dry-run dengan target D1 eksplisit:
`node scripts/pedia-recount-start-count.mjs --database axvara-db --remote --code AXP-20261102-35D31DA7`.
Periksa hasil, lalu ulangi dengan `--apply` hanya bila disetujui; tanpa `--remote`
target lokal. Memerlukan Node, npx/Wrangler dan kredensial D1 operator. Tidak ada
retry otomatis; halaman terminal yang sudah terbuka perlu dibuka ulang setelah
koreksi. Koreksi historis produksi belum dijalankan.
Link `pedia.axvara.tech/pesanan`. Detail: docs/PRD.md + docs/PEDIA-PRD.md.

## Bantuan dan ketentuan Pedia — 1 November 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. `/bantuan`
dan `/ketentuan` Pedia mengikuti gaya Cara order dan Ketentuan Market (kartu
glass, accordion, deret tombol); isi usang diperbarui tanpa mengubah aturan.
FAQ Lacak tidak lagi menyebut PIN. Footer Pedia membuka Cara order Pedia dan
tautan lintas host memakai URL subdomain kanonis. Tidak mengubah API/kontrak.

## Koreksi orbit mobile Pedia — 31 Oktober 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Orbit Pedia
kembali tampil pada mobile/tablet di bawah teks hero seperti Market, desktop tetap
di kanan; aturan desktop-only16Oktober digantikan. Mode hemat/reduced motion tetap.
Pencarian navbar Market/Pedia menyisakan X putih custom dengan menyembunyikan
cancel biru bawaan WebKit/Chromium. Tidak mengubah filter atau kontrak backend.

## Perbaikan storefront — 31 Oktober 2026

Implementasi lokal untuk publikasi CI; deployment belum diverifikasi. Pencarian
Market dari checkout/detail dapat dikirim dengan Enter atau tombol cari untuk
membuka katalog tanpa kehilangan query. Anchor menghindari navbar; kontrol cart
44px dengan label kontekstual dan teks sekunder kartu lebih terbaca. Drawer260ms,
modal/badge serta scroll pencarian menghormati reduced motion; kedua orbit dapat
berhenti/mulai saat preferensi berubah tanpa melewati gate visibility existing.
Gagal harga Pedia menyediakan tombol coba ulang dan status aksesibel, tetap
menjaga jumlah/layanan/draf dan pemeriksaan harga sebelum pembayaran. Tidak ada
dependency/env/migrasi/cron baru atau perubahan keamanan/kontrak order.

## Snapshot invoice, kontak dan PIN, 28 Oktober 2026 (PIN web diganti 16 November)

✅ Implementasi lokal untuk publikasi CI. Email produk siap berisi **kredensial
lengkap + PIN enam karakter** pada pesan yang sama. Tidak ada email PIN lebih awal,
PIN dalam respons checkout, kartu PIN di web atau PIN dalam pesan Telegram.

Pada tab checkout Market asli, kredensial otomatis muncul sesudah pembayaran
terverifikasi dan akun siap, tanpa memasukkan PIN. Bukti checkout khusus c1 hanya
terbit dari quote bertanda tangan yang cocok order durable; disimpan privat di
tab24jam dan tercabut oleh rotasi versi. Lookup biasa tidak menerbitkan c1.

Untuk akses kredensial lewat lacak tanpa bukti checkout asli, pembeli mengisi invoice + email/WA checkout + PIN.
Form lacak tanpa helper di bawah field; label PIN menyebut email checkout, dengan
pesan validasi tetap tampil untuk input salah.
Lacak status sebelum email siap memakai invoice+kontak, atau sesi status tab dari
checkout. Sesi ini tidak membuka kredensial atau mengizinkan mutasi. Sesudah proof
kontak+PIN atau bukti checkout asli, capability kuat dapat disimpan sessionStorage untuk kunjungan ulang;
PIN tidak disimpan di browser atau URL. Legacy v0 tetap kontak, kode26 lama tetap
berlaku. Pedia tanpa kredensial memakai kontak untuk status/refill.

Migrasi0083 menambahkan versi proof pada capability; token PIN6 yang diterbitkan
kebijakan lama tidak bisa melewati pemeriksaan baru. Admission PIN tetap10/15menit
per order+versi lintas IP. Rotasi admin mengantrekan email kredensial+PIN baru hanya
untuk order paid yang kredensialnya tersedia. Antrean email PIN awal yang lama
berhenti diproses tanpa penghapusan metadata. Tidak ada key/env/dependency/cron
baru; BUYER_ORDER_ACCESS_SECRET existing dan provider pembayaran tetap.
Bot WhatsApp nonaktif, tidak diubah atau diaktifkan. [Runbook](issue/buyer-contact-pin-2026-10-28.md).

## Proteksi admin Access — 27 Oktober 2026

✅ Cloudflare Access aktif untuk admin; guard origin diverifikasi lokal dan
dipublikasikan melalui CI. Login memakai email owner terkonfigurasi dan password
existing, didahului PIN email + MFA Cloudflare (Google Authenticator didukung).
Access melindungi `/admin`, `/api/auth`, `/api/admin` di apex/www/Pedia. API admin
yang berbagi path publik juga mewajibkan JWT Access bertanda tangan di origin,
di samping cookie aplikasi; pembeli, bot dan webhook tidak mendapat tantangan ini.

Pages produksi memakai dua **secret_text** baru `CF_ACCESS_TEAM_DOMAIN` dan
`CF_ACCESS_AUD`; `ADMIN_EMAIL` existing diganti tanpa mengubah password/hash/JWT
secret. Sesudah tambahan key buyer: produksi63+4 sistem=67/128 Paid. Guard
produksi gagal tertutup bila
konfigurasi/token/verifikasi tidak valid; dev tanpa kedua env tetap memakai
fixture lama. Sesi Access8jam melapisi JWT8jam + idle2jam aplikasi.

Enrollment pribadi: [portal AXVARA](https://axvara-admin-9d00b9.cloudflareaccess.com/AddMfaDevice),
masuk dengan email owner/PIN inbox, pilih Authenticator application, pindai QR
dan verifikasi6digit langsung di Cloudflare. Jangan mengirim seed/kode ke chat.
Portal enrollment punya policy satu owner tersendiri, tanpa kewajiban faktor
sebelum faktor pertama didaftarkan; token portal tidak membuka API aplikasi.
Enrollment TOTP/biometrik dan login Access owner sudah terkonfirmasi; login
aplikasi sesudah rilis CI tetap perlu dicoba owner. Lihat
[runbook keamanan/pemulihan](issue/admin-access-2026-10-27.md).

## Timeout pembelian WR — 27 Oktober 2026

✅ Implementasi lokal dan fixture; publikasi CI. Request timeout/5xx ambigu tidak
diulang membeli. Jika ID invoice hilang, verifikasi invoice di WR lalu gunakan
**Pesanan → Hubungkan invoice WR**. Endpoint sync-now admin memverifikasi
exact-ID/identitas varian/qty/modal/paid dan mengikat invoice atomik sebelum
completion existing meneruskan akun. Konflik, metadata tidak cocok, atau invoice
di luar50 transaksi terbaru ditahan, bukan ditebak. Nama dan waktu saja bukan
bukti karena akun WR bisa digunakan membeli manual.

Cron/status pembeli tetap menyegarkan invoice existing dalam budget40; webhook
terminal unmatched mendapat503 supaya WR mengulang. Respons/error terlambat
tidak menurunkan completed/failed. Tidak ada env/migrasi/proxy/cron baru.
Kasus `AXV-20261027-2664E813` sudah delivered di produksi melalui invoice
`RBHN-20261027-3C99F5` pada27Oktober14.36WIB, tanpa pembelian ulang; backup privat
di luar repo. [Bukti dan batas verifikasi](issue/wr-timeout-recovery-2026-10-27.md).

## Audit keamanan OWASP — 27 Oktober 2026

✅ Implementasi dan fixture lokal; publikasi melalui CI. Audit memakai kategori
[OWASP Top 10:2025](https://top10.owasp.org/2025/), dengan bukti dan batas verifikasi
di [laporan audit](issue/owasp-audit-2026-10-27.md); ini bukan sertifikasi OWASP.
Detail editor `/api/products/:id` kini hanya untuk admin, dengan cache privat.
Artikel publik memakai whitelist field; email penulis/reviewer dan metadata alur
editorial hanya di respons admin privat. Halaman artikel memakai nama AXVARA.
Reservasi checkout memeriksa harga quote, produk induk aktif dan relasi varian
di batch atomik yang sama; retry pemenang quote tetap memakai order tersimpan.
Guard yang sama diterapkan pada batch order Telegram/WhatsApp.

Login tetap dibatasi5/menit per proses dan kini maksimal10 percobaan valid-format
gagal/in-flight per IP dalam jendela tetap15menit di D1. Login valid hanya mereset
bucket IP itu. Error admission→503; limit→429+Retry-After. IP kantor/NAT berbagi
batas, dan rotasi IP tetap keterbatasan. Challenge GET/body malformed tidak mereset
bucket; malformed tidak menjalankan pemeriksaan password/proof.
Challenge PBKDF2 baru mengikat akun lewat HMAC, tanpa email admin dalam JWT
publik; challenge bertanda tangan lama tetap diterima sampai expiry5menit.
Migrasi0080 menambah `security_auth_attempts` dan `security_events`; HMAC memakai secret admin
existing, tanpa env baru. Event login dan otorisasi mutasi/baca sensitif admin
tidak menyimpan IP mentah, kontak, token, body atau query URL. Event otorisasi
tidak menyatakan mutasi berhasil. Polling admin biasa tidak membuat event D1.
Limit login dicatat di console; audit D1 gagal memakai fallback console.
Cleanup hourly existing membuang maksimal200 counter>24jam dan500 event>30hari.
Retensi/penerimaan alert console produksi belum dibuktikan dalam audit ini.

Endpoint pembeli JSON dibatasi sebelum parse: quote/order32.000byte, login/
lookup/kredensial/cancel/refill/subscriber8.000byte. Webhook mempertahankan batas
existing16.000–128.000byte, kini menghitung stream aktual sebelum buffer/parse;
body mentah signature tetap. Supplier-sync maksimal2MiB dan MCP8MiB, sebelum
parse; payload/ID JSON-RPC invalid ditolak. Header CSP/Permissions-Policy dan
header browser lain ikut respons rewrite Pedia, redirect dan error middleware.

Dependency runtime dipatch (Zod4.6.7, gateway Fastify5.12.7/Sharp0.35.5 dan
transitif terkait). CI menjalankan audit read-only root+gateway sebelum build;
high/critical runtime atau hasil registry tidak valid menghentikan rilis.
Tiga high toolchain dev sebelumnya ditutup dengan Miniflare4 beserta patch
Undici/Sharp, tanpa mengganti adapter Pages; audit lengkap kembali nol pada27Oktober. Jangan membuka emulator/dev ke jaringan publik.
[Bukti dan exception dependency](docs/security/dependency-audit-2026-10-27.md).

## Pembatas checkout — 27 Oktober 2026

✅ Implementasi terverifikasi; publikasi melalui CI. Market/Pedia berbagi
limiter D1: maksimal5 checkout baru/IP,3/WA,3/email per jendela tetap15menit.
Kuota diklaim sekali per quote, termasuk retry paralel; order existing dipakai
kembali. Batas tercapai→429+Retry-After; error limiter→503 sebelum membuat
order/invoice atau mereservasi stok. Tidak ada fail-open produksi.

API Games B1 lokal juga memakai limiter yang sama (namespace klaim quote
`games:<jti>`, batas kontak/IP bersama); belum merupakan bukti deployment Games.

Migrasi0079 menambah checkout_attempts dan checkout_claims; hash subjek memakai
HMAC-SHA256 dengan ADMIN_JWT_SECRET existing. IPv6/email dinormalisasi. Cleanup
existing menghapus maksimal200 klaim dan200 counter berumur>24jam per housekeeping;
tidak menambah env/cron. WAF/in-memory serta guard Telegram/WhatsApp tetap berlaku.
Shared-IP/NAT berbagi batas; bot dengan IP/kontak baru tetap merupakan keterbatasan
proteksi ini. Bukti regresi dan pembersihan order palsu atas instruksi owner:
[laporan insiden](issue/checkout-abuse-2026-10-27.md).

## UX pembelian Pedia — 27 Oktober 2026

✅ Implementasi; publikasi melalui CI. Daftar layanan kini ringkas dengan harga
di samping nama, filter/urutan di atas, pilihan aktif tetap terlihat saat difilter (digantikan1November: filter yang tidak mencakup pilihan melepasnya; ada filter No Refill, hitungan di atas daftar),
detail terbuka dan CTA di dekat total. Logo platform tetap; pill kebutuhan memakai
target44px dan aksi “Semua kebutuhan” pada mobile. Draf per kebutuhan tersimpan
selama halaman terbuka, tanpa membawa target atau quote ke kebutuhan berbeda.
Grid desktop mulai1280px; rail sticky hanya jika muat, mobile memakai satu kolom.

Komponen: `NeedPicker`, `ServicePicker`, `PlatformPageClient`, `OrderClient`.

Revisi 13 November 2026 (implementasi lokal; publikasi melalui CI): kebutuhan diringkas
satu pill per metrik, sedangkan `ServicePicker` menampilkan seluruh varian dari semua
produk bermetrik sama (delapan awal + "Tampilkan semua", pilihan aktif selalu terlihat).
Label pendek, dedupe, dan qualifier/"Varian n" berasal dari `src/lib/pedia/display-name.ts`
(`shortPediaName`, `pediaVariantNames`, `groupPediaMetrics`), dan nama lengkap tetap tampil
di `ServiceInfoCard`. Memilih varian produk lain meneruskan slug pemilik + tier ke
`PlatformPageClient` dan tetap membawa jumlah, target, checklist, serta kontak.
Kontrak harga/quote/retry/QRIS dan supplier tidak berubah. Rincian:
[spesifikasi UX](docs/pedia/purchase-ux-2026-10-27.md) dan
[laporan verifikasi](issue/pedia-purchase-ux-2026-10-27.md).

## GoPay Merchant pribadi — 27 Oktober 2026

✅ Implementasi terverifikasi, Pages dirilis melalui CI. Invoice baru kembali
memakai **Axvara Digital / G564039370**, NMID ID1024342457479, nomor082135277434.
QR owner cocok dengan merchant/nomor/outlet aktif dan sesi GoBiz yang diperiksa
baca-saja. Payload privat di `.gopay-credentials` ignored/chmod600; hanya tiga
secret_text Pages existing diubah: GOPAY_STATIC_QRIS, GOPAY_QRIS_ENABLED=true,
QRIS_ACTIVE_PROVIDER=gopay. Secret poller dan kredensial/callback KlikQRIS tetap.
Invoice lama tidak dipindahkan provider/merchant, termasuk initializing KlikQRIS
yang tetap recovery GET-only. Tidak memakai layanan/API AutoGoPay.

Pola [AutoGoPay](https://autogopay.site/docs) diterapkan di server sendiri:
reuse invoice/QR saat klik ulang, expiry15menit, maksimal satu pengganti setelah
expiry dan order masih hidup, callback HMAC-SHA256 atas body mentah. QR dihitung
lokal, tanpa generate upstream. Pemilihan GoPay yang tidak lengkap gagal tertutup,
tanpa fallback DANA. Callback wajib merchant/nominal/order/waktu bayar/status
settlement|capture yang cocok dan signature x-poller-signature selain secret;
paid/event/outbox disimpan atomik sebelum background fulfillment existing.

Poller memakai satu loop, gate15/30/60detik menurut umur invoice terbaru, minimal
15detik meski wake/tick ditekan berulang, dan nol GoBiz saat idle. State gate,
backoff dan hold per merchant durable. Sejak29Oktober, SDK memeriksa expiry sesi
sebelum GET di dalam gate; token valid tidak menambah request refresh. Retry401
tetap satu kali dari SDK, tanpa refresh manual kedua sesudah kegagalan.
Sesi mati/restriction/persist gagal menjeda akun sampai
sesi diganti manual. Transport dibatasi GET mutasi + POST token refresh tanpa
redirect. Ini mengurangi request berulang, bukan jaminan bebas suspend; penyebab
suspend lama belum diketahui. QA memakai fixture tanpa pembayaran/supplier nyata.

Rilis VPS poller bertanda tangan harus mendahului push receiver Pages. Backup
seluruh dist, sesi dan env, lalu salin seluruh dist; jangan reset state. Rollback
receiver baru tetap membutuhkan poller bertanda tangan. Source di folder lokal
axvara-gopay-poller, snapshot lengkap di issue/patches/gopay-hardening-2026-10-27.patch
(ekstrak pada direktori kosong). Detail kontrak/rollout ada di
[ARCHITECTURE](docs/ARCHITECTURE.md) dan
[catatan verifikasi](issue/gopay-return-2026-10-27.md).
Terapkan patch lanjutan `issue/patches/gopay-session-expiry-2026-10-29.patch`
sesudah snapshot. Pemulihan29Oktober sudah dirilis ke VPS dengan24test lulus
dan refresh201, tanpa invoice aktif untuk membuktikan pembayaran otomatis baru.
Lihat [insiden expiry](issue/gopay-session-expiry-2026-10-29.md).

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

## Pemulihan order supplier dan pekerjaan pembayaran — 25 Oktober 2026

KlikQRIS mempertahankan pekerjaan sesudah paid melalui Cloudflare `waitUntil`;
pengecekan status pembeli tidak menunggu pembelian supplier/notifikasi. Outbox dan
cron existing tetap jalur pemulihan bila pekerjaan server terputus. Item WR/SK
diikat sebelum fulfillment umum, lalu upaya segera dibatasi satu link per
supplier untuk order tersebut; link lain dilanjutkan cron. Dev/test tanpa request
context menunggu task yang sama.

Link SK yang ambigu tidak dibeli ulang otomatis. Error lookup dicatat aman pada
panel admin;404 saja tidak membuktikan saldo belum terpotong. Pemulihan manual
harus mencocokkan ref_id, riwayat dan debit supplier, mempertahankan referensi
order yang sama. Kasus25Oktober berhasil dipulihkan sampai email pembeli terkirim;
lihat `issue/sk-vps-reliability-2026-10-25.md`. Tidak ada cron/env/migrasi baru.


Respons5xx generik, receipt sukses tanpa ID pesanan/invoice, atau ref_id SK yang
tidak cocok diperlakukan ambigu dan tidak dibeli ulang otomatis. Penolakan
`PRODUCT_TEMPORARILY_UNAVAILABLE` SK yang eksplisit tetap boleh retry biasa.

## Produk pasangan WR/SK yang dinonaktifkan — 25 Oktober 2026

> Histori: model pasangan digantikan Grup produk lintas supplier pada0129
> (16 November2026); ketentuan OFF manual tetap dipertahankan.

Produk OFF manual tidak lagi ikut memenangkan pasangan. Jika ChatGPT WR OFF dan
SK ON, SK menjadi wakil katalog; jika kedua sisi ON, stok/modal/preferensi kembali
menentukan. Sisi yang OFF tetap OFF, dan wakil dengan stok habis tetap mengikuti
kartu habis. Toggle/simpan admin memperbarui pasangan terkait sebelum daftar dimuat
ulang; kegagalan rekalkulasi dilanjutkan cron existing. Daftar publik dapat
tertinggal hingga cache Market30detik.

Migrasi0078 menambahkan invalidasi perubahan aktivasi dan mengantrekan ulang
keputusan lama (maks10pasangan/tick cleanup existing). Token versi/CAS, stok,
kontrak order lama, env dan jadwal cron dipertahankan. Perubahan diterbitkan via
CI main; jangan menjalankan migrasi/deploy manual untuk perbaikan ini.

## Siaran tersimpan dan sambutan anggota WA — 24 Oktober 2026

✅ Admin **Konten → Siaran** (`/admin?section=broadcasts`): buat/simpan template teks
+ judul/subjek + CTA HTTPS opsional, salin, edit, arsip/pulihkan, pakai ulang.
Editor Template baru/Edit template memakai dialog tengah seperti modal admin lain
(koreksi 14 November 2026, implementasi lokal; publikasi lewat CI), dengan scroll
adaptif dan konfirmasi perubahan belum tersimpan.
Pilih Grup WhatsApp / Subscriber email / Pengguna Telegram, Tinjau, lalu Kirim.
Menyimpan saja tidak mengirim. Riwayat30 siaran terakhir berisi jumlah per status,
refresh manual dan Hentikan antrean belum diproses. Hasil belum terkonfirmasi
mempertahankan satu ID permintaan untuk retry aman. Tidak ada gambar/lampiran atau
penjadwalan baru dalam fitur ini. Maksimal200 template, pesan3000 karakter.

Migrasi `0077_admin_broadcasts.sql` menambah empat tabel broadcast, token berhenti
langganan email dan opt-out Telegram. Pengiriman memakai cron lite `promo` existing
(maks8 penerima/20detik dengan budget40 statement), lease global, jeda kanal dan
Retry-After; tidak ada env/secret/cron/resource baru. Email individual via Resend
existing dengan key idempoten tetap dan jendela retry23jam. Telegram positif
pribadi terdaftar, `/stop` / `/siaran_on`; pengguna yang belum pernah membuka bot
tidak bisa dipaksa menerima pesan. Unsubscribe email GET konfirmasi, POST perubahan;
subscriber yang mendaftar lagi memperoleh token baru. Daftar penerima dan pesan
tersalin atomik per peluncuran, opt-out diperiksa lagi sebelum kirim. Timeout
Telegram/hasil WA ambigu perlu diperiksa, tanpa replay buta.

Gateway menambah `/send-broadcast` dan `/send-welcome`, memakai grup pin AXVARA'S,
nomor/revisi aktif, ledger PG dan pacing60detik yang sama dengan invoice. Tidak
membuka DM atau rotasi akun otomatis. Pergantian nomor memerlukan Tinjau siaran
baru. Sambutan dipicu `group-participants.update` action add saja, diteruskan ke
`POST /api/whatsapp/group-events` bertoken existing, diverifikasi ulang dan diantre
idempoten di outbox existing/cron notify_b. Batch anggota yang sama dalam hariUTC
dan identitas bot sama disambut sekali; event saat gateway offline tidak dibackfill.
Nama dari data kontak event bila tersedia, fallback Kak; sapaan WIB dan bingkai
lama dipertahankan, tautan order web/TG dan bantuan `/wa`. Chat/emoji/reaksi tidak
menyambut; pencarian legacy eksplisit `cari <produk>`. Tidak menyalakan commerce WA.

Kontrak, batas pengiriman dan QA: [spec siaran](issue/broadcasts-welcome-2026-10-24.md),
[ARCHITECTURE §16.13](docs/ARCHITECTURE.md#1613-siaran-admin-dan-welcome-anggota--24-oktober-2026).

## Salinan email pembeli Telegram — 4 November 2026

Implementasi lokal, publikasi melalui CI (deployment belum diverifikasi). Pembeli
Telegram yang pesanannya memuat produk wajib email (WR Invite/Link atau centang
**Wajib email pembeli**) ikut menerima email AXVARA seperti pembeli web: Pesanan
Siap berisi isi produk/kredensial, tanda terima, dan kabar serah terima/gagal
kirim. DM Telegram tetap kanal utama; email salinan best-effort dan idempoten.
Detail: [ARCHITECTURE](docs/ARCHITECTURE.md) (Paritas pengiriman Telegram).

## Notifikasi penjualan WA, admin Telegram, dan link grup — 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Admin → **Pengaturan Toko → Link grup
WhatsApp** menyimpan satu undangan untuk seluruh tombol grup di Footer Market/Pedia
dan Link Bio. Perubahan terlihat langsung pada tab penyimpanan dan diperbarui pada
tab lain/fokus berikutnya; tidak perlu edit kode. Fallback URL lama tetap sampai
link baru disimpan. Link undangan publik ini terpisah dari ID grup tujuan bot.

Notifikasi Telegram admin memuat pembayaran/status pesanan/waktu WIB dan tombol
**Lihat pesanan pembeli**. Tombol membuka lacak pesanan melalui sesi admin valid,
tanpa memasukkan invoice/kontak dan tanpa membagikan token akses pembeli. Supplier
otomatis tidak lagi ditandai perlu dikirim admin; kegagalan supplier diberi status
perlu pemeriksaan, sedangkan produk manual tetap meminta pengiriman manual.

Bot pilihan admin (awal **6283181632507**) memakai Baileys + auth/idempotensi Postgres di app Heroku
existing. Grup **AXVARA'S** hanya menerima pesanan lunas dengan semua unit selesai,
judul menurut kanal WEB/TELEGRAM/WHATSAPP, status/jam WIB dan identitas disamarkan.
Invoice asli, nomor/email, target, akun dan link akses pembeli tidak diumumkan.
Scanner maksimal4 pada cron notify existing, tanpa cron baru; gateway maksimal
satu percobaan baru/60detik, timeout ambigu tidak otomatis dikirim ulang.

**Pengiriman belum aktif sebelum pairing owner:** sesudah rilis buka Pengaturan
Toko → Hubungkan nomor bot → tautkan dari WhatsApp nomor tersebut → masukkan bot
ke grup AXVARA'S (admin grup jika grup membatasi pengiriman) → Cek koneksi →
Aktifkan notifikasi. Hanya transaksi dibayar sejak aktivasi yang baru diantrekan;
antrean yang sudah tersimpan tetap dipertahankan saat offline/nonaktif. Tidak ada
jaminan bebas pembatasan WhatsApp. Pemeriksaan awal gateway lama disconnected401,
bukan bukti nomor baru diblokir. QA tidak mengirim pesan produksi.

Perbaikan pencarian grup24Oktober: nama aktual **AXVARA’S** memakai apostrof
melengkung. Gateway menyetarakan ’/‘/ʼ dengan ', NFKC, trim dan kapitalisasi;
dua grup dengan nama setara tetap ditolak. ID tujuan kemudian dipin di Postgres,
tidak berpindah karena perubahan nama/link storefront. Bot yang sudah tersambung
cukup **Cek koneksi → Aktifkan notifikasi**, tanpa menautkan ulang.
Status gateway memberi `groupName` kanonis AXVARA'S untuk validasi Pages dan
`groupSubject` judul WhatsApp asli; keduanya hanya muncul setelah verifikasi grup.

**Mengganti nomor bot tanpa kode:** Pengaturan Toko → Ganti nomor bot → masukkan
nomor baru (628…/+62…/08… Indonesia, atau format internasional) → Simpan nomor bot.
Pengiriman dijeda dan sesi lama diputus. Selanjutnya Hubungkan nomor bot dari
WhatsApp nomor baru → pastikan bot anggota/admin pengirim grup yang sama → Cek
koneksi → Aktifkan notifikasi. Nomor WhatsApp admin toko dan link undangan tetap
terpisah. Tidak perlu mengubah secret/env atau deploy untuk pergantian berikutnya.
Pilihan nomor/revisi/ID grup tersimpan dalam `axvara_wa_runtime` Postgres; prefix
auth per nomor terisolasi. Restart mempertahankan pilihan. Riwayat sent/unknown,
pending dan cooldown dipertahankan; tidak ada rotasi otomatis. Bila simpan timeout,
Cek koneksi dahulu untuk melihat nomor aktual; tab lama harus dimuat ulang.
Rollback ke kode sebelum fitur ini hanya aman sebelum pernah mengganti nomor;
setelah itu gunakan rilis CI kompatibel runtime/revisi agar tidak kembali ke
nomor awal dengan aktivasi lama. Jangan menghapus tabel/session untuk recovery.

Source gateway kanonis sekarang `gateway/`, diuji/dideploy di CI main memakai
Heroku source/build API dan GitHub secret `HEROKU_API_KEY_AKUN1` dari
`.heroku-credentials`. Folder saudara lama adalah arsip; jangan push Heroku atau
mengunggah session lokal. Pages memakai tiga secret_text existing
WHATSAPP_GATEWAY_URL/WHATSAPP_WEBHOOK_TOKEN/WHATSAPP_BOT_NUMBER, tanpa env baru.
Migrasi0076 hanya indeks scanner. Detail kontrak/recovery/reference ada di
[catatan implementasi](issue/whatsapp-sales-notifications-2026-10-24.md) dan
[aturan gateway](gateway/AGENTS.md).

## Banner informasi carousel — 24 Oktober 2026

✅ Implementasi; publikasi via CI. Semua banner aktif diurutkan dalam satu popup
beranda: panah/swipe/keyboard, nomor slide, autoplay6detik dengan jeda saat interaksi dan reduced
motion. Revisi responsif11November2026 (lokal; deployment belum diverifikasi):
kartu448px maksimal92dvh/area aman layar, gambar mengikuti sisa tinggi dengan rasio
asli/object-contain tanpa crop/distorsi. Ruang putih samping diperbolehkan saat layar
pendek, menggantikan aturan selalu penuh selebar kartu24Oktober.
Panah overlay gambar dan counter langsung di bawahnya.
Caption putih rata tengah tanpa separator; checkbox di atas tombol biru full-width
atau Saya Paham bila CTA kosong; keduanya selalu terlihat di luar area scroll.
Caption maksimal30dvh dapat digulir dengan sentuhan/keyboard bila perlu. Sesuai owner, tidak ada tombol
Putar/Jeda pada gambar; hanya panah dan tutup.
Judul mengikuti tinggi teks; deskripsi langsung di bawahnya dengan jarak8px.
Transisi dissolve420ms/blur2px/geser12px menunggu gambar tujuan siap, mempertahankan
slide lama sebagai backing dan menghaluskan perubahan tinggi kartu. Input cepat
digabung ke tujuan terbaru; reduced motion tetap tanpa animasi/autoplay.
Jangan tampilkan lagi berlaku per info24jam; checkout/admin tetap tanpa popup.

Admin → Banner: ubah isi/gambar/CTA/aktif, drag pegangan atau gunakan naik/turun
untuk urutan. Banner baru di akhir. Pengaturan popup terpisah: jeda buka0–10detik,
interval4–20detik, otomatis dan frekuensi1–10per sesi. Perubahan terlihat pada
kunjungan baru, bukan mengganti popup yang sedang dibaca. Satu rangkaian dihitung
sekali; setelan per-banner lama digantikan konfigurasi bersama. Konflik tab basi
memuat ulang daftar. API settings/reorder membutuhkan sesi admin; konfigurasi satu
JSON pada store_settings existing, urutan batchD1 atomik dengan guard/permutasi;
tidak ada migrasi/env/proxy baru. Lihat ARCHITECTURE bagian kontrak carousel.


## Perbaikan audit — 24 Oktober 2026

Implementasi; publikasi melalui CI. Pedia kini QRIS per order, tanpa saldo pembeli,
penerbitan/penebusan kredit atau refund otomatis. Kendala partial/canceled ditangani
owner di luar website; admin menyimpan catatan tindak lanjut, aktor dan waktu.
Arsip lama tetap baca-saja dan retry order tersimpan mempertahankan nominal.
[Kontrak transisi](docs/pedia/manual-resolution-2026-10-24.md) menggantikan seluruh
ketentuan kredit/deposit Pedia pada snapshot terdahulu di README/dokumen lain.

Kredensial memerlukan WA penuh/email/capability; detail Pedia memerlukan kontak
checkout. Telegram mengklaim satu pending order aktif per chat secara atomik;
webhook gagal-tertutup saat D1 gagal dan /batal mengakhiri input. Lacak mengikuti
semua unit akun dengan polling berbudget/visibility/backoff. Checkout dan keranjang
menjaga identitas varian serta stok efektif; filter admin dipagari respons terbaru.
Migrasi0075, test regresi, patch dependensi dan verifikasi Pages/workerd ikut rilis.
Tidak ada env/cron/proxy baru atau order supplier berbayar dalam verifikasi.



Admin memuat section/editor berat saat dibuka dengan fallback Suspense; Ringkasan
serta Pesanan tetap tersedia pada bundle awal. First Load JS /admin pada build
lokal420kB→145kB; bukan bukti latensi produksi. Filter/paginasi OrdersManager dan
rekonsiliasi mengabaikan respons generasi lama. Facet global memakai cache privat
terenkripsi 60 detik (otorisasi selalu diperiksa), metrik daftar tetap mengikuti
filter. Tanggal UTC memakai batas mentah setengah terbuka yang menerima format
ISO/SQLite. PDP/cart memakai stok efektif unique dan memperbarui metadata saat
repeat-add. Issue quote membawa variant_id/min_qty; perubahan harga serta baris
ringkasan memakai identitas produk+varian. Pemulihan minimum direct-buy mengganti
qty URL lalu meminta quote baru, tanpa membuat order atau invoice.

## Tautan komunitas — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Footer dan halaman link memakai
[grup WhatsApp baru](https://chat.whatsapp.com/DHgtU7q39TlCV6ToZ4JU39?mode=gi_t),
Sejak24Oktober URL aktif berasal dari `whatsapp_group_url` di Pengaturan Toko;
`WA_GROUP_HREF` di `src/lib/site.ts` hanya fallback.


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
masih satu unit dan kill-switch DM tidak diubah. [Kontrak unit](docs/UNIQUE-UNITS.md).

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
[operasional Paid](docs/PAID-OPERATIONS.md).


## Penyederhanaan pilihan layanan Pedia — 22 Oktober 2026

✅ Implementasi; publikasi melalui CI. Koreksi owner22 Oktober: judul “Apa yang ingin ditingkatkan?” kembali ke ukuran24px/bold semula tanpa garis cyan. Yang diperkecil adalah pill kebutuhan Followers/Likes/dll: tinggi32px, teks12px, ikon13px dan padding12px; permukaan gradasi halus dengan highlight inset, pilihan aktif cyan/violet dan glow tipis. Gulir horizontal serta fokus keyboard tetap, scrollbar visual disembunyikan. Label tombol jumlah memakai `k` kecil untuk ribuan (`1k`, `2k`, `2.5k`); angka di bawah 1.000 tetap utuh, nilai input/perhitungan serta teks batas dan harga memakai angka aslinya. Pengantar panjang jumlah dihapus; batas tampil sesuai min/max layanan terpilih (“Layanan terpilih menerima 100–50.000 per pesanan.”), termasuk kelipatan bila perlu; sebelum memilih layanan ada petunjuk singkat tanpa angka asumsi. “Pilih layanan · harga untuk …” berada di kiri dan filter ringkas di kanan saat muat, bertumpuk pada mobile. Kategori **Semua/Global/Indonesia/Refill** memakai satu state eksklusif: tepat satu pill aktif, klik pill aktif mempertahankannya; Refill berarti semua wilayah dengan refill>0. Pemilihan kategori tidak mengganti layanan atau jumlah. Hitungan hasil, Reset filter dan pengaturan jenis akun/urutan berada sesudah daftar. Beranda, data katalog, validasi batas, quote/consent/retry dan pembayaran tetap.

Tipografi harga 22 Oktober mengikuti AXVARA pusat: harga kartu/daftar layanan Inter bold 700, 14px mobile/17px mulai sm, tracking −0.02em dan line-height 1 tanpa tabular-nums; total ringkasan Space Grotesk bold 700/18px, total ringkas mobile 14px; nominal QRIS/pembayaran diterima Space Grotesk bold 700/24px dengan kelas `leading-8`; line-height aktual mengikuti `.font-display` global seperti pusat. Acuan aktual: ProductCard storefront, total checkout pusat dan nominal QRIS pusat. Ini menggantikan ukuran harga pada redesain 20 Oktober; susunan beranda/checkout, nominal dan format jumlah tetap.


## Redesain alur pembelian Pedia — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. Keputusan owner: **beranda tetap seperti sebelumnya, tanpa jalan pintas**. Sesudah klik layanan/platform, konfigurator mengikuti referensi “Redesign SMM Panel Purchase Flow”: **Layanan → Target → Kontak → Bayar**. Kebutuhan pertama langsung terbuka (deep link mengikuti slug); jumlah/layanan tetap dipilih eksplisit. Tab kebutuhan berikon, perbandingan layanan tetap terbuka, validasi per tahap, ringkasan desktop340px, CTA di dasar panel desktop/fixed mobile dengan safe-area. Link dan checklist produk berada di tahap Target; WA/email, kredit dan consent di tahap Kontak. Kembali mempertahankan isian produk yang sama, tanpa melewati tahap mendatang; setelah POST ambigu semua navigasi langkah terkunci. Preview admin embedded tetap tanpa request harga/order atau kontak.

Halaman pesanan memakai timeline vertikal + progres server dan panel QRIS di kanan desktop/atas mobile (container1000px, rail380px, QR240px), countdown deadline, Simpan QRIS/Cek pembayaran, serta Pesan lagi pada status terminal. Partial/kredit/refill/needs_check dan snapshot lama tetap dilayani. QR/nominal/status berasal dari server, tanpa simulasi atau reset expiry. Kontrak API, quote/consent/retry, supplier IndoSMM untuk order baru, env/cron/ledger tidak berubah. Spesifikasi [redesain pembelian](docs/pedia/purchase-flow-redesign-2026-10-20.md) menggantikan bagian UI checkout/status versi15–19 Oktober di bawah; desain beranda existing dipertahankan.


## Pedia IndoSMM untuk penjualan baru — 20 Oktober 2026

✅ Implementasi; publikasi melalui CI. IndoSMM menjadi supplier tunggal untuk katalog/harga/quote/order baru dan kurasi admin. ProviderSMM dipertahankan untuk retry checkout tersimpan, dispatch/status/refill/recovery historis; quote lama tanpa order perlu memilih ulang sebelum debit/reservasi/invoice. Migrasi 0073 menonaktifkan penjualan ProviderSMM, menambah 53 kebutuhan/61 mapping IndoSMM (termasuk tujuh pengganti) dan 18 platform; owner drafts serta snapshot order lama dipertahankan. Produk premium supplier Canva/Gemini/CapCut dikecualikan. API/description review belum membuktikan kualitas; tanpa order berbayar. Spesifikasi terkini: [IndoSMM 20 Oktober](docs/pedia/indosmm-only-2026-10-20.md).


## Pedia dan loading — 19 Oktober 2026

✅ Implementasi; rilis melalui CI push main. Loading logo memakai ring cyan dan pulse mengikuti ISTA AI, dengan reduced motion. Pedia menyediakan ikon semantik, jumlah sebelum perbandingan layanan, filter ringkas dan formulir link/syarat yang dekat. Kontak tetap tahap kedua; pembayaran/quote/retry tetap. Tab admin **Kurasi** memilih kebutuhan dan jumlah, membandingkan kandidat kedua supplier, meninjau copy lalu menyimpan draf nonaktif tanpa refill untuk diperiksa di editor.

Migrasi data 0070 menambah 17 kebutuhan/23 mapping (kapasitas total 55/154 pada 16 platform), hanya aktif bila mirror/batas/paket/API refill layak; konflik slug owner dilewati, order lama dipertahankan. Manifest server-only dan generator terpisah tidak mengubah 0066. Supplier tetap ProviderSMM/IndoSMM, tanpa SMM Sekalipay/env/cron/proxy baru. Target baru: Shorts YouTube, artis/playlist Spotify. Spesifikasi terbaru: [katalog/UX 19 Oktober](docs/pedia/catalog-ux-2026-10-19.md), menggantikan konfigurator 16 Oktober di bawah. Hasil kiriman belum diuji berbayar; [rencana sampling](docs/pedia/quality-sampling-2026-10-19.md) mengusulkan saldo awal ProviderSMM Rp50.000 + IndoSMM Rp100.000, bukan transaksi yang sudah dilakukan.

## QRIS KlikQRIS (2026-10-18)

Notifikasi WA buyer24Oktober ✅ diimplementasikan, publikasi melalui CI:
invoice baru menyertakan `whatsapp_buyer` dari `orders.customer_wa` valid,
dinormalisasi62 tanpa plus/maks15digit. Market/Pedia otomatis memakai kontak
checkout; kanal Telegram/WA hanya jika nomor sudah tersimpan saat create.
Tanpa WA/nomor invalid/email/JID/ID Telegram: field diabaikan, pembayaran tetap
berjalan tanpa fallback nomor admin/bot. Retry/recovery tidak membuat ulang
invoice atau menambahkan nomor setelah invoice terbit.

Setup owner: paket KlikQRIS aktif → menu WhatsApp → isi nomor pengirim →
tautkan perangkat → pastikan Terhubung → atur Pesan Sukses/Pesan Expired dan
Simpan Format. Pengirim serta template dikelola di KlikQRIS, bukan env Pages.
Owner sudah mengonfirmasi koneksi dan expired15menit melalui screenshot24Oktober;
tidak ada perubahan sesi/template dashboard oleh rilis ini. Notifikasi pembayaran
KlikQRIS tidak menjanjikan produk selesai; verifikasi paid/late-payment AXVARA
tetap berlaku. Notifikasi grup selesai AXVARA tetap terpisah. Tanpa cron/env atau
pesan pembayaran tambahan dari gateway AXVARA; penerimaan WA buyer produksi
belum diuji end-to-end.

Deteksi lunas cepat 2026-10-18: polling halaman pesanan Market (5 detik) dan
Pedia (10 detik) kini menumpang reconcile KlikQRIS ter-throttle ±10 detik per
pesanan (klaim atomik `last_checked_at`, satu pemanggil bertanya ke gateway),
sehingga lunas terdeteksi ≤15 detik tanpa menunggu callback dan tanpa cron
baru. Tombol cek manual tetap seketika. Teks batas bayar 15 menit di bawah QR
halaman pembayaran web dihapus; batas dan countdown-nya sendiri tidak berubah.

Koreksi checkout 2026-10-18: adapter API/PNG kompatibel dengan workerd memakai
redirect manual dan tetap menolak 3xx. Retry quote sama memulihkan invoice
KlikQRIS lewat GET tanpa tagihan/reservasi baru, termasuk stok terakhir. Halaman
pesanan tanpa QR menampilkan **QRIS belum siap** + **Coba siapkan QRIS**; aksi
manual `wake=1` mencoba GET invoice yang sama, polling biasa tetap lokal. Bila
provider belum menemukan invoice, pesanan tetap ditahan untuk cleanup/review;
jangan memaksa POST ulang atau membayar sebelum QR dan total muncul.

Rilis ini membuka kembali pembayaran otomatis dengan PG KlikQRIS (`QRIS_ACTIVE_PROVIDER=klikqris`, server secret `KLIKQRIS_ENABLED=true`, `KLIKQRIS_API_KEY`, `KLIKQRIS_MERCHANT_ID`). Sumber lokal tunggal `.klikqris-credentials` (git-ignored, chmod 600); isi/nilai rahasia tidak boleh masuk git/log/browser. Semua env Pages bertipe `secret_text`. API resmi: https://klikqris.com/dokumentasi-api. Callback ditetapkan per transaksi ke `https://axvara.tech/api/payments/klikqris/callback`, sehingga tidak bergantung pada pengisian callback dashboard.

Harga bayar memakai `total_amount` gateway; nominal/kode unik tidak dihitung ulang lokal. Keputusan owner: batas AXVARA **tetap 15 menit**; owner mengonfirmasi setting expired KlikQRIS juga15menit pada24Oktober (uji awal18Oktober60menit). Deadline tetap yang paling awal order/lokal/provider, retry tidak memperpanjang. Pembayaran setelah batas/cancel/expiry dicatat untuk pemeriksaan manual (Rekonsiliasi + satu alert admin), tanpa melunasi/mengirim produk otomatis. Status/nominal/order/signature dikonfirmasi server sebelum paid atomik. QR diproxy same-origin untuk kode AXV/AXP (migrasi 0069 `provider_qris_url`), tanpa membocorkan API key/signature.

Pembuatan tagihan diklaim durable sebelum POST; retry ambigu hanya GET order ID sama, tidak POST/failover lagi. Stok in-flight tidak dilepas oleh catch kanal. Web/Pedia/TG mendukung cek manual provider; polling halaman menumpang reconcile KlikQRIS ter-throttle ±10 detik/order, tanpa cron gateway baru. Invoice lama tetap DANA/GoPay, termasuk retry setelah perpindahan provider. Rollback hanya invoice baru: kembalikan `QRIS_ACTIVE_PROVIDER` melalui secret Pages + rilis CI; pertahankan kredensial KlikQRIS dan webhook untuk tagihan lama/pembayaran terlambat. Jangan mengaktifkan/menonaktifkan poller atau gateway repo lain untuk integrasi ini.

Dispatch supplier seketika (2026-10-22): sesudah lunas terkonfirmasi, jalur
KlikQRIS kini langsung memproses link WR/SK yang baru dibuat — sama seperti
webhook DANA/GoPay dan tombol Retry admin — bukan lagi hanya membuat link lalu
menunggu tick cron 5 menit. Cron lite tetap menjadi penjamin bila dispatch
seketika gagal; pembelian upstream tetap idempoten (klaim + ref_id stabil).

## Maintenance pembayaran sementara (2026-10-18)

Mode pembayaran otomatis dikendalikan switch **build publik** `NEXT_PUBLIC_PAYMENTS_MAINTENANCE`, saat rilis KlikQRIS `"false"` pada langkah **Build Cloudflare Pages artifact** di `.github/workflows/ci.yml`. Nilai ditanam bersama pada UI dan server Pages (bukan secret/env runtime Pages; tanpa query D1). Untuk menghentikan pembayaran kembali, ubah nilai build ke `"true"`; untuk membukanya gunakan `"false"`, verifikasi lalu commit/push main; jangan hanya mengganti env Cloudflare pada artefak lama. Dev mode maintenance: `NEXT_PUBLIC_PAYMENTS_MAINTENANCE=true npm run dev`.

Banner Market/Pedia, checkout dan bot Telegram mengarahkan **order manual via WhatsApp** ke hub kontak aktif. API checkout kedua layanan, bot TG/WA serta penerbitan/reissue QRIS menolak pembayaran baru sebelum perubahan finansial; error API 503 `reason: payment_maintenance`, `manual_order_url`, `Cache-Control: private, no-store`. Pesanan lama, webhook merchant, pemrosesan pengiriman dan cleanup tetap berjalan; tidak membatalkan transaksi atau menghapus keranjang. Tidak ada migrasi/secret/jadwal cron baru, auto-resume atau siaran massal. Maintenance ini terpisah dari fallback kuota D1 dan tidak menjanjikan selesai pukul 07.00.

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator Pedia 2026-10-16 ✅ implementasi, publikasi melalui CI: halaman dalam memakai header brand, kartu kebutuhan tanpa pilihan otomatis, tiga layanan awal satu kolom pada semua ukuran, dan aksi Ganti layanan. Jumlah, link, serta persyaratan berdekatan dalam satu panel; filter/detail terlipat. Ringkasan desktop sticky dan bar total+CTA mobile mengikuti pilihan, tanpa placeholder berulang. Perbandingan harga memakai jumlah yang sama dan menghormati min/max/kelipatan. Checkout tetap dua tahap Atur pesanan → Kontak & konfirmasi; quote, consent perubahan nominal, retry pesanan dan preview admin aman tetap memakai kontrak existing.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](docs/pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, tanpa typewriter (dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit)); headline statis dua baris putih. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Revisi halaman bantuan Pedia 2026-11-01 (implementasi; publikasi melalui CI): `/pedia/bantuan` dan `/pedia/ketentuan` mengikuti pola Market `/cara-order` dan `/garansi-replace` (label kecil, judul, pengantar, kartu glass `max-w-[920px]`, deret tombol). Bantuan memuat bagian `#cara-order` empat langkah Pedia (Layanan → Target → Kontak → Bayar) dan FAQ accordion gaya Lacak; isinya di `src/lib/pedia/help-content.ts`. Ketentuan mempertahankan ketujuh poin lama yang dikelompokkan per topik. FAQ Lacak tidak lagi menyebut PIN (Pedia tanpa PIN) dan menambah cara membatalkan pesanan. Footer di layout Pedia mengarahkan "Cara order" ke `/bantuan#cara-order`; tautan Pedia di footer/`AXVARA_SERVICES` memakai URL kanonis subdomain (`pedia.axvara.tech/lacak`, bukan `/pedia/lacak`). Halaman bantuan, ketentuan, katalog (kini `h1`) dan lacak (lewat `lacak/layout.tsx`) punya title dan canonical sendiri. Tidak ada perubahan API/order/pembayaran.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

> **Satu Gerbang, Semua Tools Premium** — Toko digital premium Apple Store + Glassmorphism

AXVARA adalah toko digital untuk akun, aplikasi, dan tools premium dengan kategori yang dikelola dari panel admin — checkout memakai **QRIS dinamis merchant GoPay/DANA sesuai provider aktif** tanpa payment gateway pihak ketiga, dan hosting Cloudflare Pages. Jalur manual (E-Wallet/Bank + upload bukti) ⏸️ **maintenance sejak 2026-09-17**: field tampil disabled + badge Maintenance di WEB, dihilangkan di WA/TELE, upload disembunyikan, backend menolak non-QRIS 503.

**Live dev:** `http://localhost:3000` — Next 15.5.28

**Produksi:** `https://axvara.tech` — zone dan HTTPS aktif. `www.axvara.tech` serta hostname bawaan `axvara.pages.dev` mengarah permanen ke apex.

---

## 📂 Struktur

```
axvara/
├── AGENTS.md               # Aturan inti project + indeks aturan per area (docs/agent-rules/)
├── CHANGELOG.md            # Riwayat perubahan — WAJIB update tiap ubahan (terbaru di atas)
├── docs/
│   ├── agent-rules/        # Aturan agent per area (indeks di AGENTS.md)
│   ├── PRD.md              # Requirements, flow, payment spec, AC
│   ├── DESIGN.md           # Apple Store + glassmorphism + motion
│   ├── ARCHITECTURE.md     # Stack D1+R2, schema, API contract
│   ├── TELEGRAM-BOT-KLIKQRIS-PLAN.md # Arsip rencana provider lama (superseded)
│   ├── WHATSAPP-GROUP-BOT-PLAN.md # Rencana varian terpusat + bot grup WA (terimplementasi)
│   ├── PEDIA-PRD.md        # Pedia dua provider: working-tree lokal, belum deployed; gate supplier/kurasi pending
│   ├── PEDIA-DESIGN.md     # Ekosistem bersama + storefront compact/kurasi + checkout satu CTA; arsip ditandai
│   └── VPS-RESEARCH.md     # Riset VPS gratis — kenapa Pages juara
├── public/
│   ├── brand/
│   │   ├── axvara-mark.svg # Mark Prism wireframe (icon/app)
│   │   └── axvara-logo.svg # Lockup horizontal
│   └── qris/README.md      # Tidak ada gambar QRIS statis publik
├── drizzle/
│   ├── schema.sql          # Bootstrap schema D1 lengkap dan idempotent
│   ├── migrations/         # Migrasi satu kali untuk database lama
│   └── seed-articles.local.sql # 20 fixture artikel Draft, idempotent
├── mcp-worker/             # Remote MCP stateless + cron publisher
├── src/
│   ├── app/
│   │   ├── layout.tsx      # Root MINIMAL: font + metadata global SAJA (2026-10-08 — chrome toko/Pedia di layout masing-masing)
│   │   ├── (shop)/         # Toko pusat axvara.tech — route group, URL tidak berubah (page/home-client/produk/checkout/pesanan/lacak-pesanan/link/admin/artikel/dll)
│   │   ├── pedia/          # Katalog per platform; p/[platform] + deep link o/[slug], checkout 2 tahap, pesanan/lacak/bantuan/ketentuan
│   │   ├── garansi-replace/ # Ketentuan layanan & garansi third-party dari footer (acuan klaim)
│   │   ├── api/checkout/   # Quote harga/stok/rekening bertanda tangan
│   │   ├── api/payment-methods/ # Konfigurasi pembayaran publik/admin
│   │   ├── api/store-settings/ # Identitas/kontak toko publik + update admin
│   │   ├── api/subscribers/# Form email footer + daftar terproteksi admin
│   │   └── api/agent/      # Content API Bearer-token untuk MCP/agent
│   │   └── globals.css     # Tokens Liquid Glass iOS 26
│   ├── components/storefront/  # Navbar, OrbitHero, ProductCard, CartDrawer, PopupBanner, Footer, ScrollRope,
│   │                           # ProductCopy (deskripsi + S&K + cara aktivasi PDP, terlipat di mobile),
│   │                           # MobileBottomNav + HelpSheet + CategorySheet + DeviceOrders (bottom nav mobile 4 tab)
│   ├── components/shared/      # ServicesMenu + CrossServicePromo, URL dari lib/site.ts
│   ├── components/pedia/       # PediaOrbit (kembar OrbitHero: 8 sosmed + inti mark Pedia), PediaServiceCards, PlatformCatalog, ServicePicker, usePediaPrices; PlatformGrid/LinkPasteHero kompatibel
│   ├── components/admin/       # Shell + login gate + hooks + sections/ (satu per menu admin)
│   ├── hooks/useModalA11y.ts   # Escape + focus trap + scroll lock, satu sumber untuk semua modal
│   ├── hooks/useDesktopMotion.ts # Guard media query bersama untuk Spotlight/ScrollRope Market/Pedia
│   ├── lib/db.ts               # BARREL ke src/lib/db/* — impor dari sini, bukan file internalnya
│   ├── lib/commerce.ts         # createChannelOrderAtomic: reservasi stok + order dalam satu batch
│   ├── lib/fulfillment/deliver.ts # BARREL ke src/lib/fulfillment/delivery/*
│   ├── lib/telegram/messages.ts   # BARREL ke src/lib/telegram/messages/*; handlers/ berisi router
│   ├── lib/whatsapp/handlers/  # catalog, payment, proof, admin (gateway.ts memegang auth + SSRF)
│   ├── lib/product-copy/       # Salinan produk versi Axvara: text, format (aman client),
│   │                           # curated + resolve (server-only, dipakai /api/catalog)
│   ├── lib/products.ts     # 24 produk seed development + kategori
│   └── stores/cart.ts      # Zustand cart (persist axvara-cart)
├── wrangler.json           # Cloudflare Pages + D1 + R2 bindings/output
└── .env.example
```

---

## 🎨 Brand

- **Logo:** Prism wireframe (`public/brand/axvara-mark.svg`) — segitiga sama sisi + spine + inner A negative space, stroke 3.6, Swiss geometric — di Navbar `36×32px` + wordmark `font-[300] tracking-[0.22em]`
- **Palet:** Midnight `#070a1e/#080C1E` + Cyan `#00E5FF` + Gold `#FFB800`
- **Font:** Apple SF Pro (`-apple-system, SF Pro Display/Text`) — bukan Space Grotesk
- **Efek:** `ax-glass` blur 20px untuk navbar/modal, `ax-glass-strong` blur 24px, dan `ax-glass-card` tanpa backdrop blur untuk kartu berulang agar GPU lebih ringan.
- **Motion:** Apple spring `cubic-bezier(0.32,0.72,0,1)`; orbit tanpa render React per frame memakai 30 fps saat auto-rotate dan interaksi drag hanya untuk pointer presisi. Pada layar sentuh orbit memakai `touch-action: pan-y`, sehingga swipe di atas ilustrasi tetap menggulir halaman. Spotlight/ScrollRope berjalan hanya saat ada interaksi.

### Pedia dan Ekosistem (Working-Tree 2026-10-12)

**Implementasi lokal, BELUM deployed; tidak ada flag yang diubah.** Riwayat katalog awal 2026-10-08 dan QA overhaul 2026-10-11 bukan bukti deployment/QA diff terkini. Kredensial/readiness supplier, mata uang/satuan katalog serta kurasi awal data produksi masih pending; checklist `issue/planning.md` memisahkan kode selesai dari gate live.

- Market/Pedia memakai `ServicesMenu` Layanan AXVARA (Market/Pedia saja), `CrossServicePromo` dua arah dengan UTM dan satu `Footer` ekosistem, newsletter, navigasi Layanan AXVARA (Market/Pedia) serta tautan bantuan/ketentuan/pelacakan kedua host absolut. Footer revisi 2026-10-15 menghapus kategori dan teks chat/jam layanan, menambahkan ikon WhatsApp satu tone dengan sosial lainnya setelah Facebook ke `https://axvara.tech/wa?pesan=Halo%20AXVARA`, lalu pill kecil Grup WA hijau dan Bot Order Telegram biru berlogo brand asli di bawah ikon. CommunityBar Market = promo Pedia + Bot Telegram Market; Pedia memakai `PediaServiceCards` = promo Market + Bot Telegram Market (kembar compact, 2026-10-12). Layout Pedia `max-w-[1280px]` + hero tanpa card 1:1 Market (h1 `font-display` 42/56px "Satu tempat untuk / optimasi media sosial." putih statis, typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit), glow section-level, tanpa eyebrow). Grup WA tetap footer dan `/link`, URL komunitas terpusat di `lib/site.ts`. Tidak ada janji garansi/aktivasi universal atau platform AI palsu.
- Hero Pedia "Satu tempat untuk / optimasi media sosial." statis, typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit) + CTA Lihat Layanan + Hubungi Admin (hub /wa) + trust strip "Order cepat tanpa login • Garansi reffil • Support WA admin" 1:1 Market, reduced-motion statis dan pause saat tab tersembunyi. Gap hero→kartu→katalog 1:1 Market (hero `pb-4`, kartu di luar section, katalog `pt-2`). Awal beranda maks 8 featured editorial; tanpa featured fallback 6 produk Jelajahi layanan tanpa sub-teks (2026-10-12). Tampilkan semua, cari/filter dan `/layanan` menjangkau seluruh produk AXVARA terbit, bukan katalog mentah supplier. Kartu Cari lewat link DIHAPUS dari beranda (2026-10-12 owner); `LinkPasteHero` tetap sebagai komponen. Kartu compact memasangkan harga/jumlah/tier/refill yang sama, grid 1/2/3 kolom; tagline tampil di kartu/detail. `description_md` field publik opsional tampil di detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa tambahan link-helper teknis. Ticker tidak dirender.
- Checkout tiga kelompok/radio native/paket-only dengan tier/jumlah awal null, Belum dipilih dan harga awal per tier. Satu CTA per viewport **Lanjut ke pembayaran** memvalidasi + meminta quote otomatis; nominal berubah atau kredit meminta **Setujui & lanjut ke pembayaran** sebelum order. Perubahan input membuang quote/respons lama; retry ambigu mempertahankan token/kontak terkunci; 4xx selain 408/429 membuka kunci. Order tutup hanya pesan dekat CTA tanpa meminta kontak/kredit/S&K. ETA/refill mengikuti tier; partial/cancel menjadi Kode Kredit, bukan refund tunai.
- Dua provider internal: `providersmm` → VPS `/psmm/:action`, `indosmm` → `/indosmm/:action`, allowlist services/add/status/refill/refill_status/cancel/balance. Pages memakai URL/token proxy existing; **`PROVIDERSMM_API_KEY`/`INDOSMM_API_KEY` hanya secret VPS**, bukan Pages. IndoSMM services/add dan diff memerlukan balance IDR + **`INDOSMM_RATE_PER_1000_VERIFIED=true`** di VPS (default tertutup, bukti akun/unit belum tersedia, tanpa konversi kurs). Health key-configured bukan bukti pricing. Receiver memisahkan `(source, service_id)`, menerima currency IDR; payload lama ProviderSMM tanpa currency tetap kompatibel.
- Quote baru JWE `dir/A256GCM` 30 menit (key SHA-256 dari `ADMIN_JWT_SECRET`) mengikat `refill_days/min_profit_rp`; HS256 legacy belum kedaluwarsa tetap diterima, supplier kosong legacy = ProviderSMM. Mapping berubah sebelum order → `service_changed`; order menyimpan provider/service/rate dan ketentuan refill/min-profit dari quote (legacy tanpa field fallback tier), polling/refill memakai asal order, bukan tier remapped. Refill requested/submitted/needs_check diblokir berapa pun usianya; ID/key ambigu tetap dipertahankan. D1 mengklaim submitting sebelum add; timeout/error/lease basi → needs_check, tanpa retry/failover otomatis.
- Proxy baru menyimpan reservation+fingerprint sebelum upstream secara exclusive/fsync di `SMM_IDEMPOTENCY_DIR` (default `state/smm-idempotency`, subfolder provider), cache sukses durable tanpa TTL/eviction. Key add stabil = kode order, 1..120 karakter. Pending/corrupt/ambigu → needs_check; key sama payload beda → conflict. Refill/cancel terlindungi hanya bila key disertakan. Backup state; jangan hapus pending/ganti key/provider untuk retry. Dedupe hanya satu VPS, bukan lintas host; state in-memory lama tidak dapat dipulihkan.
- Diff VPS membatasi layanan `chunkMax` 1..100 (default 50) dan removals 100 secara independen per batch; hanya potongan ber-ack 2xx memajukan snapshot/antrean. >100 removals dilanjutkan, bukan batas pending; guard katalog kosong/>50% missing tetap berlaku.
- Admin: filter provider/platform/kesiapan, buat produk/tingkat nonaktif, mapping provider+service berpasangan, preview storefront tersimpan **terpenuhi** memakai `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman. Draf tetap privat; tingkat nonaktif dengan paket layak dapat dikurasi, navigasi/pemesanan dinonaktifkan dan interaksi preview tidak memanggil API. CTA mobile inline, bukan fixed; preview diperbarui dari data tersimpan setelah save, bukan input belum disimpan (unsaved live preview di luar scope). Terbit/Unggulan/Siap dijual terpisah, API refill vs masa kurasi terpisah, saldo live/cache/error/pricing/sync per provider. ID admin desimal positif kanonik; checklist memakai ID unik setelah trim dan bantuan opsional bertipe string. Recovery mark_submitted memeriksa status/ID provider asal; resubmit/cancel+kredit diblokir setelah submit pernah dicoba atau ID ada. Guard margin menyimpan disable sebelum reprice untuk melindungi replay. Save/reprice **tidak atomik**, `reprice_failed` dapat terjadi setelah edit tersimpan; pengaturan default tidak bulk-update tier atau menggantikan env operasional. Detail: `docs/PEDIA-PRD.md` §9–10, `docs/ARCHITECTURE.md` §3.0/§16.10.
- Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; tidak ada perubahan/verifikasi secret/flag atau order supplier nyata. Bukti supplier live currency/rate-unit dan kurasi awal produksi/approval owner tetap pending.

Spesifikasi overhaul 2026-10-11 (semua produk di awal, Periksa harga terpisah, footer mini, admin tanpa create) **superseded** oleh working-tree ini; bukan perubahan retroaktif riwayat deployment. Rollout perlu receiver Pages kompatibel sebelum diff proxy baru, backup direktori state durable, bukti IDR/unit/ketentuan supplier dan persetujuan kurasi owner. Deployment serta pembukaan flag adalah pekerjaan terpisah, tidak dilakukan oleh sinkronisasi dokumentasi ini.

### Catatan Performa

- **Hemat CPU Workers Free (2026-10-10, insiden 1102):** semua link storefront/Pedia `prefetch={false}`; ikon/logo/OG/banner/favicon dilayani CDN di luar worker (`scripts/patch-pages-routes.js` + `public/_headers`); hitung pemenang WR vs SK jadi 1 query agregat; poller GoPay VPS idle 60 dtk dan dibangunkan Pages saat QR terbit + tombol "Cek Status Sekarang"/"Periksa Pembayaran" (`src/lib/payments/gopay-wake.ts`, Caddy `/gopay/wake`). Detail: `docs/ARCHITECTURE.md` §8 + bagian GoPay.
- Homepage dan detail menampilkan skeleton lalu hanya merender katalog aktif dari D1; seed hanya dipakai fallback database development, bukan fallback UI produksi.
- Jaringan lambat tidak lagi "bisu" (2026-09-24): klik link/CTA langsung memunculkan bar cyan + skeleton halaman tujuan (`src/components/ui/NavigationProgress.tsx`, `src/components/storefront/Skeletons.tsx`), 8 dtk → pil "Koneksi lambat", 20 dtk → "Coba lagi". Tombol Checkout/Beli Sekarang/modal varian berputar sampai checkout tampil (`usePendingNavigation`); Bayar menampilkan label bertahap lalu layar "Pesanan dibuat · Membuka halaman pembayaran"; `/pesanan/[code]` langsung menampilkan QR dari respons create dengan placeholder + "Muat ulang QRIS". PDP dirender server lengkap (`initialProducts`/`initialCatalog`). Fetch storefront dibatasi waktu (`src/lib/fetch-timeout.ts`). Tanpa `loading.tsx` agar status 404 dan HTML SSR tidak berubah.
- Logo orbit disajikan sebagai SVG lokal; tidak ada request runtime ke Iconify.
- Gambar kartu Unsplash memakai WebP `srcset` responsif.
- Endpoint publik eksplisit (`products?active=1`, `categories`) mengirim cache CDN singkat; banner aktif no-store sejak24Oktober agar pengaturan baru tidak tertahan cache, varian produk admin/private selalu `no-store`. **Pengecualian PDP by-slug (2026-10-02):** `catalog?slug=` + `products?active=1&slug=` memakai cache 10 detik (daftar katalog tetap 30 detik) agar angka stok segar tepat setelah ada yang beli.
- PDP memakai `products?active=1&slug=` (1 baris) + `catalog?slug=` untuk varian + related `products?active=1&cat=` (kategori sama, hanya yang bisa dibeli — stok habis TIDAK PERNAH tampil di Produk Serupa, kontrak 2026-10-01; filler katalog lain hanya bila kategori sama < 4, hemat rows-read D1) — tidak fetch seluruh katalog per halaman. Checkout `?buy=` memakai filter slug exact yang sama.
- Proteksi trafik: WAF 1 rule global TERPASANG (`/api/*` 100 req/10 dtk/IP → Block 429, ruleset "AXVARA API rate limit") + rate-limit in-memory per scope di `src/lib/rateLimit.ts` (lapis kedua per isolate, 429 + `Retry-After: 60`); cron operations memakai binding D1 berbudget 40 statement per invocation, termasuk helper dan anggota batch; pemulihan serta pengiriman dibagi menjadi unit yang dapat dilanjutkan. Sejak 18 Sep 2026 cron juga punya deadline wall-clock 45 detik dan memajukan penanda fase di awal run, supaya run yang dipotong platform (~125 detik) tidak mengunci rotasi fase dan mematikan sync otomatis WR. Guard anti-starvation fase WR tidak lagi mensyaratkan antrean order kosong (order due bukan alasan membiarkan katalog basi), fase WR didahulukan saat sync basi >45 menit, dan skip sweep karena budget/deadline dilaporkan jujur di `cron_deferred` + `wr_sync_skipped`. Sejak 19 Sep 2026 SEMUA alasan skip sync dilaporkan (`disabled`/`phase_inactive`/`interval`/`sync_disabled`/`deadline`/`query_budget`) + `wr_last_sync_at` di respons, dan tiap hit menulis heartbeat `store_settings.cron_last_hit_at` (heartbeat segar + sync basi = run kepotong deploy; keduanya basi = pemicu mati).
- CSP development mengizinkan `unsafe-eval` hanya untuk React Refresh/webpack lokal. CSP production tetap tidak mengizinkannya.

---

## 💳 Pembayaran

| Metode | Tujuan | Ket |
|--------|------------|-----|
| E-Wallet | `082135277434` | DANA/Gopay/Shopeepay |
| SeaBank | `901812349386` | Brotherstore06 |
| QRIS | GoPay Merchant Axvara Digital (invoice baru sejak27Oktober); rail lama dipertahankan | Dinamis per order, nominal unik, QR 15 menit; WA tanpa pembaruan, Telegram/Web maksimal 1 pembaruan |
| Bank lain | dinamis via admin | tambah/aktifkan tanpa deploy |

Flow: server memvalidasi harga/stok dan menerbitkan quote bertanda tangan 60 menit → order dibuat idempotent dan stok direservasi atomik. Untuk QRIS, server membuat payload EMVCo dan nominal unik per order, menampilkan QR selama 15 menit, lalu QRIS Hook Android mengirim pembayaran ke `/api/webhook/dana`; nominal yang cocok tepat mengubah ledger+order menjadi lunas secara atomik. Transfer SeaBank/e-wallet tetap memakai bukti JPG/PNG/WebP dan review admin. Order yang kedaluwarsa mengembalikan stok atomik.

Halaman pembayaran QRIS ringkas (2026-10-15, implementasi; publikasi CI): header/status/kode dipadatkan, QR 224px mobile/240px desktop tetap utuh dengan bingkai putih. Judul/kode pesanan di tengah kartu dan satu pill Menunggu bayar di atas Total bayar pada mobile maupun desktop. Desktop QR dan info bayar berdampingan, mobile satu kolom; nominal/kode unik/countdown dekat QR, **Simpan QRIS** dan **Cek Pembayaran** sejajar (44px). Ringkasan produk terlipat awal; lanjut belanja/pembatalan selebar sama di bawah, berjarak 16px dari garis pemisah bantuan. **Butuh bantuan?** tampil di atas WA Admin/Telegram; tanpa tautan Lacak Status saat pending. Pengecekan otomatis/manual, download gambar yang sama, kedaluwarsa/reissue, verifikasi pembatalan dan detail akun lunas tetap memakai kontrak existing.

Checkout mobile (2026-10-15): klik Bayar ketika WA/email belum valid mengarahkan scroll dan fokus ke field pertama yang salah. Label/error tidak tersembunyi di balik navbar atau tombol tetap; mode reduced motion dihormati. Order baru dibuat setelah seluruh validasi lolos.

QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Web/Telegram 60 menit dengan 1x perpanjangan QR). QR mati = order kedaluwarsa = stok kembali otomatis via cron ±5 menit. Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`, verifikasi kode + WA/email checkout, stok kembali detik itu juga) tanpa menunggu expiry atau admin.

Telegram: pilih varian langsung ke jumlah, tanpa layar konfirmasi pembelian tambahan. Tombol **🔄 QRIS Baru** hanya ada pada pesan QRIS pertama kedaluwarsa, bukan pada invoice aktif. Migrasi `0026_qris_channel_policy.sql` menyesuaikan deadline order lama yang masih pending dan menyimpan marker notifikasi per invoice. Cron operations mengirim pesan kedaluwarsa Telegram dengan retry marker, serta mengantrekan pemberitahuan WA idempoten ke `whatsapp_outbox`. Batas pembayaran berlaku pada deadline; pengiriman pemberitahuan mengikuti cron 5 menit dan dapat tertunda oleh antrean atau kegagalan gateway. Halaman `/pesanan/[code]` menghormati batas waktu dan izin pembaruan dari API, termasuk untuk kode order WA.

Migrasi `0025_qris_invoice_history.sql` menyimpan setiap nominal dan waktu penerbitan di `payment_invoice_history` melalui trigger dalam transaksi ledger yang sama. Allocator (least-recently-used), webhook, retry admin, dan guard pelunasan membaca riwayat tersebut; sejak 14 November 2026 nominal yang dipakai order lain hanya memicu review bila pemakaian itu berakhir < 24 jam sebelum invoice baru terbit (`DANA_AMOUNT_REUSE_WINDOW_HOURS`). Jika versi lama sudah menghapus riwayat lewat reissue, rentang nominal yang terdampak dicatat di `dana_qris_legacy_ranges` dan memerlukan verifikasi mutasi manual; migrasi tidak menghidupkan kembali order terminal.

AXVARA adalah third-party independen (bukan official store). Garansi bervariasi 1x24 jam–30 hari mengikuti deskripsi tiap produk; klaim berupa penggantian/perbaikan dengan proses 1–3 hari tergantung antrean, stok akun pengganti, atau gangguan pihak terkait; jika setelah maksimal 3 hari gangguan masih terjadi, diberikan solusi refund uang (ketentuan 2026-10-15; tanpa refund otomatis). Wajib mengirim invoice/bukti pemesanan dan screenshot kendala. Revisi 2026-10-16 ✅ implementasi, publikasi CI: semua pesanan Market lunas menampilkan satu accordion **Syarat klaim garansi** di dalam kartu **Detail Akun Digital**, setelah seluruh **Cara Penggunaan / Aktivasi** dan sebelum catatan simpan, dengan style S&K/aktivasi yang sama (isi 12px/leading-relaxed sejak revisi 2026-10-16; halaman ketentuan publik tetap 14px), pada halaman setelah order dan hasil lacak. Tetap di dalam kartu saat verifikasi kontak; bila detail akun belum tersedia, accordion tampil setelah blok pengiriman. Berlaku untuk order lama/manual dan beberapa akun tanpa duplikasi. Isi diawali **pengajuan garansi hanya untuk produk bergaransi**, juga pada halaman ketentuan bersama; sumber berada di `lib/warranty-policy.ts` dan komponen `storefront/WarrantyClaim.tsx`, sementara bot tetap memakai catatan durasi/refund yang sama. Checkout mewajibkan centang persetujuan ketentuan sebelum order dibuat; acuan lengkap di `/garansi-replace`.

Nomor dukungan default adalah `089519388264`, terpisah dari nomor tujuan pembayaran e-wallet. `src/lib/site.ts` menyediakan fallback, sedangkan override operasional disimpan lewat menu **Pengaturan Toko**.

Bottom nav mobile (2026-10-03; sebelumnya 2026-09-25): **Beranda · Kategori · Pesanan · Bantuan** (Keranjang hanya di navbar sticky; Kategori = sheet filter katalog). Tab Pesanan membuka `/lacak-pesanan` yang langsung menampilkan pesanan dari perangkat ini (status dari server, tombol Bayar/Lihat); tab Bantuan membuka panel WA Admin, Telegram, Cara Order, Garansi, dan Artikel. Pembeli memantau pesanan mandiri di `/lacak-pesanan`: cukup kode pesanan + No. WA atau email checkout (tanpa login), diverifikasi server via `POST /api/orders/lookup`, timeline Dibuat → Pembayaran → Diproses, auto-refresh saat Pending.

### Kategori dan footer

- D1 `categories` adalah satu-satunya sumber nama, ikon, dan urutan kategori untuk kapsul katalog. Sejak revisi footer 2026-10-15, kategori tidak ditampilkan atau dimuat oleh footer; navigasinya berisi Layanan AXVARA dari `AXVARA_SERVICES` dan Bantuan. Taksonomi 2026-09-28 (migrasi 0046): AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat — slug lama dialias di kode agar filter lama tidak 404.
- Nama kategori dapat diganti tanpa mengubah slug stabil. Produk tetap terhubung melalui `category_id`, sehingga rename tidak memutus filter atau mengganti ikon.
- Daftar produk admin punya kolom Urutan (nomor posisi 1..N yang bisa diketik — Enter untuk lompat 30→1 dalam 1 request; raw sort_order hanya di tooltip) + tombol ↑↓ per baris (exact-step atomik via POST /api/products/reorder — tepat 1 posisi, realtime, mati di batas kelompok aktif/habis/nonaktif; 2026-10-01: pindah halaman mengikuti produk bila melewati batas) + kolom Terjual bisa diketik langsung (SET absolut; order lunas tetap += otomatis) + modal edit menampilkan posisi read-only + field Terjual yang ikut tersimpan. Tab status toko Live/Hidden/Nonaktif/Semua (default Live = yang tampil di toko saat ini; Hidden = toggle ON tapi tak tampil + sebab jujur kalah/habis; Nonaktif = toggle OFF) + badge count + kartu "Hidden otomatis" + pagination 20/50/100 per halaman (persist, default 20). Rate-limit reorder punya scope sendiri (120/mnt) — 429 saat merapikan katalog bukan kuota cron.
- Admin memilih ikon secara eksplisit dari 12 aset lokal. Kategori yang masih memiliki produk harus dikosongkan terlebih dahulu sebelum dihapus.
- Form **Tetap update** menerima email dan menyimpannya ke `newsletter_subscribers`; hasilnya terlihat di menu **Pelanggan Email** pada panel admin.

---

## 🚀 Stack Gratis

| Layer | Teknologi | Free Tier |
|-------|-----------|-----------|
| Hosting | Cloudflare Pages | unlimited bandwidth |
| DB | D1 (SQLite) | 5GB, 5M reads/hari |
| Storage | R2 | 10GB |
| Domain utama | `axvara.tech` | Cloudflare zone + Pages custom domain aktif |
| Hostname Pages bawaan | `axvara.pages.dev` | Redirect permanen ke `axvara.tech` |

Detail: `docs/VPS-RESEARCH.md` & `docs/ARCHITECTURE.md`

Bot Telegram auto-order, pembayaran QRIS dinamis, dan fulfillment tersedia di codebase.
**Revisi29Oktober2026, implementasi lokal untuk CI:** katalog → produk+varian
→ jumlah/email → QRIS → status; label kanonis web tanpa durasi metadata non-WR
berulang, harga purchasable dan inventory unik efektif. Ringkasan bertag
produk/varian/jumlah/harga; konfirmasi email masked memakai nonce+fingerprint
dan claim CAS, fail-closed bila DB/email gagal. Callback basi tidak membeli
lagi, invoice aktif didahulukan untuk retry. Cart diubah atomik dan hanya
snapshot yang dibeli dibersihkan. Cancel terkonfirmasi dan kompensasi setup
invoice tanpa ledger memakai transisi stok/order atomik; invoice tercatat atau
ambigu mempertahankan reservasi. Status semua item, error resend parsial dan
notifikasi paid ber-lease/backoff existing; kredensial hanya ke ID pribadi
pemilik (menggantikan fallback chat tersimpan lama). Copy singkat tanpa progres
palsu; ketentuan/aktivasi/garansi tetap utuh. Modul tambahan
`telegram/checkout-{approval,email}.ts`, tanpa env/schema/cron/transport baru.
Pengujian fixture tanpa pesan/order produksi; bukan bukti deployment.

**Koreksi owner terbaru menggantikan loading paralel di bawah:** bar persentase
lama0/40/70/100% + delete kembali untuk /start/produk dan ditambah saat memuat
QRIS satuan/keranjang. Urutan animasi selesai dahulu, lalu langkah existing;
gagal dekorasi tidak menggagalkan hasil. Efek delete mengikuti klien Telegram.
Varian habis memakai ❌ + nama; ketuk menampilkan popup pilih produk lain tanpa
membuat order. Callback khusus `soldout`, guard transaksi tetap.
Catatan loading paralel berikut dipertahankan sebagai histori:

`/start` dan produk mengambil data bersamaan indikator satu bubble tanpa
persentase, dikirim langsung. Hasil
menunggu respons send loading agar tidak mendahuluinya; animasi tetap berjalan
selama upload hasil, maksimal3edit lalu “Masih memuat…”. Selesai/gagal
menghentikan animasi dan menghapus bubble. Send/delete memakai timeout existing
10detik, edit5detik; timeout kirim tetap ambigu, tidak otomatis dikirim ulang.
Pagination/stepper dan ringkasan konfirmasi dari tombol mengedit pesan existing;
balasan input teks, invoice/kredensial tetap pesan terpisah. Ringkasan memakai
kelompok identitas, nominal dan email masked, bukan tabel monospace. Ikon semantik
tetap dengan teks, checkout 💳 dan jumlah 🛒 bukan centang sukses. Callback,
CAS/email/snapshot dan guard stok tetap; tidak ada UI web atau pesan QA produksi.

Paragraf Fase1/Fase2 berikut adalah histori; presentasi, fallback penerima dan
notifikasi order-created yang bertentangan mengikuti revisi terkini di atas
serta keputusan10Oktober (hanya notifikasi lunas).
Navigasi Fase 1: label menu bawah (🛍 Katalog · 🔎 Cari · 🛒 Keranjang · 📦 Pesanan · ❓ Bantuan,
tetap di-route untuk keyboard lama) tanpa bubble "Menu cepat" setelah `/start`,
welcome landing dengan 3 produk paling laris + `Terjual X` di kartu produk, riwayat
`/orders` dengan tombol 🔁 Beli Lagi, breadcrumb `Langkah X/4` di alur beli, dan pencarian
`/cari` via nama/alias. Fase 2 (tanpa review/promo): keranjang multi-item Telegram
(`telegram_carts`, maks 20 varian/user; 1 baris unik saja) dengan tambah/ubah/hapus via
tombol ➖/➕/❌ lalu ringkasan konfirmasi `cconfirm` dan checkout gabungan SATU order +
SATU invoice QRIS + fulfillment per item (`fulfillment_items`: tiap baris punya
status/mode/penerima sendiri, satu secret unique per baris, order selesai hanya
setelah seluruh item terminal sukses); stok finite dipotong per baris
dengan kompensasi penuh bila satu baris gagal; reminder order pending via cron 5-menit
(maks 2x, interval ≥60 mnt, hanya invoice aktif, marker `telegram_reminder_count`
idempoten). Flow Telegram setara WA grup: katalog datar nama produk (tanpa kategori wajib,
tanpa pengulangan sapaan/tanggal/jam dari welcome). Sejak 2026-09-27 detail
produk dibuat ringkas (nama, harga/diskon, penjualan, stok) tanpa daftar varian
panjang; tombol **Pilih Varian** membuka inline keyboard yang membawa
nama/durasi/garansi/harga, dengan varian habis nonaktif di urutan terakhir. Alur
`Produk → Varian → Qty (−/+ atau Masukkan Jumlah) → Email bila wajib → QRIS dinamis`.
Input jumlah memakai ForceReply dengan rentang minimum/stok live; email ditampilkan masked
untuk dikonfirmasi dan bisa diubah sebelum invoice dibuat. Telegram hanya menawarkan
QRIS otomatis—tidak menampilkan SeaBank/e-wallet. Setelah jumlah dikonfirmasi, satu pesan
QRIS langsung terbit; QRIS Hook mengabari buyer otomatis saat dana terverifikasi. Nomor WA
baru diminta setelah status `paid` dan hanya untuk fulfillment manual. Order baru langsung
masuk grup `Axvara_Notif`; setelah lunas grup menerima update `Lunas — Telegram` tersendiri
agar tidak tertinggal status menunggu bayar. Order WhatsApp ikut jalur yang sama:
order baru mengirim `Order Baru — WhatsApp` dan order lunas mengirim `Lunas — WhatsApp`
(via QRIS Hook / retry admin / approve bukti, migrasi 0023, tanpa replay riwayat lama).
Order web hanya dinotif saat lunas (2026-09-25): `Lunas — Web` memuat status kirimnya
(terkirim otomatis / perlu **Kirim ke pembeli** / diproses Warung Rebahan), sekali per order,
dengan retry cron 6 jam; notif `Order Baru — Web` dihapus.
Penanda D1 + cron mencegah duplikat sekaligus me-retry kegagalan kirim.
Daily Promo Digest mengirim bahan promosi internal ke tujuan yang sama pukul
09.00 dan 17.00 WIB: pesan utama + versi WA siap copy-paste (2026-10-03: isi
sama persis, bold `*` literal — bubble ringkas lama diganti agar tinggal copy
dari Telegram lalu paste ke WA), masing-masing berisi SEMUA produk
ready dengan harga tegas aktual serta CTA **website dulu baru bot** (**Order
melalui Website** lalu **Order melalui Bot Telegram**). Ledger `telegram_promo_digests` (migrasi 0044)
mencegah duplikat per tanggal/slot dan mengulang hanya bubble yang gagal.
Aktifkan eksplisit `TELEGRAM_PROMO_DIGEST_ENABLED=true`; default tetap mati.
Dokumen `docs/TELEGRAM-BOT-KLIKQRIS-PLAN.md` hanya arsip provider lama dan telah digantikan
oleh mesin `src/lib/payments/dana-qris.ts`, ledger D1, route QR image, dan QRIS Hook DANA.
Feature flag terkait adalah `TELEGRAM_BOT_ENABLED`, `TELEGRAM_PROMO_DIGEST_ENABLED`, `DANA_QRIS_ENABLED`, dan
`AUTO_FULFILLMENT_ENABLED`; nilai rahasia disimpan di Cloudflare Pages Secrets.
Repo `mocasus/telegram-auto-order-bot` hanya referensi UX, bukan source/fork.

Bot grup WhatsApp existing dan katalog varian terpusat sudah tersedia; desain dan rollout
lengkapnya ada di `docs/WHATSAPP-GROUP-BOT-PLAN.md`. D1/CMS menjadi sumber produk,
durasi, garansi, harga, stok, dan konfigurasi fulfillment per varian untuk website,
Telegram, serta WhatsApp. Field **Nama di WhatsApp (Alias)** mengatur nama ringkas pada
daftar/header detail dan otomatis fallback ke nama produk web bila kosong. Flow grupnya
ringkas: `list` → ketik nama produk → pilih angka varian → pilih `QRIS`, `SEABANK`, atau
`EWALLET`. QRIS dinamis lunas otomatis melalui QRIS Hook DANA; screenshot QRIS bersifat
opsional dan cukup memakai caption `QRIS`. Bukti SeaBank/e-wallet ditinjau langsung pada
baris order di menu **Pesanan** dan baru mengubah order setelah admin mencocokkan mutasi. Command
`garansi` memakai kebijakan kanonis yang sama dengan Telegram. Runtime memakai Baileys
pada service Heroku `axvara-wa-gateway`; bot mengutip pesan pembeli saat membalas,
gateway meneruskan gambar masuk lewat URL sekali pakai, dan identitas LID pengirim grup
dinormalisasi lewat `participantAlt` sebelum dicocokkan dengan `WHATSAPP_ADMIN_NUMBERS`.
Admin menyelesaikan order yang sudah lunas dengan membalas pesan pembayaran memakai `.d`
atau mengetik `.d AXV-...`; command non-admin diabaikan dan tidak masuk pencarian produk. Semua flag WhatsApp/varian di
`.env.example` tetap default `false` untuk rollout bertahap. Nilai `WHATSAPP_WEBHOOK_TOKEN`
harus sama dengan `AXVARA_WEBHOOK_TOKEN` di Heroku dan dipakai pada kedua arah komunikasi.
Discovery dan transaksi produksi diaktifkan penuh pada 5 September 2026 untuk grup allowlist:
`WHATSAPP_ENABLED`, `WHATSAPP_GROUP_DISCOVERY`, `WHATSAPP_GROUP_PAYMENT`, `WHATSAPP_PROOF_INTAKE`,
`WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT`, `WHATSAPP_FULFILLMENT`, dan `PRODUCT_VARIANTS_READ` aktif.
Pembayaran menerima QRIS dinamis DANA + SeaBank + e-wallet dengan intake bukti manual ke R2 privat.

> **Koreksi 13 November 2026 (keputusan owner):** alur pembeli WhatsApp di atas adalah
> snapshot historis. Pencarian, pemesanan/pembayaran, dan intake bukti manual WA
> dipensiunkan di kode (bukan env); pesan lama dijawab arahan ke website/Telegram.
> Yang berjalan: katalog digest/broadcast/welcome grup, event grup, outbox, `.d` admin.
Token, nomor Device, webhook secret, dan GID disimpan sebagai Pages Secrets, tidak di repository.
Unduhan lampiran webhook tidak membawa token gateway ke URL media, dibatasi 5 MB,
dan diverifikasi sebagai gambar sebelum disimpan privat. Copy pembayaran memakai snapshot
order agar perubahan nama/durasi/garansi di CMS tidak mengubah transaksi yang sudah dibuat.
Produk baru otomatis mendapat varian default. Harga/stok pada form produk lama hanya
disinkronkan untuk varian default tunggal; produk multi-varian dikelola lewat tombol
**Kelola Varian**. `PUT /api/products/:id` yang membawa `variants` menghitung ulang master dari varian aktif dan mengabaikan kolom legacy, sehingga edit produk multi-varian (mis. Canva) tidak lagi ditolak 409. Panel **Pesanan** menyediakan pencarian server-side, filter channel
Web/Telegram/WhatsApp, status, pembayaran, rentang tanggal, pagination, detail order,
konfirmasi aman, serta export CSV. QRIS tidak dapat dilunasi dari bukti gambar; QRIS Hook
tetap menjadi authority dan event yang tidak cocok ditangani pada **Metode & Rekonsiliasi**.
Penghapusan produk/varian mengarsipkannya agar order historis tetap utuh. Konfigurasi
fulfillment shared/unique dipusatkan pada masing-masing varian, bukan digandakan di menu bot.

**Paritas pengiriman Telegram = Web (2026-10-04):** setelah lunas, pembeli Telegram
menerima pesan sesuai kelas kirim — instan (stok sendiri, WR restock, SK auto) =
"dikirim otomatis ke chat ini"; Made By Order (WR MBO / SK non-auto) = pesan tunggu
maks 12 jam lalu kredensial dikirim OTOMATIS ke chat yang sama begitu selesai di
supplier; manual = dikirim admin (WA cadangan hanya untuk baris manual). Kredensial
WR & SK masuk DM chat pribadi (tidak pernah ke id grup; order dari grup menyusul
setelah pembeli START bot). Katalog/cari/bestseller bot memfilter pecundang pasangan
WR/SK, dan varian tanpa data garansi tidak lagi ditulis "Tanpa Garansi". Fallback: kredensial
dicoba ke beberapa target chat pribadi berurutan, dan pesan lunas punya tombol
**📦 Ambil Detail Produk** untuk mengambil ulang detail di chat bot.

Setelah pembayaran diterima, tombol support bot membuka akun manusia `@axvara_support`;
username bot tetap `@Axvara_bot`. Seluruh notifikasi admin dari order web, Telegram,
maupun WhatsApp memakai satu tujuan `TELEGRAM_ADMIN_CHAT_ID`. Untuk grup privat, tambahkan bot ke grup,
lalu ambil ID numerik negatifnya dari klien Telegram atau metadata update webhook yang tersedia
bagi admin dan simpan sebagai secret tersebut (link undangan `t.me/+...` tidak dapat dipakai sebagai Bot API
`chat_id`). Perintah `/chatid` dihapus 12 November 2026 agar bot tidak membalas ID grup; menu
perintah native kini memakai `/bahasa` dan `/currency`, dan menu utama punya tombol
🌐 Bahasa/Language serta 💱 Mata Uang/Currency. Bahasa dan mata uang tampilan saling independen;
mata uang hanya mengubah tampilan harga, bukan total pesanan atau nominal tagihan.

### Warung Rebahan H2H (reseller otomatis, default mati)

Axvara dapat menjadi reseller layer di atas Warung Rebahan: produk tersinkronisasi otomatis
(Canva & Gemini ikut — exclusion default kosong), stok/harga diperbarui ±3–6 menit lewat diff VPS (sejak 2026-10-04; cadangan cron 15/60 menit; sebelumnya 30), order lunas diteruskan otomatis ke WR (exactly-once: klaim atomik + lease +
idempotency), dan detail akun dikirim ke customer via
Telegram/WhatsApp/Web. Sejak 22 Sep 2026 sweep katalog mengirim tulisnya sebagai
satu `d1.batch()` per produk; nama publik Gemini AI Antigravity sengaja tanpa
suffix `(WR)` karena identitas supplier tetap disimpan pada metadata internal.
Prefetch massal baris pembanding menghasilkan **642 → 117
round-trip D1 (−82%)** untuk 48 produk/87 varian. Ini memangkas SEBAB sweep lambat —
kerja SQL D1 hanya 0,15 ms/query sementara satu round-trip ke primary SIN ~197 ms,
jadi 99,9% durasi sweep adalah menunggu jaringan. Cakupan batch sengaja per produk
(bukan per sweep) karena `batch()` adalah transaksi: satu produk bermasalah tidak
boleh membatalkan produk lain.
Telegram/WhatsApp/Web. Pembeli web mengambil kredensial di halaman pesanan via verifikasi
No. WA atau email checkout + capability token (terbuka otomatis di tab checkout yang sama, termasuk setelah dimuat ulang) — panel itu hanya muncul saat detail akun benar-benar sudah ada
(`credentials_ready`); order lunas yang detailnya belum ada menampilkan blok "Pengiriman
Produk" (tujuan email checkout + teks per keadaan), bukan form yang pasti gagal. Produk kirim
otomatis dari stok sendiri (`instant_delivery`, mis. Canva Invite) tampil skeleton
"Menyiapkan detail produkmu…" tanpa teks pengiriman selama ±30 dtk pertama (tanpa
bacaan yang bisa hilang saat panel muncul)
dan halaman memeriksa rapat (2 dtk ×5, 5 dtk ×4) sehingga detail muncul beberapa detik setelah
terkirim tanpa reload; estimasi 5–15 menit hanya untuk produk WR. Sejak 13 Okt 2026
order supplier (WR/SK) diperlakukan sama instannya: selama link supplier berjalan,
halaman menampilkan skeleton yang sama + poll rapat, dan setiap poll memicu tarikan
status vendor di server (gerbang throttle 20 detik per order) — detail tampil hitungan
detik setelah supplier COMPLETED, tanpa menunggu cron dan tanpa klik admin; kalimat
"Stok otomatis habis"/"disiapkan admin" tidak pernah tampil untuk order supplier.
Auto-scroll detail akun (2026-10-15, implementasi; publikasi CI): halaman pesanan dan hasil lacak bergulir sekali ke **Detail Akun Digital** setelah isi akun berhasil ditampilkan, termasuk sesudah polling pembayaran/pengiriman. Form verifikasi belum memicu scroll akun. Jarak 96px menjaga judul dari navbar; reduced motion berpindah langsung. Rerender/accordion tidak mengulang scroll, dan kode pesanan baru memakai panel baru agar tidak memakai detail sebelumnya.

Panel kredensial kini diikuti blok Syarat & Ketentuan + Cara Aktivasi per item
(resolver yang sama dengan halaman produk); detail akun WR berbentuk
`{label, value}` dari supplier ditampilkan rapi "Label: nilai" per baris.
Sejak 18 Sep 2026 produk kelas **antrean** (`made_by_order`, dibuatkan setelah order) juga
diteruskan otomatis ke WR begitu lunas — sebelumnya link-nya diam `pending` sampai admin
sadar. Ekspektasi waktunya jujur per kelas dan disebut SEBELUM bayar (PDP, modal varian,
checkout): instan = 5–15 menit, antrean = "umumnya lebih cepat, maksimal 12 jam pada jam
layanan" (estimasi supplier 6–12 jam). Sejak 11 Okt 2026 kelas instan/antrean
diturunkan dari `delivery_mode` resmi API WR per varian (auto = instan,
manual/mixed = antrean; migrasi 0060) — mengalahkan tebakan/screenshot lama;
audit 62/92 varian salah kelas diperbaiki (mis. Vidio Mobile kini jujur
Made By Order, bukan "Kirim otomatis"). Sejak 13 Okt 2026 penandanya
disederhanakan paten ala SK: panel admin hanya menampilkan badge **AUTO /
MANUAL** dari API (tanpa embel-embel sumber/tebakan, tanpa tombol kunci
kelas — mesin tebakan dihapus, migrasi 0061). Saklar mundur: `WARUNG_REBAHAN_AUTO_ORDER_MBO=false`.
Pembeli web menerima ISI kredensial langsung via email
Resend "Detail Akun Siap" (idempoten; tanpa email dilewati diam; dibuat Axvara
sendiri dari detail completed walau WR tidak mengirim email) + panel Detail Akun
di halaman pesanan + hasil lacak-pesanan. **Auto-DM WA ke buyer MATI sejak 19 Sep
2026** (`WHATSAPP_CREDENTIAL_DM_ENABLED=false`, kill-switch pasca-restriction nomor
BOT — kode + mekanisme UTUH, nyalakan lagi = 1 env + deploy; sementara ini kirim
manual dari HP bila perlu). Grup WA tetap hidup penuh (balas list/katalog/QRIS/`.d`).
Outbox dipacing manusiawi + auto-pause lunak (lihat ARCHITECTURE § pengawasan antrean). Admin dapat notifikasi Telegram bila satu order melewati 13 jam
(migrasi 0037), panel antrean admin menampilkan umur tiap baris, dan ambang alert saldo
default naik ke Rp250.000 karena modal varian termahal Rp200.000. Pemantauan wajib
sepekan 19–26 Sep: sweep cron tiap ~30 mnt + outbox tanpa failed/dead
`whatsapp_not_connected` + delivery tanpa antrean menggantung (lihat ARCHITECTURE
§ pengawasan antrean). Blueprint: `docs/WARUNG-REBAHAN-INTEGRATION.md`; arsitektur terpasang:
`docs/ARCHITECTURE.md` §15. Seluruhnya di balik `WARUNG_REBAHAN_ENABLED=false` (lihat
`.env.example`); set API key + webhook secret di Pages Secrets, lalu Force Sync dari tab
**Warung Rebahan** di admin. Webhook WR: `https://axvara.tech/api/webhook/warung`.
Antrean order di tab yang sama bisa dicari by invoice WR (`#RBHN-…` dari email
WR) — baris hasil menampilkan buyer Axvara (nama · WA · email) untuk forward
manual email WR dengan branding Axvara. **Bot otomatis (2026-09-17):** email WR
(label Gmail `WR-INGEST`) diteruskan otomatis sebagai email branding Axvara via
`POST /api/webhook/wr-email` + Resend (fallback WA bila buyer tanpa email);
pasang forwarder `docs/WR-EMAIL-FORWARDER.gs.js` + 3 env (`WR_EMAIL_WEBHOOK_SECRET`,
`RESEND_API_KEY`, `FORWARD_FROM_EMAIL`) sebagai `secret_text`.
**Kabar pembeli web lewat email (2026-09-24):** `src/lib/notify-buyer.ts`
mengirim tanda terima pembayaran, pengiriman gagal (termasuk kegagalan WR),
serah terima manual, dan bukti ditolak ke `customer_email` lewat Resend yang
sama (env di atas), bukan outbox WA yang mati. Idempoten via tabel
`buyer_notice_log` (migrasi 0039, diterapkan otomatis oleh CI).
**Produk non-WR untuk pembeli web (2026-09-25, migrasi 0043):** varian
Kirim otomatis (pesan bersama / stok unik) dikirim lewat SATU email "Pesanan
Siap" (isi produk + tanda terima). Varian Made By Order diserahkan admin lewat
Pesanan → **Kirim ke pembeli**: kolom "Detail untuk pembeli" terisi dari
template varian (panel varian, placeholder `{email}` `{nama}` `{kode}`
`{produk}`), dikirim lewat email/DM Telegram, dan tersimpan terenkripsi untuk
halaman pesanan. Admin mendapat ping Telegram saat order web lunas perlu
diserahkan. Semua email pembeli memakai shell bermerek yang sama.

**Detail produk Telegram (2026-10-17 ✅ implementasi, publikasi melalui CI):** WR/SK,
stok sendiri shared/unique, jalur legacy, serah terima admin berisi detail dan
**Ambil Detail Produk** menyertakan
S&K serta cara penggunaan/aktivasi varian sesudah kredensial, memakai resolver
copy yang sama dengan PDP/panel website. Klaim garansi langsung tercantum: hanya
produk bergaransi, invoice/bukti + screenshot, proses 1–3 hari dan solusi refund
jika gangguan berlanjut setelah maksimal tiga hari. Masa/cakupan mengikuti produk;
panduan kosong/gagal dibaca diarahkan ke deskripsi/admin `/bantuan`. Pesan panjang
dibagi berurutan (HTML ≤4096 karakter, kredensial/Unicode tetap utuh, preview tautan
mati); status kirim sukses menunggu seluruh bagian. Retry/fallback setelah gagal
parsial dapat mengulang bagian yang sudah diterima. Ambil ulang pesanan lama
memakai copy katalog terkini, tanpa broadcast. Tidak ada migrasi/env/proxy baru;
verifikasi memakai fixture tanpa mengirim pesan Telegram/transaksi supplier nyata.

Opsi A (disarankan): API key dipegang proxy Heroku — Pages cukup
`WARUNG_REBAHAN_PROXY_URL` + `WARUNG_REBAHAN_PROXY_TOKEN`.

**Kepemilikan field produk WR.** Produk hasil sync (`wr_auto_managed=1`) hanya
bisa diubah sebagian dari admin: foto, badge, **harga coret (diskon)**,
kategori, urutan, aktif/nonaktif, dan **Deskripsi khusus (override)**. Nama,
slug, deskripsi WR, harga, stok, label varian, durasi, dan garansi dimiliki
sync dan ditolak API dengan 409 — markup diubah di tab **Warung Rebahan**.
Harga coret adalah PENGECUALIAN: milik admin (sync tidak pernah menulis `compare_price`), jadi diskon WR aman lintas sweep dan tampil di kartu
seperti produk manual. Deskripsi override disimpan di
`products.admin_description_override` (migrasi 0030), tidak pernah ditimpa
sync, dan menjadi teks yang tampil di storefront saat terisi. Badge "WR" hanya
muncul di editor admin; storefront tidak menampilkan penanda WR.

**Salinan produk versi Axvara (2026-09-24).** Deskripsi, S&K, dan cara
aktivasi tampil dalam satu format untuk produk WR maupun non-WR: deskripsi =
paragraf pembuka + daftar keunggulan; S&K dikelompokkan (Detail paket, Proses &
pengiriman, Aturan pakai, Garansi); cara aktivasi bernomor. Di mobile, S&K dan
cara aktivasi terlipat, dan varian dipilih lewat panel (baris "Varian" → ketuk
varian → harga, S&K, cara aktivasi, dan tombol beli ikut varian itu; judul S&K
punya tautan "Ganti varian" bila isinya berbeda antar varian, 2026-09-25). S&K + cara aktivasi WR versi Axvara dipilih di kode
(`src/lib/product-copy/curated.ts`) lewat sidik jari teks WR; bila WR mengubah
teksnya, PDP otomatis kembali ke teks WR yang dirapikan (aturan baru tidak
pernah tertutup). Deskripsi versi Axvara diisi migrasi 0040 (diterapkan CI):
produk WR ke `admin_description_override` bila masih kosong, produk non-WR ke
`description` bila belum disunting. Format deskripsi untuk admin: paragraf,
baris `- ` untuk keunggulan, lalu baris `Syarat & Ketentuan:` / `Cara
Aktivasi:` untuk bagian yang pindah ke kartu S&K. Detail: `docs/ARCHITECTURE.md`
§15 "Salinan produk versi Axvara".

**S&K dan panduan bersama per varian (2026-10-15).** Untuk stok sendiri, buka tab Varian: S&K bersama serta Cara penggunaan / aktivasi bersama berlaku untuk setiap pembeli varian itu dan tersimpan lewat **Simpan Produk**, termasuk saat membuat varian baru. Stok unik cukup berisi link/akun/key/detail khusus pembeli; impor/hapus stok tetap aksi terpisah yang langsung tersimpan. Modal varian memakai accordion dan stok unique mengikuti inventory. Produk supplier tetap memakai tab Deskripsi & S&K dan tombol tinjauan khusus, agar save produk tidak menyetujui otomatis teks WR yang berubah. Setelah bayar, panel kredensial menggabungkan panduan varian dan S&K/aktivasi deskripsi produk seperti PDP, lalu menampilkan accordion terpisah di bawah detail akses.

**Editor WR/SK (29 Oktober 2026, implementasi lokal).** Teks otomatis langsung
terisi; sumber asli, override dijeda dan versi pembeli dibedakan. Pratinjau memakai
gabungan draft varian dan deskripsi form. PUT `/api/admin/variant-copy` wajib
`supplier_key` dari GET: fingerprint sumber harus cocok dan UPDATE memeriksa ulang
sumber/override secara atomik; konflik 409 mempertahankan draft. Muat sumber
terbaru tidak membuang draft. Batalkan perubahan hanya membatalkan draft lokal;
Kembali ke versi otomatis menghapus override tersimpan. Simpan Produk diblokir
selama draft/simpan teks; penutupan modal meminta konfirmasi untuk draft dan
ditahan saat simpan. Mirror WR/SK tidak diedit; badge tinjauan juga membaca SK.
Stok sendiri tetap di tab Varian. Copy pascabayar memakai katalog terkini dan
catatan transaksi SK tidak diubah. Verifikasi fixture bukan bukti deployment.

**Muse AI (2026-10-21, ✅ live).** Produk manual 1 miliar token Rp16.000
menggunakan kolom deskripsi serta S&K/panduan bersama varian existing.
Login melalui email + web OTP, lalu ganti dan verifikasi email pribadi.
Copy membedakan token tambahan dari langganan berbayar, menempatkan kapasitas
VM sebagai referensi, serta mengikuti kuota/izin/ketersediaan dan garansi
varian tanpa garansi. Teks dan dasar bukti: [salinan Muse](issue/muse-ai-copy-2026-10-21.md).
Revisi ringkas owner: lima keunggulan, lima poin S&K, dan empat langkah aktivasi.
Revisi 23 Oktober ✅ live menambahkan asal Meta, ekosistem WhatsApp/Instagram/Threads/
Facebook dan contoh promosi/konten pada pengantar. Patch data sekali jalan
`issue/muse-ai-meta-copy-2026-10-23.sql` hanya menyunting description/updated_at,
dengan guard timestamp dan isi lengkap owner agar tidak menimpa perubahan baru;
S&K/panduan varian tetap. Bukan migrasi schema atau perubahan kontrak aplikasi.

**Link supplier tampil pendek via shortlink internal `axvara.tech/go/*` (2026-10-03, migrasi 0056).** 46 link supplier (mailbox OTP, bot Telegram, tutorial YouTube, domain resmi app, panduan artikel — termasuk `go/disney-login` 2026-10-19 dan `go/otp-hypathia` + `go/alight-shorts` 2026-11-02) dibungkus jadi `go/otp`, `go/netflix-login`, dst. — tampil pendek di PDP/email/panel, redirect 307 + hitung klik, noindex. Kelola di tab admin **Link Supplier** (tambah/ubah/tujuan/aktif-nonaktif); supplier ganti URL → update 1 baris, tanpa edit kurasi. Detail: `docs/ARCHITECTURE.md` (tabel `supplier_links` + route `/go/:slug`) dan `docs/PRD.md` FR-S17c.

**Handoff operasional Heroku + Cloudflare.** Sejak 2026-09-14 proxy WR terpisah:
akun #1 (`axvara-wa-gateway`) = WhatsApp SAJA; **sejak 2026-10-02 proxy pindah
ke VPS AWS** `t4g.nano` Singapore (`https://wr-proxy.axvara.tech`, IP statis
`13.228.147.90`, Caddy + Let's Encrypt) dan menjadi satu-satunya egress yang
di-whitelist WR — lihat `docs/ARCHITECTURE.md` §16.8 (Heroku akun #2 +
QuotaGuard Spike DIHAPUS TOTAL 2026-10-02). Cloudflare Pages tidak boleh memegang API
key WR; yang disimpan di Pages hanya URL + token proxy dan
`WARUNG_REBAHAN_WEBHOOK_SECRET` untuk verifikasi HMAC. **Sejak 2026-09-30
proxy yang SAMA juga meneruskan Sekalipay (`/sk/*`, key `SK_API_KEY` di server
proxy, IP whitelist SK = IP VPS yang sama, tanpa add-on baru)** — lihat
`docs/ARCHITECTURE.md` §15b. Kredensial Cloudflare
manual diambil dari `.cf-credentials` (git-ignored); kredensial Heroku dua akun
di `.heroku-credentials` (git-ignored, pola sama); AWS (VPS proxy) lewat
`.aws-credentials` (git-ignored, pola sama; read-only + reboot VPS,
lihat AGENTS.md); CI/CD memakai GitHub Actions Secrets.

### Cadangan dan pemulihan env Pages

`.pages-env-backup` lokal (git-ignored, `chmod 600`) menyimpan nilai pemulihan
production/preview serta tiga secret Worker `axvara-mcp`. Simpan juga di password
manager owner dan perbarui setiap menambah/mengubah env Pages; GET Cloudflare
tidak mengembalikan nilai secret. Jangan echo/log/commit atau `source` berkas:
format blok `KEY=VALUE` adalah literal, bukan shell. Kunci tanpa sumber pasti
tetap komentar `TIDAK DIPASANG`, bukan nilai kosong/tebakan.

```bash
node scripts/pages-env-restore.mjs
node scripts/pages-env-restore.mjs /path/to/backup --env production --only KEY1,KEY2
# Hanya setelah pemeriksaan/izin operasi:
node scripts/pages-env-restore.mjs --apply --env production --only KEY1,KEY2
```

Default dry-run tidak mengakses jaringan/kredensial dan hanya mencetak nama/jumlah
kunci. `--apply` membaca Global API Key/email `.cf-credentials`, menolak kunci
di luar project, PATCH whitelist per env dengan `secret_text`, dan memastikan
himpunan nama kedua environment tetap sama. Tidak mengirim objek GET, retry,
deploy, atau mengubah Worker. Pemulihan Worker manual: `wrangler secret put
AXVARA_CRON_SECRET --config mcp-worker/wrangler.toml`; nilainya harus sama dengan
Pages `CRON_SECRET`. Deployment berikutnya tetap via CI, lalu verifikasi runtime.
Snapshot10November: cadangan72production/18preview/3Worker; nama sesuai metadata
dikurangi kunci TIDAK DIPASANG. Rincian: `docs/ARCHITECTURE.md` §16.2.

### Drag kredensial yang halus (2026-10-23)

Saat menarik pegangan, kartu penuh mengikuti tarikan dan baris sekitar bergeser untuk menunjukkan ruang tujuan. Garis cyan serta “Lepas di urutan …” menandai posisi sebelum dilepas. Tahan tarikan dekat tepi atas/bawah daftar untuk auto-scroll; cukup tarik satu kali untuk memindahkan stok terakhir ke paling atas. Drop menyimpan sekali, Escape membatalkan; panah serta drag keyboard tetap tersedia. Pengaturan reduced motion dihormati. [Referensi dan detail motion](docs/admin/credential-drag-motion.md).

### Mengatur urutan kredensial produk pribadi (2026-10-23)

Di Edit Produk → Varian → Kirim otomatis — stok kredensial unik, tarik pegangan kredensial ke posisi yang diinginkan (termasuk terakhir ke paling atas), atau gunakan panah naik/turun. Perubahan langsung tersimpan. Posisi paling atas diambil lebih dulu untuk pesanan baru di web, Telegram dan WhatsApp; kredensial yang sudah dipesan tetap pada pesanan semula. FIFO tetap default, impor baru di belakang antrean, dan konflik stok meminta muat ulang. Migrasi0074 menambah prioritas nullable/index; API admin memakai action `reorder` dengan daftar ID tersedia per varian (maks100, mengikuti daftar existing). Isi/ID/jumlah stok tidak ditukar atau ditulis ulang.

### Pemulihan invoice supplier SK (2026-10-23)

Status “Sedang dikirim ke supplier” dapat tersangkut ketika pembelian sudah diterima SK tetapi invocation berhenti sebelum invoice tersimpan. Webhook valid kini mengikat invoice lewat ref_id canonical meskipun respons POST belum tersimpan. Cron existing memulihkan klaim terkirim dengan lease basi serta submitted/ordering yang due lewat GET referensi asli, lalu melanjutkan pengiriman. Maksimal tiga kandidat/tick, cooldown lookup satu menit dan budget D1 tetap; 404/timeout tidak memicu pembelian ulang. Respons pemesanan terlambat tidak menurunkan status webhook. Polling halaman pesanan/lacak juga memulihkan invoice lewat GET ref_id (throttle existing 20 detik/order), sehingga pembeli yang sedang menunggu tidak bergantung pada tick cron berikutnya. Item bertanda penyerahan manual tidak ditimpa atau dikirim ulang oleh recovery. Lihat ARCHITECTURE §15b; tidak ada env, migrasi atau perubahan proxy.

### Sekalipay Reseller API (supplier kedua paralel WR, 2026-09-30, default mati)

**Ketahanan antrean 2026-10-19 (implementasi; publikasi CI):** cron SK memprioritaskan link siap beli, lalu mencari order lunas yang benar-benar kehilangan link melalui satu query, tanpa memeriksa ulang seluruh riwayat per item atau probe ganda. Order yatim tetap ditemukan walau tertutup banyak transaksi selesai. Maksimal empat upaya pembelian per tick; link yang dipulihkan dapat diproses langsung bila belum ada pembelian pada tick tersebut, atau tetap due untuk tick berikutnya. Budget habis dilaporkan sebagai `budget_exhausted`, bukan antrean kosong. Tidak perlu Retry admin untuk antrean normal; backoff/hasil ambigu/saldo dan idempotensi tetap berlaku, order selesai tidak dibeli ulang. Jadwal, env dan proxy tetap existing; rincian di ARCHITECTURE §15b.

Axvara menjadi reseller layer di atas Sekalipay (`https://sekalipay.com/api`)
SEBAGAI SUPPLIER KEDUA yang paralel dengan WR — bukan failover otomatis.
Netflix WR vs Netflix SK tetap dua baris di admin (nama publik bersih tanpa
suffix supplier, dibedakan via badge asal + slug `-wr`/`-sk`). Untuk pasangan
terdaftar, katalog memilih satu wakil otomatis dari sisi yang aktif manual,
kemudian stok/modal/preferensi; owner tetap mengendalikan toggle tiap produk. Fase 1 hanya varian
`order_process=auto` kategori Aplikasi Premium (lisensi langsung di
`order.completed`, tanpa field `note/zone_id`); varian manual/h2h/smm dicatat
di registry tanpa pasangan katalog. Modul `src/lib/sekalipay/` (client header
`X-APIKEY` + GET baca, sync delta `updated_since`, order `ref_id` idempoten,
deliver lisensi terenkripsi ke `fulfillment_items`, saldo), webhook
`POST /api/webhook/sekalipay` (SHA256 `ref:invoice:status:secret`, monotonik),
fase cron `sekalipay` (`fulfillment → warung_rebahan → SEKALIPAY → notify`,
budget + deadline yang sama), tab admin **Sekalipay** setara WR (saldo, Force Sync,
antrean + umur + retry/void, exclusion rules, markup per varian + bulk markup cermin) + fitur khas SK
(mutasi saldo audit, cek akun validasi nickname, stock-lock 10 mnt, daftar
transaksi, detail capability, sandbox), migrasi 0049 + 0050 (tabel
`sk_*`, kolom `sk_*`, exclusions, CHECK `source` + `sekalipay`). Paritas
2026-10-02: SK auto ikut instan (flag halaman baca `sk_order_process`),
webhook `order.completed` langsung kirim email kredensial template "Pesanan
Siap" Axvara yang SAMA PERSIS dengan WR/non-WR (tanpa ingest Gmail — webhook
adalah source of truth), event `paid/item.sent` → email "Pesanan Diproses",
saldo habis → email pembeli, QRIS pending ada spinner jam + tombol cek manual.
Seluruhnya di balik
`SEKALIPAY_ENABLED=false` (lihat `.env.example`); set proxy URL + token +
`SEKALIPAY_WEBHOOK_SECRET` di Pages Secrets, whitelist IP VPS (`13.228.147.90`) di
dashboard SK, set callback `https://axvara.tech/api/webhook/sekalipay`, lalu
Force Sync dari tab **Sekalipay**. Arsitektur: `docs/ARCHITECTURE.md` §15b.

---

Panel admin memuat produk, kategori, dan ringkasan setelah autentikasi. Aksi toast memakai identitas yang stabil seumur provider, sehingga satu error fetch tidak lagi membentuk rantai toast → rerender → fetch ulang. Login memuat data tepat sekali (transisi sesi adalah satu-satunya pemicu), dan hanya `401` yang mengakhiri sesi — respons `5xx` atau kegagalan jaringan tidak menendang admin ke gerbang login.

**Panel admin dirapikan (2026-09-20, persetujuan owner).** Modal produk kini
bertab (Produk / Varian / Foto) dengan tombol **Simpan Produk** di footer yang
tidak ikut ter-scroll — untuk produk 5 varian tombol itu dulu berada ~2600px di
bawah area kerja. **Integrasi Agent** dan **Subscriber Email** turun menjadi tab
di **Pengaturan Toko** (sidebar 12 → 10 menu); `?section=agent` dan
`?section=subscribers` tetap berfungsi untuk tautan lama. Kartu metrik di
**Pesanan** kini mengikuti filter yang sedang aktif dan menandai dirinya
"hasil filter" — sebelumnya memfilter ke Pending tetap menampilkan total
seluruh toko. Tab kanal sengaja tetap global karena ia pemilih.

**Filter yang kasat mata (revisi 2026-10-15).** Pill **Stok menipis** di Ringkasan dihapus untuk menyederhanakan toolbar. Deep-link `?section=products&low_stock=1` tetap menyaring Produk dan menampilkan chip yang bisa dilepas.
Satuannya juga disamakan: Ringkasan dan Produk sama-sama menghitung **varian
aktif berstok 0–5** (sebelumnya Ringkasan menghitung varian dan Produk
menghitung produk, sehingga satu label menampilkan dua angka berbeda).
Di **Pesanan**, setiap filter aktif tampil sebagai chip yang bisa dilepas satu
per satu — termasuk filter `proof` dari kartu "Bukti manual" yang sebelumnya
menyaring daftar tanpa jejak apa pun di layar. Penghapusan kategori, banner,
dan artikel memakai `ConfirmDialog` bertema (bukan `confirm()` bawaan browser),
dan modal Kategori kini dialog yang sah: `role="dialog"`, `aria-modal`, tutup
dengan Escape, dan scroll halaman terkunci.

Katalog storefront menampilkan 16 produk lebih dulu dengan tombol **"Tampilkan N produk lagi"** (bukan nomor halaman), produk stok habis TETAP tampil di akhir sebagai kartu abu-abu tanpa tombol beli (kontrak trust 2026-10-01 — ganti kategori/search kembali ke 16 awal; otomatis jadi ready lagi saat restok), PDP produk pecundang supplier-pair 308 ke pemenang (noindex), dan harga kartu diambil dari varian termurah yang **masih tersedia**.

**Minimum pembelian per varian (migrasi 0034, generik):** `product_variants.min_qty` (default 1 = bebas, milik admin, plafon 100) mengatur batas bawah qty per baris — GSuite dikunci **min. 50** via migrasi, produk lain tinggal set angka dari admin bila butuh aturan grosir serupa. Label "Min. N" tampil di PDP/modal/keranjang/bot; server menolak qty di bawah min (quote 409 → orders 409 → guard atomik), plafon web/Telegram 100/baris, dan order WhatsApp (qty selalu 1) ditolak jelas untuk varian min>1 dengan arahan ke web/Telegram bulk.

**Dashboard untung (2026-10-15, implementasi; publikasi CI).** Periode Hari/Minggu/Bulan WIB berlaku untuk kartu, grafik, donat kontribusi omzet, batang untung supplier/channel dan Top 5. Modal dihitung per item WR/SK/stok sendiri/Pedia, termasuk keranjang campuran; transaksi baru mendapat snapshot modal atomik saat lunas (migrasi 0063), riwayat tanpa snapshot ditandai estimasi dalam data/ekspor, tanpa card peringatan di Ringkasan. Grafik hari ini per jam, minggu/bulan harian; rugi tetap terlihat dan jumlah order memakai sumbu tersendiri. Top 5 mencakup seluruh transaksi periode tanpa cap 500. Respons `period_reports` dimuat bersama ringkasan, tanpa polling atau cron baru.

Recovery ringkasan 2026-10-15: agregat SQL dibagi ke CTE agar kompatibel dengan batas compound SELECT D1, tetap satu query. Regresi dijalankan juga di D1 workerd (Miniflare), selain SQLite, agar batas SQL produksi ikut diverifikasi.

## ▶️ Jalankan Local (dev-only, tanpa build tiap ubahan)

```bash
cd /Users/macbookair/axvara          # WAJIB dari folder axvara (jangan dari ~)
npm install
# dev — cukup ini untuk harian, auto-reload, tanpa npm run build tiap ubahan
node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
# atau: npm run dev  (hanya jika cwd sudah axvara/)
# buka http://localhost:3000 — cek: curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Verifikasi mengikuti dampak perubahan di [AGENTS.md](AGENTS.md#verifikasi-wajib-berdasarkan-dampak-perubahan): dokumentasi saja cukup pemeriksaan diff/konsistensi, backend tanpa perubahan web memakai test terkait tanpa screenshot homepage, UI/flow web wajib inspeksi desktop/mobile dan interaksi relevan di browser nyata. Playwright/Chrome DevTools/Paseo boleh dipakai; Obscura opsional untuk smoke test/diagnosis, bukan bukti tunggal kelulusan web. Tidak wajib dev server atau build untuk setiap tugas; build sesuai target diperlukan untuk persiapan rilis atau perubahan konfigurasi/toolchain/routing besar. Jika port macet/CSS 404, identifikasi proses dan penyebab dahulu; jangan otomatis mematikan proses port 3000 atau menghapus `.next` yang dipakai sesi lain.

## 📝 Changelog & Aturan Project

- Panduan agent: keputusan terbaru per topik menggantikan snapshot lama pada bagian terkait. Label histori, saldo/jumlah test lama dan status lokal pada snapshot bukan bukti kondisi produksi sekarang. Saat kode/docs berbeda, telusuri requirement dan keputusan owner sebelum menentukan sisi yang salah.
- Iterasi kode memakai test terkait; seluruh `npx vitest run --run` tetap wajib lulus pada tree akhir sebelum commit/push perubahan kode. Dokumentasi saja cukup pemeriksaan dokumentasi sesuai tabel verifikasi. Publikasi kode/dokumentasi tetap otomatis commit + `git push origin main`, kecuali scope eksplisit owner melarang; stage hanya perubahan tugas sendiri dan berhenti setelah push diterima, tanpa memantau CI/CD.
- **Changelog:** `axvara/CHANGELOG.md` — setiap perubahan wajib catat entri paling atas (format: `YYYY-MM-DD — ringkas — file/area — (verifikasi: ...)`).
- **Remediasi review R1–R12:** `docs/REVIEW-REMEDIATION-2026-09-08.md` — CATATAN HISTORIS per 8 Sep 2026 pagi (menyebut 418 test/logout stateless/semua selesai — SUDAH TIDAK BERLAKU; lihat koreksi di bawah).
- **Eksekusi review round 3:** `docs/REVIEW-ROUND3-EXECUTION-2026-09-08.md` — CATATAN HISTORIS (klaim "semua selesai"/"per-item"/"qty" dikoreksi round 4; konteks dipertahankan).
- **Eksekusi review round 4 (historis):** `docs/REVIEW-ROUND4-EXECUTION-2026-09-08.md` — klaim budget, yield, audit dan recovery dikoreksi round 5.
- **Eksekusi review round 5 (terkini):** [laporan RR5-01–08](docs/REVIEW-ROUND5-EXECUTION-2026-09-09.md) — handover D1 memakai pencarian literal + fakta audit pemenang; manifest/qty dan UI mengikuti status bisnis; budget request-scoped 40 termasuk helper/batch; materialisasi bertahap; yield tidak menambah kegagalan; finalisasi atomik + pemulihan split lama; flag WA konsisten. Tidak ada migrasi baru; membutuhkan skema sampai 0022. Bukti lokal: 527 test (44 file), termasuk 26 test RR5 baru; batas bukti dan before/after dijelaskan di laporan.
- **Aturan project:** `axvara/AGENTS.md` — aturan inti khusus project axvara; keputusan per area (supplier, kredensial pembeli, admin/security, pembayaran, Pedia, platform, WhatsApp) di `docs/agent-rules/` dan wajib dibaca sesuai area tugas. `~/AGENTS.md` global sudah dihapus atas instruksi owner (2 November 2026). Wajib baca sebelum ubah kode.

## ☁️ CI/CD Cloudflare

```bash
# Provisioning awal saja
npx wrangler d1 create axvara-db        # copy database_id ke wrangler.toml
npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote
npx wrangler r2 bucket create axvara-assets

# Deploy normal
git push origin main
```

`.github/workflows/ci.yml` adalah satu-satunya jalur deploy otomatis. Setiap push `main` menjalankan test/type-check root + test/build gateway, build adapter Pages, memeriksa/menerapkan migrasi D1 (bukti rilis identik atau Wrangler remote), merilis gateway lewat Heroku API bila source/release berubah, deploy Pages, lalu deploy MCP Worker. Cloudflare Pages Git build dinonaktifkan agar tidak terjadi deploy ganda. Setelah push berhasil, agent berhenti dan tidak memantau workflow.

Perbaikan CI 2026-10-18: `scripts/ci-pages-env-check.cjs` memeriksa metadata konfigurasi produksi sebelum build/migrasi. Batas Workers Free adalah 64 variabel secret/text, termasuk empat variabel sistem Pages (`CF_PAGES`, `CF_PAGES_BRANCH`, `CF_PAGES_COMMIT_SHA`, `CF_PAGES_URL`); nama yang sama dihitung sekali. API gagal atau total >64 menghentikan rilis, tepat 64 memberi warning. Tidak membaca D1, mengubah env, atau mencetak nilai secret. Konfigurasi usang `PEDIA_DISPATCH_ENABLED` dihapus dari Pages produksi karena tidak dikonsumsi kode; dispatch antrean Pedia tetap berjalan lewat cron existing. Kini 60 konfigurasi + 4 sistem = 64: penambahan env berikutnya membutuhkan pengurangan konfigurasi yang benar-benar tidak dipakai. Secret KlikQRIS dan rail DANA/GoPay lama tetap ada. Sumber: [batas Workers](https://developers.cloudflare.com/workers/platform/limits/), [variabel sistem Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/).

Migrasi rebuild `0008_orders_multichannel.sql` aman untuk database produksi yang sudah memiliki transaksi dan fulfillment job: foreign key `order_code` pada seluruh tabel anak dipindahkan sementara, parent `orders` diganti, lalu key dipulihkan dan divalidasi sebelum commit. Tes regresi mengeksekusi skenario berisi child rows agar kegagalan constraint tidak baru ditemukan saat deploy.

Repository Actions memakai Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`. `.cf-credentials` hanya untuk provisioning/recovery lokal dan tidak pernah masuk Git. `npm run deploy` serta `npm run deploy:mcp` hanya dipakai untuk recovery manual yang diminta eksplisit.

Buka `wrangler.json` dan isi binding D1/R2 setelah resource dibuat. Custom domain `axvara.tech` dan registrar tetap dikelola Cloudflare.

### Aktivasi `axvara.tech` di registrar

Cloudflare sudah memiliki zone Free, custom domain Pages untuk apex dan `www`, CNAME proxied ke `axvara.pages.dev`, redirect `www` → apex, Universal SSL, Always Use HTTPS, TLS 1.3, dan minimum TLS 1.2. Pada `.TECH Domains`, verifikasi email registrant lalu ganti seluruh nameserver lama dengan hanya:

- `kyree.ns.cloudflare.com`
- `lara.ns.cloudflare.com`

Delegasi nameserver, HTTPS, dan DNSSEC sudah aktif. DS yang terpublikasi di registry adalah:

- Key tag: `2371`
- Algorithm: `13` (`ECDSAP256SHA256`)
- Digest type: `2` (`SHA-256`)
- Digest: `8B3525D5B383068BEFF69233B5851B25E40AA40A0625282FA9DDF0013DF2FAAD`

---

## 📸 QRIS Dinamis DANA

Tidak ada file QRIS statis publik. Payload merchant DANA disimpan hanya sebagai secret
`DANA_STATIC_QRIS`; server menyuntikkan total bayar, menghitung ulang CRC16, dan merender
PNG per kode order melalui `/api/payments/qris/[code]/image`. Aplikasi QRIS Hook di Android
mengirim `X-Webhook-Secret` ke `https://axvara.tech/api/webhook/dana`. Setiap event disimpan
idempotent dan hanya nominal persis dari invoice aktif yang dapat melunasi order.

Rail GoPay: payload merchant disimpan sebagai secret `GOPAY_STATIC_QRIS`. Riwayat
2026-10-16 memakai **axvara.tech** (`G284624569`, NMID `ID1026616934059`);
sejak27Oktober2026 invoice baru kembali ke **Axvara Digital/G564039370**.
Poller GoBiz memeriksa invoice berdasarkan merchant yang
tersimpan di payload tiap invoice, sehingga invoice dari merchant lama tetap
terverifikasi ke akun asalnya sementara invoice baru memakai axvara.tech;
kedua sesi GoBiz disimpan terpisah di VPS (lihat `docs/ARCHITECTURE.md` §16.9).

Setup aplikasi QRIS Hook: aktifkan Notification Access dan **QRIS Hook Active**, pilih merchant
**DANA**, pastikan **Debug Mode mati**, isi Webhook URL `https://axvara.tech/api/webhook/dana`,
lalu isi Secret dengan nilai rahasia yang tersimpan sebagai Pages Secret `DANA_WEBHOOK_SECRET`.
Jangan masukkan teks `DANA_WEBHOOK_SECRET` karena itu nama variabel, bukan nilai secret.
Event lama dapat dikirim ulang lewat **Retry pending**; respons HTTP 2xx akan berstatus **Sent**.
URL dan status konfigurasi tanpa nilai secret juga tersedia di admin **Metode & Rekonsiliasi →
QRIS & Rekonsiliasi**.

---

## 🔐 Admin

- URL: `/admin`
- Produksi dilapisi Cloudflare Access dan MFA; lihat bagian proteksi admin di atas.
- Credentials: set via Cloudflare Pages environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256` dalam format PBKDF2); satu pasang quote pembungkus dari paste shell/JSON didukung dan dinormalisasi server-side. Untuk PBKDF2, browser membuat proof atas challenge 5 menit sehingga Pages tidak melakukan derivasi berat.
- Sesi: JWT httpOnly cookie-only 8 jam + cookie idle JWT 2 jam terikat sesi yang sama; batas idle ditegakkan di server, refresh memutar idle baru yang tervalidasi, dan rotasi password mencabut seluruh sesi lama (login ulang).
- Dev mode: email `admin@axvara.tech` / password `axvara-dev-only`

### Aturan yang dikunci audit 2026-09-20

- **Jam selalu WIB.** D1 menyimpan UTC berformat spasi; `new Date(nilai)` di JS
  membacanya sebagai waktu lokal sehingga di perangkat Indonesia jam tampil
  mundur 7 jam. Pakai `formatWibDateTime` (`src/lib/utils.ts`) untuk SETIAP
  timestamp yang tampil — jangan memformat `new Date(<string>)` langsung.
- **Rahasia dibandingkan konstan-waktu.** Bearer/HMAC apa pun (webhook DANA,
  Telegram, WhatsApp, Warung Rebahan, dan `CRON_SECRET`) memakai
  `constantTimeEqual` dari `src/lib/security.ts`.
- **Endpoint order publik tidak membocorkan `proof_url`.** `GET /api/orders?code=`
  dan `GET /api/orders/:code` melayani halaman yang sama dan isinya wajib
  sepadan; kunci objek R2 privat hanya boleh lewat `/api/admin/bukti/*`.

## 🤖 Agent CMS dan Remote MCP

- Admin memakai sidebar responsif yang dikelompokkan sebagai Operasional, Katalog, Pembayaran, Konten, Otomasi, dan Sistem. Query `section` mendukung deep-link/back-forward, sedangkan ringkasan menjadi action center untuk antrean penting.
- Ikon admin memakai `IosIcon` (Icons8 iOS 11 Glyph PNG lokal, tint CSS) dengan prinsip hemat: ikon hanya untuk aksi dan pesan status; badge berupa teks + warna; dialog judul + tutup saja agar rapi dan tidak ramai.
- Menu **Pengaturan Toko** mengelola nama, tagline, nomor WhatsApp dukungan, jam layanan, teks legal footer, dan URL logo. Nilai disimpan di `store_settings` lalu dipakai oleh identitas dan tautan dukungan storefront dengan fallback aman dari `src/lib/site.ts`.
- Editor visual Tiptap menyimpan **Markdown** sebagai format kanonis agar ringan dan interoperabel dengan agent; artikel JSON Tiptap lama tetap dapat dibaca dan akan dikonversi saat diedit. Slug/excerpt dibuat otomatis server-side.
- Cover artikel/produk menerima PNG/JPG/WebP, dikonversi browser menjadi WebP 1600×900. **Galeri produk 2026-10-21 (implementasi, publikasi CI):** foto kedua dan seterusnya mempertahankan rasio asli tanpa crop, sisi terpanjang maksimal 1920 px; berlaku juga saat beberapa foto diupload sekaligus. PDP menampilkan foto tambahan utuh dengan tinggi otomatis, preview admin/strip thumbnail memakai `object-contain`; cover pertama tetap seperti sebelumnya. Foto lama yang sudah terpotong harus diunggah ulang dari gambar asli. Batas delapan foto dan penyimpanan URL tetap.
- Banner dikonversi ke WebP dengan rasio asli dan sisi terpanjang maksimal 1920 px; popup memakai gambar portrait/persegi/landscape sesuai sisa tinggi layar dengan object-contain tanpa crop/distorsi (ruang sisi diperbolehkan), dan hanya muncul di homepage agar tidak menghalangi checkout/admin/status pesanan. Checkbox kecil "Jangan tampilkan lagi" dan CTA tetap terlihat di footer di luar caption scroll; checkbox menyembunyikannya 24 jam (localStorage per banner id).
- Daftar pesanan menampilkan bukti sebagai preview card yang dapat dibuka penuh. Bukti kosong, URL tidak valid, dan file R2 yang hilang mempunyai status visual serta keterangan berbeda agar admin tidak salah mengira label tersebut sebagai tombol.
- Buat token Bearer di **Integrasi Agent**. Token mentah hanya muncul sekali dan token tanpa `articles:publish` tidak dapat publish.
- Content API: `/api/agent/context`, `/api/agent/articles`, `/api/agent/media`, `/api/agent/media/import`, dan activity audit. Agent tidak pernah menulis D1/R2 secara langsung.
- Endpoint MCP stateless utama ikut terdeploy bersama Pages. URL client tunggal: `https://axvara.tech/mcp`, transport Streamable HTTP (`POST`) dan header `Authorization: Bearer <token>`. Hostname `pages.dev` tidak boleh dipakai client karena diarahkan ke domain utama.
- Untuk gambar dari generator yang menyediakan URL publik, agent memakai `import_article_image_from_url` agar gambar WebP maksimal 5 MB diambil server-side tanpa base64 panjang. URL sumber wajib HTTPS publik, setiap redirect divalidasi, dan hasil diperiksa melalui content type serta magic bytes sebelum masuk R2.
- Untuk file lokal, path tidak dapat dibaca oleh remote MCP. Agent yang memiliki akses terminal dapat melewati JSON/base64 dan mengunggah multipart langsung: `curl -H "Authorization: Bearer $AXVARA_AGENT_TOKEN" -F "file=@./cover.webp;type=image/webp" -F "kind=cover" https://axvara.tech/api/agent/media`. Token memerlukan scope `media:write` dan tidak boleh ditulis langsung ke prompt/log.
- Worker cron aktif di `https://axvara-mcp.sailinnadia1.workers.dev/mcp` dan memakai `https://axvara.tech` sebagai origin API. Setelah memuat `.cf-credentials`, `npm run deploy:mcp` memakai Global API Key lokal untuk deployment Worker.
- Jadwal artikel disimpan sebagai status `scheduled`. Cron Worker berjalan tiap 5 menit dan memanggil publisher terproteksi; `CRON_SECRET` pada Pages harus sama dengan secret Worker `AXVARA_CRON_SECRET`.
- **Cron operations satu fase per request (2026-10-04, Free plan):** Worker memanggil `/api/cron/operations?phase=…` berurutan (expiry → fulfillment → WR → SK → notify → cleanup); sync WR (10 produk) / SK (25 varian) dipotong dan diulang selama respons `more: true`, sehingga katalog segar ≤15 menit. Fase gagal → alarm Telegram admin tiap :00/:30 (secret Worker `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID`). Penanda run selesai `store_settings.cron_last_ok_at`. Latar: insiden 3 Okt 20:25–23:50 WIB, 41 run dibunuh `exceededResources` (batas CPU ~10 ms Free plan). Detail: `docs/ARCHITECTURE.md` §12. **Revisi 4 Okt:** fase WR/SK dibelah `part=orders` (didahulukan — order lunas tetap jalan walau sync kena limit) dan `part=sync`; potongan katalog diambil dari proxy VPS (`/wr/products-slice`, `/sk/catalog-slice`, tanpa state) sehingga Pages tidak mem-parse katalog penuh; alarm ber-state Workers KV `axvara-cron-state` (1 pesan mulai, pengingat 6 jam, 1 pesan pulih); penanda langkah `[cron] … step=` di log untuk diagnosa. **Diff VPS (4 Okt siang):** VPS proxy membandingkan katalog WR/SK tiap 3 menit dan mengirim HANYA yang berubah ke `POST /api/supplier-sync` (route ramping, secret `SUPPLIER_SYNC_TOKEN`) → katalog segar ±3–6 menit; sweep berpotongan cron turun jadi pengaman tiap 60 menit selama diff sehat. Tabel log WR/SK diberi indeks (migrasi 0057) setelah kuota D1 Free rows_read sempat 75% pada 4 Okt. **Cron lite (5 Okt):** expiry/fulfillment/order WR/SK inti + Daily Promo Digest lewat route ramping `/api/cron/lite` (jarang kena limit CPU); route besar tetap jadi pelengkap, alarm hanya untuk langkah inti + notify (≥30 mnt). Kiriman diff tidak masuk `*_sync_log`; kartu admin "Sync terakhir" memisahkan Diff VPS (cek + perubahan terakhir), Sync penuh, dan Manual. **Revisi 5 Okt malam:** notify + cleanup juga lewat lite; route besar hanya sekali per jam (tick :00 UTC) → request yang dibunuh limit CPU turun dari ±580 menjadi ≤24/hari. **Revisi 9 Okt pagi (insiden 09:50 WIB: 4 langkah lite 503 bareng, pulih ~30 mnt):** `notify` dipecah `notify_a` + `notify_b` (alias `notify` lama tetap), Worker jeda 2 dtk antar langkah lite; throttle saldo SMM = WR/SK (6 jam ATAU turun Rp5rb). **Revisi 9 Okt sore (kasus AXV-20261009-DA1ACF56 — order Drama All In One Telegram lunas tapi tidak masuk dashboard WR):** link WR tidak pernah dibuat webhook (COUNT due = 0 menutup reconciler di dalam proses) → probe yatim lunas-tanpa-link jalan TANPA gate due di lite wr/sk_orders + fase route besar (kunci respons orphan_links_healed).

Untuk database D1 yang sudah ada, jalankan migrasi berurutan sekali sebelum deploy setelah memuat `.cf-credentials`: `0002_editorial_agent.sql`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`. Migrasi terakhir menormalkan ikon kategori dan menambahkan tabel pelanggan email.

Next dev otomatis memakai 20 fixture Draft dari `src/lib/article-seeds.ts` saat D1 tidak terikat. `drizzle/seed-articles.local.sql` menyediakan seed idempotent yang bisa dijalankan manual pada D1; proses deploy tidak menjalankannya otomatis.

---

Private — AXVARA © 2026

### Panel admin — pembaruan 2026-10-15

Ringkasan mendukung bulan historis dan rentang inklusif WIB maksimal 366 hari. Toolbar periode/pemilih bulan/tanggal tanpa card dan tombol Terapkan; bulan atau pasangan tanggal lengkap/valid otomatis memuat laporan. Metadata tanggal/WIB/waktu pembuatan sejajar sesi admin, tersembunyi saat loading/gagal. Teks total/pending/pill stok menipis serta card estimasi dihilangkan; perhitungan dan penanda estimasi ekspor tetap tersedia. Tombol Unduh PDF dan Unduh Excel (.xlsx) berada di samping selector bulan/tanggal pada toolbar yang sama (membungkus di mobile), memakai respons laporan yang sama dengan layar; angka Excel tetap numerik, PDF berpaginasi. Pembayaran merchant dan kredit Pedia ditampilkan terpisah, untung produk belum dikurangi MDR/biaya operasional. Ekspor tidak tersedia selama laporan dimuat/gagal.

Banner dapat diaktifkan/dimatikan dari sakelar di sebelah Edit, sama seperti Produk (track hijau dan knob putih, `AdminStatusSwitch`). Urutan0–999 unik; sejak24Oktober hanya reorder atomik yang memindahkan posisi, sedangkan create append dan delete merapatkan daftar. Migrasi0064/index unik tetap. Seluruh banner aktif yang layak masuk satu carousel dengan konfigurasi bersama, satu popup per kunjungan dokumen dan batas sesi global; bukan hanya banner pertama.

Metode & Rekonsiliasi membaca provider efektif dari server; GoPay memakai panduan poller GoBiz, DANA legacy tetap tertera pada event lama. Status terkonfigurasi tidak menyatakan poller/sesi sehat. Logo overlay Market/Pedia dipaksa putih; filter X hanya ikon dan tetap aksesibel.

Pedia admin memakai tabel kaca dan toolbar/aksi yang sama dengan Produk: daftar Produk, Layanan Supplier, Pesanan, Kredit, harga tingkat dan riwayat saldo. Tabel memiliki header kolom dan wrapper scroll horizontal yang bisa difokuskan di mobile. Edit putih serta sakelar publikasi sejajar; filter, preview dan guard recovery tidak berubah.


### Penghematan kuota D1 — 2026-10-16

✅ Implementasi, publikasi melalui CI: Pedia hanya membaca layanan supplier yang
dirujuk katalog aktif; GoPay pending memakai indeks invoice aktif existing.
Cache API eksplisit di dalam handler mencakup API dan render server: katalog
Market 30 detik/produk tunggal 10 detik, Pedia dan kategori 60 detik. Header
`X-Axvara-Cache` menunjukkan HIT/MISS/BYPASS; dev tanpa Cache API membaca langsung.
Admin, quote, checkout dan status pembayaran tidak memakai cache publik.

Ringkasan admin dimuat saat section dibuka, periode standar berbagi satu agregasi
dan snapshot keuangan privat maksimal lima menit (revisi 2026-10-19) memakai
waktu pembuatan aktual; status operasional Ringkasan maksimal 60 detik.
Rentang historis, ekspor, autentikasi dan field legacy respons tetap tersedia.
Cron forced phase hanya membaca antrean relevan; expiry/fulfillment/pemulihan
order tetap per tick. Cleanup lite/heavy berbagi marker sukses per jam. Agregat
stok pairs tidak membaca stok/unlimited dua kali. Migrasi 0067 memperbaiki indeks
Pedia yang tersangkut di arsip dan menambah indeks query rutin tanpa rebuild/drop.

Log `[d1-read]` mencatat queryAll ≥1.000 baris melalui metadata saja (tanpa SQL,
parameter/hasil/secret atau write D1). Gunakan Query Insights untuk atribusi
seluruh metode. Kuota 5 juta baris/hari reset 07.00 WIB; target terbaru
≤3 juta/hari perlu diukur satu siklus reset setelah rilis. Tidak ada env/secret/kontrak proxy
atau jadwal Worker baru. Detail dan batas bukti: `docs/ARCHITECTURE.md` §17 dan
`issue/d1-read-budget-2026-10-16.md`.


### Penghematan admin dan lookup pembayaran — 2026-10-19

✅ Implementasi; publikasi melalui CI. Laporan keuangan Ringkasan memakai cache
memori dan Cache API internal **terenkripsi AES-GCM**, maksimal lima menit sejak
`generated_at` asli. Cache lintas proses hanya berbagi di lokasi Cloudflare yang
sama; tidak menjanjikan cache global. Sesi/revocation dan parameter tetap dicek
sebelum akses. Kunci turunan `ADMIN_JWT_SECRET` existing (fallback `JWT_SECRET`)
dipisahkan dari JWT signing; tidak ada secret/env baru. Snapshot gagal, rusak,
kedaluwarsa atau cache tidak tersedia membaca D1 lagi. Respons API admin tetap
privat; status operasional Ringkasan disimpan maksimum 60 detik, dan daftar
pesanan/pembayaran/checkout membaca data aktual. Rentang historis dihitung baru.

Pencarian link WR/SK laporan dimaterialisasi sekali per item. Facet global
kanal/status/metode pesanan dihitung dengan satu GROUP BY; total pagination
memakai agregat terfilter yang sama dengan kartu metrik. Migrasi baru **0072**
menambah indeks daftar order terbaru dan inventory `(order_code,status)`, termasuk
lookup reservasi saat polling KlikQRIS. Kesehatan antrean memakai indeks status
existing dan urutan join eksplisit agar riwayat order tidak dipindai saat kosong.
Tidak ada cron/flag/proxy baru. Angka penghematan fixture dan batas buktinya:
[laporan 19 Oktober](issue/d1-read-budget-2026-10-19.md). Target ≤3 juta reads/hari
harus dibuktikan satu siklus produksi; push bukan bukti hasil deployment.

### Muat data sesuai kebutuhan — 2026-10-19

✅ Implementasi; publikasi melalui CI. Katalog admin/editor hanya dimuat ketika
masuk Produk; Ringkasan/Pesanan/menu lain tidak mengambil katalog. Kembali ke
Produk, URL langsung dan back/forward memuat data baru; render biasa/filter lokal
tidak mengulang fetch. Loading/retry katalog hanya tampil di Produk.

Polling pembayaran dan pengiriman Market berhenti ketika tab tersembunyi.
Saat kembali, GET status biasa segera berjalan selama jatah polling masih ada;
interval terlihat 5 detik QR dinamis/30 detik lainnya, urutan cepat/lambat serta
batas polling pengiriman tetap. Hidden tidak memakai/mereset jatah; request
in-flight tetap boleh selesai; cek manual dan otomatis berbagi pengunci request.
Cek manual `wake=1`, webhook, cron, expiry dan
pengiriman/email tetap bekerja. Tanpa env/migrasi/kontrak API baru. Besar dampak
harian perlu pengukuran produksi; tidak disamakan dengan jumlah request fixture.

### Penghematan lanjutan D1 — 2026-10-17

✅ Implementasi/verifikasi lokal, publikasi melalui CI. Seluruh Ringkasan admin
memakai snapshot privat maksimal 60 detik setelah auth/revocation/validasi;
revisi 2026-10-19 membagi umur data: keuangan maksimal lima menit, status
operasional maksimal 60 detik. Berganti periode tidak memperpanjang TTL asal. Daftar, kategori,
pencarian dan bestseller Telegram berbagi katalog publik 30 detik. Detail,
checkout, pembayaran dan kredensial tetap memeriksa data aktual.

Query attention dimulai dari antrean bermasalah; filter pecundang dihitung
sekali, inventory memakai EXISTS. Migrasi 0068 menambah indeks inventory/recipient
serta antrean `supplier_pair_dirty` dengan token versi/pending. Trigger menandai
perubahan stok/modal/preferensi secara atomik. Request `action:pairs` VPS dan
cron lite cleanup existing menguras maksimal sepuluh pasangan per pemanggilan;
error/perubahan bersamaan menyisakan pending untuk retry. Sweep penuh per jam
existing tetap cadangan dan tulisnya juga dijaga versi. Token dipertahankan
setelah ack agar proses lama tidak menimpa keputusan baru. Kontrak sukses VPS,
secret/flag dan jadwal Worker tetap; tidak perlu deploy VPS.

Monitor baca-saja `.github/workflows/d1-usage.yml` berjalan tiap jam pada menit
17 atau manual melalui Actions. Memakai tiga Secrets Cloudflare CI existing,
GraphQL Analytics akun, tanpa query SQL D1 atau deploy. Summary/artifact tujuh
hari memuat reads/writes, reset 07.00 WIB, laju terbaru, proyeksi dan anggaran
tersisa per jam. Proyeksi melampaui limit atau penggunaan ≥90% setelah jam
pertama menghasilkan job gagal/warning; analytics kosong/gagal juga tidak
mengklaim aman. Notifikasi mengikuti pengaturan GitHub, bukan pesan Telegram;
jadwal/analytics dapat terlambat atau sampled. Untuk baca manual, muat
`.cf-credentials` sesuai AGENTS lalu jalankan `node scripts/d1-usage-check.cjs`
dengan `CLOUDFLARE_ACCOUNT_ID` akun terkait. Jangan menampilkan isi kredensial.

Log `[catalog-cache]`/`[overview-cache]` melengkapi `[d1-read]` tanpa data pribadi
atau write telemetry. Uji D1/workerd fixture: katalog 40.220→2.040 reads,
inventory 250.050→100, attention 24.997→10; tick pasangan bersih nol baris.
Target terbaru ≤3 juta reads/hari perlu diukur satu siklus reset produksi;
belum ada klaim bebas limit malam hari. Detail: ARCHITECTURE §17.1 dan
`issue/d1-read-budget-phase2-2026-10-17.md`.


### Maintenance otomatis saat kuota D1 habis — 2026-10-17

✅ Implementasi, publikasi melalui CI. Halaman Market/Pedia berubah menjadi
maintenance sementara ketika probe D1 mendeteksi error kuota harian baca/tulis.
Layar mandiri tidak bergantung pada katalog, settings, JavaScript atau D1: ada
estimasi **07.00–08.00 WIB beserta tanggal**, tombol order manual melalui hub
WhatsApp dengan pilihan nomor aktif, support Telegram, dan coba buka toko lagi.
Jam layanan admin tetap 09.00–23.00 WIB; estimasi bukan jaminan. Preview lokal:
`http://127.0.0.1:3000/maintenance` (503 yang disengaja, GET/HEAD, no-store/noindex).

Probe paling banyak satu baris, cache status maksimal 60 detik per lokasi/origin
dan proses serta gabung miss paralel; cold start/cache gagal dapat menambah
pemeriksaan. Tidak ada polling browser atau write D1. Setelah reset UTC (07.00
WIB), probe berikutnya yang berhasil membuka toko lagi; tidak ditahan sampai
08.00. API pembayaran/webhook/cron/bot tetap memakai kontrak existing. Tab yang
sudah terbuka perlu navigasi/reload untuk melihat layar ini. Tidak ada env,
secret, migrasi atau perubahan kontrak proxy baru; bukan penanganan limit CPU/
request Worker. Detail: `docs/ARCHITECTURE.md` §18.

Perbaikan CI 2026-10-17: `scripts/ci-d1-migrations.cjs` membandingkan berkas
`drizzle/migrations`, `drizzle/schema.sql` dan `wrangler.json` dengan ancestor
rilis sukses terakhir dari `ci.yml` (push main), termasuk bukti tahap migrasi
dan deploy Pages sukses. Bila identik, tidak ada perubahan migrasi yang perlu
ditanyakan ke D1, sehingga rilis kode maintenance tetap bisa terbit saat kuota
habis. Berkas berubah, bukti hilang, atau GitHub API gagal → pemeriksaan
Wrangler remote tetap wajib lulus sebelum deploy. Checkout mengambil history
penuh; izin `actions: read` dan `GH_TOKEN` otomatis dari `github.token` hanya
untuk membaca riwayat CI, tanpa secret/env Pages baru. Ini bukan pemeriksaan
drift DB setelah restore/recreate; operasi itu wajib memeriksa migrasi remote.
Keberhasilan push tetap belum berarti halaman sudah tayang.

### Notifikasi saldo Pedia saat D1 terganggu — 2026-10-17

Pengingat saldo ProviderSMM/IndoSMM tetap setiap enam jam atau bila turun
melewati batas Rp5.000. Pembacaan state dan reservasi atomik harus berhasil
sebelum kirim; D1/budget gagal menunda alert saldo, bukan mengirim tanpa throttle.
Dua cron bersamaan hanya memberi hak kirim pada satu reservasi. Checkpoint
ProviderSMM gagal juga menghentikan pengecekan proxy untuk saldo pada tick itu;
provider lain tetap independen. `true` berarti Telegram mengakui pesan. Jika
Telegram menolak/timeout, reservasi dipertahankan agar tidak dikirim lagi tiap
tick; pengingat berikutnya mengikuti throttle, sehingga alert bisa tertunda.
Tidak mengubah dispatch, pembayaran, harga, supplier atau notifikasi pembeli.


AXVARA Games (implementasi bertahap, 9 November 2026): spesifikasi di `docs/GAMES.md`; (14 Nov 2026, lokal) karusel "Game lainnya" `GamesRail`, overlay lintas aplikasi `CrossAppTransition` kini juga Games, dan footer bersama menampilkan baris metode pembayaran (`FooterPayments`);
supplier Digiflazz (`docs/agent-rules/digiflazz.md`). Backend inti memakai
`src/lib/games/{pricing,digiflazz,catalog-sync,dispatch}.ts`, proxy VPS `/dgf/*`,
migrasi `0107_games_core.sql`, cron lite `games_catalog`/`games_orders`, dan webhook
`POST /api/games/digiflazz/webhook`. Admin data memakai migrasi `0108_games_admin.sql`
(`games_reference_prices`, override grup/urutan), tab **Games** di `/admin?section=games`,
API `GET/PATCH /api/admin/games/products` (+ filter `sellable`, urutan `sort=sellable`); `POST .../enable-wave` DIHAPUS 13 November 2026.

Cutover Sekalipay (12 November 2026, lokal, belum deploy): penjualan baru Games
memakai katalog kategori `Game` Sekalipay, bukan empat game Digiflazz. Sumber data
`drizzle/migrations/0118_games_sekalipay.sql` + `src/lib/games/sk-catalog-sync.ts`;
home/detail/pencarian/sitemap membaca D1, field mengikuti kontrak varian terpilih,
dan dispatch SK memakai `src/lib/games/sk-dispatch.ts` (ref stabil, sent-fence,
tanpa POST kedua/fallback). Cron `games_catalog` tidak lagi memanggil price-list
Digiflazz. Admin hanya mengelola varian SK; baris Digiflazz legacy dipertahankan
untuk histori dan `enable-wave` sudah dihapus (13 November 2026). Gate order baru
`GAMES_SK_ENABLED` belum diset, jadi tidak ada pembelian produksi dari perubahan ini.
Verifikasi final terintegrasi 12 November 2026 (setelah fix regresi stok -1 dispatch):
full suite serial parent `npx vitest run --run --maxWorkers=1` **438 file/5.923 tes lulus**
(228,77 dtk), lalu `npm run build:pages` penuh **PASS 173 edge route** (Next compile/lint/
typecheck + konversi; 19,02 dtk hanya durasi konversi, bukan total build). Catatan
pemulihan jujur: default-worker suite sempat timeout fixture workerd
`telegram-bulk-checkout` 5 dtk dan run 2-worker sempat gagal 2 fixture workerd
`telegram-payment-rails`; keduanya lulus saat ditargetkan dan serial penuh lulus tanpa
perubahan kode/assertion/timeout. Checkpoint lama 419/5.760 (pra-integrasi) dan
438/5.920 (pra-fix stok) tetap histori, bukan hasil final. QA browser publik 1280/390
lulus; admin statis 8792 dengan fixture jaringan lulus (bukan auth/backend persist/
produksi). Belum deploy/push; `display_order` masih API-only tanpa editor UI.

Games 14 November 2026 (lokal di worktree integrasi, belum publikasi CI/deployment):
harga jual kini **markup OD1** — default 5 % + pembulatan Rp100, precedence varian → game →
global dengan `fixed` aditif (`src/lib/games/pricing.ts`, `src/lib/games/markup.ts`); migrasi
`0122_games_markup_meta.sql` menambah `games_meta` (nama/publisher/ikon/banner/deskripsi/panduan
ID/urutan/hidden/markup game) dan `games_variant_markup` (override per varian) + default
`store_settings` 5/100, tanpa menyentuh baris Digiflazz. Katalog publik memakai presedensi
admin → aset resmi lokal → fallback (`src/lib/games/assets.ts`, `src/lib/games/catalog.ts`),
`hidden`/`featured_rank`/`min_price` hanya varian bisa dijual, label field dibersihkan dan label
generik diganti mayoritas game. Storefront Oura+ditopup: langkah `Data akun → Nominal → Metode →
Kontak` dengan varian tersedia termurah kategori `topup` terpilih otomatis, chip tipe/region,
section kategori (semua kartu langsung tampil), badge bergambar "Pengiriman / INSTAN" + ikon item
per game (`public/brand/games/items/`, `src/lib/games/item-icons.ts`) per kartu, hero detail
Bottom nav mobile Games (16 Nov 2026, lokal): **Beranda · Kategori · Lacak · Bantuan**; Kategori membuka `src/components/games/GamesCategorySheet.tsx` (genre → filter katalog via event `axvara:games-genre` atau `/games?genre=<slug>#games-catalog`).
`src/components/games/detail/*` (banner 16:9/21:9 maks 440 px, ikon kartu 3D melayang, trust
row SVG animasi), state Habis eksplisit, rail sticky + bar mobile, frame P14 dan banner
generatif blur 48 px. Admin Games: tab Game/Varian/Harga, editor per
game, markup efektif + kategori penuh dengan scroll internal, bulk aman (field tak dikirim
dipertahankan); API baru `GET/PUT /api/admin/games/pricing`, `GET/PATCH /api/admin/games/games`,
`POST /api/admin/games/products/bulk-markup`. Aset: `scripts/games-assets.mjs` +
`scripts/games-assets.manifest.json` → 48 ikon + 48 banner tepat 1600×900 (≤200 KB; 26 edit `image_gen` atas art resmi, 14 Nov 2026) + 48 portrait (10.023.192 byte) di
`public/brand/games/`, provenance `docs/games-assets.md`; gambar produk Sekalipay tidak dirender
dan entri CSP-nya dihapus. **Storefront 14 Nov 2026 (lokal):** "Populer sekarang" maks 9 kartu
(`featured_rank` admin, selain itu daftar default 9 slug di `src/lib/games/popular.ts`), chip genre
statis `src/lib/games/genres.ts`, semua game tampil tanpa "Tampilkan lainnya", dan kartu game
portrait 2:3 `600×900` Oura-style (hover/fokus overlay, fallback ikon square) — `portrait` juga
dipakai grid "Game lainnya" di detail; header detail tetap ikon square. Pipeline/aset lengkap di
ARCHITECTURE §16.42. Tanpa env/secret baru; gate order, quote/order, dispatch, webhook,
nickname tidak berubah. Verifikasi terintegrasi final: full suite **448 file/6.149 tes lulus**
(exit 0, 68,03 dtk), fokus G-ADMIN 9/140 · G-ASSETS 4/146 · G-STORE-2 4/42, `tsc`/lint/
`build:pages` lulus pada sumber final, QA Chromium 1280/390 + admin terang/gelap (fixture).
Kontrak lengkap `docs/GAMES.md` §14 dan ARCHITECTURE §16.41–§16.42.

Seed referensi Oura A2 (lokal, belum deploy): `drizzle/migrations/0111_games_reference_seed.sql`
menambah198 SKU utama (FF16/FF MAX8/ML156/PUBG18), tidak menimpa baris admin existing
(`ON CONFLICT DO NOTHING`). Sinkron katalog berikutnya baru menghitung ulang harga
jual/cermin referensi; seed tidak mengaktifkan SKU. Generator deterministik offline
(Node>=22.18, native type stripping untuk guard utilitas bersama):
```bash
node scripts/generate-games-reference-seed.mjs /path/private/reference.json /path/private/skus.json
```
Input berupa JSON riset R1, tidak dimasukkan repo. Seleksi: exact, empat brand
gelombang1, utama (kode `...b` cadangan bila dasar ada), non-Cek Username, harga
Oura integer positif, rasio Oura/modal0.5–3.0 inklusif.383 kandidat =>198 diterima,
185 dibuang (168cadangan/16bukan-exact/1rasio); stdout melaporkan perbrand/alasan
dan seluruh daftar dibuang. Source/timestamp snapshot tetap, SQL terurut kode;
lihat `docs/GAMES.md` §12.7 dan ARCHITECTURE §4/§16.27. Tidak mengakses provider/produksi.

S1 (lokal, belum deploy): `SITE.gamesUrl=https://games.axvara.tech`, middleware host
rewrite `/`/halaman ke `/games/*` tanpa enable flag dan308 `/games/*` dari host lain
(localhost/127.* dikecualikan). `GAMES_HOST` opsional, default host tersebut; Pages
`secret_text` jika dipasang. API/aset/R2/MCP tetap shared, admin produksi ke apex.
HERO-FIX10November2026 (lokal): hero Games memakai kelas Pedia dan `PediaOrbit`
yang sama (orb kaca3D/mark putih, empat planet registry tetap ada tanpa SKU enabled),
tanpa eyebrow/glow gold. Dua kartu Market+Pedia memakai CrossServicePromo berdampingan,
utm_source=games. Game registry tanpa SKU tetap200/header + "Nominal segera tersedia"
dan noindex; slug lain404. Gating PEDIA_ENABLED tidak diubah; masalah env Pedia
ditangani PM, bukan dengan mengubah tautan atau mengaktifkan layanan lewat kode.
Metadata UI memakai `src/lib/games/metadata.ts`; `src/app/games/sitemap.ts` menyediakan
root+slug registry enabled yang sellable, robots berupa handler `games/robots.txt/route.ts`.
PM9November2026 sekitar21.40–22.05WIB menambahkan CNAME `games` ke `axvara.pages.dev`
(proxied) serta custom domain Pages `games.axvara.tech` (status awal initializing,
aktif belum diverifikasi). Apex sitemap/robots tidak berubah. Access admin belum
mencakup Games: `/admin` produksi ke apex, `/api/admin` fail-closed tanpa bypass.

Env Pages produksi dipasang PM sebagai `secret_text`: `DIGIFLAZZ_USERNAME`,
`DIGIFLAZZ_API_KEY` (Development Key), `DIGIFLAZZ_WEBHOOK_SECRET`, `DIGIFLAZZ_TESTING=true`.
Snapshot75env dikonfigurasi/79dari128termasuk4sistem; berlaku pada deployment CI berikutnya,
bukan bukti runtime aktif. Cron Games katalog akan memakai Development Key, sedangkan
ordering tetap pratinjau P9 dan nickname unavailable selama testing=true. Owner9November
malam menutup gerbang7.1 tanpa rotasi key; webhook dashboard tetap non-aktif (7.2),
deposit/Production (7.3) dan transaksi nyata (7.4) belum dilakukan. Tidak ada klaim live.

`POST /api/games/nickname` `{slug,fields}` (stream8.000byte) => ok+nickname / unavailable /
invalid+message ID/EN. Registry memetakan FF/FF MAX ke `ffcekusername`, ML ke `mlcekusername`,
PUBG ke `pubgcekusername`; utilitas ini/nama Cek Username tidak pernah dijual, quote/order
baru atau enable admin409 `not_sellable`, aktivasi gelombang melewati utilitas.
Migrasi `drizzle/migrations/0109_games_nickname.sql`: cache24jam sukses/1jam ID salah rc54,
claim ambigu tanpa expiry, log admission/modal+status. IP10/perangkat5 perrolling15menit,
global500/hari UTC; cookie UUID httpOnly, IP HMAC, ID game plain non-secret.
Modal katalog dipakai max_price (fallback snapshot5/24/80), >Rp80 ditolak: batas500cek
<=Rp40.000/hari. Pending satu recheck1,5detik payload/ref sama, tidak ref baru saat ambigu;
S1b lokal memulihkan pending/ambiguous pada request berikutnya setelah60detik melalui
CAS D1: satu re-poll ref/payload/max_price asli, tanpa log biaya atau slot global baru.
IP10/perangkat5 per15menit tetap dibatasi scope rateLimit existing best-effort per isolate
(counter terpisah dari admission berbayar D1); tidak ada plafon global re-poll tanpa biaya.
Pagar satu re-poll/60detik per entri durable, respons stale tidak menimpa hasil pemilik baru.
P9/error D1/limit/gangguan => unavailable, checkout tidak diblokir.
GET admin products `nickname_checks.today/week` dan header GamesManager menampilkan
jumlah/batas modal hari ini/7hari kalender UTC, bukan tagihan final. Detail ARCHITECTURE §16.29.

B1+B2 API pembeli QRIS/gateway/crypto (lokal, belum deploy):
- `GET /api/games/catalog` + `GET /api/games/catalog/[slug]`: empat game registry,
  nominal enabled, seller OFF tampil unavailable, tanpa modal/seller/backup.
- `POST /api/games/quote` body `{slug,buyer_sku_code,fields,nickname?,locale?}`:
  quote JWE autentik/terenkripsi 30 menit tanpa kontak, harga `sell_price`,
  respons `paymentMethods` dari katalog Pedia/Market dengan biaya/total dan `game`/`sku` ringkas.
- `POST /api/games/orders` body `{quote_token,payment_method,whatsapp,email}`: order `AXG-YYYYMMDD-XXXXXXXX`,
  kontak divalidasi/normalisasi saat order, quantity 1, `max_price=min(harga jual,ceil(modal*1.05))`,
  deadline QRIS15/gateway30/crypto60 menit, minimum deadline provider tanpa perpanjangan;
  satu batch order + item, admission D1 bersama, tanpa stok Market; retry quote
  memakai order/invoice sama. Konflik harga/ketersediaan/target aktif → 409;
  gagal rail non-QRIS503 `error_code:payment_method_unavailable` membawa kode/status_url.
  Definitif membatalkan order+expire item (restock kosong), ambigu mempertahankan klaim;
  saved retry non-QRIS tidak POST ulang. Token maksimal30.000 karakter, body stream32.000byte tetap.
- `GET /api/games/orders/[code]` header `x-order-contact` WA/email checkout penuh;
  `POST /api/games/lookup` body `{code,contact}`: status jujur
  awaiting_payment/processing/success+SN/needs_admin/expired, kontak respons dimask.
  Cron expiry existing menyapu order/item unpaid; shared cancel tidak restock Games.
  Status/lacak menyertakan view kanonis gateway/crypto; polling/recovery GET-only memakai
  klaim durable existing. Consent memakai `POST /api/orders/[code]/payment-consent` dengan
  kontak penuh dan total tepat. Paid DANA/GoPay/KlikQRIS/gateway/crypto memicu scheduler Games,
  bukan job Market/WR/SK; late/underpaid/mismatch tetap manual review tanpa dispatch.
- 17 November 2026: parser H2H SK membaca `items[].h2h_results`; admin `GET /api/admin/games/orders/[code]`
  + `POST .../recheck` (GET-only, pulihkan needs_check yang sebenarnya sukses); email pembeli Games
  (dibayar/berhasil+SN/perlu admin); laporan/daftar/CSV/Telegram admin membaca `games_order_items`;
  halaman pesanan + `/games/lacak` bergaya Pedia dengan "Pesanan di perangkat ini". Detail ARCHITECTURE §16.49.
- Lanjutan 17 Nov: email pembeli Games 2 jenis (lunas+diproses, berhasil+SN), needs_check hanya Telegram admin;
  nama/keterangan nominal pembeli dirapikan `src/lib/games/display-name.ts` (DB/admin tetap mentah).
  Guard pembayaran bersama menerima AXG, guard/route Market tetap AXV-only.

Registry/format ID di `src/lib/games/registry.ts`; kontrak API lengkap dan rentang
validasi konservatif di `docs/GAMES.md` §12.8 / ARCHITECTURE §16.28. P9: testing true
atau username/key kosong → `ordering_open=false`, POST quote/order 503 `games_preview`
(ID/EN), katalog tetap terbaca. B1 tidak memasang env atau mengaktifkan Production;
UI `/games` dan bukti deployment belum termasuk B1/B2; nickname ditambahkan S1 di atas. Fokus B2 67 file/1016 tes
hijau termasuk D1 workerd; full suite/build diteruskan ke PM, tanpa akses/transaksi produksi.
