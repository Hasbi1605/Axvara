# Audit keamanan OWASP AXVARA — 27 Oktober 2026

Status: audit source, remediasi dan verifikasi lokal selesai; publikasi melalui
push main→CI. Base `50d3b9a`. Deployment produksi tidak dipantau/diverifikasi.
Paseo: Sol memegang integrasi, Wonder review arsitektur independen, Flash
menelaah integrasi/CI, Spark memperbaiki dependency pada worktree terpisah.
Checkpoint tim berada di `~/.paseo/orchestration/820bd923-8787-4c8b-a930-550e97048249/`.

## Scope dan kriteria

Audit mencakup web/admin/API, Market/Pedia, bot, pembayaran, D1/R2, gateway WA,
MCP Worker dan jalur CI. Source proxy WR/SK serta poller GoPay terkait ditelaah
baca-saja terlebih dahulu. Inventaris awal115 route API/172 handler.

Setiap temuan membutuhkan aktor, batas kepercayaan, bukti source/runtime,
syarat eksploitasi, severity/confidence serta verifikasi aman. Perbaikan harus
mempertahankan harga, stok, provider invoice, idempotensi dan lease supplier.
Pengujian memakai fixture tanpa order berbayar atau payload eksploitasi produksi.
Tidak membuka file kredensial untuk laporan, tidak menyalin secret, dan tidak
mengulangi pembersihan108 order pada tugas sebelumnya.

