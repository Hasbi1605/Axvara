# PRD — AXVARA

## QRIS KlikQRIS — 2026-10-18

Deteksi lunas cepat 2026-10-18 ✅ diimplementasikan, publikasi melalui CI:
halaman pesanan yang sedang menunggu kini mengonfirmasi pembayaran KlikQRIS
tanpa menunggu callback gateway (teramati ±28 detik sesudah bayar). Polling
Market/Pedia memicu pemeriksaan status gateway maksimal sekali per ±10 detik
per pesanan lewat klaim atomik; polling selebihnya tetap membaca status lokal,
dan tombol cek manual tetap memeriksa seketika. Target deteksi ≤15 detik
sesudah pembayaran terkonfirmasi gateway. Teks "Batas bayar otomatis 15 menit…"
di bawah QR halaman pembayaran Market/Pedia dihapus atas keputusan owner;
batas 15 menit, countdown, dan penanganan pembayaran terlambat tidak berubah.

Koreksi checkout 2026-10-18 ✅ diimplementasikan, publikasi melalui CI: koneksi
API dan PNG QR memakai mode redirect yang kompatibel dengan runtime Cloudflare,
tetap menolak redirect. Retry checkout dengan quote sama melanjutkan invoice
KlikQRIS yang sudah ada, termasuk ketika stok terakhir sudah direservasi; tidak
membuat order/reservasi/tagihan kedua. Bila QR belum siap, halaman pesanan
menampilkan **QRIS belum siap** dan tombol **Coba siapkan QRIS**, tanpa arahan
verifikasi bukti manual. Tombol itu memulihkan invoice lewat GET ID yang sama;
polling biasa tetap hanya membaca status lokal. Invoice yang tidak ditemukan
di gateway tetap ditahan untuk cleanup/review, tanpa mengulang POST ambigu.

✅ Diimplementasikan, publikasi melalui CI. Invoice baru Market, Pedia, Telegram (satuan/keranjang), dan bot WA memakai **PG KlikQRIS/in-house** bila `QRIS_ACTIVE_PROVIDER=klikqris`. Bukan MY PG/sandbox. Pemesanan otomatis dibuka kembali lewat build `NEXT_PUBLIC_PAYMENTS_MAINTENANCE=false`; switch maintenance tetap tersedia untuk recovery.

Nominal bayar persis `total_amount` gateway, termasuk kode unik dari provider; tidak menambah kode lokal kedua. Keputusan owner: **batas bayar AXVARA tetap 15 menit**, walaupun invoice uji gateway berlaku 60 menit. Deadline order/ledger adalah yang paling awal antara deadline AXVARA yang sudah ada, 15 menit, dan expiry gateway; retry tidak memperpanjangnya. Semua kanal menjelaskan: lewat batas, jangan membayar QR lama; jika terlanjur, hubungi admin. Pembayaran terlambat/cancel/expiry yang sudah dikonfirmasi KlikQRIS tercatat di Rekonsiliasi dan diberitahukan ke admin sekali per event, tanpa menghidupkan order, memotong stok lagi, atau mengirim produk otomatis. Admin meninjau stok/dana untuk penyelesaian manual; tidak ada refund/pelunasan paksa otomatis.

Callback per invoice memvalidasi signature tersimpan, order/merchant/nominal dan konfirmasi status API server. Gagal konfirmasi tidak dianggap lunas. Transisi paid, event dan outbox Market atomik; Pedia memakai antreannya sendiri, tidak mengirim produk Market dengan ID sama. Callback duplikat tidak mengulang fulfillment. POST create hanya oleh pemenang klaim ledger durable; timeout/panggilan ambigu dipulihkan melalui GET status dengan order ID sama, tanpa membuat tagihan atau memindahkan provider otomatis. Stok order in-flight tetap direservasi, cleanup lama menjadi penjamin.

Invoice DANA/GoPay lama tetap di rail asalnya; webhook/secret/poller lama dipertahankan. QR gateway ditampilkan lewat proxy PNG same-origin yang dibatasi host/ukuran/redirect, tanpa Snap JS atau signature di browser. Callback adalah authority utama; tombol Cek pembayaran/Periksa pembayaran dapat mengonfirmasi lewat API provider. Polling halaman menumpang reconcile ter-throttle ±10 detik/order (2026-10-18); tidak ada cron/polling gateway baru.

## Maintenance pembayaran — 2026-10-18

✅ Switch diimplementasikan untuk penghentian pembayaran sementara. Pada rilis KlikQRIS 2026-10-18 nilainya `false`; perilaku berikut berlaku ketika switch diaktifkan kembali. Katalog Market/Pedia tetap dapat dibuka; banner di kedua layanan dan panel checkout mengarahkan pembeli ke **Order manual via WhatsApp**, melalui hub `/wa` dengan pesan terisi. Tidak menjanjikan jam selesai atau reset otomatis.

`/start`, tombol home dan percobaan bayar/perpanjang QRIS di Telegram memberi pemberitahuan serta tombol WA; katalog dan Pesanan saya tetap tersedia. Bot grup WA juga menolak pembayaran otomatis dengan tautan admin. Penolakan server sebelum membuat order, memotong stok/kredit atau menulis invoice berlaku pada checkout Market/Pedia dan reissue, termasuk akses langsung. Invoice dan order lama tidak dihapus: webhook merchant, pelacakan, pengiriman dan cleanup kedaluwarsa tetap berjalan. Pembeli yang sudah membayar diminta menyimpan bukti dan menghubungi admin dengan kode pesanan. Tidak ada siaran massal otomatis.

Pengaktifan/pemulihan memakai switch build publik `NEXT_PUBLIC_PAYMENTS_MAINTENANCE` di langkah build CI; `true` = maintenance, `false`/tidak diset = alur biasa. Perubahan membutuhkan build dan push baru, terpisah dari maintenance kuota D1.

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator 2026-10-16 ✅ implementasi, publikasi melalui CI: halaman platform dimulai dari kartu kebutuhan tanpa jenis/paket/jumlah otomatis. Setelah jenis dipilih, tiga layanan awal tersedia pada semua ukuran, lalu layanan terpilih diringkas dengan aksi Ganti. Jumlah → link → persyaratan berdekatan; detail panjang terlipat setelah input, sementara informasi drop/refill tetap terlihat. Kontak & konfirmasi tetap tahap kedua, kembali mempertahankan isian. Harga alternatif memakai jumlah yang sama; batas/kelipatan tidak cocok ditandai dan harga minimum tidak menggantikan total yang belum tersedia. Header/ringkasan mengikuti identitas platform; ringkasan awal berisi petunjuk singkat. Kontrak harga, quote, kredit, pembayaran, supplier dan beranda tetap.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

**Product:** AXVARA — Gerbang Semua Tools Premium
**Tagline:** Satu Gerbang, Semua Tools Premium
**Version:** 1.1 — Production (sinkron 2026-09-15, sebelumnya 1.0 Pre-Build 31 Agu 2026)
**Status:** Live di axvara.tech — 50 produk, 97 varian, 30 order
**Platform:** Cloudflare Pages + D1 + R2 + Heroku (WA gateway + WR proxy) + Telegram Bot API  
**Tanggal:** 31 Agustus 2026  
**Author:** Axvara Team + AI Architect  

---

## 1. Overview

### 1.1 Ringkasan Produk
AXVARA adalah website toko digital premium untuk menjual **Aplikasi Premium, AI Gateway, Akun AI Premium (ChatGPT Plus, Claude Pro, Midjourney, dll), Tools Premium, dan Bundle Kucing**.

Inspirasi fungsional dari **marketku.id** (katalog → keranjang → checkout → konfirmasi manual), tapi dengan **level desain 10x lebih premium** setara Apple Store — glassmorphism, animasi halus, dan checkout super simpel.

**Bedanya dengan Marketku.id:**
- Desain: Apple Store minimalis + glassmorphism, bukan template marketplace kaku
- Pembayaran: **QRIS dinamis melalui gateway KlikQRIS** untuk invoice baru; GoPay/DANA tetap didukung untuk invoice lama; transfer manual tetap mode maintenance
- Hosting: **Gratis selamanya** di Cloudflare Pages — unlimited bandwidth, CDN Indonesia super cepat, tanpa ngurus VPS
- Fokus niche: Digital goods (lisensi/key/akun), bukan fisik

### 1.2 Tujuan Produk
- Menjadi toko digital premium yang terlihat **mahal & terpercaya** sehingga konversi lebih tinggi untuk produk digital 50rb–1jt
- Checkout **paling simpel** untuk pembeli awam: pilih produk → pilih Transfer/QRIS → scan QR dinamis atau upload bukti transfer manual → selesai
- Admin bisa kelola pesanan **dari HP**; pembayaran QRIS dilunasi otomatis oleh event merchant sesuai invoice, sedangkan transfer manual tetap ditinjau admin
- Biaya infrastruktur diupayakan Rp 0/bulan di luar domain; biaya gateway mengikuti ketentuan KlikQRIS

### 1.3 Target User

| Persona | Deskripsi | Kebutuhan Utama |
|---------|-----------|-----------------|
| **Pembeli Umum** | Mahasiswa, freelancer, creator, pekerja yang butuh tools AI murah | Cari produk cepat, lihat harga jelas, bayar via QRIS/DANA/Gopay/Shopeepay dalam 30 detik, dapat akun/lisensi via WA |
| **Pembeli Langganan** | Pelanggan bulanan AI Gateway / akun premium | Re-order cepat, riwayat pesanan, perpanjangan 1 klik |
| **Admin / Owner (Kamu)** | Pemilik Axvara | Tambah/edit produk, lihat pesanan per channel, konfirmasi transfer manual, pantau QRIS otomatis, kirim lisensi, lihat laporan omzet |

### 1.4 Glossary

