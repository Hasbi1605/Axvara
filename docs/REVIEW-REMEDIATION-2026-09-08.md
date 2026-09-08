# REVIEW-REMEDIATION-2026-09-08 — Penyelesaian R1–R12

Tanggal: 8 September 2026 (Asia/Jakarta). Snapshot review asal + perbaikan:
`71aa840` (R1) → `b7e6906` (R2) → `259ccc8` (R3) → `789efdb` (R4) →
`5e6d47f` (R5) → `de12863` (R6) → `bb85b23` (R7) → `a06afec` (R8) →
`0f3cdf9` (R9) → `0313b2a` (R10) → `8597ed9` (R11) → `28705b3` (R12).

Verifikasi akhir sesi ini: vitest 418/418, `tsc --noEmit` bersih, fixture
`/tmp/axvara-review-17.cjs` 16/16 kasus berperilaku benar (lihat tabel).
Semua reproduksi memakai SQLite terisolasi + gateway palsu; tanpa pesan,
kredensial, atau transaksi ke pelanggan nyata.

## Ringkasan status

| Temuan | Status | Bukti perilaku |
|---|---|---|
| R1 event sebelum invoice / nominal dipakai-ulang | Selesai | `tests/payment-review.integration.test.ts` (7) + `dana-causal-match` (+1 UTC); fixture: nearby_old→409 `event_predates_invoice` + pending; delayed→`unmatched` + pending |
| R2 agregat delivered prematur | Selesai | `tests/fulfillment-delivery.integration.test.ts` (6); fixture: manual→`manual_required` 0 kirim; partial→terbuka 0 kirim; happy→delivered 2 kirim |
| R3 inventory per baris + kanal web | Selesai | `tests/fulfillment-inventory.integration.test.ts` (7); fixture: two-unique→rollback total; web-shared→`manual_required` stabil |
| R4 recovery lock per item | Selesai | `tests/fulfillment-lease.integration.test.ts` (7); fixture: stale→released 2 + delivered 1 kirim |
| R5 retry Telegram nyata | Selesai | `tests/telegram-retry.integration.test.ts` (4, termasuk 1 R7); fixture: crash→500 `error_retryable` + failed |
| R6 konfirmasi manual atomik | Selesai | `tests/order-confirm-atomic.integration.test.ts` (3); fixture: interupsi→pending + 0 job |
| R7 callback grup | Selesai | R7 di `telegram-retry`; fixture: grup→`group_redirected`, chat tersimpan `77` (bukan id grup) |
| R8 revokasi logout | Selesai | `admin-session` (+1); fixture: replay setelah logout→ditolak |
| R9 tanggal omzet kanonis | Selesai | `revenue-time` (+1 SQLite); fixture: paid 1 Sep/review 7 Sep→bucket 1 Sep |
| R10 lease outbox WA | Selesai | `tests/wa-outbox-lease.integration.test.ts` (2); fixture: worker ganda→1 kirim |
| R11 monitoring akurat | Selesai | `tests/overview-health.integration.test.ts` (4); matched→healthy, gagal→degraded, antrean macet→degraded |
| R12 budget query cron | Selesai | `tests/cron-budget.integration.test.ts` (2); 8 expiry tuntas 2 run @39 query, limit 50 tak abort |

## Dampak before–after (awam)

- R1: uang pelanggan tak lagi nyasar melunasi order orang lain; kasus meragukan masuk meja review admin dengan catatan, bukan lunas diam-diam.
- R2: order tak lagi dicap "terkirim" padahal sebagian barang belum jalan; barang manual menunggu serah-terima admin yang tercatat.
- R3: stok unik tak lagi diperebutkan diam-diam (yang kalah checkout diminta coba lagi, stok utuh); order web punya antre serah-terima admin yang jelas.
- R4: worker mati hidup lagi tanpa macet selamanya dan tanpa menimpa kerja worker baru; hasil kirim yang meragukan dicatat untuk dicek ke log provider.
- R5: gangguan sesaat Telegram kini benar-benar dicoba ulang Telegram, bukan hilang diam-diam.
- R6: klik "lunas" admin tak lagi bisa menghasilkan order bayar tanpa pekerjaan kirim.
- R7: tombol yang ditekan dari grup diarahkan ke chat pribadi; id grup tak pernah jadi identitas pembeli.
- R8: logout benar-benar mematikan sesi itu; cookie lama yang disalin tak bisa dipakai lagi.
- R9: laporan omzet per hari/bulan tak bergeser saat admin mengedit catatan atau kirim ulang notifikasi.
- R10: notifikasi WA penting tak terkirim ganda saat dua worker jalan bersamaan.
- R11: lampu health admin kini sesuai isi database (event cocok, antrean macet, kanal mati).
- R12: cron tak lagi mati di tengah jalan karena kehabisan jatah query; sisa antrean dikerjakan run berikutnya dan dilaporkan jujur (`deferred`).

## Migrasi tambahan (kompatibel, idempoten)

- `0017_payment_event_review.sql`: `dana_webhook_events.reviewed_by/review_note` + indeks riwayat nominal. Data lama: kolom NULL, perilaku lama (retry tanpa verifikasi) ditolak dengan pesan yang mengarahkan ke verifikasi manual.
- `0018_wa_outbox_lease.sql`: `whatsapp_outbox.worker_id/locked_until` + status `sending` + indeks lease; baris `sending` basi (crash window) dipulihkan ke `failed` untuk retry normal. Data lama: antrean pending/failed tak tersentuh.
- Migrasi 0007 diubah sebaris (CHECK mencakup `sending`) agar database BARU langsung konsisten; database lama mencapai state sama via 0018.

## Keterbatasan / butuh verifikasi produksi

- Fixture memakai SQLite + gateway palsu: redelivery Telegram asli, throughput gateway WA, dan batas D1 aktual (50/invocation Free) belum di-load-test di produksi.
- R8 stateless tanpa tabel sesi: di multi-instans Edge, garansi = cookie dihapus + rotasi password sebagai kill-switch global (didokumentasikan di route).
- R4/R10: setelah crash ambigu, redelivery dibatasi budget retry — rekonsiliasi ke log provider tetap tugas admin bila ragu.
- Nominal QRIS unik 1–299: bila semua terpakai, nominal dipakai-ulang dan WAJIB verifikasi manual (bukan auto-lunas).
- R12: 8 expiry butuh 2 run cron (±10 menit); `deferred` + `partial_run_more_pending` memberi tahu admin sisa antrean.
