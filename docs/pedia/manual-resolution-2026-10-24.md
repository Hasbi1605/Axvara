# Pedia tanpa saldo pembeli — keputusan owner 24 Oktober 2026

✅ Diimplementasikan; publikasi melalui CI. Dokumen ini menggantikan ketentuan
kredit/refund/deposit pada spesifikasi Pedia sebelumnya, termasuk rencana fase 2.

## Pembelian dan kendala

- Pembeli membayar QRIS per order. Tidak ada wallet/deposit, penerbitan atau
  penebusan Kode Kredit Pedia, maupun refund otomatis di website.
- Supplier `partial`/`canceled` tetap dicatat sesuai status aslinya. Jumlah terkirim
  hanya dihitung dari `remains` integer 0..quantity; nilai kosong/tidak valid tetap
  tidak diketahui, bukan otomatis nol. Status pembayaran lunas tetap lunas.
- Terminal dan antrean `pedia_followups` disimpan dalam satu batch D1. Satu order
  mempunyai satu tindak lanjut. Pengulangan tidak menerbitkan kredit atau membuka
  lagi catatan yang sudah ditangani. Gangguan batch membatalkan kedua write.
- Halaman pesanan menawarkan Hub WA dengan kode order. Owner memeriksa dashboard
  supplier dan menyelesaikan dengan pembeli secara manual di luar AXVARA. Sistem
  tidak menganggap saldo supplier sudah kembali atau pelanggan sudah direfund.
- Admin melihat **Perlu tindak lanjut → Selesai ditangani**, dengan catatan wajib
  10–1.000 karakter, aktor sesi, dan waktu. Ini catatan operasional tanpa nominal
  saldo atau pemindahan dana. Status supplier/pembayaran tidak diganti oleh aksi ini.
- `needs_check` tetap ambigu; jangan submit/failover/membeli ulang. Recovery provider
  asal dan janji refill pada snapshot order lama tetap mengikuti kontrak existing.
  Pembatalan lokal hanya untuk order lunas yang belum pernah dicoba submit/tanpa ID.

## Transisi historis

Tabel `pedia_credits`, `pedia_credit_ledger` dan kolom kode lama dipertahankan sebagai
arsip, tidak dihapus atau dikosongkan. Admin mempunyai Arsip lama baca-saja; tidak
ada tombol penerbitan. POST admin kredit dan endpoint cek publik mengembalikan 410.
Fungsi issue/consume juga ditutup agar caller lama tidak dapat menulis saldo.

Retry quote yang **sudah mempunyai order** dicari lebih dahulu, mempertahankan
`subtotal-credit_used` yang tersimpan tanpa debit/invoice kedua. Quote berkredit yang
belum mempunyai order ditolak 409 sebelum mutasi; pelanggan mengambil harga baru.
Quote baru selalu payable=total, kredit nol. Input kredit pada client lama ditolak 410.

Checkout historis yang kedaluwarsa membalik reservasi sekali dalam arsip ledger
beku dan menambah tindak lanjut manual; hasilnya tidak bisa dibelanjakan. Tidak ada
kredit baru. Nilai/kewajiban historis diselesaikan owner di luar website, tanpa
menghapus bukti lama atau mengklaim penyelesaian otomatis. Migrasi 0075 mengantrekan
partial/canceled/kredit lama dengan sumber order yang valid tanpa siaran historis.

## Akses, notifikasi dan operasi

Status detail Pedia membutuhkan WA penuh/email checkout melalui header
`x-order-contact`, bukan kode order saja. Checkout/lacak menyimpan kontak pada
sessionStorage tab selama maksimal 24 jam; tautan lama meminta verifikasi ulang.
Kontak tidak ditambahkan ke URL. Respons private/no-store; kode refund lama tidak
pernah dikirim. Duplikasi target membalas generik tanpa kode order pembeli lain.

Polling status dibatasi 30/menit/IP/isolate; pemeriksaan manual 6/menit dan berbagi
klaim D1 KlikQRIS 10 detik/order dengan polling otomatis. Pemulihan initializing manual hanya GET order ID gateway yang sama; tidak ada
POST invoice ulang atau reservasi baru untuk hasil ambigu. Secret quote produksi wajib tersedia, tanpa fallback dev.

Cron Pedia existing menguras maksimal dua alert tindak lanjut per invocation bila
budget cukup. Claim durable dibuat sebelum kirim; hasil ambigu tidak diputar ulang. Penolakan
Telegram yang pasti (400/403/429) dapat diulang maksimal tiga percobaan dengan jeda
lima menit. Queue admin tetap tersedia meskipun pesan gagal. Email pembeli mengarahkan
ke penyelesaian manual dengan klaim kanal terpisah agar retry alert tidak menggandakan email. Tidak menjanjikan
exactly-once transport. Tidak ada cron/env/proxy baru, top-up, atau order supplier
berbayar untuk pengujian. Batas bayar 15 menit, lease, budget dan dedupe tetap.

## Verifikasi

Regresi mencakup otorisasi negatif, penolakan kredit baru, retry historis,
expiry sekali, rollback terminal+follow-up, unknown remains, penyelesaian admin
berpagar, serta status/refill lama. Bukti final pengujian dan Obscura dicatat pada
CHANGELOG; fixture bukan bukti settlement atau keadaan data produksi.

Indeks `idx_orders_telegram_pending_chat` pada migrasi0075 mempersempit guard/precheck ke chat terkait. EXPLAIN fixture berubah dari pencarian seluruh status pending menjadi pencarian chat+status+payment_status; ini bukti plan lokal, bukan angka penghematan produksi.
