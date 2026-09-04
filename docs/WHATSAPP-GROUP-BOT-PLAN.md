# Rencana Eksekusi — Bot Grup WhatsApp AXVARA

**Status:** Handoff ready — planning only, belum diimplementasikan
**Tanggal:** 4 September 2026
**Target:** Nomor WhatsApp AXVARA yang sudah ada, grup WhatsApp yang sudah ada, backend Cloudflare AXVARA yang sama
**Gateway MVP:** Fonnte device gateway
**Payment:** Reuse integrasi KlikQRIS yang sudah aktif dan terbukti bekerja pada bot Telegram

---

## 1. Outcome yang Ditargetkan

Bot WhatsApp AXVARA harus dapat:

1. Berada pada grup WhatsApp AXVARA yang sudah ada melalui nomor WhatsApp yang sekarang.
2. Membalas keyword eksplisit di grup seperti `list`, `produk`, `harga`, `cara order`, `garansi`, dan `admin`.
3. Menampilkan **produk langsung tanpa menu kategori**.
4. Membaca produk aktif langsung dari tabel `products` D1 yang sama dengan website.
5. Otomatis mengikuti perubahan produk web tanpa sinkronisasi manual:
   - produk baru aktif langsung muncul;
   - perubahan nama/harga/stok langsung terbaca;
   - produk nonaktif langsung hilang;
   - perubahan `sort_order` langsung mengubah urutan list WhatsApp.
6. Memindahkan proses order, QRIS, status pembayaran, dan delivery ke chat pribadi agar data pembeli tidak bocor di grup.
7. Membuat QRIS dinamis melalui adapter KlikQRIS AXVARA yang sudah dipakai bot Telegram.
8. Memproses callback pembayaran secara idempotent, memperbarui order, dan menjalankan fulfillment sesuai mode produk.
9. Menggunakan Pages, D1, R2, dan cron Worker AXVARA yang sudah ada. Tidak membuat aplikasi/database/VPS kedua.
10. Dapat dimatikan sebagian atau seluruhnya melalui feature flag tanpa mengganggu website dan Telegram.

### Definisi selesai untuk MVP

MVP dianggap selesai ketika alur berikut berhasil pada satu grup allowlist:

```text
Anggota grup: list
→ bot mengirim daftar produk aktif D1 terbaru
→ anggota: order 12
→ bot memberi link chat pribadi dengan prefilled "beli 12"
→ anggota membuka private chat dan mengonfirmasi pembelian
→ AXVARA membuat order + invoice KlikQRIS tepat satu kali
→ bot mengirim QRIS hanya di private chat
→ pembayaran terkonfirmasi
→ order menjadi lunas
→ fulfillment otomatis atau antrean admin berjalan sesuai mode produk
```

---

## 2. Fakta Baseline Codebase

Agent eksekutor harus mempertahankan baseline berikut:

- Website memakai `products` D1 sebagai sumber katalog utama.
- Bot Telegram sudah memiliki webhook, katalog, invoice KlikQRIS, callback payment, inventory, fulfillment outbox, cron rekonsiliasi, dan admin health.
- KlikQRIS sudah terhubung dan berfungsi pada bot Telegram. **Tidak ada onboarding KlikQRIS baru dan tidak ada credential payment baru untuk WhatsApp.**
- `payment_transactions` sudah channel-agnostic dan harus tetap menjadi ledger pembayaran tunggal.
- `fulfillment_inventory` sudah menyimpan secret terenkripsi untuk produk `unique`.
- `fulfillment_jobs` masih berorientasi Telegram pada bagian delivery dan perlu dibuat channel-aware.
- `orders.sales_channel` saat ini memiliki `CHECK` yang hanya menerima `web` dan `telegram`.
- Seluruh feature flag Telegram/KlikQRIS/fulfillment yang sudah ada harus tetap kompatibel.

Referensi kode sebelum mulai:

- `src/app/api/telegram/webhook/route.ts`
- `src/lib/telegram/*`
- `src/lib/payments/klikqris.ts`
- `src/app/api/payments/klikqris/callback/route.ts`
- `src/lib/fulfillment/{deliver,inventory,crypto}.ts`
- `src/app/api/cron/operations/route.ts`
- `drizzle/migrations/0005_telegram_klikqris.sql`
- `tests/{telegram-bot,klikqris,fulfillment}.regression.test.ts`

### Baseline yang tidak boleh rusak

- `/start`, `/katalog`, `/garansi`, beli, status, callback, dan fulfillment Telegram tetap bekerja.
- Website checkout manual tetap bekerja.
- Schema/order lama tetap terbaca.
- Inventory tidak boleh terjual dua kali.
- Secret fulfillment tidak pernah masuk log atau respons admin health.
- QRIS WhatsApp dan Telegram memakai merchant, adapter, serta ledger yang sama.

---

## 3. Keputusan Arsitektur yang Dikunci

### 3.1 Fonnte untuk grup yang sudah ada

MVP memakai Fonnte sebagai device gateway karena kebutuhan utama adalah membalas di grup WhatsApp biasa yang sudah ada menggunakan nomor yang sudah menjadi anggota grup.

Fonnte mendokumentasikan:

- device disambungkan melalui QR/linked-device;
- webhook pesan masuk membawa `sender`, `member`, `message`, `timestamp`, dan `inboxid`;
- target kirim dapat berupa nomor pribadi atau ID grup `...@g.us`;
- autoread dapat diaktifkan khusus personal, group, atau keduanya;
- daftar grup dapat diambil setelah nomor tersambung.

Referensi:

- https://docs.fonnte.com/device/
- https://docs.fonnte.com/webhook-reply-message-with-nodejs/
- https://docs.fonnte.com/api-send-message/
- https://docs.fonnte.com/api-update-whatsapp-group-list/

Fonnte adalah dependency eksternal, tetapi bukan backend kedua milik AXVARA. Seluruh logic bisnis tetap di Cloudflare.

### 3.2 Meta Cloud API bukan jalur grup lama untuk MVP

Meta Cloud API tetap menjadi opsi jangka panjang untuk percakapan bisnis resmi 1:1. Jangan mengganti scope implementasi ini ke Meta Cloud API tanpa keputusan owner, karena group business API tidak sama dengan menjadikan nomor API sebagai bot pada grup WhatsApp biasa yang sudah ada.

