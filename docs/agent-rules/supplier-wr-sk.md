# Aturan agent — Supplier WR/SK, proxy VPS, dispatch

> Dipindah utuh dari `AGENTS.md` pada 2 November 2026 tanpa perubahan isi. Aturan di sini tetap berlaku (keputusan owner bertanggal); baca sebelum menyentuh area terkait. Indeks ada di `AGENTS.md` bagian "Aturan per area". Rujukan "di atas" menunjuk bagian lain di file asal; cari di file `docs/agent-rules/` lain.

- `products.description_en` (migrasi 0103) adalah kolom **admin-owned**: sync WR/SK tidak boleh menulisnya dan `WR_OWNED_PRODUCT_FIELDS` tidak memuatnya. Seed EN (0104) hanya mengisi baris yang masih NULL; jangan pernah menimpa suntingan admin atau menganggapnya field supplier.

## WR Jaspay - 2 November 2026
- Dokumentasi resmi tetap base `/api/v1`; jangan menebak `/api/v3`. Jaspay adalah keluarga terpisah dari Akun Premium. Proxy mendukung `POST /wr/jaspay/{products,order,status,orders}` dengan token/key existing; rilis VPS2November terverifikasi health/hash, bukan bukti deployment Pages/transaksi nyata.
- Jangan memindahkan order Premium lama atau mencocokkan invoice dari nama/waktu/feed50terbaru. Identitas Jaspay memakai namespace `jaspay:` di mirror/link WR existing; stok available=-1 adalah unlimited, bukan `max_quantity`. Sweep/diff Premium tidak boleh menonaktifkan namespace Jaspay. Maksimum jumlah harus valid dan ditegakkan server-side termasuk baris keranjang ganda.
- `ref_id` supplier wajib stabil per idempotency key; missing receipt hanya boleh mengulang POST Jaspay dengan ref dan input persis sama berdasarkan kontrak duplicate-ref, bukan membeli ulang Premium. Invoice JSP diketahui hanya diperiksa melalui Jaspay status; lease/CAS/budget/sent fence existing dipertahankan.
- HMAC webhook `X-Digitals-Signature` memverifikasi body mentah; primary invalid tidak boleh fallback ke alias legacy. Event Jaspay memakai `data.invoice`. Partial/malformed credentials tetap terenkripsi untuk tindak lanjut admin, tidak menyelesaikan seluruh item, membeli ulang atau otomatis refund buyer. Teks pembeli white-label: Diproses otomatis, bukan admin/manual atau stok instan.
- Rilis proxy harus seluruh dist dengan backup serta env/state utuh. Backup VPS tugas ini `dist.backup-jaspay-20261102`; source lokal pra-tugas dipertahankan, tidak stage/commit perubahan pihak lain tanpa izin.

## WR timeout receipt — 27 Oktober 2026
- Missing-ID setelah timeout tidak boleh diikat otomatis lewat produk/waktu: WR
  tidak memberi korelasi request, akun supplier juga dapat digunakan manual.
  Admin memilih invoice lewat sync-now/SupplierLinkActions; exact-ID, identitas
  varian atau metadata mirror unik, qty/modal/paid serta CAS pemilik diperiksa.
- request_sent_at wajib durable sebelum POST; late result/error tidak menurunkan
  terminal. Rekonsiliasi known-ID tetap budget40 dengan delivery durable existing.
  Webhook terminal unmatched503, bukan ACK sukses tanpa persist. Feed WR50 terbaru
  tanpa zona/variant_id tetap didukung lewat pemilihan invoice eksplisit, bukan
  tebakan zona. Tidak membeli ulang saat invoice hilang atau di luar feed.

Proxy WR/SK — 26 Oktober 2026: dispatcher egress dipakai bersama dan ditutup
saat shutdown; URL proxy terkonfigurasi yang invalid menghentikan startup.
VPS tanpa URL proxy memakai IP tetapnya secara langsung. Diff removal WR/SK
dipotong terpisah maksimal 200 ID per request, hanya ACK sukses memajukan
snapshot; sisa ID dan payload induk berubah tetap pulih setelah restart.
Validasi body menghitung byte UTF-8, path SK menolak traversal. Rilis wajib
menyalin seluruh `dist/` (index/diff-sync/psmm/psmm-diff dan modul tambahan),
backup dahulu, pertahankan `.env`, snapshot dan direktori idempotensi durable.
Tes transport memakai MockAgent tanpa jaringan; tidak menambah retry pembelian.

## Keandalan dispatch supplier — 25 Oktober 2026
- Setelah KlikQRIS paid, pekerjaan segera memakai `payments/paid-fulfillment.ts` + Cloudflare `ctx.waitUntil`; jangan mengikat POST supplier pada umur request browser. Materialisasi dan bind WR/SK mendahului fulfillment umum; immediate hanya order yang baru lunas, satu link/supplier, sisanya cron existing.
- HTTP5xx generik dan receipt tanpa order_id/invoice atau ref SK yang berbeda adalah ambigu: request_sent_at/ref_id dipertahankan, hanya rekonsiliasi. Hanya penolakan eksplisit SK PRODUCT_TEMPORARILY_UNAVAILABLE yang boleh retry biasa. Jangan mengubah404/timeout menjadi izin membeli ulang otomatis.
- Proxy WR/SK mengembalikan marker `wr_proxy_unreadable_response: network_error` / `sk_proxy_unreadable_response: network_error` untuk respons tulis2xx tak terbaca; kata network mempertahankan kompatibilitas Pages lama saat rollout. Sinkronkan kontrak di AGENTS proxy, README dan ARCHITECTURE.
- Pengujian supplier memakai fixture. Pemulihan order produksi hanya atas instruksi owner, verifikasi referensi/riwayat/debit dahulu, referensi tetap sama; jangan mencampur pemulihan dengan pengujian berbayar tambahan.
