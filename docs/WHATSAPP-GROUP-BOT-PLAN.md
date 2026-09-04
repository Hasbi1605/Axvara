# Rencana Eksekusi — Varian Produk Terpusat dan Bot Grup WhatsApp AXVARA

**Status:** handoff ready, planning only

**Tanggal:** 4 September 2026

**Prioritas:** fondasi varian di CMS/D1 lebih dahulu, lalu web, Telegram, dan WhatsApp

**Target WhatsApp:** nomor serta grup yang sudah ada

**Gateway kandidat MVP:** Fonnte

**Payment:** gunakan kembali integrasi KlikQRIS AXVARA yang sudah bekerja di Telegram

---

## 1. Ringkasan keputusan

Permintaan ini bukan sekadar menambah command WhatsApp. AXVARA perlu mengubah model
katalog dari satu baris produk = satu barang jual menjadi:

- **produk induk**, misalnya Gemini, Grok, ChatGPT, Canva;
- **varian yang dapat dibeli**, misalnya Invite 12 Bulan Full Garansi,
  Head 3 Bulan Garansi 1 Bulan, atau Individual 1 Bulan tanpa garansi;
- satu sumber data di D1 yang dikelola lewat CMS web;
- website, Telegram, dan WhatsApp hanya menjadi penyaji serta saluran transaksi dari
  data yang sama.

Alur WhatsApp MVP dikunci sesederhana berikut:

    User: list
    Bot:  daftar nama produk aktif saja

    User: Gemini
    Bot:  detail singkat Gemini + daftar varian bernomor

    User: 2
    Bot:  ringkasan varian terpilih + tautan lanjut secara privat

WhatsApp tidak memakai kategori. Perubahan produk atau varian di CMS harus tampil pada
website, Telegram, dan WhatsApp tanpa menyalin data atau deploy kode.

---

## 2. Analisis contoh screenshot

### 2.1 Pola yang diambil

Dari screenshot, perilaku yang cocok untuk AXVARA adalah:

1. Keyword **list** menampilkan nama keluarga produk, bukan semua SKU.
2. User mengetik nama produk, misalnya **Grok** atau **Gemini**.
3. Bot menjawab dengan varian bernomor.
4. Tiap varian mempunyai kombinasi:
   - nama plan atau tipe akun;
   - durasi;
   - jenis atau masa garansi;
   - harga;
   - status tersedia.
5. User dapat membalas nomor varian dari respons terakhir.

### 2.2 Bagian yang disesuaikan untuk AXVARA

Yang tidak boleh disalin mentah dari screenshot:

- Daftar tidak boleh di-hardcode di script bot.
- Harga, stok, durasi, dan garansi tidak boleh menjadi teks bebas terpisah per channel.
- Bot tidak perlu selalu menyuruh user menanyakan stok jika CMS sudah menyimpan stok.
- QRIS, status pembayaran, bukti bayar, serta kredensial produk tidak dikirim di grup.
- Angka seperti **2** tidak boleh berlaku global untuk seluruh grup; pemetaan harus
  terikat pada anggota dan percakapan yang memintanya.

Grup digunakan untuk menemukan produk. Transaksi dan delivery berpindah ke chat pribadi
agar data pembeli tidak terlihat oleh semua anggota.

---

## 3. Temuan baseline AXVARA saat ini

Audit codebase menunjukkan varian belum ada sebagai entitas:

- drizzle/schema.sql menyimpan price, compare_price, stock, dan is_active langsung pada
  tabel products.
- src/lib/products.ts mempunyai satu harga dan stok per Product; beberapa durasi masih
  menjadi bagian dari nama produk seed.
- src/app/admin/page.tsx mengedit satu harga dan satu stok per produk.
- src/app/produk/[slug]/page.tsx belum memiliki pemilih varian.
- src/stores/cart.ts mengidentifikasi item hanya dengan product.id.
- checkout quote menerima product_id lalu memvalidasi harga/stok produk.
- bot Telegram langsung bergerak dari produk ke konfirmasi/order.
- fulfillment_mode dan shared secret saat ini berada pada level produk.

Konsekuensinya, WhatsApp tidak boleh dibangun lebih dahulu di atas model lama. Jika itu
dilakukan, daftar varian akan kembali menjadi data khusus bot dan web tidak menjadi
pusat katalog.

