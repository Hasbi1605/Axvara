# AXVARA Games — Spesifikasi Produk & Desain

> **Status (9 November 2026): RENCANA; keputusan terbuka §9 sudah dijawab owner (lihat §9).** Belum ada route, komponen, schema,
> migrasi, env, dispatch, webhook, deposit atau transaksi. Dokumen ini adalah
> bahan diskusi desain dengan owner; bagian berlabel **[KEPUTUSAN TERBUKA]**
> belum disetujui. Keputusan yang sudah disetujui owner ditandai **[DISETUJUI]**.
> Ringkasan ada di `docs/PRD.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`;
> aturan supplier di `docs/agent-rules/digiflazz.md`.

## 1. Posisi produk

- **[DISETUJUI]** AXVARA Games adalah lini ketiga `axvara.tech` setelah Market
  (tools premium) dan Pedia (sosial media), dengan pola yang sama seperti Pedia:
  satu domain, layout dan navbar sendiri, footer/ekosistem bersama, order tanpa login.
- **[DISETUJUI]** Supplier: Digiflazz buyer. Seller utama Om\*\*\* plus pengisi celah;
  kode buyer `<game>[id]<nominal>` (contoh `ml86`, `mlid97`, `ff140`, `pubg60`).
- **[DISETUJUI]** Pembayaran: rail yang sudah ada di Market/Pedia — QRIS,
  Virtual Account, e-wallet (gateway Sekalipay) dan crypto (NOWPayments).
- **[DISETUJUI]** Harga jual = harga Oura Store −2%, batas bawah = modal Digiflazz
  + biaya kanal pembayaran + margin minimum 3%. SKU tanpa pembanding memakai batas
  bawah. Snapshot 9 Nov 2026: ruang FF/FF MAX median ~24%, ML ~5%, PUBG ~6%,
  Valorant ~5,5%, CODM ~8%, Genshin <1%.
- **Acuan UX: Oura Store** (ourastore.com) karena pola belinya sudah dikenal pembeli
  game Indonesia. Kita meniru **pola alur dan tata letak**, bukan aset, ilustrasi,
  banner, warna, logo atau teks mereka. Identitas visual tetap AXVARA (§6).

## 2. Ruang lingkup MVP

**[KEPUTUSAN TERBUKA]** daftar game peluncuran. Usulan bertahap:

| Gelombang | Game | Alasan |
|---|---|---|
| 1 (peluncuran) | Free Fire, Free Fire MAX, Mobile Legends, PUBG Mobile | Volume terbesar; seller matang lengkap; FF margin tinggi |
| 2 | Magic Chess Go Go, Valorant, CODM, Honor of Kings, Blood Strike, Delta Force | Seller matang ada, katalog kecil |
| 3 | Genshin, Honkai SR, ZZZ, Wuthering Waves, AOV, Super Sus, Sausage Man, Stumble Guys, Eggy Party, Undawn, Wild Rift | Margin tipis/katalog terbatas; tampil setelah pricing stabil |

Di luar MVP: joki, leaderboard, akun member/koin, voucher non-game, pulsa/tagihan.

## 3. Informasi arsitektur (rencana route)

Mengikuti pola `src/app/pedia/*`:

| Route | Isi |
|---|---|
| `/games` | Beranda Games |
| `/games/[slug]` | Halaman game (pilih nominal + bayar), mis. `/games/mobile-legends` |
| `/games/pesanan/[code]` | Pembayaran & status pesanan |
| `/games/lacak` | Lacak pesanan (kode/WA) |
| `/games/bantuan`, `/games/ketentuan` | Bantuan & S&K khusus top up |

`ServicesMenu` dan `CrossServicePromo` bertambah entri Games; footer bersama tetap satu.
Seperti Pedia (route internal `/pedia`, URL kanonis `pedia.axvara.tech`), Games memakai route internal `/games` dengan URL kanonis usulan `games.axvara.tech` — konfirmasi DNS/routing di fase G7.

## 4. Beranda `/games`

Urutan section (atas → bawah):

1. **Navbar Games** — logo AXVARA + label Games, search "Cari game…", bahasa/mata uang,
   ServicesMenu. Tanpa tombol masuk/daftar.
