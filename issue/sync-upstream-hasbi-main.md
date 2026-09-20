# Resep sync ke `Hasbi1605:main` (diverifikasi 2026-09-19)

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
| Suite di hasil merge | — | **909/909 hijau, tsc bersih** |

`outbox.ts` dihilangkan dari daftar konflik dengan menyelaraskan implementasi
(dan komentarnya, verbatim) ke `fbc7235` upstream. Dua perbaikan benar yang
saling tabrak lebih mahal daripada satu implementasi bersama.

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
npx tsc --noEmit && npx vitest run --run   # harap 909/909
```
Angka 909 = 903 (branch PR) + 6 dari commit upstream. Bila lebih rendah,
kemungkinan besar salah satu sisi konflik terbuang.
