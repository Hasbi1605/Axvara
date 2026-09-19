# Observability sync WR: penanda skip jujur + heartbeat cron

## Latar Belakang
Gap sync produk 07:12→10:24 UTC 19 Sep 2026 (~3 jam, 0 baris `products` baru, 0 `failed`) tidak bisa dibedakan dari rotasi normal tanpa forensik manual ±2 jam. Respons cron pada run yang skip sync mengembalikan `wr_products_synced:0` + `wr_sync_skipped:null` — identik untuk 4 kondisi berbeda: (1) fase WR tak aktif (normal), (2) interval 30 menit belum jatuh tempo (normal), (3) skip budget/deadline (sudah ditandai — satu-satunya yang jujur), (4) master switch mati / tabel belum siap (no-op total tanpa jejak). Selain itu tidak ada bukti "pemicu Worker memanggil" vs "run kepotong di tengah" — `cron_phase` ditulis di awal run sehingga keduanya terlihat identik.

## Tujuan
Setiap run cron melaporkan ALASAN skip sync secara eksplisit di respons JSON, dan setiap hit menulis heartbeat ringan ke D1 sehingga "pemicu mati" vs "run kepotong" bisa dibedakan dari data, bukan forensik.

## Ruang Lingkup
1. `results.wr_sync_skipped` diisi pada SEMUA jalur skip blok sync: `"disabled"` (switch mati/tabel belum siap), `"phase_inactive"` (fase tak aktif + tak ada antrean WR), `"interval"` (30 menit belum jatuh tempo), plus `"sync_disabled"` bila `WARUNG_REBAHAN_SYNC_ENABLED=false`. Nilai lama `"deadline"`/`"query_budget"` dipertahankan.
2. `results.wr_last_sync_at` = `created_at` sync products terakhir (atau null) — agar respons tunggal cukup untuk diagnosa tanpa query D1 tambahan.
3. Heartbeat: tulis `store_settings.cron_last_hit_at = datetime('now')` di awal handler (sebelum pekerjaan apa pun, sesudah auth). 1 statement, di dalam budget tail-reserved.
4. Test regresi untuk tiap nilai skip baru.

## Di Luar Scope
- Mengubah ambang 30/45 menit, budget 40, deadline 45 dtk, urutan fase, atau logika guard anti-starvation — semuanya terbukti benar.
- Mengubah perilaku sync itu sendiri (kapan sweep jalan). Ini murni observability: respons + 1 tulis ringan.
- Restart/pairing gateway WA, topup saldo — operasional, bukan kode.

## Area / File Terkait
- `src/app/api/cron/operations/route.ts` — `runWarungRebahan` (baris ±676-750), blok results awal (±146-151), ekor respons (±846-867), posisi heartbeat (±163-175).
- `tests/cron-deadline-poison.integration.test.ts` — pola fixture D1 + `run()` sudah ada; tambah describe baru di file yang sama.
- `docs/ARCHITECTURE.md` §16 (kontrak respons cron) + `README.md` bila ada bagian monitoring + `CHANGELOG.md`.

## Risiko
- Heartbeat menambah 1 statement D1 per run — wajib di dalam cadangan tail (2 statement) agar tidak menggeser budget kerja. Resiko rendah: tulis memakai `execRun` budgeted biasa di awal masih menyisakan 37 statement kerja (tanpa heartbeat 38).
- Test fixture memakai `WARUNG_REBAHAN_ENABLED=false` di `beforeEach` — test nilai `"disabled"` mudah; test `"interval"` butuh seed `wr_sync_log` segar + fase WR aktif; test `"phase_inactive"` butuh fase non-WR + tanpa antrean WR.
- Respons cron dikonsumsi admin/monitoring — field baru aditif, tidak menghapus field lama. Aman.

## Langkah Implementasi
1. Tambah `wr_sync_skipped: null` + `wr_last_sync_at: null` ke objek `results` awal.
2. Di `runWarungRebahan`: (a) no-op switch/tabel → `wr_sync_skipped="disabled"`; (b) fase tak aktif → `wr_sync_skipped="phase_inactive"` (tetap dorong deferred bila ada antrean); (c) gerbang 30-menit belum tempo → baca `created_at` terakhir, isi `wr_last_sync_at` + `wr_sync_skipped="interval"`; saat sweep jalan/fallback skip, isi `wr_last_sync_at` juga.
3. `syncOn=false` eksplisit → `wr_sync_skipped="sync_disabled"`.
4. Heartbeat `cron_last_hit_at` sekali di awal try (sesudah baca fase, sebelum writeCronPhase awal) — 1 execRun, best-effort `.catch`.
5. Test: 4-5 kasus baru (disabled / phase_inactive / interval / sync_disabled + heartbeat tertulis), pola RED→GREEN.
6. Docs + changelog + verifikasi penuh + push.

## Rencana Test
- `npx vitest run --run` — seluruh suite hijau (baseline 886 test / 84 file).
- Test baru di `tests/cron-deadline-poison.integration.test.ts`: assert `body.wr_sync_skipped` per skenario + `cron_last_hit_at` segar di `store_settings`.
- `npx tsc --noEmit` bersih; dev GET / 200 + CSS 200; Obscura home OK.
- Prod (pasca-deploy): 1x tembak manual baca `wr_sync_skipped` + `wr_last_sync_at` di respons.

## Kriteria Selesai
- Semua jalur skip sync melapor jujur; tidak ada lagi `synced:0 + skipped:null` yang ambigu.
- Heartbeat tertulis tiap run; beda "pemicu mati" vs "run kepotong" terbaca dari D1.
- Test hijau, docs + changelog terisi, push main sukses, CI hijau.
