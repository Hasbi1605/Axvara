# Rencana Eksekusi — Bot Telegram Auto Order + KlikQRIS

**Project:** AXVARA
**Status:** Ready for execution — native AXVARA, repo eksternal hanya referensi
**Tanggal:** 3 September 2026
**Target runtime:** Next.js Edge Routes di Cloudflare Pages + D1
**Payment target:** KlikQRIS Sandbox → MY PG

Dokumen ini adalah handoff implementasi. Agent eksekutor wajib tetap membaca
`AGENTS.md`, `docs/PRD.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `README.md`,
dan `CHANGELOG.md` sebelum mengubah kode. Kerjakan per fase kecil, verifikasi
setiap fase, dan tambahkan entri `CHANGELOG.md` paling atas untuk setiap
perubahan logis.

---

## 1. Outcome yang Ditargetkan

Pembeli dapat menyelesaikan alur berikut tanpa admin memeriksa mutasi secara
manual:

```text
Telegram /start
  → pilih kategori
  → pilih produk
  → konfirmasi beli (MVP: 1 produk, qty 1)
  → AXVARA membuat order dan invoice KlikQRIS
  → bot menampilkan total final + QRIS + waktu kedaluwarsa
  → KlikQRIS mengirim callback PAID
  → AXVARA memverifikasi callback dan status ke API KlikQRIS
  → order ditandai lunas tepat satu kali
  → produk dikirim otomatis jika fulfillment siap
  → jika fulfillment manual/kosong, bot memberi status jelas dan admin diberi notifikasi
