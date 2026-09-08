# REVIEW-ROUND4-EXECUTION-2026-09-08 — Eksekusi perbaikan RR4-01–06

Tanggal: 8 September 2026 (Asia/Jakarta). Snapshot awal: `906dbef`.
Laporan review asal: `/tmp/AXVARA-REVIEW-ROUND4-2026-09-08.md`.
Perintah eksekusi: `/tmp/AXVARA-PROMPT-PERBAIKAN-ROUND4-2026-09-08.md`.

Reproduksi: SQLite terisolasi + gateway dummy + fault injection deterministik
+ adapter limit-50; tanpa pesan nyata/transaksi produksi. Baseline: 479/479
(40 file). Hasil akhir: **501/501 (43 file)** — 22 test baru
(11 cron-scale + 8 handover-ownership + 3 ui-recovery).

Pemetaan: RR4-01/02/06 berbagi jalur cron (unit per-item, orphan ringan,
sinyal expiry per jenis); RR4-03/04 berbagi handover (reconcile jujur,
stamp stabil, guard qty, UI recovery); RR4-05 kepemilikan worker
(FencedJobMutation + sinkron terminal).

## Tabel status RR4-01–06

| ID | Status | Akar masalah | Perubahan | Test/bukti sebelum → sesudah | Query/run aktual |
|---|---|---|---|---|---|
| RR4-01 | Selesai + bukti entrypoint | Unit kerja = 1 order lengkap (`6+5×n`); 5 item (31) tak muat setelah query awal + ekor; 8 item (46) > budget 40; `break` menahan job kecil di belakang. Komentar menyebut `processDueJobsUnit` yang tidak ada. | `deliver.ts`: `processJobItems(jobId,order,product,maxItems,shouldContinue)` — kirim per item, lewati delivered (tak dikirim ulang), `item_cursor` disimpan ke DB tiap item (checkpoint lintas restart), yield murni melepas lease TANPA konsumsi retry. `route.ts`: tiap job hitung `roomForItems` dari sisa budget, `makeBudgetGate` yield per item, `continue` (bukan `break`) agar job kecil tetap jalan. Migrasi 0022 (`fulfillment_jobs.item_cursor`) + kolom di `schema.sql`. `processJob` lama = delegasi tanpa batas (kompatibel). | `tests/rr4-cron-scale` RR4-01 (6): order 5/8/20 item selesai lintas invocation, kemajuan monoton, tanpa kirim ulang (RED: 12 cron 0 delivered → GREEN: delivered penuh). Order kecil di belakang besar selesai. Reload modul → lanjut dari cursor DB. Yield 20-item tak menghabiskan retry (0 failed). Fixture review `RR301_valid_5/8_item`: 0/0 → 5/5 + 8/8, order delivered. | 20-item ≈ 2 item/run (~19 query); 5-item ≈ 3 run; tiap run aktual ≤40, adapter ≤50. Batas run = n+4 (1 item/run terburuk + overhead fase), dijelaskan di test. |
| RR4-02 | Selesai + bukti entrypoint | Orphan dibebankan 12 tetapi `ensureFulfillmentForPaidOrder` mengirim inline: 1 orphan 4-item = 51 query, 2 orphan = 90, 2 manual = 74; estimasi 24–36/40 menutupi. | `deliver.ts`: `reconcileOrphanLight` (materialisasi + job queued, TANPA kirim; ≈11 query) + konstanta `COST_PER_ORPHAN_LIGHT=11`, `COST_PER_BACKFILL_LIGHT=5`. `route.ts`: orphan/backfill inline ringan; kirim di fase due-job per-item. Yield = 200 + deferred jujur (bukan 500). | `tests/rr4-cron-scale` RR4-02 (3): assert job=0 sebelum cron (orphan nyata). 1 orphan 4-item → tiap run <50, tuntas. 2 orphan 4-item → tiap run <50, keduanya delivered. 2 manual 3-item → manual_required. Fixture review: `two_four_item_orphans_50`: 500/53 → 200/38, jobs queued (lanjut run berikut); `two_three_item_manual_50`: 500/53 → 200/36. | 1 orphan 4-item ≈ 38 aktual (label 11×n + frame + kirim parsial); 2 orphan ≈ 38–40/run; margin ≥10 ke 50 untuk finalisasi. |
| RR4-03 | Selesai + bukti entrypoint + UI | `void healed` (delivered) + abaikan reconcile (kalah CAS) → 200 palsu saat DB masih gagal; UI `!pending.length → toast sukses` tanpa POST; retry menambah marker baru. | `deliver.ts`: cabang delivered/kalah-CAS propagasi `reconcile_failed` (reason baru); `readHandoverStamp` (stamp stabil dari marker awal); audit `NOT LIKE` guard (konkurensi 1 penulis). Route: 409 `handover_recovery_pending` + status kini (bukan 200). `OrdersManager.tsx`: semua-delivered + order belum delivered → POST pemulihan + toast SETELAH 200; gagal → toast error jujur. | `tests/rr4-handover-ownership` RR4-03 (4): 2 retry saat fault → 409/500 (RED: 200 ok:true → GREEN); pulih → 200 delivered konsisten. Cabang delivered propagasi gagal. Marker audit = 1 setelah 3 klik (RED: 3 → GREEN: 1). Inventory fault terpicu nyata (inventory_id>0) → 409 lalu pulih delivered. `tests/rr4-ui-recovery` (3): GET state proxy + POST pulih 200 + 409-saat-gagal. UI CDP: sukses POST=1 → delivered + toast "dipulihkan dari server"; gagal POST=1 → manual_required + toast error jujur. | — (handover bukan jalur budget cron) |
| RR4-04 | Selesai + bukti entrypoint | `findMissingFulfillmentLines` hanya index/product/variant; order qty 2 + fulfillment qty 1 → 200 delivered. | `deliver.ts`: `findFulfillmentLineMismatches` (+qty: missing/identity/short_qty); kontrak: 1 baris = seluruh qty baris order; short → mismatch (agregat tak delivered; tanpa timpa qty / reset item benar). `findMissingFulfillmentLines` = kompatibel. | `tests/rr4-handover-ownership` RR4-04 (2): qty 2 vs 1 → 409, order bukan delivered (RED: 200 delivered → GREEN); qty valid → 200 delivered. Fixture review `RR302`: 200 delivered → 409 manual_required. | — |
| RR4-05 | Selesai + bukti entrypoint | `scheduleRetryFenced` void; guard `status='retry' AND locked_until IS NULL` menolak hasil failed milik sendiri → order tetap queued. Status retry+NULL bukan bukti kepemilikan. | `deliver.ts`: `FencedJobMutation` (`{owned,transition}`); CAS kedua memastikan kepemilikan jeda baca-tulis; `processJob`/`processJobItems` sinkronkan order `failed` bila transisi failed (guard `NOT IN (delivered,manual_required,failed)`); retry seperti semula; `!owned` berhenti sebelum agregat. | `tests/rr4-handover-ownership` RR4-05 (2): attempt 5 gagal → job+item failed, order `failed` (RED: queued → GREEN). Worker basi vs owner baru (retry/failed/delivered/manual_required): status+error+item owner utuh. | — |
| RR4-06 | Selesai + bukti entrypoint | Sinyal expiry = COUNT pending saja; daftar initializing di balik gerbang itu; `publish-scheduled` melewatkan ledger aktif. | `route.ts`: sinyal per jenis (`expiry_init`: initializing basi; `expiry_manual_wa`: WA kedaluwarsa tanpa ledger) + `pendingExpiryAny`; daftar dibaca bila ada sinyal jenis apa pun; deferred per jenis; cleanup menunggu `pendingExpiryAny`. `publish-scheduled` TIDAK diubah (jalur cadangan untuk order tanpa ledger; initializing = tanggung jawab operations cron — didokumentasikan, bukan duplikasi). | `tests/rr4-cron-scale` RR4-06 (2): 1 initializing basi tanpa pending lain → pulih ≤6 run, tiap run ≤50, order tak lagi pending (RED: 6 run tetap initializing → GREEN: failed/dibatalkan). Initializing segar tak dibatalkan. Fixture review: initializing → failed; manual-WA + publish-scheduled diperiksa (lihat batas). | Tiap run ≤13 aktual. |