- **QRIS Dinamis:** QRIS DANA Business yang dibuat per order dengan nominal unik dan masa berlaku 15 menit. **Sejak 2026-10-02 (Fase 0, default mati):** ledger + matcher + reissue multi-rail (`dana` | `gopay`); rail order baru mengikuti `QRIS_ACTIVE_PROVIDER` (default `dana` = perilaku lama). Rail GoPay (payload GoPay Merchant + poller mutasi GoBiz di VPS + `POST /api/webhook/gopay`) aktif bila `GOPAY_QRIS_ENABLED=true` + secret terisi — Fase 1
- **QRIS Hook (legacy DANA):** Aplikasi Android yang meneruskan notifikasi DANA. GoPay Merchant memakai poller mutasi GoBiz di server; provider efektif mengikuti konfigurasi server.
- **Transfer Manual:** Pembeli transfer ke e-wallet 082135277434 (DANA/Gopay/Shopeepay) atau SeaBank 901812349386 a.n. pemilik
- **Bukti Transfer:** Foto/screenshot yang di-upload pembeli setelah bayar
- **Pesanan Pending:** Pesanan menunggu verifikasi admin
- **Glassmorphism:** Efek kaca blur transparan ala Apple/macOS
- **Vault:** Metafora brand Axvara — gerbang akses ke semua tools premium
- **Kontak Admin:** WhatsApp dukungan `089519388264`; berbeda dari nomor e-wallet tujuan pembayaran `082135277434`
- **Varian Terpusat:** Setiap produk punya ≥1 varian (harga/stok/durasi/garansi per varian); harga kartu = varian termurah yang masih tersedia
- **Warung Rebahan (WR):** Supplier H2H (`warungrebahan.com/api/v1`); produk WR disync ke katalog (source=`warung_rebahan`), order lunas diteruskan otomatis (exactly-once), sync satu sweep penuh per run (Opsi A). Nama publik Gemini AI Antigravity sengaja tanpa suffix `(WR)`; kepemilikan supplier tetap dibedakan lewat `source`/`wr_product_id`.
- **Sekalipay (SK):** Supplier kedua paralel WR (`sekalipay.com/api`, 2026-09-30); produk SK disync ke katalog (nama publik bersih tanpa suffix supplier sejak 2026-09-30 — dibedakan di admin via badge asal + slug; preseden Antigravity 0045), order lunas diteruskan otomatis (exactly-once, `ref_id` idempoten sisi SK). Fase 1 hanya varian `auto` Aplikasi Premium; produk yang tampil dipilih manual oleh owner. Tanpa failover otomatis WR↔SK.
- **Proxy WR/SK:** VPS AWS `t4g.nano` Singapore (`https://wr-proxy.axvara.tech`, IP `13.228.147.90`, sejak 2026-10-02 — sebelumnya Heroku akun #2 + QuotaGuard) — satu-satunya egress yang di-whitelist WR/SK; Pages hanya pegang URL + token proxy
- **Gateway WA:** App Heroku akun #1 (`axvara-wa-gateway`, Baileys) — bot grup WhatsApp; route `/wr/*` lama sudah dimatikan (410)
- **Bot Telegram:** `@Axvara_bot` — katalog/keranjang/checkout/QRIS/garansi via Bot API webhook; foto welcome WebP ringan di `public/banners/tg-welcome.webp`

---

## 2. Requirements

**Pengiriman Telegram pasca-bayar — 2026-10-17 ✅ implementasi, publikasi melalui CI:** kredensial WR, SK, stok sendiri shared/unique, jalur legacy, serah terima admin berisi detail dan tombol **Ambil Detail Produk** diikuti **Syarat & Ketentuan** → **Cara Penggunaan / Aktivasi** → **Syarat klaim garansi**. Copy mengikuti varian yang benar dengan resolver PDP/panel website yang sama (admin → kurasi → supplier dirapikan, digabung dengan bagian S&K/aktivasi deskripsi produk). Ketentuan/panduan kosong atau katalog gagal dibaca mendapat petunjuk jujur ke deskripsi/admin `/bantuan`, tanpa membuat aturan produk baru. Klaim memakai sumber kebijakan Market: hanya produk bergaransi, invoice/bukti pemesanan + screenshot, proses 1–3 hari dan solusi refund bila gangguan masih terjadi setelah maksimal tiga hari; masa/cakupan tetap mengikuti produk. Pesan panjang dilanjutkan berurutan dengan identitas order, HTML/Unicode aman dan kredensial utuh; pengiriman baru dianggap sukses setelah seluruh bagian berhasil. Ambil ulang juga melengkapi order lama dengan copy katalog terkini; tidak otomatis mengirim ulang transaksi lama. Verifikasi memakai fixture tanpa pesan Telegram/transaksi supplier nyata; belum merupakan bukti produksi live.

**Pembayaran QRIS ringkas — 2026-10-15 ✅ implementasi, publikasi CI:** `/pesanan/[code]` saat QRIS pending memakai header kecil berisi status/kode, QR 224px di mobile (240px desktop), nominal termasuk kode unik dan sisa waktu dekat QR. Judul dan kode pesanan di tengah kartu serta satu pill Menunggu bayar di atas Total bayar pada mobile maupun desktop. Desktop dua kolom QR/informasi bayar, mobile satu kolom; tombol **Simpan QRIS** dan **Cek Pembayaran** berdampingan dengan tap target 44px. Informasi pengecekan otomatis tetap tampil; waktu terakhir dicek tersedia untuk pembaca layar. Ringkasan produk tertutup awal dan dapat dibuka, tautan Lacak Status dihilangkan saat pending, lanjut belanja/bantuan/pembatalan menjadi aksi sekunder ringkas. QR kedaluwarsa tetap tidak dapat dibayar, penerbitan ulang hanya jika diizinkan server; konfirmasi/verifikasi pembatalan, alur lunas dan auto-scroll akun tetap berlaku.

**Auto-scroll detail akun Market — 2026-10-15 ✅ implementasi, publikasi CI:** setelah pesanan lunas dan isi akun berhasil dimuat melalui verifikasi kontak/token, halaman pesanan dan hasil lacak otomatis bergulir sekali ke bagian **Detail Akun Digital**. Menunggu isi akun nyata, termasuk hasil polling pengiriman; form verifikasi, respons kosong/gagal, dan info pengiriman belum memicu scroll akun. Ada jarak dari navbar; reduced motion memakai perpindahan langsung. Polling/rerender dan membuka panduan/accordion tidak mengulang scroll. Melacak kode pesanan lain membuka panel baru dan menunggu detail akun pesanan itu.

**Klaim garansi Market — 2026-10-15 ✅ implementasi, publikasi CI:** semua pesanan Market lunas (WR, SK, stok sendiri, manual; termasuk riwayat lama) menampilkan satu accordion tertutup **Syarat klaim garansi** setelah detail akun/S&K/aktivasi atau informasi pengiriman, pada `/pesanan/[code]` dan hasil lacak. Isi: kirim invoice/bukti pemesanan serta screenshot kendala; proses 1–3 hari tergantung antrean, stok pengganti, atau gangguan pihak terkait; bila setelah maksimal 3 hari gangguan masih terjadi, diberikan solusi refund uang; ditutup ucapan terima kasih. Halaman `/garansi-replace` memakai isi yang sama dan mengganti ketentuan lama proses 1×24 jam/refund hanya stok kosong. Formatter kebijakan Market Telegram/WhatsApp ikut sinkron; masa/cakupan garansi tetap mengikuti produk. Informasi ini tidak menjalankan refund otomatis.

**Revisi 2026-10-16 ✅ implementasi, publikasi CI:** accordion **Syarat klaim garansi** berada di dalam kartu **Detail Akun Digital**, setelah seluruh accordion **Cara Penggunaan / Aktivasi** dan sebelum catatan simpan detail, dengan style yang sama seperti S&K/aktivasi. Revisi ukuran 2026-10-16: teks isi accordion memakai 12px dengan line-height relaxed yang sama seperti isi S&K/aktivasi; isi pada halaman ketentuan publik tetap 14px. Berlaku pada halaman setelah order dan hasil lacak; tetap satu per pesanan walau ada beberapa akun. Form verifikasi juga memuat accordion di dalam kartu; pesanan lunas yang detail akunnya belum tersedia tetap menampilkan informasi garansi setelah blok pengiriman. Isi accordion serta halaman ketentuan bersama diawali teks **pengajuan garansi hanya untuk produk bergaransi**; ketentuan masa/cakupan produk tetap berlaku.

**Footer bersama — 2026-10-15 ✅ implementasi, publikasi melalui CI:** Market dan Pedia menampilkan ikon WhatsApp satu tone dengan sosial lainnya tepat setelah Facebook, tanpa teks, menuju `https://axvara.tech/wa?pesan=Halo%20AXVARA`. Teks chat/jam layanan di footer dihapus. Di bawah ikon sosial terdapat pill kecil **Grup WA** (hijau) dan **Bot Order Telegram** (biru), menggunakan logo brand asli; bot tetap kanal order Market. Navigasi footer hanya **Layanan AXVARA** (Market/Pedia dari daftar layanan terpusat; layanan berikutnya ditambahkan saat tersedia) dan **Bantuan** (cara order, pelacakan, bantuan/ketentuan kedua layanan). Daftar kategori, Semua produk, dan AI & teknologi dihapus dari footer; newsletter tetap tersedia.

### 2.1 Functional — Pembeli (Storefront)

| ID | Requirement | Prioritas |
|----|-------------|-----------|
| FR-S1 | Pengunjung bisa melihat homepage hero premium + search + kategori + produk unggulan tanpa login. **2026-10-01 copy hero (permintaan owner):** penekanan dipindah dari "QRIS otomatis" ke "order cepat tanpa perlu login" — subheadline + trust item pertama | P0 MVP |
| FR-S2 | Katalog produk dengan grid Apple-style, filter kategori (AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat — taksonomi 6 kategori 2026-09-28, migrasi 0046; slug lama ai-gateway/akun-premium/tools-pro dialias di kode agar filter lama tidak 404), search, dan sorting. **2026-10-01 ✅ live (permintaan owner: jangan hilangkan yang habis + jangan nomor halaman):** 16 produk + "Tampilkan N produk lagi" (ganti filter kembali ke 16 awal); produk habis TETAP tampil di akhir sebagai kartu abu-abu tanpa tombol beli (trust + kurangi komplain "kok kemarin ada, sekarang hilang"); PDP produk pecundang WR-vs-SK 308 ke pemenang (noindex) | P0 MVP |
| FR-S3 | Halaman detail produk: galeri gambar, harga (diskon/coret), stok, deskripsi, benefit, tombol Tambah ke Keranjang & Beli Langsung. **2026-10-01 ✅ live (permintaan owner):** Produk Serupa TIDAK PERNAH menampilkan stok habis (Serupa = ajakan beli; kartu habis tetap ada di katalog utama untuk trust); bila kategori sama < 4, dilengkapi dari katalog lain (hanya yang bisa dibeli) | P0 MVP |
| FR-S4 | Keranjang slide-drawer dari kanan (tanpa pindah halaman), ubah qty, hapus item, lihat subtotal | P0 MVP |
| FR-S5 | Checkout 1 halaman ala Sekalipay (revamp 2026-09-23): ① metode pembayaran (QRIS auto-select; E-Wallet/SeaBank maintenance 2026-09-17) → ② data pembeli minimal (No WA + Email SELALU wajib, tanpa Nama; fallback nama = prefix email) → S&K → 1 CTA; ringkasan 1x per viewport (mobile accordion collapsed di atas, desktop rail sticky; rail `hidden lg:block` agar mobile tidak duplikat); 2 tombol submit (rail desktop + sticky mobile) 1 handler | P0 MVP |
| FR-S6 | Jika pilih E-Wallet: tampilkan nomor 082135277434 + nama pemilik + tombol Copy + instruksi | P0 MVP ⏸️ maintenance 2026-09-17 (field tampil disabled + badge Maintenance di WEB; dihilangkan di WA/TELE; upload bukti disembunyikan) |
| FR-S7 | Jika pilih SeaBank: tampilkan 901812349386 + instruksi **2026-10-15 ✅ implementasi:** submit dengan WA/email kosong atau salah menggulir dan memfokuskan field pertama yang tidak valid; label dan error terlihat di antara navbar/CTA mobile, menghormati reduced motion, tanpa membuat order. | P0 MVP ⏸️ maintenance 2026-09-17 (lihat FR-S6) |
| FR-S8 | Jika pilih QRIS: setelah order tampilkan QRIS dinamis, nominal unik, countdown 15 menit, tombol Download, dan polling status | P0 MVP |
| FR-S9 | Bukti transfer JPG/PNG/WebP max 5MB wajib untuk SeaBank/e-wallet; QRIS tidak memerlukan upload bukti | P0 MVP ⏸️ maintenance 2026-09-17 (upload disembunyikan di WEB; `POST /api/proof/upload` 503; `POST /api/orders` tolak non-QRIS 503) |
| FR-S10 | Setelah order sukses: halaman Terima Kasih + nomor pesanan (AXV-XXXX) + WA admin + status Pending | P0 MVP |
| FR-S11 | Pembeli bisa cek status pesanan via nomor WA / kode pesanan (tanpa login) | P1 ✅ live |
| FR-S11a | Halaman `/lacak-pesanan`: form kode pesanan (AXV-YYYYMMDD-XXXXXXXX) + No. WA atau email checkout (email sejak 2026-09-25), verifikasi server via `POST /api/orders/lookup`, timeline Dibuat → Pembayaran → Diproses, badge Pending/Lunas/Dibatalkan/Kedaluwarsa, auto-refresh Pending 10 detik, deep-link `?code=&wa=`, riwayat lokal 5 terakhir, tautan dari navbar/footer/bottom-nav/cara-order/halaman pesanan | P1 ✅ live 2026-09-17 |
| FR-S12 | Notifikasi WA otomatis ke pembeli saat admin konfirmasi lunas (kirim lisensi) | P1 ✅ live (gateway Baileys) |
| FR-S13 | Wishlist & histori pesanan jika pembeli login (opsional, email/WA OTP) | P2 |
| FR-S14 | Bot Telegram @Axvara_bot: /start (foto welcome + sapaan), katalog, cari, keranjang, checkout QRIS, pesanan, garansi. Katalog hanya menampilkan produk yang BISA DIBELI dan detailnya ringkas. Jumlah dapat diubah lewat −/+ atau tombol **Masukkan Jumlah** + ForceReply dengan rentang stok/minimum live. Varian wajib email memakai CTA **Lanjut Isi Email**, menyimpan email, lalu menampilkan ringkasan masked + Ubah Email/Ubah Jumlah sebelum QRIS diterbitkan (2026-09-27) | P0 ✅ live (redesign katalog + input 2026-09-27) · **2026-10-04 ✅ paritas Web:** pesan lunas sesuai kelas kirim (instan → "dikirim otomatis ke chat ini"; Made By Order WR/SK → pesan tunggu maks 12 jam + kredensial dikirim OTOMATIS ke chat yang sama begitu selesai; manual → dikirim admin + minta WA cadangan hanya untuk baris manual); kredensial WR & SK masuk DM chat pribadi pembeli (SK dulu hanya email → pembeli Telegram tidak menerima apa pun); tanpa kata "pemasok"; katalog/cari/bestseller/detail memfilter pecundang pasangan WR/SK; label garansi disembunyikan bila varian tanpa data garansi (bukan "Tanpa Garansi"); fallback kirim: target chat pribadi berurutan (chat tersimpan → id pembeli → chat order) + tombol **📦 Ambil Detail Produk** di pesan lunas/status untuk mengambil ulang detail kapan saja · **2026-10-10 ✅ UX jujur:** detail produk menampilkan kelas pengiriman per varian (🚚 ⚡ Kirim otomatis / ⏳ Made By Order — satu sumber `buyerDeliveryKind` dengan badge PDP web); invoice QRIS punya tombol **🔄 Periksa Pembayaran** (`refresh:*`, ownerBound + idempoten) + copy "Sudah bayar? Tekan Periksa Pembayaran" (ganti "tidak perlu cek manual" yang berbohong saat hook telat) · **2026-10-10 ✅ email di notif admin:** Order Baru + Lunas Telegram tampilkan 📧 email buyer (fallback "— tanpa email") — paritas notif Web · **2026-10-10 ✅ hanya Lunas (keputusan owner, paritas Web 2026-09-25):** "Order Baru — Telegram/WhatsApp" DIMATIKAN — grup Axvara_Notif hanya menerima "Lunas" · **2026-10-10 ✅ hub WA /wa (keputusan owner URGENT, suspend nomor):** semua tombol WA admin (web, /link, footer, lacak, pesanan, keyboard Telegram) mendarat di halaman perantara `/wa` — user pilih AXVARA 1/2/3 (badge Aktif/Suspend jujur) + Telegram; pesan bawaan per konteks diteruskan via `?pesan=` |
| FR-S15 | Bot grup WhatsApp (Baileys): list/katalog, cari, bayar QRIS, perintah admin `.d` (jalur manual + bukti SEABANK/EWALLET maintenance 2026-09-17) | P0 ✅ live |
| FR-S16 | Produk varian terpusat: harga/stok/durasi/garansi per varian; harga kartu dari varian termurah tersedia; label pembeli = label + durasi via `formatVariantLabel()` (audit 2026-09-19: 88/97 varian kehilangan durasi karena sync WR menulis label=nama verbatim — PDP/modal/quote web kini gabung "Meitu VIP - 7 Hari" ala web WR, anti-duplikasi case-insensitive) | P0 ✅ live |
| FR-S18 | PDP menampilkan S&K + cara aktivasi per varian WR (read-only, ikut varian terpilih); label garansi kanonis "Garansi N Unit". **2026-09-24:** deskripsi, S&K, dan cara aktivasi versi Axvara dalam satu format untuk WR & non-WR (deskripsi = pembuka + keunggulan; S&K berkelompok Detail paket/Proses & pengiriman/Aturan pakai/Garansi; aktivasi bernomor), S&K + cara aktivasi terlipat di mobile, kalimat berulang dibuang, semua angka/larangan/batas garansi pemasok tetap terbawa; teks WR yang berubah otomatis tampil (dirapikan) sampai dikurasi ulang | P0 ✅ live (migrasi 0040) |
| FR-S17 | Integrasi Warung Rebahan H2H: sync katalog terjadwal, auto-order exactly-once, webhook status, saldo monitor + throttle notif. **2026-09-28 ✅ live:** link WR tertahan bisa di-void admin (POST /api/admin/warung/orders/[id]/void, CAS, terminal failed + last_error=cancelled_by_admin); auto-revive blocked_balance dibatasi umur 24 jam (WR_BLOCKED_MAX_AGE_HOURS) + hanya order lunas; buyer dikabari sekali saat masuk blocked (idempoten wr-blocked:<kode>). **2026-10-01 ✅ live bulk markup (permintaan owner):** POST /api/admin/warung/markup/bulk — 1 request untuk ≤200 varian (formula harga sama dengan PUT satuan; default hanya % berubah, Rp dipertahankan kecuali reset dicentang; hasil jujur updated + failed; harga katalog ikut berubah) + toolbar bersama BulkMarkupToolbar (checkbox per baris + "Set semua tampil" + preset 20/30/50 + konfirmasi hitungan) | P0 ✅ live (auto-order flag default off) |
| FR-S17b | Integrasi Sekalipay (supplier kedua paralel WR, 2026-09-30): sync katalog terjadwal (delta `updated_since`), auto-order exactly-once (`ref_id` idempoten sisi SK), webhook status (SHA256), saldo monitor + throttle notif, tab admin setara WR + uji sandbox. Fitur khas SK (tanpa padanan WR): mutasi saldo audit (credit/debit + before/after), cek akun validasi nickname, stock-lock 10 mnt anti-overselling, daftar transaksi SK, detail capability per varian. Fase 1 hanya varian `auto` Aplikasi Premium; produk tampil dipilih manual (nama bersih, beda badge admin + slug); tanpa failover otomatis. **2026-10-01 bulk markup cermin WR** via POST /api/admin/sekalipay/markup/bulk (toolbar bersama yang sama). **2026-10-02 paritas email + flag SK:** order SK auto ikut instan (flag `queued/instant` baca `sk_order_process`, bukan `fulfillment_mode` lokal) sehingga halaman lunas spinner "Mengirim produkmu…" bukan Made By Order; webhook `order.completed` langsung kirim email kredensial template "Pesanan Siap" Axvara yang SAMA PERSIS dengan WR/non-WR (logo + tanda terima + blok kredensial + CTA, idempoten per item) + reconcile cron; event `order.paid/item.sent` kirim email "Pesanan Diproses"; saldo habis kabari pembeli (`sk-blocked`); QRIS pending ada spinner jam + "Mengecek otomatis tiap 5 detik • terakhir dicek" + tombol Cek Status Sekarang. **2026-10-03 white-label docs + anti-spam (keputusan owner):** link `sekalipay.com/docs/tutorial-login-netflix` di S&K Netflix di-rewrite ke artikel AXVARA `/artikel/cara-login-netflix-setelah-order-di-axvara` (ditulis ulang + foto white-label) di PDP + email/panel — tahan sync via `rewriteSupplierDocsLinks()`; **sore harinya diperluas ke video login Alight Motion supplier (laporan owner + screenshot PDP: blok "CARA AKTIVASI" varian SK masih menampilkan `youtu.be/8emqddsjPsE` mentah ke channel supplier) — semua bentuk URL ID itu (youtu.be/watch/embed/shorts + query `?si=`, https maupun bare) di-rewrite ke artikel AXVARA `/artikel/cara-login-alight-motion-setelah-order-di-axvara` (published id 24: player + teks dari deskripsi asli) di KETIGA jalur yang sama; video YouTube ID lain (mis. tutorial Office) tetap dipertahankan;** mailbox OTP + bot Viu dipertahankan (bukan toko). Notif saldo SK disamakan ke WR: 6 jam ATAU turun Rp5.000 (state `sk_sync_state`), max 24x/hari → max 4x/hari. **2026-10-03 paritas WR-SK panel (kasus F111FD64):** WR completed tidak muncul di panel karena webhook tidak sampai + completed tidak bind item + settle tanpa ciphertext; kini bind otomatis + ciphertext ke item (pola SK), reconcile fresh >3 mnt di cron + tombol sync-now admin | P0 ✅ live 2026-09-30 (whitelist + webhook + secrets terpasang; saldo 0 — top up sebelum order prod) |
| FR-S17c | Shortlink internal `axvara.tech/go/*` (keputusan owner 2026-10-03, permintaan "kayak Kliqs — versi internal"): pembungkus link supplier + artikel AXVARA panjang agar tampil pendek di PDP/email/panel ("axvara.tech/go/otp" bukan "netflix-codes.sekalipay.com/mailbox"); audit D1 prod live memetakan SEMUA link teks supplier (wr_terms/delivery + sk_seller_note/description, termasuk produk off/restok — 43 slug: mailbox OTP genjos/tmail/waroengmail/runcubes/generator/2fa + bot Telegram supplier + tutorial YouTube supplier + domain resmi app + panduan artikel, kecuali `netflix.com/clearcookies|youraccount` yang dibiarkan mentah); route `GET /go/:slug` redirect 307 + hitung klik, noindex, 404 bila mati; CRUD admin (tab Link Supplier); rewrite `rewriteSupplierDocsLinks()` diperluas tahan-sync ke KETIGA jalur (fallback PDP pre-bayar + email/panel pasca-bayar); kurasi tayang teks `go/*` langsung (linkify internal tanpa tab baru); supplier ganti URL → update 1 baris tanpa edit kurasi; **retroaktif order lama (screenshot AXV-BD58F7ED): ciphertext WR era pra-shortlink dibungkus saat tampil via `normalizeAccountDetailsForDisplay()` — panel/WA/email/Telegram WR ikut pendek tanpa migrasi data (email terkirim tidak berubah)** | P0 ✅ live 2026-10-03 |
| FR-S19 | Minimum pembelian per varian (generik, default 1): GSuite min. 50 akun; label "Min. N" di PDP/modal/keranjang/bot; quote 409 + orders 409 + guard atomik; web/Telegram plafon 100/baris; WA qty-1 ditolak jelas untuk varian min>1 | P0 ✅ live (migrasi 0034) |
| FR-S25 | Opsi pengiriman non-WR + isi terlihat di admin (2026-09-19): dropdown "Cara Pengiriman" per varian (Made By Order / Kirim otomatis pesan bersama / Kirim otomatis stok unik, sinkron 1:1 `fulfillment_mode`) + panel konten fulfillment shared/unique di jalur resmi ProductVariantRows (akar hilang: satu-satunya panel isi kredensial hanya hidup di VariantEditor mati); keputusan owner: admin MELIHAT isi plaintext (shared "Isi saat ini" + Ganti, unique daftar + Hapus/baris, auto-load; reveal server-side di GET admin, tak ke pembeli); counts pantau dua sumber (kolom ciphertext + inventory); display buyer fulfillment-aware (non-WR manual = MBO + kalimat admin tanpa angka supplier) | P0 ✅ live 2026-09-19 |
| FR-S20 | Halaman pesanan lunas jujur soal pengiriman: order lunas yang pengirimannya GAGAL (`fulfillment_status='failed'`) tampil merah "Pengiriman Produk Bermasalah" + langkah hubungi admin, bukan "Pembayaran Dikonfirmasi 🎉" (2026-09-24, PR audit ronde 4); panel "Detail Akun Digital" (verifikasi WA + capability token) hanya muncul saat `credentials_ready` dari server; order lunas tanpa kredensial otomatis (fulfillment manual) menampilkan blok "Pengiriman Produk" berisi tujuan WA/email checkout tersamar + estimasi 5–15 menit, dan halaman mem-poll terbatas (20 dtk × maks 30) agar panel muncul sendiri tanpa reload. Sejak 2026-09-25 estimasi 5–15 menit hanya untuk produk WR (lihat FR-S32). **2026-10-13 paritas instan supplier:** order supplier (WR/SK) yang linknya masih berjalan menampilkan skeleton "Menyiapkan detail produkmu…" (TANPA kalimat stok/admin/diproses) dan dipoll rapat 2 dtk; setiap poll memicu tarikan status vendor di server (gerbang throttle 20 dtk/order di `store_settings`), sehingga detail muncul hitungan detik setelah vendor `COMPLETED` seperti SK — tanpa menunggu cron 5 menit/route besar 1 jam dan tanpa klik "Cek status" admin. Panel kredensial kini diikuti blok "Syarat & Ketentuan" + "Cara Aktivasi" (resolver PDP yang sama) di bawah tiap kredensial | P0 ✅ live 2026-09-18 + paritas instan 2026-10-13 |
| FR-S32 | Halaman pesanan setelah bayar produk kirim otomatis dari stok sendiri (varian non-WR `shared`/`unique`, mis. Canva Invite 1 Bulan): fase menyiapkan ±30 dtk pertama = skeleton tanpa teks pengiriman (bentuk mirip panel akhir, + baris mikro "Menyiapkan detail produkmu…") supaya tidak ada bacaan yang hilang saat panel kredensial muncul — tanpa sebut admin/12 jam; halaman memeriksa rapat 2 dtk ×5 lalu 5 dtk ×4 sehingga detail akun muncul beberapa detik setelah terkirim tanpa reload; lewat ±30 dtk teks jujur "Masih mengirim otomatis — butuh waktu lebih lama" (tetap tanpa admin/12 jam, order ber-email ditambah kalimat email + halaman ini); Made By Order (C1, manual by design) judul "Pesanan Made By Order" tanpa alasan stok; kirim otomatis yang diserahkan ke admin / `manual_required` (C2) judul "Pengiriman oleh Admin" + alasan "Stok otomatis habis, jadi admin menyiapkan manual" + "Umumnya kurang dari 1 jam, maksimal 12 jam" (tanpa jam layanan spesifik); order terkirim tanpa detail di halaman: order ber-email → copy "Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil di halaman ini." + cek spam, order lama tanpa email → "Produk sudah dikirim ke WhatsApp …" (tanpa cek spam); kontak checkout bertahan selama tab terbuka sehingga muat ulang tetap membuka detail otomatis. **Pagar 2026-10-13:** kalimat C1/C2 (stok habis, Made By Order, disiapkan admin) HANYA untuk order non-supplier — order supplier (WR/SK) tidak pernah menampilkannya; selama link supplier berjalan tampilannya skeleton menyiapkan + poll rapat yang memicu tarikan status vendor, persis perlakuan instan stok sendiri (lihat FR-S20) | P1 ✅ 2026-09-25 (PR, live setelah merge + deploy) + revisi copy A/B/C1/C2 2026-10-02 + skeleton fase menyiapkan sore 2026-10-02 + copy email 2026-10-07 + pagar supplier 2026-10-13 (permintaan owner, live setelah merge + deploy) |
| FR-S21 | Cron operations tahan dipotong platform: penanda fase dimajukan di awal run (anti poison-pill), deadline wall-clock 45 dtk sebelum tiap unit kerja jaringan, timeout API WR 12 dtk, lease pengiriman kredensial dapat dipulihkan, dan zero-missing stok hanya pada sweep penuh dari awal daftar | P0 ✅ live 2026-09-18 (perbaikan insiden sync WR mati 17–18 Sep) |
| FR-S22 | Produk kelas ANTREAN (dibuatkan setelah order; label pembeli "Made By Order" sejak 2026-09-19) diteruskan otomatis ke supplier begitu lunas — tidak lagi menunggu admin sadar; saklar mundur `WARUNG_REBAHAN_AUTO_ORDER_MBO=false`. Ekspektasi waktu jujur per kelas dan disebut SEBELUM bayar (PDP + checkout; kalimat ETA modal dihapus 2026-09-19): instan = 5–15 menit, antrean = "{produk} dibuat setelah pembayaran terkonfirmasi. Umumnya terkirim cepat, maksimal 12 jam pada jam layanan" (template checkout sejak 2026-09-19 atas keputusan owner; badge "Made By Order" polos tanpa angka; paragraf "Detail akun dikirim ke WhatsApp…Tidak perlu menunggu" dihapus 2026-09-19; checkbox checkout tanpa "DYOR, DWYOR." sejak 2026-09-19). Nol jejak nama supplier di seluruh copy pembeli; status third-party independen tetap ada di halaman ketentuan. Masa garansi kelas antrean mulai saat detail akun diserahkan. **2026-10-09 ✅ live penjamin yatim (kasus AXV-20261009-DA1ACF56):** order lunas yang link WR/SK-nya gagal dibuat webhook disembuhkan cron tanpa menunggu antrean (probe `reconcileMissing*` tanpa gate due di lite + route besar; kunci respons `orphan_links_healed`). **2026-10-11 live sumber kebenaran delivery_mode API WR (migrasi 0060):** kelas instan/antrean diturunkan dari `delivery_mode` per varian (auto->restock, manual/mixed->made_by_order), mengalahkan seed/tebakan/kunci admin; audit 62/92 varian salah kelas diperbaiki (mis. Vidio Mobile kini jujur Made By Order). **2026-10-13 penyederhanaan paten ala SK (migrasi 0061):** mesin tebakan + tombol kunci kelas admin + badge sumber dihapus — panel hanya badge AUTO/MANUAL murni dari API WR. Email: web selalu wajib; Telegram/WA + API orders memakai `needsEmailForVariant()` (tipe Invite/Link WR atau produk `require_email`); `email_invite` hanya untuk Invite/Link. Retry pra-kirim habis bisa dibuka ulang admin (kuota baru, tanpa dobel-bayar); panel Pesanan menampilkan status supplier + Retry/Batal/Cek status per baris; penyapu kredensial yatim berpagar anti-kirim-ulang (item sudah delivered tidak disentuh) | P0 ✅ live 2026-09-18 (estimasi supplier 6–12 jam, <1 jam bila lancar) |
| FR-S23 | Pengawasan antrean: pembeli web dikabari WA otomatis saat detail akun siap, admin dapat notifikasi Telegram bila satu order melewati 13 jam (idempoten, migrasi 0037), panel admin menampilkan umur tiap baris antrean, ambang alert saldo default naik 50.000 → 250.000 (modal termahal 200.000) | P0 ✅ live 2026-09-18 |
| FR-S26 | Kabar pembeli kanal WEB lewat email (Resend), bukan outbox WA yang mati: tanda terima pembayaran, pengiriman gagal (termasuk kegagalan supplier Warung Rebahan), serah terima manual, bukti ditolak, dan bukti menunggu Hook; idempoten per kabar (`buyer_notice_log`, migrasi 0039); order web lama tanpa email tetap lewat outbox WA; Telegram tetap DM pribadi terverifikasi | P0 ✅ 2026-09-24 (PR audit ronde 4, live setelah merge + deploy) |
| FR-S29 | Produk non-WR untuk pembeli WEB: varian Kirim otomatis (shared/unique) dikirim lewat SATU email "Pesanan Siap" berisi isi produk + tanda terima pembayaran (tanda terima terpisah hanya untuk Made By Order/pesanan campuran/kirim tertunda); varian Made By Order diserahkan admin lewat tombol **Kirim ke pembeli** yang membawa isi (email bermerek untuk web, DM untuk Telegram, tidak pernah lewat outbox WA) dengan template per varian; isi terkirim tersimpan terenkripsi dan bisa dibuka lagi di `/pesanan/[code]` setelah verifikasi WA/token; admin di-ping Telegram saat order web lunas perlu diserahkan; semua email pembeli memakai shell bermerek; PDP tidak menjanjikan Kirim otomatis untuk varian campuran sebelum dipilih. **2026-10-02 ✅ stok jujur unique (insiden Head 18 Bulan: kolom stock=2 tapi kredensial tersisa 1, PDP bilang "Sisa 2"):** varian unique memakai stok EFEKTIF = min(kolom stock, unit `available` inventory) di PDP ("Sisa"), quote (tolak `out_of_stock` bila unit habis walau kolom > 0), dan purchasable; kolom stock unique diselaraskan otomatis ke available saat impor/revoke inventory; panel admin menampilkan banner selisih bila keduanya tidak sama; cache PDP by-slug 10 detik (bukan 30) agar angka segar setelah ada yang beli. **Revisi sore 2026-10-02 ✅ stok total jujur + mobile paritas (laporan owner + screenshot: Head HABIS tapi "Stok: 21" — agregat kartu ikut menjumlah stok phantom 1+20; mobile bottom-sheet masih "Sisa 1" padahal checkout Habis):** (a) `purchasableStockSql` ikut menolak unique tanpa unit di SQL — `variant_stock` kartu, `available_min_price`, bot Telegram (katalog/cari/bestseller), `llms.txt` seragam; (b) `variant_stock` kartu dihitung dari stok EFEKTIF per varian (unique = min kolom vs available) — Head habis → total 0+20=20; (c) QuickVariantModal (jalur mobile) + direct-checkout + add-to-cart semua memakai stok efektif — tidak ada lagi jalur baca kolom mentah **2026-10-15 ✅ implementasi:** panel setelah bayar menggabungkan S&K varian dan bagian S&K/aktivasi dalam deskripsi produk, sama dengan PDP; tampil terpisah sebagai accordion Syarat & Ketentuan serta Cara Penggunaan / Aktivasi, kredensial tidak dicampur dengan panduan. | P0 ✅ 2026-09-25 (PR, live setelah merge + deploy + migrasi 0043) |
| FR-S30 | Admin menerima notif Telegram `Lunas — Web` di `Axvara_Notif` untuk setiap order web yang lunas (sekali per order), berisi status kirim: terkirim otomatis ke email, perlu **Kirim ke pembeli**, atau diproses Warung Rebahan; tombol Buka Pesanan + WA pembeli; tetap sampai walau tombol ditolak Telegram (kirim ulang tanpa tombol) dan diulang cron bila Telegram sedang gagal (maks 6 jam); order web tidak lagi dinotif saat dibuat (keputusan owner) | P0 ✅ 2026-09-25 (PR, live setelah merge + deploy) |
| FR-S33 | Daily Promo Digest ke grup admin `Axvara_Notif` pukul 09.00 dan 17.00 WIB: tiap slot mengirim versi lengkap + ringkas siap salin, berisi 3–4 produk yang benar-benar ready, harga mulai nyata, rotasi menghindari produk slot lain/histori dua hari bila stok katalog memungkinkan, CTA **Order melalui Bot Telegram** + **Order melalui Website**, dan retry parsial idempoten per bubble | P1 ✅ live 2026-09-27 (migrasi 0044; kill switch `TELEGRAM_PROMO_DIGEST_ENABLED`) | **2026-09-29 revamp (permintaan owner):** pagi = 12 teratas katalog, sore = 12 berikutnya tanpa tumpang tindih (hierarki `sort_order` admin); format kelompok per kategori + harga tegas varian termurah (tanpa "Mulai", tanpa footer disclaimer); hook "Sedia semua kebutuhan aplikasi dan tools premium favorit anda, murah, mudah, cepat, dan bergaransi" | **2026-10-01 revamp (permintaan owner, contoh ceklis WR/SEKUDIL):** SEMUA produk ready masuk pesan (bukan 12+12 paruh; format Axvara dipertahankan — judul + hook + kelompok kategori + CTA — hanya baris produk + ✅); kandidat = produk ready non-pecundang (`telegram_enabled=1`, pecundang supplier-pair dikecualikan); link bot deep-link `?start=beli` (tap → chat pribadi langsung siap order) | **2026-10-03 revamp (permintaan owner + contoh manual: pesan ringkas lama "jelek"):** bubble kedua BUKAN lagi versi ringkas — melainkan versi WA siap copy-paste: ISI SAMA PERSIS dengan pesan utama (judul + garis `---` + intro dua baris + kelompok kategori + CTA), hanya bold pakai `*` literal ala WA (tanpa parse_mode HTML agar `&`/`<` di nama produk tidak bikin Telegram tolak pesan); CTA = website dulu baru bot; pesan utama ikut contoh manual (garis pemisah, intro dua baris, CTA website-dulu). Fix ikon: Desain & Video = 🎨 (dulu 🤖 — "desain" mengandung substring "ai", kini cek kategori spesifik dulu + AI pakai batas kata)
| FR-S31 | Mobile storefront: bottom nav **Beranda · Kategori · Pesanan · Bantuan** (2026-10-03: Keranjang dihapus — drawer tetap dari navbar sticky; Kategori = sheet filter katalog. Cara Order/Artikel pindah ke panel Bantuan + footer; Pesanan menampilkan pesanan perangkat ini dengan status server + titik belum dibayar); PDP mobile memilih varian lewat panel (ketuk = pilih untuk halaman, bukan checkout), harga/S&K/cara aktivasi/tombol beli ikut varian, "Ganti varian" di judul S&K bila isinya berbeda, panel ringkas >6 varian + cari >10 | P1 ✅ 2026-09-25 (PR, live setelah merge + deploy) |
| FR-S27 | Pengingat melayang "pesanan belum dibayar" di seluruh storefront (kecuali checkout/pesanan/admin): hitung mundur QRIS (atau tenggat pesanan bila QR hangus dan masih boleh diperpanjang), satu ketukan kembali ke `/pesanan/[code]` tanpa checkout ulang; status & tenggat selalu dari server, bisa ditutup per pesanan per sesi | P0 ✅ 2026-09-24 (PR, live setelah merge + deploy) |
| FR-S28 | Storefront tidak "bisu" di jaringan lambat: setiap klik yang memicu navigasi langsung memberi bar + skeleton halaman tujuan (8 dtk pesan koneksi lambat, 20 dtk Coba lagi); CTA Checkout/Beli Sekarang berputar sampai checkout tampil; Bayar berlabel bertahap lalu layar "Pesanan dibuat · Membuka halaman pembayaran"; putus jaringan saat bayar dijelaskan aman diulang (idempoten, tidak dobel); halaman pesanan langsung menampilkan QR dari respons create dengan placeholder + muat ulang; PDP dirender server lengkap; permintaan storefront dibatasi waktu | P0 ✅ 2026-09-24 (PR loading storefront, live setelah merge + deploy) |
| FR-S24 | Kredensial 3 jalur (keputusan owner): isi detail akun dikirim LANGSUNG via WA (outbox durable, kunci `wr-delivery:<code>`, potong 1500 char/bagian; target dinormalisasi ke JID `@s.whatsapp.net` di adapter sejak 18 Sep sore — Baileys baru melempar untuk nomor mentah) + via email Resend template "Detail Akun Siap" (idempoten `wr-cred-email:<code>`, migrasi 0038 untuk kind/channel; pembeli tanpa email dilewati diam; walau WR tidak mengirim email, Axvara membuat email sendiri dari detail completed) + tampil di panel web (`/pesanan/[code]` dan hasil `/lacak-pesanan` via `WrCredentialsPanel` prefill WA terverifikasi lookup). Display dinormalisasi di USE-time (`normalizeAccountDetailsForDisplay`: envelope JSON `{product,details}` dikupas, `\r\n` dinormalisasi, label Indonesia, label ganda dibuang — tidak pernah JSON mentah). DM kredensial TANPA footer `/garansi` (keputusan owner 19 Sep — perintah itu untuk grup, bukan DM buyer; command `/garansi` di grup tetap hidup).
 Kill-switch 19 Sep 2026: auto-DM kredensial WA ke buyer **MATI via flag `WHATSAPP_CREDENTIAL_DM_ENABLED=false`** (default) pasca-restriction nomor BOT (memulai chat baru = yang dibatasi WA) — kode + mekanisme DM UTUH di bawah gate, nyalakan lagi = 1 env + deploy. Selama mati: kredensial via email + panel web + kirim manual HP; order channel whatsapp legacy di-route ke `manual_required`. Outbox dipacing manusiawi (`WHATSAPP_OUTBOX_PACE_MS` 6 dtk + jitter ≤3 dtk, cooldown 60 dtk/destinasi, auto-pause lunak setelah 3 sinyal bahaya berurutan → `whatsapp_outbox_paused` di hasil cron). Delivery settled bila token terbit; dua-duanya gagal = retry, satu gagal = catat parsial | P0 ✅ live 2026-09-18 |

### 2.2 Functional — Admin

| ID | Requirement |
|----|-------------|
| FR-A1 | Admin login terpisah di `/admin` (email + password, rate-limited) |
| FR-A2 | Dashboard admin: pesanan lunas, omzet, modal, untung, margin dan rata-rata/order; periode Hari/Minggu/Bulan WIB mengendalikan SELURUH kartu, grafik, kontribusi omzet, untung supplier/channel dan Top 5. **2026-10-15 ✅ implementasi (publikasi CI):** omzet dikurangi modal per item (WR/SK/stok sendiri/Pedia), keranjang campuran tidak menghilangkan modal stok sendiri. Modal transaksi baru disnapshot atomik saat lunas (0063), riwayat tanpa snapshot tetap ditandai estimasi pada data/ekspor, tanpa kartu peringatan di Ringkasan. Hari ini memakai grafik per jam, minggu/bulan harian; mendukung rugi, sumbu jumlah order terpisah, donat kontribusi omzet dan batang untung. Top 5 memakai seluruh transaksi dalam periode, tanpa batas 500 order. **2026-10-15 pembaruan:** pilih bulan historis atau rentang inklusif WIB hingga 366 hari dari toolbar tanpa card/tombol Terapkan; perubahan bulan atau pasangan tanggal lengkap dan valid otomatis memuat laporan. Tolak tanggal invalid/masa depan; metadata tanggal/WIB/waktu pembuatan sejajar sesi admin, tanpa teks total/pending/pill stok menipis. Loading/gagal menyembunyikan metadata/angka lama. Tombol PDF dan Excel .xlsx sejajar di samping selector bulan/tanggal, membungkus pada layar sempit dan diunduh langsung dari respons yang sama (Ringkasan/Harian/Supplier/Channel/Top Produk); kredit Pedia dibedakan dari pembayaran merchant, omzet mencakup keduanya dan pembulatan invoice, untung belum dikurangi MDR/operasional. |
| FR-A3 | CRUD Produk: tambah/edit/hapus, upload foto (ke R2), set harga, diskon, kategori, stok, deskripsi, status aktif/nonaktif. **2026-09-24 ✅ live:** S&K + cara aktivasi per varian bisa disunting admin (WR & non-WR, migrasi 0041); suntingan varian WR dijeda otomatis bila WR mengubah teksnya (pembeli melihat teks WR terbaru, admin mendapat badge "S&K perlu ditinjau"). **2026-09-28:** produk single/non-varian (toggle varian OFF) paritas dengan multi-varian — Min. Beli + Masa Garansi + Cara Pengiriman + Template pesan tampil di tab Varian dan disimpan sebagai 1 varian `Default` eksplisit (update in-place, bukan insert baru). **2026-09-28 ✅ live:** atur posisi produk dari admin — kolom Urutan + tombol ↑↓ per baris (swap tetangga global, bukan tetangga satu halaman) + field angka Urutan tampil 0–999999 di modal edit; tidak ada endpoint baru (pakai PUT /api/products/[id] yang sudah terima sortOrder). **2026-09-29 fix display + exact-step + anti-429/lompat (laporan owner beruntun):** kolom Urutan = nomor posisi 1..N (raw key hanya di tooltip); reorder atomik POST /api/products/reorder (tepat 1 posisi, realtime, modal read-only); scope `products:reorder` 120/mnt + tulis hanya baris berubah (bukan kuota cron); badge bisa diketik untuk lompat 30→1 dalam 1 request. **2026-09-29 Terjual editable (permintaan owner):** angka Terjual bisa diubah admin dari kolom tabel (ketik + Enter, PATCH sold-count) maupun field Terjual di modal edit (ikut PUT); SET absolut sebagai baseline baru — order lunas tetap `sold_count += qty` di atasnya (perilaku increment tidak berubah). **2026-10-01 tab status toko ✅ live (permintaan owner: "tidak tahu kenapa produk tidak tampil"):** daftar Produk punya tab Live/Hidden/Nonaktif/Semua (default Live = yang tampil di toko SAAT INI; Hidden = toggle ON tapi tak tampil + sebab jujur "Kalah dari X" / "stok habis" / "nonaktif tapi stok tersedia"; Nonaktif = toggle OFF) + badge count + kartu "Hidden otomatis" + pagination 20/50/100 (persist, default 20); ↑↓ yang melewati batas halaman pindah halaman mengikuti produk. **2026-10-02 selip restok ✅ live (laporan owner: posisi 6/8 habis → restok terdampar 20+):** sync yang mendeteksi transisi stok parent 0→ready menyelipkan `sort_order` kembali ke sekitar posisi semula (±1–2 bila slot terisi; tanpa write bila slot kosong); reorder manual tetap otoritas tertinggi. **2026-10-01 tab panel WR/SK ✅ live (permintaan owner: "scroll jauh + acak"):** tab dalam-halaman Ringkas/Antrean/Markup/Aturan (WR) + Audit/Alat (SK: mutasi + transaksi / cek akun + lock + detail; sandbox di Antrean) — lazy-load per tab + cache, antrean pagination 20 + total, markup sub-tab Live/Hidden/Off + badge + pagination 20/50/100  **2026-10-15 ✅ implementasi:** tab Varian berupa accordion dengan ringkasan nama/harga/status/stok; harga-modal dan stok-minimum tersusun 2–3 kolom desktop/1 kolom mobile. Stok unique mengikuti inventory. Produk stok sendiri memiliki S&K bersama dan cara penggunaan/aktivasi per varian, disimpan atomik bersama Simpan Produk (termasuk varian baru); link/akun/key tetap terpisah di inventory. Teks supplier tetap memakai endpoint tinjauan khusus. |
| FR-A4 | Kategori management: AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat (taksonomi 6 kategori 2026-09-28, migrasi 0046; rename Bundle Kucing → Bundle Hemat dengan slug bundle-hemat dipertahankan; slug lama dialias di kode; DELETE ditolak 409 selama masih dipakai produk) |
| FR-A5 | Manajemen Pesanan: list semua pesanan (filter Pending/Lunas/Dibatalkan), detail pesanan + foto bukti transfer, tombol Konfirmasi Lunas / Batalkan. **2026-10-01 ACC manual QRIS ✅ live (laporan owner: hook DANA gagal padahal dana benar masuk):** order QRIS pending punya tombol **ACC pembayaran** (hijau) + **Tolak** (merah) di baris pesanan — ACC memakai `transitionPendingPaymentToPaid` yang SAMA dengan webhook (ledger ikut lunas + fulfillment + email kredensial + notif buyer seperti hook normal), catatan verifikasi mutasi wajib min. 10 karakter + tercatat `[ACC-QRIS manual email]` di admin_note, guard ketat (hanya QRIS pending, kalah race vs hook = 409 jujur) |
| FR-A6 | Saat konfirmasi: admin bisa input catatan/lisensi/key yang akan dikirim ke pembeli |
| FR-A7 | Tampilkan status konfigurasi QRIS dinamis DANA; payload merchant dan webhook secret hanya dikelola sebagai secret server |
| FR-A8 | Kelola metode pembayaran: edit nomor e-wallet, SeaBank, dan bank lain menyusul (tanpa deploy ulang) |
| FR-A9 | Laporan sederhana: export CSV pesanan, filter tanggal |
| FR-A10 | Pengaturan toko: nama, logo, WA admin, footer |
| FR-A11 | Daftar email dari form footer tersimpan dan hanya dapat dilihat admin |

### 2.3 Functional — Sistem
| ID | Requirement |
|----|-------------|
| FR-SYS1 | Upload gambar produk & bukti transfer ke Cloudflare R2 (10GB gratis) |
| FR-SYS2 | Simpan data produk, pesanan, kategori di Cloudflare D1 (SQLite, 5GB gratis) |
| FR-SYS3 | Generate kode pesanan unik format `AXV-YYYYMMDD-XXXX` |
| FR-SYS4 | Validasi file bukti: hanya JPG/PNG/WebP, max 5MB |
| FR-SYS5 | Kirim dan balas notifikasi WA via gateway Baileys Heroku akun #1 (`axvara-wa-gateway`); allowlist grup + flag discovery/payment/proof/fulfillment | P0 ✅ live |
| FR-SYS6 | SEO & GEO: meta title/description + canonical per halaman (produk, artikel, statis), sitemap, OG image 1200×630, JSON-LD Organization/WebSite/ItemList (beranda) + Product (gambar absolut, AXVARA sebagai penjual) + Article; katalog beranda dirender server; `/llms.txt`; robots menutup halaman transaksi + izinkan crawler AI; `/checkout` & `/pesanan/*` noindex | ✅ dasar live; perluasan SEO & GEO PR 2026-09-24 (live setelah merge + deploy) |
| FR-SYS7 | Sync WR satu sweep penuh per run (Opsi A, budget khusus katalog; cursor sebagai fallback); produk baru WR otomatis masuk katalog | ✅ live |
| FR-SYS8 | Env Pages WAJIB `secret_text` (plain_text tidak terbawa deploy); deploy hanya via CI | Aturan operasional |
| FR-SYS9 | Minimum pembelian ditegakkan server: quote 409 `below_minimum`, orders 409, guard atomik batch; UI/bot hanya cermin | P0 ✅ live (migrasi 0034) |
| FR-S19 | Email wajib SEBELUM bayar bila keranjang berisi varian WR Invite/Link (otomatis dari `wr_type`) atau produk `require_email=1` (toggle admin; fix 2026-09-25: centang kini termuat ulang di editor dan ikut tersimpan saat membuat produk baru): form web validasi + label dinamis, API 422 guard DB, Telegram minta + simpan + teruskan ke WR, WA tolak + arahkan kanal ber-form. **2026-10-07 (temuan admin WR):** `email_invite` hanya dikirim untuk Invite/Link (`wrTypeUsesEmailInvite`); Private/Sharing di-omit total agar tidak muncul TARGET ACCOUNT INVITATION palsu di dashboard WR — UX tetap 1-field tanpa copy baru | P0 ✅ live |
| FR-SYS10 | Bot email WR→buyer white-label: email WR (label Gmail WR-INGEST) diteruskan otomatis sebagai email branding Axvara (template Diproses/Invite Terkirim, nol jejak WR) via Resend; fallback WA bila buyer tanpa email; idempoten gmail_message_id; cari manual invoice WR di tab Warung Rebahan | P0 ✅ live 2026-09-17 |
| FR-SYS11 | Kartu antrean Ringkasan wajib membawa filternya ke section tujuan (bukan sekadar pindah tab), setiap filter aktif tampil sebagai chip yang bisa dilepas, dan satu nama metrik memakai satu satuan di semua layar | P1 ✅ live 2026-09-19 |
| FR-SYS12 | Editor produk bertab dengan aksi simpan yang selalu terjangkau; menu sidebar hanya untuk layar kerja harian (layar konfigurasi sekali-pakai jadi tab Pengaturan, `?section=` lama tetap sah); kartu metrik mengikuti filter aktif | P1 ✅ live 2026-09-20 |
| FR-SYS13 | Setiap timestamp yang ditampilkan ke pembeli/admin memakai jam WIB yang benar: nilai D1 (UTC berformat spasi) di-parse sebagai UTC lalu dirender `timeZone: "Asia/Jakarta"` lewat satu helper kanonis, sehingga jam yang terlihat sama di perangkat mana pun dan tidak mundur 7 jam | P0 ✅ live 2026-09-20 |
| FR-SYS14 | Varian yang stoknya di bawah minimum (stock < min_qty, stock ≠ -1) diperlakukan tak tersedia di PDP/modal/keranjang/checkout-direct — qty berapa pun pasti gagal di quote, jadi tolak sejak awal, bukan dead-end di checkout; editor admin memuat SEMUA varian termasuk nonaktif agar bisa diaktifkan ulang | P1 ✅ live 2026-09-20 |

### 2.4 Non-Functional

| ID | Kategori | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | Lighthouse Performance > 95, LCP < 2.0s di mobile 4G, bundle JS < 200KB |
| NFR-2 | Design | Apple Store level: glassmorphism, blur, animasi spring 60fps, tidak ada layout shift |
| NFR-3 | Responsive | Mobile-first, sempurna di 320px–1440px, keranjang drawer di mobile full-height |
| NFR-4 | Keamanan | Admin behind auth, upload file type check, no SQL injection (D1 prepared statement), rate limit checkout |
| NFR-5 | Availability | 99.9% via Cloudflare CDN, Pages unlimited bandwidth, R2 99.99% durability |
| NFR-6 | Biaya | Rp 0/bulan infra (Pages + D1 + R2 free tier), hanya domain |
| NFR-7 | Aksesibilitas | Warna kontras WCAG AA, keyboard navigable, alt text |
| NFR-8 | Bahasa | UI Bahasa Indonesia (formal santai), harga Rupiah |
| NFR-9 | Kuota D1 | ✅ Implementasi 2026-10-16, publikasi melalui CI: katalog publik memakai cache server eksplisit (Market 30 dtk/produk tunggal 10 dtk, Pedia dan kategori 60 dtk). Pedia hanya membaca layanan rujukan aktif. Quote/order/status tetap memeriksa data aktual. Ringkasan admin dimuat saat section Ringkasan dibuka; laporan standar memakai satu agregasi bersama, cache privat proses maksimal 60 dtk dan waktu pembuatan aktual. Cleanup data kedaluwarsa per jam; expiry pembayaran, fulfillment dan recovery order tetap setiap tick. Target terbaru 2026-10-17 ≤3 juta rows_read/hari perlu diukur satu siklus reset setelah rilis, bukan jaminan kapasitas. |
| NFR-10 | Maintenance kuota | ✅ Implementasi 2026-10-17, publikasi melalui CI: saat D1 mengembalikan error kuota baca/tulis harian, halaman Market/Pedia menampilkan maintenance sementara dengan estimasi 07.00–08.00 WIB dan tanggal reset berikutnya, tombol order manual serta coba buka toko. Hub WhatsApp menyediakan pilihan nomor aktif dan support Telegram tanpa database; jam layanan admin tetap ditampilkan. Pesanan yang sudah dibayar diarahkan ke admin dengan kode dan bukti. Toko kembali tersedia setelah pemeriksaan D1 berhasil; estimasi bukan janji penyelesaian. API/webhook/cron tidak diganti halaman HTML. |


Revisi kuota lanjutan 2026-10-17 ✅ implementasi/verifikasi lokal, publikasi CI:
seluruh Ringkasan memakai snapshot privat maksimal 60 detik setelah pemeriksaan
sesi/parameter, dengan umur keuangan asal tetap dibatasi. Katalog, kategori,
pencarian dan bestseller Telegram berbagi snapshot publik 30 detik; detail/
checkout memvalidasi harga/stok aktual. Antrean pasangan berubah diproses
bertahap lewat diff dan cron cleanup existing; kegagalan/perubahan bersamaan
menyisakan pekerjaan untuk retry, sweep penuh tetap cadangan. Monitor analytics
akun tiap jam memuat baca/tulis, proyeksi dan anggaran tersisa; risiko melampaui
5 juta reads/100 ribu writes, ≥90% penggunaan atau data tak tersedia menghasilkan
warning/job gagal GitHub Actions. Jadwal/analytics dapat terlambat, notifikasi
mengikuti pengaturan GitHub owner. Target terbaru ≤3 juta reads/hari perlu
satu siklus reset produksi 07.00–07.00; hasil fixture bukan jaminan bebas limit.

Revisi operasional 2026-10-17 ✅ implementasi, publikasi CI: rilis kode tanpa perubahan database dapat memakai bukti migrasi dari rilis main sukses dengan berkas DB identik; berkas berubah/bukti tidak lengkap tetap memerlukan Wrangler remote sukses sebelum deploy. Pengingat saldo ProviderSMM/IndoSMM wajib berhasil membaca dan mereservasi penanda sebelum kirim; gangguan D1 menunda alert saldo, tanpa spam tiap tick. Throttle enam jam/penurunan Rp5.000 dan notifikasi pembeli tetap.

---

## 3. User Flow

### 3.1 Flow Pembeli — Happy Path (Tanpa Login)

```
1. Buka axvara.tech → Hero "Gerbang Semua Tools Premium" + Search
2. Scroll katalog / klik kategori AI Gateway
3. Klik produk "ChatGPT Plus 1 Bulan" → halaman detail
4. Klik "Tambah ke Keranjang" → drawer muncul dari kanan, item + subtotal
5. Klik "Checkout" di drawer
6. Isi Nama, No WA, Email (opsional)
7. Pilih Metode Pembayaran:
   - [] DANA / Gopay / Shopeepay — 082135277434
   - [ ] SeaBank — 901812349386
   - [x] QRIS — QR dinamis dibuat setelah order
8. Total dasar Rp 89.000 → Klik "Buat Pesanan"
9. → Halaman pesanan menampilkan QRIS + total unik (mis. Rp89.137) + countdown 15 menit
10. Pembeli scan dan membayar tepat sesuai total
11. Poller GoBiz (GoPay) atau QRIS Hook (legacy DANA) mengirim event sesuai provider invoice; AXVARA mencocokkan nominal aktif dan menandai order lunas atomik
12. Halaman, Telegram, atau WhatsApp menerima status terbaru; fulfillment dijalankan idempotent
```

### 3.2 Flow Pembeli — Batal / Error

- Jika upload bukti transfer manual gagal (file >5MB / bukan gambar) → error inline, tetap di halaman checkout
- QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Web/Telegram 60 menit dengan 1x perpanjangan QR). QR mati = order kedaluwarsa = stok kembali otomatis via cron ±5 menit. Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`, verifikasi kode + WA/email checkout, stok kembali detik itu juga) tanpa menunggu expiry atau admin.
- Jika pembeli tutup tab sebelum upload → pesanan tetap tercipta status Pending tanpa bukti, admin bisa follow-up WA
- Jika admin tolak (bukti palsu) → status Dibatalkan + WA "Bukti tidak valid, silakan hubungi admin"

### 3.3 Flow Admin

```
1. Buka axvara.tech/admin → login
2. Dashboard: lihat 3 pesanan Pending baru
3. Klik pesanan AXV-20260831-0012 → lihat detail: produk, pembeli, total, bukti foto (dari R2)
4. Buka aplikasi DANA/SeaBank, cek mutasi Rp 89.000 masuk
5. Klik "Konfirmasi Lunas" → modal input Lisensi/Key/Catatan → Kirim
6. → Status jadi Lunas, pembeli otomatis dapat WA, stok berkurang jika ada
7. Admin bisa tambah produk baru: /admin/products/new → upload foto → simpan → langsung tampil di storefront
```

### 3.4 State Pesanan

```
Pending (baru, tunggu verifikasi) 
  → Lunas (admin konfirmasi, bukti valid)
  → Dibatalkan (admin batalkan / bukti tidak valid)
  → Kadaluarsa (WA QRIS 15 menit; Telegram/Web maksimal 1 QR pengganti dan selesai pada deadline QR terakhir; transfer manual 24 jam; stok dikembalikan)
