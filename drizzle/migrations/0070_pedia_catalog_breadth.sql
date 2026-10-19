-- Generated reviewed 2026-10-19 expansion: additive, no old order/snapshot changes.
-- Only current present/Default/rate-positive mirrors can activate new offers.
-- Slug conflicts (including owner drafts) are intentionally preserved.

CREATE TABLE pedia_expansion_products_20261019(slug TEXT PRIMARY KEY,platform TEXT,metric TEXT,target_kind TEXT,name TEXT,description_md TEXT,checklist_json TEXT,packages_json TEXT,sort_order INTEGER,is_new INTEGER);

CREATE TABLE pedia_expansion_services_20261019(product_slug TEXT,supplier TEXT,service_id INTEGER,public_name TEXT,description_md TEXT,terms_md TEXT,instructions_md TEXT,recommendation_note TEXT,region TEXT,quality TEXT,refill_days INTEGER,eta_start TEXT,speed_note TEXT,drop_risk TEXT,min_qty_override INTEGER,max_qty_override INTEGER,quantity_step INTEGER,sort_order INTEGER,is_recommended INTEGER,target_format TEXT,refill_anchor TEXT,PRIMARY KEY(product_slug,supplier,service_id));

INSERT INTO pedia_expansion_products_20261019 VALUES
('repost-instagram','instagram','reposts','post','Repost Instagram','Repost untuk postingan Instagram publik. Berbeda dari share melalui pesan pribadi.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',100,0),
('views-story-instagram','instagram','views','profile','Tayangan Story Instagram','Tayangan untuk sekitar 5–10 story pertama dari profil Instagram publik yang masih aktif.','[{"id":"public","label":"Akun saya publik dan memiliki story aktif."},{"id":"stable","label":"Saya tidak mengganti username atau menghapus story selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000]',101,0),
('repost-tiktok','tiktok','reposts','video','Repost TikTok','Repost untuk video TikTok publik; bukan share link atau jumlah tayangan.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000]',102,0),
('views-shorts-youtube','youtube','views','short','Tayangan Shorts YouTube','Tayangan untuk video YouTube Shorts. Gunakan link /shorts/, bukan video panjang.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[500,1000,2500,5000,10000,25000,50000,100000]',103,0),
('likes-shorts-youtube','youtube','likes','short','Likes Shorts YouTube','Likes untuk video YouTube Shorts publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',104,0),
('share-post-facebook','facebook','shares','post','Share Postingan Facebook','Share untuk postingan dan foto Facebook publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,250,500,1000,2500,5000,10000,25000,50000,100000]',105,0),
('share-video-facebook','facebook','shares','video','Share Video Facebook','Share untuk video Facebook publik; dipisahkan dari postingan/foto.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,250,500,1000,2500,5000,10000,25000,50000,100000]',106,0),
('repost-threads','threads','reposts','post','Repost Threads','Repost untuk postingan Threads publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',107,0),
('quote-threads','threads','quotes','post','Quote Threads','Quote untuk postingan Threads publik. Teks quote khusus tidak dapat diisi pada layanan ini.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',108,0),
('share-threads','threads','shares','post','Share Threads','Share untuk postingan Threads publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',109,0);

