# DESIGN.md — AXVARA Design System

**Tema:** Apple Store + Glassmorphism + Premium Vault
**Tagline Visual:** Midnight Navy + Electric Cyan Glow
**Version:** 1.1 (sinkron 2026-09-15: font cross-platform + katalog load-more + foto Telegram)
**Tanggal:** 31 Agustus 2026  

---

## 1. Prinsip Desain

1. **Apple-level Minimalism** — banyak whitespace, tipografi besar, foto produk jadi hero, tidak ada clutter. Seperti apple.com/store: 1 produk = 1 kartu premium yang bernafas.
2. **Glassmorphism sebagai Signature** — navbar, kartu, drawer keranjang, modal checkout semuanya kaca blur semi-transparan dengan border halus. Kesan mahal & futuristik.
3. **Motion yang Halus (Apple Spring)** — tidak ada animasi kaku. Semua transisi pakai spring/ease-out, 60fps, parallax lembut saat scroll.
4. **Dark Premium Default** — background gelap (midnight) dengan aksen cyan glow dan gold. Terasa seperti vault / lab AI mahal, bukan toko murah.
5. **Mobile-First, Thumb-Friendly** — semua CTA besar, keranjang drawer full-height di mobile, checkout 1 kolom di HP.

---

## 2. Palet Warna

### Core Palette

| Token | Hex | Penggunaan |
|-------|-----|------------|
| `--ax-bg` | `#080C1E` | Background utama (midnight navy) |
| `--ax-bg-2` | `#0F1430` | Section alternating |
| `--ax-bg-3` | `#161D4A` | Kartu elevated |
| `--ax-surface` | `rgba(255,255,255,0.06)` | Glass surface |
| `--ax-surface-2` | `rgba(255,255,255,0.10)` | Glass hover |
| `--ax-cyan` | `#00E5FF` | CTA, link, glow, focus ring |
| `--ax-cyan-soft` | `rgba(0,229,255,0.15)` | Glow background |
| `--ax-gold` | `#FFB800` | Badge premium, harga diskon, accent |
| `--ax-text` | `#F1F5FF` | Teks utama |
| `--ax-text-muted` | `rgba(241,245,255,0.65)` | Teks sekunder |
| `--ax-border` | `rgba(255,255,255,0.10)` | Border glass |
| `--ax-border-strong` | `rgba(255,255,255,0.18)` | Border hover |
| `--ax-success` | `#22C55E` | Lunas / sukses |
| `--ax-warning` | `#F59E0B` | Pending |
| `--ax-danger` | `#EF4444` | Error / batal |

### Gradient Signature

- Hero glow: `radial-gradient(600px 400px at 50% 0%, rgba(0,229,255,0.18), transparent 70%)`
- Card glow hover: `radial-gradient(400px 300px at 50% 0%, rgba(0,229,255,0.10), transparent)`
- Gold shimmer (badge): `linear-gradient(100deg, #FFB800, #FFD666, #FFB800)`

---

## 3. Tipografi

> Status 2026-09-14 (commit `cc8eaa1`): font cross-platform via `next/font`
> self-hosted — Inter (body) + Space Grotesk (display/harga) + JetBrains Mono
> (kode pesanan). Di Chrome Windows tidak lagi jatuh ke Arial tipis;
> `-webkit-font-smoothing: antialiased` hanya untuk WebKit Apple agar teks
> kecil Windows tidak pudar. Tabel di bawah adalah fondasi (dilengkapi webfont
> di `src/app/layout.tsx` + `tailwind.config.ts`).

| Level | Font | Size (desktop) | Weight | Usage |
|-------|------|----------------|--------|-------|
| Display | Space Grotesk / General Sans | 56px / 3.5rem | 700 | Hero headline |
| H1 | Space Grotesk | 36px | 700 | Judul section |
| H2 | Space Grotesk | 24px | 600 | Judul kartu produk |
| H3 | Space Grotesk | 18px | 600 | Label kategori |
| Body | Inter / Satoshi | 16px | 400 | Deskripsi |
| Small | Inter | 14px | 400 | Meta, harga coret |
| Caption | Inter | 12px | 500 | Badge, label |
| Price | Space Grotesk | 20px | 700 | Harga |

**Aturan:**
- Headline tight tracking `-0.02em`, line-height 1.1
- Body line-height 1.6, max 65ch
- Harga pakai Space Grotesk bold, warna `var(--ax-cyan)` atau `var(--ax-text)`

