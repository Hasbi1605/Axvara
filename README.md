# AXVARA — Gerbang Semua Tools Premium

## Tautan komunitas — 23 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Footer dan halaman link memakai
[grup WhatsApp baru](https://chat.whatsapp.com/DHgtU7q39TlCV6ToZ4JU39?mode=gi_t),
bersumber dari `WA_GROUP_HREF` di `src/lib/site.ts`.


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

Harga bayar memakai `total_amount` gateway; nominal/kode unik tidak dihitung ulang lokal. Keputusan owner: batas AXVARA **tetap 15 menit**, meskipun gateway masih dapat menerima QR hingga 60 menit. Pembayaran setelah batas/cancel/expiry dicatat untuk pemeriksaan manual (Rekonsiliasi + satu alert admin), tanpa melunasi/mengirim produk otomatis. Status/nominal/order/signature dikonfirmasi server sebelum paid atomik. QR diproxy same-origin untuk kode AXV/AXP (migrasi 0069 `provider_qris_url`), tanpa membocorkan API key/signature.

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

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

> **Satu Gerbang, Semua Tools Premium** — Toko digital premium Apple Store + Glassmorphism

AXVARA adalah toko digital untuk akun, aplikasi, dan tools premium dengan kategori yang dikelola dari panel admin — checkout memakai **QRIS dinamis merchant GoPay/DANA sesuai provider aktif** tanpa payment gateway pihak ketiga, dan hosting Cloudflare Pages. Jalur manual (E-Wallet/Bank + upload bukti) ⏸️ **maintenance sejak 2026-09-17**: field tampil disabled + badge Maintenance di WEB, dihilangkan di WA/TELE, upload disembunyikan, backend menolak non-QRIS 503.

**Live dev:** `http://localhost:3000` — Next 15.5.24

**Produksi:** `https://axvara.tech` — zone dan HTTPS aktif. `www.axvara.tech` serta hostname bawaan `axvara.pages.dev` mengarah permanen ke apex.

---

## 📂 Struktur

```
axvara/
├── AGENTS.md               # Aturan khusus project (scope axvara, tidak sentuh ~/AGENTS.md)
├── CHANGELOG.md            # Riwayat perubahan — WAJIB update tiap ubahan (terbaru di atas)
├── docs/
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
│   ├── components/pedia/       # PediaOrbit (kembar OrbitHero: 8 sosmed + inti mark Pedia), PediaServiceCards, Typewriter, PlatformCatalog, ServicePicker, usePediaPrices; PlatformGrid/LinkPasteHero kompatibel
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

- Market/Pedia memakai `ServicesMenu` Layanan AXVARA (Market/Pedia saja), `CrossServicePromo` dua arah dengan UTM dan satu `Footer` ekosistem, newsletter, navigasi Layanan AXVARA (Market/Pedia) serta tautan bantuan/ketentuan/pelacakan kedua host absolut. Footer revisi 2026-10-15 menghapus kategori dan teks chat/jam layanan, menambahkan ikon WhatsApp satu tone dengan sosial lainnya setelah Facebook ke `https://axvara.tech/wa?pesan=Halo%20AXVARA`, lalu pill kecil Grup WA hijau dan Bot Order Telegram biru berlogo brand asli di bawah ikon. CommunityBar Market = promo Pedia + Bot Telegram Market; Pedia memakai `PediaServiceCards` = promo Market + Bot Telegram Market (kembar compact, 2026-10-12). Layout Pedia `max-w-[1280px]` + hero tanpa card 1:1 Market (h1 `font-display` 42/56px "Satu tempat untuk / Layanan sosial media" putih + typewriter cyan Termurah / Termudah / Terpercaya atas permintaan owner, glow section-level, tanpa eyebrow). Grup WA tetap footer dan `/link`, URL komunitas terpusat di `lib/site.ts`. Tidak ada janji garansi/aktivasi universal atau platform AI palsu.
- Hero Pedia "Satu tempat untuk / Layanan sosial media" + typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner) + CTA Lihat Layanan + Hubungi Admin (hub /wa) + trust strip "Order cepat tanpa login • Garansi reffil • Support WA admin" 1:1 Market, reduced-motion statis dan pause saat tab tersembunyi. Gap hero→kartu→katalog 1:1 Market (hero `pb-4`, kartu di luar section, katalog `pt-2`). Awal beranda maks 8 featured editorial; tanpa featured fallback 6 produk Jelajahi layanan tanpa sub-teks (2026-10-12). Tampilkan semua, cari/filter dan `/layanan` menjangkau seluruh produk AXVARA terbit, bukan katalog mentah supplier. Kartu Cari lewat link DIHAPUS dari beranda (2026-10-12 owner); `LinkPasteHero` tetap sebagai komponen. Kartu compact memasangkan harga/jumlah/tier/refill yang sama, grid 1/2/3 kolom; tagline tampil di kartu/detail. `description_md` field publik opsional tampil di detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa tambahan link-helper teknis. Ticker tidak dirender.
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
- Endpoint publik eksplisit (`products?active=1`, `categories`, `banners?active=1`) mengirim cache CDN singkat; varian produk admin/private selalu `no-store`. **Pengecualian PDP by-slug (2026-10-02):** `catalog?slug=` + `products?active=1&slug=` memakai cache 10 detik (daftar katalog tetap 30 detik) agar angka stok segar tepat setelah ada yang beli.
- PDP memakai `products?active=1&slug=` (1 baris) + `catalog?slug=` untuk varian + related `products?active=1&cat=` (kategori sama, hanya yang bisa dibeli — stok habis TIDAK PERNAH tampil di Produk Serupa, kontrak 2026-10-01; filler katalog lain hanya bila kategori sama < 4, hemat rows-read D1) — tidak fetch seluruh katalog per halaman. Checkout `?buy=` memakai filter slug exact yang sama.
- Proteksi trafik: WAF 1 rule global TERPASANG (`/api/*` 100 req/10 dtk/IP → Block 429, ruleset "AXVARA API rate limit") + rate-limit in-memory per scope di `src/lib/rateLimit.ts` (lapis kedua per isolate, 429 + `Retry-After: 60`); cron operations memakai binding D1 berbudget 40 statement per invocation, termasuk helper dan anggota batch; pemulihan serta pengiriman dibagi menjadi unit yang dapat dilanjutkan. Sejak 18 Sep 2026 cron juga punya deadline wall-clock 45 detik dan memajukan penanda fase di awal run, supaya run yang dipotong platform (~125 detik) tidak mengunci rotasi fase dan mematikan sync otomatis WR. Guard anti-starvation fase WR tidak lagi mensyaratkan antrean order kosong (order due bukan alasan membiarkan katalog basi), fase WR didahulukan saat sync basi >45 menit, dan skip sweep karena budget/deadline dilaporkan jujur di `cron_deferred` + `wr_sync_skipped`. Sejak 19 Sep 2026 SEMUA alasan skip sync dilaporkan (`disabled`/`phase_inactive`/`interval`/`sync_disabled`/`deadline`/`query_budget`) + `wr_last_sync_at` di respons, dan tiap hit menulis heartbeat `store_settings.cron_last_hit_at` (heartbeat segar + sync basi = run kepotong deploy; keduanya basi = pemicu mati).
- CSP development mengizinkan `unsafe-eval` hanya untuk React Refresh/webpack lokal. CSP production tetap tidak mengizinkannya.

