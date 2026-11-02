# AGENTS.md — AXVARA (Project-Specific)

## WR Jaspay - 2 November 2026
- Dokumentasi resmi tetap base `/api/v1`; jangan menebak `/api/v3`. Jaspay adalah keluarga terpisah dari Akun Premium. Proxy mendukung `POST /wr/jaspay/{products,order,status,orders}` dengan token/key existing; rilis VPS2November terverifikasi health/hash, bukan bukti deployment Pages/transaksi nyata.
- Jangan memindahkan order Premium lama atau mencocokkan invoice dari nama/waktu/feed50terbaru. Identitas Jaspay memakai namespace `jaspay:` di mirror/link WR existing; stok available=-1 adalah unlimited, bukan `max_quantity`. Sweep/diff Premium tidak boleh menonaktifkan namespace Jaspay. Maksimum jumlah harus valid dan ditegakkan server-side termasuk baris keranjang ganda.
- `ref_id` supplier wajib stabil per idempotency key; missing receipt hanya boleh mengulang POST Jaspay dengan ref dan input persis sama berdasarkan kontrak duplicate-ref, bukan membeli ulang Premium. Invoice JSP diketahui hanya diperiksa melalui Jaspay status; lease/CAS/budget/sent fence existing dipertahankan.
- HMAC webhook `X-Digitals-Signature` memverifikasi body mentah; primary invalid tidak boleh fallback ke alias legacy. Event Jaspay memakai `data.invoice`. Partial/malformed credentials tetap terenkripsi untuk tindak lanjut admin, tidak menyelesaikan seluruh item, membeli ulang atau otomatis refund buyer. Teks pembeli white-label: Diproses otomatis, bukan admin/manual atau stok instan.
- Rilis proxy harus seluruh dist dengan backup serta env/state utuh. Backup VPS tugas ini `dist.backup-jaspay-20261102`; source lokal pra-tugas dipertahankan, tidak stage/commit perubahan pihak lain tanpa izin.

## Cara membaca panduan
- Keputusan terbaru untuk topik yang sama menggantikan snapshot lama hanya pada bagian yang terkait. Batas tugas dari owner tetap berlaku; jangan memperluas scope hanya karena ada runbook di sini.
- Bagian berlabel histori/snapshot adalah bukti pada tanggalnya, bukan status produksi saat ini atau izin rollout. Jangan menghidupkan kembali fitur yang sudah dipensiunkan; kontrak kompatibilitas dan pengaman order lama tetap dijaga.
- Angka test, saldo, jumlah env dan status deployment adalah hasil pengamatan bertanggal. Gunakan bukti aktual untuk klaim baru; jangan membaca secret atau mengakses produksi hanya untuk merapikan dokumentasi.

## Kredensial pembeli: invoice + kontak + PIN — 28 Oktober 2026
- Koreksi owner menggantikan aturan PIN checkout27Oktober: PIN6 huruf+angka hanya dikirim bersama kredensial lengkap dalam email produk siap. Jangan mengirim email khusus PIN saat order dibuat/paid, mengembalikan PIN dalam respons buyer, menampilkan kartu/reveal PIN buyer, menaruh PIN dalam URL/fragment/storage atau pesan Telegram. Kredensial tetap langsung tampil dalam email.
- Kredensial web pin6 lewat lacak tanpa proof checkout asli wajib invoice + email/WA checkout penuh + PIN sebagai field terpisah. Admission D1 atomik sebelum compare, max10 gagal/in-flight per order+versi/15menit lintasIP, sukses decrement slot sendiri, error503 fail-closed. Kontak salah/PIN salah sama-sama generik404. Belum lunas/kredensial belum tersedia tidak menuntut PIN yang belum dikirim.
- Sesi status p1 HMAC256/order+versi/24jam hanya untuk GET status masked/wake melalui allowStatusSession eksplisit. Prefixb1 lama ditolak. Cancel/reissue/refill tetap kontak, tidak cukup sesi status. Pedia tanpa kredensial tidak memakai PIN untuk status/refill.
- Koreksi lanjutan owner28Oktober: tab checkout Market asli otomatis membuka kredensial sesudah paid/ready tanpa PIN. Hanya POST checkout dengan quote bertanda tangan yang cocok order durable boleh menerbitkan proof c1/HMAC256/domain terpisah/order+versi+HMAC quote_id tersimpan/expiry tetap24jam. Lookup kontak/p1/status/admin/Telegram tidak pernah menerbitkan atau memperbarui c1. Simpan c1 hanya sessionStorage/memori tab, bukan URL/localStorage/log; jangan mengirim PIN ke web. Credentials POST menerima c1 valid atau kontak+PIN, lalu capability generation CAS existing. Rotasi mencabut c1; quote/versi/order lain, metadata hilang, key hilang, belum paid/ready ditolak. Status/cancel/reissue/refill tidak menerima c1. Tidak mengubah Pedia/WA.
- Sesudah proof kontak+PIN atau c1 checkout asli, capability GET dapat disimpan sessionStorage. Migrasi0083 menambah wr_credential_tokens.buyer_access_version default0; pin6 verifier wajib versi token=current order>0, issuance INSERT SELECT CAS sesudah proof lengkap. Writer/token lama tidak boleh bypass cutover. Legacyv0 tetap kontak; code26 tetap strong-code kompatibel, tidak backfill/exchange kontak.
- PIN HMAC30bit domain buyer-order-pin dengan rejection campuran; factorybaru version1/formatpin6, migrasi0082 defaultcode26 menjaga kode128bit lama. BUYER_ORDER_ACCESS_SECRET khusus existing dari .buyer-access-credentials ignored/chmod600/Pages secret_text, produksi67/128 termasuk4 sistem. Jangan log/commit key/PIN. Password/JWT rotation tidak mengubah PIN; buyerkey rotation membatalkan seluruh kode/PIN/sesi. Key hilang503 sebelum reservasi.
- Factory order tidak lagi mengantrekan email PIN. Prefix lama email:access_pin: inert, metadata tidak dihapus. Adminrotate CAS+revoke+audit mengantrekan prefixbaru email:credential_access:order:vN hanya bila paid+kredensial tersedia; sender merender ulang kredensial lengkap+PIN versi aktual, job superseded tidak dikirim. Metadata-only, Resend idempotency order+versi+HMAC isi tanpa PIN mentah, lease CAS, increment attempt sebelum fetch, max5/backoff1/5/15/60menit, timeout8detik, notify existing bounded2/deadline/budget8statement peremail+2probe, tanpa env/cron baru.
- Reveal admin POST privat/no-store/audit tetap terpisah dari GET/cache; bukan akses buyer. Admin memverifikasi buyer di luar aplikasi, tidak ada recovery mandiri dari kontak. Jangan menambah PIN ke GET admin/list/cache.
- Browser hanya menyimpan kontak/sesi status, c1 checkout asli atau capability sementara di tab. PIN yang diketik hanya React state, jangan persist bahkan sessionStorage. History tidak menyimpan PIN/sesi. Telegram command/callback tetap pemilik/chat pribadi. Bot WA nonaktif dan di luar scope, jangan diaktifkan/DM/grup diubah.
- Rincian keputusan terkini: issue/buyer-contact-pin-2026-10-28.md; dokumen buyer-access/buyer-pin27Oktober adalah histori yang digantikan pada bagian terkait.