2. **Hero** — lihat §4.1.
3. **Populer sekarang** — 6–8 kartu game besar (ikon + nama + publisher), urutan dari admin.
4. **Tab kategori** — "Top Up Game" (MVP); tab lain disembunyikan sampai ada isinya
   (Oura menampilkan banyak tab sekaligus — kita tidak menampilkan tab kosong).
5. **Grid semua game** — ikon persegi radius 16px + nama + publisher; 3 kolom mobile,
   4 tablet, 6 desktop; "Tampilkan lainnya" seperti katalog Market.
6. **Cara top up** — 4 langkah ber-ikon (Pilih game → Masukkan ID → Bayar → Diamond masuk).
7. **Kepercayaan** — proses otomatis 24 jam, rail pembayaran (logo QRIS/VA/e-wallet/crypto),
   bantuan WA; tanpa angka rating palsu (§5.4).
8. **FAQ singkat** + footer bersama.

**Tidak ada popup saat halaman dibuka** (Oura memunculkan popup "follow channel" yang
menutup konten). Ajakan komunitas cukup di footer/pill komunitas yang sudah ada.

### 4.1 Hero — [KEPUTUSAN TERBUKA]

| Opsi | Isi | Kelebihan | Kekurangan |
|---|---|---|---|
| A. Orbit | Headline + orbit AXVARA dengan **ikon game sebagai planet** (bisa diklik) | Ciri khas paling kuat, konsisten dengan Market/Pedia, tidak butuh materi promo baru | Promo/event tidak punya tempat menonjol |
| B. Carousel | Banner promo lebar seperti Oura | Familiar bagi pembeli game, cocok untuk event/promo | Butuh desain banner rutin; tanpa materi terasa kosong; kurang khas AXVARA |
| **C. Hybrid (usulan)** | Hero orbit (Opsi A) + **carousel promo tipis** tepat di bawahnya, hanya tampil bila admin punya ≥1 banner aktif | Identitas AXVARA tetap; promo tetap punya panggung; tidak ada ruang kosong | Satu komponen lebih banyak |

