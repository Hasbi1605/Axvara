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
