# Operasional Workers Paid — 23 Oktober 2026

✅ Implementasi, publikasi melalui CI push main. Akun existing sudah Paid;
verifikasi lokal bukan bukti deployment atau batas biaya produksi tercapai.

Webhook tetap memverifikasi payment melalui API provider lalu langsung
memproses fulfillment/supplier. Tidak ada bypass status, reissue otomatis,
perubahan rail invoice lama, atau perpanjangan batas bayar 15 menit.

| Pekerjaan | Jadwal/batas |
|---|---|
| MCP scheduler | Setiap menit, CPU maksimal1000ms/invocation |
| KlikQRIS cadangan tanpa browser | `lite?job=payments`, empat invoice pending/aktif terlama sejak pemeriksaan, GET saja; jendela60 detik, CAS existing10 detik |
| Expiry, fulfillment, WR/SK, Pedia, notify A/B, promo | Setiap menit; tanpa jeda2 detik peninggalan Free |
| Fulfillment cadangan | Budget96 statement/invocation, empat job dan maksimal empat unit/job, lease/retry existing |
| Lite lain | Budget40 statement; konfirmasi payment/fulfillment langsung memakai transaksi/outbox existing yang dibatasi jumlah kandidat, bukan klaim seluruh pohon panggilan tercakup budget40 |
| Cleanup dan publish artikel | Lima menit |
| Route besar/sweep katalog | Hanya menit00 UTC, bukan menit01–04; chunk maksimum10/fase |
| Request scheduler ke origin | Timeout45 detik, tanpa retry POST; server mungkin masih menyelesaikan kerja dengan lease existing |
| Supplier refresh WR/SK | Webhook/poll pembeli + cadangan setiap menit; gerbang CAS20 detik, termasuk batch cron |
| Supplier Pedia baru berjalan | Poll60 detik selama15 menit;120 detik hingga satu jam;300 detik sesudahnya |
| Pedia gagal/unknown status | Backoff300 detik, tanpa add/failover baru; klaim sebelum GET status |
| Halaman Pedia | Pending5 detik, berjalan10 detik; hidden berhenti, kembali terlihat cek segera; terminal/needs_check berhenti |

Callback, halaman dan cron dapat bersamaan. Transisi paid/outbox, klaim
inventory, item/job lease, gerbang refresh dan dedupe provider tetap berlaku.
Klaim submitting Pedia tetap lima menit; timeout/ambigu tetap needs_check.
Kasus late payment tetap rekonsiliasi manual. Kecepatan akhir mengikuti
provider, jaringan, antrean dan kanal email; satu menit bukan SLA penyelesaian.

## Biaya dan observasi

Sembilan lite job setiap menit + cleanup lima menitan =13.248 request
origin/hari. Dengan scheduler, publish dan seluruh chunk hourly pada plafon,
perkiraan batas request penjadwalan sekitar15.600/hari atau468.000/30 hari,
belum trafik pembeli/bot. Ini perhitungan jadwal, bukan metering tagihan.
Tidak ada panggilan gateway ketika tidak ada invoice due; pekerjaan berat
katalog tidak dipercepat. Jatah Workers Paid10juta request dan30juta CPU-ms
per bulan harus tetap diukur; jumlah request saja tidak membuktikan biayaCPU.

`scripts/cloudflare-plan.cjs` membaca langganan account. D1 monitor memakai
awal/akhir periode aktual dan jatah25miliar rows read/50juta rows written pada
Paid, bukan hard cutoff harian Free. Total Analytics bisa mencakup pemakaian
Free sebelum upgrade; tidak dihitung sebagai nilai invoice pasti. API,
periode atau dataset tidak lengkap tetap gagal/unknown. Preflight Pages
menegakkan128 variabel Paid atau64 Free, termasuk empat sistem Pages; tidak
menambah env atau menampilkan nilai secret. Workflow monitor tetap Analytics
per jam menit17, tanpa SQL/deploy. Alert email budget1/5/10 USD yang telah
dipasang menghitung biaya usage akun di luar langganan; bukan hard cap.

Verifikasi metadata produksi baca-saja23 Oktober: Paid,64/128 variabel;
Analytics periode30 September–30 Oktober sekitar76,3juta baca dan293ribu
tulis. Ini baseline sebelum rilis percepatan, bukan hasil setelah deployment.

## Publikasi dan rollback

Build Pages dan Worker melalui `.github/workflows/ci.yml` saja. Sesudah push
diterima, berhenti tanpa polling deployment. Jadwal cron dapat memerlukan
waktu propagasi Cloudflare. Rollback memakai rilis CI yang mengembalikan
cadence lima menit; pertahankan data order/inventory/provider. Jika kelak
turun paket Free, kembalikan cadence dan evaluasi CPU sebelum downgrade.

Sumber: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Verifikasi lokal rilis

Fixture SQLite menguji GET KlikQRIS tanpa halaman terbuka, batas empat dan
fairness, gagal konfirmasi/backoff, CAS pemanggil bersamaan, serta pengecualian
invoice expired/canceled/initializing. Scheduler menguji cadence satu menit,
cleanup lima menit, heavy tepat00 dan timeout; Pedia menguji poll progresif,
backoff serta lease paralel. Behavior test memeriksa5/10 detik, hidden/visible
dan berhenti pada terminal. Obscura memeriksa komponen status Pedia aktual
pending→in_progress→completed pada1440/390px melalui fixture inert; screenshot
diperiksa, tanpa overflow/exception JS. Ini bukti lokal, bukan pengukuran
latensi/biaya produksi sesudah rilis. Pada home/status aktual, Obscura CLI
masih mencatat warning hydration atribut xmlns SVG existing; tidak ada error
kompilasi dev. Hasil suite/build ada di CHANGELOG.
