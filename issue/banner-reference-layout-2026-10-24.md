# Revisi layout banner sesuai screenshot owner — 24 Oktober 2026

Menggantikan tampilan panggung tetap pada rilis d53626e, tanpa mengubah pengaturan
atau data banner/admin. Gambar w-full/h-auto memakai rasio natural dan mengisi kartu
448px (mobile mengikuti viewport). Panel putih, radius14px, counter langsung sesudah
gambar, panah overlay75%tinggi, batas manual tanpa panah keluar rentang. Teks rata
tengah; checkbox abu terpusat di atas CTA biru315DEA/full-width/radius6px/44px. CTA
kosong memakai Saya Paham. Tidak ada garis pemisah. Putar/jeda ringkas tetap tersedia
pada gambar, autoplay/swipe/hide/session/a11y existing dipertahankan.

Bukti Obscura pada route aktual + fixture inert memakai poster publik existing:
- Desktop image/media448×560px; mobile366×458px; rasio sesuai natural1122×1402,
  tanpa padding sisi/crop. Counter mulai12px sesudah image desktop (11px mobile
  setelah pembulatan renderer), checkbox selesai sebelum tombol dimulai.
- Panah ada di dalam rect gambar;1/2→2/2 dan batas prev/next benar; footer border0px,
  tombol center, overflowfalse/exceptionJS0. Screenshot desktop/mobile diperiksa.
- Fixture menyembunyikan main untuk isolasi keterbatasan preserve3d/stacking hero
  Obscura yang sudah dicatat; tidak mengubah hero/layout produksi. Kotak checkbox
  memiliki representasi border abu eksplisit dan fokus keyboard pada input semantik.

Regresi mencakup urutan media/counter/checkbox/tombol, batas panah dan fallback tutup,
selain autoplay/gesture/hide/fokus existing. Hasil suite/Pages/HTTP final dicatat di
CHANGELOG. Artefak ~/.paseo/orchestration/axvara-banner-layout-20261024/ dan log
/tmp/axvara-banner-exact-*. Tidak ada perubahan data banner produksi atau aset R2.
