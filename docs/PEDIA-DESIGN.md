# PEDIA-DESIGN.md — Panduan Desain & Style AXVARA PEDIA

> **Status:** 📝 Spesifikasi siap eksekusi (2026-10-07). Pasangan `docs/PEDIA-PRD.md`.
> **Induk:** `docs/DESIGN.md` (design system AXVARA). Dokumen ini HANYA mencatat
> tambahan & pengecualian untuk Pedia. Semua yang tidak disebut di sini mengikuti
> `DESIGN.md` (token warna, glass, font Inter + Space Grotesk via `next/font`,
> motion Apple, skeleton, loading jaringan lambat, aksesibilitas).
> Setelah diimplementasi, ringkas bagian yang live ke `DESIGN.md` (aturan docs hidup).

---

## 1. Prinsip desain Pedia

1. **Satu keluarga, beda kamar.** Pembeli harus langsung merasa "ini Axvara" (midnight, kaca, Prism, cyan), tapi tahu ini ruangan lain (aksen violet, wordmark PEDIA).
2. **Tiga keputusan saja.** Layanan → Jumlah → Kualitas. Semua yang lain sudah terisi atau tersembunyi sampai dibutuhkan.
3. **Bahasa manusia, bukan bahasa panel.** Tidak ada HQ, LQ, R30, drip-feed, refill, emoji deret, atau ID layanan di UI pembeli.
4. **Kejujuran terlihat.** Garansi, perkiraan waktu, dan asal akun tampil sebelum bayar; progres nyata setelah bayar.
5. **Ringan di HP murah.** Kartu berulang memakai `ax-glass-card` (tanpa backdrop blur); animasi hanya `transform`/`opacity`.

---

## 2. Identitas

| Elemen | Spesifikasi |
|---|---|
| Lockup | Mark Prism (`/brand/axvara-mark-prism.svg`) + wordmark `AXVARA` (font 300, tracking `0.22em`) + pemisah tipis + `PEDIA` (font 600, tracking `0.18em`, gradien signature Pedia) |
| Ukuran navbar | Mark 32×28 px, wordmark 13 px (mobile) / 14 px (desktop) |
| Favicon Pedia | Mark Prism dengan isian gradien Pedia (`public/brand/pedia-mark.svg`, file baru) |
| OG image | `public/og/pedia.png` 1200×630: midnight, glow cyan→violet, headline "Tempel link, sisanya beres." + lockup |
| Tagline | "Naikkan sosmedmu, tanpa ribet." |

---

## 3. Warna

### 3.1 Token tambahan (tambahkan di `globals.css` scope `.pedia-root`)

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

### 3.3 Warna tingkat kualitas

| Tingkat | Aksen | Badge |
|---|---|---|
| Hemat | `rgba(241,245,255,0.65)` (netral) | "Termurah" |
| Standar | `--ax-cyan` | "Paling dipilih" (default terpilih) |
| Premium | `--ax-gold` | "Akun Indonesia aktif" |

Kartu tingkat terpilih: border 1.5 px `--px-gradient` (via pseudo-element mask) + latar `--px-violet-soft`.

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
| < 640 | 100% − 32 px | 4 kolom ikon | 1 kolom | 1 kolom + sticky bar bawah |
| 640–1024 | 100% − 48 px | 4 kolom | 2 kolom | 1 kolom + sticky bar |
| ≥ 1024 | max 1120 px | 8 kolom | 3 kolom | 2 kolom: form (7/12) + ringkasan sticky (5/12, `top: 80px`) |

- Radius: kartu 20 px, input & chip 14 px, tombol 14 px, pill 999 px.
- Spasi dasar 4 px; jarak antar-section 56 px (mobile) / 96 px (desktop).
- Safe area: sticky bar & bottom nav memakai `env(safe-area-inset-bottom)`.

---

## 6. Halaman & wireframe

### 6.1 Beranda Pedia (`/`)

