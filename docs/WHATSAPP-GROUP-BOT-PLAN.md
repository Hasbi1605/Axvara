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
    Bot:  ringkasan varian terpilih + instruksi balas pay/payment

    User: pay
    Bot:  membuat order lalu mengirim QRIS, SeaBank, dan e-wallet di grup

    User: foto bukti + caption BUKTI <kode-order> <metode>
    Bot:  mengonfirmasi bukti diterima dan meneruskan ke verifikasi

WhatsApp tidak memakai kategori. Perubahan produk atau varian di CMS harus tampil pada
website, Telegram, dan WhatsApp tanpa menyalin data atau deploy kode.

Command **garansi** juga tersedia di grup dan menampilkan ketentuan serta syarat klaim
yang sama secara substantif dengan command /garansi di Telegram.

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
6. Setelah varian dipilih, keyword **pay** atau **payment** menampilkan seluruh metode
   pembayaran AXVARA.
7. User wajib mengirim foto/screenshot bukti pembayaran ke grup sebagai reply pada
   pesan pembayaran dengan kode order dan metode pada caption.

### 2.2 Bagian yang disesuaikan untuk AXVARA

Yang tidak boleh disalin mentah dari screenshot:

- Daftar tidak boleh di-hardcode di script bot.
- Harga, stok, durasi, dan garansi tidak boleh menjadi teks bebas terpisah per channel.
- Bot tidak perlu selalu menyuruh user menanyakan stok jika CMS sudah menyimpan stok.
- Angka seperti **2** tidak boleh berlaku global untuk seluruh grup; pemetaan harus
  terikat pada anggota dan percakapan yang memintanya.
- Bukti pembayaran tidak boleh langsung dianggap valid hanya karena berupa gambar.

Atas arahan owner, discovery, instruksi pembayaran, QRIS, rekening, dan pengiriman bukti
berlangsung di grup. Kredensial produk/fulfillment tetap tidak boleh dikirim ke grup.
Bot wajib memperingatkan bahwa bukti dapat dilihat anggota lain dan meminta user
memotong/menyensor saldo, transaksi lain, alamat, atau data sensitif yang tidak diperlukan.

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
- payment_methods D1 sudah menyimpan metode aktif, rekening, nama pemilik, dan URL QRIS.
- /api/proof/upload sudah memvalidasi image maksimal 5 MB dan menyimpan bukti private di
  R2, tetapi autentikasinya khusus same-origin checkout web.
- kebijakan Telegram saat ini berasal dari warrantyFullMessage yang menggabungkan
  warrantyTermsMessage dan warrantyClaimMessage.

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

### 7.4 Pembayaran dan antrean bukti WhatsApp

Panel **Pembayaran** yang sudah ada tetap menjadi pusat QRIS fallback, SeaBank, dan
e-wallet. Sebelum WHATSAPP_GROUP_PAYMENT aktif, preflight wajib memastikan ketiga metode
aktif dan field account/name/image valid. Jika konfigurasi tidak lengkap, fitur pay
fail-closed dan memberi pesan hubungi admin; bot tidak boleh memakai nomor hardcode.

Tambahkan queue **Bukti WhatsApp** pada CMS dengan:

- preview image melalui route admin-protected;
- kode order, member, produk/varian, total, claimed method, dan waktu;
- status provider KlikQRIS bila ada;
- tombol approve/reject beserta alasan;
- audit actor/time;
- indikator order paid tetapi proof belum masuk;
- aksi kirim ulang pengingat bukti.

Approve SeaBank/e-wallet wajib didahului konfirmasi admin bahwa mutasi sudah ditemukan.
Action memakai compare-and-set agar double click/retry tidak menghasilkan fulfillment
ganda.

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
    Ketik *garansi* untuk membaca ketentuan.

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
5. menyimpan selected_variant_id pada session anggota;
6. menjawab ringkasan dan meminta command pembayaran.