Rekomendasi: **Opsi C**. Orbit memakai komponen orbit yang ada (aturan hemat mobile:
compositor-only, planet lebih sedikit ≤640px, reduced-motion statis). Headline usulan:
"Satu tempat untuk / Top up game" + typewriter cyan *Termurah / Tercepat / Terpercaya*
(pola Pedia). Carousel memakai kontrak banner carousel existing (ARCHITECTURE "Kontrak
banner carousel"), rasio 3:1 desktop / 2:1 mobile, autoplay berhenti saat interaksi,
tanpa autoplay saat reduced motion.

## 5. Halaman game `/games/[slug]`

Pola Oura dipertahankan: **header identitas game + kartu langkah bernomor di kiri +
rail ringkasan sticky di kanan (desktop) / bar bawah (mobile)**.

### 5.1 Header
- Banner game lebar (rasio ~5:1 desktop, 2.5:1 mobile) dengan overlay gradien midnight
  agar teks terbaca; tile ikon game menumpang di kiri bawah; nama game (Space Grotesk 700),
  publisher, chip: ⚡ Proses otomatis · 🕐 24 jam · 🛡 Pembayaran aman (Lucide, bukan emoji).
- "Pengiriman instan" cukup sekali di header, **tidak** diulang di setiap kartu nominal
  (Oura mengulang badge di tiap kartu sehingga kartu tinggi dan ramai).

### 5.2 Langkah bernomor (kartu glass, nomor dalam kotak gold)
1. **Data akun** — field sesuai game (ML: User ID + Zone ID; FF: Player ID; PUBG: ID;
   Genshin: UID + server). Ikon ⓘ membuka panduan "cara menemukan ID" (gambar milik
   AXVARA). Validasi format inline. **Cek nickname** otomatis setelah ID lengkap
   (produk "Cek Username" Digiflazz; tampil "Nickname: xxx ✓") sebelum pembeli membayar —
   [KEPUTUSAN TERBUKA] karena tiap cek berbiaya kecil (≈Rp5–80) dan perlu rate limit.
   Opsi "ingat ID di perangkat ini" (localStorage, opt-in).
2. **Pilih nominal** — lihat §5.3.
3. **Jumlah** — default 1, stepper kecil (pola stepper Market).
4. **Metode pembayaran** — akordeon pembayaran Market/Pedia; **harga total per metode
   sudah termasuk biaya** ditampilkan sebelum memilih.
5. **Kontak** — WhatsApp + email (pola checkout Market: wajib, hint kegunaan).
6. **Kode promo** — [KEPUTUSAN TERBUKA], sembunyikan sampai fitur promo ada.

### 5.3 Pilih nominal (perbaikan utama vs Oura)
Masalah di Oura: ML punya ±150 nominal dalam satu daftar panjang; promo dan reguler
dengan harga hampir sama tampil ganda; pembayaran tertimbun jauh di bawah.

AXVARA:
- **Grup** berurutan: Spesial (WDP/Twilight/Membership), Terlaris, Semua nominal.
- **Terlaris** (6–8 nominal pilihan admin) tampil default; "Semua nominal" dilipat
  dengan tombol "Lihat semua (N)".
- **Chip filter rentang** (≤100, 100–500, 500–2.000, >2.000) + kolom cari angka.
- Satu kartu per nominal — bila ada SKU ganda, tampilkan harga termurah yang sehat saja.
- Kartu: ikon mata uang game (diamond/UC/VP, SVG AXVARA), nominal (bonus dipisah
  "77 + 8 bonus"), harga Space Grotesk; badge gold kecil "Terlaris"/"Hemat" seperlunya.
- Kartu = radio (`role="radiogroup"`), terpilih: border cyan + glow + centang.
- Grid 2 kolom mobile, 3 kolom desktop; tinggi kartu ringkas (±72px mobile).
- SKU OFF/gangguan: abu-abu "Sedang gangguan", tidak bisa dipilih (tidak hilang diam-diam).

### 5.4 Rail ringkasan
- Desktop: kolom kanan 360px sticky — ringkasan (game, ID+nickname, nominal, metode,
  total), CTA "Bayar sekarang", tautan bantuan WA.
- **Tidak menampilkan rating/ulasan** sampai AXVARA punya data ulasan nyata
  (Oura menampilkan 4.99/9.97jt; kita tidak boleh mengarang angka).
- Mobile: bar bawah **satu baris** (nominal + total + CTA) setinggi ±64px + safe area;
  saat belum memilih cukup CTA nonaktif berlabel "Pilih nominal". Oura memakai panel
  bawah ±150px walau kosong sehingga memakan layar.
- CTA yang belum siap tidak diam: klik menggulir ke langkah pertama yang belum lengkap
  (pola validasi checkout Market).

## 6. Rasa AXVARA (yang membedakan dari Oura)

- Token tetap: midnight `#080C1E`/`#0F1430`, cyan `#00E5FF` (aksi/terpilih/fokus),
  gold `#FFB800` (nomor langkah, badge terlaris), glass `ax-glass`, Space Grotesk untuk
  judul & harga, Inter body. Oura memakai abu/krem datar — kita glass + glow.
- Orbit di hero, glow radial cyan+gold section-level seperti Market/Pedia.
- Motion Apple spring yang hemat: pilih kartu = scale 0.98→1 + glow 160ms; hormati
  reduced motion.
- Copy ringkas, bahasa santai-sopan khas AXVARA, ID/EN mengikuti preferensi bahasa
  yang sudah ada.

## 7. Aset & ikon

- Ikon UI: Lucide (outline 20px, stroke 1.75) — konsisten dengan Market/Pedia.
- Ikon/banner game: logo & key art resmi publisher hanya untuk identifikasi produk,
  disimpan di R2 dan dikelola admin; **jangan mengambil banner, ilustrasi, atau gambar
  buatan Oura**. Panduan "cara cari ID" dibuat sendiri dari screenshot game.
- Ikon mata uang (diamond, UC, VP, CP, dsb.): SVG buatan AXVARA.

## 8. Alur pesanan (ringkas; detail teknis di ARCHITECTURE)

Pilih game → isi ID (+cek nickname) → pilih nominal → pilih metode → kontak →
pesanan dibuat dengan harga terkunci → bayar → pembayaran terverifikasi → kirim ke
Digiflazz (`ref_id` unik, `max_price`) → Sukses (tampilkan SN/keterangan) / Pending
(cek ulang `ref_id` sama, webhook) / Gagal.

**[KEPUTUSAN TERBUKA]** penanganan gagal setelah bayar: refund manual via admin,
kredit AXVARA, atau coba seller cadangan otomatis. Halaman status wajib jujur
(pola status Pedia), tanpa "sukses" sebelum Digiflazz menyatakan sukses.

## 9. Keputusan owner 9 November 2026 [DISETUJUI]

1. **Hero: Opsi C hybrid** — orbit AXVARA dengan ikon game sebagai planet yang bisa
   diklik + carousel promo tipis di bawahnya hanya bila ada banner aktif.
2. **Gelombang 1:** Free Fire, Free Fire MAX, Mobile Legends, PUBG Mobile.
3. **Cek nickname sebelum bayar: aktif** (produk "Cek Username" Digiflazz). Wajib
   rate limit per IP/perangkat dan cache hasil per ID+game agar biaya cek tidak
   disalahgunakan; kegagalan cek tidak memblokir bila supplier cek sedang gangguan
   (tampilkan "Nickname belum bisa dicek, pastikan ID benar").
4. **Gagal setelah bayar: otomatis coba seller cadangan.** Digiflazz tidak punya fitur
   backup seller, jadi tiap nominal mendapat baris kedua di akun buyer dengan kode
   ber-akhiran `b` (mis. `ff140b`) yang memakai seller matang lain. Aturan: hanya
   setelah status **Gagal final** dari seller utama (bukan Pending/timeout), memakai
   `ref_id` baru yang tercatat terhubung ke pesanan yang sama, tetap dengan
   `max_price` = batas modal pesanan; bila cadangan juga gagal → status
   "Perlu tindakan admin" + notifikasi admin (refund manual). Tidak pernah dua dispatch
   aktif bersamaan untuk satu pesanan.
5. **Kode promo: menyusul** (langkah 6 disembunyikan di MVP).
6. **Aset awal disiapkan agent:** logo/ikon & key art resmi game diambil dari sumber
   resmi publisher/toko aplikasi/press kit (identifikasi produk), dioptimasi WebP dan
   disimpan di R2; **tidak** mengambil aset buatan toko top up lain (termasuk Oura).
   Ikon mata uang dan panduan "cara cari ID" dibuat sendiri.

## 10. Kriteria selesai (untuk tahap implementasi nanti)

- Desktop/mobile diperiksa di browser nyata: pilih nominal, validasi ID, metode,
  sticky bar, keyboard/fokus, reduced motion.
- Tidak ada popup saat masuk; tidak ada angka rating fiktif; total per metode benar.
- Test harga (rumus Oura −2% + batas bawah), dispatch idempoten, webhook HMAC, status jujur.
- Dokumen PRD/DESIGN/ARCHITECTURE/README/CHANGELOG diperbarui sesuai aturan repo.

## 11. Rencana kerja implementasi (brief serah terima untuk Paseo orkestrator)

Sudah dikerjakan (9 November 2026):
- Akun Digiflazz: 612 produk Games unik, 596 ON dengan kode buyer final; seller
  cadangan berkode akhiran `b` untuk gelombang 1 (lihat `docs/agent-rules/digiflazz.md`).
- `src/lib/games/pricing.ts` + `tests/games-pricing.test.ts`: rumus harga jual murni
  (`computeGamesSellPrice`, `gamesPriceFloor`) — pakai ini, jangan menulis ulang.
- Preflight baca-saja `scripts/digiflazz-preflight.mjs` lewat SSH VPS (Development OK).

Urutan fase (masing-masing satu PR/commit logis, wajib baca AGENTS.md + aturan area):

| Fase | Isi | Repo/area | Selesai bila |
|---|---|---|---|
| G1 | Proxy `/dgf/*` di VPS: allowlist eksak `POST /dgf/v1/{cek-saldo,price-list,transaction}`, header `x-proxy-token`, body diteruskan apa adanya ke `api.digiflazz.com`, timeout & error kode seperti `/skg/*` | `/Users/macbookair/axvara-wr-proxy` (cek worktree kotor milik tugas lain dulu) + `axvara-wr-proxy/AGENTS.md` | test proxy lulus; `cek-saldo` Development lewat proxy 200; tanpa `/transaction` nyata |
| G2 | Klien Digiflazz server-side (sign MD5, price-list, transaction, cek status `ref_id` sama, parser respons) + env `secret_text` | `src/lib/games/digiflazz.ts` | test kontrak dengan fixture; tidak ada key di bundle klien |
| G3 | Schema D1 + migrasi: game, SKU (kode utama/cadangan, modal, referensi Oura, harga jual), pesanan game, dispatch | `drizzle/schema.sql`, `migrations/` | migrasi lokal/remote via CI; ARCHITECTURE §4 diperbarui |
| G4 | Sinkron katalog terjadwal (cache, batas rate price-list) + hitung harga via `pricing.ts`; input harga referensi admin | cron + admin | test sinkron & harga; tidak memanggil price-list per page view |
| G5 | Order + dispatch: buat pesanan harga terkunci → rail pembayaran existing → setelah terverifikasi kirim `transaction` (`max_price`, `ref_id` unik) → pending cek ulang `ref_id` sama → Gagal final: coba kode `b` sekali → gagal lagi: "Perlu tindakan admin" | `src/lib/games/*`, `src/app/api/games/*` | test idempoten, tidak ada dua dispatch aktif, fixture `testing:true` sukses/gagal/pending |
| G6 | Webhook `POST /api/games/digiflazz/webhook` (HMAC-SHA1 `X-Hub-Signature` body mentah, idempoten) + cek nickname (rate limit + cache) | API | test signature salah ditolak, duplikat aman |
| G7 | UI `/games`, `/games/[slug]`, `/games/pesanan/[code]`, lacak/bantuan/ketentuan sesuai §4–§7 & §9; aset game resmi di R2 | `src/app/games/*`, komponen | verifikasi browser nyata desktop/mobile, keyboard, reduced motion; README/ARCHITECTURE/DESIGN diperbarui |
| G8 | Go-live: rotasi key (pernah tertempel di chat), mode Production + OTP owner, deposit kecil, satu transaksi nyata disetujui owner | owner + agent | bukti transaksi sukses; tanpa QA di produksi selain yang disetujui |

Batasan: jangan mengaktifkan webhook dashboard sebelum G6 terdeploy; jangan deposit
atau transaksi produksi tanpa izin owner; jangan mengubah seller/kode di akun tanpa
mencatat di `docs/agent-rules/digiflazz.md`.

## 12. Kontrak teknis backend (9 November 2026, implementasi bertahap)

Cakupan agent sekarang: proxy `/dgf`, klien Digiflazz, schema, sinkron katalog/harga,
dispatch + seller cadangan, webhook, cron. **Di luar cakupan (Paseo):** API buat
pesanan/quote untuk pembeli, cek nickname endpoint publik, UI, admin UI harga referensi.

### 12.1 Egress & env
- Panggilan runtime: `POST {WARUNG_REBAHAN_PROXY_URL}/dgf/v1/{cek-saldo|price-list|transaction}`
  dengan `x-proxy-token: WARUNG_REBAHAN_PROXY_TOKEN` (VPS & token yang sama dengan Pedia).
  Body ditandatangani di Pages: `sign = md5(username + key + X)` dengan X = `depo` /
  `pricelist` / `ref_id`. Key tidak pernah dikirim ke VPS.
- Env Pages (semua `secret_text`, belum dipasang): `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY`,
  `DIGIFLAZZ_WEBHOOK_SECRET`, `DIGIFLAZZ_TESTING` (`true` → kirim `testing:true`). Tanpa
  `DIGIFLAZZ_USERNAME`/`DIGIFLAZZ_API_KEY` semua job Games no-op (tidak error).

### 12.2 Data (D1)
- `games_products`: satu baris per SKU utama. `buyer_sku_code` UNIQUE, `backup_sku_code`
  (kode `…b`, nullable), `game_brand`, `product_type` (Umum/Indonesia/Membership),
  `product_name`, `cost`, `backup_cost`, `seller_active`, `backup_seller_active`,
  `unlimited_stock`, `stock`, `multi`, `start_cut_off`, `end_cut_off`, `description`,
  `reference_price` (Oura, input admin, nullable), `sell_price` (hasil
  `computeGamesSellPrice` dengan biaya kanal 0 — biaya kanal ditambahkan rail pembayaran
  seperti Market/Pedia), `enabled` (tampil ke pembeli, default 0), `synced_at`.
- `games_order_items`: satu baris per pesanan (`order_code` UNIQUE FK `orders.code`,
  `orders.order_kind='games'`), `product_id`, `buyer_sku_code`, `customer_no`,
  `customer_nickname`, `quantity` (MVP = 1), `unit_price`, `total`, `cost_snapshot`,
  `max_price`, `status` ∈ awaiting_payment | queued | submitting | pending | success |
  needs_check | expired, `attempt_no` (1 utama, 2 cadangan), `sn`, `supplier_message`,
  `lease_until`, `submit_attempts`, `last_polled_at`, `completed_at`, `last_error`.
- `games_dispatch_attempts`: `ref_id` UNIQUE (`<order_code>-<attempt_no>`), `order_code`,
  `attempt_no` (UNIQUE bersama order_code), `buyer_sku_code`, `status` ∈ submitting |
  pending | success | failed | ambiguous, `rc`, `message`, `sn`, `price`.

### 12.3 Alur dispatch
1. Pembayaran terverifikasi → `schedulePaidFulfillment(code,'games')` → `processGamesPaidOrders()`;
   cron lite `games_orders` adalah jalur pemulihan.
2. Klaim berpagar: `queued` + lease kedaluwarsa → `submitting` (lease 300 dtk) dengan
   `changes===1`; baru kemudian insert attempt + panggil `transaction`.
3. Respons `status`: **Sukses** → item `success` (simpan `sn`); **Pending** → item
   `pending`; **Gagal** (final) → bila `attempt_no=1`, ada `backup_sku_code` aktif dan
   `backup_cost ≤ max_price` → attempt 2 (ref baru) di run berikutnya, selain itu
   `needs_check` + notifikasi admin Telegram.
4. Transport ambigu (timeout/502/504/tak terbaca) → attempt `ambiguous`, item `pending`;
   dicek ulang dengan **payload & `ref_id` yang sama** (Digiflazz mengembalikan status
   transaksi existing). Tidak pernah membuat ref baru untuk ambiguitas.
5. Polling pending dengan backoff (60/120/300 dtk); pending > 24 jam → `needs_check`.
6. Tidak pernah dua attempt aktif untuk satu pesanan; `max_price` selalu dikirim.

### 12.4 Webhook
`POST /api/games/digiflazz/webhook`: baca body mentah (batas byte), verifikasi
`X-Hub-Signature: sha1=<HMAC-SHA1(secret, raw)>` constant-time, dedupe di
`dana_webhook_events` (`provider='digiflazz'`, key `ref_id:status`), lalu transisi yang sama
dengan polling (idempoten, hanya dari `submitting|pending` milik attempt aktif).
Respons 200 setelah tercatat; signature salah 401. Webhook dashboard baru diaktifkan
setelah route ini terdeploy.

### 12.5 Sinkron katalog
Cron lite `games_catalog` (throttle ≥10 menit lewat `store_settings`): `price-list`
`cmd:prepaid`, filter kategori Games, upsert per kode utama; kode berakhiran `b` mengisi
kolom cadangan dari kode dasar. SKU yang hilang dari daftar → `seller_active=0`.
`sell_price` dihitung ulang. `enabled` tidak pernah diubah oleh sinkron.

### 12.6 Status implementasi (9 November 2026)
- Selesai: G1 proxy (terpasang VPS), G2 klien, G3 schema (migrasi 0107), G4 sinkron +
  cron `games_catalog`, G5 dispatch + cadangan + cron `games_orders`, G6 webhook.
  Detail perilaku & penyimpangan kecil: ARCHITECTURE §16.25–§16.26.
- **Untuk Paseo/fase berikut:** API quote/order pembeli (buat `orders` kind `games` +
  `games_order_items` status `awaiting_payment`, harga dari `games_products.sell_price`,
  `max_price` = batas modal, attach rail existing), endpoint cek nickname (rate limit +
  cache), admin harga referensi/enable SKU, UI §4–§7, lalu G8 go-live (pasang env
  `secret_text`, rotasi key, aktifkan webhook dashboard, mode Production, deposit).
- Tindak lanjut teknis: allowlist `rc` Gagal yang transien sebelum dianggap final.