```

Checkout web Transfer/QRIS statis yang sudah ada harus tetap berjalan tanpa
perubahan perilaku. Bot dan web berbagi katalog, order, stok, admin, D1, dan
deployment, tetapi memiliki jalur pembayaran yang terpisah.

### Definisi “auto order” untuk MVP

- Katalog, invoice, deteksi pembayaran, status, dan notifikasi berjalan otomatis.
- Produk dengan fulfillment `unique` mengirim satu secret unik dari vault.
- Produk dengan fulfillment `shared` mengirim instruksi terenkripsi yang sama.
- Produk dengan fulfillment `manual` berhenti aman di `manual_required`; order
  tetap lunas, pembeli dan admin menerima pemberitahuan, tidak ada data kosong
  atau placeholder yang dikirim.
- Bot tidak memakai fitur KlikQRIS Market. AXVARA tetap menjadi source of truth.

---

## 2. Keputusan Arsitektur

### 2.1 Bot custom, bukan KlikQRIS Market

Gunakan Telegram Bot API langsung dari route AXVARA. Alasannya:

- katalog dan stok tetap berasal dari D1 AXVARA;
- order web dan Telegram terlihat di panel admin yang sama;
- tidak ada sinkronisasi katalog ke layanan ketiga;
- provider pembayaran dapat diganti tanpa mengganti pengalaman bot;
- aturan keamanan, audit, dan fulfillment dikendalikan AXVARA.

### 2.2 Webhook, bukan long polling

Route target:

- `POST /api/telegram/webhook` untuk update Telegram;
- `POST /api/payments/klikqris/callback` untuk callback pembayaran;
- `POST /api/cron/operations` untuk rekonsiliasi dan retry.

Telegram mengirim `X-Telegram-Bot-Api-Secret-Token`; route wajib membandingkannya
dengan `TELEGRAM_WEBHOOK_SECRET` sebelum membaca/proses update. Telegram akan
mengulang webhook yang tidak mendapat respons 2xx, sehingga seluruh handler
harus idempotent. Lihat [Telegram Bot API — setWebhook](https://core.telegram.org/bots/api#setwebhook).

### 2.3 Tanpa framework bot pada fase awal

Mulai dengan wrapper kecil di atas `fetch` Telegram Bot API, bukan `grammY` atau
`node-telegram-bot-api`. Flow MVP hanya memerlukan `sendMessage`, `sendPhoto`,
`editMessageText`, `answerCallbackQuery`, `setWebhook`, dan `getWebhookInfo`.
Pilihan ini menjaga bundle dan CPU Edge kecil. Evaluasi `grammY` hanya jika flow
percakapan menjadi kompleks.

### 2.4 Adapter KlikQRIS terisolasi

Semua bentuk request/response provider berada di `src/lib/payments/klikqris.ts`.
Kode order dan Telegram tidak boleh memanggil URL KlikQRIS secara langsung.

Mode yang harus didukung:

| Mode | Create | Status | Pemakaian |
|---|---|---|---|
| `sandbox` | `/api/sandbox/qris/create` | `/api/sandbox/qris/status/{order_id}` | dev dan acceptance test |
| `mypg` | `/api/qrisv2/create` | `/api/qrisv2/status/{merchant_id}/{order_id}` | target produksi |

Dokumentasi provider menyatakan `total_amount` dapat memuat kode unik dan itulah
nilai yang harus ditampilkan/ditagihkan. Signature response create harus disimpan
dan dicocokkan dengan callback. Lihat [Dokumentasi API KlikQRIS](https://www.klikqris.com/dokumentasi-api).

Jangan menganggap status lisensi, partner PJP, SLA, settlement, atau fee sebagai
terverifikasi hanya dari materi marketing. Aktivasi produksi memiliki owner gate
tersendiri di bagian 11.

### 2.5 Outbox untuk delivery

Callback pembayaran harus menyimpan keadaan `paid` dan membuat pekerjaan
fulfillment secara durable sebelum merespons HTTP 200. Pengiriman Telegram boleh
langsung dicoba setelah commit, tetapi kegagalan jaringan tidak boleh membatalkan
status pembayaran. Job yang gagal disimpan sebagai `retry` dan diproses cron.

Ini mencegah dua kegagalan berbahaya:

- KlikQRIS sudah menerima HTTP 200 tetapi produk belum terkirim dan tidak ada retry;
- KlikQRIS mengirim callback duplikat lalu secret terkirim dua kali.

### 2.6 Keputusan terhadap `mocasus/telegram-auto-order-bot`

Repo [mocasus/telegram-auto-order-bot](https://github.com/mocasus/telegram-auto-order-bot)
telah diaudit pada commit `9e870bc3485ec19f6719651ed0dc111a931f0301`
(4 Juli 2026). Keputusan final: **jangan fork atau jadikan source code repo itu
sebagai fondasi AXVARA**. Implementasi tetap native TypeScript di codebase ini.

#### Matriks kecocokan

| Area | Repo eksternal | Kebutuhan AXVARA | Keputusan |
|---|---|---|---|
| Runtime | Python process selalu hidup, `run_polling()` | Next.js Edge webhook di Pages | Tidak dipakai |
| Hosting | VPS + systemd | Cloudflare Pages + Worker cron yang sudah ada | Tidak dipakai |
| Database | SQLite file lokal + koneksi global | D1 shared dengan web/admin | Tidak dipakai |
| Katalog | Tabel produk terpisah tanpa kategori/stok | Produk authoritative AXVARA | Tidak dipakai |
| Order | Schema tiga status, tanpa stock reservation/idempotency | Lifecycle order AXVARA yang sudah diaudit | Tidak dipakai |
| KlikQRIS | `/v1/qris/*` pada `api.klikqris.com`; mode tidak mengubah endpoint | Endpoint publik KlikQRIS saat ini berbeda per sandbox/MY PG | Tidak dipakai |
| Deteksi bayar | Poll seluruh pending order tiap 10 detik | Webhook + bounded reconciliation cron | Tidak dipakai |
| Fulfillment | Hanya notifikasi “admin akan memproses” | Manual/shared/unique + encrypted vault | Tidak dipakai |
| UX | `/start`, `/katalog`, `/myorders`, inline confirmation | Flow dasar bot AXVARA | Referensi perilaku |
| Lisensi | MIT | Boleh diadaptasi dengan atribusi | Hindari copy source; atribusi jika ada potongan substansial |

#### Alasan teknis

- `KLIKQRIS_MODE` hanya disimpan/log, tetapi client selalu memakai base dan path
  yang sama; sandbox/production tidak benar-benar dipisahkan.
- Parser mengharapkan response `status == "success"` dan
  `data.payment_status`, sedangkan dokumentasi KlikQRIS yang tersedia saat audit
  menampilkan bentuk response/status lain untuk Sandbox dan MY PG.
- Handler mengambil `data.qris_image` lalu memberikannya sebagai URL foto;
  dokumentasi saat ini membedakan `qris_url` (URL HTTPS) dari `qris_image`
  (data URI/base64), sehingga pengiriman QR berisiko gagal atau salah format.
- “Auto verify” bergantung pada `JobQueue`, tetapi requirements tidak memasang
  extra job queue; code juga diam-diam tidak menjadwalkan poller bila
  `app.job_queue` tidak tersedia.
- Poller melakukan read seluruh pending dan request provider setiap 10 detik,
  tidak cocok untuk arsitektur request-driven dan kuota AXVARA.
- Update status bukan compare-and-set; callback/poller ganda dapat mengulang
  efek samping. Tidak ada payment transaction ledger atau fulfillment outbox.
- Tidak ada stock check/reservation, expiry lokal authoritative, unique
  fulfillment inventory, encryption, maupun retry delivery.
- `/myorders` membaca `product_name` yang tidak dihasilkan query order sehingga
  nama produk dapat kosong.
- Workflow CI terbaru yang diperiksa gagal dan masih merujuk file/modul yang
  tidak ada (`Dockerfile`, `docker-compose.yml`, `config.example.yaml`, dan
  `database.models`). Repo tidak mempunyai automated test suite untuk flow
  payment/order.
- Pemakaian Markdown dari nilai produk/user tidak melakukan escaping yang
  konsisten, sehingga data admin dapat merusak format atau membuat pengiriman
  pesan gagal.

Mengubah semua area di atas berarti mempertahankan sangat sedikit code asli,
sekaligus menambah runtime Python kedua yang tidak dibutuhkan. Risiko integrasi
lebih besar daripada menulis modul Edge kecil yang langsung memakai kontrak
AXVARA.

#### Yang boleh dipakai sebagai referensi

- istilah menu `/start`, `/katalog`, `/pesanan`, dan `/bantuan`;
- pola inline keyboard katalog → detail → konfirmasi;
- gaya copy Bahasa Indonesia yang singkat;
- pemisahan konseptual handler, payment adapter, dan background recovery;
- fixture UX manual untuk memastikan flow native tidak kehilangan fungsi dasar.

#### Yang dilarang dibawa ke AXVARA

- subtree/aplikasi Python, SQLite file, systemd service, long polling, atau
  poller 10 detik;
- schema produk/order duplikat;
- endpoint/parser KlikQRIS dari repo tanpa verifikasi dokumentasi saat ini;
- admin command yang menjadi source of truth kedua;
- fallback otomatis dari kegagalan invoice dinamis ke transfer manual pada order
  yang sama;
- copy source substansial tanpa menyertakan kewajiban lisensi MIT.

Agent boleh membaca repo eksternal untuk membandingkan UX, tetapi seluruh code
production harus ditulis terhadap types, D1 helpers, auth, order lifecycle, dan
test AXVARA. Bila suatu potongan code benar-benar disalin, agent wajib mencatat
asal commit/file dan mempertahankan copyright notice sesuai MIT.

---

## 3. Scope MVP dan Non-Goal

### Masuk MVP

- `/start`, `/katalog`, `/pesanan <kode>`, `/bantuan`;
- navigasi kategori dan produk melalui inline keyboard;
- pagination katalog;
- detail produk, harga, stok, dan gambar;
- satu produk per order, qty 1;
- create invoice KlikQRIS, QRIS dinamis, total final, expiry;
- callback PAID/EXPIRED yang tervalidasi dan idempotent;
- status/refesh/cancel invoice sebelum dibayar;
- fulfillment `manual`, `shared`, dan `unique`;
- vault secret terenkripsi di D1;
- notifikasi admin untuk paid/manual/failed delivery;
- panel admin untuk konfigurasi fulfillment dan import inventory;
- rekonsiliasi invoice pending serta retry delivery via cron;
- observability tanpa mencatat token, API key, atau secret produk.

### Ditunda

- keranjang multi-produk dan quantity >1;
- kupon, affiliate, referral, loyalty, blast;
- refund otomatis;
- pembayaran selain QRIS;
- Telegram Mini App;
- sinkronisasi KlikQRIS Market;
- customer account lintas Telegram dan web;
- migrasi dari Cloudflare Pages ke Workers.

Pembatasan satu produk/qty 1 sengaja dipilih agar reservasi inventory, nominal
unik, expiry, dan delivery dapat dibuktikan benar sebelum memperluas flow.

---

## 4. Struktur Data yang Direkomendasikan

Gunakan migrasi baru `drizzle/migrations/0005_telegram_klikqris.sql`. Nomor `0004`
sudah dipakai migrasi kategori/newsletter. Jangan edit
migrasi lama. Sinkronkan bootstrap `drizzle/schema.sql` setelah migrasi siap.

### 4.1 Perubahan `products`

Tambahkan:

```sql
fulfillment_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (fulfillment_mode IN ('manual','shared','unique')),
shared_secret_ciphertext TEXT,
shared_secret_iv TEXT,
telegram_enabled INTEGER NOT NULL DEFAULT 1
```

Catatan:

- `manual`: tidak ada auto-delivery;
- `shared`: satu instruksi/link terenkripsi untuk semua pembeli;
- `unique`: ambil satu baris tersedia dari inventory;
- field secret tidak pernah masuk response katalog publik;
- produk dengan `telegram_enabled=0` tidak muncul di bot, walau aktif di web.

### 4.2 Perubahan `orders`

Tambahkan:

```sql
sales_channel TEXT NOT NULL DEFAULT 'web'
  CHECK (sales_channel IN ('web','telegram')),
telegram_chat_id TEXT,
telegram_user_id TEXT,
payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid','pending','paid','expired','failed','refunded')),
fulfillment_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (fulfillment_status IN (
    'not_required','reserved','queued','sending','delivered',
    'manual_required','retry','failed'
  ))
```

Untuk order Telegram, `customer_wa` tetap string kosong agar constraint lama
tidak perlu direbuild. Admin UI wajib menyembunyikan tombol WA bila channel
Telegram. Jangan mengisi nomor palsu.

### 4.3 `telegram_users`

```sql
CREATE TABLE telegram_users (
  user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### 4.4 `telegram_updates`

```sql
CREATE TABLE telegram_updates (
  update_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('processing','done','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Jangan hanya menyimpan “sudah pernah dilihat”. Record `processing` memerlukan
lease agar crash tidak membuat update macet permanen.

### 4.5 `payment_transactions`

```sql
CREATE TABLE payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders(code),
  provider TEXT NOT NULL,
  provider_mode TEXT NOT NULL,
  provider_order_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  requested_amount INTEGER NOT NULL,
  payable_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'initializing',
  provider_signature TEXT,
  qris_url TEXT,
  direct_url TEXT,
  expires_at TEXT,
  paid_at TEXT,
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_order_id),
  UNIQUE(order_code)
);
```

Index wajib pada `status`, `expires_at`, dan `order_code` agar cron tidak full
scan saat data membesar.

### 4.6 `fulfillment_inventory`

```sql
CREATE TABLE fulfillment_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','delivered','revoked')),
  order_code TEXT,
  reserved_at TEXT,
  delivered_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, secret_fingerprint)
);
```

Fingerprint adalah SHA-256 untuk mencegah import duplikat tanpa menyimpan
plaintext. Secret dienkripsi AES-256-GCM dengan IV acak per baris dan
`FULFILLMENT_ENCRYPTION_KEY` dari Pages secret.

### 4.7 `fulfillment_jobs`

```sql
CREATE TABLE fulfillment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE REFERENCES orders(code),
  inventory_id INTEGER REFERENCES fulfillment_inventory(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','delivered','manual_required','retry','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_until TEXT,
  telegram_message_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

Jangan simpan plaintext delivery di tabel job atau log.

---

## 5. Kontrak Environment dan Secret

Tambahkan placeholder tanpa nilai nyata ke `.env.example`:

```dotenv
TELEGRAM_BOT_TOKEN=__SET_IN_CLOUDFLARE__
TELEGRAM_WEBHOOK_SECRET=__SET_IN_CLOUDFLARE__
TELEGRAM_ADMIN_CHAT_ID=__SET_IN_CLOUDFLARE__
KLIKQRIS_MODE=sandbox
KLIKQRIS_API_KEY=__SET_IN_CLOUDFLARE__
KLIKQRIS_MERCHANT_ID=__SET_IN_CLOUDFLARE__
FULFILLMENT_ENCRYPTION_KEY=__BASE64_32_BYTES_SET_IN_CLOUDFLARE__
```

Aturan:

- semua nilai nyata adalah Cloudflare Pages secrets, tidak boleh di Git;
- jangan menaruh token di query string, log, error response, atau screenshot;
- jangan meminta credential dikirim melalui chat;
- setup webhook memakai endpoint admin terautentikasi atau command lokal yang
  membaca env, bukan URL dengan token yang tercetak;
- rotasi encryption key memerlukan migrasi/re-encryption; jangan menggantinya
  langsung setelah inventory tersimpan.

---

## 6. Struktur File Target

```text
src/lib/telegram/
├── api.ts                 # wrapper Telegram Bot API
├── types.ts               # subset type yang benar-benar dipakai
├── keyboards.ts           # callback_data <= 64 bytes
└── messages.ts            # copy Bahasa Indonesia + escaping HTML

src/lib/payments/
├── types.ts               # kontrak PaymentProvider
└── klikqris.ts            # sandbox + MY PG, timeout, parser defensif

src/lib/fulfillment/
├── crypto.ts              # AES-GCM + fingerprint
├── inventory.ts           # reserve/release/consume atomik
└── deliver.ts             # outbox claim, send, retry

src/app/api/telegram/webhook/route.ts
src/app/api/payments/klikqris/callback/route.ts
src/app/api/cron/operations/route.ts
src/app/api/admin/telegram/setup/route.ts
src/app/api/admin/bot/health/route.ts
src/app/api/admin/fulfillment/route.ts
src/app/api/admin/orders/[code]/fulfill/route.ts
src/components/admin/BotAutomationManager.tsx
drizzle/migrations/0005_telegram_klikqris.sql
tests/telegram-bot.regression.test.ts
tests/klikqris.regression.test.ts
tests/fulfillment.regression.test.ts
```

Gunakan nama final yang konsisten; bila agent memilih nama berbeda, perbarui
`docs/ARCHITECTURE.md` dan README pada fase yang sama.

---

## 7. Flow Teknis Detail

### 7.1 Update Telegram

1. Tolak selain `POST` dan content type JSON.
2. Validasi header secret Telegram sebelum parse body.
3. Batasi body dan validasi subset schema dengan Zod.
4. Claim `update_id` secara atomik dengan lease.
5. Upsert data user minimal; jangan simpan isi chat bebas.
6. Route berdasarkan command atau `callback_query.data`.
7. Selalu `answerCallbackQuery` agar loading spinner Telegram berhenti.
8. Tandai update `done` hanya setelah response utama berhasil/durable.
9. Error transient → `failed`/lease habis dan return non-2xx agar Telegram retry.
10. Error input user → balas ramah, tandai `done`, return 200.

Callback data stateless yang disarankan:

```text
home
cats:{page}
cat:{categoryId}:{page}
prd:{productId}
buy:{productId}
confirm:{productId}
order:{orderCode}
cancel:{orderCode}
```

Semua harus di bawah batas 64 byte Telegram. Jangan menyimpan wizard state di
memory Edge.

### 7.2 Pembuatan invoice

1. Query produk aktif + `telegram_enabled=1` dari D1.
2. Tolak bila stok umum habis.
3. Bila `unique`, pastikan ada inventory `available`.
4. Buat kode order AXVARA dan `provider_order_id` yang sama/diturunkan secara
   deterministik.
5. Dalam satu batch D1: guard stok, kurangi stok umum, reserve inventory bila
   perlu, insert order Telegram, insert payment `initializing`.
6. Panggil adapter KlikQRIS dengan timeout dan `order_id` unik.
7. Validasi response: provider order, amount, total amount, expiry, signature,
   dan minimal satu URL QR yang valid HTTPS pada hostname yang diizinkan.
8. Simpan response payment lalu tandai `pending`.
9. Kirim QRIS sebagai foto dan tampilkan `payable_amount`, bukan harga produk.
10. Jika create gagal permanen: batch kompensasi mengembalikan stock/inventory dan
    tandai order/payment failed. Jika hasil provider ambigu/timeout, cek status
    menggunakan order id sebelum kompensasi.

Pesan invoice wajib menjelaskan bahwa total dapat memiliki kode unik, waktu
kedaluwarsa, nama produk, kode order, dan tombol “Cek status”.

### 7.3 Callback KlikQRIS

1. Terima hanya JSON dengan batas ukuran kecil.
2. Parse kedua bentuk payload provider secara eksplisit; jangan memakai
   `any`/akses longgar.
3. Cari `payment_transactions` berdasarkan provider + order id.
4. Cocokkan secara konstan: signature tersimpan, merchant id, order id.
5. Pastikan `amount_paid/payable_amount` sama persis; jangan menerima kurang atau
   hanya membandingkan requested amount.
6. Untuk PAID, lakukan server-to-server status check ke KlikQRIS sebelum
   fulfillment. Callback signature yang hanya dicocokkan dengan nilai tersimpan
   belum sekuat HMAC yang dihitung ulang.
7. Claim transisi `pending → paid` secara atomik. Callback duplikat menghasilkan
   200 `already_processed`, bukan mengirim ulang.
8. Buat/claim fulfillment job secara durable.
9. Commit state pembayaran sebelum mencoba Telegram.
10. Respons 200 setelah callback tersimpan. Delivery gagal masuk retry queue,
    bukan membuat callback pembayaran berulang tanpa kendali.

Untuk EXPIRED:

- hanya transisikan bila belum paid;
- kembalikan stok umum dan inventory reserved tepat satu kali;
- ubah order menjadi `kadaluarsa`;
- beri tahu pembeli jika chat masih dapat dihubungi.

### 7.4 Fulfillment

`manual`:

- status `manual_required`;
- kirim pembeli: pembayaran diterima, admin sedang menyiapkan akses;
- kirim admin detail order dan deep link ke panel admin.

`shared`:

- claim job;
- decrypt instruksi hanya di memory;
- kirim pesan Telegram;
- tandai delivered setelah Telegram mengembalikan `ok=true`;
- hapus plaintext dari scope secepatnya dan jangan log body.

`unique`:

- inventory sudah reserved saat invoice dibuat;
- decrypt item yang terikat pada order;
- kirim tepat satu kali melalui claimed job;
- setelah sukses tandai inventory `delivered` dan job/order `delivered`;
- retry selalu memakai inventory id yang sama, tidak mengambil key baru.

Retry schedule: 1, 5, 15, 60 menit; setelah batas percobaan, `failed` dan
notifikasi admin. Tombol admin “Kirim ulang” wajib melakukan claim atomik dan
menampilkan risiko duplikasi sebelum eksekusi.

### 7.5 Rekonsiliasi cron

Gunakan trigger MCP Worker yang sudah ada, jangan menambah service berbayar.
Satu cron boleh memanggil publisher lama dan operations endpoint secara terpisah,
atau endpoint maintenance terpadu bila dokumentasi ikut diperbarui.

Setiap 5 menit:

- cek payment `initializing` yang stale;
- cek payment pending yang dekat/lewat expiry;
- query status provider untuk recovery missed callback;
- expire order dan release reservation secara idempotent;
- claim fulfillment `queued/retry` yang due;
- lepaskan lock job yang stale;
- batasi batch per run, misalnya 25, agar CPU/request tetap aman.

Cloudflare Pages Functions berbagi kuota Workers Free 100.000 request/hari dan
D1 Free menyediakan 5 juta row reads serta 100.000 row writes/hari. Bot kecil
aman, tetapi dashboard metrics dan query ber-index tetap wajib dipantau. Lihat
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/), dan
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

---

## 8. Admin UX

Tambahkan section **Bot & Otomasi** tanpa merombak halaman admin lain.

### Health card

- Bot configured / token missing;
- Telegram webhook URL, status, pending update count, last error (tanpa token);
- KlikQRIS mode `sandbox` atau `mypg`;
- credential configured boolean saja;
- cron/rekonsiliasi terakhir;
- tombol “Pasang/Perbarui Webhook” ber-auth admin dan konfirmasi.

### Konfigurasi produk

- toggle “Tampil di Telegram”;
- fulfillment mode: Manual / Pesan bersama / Secret unik;
- input shared delivery terenkripsi;
- jumlah inventory available/reserved/delivered;
- import bulk satu secret per baris, maksimal 100 per request;
- hasil import: inserted, duplicate, invalid;
- tidak ada endpoint/UI untuk mengungkap plaintext yang sudah tersimpan;
- hanya inventory `available` yang boleh di-revoke/hapus.

### Pesanan

- badge channel Web/Telegram;
- payment status, payable amount, provider, paid/expired time;
- fulfillment status dan last error yang sudah disanitasi;
- tombol WA hanya untuk web order dengan nomor valid;
- tombol Telegram/retry hanya untuk order bot;
- jangan menampilkan provider signature atau secret delivery.

---

## 9. Keamanan Wajib

- Telegram webhook secret header wajib; URL rahasia saja tidak cukup.
- KlikQRIS callback tidak boleh percaya status, signature, atau amount secara
  terpisah; validasi gabungan dan confirm melalui status API.
- Semua mutasi order/payment/inventory memakai prepared statements dan transisi
  state bersyarat (`WHERE status=...`).
- Reservation/release/delivery idempotent dan memiliki unique constraint.
- Rate limit endpoint admin/setup dan callback; public bot endpoint tetap
  dilindungi secret Telegram.
- Allowlist hostname QR/provider sebelum server/client menggunakan URL.
- Escape semua data produk/user sebelum Telegram `parse_mode=HTML`.
- Batasi panjang nama, caption, error, dan callback data.
- Jangan log request headers, raw callback, token, signature, ciphertext, atau
  plaintext fulfillment.
- Error publik generik; detail ter-redact hanya di server log.
- Admin inventory endpoint memakai `requireAdmin`, same-origin, dan CSRF posture
  yang sama/lebih ketat dari endpoint admin lain.
- `.cf-credentials` tetap ignored dan tidak digunakan sebagai tempat token
  Telegram/KlikQRIS aplikasi.

---

## 10. Test Plan dan Acceptance Criteria

### Unit/contract

- parser create/status/callback untuk sandbox dan MY PG;
- malformed JSON, missing fields, wrong types, unknown status;
- exact `total_amount` normalization, tanpa float;
- signature/merchant/order/amount mismatch ditolak;
- escaping HTML Telegram;
- callback data ≤64 byte;
- AES-GCM round-trip, IV unik, wrong key gagal;
- fingerprint duplicate inventory ditolak;
- retry backoff dan redaction error.

### Integration

- duplicate Telegram `update_id` diproses sekali;
- double-click tombol beli membuat maksimal satu order aktif;
- stock race: hanya order yang memiliki stok/inventory yang berhasil;
- provider timeout kemudian status lookup sukses tidak me-release order;
- callback PAID ganda membuat satu fulfillment job;
- PAID setelah EXPIRED tidak auto-deliver dan masuk review admin;
- EXPIRED ganda mengembalikan stok sekali;
- Telegram send gagal → payment tetap paid, job retry;
- retry mengirim inventory yang sama;
- web checkout manual tetap lulus seluruh regresi lama;
- response katalog publik tidak mengandung ciphertext, IV, fingerprint,
  provider signature, chat id, atau token.

### Dev verification wajib

```bash
cd /Users/macbookair/axvara
node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
npm test
npx tsc --noEmit
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Ambil URL CSS dari HTML dan pastikan 200. Periksa `/tmp/axvara-dev.log` tidak
memiliki compile error. Gunakan Chrome DevTools MCP sesuai `AGENTS.md` untuk:

- admin desktop dan mobile;
- konfigurasi mode fulfillment;
- import inventory dan validation error;
- order Telegram muncul tanpa tombol WA palsu;
- retry delivery dan status badge;
- regression homepage, checkout web, dan status order.

### Sandbox end-to-end

1. Pasang secret dev/preview, bukan production.
2. Set `KLIKQRIS_MODE=sandbox`.
3. Pasang Telegram webhook preview dengan secret header.
4. Buat produk test `unique` dan import minimal dua secret dummy.
5. Order dari akun Telegram test.
6. Pastikan bot menampilkan `total_amount` dan expiry provider.
7. Picu simulator KlikQRIS SUCCESS.
8. Pastikan satu secret terkirim dan inventory delivered.
9. Kirim callback yang sama lagi; tidak ada pesan/secret kedua.
10. Uji EXPIRED dan kegagalan Telegram.
11. Hapus data test atau tandai secara eksplisit.

### Acceptance MVP

- AC-BOT-01: `/start` menampilkan katalog aktif tanpa login.
- AC-BOT-02: tombol beli menghasilkan satu order pending dan satu invoice.
- AC-PAY-01: nominal yang ditampilkan sama dengan `total_amount` provider.
- AC-PAY-02: callback palsu/mismatch tidak mengubah order.
- AC-PAY-03: callback valid + status API valid membuat order lunas sekali.
- AC-FUL-01: unique inventory terkirim sekali dan tidak bisa dipakai ulang.
- AC-FUL-02: manual product tidak pernah mengirim placeholder/secret kosong.
- AC-OPS-01: missed callback dipulihkan rekonsiliasi cron.
- AC-REG-01: seluruh test checkout/admin lama tetap lulus.
- AC-SEC-01: tidak ada credential/secret/plaintext di Git atau response publik.

---

## 11. Owner Gates — Jangan Diasumsikan Agent

Agent boleh menyelesaikan code dan sandbox tanpa nilai produksi. Agent wajib
berhenti sebelum aktivasi/deploy produksi bila poin berikut belum dikonfirmasi.

### Gate A — KlikQRIS MY PG

Owner memberikan melalui channel secret yang aman, bukan commit/chat:

- API key dan Merchant ID;
- konfirmasi akun memakai MY PG, bukan In-House QRIS;
- QRIS/e-wallet sumber yang sudah aktif dan nama merchant yang tampil;
- fee flat aktual per transaksi;
- expiry invoice aktual;
- URL webhook yang didaftarkan;
- hasil satu transaksi nominal kecil;
- informasi partner PJP/acquirer, prosedur dispute, support, dan SLA yang berhasil
  diverifikasi owner.

Jika field/payload dashboard berbeda dari dokumentasi publik, simpan contoh yang
sudah di-redact sebagai fixture test dan sesuaikan adapter—jangan menebak.

### Gate B — Telegram

- token dari BotFather;
- username/nama bot final;
- admin chat ID untuk alert;
- copy profil, `/start`, bantuan, dan jam layanan;
- izin memasang webhook production `https://axvara.tech/api/telegram/webhook`.

### Gate C — Fulfillment per produk

Owner mengklasifikasikan setiap produk sebagai:

- `manual` — perlu aktivasi/admin;
- `shared` — link/instruksi yang aman dipakai berulang;
- `unique` — satu akun/key/serial per order.

Default wajib `manual`. Agent tidak boleh mengubah produk menjadi auto hanya
karena ada teks di deskripsi. Untuk bundle, definisikan apakah satu inventory
row berisi seluruh bundle atau fulfillment per komponen; MVP memilih satu row
atomik per bundle agar tidak terjadi partial delivery.

---

## 12. Urutan Implementasi untuk Agent Eksekutor

### Fase 0 — Baseline dan branch safety

- baca seluruh context wajib;
- catat keputusan ADR: implementasi native AXVARA; repo `mocasus` pada commit
  `9e870bc` hanya behavioral reference dan tidak ditambahkan sebagai dependency,
  submodule, subtree, atau source copy;
- rekam `git status` dan jangan menimpa perubahan yang sudah ada;
- jalankan test, typecheck, dev home/CSS baseline;
- catat kegagalan baseline yang memang sudah ada;
- jangan deploy.

**Exit:** baseline terdokumentasi dan scope file disepakati.

### Fase 1 — Domain model dan migrasi

- tambah migration 0005 dan schema bootstrap;
- tambah index/constraint/idempotency;
- perluas dev in-memory DB hanya sejauh dibutuhkan test;
- tambahkan test lifecycle reservation/payment/job;
- update Architecture + README + changelog.

**Exit:** migration idempotent pada DB test baru; test checkout lama lulus.

### Fase 2 — Crypto vault dan admin API

- implement AES-GCM/fingerprint;
- endpoint import/count/revoke inventory;
- tidak ada reveal plaintext;
- test duplicate, wrong key, auth, redaction.

**Exit:** inventory dapat di-import dan di-reserve tanpa bocor.

### Fase 3 — Adapter KlikQRIS

- implement interface provider, sandbox, MY PG;
- timeout, parser strict, URL allowlist, status normalization;
- fixture response/callback yang di-redact;
- seluruh network dimock pada unit test.

**Exit:** create/status/callback contract lulus tanpa credential production.

### Fase 4 — Bot katalog read-only

- Telegram API wrapper;
- webhook secret + update dedupe/lease;
- `/start`, katalog, kategori, detail, bantuan;
- pagination stateless;
- setup/health admin endpoint.

**Exit:** bot sandbox dapat browse katalog; duplicate update aman.

### Fase 5 — Create order dan invoice

- reserve stock/inventory + insert order/payment atomik;
- KlikQRIS create + ambiguous recovery + compensation;
- kirim QRIS/total/expiry/status button;
- cancel sebelum paid.

**Exit:** satu tap menghasilkan maksimal satu invoice/order; failure restore aman.

### Fase 6 — Callback, outbox, dan fulfillment

- callback validation + server-side confirm;
- atomic paid transition;
- durable fulfillment job;
- manual/shared/unique delivery;
- retry dan admin alert;
- EXPIRED release sekali.

**Exit:** sandbox SUCCESS, duplicate, EXPIRED, dan send failure semuanya lulus.

### Fase 7 — Admin UI dan observability

- Bot & Otomasi section;
- product fulfillment controls + inventory counts/import;
- order badges/status/retry;
- health tanpa secrets;
- visual/fungsional via Chrome DevTools MCP.

**Exit:** owner dapat mengoperasikan bot dari HP tanpa membuka D1 manual.

### Fase 8 — Preview, sandbox E2E, dan production gate

- build Pages karena route/schema besar;
- deploy preview bila diizinkan;
- jalankan checklist sandbox end-to-end;
- review logs dan metrics;
- minta owner memenuhi Gate A–C;
- migrasi D1 production sebelum deploy code yang mengandalkan kolom baru;
- set secrets lalu pasang webhook production;
- transaksi nyata nominal minimum dan rollback test.

**Exit:** bukti acceptance lengkap. Jangan menyebut production ready sebelum
transaksi riil dan duplicate callback test lulus.

---

## 13. Rollout dan Rollback

Gunakan feature flags:

```dotenv
TELEGRAM_BOT_ENABLED=false
KLIKQRIS_PAYMENTS_ENABLED=false
AUTO_FULFILLMENT_ENABLED=false
```

Urutan rollout: bot katalog → sandbox payment → MY PG payment dengan fulfillment
manual → auto fulfillment untuk satu produk test → produk lain bertahap.

Rollback tercepat adalah mematikan flag dan/atau menghapus webhook Telegram.
Jangan drop tabel atau menghapus transaction history saat rollback. Order paid
yang belum delivered tetap harus terlihat dan diselesaikan admin.

---

## 14. Risiko Utama dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Callback dipalsukan | Produk terkirim tanpa pembayaran | stored signature + merchant/order/amount + status API confirm |
| Callback/update duplikat | double delivery | unique constraint + conditional state transition + outbox claim |
| Provider timeout ambigu | invoice yatim/stock salah | status lookup sebelum compensation + cron reconcile |
| Secret inventory bocor | kerugian produk | AES-GCM, no reveal, no logs, admin-only API |
| Telegram gagal kirim | pembeli sudah bayar tanpa produk | durable retry + admin alert + manual action |
| Inventory habis | paid tapi tidak bisa fulfill | reserve sebelum invoice; default manual bila belum siap |
| Bot menghabiskan kuota | API berhenti sementara | stateless webhook, pagination, index, bounded cron, metrics alert |
| Perubahan provider | integrasi rusak | adapter + strict fixtures + sandbox smoke sebelum rollout |
| Produk melanggar aturan pihak ketiga | akun/merchant diblokir | owner review legal/TOS produk dan kebijakan merchant sebelum enable |

---

## 15. Handoff yang Harus Dikembalikan untuk Review

Agent eksekutor harus menyerahkan:

- ringkasan file yang diubah dan alasan;
- diff schema + urutan migration production;
- daftar env/secret tanpa nilai;
- output `npm test`, `tsc`, build Pages, GET `/` dan CSS 200;
- bukti Chrome DevTools MCP untuk admin mobile/desktop;
- fixture KlikQRIS yang sudah di-redact;
- bukti sandbox create → paid → delivery;
- bukti callback/update duplikat tidak double-process;
- bukti EXPIRED me-release stok sekali;
- bukti tidak ada secret di `git diff`, response publik, atau log;
- bukti tidak ada runtime Python/SQLite/systemd/poller baru dan tidak ada code
  eksternal substansial tanpa atribusi MIT;
- ID deployment preview/production jika deployment memang diotorisasi;
- risiko tersisa dan Gate A–C mana yang belum selesai.

Review akhir harus fokus pada state transition, idempotency, inventory race,
secret leakage, server-side payment confirmation, regression checkout web, dan
operability admin—bukan hanya happy-path UI.
