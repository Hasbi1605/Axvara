# AGENTS.md — AXVARA (Project-Specific)

> ⚠️ Scope: aturan ini **HANYA untuk folder `axvara/`**.
> `/Users/macbookair/AGENTS.md` global sudah dihapus atas instruksi owner (2 November 2026); jangan membuatnya ulang. File ini adalah source of truth untuk agent yang kerja di project AXVARA.

## Cara membaca panduan
- Keputusan terbaru untuk topik yang sama menggantikan snapshot lama hanya pada bagian yang terkait. Batas tugas dari owner tetap berlaku; jangan memperluas scope hanya karena ada runbook di sini.
- Bagian berlabel histori/snapshot adalah bukti pada tanggalnya, bukan status produksi saat ini atau izin rollout. Jangan menghidupkan kembali fitur yang sudah dipensiunkan; kontrak kompatibilitas dan pengaman order lama tetap dijaga.
- Angka test, saldo, jumlah env dan status deployment adalah hasil pengamatan bertanggal. Gunakan bukti aktual untuk klaim baru; jangan membaca secret atau mengakses produksi hanya untuk merapikan dokumentasi.

## Aturan per area (WAJIB baca file terkait sebelum menyentuh area itu)
Keputusan owner per fitur disimpan utuh di `docs/agent-rules/` agar konteks
agent ringan. Isinya tetap berlaku sama seperti bila tertulis di sini; baca
hanya file yang relevan dengan tugas, dan semuanya bila tugas lintas area.

| Bila menyentuh… | Baca |
|---|---|
| WR (Akun Premium/Jaspay), SK, proxy VPS WR/SK, dispatch/receipt/rekonsiliasi supplier | `docs/agent-rules/supplier-wr-sk.md` |
| Digiflazz, whitelist buyer, kredensial dan preflight saldo/katalog | `docs/agent-rules/digiflazz.md` |
| Kredensial pembeli, PIN, proof c1/p1, lacak order, email kredensial, reveal admin | `docs/agent-rules/buyer-credentials.md` |
| Login/admin, Cloudflare Access, audit, rate limit, body limit, dependency gate CI, anti-abuse checkout | `docs/agent-rules/admin-security.md` |
| QRIS GoPay/KlikQRIS/DANA, persiapan NOWPayments/Sekalipay gateway, poller VPS GoPay, callback pembayaran, maintenance pembayaran | `docs/agent-rules/payments.md` |
| Pedia/SMM (IndoSMM), katalog/refill/kurasi, white label | `docs/agent-rules/pedia.md` + `docs/agents-history.md` untuk order lama |
| Workers Paid, cron, budget statement fulfillment, unit unik, kuota/monitor D1 | `docs/agent-rules/platform-ops.md` |
| AXVARA Games (route `/games`, katalog/harga/pesanan top up game) | `docs/GAMES.md` + `docs/agent-rules/digiflazz.md` |
| Gateway WhatsApp, grup AXVARA'S, ganti nomor bot, siaran/welcome | `docs/agent-rules/whatsapp-gateway.md` + `gateway/AGENTS.md` |
| TUNVN PREHUB (reseller Telegram, katalog mirror tersembunyi) | `docs/agent-rules/tunvn.md` |
| Temp mail publik, Email Worker, domain penerima dan D1 inbox terpisah | `docs/agent-rules/temp-mail.md` + `temp-mail/README.md` |

Games S1 lokal (9 November 2026): host routing opsional `GAMES_HOST` default
`games.axvara.tech`; bila kelak dipasang di Pages wajib `secret_text`. Domain/metadata
dan nickname berbiaya mengikuti GAMES §3/§5.2 + ARCHITECTURE §16.29; bukan izin rollout.
Update PM9Nov malam: CNAME/custom domain Games ditambahkan (awal initializing, aktif
belum diverifikasi); empat env Digiflazz Pages `secret_text` memakai Development Key
+ testing=true, berlaku CI berikutnya (75env/79dari128termasuk sistem). P9 tetap preview;
nickname unavailable. Owner menutup gerbang key7.1 tanpa rotasi; webhook/deposit/
Production/transaksi nyata7.2–7.4 tetap terbuka. Access Games belum tercakup: admin
ke apex/API admin fail-closed. Detail dan batas bukti di aturan Digiflazz + GAMES12.6.

