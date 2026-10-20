# Pedia — IndoSMM untuk penjualan baru, 20 Oktober 2026

Status: ✅ implementasi; publikasi melalui CI. Keputusan owner: IndoSMM menjadi satu-satunya supplier SMM untuk pembelian baru. Produk premium-tools supplier, termasuk seluruh kategori Canva, Gemini dan CapCut, dikecualikan dari rilis Pedia. Spesifikasi ini menggantikan kebijakan dua supplier aktif pada dokumen 19 Oktober; UI konfigurator jumlah-sebelum-layanan tetap.

## Kebijakan penjualan dan riwayat

Katalog, pembanding harga, quote dan pembuatan order baru hanya menerima IndoSMM. Pemeriksaan server tidak bergantung pada tampilan admin atau status aktif baris lama. Quote ProviderSMM yang belum menciptakan order ditolak 409 `provider_retired` untuk memilih layanan lagi, sebelum debit, reservasi kredit, invoice atau penulisan order. Retry checkout yang sudah tersimpan dicari berdasarkan quote ID terlebih dahulu dan tetap mengembalikan order yang sama.

ProviderSMM tetap dikenal transport, dispatch, polling, refill dan recovery untuk menyelesaikan kewajiban lama. Tidak ada pemindahan supplier/order ID pada transaksi lama, penghapusan snapshot, failover ambigu, perubahan payment, env, cron, atau kontrak proxy. Pembacaan produksi saat persiapan menemukan dua item ProviderSMM, keduanya expired; implementasi tetap melindungi transaksi historis dengan status lain.

Admin memakai IndoSMM untuk kurasi baru; seed lama hanya membuat kerangka produk nonaktif tanpa menyalin ID ProviderSMM ke IndoSMM; mapping ProviderSMM tidak dapat dibuat/diaktifkan kembali untuk penjualan. Riwayat dan penonaktifan tetap tersedia. Kandidat baru adalah hasil filter kontrak, bukan skor mutu atau bukti AI supplier. API publik tidak mendokumentasikan endpoint skor AI/monitoring dashboard; rilis ini tidak mengimpor skor tersebut atau membuat mass-order.

## Katalog dan migrasi

Manifest `src/lib/pedia/curation-20261020.json`: **53 kebutuhan baru**, **7 kebutuhan pengganti**, **61 mapping IndoSMM**, **18 platform tambahan** (registri menjadi 34 platform). Bersama manifest terdahulu tersedia kapasitas 108 definisi kebutuhan, dengan dua kebutuhan lama dihentikan karena belum ada padanan yang layak: Quote Threads dan Share Video Facebook. Ini bukan klaim jumlah yang sedang aktif di produksi.

Platform tambahan: Roblox, WhatsApp Channel, Lazada, SnackVideo, Kick, Vimeo, Tumblr, Reddit, Dribbble, Mixcloud, Audiomack, Medium, Rumble, CoinMarketCap, Rutube, Tidal, Coub dan ReverbNation. Platform lama diperluas dengan kunjungan profil/likes Story Instagram, likes halaman/members grup Facebook, share YouTube, pendengar bulanan/plays playlist Spotify, koneksi/tayangan/repost/reactions LinkedIn, followers profil Pinterest, repost SoundCloud dan likes produk Shopee.

Migrasi baru **0073_pedia_indosmm_only_catalog.sql**, dihasilkan oleh `scripts/generate-pedia-indosmm-20261020.mjs`:

