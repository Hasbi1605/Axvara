# Paritas Single-Varian: garansi + cara pengiriman + template pesan di mode non-varian

## Latar Belakang
Produk non-varian (toggle "Variasi Produk" OFF, 1 varian `DEFAULT-`) tidak bisa
diatur masa garansi, cara pengiriman (fulfillment_mode), min. beli, maupun
template pesan pembeli. Semua field itu hanya muncul di mode multi-varian
(`ProductVariantRows`), padahal sumber kebenaran tetap tabel `product_variants`
untuk kedua mode. Akibat: produk digital single-item tidak bisa pakai Kirim
Otomatis (shared/unique) dan tidak bisa pasang garansi — satu-satunya
workaround adalah menyalakan toggle varian fiktif. Ini bug paritas, bukan
batasan by-design.

## Tujuan
Mode single tetap ringkas, tapi memiliki kapabilitas yang sama dengan mode
varian untuk field milik admin: min. beli, garansi, cara pengiriman, template
pesan. Saat simpan, mode single selalu dikirim sebagai 1 varian `Default`
eksplisit (dengan id/sku yang sama agar update in-place).

## Ruang Lingkup
- `ProductForm` ditambah field single-mode: `min_qty`, `warranty_*`,
  `fulfillment_mode` (hanya kontrak bentuk data).
- Ekstrak blok garansi dari `ProductVariantRows` jadi komponen bersama
  `WarrantyFields`; ekspor `FULFILLMENT_OPTIONS` + `NonWrFulfillmentPanel`.
- Komponen baru `SingleVariantFields` (min. beli + garansi + pengiriman +
  panel fulfillment) dirender di cabang single `ProductEditorModal`.
- `useProductManager`: `openEdit`/`openNew` mengisi default single-mode;
  toggle ON membawa nilai form, toggle OFF menyalin varian pertama ke form;
  `save()` mode single mengirim `variants: [{Default…}]`, bukan
  `variants: undefined`.
- Produk WR-managed tetap read-only di mode single (locked + panel `__wr__`).
- Test regresi: PUT single via variants mengupdate varian DEFAULT in-place;
  payload client single menyertakan variants; UI single menampilkan field baru.

## Di Luar Scope
- Perubahan engine fulfillment, badge storefront, checkout/quote.
- Migrasi data / migrasi SQL baru (tidak perlu — produk lama tetap valid,
  tinggal diedit).
- Perubahan skema API POST/PUT (server sudah mendukung variants eksplisit;
  tidak ada field top-level baru).
- Menghapus mode single / memaksa selalu multi-varian.

## Area / File Terkait
- `src/components/admin/product-types.ts`
- `src/components/admin/sections/ProductVariantRows.tsx`
- `src/components/admin/sections/SingleVariantFields.tsx` (baru)
- `src/components/admin/ProductEditorModal.tsx`
- `src/components/admin/useProductManager.ts`
- `tests/product-variant-save.integration.test.ts` (+ kasus single)
- `tests/` behavior baru untuk cabang single (bila pola existing memungkinkan)
- `CHANGELOG.md`, `docs/PRD.md`/`docs/ARCHITECTURE.md`/`README.md` (bagian
  admin yang relevan, per tabel Aturan Dokumentasi)

## Risiko
- Toggle bolak-balik ON↔OFF bisa menghilangkan nilai bila sinkronisasi
  terlewat → mitigasi: salin eksplisit di kedua arah + dirty-check existing.
- PUT tanpa `id` varian akan insert varian baru + menonaktifkan DEFAULT lama
  (stok fulfillment keyed by variant_id!) → mitigasi: selalu teruskan
  `formVariants[0].id/sku` saat edit; test mengunci perilaku ini.
- Guard WR 409: nilai WR-owned yang tidak berubah bukan pelanggaran
  (`findWrOwnedViolation` hanya menolak yang berubah) → aman selama
  `openEdit` mengisi form dari DB, bukan default.
- Jalur legacy (client lama tanpa variants) tetap dipertahankan server —
  tidak diubah.

## Langkah Implementasi
1. `product-types.ts`: tambah field opsional single-mode ke `ProductForm`.
2. `ProductVariantRows.tsx`: ekstrak `WarrantyFields`, ekspor
   `FULFILLMENT_OPTIONS` + `NonWrFulfillmentPanel`; baris varian memakai
   `WarrantyFields` (tanpa perubahan perilaku).
3. `SingleVariantFields.tsx` baru, terikat ke `form` via `onSetForm`.
4. `ProductEditorModal.tsx`: render di cabang single + logika sync toggle.
5. `useProductManager.ts`: default `openNew`, populate `openEdit`,
   payload `save()` single → variants eksplisit.
6. Test + changelog + docs, `vitest run`, `tsc`, verifikasi dev
   (GET / 200 + CSS 200 + Obscura bila tersedia).

## Rencana Test
- Integrasi PUT: produk single DEFAULT, kirim variants 1 Default berisi
  warranty full + fulfillment shared + min_qty → 200, row varian id sama
  terupdate (tidak ada insert baru), master ikut sinkron.
- Integrasi PUT: tanpa `id`? — didokumentasikan sebagai insert (tidak dipakai
  client), tidak perlu dikunci bila berisiko.
- Payload client: baca sumber `useProductManager.ts`, pastikan cabang single
  membangun `variants:` dan tidak mengirim kolom legacy.
- Behavior/UI: render `ProductEditorModal` mode single → "Masa Garansi",
  "Cara Pengiriman", "Template pesan untuk pembeli" tampil.
- Seluruh suite hijau sebelum push.

## Kriteria Selesai
- Produk baru mode single bisa disimpan dengan garansi + shared/unique +
  template; nilai terbaca kembali saat Edit.
- Produk single lama bisa diubah ke garansi/otomatis tanpa menyalakan toggle
  varian.
- Toggle ON↔OFF tidak mereset nilai.
- Produk WR tetap terkunci semestinya (tidak 409 untuk edit yang sah).
- Test hijau semua, `tsc` bersih, changelog + docs terisi, push `main`.
