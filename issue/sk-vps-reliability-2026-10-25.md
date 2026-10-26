# Pemulihan SK dan audit keandalan VPS — 25 Oktober 2026

## Insiden dan hasil pemulihan

Order AXV-20261025-1D4FACC6, link SK68, varian1095×1. Paid20:26:29WIB;
penanda request_sent_at20:26:52; invoice kosong/statusclaimed. Proxy mencatat
POST /sk/v1/trx pada20:26:53WIB aborted/ECONNRESET saat membaca body, tanpa
forward upstream. Cloudflare mencatat clientDisconnected pada menit yang sama.
Recovery GET ref_id semula terus404; cron tetap hidup. Ini membuktikan body POST
terputus sebelum proxy meneruskan; timeout browser20detik adalah pemicu yang
konsisten dengan kode, bukan bukti bahwa pembeli sengaja menutup halaman.

Owner meminta perbaikan dan pembelian/pengiriman segera, mengizinkan sesi root
AWS existing untuk akses sementara SSH. Sebelum pembelian: supplier GET404
TRX_NOT_FOUND, saldoRp46.246, riwayat transaksi dan mutasi tidak memuat order ini.
Satu POST varian1095×1 memakai ref_id `sk:AXV-20261025-1D4FACC6:1095:1` menghasilkan
invoice SPY17929361970Q2B senilaiRp4.025. Webhook processing20:50:08 dan
completed20:50:14WIB; order/item799 delivered, ciphertext tersimpan, error kosong.
Email kredensial pada buyer_notice_log berstatussent20:50:15WIB, provider receipt
tersimpan. Bukti sent berarti pengirim menerima, bukan bukti buyer membaca.
Tidak ada kontak/kredensial pembeli atau secret supplier di laporan ini.

## Perbaikan main

- Payment memisahkan respons dari kerja supplier/notifikasi via waitUntil;
  task yang sama ditunggu di dev/test. Transisi paid/outbox/cron tetap durable.
- Materialisasi/bind supplier mendahului fulfillment umum.
- Immediate WR/SK hanya mengambil order yang baru dibayar, satu link/supplier;
  cron tetap maksimalempat dan budget/lease existing.
- Lookup ambigu SK mencatat error aman; status/request/ref_id tetap dilindungi,
  tidak POST ulang atas404/timeout.

## Audit VPS lanjutan

Paseo Wonder: audit transport, durable idempotensi dan scheduler. Flash: review
patch pembayaran serta diff/GoPay. PM menilai bukti runtime dan mengintegrasikan
perbaikan yang terverifikasi. Snapshot sumber tanpa secret untuk reviewer berada
di node_modules/.cache/axvara-vps-audit (ignored). Working tree proxy sudah memiliki
perubahan sebelumnya; audit tidak boleh menghapus/mengikutsertakan sembarang diff.

Runtime awal: wr-proxy active, restart0, memori sekitar60MB; disk31%, tanpa OOM
24jam. GoPay poller active. Temuan/koreksi dan hasil akhir ditambahkan setelah QA.

## Bukti tambahan transport dan pengujian

Fixture membuktikan HTTP500/503 generik atau receipt sukses tanpa ID dapat
mengembalikan link ke retry pada kode lama. Kini fence tetap submitted; tick
berikutnya tidak POST kedua. SK explicit PRODUCT_TEMPORARILY_UNAVAILABLE tetap
retry biasa. Ref_id SK berbeda ditolak. Dua mock starvation lama diperbaiki agar
receipt supplier mengembalikan ref_id request sebenarnya, bukan string fixture.
Proxy source dirty existing ternyata sama persis dengan empat dist produksi
(SHA256 dibandingkan); baseline npm test proxy lulus sebelum audit.

Wonder menarik rekomendasi dedupe by-body karena dua pembelian WR sah dapat
memiliki body identik; tidak menambah dedupe seperti itu. GET404 tetap tidak
mengizinkan requeue otomatis. Temuan yang diterima: dispatcher bersama, slicing
removal WR/SK maksimal200 dengan ack/restart-safe, cakupan tes transport, validasi
byte/path, respons tulis tak terbaca sebagai ambigu dan panduan artifact lengkap.

## GoPay: bug tambahan terkonfirmasi dan diperbaiki

Kode live menganggap HTTP<500 sebagai ACK, sehingga401/409/429/redirect dapat
menandai mutasi seen selama dua jam walau Pages belum menyimpan keputusan.
Kini hanya2xx + JSON ok:true/status paid|already_paid|duplicate|unmatched yang
mengakui event. Unmatched tetap keputusan manual durable, bukan paid. Network,
receipt rusak dan respons lain tetap dicoba lagi pada cadence existing dengan
ID sama. Redirect manual mencegah penerusan secret ke lokasi lain.

Endpoint /tick ternyata memanggil pollOnce langsung di luar loop, berpotensi
menabrak refresh sesi dan jarak minimum. Kini alias wake berantrean. Test stub
membuktikan delapan pemicu tidak memanggil GoBiz lagi sebelum jarak10detik dan
409 dapat pulih pada tick loop berikutnya. Sepuluh test poller + build lulus;
tidak ada panggilan GoBiz nyata atau login pada QA.

