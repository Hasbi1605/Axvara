# Resep sync ke `Hasbi1605:main` (diverifikasi ulang 2026-09-20 vs `8ffc7a0`)

Ditulis setelah review PR #1 menandai risiko rebase. **Bukan spekulasi** —
merge percobaan benar-benar dijalankan lokal, konflik diselesaikan, lalu
`tsc` + suite penuh dijalankan di hasil gabungannya.

> Catatan: PR #1 menargetkan `marylynnsigala:main` yang **CLEAN** (0 konflik).
> Dokumen ini hanya berlaku saat menyinkronkan ke fork `Hasbi1605:main`.

## Hasil terukur

| | Sebelum konvergensi | Sesudah |
|---|---|---|
| File konflik | 3 | **2** |
| `src/lib/whatsapp/outbox.ts` | CONFLICT | **auto-merge** |
| Suite di hasil merge | — | **hijau, tsc bersih** |

**Verifikasi ulang 2026-09-20 melawan upstream `8ffc7a0`** (permintaan review:
angka lama dihitung dari base lama, jadi diulang penuh):

| Gate | Hasil di hasil merge |
|---|---|
| `npx tsc --noEmit` | bersih |
| `npx vitest run --run` | **924/924 hijau (89 file)** |
| `npm run build:pages` | **sukses, 17,36 dtk** (12 prerendered route + worker) |

Konflik tetap 2 file yang sama (CHANGELOG + `useProductManager`);
`outbox.ts` tetap auto-merge. Branch PR sudah dibersihkan dari file
sync-workflow, jadi tidak ada lagi file khusus-fork yang ikut ke upstream.

`outbox.ts` dihilangkan dari daftar konflik dengan menyelaraskan implementasi
(dan komentarnya, verbatim) ke `fbc7235` upstream. Dua perbaikan benar yang
saling tabrak lebih mahal daripada satu implementasi bersama.

## Jangan panik melihat angka 5

`git merge-tree` di git versi baru menandai **5** file sebagai "changed in
both": `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `src/lib/whatsapp/outbox.ts`,
`CHANGELOG.md`, dan `src/components/admin/useProductManager.ts`.

Tiga yang pertama **tidak** menghasilkan marker `<<<<<<<` — `git merge` biasa
menggabungkannya sendiri tanpa keputusan manusia. Yang benar-benar butuh otak
hanya **2 file** di bawah. Jangan memperlakukan 5 file itu sebagai 5 konflik
lalu "menyelesaikan" file yang sebetulnya sudah benar.

Dibuktikan ulang 2026-09-20 dengan `git merge` sungguhan (bukan `merge-tree`):

```
Auto-merging docs/ARCHITECTURE.md          <- bersih
Auto-merging docs/DESIGN.md                <- bersih
Auto-merging src/lib/whatsapp/outbox.ts    <- bersih
CONFLICT (content): CHANGELOG.md
CONFLICT (content): src/components/admin/useProductManager.ts
```

`git diff --name-only --diff-filter=U` mengembalikan tepat 2 nama itu.

> Jebakan saat menguji: kalau ada perubahan belum ter-commit di working tree,
> `git merge` menolak jalan dan bisa terbaca seolah "0 konflik". Stash dulu
> sebelum merge-trial.

## Sisa konflik: 2 file, keduanya wajar

### 1. `CHANGELOG.md` — append-only
Pertahankan **kedua** entri. Entri PR di atas, entri upstream di bawahnya.
Tidak ada yang dibuang.

### 2. `src/components/admin/useProductManager.ts` — `filtered`
Inilah satu-satunya konflik yang butuh pikiran. Dua perubahan menyentuh blok
yang sama:
- **upstream `d135668`**: SORT (ready → habis → nonaktif, lalu `sortOrder`, `id`)
- **PR #1**: FILTER `onlyLowStock`

Menempel salah satu mentah-mentah menghapus yang lain. Resolusi yang sudah
diuji (909/909 hijau, termasuk `product-variant-save` milik upstream):

```ts
const isOut = (p: Prod): boolean => p.stock != null && p.stock !== -1 && p.stock <= 0;
const filtered = useMemo(
  () => prods
    .filter(p => {
      if (q && !`${p.name} ${p.slug} ${p.badge??""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (onlyLowStock && !((p.lowStockVariants ?? (p.stock >= 0 && p.stock <= 5 ? 1 : 0)) > 0)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const byActive = Number(!b.isActive) - Number(!a.isActive);
      if (byActive !== 0) return byActive;
      const bySold = Number(isOut(a)) - Number(isOut(b));
      if (bySold !== 0) return bySold;
      const byOrder = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (byOrder !== 0) return byOrder;
      return Number(a.id) - Number(b.id);
    }),
  [prods, q, onlyLowStock],
);
```

Dua hal yang mudah terlewat: `onlyLowStock` **wajib** masuk array dependency
(tanpa itu filter tidak bereaksi saat dinyalakan), dan `isOut` dideklarasikan
di luar `useMemo` seperti aslinya.

## Setelah resolusi
```bash
npx tsc --noEmit && npx vitest run --run && npm run build:pages
```
Patokan terhadap `8ffc7a0`: **924/924 (89 file)** dan build Pages sukses.
Bila jumlah test lebih rendah, kemungkinan besar salah satu sisi konflik
terbuang saat resolusi.