## Admin Cloudflare Access — 27 Oktober 2026
- Organisasi `axvara-admin-9d00b9.cloudflareaccess.com`, aplikasi AXVARA Admin dan App Launcher dibuat dengan Global API Key existing dari `.cf-credentials`; tanpa perubahan langganan. Allow policy hanya email owner, IdP PIN email, MFA independent wajib pada aplikasi admin (TOTP/biometrik/security key, sesi8jam). Launcher khusus enrollment juga hanya owner, sengaja tanpa MFA bootstrap; audience launcher tidak memberikan otorisasi aplikasi.
- Destinasi `/admin`, `/api/auth`, `/api/admin` pada apex/www/Pedia. Jangan blanket `/api`: katalog/pembeli/agent/cron/webhook berbagi domain. Path campuran dilindungi JWT Access di `checkAdminSession`, selain JWT aplikasi/idle/revokasi/password existing. UI admin host alternatif dialihkan ke apex; API alias Pages tetap memerlukan JWT Access valid.
- Pages produksi: `ADMIN_EMAIL` diganti sesuai instruksi owner; password/hash/JWT secret tidak diubah. Dua env baru `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` bertipe **secret_text**, tidak memuat seed TOTP. Konfigurasi hilang/parsial di produksi gagal tertutup. Jangan menghapus env atau melemahkan guard untuk mengatasi error login.
- Enrollment owner lewat `https://axvara-admin-9d00b9.cloudflareaccess.com/AddMfaDevice`; QR/kode hanya di UI Cloudflare, tidak di chat/log/git. Pendaftaran perangkat dan satu login aplikasi admin harus dikonfirmasi owner; kesiapan konfigurasi bukan bukti enrollment. Pemulihan faktor hilang: verifikasi owner di dashboard Cloudflare, hapus authenticator pengguna yang hilang atas instruksi eksplisit lalu enroll ulang; tidak mereset password atau mengizinkan Everyone. Rincian `issue/admin-access-2026-10-27.md`.

## WR timeout receipt — 27 Oktober 2026
- Missing-ID setelah timeout tidak boleh diikat otomatis lewat produk/waktu: WR
  tidak memberi korelasi request, akun supplier juga dapat digunakan manual.
  Admin memilih invoice lewat sync-now/SupplierLinkActions; exact-ID, identitas
  varian atau metadata mirror unik, qty/modal/paid serta CAS pemilik diperiksa.
- request_sent_at wajib durable sebelum POST; late result/error tidak menurunkan
  terminal. Rekonsiliasi known-ID tetap budget40 dengan delivery durable existing.
  Webhook terminal unmatched503, bukan ACK sukses tanpa persist. Feed WR50 terbaru
  tanpa zona/variant_id tetap didukung lewat pemilihan invoice eksplisit, bukan
  tebakan zona. Tidak membeli ulang saat invoice hilang atau di luar feed.

## Hardening OWASP — 27 Oktober 2026
- Audit/fixture dan batas bukti: `issue/owasp-audit-2026-10-27.md`; jangan menyatakan sertifikasi OWASP atau menganggap push bukti deploy.
- Detail editor produk wajib admin. API artikel publik/SSR memakai whitelist tanpa email reviewer/penulis, jadwal atau idempotency; detail admin privat tetap lengkap.
- Guard order Market/TG/WA wajib memeriksa harga snapshot, produk induk aktif, relasi produk-varian dan mode/stok di batch atomik; retry quote/order existing tetap dipertahankan.
- Migrasi0080 menambah login D1 maksimal10 gagal/in-flight per IP/jendela tetap15menit, sebelum verifikasi password/proof, selain burst5/menit. Error admission503; reset sukses hanya hash+jendela klien sama. Jangan menambah lock akun global yang memungkinkan penyerang mengunci owner dari IP lain.
- Challenge PBKDF2 publik memakai admin_subject HMAC domain admin-challenge:v1, tanpa email di JWT baru; dukungan challenge email legacy hanya sampai expiry5menit yang ditandatangani. Email salah menjalankan verifikasi sama lalu401, tanpa cabang delay pembeda akun.
- Audit login/otorisasi mutasi+baca sensitif admin memakai HMAC subjek dan label route tetap, satu event/request, tanpa IP/kontak/token/body/query mentah. Otorisasi bukan bukti mutasi berhasil. Polling read biasa tidak ditulis. Limit login/fallback audit hanya console; retensi/alert produksi belum dibuktikan.
- Cleanup hourly existing maksimal200 counter login>24jam +500 event>30hari; budget heavy cleanup10 statement. Tidak ada env/cron/secret baru. Jangan hapus window aktif.
- Batas stream aktual sebelum parse: JSON buyer32.000byte; login/lookup/kredensial/cancel/refill/subscriber8.000; webhook16.000–128.000 sesuai route; supplier-sync2MiB; MCP8MiB. Content-Length saja tidak cukup; raw text signature dipertahankan. Header browser harus ikut semua return middleware termasuk rewrite Pedia/403.
- CI dependency gate sebelum build wajib menolak high/critical runtime serta audit registry/error/schema tidak valid. Audit unit tests tanpa jaringan; pemeriksaan registry nyata terpisah. Tiga high dev Miniflare/Pages ditutup lewat Miniflare4.20260730.0 + Undici7.30.1/Sharp0.35.5; next-on-pages1.13.16 tetap. Verifikasi ulang audit/build/workerd sebelum mengubah override; dev/emulator tetap loopback. Jangan npm audit fix --force/migrasi adapter major tanpa verifikasi platform.

## Checkout anti-abuse — 27 Oktober 2026
- Market/Pedia memakai admission D1 bersama:5/IP,3/WA,3/email per jendela15menit; claim quote stabil dan increment counter satu batch. Retry paralel quote sama hanya satu slot; order existing tetap reuse. Jangan mengubah error D1 menjadi fail-open:503 sebelum order/reservasi/invoice,429 hanya saat limit. Dev tanpa D1 boleh bypass.
- Subjek disimpan HMAC-SHA256 memakai ADMIN_JWT_SECRET existing, bukan hash tanpa kunci. Normalisasi IPv6/email; jangan mempercayai x-forwarded-for. Cleanup existing bounded200 klaim+200 counter berumur>24jam, tanpa cron baru.
- Pembersihan order palsu produksi hanya atas instruksi owner, backup privat dahulu, cocokkan kode/pola kontak, lindungi paid/riwayat supplier/fulfillment dan lepaskan stok lewat expiry/transition existing. Pertahankan payment_invoice_history untuk deteksi pembayaran terlambat. Jangan menganggap pola kontak sebagai bukti satu source IP atau menjanjikan semua bot multi-IP terhenti.

