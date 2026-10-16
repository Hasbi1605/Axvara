# Pedia: katalog dan checkout — 15 Oktober 2026

Status: implementasi di working tree, diverifikasi lokal sebelum publikasi lewat push/CI. Dokumen ini menggantikan spesifikasi katalog/checkout 12 Oktober yang dijelaskan sebagai snapshot historis di dokumen induk. Tidak ada order supplier berbayar untuk pengujian.

## Katalog publik

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi visual 2026-10-16 (implementasi; publikasi via CI):

- Judul “Pilih platform” langsung diikuti pill; teks “Buka platform, lalu pilih layanan yang kamu butuhkan.” dihapus. Pencarian tetap menampilkan keterangan query.
- Pill memakai ukuran dan gaya Market: tinggi 24px/teks 10px/ikon 10px di mobile, 36px/teks 14px/ikon 14px mulai `sm`. Aktif putih dengan teks/ikon gelap; nonaktif glass dengan teks/ikon putih. Ikon `IosIcon`: Semua/star, Media sosial/chat, Musik & streaming/star, Website & developer/globe, Marketplace/shopping-bag. Baris dapat digeser mendatar.
- Shopee masuk Marketplace. Kategori hanya terlihat jika platformnya tersedia; Semua tetap mencakup seluruh platform aktif.
- `PlatformCatalog` di beranda dan `/pedia/layanan` memakai logo SVG lokal 48px mobile/80px mulai `sm`, terpusat di panel 4:3 bergradasi `linear-gradient(135deg, <warna-brand>20, #0F1430)`, untuk seluruh 16 platform. Instagram/TikTok/YouTube/Facebook/Threads/X/Shopee/Spotify mengikuti GitHub/Website Traffic tanpa tile 3D Market. Tidak membutuhkan gambar baru atau unggahan R2. Field `image` legacy API dan `ProductCard` kompatibel tetap tersedia; katalog platform tidak menggunakannya.

- Skala hero: mobile `clamp(32px,9.3vw,40px)`, tablet 56px, laptop/desktop `clamp(48px,4.85vw,62px)`. Container 1280px dan padding hero atas 40/56px, bawah 16px mengikuti Market; orbit hanya desktop. Promo langsung setelah hero, katalog `pt-2`.
- Grid kartu platform: dua kolom mobile/tablet dan empat mulai 1024px, gap 12px mobile/20px mulai `sm`; radius kartu 16/22px. Judul 16/18px, deskripsi dan CTA 12/14px. Ikon terpusat di lapisan absolute agar panel mempertahankan rasio 4:3, termasuk di Obscura.

- Satu kartu per platform: 16 platform tersedia jika memiliki produk aktif dengan layanan layak. Beranda dan `/pedia/layanan` memakai `PlatformCatalog`. Revisi 2026-10-16: urutan beranda adalah hero → kartu AXVARA Market dan Bot Telegram → katalog platform, pada mobile maupun desktop. Hero mobile ringkas, orbit hanya desktop. Pencarian memahami pengikut/followers, tayangan/views, kunjungan/traffic, Indo/Indonesia, Twitter/X.
- `/pedia/p/[platform]` menyatukan pilihan jenis layanan dan checkout. `/pedia/o/[slug]` tetap membuka jenis tersebut. Pergantian jenis mengosongkan pilihan sebelumnya; setelah submit dimulai data dikunci agar retry melanjutkan quote/order yang sama.
- 38 jenis layanan dan 131 mapping publik terkurasi (130 pasangan supplier/ID unik; satu layanan LinkedIn mendukung profil/perusahaan). Manifest server-only `src/lib/pedia/curation-20261015.json`; tidak diimpor komponen client. Migrasi 0066 hanya mengaktifkan mapping dengan mirror live Default, tarif positif dan batas layak. Jumlah aktual dapat berkurang bila supplier berubah.
- 3 pilihan awal mobile / 5 desktop, tambahan lewat tombol; pilihan mobile yang dipilih dirangkum dengan tombol Ganti layanan; kategori ramai followers sekitar 9 pilihan. Filter wilayah, jenis akun, refill dan urutan harga. Platform kecil boleh memiliki 1–2 pilihan bila alternatif tidak cocok; tidak menambah duplikasi hanya untuk mencapai kuota.
- Platform: Instagram, TikTok, YouTube, Facebook, Threads, X, Telegram, LinkedIn, Pinterest, Discord, Shopee, Spotify, SoundCloud, Twitch, GitHub, Website Traffic. GitHub menyediakan followers profil/fork repository, tanpa mengarang stars. Website membedakan traffic umum dan referrer; bukan janji trafik organik, SEO atau konversi.