### Baseline yang harus tetap hidup

- Checkout web lama tetap dapat dipakai selama masa migrasi.
- Command dan pembelian Telegram yang sudah ada tidak boleh putus.
- KlikQRIS, payment_transactions, callback, cron rekonsiliasi, dan idempotensi provider
  tetap digunakan.
- Fulfillment secret tidak pernah masuk log atau respons publik.
- Order historis tetap dapat dibaca setelah produk/varian diubah.

---

## 4. Arsitektur target

### 4.1 Source of truth

**D1 adalah source of truth. CMS web adalah antarmuka pengelola source of truth.**

    Admin CMS
       |
       v
    products + product_variants + inventory (D1)
       |                 |                  |
       v                 v                  v
    Website           Telegram          WhatsApp
       \                 |                 /
        \________________|________________/
                         |
                  Commerce services
                         |
            order + KlikQRIS + fulfillment

Tidak ada tabel katalog WhatsApp, file JSON Telegram, spreadsheet sinkronisasi, atau
cache permanen per channel.

### 4.2 Batas tanggung jawab

- **products** menyimpan identitas dan konten keluarga produk.
- **product_variants** menyimpan sesuatu yang benar-benar dibeli.
- **CMS** membuat, mengubah, mengurutkan, dan menonaktifkan keduanya.
- **catalog service** menghasilkan data kanal dari query yang sama.
- **commerce service** memvalidasi varian, harga, stok, order, dan pembayaran.
- **channel adapter** hanya menangani format pesan, callback, dan pengiriman.

### 4.3 Satu arsitektur Cloudflare

Tetap gunakan stack AXVARA:

- Next.js Pages untuk website, admin, serta endpoint;
- D1 untuk katalog, sesi bot, order, pembayaran, dan job;
- R2 bila media QR perlu fallback;
- Worker/cron yang sudah ada untuk rekonsiliasi serta fulfillment;
- KlikQRIS yang sudah terhubung;
- Fonnte hanya sebagai jembatan nomor/grup WhatsApp existing.

Fonnte bukan database atau commerce backend kedua.

---

## 5. Model data produk dan varian

### 5.1 products menjadi produk induk

Kolom yang tetap berada pada produk:

- id;
- category_id;
- name dan slug;
- aliases, berupa JSON array istilah pencarian;
- description dan long_description;
- image;
- badge;
- sold_count;
- is_active;
- sort_order;
- created_at dan updated_at.

Contoh:

    Product
    name: Gemini
    aliases: ["gemini ai", "google gemini"]

Harga jual, stok jual, garansi, durasi, dan fulfillment tidak lagi menjadi sumber
utama di products.

### 5.2 product_variants sebagai SKU yang dijual

Tambahkan tabel product_variants dengan rancangan minimum:

    CREATE TABLE product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,

      duration_value INTEGER,
      duration_unit TEXT,
      duration_label TEXT,

      warranty_type TEXT NOT NULL DEFAULT 'none',
      warranty_value INTEGER,
      warranty_unit TEXT,
      warranty_label TEXT,

      price INTEGER NOT NULL,
      compare_price INTEGER,
      stock INTEGER NOT NULL DEFAULT -1,

      fulfillment_mode TEXT NOT NULL DEFAULT 'manual',
      shared_secret_ciphertext TEXT,
      shared_secret_iv TEXT,

      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

Constraint yang wajib diwujudkan melalui SQL dan validasi aplikasi:

- duration_unit hanya day, month, year, lifetime, atau custom;
- warranty_type hanya none, limited, full, atau custom;
- warranty_unit hanya day, month, year, lifetime, atau null;
- duration_value dan warranty_value tidak negatif;
- price tidak negatif;
- compare_price null atau lebih besar dari price;
- SKU unik dan stabil;
- active product harus mempunyai minimal satu active variant;
- kombinasi label/durasi/garansi yang sama dalam satu produk ditolak;
- stock -1 berarti tidak dibatasi, 0 berarti habis.

duration_label dan warranty_label dipakai untuk kasus khusus, tetapi nilai terstruktur
tetap diisi bila memungkinkan. Tampilan tidak boleh bergantung pada emoji atau parsing
nama varian.

