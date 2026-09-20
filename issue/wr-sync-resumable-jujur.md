# Sweep WR resumable + jujur: tak ada lagi run kepotong tanpa jejak

## Latar Belakang
Data prod 19–20 Sep membuktikan akar ketiga gap misterius (07:12→10:24, 18:26→23:32, 07:07→09:50):
- Sweep cron memakan 50–116 DETIK (`wr_sync_log.duration_ms`), sementara admission gerbang hanya menuntut sisa waktu 14 detik (`hasTime(TIME_WR_NETWORK)`) dan deadline lunak 45 detik. Sweep 115 detik MELEWATI keduanya.
- `syncProducts` menulis cursor + `logSync` HANYA di ujung (setelah loop 48 produk). Run yang kepotong platform di tengah (plafon ~125 dtk, atau deploy recycle Functions) meninggalkan NOL baris log, NOL cursor baru, NOL jejak — lalu mengulang dari awal di run berikut dan kepotong lagi. Fetch `/wr/products` 200 tiap 5 menit di log proxy adalah buktinya: kerja diulang, hasil tak pernah tercatat.
- Tembakan manual 10–12 detik sukses karena isolate/route berbeda (tanpa fase lain + tanpa budget terpakai) — bukan karena datanya beda (48/87 identik, 0–4 changes).

## Tujuan
Sweep yang kepotong HARUS meninggalkan (a) cursor tersimpan (lanjut, bukan ulang), (b) baris log `partial` + respons `budget_yielded`/`attempted_failed` yang jujur, sehingga tak ada lagi gap tanpa jejak apa pun.

## Ruang Lingkup
1. **Checkpoint cursor per produk** di `syncProducts`: tiap N produk (mis. 8) tulis `products_cursor` + `products_progress_at`; bila run mati, run berikut lanjut dari cursor (bukan 0). Murah: 6 tulis/run.
2. **Log parsial saat yield**: bila loop berhenti karena budget (`budgetYielded`) — tulis `logSync partial` + kembalikan `budgetYielded:true` (sudah ada) — PLUS pastikan caller cron mengisi `wr_sync_skipped="budget_yielded"` (sudah ada). Yang hilang hanya checkpoint-nya.
3. **Heartbeat kemajuan**: `writeSyncState(products_progress_at)` tiap checkpoint — bedakan "run kepotong di tengah sweep" (progress segar, log basi) vs "fase tak jalan sama sekali" (keduanya basi).
4. **Admission jujur**: `hasTime(TIME_WR_NETWORK)` → syarat sisa waktu proporsional (mis. sweep penuh butuh estimasi dari `duration_ms` terakhir × 1,5; bila tak cukup, skip dengan `wr_sync_skipped="deadline"` SEBELUM fetch — bukan sesudah fetch lalu mati diam).
5. Test RED→GREEN + docs + changelog.

## Di Luar Scope
- Mengubah logika upsert, destructive guard, urutan fase, ambang 30/45/90 menit.
- Menambah budget plafon (menyembunyikan masalah, bukan memperbaiki).
- Auto-retry agresif / Force Sync otomatis.

## Area / File Terkait
- `src/lib/warung-rebahan/sync.ts` — loop produk (checkpoint), `logSync` saat yield, estimasi durasi.
- `src/app/api/cron/operations/route.ts` — admission `hasTime` → estimasi proporsional.
- `tests/warung-rebahan/sync.test.ts` + `tests/cron-deadline-poison.integration.test.ts` — test baru.
- `docs/ARCHITECTURE.md` §16 + `README.md` + `CHANGELOG.md`.

## Risiko
- Checkpoint tiap produk = 48 tulis/run (mahal). Wajib batch tiap N produk (8) → 6 tulis. Tanpa ini budget jebol.
- Cursor antar-run + generasi berubah: bila katalog upstream berubah total di tengah, cursor lama bisa salah posisi — mitigasi: reset cursor bila `generation` berubah (sudah ada pola di `startAt`).
- Partial log tiap yield menambah baris `wr_sync_log` — batasi: log partial hanya bila `synced>0` (ada kemajuan nyata).
- Estimasi durasi dari run lalu bisa salah saat latensi D1 berubah drastis — pakai faktor aman 1,5x + tetap izinkan mulai bila tak ada histori (fail-open pertama kali, fail-closed setelahnya).

## Langkah Implementasi
1. Tambah konstanta `WR_SYNC_CHECKPOINT_EVERY=8` + tulis cursor tiap checkpoint (+ `products_progress_at`).
2. Saat `budgetYielded` + `synced>0`: `logSync partial` sebelum return (status partial tercatat, bukan hilang).
3. Admission: estimasi = `lastDurationMs × 1,5` (dari `wr_sync_log` terakhir, fallback TIME_WR_NETWORK bila tak ada); `hasTime(estimasi)` else skip `deadline` SEBELUM fetch.
4. Test: simulasi mati di tengah (fail pada query ke-N) → cursor tersimpan; run berikut lanjut (tak ulang dari 0); partial log tertulis; admission menolak bila sisa waktu < estimasi.
5. Docs + changelog + verifikasi penuh + push + verifikasi prod (durasi sweep + tak ada lagi gap tanpa partial).

## Rencana Test
- Unit `sync.test.ts`: kill di tengah → cursor = posisi mati; resume → synced total tetap 48 tanpa duplikat; partial log 1 baris.
- Integrasi cron: budget sempit → `wr_sync_skipped="budget_yielded"` + partial log ada; deadline sempit → `"deadline"` SEBELUM fetch (assert fetch tak dipanggil via mock).
- Full suite hijau + tsc + dev + Obscura.

## Kriteria Selesai
- Run kepotong SELALU meninggalkan cursor + partial log + skipped jujur.
- Gap tanpa jejak tidak mungkin lagi secara konstruksi (bukan sekadar observasi).
- Test hijau, docs + changelog, push, CI hijau, verifikasi prod.