Keputusan baru per area ditulis di file `docs/agent-rules/` yang sesuai (terbaru
di atas); tambah baris indeks di sini hanya bila membuat area baru.

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


## Aturan Test (WAJIB)
Setiap perubahan kode wajib memiliki cakupan test yang sesuai. Tambah atau
perbarui test bila perilaku/kontrak berubah atau cakupan belum cukup; jangan
mengubah assertion hanya supaya kode yang salah terlihat lulus.

- Selama iterasi, jalankan test terkait setelah satu perubahan logis, misalnya `npx vitest run tests/nama.test.ts`; ini contoh path, ganti dengan test yang benar-benar ada.
- Sebelum commit/push perubahan kode, jalankan seluruh suite `npx vitest run --run` pada tree akhir. Tidak perlu mengulang seluruh suite setiap edit kecil; ulangi bila ada perubahan kode setelah verifikasi akhir.
- Jika memakai subagent, subagent menjalankan test fokus pada area tugasnya; agent utama menjalankan full suite pada kode final yang sudah terintegrasi, bukan setiap subagent selesai.
- Gunakan kembali hasil verifikasi sukses yang terbukti masih berlaku untuk kode, test, dependency, konfigurasi dan environment yang sama; jangan mengulang hanya untuk mengganti reporter atau memperoleh output baru. Perubahan dokumentasi saja setelah suite lulus tidak mewajibkan pengulangan suite; bila mengubah input verifikasi, ulangi pemeriksaan yang terdampak.
- Aturan penggunaan kembali hasil berlaku untuk verifikasi lokal; full suite CI tetap menjadi gerbang rilis dan tidak dilewati berdasarkan hasil lokal.
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

## Kredensial NOWPayments (WAJIB)
- Revisi7November2026: owner membuka rail non-QRIS ke publik web + Telegram; `NOWPAYMENTS_ENABLED=true` dan `SEKALIPAY_GATEWAY_ENABLED=true` (`secret_text`) dipasang di Pages, berlaku di deployment CI berikutnya. Kalimat "kedua flag publik tetap `false`" di bawah adalah snapshot 6 November. Detail di `docs/agent-rules/payments.md` dan ARCHITECTURE §16.22.
- Revisi6November2026: owner mengizinkan tes pembayaran nyata khusus admin, bukan publik/bot. Empat kredensial provider dan outcome `usdtbsc` kini disimpan sebagai Pages `secret_text`; `PAYMENT_ADMIN_TEST_ENABLED=true`, kedua flag publik tetap `false`. Halaman/API tes `770a051` sudah terdeploy; koreksi signature `38d2878` aktif di canonical `d2edb1924250472af223cfce0b955e2412bca1ee` (success `2026-11-06T15:40:46.22327Z`; invoice tersimpan terbukti dibuat, bukan paid/settlement), parser/kurasi baru masih menunggu publikasi. Jangan melemahkan Access/MFA atau membuat invoice produksi untuk QA. Lihat `docs/agent-rules/payments.md` dan ARCHITECTURE §16.21; catatan3November di bawah historis.
- File sumber tunggal lokal: `axvara/.nowpayments-credentials` (git-ignored `.nowpayments-credentials*`, chmod 600), berisi `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` dan `NOWPAYMENTS_API_BASE_URL`. Jangan commit/echo nilainya atau menyalin ke browser/bundle publik.
- Tahap 3 November 2026 hanya penyimpanan kredensial dan pemeriksaan API baca-saja; belum ada env Pages, endpoint IPN atau integrasi checkout crypto. Detail kesiapan dan langkah berikutnya di `docs/agent-rules/payments.md` dan ARCHITECTURE §16.15.

