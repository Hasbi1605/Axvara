# PEDIA-PRD.md — AXVARA PEDIA (Toko SMM Kurasi)

> **Status:** 📝 Spesifikasi siap eksekusi (2026-10-07). Belum ada kode.
> **Pasangan dokumen:** `docs/PEDIA-DESIGN.md` (panduan desain & style — WAJIB dibaca bersama).
> **Pemilik produk:** owner AXVARA. **Eksekutor:** agent implementasi.
> **Aturan repo tetap berlaku:** `AGENTS.md` (test hijau, CHANGELOG, docs hidup, verifikasi Obscura, deploy hanya via push `main`).

---

## 0. Ringkasan 30 detik

AXVARA PEDIA adalah toko layanan media sosial (followers, likes, views, dsb.)
untuk **orang awam**, tampil di **`pedia.axvara.tech`**, memakai mesin Axvara
yang sudah ada (QRIS DANA, D1, admin, notif Telegram, email Resend). Supplier
tunggal fase 1: **providersmm.id** (API PerfectPanel v2). Dari 576 layanan
supplier, admin **mengkurasi ±20 produk** dengan nama ramah, 3 tingkat kualitas
(Hemat / Standar / Premium), dan paket jumlah tetap.

Pembeda utama: **"Tempel link, sisanya beres."** — pembeli menempel link,
sistem mengenali platform & jenis target lalu menawarkan layanan yang cocok.
Posisi harga: **setara panel, kemudahan setara ritel.**

---

## 1. Keputusan yang dikunci (default — owner boleh mengubah sebelum eksekusi)

| # | Keputusan | Nilai |
|---|---|---|
| D1 | Domain | `pedia.axvara.tech` (project Pages yang SAMA, dipetakan middleware ke route `/pedia/*`) |
| D2 | Aksen sub-brand | Violet `#8B5CF6`, gradien signature cyan → violet (detail `PEDIA-DESIGN.md`) |
| D3 | Login | **Fase 2** (dikunci owner 2026-10-07). Fase 1 = order tanpa login (tamu). Setelah Fase 2, tamu TETAP bisa order; member mendapat benefit §4 Fase 2 |
| D4 | Refund partial/cancel fase 1 | **Kode Kredit Pedia** otomatis (dikirim email + tampil di halaman pesanan), bisa dipakai di checkout Pedia berikutnya |
| D5 | Margin | Per kelompok produk (§7), bukan rata |
| D6 | Supplier | providersmm.id saja; skema siap multi-supplier |
| D7 | API key supplier | HANYA di VPS proxy (`wr-proxy.axvara.tech`), tidak pernah di Pages |
| D8 | Pembayaran | QRIS dinamis DANA (engine existing). Metode manual tidak ditawarkan |
| D9 | Bahasa | Indonesia, sapaan "kamu" |

---

## 2. Tujuan & ukuran keberhasilan

**Tujuan bisnis:** lini pendapatan kedua di luar aplikasi premium, margin rata-rata ≥ 40%, tanpa menambah beban operasional harian admin.

| Metrik (30 hari pasca-launch) | Target |
|---|---|
| Order lunas Pedia | ≥ 150 |
| Konversi halaman order → bayar | ≥ 25% |
| Waktu dari buka beranda Pedia → QRIS tampil | median ≤ 45 detik |
| Order yang butuh campur tangan admin | ≤ 5% |
| Komplain "salah layanan / bingung" | ≤ 2% order |
| Klik kartu promo Pedia di axvara.tech | CTR ≥ 4% sesi beranda |
| Kuota D1 tambahan dari Pedia | ≤ 300 ribu rows_read/hari |

**Bukan tujuan fase 1:** login, saldo/deposit, API untuk reseller, top-up game, multi-supplier failover otomatis, komentar custom (fase 1b).

---

## 3. Persona

1. **Seller online UMKM (utama)** — jual di IG/TikTok/Shopee, ingin akun terlihat ramai. Tidak paham istilah "HQ/LQ/R30/drip-feed". Belanja Rp5–50 ribu, sering ulang.
2. **Kreator pemula** — ingin video naik views/likes. Mobile-only, sabar 1 menit maksimal.
3. **Pembeli Axvara existing** — sudah percaya merek, datang dari kartu promo di axvara.tech.

Implikasi desain: mobile-first, tanpa jargon, maksimal 3 keputusan sebelum bayar (layanan, jumlah, kualitas).

---

## 4. Ruang lingkup per fase

### Fase 1 — MVP (target eksekusi pertama)
- Situs Pedia di `pedia.axvara.tech`: beranda, per-platform, halaman order, status pesanan, lacak, bantuan & ketentuan.
- Tempel link → deteksi platform & jenis target → rekomendasi layanan.
- ±20 produk kurasi, 3 tingkat kualitas, paket jumlah + jumlah bebas.
- Checkout tamu: No. WA + email (wajib) + centang S&K → QRIS DANA.
- Kirim order ke supplier otomatis setelah lunas (exactly-once, §9.4).
- Status & progres live, tombol Refill bila garansi berlaku.
- Partial/cancel → Kode Kredit Pedia otomatis + email.
- Sinkron harga & status layanan supplier (diff VPS), nonaktif otomatis bila margin habis.
- Admin tab **Pedia**: kurasi, harga, antrean, kredit, saldo supplier.
- Notif Telegram admin: `Lunas — Pedia`, saldo supplier menipis, order perlu dicek.
- Promosi di axvara.tech: kartu peluncuran menggantikan `CommunityBar`, app switcher di navbar, tombol di `/link`.

### Fase 1b (setelah 2 minggu stabil)
- Komentar custom (tipe `Custom Comments`, textarea 1 komentar per baris).
- Pengingat refill otomatis (email H+7 bila jumlah turun).

