# Kredensial unik beberapa unit — 23 Oktober 2026

✅ Implementasi; publikasi melalui CI. Batas awal total10 akun stok unik per
order web/Telegram, mengikuti stok efektif. WhatsApp existing tetap satu unit;
kill-switch DM dan alur manual tidak berubah. Tidak ada perubahan kontrak
VPS atau migrasi schema.

## Reservasi dan kontrak penyimpanan

Quote dan ringkasan tetap satu baris `Muse ×3` dengan satu invoice. Web membaca
mode varian lalu memagari mode yang sama dalam batch stok; channel atomik
juga memagari product/mode. `UPDATE inventory ... id IN (SELECT ... LIMIT qty)`
memilih unit khusus varian dahulu, lalu legacy NULL, menurut sort_order/id.
Verifikasi sesudah klaim menuntut total qty unik, bukan jumlah varian.
Kekurangan satu unit menggagalkan seluruh batch order/stok/inventory.

Server menambahkan `unique_units:true` dan `fulfillment_mode:'unique'` ke
baris order baru. Client tidak mengendalikan penanda ini. JSON shopping
`qty` tetap3. Pembatalan/expiry memakai qty asli dan melepaskan seluruh
inventory reserved milik order sekali; tidak mengubah unit delivered.

`src/lib/fulfillment/units.ts` adalah pemetaan manifest tunggal. Unit pertama
mempertahankan index baris asli, unit tambahan ditaruh setelah semua baris
asli. Contoh order `[unique×3, supplier×2]` menghasilkan fulfillment:

| item_index | Isi | qty |
|---|---|---:|
| 0 | Unique akun1/3 | 1 |
| 1 | Baris supplier asli | 2 |
| 2 | Unique akun2/3 | 1 |
| 3 | Unique akun3/3 | 1 |

Dengan demikian index link WR/SK dan baris manual tidak bergeser. Setiap unit
memakai fulfillment_items existing dengan inventory_id, lease, cursor, retry,
delivered ciphertext dan ledger email sendiri. Retry unit gagal mempertahankan
ikatan; unit delivered dilewati. Proses immediate multi-unit memeriksa budget
waktu40 detik sebelum unit berikutnya agar yield sebelum lease job60 detik;
cadangan setiap menit melanjutkan. Hasil ambigu pengiriman eksternal masih
membutuhkan rekonsiliasi; ini bukan jaminan exactly-once lintas jaringan.

## Tampilan dan kompatibilitas

Label pengiriman/panel `Akun N dari M`, tombol salin per akun, dan panduan
identik sekali. Email web per unit memakai satu baris akun dan ringkasan
belanja asli sebagai tanda terima. Kredensial tetap hanya dapat diambil
sesudah verifikasi WA/email atau capability token. GET orders menambah
`unique_units_progress:{ready,total}` untuk order baru dengan beberapa akun;
readiness dihitung dari snapshot delivered, bukan jumlah stok tersedia.
Halaman tetap polling sampai semua unit siap; panel mengambil isi baru dengan
token saat ready bertambah tanpa auto-scroll berulang. Snapshot lama tanpa
penanda tidak dipecah atau ditulis ulang. Resolver S&K memakai pemetaan index
yang sama, termasuk unit tambahan.

Telegram quantity/ForceReply/cart mendukung beberapa unit dan varian unik,
maksimal10 gabungan; server checkout tetap penjamin ketika state cart balapan.
UI web/mobile memantulkan cap dan cart lama tetap divalidasi quote/server.
Tidak mengubah unit/mode supplier, minimum pesanan shared/manual, retry quote,
nominal QRIS, snapshot order historis atau flag pembayaran.

## Verifikasi dan rollback

Fixture menguji jumlah3 dan batas10, stok terakhir yang diperebutkan, kekurangan inventory
dengan kolom stok berlebih, cap11/gabungan, FIFO/prioritas, cancel/expiry sekali,
unit ketiga gagal tanpa mengulang dua unit delivered, serta satu checkout
Telegram idempoten. Sepuluh unit juga diselesaikan lewat beberapa invocation
cron dengan budget96, tanpa pengiriman duplikat. Respons verifikasi kontak
yang terlambat tetap menyusul progres unit terbaru. Tidak membeli produk supplier atau mengubah inventory
produksi. Hasil suite/dev/Obscura/build dicatat di CHANGELOG sesudah pemeriksaan.

Rollback penuh ke kode sebelum dukungan ini harus menunggu semua order
`unique_units` selesai, atau mempertahankan pembaca manifest baru. Pembaca lama
tidak memahami tambahan unit; jangan menghapus baris fulfillment/inventory
untuk memaksa rollback. Mengembalikan UI/cadence saja tidak mengubah data lama.

## Pemeriksaan tampilan lokal

Obscura CDP memuat komponen aktual melalui fixture sementara inert, desktop1440
dan mobile390px: akun2→3, salin isi akun2, satu panduan bersama sesudah akun
terakhir, dan stepper10 dengan tombol tambah nonaktif. Tidak ada overflow
horizontal/exception JS. Screenshot panel dan transisi diperiksa. Renderer
Obscura masih memperlihatkan keterbatasan paint backdrop/fixed bottom-sheet
existing; DOM dialog390×844 dan nilai/batas stepper terverifikasi. Fixture
dihapus sebelum build Pages, tidak ada data uji yang dipublikasikan.
