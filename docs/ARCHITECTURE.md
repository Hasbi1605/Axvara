# ARCHITECTURE.md — AXVARA

**Stack:** Next.js 15 (App Router) + Cloudflare Pages + D1 + R2
**Tanggal:** 5 September 2026
**Status:** Implemented — Pages + D1 + R2 + Remote MCP + custom domain dan DNSSEC aktif

---

## 1. Ringkasan Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Edge (CDN)                  │
│ axvara.tech → Cloudflare DNS/SSL → Pages → Edge CDN    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Cloudflare Pages — Next.js (SSG + Functions)          │
│  • Storefront (SSG + ISR)                               │
│  • /api/* via Pages Functions (Workers)                 │
│  • Admin UI (client) + API routes                       │
└──────┬──────────────────────┬───────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐       ┌──────────────┐
│ Cloudflare D1│       │ Cloudflare R2│
│ (SQLite)     │       │ (S3-comp)    │
│ • products   │       │ • produk/*   │
│ • categories │       │ • bukti/*    │
│ • orders     │       │ • qris/*     │
│ • articles   │       │ • articles/* │
│ • banners    │       │ • banners/*  │
│ • subscribers│       │              │
│ • agent auth │       │              │
│ • users/admin│       │              │
└──────────────┘       └──────────────┘
       │
       ▼
┌──────────────────┐
│ Baileys Gateway  │
│ Heroku           │
│ quoted reply +   │
│ media sementara  │
└──────────────────┘
```

**Kenapa ini, bukan VPS?**
- Daftar tanpa kartu kredit, tidak ditolak seperti Oracle
- Bandwidth unlimited, CDN otomatis di Indonesia (Pages)
- Tidak perlu ngurus Linux, Nginx, SSL, security patch
- Gratis selamanya untuk skala MVP–menengah (lihat VPS-RESEARCH.md)

---

## 2. Tech Stack Detail

| Layer | Teknologi | Alasan |
|-------|-----------|--------|
| Framework | Next.js 15 App Router | Edge routes untuk katalog dan checkout di Cloudflare Pages |
| Bahasa | TypeScript | Type-safe, DX |
| Styling | Tailwind CSS + CSS Modules | Utility + glassmorphism custom |
| Animasi | CSS + imperative `requestAnimationFrame` + IntersectionObserver | Motion Apple-style tanpa render React per frame; pause saat offscreen |
| State | Zustand (keranjang/pencarian) + Fetch API | Ringan, tanpa Redux |
| Database | Cloudflare D1 (SQLite) | Gratis 5GB, 5M reads/hari, serverless |
| Storage | Cloudflare R2 | Gratis 10GB, S3-compatible, untuk foto & bukti |
| Auth Admin | JWT httpOnly + idle JWT terikat sesi + PBKDF2/SHA-256 Edge-safe | Cookie-only, idle 2h server-enforced, rotasi password mencabut sesi |
| Deploy | Cloudflare Pages (via Git) | Auto deploy, preview URL |
| Domain | .TECH Domains registrar + Cloudflare DNS | Nameserver Cloudflare, auto SSL, integrasi Pages |
| Ikon | Aset SVG/PNG lokal + Lucide React | Menghindari request ikon pihak ketiga saat runtime |
| Font | Apple SF Pro system stack | Konsisten dengan desain storefront |
| Validasi | Zod | Schema checkout & produk |
| Gateway WhatsApp | Baileys di Heroku | Webhook grup, quoted reply, media bukti sementara, dan pesan fulfillment |

---

## 3. Struktur Folder

```
axvara/
├── docs/
│   ├── PRD.md
│   ├── DESIGN.md
│   ├── ARCHITECTURE.md
│   └── VPS-RESEARCH.md
├── public/
│   ├── qris/README.md           # tidak ada QRIS statis publik
│   └── logo/
│       └── axvara-wordmark.svg
├── src/app/                     # Next.js App Router
│   ├── page.tsx                 # Homepage
│   ├── artikel/[slug]/          # Artikel publik Markdown/legacy JSON
│   ├── cara-order/               # Panduan order
│   ├── garansi-replace/          # Ketentuan layanan & garansi third-party (acuan klaim, garansi ikut deskripsi produk)
│   ├── produk/[slug]/          # PDP: server component SEO (metadata/JSON-LD/h1 D1) + client interaktif
│   │   ├── checkout/       # Checkout — QRIS otomatis / bukti untuk transfer manual; layout action-rail ala WR 2026-09-19 (kiri data+ekspektasi, kanan aside sticky ringkasan+metode+S&K+CTA; mobile accordion + CTA sticky bottom; 1 handler submit)
│   ├── pesanan/[code]/         # Status + QRIS dinamis + polling lunas (dari checkout)
│   ├── lacak-pesanan/          # Lacak mandiri kode + WA via POST /api/orders/lookup + timeline + auto-refresh
│   ├── admin/
│   │   └── page.tsx             # Shell + modul admin berbasis query section
│   ├── api/
│   │   ├── products/
│   │   ├── categories/
│   │   ├── orders/              # POST create, GET list, PATCH confirm
│   │   ├── checkout/quote/       # Quote harga/stok/payment bertanda tangan
│   │   ├── payment-methods/      # GET publik + PUT admin
│   │   ├── store-settings/       # GET publik + PUT admin
│   │   ├── subscribers/          # POST publik + GET admin
│   │   ├── articles/            # CRUD editorial admin/public
│   │   ├── banners/             # CRUD popup banner
│   │   ├── upload/              # Media admin ke R2
│   │   ├── agent/               # Content API scoped Bearer token
│   │   ├── cron/                # Publish artikel + expire order terjadwal
│   │   └── auth/
│   ├── layout.tsx
│   └── globals.css
├── src/components/
│   ├── ui/                      # Button, Input, Badge, Modal, Drawer, Toast
│   ├── storefront/              # Navbar, Hero, ProductCard, CartDrawer, CheckoutForm, QrisDisplay
│   └── admin/                   # Shell, login gate, hooks (useAdminAuth/useProductManager),
│       └── sections/            # satu komponen per section admin (page.tsx tinggal shell + routing)
├── src/hooks/
│   └── useModalA11y.ts          # Escape + focus trap + scroll lock + restore fokus — SATU
│                                # implementasi untuk CartDrawer, PopupBanner, QuickVariantModal.
│                                # Sebelumnya disalin manual sehingga a11y tiap modal berbeda.
├── src/lib/
│   ├── db.ts                    # BARREL — entry point publik tunggal (jangan impor db/* langsung)
│   ├── db/                      # client (+state dev in-memory), expiry, errors, orders-create,
│   │                            # orders-transition, types
│   ├── commerce.ts              # createChannelOrderAtomic: reservasi stok + inventory + INSERT
│   │                            # order dalam SATU d1.batch, dipakai web/Telegram/WhatsApp
│   ├── payments/
│   │   ├── dana-qris.ts        # invoice + reissue QRIS, masa hidup order vs invoice
│   │   └── dana-history.ts     # predikat riwayat nominal untuk webhook/retry/guard atomik
│   ├── fulfillment/
│   │   ├── deliver.ts           # BARREL
│   │   └── delivery/            # claim, send, process, ensure, reconcile, handover,
│   │                            # inventory-binding, manifest, types
│   ├── telegram/
│   │   ├── messages.ts          # BARREL
│   │   ├── messages/            # format, catalog, purchase, status, group, help, admin
│   │   └── handlers/            # command, callback (guard ownerBound), catalog, discovery,
│   │                            # orders, invoice, cart, cart-invoice, shared
│   ├── whatsapp/
│   │   ├── gateway.ts           # auth timing-safe + isPrivateIp (kontrol SSRF)
│   │   └── handlers/            # catalog, payment, proof, admin, shared
│   ├── r2.ts                    # R2 client (S3 API)
│   ├── config.ts                # payment methods, site config
│   └── utils.ts                 # formatRupiah, generateOrderCode
├── stores/
│   └── cart.ts                  # Zustand cart store (localStorage) — badge/judul pakai lineCount() = jumlah baris varian (2026-09-19); count() sum-qty hanya untuk subtotal
├── drizzle/                     # atau raw SQL — schema D1
└── wrangler.json                # Cloudflare bindings + Pages output
```

### 3.0 Aturan modul (pasca refactor)

Route API dan modul besar dipecah per domain, tetapi **path publik lama dipertahankan sebagai
barrel** (`src/lib/db.ts`, `src/lib/fulfillment/deliver.ts`, `src/lib/telegram/messages.ts`).
Impor dari barrel, bukan dari file internal di dalam foldernya — itu yang menjaga satu titik
perubahan bila struktur internal digeser lagi. Handler webhook tidak boleh dipanggil langsung dari
`route.ts`: Telegram hanya mengekspos `handleCommand`/`handleCallback` supaya guard kepemilikan
`ownerBound` tidak bisa dilewati.

Pada admin, `onUnauthorized` bergantung pada setter `setAuthed` yang stabil, bukan objek hasil `useAdminAuth`. Dengan demikian `load` tetap stabil dan effect pemuatan tidak berulang setiap render; test komponen memeriksa jumlah request sesudah autentikasi dan perpindahan menu.

### 3.1 Runtime performa storefront

- `OrbitHero` hanya satu instance untuk desktop/mobile, memutakhirkan DOM lewat refs, memakai 30 fps untuk auto-rotate dan refresh-rate penuh saat drag/inertia, menghormati reduced motion, serta menghentikan rAF ketika hero offscreen/tab tersembunyi. Drag hanya aktif untuk `(pointer: fine)`; layar sentuh memakai `touch-action: pan-y` dan tidak menangkap swipe vertikal.
- `ScrollRope` dan `Spotlight` event-driven; tidak mempertahankan loop idle. ScrollRope tidak memasang listener pada viewport mobile.
- Kartu berulang memakai `ax-glass-card` tanpa `backdrop-filter`; blur penuh dipertahankan untuk navbar, drawer, modal, dan overlay.
- Homepage/detail merender skeleton sampai respons D1 tersedia. Seed produk hanya menjadi database in-memory saat development dan tidak pernah dipakai sebagai fallback UI produksi.
- Cache publik ditetapkan langsung oleh Edge handler: produk aktif 30 detik, kategori/banner aktif 60 detik. Respons admin atau varian produk non-eksplisit tetap `private, no-store`.
- Middleware hanya menambahkan `unsafe-eval` pada CSP saat `NODE_ENV=development`, karena React Refresh membutuhkannya. Header production tetap ketat.

---

## 4. Skema Database (D1 — SQLite)

```sql
-- Kategori
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Slug adalah identitas stabil. Edit label tidak mengubah slug; ikon dipilih
-- eksplisit dari katalog aset lokal dan tidak diturunkan dari nama/slug.

-- Produk
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,          -- dalam rupiah, tanpa desimal (89000)
  compare_price INTEGER,           -- harga coret
  image_url TEXT,                  -- R2 URL
  images TEXT,                     -- JSON array URL tambahan
  stock INTEGER DEFAULT -1,        -- -1 = unlimited (digital)
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Pesanan
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,       -- AXV-20260831-0012
  customer_name TEXT NOT NULL,
  customer_wa TEXT NOT NULL,
  customer_email TEXT,
  items TEXT NOT NULL,             -- JSON [{product_id, name, price, qty}]
  subtotal INTEGER NOT NULL,
  payment_method TEXT NOT NULL,    -- ewallet | seabank | qris | bank_other
  payment_account TEXT,            -- nomor tujuan (082135277434 / 901812349386)
  proof_url TEXT,                  -- R2 URL bukti transfer manual; null untuk QRIS
  status TEXT DEFAULT 'pending',   -- pending | lunas | dibatalkan | kadaluarsa
  admin_note TEXT,                 -- lisensi/key yang dikirim
  quote_id TEXT,                   -- jti quote signed; unique untuk idempotensi
  expires_at TEXT,                 -- WA QRIS 15 menit; Telegram/Web tunggu pembaruan 60 menit, final QR maks 15 menit; manual 24 jam.
                                   -- Ditulis ISO UTC, BUKAN datetime('now',...) yang formatnya
                                   -- spasi dan ditafsirkan Date.parse sebagai waktu lokal.
  qris_reissue_count INTEGER NOT NULL DEFAULT 0, -- migrasi 0024; batas MAX_QRIS_REISSUES = 3
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX orders_quote_id_unique
  ON orders(quote_id) WHERE quote_id IS NOT NULL;

-- Guard CHECK membuat batch D1 gagal/rollback jika precondition stok/status gagal.
CREATE TABLE operation_guards (
  operation_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);

-- Admin
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Payment Methods (konfigurasi dinamis)
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,             -- ewallet | seabank | qris | bca ...
  label TEXT NOT NULL,             -- "DANA / Gopay / Shopeepay"
  account_number TEXT,             -- "082135277434"
  account_name TEXT,               -- "Brotherstore06"
  qris_url TEXT,                   -- legacy; QRIS dinamis tidak menyimpan aset di sini
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'footer',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE store_settings (
  key TEXT PRIMARY KEY,            -- store_name | tagline | whatsapp_number | ...
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Seed payment_methods:
-- ewallet | DANA / Gopay / Shopeepay | 082135277434 | Brotherstore06
-- seabank | SeaBank                  | 901812349386 | Brotherstore06
-- qris    | QRIS Dinamis             | -            | DANA Business | qris_url NULL
```

---

## 5. API Contract (MVP)

| Method | Path | Deskripsi | Auth |
|--------|------|-----------|------|
| GET | /api/products | List produk (filter category, search, active). Permintaan admin juga menerima `lowStockVariants` per produk = jumlah varian aktif berstok 0–5, satuan yang sama dengan `low_stock` di `/api/admin/overview` | - |
| GET | /api/products/:slug | Detail produk | - |
| GET | /api/categories | List kategori | - |
| POST/PUT/DELETE | /api/categories[?id=] | Kelola kategori | admin |
| POST | /api/subscribers | Simpan email unik dari form footer | - |
| GET | /api/subscribers | List pelanggan email | admin |
| GET/POST/PUT/DELETE | /api/articles[?id=] | Publikasi dan CRUD editorial | public/admin |
| GET/POST/PUT/DELETE | /api/banners[?id=] | Popup banner | public/admin |
| POST | /api/checkout/quote | Validasi produk/stok/harga, metode aktif, dan terbitkan signed quote 60 menit | - |
| GET/POST/PUT | /api/payment-methods[?id=] | Baca metode aktif / tambah bank / kelola rekening dan QRIS | public/admin |
| GET/PUT | /api/store-settings | Baca identitas storefront / perbarui nama, kontak, footer, logo | public/admin |
| POST | /api/orders | Verifikasi signed quote, buat pesanan idempotent, reservasi stok atomik | - |
| POST | /api/orders/lookup | Lacak mandiri: verifikasi pasangan kode + WA (normalisasi 08/+62/62, constant-time), 404 generik anti-enumerasi, WA/email mask, rate-limit `orders:lookup` | - |
| GET | /api/orders?code= | Cek status pesanan via code. WA/email dimask; `credentials_ready` (boolean) menandai detail akun WR sudah siap diambil sehingga storefront tahu kapan panel retrieval boleh tampil | - |
| GET | /api/orders/:code | Kembaran segmen dari `?code=` untuk halaman pesanan yang sama. **Invarian (audit 2026-09-20): isinya WAJIB sepadan — `proof_url` TIDAK pernah ikut di kedua endpoint.** Nilai itu adalah kunci objek R2 privat yang hanya boleh dibaca admin lewat `/api/admin/bukti/*`; membocorkannya memberi penebak kode order nama berkas bukti bayar milik orang lain. Dikunci `tests/audit-2026-09-20.regression.test.ts` | - |
| GET | /api/payments/qris/:code/image | Render PNG QRIS dinamis untuk invoice aktif | code order |
| POST | /api/payments/qris/:code/reissue | Terbitkan QRIS baru untuk order yang masih hidup tetapi QR-nya sudah kedaluwarsa. Hanya boleh saat invoice lama SUDAH mati — syarat itulah yang mencegah pemegang kode order lain membatalkan QR yang sedang dipakai. Maks 3x/order, rate limit 5/menit/IP | code order |
| POST | /api/webhook/dana | Terima notifikasi QRIS Hook, dedup, cocokkan nominal, lunasi order | X-Webhook-Secret |
| POST | /api/proof/upload | ⏸️ maintenance 2026-09-17: selalu 503 (upload bukti disembunyikan di WEB; QRIS saja) | same-origin |
| GET | /api/admin/bukti/:key | Preview/download bukti | admin |
| POST | /api/upload | Upload WebP produk/artikel/banner ke R2 | admin |
| * | /api/agent/* | Context, artikel, media, dan audit | agent scope |
| POST | /api/cron/publish-scheduled | Publish artikel dan kedaluwarsakan order jatuh tempo | cron secret |
| POST | /api/auth/login | Admin login, set cookie | - |
| GET | /api/admin/overview | KPI, antrean tindakan, dan health flag tanpa secret | admin |
| GET | /api/admin/orders | List pesanan dengan search/filter/channel/date, pagination, dan CSV | admin |
| PATCH | /api/admin/orders/:id | Update status (lunas/batal) + admin_note | admin |
| GET/POST | /api/admin/payments/events | Audit aman QRIS Hook + retry exact-match | admin |
| POST | /api/admin/products | Create produk + upload image ke R2 | admin |
| PUT | /api/admin/products/:id | Update produk | admin |
| DELETE | /api/admin/products/:id | Soft delete | admin |

**Validasi POST /api/orders (maintenance 2026-09-17: QRIS saja — non-QRIS 503):**
```ts
{
  customer_name: string (min 3),
  customer_wa: string (regex 08..., 10-15 digit),
  customer_email?: string (email),
  items: { product_id: number, qty: number }[] (min 1),
  payment_method: "qris", // ewallet/bank:* ditolak 503 selama maintenance
  proof_url?: string | null // proof apa pun ditolak 503 selama maintenance
  quote_token: string // signed HS256, snapshot item/subtotal/payment account; quote tanpa QRIS ditolak 503
}
```

**Kontrak UI media/admin:**

- Produk dan cover artikel dinormalisasi browser ke WebP 1600×900; banner mempertahankan rasio asli dengan sisi terpanjang maksimal 1920 px.
- Popup banner menghitung lebar dari dimensi natural gambar, membatasi ukuran ke viewport, dan memakai `object-contain` agar materi portrait/persegi/landscape tidak terpotong.
- `PopupBanner` hanya fetch/render pada pathname homepage (`/`), sehingga promosi tidak menghalangi checkout, status pesanan, detail produk, atau workflow admin.
- Bukti pembayaran tetap privat melalui `/api/admin/bukti/:key`; UI membedakan belum diunggah, URL tidak valid, file R2 hilang, dan preview tersedia.
- Kategori D1 menjadi sumber tunggal kapsul katalog dan menu Jelajah footer. Nama, ikon, serta `sort_order` dapat diedit; slug tetap stabil ketika nama berubah, dan penghapusan ditolak selama kategori masih dipakai produk.
- Email form footer dinormalisasi lowercase, dideduplikasi oleh unique index, dibatasi per IP, dan hanya dapat dibaca melalui panel/API admin terautentikasi.
- Sidebar admin dikelompokkan menurut pekerjaan. `AdminOverview` menjadi action center; `OrdersManager` memegang filter/pagination/detail; `PaymentReconciliation` hanya menampilkan metadata event aman, bukan payload mentah atau secret.
- Ikon admin memakai `IosIcon` (Icons8 iOS 11 Glyph PNG lokal di `public/icons/ios11/`, tint via CSS filter) dengan prinsip hemat: ikon hanya untuk aksi nyata (tambah, simpan, hapus, tutup, cari) dan pesan status (error/sukses), bukan dekorasi label/statistik. Badge `ChannelBadge`/`StatusBadge`/`MethodBadge` adalah teks + warna (tanpa ikon). Dialog memakai judul + tombol tutup saja (tanpa header-ikon), backdrop `bg-black/60` + blur, radius `rounded-2xl` (konfirmasi) / `rounded-3xl` (form), dan rhythm root `mt-4` + `space-y-4` agar tidak terlihat AI slop.
- Bukti QRIS adalah referensi visual saja. Tombol approval manual tidak dirender untuk order QRIS; pencocokan ulang tetap menuntut satu invoice DANA aktif dengan nominal persis.
- Editor varian memakai form-card responsif dengan CTA eksplisit dan menyimpan inventory fulfillment per SKU. Dialog mengunci body, mendukung Escape, dan meminta konfirmasi sebelum membuang perubahan.
- `store_settings` adalah override D1 untuk identitas serta tautan dukungan storefront. API publik read-only memakai cache singkat dan PUT memerlukan sesi admin; fallback `SITE` menjaga storefront tetap tersedia jika tabel belum siap.

---

## 6. Flow Teknis Checkout

```
[Client] Keranjang (Zustand + localStorage) / Beli Langsung (produk D1 aktif)
   ↓ POST /api/checkout/quote { slug/id, qty, expected_price }
[Server] Validasi produk aktif, stok, harga, dan payment_methods D1
   ↓ response quote HS256 60 menit + snapshot authoritative
[Client] Konfirmasi perubahan harga → pilih QRIS (E-Wallet/Bank maintenance 2026-09-17: tampil disabled + badge di WEB, dihilangkan di WA/TELE)
   ↓ POST /api/orders { customer, item IDs/qty, payment_method, proof_url, quote_token }
[Server] Verifikasi signature+expiry+isi item → tolak non-QRIS 503 → D1 batch guard+decrement+INSERT order
   ├─ QRIS: alokasikan kode unik 1–299 → EMVCo dynamic payload + ledger 15 menit
   │    ↓ /pesanan/[code] menampilkan PNG dan polling 5 detik
   │    ↓ QRIS Hook → POST /api/webhook/dana → exact amount + event dedup → lunas atomik
   └─ Manual: ⏸️ maintenance 2026-09-17 (upload disembunyikan WEB, endpoint 503, order manual 503)
        ↓ cron: jatuh tempo → status kadaluarsa + restore stok dalam satu batch
```

**Anti-tamper:** Harga, rekening, subtotal, dan item order terikat ke quote server; body client tidak dapat mengganti snapshot. Quote id unik membuat retry idempotent. Reservasi/restore stok memakai batch D1 dengan guard CHECK agar kegagalan rollback seluruh operasi; stok `-1` tetap unlimited.

**Laporan pendapatan (issue #12, review R9 2026-09-08):** sumber waktu kanonis `src/lib/revenue.ts` — `orders.paid_at` (ditulis sekali saat transisi lunas via COALESCE-guard di semua jalur QRIS/manual/admin, dalam batch yang sama dengan flip status) dengan bucket WIB (`datetime(..., '+7 hours')` di SQL, helper `isSameWibDay/isSameWibMonth` di dev-fallback). Hierarki: ledger `paid_at` → `paid_at` order → `reviewed_at` bukti → `updated_at` fallback. Migrasi `0016_revenue_paid_at.sql` membackfill data lama (QRIS dari ledger, manual dari `reviewed_at`, sisa lunas dari `updated_at`, non-lunas tetap NULL, idempoten). Overview menandai `revenue_timezone: Asia/Jakarta` + `revenue_from/to` agar mudah diaudit.

**Monitoring & ketahanan notifikasi (issue #13, review R10/R11 2026-09-08):** status layanan jujur empat tingkat di `src/lib/service-health.ts` (`configured/healthy/degraded/unknown`) — overview memakai pengukuran (antrean fulfillment/outbox + usia, kirim terakhir, event QRIS 7 hari) dan mengembalikan `system_details` berdetail di samping boolean kompatibel; `last_match` mencakup event `matched`, kesehatan fulfillment membaca `fulfillment_items` + usia antrean tertua via `evaluateQueue` (macet = degraded; `manual_required` = needsAction → degraded langsung tanpa menunggu usia, review R11 lanjutan), dan `fulfillment_attention` = JUMLAH ORDER butuh tindakan (COUNT DISTINCT, tanpa hitung ganda job+item; rincian `fulfillment_attention_by_status`, `fulfillment_jobs_attention` untuk diagnosis); kartu Kesehatan sistem tiga warna (hijau/kuning/merah) + tooltip + legenda. Bot health memaparkan usia antrean tertua + event QRIS. Notifikasi penting WhatsApp ("Pembayaran Diterima") masuk `whatsapp_outbox` idempoten (`UNIQUE idempotency_key`, klaim lease `sending` + `worker_id`/`locked_until`, backoff 1-5-15-60, `dead`, migrasi 0019 rebuild CHECK prod), recovery lease basi oleh runtime (bukan hanya cron, review R10 lanjutan) + `claimErrors` terpisah, dan diproses cron operations 5-menit. Serah terima manual: `POST /api/admin/orders/[code]/handover` (item_index+note, admin-only, 90-hari TTL bukti, review R3 lanjutan) + tombol "Serahkan manual" di OrdersManager. Kesehatan sesi Baileys dinyatakan eksplisit sebagai milik gateway Heroku eksternal (dilaporkan endpoint `/health` gateway), bukan diklaim hijau dari Pages.

**Proteksi garansi third-party:** `/garansi-replace` adalah acuan tunggal ketentuan layanan & garansi (AXVARA third-party independen, garansi 1x24 jam–30 hari mengikuti deskripsi tiap produk, klaim = penggantian bukan refund otomatis). Checkout mewajibkan checkbox persetujuan sebelum order dibuat; detail produk, footer, dan halaman sukses pesanan menautkan kembali ke halaman tersebut.

---

## 7. R2 Storage Layout

```
R2 bucket: axvara-assets
├── produk/
│   ├── chatgpt-plus-1bln-abc123.webp
│   └── ...
├── bukti/
│   ├── AXV-20260831-0012-x7k9p2.webp
│   └── ...
├── articles/
│   ├── covers/*.webp
│   └── content/*.webp
└── banners/*.webp
```

- Upload via Pages Function dengan `AWS SDK S3` ke R2 binding
- Nama file: `{order_code}-{random6}.{ext}` untuk bukti
- Content-Type di-set; produk/banner publik dan bukti pembayaran private melalui route admin

---

## 8. Deploy ke Cloudflare Pages

### Wrangler Config (`wrangler.json`)

```json
{
  "name": "axvara",
  "compatibility_date": "2026-08-31",
  "pages_build_output_dir": ".vercel/output/static"
}
```

### Jalur CI/CD

1. `npx wrangler d1 create axvara-db`
2. Database baru: `npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote`; database lama jalankan migrasi `0002`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`
3. `npx wrangler r2 bucket create axvara-assets`
4. Push ke `main`; `.github/workflows/ci.yml` menjalankan test → type-check → build Pages → `wrangler d1 migrations apply` → deploy Pages → deploy MCP Worker
5. GitHub Actions menggunakan Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`; Git integration bawaan Pages tidak menjalankan deployment agar CI/CD tidak ganda
6. Setelah push berhasil, agent berhenti tanpa polling workflow. `npm run deploy`/`deploy:mcp` hanya jalur recovery manual atas instruksi eksplisit
7. Custom domain `axvara.tech` dan `www.axvara.tech` aktif melalui CNAME proxied; `www` memiliki redirect 308 ke apex. DNSSEC Cloudflare aktif dan memerlukan publikasi DS di registrar
8. Secrets Pages: `ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256`, `ADMIN_JWT_SECRET`, `CRON_SECRET`, dan `WHATSAPP_WEBHOOK_TOKEN`; URL service Baileys disimpan sebagai `WHATSAPP_GATEWAY_URL`. Nilai `ADMIN_PASSWORD_SHA256` memakai format PBKDF2/SHA-256; satu pasang quote pembungkus dari paste shell/JSON dinormalisasi sebelum verifikasi. Pada hash PBKDF2, browser membentuk proof HMAC atas challenge JWT berlaku 5 menit; Pages memverifikasi proof secara ringan tanpa menjalankan derivasi PBKDF2 berat.

### Build Adapter

- Opsi A: `@cloudflare/next-on-pages` (Next.js di Pages Functions)
- Opsi B: Next.js static export + Pages Functions terpisah untuk API
- Rekomendasi MVP: Opsi A untuk DX paling simpel

---

## 9. Keamanan MVP

- Admin auth: JWT httpOnly cookie-only 8 jam + idle JWT HS256 2 jam terikat `sid` yang sama (nilai sembarang ditolak server), refresh aktivitas tervalidasi penuh sebelum memutar idle baru, rotasi password mencabut seluruh sesi lama via claim `av` stateless, Bearer admin tanpa cookie ditolak (integrasi MCP/agent memakai Bearer scope via `requireAgent`, bukan JWT admin), rate limit 5/min
- Upload: cek magic bytes (bukan cuma ext), max 5MB, sanitize filename
- D1: prepared statement, no string concat
- Pembanding rahasia: SEMUA kredensial bearer/HMAC memakai `constantTimeEqual`
  (`src/lib/security.ts`) — webhook DANA, Telegram, WhatsApp, Warung Rebahan,
  DAN cron. Audit 2026-09-20 menemukan `/api/cron/operations` +
  `/api/cron/publish-scheduled` masih memakai `!==` pada bearer `CRON_SECRET`
  (satu-satunya pemegangnya adalah Worker `axvara-mcp`, sehingga bocornya
  secret ini membuka seluruh endpoint operasi); keduanya kini seragam dan
  tetap fail-closed ketika `CRON_SECRET` kosong.
- Waktu tampil (audit 2026-09-20): D1 menulis `datetime('now')` sebagai UTC
  berformat spasi (`YYYY-MM-DD HH:MM:SS`), sedangkan `new Date(nilai)` di JS
  membacanya sebagai waktu LOKAL — di perangkat WIB seluruh timestamp mundur
  7 jam dan tanggalnya salah bila melewati tengah malam. Rumah kanonis untuk
  SEMUA tampilan adalah `formatWibDateTime` (`src/lib/utils.ts`): ia mem-parse
  lewat `parseExpiry` (sumber yang sama dengan cron/webhook) lalu mengunci
  `timeZone: "Asia/Jakarta"` supaya admin dari zona mana pun melihat jam
  operasional toko. Dilarang memformat hasil `new Date(<string timestamp>)`
  langsung di komponen.
- Proteksi trafik & efisiensi query (issue #14, diverifikasi 7 Sep 2026 dari
  docs Cloudflare D1 Limits + WAF rate limiting rules — bukan asumsi):
  - WAF Free TERSEDIA: 1 rate limiting rule, counting IP, periode 10 dtk /
    1 mnt, aksi Block. Klaim lama "WAF tidak tersedia" salah. Rule ke-1
    TERPASANG 7 Sep 2026 via API (ruleset "AXVARA API rate limit",
    `dff7ff5c17e34a97ac13b3264ca6a916`): `(http.request.uri.path wildcard
    r"/api/*")`, 100 request / 10 dtk / IP → Block 429 selama 10 dtk.
    Mencakup checkout/quote/upload/login sekaligus tanpa menambah rule.
    Batas Free yang memaksa bentuk ini: period hanya boleh 10 dtk dan
    characteristics wajib `cf.colo.id + ip.src` (API menolak period 60 dan
    `ip.src` saja). Verifikasi: GET entrypoint `http_ratelimit` = 1 rule enabled.
  - In-memory `src/lib/rateLimit.ts` hanyalah lapis kedua (defense in depth
    per isolate, bukan proteksi DDoS global): checkout:orders 10/mnt,
    checkout:quote 20/mnt, proof:upload 5/mnt, upload:admin 20/mnt,
    orders:lookup 20/mnt, auth:login 5/mnt, newsletter:subscribe 5/mnt, semua
    429 + `Retry-After: 60`. IP anti-spoof: `cf-connecting-ip` utama,
    fallback hanya `x-real-ip`; `x-forwarded-for` TIDAK dipakai (spoofable).
    Tidak ada ketergantungan eksklusif pada counter per-isolate — WAF adalah
    lapis pertama yang global.
  - Batch cron operations (RR5-02/03, 9 Sep 2026): `createBudgetedDatabase`
    di `src/lib/db-access.ts` menangkap satu binding D1 untuk seluruh call tree
    invocation. Batas 40 statement, termasuk setiap anggota batch dan query
    yang gagal; dua statement khusus disisihkan untuk checkpoint fase.
    Wrapper menolak query/batch sebelum dispatch bila melewati batas, tanpa
    mengganti `globalThis.DB`. `query_budget_used` adalah jumlah statement
    yang diajukan; batch yang rollback dihitung penuh secara konservatif,
    sehingga dapat lebih besar dari jumlah statement yang sempat dieksekusi.
    `cron_phase`/`cron_deferred` menentukan urutan eksekusi nyata. Expiry
    memakai sinyal pending/init-basi/manual-WA terpisah; initializing tanpa
    pending lain tetap dipulihkan. `publish-scheduled` tetap cadangan order
    tanpa ledger. Helper expiry, invoice/notifikasi Telegram, dan outbox WA
    memakai binding berbudget yang sama.
    Pemulihan orphan hanya membaca order dan membuat/membaca job (3 query).
    Materialisasi dibatasi dua baris baru per job/run, membaca produk hanya
    untuk baris yang belum ada. Baris tersimpan adalah checkpoint materialisasi;
    `item_cursor` (migrasi 0022) menyimpan posisi pengiriman. Admission sebelum
    provider menyisihkan biaya jalur gagal dan finalisasi (frame 6; shared/manual
    sampai 8, unique sampai 12 statement). Yield normal mengembalikan job
    queued tanpa menambah attempt; attempt job bertambah saat ada kegagalan.
    `AUTO_FULFILLMENT_ENABLED=false` tetap mengisi item untuk admin secara
    bertahap tanpa mengirim; pemindaian hanya memilih job yang masih kekurangan
    baris agar job lengkap tidak menahan antrean berikutnya. Ini batas kerja per invocation, bukan janji
    throughput atau durasi pemulihan antrean. Bukti dan durasi simulasi:
    [laporan RR5](REVIEW-ROUND5-EXECUTION-2026-09-09.md).
  - **Deadline wall-clock + poison-pill guard (18 Sep 2026, live).** Budget D1
    tidak membatasi waktu tunggu jaringan, dan penanda fase dulu hanya ditulis
    di ekor handler. Akibatnya (insiden 17–18 Sep): satu run merangkai
    banyak panggilan luar (notify sampai 14 × 10 s Telegram/WA, fase WR
    order + `/transactions` + `/products` + `/balance`), mencapai wallTime
    ~125 s, dipotong platform (`outcome: canceled`, cpuTime hanya ~175 ms),
    lalu run berikutnya membaca fase yang sama dan mengulang pekerjaan berat
    yang sama tiap 5 menit. `cron_phase` beku di `warung_rebahan` sejak
    17 Sep 13:06 UTC dan baris `trigger='cron'` terakhir di `wr_sync_log`
    adalah 17 Sep 11:37 UTC — sync otomatis WR mati ~16 jam meski cron
    tetap dipanggil dan auth benar. Dua obatnya: (1) `writeCronPhase`
    dipanggil DI AWAL run (fase dimajukan + `cron_deferred` dikosongkan)
    sehingga run yang mati tidak bisa mengunci rotasi; ekor menimpa dengan
    nilai final saat run selesai normal. (2) Deadline lunak
    `RUN_DEADLINE_MS = 45_000`: setiap unit kerja jaringan (batch Telegram,
    outbox WA, item fulfillment, tiap langkah WR) hanya dimulai bila sisa
    waktu cukup, sisanya menjadi `deferred` jujur untuk run 5 menit
    berikutnya. Respons cron menyertakan `run_duration_ms` +
    `run_deadline_ms`. Timeout API WR juga diturunkan 30 s → 12 s
    (`WR_API_TIMEOUT_MS`); referensi: sweep katalog penuh 48 produk ~10 s
    total termasuk ~250 statement D1 (`wr_sync_log.duration_ms`).
  - **Lease pengiriman kredensial WR + guard zero-missing (18 Sep 2026, live).**
    `processCredentialDelivery` kini MENYIMPAN lease-nya
    (`delivery_next_attempt_at`, 2 menit) dan
    `recoverStaleCredentialDeliveries` mengembalikan baris `sending` yang
    lease-nya habis ke `failed` agar masuk antrean lagi dengan backoff;
    hitungan antrean cron ikut memasukkan baris tersebut. Sebelumnya lease
    dihitung lalu dibuang dan recovery hanya memungut `('queued','failed')`,
    sehingga run yang dibunuh meninggalkan pengiriman menggantung permanen
    (bukti prod: link `AXV-20260917-0D35043E` di `sending` sejak 17 Sep).
    Sekalian ditutup: delivery web menganggap `issueCredentialToken()`
    bernilai `null` sebagai gagal padahal `null` juga berarti "token valid
    sudah ada" — membuat SETIAP retry web pasti gagal; sekarang dibedakan
    lewat `hasValidCredentialToken()`. Di `syncProducts`, zero-missing hanya
    berjalan bila sweep dimulai dari awal daftar dalam run itu
    (`startAt === 0`); tanpa syarat ini run lanjutan dari cursor lolos
    sebagai "sweep penuh" dan me-nol-kan stok varian yang tidak pernah
    dilihatnya (terbukti 4 varian pada test regresi).
  - Recovery sending basi WA mandiri (RR3-06): gerbang cron =
    pending/failed > 0 ATAU sending-lease-kedaluwarsa > 0 (COUNT sendiri),
    sehingga antrean yang seluruhnya sending basi tetap dipulihkan via
    entrypoint cron. Lease aktif tidak pernah dicuri.
  - Notifikasi Telegram per jenis (RR3-09): antrean created / paid buyer /
    paid admin dihitung terpisah (bukan hanya marker order-created);
    `retryPendingTelegramNotifications(limit, {created,paid,paidAdmin})`
    hanya membayar SELECT ke jenis yang antre.
  - Retry foto invoice Telegram (RR3-05, migrasi 0021):
    `orders.telegram_invoice_sent_at` (NULL = belum terbukti sampai) +
    `telegram_invoice_attempts` (maks 5). Checkout menandai pending
    sebelum sendPhoto dan sent hanya bila {ok:true}; {ok:false} melempar
    agar update failed + 500 (redelivery nyata) dan stok/reservasi
    DIPERTAHANKAN untuk invoice aktif. `retryTelegramInvoiceDelivery`
    mengirim ulang foto yang SAMA (nominal/expiry dari ledger, caption
    dari DB) tanpa order kedua; cron menyapu ≤2 invoice/run dalam budget.
    Semantik jujur: Telegram tidak memberi exactly-once untuk sendPhoto —
    retry dibatasi + dideduplikasi marker DB + guard double-tap order.
  - Handover manual dan agregasi (RR5-01/04/05/07/08):
    `fulfillmentLineMismatches` memeriksa item_index, product_id, variant_id,
    serta qty integer positif yang harus persis sama, termasuk qty berlebih.
    Kontrak yang sama dipakai cron dan seluruh cabang handover/recovery.
    Mismatch ditahan sebelum pengiriman otomatis dan tidak diperbaiki dengan
    mengarang qty baru pada item delivered. Handover mengembalikan 409
    `handover_incomplete` bila rincian belum cocok, dan 409
    `handover_recovery_pending` bila penulisan lanjut belum pulih; error
    tak terduga menjadi 500, bukan sukses hanya berdasarkan satu status item.
    Audit memakai substring literal `instr` (kompatibel dengan batas pola D1).
    Identitas audit per order/item stabil; pelaku/waktu diambil dari fakta
    `manual_handover` milik request pemenang CAS, juga pada retry admin berbeda.
    Catatan legacy dipertahankan; bila fakta pelaku tidak tersedia, recovery
    menandainya sebagai legacy, bukan mengaku admin retry sebagai penyerah.
    Respons sukses memisahkan `item_status`, `fulfillment_status`, dan `complete`.
    UI selalu POST pemulihan saat semua item telah delivered; toast sukses
    akhir memerlukan konfirmasi status bisnis delivered, termasuk cabang
    beberapa item. Mutasi order/job dilakukan dalam satu batch D1 saat lease
    masih dimiliki, kemudian lease dilepas tanpa write lanjutan. Settlement
    inventory unique/item juga atomik dan berpagar lease. Cron menyapu split
    historis job delivered/order tertinggal tanpa mengirim kredensial lagi.
    `processJob` D1 mendelegasikan ke `processJobItems`; flag WhatsApp false
    mengarahkan ke manual di kedua entrypoint. Proof hold tetap menghalangi
    pengiriman otomatis WA pada rail manual ketika diaktifkan. Fallback dev
    tanpa D1 tetap memakai jalur legacy in-memory.
  - Revokasi sesi fail-closed (RR3-04): `readRevokedVersionFromStore`
    melempar kegagalan baca (bukan `.catch(() => null)` menjadi versi 0);
    `sessionBumpFor` mengembalikan -2 → `expectedAuthVersion` tak
    mungkin-cocok → requireAdmin/refresh MENOLAK sesi logout saat store
    revokasi tak terbaca, tanpa mutasi dan tanpa token baru.
  - Fencing worker menyeluruh (RR3-08): kepemilikan lease melindungi
    SELURUH mutasi turunan processJob (job + agregat order + error) — bila
    job bukan retry milik sendiri (lease hilang), worker lama berhenti
    sebelum menyentuh order. Order campuran tetap `manual_required`
    (guard `NOT IN ('delivered','manual_required')`, bukan daftar
    pengecualian baru).
  - Agregat fulfillment berpagar lease (review R4 lanjutan 2026-09-08):
    `processJob` menulis parent (delivered/retry) hanya bila `locked_until`
    miliknya masih berlaku (`scheduleRetryFenced`); worker basi yang kembali
    membawa kegagalan mendapat 0 row — job/item/order TETAP delivered.
  - Klasifikasi error webhook di `src/lib/telegram/webhook-errors.ts` (bukan
    di route — validator Next.js menolak field export tambahan; R5-fix
    2026-09-08): transient-by-cause (jejak jaringan selalu transient
    termasuk TypeError fetch; bug tipe murni permanen; default transient).
  - N+1 dihapus: quote memakai 2 query `IN` (produk + varian) untuk berapa
    pun item; expiry cron JOIN order dalam 1 query; keranjang Telegram 1 JOIN
    varian + 1 DELETE batch; PDP memakai `?slug=` exact (1 baris) dan related
    `?cat=` (8 baris) — tidak ada lagi fetch seluruh katalog per halaman.
  - Batas D1 yang dipatuhi kode: 100 bound parameter/query (batch IN
    dipotong), LIKE max 50 byte (pola search dipotong 40 char).
- CSP header via Next.js middleware
- Jangan commit `.env`, `wrangler.toml` dengan secrets — pakai Pages Variables

---

## 10. Observability & Next Step

- Cloudflare Web Analytics (gratis, privacy-friendly) untuk traffic
- D1 + R2 metrics di dashboard Cloudflare
- P1: tambah logging terstruktur + alert WA jika error rate naik

---

## 11. Estimasi Biaya

| Item | Free Tier | Estimasi MVP |
|------|-----------|-------------|
| Pages | 500 builds/bulan, unlimited bandwidth | Rp 0 |
| D1 | 5GB storage, 5M reads/hari | Rp 0 (ratusan produk + ribuan order aman) |
| R2 | 10GB, 10M reads/bulan | Rp 0 |
| Domain utama axvara.tech | Dibeli terpisah; DNS/SSL Cloudflare gratis | Biaya registrar tahunan |
| Hostname Pages bawaan axvara.pages.dev | Gratis; redirect ke axvara.tech | Rp 0 |
| **Total infra** | | **Rp 0/bulan** |

Jika melebihi free tier (misal 100k order/bulan): D1 $5/bulan, R2 $0.015/GB — masih sangat murah.

---

## 12. Editorial CMS dan Remote MCP

Artikel memakai `status` sebagai sumber kebenaran (`draft`, `review`, `scheduled`, `published`, `rejected`); `is_published` dipertahankan selama migrasi kompatibilitas. Slug dan excerpt dibuat server-side dari judul/konten dan tidak menjadi field editorial. Editor visual Tiptap menyimpan Markdown sebagai format kanonis; renderer token-based tidak mengeksekusi raw HTML dan tetap membaca JSON Tiptap lama. Konten agent hanya boleh membuat atau memperbarui Draft, wajib menyertakan sumber, idempotency key, dan audit trail.

Migrasi database lama: jalankan sekali dan berurutan `drizzle/migrations/0002_editorial_agent.sql`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`. Database baru memakai `drizzle/schema.sql`.

Agent Content API berada di `/api/agent/*` dan memvalidasi Bearer token yang di-hash dalam `agent_tokens`; ia adalah satu-satunya jalur bagi agent ke D1/R2. Scope tersedia: `context:read`, `articles:read`, `articles:write`, `articles:submit`, `articles:schedule`, `articles:publish`, `media:write`, `audit:read`. `/api/agent/media` menerima file WebP multipart dari agent yang dapat membaca filesystem lokal, sedangkan `/api/agent/media/import` mengambil WebP dari URL HTTPS publik untuk agent berbasis remote URL.

Route Edge `/mcp` adalah endpoint Streamable HTTP JSON-RPC utama dan ikut deployment Pages, sehingga tidak membutuhkan service tambahan. URL publik tunggalnya `https://axvara.tech/mcp`; hostname `axvara.pages.dev` diarahkan permanen ke domain utama dan tidak menjadi endpoint client. Ia meneruskan tool ke Content API internal dan tidak memberi agent akses D1/R2 langsung.

`mcp-worker/` adalah gateway cron aktif di `https://axvara-mcp.sailinnadia1.workers.dev/mcp` dan memakai `https://axvara.tech` sebagai origin Content API. `upload_article_image` tetap menerima base64 WebP untuk payload kecil. Jalur utama yang tahan terhadap batas JSON client adalah `import_article_image_from_url`; server membatasi sumber ke HTTPS publik tanpa kredensial/custom port/IP literal, memvalidasi ulang maksimal tiga redirect, membatasi respons 5 MB saat streaming, dan memeriksa WebP melalui header serta magic bytes sebelum menyimpan ke R2. File lokal memakai multipart Content API karena remote MCP tidak dapat membaca path filesystem milik agent. Konversi PNG/JPG dilakukan oleh agent sebelum upload agar runtime tetap ringan. Deploy dari root:

```bash
npm run deploy:mcp
```

Konfigurasi client menggunakan header `Authorization: Bearer ${AXVARA_AGENT_TOKEN}`. Raw token hanya dikembalikan sekali ketika admin membuatnya.

Trigger `*/5 * * * *` pada MCP Worker memanggil `/api/cron/publish-scheduled`. Set nilai acak yang sama sebagai secret Pages `CRON_SECRET` dan Worker `AXVARA_CRON_SECRET`; jangan simpan nilainya di Git.

## 13. Bot Telegram + DANA Dynamic QRIS + Fulfillment

Implementasi native TypeScript di codebase AXVARA. Repo `mocasus/telegram-auto-order-bot` hanya referensi UX; tidak ada dependency, subtree, atau source copy.

### Arsitektur

- **Bot:** Webhook di `POST /api/telegram/webhook`, bukan long polling. Wrapper `fetch` kecil atas Telegram Bot API tanpa framework.
- **Payment:** `src/lib/payments/dana-qris.ts` mengubah payload merchant DANA Business menjadi EMVCo dynamic QRIS, menyuntikkan nominal unik, dan menghitung ulang CRC16. Tidak ada API/payment gateway pihak ketiga.
- **Authority:** QRIS Hook Android mengirim JSON ke `POST /api/webhook/dana` dengan `X-Webhook-Secret`. Event dideduplikasi dan hanya nominal persis dari satu invoice DANA aktif yang dapat melunasi order.
- **Setup Android:** gunakan URL publik `https://axvara.tech/api/webhook/dana`, isi field secret aplikasi dengan nilai rahasia Pages Secret `DANA_WEBHOOK_SECRET` (bukan teks nama variabel tersebut), aktifkan Notification Access + merchant DANA + QRIS Hook Active, dan matikan Debug Mode agar delivery tidak dilewati. Admin menampilkan URL kanonis, nama header, health, dan event masuk tanpa mengekspos nilai secret.
- **Fulfillment:** AES-256-GCM via WebCrypto, fingerprint SHA-256 untuk deduplikasi. Tiga mode: `manual`, `shared`, `unique`. Outbox pattern dengan `fulfillment_jobs` (per order, kompatibilitas) + `fulfillment_items` per (order, item) sejak migrasi 0015: setiap item punya status/mode/penerima sendiri, order selesai hanya setelah seluruh item terminal sukses.
- **Rekonsiliasi:** `POST /api/cron/operations` menangani stale initializing, order QRIS yang mencapai batas akhir, due jobs, stale locks, serta retry notifikasi order/paid Telegram dan order/paid-admin WhatsApp. DANA tidak menyediakan status polling; webhook adalah authority pembayaran.
- **Notifikasi Telegram:** order Telegram mengirim notifikasi grup `TELEGRAM_ADMIN_CHAT_ID` segera setelah ledger QRIS terbentuk. Kolom marker idempoten pada `orders` mencegah duplikat. Setelah QRIS Hook mengubah order menjadi `paid`, buyer otomatis menerima pesan berhasil tanpa menekan cek status; untuk fulfillment manual pesan yang sama baru meminta nomor WA dan menampilkan kontak admin.

