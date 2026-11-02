# Audit white-label copy + link supplier — 2026-11-02 (S1)

Sumber bukti dibedakan eksplisit: **live** = GET read-only `/api/catalog`
(+ `?slug=`) publik 2026-11-02; **source** = file di repo; **runtime** =
perilaku kode yang dilalui jalur buyer. Tanpa mutasi produksi, tanpa order/
pesan/email baru, tanpa data pelanggan/kredensial.

## Ringkasan live (99 produk / 105 varian via /api/catalog)

- Copy ter-resolve: 97 varian — `axvara` 31, `pemasok` 63, `admin` 3;
  tanpa copy 8. Artinya ~2/3 katalog tampil teks supplier dirapikan
  (fallback), bukan kurasi — setiap teks supplier baru otomatis tampil
  sampai dikurasi/ditinjau (`needsCopyReview`).
- Jalur buyer yang memakai copy/link ini (runtime/source):
  PDP pre-bayar via `GET /api/catalog?slug=` → `withVariantCopy`
  (`resolveVariantCopy` → kurasi / `supplierVariantCopy` fallback);
  Telegram `handleProductTerms` (resolver sama + `mergeProductDescription`);
  panel pasca-bayar + Telegram kredensial via
  `resolveCredentialTermsForVariants` (resolver sama);
  email/panel kredensial WR via `normalizeAccountDetailsForDisplay`
  (rewrite retroaktif saat tampil, ciphertext tak berubah);
  email/panel SK via `formatSkLicenses` (rewrite di hulu).
  Deskripsi produk (`products.description` / override admin) tampil via
  `displayDescription` → `parseProductDescription` — TIDAK lewat
  `rewriteSupplierDocsLinks` (gampang disalahartikan; rewrite hanya untuk
  S&K/aktivasi varian + kredensial).

## Matriks temuan live → aksi

| # | Slug/varian live | Field/teks mentah | Aksi (kode) | Sisa keputusan manual |
|---|---|---|---|---|
| 1 | hma-vpn, express-vpn, meitu-premium (VIP, VIP+), scribd, picsart-pro, remini-premium, zoom-premium, wink-premium — 10 varian `pemasok`, kolom `proses` (live; tak ada bukti penempatan selalu di kolom yang sama) | "Jika mau Proses Otomatis silahkan ke halaman Jaspay" (+ "Made by order…") | Display-only drop di `supplierVariantCopy` (`JASPAY_CROSS_SELL_RE`, format.ts) — keputusan implementasi S1 demi kejelasan white-label (BUKAN klaim instruksi owner): baris yang mengarahkan pembeli varian premium ke halaman keluarga lain dibuang dari TAMPILAN S&K maupun aktivasi; "Made by order" tetap. Raw + fingerprint tetap milik supplier (admin/audit utuh). Test di sk-saldo-branding. | Interpretasi S1: Jaspay adalah produk AXVARA sendiri — bila owner justru ingin varian premium menaut ke Jaspay resmi, itu kurasi manual, bukan fallback. |
| 2 | chatgpt-sk "2 Minggu Sharing" `pemasok` + kurasi `lqpivppqmh` "1 Bulan Sharing" `axvara` | "Buka netflix-codes.sekalipay.com [tanpa /mailbox]" | `MAILBOX_HOSTS` bare diperlonggar ke `netflix-codes\.sekalipay\.com(?:\/mailbox)?` + `mailboxGoSlug` tanpa syarat suffix → `go/otp`; kurasi ChatGPT Sharing diperbaiki ke `axvara.tech/go/otp`. Test + GO_BY_HOST content-test diperbarui. | Tidak ada; tujuan sama (mailbox OTP). |
| 3 | alight-motion-sk "1 Tahun [Android/Ios]" `pemasok` | `Https://youtube.com/shorts/YKOMcipD3ig` (shorts BARU, bukan ID kurasi `8emqddsjPsE` → `go/alight-login`) | `TUTOR_IDS` += `YKOMcipD3ig` → `go/alight-shorts` (baru); seed 0092 + dev-fallback + test. Tidak menimpa `go/alight-login`. | Konten: shorts ini tutorial supplier atau resmi? Tujuan kini URL supplier apa adanya via redirect. Bila owner ingin artikel AXVARA seperti ID lama, ganti destination `alight-shorts` di admin Link Supplier (tanpa redeploy). |
| 4 | muse-ai-1-miliar-token (copy `admin`) | `https://inbox.hypathia.web.id` (OTP) + `https://muse.ai` | `MAILBOX_HOSTS` += `inbox.hypathia.web.id` → `go/otp-hypathia` (baru; seed 0092 + dev-fallback + test). `muse.ai` SENGAJA mentah (domain resmi produk). | Konten: link ini dari copy ADMIN (bukan supplier) — admin boleh ganti ke teks `go/otp-hypathia` langsung bila mau. |
| 5 | viu-sk "Sewa Bot 1 Bulan" `pemasok` | "@userinfobot" (bot cek ID Telegram umum, bukan handle supplier) | SENGAJA tidak di-rewrite (bukan reseller advertising/redirect belanja; alat operasional generik seperti mailbox). `linkifySegments` menjadikannya `t.me` — perilaku existing. | Konten: bila owner ingin shortlink juga, daftarkan handle + seed baru (jangan blanket-rewrite semua `@*_bot`). |
| 6 | drama-all-in-one (3 varian WR `pemasok`) | "Cek Platform: https;//dramaku.world" (typo `;`) + "Jika belum ada akun silahkan daftar dan ke halaman akun saya untuk redeem voucher" | Typo statis persis `https;//dramaku.world` dinormalisasi display-only → `axvara.tech/go/dramaku` yang SUDAH terdaftar (rewrite eksplisit di pipeline, tanpa query/kredensial di teks ini). Instruksi daftar/redeem dipertahankan utuh. Frasa "halaman akun saya" (interpretasi S1: konteksnya halaman tujuan redeem di situs dramaku.world, BUKAN klaim halaman AXVARA yang hilang — tujuan tak diinspeksi, jadi tak ada perubahan link selain typo di atas; tidak mengarang halaman). | Tidak ada. |
| 7 | netflix-sk "1 Profile 2 User" (`admin`), netflix kurasi SK | `Https://www.netflix.com/clearcookies`, `.../youraccount` | SENGAJA mentah (keputusan owner 2026-10-03, dipertahankan). | Tidak ada. |
| 8 | Berbagai deskripsi: `dramaku.world`, `Leonardo.Ai`, `devin.ai`, `Name.com`, `name.com/get.tech`, `muse.ai` | Nama/portal resmi di teks deskripsi | SENGAJA mentah: brand asli (Netflix…), batasan faktual, dan portal resmi produk tetap tampil. Deskripsi tidak lewat rewrite (by design). | Tidak ada. |