---

## 💳 Pembayaran

| Metode | Tujuan | Ket |
|--------|------------|-----|
| E-Wallet | `082135277434` | DANA/Gopay/Shopeepay |
| SeaBank | `901812349386` | Brotherstore06 |
| QRIS | DANA Business (default) / GoPay Merchant (Fase 1, flag) | Dinamis per order, nominal unik, QR 15 menit; WA tanpa pembaruan, Telegram/Web maksimal 1 pembaruan |
| Bank lain | dinamis via admin | tambah/aktifkan tanpa deploy |

Flow: server memvalidasi harga/stok dan menerbitkan quote bertanda tangan 60 menit → order dibuat idempotent dan stok direservasi atomik. Untuk QRIS, server membuat payload EMVCo dan nominal unik per order, menampilkan QR selama 15 menit, lalu QRIS Hook Android mengirim pembayaran ke `/api/webhook/dana`; nominal yang cocok tepat mengubah ledger+order menjadi lunas secara atomik. Transfer SeaBank/e-wallet tetap memakai bukti JPG/PNG/WebP dan review admin. Order yang kedaluwarsa mengembalikan stok atomik.

Halaman pembayaran QRIS ringkas (2026-10-15, implementasi; publikasi CI): header/status/kode dipadatkan, QR 224px mobile/240px desktop tetap utuh dengan bingkai putih. Judul/kode pesanan di tengah kartu dan satu pill Menunggu bayar di atas Total bayar pada mobile maupun desktop. Desktop QR dan info bayar berdampingan, mobile satu kolom; nominal/kode unik/countdown dekat QR, **Simpan QRIS** dan **Cek Pembayaran** sejajar (44px). Ringkasan produk terlipat awal; lanjut belanja/pembatalan selebar sama di bawah, berjarak 16px dari garis pemisah bantuan. **Butuh bantuan?** tampil di atas WA Admin/Telegram; tanpa tautan Lacak Status saat pending. Pengecekan otomatis/manual, download gambar yang sama, kedaluwarsa/reissue, verifikasi pembatalan dan detail akun lunas tetap memakai kontrak existing.