Referensi resmi:

- https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- https://faq.whatsapp.com/1168258858576291

### 3.3 Satu commerce core, tiga channel

Arsitektur target:

```text
                         ┌────────────────────┐
Web checkout ───────────▶│                    │
Telegram webhook ───────▶│ AXVARA Commerce    │──▶ D1 products/orders/payment
Fonnte WA webhook ──────▶│ Core               │──▶ R2 media/QR fallback
                         │                    │──▶ KlikQRIS
                         └─────────┬──────────┘
                                   │
                                   ▼
                         Fulfillment outbox
                                   │
                   ┌───────────────┴──────────────┐
                   ▼                              ▼
             Telegram adapter               WhatsApp adapter
```

Business logic tidak boleh digandakan penuh ke route WhatsApp. Ekstraksi harus terarah: katalog, create invoice/order, ownership status, dan delivery dispatch menjadi service bersama; format pesan tetap per-channel.

### 3.4 Grup untuk discovery, private chat untuk transaksi

Di grup hanya boleh ada informasi publik:

- daftar produk;
- harga/stok publik;
- cara order;
- garansi;
- kontak admin;
- link menuju private chat.

Di grup dilarang mengirim:

- QRIS invoice;
- nomor order beserta detail pembeli;
- status pembayaran personal;
- bukti transfer;
- akun, password, key, atau license;
- pesan error internal/provider.

### 3.5 Produk tanpa kategori

WhatsApp tidak mempunyai menu kategori. Keyword `list` dan `produk` langsung menampilkan semua produk aktif dengan pagination.

Kategori D1 tetap dipertahankan untuk website dan Telegram, tetapi tidak dipakai dalam navigasi WhatsApp.

### 3.6 Plain-text command, bukan button legacy

Gunakan command teks agar stabil pada grup dan private chat:

```text
list
list 2
detail 12
harga capcut
order 12
beli 12
status AXV-...
garansi
admin
batal
```

Jangan bergantung pada button Fonnte karena dokumentasinya menandai fitur button sebagai deprecated.

### 3.7 Satu produk per invoice pada MVP

MVP membatasi satu produk, quantity satu, per invoice WhatsApp. Cart multi-item ditunda. Ini selaras dengan flow bot Telegram saat ini dan memperkecil race stok serta kompleksitas percakapan.

---

## 4. Scope dan Non-Goal

### Masuk MVP

- Satu nomor WhatsApp existing sebagai device.
- Satu atau beberapa ID grup melalui allowlist, dengan satu grup sebagai canary awal.
- Keyword deterministic grup dan personal.
- Daftar produk langsung, tanpa kategori.
- Pagination daftar produk.
- Detail dan pencarian harga dari D1.
- Link deep-link grup ke private chat.
- Order private chat dengan konfirmasi garansi.
- QRIS dinamis KlikQRIS.
- Callback, expiry, cancel, stock restore, dan fulfillment.
- Status order dengan verifikasi ownership.
- Admin health WhatsApp dan error ringkas.
- Feature flag dan audit minimum.
- Fallback ke website/admin jika gateway atau payment tidak tersedia.

### Ditunda

- AI/LLM untuk menjawab pesan bebas.
- Natural-language recommendation.
- Cart multi-item.
- Kupon, affiliate, dan loyalty.
- WhatsApp Flows atau katalog Commerce Manager Meta.
- Multi-device rotation.
- Broadcast marketing.
- Membaca histori grup lama.
- Moderasi grup, hapus pesan, kick/ban anggota.
- Migrasi ke Meta Cloud API.

### Dilarang pada MVP

- Menjawab setiap pesan grup.
- Mengirim QRIS atau fulfillment di grup.
- Menyimpan seluruh isi percakapan.
- Menjalankan Baileys/whatsapp-web.js sendiri di Cloudflare.
- Menaruh token Fonnte, group ID sensitif, atau secret payment di Git.
- Menyalin credential KlikQRIS ke secret baru khusus WhatsApp.
- Mengubah adapter KlikQRIS yang sudah bekerja tanpa regression test.

---

## 5. UX dan Command Contract

### 5.1 Normalisasi input

Sebelum routing:

1. Trim whitespace.
2. Ubah ke lowercase hanya untuk pencocokan command.
3. Collapse whitespace berulang.
4. Jangan mengubah isi order code atau nama produk yang dipakai untuk query.
5. Abaikan attachment tanpa caption pada MVP.
6. Abaikan pesan yang berasal dari device/bot sendiri untuk mencegah reply loop.

### 5.2 Trigger di grup

Bot hanya merespons jika pesan memenuhi salah satu:

- exact command: `list`, `produk`, `cara order`, `garansi`, `admin`;
- structured command: `list <halaman>`, `harga <query>`, `detail <id>`, `order <id>`, `status <code>`;
- optional prefix yang disepakati: `.list`, `/list`, `#list`.

Jangan merespons kata yang kebetulan mengandung keyword, misalnya “playlist” tidak memicu `list`.

### 5.3 Output `list`

Query:

```sql
SELECT id, name, price, compare_price, stock, sort_order
FROM products
WHERE is_active = 1
ORDER BY sort_order ASC, id ASC
LIMIT ? OFFSET ?;
```

Format maksimal 8–10 produk per halaman:

```text
*LIST PRODUK AXVARA — 1/3*

#12 ChatGPT Plus 1 Bulan
Rp89.000 • Tersedia

#18 CapCut Pro
Rp35.000 • Tersedia

Ketik:
detail 12 — lihat detail
order 12 — lanjut beli via chat pribadi
list 2 — halaman berikutnya

axvara.tech
```

Aturan:

- Produk `stock=0` tidak perlu disembunyikan; tampilkan `Habis` agar pengguna memahami status terbaru.
- Produk `is_active=0` selalu disembunyikan.
- `stock=-1` ditampilkan sebagai `Tersedia`.
- Jangan menampilkan kategori.
- Harga selalu diformat dari integer Rupiah server-side.
- Tidak ada list hardcoded di `messages.ts`.

### 5.4 Output `harga <query>`

