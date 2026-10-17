# D1 Free — penghematan lanjutan 2026-10-17

Scope disetujui owner: implementasi rekomendasi setelah audit kuota, tanpa order
supplier berbayar atau perubahan secret. Baseline analytics 11.04 WIB: 1.030.021
reads / 3.977 writes sejak reset; lonjakan 10–11 = 511.960 reads. Insights
bersifat sampled, bukan bukti persentase penghematan pascarilis.

- [x] Snapshot privat seluruh Ringkasan 60 detik setelah auth, kegagalan tidak
      disimpan; perhatian order dimulai dari antrean bermasalah.
- [x] Snapshot katalog Telegram 30 detik untuk daftar/kategori/cari/bestseller;
      checkout langsung ke data aktual; dev tanpa Cache API tetap fresh.
- [x] Filter pecundang dihitung sekali; pemeriksaan inventory EXISTS; indeks
      inventory per varian dan order per pembeli diuji dengan D1/workerd.
- [x] Antrean pasangan berubah durable dengan versi; ack bersyarat setelah
      keputusan berhasil; sweep penuh cron existing menjadi cadangan.
- [x] Log biaya/cache tanpa SQL/parameter/data pribadi atau tulis telemetry D1;
      workflow analytics akun baca-saja + laporan/proyeksi/alarm GitHub Actions,
      memakai Secrets CI existing dan tanpa mengirim pesan Telegram uji.
- [x] Test penuh, tsc/lint/build Pages; HTTP dev + CSS; Obscura route aktual.
- [x] PRD/DESIGN/ARCHITECTURE/README/AGENTS/changelog diperbarui.

Publikasi final melalui commit/push main, lalu berhenti tanpa memantau CI;
bukti publikasi berada pada SHA/remote Git, bukan checklist bukti deploy.

Target operasional ≤3 juta reads/hari perlu satu siklus 07.00–07.00 produksi;
pengujian lokal mengukur rows_read dan kontrak perilaku, bukan klaim target live.
Tidak menambah cache untuk harga checkout, pembayaran, atau isi kredensial.


Bukti verifikasi lokal: 2.619 test / 223 file lulus, tsc bersih, lint exit 0
(warning existing), build:pages exit 0. Dev home/admin/CSS 200 dan overview tanpa
sesi 401. Obscura memeriksa home serta AdminPage aktual dengan API fixture di
browser: section Produk tanpa request overview, Ringkasan satu request, Hari
ini memakai period=today, lebar 1280 tanpa overflow/exception admin; screenshot
diperiksa. Home memiliki warning hydration xmlns SVG renderer existing.

| Mekanisme (fixture D1/workerd) | Sebelum rows_read | Sesudah rows_read |
|---|---:|---:|
| Filter pecundang, 1.000 produk / 40 pasangan | 40.220 | 2.040 |
| Inventory, 50 varian / 5.000 unit | 250.050 | 100 |
| Attention, 5.000 order lunas / satu bermasalah | 24.997 | 10 |
| Tick pasangan bersih | full sweep sebelumnya | 0 |

EXPLAIN memilih indeks recipient baru dan trigger SQL dijalankan pada workerd;
fixture besar menguji hasil sebelum/sesudah yang sama. Invalidasi diproses per
maksimal 10 pasangan, token tetap ada setelah ack; uji mencakup gagal tulis,
perubahan bersamaan, proses lama sesudah ack, race full sweep, dan cron cleanup
yang tetap menguras antrean ketika housekeeping sedang ditahan interval.

Monitor CLI telah diuji baca-saja terhadap Cloudflare GraphQL aktual pukul
11.21 WIB: 1.088.449 reads / 4.173 writes, status risk. Workflow baru belum
dinyatakan berjalan di GitHub; notifikasi mengikuti pengaturan owner. Jadwal
dapat terlambat dan analytics delayed/sampled. Proyeksi bersyarat, bukan janji
jam habis atau jaminan aman. Tidak ada secret Pages/VPS/flag/kontrak sukses
proxy baru; tidak ada transaksi supplier atau pesan Telegram nyata.