### Tabel Baru (migrasi 0005)

| Tabel | Tujuan |
|---|---|
| `telegram_users` | Profil user Telegram minimal |
| `telegram_updates` | Idempotency + lease untuk webhook |
| `payment_transactions` | Ledger lintas-channel (base amount, payable amount unik, payload/URL QRIS, expiry) |
| `dana_webhook_events` | Dedup/audit minimal event QRIS Hook dan order hasil pencocokan |
| `payment_invoice_history` | Riwayat nominal, waktu terbit, dan expiry setiap QRIS; trigger insert/update ledger menjaganya dalam transaksi yang sama (migrasi 0025) |
| `dana_qris_legacy_ranges` | Rentang nominal dengan riwayat lama yang sudah terhapus oleh reissue; wajib verifikasi mutasi manual (migrasi 0025) |
| `fulfillment_inventory` | Vault secret terenkripsi per produk |
| `fulfillment_jobs` | Outbox delivery per order dengan retry (kompatibilitas) |
| `fulfillment_items` | Status/mode/penerima per item order (migrasi 0015). **Ringkasan status: satu order HANYA `delivered` bila SEMUA item delivered; campuran delivered+manual = `manual_required` (pelanggaran ini menutupi item manual yang belum diserahkan). Per-item klaim CAS (`sending` + locked_until) + agregat parent berpagar lease (R4 lanjutan); serah terima manual via `POST /api/admin/orders/[code]/handover`.** |
| `dana_webhook_events.reviewed_by/review_note` | Audit verifikasi manual nominal dipakai-ulang (migrasi 0017, review R1) |
| `whatsapp_outbox.worker_id/locked_until` + status `sending` | Lease klaim worker anti-kirim-ganda (migrasi 0018, rebuild CHECK prod 0019, review R10 lanjutan: recovery lease basi oleh runtime + claimErrors terpisah) |
| `admin_session_revocations` | Pencabutan sesi admin lintas instance/restart (migrasi 0020, review R8 lanjutan: logout menolak cookie basi di worker baru; TTL 90 hari dibersihkan cron) |
| `store_settings` | Override nama, tagline, WhatsApp, jam dukungan, footer, dan logo storefront |

