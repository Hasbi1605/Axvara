# PEDIA-DESIGN.md — Panduan Desain & Style AXVARA PEDIA

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG 48px di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal mobile dan 5 desktop, drop/refill tetap. Di mobile, pilihan yang sudah dipilih dirangkum dan dapat diganti. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

> **Status working-tree 2026-10-12:** implementasi lokal, **BELUM deployed** di Pages/proxy, tidak ada flag diubah. Audit source/diff bukan klaim QA diff terkini lulus. Readiness supplier, currency/rate-unit dan kurasi data awal produksi masih pending. Pasangan `docs/PEDIA-PRD.md` + `issue/planning.md`.
> **Induk:** `docs/DESIGN.md` (design system AXVARA). Dokumen ini HANYA mencatat
> tambahan & pengecualian untuk Pedia. Semua yang tidak disebut di sini mengikuti
> `DESIGN.md` (token warna, glass, font Inter + Space Grotesk via `next/font`,
> motion Apple, skeleton, loading jaringan lambat, aksesibilitas).
> Spesifikasi saat ini: §3.3, §5–6, §10–13. Wireframe awal §6.1–6.5 dan katalog komponen/motion awal §7–8 ditandai historis; tidak mengalahkan implementasi §6.0. Aset/konsep arsip boleh tetap menyimpan slogan lama.

---

## 1. Prinsip desain Pedia

1. **Satu keluarga, beda kamar.** Pembeli harus langsung merasa "ini Axvara" (midnight, kaca, Prism, cyan), tapi tahu ini ruangan lain (aksen violet, wordmark PEDIA).
2. **Kurasi dahulu, katalog tetap lengkap.** Pilihan AXVARA → semua/cari/platform → paket/jumlah kosong → tujuan/persyaratan → kontak/konfirmasi. Satu CTA memeriksa quote otomatis; nominal berubah/kredit meminta persetujuan sebelum order.
3. **Bahasa manusia, bukan bahasa panel.** Tidak ada HQ/LQ/R30/drip-feed/ID supplier; refill dijelaskan bersyarat, bukan diganti klaim garansi menyeluruh.
4. **Kejujuran terlihat.** Catatan kualitas, refill bersyarat dan kedua ETA memakai data tingkat; kosong dijelaskan, bukan diisi janji generik. Kredit bukan refund tunai, deteksi format bukan verifikasi akun.
5. **Ringan di HP murah.** Kartu compact dengan gradien permukaan tipis tanpa backdrop blur; glow hero statis dan typewriter reduced-motion/tab-hidden aware. Target performa tetap perlu diukur, bukan diasumsikan lulus.

---

## 2. Identitas

### 2.1 Konsep logo terpilih — A "Growth Bars" (dipilih owner 2026-10-07)

- **Referensi konsep (BUKAN aset final):** `docs/pedia/logo-concept-a.svg`; perbandingan 3 konsep di `docs/pedia/logo-concepts-preview.png` (A dipilih, B Trend Arrow & C Prism Rise ditolak).
- **Kerangka:** segitiga Prism luar logo induk (`/brand/axvara-mark-prism.svg`, path `M60 4 L6.5 104 L113.5 104 Z`, viewBox 120×110, stroke 3.6, round join/cap) — proporsi WAJIB identik dengan induk agar terasa satu keluarga.
- **Isi:** spine + segitiga dalam induk DIHAPUS, diganti **3 batang vertikal naik kiri→kanan** (rasio tinggi ±1 : 2,2 : 3,4), rata bawah, ujung membulat, jarak antar-batang sama, seluruhnya di dalam segitiga dengan ruang napas dari garis luar.
- **Warna:** gradien signature Pedia cyan `#00E5FF` → violet `#8B5CF6` (arah kiri-atas → kanan-bawah, `gradientUnits="userSpaceOnUse"` — gradien objectBoundingBox GAGAL di garis vertikal, sudah terbukti di konsep).
- **Makna:** "bikin naik" — langsung terbaca orang awam; pola isi-segitiga bisa diturunkan ke AXVARA AI nanti (segitiga sama, isi node/spark).

### 2.2 Proses Logo Awal (Historis 2026-10-07/08)

Agent eksekusi WAJIB membuat logo final sendiri dari konsep 2.1 menggunakan **Muse image generator / Muse image compose**:

1. Pakai Muse untuk eksplorasi & penyempurnaan konsep A (ketebalan batang, proporsi, keseimbangan optik, kilau gradien) — beri Muse konsep 2.1 + `docs/pedia/logo-concept-a.svg` + logo induk sebagai acuan. Hasilkan ≥ 3 variasi, pilih yang paling dekat dengan aturan di 2.1, dokumentasikan pilihan di CHANGELOG.
2. Jangan mengubah konsep (tetap segitiga Prism + 3 batang naik + gradien cyan→violet). Tidak boleh menambah elemen lain (bintang, teks di dalam mark, efek 3D berat).
3. Aset final yang di-commit ke repo HARUS vektor bersih buatan ulang (bukan raster hasil generator yang ditempel): rekonstruksi hasil Muse terpilih menjadi SVG geometris (path rapi, tanpa embed bitmap, < 3 KB).
4. Paket aset di `public/brand/` (direvisi 2026-10-08 oleh owner — SVG trace geometris dari logo Muse):
   | File | Isi |
   |---|---|
   | `pedia-mark.svg` | Mark vektor (trace 5 path dari `pedia-mark-white.png`, IoU 91% — segitiga + 3 batang, kanvas padat 144×128 TANPA padding transparan; `currentColor` → putih via `text-white`, < 1 KB) — default navbar + favicon/icon |
   | `pedia-circle.svg` | Badge lingkaran navy + mark putih (1000×1000, untuk /link — seragam WA/TG circle) |
   | `pedia-mark-muse.png` | Arsip: mark gradien cyan→violet (crop dari `.opencode/muse-images/muse-image-1791400094014.png`) |
   | `pedia-mark-white.png` | Arsip: mark putih (mask dari muse — digantikan `pedia-mark.svg`) |
   | `pedia-mark-favicon.png` | Favicon 64px: putih di atas navy |
   | `pedia-icon-512.png`, `pedia-icon-192.png`, `pedia-apple-touch-180.png` | Ikon app/PWA, latar `#080C1E`, mark putih terpusat |
   | `public/og/pedia.png` | OG 1200×630 (komposisi via Muse image compose): midnight + glow cyan→violet + lockup + headline "Tempel link, sisanya beres." |
5. Verifikasi Obscura: render mark di 16/24/32/64/160 px di latar gelap & terang + lockup di navbar 360 px & 1440 px; screenshot diperiksa sebelum commit.