### 5.3 Contoh representasi

    product: Gemini

    variant 1
      sku: GEM-INV-12M-FULL
      label: Invite
      duration: 12 month
      warranty: full
      price: 18000

    variant 2
      sku: GEM-HEAD-3M-W1M
      label: Head
      duration: 3 month
      warranty: limited 1 month
      price: 25000

### 5.4 Inventory dan fulfillment berada di level varian

Durasi atau tipe akun yang berbeda dapat memakai stok/credential yang berbeda. Karena
itu:

- fulfillment_inventory mendapat variant_id;
- reservasi serta konsumsi inventory memakai variant_id;
- fulfillment_mode dipindahkan ke varian;
- shared secret untuk mode shared disimpan terenkripsi per varian;
- fulfillment_jobs menyimpan variant_id dan channel tujuan;
- delivery adapter memilih Telegram atau WhatsApp dari order.sales_channel.

Order tidak boleh mengurangi stock produk induk.

### 5.5 Snapshot order

Order item harus menyimpan snapshot berikut, bukan hanya foreign key:

- product_id dan product_name;
- variant_id dan variant_sku;
- variant_label;
- duration label/value/unit;
- warranty label/type/value/unit;
- unit_price dan quantity.

Dengan snapshot, riwayat pembelian tidak berubah saat admin mengganti nama, harga, atau
garansi varian di masa depan.

---

## 6. Migrasi data lama tanpa kehilangan layanan

Gunakan migrasi bertahap dan kompatibel:

1. Buat product_variants serta indeksnya.
2. Buat tepat satu **default variant** untuk setiap produk lama menggunakan:
   - harga, compare price, dan stok lama;
   - fulfillment_mode lama;
   - shared secret lama;
   - urutan aktif produk.
3. Hubungkan inventory lama ke default variant hasil backfill.
4. Tambahkan nullable variant_id pada order item/job lebih dahulu.
5. Ubah read path agar memprioritaskan varian tetapi masih mampu membaca order lama.
6. Setelah admin meninjau data, kelompokkan produk-produk yang sebetulnya satu keluarga.
7. Setelah seluruh channel stabil, jadikan kolom harga/stok/fulfillment products sebagai
   deprecated dan akhirnya hapus melalui migrasi terpisah.

### Larangan migrasi otomatis berisiko

- Jangan menggabungkan produk hanya karena namanya mirip.
- Jangan menganggap teks “1 Bulan” selalu durasi layanan.
- Regex boleh memberi saran pada halaman review, tetapi admin harus mengonfirmasi.
- Jangan hard-delete produk/varian yang sudah direferensikan order.

Selama masa kompatibilitas, summary produk dapat menghitung:

- min_price = harga terendah active variant;
- max_price = harga tertinggi active variant;
- variant_count = jumlah active variant;
- total_stock = agregat hanya bila semua varian finite; jika ada -1 tampilkan tersedia.

---

## 7. CMS web sebagai pusat pengelolaan

### 7.1 Form produk

Bagian **Informasi Produk** berisi:

- nama;
- slug;
- alias pencarian;
- kategori;
- deskripsi;
- gambar;
- badge;
- status aktif;
- urutan.

Bagian **Varian** berupa repeater/table:

| Field | Contoh | Catatan |
|---|---|---|
| SKU | GEM-INV-12M-FULL | unik dan stabil |
| Tipe/plan | Invite | label yang dibaca user |
| Durasi | 12 Bulan | nilai + unit |
| Garansi | Full Garansi | tipe dan masa bila terbatas |
| Harga | Rp18.000 | harga server-authoritative |
| Harga coret | Rp25.000 | opsional |
| Stok | -1 | -1 unlimited, 0 habis |
| Fulfillment | unique/shared/manual | per varian |
| Aktif | ya | mengatur semua channel |
| Urutan | 10 | urutan web dan bot |

Admin harus dapat:

- menambah;
- menduplikasi;
- mengurutkan;
- mengubah;
- menonaktifkan;
- melihat status stok/inventory;
- menyimpan secret secara write-only.

Varian yang pernah dipakai order tidak dihapus fisik; tombol “hapus” mengarsipkan atau
menonaktifkannya.