Kolom baru di `products`: `fulfillment_mode`, `shared_secret_ciphertext`, `shared_secret_iv`, `telegram_enabled`.
Kolom baru di `orders`: `sales_channel`, `telegram_chat_id`, `telegram_user_id`, `payment_status`, `fulfillment_status`, `telegram_order_notified_at`, dan `telegram_paid_notified_at`.

### Route Baru

| Method | Path | Auth | Tujuan |
|---|---|---|---|
| POST | `/api/telegram/webhook` | Telegram secret header | Webhook bot |
| POST | `/api/webhook/dana` | X-Webhook-Secret | Notifikasi pembayaran dari QRIS Hook |
| GET | `/api/payments/qris/:code/image` | kode order | PNG QRIS dinamis selama invoice aktif |
| POST | `/api/cron/operations` | CRON_SECRET | Rekonsiliasi |
| GET/POST | `/api/admin/telegram/setup` | admin | Setup webhook |
| GET | `/api/admin/bot/health` | admin | Health check tanpa secret |
| GET | `/api/admin/overview` | admin | KPI/action queue lintas channel |
| GET/POST | `/api/admin/payments/events` | admin | Event QRIS Hook aman + retry exact-match |
| GET/POST/DELETE | `/api/admin/fulfillment` | admin | Inventory management |
| GET/PUT | `/api/store-settings` | public/admin | Identitas storefront / update terautentikasi |
| GET | `/api/catalog[?slug=]` | public | Katalog produk/varian aktif terpusat |
| GET/POST/PUT/DELETE | `/api/admin/variants` | admin | Kelola SKU, durasi, garansi, harga, stok, dan mode fulfillment varian |
| POST | `/api/whatsapp/webhook` | Shared Baileys webhook token | Command grup, order, pembayaran, dan intake bukti |
| POST | `/api/admin/proofs/:id` | admin | CAS approve/reject bukti dari baris Pesanan dan otorisasi pembayaran manual |

