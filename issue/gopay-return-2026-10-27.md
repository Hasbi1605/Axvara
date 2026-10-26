# Kembali ke GoPay Merchant pribadi, 27 Oktober 2026

Owner meminta kembali ke GoPay082135277434 setelah KlikQRIS gagal menyiapkan
invoice. Owner memilih menerapkan pola pengaman AutoGoPay pada server AXVARA
sendiri, tanpa memakai layanan atau API AutoGoPay.

## Bukti sebelum perubahan

- Database produksi dibaca saja: 11 percobaan checkout dari enam pembeli sejak
  27Oktober01:06:55WIB belum berhasil menerbitkan invoice KlikQRIS; sembilan
  dibatalkan oleh cleanup initializing, dua saat itu masih initializing.
  Error aktif503 dan404. GET dua referensi existing mendapat404
  `Transaction not found or unauthorized`; tidak mengulang POST create.
- QR lampiran owner didekode lokal dengan Vision: CRC valid, merchant
  G564039370, nama Axvara Digital, NMID ID1024342457479, kotaSLEMAN.
  Payload privat hanya di `.gopay-credentials` chmod600/ignored.
- Dari VPS existing, profil GoBiz merchant dan nomor cocok082135277434,
  outlet aktif; akses baca feed24jam berhasil tanpa transaksi. Tidak meminta
  OTP baru, mengganti deviceId atau melakukan pembayaran uji.
- Referensi AutoGoPay: https://autogopay.site/docs/webhook dan
  https://autogopay.site/docs/gopay/qris-generate. Peringatan generate1–2kali
  per transaksi berasal dari screenshot dashboard owner. Cadence3/5/10detik
  layanan tersebut bukan batas resmi untuk query langsung GoBiz.

## Perubahan

AXVARA mempertahankan provider ledger pada retry meski provider aktif berubah;
initializing KlikQRIS tetap GET-only. Reuse GoPay memeriksa requested_amount,
race membaca pemenang dari provider yang benar, merchant tersimpan mengikuti
QR dan payment_account memakai GoPay Merchant. Explicit GoPay tanpa konfigurasi
lengkap gagal tertutup, tanpa fallback DANA; QR bukan merchant GoPay ditolak.
Satu original dan maksimal satu reissue hanya setelah expiry invoice/order hidup,
tanpa memperpanjang deadline. Generate/PNG lokal, tanpa POST generate GoBiz.

Poller menandatangani byte body HMAC-SHA256 dengan GOPAY_POLLER_SECRET existing;
receiver wajib signature selain secret. Bukti merchant/status IDR settlement atau
capture/waktu berzona/order/nominal diverifikasi. Kode order berbeda tidak boleh
fallback ke order lain dengan nominal sama. Paid/event/outbox atomik mendahului
schedulePaidFulfillment/waitUntil existing; replay tidak membeli/mengirim ulang.

Poller minimal15detik, adaptif15/30/60detik mengikuti invoice terbaru <2/<5/≥5menit,
satu loop dan wake timer digabung. Tidak ada GoBiz saat idle atau invoice invalid.
Gate/backoff/hold per merchant durable lewat .session*.poll-state; restart tidak
meresetnya. SDK sudah refresh401 satu kali; poller tidak menambah refresh.
Sesi mati, persist gagal, restriction403/423 dijeda sampai sesi pengganti manual.
Token baru di-fsync sebelum callback SDK berhasil. Transport hanya GET mutasi dan
POST refresh token pada dua origin allowlist dengan redirect manual; tidak ada
transfer, tarik dana atau generate QR. Login tetap manual, cooldown120detik dan
challenge5menit, deviceId lama dipertahankan.

## Rilis dan rollback

VPS dirilis27Oktober05:59:51WIB, lalu final06:16:13WIB untuk mempertahankan hold
persistensi ketika SDK membungkus error menjadi401. Ketujuh file dist cocok manifest SHA256,
service active, health configuredtrue/minimumwake15000ms dan kemudian idle/pending0.
Env serta kedua sesi tidak berubah saat deploy. Backup:

- `/opt/axvara/gopay/backup-20261027-225951`
- `/opt/axvara/gopay/app/dist.backup-20261027-225951`
- Final: `/opt/axvara/gopay/backup-20261027-231613` dan
  `/opt/axvara/gopay/app/dist.backup-20261027-231613`.

Tiga secret_text Pages existing diubah: GOPAY_STATIC_QRIS,
GOPAY_QRIS_ENABLED=true, QRIS_ACTIVE_PROVIDER=gopay. Metadata sesudah PATCH
membuktikan60 variabel tetap,64dengan sistem dari batasPaid128; konfigurasi lain
identik. Nilai lama tiga variabel dibackup privat di
`/tmp/axvara-gopay-pages-before-20261027.json`; tidak masuk repo/log.
Semua secret dan callback KlikQRIS, DANA dan sesi merchant kedua dipertahankan.
Receiver Pages dipublikasikan melalui commit/pushmain; deployment tidak dipantau.

Urutan kompatibilitas: poller baru bertanda tangan dapat memakai receiver lama;
receiver baru menolak poller lama tanpa signature. Jangan rollback poller ke25Okt
selama receiver baru aktif. Rollback konfigurasi merchant/provider dilakukan
melalui secret_text + rilis CI yang kompatibel; ledger lama tidak dimigrasikan.
Pertahankan sesi/env/state, tanpa reset hold sebagai cara menghindari pembatasan.

Folder poller bukan repo Git. Snapshot sumber/test/package/lock/AGENTS lengkap
di `patches/gopay-hardening-2026-10-27.patch`; apply ke direktori kosong lalu
`npm ci && npm test`. Snapshot tidak berisi env/sesi/token/payload QR owner.

## Verifikasi dan batas

- Root3161test/260file pass; type-check dan build:pages exit0. Gateway12test dan
  build pass. Poller20test/build pass, termasuk SDK nyata dengan fetch fixture
  untuk401/refresh tunggal, transport allowlist/no-redirect, gate15detik meski
  tickspam, dua merchant, retry ACK dengan ID sama, signature rawbody,
  state restart/corrupt/manualhold, status/waktu/merchant tidak lengkap.
  Kasus persistensi yang dibungkus SDK sebagai401 tetap menghasilkan hold manual.
- Fixture SQLite menguji race enam create menjadi satu invoice/history, reuse
  saat switch, GET-only initializing KlikQRIS, max reissue dan larangan QR aktif,
  penolakan signature/tamper/evidence salah, source paid_at dan replay sekali.
- Dev home/CSS200 sesudah cache dev dipisahkan dari build, tanpa compile error.
  Obscura CLI memuat checkout kosong tanpa overflow dan PNG diperiksa. CDP
  milik Obscura memverifikasi POST callback tanpa konfigurasi dev ditolak503
  qris_not_configured; bukan bukti checkout/QR pembayaran pelanggan produksi.
  Warning namespace SVG/hydration renderer existing tetap dicatat.
- Tidak membuat/membayar invoice produksi, tidak membeli supplier dan tidak
  mengganti sesi/OTP saat QA. Koneksi/profil/feed yang valid tidak membuktikan
  pembayaran GoPay end-to-end atau penyebab suspend lama. Tidak ada jaminan
  bebas pembatasan; bila toko dinonaktifkan, owner perlu menyelesaikannya lewat
  bantuan GoPay, bukan mengubah identitas atau mengulang login otomatis.
