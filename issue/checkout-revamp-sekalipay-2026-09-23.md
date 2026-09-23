# Checkout Revamp ala Sekalipay — 4 Fix UI/UX

## Latar Belakang
Perbandingan screenshot Sekalipay vs Axvara (owner, 2026-09-23): alur Sekalipay
**Metode → Data minimal (Email+WA) → 1 CTA** terbukti lebih bersih. Checkout
Axvara (`src/app/checkout/page.tsx`, layout action-rail Batch C 2026-09-19)
punya 4 anomali nyata di mobile: 2x Ringkasan + 2x CTA dalam 1 viewport
(terbukti di screenshot ke-3: CTA rail + CTA sticky nempel bareng), urutan
Data-dulu bikin error "Pilih metode pembayaran terlebih dahulu" padahal
metode ada di bawah lipatan, dan field Nama Lengkap menambah friksi tanpa
nilai untuk barang digital.

## Tujuan
Samakan struktur checkout ke pola Sekalipay dengan 1 alur untuk mobile &
desktop: **Ringkasan (collapsed, 1x) → ① Metode → ② Data (WA+Email) →
S&K → 1 CTA**, tanpa refactor API/quote.

## Ruang Lingkup
- `src/app/checkout/page.tsx`: urutan blok, ringkasan 1x/viewport, CTA
  1x/viewport, hapus field Nama, email selalu wajib, auto-select QRIS,
  copy hint WA/Email ala Sekalipay.
- `src/app/api/orders/route.ts`: `customer_name` opsional (fallback turunan
  email/WA), `customer_email` wajib (khusus web; kanal TG/WA tidak lewat
  route ini — mereka memakai `createChannelOrderAtomic` langsung).
- `tests/checkout-integrity.regression.test.ts`: update guard layout +
  guard baru anti-regresi.
- Docs: `docs/PRD.md` (FR-S5), `docs/DESIGN.md` (§5.0), `docs/ARCHITECTURE.md`
  (§flow checkout), `README.md` (bagian checkout), `CHANGELOG.md`.

## Di Luar Scope
- Voucher/promo ala Sekalipay (batch terpisah).
- Mengubah kolom DB / migrasi (kolom `customer_name` tetap NOT NULL, diisi
  fallback dari server).
- Mengubah jalur Telegram/WhatsApp order.
- Menghidupkan kembali E-Wallet/Bank (tetap maintenance).

## Area / File Terkait
- `src/app/checkout/page.tsx` (utama: `paymentBlock`, `agreeBlock`,
  accordion mobile, `aside` rail, sticky CTA, `submit`, state `name`)
- `src/app/api/orders/route.ts` (schema zod `customer_name`/`customer_email`)
- `tests/checkout-integrity.regression.test.ts` (guard Batch C)
- Tidak disentuh: `src/app/pesanan/[code]/page.tsx` (pakai `order.name`,
  fallback tetap tampil benar), `lacak-pesanan-client.tsx` (sudah fallback
  "—"), `src/lib/commerce.ts`, TG/WA handlers.

## Risiko
- Fallback `customer_name` turunan email prefix bisa < 3 karakter — aman
  karena batas min-3 hanya di zod web yang dilonggarkan; DB tidak punya
  constraint panjang.
- Dua checkbox S&K (mobile `lg:hidden` + rail `hidden lg:block`) berbagi
  satu state `agreed` — hanya 1 terlihat per viewport; risiko rendah.
- Auto-select QRIS: hanya saat `pmQris` ada dan `method===null`; tidak
  menimpa pilihan user saat maintenance dicabut (pilihan manual tetap menang
  karena effect hanya jalan saat method null).

## Langkah Implementasi
1. Checkout page: pindah `paymentBlock` ke kolom kiri paling atas (①);
   Data Pembeli jadi ② (WA → Email saja); box Verifikasi jadi info tanpa
   nomor di bawah metode.
2. Hapus input + state + validasi `name`; payload `customer_name` = prefix
   email / "Pembeli Axvara"; localStorage ikut fallback.
3. Email selalu wajib (validasi + schema API), copy hint WA/Email baru.
4. Auto-select QRIS via effect saat quote diterima.
5. Ringkasan rail → `hidden lg:block`; CTA rail → desktop-only; S&K rail →
   desktop-only + salinan `lg:hidden` di kolom kiri; sticky CTA tetap
   mobile-only. Satu handler `submit`, `submitCount` tetap 2.
6. Komentar penanda test ("Action rail kanan", "Kiri — DATA + EKSPEKTASI",
   "Ringkasan accordion", "Sticky bottom CTA") dipertahankan.
7. Update test guard + docs + changelog; vitest hijau; verifikasi dev.

## Rencana Test
- `npx vitest run tests/checkout-integrity.regression.test.ts` + suite penuh.
- Guard baru: tidak ada "Nama lengkap"/"checkout-name" di checkout page;
  email wajib di schema API; auto-select effect ada; rail ringkasan/CTA
  punya `hidden lg:`.
- Manual: mobile 360px (1 ringkasan, Metode→WA→Email→S&K→1 sticky CTA),
  desktop 1280px (rail tampil, accordion hilang); submit tanpa nama lolos;
  email kosong ditolak; QRIS terpilih otomatis.

## Kriteria Selesai
- 4 anomali tertutup di kedua viewport; test hijau seluruhnya; dev
  GET / 200 + CSS 200 + visual route checkout diperiksa; CHANGELOG +
  PRD/DESIGN/ARCHITECTURE/README ter-update; commit + push main.