### 7.2 Validasi save

Save ditolak bila:

- produk aktif tidak memiliki active variant;
- SKU duplikat;
- harga/compare price tidak valid;
- durasi atau garansi tidak konsisten;
- fulfillment unique tidak mempunyai konfigurasi inventory yang sah;
- fulfillment shared tidak mempunyai secret aktif;
- dua varian aktif mempunyai identitas tampilan yang sama.

### 7.3 Publish semantics

Untuk MVP, save yang valid langsung menjadi data live. Jika draft/publish dibutuhkan
nanti, tambahkan status eksplisit; jangan membuat cache Telegram/WhatsApp sendiri.

Perubahan aktif harus terbaca channel pada request berikutnya. Cache publik website
boleh maksimal singkat dan harus bisa di-invalidate/revalidate setelah save.

---

## 8. Kontrak katalog bersama

Buat service query bersama, misalnya src/lib/catalog, agar web dan kedua bot tidak
menulis SQL/filter masing-masing.

### 8.1 Product list

Hanya mengembalikan produk bila:

- products.is_active = 1;
- mempunyai minimal satu product_variants.is_active = 1;
- diurutkan product.sort_order lalu name.

Respons summary minimum:

    id, slug, name, aliases, image
    minPrice, maxPrice, variantCount, availability

### 8.2 Product detail

Mengembalikan produk dan active variants:

    product metadata
    variants ordered by sort_order, price, id

Varian nonaktif tetap dapat dibaca admin dan order historis, tetapi tidak tampil pada
katalog publik.

### 8.3 Pencarian nama untuk bot

Normalisasi input:

- lowercase;
- trim;
- satukan whitespace;
- hilangkan tanda baca yang tidak bermakna.

Urutan matching:

1. exact normalized product name;
2. exact slug;
3. exact alias;
4. prefix/fuzzy match terbatas.

Jika fuzzy menghasilkan lebih dari satu kandidat, bot menampilkan kandidat nama dan
meminta user mengetik salah satunya. Jangan memilih diam-diam.

---

## 9. Perubahan website

### 9.1 Product card

- Satu card per produk induk.
- Harga tampil **Mulai RpX** jika lebih dari satu harga.
- Bila semua varian satu harga, tampilkan harga biasa.
- Status tersedia dihitung dari active variants.

### 9.2 Product detail

Tambahkan pemilih varian berbentuk card/radio yang memperlihatkan:

- tipe/plan;
- durasi;
- garansi;
- harga dan harga coret;
- status stok.

Memilih varian harus memperbarui harga, stok, garansi, dan CTA. Jika hanya satu active
variant, varian boleh terpilih otomatis. Jika lebih dari satu, CTA dinonaktifkan sampai
user memilih.

### 9.3 Cart dan checkout

- Identitas cart menjadi product_id + variant_id.
- Dua varian produk yang sama menjadi dua baris terpisah.
- Cart menampilkan label, durasi, dan garansi.
- Checkout quote wajib menerima variant_id.
- Server mengambil ulang product + active variant dari D1.
- Harga client tidak pernah dipercaya.
- product_id/variant_id mismatch, stok habis, atau inactive variant ditolak.
- Order membuat snapshot varian.

URL buy-now boleh membawa variant ID, tetapi server tetap memvalidasi ulang.

---

## 10. Perubahan bot Telegram

Alur yang sekarang produk → konfirmasi berubah menjadi:

    kategori/list
      → pilih produk induk
      → pilih varian
      → konfirmasi
      → create order
      → invoice KlikQRIS

Keputusan implementasi:

- Category navigation Telegram boleh dipertahankan.
- Tombol varian membawa stable variant_id, bukan harga atau nomor urut.
- Callback data harus ditandatangani atau divalidasi terhadap session/order.
- Konfirmasi menampilkan plan, durasi, garansi, dan harga.
- KlikQRIS menerima total dari varian yang sudah divalidasi server.
- Fulfillment mengambil inventory/secret varian.

KlikQRIS tidak dibuat ulang. Gunakan adapter, tabel payment_transactions, callback, dan
cron yang sudah terbukti bekerja; hanya sumber item/amount yang berubah dari produk ke
varian.

---

## 11. Alur WhatsApp MVP

