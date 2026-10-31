# UX pembelian Pedia, 27 Oktober 2026

✅ Diimplementasikan. Publikasi melalui CI push main; dokumen ini tidak menyatakan
deployment sudah berhasil. Menggantikan bagian konfigurator20–22Oktober; status
pesanan, beranda, katalog supplier, pembayaran dan kebijakan24Oktober tetap.

## Arah yang disetujui

Owner meminta audit antislop desktop/mobile, menyukai logo/siluet Instagram,
serta menolak baris layanan berulang, pilihan ungu besar, detail jauh dan
accordion “Lanjutan”. Setelah audit, owner meminta implementasi rekomendasi.
Design Read: formulir perbandingan layanan untuk pembeli Pedia, identitas Midnight
AXVARA dengan aksen platform dan cyan. ENERGY2 / RHYTHM2 / MOTION1.

Logo header/ringkasan dipertahankan sebagai penanda platform. Cyan menandai
pilihan, fokus dan aksi utama; warna emas hanya memakai rekomendasi kurasi yang
sudah ada. Tidak ada aset baru, badge popularitas, hasil sampling atau klaim mutu.

## Susunan dan interaksi

1. Kebutuhan berada di atas grid selebar konten. Pill memakai ikon metrik existing,
   teks13px dan area sentuh44px. Desktop membungkus ke baris berikutnya; mobile
   dapat digulir, scrollbar tidak disembunyikan, dan “Semua kebutuhan” membuka
   seluruh pilihan. Pilihan aktif digulir masuk tampilan dan menerima fokus saat
   pindah kebutuhan, tanpa memaksa perpindahan gulir vertikal.
2. Jumlah tetap mendahului layanan. Input kosong tidak otomatis diisi. Preset
   hanya mengambil jumlah valid dari katalog; batas dan kelipatan tetap divalidasi.
3. Filter dan sort berada sebelum hasil. Wilayah muncul jika ada lebih dari satu
   wilayah; Refill hanya jika ada layanan dengan dan tanpa refill. Jenis akun
   tersedia jika lebih dari enam layanan dan lebih dari satu jenis. Sort harga
   memerlukan jumlah; hanya harga tepat pada jumlah yang sama dibandingkan.
4. Baris satu kolom berisi nama, harga, wilayah, refill dan estimasi mulai.
   Akhiran persis “· Refill N hari” di nama dipindahkan ke metadata, tanpa mengubah
   nama tersimpan atau menghapus pembeda lain. Harga acuan per1.000 hanya untuk
   layanan yang menerima1.000; minimum diberi label tersendiri. Harga kosong tidak
   diganti harga minimum seolah-olah merupakan total jumlah yang diminta.
   Pembaruan31Oktober (lokal untuk publikasi CI): kegagalan GET harga diumumkan
   lewat live status polite dengan tombol44px “Coba muat harga lagi”. Retry
   mempertahankan jumlah/layanan/draf, abort respons lama dan tetap debounce300ms;
   tidak membuat quote/order atau melewati consent harga sebelum pembayaran.
5. Radio native tetap eksplisit. Pilihan aktif memakai border cyan1px,
   latar#101E30 dan label “Dipilih”; memilih tidak menutup alternatif. Jika filter
   mengecualikan pilihan, pilihan ditampilkan di atas dengan penjelasan. Hitungan
   filter hanya menghitung layanan yang cocok; filter tidak mengubah pesanan.
6. Deskripsi layanan/rekomendasi kurasi, fakta utama, total dan CTA berada dalam
   ringkasan. Pada mobile ringkasan tampil setelah daftar. Ketentuan terbuka di
   bawah area perbandingan, dan kembali terbuka sebelum persetujuan di Kontak.
   Panduan `instructions` berada pada tahap Target. Copy kurasi tidak ditafsirkan
   sebagai HTML; newline dipertahankan dan teks di-escape React.
7. Pada≥1280px, grid memakai daftar fleksibel + ringkasan340px. Sidebar hanya
   sticky jika tinggi aktual +120px muat dalam viewport; ResizeObserver dan resize
   mengukur ulang. Pada lebar lebih kecil, susunan satu kolom; CTA+total fixed
   dengan safe-area dan ruang bawah. Jika viewport≤480px tinggi, CTA masuk alur
   supaya tidak mengambil layar pendek. Preview embedded memakai CTA inline.

## Draf dan kontrak checkout