### Environment Baru

Semua nilai nyata di Cloudflare Pages Secrets:

```
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ADMIN_CHAT_ID
DANA_STATIC_QRIS, DANA_WEBHOOK_SECRET
FULFILLMENT_ENCRYPTION_KEY
TELEGRAM_BOT_ENABLED, DANA_QRIS_ENABLED, AUTO_FULFILLMENT_ENABLED
```

`TELEGRAM_ADMIN_CHAT_ID` adalah satu tujuan untuk seluruh notifikasi admin yang berasal
dari order web, order Telegram saat invoice dibuat, order WhatsApp saat dibuat
(`Order Baru — WhatsApp`) dan saat lunas (`Lunas — WhatsApp` via QRIS Hook /
retry admin / approve bukti), serta kegagalan delivery. Grup privat
wajib memakai ID numerik negatif (`-100...`), bukan link undangan. Tambahkan
`@Axvara_bot` ke grup lalu jalankan `/chatid` untuk menampilkan ID tersebut. Username
support manusia `@axvara_support` ditampilkan bersama tombol WhatsApp admin pada
pesan setelah pembayaran berhasil.

### Feature Flags
Rollout bertahap: `TELEGRAM_BOT_ENABLED=false`, `DANA_QRIS_ENABLED=false`, `AUTO_FULFILLMENT_ENABLED=false`. Semua default off di contoh environment; secret produksi dikelola di Pages.

### Proteksi Garansi BOT
- `/start` tampil bersih (welcome simpel) + tombol `📜 Garansi & Ketentuan` dan `🛍️ Lanjut Belanja`.
- Command `/garansi` (terdaftar di menu) mengirim ketentuan third-party + 6 syarat klaim (ganti/perbaikan, bukan refund; garansi ikut deskripsi produk).
- Konfirmasi beli memakai tombol `✅ Saya Paham, Lanjut Bayar` + tombol `📜 Syarat Garansi`; invoice/pre-bayar menegaskan lanjut bayar = setuju ketentuan.
- Detail produk menunjuk garansi ikut deskripsi + `/garansi`; pesan delivery/manual mengingatkan simpan invoice untuk klaim.

## 14. Varian Produk Terpusat dan Bot Grup WhatsApp AXVARA (Terimplementasi)

Sistem varian produk terpusat dan bot WhatsApp telah diimplementasikan sesuai `docs/WHATSAPP-GROUP-BOT-PLAN.md`:

### Arsitektur
- **D1 sebagai Source of Truth:** `products` menyimpan produk induk (`name`, `whatsapp_alias`, search `aliases`, description, image, badge), sedangkan `product_variants` menyimpan SKU yang dapat dibeli (label, duration, warranty, price, stock, `min_qty` (migrasi 0034, milik admin, default 1 — GSuite 50), fulfillment_mode, sort_order). `whatsapp_alias` hanya mengatur nama presentasi di daftar/header WhatsApp dan fallback ke `name` bila kosong; `aliases` tetap khusus kata kunci pencarian bot.
- **CMS Web:** Modal card-based `VariantEditor` di `/admin` mengelola SKU/durasi/garansi/harga/stok dengan tombol aksi konsisten; form produk memiliki field Alias WhatsApp. Menu **Pesanan** memakai tab Web/Telegram/WhatsApp, pagination, thumbnail bukti, dan aksi setujui/tolak bukti WhatsApp langsung pada baris pesanan; halaman **Bukti Bayar** terpisah telah dihapus. Menu **Bot & Otomasi** memilih target varian untuk mode `manual/shared/unique`, shared secret terenkripsi, dan inventory unik. Pembuatan produk juga membuat varian default secara atomik. Produk/varian yang dihapus diarsipkan (`is_active=0`) agar relasi historis tetap utuh; edit harga/stok melalui form produk hanya disinkronkan bila produk masih mempunyai satu varian default. Sejak fix Canva Sep 2026: `PUT /api/products/:id` yang membawa `variants` eksplisit TIDAK lagi menilai/menulis kolom legacy `price/stock/compare_price` — master dihitung ulang dari varian aktif (`MIN(price)`, agregat stok, `compare_price` NULL untuk multi-varian), sehingga save produk multi-varian tidak lagi 409. Guard 409 hanya berlaku untuk edit legacy TANPA `variants`. Client `useProductManager` mode varian tidak lagi mengirim kolom legacy.
- **Service Bersama:** `src/lib/catalog.ts` menyediakan query terpusat untuk web, Telegram, dan WhatsApp. `src/lib/warranty-policy.ts` mengekstrak kebijakan garansi kanonis dengan formatter Telegram (HTML) dan WhatsApp (bold `*`).
- **Website:** Halaman detail `/produk/[slug]` mendukung variant selector interaktif; cart Zustand membedakan item berdasarkan kombinasi `product_id + variant_id`; checkout quote mendukung variant_id.
- **Telegram Bot:** Menambahkan langkah pemilihan varian sebelum konfirmasi beli (`TELEGRAM_VARIANT_FLOW`). Menggunakan harga dan konfigurasi varian.
- **Navigasi & marketing Telegram Fase 1:** label menu bawah (`MENU_LABEL_*`: 🛍 Katalog · 🔎 Cari · 🛒 Keranjang · 📦 Pesanan · ❓ Bantuan terpusat di `keyboards.ts` dan tetap di-route sebagai teks di webhook untuk keyboard lama); `/start` hanya mengirim satu foto welcome + `homeKeyboard` tanpa bubble "Menu cepat" tambahan; command `/cari`+`/search`, `/orders`+`/riwayat`, `/cart`+`/keranjang`; welcome landing `/start` menampilkan 3 bestseller by `sold_count`; `Terjual X` (compact `1.5rb+` di ≥1000) di kartu produk; riwayat `/orders` 10 terakhir by `telegram_user_id` dengan keyboard `myOrdersKeyboard` (detail + `reorder:*` → beli lagi); pencarian nama/alias via `pending_action=search:` + `/batal`; breadcrumb `breadcrumbLine` (`Langkah X/4`) di pilihan varian (2), langsung qty (3) tanpa konfirmasi tambahan, invoice (4). Payment/fulfillment tidak berubah.
- **Keranjang + reminder Telegram Fase 2 (tanpa review/promo):** tabel `telegram_carts` (migrasi 0014, `UNIQUE(user_id, variant_id)`, CHECK qty 1–100, maks 20 baris/user; maksimal 1 baris fulfillment `unique` per keranjang karena `findReservedForOrder` + `fulfillment_jobs` memakai satu `order_code`); lib `src/lib/telegram/cart.ts` (`addToCart`/`setCartLineQty`/`removeFromCart`/`clearCart`/`getCartSummary` dengan pembersihan baris basi); tombol `🛒 + Keranjang` (`cadd:*`) di langkah qty berdampingan dengan Bayar QRIS langsung; `/cart` memakai `cartKeyboard` (➖/➕/❌ per baris, `ccheckout`, `cclear`) lalu ringkasan `cartCheckoutSummaryMessage` + konfirmasi `cconfirm` sebelum invoice terbit; checkout gabungan `createAndSendCartInvoice` = SATU order + SATU `createDanaQrisInvoice` + SATU `createFulfillmentJob` mode dominan (unique > shared > manual; campuran → job manual + snapshot `mixed` informatif), stok finite dipotong per baris dengan rollback kompensasi; cart dikosongkan hanya setelah invoice terbit; reminder pending via `sendPendingOrderReminders` di cron operasi (maks 2x/order, interval ≥60 mnt, JOIN invoice aktif `pt.status='pending'` + `expires_at` masa depan, claim CAS `telegram_reminder_count`, copy eskalatif `orderReminderMessage`).
- **Flow order Telegram (WA parity, payment khusus QRIS):** `/katalog` menampilkan daftar datar nama produk + harga (tanpa kategori wajib; kategori hanya filter opsional). Detail produk tanpa deskripsi, menampilkan foto produk web + list garansi per varian dari `product_variants` yang sama dengan web/WA. Alur beli: `Produk → Varian → Qty stepper (➖ / jumlah / ➕, angka manual 1–100) → QRIS DANA dinamis`; tidak ada SeaBank/e-wallet di Telegram. CTA jumlah langsung menerbitkan satu pesan QRIS tanpa layar pemilihan metode dan tanpa kewajiban menekan cek status. QRIS Hook melunasi order atomik, menambah `sold_count`, lalu mengirim pesan sukses otomatis. Untuk fulfillment manual, pending input WA baru dipasang setelah `paid`; buyer juga mendapat tombol WhatsApp admin dan `@axvara_support` — input WA reply-only tanpa tombol loop. Order-created ke grup admin dan paid ke buyer memakai marker D1 idempoten serta retry cron; paid juga dikirim sebagai pesan `Lunas — Telegram` tersendiri ke grup admin via `telegram_paid_admin_notified_at` (migrasi 0013) agar status grup tidak tertinggal menunggu bayar. Guard anti-double-tap memakai ulang order pending chat+varian yang sama; varian stok unik dibatasi qty 1. Sapaan WIB dinamis (Pagi/Siang/Sore/Malam + tanggal/jam) hanya di welcome/bantuan — katalog tampil bersih tanpa pengulangan sapaan/tanggal/jam.
- **WhatsApp Bot:** Webhook di `POST /api/whatsapp/webhook` via Baileys gateway Heroku. Mendukung:
  - `list` (header `LIST MENU AXVARA`, nama alias/fallback produk aktif tanpa kategori/harga, lalu footer promosi Telegram dan website resmi)
  - Pencarian nama produk/alias → detail bergaya garis dengan header alias dan varian bernomor
  - Pemilihan angka terikat per `conversation_id + member_id`
  - Pilihan `QRIS` / `SEABANK` / `EWALLET` → pending order idempotent + satu instruksi pembayaran terpilih di grup
  - `garansi` / `/garansi` → kebijakan garansi kanonis
   - Reply otomatis mengutip pesan pembeli; intake screenshot cukup memakai caption nama metode (kode order ditentukan dari sesi/order aktif), dedup, R2 private, notifikasi admin
   - Order WA mengumumkan `Order Baru — WhatsApp` ke grup Telegram admin segera setelah order dibuat (best-effort + retry cron via marker `telegram_order_notified_at`, migrasi 0023); saat lunas via QRIS Hook / retry admin / approve bukti, grup menerima `Lunas — WhatsApp` (`telegram_paid_admin_notified_at`, cron yang sama dengan Telegram)
   - Admin pada `WHATSAPP_ADMIN_NUMBERS` dapat reply `.d` ke pesan pembayaran atau mengetik `.d AXV-...` untuk menandai fulfillment order lunas sebagai `delivered`; command non-admin berhenti sebelum pencarian produk