## Before/after dalam bahasa awam

- RR4-01: pesanan 5–20 barang macet total (12× cron, 0 terkirim) sekaligus menahan pesanan kecil di belakangnya → tiap barang dikirim bertahap sesuai muat, posisi tersimpan, pesanan kecil tetap jalan, 20 barang tuntas tanpa kirim ulang.
- RR4-02: 2 pesanan tanpa job meledakkan 90 query (gagal setengah, pesanan kedua yatim) → pemulihan ringan per pesanan + kirim bertahap; tiap VOIP cron <50; semua tuntas lintas run.
- RR4-03: klik ulang saat DB rusak mengaku "berhasil" padahal belum; tombol UI berbunyi sukses tanpa menghubungi server; tiap klik menambah catatan baru → gagal diakui gagal (409), tombol benar-benar memanggil pemulihan, sukses hanya setelah server konfirmasi, satu fakta audit.
- RR4-04: pesan 2 unit tercatat 1 unit lalu diklaim "selesai semua" → kekurangan unit terdeteksi, pesanan tak selesai sebelum unit benar diserahkan; pesanan benar tetap jalan.
- RR4-05: kirim terakhir gagal → pesanan diam sebagai "menunggu" selamanya → status jujur "gagal, perlu admin"; worker lama tak merusak hasil worker baru.
- RR4-06: tagihan yang pembuatannya terputus (initializing) tak pernah ditutup bila sendirian → ditutup dalam ≤6 cron; yang masih segar tak dibatalkan prematur.

