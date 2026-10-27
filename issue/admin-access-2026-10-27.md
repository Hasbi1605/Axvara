# Perlindungan admin Access — 27 Oktober 2026

Owner mengizinkan email admin diganti, password tetap, dan persiapan Google
Authenticator melalui Cloudflare Access dengan Global API Key existing.
Konfigurasi edge/Pages sudah dibaca kembali. Guard origin memakai jalur CI main;
push bukan bukti deployment atau keberhasilan login owner.

## Batas kepercayaan

Email PIN IdP hanya mengizinkan satu email owner. Aplikasi AXVARA Admin mewajibkan
independent MFA (TOTP, security key, atau biometrik), berlaku8jam. App Launcher
dibuat terpisah dengan policy owner, MFA disabled untuk bootstrap enrollment.
Audience launcher berbeda; meskipun ditandatangani team yang sama, token launcher
ditolak origin yang hanya menerima audience aplikasi admin.

Access edge mencakup `/admin`, `/api/auth`, `/api/admin` pada axvara.tech,
www.axvara.tech dan pedia.axvara.tech. Path induk mencakup anaknya. UI admin di
host alternatif diarahkan ke apex; namespace API dan path campuran di alias Pages
tidak memperoleh otorisasi admin tanpa dua sesi valid. Jangan menutup `/api`
secara keseluruhan: katalog, checkout, webhook, cron dan agent berbagi domain.

Origin memerlukan JWT aplikasi/idle/revokasi existing **dan** JWT Access RS256,
issuer team tetap, audience admin tepat, email sama dengan ADMIN_EMAIL, serta
exp/iat/sub/email. JWKS ter-pin, tanpa URL dari JWT/jku; timeout5s, cache10menit,
cooldown30s. Cookie pengguna tidak diteruskan ke endpoint sertifikat. Konfigurasi
produksi hilang/parsial, outage JWKS atau refresh cache gagal menolak akses.
Cookie Access Path dinonaktifkan agar path campuran menerima cookie, HttpOnly
dan binding cookie aktif. Binding ditegakkan edge pada destinasi Access;
origin tidak mengklaim dapat memverifikasi cookie binding Cloudflare sendiri.

Token palsu/expired menolak401 dengan alasan access_required. Auth fetch memakai
redirect manual dan navigasi penuh admin untuk memperbarui Access; outage503
tidak mengakhiri sesi aplikasi atau menyegarkan idle. Manager yang memakai fetch
biasa tetap menolak akses, dan owner dapat memuat ulang admin untuk renewal.
Logout tetap dapat mencabut cookie aplikasi tanpa faktor Access.

## Operasi dan pemulihan

1. Buka https://axvara-admin-9d00b9.cloudflareaccess.com/AddMfaDevice memakai email
   owner pada policy, bukan email akun dashboard Cloudflare. Masukkan PIN inbox.
2. Pilih Authenticator application, pindai QR di Google Authenticator dan masukkan
   kode6digit langsung di Cloudflare. Agent tidak melihat/meminta QR, seed atau OTP.
3. Tambahkan security key/biometrik cadangan bila tersedia. Cloudflare mendukung
   satu pendaftaran TOTP per pengguna; kode recovery custom aplikasi tidak dibuat.
4. Buka https://axvara.tech/admin untuk memverifikasi issuance token audience
   aplikasi setelah MFA, lalu login memakai email baru dan password existing.
   Pendaftaran saja belum membuktikan login aplikasi berhasil.
5. Bila semua faktor hilang, owner mengakses dashboard Cloudflare melalui akun
   pengelola existing, memverifikasi identitas pengguna dan menghapus authenticator
   yang hilang secara eksplisit di Zero Trust Users. Owner lalu enroll ulang dari
   portal. Jangan membuat policy Everyone, menonaktifkan guard, menghapus env atau
   mereset password untuk melewati MFA. Proses ini bukan reset melalui email saja.
6. Saat mencurigai kompromi, cabut sesi Access melalui Cloudflare dan sesi aplikasi
   melalui logout/rotasi password. Perubahan policy saja tidak diklaim langsung
   mencabut token yang sudah terbit. Jangan melakukan rollback ke kode tanpa guard
   sambil mempertahankan klaim bahwa API campuran sudah terlindungi.

Pages produksi mengubah ADMIN_EMAIL dan menambah CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD
sebagai secret_text. Readback membuktikan seluruh env lain termasuk password dan
JWT secret identik, preview identik,62+4 sistem=66/128 Paid. Tidak ada perubahan
langganan, supplier, pembayaran, D1/migrasi, cron atau dependency.

## Bukti dan batas

Fixture menggunakan RSA/JWKS lokal dan SQLite; tidak menghubungi produksi,
mengirim email, membuat order atau mengakses supplier. Kasus mencakup assertion/
cookie valid, spoof Pages, alg none/kunci penyerang, salah issuer/audience/email,
expiry/service-token, alias/Pedia login tanpa token, dua sesi pada API campuran,
password tetap/email lama dicabut, outage/cache TTL, produksi konfigurasi hilang,
redirect kanonis dan renewal. Fixture cache lama mengisolasi boundary Access;
otorisasi JWT/idle/revokasi aplikasi tetap diuji aslinya.

Global Key berhasil membuat organisasi, IdP, app dan launcher, lalu membaca
policy satu email dan MFA wajib kembali. HEAD admin tanpa sesi menghasilkan
redirect ke Access. Sebelumnya launcher belum dibuat sehingga owner menerima
NoAuth; launcher ditambahkan setelah screenshot owner. Obscura menemui batas
DOM style.media pada frontend Cloudflare. Screenshot Chrome owner mengonfirmasi
dua faktor terdaftar: TOTP dan Biometrics, keduanya bertanggal terakhir dipakai
27Oktober. Error generate registration options awal selesai sesudah owner retry,
tanpa melemahkan policy. Access log juga membuktikan login owner allowed pada
aplikasi AXVARA Admin (bukan hanya launcher)27Oktober19.10.41WIB. Tidak membaca
seed/kode lewat API. Login aplikasi dengan email baru setelah deployment CI
masih perlu dicoba owner; keberhasilan Access bukan bukti deploy aplikasi.

Sisa risiko: TOTP dapat diphishing real-time, token/cookie sesi yang dicuri tetap
berisiko selama masa berlaku, keamanan Gmail dan akun dashboard Cloudflare
memerlukan faktor/recovery terpisah. Ketersediaan admin bergantung pada Access/
JWKS; outage menolak akses. Tidak ada klaim sertifikasi OWASP atau kebal serangan.

WAF insiden checkout juga dibaca kembali sebelum publikasi: rule block enabled
untuk sumber probe terkonfirmasi pada empat POST quote/order Market/Pedia.
Rule ini tidak diklaim sebagai seluruh managed OWASP ruleset atau perlindungan
terhadap semua IP; limiter D1 dan Access/MFA tetap memiliki lingkup masing-masing.
