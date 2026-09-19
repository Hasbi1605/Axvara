# Audit Panel Admin — 2026-09-19

Ruang lingkup: seluruh `?section=*` di `/admin` (Ringkasan, Pesanan, Produk,
Kategori, Metode & Rekonsiliasi, Warung Rebahan, Artikel, Banner, Subscriber
Email, Kanal & Fulfillment, Integrasi Agent, Pengaturan Toko).

Metode: baca kode (`src/components/admin/**`, `src/app/api/admin/**`) +
verifikasi langsung di dev (login admin, buka tiap section, baca DOM).
Setiap temuan punya bukti `file:baris` atau hasil eval DOM.

---

## A. BUG (terkonfirmasi)

### A1. Kartu "Stok menipis" di Ringkasan tidak memfilter apa pun
`AdminOverview.tsx:59` mengirim `section: "products"` dengan `params: {}`.
`ProductsSection.tsx` tidak pernah membaca URL param apa pun. Diverifikasi di
dev: klik kartu → URL jadi `?section=products`, daftar tetap menampilkan SEMUA
produk.

Akibat: kartu terlihat seperti antrean kerja padahal hanya pindah tab. Admin
harus mencari sendiri varian mana yang tipis di antara 50 produk / 7 halaman.

### A2. Angka "Stok menipis" beda antara Ringkasan dan Produk
Dua definisi berbeda untuk label yang sama:
- Ringkasan: `overview/route.ts:140` — `COUNT(*) FROM product_variants WHERE is_active=1 AND stock BETWEEN 0 AND 5` (hitung **varian**).
- Produk: `useProductManager.ts:336` — `prods.filter(p=>p.stock>=0&&p.stock<=5).length` (hitung **produk**, di mana `stock` = SUM stok varian, `products/route.ts:111`).

Bukti dari screenshot owner: Ringkasan `66`, Produk `33`. Keduanya benar
menurut rumusnya sendiri, tetapi satu panel memakai satu nama untuk dua hal.

### A3. ~~Thumbnail bukti kosong~~ — DIPERIKSA, BUKAN BUG
Dugaan awal: `OrdersManager.tsx:196` mengirim pesanan non-QRIS tanpa bukti ke
`ProofThumbnail` sehingga kotaknya kosong. Setelah dibaca, `ProofThumbnail.tsx:54`
sudah menangani `!proof` dengan state "Belum ada bukti / Tidak diunggah pembeli".
Dicatat agar tidak diaudit ulang.

### A4. Filter `proof` aktif tanpa kontrol UI untuk mematikannya
`OrdersManager.tsx:46` membaca `?proof=` dari URL dan mengirimnya ke API
(`orders/route.ts:34`), tetapi tidak ada `<select>`/chip yang menampilkan atau
mengubah state ini — `setProof` hanya dipakai di `clearFilters` (`:97`).

Akibat: datang dari kartu "Bukti manual" → daftar tersaring diam-diam. Semua
filter di layar menunjukkan "Semua", jadi admin melihat daftar pendek dan
menyimpulkan pesanannya hilang.

### A5. Kartu "Fulfillment" mengirim param yang tidak dibaca siapa pun
`AdminOverview.tsx:61` → section `bot`. `BotAutomationManager.tsx` tidak
membaca URL param sama sekali. Sama seperti A1: navigasi tanpa konteks.

### A6. Section Produk tidak punya heading sama sekali
Eval DOM di dev, per section:
```
summary    => H2 Perlu tindakan / H2 Kinerja toko / H2 Kesehatan sistem
orders     => H2 Pesanan
products   => []                  <- tidak ada h1/h2/h3
categories => H2 Kategori
settings   => H1 Pengaturan Toko  <- satu-satunya H1
```
Produk adalah halaman terpenting dan satu-satunya tanpa judul.

### A7. `systemsDetails` adalah variabel modul yang ditulis per-request
`overview/route.ts:234` `let systemsDetails = {}` di scope modul, ditulis di
`:291`, dibaca di `:218`. Di isolate edge yang melayani beberapa request,
polanya rapuh. Nilainya ditulis lalu dibaca dalam satu alur sinkron sehingga
belum terbukti salah di produksi, tetapi tidak ada alasan untuk tidak
mengembalikannya sebagai nilai biasa.

### A8. Membuka produk saat varian gagal dimuat = form kosong yang diam (RISIKO DATA)
`useProductManager.ts` `openEdit`: bila `GET /api/products/:id` tidak OK, kode
jatuh ke `GET /api/admin/variants`; bila **keduanya** gagal, `rawVars` tetap `[]`
dan `catch` lama me-reset `setFormVariants([])` **tanpa pesan apa pun**.

