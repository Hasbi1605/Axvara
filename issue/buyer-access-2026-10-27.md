# Kode akses pembeli — 27 Oktober 2026


Koreksi owner pada27Oktober: pembelian berikutnya memakai PIN6; format26 yang sudah terbit tetap berlaku. Ketentuan format/admission/email pada [runbook PIN](buyer-pin-2026-10-27.md) menggantikan bagian terkait di dokumen historis ini.
Implementasi dan fixture lokal; publikasi melalui CI push main. Push bukan bukti
deployment. Owner memilih kode tanpa OTP untuk pesanan baru, sementara pesanan
lama tetap menggunakan kontak checkout. Bot WA nonaktif dan tidak perlu diurus
atas instruksi owner; tidak ada reaktivasi atau perubahan handler bot WA.

## Perilaku

| Jalur | Pesanan baru | Pesanan lama |
|---|---|---|
| Checkout web Market/Pedia | Respons privat berisi kode; tampil di halaman pesanan | Retry quote mempertahankan policy versi order |
| Lacak/status/wake | Nomor pesanan + kode akses | Kontak pada lookup/Pedia; status Market tersamar seperti sebelumnya |
| Kredensial produk | Kode sebelum capability; tetap harus lunas/paid dan delivered | Kontak lengkap atau capability existing |
| Cancel/reissue/refill | Kode serta guard status/expiry/eligibility existing | Kontrak lama tetap, termasuk reissue kode-order-only bila sebelumnya diizinkan |
| Telegram | Kode di invoice/status/retry chat pribadi pemilik | Tanpa backfill; identitas platform tetap |
| Email privat | Kode dirender sesaat dari versi tersimpan | Template tanpa blok kode |
| Admin | Reveal POST privat; rotate mencabut kode/capability lama atomik | Reveal409, kontak tetap |

Kode tidak memberi otoritas pembayaran atau fulfillment. Callback provider,
jumlah, merchant, signature, paid-state, stok dan dedupe supplier tetap berlaku.
Tidak ada notifikasi massal, order/pembayaran/pesan/supplier produksi untuk QA.

## Kontrak dan penyimpanan

- Migrasi0081: `buyer_access_version` default0 untuk legacy; factory baru
  eksplisit1. CHECK audit diperluas dengan seluruh event lama dan indeks utuh.
- Kode = 128bit pertama HMAC-SHA256 khusus domain
  `axvara:buyer-order-access-code:v1:<order_code>:<version>`, Crockford26 karakter,
  kelompok5-5-5-5-6. Perbandingan kanonis constant-time; huruf kecil/spasi/hyphen
  serta alias O/0 dan I/L/1 dinormalisasi. Order/versi lain ditolak.
- Key khusus `BUYER_ORDER_ACCESS_SECRET`, bukan JWT/password. Kode mentah tidak
  disimpan di D1. Quote yang sama mendapat kode stabil setelah respons hilang;
  kontak tidak bisa menerbitkan kode order baru. Tidak ada kode di GET/cache admin.
- Respons checkout: `buyer_access_code`; proof: body `access_code` (field contact
  kompatibel) atau `x-order-access-code`. Capability memakai `x-credential-token`;
  query token lama masih diterima, tetapi tidak dibuat client baru.
- Browser hanya sessionStorage; riwayat localStorage di-scrub. Jika storage
  ditolak, fragment handoff langsung dihapus; tidak terkirim HTTP/Referer.
- Email privat/DM Telegram merender kode ke recipient tersimpan; tidak ada kode
  pada outbox plaintext, grup WA, URL notifikasi atau audit. Inbox/perangkat
  penerima tetap menyimpan pesan privat, sehingga perlindungannya tetap penting.
- Counter D1 order+IP existing membatasi20 proof salah/15menit selain burst.
  Gagal simpan503; tidak fail-open atau mengunci buyer global dari IP lain.
  Produksi tanpa key menolak sebelum reservasi/invoice.

## Pages dan pemulihan (§16)

Sumber `.buyer-access-credentials`, git-ignored/chmod600. Satu Pages secret_text
baru `BUYER_ORDER_ACCESS_SECRET`, 32byte acak. CI/readback memeriksa tipe binding
tanpa mencetak nilai. Produksi63 konfigurasi +4 sistem =67/128 Paid;
preview/password/JWT/secret lain tetap. Tanpa paket atau cron baru.

Kode hilang: admin memverifikasi bukti kepemilikan di luar aplikasi, lalu memakai
**Lihat kode akses pembeli** di detail Market/Pedia. **Ganti kode akses** memakai
konfirmasi, increment versi dan revoke capability dalam satu batch CAS; request
paralel hanya satu berhasil. Audit reveal/rotate tanpa kode/kontak/query.
Jangan membagikan kode hanya berdasarkan nomor order+kontak.

Rotasi password/JWT tidak mengubah kode. Rotasi key buyer membatalkan SEMUA kode
baru; jangan menggantinya saat recovery biasa. Pulihkan key yang sama dari
backup privat. Key bocor memerlukan rotasi dan distribusi ulang terverifikasi
oleh admin, bukan downgrade versi order ke0 atau menghapus guard.