---

## 4. Glassmorphism Spec

```css
.ax-glass {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.ax-glass-strong {
  background: rgba(15, 20, 48, 0.75);
  backdrop-filter: blur(24px) saturate(200%);
  -webkit-backdrop-filter: blur(24px) saturate(200%);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
```

**Penerapan:**
- **Navbar:** `ax-glass-strong`, sticky top, blur saat scroll, border-bottom halus
- **Kartu Produk:** `ax-glass`, rounded-2xl (24px), hover → border cyan + glow + lift 4px
- **Drawer Keranjang:** `ax-glass-strong`, slide dari kanan, backdrop dim `rgba(8,12,30,0.6)` + blur
- **Modal Checkout:** `ax-glass-strong`, centered, rounded-3xl
- **Badge Kategori:** glass pill dengan dot cyan

---

## 5. Komponen Utama

### 5.0 Checkout Action-Rail ala WR (Batch C 2026-09-19, revisi anti-redundan, live)
- Desktop 2 kolom: kiri = DATA + EKSPEKTASI (① Data Pembeli, ② Verifikasi
  Otomatis, blok Made By Order bila antrean). Kanan = `aside` sticky
  `top-[72px]` "Ringkasan dan pembayaran": ringkasan item + total + Metode
  Pembayaran (QRIS pre-selected, variabel `paymentBlock` satu definisi) +
  S&K agreement (`agreeBlock`) + error + CTA + catatan tanpa-upload-bukti.
- Mini-blok MBO + trust sebaris di rail DIHAPUS (redundan: estimasi sudah di
  kiri, trust sudah di hero).
- 2 tombol submit (rail + sticky mobile) berbagi SATU handler + state
  `ctaDisabled`/`ctaLabel` — tidak ada logika validasi ganda.
- Mobile: accordion "Ringkasan Pesanan" collapsed-able di atas (buka default,
  total selalu terlihat di header-nya) + CTA sticky bottom `fixed` (dengan
  `safe-area-inset-bottom`) + spacer 68px agar konten tak tertutup. Sticky
  bottom `lg:hidden`.

### 5.1 Navbar (Apple Style)
- Height 64px, sticky, glass-strong, blur
- Kiri: Logo AXVARA (X sebagai gerbang/vault dengan glow cyan) + wordmark Space Grotesk 700
- Tengah: Search pill glass (icon + placeholder "Cari AI Gateway, ChatGPT Plus...")
- Kanan: Kategori dropdown, Keranjang (icon + badge jumlah baris varian — pola marketplace: 1 baris GSuite min-50 tampil "1", bukan "50"), Admin (icon)
- Scroll: navbar tambah shadow + background lebih opaque

### 5.2 Hero Section
- Full-width, min-h 60vh, midnight gradient + radial cyan glow di atas
- Headline: "Gerbang Semua Tools Premium" (Space Grotesk 56px, gradient text cyan→white)
- Subheadline: "AI Gateway, Akun Premium, Tools Pro — satu tempat, harga jujur, bayar QRIS 10 detik"
- CTA: Primary "Jelajahi Katalog" (cyan solid, glow) + Secondary "Cara Bayar" (glass outline)
- Search besar glass di bawah CTA (seperti Apple Store search)
- Parallax: glow dan headline bergerak halus saat scroll (translateY + opacity)

### 5.3 Kartu Produk (Apple Card)
- Rounded 24px, glass, aspect 4:3 untuk gambar, padding 20px
- Gambar: object-cover, rounded-xl, hover scale 1.03
- Badge kategori di atas gambar (glass pill + dot)
- Nama produk: H2, 2 baris max, ellipsis
- Harga: besar cyan, harga coret kecil muted jika diskon (dari varian termurah
  yang masih tersedia — bukan varian habis)
- Tombol: "Tambah" (glass → cyan solid saat hover), icon keranjang
- Hover: border `rgba(0,229,255,0.35)`, glow radial, lift `translateY(-4px)`, shadow cyan soft
- Grid: 1 col mobile, 2 tablet, 3-4 desktop, gap 20px
- Katalog: 12 produk + tombol **"Tampilkan N produk lagi"** (bukan nomor halaman);
  produk ready di depan, stok habis tetap tampil di belakang (urutan stabil)