### 11.1 Command list

Input diterima case-insensitive:

    list

Respons hanya nama produk aktif, tanpa kategori, harga, atau seluruh varian:

    *PRODUK AXVARA*

    1. Canva
    2. ChatGPT
    3. Gemini
    4. Grok
    5. YouTube Premium

    Ketik nama produk untuk melihat pilihan.

Jika produk terlalu banyak, gunakan pagination:

    list
    list 2

Jangan mengirim puluhan pesan terpisah. Batasi panjang sesuai limit gateway.

### 11.2 User mengetik nama produk

Input:

    Gemini

Respons:

    *GEMINI*
    Akses Gemini AI Pro dengan pilihan plan berikut.

    1. Invite
       Durasi: 12 Bulan
       Garansi: Full Garansi
       Harga: Rp18.000

    2. Head
       Durasi: 3 Bulan
       Garansi: 1 Bulan
       Harga: Rp25.000

    Balas pesan ini dengan angka 1-2 untuk memilih.

Hanya active variants yang tampil. Varian habis boleh disembunyikan atau diberi label
HABIS; keputusan MVP yang disarankan adalah tetap tampil dengan label HABIS agar user
mengetahui opsi tersedia, tetapi nomor habis tidak dapat dipilih.

### 11.3 User memilih angka

Saat user membalas **2**, bot:

1. menemukan session milik anggota tersebut;
2. memetakan angka 2 ke stable variant_id dari respons terakhir;
3. mengambil ulang varian dari D1;
4. memvalidasi active, stok, harga, dan product relation;
5. menjawab ringkasan;
6. memberi tautan lanjut ke chat pribadi.

Respons grup:

    Pilihanmu:
    Gemini — Head
    3 Bulan · Garansi 1 Bulan
    Rp25.000

    Lanjutkan order secara privat:
    <tautan WhatsApp dengan token pemilihan singkat>

QRIS tidak dikirim di grup.

### 11.4 Private order

Tautan membawa opaque one-time selection token, bukan harga atau secret. Saat dibuka:

1. token diverifikasi dan ditukar dengan variant_id;
2. user mengonfirmasi quantity;
3. server memvalidasi ulang varian;
4. order WhatsApp dibuat idempotent;
5. invoice KlikQRIS dibuat;
6. QR/payment link dikirim privat;
7. callback mengubah payment/order;
8. fulfillment dikirim privat atau masuk antrean manual.

Jika auto-order belum siap saat WhatsApp discovery dirilis, private response cukup
memberi ringkasan dan kontak admin. Alur list dan varian tidak boleh bergantung pada
fitur payment.

### 11.5 Error response

- Nama tidak ditemukan: “Produk tidak ditemukan. Ketik list untuk melihat produk.”
- Nama ambigu: tampilkan maksimal lima kandidat.
- Session angka kedaluwarsa: minta user mengetik nama produk lagi.
- Varian baru saja nonaktif/habis: beri tahu dan tampilkan ulang varian terbaru.
- Gateway/payment gagal: satu pesan ramah, simpan detail teknis di log teredaksi.

---

## 12. Session, concurrency, dan idempotensi WhatsApp

### 12.1 Scope session

Key session wajib:

    provider + conversation_id + member_id

Jangan hanya group_id, karena beberapa anggota dapat meminta produk berbeda pada waktu
bersamaan.

Data minimum:

- selected_product_id;
- numbered_variant_map sebagai JSON nomor → variant_id;
- source_message_id bila gateway menyediakannya;
- catalog_version atau generated_at;
- expires_at, disarankan 10–15 menit.

Saat angka dipilih, map menentukan ID tetapi data harga/stok tetap di-query ulang.

### 12.2 Webhook inbox

Simpan event masuk dengan unique provider + external_message_id:

- event duplikat tidak memicu respons/order kedua;
- verifikasi secret/signature gateway sebelum parse;
- simpan payload minimal dan teredaksi;
- ACK cepat;
- proses berat melalui queue/outbox bila tersedia.

### 12.3 Outbox kirim

Pesan keluar memiliki idempotency key:

    channel + destination + event_id + response_type

Retry memakai backoff, batas percobaan, serta dead-letter state. Jangan mengulang
pembuatan KlikQRIS hanya karena pengiriman pesan gagal.