## Animasi desktop — revisi 16 Oktober 2026

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

## Dasar kurasi dan batas bukti

Katalog kedua API dibaca 15 Oktober: ProviderSMM 587 layanan dan IndoSMM 4.405 (snapshot berubah oleh diff), balance currency keduanya IDR. Deskripsi publik supplier ditinjau bersama nama, kategori, API refill dan batas jumlah. Harga dibandingkan pada jumlah yang sama; batas yang lebih ketat dari API/nama/deskripsi diterapkan. Grade akun adalah keterangan supplier, bukan hasil uji empiris AXVARA. Label drop/refill dipertahankan.

Dikeluarkan dari rilis: layanan non-Default/custom comments/subscriptions/live, layanan salah kategori, likes Fanspage yang tercampur likes postingan, tayangan Shorts yang bercampur video biasa, Shopee Singapura untuk target Indonesia, SoundCloud followers dengan deskripsi target lagu yang bertentangan, subscriber dengan peringatan drop hingga 100%, tayangan dengan peringatan drop hingga 100%, tayangan Native dengan pembatasan monetisasi, iklan minimum satu juta tayangan, dan LinkedIn dengan batas sekali-per-target yang belum didukung pencatatan kumulatif. ProviderSMM #988 hilang/nonaktif saat pemeriksaan mirror sehingga tidak dimasukkan. Alternatif yang nama/flag refill-nya bertentangan tidak diberi janji refill otomatis.

Perbedaan yang dipertahankan meliputi asal akun, bot/campuran, profil dengan foto/postingan (sesuai sumber), refill, minimum jumlah dan kecepatan. Followers perempuan Asia Timur/AS dan laki-laki Indonesia diberi nama khusus. YouTube menampilkan pilihan tayangan global mulai 100, Indonesia, dan sumber video yang disarankan. Iklan dengan minimum satu juta tayangan dikeluarkan agar tidak mengaburkan pilihan umum. Discord memerlukan bot/persiapan server sesuai panduan terpilih sebelum checkout. Ini bukan pengukuran kualitas/drop aktual; hasil supplier tetap perlu dipantau setelah pendanaan.

## Checkout dan harga

1. Pilih layanan dan jumlah, baca keterangan/S&K/cara membeli, isi link sesuai jenis target dan konfirmasi prasyarat. Target dinormalisasi oleh parser bersama client/server. Tidak ada pengambilan data akun dari platform.
2. Isi WA/email, Kode Kredit Pedia opsional, lalu konfirmasi ketentuan. Kembali mempertahankan input. Satu CTA yang terlihat: rail desktop atau bar total+CTA mobile; bottom-nav Pedia disembunyikan pada platform/order agar tidak bertabrakan.

`GET /api/pedia/prices?product_slug=...&quantity=...` memberikan total per layanan untuk jumlah persis memakai `computePediaPrice`, rate-limit 60/menit/isolate, no-store, tanpa modal/identitas supplier. Request dibatalkan saat input berubah. Harga tidak dihitung dengan perkalian tarif 1.000. Chip hanyalah contoh; jumlah bebas sah selama min/max/step gabungan terpenuhi. Layanan baru memakai default G3 20% dan minimum untung Rp1.000; pengaturan mapping existing dipertahankan. Minimum order default Rp1.000 dan pembulatan existing tetap berlaku.

Quote JWE 30 menit mengikat copy publik layanan, ketentuan refill, format target supplier dan total. Perubahan nominal meminta persetujuan baru. Deskripsi/S&K/panduan literal escaped, bukan HTML/Markdown. Snapshot disimpan dan ditampilkan pada status order; migrasi menyimpan copy/ketentuan lama sebelum mengubah katalog.

Order/job/debit kredit/ledger dibuat dalam satu batch D1. Penolakan duplikasi target, kredit yang telah terpakai atau kegagalan menyimpan job tidak mengurangi kredit. QR diterbitkan sesudah transaksi; kegagalan invoice dapat diulang dengan quote yang sama tanpa order/debit kedua. Kode tersimpan ditampilkan bila respons QR gagal. Full-credit langsung paid; partial-credit tetap dicatat di ledger. Pelunasan Pedia tidak menaikkan sold_count produk Market dengan ID numerik yang kebetulan sama. QR tidak diperpanjang otomatis setelah terminal.