### 5.3c PDP: Syarat & Ketentuan per Varian + Label Garansi
- Section "Syarat & Ketentuan" terikat **varian terpilih** (fallback varian
  aktif pertama): judul + badge label varian, isi numbered-list bernomor
  otomatis (prefix angka mentah WR di-strip), sub-blok "Cara Aktivasi" bila ada.
- Desktop: kartu glass di kolom kiri bawah deskripsi. Mobile: kartu di bawah
  accordion deskripsi.
- Badge pengiriman pembeli fulfillment-aware (2026-09-19, live):
  `buyerDeliveryKind()` — WR ikut `wr_delivery_class` (restock = Kirim
  otomatis, selainnya = Made By Order + estimasi supplier); non-WR ikut
  `fulfillment_mode` milik admin (shared/unique = Kirim otomatis dari stok
  sendiri, manual = Made By Order + kalimat admin tanpa angka supplier).
  Berlaku di kartu varian PDP + badge PDP + QuickVariantModal (badge per
  kartu; kalimat ETA di atas CTA modal dihapus 2026-09-19). Opsi admin "Cara Pengiriman" di ProductVariantRows sinkron 1:1
  dengan `fulfillment_mode` + preview badge; panel konten fulfillment
  (shared/unique) hidup di jalur resmi — bukan hanya VariantEditor mati.
- Nama varian pembeli SELALU `formatVariantLabel()` (2026-09-19, live): label +
  " - durasi" bila durasi belum terkandung di label (case-insensitive).
  Latar: sync WR menulis label = nama API verbatim ("Meitu VIP") dan durasi di
  kolom `duration_*` ("7 Hari"); PDP web yang hanya render label kehilangan
  durasi di 88/97 varian aktif, padahal web WR menggabung ("Meitu VIP - 7
  Hari"). Berlaku di kartu varian PDP + QuickVariantModal + displayName quote
  checkout (ringkasan + blok Made By Order). Label yang sudah mengandung durasi
  ("GSuite 1 Hari", "Invite 1 Bulan") tidak digandakan. DB tak tersentuh agar
  sync tetap aman menimpa.
- Label garansi varian SELALU kanonis `Garansi N Unit` ("Garansi 12 Hari") +
  ikon shield — di baris sendiri di BAWAH nama varian (block, bukan inline),
  JANGAN render label mentah ("12 Hari" ambigu dengan durasi).
- Badge pengiriman per varian TANPA emoji (anti AI slop, 2026-09-17; teks
  direvisi 2026-09-18/19): di bawah label varian (block, di atas harga/garansi) —
  restock = pill `emerald-400/25 + emerald-500/10` teks "Kirim otomatis",
  selainnya = pill `gold/25 + gold/10` teks "Made By Order" polos tanpa angka
  jam (2026-09-19; sebelumnya "Made By Order · maks 12 jam").
  "Dikirim admin" dan "Diproses antrean" dibuang (samar / diganti istilah owner
  2026-09-19). Berlaku di kartu varian PDP desktop +
  QuickVariantModal. JANGAN taruh di card deskripsi/S&K (datanya per-varian,
  bukan per-produk) dan JANGAN pakai emoji ⚡/✋.
- Ekspektasi waktu (2026-09-18, revisi kata 2026-09-19, live): kalimat `deliveryEtaForBuyer()` wajib
  tampil SEBELUM pembeli bayar — badge pengiriman PDP (tanpa ikon checklist
  ganda sejak 2026-09-19) + teks di bawahnya, dan blok checkout "Made By Order"
  (border+bg gold `#FFB800/25` + `/[0.07]`; template sejak 2026-09-19:
  "{produk} dibuat setelah pembayaran terkonfirmasi. Umumnya terkirim cepat,
  maksimal 12 jam pada jam layanan"; paragraf
  "Detail akun dikirim ke WhatsApp…Tidak perlu menunggu" dihapus 2026-09-19).
  QuickVariantModal HANYA badge per kartu varian — kalimat ETA di atas CTA
  dihapus 2026-09-19 (keputusan owner). Angka yang dijanjikan hanya PLAFON (maksimal 12
  jam) plus "umumnya lebih cepat"; jangan tampilkan rentang mentah 6–12 jam
  (dibaca sebagai janji minimum) dan jangan tanpa angka (pembeli tetap
  bertanya via support). Nama pemasok tidak pernah muncul di copy pembeli.

### 5.3d Minimum Pembelian per Varian (2026-09-17, live — revisi UX ala marketplace)
- Kolom `product_variants.min_qty` (migrasi 0034, default 1 = bebas; GSuite =
  50). Riset pola Shopee/Tokopedia: (1) qty selector dibuka di minimum dan
  minus tidak turun di bawahnya; (2) info "Min. N" SATU tempat di dekat
  kontrol jumlah — bukan badge di tiap kartu varian (menumpuk bila 7 varian);
  (3) Beli Langsung membawa qty terpilih (tidak selalu 1 → tidak dead-end);
  (4) server authoritative, frontend menjelaskan penyesuaian.
- PDP (desktop + mobile): blok **Jumlah** di bawah varian — stepper
  (−/input ketik/+) dibuka di min, minus tidak turun di bawah min, ketik
  manual bebas (digit saja, maks 3) lalu commit clamp [min, 100] saat
  blur/Enter — tidak bisa di bawah min. Teks "Min. pembelian N" + total
  berjalan untuk min>1. Beli Langsung → `/checkout?buy=&variant=&qty=`;
  Tambah ke Keranjang memakai qty stepper.
- QuickVariantModal: panel SOLID `#0B1025` (konsisten ConfirmDialog /
  ProductEditorModal / dialog checkout — bukan glass transparan) + blok
  Jumlah yang sama (stepper + ketik manual clamp) + tombol aksi menampilkan
  TOTAL (qty × harga).
- QuickVariantModal (revisi lebar desktop 2026-09-18, live): mobile dikunci
  bottom-sheet `max-w-[480px]` (sudah pas); desktop `sm+` panel tengah
  `sm:max-w-[620px] lg:max-w-[660px]` + `sm:p-7`, grid tetap 2 kolom dengan
  `sm:gap-3 + sm:p-4` per kartu, list `sm:max-h-[340px]` agar 4-6 varian
  (kasus GSuite) jarang kena scroll internal, CTA `sm:h-12`. Pola tidak
  berubah: tetap modal fokus, bukan drawer/page baru.
- Checkout: keranjang lama di bawah min → dialog solid "Sesuaikan Jumlah
  Pembelian" dengan tombol **Sesuaikan ke minimum** (1 klik menaikkan qty +
  refetch quote), bukan dead-end "kembali belanja".
