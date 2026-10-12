# PEDIA-PRD.md — AXVARA PEDIA (Toko SMM Kurasi)

> **Status working-tree 2026-10-12:** implementasi lokal dua provider + ekosistem/UX, **BELUM deployed** di Pages/proxy; tidak ada flag yang diubah. Audit docs membaca diff/source, bukan bukti seluruh QA terkini sudah lulus. Kredensial/readiness supplier, currency/rate-unit dan kurasi awal data produksi masih pending.
> **Riwayat rollout:** katalog awal dibuka 2026-10-08 di `pedia.axvara.tech`, dengan `PEDIA_ENABLED=true`, order/dispatch ditutup. Overhaul ini tidak mengubah flag atau membuktikan ulang kondisi produksi. AC lama §13 adalah bukti historis, bukan verifikasi deployment baru.
> **Pasangan dokumen:** `docs/PEDIA-DESIGN.md` (panduan desain & style — WAJIB dibaca bersama).
> **Pemilik produk:** owner AXVARA. **Eksekutor:** agent implementasi.
> **Aturan repo tetap berlaku:** `AGENTS.md` (test hijau, CHANGELOG, docs hidup, verifikasi Obscura, deploy hanya via push `main`).

---

## 0. Ringkasan 30 detik

AXVARA PEDIA adalah toko layanan media sosial (followers, likes, views, dsb.)
untuk **orang awam**, tampil di **`pedia.axvara.tech`**, memakai mesin Axvara
yang sudah ada (QRIS DANA, D1, admin, notif Telegram, email Resend). Supplier
internal: **ProviderSMM + IndoSMM** (API PerfectPanel v2), dengan identitas
gabungan provider/service. Rencana awal supplier tunggal dan snapshot 576 layanan
2026-10-07 adalah historis, bukan jumlah katalog current atau bukti IndoSMM siap.
Admin mengkurasi produk AXVARA dengan tingkat Hemat/Standar/Premium bila relevan
dan paket jumlah tetap; tidak otomatis menerbitkan katalog supplier mentah.

UI lokal saat ini **compact dan kurasi-first**: hero "Satu tempat untuk / Layanan sosial media" +
typewriter cyan Termurah / Termudah / Terpercaya (2026-10-12 atas permintaan owner), hingga 8 featured editorial (fallback 6 Jelajahi layanan),
Tampilkan semua/cari/filter menjangkau seluruh produk terbit. Cari lewat link terlipat;
sistem hanya mengenali format, platform & jenis target, bukan keberadaan akun.
Slogan "Tempel link, sisanya beres." adalah konsep awal/arsip aset, bukan hero saat ini.
Posisi harga: **setara panel, kemudahan setara ritel.**

---

## 1. Keputusan yang dikunci (default — owner boleh mengubah sebelum eksekusi)

| # | Keputusan | Nilai |
|---|---|---|
| D1 | Domain | `pedia.axvara.tech` (project Pages yang SAMA, dipetakan middleware ke route `/pedia/*`) |
| D2 | Aksen sub-brand | Midnight/cyan/gold mengikuti Market; violet/gradien awal tetap referensi aset/status, bukan warna pilihan tingkat saat ini |
| D3 | Login | **Fase 2** (dikunci owner 2026-10-07). Fase 1 = order tanpa login (tamu). Setelah Fase 2, tamu TETAP bisa order; member mendapat benefit §4 Fase 2 |
| D4 | Refund partial/cancel fase 1 | **Kode Kredit Pedia** otomatis (dikirim email + tampil di halaman pesanan), bisa dipakai di checkout Pedia berikutnya |
| D5 | Margin | Per kelompok produk (§7), bukan rata |
| D6 | Supplier | ProviderSMM + IndoSMM lokal; tanpa failover otomatis. Keputusan supplier tunggal 2026-10-07 superseded; gate IDR/unit/credentials tetap pending |
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
- Produk kurasi dengan tingkat Hemat/Standar/Premium sesuai ketersediaan dan **paket jumlah terkonfigurasi saja**. Jumlah bebas ditunda: quote bisa menghitungnya, tetapi orders API menolak jumlah tanpa harga paket tersimpan.
- Checkout tamu: No. WA + email (wajib) + centang S&K → QRIS DANA.
- Dispatch setelah lunas dengan CAS submitting + dedupe durable proxy (§9.4), bukan jaminan exactly-once end-to-end.
- Status & progres live, tombol Refill bila garansi berlaku.
- Partial/cancel → Kode Kredit Pedia otomatis + email.
- Sinkron harga & status layanan supplier (diff VPS), nonaktif otomatis bila margin habis.
- Admin tab **Pedia**: kurasi, harga, antrean, kredit, saldo supplier.
- Notif Telegram admin: `Lunas — Pedia`, saldo supplier menipis, order perlu dicek.
- Integrasi lokal: CommunityBar Market = CrossServicePromo Pedia + Bot Telegram Market, kartu ganda Pedia = CrossServicePromo Market + Bot Telegram Market (`PediaServiceCards`), ServicesMenu di kedua navbar, satu Footer bersama, layout Pedia 1280 + hero 1:1 Market. AppSwitcher dihapus; LaunchCards.saved tetap arsip dan kartu Pedia `/link` tetap tersembunyi. Ini bukan pembukaan flag/deployment.

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
[Beranda] Pilihan AXVARA / Jelajahi layanan ──▶ semua / cari / platform (Cari lewat link opsional)
   │
   ▼
[Pilih layanan] kartu: Likes / Views / Komentar*  (*fase 1b)
   │
   ▼
[Halaman order]
   1 Paket & jumlah (radio native) → 2 Tujuan & persyaratan (link + checklist)
   3 Kontak & konfirmasi (WA + email + kredit opsional + S&K)
   Tier & jumlah awal kosong → [Lanjut ke pembayaran] → quote server otomatis
   Nominal berubah / kode kredit → [Setujui & lanjut ke pembayaran] → order
   │
   ▼
[/pesanan/AXP-…]  QRIS 15 menit  ──lunas (QRIS Hook)──▶  "Diproses" ──▶ progres live ──▶ "Selesai"
                                                              └─ partial/cancel ─▶ Kode Kredit + email