```
┌─────────────────────────────────────┐
│ [Prism] AXVARA│PEDIA   [Apps|Pedia|AI•]  │  ← navbar glass-strong sticky
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

## 7. Komponen (`src/components/pedia/*`)

| Komponen | Spesifikasi kunci |
|---|---|
| `PediaNavbar` | `ax-glass-strong`, tinggi 60 px, lockup kiri, `AppSwitcher` tengah (desktop) / kanan (mobile, versi ringkas ikon), tombol "Lacak" kanan |
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

## 8. Motion

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

## 9. Promosi di axvara.tech — `LaunchCards`

Menggantikan `CommunityBar` (`src/app/home-client.tsx`) di posisi yang sama (di bawah hero). Link WA grup & Bot Telegram pindah eksklusif ke HelpSheet + footer.

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
| Navbar axvara.tech | `AppSwitcher` (Apps aktif); di mobile versi ringkas di samping logo |
| `/link` (bio IG) | Tombol kedua dari atas: "Axvara Pedia — naikkan sosmedmu" dengan border gradien Pedia diam |
| Footer "Jelajah" | Link "Axvara Pedia" + badge "Baru" (30 hari) |
| PopupBanner | Banner peluncuran (aset admin) 7 hari pertama, hanya beranda |
| Daily Promo Digest | 1 baris + link (flag) |

---

## 10. Microcopy

### 10.1 Glosarium (supplier → pembeli)
| Istilah supplier | Tampil di Pedia |
|---|---|
| HQ / LQ | (tidak ditampilkan; dibedakan lewat tingkat) |
| Real / Buzzer Real Active | "Akun Indonesia aktif" (hanya tingkat Premium yang memang begitu) |
| Indonesia | "Akun Indonesia" |
| Refill 30 hari / R30 / ♻️ | "Garansi 30 hari" |
| No Refill / Tidak Bergaransi | "Tanpa garansi" |
| Drip-feed | (tidak ditawarkan fase 1) |
| Start count / remains | "Mulai dari X" / "Tersisa Y" |
| Partial | "Selesai sebagian" |
| Matikan Flag For Review | "Matikan 'Tandai untuk ditinjau'" + tutorial |

### 10.2 Teks kunci
| Lokasi | Teks |
|---|---|
| Hero | "Tempel link, sisanya beres." / "Followers, likes, dan views untuk Instagram, TikTok, YouTube, dan lainnya. Bayar QRIS, mulai dalam hitungan menit." |
| Placeholder input | "Tempel link profil atau postingan…" |
| Trust strip | "Bayar QRIS" · "Mulai ±5 menit" · "Garansi refill" · "Sisa dana kembali otomatis" |
| Bayar | "Bayar QRIS · Rp12.000" |
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
| Produk/tingkat nonaktif | Kartu abu 60% opacity + "Sedang tidak tersedia", tidak bisa dipilih |
| Pedia belum dibuka (`PEDIA_ORDERS_ENABLED=false`) | Tombol Bayar diganti "Segera dibuka" (disabled + teks penjelas), katalog tetap bisa dilihat |
| Error quote (harga berubah) | Banner kuning: "Harga baru saja diperbarui jadi RpX. Lanjutkan?" + tombol |
| Error umum | Pesan + "Coba lagi"; tidak ada teks teknis/HTTP code |

---

## 12. Aksesibilitas (wajib)

- Kontras: teks muted di atas midnight ≥ 4.5:1 (`rgba(241,245,255,0.65)` lulus); violet teks pakai `--px-violet-strong`.
- `TierSelector` & `QuantityChips` = `role="radiogroup"` dengan panah keyboard; label menyebut harga ("Standar, Rp12.000, akun Indonesia, garansi 30 hari").
- Hasil deteksi link diumumkan via `aria-live="polite"`.
- Sticky bar tidak menutupi fokus (spacer + `scroll-padding-bottom: 96px`).
- Modal/sheet memakai `useModalA11y` (Escape, focus trap, scroll lock).
- Semua gambar tutorial punya `alt` deskriptif langkah demi langkah.

---

## 13. Checklist QA visual (Obscura, sebelum flag dinyalakan)

1. Beranda Pedia 360×740 & 1440×900: hero, input, grid platform, kartu, footer — screenshot nonblank.
2. Tempel link IG post → chip deteksi + saran tampil.
3. Halaman order: ganti jumlah & tingkat, buka sheet perbandingan, checklist belum lengkap → fokus berpindah.
4. Status pesanan (mock): menunggu bayar, berjalan 62%, selesai sebagian + kartu kredit, needs_check.
5. axvara.tech beranda: LaunchCards menggantikan CommunityBar, animasi jalan, `prefers-reduced-motion` → diam.
6. App Switcher di kedua navbar, keyboard bisa berpindah opsi.
7. Lighthouse mobile beranda Pedia ≥ 85, tidak ada request ke domain pihak ketiga.
