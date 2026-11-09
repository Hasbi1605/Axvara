# Aturan agent — Supplier TUNVN PREHUB (reseller Telegram)

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