Rujukan: [OWASP Top10:2025](https://top10.owasp.org/2025/) dan
[ASVS5.0](https://asvs.owasp.org/). Hasil merupakan penilaian dengan scope/bukti
yang dinyatakan, bukan sertifikasi OWASP atau jaminan bebas kerentanan.

## Temuan awal yang disepakati Sol dan Wonder

- A01: endpoint detail editor produk dapat dibaca anonim, termasuk modal dan
  varian/produk nonaktif. Storefront memakai katalog terpisah; editor memerlukan
  sesi admin. Severity Medium, confidence Confirmed; regresi lokal membuktikan401
  anonim dan data editor lengkap hanya untuk sesi admin sah/private no-store.
- A06/A10: guard batch checkout belum mengikat harga quote, produk induk aktif
  dan relasi produk-varian. Read-check harga juga gagal terbuka saat query error.
  Severity Medium–High menurut syarat timing/fault; confidence High. Perbaikan
  menambah pemeriksaan dalam batch yang sama dengan reservasi. Fixture membuktikan
  harga berubah, parent nonaktif, reparenting dan query harga gagal tidak membuat
  order underpriced; enam retry stok terakhir tetap satu order/satu slot.
- A03: audit dependency runtime menemukan Zod pada aplikasi utama serta Sharp,
  Fastify, fast-uri dan music-metadata pada gateway dalam rentang advisory.
  Kecocokan versi tidak berarti seluruh precondition eksploitasi terpenuhi.

## Batas verifikasi awal

HEAD read-only ke domain produksi menghasilkan penolakan edge403. Header dari
respons itu tidak diperlakukan sebagai bukti konfigurasi header aplikasi origin.
Kontrol source, fixture dan konfigurasi runtime dibedakan dalam laporan akhir.
Pemetaan semua kategori, hasil remediasi dan verifikasi akhir tercatat di bawah;
publikasi memakai commit/push melalui CI resmi.

## Temuan dan perbaikan

| ID | Dampak sebelum perbaikan / syarat | Severity / confidence | Perbaikan dan bukti lokal |
| --- | --- | --- | --- |
| F1 A01 | Pengunjung anonim mengenumerasi endpoint editor produk, melihat manual_cost dan varian/produk nonaktif. | Medium / Confirmed | requireAdmin sebelum query `api/products/[id]`; sesi valid mempertahankan data editor, respons privat. |
| F2 A06/A10 | Quote sah yang basi dapat melewati pembacaan harga yang error atau race harga/deaktivasi, karena guard reservasi belum mengikat harga/parent. Bukan kemampuan memalsukan token/harga bebas. | Medium–High / High | `db/orders-create` JOIN parent aktif, harga quote exact, product_id, mode/minimum/stok dalam batch atomik. Fault/race fixture tanpa invoice/order/decrement; retry pemenang dipertahankan. |
| F3 A07/A09 | Pergantian isolate mereset batas login; login gagal/sukses tanpa riwayat aplikasi. WAF aktual tidak berhasil diverifikasi. | Low–Medium / Confirmed source | D1 UPSERT kondisional10/jendela15menit/IP sebelum verifikasi; burst5/menit tetap. HMAC subjek, event login dan otorisasi admin tersanitasi, cleanup bounded.20 paralel→10x401+10x429; admission gagal503 tanpa sesi. |
| F4 A03 | Versi runtime dependency cocok advisory; prasyarat berbeda menurut paket. Zod membaca koleksi sebelum batas ukuran; Sharp dapat dipanggil Baileys meski tak diimport langsung gateway. | High advisory; app severity bergantung reachability | Patch dan gate CI dibahas dalam [laporan dependency](../docs/security/dependency-audit-2026-10-27.md); hasil integrasi akhir dicatat di bawah. |
| F5 A06/A10 | Endpoint publik membaca seluruh JSON sebelum validasi; quote hanya memeriksa Content-Length, yang dapat kosong/palsu. Webhook membatasi setelah buffering. | Medium buyer routes, Low authenticated hooks / Confirmed | Reader byte stream membatalkan overflow sebelum parse,413. Quote/order32.000byte; login/lookup/kredensial/cancel/refill/subscriber8.000. Webhook mempertahankan batas lama dan raw text; supplier-sync2MiB, MCP8MiB, agent article256.000byte. |
| F6 A02 | Rewrite halaman Pedia dan early403 middleware melewatkan CSP/Permissions-Policy serta header browser lain. API tetap memeriksa CSRF sebelum perbaikan. | Low / Confirmed | Semua return middleware melewati finalizer; CSP maintenance yang lebih ketat tetap. Fixture rewrite membawa CSP+Permissions dan cross-origin API tetap403+XFO. |
| F7 A01 | Artikel published pada API membocorkan reviewer/admin email, idempotency dan metadata editorial; SSR JSON-LD memakai admin email sebagai author. | Medium / Confirmed | Whitelist publik list/detail+SSR, author AXVARA; draft tetap privat, respons admin tetap lengkap/private. Body published bukan rahasia; menghapus body dari list mengurangi payload, bukan perbaikan confidentiality atas konten terbit. |
| F8 A06 | Guard Telegram/WhatsApp berbeda dari web: parent tidak diperiksa atomik; harga snapshot tidak diikat; WA juga tidak mengikat product_id/mode. Perlu race harga atau parent ditutup. | Medium / Confirmed | Kedua guard commerce memeriksa parent/harga/relasi/mode dalam batch. Telegram mengikat snapshot item per baris; fixture stale-price/nonaktif/reparenting tidak mengubah order/stok. |
| F9 A01/A07 | Saat mode PBKDF2-proof dipakai, GET challenge menerbitkan JWT signed tetapi tidak terenkripsi yang memuat email admin. Email salah juga mempunyai cabang delay tersendiri. Konfigurasi mode produksi tidak dibaca. | Low / Confirmed source, conditional deployment | Challenge baru memakai HMAC subjek akun terpisah domain tanpa email; challenge lama hanya hingga expiry5menit asli. Jalur verifikasi sama untuk email salah, respons401 generik. Fixture payload tidak memuat email dan proof existing tetap valid. |

## Cakupan seluruh OWASP Top 10:2025

| Kategori | Bukti yang diperiksa / hasil | Batas atau residual |
| --- | --- | --- |
| A01 Broken Access Control | Inventaris115 route/172 handler; requireAdmin API admin, token agent hash+scope/expiry, buyer lookup/kredensial kontak penuh atau capability, R2 bukti privat, path proof, public serializers. F1/F7 diperbaiki. | Kontak checkout merupakan knowledge factor sesuai kebijakan owner24Oktober, bukan OTP. DNS hostname media belum di-resolve aplikasi; perlindungan private destination bergantung transport Cloudflare. |
| A02 Security Misconfiguration | Middleware CSP/HSTS/XFO/nosniff/Permissions, Origin API mutasi, cookie secure/HttpOnly/SameSite, feature/payment maintenance. F6 diperbaiki. | CSP script unsafe-inline masih diperlukan implementasi Next saat ini; migrasi nonce membutuhkan verifikasi hydration terpisah. Konfigurasi edge/WAF/origin aktual belum terbukti. |
| A03 Software Supply Chain Failures | Lock root/gateway, npm audit runtime/full, transitive reachability, CI build/test/migration/Pages/MCP/gateway gates. F4 ditangani terpisah dengan gate advisory. | Advisory build/dev yang belum dapat dipatch kompatibel wajib disposition; tidak memakai npm audit fix --force atau migrasi framework diam-diam. CI actions tag belum semuanya full-SHA pin. |
| A04 Cryptographic Failures | AES-256-GCM data fulfillment; JWT/JWE server quote, PBKDF2-proof mode tersedia, HMAC webhook/subjects, timing-safe shared secret checks, secret tidak diberikan ke browser. | Mode password hash SHA256 legacy masih diterima jika dikonfigurasi demikian; tidak membaca hash produksi untuk audit. MFA/rotasi/enrollment dan backup/key lifecycle belum diverifikasi. |
| A05 Injection | Prepared SQL dan identifier allowlist (termasuk ternary tabel admin Pedia), literal escaped Pedia, Markdown/JSON renderer escaped, JSON-LD escaping, upload WebP/magic bytes dan path normalization. | Tidak ditemukan SQLi/stored XSS yang terdemonstrasi pada jalur diperiksa; ini bukan bukti formal seluruh string/sink aman selamanya. |
| A06 Insecure Design | Harga token server, parent/variant binding, reservasi stok/inventory atomik, quote retry satu order, limiter checkout durable, supplier lease/ref/idempotency. F2/F5/F8 diperbaiki. | Bot multi-IP/kontak dapat melewati kuota per identitas. Tidak ada janji exactly-once eksternal; respons supplier ambigu tetap rekonsiliasi. |
| A07 Authentication Failures | Sesi absolute+idle terikat sid, auth-version/revocation D1 fail-closed, scope agent, login D1+burst, secret header bot/proxy/gateway. F3 diperbaiki. | Shared NAT berbagi batas login; IPv6 dinormalisasi /128 tanpa penggabungan /64. Challenge GET tidak mereset counter; format salah dibatasi byte/burst tanpa verifikasi password. MFA belum dipasang. |
| A08 Software or Data Integrity Failures | Signature raw GoPay+merchant/currency/order/amount/time, WR/SK/DANA/TG/WA auth, KlikQRIS signature+GET otoritatif, receipt/ref validation, supplier-sync token, migration-before-Pages/PR deploy gates. | DANA legacy rail memakai shared webhook secret, bukan klaim semua provider memakai HMAC body identik. Production key/poller config dan transaksi end-to-end tidak diuji di audit ini. |
| A09 Security Logging and Alerting Failures | Event login gagal/sukses D1; limited console; mutasi/baca sensitif admin mencatat authorized sekali/request, tanpa kredensial/IP/kontak/query. Cleanup30hari/maks500. Supplier/payment events existing dan queue health diperiksa. | authorized bukan bukti aksi berhasil. Console fallback tidak menjamin retensi/penerimaan alert; kanal alert keamanan eksternal belum diverifikasi/dibuat. Polling read biasa dikecualikan untuk biaya D1. |
| A10 Mishandling Exceptional Conditions | Error admission login/checkout fail-closed503, revocation unreadable menolak sesi, guard batch rollback, webhook invalid/replayed/tampered tidak menjadi paid, invoice initializing GET-only dan hasil supplier ambigu tidak membeli ulang. | Gangguan platform/kuota tetap dapat menghentikan layanan. Tidak melakukan chaos/load test produksi atau menganggap semua catch sebagai bug tanpa jalur dampak. |

## Hipotesis yang ditolak atau dikoreksi

- Kode order saja membuka akun: ditolak pada jalur kredensial yang diperiksa;
  perlu kontak checkout penuh/capability atau sesi admin sah.
- Token quote dapat diubah untuk menentukan harga bebas: tidak terbukti;
  F2 memakai token sah yang stale/race, bukan pemalsuan signature.
- Spoof x-forwarded-for melewati limiter di Cloudflare: helper memprioritaskan
  cf-connecting-ip dan tidak memakai forwarded-for untuk subjek limiter.
- Semua advisory pasti dapat dieksploitasi dari publik: ditolak. Sharp memang
  reachable secara transitif, tetapi SVG dan internal token/caller merupakan
  prasyarat; Fastify HTTP2 tidak dikonfigurasi dan music-metadata jalur audio tidak
  dipakai gateway. Patch tetap dilakukan saat kompatibel.
- Semua body sudah dibatasi sebelum parse/DNS private sudah di-resolve: laporan
  awal Flash keliru, lalu diperiksa dan dikoreksi; F5 membuktikan celah aslinya.
- URL.hostname IPv6 Node tidak berkurung: Wonder menarik asumsi ini sesudah
  eksperimen Node; strip kurung kondisional dan fixture distinct-IP tetap dipasang.
- Warning CSP unsafe-inline atau source SELECT* otomatis membuktikan XSS/IDOR:
  tidak. Dampak memerlukan sink/serializer/otorisasi konkret, seperti F1/F7.
-108 order fiktif sebelumnya membuktikan pencurian/pembayaran palsu/bypass guard
  terbaru: tidak. Cleanup sebelumnya terpisah; audit ini tidak mengulangnya.

## Verifikasi dan publikasi

Fixture baru: `owasp-access-and-checkout.integration`, `owasp-request-boundaries`,
`owasp-login-audit.integration`, `owasp-stream-limit`,
`owasp-editorial-and-channel.integration`; existing checkout retry/minimum/QRIS
fixtures diperbarui agar harga fixture sama dengan snapshot yang diuji.
Delapan kasus F1/F2 dan empat kasus boundary/header gagal pada source sebelum fix,
lalu lulus. Regresi login meliputi20 paralel, same-client reset, cross-client
isolation, rollover, store error, dedupe/privacy event dan cleanup active window.
Reader diuji chunked-cancel, multibyte, header palsu dan preservasi raw text.

Hasil integrasi final27Oktober:

- `npx vitest run --run`: **3230 test /267 file pass**, log lokal
  `/tmp/axvara-owasp-final-tests.log`.
- `npx tsc --noEmit`: exit0. Gateway12test pass dan build tsc exit0.
- `npm run build:pages`: exit0; MCP Wrangler **dry-run** bundle exit0, tidak deploy.
- `node scripts/security-dependencies.cjs --json`: ok:true, runtime high/critical0,
  errors0. Full gateway0, full root3 high dev-only (adapter/Miniflare/nestedZod).
  Gate menolak registry error, JSON/schema/count tidak konsisten dan exit tak
  dikenal; unit tests mocked, registry nyata diperiksa terpisah. Tidak mengklaim
  zero seluruh audit. Next15.5.28/Baileysrc14/Node22 dipertahankan.
- Dev setelah install/build: home/CSS200, API artikel200 (dev tanpa artikel),
  editor anonim401, oversized quote413, cross-origin POST403 dengan XFO DENY.
  Header CSP/Permissions Pedia diperiksa; tanpa error kompilasi dev.
- Obscura admin, Pedia dan artikel berhasil memuat, screenshot PNG nonblank
  diperiksa, overflowfalse. Dev Pedia menampilkan state belum tersedia karena
  konfigurasi lokal; admin tetap form login, artikel state kosong. Data draf/
  published/admin dan pembeli valid diuji fixture backend, bukan login/payment
  produksi. Screenshot akhir `/tmp/axvara-owasp-admin-final.png` dan
  `/tmp/axvara-owasp-articles-final.png`; warning xmlns SVG renderer Obscura yang
  sudah ada tetap tercatat, bukan kegagalan kompilasi aplikasi.
- `git diff --check` bersih; `.cf-credentials` tetap ignored; tidak mengubah
  AGENTS global. Semua dokumen kontrak relevan diperbarui bersama source.

Seluruh QA tanpa transaksi/pembelian supplier, pengiriman pesan,
payload serangan produksi, atau perubahan secret/sesi/poller/inventory produksi.
Commit/push memakai main→CI; setelah push diterima berhenti tanpa memantau deploy.
Push bukan bukti migrasi0080 atau deploy berhasil. Tidak mengubah infrastruktur
Cloudflare/Heroku/VPS atau menjalankan deploy manual dalam audit ini.

Review tim: Wonder (threat model, desain login dan review auth/body/middleware),
Flash (integrasi lintas repo, koreksi dependency reachability, editorial/commerce
review dan QA), Spark (dependency/CI di worktree terisolasi), Sol (fixture,
remediasi/integrasi/verifikasi akhir). Biaya/model usage tidak tersedia; tidak ada
klaim penghematan terukur. Checkpoint lokal di path Paseo pada awal laporan.