## Kredensial Sekalipay payment gateway (WAJIB)
- Koreksi tes6November2026: akun gateway VPS memakai IP whitelist; tanda tangani POST atas body JSON mentah identik, bukan Enhanced path/params/timestamp. GET200 tidak menguji signature POST. Direct Enhanced dipertahankan; jangan fallback/retry POST dengan mode lain atau reset klaim ambigu. Versi tes admin `770a051` dan koreksi signature `38d2878` (canonical `d2edb1924250472af223cfce0b955e2412bca1ee`, success `2026-11-06T15:40:46.22327Z`) sudah terdeploy; invoice tersimpan terbukti dibuat, bukan paid/settlement; parser/kurasi baru masih menunggu publikasi. Lihat payments.md dan ARCHITECTURE §16.20.
- Revisi6November2026: key/secret gateway boleh dipasang ke Pages khusus tes admin (lihat aturan NOWPayments di atas), tidak ke env supplier/proxy. Proxy `/skg/*` VPS sudah terpasang dengan backup penuh dan GET katalog18kanal terverifikasi; invoice tersimpan terverifikasi read-only lewat GET, tanpa pembayaran/settlement produksi. Larangan3November berikut adalah snapshot tahap penyimpanan, diganti hanya dalam scope tes admin ini.
- Sumber tunggal `.sekalipay-gateway-credentials` (git-ignored `.sekalipay-gateway-credentials*`, chmod600): `SEKALIPAY_GATEWAY_API_KEY` dan `SEKALIPAY_GATEWAY_SECRET_KEY`. Terpisah dari kredensial/env Sekalipay supplier existing; jangan saling mengganti atau mengirim key gateway ke proxy supplier.
- Instruksi owner 3 November 2026: hanya simpan. Rencana kelak NOWPayments untuk crypto dan Sekalipay gateway untuk non-QRIS di web AXVARA serta bot Telegram; belum diimplementasikan/diaktifkan. Jangan memanggil API, mengubah dashboard/env produksi atau mengerjakan integrasi pada tahap penyimpanan ini.

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
- [ ] Jangan membuat ulang `/Users/macbookair/AGENTS.md` global (dihapus atas instruksi owner 2 November 2026)

## Ekosistem terkait (WAJIB TAHU sebelum ubah integrasi)
Repo ini tidak berdiri sendiri. Rujukan folder lokal terkait:

