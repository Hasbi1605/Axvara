# AIVault Hub — keputusan owner 15 November 2026


## Arsip Produk — keputusan owner 15 November 2026 (lokal)

`products.archived_at` (migrasi0126) memisahkan Arsip dari Nonaktif. Identitas
supplier parent/varian dan relasi histori tetap disimpan: lookup sync tidak
boleh mengecualikan Arsip lalu membuat pengganti. Penulisan katalog, varian
baru, proyeksi harga/stok, aktivasi dan restock melewati parent Arsip; mirror
supplier boleh terus sinkron. Panel/editor mengembalikan409 “Pulihkan dari
Arsip dulu” saat aktivasi. Pulihkan tetap nonaktif; produk supplier tidak pernah
eligible hapus permanen. Lihat PRD “Siklus Arsip Produk” dan ARCHITECTURE “Arsip
Produk admin”. Implementasi/migrasi baru lokal; tanpa perubahan produksi.

## Family eksplisit ChatGPT Plus + slug fallback pendek — 15 November 2026 (lokal)

- Upstream menambah `service_chatgpt_plus_1m` ("ChatGPT Plus 1 Month (Apple
  Pay)") setelah peta statis, sehingga fallback membuat produk id174 dengan slug
  hex-encoded penuh dan tanpa gambar. Peta `src/lib/aivault/families.ts` kini
  memuat family eksplisit `chatgpt-plus` → nama "ChatGPT Plus", slug
  `chatgpt-plus-av`, label "Plus 1 Bulan (Apple Pay)", images
  `["chatgpt-plus-1-bulan","chatgpt-tunvn","chatgpt-sk","chatgpt-premium"]`.
- Slug fallback 1:1 sekarang `slugify(nama)` + "-" + 8 hex FNV-1a32(service id)
  + "-av" (≤80 karakter). Key `service:${serviceId}` TIDAK berubah agar identitas
  fallback lama tidak pindah. Kolisi hash32 sangat kecil; publisher memakai
  `INSERT OR IGNORE` + kepemilikan family eksplisit sehingga tidak pernah
  mengambil alih produk WR/SK/TUNVN/AIVault lain.
- Migrasi `0125_aivault_chatgpt_plus_family.sql` memindahkan HANYA baris lama
  yang tepat (`aivault_family='service:service_chatgpt_plus_1m'`, nonaktif,
  belum ada `chatgpt-plus-av`): family/slug/nama ke ChatGPT Plus, deskripsi
  diganti hanya bila masih auto-default nama lama, `image_url` diisi aset
  ChatGPT yang disetujui bila kosong, `images` menjadi JSON array berisi aset
  yang sama bila masih NULL/''/'[]', lalu label varian nonaktif menjadi
  "Plus 1 Bulan (Apple Pay)". Tidak menambah DDL/kolom atau mengaktifkan apa pun.
- Status: perubahan lokal + test; migrasi remote/deploy belum dilakukan.

## Bukti live 15 Nov 2026 — laporan PM

- PM melaporkan kode `bef50574` sudah dipush ke main dan menjalankan SATU
  pembelian Gemini Plus6M (`service_gemini_plus_6m`), qty1, external ID
  `AXV-QA-20261115-GEMINI-1`, provider ID `API1VLJZG0`. Bukti ini mengonfirmasi
  kontrak provider; tidak sendiri membuktikan status CI/deployment/env AXVARA.
  Patch kompatibilitas receipt sesudah bukti ini masih lokal, belum commit/push.
- POST pertama HTTP201: `success:true`, `order_id`, `service_id`, `quantity:1`,
  `total_cost:0.5`, `new_balance:2.0`, `currency:"USD"`, `price_breakdown`,
  `external_order_id` identik, dan `products` satu string. Produk Gemini nyata
  berupa URL redeem HTTPS (PM melaporkan panjang86karakter); nilai/URL asli
  tidak dicatat di repo, log atau fixture.
