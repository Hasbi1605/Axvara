# AXVARA — Gerbang Semua Tools Premium

> **Satu Gerbang, Semua Tools Premium** — Toko digital premium Apple Store + Glassmorphism

AXVARA adalah toko digital untuk akun, aplikasi, dan tools premium dengan kategori yang dikelola dari panel admin — flow terinspirasi marketku.id, checkout simpel **Transfer / QRIS Statis** (tanpa payment gateway), dan hosting Cloudflare Pages.

**Live dev:** `http://localhost:3000` — Next 15.5.24

**Produksi:** `https://axvara.tech` — zone dan HTTPS aktif. `www.axvara.tech` serta hostname bawaan `axvara.pages.dev` mengarah permanen ke apex.

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
│   ├── TELEGRAM-BOT-KLIKQRIS-PLAN.md # Handoff rencana bot auto-order + PG
│   ├── WHATSAPP-GROUP-BOT-PLAN.md # Rencana varian terpusat + bot grup WA (terimplementasi)
│   └── VPS-RESEARCH.md     # Riset VPS gratis — kenapa Pages juara
├── public/
│   ├── brand/
│   │   ├── axvara-mark.svg # Mark Prism wireframe (icon/app)
│   │   └── axvara-logo.svg # Lockup horizontal
│   └── qris/
│       ├── axvara-qris.jpg # QRIS Brotherstore06 hi-res (104KB)
│       └── axvara-qris.png
├── drizzle/
│   ├── schema.sql          # Bootstrap schema D1 lengkap dan idempotent
│   ├── migrations/         # Migrasi satu kali untuk database lama
│   └── seed-articles.local.sql # 20 fixture artikel Draft, idempotent
├── mcp-worker/             # Remote MCP stateless + cron publisher
├── src/
│   ├── app/
│   │   ├── page.tsx        # Homepage — Hero + Orbit + Katalog pagination 8/page
│   │   ├── produk/[slug]/  # Detail produk
│   │   ├── checkout/       # Checkout 1 halaman — quote D1, pembayaran, upload bukti
│   │   ├── pesanan/[code]/ # Sukses — AXV-XXXX + WA admin
│   │   ├── admin/          # Sidebar + produk/pesanan/kategori/artikel/banner/agent
│   │   ├── artikel/        # Indeks dan detail artikel publik
│   │   ├── cara-order/     # Panduan order dari footer
│   │   ├── garansi-replace/ # Ketentuan layanan & garansi third-party dari footer (acuan klaim)
│   │   ├── api/checkout/   # Quote harga/stok/rekening bertanda tangan
│   │   ├── api/payment-methods/ # Konfigurasi pembayaran publik/admin
│   │   ├── api/subscribers/# Form email footer + daftar terproteksi admin
│   │   └── api/agent/      # Content API Bearer-token untuk MCP/agent
│   │   └── globals.css     # Tokens Liquid Glass iOS 26
│   ├── components/storefront/  # Navbar, OrbitHero, ProductCard, CartDrawer, PopupBanner, Footer, ScrollRope
│   ├── lib/products.ts     # 24 produk seed development + kategori
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
- **Motion:** Apple spring `cubic-bezier(0.32,0.72,0,1)`; orbit tanpa render React per frame memakai 30 fps saat auto-rotate dan interaksi drag hanya untuk pointer presisi. Pada layar sentuh orbit memakai `touch-action: pan-y`, sehingga swipe di atas ilustrasi tetap menggulir halaman. Spotlight/ScrollRope berjalan hanya saat ada interaksi.

### Catatan performa storefront

- Homepage dan detail menampilkan skeleton lalu hanya merender katalog aktif dari D1; seed hanya dipakai fallback database development, bukan fallback UI produksi.
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
| Bank lain | dinamis via admin | tambah/aktifkan tanpa deploy |

