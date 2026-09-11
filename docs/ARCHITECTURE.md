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
│   │   ├── checkout/       # Checkout — QRIS otomatis / bukti untuk transfer manual
│   ├── pesanan/[code]/
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
│   └── cart.ts                  # Zustand cart store (localStorage)
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
| GET | /api/products | List produk (filter category, search, active) | - |
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
| GET | /api/orders/:code | Cek status pesanan via code | - |
| GET | /api/payments/qris/:code/image | Render PNG QRIS dinamis untuk invoice aktif | code order |
| POST | /api/payments/qris/:code/reissue | Terbitkan QRIS baru untuk order yang masih hidup tetapi QR-nya sudah kedaluwarsa. Hanya boleh saat invoice lama SUDAH mati — syarat itulah yang mencegah pemegang kode order lain membatalkan QR yang sedang dipakai. Maks 3x/order, rate limit 5/menit/IP | code order |
| POST | /api/webhook/dana | Terima notifikasi QRIS Hook, dedup, cocokkan nominal, lunasi order | X-Webhook-Secret |
| POST | /api/proof/upload | Upload bukti ke R2, return URL privat | same-origin |
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

**Validasi POST /api/orders:**
```ts
{
  customer_name: string (min 3),
  customer_wa: string (regex 08..., 10-15 digit),
  customer_email?: string (email),
  items: { product_id: number, qty: number }[] (min 1),
  payment_method: "ewallet" | "seabank" | "qris" | string,
  proof_url?: string | null // null hanya untuk QRIS; wajib dan private-R2 untuk rail manual
  quote_token: string // signed HS256, snapshot item/subtotal/payment account
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
[Client] Konfirmasi perubahan harga → pilih QRIS atau rekening manual
   ↓ POST /api/orders { customer, item IDs/qty, payment_method, proof_url, quote_token }
[Server] Verifikasi signature+expiry+isi item → D1 batch guard+decrement+INSERT order
   ├─ QRIS: alokasikan kode unik 1–299 → EMVCo dynamic payload + ledger 15 menit
   │    ↓ /pesanan/[code] menampilkan PNG dan polling 5 detik
   │    ↓ QRIS Hook → POST /api/webhook/dana → exact amount + event dedup → lunas atomik
   └─ Manual: bukti R2 → review admin
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
- **D1 sebagai Source of Truth:** `products` menyimpan produk induk (`name`, `whatsapp_alias`, search `aliases`, description, image, badge), sedangkan `product_variants` menyimpan SKU yang dapat dibeli (label, duration, warranty, price, stock, fulfillment_mode, sort_order). `whatsapp_alias` hanya mengatur nama presentasi di daftar/header WhatsApp dan fallback ke `name` bila kosong; `aliases` tetap khusus kata kunci pencarian bot.
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

### Status Rollout Produksi WhatsApp

Mulai 5 September 2026, Baileys gateway produksi berjalan di Heroku dan seluruh fitur transaksi WhatsApp aktif untuk GID pada `WHATSAPP_GROUP_ALLOWLIST`. Flag aktif meliputi `PRODUCT_VARIANTS_READ`, `WHATSAPP_ENABLED`, `WHATSAPP_GROUP_DISCOVERY`, `WHATSAPP_GROUP_PAYMENT`, `WHATSAPP_PROOF_INTAKE`, `WHATSAPP_REQUIRE_PROOF_BEFORE_FULFILLMENT`, dan `WHATSAPP_FULFILLMENT`. Mode fulfillment varian unique tanpa stok dialihkan aman ke manual agar tidak terjadi silent drop. Outbound `/send` dan `/send-image` wajib memakai shared gateway token; pesan inbound di-cache terbatas selama 20 menit agar balasan dapat memakai quoted message Baileys.

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
  classification), `sync.ts` (upsert produk/varian + exclusion + markup + agregat induk),
  `order.ts` (link pending + proses + retry backoff + reconcile stuck), `deliver.ts`
  (enkripsi akun AES-256-GCM + delivery Telegram/WhatsApp/Web), `saldo.ts` (check + alert + estimasi).
- **Routes:** `POST /api/webhook/warung` (HMAC, rate-limit, selalu 200 pasca-verifikasi);
  admin `GET /api/admin/warung/saldo`, `POST /api/admin/warung/sync` (rate-limit products:write),
  `GET /api/admin/warung/sync-log`, `GET /api/admin/warung/orders` (ciphertext disamarkan),
  `POST /api/admin/warung/orders/[id]/retry`, `GET/POST/DELETE /api/admin/warung/exclusions`,
  `GET/PUT /api/admin/warung/markup`.
- **Admin UI:** tab "Warung Rebahan" (`WarungRebahanManager.tsx`, section `warung` di
  `AdminShell` + `admin/page.tsx`): saldo + estimasi, sync terakhir + force sync, antrean
  order + retry, exclusions, markup per varian. Health WR ikut `GET /api/admin/bot/health`.
- **Cron:** fase baru `warung_rebahan` disisipkan `fulfillment → warung_rebahan → notify`
  (`src/app/api/cron/operations/route.ts`): sync produk tiap 30 mnt, proses order due (maks 4),
  reconcile processing >1 jam via `/transactions`, cek saldo tiap 1 jam. COUNT WR dihitung
  query terpisah agar DB pre-migrasi tidak meruntuhkan query gabungan; fase no-op bila
  master switch mati atau tabel WR belum ada.
- **Hook payment:** setelah lunas di 4 jalur (webhook DANA, retry admin, approve bukti,
  konfirmasi admin) → `createWrOrderLinksForOrder` + `processWrPendingOrders` best-effort;
  cron memproses sisanya. Produk WR dikenali dari `product_variants.wr_variant_id`.

### Skema (migrasi 0027)

`wr_products` (registry + link `axvara_product_id` + flag excluded), `wr_variants`
(registry + `markup_percent/fixed` + `axvara_sell_price` + link varian), `wr_order_links`
(order Axvara ↔ order WR, status pending/ordering/processing/completed/failed/retry,
attempt 3x backoff 1/5/15 mnt, saldo-habis tunda 1 jam, akun terenkripsi),
`wr_sync_log`, `wr_saldo_log`, `wr_exclusions` (seed `%canva%`, `%gemini%`).
Kolom baru: `products(source, wr_product_id, wr_auto_managed)`,
`product_variants(wr_variant_id, wr_auto_managed)`. Produk WR pakai
`fulfillment_mode='manual'`; delivery via pipeline `wr_order_links`, bukan
`fulfillment_inventory` lokal. Varian hilang dari API di-nol-kan stoknya (tidak dihapus).

### Proteksi

- `WARUNG_REBAHAN_ENABLED=false` mematikan segalanya (sync/order/webhook/cron no-op).
- API key server-only, outbound hanya ke `warungrebahan.com` (assert host), timeout 30 dtk.
- Webhook HMAC-SHA256 (`X-Rebahan-Signature`, secret = API key), 401 bila salah.
- Detail akun dienkripsi sebelum disimpan; decrypt hanya server-side saat delivery.
- Markup default 50% + pembulatan 500; Canva/Gemini excluded (margin lokal lebih tinggi).
- Saldo habis → tunda 1 jam + notif admin (bukan retry cepat); gagal 3x → failed + admin
  putuskan manual (tanpa auto-refund). Order failed WR → `fulfillment_status='failed'`,
  status uang `lunas` tidak diubah otomatis.