- POST identik dengan external ID yang SAMA HTTP200: `success:true`, order ID,
  service, quantity, total_cost, currency dan produk identik, `new_balance:2.0`,
  `idempotent_replay:true`; **tanpa external_order_id dan price_breakdown**.
  Saldo2.5→2.0 hanya sekali: idempotensi dikonfirmasi live oleh PM, bukan sekadar
  fixture. Replay tersebut bukan pembelian kedua; izin tes berbayar sudah dipakai.
- GET `/api/v1/order/API1VLJZG0` HTTP200: `order_id`, `status:"delivered"`,
  `service_id`, `quantity:1`, `total_cost:0.5`, `currency:"USD"`, `created_at`,
  dan produk yang sama; tidak membutuhkan success/external_order_id.
- Quote nyata mengirim `custom_pricing:null`. Parser existing menerima null
  seperti false/field absen, tanpa price_conflict, selama guard lain lulus.
- Validasi POST menerima external ID yang cocok, atau field external ID yang
  benar-benar absen DAN `idempotent_replay===true`. Nilai yang hadir tetapi
  berbeda/null tetap mismatch. Jika provider ID sudah tersimpan, order ID harus
  sama untuk POST maupun GET; service/jumlah/USD/biaya positif dan kecukupan
  products tetap wajib. Receipt penuh tetap disegel sebelum interpretasi.
- Writer hanya memakai fixture palsu untuk patch ini; tidak membuat pembelian,
  replay, polling atau panggilan provider nyata tambahan.

Histori sebelum publikasi `bef50574` (bukan status main saat ini):

Status: implementasi lokal di worktree `feat/aivault-supplier`; commit WIP lokal
dibuat PM, resolusi rebase ke main belum di-stage/continue oleh writer. Belum
push, migrasi remote, konfigurasi Pages, atau deployment. Migrasi0123 tetap
untuk TUNVN; AIVault memakai0124. Perilaku TUNVN dan AIVault dipertahankan pada
integrasi bersama; source dispatcher TUNVN tidak diubah.

- Supplier terpisah: `https://reseller.aivaulthub.store`, dokumentasi `/api/v1/docs`,
  header `X-API-Key`. Kredensial sumber lokal `/Users/macbookair/axvara/.aivault-credentials`
  (`AIVAULT_API_KEY`, `AIVAULT_BASE_URL`), ignored `.aivault-credentials*`, chmod600.
  Jangan cetak key, body provider, atau kredensial pembeli; jangan menyalin key ke
  tracked file/browser. Base URL wajib HTTPS; redirect tidak diikuti.
- Env Pages kelak **secret_text**: `AIVAULT_API_KEY`, `AIVAULT_BASE_URL`
  (default domain di atas), `AIVAULT_ENABLED`, `AIVAULT_SYNC_ENABLED`. Default
  dua flag mati; konfigurasi tidak lengkap berarti tanpa fetch. Pemasangan env
  mengikuti backup lokal/password manager dan §16.2; belum dilakukan tugas ini.
- Semua produk supplier masuk mirror/admin Produk; produk AIVault terpisah dari
  WR/SK/TUNVN. Produk/varian baru **nonaktif**, sync tidak pernah mengaktifkan.
  Parent `source='manual'`, `fulfillment_mode='manual'`, `telegram_enabled=1`.
  `products.aivault_family`, varian `aivault_service_id` dan SKU `AV-<service_id>`
  menjaga identitas. Nama/deskripsi/kategori/gambar ditulis sekali; selanjutnya
  milik admin. Label dan status aktif juga tidak ditimpa sync.
- Family statis: Adobe Express6/12bulan; Gemini Plus6bulan; Apple Music5bulan;
  Notion Education Plus12bulan; Udemy1bulan. ID tak dikenal menjadi satu family
  per service, slug memakai nama + suffix ID injektif. Gambar memakai produk
  AXVARA existing (termasuk nonaktif) dari kandidat eksplisit, bukan unduhan baru.
