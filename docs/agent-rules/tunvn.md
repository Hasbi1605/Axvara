# Aturan agent — Supplier TUNVN PREHUB (reseller Telegram)

## Revisi owner 10 November 2026: hapus bundle Buff lama dari editor

- Hanya Buff per1B yang ditawarkan; bundle5/10/20/30B tidak muncul lagi pada
  kedua endpoint daftar varian editor admin. Akun Muse asli tetap tersedia.
- ID/baris bundle nonaktif tetap arsip demi FK dan snapshot pesanan historis;
  jangan hapus fisik, aktifkan ulang, atau mengubah status Buff1B dalam cleanup.
- Filter hanya empat SKU retired, bukan semua varian nonaktif. Tanpa migrasi
  atau mutasi produksi; publikasi lewat CI, deployment belum diverifikasi.

## Revisi 10 November 2026: T2B dispatch (implementasi LOKAL, belum publikasi)

- Migrasi0116 menambah `tunvn_order_links` UNIQUE(order_code,item_index), lease
  CAS90detik, fence `request_sent_at`, receipt terenkripsi dan link item;
  `orders.supplier_purchase_disabled=1` untuk invoice tes admin. Hanya paid
  Market web/Telegram dan opt-in versi1 baru dengan snapshot `cost_usdt` total
  positif yang boleh membeli. Stamp lama tanpa biaya tidak di-backfill.
- Factory web/Telegram mengikat biaya sumber/config atomik; preflight enkripsi,
  identitas aktif, stok, harga, fundable dan saldo USDT sebelum POST. Biaya
  tersimpan di link, bukan rebuild `order_item_costs`. API tidak mendukung
  max_price/idempotency; race harga/saldo sesudah preflight tetap mungkin.
- Fence disimpan sebelum fetch, tanpa retry transport. Timeout/body rusak/5xx/
  receipt hilang menjadi needs_admin, bukan pembelian kedua/refund/deposit.
  Docs resmi hanya memberi uraian409, bukan payload/kode mesin yang tepat:
  **409 juga needs_admin, nol replay otomatis** sampai kontrak no-charge dapat
  diverifikasi (tetap di bawah ceiling3; jangan menebak pesan Inggris/Vietnam).
- Semua response pembelian yang terbaca disegel utuh sebelum parsing, termasuk
  parsial/bonus/error; raw plaintext tidak disimpan atau dilog. Receipt lengkap
  sejumlah dibeli masuk snapshot fulfillment terenkripsi/pipeline email PIN6,
  c1 dan Telegram privat existing. Parsial needs_admin; ekstra tetap terenkripsi
  hanya admin, bukan kebijakan bonus pembeli baru. Receipt durable dapat diproses
  ulang tanpa POST. Key/DB hilang sesudah charge tetap fenced, perlu admin.
- Buff200/202+batch hanya processing; GET status harus cocok batch/order/code/
  qty/currency tersimpan sebelum done. pending dipoll sekali/invocation dengan
  jeda1menit; failed/needs_check memerlukan admin tanpa rebuy. Penyelesaian
  noncredential/notis putih-label tanpa nilai kode atau PIN/kredensial palsu.
- Paid scheduler memproses maksimal1 link TUNVN; sisa job `tunvn_orders` pada
  router lite/Worker menit existing, budget40 statement, tanpa timer/env baru.
  Generic delivery tidak mengambil baris supplier pending sebagai manual.
- `/api/admin/tunvn/orders` GET authenticated/no-store:100 link terbaru, biaya,
  status, ID tepat dan metadata receipt tanpa input/ciphertext. POST `reconcile`
  hanya GET batch Buff yang diketahui; POST `reveal` privat melalui requireAdmin
  + audit otorisasi existing. Tidak ada tombol/API buy/retry atau auto-match
  history supplier. Admin memeriksa kasus tanpa ID di luar alur otomatis.
- Belum commit/push/deploy/migrasi remote atau transaksi produksi. PM memiliki
  full suite/build dan T3 QA browser; bukti fokus ada di T2B-evidence.md.

## Histori T2A 10 November 2026: katalog/input (lokal saat T2B masih pending)

- Keputusan ini mengganti snapshot split/nonaktif 9 November hanya pada kontrak
  terkait. Satu produk publik **ChatGPT Private**, slug `chatgpt-tunvn`, varian
  Business/GPay 1 bulan. SKU/ID/harga/histori lama tetap; migrasi 0114 hanya
  memindahkan relasi dan memensiunkan produk duplikat, tanpa menghapus order.
  Nama supplier/SKU internal tidak dikirim ke pembeli (slug disetujui owner).