- **Feature Flags:** 10 feature flags independen di `src/lib/feature-flags.ts` untuk rollout aman bertahap (semua default `false`).
- **Minimum pembelian per varian (migrasi 0034, 2026-09-17):** `product_variants.min_qty` (default 1, CHECK ≥ 1, milik admin — sync WR tidak pernah menulisnya) adalah mode generik untuk aturan grosir: GSuite dikunci 50 via UPDATE migrasi, produk lain tinggal set angka dari admin (plafon 100 = plafon channel). Penegakan berlapis server-side: quote 409 `below_minimum` (qty agregat per baris) → orders 409 (hitung ulang DB) → guard atomik `COALESCE(min_qty,1)` di `createOrderWithStock` + `createChannelOrderAtomic` (batch gagal total bila di bawah min). Plafon web naik 20 → 100/baris (paritas Telegram) agar min-besar bisa dibeli dari web; verifier quote ikut 100. Telegram: stepper dibuka di min, tolak ketik/invoice/keranjang di bawah min; WhatsApp (qty selalu 1): varian min>1 ditolak jelas sejak pilih varian + saat bayar, diarahkan ke web/Telegram bulk.

### Status Rollout Produksi WhatsApp

Mulai 5 September 2026, Baileys gateway produksi berjalan di Heroku dan seluruh fitur transaksi WhatsApp aktif untuk GID pada `WHATSAPP_GROUP_ALLOWLIST`. Flag aktif meliputi `PRODUCT_VARIANTS_READ`, `WHATSAPP_ENABLED`, `WHATSAPP_GROUP_DISCOVERY`, `WHATSAPP_GROUP_PAYMENT`, `WHATSAPP_PROOF_INTAKE`, `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT`, dan `WHATSAPP_FULFILLMENT`. **Sejak 19 Sep 2026 `WHATSAPP_CREDENTIAL_DM_ENABLED=false` (default mati)** — auto-DM kredensial ke buyer dimatikan pasca-restriction nomor BOT; grup tetap penuh, kredensial via email + panel + manual HP. Outbound `/send` dan `/send-image` wajib memakai shared gateway token; pesan inbound di-cache terbatas selama 20 menit agar balasan dapat memakai quoted message Baileys. Target kirim dinormalisasi di adapter via `normalizeWhatsAppTarget` (2026-09-18 sore, live): nomor HP mentah (`628…`/`08…`, seperti tersimpan di outbox) menjadi JID DM `<62…>@s.whatsapp.net` — Baileys baru melempar `jidDecode(...)` undefined untuk target tanpa domain (bukti prod: 2 baris `wr-web-ready` gagal 4x sejak 13:20 UTC 18 Sep). Pola DM ketat (`^62\\d{9,13}$`/`^0\\d{9,13}$`); JID grup (`@g.us`) dan ID non-pola dikembalikan apa adanya agar gateway yang menolak, bukan salah alamat.
- **Hardening umur nomor gateway (19 Sep 2026, deploy DITUNDA sampai restriction lepas — deploy = restart = reconnect saat dibatasi = memperpanjang).** `axvara-wa-gateway/src/index.ts`: (1) 401/loggedOut = TIDAK reconnect otomatis (hammer = signature bot; diam + terpantau, pairing manual oleh owner); (2) 515 reconnect cepat 1 dtk; sisanya exponential backoff + jitter (maks ~60 dtk); (3) teardown socket lama (`end()` + hapus listener) sebelum bikin baru — anti zombie socket / konflik sesi; (4) `cachedGroupMetadata` TTL 5 mnt (hemat fetch partisipan tiap kirim, sesuai FAQ resmi); (5) jeda baca acak 1–2,5 dtk sebelum teruskan inbound; (6) antrean outbound serial + jeda 4–8 dtk + cooldown 15 mnt setelah 3 sinyal bahaya (`gateway_cooldown_active`, `/send` 429 saat cooldown); (7) `/health` memaparkan `lastDisconnectCode/lastDisconnectAt/reconnectCount`. Jangan ganti string browser, jangan hapus `baileys_auth_keys`, satu socket per dyno.

### Tabel Baru (migrasi 0007)
| Tabel | Tujuan |
|---|---|
| `product_variants` | SKU varian produk (harga, stok, durasi, garansi, fulfillment) |
| `whatsapp_sessions` | Sesi percakapan per anggota grup WhatsApp (TTL 15 menit) |
| `whatsapp_inbox_events` | Idempotency / dedup webhook WhatsApp |
| `whatsapp_outbox` | Antrean pengiriman pesan WhatsApp dengan retry |
| `payment_proofs` | Metadata bukti pembayaran grup WhatsApp (R2 private, review queue) |

### Migrasi 0008 — Multi-channel Orders Rebuild
Migrasi `0008_orders_multichannel.sql` melakukan SQLite table rebuild pada tabel `orders` agar constraint `sales_channel` menerima `'web'`, `'telegram'`, dan `'whatsapp'`. Menambahkan kolom identitas channel kanonis `channel_conversation_id` dan `channel_member_id`, memigrasikan data lama dengan `PRAGMA defer_foreign_keys=ON` agar referensi `orders(code)` tetap valid, memperbarui indeks order, serta menambahkan unique partial index agar hanya satu bukti `submitted/approved` aktif per order.

Karena D1 tetap menjalankan `DROP TABLE` sebagai implicit delete walaupun pemeriksaan FK ditunda, migrasi memindahkan sementara `order_code` pada `payment_transactions`, `fulfillment_jobs`, dan `payment_proofs` ke namespace khusus sebelum parent lama dihapus. Setelah `orders_new` menjadi `orders`, seluruh key anak dikembalikan dan `PRAGMA defer_foreign_keys=OFF` memaksa validasi sebelum commit. Regression test menjalankan migrasi terhadap fixture dengan ketiga tabel anak berisi data, memeriksa `foreign_key_check`, preservasi row, pemetaan Telegram, dan insert channel WhatsApp.

### Migrasi 0009 — Alias WhatsApp dan Repair Status
Migrasi `0009_whatsapp_alias_order_state.sql` menambah `products.whatsapp_alias`, mengisi alias ringkas untuk katalog yang sudah ada, mengubah sesi aktif lama ke provider `baileys`, serta menyelaraskan `orders.payment_status` historis dengan status `kadaluarsa`, `dibatalkan`, dan `lunas`. Counter Telegram pada Bot & Otomasi membaca `orders.status`, sehingga pesanan kedaluwarsa tidak lagi muncul sebagai pending.

### Migrasi 0010 — DANA Dynamic QRIS

Migrasi `0010_dana_dynamic_qris.sql` menambah `unique_code` dan `qris_payload` pada ledger, unique partial index untuk nominal invoice DANA aktif, dan `dana_webhook_events` untuk dedup/audit hook. Konfigurasi `payment_methods.qris` dipindahkan ke `QRIS Dinamis` dengan `qris_url=NULL`; seluruh aset QRIS statis publik dihapus.

### Keamanan Webhook & Gateway WhatsApp
- **Autentikasi Webhook:** Membandingkan `WHATSAPP_WEBHOOK_TOKEN` via `timingSafeEqual` (constant-time comparison). Gateway Baileys mengirim header `x-webhook-token`; header/query/payload fallback tetap tersedia untuk diagnosis. Body dibatasi 64 KB dan diparse tanpa side effect sebelum autentikasi; permintaan tanpa token atau dengan token salah ditolak HTTP 401 sebelum menyentuh D1. Arah Pages→Heroku memakai nilai yang sama pada `x-gateway-token` dan endpoint kirim menolak request tanpa token.
- **Kontrak Baileys:** `sender` dipetakan sebagai ID grup (`conversationId`), `member` sebagai nomor pengirim (`memberId`), `inboxid` sebagai ID pesan/referensi quoted reply (`inboxId`), dan `reply` sebagai stanza yang dikutip pembeli. Karena Baileys 7 memakai LID di grup, gateway memilih PN dari `participantAlt` saat `participant` berakhiran `@lid` agar allowlist admin berbasis nomor tetap akurat.
- **Inbox & Order Idempotency:** Event tanpa `inboxid` ditolak. Event yang sama dideduplikasi; event gagal dapat direclaim oleh satu retry. Satu pesan `pay` memakai `conversation + member + inboxid + variant` sebagai idempotency key, sementara pesan `pay` baru tetap dapat membuat pembelian ulang varian yang sama. Pending order lama hanya dipakai ulang jika masih unpaid dan belum kedaluwarsa. Webhook membatasi 12 event per anggota/grup per menit; cron menghapus session yang lewat masa simpan dan inbox dedupe lebih dari tujuh hari.
- **Media Bukti & Anti-SSRF:** Gateway Baileys mengunduh image message dan menyediakan token URL acak sekali pakai selama 10 menit. Pages hanya menerima HTTPS, memvalidasi anti-SSRF terhadap private IP/loopback, men-stream maksimal 5 MB, memverifikasi magic bytes (JPG/PNG/WebP), menghitung SHA-256, lalu menyimpan privat di Cloudflare R2 prefix `bukti/whatsapp/`. Shared gateway token tidak pernah diteruskan ke URL media.
- **Review & Otoritas Pembayaran:** Bukti QRIS hanya evidence opsional dan tidak dapat melunasi order. `POST /api/webhook/dana` adalah satu-satunya authority QRIS; SeaBank/e-wallet tetap memakai review admin CAS. Pembayaran QRIS yang sudah terdeteksi tidak ditahan oleh kewajiban screenshot WhatsApp.
- **Lifecycle Stok & Pembayaran:** QRIS berlaku 15 menit. Telegram/Web boleh meminta QR pengganti **maksimal 1 kali**, hanya setelah QR pertama kedaluwarsa dan sebelum batas tunggu order 60 menit. Setelah diterbitkan, deadline order dipendekkan ke deadline QR pengganti (maksimal 15 menit, tidak melewati deadline order sebelumnya); jika tetap belum dibayar, order kedaluwarsa dan stok dilepas. WhatsApp hanya mendapat **1 QRIS tanpa pembaruan**: order dan QR hangus setelah 15 menit, lalu pembeli harus order ulang. QRIS Hook memperbarui ledger+order dalam satu batch guard. Cron memakai deadline order DANA (fallback invoice untuk legacy tanpa deadline), memeriksa deadline ulang dalam batch sebelum melepas stok. Migrasi 0026 menyesuaikan deadline WA/QR pengganti yang sudah pending dan menambah `payment_transactions.expiry_notice_state` (`renewable`/`terminal`). `src/lib/payments/qris-expiry-notifications.ts` mengirim tombol pembaruan hanya bersama pesan kedaluwarsa pertama Telegram; kegagalan kirim tetap pending, dan pesan terminal WA memakai outbox idempoten per order. Marker reset saat reissue bersama reset delivery foto Telegram, tanpa membuat QR tambahan. Helper memakai budget D1 request yang sama (1 list + maksimal 2 query per pesan). Notifikasi mengikuti cron 5 menit; deadline penerimaan pembayaran tidak menunggu cron. `GET /api/orders?code=...` dan `/api/orders/[code]` mengembalikan `expires_at` dan `qris_reissue_allowed` untuk halaman pesanan. Rail manual WhatsApp tanpa ledger tetap memakai TTL sebelumnya.
- **Proteksi Kredensial Fulfillment:** Job hanya dapat di-claim setelah order `lunas/paid`; mode dipatok oleh `variant_snapshot` order dan shared secret diambil dari varian terpilih. Varian shared tanpa secret terenkripsi dan varian unique tanpa inventory gagal tertutup sebelum order bot dibuat. Pengiriman WhatsApp selalu via pesan langsung (DM) ke `channel_member_id`/`customer_wa`, tidak pernah ke grup. Gate `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT` menahan job sampai bukti diserahkan, dan `WHATSAPP_FULFILLMENT` dapat memaksa jalur manual selama rollout.

### Migrasi 0025 — Riwayat penerbitan QRIS

`payment_transactions` tetap satu baris per order. `invoice_issued_at` menyimpan waktu penerbitan QR terkini, sedangkan `created_at` tetap waktu pembuatan ledger. Trigger insert/update menyalin setiap nominal ke `payment_invoice_history` (kunci provider/order/nominal); reissue tidak pernah memakai kembali nominal milik order yang sama. Allocator mengutamakan nominal yang belum pernah dipakai. Jika pool mengharuskan pemakaian nominal order lain, webhook dan retry otomatis menolak lewat predikat bersama `DANA_AMOUNT_REUSED_SQL`; hanya verifikasi mutasi admin yang dapat melewati pemeriksaan reuse. Waktu event juga harus berada pada atau setelah `invoice_issued_at`, termasuk di dalam guard pelunasan atomik.

Migrasi mengisi riwayat yang masih tersedia. Untuk order dengan `qris_reissue_count>0` sebelum migrasi, nominal sebelumnya tidak bisa dipulihkan dari ledger: rentang harga dasar +1 sampai +299 dicatat di `dana_qris_legacy_ranges`, sehingga pembayaran dalam rentang itu memerlukan verifikasi manual. Order terminal tidak diaktifkan kembali. `publish-scheduled` tetap menyerahkan order yang memiliki ledger aktif ke cron operasi. Test integrasi menjalankan checkout → QR expired → kedua cron → reissue → webhook, juga pelepasan stok tepat sekali pada deadline order.

## 15. Warung Rebahan H2H Reseller Layer (Terimplementasi)

Axvara menjadi reseller layer di atas Warung Rebahan H2H API (`https://warungrebahan.com/api/v1`).
Blueprint lengkap: `docs/WARUNG-REBAHAN-INTEGRATION.md`. Implementasi Sep 2026 mencakup
Fase 1–4 (foundation, sync, auto-order, saldo+admin); storefront tidak diubah karena produk
WR masuk tabel `products`/`product_variants` yang sudah ada (badge "Stok Habis" existing dipakai).

### Arsitektur

- **Modul:** `src/lib/warung-rebahan/` — `client.ts` (fetch edge + HMAC webhook + error
  classification + mode proxy Opsi A), `sync.ts` (upsert produk/varian + exclusion +
  markup + agregat induk + sync cursor budget-aware), `order.ts` (link pending +
  claim/lease exact-once + retry backoff + reconcile stuck + reconciler lunas-tanpa-link),
  `deliver.ts` (enkripsi akun AES-256-GCM + delivery Telegram/WhatsApp/Web +
  token kapabilitas + antrean delivery durable + agregat order), `saldo.ts`
  (check + alert + estimasi).
- **Routes:** `POST /api/webhook/warung` (HMAC, rate-limit, monotonik + event log,
  selalu 200 pasca-verifikasi); pembeli `GET/POST /api/orders/[code]/credentials`
  (retrieval via verifikasi WA / capability token); admin
  `GET /api/admin/warung/saldo`, `POST /api/admin/warung/sync` (rate-limit products:write),
  `GET /api/admin/warung/sync-log`, `GET /api/admin/warung/orders` (ciphertext disamarkan,
  cari manual by invoice WR `?q=#RBHN-…` + tampilkan buyer Axvara untuk forward email WR),
  `POST /api/admin/warung/orders/[id]/retry` (CAS — race kalah → 409),
  `GET/POST/DELETE /api/admin/warung/exclusions`, `GET/PUT /api/admin/warung/markup`,
  `GET/POST /api/admin/warung/credentials` (retrieval + resend admin).
