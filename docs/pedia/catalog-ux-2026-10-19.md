# Pedia — katalog, kurasi, dan order 19 Oktober 2026

Kebijakan supplier dan katalog diperbarui oleh [rilis IndoSMM 20 Oktober](indosmm-only-2026-10-20.md); dokumen ini tetap menjelaskan konfigurator 19 Oktober.

Status: ✅ implementasi; publikasi melalui CI. Dokumen ini menggantikan konfigurator 16 Oktober pada spesifikasi 15 Oktober. Supplier tetap ProviderSMM/IndoSMM; tidak ada integrasi atau migrasi SMM Sekalipay. Tidak ada order supplier berbayar untuk verifikasi rilis ini.

## Loading dan order

Loading global mempertahankan logo AXVARA dengan ring cyan berputar di sekeliling logo yang tidak berputar, disk tengah dan pulse lembut mengikuti referensi ISTA AI. Reduced motion menghentikan ring/pulse. Navigasi instan tidak diberi jeda buatan; pemulihan Back/bfcache, pesan jaringan lambat dan retry tetap berlaku. Kerangka halaman tetap mengikuti konten tujuan.

Ikon kebutuhan mengikuti makna: followers/member, heart, play/eye, bookmark, share, repost, quote, fork, traffic. Ikon platform tetap identitas brand. Urutan order: platform → kebutuhan → jumlah → bandingkan/pilih layanan → link dan persyaratan → kontak/konfirmasi → QRIS. Tidak memilih layanan atau jumlah secara otomatis. Jumlah bisa diisi sebelum layanan dipilih. Semua total pembanding memakai jumlah yang sama; min/max/kelipatan yang tidak cocok dijelaskan dan tidak dipilih, tanpa mengubah jumlah diam-diam. Ganti layanan mempertahankan isian yang masih berlaku. Harga yang belum tersedia tidak digantikan total untuk jumlah lain.

Filter wilayah/refill mudah dijangkau, filter tambahan dan urutan tersedia dengan label yang jelas. Tiga pilihan awal tetap ringkas dengan aksi melihat alternatif. Alasan rekomendasi dan pembeda layanan terlihat sebelum memilih. Ringkasan, jumlah, link, dan syarat tidak mengulang blok kartu besar. Ketentuan drop/refill dan persyaratan khusus tetap terlihat; rincian panjang dapat dibuka. Validasi link memeriksa format/jenis target, bukan mengklaim akun sudah dicek publik secara langsung. Kontak tetap tahap kedua; consent perubahan nominal, quote, lock/retry dan preview admin tanpa API dipertahankan.

## Katalog yang diperluas

Manifest tambahan `src/lib/pedia/curation-20261019.json` memuat **17 kebutuhan / 23 mapping**; bersama manifest awal menjadi **55 kebutuhan / 154 mapping** pada 16 platform. Itu kapasitas kurasi, bukan jaminan semua mapping sedang tersedia di produksi. Migrasi 0070 hanya mengaktifkan mapping dengan mirror present, Default, rate positif, batas/kelipatan dan paket layak; refill positif juga wajib didukung API. Slug yang sudah dimiliki owner (termasuk draf) dilewati, bukan ditimpa. ID, copy, supplier, dan snapshot order lama tidak diubah.

Tambahan: Repost Instagram; Tayangan Story Instagram; Repost TikTok; Tayangan/Likes Shorts YouTube; Share Postingan/Video Facebook; Repost/Quote/Share Threads; Repost/Bookmarks X; Followers Artis/Playlist serta Saves Lagu Spotify; Followers SoundCloud; Share Postingan Telegram. Satu sampai tiga pilihan cukup bila perbedaan bermakna; tidak memaksakan jumlah varian.

Parser membedakan `short` YouTube (`/shorts/`) dari video panjang, serta `artist`, `playlist`, dan `track` Spotify (termasuk awalan locale `intl-id`/`intl-en-US` yang dinormalisasi). Layanan Shorts memerlukan link Shorts; layanan video lama tetap menerima Shorts seperti sebelumnya. Normalisasi Shorts mempertahankan `/shorts/` untuk supplier. Story Instagram memakai profil publik dengan story aktif dan adapter target username, mencakup sekitar 5–10 story pertama sesuai deskripsi. Share Facebook memakai layanan yang mendukung postingan/foto/video; live tidak ditambahkan. SoundCloud #3334 memakai profil dan kelipatan 100; alternatif yang meminta link lagu untuk followers dikeluarkan.

