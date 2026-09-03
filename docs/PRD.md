# PRD — AXVARA

**Product:** AXVARA — Gerbang Semua Tools Premium  
**Tagline:** Satu Gerbang, Semua Tools Premium  
**Version:** 1.0 — Pre-Build  
**Status:** Draft Approved — Menuju MVP  
**Platform:** Cloudflare Pages (Free) + D1 + R2  
**Tanggal:** 31 Agustus 2026  
**Author:** Axvara Team + AI Architect  

---

## 1. Overview

### 1.1 Ringkasan Produk
AXVARA adalah website toko digital premium untuk menjual **Aplikasi Premium, AI Gateway, Akun AI Premium (ChatGPT Plus, Claude Pro, Midjourney, dll), Tools Premium, dan Bundle Kucing**.

Inspirasi fungsional dari **marketku.id** (katalog → keranjang → checkout → konfirmasi manual), tapi dengan **level desain 10x lebih premium** setara Apple Store — glassmorphism, animasi halus, dan checkout super simpel.

**Bedanya dengan Marketku.id:**
- Desain: Apple Store minimalis + glassmorphism, bukan template marketplace kaku
- Pembayaran: Tanpa payment gateway mahal. **Transfer manual & QRIS statis** langsung ke rekening pemilik (tanpa potongan 1-2%)
- Hosting: **Gratis selamanya** di Cloudflare Pages — unlimited bandwidth, CDN Indonesia super cepat, tanpa ngurus VPS
- Fokus niche: Digital goods (lisensi/key/akun), bukan fisik

### 1.2 Tujuan Produk
- Menjadi toko digital premium yang terlihat **mahal & terpercaya** sehingga konversi lebih tinggi untuk produk digital 50rb–1jt
- Checkout **paling simpel** untuk pembeli awam: pilih produk → pilih Transfer/QRIS → upload bukti → selesai (tanpa daftar ribet)
- Admin bisa kelola pesanan **dari HP** — cukup cek mutasi DANA/Bank lalu klik konfirmasi, lisensi otomatis terkirim via WA
- Biaya operasional **Rp 0/bulan** (diluar domain ~Rp 230rb/tahun)

### 1.3 Target User

| Persona | Deskripsi | Kebutuhan Utama |
|---------|-----------|-----------------|
| **Pembeli Umum** | Mahasiswa, freelancer, creator, pekerja yang butuh tools AI murah | Cari produk cepat, lihat harga jelas, bayar via QRIS/DANA/Gopay/Shopeepay dalam 30 detik, dapat akun/lisensi via WA |
| **Pembeli Langganan** | Pelanggan bulanan AI Gateway / akun premium | Re-order cepat, riwayat pesanan, perpanjangan 1 klik |
| **Admin / Owner (Kamu)** | Pemilik Axvara | Tambah/edit produk, upload foto & QRIS, lihat pesanan pending/lunas, konfirmasi manual, kirim lisensi, lihat laporan omzet |

### 1.4 Glossary

- **QRIS Statis:** QR Code Standar Nasional milik Brotherstore06 (NMID: ID1022191087959) — satu QR untuk semua e-wallet/bank
- **Transfer Manual:** Pembeli transfer ke e-wallet 082135277434 (DANA/Gopay/Shopeepay) atau SeaBank 901812349386 a.n. pemilik
- **Bukti Transfer:** Foto/screenshot yang di-upload pembeli setelah bayar
- **Pesanan Pending:** Pesanan menunggu verifikasi admin
- **Glassmorphism:** Efek kaca blur transparan ala Apple/macOS
- **Vault:** Metafora brand Axvara — gerbang akses ke semua tools premium
- **Kontak Admin:** WhatsApp dukungan `089519388264`; berbeda dari nomor e-wallet tujuan pembayaran `082135277434`

---

## 2. Requirements

### 2.1 Functional — Pembeli (Storefront)