INSERT INTO pedia_expansion_products_20261019 VALUES
('repost-x','x','reposts','post','Repost X','Repost untuk postingan X/Twitter publik. Quote dengan komentar khusus tidak termasuk.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[20,50,100,250,500,1000,2500,5000]',110,0),
('bookmarks-x','x','saves','post','Bookmarks X','Bookmark untuk postingan X/Twitter publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,250,500,1000,2500,5000,10000]',111,0),
('followers-artist-spotify','spotify','followers','artist','Followers Artis Spotify','Followers untuk halaman artis Spotify. Tidak menambah monthly listeners atau stream lagu.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[500,1000,2500,5000,10000,25000,50000,100000]',112,0),
('followers-playlist-spotify','spotify','followers','playlist','Followers Playlist Spotify','Followers untuk playlist Spotify publik, terpisah dari followers artis.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,250,500,1000,2500,5000,10000,25000,50000,100000]',113,0),
('saves-spotify','spotify','saves','track','Saves Lagu Spotify','Saves untuk satu lagu Spotify; bukan pemutaran lagu.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,250,500,1000,2500,5000,10000,25000,50000,100000]',114,0),
('followers-soundcloud','soundcloud','followers','profile','Followers SoundCloud','Followers untuk profil SoundCloud publik, bukan link lagu.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[100,500,1000]',115,0),
('share-telegram','telegram','shares','post','Share Postingan Telegram','Share untuk satu postingan channel Telegram publik.','[{"id":"public","label":"Target saya dapat diakses publik."},{"id":"stable","label":"Saya tidak mengubah atau menghapus target selama proses."}]','[10,20,50,100,250,500,1000,2500,5000,10000,25000,50000,100000]',116,0);

