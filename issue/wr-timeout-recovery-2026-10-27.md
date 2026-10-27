# WR timeout receipt, 27 Oktober 2026

## Insiden dan recovery produksi

- AXVARA `AXV-20261027-2664E813`, link36, item876, WR
  `RBHN-20261027-3C99F5`, Zoom Premium Pro14D Private, qty1, modalRp4000.
- Lunas06:21:59UTC, request06:22:10UTC, timeout06:22:22UTC. Link submitted,
  invoiceNULL, attempt1, item queued tanpa ciphertext. Screenshot owner menunjukkan
  invoice selesai13.22WIB dengan akun. Satu link untuk varian ini; tidak ada
  pemilik invoice lain. Tidak ada bukti webhook diterima atau ditolak pada insiden.
- Backup lengkap baris order/link/item dibuat privat chmod600, direktori700 di
  `/var/folders/bs/x8qyjdq510sbmbj6pmmvpd3w0000gn/T/opencode/wr-36-private/`.
  Tidak menyimpan kontak/kredensial di laporan atau git.
- UPDATE bersyarat hanya link36/snapshot/status/paid/bukti kirim/NOT EXISTS invoice
  lain, mengikat invoice owner tanpa memanggil /order. GET status existing memicu
  supplier-refresh upstream baca-saja lalu completion/delivery existing.
- Readback D1: completed_at `2026-10-27T07:36:12.737Z`, link completed,
  delivery_status delivered, wr_account_details tersedia, item876 delivered dengan
  delivered_ciphertext, orders.fulfillment_status delivered. Ini bukti pipeline
  aplikasi, bukan bukti pembeli sudah login akun atau membaca email.
- SSH VPS22 tidak tersedia dan secret Pages masked; recovery tidak membuka port,
  mengganti secret atau deploy layanan. Bukti owner + snapshot tersimpan dipakai
  untuk pilihan invoice; feed/API supplier dibaca oleh pipeline existing.

## Akar masalah dan keputusan

POST /order melewati timeout12detik setelah supplier menerima request. ID tidak
tersimpan; reconciler lama hanya memakai ID sedangkan fungsi missing-ID hanya
terjangkau dari pending/retry. Webhook handler mengembalikan false jika link tidak
ditemukan namun receiver tetap200. Retry pembelian memang dilarang dan tetap
dilarang.

Draft auto-match exact produk/qty/nominal/waktu, termasuk kalibrasi zona, dibuang
setelah review: transaksi manual lain bisa sama, dan tidak ada reference key
upstream. Dokumentasi resmi `/transactions` hanya50 terbaru, nama/type/durasi/
garansi/harga/qty tanpa variant_id, timestamp tanpa zona. Memilih satu kandidat
bukan bukti kepemilikan request. Final memakai invoice dipilih admin secara
eksplisit, validasi+CAS atomik, lalu completion existing. Kasus missing-ID baru
masih memerlukan admin; tidak menjanjikan pemulihan otomatis tanpa korelasi vendor.

## Perubahan

- Persist bukti kirim wajib berhasil sebelum POST; pagar late receipt/error dan
  terminal completion; no automatic repurchase.
- Sync-now admin body opsional1000byte `wr_order_id`, validasi feed exact-ID unik,
  satu produk, qty/price/total/paid, varian atau metadata mirror unik; CAS snapshot,
  local paid dan invoice belum dimiliki. Replay invoice sama aman, rebind ditolak.
- Form inline44px berlabel/fokus/disabled di SupplierLinkActions.
- Common known-ID reconcile satu fetch/batch, duplicate ID ditolak, budget
  path-specific; credential dispatch melalui antrean durable existing. Status
  buyer tetap running untuk missing-ID/claimed terkirim, tanpa memilih invoice.
- Semua webhook terminal unmatched503, retry existing; tanpa secret/env/migrasi/
  proxy/cron baru. Invoice di luar feed/metadata berubah tetap perlu owner.

## Verifikasi

Seluruh3297test/269file pass (`npx vitest run --run`), typecheck dan build:pages
exit0, diff-check bersih. Pengujian regresi memakai SQLite fixture dan supplier
mock tanpa pembelian tambahan, mencakup CAS/payment/metadata/ownership race,
stream oversized, replay, invoice hilang/duplikat, webhook retry terminal,
late response/error, anti-repurchase, dan route cron nyata dengan budget40.

Dev GET home/admin/CSS200, log final tanpa compile error. Obscura memuat admin
aktual (login, tidak mengklaim sesi produksi), dan fixture React dengan
SupplierLinkActions aktual/CSS Next pada390/1440px: input kosong disabled,
isi RBHN-FIXTURE lalu submit menghasilkan satu POST sync-now dengan invoice
persis, completed/form hilang, overflowfalse. Screenshot sebelum/sesudah
diperiksa. Interaksi memakai DOM input/change/submit melalui CDP Obscura karena
keterbatasan native input renderer; bukan bukti mouse/keyboard fisik atau sesi
admin produksi. Percobaan pertama sesudah build memakai cache dev bentrok,
restart dev menghilangkan404; hasil final clean. Warning lockfile/localStorage
Next/Vitest existing tetap, tanpa perubahan konfigurasi di luar scope.

Review independen final tidak menemukan blocker; review pertama menangkap
starvation budget dan auto-match yang tidak dapat membuktikan ownership, keduanya
diganti sebelum rilis.
