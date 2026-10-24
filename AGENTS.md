# AGENTS.md — AXVARA (Project-Specific)

> ⚠️ Scope: aturan ini **HANYA untuk folder `axvara/`**.
> Jangan ubah `/Users/macbookair/AGENTS.md` global. File ini adalah source of truth untuk agent yang kerja di project AXVARA.

## Kebijakan Pedia 24 Oktober 2026 (menggantikan kredit pada snapshot lama)
- Spec terkini `docs/pedia/manual-resolution-2026-10-24.md`: QRIS per order, tanpa wallet/deposit/kredit/refund otomatis.
- Partial/canceled disimpan atomik dengan antrean tindak lanjut manual; pembayaran paid tetap paid. Unknown remains jangan diasumsikan nol.
- Arsip kredit/ledger lama dipertahankan, tidak dapat dibelanjakan. Retry order yang sudah tersimpan mempertahankan nominal; quote lama berkredit tanpa order ditolak sebelum mutasi.
- Expiry reservasi pra-pensiun dibalik sekali hanya ke arsip beku + follow-up owner. Penyelesaian dengan pembeli di luar AXVARA, bukan saldo baru.
- Status Pedia wajib kontak checkout penuh; kredensial Market buyer wajib kontak penuh atau capability. Pengecualian admin24Oktober: adminView hanya sesudah requireAdmin server-side, URL tanpa kontak/token buyer dan tidak menerbitkan capability buyer. Tidak menampilkan kode kredit lama ke browser.

## Tujuan
AXVARA — Gerbang Semua Tools Premium. Toko digital premium Apple Store + glassmorphism, checkout Transfer/QRIS statis, hosting Cloudflare Pages + D1 + R2. Workflow: plan → implementasi kecil → verifikasi dev → catat changelog → selesai.

## WAJIB dibaca dulu (context)
Sebelum ubah kode di `axvara/`, baca:
1. `docs/PRD.md` — requirement, flow, payment spec (E-Wallet 082135277434, SeaBank 901812349386, QRIS Brotherstore06)
2. `docs/DESIGN.md` — token Midnight #080C1E/#070a1e + Cyan #00E5FF + Gold #FFB800, SF Pro, Liquid Glass
3. `docs/ARCHITECTURE.md` — stack Next 15 + Pages + D1 + R2, schema, API contract, wrangler
4. `README.md` — struktur, brand, cara jalan & deploy
5. `CHANGELOG.md` (root `axvara/`) — riwayat perubahan, baca dulu biar tidak duplikasi

Jika perubahan mengubah struktur folder, route `src/app/*`, komponen `src/components/storefront/*`, `drizzle/schema.sql`, `wrangler.toml`, atau flow checkout/admin, **perbarui `docs/ARCHITECTURE.md` dan `README.md` di PR yang sama**.

## Cara bekerja
- Perubahan sekecil mungkin yang tetap selesaikan masalah.
- Jangan refactor besar tanpa diminta.
- Jika ragu, tulis asumsi eksplisit di `CHANGELOG.md` atau komentar PR.

## CI/CD dan push GitHub (WAJIB)
- Jalur deploy normal hanya melalui `.github/workflows/ci.yml`: push ke `main` menjalankan test/type-check root + test/build gateway, build Pages, migrasi D1 yang belum diterapkan, rilis gateway lewat Heroku source/build API bila source/release berubah, deploy Pages, lalu deploy MCP Worker. Secret CI `HEROKU_API_KEY_AKUN1` berasal dari `.heroku-credentials` ignored; jangan push Heroku manual.
- Sebelum build/migrasi, `scripts/ci-pages-env-check.cjs` membaca metadata env produksi Pages dan menghitung secret/text + empat variabel sistem Pages terhadap batas paket aktual (Paid 128, Free 64) lewat metadata langganan. Melebihi batas/API gagal menghentikan rilis; tepat batas paket memberi warning. Jangan log nilai secret. `PEDIA_DISPATCH_ENABLED` sudah dihapus 2026-10-18 karena tidak dipakai kode; bukan gate dispatch. Secret KlikQRIS/DANA/GoPay tetap dipertahankan.
- Pemeriksaan migrasi memakai `scripts/ci-d1-migrations.cjs`: tanpa query D1 hanya bila berkas migrasi + schema + wrangler identik dengan ancestor rilis `ci.yml` push main yang tahap migrasi dan deploy Pages-nya terbukti sukses. Bukti tidak lengkap/API gagal/berkas DB berubah → Wrangler remote wajib tetap lulus; jangan mengabaikan error migrasi atau menganggap push sebagai bukti deploy. Setelah restore/recreate D1, periksa migrasi remote sebelum memakai bukti rilis lama.
- Setelah implementasi, verifikasi dev, dan changelog selesai, commit lalu `git push origin main`.
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
- Keputusan owner: batas otomatis AXVARA tetap 15 menit walau gateway 60 menit. Pembayaran terlambat masuk Rekonsiliasi + alert admin, tanpa revive/refund/fulfillment otomatis. Callback signature + status API wajib cocok; konfirmasi gagal tidak boleh dianggap paid.
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
Setiap kali mengubah kode di `axvara/`, **WAJIB update test yang terpengaruh** sebelum commit/push:

- Jalankan `npx vitest run --run` setelah setiap perubahan kode.
- Jika ada test yang gagal akibat perubahan yang kamu buat, **perbaiki test tersebut di commit yang sama** — jangan push dengan test gagal.
- Jika mengubah output/format fungsi (misal menghapus field, mengubah teks, rename identifier), cari semua test yang assert output lama: `grep -rn "string_lama" tests/`.
- Jika mengubah nilai di `src/lib/site.ts` atau konstanta global lain, cari semua test yang hardcode nilai lama.
- Jangan menghapus test tanpa alasan — update assertion agar sesuai perilaku baru.
- Test harus **hijau seluruhnya** sebelum push. Jangan hardcode angka di aturan ini — jumlah terbaru selalu ada di entri teratas `CHANGELOG.md`, dan angka yang ditulis di sini akan usang dalam beberapa commit.

## Aturan Dokumentasi (WAJIB — bukan cuma changelog)
Setiap perubahan perilaku/kontrak/env/arsitektur WAJIB dicatat di SEMUA dokumen
yang relevan dalam PR/commit yang sama — bukan cuma `CHANGELOG.md`:

| Jenis perubahan | Dokumen yang WAJIB ikut di-update |
|---|---|
| Perilaku produk / requirement / flow / payment spec | `docs/PRD.md` (tandai ✅ live / ubah status) + `CHANGELOG.md` |
| Token warna, font, layout, komponen, animasi, aset visual | `docs/DESIGN.md` + `CHANGELOG.md` |
| Struktur folder, route `src/app/*`, komponen storefront, `drizzle/schema.sql` atau migrasi baru, `wrangler.json`, flow checkout/admin, kontrak bot/webhook, env baru, cron, flag | `docs/ARCHITECTURE.md` + `README.md` (bagian terkait) + `CHANGELOG.md` |
| Env Pages baru/diubah, kredensial, handoff Heroku/Cloudflare | `docs/ARCHITECTURE.md` §16 + `README.md` + AGENTS.md folder terkait |
| Kontrak antar-repo (proxy/gateway/bot/QRIS) | AGENTS.md di SEMUA folder yang terpengaruh |

Aturan: (1) Dokumen adalah spec hidup — kode yang menyimpang dari docs = bug docs
yang harus dibetulkan di commit yang sama; (2) Dilarang menulis docs basi
("Pre-Build", "rencana", "segera") untuk perilaku yang sudah live — tandai
tanggal + status live; (3) Checklist sebelum selesai memeriksa butir dokumentasi,
bukan cuma test.

## Aturan Changelog (WAJIB — khusus axvara)
Setiap kali ubah kode/docs di `axvara/`, **WAJIB catat di `axvara/CHANGELOG.md`** (bukan di AGENTS.md global):

- Tambah entri baru di **paling atas** (terbaru di atas), append-only, jangan hapus entri lama.
- Format: `- YYYY-MM-DD — <ringkas perubahan> — <file/area utama> — (verifikasi: <hasil>)`
- Satu entri per perubahan logis. Ringkas, faktual, sebut file/area.
- Contoh: `- 2026-08-31 — Pasang logo Prism wireframe di Navbar/Footer — public/brand/axvara-mark.svg, src/components/storefront/Navbar.tsx — (verifikasi: dev GET / 200, CSS 200, build pass)`
- Changelog melengkapi `issue/` — ia adalah indeks ringkas semua perubahan axvara.

