# ARCHITECTURE.md — AXVARA

**Stack:** Next.js 15 (App Router) + Cloudflare Pages + D1 + R2
**Tanggal:** 31 Agustus 2026  
**Status:** MVP Spec — Pre-Build  

---

## 1. Ringkasan Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Edge (CDN)                  │
│         axvara.id  →  Pages  →  300+ PoP Indonesia      │
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
│ • users/admin│       │              │
└──────────────┘       └──────────────┘
       │
       ▼
┌──────────────────┐
│ WA Gateway (P1)  │
│ Fonnte / Wablas  │
│ atau wa.me link  │
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
| Auth Admin | NextAuth / iron-session + bcrypt | Simple, tanpa provider |
| Deploy | Cloudflare Pages (via Git) | Auto deploy, preview URL |
| Domain | Cloudflare Registrar | Murah, auto SSL, integrasi Pages |
| Ikon | Aset SVG/PNG lokal + Lucide React | Menghindari request ikon pihak ketiga saat runtime |
| Font | Apple SF Pro system stack | Konsisten dengan desain storefront |
| Validasi | Zod | Schema checkout & produk |
| Notifikasi WA | Fonnte API (P1) | Kirim WA otomatis saat lunas |

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
│   ├── qris/
│   │   └── axvara-qris.png      # QRIS Brotherstore06 hi-res
│   └── logo/
│       └── axvara-wordmark.svg
├── app/                         # Next.js App Router
│   ├── (storefront)/
│   │   ├── page.tsx             # Homepage
│   │   ├── katalog/
│   │   ├── produk/[slug]/
│   │   ├── checkout/
│   │   └── pesanan/[code]/
│   ├── admin/
│   │   ├── page.tsx             # Dashboard
│   │   ├── login/
│   │   ├── products/
│   │   ├── orders/
│   │   └── settings/
│   ├── api/
│   │   ├── products/
│   │   ├── categories/
│   │   ├── orders/              # POST create, GET list, PATCH confirm
│   │   ├── upload/              # POST to R2
│   │   ├── payment-methods/     # GET config nomor & QRIS
│   │   └── auth/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                      # Button, Input, Badge, Modal, Drawer, Toast
│   ├── storefront/              # Navbar, Hero, ProductCard, CartDrawer, CheckoutForm, QrisDisplay
│   └── admin/                   # Sidebar, StatsCard, OrderTable, ProductForm
├── lib/
│   ├── db.ts                    # D1 client (Cloudflare D1 binding)
│   ├── r2.ts                    # R2 client (S3 API)
│   ├── config.ts                # payment methods, site config
│   └── utils.ts                 # formatRupiah, generateOrderCode
├── stores/
│   └── cart.ts                  # Zustand cart store (localStorage)
├── drizzle/                     # atau raw SQL — schema D1
└── wrangler.json                # Cloudflare bindings + Pages output
```

### 3.1 Runtime performa storefront

- `OrbitHero` hanya satu instance untuk desktop/mobile, memutakhirkan DOM lewat refs, memakai 30 fps untuk auto-rotate dan refresh-rate penuh saat drag/inertia, menghormati reduced motion, serta menghentikan rAF ketika hero offscreen/tab tersembunyi.
- `ScrollRope` dan `Spotlight` event-driven; tidak mempertahankan loop idle. ScrollRope tidak memasang listener pada viewport mobile.
- Kartu berulang memakai `ax-glass-card` tanpa `backdrop-filter`; blur penuh dipertahankan untuk navbar, drawer, modal, dan overlay.
- Homepage merender katalog seed terlebih dahulu lalu melakukan refresh D1 melalui `requestIdleCallback` dengan abort cleanup.
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
  proof_url TEXT,                  -- R2 URL bukti transfer
  status TEXT DEFAULT 'pending',   -- pending | lunas | dibatalkan | kadaluarsa
  admin_note TEXT,                 -- lisensi/key yang dikirim
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
  qris_url TEXT,                   -- R2 URL untuk QRIS
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

-- Seed payment_methods:
-- ewallet | DANA / Gopay / Shopeepay | 082135277434 | Brotherstore06
-- seabank | SeaBank                  | 901812349386 | Brotherstore06
-- qris    | QRIS                     | -            | Brotherstore06 | qris_url → R2/public/qris/...
```

