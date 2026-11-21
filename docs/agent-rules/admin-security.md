# Aturan agent — Admin Access, hardening OWASP, checkout anti-abuse

## S: password admin upgrade-on-login + body cap admin mutation — 21 November 2026 (lokal, audit AU-B1-1/B1-3)

- **Upgrade-on-login (AU-B1-1).** Hash admin legacy tetap SHA-256 satu putaran
  (64 hex tanpa salt) DITERIMA agar admin lama tidak terkunci, tetapi pada login
  sukses pertama (jalur password, bukan proof browser) `upgradeAdminPasswordHash`
  menggantinya dengan PBKDF2 dan menyimpan `{source,hash}` di D1
  `store_settings.admin_password_hash`; `source` adalah HMAC-SHA256 atas hash
  legacy `ADMIN_PASSWORD_SHA256` dan penggantinya, memakai `ADMIN_JWT_SECRET`
  existing dan divalidasi dengan perbandingan timing-safe. Bila override hilang,
  rusak, tidak cocok, atau kunci HMAC tidak tersedia, pakai hash env. Rotasi
  salah satu secret membatalkan override. Format sidik jari FX-6 lama belum
  pernah dideploy; tidak perlu migrasi. Login GET lapor `pbkdf2-proof` setelah upgrade.
  Jangan mengunci login tanpa jalur upgrade; hash legacy jangan dibuang sebelum
  admin terbukti sudah PBKDF2. Event `admin_password_upgraded` dicatat sanitized
  via console (tanpa hash/plaintext).
- **Body cap admin mutation (AU-B1-3).** Mutasi JSON berautentikasi, termasuk di
  luar `src/app/api/admin/**` (produk, artikel, banner, kategori, pengaturan toko
  dan metode pembayaran), wajib memakai `readJsonBody` / `readTextBody` setelah
  autentikasi. Cap per kelas: 2–8 KB untuk aksi skalar, 16 KB untuk editor banner
  dan fulfillment DELETE, 64 KB untuk batch/reorder, 128 KB untuk variant-copy
  (4 × 4.000 code unit termasuk JSON escape), 512 KB untuk varian bulk dan editor
  produk/artikel (50.000 code unit konten artikel dapat melebihi 128 KB), 1 MB
  untuk POST fulfillment (100 kredensial × 2.000 code unit; sekitar 600 KB untuk
  UTF-8 multibyte biasa). Batas berlaku pada byte JSON di wire, termasuk escape.
  Oversize → 413 `{"error":"payload_too_large"}` dari stream aktual, bukan hanya
  Content-Length; malformed di bawah cap → 400. Upload multipart/raw dan cap
  publik/webhook tetap terpisah. Guard statis `tests/admin-body-caps.integration.test.ts`
  menolak parser body langsung di route berprivilege, kecuali upload yang didaftar.

## A-S: exception quote synthetic dan CSP Analytics — 18 November 2026 (lokal)

- Hanya header `x-axvara-synthetic:1` + Bearer `CRON_SECRET` sah constant-time
  boleh melewati bucket quote pembeli; header tanpa secret/secret kosong/salah
  tetap pembeli biasa. Tidak melewati body/produk/stok/token validation atau
  admission create order. Quote tidak membuat order/reservasi/menulis D1;
  helper `isSyntheticRequest` disediakan untuk pengecualian funnel B-S.
- Synthetic tidak refresh metode gateway: `buildMethodCatalog(subtotal,false)`;
  crypto/FX dibaca dari snapshot existing. Tidak boleh memanggil provider demi
  probe. Header cron tidak dikirim ke home/katalog/PDP, redirect manual.
- Pengecualian sempit atas larangan script/connect14Nov untuk Analytics:
  CSP publik menambah hanya `https://static.cloudflareinsights.com` di
  `script-src` dan `https://cloudflareinsights.com` di `connect-src`; wildcard,
  CSP admin/API admin dan seluruh direktif/header lain tidak berubah. Bukan
  izin menambah domain untuk gambar. QA Chrome1440/390+fixture script/connect
  tanpa error/pelanggaran CSP; belum aktivasi dashboard/deployment.

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