## Verifikasi WAJIB (dev-only, tanpa build tiap kali)
**Jangan wajib `npm run build` setiap perubahan.** Cukup `npm run dev` — build hanya sebelum deploy/major change.
**Wajib selalu pakai Obscura** untuk verifikasi visual/fungsional. Baca dan ikuti skill `obscura`, lalu gunakan Obscura CLI atau CDP server milik Obscura; Chrome DevTools MCP dan Playwright MCP bukan jalur verifikasi AXVARA.

1. Jalankan dev **dari folder yang benar** (wajib):
   ```bash
   cd /Users/macbookair/axvara
   node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
   ```
   Jangan dari `/Users/macbookair` (akan `Missing script: dev` → 500).

2. Jika port 3000 macet/CSS 404 (`GET /_next/static/css/app/layout.css 404` / `ENOENT vendor-chunks`):
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null; rm -rf .next; node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
   ```

3. Verifikasi ringan via HTTP (wajib sebelum anggap selesai):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/  # harus 200
   curl -s http://127.0.0.1:3000/ | grep -o 'href="[^"]*\.css[^"]*"' | head -1
   curl -s "http://127.0.0.1:3000/_next/static/css/app/layout.css?v=xxxx" -o /dev/null -w "%{http_code}\n" # harus 200
   tail -20 /tmp/axvara-dev.log  # Ready in ... / Compiled / GET / 200
   ```

4. Verifikasi visual/fungsional via Obscura (wajib sebelum anggap selesai):
   ```bash
   obscura --allow-private-network fetch http://127.0.0.1:3000/ \
     --eval 'JSON.stringify({title:document.title,heading:document.querySelector("h1")?.textContent?.trim()})' \
     --screenshot /tmp/axvara-obscura-home.png --timeout 20
   file /tmp/axvara-obscura-home.png  # harus PNG nonblank
   ```
   Ganti URL dengan route yang diubah dan inspeksi hasil screenshot/evaluasi. Untuk interaksi kompleks, jalankan `obscura serve --allow-private-network --port 9222` lalu gunakan CDP Obscura; refresh snapshot setelah navigasi, klik, scroll, atau rerender.

5. Hanya jalankan `npm run build` jika:
   - Mau deploy ke Pages
   - Ubah `next.config.mjs`, `tailwind.config.ts`, `tsconfig`, atau routing besar
   - Verifikasi akhir sebelum merge

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
Agent **wajib** pastikan sebelum jawab "selesai":
- [ ] Test pass: `npx vitest run --run` — seluruh test hijau (jumlah terbaru ada di entri teratas `CHANGELOG.md`), tidak ada test gagal
- [ ] `CHANGELOG.md` sudah di-update (entri paling atas)
- [ ] Halaman jalan: `GET / 200` dan CSS `200` dari `http://127.0.0.1:3000` (atau `http://localhost:3000`)
- [ ] Obscura berhasil memuat route yang diubah dan screenshot/evaluasi visual-fungsional sudah diperiksa
- [ ] Tidak ada error `Compiled` di `/tmp/axvara-dev.log`
- [ ] Dokumentasi: tabel Aturan Dokumentasi di atas sudah dipenuhi (PRD/DESIGN/ARCHITECTURE/README/AGENTS folder terkait ikut di-update sesuai jenis perubahan)
- [ ] Jika ubah struktur/flow, `docs/ARCHITECTURE.md`/`README.md` ikut di-update
- [ ] Kredensial CF tidak ter-commit (cek `git check-ignore -v .cf-credentials`)
- [ ] Jangan pernah ubah `/Users/macbookair/AGENTS.md` global

## Ekosistem terkait (WAJIB TAHU sebelum ubah integrasi)
Repo ini tidak berdiri sendiri. Tiga folder lokal lain saling berkaitan:

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

