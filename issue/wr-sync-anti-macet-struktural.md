# Anti-macet struktural sync WR: watchdog alert + Force Sync aman + respons jujur penuh

## Latar Belakang
Empat insiden sync mati berulang dengan akar berbeda-beda:
1. 17–18 Sep (~16 jam): poison-pill — fase terkunci, run kepotong tiap 5 mnt.
2. 18 Sep (+2,5 jam): guard anti-starvation memveto dirinya sendiri.
3. 18 Sep (+8 jam): env Pages mati tanpa jejak.
4. 19 Sep (~3 jam, 07:12→10:24): fetch `/wr/products` 200 tiap 5 mnt jalan (log proxy), tapi `wr_sync_log` kosong — sweep tak menulis log, sebab pasti tak tertutup (korelasi deploy recycle Functions).

Setiap insiden butuh forensik manual 1–3 jam oleh manusia. Observability (skip jujur + heartbeat, 19 Sep) mempercepat DIAGNOSA tapi tidak MENCEGAH atau MENGOBATI. Pemilik meminta: ke depan jangan macet-macet lagi.

## Tujuan
Tiga lapis pertahanan sehingga (a) kegagalan terdeteksi otomatis dalam ≤90 menit tanpa manusia mengecek, (b) pemilik bisa memulihkan sendiri dari dashboard tanpa keahlian teknis, (c) respons cron tidak pernah ambigu lagi.

## Ruang Lingkup
1. **Watchdog sync basi → alert Telegram admin** (`alertStaleWrSync`, pola idempoten `aging_alerted_at`): tiap run fase WR aktif, cek sweep terakhir; bila >90 menit + belum pernah alert untuk kebasian ini → kirim Telegram "sync basi X menit, terakhir {waktu}, sebab terakhir: {wr_sync_skipped}" + catat `results.wr_sync_stale_alerted`. Idempoten via `wr_sync_state(sync_stale_alerted_at)` — alert sekali per episode basi (reset saat sweep sukses baru). Best-effort, ≤4 query, di dalam budget fase WR.
2. **Force Sync aman dari dashboard** — endpoint `POST /api/admin/warung/sync` SUDAH ADA; audit: pastikan ia mem-bypass gerbang 30-menit (selalu sweep penuh) + kembalikan alasan bila gagal; dashboard tampilkan hasil/error-nya (bukan toast generik). Bila sudah benar, cukup test + docs; bila belum, perbaiki minimal.
3. **Respons jujur penuh**: `wr_sync_skipped` juga diisi `"budget_yielded"`/`"attempted_failed"` bila `syncProducts` mengembalikan `budgetYielded`/errors — hari ini kedua kasus itu hanya mendorong deferred tanpa mengisi skipped (masih ambigu di JSON).
4. Test regresi tiap lapis (RED→GREEN) + docs + changelog.

## Di Luar Scope
- Mengubah ambang 30/45/90 menit, budget, deadline, urutan fase, logika sync — semua terbukti benar.
- Retry otomatis paksa di luar jadwal (berisiko hammer upstream saat API WR down; watchdog = alert, bukan auto-fix agresif).
- Pairing gateway WA / topup saldo — operasional.
- Migrasi D1 baru — idempoten watchdog memakai `wr_sync_state` yang sudah ada (key-value generik).

## Area / File Terkait
- `src/app/api/cron/operations/route.ts` — fase WR (watchdog setelah blok sync ±786-805, isi skipped baru di cabang errors).
- `src/lib/warung-rebahan/order.ts` — pola `alertAgingWrOrders`/`notifyAdmin` untuk ditiru.
- `src/app/api/admin/warung/sync/route.ts` + `WarungRebahanManager.tsx` — audit Force Sync.
- `tests/cron-deadline-poison.integration.test.ts` — test baru.
- `docs/ARCHITECTURE.md` §16 + `README.md` + `CHANGELOG.md` + `.env.example` bila ada flag baru (HINDARI flag baru — threshold 90 mnt konstanta kode).

## Risiko
- Watchdog menambah 1–2 query per run fase-WR-aktif — di dalam budget (fase WR jarang aktif tiap run; guard `budget.fits(4)`).
- Alert fatigue: threshold 90 mnt (3x interval normal) + idempoten per episode → maksimal 1 ping per insiden. Reset Osmosis: saat sweep sukses, hapus/timpa state alert.
- Force Sync bypass interval: aman karena idempoten (upsert by wr IDs, bukan insert) + tetap lewat destructive guard.
- Telegram down → `.catch` best-effort, state tetap ditandai (lebih baik 1 ping hilang daripada spam tiap 5 mnt — pola yang sama dengan aging alert).

## Langkah Implementasi
1. Audit `POST /api/admin/warung/sync`: baca kode, pastikan bypass interval + error jujur; perbaiki/test bila kurang.
2. `alertStaleWrSync(db, lastSyncAt)`: >90 mnt + state belum menandai episode ini → tandai dulu, kirim Telegram (sebab = skipped terakhir bila ada), return 1/0 ke results.
3. Isi `wr_sync_skipped="budget_yielded"` / `"attempted_failed"` (guard `== null` agar tak timpa interval/disabled yang lebih informatif? TENTUKAN saat implementasi: attempted_failed lebih informatif → timpa).
4. Panggil watchdog di fase WR aktif SETELAH blok sync (agar `wr_sync_skipped` run ini ikut jadi konteks alert).
5. Test: basi→alert 1x; run berikut→tak alert lagi; sweep sukses→reset; errors→skipped terisi.
6. Docs + changelog + verifikasi penuh + push; verifikasi prod: tunggu/cek tidak ada alert palsu.

## Rencana Test
- `npx vitest run --run` hijau penuh (baseline 892/84).
- Test baru: stale 2 jam → `wr_sync_stale_alerted=1` + state tertulis; run ulang → 0; seed sweep segar → state reset; sync errors → skipped tepat.
- Mock `sendMessage` seperti file test eksisting.
- tsc + dev + Obscura + tembak prod baca field baru.

## Status implementasi (2026-09-20)
- Lapis 1 (watchdog) + lapis 3 (skipped penuh) LIVE. Lapis 2 (Force Sync) terverifikasi sudah benar tanpa perubahan.
- Revisi permanen: watchdog evaluasi SETIAP run di depan handler (insiden 18:26→23:32 membuktikan versi fase-aktif saja kebobolan 5 jam) + refresh konteks 1x + hemat budget 0-query bila switch mati (pelajaran RR5-02) + fix bug urutan `wrTablesReady` (tertangkap test).
- Verifikasi: 899/899 test hijau (RED→GREEN ganda), tsc bersih, dev + Obscura OK.
