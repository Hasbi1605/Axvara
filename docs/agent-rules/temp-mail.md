# Aturan agent - Temp mail publik

## Keputusan owner 12 November 2026

- Langsung publik, tanpa login/admin. Pengunjung dapat memilih alamat sendiri,
  membuat alamat acak, dan membuka kembali alamat yang sama dengan memasukkannya.
- Domain penerima sementara `isturaiky.page`, bukan `mail.axvara.tech` atau apex
  `axvara.tech`. Web ditargetkan ke `https://mail.axvara.tech` lewat Worker Static
  Assets; tanpa server SMTP/VPS, aplikasi Pages tambahan, atau perubahan toko.
- Email Routing Cloudflare hanya mendukung catch-all pada apex domain. Jangan
  menjanjikan alamat bebas pada subdomain atau membuat ribuan literal rule.
- Empat literal forwarding privat domain existing harus tetap aktif dan utuh.
  Alamat privat/reserved ditolak pada API serta ingestion; bukan inbox publik.
  Penambahan route privat baru wajib diikuti daftar `RESERVED_MAILBOXES` dan test.
- Semua inbox lain publik; siapa pun yang mengetahui alamat dapat membacanya.
  Pesan tidak ditampilkan setelah 24 jam, dihapus bertahap oleh cleanup hourly;
  alamat sendiri tetap reusable. Batas simpan100 pesan/inbox, daftar50 terbaru.
- Hanya menerima/membaca teks email, bukan mengirim/reply/forward publik atau
  mengunduh lampiran. HTML email tidak dieksekusi, gambar remote tidak dimuat.

## Isolasi dan publikasi

- Koreksi CI12November2026: database temp mail sudah memiliki schema prototipe
  `messages(id TEXT,inbox,text,...)`; jangan rename/drop/ubah/copy isinya ke inbox
  publik. Worker baru hanya memakai `temp_mail_messages` dan indeks `idx_temp_mail_*`.
  Migrasi0001 diperbaiki sebelum pertama kali sukses diterapkan di produksi:
  metadata `d1_migrations` kosong terverifikasi read-only, bukan asumsi dari CI gagal.
- Source/config/migrasi ada di `temp-mail/`; database `axvara-temp-mail`
  (`a507b69c-7493-4e76-9d63-68a38d9202de`), bukan `axvara-db` atau migrasi toko.
- `MAIL_DOMAIN` dan `RESERVED_MAILBOXES` adalah konstanta publik Worker, bukan
  env Pages. Tidak menambah/mengubah secret Pages atau backup env Pages.
- CI `ci.yml` menginstal dependency MIME terpisah sebelum root tests, audit
  runtime, preflight DNS/private rules, migrasi DB terpisah, deploy Worker lalu
  aktivasi catch-all. Semua deploy melalui push main, bukan Wrangler manual.
- `scripts/ci-temp-mail-routing.cjs` default baca-saja; `--apply` hanya setelah
  deploy sukses. Ia memeriksa domain/DB/binding deploy, empat route privat, semua
  pengecualian privat, lalu hanya PUT catch-all dan membaca ulang hasilnya.
  Jangan mengubah MX Zoho, SPF, DKIM, Access admin, Worker MCP atau supplier VPS.
- Kredensial CF mengikuti `.cf-credentials`/Secrets CI existing; jangan menaruh
  kredensial dalam source, asset, output test, dokumentasi atau commit.
- QA memakai MIME sintetis pada D1/workerd lokal dan browser nyata, tanpa mengirim
  email/notifikasi/transaksi produksi. Push sukses bukan bukti deployment atau
  penerimaan SMTP end-to-end. Setelah push berhenti tanpa polling deployment.
