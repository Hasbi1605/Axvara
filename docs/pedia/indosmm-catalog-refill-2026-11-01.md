# Pedia IndoSMM: katalog, drop/refill dan refill — 1 November 2026

Status: implementasi lokal, publikasi melalui CI. Deployment dan order supplier
berbayar belum diverifikasi. Saldo IndoSMM saat audit Rp0; owner mengisi saldo
sebelum Pedia dibuka penuh.

## Keputusan owner
- ProviderSMM diputus. Penjualan, saldo, notifikasi Telegram dan katalog hanya
  IndoSMM. Riwayat/snapshot order ProviderSMM tetap dibaca, tidak diubah.
- Istilah SMM tetap dalam bahasa supplier: Drop, Drop rate, No Drop, Less Drop,
  High Drop, Refill, Refill 30 Days, Refill Lifetime, No Refill, Start time, Speed,
  Avg time, Success rate. AXVARA hanya menambah satu kalimat penjelasan.
- Layanan High Drop/No Refill murah boleh dijual selama labelnya jelas; pembeli
  memilih sesuai risiko.
- Katalog diperbanyak untuk pembeli dan reseller.

## White label
- Teks pembeli 100% AXVARA: tidak menyebut supplier, IndoSMM, ProviderSMM atau
  "penyedia" pihak lain (katalog, kartu info, istilah, halaman Refill/Lacak/
  Ketentuan/Bantuan, status pesanan, pesan error, email/Telegram pembeli).
- `whiteLabel()` (`src/lib/pedia/terms.ts`) menyaring teks tier/produk/checklist
  pada katalog publik dan snapshot copy pesanan lama. 0086 juga merapikan teks
  tier lama di DB. Panel admin dan notifikasi admin tetap menyebut IndoSMM.

## Sumber data (baca-saja)
- Dashboard indosmm.id (Chrome profil khusus, login owner): Daftar Layanan
  (4.381 layanan + waktu rata-rata), deskripsi per layanan, Panduan Order,
  Ketentuan.
- `ai.indosmm.web.id/api/analysis?period=168` (publik): order, success/cancel/
  refill rate dan AI score 7 hari. Bukan API resmi; formatnya bisa berubah.
- Statistik ini bukti operasional supplier, bukan uji kualitas AXVARA.

## Data dan migrasi
- 0085: `pedia_service_stats` (avg_time, orders_7d, success/cancel/refill rate,
  ai_score) + `pedia_tiers.drop_label` dan `speed_per_day`; snapshot 1.273 layanan.
- 0086 (generator `scripts/generate-pedia-indosmm-20261101.mjs`, manifest
  `src/lib/pedia/curation-20261101.json` dari
  `scripts/curate-pedia-indosmm-20261101.py`): 124 layanan baru pada 28 kebutuhan
  + 3 produk komentar acak (IG/TikTok/Facebook), label drop/speed/start pada tier
  lama, nama lama "Refill N hari/Tanpa refill" → "Refill N Days/No Refill",
  6 layanan dengan success rate 7 hari rendah dinonaktifkan
  (`supplier_health_20261101`). Hanya mirror present/Default/rate>0 dan paket
  dalam batas yang aktif; harga dihitung dari mirror live. Order lama tidak diubah.
- Dry-run di D1 lokal (skema + data katalog produksi): 152 → 270 tier aktif,
  108 produk aktif, idempoten, `foreign_key_check` bersih.
- Kesehatan disegarkan cron lite `pedia_orders` maks 1×/jam (3 statement,
  satu upsert `json_each` untuk layanan yang dipakai tier).

## Pembeli
- Kartu layanan: chip wilayah, Refill N Days/No Refill, label drop berwarna
  (No Drop hijau, Less Drop kuning, High Drop merah), Start time.
- Info layanan (sesudah daftar di langkah 1): Start time, Speed, Avg time per
  1.000, Min/Max, Success rate 7 hari (bila ≥5 order), arti Refill dan label drop,
  Drop rate terukur (≤2% rendah, 3–8% sedang, >8% tinggi dari persen pesanan
  supplier yang diajukan refill), panel "Arti istilah".
- Komentar acak tidak bisa ditentukan isinya; komentar custom di luar scope.

## Skema refill
- `src/lib/pedia/refill-policy.ts` dipakai GET status, POST refill dan halaman.
- `api`: layanan dengan tombol refill IndoSMM (`api_refill=1`) → POST `refill`,
  cron memantau `refill_status`.
- `manual`: layanan bergaransi tanpa tombol API → `manual_requested` + Telegram
  admin; admin mengajukan ke CS IndoSMM dengan Order ID lalu menandai
  "Refill selesai"/"Ditolak supplier" (`refill_resolve`).
- Syarat: pesanan selesai/sebagian, dalam masa refill, 1×/24 jam, tidak ada refill
  yang masih berjalan. Refill hanya menutup jumlah yang drop dari pesanan ini.
- Halaman `/refill`: kode + kontak checkout, status/masa refill/jalur, tombol
  Ajukan Refill, cara kerja, aturan dan arti istilah. Footer, FAQ, ketentuan dan
  halaman pesanan menautkannya.

## Admin
- Badge kesehatan (Sehat/Cukup/Berisiko/Belum ada data) di editor tier dan daftar
  layanan supplier, baris statistik 7 hari dan peringatan ganti layanan.
- Field Label drop, Speed, Wilayah, Kualitas; field teknis di "Pengaturan lanjutan".
- Jalur refill tertulis per tier. Tab: Produk, Layanan Supplier, Pesanan, Kurasi,
  Pengaturan, Arsip lama. ProviderSMM tidak bisa dipilih.

## Tahap 2 (1 November 2026)
- Daftar layanan: nama pendek, grup Refill (bergaransi) → No Refill, termurah dulu;
  chip success rate; Info layanan di bawah kartu terpilih; istilah relevan saja.
- Komentar custom: `pedia_tiers.input_kind='comments'` (0087). Pembeli menulis satu
  komentar per baris, jumlah baris = jumlah pesanan (maks 200, 300 karakter/baris,
  8.000 total). Quote/snapshot menyimpan `custom_comments`; dispatch mengirim
  `comments` (dipisah baris baru). Tier comments hanya untuk layanan tipe
  "Custom Comments"; tier lain hanya "Default".
- 0088: +162 layanan (maks 30 pilihan per kebutuhan, duplikat harga-saja dibuang),
  produk baru Live Views TikTok/YouTube/Facebook/Shopee, Live Likes TikTok,
  Watchtime TikTok, Komentar Custom IG/TikTok/YouTube/Facebook. Dry-run produksi:
  432 tier, 118 produk aktif. Link Shopee Live `live.shopee.co.id/share?session=`.
- Belum: auto likes/subscriptions, halaman daftar harga reseller.

## Batas
- VPS masih mengirim diff ProviderSMM; Pages membalas 200 `ignored` tanpa menulis.
  Menghentikan pengirim di VPS adalah tugas terpisah.
- Statistik supplier dapat berubah atau hilang; harga supplier bisa naik tajam,
  guard margin existing tetap berlaku.
