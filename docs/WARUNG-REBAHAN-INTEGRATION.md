# Warung Rebahan H2H API Integration — Planning Document

> **Status:** Planning  
> **Author:** Axvara Engineering  
> **Tanggal:** 2026-09-11  
> **Codebase:** `/Users/macbookair/axvara` (Next.js 15 + Cloudflare D1/R2/Pages, Edge Runtime)

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Arsitektur Integrasi](#2-arsitektur-integrasi)
3. [Database Migration](#3-database-migration)
4. [Environment Variables](#4-environment-variables)
5. [Module: Warung Rebahan API Client](#5-module-warung-rebahan-api-client)
6. [Module: Product Sync Engine](#6-module-product-sync-engine)
7. [Module: Auto-Order (H2H Fulfillment)](#7-module-auto-order-h2h-fulfillment)
8. [Module: Webhook Receiver](#8-module-webhook-receiver)
9. [Module: Saldo Monitor](#9-module-saldo-monitor)
10. [Cron Job Extension](#10-cron-job-extension)
11. [Admin Panel Extension](#11-admin-panel-extension)
12. [Storefront Impact](#12-storefront-impact)
13. [Produk: Exclusion Rules](#13-produk-exclusion-rules)
14. [Alur Order End-to-End](#14-alur-order-end-to-end)
15. [Pricing & Markup Strategy](#15-pricing--markup-strategy)
16. [Error Handling & Edge Cases](#16-error-handling--edge-cases)
17. [Testing Strategy](#17-testing-strategy)
18. [Security Considerations](#18-security-considerations)
19. [Fase Implementasi](#19-fase-implementasi)
20. [Estimasi File yang Dibuat/Diubah](#20-estimasi-file-yang-dibuatdiubah)

---

## 1. Ringkasan Eksekutif

### Tujuan

Mengintegrasikan **Warung Rebahan H2H API** (`https://warungrebahan.com/api/v1`) ke Axvara sehingga:

1. **Semua produk** dari Warung Rebahan otomatis tersinkronisasi ke katalog Axvara (kecuali Canva dan Gemini)
2. **Stok dan harga** diperbarui secara realtime via cron sync
3. **Order otomatis** diteruskan ke Warung Rebahan saat customer membayar di Axvara
4. **Delivery otomatis** — detail akun dari Warung Rebahan dikirim ke customer melalui channel yang sama (web/Telegram/WhatsApp)
5. Produk yang stok habis **tetap ditampilkan** dengan badge "Stok Habis" (tidak dihapus)

### Konsep Utama

Axvara menjadi **reseller layer** di atas Warung Rebahan:

```
Customer ──bayar QRIS Axvara──▶ Axvara ──API order──▶ Warung Rebahan
                                   │                        │
                                   │◀── webhook completed ──│
                                   │
                                   ▼
                            Kirim detail akun ke customer
                            (Web / Telegram / WhatsApp)
```

- **Payment:** Customer bayar via DANA QRIS Axvara (sistem yang sudah ada)
- **Saldo:** Axvara deposit saldo ke Warung Rebahan secara manual/berkala
- **Fulfillment:** Otomatis via API — bukan dari `fulfillment_inventory` lokal

---

## 2. Arsitektur Integrasi

### Diagram Komponen

```
┌─────────────────────────────────────────────────────────────────┐
│                         AXVARA SYSTEM                           │
│                                                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ Cron Worker  │  │  Admin Panel  │  │   Storefront/Bot     │  │
│  │ (5 min)      │  │  (New Tab)    │  │   (Web/TG/WA)        │  │
│  └──────┬───────┘  └───────┬───────┘  └──────────┬───────────┘  │
│         │                  │                     │              │
│         ▼                  ▼                     ▼              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              src/lib/warung-rebahan/                      │   │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │   │
│  │  │ client  │ │ sync     │ │ order    │ │ saldo       │  │   │
│  │  │ .ts     │ │ .ts      │ │ .ts      │ │ .ts         │  │   │
│  │  └────┬────┘ └────┬─────┘ └────┬─────┘ └──────┬──────┘  │   │
│  └───────┼───────────┼────────────┼───────────────┼─────────┘   │
│          │           │            │               │             │
│          ▼           ▼            ▼               ▼             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 Cloudflare D1 Database                   │    │
│  │  ┌──────────────────┐  ┌─────────────────────────────┐  │    │
│  │  │ wr_products      │  │ wr_order_links              │  │    │
│  │  │ wr_variants      │  │ wr_sync_log                 │  │    │
│  │  │ wr_saldo_log     │  │ wr_exclusions               │  │    │
│  │  └──────────────────┘  └─────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                    fetch() POST JSON
                              │
                              ▼
                 ┌────────────────────────┐
                 │  Warung Rebahan API    │
                 │  /api/v1/balance       │
                 │  /api/v1/products      │
                 │  /api/v1/order         │
                 │  /api/v1/transactions  │
                 │  Webhook POST ──────── │──▶ /api/webhook/warung
                 └────────────────────────┘
```

### Prinsip Desain

| Prinsip | Implementasi |
|---------|-------------|
| **Edge-compatible** | Semua kode harus jalan di Cloudflare Workers/Pages Edge Runtime. Tidak boleh pakai Node.js-only API (`fs`, `crypto` module, dll). Gunakan `fetch()` dan Web Crypto API. |
| **Budget-aware** | Sync menggunakan `DatabaseAccess` pattern yang sudah ada. Query count terbatas per cron run. |
| **Idempotent** | Sync dan order harus safe untuk dijalankan berulang. Produk di-upsert by `wr_product_id`. Order dicegah duplikat by `order_code` unique constraint. |
| **Graceful degradation** | Jika API Warung Rebahan down, Axvara tetap jalan. Produk WR tetap tampil dengan data terakhir. Order pending di-retry di cron berikutnya. |
| **Feature-flagged** | Seluruh integrasi dikendalikan oleh `WARUNG_REBAHAN_ENABLED=true`. Jika false, semua fitur WR tidak aktif. |

---

## 3. Database Migration

### File: `drizzle/migrations/0027_warung_rebahan.sql`

```sql
-- ============================================================
-- Migration 0027: Warung Rebahan H2H Integration
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Warung Rebahan Product Registry
--    Mirror produk dari WR API. Ini BUKAN tabel products utama.
--    Tabel ini menyimpan data mentah dari WR untuk mapping.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_product_id   TEXT NOT NULL UNIQUE,          -- UUID produk dari WR API
  wr_product_name TEXT NOT NULL,                  -- Nama asli dari WR
  wr_category     TEXT,                           -- Kategori dari WR (e.g. "Productivity")
  wr_description  TEXT,                           -- Deskripsi dari WR
  axvara_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,  -- Link ke products Axvara
  is_excluded     INTEGER NOT NULL DEFAULT 0,     -- 1 = dikecualikan (Canva, Gemini)
  exclude_reason  TEXT,                           -- Alasan exclusion
  last_synced_at  TEXT,                           -- Timestamp sync terakhir
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 2. Warung Rebahan Variant Registry
--    Mirror varian dari WR API untuk mapping ke product_variants.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_variants (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  wr_variant_id         TEXT NOT NULL UNIQUE,          -- UUID varian dari WR API
  wr_product_id         TEXT NOT NULL REFERENCES wr_products(wr_product_id),
  wr_variant_name       TEXT NOT NULL,                  -- Nama varian dari WR (e.g. "Pro")
  wr_price              INTEGER NOT NULL,               -- Harga asli WR dalam IDR
  wr_duration           TEXT,                           -- Durasi dari WR (e.g. "7 Hari")
  wr_type               TEXT,                           -- Tipe dari WR (e.g. "Private", "Sharing")
  wr_warranty           TEXT,                           -- Durasi garansi dari WR (e.g. "7 Hari")
  wr_stock              INTEGER NOT NULL DEFAULT 0,     -- Stok terakhir dari WR
  wr_terms              TEXT,                           -- S&K checkout dari WR
  wr_delivery_terms     TEXT,                           -- S&K pengiriman dari WR
  axvara_variant_id     INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  markup_percent        INTEGER NOT NULL DEFAULT 50,    -- Markup % (default 50%)
  markup_fixed          INTEGER NOT NULL DEFAULT 0,     -- Markup IDR tetap (opsional, ditambah setelah %)
  axvara_sell_price     INTEGER NOT NULL DEFAULT 0,     -- Harga jual Axvara (computed: wr_price * (1 + markup/100) + markup_fixed)
  is_active             INTEGER NOT NULL DEFAULT 1,     -- Aktif di Axvara?
  last_synced_at        TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 3. Warung Rebahan Order Links
--    Menghubungkan order Axvara dengan order Warung Rebahan.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_order_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code      TEXT NOT NULL REFERENCES orders(code),  -- Order code Axvara (AXV-...)
  wr_order_id     TEXT,                                    -- Order ID dari WR (ORD-...)
  wr_variant_id   TEXT NOT NULL,                           -- Varian WR yang di-order
  quantity        INTEGER NOT NULL DEFAULT 1,
  wr_cost         INTEGER NOT NULL,                        -- Harga beli ke WR (saldo terpotong)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN (
                    'pending',        -- Belum di-order ke WR
                    'ordering',       -- Sedang request ke WR API
                    'processing',     -- WR sedang proses (order.processing)
                    'completed',      -- WR selesai (order.completed)
                    'failed',         -- WR gagal (order.failed)
                    'retry'           -- Perlu retry
                  )),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,                                    -- Untuk retry scheduling
  last_error      TEXT,                                    -- Error terakhir dari WR
  wr_account_details TEXT,                                 -- JSON detail akun dari WR (encrypted)
  wr_account_iv   TEXT,                                    -- IV untuk enkripsi detail akun
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_wr_order_links_order_code ON wr_order_links(order_code);
CREATE INDEX idx_wr_order_links_status ON wr_order_links(status);
CREATE INDEX idx_wr_order_links_retry ON wr_order_links(status, next_attempt_at)
  WHERE status IN ('pending', 'retry');

-- ────────────────────────────────────────────────────────────
-- 4. Warung Rebahan Sync Log
--    Audit trail setiap kali sync dijalankan.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_sync_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_type         TEXT NOT NULL CHECK (sync_type IN ('products', 'saldo', 'order_status')),
  status            TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  products_total    INTEGER,       -- Total produk dari WR
  products_synced   INTEGER,       -- Produk berhasil disync
  products_excluded INTEGER,       -- Produk di-exclude
  products_new      INTEGER,       -- Produk baru ditemukan
  variants_synced   INTEGER,       -- Varian berhasil disync
  stock_changes     INTEGER,       -- Jumlah perubahan stok
  price_changes     INTEGER,       -- Jumlah perubahan harga
  saldo_amount      INTEGER,       -- Saldo WR saat ini (untuk sync saldo)
  error_message     TEXT,
  duration_ms       INTEGER,       -- Durasi sync dalam ms
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 5. Warung Rebahan Saldo Log
--    Track saldo WR untuk monitoring & alert.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_saldo_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  balance     INTEGER NOT NULL,       -- Saldo WR dalam IDR
  source      TEXT NOT NULL DEFAULT 'api_check'
              CHECK (source IN ('api_check', 'order_deduct', 'manual_topup')),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ────────────────────────────────────────────────────────────
-- 6. Warung Rebahan Exclusion Rules
--    Daftar nama produk yang harus di-exclude dari sync.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wr_exclusions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern   TEXT NOT NULL UNIQUE,   -- Pattern match (case-insensitive LIKE)
  reason    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed default exclusions
INSERT OR IGNORE INTO wr_exclusions (pattern, reason) VALUES
  ('%canva%', 'Axvara sudah punya Canva Edu sendiri — margin lebih tinggi'),
  ('%gemini%', 'Gemini dijual terpisah dengan metode sendiri');

-- ────────────────────────────────────────────────────────────
-- 7. Tambahkan kolom source di products utama
--    Untuk membedakan produk manual vs WR-synced.
-- ────────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'warung_rebahan'));

ALTER TABLE products ADD COLUMN wr_product_id TEXT;
ALTER TABLE products ADD COLUMN wr_auto_managed INTEGER NOT NULL DEFAULT 0;

-- Index untuk lookup produk WR
CREATE INDEX IF NOT EXISTS idx_products_source ON products(source) WHERE source = 'warung_rebahan';
CREATE INDEX IF NOT EXISTS idx_products_wr_id ON products(wr_product_id) WHERE wr_product_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 8. Tambahkan kolom source di product_variants utama
-- ────────────────────────────────────────────────────────────
ALTER TABLE product_variants ADD COLUMN wr_variant_id TEXT;
ALTER TABLE product_variants ADD COLUMN wr_auto_managed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_variants_wr_id ON product_variants(wr_variant_id) WHERE wr_variant_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 9. Tambahkan fulfillment_mode baru: 'warung_rebahan'
--    Extend CHECK constraint di products dan product_variants.
-- ────────────────────────────────────────────────────────────
-- NOTE: SQLite tidak support ALTER CHECK constraint.
-- Perlu recreate table atau handle di application layer.
-- Rekomendasi: Handle di application layer saja.
-- Produk WR tetap pakai fulfillment_mode = 'manual',
-- tapi delivery dihandle oleh wr_order_links pipeline.
-- Kita kenali produk WR dari kolom `source = 'warung_rebahan'`.
```

### Catatan Migrasi

- SQLite (D1) tidak mendukung `ALTER TABLE ... ADD CHECK`. Kita **tidak** perlu menambah enum `warung_rebahan` ke `fulfillment_mode`. Cukup gunakan `source = 'warung_rebahan'` pada tabel `products` untuk membedakan.
- Produk WR di tabel `products` tetap pakai `fulfillment_mode = 'manual'` — fulfillment-nya di-handle oleh pipeline `wr_order_links`, bukan oleh `fulfillment_inventory` / `fulfillment_jobs`.

---

## 4. Environment Variables

### Tambahkan ke `.env.example` dan Cloudflare Pages Variables:

```env
# ── Warung Rebahan H2H Integration ──
WARUNG_REBAHAN_ENABLED=false               # Master switch
WARUNG_REBAHAN_API_KEY=                     # API key dari dashboard WR
WARUNG_REBAHAN_WEBHOOK_SECRET=              # Secret untuk validasi webhook signature
WARUNG_REBAHAN_BASE_URL=https://warungrebahan.com/api/v1
WARUNG_REBAHAN_DEFAULT_MARKUP_PERCENT=50    # Default markup % untuk produk baru
WARUNG_REBAHAN_DEFAULT_MARKUP_FIXED=0       # Default markup IDR tetap
WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD=50000  # Alert jika saldo WR di bawah Rp 50.000
WARUNG_REBAHAN_AUTO_ORDER_ENABLED=false     # Auto-order setelah payment confirmed
WARUNG_REBAHAN_SYNC_ENABLED=true            # Sync produk/stok otomatis
WARUNG_REBAHAN_DEFAULT_CATEGORY_ID=2        # Default category_id untuk produk WR baru (Akun Premium)
```

### Catatan

- `WARUNG_REBAHAN_API_KEY` adalah **server-only secret** — jangan pernah expose ke client.
- `WARUNG_REBAHAN_WEBHOOK_SECRET` = API key yang sama (WR pakai API key sebagai HMAC secret untuk webhook signature).
- Semua env var dibaca via `process.env` di Edge Runtime (tersedia di Cloudflare Pages).

---

## 5. Module: Warung Rebahan API Client

### File: `src/lib/warung-rebahan/client.ts`

Responsibility: Low-level HTTP client ke Warung Rebahan API.

```typescript
// ── Types ──

export type WrProduct = {
  id: string;                   // UUID
  name: string;
  category: string;
  description: string;
  variants: WrVariant[];
};

export type WrVariant = {
  id: string;                   // UUID
  name: string;
  price: number;                // IDR
  duration: string;             // e.g. "7 Hari"
  type: string;                 // e.g. "Private", "Sharing"
  warranty: string;             // e.g. "7 Hari"
  stock: number;
  terms: string | null;
  delivery_terms: string | null;
};

export type WrBalance = {
  balance: number;
  currency: string;             // "IDR"
};

export type WrOrderResult = {
  order_id: string;             // e.g. "ORD-20260126-X8Y9Z"
  status: string;               // "processing"
  payment_status: string;       // "paid"
  total_amount: number;
  current_balance: number;
};

export type WrTransaction = {
  order_id: string;
  total_amount: number;
  status: string;
  payment_status: string;
  products: unknown[];
  account_details: unknown[];
  created_at: string;
};

export type WrWebhookEvent = {
  event: 'order.processing' | 'order.completed' | 'order.failed';
  data: {
    order_id: string;
    status: string;
    total_amount: number;
    [key: string]: unknown;
  };
};

export type WrApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

// ── Client Functions ──

export function isWrEnabled(): boolean;
  // return process.env.WARUNG_REBAHAN_ENABLED === 'true'

export function getWrApiKey(): string;
  // throws if not set

export function getWrBaseUrl(): string;
  // default: 'https://warungrebahan.com/api/v1'

export async function wrFetch<T>(
  endpoint: string,
  payload?: Record<string, unknown>
): Promise<WrApiResponse<T>>;
  // POST ke baseUrl + endpoint
  // Body: { api_key, ...payload }
  // Headers: { 'Content-Type': 'application/json' }
  // Timeout: 30 detik (AbortController)
  // Error handling: throw WrApiError on non-200 atau success=false

export async function fetchBalance(): Promise<WrBalance>;
  // wrFetch<WrBalance>('/balance')

export async function fetchProducts(): Promise<WrProduct[]>;
  // wrFetch<WrProduct[]>('/products')

export async function createOrder(params: {
  variant_id: string;
  quantity?: number;
  email_invite?: string;
  voucher_code?: string;
  is_test?: boolean;
}): Promise<WrOrderResult>;
  // wrFetch<WrOrderResult>('/order', params)

export async function fetchTransactions(): Promise<WrTransaction[]>;
  // wrFetch<WrTransaction[]>('/transactions')

// ── Webhook Signature Verification ──

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string
): Promise<boolean>;
  // HMAC-SHA256 dengan API key sebagai secret
  // Constant-time comparison (timingSafeEqual via Web Crypto)

// ── Error Classes ──

export class WrApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public responseBody?: unknown
  ) { super(message); }
}

export class WrInsufficientBalanceError extends WrApiError {}
export class WrOutOfStockError extends WrApiError {}
export class WrNetworkError extends Error {}
```

### Konvensi

- Semua fungsi **async** dan **edge-compatible** (pakai `fetch()`, bukan axios/node-fetch)
- Timeout via `AbortController` + `setTimeout` (30 detik default)
- Error classification dari response message WR untuk retry logic

---

## 6. Module: Product Sync Engine

### File: `src/lib/warung-rebahan/sync.ts`

Responsibility: Sinkronisasi produk dan stok dari Warung Rebahan ke database Axvara.

### Alur Sync

```
fetchProducts() dari WR API
        │
        ▼
  Filter: exclude Canva & Gemini (via wr_exclusions table)
        │
        ▼
  Untuk setiap produk WR:
    ├── Sudah ada di wr_products? → UPDATE (nama, kategori, deskripsi)
    └── Belum ada? → INSERT ke wr_products + buat di products (Axvara)
        │
        ▼
  Untuk setiap varian WR:
    ├── Sudah ada di wr_variants? → UPDATE (harga, stok, durasi, dll)
    │   └── Harga berubah? → Recalculate axvara_sell_price, update product_variants
    │   └── Stok berubah? → Update product_variants.stock
    └── Belum ada? → INSERT ke wr_variants + buat di product_variants (Axvara)
        │
        ▼
  Varian yang ada di DB tapi TIDAK ada di response WR:
    └── Set stock = 0 (bukan delete — WR mungkin hide sementara)
        │
        ▼
  Update products.stock = SUM(product_variants.stock)
  Update products.price = MIN(product_variants.price) — harga terendah
        │
        ▼
  Log ke wr_sync_log
```

### Fungsi Utama

```typescript
export async function syncProducts(database?: DatabaseAccess): Promise<SyncResult>;

export type SyncResult = {
  total: number;
  synced: number;
  excluded: number;
  newProducts: number;
  newVariants: number;
  stockChanges: number;
  priceChanges: number;
  errors: string[];
  durationMs: number;
};
```

### Detail Implementasi

```typescript
// 1. Exclusion check
export async function isExcluded(productName: string, db: DatabaseAccess): Promise<boolean>;
  // SELECT 1 FROM wr_exclusions WHERE lower(:name) LIKE lower(pattern) LIMIT 1

// 2. Upsert product
export async function upsertWrProduct(wrProduct: WrProduct, db: DatabaseAccess): Promise<{
  wrProductRow: WrProductRow;
  axvaraProductId: number;
  isNew: boolean;
}>;
  // Cek: SELECT * FROM wr_products WHERE wr_product_id = ?
  // Jika baru:
  //   INSERT INTO products (name, slug, category_id, price, stock, source, wr_product_id, wr_auto_managed, ...)
  //   INSERT INTO wr_products (wr_product_id, wr_product_name, wr_category, axvara_product_id, ...)
  // Jika sudah ada:
  //   UPDATE wr_products SET wr_product_name=?, wr_category=?, last_synced_at=? WHERE wr_product_id=?

// 3. Upsert variant
export async function upsertWrVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess
): Promise<{
  stockChanged: boolean;
  priceChanged: boolean;
  isNew: boolean;
}>;

// 4. Hitung harga jual
export function calculateSellPrice(
  wrPrice: number,
  markupPercent: number,
  markupFixed: number
): number;
  // Math.ceil(wrPrice * (1 + markupPercent / 100)) + markupFixed
  // Dibulatkan ke atas ke kelipatan 500 untuk harga rapi
  // e.g. wrPrice=5000, markup=50% → 7500, dibulatkan → 7500
  // e.g. wrPrice=3200, markup=50% → 4800, dibulatkan → 5000

// 5. Parse durasi WR ke format Axvara
export function parseWrDuration(wrDuration: string): {
  value: number | null;
  unit: 'day' | 'month' | 'year' | 'lifetime' | 'custom' | null;
  label: string;
};
  // "7 Hari" → { value: 7, unit: 'day', label: '7 Hari' }
  // "30 Hari" → { value: 30, unit: 'day', label: '30 Hari' }  
  // "1 Bulan" → { value: 1, unit: 'month', label: '1 Bulan' }
  // "1 Tahun" → { value: 1, unit: 'year', label: '1 Tahun' }
  // "Lifetime" → { value: null, unit: 'lifetime', label: 'Lifetime' }

// 6. Parse garansi WR ke format Axvara
export function parseWrWarranty(wrWarranty: string): {
  type: 'none' | 'limited' | 'full' | 'custom';
  value: number | null;
  unit: 'day' | 'month' | 'year' | 'lifetime' | null;
  label: string;
};

// 7. Generate slug
export function generateProductSlug(name: string): string;
  // "CapCut Pro" → "capcut-pro"
  // Handle collision: append "-wr" jika slug sudah ada di products
  // Handle special chars, Indonesian text

// 8. Map kategori WR ke category_id Axvara
export function mapWrCategory(wrCategory: string): number;
  // "Productivity" → 3 (Tools Pro)
  // "Streaming" → 2 (Akun Premium)
  // "AI" → 1 (AI Gateway)
  // default → parseInt(process.env.WARUNG_REBAHAN_DEFAULT_CATEGORY_ID) || 2
```

### Budget-Aware Sync

Sync berjalan dalam cron yang punya query budget terbatas. Strategi:

```typescript
// Sync dibagi 2 tahap di cron:
// Tahap 1: Fetch products dari API (0 query D1, 1 fetch external)
// Tahap 2: Upsert ke DB (N queries, dimana N = jumlah produk + varian)

// Jika budget tidak cukup untuk sync semua:
// - Prioritaskan stock updates (paling sering berubah)
// - Skip produk yang sudah disync < 10 menit lalu
// - Batch upsert menggunakan d1.batch() untuk efisiensi

export const COST_PER_WR_PRODUCT_SYNC = 3;   // queries per product upsert
export const COST_PER_WR_VARIANT_SYNC = 2;    // queries per variant upsert
export const COST_WR_INITIAL_FETCH = 1;       // 1 fetch for exclusion list
```

---

## 7. Module: Auto-Order (H2H Fulfillment)

### File: `src/lib/warung-rebahan/order.ts`

Responsibility: Meneruskan order Axvara ke Warung Rebahan setelah payment confirmed.

### Alur Auto-Order

```
Payment Confirmed (DANA webhook / admin confirm)
        │
        ▼
  transitionPendingPaymentToPaid() — yang sudah ada
        │
        ▼
  [BARU] Cek: product.source === 'warung_rebahan'?
        │
        ├── Ya → INSERT INTO wr_order_links (status='pending')
        │         │
        │         ▼
        │    [Di cron berikutnya, atau langsung jika auto_order=true]
        │    processWrPendingOrders()
        │         │
        │         ▼
        │    POST /order ke WR API
        │         │
        │         ├── Success → UPDATE wr_order_links SET status='processing', wr_order_id=?
        │         └── Fail → UPDATE wr_order_links SET status='retry', attempt_count++
        │
        └── Tidak → Lanjut ke fulfillment pipeline yang sudah ada
```

### Fungsi Utama

```typescript
// Dipanggil setelah payment confirmed
export async function createWrOrderLink(
  orderCode: string,
  items: OrderItem[],
  db?: DatabaseAccess
): Promise<void>;
  // Untuk setiap item yang source='warung_rebahan':
  //   INSERT INTO wr_order_links (order_code, wr_variant_id, quantity, wr_cost, status='pending')

// Dipanggil oleh cron atau langsung setelah payment
export async function processWrPendingOrders(db?: DatabaseAccess): Promise<ProcessResult>;
  // SELECT * FROM wr_order_links WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()
  // Untuk setiap link:
  //   1. Cek saldo WR cukup
  //   2. POST /order ke WR API
  //   3. Update status based on response

// Dipanggil oleh webhook dari WR
export async function handleWrOrderCompleted(
  wrOrderId: string,
  accountDetails: unknown,
  db?: DatabaseAccess
): Promise<void>;
  // 1. SELECT * FROM wr_order_links WHERE wr_order_id = ?
  // 2. Encrypt account details
  // 3. UPDATE wr_order_links SET status='completed', wr_account_details=?, completed_at=?
  // 4. UPDATE orders SET fulfillment_status='delivered' WHERE code=?
  // 5. Kirim detail akun ke customer via channel order (web/TG/WA)

export async function handleWrOrderFailed(
  wrOrderId: string,
  errorMessage: string,
  db?: DatabaseAccess
): Promise<void>;
  // 1. UPDATE wr_order_links SET status='failed', last_error=?
  // 2. UPDATE orders SET fulfillment_status='failed' WHERE code=?
  // 3. Notify admin via Telegram: "⚠️ Order WR gagal: {order_code} — {error}"
  // 4. JANGAN auto-refund — biarkan admin yang putuskan

// Retry logic
export async function retryFailedWrOrders(db?: DatabaseAccess): Promise<number>;
  // SELECT * FROM wr_order_links WHERE status='retry' AND attempt_count < max_attempts
  //   AND next_attempt_at <= now()
  // Retry dengan exponential backoff: 1min, 5min, 15min
```

### Integrasi dengan Existing Codebase

Hook ke `transitionPendingPaymentToPaid()` di `src/lib/db/orders-transition.ts`:

```typescript
// Di orders-transition.ts, SETELAH payment confirmed:
// Tambahkan check:

import { createWrOrderLink } from '@/lib/warung-rebahan/order';

// Dalam transitionPendingPaymentToPaid():
// ...existing logic...
// Setelah berhasil transition:

const orderItems = JSON.parse(order.items);
const hasWrItems = orderItems.some(
  (item: OrderItem) => item.source === 'warung_rebahan'
);

if (hasWrItems && isWrEnabled() && isWrAutoOrderEnabled()) {
  await createWrOrderLink(orderCode, orderItems, database);
  // Jika auto_order immediate:
  await processWrPendingOrders(database);
}
```

---

## 8. Module: Webhook Receiver

### File: `src/app/api/webhook/warung/route.ts`

Responsibility: Menerima notifikasi real-time dari Warung Rebahan.

### Implementasi

```typescript
export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  // 1. Verify feature flag
  if (!isWrEnabled()) {
    return new Response('Service unavailable', { status: 503 });
  }

  // 2. Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get('x-rebahan-signature') ?? '';

  // 3. Verify HMAC-SHA256 signature
  const isValid = await verifyWebhookSignature(rawBody, signature);
  if (!isValid) {
    return new Response('Invalid signature', { status: 401 });
  }

  // 4. Parse payload
  const payload: WrWebhookEvent = JSON.parse(rawBody);

  // 5. Process event
  switch (payload.event) {
    case 'order.processing':
      await handleWrOrderProcessing(payload.data);
      break;

    case 'order.completed':
      await handleWrOrderCompleted(
        payload.data.order_id,
        payload.data
      );
      break;

    case 'order.failed':
      await handleWrOrderFailed(
        payload.data.order_id,
        payload.data.status
      );
      break;

    default:
      console.warn(`Unknown WR webhook event: ${payload.event}`);
  }

  // 6. Always return 200 to WR
  return Response.json({ status: 'ok' });
}
```

### Webhook URL Configuration

Di dashboard Warung Rebahan, set webhook URL ke:
```
https://axvara.tech/api/webhook/warung
```

---

## 9. Module: Saldo Monitor

### File: `src/lib/warung-rebahan/saldo.ts`

Responsibility: Monitor saldo Warung Rebahan dan kirim alert jika rendah.

```typescript
export async function checkAndLogSaldo(db?: DatabaseAccess): Promise<{
  balance: number;
  isLow: boolean;
}>;
  // 1. fetchBalance() dari WR API
  // 2. INSERT INTO wr_saldo_log (balance, source='api_check')
  // 3. Cek threshold:
  //    const threshold = parseInt(process.env.WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD) || 50000;
  //    if (balance < threshold) → Notify admin via Telegram
  // 4. Return { balance, isLow: balance < threshold }

export async function getSaldoHistory(limit?: number): Promise<SaldoLog[]>;
  // SELECT * FROM wr_saldo_log ORDER BY created_at DESC LIMIT ?

export async function estimateOrderCapacity(): Promise<{
  balance: number;
  avgOrderCost: number;
  estimatedOrders: number;
}>;
  // Hitung rata-rata wr_cost dari wr_order_links yang completed
  // Estimasi berapa order lagi yang bisa diproses dengan saldo saat ini
```

---

## 10. Cron Job Extension

### File yang diubah: `src/app/api/cron/operations/route.ts`

Tambahkan **phase baru** ke rotation system yang sudah ada:

```typescript
// ── Existing phases ──
// 'expiry' | 'fulfillment' | 'notify' | 'cleanup'

// ── New phase ──
// 'warung_rebahan'

// Phase ini melakukan:
// 1. Product sync (jika WARUNG_REBAHAN_SYNC_ENABLED=true)
// 2. Process pending WR orders (jika ada)
// 3. Retry failed WR orders
// 4. Saldo check + alert
```

### Detail Phase `warung_rebahan`

```typescript
async function runWarungRebahanPhase(db: BudgetedDatabase): Promise<void> {
  if (!isWrEnabled()) return;

  const syncEnabled = process.env.WARUNG_REBAHAN_SYNC_ENABLED === 'true';
  const autoOrderEnabled = process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === 'true';

  // ── 1. Product & Stock Sync ──
  // Frekuensi: setiap 30 menit (skip jika last sync < 30 min ago)
  if (syncEnabled && db.canSpend(COST_PER_WR_PRODUCT_SYNC * 5)) {
    const lastSync = await queryFirst(
      `SELECT created_at FROM wr_sync_log 
       WHERE sync_type='products' AND status='success'
       ORDER BY created_at DESC LIMIT 1`
    );
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    if (!lastSync || lastSync.created_at < thirtyMinAgo) {
      await syncProducts(db);
    }
  }

  // ── 2. Process Pending WR Orders ──
  if (autoOrderEnabled && db.canSpend(3)) {
    await processWrPendingOrders(db);
  }

  // ── 3. Retry Failed WR Orders ──
  if (autoOrderEnabled && db.canSpend(3)) {
    await retryFailedWrOrders(db);
  }

  // ── 4. Saldo Check ──
  // Frekuensi: setiap 1 jam
  if (db.canSpend(2)) {
    const lastCheck = await queryFirst(
      `SELECT created_at FROM wr_saldo_log 
       WHERE source='api_check'
       ORDER BY created_at DESC LIMIT 1`
    );
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    if (!lastCheck || lastCheck.created_at < oneHourAgo) {
      await checkAndLogSaldo(db);
    }
  }
}
```

### Phase Rotation Update

```typescript
// Sebelum (4 phases):
// 'expiry' → 'fulfillment' → 'notify' → 'cleanup'

// Sesudah (5 phases):
// 'expiry' → 'fulfillment' → 'warung_rebahan' → 'notify' → 'cleanup'

// WR phase disisipkan SETELAH fulfillment dan SEBELUM notify,
// karena WR orders perlu diproses sebelum notifikasi dikirim.
```

---

## 11. Admin Panel Extension

### Tab Baru: "Warung Rebahan"

#### File: `src/components/admin/WarungRebahanManager.tsx`

Komponen ini menampilkan:

```
┌──────────────────────────────────────────────────────────┐
│ Tab: Warung Rebahan                                      │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Saldo WR: Rp 245.000  ⟳ Refresh    ⚠️ Low Balance  │ │
│ │ Estimasi: ~49 order lagi                             │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Sync Status                                          │ │
│ │ Last sync: 5 menit lalu (Success)                    │ │
│ │ Products: 87 synced, 2 excluded, 3 new               │ │
│ │ Stock changes: 12 | Price changes: 0                 │ │
│ │ [🔄 Force Sync Now]                                  │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ WR Order Queue                                       │ │
│ │ ┌────────┬──────────┬────────┬────────┬───────────┐ │ │
│ │ │ Order  │ Produk   │ Cost   │ Status │ Action    │ │ │
│ │ ├────────┼──────────┼────────┼────────┼───────────┤ │ │
│ │ │ AXV-.. │ CapCut   │ Rp5000 │ ✅done │           │ │ │
│ │ │ AXV-.. │ ChatGPT  │ Rp35k  │ ⏳proc │           │ │ │
│ │ │ AXV-.. │ Netflix  │ Rp10k  │ ❌fail │ [Retry]   │ │ │
│ │ └────────┴──────────┴────────┴────────┴───────────┘ │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Exclusion Rules                                      │ │
│ │ • %canva% — Axvara punya Canva Edu sendiri           │ │
│ │ • %gemini% — Dijual terpisah                         │ │
│ │ [+ Tambah Exclusion]                                 │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Markup Settings (Per Produk)                         │ │
│ │ Default: 50% + Rp 0                                  │ │
│ │ ┌────────────┬────────┬────────┬───────────────────┐ │ │
│ │ │ Produk     │ WR     │ Markup │ Sell Price        │ │ │
│ │ ├────────────┼────────┼────────┼───────────────────┤ │ │
│ │ │ CapCut Pro │ Rp5000 │ 60%    │ Rp 8.000 [Edit]  │ │ │
│ │ │ ChatGPT+   │ Rp35k  │ 40%    │ Rp 49.000 [Edit] │ │ │
│ │ │ Netflix    │ Rp10k  │ 50%    │ Rp 15.000 [Edit] │ │ │
│ │ └────────────┴────────┴────────┴───────────────────┘ │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### API Routes Baru untuk Admin WR

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/warung/saldo` | GET | Fetch saldo WR real-time |
| `/api/admin/warung/sync` | POST | Force sync produk sekarang |
| `/api/admin/warung/sync-log` | GET | Riwayat sync |
| `/api/admin/warung/orders` | GET | Daftar WR order links |
| `/api/admin/warung/orders/[id]/retry` | POST | Manual retry order |
| `/api/admin/warung/exclusions` | GET, POST, DELETE | Kelola exclusion rules |
| `/api/admin/warung/markup` | GET, PUT | Kelola markup per varian |

---

## 12. Storefront Impact

### Perubahan Minimal di Storefront

Produk WR masuk ke tabel `products` dan `product_variants` yang **sudah ada**. Jadi storefront **tidak perlu diubah** secara signifikan. Perubahan kecil:

#### 1. Badge "Stok Habis" untuk produk out-of-stock

```typescript
// Di ProductCard.tsx, tambahkan:
{product.stock === 0 && (
  <span className="badge badge-error">Stok Habis</span>
)}
```

#### 2. Disable "Beli" button jika stok = 0

```typescript
// Di QuickVariantModal.tsx:
<button
  disabled={selectedVariant.stock === 0}
  className={selectedVariant.stock === 0 ? 'opacity-50 cursor-not-allowed' : ''}
>
  {selectedVariant.stock === 0 ? 'Stok Habis' : 'Beli Sekarang'}
</button>
```

#### 3. Badge sumber produk (opsional)

```typescript
// Untuk transparansi, tampilkan badge tipe akun dari WR:
{variant.wr_type && (
  <span className="text-xs text-gray-500">{variant.wr_type}</span>
  // "Private", "Sharing", dll
)}
```

#### 4. Tampilkan garansi dari WR

```typescript
// Data garansi sudah di-parse dan disimpan di product_variants
// via warranty_type, warranty_value, warranty_unit, warranty_label
// Komponen VariantCard yang sudah ada bisa langsung menampilkannya
```

---

## 13. Produk: Exclusion Rules

### Mekanisme Exclusion

```sql
-- Tabel wr_exclusions menyimpan pattern LIKE:
-- '%canva%' → exclude semua produk yang namanya mengandung "canva"
-- '%gemini%' → exclude semua produk yang namanya mengandung "gemini"

-- Query saat sync:
SELECT 1 FROM wr_exclusions 
WHERE lower(:product_name) LIKE lower(pattern)
LIMIT 1;
```

### Kenapa Canva dan Gemini Di-exclude

| Produk | Alasan |
|--------|--------|
| **Canva** | Axvara sudah punya akses Canva Edu (admin, bisa invite 500 orang). Margin 100% karena modal Rp 0. Menjual via WR justru membebani saldo dan menurunkan margin. |
| **Gemini** | Akan dijual dengan metode terpisah (regional pricing / family sharing) dengan margin lebih tinggi dari reseller WR. |

### Admin bisa menambah/hapus exclusion lewat dashboard WR.

---

## 14. Alur Order End-to-End

### Skenario: Customer beli CapCut Pro via Web

```
Timeline:
──────────────────────────────────────────────────────────────

[T+0s]   Customer buka axvara.tech, pilih CapCut Pro 7 Hari
         Harga tampil: Rp 8.000 (WR cost Rp 5.000 + 60% markup)

[T+5s]   Customer klik "Beli" → masuk CartDrawer
         Lanjut ke /checkout → isi nama, WA, email

[T+10s]  POST /api/checkout/quote
         → Validasi stok (dari product_variants.stock, yang disync dari WR)
         → Return quoteToken (JWT, 1 jam TTL)

[T+15s]  POST /api/orders
         → createOrderWithStock() — atomic stock reservation
         → createDanaQrisInvoice() — generate QRIS Rp 8.000 + unique code
         → Redirect ke /pesanan/AXV-20260911-ABCD1234

[T+20s]  Customer scan QRIS, bayar Rp 8.127 (termasuk unique code)

[T+22s]  DANA webhook → /api/webhook/dana
         → Match payable_amount = 8127
         → transitionPendingPaymentToPaid('AXV-20260911-ABCD1234')
         
         [BARU] Di dalam transitionPendingPaymentToPaid():
         → Detect source='warung_rebahan' pada order item
         → INSERT INTO wr_order_links (
              order_code='AXV-20260911-ABCD1234',
              wr_variant_id='xxx',
              wr_cost=5000,
              status='pending'
           )
         
         [Jika auto_order=true — langsung:]
         → POST ke WR API /order { variant_id: 'xxx', quantity: 1 }
         → WR response: { order_id: 'ORD-20260911-X8Y9Z', status: 'processing' }
         → UPDATE wr_order_links SET status='processing', wr_order_id='ORD-20260911-X8Y9Z'
         → Saldo WR berkurang Rp 5.000

[T+25s]  WR webhook → /api/webhook/warung
         → event: 'order.completed'
         → data: { order_id: 'ORD-20260911-X8Y9Z', account_details: [...] }
         → handleWrOrderCompleted():
            1. Encrypt account details
            2. UPDATE wr_order_links SET status='completed'
            3. UPDATE orders SET fulfillment_status='delivered'
            4. Kirim ke customer via Telegram/WA/email:
               "✅ Pesanan AXV-20260911-ABCD1234 sudah siap!
                📦 CapCut Pro 7 Hari (Private)
                📧 Email: xxx@gmail.com
                🔑 Password: xxxxxxxx
                ⏰ Garansi: 7 Hari"

[T+30s]  Customer terima detail akun. SELESAI.

──────────────────────────────────────────────────────────────
Total waktu: ~30 detik (fully automated)
Profit: Rp 8.000 - Rp 5.000 = Rp 3.000 per transaksi
```

### Skenario: WR API Down saat Order

```
[T+22s]  Payment confirmed → createWrOrderLink(status='pending')
[T+22s]  processWrPendingOrders() → fetch() timeout / error
         → UPDATE wr_order_links SET status='retry', attempt_count=1,
           next_attempt_at=now()+60s, last_error='Network timeout'
         → Notify admin: "⚠️ WR order gagal, akan retry 1 menit lagi"

[T+82s]  Cron run → retryFailedWrOrders()
         → Retry POST /order → Success!
         → status='processing'

[T+90s]  WR webhook → order.completed → deliver ke customer
```

---

## 15. Pricing & Markup Strategy

### Default Markup: 50%

```
Harga Jual = ceil(Harga WR × 1.50 / 500) × 500
```

Pembulatan ke kelipatan 500 agar harga terlihat rapi.

### Contoh Kalkulasi

| Produk WR | Harga WR | Markup 50% | Pembulatan | Harga Jual | Profit |
|-----------|----------|------------|------------|------------|--------|
| CapCut Pro 7H | Rp 5.000 | Rp 7.500 | Rp 7.500 | **Rp 7.500** | Rp 2.500 |
| ChatGPT+ 30H | Rp 35.000 | Rp 52.500 | Rp 52.500 | **Rp 52.500** | Rp 17.500 |
| Netflix 30H | Rp 10.000 | Rp 15.000 | Rp 15.000 | **Rp 15.000** | Rp 5.000 |
| Spotify 7H | Rp 3.000 | Rp 4.500 | Rp 4.500 | **Rp 4.500** | Rp 1.500 |
| Claude Pro 30H | Rp 40.000 | Rp 60.000 | Rp 60.000 | **Rp 60.000** | Rp 20.000 |

### Markup Bisa Di-override Per Varian

Admin bisa set markup khusus per varian di tab Warung Rebahan:
- Produk mahal (>Rp 50k) → markup 30-40% agar tetap kompetitif
- Produk murah (<Rp 10k) → markup 50-80% karena nominal kecil

---

## 16. Error Handling & Edge Cases

### 1. Saldo WR Tidak Cukup

```typescript
// Di processWrPendingOrders():
try {
  const result = await createOrder({ variant_id, quantity });
} catch (e) {
  if (e instanceof WrInsufficientBalanceError) {
    // JANGAN retry terus — pause semua WR orders
    // Notify admin: "💰 Saldo WR habis! Segera top up."
    // Set status='retry' dengan next_attempt_at = 1 jam lagi
    // (beri waktu admin top up)
  }
}
```

### 2. Stok WR Habis Saat Order

```typescript
if (e instanceof WrOutOfStockError) {
  // 1. Update product_variants.stock = 0 (sync segera)
  // 2. Notify admin + customer: "Stok sedang habis, pesanan pending"
  // 3. Set status='retry' — akan otomatis jalan lagi saat stok ada
  // 4. Atau: admin bisa cancel + refund manual
}
```

### 3. Webhook WR Tidak Pernah Datang

```typescript
// Di cron, tambahkan check:
// SELECT * FROM wr_order_links 
// WHERE status='processing' 
// AND updated_at < datetime('now', '-1 hour')
//
// Jika order WR sudah 'processing' > 1 jam tanpa webhook:
// → Hit WR /transactions API untuk cek status manual
// → Update status accordingly
```

### 4. Produk WR Hilang dari API Response

```typescript
// JANGAN hapus produk dari Axvara jika tidak ada di response WR.
// WR mungkin hide/unhide produk sementara.
// Cukup set stock = 0 pada varian yang hilang.
// Jika produk kembali muncul di sync berikutnya, stock otomatis terupdate.
```

### 5. Collision: Produk Manual vs WR dengan Nama Sama

```typescript
// Generate slug dengan suffix "-wr" jika collision:
// "chatgpt-plus" sudah ada (manual) → "chatgpt-plus-wr"
//
// ATAU: Admin bisa merge — link produk manual yang sudah ada
// ke wr_product via admin panel, sehingga produk manual itu
// jadi auto-managed oleh WR sync (harga + stok ikut WR).
```

### 6. Harga WR Berubah Di-tengah Order

```typescript
// Quote system Axvara sudah handle ini:
// quoteToken mengunci harga saat checkout.
// Jika harga WR naik antara checkout dan payment:
//   → Axvara tetap jual di harga quote (margin berkurang)
//   → Harga baru berlaku untuk order berikutnya (setelah sync)
// Jika harga WR turun:
//   → Axvara dapat margin lebih besar
```

---

## 17. Testing Strategy

### Unit Tests

```
tests/
  warung-rebahan/
    client.test.ts          — API client dengan mocked fetch
    sync.test.ts            — Product sync logic
    order.test.ts           — Order creation & retry
    saldo.test.ts           — Saldo check & alert
    webhook.test.ts         — Webhook signature & event handling
    pricing.test.ts         — Markup calculation & rounding
    exclusion.test.ts       — Exclusion pattern matching
    duration-parser.test.ts — WR duration string parsing
```

### Sandbox Testing

Warung Rebahan menyediakan **Sandbox Mode** (`is_test: true`). Gunakan ini:

```typescript
// Di environment development/staging:
// Set WARUNG_REBAHAN_SANDBOX=true
// Semua order ke WR akan include is_test: true
// Saldo tidak terpotong, response tetap valid
```

### Integration Test Flow

```
1. Fetch products (real API, no side effects)
2. Sync ke database lokal (SQLite dev)
3. Verify produk + varian muncul di katalog
4. Create test order (sandbox mode)
5. Simulate webhook (manual POST ke /api/webhook/warung)
6. Verify fulfillment flow end-to-end
```

---

## 18. Security Considerations

### 1. API Key Protection

- `WARUNG_REBAHAN_API_KEY` hanya tersimpan di Cloudflare Pages Secrets
- Tidak pernah di-log, tidak pernah masuk response, tidak pernah di-expose ke client
- Semua API call ke WR hanya terjadi di Edge Runtime (server-side)

### 2. Webhook Verification

- Setiap incoming webhook dari WR diverifikasi dengan HMAC-SHA256
- Signature di header `X-Rebahan-Signature`
- Secret = API key (sesuai dokumentasi WR)
- Constant-time comparison untuk mencegah timing attacks

### 3. Account Details Encryption

- Detail akun dari WR (email + password) di-encrypt sebelum disimpan di D1
- Menggunakan AES-256-GCM via Web Crypto API (sama seperti `fulfillment/crypto.ts`)
- Key: `FULFILLMENT_ENCRYPTION_KEY` yang sudah ada
- Decrypt hanya saat delivery ke customer

### 4. Rate Limiting

- Webhook endpoint: rate limit 60 req/min (generous, WR bisa burst)
- Admin sync endpoint: rate limit 2 req/min (prevent spam clicks)

### 5. SSRF Prevention

- Outbound request HANYA ke `warungrebahan.com` — di-hardcode di client
- Tidak ada dynamic URL construction dari user input

---

## 19. Fase Implementasi

### Fase 1: Foundation (Hari 1-2)

| Task | File | Estimasi |
|------|------|----------|
| Database migration | `drizzle/migrations/0027_warung_rebahan.sql` | 1 jam |
| Environment variables | `.env.example`, Cloudflare Pages | 15 menit |
| WR API client | `src/lib/warung-rebahan/client.ts` | 2 jam |
| Unit tests client | `tests/warung-rebahan/client.test.ts` | 1 jam |

### Fase 2: Product Sync (Hari 2-3)

| Task | File | Estimasi |
|------|------|----------|
| Sync engine | `src/lib/warung-rebahan/sync.ts` | 3 jam |
| Duration/warranty parser | (dalam sync.ts) | 1 jam |
| Exclusion logic | (dalam sync.ts) | 30 menit |
| Cron integration (sync phase) | `src/app/api/cron/operations/route.ts` | 1 jam |
| Admin: force sync endpoint | `src/app/api/admin/warung/sync/route.ts` | 30 menit |
| Unit tests sync | `tests/warung-rebahan/sync.test.ts` | 2 jam |

### Fase 3: Auto-Order (Hari 3-4)

| Task | File | Estimasi |
|------|------|----------|
| Order module | `src/lib/warung-rebahan/order.ts` | 3 jam |
| Hook ke payment transition | `src/lib/db/orders-transition.ts` (edit) | 1 jam |
| Webhook receiver | `src/app/api/webhook/warung/route.ts` | 1 jam |
| Cron integration (order phase) | `src/app/api/cron/operations/route.ts` (edit) | 1 jam |
| Delivery to customer (WA/TG/Web) | `src/lib/warung-rebahan/deliver.ts` | 2 jam |
| Unit tests order | `tests/warung-rebahan/order.test.ts` | 2 jam |

### Fase 4: Saldo & Admin (Hari 4-5)

| Task | File | Estimasi |
|------|------|----------|
| Saldo monitor | `src/lib/warung-rebahan/saldo.ts` | 1 jam |
| Admin tab component | `src/components/admin/WarungRebahanManager.tsx` | 3 jam |
| Admin API routes (6 endpoints) | `src/app/api/admin/warung/...` | 2 jam |
| Integration ke admin page.tsx | `src/app/admin/page.tsx` (edit) | 30 menit |

### Fase 5: Polish & Deploy (Hari 5-6)

| Task | File | Estimasi |
|------|------|----------|
| Storefront: stok habis badge | `src/components/storefront/ProductCard.tsx` (edit) | 30 menit |
| Storefront: disable beli jika stok=0 | `src/components/storefront/QuickVariantModal.tsx` (edit) | 30 menit |
| E2E testing dengan sandbox | Manual testing | 2 jam |
| Deploy migration ke D1 | `wrangler d1 migrations apply axvara-db` | 15 menit |
| Set env vars di Cloudflare | Cloudflare Pages dashboard | 15 menit |
| Set webhook URL di WR dashboard | warungrebahan.com | 10 menit |
| Initial product sync | POST /api/admin/warung/sync | 5 menit |
| Smoke test: beli produk WR real | Manual | 30 menit |

### Total Estimasi: **5-6 hari kerja**

---

## 20. Estimasi File yang Dibuat/Diubah

### File BARU (15 files)

```
src/lib/warung-rebahan/
├── client.ts                    — API client + types + errors
├── sync.ts                      — Product sync engine
├── order.ts                     — Auto-order + retry logic
├── saldo.ts                     — Saldo monitor + alert
└── deliver.ts                   — Delivery detail akun ke customer

src/app/api/webhook/warung/
└── route.ts                     — Webhook receiver

src/app/api/admin/warung/
├── saldo/route.ts               — GET saldo
├── sync/route.ts                — POST force sync
├── sync-log/route.ts            — GET sync history
├── orders/route.ts              — GET WR order links
├── orders/[id]/retry/route.ts   — POST retry order
├── exclusions/route.ts          — GET/POST/DELETE exclusions
└── markup/route.ts              — GET/PUT markup settings

src/components/admin/
└── WarungRebahanManager.tsx     — Admin panel tab

drizzle/migrations/
└── 0027_warung_rebahan.sql      — Database migration
```

### File DIUBAH (6 files)

```
src/app/api/cron/operations/route.ts      — Tambah phase 'warung_rebahan'
src/lib/db/orders-transition.ts           — Hook WR order creation after payment
src/app/admin/page.tsx                    — Tambah tab WR di admin panel
src/components/storefront/ProductCard.tsx  — Badge "Stok Habis"
src/components/storefront/QuickVariantModal.tsx — Disable button stok 0
.env.example                              — Tambah env vars WR
```

### File TEST (8 files)

```
tests/warung-rebahan/
├── client.test.ts
├── sync.test.ts
├── order.test.ts
├── saldo.test.ts
├── webhook.test.ts
├── pricing.test.ts
├── exclusion.test.ts
└── duration-parser.test.ts
```

---

## Appendix A: Warung Rebahan API Reference (Quick)

| Endpoint | Method | Input | Output |
|----------|--------|-------|--------|
| `/balance` | POST | `{ api_key }` | `{ balance, currency }` |
| `/products` | POST | `{ api_key }` | `[ { id, name, category, variants: [...] } ]` |
| `/order` | POST | `{ api_key, variant_id, quantity?, email_invite?, is_test? }` | `{ order_id, status, total_amount, current_balance }` |
| `/transactions` | POST | `{ api_key }` | `[ { order_id, status, products, account_details } ]` |
| **Webhook** | POST (incoming) | Header: `X-Rebahan-Signature` | `{ event, data: { order_id, status } }` |

## Appendix B: Warung Rebahan Webhook Events

| Event | Kapan | Action Axvara |
|-------|-------|---------------|
| `order.processing` | WR mulai proses order | Update `wr_order_links.status = 'processing'` |
| `order.completed` | WR selesai, akun siap | Deliver akun ke customer, update status |
| `order.failed` | WR gagal | Notify admin, set retry atau manual handle |

## Appendix C: Category Mapping

| WR Category | Axvara Category ID | Axvara Category Name |
|-------------|-------------------|---------------------|
| AI | 1 | AI Gateway |
| Productivity | 3 | Tools Pro |
| Streaming | 2 | Akun Premium |
| Gaming | 2 | Akun Premium |
| VPN | 3 | Tools Pro |
| Education | 3 | Tools Pro |
| *(default)* | 2 | Akun Premium |

---

> **Catatan akhir:** Dokumen ini adalah blueprint lengkap. Implementasi bisa dimulai dari Fase 1 kapan saja. Semua kode harus mengikuti konvensi Axvara yang sudah ada: Edge Runtime, raw SQL via `queryAll/queryFirst/execRun`, Zod validation, budget-aware database access, dan D1 batch untuk atomicity.