Rollback mempertahankan schema0081 dan key; jangan kembali ke kode yang membuka
semua order baru dengan kontak. Bot WA tetap nonaktif. Jika kelak diminta aktif,
delivery kode privat wajib diselesaikan dahulu, tanpa kode pada grup.

## Review dan batas bukti

Wonder memeriksa otorisasi, factory, retry, migrasi, delivery dan rotasi. Perintah
Telegram `/pesanan <code>` kini mengikat SQL ke chat pribadi pemilik, sehingga
jalur command tidak mengandalkan guard callback saja. Tidak ada blocker tersisa
pada lingkup aktif; delivery bot WA dinyatakan tidak berlaku oleh instruksi owner.

Raster gambar QRIS tetap dapat dibaca lewat URL gambar agar Telegram/proxy
bekerja. Ini mengungkap keberadaan/nominal/merchant invoice kepada pemegang
nomor order, tanpa kontak/kredensial/otoritas cancel/reissue/paid. Review menarik
rating awal High dan menyepakati residual privasi Low ini. Status/wake/reissue
baru tetap berkode. Kontak legacy merupakan residual yang dipilih owner.

## Verifikasi

Regresi D1 nyata: kontak ditolak pada order baru, legacy tetap tersedia, kode
order/versi salah, paid gate, capability header, checkout paralel dengan kode
stabil, limiter/error503, key terpisah/hilang, reveal/rotate paralel+revoke,
migrasi menjaga event dan command Telegram lintas pemilik/grup. UI menguji
session-only/history scrub aktual, storage ditolak+fragment strip serta copy
sukses/gagal, tanpa simulasi ulang implementasi untuk menggantikan pengujian.

Obscura memuat route lacak Market/Pedia aktual390/1440px. Fixture komponen aktual
berdata buatan berlabel dan fetch lokal memeriksa form kode, salin, pembatalan,
reveal, batal konfirmasi dan rotasi admin. PNG diperiksa tanpa overflow/page
error; home/CSS200 dan log kompilasi diperiksa. Obscura tidak memindahkan fokus
default saat CDP Tab; fokus native diperiksa langsung dan submit melalui event
form. Semantik input/button native tidak memblokir keyboard. Fixture bukan bukti
transaksi produksi, keyboard fisik atau rendering semua perangkat.

Dependency root: Miniflare4.20260730.0, Undici7.30.1, Sharp0.35.5; adapter
next-on-pages1.13.16/Next15.5.28/Node22 tetap. Audit registry runtime dan full
root/gateway nol27Oktober tanpa suppression/ignore/--force. Fixture workerd tetap
berjalan; KlikQRIS memakai tanggal lokal yang didukung2026-08-06, tanpa menurunkan
konfigurasi platform produksi. Hasil akhir suite/build dicatat di CHANGELOG.

## antislop Delivery Gate

Scope UI kode akses, During, ENERGY2/RHYTHM2/MOTION1 mengikuti AXVARA existing.

| Item | Hasil dan bukti |
|---|---|
| R02/R16 copy | PASS: teks baru singkat, tanpa klaim absolut/jargon pemasaran |
| R03/R34 responsive | PASS: PNG390/1440 dan scrollWidth≤viewport |
| R17/R18/R23/R38 fakta/aset | PASS: tidak membuat aset/statistik/testimonial; fixture berlabel |
| R24/R26 tindakan | PASS: form/salin/konfirmasi/batal/reveal/rotate diuji komponen aktual |
| R25 kontras | PASS: placeholder55% putih rasio5,21:1/hint65%6,68:1 pada latar field#2B2D41; kode putih, error amber; PNG diperiksa |
| R27 states | PASS: loading/akses ditolak/clipboard gagal dan sukses diuji |
| R28 FAQ | PASS: bantuan kode hilang menjelaskan checkout/inbox/admin serta legacy |
| R32 fokus | PASS: label/native form/button/focus ring diperiksa; fokus+submit diuji, batas Tab renderer di atas |
| R33 sumber | PASS: source UI aktual; harness hanya untuk QA |
| R35 runtime | PASS: dev+CSS200, Obscura click-through dan regresi/build |
| R36/R37 klaim/arah | PASS: Midnight/Cyan existing, tanpa klaim sertifikasi/bebas serangan |
| R01/R04/R06/R07/R08/R09 purpose | PASS: monospace untuk kode/cyan untuk salin; tanpa ikon/pola/badge baru |
| R10/R12/R13/R14/R19 efek | PASS: blok solid tanpa glow/shadow/animasi baru |
| Liveliness | PASS: kode/salin menjadi fokus, spasi memisah ringkasan, identitas AXVARA |
| C1–C5/R05/R11/R15/R20/R21/R29–31 | PASS: fungsi/konten nyata, radius bervariasi, tanpa template/aset/warna baru |