---

## 13. API dan perubahan schema lintas fitur

### 13.1 Endpoint katalog

Pertahankan route yang ada bila memungkinkan, tetapi kontraknya menjadi:

- GET /api/products?active=1 → product summaries;
- GET /api/products/[slug] → product + variants;
- create/update product → base product;
- endpoint admin variants → CRUD/activate/reorder;
- save multi-row menggunakan D1 batch/transaction yang tersedia.

Respons publik tidak boleh mengandung ciphertext, inventory secret, margin internal,
atau metadata provider.

### 13.2 Checkout/order

Ubah kontrak item menjadi:

    product_id
    variant_id
    quantity

Server mengisi seluruh snapshot dan harga.

### 13.3 Multi-channel

Migrasikan orders.sales_channel agar menerima:

- web;
- telegram;
- whatsapp.

Tambahkan destination metadata yang cukup untuk delivery tanpa memasukkan data sensitif
ke log. fulfillment_jobs dan notification outbox harus channel-aware.

### 13.4 Schema WhatsApp minimum

Tambahkan tabel/kolom:

- whatsapp_inbox_events untuk dedupe webhook;
- whatsapp_sessions untuk konteks per anggota grup;
- whatsapp_selection_tokens untuk handoff privat satu kali;
- message_outbox generik atau whatsapp_outbox untuk retry pengiriman;
- channel/destination pada fulfillment job.

Simpan group ID dan nomor allowlist sebagai secret/env/config terkontrol, bukan
hardcode.

---

## 14. Security dan privasi

- Proses hanya group ID allowlist.
- Abaikan pesan yang dikirim nomor bot sendiri.
- Batasi command per member dan per group.
- Verifikasi signature/token webhook dengan timing-safe comparison.
- Jangan menerima harga, total, product label, atau garansi dari client sebagai fakta.
- Selection token acak, sekali pakai, TTL pendek, dan disimpan hash bila memungkinkan.
- Secret fulfillment tetap dienkripsi.
- QR, order detail, status bayar, dan kredensial hanya dikirim privat.
- Log tidak boleh memuat token gateway, KlikQRIS credential, QR payload mentah,
  password, atau shared secret.
- Pisahkan feature flag WhatsApp discovery, private order, payment, dan fulfillment.

Catatan operasional: gateway linked-device untuk nomor WhatsApp existing mempunyai
risiko session/logout dan kebijakan platform. Health check serta prosedur reconnect
harus tersedia, dan owner menerima risiko gateway sebelum go-live.

---

## 15. Urutan implementasi wajib

### Fase 0 — Baseline dan characterization

- Petakan seluruh pembacaan products.price, stock, fulfillment, dan telegram_enabled.
- Tambah test karakterisasi web checkout, Telegram, KlikQRIS, dan fulfillment.
- Catat sampel data produk existing yang perlu dikelompokkan manual.
- Kunci terminology durasi dan garansi bersama owner.

**Gate:** test baseline hijau dan daftar migrasi produk disetujui.

### Fase 1 — Schema varian dan kompatibilitas

- Tambah product_variants.
- Backfill satu default variant per produk.
- Tambah variant_id nullable pada order/inventory/job.
- Buat catalog query/service bersama.
- Pertahankan fallback legacy sementara.

**Gate:** jumlah produk tetap sama; semua produk aktif punya active variant; order lama
tetap terbaca.

### Fase 2 — CMS varian

- Pisahkan form product base dan variant editor.
- Implementasi validation, ordering, deactivate, serta fulfillment per variant.
- Buat halaman review hasil backfill.
- Admin menyusun keluarga produk serta varian sebenarnya.

**Gate:** admin dapat mengubah satu varian dan query publik langsung memantulkan hasil.

### Fase 3 — Website

- Product card berbasis min price.
- Variant selector di detail.
- Cart key product + variant.
- Quote/order server-authoritative berbasis variant_id.
- Snapshot order dan pengurangan stok varian.

**Gate:** dua varian produk yang sama dapat masuk cart dan checkout secara benar.

### Fase 4 — Telegram

- Tambah langkah pilih varian.
- Callback memakai stable variant_id.
- Amount KlikQRIS dan fulfillment memakai varian.
- Jalankan regression test Telegram/KlikQRIS.