## GoPay Merchant pribadi — 27 Oktober 2026
- Koreksi29Oktober: setelah gate/hold/backoff lolos, poller memanggil SDK `refreshSession()` sebelum GET feed agar expiry tersimpan diperiksa tanpa bergantung hanya pada401. Token valid tidak menambah request refresh; persist gagal menghentikan feed. Tidak ada refresh kedua manual setelah kegagalan401. Patch lanjutan snapshot27Oktober: `issue/patches/gopay-session-expiry-2026-10-29.patch`; bukti/batas pemulihan di `issue/gopay-session-expiry-2026-10-29.md`.
- Owner memilih pola pengaman AutoGoPay di server AXVARA, bukan memakai layanan/API AutoGoPay. Merchant yang dipilih kembali: Axvara Digital, G564039370, NMID ID1024342457479, nomor082135277434. Sesi/nomor/outlet aktif diperiksa baca-saja; ini bukan bukti pembayaran end-to-end atau jaminan bebas suspend.
- Payload QR owner berada di `.gopay-credentials` ignored/chmod600. Pages hanya mengubah tiga secret_text existing: GOPAY_STATIC_QRIS, GOPAY_QRIS_ENABLED=true, QRIS_ACTIVE_PROVIDER=gopay. GOPAY_POLLER_SECRET existing tetap; semua kredensial/callback KlikQRIS dipertahankan. Invoice tersimpan tetap pada provider/merchant asal, termasuk initializing KlikQRIS yang hanya boleh dipulihkan lewat GET.
- QR GoPay dihitung lokal, satu original + maksimal satu reissue setelah expiry; QR aktif/retry tidak dibuat ulang. Pilihan GoPay tidak lengkap gagal tertutup, tanpa fallback DANA. Nominal retry harus sama; pemenang race GoPay dibaca dari provider yang benar.
- Callback wajib x-poller-secret DAN x-poller-signature HMAC-SHA256 atas body mentah memakai secret existing. Bukti wajib order_code/event_id/merchant_id/currency IDR/status settlement|capture/paid_at berzona; merchant dari payload invoice, waktu dan nominal diperiksa. Kode berbeda tidak fallback ke order lain. Paid/outbox atomik mendahului background fulfillment dengan waitUntil.
- Rilis poller bertanda tangan di VPS SEBELUM push receiver Pages. Source `/Users/macbookair/axvara-gopay-poller`, snapshot lengkap di issue/patches/gopay-hardening-2026-10-27.patch. Salin SELURUH dist, backup dahulu, pertahankan .env/dua sesi/berkas .poll-state. Rollback receiver baru memerlukan poller yang tetap bertanda tangan.
- Poll GoBiz minimal15detik, cadence15/30/60detik menurut umur invoice terbaru (<2/<5/≥5menit), satu loop, nol query GoBiz saat idle. Wake/tick tidak melewati gate; interval/backoff/hold durable per sesi. SDK refresh401 sekali; poller tidak menambah refresh. Sesi mati/persist gagal/403 restriction menjeda akun sampai sesi diganti manual; jangan reset .poll-state untuk menghindari pembatasan. Transport hanya GET mutasi + POST token refresh, tanpa redirect, transfer atau generate QR upstream. Penyebab suspend lama tidak diketahui.

Proxy WR/SK — 26 Oktober 2026: dispatcher egress dipakai bersama dan ditutup
saat shutdown; URL proxy terkonfigurasi yang invalid menghentikan startup.
VPS tanpa URL proxy memakai IP tetapnya secara langsung. Diff removal WR/SK
dipotong terpisah maksimal 200 ID per request, hanya ACK sukses memajukan
snapshot; sisa ID dan payload induk berubah tetap pulih setelah restart.
Validasi body menghitung byte UTF-8, path SK menolak traversal. Rilis wajib
menyalin seluruh `dist/` (index/diff-sync/psmm/psmm-diff dan modul tambahan),
backup dahulu, pertahankan `.env`, snapshot dan direktori idempotensi durable.
Tes transport memakai MockAgent tanpa jaringan; tidak menambah retry pembelian.

Perbaikan VPS GoPay 25 Oktober: dedupe mutasi hanya setelah respons Pages
HTTP 2xx + JSON `ok:true` dengan status `paid|already_paid|duplicate|unmatched`.
HTTP 4xx/5xx, redirect, atau respons rusak tetap retry pada cadence existing dengan event ID
sama. `/tick` legacy menjadi alias wake berantrean (`status:true,queued:true,eta_ms`)
agar tidak menjalankan poll/refresh sesi paralel atau melewati jarak minimum.
Source `axvara-gopay-poller/src/pages-forward.ts`; rilis VPS terpasang
25 Oktober, 21.21 WIB. Deploy seluruh dist ke
`/opt/axvara/gopay/app/dist`, tanpa mengubah sesi/env atau membuat invoice baru.

## Keandalan dispatch supplier — 25 Oktober 2026
- Setelah KlikQRIS paid, pekerjaan segera memakai `payments/paid-fulfillment.ts` + Cloudflare `ctx.waitUntil`; jangan mengikat POST supplier pada umur request browser. Materialisasi dan bind WR/SK mendahului fulfillment umum; immediate hanya order yang baru lunas, satu link/supplier, sisanya cron existing.
- HTTP5xx generik dan receipt tanpa order_id/invoice atau ref SK yang berbeda adalah ambigu: request_sent_at/ref_id dipertahankan, hanya rekonsiliasi. Hanya penolakan eksplisit SK PRODUCT_TEMPORARILY_UNAVAILABLE yang boleh retry biasa. Jangan mengubah404/timeout menjadi izin membeli ulang otomatis.
- Proxy WR/SK mengembalikan marker `wr_proxy_unreadable_response: network_error` / `sk_proxy_unreadable_response: network_error` untuk respons tulis2xx tak terbaca; kata network mempertahankan kompatibilitas Pages lama saat rollout. Sinkronkan kontrak di AGENTS proxy, README dan ARCHITECTURE.
- Pengujian supplier memakai fixture. Pemulihan order produksi hanya atas instruksi owner, verifikasi referensi/riwayat/debit dahulu, referensi tetap sama; jangan mencampur pemulihan dengan pengujian berbayar tambahan.

> ⚠️ Scope: aturan ini **HANYA untuk folder `axvara/`**.
> Jangan ubah `/Users/macbookair/AGENTS.md` global. File ini adalah source of truth untuk agent yang kerja di project AXVARA.