- **Storefront:** `WrCredentialsPanel.tsx` di halaman pesanan (lunas): verifikasi
  nomor WA checkout → tampilkan detail akun + capability token (sessionStorage).
  Panel HANYA dirender bila `credentials_ready === true` dari `GET /api/orders?code=`
  (flag boolean: ada `wr_order_links` `completed` + `wr_account_details`, dievaluasi
  hanya untuk order `lunas`, `.catch` → `false` pada D1 pra-0027). Order lunas tanpa
  kredensial (fulfillment manual) mendapat blok statis **Pengiriman Produk** berisi
  tujuan pengiriman (WA + email checkout tersamar) — bukan form verifikasi yang pasti
  gagal `not_ready`. Selama `lunas && !credentials_ready`, halaman mem-poll
  `GET /api/orders?code=` tiap 20 dtk maksimal 30 kali (±10 mnt) agar panel muncul
  sendiri tanpa reload; retrieval tetap wajib verifikasi WA/capability token.
  Display dinormalisasi di USE-time via `normalizeAccountDetailsForDisplay`
  (2026-09-18 sore, live): data lama tersimpan sebagai JSON mentah
  `{"product":..,"details":"email:..\r\npassword:.."}` diformat rapi di SEMUA
  kanal (panel, WA, email, Telegram) tanpa migrasi data — envelope dikupas
  (maks 3 lapis), `\r\n` dinormalisasi SEBELUM split, pembungkus
  `{product,details}` hanya memakai `details`-nya, label ganda dibuang.
  Ciphertext TIDAK diubah (format simpan tetap).
- **Kelas pengiriman + auto-order antrean (18 Sep 2026, live).** `wr_delivery_class`
  membedakan `restock` (instan) dari `made_by_order` (dikerjakan manusia di sisi
  supplier; estimasi supplier 6–12 jam, "<1 jam bila lancar"). Gate lama hanya
  meneruskan `restock`, sehingga link kelas antrean diam di `pending` selamanya:
  tidak ada request keluar dan pembeli menunggu sampai admin sadar. Sejak
  2026-09-18 SELURUH kelas diteruskan otomatis; `WARUNG_REBAHAN_AUTO_ORDER_MBO=false`
  adalah saklar mundur tanpa deploy. Satu sumber copy + ambang ada di
  `src/lib/warung-rebahan/delivery-class.ts`: `WR_QUEUED_MAX_HOURS = 12` (plafon
  janji pembeli), `WR_QUEUED_ALERT_HOURS = 13` (ambang alert internal, sengaja di
  atas plafon agar tidak alert fatigue), `deliveryEtaForBuyer()`, dan
  `isQueuedFulfillment()` (varian WR non-restock ATAU varian non-WR `manual`).
  Ekspektasi waktu WAJIB tampil SEBELUM bayar: PDP (badge, tanpa ikon
  checklist ganda sejak 2026-09-19) dan checkout (blok "Made By Order"
  dari flag `queued_delivery` per baris di respons quote; kalimat ETA modal
  dihapus 2026-09-19). `GET /api/orders?code=`
  mengirim `queued_delivery` (satu query gabungan dengan `credentials_ready`,
  memakai `json_each(orders.items)`), dan halaman pesanan memakainya untuk memilih
  teks serta memperpendek polling ke 3 percobaan (polling tidak mungkin menutup
  12 jam — kabarnya lewat WA/email). Nama supplier tidak pernah muncul di copy
  pembeli; keterangan "third-party independen" DIPERTAHANKAN di `/garansi-replace`
  sebagai dasar klaim garansi, dan masa garansi kelas antrean dinyatakan mulai saat
  detail akun diserahkan.
- **Pengawasan antrean (18 Sep 2026, live).** `notifyWebBuyerCredentialsReady()`
  mengantrekan pesan WA idempoten (`wr-web-ready:<order>`) saat detail akun siap
  untuk channel web — isinya kabar + tautan invoice. DM kredensial (`wr-delivery`,
  `wr-web-ready`) TANPA footer `/garansi` sejak 19 Sep (keputusan owner — perintah
  itu untuk grup via webhook `/garansi`, bukan DM buyer; handler grup tak tersentuh).
- **Pemantauan wajib sepekan (19–26 Sep 2026, keputusan owner).**
  Setiap hari cek: (1) sweep sync tercatat (`wr_sync_log trigger='cron'`
  tiap ~30 mnt, bukan hanya `manual`); (2) `whatsapp_outbox` tanpa `failed/dead`
  ber-`last_error='whatsapp_not_connected'` (tanda gateway 401 loop kambuh);
  (3) `wr_order_links` tanpa `delivery_status` menggantung di `queued/failed/sending`
  melewati backoff; (4) pairing ulang gateway HANYA dengan sesi yang sama
  (jangan hapus kunci auth manual — sesi `registered:false` + `me.id` terisi
  = minta pairing code baru di HP yang sama via `pair-d1.ts`, bukan sesi mati).
  Bila `connected:false` >30 menit → restart dyno (`heroku restart`), bila 401 loop
  persisten → pairing ulang + catat di CHANGELOG.
- **Kredensial 3 jalur (18 Sep 2026, live — keputusan owner, Fase B).** Isi
  detail akun dikirim LANGSUNG, bukan hanya kabar: (a) WA via outbox durable
  (`deliverWebCredentialViaWhatsApp`, kunci `wr-delivery:<code>[:pN]`, potong
  1500 char/bagian, hanya DM `customer_wa`); (b) email via Resend
  (`deliverWebCredentialViaEmail`, template "Detail Akun Siap" berisi isi +
  peringatan jangan bagikan, idempoten `wr-cred-email:<code>` di
  `wr_email_forward_log`, migrasi 0038 membuka kind `credential_ready` +
  channel `email-credential` — CHECK lama menolak INSERT diam-diam sehingga
  retry mengirim ganda, tertangkap test sebelum live; pembeli tanpa email
  dilewati diam); (c) panel web: `WrCredentialsPanel` dipakai ulang di hasil
  `/lacak-pesanan` dengan `prefillWa` dari input lookup + auto-verify sekali
  (verifikasi tetap di server via `/api/orders/[code]/credentials`; lookup
  sudah `constantTimeEqual` penuh sehingga setara halaman pesanan).
  `formatWrAccountDetails` memakai key map normalisasi (`akses otp`/URL/
  username tampil rapi, key asing dikapitalisasi — bukan JSON mentah).
  Aturan settled: dua-duanya gagal = throw agar retry; satu gagal = catat
  `web_push_partial` tapi settled (token + panel tetap jalan).
  `alertAgingWrOrders()`
  memberi tahu admin via Telegram bila link masih `processing/submitted/ordering/claimed`
  melewati `WR_QUEUED_ALERT_HOURS`, idempoten lewat kolom `aging_alerted_at`
  (migrasi 0037) dan ditandai SEBELUM kirim agar kegagalan notifikasi tidak
  menghasilkan ping berulang tiap 5 menit. Panel admin menampilkan umur tiap baris
  antrean (merah + "lewat batas" di ≥13 jam). Ambang alert saldo default naik
  50.000 → 250.000 karena modal varian termahal Rp200.000 — ambang lama memberi
  rasa aman palsu saat auto-order kelas antrean dibuka.
- **Admin UI:** tab "Warung Rebahan" (`WarungRebahanManager.tsx`, section `warung` di
  `AdminShell` + `admin/page.tsx`): saldo + estimasi, sync terakhir + force sync, antrean
  order + retry, exclusions, markup per varian. Antrean order punya kolom cari
  invoice WR (`#RBHN-…` / kode Axvara, debounce 400ms, LIKE di-escape) +
  baris buyer (nama · WA · email · channel) — jembatan manual forward email WR
  ke buyer Axvara sebelum bot email otomatis fase 2. Health WR ikut `GET /api/admin/bot/health`.
- **Cron:** fase baru `warung_rebahan` disisipkan `fulfillment → warung_rebahan → notify`
  (`src/app/api/cron/operations/route.ts`): sync produk tiap 30 mnt, proses order due (maks 4),
  reconcile processing >1 jam via `/transactions`, cek saldo tiap 1 jam. COUNT WR dihitung
  query terpisah agar DB pre-migrasi tidak meruntuhkan query gabungan; fase no-op bila
  master switch mati atau tabel WR belum ada.
- **Budget WAKTU sweep katalog (akar "sync tersendat", diperbaiki 2026-09-20):** sweep penuh
  = 48 produk / 87 varian = **~366 query D1 berurutan**, sehingga durasinya ditentukan latensi
  D1, bukan jumlah pekerjaan. Terukur di produksi dengan beban identik: **12 dtk saat D1 sehat
  (~33 ms/query) vs 115-122 dtk saat D1 lambat (~314 ms/query)**; 68 dari 391 sweep (17%)
  melewati deadline run 45 dtk. Run yang terpotong mati SEBELUM ekor menulis `wr_sync_log` +
  penanda fase, sehingga sweep tak tercatat, fase terkunci, dan jeda sync melonjak 39-40 mnt
  → 163/305 mnt. Aturan sekarang: `syncProducts` menerima `timeBudgetMs` dan mengecek sisa
  waktu TIAP iterasi memakai latensi terukur run itu sendiri (adaptif, bukan konstanta), lalu
  berhenti di produk utuh terakhir + simpan cursor + `budgetYielded=true` — jalur yang sama
  dengan saat budget query habis. Cron mengoper `timeLeftMs() - TIME_WR_SWEEP_RESERVE`
  (cadangan 8 dtk untuk reconcile/saldo/delivery + ekor). Force Sync admin sengaja TIDAK
  memasang `timeBudgetMs` (bukan invocation cron yang dibunuh platform).
  **Pelajaran:** gerbang budget query saja tidak cukup — biaya nyata sweep adalah WAKTU,
  dan seluruh perbaikan sebelumnya hanya mengatur KAPAN sweep dimulai.
- **Batching D1 sweep katalog (akar latensi, diperbaiki 2026-09-22):** butir di atas
  mengelola AKIBAT (sweep berhenti sebelum dibunuh); butir ini memangkas SEBABNYA.
  Terukur: `sql_duration_ms` D1 produksi hanya **0,12–0,19 ms**, tetapi sweep memakai
  **~197 ms per query** — jadi **99,9% durasi sweep adalah menunggu jaringan**, bukan
  kerja database. Penyebabnya D1 primary di **SIN** (`served_by_colo: SIN`,
  `read_replication: null`) sementara Pages Function jalan di colo terdekat pemanggil,
  sehingga tiap round-trip menyeberang benua. Bukti beban IDENTIK (48 produk/87 varian):
  **8.551 ms (178 ms/produk) vs 122.473 ms (2.552 ms/produk)** — selisih 14x tanpa
  perubahan pekerjaan. Perbaikan: tulis satu produk dikumpulkan sebagai rencana
  (`SqlWrite`) lalu dikirim SATU `d1.batch()`, dan baris pembanding (`wr_variants` +
  registry `wr_products` + verifikasi tautan katalog) di-prefetch massal via `IN (...)`
  (dipotong per 50 id — D1 menolak >100 bound parameter). Terukur pada fixture 48/87:
  **642 → 117 round-trip (−82%)** dengan baris tertulis tetap 12 (guard kuota tidak
  bergeser). **Cakupan batch SENGAJA per produk, bukan per sweep:** `batch()` adalah
  transaksi, jadi satu produk bermasalah tidak boleh membatalkan produk lain — jalur lama
  mencatat error per produk lalu lanjut, dan sifat itu dipertahankan. Varian/produk BARU
  tetap berurutan karena butuh `lastInsertRowid` untuk menautkan barisnya. Bila `batch()`
  gagal, tulis diulang satu per satu agar statement `optional` (dulu `.catch()`) kembali
  toleran seperti sebelum batching. Efek samping penting: round-trip yang turun ikut
  menurunkan CPU — produksi mencatat **270 invocation `exceededResources` dengan
  `cpuTimeP50` mentok 10.000 µs**, yaitu plafon CPU Workers Free, pada irama cron 5 menit.
  Karena itu **menaikkan `RUN_DEADLINE_MS` justru berbahaya** (lebih banyak produk per run
  = lebih banyak CPU = lebih banyak run dibunuh sebelum menulis log); pengikatnya CPU dan
  round-trip, bukan deadline. Dikunci oleh
  `tests/warung-rebahan/sync-roundtrip.regression.test.ts`.
- **Hook payment:** setelah lunas di 4 jalur (webhook DANA, retry admin, approve bukti,
  konfirmasi admin) → `createWrOrderLinksForOrder` + `processWrPendingOrders` best-effort;
  cron memproses sisanya. Produk WR dikenali dari `product_variants.wr_variant_id`.

### Skema (migrasi 0027 Ralph: final = 0027 + 0028 + 0029; schema.sql bootstrap)

`wr_products` (registry + link `axvara_product_id` + flag excluded), `wr_variants`
(registry + `markup_percent/fixed` + `axvara_sell_price` + link varian), `wr_order_links`
(order Axvara ↔ order WR, **exactly-once**: pending→claimed→submitted→ordering→
processing→completed/failed, retry/blocked_balance, `idempotency_key` UNIQUE,
lease `lease_owner/lease_expires_at` 5 mnt, kunci `request_sent_at` anti-resend,
delivery durable `delivery_status/attempt_count/next_attempt_at`, akun terenkripsi,
`fulfillment_item_id` milik fulfillment per-item), `wr_sync_log`, `wr_saldo_log`,
`wr_exclusions` (**KOSONG** — seed Canva/Gemini 0027 dihapus 0028), `wr_sync_state`
(cursor/generation/snapshot sync), `wr_credential_tokens` (hash + expiry 30 hari +
revoke), `wr_webhook_events` (log monotonik anti-replay).
Kolom baru: `products(source, wr_product_id, wr_auto_managed)`,
`product_variants(wr_variant_id, wr_auto_managed)`,
`fulfillment_items(wr_link_id)` — item milik WR diselesaikan via link, dilewati
`processItem` generik; agregat order di-refresh dari item (bukan status link).
Varian hilang dari API di-nol-kan stoknya (tidak dihapus). Seluruh tabel di atas
ada di `drizzle/schema.sql` — bootstrap baru langsung final tanpa migrasi manual.
Migrasi 0030 menambahkan `products.admin_description_override` (lihat kepemilikan
field di bawah).

### Kepemilikan field produk WR (migrasi 0030)

Sync menimpa field miliknya setiap sweep, jadi batas kepemilikan ditegakkan di
API (`src/lib/warung-rebahan/ownership.ts`), bukan hanya disable input di UI —
agent CMS, curl, dan tab admin lama tidak terikat aturan UI.

| Pemilik | Field |
| --- | --- |
| WR (read-only di admin) | `name`, `slug`, `description`, harga & stok master, label varian, harga varian, stok varian, durasi, garansi, S&K varian (`terms`) + cara aktivasi (`delivery_terms`, read-only dari `wr_variants`) |
| Admin | foto/`images`, `badge`, kategori, `sort_order`, `is_active`, `admin_description_override`, **harga coret (`compare_price`)** — milik admin agar katalog WR bisa pasang diskon/badge seperti produk manual (2026-09-17); sync TIDAK PERNAH menulis `compare_price` (UPDATE/INSERT varian hanya label/price/stock/durasi/garansi), jadi nilai admin aman lintas sweep; input Harga Coret di modal edit selalu terbuka (label "✎ bisa diedit") |
| Panel WR | markup (`wr_variants.markup_percent/markup_fixed`) |