GoPay dirilis VPS14:21UTC/21:21WIB saat idle/pending0; backup lengkap
/opt/axvara/gopay/app/dist.backup-20261025-1421. Hash index/pages-forward/routing
cocok lokal; health active/idle, kedua sesi tetap tersedia. Source baseline cocok
dengan compiled live sebelum perubahan. Patch terpisah ada di
issue/patches/vps-gopay-2026-10-25.patch karena folder poller bukan repo Git.

## Batas audit dan pemulihan berikutnya

Audit meliputi source proxy, loop/diff, state idempotensi SMM, layanan GoPay,
kesehatan systemd, memori/disk dan log insiden. Tidak ditemukan bukti OOM atau
service mati sebagai pemicu order ini. Tidak melakukan stress/load test produksi,
uji kualitas supplier atau transaksi berbayar tambahan. Jaminan tidak ada bug
lain tidak dapat diturunkan dari audit ini.

404 ambigu tetap memerlukan rekonsiliasi manual: periksa referensi stabil,
riwayat transaksi dan debit supplier; jangan menghapus penanda request atau
mengganti ref/key untuk mencoba ulang. Pembelian pemulihan insiden ini dilakukan
sekali atas instruksi owner, setelah bukti tidak ada transaksi/debit.

Patch VPS disimpan terpisah relatif ke baseline source yang sudah live; jangan
menerapkan patch tersebut di root AXVARA. Untuk folder layanan terkait, gunakan
`git apply -p2 --check < /path/ke/patch` lalu terapkan hanya pada baseline yang
cocok. Backup dist dan state durable dahulu; direktori idempotensi bukan cache
katalog dan tidak boleh direset untuk mengulangi pembelian.

Pemeriksaan antrean sebelum rilis: SK tidak memiliki link pending/retry/claimed/
submitted/ordering/processing; WR hanya satu processing sejak24Oktober dengan
wr_order_id terisi (bukan POST baru yang belum menerima jawaban). Tidak mengubah,
mengulang pembelian atau memindahkan order lama tersebut.

Review independen Wonder atas snapshot final GoPay menyatakan ACK sesuai seluruh
respons Pages, ID event tetap, dedupe hanya sesudah ACK, dan /tick tidak lagi
memiliki jalur polling paralel. Tidak ada defect baru konkret yang ditemukan.

## Rilis proxy — 26 Oktober 2026

Spark menyelesaikan patch; PM menguji ulang npm test + tsc dan menambahkan
regresi payload induk terlambat serta konfigurasi/singleton egress. Seluruh lima
suite proxy lulus, network dimock/disableNetConnect. Review akhir Wonder GO:
tidak ada blocker correctness baru. Modul psmm/psmm-diff persis baseline.

Rilis VPS26Oktober sekitar10:30WIB: antrean D1 WR/SK tanpa status in-flight,
log proxy tanpa POST pembelian aktif saat restart. Seluruh dist disalin, backup
/opt/axvara/wr-proxy/dist.backup-20261026-0332 dan state.backup-20261026-0332;
state/env existing tidak dihapus/direset. Health /health,/wr/health,/sk/health200,
HTTPS publik200; pembelian tanpa token401. Hash empat modul cocok dengan build
lokal. Siklus diff WR/SK/SMM kembali berjalan tanpa marker error pada pemeriksaan
awal; ini pemeriksaan rilis terbatas, bukan bukti seluruh siklus masa depan.

Patch relatif baseline live disimpan di issue/patches/vps-proxy-2026-10-26.patch,
lulus git apply -p2 --check. Working tree lama proxy tetap dipertahankan; patch
ini hanya delta tugas audit, tidak memasukkan perubahan pengguna sebelumnya.
Rollback: salin kembali seluruh dist backup lalu restart layanan. Jangan
memulihkan snapshot/idempotensi dari backup untuk mengulang transaksi ambigu.

Penutupan SG SSH sementara sempat tertahan26Oktober karena sesi root AWS
kedaluwarsa. Browser aws login dibuka untuk autentikasi owner; tidak menambah
key IAM atau mengubah kebijakan user kiro-monitor untuk melewati batas tersebut.

Owner menyelesaikan login root existing26Oktober. Pada11:00WIB, AWS menyatakan
revoke berhasil untuk sgr-06d47e93f292561fb (TCP22,103.3.222.96/32). Describe SG
memverifikasi aturan sementara sudah tidak ada; hanya aturan SSH semula tersisa.
Tidak ada key IAM baru atau perluasan izin kiro-monitor. Pemeriksaan final
homepage/CSS dev200 dan Obscura26Oktober title/heading benar, tanpa overflow;
screenshot /tmp/axvara-sk-home-26.png diperiksa. Root3141test/259file, tsc dan
build:pages sebelumnya lulus pada source akhir yang sama. Publikasi Pages lewat
push main; hasil CI/deployment tidak dipantau sesuai aturan proyek.