## Admin Cloudflare Access — 27 Oktober 2026
- Perluasan6November2026: halaman `/admin/payments/test` dan API `/api/admin/payments/test/{quote,orders}` memakai `requireAdmin` existing, tanpa bypass sesi/idle/revokasi/password/Access. Marker signed membatasi quote ke scope tes, bukan otorisasi mandiri; query/body/header tidak memberi izin. Kedua path ada di cakupan Access existing (GETanon live302ke login); webhook pembayaran tetap publik dengan HMAC, bukan blanket Access `/api`. Fitur baru menunggu rilis CI; tes fixture bukan bukti enrollment atau pembayaran live.
- Organisasi `axvara-admin-9d00b9.cloudflareaccess.com`, aplikasi AXVARA Admin dan App Launcher dibuat dengan Global API Key existing dari `.cf-credentials`; tanpa perubahan langganan. Allow policy hanya email owner, IdP PIN email, MFA independent wajib pada aplikasi admin (TOTP/biometrik/security key, sesi8jam). Launcher khusus enrollment juga hanya owner, sengaja tanpa MFA bootstrap; audience launcher tidak memberikan otorisasi aplikasi.
- Destinasi `/admin`, `/api/auth`, `/api/admin` pada apex/www/Pedia. Jangan blanket `/api`: katalog/pembeli/agent/cron/webhook berbagi domain. Path campuran dilindungi JWT Access di `checkAdminSession`, selain JWT aplikasi/idle/revokasi/password existing. UI admin host alternatif dialihkan ke apex; API alias Pages tetap memerlukan JWT Access valid.
- Pages produksi: `ADMIN_EMAIL` diganti sesuai instruksi owner; password/hash/JWT secret tidak diubah. Dua env baru `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` bertipe **secret_text**, tidak memuat seed TOTP. Konfigurasi hilang/parsial di produksi gagal tertutup. Jangan menghapus env atau melemahkan guard untuk mengatasi error login.
- Enrollment owner lewat `https://axvara-admin-9d00b9.cloudflareaccess.com/AddMfaDevice`; QR/kode hanya di UI Cloudflare, tidak di chat/log/git. Pendaftaran perangkat dan satu login aplikasi admin harus dikonfirmasi owner; kesiapan konfigurasi bukan bukti enrollment. Pemulihan faktor hilang: verifikasi owner di dashboard Cloudflare, hapus authenticator pengguna yang hilang atas instruksi eksplisit lalu enroll ulang; tidak mereset password atau mengizinkan Everyone. Rincian `issue/admin-access-2026-10-27.md`.

## Hardening OWASP — 27 Oktober 2026
- Audit/fixture dan batas bukti: `issue/owasp-audit-2026-10-27.md`; jangan menyatakan sertifikasi OWASP atau menganggap push bukti deploy.
- Detail editor produk wajib admin. API artikel publik/SSR memakai whitelist tanpa email reviewer/penulis, jadwal atau idempotency; detail admin privat tetap lengkap.
- Guard order Market/TG/WA wajib memeriksa harga snapshot, produk induk aktif, relasi produk-varian dan mode/stok di batch atomik; retry quote/order existing tetap dipertahankan.
- Migrasi0080 menambah login D1 maksimal10 gagal/in-flight per IP/jendela tetap15menit, sebelum verifikasi password/proof, selain burst5/menit. Error admission503; reset sukses hanya hash+jendela klien sama. Jangan menambah lock akun global yang memungkinkan penyerang mengunci owner dari IP lain.
- Challenge PBKDF2 publik memakai admin_subject HMAC domain admin-challenge:v1, tanpa email di JWT baru; dukungan challenge email legacy hanya sampai expiry5menit yang ditandatangani. Email salah menjalankan verifikasi sama lalu401, tanpa cabang delay pembeda akun.
- Audit login/otorisasi mutasi+baca sensitif admin memakai HMAC subjek dan label route tetap, satu event/request, tanpa IP/kontak/token/body/query mentah. Otorisasi bukan bukti mutasi berhasil. Polling read biasa tidak ditulis. Limit login/fallback audit hanya console; retensi/alert produksi belum dibuktikan.
- `GET /api/admin/orders?export=csv` dan `GET /api/admin/orders/[code]` masuk audit baca sensitif. Polling daftar tanpa ekspor tetap tidak diaudit; kode, parameter filter dan input pembeli tidak ikut dicatat.
- Cleanup hourly existing maksimal200 counter login>24jam dan500 event keamanan>**90hari** (keputusan owner 21 November 2026; sebelumnya 30hari, tetap bounded500/tick, window aktif tidak dihapus). Budget heavy cleanup naik sesuai prune log murni (lihat platform-ops). Tidak ada env/cron/secret baru. Jangan hapus window aktif.
- Batas stream aktual sebelum parse: JSON buyer32.000byte; login/lookup/kredensial/cancel/refill/subscriber8.000; webhook16.000–128.000 sesuai route; supplier-sync2MiB; MCP8MiB. Content-Length saja tidak cukup; raw text signature dipertahankan. Header browser harus ikut semua return middleware termasuk rewrite Pedia/403.
- CI dependency gate sebelum build wajib menolak high/critical runtime serta audit registry/error/schema tidak valid. Audit unit tests tanpa jaringan; pemeriksaan registry nyata terpisah. Tiga high dev Miniflare/Pages ditutup lewat Miniflare4.20260730.0 + Undici7.30.1/Sharp0.35.5; next-on-pages1.13.16 tetap. Verifikasi ulang audit/build/workerd sebelum mengubah override; dev/emulator tetap loopback. Jangan npm audit fix --force/migrasi adapter major tanpa verifikasi platform.

