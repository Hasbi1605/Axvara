# DESIGN.md — AXVARA Design System

**Tema:** Apple Store + Glassmorphism + Premium Vault  
**Tagline Visual:** Midnight Navy + Electric Cyan Glow  
**Version:** 1.0  
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

### 5.1 Navbar (Apple Style)
- Height 64px, sticky, glass-strong, blur
- Kiri: Logo AXVARA (X sebagai gerbang/vault dengan glow cyan) + wordmark Space Grotesk 700
- Tengah: Search pill glass (icon + placeholder "Cari AI Gateway, ChatGPT Plus...")
- Kanan: Kategori dropdown, Keranjang (icon + badge count cyan), Admin (icon)
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
- Harga: besar cyan, harga coret kecil muted jika diskon
- Tombol: "Tambah" (glass → cyan solid saat hover), icon keranjang
- Hover: border `rgba(0,229,255,0.35)`, glow radial, lift `translateY(-4px)`, shadow cyan soft
- Grid: 1 col mobile, 2 tablet, 3-4 desktop, gap 20px

### 5.4 Keranjang Drawer
- Overlay: `rgba(8,12,30,0.6)` + `backdrop-blur-sm`
- Panel: 420px desktop, full-width mobile, glass-strong, rounded-l-3xl desktop
- Header: "Keranjang (3)" + tombol tutup X
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
- Step: ① Data Pembeli (Nama, WA, Email opsional) → ② Pembayaran → ③ Upload Bukti
- Input: glass input `bg-white/[0.06] border-white/10 rounded-xl h-48px focus:border-cyan/50 focus:ring-cyan/20`
- Payment selector: 3 kartu glass radio (E-Wallet / SeaBank / QRIS) — selected → border cyan + bg cyan/10
- Jika QRIS: tampil QR image rounded-2xl, shadow, tombol "Download QRIS"
- Upload: drag-drop glass area, dashed border, preview thumb, validasi inline
- Tombol submit: cyan solid, full-width, h-52px, rounded-xl, disabled jika form invalid
- Ringkasan pesanan sticky di kanan desktop, di bawah form di mobile

### 5.7 Halaman Sukses
- Icon centang besar cyan glow, headline "Pesanan Diterima!", kode `AXV-20260831-0012` mono, status badge Pending warning
- Instruksi: "Admin verifikasi 5-15 menit, cek WA kamu"
- Tombol: "Lanjut Belanja" + "Hubungi Admin via WA" (link wa.me)

### 5.8 Admin UI (Clean, Bukan Glass Berat)
- Sidebar midnight solid, main area `bg-[#080C1E]`
- Kartu stat: glass subtle, angka besar Space Grotesk
- Tabel pesanan: glass row, status badge (Pending kuning, Lunas hijau), foto bukti thumb klik untuk lightbox
- Form produk: 2 kolom, upload drag-drop, preview, kategori select

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

- **QRIS:** dirender sebagai PNG per order dari payload DANA Business server-only; tidak ada aset QRIS statis publik
- **Logo:** Wordmark "AXVARA" Space Grotesk Bold, X stylized sebagai vault gate (gap di tengah X dengan glow cyan). Versi light di dark bg. SVG.
- **Ikon:** Lucide React (outline, 20px, stroke 1.75)
- **Foto produk:** Placeholder premium via `picsum` / `unsplash` di MVP, nanti upload ke R2

---

## 10. Referensi Visual

- Apple Store: https://www.apple.com/store — hero, kartu, whitespace
- Linear.app — glass + dark premium + motion
- Vercel.com — grid + tipografi
- Marketku.id — flow fungsional (bukan visual)