Respons grup:

    *VARIAN DIPILIH*
    Gemini — Head
    3 Bulan · Garansi 1 Bulan
    Rp25.000

    Balas pesan ini dengan *pay* atau *payment*
    untuk membuat order dan melihat metode pembayaran.

Command pay/payment hanya berlaku untuk anggota yang memilih varian tersebut. Jika
gateway menyediakan quoted/reply message ID, pay/payment wajib berupa reply pada pesan
ringkasan varian; fallback hanya boleh memakai session anggota yang belum kedaluwarsa.
Angka atau command milik anggota lain tidak boleh mengambil alih session.

### 11.4 Command pay/payment

Saat anggota yang sama membalas **pay** atau **payment**, bot:

1. membaca selected_variant_id dari session;
2. mengambil ulang product/variant, harga, stok, serta garansinya;
3. membuat satu pending order dan mereservasi stok dengan TTL;
4. membuat atau memakai ulang invoice KlikQRIS untuk order tersebut;
5. membaca SeaBank dan e-wallet aktif dari payment_methods D1;
6. mengirim kode order, nominal persis, QRIS, rekening SeaBank, e-wallet, dan aturan
   bukti pembayaran di grup;
7. menyimpan payment_message_id agar bukti dapat dikaitkan lewat reply.

Contoh pesan teks:

    *PEMBAYARAN AXVARA*
    Order: AXV-20260904-XXXXXXXX
    Produk: Gemini — Head
    Durasi: 3 Bulan
    Garansi: 1 Bulan
    Total: Rp25.000

    *QRIS*
    Scan gambar QRIS yang dikirim bot.

    *SEABANK*
    No. rekening: <dari CMS payment_methods>
    Atas nama: <dari CMS payment_methods>

    *E-WALLET*
    Nomor: <dari CMS payment_methods>
    Atas nama: <dari CMS payment_methods>

    Transfer tepat sesuai total.

    *BUKTI PEMBAYARAN WAJIB*
    Balas/reply pesan ini dengan foto atau screenshot bukti.
    Caption: BUKTI AXV-20260904-XXXXXXXX SEABANK
    Ganti metode menjadi QRIS, SEABANK, atau EWALLET.

    Bukti terlihat oleh anggota grup. Potong/sensor saldo,
    transaksi lain, alamat, dan data pribadi yang tidak diperlukan.

Gambar QRIS dikirim sebagai media setelah/bersama caption pembayaran. Nomor rekening,
nama pemilik, serta QR static fallback tidak boleh di-hardcode; semuanya berasal dari
payment_methods CMS. QR dinamis tetap dibuat oleh adapter KlikQRIS. Static QR hanya boleh
dipakai bila dikonfigurasi aktif sebagai fallback dan kegagalannya ditampilkan jelas.

Pemanggilan pay/payment berulang untuk session/order yang sama harus mengembalikan order
serta invoice pending yang sama, bukan membuat order atau tagihan baru.

### 11.5 Aturan bukti pembayaran di grup

User diwajibkan:

1. melakukan pembayaran sesuai nominal order;
2. reply pada pesan pembayaran bot;
3. mengirim satu file JPG, PNG, atau WebP maksimal 5 MB;
4. memakai caption:

       BUKTI <KODE-ORDER> <QRIS|SEABANK|EWALLET>

5. menyensor data yang tidak relevan;
6. tidak menghapus caption atau mengganti kode order.

Saat webhook menerima media bukti, server wajib:

1. memverifikasi group allowlist dan member pengirim;
2. mencocokkan reply message ID, kode order, member ID, dan conversation ID;
3. memastikan order masih milik member tersebut dan belum kedaluwarsa;
4. memvalidasi MIME, magic bytes, ukuran, dan hanya menerima image;
5. mengunduh media dari gateway menggunakan credential server-side;
6. menghitung hash untuk dedupe;
7. menyimpan file secara privat di R2 prefix bukti/whatsapp;
8. membuat record payment_proofs dengan status submitted;
9. menyimpan metode yang ditulis user sebagai claimed_method;
10. mengirim acknowledgement dan notifikasi admin.