## Yang TIDAK diubah (disengaja)

- Query/token/kredensial/URL per-order tidak pernah di-rewrite blanket;
  hanya host/ID yang dipetakan di atas. Link tak dikenal tetap tampil
  apa adanya (dipetakan, bukan di-reroute buta).
- Raw supplier + admin di DB/ciphertext tak tersentuh; fingerprint
  `supplierFingerprint` tak berubah (kurasi/admin-stale gate tetap jujur).
- `@userinfobot`, `netflix.com/clearcookies|youraccount`, domain resmi
  produk, tutorial YouTube ID lain: mentah.
- Tidak ada migrasi data/ciphertext; seed hanya INSERT OR IGNORE (0092).

## File berubah (S1)

- `src/lib/product-copy/format.ts` — bare netflix-codes tanpa /mailbox;
  `inbox.hypathia.web.id` → `GO_OTP_HYPATHIA`; shorts `YKOMcipD3ig` →
  `GO_SHORTS_ALIGHT_NEW`; typo statis `https;//dramaku.world` →
  `go/dramaku`; drop display-only cross-sell Jaspay di `supplierVariantCopy`
  (S&K + aktivasi; raw/fingerprint utuh).
- `src/lib/product-copy/curated.ts` — kurasi ChatGPT Sharing:
  `netflix-codes.sekalipay.com` → `axvara.tech/go/otp`.
- `src/lib/db/client.ts` — dev-fallback 44→46 slug.
- `drizzle/schema.sql` + `drizzle/migrations/0092_…sql` (baru) — seed
  `otp-hypathia`, `alight-shorts`.
- `tests/sekalipay/sk-saldo-branding.test.ts` — test audit 2026-11-02
  (bare netflix-codes, shorts baru, hypathia, typo dramaku, cross-sell drop
  S&K + aktivasi).
- `tests/product-copy-content.test.ts` — GO_BY_HOST bare netflix-codes.
- `tests/supplier-links.test.ts` — count 44→46.
- `tests/supplier-links-route.test.ts` — regresi seed 0092 idempoten.

## Verifikasi fokus

`npx vitest run` 9 file (supplier-links, route, sk-saldo-branding,
product-copy, content, autolink, muse, ui.behavior, wr order):
**546/546 lulus** (snapshot pra-koreksi ServiceInfoCard; parent
me-rerun final). Koreksi ServiceInfoCard: `tests/
pedia-order-ux.behavior.test.tsx` 79/79 lulus (termasuk regresi baru
kalimat generated Inggris: N cocok dibuang, N/mode/Lifetime tak cocok
tampil, No Refill generik dibuang vs syarat kustom tampil).
Public GET live read-only; tanpa mutasi produksi/secret di laporan.

## Bukti browser terpadu (parent/Q1/Q2, bukan S1)

- Q1 Chromium lokal (fixture live /api/catalog + copy lewat
  `supplierVariantCopy` lokal; `/tmp/axvara-q1/Q1-evidence.md`): PASS —
  kartu desktop flat, switch varian klik/Enter tanpa copy basi, Jaspay
  line hilang (hma), `go/alight-shorts` + `go/otp-hypathia` 307 lokal,
  tanpa overflow 1440/390, CSS/JS 200.
- Q2 Chromium recheck (`/tmp/axvara-q1/Q2-evidence.md`): PASS — Pedia
  tier46 dup 0, disclosure unknown-drop terlihat, Market fokus cyan 2px
  + Enter switch varian, SSR routes tanpa hydration/console error,
  aset 200/304. Batasan fixture: dev hydration warning hanya mode
  intercepted; tanpa transaksi produksi.
- Full suite parent 305 file/3868 test + build:pages lulus SEBELUM
  koreksi ini (snapshot, bukan klaim final pasca-koreksi); parent
  me-rerun final. Deployment belum diverifikasi.