### Fase 2
- Login Google (OIDC) + OTP email + Cloudflare Turnstile.
- Saldo akun + deposit QRIS, refund otomatis ke saldo, kode kredit lama bisa diklaim ke saldo.
- Riwayat & link favorit, order ulang 1 klik, refill 1 klik dari riwayat.
- Benefit harga member (dikunci owner 2026-10-07, keduanya): **bonus deposit** (default +5% untuk deposit ≥ Rp100.000, diatur admin) **dan diskon member khusus kelompok G1/G2** (default 5%, TIDAK berlaku G3 karena margin tipis). Guard margin §7.2 dihitung SETELAH diskon member.
- Ajakan daftar halus di halaman sukses & email kredit ("Daftar supaya sisa dana langsung masuk saldo"); tamu tidak pernah dipaksa login.

### Fase 3
- Top-up game (Digiflazz, fallback Sekalipay) di dalam Pedia dengan saldo yang sama.

---

## 5. User flow

### 5.1 Alur utama (tamu, mobile)

```
axvara.tech  ──klik kartu "Axvara Pedia"──▶  pedia.axvara.tech
   │
   ▼
[Beranda] Tempel link ──▶ deteksi: "Instagram · Postingan"  (atau pilih platform manual)
   │
   ▼
[Pilih layanan] kartu: Likes / Views / Komentar*  (*fase 1b)
   │
   ▼
[Halaman order]
   1 Target (sudah terisi dari link)  →  2 Jumlah (chip)  →  3 Kualitas (Hemat/Standar/Premium)
   4 Cek sebelum bayar (checklist)    →  5 Kontak (WA + email)  →  [Bayar QRIS · Rp X]
   │
   ▼
[/pesanan/AXP-…]  QRIS 15 menit  ──lunas (QRIS Hook)──▶  "Diproses" ──▶ progres live ──▶ "Selesai"
                                                              └─ partial/cancel ─▶ Kode Kredit + email
```

### 5.2 Aturan alur
- Link boleh ditempel di beranda ATAU di halaman order; keduanya memakai parser yang sama (§9.6).
- Jika link tidak dikenali → tetap boleh lanjut via pilihan platform manual; field target menampilkan contoh format layanan terpilih.
- Pilihan jumlah default = paket kedua termurah (contoh 250) — terbukti menaikkan nilai order tanpa memaksa.
- Kualitas default = **Standar** (badge "Paling dipilih").
- Checklist sebelum bayar WAJIB dicentang semua sebelum tombol Bayar aktif-fungsional (pola sama dengan S&K checkout: klik saat belum lengkap → scroll + fokus ke item yang belum).
- Kode Kredit dapat dimasukkan di halaman order (field terlipat "Punya kode kredit?").
- Total = 0 setelah kredit → order lunas tanpa QRIS (`payment_method = 'pedia_credit'`).

### 5.3 Status pesanan (bahasa pembeli)

| Status internal | Label pembeli | Penjelasan di layar |
|---|---|---|
| `awaiting_payment` | Menunggu pembayaran | QRIS + hitung mundur |
| `paid` / `queued` | Pembayaran diterima | "Pesananmu masuk antrean, mulai dalam beberapa menit." |
| `submitted` / `pending` (supplier) | Diproses | "Sedang dimulai." |
| `in_progress` | Berjalan | Cincin progres + jumlah masuk |
| `completed` | Selesai | Ringkasan + tombol Refill bila berlaku |
| `partial` | Selesai sebagian | Jumlah masuk + Kode Kredit sisa dana |
| `canceled` | Dibatalkan supplier | Kode Kredit penuh + alasan umum |
| `needs_check` | Sedang kami cek | "Ada kendala teknis, admin sedang memeriksa. Tidak perlu order ulang." |
| `expired` | Kedaluwarsa | "QRIS habis waktu. Silakan order ulang." |

---

## 6. Kebutuhan fungsional

Kode `PD-xx`. Semua wajib fase 1 kecuali ditandai.

### Storefront
- **PD-01** Beranda Pedia dengan hero "Tempel link" + grid platform + produk terlaris + cara kerja 3 langkah + FAQ + strip kepercayaan.
- **PD-02** Parser link client+server (§9.6) → platform, jenis target (`profile|post|video|reel|live|channel|playlist`), target ternormalisasi, username tampilan.
- **PD-03** Halaman per platform `/p/[platform]`: produk dikelompokkan per jenis (Followers, Likes, Views…).
- **PD-04** Halaman order `/o/[slug]` satu halaman + sticky bar total (spesifikasi `PEDIA-DESIGN.md` §6).
- **PD-05** Pilihan tingkat kualitas: hanya tingkat yang aktif yang tampil; jika hanya 1 tingkat, selector disembunyikan.
- **PD-06** Jumlah: chip paket dari admin + input bebas (dalam min–max layanan, kelipatan `step` produk). Harga dihitung ulang realtime di client, divalidasi server via quote.
- **PD-07** Estimasi waktu mulai & selesai per tingkat (field admin, opsional diisi dari Monitor providersmm).
- **PD-08** Checklist pra-bayar per produk (akun publik, jangan ganti username, matikan "Tandai untuk Ditinjau" untuk IG Followers) + tutorial bergambar terlipat.
- **PD-09** Guard link ganda: tolak order baru untuk (`target_normalized`, `product_id`) yang masih aktif (`queued…in_progress`) → pesan "Link ini masih diproses pesanan AXP-…, tunggu selesai dulu ya."
- **PD-10** Kontak: No. WA (format ID) + email wajib, centang S&K Pedia.
- **PD-11** Field Kode Kredit (terlipat), validasi server, sisa kredit tetap tersimpan bila tidak habis.
- **PD-12** Halaman status `/pesanan/[code]` versi Pedia: QRIS (komponen existing), timeline, cincin progres, tombol Refill, blok Kode Kredit.
- **PD-13** Lacak `/lacak`: kode + No. WA/email (pakai verifikasi `POST /api/orders/lookup` existing, diperluas untuk order Pedia).
- **PD-14** Bantuan & Ketentuan Pedia (`/bantuan`, `/ketentuan`): S&K khusus SMM (§11).
- **PD-15** Ticker "baru saja dipesan" dari order lunas asli 24 jam terakhir, target disamarkan (`@ma***a`), tanpa data palsu; disembunyikan bila < 5 order/24 jam.
- **PD-16** Navbar Pedia dengan App Switcher (Apps · Pedia · AI "Segera") + bottom nav mobile (Beranda · Layanan · Pesanan · Bantuan).
- **PD-17** SEO: metadata per halaman, `sitemap.xml` & `robots.txt` khusus host pedia, JSON-LD `Service` + `FAQPage`; `/pesanan/*` noindex.