Reply message ID adalah jalur utama. Jika payload gateway tidak menyediakan quoted
message ID yang dapat dipercaya, fallback hanya boleh memakai kombinasi kode order pada
caption + conversation ID + member ID. User tetap diarahkan melakukan reply agar alurnya
jelas secara visual.

Respons acknowledgement:

    Bukti pembayaran untuk AXV-20260904-XXXXXXXX sudah diterima.
    Status: menunggu verifikasi.
    Bukti tidak otomatis berarti pembayaran sudah sah.

Gambar bukti tidak boleh membuat order berstatus paid secara otomatis. Untuk QRIS,
callback/status provider tetap authoritative. Untuk SeaBank/e-wallet, admin memeriksa
mutasi dan bukti lalu mengonfirmasi dari CMS.

Karena bukti diwajibkan pada alur WhatsApp, fulfillment memakai dua gate:

- QRIS: payment_status=paid dari provider **dan** proof_status=submitted/approved;
- SeaBank/e-wallet: proof_status=approved sekaligus payment_status=paid dari admin.

Jika callback QRIS datang sebelum bukti, bot mengirim status “pembayaran terdeteksi”
disertai pengingat mengunggah bukti; fulfillment masih menunggu bukti. Bukti tetap bukan
sumber validasi pembayaran.

### 11.6 Command garansi

Command berikut diterima case-insensitive di grup:

    garansi
    /garansi

Bot mengirim ketentuan dan enam syarat klaim yang sama dengan Telegram. Isi dan
urutannya harus identik; hanya markup HTML Telegram yang diubah menjadi
format teks WhatsApp. Kebijakan mencakup status third-party, tidak ada jaminan permanen,
masa garansi mengikuti varian,
klaim berupa penggantian/perbaikan bukan refund otomatis, bukti error + invoice wajib,
kondisi garansi hangus, SLA, dan batas klaim.

Jangan menyalin teks Telegram menjadi string kedua. Ekstrak isi canonical dari
warrantyTermsMessage/warrantyClaimMessage ke modul bersama, misalnya
src/lib/warranty-policy.ts:

- Telegram formatter menghasilkan HTML;
- WhatsApp formatter menghasilkan plain text/WhatsApp emphasis;
- keduanya memakai urutan dan isi kebijakan yang sama;
- detail varian tetap mengambil warranty fields dari product_variants.

Copy Telegram saat ini menyebut rentang 1×24 jam–30 hari. Sebelum varian dengan
Full Garansi/custom dipublikasikan, owner harus memperbarui canonical copy agar tidak
bertentangan dengan data CMS. Perubahan dilakukan sekali dan otomatis berlaku pada
Telegram serta WhatsApp.

### 11.7 Error response

- Nama tidak ditemukan: “Produk tidak ditemukan. Ketik list untuk melihat produk.”
- Nama ambigu: tampilkan maksimal lima kandidat.
- Session angka kedaluwarsa: minta user mengetik nama produk lagi.
- Pay tanpa selected variant: minta user mengetik nama produk dan memilih angka dahulu.
- Varian baru saja nonaktif/habis: beri tahu dan tampilkan ulang varian terbaru.
- Bukti tanpa reply/kode/metode: kirim format caption yang benar tanpa menyimpan file.
- Bukti milik order anggota lain: tolak tanpa membocorkan detail order.
- Bukti duplikat: kembalikan acknowledgement lama, jangan upload/notifikasi ulang.
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
- selected_variant_id;
- variant_message_id dan payment_message_id bila gateway menyediakannya;
- current_order_id/current_order_code;
- current_payment_transaction_id;
- catalog_version atau generated_at;
- expires_at, disarankan 10–15 menit.

Saat angka dipilih, map menentukan ID tetapi data harga/stok tetap di-query ulang.
Setelah pay/payment, session menunjuk order pending yang sama sampai lunas, batal, atau
kedaluwarsa. Session baru tidak boleh membuat order kedua selama order pertama masih
aktif untuk selection yang sama.