## Command dan hasil aktual (sesi ini)

- `npx vitest run --run` → **43 file, 501/501 lulus** (479 + 22 baru).
- `npx tsc --noEmit --incremental false` → bersih.
- `npm run build:pages` → lulus (2.88s, worker + 363 aset).
- Dev (di-restart setelah build, `.next` bersih): `GET / 200`, CSS `200`, `/admin?section=orders 200`, tanpa error kompilasi (6× Compiled, tanpa error).
- Obscura: home (title + h1 + PNG nonblank); UI handover CDP via proxy lokal — sukses: GET 1, POST 1, delivered, toast "dipulihkan dari server"; gagal: POST 1, manual_required, toast error jujur. Screenshot: `/tmp/axvara-review4-handover-success-{before,dialog,after}.png`, `-fail-{before,dialog,after}.png`.
- Fixture review4: `RR301 5/8 → delivered 5/5 + 8/8`; `RR307 → 500 lalu 409`; `RR302 → 409`; `RR308 → failed/failed/failed`; initializing → failed; orphans-50 → 200 (queued → lanjut run).
- Regresi terjaga: revokasi fail-closed, invoice webhook→cron, WA sending-basi, notifikasi paid (suite terkait hijau).

## Koreksi klaim round 3 (bertanggal, historis dipertahankan)

- `docs/REVIEW-ROUND3-EXECUTION-2026-09-08.md` §RR3-01 "order besar bertahap" → HANYA terbukti 4 item; 5–20 item BARU terbukti di round 4 (dokumen ini). §RR3-03 "konvergen tanpa partial_failure di bawah limit-50" → HANYA 1 orphan 4-item ringan; 2 orphan (90 query) BARU tunduk budget di round 4. §"pemeriksaan qty" → BELUM ada di round 3; baru di RR4-04. §"dikerjakan per ITEM" → komentar tanpa implementasi di round 3; implementasi (`processJobItems` + `item_cursor`) baru di round 4. §"UI melaporkan per barang" → BENAR untuk item pending, tetapi kasus semua-delivered (toast palsu) BARU diperbaiki di RR4-03. Klaim lain (revokasi, invoice, WA, notifikasi) tetap berlaku.

## Keterbatasan

- Cart 20-baris penuh diuji sebagai order 20-item valid (bukan via klik cart Telegram E2E); batasan unique-mode (1 baris unique/keranjang) dipertahankan — 20 shared valid.
- UI CDP memakai proxy dummy untuk auth/order (otorisasi + penyimpanan backend dibuktikan terpisah di `tests/rr4-ui-recovery` handler aktual) — batas yang dinyatakan eksplisit.
- `publish-scheduled` untuk WA-manual tanpa ledger tidak diubah (jalur cadangan yang ada); initializing = operations cron.
- Beban produksi, provider nyata, dan race di luar skenario tidak dicakup. Tidak ada klaim % kesiapan baru.
