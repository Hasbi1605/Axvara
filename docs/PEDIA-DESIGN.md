# PEDIA-DESIGN.md — Panduan Desain & Style AXVARA PEDIA

> **Status:** diimplementasikan 2026-10-11, diverifikasi lokal, **pending deployment**. Pasangan `docs/PEDIA-PRD.md`. Overhaul mengikuti working-tree, bukan klaim UI baru sudah live.
> **Induk:** `docs/DESIGN.md` (design system AXVARA). Dokumen ini HANYA mencatat
> tambahan & pengecualian untuk Pedia. Semua yang tidak disebut di sini mengikuti
> `DESIGN.md` (token warna, glass, font Inter + Space Grotesk via `next/font`,
> motion Apple, skeleton, loading jaringan lambat, aksesibilitas).
> Spesifikasi saat ini: §3.3, §5–6, §10–13. Wireframe awal §6.1–6.5 dan katalog komponen/motion awal §7–8 ditandai historis; tidak mengalahkan implementasi §6.0. Aset/konsep arsip boleh tetap menyimpan slogan lama.

---

## 1. Prinsip desain Pedia

1. **Satu keluarga, beda kamar.** Pembeli harus langsung merasa "ini Axvara" (midnight, kaca, Prism, cyan), tapi tahu ini ruangan lain (aksen violet, wordmark PEDIA).
2. **Katalog dahulu.** Layanan → Paket & jumlah → Tujuan & persyaratan → Kontak & konfirmasi. Harga server diperiksa eksplisit sebelum lanjut pembayaran.
3. **Bahasa manusia, bukan bahasa panel.** Tidak ada HQ/LQ/R30/drip-feed/ID supplier; refill dijelaskan bersyarat, bukan diganti klaim garansi menyeluruh.
4. **Kejujuran terlihat.** Catatan kualitas, refill bersyarat dan kedua ETA memakai data tingkat; kosong dijelaskan, bukan diisi janji generik. Kredit bukan refund tunai, deteksi format bukan verifikasi akun.
5. **Ringan di HP murah.** Kartu berulang outline tanpa backdrop blur; tidak menambahkan animasi berat dari wireframe awal.

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
| Lockup | Mark putih + `AXVARA PEDIA` desktop / `PEDIA` mobile, tanpa pemisah/gradien; `font-display` 22px weight 300, tracking 0.16em, mark 36×32px, navbar 64px; tanpa pill Lacak |
| Ukuran navbar | 64px + `border-b border-white/10`, container `max-w-[1280px]` — sama persis dengan navbar pusat |
| Favicon Pedia | `pedia-mark-favicon.png` |
| OG image | `public/og/pedia.png` |
| Judul UI saat ini | "Layanan media sosial"; slogan/tagline marketing awal hanya arsip, bukan hero atau tagline produk pembeli |

---

## 3. Warna

### 3.1 Token Identitas Awal (Referensi, Bukan Semua Aktif)

UI overhaul memakai midnight polos, border/aksi/fokus cyan dan permukaan netral. Token violet/gradien yang masih ada tidak berarti harus dipasang ke tiap pilihan. Hero glow sudah dihapus 2026-10-08; wordmark putih, bukan gradien.

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

Hemat/Standar/Premium memakai gaya netral yang sama; pilihan aktif border cyan `#00E5FF/60` + `bg-white/[0.06]`, input radio `accent-[#00E5FF]`. Tidak ada border gradien atau badge "Termurah", "Paling dipilih", "Akun Indonesia aktif" yang diturunkan otomatis dari nama tingkat. Catatan kualitas berasal dari `label_note`, refill dari `refill_days`, kedua ETA dari field tingkat; field kosong ditulis "Detail kualitas belum tersedia" / "Belum ditentukan". Standar tetap default bila tersedia, bukan bukti popularitas.

---

## 4. Tipografi

Mengikuti `DESIGN.md` §3 (Space Grotesk untuk display/harga, Inter untuk body, JetBrains Mono untuk kode pesanan).

| Elemen Pedia | Ukuran mobile / desktop | Weight |
|---|---|---|
| Hero headline | 34 / 56 px, tracking `-0.02em`, lh 1.08 | 700 |
| Subjudul hero | 15 / 18 px, `--ax-text-muted` | 400 |
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
| < 640 | 100% − 32 px | Filter tombol wrap | 1 kolom | Form + ringkasan inline + CTA fixed bawah |
| 640–1024 | 100% − 32 px | Filter tombol wrap | 2 kolom | Form + ringkasan inline + CTA fixed bawah |
| ≥ 1024 | max 1120 px, padding 16 px | Filter tombol wrap | 3 kolom | Form fleksibel + rail 320 px sticky `top: 80px` |

- Radius kartu/input/CTA saat ini 12 px; filter/jumlah 8 px, bukan pill kualitas.
- Beranda: padding atas 32/48 px, jarak section 40 px; form order gap 32/40 px, kelompok dipisah garis tipis.
- Safe area: sticky bar & bottom nav memakai `env(safe-area-inset-bottom)`.