Guard dipasang di **kedua jalur tulis varian**: `PUT /api/products/:id` dan
`/api/admin/variants` (PUT tunggal + POST batch, dipakai `VariantEditor`).
Menutup hanya salah satunya tidak cukup — panel varian lama akan tetap
menjadi pintu belakang untuk perubahan yang pasti hilang di sweep berikutnya.

`PUT /api/products/:id` membalas **409** dengan `{error, field}` bila request
mengubah field WR-owned pada produk `wr_auto_managed=1`; mengirim ulang nilai
yang sama tidak dianggap pelanggaran (form admin mengirim payload utuh).
`admin_description_override` adalah teks milik admin: bila terisi, itulah yang
tampil di storefront dan `GET /api/products`; sync TIDAK PERNAH menulis kolom
tersebut. Resolusi "override menang atas `description`" dipusatkan di
`displayDescription()` pada `src/lib/catalog.ts`, sehingga **seluruh kanal**
(web, PDP `/produk/[slug]` termasuk meta SEO/Open Graph/JSON-LD, `/api/catalog`,
bot Telegram, bot WhatsApp) menampilkan teks yang sama — bukan hanya web.
Setiap pembaca deskripsi produk baru WAJIB memakai helper ini, bukan membaca
kolom `description` langsung. `GET /api/products/:id` memisahkan keduanya
(`description` = teks yang tampil, `wrDescription` = teks WR,
`adminDescriptionOverride`, `wrManaged`).
Badge "WR • dikelola otomatis" hanya tampil di editor produk admin — storefront
tidak menampilkan penanda WR apa pun.

### S&K varian WR di PDP (tanpa migrasi) + label garansi kanonis

S&K WR adalah data **per varian** (`terms` + `delivery_terms`, 87/87 dan 37/87
varian terisi di prod) yang hidup di tabel cermin `wr_variants` milik sync.
`product_variants` sengaja TIDAK diberi kolom baru (hindari dual-write/drift):
`getProductDetail`/`getActiveVariant` di `src/lib/catalog.ts` LEFT JOIN
`wr_variants` via `wr_variant_id` dan memaparkannya di `VariantSummary.terms` /
`.delivery_terms`. PDP `/produk/[slug]` merender section "Syarat & Ketentuan"
**terikat varian terpilih** (fallback varian aktif pertama), bernomor otomatis
+ sub-blok "Cara Aktivasi" bila ada — desktop di kolom kiri bawah deskripsi,
mobile sebagai kartu di bawah accordion deskripsi. Varian manual (tanpa
`wr_variant_id`) mendapat `null` dan section disembunyikan.

`formatWarranty()` untuk tipe `limited` SELALU membentuk kanonis
`Garansi {value} {unit}` dari field terstruktur ("Garansi 12 Hari") — label
mentah WR ("12 Hari", ambigu dengan durasi) hanya dipakai untuk tipe `custom`.
Satu helper dipakai web + Telegram + WA sekaligus; label ditampilkan dengan
ikon shield agar setara badge "Garansi N Hari" di web WR.

### Force Sync melaporkan status apa adanya

`POST /api/admin/warung/sync` mengembalikan `status` `success` | `partial` |
`failed` (sama dengan yang ditulis ke `wr_sync_log`) dan `ok:false` saat gagal
total. Sebelumnya route selalu `{ok:true}` sehingga admin melihat "Sync selesai"
walaupun seluruh katalog gagal. Batch yang berhenti di batas budget
(`budgetYielded`) dilaporkan `partial`, bukan sukses penuh.


### Proteksi

- `WARUNG_REBAHAN_ENABLED=false` mematikan segalanya (sync/order/webhook/cron no-op).
- API key server-only, outbound hanya ke `warungrebahan.com` (assert host, https saja),
  timeout 30 dtk. Mode proxy Opsi A: API key dipegang proxy Heroku; Pages cukup
  `WARUNG_REBAHAN_PROXY_URL` (https) + `WARUNG_REBAHAN_PROXY_TOKEN` — kontrak
  dikunci di `client.test.ts` (endpoint allowlist + shape respons).
- Webhook HMAC-SHA256 (`X-Rebahan-Signature`, secret = API key), 401 bila salah;
  event monotonik (completed tidak bisa diregresi failed terlambat) + event log.
- Detail akun dienkripsi sebelum disimpan; decrypt hanya server-side saat delivery.
- Pembeli web TIDAK bisa membuka kredensial hanya dengan kode order: verifikasi
  6 digit WA checkout (sekali) atau capability token (30 hari, hash-only, revoke).
  Admin punya retrieval/resend fallback.
- Exact-once: klaim atomik (UPDATE bersyarat, lease 5 mnt, fencing `request_sent_at`),
  idempotency `wr:order:variant:item`, dedup webhook `event_id`, admin retry CAS→409.
- Markup default 50% + pembulatan 500; exclusion kosong default (Canva/Gemini ikut).
- Saldo habis → tunda 1 jam + notif admin (bukan retry cepat); gagal 3x → failed + admin
  putuskan manual (tanpa auto-refund). Order failed WR → `fulfillment_status='failed'`,
  status uang `lunas` tidak diubah otomatis.

### Bot email WR→buyer (white-label, 2026-09-17)

Email WR (`info@warungrebahan.com`) masuk mailbox ingest, bukan ke buyer —
bot meneruskannya sebagai email branding Axvara (nol jejak "Warung Rebahan"):

- **Ingest:** filter Gmail `from:info@warungrebahan.com` → label `WR-INGEST` +
  Skip Inbox. Apps Script `docs/WR-EMAIL-FORWARDER.gs.js` (trigger per-menit)
  POST subject + body ke `POST /api/webhook/wr-email` dengan
  `WR_EMAIL_WEBHOOK_SECRET`, lalu cap label `WR-SENT`. Hanya 5xx/429/timeout
  yang di-retry; Gmail TIDAK pernah dipanggil dari Pages (tidak edge-safe).
- **Parse:** `src/lib/warung-rebahan/email-forward.ts` ambil invoice
  `RBHN-…` (kunci join), status, produk/varian, email tujuan invite, total.
  Dua template Axvara: `order_update` (Pesanan Diproses) + `invite_sent`
  (Invite Terkirim) — link invoice + kontak selalu ke Axvara.
- **Join + kirim:** invoice → `wr_order_links.wr_order_id` → buyer
  (`orders.customer_email`). Kirim via Resend (`RESEND_API_KEY` +
  `FORWARD_FROM_EMAIL`, mis. `noreply@axvara.id` — JANGAN SMTP Gmail
  pribadi). Buyer tanpa email → fallback teks ke WA via `whatsapp_outbox`
  (idempoten `wr-email:order:invoice:kind`, diproses cron).
- **Idempoten:** `wr_email_forward_log.gmail_message_id` UNIQUE (migrasi
  0036) — retry forwarder = `duplicate` tanpa kirim ulang. Status:
  `forwarded` / `duplicate` / `unmatched` (invoice tak dikenal, untuk
  reconciler manual) / `skipped` (tanpa invoice) / `held` 202 (Resend belum
  dikonfigurasi / buyer tanpa kontak — tidak hilang).
- **Env baru** (`secret_text`, lihat `.env.example`): `WR_EMAIL_WEBHOOK_SECRET`,
  `RESEND_API_KEY`, `FORWARD_FROM_EMAIL`.
- **Batas LIKE D1** (50 byte) berlaku untuk param `?q=` pencarian admin WR.

## 16. Insiden operasional 2026-09-14 + arsitektur proxy terpisah (WAJIB DIBACA agent)

Hari ini prod lumpuh total (login 503, bot WA/Telegram mati, QRIS hilang, varian
tidak tampil, pagination lama kembali) lalu dipulihkan. Tiga akar + aturan
kerasnya agar tidak terulang:

### 16.1 Arsitektur proxy WR terpisah (hasil permanen hari ini)
- Akun Heroku #1 (`terry.delvon0805@gmail.com`): `axvara-wa-gateway` = WhatsApp SAJA
  (route `/wr/*` mengembalikan 410 `wr_proxy_moved`).
- Akun Heroku #2 (`sailinnadia1@gmail.com`): `axvara-wr-proxy` (source:
  `/Users/macbookair/axvara-wr-proxy/`) = proxy stateless WR → QuotaGuard Spike
  (~$5/mo, 5.000 req, IP `54.88.136.216, 54.84.188.199` di-whitelist WR).
- Jangan satukan lagi: restart gateway WA tidak boleh memutus sync WR.

### 16.2 Env Pages WAJIB `secret_text` (bukan `plain_text`)
Terbukti berulang: entri `plain_text` (FLAG, URL proxy) hilang dari deployment
berikutnya, `secret_text` terbawa. **Semua env Pages ditulis sebagai
`secret_text`, tanpa kecuali** — termasuk flag boolean dan URL. Secret Pages
bersifat write-only (GET selalu tampil kosong): verifikasi lewat perilaku
(endpoint 200), bukan lewat GET.

Cara mengubah satu env tanpa merusak yang lain (2026-09-18): pakai
`wrangler pages secret put <KEY> --project-name axvara` (satu kunci per
operasi). **JANGAN** PATCH `deployment_configs.production.env_vars` lewat REST
API dengan objek sebagian — payload itu berisiko menggantikan seluruh peta env
(38 secret) alih-alih menggabungkannya. Setelah `secret put`, nilai baru baru
terbaca oleh **deployment berikutnya**: dorong satu commit agar CI membuat
deployment baru, jangan `wrangler pages deployment create` (lihat 16.3).

Nilai yang diset 2026-09-18 (semua `secret_text`): `WARUNG_REBAHAN_AUTO_ORDER_ENABLED=true`
(gate auto-order — ini yang membelanjakan saldo sungguhan),
`WARUNG_REBAHAN_AUTO_ORDER_MBO=true` (kelas antrean ikut auto-order; set `false`
sebagai saklar mundur tanpa deploy), dan `WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD=250000`
(sebelumnya tidak ada di Pages sehingga memakai default kode). Total secret
produksi menjadi 38.

### 16.3 Jangan redeploy wrangler tanpa direktori
`wrangler pages deployment create` tanpa argumen me-redeploy artefak LAMA =
rollback prod (hari ini menimpa build CI PR#1: pagination angka + badge lama
kembali). **Deploy HANYA via CI** (`git push origin main`). Pengecualian
recovery butuh instruksi eksplisit pemilik.

### 16.4 SITE_URL bisa kosong di worker
`process.env.SITE_URL` berupa string kosong (bukan null) sehingga `?? fallback`
tidak menolong → URL relatif → Telegram "URL host is empty". Pola wajib untuk
URL absolut: `const raw=(process.env.SITE_URL??"").trim().replace(/\/$/,"");
const site=/^https?:\/\//i.test(raw)?raw:"https://axvara.tech"`.

