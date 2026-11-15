# Arsip Produk — verifikasi lokal 15 November 2026

Status: implementasi lokal saja. Tidak commit, push, deploy, migrasi remote,
pembelian, pengiriman pesan, pembacaan secret atau akses produksi. `.commandcode/`
yang sudah ada tidak disentuh. PRD/ARCHITECTURE menjelaskan kontrak final.

## Perilaku

- DELETE biasa mengarsipkan parent + seluruh varian secara atomik dan menjaga
  relasi historis serta identitas supplier. Arsip hilang dari empat tab dan kartu
  statistik operasional; Arsip memiliki tab dan hitungan sendiri.
- PATCH `{archived:false}` memulihkan dengan parent/varian tetap nonaktif.
  Prekondisi di dalam batch mencegah request restore basi mematikan produk yang
  sudah dipulihkan/diaktifkan oleh request lain.
- DELETE `?permanent=1` hanya untuk Arsip manual tanpa identitas supplier dan
  tanpa order/fulfillment/inventory/modal/link/pair/cart/session. Pemeriksaan
  shared API/list diulang di batch sebelum DELETE varian dan parent; race relasi
  baru ditolak409 tanpa menghapus varian. JSON order rusak gagal tertutup.
- Aktivasi parent/varian dari editor dan panel supplier ditolak409 dengan
  “Pulihkan dari Arsip dulu”. Trigger database melindungi race sesudah preflight.
  requireAdmin dan audit otorisasi existing tetap; mutasi memakai rate limit.

## Jalur supplier/otomatisasi

| Jalur | Pengaman |
| --- | --- |
| WR premium, termasuk diff/zero-missing | Lookup WR ID tetap menemukan Arsip; UPDATE copy/varian/agregat dan INSERT varian mengecek parent non-Arsip. Registry tanpa tautan kembali memakai parent yang sama. |
| SK, termasuk diff/zero-missing | Lookup SK ID tetap menemukan Arsip; UPDATE varian/agregat dan INSERT varian mengecek parent non-Arsip, termasuk varian supplier baru. |
| Jaspay | Legacy parent yang Arsip tetap menahan pembuatan pengganti; INSERT varian, relink, harga/stok/metadata dan agregat memakai guard SQL parent. |
| TUNVN akun | Family atau slug yang tersimpan memblokir parent baru; INSERT/UPDATE varian serta agregat melewati Arsip. Identitas mirror tetap disimpan. |
| TUNVN Buff/retired | Upsert Buff dan cleanup bundle/produk retired melewati Arsip. Panel akun/Buff memblokir aktivasi parent Arsip. |
| AIVault | Family tetap memblokir parent baru walau slug diubah; INSERT/UPDATE varian/agregat melewati Arsip. Panel memblokir aktivasi. |
| Pair winners | Statistik aktif mensyaratkan non-Arsip; sisi unarchived yang aktif menang tanpa menulis is_active atau menghapus pair. |
| Restock/reorder | Read dan write parent memakai guard non-Arsip; urutan normalisasi admin juga mengecualikan Arsip. |

INSERT varian bersyarat yang tidak menulis (`changes=0`) mengabaikan last-row-id
lama; ini mencegah registry menunjuk ID stale setelah parent diarsipkan.

Storefront, PDP, Telegram/WhatsApp dan reservasi checkout sudah mensyaratkan
parent aktif; arsip mematikan parent/varian dalam batch dan trigger mencegah
pengaktifan tak sengaja. API daftar publik juga mengecek archived_at NULL.
Cache katalog publik tetap memakai TTL existing; quote/order berikutnya membaca
status aktif database dan menolak produk yang diarsipkan. Riwayat order tetap.

## Hasil aktual