### 2.3 Ringkasan identitas

| Elemen | Spesifikasi |
|---|---|
| Lockup | Mark putih + `AXVARA PEDIA` desktop + mobile penuh 1:1 Market (2026-10-12: mobile 15px + truncate, dulu "PEDIA" saja), tanpa pemisah/gradien; desktop `font-display` 22px weight 300, tracking 0.16em, mark 36×32px, navbar 64px; tanpa pill Lacak |
| Ukuran navbar | 64px + `border-b border-white/10`, container `max-w-[1280px]` — sama persis dengan navbar pusat |
| Lebar konten | 1:1 Market 1280px (2026-10-12): `<main>` Pedia POLOS `pb-10` tanpa max-width/padding (dulu padding ganda 64px → konten 1216px); tiap section/halaman mengatur container `max-w-[1280px] px-4 sm:px-6 lg:px-8` sendiri seperti Market; h1 + `lg:text-[62px]` |
| Urutan tombol mobile | 1:1 Market (2026-10-12): ServicesMenu dulu, tombol search sesudahnya (sebelumnya kebalik) |
| Field cari navbar | 1:1 navbar Market (2026-10-12): pill `rounded-full` + ikon search kiri + tombol clear, `max-w-[520px]`, placeholder Pedia, store `usePediaSearch`, auto-scroll ke `#pedia-catalog`; panel mobile via tombol search; field kotak lama di area katalog dihapus |
| Favicon Pedia | `pedia-mark-favicon.png` |
| OG image | `public/og/pedia.png` |
| Judul UI saat ini | "Satu tempat untuk / Layanan sosial media" + typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner); slogan/tagline marketing awal hanya arsip, bukan hero atau tagline produk pembeli |

---

## 3. Warna

### 3.1 Token Identitas Awal (Referensi, Bukan Semua Aktif)

Working-tree memakai midnight, border/aksi/fokus cyan dan gold untuk tanpa refill. Token violet/gradien lama tetap referensi aset/status, bukan wajib untuk pilihan. Riwayat hero glow dihapus 2026-10-08 dipertahankan; **superseded lokal 2026-10-12** oleh glow cyan statis di hero saja. Wordmark tetap putih.

| Token | Nilai | Penggunaan |
|---|---|---|
| `--px-violet` | `#8B5CF6` | Aksen sub-brand: lockup, indikator aktif, ring progres, highlight tingkat terpilih (bersama cyan) |
| `--px-violet-soft` | `rgba(139,92,246,0.16)` | Latar chip aktif, glow |
| `--px-violet-strong` | `#A78BFA` | Teks violet di atas midnight (kontras ≥ 4.5:1) |
| `--px-gradient` | `linear-gradient(135deg, #00E5FF 0%, #8B5CF6 100%)` | Signature: wordmark PEDIA, border kartu promo, ring progres, tombol utama hover glow |
| `--px-hero-glow` | `radial-gradient(640px 420px at 30% 0%, rgba(0,229,255,0.16), transparent 70%), radial-gradient(560px 380px at 75% 10%, rgba(139,92,246,0.18), transparent 70%)` | Latar hero beranda Pedia |

Token toko pusat tetap berlaku: latar `--ax-bg #080C1E`, teks, border, status (`--ax-success/warning/danger`).

### 3.2 Aturan pemakaian warna
- **Cyan = aksi.** Tombol utama, link, focus ring tetap cyan (konsisten dengan toko pusat).
- **Violet = identitas & keadaan terpilih.** Jangan jadikan tombol utama violet polos.
- **Gold = uang & promo.** Harga coret, badge "Hemat X%", badge "BARU".
- **Warna brand platform** hanya di ikon 24–40 px dan garis tipis 2 px kartu platform; tidak pernah sebagai latar besar.

| Platform | Warna ikon | Catatan |
|---|---|---|
| Instagram | gradien `#FEDA75 → #D62976 → #4F5BD5` | ikon saja |
| TikTok | `#FFFFFF` dengan aksen `#25F4EE`/`#FE2C55` | |
| YouTube | `#FF0000` | |
| Facebook | `#1877F2` | |
| Threads / X | `#FFFFFF` | |
| Shopee | `#EE4D2D` | |
| Spotify | `#1DB954` | |
| Telegram | `#2AABEE` | |

### 3.3 Pilihan Tingkat Saat Ini

Hemat/Standar/Premium memakai permukaan gradien putih tipis yang sama, radius 16px; pilihan aktif border cyan `#00E5FF/60` + glow ringan, radio native accent cyan. Tier/quantity awal **null**, tidak ada default Standar. Refill cyan, Tanpa refill gold dengan teks; bukan garansi menyeluruh. Catatan label_note, masa refill_days, ETA mulai/selesai dari field tingkat; kosong Detail kualitas belum tersedia/Belum ditentukan. Harga awal tiap tier disertai quantity cocok sebelum pilihan, bukan total pesanan otomatis. Tidak ada badge Termurah/Paling dipilih/asumsi kualitas dari nama tier.

---

## 4. Tipografi

Mengikuti `DESIGN.md` §3 (Space Grotesk untuk display/harga, Inter untuk body, JetBrains Mono untuk kode pesanan).

| Elemen Pedia | Ukuran mobile / desktop | Weight |
|---|---|---|
| Hero headline | 42 / 56 px, tracking `-0.02em`, lh 0.98, `font-display` 700 (1:1 Market) | 700 |
| Subjudul hero | 15 px, `text-white/60`, `max-w-[46ch]` (1:1 Market) | 400 |
| Judul section | 22 / 32 px | 700 |
| Nama produk di kartu | 16 / 17 px | 600 |
| Harga "mulai" | 18 / 20 px Space Grotesk | 700 |
| Total di sticky bar | 20 / 22 px Space Grotesk | 700 |
| Label chip | 14 px | 600 |
| Helper/microcopy | 12.5 / 13 px | 400 |

Angka dinamis (total, progres, ticker) memakai `font-variant-numeric: tabular-nums` agar tidak "goyang".

---

## 5. Layout & grid

| Breakpoint | Lebar konten | Grid platform | Grid produk | Halaman order |
|---|---|---|---|---|
| < 640 | 100% − 32 px | Filter tombol wrap berikon | 1 kolom <360px, 2 mulai 360px | Form + ringkasan inline + CTA fixed bawah |
| 640–1024 | 100% − 32 px | Filter tombol wrap | 2 kolom | Form + ringkasan inline + CTA fixed bawah |
| ≥ 1024 | max 1280 px, padding 16/24/32 px (1:1 Market) | Filter tombol wrap | 3 kolom | Form fleksibel + rail 320 px sticky `top: 80px` |