```

### 5.2 Aturan alur
- Link boleh ditempel di beranda ATAU di halaman order; keduanya memakai parser yang sama (§9.6).
- Jika link tidak dikenali → tetap boleh lanjut via pilihan platform manual; field target menampilkan contoh format layanan terpilih.
- Tier dan jumlah awal **null**, tanpa radio terpilih atau total order. Ringkasan Belum dipilih; tiap tier tetap punya harga awal + jumlah yang sepadan. Tidak ada default Standar atau badge Paling dipilih.
- Paket quantity belum dapat dipilih sampai tier dipilih. Beralih tier mempertahankan quantity hanya jika tersedia, selain itu reset null; tidak memilih paket atau clamp diam-diam.
- Satu CTA per viewport **Lanjut ke pembayaran** memvalidasi paket, format/platform/jenis target, checklist, WA/email/S&K, lalu meminta quote otomatis. Error inline + fokus pertama invalid; deteksi format bukan verifikasi akun/konten.
- Total paket lokal preview tanpa kredit. Quote yang sama dengan preview tanpa kredit dapat langsung membuat order; **nominal berubah atau input kredit** menghentikan proses sebelum order, menampilkan total/payable server dan CTA **Setujui & lanjut ke pembayaran**. Nominal QRIS termasuk kode unik baru tampil pada halaman pembayaran. Tidak ada tombol Periksa harga terpisah.
- Perubahan tingkat/jumlah/target/kredit/kontak/checklist/S&K membatalkan quote; request quote dibatalkan dan respons usang diabaikan. Client meminta quote baru setelah 29 menit sebelum percobaan order pertama (token server 30 menit).
- Klik order pertama mengunci data dan mencegah klik ganda dari CTA desktop/mobile. Timeout/network/5xx/408/429 atau respons sukses tidak lengkap mempertahankan token + kontak untuk retry pesanan yang sama; 4xx lain membuang quote dan membuka kunci. Ini pagar client, bukan atomisitas penuh backend order/kredit/invoice.
- `PEDIA_ORDERS_ENABLED=false`: pesan singkat dekat CTA disabled; paket/harga bisa dilihat, kontak/email/kredit/S&K tidak dirender. Tidak ada banner order tutup pada beranda atau sebelum judul order.
- Kode Kredit dapat dimasukkan di halaman order (field terlipat "Punya kode kredit?").
- Payable = 0 setelah kredit → order lunas tanpa invoice QRIS; kolom payment_method pada INSERT saat ini tetap qris, bukan pedia_credit.

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
- **PD-01** Beranda compact 1:1 Market (2026-10-12): hero tanpa card (h1 `font-display` 42/56px + typewriter putih, sub 15px, glow section-level, tanpa eyebrow) → kartu ganda Market + Bot Telegram (`PediaServiceCards`, kembar compact) → cari/Cari lewat link terlipat/platform → hingga 8 featured Pilihan AXVARA (tanpa featured fallback 6 Jelajahi layanan tanpa sub-teks) → Tampilkan semua → cara pesan/FAQ. Cari/filter seluruh produk publik. Tidak ada laris/trust strip/ticker; featured editorial bukan bukti kurasi data produksi sudah disetujui. Layout `max-w-[1280px]` 1:1 Market.
- **PD-02** Parser link client+server (§9.6) → platform, jenis target (`profile|post|video|reel|live|channel|playlist`), target ternormalisasi, username tampilan.
- **PD-03** Halaman per platform `/p/[platform]`: produk dikelompokkan per jenis (Followers, Likes, Views…).
- **PD-04** Halaman order `/o/[slug]` satu halaman + sticky bar total (spesifikasi `PEDIA-DESIGN.md` §6).
- **PD-05** Tingkat yang lolos katalog tampil sebagai baris radio native, termasuk bila hanya satu. Catatan kualitas, refill bersyarat, estimasi mulai/selesai dan harga untuk jumlah yang sama; tanpa badge kualitas hardcoded.
- **PD-06** Tier/jumlah awal null; radio native paket admin, hanya paket valid untuk tier terpilih. Tidak ada input bebas; quote server melalui satu CTA, persetujuan eksplisit jika nominal berubah/kredit.
- **PD-07** Estimasi waktu mulai & selesai per tingkat (field admin, opsional diisi dari Monitor providersmm).
- **PD-08** Checklist pra-bayar per produk + teks bantuan di kelompok Tujuan & persyaratan. Field gambar lama dipertahankan admin, tetapi tutorial bergambar belum dirender di order-client saat ini.
- **PD-09** Guard link ganda: tolak order baru untuk (`target_normalized`, `product_id`) yang masih aktif (`queued…in_progress`) → pesan "Link ini masih diproses pesanan AXP-…, tunggu selesai dulu ya."
- **PD-10** Kontak: No. WA (format ID) + email wajib, centang S&K Pedia.
- **PD-11** Field Kode Kredit (terlipat), validasi server, sisa kredit tetap tersimpan bila tidak habis.
- **PD-12** Halaman status `/pesanan/[code]` versi Pedia: QRIS (komponen existing), timeline, cincin progres, tombol Refill, blok Kode Kredit.
- **PD-13** Lacak `/lacak`: kode + No. WA/email (pakai verifikasi `POST /api/orders/lookup` existing, diperluas untuk order Pedia).
- **PD-14** Bantuan & Ketentuan Pedia (`/bantuan`, `/ketentuan`): S&K khusus SMM (§11).
- **PD-15 (tidak dirender)** Endpoint/komponen ticker lama tetap ada, tetapi beranda tidak meminta atau menampilkannya pada overhaul 2026-10-11. Klaim laris tidak digunakan.
- **PD-16** Navbar dengan menu Layanan AXVARA bersama (Market/Pedia saja), navigasi desktop Katalog/Lacak/Bantuan + bottom nav mobile Beranda/Layanan/Pesanan/Bantuan. AppSwitcher lama dihapus, tidak ada placeholder AI.
- **PD-17** SEO: metadata per halaman, `sitemap.xml` & `robots.txt` khusus host pedia, JSON-LD `Service` + `FAQPage`; `/pesanan/*` noindex.

### Order & supplier
- **PD-20** Quote baru JWE `dir/A256GCM`, key SHA-256 `ADMIN_JWT_SECRET`, 30 menit, mengikat provider/service/rate, `refill_days/min_profit_rp` dan field pembelian. Snapshot order mempertahankan ketentuan quote; legacy tanpa field fallback tier. HS256 legacy belum kedaluwarsa tetap diterima, supplier kosong legacy = ProviderSMM; payload legacy masih terbaca sampai expiry.
- **PD-21** Order idempoten memakai `orders.quote_id = pedia:<jti>` (bukan hash kontak), `order_kind='pedia'` + pedia_order_items. Tolak provider/service remapped sejak quote; persist snapshot asal. Konsumsi kredit/order/invoice tidak atomik penuh.
- **PD-22** Setelah lunas: item → `queued`; dispatch ke supplier oleh cron lite job `pedia_orders` (§9.4).
- **PD-23** Poll individual hingga 20 item due/cycle pada provider asal, lease 5 menit; hingga 5 refill_status berbatas budget. Simpan start_count/remains/status; charge saat add adalah estimasi rate terkini × quantity, bukan selalu charge riil dari poll.
- **PD-24** Partial/Canceled → delivered dari quantity−remains (clamp), kredit `round((quantity−delivered) × unit_price)`; tanpa remains fallback delivered=0. Hasil partial jika delivered>0, selainnya canceled; kredit idempoten per asal/kind, bukan transaksi terminal+kredit penuh atomik.
- **PD-25** Refill: memakai `refill_days` snapshot order (fallback tier untuk legacy), status `completed|partial`, masa refill sejak order dibuat, dan refill terakhir ≥ 24 jam lalu. `requested|submitted|needs_check` diblokir berapa pun usianya; hanya belum pernah refill atau hasil terminal konklusif dapat diklaim. Server memanggil `refill` provider asal; ID/key ambigu dipertahankan, status refill dilacak.
- **PD-26** Timeout/ambigu saat `add` → `needs_check`, TIDAK diulang otomatis (§9.4).

### Katalog & harga
- **PD-30** Sinkron layanan supplier via diff VPS (§9.3) ke `pedia_supplier_services`.
- **PD-31** Harga jual dihitung dari rate terkini × markup kelompok, dibulatkan (§7.2). Disimpan di produk (bukan dihitung tiap request).
- **PD-32** Guard margin: bila `harga_jual − modal < min_profit` setelah rate naik → tingkat dinonaktifkan otomatis + notif Telegram admin. Penonaktifan disimpan sebelum harga baru agar replay setelah kegagalan tetap menguji harga lama. Pulih hanya jika admin mengaktifkan ulang.
- **PD-33** Layanan supplier hilang dari daftar → tingkat terkait nonaktif + notif.
- **PD-34** Tiap tingkat boleh punya `backup_service_id` (dipakai admin manual, bukan failover otomatis fase 1).

### Admin
- **PD-40** Tab admin **Pedia** dengan sub-tab: Produk · Layanan Supplier · Pesanan · Kredit · Pengaturan (detail §10).
- **PD-41** Penjelajah kedua provider, jumlah dinamis (576 snapshot lama), cari/platform/Indonesia/garansi-di-nama/tipe/kompatibilitas/mapped; pilih provider+service bersama dan hubungkan tier existing. Create produk/tier nonaktif di tab Produk.
- **PD-42** Antrean `needs_check` dengan aksi: *Cek saldo supplier*, *Tandai sudah dibuat (isi ID supplier)*, *Kirim ulang (konfirmasi ganda)*, *Batalkan + terbitkan kredit*.
- **PD-43** Saldo/error/pricing/sync per provider di Pengaturan, live atau fallback cache ditandai, riwayat 7 hari dan Cek saldo recovery. Alert per provider < ambang env default Rp100.000, check/alert throttle terpisah; bukan saldo live global header.
- **PD-44** Pesanan Pedia muncul di panel **Pesanan** global dengan filter "Jenis: Pedia".
- **PD-45** Dashboard untung (existing) menghitung Pedia: modal = `supplier_charge` riil (fallback snapshot rate × qty).

### Notifikasi
- **PD-50** Email pembeli (shell bermerek existing): tanda terima lunas, selesai, selesai sebagian/dibatalkan + Kode Kredit, refill diproses.
- **PD-51** Telegram admin (`TELEGRAM_ADMIN_CHAT_ID`): `Lunas — Pedia` (sekali per order), `Pedia perlu dicek`, `Saldo providersmm menipis`, `Produk Pedia dinonaktifkan otomatis`.

### Integrasi axvara.tech
- **PD-60** CommunityBar memakai CrossServicePromo Pedia + Bot Telegram Market; Pedia menampilkan promo Market sebelum katalog. LaunchCards.saved tetap arsip; keputusan promo tersembunyi 2026-10-08 superseded untuk titik ini saja.
- **PD-61** ServicesMenu di Market/Pedia, dengan keyboard/Escape/focus return; AppSwitcher dihapus dari working-tree.
- **PD-62** Tombol `/link` disembunyikan sejak 2026-10-08. Titik promosi lain tetap mengikuti kode/flag existing, bukan otomatis diaktifkan oleh overhaul.
- **PD-63** CrossServicePromo memakai `utm_source=axvara|pedia&utm_medium=cross_promo`, footer Pedia memakai UTM existing; semua menu/footer lintas host absolut dari site.ts, bukan semua tautan diberi UTM.
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
        ├─ Standar  → service #86   (akun Indonesia, garansi 30 hari; default historis, kini null)
        └─ Premium  → service #24   (akun Indonesia aktif)
```
Contoh mapping di atas adalah snapshot ProviderSMM historis, bukan rekomendasi siap produksi/default pilihan. Tier boleh berbeda provider, tidak wajib tiga tier. Satu produk = satu kebutuhan pembeli; nama supplier tidak tampil publik. Kurasi ulang initial live data, margin/ETA/refill dan approval owner masih pending.

### 7.2 Aturan harga
```
modal_per_unit   = supplier_rate / 1000                    (rate IDR per 1K dari API)
harga_mentah     = qty × modal_per_unit × (1 + markup_pct/100)
harga_mentah     = max(harga_mentah, qty × modal_per_unit + min_profit_rp)
harga_jual       = bulatkan_ke_atas(harga_mentah, < Rp10.000 → Rp100 ; ≥ Rp10.000 → Rp500)
harga_jual       = max(harga_jual, PEDIA_MIN_ORDER_RP)     (default Rp1.000)
```
Paket menampilkan harga hasil rumus (dihitung saat sinkron atau simpan tier/paket/step admin, disimpan di `pedia_tiers.package_prices_json`). Quote dapat menghitung jumlah bebas, tetapi UI hanya menawarkan paket karena API orders mensyaratkan key jumlah di harga tersimpan.

| Kelompok | Contoh | `markup_pct` default | `min_profit_rp` | Plafon harga |
|---|---|---|---|---|
| G1 Komoditas (views, likes global, FB followers) | Views TikTok, Likes IG Hemat | 150 | 500 | ≤ 90% harga Keranjangindo |
| G2 Real/Aktif Indonesia | Followers IG Premium | 60 | 2.000 | ≤ 95% Keranjangindo |
| G3 Followers bergaransi & subscriber | Followers IG Standar, Subscriber YT | 20 | 1.000 | ≈ Keranjangindo |

Plafon adalah panduan kurasi manual (admin mengecek), bukan logika kode.

### 7.3 Kurasi awal (data API providersmm 2026-10-07, rate IDR per 1K)

> **Historis 2026-10-07, bukan kurasi awal dua-provider yang telah disetujui/live.** Seed masih ProviderSMM dan nonaktif. Service/rate di bawah tidak membuktikan katalog, currency/unit atau ketentuan terkini; cek ulang supplier dan approval owner sebelum publish. Harga mengikuti §7.2, tanpa konversi kurs; IndoSMM terblokir sampai gate IDR/unit lolos.

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
  checklist_json TEXT NOT NULL DEFAULT '[]', -- id unik setelah trim, label, help string opsional; image lama belum dirender
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

Penanda di `store_settings`: `pedia_diff_last_at`, `pedia_diff_last_change_at`, `pedia_balance_alert_at` (format `amount|ms`, throttle 1:1 WR/SK — 2026-10-09: kirim ulang hanya bila >6 jam ATAU saldo turun melewati kelipatan Rp5.000; format datetime lama tetap dibaca), `cron_lite_pedia_orders_ok_at`.

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
Worker cron 5 mnt ─▶ /api/cron/lite?job=pedia_orders ─────┘   └─ (reservasi order durable, bukan stateless)
```

Topologi awal ProviderSMM di atas dipertahankan sebagai riwayat; working-tree menambah `/indosmm/*` → `indosmm.id/api/v2`, diff `source=indosmm` terpisah. Key kedua supplier hanya VPS; kontrak handoff §16.10 ARCHITECTURE adalah acuan terkini.

### 9.2 Routing host
- `src/middleware.ts`: bila `host` = `pedia.axvara.tech` (atau env `PEDIA_HOST`) dan path bukan `/api/*`, `/_next/*`, aset → `NextResponse.rewrite` ke `/pedia${path}`. CSP & header keamanan existing tetap diterapkan.
- Akses `axvara.tech/pedia/*` → redirect 308 ke `pedia.axvara.tech/*` (satu URL kanonis).
- Dev lokal: buka `http://127.0.0.1:3000/pedia` langsung (tanpa rewrite).
- DNS: CNAME `pedia` → `axvara.pages.dev` (proxied) + custom domain Pages. Dikerjakan eksekutor lewat `.cf-credentials`.
- Layout Pedia memakai PediaNavbar/PediaBottomNav sendiri dan **Footer bersama** dari storefront; tidak mewarisi Navbar/CartDrawer/MobileBottomNav Market. Root minimal + `(shop)` group tetap.
- Cookie & localStorage Pedia memakai prefiks `axp-` (host-only). Keranjang toko pusat tidak dipakai.

### 9.3 Sinkron Dua Provider (Lokal, Belum Deployed)
- Proxy `POST /psmm/:action` untuk providersmm dan `/indosmm/:action` untuk indosmm; allowlist services/add/status/refill/refill_status/cancel/balance. Pages memakai WARUNG_REBAHAN_PROXY_URL/TOKEN existing, `x-proxy-token` ↔ VPS WR_PROXY_TOKEN. Key supplier server-side VPS `PROVIDERSMM_API_KEY` / `INDOSMM_API_KEY`; JSON diubah form, key/action pemanggil ditimpa, tidak dilog.
- IndoSMM services/add memerlukan **`INDOSMM_RATE_PER_1000_VERIFIED=true` dan balance terbaru currency IDR**; default gate tertutup, 503 pricing_unverified bila gagal, tanpa konversi kurs. Flag harus berdasar bukti unit akun yang disetujui, bukan asumsi contoh USD. Balance/status/refill/refill_status/cancel recovery tidak diblokir gate ini; `/health` hanya key configured.
- Diff tiap 10 menit kedua provider membawa `{source,currency,services,removed_service_ids,heartbeat?}`. Snapshot terpisah `state/psmm-diff-state.json` / `state/indosmm-diff-state.json`, maju hanya potongan batch ber-ack 2xx; heartbeat threshold 9 menit pada cycle. Katalog kosong/>50% hilang tetap ditahan. Array dibatasi independen: layanan `chunkMax` 1..100 (default 50), removals 100 per batch; sisa termasuk >100 removals dilanjutkan pada batch berikutnya, bukan batas pending.
- Receiver key `(supplier,service_id)`, IDR wajib (legacy providersmm tanpa currency = IDR), max 100 services/100 removed; validasi input seluruh batch sebelum write. Upsert/removed/reprice **per statement**, bukan satu batch atomik; partial failure non-2xx agar snapshot VPS tidak maju. Prefix penanda `pedia_diff` / `pedia_indosmm_diff`, check/saldo/alert terpisah.
- Resync admin eksplisit supplier, validasi katalog nonkosong + IndoSMM balance/gate, potongan 100. Manual resync tidak menandai missing; diff yang melakukannya. Tidak ada sweep katalog penuh terjadwal dari Pages.

### 9.4 Dispatch Durable, Bukan Exactly-Once End-to-End
Job `pedia_orders` di `/api/cron/lite` (pola `wr_orders`), budget statement & deadline existing:
1. **Klaim:** CAS queued → submitting + increment attempts + lease **5 menit sebelum jaringan**, changes=1. Maks 20 item queued/cycle, hanya order lunas, budget DB lite diteruskan.
2. **Kirim:** `POST /psmm/add` atau `/indosmm/add` menurut provider/service tersimpan pada item, timeout Pages 30 dtk/proxy upstream 20 dtk; Idempotency-Key stabil = order_code.
3. **Respons `{order: N}`** → `submitted`, simpan `supplier_order_id`.
4. **Respons error eksplisit**, saldo kurang, gate/proxy error, respons tanpa ID → needs_check untuk penanganan manusia; tidak queued kembali atau refund otomatis berdasarkan string error.
5. **Timeout / 5xx / respons tak terbaca** → `needs_check` (JANGAN kirim ulang). Alert Telegram admin.
6. Lease kedaluwarsa pada status `submitting` → `needs_check` (bukan `queued`).
7. Create orders saat ini memasukkan item queued sebelum invoice; dispatch memeriksa `orders.status='lunas'`, bukan menganggap queued berarti sudah dibayar. Quote mengikat `refill_days/min_profit_rp`; snapshot order mengambil ketentuan dari quote, selain provider/service/rate, bukan edit tier sesudah quote. Remapping tier tidak mengganti asal dispatch/poll/refill order lama. Quote/order legacy tanpa field refill/min-profit fallback tier. Supplier ID tersimpan kolom setelah add; mark_submitted recovery juga menulis snapshot JSON.

Proxy memakai reservation durable `SMM_IDEMPOTENCY_DIR` (default `state/smm-idempotency`, folder psmm/indosmm), hash action+key + fingerprint payload, exclusive create/fsync sebelum upstream, cache sukses atomik tanpa TTL/eviction. Add wajib key 1..120 karakter (tidak dipotong); refill/cancel dedupe hanya bila key disertakan. Pending/corrupt/ambigu = 409 needs_check, payload beda untuk key sama = conflict, storage gagal pra-submit = 503. Rejection eksplisit 2xx error string tanpa order/refill saja melepas reservation; Pages tetap needs_check. Jangan hapus pending atau mengganti key/provider; backup state satu VPS, bukan dedupe multi-host; in-memory lama tidak dapat dipulihkan. Ini tidak menjadikan konsumsi kredit/order/invoice atau terminal/kredit/notif satu transaksi atomik.

### 9.5 Polling status
- Maks 20 item submitted/in_progress dengan lease due, status individual pada provider asal; bukan batch 100 atau urutan last_polled_at. Kegagalan poll memperpanjang lease 5 menit.
- Normalisasi whitespace dan Cancelled → canceled; Pending/Processing/In progress → in_progress, Completed → completed. Partial/canceled memakai remains untuk menentukan hasil dan kredit; tanpa remains fallback kredit penuh. Tidak ada transisi terminal/kredit/notifikasi atomik penuh atau auto-flag 72 jam pada implementasi ini.
- Poll refill_status hingga 5 item submitted berbatas budget, memakai provider asal; completed/rejected/canceled disimpan terminal.

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
| GET | `/api/pedia/catalog` | publik, cache CDN 60 dtk | produk/tier aktif + paket valid terhadap supplier present/min-max/step/harga positif; tanpa ID/rate/nama supplier |
| POST | `/api/pedia/quote` | publik + rate-limit scope `pedia_quote` 30/mnt/IP | validasi target, qty, kredit → quote terenkripsi |
| POST | `/api/pedia/orders` | publik + rate-limit 10/mnt/IP | buat order idempoten + invoice QRIS (atau lunas via kredit) |
| GET | `/api/pedia/orders/[code]` | capability token (pola existing) | status, progres, refill eligibility (tanpa data supplier mentah) |
| POST | `/api/pedia/orders/[code]/refill` | capability token + rate-limit | ajukan refill |
| POST | `/api/pedia/credits/check` | publik + rate-limit 10/mnt/IP | cek kode → sisa (tanpa membocorkan email) |
| GET | `/api/pedia/ticker` | publik, cache 60 dtk | 10 order lunas terbaru tersamarkan |
| * | `/api/admin/pedia/*` | sesi admin | CRUD produk/tingkat, layanan supplier, antrean, kredit, saldo, tarik ulang |
| POST | `/api/supplier-sync` (cabang SMM) | `SUPPLIER_SYNC_TOKEN` existing | diff providersmm/indosmm, currency IDR, identity gabungan, partial non-2xx |
| POST | `/api/cron/lite?job=pedia_orders` | `CRON_SECRET` existing | dispatch + poll + alert saldo (saldo dicek maks 1×/30 mnt; alert throttle 6 jam ATAU turun Rp5.000, cermin WR/SK) |

Respons publik TIDAK pernah memuat `supplier_service_id`, nama layanan supplier, rate, atau `supplier_order_id`.

**Katalog working-tree 2026-10-12:** layanan dari kedua provider wajib present/Default/rate positif/min-max integer valid; bounds key gabungan. Harga finite positif, quantity dalam batas/paket/step; tier tanpa paket valid dan produk tanpa paket hilang. Hemat/Standar/Premium urut, paket numerik. Min/max boleh publik, bukan identity. `catalogCard` memasangkan harga terendah/jumlah terkecil/tier/refill sama; tagline tampil pada kartu dan detail/order. `description_md` adalah field publik opsional (`string|null`) yang tampil pada detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML; tidak ditambahi link-helper teknis. Featured membatasi tampilan awal hingga 8, bukan payload katalog/cari/filter/semua. Katalog tidak melakukan live pricing probe; bukti gate masuk data dan readiness supplier tetap tugas rollout.

### 9.8 Anggaran Cloudflare Free
- Beranda/platform Pedia: SSR membaca katalog (≤ 60 baris) via query berindeks; respons di-cache CDN 60 dtk.
- Job `pedia_orders`: akses DB berbudget lite existing; loop dispatch/poll berbatas masing-masing 20, refill_status hingga 5. Bukan jaminan ≤2 subrequest/25 statement; tanpa parse katalog penuh pada hot path orders.
- Target total Pedia ≤ 300 ribu rows_read/hari. Semua query baru WAJIB memakai indeks (cek `EXPLAIN QUERY PLAN` di test regresi, pola migrasi 0057).

### 9.9 Env & flag

| Nama | Lokasi | Default | Fungsi |
|---|---|---|---|
| `PEDIA_ENABLED` | Pages secret_text | `false` | Storefront Pedia + rewrite host |
| `PEDIA_ORDERS_ENABLED` | Pages | `false` | Boleh membuat order (false = notice katalog-only, kontak tidak dirender, lanjut pembayaran disabled) |
| `PEDIA_DISPATCH_ENABLED` | Pages | `false` | Job kirim ke supplier |
| `PEDIA_HOST` | Pages | `pedia.axvara.tech` | Host rewrite |
| `PEDIA_PROMO_DIGEST_ENABLED` | Pages | `false` | Baris Pedia di Daily Promo Digest |
| `PEDIA_BALANCE_ALERT_RP` | Pages | `100000` | Ambang alert saldo supplier |
| `PEDIA_MIN_ORDER_RP` | Pages | `1000` | Total minimum |
| `PROVIDERSMM_API_KEY` | `.env` VPS proxy SAJA | — | Kunci supplier |
| `INDOSMM_API_KEY` | `.env` VPS proxy SAJA | — | Kunci IndoSMM, readiness/credentials pending |
| `INDOSMM_RATE_PER_1000_VERIFIED` | VPS proxy | tertutup kecuali literal `true` | Bukti rate per 1.000 disetujui; balance IDR tetap wajib untuk services/add/diff |
| `SMM_IDEMPOTENCY_DIR` | VPS proxy | `state/smm-idempotency` | Reservasi durable; backup, jangan reset untuk retry |
| `PSMM_DIFF_STATE_FILE` / `INDOSMM_DIFF_STATE_FILE` | VPS proxy | `state/psmm-diff-state.json` / `state/indosmm-diff-state.json` | Snapshot terpisah, tidak boleh satu path |
| (existing) `WARUNG_REBAHAN_PROXY_URL` / `_TOKEN` | Pages secret_text | — | Dipakai ulang `/psmm/*` dan `/indosmm/*`, token ↔ VPS WR_PROXY_TOKEN |

Sumber kunci lokal: `axvara/.providersmm-credentials` (git-ignored, chmod 600). JANGAN commit/echo nilainya. Kunci sudah pernah tertempel di chat → **rotasi** di dashboard providersmm setelah VPS terpasang, lalu perbarui file lokal + `.env` VPS.

---

## 10. Admin — tab "Pedia"

Grup sidebar **Katalog**, menu **Pedia**, deep-link `?section=pedia&tab=…`. Gaya Admin UI existing (bukan glass berat).

| Sub-tab | Isi |
|---|---|
| **Produk** | Daftar ringkas cari/platform/supplier/kesiapan; buat produk/tingkat nonaktif + edit terpisah. Nama/slug/platform/metric/target/metadata/checklist/paket/step/urutan/terbit/unggulan; mapping provider+service utama/cadangan, harga/margin/refill API vs masa kurasi/ETA. Preview storefront tersimpan terpenuhi: `ProductCard` aktual + `OrderClient` embedded aman, termasuk draf privat; unsaved live preview di luar scope. Tagline/deskripsi adalah copy publik; featured editorial membatasi awal beranda tetapi full katalog tetap lengkap. Tanpa reorder ↑↓. |
| **Layanan Supplier** | Jumlah dinamis (576 snapshot lama), cari nama/ID debounce 300ms, supplier/platform/Indonesia/garansi-di-nama/tipe/kompatibel/mapped, 50/halaman. Pakai present/Default, provider+service bersama → tier existing + reprice, cadangan lama dibersihkan, tidak auto-aktif. Resync eksplisit supplier dan konfirmasi; status diff WIB/per provider. |
| **Pesanan** | Filter status dengan label Indonesia; needs_check di atas, detail target/jumlah/start/remains/charge/ID supplier/error/waktu. Aksi Cek saldo, Tandai sudah dibuat (ID supplier), Kirim ulang, Batalkan + kredit. Konfirmasi recovery berupa form; kirim ulang wajib cek dashboard supplier + menerima risiko tagihan ganda. |
| **Kredit** | Daftar kode (hint 4 karakter, email tersamar, sisa, asal, kedaluwarsa); terbitkan kredit manual (`source_kind='admin'`) dengan alasan wajib. |
| **Pengaturan** | Default markup/min profit/min order/ambang tersimpan + konfirmasi; overview saldo live/cache/error/pricing/sync per provider, riwayat 7 hari (maks 100). Health key saja bukan pricing. Default tidak bulk-update tier atau menggantikan env operasional. |

**Readiness bukan flag order:** Nonaktif = produk OFF; Siap dijual = ON + tier ON provider dikenal, present/Default/rate/batas/paket/step/harga/margin valid; selainnya Belum siap. Itu kesiapan data tersimpan, bukan bukti supplier live atau flag order/dispatch ON. Seed nonaktif saat kosong tetap ProviderSMM. UI sekarang membuat produk dan tier **nonaktif**, kemudian mapping/reprice/kurasi/publish melalui editor; tidak perlu SQL manual untuk membuatnya.

**Dua-provider admin lokal:** filter supplier pada Produk/Layanan/Pesanan; layanan memakai filter kompatibilitas/mapped dan pilihan `{supplier,service_id}`. Mapping utama harus dikirim berpasangan; pindah supplier membersihkan cadangan lama, validasi Default/present/rate dan pricing gate IndoSMM. API refill ditampilkan terpisah dari masa refill kurasi. Preview storefront tersimpan **terpenuhi**: `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman menampilkan copy/checklist/paket/harga/refill/ETA dari data tersimpan, termasuk draf privat dan tingkat nonaktif dengan paket layak. Navigasi/pemesanan disabled, interaksi preview tidak memanggil API, kontak/kredit/S&K pemesanan tidak diminta; CTA mobile inline, bukan fixed. Preview tidak menerbitkan draf atau membuka route publik. Paket tidak layak disaring, harga tidak diada-adakan ketika paket kosong. Preview diperbarui setelah save/reload; input belum disimpan tidak ikut dan unsaved live preview di luar scope. Terbit, Pilihan AXVARA dan Siap dijual terpisah. Tagline/deskripsi diedit admin dan tampil publik sesuai §9.7.

**Recovery aktual:** mark_submitted memerlukan konfirmasi, ID desimal positif kanonik (`^[1-9][0-9]*$`)/status pada provider asal, cek konflik ID/provider/order dan CAS. Resubmit serta cancel+kredit hanya needs_check lunas yang **belum pernah submit** (`submit_attempts=0`, tanpa ID); timeout setelah add tidak boleh retry/ganti provider/key. Pengaturan menampilkan saldo live atau cache berlabel/error/pricing_verified/sync tiap provider, riwayat 7 hari; bukan header global. Resync eksplisit supplier dan non-2xx jika parsial. Isi tabel lama yang menyatakan tanpa create/tanpa saldo live atau retry setelah submit superseded oleh paragraf ini.

**Persistensi dan feedback:** ID produk/tier admin wajib desimal positif kanonik, tanpa nol awal/notasi eksponen/pecahan. PUT parsial memvalidasi field yang dikirim dan tidak mereset field lain; checklist wajib array `id/label` dengan ID unik setelah trim dan field bantuan opsional bertipe string, paket bilangan positif sesuai step. Semua edit tier serta perubahan paket/step langsung reprice tier terdampak, bukan menunggu sync berikutnya. Harga derived tidak dapat diedit lewat PUT. Aktivasi manual membersihkan kunci auto-disabled, tetapi service `present=0` tetap hilang: reprice mengosongkan harga dan menonaktifkan tier; service belum tersinkron juga menghasilkan harga kosong.

**Tidak atomik:** update produk/tier dilakukan sebelum reprice; `500 reprice_failed` berarti perubahan sudah tersimpan, harga mungkin belum seluruhnya diperbarui. Muat ulang dan tarik ulang layanan untuk recovery; jangan mengklaim rollback penuh. GET admin gagal memberi `500 load_failed`, bukan kosong sukses; kegagalan write/recovery memberi `save_failed`. UI menampilkan loading/busy/error/sukses + Muat ulang, membatasi write ganda dan mengabaikan hasil pencarian usang. Resync dengan `errors` dilaporkan berhasil sebagian. Update mark_submitted/resubmit yang kalah race status mengembalikan 409.

`ConfirmDialog` dipakai untuk resync, kredit manual (email/jumlah/alasan wajib, kode baru disampaikan admin kepada penerima) dan Pengaturan; edit produk/tier disimpan langsung, recovery memakai form konfirmasi. Jam memakai `formatWibDateTime`.

**Batas Pengaturan:** nilai tersimpan dapat dibaca/diedit, tetapi jalur reprice/quote/orders masih memakai env `PEDIA_MIN_ORDER_RP`, dan ambang cron memakai `PEDIA_BALANCE_ALERT_RP`; jangan mengklaim nilai store_settings tersebut sudah mengendalikan seluruh jalur operasional atau semua tier.

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

## 13. Acceptance criteria

### 13.1 Riwayat QA Overhaul 2026-10-11 (Superseded untuk Diff Terkini)

- Beranda seluruh katalog, cari/platform/reset/empty state; kartu harga-jumlah-tier sepadan; tanpa hype/badge hardcoded/ticker; deteksi tautan tidak menjanjikan verifikasi akun (`tests/pedia-home-ux.behavior.test.tsx`).
- Katalog supplier-present/min-max/paket/step/harga positif, tier tanpa paket valid hilang (`tests/pedia-catalog-ux.test.ts`).
- Order tiga kelompok/radio native/paket-only, penyesuaian jumlah, validasi & fokus, quote eksplisit/invalidation/respons usang, kredit/total server, lock/retry token sama dan 4xx/expiry (`tests/pedia-order-ux.behavior.test.tsx`).
- Admin daftar/readiness/filter/editor/assignment/recovery/kredit/settings/error (`tests/pedia-admin-ux.behavior.test.tsx`); PUT parsial/reprice/supplier hilang/gagal baca-tulis/partial persistence (`tests/pedia-admin-ux-api.integration.test.ts`). Footer contextual dikunci `tests/pedia-launch.test.ts`.
- Verifikasi lokal tidak membuktikan order supplier nyata atau deployment produksi; hasil lengkap test/Obscura dicatat oleh pelaksana overhaul di CHANGELOG.
- Pemeriksaan dokumentasi 2026-10-11: enam suite Pedia UX/launch dijalankan, **63/64 test pass**. Satu test `pedia-home-ux.behavior.test.tsx:27` memakai `getByRole("status")` ambigu karena notice order tutup dan jumlah hasil sama-sama ber-role status; belum diperbaiki dalam tugas docs-only ini. Status lokal terverifikasi tidak berarti seluruh test sudah hijau atau siap deploy.

### 13.2 Bukti historis 2026-10-08 (bukan spesifikasi UX saat ini)

Checkbox di bawah mencatat laporan implementasi awal, bukan bukti gate live dua-provider. Butir default pilihan/lima langkah/dua CTA/footer mini/AppSwitcher/promosi disimpan superseded oleh §5/§6/§10; AC-11 enam retry superseded oleh needs_check setelah satu percobaan ambigu. AC-14 tidak membuktikan konsumsi kredit/order atomik penuh; batas aktual §9.4. Angka test/failure di §13.1 dipertahankan sebagai riwayat, bukan hasil run terkini.

**Storefront**
- [x] AC-01 `pedia.axvara.tech/` render beranda Pedia (tanpa navbar toko pusat — root minimal + `(shop)` group, Obscura 2026-10-08); `axvara.tech/pedia` → 308 ke subdomain (middleware; dev lokal 127.0.0.1 dikecualikan).
- [x] AC-02 Tempel `https://www.instagram.com/p/XYZ/?igsh=abc` → terdeteksi "Instagram · Postingan", menawarkan Likes/Views, target ternormalisasi tanpa query (test pedia-link).
- [x] AC-03 Link profil ke produk Likes ditolak dengan saran produk yang benar (test pedia-orders target_mismatch).
- [x] AC-04 Ganti tingkat/jumlah → total realtime client (harga paket tersimpan); quote server memvalidasi ulang + 409 bila berubah.
- [x] AC-05 Tombol Bayar dengan checklist belum lengkap → scroll + fokus ke item pertama yang belum; tidak membuat order (order-client).
- [x] AC-06 Order ke link yang sama + produk yang sama yang masih aktif → 409 `duplicate_active_order` + kode lama (test pedia-qa).
- [x] AC-07 Mobile: grid 1 kolom + sticky bar 68px + spacer 84px + scroll-padding 96px (DESIGN §5–6; Obscura desktop terverifikasi, mobile menyusul pra-launch).
- [x] AC-08 `prefers-reduced-motion: reduce` → animasi promo/ticker/shimmer mati (globals.css + test pedia-launch).

**Pembayaran & supplier**
- [x] AC-10 QRIS lunas → item `queued` → tick cron → `submitted` + `supplier_order_id` (test pedia-dispatch mock caller).
- [x] AC-11 Mock `add` timeout → `needs_check` setelah 6×, tanpa `add` kedua setelah terminal (test AC-11).
- [x] AC-12 Dua tick paralel tidak dobel — klaim lease atomik (test AC-12, adds=1).
- [x] AC-13 Partial remains 40/100 total Rp10.000 → kredit Rp4.000 tepat sekali walau poll diulang (test AC-13).
- [x] AC-14 Kredit-penuh → lunas tanpa QRIS + konsumsi atomik dua request (test AC-14; jalur orders payable=0).
- [x] AC-15 Rate naik melewati margin → tier nonaktif + katalog kosong ≤60 dtk cache (test pedia-qa AC-15).
- [x] AC-16 Respons publik tanpa `supplier_service_id`/rate/nama supplier/`supplier_order_id` (test pedia-orders snapshot string).

**Integrasi**
- [x] AC-20 DISIMPAN 2026-10-08 (permintaan owner): beranda kembali ke CommunityBar (Telegram + Grup WA); LaunchCards tersimpan di `LaunchCards.saved.tsx`, Pedia diakses via endpoint langsung. Sebelumnya terverifikasi Obscura 2026-10-08 (test pedia-launch).
- [x] AC-21 AppSwitcher Pedia terverifikasi; navbar pusat kemudian disembunyikan 2026-10-08 (test pedia-launch).
- [x] AC-22 Order Pedia di admin Pesanan (filter Jenis: Pedia — API kind + UI) + modal supplier_charge di dashboard untung.
- [x] AC-23 `PEDIA_ENABLED=false` → katalog 503 + halaman "Segera hadir" tanpa error (test pedia-qa).

**Verifikasi repo historis 2026-10-08:** laporan test/type-check/Obscura dan dokumentasi awal di atas dipertahankan, bukan QA working-tree saat ini.

### 13.3 Status Aktual 2026-10-12

Audit source/diff dan followup: dua-provider routing/diff/IDR gate, batch layanan/removals independen dengan ack, encrypted quote yang mengikat refill/min-profit + legacy, snapshot order, refill ambigu tetap terkunci, disable margin sebelum reprice, validasi admin, CAS submitting, durable proxy reservation, copy publik, menu/promo/footer bersama, compact featured/all/link/typewriter, null selection/satu CTA/consent dan admin create/preview/provider/recovery tersedia lokal. Preview storefront tersimpan sudah terpenuhi sesuai §10; unsaved live preview di luar scope. **Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing.** Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Run docs terdahulu 128 pass dan laporan 63/64 §13.1 tetap historis, bukan hasil terbaru. Checklist/gap: issue/planning.md. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Tidak ada live supplier probe, deploy/commit/push dalam tugas docs ini. Pending: readiness credentials, bukti IDR/unit/min-max/refill/cancel/error/batas API, kurasi awal data produksi/approval owner, handoff/rollout serta QA produksi sesuai gate terpisah.

---

## 14. Milestone Awal (Historis 2026-10-07/08)

Rencana awal ini arsip implementasi pertama, bukan pekerjaan atau wireframe current overhaul. UI terkini mengikuti §5/§6/§10 dan `PEDIA-DESIGN.md`.

| # | Milestone | Isi | Bergantung |
|---|---|---|---|
| M0 | Proxy VPS | Modul `/psmm/*` + diff 10 mnt di `axvara-wr-proxy`, `.env` VPS `PROVIDERSMM_API_KEY`, deploy sesuai `axvara-wr-proxy/AGENTS.md`, uji `balance` & `services` | — |
| M1 | Skema & sync | Migrasi 0059, cabang `providersmm` di `/api/supplier-sync`, test regresi diff + guard margin + indeks | M0 |
| M2 | Admin Pedia | Sub-tab Layanan Supplier & Produk (kurasi + pratinjau margin), seed kurasi §7.3 (nonaktif) | M1 |
| M3 | Storefront | Logo final Pedia via Muse image generator/compose sesuai `PEDIA-DESIGN.md` §2.2 (konsep A dipilih owner), routing host, layout & komponen `src/components/pedia/*`, beranda, platform, halaman order, parser link (+test tabel §9.6) | M2 |
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
| Saldo supplier habis saat ramai | Alert per provider + error add menjadi needs_check; bukan retry saldo otomatis. Rekonsiliasi sebelum tindakan admin |
| Drop tinggi → komplain | Kurasi berbasis uji order + Monitor, garansi jelas, tombol refill self-service |
| Kuota/CPU Cloudflare Free | Kerja berat di VPS, cache CDN katalog, indeks wajib, budget statement |
| Persepsi merek ("jual followers palsu") | Subdomain terpisah, copy jujur, S&K tegas, tanpa klaim berlebihan |
| Risiko merchant QRIS DANA (kategori layanan) | Pantau; siapkan rail GoPay (§16.9 ARCHITECTURE) sebagai cadangan |
| API key bocor | Hanya di VPS, rotasi pasca-setup, tidak di-log |