### Order & supplier
- **PD-20** Quote bertanda tangan (pola `api/checkout` existing) memuat `product_id`, `tier_id`, `quantity`, `target_normalized`, `unit_price`, `total`, `supplier_service_id`, `supplier_rate_snapshot`; berlaku 30 menit.
- **PD-21** Order dibuat idempoten (kunci = hash quote + kontak) di tabel `orders` existing (`order_kind='pedia'`) + baris `pedia_order_items`.
- **PD-22** Setelah lunas: item → `queued`; dispatch ke supplier oleh cron lite job `pedia_orders` (§9.4).
- **PD-23** Poll status batch (≤100 order/panggilan) tiap tick cron lite untuk item aktif; simpan `start_count`, `remains`, `charge`, status.
- **PD-24** Partial/Canceled → hitung refund `floor(total × remains / quantity)` (canceled = total penuh) → terbitkan Kode Kredit (idempoten per item).
- **PD-25** Refill: tombol tampil jika produk `refill_days > 0`, status `completed|partial`, dalam masa garansi, dan refill terakhir ≥ 24 jam lalu. Server memanggil `refill` supplier; status refill dilacak.
- **PD-26** Timeout/ambigu saat `add` → `needs_check`, TIDAK diulang otomatis (§9.4).

### Katalog & harga
- **PD-30** Sinkron layanan supplier via diff VPS (§9.3) ke `pedia_supplier_services`.
- **PD-31** Harga jual dihitung dari rate terkini × markup kelompok, dibulatkan (§7.2). Disimpan di produk (bukan dihitung tiap request).
- **PD-32** Guard margin: bila `harga_jual − modal < min_profit` setelah rate naik → tingkat dinonaktifkan otomatis + notif Telegram admin. Pulih otomatis hanya jika admin mengaktifkan ulang.
- **PD-33** Layanan supplier hilang dari daftar → tingkat terkait nonaktif + notif.
- **PD-34** Tiap tingkat boleh punya `backup_service_id` (dipakai admin manual, bukan failover otomatis fase 1).

### Admin
- **PD-40** Tab admin **Pedia** dengan sub-tab: Produk · Layanan Supplier · Pesanan · Kredit · Pengaturan (detail §10).
- **PD-41** Penjelajah layanan supplier (576): cari, filter platform/Indonesia/garansi, tombol "Pakai di produk".
- **PD-42** Antrean `needs_check` dengan aksi: *Cek saldo supplier*, *Tandai sudah dibuat (isi ID supplier)*, *Kirim ulang (konfirmasi ganda)*, *Batalkan + terbitkan kredit*.
- **PD-43** Saldo providersmm tampil di header tab + alert Telegram < ambang (default Rp100.000).
- **PD-44** Pesanan Pedia muncul di panel **Pesanan** global dengan filter "Jenis: Pedia".
- **PD-45** Dashboard untung (existing) menghitung Pedia: modal = `supplier_charge` riil (fallback snapshot rate × qty).

### Notifikasi
- **PD-50** Email pembeli (shell bermerek existing): tanda terima lunas, selesai, selesai sebagian/dibatalkan + Kode Kredit, refill diproses.
- **PD-51** Telegram admin (`TELEGRAM_ADMIN_CHAT_ID`): `Lunas — Pedia` (sekali per order), `Pedia perlu dicek`, `Saldo providersmm menipis`, `Produk Pedia dinonaktifkan otomatis`.

### Integrasi axvara.tech
- **PD-60** `CommunityBar` diganti `LaunchCards` (Pedia Live + AI Segera) — spesifikasi `PEDIA-DESIGN.md` §9.
- **PD-61** App Switcher juga tampil di navbar axvara.tech.
- **PD-62** Tombol "Axvara Pedia" di `/link`, link di footer "Jelajah", satu baris di Daily Promo Digest (flag terpisah `PEDIA_PROMO_DIGEST_ENABLED`, default false).
- **PD-63** Semua link lintas-situs memakai `?utm_source=axvara&utm_medium=<lokasi>`.
- **PD-64** Link WA grup & Bot Telegram tetap ada di HelpSheet + footer (tidak hilang).

---

## 7. Kurasi & harga

### 7.1 Model data kurasi
```
Produk (contoh: "Followers Instagram")
  ├─ platform: instagram · target_kind: profile · step: 10
  ├─ paket: [100, 250, 500, 1000]
  └─ Tingkat
       ├─ Hemat    → service #948  (akun global, tanpa garansi)
       ├─ Standar  → service #86   (akun Indonesia, garansi 30 hari)   ← default
       └─ Premium  → service #24   (akun Indonesia aktif)
```
Satu produk = satu kebutuhan pembeli. Tingkat = pilihan kualitas. Nama layanan supplier TIDAK pernah tampil ke pembeli.

### 7.2 Aturan harga
```
modal_per_unit   = supplier_rate / 1000                    (rate IDR per 1K dari API)
harga_mentah     = qty × modal_per_unit × (1 + markup_pct/100)
harga_mentah     = max(harga_mentah, qty × modal_per_unit + min_profit_rp)
harga_jual       = bulatkan_ke_atas(harga_mentah, < Rp10.000 → Rp100 ; ≥ Rp10.000 → Rp500)
harga_jual       = max(harga_jual, PEDIA_MIN_ORDER_RP)     (default Rp1.000)
```
Paket chip menampilkan harga paket hasil rumus di atas (dihitung saat sinkron, disimpan di `pedia_tiers.package_prices_json`). Jumlah bebas memakai rumus yang sama di server saat quote.