**Gate:** transaksi Telegram end-to-end berhasil untuk manual, shared, dan unique.

### Fase 5 — WhatsApp discovery

- Hubungkan nomor existing ke gateway.
- Temukan serta allowlist group existing.
- Implement webhook dedupe dan outbox.
- Implement list, pagination, name matching, detail varian, dan session angka.
- Rilis read-only tanpa payment lebih dahulu.

**Gate:** update CMS tampil di WhatsApp tanpa deploy/sinkronisasi dan tidak ada balasan
di luar allowlist.

### Fase 6 — WhatsApp private order

- Implement selection token dan deep-link.
- Create order sales_channel=whatsapp.
- Gunakan KlikQRIS existing.
- Tambah WhatsApp delivery adapter.
- Aktifkan fulfillment bertahap.

**Gate:** satu input hanya membuat satu order/invoice/delivery dan seluruh data sensitif
tetap privat.

### Fase 7 — Cleanup

- Hapus fallback pembacaan harga/stok produk setelah observasi stabil.
- Deprecate kolom legacy melalui migrasi terpisah.
- Hapus flag channel lama yang membuat katalog berbeda, atau ubah menjadi availability
  terpusat bila benar-benar dibutuhkan.

---

## 16. Strategi feature flag dan rollout

Flag minimum:

- PRODUCT_VARIANTS_READ;
- PRODUCT_VARIANTS_WRITE;
- TELEGRAM_VARIANT_FLOW;
- WHATSAPP_ENABLED;
- WHATSAPP_GROUP_DISCOVERY;
- WHATSAPP_PRIVATE_ORDER;
- WHATSAPP_KLIKQRIS;
- WHATSAPP_FULFILLMENT.

Urutan aktivasi:

1. migrate/backfill dalam kondisi flag off;
2. CMS untuk admin internal;
3. website pada sebagian traffic atau setelah review;
4. Telegram;
5. WhatsApp discovery pada satu grup allowlist;
6. private order;
7. payment;
8. fulfillment.

Rollback cukup mematikan flag fase terakhir tanpa menjatuhkan website, Telegram, atau
ledger pembayaran.

---

## 17. Test plan

### 17.1 Schema dan migration

- setiap produk lama memperoleh tepat satu default variant;
- rerun migration aman;
- inventory/secret lama menunjuk varian yang benar;
- order lama tetap dapat dirender;
- constraint SKU, duration, warranty, dan price bekerja.

### 17.2 CMS

- create/edit/duplicate/reorder/deactivate variant;
- secret tidak pernah dibaca kembali sebagai plaintext;
- active product tanpa active variant ditolak;
- variant yang pernah dibeli tidak terhapus fisik;
- perubahan tercermin pada query katalog berikutnya.

### 17.3 Web

- zero, one, dan many active variants;
- switch varian memperbarui harga/stok/garansi;
- cart memisahkan varian;
- quote menolak price tampering;
- quote menolak product/variant mismatch dan inactive/out-of-stock;
- order snapshot tidak berubah setelah edit CMS.

### 17.4 Telegram

- product → variant → confirm;
- callback variant palsu/kedaluwarsa ditolak;
- KlikQRIS amount sama dengan harga variant server;
- inventory variant yang benar dikonsumsi;
- existing command dan payment callback tetap lulus.

### 17.5 WhatsApp

- list hanya menampilkan nama produk aktif;
- kategori tidak tampil;
- exact name, slug, alias, ambiguous, unknown;
- product response hanya menampilkan active variants;
- dua anggota satu grup mempunyai session terpisah;
- angka dari session lama ditolak;
- varian berubah setelah list divalidasi ulang;
- webhook duplikat hanya menghasilkan satu respons;
- bot tidak loop pada pesannya sendiri;
- unauthorized group diabaikan;
- QR/order/credential tidak pernah muncul di grup.

### 17.6 End-to-end

Skenario wajib:

1. Admin menambah varian Gemini 6 Bulan Full Garansi.
2. Varian tampil pada website tanpa deploy.
3. Telegram menampilkan varian yang sama.
4. WhatsApp list tetap hanya menampilkan Gemini satu kali.
5. User mengetik Gemini dan varian baru tampil.
6. User memilih varian.
7. Order privat menghasilkan KlikQRIS dengan nominal tepat.
8. Callback lunas hanya memicu satu fulfillment.