- Radius kartu/tier 16px, input/CTA 12px; filter/jumlah 8px, bukan pill kualitas. Hero TANPA card (1:1 Market, 2026-10-12): tanpa `rounded-3xl`/border/glow di dalam card dan tanpa eyebrow AXVARA PEDIA; section full-bleed `w-screen left-1/2 -translate-x-1/2` menembus `<main>` 1280 + `overflow-x-clip` root (glow 900px tidak kejepit/kepotong kotak), TANPA `overflow-hidden` section + kartu ganda di DALAM section agar glow memudar natural di belakang kartu; glow cyan+gold disalin persis dari Market; h1 `font-display` 42/56px tight "Satu tempat untuk / Layanan sosial media" (putih) + Typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner); sub 15px/white-60. Kartu ganda `PediaServiceCards` (Market + Bot Telegram, kembar compact `min-h-[64px]` `ax-glass-card` + panah sama, `flex-row` di mobile).
- Beranda: padding atas 32/48 px, jarak section 40 px; form order gap 32/40 px, kelompok dipisah garis tipis.
- Safe area: sticky bar & bottom nav memakai `env(safe-area-inset-bottom)`.

---

## 6. Halaman

### 6.0 Implementasi Saat Ini (Working-Tree 2026-10-12, Belum Deployed)

**Beranda:** hero ala Market 1:1 (2026-10-12, tanpa card: glow section-level cyan+gold, h1 `font-display` 42/56px tight "Satu tempat untuk / Layanan sosial media" putih + `Typewriter` cyan Termurah / Termudah / Terpercaya atas permintaan owner, sub 15px/white-60 "…harga murah. Order cepat dan otomatis tanpa perlu login." ala Market + CTA Lihat Layanan (putih, `#pedia-catalog`) + Hubungi Admin (glass + ikon chat via `PediaWhatsAppLink` → hub /wa) + trust strip "Order cepat tanpa login • Garansi reffil • Support WA admin" 1:1 Market; tanpa eyebrow AXVARA PEDIA; gap hero→kartu→katalog 1:1 Market: inner hero `pb-4`, kartu ganda DI LUAR section hero seperti CommunityBar, katalog `pt-2`). Grid teks-orbit `1fr_auto` + `PediaOrbit` kanan (mobile center di bawah teks): mesin animasi 1:1 `OrbitHero` Market (refs+rAF, compositor-only, reduced-motion, hemat mobile SEMUA 8 planet tampil + 24fps/idle-defer — 2026-10-12 owner: dulu 4, terlalu sepi; trail/label/shadow dinamis tetap desktop-only, drag pointer-fine, `touch-action: pan-y`), 8 planet sosmed (YouTube/Spotify badge resmi `/icons/`, sisanya glyph asli `/icons/platforms/`; Threads/X putih → sphere gelap; sudut awal tiap ring di-stagger `RING_PHASE` agar tersebar merata), inti mark Pedia (`pedia-mark.svg` + filter putih + label PEDIA di sphere kaca). Kartu ganda `PediaServiceCards` (Market + Bot Telegram Market, kembar compact `min-h-[64px]` `ax-glass-card`, panah `ArrowUpRight` sama, `flex-row` berdampingan di mobile). Search navbar pill + filter platform berikon (`aria-pressed`); kartu Cari lewat link DIHAPUS dari beranda 2026-10-12 atas permintaan owner (`LinkPasteHero` tetap hidup sebagai komponen). Awal maks 8 featured Pilihan AXVARA; tanpa featured fallback 6 Jelajahi layanan TANPA sub-teks (2026-10-12: "Beberapa layanan…" dihapus). Tampilkan semua/cari/filter menjangkau seluruh produk AXVARA terbit, bukan supplier mentah. Reset/empty state tetap; section Cara pemesanan + Sebelum memesan (FAQ) DIHAPUS dari beranda 2026-10-12 atas permintaan owner (setelah layanan langsung footer 1:1 Market; info bantuan tetap di /pedia/bantuan + footer). Tanpa laris/ticker. `/layanan` semua produk/platform; `/p/[platform]` filter jenis dan grid compact sama. Kurasi data produksi belum disetujui hanya karena featured telah diimplementasikan.

