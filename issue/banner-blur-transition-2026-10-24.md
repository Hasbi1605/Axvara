# Transisi popup banner — 24 Oktober 2026

Implementasi: perpaduan opacity selama420ms dengan easing Apple, blur maksimum2px
dan geseran12px sesuai arah. Menggantikan slide masuk35% yang melepas konten lama.

- Gambar tujuan dipreload/decode; node DOM gambar lama dipertahankan berdasarkan key.
  Lapisan lama dekoratif/aria-hidden tanpa kontrol interaktif, bukan gambar salinan.
- Gambar tujuan tetap transparan sampai elemen aktual load (atau fallback error).
  CTA/hide ditahan selama tahap tersebut; tombol X tetap tersedia.
- Stage diukur dari tinggi konten lama ke konten baru melalui transisi tinggi CSS.
  Lapisan sementara dan tinggi eksplisit dibersihkan sesudah transisi.
- Versi navigasi menolak penyelesaian decode basi; input cepat digabung ke tujuan
  terakhir tanpa memotong animasi berjalan. Tutup/hide/route/unmount membatalkan
  pekerjaan tertunda. Reduced motion tanpa animasi/blur/autoplay.
- Tidak mengubah konfigurasi admin, frekuensi popup, hide24jam, endpoint atau dependensi.

Verifikasi unit: seluruh3053test/251file lulus; TypeScript dan build:pages lulus
(lint0error, warning existing). Dev home/CSS200; route aktual juga dimuat Obscura
dan PNG diperiksa. Regresi mencakup
identitas node gambar lama, preload/decode dan load DOM aktual, stale completion,
antrean klik cepat, tutup saat decode, gambar gagal, reduced motion dan aksesibilitas.

Obscura pada fixture inert dengan dua poster publik aktual: decode sengaja ditahan,
slide lama tetap utuh; setelah dilepas, sampel opacity meningkat sekitar0,33→0,65→1
dengan gambar tujuan complete. Lapisan lama dibersihkan, counter2/2, gambar full-width
448px/366px, jarak judul–deskripsi8px, tanpa overflow/kontrol playback/exception JS.
PNG sebelum/tengah/sesudah dan mobile diperiksa. Tidak mengubah data produksi.

Batas renderer: Obscura tidak mengekspos interpolasi filter dari stylesheet dan
melaporkan transition tinggi none pada pengujian ini. CSS blur2px/keyframes yang
dilayani diverifikasi; perubahan tinggi akhir terukur708→668px. Ini bukan bukti
pixel penuh interpolasi blur/tinggi pada browser pelanggan.

Bukti lokal: `/tmp/axvara-banner-blur-{tests,tsc,obscura,build}.log`;
PNG dan skrip CDP berada di
`/Users/macbookair/.paseo/orchestration/axvara-banner-blur-20261024/`.
Publikasi melalui push main/CI, tanpa deploy manual atau pemantauan deployment.