| Kelompok | Contoh | `markup_pct` default | `min_profit_rp` | Plafon harga |
|---|---|---|---|---|
| G1 Komoditas (views, likes global, FB followers) | Views TikTok, Likes IG Hemat | 150 | 500 | ≤ 90% harga Keranjangindo |
| G2 Real/Aktif Indonesia | Followers IG Premium | 60 | 2.000 | ≤ 95% Keranjangindo |
| G3 Followers bergaransi & subscriber | Followers IG Standar, Subscriber YT | 20 | 1.000 | ≈ Keranjangindo |

Plafon adalah panduan kurasi manual (admin mengecek), bukan logika kode.

### 7.3 Kurasi awal (data API providersmm 2026-10-07, rate IDR per 1K)

> Eksekutor mengisi via admin/seed **migrasi data terpisah** dengan `supplier_service_id` di bawah. Harga final mengikuti rumus §7.2; WAJIB dicek ulang setelah uji order (lihat §14 tugas pra-launch).

| Produk | Tingkat | Service # | Rate | Garansi (kurasi) | Kelompok |
|---|---|---|---|---|---|
| Followers Instagram | Hemat | 948 | 22.968 | – | G3 |
| | Standar | 86 | 38.750 | 30 hari | G3 |
| | Premium | 24 | 100.000 | – (akun aktif) | G2 |
| Likes Instagram | Hemat | 701 | 928 | – | G1 |
| | Standar | 541 | 27.000 | 30 hari (Indonesia) | G2 |
| Views Reels Instagram | Standar | 802 | 1.194 | – | G1 |
| Views TikTok | Hemat | 651 | 1.050 | – | G1 |
| | Standar | 82 | 1.500 | 30 hari | G1 |
| Likes TikTok | Hemat | 976 | 11.573 | 30 hari | G1 |
| | Standar | 13 | 30.000 | 90 hari (Indonesia) | G2 |
| | Premium | 17 | 125.000 | – (akun aktif) | G2 |
| Followers TikTok | Hemat | 116 | 53.000 | – (Indonesia) | G3 |
| | Standar | 16 | 75.000 | 30 hari (Indonesia) | G3 |
| | Premium | 18 | 200.000 | – (akun aktif) | G2 |
| Views YouTube | Standar | 984 | 11.875 | 30 hari | G1 |
| Likes YouTube | Standar | 988 | 11.800 | 30 hari | G1 |
| Subscriber YouTube | Standar | 676 | 306.410 | 30 hari | G3 |
| Followers Facebook | Hemat | 958 | 3.377 | – | G1 |
| | Standar | 959 | 3.566 | 30 hari | G1 |
| Views Video/Reels Facebook | Standar | 235 | 1.317 | – | G1 |
| Followers Threads | Hemat | 835 | 8.568 | – | G1 |
| | Premium | 93 | 200.000 | – (akun aktif) | G2 |
| Followers Toko Shopee | Standar | 512 | 7.000 | – (Indonesia) | G1 |
| Plays Spotify Indonesia | Standar | 282 | 10.521 | Seumur hidup (klaim supplier) | G1 |

