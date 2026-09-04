# ARCHITECTURE.md — AXVARA

**Stack:** Next.js 15 (App Router) + Cloudflare Pages + D1 + R2
**Tanggal:** 3 September 2026
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
| Auth Admin | JWT httpOnly + PBKDF2/SHA-256 Edge-safe | Simple, tanpa provider |
| Deploy | Cloudflare Pages (via Git) | Auto deploy, preview URL |
| Domain | .TECH Domains registrar + Cloudflare DNS | Nameserver Cloudflare, auto SSL, integrasi Pages |
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
├── src/app/                     # Next.js App Router
│   ├── page.tsx                 # Homepage
│   ├── artikel/[slug]/          # Artikel publik Markdown/legacy JSON
│   ├── cara-order/               # Panduan order
│   ├── garansi-replace/          # Ketentuan layanan & garansi third-party (acuan klaim, garansi ikut deskripsi produk)
│   ├── produk/[slug]/
│   ├── checkout/
│   ├── pesanan/[code]/
│   ├── admin/
│   │   └── page.tsx             # Sidebar + seluruh modul admin
│   ├── api/
│   │   ├── products/
│   │   ├── categories/
│   │   ├── orders/              # POST create, GET list, PATCH confirm
│   │   ├── checkout/quote/       # Quote harga/stok/payment bertanda tangan
│   │   ├── payment-methods/      # GET publik + PUT admin
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
│   └── admin/                   # Sidebar, StatsCard, OrderTable, ProductForm
├── src/lib/
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
  proof_url TEXT,                  -- R2 URL bukti transfer
  status TEXT DEFAULT 'pending',   -- pending | lunas | dibatalkan | kadaluarsa
  admin_note TEXT,                 -- lisensi/key yang dikirim
  quote_id TEXT,                   -- jti quote signed; unique untuk idempotensi
  expires_at TEXT,                 -- pending berakhir 24 jam setelah dibuat
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
  qris_url TEXT,                   -- R2 URL untuk QRIS
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
| POST/PUT/DELETE | /api/categories[?id=] | Kelola kategori | admin |
| POST | /api/subscribers | Simpan email unik dari form footer | - |
| GET | /api/subscribers | List pelanggan email | admin |
| GET/POST/PUT/DELETE | /api/articles[?id=] | Publikasi dan CRUD editorial | public/admin |
| GET/POST/PUT/DELETE | /api/banners[?id=] | Popup banner | public/admin |
| POST | /api/checkout/quote | Validasi produk/stok/harga, metode aktif, dan terbitkan signed quote 60 menit | - |
| GET/POST/PUT | /api/payment-methods[?id=] | Baca metode aktif / tambah bank / kelola rekening dan QRIS | public/admin |
| POST | /api/orders | Verifikasi signed quote, buat pesanan idempotent, reservasi stok atomik | - |
| GET | /api/orders/:code | Cek status pesanan via code | - |
| POST | /api/proof/upload | Upload bukti ke R2, return URL privat | same-origin |
| GET | /api/admin/bukti/:key | Preview/download bukti | admin |
| POST | /api/upload | Upload WebP produk/artikel/banner ke R2 | admin |
| * | /api/agent/* | Context, artikel, media, dan audit | agent scope |
| POST | /api/cron/publish-scheduled | Publish artikel dan kedaluwarsakan order jatuh tempo | cron secret |
| POST | /api/auth/login | Admin login, set cookie | - |
| GET | /api/admin/orders | List pesanan (filter status) | admin |
| PATCH | /api/admin/orders/:id | Update status (lunas/batal) + admin_note | admin |
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
  proof_url: string (R2 URL, valid image) // wajib MVP
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

---

## 6. Flow Teknis Checkout

```
[Client] Keranjang (Zustand + localStorage) / Beli Langsung (produk D1 aktif)
   ↓ POST /api/checkout/quote { slug/id, qty, expected_price }
[Server] Validasi produk aktif, stok, harga, dan payment_methods D1
   ↓ response quote HS256 60 menit + snapshot authoritative
[Client] Konfirmasi perubahan harga → pilih rekening snapshot → upload bukti privat ke R2
   ↓ POST /api/orders { customer, item IDs/qty, payment_method, proof_url, quote_token }
[Server] Verifikasi signature+expiry+isi item → D1 batch guard+decrement+INSERT order
   ↓ response 201, atau order yang sama jika quote dikirim ulang
[Client] Redirect → /pesanan/AXV-20260831-0012 (halaman sukses)
   ↓ cron: pending >24 jam → status kadaluarsa + restore stok dalam satu batch
```

**Anti-tamper:** Harga, rekening, subtotal, dan item order terikat ke quote server; body client tidak dapat mengganti snapshot. Quote id unik membuat retry idempotent. Reservasi/restore stok memakai batch D1 dengan guard CHECK agar kegagalan rollback seluruh operasi; stok `-1` tetap unlimited.

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
├── banners/*.webp
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

### Jalur CI/CD

1. `npx wrangler d1 create axvara-db`
2. Database baru: `npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote`; database lama jalankan migrasi `0002`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`
3. `npx wrangler r2 bucket create axvara-assets`
4. Push ke `main`; `.github/workflows/ci.yml` menjalankan test → type-check → build Pages → `wrangler d1 migrations apply` → deploy Pages → deploy MCP Worker
5. GitHub Actions menggunakan Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`; Git integration bawaan Pages tidak menjalankan deployment agar CI/CD tidak ganda
6. Setelah push berhasil, agent berhenti tanpa polling workflow. `npm run deploy`/`deploy:mcp` hanya jalur recovery manual atas instruksi eksplisit
7. Custom domain `axvara.tech` dan `www.axvara.tech` aktif melalui CNAME proxied; `www` memiliki redirect 308 ke apex. DNSSEC Cloudflare aktif dan memerlukan publikasi DS di registrar
8. Secrets Pages: `ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256`, `ADMIN_JWT_SECRET`, `CRON_SECRET`; `FONNTE_TOKEN` tetap P1

### Build Adapter

- Opsi A: `@cloudflare/next-on-pages` (Next.js di Pages Functions)
- Opsi B: Next.js static export + Pages Functions terpisah untuk API
- Rekomendasi MVP: Opsi A untuk DX paling simpel

---

## 9. Keamanan MVP

- Admin auth: JWT httpOnly, password digest Edge-safe, rate limit 5/min
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

## 13. Bot Telegram + KlikQRIS Payment + Fulfillment

Implementasi native TypeScript di codebase AXVARA. Repo `mocasus/telegram-auto-order-bot` hanya referensi UX; tidak ada dependency, subtree, atau source copy.

### Arsitektur

- **Bot:** Webhook di `POST /api/telegram/webhook`, bukan long polling. Wrapper `fetch` kecil atas Telegram Bot API tanpa framework.
- **Payment:** KlikQRIS adapter terisolasi di `src/lib/payments/klikqris.ts`. Dua mode: `sandbox` dan `mypg` (MY PG). Callback di `POST /api/payments/klikqris/callback` dengan validasi signature + amount + server-side status confirmation.
- **Fulfillment:** AES-256-GCM via WebCrypto, fingerprint SHA-256 untuk deduplikasi. Tiga mode: `manual`, `shared`, `unique`. Outbox pattern dengan `fulfillment_jobs` tabel.
- **Rekonsiliasi:** `POST /api/cron/operations` menangani stale initializing, expired invoices, missed callback recovery, due jobs, dan stale locks. Dipanggil cron MCP Worker tiap 5 menit.

### Tabel Baru (migrasi 0005)

| Tabel | Tujuan |
|---|---|
| `telegram_users` | Profil user Telegram minimal |
| `telegram_updates` | Idempotency + lease untuk webhook |
| `payment_transactions` | Ledger KlikQRIS (status, signature, QRIS URL, expiry) |
| `fulfillment_inventory` | Vault secret terenkripsi per produk |
| `fulfillment_jobs` | Outbox delivery dengan retry |

Kolom baru di `products`: `fulfillment_mode`, `shared_secret_ciphertext`, `shared_secret_iv`, `telegram_enabled`.
Kolom baru di `orders`: `sales_channel`, `telegram_chat_id`, `telegram_user_id`, `payment_status`, `fulfillment_status`.

### Route Baru

| Method | Path | Auth | Tujuan |
|---|---|---|---|
| POST | `/api/telegram/webhook` | Telegram secret header | Webhook bot |
| POST | `/api/payments/klikqris/callback` | — | Callback pembayaran |
| POST | `/api/cron/operations` | CRON_SECRET | Rekonsiliasi |
| GET/POST | `/api/admin/telegram/setup` | admin | Setup webhook |
| GET | `/api/admin/bot/health` | admin | Health check tanpa secret |
| GET/POST/DELETE | `/api/admin/fulfillment` | admin | Inventory management |

### Environment Baru

Semua nilai nyata di Cloudflare Pages Secrets:

```
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ADMIN_CHAT_ID
KLIKQRIS_MODE, KLIKQRIS_API_KEY, KLIKQRIS_MERCHANT_ID
FULFILLMENT_ENCRYPTION_KEY
TELEGRAM_BOT_ENABLED, KLIKQRIS_PAYMENTS_ENABLED, AUTO_FULFILLMENT_ENABLED
```

### Feature Flags

Rollout bertahap: `TELEGRAM_BOT_ENABLED=false`, `KLIKQRIS_PAYMENTS_ENABLED=false`, `AUTO_FULFILLMENT_ENABLED=false`. Semua default off.