### 12.2 Webhook inbox

Simpan event masuk dengan unique provider + external_message_id:

- event duplikat tidak memicu respons/order kedua;
- event media duplikat tidak mengunggah bukti atau memberi notifikasi admin dua kali;
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

Route web POST /api/orders saat ini mensyaratkan proof_url sebelum membuat order.
WhatsApp pay/payment memerlukan order code lebih dahulu agar instruksi dan bukti dapat
dikaitkan. Jangan mengirim proof_url palsu dan jangan melemahkan validasi route web.

Ekstrak internal commerce service baru untuk:

- createPendingChannelOrder dari selected variant;
- reservasi stok atomik;
- idempotency key provider + conversation + member + selection/session;
- payment_method awal pending dan payment_account null;
- attach payment proof setelah order ada;
- confirmPayment dengan compare-and-set agar hanya satu rail pembayaran yang menang.

Saat callback KlikQRIS terkonfirmasi, authoritative method menjadi klikqris. Saat admin
menyetujui bukti SeaBank/e-wallet setelah cek mutasi, authoritative method menjadi
bank:seabank atau ewallet. Jika rail lain masuk setelah order sudah paid, tandai sebagai
payment conflict untuk pemeriksaan/refund manual; jangan kirim fulfillment kedua.

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
- message_outbox generik atau whatsapp_outbox untuk retry pengiriman;
- payment_proofs untuk metadata bukti, order/member/message ID, claimed_method, hash,
  private R2 key, status, dan waktu review;
- whatsapp_message_links bila reply/context provider tidak cukup disimpan pada session;
- whatsapp conversation/member/payment message ID pada order atau metadata order;
- channel/destination pada fulfillment job.

Simpan group ID dan nomor allowlist sebagai secret/env/config terkontrol, bukan
hardcode.

### 13.5 Kontrak payment_proofs

Rancangan minimum:

    CREATE TABLE payment_proofs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT NOT NULL REFERENCES orders(code),
      sales_channel TEXT NOT NULL DEFAULT 'whatsapp',
      conversation_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      reply_to_message_id TEXT,
      claimed_method TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      reviewed_by TEXT,
      reviewed_at TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(sales_channel, external_message_id)
    );

Status minimum: submitted, approved, rejected. claimed_method hanya QRIS, SEABANK, atau
EWALLET dan belum menjadi metode authoritative sebelum provider/admin mengonfirmasi.

Satu order boleh mempunyai bukti pengganti setelah bukti sebelumnya rejected, tetapi
hanya satu bukti submitted/approved yang aktif. Admin action harus diaudit dan bersifat
idempotent.

Webhook WhatsApp tidak boleh memanggil atau melemahkan proteksi same-origin pada
/api/proof/upload. Ekstrak validator magic bytes/size dan R2 writer menjadi helper
internal bersama; route web tetap memakai proteksi browser, sedangkan webhook hanya
memanggil helper setelah signature, group, member, dan order lolos validasi.

---

## 14. Security dan privasi

- Proses hanya group ID allowlist.
- Abaikan pesan yang dikirim nomor bot sendiri.
- Batasi command per member dan per group.
- Verifikasi signature/token webhook dengan timing-safe comparison.
- Jangan menerima harga, total, product label, atau garansi dari client sebagai fakta.
- Secret fulfillment tetap dienkripsi.
- QR, rekening pembayaran, kode order, dan acknowledgement bukti boleh dikirim hanya
  pada grup allowlist sesuai keputusan owner.
- Kredensial produk, password, license, hasil fulfillment, detail provider, dan secret
  tetap dilarang dikirim ke grup.
- Bot wajib memperingatkan bahwa bukti di grup terlihat anggota lain dan meminta user
  menyensor data yang tidak relevan.