- Awal tetap nonaktif. Admin Produk dapat mengaktifkan produk beserta varian
  awal; panel TUNVN mengatur satu saklar produk bersama dan permintaan terbit
  per varian. Varian yang dimatikan tidak mematikan saudara aktif; publish
  menghormati status, copy dan harga override admin, bukan mengaktifkan massal.
- Muse account asli tidak diubah. Buff baru hanya `TUNVN-BUFF-1B`, jumlah 1..30
  berarti 1..30B untuk satu kode; markup 40%, pembulatan Rp100 **per unit**
  (Rp1.500/unit pada FX18.086), tanpa diskon 30B. Empat SKU bundle lama hanya
  nonaktif; ID, harga override dan snapshot historis tidak dihapus/dibeli ulang.
- Migrasi 0115 menambah `buyer_field_key`/`max_qty` varian dan `buyer_fields`
  keranjang Telegram. Preset generik default NULL/off, awal hanya Buff1B:
  `muse_invite_code`, enam ASCII alnum, trim, case-preserving. Editor varian
  dapat menghidupkan/mematikan preset; bukan form builder/regex arbitrer.
- Web meminta satu kode checkout dan quote baru setelah perubahan kode.
  Server mengikat config/nilai/qty agregat ke quote dan reservasi atomik.
  Telegram meminta kode hanya di private chat; callback/notis tidak memuat
  nilainya. WA menolak varian yang memerlukan input sebelum order/invoice.
  Kode hanya tersimpan di cart Telegram/snapshot order privat; tidak masuk
  daftar publik, URL, log atau email. Detail admin authenticated/no-store
  membaca nilai; daftar order/admin dan buyer status meredaksinya.
- NEW order saja memperoleh `tunvn_eligibility` versi1 server-side dengan kind,
  source product/variant/unit dan quantity immutable. Stamp client dibuang;
  order lama, bundle lama dan Muse account dasar tidak di-backfill/dispatch.
- Otomatisasi setelah paid disetujui owner tetapi **T2B belum diimplementasikan**
  pada paket ini; fulfillment masih manual. T2B wajib pagar durable sebelum
  POST, fail-closed saat ambigu dan receipt akun terenkripsi. Bukan izin
  tes transaksi/deposit produksi. Tidak mengubah env/secret/cron/payment rail.
- Status bukti: lokal saja; focused tests/tsc/lint di evidence T2A. PM memiliki
  full suite/build dan QA browser fixture sebelum publikasi; belum klaim live.

## Revisi owner: semua TUNVN nonaktif + kontrol penuh panel — 9 November 2026

- Owner bertanya apakah katalog sudah tampil publik dan meminta **di-disable
  dulu**. Jawaban terbukti: migrasi 0112 belum pernah diterapkan ke D1
  produksi (query read-only: produk ChatGPT TUNVN + varian `TUNVN-*` tidak
  ada; katalog publik 94 item tanpa TUNVN), jadi belum tampil — tetapi seed
  awal 0112 tadinya `is_active=1`, sehingga sebelum CI menerapkan 0112/0113
  seed direvisi nonaktif dan migrasi **0113** memaksa semua baris TUNVN
  nonaktif sebagai pengaman.