```

---

## 4. Katalog Awal (Seed Data)

Kategori:
- **AI Gateway** — akses gateway GPT-4o, Claude, Gemini hemat token
- **Akun Premium** — ChatGPT Plus, Claude Pro, Midjourney, Perplexity Pro, CapCut Pro
- **Tools Pro** — Canva Pro, Adobe CC, Notion Plus, Grammarly
- **Bundle Kucing** — paket 3-in-1 AI, paket creator

MVP seed: 8–12 produk dummy dengan foto placeholder premium + harga realistis (Rp 25.000 – Rp 350.000)

> Status 2026-09-15: katalog live 50 produk / 97 varian (manual + sync WR 48 produk);
> seed dummy sudah digantikan data produksi.

---

## 5. Payment Spec — Manual Transfer & QRIS Dinamis DANA

### 5.1 Metode Aktif (V1)
- **E-Wallet:** DANA / Gopay / Shopeepay → **082135277434** (1 nomor untuk semua)
- **Bank:** SeaBank → **901812349386**
- **Bank lain menyusul:** field dinamis di admin, bisa tambah BCA/Mandiri/BRI tanpa deploy
- **QRIS:** payload merchant DANA Business tersimpan sebagai Pages Secret dan diubah menjadi QRIS dinamis per order. **Rail GoPay (2026-10-02 Fase 0, default mati):** payload `GOPAY_STATIC_QRIS` + poller server + webhook `/api/webhook/gopay` ber-secret `GOPAY_POLLER_SECRET`; alih rail via `QRIS_ACTIVE_PROVIDER=gopay`. **✅ 2026-10-16:** merchant GoPay aktif diganti menjadi **axvara.tech** (`G284624569`, NMID `ID1026616934059`); invoice lama tetap diverifikasi ke merchant asal yang tersimpan di payload invoice, invoice baru memakai merchant axvara.tech — poller memeriksa kedua akun GoBiz secara terpisah.

### 5.2 Aturan
- QRIS diverifikasi dari event merchant ber-secret sesuai provider invoice; SeaBank/e-wallet tetap maintenance
- Upload bukti hanya wajib untuk metode transfer manual
- Satu pesanan bisa pakai 1 metode saja
- Harga, stok, dan rekening dikunci dalam quote server bertanda tangan selama 60 menit; retry quote yang sama tidak membuat order ganda
- Stok direservasi ketika order Pending dibuat dan dikembalikan jika Dibatalkan/Kadaluarsa
- QRIS dirender per order, bisa di-download, dan tidak tersedia setelah invoice kedaluwarsa
- Kode unik 1–299 membuat nominal aktif tidak ambigu; unique partial index D1 mencegah dua invoice DANA aktif dengan total sama
- Instruksi pembayaran memisahkan QRIS otomatis dari transfer manual agar bukti tidak diwajibkan pada QRIS

### 5.3 Keamanan Payment
- Nomor rekening diambil dari `/api/payment-methods`; payload merchant QRIS tidak pernah dikirim ke API umum atau source control
- Webhook hanya menerima JSON berukuran terbatas dengan `X-Webhook-Secret`, dideduplikasi, dan mencocokkan nominal persis pada invoice aktif
- File bukti disimpan di R2 dengan nama random (bukan original name), hanya admin yang bisa akses

---

## 6. Scope

### MVP (P0) — 1 Minggu
- Homepage Apple Store premium, katalog, detail produk, keranjang drawer, checkout, upload bukti, halaman sukses
- Admin login, dashboard, CRUD produk/kategori, kelola pesanan Pending/Lunas, dan pantau konfigurasi QRIS dinamis
- Deploy ke Cloudflare Pages dengan domain publik tunggal axvara.tech (`axvara.pages.dev` redirect permanen ke domain utama)

> Status 2026-09-15: MVP + P1 selesai dan live (bot Telegram + bot WA + varian + WR).
> Sisa P2: rating/testimoni, kupon, affiliate, Midtrans opsional.

### P1 — Minggu 2
- Cek status pesanan via kode, notifikasi WA otomatis (Baileys), OTP login pembeli, export CSV

### P2 — Next
- Rating/testimoni, kupon diskon, stok lisensi auto-kirim, payment gateway opsional (Midtrans) untuk auto-confirm, affiliate

### Out of Scope MVP
- Login wajib untuk beli, keranjang cross-device, payment gateway, mutasi auto, multi-admin role

---

## 7. Acceptance Criteria (Given/When/Then)

**AC-1 — Checkout QRIS Dinamis**
- Given pembeli di checkout dengan 1 produk di keranjang
- When pilih QRIS dan klik Buat Pesanan
- Then pesanan Pending menampilkan QR dengan nominal unik 15 menit; webhook pembayaran yang cocok mengubahnya menjadi Lunas tanpa bukti manual

**AC-2 — Checkout E-Wallet**
- Given pembeli pilih DANA
- When checkout
- Then tampil nomor 082135277434 + tombol Copy yang copy ke clipboard + toast "Disalin"

**AC-3 — Admin Konfirmasi**
- Given ada pesanan Pending dengan bukti
- When admin klik Konfirmasi Lunas dan isi lisensi
- Then status jadi Lunas dan pembeli dapat WA (atau link WA fallback)

**AC-4 — Keranjang Drawer**
- Given user tambah 2 produk
- When klik ikon keranjang
- Then drawer glassmorphism muncul dari kanan dengan animasi spring, tanpa reload, tampil subtotal benar

**AC-5 — Desain Apple**
- Given buka homepage di iPhone 14
- When scroll
- Then hero parallax halus, navbar glass blur tetap sticky, kartu produk hover glow cyan, no jank 60fps

**AC-6 — Upload Validasi**
- Given pembeli upload file PDF 10MB sebagai bukti
- When submit
- Then ditolak dengan pesan "Hanya JPG/PNG/WebP max 5MB"

---

## 8. Metrik Keberhasilan MVP

- Checkout → Pending conversion > 70%
- Pending → Lunas (admin) < 15 menit rata-rata
- Lighthouse Performance & Accessibility > 90
- Bounce rate homepage < 45%

---

## 9. Lini Produk Tambahan

- **AXVARA PEDIA** — toko SMM kurasi di `pedia.axvara.tech`. **Sinkronisasi working-tree 2026-10-12: implementasi lokal, BELUM deployed; tidak ada flag yang diubah.** Katalog awal 2026-10-08 adalah riwayat rollout berbeda, bukan bukti versi ini live. Dua provider internal (`providersmm` dan `indosmm`), tanpa failover otomatis; IndoSMM services/add dipagari balance IDR dan `INDOSMM_RATE_PER_1000_VERIFIED=true` di VPS. Kredensial/readiness supplier, satuan katalog serta data kurasi awal produksi masih pending. Beranda compact menampilkan hingga 8 unggulan editorial (fallback 6 produk, bukan laris), cari/filter dan Tampilkan semua menjangkau seluruh produk terbit; pintasan Cari lewat link opsional mengenali format saja. Hero "Satu tempat untuk / Layanan sosial media" + typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner). Market/Pedia saling mempromosikan, memakai menu Layanan AXVARA dan footer bersama; Bot Telegram tetap kanal Market. Checkout tiga kelompok memakai radio native, tier/jumlah awal kosong dan satu CTA per viewport **Lanjut ke pembayaran**: quote diperiksa di belakang layar, harga berubah atau kredit meminta **Setujui & lanjut ke pembayaran** sebelum order. Hanya paket terkonfigurasi; perubahan input membatalkan quote, retry ambigu mempertahankan token/kontak terkunci. Order tutup dijelaskan dekat CTA tanpa meminta kontak/kredit/S&K, bukan banner berulang. Quote baru terenkripsi; legacy bertanda tangan yang belum kedaluwarsa tetap diterima. Provider/service/refill/min-profit disimpan pada order, tidak mengikuti remapping tier; submit ambigu masuk needs_check tanpa kirim ulang/cross-provider. Admin mendukung buat produk/tingkat nonaktif, mapping pasangan provider+service, terbit/unggulan/kesiapan terpisah, preview tersimpan, saldo/health/sync per provider dan recovery berpagar. Reprice tidak atomik; tagline tidak dirender di kartu/detail sejak 2026-10-12 (hapus AI slop) dan `description_md` publik opsional tampil detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa link-helper teknis tambahan. Detail: `docs/PEDIA-PRD.md`, `docs/PEDIA-DESIGN.md`, `issue/planning.md`.

**Followup lokal Pedia 2026-10-12:** quote mengikat `refill_days/min_profit_rp`; snapshot order mempertahankan ketentuan quote (legacy tanpa field fallback tier). Refill requested/submitted/needs_check diblokir berapa pun usianya. Guard margin menyimpan disable sebelum harga baru untuk melindungi replay. ID admin desimal positif kanonik; checklist ID unik setelah trim dan bantuan opsional bertipe string. Diff VPS membatasi layanan `chunkMax` 1..100 (default 50) dan removals 100 independen per batch, maju hanya potongan ber-ack 2xx; >100 removals dilanjutkan, bukan batas pending. Preview storefront tersimpan terpenuhi: `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman; draf tetap privat, tingkat nonaktif dengan paket layak ikut kurasi, navigasi/pemesanan disabled dan interaksi preview tanpa panggilan API. CTA mobile inline, bukan fixed. Input belum disimpan tidak ikut; unsaved live preview di luar scope. Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Bukti supplier live currency/rate-unit serta kurasi awal produksi/approval owner tetap pending.
- **AXVARA AI** (AI Gateway new-api di VPS Tencent) — menyusul setelah Pedia, belum ada PRD.