## Kebijakan Pedia 24 Oktober 2026 (menggantikan kredit pada snapshot lama)
- Spec terkini `docs/pedia/manual-resolution-2026-10-24.md`: QRIS per order, tanpa wallet/deposit/kredit/refund otomatis.
- Partial/canceled disimpan atomik dengan antrean tindak lanjut manual; pembayaran paid tetap paid. Unknown remains jangan diasumsikan nol.
- Arsip kredit/ledger lama dipertahankan, tidak dapat dibelanjakan. Retry order yang sudah tersimpan mempertahankan nominal; quote lama berkredit tanpa order ditolak sebelum mutasi.
- Expiry reservasi pra-pensiun dibalik sekali hanya ke arsip beku + follow-up owner. Penyelesaian dengan pembeli di luar AXVARA, bukan saldo baru.
- Status Pedia wajib kontak checkout penuh; kredensial Market mengikuti aturan PIN/proof checkout 28 Oktober di atas beserta kompatibilitas legacy, bukan kontak saja untuk order PIN6. Pengecualian admin24Oktober: adminView hanya sesudah requireAdmin server-side, URL tanpa kontak/token buyer dan tidak menerbitkan capability buyer. Tidak menampilkan kode kredit lama ke browser.

## Tujuan
AXVARA — Gerbang Semua Tools Premium. Toko digital premium Apple Store + glassmorphism, QRIS per order dengan provider tersimpan, hosting Cloudflare Pages + D1 + R2. Workflow: pahami scope → implementasi kecil → verifikasi sesuai dampak → catat changelog → commit/push otomatis → selesai.

## WAJIB dibaca dulu (context)
Sebelum ubah kode di `axvara/`, baca bagian yang relevan dari rujukan berikut;
tidak perlu membaca ulang seluruh riwayat untuk setiap tugas. Untuk dokumentasi
saja, telusuri sumber yang diperlukan untuk membuktikan isi perubahan.
1. `docs/PRD.md` — requirement, flow dan kontrak pembayaran terkini; jangan mengambil provider aktif dari contoh pembayaran lama
2. `docs/DESIGN.md` — token Midnight #080C1E/#070a1e + Cyan #00E5FF + Gold #FFB800, SF Pro, Liquid Glass
3. `docs/ARCHITECTURE.md` — stack Next 15 + Pages + D1 + R2, schema, API contract, wrangler
4. `README.md` — struktur, brand, cara jalan & deploy
5. `CHANGELOG.md` (root `axvara/`) — riwayat perubahan, baca dulu biar tidak duplikasi

Jika perubahan mengubah struktur folder, route `src/app/*`, komponen `src/components/storefront/*`, `drizzle/schema.sql`, `wrangler.json`, `mcp-worker/wrangler.toml`, atau flow checkout/admin, **perbarui `docs/ARCHITECTURE.md` dan `README.md` di PR yang sama**.

## Cara bekerja
- Perubahan sekecil mungkin yang tetap selesaikan masalah.
- Jangan refactor besar tanpa diminta.
- Jika ragu, tulis asumsi eksplisit di `CHANGELOG.md` atau komentar PR.
- Worktree boleh berisi perubahan tugas lain. Jangan menimpa, stage atau commit perubahan tersebut; periksa diff dan stage hanya file/hunk milik tugas ini. Jika file yang sama berubah dari luar saat dikerjakan, berhenti dan koordinasikan dahulu.

## CI/CD dan push GitHub (WAJIB)
- Jalur deploy normal hanya melalui `.github/workflows/ci.yml`: push ke `main` menjalankan test/type-check root + test/build gateway, build Pages, migrasi D1 yang belum diterapkan, rilis gateway lewat Heroku source/build API bila source/release berubah, deploy Pages, lalu deploy MCP Worker. Secret CI `HEROKU_API_KEY_AKUN1` berasal dari `.heroku-credentials` ignored; jangan push Heroku manual.
- Sebelum build/migrasi, `scripts/ci-pages-env-check.cjs` membaca metadata env produksi Pages dan menghitung secret/text + empat variabel sistem Pages terhadap batas paket aktual (Paid 128, Free 64) lewat metadata langganan. Melebihi batas/API gagal menghentikan rilis; tepat batas paket memberi warning. Jangan log nilai secret. `PEDIA_DISPATCH_ENABLED` sudah dihapus 2026-10-18 karena tidak dipakai kode; bukan gate dispatch. Secret KlikQRIS/DANA/GoPay tetap dipertahankan.
- Pemeriksaan migrasi memakai `scripts/ci-d1-migrations.cjs`: tanpa query D1 hanya bila berkas migrasi + schema + wrangler identik dengan ancestor rilis `ci.yml` push main yang tahap migrasi dan deploy Pages-nya terbukti sukses. Bukti tidak lengkap/API gagal/berkas DB berubah → Wrangler remote wajib tetap lulus; jangan mengabaikan error migrasi atau menganggap push sebagai bukti deploy. Setelah restore/recreate D1, periksa migrasi remote sebelum memakai bukti rilis lama.
- Setelah perubahan kode/dokumentasi, verifikasi sesuai dampak, dan changelog selesai, otomatis commit lalu `git push origin main`; tidak perlu meminta izin publikasi lagi. Audit baca-saja tidak menghasilkan commit; instruksi eksplisit owner untuk tidak commit/push tetap mengalahkan default ini.
- Begitu `git push` berhasil diterima GitHub, **berhenti**. Jangan memantau/polling GitHub Actions atau Cloudflare dan jangan menunggu hasil deployment.
- Jangan menjalankan `npm run deploy`, `npm run deploy:mcp`, atau deploy Wrangler manual setelah push. Deploy manual hanya untuk recovery jika diminta eksplisit oleh user.
- Cloudflare Git integration dinonaktifkan untuk deployment otomatis; GitHub Actions adalah satu-satunya CI/CD agar satu push tidak memicu deploy ganda.


### Workers Paid dan unit unik — 2026-10-23
- Paket Workers Paid aktif pada akun existing; CI membaca metadata langganan melalui `scripts/cloudflare-plan.cjs`, tanpa env/secret baru. Preflight variabel mengikuti Paid128/Free64; API/metadata gagal menghentikan rilis.
- Cron MCP existing setiap menit: payments/expiry/fulfillment/WR/SK/Pedia/notify/promo; cleanup dan publish artikel tetap lima menit, heavy hanya menit00. Tidak menambah trigger atau loop polling server tanpa batas. Cadangan KlikQRIS maksimal empat GET invoice aktif per tick, bukan create/reissue; validasi otoritatif dan late-payment manual tetap.
- Fulfillment lite mempunyai budget96 statement dan maksimal empat unit/job; job lain tetap40. Jalur immediate multi-unit yield sesudah40 detik sebelum unit berikutnya untuk menjaga lease. Jangan meniadakan budget, lease, snapshot, atau dedupe supplier.
- Unit unik baru ditandai server `unique_units:true` dan mode unique dalam `orders.items` yang tetap teragregasi. Manifest menambah unit ekstra SESUDAH index baris asli agar link supplier tetap benar. Total maksimal10 di web/Telegram, reservasi qty utuh atomik, bukan memotong stok dahulu lalu memilih satu akun. Jangan memecah/menulis ulang order lama, membuka DM WA, atau membeli ulang unit gagal.
- Monitor D1 memakai periode Paid dari metadata dan jatah25miliar baca/50juta tulis per bulan; Free tetap harian. Proyeksi bukan invoice, dapat mencakup pemakaian Free sebelum upgrade. Alert budget eksternal tetap email, tanpa pemutusan layanan.
- Rincian kontrak/rollback: `docs/PAID-OPERATIONS.md`, `docs/UNIQUE-UNITS.md`. Pengujian memakai fixture tanpa transaksi supplier berbayar.