Flow: server memvalidasi harga/stok dan menerbitkan quote bertanda tangan 60 menit → pilih metode dari D1 → transfer/scan → upload bukti (JPG/PNG/WebP max 5MB) → order dibuat idempotent dan stok direservasi atomik → pesanan `AXV-YYYYMMDD-XXXXXXXX` Pending → admin cek mutasi → Konfirmasi Lunas. Pending otomatis kedaluwarsa setelah 24 jam dan stok dikembalikan atomik.

AXVARA adalah third-party independen (bukan official store). Garansi bervariasi 1x24 jam–30 hari mengikuti deskripsi tiap produk; klaim berupa penggantian/perbaikan, bukan refund otomatis. Checkout mewajibkan centang persetujuan ketentuan sebelum order dibuat; acuan lengkap di `/garansi-replace`.

Nomor dukungan admin adalah `089519388264` dan dipusatkan di `src/lib/site.ts`; nomor ini terpisah dari nomor tujuan pembayaran e-wallet.

### Kategori dan footer

- D1 `categories` adalah satu-satunya sumber nama, ikon, dan urutan kategori untuk kapsul katalog serta menu Jelajah di footer.
- Nama kategori dapat diganti tanpa mengubah slug stabil. Produk tetap terhubung melalui `category_id`, sehingga rename tidak memutus filter atau mengganti ikon.
- Admin memilih ikon secara eksplisit dari 12 aset lokal. Kategori yang masih memiliki produk harus dikosongkan terlebih dahulu sebelum dihapus.
- Form **Tetap update** menerima email dan menyimpannya ke `newsletter_subscribers`; hasilnya terlihat di menu **Pelanggan Email** pada panel admin.

---

## 🚀 Stack Gratis

| Layer | Teknologi | Free Tier |
|-------|-----------|-----------|
| Hosting | Cloudflare Pages | unlimited bandwidth |
| DB | D1 (SQLite) | 5GB, 5M reads/hari |
| Storage | R2 | 10GB |
| Domain utama | `axvara.tech` | Cloudflare zone + Pages custom domain aktif |
| Hostname Pages bawaan | `axvara.pages.dev` | Redirect permanen ke `axvara.tech` |

Detail: `docs/VPS-RESEARCH.md` & `docs/ARCHITECTURE.md`

Rencana implementasi bot Telegram auto-order dan integrasi KlikQRIS tersedia di
`docs/TELEGRAM-BOT-KLIKQRIS-PLAN.md`. **Implementasi MVP sudah tersedia di codebase**
(migrasi `0005_telegram_klikqris.sql`, library `src/lib/{telegram,payments,fulfillment}/`,
route API, dan admin UI "Bot & Otomasi"). Semua feature flag default off:
`TELEGRAM_BOT_ENABLED=false`, `KLIKQRIS_PAYMENTS_ENABLED=false`, `AUTO_FULFILLMENT_ENABLED=false`.
Aktivasi memerlukan owner gates (token/key/credential) yang dijelaskan di planning doc.
Repo `mocasus/telegram-auto-order-bot` hanya referensi UX, bukan source/fork.

Bot grup WhatsApp existing dan katalog varian terpusat sudah tersedia; desain dan rollout
lengkapnya ada di `docs/WHATSAPP-GROUP-BOT-PLAN.md`. D1/CMS menjadi sumber produk,
durasi, garansi, harga, stok, dan konfigurasi fulfillment per varian untuk website,
Telegram, serta WhatsApp. Flow grupnya ringkas: `list` → ketik nama produk → pilih angka
varian → `pay`/`payment` → QRIS/SeaBank/e-wallet → kirim bukti wajib dengan caption
`BUKTI <KODE> <QRIS|SEABANK|EWALLET>`. Admin meninjau bukti melalui menu **Bukti Bayar**;
QRIS dinamis disahkan callback/status KlikQRIS, sedangkan QRIS statis, SeaBank, dan
e-wallet baru mengubah order menjadi lunas setelah admin mencocokkan mutasi. Command
`garansi` memakai kebijakan kanonis yang sama dengan Telegram. Runtime memakai Fonnte pada nomor/grup existing dan
semua flag WhatsApp/varian di `.env.example` tetap default `false` untuk rollout bertahap.
Nilai `WHATSAPP_WEBHOOK_TOKEN` harus sama dengan **Secret key** pada flow webhook Fonnte;
adapter menerima field `secret` bawaan Fonnte tanpa memerlukan custom header.
Unduhan lampiran webhook tidak membawa token API Fonnte ke URL media, dibatasi 5 MB,
dan diverifikasi sebagai gambar sebelum disimpan privat. Copy pembayaran memakai snapshot
order agar perubahan nama/durasi/garansi di CMS tidak mengubah transaksi yang sudah dibuat.
Produk baru otomatis mendapat varian default. Harga/stok pada form produk lama hanya
disinkronkan untuk varian default tunggal; produk multi-varian dikelola lewat tombol
**Varian**. Penghapusan produk/varian mengarsipkannya agar order historis tetap utuh.

