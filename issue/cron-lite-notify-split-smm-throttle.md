# Pecah job=notify + throttle saldo SMM 6 jam

## Latar Belakang
- 2026-10-09 09:50 WIB: 4 langkah lite 503 bareng (`fulfillment, wr_orders, notify, promo`) — limit CPU Free plan flapping, pulih sendiri ~30 mnt. KV alarm: 09:45+09:50 gagal beda komposisi, 10:20+10:25 sukses.
- `job=notify` satu-satunya lite job yang kipas 5 sub-kerjaan dalam 1 request (5 dynamic import). Diukur live 1,9 dtk saat antrean kosong; saat ramai rawan jebol.
- Notif `Saldo ProviderSMM menipis` spam tiap jam (saldo Rp 0, ambang 100rb, gate 1 jam, tanpa syarat turun) vs WR/SK max 4x/hari (gate 6 jam + turun Rp5.000).

## Tujuan
1. Kecilkan biaya CPU per request `notify` dengan memecah jadi 2 sub-job + jeda antar langkah Worker.
2. Samakan throttle saldo SMM ke pola WR/SK (6 jam + turun Rp5.000) tanpa ubah format pesan/copy.

## Ruang Lingkup
- `src/app/api/cron/lite/route.ts`: `notify` dipecah `notify_a` (telegram_retry + invoice_retry) dan `notify_b` (qris_expiry + reminders + whatsapp_outbox). `job=notify` LAMA tetap hidup sebagai alias gabungan (kompat rute besar/heavy + pemanggil lama). LITE_JOBS + komentar header diperbarui.
- `mcp-worker/src/cron.ts`: CRON_STEPS lite `notify` → `notify_a` + `notify_b` (keduanya soft); jeda kecil antar langkah (mis. sleep 2 dtk, hanya di runtime Worker — bukan di test murni).
- `src/lib/pedia/notify.ts` atau lite route: throttle SMM jadi `amount|timestamp` di `store_settings.pedia_balance_alert_at` (kompat baca format lama datetime), gate 6 jam + turun Rp5.000 (cermin WR/SK 1:1).
- Test: cron-lite (alias + sub-job), cron-phase-split (urutan + alarm), test baru throttle SMM.
- Docs: ARCHITECTURE §cron/lite, README cron, PEDIA-PRD §alert, CHANGELOG.

## Di Luar Scope
- Naik plan Cloudflare, ubah copy pesan, ubah ambang default (100rb), ubah cadence cek saldo 30 mnt, ubah route besar operations.
- Tidak menyentuh fulfillment/wr_orders/sk_orders/promo/digest.

## Area / File Terkait
- `src/app/api/cron/lite/route.ts` (runNotify → runNotifyA/B + alias)
- `mcp-worker/src/cron.ts` (CRON_STEPS + jeda)
- `src/lib/pedia/notify.ts` (+ test baru `tests/pedia-saldo-throttle.test.ts` atau dekat pedia-qa)
- `tests/cron-lite.integration.test.ts`, `tests/cron-phase-split.integration.test.ts`
- `docs/ARCHITECTURE.md`, `README.md`, `docs/PEDIA-PRD.md`, `CHANGELOG.md`

## Risiko
- Mengubah CRON_STEPS menggeser ekspektasi urutan di `cron-phase-split` test — perbarui test di commit sama.
- Alias `notify` harus tetap menulis penanda `cron_lite_notify_ok_at` agar histori tidak putus; sub-job menulis penanda sendiri.
- Format lama `pedia_balance_alert_at` (datetime ISO) masih ada di prod → parser harus terima dua format (ISO lama = anggap amount tak diketahui → tulis format baru sekali, tanpa spam ganda).
- Jeda Worker jangan memperlambat tick > plafon cron Worker; 2 dtk × 8 langkah ≈ 16 dtk, masih aman di bawah 5 mnt.

## Langkah Implementasi
1. lite route: ekstrak 5 guard jadi fungsi; `runNotifyA`, `runNotifyB`; `runNotify` = A lalu B (alias). LITE_JOBS tambah keduanya; penanda per job.
2. Worker: ganti 1 langkah notify → 2 langkah soft + `sleep(2000)` antar langkah via waitUntil-safe (bukan blocking alarm logic).
3. SMM throttle: state `"<balance>|<ms>"`, gate 6 jam + turun 5rb; migrasi baca format lama.
4. Test baru + perbarui test urutan/alarm; vitest + tsc.
5. CHANGELOG + docs; verifikasi dev + Obscura; push.

## Rencana Test
- `tests/cron-lite.integration.test.ts`: `notify` tetap 200 gabungan; `notify_a`/`notify_b` 200 mandiri + penanda masing-masing.
- `tests/cron-phase-split.integration.test.ts`: urutan tick biasa/heavy memuat notify_a+notify_b; alarm soft (6 tick) tetap untuk keduanya;-alias lama tidak dipakai Worker.
- Test throttle SMM: stagnan Rp 0 → 1 notif; turun >5rb → bunyi lagi; format lama ISO → migrasi tanpa spam.
- `npx vitest run --run` hijau + `npx tsc --noEmit`.

## Kriteria Selesai
- vitest hijau, tsc bersih, dev GET / 200 + CSS 200, Obscura nonblank.
- CHANGELOG + ARCHITECTURE + README + PEDIA-PRD diperbarui.
- Push main berhasil, berhenti tanpa pantau CI.