### PG KlikQRIS — 2026-10-18
- API/PNG wajib `redirect: "manual"` + tolak non-2xx; `redirect: "error"` ditolak workerd sebelum jaringan. Verifikasi adapter di runtime workerd, bukan hanya fetch mock. Retry quote existing dan aksi manual `wake=1` memulihkan initializing hanya melalui GET; jangan POST ulang untuk 404/timeout ambigu atau membuat reservasi baru.
- Sumber kredensial `.klikqris-credentials` (git-ignored, chmod600). Pages secret_text: KLIKQRIS_API_KEY, KLIKQRIS_MERCHANT_ID, KLIKQRIS_ENABLED=true, QRIS_ACTIVE_PROVIDER=klikqris. Jangan log/commit/masukkan key atau signature ke browser. Callback per invoice `/api/payments/klikqris/callback`.
- Keputusan owner: batas otomatis AXVARA tetap 15 menit; owner mengonfirmasi setting expiry KlikQRIS juga15menit pada24Oktober (uji awal18Oktober60menit). Deadline tetap mengambil batas paling awal order/lokal/provider. Pembayaran terlambat masuk Rekonsiliasi + alert admin, tanpa revive/refund/fulfillment otomatis. Callback signature + status API wajib cocok; konfirmasi gagal tidak boleh dianggap paid.
- Notifikasi buyer24Oktober: POST create menyertakan `whatsapp_buyer` hanya dari `orders.customer_wa` valid, dinormalisasi62 tanpa plus, maksimal15digit. Kosong/invalid/email/JID/ID Telegram diabaikan, tanpa fallback nomor admin/bot. Invoice existing/initializing tidak di-POST ulang untuk menambah nomor. Pengiriman success/expired dikelola KlikQRIS (langganan aktif + sesi pengirim owner); status WA bukan bukti paid. Gateway grup AXVARA dan pacing-nya terpisah, tanpa DM baru melalui gateway AXVARA atau env/cron baru.
- Ledger klaim sebelum POST; retry ambigu hanya GET order ID sama. Pertahankan stok in-flight. Migrasi 0069 hanya menambah provider_qris_url; DANA/GoPay lama tetap dilayani dan tidak dipindah provider. Tidak ada cron baru.
- Build maintenance saat rilis KlikQRIS false. Rollback memakai rilis CI; pertahankan key/merchant/flag KlikQRIS untuk invoice lama dan penanganan late payment. Lihat ARCHITECTURE §16.11/README.

### Maintenance pembayaran — 2026-10-18
- Switch build publik `NEXT_PUBLIC_PAYMENTS_MAINTENANCE="true"` pada langkah build Pages di `ci.yml` menghentikan pembayaran baru web/Telegram/WA dan reissue, dengan pemberitahuan order manual via hub WA. Ini nilai build nonrahasia, bukan env/secret runtime Pages.
- Pemulihan: ubah nilai CI ke `"false"`, verifikasi, commit/push; perubahan env Cloudflare saja tidak mengubah bundle lama. Dev memakai prefix env; test menguji kedua mode.
- Jangan menonaktifkan webhook/status/fulfillment/cleanup atau menghapus invoice lama. Mode terpisah dari kuota D1, tanpa auto-resume/estimasi jam selesai atau siaran massal otomatis.

### Operasional D1 lanjutan — 2026-10-17
- Migrasi 0068 menambah indeks inventory/recipient dan `supplier_pair_dirty`.
  Trigger invalidasi atomik mengganti token versi; ack hanya menyetel pending=0,
  jangan menghapus/reset token (pelindung race terhadap proses/sweep lama).
- Request VPS `action:pairs` tetap bentuk existing, kini menguras maksimal 10
  pasangan pending; error 503 menyisakan antrean. Cron lite cleanup existing
  juga menguras antrean tiap tick selama budget cukup, termasuk perubahan WR
  saja/retry; sweep penuh hourly tetap cadangan, tulisnya dijaga versi.
- `.github/workflows/d1-usage.yml` HANYA baca GraphQL Analytics akun per jam
  pada menit 17/manual; tidak query SQL/deploy. Memakai Secrets CI existing,
  laporan agregat dan warning/job gagal untuk risk/exhausted/unknown. Notifikasi
  mengikuti pengaturan GitHub owner; tidak ada pesan Telegram monitoring baru.
- Target ≤3 juta reads/hari harus diukur satu siklus 07.00–07.00 produksi,
  jangan menyamakan hasil benchmark fixture atau push dengan bukti tercapai.

## Aturan Test (WAJIB)
Setiap perubahan kode wajib memiliki cakupan test yang sesuai. Tambah atau
perbarui test bila perilaku/kontrak berubah atau cakupan belum cukup; jangan
mengubah assertion hanya supaya kode yang salah terlihat lulus.

- Selama iterasi, jalankan test terkait setelah satu perubahan logis, misalnya `npx vitest run tests/nama.test.ts`; ini contoh path, ganti dengan test yang benar-benar ada.
- Sebelum commit/push perubahan kode, jalankan seluruh suite `npx vitest run --run` pada tree akhir. Tidak perlu mengulang seluruh suite setiap edit kecil; ulangi bila ada perubahan kode setelah verifikasi akhir.
- Jika ada test yang gagal akibat perubahan yang kamu buat, **perbaiki test tersebut di commit yang sama** — jangan push dengan test gagal.
- Jika mengubah output/format fungsi (misal menghapus field, mengubah teks, rename identifier), cari semua test yang assert output lama: `grep -rn "string_lama" tests/`.
- Jika mengubah nilai di `src/lib/site.ts` atau konstanta global lain, cari semua test yang hardcode nilai lama.
- Jangan menghapus test tanpa alasan — update assertion agar sesuai perilaku baru.
- Test harus **hijau seluruhnya** sebelum push perubahan kode. Ambil jumlah/hasil dari output run aktual, bukan angka tetap atau asumsi bahwa entri teratas `CHANGELOG.md` selalu memuat hasil test. Dokumentasi/instruksi saja mengikuti pemeriksaan dokumentasi pada tabel verifikasi.

