# AXVARA — Eksekusi perbaikan review round 5

Tanggal: 9 September 2026, Asia/Jakarta. Snapshot awal `5c1d6e3`, branch `main`, bersih sebelum perubahan. Acuan: `/tmp/AXVARA-REVIEW-ROUND5-2026-09-08.md`. Pemilik meminta agent review langsung memperbaiki delapan temuan. Tidak ada perubahan skema/migrasi; skema sampai 0022 tetap menjadi prasyarat.

## Status dan dampak sebelum/sesudah

| Temuan | Sebelum, menurut reproduksi review | Perubahan dan hasil yang diuji | Dampak awam |
|---|---|---|---|
| RR5-01 — handover D1 | Pola LIKE audit 67 byte ditolak D1; POST 500 lalu retry 409 terus. | `instr` mencari teks literal; identitas per order/item stabil. Adapter dengan batas pola D1: tiga POST berturut-turut 200, item/order/job delivered, satu fakta audit. | Tombol pencatatan penyerahan tidak lagi macet akibat panjang email/waktu dalam catatan. |
| RR5-02 — budget cron | Orphan 20 baris menghabiskan 53–72 query meski indikator 37/40; materialisasi belum dibatasi. | Binding request-scoped menghitung seluruh helper dan anggota batch sebelum dispatch. Batas 40, cadangan checkpoint 2, materialisasi maksimal 2 baris/job/run. Shared/manual, 1/20 produk, unique, dua orphan nyata, backfill, dan antrean expiry terus masuk diuji hingga selesai. | Pesanan besar diproses bertahap dengan kemajuan tersimpan; tidak kehabisan kuota di tengah pekerjaan karena hitungan yang terlalu rendah. |
| RR5-03 — retry habis karena jeda normal | Lima yield normal lalu satu timeout membuat job gagal terminal; barang yang belum pernah dicoba tertinggal. | Klaim per-item tidak menambah attempt job. Yield kembali queued; hanya kegagalan menambah hitungan. Test: lima yield, satu timeout, kemudian 20/20 delivered; 21 percobaan provider termasuk satu yang gagal. | Berhenti sejenak karena jatah kerja habis tidak lagi dianggap gagal mengirim. |
| RR5-04 — qty dan sukses palsu | Handover pertama qty kurang 409, retry 200/manual_required dengan toast hijau; cron bisa menandai delivered; qty berlebih lolos. | Satu validator identitas+qty integer positif dan persis sama pada handover/recovery/cron. Mismatch ditahan sebelum provider. UI memeriksa status akhir delivered, termasuk hasil beberapa item, selain HTTP sukses. | Pesanan tidak dinyatakan lengkap saat jumlah barang belum cocok; catatan penyerahan yang benar tetap disimpan. |
| RR5-05 — worker lama merusak status | Worker A melepas lease, B menulis failed, A lanjut menimpa order menjadi retry. | Order dan job dimutasi dalam batch D1 yang sama saat lease masih dimiliki; tidak ada write setelah lease dilepas. Pembacaan claim, binding inventory, retry item dan settlement unique juga berpagar. Test menahan worker A tepat setelah batch melepas lease, menjalankan B, lalu melanjutkan A: failed tetap failed. | Dua proses yang berpapasan tidak lagi membuat status akhir mundur ke hasil proses lama. |
| RR5-06 — flag WA diabaikan | Cron tetap mengirim WA ketika pengiriman otomatis WA dimatikan. | Jalur D1 langsung memakai processor per-item yang sama dengan cron. Flag false menuju manual, nol gateway; flag true tetap menunggu bukti pada rail manual bila proof hold aktif, kemudian mengirim setelah bukti tersedia. | Sakelar pengiriman WhatsApp kembali berlaku konsisten. |
| RR5-07 — audit ganda saat klik bersamaan | Request kalah CAS membuat audit dengan waktunya sendiri; satu penyerahan tampak dua kali. | Recovery mengambil pelaku/waktu dari fakta item milik request pemenang, bukan admin/waktu retry. Uji dua POST bertumpang tindih serta storage gagal lalu retry oleh admin berbeda menghasilkan satu fakta asli. | Riwayat menunjukkan siapa yang benar-benar mencatat penyerahan pertama, tanpa penyerahan semu dari klik ulang. |
| RR5-08 — finalisasi terputus | Item/job delivered tetapi order queued; enam cron sehat tidak memperbaiki status. | Finalisasi order/job atomik; cron juga menyapu split historis job delivered/order tertinggal. Fault pada UPDATE order diikuti lease kedaluwarsa dan DB sehat pulih menjadi konsisten, satu pengiriman. | Dashboard kembali mengikuti barang yang sudah terkirim setelah gangguan penyimpanan pulih. |

## Bukti otomatis dan reproduksi terpisah