- Fokus API + sync: `NODE_ENV=test npx vitest run tests/product-archive.integration.test.ts tests/product-archive-sync.test.ts` → 37 test lulus.
- Fokus UI + workerd: `NODE_ENV=test npx vitest run tests/product-archive.behavior.test.tsx tests/product-archive.workerd.test.ts` → 2 test lulus. Native D1 menerapkan0126, mempertahankan baris existing, menolak aktivasi Arsip, dan rollback batch saat trigger gagal.
- Suite akhir: `NODE_ENV=test npx vitest run --run` → **461 file / 6333 test lulus**, durasi99,84detik. Run awal menemukan fixture skema lama pada `d1-phase2-cost.workerd.test.ts`; kolom archived_at ditambahkan pada fixture itu, pemeriksaan fokus dan suite akhir lulus.
- `npx tsc --noEmit` → exit0, tanpa diagnostic.
- ESLint semua file TS/TSX yang berubah → exit0, **0 error / 5 warning existing**: ProductsSection perPage/activeProducts/lowStock tidak dipakai; SK sync defaultCategoryId/sellPrice tidak dipakai. Tidak ada warning baru dari lifecycle Arsip.
- `git diff --check` → lulus. Daftar tracked credential patterns dan staged files kosong; tidak ada secret dibaca/ditambahkan.

## Browser nyata

Puppeteer-core + Google Chrome headless lokal, halaman asli
`http://127.0.0.1:3000/admin?section=products`; viewport1440×1000 dan390×844.
API auth/katalog/mutasi diintersep dengan data palsu di browser. Semua request
non-local diblokir. Ini bukti interaksi komponen/hook asli, bukan autentikasi
produksi atau integrasi provider; API nyata diuji terpisah memakai SQLite/D1.

Kedua viewport berhasil: archive → hilang dari Live → tab Arsip → restore →
Nonaktif dengan saklar false → archive lagi → konfirmasi hapus permanen → baris
hilang. Tombol permanen supplier disabled dengan alasan dan badge TUNVN tetap
terlihat; filter Manual setelah penghapusan menampilkan empty state Arsip.
Dialog memfokuskan Batal; Escape menutup dan fokus kembali ke tombol Arsipkan.
Lebar dokumen sama dengan viewport (1440/390), tanpa overflow horizontal.
Route200,20response CSS/JS semuanya200, console/pageerror0 dan network error0.
Toast sukses sementara dapat menutup kontrol mobile ketika scroll otomatis;
pemeriksaan menunggu kontrol dapat dihit sebelum klik, kemudian seluruh flow
lulus. Tidak mengubah pola toast existing dalam tugas ini.

Artefak lokal: `/tmp/axvara-archive-browser-results.json`, screenshot desktop/mobile
`/tmp/axvara-archive-{desktop,mobile}.png`, log suite/typecheck/lint di
`/tmp/axvara-archive-*.log`. Fixture API hanya hidup di proses browser; browser
profile dan script fixture sementara dibersihkan, server dev milik tugas dihentikan.
Build/deploy dan produksi N/A: tidak diminta; tidak ada perubahan toolchain,
konfigurasi routing, secret/env/cron. Kompatibilitas D1 diperiksa dengan workerd.
Migrasi0126 tetap perlu diterapkan oleh jalur rilis CI saat owner mempublikasikan.

## File berubah

- `CHANGELOG.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/PRD.md`
- `docs/agent-rules/aivault.md`
- `docs/agent-rules/supplier-wr-sk.md`
- `docs/agent-rules/tunvn.md`
- `drizzle/migrations/0126_product_archive.sql`
- `drizzle/schema.sql`
- `src/app/(shop)/admin/page.tsx`
- `src/app/api/admin/aivault/products/[id]/route.ts`
- `src/app/api/admin/tunvn/buff/[sku]/route.ts`
- `src/app/api/admin/tunvn/products/[id]/route.ts`
- `src/app/api/admin/variants/route.ts`
- `src/app/api/products/[id]/route.ts`
- `src/app/api/products/reorder/route.ts`
- `src/app/api/products/route.ts`
- `src/components/admin/product-types.ts`
- `src/components/admin/sections/ProductsSection.tsx`
- `src/components/admin/useProductManager.ts`
- `src/lib/aivault/catalog.ts`
- `src/lib/product-archive.ts`
- `src/lib/product-lifecycle.ts`
- `src/lib/restock-reinsert.ts`
- `src/lib/sekalipay/sync.ts`
- `src/lib/supplier-pairs.ts`
- `src/lib/tunvn/catalog.ts`
- `src/lib/warung-rebahan/sync.ts`
- `tests/d1-phase2-cost.workerd.test.ts`
- `tests/product-archive-sync.test.ts`
- `tests/product-archive.behavior.test.tsx`
- `tests/product-archive.integration.test.ts`
- `tests/product-archive.workerd.test.ts`
- `issue/product-archive-2026-11-15.md` (catatan ini)