## Aturan Dokumentasi (WAJIB — bukan cuma changelog)
Setiap perubahan perilaku/kontrak/env/arsitektur WAJIB dicatat di SEMUA dokumen
yang relevan dalam PR/commit yang sama — bukan cuma `CHANGELOG.md`:

| Jenis perubahan | Dokumen yang WAJIB ikut di-update |
|---|---|
| Perilaku produk / requirement / flow / payment spec | `docs/PRD.md` (status implementasi/publikasi/deployment sesuai bukti) + `CHANGELOG.md` |
| Token warna, font, layout, komponen, animasi, aset visual | `docs/DESIGN.md` + `CHANGELOG.md` |
| Struktur folder, route `src/app/*`, komponen storefront, `drizzle/schema.sql` atau migrasi baru, `wrangler.json`, flow checkout/admin, kontrak bot/webhook, env baru, cron, flag | `docs/ARCHITECTURE.md` + `README.md` (bagian terkait) + `CHANGELOG.md` |
| Env Pages baru/diubah, kredensial, handoff Heroku/Cloudflare | `docs/ARCHITECTURE.md` §16 + `README.md` + AGENTS.md folder terkait |
| Kontrak antar-repo (proxy/gateway/bot/QRIS) | AGENTS.md di SEMUA folder yang terpengaruh |

Aturan: (1) Bila kode dan docs berbeda, telusuri keputusan owner, requirement
terkini dan test; bisa jadi bug kode, docs basi, atau perubahan yang belum
disetujui. Perbaiki sisi yang salah, jangan otomatis mengubah docs untuk
membenarkan perilaku kode. Jika kontrak belum jelas, tanyakan sebelum mengubahnya;
(2) Bedakan implementasi lokal, publikasi melalui CI dan deployment terverifikasi.
Jangan menandai live tanpa bukti deployment atau mempertahankan label rencana
sebagai status terkini bila sudah terbukti live; catatan lama harus berlabel
histori/snapshot; (3) Checklist sebelum selesai memeriksa dokumentasi yang
relevan, bukan cuma test.

## Aturan Changelog (WAJIB — khusus axvara)
Setiap kali ubah kode/docs di `axvara/`, **WAJIB catat di `axvara/CHANGELOG.md`** (bukan di AGENTS.md global):

- Tambah entri baru di **paling atas** (terbaru di atas), append-only, jangan hapus entri lama.
- Format: `- YYYY-MM-DD — <ringkas perubahan> — <file/area utama> — (verifikasi: <hasil>)`
- Satu entri per perubahan logis. Ringkas, faktual, sebut file/area.
- Contoh: `- 2026-08-31 — Pasang logo Prism wireframe di Navbar/Footer — public/brand/axvara-mark.svg, src/components/storefront/Navbar.tsx — (verifikasi: dev GET / 200, CSS 200, build pass)`
- Changelog melengkapi `issue/` — ia adalah indeks ringkas semua perubahan axvara.

## Verifikasi WAJIB (berdasarkan dampak perubahan)
Pilih pemeriksaan sesuai area yang berubah, bukan alat tertentu. Perubahan kode
tetap mengikuti Aturan Test di atas. Catat perintah, hasil aktual dan batas bukti;
pemeriksaan yang tidak relevan boleh `N/A` dengan alasan.

| Jenis perubahan | Verifikasi yang diperlukan |
|---|---|
| Dokumentasi/instruksi agent saja | Periksa diff, konsistensi aturan, path/perintah yang dirujuk dan `git diff --check`; tidak wajib dev server, browser, Vitest atau build. |
| UI/CSS/komponen web | Test terkait, route dev beserta aset CSS/JS, inspeksi desktop/mobile dan interaksi yang berubah di browser nyata. Periksa keyboard/fokus, overflow serta loading/error/empty state yang relevan. |
| Flow checkout/admin atau autentikasi | Test handler/integrasi untuk proof, state, error dan retry yang terpengaruh; uji interaksi browser bila flow web berubah. Gunakan fixture, bukan transaksi produksi. |
| API/DB/cron/bot/supplier tanpa perubahan web | Test logika/kontrak/integrasi yang terpengaruh; cek runtime workerd bila memakai fitur D1/Workers. Tidak wajib screenshot homepage atau browser. |
| Konfigurasi aplikasi/toolchain/routing besar atau persiapan rilis | Validasi konfigurasi/type-check dan build yang sesuai target (`npm run build` atau `npm run build:pages`); dev server bukan pengganti bukti kompatibilitas Pages/workerd. |

### Browser dan batas bukti
- Tidak ada kewajiban memakai Obscura. Browser nyata seperti Chromium melalui
  Playwright MCP, Chrome DevTools MCP atau browser Paseo boleh dipakai. Untuk
  perubahan visual/interaksi web, utamakan browser nyata yang mewakili pembeli.
- Obscura opsional untuk smoke test/diagnosis. Jika dipakai, baca skill `obscura`;
  perbedaan renderer/Web API tidak boleh dianggap otomatis sebagai bug aplikasi
  atau diatasi dengan mengubah UI khusus Obscura. Konfirmasi perilaku yang
  terpengaruh di browser nyata sebelum menyatakan verifikasi web lengkap.
- HTTP 200, judul/H1 dan PNG nonblank hanya smoke test. Jalankan aksi yang berubah,
  periksa hasil/state serta console/network; screenshot tanpa interaksi bukan
  bukti flow checkout/admin berhasil. Fixture bukan bukti transaksi produksi.
- Jika browser/runtime yang dibutuhkan tidak tersedia, laporkan bagian yang belum
  diverifikasi; jangan mengganti pemeriksaan itu dengan klaim lulus dari alat lain.
  Jangan membuat order berbayar, mengirim pesan/email atau memutasi produksi untuk QA.

### Dev server hanya bila diperlukan
Gunakan server existing yang sesuai workspace. Jika perlu server baru, jalankan
dari `/Users/macbookair/axvara` dan pastikan port tidak dipakai tugas lain:
```bash
node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1
```
Periksa route yang berubah, aset CSS/JS dari URL yang benar-benar dikembalikan
halaman, serta log sesi dev tersebut. `GET / 200` dan CSS `200` diperlukan bila
perubahan memengaruhi homepage/layout global, bukan untuk semua tugas.
Jika port macet/CSS 404, identifikasi proses dan penyebab dahulu; jangan otomatis
`kill -9` seluruh proses port 3000 atau menghapus `.next` milik sesi bersama.