Setelah pembayaran diterima, tombol support bot membuka akun manusia `@axvara_support`;
username bot tetap `@Axvara_bot`. Seluruh notifikasi admin dari order web maupun Telegram
memakai satu tujuan `TELEGRAM_ADMIN_CHAT_ID`. Untuk grup privat, tambahkan bot ke grup,
kirim `/chatid`, lalu simpan ID numerik negatif yang dibalas bot sebagai secret tersebut
(link undangan `t.me/+...` tidak dapat dipakai sebagai Bot API `chat_id`).

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

## ☁️ CI/CD Cloudflare

```bash
# Provisioning awal saja
npx wrangler d1 create axvara-db        # copy database_id ke wrangler.toml
npx wrangler d1 execute axvara-db --file=./drizzle/schema.sql --remote
npx wrangler r2 bucket create axvara-assets

# Deploy normal
git push origin main
```

`.github/workflows/ci.yml` adalah satu-satunya jalur deploy otomatis. Setiap push `main` menjalankan test, type-check, build adapter Pages, menerapkan migrasi D1 yang belum tercatat, deploy Pages, lalu deploy MCP Worker. Cloudflare Pages Git build dinonaktifkan agar tidak terjadi deploy ganda. Setelah push berhasil, agent berhenti dan tidak memantau workflow.

Repository Actions memakai Secrets `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, dan `CLOUDFLARE_ACCOUNT_ID`. `.cf-credentials` hanya untuk provisioning/recovery lokal dan tidak pernah masuk Git. `npm run deploy` serta `npm run deploy:mcp` hanya dipakai untuk recovery manual yang diminta eksplisit.

Buka `wrangler.json` dan isi binding D1/R2 setelah resource dibuat. Custom domain `axvara.tech` dan registrar tetap dikelola Cloudflare.

### Aktivasi `axvara.tech` di registrar

Cloudflare sudah memiliki zone Free, custom domain Pages untuk apex dan `www`, CNAME proxied ke `axvara.pages.dev`, redirect `www` → apex, Universal SSL, Always Use HTTPS, TLS 1.3, dan minimum TLS 1.2. Pada `.TECH Domains`, verifikasi email registrant lalu ganti seluruh nameserver lama dengan hanya:

- `kyree.ns.cloudflare.com`
- `lara.ns.cloudflare.com`

Delegasi nameserver, HTTPS, dan DNSSEC sudah aktif. DS yang terpublikasi di registry adalah:

- Key tag: `2371`
- Algorithm: `13` (`ECDSAP256SHA256`)
- Digest type: `2` (`SHA-256`)
- Digest: `8B3525D5B383068BEFF69233B5851B25E40AA40A0625282FA9DDF0013DF2FAAD`

---

## 📸 QRIS

File awal QRIS **hi-res asli** Brotherstore06 berada di `public/qris/axvara-qris.jpg`. URL aktif disimpan di tabel `payment_methods`; admin dapat menggantinya melalui bagian **Pembayaran** dan upload R2 tanpa perubahan frontend.

---

## 🔐 Admin Demo

- URL: `/admin`
- Credentials: set via Cloudflare Pages environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD_SHA256` dalam format PBKDF2); satu pasang quote pembungkus dari paste shell/JSON didukung dan dinormalisasi server-side. Untuk PBKDF2, browser membuat proof atas challenge 5 menit sehingga Pages tidak melakukan derivasi berat.
- Dev mode: email `admin@axvara.tech` / password `axvara-dev-only`