- Kontrol admin kini setara kebutuhan WR/SK untuk scope TUNVN: per produk
  mirror admin dapat mengatur **markup %**, **nama publik**, **deskripsi
  publik** (kolom `tunvn_products.admin_*`, tidak ditimpa sync), serta dua
  saklar **Diminta terbit** (`publish_requested`) + **Produk aktif** (harus
  keduanya menyala agar tampil). Produk tanpa pemetaan terbit (selain ChatGPT
  #86/#83) hanya bisa diatur markup/nama/deskripsinya dan tetap tersembunyi.
- `publishTunvnCatalog` tidak pernah memaksa aktif: membuat produk/varian
  nonaktif, menghormati markup/copy/harga manual admin, dan mematikan produk
  yang permintaan terbitnya dicabut. Harga ChatGPT dihitung ulang dari modal
  × FX segar × markup admin; PATCH panel memakai FX tersimpan terakhir.
- Buff: per varian admin dapat mengatur markup, harga manual
  (`tunvn_admin_price_idr`, kosong = rumus), label, dan status aktif lewat
  `/api/admin/tunvn/buff/[sku]`; harga manual + status aktif bertahan dari
  publikasi ulang. PATCH produk: `/api/admin/tunvn/products/[id]`
  (id = supplier_product_id, requireAdmin, zod strict).
- Fleksibilitas yang SENGAJA belum setara WR/SK: antrean order/rekonsiliasi,
  aturan markup massal berbasis modal, audit modal supplier, dan dispatch
  otomatis — belum ada karena TUNVN belum punya dispatch (`/api/buy`,
  `/api/buff/order` belum dibangun) dan saldo wallet masih kosong.

## Aktivasi katalog + panel admin — 9 November 2026 (instruksi owner, mengganti batas setup awal)

- Owner menyetujui markup **ChatGPT 35%** dan **Buff Token Muse AI 40%**,
  memerintahkan katalog ChatGPT diterbitkan, Buff menjadi varian produk Muse
  manual owner, panel admin TUNVN dibuat, supplier digabung ke dropdown
  sidebar, dan API dipasang di Pages agar siap order. Batas lama "jangan
  tampilkan produknya" di bawah diganti HANYA untuk scope ini: produk TUNVN
  lain tetap tersembunyi.
- Kurs acuan hitung 9 Nov 2026: **USDT Rp18.086** (CoinGecko Rp18.091,
  Pintu Rp18.090, CoinMarketCap Rp18.086,3, INDODAX Rp18.071). Rumus
  `src/lib/tunvn/pricing.ts`: jual = ceil Rp100 (modal USDT × kurs ×
  (1+markup)). Publikasi ulang memakai FX snapshot AXVARA segar
  (`loadCurrentFxSnapshot`), fail-closed tanpa kurs.
- Harga terbit awal (kurs 18.086): ChatGPT Business 1M (TUNVN #86, 4,60
  USDT) **Rp112.400**; ChatGPT GPay (TUNVN #83, 4,96 USDT) **Rp121.200**;
  Buff (modal probe `/api/buff/check` 0,0588 USDT/1B): 5B **Rp7.500**, 10B
  **Rp14.900**, 20B **Rp29.800**, 30B **Rp44.700**.
- Gambar produk ChatGPT TUNVN memakai aset existing yang sama dengan produk
  ChatGPT AXVARA dari WR (id 12) dan SK (id 85) yang sedang nonaktif:
  `/r2/products/f87f491ee2f9034845db18eb08c9236d.webp` (konfirmasi owner +
  query D1 read-only 9 Nov 2026). Jangan membuat/mengunduh logo baru.
- Buff adalah varian baru produk manual owner **Muse AI 1 Miliar Token**
  (slug `muse-ai-1-miliar-token`, D1 id 112): SKU `TUNVN-BUFF-{5,10,20,30}B`
  dengan kolom `product_variants.tunvn_*` (migrasi 0112). Varian lama produk
  itu tidak diubah.
- Migrasi `0112_tunvn_catalog_publish.sql`: kolom link/harga di
  `tunvn_products` + `product_variants.tunvn_*`, seed produk
  `chatgpt-business-1-bulan-tunvn` + `chatgpt-gpay-1-bulan-tunvn` (kategori
  ai-chatbot, aktif) beserta varian `TUNVN-86`/`TUNVN-83`. `publishTunvnCatalog`
  (panel admin) menyinkronkan mirror lalu menerbitkan ulang secara idempoten.
- Panel admin: section `tunvn` (sidebar kini grup **Supplier** dropdown:
  Warung Rebahan, Sekalipay, TUNVN, WR vs SK, Link Supplier). Komponen
  `TunvnManager` (tab Ringkasan/Katalog ChatGPT/Buff Muse/Publikasi) +
  API `/api/admin/tunvn/{products,balance,buff,publish}` (semua requireAdmin).
- Env Pages DIPASANG 9 Nov 2026 sebagai `secret_text` (production+preview):
  `TUNVN_API_KEY`, `TUNVN_BASE_URL`, `TUNVN_ENABLED=true`,
  `TUNVN_SYNC_ENABLED=true` (total env 75→79). Berlaku pada deployment CI
  berikutnya. Kredensial lokal tetap `.tunvn-credentials`; jangan echo.
- **Batasan order**: belum ada dispatch otomatis TUNVN — `POST /api/buy` dan
  `POST /api/buff/order` belum diimplementasikan; produk terbit ber-fulfillment
  manual dan saldo wallet TUNVN saat aktivasi 0 VND / 0,0099 USDT. Isi saldo
  dan bangun dispatch (pola klaim durable supplier existing) sebelum
  mengandalkan order otomatis; jangan POST tulis untuk QA.
- Probe Buff 9 Nov 2026: `/api/buff/check` 10B/20B konsisten 0,0588 USDT/1B
  (390 VND/1B), `fundable:true`; invite contoh dokumentasi sempat gagal
  ambil harga sekali — probe panel bersifat best-effort bertanda stale.

## Setup awal — 9 November 2026 (fondasi tersembunyi, belum aktif)

- Owner memberi API key reseller TUNVN PREHUB (bot Telegram, 42.033 monthly
  users; admin @tunvn2002) dan dokumentasi
  `https://tunvnmmo.duckdns.org/api/docs`, dengan instruksi eksplisit:
  **setup dulu saja, jangan tampilkan produknya**. Keputusan ini TIDAK diganti
  oleh snapshot/probe di bawah; produk TUNVN hanya boleh tampil setelah
  instruksi owner berikutnya.
- Kredensial lokal: `axvara/.tunvn-credentials` (git-ignored
  `.tunvn-credentials*`, chmod 600) berisi `TUNVN_API_KEY` +
  `TUNVN_BASE_URL`. Jangan commit/echo nilainya, jangan salin ke
  browser/bundle publik/docs. Env Pages BELUM dipasang pada setup awal;
  kelak wajib `secret_text`: `TUNVN_API_KEY`, opsional `TUNVN_BASE_URL`,
  dan flag di bawah.
- Gate berlapis, semuanya default mati: `isTunvnEnabled()` hanya
  `TUNVN_ENABLED==="true"`; `isTunvnSyncEnabled()` juga mensyaratkan
  `TUNVN_SYNC_ENABLED==="true"`; `isTunvnConfigured()` tambahan mensyaratkan
  key non-kosong + base URL HTTPS valid. Tanpa konfigurasi lengkap, client
  dan sync no-op total tanpa fetch.
- Kode setup awal: klien read-only `src/lib/tunvn/client.ts` (GET
  `/api/products`, `/api/balance`; parser murni), sync mirror
  `src/lib/tunvn/sync.ts`, tabel mirror `tunvn_products` (migrasi
  `0110_tunvn_hidden_catalog.sql` + `drizzle/schema.sql`). Sync SENGAJA
  tidak dipanggil route/cron/UI mana pun dan selalu menulis `visible=0`;
  cabang UPDATE tidak menyentuh `visible`. Tidak ada integrasi ke
  `products`/`product_variants`/katalog/checkout/Telegram, tidak ada
  endpoint `POST /api/buy`, `POST /api/deposit`, atau Buff Token.
- Kontrak upstream (docs dibaca + probe read-only 2026-11-09): header
  `X-API-Key`; `GET /api/products` → `{success, products[{id,name,
  price_vnd,price_usdt,discount_threshold,discount_price_vnd,
  discount_threshold_usdt,discount_price_usdt,stock,description}],
  usdt_vnd}`; `GET /api/balance` → `{success,user_id,username,balance_vnd,
  balance_usdt,usdt_vnd}`; `GET /api/rate` publik. Probe: 19 produk,
  kurs 25.494 VND/USDT, akun `Axvara_support`, saldo 0 VND / 0,0099 USDT.
  Ini bukti baca-saja tanggal tersebut, bukan saldo/katalog permanen.
- Keamanan upstream: 5 key salah dalam 60 detik memicu blokir sementara.
  Jangan menebak key, jangan retry 401/403, jangan membuat panggilan
  tulis untuk QA. `POST /api/buy` mendebit saldo wallet dan mengembalikan
  kredensial akun pada `items[]` — implementasinya kelak wajib mengikuti
  pola dispatch supplier existing (klaim durable, tanpa POST ulang saat
  ambigu), dan `items[]` adalah kredensial pembeli (lihat
  `docs/agent-rules/buyer-credentials.md`) — jangan dicatat mentah.
- Mata uang: harga upstream VND/USDT apa adanya. Jangan mengonversi
  VND→IDR atau mengarang harga jual; rumus margin/kurs adalah keputusan
  owner pada fase aktivasi.