## Appendix — Referensi

- Inspirasi fungsional: https://marketku.id/
- Inspirasi desain: Apple Store (apple.com/store), Linear.app, Vercel.com
- Hosting: Cloudflare Pages + D1 + R2 — gratis selamanya, unlimited bandwidth
- Kontak pembayaran: E-Wallet 082135277434, SeaBank 901812349386, QRIS dinamis DANA Business

### Pembaruan panel admin 2026-10-15 (implementasi, publikasi via CI)

- Banner: sakelar Aktif/Nonaktif bergaya Produk di samping Edit langsung di daftar; posisi global unik 0–999 untuk banner aktif maupun nonaktif. Benturan mendapat posisi kosong berikutnya; posisi server ditampilkan. Popup homepage memilih banner pertama yang belum disembunyikan/belum mencapai batas sesi, satu popup per kunjungan dokumen, tanpa antrean popup setelah ditutup.
- Pedia admin: Produk/Layanan Supplier/Pesanan/Kredit, harga tingkat dan riwayat saldo memakai tabel kaca, header/sel/aksi seragam dengan Produk Market. Filter kompak, Edit putih dan sakelar publikasi sejajar; kesiapan tetap terpisah dari publikasi.
- Rekonsiliasi QRIS menampilkan provider efektif invoice baru dan provider milik setiap event (riwayat DANA dipertahankan). Konfigurasi lengkap dibedakan dari kesehatan poller/sesi; ACC mengharuskan pemeriksaan merchant sesuai invoice.
- Transisi Market/Pedia menampilkan logo putih. Filter X hanya ikon dengan nama aksesibel X; nama layanan seperti Followers X tetap utuh.