---

## 6. Halaman

### 6.0 Implementasi Saat Ini (2026-10-11, Lokal Terverifikasi, Pending Deployment)

**Beranda:** judul "Layanan media sosial" (30/36 px, semibold), penjelasan bandingkan paket/jumlah/ketentuan. Katalog lebih dahulu: cari nama, tombol Semua/platform yang punya produk (`aria-pressed`), jumlah hasil, grid seluruh produk publik (tidak dibatasi featured/delapan). Tidak cocok → Reset pencarian; katalog kosong → pesan layanan belum tersedia. Berikutnya "Sudah punya tautan?", Cara pemesanan dan FAQ lima item. Tanpa trust strip, laris, badge hardcoded atau ticker. `/layanan` mengelompokkan semua produk per platform; `/p/[platform]` filter jenis wrap dengan `aria-pressed`.

**Kartu bersama:** `catalogCard()` di `PlatformGrid.tsx` memasangkan harga terendah dengan jumlah dan tingkat dari entri harga yang sama (seri harga → jumlah terkecil). Kartu outline `border-white/15 bg-white/[0.02]`, radius 12 px, padding 20 px, ikon platform lokal 24 px dalam lingkaran 44 px, nama membungkus, harga tabular, "Untuk N · paket Tingkat", "Lihat paket →" cyan. Tanpa badge asal akun/garansi gabungan antar-tier, tagline atau deskripsi. `tagline` masih di payload; `description_md` hanya editor admin, tidak dikirim katalog atau dirender ke pembeli.

**Tempel tautan:** input 56 px berlabel aksesibel, teks 16 px, autocapitalize/spellcheck mati; satu ring luar cyan, tidak ada ring input ganda. Deteksi 150ms, teks platform/jenis/username tanpa centang verifikasi; "Format tautan dikenali; akun atau konten belum diverifikasi." Saran memakai produk cocok dari seluruh katalog dengan target ternormalisasi. Clipboard API dengan fallback fokus/hint tetap ada.

**Order:** tiga kelompok, bukan lima langkah. 1. Paket & jumlah: baris tingkat vertikal dengan radio native, catatan kualitas, refill bersyarat, harga untuk jumlah terpilih, ETA mulai dan selesai. Jumlah radio native wrap, paket tidak valid untuk tier disabled. Hanya paket konfigurasi; tidak ada Lainnya/stepper/jumlah bebas (orders API menolak non-paket). Ganti tier yang tidak mendukung jumlah → paket valid pertama + notice penyesuaian, bukan max bebas. 2. Tujuan & persyaratan: label link sesuai platform/jenis, format saja yang diperiksa, checklist + bantuan teks; tutorial gambar lama belum dirender. 3. Kontak & konfirmasi: WA/email berlabel, kredit terlipat, S&K, **Periksa harga**.

**Quote & pembayaran:** Harga paket adalah preview tanpa kredit; tombol Periksa harga memvalidasi semua field/checklist dan meminta quote, bukan membuat order. Total terkonfirmasi/kredit dari server tampil sebelum CTA **Lanjut ke pembayaran** aktif. Perubahan input membuang quote; quote usang diabaikan. Sebelum percobaan pertama quote client >29 menit meminta pemeriksaan ulang. Percobaan order mengunci field dan Periksa harga; ref mencegah klik ganda desktop/mobile. Respons ambigu/network/5xx mempertahankan data + token untuk retry yang sama; 4xx membuka kunci, quote dibuang. Ini tidak menyatakan seluruh efek samping orders API atomik.

**Ringkasan & state:** rail desktop 320 px sticky `top-20`, mobile ringkasan inline dan CTA fixed midnight solid + safe area (bukan total kedua). Error inline `role=alert`, fokus ke kontrol pertama invalid; feedback quote/penyesuaian `role=status`. Order ditutup: notice "Pemesanan belum tersedia" sebelum judul order dan pada beranda, paket/harga tetap terlihat, kelompok kontak termasuk kredit/S&K/Periksa harga tidak dirender, lanjut pembayaran disabled. Bottom nav tersembunyi pada order. Refill dan ETA bersyarat per tier, tidak menjanjikan "Mulai ±5 menit"/garansi seluruh katalog; kredit partial/cancel bukan pengembalian tunai.

**Chrome:** navbar Pedia existing (mark putih, desktop AXVARA PEDIA/mobile PEDIA, AppSwitcher, tanpa pill Lacak); bottom nav 4 tab gaya pusat, aktif cyan. Footer ringkas Pedia dengan Lacak pesanan/Bantuan/Ketentuan/tautan keluar Toko aplikasi AXVARA. Footer market, kategori Apps dan newsletter tidak dirender.