### 16.5 Ekosistem 5 folder (detail di masing-masing AGENTS.md)
`axvara` (toko) · `axvara-wa-gateway` (WA, akun #1) · `axvara-qris-gateway`
(riset QRIS, `.env` = sumber nilai Pages) · `axvara-wr-proxy` (proxy WR, akun
#2) · `axvara-tg-bot` (kredensial Telegram). Kredensial Heroku dua akun di
`.heroku-credentials` (git-ignored, pola sama dengan `.cf-credentials`).
Perintah akun #2 wajib prefix `HEROKU_API_KEY=<kunci-akun-2>`; jangan
`heroku login` ulang (merusak sesi akun #1).

### 16.6 Perilaku sync WR satu sweep (Opsi A, 2026-09-14)
- `WR_SYNC_PRODUCTS_PER_RUN = 48` + plafon khusus katalog +800 query
  (`raiseCeilingForCatalogSync`, hanya jalur sync produk; budget cron umum +
  order/fulfillment tetap 40).
- Satu sweep ≈ 410 query. **Koreksi 2026-09-20 (terukur, bukan estimasi):**
  angka "~200 writes" di atas terlalu optimistis — sebelum guard bersyarat
  satu sweep TANPA perubahan apa pun menulis **398 baris** (96 `wr_variants`
  + 96 `product_variants` + 96 agregat `products` + 48 `wr_products` + 48
  deskripsi + state/log), karena semua `UPDATE` berjalan tanpa syarat dan
  `last_synced_at`/`updated_at` selalu disegarkan. Dikali ~56 sweep/hari =
  ~28k rows-written/hari, cocok dengan puncak GraphQL Analytics produksi
  (28.518 pada 18 Sep = **28,5% kuota Free 100k/hari**). Sejak 1 Sep 2026
  kuota tulis habis = query D1 **diblokir** (toko mati sampai tengah malam
  UTC), bukan sekadar peringatan.
  Sejak 2026-09-20 setiap `UPDATE` sync memakai guard null-safe (`IS NOT`)
  sehingga baris yang nilainya identik tidak ditulis ulang: sweep tanpa
  perubahan turun ke **12 baris (−97%)**, sementara perubahan nyata tetap
  merambat ke tiga lapis (`wr_variants` → `product_variants` → agregat
  induk). `last_synced_at` sengaja ikut tidak disegarkan saat tidak ada
  perubahan — kolom itu tidak dibaca kode mana pun (kesegaran sync dibaca
  dari `wr_sync_log`, bukan dari kolom ini).
  Dikunci oleh `tests/warung-rebahan/sync-write-quota.regression.test.ts`.
  Cursor antar-run tetap sebagai fallback.
- **Round-trip (2026-09-22):** angka "≈410 query" di atas adalah jumlah
  STATEMENT, dan itu bukan lagi jumlah perjalanan jaringan. Sejak sweep
  memakai `d1.batch()` per produk + prefetch massal, sweep 48/87 terukur
  **117 round-trip (dari 642, −82%)** sementara jumlah statement-nya tetap.
  Yang menentukan durasi sweep adalah round-trip, bukan statement: kerja SQL
  D1 hanya 0,15 ms/query sedangkan satu round-trip ke primary SIN ~197 ms.
- Produk BARU WR otomatis masuk katalog tiap sync (`products_new`): registry
  baru → baris katalog (slug anti-bentrok `-wr`, markup default 50%) +
  varian-variannya; kena exclusion → registry saja.
- Endpoint `sync-log` memfilter baris `saldo` (kartu admin tidak 0/0/0);
  notif saldo rendah di-throttle (maks 1 pesan/6 jam, ulang bila turun ≥Rp5rb).
- Migrasi 0031: kolom `wr_sync_log.trigger` (`manual`/`cron`, default manual
  untuk histori lama). Kartu admin tampil dua-baris (🔵 manual terakhir +
  🟢 cron terakhir) agar sync manual tidak menutupi jejak cron otomatis.
- Anti-starvation cron (2026-09-16, diperbaiki 2026-09-18): job `queued`
  milik order final (dibatalkan/kadaluarsa) dibersihkan + `pendingJobs` hanya
  order lunas/paid; slot `warung_rebahan` dijamin bila sync basi >45 menit
  (guard histori agar budget R12 deterministik di fixture tanpa WR).
  Koreksi 18 Sep: syarat lama `pendingWrDue === 0 && pendingWrDelivery === 0`
  DIBUANG — syarat itu memveto dirinya sendiri karena fase WR menangani order
  DAN sync, sehingga selama ada order WR menggantung guard tidak pernah
  menyala (sync mati 2,5 jam setelah perbaikan deadline 18 Sep, dua order
  Meitu 04:38–07:14 UTC). Fase WR juga didahulukan ke depan urutan eksekusi
  saat sync basi (admission sync memakai budget baseline 40 + deadline 45 s,
  sehingga bila jalan belakangan sisa budget/waktu sering habis dan sweep
   di-skip diam-diam). Skip sweep karena budget/deadline WAJIB ditandai
   (`cron_deferred` + `results.wr_sync_skipped = "deadline"|"query_budget"`).
 - Observability skip jujur + heartbeat (2026-09-19, live): gap sync
   07:12→10:24 UTC tak terlihat karena SEMUA jalur skip selain
   budget/deadline mengembalikan `synced:0 + skipped:null` yang ambigu
   (fase tak aktif / interval 30 mnt belum tempo / switch mati / tabel belum
   siap). Kini `results.wr_sync_skipped` terisi di semua jalur: `"disabled"`
   (master switch mati / tabel WR belum ada), `"phase_inactive"` (fase tak
   aktif, rotasi normal), `"interval"` (sweep terakhir <30 mnt — kondisi
   tersering), `"sync_disabled"` (`WARUNG_REBAHAN_SYNC_ENABLED=false`),
   ditambah `"deadline"`/`"query_budget"` yang sudah ada. `results.
   wr_last_sync_at` = `created_at` sweep terakhir agar respons tunggal cukup
   untuk diagnosa. Heartbeat `store_settings.cron_last_hit_at` ditulis tiap
   hit (1 statement, best-effort): cara baca — heartbeat segar + sync basi =
   run kepotong (deploy); keduanya basi = pemicu Worker mati. Revisi 19 Sep
   sore: `wr_last_sync_at` dibaca DI DEPAN (sebelum cabang fase) sehingga
   respons `phase_inactive`/`sync_disabled` pun membawa posisi sweep terakhir
   dan bisa dinilai basi vs segar dari JSON saja. Nilai `wr_sync_skipped`
   penuh: `disabled`/`phase_inactive`/`interval`/`sync_disabled`/
   `budget_yielded` (sweep dicoba tapi berhenti di plafon)/`attempted_failed`
   (sweep dicoba tapi menyimpan error + `wr_sync_errors` 3 pertama)/
   `deadline`/`query_budget`. Kontrak respons
   ini bagian dari diagnosis definitif di bawah (`wr_products_synced` /
   `wr_sync_skipped` / `wr_last_sync_at`).

   Watchdog sync basi (anti-macet struktural, 2026-09-19): empat insiden
   berulang (poison-pill, guard veto, env mati, gap misterius) semuanya butuh
   forensik manual karena tak ada yang memberi tahu pemilik. `alertStaleWrSync`
   (`src/lib/warung-rebahan/order.ts`, ambang `WR_SYNC_STALE_ALERT_MINUTES=90`
   = 3x interval normal) berjalan di fase WR aktif setelah blok sync: bila
   sweep terakhir >90 menit + belum pernah alert untuk kebasian ini → tandai
   `wr_sync_state(sync_stale_alerted_at)` DULU lalu ping Telegram admin berisi
   umur basi + waktu sweep terakhir + `wr_sync_skipped` run ini + arahan
   (cek respons cron / Force Sync). Idempoten per episode (maks 1 ping;
   sweep sukses me-reset via pengosongan state), best-effort ≤4 query di
   dalam `budget.fits(4)`, hasil di `results.wr_sync_stale_alerted`. Ritme
   normal tak pernah menyentuh 90 menit → tanpa alert palsu.
   Sweep resumable + admission proporsional (2026-09-20, akar ketiga gap
   misterius): sweep cron terbukti 50–116 detik (`duration_ms`) sementara
   gerbang lama hanya menuntut sisa 14 detik — sweep dimulai, kepotong
   platform/deploy di tengah, cursor+log hanya ditulis di ujung = NOL jejak
   + ulang dari awal + kepotong lagi (fetch 200 tiap 5 mnt di log proxy =
   kerja terbuang). Kini (a) checkpoint cursor + `products_progress_at` tiap
   8 produk (`WR_SYNC_CHECKPOINT_EVERY`) — run berikut melanjutkan; (b)
   ~~admission = durasi sukses terakhir × 1,5~~ **DIBUANG 2026-09-20 — lihat
   blok "Budget WAKTU sweep katalog" di atas**: gerbang itu diukur terhadap
   `RUN_DEADLINE_MS` (45 dtk), sehingga estimasi >45 dtk MUSTAHIL terpenuhi
   (ambang mati: `duration_ms > 30.000`). Produksi: 69 dari 104 sweep (66%)
   melewatinya. Karena jalur skip tidak menulis `wr_sync_log`, `duration_ms`
   terakhir membeku selamanya dan sweep tak pernah jalan lagi = sync MATI
   PERMANEN (pulih hanya via Force Sync manual). Penggantinya adalah budget
   waktu DI DALAM sweep, yang membuat durasi tercatat selalu ≤ budget
   sehingga tidak ada nilai beku yang bisa mengunci; (c) partial log + `budget_yielded`
   saat yield dengan kemajuan >0.
   **Aturan umum yang dipetik:** jangan pernah membuat gerbang admission yang
   inputnya HANYA bisa diperbarui oleh pekerjaan yang digerbanginya sendiri —
   itu resep deadlock. Batasi pekerjaannya dari dalam, bukan tolak dari depan.
   **Resume sweep parsial (2026-09-20):** sweep yang berhenti karena WAKTU
   punya `errors` kosong sehingga tercatat `success`; tanpa penanganan khusus
   gerbang interval 30 menit membacanya sebagai "baru sukses" dan menahan
   lanjutannya, sehingga katalog 48 produk butuh ~90 menit (4 potongan × 30
   mnt) padahal kerjanya ~2 menit CPU. Cron karena itu melanjutkan SEGERA
   bila `products_cursor > 0`. Sinyalnya sengaja **cursor**, bukan
   `products_snapshot_complete`: penanda itu di-seed `'0'` oleh migrasi 0029
   sehingga DB yang belum pernah sync tidak bisa dibedakan dari sweep parsial
   yang tertunda. `syncProducts` juga menurunkan penanda ke `'0'` saat sweep
   berhenti di tengah (sebelumnya hanya pernah dinaikkan ke `'1'`).
   Revisi permanen malam 19 Sep (pelajaran insiden 18:26→23:32, 5 jam tanpa
   ping): evaluasi watchdog PINDAH ke depan handler SETIAP RUN (bukan hanya
   fase WR aktif) dengan konteks seadanya (`pre_phase` bila fase WR tak
   aktif); blok 3c menjadi refresh konteks presisi 1x (`refreshStaleWrSyncContext`,
   state `sync_stale_alert_context`) saat fase WR aktif mengetahui
   `wr_sync_skipped` run itu. Hemat budget: skip total bila switch WR mati
   (0 query — pelajaran RR5-02: query depan mencuri slot fulfillment drain
   20-baris); 1 query baca bila tanpa histori. Urutan penting: blok depan
   berjalan SEBELUM `wrTablesReady` didefinisikan → pakai probe `.catch`
   langsung, JANGAN referensi variabel itu (ReferenceError tertelan catch =
   watchdog mati diam — tertangkap test sebelum live). Revisi 20 Sep pagi
   (bukti prod: ping 06:32 "Sebab terakhir: -"): `alertStaleWrSync` kini
   MENCATAT konteks awal (`sync_stale_alert_context`, "pre_phase" bila buta)
   saat menandai episode, dan refresh dilonggarkan — setiap run ber-sebab
   presisi boleh mengoreksi 1x per episode (syarat fase-WR-aktif dicabut,
   karena run-run basi justru jarang memegang fase WR). Force Sync
   dashboard (`POST /api/admin/warung/sync`) mem-bypass gerbang 30-menit dan
   melaporkan status jujur (success/partial/failed + errors) — pemulihan
   mandiri pemilik tanpa keahlian teknis.
 - Pelajaran Fase A 18 Sep (PENTING — cek env SEBELUM tuduh kode): sync mati
   8+ jam setelah semua guard benar ternyata karena `WARUNG_REBAHAN_ENABLED` /
   `SYNC_ENABLED` tidak `"true"` di Pages — `isWrEnabled()` false membuat fase
   WR return awal TANPA JEJAK (semua jalur skip menandai deferred; deferred
   kosong = return awal, bukan tersendat). Dua vonis salah yang sempat terjadi:
   (1) "fase bergerak = fase bekerja" — ekor + poison-pill guard jalan selalu,
   fase berpindah tiap 5 menit walau fase WR no-op; (2) "`wr_saldo_log
   api_check` = bukti cron" — refresh manual dashboard memakai source yang
   sama. Bukti kerja WR yang benar = baris `wr_sync_log trigger='cron'` +
   perubahan status link + `reconcile` menarik order. Diagnosis definitif =
   tembak `POST /api/cron/operations` langsung dan baca respons
   (`wr_products_synced` / `wr_sync_skipped`); 401 = rotasi CRON_SECRET
   (Pages + Worker + lokal harus sama; Pages secret baru terbaca deployment
   berikutnya, jadi rotasi selalu diikuti commit pemicu deploy).
- Koreksi vonis 2026-09-17 (PENTING — jangan ulangi salah baca ini):
  `store_settings.cron_phase` yang menunjuk `notify` dengan `updated_at` lama
  BUKAN bukti cron macet. Nilai itu = giliran BERIKUTNYA dalam rotasi 5 fase
  (expiry → fulfillment → warung_rebahan → notify → cleanup), bukan fase yang
  sedang jalan. Bukti cron hidup yang benar = baris `wr_sync_log
  trigger='cron'` tiap ~30 menit (12 jam terakhir 2026-09-16/17 penuh tanpa
  jam kosong: 48 produk + 87 varian `success` tiap run) + `cron_phase.value`
  yang berpindah + `updated_at` segar. Jangan vonis "cron mati" dari satu
  snapshot `cron_phase` tanpa cek distribusi `wr_sync_log` per jam.

### 16.7 Health anti-false-alarm + kelas pengiriman WR (2026-09-16)
- Query health `tgQueue`/`fulfillmentQueue`/`oldestDue` JOIN orders dan hanya
  menghitung order lunas+paid. Sebelumnya 7 `failed` order final menyeret
  Telegram ke `degraded` padahal bot sehat (webhook 0 pending, no error).
- Migrasi 0032: `wr_variants(wr_delivery_class, wr_delivery_source)`.
  API WR tidak memberi penanda auto/manual — desain hibrida: seed 17 nama
  screenshot admin (`screenshot`) + `guessDeliveryClass()` untuk sisanya dan
  varian baru (`system`) + kunci manual owner (`admin`). Sync TIDAK PERNAH
  menimpa yang sudah terisi (pola override 0030). Default ragu = manual.
- Badge pengiriman per varian TANPA emoji (2026-09-17, anti AI slop):
  restock = "Kirim otomatis" (pill emerald), selainnya = "Dikirim admin"
  (pill gold). Web: badge di kartu varian PDP + QuickVariantModal. Telegram/WA:
  baris teks polos sendiri per varian. Admin: badge RESTOK/MBO + sumber +
  tombol kunci teks AUTO/MANUAL di tabel markup (PUT `delivery_class`). Kunci:
  `PUT /api/admin/warung/markup {wr_variant_id, delivery_class}` → source
  'admin'.
- Gate auto-order per kelas: `processWrPendingOrders` hanya memproses link
  `restock`; MBO/NULL tetap pending (antre manual). Jangan bypass gate tanpa
  persetujuan owner — MBO = antrean manusia di sisi WR (slow).
- `email_invite` (uji live 2026-09-16): produk WR tipe Invite/Link WAJIB
  kirim `email_invite` — `processOneLink` meneruskan `customer_email` order
  Axvara. Tanpa email, WR 422 "Email Invite is required" dan retry tidak
  sembuh (saldo aman, tidak terpotong). Checkout produk Invite/Link wajib
  meminta email pembeli.
- Email wajib SEBELUM bayar (migrasi 0033, 2026-09-16): `products.require_email`
  (toggle admin, untuk non-WR) + `telegram_users.buyer_email` (sekali isi,
  dipakai ulang). Aturan: varian WR Invite/Link OTOMATIS butuh (dari
  `wr_type`, tanpa setting) ATAU produk `require_email=1`. Quote menghitung
  `emailRequired` (1 query IN, tetap hemat); form web validasi + label
  dinamis; `POST /api/orders` 422 guard hitung-ulang DB (jangan percaya
  flag client); Telegram minta via `pending_action=email_for:/emailcart:`
  lalu lanjut invoice otomatis + `customerEmail` diteruskan ke WR;
  WA grup (tanpa form) menolak jelas + arahkan web/Telegram. Jangan ubah
  menjadi opsional-sesudah-bayar: order lunas tanpa email = macet WR.
- Matriks sandbox (2026-09-16, `WARUNG_REBAHAN_SANDBOX=true` → `client.ts`
  tambah `is_test` ke payload `/order`; saldo tidak terpotong, respons
  valid): 3 restock (Prime Video Private, I Love PDF Sharing, Canva Edu
  Link) → `processing` TEST-ORD-*; 3 MBO (Picsart, Express VPN, Zoom 14D)
  → gate menolak (link pending, nol API call); Remini Link tanpa email →
  pending; quote apple-music `emailRequired:true`. Sandbox WAJIB dimatikan
  lagi setelah tes (flag global — order pembeli asli ikut jadi test bila
  lupa). TEST-ORD-* fiktif (WR tak mencatat order test): bukti = validasi
  lolos, bukan delivery. Cara: secret ON → push kosong (deploy) → order
  test via D1 + PATCH lunas → cek link → secret OFF → push kosong → hapus
  order/link/job/item test.

---

## Kontrak navigasi panel admin (2026-09-19)

Panel admin adalah satu route (`src/app/admin/page.tsx`) yang berpindah section
lewat query `?section=<AdminSection>`. Sebagian kartu Ringkasan juga membawa
**parameter filter**; supaya kartu tidak menjadi tombol hias, setiap parameter
WAJIB punya pembaca di section tujuan.

| Pemicu | URL | Dibaca oleh |
|---|---|---|
| Kartu "Pesanan pending" | `?section=orders&status=pending` | `OrdersManager.tsx` (`initial.get("status")`) |
| Kartu "Bukti manual" | `?section=orders&proof=submitted&method=manual` | `OrdersManager.tsx` (`proof`, `method`) |
| Kartu "QRIS perlu dicek" | `?section=payments&payment_tab=qris&event_status=attention` | `PaymentMethodsManager.tsx` + `PaymentReconciliation.tsx` |
| Kartu "Stok menipis" | `?section=products&low_stock=1` | `page.tsx` → `useProductManager.onlyLowStock` |
| Kartu "Fulfillment" | `?section=bot` | belum ada filter (lihat `issue/audit-admin-panel-2026-09-19.md` A5) |

Section `agent` dan `subscribers` (2026-09-20) tidak lagi punya entri sidebar —
keduanya tab di dalam `settings` (`src/components/admin/SystemTabs.tsx`).
Nilainya TETAP sah di `ADMIN_SECTIONS` supaya tautan lama membuka tab yang
benar, dan `AdminShell` menyimpan judul fallback untuk header mobile.

`GET /api/admin/orders` (2026-09-20): blok `stats` memakai `where` + `bindings`
yang sama dengan daftar, sedangkan `counts.channels` sengaja TETAP global
karena menjadi sumber angka tab kanal (pemilih). Mengubah `counts` menjadi
ikut filter akan membuat tab kanal menampilkan 0 dan tidak bisa dipakai
kembali.

Aturan turunan:
1. `navigateAdmin()` memakai `pushState`, yang **tidak** memicu `popstate`.
   Karena itu filter lintas-section harus diterapkan langsung di
   `navigateAdmin` DAN disinkronkan ulang di listener `popstate` (tombol
   back/forward browser), bukan salah satu saja.
2. Setiap filter yang aktif wajib terlihat sebagai chip yang bisa dilepas.
   Filter tanpa kontrol di layar (dulu: `proof`) menyaring daftar secara
   diam-diam sehingga pesanan tampak hilang.
3. Satuan metrik harus sama antar-layar. "Stok menipis" = **varian aktif
   berstok 0–5** di Ringkasan (`/api/admin/overview`) maupun Produk
   (`lowStockVariants` dari `/api/products`).