### Pedia katalog/checkout 2026-10-15
- Spesifikasi terkini: `docs/pedia/catalog-checkout-2026-10-15.md`; menggantikan snapshot UI/katalog 12 Oktober di bawah. 38 jenis/131 mapping awal/16 platform; migrasi 0065/0066, hanya mirror layak diaktifkan. UI 3 pilihan awal mobile/desktop; drop/refill tetap. Revisi konfigurator 2026-10-16: kartu kebutuhan tanpa pilihan otomatis, daftar layanan satu kolom/pilihan aktif ringkas di semua ukuran, jumlah/link/checklist berdekatan, detail terlipat sesudah input; checkout dua tahap dan kontrak quote/retry tetap.
- Harga jumlah bebas dari `/api/pedia/prices`; order/job/debit/ledger atomik D1. QR gagal diulang memakai quote sama. Cron Pedia membalik reservasi kredit pra-pensiun sekali ke arsip beku dan mengantrekannya untuk penyelesaian manual. Tidak ada flag dispatch baru; proses lewat cron existing.
- Quote/snapshot memuat copy publik, supplier_target dan refill_anchor; perubahan mapping hanya untuk order baru. completed_at mencatat terminal pertama. Preview admin memakai copy dan batas tersimpan, tanpa API pesanan. Secret supplier tetap hanya di VPS; tidak ada perubahan kontrak proxy atau deployment VPS untuk rilis ini.
- Status publikasi/verifikasi akhir ada di CHANGELOG dan `issue/pedia-ready-2026-10-15.md`; pengujian tanpa order supplier berbayar. Deskripsi supplier bukan bukti empiris kualitas/drop.

### Integrasi Pedia Dua Provider (Working-Tree 2026-10-12)
- Status implementasi **lokal, BELUM deployed** di Pages maupun proxy untuk perubahan ini. Tidak ada flag yang diubah; kredensial/readiness supplier, bukti currency/rate-unit dan kurasi awal data produksi masih pending. Riwayat katalog 2026-10-08 tidak membuktikan diff baru live. Baca `docs/PEDIA-PRD.md`, `docs/PEDIA-DESIGN.md`, `docs/ARCHITECTURE.md` §16.10 dan `issue/planning.md`.
- Kontrak proxy: `POST /psmm/:action` (`providersmm`) + `POST /indosmm/:action` (`indosmm`), auth `x-proxy-token` dari Pages `WARUNG_REBAHAN_PROXY_TOKEN` ↔ VPS `WR_PROXY_TOKEN`; allowlist services/add/status/refill/refill_status/cancel/balance. `PROVIDERSMM_API_KEY` dan `INDOSMM_API_KEY` HANYA server-side VPS, tidak ada key supplier di Pages/git/log. Jangan membuka file secret untuk audit docs.
- IndoSMM services/add dan diff memerlukan `INDOSMM_RATE_PER_1000_VERIFIED=true` di VPS serta balance terbaru `currency === "IDR"`. Flag berarti bukti unit per 1.000 sudah disetujui, bukan jalan pintas menyalakan fitur; tanpa konversi kurs. `/health` hanya konfigurasi key, bukan bukti pricing. Status/balance/refill/cancel recovery tidak memakai gate services/add.
- Diff SMM tiap 10 menit membawa `source`, `currency`, `services`, `removed_service_ids`; receiver memakai key `(source,service_id)`, max 100 layanan/100 removed, validasi IDR/input sebelum tulis dan non-2xx bila apply parsial. VPS membatasi layanan `chunkMax` 1..100 (default 50) dan removals 100 secara independen; snapshot/antrean maju hanya potongan ber-ack 2xx, >100 removals dilanjutkan pada batch berikutnya (bukan batas pending). Guard katalog kosong/>50% missing tetap berlaku. Legacy ProviderSMM tanpa currency tetap IDR. Snapshot terpisah `state/psmm-diff-state.json`/`state/indosmm-diff-state.json`; prefix marker `pedia_diff`/`pedia_indosmm_diff`, saldo/alert/check per provider terpisah.
- Submit D1 mengklaim `submitting` sebelum jaringan; lease basi/timeout/ambigu → `needs_check`, tidak auto-retry atau failover. Proxy reservation durable `SMM_IDEMPOTENCY_DIR` (default `state/smm-idempotency`), provider/action/key+fingerprint, exclusive create+fsync sebelum upstream, cache sukses tanpa TTL. Add wajib key kode order stabil 1..120 karakter; refill/cancel dedupe hanya bila key diberikan. Backup state; jangan reset direktori idempotensi seperti snapshot katalog. Pending/corrupt tidak boleh dihapus, key/provider tidak boleh diganti untuk retry ambigu. Hanya satu VPS; state in-memory lama tidak dapat dipulihkan.
- Quote baru terenkripsi JWE dir/A256GCM (30 menit, SHA-256 ADMIN_JWT_SECRET) mengikat `refill_days/min_profit_rp`; HS256 legacy belum kedaluwarsa tetap terbaca. Provider/service/rate dan ketentuan quote tersimpan pada order; legacy tanpa field fallback tier. Remapping hanya order baru, bukan polling/refill order lama. Refill requested/submitted/needs_check diblokir berapa pun usianya, ID/key ambigu dipertahankan. Guard margin menyimpan disable sebelum harga baru agar replay tetap terlindungi. ID admin desimal positif kanonik; checklist ID unik setelah trim dan bantuan opsional bertipe string. Recovery mark_submitted memeriksa provider asal/status/conflict; retry dan cancel_manual hanya sebelum pernah submit/ada ID; penerbitan kredit sudah dihentikan. Jangan klaim exactly-once end-to-end atau order/credit atomik penuh dari dedupe proxy saja.
- Menu/promosi URL terpusat `src/lib/site.ts`, komponen `shared/{ServicesMenu,CrossServicePromo}`, satu Footer di kedua layout. Pedia compact/featured/null selection/satu CTA dan nominal-change consent adalah implementasi lokal, bukan bukti kurasi live atau flags aktif. Tagline tampil kartu/detail; `description_md` publik opsional tampil detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan Markdown/HTML, tanpa link-helper teknis tambahan. Preview storefront tersimpan terpenuhi: `ProductCard` aktual + `OrderClient` embedded dalam mode preview aman, termasuk draf privat dan tingkat nonaktif dengan paket layak. Navigasi/pemesanan dinonaktifkan, interaksi preview tidak memanggil API; CTA mobile inline, bukan fixed. Input belum disimpan tidak ikut preview; unsaved live preview di luar scope. Save/reprice tidak atomik.
- Hasil final aktual MAIN setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Perubahan tetap lokal, BELUM deployed, secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Bukti supplier live currency/rate-unit dan kurasi awal produksi/approval owner tetap pending.
- Rollout terpisah: receiver Pages kompatibel sebelum diff proxy IndoSMM; backup state + handoff secret/unit-verification dahulu. Jangan deploy, commit/push atau membuka gate saat tugas hanya sinkronisasi docs; instruksi eksplisit scope tugas mengalahkan workflow publikasi default. Checklist planning tidak mencentang bukti supplier/live/QA tanpa hasil aktual.

