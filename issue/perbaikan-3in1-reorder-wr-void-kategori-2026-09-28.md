# Perbaikan 3-in-1: Reorder Produk + WR Blocked Void/TTL + Kategorisasi Ulang

## Latar Belakang
1. Admin tidak bisa mengatur posisi produk di storefront dari UI (sort_order ada di DB/API tapi tidak ada kontrol ↑↓/angka di admin).
2. Order WR `blocked_balance` auto-revive tanpa batas umur dan tanpa opsi batal — kasus nyata Bos Hasbi: order lama hidup lagi saat topup WR dan saldo terpotong tanpa sengaja.
3. Kategori seed/live (`AI Gateway, Akun Premium, Tools Pro, Bundle Kucing`) ambigu: Akun Premium jadi keranjang sampah (AI+streaming+coding), Tools Pro campur kreatif+produktivitas, nama "Bundle Kucing" tidak profesional.

## Tujuan
- Admin bisa naik/turunkan posisi produk dari panel (tombol ↑↓ + field angka urutan).
- Zombie order WR tidak bisa auto-debit diam-diam: ada tombol Void, ada TTL auto-revive 24 jam, ada kabar buyer saat blocked.
- Kategori 6 yang jelas + rename Bundle Kucing → Bundle Hemat, tanpa URL filter lama 404.

## Ruang Lingkup
- (A) `ProductsSection.tsx` kolom Urutan + tombol ↑↓ (swap tetangga global), `ProductEditorModal.tsx` input Urutan, handler di `useProductManager.ts`, test reorder.
- (B) `POST /api/admin/warung/orders/[id]/void` (CAS mirror retry, set `failed` + `last_error=cancelled_by_admin`), UI tombol Batal di `WarungRebahanManager.tsx`, TTL 24 jam di `reconcileBlockedBalance()`, kabar buyer via ledger existing, test void+TTL.
- (C) Migrasi 0046 kategorisasi ulang (6 kategori, rename bundle, pindah category_id, update seed + `src/lib/products.ts` fallback), test kategori, docs.

## Di Luar Scope
- Drag-and-drop reorder (overkill, ditolak).
- Status baru `cancelled` di CHECK wr_order_links (reuse `failed`, hindari ALTER CHECK).
- Auto-refund penuh (refund manual via admin dulu; kebijakan refund diputuskan owner).
- Pecah >7 kategori niche.
- Deploy manual / push ke main (wajib feature branch + PR).

## Area / File Terkait
- A: `src/components/admin/sections/ProductsSection.tsx`, `src/components/admin/ProductEditorModal.tsx`, `src/components/admin/useProductManager.ts`, `src/app/api/products/[id]/route.ts` (sudah dukung sortOrder, baca saja), `tests/`.
- B: `src/lib/warung-rebahan/order.ts` (`handleInsufficientBalance`, `reconcileBlockedBalance`), `src/components/admin/WarungRebahanManager.tsx`, `src/app/api/admin/warung/orders/[id]/retry/route.ts` (rujukan CAS), `src/app/api/admin/warung/orders/[id]/void/route.ts` (baru), `tests/warung-rebahan/`.
- C: `drizzle/schema.sql`, `drizzle/migrations/0046_*.sql`, `src/lib/products.ts`, `src/app/api/categories/route.ts` (baca), `tests/`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `README.md`.
- Bersama (dikerjakan parent saat merge): `CHANGELOG.md` (append-only, entri paling atas), `docs/PRD.md` + `docs/ARCHITECTURE.md` + `README.md` sesuai tabel dokumentasi.

## Risiko
- Swap sort_order dalam halaman paginasi (8/halaman) bisa jebak produk di batas halaman → wajib swap tetangga global.
- Race cron vs admin void/retry → wajib CAS `WHERE id=? AND status=?` seperti route retry.
- TTL terlalu agresif bisa matikan auto-revive sehat → default 24 jam, konstanta bernama jelas.
- Rename/hapus kategori merusak filter `?cat=` lama → slug lama dipertahankan/redirect, DELETE hanya setelah produk dipindah (API 409 guard).
- Tiga worker paralel edit file yang sama (CHANGELOG/docs) → subagent DILARANG sentuh CHANGELOG/docs bersama; parent yang merge docs+changelog.

## Langkah Implementasi
1. Parent buat branch `feat/produk-reorder-wr-void-kategori-2026-09-28` (sudah dibuat).
2. Subagent A (reorder): baca file area A, tambah UI ↑↓ + input angka, handler swap global, test baru/update.
3. Subagent B (WR): baca file area B, tambah route void + tombol Batal + TTL 24 jam + kabar buyer, test baru/update.
4. Subagent C (kategori): dump kategori via seed+migrasi (tanpa akses prod bila tak ada), tulis migrasi 0046 + update seed/fallback, test baru/update.
5. Subagent: JANGAN commit/push, JANGAN sentuh CHANGELOG.md/docs bersama, JANGAN jalankan dev server port 3000 bersamaan (cukup vitest file terkait + tsc file terkait bila perlu).
6. Parent: verifikasi gabungan (vitest penuh, tsc, dev GET / 200 + CSS 200, Obscura route diubah), tulis CHANGELOG + docs, commit, push feature branch, buka PR ke main.

## Rencana Test
- A: test swap tetangga global (atas/bawah/batas halaman), validasi angka 0-999999, urutan API `ORDER BY sort_order` tetap.
- B: test void CAS (status berubah failed+alasan, race kalah 409), test TTL (link >24 jam tidak revive, link muda revive normal, order non-lunas skip), retry-race lama tetap hijau.
- C: test tiap kategori ≥1 produk, slug lama tidak 404, kategori kosong bisa dihapus (409 guard saat berisi).
- Parent: `npx vitest run` penuh hijau, `tsc --noEmit` bersih, dev + Obscura.

## Kriteria Selesai
- [ ] ↑↓ + angka urutan jalan di admin dan tercermin di storefront/API.
- [ ] Ada tombol Batal/void WR + link tua tidak auto-revive + buyer dikabari.
- [ ] 6 kategori live, Bundle Kucing ter-rename, filter lama aman.
- [ ] Seluruh test hijau, tsc bersih, CHANGELOG+docs terisi.
- [ ] Commit di feature branch, push branch, PR baru ke main (TANPA push/merge ke main).