| ID | Requirement | Prioritas |
|----|-------------|-----------|
| FR-S1 | Pengunjung bisa melihat homepage hero premium + search + kategori + produk unggulan tanpa login | P0 MVP |
| FR-S2 | Katalog produk dengan grid Apple-style, filter kategori (AI Gateway, Akun Premium, Tools Pro, Bundle Kucing), search, dan sorting | P0 MVP |
| FR-S3 | Halaman detail produk: galeri gambar, harga (diskon/coret), stok, deskripsi, benefit, tombol Tambah ke Keranjang & Beli Langsung | P0 MVP |
| FR-S4 | Keranjang slide-drawer dari kanan (tanpa pindah halaman), ubah qty, hapus item, lihat subtotal | P0 MVP |
| FR-S5 | Checkout 1 halaman: data pembeli (nama, WA, email opsional) → pilih metode pembayaran (Transfer E-Wallet / SeaBank / QRIS) → ringkasan order | P0 MVP |
| FR-S6 | Jika pilih E-Wallet: tampilkan nomor 082135277434 + nama pemilik + tombol Copy + instruksi | P0 MVP |
| FR-S7 | Jika pilih SeaBank: tampilkan 901812349386 + instruksi | P0 MVP |
| FR-S8 | Jika pilih QRIS: tampilkan gambar QRIS Brotherstore06 full-size + tombol Download QR + instruksi scan | P0 MVP |
| FR-S9 | Pembeli wajib upload bukti transfer (JPG/PNG, max 5MB) untuk membuat pesanan | P0 MVP |
| FR-S10 | Setelah order sukses: halaman Terima Kasih + nomor pesanan (AXV-XXXX) + WA admin + status Pending | P0 MVP |
| FR-S11 | Pembeli bisa cek status pesanan via nomor WA / kode pesanan (tanpa login) | P1 |
| FR-S12 | Notifikasi WA otomatis ke pembeli saat admin konfirmasi lunas (kirim lisensi) | P1 |
| FR-S13 | Wishlist & histori pesanan jika pembeli login (opsional, email/WA OTP) | P2 |

### 2.2 Functional — Admin

| ID | Requirement |
|----|-------------|
| FR-A1 | Admin login terpisah di `/admin` (email + password, rate-limited) |
| FR-A2 | Dashboard admin: total pesanan, pending, lunas, omzet hari/bulan, produk terlaris |
| FR-A3 | CRUD Produk: tambah/edit/hapus, upload foto (ke R2), set harga, diskon, kategori, stok, deskripsi, status aktif/nonaktif |
| FR-A4 | Kategori management: AI Gateway, Akun Premium, Tools Pro, Bundle Kucing (bisa tambah) |
| FR-A5 | Manajemen Pesanan: list semua pesanan (filter Pending/Lunas/Dibatalkan), detail pesanan + foto bukti transfer, tombol Konfirmasi Lunas / Batalkan |
| FR-A6 | Saat konfirmasi: admin bisa input catatan/lisensi/key yang akan dikirim ke pembeli |
| FR-A7 | Upload & ganti gambar QRIS statis (1 file, tampil di checkout) |
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
| FR-SYS5 | Kirim notifikasi WA via WA Gateway (Fonnte/Wablas) atau link WA manual jika gateway belum ada |
| FR-SYS6 | SEO basic: meta title/description per produk, sitemap, OG image |

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
   - [x] QRIS — tampil gambar QRIS Brotherstore06 (downloadable)
8. Total: Rp 89.000 → Klik "Buat Pesanan"
9. Upload Bukti Transfer (wajib) → Klik "Konfirmasi Pembayaran"
10. → Halaman Sukses: "Pesanan AXV-20260831-0012 Pending — Admin akan verifikasi 5-15 menit, cek WA kamu"
11. (Background) Admin dapat notif WA + lihat di /admin/orders
12. Admin cek mutasi DANA/Bank → klik "Konfirmasi Lunas" + input lisensi
13. Pembeli dapat WA: "Pesanan kamu lunas! Ini akses ChatGPT Plus: ..."
```

### 3.2 Flow Pembeli — Batal / Error

- Jika upload bukti gagal (file >5MB / bukan gambar) → error inline, tetap di halaman checkout
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
  → Kadaluarsa (otomatis 24 jam jika belum dikonfirmasi; stok dikembalikan)
```