`PlatformPageClient` menyimpan draf dalam memori per slug. Menukar kebutuhan
menyimpan tier, jumlah, target, checklist, WA dan email sebelum remount. Restore
memerlukan slug/target kind yang sama. Parameter target awal hanya untuk produk
awal, bukan seluruh kebutuhan. Draf hilang ketika halaman ditinggalkan/reload.
Satu OrderClient aktif; tidak ada fetching tersembunyi per draf.

Quote, persetujuan dan status percobaan tidak tersimpan sebagai draf. Quote lama
dibatalkan saat unmount/perubahan data; tahap kembali ke Layanan dan validasi
server tetap otoritatif. Setelah order dicoba dan respons ambigu, navigasi terkunci
dan retry mempertahankan token/kontak yang sama, termasuk setelah expiry lokal.
Tidak ada perubahan API, ledger, invoice, snapshot lama, supplier, migrasi atau env.

## Ukuran, keterbacaan dan alasan visual

- Radius12px membedakan pilihan layanan dari header/ringkasan24px dan pill kebutuhan.
- Harga14px mobile/16px desktop memakai font body bold; total20px desktop memakai
  font-display existing. Harga dekat nama membuat dua atribut keputusan terbaca
  bersamaan. Metadata13px/leading20px menjaga baris tetap ringkas.
- Isi utama tidak dibungkus kartu glass besar lagi; garis pemisah mengelompokkan
  kebutuhan, jumlah/perbandingan dan syarat. Baris memakai permukaan ringan tanpa
  shadow; perbedaan tinggi mengikuti panjang nama, bukan tinggi paksa.
- Teks bantu utama65% putih, placeholder60%, radio45%, border input40%; fokus
  cyan2px/offset3px. Label/radio memberi tanda pilihan selain warna.
- Motion hanya transisi hover/fokus existing; tidak menambah animasi atau loop.

## Bukti

Lihat [laporan verifikasi](../../issue/pedia-purchase-ux-2026-10-27.md). Pengukuran
Obscura memakai komponen aktual dan snapshot katalog publik yang sama dengan
audit awal, tanpa request mutasi. Hasil fixture tidak membuktikan pembayaran
produksi, kualitas akun supplier, atau render perangkat fisik.

## Pembaruan visual 31 Oktober 2026 (lokal, belum dipublikasi)

Menyelaraskan bahasa visual dengan Market tanpa mengubah alur/kontrak: baris layanan
memakai `ax-glass-card ax-liquid` radius16px; terpilih = border cyan + glow + centang
terisi (teks "Dipilih" hanya untuk pembaca layar); badge "Pilihan AXVARA" dihapus 31 Oktober atas arahan owner; chip ikon
wilayah/refill/estimasi; harga20px. Nama layanan yang bentrok setelah akhiran refill
dilepas mempertahankan akhiran itu. Header platform satu baris dengan harga mulai;
pill kebutuhan menampilkan harga mulai. Ringkasan: tiga langkah sebelum pilihan,
total gradien28px sesudahnya. Ketentuan: tiga kartu fakta + callout drop. Animasi
masuk320ms mengikuti reduced-motion. Katalog/harga tidak berubah.

Revisi owner 31 Oktober (lokal): tanpa Urutkan/dropdown jenis akun; bar kategori segmented glass ringkas di kanan judul "Pilih layanan", tampil di semua produk dengan >1 layanan (kategori kosong dinonaktifkan); total ringkasan satu baris minimalis dengan tipografi harga kartu layanan; header platform tanpa harga mulai/pill keunggulan.

Pill (31 Oktober, lokal): kebutuhan dan kategori satu bahasa dengan pill Market — 32px mobile/36px desktop, tanpa wadah segmented; aktif = `.pedia-pill-active` (glass cyan), tidak aktif = `ax-glass-card`. Tinggi di bawah 32px sengaja dihindari demi target sentuh.

Halaman 2 / langkah Target (31 Oktober, lokal): "Detail layanan terpilih" hanya di langkah 1; checklist dan "Panduan layanan" memakai kartu glass `ax-glass-card` (judul 14px, isi 13px, padding 14px); kolom link/kontak `min-h-11`, 14px; checkbox memakai kotak kustom 20px (cyan saat dicentang, input asli `sr-only` + `peer`, outline fokus lewat `has-[:focus-visible]`); tombol kembali "Layanan" di langkah 2 dihapus, kembali lewat stepper atau "Pilih platform".

Status link langkah Target (31 Oktober, lokal): hanya format — "Format link sesuai" / "Format link tidak sesuai", tanpa klaim verifikasi akun (syarat akun publik ada di teks bantu dan checklist). Menggantikan teks "Format tautan dikenali; akun atau konten belum diverifikasi." pada langkah ini; hero tempel-link beranda belum diubah.

