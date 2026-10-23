# Animasi pengurutan kredensial — 23 Oktober 2026

Diimplementasikan; publikasi melalui CI. Berlaku pada stok unik produk pribadi.

Referensi primer yang ditinjau sebelum implementasi:

- [dnd-kit sortable](https://dndkit.com/legacy/presets/sortable/overview/): transform tetangga, vertical sorting dan overlay yang lepas dari alur daftar bergulir; gunakan komponen presentasi terpisah pada overlay agar ID sortable tidak terdaftar dua kali.
- [dnd-kit DndContext](https://dndkit.com/legacy/api-documentation/context-provider/dnd-context/): sensor input, autoScroll dan lifecycle start/over/end/cancel.
- [Atlassian guidelines](https://atlassian.design/components/pragmatic-drag-and-drop/design-guidelines): pegangan terlihat untuk entri dengan aksi lain, drop indicator yang jelas, hasil drop langsung terlihat, serta kontrol alternatif yang dapat diakses.

Penerapan AXVARA: kartu penuh mengikuti pointer; list menampilkan slot dashed dengan garis cyan serta posisi tujuan. Tetangga digeser oleh verticalListSortingStrategy dengan easing220ms; autoScroll di zona25% tepi daftar berjalan terus walau pointer ditahan. Container lain tidak diizinkan scroll. Overlay portal body z10000 melewati transform/clipping modal. ID list dimemoisasi agar referensi baru saat hover tidak menghilangkan transisi. PointerSensor baru aktif setelah6px; touch-action:none hanya di handle. Spasi mengangkat/menjatuhkan, panah memindah, Escape membatalkan; tombol naik/turun tetap ada. Reduced motion meniadakan transisi/drop animation.

Hover tidak menulis API. Drop memakai handler onMove dan kontrak reorder existing: UI optimistis, simpan sekali, refresh server/rollback pada konflik. Isi kredensial tidak dimasukkan ke event dataTransfer. Tidak ada migrasi, env atau perubahan fulfillment dalam revisi motion ini.

## Verifikasi

- 2.954 test pada241 file lulus, termasuk pointer preview/transform220ms, tidak POST saat hover, save saat drop, Escape tanpa save, auto-scroll atas/bawah terus berjalan saat pointer diam dan berhenti saat cancel, reduced motion, panah dan rollback stok berubah. Type-check lulus; lint tidak ada error (warning load existing pada panel); build Pages exit0.
- Obscura CDP memuat fixture dengan komponen aktual dan24 kredensial inert di ancestor bertransform. Scroll list951→0 sambil menahan drag; overlay/indikator hadir dan tetangga bergeser47px dengan transition220ms. Setelah drop, urutan tersimpan[24,1,…,23], overlay hilang dan screenshot diperiksa. Fixture dihapus sebelum build.
- Event pointer untuk fixture dinormalisasi field standarnya via CDP: constructor PointerEvent dan hit testing elemen dalam container scroll Obscura belum setara browser penuh. Hook/sensor/autoScroller dnd-kit dan API save fixture tetap berjalan tanpa mock library. Ini bukti perilaku dengan geometri renderer tersebut, bukan pengukuran frame rate produksi atau uji semua browser.