---

## 4. Katalog Awal (Seed Data)

Kategori:
- **AI Gateway** — akses gateway GPT-4o, Claude, Gemini hemat token
- **Akun Premium** — ChatGPT Plus, Claude Pro, Midjourney, Perplexity Pro, CapCut Pro
- **Tools Pro** — Canva Pro, Adobe CC, Notion Plus, Grammarly
- **Bundle Kucing** — paket 3-in-1 AI, paket creator

MVP seed: 8–12 produk dummy dengan foto placeholder premium + harga realistis (Rp 25.000 – Rp 350.000)

---

## 5. Payment Spec — Manual Transfer & QRIS Statis

### 5.1 Metode Aktif (V1)
- **E-Wallet:** DANA / Gopay / Shopeepay → **082135277434** (1 nomor untuk semua)
- **Bank:** SeaBank → **901812349386**
- **Bank lain menyusul:** field dinamis di admin, bisa tambah BCA/Mandiri/BRI tanpa deploy
- **QRIS:** Gambar statis Brotherstore06 NMID ID1022191087959 A01 — file di `public/qris/axvara-qris.png` + uploadable dari admin (disimpan di R2)

### 5.2 Aturan
- Tidak ada auto-verifikasi mutasi di MVP (manual cek)
- Upload bukti wajib (kecuali admin set optional di P1)
- Satu pesanan bisa pakai 1 metode saja
- Harga, stok, dan rekening dikunci dalam quote server bertanda tangan selama 60 menit; retry quote yang sama tidak membuat order ganda
- Stok direservasi ketika order Pending dibuat dan dikembalikan jika Dibatalkan/Kadaluarsa
- Gambar QRIS tampil full-res, bisa di-zoom & download
- Instruksi pembayaran tampil jelas di checkout: "Buka DANA/Gopay/Shopeepay/Banking → Scan QRIS / Transfer ke nomor di atas → screenshot bukti → upload di sini"

### 5.3 Keamanan Payment
- Nomor rekening/QRIS tidak di-hardcode di frontend, diambil dari API `/api/payment-methods`
- File bukti disimpan di R2 dengan nama random (bukan original name), hanya admin yang bisa akses

---

## 6. Scope

### MVP (P0) — 1 Minggu
- Homepage Apple Store premium, katalog, detail produk, keranjang drawer, checkout, upload bukti, halaman sukses
- Admin login, dashboard, CRUD produk/kategori, kelola pesanan Pending/Lunas, upload QRIS
- Deploy ke Cloudflare Pages dengan domain publik tunggal axvara.tech (`axvara.pages.dev` redirect permanen ke domain utama)

### P1 — Minggu 2
- Cek status pesanan via kode, notifikasi WA otomatis (Fonnte), OTP login pembeli, export CSV

### P2 — Next
- Rating/testimoni, kupon diskon, stok lisensi auto-kirim, payment gateway opsional (Midtrans) untuk auto-confirm, affiliate

### Out of Scope MVP
- Login wajib untuk beli, keranjang cross-device, payment gateway, mutasi auto, multi-admin role

---

## 7. Acceptance Criteria (Given/When/Then)

**AC-1 — Checkout QRIS**
- Given pembeli di checkout dengan 1 produk di keranjang
- When pilih QRIS dan klik Buat Pesanan lalu upload bukti PNG 2MB
- Then pesanan tercipta Pending, foto bukti tersimpan di R2, admin melihat pesanan di /admin/orders

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

## Appendix — Referensi

- Inspirasi fungsional: https://marketku.id/
- Inspirasi desain: Apple Store (apple.com/store), Linear.app, Vercel.com
- Hosting: Cloudflare Pages + D1 + R2 — gratis selamanya, unlimited bandwidth
- Kontak pembayaran: E-Wallet 082135277434, SeaBank 901812349386, QRIS Brotherstore06