Halaman 3 / langkah Kontak (31 Oktober, lokal): tanpa rekap layanan/jumlah/link dan tanpa "Ubah pesanan" (ringkasan pesanan sudah memuatnya; kembali lewat stepper atau "Pilih platform"); keterangan "Tanpa membuat akun…" tepat di bawah judul; callout amber bergaya "Perlu diketahui"; ketentuan layanan + persetujuan dalam satu kartu `ax-glass-card` berbullet cyan.

Revisi 31 Oktober (lokal): callout "drop" dihapus dari langkah 1 dan 3 (menggantikan "callout drop" pada catatan Ketentuan di atas); langkah Kontak tanpa keterangan di bawah judul, dengan helper di bawah Nomor WhatsApp tentang kontak admin bila pengiriman layanan gagal. Syarat per layanan tetap tampil dari `tier.terms`.

Halaman 4 / status pesanan (31 Oktober, lokal): kartu QRIS selevel Market (kotak cyan, QR berstatus muat + retry, logo QRIS resmi, lencana "Menunggu bayar", total + kode unik bila >0, hitung mundur, baris pengecekan otomatis 5 detik); dua kolom + timeline Pedia dipertahankan; refill memakai cyan; deskripsi/syarat/panduan berupa kartu glass terbuka (tanpa accordion). Tombol "Minta QRIS baru" sengaja tidak ditambahkan (perlu dukungan API/aturan pembayaran).

Tombol kembali (31 Oktober, lokal): ikon "‹" 48px berstyle glass di kiri tombol utama, hanya langkah 2-3 (kartu ringkasan desktop, bar bawah mobile). Langkah 1 memakai "Pilih platform"; langkah 4 tanpa kembali karena pesanan/QRIS sudah dibuat. Setelah data terkunci tombol disembunyikan. Stepper selesai tetap bisa diklik. Gestur/tombol back browser tidak diubah (keluar dari alur; riwayat per-langkah sengaja belum dibuat).

Alur pesan mobile (31 Oktober, lokal; hanya di bawah xl, desktop tidak berubah): footer disembunyikan di `/pedia/p/*` dan `/pedia/o/*` (halaman status tetap berfooter); "Pilih platform" + banner platform menjadi satu baris; stepper menampilkan label langkah aktif saja. Kartu Ringkasan tidak tampil di mobile — bar bawah memuat "jumlah · layanan" dan tombol Total yang membuka bottom sheet rincian (dialog modal: fokus terkunci, Escape/Tutup/backdrop, scroll latar dikunci, fokus kembali ke pemicu). Daftar ketentuan hanya tampil sekali di mobile (langkah 3, tempat persetujuan); Panduan layanan dipotong dua baris pertama di mobile, data kurasi tidak diubah. Input 16px di mobile + `inputMode`/`enterKeyHint`/`autoComplete`. Kolom jumlah satu baris penuh dengan chip yang dapat digeser; kartu layanan berbentuk grid. Belum diuji di iPhone sungguhan.

Bar bawah mobile tertutup (31 Oktober, lokal): satu strip tombol "jumlah · layanan — Rincian ˄" membuka sheet rincian; di bawahnya harga (tanpa label) + tombol kembali + CTA; pegangan kecil di tepi atas bar. Label "Total pesanan" hanya ada di sheet. Di bawah 340px label CTA langkah 3 dipersingkat secara visual saja.

### Halaman status pesanan satu kolom (31 Oktober 2026, revisi ke-17)
- `/pedia/pesanan/[code]` memakai satu kartu `max-w-[760px]` seperti pembayaran Market, bukan dua panel. Menunggu bayar: QR di kiri dan nominal/hitung mundur/aksi di kanan pada layar lebar, menumpuk di mobile; accordion "Ringkasan" tertutup di bawahnya. Kedaluwarsa dan QRIS belum tersedia tetap pesan tunggal.
- Setelah dibayar: blok "Pembayaran diterima", produk + target, timeline progres, lalu accordion "Deskripsi layanan" dan "Syarat & ketentuan layanan" tertutup tepat di bawah detail pesanan, seperti Market setelah order dibayar. Panduan layanan tidak tampil di halaman ini; deskripsi/S&K tidak tampil sebelum bayar karena S&K sudah disetujui di langkah 3. Accordion yang teksnya kosong tidak dirender.
- Hanya presentasi. Kontrak API, polling 5/10 detik, QRIS same-origin, akses pembeli dan refill tidak berubah. Pengukuran dengan Chrome dan route pesanan mock, bukan perangkat nyata.
