# D1 read budget — 19 Oktober 2026

Scope: owner menyetujui implementasi sesudah audit produksi baca-saja.
Baseline 22.36 WIB: 3.918.472 reads (78,37%), laju bucket tertutup 210.836/jam;
Insights sampled menempatkan laporan keuangan admin paling mahal (~21–22 ribu
reads/eksekusi). Bukan bukti persentase atribusi tepat atau regresi commit tertentu.

Rencana:
- [x] Batasi penghitungan ulang keuangan ke snapshot privat terenkripsi lima menit
      lintas proses di lokasi Cloudflare yang sama; auth/revocation tetap sebelum
      cache. Status operasional tetap maksimum satu menit, generated_at asli.
- [x] Materialisasi pencarian link supplier sekali per item; validasi kesetaraan
      perhitungan, rounding, mixed cart, Pedia/kredit dan laporan historis.
- [x] Gabungkan statistik/facet pesanan, hilangkan COUNT duplikat dan tambahkan
      indeks daftar terbaru + inventory per order melalui migrasi aditif baru.
- [x] Pastikan query kesehatan antrean mulai dari pekerjaan aktif, bukan orders.
- [x] Uji biaya D1/workerd serta seluruh vitest, type-check/lint/build Pages,
      HTTP dev/CSS dan Obscura; sinkronkan spec dan changelog.
- Publikasi hanya commit/push main sesudah verifikasi; kemudian berhenti tanpa
  memantau CI/deployment. Bukti SHA final berada di Git.

Target ≤3 juta reads/hari tetap membutuhkan satu siklus produksi 07.00–07.00.
Tidak ada transaksi supplier, perubahan flag/secret atau deploy manual.

## Verifikasi lokal

- Seluruh 2.767 test pada 233 file lulus; type-check bersih, lint exit 0 dengan
  warning existing; build Pages exit 0.
- D1/workerd, 400 order keranjang campuran: laporan 88.846 → 84.450 rows_read
  (sekitar 4,95%) dengan seluruh output setara; omzet 20.000.400 dan modal
  12.000.000 terjaga. Ini penghematan biaya satu kalkulasi, terpisah dari cache.
- Facet global tiga scan → satu: 2.000 → 800 reads; COUNT pagination duplikat
  juga dihapus. Filter/statistik/pagination kosong, kanal dan metode diuji.
- Inventory 5.001 → 1 read; daftar terbaru 800 → 10; quiet jobs 5 reads dan
  attention satu order dengan job+item 10 reads sesudah ANALYZE distribusi timpang.
  Migrasi 0072 dijalankan pada runtime D1 lokal, tanpa perubahan data produksi.
- Named Cache API + AES-GCM benar-benar berjalan di workerd. Tes ciphertext
  tidak berisi angka/nama plaintext; scope, rotasi key, AAD, korupsi, cache gagal,
  expiry absolut lima menit dan module/isolate baru teruji. Tes sesi dicabut/
  unauthorized existing tetap menolak sebelum snapshot; status operasional tetap
  berumur 60 detik dan pergantian periode tidak memperpanjang keuangan asal.
- Memori koalescing tetap per binding/proses; cache edge bersifat per lokasi,
  tidak menjamin dedupe global saat miss bersamaan. Laporan historis tetap fresh.

- Dev beranda/CSS dan `/admin?section=summary|orders` 200; API overview/orders
  tanpa sesi 401. Tidak ada error kompilasi di `/tmp/axvara-dev.log`.
- Obscura home aktual nonblank, title/heading dan lebar sesuai; komponen admin
  aktual lewat proxy fixture API inert pada 1280/390px memeriksa generated_at,
  Hari ini (`?period=today`) dan filter pending (`status=pending`), counts global
  tetap dua sedangkan metrik/daftar menjadi satu. Screenshot diperiksa, tanpa
  overflow/exception JS admin. Input tanggal native dan SVG memiliki batas
  renderer Obscura existing; home mencatat warning hydration namespace SVG
  existing. Fixture tidak memanggil API mutasi/supplier/email/Telegram nyata.
- PRD/DESIGN/ARCHITECTURE/README/changelog disinkronkan; kredensial tetap ignored.

Implementasi dan verifikasi lokal selesai. Publikasi memakai push main/CI;
hasil deployment dan total harian pascarilis belum diverifikasi.