Checkout mobile (2026-10-15): klik Bayar ketika WA/email belum valid mengarahkan scroll dan fokus ke field pertama yang salah. Label/error tidak tersembunyi di balik navbar atau tombol tetap; mode reduced motion dihormati. Order baru dibuat setelah seluruh validasi lolos.

QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Web/Telegram 60 menit dengan 1x perpanjangan QR). QR mati = order kedaluwarsa = stok kembali otomatis via cron ±5 menit. Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`, verifikasi kode + WA/email checkout, stok kembali detik itu juga) tanpa menunggu expiry atau admin.

Telegram: pilih varian langsung ke jumlah, tanpa layar konfirmasi pembelian tambahan. Tombol **🔄 QRIS Baru** hanya ada pada pesan QRIS pertama kedaluwarsa, bukan pada invoice aktif. Migrasi `0026_qris_channel_policy.sql` menyesuaikan deadline order lama yang masih pending dan menyimpan marker notifikasi per invoice. Cron operations mengirim pesan kedaluwarsa Telegram dengan retry marker, serta mengantrekan pemberitahuan WA idempoten ke `whatsapp_outbox`. Batas pembayaran berlaku pada deadline; pengiriman pemberitahuan mengikuti cron 5 menit dan dapat tertunda oleh antrean atau kegagalan gateway. Halaman `/pesanan/[code]` menghormati batas waktu dan izin pembaruan dari API, termasuk untuk kode order WA.

Migrasi `0025_qris_invoice_history.sql` menyimpan setiap nominal dan waktu penerbitan di `payment_invoice_history` melalui trigger dalam transaksi ledger yang sama. Allocator, webhook, retry admin, dan guard pelunasan membaca riwayat tersebut. Jika versi lama sudah menghapus riwayat lewat reissue, rentang nominal yang terdampak dicatat di `dana_qris_legacy_ranges` dan memerlukan verifikasi mutasi manual; migrasi tidak menghidupkan kembali order terminal.

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
kirim `/chatid`, lalu simpan ID numerik negatif yang dibalas bot sebagai secret tersebut
(link undangan `t.me/+...` tidak dapat dipakai sebagai Bot API `chat_id`).

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

**Link supplier tampil pendek via shortlink internal `axvara.tech/go/*` (2026-10-03, migrasi 0056).** 44 link supplier (mailbox OTP, bot Telegram, tutorial YouTube, domain resmi app, panduan artikel — termasuk `go/disney-login` 2026-10-19) dibungkus jadi `go/otp`, `go/netflix-login`, dst. — tampil pendek di PDP/email/panel, redirect 307 + hitung klik, noindex. Kelola di tab admin **Link Supplier** (tambah/ubah/tujuan/aktif-nonaktif); supplier ganti URL → update 1 baris, tanpa edit kurasi. Detail: `docs/ARCHITECTURE.md` (tabel `supplier_links` + route `/go/:slug`) dan `docs/PRD.md` FR-S17c.

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
Produk yang tampil dipilih manual: Netflix WR vs Netflix SK = dua baris
katalog berbeda (nama publik BERSIH tanpa suffix supplier sejak 2026-09-30,
dibedakan di admin via badge asal + slug `-wr`/`-sk`), admin mengaktifkan salah satu
atau keduanya untuk perbandingan harga/stok. Fase 1 hanya varian
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

Hanya `npm run build` sebelum deploy/major config (`next.config.mjs`, `tailwind.config.ts`). Lihat `AGENTS.md` → Verifikasi WAJIB. Jika CSS 404: `lsof -ti:3000 | xargs kill -9; rm -rf .next;` lalu start dev lagi.

## 📝 Changelog & Aturan Project

- **Changelog:** `axvara/CHANGELOG.md` — setiap perubahan wajib catat entri paling atas (format: `YYYY-MM-DD — ringkas — file/area — (verifikasi: ...)`).
- **Remediasi review R1–R12:** `docs/REVIEW-REMEDIATION-2026-09-08.md` — CATATAN HISTORIS per 8 Sep 2026 pagi (menyebut 418 test/logout stateless/semua selesai — SUDAH TIDAK BERLAKU; lihat koreksi di bawah).
- **Eksekusi review round 3:** `docs/REVIEW-ROUND3-EXECUTION-2026-09-08.md` — CATATAN HISTORIS (klaim "semua selesai"/"per-item"/"qty" dikoreksi round 4; konteks dipertahankan).
- **Eksekusi review round 4 (historis):** `docs/REVIEW-ROUND4-EXECUTION-2026-09-08.md` — klaim budget, yield, audit dan recovery dikoreksi round 5.
- **Eksekusi review round 5 (terkini):** [laporan RR5-01–08](docs/REVIEW-ROUND5-EXECUTION-2026-09-09.md) — handover D1 memakai pencarian literal + fakta audit pemenang; manifest/qty dan UI mengikuti status bisnis; budget request-scoped 40 termasuk helper/batch; materialisasi bertahap; yield tidak menambah kegagalan; finalisasi atomik + pemulihan split lama; flag WA konsisten. Tidak ada migrasi baru; membutuhkan skema sampai 0022. Bukti lokal: 527 test (44 file), termasuk 26 test RR5 baru; batas bukti dan before/after dijelaskan di laporan.
- **Aturan project:** `axvara/AGENTS.md` — khusus project axvara (scope lokal, tidak ubah `~/AGENTS.md` global). Wajib baca sebelum ubah kode.

## ☁️ CI/CD Cloudflare

```bash
# Provisioning awal saja
npx wrangler d1 create axvara-db        # copy database_id ke wrangler.toml
npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote
npx wrangler r2 bucket create axvara-assets

# Deploy normal
git push origin main
```

`.github/workflows/ci.yml` adalah satu-satunya jalur deploy otomatis. Setiap push `main` menjalankan test, type-check, build adapter Pages, memeriksa/menerapkan migrasi D1 (bukti rilis identik atau Wrangler remote), deploy Pages, lalu deploy MCP Worker. Cloudflare Pages Git build dinonaktifkan agar tidak terjadi deploy ganda. Setelah push berhasil, agent berhenti dan tidak memantau workflow.

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

Rail GoPay: payload merchant disimpan sebagai secret `GOPAY_STATIC_QRIS`. Sejak
2026-10-16 merchant aktif adalah **axvara.tech** (`G284624569`, NMID
`ID1026616934059`). Poller GoBiz memeriksa invoice berdasarkan merchant yang
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

## 🔐 Admin Demo

- URL: `/admin`
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
- Banner dikonversi ke WebP dengan rasio asli dan sisi terpanjang maksimal 1920 px; popup mengikuti rasio portrait/persegi/landscape, memakai `object-contain`, dan hanya muncul di homepage agar tidak menghalangi checkout/admin/status pesanan. Checkbox kecil "Jangan tampilkan lagi" di bawah banner menyembunyikannya 24 jam (localStorage per banner id).
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

Banner dapat diaktifkan/dimatikan dari sakelar di sebelah Edit, sama seperti Produk (track hijau dan knob putih, `AdminStatusSwitch`). Urutan 0–999 unik, benturan memakai posisi kosong berikutnya; migrasi 0064 menormalkan urutan lama tanpa mengubah ID/konten, lalu menambahkan unique index. Popup tetap satu per kunjungan dokumen, memilih banner berikutnya yang layak bila banner sebelumnya sudah disembunyikan atau mencapai cap sesi.

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