Mengapa ini bukan sekadar UX: dari keadaan itu admin melihat produk
multi-varian seolah tak punya varian. Jika ia menekan Simpan,
`save()` mengirim `variants: []` → `products/[id]/route.ts:270`
menjalankan `UPDATE product_variants SET is_active=0 WHERE product_id=?`
(cabang `incomingIds.length === 0`) — **seluruh varian produk dinonaktifkan**
karena satu hiccup jaringan. Sudah diperbaiki: sumber yang gagal kini melempar,
`formError` + toast menahan admin, dengan pesan eksplisit "jangan simpan
sebelum varian tampil".

### A9. Dead code: `VariantEditor.tsx` + `FulfillmentInventoryPanel.tsx`
`grep -rn "VariantEditor" src/` tidak menemukan satu pun import — satu-satunya
kemunculan adalah komentar di `ProductVariantRows.tsx:18`.
`FulfillmentInventoryPanel` hanya diimpor oleh `VariantEditor.tsx:6`, jadi
keduanya membentuk pulau mati (~360 baris) yang tak terjangkau route mana pun.

Yang membuatnya berbahaya: **test justru memakukan keduanya** —
`tests/payment-proofs.regression.test.ts:91-97` dan
`tests/variant-min-qty.test.ts:134` membaca isi file mati itu dan menuntut
string tertentu ada di dalamnya. Jadi suite hijau ikut "membuktikan" fitur
yang tidak pernah dirender, dan siapa pun yang menghapus file mati akan
memerahkan test yang tampak sah. Ini akar historis bug 2026-09-19 (panel isi
kredensial hilang): jalur resmi tak punya panel, tapi test tetap hijau karena
menguji file mati. Menghapusnya perlu mengubah test tersebut agar menunjuk ke
`ProductVariantRows` — di luar cakupan commit ini, dicatat sebagai butir C.

### A10. Test flaky di CI: jitter WA outbox tidak bisa di-override
`tests/wa-outbox-lease.integration.test.ts` men-stub
`WHATSAPP_OUTBOX_PACE_MS=0`, tetapi `outbox.ts` membaca jitter dari konstanta
modul `WA_OUTBOX_PACE_JITTER_MS` (0–3000 ms acak) yang **tidak** bisa
di-override. Tiga kirim berarti rata-rata ~4,5 dtk melawan batas default
Vitest 5 dtk — test memerah acak tanpa perubahan kode (terlihat sekali pada
run audit ini: 5009 ms, lalu hijau saat diulang).

Ditemukan bukan dari membaca panel admin, melainkan dari satu kegagalan pada
run suite penuh. Diperbaiki karena flake di jalur deploy menghukum commit yang
tidak bersalah: jitter kini dibaca per-panggilan
(`outboxPaceJitterMs()`, env `WHATSAPP_OUTBOX_PACE_JITTER_MS`) dan test
men-stub-nya ke 0. Durasi test turun dari 2174 ms → 8 ms. Perilaku produksi
tidak berubah (env kosong = tetap jitter 3000 ms).

---

## B. UX / konsistensi (sumber rasa "acak-acakan")

### B1. Lima dialog memakai `confirm()` / `alert()` bawaan browser
Padahal repo punya `ConfirmDialog` bertema:
- `CategoryManager.tsx:80` — hapus kategori
- `BannerManager.tsx:85` — hapus banner
- `ArticlesManager.tsx:173` — hapus artikel
- `ArticleEditor.tsx:66` — `window.alert` error upload
- `ImageDropzone.tsx:93` — `alert` error upload

Dialog OS putih-abu di tengah panel gelap. Produk memakai `ConfirmDialog`,
kategori/banner/artikel tidak.

### B2. Modal Kategori bukan dialog yang sah
`CategoryManager.tsx:277` — overlay tanpa `role="dialog"`, tanpa `aria-modal`,
tanpa Escape, tanpa scroll-lock. Bandingkan `ProductEditorModal.tsx:55` dan
`ConfirmDialog.tsx:29-35` yang punya semuanya.

### B3. Header section tidak seragam
| Section | Judul | Deskripsi | Tombol utama |
|---|---|---|---|
| Produk | *(tidak ada)* | — | pill `rounded-full` h-10, di samping search |
| Kategori | h2 di card header | ada | pill `rounded-full` h-10, `ml-auto` |
| Pembayaran | h2 di card header | ada | `rounded-xl` h-9, `ml-auto` |
| Pesanan | h2 di card header | ada | `rounded-xl` h-9 outline, `ml-auto` |
| Banner | 2x h2 (form + daftar) | — | `rounded-full`, di dalam form |
| Pengaturan | h1 di luar card | ada | pill h-10, footer card |