- USD≈USDT memakai **snapshot FX AXVARA**, fail-closed bila FX tidak tersedia.
  Harga katalog = tier qty1 × FX ×1,35, ceilRp100; markup awal35%, admin dapat
  override markup/manual per varian. Harga upstream INR bukan FX USD/IDR.
  Upsert mirror memakai json_each chunk50; publisher memakai jumlah statement
  tetap dan CAS input harga admin/markup. Lease90detik + throttle2menit disimpan
  pada store_settings; cron katalog tiap3menit, budget40 existing.
- GET `/api/v1/me`, `/products`, `/quote?service_id&quantity`, `/order/{id}`;
  POST `/api/v1/order` **hanya dispatcher paid web/Telegram** dengan
  `{service_id,quantity,external_order_id}`. External ID tetap
  `<order_code>-<item_index>`, unik dan tidak pernah diganti. Tidak memakai
  `accept_normal_price`; tidak mengimplementasikan key rotation/webhook.
- `aivault_eligibility` version1 dibuat server pada order BARU dari identitas
  SKU/service/family, source variant, jumlah dan biaya USD saat order dibuat.
  Admin payment test tidak mendapat marker, supplier_purchase_disabled tetap
  otoritatif. Marker dihapus dari respons buyer/admin list umum, bukan backfill
  order lama. Proof c1/p1, PIN dan akses kredensial mengikuti aturan existing.
- Preflight: enkripsi tersedia, identitas/aktivasi varian+parent masih sama,
  quote identitas/currency/jumlah benar, stok cukup, sufficient_balance=true,
  tidak membutuhkan normal-price override. Quote normal boleh menghilangkan
  custom_pricing (bentuk GET aktual15Nov). **custom_pricing=true/shape custom
  belum dapat dibuktikan aman: needs_admin**, bukan opt-in harga normal.
- Lease/CAS/sent fence dan increment attempt persisten sebelum POST. Semua
  response penuh dienkripsi sebelum JSON dibaca, termasuk error/partial.
  Receipt koheren dan products cukup → kredensial qty yang dibeli digabung
  `\n\n`, dienkripsi pada fulfillment_items dan dikirim pipeline existing.
  Extra credentials tetap hanya pada receipt privat admin. Tidak menambah
  notifikasi processing khusus supplier; delivery existing tetap digunakan.
- Queued → processing, GET exact provider_order_id minimal1menit sekali per
  invocation, tanpa beli lagi. Failed/partial/identity mismatch → needs_admin.
  402 insufficient_balance;409 price_conflict;400/401/403/404 → needs_admin.
  Timeout/5xx/429/invalid JSON pasca-send boleh replay **external ID yang sama**,
  maksimum3POST total, backoff2/4menit. Fence tidak dihapus; amount/jumlah tidak
  diubah. Pada replay sesudah fence, quote stok/saldo tidak diulang karena
  debit sukses sebelumnya dapat menghabiskannya; idempotensi provider adalah
  dasar keamanan replay. Snapshot, paid/disable, ownership dan identitas aktif
  tetap diperiksa. Admin retry hanya needs_admin pra-send/attempt0 yang aman.
- Admin Supplier→AIVault: Ringkas, Antrean100link, Markup per family, Alat sync.
  Semua API requireAdmin; input mutasi zod strict + body limit; reveal receipt
  POST privat/no-store melalui audit requireAdmin. UI memakai Promise.allSettled
  supaya kegagalan saldo tidak mengosongkan katalog; tampilkan bagian+HTTP status.
- Histori izin: owner mengizinkan **SATU pembelian nyata Gemini Plus6M**, **oleh
  PM sesudah deployment**, bukan oleh code writer. Izin sudah dipakai PM pada
  15Nov2026 sesuai bukti di atas; writer tetap hanya fixture untuk patch ini;
  jangan memanggil endpoint tulis provider, deploy atau migrasi remote untuk QA.
  Izin ini tidak mencakup pembelian produk lain atau pengulangan tes berbayar.