## 🤖 Agent CMS dan Remote MCP

- Admin memakai sidebar responsif pada `/admin?section=articles` dan `/admin?section=agent`; status sidebar tersimpan lokal.
- Editor visual Tiptap menyimpan **Markdown** sebagai format kanonis agar ringan dan interoperabel dengan agent; artikel JSON Tiptap lama tetap dapat dibaca dan akan dikonversi saat diedit. Slug/excerpt dibuat otomatis server-side.
- Cover artikel/produk menerima drag-and-drop PNG/JPG/WebP, dikonversi browser menjadi WebP 1600×900. Banner dikonversi ke WebP dengan rasio asli dan sisi terpanjang maksimal 1920 px; popup mengikuti rasio portrait/persegi/landscape, memakai `object-contain`, dan hanya muncul di homepage agar tidak menghalangi checkout/admin/status pesanan.
- Daftar pesanan menampilkan bukti sebagai preview card yang dapat dibuka penuh. Bukti kosong, URL tidak valid, dan file R2 yang hilang mempunyai status visual serta keterangan berbeda agar admin tidak salah mengira label tersebut sebagai tombol.
- Buat token Bearer di **Integrasi Agent**. Token mentah hanya muncul sekali dan token tanpa `articles:publish` tidak dapat publish.
- Content API: `/api/agent/context`, `/api/agent/articles`, `/api/agent/media`, `/api/agent/media/import`, dan activity audit. Agent tidak pernah menulis D1/R2 secara langsung.
- Endpoint MCP stateless utama ikut terdeploy bersama Pages. URL client tunggal: `https://axvara.tech/mcp`, transport Streamable HTTP (`POST`) dan header `Authorization: Bearer <token>`. Hostname `pages.dev` tidak boleh dipakai client karena diarahkan ke domain utama.
- Untuk gambar dari generator yang menyediakan URL publik, agent memakai `import_article_image_from_url` agar gambar WebP maksimal 5 MB diambil server-side tanpa base64 panjang. URL sumber wajib HTTPS publik, setiap redirect divalidasi, dan hasil diperiksa melalui content type serta magic bytes sebelum masuk R2.
- Untuk file lokal, path tidak dapat dibaca oleh remote MCP. Agent yang memiliki akses terminal dapat melewati JSON/base64 dan mengunggah multipart langsung: `curl -H "Authorization: Bearer $AXVARA_AGENT_TOKEN" -F "file=@./cover.webp;type=image/webp" -F "kind=cover" https://axvara.tech/api/agent/media`. Token memerlukan scope `media:write` dan tidak boleh ditulis langsung ke prompt/log.
- Worker cron aktif di `https://axvara-mcp.sailinnadia1.workers.dev/mcp` dan memakai `https://axvara.tech` sebagai origin API. Setelah memuat `.cf-credentials`, `npm run deploy:mcp` memakai Global API Key lokal untuk deployment Worker.
- Jadwal artikel disimpan sebagai status `scheduled`. Cron Worker berjalan tiap 5 menit dan memanggil publisher terproteksi; `CRON_SECRET` pada Pages harus sama dengan secret Worker `AXVARA_CRON_SECRET`.

Untuk database D1 yang sudah ada, jalankan migrasi berurutan sekali sebelum deploy setelah memuat `.cf-credentials`: `0002_editorial_agent.sql`, `0003_checkout_integrity.sql`, lalu `0004_categories_newsletter.sql`. Migrasi terakhir menormalkan ikon kategori dan menambahkan tabel pelanggan email.

Next dev otomatis memakai 20 fixture Draft dari `src/lib/article-seeds.ts` saat D1 tidak terikat. `drizzle/seed-articles.local.sql` menyediakan seed idempotent yang bisa dijalankan manual pada D1; proses deploy tidak menjalankannya otomatis.

---

Private — AXVARA © 2026