### B4. Banner: form kosong memakan setengah layar meski belum dibutuhkan
0 banner, tetapi form "Banner baru" (8 field) tetap terbuka permanen di kiri
dan kolom kanan kosong. Section lain memakai pola "tombol → modal".

### B5. Modal produk: satu modal untuk tiga pekerjaan berbeda
`ProductEditorModal` memuat identitas produk + toggle varian + N baris varian
(nama, harga, harga coret, stok, min beli, 3 kontrol garansi, dropdown
pengiriman, panel fulfillment) + galeri foto. Untuk produk 5 varian,
menyimpan berarti scroll melewati kurang lebih 40 input ke tombol paling
bawah. Label campur: `NAMA VARIAN / PAKET *` (uppercase 10px) vs `Nama *`
(sentence case 12px) di modal yang sama.

### B6. Grid varian pecah di kolom sempit
`ProductVariantRows.tsx:276` memakai `sm:grid-cols-4` untuk Harga / Harga
Coret / Stok / Min. Beli. Label "HARGA CORET (RP) bisa diedit" membungkus jadi
dua baris sementara tetangganya satu baris, sehingga input-nya turun dan tidak
sejajar (terlihat di screenshot 23.20.54 dan 23.21.02).

### B7. Navigasi 12 menu, sebagian bukan "tempat kerja"
`Integrasi Agent` (token MCP, diatur sekali) dan `Subscriber Email` (daftar
baca-saja tanpa export/pagination) punya bobot sidebar sama dengan Pesanan dan
Produk. Sementara `Kanal & Fulfillment` dan `Warung Rebahan` — dua-duanya soal
pemenuhan pesanan — terpisah di grup berbeda (Otomasi vs Pembayaran).

### B8. Pesanan: 4 kartu metrik menduplikasi Ringkasan dan mengabaikan filter
`OrdersManager` menampilkan Total pesanan / Pending / Lunas / Omzet. Nilainya
dihitung tanpa `where` (`orders/route.ts:68`), jadi memfilter ke "Pending"
tetap menampilkan "Total pesanan 26".

---

## C. Rekomendasi (urut dampak)

**Dikerjakan di commit ini** — A1, A2, A4, A6, A8, A10, B1, B2:
1. Filter stok menipis nyata di Produk, dipicu dari kartu Ringkasan.
2. Satukan definisi "stok menipis" ke basis varian di kedua layar.
3. Chip filter aktif di Pesanan, termasuk `proof` yang sebelumnya tak terlihat.
4. Heading section Produk + samakan level heading antar-section.
5. `ConfirmDialog` untuk hapus kategori, banner, dan artikel.
6. Modal kategori: `role="dialog"` + `aria-modal` + Escape + scroll-lock.
7. Gagal muat varian kini memperingatkan admin sebelum ia menyimpan di atas
   data yang belum termuat (mencegah seluruh varian ternonaktifkan).
8. Flake WA outbox dihilangkan agar CI tidak menghukum commit tak bersalah.

**Belum — butuh keputusan owner** (mengubah struktur/flow, bukan kosmetik):
8. B5 — pecah modal produk jadi tab Produk / Varian / Media, atau varian
   pindah ke panel sendiri dengan simpan per-varian.
9. B7 — gabungkan `Kanal & Fulfillment` + `Warung Rebahan` jadi grup
   "Pemenuhan"; turunkan `Integrasi Agent` + `Subscriber Email` menjadi tab di
   Pengaturan Toko. Menghemat 2 slot sidebar.
10. B8 — buat kartu metrik Pesanan mengikuti filter, atau hapus dan andalkan
    Ringkasan.
11. B4 — Banner mengikuti pola modal seperti Kategori.
12. A5 — kartu Fulfillment membawa filter status ke Kanal & Fulfillment.
13. A7 — `systemsDetails` dikembalikan sebagai nilai, bukan variabel modul.
14. A9 — hapus `VariantEditor.tsx` + `FulfillmentInventoryPanel.tsx` DAN
    arahkan `tests/payment-proofs.regression.test.ts` +
    `tests/variant-min-qty.test.ts` ke `ProductVariantRows`. Selama test masih
    menunjuk file mati, suite hijau tidak membuktikan panel yang benar-benar
    dirender.
15. Subscriber Email tanpa search/export/pagination; Banner memuat senyap tanpa
    indikator; pola empty/error/loading berbeda-beda tiap manager.