**Kartu bersama:** catalogCard memasangkan harga terendah/jumlah/tier/**refill** dari entri yang sama, quantity wajib paket produk; seri harga → jumlah terkecil. Radius 16px, padding 12/16px, gradien putih 6%→1.5%, ikon 20px di kotak 32px, nama membungkus (tagline TIDAK dirender di kartu sejak 2026-10-12 owner — hapus AI slop; field tetap di data/admin), harga tabular dan Untuk N · paket Tingkat. Refill cyan/Tanpa refill gold, Lihat paket pada baris min-height 44px. Hover border/glow ringan dan lift motion-safe, tanpa backdrop blur berulang. Tidak ada badge asal akun/laris/refill tier lain. Tagline juga TIDAK tampil di detail/order; description_md adalah field katalog publik opsional, tampil di detail/order sebagai teks literal escaped dengan newline dipertahankan (`whitespace-pre-line`), bukan Markdown/HTML. Tidak ditambahi link-helper teknis. Panel visual kartu (2026-10-15, permintaan owner): tile Axvara-style per platform ala Market — gambar 16:10 R2 `/r2/products/pedia-platform-<platform>.webp` (Instagram/TikTok/YouTube/Facebook/Threads/Spotify/Shopee/X, 1600x900 WebP ~20KB, compose via muse dari logo Simple Icons + gaya canva+gsuite), label platform + kata metrik tetap di atas gambar (drop-shadow), 4 kartu pertama eager + fetchPriority high; `image: string|null` di `PediaCatalogProduct` + `ProductCardData` (path statis per platform, bukan kolom DB — 17 produk berbagi 8 gambar; platform tak dikenal → null → fallback gradasi brand lama).

**Tempel tautan:** input 56 px berlabel aksesibel, teks 16 px, autocapitalize/spellcheck mati; satu ring luar cyan, tidak ada ring input ganda. Deteksi 150ms, teks platform/jenis/username tanpa centang verifikasi; "Format tautan dikenali; akun atau konten belum diverifikasi." Saran memakai produk cocok dari seluruh katalog dengan target ternormalisasi. Clipboard API dengan fallback fokus/hint tetap ada.

**Order:** tiga kelompok. Paket & jumlah memakai radio native, tier/quantity null, summary Belum dipilih; harga awal tiap tier disertai quantity, ETA mulai/selesai dan refill faktual. Jumlah disabled sampai tier dipilih; ganti tier dengan quantity tak tersedia → null, bukan pilih otomatis. Paket-only, tanpa stepper/Lainnya. Tujuan & persyaratan: label/hint kontekstual, format saja diperiksa, checklist/help teks (tutorial gambar belum dirender). Kontak & konfirmasi: WA/email wajib, kredit terlipat, S&K; tidak ada tombol Periksa harga.

**Quote & pembayaran:** satu CTA per viewport Lanjut ke pembayaran memvalidasi lalu meminta quote otomatis. Total sama/ tanpa kredit → langsung order; total berubah atau input kredit → berhenti sebelum order, tampilkan nominal/payable server + **Setujui & lanjut ke pembayaran**. Perubahan input membuang quote/respons usang; >29 menit refresh sebelum order pertama. In-flight mencegah klik ganda; setelah order dicoba field terkunci. Ambigu/network/5xx/408/429 mempertahankan token/kontak; 4xx lain membuka kunci/quote dibuang. Pagar client bukan jaminan atomisitas seluruh efek samping orders.

**Ringkasan & state:** rail desktop 320px sticky top-20, mobile ringkasan inline + fixed CTA/safe area; consent memberi padding konten lebih besar. Error role=alert/fokus pertama invalid, consent role=status. Order tutup pesan dekat CTA disabled saja, bukan banner beranda/sebelum judul; kontak/kredit/S&K tidak dirender, paket/harga tetap dilihat. Bottom nav tersembunyi di order. ETA/refill per tier, tanpa janji instan/garansi universal; partial/cancel = Kode Kredit bukan tunai.

**Chrome:** PediaNavbar mark putih/AXVARA PEDIA desktop/PEDIA mobile + field cari pill ala Market (`usePediaSearch`, auto-scroll `#pedia-catalog`); navigasi desktop Katalog/Lacak/Bantuan + **ServicesMenu** Layanan AXVARA di kedua navbar, hanya Market/Pedia. AppSwitcher dihapus; menu disclosure native Tab/Enter + panah/Home/End, Escape focus-return, outside click/blur dismiss; mobile panel fixed, desktop absolute. Bottom nav 4 tab aktif cyan. Satu **Footer** storefront di kedua layout: brand ekosistem tanpa garansi/aktivasi universal, sosial + ikon WhatsApp monokrom satu tone sesudah Facebook (hub absolut `/wa?pesan=Halo%20AXVARA`), Layanan AXVARA (Market/Pedia tanpa kategori), bantuan/ketentuan/pelacakan kedua host dan newsletter. Revisi 2026-10-15 menghapus teks chat/jam layanan dan menaruh pill kecil Grup WA hijau/Bot Order Telegram biru di bawah sosial, dengan logo brand asli; bot tetap kanal Market; lintas host absolut dari site.ts. Market CommunityBar = CrossServicePromo Pedia + Bot Telegram Market; Pedia memakai `PediaServiceCards` = CrossServicePromo Market + Bot Telegram Market (kembar compact), UTM cross_promo (+ `&` sesudah `?start=beli`). URL grup WA/Bot terpusat, /link grup tetap tersedia dan kartu Pedia tetap tersembunyi. Bukan checkout lintas layanan.

**Admin:** `PediaManager.tsx` lima panel dengan tab wrap. Produk berupa daftar ringkas dengan cari/platform/kesiapan Siap dijual/Belum siap/Nonaktif, bukan editor seluruh produk sekaligus. Edit membuka satu produk; form produk/tingkat disimpan terpisah, tier terlipat dan pratinjau harga/margin tersimpan sesudah save, aksi Simpan produk sticky. Preview storefront tersimpan terpenuhi memakai `ProductCard` aktual + detail/pesanan `OrderClient` embedded dalam mode preview aman. Assignment supplier memilih produk dan tier existing, tidak otomatis mengaktifkan tier. Recovery status Indonesia + detail error, konfirmasi kirim ulang dua checkbox; kredit manual/pengaturan/resync memakai ConfirmDialog. Feedback loading/saving/error/sukses + Muat ulang; resync parsial dan `reprice_failed` dijelaskan jujur: edit mungkin sudah tersimpan, tidak ada rollback atomik. Pengaturan default bukan bulk update tier; riwayat saldo, bukan saldo live header. Tagline/deskripsi editable adalah copy publik sesuai kontrak kartu/detail di atas. Kontrak lengkap/readiness/batas settings: `PEDIA-PRD.md` §10.

Tambahan lokal dua-provider: buat produk/tingkat nonaktif, filter supplier/kompatibel/mapped, mapping pasangan provider+service (cadangan dibersihkan saat pindah provider), API refill vs masa kurasi terpisah, status Terbit/Unggulan/Siap diproses terpisah. Preview menggunakan **data tersimpan**, termasuk draf privat dan tingkat nonaktif dengan paket layak. Kartu aktual diikuti disclosure detail/pesanan aktual; navigasi/pemesanan disabled, interaksi preview tidak memanggil API dan kontak/kredit/S&K pemesanan tidak diminta. CTA mobile **inline, bukan fixed**, tautan kembali tidak dirender; ini reuse komponen, bukan klaim seluruh shell admin piksel-identik halaman publik. Save/reload memperbarui preview; input belum disimpan tidak ikut, unsaved live preview di luar scope. Pengaturan memiliki saldo live/cache/error/pricing/sync tiap provider (bukan header global); bukti gate aktual supplier masih pending. Recovery sesudah add ambigu hanya rekonsiliasi ID/provider asal; Kirim ulang/Batalkan+kredit disabled setelah submit pernah dicoba/ID ada. Kalimat lama tanpa create/saldo live di atas superseded oleh tambahan ini.

**Typewriter:** Termurah / Termudah / Terpercaya cyan (`block text-[#00E5FF]`, 2026-10-12 atas permintaan owner; tanpa min-height/cyan pembungkus); typing 85ms/delete 45ms, jeda baca 2.2s, teks visual aria-hidden dan seluruh frasa sr-only. Reduced-motion statis Termurah, caret motion-safe; timer pause tab-hidden, resume visibilitychange. Ini perilaku source, bukan bukti CLS/LCP/motion mobile terukur.

**Superseded:** spesifikasi overhaul 2026-10-11 (semua produk langsung, default Standar/jumlah kedua, Periksa harga terpisah, footer mini, AppSwitcher, kartu outline lama) diganti §6.0 ini. Riwayat QA/aset/wireframe tetap disimpan, bukan bukti release diff terkini.

### Wireframe Awal (Historis 2026-10-07, Tidak Berlaku untuk Overhaul)

§6.1–6.5 di bawah mengarsipkan intent awal; slogan/trust strip/laris/lima langkah/jumlah bebas/compare sheet/ukuran lama bukan spesifikasi UI saat ini. Status/lacak yang tidak diubah harus dicocokkan kode masing-masing, bukan dianggap seluruh wireframe telah diimplementasikan.

### 6.1 Beranda Pedia (`/`)

```
┌─────────────────────────────────────┐
│ [mark] AXVARA PEDIA   [Apps|Pedia|AI•]  │  ← navbar glass-strong sticky
│   (lockup tanpa |, sama dengan navbar pusat: 64px, font-display 22px) │
├─────────────────────────────────────┤
│        ✦ glow cyan + violet ✦         │
│   Tempel link,                        │
│   sisanya beres.                      │
│   Followers, likes, views untuk       │
│   IG, TikTok, YouTube & lainnya.      │
│ ┌─────────────────────────────────┐ │
│ │ 🔗 Tempel link profil / postingan │ │  ← LinkPasteHero (tinggi 56 px)
│ │                       [Tempel]   │ │
│ └─────────────────────────────────┘ │
│  ✓ Bayar QRIS  ✓ Mulai ±5 menit  ✓ Garansi │  ← trust strip 12.5 px
│                                       │
│  atau pilih platform                  │
│  [IG] [TT] [YT] [FB]                  │
│  [TH] [SP] [SH] [⋯]                   │  ← PlatformGrid
│                                       │
│  Paling laris                         │
│  ┌ ProductCard ┐ ┌ ProductCard ┐ …    │  ← scroll horizontal di mobile
│                                       │
│  Cara kerja: ① Tempel ② Pilih ③ Bayar │
│  ● baru saja: 1.000 Views TikTok · @ma***a · 2 mnt │ ← Ticker (bila ≥5/24 jam)
│  FAQ (accordion 6 item)               │
│  Footer ringkas + link ke axvara.tech │
├─────────────────────────────────────┤
│ [Beranda] [Layanan] [Pesanan] [Bantuan] │ ← bottom nav mobile
└─────────────────────────────────────┘
```

**Perilaku LinkPasteHero**
- Tombol "Tempel" memakai Clipboard API (`navigator.clipboard.readText`) bila diizinkan; fallback: fokus input + hint "Tekan lama lalu Tempel".
- Deteksi berjalan saat `input`/`paste` (debounce 150 ms). Hasil muncul di bawah input sebagai chip: `[ikon IG] Instagram · Postingan @ma***a ✓`.
- Hasil deteksi menampilkan 2–4 **ServiceSuggestion** (kartu mini: "Likes Instagram · mulai Rp2.400/1K") — ketuk langsung ke halaman order dengan target terisi.
- Link tidak dikenali: pesan netral "Kami belum mengenali link ini. Pilih platformnya di bawah." (bukan merah).

### 6.2 Halaman platform (`/p/[platform]`)
- Header: ikon platform 40 px + "Instagram" + 1 kalimat.
- Segmented filter jenis: `Semua · Followers · Likes · Views · Lainnya`.
- Daftar ProductCard (grid §5). Kosong → "Belum ada layanan untuk ini. Lihat platform lain."

### 6.3 Halaman order (`/o/[slug]?t=<target>`)

Angka contoh = Followers Instagram 250 dengan rumus PRD §7.2 (Hemat #948 G3, Standar #86 G3, Premium #24 G2).

```
Mobile
┌─────────────────────────────────────┐
│ ← Followers Instagram                 │
│ (tagline dihapus 2026-10-12 — judul   │
│  langsung ke deskripsi kurasi)        │
├─ 1  Target ───────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ instagram.com/namakamu        ✓  │ │ ← terisi dari link; ✓ hijau valid
│ └──────────────────────────────────┘ │
│  @namakamu · Profil Instagram         │
├─ 2  Jumlah ───────────────────────────┤
│ [100] [250•] [500] [1.000] [Lainnya]  │ ← QuantityChips (wrap 2 baris di 360px)
│  Rp12.000 · ±Rp48 per followers       │
├─ 3  Kualitas ─────────────────────────┤
│ ┌Hemat────┐┌Standar•──┐┌Premium──┐    │ ← TierSelector, scroll-snap horizontal di mobile
│ │Rp6.900  ││Rp12.000  ││Rp40.000 │    │
│ │Akun     ││Akun Indo ││Indo     │    │
│ │global   ││Garansi30h││aktif    │    │
│ │Mulai±10m││Mulai ±5m ││Mulai±30m│    │
│ └─────────┘└──────────┘└─────────┘    │
│  ⓘ Bandingkan kualitas                │ ← sheet tabel perbandingan
├─ 4  Cek sebelum bayar ────────────────┤
│ ☐ Akun saya publik (tidak dikunci)    │
│ ☐ Saya tidak ganti username selama proses │
│ ☐ "Tandai untuk ditinjau" sudah mati  [Cara ▾] │ ← tutorial 3 gambar terlipat
├─ 5  Kontak ───────────────────────────┤
│ No. WhatsApp  [08…           ]        │
│ Email         [nama@email.com]        │
│  Status & bukti pesanan dikirim ke email. │
│ ▸ Punya kode kredit?                  │
│ ☐ Saya setuju Ketentuan Pedia          │
│ (spacer 84 px)                        │
├─────────────────────────────────────┤
│ Total  Rp12.000        [ Bayar QRIS ] │ ← StickyOrderBar, fixed bottom
└─────────────────────────────────────┘
```

- Desktop: langkah 1–5 di kolom kiri; kolom kanan **OrderSummary** sticky (produk, target, jumlah, kualitas, garansi, ETA, kredit, total, tombol Bayar, logo QRIS). Sticky bar disembunyikan (`lg:hidden`), pola sama dengan checkout toko pusat (`DESIGN.md` §5.0).
- Nomor langkah = lingkaran 22 px; langkah selesai berubah jadi ✓ violet.
- "Lainnya" di jumlah membuka stepper + input angka dengan batas min–max dan kelipatan `step`; pesan di luar batas: "Minimal 100, maksimal 1.000 untuk kualitas ini."
- Ganti tingkat yang `max` lebih kecil dari jumlah terpilih → jumlah turun otomatis ke max + toast "Jumlah disesuaikan ke 1.000 (batas kualitas ini)".
- Tombol Bayar memakai label bertahap existing ("Membuat pesanan…" → "Menyiapkan QRIS…").

### 6.4 Status pesanan (`/pesanan/[code]`)

```
┌─────────────────────────────────────┐
│ AXP-7K2QD   [Salin]          Berjalan │ ← StatusPill
│ Followers Instagram · Standar · 250   │
│ @namakamu                             │
│                                       │
│            ╭───────────╮              │
│           │   62%      │              │ ← ProgressRing 160 px, stroke gradien Pedia
│           │ 155 / 250  │              │
│            ╰───────────╯              │
│  Mulai dari 1.204 followers           │
│  Perkiraan selesai: 1–6 jam           │
│                                       │
│  ● Dibayar 22.31  ● Dikirim 22.33  ○ Selesai │ ← OrderTimeline horizontal
│                                       │
│  [ Ajukan Refill ] (muncul bila berhak) │
│  Garansi berlaku sampai 7 Nov 2026    │
│                                       │
│  Butuh bantuan? WA Admin · Lacak lain │
└─────────────────────────────────────┘
```

- Sebelum lunas: kartu QRIS existing (`DESIGN.md` §5.7b) menggantikan ring.
- Auto-refresh: 10 dtk saat menunggu bayar, 60 dtk saat berjalan, berhenti saat terminal atau tab tersembunyi (`visibilitychange`).
- `partial`/`canceled`: **CreditCard** (§7) di atas ring, ring berhenti di persentase akhir dengan warna netral.
- `needs_check`: ilustrasi kecil + "Sedang kami cek. Tidak perlu order ulang — kami kabari lewat email."

### 6.5 Lacak (`/lacak`), Bantuan (`/bantuan`), Ketentuan (`/ketentuan`)
- Lacak: pola `/lacak-pesanan` toko pusat (kode + WA/email) + daftar "Pesanan di perangkat ini" dari localStorage `axp-orders`.
- Bantuan: FAQ terkelompok (Sebelum order · Setelah bayar · Garansi & kredit) + tombol WA Admin.

---

## 7. Katalog Komponen Awal (Historis 2026-10-07)

Tabel ini rancangan awal, bukan seluruh komponen aktif. §6.0 mengalahkan tabel: QuantityChips/TierSelector/TierCompareSheet tidak terpisah, ticker tidak dirender, ProductCard menampilkan tagline opsional dan hanya badge refill paket yang sesuai, AppSwitcher **dihapus**, LaunchCards.saved tetap arsip. Komponen baru aktual ServicesMenu/CrossServicePromo/Typewriter.

| Komponen | Spesifikasi kunci |
|---|---|
| `PediaNavbar` | `ax-glass-strong` + `border-b border-white/10`, tinggi 64 px, container `max-w-[1280px]` — SAMA dengan navbar pusat; lockup kiri: mark 36×32 + `AXVARA PEDIA` (`font-display` 22px, tracking 0.16em, tanpa `|`), `AppSwitcher` tengah (desktop) / kanan (mobile, versi ringkas ikon), tombol "Lacak" kanan |
| `AppSwitcher` | Segmented pill 3 opsi: **Apps** (→ axvara.tech) · **Pedia** · **AI** (badge "Segera", menuju waitlist). Indikator aktif = pill latar `--px-violet-soft` + teks putih, geser 300 ms `--ease-apple`. Tinggi 36 px, target sentuh tetap ≥ 44 px lewat padding. Dipakai juga di navbar axvara.tech (opsi Apps aktif) |
| `LinkPasteHero` | Input 56 px, radius 16, `ax-glass-card` + border 1 px `--ax-border`; fokus → border gradien Pedia + glow `0 0 0 4px rgba(139,92,246,0.18)`; ikon link kiri, tombol "Tempel" kanan (cyan) |
| `DetectChip` | Pill 32 px: ikon platform 18 px + "Instagram · Postingan" + username tersamar + ✓ |
| `PlatformTile` | 72×84 px (mobile), ikon 32 px dalam lingkaran 52 px latar `rgba(255,255,255,0.05)`, label 12.5 px; hover/tekan: lift 2 px + garis bawah 2 px warna platform |
| `ProductCard` | `ax-glass-card` radius 20, padding 16; ikon platform 28 px + nama + tagline 1 baris; baris badge (maks 2: "Akun Indonesia", "Garansi 30 hari"); "mulai Rp2.400" + satuan paket; seluruh kartu dapat diklik (`<a>`), panah kanan 16 px |
| `QuantityChips` | Chip 44 px tinggi, min-lebar 72 px; terpilih = latar `--px-violet-soft` + border violet + teks putih; harga paket di bawah chip terpilih |
| `TierSelector` | 3 kartu `role="radiogroup"`, lebar 148 px mobile (scroll-snap), isi: nama tingkat, harga, 2 fakta (asal akun, garansi), ETA mulai; terpilih §3.3 |
| `TierCompareSheet` | Bottom sheet (mobile) / modal (desktop) via `useModalA11y` — tabel 3 kolom: Asal akun, Garansi, Mulai, Selesai, Cocok untuk |
| `PreflightChecklist` | Checkbox 22 px, label 14 px; item dengan tutorial punya tombol "Cara ▾" membuka 3 gambar WebP 320 px (lazy) |
| `StickyOrderBar` | Fixed bottom, `ax-glass-strong`, tinggi 68 px + safe area; kiri "Total" + angka (animasi angka 200 ms saat berubah), kanan tombol Bayar 48 px |
| `OrderSummary` | Desktop rail, `ax-glass-card`, baris rincian + total + tombol + logo QRIS |
| `ProgressRing` | SVG 160 px, stroke 10, track `rgba(255,255,255,0.08)`, isi gradien Pedia, transisi `stroke-dashoffset` 600 ms `--ease-out`; `aria-valuenow` |
| `OrderTimeline` | 3–4 titik; selesai = violet, aktif = cyan berdenyut (mati saat reduced-motion), belum = abu |
| `StatusPill` | Warna status existing; label §5.3 PRD |
| `CreditCard` | Kartu gold-tipis: "Kode Kredit Rp4.000" + kode `PDK-XXXX-XXXX` (JetBrains Mono) + [Salin] + "Berlaku sampai …"; dikirim juga ke email |
| `OrderTicker` | Satu baris, fade bergantian tiap 4 dtk; dot hijau 6 px; jeda saat hover/fokus; disembunyikan saat reduced-motion (tampil statis 1 item) |
| `PediaBottomNav` | Pola `MobileBottomNav` toko pusat, 4 tab, indikator violet |
| `LaunchCards` | Kartu promo di axvara.tech (§9) |

Ikon platform: SVG lokal di `public/icons/platforms/*.svg` (sumber Simple Icons, lisensi CC0), BUKAN request runtime. Ikon UI lain memakai `IosIcon` existing.

---

## 8. Motion Awal (Historis)

Tabel motion awal bukan kontrak current. Lokal sekarang typewriter §6.0, glow hero statis, transisi warna/border/glow kartu dan lift hover motion-safe; fade hasil deteksi lama sudah dihapus. Tidak ada animasi angka/step/ticker atau border conic berulang. Reduced-motion global tetap.

Token dari `DESIGN.md` §6 (`--ease-apple`, `--ease-out`, durasi 180/300/420 ms).

| Elemen | Animasi |
|---|---|
| Hero masuk | headline & input `fadeInUp` 420 ms, stagger 80 ms |
| Deteksi link berhasil | DetectChip `scale(0.96)→1 + opacity` 200 ms; ServiceSuggestion stagger 60 ms |
| Ganti tingkat/jumlah | indikator terpilih geser 300 ms `--ease-apple`; angka total crossfade 200 ms |
| Langkah selesai | nomor → ✓ dengan `scale(0.8)→1` 180 ms |
| Tombol tekan | `scale(0.98)` 100 ms |
| Progress ring | dashoffset 600 ms saat data baru |
| Ticker | crossfade 300 ms tiap 4 dtk |

**Reduced motion:** semua animasi berulang mati (ticker statis, denyut timeline mati, shimmer mati, kartu promo statis dengan border gradien diam). Transisi state tetap instan.

**Larangan:** animasi `width/height/top/left`, `backdrop-filter` pada elemen berulang, animasi tak terbatas di luar kartu promo & ticker, parallax di halaman order.

---

## 9. Promosi di axvara.tech — Arsip `LaunchCards`

**Historis/disimpan sejak 2026-10-08:** CommunityBar Grup WA+Bot, AppSwitcher tersembunyi pusat/footer Pedia sendiri adalah riwayat **superseded lokal** oleh promo Pedia+Bot, ServicesMenu dan Footer bersama §6.0. LaunchCards.saved tidak diimpor, kartu Pedia /link tetap tersembunyi. §9.1–9.2 arsip, bukan permintaan mengaktifkan AI atau border conic.

### 9.1 Struktur
```
Mobile (2 kartu bertumpuk, tinggi ±96 px)          Desktop (2 kolom, tinggi 120 px)
┌──────────────────────────────────────┐
│ ◆BARU  Axvara Pedia               →  │
│ Naikkan followers, likes & views     │
│ ┌mini-demo: 1.204 → 1.704 followers┐ │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ SEGERA  Axvara AI                  → │
│ API GPT, Claude, DeepSeek · bayar QRIS│
│ ┌mini-demo: kursor mengetik respons ┐ │
└──────────────────────────────────────┘
```

### 9.2 Spesifikasi visual
- Kartu: `ax-glass-card` radius 20, padding 16/20, border animasi 1.5 px.
- **Border conic berputar** (hanya kartu Pedia saat Live; kartu AI memakai border diam sampai live):
  ```css
  .ax-launch { position: relative; isolation: isolate; border-radius: 20px; }
  .ax-launch::before {                      /* lapisan border */
    content: ""; position: absolute; inset: 0; padding: 1.5px; border-radius: inherit;
    background: conic-gradient(from var(--ax-angle), #00E5FF, #8B5CF6, #FFB800, #00E5FF);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor; mask-composite: exclude;
    animation: ax-spin 6s linear infinite; z-index: -1;
  }
  @property --ax-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
  @keyframes ax-spin { to { --ax-angle: 360deg; } }
  .ax-launch::after {                       /* kilau melintas */
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: linear-gradient(100deg, transparent 40%, rgba(255,255,255,0.10) 50%, transparent 60%);
    transform: translateX(-120%); animation: ax-sheen 6s var(--ease-out) infinite 1.2s;
  }
  @keyframes ax-sheen { 0%, 70% { transform: translateX(-120%); } 85%, 100% { transform: translateX(120%); } }
  @media (prefers-reduced-motion: reduce) { .ax-launch::before, .ax-launch::after { animation: none; } }
  ```
  Fallback browser tanpa `@property`: border conic diam (tetap terlihat premium).
- **Badge "BARU"**: pill gold (gradien gold shimmer `DESIGN.md` §2), denyut `scale 1→1.06→1` 2,4 dtk (mati saat reduced-motion).
- **Mini-demo Pedia**: angka `1.204 → 1.704` naik dalam 1,6 dtk (`requestAnimationFrame`, tabular-nums), jeda 3 dtk, ulang; mulai hanya saat kartu terlihat (IntersectionObserver) dan berhenti saat tab tersembunyi.
- **Mini-demo AI**: 1 baris "› Halo! Ada yang bisa kubantu…" diketik 28 ms/karakter + kursor kedip, ulang tiap 6 dtk; kondisi yang sama.
- Seluruh kartu adalah `<a>` dengan `aria-label` deskriptif; demo `aria-hidden="true"`.
- Performa: animasi mulai setelah `requestIdleCallback` (pola orbit mobile, `DESIGN.md` §6.2) agar tidak mengganggu LCP beranda.

### 9.3 Titik promosi lain
| Lokasi | Bentuk |
|---|---|
| Navbar axvara.tech | ServicesMenu lokal; keputusan AppSwitcher disimpan 2026-10-08 superseded (file dihapus) |
| `/link` (bio IG) | DISEMBUNYIKAN 2026-10-08 (owner) — kode 1 baris disimpan di `link-bio-client.tsx`, kembalikan saat owner memutuskan |
| Footer bersama | Market/Pedia + kedua bantuan/ketentuan/lacak, tanpa badge Baru/garansi universal |
| PopupBanner | Banner peluncuran (aset admin) 7 hari pertama, hanya beranda |
| Daily Promo Digest | 1 baris + link (flag) |

---

## 10. Microcopy

### 10.1 Glosarium (supplier → pembeli)
| Istilah supplier | Tampil di Pedia |
|---|---|
| HQ / LQ | (tidak ditampilkan; dibedakan lewat tingkat) |
| Real / Buzzer Real Active | Catatan admin yang sesuai layanan; tidak otomatis "Akun Indonesia aktif" hanya karena nama Premium |
| Indonesia | "Akun Indonesia" |
| Refill 30 hari / R30 / ♻️ | "Refill 30 hari, sesuai ketentuan" dari `refill_days` |
| No Refill / Tidak Bergaransi | "Tanpa refill" |
| Drip-feed | (tidak ditawarkan fase 1) |
| Start count / remains | "Mulai dari X" / "Tersisa Y" |
| Partial | "Selesai sebagian" |
| Matikan Flag For Review | "Matikan 'Tandai untuk ditinjau'" + tutorial |

### 10.2 Teks kunci
| Lokasi | Teks |
|---|---|
| Hero | Satu tempat untuk / Layanan sosial media + Termurah / Termudah / Terpercaya (typewriter cyan, 2026-10-12 atas permintaan owner); Followers, likes, dan views semua platform dengan harga murah. Order cepat dan otomatis tanpa perlu login. |
| Placeholder input | "Tempel link profil atau postingan…" |
| Trust strip | Tidak dirender; estimasi/refill mengikuti tingkat, kredit bukan refund tunai |
| Quote/consent | CTA memeriksa harga otomatis; Harga paket berubah dari RpX menjadi RpY / Total pembayaran RpZ. Tekan Setujui untuk menyetujui nominal ini. |
| Bayar | "Lanjut ke pembayaran"; saat request "Membuka pembayaran..." |
| Order tutup | Dekat CTA: Pemesanan belum tersedia. Paket dapat dilihat; kontak tidak diperlukan. |
| Format tautan | "Format tautan dikenali; akun atau konten belum diverifikasi." |
| Checklist belum lengkap | "Centang dulu poin ini supaya pesanan bisa diproses." |
| Link ganda | "Link ini masih diproses di pesanan AXP-7K2QD. Tunggu selesai dulu, ya." |
| Kredit diterbitkan | "Sebagian pesanan tidak terpenuhi. Sisa Rp4.000 kami kembalikan sebagai Kode Kredit — bisa langsung dipakai belanja lagi." |
| Refill diajukan | "Refill diajukan. Biasanya mulai dalam 24 jam." |
| needs_check | "Ada kendala teknis dan admin sedang memeriksa. Tidak perlu order ulang — kami kabari lewat email." |

Gaya: kalimat pendek, "kamu", tanpa tanda seru beruntun, tanpa huruf kapital semua kecuali badge 2–5 huruf ("BARU").

### 10.3 Dilarang
"100% aman", "anti banned", "pasti FYP", "followers asli" untuk tingkat non-aktif, emoji deret di nama produk, hitung mundur palsu, angka "sedang dilihat X orang" palsu.

---

## 11. State & umpan balik

| Situasi | Tampilan |
|---|---|
| Memuat katalog | Skeleton `ax-skeleton` bentuk sama dengan kartu (pola `Skeletons.tsx`) |
| Jaringan lambat | Komponen `NavigationProgress` existing (bar cyan + pil "Koneksi lambat") |
| Produk/tingkat/paket tidak valid | Tier tanpa harga valid dan produk tanpa paket tersedia tidak dikirim katalog; paket tidak valid pada tingkat terpilih disabled, bukan harga Rp0 |
| Order belum dibuka (`PEDIA_ORDERS_ENABLED=false`) | Notice katalog-only, kontak/kredit/S&K tidak dirender, CTA lanjut disabled |
| Error quote/order 4xx | Pesan inline, quote dibuang/kunci dibuka kecuali 408/429; CTA quote ulang, consent nominal berubah/kredit, bukan membayar diam-diam |
| Respons order ambigu | Data terkunci, pesan lanjutkan dengan data/token sama; CTA dapat retry setelah request selesai |
| Error admin | Feedback inline + Muat ulang; reprice_failed = perubahan tersimpan tetapi harga gagal diperbarui, bukan rollback |

---

## 12. Aksesibilitas (wajib)

- Kontras: teks muted di atas midnight ≥ 4.5:1 (`rgba(241,245,255,0.65)` lulus); violet teks pakai `--px-violet-strong`.
- Tingkat/jumlah menggunakan `<fieldset>`/`<legend>` dan `<input type="radio">` native dengan name terpisah; keyboard memakai perilaku native, bukan button ber-role radio. Label memuat data aktual, bukan badge hardcoded.
- Hasil deteksi link diumumkan via `aria-live="polite"`.
- CTA fixed mobile punya safe area + padding bawah konten `pb-28`; ringkasan hanya sekali per viewport. Fokus validasi diarahkan ke field/checklist pertama gagal.
- Modal/sheet memakai `useModalA11y` (Escape, focus trap, scroll lock).
- Tutorial gambar lama tidak dirender order-client; bila diaktifkan kelak wajib alt deskriptif. Bantuan checklist saat ini teks.

---

## 13. Checklist QA visual (Obscura, sebelum flag dinyalakan)

Status 2026-10-12: source/diff lokal telah diaudit, BELUM deployed, secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Preview storefront tersimpan terpenuhi; unsaved live preview di luar scope. Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau kelulusan seluruh daftar/gate live berikut. QA overhaul 2026-10-11 tetap historis. Tidak ada klaim Lighthouse/gate supplier/live-data; bukti currency/rate-unit live dan kurasi awal produksi/approval owner pending.

1. Beranda compact/featured/fallback/all/cari/platform/reset, harga-jumlah-tier-refill sepadan, typewriter/reduced-motion/tab-hidden, Footer bersama; tanpa laris/trust strip/ticker.
2. Tempel link IG post → chip deteksi + saran tampil.
3. Order tiga kelompok/radio native/null selection, invalid tier quantity reset null, fokus/validasi, satu CTA/nominal-change+kredit consent, expiry/invalidation/408/429/ambigu retry token sama; tutup hanya pesan CTA tanpa kontak. Tanpa compare sheet/jumlah bebas.
4. Status pesanan (mock): menunggu bayar, berjalan 62%, selesai sebagian + kartu kredit, needs_check.
5. Admin: daftar/readiness/filter, edit terpisah, assignment supplier, recovery/konfirmasi, kredit/settings, loading/error/empty/partial failure jujur.
6. ServicesMenu kedua host keyboard/Escape/focus/overflow, promo dua arah/UTM, Footer newsletter/kategori/bantuan/pelacakan absolut dan spacing nav/CTA; Market regression. AppSwitcher dihapus, LaunchCards arsip.
7. Target performa/aksesibilitas tetap mengikuti PRD; jangan menyatakan skor Lighthouse baru tanpa pengukuran.

### Konsistensi panel admin — 2026-10-15

Produk, Layanan Supplier, Pesanan, Kredit, harga tingkat dan riwayat saldo memakai tabel kaca seperti Produk Market: `ax-glass`, radius 20px, header uppercase 11px, sel px-4/py-3, divider tipis dan hover ringan. Wrapper berlabel dapat difokuskan dan digulir horizontal di mobile; tidak memperlebar halaman. Panel luar tanpa card tambahan, filter ringkas dan tombol utama cyan/pil. Edit putih dan sakelar hijau/abu dengan knob putih sejajar. Status publikasi, kesiapan, feedback gagal/parsial, preview dan recovery tetap memiliki arti yang sama.
