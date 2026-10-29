# GoPay: expiry sesi dan pemulihan 29 Oktober 2026

## Bukti
- Owner melaporkan uang masuk tetapi tiga pembayaran harus di-ACC manual.
- Service `gopay-poller` hidup, menerima wake, dan merutekan invoice aktif ke
  G564039370. Log feed gagal berulang, backoff30/60/120/240/300detik;
  health menunjukkan pending2 lalu3 dan forwarded0 selama backoff.
- Sesi terakhir tersimpan06:33:42UTC, expiry07:03:42UTC. Pada pemeriksaan sekitar
  09:47UTC sesi sudah expired, bukan file sesi hilang. SDK lokal/produksi sama.
- SDK0.1.1 `transactions.list()` hanya memicu refresh reaktif pada401; tidak
  memeriksa expiry sebelum GET. Ini celah terverifikasi, tetapi status HTTP asli
  dari feed yang gagal tidak tersimpan, sehingga hubungan kausal belum lengkap.
- Satu refresh sesi terkontrol menghasilkan201 dan menyimpan token berotasi
  secara atomik. Service dihentikan selama diagnosis agar tidak ada refresh
  paralel, kemudian dinyalakan kembali. Tidak mengirim OTP atau mengganti akun.

## Perbaikan dan verifikasi
- Tambah `await p.refreshSession()` tepat sebelum feed, sesudah gate/backoff/hold
  existing. SDK tidak melakukan refresh bila token valid di luar buffer; kegagalan
  refresh/persist mencegah GET. Retry401 SDK existing tetap, tanpa retry manual
  kedua dari poller. Error feed mencatat status HTTP numerik, bukan body/token.
- Stub integrasi mensyaratkan pemeriksaan sesi sebelum feed. Test memakai SDK
  sebenarnya dengan fetch fixture untuk valid/expired/persist gagal/refresh429.
- `npm test` di `axvara-gopay-poller`: build TypeScript dan24/24test pass.
- Backup dist produksi lalu salin seluruh dist; restart29Oktober09:50:12UTC.
  SHA256 `dist/index.js` lokal dan VPS sama:
  `05d43a1ed404ed1357c92a25abe2d992e92ac1bb75351ac667f886fdf12be773`.
- Service active; health configured, dua sessionExists true, idle pending0.
  Tidak ada invoice aktif saat verifikasi akhir, sehingga belum ada bukti
  feed/matching/callback pembayaran otomatis produksi sesudah perbaikan.
- Tiga ACC manual yang dilaporkan tidak dimutasi/dikirim ulang. Tidak membuat
  order QA, memanggil supplier, mengubah secret/env atau menghapus poll-state.
- Root hanya dokumentasi/patch, tanpa kode Pages: suite root/build Pages/browser
  N/A. Tidak memantau deployment Pages sesudah publikasi.

## Source dan rollback
Folder poller bukan repo Git. Ekstrak snapshot
`issue/patches/gopay-hardening-2026-10-27.patch` pada direktori kosong, lalu
terapkan `issue/patches/gopay-session-expiry-2026-10-29.patch` dan `npm test`.
Rollback VPS hanya dist backup bertanda tangan, bukan env/session/poll-state;
rollback mengembalikan celah expiry. Tidak menurunkan guard callback Pages.