---

## 5. API Contract (MVP)

| Method | Path | Deskripsi | Auth |
|--------|------|-----------|------|
| GET | /api/products | List produk (filter category, search, active) | - |
| GET | /api/products/:slug | Detail produk | - |
| GET | /api/categories | List kategori | - |
| GET | /api/payment-methods | List metode aktif (untuk checkout) | - |
| POST | /api/orders | Buat pesanan (body: customer, items, payment_method, proof file) | - |
| GET | /api/orders/:code | Cek status pesanan via code | - |
| POST | /api/upload/proof | Upload bukti ke R2, return URL | - |
| POST | /api/auth/login | Admin login, set cookie | - |
| GET | /api/admin/orders | List pesanan (filter status) | admin |
| PATCH | /api/admin/orders/:id | Update status (lunas/batal) + admin_note | admin |
| POST | /api/admin/products | Create produk + upload image ke R2 | admin |
| PUT | /api/admin/products/:id | Update produk | admin |
| DELETE | /api/admin/products/:id | Soft delete | admin |
| POST | /api/admin/payment-methods | Update nomor/QRIS | admin |

**Validasi POST /api/orders:**
```ts
{
  customer_name: string (min 3),
  customer_wa: string (regex 08..., 10-15 digit),
  customer_email?: string (email),
  items: { product_id: number, qty: number }[] (min 1),
  payment_method: "ewallet" | "seabank" | "qris" | string,
  proof_url: string (R2 URL, valid image) // wajib MVP
}
```

---

## 6. Flow Teknis Checkout

```
[Client] Keranjang (Zustand + localStorage)
   ↓ klik Checkout
[Client] CheckoutForm → POST /api/upload/proof (bukti → R2, dapat URL)
   ↓
[Client] POST /api/orders { customer, items, payment_method, proof_url }
   ↓
[Server] Validasi Zod → hitung subtotal dari DB (jangan percaya client) → generate code AXV-... → INSERT D1
   ↓
[Server] Response 201 { code, status: "pending" }
   ↓
[Client] Redirect → /pesanan/AXV-20260831-0012 (halaman sukses)
   ↓ (P1) webhook → Fonnte → WA ke admin + pembeli
```

**Anti-tamper:** Harga selalu diambil dari DB, bukan dari body request. Qty di-clamp max.

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
└── qris/
    └── axvara-qris.png   (master, hi-res)
```

- Upload via Pages Function dengan `AWS SDK S3` ke R2 binding
- Nama file: `{order_code}-{random6}.{ext}` untuk bukti
- Content-Type di-set, public read untuk produk/qris, private untuk bukti (akses via signed URL atau admin-only route)

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

### Langkah Deploy

1. `npx wrangler d1 create axvara-db`
2. `npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql`
3. `npx wrangler r2 bucket create axvara-assets`
4. Push ke GitHub untuk CI/CD atau jalankan `npm run deploy` setelah memuat `.cf-credentials`
5. Custom domain: Pages → Custom domains → add `axvara.id` (auto SSL)
6. Env vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `FONNTE_TOKEN` (P1) di Pages Settings → Variables

### Build Adapter

- Opsi A: `@cloudflare/next-on-pages` (Next.js di Pages Functions)
- Opsi B: Next.js static export + Pages Functions terpisah untuk API
- Rekomendasi MVP: Opsi A untuk DX paling simpel

---

## 9. Keamanan MVP

- Admin auth: httpOnly cookie + iron-session, bcrypt, rate limit 5/min
- Upload: cek magic bytes (bukan cuma ext), max 5MB, sanitize filename
- D1: prepared statement, no string concat
- Checkout rate limit: 10/menit/IP via Cloudflare WAF / KV
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
| Domain axvara.id | ~Rp 230rb/tahun | Rp 230rb/tahun |
| **Total infra** | | **Rp 0/bulan** |

Jika melebihi free tier (misal 100k order/bulan): D1 $5/bulan, R2 $0.015/GB — masih sangat murah.