---

## 18. Acceptance criteria

Implementasi dianggap selesai bila:

- CMS/D1 adalah satu-satunya sumber produk dan varian;
- produk aktif wajib mempunyai minimal satu varian aktif;
- durasi, garansi, harga, stok, dan fulfillment tersimpan per varian;
- perubahan CMS muncul di web, Telegram, dan WhatsApp tanpa salin data;
- website mempunyai variant picker dan checkout berbasis variant_id;
- Telegram meminta pemilihan varian sebelum order;
- WhatsApp list hanya mengirim nama produk;
- mengetik nama produk mengirim detail dan varian bernomor;
- pilihan angka aman per group member/session;
- order menyimpan snapshot varian;
- KlikQRIS memakai harga varian hasil validasi server;
- inventory dan delivery tepat per varian/channel;
- tidak ada QR atau secret di grup;
- webhook/order/payment/fulfillment idempotent;
- rollback dapat dilakukan lewat feature flag.

---

## 19. Keputusan owner yang diperlukan sebelum coding

Agent eksekutor tidak boleh menebak data dagang berikut:

1. Daftar produk induk final dan produk lama mana yang harus digabung.
2. Daftar plan/tier yang sah, misalnya Invite, Head, Family, Individual.
3. Aturan garansi:
   - apa arti Full Garansi;
   - apakah masa garansi boleh berbeda dari durasi;
   - teks klaim dan pengecualian.
4. Apakah varian habis ditampilkan sebagai HABIS atau disembunyikan.
5. Apakah satu produk boleh mempunyai dua varian dengan label sama tetapi fulfillment
   berbeda.
6. Nomor WhatsApp dan ID grup allowlist untuk staging/production.
7. Persetujuan penggunaan gateway linked-device.

Keputusan tersebut sebaiknya dimasukkan lewat CMS/data migration, bukan hardcode.

---

## 20. Estimasi dan pembagian kerja

Ini perubahan lintas katalog, commerce, dan tiga channel. Estimasi realistis:

| Area | Estimasi |
|---|---:|
| Schema, backfill, catalog service | 1–2 hari |
| CMS variant editor | 1–2 hari |
| Web picker, cart, checkout, order snapshot | 1–2 hari |
| Telegram variant flow + regresi | 1 hari |
| WhatsApp discovery/session | 1–2 hari |
| Private KlikQRIS + fulfillment + hardening | 1–2 hari |

Total sekitar **6–10 hari kerja**, bergantung pada kualitas data produk lama dan
keputusan bisnis garansi. WhatsApp discovery tanpa auto-order dapat dirilis setelah
Fase 5; auto-order ditambahkan setelah jalur varian web dan Telegram stabil.

---

## 21. Checklist handoff agent eksekutor

- [ ] Baca PRD, DESIGN, ARCHITECTURE, README, CHANGELOG, dan dokumen ini.
- [ ] Jangan mengimplementasikan WhatsApp di atas products.price lama.
- [ ] Tambah migration additive serta backfill default variant.
- [ ] Update schema, API contract, CMS, web, cart, checkout, dan order snapshot.
- [ ] Update Telegram ke product → variant → confirm.
- [ ] Reuse KlikQRIS; jangan membuat adapter pembayaran baru.
- [ ] Implement WhatsApp list → nama produk → numbered variants.
- [ ] Scope session per conversation + member.
- [ ] Jaga transaksi dan credential tetap privat.
- [ ] Tambah test unit, regression, integration, dan E2E per fase.
- [ ] Update docs/ARCHITECTURE.md, README.md, dan CHANGELOG.md bersama perubahan.
- [ ] Verifikasi dev sesuai AGENTS.md.
- [ ] Commit dan push main hanya setelah seluruh gate fase yang dikerjakan lulus.

Dokumen ini mengunci model dan urutan kerja. Detail kosmetik pesan boleh berubah, tetapi
single source of truth, variant_id server-authoritative, snapshot order, session
per-member, serta pemisahan grup/private tidak boleh dilemahkan.
