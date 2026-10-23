# Banner carousel — 24 Oktober 2026

Implementasi atas screenshot AXVARA/Sekalipay owner dan permintaan panel bawah lebih
terang. Base be28f76. Tidak menyalin aset/brand Sekalipay atau menganggap durasi/
konfigurasi internal mereka diketahui dari screenshot.

Referensi primer: [W3C carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/),
[W3C animasi carousel](https://www.w3.org/WAI/tutorials/carousels/animations/) dan
[modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
Panah, kontrol pause, berhenti saat fokus/hover dan pengembalian fokus mengikuti
panduan tersebut. Transisi300ms, interval6detik, warna dan batas input adalah
keputusan desain AXVARA.

## Masalah dan perilaku baru

- Popup lama memakai find(): hanya banner pertama layak yang dapat dibaca. Kini
  seluruh banner aktif non-hidden berada dalam satu carousel, panah/swipe/keyboard
  dan auto-loop. Menutup tidak membuka modal berikutnya; tetap home-only.
- Urutan lama mencari slot kosong berikutnya, bukan memindahkan baris. Kini drag/
  tombol naik-turun mengirim permutasi lengkap dengan snapshot. Batch D1 guard→
  staging→normalisasi→hapus guard atomik, termasuk create/delete; create append,
  delete merapatkan. Tidak ada posisi negatif bocor ketika batch gagal.
- Edit isi dari tab lama tidak menimpa order baru: urutan hanya melalui reorder;
  field legacy posisi/delay/max tervalidasi namun diabaikan pada tulis isi. Kolom
  dan index lama tetap. Batas1000, konflik409, payload invalid400.
- Pengaturan bersama satu JSON store_settings: buka1500ms, auto=true, interval6000ms,
  maksimal1popup/sesi. Batas0–10s/4–20s/1–10. No-store, satu fetch, tanpa polling/
  migrasi/env/dependensi baru. active=0 sekarang tetap memerlukan admin.
- Putaran berhenti ketika fokus membaca/interaksi manual, hover, hidden atau
  reduced-motion. Initial focus tombol tutup di luar region carousel. Jeda/Putar
  eksplisit; timer tunggal. Preload hanya gambar berikut. Gambar utuh pada panggung
  tetap, scroll vertikal dipertahankan. Hide24jam per-info langsung ke tetangga;
  last hidden menutup, key lama tetap. Sesi dihitung sekali per popup.
- Panel teks/kontrol putih kebiruan#F5F7FC, teks midnight#10172D/slate dan CTA cyan.
  Lebar480px/maxviewport, max92dvh, gerak horizontal300ms atau instan reduced-motion.

## Review independen

Wonder B1 menantang desain awal. PM menerima satu otoritas urutan, append baru,
CAS dalam batch/permutasi penuh, JSON bersama, perubahan semantik sesi/hide,
kontras/fokus/timer dan rollback/resync. Semua keputusan diverifikasi sendiri lewat
source/tes. Saran memisahkan write-lock admin tidak diambil: satu mutasi dalam satu
waktu disengaja agar toggle/create/reorder tidak saling menimpa; tombol aktif lagi
setelah hasil jaringan. Input pengaturan yang belum disimpan tidak hilang saat
refresh daftar akibat penyimpanan isi/reorder.

## Bukti verifikasi

- Seluruh3046test/251file pass; type-check pass; lint0error dengan warning existing.
  Test SQLite dan workerd: reorder paralel satu pemenang, create vs reorder tidak
  kehilangan row, duplicate/missing/foreignID ditolak, fault setelah staging rollback,
  arsip/index0064 terjaga, settings/otorisasi; UI autoplay/hover/hidden/fokus/reduced,
  pointer horizontal vs scroll/cancel, hide, sesi, image-error, modal trap/restore.
- Obscura route Next aktual pada1440/390px, backend in-memory terisolasi. Poster
  dari aset banner publik AXVARA, bukan perubahan file R2. Autoplay+panah, DOM pointer
  swipe pada React hydrated, tombol urutan dan keyboard drag terbukti; exceptionJS0,
  overflow0, warna computed title rgb(16,23,45), panel rgb(245,247,252). Screenshot
  desktop/mobile diperiksa. API fixture hanya mengubah urutan/settings memory;
  mutasi produksi/order/pembayaran diblokir.
- Obscura native mouse CDP tidak membangkitkan gesture pointer yang dibutuhkan;
  verifikasi gesture memakai event pointer DOM hydrated serta tes DOM. Renderer
  preserve3d/stacking hero dapat mengecat di atas modal; screenshot isolasi menyembunyikan
  main pada fixture saja, tidak mengubah source/layout produksi. Native number/
  checkbox/SVG paint existing dapat berbeda; value/checked diperiksa melalui DOM.
- Build Pages, HTTP/CSS dan status publikasi final dicatat pada CHANGELOG. Artefak
  `~/.paseo/orchestration/axvara-banners-20261024/`, log `/tmp/axvara-banner-*`.
  Tidak mengubah data banner/config produksi langsung atau melakukan deploy manual.
  Push main mengikuti CI; hasil deployment tidak dipantau.