- Cari case-insensitive pada nama dan deskripsi.
- Maksimal lima hasil.
- Jika satu hasil, tampilkan ringkasan dan command `order <id>`.
- Jika lebih dari satu, tampilkan ID stabil masing-masing.
- Jika kosong, arahkan ke `list` atau website.

### 5.5 `detail <id>`

Tampilkan:

- nama;
- harga saat ini;
- harga coret jika valid;
- status stok;
- deskripsi ringkas yang sudah di-escape;
- jenis fulfillment dalam bahasa pengguna, tanpa mengungkap detail internal;
- garansi mengikuti deskripsi produk dan link `/garansi-replace`;
- perintah `order <id>`.

### 5.6 `order <id>` dari grup

Route grup **tidak membuat order**. Bot membalas link:

```text
https://wa.me/<WHATSAPP_PUBLIC_NUMBER>?text=beli%20<PRODUCT_ID>
```

Copy harus menjelaskan bahwa pembayaran dan delivery dilakukan di chat pribadi.

### 5.7 `beli <id>` di private chat

1. Query produk aktif terbaru dari D1.
2. Validasi stok dan inventory `unique`.
3. Tampilkan snapshot nama/harga terbaru.
4. Minta konfirmasi: balas `ya` atau `batal`.
5. Simpan pending action dengan TTL 15 menit.
6. `ya` melakukan query ulang dan membandingkan harga/status dengan snapshot.
7. Jika harga berubah, kirim harga baru dan minta konfirmasi ulang.
8. Jika produk nonaktif/habis, batalkan state tanpa membuat order.

### 5.8 Invoice private

Pesan QRIS harus berisi:

- kode order;
- nama produk;
- nominal persis yang harus dibayar;
- waktu kedaluwarsa;
- QR image;
- command `status <code>` dan `batal`;
- pengingat garansi.

Jangan mengirim credential produk sebelum status provider `paid` terverifikasi.

### 5.9 Status order

- Di grup: jangan tampilkan status; arahkan ke private chat.
- Di private: cocokkan identifier pengirim dengan owner order.
- Order milik identifier lain diperlakukan `tidak ditemukan` agar tidak membocorkan keberadaan kode.
- Status yang didukung: menunggu pembayaran, lunas, kedaluwarsa, gagal, dibatalkan, menunggu admin, terkirim.

---

## 6. Sumber Kebenaran Produk dan Sinkronisasi Otomatis

### Prinsip utama

**Tidak ada proses sync produk.** WhatsApp membaca tabel `products` D1 yang sama dengan web. Karena sumbernya sama, perubahan web/admin otomatis menjadi perubahan WhatsApp.

### Aturan implementasi

- Jangan membuat tabel katalog WhatsApp.
- Jangan membuat JSON snapshot produk permanen.
- Jangan menambah `whatsapp_enabled` pada MVP; `products.is_active` adalah flag tunggal agar web dan WhatsApp tidak divergen.
- Jangan memakai seed/fallback produk di production.
- `list`, `harga`, `detail`, dan `beli` selalu query D1.
- Untuk MVP, tidak perlu cache application/global.
- Jika cache ditambahkan kemudian, TTL maksimal 15 detik dan mutation admin harus menginvalidasi cache.
- Saat konfirmasi pembelian, harga, status aktif, stok, fulfillment mode, dan inventory harus diambil ulang.
- Order menyimpan item snapshot agar riwayat tidak berubah ketika produk diedit setelah transaksi.

### Dampak perubahan admin

| Perubahan admin/web | Hasil di WhatsApp |
|---|---|
| Tambah produk aktif | Muncul pada pemanggilan `list` berikutnya |
| Edit nama | Nama baru tampil pada query berikutnya |
| Edit harga | Harga baru tampil dan divalidasi ulang saat `ya` |
| Ubah `sort_order` | Urutan list berubah |
| Stok menjadi 0 | Tampil `Habis`, tidak dapat dibeli |
| Nonaktifkan produk | Hilang dari list/detail dan pembelian ditolak |
| Edit kategori | Tidak memengaruhi UX WhatsApp |
| Edit gambar | Detail/order dapat memakai gambar terbaru jika fitur media detail diaktifkan |

---

## 7. Struktur Data dan Migrasi

Gunakan migrasi berikutnya, misalnya `drizzle/migrations/0007_whatsapp_bot.sql`. Nomor final harus dicek lagi saat eksekusi agar tidak bentrok dengan migrasi baru.

### 7.1 `whatsapp_updates`

Untuk idempotensi webhook dan retry Fonnte:

```sql
CREATE TABLE whatsapp_updates (
  event_key TEXT PRIMARY KEY,
  inbox_id TEXT,
  device_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','done','failed','ignored')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT,
  payload_hash TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

`event_key`:

1. Gunakan `inboxid` jika tersedia dan stabil.
2. Jika tidak tersedia, hash SHA-256 atas field kanonis: device + sender/group + member + timestamp + normalized message.
3. Jangan menyimpan raw payload penuh.

### 7.2 `whatsapp_sessions`

State private chat dengan TTL:

```sql
CREATE TABLE whatsapp_sessions (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  conversation_id TEXT NOT NULL,
  pending_action TEXT,
  pending_product_id INTEGER REFERENCES products(id),
  quoted_price INTEGER,
  state_expires_at TEXT,
  last_group_id TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

`user_id` harus menerima nomor maupun identifier `@lid`; jangan berasumsi seluruh member grup selalu berupa nomor telepon.

### 7.3 Perubahan `orders`

Target akhir:

- `sales_channel` menerima `whatsapp`.
- tambah `whatsapp_user_id TEXT`.
- tambah `whatsapp_conversation_id TEXT` jika diperlukan untuk reply target.

Constraint existing hanya menerima `web|telegram`, sehingga migrasi tidak cukup dengan `ALTER COLUMN`. Agent harus:

1. membuat shadow table dengan seluruh kolom/constraint terbaru;
2. copy data existing tanpa transformasi lossy;
3. swap table secara aman;
4. membuat ulang index;
5. memastikan FK `payment_transactions`, `fulfillment_jobs`, dan inventory tetap valid;
6. menjalankan `PRAGMA foreign_key_check` pada local/preview D1;
7. membuktikan seluruh order lama tetap bisa dibaca sebelum production.

Jangan menyimpan order WhatsApp dengan `sales_channel='web'` atau `'telegram'` sebagai workaround.

### 7.4 Perubahan `fulfillment_jobs`

Tambahkan field generik secara backward-compatible:

```sql
delivery_channel TEXT CHECK (delivery_channel IN ('telegram','whatsapp')),
recipient_id TEXT,
provider_message_id TEXT
```

Backfill job Telegram existing:

```text
delivery_channel = telegram
recipient_id = orders.telegram_chat_id
provider_message_id = telegram_message_id
```

`telegram_message_id` jangan langsung dihapus pada migrasi pertama. Deprecate setelah code dan data terverifikasi.

### 7.5 Optional audit table

Jika admin memerlukan observability lebih baik, gunakan metadata minimum:

```sql
CREATE TABLE bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_hash TEXT,
  order_code TEXT,
  outcome TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Jangan menyimpan isi chat, QR, atau secret fulfillment di tabel audit.

---

## 8. Kontrak Environment dan Secret

Tambahkan ke `.env.example` hanya placeholder:

```text
# WhatsApp via Fonnte
FONNTE_TOKEN=__SET_IN_CLOUDFLARE__
FONNTE_WEBHOOK_SECRET=__SET_IN_CLOUDFLARE__
WHATSAPP_DEVICE_ID=__SET_IN_CLOUDFLARE__
WHATSAPP_PUBLIC_NUMBER=__SET_IN_CLOUDFLARE__
WHATSAPP_ALLOWED_GROUP_IDS=__SET_IN_CLOUDFLARE__
WHATSAPP_BOT_ENABLED=false
WHATSAPP_GROUP_REPLY_ENABLED=false
WHATSAPP_ORDER_ENABLED=false
WHATSAPP_AUTO_FULFILLMENT_ENABLED=false
```

Reuse tanpa duplikasi:

```text
KLIKQRIS_MODE
KLIKQRIS_API_KEY
KLIKQRIS_MERCHANT_ID
KLIKQRIS_PAYMENTS_ENABLED
FULFILLMENT_ENCRYPTION_KEY
AUTO_FULFILLMENT_ENABLED
```

Aturan:

- Nilai nyata hanya di Cloudflare Pages Secrets/Variables.
- Token tidak boleh ada di query outbound GET; gunakan POST + `Authorization` header.
- `WHATSAPP_ALLOWED_GROUP_IDS` diparse sebagai daftar exact, bukan substring.
- Feature flag WhatsApp default `false` pada deploy pertama.
- Jangan membaca atau mencetak nilai secret dalam test/log/chat.

---

## 9. Struktur File Target

```text
src/lib/commerce/
├── bot-catalog.ts            # query list/search/detail langsung dari D1
├── bot-order.ts              # create/reuse pending invoice secara idempotent
├── bot-order-status.ts       # ownership + status mapping
└── delivery-dispatch.ts      # pilih Telegram atau WhatsApp adapter

src/lib/whatsapp/
├── api.ts                    # wrapper Fonnte send text/media + timeout
├── types.ts                  # schema webhook dan response
├── commands.ts               # parser exact command
├── messages.ts               # copy WhatsApp, escape/length guard
└── identity.ts               # sender/group/member/@lid normalization

src/app/api/whatsapp/
├── webhook/route.ts          # inbound message webhook
└── device-status/route.ts    # connect/disconnect webhook

src/app/api/admin/whatsapp/
├── health/route.ts           # health aman, tanpa secret
└── test/route.ts             # test message admin-only ke allowlist

drizzle/migrations/
└── 0007_whatsapp_bot.sql

tests/
├── whatsapp-bot.regression.test.ts
├── bot-commerce.regression.test.ts
└── multi-channel-fulfillment.regression.test.ts
```

### Batas ekstraksi

Jangan memindahkan semua isi route Telegram dalam satu refactor besar. Urutan aman:

1. Tambah characterization test behavior Telegram.
2. Ekstrak fungsi katalog murni/DB terlebih dahulu.
3. Ekstrak create invoice/order dengan input channel-neutral.
4. Buat Telegram memanggil service baru tanpa mengubah copy/keyboard.
5. Pastikan test Telegram tetap hijau.
6. Baru tambahkan WhatsApp adapter.

---

## 10. Kontrak Service Bersama

### 10.1 Katalog

```ts
type ProductListInput = {
  page: number;
  perPage: number;
};

type ProductListResult = {
  products: Array<{
    id: number;
    name: string;
    price: number;
    comparePrice: number | null;
    stock: number;
  }>;
  page: number;
  totalPages: number;
  total: number;
};
```

Service tidak mengetahui format HTML Telegram atau teks WhatsApp.

### 10.2 Create order/invoice

```ts
type BotOrderChannel = "telegram" | "whatsapp";

type CreateBotInvoiceInput = {
  channel: BotOrderChannel;
  productId: number;
  channelUserId: string;
  conversationId: string;
  customerName: string;
  customerWa: string;
  expectedPrice: number;
  idempotencyKey: string;
};

type BotInvoiceResult = {
  orderCode: string;
  productName: string;
  requestedAmount: number;
  payableAmount: number;
  qrisUrl: string | null;
  qrisImage: string | null;
  directUrl: string | null;
  expiresAt: string;
  reused: boolean;
};
```

Aturan service:

- query ulang produk authoritative;
- tolak price drift dengan error typed;
- tolak produk nonaktif/habis;
- cek inventory unique;
- satu pending invoice per user + produk;
- reserve inventory dan stok tepat satu kali;
- panggil adapter KlikQRIS existing;
- insert `orders` dan `payment_transactions` konsisten;
- buat fulfillment job tepat satu kali;
- rollback/compensate stok dan inventory jika invoice/order gagal;
- tidak mengirim pesan; delivery dilakukan adapter channel setelah commit.

### 10.3 Delivery dispatch

```ts
type DeliveryTarget = {
  channel: "telegram" | "whatsapp";
  recipientId: string;
};

interface DeliveryAdapter {
  sendText(target: DeliveryTarget, text: string): Promise<{ messageId?: string }>;
  sendImage(
    target: DeliveryTarget,
    image: string,
    caption: string,
  ): Promise<{ messageId?: string }>;
}
```

Plaintext secret hanya boleh berada dalam memory selama pemanggilan adapter dan tidak boleh masuk error/log.

---

## 11. Webhook Fonnte

### 11.1 Endpoint

```text
POST https://axvara.tech/api/whatsapp/webhook?key=<unguessable-secret>
```

Jika Fonnte mendukung custom header/signature pada saat implementasi, pakai header. Jika tidak, secret URL tetap diperlukan karena contoh webhook publik Fonnte tidak menunjukkan signed payload.

### 11.2 Validasi berurutan

1. Hanya `POST`.
2. Content type dan ukuran body maksimal, misalnya 64 KB.
3. Constant-time compare webhook secret.
4. Parse JSON dengan Zod `.passthrough()` agar forward-compatible.
5. Cocokkan `device` exact dengan `WHATSAPP_DEVICE_ID`.
6. Normalisasi `sender`, `member`, group ID, dan private recipient.
7. Tolak timestamp terlalu lama jika field tersedia.
8. Tolak message dari device sendiri.
9. Claim `event_key` pada `whatsapp_updates`.
10. Tentukan group/private.
11. Jika group, cek exact allowlist.
12. Cek rate limit/cooldown.
13. Route command.
14. Mark `done`, `ignored`, atau `failed`.

### 11.3 Retry dan idempotensi

Fonnte mendokumentasikan retry webhook sampai 15 kali dengan jeda sekitar satu menit jika endpoint tidak mengembalikan HTTP 200:

https://docs.fonnte.com/update-12-januari-2026/

Konsekuensi:

- duplicate webhook adalah kondisi normal;
- reply FAQ tidak boleh terkirim berulang;
- create order/invoice harus memakai idempotency key;
- callback/payment tetap memakai constraint unik yang sudah ada;
- event `done` atau `ignored` selalu mengembalikan 200;
- error validation permanen mengembalikan 200 agar tidak retry terus;
- error transient boleh tercatat `failed`, tetapi jangan membuat invoice kedua.

### 11.4 Timeout outbound

- Fonnte API call maksimum 8–10 detik dengan `AbortController`.
- Jika send gagal, jangan mengulang create order.
- Retry hanya terhadap outbox/send operation.
- Simpan error code ringkas, bukan full response yang mungkin mengandung data.

---

## 12. Flow Teknis Detail

### 12.1 `list` dari grup/private

1. Webhook tervalidasi dan event diklaim.
2. Router mengenali exact command.
3. Query D1 aktif tanpa kategori.
4. Format satu halaman.
5. Kirim ke conversation asal.
6. Mark event selesai.

Tidak ada sync job, cron katalog, atau salinan data.

### 12.2 `order <id>` dari grup

1. Query produk untuk memastikan masih aktif.
2. Jika tidak valid, balas produk tidak tersedia.
3. Bentuk deep-link private dengan ID produk.
4. Kirim hanya link dan instruksi.
5. Jangan membuat row order/session pembayaran.

### 12.3 `beli <id>` private

1. Pastikan conversation bukan grup.
2. Query produk aktif, stock, fulfillment mode, dan inventory.
3. Cek order pending existing milik user untuk produk yang sama.
4. Jika ada, kirim ulang informasi invoice/status, bukan invoice baru.
5. Jika tidak, simpan state `confirm_purchase` selama 15 menit.
6. Kirim ringkasan harga + ketentuan.
7. Tunggu `ya` atau `batal`.

### 12.4 Konfirmasi `ya`

1. Ambil session yang belum expired.
2. Query ulang produk.
3. Jika harga berubah, update `quoted_price` dan minta `ya` lagi.
4. Bentuk idempotency key dari event/session/user/product.
5. Jalankan `createBotInvoice` bersama.
6. Normalisasi QR provider menjadi URL HTTPS yang bisa di-fetch Fonnte.
7. Kirim QR ke private recipient.
8. Clear session setelah invoice tersimpan/kirim tercatat.

### 12.5 QR image fallback

Urutan sumber gambar:

1. `invoiceResult.qrisUrl` HTTPS dari KlikQRIS.
2. Jika hanya data URI/base64, decode dengan batas ukuran dan magic-byte PNG/JPEG.
3. Simpan sementara di R2 `qris/invoices/<random>.png`.
4. Sajikan melalui URL random/expiring yang dapat diambil server Fonnte.
5. Jangan gunakan nama file berbasis nomor WA.
6. Hapus/expire aset setelah transaksi selesai atau retention singkat.

### 12.6 Callback paid

1. Parse callback via adapter KlikQRIS existing.
2. Cocokkan transaksi provider/order/merchant/signature/amount.
3. Re-check status ke KlikQRIS.
4. Jika re-check gagal karena network/provider, **jangan menerima paid secara fail-open**; simpan untuk rekonsiliasi cron.
5. Atomic compare-and-set `pending → paid`.
6. Update order `lunas` tepat satu kali.
7. Dispatch notifikasi ke channel asal.
8. Jalankan fulfillment jika feature flag channel dan global aktif.

Catatan wajib: route saat ini memiliki fallback yang menerima callback ketika server-side status check gagal. Agent harus mengubahnya menjadi fail-closed sebelum mengaktifkan auto-fulfillment WhatsApp, sambil menambah regression test agar Telegram tetap bekerja.

### 12.7 Fulfillment

`manual`:

- buyer menerima pembayaran berhasil + estimasi penanganan admin;
- admin mendapat notifikasi dengan link chat buyer;
- job menjadi `manual_required`;
- tidak ada secret otomatis.

`shared`:

- decrypt shared secret di memory;
- kirim ke private recipient sesuai `delivery_channel`;
- mark delivered setelah provider send berhasil;
- retry 1/5/15/60 menit menggunakan outbox existing.

`unique`:

- gunakan inventory yang sudah reserved untuk order;
- decrypt dan kirim ke private recipient;
- mark inventory/job/order delivered dalam urutan yang idempotent;
- jangan reserve item kedua saat retry.

### 12.8 Expiry/cancel

- Invoice expired mengembalikan stok/inventory tepat satu kali.
- Buyer hanya dapat cancel order pending miliknya.
- Paid tidak dapat dibatalkan lewat chat.
- Pesan expiry/cancel dikirim melalui channel order.
- Cron operations harus memilih adapter berdasarkan channel.

---

## 13. Rate Limit, Anti-Spam, dan Privacy

### Grup

- Allowlist exact group ID.
- Maksimal lima command/user/menit.
- Cooldown `list` global per grup 20–30 detik.
- Maksimal satu respons per inbound event.
- Unknown message diabaikan tanpa help otomatis.
- Help hanya dikirim ketika command `help`/`bantuan` diminta.
- Jika pesan bot sendiri masuk kembali, abaikan.

### Private

- Maksimal 10 command/user/menit.
- Maksimal satu pending order aktif per user+produk.
- Maksimal tiga create-invoice attempt/15 menit per user.
- Session state expired otomatis.
- Order status wajib ownership check.

### Data minimum

Simpan hanya:

- identifier user/conversation;
- display name opsional;
- pending action dan expiry;
- message/event key;
- order/payment/fulfillment metadata yang sudah diperlukan bisnis.

Jangan simpan seluruh chat grup/private. Jangan log nomor penuh; mask atau hash untuk observability.

---

## 14. Admin UX dan Observability

Perluas menu **Bot & Otomasi**, bukan membuat dashboard baru.

### Health card WhatsApp

Tampilkan tanpa secret:

- configured: ya/tidak;
- feature flag bot/group/order/fulfillment;
- status device terakhir: connected/disconnected/unknown;
- timestamp webhook terakhir;
- ID grup allowlist dalam bentuk masked/label;
- jumlah event 24 jam: done/ignored/failed;
- order WhatsApp menurut payment status;
- fulfillment job WhatsApp menurut status;
- error code terakhir yang disanitasi;
- quota/provider status jika endpoint Fonnte mengizinkan dan aman.

### Aksi admin

- kirim pesan test ke grup allowlist;
- kirim pesan test ke nomor admin yang telah dikonfigurasi;
- tidak boleh menerima target bebas dari request tanpa allowlist;
- tombol refresh health;
- jangan menyediakan UI untuk menampilkan/copy token.

### Logging

Gunakan event terstruktur:

```text
channel=whatsapp
event=command_received|reply_sent|invoice_created|delivery_failed
command=list|detail|order|status
conversation_hash=...
order_code=...
outcome=ok|ignored|failed
error_code=...
```

Tidak boleh mencatat raw token, full payload, QR base64, nomor penuh, atau credential produk.

---

## 15. Test Plan

### 15.1 Characterization sebelum refactor

- Telegram list/detail/beli menghasilkan behavior lama.
- Satu pending order Telegram tidak digandakan.
- KlikQRIS request shape, mode, auth header, parsing, dan amount tetap sama.
- Callback duplicate tetap idempotent.
- Shared/unique/manual fulfillment Telegram tetap sama.

### 15.2 Unit test WhatsApp

- Parser exact `list`; `playlist` tidak match.
- Prefix optional dinormalisasi.
- Pagination clamp dan output length.
- Escape nama/deskripsi produk.
- Group/private identity normalization.
- `@lid` tidak diperlakukan sebagai nomor telepon.
- Deep-link private di-encode benar.
- Allowed group exact match.
- Self-message diabaikan.
- Session expiry dan cancel.
- Price drift meminta konfirmasi ulang.
- Status ownership tidak membocorkan order lain.

### 15.3 Product single-source test

Test wajib membuktikan:

1. Insert produk aktif ke D1 fixture → `list` langsung memuat produk.
2. Edit harga → `harga` dan `detail` memakai harga baru.
3. Ubah `sort_order` → list berubah urutan.
4. Set stock 0 → pembelian ditolak.
5. Set `is_active=0` → hilang dari list dan detail tidak tersedia.
6. Edit kategori saja → produk tetap tampil karena list WhatsApp tidak memakai kategori.
7. Tidak ada tabel/fixture katalog WhatsApp yang perlu di-update.

### 15.4 Webhook/idempotency test

- Secret salah ditolak.
- Device ID salah diabaikan/ditolak.
- Grup bukan allowlist diabaikan.
- Payload terlalu besar ditolak.
- Duplicate event hanya menghasilkan satu reply.
- Retry setelah send failure tidak membuat order kedua.
- Payload tanpa inboxid memakai event hash stabil.
- Unknown command mengembalikan 200 tanpa reply.

### 15.5 Payment test

- WhatsApp dan Telegram memakai adapter KlikQRIS yang sama.
- Duplicate `ya` hanya menghasilkan satu order dan transaksi.
- Pending order existing direuse.
- Merchant mismatch ditolak.
- Amount mismatch ditolak.
- Signature mismatch ditolak.
- Status re-check network failure tetap pending, tidak menjadi paid.
- Callback paid duplicate tidak menduplikasi fulfillment.
- Expiry mengembalikan stock/inventory sekali.

### 15.6 Fulfillment test

- Delivery Telegram tetap memakai adapter Telegram.
- Delivery WhatsApp hanya ke private recipient.
- Job WhatsApp tidak pernah menargetkan group ID.
- Retry tidak mendekripsi/mengirim inventory lain.
- Secret plaintext tidak ada di log/error.
- Manual fulfillment hanya memberitahu admin.
- Provider send sukses menyimpan `provider_message_id`.

### 15.7 Integration/dev test

Jalankan:

```bash
npm test
npx tsc --noEmit
```

Lalu dev dari folder project sesuai `AGENTS.md`, verifikasi:

- `GET /` 200;
- CSS 200;
- `/admin?section=bot` 200;
- endpoint webhook menolak secret salah;
- endpoint admin WhatsApp menolak request tanpa admin session;
- tidak ada compile error pada `/tmp/axvara-dev.log`;
- visual admin health diverifikasi dengan Chrome DevTools MCP.

### 15.8 Canary real-device

Gunakan satu grup allowlist dan satu nomor buyer uji:

1. `list` menampilkan produk live.
2. Edit harga produk dari admin.
3. `list` ulang menampilkan harga baru tanpa deploy/sync.
4. `order <id>` di grup hanya memberi private link.
5. `beli <id>` di private meminta konfirmasi.
6. `ya` mengirim QRIS.
7. Bayar invoice nominal kecil yang disetujui owner.
8. Callback menandai lunas sekali.
9. Buyer menerima hasil sesuai fulfillment.
10. Admin health dan notifikasi benar.

---

## 16. Acceptance Criteria

### Katalog

- [ ] `list` menampilkan produk langsung tanpa kategori.
- [ ] Data berasal dari D1 `products`, bukan hardcode/cache permanen.
- [ ] Produk baru/edit/nonaktif berubah pada pemanggilan berikutnya.
- [ ] Urutan mengikuti `sort_order`, lalu `id`.
- [ ] Pagination bekerja dan pesan tidak terlalu panjang.

### Grup

- [ ] Hanya grup allowlist yang mendapat respons.
- [ ] Pesan biasa dan substring tidak memicu bot.
- [ ] Ada cooldown anti-spam.
- [ ] `order` tidak menciptakan transaksi di grup.
- [ ] QR, status personal, dan fulfillment tidak pernah dikirim ke grup.

### Private order

- [ ] Produk/harga/stok divalidasi ulang saat konfirmasi.
- [ ] Price drift meminta persetujuan ulang.
- [ ] Satu produk/qty satu/invoice.
- [ ] Duplicate webhook/command tidak membuat order kedua.
- [ ] QRIS KlikQRIS existing terkirim sebagai image/URL yang valid.
- [ ] Ownership status order diverifikasi.

### Payment dan fulfillment

- [ ] Callback fail-closed ketika status provider tidak dapat dikonfirmasi.
- [ ] Amount, merchant, signature, dan state transition tervalidasi.
- [ ] Paid/expired diproses tepat satu kali.
- [ ] Stock dan inventory konsisten.
- [ ] Shared/unique dikirim private; manual masuk admin.
- [ ] Telegram regression test tetap hijau.

### Operasional

- [ ] Device disconnect terdeteksi dan terlihat di admin/notifikasi.
- [ ] Feature flags dapat menghentikan group/order/fulfillment secara terpisah.
- [ ] Website dan Telegram tetap aktif saat WhatsApp dimatikan.
- [ ] Tidak ada secret/data sensitif di Git atau log.

---

## 17. Urutan Implementasi untuk Agent Eksekutor

### Fase 0 — Baseline dan safety

1. Baca `AGENTS.md`, PRD, DESIGN, ARCHITECTURE, README, CHANGELOG, dan dokumen ini.
2. Cek working tree; jangan sentuh perubahan user yang tidak terkait.
3. Jalankan full tests dan type-check sebagai baseline.
4. Catat behavior Telegram/KlikQRIS yang sudah berjalan.
5. Pastikan `.cf-credentials` tetap ignored tanpa membaca nilainya ke log.

**Exit:** baseline hijau atau failure existing terdokumentasi sebelum edit.

### Fase 1 — Characterization + commerce extraction

1. Tambah test Telegram/KlikQRIS/fulfillment sebelum refactor.
2. Buat `bot-catalog` dengan query D1 live.
3. Ekstrak service create bot invoice/order dari route Telegram.
4. Buat Telegram memakai service bersama.
5. Jangan ubah copy dan keyboard Telegram.

**Exit:** semua test lama dan baru Telegram hijau; payment request tidak berubah.

### Fase 2 — Migrasi multi-channel

1. Tambah tabel update/session WhatsApp.
2. Perluas order channel secara benar.
3. Tambah field generic fulfillment dan backfill Telegram.
4. Uji migration fresh database dan upgrade database existing.
5. Jalankan foreign key/integrity checks.

**Exit:** order existing dapat dibaca; Telegram fulfillment tetap jalan.

### Fase 3 — Fonnte adapter dan webhook read-only

1. Implement client Fonnte dengan timeout dan sanitized error.
2. Implement webhook validation/idempotency.
3. Implement identity + allowlist + rate limit.
4. Implement `list`, `harga`, `detail`, `garansi`, `cara order`, `admin`.
5. Tidak ada order/QRIS pada fase ini.

**Exit:** FAQ bekerja pada fixture dan test group/private.

### Fase 4 — Private order handoff

1. Implement `order <id>` group → deep-link private.
2. Implement `beli`, `ya`, `batal` dan session TTL.
3. Implement ownership status.
4. Pastikan product live/price drift behavior.

**Exit:** order belum memanggil KlikQRIS jika flag order off; flow aman diuji.

### Fase 5 — KlikQRIS reuse

1. Hubungkan `ya` ke shared create-invoice service.
2. Gunakan environment KlikQRIS existing.
3. Implement QR URL/base64 fallback ke R2.
4. Perketat callback menjadi fail-closed.
5. Extend expiry/cancel notification multi-channel.

**Exit:** duplicate command menghasilkan satu invoice; test callback hijau.

### Fase 6 — Multi-channel fulfillment

1. Implement delivery adapter WhatsApp.
2. Dispatch job berdasarkan `delivery_channel`.
3. Backward compatibility Telegram.
4. Cegah target grup untuk secret delivery.
5. Test retry dan failure.

**Exit:** shared/unique/manual benar pada Telegram dan WhatsApp.

### Fase 7 — Admin health

1. Extend Bot & Otomasi.
2. Tambah device status webhook.
3. Tambah stats/audit aman.
4. Tambah test-send dengan allowlist.

**Exit:** admin dapat melihat health tanpa melihat secret.

### Fase 8 — Docs, verification, commit, push

1. Update `docs/ARCHITECTURE.md`, `README.md`, schema docs, `.env.example`.
2. Update `CHANGELOG.md` paling atas.
3. Jalankan test/type-check/build karena perubahan route/schema/payment bersifat major.
4. Jalankan dev verification + Chrome DevTools MCP.
5. Commit scoped.
6. Push `main` sesuai aturan project.
7. Berhenti setelah push; jangan polling GitHub Actions/Cloudflare.

---

## 18. Rollout Production

### Tahap A — Deploy gelap

Deploy seluruh kode dengan semua flag WhatsApp `false`. Set secret via Cloudflare, bukan repository.

### Tahap B — Sambungkan device

1. Buat device Fonnte untuk nomor existing.
2. Scan QR linked-device.
3. Aktifkan autoread group/personal sesuai konfigurasi.
4. Set webhook production.
5. Fetch daftar grup **sekali** dan ambil ID grup AXVARA.
6. Simpan exact group ID ke secret/variable allowlist.

Jangan memanggil fetch-group berulang; dokumentasi Fonnte memperingatkan penggunaan berlebihan dapat meningkatkan risiko pembatasan/ban.

### Tahap C — FAQ canary

- `WHATSAPP_BOT_ENABLED=true`
- `WHATSAPP_GROUP_REPLY_ENABLED=true`
- order/fulfillment tetap `false`
- hanya satu grup allowlist
- observasi keyword, reply loop, quota, dan disconnect 24 jam

### Tahap D — Private order internal

- aktifkan `WHATSAPP_ORDER_ENABLED=true` hanya setelah test internal;
- gunakan satu produk dengan nominal kecil yang disetujui owner;
- validasi invoice/callback/status tanpa auto-fulfillment terlebih dahulu.

### Tahap E — Fulfillment canary

- aktifkan untuk produk test `shared` atau `unique`;
- pastikan secret hanya sampai private chat;
- setelah sukses end-to-end dan retry test, buka seluruh produk.

### Tahap F — Perluasan grup

Tambah group ID baru satu per satu ke allowlist. Tidak ada wildcard.

---

## 19. Rollback

Urutan rollback tanpa deploy:

1. `WHATSAPP_GROUP_REPLY_ENABLED=false` — hentikan reply grup.
2. `WHATSAPP_ORDER_ENABLED=false` — pertahankan FAQ, hentikan invoice baru.
3. `WHATSAPP_AUTO_FULFILLMENT_ENABLED=false` — payment tetap tercatat, delivery manual.
4. `WHATSAPP_BOT_ENABLED=false` — hentikan seluruh processing WhatsApp.
5. Lepas webhook/autoread atau disconnect linked device jika terjadi loop/abuse.

Data order/payment yang sudah dibuat tidak dihapus ketika rollback. Website dan Telegram tetap memakai core yang sama.

Jika KlikQRIS terganggu:

- jangan membuat invoice baru;
- transaksi pending direkonsiliasi cron;
- buyer diarahkan ke checkout website/manual;
- jangan menganggap callback paid sah ketika status provider tidak dapat diperiksa.

---

## 20. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Device-linked gateway disconnect | Bot berhenti menerima/mengirim | device-status webhook, health card, alert admin, fallback website |
| Nomor dibatasi WhatsApp | Operasional terganggu | exact keyword, cooldown, no broadcast, fetch group sekali, canary |
| Reply loop | Spam grup/quota habis | ignore self/device message, event idempotency, max one reply/event |
| Webhook retry | Duplicate reply/order | `whatsapp_updates`, idempotency key, unique payment/order |
| Produk web dan WA berbeda | Harga/order salah | D1 single source, no WA catalog table, re-query saat konfirmasi |
| Harga berubah saat flow | Buyer membayar harga lama | store quoted price, compare current, reconfirm |
| QR base64 tidak bisa diambil Fonnte | QR gagal terkirim | validate + temporary R2 HTTPS URL |
| Callback palsu/ragu | Fulfillment tanpa pembayaran | merchant/signature/amount + provider status fail-closed |
| Secret terkirim ke grup | Kebocoran akun | channel-aware delivery, recipient guard, negative test |
| Refactor merusak Telegram | Channel aktif downtime | characterization tests, incremental extraction, unchanged message layer |
| `@lid` mengganti nomor member | DM/routing gagal | generic string identity, private handoff via wa.me, no phone assumption |
| Migrasi `orders` merusak FK | Data order tidak valid | shadow-table migration test, backup, foreign_key_check, staged deploy |

---

## 21. Owner Gates — Jangan Diasumsikan Agent

Sebelum aktivasi production, owner harus menyediakan/mengonfirmasi:

1. Nomor existing yang akan ditautkan adalah nomor AXVARA yang benar dan memiliki akses linked devices.
2. Owner menerima tradeoff gateway device-linked untuk kebutuhan grup lama.
3. Akun/paket Fonnte mendukung webhook dan media yang diperlukan.
4. Device token Fonnte disimpan sebagai Cloudflare secret.
5. ID grup AXVARA hasil fetch satu kali.
6. Nomor publik untuk deep-link `wa.me`.
7. Satu produk dan nominal untuk canary order nyata.
8. Apakah fulfillment WhatsApp langsung diaktifkan setelah payment canary atau menunggu observasi tambahan.

KlikQRIS tidak memerlukan onboarding ulang. Agent hanya perlu memverifikasi keberadaan konfigurasi existing secara boolean/health check tanpa menampilkan nilainya.

---

## 22. Definition of Done untuk Handoff Implementasi

Agent eksekutor harus mengembalikan bukti:

- daftar file yang berubah;
- migrasi fresh dan upgrade sama-sama lulus;
- full test, type-check, build Pages;
- regression Telegram lulus;
- bukti `list` berubah setelah edit produk tanpa sync/deploy tambahan;
- bukti bot mengabaikan grup non-allowlist;
- bukti group order hanya mengarah ke private;
- bukti invoice KlikQRIS dibuat satu kali pada duplicate webhook;
- bukti callback invalid tidak mengubah paid;
- bukti callback valid mengubah paid satu kali;
- bukti fulfillment WhatsApp hanya ke private recipient;
- screenshot admin health melalui Chrome DevTools MCP;
- GET `/` 200 dan CSS 200;
- `.cf-credentials` tetap ignored;
- changelog, README, dan architecture sinkron;
- commit dan push `main` berhasil;
- tidak melakukan polling CI/CD setelah push.

---

## 23. Ringkasan Keputusan Final

- **Gateway:** Fonnte untuk nomor dan grup existing.
- **Backend:** Cloudflare AXVARA existing.
- **Katalog:** langsung `products` D1, tanpa sync dan tanpa tabel WhatsApp.
- **Navigasi:** produk langsung, tanpa kategori.
- **Grup:** discovery/FAQ saja.
- **Transaksi:** private chat saja.
- **QRIS:** reuse KlikQRIS Telegram yang sudah berjalan.
- **Fulfillment:** outbox existing dibuat multi-channel.
- **Keamanan:** allowlist, exact command, idempotency, fail-closed payment.
- **Rollout:** FAQ → private invoice → payment canary → fulfillment.