- Bukti yang diunduh disimpan private di R2 dan hanya admin yang dapat membukanya dari
  CMS; URL media gateway tidak dijadikan URL permanen.
- File bukti tidak boleh dieksekusi, dipublikasikan, atau dipercaya berdasarkan ekstensi.
- Log tidak boleh memuat token gateway, KlikQRIS credential, QR payload mentah,
  file bukti, nomor rekening lengkap, password, atau shared secret.
- Pisahkan feature flag WhatsApp discovery, group payment, proof intake, dan fulfillment.

Catatan operasional: gateway linked-device untuk nomor WhatsApp existing mempunyai
risiko session/logout dan kebijakan platform. Health check serta prosedur reconnect
harus tersedia, dan owner menerima risiko gateway sebelum go-live.

---

## 15. Urutan implementasi wajib

### Fase 0 — Baseline dan characterization

- Petakan seluruh pembacaan products.price, stock, fulfillment, dan telegram_enabled.
- Tambah test karakterisasi web checkout, Telegram, KlikQRIS, dan fulfillment.
- Petakan payment_methods, upload bukti R2, dan alur review admin yang sudah ada.
- Ekstrak kebijakan garansi canonical agar Telegram/WhatsApp tidak mempunyai copy berbeda.
- Lakukan gateway spike untuk outbound QR image dan inbound group media: bentuk media
  URL, auth download, expiry, MIME, external message ID, member ID, serta quoted message
  ID. Dokumentasikan fallback caption bila reply metadata tidak tersedia.
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
- Implement command garansi dari canonical warranty policy yang sama dengan Telegram.
- Rilis read-only tanpa payment lebih dahulu.

**Gate:** update CMS tampil di WhatsApp tanpa deploy/sinkronisasi dan tidak ada balasan
di luar allowlist.

### Fase 6 — WhatsApp group payment dan bukti

- Implement pay/payment hanya setelah selected variant.
- Create order sales_channel=whatsapp.
- Tampilkan QRIS KlikQRIS, SeaBank, dan e-wallet dari konfigurasi pusat di grup.
- Implement instruksi/reply caption bukti wajib.
- Download, validasi, dedupe, dan simpan bukti ke private R2.
- Tambah CMS queue untuk review bukti SeaBank/e-wallet.
- Gunakan callback/status KlikQRIS sebagai sumber konfirmasi QRIS.
- Tambah WhatsApp delivery adapter.
- Aktifkan fulfillment bertahap.

**Gate:** satu pay hanya membuat satu order/invoice; satu media hanya menjadi satu bukti;
proof tidak dapat memalsukan status paid; kredensial fulfillment tidak pernah muncul di
grup.

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
- WHATSAPP_GROUP_PAYMENT;
- WHATSAPP_PROOF_INTAKE;
- WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT;
- WHATSAPP_KLIKQRIS;
- WHATSAPP_FULFILLMENT.

Urutan aktivasi:

1. migrate/backfill dalam kondisi flag off;
2. CMS untuk admin internal;
3. website pada sebagian traffic atau setelah review;
4. Telegram;
5. WhatsApp discovery pada satu grup allowlist;
6. command garansi;
7. group payment;
8. proof intake dan review admin;
9. fulfillment.

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
- payment preflight menolak aktivasi WA bila QRIS/SeaBank/e-wallet tidak lengkap;
- queue bukti hanya dapat dibaca admin;
- approve/reject tercatat audit dan retry tidak memicu fulfillment ganda.

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
- selected variant meminta balasan pay/payment;
- pay tanpa selection ditolak;
- pay dan payment bersifat case-insensitive;
- retry pay memakai ulang order/invoice pending yang sama;
- pesan pembayaran memuat order, nominal, QRIS, SeaBank, e-wallet, serta instruksi bukti;
- nomor/rekening selalu berasal dari payment_methods aktif;
- garansi dan /garansi menghasilkan kebijakan yang sama dengan Telegram;
- bukti tanpa image, reply, kode order, atau metode ditolak;
- bukti order anggota lain ditolak tanpa membocorkan detail;
- image >5 MB, MIME palsu, dan magic bytes salah ditolak;
- bukti valid disimpan private di R2 dan tampil pada queue admin;
- upload/event bukti duplikat hanya diproses sekali;
- bukti tidak pernah langsung mengubah payment menjadi paid;
- callback KlikQRIS dan konfirmasi admin manual tetap authoritative;
- QRIS paid tanpa proof belum menjalankan fulfillment dan memicu pengingat bukti;
- QRIS paid + proof submitted hanya menjalankan satu fulfillment;
- webhook duplikat hanya menghasilkan satu respons;
- bot tidak loop pada pesannya sendiri;
- unauthorized group diabaikan;
- credential produk/fulfillment tidak pernah muncul di grup.

