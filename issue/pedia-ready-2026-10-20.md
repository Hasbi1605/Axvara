# Pedia IndoSMM — bukti kesiapan 20 Oktober 2026

Keputusan owner: seluruh penjualan SMM baru memakai IndoSMM; tools premium Canva/Gemini/CapCut dikecualikan. Spesifikasi: [IndoSMM-only](../docs/pedia/indosmm-only-2026-10-20.md). Publikasi melalui push main dan CI; hasil lokal tidak membuktikan deploy selesai.

## Implementasi dan kurasi

- Kebijakan server di katalog/prices/quote/orders/admin dan shortlist: hanya IndoSMM untuk penjualan/mapping baru. Quote ProviderSMM tanpa checkout tersimpan mendapat 409 `provider_retired` sebelum uang/order; checkout tersimpan tetap ditemukan lebih dahulu. ProviderSMM transport/dispatch/status/refill/recovery lama dipertahankan.
- Manifest 53 kebutuhan baru + 7 kebutuhan pengganti / 61 mapping IndoSMM; 18 platform tambahan, registri 34 platform. Canva/Gemini/CapCut, input custom/subscription/live khusus dan nama/target ambigu tidak dipublikasikan melalui ekspansi ini.
- Migrasi 0073 aditif; disable penjualan tier ProviderSMM, bukan penghapusan. Slug/draf owner, tier IndoSMM existing dan order/snapshot lama tidak ditulis ulang. Harga/aktivasi memakai mirror saat diterapkan. Tier baru pending/nonaktif sampai harga selesai; provenance pemulihan menjaga retry setelah interupsi. Quote Threads dan Share Video Facebook pensiun bila tanpa mapping IndoSMM aktif.
- Pembacaan API akun: 4.395 layanan, IDR, saldo Rp0. Deskripsi dan rate/bounds/API flags dibaca tanpa order supplier. Beberapa deskripsi kosong; manifest menandai bukti nama Default secara eksplisit. Tidak ada bukti empiris drop/delivery, dan seluruh tier ekspansi baru refill0.
- Simulasi migrasi pada salinan non-PII katalog produksi: 55 → 108 definisi produk, 61 tier baru, 106 produk dapat ditawarkan / 34 platform, seluruh supplier aktif IndoSMM. Dua kebutuhan pensiun; tier IndoSMM owner tidak berubah. Ini hasil simulasi, bukan jumlah live yang dijamin setelah CI.

## Verifikasi aktual

- `npx vitest run --run`: **2.900 test / 236 file lulus**. Termasuk SQLite + workerd migrasi aktual, retry sesudah tiga titik interupsi, duplicate draf owner, FK/snapshot/ID supplier lama, active-legacy bypass katalog/prices/quote, penolakan quote lama sebelum debit/ledger/invoice, retry checkout historis, admin forced mapping/activation, premium-tool guard dan refill sesuai provider asal.
- `npx tsc --noEmit`: lulus. `npm run lint`: lulus, warning existing di area lain.
- Obscura CDP: bundle React aktual melalui proxy fixture inert (semua mutasi API ditolak, tidak ada supplier/payment write). Katalog desktop, Roblox mobile/order, Lazada batas maksimum500, Audiomack kelipatan1000, Shopee produk versus toko, Share Facebook feed versus Reel, admin default IndoSMM dan Kurasi Indo-only diperiksa. Tidak ada exception runtime atau overflow horizontal pada skenario tersebut.
- Screenshot katalog/Roblox/Lazada/admin layanan/admin Kurasi nonblank dan diperiksa. Evaluasi DOM mengonfirmasi input/checkbox; renderer Obscura memiliki keterbatasan paint nilai input/SVG/sticky tertentu, sehingga screenshot bukan bukti identik untuk semua browser.
- Dev langsung `/`, `/pedia`, `/admin` HTTP200 dan CSS200; tidak ada compile error. Route konfigurator ekspansi HTTP200 melalui fixture inert yang menyajikan salinan hasil migrasi kepada bundle aktual. D1 dev belum menjalankan 0073, sehingga deep link baru langsung ke port3000 masih404; migrasi produksi diserahkan ke CI. Data fixture bukan bukti migrasi produksi sudah berjalan. CLI Obscura pada SSR `/pedia` memperlihatkan warning hydration atribut namespace SVG Lucide (`xmlns` versus `:xmlns`), keterbatasan renderer; pengujian CDP tidak mencatat exception runtime.
- `NEXT_PUBLIC_PAYMENTS_MAINTENANCE=false npm run build:pages`: lulus exit0, Next build dan next-on-pages selesai. Ini build lokal; tidak melakukan deploy manual.

## Batas dan operasional

Tidak ada top-up, paid supplier order, aktivasi gate/env atau deploy proxy/manual dalam tugas ini. Saldo IndoSMM Rp0 saat audit berarti fulfillment nyata memerlukan pendanaan; rekomendasi sampling dua supplier 19 Oktober sudah historis. Format contoh URL dibatasi pada host/rute yang didukung; share-link pendek/redirect dan custom domain yang belum didukung ditolak, bukan ditebak. Skor AI/dashboard supplier bukan jaminan kualitas dan tidak diimpor sebagai rating AXVARA.

Setelah push diterima, PM berhenti sesuai AGENTS; status CI/deploy belum dipantau. Rollback melalui rilis CI yang ditinjau; jangan menghapus order/snapshot atau state idempotensi supplier.