## Dasar bukti dan batasnya

Baca-saja API akun 19 Oktober: ProviderSMM **586** layanan, IndoSMM **4.393**, currency **IDR**, saldo keduanya **0**. Deskripsi ProviderSMM dibaca dari `https://providersmm.id/services`; deskripsi IndoSMM melalui tombol detail publik (`/services/get-service-description/{id}` dengan sesi publik). Tarif akun, nama, kategori, tipe, batas, dan API refill diperiksa; batas paling ketat dari API/deskripsi/nama dipakai. Tidak ada key, signature, cookie, atau secret di manifest/dokumen.

Contoh koreksi: IndoSMM #8039 min API 1 tetapi deskripsi 10/maks 50.000; #8767 min API 40 tetapi deskripsi 500; #9399 min API 10 tetapi deskripsi 100; #9123 min API 100 tetapi deskripsi 500; #3334 wajib kelipatan 100. Alternatif SoundCloud #5269/#8965 meminta lagu meski berlabel followers, sehingga tidak dipakai. Spotify #2163 berlabel playlist tetapi deskripsi memberi link lagu, sehingga tidak dipakai. GitHub stars tidak dikarang dari label “favorites”.

Refill yang hanya disebut supplier tanpa dukungan API tidak diwarisi sebagai janji AXVARA. Spotify #265/#278, Shorts #8767 dan SoundCloud #3334 dijual eksplisit **tanpa refill AXVARA**, dengan batas bukti pada ketentuan. Threads #749/#751/#753 dengan API refill menyimpan anchor selesai dan ketentuan sekali setiap 24 jam. Keterangan HQ/real, kecepatan, dan drop dari supplier bukan pengukuran kualitas oleh AXVARA.

## Kurasi admin

Tab **Kurasi** membandingkan kandidat kedua supplier untuk produk dan jumlah pilihan. GET authenticated `/api/admin/pedia/services?view=shortlist&product_id=<id>&quantity=<jumlah>` hanya membaca mirror, tanpa query supplier, saldo/debit, atau publikasi. Pencarian awal dibatasi 200 layanan termurah yang cocok (indikator serta pesan hasil kosong terbatas bila terpotong); hasil maksimal 20 dengan wakil wilayah/API refill sebelum varian serupa. Seleksi ini bukan peringkat mutu dan belum memeriksa semua deskripsi supplier.

Tipe non-Default, layanan tidak tersedia, angka/batas invalid, jumlah di luar batas, platform/metric tidak sesuai, custom input/live, dan target yang jelas berbeda disisihkan. Nama garansi yang tidak didukung API diberi peringatan. Owner membuka draf, meninjau/edit copy dan menyatakan telah memeriksa deskripsi, target serta batas/kelipatan. Simpan memakai POST tier existing dengan copy lengkap, selalu **nonaktif, tanpa refill, bukan rekomendasi**; lalu editor produk dibuka untuk peninjauan akhir batas/kelipatan, harga, syarat dan aktivasi. Tidak ada auto-approve, pemindahan mapping existing, atau order supplier.

## Uji hasil dengan saldo

Rencana awal ada di [Uji hasil dan anggaran](quality-sampling-2026-10-19.md). Uji UI, kontrak, serta migrasi tidak membutuhkan saldo supplier. Uji nyata diperlukan untuk menilai mulai/selesai, kesesuaian jumlah, proses parsial/refill, dan drop setelah selesai; satu sampel tidak membuktikan kestabilan jangka panjang. Pengujian berbayar belum dijalankan dan membutuhkan target milik owner yang sesuai.

## Verifikasi implementasi

Bukti pengujian, review Wonder, pemeriksaan Obscura, dan batas renderer dicatat pada [catatan rilis](../../issue/pedia-ready-2026-10-19.md). Hasil akhir suite/build ada pada entri paling atas CHANGELOG. Publikasi CI dan uji kualitas berbayar merupakan bukti terpisah.