- Baseline: **501 test, 43 file**. Hasil akhir: **527/527, 44 file**. File baru `tests/rr5-remediation.integration.test.ts` memuat **26 test**. Enam belas test awal mereproduksi bug sebelum implementasi (16 gagal + 501 lulus); pengetatan berikutnya juga menemukan masalah pengiriman sebelum validasi qty dan materialisasi saat auto-delivery dimatikan, lalu diperbaiki. Skenario enam orphan saat auto-delivery mati membuktikan job yang sudah memiliki semua baris tidak menahan materialisasi job berikutnya.
- Fixture menjalankan handler/modul TypeScript aplikasi aktual dengan SQLite `:memory:`, batch atomik, autentikasi dummy dari modul aplikasi, mock provider dan jaringan luar diblokir. Fault dan pause dipasang pada operasi database sebenarnya. Seeding/observasi berada di luar hitungan query invocation.
- Test budget memakai batas adapter 50, mengecek invocation maksimal 40, serta kesesuaian counter normal dengan query adapter. Test terpisah membuktikan dua binding tidak tercampur, oversized batch ditolak seluruhnya sebelum mutasi, dan dua statement checkpoint tidak dapat dihabiskan helper.
- `query_budget_used` menghitung **statement yang diajukan**, termasuk seluruh anggota batch. Bila batch gagal di anggota awal, counter tetap membebankan semua anggotanya: ini konservatif, bukan klaim jumlah statement yang benar-benar sempat dieksekusi mesin SQLite.
- Reproduksi terpisah memakai loader/adapter dari review sebelumnya, bukan hanya fixture test repository. Dua orphan masing-masing 20 baris: shared 1 produk **21 invocation, maksimum 31 query**; shared 20 produk **21 invocation, maksimum 32**; manual 1 produk **20 invocation, maksimum 32**; manual 20 produk **21 invocation, maksimum 30**. Semua shared berakhir delivered dengan tepat 40 pengiriman sukses; manual berakhir manual_required dengan nol pengiriman.
- Percobaan platform/auth terpisah: batas LIKE D1 tidak lagi terpicu; handover tanpa autentikasi tetap 401, order belum lunas tetap 409 tanpa mutasi.
- Kegagalan nyata tetap dibatasi. Gangguan ambigu antara provider menerima pesan dan database mencatat hasil masih membutuhkan rekonsiliasi; perubahan ini tidak menjanjikan pengiriman tepat satu kali pada semua kemungkinan crash provider.

Pemulihan 40 item di atas sengaja dibatasi: 20–21 invocation setara sekitar **100–105 menit** bila hanya mengandalkan cron setiap lima menit, di luar waktu tunggu awal dan trafik lain. Angka ini adalah simulasi backlog besar, bukan waktu checkout normal. Menambah throughput antrean besar memerlukan pengukuran kapasitas dan keputusan scheduling/batching lanjutan; hasil ini tidak boleh dipakai untuk mengklaim siap promosi massal tanpa load test.

## Verifikasi build dan UI

- `npx tsc --noEmit --incremental false`: lulus. `npm run build:pages`: lulus, worker Pages + 363 aset dihasilkan. Ini build lokal; bukan konfirmasi hasil deployment.
- Dev GET `/`, CSS aktual dari HTML, dan `/admin?section=orders`: 200. Log dev tidak menunjukkan error kompilasi.
- Obscura CLI memuat home; Obscura CDP mengoperasikan komponen admin aktual melalui proxy localhost dengan SQLite terisolasi. GET/POST handover menjalankan handler aplikasi, token backend dibuat modul autentikasi; identitas UI dan daftar order memakai data dummy. Empat kondisi backend aktual: recovery sehat dan handover awal menghasilkan toast hijau/status delivered; fault storage serta qty kurang menghasilkan toast merah/status manual_required.
- Dua kontrol tambahan sengaja mengganti field respons menjadi HTTP 200 + manual_required/complete:false, setelah handler aktual berjalan. Keduanya menampilkan error pada cabang recovery dan cabang item pending. Kontrol kontrak sintetis ini menguji pertahanan UI; bukan bukti bahwa backend normal menghasilkan respons salah tersebut.
- Screenshot enam kondisi admin diperiksa. Ini bukan pengujian login/password penuh maupun pengiriman ke provider produksi.

## Artefak lokal

- Test: `/tmp/axvara-rr5-final-tests.log`; bukti red awal: `/tmp/axvara-rr5-red.log`.
- TypeScript: `/tmp/axvara-rr5-typecheck.log`; Pages: `/tmp/axvara-rr5-build-pages.log`.
- Probe: `/tmp/axvara-rr5-recovery-probes.cjs`, `/tmp/axvara-rr5-recovery-results.jsonl`, `/tmp/axvara-rr5-platform-results.jsonl`.
- UI: `/tmp/axvara-rr5-ui-evidence.json`, `/tmp/axvara-rr5-ui-{healthy,storage_failure,qty_short,pending_healthy,false_success,pending_false_success}-after.png`; home `/tmp/axvara-rr5-obscura-home.png`; HTTP `/tmp/axvara-rr5-dev-http.json`.
- Artefak `/tmp` dapat hilang setelah restart; test repository dan laporan ini menyimpan kontrak serta hasil utamanya. Artefak review lama dipertahankan, tidak ditimpa.

## Cakupan dan batas penerimaan

Delapan temuan telah mendapat perbaikan kode dan test yang menyasar penyebabnya. Regresi lama mengenai initializing, autentikasi/revokasi, invoice, notifikasi dan outbox tetap ada dalam suite penuh. Tidak dilakukan transaksi pelanggan, pengiriman pesan sungguhan, perubahan data produksi, atau deploy manual dalam verifikasi ini. Ini penerimaan perbaikan RR5 dan regresi terkait, bukan audit ulang seluruh dependency/CVE, pengujian semua perangkat, SLA provider, atau kelayakan komersial menyeluruh. Laporan round 4 diberi catatan koreksi agar klaim historis tidak dianggap status terkini.
