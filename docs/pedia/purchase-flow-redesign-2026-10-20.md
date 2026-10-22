# Redesain pembelian Pedia — 20 Oktober 2026

## Penyederhanaan pilihan layanan Pedia — 22 Oktober 2026

✅ Implementasi; publikasi melalui CI. Koreksi owner22 Oktober: judul “Apa yang ingin ditingkatkan?” kembali ke ukuran24px/bold semula tanpa garis cyan. Yang diperkecil adalah pill kebutuhan Followers/Likes/dll: tinggi32px, teks12px, ikon13px dan padding12px; permukaan gradasi halus dengan highlight inset, pilihan aktif cyan/violet dan glow tipis. Gulir horizontal serta fokus keyboard tetap, scrollbar visual disembunyikan. Label tombol jumlah memakai `k` kecil untuk ribuan (`1k`, `2k`, `2.5k`); angka di bawah 1.000 tetap utuh, nilai input/perhitungan serta teks batas dan harga memakai angka aslinya. Pengantar panjang jumlah dihapus; batas tampil sesuai min/max layanan terpilih (“Layanan terpilih menerima 100–50.000 per pesanan.”), termasuk kelipatan bila perlu; sebelum memilih layanan ada petunjuk singkat tanpa angka asumsi. “Pilih layanan · harga untuk …” berada di kiri dan filter ringkas di kanan saat muat, bertumpuk pada mobile. Kategori **Semua/Global/Indonesia/Refill** memakai satu state eksklusif: tepat satu pill aktif, klik pill aktif mempertahankannya; Refill berarti semua wilayah dengan refill>0. Pemilihan kategori tidak mengganti layanan atau jumlah. Hitungan hasil, Reset filter dan pengaturan jenis akun/urutan berada sesudah daftar. Beranda, data katalog, validasi batas, quote/consent/retry dan pembayaran tetap.


✅ Diimplementasikan; publikasi melalui CI push main. Acuan: folder owner
**Redesign SMM Panel Purchase Flow** (`Order.tsx`, `Pay.tsx`, `index.css`).
Dokumen ini menggantikan bagian UI konfigurator/checkout/status pada spesifikasi
15, 16, dan 19 Oktober. Kebijakan katalog IndoSMM 20 Oktober tetap berlaku.

## Batas perubahan yang dipilih owner

Beranda, hero, orbit/tali, promo, katalog platform, pencarian, navbar dan footer
existing dipertahankan. **Jalan pintas tidak diterapkan.** Redesain dimulai setelah
pembeli mengklik layanan/platform, melalui `/pedia/p/[platform]` atau deep link
`/pedia/o/[slug]`, lalu halaman `/pedia/pesanan/[code]`.

## Langkah pembelian

1. **Layanan:** halaman platform langsung membuka kebutuhan pertama yang tersedia;
   deep link tetap membuka produk sesuai slug. Tab berikon memilih kebutuhan di
   dalam panel. Jumlah tetap diisi pembeli, lalu layanan dibandingkan pada jumlah
   sama. Seluruh alternatif yang lolos filter tetap terlihat setelah dipilih,
   dengan radio, total tepat, wilayah, refill, estimasi dan copy kurasi. Batas
   min/max/kelipatan tetap berlaku; jumlah tidak diam-diam diubah untuk layanan
   lain. Filter kategori tunggal mengikuti revisi22 Oktober; jenis akun/urutan tetap tersedia di bawah daftar. Layanan dan jumlah
   tidak otomatis dipilih, mengikuti perilaku produksi untuk pilihan eksplisit.
2. **Target:** link dipisahkan dari pilihan layanan. Format dicek memakai parser
   client/server existing, tanpa klaim bahwa akun/konten telah diverifikasi.
   Checklist produk tersimpan tetap wajib masing-masing, dengan kotak pengantar
   persyaratan. Tidak mengganti checklist dengan aturan generik prototipe.
3. **Kontak:** WA dan email wajib; desktop dua kolom, mobile satu kolom. Tersedia
   kode kredit opsional, ringkasan, catatan drop/kredit, ketentuan dan persetujuan.
   Tombol Ubah pesanan dan indikator langkah mengizinkan kembali ke langkah
   sebelumnya; isian produk yang sama tetap tersimpan. Berpindah kebutuhan
   membuka konfigurasi baru untuk produk tersebut.
4. **Bayar:** quote dan order memakai kontrak existing; halaman status memakai QR,
   nominal dan deadline dari server. Tidak ada QR acak, pelunasan simulasi,
   penambahan kode unik lokal, reset countdown atau auto-complete dari prototipe.

Tahap hanya maju setelah validasi tahap itu lulus. Tahap mendatang tidak bisa
dilompati. Memilih langkah sebelumnya membatalkan quote yang sedang diperiksa;
pemesanan ambigu mengunci data dan navigasi langkah, lalu retry memakai token
serta kontak yang sama. Perubahan nominal/kode kredit tetap meminta consent
sebelum membuat order. Pemesanan disabled/maintenance dan preview admin tetap
aman; preview embedded tidak memanggil API harga/order atau mengumpulkan kontak.

## Tampilan

Container checkout 1280px, header identitas platform, indikator horizontal
**Layanan → Target → Kontak → Bayar**, panel kaca radius24/padding20–32px.
Desktop ≥1024px memakai kolom isi + ringkasan340px sticky; tombol lanjut berada
pada dasar panel isi. Mobile memakai total + CTA fixed dengan safe-area,
ruang bawah konten, dan ringkasan terlipat. Tab kebutuhan memakai cyan; layanan
aktif memakai latar violet gelap dan garis gradien cyan/violet agar teks tetap
terbaca. Font, aset platform dan token AXVARA existing digunakan kembali.

Halaman status maksimal1000px: detail/timeline kiri, panel pembayaran380px kanan
sticky di desktop; pembayaran di atas detail pada mobile. QR maksimal240px,
nominal30px, countdown monospace dari expiry server, Simpan QRIS dan Cek pembayaran.
Timeline vertikal: dibuat → pembayaran diterima → diproses → selesai, dengan
progres horizontal dari data server. Partial/canceled/needs_check, kredit,
ketentuan snapshot dan verifikasi refill tetap ditampilkan sesuai status aktual.
Pesan lagi tersedia pada status terminal dan mengarah ke produk asal bila ada.

## Kontrak dan verifikasi

Tidak ada API/env/migrasi/cron/proxy baru atau perubahan supplier, ledger,
reservasi, debit kredit, webhook, dispatch/refill, maupun expiry 15 menit.
Polling existing 10 detik menunggu pembayaran/60 detik proses dan penundaan
saat tab hidden tetap; cek manual memakai `wake=1`, dengan penjagaan request
bersamaan. Countdown menghilangkan QR saat deadline walau respons status belum
berubah. Error refresh mempertahankan invoice yang sudah tampil.

Test mencakup transisi, validasi per tahap, data saat kembali, consent berubah,
quote usang, klik ganda/retry ambigu, preview, maintenance, deadline QR, partial,
needs_check dan status selesai. Verifikasi Obscura memakai komponen/route aktual
dengan fixture lokal inert; tidak ada pembayaran atau order supplier nyata.
Batas renderer native input/radio/checkbox, filter SVG/fixed/sticky dan warning
hydration atribut xmlns SVG pada CLI existing dicatat
pada changelog; fixture visual memanggil handler input React untuk mengisi state,
sedangkan behavior test memverifikasi event pengguna. Tidak mengklaim hasil
pengiriman atau kualitas supplier dari verifikasi UI.