- Telegram: stepper floor = min; WhatsApp (qty selalu 1): varian min>1
  ditolak jelas + arahan bulk.

### 5.3b Foto Welcome Telegram- File: `public/banners/tg-welcome.webp` (WebP ~31 KB, 1280px) — dikirim via
  `sendPhoto` di `/start` dengan caption sapaan + inline keyboard.
- JANGAN pakai PNG 2,2 MB dari R2 (timeout 10 dtk di edge → foto gagal diam-diam).
  Bila `sendPhoto` gagal: retry 1x, lalu fallback teks + keyboard.
- `/start` TIDAK mengirim pesan teks tambahan apa pun setelah foto
  (reply keyboard persistent sudah terinstal sejak /start pertama).

### 5.4 Keranjang Drawer
- Overlay: `rgba(8,12,30,0.6)` + `backdrop-blur-sm`
- Panel: 420px desktop, full-width mobile, glass-strong, rounded-l-3xl desktop
- Header: "Keranjang (N)" — N = jumlah baris varian (`lineCount()`, 2026-09-19), bukan sum qty — + tombol tutup X
- List item: thumb 64px rounded-xl, nama, qty stepper glass, harga
- Footer sticky glass: subtotal, tombol "Checkout — Rp 89.000" (cyan, full-width, glow)
- Animasi: spring slide `transform: translateX(0)` dengan `cubic-bezier(0.32, 0.72, 0, 1)` 420ms

### 5.5 Halaman Detail Produk
- Layout 2 kolom: galeri kiri (1 besar + 3 thumb), info kanan glass card
- Harga besar + badge diskon gold, stok indicator dot hijau/kuning
- Deskripsi + benefit list (icon check cyan)
- CTA: "Beli Langsung" (cyan solid) + "Tambah ke Keranjang" (glass)
- Animasi: galeri fade + scale saat ganti thumb