## Kredensial Cloudflare (WAJIB)
- File sumber tunggal: `axvara/.cf-credentials` — berisi `CLOUDFLARE_API_KEY` / `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_EMAIL` (account `Sailinnadia1@gmail.com`).
- **File ini di-ignore git** (`.gitignore: .cf-credentials*`) — JANGAN pernah commit/push, jangan echo isinya di log/chat.
- Deploy CI/CD memakai GitHub Actions Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`. Operasi Cloudflare manual/recovery WAJIB mengambil kredensial dari `.cf-credentials` dengan `set -a; source .cf-credentials; set +a`.
- Jangan hardcode key di kode/docs/AGENTS.md — rujuk file ini saja.

## Kredensial Resend + bot email (WAJIB)
- File sumber tunggal: `axvara/.resend-credentials` — berisi `RESEND_API_KEY` + `WR_EMAIL_WEBHOOK_SECRET` + `FORWARD_FROM_EMAIL` (pengirim `noreply@axvara.tech`, domain verified Tokyo).
- **File ini di-ignore git** (`.gitignore: .resend-credentials*`) — JANGAN pernah commit/push, jangan echo isinya di log/chat. Aturan yang sama dengan `.cf-credentials`/`.heroku-credentials`.
- Script Apps Script final (dengan secret terisi) HANYA di `/tmp/axvara-wr-forwarder-paste.js` (di luar repo, `*forwarder-paste*` di-ignore) — JANGAN tulis secret ke `docs/WR-EMAIL-FORWARDER.gs.js` (masuk git).
- Rotasi: generate baru → update file ini → update 3 Pages Secrets (`secret_text`) → redeploy → update Apps Script.

## Kredensial AWS (VPS proxy WR/SK) (WAJIB)
- File sumber tunggal: `axvara/.aws-credentials` (git-ignored `.aws-credentials*`, chmod 600) — berisi `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_DEFAULT_REGION=ap-southeast-1` milik IAM user `kiro-monitor`. Pakai: `set -a; source .aws-credentials; set +a` lalu `aws ...` (env var mengalahkan profile `default`/root). JANGAN commit/echo nilainya.
- Izin `kiro-monitor`: `ReadOnlyAccess` + baca billing/kredit (Cost Explorer, freetier, budgets) + `ec2:Start/Stop/RebootInstances` HANYA untuk `i-022790eb6bb0b1be3` (`axvara-proxy-sg`). Aksi di luar izin (security group, resize, snapshot, resource baru) → minta owner.
- Ubah isi VPS (deploy proxy, restart service, log) lewat SSH `ec2-user@13.228.147.90` + `~/.ssh/axvara-sg-proxy.pem`, bukan IAM.
- Cabut akses: IAM → Users → `kiro-monitor` → hapus access key (lalu hapus file ini). Key admin permanen `nasikuning` DINONAKTIFKAN 2026-10-04 — jangan dipakai/diaktifkan lagi tanpa izin owner.

## Sebelum menyelesaikan percakapan (checklist)
Agent **wajib** memeriksa butir yang berlaku sebelum jawab "selesai"; butir yang
tidak relevan ditandai `N/A` dengan alasan, bukan dijalankan sebagai formalitas:
- [ ] Verifikasi sesuai tabel dampak di atas lulus; perubahan kode memenuhi Aturan Test, dokumentasi saja cukup pemeriksaan dokumentasi
- [ ] `CHANGELOG.md` sudah di-update bila ada perubahan file; audit baca-saja tidak memerlukan entri
- [ ] Jika web terdampak: route dan aset relevan termuat, log dev/console tidak memuat error baru terkait perubahan
- [ ] Jika UI/flow web berubah: desktop/mobile serta interaksi relevan diperiksa di browser nyata dan alat/hasil/batas verifikasi dicatat; Obscura opsional
- [ ] Dokumentasi: tabel Aturan Dokumentasi di atas sudah dipenuhi (PRD/DESIGN/ARCHITECTURE/README/AGENTS folder terkait ikut di-update sesuai jenis perubahan)
- [ ] Jika ubah struktur/flow, `docs/ARCHITECTURE.md`/`README.md` ikut di-update
- [ ] Kredensial tidak masuk file tracked/staged; periksa daftar file `git ls-files` dan `git diff --cached --name-only` tanpa mencetak nilainya. `git check-ignore -v .cf-credentials` hanya memeriksa aturan ignore, bukan bukti bahwa secret tidak pernah ter-commit.
- [ ] Jangan pernah ubah `/Users/macbookair/AGENTS.md` global

## Ekosistem terkait (WAJIB TAHU sebelum ubah integrasi)
Repo ini tidak berdiri sendiri. Rujukan folder lokal terkait:

| Folder lokal | Peran | Keterkaitan dengan repo ini |
|---|---|---|
| `/Users/macbookair/axvara-wa-gateway` | Arsip gateway/session lokal. Source kanonis sejak24Oktober ada di `axvara/gateway/`, app Heroku akun#1 tetap existing. `/wr/*` tetap410 | `WHATSAPP_GATEWAY_URL` + `WHATSAPP_WEBHOOK_TOKEN` Pages ↔ `AXVARA_WEBHOOK_TOKEN` gateway. Deploy hanya CI main AXVARA; jangan push Heroku/upload session arsip. Baca `gateway/AGENTS.md` dan ARCHITECTURE §16.12 |
| `/Users/macbookair/axvara-qris-gateway` | Riset QRIS DANA + nilai rujukan (`DOKUMENTASI_PRODUKSI.md`, `.env` = payload statis Brotherstore06 + secret). BUKAN deploy target | `DANA_STATIC_QRIS` + `DANA_WEBHOOK_SECRET` Pages berasal dari sini. Engine prod ada di `src/lib/payments/dana-qris.ts` |
| `/Users/macbookair/axvara-wr-proxy` | Source proxy WR/SK (live di VPS AWS `https://wr-proxy.axvara.tech` sejak 2026-10-02; app Heroku akun #2 + QuotaGuard DIHAPUS TOTAL hari yang sama — akun #2 kini kosong) | `WARUNG_REBAHAN_PROXY_URL/TOKEN` + `SEKALIPAY_PROXY_URL` Pages menunjuk ke VPS. Kontrak: `POST /wr/:endpoint` + `/sk/*` + `x-proxy-token`, key server-side; potongan katalog cron `POST /wr/products-slice` + `GET /sk/catalog-slice` (2026-10-04, urutan WAJIB sama dengan `src/lib/{warung-rebahan,sekalipay}/sync.ts`). Diff katalog: VPS → `POST /api/supplier-sync` tiap 3 mnt (secret `SUPPLIER_SYNC_TOKEN` di Pages + `.env` VPS, nilai sama). Deploy VPS: lihat `axvara-wr-proxy/AGENTS.md` |
| `/Users/macbookair/axvara-tg-bot` | Kredensial + rujukan Bot Telegram (kode bot tetap di repo ini: `src/lib/telegram/`) | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_ADMIN_CHAT_ID` Pages dicatat di sana. Isi manual, lalu set sebagai `secret_text` |

Aturan lintas-repo: (1) Env Pages bertipe `secret_text` SELALU (plain_text tidak terbawa deploy); (2) Jangan `wrangler pages deployment create` tanpa direktori (me-redeploy artefak lama = rollback prod); (3) Deploy hanya via CI (`git push origin main`); (4) Perintah Heroku akun #2 wajib prefix `HEROKU_API_KEY=<kunci-akun-2>`.

Notifikasi grup24Oktober: pencarian AXVARA'S menyetarakan NFKC/trim/kapitalisasi
dan apostrof ’/‘/ʼ → ', tanpa substring. Nama setara ganda ditolak; ID pin PG
tidak berpindah otomatis. Gateway status memberi `groupName` kanonis untuk
validasi aktivasi Pages dan `groupSubject` asli hanya setelah grup/izin lolos.
Bot tersambung tidak perlu pairing ulang untuk perbaikan nama.

Ganti nomor bot24Oktober: nomor awal6283181632507 hanya bootstrap. Pilihan aktif,
revisi dan pin grup disimpan singleton PG axvara_wa_runtime. Admin menjeda D1 lalu
gateway mengganti sesi manual lewat mutex/CAS; prefix auth tiap nomor terisolasi,
sent/unknown/cooldown tetap, tanpa rotasi otomatis. Aktivasi/pair/send diikat
nomor+revisi; tab basi termasuk A→B→A ditolak. Tidak perlu env baru. Rollback setelah
pergantian harus ke rilis kompatibel runtime/revisi; jangan rollback ke kode nomor
tetap. Rincian di gateway/AGENTS.md dan ARCHITECTURE §16.12.

Siaran+welcome24Oktober: menu Konten → Siaran memakai template reusable (maks200,
migrasi0077) + snapshot kampanye atomik; tujuan grup WA terverifikasi/subscriber
email active/user Telegram pribadi non-blokir/non-opt-out. Worker cron lite existing
maks8/tick, hasil ambigu unknown tanpa kirim ulang; opt-out email token acak dan
Telegram /stop. Sambutan hanya dari event group add via /api/whatsapp/group-events
→ outbox group_welcome dedupe SHA256 harian; chat biasa tidak lagi menyapa/mencari
produk. Gateway /send-broadcast//send-welcome namespace key terpisah. Rincian di
gateway/AGENTS.md, ARCHITECTURE §16.13, issue/broadcasts-welcome-2026-10-24.md.

### Histori Pedia (dipindah 2 November 2026)
- Snapshot Pedia 12, 15 dan 19 Oktober 2026 dipindah utuh tanpa perubahan isi ke `docs/agents-history.md` agar konteks agent lebih ringan. Itu bukti bertanggal, bukan status produksi atau izin rollout.
- Pengaman di sana (secret supplier hanya di VPS, idempotensi/reservasi durable proxy SMM, retry ambigu `needs_check`, quote JWE/snapshot order lama, larangan reset direktori idempotensi) tetap berlaku untuk jalur legacy yang kompatibel. Baca file itu sebelum menyentuh order/refill/recovery Pedia lama, proxy SMM atau kurasi.

### Pedia IndoSMM 1 November 2026 (terkini)
- ProviderSMM diputus: jangan menambah cek saldo/notif/penjualan ProviderSMM. Diff VPS ProviderSMM dibalas 200 `ignored`; order/snapshot lama tetap dibaca.
- Istilah SMM keputusan owner tetap bahasa supplier (No Drop, Less Drop, High Drop, Refill N Days, Refill Lifetime, No Refill, Drop rate, Start time, Speed, Avg time, Success rate) dari `src/lib/pedia/terms.ts`; jangan menerjemahkan ke istilah Indonesia.
- Layanan High Drop/No Refill boleh dijual dengan label jelas. Refill manual (bergaransi tanpa tombol API) sah: admin meneruskan ke CS IndoSMM lalu `refill_resolve`.
- Statistik supplier dari alat publik IndoSMM bukan API resmi dan bukan uji kualitas AXVARA. Katalog baru lewat manifest + generator; jangan mengedit migrasi 0086 manual.
- Komentar custom: tier `input_kind='comments'` hanya boleh dipetakan ke layanan tipe "Custom Comments"; jangan menjual layanan Custom Comments tanpa kolom komentar.
- White label 100%: teks yang dilihat pembeli Pedia tidak boleh menyebut supplier/IndoSMM/ProviderSMM. Teks baru wajib lolos `whiteLabel()`/test leak; admin boleh menyebut IndoSMM.
- Nama layanan (2 November): [Metrik] [Wilayah] [Kualitas] (+ " · keterangan" bermakna); jangan memasukkan Refill/drop/"Ekonomis"/"Max N" ke nama karena sudah chip. Kurasi berikutnya satu layanan per (wilayah, masa refill, kualitas, keterangan); migrasi data memakai guard nama lama.
- Spec: `docs/pedia/indosmm-catalog-refill-2026-11-01.md`.

### Pedia IndoSMM 20 Oktober 2026
- Spec terkini `docs/pedia/indosmm-only-2026-10-20.md` menggantikan dua supplier aktif: hanya IndoSMM untuk penjualan baru, ProviderSMM tetap untuk riwayat/retry checkout tersimpan/dispatch/refill/recovery lama. Jangan ubah provider/snapshot order lama.
- Quote ProviderSMM tanpa order tersimpan ditolak 409 sebelum reservasi/debit/invoice; retry order tersimpan diperiksa dahulu. Kebijakan server berlaku meski tier lama aktif di DB.
- Migrasi 0073 menonaktifkan penjualan PSMM dan menambah tier IndoSMM baru, tidak remap tier lama. Konflik slug/draf owner dan tier IndoSMM existing dijaga. Produk premium Canva/Gemini/CapCut dikecualikan.
- Manifest 20 Oktober: 53 kebutuhan baru, tujuh pengganti, 61 mapping, 18 platform tambahan. Quote Threads dan Share Video Facebook tidak dipaksakan tanpa padanan terverifikasi. Registry/target/ikon diperluas; semua penawaran baru tanpa refill AXVARA. Nama API/deskripsi bukan bukti kualitas.
- API akun IDR 4.395 layanan/saldo0 dibaca saja. Tidak ada order berbayar, top-up, env/cron/proxy baru. Rencana sampling dua supplier 19 Oktober historis; saldo uji selanjutnya IndoSMM.

## Done when
- Tujuan tugas tercapai
- Perubahan diimplementasi
- `CHANGELOG.md` terisi
- Dokumentasi terkait terisi (PRD/DESIGN/ARCHITECTURE/README sesuai tabel Aturan Dokumentasi)
- Verifikasi sesuai dampak perubahan jelas; pemeriksaan yang tidak relevan ditandai `N/A` dan batas bukti disebutkan
- Untuk tugas perubahan kode/dokumentasi: commit dan `git push origin main` otomatis sesuai aturan CI/CD; setelah push berhasil berhenti tanpa memantau deployment
- Risiko/tindak lanjut diringkas