### 17.6 End-to-end

Skenario wajib:

1. Admin menambah varian Gemini 6 Bulan Full Garansi.
2. Varian tampil pada website tanpa deploy.
3. Telegram menampilkan varian yang sama.
4. WhatsApp list tetap hanya menampilkan Gemini satu kali.
5. User mengetik Gemini dan varian baru tampil.
6. User memilih varian.
7. Bot meminta balasan pay/payment.
8. User membalas pay dan bot membuat satu order dengan nominal tepat.
9. Bot mengirim QRIS, SeaBank, e-wallet, dan format bukti wajib di grup.
10. User reply foto bukti dengan kode order/metode.
11. Bukti masuk private R2 dan queue admin, tetapi belum menandai paid.
12. Callback KlikQRIS atau verifikasi admin hanya memicu satu fulfillment.

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
- setelah memilih varian bot meminta pay/payment;
- pay/payment mengirim QRIS, SeaBank, e-wallet, dan instruksi bukti di grup allowlist;
- retry pay tidak membuat order/invoice ganda;
- user diwajibkan reply foto bukti dengan kode order dan metode;
- bukti tervalidasi tersimpan private dan masuk queue admin;
- bukti gambar tidak dapat menandai order paid sendiri;
- fulfillment WhatsApp membutuhkan payment confirmed dan bukti sudah diterima;
- garansi dan /garansi memakai kebijakan canonical yang sama dengan Telegram;
- order menyimpan snapshot varian;
- KlikQRIS memakai harga varian hasil validasi server;
- inventory dan delivery tepat per varian/channel;
- tidak ada credential produk/fulfillment atau secret di grup;
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
8. Konfirmasi bahwa QRIS/rekening dan bukti memang boleh terlihat seluruh anggota grup.
9. SLA serta jumlah pengingat untuk order QRIS yang sudah paid tetapi belum mengirim
   bukti; fulfillment default tetap menunggu bukti.

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
| Group payment, proof intake/review + hardening | 2–3 hari |

Total sekitar **7–11 hari kerja**, bergantung pada kualitas data produk lama dan
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
- [ ] Setelah selection, implement pay/payment → order → QRIS/SeaBank/e-wallet di grup.
- [ ] Wajibkan bukti sebagai image reply dengan kode order + metode.
- [ ] Simpan bukti private, review manual, dan jangan percaya image sebagai status paid.
- [ ] Implement garansi dari canonical policy yang sama dengan Telegram.
- [ ] Scope session per conversation + member.
- [ ] Jaga credential produk/fulfillment tetap privat.
- [ ] Tambah test unit, regression, integration, dan E2E per fase.
- [ ] Update docs/ARCHITECTURE.md, README.md, dan CHANGELOG.md bersama perubahan.
- [ ] Verifikasi dev sesuai AGENTS.md.
- [ ] Commit dan push main hanya setelah seluruh gate fase yang dikerjakan lulus.

Dokumen ini mengunci model dan urutan kerja. Detail kosmetik pesan boleh berubah, tetapi
single source of truth, variant_id server-authoritative, snapshot order, session
per-member, idempotensi pay/bukti, dan otoritas callback/admin tidak boleh dilemahkan.
