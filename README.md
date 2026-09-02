# AXVARA — Gerbang Semua Tools Premium

> **Satu Gerbang, Semua Tools Premium** — Toko digital premium Apple Store + Glassmorphism

AXVARA adalah toko digital untuk **AI Gateway, Akun Premium, Tools Pro, Bundle Hemat** — flow terinspirasi marketku.id tapi desain 10x lebih premium, checkout super simpel **Transfer / QRIS Statis** (tanpa payment gateway), hosting **gratis selamanya** di Cloudflare Pages.

**Live dev:** `http://localhost:3000` — Next 15.5.2

---

## 📂 Struktur

```
axvara/
├── AGENTS.md               # Aturan khusus project (scope axvara, tidak sentuh ~/AGENTS.md)
├── CHANGELOG.md            # Riwayat perubahan — WAJIB update tiap ubahan (terbaru di atas)
├── docs/
│   ├── PRD.md              # Requirements, flow, payment spec, AC
│   ├── DESIGN.md           # Apple Store + glassmorphism + motion
│   ├── ARCHITECTURE.md     # Stack D1+R2, schema, API contract
│   └── VPS-RESEARCH.md     # Riset VPS gratis — kenapa Pages juara
├── public/
│   ├── brand/
│   │   ├── axvara-mark.svg # Mark Prism wireframe (icon/app)
│   │   └── axvara-logo.svg # Lockup horizontal
│   └── qris/
│       ├── axvara-qris.jpg # QRIS Brotherstore06 hi-res (104KB)
│       └── axvara-qris.png
├── drizzle/schema.sql      # Schema D1 (categories/products/orders/admins/payment_methods)
├── src/
│   ├── app/
│   │   ├── page.tsx        # Homepage — Hero + Orbit + Katalog pagination 8/page
│   │   ├── produk/[slug]/  # Detail produk
│   │   ├── checkout/       # Checkout 1 halaman — pilih QRIS/E-Wallet/SeaBank + upload bukti
│   │   ├── pesanan/[code]/ # Sukses — AXV-XXXX + WA admin
│   │   ├── admin/          # Login + Dashboard pesanan
│   │   └── globals.css     # Tokens Liquid Glass iOS 26
│   ├── components/storefront/  # Navbar, OrbitHero, ProductCard, CartDrawer, PopupBanner, Footer, ScrollRope
│   ├── lib/products.ts     # 24 produk seed + kategori + paymentMethods
│   └── stores/cart.ts      # Zustand cart (persist axvara-cart)
├── wrangler.json           # Cloudflare Pages + D1 + R2 bindings/output
└── .env.example
```

---

## 🎨 Brand

- **Logo:** Prism wireframe (`public/brand/axvara-mark.svg`) — segitiga sama sisi + spine + inner A negative space, stroke 3.6, Swiss geometric — di Navbar `36×32px` + wordmark `font-[300] tracking-[0.22em]`
- **Palet:** Midnight `#070a1e/#080C1E` + Cyan `#00E5FF` + Gold `#FFB800`
- **Font:** Apple SF Pro (`-apple-system, SF Pro Display/Text`) — bukan Space Grotesk
- **Efek:** `ax-glass` blur 20px untuk navbar/modal, `ax-glass-strong` blur 24px, dan `ax-glass-card` tanpa backdrop blur untuk kartu berulang agar GPU lebih ringan.
- **Motion:** Apple spring `cubic-bezier(0.32,0.72,0,1)`; orbit tanpa render React per frame memakai 30 fps saat auto-rotate dan refresh-rate penuh saat interaksi, lalu berhenti saat keluar viewport. Spotlight/ScrollRope berjalan hanya saat ada interaksi.

### Catatan performa storefront