- Menonaktifkan tier ProviderSMM yang masih aktif dengan alasan warisan; tidak menghapus baris atau mengubah supplier/service ID.
- Menambahkan produk baru tanpa menimpa konflik slug owner, termasuk draf. Pengganti hanya dihubungkan ke slug dengan platform/metrik/jenis target yang sesuai. Produk owner yang nonaktif tetap nonaktif.
- Membuat tier IndoSMM baru; tidak mengganti ID tier lama atau menulis ulang tier IndoSMM existing. Duplicate mapping owner dilewati, harga/copy/status drafnya dipertahankan.
- Aktivasi memakai mirror present, tipe Default, rate positif, irisan min/maks serta paket/kelipatan sah. Harga berasal dari rate mirror saat migrasi, markup G3 20% dan minimum profit Rp1.000 dengan pembulatan existing; tidak menyalin harga marketing supplier sebagai harga jual.
- Semua penawaran baru eksplisit tanpa refill AXVARA; tidak mewarisi janji pada judul supplier yang belum divalidasi. Order/quote lama mempertahankan ketentuan snapshot-nya.
- Tier migrasi dimasukkan nonaktif dengan penanda pending, baru diaktifkan sesudah harga tersimpan. Provenance staging dipertahankan untuk pemulihan proses parsial; retry tidak menganggap tier migrasi yang belum selesai sebagai draf owner. Dua kebutuhan pensiun dinonaktifkan pada produk bila tidak memiliki tier IndoSMM aktif.
- Copy produk Story lama yang belum diedit diganti menjadi netral terhadap cakupan story supplier pengganti; copy owner yang berbeda tetap dipertahankan.

Katalog API akun dibaca 20 Oktober: 4.395 layanan, currency IDR, saldo Rp0. Angka dashboard 9.685 tidak dianggap jumlah layanan API aktif. Deskripsi publik dibaca melalui `/services/get-service-description/{id}`. Beberapa layanan mempunyai deskripsi kosong: evidence manifest membedakan target yang dijelaskan deskripsi dan target yang jelas dari nama layanan Default. Ini pembacaan kontrak katalog, belum membuktikan pengiriman/drop. Nama ambigu atau layanan dengan input lain tidak dipaksakan.

Contoh: Story #9304 memerlukan username, diturunkan dari link profil; Lazada #9413 membatasi maksimum 500 dari deskripsi walau API 1.000; Audiomack #2134 wajib kelipatan 1.000. Followers playlist Spotify memakai #3758 yang menjelaskan playlist, bukan #2163/#1390 dengan contoh lagu/artis. Share Facebook yang deskripsinya membatasi postingan feed tidak dijual sebagai share video; kecocokan target pada UI dan quote server menolak Reel/video untuk kebutuhan Share Post Facebook. Layanan Quote Threads tidak diganti dengan repost yang berbeda fungsi.

## Input, ikon dan pengalaman beli

Parser memakai host dan rute spesifik, bukan menerima semua URL sebagai profil. Link profil/post/channel/playlist/lagu/album/story/grup dibedakan. Contoh produk pada formulir sesuai jenis target; wrong host, halaman navigasi, jenis target lain dan format tidak lengkap ditolak. Link pendek yang memerlukan resolusi tidak dibuka otomatis. Likes produk Shopee meminta link produk lengkap; username Story dikirim melalui adapter existing. Threads `/share/<id>` didukung. Halaman Facebook `/people/<nama>/<id>/` mempertahankan ID halaman. Formulir meminta format seperti contoh; Reddit `redd.it` perlu diganti URL postingan kanonis, bukan diteruskan dengan asumsi supplier dapat membukanya.

Logo platform memakai Simple Icons CC0 yang tersedia. Lazada, SnackVideo, Rutube dan Coub memakai monogram teks AXVARA berwarna, bukan tiruan logo resmi. Filter grup/pencarian dan tiga penawaran awal tetap; penambahan platform tidak menyalin dashboard supplier ke pembeli.

## Verifikasi dan batas

Hasil suite, type-check, build Pages dan dev/Obscura aktual dicatat pada CHANGELOG dan catatan kesiapan rilis. Pengujian tidak membuat order supplier berbayar, tidak top-up, dan tidak menyimpulkan kualitas dari judul atau statistik supplier. Saldo uji berikutnya diarahkan ke IndoSMM setelah target dan sampel disepakati; rekomendasi top-up ProviderSMM pada dokumen 19 Oktober kini historis.