### Pedia 19 Oktober 2026
- Spec terkini `docs/pedia/catalog-ux-2026-10-19.md` menggantikan konfigurator 16 Oktober: jumlah sebelum perbandingan/pilihan; ikon semantik; ring loader mengikuti ISTA AI dengan logo tetap dan reduced motion.
- Tambahan manifest `curation-20261019.json` + migrasi 0070: 17 kebutuhan/23 mapping, kapasitas gabungan 55/154 pada 16 platform; aktivasi mengikuti mirror/batas/paket/refill API. Jangan ubah migrasi 0066, order/snapshot lama, atau draf owner yang konflik slug.
- Supplier SMM tetap ProviderSMM/IndoSMM, tanpa Sekalipay. Target `short` YouTube mempertahankan /shorts/, `artist`/`playlist` Spotify didukung. Nama refill tanpa API bukan janji refill AXVARA.
- Tab Kurasi admin: shortlist authenticated baca-saja, maksimal 200 kandidat awal/20 hasil; estimasi modal jumlah sama bukan bukti mutu. Simpan draf nonaktif/refill0/recommended0; owner memeriksa deskripsi/target/batas/kelipatan sebelum aktivasi. Tidak ada auto-publish/order supplier.
- `docs/pedia/quality-sampling-2026-10-19.md`: tarif akun IDR/saldo0 dibaca tanpa order. Usulan topup awal Rp50.000 ProviderSMM + Rp100.000 IndoSMM untuk satu putaran 30 sampel estimasi Rp107.864 belum fee; **belum dijalankan**, perlu target owner dan keputusan eksekusi, jangan mengklaim kualitas/drop sudah teruji.

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
- Verifikasi dev (GET / 200 + CSS 200) jelas
- Untuk tugas perubahan kode: commit dan `git push origin main` berhasil; setelah itu berhenti tanpa memantau CI/CD
- Risiko/tindak lanjut diringkas
