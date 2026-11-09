# Aturan agent — Supplier TUNVN PREHUB (reseller Telegram)

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
