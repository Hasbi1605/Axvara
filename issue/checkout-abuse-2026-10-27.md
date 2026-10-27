# Insiden checkout fiktif 27 Oktober 2026

Owner meminta pemeriksaan sesi OpenCode ses_e844ed4deffeg9kD7AygE0pYoc,
perbaikan pembatas dan pembersihan order palsu dari panel. Sesi Muse dihentikan
owner sebelum takeover Codex. Tidak menjalankan order supplier/pembayaran nyata.

## Bukti dan koreksi

Pemeriksaan baca-saja produksi menemukan108 checkout web Market belum dibayar
dari04:27–05:06UTC dengan kontak uji dan pola nama S1–S15/A1–A30/P0–P39 serta
nama uji lain. Tidak menyimpulkan source IP dari pola nama. Nilai kontak mentah
berada hanya pada backup privat, tidak di laporan/git.

Draf awal telah mengarah benar dengan limiter D1 bersama, tetapi dua regresi
terbukti lewat fixture lokal terpisah sebelum perbaikan:

- Error INSERT limiter menghasilkan allowed:true dan nol counter tersimpan.
- Enam retry quote Market sama menghasilkan satu order, tiga slot untuk setiap
  subjek dan tiga respons429. Klaim “retry tidak dihitung” belum benar.

Regresi sekarang menguji fail-closed503, claim quote + increment atomik,
retry paralel enam request Market/Pedia, counter monoton lintas jendela,
normalisasi IPv6, HMAC berkunci, batas flood dan cleanup bounded. Kuota tetap
5/IP,3/WA,3/email per15menit; bukan jaminan tidak ada order palsu dari identitas
baru. Tidak menambah layanan anti-bot, environment, cron atau transaksi berbayar.

[Dokumentasi D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
menjadi rujukan rollback guard aplikasi. Jalur cleanup REST tidak diasumsikan
memiliki jaminan transaksi multi-statement yang sama.

## Pembersihan produksi

Backup lengkap108 order dan relasi serta baseline order lunas disimpan di
/Users/macbookair/.local/share/axvara/incident-backups/2026-10-27-fake-orders.json
(chmod600, di luar repository). Seleksi memakai daftar kode eksplisit yang
sudah diperiksa, bukan menghapus semua order pending atau semua kontak domain
tertentu. Hanya order terminal belum dibayar, tanpa bukti settlement/supplier/
fulfillment yang boleh dihapus. Pending dibiarkan melewati expiry existing agar
stok dipulihkan tepat sekali. Riwayat penerbitan invoice dipertahankan untuk
rekonsiliasi nominal dan pembayaran terlambat.

Hasil produksi:108 order dan108 baris payment_transactions expired/failed dihapus;
sisa kode kandidat nol. Seluruh840 order lunas baseline tetap memiliki kode,
subtotal dan paid_at yang identik. Sebanyak108 payment_invoice_history tetap ada.
Tidak ada supplier/job/fulfillment/inventory terikat pada kandidat saat pembersihan.

Pembersihan memakai trigger sementara BEFORE DELETE yang hanya berlaku untuk
108 kode eksplisit. Trigger menolak order pending/paid, invoice yang belum expired,
atau relasi terlindungi, lalu menghapus invoice anak dalam statement DELETE order
yang sama. Fixture SQLite membuktikan rollback parent+anak saat menemui paid,
supplier atau pending. Trigger dihapus dan ketiadaannya diverifikasi. Tidak
mengandalkan atomicity batch REST multi-statement. Metadata changes=216 mencakup
108 parent dan108 penghapusan anak oleh trigger; jumlah order diukur terpisah.

## Verifikasi akhir

- Seluruh3180 test /261 file hijau; npx tsc --noEmit dan build:pages exit0.
- Kedua reproduksi independen yang semula gagal sekarang lolos.
- Obscura checkout: halaman keranjang kosong normal, PNG diperiksa, overflowfalse;
  peringatan SVG/hydration renderer existing dicatat, bukan bukti serangan.
- Dev akhir: GET / dan /checkout200, CSS200; POST /api/orders body kosong dari Obscura ditolak400 sebelum mutasi. Tidak ada error kompilasi pada log dev.
- Rilis melalui push main; sesuai AGENTS tidak memantau CI/deployment setelah push.
  Hasil push bukan bukti pembatas sudah aktif di produksi.