### 5.6 Checkout (1 Halaman, Apple Form)
- Max-width 640px, centered, glass card rounded-3xl, padding 32px
- Step: ① Data Pembeli (Nama, WA, Email opsional) → ② Pembayaran → ③ Verifikasi Otomatis
- Input: glass input `bg-white/[0.06] border-white/10 rounded-xl h-48px focus:border-cyan/50 focus:ring-cyan/20`
- Payment selector: 3 kartu (QRIS aktif / E-Wallet + Transfer Bank maintenance 2026-09-17) — kartu maintenance: `opacity-50 cursor-not-allowed`, `aria-disabled`, badge gold "Maintenance", tidak bisa diklik; QRIS selected → border cyan + bg cyan/10
- Jika QRIS: tampil QR image rounded-2xl, shadow, tombol "Download QRIS"
- Upload bukti: disembunyikan total selama maintenance (tidak dirender, bukan disabled); panel ③ selalu "Verifikasi Otomatis"
- Tombol submit: cyan solid, full-width, h-52px, rounded-xl, disabled jika form invalid atau metode bukan QRIS
- Ringkasan pesanan sticky di kanan desktop, di bawah form di mobile

### 5.7 Halaman Sukses
- Icon centang besar cyan glow, headline "Pesanan Diterima!", kode `AXV-20260831-0012` mono, status badge Pending warning
- Instruksi: "Admin verifikasi 5-15 menit, cek WA kamu"
- Blok tombol 2-tier (revisi proporsi 2026-09-18, live — fix wrap 2 baris +
  menara 4 tombol di mobile): Tier 1 navigasi ("Lacak Status" + "Lanjut
  Belanja") grid 2 kolom `h-11 text-sm whitespace-nowrap` style glass/ghost;
  Tier 2 bantuan di bawah konteks mikro "Butuh bantuan?" — 2 pill outline
  `border-white/10 h-11 text-[13px]` (brand hanya di ikon
  `whatsapp-circle.svg` / `telegram.svg` + hover border brand 40%, bukan
  background solid full-bleed), label pendek "WA Admin" / "Telegram" agar
  muat 1 baris tanpa wrap. Tap target tetap ≥44px.
- Blok pasca-pembayaran (revisi 2026-09-18, live): satu kartu `ax-glass-card`
  di bawah Ringkasan, isinya bergantung `credentials_ready` dari server.
  Siap → panel "Detail Akun Digital" (input WA + CTA cyan `Tampilkan`, hasil
  kartu mono emerald). Belum/tidak pernah ada (fulfillment manual) → blok
  informasi "Pengiriman Produk": kalimat tujuan pengiriman dengan WA + email
  checkout tersamar di-highlight `text-white/80`, lalu catatan estimasi 5–15
  menit `text-[11px] text-white/40`. Prinsipnya: JANGAN pernah tampilkan
  kontrol yang pasti gagal ke pembeli yang baru membayar — form mati lebih
  bikin panik daripada tidak ada form.
  Hasil "Detail Akun Digital" SELALU multi-baris rapi per field (2026-09-18
  sore, live): `normalizeAccountDetailsForDisplay` mengupas envelope JSON
  (`{product,details}`), menormalisasi `\r\n`, memisah `key: value` /
  `key:: value`, memberi label Indonesia (Akses OTP, Tautan), dan membuang
  label ganda — tidak pernah JSON mentah (bukti prod: link 95FC8669 tampil
  `{"product":...,"details":"email:...\r\npassword:..."}` sebelum ini).

### 5.7a Halaman Lacak Pesanan `/lacak-pesanan` (2026-09-17, live)
- Riset pola marketplace (Shopee/Tokopedia/Apple order tracking): satu form
  hero (kode + WA, tanpa login) → hasil timeline vertikal 3 tahap
  (Dibuat → Pembayaran → Diproses) dengan ikon IosIcon + garis penghubung,
  bukan teks status mentah. Auto-refresh 10 detik hanya saat Pending.
- Konsistensi AXVARA: `ax-glass-card` rounded 24–28px, JetBrains Mono untuk
  kode, badge Pending gold / Lunas emerald / Batal red / Kedaluwarsa muted,
  CTA cyan solid + bantuan tier-2 pill outline + ikon brand (revisi proporsi
  2026-09-18, sama dengan halaman `/pesanan/[code]`: Tier 1 navigasi grid 2
  kolom, Tier 2 "WA Admin"/"Telegram" di bawah "Butuh bantuan?"; tombol
  kondisional primary `Buka Halaman Pembayaran / Buat Pesanan Baru / Lanjut
  Belanja` full-width `col-span-2`), FAQ `<details>` + kartu cara 1-2-3 seperti
  `/cara-order`. Mobile-first max-w 720px, tap target ≥44px.
- Privasi: verifikasi `POST /api/orders/lookup` (kode + WA dinormalisasi
  08/+62/62, banding `constantTimeEqual`), 404 generik untuk kode-salah
  maupun WA-tidak-cocok (anti-oracle enumerasi), WA/email tampil mask,
  rate-limit scope `orders:lookup` yang sama dengan lookup lain.
- Nyaman: validasi inline format kode & WA, tombol Salin kode, riwayat lokal
  5 terakhir (`axvara-track-recent`, mask WA), deep-link `?code=&wa=` dari
  chat bot, tautan "Lacak pesanan lain" tanpa reload halaman.

### 5.7b Framing QRIS di /pesanan/[code] (2026-09-16, live)
- Urutan vertikal: label **"Scan QRIS"** (font-display 20px bold putih) →
  kotak QR putih `max-w-[330px] rounded-2xl p-3` (QR + quiet zone TIDAK
  tersentuh) → lockup resmi (logo + teks lengkap **"National Payment
  Standard"**, tidak terpotong "...") → Total bayar → kode unik →
  countdown → Download.
- Lockup: `public/brand/qris.svg` (logo resmi QRIS Bank Indonesia versi
  mono putih untuk bg gelap, sumber Wikimedia Commons `Logo_QRIS.svg`
  karya BI) + teks Inter 14px `white/70`, `aria-label="QRIS National
  Payment Standard"`.
- Framing MURNI frontend — generator `src/lib/payments/qris-png.ts` dan
  route `/api/payments/qris/[code]/image` TIDAK disentuh (QR tetap murni
  agar scan + file unduhan tidak rusak). Berlaku hanya di cabang QR aktif;
  state kedaluwarsa/lunas/dibatalkan tidak ikut.

### 5.8 Admin UI (Clean, Bukan Glass Berat)
- Sidebar midnight solid, main area `bg-[#080C1E]`
- Kartu stat: glass subtle, angka besar Space Grotesk
- Tabel pesanan: glass row, status badge (Pending kuning, Lunas hijau), foto bukti thumb klik untuk lightbox
- Form produk: 2 kolom, upload drag-drop, preview, kategori select

**Aturan konsistensi admin (2026-09-19, live).**
- **Judul section wajib.** Tiap section punya `h2` + satu baris deskripsi di
  header cardnya. Produk sebelumnya satu-satunya section tanpa judul apa pun.
- **Dialog selalu bertema.** `confirm()`/`alert()` bawaan browser dilarang di
  panel admin — pakai `ConfirmDialog` (hapus) atau toast (error). Dialog OS
  putih-abu di atas panel midnight adalah cacat visual, bukan pilihan.
- **Modal = dialog yang sah.** Setiap overlay wajib `role="dialog"` +
  `aria-modal="true"` + tutup dengan Escape + `body` scroll-lock, mengikuti
  `ConfirmDialog` dan `ProductEditorModal`.
- **Chip filter aktif.** Filter yang sedang menyaring daftar harus terlihat
  sebagai chip yang bisa dilepas (cyan `#00E5FF` untuk Pesanan, amber
  `#FFB800` untuk Stok menipis). Tanpa chip, daftar tersaring terlihat seperti
  data hilang.
- **Satu label = satu satuan.** Metrik dengan nama sama di dua layar wajib
  memakai basis hitung yang sama.
- **Form panjang = tab + aksi sticky (2026-09-20).** Modal yang memuat lebih
  dari satu pekerjaan dipecah dengan tab, dan tombol simpan hidup di footer
  `shrink-0` di luar area scroll. Patokan: tombol simpan tidak boleh berada
  di luar layar saat admin mengedit baris paling bawah.
- **Menu sidebar hanya untuk tempat kerja.** Layar yang diatur sekali
  (token integrasi) atau baca-saja (daftar subscriber) jadi tab di dalam
  Pengaturan, bukan slot sidebar sendiri. Nilai `?section=` lama tetap
  dipertahankan agar tautan/bookmark tidak mati.

---

## 6. Animasi — Apple Motion

### Prinsip
- Semua animasi di bawah 500ms, terasa spring bukan linear
- Pakai `transform` dan `opacity` saja (GPU), jangan animate width/height
- Hormati `prefers-reduced-motion: reduce` → matikan parallax & spring

### Token

```css
--ease-apple: cubic-bezier(0.32, 0.72, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
--duration-fast: 180ms;
--duration-base: 300ms;
--duration-slow: 420ms;
```

### Animasi Spesifik

| Elemen | Animasi |
|--------|---------|
| Hero glow | `parallax: translateY(scrollY * 0.15)` + opacity fade |
| Kartu produk masuk | `fadeInUp: translateY(16px)→0 + opacity 0→1`, stagger 60ms per card, saat masuk viewport (IntersectionObserver) |
| Hover kartu | `translateY(-4px) + border glow` 300ms ease-apple |
| Drawer open/close | `translateX(100%)→0` 420ms ease-apple + overlay fade 300ms |
| Modal checkout | `scale(0.96)→1 + opacity 0→1` 300ms ease-out |
| Badge count | `scale(1.4)→1` 200ms spring saat tambah keranjang |
| Button press | `scale(0.98)` 100ms |
| Toast | `slideUp + fade` 300ms, auto dismiss 3s |
| Page transition | `fade 180ms` (jika SPA) atau instant (MPA) |

---

## 7. Responsive Breakpoints

| Breakpoint | Width | Grid Produk | Navbar | Checkout |
|------------|-------|-------------|--------|----------|
| Mobile | 320–640 | 1 col | hamburger + search di bawah | 1 col stack |
| Tablet | 640–1024 | 2 col | search pill tengah | 1 col |
| Desktop | 1024–1280 | 3 col | full | 2 col (form + ringkasan) |
| Wide | 1280+ | 4 col | full + max-width 1280 centered | 2 col |

---

## 8. Aksesibilitas & Detail

- Fokus ring: `0 0 0 3px rgba(0,229,255,0.35)` — selalu terlihat
- Kontras: teks utama 15:1, muted 5.5:1 (WCAG AA)
- Alt text wajib untuk semua gambar produk & QRIS
- Tombol min 44px tap target
- Warna bukan satu-satunya penanda status (ikon + teks)
- QRIS dinamis punya alt text berisi kode order tanpa mengekspos payload mentah sebagai teks

---

## 9. Asset

- **QRIS:** dirender sebagai PNG per order dari payload DANA Business server-only; tidak ada aset QRIS statis publik. Framing (label + lockup) murni frontend di `/pesanan/[code]` — lihat §5.7b
- **Logo QRIS resmi:** `public/brand/qris.svg` (mono putih, sumber resmi BI via Wikimedia Commons; JANGAN ketik ulang dengan font / comot JPG)
- **Logo:** Wordmark "AXVARA" Space Grotesk Bold, X stylized sebagai vault gate (gap di tengah X dengan glow cyan). Versi light di dark bg. SVG.
- **Ikon:** Lucide React (outline, 20px, stroke 1.75)
- **Foto produk (standar 2026-09-15, revisi compose):** Muse Image `compose`
  dengan 2 referensi asli pemilik (`canva.webp` + `gsuite.webp`, 1600×900)
  sebagai kunci gaya — BUKAN prompt-only. Hasil: tight close-up tile huge
  ~85% tinggi frame, background navy luminous + glow halo biru, rim cyan
  kiri tebal + magenta kanan tebal, specular putih atas, refleksi lantai
  terang, emblem 3D glossy besar ~75% muka tile, tile NAPAK. Pelajaran:
  generate prompt-only menghasilkan tile kecil distant (~55%, bg gelap, rim
  tipis) yang dinilai pemilik beda style. Output compose 2096×1184 →
  center-crop 16:9 + resize LANCZOS 1600×900, WebP q82 (~19–32 KB). Upload
  ke R2 `axvara-assets/products/<md5>.webp` via `wrangler r2 object put ...
  --remote --jurisdiction default`, lalu `UPDATE products SET
  image_url='/r2/products/<md5>.webp',
  images='["/r2/products/<md5>.webp"]' WHERE slug=...` di D1 remote.
  Live compose 2026-09-15: 12 produk (netflix, spotify, chatgpt, loklok,
  capcut, claude, leonardo, getcontact, apple-music, vidio, viu, zoom);
  youtube diganti manual oleh pemilik (skip).

---

## 10. Referensi Visual

- Apple Store: https://www.apple.com/store — hero, kartu, whitespace
- Linear.app — glass + dark premium + motion
- Vercel.com — grid + tipografi
- Marketku.id — flow fungsional (bukan visual)