| Folder lokal | Peran | Keterkaitan dengan repo ini |
|---|---|---|
| `/Users/macbookair/axvara-wa-gateway` | Arsip gateway/session lokal. Source kanonis sejak24Oktober ada di `axvara/gateway/`, app Heroku akun#1 tetap existing. `/wr/*` tetap410 | `WHATSAPP_GATEWAY_URL` + `WHATSAPP_WEBHOOK_TOKEN` Pages ↔ `AXVARA_WEBHOOK_TOKEN` gateway. Deploy hanya CI main AXVARA; jangan push Heroku/upload session arsip. Baca `gateway/AGENTS.md` dan ARCHITECTURE §16.12 |
| `/Users/macbookair/axvara-qris-gateway` | Riset QRIS DANA + nilai rujukan (`DOKUMENTASI_PRODUKSI.md`, `.env` = payload statis Brotherstore06 + secret). BUKAN deploy target | `DANA_STATIC_QRIS` + `DANA_WEBHOOK_SECRET` Pages berasal dari sini. Engine prod ada di `src/lib/payments/dana-qris.ts` |
| `/Users/macbookair/axvara-wr-proxy` | Source proxy WR/SK (live di VPS AWS `https://wr-proxy.axvara.tech` sejak 2026-10-02; app Heroku akun #2 + QuotaGuard DIHAPUS TOTAL hari yang sama — akun #2 kini kosong) | `WARUNG_REBAHAN_PROXY_URL/TOKEN` + `SEKALIPAY_PROXY_URL` Pages menunjuk ke VPS. Kontrak: `POST /wr/:endpoint` + `/sk/*` + `x-proxy-token`, key server-side; payment gateway merchant Sekalipay `ALL /skg/*` (6 Nov 2026, allowlist `GET /skg/v1/gateway/payment-methods`, `POST /skg/v1/gateway/payment`, `GET /skg/v1/gateway/payment/<ref>`; header `x-proxy-token`; meneruskan hanya `X-API-Key`/`X-Timestamp`/`X-Signature` + body mentah ke `sekalipay.com/api/v1/gateway/*` karena whitelist IP merchant = VPS saja; 502 `skg_proxy_unreadable_response`, 504 `skg_proxy_timeout`, 401 `unauthorized`, 404 `unknown_skg_path`; adapter `src/lib/payments/sekalipay-gateway.ts`, rule `docs/agent-rules/payments.md`); Digiflazz buyer `POST /dgf/v1/{cek-saldo,price-list,transaction}` (9 Nov 2026, terpasang; header `x-proxy-token` = token WR; body JSON bertanda tangan Pages diteruskan mentah ke `api.digiflazz.com`; 502 `dgf_proxy_unreadable_response` hanya untuk transaction, 504 `dgf_proxy_timeout`, 404 `unknown_dgf_path`; klien `src/lib/games/digiflazz.ts`, rule `docs/agent-rules/digiflazz.md` + `docs/GAMES.md` §12); potongan katalog cron `POST /wr/products-slice` + `GET /sk/catalog-slice` (2026-10-04, urutan WAJIB sama dengan `src/lib/{warung-rebahan,sekalipay}/sync.ts`). Diff katalog: VPS → `POST /api/supplier-sync` tiap 3 mnt (secret `SUPPLIER_SYNC_TOKEN` di Pages + `.env` VPS, nilai sama). Deploy VPS: lihat `axvara-wr-proxy/AGENTS.md`. ProviderSMM `/psmm/*` dinonaktifkan via env 13 Nov 2026 (key dicabut, health psmm:false); kode psmm di repo proxy belum dibersihkan |
| `/Users/macbookair/axvara-tg-bot` | Kredensial + rujukan Bot Telegram (kode bot tetap di repo ini: `src/lib/telegram/`) | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` + `TELEGRAM_ADMIN_CHAT_ID` Pages dicatat di sana. Isi manual, lalu set sebagai `secret_text` |

Aturan lintas-repo: (1) Env Pages bertipe `secret_text` SELALU (plain_text tidak terbawa deploy); PATCH env hanya berisi kunci yang nilainya dikirim — JANGAN kirim balik `deployment_configs`/`env_vars` hasil GET (insiden 9 Nov 2026 mengosongkan semua secret, ARCHITECTURE §16.2); (2) Jangan `wrangler pages deployment create` tanpa direktori (me-redeploy artefak lama = rollback prod); (3) Deploy hanya via CI (`git push origin main`); (4) Perintah Heroku akun #2 wajib prefix `HEROKU_API_KEY=<kunci-akun-2>`.
Setiap mengubah/menambah env Pages, WAJIB perbarui `.pages-env-backup` lokal (git-ignored, chmod600; jangan cetak nilai) dan salinan password manager owner; pemulihan memakai dry-run `scripts/pages-env-restore.mjs` sebelum `--apply` (ARCHITECTURE §16.2).

## Done when
- Tujuan tugas tercapai
- Perubahan diimplementasi
- `CHANGELOG.md` terisi
- Dokumentasi terkait terisi (PRD/DESIGN/ARCHITECTURE/README sesuai tabel Aturan Dokumentasi)
- Verifikasi sesuai dampak perubahan jelas; pemeriksaan yang tidak relevan ditandai `N/A` dan batas bukti disebutkan
- Untuk tugas perubahan kode/dokumentasi: commit dan `git push origin main` otomatis sesuai aturan CI/CD; setelah push berhasil berhenti tanpa memantau deployment
- Risiko/tindak lanjut diringkas