**Catatan kurasi wajib:**
- Field `refill` API **tidak dapat dipercaya** (113 layanan menyebut garansi di nama tetapi `refill=false`). `refill_days` diisi admin per tingkat; tombol Refill tetap memanggil API dan menampilkan pesan jujur bila supplier menolak.
- `min`/`max` per layanan berasal dari API (contoh #86 max 1.000, #24 max 1.000). Paket di luar rentang otomatis disembunyikan.
- Layanan bertanda "Matikan Flag For Review" → checklist IG wajib (PD-08).
- Member Telegram TIDAK dikurasi fase 1 (modal tidak lebih murah dari pembanding).

---

## 8. Data model (D1)

Migrasi baru `drizzle/migrations/0059_pedia.sql` + salin ke `drizzle/schema.sql` (idempoten). Nomor dicek ulang saat eksekusi (ambil nomor terakhir + 1).

```sql
-- Penanda jenis order di tabel orders existing (tanpa rebuild tabel; CHECK sales_channel tidak disentuh).
ALTER TABLE orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'apps';   -- 'apps' | 'pedia'
CREATE INDEX IF NOT EXISTS idx_orders_kind_created ON orders(order_kind, created_at);

-- Cermin katalog supplier (ditulis diff VPS).
CREATE TABLE IF NOT EXISTS pedia_supplier_services (
  supplier TEXT NOT NULL DEFAULT 'providersmm',
  service_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,                -- Default | Custom Comments | ...
  rate_idr_per_1k REAL NOT NULL,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  api_refill INTEGER NOT NULL DEFAULT 0,
  api_cancel INTEGER NOT NULL DEFAULT 0,
  api_dripfeed INTEGER NOT NULL DEFAULT 0,
  present INTEGER NOT NULL DEFAULT 1,   -- 0 = hilang dari daftar supplier
  first_seen_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (supplier, service_id)
);

-- Produk kurasi.
CREATE TABLE IF NOT EXISTS pedia_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,                 -- followers-instagram
  platform TEXT NOT NULL,                    -- instagram|tiktok|youtube|facebook|threads|shopee|spotify|x|telegram
  metric TEXT NOT NULL,                      -- followers|likes|views|subscribers|plays|members|comments
  target_kind TEXT NOT NULL,                 -- profile|post|video|channel|shop|track
  name TEXT NOT NULL,                        -- "Followers Instagram"
  tagline TEXT,                              -- "Bikin profil terlihat ramai"
  description_md TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]', -- item checklist pra-bayar (id, label, help_md, image)
  packages_json TEXT NOT NULL DEFAULT '[]',  -- [100,250,500,1000]
  step INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  sold_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_products_platform ON pedia_products(platform, is_active, sort_order);

CREATE TABLE IF NOT EXISTS pedia_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier TEXT NOT NULL CHECK (tier IN ('hemat','standar','premium')),
  label_note TEXT,                           -- "Akun Indonesia"
  supplier TEXT NOT NULL DEFAULT 'providersmm',
  supplier_service_id INTEGER NOT NULL,
  backup_service_id INTEGER,
  price_group TEXT NOT NULL CHECK (price_group IN ('G1','G2','G3')),
  markup_pct REAL NOT NULL,
  min_profit_rp INTEGER NOT NULL,
  refill_days INTEGER NOT NULL DEFAULT 0,
  eta_start TEXT,                            -- "±5 menit"
  eta_finish TEXT,                           -- "1–6 jam"
  package_prices_json TEXT NOT NULL DEFAULT '{}', -- {"100":5000,...} hasil rumus §7.2
  rate_snapshot REAL,                        -- rate saat harga terakhir dihitung
  is_active INTEGER NOT NULL DEFAULT 0,
  auto_disabled_reason TEXT,                 -- 'margin'|'service_missing'|NULL
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, tier)
);

-- Item order Pedia (1 order = 1 item di fase 1).
CREATE TABLE IF NOT EXISTS pedia_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  product_id INTEGER NOT NULL REFERENCES pedia_products(id),
  tier_id INTEGER NOT NULL REFERENCES pedia_tiers(id),
  snapshot_json TEXT NOT NULL,               -- nama produk/tingkat/garansi saat beli
  target_raw TEXT NOT NULL,
  target_normalized TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total INTEGER NOT NULL,
  credit_used INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL,
  supplier_service_id INTEGER NOT NULL,
  supplier_rate_snapshot REAL NOT NULL,
  supplier_order_id TEXT,
  supplier_charge REAL,
  start_count INTEGER,
  remains INTEGER,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment','queued','submitting','submitted','in_progress',
    'completed','partial','canceled','needs_check','expired')),
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  last_error TEXT,
  last_polled_at TEXT,
  refund_credit_code TEXT,                   -- kode kredit yang diterbitkan (hash disimpan di pedia_credits)
  refill_last_at TEXT,
  refill_supplier_id TEXT,
  refill_status TEXT,
  notified_paid_at TEXT,
  notified_final_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_items_status ON pedia_order_items(status, last_polled_at);
CREATE INDEX IF NOT EXISTS idx_pedia_items_target ON pedia_order_items(target_normalized, product_id, status);

-- Kode Kredit Pedia (refund tanpa login).
CREATE TABLE IF NOT EXISTS pedia_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT UNIQUE NOT NULL,            -- SHA-256 kode; kode mentah hanya dikirim ke pembeli
  code_hint TEXT NOT NULL,                   -- 4 karakter terakhir, untuk admin
  email TEXT NOT NULL,
  amount INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  source_order_code TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('partial','canceled','admin')),
  expires_at TEXT NOT NULL,                  -- +180 hari
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_order_code, source_kind)
);
CREATE TABLE IF NOT EXISTS pedia_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_id INTEGER NOT NULL REFERENCES pedia_credits(id),
  order_code TEXT,
  delta INTEGER NOT NULL,                    -- negatif = dipakai
  created_at TEXT DEFAULT (datetime('now'))
);

-- Log saldo supplier (berindeks, belajar dari insiden 0057).
CREATE TABLE IF NOT EXISTS pedia_supplier_balance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  balance REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pedia_balance_log ON pedia_supplier_balance_log(supplier, created_at);
```

Penanda di `store_settings`: `pedia_diff_last_at`, `pedia_diff_last_change_at`, `pedia_balance_alert_at`, `cron_lite_pedia_orders_ok_at`.

**Kode order:** prefiks `AXP-` (dibedakan dari `AXV-`), generator existing dengan prefiks parameter.

**Retensi:** item terminal > 180 hari boleh diarsip; log saldo > 30 hari dihapus di job `cleanup`.

---

## 9. Arsitektur teknis

### 9.1 Topologi
```
Pembeli ─▶ pedia.axvara.tech ─┐                      ┌─▶ providersmm.id/api/v2
           axvara.tech ───────┤  Cloudflare Pages     │       ▲
                              │  (Next 15, D1, R2)    │       │ key=PROVIDERSMM_API_KEY
QRIS Hook ─▶ /api/webhook/dana┘     ▲      │          │  VPS AWS proxy (wr-proxy.axvara.tech)
                                    │      └─ /psmm/* ┘   ├─ diff layanan tiap 10 mnt ─▶ POST /api/supplier-sync (source=providersmm)
Worker cron 5 mnt ─▶ /api/cron/lite?job=pedia_orders ─────┘   └─ (stateless untuk order)
```

### 9.2 Routing host
- `src/middleware.ts`: bila `host` = `pedia.axvara.tech` (atau env `PEDIA_HOST`) dan path bukan `/api/*`, `/_next/*`, aset → `NextResponse.rewrite` ke `/pedia${path}`. CSP & header keamanan existing tetap diterapkan.
- Akses `axvara.tech/pedia/*` → redirect 308 ke `pedia.axvara.tech/*` (satu URL kanonis).
- Dev lokal: buka `http://127.0.0.1:3000/pedia` langsung (tanpa rewrite).
- DNS: CNAME `pedia` → `axvara.pages.dev` (proxied) + custom domain Pages. Dikerjakan eksekutor lewat `.cf-credentials`.
- Layout `src/app/pedia/layout.tsx` TIDAK memakai Navbar/Footer/MobileBottomNav toko pusat; pakai komponen `src/components/pedia/*`.
- Cookie & localStorage Pedia memakai prefiks `axp-` (host-only). Keranjang toko pusat tidak dipakai.

### 9.3 Sinkron katalog (diff VPS)
- Repo `axvara-wr-proxy`: modul baru `psmm` — `POST /psmm/:action` (`services|add|status|refill|refill_status|cancel|balance`) dengan header `x-proxy-token`, API key dari `.env` VPS (`PROVIDERSMM_API_KEY`). Body diteruskan apa adanya, key disuntik server-side, tidak pernah di-log.
- Diff tiap 10 menit: ambil `services`, bandingkan dengan state lokal (`diff-state.json` bagian `psmm`), kirim HANYA yang berubah (rate/min/max/hilang/baru) ke `POST /api/supplier-sync` dengan `source: "providersmm"`; heartbeat kosong tiap ≤ 9 menit (pola WR/SK).
- `/api/supplier-sync` cabang `providersmm`: upsert `pedia_supplier_services`, lalu untuk tingkat yang terhubung: hitung ulang `package_prices_json` + jalankan guard margin (PD-32/33). Batas statement per request mengikuti budget existing; penulisan per layanan dalam `d1.batch()`.
- Tidak ada sync penuh dari Pages (tidak ada cron berat). Admin punya tombol **Tarik ulang semua** yang memanggil proxy `services` sekali dan memproses dalam potongan 100.

### 9.4 Dispatch order exactly-once
Job `pedia_orders` di `/api/cron/lite` (pola `wr_orders`), budget statement & deadline existing:
1. **Klaim:** `UPDATE pedia_order_items SET status='submitting', lease_until=+3 menit, submit_attempts=submit_attempts+1 WHERE id=? AND status='queued'` (cek `changes=1`). Maks 10 item per tick.
2. **Kirim:** `POST /psmm/add {service, link, quantity}` timeout 20 dtk.
3. **Respons `{order: N}`** → `submitted`, simpan `supplier_order_id`.
4. **Respons error eksplisit** (`{error: …}`, mis. saldo kurang/link salah) → `queued` kembali bila saldo kurang (+ alert, maks 6 percobaan) ATAU `canceled` + kredit penuh bila error validasi target.
5. **Timeout / 5xx / respons tak terbaca** → `needs_check` (JANGAN kirim ulang). Alert Telegram admin.
6. Lease kedaluwarsa pada status `submitting` → `needs_check` (bukan `queued`).
7. Order lunas memindahkan item `awaiting_payment` → `queued` di titik finalisasi lunas yang sama dengan pembayaran QRIS existing (webhook DANA, retry admin, pelunasan kredit). Cari titik tersebut, tambahkan dispatch per `order_kind`; fulfillment toko pusat tidak tersentuh (`fulfillment_status='not_required'` untuk order Pedia).

### 9.5 Polling status
- Di job yang sama, setelah dispatch: ambil ≤100 item `submitted|in_progress` dengan `last_polled_at` tertua (≥ 4 menit lalu), panggil `status` multi-order sekali.
- Pemetaan status supplier: `Pending|Processing` → `submitted`; `In progress` → `in_progress`; `Completed` → `completed`; `Partial` → `partial`; `Canceled` → `canceled`.
- Transisi terminal (`completed|partial|canceled`) dalam satu `d1.batch()`: update item + terbitkan kredit (bila ada) + `orders.status` + penanda notifikasi.
- Item `in_progress` > 72 jam tanpa perubahan `remains` → flag "lambat" di admin (bukan aksi otomatis).

### 9.6 Parser link (shared `src/lib/pedia/link.ts`, dipakai client & server)
| Platform | Pola dikenali | target_kind | Normalisasi |
|---|---|---|---|
| Instagram | `instagram.com/<user>`, `@user` | profile | `https://www.instagram.com/<user>/` lowercase |
| | `/p/<id>`, `/reel/<id>`, `/tv/<id>` | post / reel | buang query & `igsh` |
| TikTok | `tiktok.com/@user` | profile | |
| | `tiktok.com/@user/video/<id>`, `vt.tiktok.com/<x>`, `vm.tiktok.com/<x>` | video | short link DISIMPAN apa adanya (tidak di-resolve; supplier menerima) |
| YouTube | `youtube.com/@x`, `/channel/<id>` | channel | |
| | `watch?v=`, `youtu.be/`, `/shorts/` | video | ke `https://www.youtube.com/watch?v=<id>` |
| Facebook | `facebook.com/<page>`, `profile.php?id=` | profile | |
| | `/reel/`, `/videos/`, `fb.watch/` | video | |
| Threads | `threads.net/@user` (`threads.com`) | profile/post | |
| Shopee | `shopee.co.id/<shop>` | shop | |
| Spotify | `open.spotify.com/track|album|playlist|artist/<id>` | track | buang `?si=` |
- Validasi kecocokan: `target_kind` link harus sesuai produk (link post ke Followers ditolak dengan saran "Ini link postingan. Mau tambah Likes atau Views?").
- Server memvalidasi ulang; tidak ada fetch ke platform sosial (tanpa scraping, tanpa preview gambar).

### 9.7 Endpoint baru

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| GET | `/api/pedia/catalog` | publik, cache CDN 60 dtk | produk + tingkat aktif (tanpa data supplier) |
| POST | `/api/pedia/quote` | publik + rate-limit scope `pedia_quote` 30/mnt/IP | validasi target, qty, kredit → quote bertanda tangan |
| POST | `/api/pedia/orders` | publik + rate-limit 10/mnt/IP | buat order idempoten + invoice QRIS (atau lunas via kredit) |
| GET | `/api/pedia/orders/[code]` | capability token (pola existing) | status, progres, refill eligibility (tanpa data supplier mentah) |
| POST | `/api/pedia/orders/[code]/refill` | capability token + rate-limit | ajukan refill |
| POST | `/api/pedia/credits/check` | publik + rate-limit 10/mnt/IP | cek kode → sisa (tanpa membocorkan email) |
| GET | `/api/pedia/ticker` | publik, cache 60 dtk | 10 order lunas terbaru tersamarkan |
| * | `/api/admin/pedia/*` | sesi admin | CRUD produk/tingkat, layanan supplier, antrean, kredit, saldo, tarik ulang |
| POST | `/api/supplier-sync` (cabang baru) | `SUPPLIER_SYNC_TOKEN` existing | diff providersmm |
| POST | `/api/cron/lite?job=pedia_orders` | `CRON_SECRET` existing | dispatch + poll + alert saldo (saldo dicek maks 1×/30 mnt) |

Respons publik TIDAK pernah memuat `supplier_service_id`, nama layanan supplier, rate, atau `supplier_order_id`.

### 9.8 Anggaran Cloudflare Free
- Beranda/platform Pedia: SSR membaca katalog (≤ 60 baris) via query berindeks; respons di-cache CDN 60 dtk.
- Job `pedia_orders`: ≤ 2 subrequest proxy + ≤ 25 statement per tick; tanpa parse katalog besar.
- Target total Pedia ≤ 300 ribu rows_read/hari. Semua query baru WAJIB memakai indeks (cek `EXPLAIN QUERY PLAN` di test regresi, pola migrasi 0057).

### 9.9 Env & flag

| Nama | Lokasi | Default | Fungsi |
|---|---|---|---|
| `PEDIA_ENABLED` | Pages secret_text | `false` | Storefront Pedia + rewrite host |
| `PEDIA_ORDERS_ENABLED` | Pages | `false` | Boleh membuat order (false = katalog saja, tombol "Segera dibuka") |
| `PEDIA_DISPATCH_ENABLED` | Pages | `false` | Job kirim ke supplier |
| `PEDIA_HOST` | Pages | `pedia.axvara.tech` | Host rewrite |
| `PEDIA_PROMO_DIGEST_ENABLED` | Pages | `false` | Baris Pedia di Daily Promo Digest |
| `PEDIA_BALANCE_ALERT_RP` | Pages | `100000` | Ambang alert saldo supplier |
| `PEDIA_MIN_ORDER_RP` | Pages | `1000` | Total minimum |
| `PROVIDERSMM_API_KEY` | `.env` VPS proxy SAJA | — | Kunci supplier |
| (existing) `WARUNG_REBAHAN_PROXY_URL` / `_TOKEN` | Pages | — | Dipakai ulang untuk `/psmm/*` (host & token proxy sama) |

Sumber kunci lokal: `axvara/.providersmm-credentials` (git-ignored, chmod 600). JANGAN commit/echo nilainya. Kunci sudah pernah tertempel di chat → **rotasi** di dashboard providersmm setelah VPS terpasang, lalu perbarui file lokal + `.env` VPS.

---

## 10. Admin — tab "Pedia"

Grup sidebar **Katalog**, menu **Pedia**, deep-link `?section=pedia&tab=…`. Gaya Admin UI existing (bukan glass berat).

| Sub-tab | Isi |
|---|---|
| **Produk** | Daftar produk kurasi (urutan ↑↓, aktif/nonaktif, unggulan). Editor: nama, tagline, platform, metric, target_kind, paket, step, deskripsi, checklist. Panel tingkat: service utama/cadangan (pilih dari penjelajah), kelompok harga, markup, min profit, garansi hari, ETA, pratinjau harga per paket + **margin per paket** (merah bila < min profit). Badge "Nonaktif otomatis: margin/hilang". |
| **Layanan Supplier** | Tabel 576 layanan: cari, filter platform/Indonesia/garansi-di-nama/tipe; kolom rate, min, max, "dipakai di"; tombol **Tarik ulang semua**; kartu status diff (cek terakhir, perubahan terakhir — pola `SupplierSyncStatus`). |
| **Pesanan** | Antrean per status; `needs_check` di atas dengan aksi PD-42; detail item: target, qty, start_count, remains, charge, histori. |
| **Kredit** | Daftar kode (hint 4 karakter, email tersamar, sisa, asal, kedaluwarsa); terbitkan kredit manual (`source_kind='admin'`) dengan alasan wajib. |
| **Pengaturan** | Default markup per kelompok, min order, ambang alert saldo, saldo providersmm live + riwayat 7 hari. |

Semua aksi tulis memakai `ConfirmDialog` existing; jam tampil `formatWibDateTime`.

---

## 11. Ketentuan layanan Pedia (isi wajib `/ketentuan`)

1. Layanan meningkatkan angka interaksi; AXVARA tidak menjamin jangkauan, penjualan, atau FYP.
2. Akun/postingan wajib publik dan tidak boleh diganti username/dihapus selama proses. Pelanggaran → pesanan dianggap selesai tanpa kredit.
3. Penurunan jumlah (drop) dapat terjadi. Produk bergaransi berhak refill dalam masa garansi; produk tanpa garansi tidak.
4. Pesanan selesai sebagian/dibatalkan supplier → sisa dana menjadi Kode Kredit Pedia (berlaku 180 hari, hanya untuk belanja di Pedia, tidak dapat diuangkan).
5. Salah memasukkan link yang tetap valid (akun orang lain) bukan tanggung jawab AXVARA.
6. Penggunaan layanan dapat bertentangan dengan ketentuan platform media sosial; risiko akun sepenuhnya pada pembeli.
7. Dilarang untuk konten melanggar hukum, judi, penipuan, politik praktis/kampanye, atau pelecehan. Pesanan semacam itu dibatalkan tanpa kredit.

Copy marketing DILARANG mengklaim "100% aman", "pasti FYP", "anti banned", atau "real" untuk tingkat yang bukan akun aktif.

---

## 12. Non-fungsional

- **Performa:** LCP mobile beranda Pedia ≤ 2,5 dtk (4G throttle, PageSpeed mobile ≥ 85). JS beranda Pedia ≤ 120 KB gzip. Tanpa skrip pihak ketiga.
- **Aksesibilitas:** WCAG 2.2 AA — kontras teks ≥ 4.5:1, target sentuh ≥ 44px, fokus terlihat, semua kontrol bisa keyboard, `prefers-reduced-motion` dihormati.
- **Keamanan:** CSRF Origin (middleware existing), rate-limit per scope, capability token di halaman pesanan, kode kredit disimpan hash, tidak ada data supplier di respons publik, `constantTimeEqual` untuk token.
- **Keandalan:** order lunas tidak boleh hilang atau dobel di supplier (§9.4); setiap status terminal mengirim email tepat sekali.
- **Observabilitas:** log `[pedia] step=… code=…` tanpa PII lengkap; penanda `cron_lite_pedia_orders_ok_at` masuk alarm cron existing (kelas soft).

---

## 13. Acceptance criteria (uji wajib sebelum flag dinyalakan)

**Storefront**
- [ ] AC-01 `pedia.axvara.tech/` render beranda Pedia (tanpa navbar toko pusat); `axvara.tech/pedia` → 308 ke subdomain.
- [ ] AC-02 Tempel `https://www.instagram.com/p/XYZ/?igsh=abc` → terdeteksi "Instagram · Postingan", menawarkan Likes/Views, target ternormalisasi tanpa query.
- [ ] AC-03 Link profil ke produk Likes ditolak dengan saran produk yang benar.
- [ ] AC-04 Ganti tingkat/jumlah → total berubah < 100 ms tanpa request; quote server menyamai total client.
- [ ] AC-05 Tombol Bayar dengan checklist belum lengkap → scroll + fokus ke item pertama yang belum; tidak membuat order.
- [ ] AC-06 Order ke link yang sama + produk yang sama yang masih aktif → ditolak dengan kode pesanan lama.
- [ ] AC-07 Mobile 360×740: semua langkah order terlihat tanpa scroll horizontal; sticky bar tidak menutupi field (spacer).
- [ ] AC-08 `prefers-reduced-motion: reduce` → tidak ada animasi berulang (kartu promo, ticker, shimmer).

**Pembayaran & supplier**
- [ ] AC-10 QRIS lunas (simulasi webhook) → item `queued` → tick cron → `submitted` dengan `supplier_order_id` (mock proxy).
- [ ] AC-11 Mock `add` timeout → item `needs_check`, tidak ada panggilan `add` kedua pada tick berikutnya; alert Telegram terkirim sekali.
- [ ] AC-12 Dua tick paralel tidak mengirim item yang sama dua kali (klaim atomik `changes=1`).
- [ ] AC-13 Status `Partial` remains 40 dari 100, total Rp10.000 → kredit Rp4.000 tepat sekali walau poll diulang.
- [ ] AC-14 Kredit menutup total penuh → order lunas tanpa QRIS, `remaining` berkurang atomik, kredit tidak bisa dipakai ganda pada dua request bersamaan.
- [ ] AC-15 Rate supplier naik melewati margin → tingkat nonaktif + notif; storefront tidak lagi menampilkannya ≤ 60 dtk (cache).
- [ ] AC-16 Respons publik tidak mengandung `supplier_service_id`, rate, nama layanan supplier, atau `supplier_order_id` (test snapshot).

**Integrasi**
- [ ] AC-20 Kartu peluncuran tampil di axvara.tech menggantikan CommunityBar; link WA & Telegram masih ada di HelpSheet + footer.
- [ ] AC-21 App Switcher tampil di kedua navbar, aktif sesuai host.
- [ ] AC-22 Order Pedia muncul di admin Pesanan (filter Jenis: Pedia) dan dihitung di dashboard untung.
- [ ] AC-23 `PEDIA_ENABLED=false` → subdomain menampilkan halaman "Segera hadir" dan kartu promo axvara.tech berstatus "Segera"; tidak ada error.

**Verifikasi repo:** `npx vitest run --run` hijau, type-check bersih, Obscura screenshot beranda/order/status (mobile + desktop) diperiksa, CHANGELOG + ARCHITECTURE + README + DESIGN + PRD (`docs/PRD.md` entri Pedia) diperbarui, `axvara-wr-proxy/AGENTS.md` mencatat kontrak `/psmm/*`.

---

## 14. Rencana eksekusi (milestone untuk agent)

| # | Milestone | Isi | Bergantung |
|---|---|---|---|
| M0 | Proxy VPS | Modul `/psmm/*` + diff 10 mnt di `axvara-wr-proxy`, `.env` VPS `PROVIDERSMM_API_KEY`, deploy sesuai `axvara-wr-proxy/AGENTS.md`, uji `balance` & `services` | — |
| M1 | Skema & sync | Migrasi 0059, cabang `providersmm` di `/api/supplier-sync`, test regresi diff + guard margin + indeks | M0 |
| M2 | Admin Pedia | Sub-tab Layanan Supplier & Produk (kurasi + pratinjau margin), seed kurasi §7.3 (nonaktif) | M1 |
| M3 | Storefront | Routing host, layout & komponen `src/components/pedia/*`, beranda, platform, halaman order, parser link (+test tabel §9.6) | M2 |
| M4 | Checkout & dispatch | Quote, orders, QRIS, finalisasi lunas per `order_kind`, job `pedia_orders` (dispatch + poll), alert | M3 |
| M5 | Pasca-bayar | Halaman status, refill, kredit (terbit/pakai/cek), email, notif Telegram, lacak | M4 |
| M6 | Integrasi pusat | LaunchCards, App Switcher, `/link`, footer, digest (flag) | M3 |
| M7 | QA & launch | Semua AC §13, DNS `pedia`, flag bertahap: `PEDIA_ENABLED` → `PEDIA_ORDERS_ENABLED` (beta internal) → `PEDIA_DISPATCH_ENABLED` | M5, M6 |

**Pra-launch oleh owner:** deposit providersmm Rp100–200 ribu; uji 6–8 layanan §7.3 (catat mulai/selesai/drop H+3); tanya diskon API (WA 0838-7666-3600); setujui harga final; rotasi API key.

Setiap milestone = commit terpisah dengan test + CHANGELOG, push ke `main` (flag tetap mati sampai M7).

---

## 15. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Order dobel di supplier (tanpa idempotency) | §9.4: klaim atomik, timeout → `needs_check`, tidak ada retry otomatis |
| Harga supplier naik diam-diam | Diff 10 mnt + guard margin + notif |
| Saldo supplier habis saat ramai | Alert ambang + item tetap `queued` (dicoba ulang ≤ 6×) + email "sedikit tertunda" bila > 30 mnt |
| Drop tinggi → komplain | Kurasi berbasis uji order + Monitor, garansi jelas, tombol refill self-service |
| Kuota/CPU Cloudflare Free | Kerja berat di VPS, cache CDN katalog, indeks wajib, budget statement |
| Persepsi merek ("jual followers palsu") | Subdomain terpisah, copy jujur, S&K tegas, tanpa klaim berlebihan |
| Risiko merchant QRIS DANA (kategori layanan) | Pantau; siapkan rail GoPay (§16.9 ARCHITECTURE) sebagai cadangan |
| API key bocor | Hanya di VPS, rotasi pasca-setup, tidak di-log |