**Admin:** `PediaManager.tsx` lima panel dengan tab wrap. Produk berupa daftar ringkas dengan cari/platform/kesiapan Siap dijual/Belum siap/Nonaktif, bukan editor seluruh produk sekaligus. Edit membuka satu produk; form produk/tingkat disimpan terpisah, tier terlipat dan pratinjau harga/margin tersimpan sesudah save, aksi Simpan produk sticky. Assignment supplier memilih produk dan tier existing, tidak otomatis mengaktifkan tier. Recovery status Indonesia + detail error, konfirmasi kirim ulang dua checkbox; kredit manual/pengaturan/resync memakai ConfirmDialog. Feedback loading/saving/error/sukses + Muat ulang; resync parsial dan `reprice_failed` dijelaskan jujur: edit mungkin sudah tersimpan, tidak ada rollback atomik. Pengaturan default bukan bulk update tier; riwayat saldo, bukan saldo live header. Field tagline/deskripsi editable tidak berarti tampil pembeli. Kontrak lengkap/readiness/batas settings: `PEDIA-PRD.md` §10.

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
│   Bikin profil terlihat ramai         │
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

Tabel ini rancangan awal, bukan daftar komponen yang seluruhnya aktif. UI overhaul mengikuti §6.0; QuantityChips/TierSelector/TierCompareSheet bukan komponen terpisah yang dirender order-client saat ini. OrderTicker tidak dirender beranda; ProductCard sekarang tanpa tagline/badge; AppSwitcher pusat/LaunchCards disimpan.

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

Animasi hero/angka/indikator/step/ticker di tabel awal bukan kontrak overhaul. Implementasi saat ini mempertahankan transisi warna kartu/kontrol dan fade hasil deteksi; jangan menambah motion dari wireframe arsip. Reduced-motion global tetap berlaku.

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

**Historis/disimpan sejak 2026-10-08:** beranda pusat memakai `CommunityBar` (Grup WA + Bot Telegram); `LaunchCards.saved.tsx` tidak diimpor. AppSwitcher navbar pusat dan kartu Pedia `/link` disembunyikan. §9.1–9.2 di bawah adalah desain tersimpan, bukan tampilan saat ini atau permintaan untuk mengaktifkannya. Footer Pedia sendiri tidak memakai footer market.

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
| Navbar axvara.tech | `AppSwitcher` disimpan/tidak dirender sejak 2026-10-08 |
| `/link` (bio IG) | DISEMBUNYIKAN 2026-10-08 (owner) — kode 1 baris disimpan di `link-bio-client.tsx`, kembalikan saat owner memutuskan |
| Footer "Jelajah" | Link "Axvara Pedia" + badge "Baru" (30 hari) |
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
| Hero | "Layanan media sosial" / "Pilih followers, likes, atau views berdasarkan platform. Bandingkan paket, jumlah, dan ketentuannya sebelum memesan." |
| Placeholder input | "Tempel link profil atau postingan…" |
| Trust strip | Tidak dirender; estimasi/refill mengikuti tingkat, kredit bukan refund tunai |
| Quote | "Periksa harga" → "Harga terkonfirmasi: RpX. Periksa ringkasan, lalu lanjutkan ke pembayaran." |
| Bayar | "Lanjut ke pembayaran"; saat request "Membuka pembayaran..." |
| Order tutup | "Pemesanan belum tersedia"; "Paket dan harga dapat dilihat. Data kontak tidak diperlukan selama pemesanan ditutup." |
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
| Error quote/order 4xx | Pesan inline, quote dibuang; Periksa harga ulang sebelum lanjut, bukan menerima harga baru diam-diam |
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

Status overhaul 2026-10-11: lokal terverifikasi, pending deployment; daftar ini tidak menyatakan QA produksi atau Lighthouse sudah lulus. Hasil rinci dicatat pelaksana overhaul di CHANGELOG.

1. Beranda Pedia mobile/desktop: katalog-first, seluruh layanan, cari/platform/reset, pasangan harga-jumlah-tier, footer Pedia; tanpa laris/trust strip/ticker.
2. Tempel link IG post → chip deteksi + saran tampil.
3. Halaman order: tiga kelompok/radio native, ganti jumlah/tingkat + notice, validasi/fokus, Periksa harga lalu Lanjut, quote invalidation/expiry dan retry token sama; order ditutup tanpa kontak. Tidak ada compare sheet/jumlah bebas.
4. Status pesanan (mock): menunggu bayar, berjalan 62%, selesai sebagian + kartu kredit, needs_check.
5. Admin: daftar/readiness/filter, edit terpisah, assignment supplier, recovery/konfirmasi, kredit/settings, loading/error/empty/partial failure jujur.
6. Navbar Pedia/AppSwitcher/bottom nav dan footer contextual; pusat tetap CommunityBar, bukan LaunchCards.
7. Target performa/aksesibilitas tetap mengikuti PRD; jangan menyatakan skor Lighthouse baru tanpa pengukuran.