## Checkout anti-abuse — 27 Oktober 2026
- Market/Pedia memakai admission D1 bersama:5/IP,3/WA,3/email per jendela15menit; claim quote stabil dan increment counter satu batch. Retry paralel quote sama hanya satu slot; order existing tetap reuse. Jangan mengubah error D1 menjadi fail-open:503 sebelum order/reservasi/invoice,429 hanya saat limit. Dev tanpa D1 boleh bypass.
- Subjek disimpan HMAC-SHA256 memakai ADMIN_JWT_SECRET existing, bukan hash tanpa kunci. Normalisasi IPv6/email; jangan mempercayai x-forwarded-for. Cleanup existing bounded200 klaim+200 counter berumur>24jam, tanpa cron baru.
- Pembersihan order palsu produksi hanya atas instruksi owner, backup privat dahulu, cocokkan kode/pola kontak, lindungi paid/riwayat supplier/fulfillment dan lepaskan stok lewat expiry/transition existing. Pertahankan payment_invoice_history untuk deteksi pembayaran terlambat. Jangan menganggap pola kontak sebagai bukti satu source IP atau menjanjikan semua bot multi-IP terhenti.


## CSP gambar katalog Games — 12 November 2026 (histori), dihapus 14 November 2026

- **[DIGANTIKAN 14 November 2026]** Storefront Games tidak lagi merender gambar produk
  Sekalipay (aset resmi publisher lokal + fallback AXVARA, `docs/GAMES.md` §14), sehingga
  source path `https://sekalipay.com/images/products/` **dihapus** dari `img-src` CSP publik
  (`src/middleware.ts`). Daftar `img-src` publik kini: `'self'`, `https://images.unsplash.com`,
  `https://picsum.photos`, `data:`, `blob:`. Jangan menambah host/wildcard baru dan jangan
  mengubah `default-src`/`connect-src`/`script-src`, CSP admin, autentikasi, atau header
  keamanan lain untuk kebutuhan aset; gambar baru harus same-origin (`public/`) atau lewat
  aset yang sudah diizinkan.
- Teks 12 November di bawah adalah histori (exception path-scoped untuk gambar produk SK):
  CSP publik menambahkan satu source path-scoped `https://sekalipay.com/images/products/`
  untuk gambar produk SK yang sudah lolos allowlist server. Larangan menambah host-wide/
  wildcard dan mengubah `default-src`/`connect-src`/`script-src`/CSP admin/autentikasi/
  header lain tetap berlaku. Artefak lokal 12 November dibangun ulang; deployment tidak
  dilakukan saat itu.