INSERT INTO pedia_expansion_services_20261019 VALUES
('repost-instagram','providersmm',1012,'Repost Global · Tanpa refill','Repost untuk postingan Instagram publik. Berbeda dari share melalui pesan pribadi.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.instagram.com/p/ABCDE/
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',10,100000,1,0,1,'url','created'),
('repost-instagram','indosmm',8039,'Repost Global · Mulai 0–2 jam','Repost untuk postingan Instagram publik. Berbeda dari share melalui pesan pribadi.','Jumlah per pesanan 10–50.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.instagram.com/p/ABCDE/
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','global','standar',0,'0–2 jam','Mulai 0–2 jam','sedang',10,50000,1,1,0,'url','created'),
('views-story-instagram','providersmm',974,'Story · 5–10 story awal · Tanpa refill','Tayangan untuk sekitar 5–10 story pertama dari profil Instagram publik yang masih aktif.','Jumlah per pesanan 10–20.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Gunakan link profil; username akan dikirim ke supplier. Story setelah 5–10 story awal tidak tercakup.','1. Salin link target yang sesuai: https://www.instagram.com/username/
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',10,20000,1,0,1,'username','created'),
('repost-tiktok','indosmm',9295,'Repost Global · Tanpa refill','Repost untuk video TikTok publik; bukan share link atau jumlah tayangan.','Jumlah per pesanan 10–10.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.tiktok.com/@username/video/123456789
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'0–4 jam','Mulai 0–4 jam','sedang',10,10000,1,0,1,'url','created'),
('repost-tiktok','indosmm',9296,'Repost Indonesia · Tanpa refill','Repost untuk video TikTok publik; bukan share link atau jumlah tayangan.','Jumlah per pesanan 10–1.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.tiktok.com/@username/video/123456789
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','indonesia','standar',0,'0–4 jam','Mulai 0–4 jam','sedang',10,1000,1,1,0,'url','created'),
('views-shorts-youtube','indosmm',8767,'Shorts · Mulai 500 · Tanpa refill AXVARA','Tayangan untuk video YouTube Shorts. Gunakan link /shorts/, bukan video panjang.','Jumlah per pesanan 500–300.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Supplier menyebut lifetime, tetapi API refill belum tersedia. AXVARA menjual layanan ini tanpa janji refill.','1. Salin link target yang sesuai: https://www.youtube.com/shorts/abcdefghijk
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'0–4 jam','Mulai 0–4 jam','sedang',500,300000,1,0,1,'url','created'),
('likes-shorts-youtube','indosmm',1676,'Likes Shorts · Tanpa refill','Likes untuk video YouTube Shorts publik.','Jumlah per pesanan 10–200.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.youtube.com/shorts/abcdefghijk
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'0–1 jam','Mulai 0–1 jam','sedang',10,200000,1,0,1,'url','created'),
('share-post-facebook','providersmm',1007,'Share Postingan · Refill 30 hari','Share untuk postingan dan foto Facebook publik.','Jumlah per pesanan 100–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan dibuat, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Gunakan tautan postingan atau foto. Siaran langsung tidak termasuk.','1. Salin link target yang sesuai: https://www.facebook.com/username/posts/123456789/
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',30,'0–10 menit','Mulai 0–10 menit','sedang',100,100000,1,0,1,'url','created'),
('share-video-facebook','providersmm',1007,'Share Video · Refill 30 hari','Share untuk video Facebook publik; dipisahkan dari postingan/foto.','Jumlah per pesanan 100–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan dibuat, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Gunakan tautan video. Siaran langsung tidak termasuk.','1. Salin link target yang sesuai: https://www.facebook.com/username/videos/123456789/
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',30,'0–10 menit','Mulai 0–10 menit','sedang',100,100000,1,0,1,'url','created'),
('repost-threads','providersmm',748,'Repost Global · Tanpa refill','Repost untuk postingan Threads publik.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',10,100000,1,0,1,'url','created');

INSERT INTO pedia_expansion_services_20261019 VALUES
('repost-threads','providersmm',749,'Repost Global · Refill 30 hari','Repost untuk postingan Threads publik.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan selesai, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Refill dapat diminta maksimal sekali setiap 24 jam; tanpa refund karena drop.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','global','standar',30,'','','sedang',10,100000,1,1,0,'url','completed'),
('quote-threads','providersmm',750,'Quote Global · Tanpa refill','Quote untuk postingan Threads publik. Teks quote khusus tidak dapat diisi pada layanan ini.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',10,100000,1,0,1,'url','created'),
('quote-threads','providersmm',751,'Quote Global · Refill 30 hari','Quote untuk postingan Threads publik. Teks quote khusus tidak dapat diisi pada layanan ini.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan selesai, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Refill dapat diminta maksimal sekali setiap 24 jam; tanpa refund karena drop.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','global','standar',30,'','','sedang',10,100000,1,1,0,'url','completed'),
('share-threads','providersmm',752,'Share Global · Tanpa refill','Share untuk postingan Threads publik.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',10,100000,1,0,1,'url','created'),
('share-threads','providersmm',753,'Share Global · Refill 30 hari','Share untuk postingan Threads publik.','Jumlah per pesanan 10–100.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan selesai, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Refill dapat diminta maksimal sekali setiap 24 jam; tanpa refund karena drop.','1. Salin link target yang sesuai: https://www.threads.net/@username/post/ABCDE
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','global','standar',30,'','','sedang',10,100000,1,1,0,'url','completed'),
('repost-x','indosmm',9399,'Repost Global · Refill 30 hari','Repost untuk postingan X/Twitter publik. Quote dengan komentar khusus tidak termasuk.','Jumlah per pesanan 100–5.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Refill 30 hari sejak pesanan dibuat, sesuai ketentuan layanan. Drop dapat terjadi; refill bukan jaminan tidak turun.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://x.com/username/status/123456789
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',30,'0–1 jam','Mulai 0–1 jam','sedang',100,5000,1,0,1,'url','created'),
('repost-x','indosmm',2173,'Repost Global · Tanpa refill','Repost untuk postingan X/Twitter publik. Quote dengan komentar khusus tidak termasuk.','Jumlah per pesanan 20–5.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://x.com/username/status/123456789
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','','global','standar',0,'0–1 jam','Mulai 0–1 jam','sedang',20,5000,1,1,0,'url','created'),
('bookmarks-x','indosmm',9005,'Bookmarks Global · Tanpa refill','Bookmark untuk postingan X/Twitter publik.','Jumlah per pesanan 100–10.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://x.com/username/status/123456789
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'','','sedang',100,10000,1,0,1,'url','created'),
('followers-artist-spotify','indosmm',9123,'Followers Artis Global · Tanpa refill','Followers untuk halaman artis Spotify. Tidak menambah monthly listeners atau stream lagu.','Jumlah per pesanan 500–1.000.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Followers tidak menjamin pendengar aktif, royalti, posisi chart, atau hasil promosi.','1. Salin link target yang sesuai: https://open.spotify.com/artist/3ue1J3iN9SL3UetNZk6HHd
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'1–12 jam','Mulai 1–12 jam','sedang',500,1000000,1,0,1,'url','created'),
('followers-playlist-spotify','providersmm',265,'Followers Playlist Global · Tanpa refill AXVARA','Followers untuk playlist Spotify publik, terpisah dari followers artis.','Jumlah per pesanan 100–1.000.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Jangan membuat beberapa pesanan untuk playlist yang sama sekaligus. Tidak menjamin stream, royalti, atau posisi chart.
Supplier menyebut refill 365 hari, tetapi API refill belum tersedia. AXVARA tidak menjanjikan refill.','1. Salin link target yang sesuai: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'1–12 jam','Mulai 1–12 jam','sedang',100,1000000,1,0,1,'url','created');

INSERT INTO pedia_expansion_services_20261019 VALUES
('saves-spotify','providersmm',278,'Saves Lagu Global · Tanpa refill AXVARA','Saves untuk satu lagu Spotify; bukan pemutaran lagu.','Jumlah per pesanan 100–1.000.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Tidak menjamin stream, royalti, atau posisi chart. Gunakan link lagu, bukan album.
Supplier menyebut refill 30 hari, tetapi API refill belum tersedia. AXVARA tidak menjanjikan refill.','1. Salin link target yang sesuai: https://open.spotify.com/track/1HHZbk55T7qtPWPbw6Quv6x
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'1–12 jam','Mulai 1–12 jam','sedang',100,1000000,1,0,1,'url','created'),
('followers-soundcloud','indosmm',3334,'Followers Global · Kelipatan 100 · Tanpa refill AXVARA','Followers untuk profil SoundCloud publik, bukan link lagu.','Jumlah per pesanan 100–1.000.
Jumlah wajib kelipatan 100.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.
Supplier menyebut refill 60 hari, tetapi API refill belum tersedia. AXVARA tidak menjanjikan refill.','1. Salin link target yang sesuai: https://soundcloud.com/username
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'0–12 jam','Mulai 0–12 jam','sedang',100,1000,100,0,1,'url','created'),
('share-telegram','indosmm',8938,'Share Postingan · Tanpa refill','Share untuk satu postingan channel Telegram publik.','Jumlah per pesanan 10–1.000.000.
Jumlah dapat diisi sendiri dalam batas layanan.
Tanpa refill dari AXVARA; penurunan setelah pengiriman tidak mendapat refill atau pengembalian dana karena drop.
Jangan mengubah target atau membuatnya privat selama proses. Tunggu pesanan untuk target yang sama selesai sebelum memesan lagi.
Estimasi mulai bukan estimasi selesai dan dapat berubah mengikuti antrean.','1. Salin link target yang sesuai: https://t.me/channel_name/123
2. Masukkan jumlah, bandingkan layanan, lalu tempel link target.
3. Baca ketentuan dan konfirmasikan persyaratan tujuan.
4. Isi kontak, periksa total, lalu lanjutkan ke QRIS.
5. Pantau proses melalui halaman pesanan.','Pilihan awal dengan ketentuan dan batas jumlah yang ditinjau.','global','standar',0,'0–4 jam','Mulai 0–4 jam','sedang',10,1000000,1,0,1,'url','created');

UPDATE pedia_expansion_products_20261019 SET is_new=CASE WHEN EXISTS(SELECT 1 FROM pedia_products p WHERE p.slug=pedia_expansion_products_20261019.slug) THEN 0 ELSE 1 END;

INSERT OR IGNORE INTO pedia_products(slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,step,sort_order,is_active,is_featured)
 SELECT slug,platform,metric,target_kind,name,description_md,checklist_json,packages_json,1,sort_order,0,0 FROM pedia_expansion_products_20261019 WHERE is_new=1;

INSERT OR IGNORE INTO pedia_tiers(product_id,tier,label_note,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,eta_start,package_prices_json,is_active,public_name,description_md,terms_md,instructions_md,recommendation_note,region,quality,speed_note,drop_risk,is_recommended,sort_order,min_qty_override,max_qty_override,quantity_step,target_format,refill_anchor)
 SELECT p.id,'standar',c.public_name,c.supplier,c.service_id,'G3',20,1000,c.refill_days,c.eta_start,'{}',1,c.public_name,c.description_md,c.terms_md,c.instructions_md,c.recommendation_note,c.region,c.quality,c.speed_note,c.drop_risk,c.is_recommended,c.sort_order,c.min_qty_override,c.max_qty_override,c.quantity_step,c.target_format,c.refill_anchor
 FROM pedia_expansion_services_20261019 c JOIN pedia_expansion_products_20261019 r ON r.slug=c.product_slug AND r.is_new=1
 JOIN pedia_products p ON p.slug=c.product_slug JOIN pedia_supplier_services s ON s.supplier=c.supplier AND s.service_id=c.service_id
 WHERE s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0 AND s.min_qty>0 AND s.max_qty>=s.min_qty
 AND MIN(s.max_qty,c.max_qty_override)>=MAX(s.min_qty,c.min_qty_override)
 AND EXISTS(SELECT 1 FROM json_each(p.packages_json) j WHERE CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,c.min_qty_override) AND MIN(s.max_qty,c.max_qty_override) AND CAST(j.value AS INTEGER)%c.quantity_step=0)
 AND (c.refill_days=0 OR s.api_refill=1);

WITH quantities AS (
 SELECT t.id,CAST(j.value AS INTEGER) AS qty,s.rate_idr_per_1k AS rate,t.markup_pct AS markup,t.min_profit_rp AS min_profit
 FROM pedia_tiers t JOIN pedia_products p ON p.id=t.product_id JOIN pedia_expansion_products_20261019 r ON r.slug=p.slug AND r.is_new=1
 JOIN pedia_supplier_services s ON s.supplier=t.supplier AND s.service_id=t.supplier_service_id JOIN json_each(p.packages_json) j
 WHERE t.is_active=1 AND s.present=1 AND s.type='Default' AND s.rate_idr_per_1k>0
 AND CAST(j.value AS INTEGER) BETWEEN MAX(s.min_qty,t.min_qty_override) AND MIN(s.max_qty,t.max_qty_override) AND CAST(j.value AS INTEGER)%t.quantity_step=0
), raw AS (SELECT id,qty,MAX(qty*rate/1000.0*(1+markup/100.0),qty*rate/1000.0+min_profit) AS amount FROM quantities),
 stepped AS (SELECT id,qty,amount,CASE WHEN amount<10000 THEN 100 ELSE 500 END AS step FROM raw),
 prices AS (SELECT id,qty,MAX(1000,CAST(amount/step AS INTEGER)*step+CASE WHEN amount>CAST(amount/step AS INTEGER)*step THEN step ELSE 0 END) AS price FROM stepped)
 UPDATE pedia_tiers SET package_prices_json=COALESCE((SELECT json_group_object(CAST(qty AS TEXT),price) FROM prices WHERE prices.id=pedia_tiers.id),'{}'),
 rate_snapshot=(SELECT rate_idr_per_1k FROM pedia_supplier_services s WHERE s.supplier=pedia_tiers.supplier AND s.service_id=pedia_tiers.supplier_service_id)
 WHERE product_id IN (SELECT p.id FROM pedia_products p JOIN pedia_expansion_products_20261019 r ON r.slug=p.slug AND r.is_new=1);

UPDATE pedia_products SET is_active=CASE WHEN EXISTS(SELECT 1 FROM pedia_tiers t WHERE t.product_id=pedia_products.id AND t.is_active=1 AND t.package_prices_json<>'{}') THEN 1 ELSE 0 END
 WHERE slug IN (SELECT slug FROM pedia_expansion_products_20261019 WHERE is_new=1);

DROP TABLE pedia_expansion_services_20261019;
DROP TABLE pedia_expansion_products_20261019;