- Homepage menampilkan seed katalog segera, lalu menyegarkan data D1 saat browser idle.
- Logo orbit disajikan sebagai SVG lokal; tidak ada request runtime ke Iconify.
- Gambar kartu Unsplash memakai WebP `srcset` responsif.
- Endpoint publik eksplisit (`products?active=1`, `categories`, `banners?active=1`) mengirim cache CDN singkat; varian produk admin/private selalu `no-store`.
- CSP development mengizinkan `unsafe-eval` hanya untuk React Refresh/webpack lokal. CSP production tetap tidak mengizinkannya.

---

## 💳 Pembayaran

| Metode | Nomor/File | Ket |
|--------|------------|-----|
| E-Wallet | `082135277434` | DANA/Gopay/Shopeepay |
| SeaBank | `901812349386` | Brotherstore06 |
| QRIS | `public/qris/axvara-qris.png` | Brotherstore06 A01 |
| Bank lain | dinamis via admin | P1 — tambah tanpa deploy |

Flow: pilih metode → transfer/scan di luar web → upload bukti (JPG/PNG max 5MB) → pesanan `AXV-YYYYMMDD-XXXX` Pending → admin cek mutasi → Konfirmasi Lunas → WA lisensi.

---

## 🚀 Stack Gratis

| Layer | Teknologi | Free Tier |
|-------|-----------|-----------|
| Hosting | Cloudflare Pages | unlimited bandwidth |
| DB | D1 (SQLite) | 5GB, 5M reads/hari |
| Storage | R2 | 10GB |
| Domain | `axvara.id` (Cloudflare Registrar) | ~Rp 230rb/tahun |

Detail: `docs/VPS-RESEARCH.md` & `docs/ARCHITECTURE.md`

---

## ▶️ Jalankan Local (dev-only, tanpa build tiap ubahan)

```bash
cd /Users/macbookair/axvara          # WAJIB dari folder axvara (jangan dari ~)
npm install
# dev — cukup ini untuk harian, auto-reload, tanpa npm run build tiap ubahan
node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
# atau: npm run dev  (hanya jika cwd sudah axvara/)
# buka http://localhost:3000 — cek: curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Hanya `npm run build` sebelum deploy/major config (`next.config.mjs`, `tailwind.config.ts`). Lihat `AGENTS.md` → Verifikasi WAJIB. Jika CSS 404: `lsof -ti:3000 | xargs kill -9; rm -rf .next;` lalu start dev lagi.

## 📝 Changelog & Aturan Project

- **Changelog:** `axvara/CHANGELOG.md` — setiap perubahan wajib catat entri paling atas (format: `YYYY-MM-DD — ringkas — file/area — (verifikasi: ...)`).
- **Aturan project:** `axvara/AGENTS.md` — khusus project axvara (scope lokal, tidak ubah `~/AGENTS.md` global). Wajib baca sebelum ubah kode.

## ☁️ Deploy ke Cloudflare Pages (Gratis)

```bash
# 1. Muat kredensial lokal yang di-ignore Git
set -a; source .cf-credentials; set +a

# 2. Buat D1 + R2 (sekali)
npx wrangler d1 create axvara-db        # copy database_id ke wrangler.toml
npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql
npx wrangler r2 bucket create axvara-assets

# 3. Build adapter Pages + deploy output yang benar
npm run deploy
# atau via Git: push ke GitHub → Pages auto-build

# 4. Custom domain di Pages dashboard → axvara.id (auto SSL)
```

Buka `wrangler.json` dan isi binding D1/R2 setelah resource dibuat.

---

## 📸 QRIS

Letakkan file QRIS **hi-res asli** dari Brotherstore06 sebagai `public/qris/axvara-qris.png` — jangan screenshot low-res, biar tetap tajam saat di-zoom di checkout (tampilkan 280–340px + padding putih 16px).

---

## 🔐 Admin Demo

- URL: `/admin`
- Credentials: set via Cloudflare Pages environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256` dalam format PBKDF2)
- Dev mode: email `admin@axvara.id` / password `axvara-dev-only`

---

Private — AXVARA © 2026