Pesanan pending tampil menunggu bayar meskipun job berstatus queued. Masa order 15 menit juga disimpan bila invoice gagal. Cron Pedia mengembalikan reservasi kredit pesanan kedaluwarsa/dibatalkan dalam batch atomik, sekali saja, ke kode asal; target dapat dipesan lagi setelah pembersihan. Status kedaluwarsa tidak menampilkan progress seolah lunas.

## Kontrak dan pemeliharaan

Migrasi 0065 menambah copy/ketentuan/instruksi/alasan rekomendasi, override min/max, quantity_step, target_format (url/username), refill_anchor (created/completed), completed_at dan credit_return_token. `pediaBounds` menyatukan batas API+kurasi dan KPK step produk/layanan. Admin dapat mengedit copy dan ketentuan tersebut; preview memakai data tersimpan dengan field publik serta batas yang sama, tanpa API pesanan.

Supplier yang hanya menerima username mendapat username hasil normalisasi profil melalui quote/snapshot; pembeli tetap memakai link. Dispatch order lama tidak berubah saat mapping baru diedit. Refill dihitung dari anchor tersimpan; default order lama dari tanggal dibuat, layanan yang eksplisit sejak selesai memakai completed_at terminal pertama. ID/refill ambigu tetap needs_check dan tidak diulang otomatis.

Kontrak proxy, kredensial, gate IDR/unit dan jadwal diff tetap sesuai ARCHITECTURE §16.10. Tidak ada perubahan pada VPS atau key supplier. Endpoint produksi katalog serta validasi quote/order diperiksa; 400 dari payload kosong membuktikan gate menerima validasi tanpa membuat pesanan. Pemeriksaan mirror seluruh pasangan kurasi dilakukan sebelum push. Kehadiran secret Cloudflare bukan bukti nilai flag (nilai secret_text disamarkan API). Dispatch melalui cron existing, bukan flag PEDIA_DISPATCH_ENABLED yang tidak dibaca kode.

Verifikasi rilis dan batas Obscura dicatat dalam `issue/pedia-ready-2026-10-15.md` serta CHANGELOG. Publikasi hanya GitHub Actions, berhenti setelah push diterima; jangan mengklaim deployment berhasil tanpa bukti.

## Daftar jenis dan jumlah kurasi

| Platform | Jenis layanan | Pilihan |
|---|---|---:|
| instagram | Followers Instagram | 9 |
| instagram | Likes Instagram | 5 |
| instagram | Tayangan Reels Instagram | 4 |
| instagram | Saves Instagram | 3 |
| instagram | Share Instagram | 4 |
| tiktok | Followers TikTok | 9 |
| tiktok | Likes TikTok | 5 |
| tiktok | Tayangan TikTok | 5 |
| tiktok | Share TikTok | 4 |
| tiktok | Saves TikTok | 4 |
| youtube | Tayangan YouTube | 3 |
| youtube | Likes YouTube | 4 |
| youtube | Subscriber YouTube | 3 |
| facebook | Followers Facebook | 5 |
| facebook | Tayangan Facebook | 2 |
| facebook | Likes Facebook | 3 |
| threads | Followers Threads | 5 |
| threads | Likes Threads | 5 |
| x | Followers X | 5 |
| x | Likes X | 5 |
| x | Tayangan X | 3 |
| telegram | Members Telegram | 4 |
| telegram | Tayangan Telegram | 2 |
| telegram | Reactions Telegram | 2 |
| linkedin | Followers LinkedIn | 1 |
| linkedin | Followers Perusahaan LinkedIn | 1 |
| linkedin | Likes LinkedIn | 3 |
| pinterest | Followers Board Pinterest | 1 |
| pinterest | Likes Pinterest | 1 |
| shopee | Followers Shopee | 3 |
| spotify | Plays Spotify | 3 |
| soundcloud | Plays SoundCloud | 2 |
| soundcloud | Likes SoundCloud | 1 |
| twitch | Followers Twitch | 3 |
| github | Followers GitHub | 1 |
| github | Fork Repository GitHub | 1 |
| website | Website Traffic | 5 |
| discord | Members Discord | 2 |
