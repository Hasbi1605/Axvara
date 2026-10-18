# ARCHITECTURE.md — AXVARA

## Pembaruan Pedia 2026-10-15 — spesifikasi terkini

Revisi konfigurator Pedia 2026-10-16 ✅ implementasi, publikasi melalui CI: `PlatformPageClient` memakai `pediaPlatform` untuk header/kartu kebutuhan tanpa pilihan otomatis; route platform dan deep link order tetap berbagi `OrderClient`. `ServicePicker` menampilkan tiga layanan awal, filter terlipat, perbandingan penuh, serta pilihan aktif ringkas pada semua viewport. `OrderClient` mendekatkan jumlah/target/checklist dalam satu panel, menaruh copy literal escaped di disclosure setelah input, dan menyediakan ringkasan brand dengan rail desktop sticky. `usePediaPrices` existing memasok total jumlah yang sama; harga paket tersimpan hanya fallback untuk jumlah persis yang valid, min/max/step tidak cocok diberi status, harga lain menunggu respons. State quote/consent/lock/retry dan preview embedded tanpa API tetap dipertahankan; tanpa route, schema, env produksi, atau kontrak antar-repo baru.

✅ Implementasi katalog per platform, perluasan dua supplier dan checkout dua tahap tersedia di kode; publikasi melalui push/CI. Spesifikasi serta dasar kurasi lengkap: [Katalog dan checkout Pedia](pedia/catalog-checkout-2026-10-15.md). Bagian berlabel Working-Tree 2026-10-12 di bawah adalah snapshot historis; aturan UI/katalog/checkout terkini mengikuti dokumen rilis ini.

Revisi 2026-10-16: beranda Pedia menampilkan kartu AXVARA Market dan Bot Telegram tepat setelah hero, sebelum katalog platform, pada mobile dan desktop.

Revisi katalog 2026-10-16: teks pengantar di bawah “Pilih platform” dihapus. Pill kategori mengikuti Market (24px mobile/36px mulai `sm`, ikon iOS monokrom, aktif putih/nonaktif glass). Marketplace menampung Shopee, terpisah dari Media sosial. Semua kartu platform memakai logo SVG responsif 48px di mobile/80px mulai `sm` di tengah panel gradasi gelap warna brand seperti GitHub/Website Traffic, membedakan visual Pedia dari tile 3D Market. Berlaku di beranda dan `/pedia/layanan`; gambar legacy R2 di kontrak produk tidak dipakai oleh `PlatformCatalog`.

Revisi skala 2026-10-16 ✅ implementasi, publikasi melalui CI: hero Pedia mengikuti skala Market dengan headline mobile `clamp(32px,9.3vw,40px)` (sekitar 36px pada 390px), tablet 56px dan laptop/desktop `clamp(48px,4.85vw,62px)` agar kolom orbit tetap muat. Container tetap 1280px; padding hero 40/56px atas dan 16px bawah, CTA berjarak 24px dari subjudul, promo tepat sesudah hero dan katalog ber-padding atas 8px. Katalog platform beranda serta `/pedia/layanan` memakai panel 4:3, grid dua kolom sampai tablet/empat mulai 1024px, gap 12px mobile/20px mulai `sm`, radius kartu 16/22px, judul 16/18px dan deskripsi/CTA 12/14px. Orbit tetap hanya desktop; ukuran SVG memakai `PlatformIcon.className` opsional, tanpa perubahan kontrak API, aset atau env produksi.

Revisi animasi desktop 2026-10-16 ✅ implementasi, publikasi melalui CI: layout Pedia memakai `Spotlight` yang sama dengan Market (glow putih/cyan mengikuti cursor), dan beranda Pedia memakai `ScrollRope` yang sama (panjang mengikuti progres scroll, ayunan saat hover/klik). Hook bersama `useDesktopMotion` mengaktifkan keduanya hanya pada lebar ≥768px, `pointer: fine`, `hover: hover` dan tanpa reduced motion. Perubahan media query saat halaman terbuka langsung memperbarui efek; saat nonaktif, kedua dekorasi disembunyikan, listener interaksi/frame dibersihkan dan klik/hover tali tidak dapat menjalankan animasi. Tali tetap khusus beranda; efek menggunakan pembaruan berbasis interaksi dan berhenti setelah ayunan mereda. Perbaikan guard komponen bersama juga berlaku di Market, tanpa env/aset/kontrak API baru. Revisi lapisan 2026-10-16: tali bersama berada pada `z-30`, di belakang navbar sticky `z-50` dan overlay navigasi `z-40`, pada Pedia maupun Market; pangkal tali tertutup navbar, sedangkan bagian di bawahnya tetap mengikuti scroll dan merespons interaksi.

Revisi copy hero 2026-10-16 ✅ implementasi, publikasi melalui CI: headline beranda Pedia menjadi “Satu tempat untuk / optimasi media sosial”, dengan typewriter cyan Termurah / Termudah / Terpercaya tetap. Baris pendukung di bawah CTA persis “Order cepat tanpa login • Garansi refill • Support WA admin”. Ini perubahan copy atas permintaan owner; kelayakan, masa dan ketentuan refill tetap mengikuti layanan/paket yang dipilih, tanpa perubahan kontrak checkout atau supplier.

Revisi navbar dan lacak 2026-10-16 ✅ implementasi, publikasi melalui CI: hierarki navbar Pedia mengikuti Market: logo → pencarian → Layanan AXVARA → Katalog → Lacak Pesanan → Artikel. Navigasi teks tampil mulai `xl`, dengan pill hover/focus membulat; Artikel menuju URL absolut Market dari `SITE.webUrl`, menggantikan Bantuan di navbar atas. Bantuan tetap tersedia di bottom nav dan footer. `/pedia/lacak` memakai header, kartu form glass, label/hint, tombol loading dan FAQ dengan gaya Market; verifikasi kode AXP + WA/email tetap melalui `POST /api/orders/lookup`, lalu membuka halaman status Pedia setelah berhasil. Riwayat sukses maksimal lima tersimpan lokal di `axp-track-recent` dengan kontak tersamarkan pada UI dan tombol hapus; daftar `axp-orders` maksimal 20 terlipat awal, menyaring entri rusak dan dapat disembunyikan per pesanan. Penyimpanan browser opsional; validasi, timeout jaringan dan penjagaan klik ganda tidak mengubah kontrak server atau supplier. Revisi lanjutan 2026-10-16: pill “WA Admin” dan “Panduan pemesanan” di bawah FAQ lacak dihapus; halaman berakhir pada FAQ sebelum footer bersama.

Katalog terkurasi berisi 38 jenis/131 mapping pada 16 platform, dengan 3 pilihan awal pada mobile/desktop, drop/refill tetap. Pilihan yang sudah dipilih dirangkum dan dapat diganti pada semua ukuran. Target GitHub/website/platform baru didukung parser client/server. Harga jumlah bebas dihitung server; order/job/kredit/ledger atomik D1, retry QR sama, kredit pending kedaluwarsa dikembalikan. Copy ketentuan disimpan ke quote/order. Tidak ada order supplier berbayar atau klaim hasil kualitas/drop teruji dalam verifikasi ini.

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
│   ├── fonts/                   # Variable fonts self-hosted (2026-10-12): inter/space-grotesk/jetbrains-mono latin .woff2 via next/font/local — tanpa fetch Google saat build
│   ├── qris/README.md           # tidak ada QRIS statis publik
│   └── logo/
│       └── axvara-wordmark.svg
├── src/app/                     # Next.js App Router
│   ├── layout.tsx               # ROOT MINIMAL (2026-10-08, PEDIA §9.2): font + metadata global SAJA. TANPA chrome toko/Pedia — keduanya di layout masing-masing di bawah agar tidak saling mewarisi.
│   ├── (shop)/                  # Toko pusat axvara.tech (route group — URL tidak berubah)
│   │   ├── layout.tsx           # Chrome toko (Navbar/Footer/CartDrawer/MobileBottomNav/dll) + metadata OG toko
│   │   ├── page.tsx             # Homepage (server, edge): muat katalog D1 via handler GET /api/products → HomeClient + JSON-LD Organization/WebSite/ItemList (2026-09-24)
│   │   ├── home-client.tsx      # Homepage interaktif (kategori, cari, load more); `initialProducts` dari server, fallback fetch
│   │   ├── artikel/[slug]/      # Artikel publik Markdown/legacy JSON
│   │   ├── cara-order/          # Panduan order
│   │   ├── garansi-replace/     # Ketentuan layanan & garansi third-party (acuan klaim, garansi ikut deskripsi produk)
│   │   ├── produk/[slug]/       # PDP: server component SEO (metadata/JSON-LD/h1 D1) + client interaktif
│   │   │   ├── checkout/        # Checkout revamp ala Sekalipay 2026-09-23 — ① Metode (QRIS auto-select) → ② Data minimal WA+Email wajib tanpa Nama (fallback prefix email) → S&K → 1 CTA; rail kanan DESKTOP ONLY (hidden lg:block, ringkasan+S&K+CTA), mobile accordion ringkasan + S&K kiri + sticky CTA; 1 handler submit
│   │   ├── pesanan/[code]/      # Status + QRIS dinamis + polling lunas (dari checkout); pesanan/layout.tsx = noindex
│   │   ├── lacak-pesanan/       # Lacak mandiri kode + No. WA/email via POST /api/orders/lookup + timeline + auto-refresh
│   │   ├── link/                # Link-in-bio pengganti Linktree (bio IG): 6 tombol + share, tanpa chrome global
│   │   ├── admin/
│   │   │   └── page.tsx         # Shell + modul admin berbasis query section
│   │   ├── mcp/route.ts         # MCP HTTP katalog toko
│   │   └── r2/[...key]/route.ts # R2 publik catch-all
│   ├── pedia/                   # Axvara Pedia pedia.axvara.tech (2026-10-08, PEDIA-PRD; spesifikasi: docs/PEDIA-PRD.md, docs/PEDIA-DESIGN.md)
│   │   ├── layout.tsx           # .pedia-root + Spotlight bersama + PediaNavbar + PediaBottomNav + Footer bersama; bukan Navbar/keranjang Market; <main> polos 1:1 Market (2026-10-12, tanpa max-width/padding — tiap halaman mengatur container sendiri: katalog 1280px, lacak 720px)
│   │   ├── page.tsx + home-client.tsx  # Working-tree lokal 2026-10-12, belum deployed: featured/fallback, semua/cari/platform, Typewriter + CTA Lihat Layanan/Hubungi Admin + trust strip + promo Market (kartu Cari lewat link dihapus dari beranda), + FAQ, tanpa ticker
│   │   ├── p/[platform]/        # Layanan per platform (8): filter jenis + grid ProductCard
│   │   ├── o/[slug]/            # Deep link konfigurator bersama platform; layanan/qty null, dua tahap, quote+consent, retry token sama
│   │   ├── pesanan/[code]/      # Status: QRIS lunas / ring+timeline/refill/kartu kredit/needs_check + auto-refresh
│   │   ├── lacak/               # Form glass kode AXP + kontak (lookupPediaOrder) → status; axp-track-recent (5), axp-orders (20) terlipat, FAQ
│   │   └── bantuan/ + ketentuan/ + layanan/  # Bantuan (3 grup), S&K 7 poin, semua layanan
│   ├── llms.txt/route.ts        # GEO: profil toko + produk yang bisa dibeli (markdown, cache 10 mnt)
│   ├── robots.ts / sitemap.ts   # robots: tutup /admin, /api/ (kecuali 3 endpoint baca publik), /checkout, /pesanan/; crawler AI eksplisit
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
│   │   │   └── auth/
│   │   ├── pedia/               # API Pedia (docs/PEDIA-PRD.md §9.7): catalog/ticker/quote/orders/[code]+refill/credits/check, lookup di orders/lookup, admin pedia/*
│   └── globals.css
├── src/components/
│   ├── ui/                      # Button, Input, Badge, Modal, Drawer, Toast,
│   │                            # NavigationProgress (bar + skeleton rute + pil koneksi lambat)
│   ├── storefront/              # Navbar, Hero, ProductCard, CartDrawer, CheckoutForm, QrisDisplay,
│   │                            # MobileBottomNav (Beranda · Kategori · Pesanan · Bantuan) + HelpSheet + CategorySheet,
│   │                            # DeviceOrders ("Pesanan di perangkat ini" di /lacak-pesanan),
│   │                            # QuickVariantModal (beli cepat + mode select untuk PDP mobile),
│   │                            # ProductCopy (deskripsi + S&K + cara aktivasi PDP, panel lipat mobile),
│   │                            # Skeletons (satu bentuk skeleton per halaman: overlay navigasi + loading halaman)
│   └── admin/                   # Shell, login gate, hooks (useAdminAuth/useProductManager),
│       └── sections/            # satu komponen per section admin (page.tsx tinggal shell + routing)
│       └── PediaManager.tsx     # 5 panel: Produk/Layanan Supplier/Pesanan/Kredit/Pengaturan; daftar ringkas + editor produk/tingkat terpisah
│   ├── shared/                  # ServicesMenu + CrossServicePromo (Market/Pedia; URL src/lib/site.ts)
│   ├── pedia/                   # PediaNavbar (client + field cari pill ala Market via usePediaSearch), PediaBottomNav, Typewriter, LinkPasteHero (komponen hidup, tak dipakai beranda sejak 2026-10-12), PlatformGrid, PediaOrbit (kembar OrbitHero: 8 sosmed + inti mark Pedia), PediaServiceCards (Market + Bot Telegram), PediaWhatsAppLink (CTA Hubungi Admin → hub /wa), OrderTicker (tidak dirender), StatusWidgets
├── src/hooks/
│   ├── useDesktopMotion.ts      # Media query dinamis ≥768px/fine/hover/tanpa reduced motion; shared Spotlight/ScrollRope
│   ├── useModalA11y.ts          # Escape + focus trap + scroll lock + restore fokus — SATU
│                                # implementasi untuk CartDrawer, PopupBanner, QuickVariantModal.
│                                # Sebelumnya disalin manual sehingga a11y tiap modal berbeda.
│   ├── useLoadingStage.ts       # tahap tunggu (8 dtk lambat, 20 dtk macet) untuk label bertahap
│   └── usePendingNavigation.ts  # router.push + status pending tombol CTA sampai rute tujuan tampil
├── src/lib/
│   ├── local-orders.ts          # salinan lokal pesanan perangkat ini (localStorage axvara-orders,
│   │                            # tanpa WA/email): pengingat, titik tab Pesanan, DeviceOrders
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
│   │   ├── messages/            # format, catalog (detail ringkas; detail varian di keyboard), purchase, status, group, help, admin
│   │   └── handlers/            # command, callback (guard ownerBound), catalog, discovery,
│   │                            # orders, invoice, cart, cart-invoice, shared
│   ├── whatsapp/
│   │   ├── gateway.ts           # auth timing-safe + isPrivateIp (kontrol SSRF)
│   │   └── handlers/            # catalog, payment, proof, admin, shared
│   ├── r2.ts                    # R2 client (S3 API)
│   ├── product-copy/            # Salinan produk PDP (2026-09-24): text (pembersih teks pemasok +
│   │                            # sidik jari), format (parser deskripsi + fallback, aman client),
│   │                            # curated (S&K/aktivasi versi Axvara, SERVER-ONLY), resolve
│   │                            # (dipakai /api/catalog; jangan impor dari catalog.ts/komponen)
│   ├── config.ts                # payment methods, site config
│   ├── fetch-timeout.ts         # fetchWithTimeout + FetchTimeoutError (fetch browser tak punya batas waktu)
│   ├── utils.ts                 # formatRupiah, generateOrderCode
│   ├── pedia/                   # Lib Pedia: quote JWE+legacy/pricing, link (deteksi+mask), proxy router ProviderSMM/IndoSMM via VPS,
│   │                            # dispatch (job+poll), credits (PDK-), notify/email (Email B), seed (9 produk/27 jasa/39 tingkat), lookup (PD-13)
├── stores/
│   ├── cart.ts                  # Zustand cart store (localStorage) — badge/judul pakai lineCount() = jumlah baris varian (2026-09-19); count() sum-qty hanya untuk subtotal
│   ├── navigation.ts            # status navigasi sejak klik sampai pathname berubah (dibaca NavigationProgress)
│   ├── search.ts                # Zustand query search navbar Market (dibaca katalog Market)
│   └── pedia-search.ts          # Zustand query search navbar Pedia 1:1 Market (2026-10-12; dibaca home-client + scroll ke #pedia-catalog)
├── drizzle/                     # atau raw SQL — schema D1
└── wrangler.json                # Cloudflare bindings + Pages output
```

### 3.0 Aturan modul (pasca refactor)

**Pedia working-tree 2026-10-12: implementasi lokal, BELUM deployed; tidak ada flag diubah.** Menggantikan spec overhaul 2026-10-11; riwayat QA/deploy lama bukan bukti diff ini live. Schema 0059 sudah memiliki identitas supplier gabungan/status submitting/featured, tidak ada migrasi baru untuk perubahan ini. Detail UI: `docs/PEDIA-DESIGN.md`; kontrak/gate: `docs/PEDIA-PRD.md` dan §16.10.

- `GET /api/pedia/catalog` cache 60 detik, tanpa identitas/rate/nama/order supplier publik. Tier aktif wajib `providersmm|indosmm`, layanan `present=1`, tipe `Default`, rate positif dan min/max valid; harga finite positif, jumlah dalam batas/paket/step. Tier tanpa paket valid dan produk tanpa paket tersedia dihilangkan. Key bounds `(supplier,service_id)`; min/max boleh publik. Endpoint katalog memakai data D1 tersimpan, bukan live probe gate IndoSMM per request.
- Server meneruskan seluruh katalog; client awal maks 8 featured atau fallback 6 Jelajahi layanan tanpa klaim laris. Cari/filter/Tampilkan semua menjangkau semua produk terbit. `catalogCard()` memasangkan harga/jumlah/tier/refill dari satu paket; tagline TIDAK dirender di kartu/detail sejak 2026-10-12 (hapus AI slop; field tetap di DB/admin). `description_md` adalah field katalog publik opsional (`string|null`), ditampilkan pada detail/order sebagai teks literal escaped dengan newline dipertahankan, bukan render Markdown/HTML; tidak ditambahi link-helper teknis. `ServicesMenu`/`CrossServicePromo` memakai `AXVARA_SERVICES` di site.ts; URL absolut, UTM promo, komunitas satu sumber. Kedua layout memakai satu `Footer` dengan newsletter dan bantuan kedua host; AppSwitcher dihapus, bukan disimpan. Revisi footer 2026-10-15 (implementasi; publikasi CI): navigasi Layanan AXVARA berasal dari `AXVARA_SERVICES`, tanpa kategori/tautan Semua produk/artikel dan tanpa fetch `/api/categories`. Ikon WhatsApp sesudah Facebook memakai SVG `currentColor` satu tone dengan sosial lainnya dan URL absolut `${SITE.webUrl}${waHubLink()}` (pesan default Halo AXVARA); teks chat/jam layanan dihapus. Pill Grup WA/Bot Order Telegram di bawah ikon memakai `WA_GROUP_HREF`/`TG_BOT_HREF` dan aset brand lokal; bot tetap kanal Market. Navigasi layanan/bantuan dua kolom di mobile, empat kolom utama di desktop; form subscriber tetap same-origin.
- `OrderClient` tier/jumlah awal null, radio native, paket-only; pergantian tier yang tak mendukung jumlah mereset quantity null. Satu CTA per viewport meminta quote (25 detik), lalu order (60 detik) jika total sama dan tanpa kredit. Total berubah atau input kredit menghentikan langkah sebelum order dan meminta Setujui & lanjut ke pembayaran. Perubahan input membatalkan quote/respons lama; quote server 30 menit, client refresh 29 menit sebelum percobaan pertama.
- Ref in-flight mencegah klik ganda; percobaan order mengunci data. Ambigu/network/5xx serta 408/429 mempertahankan token/kontak untuk retry, 4xx lain membuka kunci/membuang quote. Ini pagar client, **bukan atomisitas penuh order/kredit/invoice**. Order tutup hanya pesan dekat CTA disabled, kontak/kredit/S&K tidak dirender, tanpa banner berulang di hero/judul.
- Admin GET produk menyertakan `live_type/rate/min/max/present` untuk readiness. ID admin wajib desimal positif kanonik, tanpa nol awal/notasi eksponen/pecahan. PUT parsial memvalidasi hanya field yang dikirim tanpa mereset field lain; paket wajib bilangan positif sesuai `step`, checklist berupa array objek `id/label` dengan ID unik setelah trim dan field bantuan opsional bertipe string. Edit tier atau paket/step produk langsung menghitung ulang harga tersimpan pada tier terdampak; harga derived tidak dapat diedit lewat PUT. Supplier hilang tidak dihidupkan ulang: harga dikosongkan dan tier `present=0` dinonaktifkan. **Simpan dan reprice berurutan, tidak atomik:** `500 reprice_failed` berarti edit sudah tersimpan tetapi harga mungkin belum seluruhnya diperbarui. Guard margin menyimpan penonaktifan sebelum harga baru agar replay setelah kegagalan tidak melewati pemeriksaan harga lama.
- GET admin gagal mengembalikan `500 load_failed`, bukan daftar kosong sukses; PUT/recovery gagal memberi `save_failed`, UI menampilkan feedback + Muat ulang, dan resync dengan `errors` dianggap berhasil sebagian. `mark_submitted/resubmit` memeriksa hasil update berpagar status (race → 409); resubmit dan cancel+kredit mewajibkan `confirm=true`. Konfirmasi UI recovery berupa form; ConfirmDialog dipakai untuk resync, kredit manual, pengaturan, bukan semua edit.
- Pengaturan disimpan ke `store_settings`, default valid + riwayat saldo 7 hari + overview per-provider saldo live/cache/error; bukan bulk override tingkat atau saldo live header global. Jalur reprice/quote/order masih membaca `PEDIA_MIN_ORDER_RP` dari env, field minimum tersimpan belum menggantikannya; ambang cron masih env. Tidak ada kontrak konsumsi default oleh seluruh jalur harga.
- Admin sekarang punya create produk/tingkat nonaktif, filter supplier/kompatibilitas/mapping, pilihan provider+service berpasangan, preview storefront tersimpan terpenuhi, API refill terpisah dari masa kurasi. `PediaManager` membentuk `PediaCatalogProduct` dari produk/tier tersimpan dan paket layak, termasuk tingkat nonaktif untuk kurasi; memakai `ProductCard`/`catalogCard` aktual + `OrderClient` embedded dalam mode preview aman. Draf tetap privat, tidak membuka route publik; navigasi kartu dicegah, pemesanan disabled, interaksi preview tidak memanggil API quote/order. Mobile CTA inline, bukan fixed; tautan kembali tidak dirender. Save/reload memperbarui preview; input belum disimpan tidak ikut, unsaved live preview di luar scope. Pengaturan menyajikan overview saldo live/cache/error/pricing/sync per provider, bukan header global. `mark_submitted` memverifikasi status/ID desimal positif kanonik pada provider asal dan konflik; `resubmit/cancel_credit` hanya sebelum `submit_attempts>0` atau supplier ID ada, bukan retry buta setelah timeout.

Route API dan modul besar dipecah per domain, tetapi **path publik lama dipertahankan sebagai
barrel** (`src/lib/db.ts`, `src/lib/fulfillment/deliver.ts`, `src/lib/telegram/messages.ts`).
Impor dari barrel, bukan dari file internal di dalam foldernya — itu yang menjaga satu titik
perubahan bila struktur internal digeser lagi. Handler webhook tidak boleh dipanggil langsung dari
`route.ts`: Telegram hanya mengekspos `handleCommand`/`handleCallback` supaya guard kepemilikan
`ownerBound` tidak bisa dilewati.

Pada admin, `onUnauthorized` bergantung pada setter `setAuthed` yang stabil, bukan objek hasil `useAdminAuth`. Dengan demikian `load` tetap stabil dan effect pemuatan tidak berulang setiap render; test komponen memeriksa jumlah request sesudah autentikasi dan perpindahan menu.

Katalog Telegram memakai presenter dua tingkat tanpa state baru: `catalog.ts`
merender ringkasan produk, sedangkan `keyboards.ts::variantsKeyboard` membawa
nama/durasi/garansi/harga ke callback `var:{variantId}` yang sudah ada. Varian
habis tetap terlihat sebagai informasi, tetapi dipindahkan ke akhir dan memakai
`noop`; validasi stok/minimum/ownership server pada handler quantity dan invoice
tetap menjadi otoritas transaksi.

### 3.1 Runtime performa storefront

- `OrbitHero` hanya satu instance untuk desktop/mobile, memutakhirkan DOM lewat refs, memakai 30 fps untuk auto-rotate dan refresh-rate penuh saat drag/inertia, menghormati reduced motion, serta menghentikan rAF ketika hero offscreen/tab tersembunyi. Drag hanya aktif untuk `(pointer: fine)`; layar sentuh memakai `touch-action: pan-y` dan tidak menangkap swipe vertikal. Hemat mobile 2026-09-29 (laporan owner HP lag): hot path compositor-only (transform + opacity) — tanpa filter/blur/backdrop-filter/display per frame; mobile (coarse/≤640px) 8 planet + tanpa trail/label dinamis/shadow dinamis/star-dust + 24fps; glow hero cyan 44px (gold mati) di mobile. Dikunci tests/orbit-mobile-perf.regression.test.ts.
- `ScrollRope` dan `Spotlight` event-driven; tidak mempertahankan loop idle. ScrollRope tidak memasang listener pada viewport mobile.
- Kartu berulang memakai `ax-glass-card` tanpa `backdrop-filter`; blur penuh dipertahankan untuk navbar, drawer, modal, dan overlay.
- Homepage/detail merender skeleton sampai respons D1 tersedia. Seed produk hanya menjadi database in-memory saat development dan tidak pernah dipakai sebagai fallback UI produksi.
- **Umpan balik jaringan lambat (2026-09-24, PR loading storefront).** Route dinamis (`/`, `/produk/[slug]`, `/artikel*`, `/pesanan/[code]`) tidak di-prefetch dan App Router menunggu respons server SEBELUM URL berubah, jadi dulu halaman lama diam total setelah klik (`RouteLoading` lama baru menyala setelah halaman baru tampil). Kini `NavigationProgress` (layout root) menangkap klik `<a>`/`<Link>` internal di fase capture + `startNavigation()` untuk `router.push`, lalu setelah 120 ms menampilkan bar cyan yang merayap + skeleton rute tujuan (`Skeletons.tsx`, `fixed` di bawah navbar, z-35 agar tombol CTA pending di halaman lama tetap terlihat); 8 dtk → pil "Koneksi lambat", 20 dtk → "Coba lagi" (navigasi keras ke URL tujuan) / "Batal". Selesai saat pathname/search berubah. **Sengaja tanpa `loading.tsx`:** boundary Suspense membuat respons awal streaming, sehingga `notFound()` produk/artikel nonaktif menjadi 200 + noindex (Next 15.5 tanpa PPR juga streaming untuk bot) dan katalog SSR berpindah ke `<div hidden>` di akhir HTML. `/produk/tidak-ada` tetap 404.
- PDP (`produk/[slug]/page.tsx`) memanggil handler `/api/products?slug=` + `/api/catalog?slug=` di server (pola beranda) dan mengoper `initialProducts`/`initialCatalog` ke client: PDP tampil lengkap dari satu respons navigasi, tanpa skeleton kedua + dua round-trip klien. Gagal = undefined → client fetch seperti dulu (h1 sr-only hanya dirender pada jalur cadangan ini agar tidak ada h1 ganda).
- Fetch storefront memakai `fetchWithTimeout` (quote 25 dtk, `POST /api/orders` 60 dtk, lookup/pesanan/varian 20–25 dtk) sehingga permintaan menggantung berakhir dengan pesan + "Coba lagi", bukan spinner selamanya. Polling `/pesanan/[code]` melewati tick bila permintaan sebelumnya belum selesai.
- Cache publik ditetapkan langsung oleh Edge handler: produk aktif 30 detik, kategori/banner aktif 60 detik. Respons admin atau varian produk non-eksplisit tetap `private, no-store`. **Pengecualian PDP by-slug (2026-10-02, insiden Head 18 Bulan):** `GET /api/catalog?slug=` = `s-maxage=10, SWR 30` dan `GET /api/products?active=1&slug=` = `max-age=10, s-maxage=10, SWR 30` — daftar katalog tetap 30 detik, hanya halaman produk yang 10 detik agar angka stok segar tepat setelah ada yang beli.
- Middleware hanya menambahkan `unsafe-eval` pada CSP saat `NODE_ENV=development`, karena React Refresh membutuhkannya. Header production tetap ketat.
- **Optimasi LCP/Speed Index mobile beranda (2026-10-06, PageSpeed mobile 85 vs desktop 99 — LCP 3,9 dtk, SI 4,5 dtk).** 4 kartu pertama `loading=eager + fetchPriority=high` (Next otomatis menerbitkan 4 preload `imageSrcSet` responsif — LCP tidak antre lazy queue), kartu 5+ tetap lazy; kartu ke-9+ `content-visibility:auto + containIntrinsicSize: auto 420px` (browser melewatkan layout/paint kartu jauh); animasi OrbitHero mobile (lite/coarse/≤640px) ditunda via `requestIdleCallback` (timeout 2,5 dtk, fallback 1,2 dtk) agar thread utama fokus ke paint pertama — desktop + reduced-motion tidak berubah; font JetBrains Mono `preload:false` (hanya kode pesanan/timer QRIS, bukan critical path) — Inter + Space Grotesk tetap preload. Dikunci `tests/storefront-catalog-ux.behavior.test.tsx` (+2), `tests/orbit-mobile-perf.regression.test.ts` (+1), `tests/home-ssr-catalog.behavior.test.tsx`.

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
  expires_at TEXT,                 -- QRIS 15 menit SEMUA kanal (keputusan owner 2026-10-11; dulu Telegram/Web 60 menit); manual 24 jam.
                                   -- Ditulis ISO UTC, BUKAN datetime('now',...) yang formatnya
                                   -- spasi dan ditafsirkan Date.parse sebagai waktu lokal.
  qris_reissue_count INTEGER NOT NULL DEFAULT 0, -- migrasi 0024; batas MAX_QRIS_REISSUES = 1 (reissue tetap didukung bila order masih hidup <15 menit)
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
| GET | /api/products | List produk (filter category, search, active). Daftar `active=1` MENAMPILKAN produk habis di akhir (`soldOut: true`, urutan ready → habis → nonaktif, kontrak 2026-10-01). Permintaan katalog admin juga menerima `lowStockVariants` per produk = jumlah varian aktif berstok 0–5, satuan yang sama dengan `low_stock` di `/api/admin/overview`, PLUS `liveStatus`/`liveReason` per produk (admin-only: live/hidden_soldout/loser/off + sebab) + array `pairs` ringkas untuk resolver pecundang | - |
| POST | /api/products/reorder | Geser produk TEPAT satu posisi dalam bucket status (kanonis `src/lib/product-order.ts`). Bila arah melewati batas halaman admin saat ini → respons sertakan `newPage` agar hook pindah halaman mengikuti produk (2026-10-01). Untuk lompat jauh (30→1) pakai field angka Urutan, bukan ↑↓ | - |
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
| POST | /api/orders/lookup | Lacak mandiri: verifikasi pasangan kode + WA (normalisasi 08/+62/62, constant-time) atau email checkout (cocok penuh, huruf kecil; sejak 2026-09-25, field `contact`, field `wa` lama tetap diterima, helper `src/lib/order-contact.ts`), 404 generik anti-enumerasi, WA/email mask, rate-limit `orders:lookup` | - |
| GET | /api/orders?code= | Cek status pesanan via code. WA/email dimask; flag boolean dari satu query gabungan (hanya order `lunas`): `credentials_ready` = detail akun (WR atau isi produk non-WR) sudah siap diambil sehingga storefront tahu kapan panel retrieval boleh tampil, `queued_delivery` = ada baris antrean (Made By Order), `instant_delivery` (2026-09-25) = SEMUA baris dikirim dari stok sendiri (varian non-WR `shared`/`unique`) sehingga halaman memeriksa rapat; `supplier_owned`/`supplier_running` (2026-10-13) = order milik pipeline WR/SK dan linknya masih berjalan — halaman menampilkan skeleton menyiapkan + poll rapat yang memicu tarikan status vendor (gerbang 20 dtk/order di `store_settings`), tanpa pernah menampilkan kalimat stok/admin untuk order supplier; plus `fulfillment_status` | - |
| GET | /api/orders/:code | Kembaran segmen dari `?code=` untuk halaman pesanan yang sama. **Invarian (audit 2026-09-20): isinya WAJIB sepadan — `proof_url` TIDAK pernah ikut di kedua endpoint.** Nilai itu adalah kunci objek R2 privat yang hanya boleh dibaca admin lewat `/api/admin/bukti/*`; membocorkannya memberi penebak kode order nama berkas bukti bayar milik orang lain. Dikunci `tests/audit-2026-09-20.regression.test.ts` | - |
| GET | /api/payments/qris/:code/image | Render PNG QRIS dinamis untuk invoice aktif | code order |
| POST | /api/payments/qris/:code/reissue | Terbitkan QRIS baru untuk order yang masih hidup tetapi QR-nya sudah kedaluwarsa (<15 menit). Hanya boleh saat invoice lama SUDAH mati — syarat itulah yang mencegah pemegang kode order lain membatalkan QR yang sedang dipakai. Maks 1x/order, rate limit 5/menit/IP | code order |
| POST | /api/orders/[code]/cancel | Batal mandiri pembeli (2026-10-11): verifikasi kode + WA/email checkout pola lookup (404 generik), hanya pending+unpaid, CAS `transitionPendingOrder` (kalah race vs webhook = 409), stok kembali detik itu juga; tombol di `/pesanan/[code]` + `/lacak-pesanan` | kontak checkout |
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
- `PopupBanner` hanya fetch/render pada pathname homepage (`/`), sehingga promosi tidak menghalangi checkout, status pesanan, detail produk, atau workflow admin. Checkbox kecil "Jangan tampilkan lagi" di bawah banner menyimpan penanda `axvara-banner-<id>-hide-until` di localStorage selama 24 jam (per banner id; uncheck menghapus penanda).
- Bukti pembayaran tetap privat melalui `/api/admin/bukti/:key`; UI membedakan belum diunggah, URL tidak valid, file R2 hilang, dan preview tersedia.
- Kategori D1 menjadi sumber tunggal kapsul katalog dan menu Jelajah footer. Nama, ikon, serta `sort_order` dapat diedit; slug tetap stabil ketika nama berubah, dan penghapusan ditolak selama kategori masih dipakai produk. Taksonomi 2026-09-28 (migrasi 0046): AI & Chatbot, Streaming & Hiburan, Produktivitas & Office, Desain & Video, Developer & Tools, Bundle Hemat — slug lama (`ai-gateway`, `akun-premium`, `tools-pro`) dialias di kode (`LEGACY_CATEGORY_SLUG_ALIASES`) agar filter lama tidak 404. Daftar produk admin punya kolom Urutan + tombol ↑↓ per baris + field angka Urutan tampil 0–999999 di modal edit. Reorder 2026-09-29 (fix laporan owner "semua 0, ↑↓ diam + refresh"): geser delta ±1 dari baseline tetangga global via SATU PUT `/api/products/[id]` (tetangga tak disentuh; tetap gerak walau baseline kembar 0 — swap 0↔0 tidak mengubah `ORDER BY sort_order,id`), sukses tanpa fetch ulang (realtime, halaman/scroll/focus utuh, rollback saat gagal), migrasi 0047 backfill 0→unik mengikuti id (idempoten, nilai admin utuh). Urutan tampil admin (`filtered`: aktif → ready → sortOrder → id) dicerminkan storefront (`home-client`, minus cabang aktif karena katalog publik hanya aktif). Display 2026-09-29: kolom Urutan memajang nomor posisi 1..N (pos+1, selalu rapi), bukan raw sort_order — raw adalah kunci teknis yang boleh kembar/lompat (delta geser, backfill parsial, edit manual) dan hanya tampil di tooltip + hint modal edit. Exact-step 2026-09-29 (laporan owner: ↑↓ skip 2–3 posisi + modal ≠ tabel): satu-satunya jalur reorder = POST /api/products/reorder — server baca urutan kanonis (`src/lib/product-order.ts`, dipakai juga home-client + hook + tombol), tukar tepat satu tetangga se-bucket status (aktif-ready / aktif-habis / nonaktif tidak saling melewati; batas = 409 + tombol mati + tooltip jujur), lalu normalisasi seluruh key 10,20,30… dalam satu batch D1 atomik (tiap klik = tepat 1 posisi); response kembalikan key final → hook realtime tanpa fetch ulang; modal read-only displayPosition (Simpan tidak kirim kunci posisi); produk baru (`POST /api/products` tanpa sortOrder) dan sync WR dialokasikan MAX+10 (masuk akhir, tanpa tabrakan); migrasi 0048 normalisasi key kembar produksi → unik 10,20,30… (urutan tampil dipertahankan, idempoten). Anti-429 + lompat 2026-09-29 (laporan owner: 429 saat ↑↓ + 30→1 harus 29× klik): BUKAN kuota cron — bucket `products:write` 20/mnt berbagi dengan simpan produk + tiap klik tulis ulang 51 baris. Kini scope `products:reorder` 120/mnt + hanya baris berubah yang ditulis; badge posisi = input ketik (Enter = `targetPosition` 1 request, dijepit ke bucket + `clamped`);   request client antre berurutan (tanpa race, 429 jujur tanpa reset posisi). Selip restok 2026-10-02 (laporan owner: Netflix/Capcut posisi 6/8 habis → restok terdampar 20+): saat sync mendeteksi transisi agregat parent 0→ready, `sort_order` diselipkan kembali via `reinsertionKey()` (fungsi murni `product-order.ts`: belakang jangkar ≤ key lama, maju sampai slot longgar, hormati key tetangga habis/pecundang) + helper `restock-reinsert.ts` (`maybeReinsertRestockedProduct`: 2 query + 1 write HANYA saat transisi; tanpa write bila slot kosong) — hook di loop WR + SK setelah batch per produk (budget-guarded, best-effort, tanpa migrasi).
- Email form footer dinormalisasi lowercase, dideduplikasi oleh unique index, dibatasi per IP, dan hanya dapat dibaca melalui panel/API admin terautentikasi.
- Sidebar admin dikelompokkan menurut pekerjaan. `AdminOverview` menjadi action center; `OrdersManager` memegang filter/pagination/detail; `PaymentReconciliation` hanya menampilkan metadata event aman, bukan payload mentah atau secret.
- Ikon admin memakai `IosIcon` (Icons8 iOS 11 Glyph PNG lokal di `public/icons/ios11/`, tint via CSS filter) dengan prinsip hemat: ikon hanya untuk aksi nyata (tambah, simpan, hapus, tutup, cari) dan pesan status (error/sukses), bukan dekorasi label/statistik. Badge `ChannelBadge`/`StatusBadge`/`MethodBadge` adalah teks + warna (tanpa ikon). Dialog memakai judul + tombol tutup saja (tanpa header-ikon), backdrop `bg-black/60` + blur, radius `rounded-2xl` (konfirmasi) / `rounded-3xl` (form), dan rhythm root `mt-4` + `space-y-4` agar tidak terlihat AI slop.
- Bukti QRIS adalah referensi visual saja. Tombol approval manual tidak dirender untuk order QRIS; pencocokan ulang tetap menuntut satu invoice DANA aktif dengan nominal persis.
- Editor varian memakai form-card responsif dengan CTA eksplisit dan menyimpan inventory fulfillment per SKU. Dialog mengunci body, mendukung Escape, dan meminta konfirmasi sebelum membuang perubahan. Sejak 2026-09-28 mode single/non-varian (toggle OFF) paritas penuh: Min. Beli + Masa Garansi + Cara Pengiriman + Template pesan memakai blok yang sama (`SingleVariantFields`, `WarrantyFields` bersama) dan selalu disimpan sebagai 1 varian `Default` eksplisit (SKU `DEFAULT-*`, update in-place via id — bukan insert baru, karena stok fulfillment keyed by variant_id); toggle ON↔OFF menyalin nilai dua arah agar tidak reset.
- Angka Terjual bisa diedit admin (2026-09-29): kolom Terjual di tabel (ketik + Enter → PATCH `/api/products/[id]/sold-count`, SET absolut, realtime + rollback) + field Terjual di modal edit (ikut payload PUT). Milik admin untuk semua produk (manual + WR — sync/cron tidak pernah tulis kolom ini). Order lunas tetap `sold_count += qty` di atas angka manual (increment otomatis utuh, bestseller Telegram + kartu storefront ikut angka final).
- Daftar Produk: tab status toko Live/Hidden/Nonaktif/Semua (2026-10-01, live): admin tidak lagi menebak kenapa produk toggle-ON tidak tampil di toko. Default = Live (yang tampil di toko SAAT INI = `isLiveProduct` versi admin: aktif + tidak hidden pecundang + ≥1 varian beli). Hidden = toggle ON tapi tak tampil (sebab jujur per baris: "Kalah dari {nama}" / "Varian ada tapi stok habis" / "Nonaktif tapi stok tersedia"); Nonaktif = toggle OFF. Badge count (live/hidden/off) + kartu "Hidden otomatis" (bukan "aktif" yang menipu). Hanya 1 request list: status dihitung dari respons `GET /api/products` admin (`liveStatus`/`liveReason` + `pairs`, publik tidak menerimanya). Pagination admin 20/50/100 per halaman (persist `axvara-admin-per-page`, default 20; ganti tab/reset filter kembali ke hal. 1; `safePage` clamp + auto-koreksi + preferensi basi 8→20). Reorder ↑↓ pindah halaman bila melewati batas (2026-10-01: batas tab/halaman baru = default + delta). Ringkasan Produk hanya tampil di tab Live (angka = yang tampil di toko). Filter chip `low_stock` warisan tetap jalan.
- `store_settings` adalah override D1 untuk identitas serta tautan dukungan storefront. API publik read-only memakai cache singkat dan PUT memerlukan sesi admin; fallback `SITE` menjaga storefront tetap tersedia jika tabel belum siap.

---

## 6. Flow Teknis Checkout

```
[Client] Keranjang (Zustand + localStorage) / Beli Langsung (produk D1 aktif)
   ↓ POST /api/checkout/quote { slug/id, qty, expected_price }
[Server] Validasi produk aktif, stok, harga, dan payment_methods D1
   ↓ response quote HS256 60 menit + snapshot authoritative
[Client] Konfirmasi perubahan harga → QRIS auto-select (E-Wallet/Bank maintenance 2026-09-17: tampil disabled + badge di WEB, dihilangkan di WA/TELE)
   ↓ POST /api/orders { customer (nama opsional fallback prefix email, email SELALU wajib), item IDs/qty, payment_method, proof_url, quote_token }
[Server] Verifikasi signature+expiry+isi item → tolak non-QRIS 503 → D1 batch guard+decrement+INSERT order
   ├─ QRIS: alokasikan kode unik 1–299 → EMVCo dynamic payload + ledger 15 menit
   │    ↓ client: layar "Pesanan dibuat · Membuka halaman pembayaran" sampai /pesanan tampil
   │      (keranjang dikosongkan di balik layar ini; `qris` respons create disimpan di salinan lokal)
   │    ↓ /pesanan/[code] menampilkan QR dari salinan lokal segar (≤10 mnt, ada `qris`) lalu
   │      diganti data server; PNG ber-placeholder + "Muat ulang QRIS"; polling 5 detik
   │    ↓ QRIS Hook → POST /api/webhook/dana → exact amount + event dedup → lunas atomik
   └─ Manual: ⏸️ maintenance 2026-09-17 (upload disembunyikan WEB, endpoint 503, order manual 503)
        ↓ cron: jatuh tempo → status kadaluarsa + restore stok dalam satu batch
```

**Anti-tamper:** Harga, rekening, subtotal, dan item order terikat ke quote server; body client tidak dapat mengganti snapshot. Quote id unik membuat retry idempotent — checkout mengandalkan ini saat `POST /api/orders` timeout/putus jaringan: pesan "Tekan Bayar lagi — pesanan yang sama dilanjutkan, tidak dibuat dobel" (token quote yang sama → `orders.quote_id` UNIQUE mengembalikan pesanan yang sudah ada). Reservasi/restore stok memakai batch D1 dengan guard CHECK agar kegagalan rollback seluruh operasi; stok `-1` tetap unlimited.

**Laporan pendapatan (issue #12, review R9 2026-09-08):** sumber waktu kanonis `src/lib/revenue.ts` — `orders.paid_at` (ditulis sekali saat transisi lunas via COALESCE-guard di semua jalur QRIS/manual/admin, dalam batch yang sama dengan flip status) dengan bucket WIB (`datetime(..., '+7 hours')` di SQL, helper `isSameWibDay/isSameWibMonth` di dev-fallback). Hierarki: ledger `paid_at` → `paid_at` order → `reviewed_at` bukti → `updated_at` fallback. Migrasi `0016_revenue_paid_at.sql` membackfill data lama (QRIS dari ledger, manual dari `reviewed_at`, sisa lunas dari `updated_at`, non-lunas tetap NULL, idempoten). Overview menandai `revenue_timezone: Asia/Jakarta` + `revenue_from/to` agar mudah diaudit.

**Dashboard untung (revisi 2026-10-15, implementasi; publikasi via CI):** `src/lib/dashboard-report.ts` membaca satu query agregat CTE dengan fakta per item lunas; respons dibatasi agregat (bukan seluruh order mentah). `orders.paid_at`/ledger pembayaran tetap menentukan kalender WIB. Modal link WR/SK dialokasikan ke baris supplier yang bersangkutan; modal stok sendiri dari snapshot, fallback katalog untuk riwayat tanpa snapshot. Pedia memakai `supplier_charge`, fallback rate snapshot × quantity, dan kelompok supplier tersendiri. Biaya supplier dinormalisasi ke rupiah utuh untuk konsistensi tampilan. Pembagian nominal pembayaran/biaya supplier mempertahankan setiap rupiah (sisa pembulatan pada baris terakhir); supplier/channel/Top 5/series memakai fakta yang sama. Item campuran tidak disembunyikan oleh keberadaan link supplier pada item lain. Jumlah pesanan per supplier menghitung pesanan yang mengandung item asal itu; pada keranjang campuran jumlah kelompok tidak dijumlahkan sebagai total order.

`GET /api/admin/overview` mempertahankan field `revenue/cost/profit _today/_week/_month/_total`, breakdown seluruh waktu dan `daily_series` 30 hari untuk kompatibilitas; menambahkan `period_reports.{today,week,month}` berisi `{orders,revenue,cost,profit,estimated_orders,series,suppliers,channels,top_products}`. UI memakai laporan periode untuk SEMUA panel. `today.series` per jam WIB sampai jam berjalan; minggu/bulan harian sampai tanggal berjalan. Top 5 mencakup seluruh transaksi periode (batas 500 order dihapus). Query gagal tidak diganti dengan untung 0; UI menampilkan pesan gagal beserta tombol muat ulang. Grafik `OverviewCharts.tsx` mengukur container, mendukung nilai rugi dan sumbu order tersendiri; donat memakai omzet nonnegatif, batang untung mendukung rugi. Pergantian periode memakai payload yang sama, tanpa polling atau cron tambahan.

**Kompatibilitas D1 (recovery 2026-10-15):** D1 menolak enam SELECT dalam satu compound UNION (`too many terms in compound SELECT`), meski node:sqlite menerima. Tiga agregat ringkasan/supplier/channel kini berada di CTE `totals`, lalu digabung dengan Top 5/harian/per jam dalam empat cabang hasil; setiap compound tetap di bawah batas lima. Tetap satu query dan fakta yang sama, tanpa mengubah kontrak API atau menambah cron. `tests/dashboard-report.d1-runtime.test.ts` menjalankan SQL aktual pada D1 workerd melalui Miniflare (devDependency eksplisit yang versinya sudah tersedia di lock adapter), menguji katalog kosong dan keranjang campuran WR/SK/stok sendiri beserta konservasi nominal di seluruh periode. Test SQLite tetap berjalan untuk cakupan kasus bisnis lain.

**Laporan historis dan unduhan (2026-10-15, publikasi CI):** overview menerima `period=today|week|month` (default week) ATAU pasangan `date_from/date_to` kalender YYYY-MM-DD, inklusif WIB, maksimal 366 hari; parameter ganda/kombinasi periode-rentang/tanggal invalid/masa depan ditolak 400 sebelum query. `selected_report` menambahkan `from/to/timezone/generated_at` pada PeriodReport, dengan series per jam untuk today dan harian untuk rentang lain. Field kompatibilitas `period_reports` tetap tersedia. Query pilihan memfilter tanggal pembayaran sebelum ekspansi item; operasi stok/antrean tetap kondisi kini. Request generation mencegah respons lambat menimpa pilihan terbaru; panel finansial/ekspor disembunyikan saat loading/gagal. Toolbar `AdminOverview` menerapkan bulan saat berubah, atau pasangan tanggal lengkap setelah validasi client; isian parsial/invalid mempertahankan laporan terakhir tanpa request. Tidak ada tombol Terapkan/card filter. Tombol unduh PDF/Excel dikelompokkan tepat di samping pemilih bulan/tanggal pada toolbar yang sama; hanya dirender saat laporan siap, termasuk bila payload lama masih tersimpan saat loading/gagal. `AdminPage` merender metadata `selected_report` sejajar sesi admin hanya setelah laporan siap; loading/gagal menyembunyikan metadata lama. Teks total/pending/pill low_stock dan kartu estimasi dihapus dari UI; field API dan catatan estimasi ekspor tetap tersedia.

Pedia memakai nilai penjualan = pembayaran merchant + kredit digunakan (atau subtotal bila kredit penuh tanpa ledger); pembulatan invoice ikut omzet seperti Market. `merchant_paid/credit_used` pada ringkasan memisahkan penyelesaian pembayaran dari nilai jual, dihitung sekali per order agar keranjang campuran tidak menggandakan nominal. Snapshot biaya tetap berlaku. `ReportExportActions` memuat `src/lib/reports/export.ts` saat klik; pdf-lib dan write-excel-file/universal dimuat dinamis di browser, tanpa endpoint/cron/kredensial tambahan. PDF A4 berpaginasi dan XLSX lima sheet memakai satu model tabel dari respons layar, bukan CSV 5000 order. XLSX memakai sel numerik dan label String (bukan Formula); Unicode dipertahankan. PDF Helvetica mempertahankan teks Latin dan mengabaikan glyph dekoratif yang tidak didukung agar emoji tidak menggagalkan dokumen. Nama file mencantumkan tanggal awal/akhir; waktu pembuatan dan modal estimasi ada pada Ringkasan.

**Snapshot modal pembayaran (0063):** tabel tambahan `order_item_costs(order_code,item_index,product_id,variant_id,source,supplier_variant_id,unit_cost,created_at)` dengan PK `(order_code,item_index)`. `PAID_ORDER_COST_SNAPSHOT_SQL` dijalankan dalam batch transisi lunas QRIS/ACC maupun konfirmasi manual bersama order/outbox; `INSERT OR IGNORE` mempertahankan snapshot pertama. Tautan varian tidak memakai FK agar penghapusan katalog tidak menghapus modal historis; FK order tetap berlaku. Harga supplier link aktual mengungguli snapshot katalog. Snapshot tidak dibackfill sebagai fakta historis: data lama tanpa snapshot tetap memakai estimasi yang dilabeli, supplier nonterminal/charge Pedia belum ada juga estimasi. Migrasi hanya CREATE TABLE IF NOT EXISTS, diterapkan CI sebelum Pages; tanpa rebuild/rename tabel atau eksekusi migrasi produksi manual.

**Checkout invalid (2026-10-15):** handler submit bersama memvalidasi WA/email sebelum membuat order. Sesudah error ter-render, field pertama difokuskan dengan `preventScroll` dan wrapper label/input/hint digulir ke tengah viewport; wrapper memiliki scroll-margin navbar/CTA, reduced motion memakai scroll langsung. Error terhubung lewat aria-describedby, sticky CTA mobile juga menjelaskan perlunya melengkapi data.

**Monitoring & ketahanan notifikasi (issue #13, review R10/R11 2026-09-08):** status layanan jujur empat tingkat di `src/lib/service-health.ts` (`configured/healthy/degraded/unknown`) — overview memakai pengukuran (antrean fulfillment/outbox + usia, kirim terakhir, event QRIS 7 hari) dan mengembalikan `system_details` berdetail di samping boolean kompatibel; `last_match` mencakup event `matched`, kesehatan fulfillment membaca `fulfillment_items` + usia antrean tertua via `evaluateQueue` (macet = degraded; `manual_required` = needsAction → degraded langsung tanpa menunggu usia, review R11 lanjutan), dan `fulfillment_attention` = JUMLAH ORDER butuh tindakan (COUNT DISTINCT, tanpa hitung ganda job+item; rincian `fulfillment_attention_by_status`, `fulfillment_jobs_attention` untuk diagnosis); kartu Kesehatan sistem tiga warna (hijau/kuning/merah) + tooltip + legenda. Bot health memaparkan usia antrean tertua + event QRIS. Notifikasi penting WhatsApp ("Pembayaran Diterima") masuk `whatsapp_outbox` idempoten (`UNIQUE idempotency_key`, klaim lease `sending` + `worker_id`/`locked_until`, backoff 1-5-15-60, `dead`, migrasi 0019 rebuild CHECK prod), recovery lease basi oleh runtime (bukan hanya cron, review R10 lanjutan) + `claimErrors` terpisah, dan diproses cron operations 5-menit. Serah terima manual: `POST /api/admin/orders/[code]/handover` (item_index+note, admin-only, 90-hari TTL bukti, review R3 lanjutan) + tombol "Serahkan manual" di OrdersManager. Kesehatan sesi Baileys dinyatakan eksplisit sebagai milik gateway Heroku eksternal (dilaporkan endpoint `/health` gateway), bukan diklaim hijau dari Pages.

**Panel QRIS pending ringkas (2026-10-15, implementasi; publikasi CI):** halaman `/pesanan/[code]` memilih layout compact hanya saat `order.status=pending`, ada invoice QRIS dan order belum kedaluwarsa. Header kecil, container 760px, QR frame 224/240px dan layout dua kolom mulai `sm`; judul/kode dipusatkan pada semua ukuran dengan grid kolom penyeimbang ikon (32px mobile/40px desktop), satu pill pending di atas Total bayar pada mobile maupun desktop (status QR hangus tetap di header semua ukuran); kotak gambar/placeholder tetap persegi dan download tetap `order.qris.image_url`. Info bayar memakai payable_amount/kode unik/expiry yang sama. Ringkasan direuse pada `MobileCollapsible` tertutup untuk pending dan kartu terbuka setelah lunas. CTA berganti label Simpan QRIS/Cek Pembayaran dengan handler/download existing; status polling tetap live, timestamp dipertahankan untuk pembaca layar. Navigasi sekunder dipadatkan, Lacak Status hanya pada status lain. Gate qrisExpired/reissueAllowed, pembatalan berkontak/konfirmasi, interval polling serta panel akun/garansi/auto-scroll tidak diganti; tanpa route/env/migrasi baru.

**Auto-scroll kredensial Market (2026-10-15, implementasi; publikasi CI):** `WrCredentialsPanel` menyimpan ref section hasil dan penanda scroll per kode, menjadwalkan satu `requestAnimationFrame` saat credentials nonkosong terpasang, serta membatalkan frame saat cleanup. Target dihitung dari posisi panel + scroll halaman − jarak navbar 96px, dijepit minimum 0, melalui `window.scrollTo`; smooth/default atau instant/reduced-motion (CSS global smooth tidak dibiarkan menghidupkan animasi kembali). Kedua pemanggil `/pesanan/[code]` dan hasil `/lacak-pesanan` memberi `key={order.code}` supaya state/token/isi akun lama tidak dipakai saat kode berubah. Callback scroll hasil lacak melewati ringkasan jika section isi akun sudah tampil; jika belum, scroll hasil tetap tersedia dan menghormati reduced motion. Tidak ada API/polling/migrasi baru; verifikasi kontak/token server tetap menjadi gate isi akun.

**Proteksi garansi third-party:** `/garansi-replace` adalah acuan tunggal ketentuan layanan & garansi (AXVARA third-party independen, garansi 1x24 jam–30 hari mengikuti deskripsi tiap produk, klaim = penggantian/perbaikan, proses 1–3 hari sesuai antrean/stok/gangguan pihak terkait, solusi refund bila gangguan masih terjadi setelah maksimal 3 hari; tanpa refund otomatis). Checkout mewajibkan checkbox persetujuan sebelum order dibuat; detail produk, footer, dan halaman sukses pesanan menautkan kembali ke halaman tersebut. Revisi 2026-10-16 ✅ implementasi, publikasi CI: `marketWarrantyClaim` di `lib/warranty-policy.ts` memuat `eligibility` dengan teks "pengajuan garansi hanya untuk produk bergaransi", dua bukti wajib (invoice/bukti pemesanan + screenshot), catatan durasi/refund dan penutup. `WarrantyClaimBody` dipakai halaman ketentuan (default `size="sm"`, 14px); accordion memakai `size="xs"` (12px, `leading-relaxed`) agar sama dengan isi S&K/aktivasi sejak revisi 2026-10-16; `WarrantyClaimAccordion` memakai `MobileCollapsible` (tertutup, keyboard/ARIA), dengan `className` opsional untuk jarak saat embedded. `WrCredentialsPanel` merender satu accordion di dalam kartu setelah semua S&K/aktivasi dan sebelum catatan simpan, termasuk di dalam form verifikasi. Kedua halaman Market hanya merender fallback di luar kartu bila lunas dan `credentialsReady=false`, sehingga tidak ada duplikasi. Berlaku retroaktif pada tampilan order lama dan semua supplier, tanpa migrasi/data produk/refund API baru; formatter Telegram/WhatsApp tetap memakai catatan durasi/refund yang sama.

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

### Aset statis di luar worker (2026-10-10)

`npm run build:pages` = `next-on-pages` lalu `scripts/patch-pages-routes.js`,
yang menambah `/icons/*`, `/brand/*`, `/og/*`, `/banners/*`, `/favicon.svg`,
dan file verifikasi Google ke `exclude` di `.vercel/output/static/_routes.json`
(bawaan hanya `/_next/static/*`). File itu disajikan CDN langsung tanpa
menyalakan Pages Functions + middleware (dulu ±4.800 request/hari ikut
menghabiskan jatah CPU Workers Free ~10 ms dan bisa kena 1102). Cache +
`nosniff` untuk path tersebut diatur di `public/_headers`. Aturan: hanya file
statis `public/` boleh masuk daftar — jangan path yang punya route dinamis.

Hemat CPU lain (Workers Free, 2026-10-10): `<Link prefetch={false}>` di semua
link storefront/Pedia (prefetch otomatis kartu produk dulu memicu belasan
render RSC per kunjungan beranda); `decideAllWinners` (aksi `pairs` di
`/api/supplier-sync`) kini 1 SELECT agregat + UPDATE hanya baris berubah
(dulu ±9 query × 33 pasangan ≈ 300 round-trip → rutin `exceededCpu`).

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
    `?cat=` kategori sama (hanya yang bisa dibeli — stok habis TIDAK PERNAH
    tampil di Produk Serupa, kontrak 2026-10-01; filler katalog lain hanya
    bila kategori sama < 4, hemat rows-read) — tidak ada lagi fetch seluruh
    katalog per halaman.
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

**Cron operations dipecah satu fase per request (live 2026-10-04, Workers Free plan).** Insiden 3 Okt 2026 13:25–16:50 UTC (20:25–23:50 WIB): 41 run beruntun `/api/cron/operations` dibunuh runtime Pages dengan `exceededResources` → HTTP 503 (CPU 10–20 ms, durasi ~0,3 dtk) karena satu request memikul expiry + fulfillment + sync WR 49 produk + sync SK ~160 varian + notify + cleanup. Heartbeat `cron_last_hit_at` tetap segar (ditulis di depan handler) sementara `wr_sync_log`/`cron_deferred` di ekor tak pernah tertulis, dan Worker membuang status respons sehingga tak ada alarm. Kontrak baru:

- `mcp-worker/src/cron.ts` `runOperationsTick()` memanggil `POST /api/cron/operations?phase=<fase>` **berurutan** untuk `expiry → fulfillment → warung_rebahan → sekalipay → notify → cleanup` (satu request = jatah CPU sendiri). Fase gagal tidak menghentikan fase berikut.
- `?phase=` menjalankan TEPAT satu fase: tanpa rotasi/deferred/anti-starvation, tidak menulis `cron_phase`/`cron_deferred`, dan menulis penanda run selesai `store_settings.cron_last_ok_at` di ekor. Nama fase tak dikenal → 400 `invalid_phase`. Tanpa `?phase=` perilaku rotasi lama tetap (pemanggilan manual/kompatibilitas).
- Sync katalog dipotong kecil: WR 10 produk, SK 25 varian per request. Respons `more: true` bila potongan berhenti di plafon (cursor tersimpan); Worker mengulang `?phase=…&continue=1` (hanya sync — order/reconcile/delivery/saldo tidak diulang) maks 10 potongan/fase/tick, sehingga satu putaran penuh selesai dalam satu tick.
- Interval putaran katalog WR/SK **15 menit** (dulu 30). Ambang kode `CATALOG_SYNC_INTERVAL_MS` = **14 menit** (sejak 4 Okt): log sync ditulis beberapa detik setelah tick mulai, jadi ambang 15 menit membuat putaran nyata tiap 20 menit (terukur 05:20 → 05:40 WIB). Cursor > 0 tetap melanjutkan tanpa menunggu interval.
- Alarm: bila ada fase gagal (non-2xx / fetch gagal), Worker mengirim pesan ke `TELEGRAM_ADMIN_CHAT_ID` hanya pada tick menit kelipatan 30 (stateless, maks 2 pesan/jam selama insiden). Butuh secret Worker `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ADMIN_CHAT_ID` (nilai sama dengan Pages); tanpa keduanya alarm dilewati diam.
- Cara baca: `cron_last_hit_at` segar + `cron_last_ok_at` basi = request dibunuh di tengah (CPU/`exceededResources`); keduanya basi = pemicu Worker mati. Bukti platform: Cloudflare GraphQL `pagesFunctionsInvocationsAdaptiveGroups` status `exceededResources`.
- Tradeoff: ±10–15 request Pages per tick (bukan 1) — tetap jauh di bawah kuota 100k/hari; batas CPU per fase belum diukur per fase, jadi bila `exceededResources` masih muncul langkah berikutnya adalah memindah diff katalog ke VPS proxy.

**Revisi 2026-10-04 pagi (insiden 02:00–05:20 WIB: request fase WR/SK gabungan order+sync masih `exceededResources`, 24–30/jam):**

- Fase WR/SK dibelah `part=orders` (recover klaim, teruskan order lunas, reconcile, kirim kredensial/email, saldo; respons `*_sync_skipped="part_orders"`) dan `part=sync` (katalog saja + watchdog sync basi; pemenang pasangan WR vs SK dihitung sekali saat sweep SK tuntas). `part` lain / fase lain → 400 `invalid_part`. Urutan Worker per tick: `expiry → fulfillment → WR orders → SK orders → notify → WR sync (potongan) → SK sync (potongan) → cleanup` — order lunas tetap diteruskan walau sync kena limit.
- **Potongan katalog dari proxy VPS (tanpa state):** mode `?phase=` memanggil `syncProducts`/`syncSkProducts` dengan `useProxySlices`. Proxy `POST /wr/products-slice` dan `GET /sk/catalog-slice` mengambil katalog penuh, mengurutkan dengan aturan yang SAMA dengan sync Pages, lalu mengembalikan potongan (WR ~13 KB vs 71 KB; SK ~26 KB vs 93 KB). SK mode potongan selalu scope penuh kategori (tanpa delta `updated_since`). Potongan terakhir membawa `meta.all_variant_ids` (seluruh id varian upstream/scope saat itu) → zero-missing kini berjalan aman di akhir sweep berpotongan (sejak 3 Okt malam sweep berpotongan tidak pernah zero-missing). Proxy lama/mode langsung (404/405) → fallback fetch penuh. Kontrak proxy: `axvara-wr-proxy/AGENTS.md`.
- **Penanda langkah:** mode `?phase=` menulis `console.log("[cron] <fase>[:part][:cont] step=<langkah> t=<ms>")` (auth_ok, phase_state, watchdog_done, queues_counted, wr_import_*, wr_recover_done, wr_orders_done, wr_sync_done, wr_tail_done, sk_*, phases_done) tanpa D1. Request yang dibunuh: `wrangler pages deployment tail <deployment-id> --project-name axvara --format json` memperlihatkan langkah terakhir yang sempat jalan.
- **Alarm ber-state (Workers KV `axvara-cron-state`, binding `CRON_STATE`, key `cron_alarm_v1`):** 1 pesan saat gangguan mulai (2 tick gagal beruntun), pengingat tiap 6 jam bila masih gagal, 1 pesan `✅ Cron AXVARA pulih` setelah 3 tick sukses beruntun (beserta durasi). KV hanya ditulis saat transisi (hemat kuota tulis gratis 1.000/hari). Telegram gagal saat alarm mulai → dicoba lagi tick berikut. Tanpa binding KV → fallback stateless :00/:30. Watchdog "Sync basi" tetap jadi cadangan.

**Sync katalog DIFF dari VPS (live 2026-10-04 siang).** Penanda langkah 4 Okt 10.15 WIB membuktikan potongan 10 produk tetap dibunuh `exceededCpu` saat platform ketat: `warung_rebahan:sync` mati SETELAH `phases_done` (route cron raksasa ±1 dtk hanya untuk menyala + kerja per produk), `sekalipay:sync` mati di tengah sweep. Kontrak baru:

- VPS (`axvara-wr-proxy/src/diff-sync.ts`) tiap **3 menit** mengambil katalog WR + SK (scope `Aplikasi Premium`), membandingkan hash per produk WR / per varian SK dengan snapshot TERKONFIRMASI (file `state/diff-state.json` di VPS), lalu `POST /api/supplier-sync` HANYA entitas berubah + `removed_variant_ids`. Potongan maks 8 produk WR / 20 baris SK (dibagi dua tiap gagal, naik lagi saat sukses). Snapshot maju hanya untuk entitas yang dibalas 2xx. Katalog kosong → siklus dilewati; penghapusan >50% → ditahan (sweep pengaman yang memutuskan). Heartbeat kiriman kosong tiap ≤6 mnt. Setelah SK berubah → request terpisah `{supplier:"sk",action:"pairs"}` menghitung ulang pemenang WR vs SK.
- `src/app/api/supplier-sync/route.ts` (edge, impor minimal, tanpa fase/budget cron): header `x-supplier-sync-token` = secret Pages `SUPPLIER_SYNC_TOKEN` (konstan-waktu; kosong → 503). Batas 10 produk WR / 30 baris SK / 200 id dihapus (413). Menerapkan lewat `syncProducts`/`syncSkProducts` opsi `applyOnly` (logika tulis/markup/restok/agregat yang SAMA, tanpa fetch/cursor/server_time/zero-missing penuh; varian dihapus → `zeroVariantsByIds`/`zeroSkVariantsByIds`). Tiap penerapan (termasuk heartbeat) menulis `*_sync_state.diff_last_at`; penerapan yang benar-benar mengubah sesuatu menulis juga `diff_last_change_at` + `diff_last_change` (JSON produk/varian/stok/harga/dihapus), error → `diff_last_error`. **Sejak 4 Okt 12.40 WIB diff TIDAK menulis `*_sync_log`** — log khusus sweep penuh berpotongan + manual (dulu heartbeat 0/0 dan delta 1 varian menutupi kartu admin). `GET /api/admin/{warung,sekalipay}/sync-log` mengembalikan `diff` (`src/lib/supplier/diff-status.ts`, sehat = `diff_last_at` < 10 mnt); kartu "Sync terakhir" (`src/components/admin/SupplierSyncStatus.tsx`) menampilkan Diff VPS (cek + perubahan terakhir) · Sync penuh (cadangan 60 mnt) · Manual. Watchdog sync basi WR (90 mnt) memakai `diff_last_at` bila log sweep tampak basi tapi diff sehat.
- Cron: selama `diff_last_at` < 10 mnt, sweep berpotongan turun menjadi PENGAMAN tiap 60 mnt (diukur dari `*_sync_state.products_full_sweep_at`, ditulis tiap sweep penuh tuntas); diff basi → otomatis kembali 14 mnt. Alarm Worker: kegagalan langkah `:sync` baru dialarmkan setelah 6 tick beruntun (30 mnt); langkah lain tetap 2 tick.
- Kesegaran: perubahan stok/harga supplier tampil ±3–6 mnt. Panggilan supplier ±480/hari masing-masing (setara skema potongan).

## 13. Bot Telegram + DANA Dynamic QRIS + Fulfillment

Implementasi native TypeScript di codebase AXVARA. Repo `mocasus/telegram-auto-order-bot` hanya referensi UX; tidak ada dependency, subtree, atau source copy.

### Arsitektur

- **Bot:** Webhook di `POST /api/telegram/webhook`, bukan long polling. Wrapper `fetch` kecil atas Telegram Bot API tanpa framework.
- **Payment:** `src/lib/payments/dana-qris.ts` mengubah payload merchant DANA Business menjadi EMVCo dynamic QRIS, menyuntikkan nominal unik, dan menghitung ulang CRC16. Tidak ada API/payment gateway pihak ketiga.
- **Authority:** QRIS Hook Android mengirim JSON ke `POST /api/webhook/dana` dengan `X-Webhook-Secret`. Event dideduplikasi dan hanya nominal persis dari satu invoice DANA aktif yang dapat melunasi order.
- **Setup Android:** gunakan URL publik `https://axvara.tech/api/webhook/dana`, isi field secret aplikasi dengan nilai rahasia Pages Secret `DANA_WEBHOOK_SECRET` (bukan teks nama variabel tersebut), aktifkan Notification Access + merchant DANA + QRIS Hook Active, dan matikan Debug Mode agar delivery tidak dilewati. Admin menampilkan URL kanonis, nama header, health, dan event masuk tanpa mengekspos nilai secret.
- **Fulfillment:** AES-256-GCM via WebCrypto, fingerprint SHA-256 untuk deduplikasi. Tiga mode: `manual`, `shared`, `unique`. Outbox pattern dengan `fulfillment_jobs` (per order, kompatibilitas) + `fulfillment_items` per (order, item) sejak migrasi 0015: setiap item punya status/mode/penerima sendiri, order selesai hanya setelah seluruh item terminal sukses.
- **Rekonsiliasi:** `POST /api/cron/operations` menangani stale initializing, order QRIS yang mencapai batas akhir, due jobs, stale locks, serta retry notifikasi order/paid Telegram dan order/paid-admin WhatsApp. DANA tidak menyediakan status polling; webhook adalah authority pembayaran. **ACC manual QRIS (2026-10-01):** bila hook gagal total (tidak ada event) padahal dana benar masuk, admin ACC dari baris Pesanan — `PATCH /api/admin/orders/[code]` dengan `action:"paid_qris"` memakai `transitionPendingPaymentToPaid` yang SAMA dengan webhook (ledger + job + `ensureFulfillmentForPaidOrder` + link WR/SK + notif WA), catatan mutasi wajib + `[ACC-QRIS manual email]` di admin_note.
- **Notifikasi Telegram:** order Telegram mengirim notifikasi grup `TELEGRAM_ADMIN_CHAT_ID` segera setelah ledger QRIS terbentuk. Kolom marker idempoten pada `orders` mencegah duplikat. Setelah QRIS Hook mengubah order menjadi `paid`, buyer otomatis menerima pesan berhasil tanpa menekan cek status; untuk fulfillment manual pesan yang sama baru meminta nomor WA dan menampilkan kontak admin.

- **Paritas pengiriman Telegram = Web (2026-10-04, laporan owner Prime Video SK):** pesan lunas Telegram memakai profil per order `telegramPaidDeliveryProfile` (`src/lib/telegram/order-notifications.ts`, dari varian tiap baris lewat `buyerDeliveryKind` — BUKAN snapshot `fulfillment_mode`, yang selalu `manual` untuk WR/SK): `instant` (stok sendiri shared/unique, WR restock, SK auto) → "dikirim otomatis ke chat ini"; `queued` (WR MBO / SK non-auto) → pesan tunggu Made By Order maks 12 jam + janji kirim OTOMATIS ke chat ini; `manual` (baris diserahkan admin) → teks lama + minta WA cadangan (HANYA untuk baris manual lokal). Kredensial supplier ke chat pribadi pembeli memakai satu template `supplierCredentialMessage` (`messages/status.ts`): WR via `deliverTelegramCredential` (pipeline `wr_order_links.delivery_*` lama), SK via `deliverSkCredentialToBuyer` → `sendSkCredentialTelegram` (`src/lib/sekalipay/deliver.ts`, idempoten `telegram:sk-credential:<order>:<item>` di `buyer_notice_log`) — dipanggil `handleSkOrderCompleted` + reconcile cron `reconcilePendingSkCredentialEmails` (kini juga Telegram; baris yang pasti tak terkirim — web tanpa email / Telegram tanpa chat pribadi — tidak dipungut). Private-only tetap: order dari grup tanpa START tidak pernah dikirimi kredensial ke id grup; saat pembeli START, `ensurePrivateRecipient` mengantrekan ulang delivery WR `no_private_telegram_chat` (attempt di-reset) dan reconcile SK mengirim di run berikutnya. Webhook miss: SK punya `reconcileFreshSkOrders` (link processing 2 mnt–1 jam, maks 3/run, cron fase SK langkah 3a); WR fresh dibatasi <1 jam (maks 6), reconcile stuck WR/SK `ORDER BY RANDOM()` agar antrean MBO panjang tidak menyumbat. `notifyBuyerSkProcessing` tidak dikirim ke Telegram (dulu bocor kata "Pemasok" + "email ini") dan dilewati bila item SK sudah terkirim; kabar saldo habis WR/SK tidak lagi menyebut pemasok.
- **Self-heal kredensial WR lama (2026-10-04, F111FD64):** cron fase WR `repairUnboundCompletedWrLinks` memungut link `completed` yang belum terikat item (≤14 hari, maks 2/run), menarik ulang `/transactions` dan memanggil `handleWrOrderCompleted` (formatter baru + bind + settle) tanpa kirim ulang; tidak ada di upstream → `last_error=repair_tx_missing` (tidak dipungut lagi).
- **Fallback kredensial Telegram (2026-10-04, permintaan owner):** WR + SK + tombol ambil ulang memakai `src/lib/telegram/credential-delivery.ts`: `sendTelegramCredential` mencoba target berurutan `telegram_users.chat_id` → `orders.telegram_user_id` (jalur yang sama dengan produk stok sendiri) → `orders.telegram_chat_id` bila pribadi, sampai satu berhasil; id grup tidak pernah dipakai; semua gagal → throw (WR backoff 1/5/15/60 mnt, SK reconcile dengan backoff 10 mnt). Tombol **📦 Ambil Detail Produk** (callback `cred:<kode>`, ownerBound: pemilik + chat pribadi) di pesan lunas + status order lunas mengirim ulang semua `fulfillment_items.delivered_ciphertext` (WR/SK/stok sendiri/serah terima admin) ke chat bot; belum siap → pesan tunggu. Interaksi pribadi pembeli (`ensurePrivateRecipient`) mengantrekan ulang SEMUA delivery WR Telegram yang `failed` (attempt reset) dan melepas backoff kirim SK yang gagal.
- **Katalog Telegram memfilter pecundang pasangan WR/SK (2026-10-04):** `notLoserProductSql()` (`src/lib/supplier-pairs.ts`, aturan Opsi B sama dengan `/api/products` + promo digest) dipasang di `listTelegramProducts` (katalog + kategori), `handleSearchResults`, dan `getBestsellers`; `handleShowProduct` mengarahkan id pecundang ke pemenang via `winnerForLoserProduct` (cermin 308 PDP).
- **Garansi kosong tidak ditulis (2026-10-04):** `buyerWarrantyLabel()` (`src/lib/catalog.ts`) = `""` untuk `warranty_type='none'` — Telegram (detail + tombol varian + snapshot invoice), snapshot order web (`commerce.ts`), dan WA (detail/varian/pembayaran) tidak lagi menampilkan "Tanpa Garansi" (SK menulis garansi di S&K, bukan kolom). Admin tetap bisa mengisi garansi terstruktur manual; sync SK tidak menimpanya.

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
| `fulfillment_items` | Status/mode/penerima per item order (migrasi 0015). **Ringkasan status: satu order HANYA `delivered` bila SEMUA item delivered; campuran delivered+manual = `manual_required` (pelanggaran ini menutupi item manual yang belum diserahkan). Per-item klaim CAS (`sending` + locked_until) + agregat parent berpagar lease (R4 lanjutan); serah terima manual via `POST /api/admin/orders/[code]/handover`.** Migrasi 0043: `delivered_ciphertext`/`delivered_iv` = salinan terenkripsi isi yang dikirim ke pembeli (ciphertext sumber disalin untuk shared/unique; isi "Detail untuk pembeli" dienkripsi untuk serah terima admin), dibaca `/api/orders/[code]/credentials` setelah verifikasi WA/token. |
| `dana_webhook_events.reviewed_by/review_note` | Audit verifikasi manual nominal dipakai-ulang (migrasi 0017, review R1) |
| `whatsapp_outbox.worker_id/locked_until` + status `sending` | Lease klaim worker anti-kirim-ganda (migrasi 0018, rebuild CHECK prod 0019, review R10 lanjutan: recovery lease basi oleh runtime + claimErrors terpisah) |
| `admin_session_revocations` | Pencabutan sesi admin lintas instance/restart (migrasi 0020, review R8 lanjutan: logout menolak cookie basi di worker baru; TTL 90 hari dibersihkan cron) |
| `store_settings` | Override nama, tagline, WhatsApp, jam dukungan, footer, dan logo storefront |
| `supplier_links` | Shortlink internal `axvara.tech/go/*` (migrasi 0056, 2026-10-03): pembungkus link supplier + artikel AXVARA panjang agar tampil pendek di PDP/email/panel; `slug` unik + `destination` (URL/absolut atau path internal) + `title` + `is_active` + `click_count`/`last_clicked_at`; CRUD hanya admin, pembeli hanya redirect (bukan SaaS publik) |
| (indeks log) | Migrasi 0057 (2026-10-04, darurat kuota D1 Free 5 jt rows_read/hari): `wr_sync_log`/`sk_sync_log(sync_type, created_at)` + `wr_saldo_log`/`sk_saldo_log(source, created_at)`. Tanpa indeks, setiap query "baris terbaru" cron/watchdog membaca + mengurutkan seluruh tabel (±800–2.900 baris) dan menyumbang >50% rows_read setelah cron dipecah per fase. Aturan: query "terbaru" baru di tabel log wajib punya indeks pendukung |
| `telegram_promo_digests` | Ledger Daily Promo dua slot (`business_date + slot` unik), snapshot product IDs, marker/attempt/error terpisah untuk bubble lengkap dan ringkas (migrasi 0044) |

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
| GET/POST/DELETE | `/api/admin/fulfillment` | admin | Inventory management + template pesan serah terima varian Made By Order (`action:"set_handover_template"`, migrasi 0043). Impor/revoke varian unique OTOMATIS menyelaraskan kolom `stock` → unit `available` (2026-10-02, insiden Head 18 Bulan); GET membawa `variant_stock` + `stock_mismatch` untuk banner selisih admin. Revisi sore: penjumlahan kartu `variant_stock` memakai stok EFEKTIF per varian (unique = min kolom vs available) + `purchasableStockSql` menolak unique tanpa unit — kartu/bot/`llms.txt`/SEO seragam |
| GET/POST | `/api/admin/orders/:code/handover` | admin | Kirim ke pembeli: GET item + `label` + `template_text` terisi; POST `{item_index, note?, buyer_message?}` → isi dienkripsi, dikirim ke pembeli (email/DM), tampil di halaman pesanan |
| GET/PUT | `/api/store-settings` | public/admin | Identitas storefront / update terautentikasi |
| GET | `/api/catalog[?slug=]` | public | Katalog produk/varian aktif terpusat. Detail `?slug=` (sejak 2026-09-24): tiap varian membawa `copy` (S&K berkelompok + cara aktivasi versi Axvara, atau teks WR yang dirapikan) dan `terms`/`delivery_terms` mentah dikosongkan (`null`) |
| GET/PUT | `/api/admin/variant-copy` | admin | S&K + cara aktivasi versi admin per varian (`admin_terms`, `admin_activation`, `admin_copy_fingerprint`, 0041). GET memberi status/sumber dan teks editor, PUT menyimpan suntingan supplier dengan review/fingerprint. **2026-10-15:** stok sendiri memakai `SharedVariantCopyFields` pada tab Varian (single/multi), disimpan bersama batch POST/PUT produk lewat `manualCopyUpdate` hanya untuk varian tanpa WR/SK ID, fingerprint kosong; input kosong menghapus field, input tidak dikirim mempertahankan field, GET detail publik tidak mengirim field editor mentah. Link/akun/key unik tetap di inventory; impor/revoke merupakan aksi terpisah yang langsung tersimpan. Save foto/badge tidak mencap ulang override supplier. |
| GET/POST/PUT/DELETE | `/api/admin/variants` | admin | Kelola SKU, durasi, garansi, harga, stok, dan mode fulfillment varian |
| POST | `/api/whatsapp/webhook` | Shared Baileys webhook token | Command grup, order, pembayaran, dan intake bukti |
| POST | `/api/admin/proofs/:id` | admin | CAS approve/reject bukti dari baris Pesanan dan otorisasi pembayaran manual |
| POST | `/api/cron/lite?job=expiry\|fulfillment\|wr_orders\|sk_orders\|pedia_orders\|promo\|notify_a\|notify_b\|notify\|cleanup` | Bearer `CRON_SECRET` | Langkah cron INTI ramping (2026-10-05, Workers Free ~10 ms CPU): impor minimal + modul dinamis per job, budget 40 statement, penanda `store_settings.cron_lite_<job>_ok_at`. Dipanggil Worker SEBELUM route besar `/api/cron/operations` (yang tetap jalan sebagai pelengkap; idempoten). Alarm Telegram: langkah lite inti = hard (2 tick), `lite:promo` (Daily Promo Digest, ledger bersama fase notify → tidak kirim ganda) + `notify_a`/`notify_b` = soft (6 tick), langkah route besar lain tidak dialarmkan | **Revisi 5 Okt malam:** job `notify` (alarm soft) + `cleanup` (tanpa alarm) ikut lite; route besar `/api/cron/operations` hanya dipanggil Worker di tick menit :00 UTC (sekali per jam, `isHeavyTick`) sebagai pelengkap (stranded ledger, manual-WA, saldo, watchdog, sync cadangan). Tradeoff: fallback sync saat diff VPS berhenti jadi per jam (bukan 15 mnt). Latar: 583/589 request `exceededResources` 24 jam = route besar tiap 5 mnt. **Revisi 9 Okt pagi (insiden 09:50 WIB: 4 langkah lite 503 bareng, pulih sendiri ~30 mnt):** `notify` dipecah `notify_a` (retry Telegram + invoice) + `notify_b` (QRIS + reminder + WA outbox) — satu-satunya job yang mengipas 5 sub-kerjaan/5 import dalam 1 request; `job=notify` lama tetap sebagai alias gabungan A→B. Worker memanggil a/b terpisah + jeda `STEP_DELAY_MS` 2 dtk antar langkah lite (8+ request sedetik saat cold = berebut CPU isolate yang sama). Throttle saldo SMM disamakan WR/SK: 6 jam ATAU turun Rp5.000, state `amount|ms` di `pedia_balance_alert_at` (dulu tiap 1 jam → spam 9×/8 jam saat saldo Rp 0). **Revisi 9 Okt sore (kasus AXV-20261009-DA1ACF56):** probe yatim lunas-tanpa-link (reconcileMissingWrLinks/SkLinks) jalan TANPA gate due di lite wr/sk_orders (hasil ikut buka gate proses + kunci orphan_links_healed) dan fase route besar (wr/sk_orphan_links_healed) — SK cermin WR.
| GET | `/go/:slug` | publik | Shortlink internal `axvara.tech/go/*` (2026-10-03, migrasi 0056): redirect 307 ke destination + `click_count`/`last_clicked_at`; 404 bila slug tak ada/nonaktif/format salah; `X-Robots-Tag: noindex` (tak masuk sitemap) |
| GET/POST/PUT/DELETE | `/api/admin/supplier-links` | admin | CRUD tabel `supplier_links` (tab admin "Link Supplier"): slug lowercase-dash (min 2, reserved: admin/api/go/produk/artikel/…), destination URL/path internal, toggle `is_active`; POST duplikat → 409 |

### Environment Baru

Semua nilai nyata di Cloudflare Pages Secrets:

```
TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_ADMIN_CHAT_ID
DANA_STATIC_QRIS, DANA_WEBHOOK_SECRET
FULFILLMENT_ENCRYPTION_KEY
TELEGRAM_BOT_ENABLED, TELEGRAM_PROMO_DIGEST_ENABLED, DANA_QRIS_ENABLED, AUTO_FULFILLMENT_ENABLED
```

`TELEGRAM_ADMIN_CHAT_ID` adalah satu tujuan untuk seluruh notifikasi admin yang berasal
dari order web, order Telegram saat invoice dibuat, order WhatsApp saat dibuat
(`Order Baru — WhatsApp`) dan saat lunas (`Lunas — WhatsApp` via QRIS Hook /
retry admin / approve bukti), serta kegagalan delivery. Grup privat
wajib memakai ID numerik negatif (`-100...`), bukan link undangan. Tambahkan
`@Axvara_bot` ke grup lalu jalankan `/chatid` untuk menampilkan ID tersebut. Username
support manusia `@axvara_support` ditampilkan bersama tombol WhatsApp admin pada
pesan setelah pembayaran berhasil.

Daily Promo Digest (`src/lib/telegram/promo-digest.ts`) berjalan di fase `notify`
cron operations, sesudah notifikasi transaksional. `Intl.DateTimeFormat` dengan
`Asia/Jakarta` membuka jendela retry pagi 09.00–11.59 dan sore 17.00–19.59.
Produk dipilih dari varian aktif yang stoknya unlimited atau memenuhi `min_qty`;
minimum tiga, target empat. `PRIMARY KEY (business_date, slot)` mengunci snapshot
pilihan. `full_message_id` dan `short_message_id` ditulis segera setelah masing-masing
send sukses, sehingga kegagalan bubble kedua hanya mengulang bubble kedua. Bubble
kedua = versi WA siap copy-paste (2026-10-03): isi sama persis dengan pesan utama,
bold pakai `*` literal, dikirim tanpa `parse_mode` HTML (nama produk ber-`&`/`<`
tidak bikin Telegram tolak pesan). Ikon kategori: cek spesifik dulu (Desain/Video,
Stream, Produktivitas, Developer, Bundle) baru AI pakai batas kata — "desain"
mengandung substring "ai". Flag
`TELEGRAM_PROMO_DIGEST_ENABLED` default mati mencegah outbound saat setup belum siap.

### Feature Flags
Rollout bertahap: `TELEGRAM_BOT_ENABLED=false`, `TELEGRAM_PROMO_DIGEST_ENABLED=false`, `DANA_QRIS_ENABLED=false`, `AUTO_FULFILLMENT_ENABLED=false`. Semua default off di contoh environment; secret produksi dikelola di Pages.

### Proteksi Garansi BOT

**Pengiriman kredensial lengkap (2026-10-17 ✅ implementasi, publikasi CI):** `messages/credential.ts` membentuk bagian kredensial → S&K → penggunaan/aktivasi → klaim garansi. `orders/credential-terms.ts` mengekspor `resolveCredentialTermsForVariants` untuk lookup katalog per ID yang sudah diketahui (satu query JOIN, resolver/fingerprint/merge sama dengan panel website); `resolveCredentialTermsByItem` tetap memetakan hasil ke indeks order untuk API website. WR membaca ID varian lokal berdasarkan `wr_variant_id` link asal; SK dan shared/unique memakai `fulfillment_items.variant_id`. Tombol ambil ulang mengambil copy seluruh varian terkirim dalam satu query, lalu memasangkan per item. Legacy dan serah terima admin berisi detail (`notifyBuyerHandover`) memakai resolver indeks order. Notice handover baru ditandai sent setelah seluruh bagian sukses; handover tanpa isi tetap berupa kabar penyerahan existing. Cadangan deskripsi/admin dipakai bila copy kosong/gagal dibaca; kredensial tetap dapat dikirim. Copy adalah katalog terkini saat pengiriman/ambil ulang, bukan snapshot baru. Tidak ada migrasi/env/kontrak proxy baru.

`credentialMessages` mengemas bagian menjadi array HTML ≤4096 karakter per pesan (lebih ketat daripada panjang teks setelah parsing Telegram), mempertahankan semua karakter kredensial, code point Unicode, entitas/tag utuh dan identitas order pada lanjutan. `sendTelegramCredentialParts` hanya menerima ID chat positif dan mengirim berurutan tanpa preview tautan. `sendTelegramCredential` mencoba seluruh bagian pada tiap target pribadi sesuai fallback existing; baru sukses setelah semua bagian berhasil. SK menyelesaikan notice sesudah seluruh bagian, stok sendiri menyelesaikan item/job sesudah seluruh bagian, WR mempertahankan retry delivery existing; kegagalan parsial dapat mengulang bagian yang sudah sampai saat fallback/retry (bukan exactly-once per bubble). Budget admission fulfillment Telegram menambah satu statement katalog; reserve WR bertambah satu. Kebijakan klaim memakai `marketWarrantyClaim` bersama website; teks delivery lama “Refund tidak berlaku” dihapus. Ambil ulang melengkapi pesanan lama tanpa broadcast otomatis. Verifikasi fixture/Obscura bukan bukti pesan transaksi produksi.

- `/start` tampil bersih (welcome simpel) + tombol `📜 Garansi & Ketentuan` dan `🛍️ Lanjut Belanja`.
- Command `/garansi` (terdaftar di menu) mengirim ketentuan third-party + 6 syarat klaim (ganti/perbaikan, bukti invoice + screenshot, proses 1–3 hari dan solusi refund jika gangguan berlanjut setelah maksimal 3 hari; garansi ikut deskripsi produk, revisi 2026-10-15).
- Konfirmasi beli memakai tombol `✅ Saya Paham, Lanjut Bayar` + tombol `📜 Syarat Garansi`; invoice/pre-bayar menegaskan lanjut bayar = setuju ketentuan.
- Detail produk menunjuk garansi ikut deskripsi + `/garansi`; pesan delivery/manual mengingatkan simpan invoice untuk klaim.

### Pengiriman non-WR ke pembeli web + Kirim ke pembeli (2026-09-25, migrasi 0043)

Laporan owner, 2026-09-25.
Temuan read-only produksi: 100% item non-WR kanal web berakhir `manual_required`
karena `send.ts` memaksa semua item web ke antrean admin
(`web_channel_requires_manual_handover`), padahal checkout web mewajibkan email dan
badge storefront menjanjikan "Kirim otomatis". Perubahan:
- **Kirim otomatis lewat email.** Item web mode `shared`/`unique` dikirim oleh
  `sendWebDeliveryEmail` (`src/lib/fulfillment/delivery/buyer-email.ts`) dengan template
  **"Pesanan Siap"** (`buildOrderReadyTemplate`). Emailnya sekaligus memuat tanda terima
  pembayaran, jadi pembeli menerima SATU email (keputusan owner). Idempoten per item lewat
  `buyer_notice_log` kunci `email:fulfillment-item:<id>`: baris `sent` tidak dikirim ulang
  saat retry (kirim sukses tetapi tulis status gagal). Resend gagal → jadwal retry
  1/5/15/60 menit → `failed` + alarm admin + kabar pembeli (mesin lama). Mode `manual`
  (Made By Order) → `manual_required` di semua kanal. Order web tanpa email valid →
  `manual_required` dengan `web_no_buyer_email`.
- **Tanda terima terpisah hanya bila perlu.** `ensureFulfillmentForPaidOrder` kini
  mengirim tanda terima web SETELAH upaya kirim pertama, dan melewatkannya bila semua baris
  sudah `delivered` otomatis (`webOrderAutoDelivered`: `delivered_message_id LIKE 'item:%'`).
  Made By Order, pesanan campuran, kirim tertunda, dan `AUTO_FULFILLMENT_ENABLED` mati
  tetap menerima tanda terima.
- **Salinan isi terkirim** (`fulfillment_items.delivered_ciphertext/iv`). Isinya ciphertext
  pesan bersama atau unit stok yang disalin apa adanya saat kirim, jadi halaman pesanan tetap
  menampilkan isi yang sama walau pesan bersama diganti kemudian. `/api/orders/[code]/credentials`
  (POST verifikasi 6 digit WA atau email checkout, GET capability token yang diverifikasi dulu) mengembalikan
  detail WR + salinan ini dengan `label` baris pesanan. `credentials_ready`
  (`GET /api/orders?code=`, `/api/orders/lookup`) dan `issueCredentialToken` kini juga
  menghitung salinan ini. **Paritas WR-SK (2026-10-03, kasus F111FD64):** `handleWrOrderCompleted`
  kini bind link→item otomatis (`bindWrLinkToFulfillmentItem`, idempoten) + menulis
  ciphertext ke baris item (pola `settleSkFulfillmentItem`) sehingga panel membaca kredensial
  WR — sebelumnya WR hanya flip status dan panel tidak pernah melihat kredensial meski link
  completed. `readDeliveredSnapshots` mengecualikan item `wr:%` (anti-duplikat: link WR sudah
  dibaca dari `wr_order_links`); item `sk:%` tetap dibaca (SK tanpa jalur link di credentials).
- **Kirim ke pembeli** (dulu "Serahkan manual"). `GET /api/admin/orders/[code]/handover`
  mengembalikan `label`, `has_content`, dan `template_text`, yaitu
  `product_variants.handover_template` yang placeholder `{email}`, `{nama}`, `{kode}`,
  `{produk}`-nya sudah diisi di server. `POST` menerima `buyer_message` (≤4000). Isi itu
  dienkripsi (`encryptSecret`, tanpa kunci → `storage_error`, tidak pernah disimpan polos) di
  UPDATE yang sama dengan flip `delivered`. `notifyBuyerHandover` mengirim isi itu lewat email
  "Pesanan Siap" (web) atau DM Telegram (di-escape). Isi **tidak pernah** masuk outbox WA
  (`whatsappFallback:false`), karena outbox menyimpan teks polos dan bot WA mati: order web
  tanpa email → `buyer_notified:false`. Tanpa isi, pembeli menerima kabar "Pesanan
  Diserahkan". Template per varian disunting di panel varian Made By Order
   (`ProductVariantRows`) dan disimpan lewat `POST /api/admin/fulfillment`
   `action:"set_handover_template"` (≤2000; kosong = hapus).
- **Notif admin "Lunas — Web"** (menggantikan ping serah terima terpisah, 2026-09-25): lihat
  subbagian berikut.
- **Semua email pembeli bermerek.** `renderBrandedNotice` (shell Midnight + Cyan, logo,
  tombol Lihat Pesanan, blok bantuan WA) dipakai untuk tanda terima, serah terima, bukti
  ditolak, bukti menunggu Hook, pengiriman tertunda, dan pengingat QRIS kedaluwarsa. Isi di-escape
  dan tanpa emoji.
- **Teks pembeli.** Blok pengiriman di `/pesanan/[code]` menyebut email sebagai
  tujuan (WA hanya untuk order lama tanpa email); sejak 2026-09-25 produk kirim otomatis
  dan detailnya tampil dalam hitungan detik; sejak sore 2026-10-02 fase menyiapkan
  ±30 dtk pertama = skeleton tanpa teks pengiriman (tanpa bacaan yang bisa hilang
  saat panel muncul); sejak 2026-10-02 judul +
  nada dibedakan per keadaan — "Pesanan Made By Order" (C1 manual by design, tanpa alasan
  stok) vs "Pengiriman oleh Admin" (C2 instan-gagal: "Stok otomatis habis, jadi admin
  menyiapkan manual"), jalur otomatis tidak pernah menyebut admin/12 jam (lihat Storefront di
  bagian Warung Rebahan). PDP menampilkan "Tergantung varian" untuk
  varian campuran sebelum pembeli memilih. Dulu ringkasannya mengikuti varian pertama, jadi
  Canva tampil "Kirim otomatis" walau 2 dari 3 variannya Made By Order.
- Dikunci oleh `tests/nonwr-web-delivery.integration.test.ts`,
  `tests/nonwr-handover-content.integration.test.ts`, `tests/admin-handover-dialog.behavior.test.tsx`,
  dan `tests/nonwr-delivery-copy.test.tsx`. Item web `manual_required` lama di produksi tidak
  dikirim ulang otomatis; admin menyelesaikannya lewat Kirim ke pembeli.

### Notif admin order web: "Lunas — Web" (2026-09-25)

Laporan owner: order web tidak pernah muncul di grup `Axvara_Notif`, order Telegram muncul.
Notif lama "Order Baru — Web" (`POST /api/orders`) membangun tombol dengan
`SITE_URL ?? fallback`. SITE_URL kosong di worker (§16.4), jadi tombol "Panel Admin" menjadi
URL relatif dan Telegram menolak SELURUH pesan. Hasil kirim diabaikan: tanpa log, penanda,
atau retry. Notif Telegram/WA memakai `||` sehingga tetap jalan.
- Keputusan owner: order web **hanya dinotif saat lunas**. "Order Baru — Web" dihapus dari
  `POST /api/orders` (11 dari 20 order web dua minggu terakhir tidak dibayar).
- `notifyWebPaidAdmin` (`order-notifications.ts`) dipanggil `ensureFulfillmentForPaidOrder`
  setelah upaya kirim pertama, sehingga pesannya memuat status kirim (`summarizeWebDelivery`):
  jumlah item terkirim otomatis ke email, perlu **Kirim ke pembeli**, sudah diserahkan admin,
  sedang dikirim, atau diproses Warung Rebahan. Judulnya "Lunas — Web", atau "Lunas — Web ·
  perlu dikirim admin" bila ada item `manual_required`/`failed`.
- Sekali per order lewat `buyer_notice_log` kunci `admin-paid:<kode>` (kanal telegram). Kolom
  `error` menyimpan alasan penolakan Telegram, jadi kegagalan berikutnya bisa dibaca di D1.
- URL tombol lewat `siteOrigin()` (`src/lib/site-url.ts`), selalu absolut. Tombol WA
  (`webPaidAdminKeyboard`) hanya dipasang untuk nomor `62…` yang valid. Bila Telegram tetap
  menolak tombol (400 Bad Request), pesan dikirim ulang **tanpa tombol**. Timeout tidak diulang
  seketika (pesan bisa saja sudah sampai); cron yang mengulang.
- Cron `operations` (fase notify) menghitung `paid_admin_web` dengan
  `WEB_PAID_ADMIN_PENDING_WHERE`: order web lunas dalam 6 jam terakhir tanpa ledger `sent`.
  `retryPendingTelegramNotifications` menerima `paidAdminWeb`; pemanggil lama yang memberi
  `only` tanpa kunci ini tidak membaca antrean web (anggaran query RR3-01). Order lama
  (>6 jam) tidak pernah dikirim ulang, jadi deploy tidak membanjiri grup.
- Dikunci oleh `tests/web-paid-admin-notif.integration.test.ts` (termasuk cron sungguhan).

## 14. Varian Produk Terpusat dan Bot Grup WhatsApp AXVARA (Terimplementasi)

Sistem varian produk terpusat dan bot WhatsApp telah diimplementasikan sesuai `docs/WHATSAPP-GROUP-BOT-PLAN.md`:

### Arsitektur
- **D1 sebagai Source of Truth:** `products` menyimpan produk induk (`name`, `whatsapp_alias`, search `aliases`, description, image, badge), sedangkan `product_variants` menyimpan SKU yang dapat dibeli (label, duration, warranty, price, stock, `min_qty` (migrasi 0034, milik admin, default 1 — GSuite 50), fulfillment_mode, sort_order). `whatsapp_alias` hanya mengatur nama presentasi di daftar/header WhatsApp dan fallback ke `name` bila kosong; `aliases` tetap khusus kata kunci pencarian bot.
- **Nama publik Antigravity (migrasi 0045):** `gemini-ai-antigravity` ditampilkan sebagai `Gemini AI Antigravity` tanpa suffix `(WR)`. Identitas integrasi tidak bergantung pada nama; `source='warung_rebahan'`, `wr_product_id`, dan registry WR tetap menjadi authority.
- **CMS Web:** Modal card-based `VariantEditor` di `/admin` mengelola SKU/durasi/garansi/harga/stok dengan tombol aksi konsisten; form produk memiliki field Alias WhatsApp. Menu **Pesanan** memakai tab Web/Telegram/WhatsApp, pagination, thumbnail bukti, dan aksi setujui/tolak bukti WhatsApp langsung pada baris pesanan; halaman **Bukti Bayar** terpisah telah dihapus. Menu **Bot & Otomasi** memilih target varian untuk mode `manual/shared/unique`, shared secret terenkripsi, dan inventory unik. Pembuatan produk juga membuat varian default secara atomik. Produk/varian yang dihapus diarsipkan (`is_active=0`) agar relasi historis tetap utuh; edit harga/stok melalui form produk hanya disinkronkan bila produk masih mempunyai satu varian default. Sejak fix Canva Sep 2026: `PUT /api/products/:id` yang membawa `variants` eksplisit TIDAK lagi menilai/menulis kolom legacy `price/stock/compare_price` — master dihitung ulang dari varian aktif (`MIN(price)`, agregat stok, `compare_price` NULL untuk multi-varian), sehingga save produk multi-varian tidak lagi 409. Guard 409 hanya berlaku untuk edit legacy TANPA `variants`. Client `useProductManager` mode varian tidak lagi mengirim kolom legacy.
- **Service Bersama:** `src/lib/catalog.ts` menyediakan query terpusat untuk web, Telegram, dan WhatsApp. `src/lib/warranty-policy.ts` mengekstrak kebijakan garansi kanonis dengan formatter Telegram (HTML) dan WhatsApp (bold `*`).
- **Website:** Halaman detail `/produk/[slug]` mendukung variant selector interaktif; cart Zustand membedakan item berdasarkan kombinasi `product_id + variant_id`; checkout quote mendukung variant_id.
- **Telegram Bot:** Menambahkan langkah pemilihan varian sebelum konfirmasi beli (`TELEGRAM_VARIANT_FLOW`). Menggunakan harga dan konfigurasi varian.
- **Navigasi & marketing Telegram Fase 1:** label menu bawah (`MENU_LABEL_*`: 🛍 Katalog · 🔎 Cari · 🛒 Keranjang · 📦 Pesanan · ❓ Bantuan terpusat di `keyboards.ts` dan tetap di-route sebagai teks di webhook untuk keyboard lama); `/start` hanya mengirim satu foto welcome + `homeKeyboard` tanpa bubble "Menu cepat" tambahan; command `/cari`+`/search`, `/orders`+`/riwayat`, `/cart`+`/keranjang`; welcome landing `/start` menampilkan 3 bestseller by `sold_count`; `Terjual X` (compact `1.5rb+` di ≥1000) di kartu produk; riwayat `/orders` 10 terakhir by `telegram_user_id` dengan keyboard `myOrdersKeyboard` (detail + `reorder:*` → beli lagi); pencarian nama/alias via `pending_action=search:` + `/batal`; breadcrumb `breadcrumbLine` (`Langkah X/4`) di pilihan varian (2), langsung qty (3) tanpa konfirmasi tambahan, invoice (4). Payment/fulfillment tidak berubah.
- **Keranjang + reminder Telegram Fase 2 (tanpa review/promo):** tabel `telegram_carts` (migrasi 0014, `UNIQUE(user_id, variant_id)`, CHECK qty 1–100, maks 20 baris/user; maksimal 1 baris fulfillment `unique` per keranjang karena `findReservedForOrder` + `fulfillment_jobs` memakai satu `order_code`); lib `src/lib/telegram/cart.ts` (`addToCart`/`setCartLineQty`/`removeFromCart`/`clearCart`/`getCartSummary` dengan pembersihan baris basi); tombol `🛒 + Keranjang` (`cadd:*`) di langkah qty berdampingan dengan Bayar QRIS langsung; `/cart` memakai `cartKeyboard` (➖/➕/❌ per baris, `ccheckout`, `cclear`) lalu ringkasan `cartCheckoutSummaryMessage` + konfirmasi `cconfirm` sebelum invoice terbit; checkout gabungan `createAndSendCartInvoice` = SATU order + SATU `createDanaQrisInvoice` + SATU `createFulfillmentJob` mode dominan (unique > shared > manual; campuran → job manual + snapshot `mixed` informatif), stok finite dipotong per baris dengan rollback kompensasi; cart dikosongkan hanya setelah invoice terbit; reminder pending via `sendPendingOrderReminders` di cron operasi (maks 2x/order, interval ≥60 mnt, JOIN invoice aktif `pt.status='pending'` + `expires_at` masa depan, claim CAS `telegram_reminder_count`, copy eskalatif `orderReminderMessage`).
- **Input jumlah + konfirmasi email Telegram (2026-09-27):** qty tetap memakai
  stepper, ditambah callback owner-bound `qinput:<productId>:<variantId>` yang
  memasang `pending_action=qty_for:*` dan mengirim ForceReply dengan rentang
  live (`min_qty` sampai min(stok,100)); input di luar rentang ditolak tanpa
  clamp diam-diam. Varian Invite/Link/`require_email` memakai CTA **Lanjut Isi
  Email**; `email_for:*` menyimpan email lalu menampilkan alamat masked. Callback
  owner-bound `epay:*` memanggil kembali `handlePayWithQris(...,
  emailConfirmed=true)`, sehingga guard stok, minimum, pending-order, dan
  atomisitas invoice tetap dilalui. `eedit:*` membuka ForceReply email baru dan
  `qty:*` kembali ke jumlah; tidak ada email mentah di callback data.
- **Daily Promo Digest (2026-09-27, revamp 2026-09-29, revamp 2026-10-01):** fase notify cron membuat dua materi siap
  salin pada 09.00/17.00 WIB. Sejak 2026-10-01 (permintaan owner, contoh ceklis WR/SEKUDIL): SEMUA produk ready masuk pesan (bukan 12+12 paruh; `selectPromoProducts` = seluruh kandidat; histori/seed dipertahankan tapi tidak memotong); format Axvara dipertahankan (judul + hook 2026-09-29 + kelompok per kategori + harga tegas varian purchasable termurah tanpa "Mulai"/disclaimer + CTA bot + web) — hanya baris produk + ✅. Kandidat = produk ready non-pecundang (`telegram_enabled=1`, pecundang supplier-pair dikecualikan). Dua bubble memakai ledger migrasi 0044;
  retry parsial tidak mengirim ulang bubble yang sudah memiliki `message_id`.
- **Flow order Telegram (WA parity, payment khusus QRIS):** `/katalog` menampilkan daftar datar nama produk + harga (tanpa kategori wajib; kategori hanya filter opsional). **Sejak 2026-09-24 katalog, filter kategori, pencarian, dan bestseller `/start` hanya memuat produk yang BISA DIBELI** (`listTelegramProducts` + `purchasableStockSql` di `src/lib/catalog-availability.ts`: varian aktif dengan stok -1 atau ≥ `min_qty`),   memakai snapshot katalog publik 30 detik sejak 2026-10-17 (Cache API per lokasi; tanpa Cache API baca D1 langsung), dengan harga = varian tersedia termurah. Detail/checkout tetap membaca dan memvalidasi stok/harga aktual. Definisi "tersedia" ini web + Telegram SAMA (2026-10-01, revisi keputusan owner yang mengubah revisi 2026-09-30): daftar web (`GET /api/products?active=1`) MENAMPILKAN produk habis di akhir dengan `soldOut: true` (badge habis, tanpa tombol beli; urutan ready → habis → nonaktif via `sortProductsForDisplay`) untuk trust + mengurangi komplain "kok kemarin ada, sekarang hilang"; Telegram + `llms.txt` tetap hanya produk yang bisa dibeli (chatbot tidak bisa menjelaskan barang yang tidak bisa dibeli; tanpa `soldOut`). PDP langsung (`/produk/[slug]`) + search (`?q=`) tetap bisa akses produk habis. Kartu habis otomatis tampil lagi sebagai ready saat restok (tanpa cron/state). Dikunci oleh `tests/seo-geo.regression.test.ts` + `tests/catalog-available-price.regression.test.ts`. Halaman dari tombol lama dibatasi ke halaman terakhir yang ada. Detail produk tanpa deskripsi, menampilkan foto produk web + list garansi per varian dari `product_variants` yang sama dengan web/WA. Alur beli: `Produk → Varian → Qty stepper (➖ / jumlah / ➕, angka manual 1–100) → QRIS DANA dinamis`; tidak ada SeaBank/e-wallet di Telegram. CTA jumlah langsung menerbitkan satu pesan QRIS tanpa layar pemilihan metode dan tanpa kewajiban menekan cek status. QRIS Hook melunasi order atomik, menambah `sold_count`, lalu mengirim pesan sukses otomatis. Untuk fulfillment manual, pending input WA baru dipasang setelah `paid`; buyer juga mendapat tombol WhatsApp admin dan `@axvara_support` — input WA reply-only tanpa tombol loop. Order-created ke grup admin dan paid ke buyer memakai marker D1 idempoten serta retry cron; paid juga dikirim sebagai pesan `Lunas — Telegram` tersendiri ke grup admin via `telegram_paid_admin_notified_at` (migrasi 0013) agar status grup tidak tertinggal menunggu bayar. Guard anti-double-tap memakai ulang order pending chat+varian yang sama; varian stok unik dibatasi qty 1. Sapaan WIB dinamis (Pagi/Siang/Sore/Malam + tanggal/jam) hanya di welcome/bantuan — katalog tampil bersih tanpa pengulangan sapaan/tanggal/jam.
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
| `product_variants` | SKU varian produk (harga, stok, durasi, garansi, fulfillment). Migrasi 0043: `handover_template` (milik admin, varian Made By Order non-WR; ditulis hanya lewat `POST /api/admin/fulfillment` action `set_handover_template`) |
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
- **Lifecycle Stok & Pembayaran:** QRIS berlaku 15 menit untuk SEMUA kanal (keputusan owner 2026-10-11; sebelumnya Telegram/Web 60 menit dengan 1x perpanjangan QR — window 60 menit itu yang membuat 1 order iseng mengunci stok 1 jam). QR mati = order kedaluwarsa = stok dilepas via cron ±5 menit. Pembeli yang berubah pikiran / salah varian membatalkan sendiri dari halaman pesanan atau lacak pesanan (`POST /api/orders/[code]/cancel`: verifikasi kode + WA/email checkout pola lookup, 404 generik anti-oracle, hanya pending+unpaid, CAS `transitionPendingOrder` yang sama dengan admin sehingga kalah race vs webhook = 409 jujur + stok tidak ganda + ledger paid tidak tersentuh). QRIS Hook memperbarui ledger+order dalam satu batch guard. Cron memakai deadline order DANA (fallback invoice untuk legacy tanpa deadline), memeriksa deadline ulang dalam batch sebelum melepas stok. Migrasi 0026 menyesuaikan deadline WA/QR pengganti yang sudah pending dan menambah `payment_transactions.expiry_notice_state` (`renewable`/`terminal`). `src/lib/payments/qris-expiry-notifications.ts` mengirim tombol pembaruan hanya bersama pesan kedaluwarsa pertama Telegram; kegagalan kirim tetap pending, dan pesan terminal WA memakai outbox idempoten per order. Marker reset saat reissue bersama reset delivery foto Telegram, tanpa membuat QR tambahan. Helper memakai budget D1 request yang sama (1 list + maksimal 2 query per pesan). Notifikasi mengikuti cron 5 menit; deadline penerimaan pembayaran tidak menunggu cron. `GET /api/orders?code=...` dan `/api/orders/[code]` mengembalikan `expires_at` dan `qris_reissue_allowed` untuk halaman pesanan. Rail manual WhatsApp tanpa ledger tetap memakai TTL sebelumnya.
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
  `POST /api/admin/warung/orders/[id]/void` (2026-09-28: batalkan link WR tertahan → terminal `failed` + `last_error='cancelled_by_admin'`, CAS sama seperti retry; tanpa status baru agar CHECK tidak perlu ALTER),
  `POST /api/admin/warung/orders/[id]/sync-now` (2026-10-03, kasus F111FD64: tarik status SATU link processing langsung dari /transactions — webhook completed WR sering tidak sampai sehingga buyer menunggu 1 jam sia-sia; read-only upstream + idempoten, 409 bila status bukan processing/submitted/ordering),
  `GET/POST/DELETE /api/admin/warung/exclusions`, `GET/PUT /api/admin/warung/markup`,
  `GET/POST /api/admin/warung/credentials` (retrieval + resend admin).
- **Storefront:** `WrCredentialsPanel.tsx` di halaman pesanan (lunas): verifikasi
  No. WA atau email checkout (email sejak 2026-09-25; order tanpa email tidak pernah cocok) →
  tampilkan detail akun + capability token (sessionStorage). Setelah checkout di tab yang sama
  panel membuka otomatis memakai kontak checkout (`sessionStorage`
  `axvara-checkout-contact:<kode>` via `checkoutContactKey`). Sejak 2026-09-25 kontak itu
  TIDAK dihapus saat dipakai dan bertahan sampai tab ditutup: dulu muat ulang di tengah
  verifikasi pertama membuat token tidak pernah tersimpan (server tidak menerbitkan token
  kedua, `issueCredentialToken` idempoten) sehingga panel kembali ke form kosong. Token
  tersimpan yang ditolak server (401/403) dibuang lalu panel jatuh ke kontak checkout;
  429/5xx/jaringan tidak membuang token.
  Panel HANYA dirender bila `credentials_ready === true` dari `GET /api/orders?code=`
  (flag boolean: ada `wr_order_links` `completed` + `wr_account_details` ATAU item non-WR
   `delivered` bersalinan, dievaluasi hanya untuk order `lunas`, `.catch` → `false` pada D1
  pra-0027). Order lunas tanpa kredensial mendapat blok pengiriman berisi
  tujuan pengiriman (email checkout tersamar; WA hanya order lama tanpa email) — bukan
  form verifikasi yang pasti gagal `not_ready`. Judul + teksnya dinamis per cabang
  (`delivery.title`, revisi copy A/B/C1/C2 2026-10-02, copy email 2026-10-07):
  `fulfillment_status='delivered'` → "Pengiriman Produk" + order ber-email:
  "Detail pesanan akan otomatis dikirimkan di email saat order dan akan tampil
  di halaman ini." + cek spam/promosi; order lama tanpa email: "Produk sudah
  dikirim ke WhatsApp …" (tanpa cek spam);
  `queued_delivery` (C1 Made By Order, manual by design) → "Pesanan Made By Order" tanpa
  alasan stok + "Umumnya kurang dari 1 jam, maksimal 12 jam" (tanpa jam layanan spesifik);
  `instant_delivery` + `manual_required` (C2 instan-gagal) → "Pengiriman oleh Admin" +
  alasan "Stok otomatis habis, jadi admin menyiapkan manual" + plafon yang sama;
  **Pagar supplier (2026-10-13): kedua cabang C1/C2 di atas HANYA untuk order
  non-supplier.** Order supplier (`supplier_owned` dari flag API) tidak pernah
  menampilkan kalimat stok/admin/Made By Order — selama link supplier masih
  berjalan (`supplier_running`) tampilannya skeleton menyiapkan yang sama
  dengan stok sendiri, lalu "Pengiriman Otomatis" versi lambat. Akar insiden:
  pipeline fulfillment generik sempat memvonis item SK `manual_required`
  dalam jendela balapan sebelum link ter-bind, dan halaman salah
  menerjemahkannya sebagai stok habis;
  `instant_delivery` belum selesai → skeleton "Menyiapkan detail produkmu…" TANPA teks
  pengiriman selama ±30 dtk pertama (sore 2026-10-02: tanpa bacaan yang bisa hilang
  saat panel muncul), lewat ±30 dtk → "Pengiriman Otomatis" + "Masih mengirim otomatis
  — butuh waktu lebih lama" (tetap tanpa admin/12 jam; order ber-email ditambah
  kalimat email + halaman ini);
  selain itu (produk WR) → estimasi 5–15 menit.
  Selama `lunas && !credentials_ready`, halaman mem-poll `GET /api/orders?code=`: order
  `instant_delivery` yang belum `delivered`/`manual_required`/`failed` dicek rapat dulu
  2 dtk ×5 lalu 5 dtk ×4 (±30 dtk, 9 permintaan — tetap di bawah `orders:lookup` 20/mnt
  walau bertemu sisa polling pending 5 dtk; di produksi item terkirim 0–4 dtk setelah
  lunas), lalu tiap 20 dtk maksimal 30 kali (±10 mnt); antrean dan kirim otomatis yang
  diserahkan ke admin hanya 3 percobaan. **Sejak 2026-10-13 order supplier yang
  linknya berjalan ikut jadwal rapat yang sama**, dan setiap poll memicu tarikan
  status vendor di server (lihat "Penyegar status supplier" di bawah), sehingga
  panel muncul hitungan detik setelah vendor `COMPLETED` — paritas SK untuk WR.
  Retrieval tetap wajib verifikasi WA/email atau capability token.
  Display dinormalisasi di USE-time via `normalizeAccountDetailsForDisplay`
  (2026-09-18 sore, live): data lama tersimpan sebagai JSON mentah
  `{"product":..,"details":"email:..\r\npassword:.."}` diformat rapi di SEMUA
  kanal (panel, WA, email, Telegram) tanpa migrasi data — envelope dikupas
  (maks 3 lapis), `\r\n` dinormalisasi SEBELUM split, pembungkus
  `{product,details}` hanya memakai `details`-nya, label ganda dibuang.
  Ciphertext TIDAK diubah (format simpan tetap).
- **Kelas pengiriman + auto-order antrean (18 Sep 2026, live; sumber kebenaran
  delivery_mode API sejak 2026-10-11).** `wr_delivery_class`
  membedakan `restock` (instan) dari `made_by_order` (dikerjakan manusia di sisi
  supplier; estimasi supplier 6–12 jam, "<1 jam bila lancar"). Sejak 2026-10-11
  kelas diturunkan dari `delivery_mode` resmi API WR (`wr_delivery_mode`:
  auto→restock, manual/mixed→made_by_order; migrasi 0060) dan mengalahkan
  seed/tebakan/kunci admin — bukan lagi tebakan semata. Gate lama hanya
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
  mengirim `queued_delivery` dan `instant_delivery` (satu query gabungan dengan
  `credentials_ready`, CTE `lines` dari `json_each(orders.items)`), dan halaman pesanan memakainya untuk memilih
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
  `AdminShell` + `admin/page.tsx`): **tab dalam-halaman Ringkas/Antrean/Markup/Aturan (2026-10-01, cermin SystemTabs)** — Ringkas default (saldo + estimasi + sync terakhir + force sync), Antrean (order + retry + void + pagination 20 + total, sandbox SK di tab Antrean SK), Markup (sub-tab status Live/Hidden/Off + badge + pagination 20/50/100, tombol Simpan tetap ada di semua tab), Aturan (exclusions). Lazy-load per tab (fetch saat dibuka pertama, cache + guard ref anti-fetch-ganda; mount hanya Ringkas). Antrean order + retry + void (tombol Batal → terminal `failed` + `last_error='cancelled_by_admin'`, CAS; 2026-09-28), exclusions, markup per varian. **Bulk markup (2026-10-01):** `POST /api/admin/warung/markup/bulk` — 1 request untuk ≤200 varian (formula harga SAMA dengan PUT satuan via `calculateSellPrice`; default hanya % yang berubah, Rp dipertahankan kecuali `update_fixed=true`; respons jujur `{ updated, failed[] }`; harga katalog ikut berubah) + toolbar bersama `BulkMarkupToolbar.tsx` (checkbox per baris + "Set semua tampil" + preset 20/30/50 + % manual + reset Rp + konfirmasi hitungan eksplisit). **API markup (2026-10-01):** `variant_status` + `variant_reason` per baris (hierarki off > kalah > tanpa-katalog > habis > live) + `total` hasil filter, limit 200 (1 fetch, filter klien). **API orders (2026-10-01):** `total` + `page` + `per_page` (halaman 2+ dulu hilang). Komponen bersama `SupplierTabs.tsx` (tab + `VariantStatusBadge`). Auto-revive `blocked_balance` dibatasi umur 24 jam (`WR_BLOCKED_MAX_AGE_HOURS`) + hanya order lunas; buyer dikabari sekali saat masuk blocked (idempoten `wr-blocked:<kode>`). Antrean order punya kolom cari
  invoice WR (`#RBHN-…` / kode Axvara, debounce 400ms, LIKE di-escape) +
  baris buyer (nama · WA · email · channel) — jembatan manual forward email WR
  ke buyer Axvara sebelum bot email otomatis fase 2. Health WR ikut `GET /api/admin/bot/health`.
- **Cron:** fase baru `warung_rebahan` disisipkan `fulfillment → warung_rebahan → notify`
  (`src/app/api/cron/operations/route.ts`): sync produk tiap 30 mnt, proses order due (maks 4),
  reconcile processing >1 jam via `/transactions` + reconcile FRESH processing >3 mnt
  (2026-10-03, kasus F111FD64: webhook completed WR sering tidak sampai padahal
  dashboard WR sudah COMPLETED hitungan menit setelah lunas — maks 4 link/run,
  read-only + idempoten), cek saldo tiap 1 jam. COUNT WR dihitung
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
- **Kejujuran status pengiriman + jalan keluar admin (audit UX 2026-09-22):** pola akar yang
  ditutup di sini bukan satu bug, melainkan **server sudah tahu jawabannya tetapi UI
  membuangnya**. (1) `deliverWhatsAppCredential` dulu `return` diam saat kill-switch
  `WHATSAPP_CREDENTIAL_DM_ENABLED` mati, sehingga `processCredentialDelivery` tetap menulis
  `delivery_status='delivered'` walau NOL pesan terkirim — pembeli kanal WhatsApp melihat
  "Selesai" dan menerima nihil. Kini **throw** (`whatsapp_credential_dm_disabled`) → retry →
  `failed` → antrean handover. Bedakan tegas dengan `deliverWebCredentialViaWhatsApp` yang
  MEMANG boleh skip diam: kanal web punya token capability + panel pesanan + email sebagai
  jalur pengambilan, kanal WhatsApp tidak punya jalur lain. (2) `fulfillment_status='failed'`
  (ditulis `warung-rebahan/order.ts` saat attempt WR habis dan `deliver.ts` saat delivery
  habis 5 percobaan) tidak punya tombol apa pun di admin padahal
  `recordManualHandoverDetailed` menerimanya — order lunas yang gagal kirim = jalan buntu
  yang hanya bisa dipulihkan lewat operasi DB. (3) Jalur fulfillment modern
  (`delivery/send.ts:processItem`) membuang `adminChatId` dengan `void`, jadi kegagalan
  terminal tidak pernah membunyikan Telegram — padahal jalur legacy mengirimnya; kini
  `scheduleItemRetry` mengembalikan `true` HANYA pada transisi terminal (berbasis
  `meta.changes`, sehingga fence yang kalah race tidak mengirim alert ganda). (4) Gerbang
  retry link WR di UI **terbalik** terhadap API: `blocked_balance` (retryable,
  `attempt_count` masih 0) tak pernah dapat tombol, sedangkan `failed` selalu dapat tombol
  padahal route menolaknya dengan `max_attempts_reached` — `failed` hanya ditulis ketika
  `attempt >= max_attempts`. Kini UI memakai `RETRYABLE_WR_STATUS` yang wajib identik dengan
  `RETRYABLE` route plus cek kuota percobaan, dan status `claimed`/`submitted`/
  `blocked_balance` akhirnya punya label + bisa difilter (`allowed` di
  `admin/warung/orders`). (5) Approve screenshot QRIS membalas `payment_updated:false`
  (QRIS Hook tetap otoritatif) tetapi admin selalu melihat toast "dikonfirmasi lunas" —
  kabar palsu yang bisa memicu pengiriman sebelum uang masuk. (6) `proofRejectionReason` dan
  `fulfillment_status` sudah di-parse `normalizeOrder` tetapi tidak pernah dirender; modal
  Detail juga kehilangan tombol Tolak + handover sehingga alur wajar "buka Detail untuk
  memeriksa dulu" justru mematikan aksinya. (7) Produk WR: blok harga/stok **mode single**
  tidak ikut terkunci seperti Nama/Slug, jadi admin yang mematikan toggle Variasi mengedit
  nilai yang dijamin ditolak 409; dan `field` pada respons 409 dibuang sehingga admin tidak
  tahu field mana pemicunya. Dikunci oleh `tests/admin-ux-dead-end.regression.test.ts`,
  `tests/admin-failed-order-actionable.behavior.test.tsx`, dan
  `tests/warung-rebahan/wa-credential-killswitch.regression.test.ts`.
- **Pembeli berhenti menunggu dalam sunyi + atomisitas jalur uang (audit ronde 2, 2026-09-23):**
  ronde 1 menutup kebohongan status di sisi ADMIN; ronde 2 menemukan lubang yang sama di sisi
  PEMBELI. (1) `handleOrderCancel` (Telegram) dulu memulihkan stok LEBIH DULU, lalu
  `UPDATE orders` bergerbang `status='pending'`, lalu `UPDATE payment_transactions` **tanpa
  gerbang apa pun**. Bila webhook DANA melunasi order tepat di sela itu: stok menggelembung,
  order tetap sah `lunas`, tetapi ledger-nya ditimpa `cancelled` — order lunas tanpa transaksi
  `paid`, fulfillment yatim. Kini pembatalan **mengklaim lebih dulu** (CAS `status='pending'
  AND payment_status IN ('unpaid','pending')`); bila kalah balapan, handler berhenti tanpa
  menyentuh stok maupun ledger, dan UPDATE ledger diberi gerbang
  `status IN ('pending','unpaid','expired')` agar baris `paid` tidak pernah tertimpa.
  (2) **Harga basi**: token quote berlaku 1 jam (`createCheckoutQuoteToken`) sementara sync WR
  menulis ulang harga varian tiap ~5 menit; `sameItems` hanya menyamakan identitas + qty dan
  `createOrderWithStock` **tidak punya satu pun guard harga**, sehingga order + invoice QRIS
  bisa terbit dari `quote.subtotal` yang usang (harga naik = toko rugi, turun = pembeli
  dirugikan). Kini harga DB dibandingkan dengan harga quote → `409 price_changed`, dan
  checkout memuat ulang quote agar pembeli melihat nominal baru, bukan buntu di pesan error.
  (3) **Kabar ke pembeli** lewat `src/lib/notify-buyer.ts` (kanal ditentukan dari
  `orders.sales_channel`; Telegram hanya ke chat pribadi terverifikasi, **web lewat email
  Resend sejak 2026-09-24** (lihat entri audit ronde 4), WA lewat outbox durable yang
  idempoten): serah terima manual dulu menandai item `delivered` tanpa satu pun
  pesan padahal pesan lunas Telegram sudah berjanji "Produk akan dikirim admin melalui DM
  Telegram pribadi ini"; penolakan bukti hanya menulis `status='rejected'` sehingga pembeli
  melihat "Pending" selamanya tanpa alasan; dan persetujuan screenshot QRIS membalas
  `payment_updated:false` (Hook tetap otoritatif) tanpa memberi tahu pembeli harus menunggu
  apa. Semua kabar best-effort dan tidak pernah melempar — kegagalan kirim tidak boleh
  membatalkan serah terima/review yang sudah sah tercatat. (4) **Guard order ganda**: jalur
  keranjang menegakkan satu pending per chat, tetapi beli-langsung dan katalog hanya
  mencocokkan `variant_id` — satu chat bisa memegang 2 order pending + 2 QRIS aktif dengan
  stok tertahan ganda. Kini ketiganya per-chat, dengan varian yang sama tetap diprioritaskan
  agar kirim-ulang invoice (RR3-05) tidak bergeser. (5) Pencocokan produk pending memakai
  `items LIKE '%"product_id":1%'` yang juga cocok dengan `10`/`11`/`100` karena JSON tersimpan
  tanpa spasi — pembeli produk #10 ditolak gara-gara pending produk #1; kini LIKE berpembatas.
  Dikunci oleh `tests/buyer-silence-and-atomicity.regression.test.ts`.
- **Audit ronde 3 — nama pembeli, uang tanpa pasangan, dan kegagalan yang terlihat (2026-09-23):**
  **Prioritas kanal (keputusan owner):** WEB + TELEGRAM wajib sempurna; WhatsApp bukan kanal
  utama untuk 2-5 bulan ke depan (bot sedang mati, grup dikunci admin-only), jadi temuan
  khusus-WA sengaja TIDAK dikerjakan. (1) Revamp checkout `3d83dd9` menghapus field nama dan
  memakai `email.split("@")[0]` mentah sebagai `customer_name` — prefix email BUKAN nama:
  `budi123@…` tersimpan sebagai "budi123" dan `first.last+promo@…` sebagai
  "first.last+promo", lalu merembes ke sapaan halaman pesanan, notifikasi Telegram admin,
  prefill tombol WA follow-up, pencarian admin, dan ekspor CSV. Kini `deriveNameFromEmail`
  (`src/lib/utils.ts`) membuang plus-addressing + angka, mengubah pemisah jadi spasi, lalu
  mengapitalkan; UX revamp (form tanpa nama) dipertahankan, dan nama yang diisi pembeli
  sendiri TIDAK PERNAH disentuh. (2) Cabang `unmatched` webhook DANA dulu berakhir sunyi
  total — uang MASUK tetapi tidak cocok dengan invoice mana pun, pembeli menunggu sampai
  order kedaluwarsa dan admin hanya tahu bila mengintip `dana_webhook_events`. Kini admin
  di-ping Telegram dengan nominal + sebab (`amount_reused_requires_review` /
  `event_predates_invoice` / `no_active_exact_amount`); ack webhook tetap 2xx agar DANA tidak
  retry. (3) Kegagalan pengiriman terminal kini mengabari PEMBELI
  (`notifyBuyerDeliveryFailed`), bukan hanya admin, dan halaman lacak pesanan membedakan
  lunas-terkirim dari **lunas-tetapi-gagal-kirim** — `/api/orders/lookup` sudah mengembalikan
  `fulfillment_status`, tetapi halaman itu dulu hanya membaca status pembayaran sehingga
  order gagal tampil hijau "Lunas" selamanya (pembeli yang menghapus chat jadi buta total).
  **DITOLAK setelah ditelaah:** klaim "retry WR spam-klik = amplifikasi upstream" — usulannya
  (`attempt_count+1` di route retry) justru MENGHITUNG GANDA karena penaikan counter milik
  worker saat mengklaim dan `handleInsufficientBalance` sengaja mengembalikannya; amplifikasi
  sendiri sudah tertutup CAS (klik bersamaan → 409, dikunci
  `admin-retry-race.regression.test.ts`) dan status `claimed` yang bukan anggota `RETRYABLE`
  (klik berurutan → 409). Dikunci oleh `tests/round3-name-and-money-silence.regression.test.ts`.
- **F7 — pengingat kedaluwarsa QRIS akhirnya sampai ke pembeli WEB (2026-09-23):**
  `QRIS_EXPIRY_NOTICE_WHERE` dulu memfilter `sales_channel IN ('telegram','whatsapp')` sehingga
  kanal web tidak pernah masuk hasil query. Ironisnya justru pembeli WEB yang boleh
  memperpanjang QRIS (`qris_reissue_allowed` hanya mengecualikan WhatsApp, dan gerbang
  `reissueDanaQrisInvoice` memakai `sales_channel!='whatsapp'`), tetapi mereka tidak pernah
  diberi tahu bahwa QR-nya hangus — baru tahu bila kebetulan membuka halaman lagi; tab yang
  sudah ditutup berarti tidak tahu sama sekali. Kebalikannya terjadi di WhatsApp: hanya dapat
  kabar terminal, tidak pernah kabar "masih bisa diselamatkan".
  Jalur untuk web adalah **email (Resend, `sendForwardEmail`)** karena web tidak punya kanal
  chat; email selalu terisi untuk order web sejak revamp checkout 2026-09-23 mewajibkannya.
  Dua nada dipisah sesuai apa yang masih bisa dilakukan pembeli: renewable = ajakan menekan
  "Perpanjang QRIS" di `/pesanan/[code]`, terminal = pesanan sudah mati. Kegagalan kirim tidak
  menandai, agar cron berikutnya mencoba lagi. Dikunci oleh
  `tests/qris-expiry-web-email.integration.test.ts`.
- **Perbaikan antrean notifikasi kedaluwarsa (2026-09-23, live bersama F7 12:58 UTC):**
  8 menit setelah F7 live, antreannya terlihat tersumbat permanen. Migrasi 0026 hanya menandai
  riwayat `terminal` saat kolom dibuat, sehingga 8 order web yang expired sesudahnya (15–23 Sep)
  langsung ikut antre saat kanal web dimasukkan. Dua baris terdepan (urutan terlama-dulu,
  `LIMIT 2`) tidak punya email. Baris tanpa email dulu dilewati tanpa menandai, jadi keduanya
  terpilih ulang setiap cron dan tidak ada notifikasi lain, termasuk Telegram, yang bisa lewat.
  Aturan sekarang, semuanya di `QRIS_EXPIRY_NOTICE_WHERE` sehingga hitungan `qris_notice` cron
  ikut akurat: (1) antrean **hanya berisi baris yang punya tujuan kirim** (web: email; Telegram:
  chat id; WA: conversation). Baris tanpa tujuan tidak dipilih, tidak memakan query, dan tidak
  ditandai, jadi bila email terisi kemudian kabarnya tetap terkirim. Menandainya justru
  memakan kuota query yang dibutuhkan fase expiry (dikunci `cron-budget.integration.test.ts`);
  (2) cabang terminal hanya untuk order dengan `orders.expires_at` <24 jam, karena kabar
  "pesanan kedaluwarsa" yang basi hanyalah spam; (3) urutan: renewable dulu, lalu
  `pt.expires_at` **terbaru** dulu, supaya baris yang gagal terus (bot diblokir, email
  ditolak) tenggelam ke belakang dan tidak menahan kabar baru. Dikunci oleh
  `tests/qris-expiry-queue-blocking.regression.test.ts`.
- **Audit ronde 4 — kabar kegagalan akhirnya sampai (2026-09-24, PR ronde 4):**
  (1) **Kabar pembeli kanal WEB lewat email.** `sendToBuyer` dulu mengirim kabar web lewat
  outbox WhatsApp, padahal bot WA mati (outbox produksi 18–19 Sep: 3 baris `dead`,
  `whatsapp_not_connected`). Akibatnya serah terima, bukti ditolak, bukti menunggu Hook,
  dan gagal kirim **tidak pernah sampai** ke pembeli web. Kini web → email Resend ke
  `orders.customer_email` (wajib sejak revamp checkout); order web lama tanpa email tetap
  jatuh ke outbox WA. Email dan DM Telegram diberi kunci idempoten di tabel baru
  **`buyer_notice_log`** (migrasi 0039: `idempotency_key` PK, `channel` email/telegram,
  `status` sending/sent/failed). Baris `failed` dan `sending` basi >10 menit boleh diklaim
  ulang. Teks email tanpa ajakan "balas pesan ini" (pengirim noreply), menautkan
  `/pesanan/[code]`, timeout 8 dtk. (2) **Kegagalan WR mengabari pembeli (T-H1).**
  Dulu `handleWrOrderFailed` dan jalur percobaan-habis di `order.ts` hanya mem-ping
  admin; `notifyBuyerDeliveryFailed` di `send.ts` tidak pernah tercapai untuk item WR
  (`return false` sebelum lease). Kini `refreshOrderAggregate` mengabari pembeli saat
  agregat pertama kali menjadi `failed` (titik tunggal untuk webhook, reconciler, dan cart
  campuran), dan jalur percobaan-habis ikut memanggilnya; ledger menjaga satu kabar per
  order. (3) **Tanda terima pembayaran web (B-H1):** `ensureFulfillmentForPaidOrder`
  mengirim email "Pembayaran diterima" untuk kanal web (idempoten
  `payment-received:<code>`, tanpa fallback WA). (4) **`/pesanan/[code]` mengenal gagal
  kirim (W-H1):** `GET /api/orders?code=` dan `/api/orders/[code]` kini mengembalikan
  `fulfillment_status`; halaman tidak lagi merayakan "Pembayaran Dikonfirmasi 🎉 … 5–15
  menit" untuk order `failed`, melainkan status merah + langkah hubungi admin (pola
  `/lacak-pesanan`). (5) **Antrean kedaluwarsa (B-H2/B-H3):** peringkat dihitung per jalur
  (`ROW_NUMBER() OVER (PARTITION BY status='pending')`), jadi renewable yang gagal terus
  tidak lagi menahan kabar terminal; `hasTime(10 dtk)` dicek sebelum tiap kiriman dan email
  kedaluwarsa memakai timeout 8 dtk (dulu 20 dtk × 2 bisa melewati deadline run 45 dtk).
  (6) Handover mengembalikan `buyer_notified` dan panel admin menampilkan peringatan bila
  kabar gagal (T-M5). (7) Telegram: `wa_after_paid` hanya menangkap teks mirip nomor
  telepon sehingga tombol menu tidak lagi dibalas "Nomor WA tidak valid" (T-M4); label
  harga tombol memakai `buttonPrice` (nominal utuh bila bukan kelipatan ribuan, dulu
  Rp7.500 tampil "Rp8rb") (T-M3). **Ditolak setelah diverifikasi:** email-gate Telegram
  "fail-open saat DB timeout" (T-H3; setiap query sudah `.catch(() => null)` dan
  `wr_type` dimuat dari varian, jadi timeout justru membuat bot MEMINTA email), hero
  search mati (W-M1; `Hero.tsx` tidak dirender di mana pun, homepage memakai
  `OrbitHero`), dan `ctaDisabled` hardcode QRIS (W-M4; `submit()` sendiri meng-hardcode
  `payMethod="qris"`, jadi checkout memang sengaja QRIS-only). Dikunci oleh
  `tests/round4-buyer-notices.regression.test.ts`, `tests/round4-telegram.regression.test.ts`,
  `tests/order-page-delivery-failed.behavior.test.tsx`, dan
  `tests/qris-expiry-queue-blocking.regression.test.ts`.
- **Permintaan owner 2026-09-24 — pengingat pesanan, SEO & GEO, katalog Telegram (PR 2026-09-24):**
  (1) **Pengingat melayang pesanan belum dibayar** (`src/components/storefront/PendingOrderReminder.tsx`,
  dipasang di layout root): membaca kode pesanan terbaru dari salinan lokal checkout
  (`axvara-orders`, hanya yang dibuat <30 menit — order QRIS mati 15 menit sejak 2026-10-11), lalu **selalu** memastikan status + tenggat ke
  `GET /api/orders?code=` (salinan lokal tidak pernah diperbarui dan bisa sudah dibayar dari
  perangkat lain). Tampil dengan hitung mundur QRIS (atau tenggat pesanan bila QR hangus dan
  perpanjangan masih boleh), satu ketukan ke `/pesanan/[code]`; disembunyikan di `/checkout`,
  `/pesanan/*`, `/admin`; cek ulang tiap 30 dtk saat tab terlihat (jauh di bawah limit
  `orders:lookup` 20/mnt); tombol ✕ menyembunyikan per pesanan per sesi. Salinan lokal checkout
  tidak lagi menyimpan WA/email pembeli. (2) **SEO & GEO:** beranda dirender server (HTML dulu
  "0 produk" tanpa link produk — crawler tanpa JS/crawler AI melihat toko kosong); JSON-LD
  Organization + WebSite + ItemList; default OG/Twitter dengan gambar `public/og/axvara-og.png`
  1200×630 (tanpa canonical/og:url di root agar tidak diwarisi semua halaman); JSON-LD produk
  memakai URL gambar absolut (dulu relatif `/r2/...`, ditolak Google) dan AXVARA sebagai
  `offers.seller` (bukan `brand`); **artikel kini punya `generateMetadata`** (dulu semua artikel
  berjudul beranda, tanpa canonical/gambar); canonical di halaman statis; `/checkout` dan
  `/pesanan/*` noindex (layout segmen); `robots.txt` menutup halaman transaksi, membuka
  `/api/products|categories|store-settings` untuk renderer Google, dan mengizinkan crawler AI
  secara eksplisit; `/llms.txt` baru. (3) **Katalog Telegram** hanya produk yang bisa dibeli
  (produksi 24 Sep: 20 dari 48 produk tersedia; 28 lainnya jalan buntu). (4) **Paginasi katalog
  Telegram tidak lagi membuat pesan baru:** `safeEditOrSend` dulu mengirim pesan baru untuk
  kegagalan edit apa pun; ketuk ▶️ dua kali = dua callback halaman yang sama → edit kedua ditolak
  `message is not modified` → pesan katalog baru. Kini "not modified" = berhasil, dan fallback
  pesan baru hanya untuk HTTP 400 (pesan target foto/terhapus), tidak untuk 429/5xx/timeout.
  Tombol produk yang sudah nonaktif dijawab, bukan diam. Dikunci oleh
  `tests/telegram-catalog-stock.regression.test.ts`, `tests/telegram-safe-edit.regression.test.ts`,
  `tests/seo-geo.regression.test.ts`, `tests/home-ssr-catalog.behavior.test.tsx`, dan
  `tests/pending-order-reminder.behavior.test.tsx`.
- **Hook payment:** setelah lunas di 4 jalur (webhook DANA, retry admin, approve bukti,
  konfirmasi admin) → `createWrOrderLinksForOrder` + `processWrPendingOrders` best-effort;
  cron memproses sisanya. Produk WR dikenali dari `product_variants.wr_variant_id`.
  **2026-10-09 (kasus AXV-20261009-DA1ACF56):** webhook bisa gagal tepat di langkah
  create-link (lunas durable, link tidak ada, COUNT due = 0) → gate `due > 0` di cron
  menutup `processWrPendingOrders` yang di dalamnya ada `reconcileMissingWrLinks` →
  yatim selamanya. Probe yatim (`reconcileMissingWrLinks`/`reconcileMissingSkLinks`)
  kini jalan TANPA gate due di lite `wr_orders`/`sk_orders` (hasilnya ikut membuka gate
  proses + kunci respons `orphan_links_healed`) dan di fase route besar
  (`wr_orphan_links_healed`/`sk_orphan_links_healed`); SK cermin WR.

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
| Admin | foto/`images`, `badge`, kategori, `sort_order`, `is_active`, `admin_description_override`, S&K + cara aktivasi versi admin per varian (`product_variants.admin_terms`/`admin_activation`/`admin_copy_fingerprint`, migrasi 0041; varian WR tetap hanya lewat `PUT /api/admin/variant-copy`, stok sendiri juga lewat batch Simpan Produk), **harga coret (`compare_price`)** — milik admin agar katalog WR bisa pasang diskon/badge seperti produk manual (2026-09-17); insiden Alight/Viu 2026-10-06: harga jual baru yang menyamai/melampaui coret lama DITOLAK CHECK `compare_price > price` sehingga UPDATE katalog gagal (markup panel 200 OK tapi storefront macet — `.catch` menelan error D1, registry berubah, `product_variants.price` tetap). Kini SETIAP tulis harga (PUT/bulk markup WR+SK + sweep sync WR+SK) me-NULL-kan coret yang tak lagi membentuk diskon valid (`CASE WHEN compare_price <= harga_baru THEN NULL`) — coret basi hilang, coret valid dipertahankan. Sync TETAP tidak menulis coret baru (hanya NULL-kan yang basi agar harga otoritatif tembus); input Harga Coret di modal edit selalu terbuka (label "✎ bisa diedit") |
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
**terikat varian terpilih** (fallback varian aktif pertama) — desktop di kolom
kiri bawah deskripsi, mobile sebagai panel terlipat. Varian manual (tanpa
`wr_variant_id`) mendapat `null`.

### Salinan produk versi Axvara (2026-09-24, live)

Permintaan owner: deskripsi, S&K, dan cara aktivasi seragam untuk produk WR
maupun non-WR, tanpa kalimat berulang, dalam suara Axvara, **tanpa
menghilangkan maksud/ketegasan pemasok**. Kode di `src/lib/product-copy/`:

| Bagian | Sumber | Mekanisme |
| --- | --- | --- |
| S&K + cara aktivasi varian WR | `wr_variants` (milik sync, tidak disentuh) | `resolve.ts` menghitung `supplierFingerprint(wr_terms, wr_delivery_terms)` (`text.ts`: cyrb53 atas kata+angka per baris — kebal huruf besar/emoji/tanda baca/spasi, berubah bila kata/angka berubah). Urutan: **suntingan admin** (kolom varian migrasi 0041, lihat di bawah) → entri `curated.ts` (83 pasangan teks prod + 12 SK 2026-09-30) → `supplierVariantCopy()` di `format.ts`: teks WR dirapikan (tanpa emoji, huruf tebal Unicode dinormalkan NFKC, huruf besar berteriak jadi kalimat, baris ganda dibuang), dikelompokkan heuristik, baris aturan di teks aktivasi dipindah ke S&K. Suntingan admin dan kurasi hanya berlaku selama sidik jari sama dengan saat ditulis — aturan baru pemasok tidak pernah tertutup salinan lama. **Varian SK** mengalir lewat JOIN `sk_products` di `catalog.ts` (`terms=sk_description`, `delivery_terms=sk_seller_note`) sehingga mesin yang sama berlaku; `buyerDeliveryKind` kenal SK (`auto`=instan). |
| S&K + cara aktivasi versi admin per varian (WR & non-WR) | `product_variants.admin_terms`, `admin_activation`, `admin_copy_fingerprint` (migrasi **0041**, milik admin) | Tab **Deskripsi & S&K** di editor produk (`sections/ProductCopyTab.tsx`, terpisah dari tab Varian sejak 2026-09-24 agar baris varian hanya berisi harga/stok/garansi/pengiriman): kolom deskripsi (+ deskripsi khusus untuk WR) lalu daftar varian, masing-masing panel `VariantCopyEditor.tsx` yang terbuka berisi salinan yang sedang tampil; entri dimuat saat modal dibuka (`useVariantCopyEntries` di `ProductEditorModal`) sehingga tab langsung menampilkan jumlah varian aktif yang perlu ditinjau. Disimpan HANYA lewat `PUT /api/admin/variant-copy` (tombol sendiri) yang mencap `admin_copy_fingerprint` = sidik jari teks WR saat itu (`''` untuk varian non-WR). Sync WR dan `PUT /api/products/:id` tidak pernah menulis kolom ini, jadi menyimpan foto/badge tidak diam-diam mencap ulang suntingan yang dijeda. Teks yang isinya sama dengan salinan otomatis tidak disimpan (NULL), teks kosong = kembali otomatis. Bila WR mengubah teks sesudahnya: storefront kembali ke teks WR terbaru, editor menampilkan peringatan + teks asli WR, daftar produk admin memberi badge "S&K perlu ditinjau · N varian" (`copyReview` di `GET /api/products` admin, juga untuk teks WR yang belum punya versi Axvara) sampai admin menyimpan ulang. |
| Deskripsi produk WR | `products.admin_description_override` (milik admin) | Migrasi **0040** (data-only) mengisi versi Axvara untuk 47 produk WR hanya bila override masih kosong; `description` milik WR tetap utuh. |
| Deskripsi + S&K produk non-WR | `products.description` (milik admin) | Migrasi 0040 mengganti 2 produk (Canva, GSuite) hanya bila isinya masih persis teks lama. Migrasi **0042** menambah S&K Canva (undangan dikirim lewat email + pastikan email aktif, keputusan owner) dengan guard yang sama. S&K yang berlaku untuk semua varian ditulis di sini; yang khusus satu varian lewat editor varian. |

Kontrak data (`format.ts`, aman untuk browser): `VariantCopy = { source:
"admin"|"axvara"|"pemasok", sections: {kind: paket|proses|aturan|garansi, items}[],
activation: {title|null, steps}[], notes }`. `withVariantCopy()` dipanggil
route `/api/catalog?slug=` — BUKAN `catalog.ts`, karena `catalog.ts` ikut
diimpor komponen client dan `curated.ts` tidak boleh masuk bundle browser
(diverifikasi `next build`); ia juga mengosongkan kolom mentah WR & admin
sebelum dikirim. Bot Telegram/WhatsApp tidak menampilkan deskripsi maupun S&K
(tetap seperti sebelumnya).

Format editor varian (`serializeVariantCopy()` ⇄ `parseAdminVariantCopy()`,
bolak-balik tanpa kehilangan isi untuk ke-83 salinan kurasi — dikunci test):
S&K = judul `Detail paket:` / `Proses & pengiriman:` / `Aturan pakai:` /
`Garansi:` lalu baris `- ` (baris tanpa judul dikelompokkan otomatis); cara
aktivasi = baris bernomor, judul bebas menjadi judul kelompok langkah, judul
`Catatan:` untuk catatan. Batas 4.000 karakter per kolom
(`VARIANT_COPY_MAX_CHARS`).

Format deskripsi (juga untuk admin, dijelaskan di editor produk): paragraf
pembuka → baris `- ` untuk keunggulan → opsional judul baris `Syarat &
Ketentuan:` / `Cara Aktivasi:`. `parseProductDescription()` memindahkan dua
bagian itu ke kartu S&K/aktivasi PDP (digabung dengan S&K varian WR, tiap
baris tampil sekali lewat `mergeProductCopy()`), sisanya tetap di kartu
deskripsi. Meta SEO/OG memakai `descriptionSummary()` (paragraf pembuka saja).

Penjaga: `tests/product-copy-content.test.ts` membandingkan setiap salinan
dengan snapshot teks WR produksi (`tests/fixtures/product-copy-snapshot.json`)
— semua angka, URL, dan keluarga aturan (larangan, kewajiban, tanpa garansi,
refund, batas perangkat, sanksi, platform, dst.) wajib terbawa; gaya seragam
(tanpa emoji/huruf besar berteriak/bahasa gaul/titik di akhir poin).
**Pengecualian 2026-10-03 (keputusan owner):** halaman docs/tutorial supplier
(`sekalipay.com/docs/*`) BOLEH diganti artikel AXVARA (syarat: URL
`axvara.tech/artikel/` wajib ada di salinan) — customer yang klik link itu
melihat nav belanja supplier. Catatan
harga internal pemasok untuk reseller ("harga naik karena VCC susah")
sengaja tidak ditampilkan ke pembeli. **Saat WR mengubah teks** (badge "S&K
perlu ditinjau"): cara tercepat, tulis ulang versi Axvara di editor varian
admin. Kurasi permanen di kode tetap bisa: ekspor ulang pasangan teks
(read-only) ke snapshot, tulis entri baru di `curated.ts` dengan kunci sidik
jari barunya, jalankan test. Suntingan admin tidak diperiksa test integritas —
admin bertanggung jawab membawa angka, larangan, dan batas garansi WR (editor
menampilkan teks asli WR sebagai pembanding).

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
  6 digit WA atau email checkout (sekali) atau capability token (30 hari, hash-only, revoke).
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

## 15b. Sekalipay Reseller API — Supplier Kedua Paralel WR (2026-09-30, Fase 1)

Axvara menjadi reseller layer di atas Sekalipay (`https://sekalipay.com/api`,
docs `https://sekalipay.com/api-docs`) SEBAGAI SUPPLIER KEDUA yang paralel
dengan WR — bukan failover otomatis (keputusan owner). Produk yang tampil
dipilih manual: Netflix WR vs Netflix SK = dua baris katalog berbeda (nama
publik bersih tanpa suffix sejak 2026-09-30, preseden Antigravity 0045;
pembedaan hanya badge admin + slug `-wr`/`-sk`).

### Kontrak upstream (beda dari WR — jangan disamakan)
- **Auth:** header `X-APIKEY` (WR: body `api_key`). Key SK disuntik
  server-side oleh proxy Heroku (`SK_API_KEY` dyno); Pages tidak menyimpan key.
- **Baca = GET + query** (`GET /v1/balance`, `GET /v1/item?per_page=all`,
  delta `?updated_since=<server_time>`, `GET /v1/trx/{ref_id}`); WR semua POST.
- **Tulis = POST JSON** (`POST /v1/trx {ref_id, carts[]}`, `POST
  /v1/order/sandbox {ref_id, items[]}`). `ref_id` IDEMPOTEN di sisi SK
  (`422 REF_ID_ALREADY_EXIST` = ambil detail, bukan order ganda) — kunci
  `sk:<order_code>:<sk_variant_id>:<qty>` (maks 191 char).
- **Validasi 422 SEBELUM potong saldo** (`REQUIRED_FIELD_MISSING` +
  `field: carts.0.note`). Fase 1 (auto) tidak pernah mengirim note.
- **503 `PRODUCT_TEMPORARILY_UNAVAILABLE`** = ditolak di depan, saldo tidak
  terpotong → retry normal, bukan failed permanen.
- **order_process:** `auto` (lisensi langsung), `manual` (admin kirim, event
  per-item `order.item.sent`), `h2h` (SN per-unit `units[]`), `smm`. Fase 1
  HANYA `auto`; sisanya tercatat di registry tanpa pasangan katalog.
- **Webhook event:** `order.paid/completed/canceled` + `order.item.sent` +
  `webhook.test`. Signature `SHA256(ref_id:invoice:status:secret)` dengan
  status event-dependent (`data.status` / `item.sent` / `test`), header
  `X-Signature/X-Timestamp/X-Event`, jawab 2xx cepat + proses async + dedup
  `sk_webhook_events` + retry exponential 5x dari SK.

### Arsitektur terpasang (cermin WR, scope lebih kecil)
- **Proxy:** route `/sk/*` di proxy WR/SK — pass-through
  method+query+body di bawah prefix `/v1/`, key disuntik server-side, egress
  IP VPS yang SAMA (`13.228.147.90`, tanpa add-on baru sejak migrasi
  AWS 2026-10-02 — lihat §16.8). `GET /sk/health` tanpa bocor key.
- **Modul `src/lib/sekalipay/`:** `client.ts` (fetch edge + klasifikasi error
  + signature), `sync.ts` (registry per-varian + katalog hanya auto + nama
  bersih tanpa suffix + markup 50% + cursor + zero-missing sweep-penuh), `order.ts`
  (exactly-once claim/lease + reconcile via `GET /v1/trx` + blocked 24 jam),
  `deliver.ts` (lisensi → `fulfillment_items.delivered_ciphertext/iv`
  sehingga panel/email/token yang SUDAH ada langsung jalan; agregat via
  `refreshOrderAggregate` yang sama), `saldo.ts` (check + alert Rp250rb).
- **Kepemilikan (cermin 0030):** SK = stok/modal/label/seller_note/process;
  Admin = foto/badge/sort/is_active/markup/tampil. Sync tidak pernah menulis
  `sold_count`, `admin_*`, `require_email`, `min_qty`, `fulfillment_mode`.
- **Fulfillment generik dilewati untuk item SK** (`sk_link_id NOT NULL` di
  `send.ts` + `process.ts`, pola `wr_link_id`) — diselesaikan via
  `sk_order_links`, agregat order dari seluruh item (mixed cart jujur).
- **Hook lunas 4 jalur** (webhook DANA, konfirmasi admin, approve bukti,
  retry payments/events) membuat link SK best-effort SETELAH link WR —
  SK mati tidak mengganggu WR/non-WR.
- **Cron fase `sekalipay`** (`fulfillment → warung_rebahan → SEKALIPAY →
  notify`): order due + sync 30 mnt + reconcile + saldo 1 jam, budget +
  deadline + cadangan ekor yang sama. Fase hanya masuk rotasi bila relevan
  (SK aktif/ada kerja/deferred lama) — saat SK mati rotasi IDENTIK baseline
  (nol query/deferred ekstra, dikunci test R12).
- **Admin:** tab **Sekalipay** setara WR (saldo + kapasitas, Force Sync +
  sync manual/cron terpisah, antrean + umur + retry/void CAS, exclusion rules,
  markup per varian + **bulk markup cermin WR** via `POST /api/admin/sekalipay/markup/bulk`, toolbar bersama yang sama) + **tab dalam-halaman Ringkas/Antrean/Markup/Aturan/Audit/Alat (2026-10-01, cermin WR)** — sandbox di tab Antrean, mutasi + transaksi di Audit, cek akun + lock + detail di Alat (semua lazy-load) + fitur khas SK: mutasi saldo audit, cek akun validasi,
  stock-lock 10 mnt, daftar transaksi SK, detail capability per varian,
  sandbox order. API `/api/admin/sekalipay/*`, rate-limit
  `webhook:sekalipay` 60/mnt.
- **DB (migrasi 0049 + 0050):** tabel `sk_products/sk_order_links/sk_sync_log/
  sk_saldo_log/sk_webhook_events/sk_sync_state/sk_exclusions`, kolom `sk_*`
  katalog + registry capability (`sk_description/min_order/status/
  required_fields/validation`) + `fulfillment_items.sk_link_id`, CHECK
  `source` + `sekalipay` (rebuild 12-langkah pola 0029 + namespace negatif
  pola 0008 + `foreign_key_check` ekor; bootstrap baru inline di `schema.sql`).
- **Env (`secret_text`):** `SEKALIPAY_ENABLED/AUTO_ORDER_ENABLED=false`
  default, `SEKALIPAY_PROXY_URL/TOKEN`, `SEKALIPAY_WEBHOOK_SECRET`, markup +
  ambang + kategori default (lihat `.env.example`).
- **Paritas email + flag SK (2026-10-02):** flag `queued/instant_delivery` di
  `GET /api/orders?code=` membaca `sk_products.sk_order_process` (SK auto =
  instan walau `fulfillment_mode` lokal `manual`; SK non-auto = antrean;
   varian hilang = bukan instan palsu) — halaman lunas SK auto skeleton "Menyiapkan
   detail produkmu…" + polling rapat, bukan Made By Order 12 jam.
  `handleSkOrderCompleted` bind link → item + tulis `sk_link_id` (fulfillment
  generik lewati, pola `wr_link_id`) + kirim email kredensial template
  "Pesanan Siap" Axvara yang SAMA PERSIS dengan WR/non-WR (logo + tanda
  terima + blok kredensial + CTA, idempoten `email:sk-credential:<order>:<item>`
  di `buyer_notice_log`) + reconcile cron `reconcilePendingSkCredentialEmails`;
  `webOrderAutoDelivered` hitung `sk:%` sebagai auto (tanpa email tanda terima
  ganda); event `order.paid/item.sent` → email "Pesanan Diproses"
  (`notifyBuyerSkProcessing`, idempoten per invoice); saldo habis → email
   pembeli `sk-blocked` (cermin WR). TANPA ingest Gmail SK — webhook adalah
   source of truth (lisensi sudah di payload `order.completed`).
- **Paritas instan penuh WR≈SK (2026-10-13, insiden Prime Video SK + Bstation WR):**
  (1) **Bind saat link dibuat** — `createWrOrderLink`/`createSkOrderLink` langsung
  mengaitkan link ke `fulfillment_items` (`wr_link_id`/`sk_link_id` +
  `fulfillment_item_id`, idempoten) begitu link lahir, bukan menunggu completed.
  Pipeline fulfillment generik karena itu melewati item supplier sejak detik
  pertama; vonis `manual_required` palsu dari jendela balapan (yang tampil
  sebagai "Stok otomatis habis" di halaman SK) tidak pernah lahir.
  (2) **Penyegar status supplier bersama** (`src/lib/orders/supplier-refresh.ts`):
  `maybeRefreshSupplierOrder` menarik status vendor SEKARANG (WR `/transactions`,
  SK `/v1/trx`, read-only + monotonik) di balik gerbang throttle per-order 20 dtk
  yang disimpan di `store_settings` (`supplier_refresh_at:<kode>`, klaim CAS
  satu pernyataan — pola klaim fulfillment). Pemicunya: poll pembeli di
  `GET /api/orders?code=`, `/api/orders/[code]`, `/api/orders/lookup` (respons
  dihitung ulang setelah refresh agar tidak basi), penjamin massal
  `refreshDueSupplierOrders` (limit 4, kandidat dibaca 1 query per supplier,
  gerbang dibaca batch) di cron lite `wr_orders`+`sk_orders`, dan webhook tetap
  jalur tercepat bila sampai. `refreshSupplierOrderNow` ikut memproses antrean
  pengiriman kredensial WR agar email/panel menyusul di invocation yang sama.
  Tanpa timer server; biaya tetap berapa pun jumlah poll (gerbang menahan).
  (3) **Formatter WR bentuk `{label, value}`** dikenali `labeledFieldOf`:
  dirender "Label: nilai" per baris (pemisah antar-field kini newline, bukan
  " · "), key `product` pembungkus dibuang — nol teks "Product:/Label:/Value:"
  mentah di panel/email/WA/Telegram, termasuk order lama (normalisasi USE-time).
  (4) **S&K pasca-bayar**: endpoint kredensial melampirkan `terms` per item dari
  `resolveCredentialTermsByItem` (`src/lib/orders/credential-terms.ts`) — resolver
  yang sama dengan PDP (admin → kurasi → teks supplier, pagar sidik jari) atas
  `wr_terms/wr_delivery_terms` atau `sk_description/sk_seller_note`; panel
  menggabungkan pula S&K/aktivasi dari deskripsi produk via `mergeProductCopy` (2026-10-15, paritas PDP, termasuk stok sendiri); panel
  merender blok terlipat "Syarat & Ketentuan" + "Cara Penggunaan / Aktivasi" DI BAWAH
  kredensial (kredensial tetap bersih, S&K tidak disimpan ke ciphertext).
  (5) `settleSkFulfillmentItem` berpagar `manual_handover:%` seperti WR (supplier
  tidak menimpa serah terima admin), dan admin SK mendapat route
  `POST /api/admin/sekalipay/orders/[id]/sync-now` sehingga tombol "Cek status"
  tampil untuk kedua supplier.
 - **White-label link docs supplier (2026-10-03, keputusan owner):** teks SK
   untuk Netflix menunjuk `sekalipay.com/docs/tutorial-login-netflix` — customer
   yang klik melihat nav "Belanja Sekarang" dan bisa order langsung di supplier.
   Kini PDP + email/panel rewrite link itu ke artikel AXVARA
   `/artikel/cara-login-netflix-setelah-order-di-axvara` (ditulis ulang +
   foto white-label, id draft 23): kurasi `curated.ts` 2 entri Netflix +
   `rewriteSupplierDocsLinks()` di `format.ts` (dipakai fallback PDP
   `supplierVariantCopy()` + email/panel `formatSkLicenses()` di `deliver.ts`)
   sehingga tahan sync (teks supplier ditimpa tiap sweep). Mailbox OTP
   (`netflix-codes.sekalipay.com`, tanpa brand/nav belanja) + bot Viu
   DIPERTAHANKAN — bukan toko kompetitor. Test: `product-copy-content`
   (pengecualian docs→artikel) + `sk-saldo-branding` (9).
 - **Anti-spam notif saldo SK 1:1 WR (2026-10-03, sesi ses_f029e):** throttle SK
   cuma 1 jam + state di `sk_saldo_log` (CHECK source rapuh) = spam 24x/hari
   (bukti screenshot: Rp41.900 × 5 dalam 4 jam). Kini `saldo.ts` pakai
   `sk_sync_state key='low_saldo_notified'` (`amount|timestamp_ms`): kirim ulang
   hanya bila 6 jam berlalu ATAU saldo turun melewati kelipatan Rp5.000
   (maks 4x/hari, stagnan = 1x). Threshold + gate cek 1x/jam cron tidak berubah.

## 16. Insiden operasional 2026-09-14 + arsitektur proxy terpisah (WAJIB DIBACA agent)

Hari ini prod lumpuh total (login 503, bot WA/Telegram mati, QRIS hilang, varian
tidak tampil, pagination lama kembali) lalu dipulihkan. Tiga akar + aturan
kerasnya agar tidak terulang:

### 16.1 Arsitektur proxy WR terpisah (hasil permanen hari ini)
- Akun Heroku #1 (`terry.delvon0805@gmail.com`): `axvara-wa-gateway` = WhatsApp SAJA
  (route `/wr/*` mengembalikan 410 `wr_proxy_moved`).
- **Sejak 2026-10-02 proxy pindah ke AWS** (lihat §16.8): VPS `t4g.nano`
  Singapore `i-022790eb6bb0b1be3`, EIP `13.228.147.90`,
  URL `https://wr-proxy.axvara.tech` (Caddy + Let's Encrypt). Source tetap
  `/Users/macbookair/axvara-wr-proxy/` (deploy via rsync + systemd, bukan
  `git push heroku`). Akun Heroku #2 (`sailinnadia1@gmail.com`) + add-on
  QuotaGuard Spike DIHAPUS TOTAL 2026-10-02 (verifikasi: `heroku apps` =
  kosong, `heroku addons --all` = No add-ons; tagihan $5/mo ke kartu
  berhenti). IP lama `54.88.136.216, 54.84.188.199` hapus dari whitelist
  WR/SK setelah verifikasi VPS hijau (WR Rp47.820, SK Rp44.250).
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

### 16.2a Switch build publik maintenance pembayaran (2026-10-18)

✅ Diimplementasikan, publikasi melalui CI. `NEXT_PUBLIC_PAYMENTS_MAINTENANCE` merupakan **nilai build nonrahasia**, `"false"` pada rilis KlikQRIS (sebelumnya `"true"`) di langkah build artefak Pages di `ci.yml`; tidak disimpan sebagai env runtime Pages dan tidak mengubah aturan `secret_text` untuk env Pages. Next menanam nilai yang sama pada bundle UI dan API; `false`/tidak diset memulihkan perilaku biasa setelah build/deploy baru. Mengubah secret runtime saja tidak membuka artefak lama. Dev mengaktifkan melalui prefix env; test menguji kedua mode eksplisit. Tidak memakai D1 atau TTL. Pemulihan lewat perubahan nilai CI + verifikasi + push, bukan deploy manual.

Sumber copy/URL/guard: `lib/payment-maintenance.ts`. `shared/PaymentMaintenanceNotice.tsx` menyediakan banner dan panel manual. Layout `(shop)`/Pedia menampilkan banner sesudah navbar; checkout Market dan formulir pilihan layanan Pedia digantikan panel manual sebelum hook checkout berjalan. Katalog/pelacakan tetap tersedia. `POST /api/orders`, `/api/pedia/orders`, `/api/payments/qris/[code]/reissue` memberi 503 JSON `reason: payment_maintenance`, `error` publik dan `manual_order_url`, private/no-store sebelum parsing/query/order/debit/reservasi. Guard inti `createQrisInvoice`/`reissueDanaQrisInvoice` menolak dengan `payment_maintenance` sebelum ledger.

`telegram/payment-maintenance.ts` memberi pemberitahuan dan keyboard WA absolut, katalog, Pesanan saya; dipakai `/start`, home, single/cart checkout dan renew sebelum perubahan finansial. Handler pembayaran WA berhenti sebelum session/order dan mengirim tautan hub. Endpoint webhook/polling merchant, status order, pengiriman dan cleanup tidak digate; invoice lama tidak dihapus dan stok/kredit tetap mengikuti lifecycle existing. Bukan maintenance D1, tidak auto-resume atau menambah broadcast/cron/kontrak lintas-repo.

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
Sejak 2026-09-25 pola ini tersedia sebagai `siteOrigin()` (`src/lib/site-url.ts`) dan dipakai
notif "Lunas — Web" serta setup webhook Telegram (`/api/admin/telegram/setup`). Kode baru yang
membuat URL absolut di server wajib memakainya.

### 16.5 Ekosistem 5 folder (detail di masing-masing AGENTS.md)
`axvara` (toko) · `axvara-wa-gateway` (WA, akun #1) · `axvara-qris-gateway`
(riset QRIS, `.env` = sumber nilai Pages) · `axvara-wr-proxy` (source proxy
WR/SK — live di VPS AWS sejak 2026-10-02, lihat §16.8) · `axvara-tg-bot`
(kredensial Telegram). Kredensial Heroku dua akun di
`.heroku-credentials` (git-ignored, pola sama dengan `.cf-credentials`).
Perintah akun #2 wajib prefix `HEROKU_API_KEY=<kunci-akun-2>`; jangan
`heroku login` ulang (merusak sesi akun #1).

Kredensial AWS (VPS proxy, 2026-10-04): `.aws-credentials` (git-ignored,
pola sama dengan `.cf-credentials`; `set -a; source .aws-credentials; set +a`), IAM user
`kiro-monitor`: `ReadOnlyAccess` + baca billing/kredit + start/stop/reboot
khusus `i-022790eb6bb0b1be3`.
Akses isi VPS lewat SSH `ec2-user@13.228.147.90` + `~/.ssh/axvara-sg-proxy.pem`.
Root hanya via `aws login` (sesi berumur pendek); key admin permanen
`nasikuning` DINONAKTIFKAN 2026-10-04.

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

### 16.8 Migrasi proxy WR/SK ke AWS (2026-10-02, live)

Motivasi: add-on QuotaGuard Spike (~$5/mo) adalah third-party sehingga
TIDAK tercover student credit Heroku dan selalu lari ke kartu kredit.
Penggantinya: VPS `t4g.nano` Singapore (`i-022790eb6bb0b1be3`, 0.5GB +
1GB swap, 8GB gp3, ~$5/mo dibayar kredit AWS $143.60 — tahan ~28 bulan).

- **URL baru:** `https://wr-proxy.axvara.tech` (EIP `13.228.147.90`, DNS A
  unproxied, Caddy + Let's Encrypt auto-renew). Kontrak TIDAK berubah
  (`POST /wr/:endpoint` + `/sk/*` + `x-proxy-token`, key server-side).
- **Deploy:** rsync `package.json` + `dist/` (build lokal, bukan di nano)
  ke `/opt/axvara/wr-proxy/`, env `/opt/axvara/wr-proxy/.env` (`chmod 600`,
  TANPA `QUOTAGUARDSTATIC_URL` = direct via IP VPS), systemd `wr-proxy` +
  `caddy` (`Restart=always`, MemoryMax 350M/100M). SSH `ec2-user@` terbatas
  IP rumah; keypair `axvara-sg-proxy` (`~/.ssh/axvara-sg-proxy.pem`).
- **Node 20 wajib** (`nodejs20` AL2023, bukan paket `nodejs` default v18);
  `dnf update` OOM di nano — install bertahap + `max_parallel_downloads=1`.
- **Whitelist:** `13.228.147.90` DITAMBAHKAN di dashboard WR + SK
  (screenshot owner 2026-10-02, keduanya hijau via proxy baru: WR balance
  Rp47.820, SK Rp50.000). IP QuotaGuard lama + add-on + app Heroku
  DIHAPUS TOTAL 2026-10-02 (bukan "setelah pantau" — verifikasi langsung
  hijau hari yang sama).
- **Pages Secrets dialihkan:** `WARUNG_REBAHAN_PROXY_URL` +
  `SEKALIPAY_PROXY_URL` → `https://wr-proxy.axvara.tech` (token sama).
  Secret baru terbaca deployment berikutnya — commit ini pemicunya.
- Catatan OpenClaw: instance lama `t4g.medium` us-east-1 + EIP-nya sudah
  di-terminate/release (backup parsial 540MB di
  `/Users/macbookair/aws-backup-openclaw-20261002/`, tanpa node_modules/
  cache/biner).

### 16.7 Health anti-false-alarm + kelas pengiriman WR (2026-09-16)
- Query health `tgQueue`/`fulfillmentQueue`/`oldestDue` JOIN orders dan hanya
  menghitung order lunas+paid. Sebelumnya 7 `failed` order final menyeret
  Telegram ke `degraded` padahal bot sehat (webhook 0 pending, no error).
- Migrasi 0032: `wr_variants(wr_delivery_class, wr_delivery_source)`.
  API WR DULU tidak memberi penanda auto/manual — desain hibrida: seed 17 nama
  screenshot admin (`screenshot`) + `guessDeliveryClass()` untuk sisanya dan
  varian baru (`system`) + kunci manual owner (`admin`). Sync TIDAK PERNAH
  menimpa yang sudah terisi (pola override 0030). Default ragu = manual.
- Migrasi 0060 (2026-10-11, live): `wr_variants.wr_delivery_mode` (tanpa
  CHECK) — API WR KINI mengirim `delivery_mode` per varian ("auto" = dikirim
  otomatis begitu lunas, "manual" = dikerjakan admin WR, "mixed" = tergantung
  ketersediaan, diperlakukan antrean/under-promise). Itu SUMBER KEBENARAN
  kelas: sync menurunkannya via `deliveryClassFromApiMode()` (auto→restock,
  manual/mixed→made_by_order) dan MENIMPA seed/tebakan/kunci admin bila ada;
  kunci admin hanya bertahan untuk varian tanpa delivery_mode. Pra-0060
  (kolom belum ada di D1) sync memakai fallback per statement tanpa kolom
  baru — sync tetap jalan + tetap membetulkan kelas. Audit 2026-10-10:
  62/92 varian salah kelas (mis. Vidio Mobile tampil "Kirim otomatis" padahal
  manual) — penyebab keluhan "katanya instan tapi harus nunggu".
- Penyederhanaan paten ala SK (2026-10-13, migrasi 0061): mesin tebakan
  (`guessDeliveryClass` + daftar nama screenshot) + tombol kunci kelas admin
  + badge sumber ("tebakan/daftar WR/kunci admin") DIHAPUS. Kelas kini murni
  turunan `delivery_mode` (auto→AUTO/`restock`; manual/mixed→MANUAL/
  `made_by_order`; tanpa mode → default deterministik MANUAL), badge panel
  hanya **AUTO / MANUAL** persis `ProcessBadge` SK, route markup tidak lagi
  menerima `delivery_class`. `wr_delivery_source` di-rebuild CHECK hanya
  `('api')` (0061 menormalkan nilai warisan; kelas/mode/data dipertahankan).
  Koreksi kelas selanjutnya = koreksi di dashboard WR. Email wajib:
  web SELALU minta email (revamp 2026-09-23); Telegram/WA + API orders memakai
  `needsEmailForVariant()` (tipe Invite/Link WR atau produk `require_email`).
  `email_invite` hanya dikirim ke WR untuk tipe Invite/Link
  (`wrTypeUsesEmailInvite()`); Private/Sharing di-omit total (temuan admin
  2026-10-07: TARGET ACCOUNT INVITATION nyasar di dashboard WR).
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
- `email_invite` (uji live 2026-09-16, dipersempit 2026-10-07 temuan admin WR
  kasus RBHN-20261005-0127B5): HANYA varian bertipe Invite/Link yang dikirimi
  `email_invite` (`wrTypeUsesEmailInvite`; Link dipertahankan karena tipe nyata
  di API WR — fixture sync memakai `type:"Link"` UUID Canva asli). Private/
  Sharing/dll di-omit total (bukan string kosong) — `processOneLink` cek
  `wv.wr_type` per link sebelum meneruskan `customer_email`. Tanpa email,
  WR 422 "Email Invite is required" dan retry tidak sembuh (saldo aman,
  tidak terpotong). Checkout produk Invite/Link wajib meminta email pembeli.
  UX tetap 1-field (tanpa copy/field baru, keputusan owner 2026-10-07).
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
- Toggle admin `require_email` (fix 2026-09-25): daftar produk admin
  (`GET /api/products`) tidak membawa kolom ini, jadi editor membacanya dari
  `GET /api/products/:id` (`requireEmail`). Simpan hanya mengirim
  `requireEmail` bila nilainya sudah termuat (detail gagal dibaca = kunci
  tidak dikirim, `PUT` tidak menyentuh kolom). `POST /api/products` menerima
  `requireEmail` (default `false`). Dulu centang selalu tampil mati setelah
  refresh dan Simpan berikutnya diam-diam menulis 0.
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
| Deep-link stok menipis (pill Ringkasan dihapus 2026-10-15) | `?section=products&low_stock=1` | `page.tsx` → `useProductManager.onlyLowStock` |
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
   berstok 0–5** pada field API Ringkasan (`/api/admin/overview`, tanpa pill UI sejak 2026-10-15) maupun Produk
   (`lowStockVariants` dari `/api/products`).

### 16.9 Rail QRIS GoPay (2026-10-02 Fase 0 — ledger multi-provider, default mati)

Motivasi: lepas dari HP Android (QRIS Hook DANA) untuk order pribadi —
poller server memantau mutasi GoBiz milik sendiri.

- **Ledger generik:** `payment_transactions.provider` = `dana` | `gopay`;
  allocator + causal guard + history + reissue berlaku per provider.
  Unique index terpisah (`..._active_dana_amount` / `..._active_gopay_amount`)
  sehingga nominal GoPay BOLEH sama dengan nominal DANA — matcher WAJIB
  filter provider di semua query kandidat.
- **Rail aktif order baru:** `QRIS_ACTIVE_PROVIDER` (`dana` default =
  perilaku lama; `gopay` bila `GOPAY_QRIS_ENABLED=true` + secret).
  `createDanaQrisInvoice()` = wrapper tipis (signature tetap); Telegram/WA/
  web memakai `createActiveQrisInvoice()`. Rollback = 1 env.
- **Webhook GoPay:** `POST /api/webhook/gopay` (HMAC `x-poller-secret` =
  `GOPAY_POLLER_SECRET`, BUKAN publik) — cermin webhook DANA + `order_code`
  langsung bila poller menyertakan. Event tercatat `provider='gopay'` di
  tabel `dana_webhook_events` (nama tabel dipertahankan).
- **Legacy ranges hanya DANA** (`pt.provider='dana'` di predikat) — riwayat
  GoPay selalu lengkap sejak awal (tidak ada reissue penghapus).
- **Poller:** folder `axvara-gopay-poller/` (Fastify `:3002`, systemd terpisah
  di VPS yang sama dengan wr-proxy, session `chmod 600`, **interval 15 detik
  + jitter 0–3 detik + zero poll saat idle + backoff exponential 30s→5 menit
  (patch anti-ban 2026-10-02, konsensus komunitas gobiz-payment)**, read-only,
  401 → backoff + notif, JANGAN loop login). Fase 0 = skeleton
  (`/health` + `/tick`); Fase 1 = login OTP 1x + polling GoBiz beneran.
- **Idle 60 dtk + wake (2026-10-10, insiden 1102 Workers Free):** tanpa invoice
  pending poller tidur `IDLE_POLL_INTERVAL_MS` (default 60 dtk; dulu ~16 dtk =
  ±5.100 request/hari ke `/pending`). Ada pending/error = 15 dtk + jitter seperti
  biasa. Pages membangunkan poller via `POST https://wr-proxy.axvara.tech/gopay/wake`
  (Caddy `handle /gopay/wake` → `127.0.0.1:3002/wake`, header `x-poller-secret`
  sama, 401 tanpa secret) dari `src/lib/payments/gopay-wake.ts`
  (`scheduleGopayWake`, `waitUntil`, timeout 1,5 dtk, dedupe isolate 3 dtk,
  best-effort) saat: QR GoPay terbit (`createQrisInvoice`) / diterbitkan ulang
  (`reissueDanaQrisInvoice`), tombol web "Cek Status Sekarang"
  (`GET /api/orders?code=…&wake=1`, hanya invoice GoPay pending; polling
  otomatis halaman TIDAK mengirim `wake`), dan tombol Telegram "Periksa
  Pembayaran" (`handleOrderRefresh`). Poller tetap satu-satunya pemanggil
  GoBiz (tanpa poll paralel) dengan jarak minimum `WAKE_MIN_GAP_MS` 10 dtk.
  Env opsional Pages: `GOPAY_POLLER_WAKE_URL` (default URL di atas).
- **Sesi GoBiz (insiden 2026-10-10):** refresh token BERROTASI tiap auto-refresh
  library (~25 mnt). Poller WAJIB menulis sesi lewat `onTokenRefreshed`
  (atomik tmp+rename, chmod 600) — tanpa itu restart memuat token basi dan
  poller mati. Refresh token mati = status `session_dead_login_required` +
  notif Telegram. Login ulang di VPS: `cd /opt/axvara/gopay/app && set -a && . ./.env && set +a`
  lalu `node dist/login.js request <nomor tanpa 0>` → `node dist/login.js verify <otp>`
  → `sudo systemctl restart gopay-poller` (deviceId lama dipertahankan).
- **Env (`secret_text`):** `GOPAY_STATIC_QRIS`, `GOPAY_POLLER_SECRET`,
  `GOPAY_QRIS_ENABLED=false`, `QRIS_ACTIVE_PROVIDER=dana`.
  **Sejak 2026-10-02 sore (uji Rp5.137 hijau end-to-end):**
  `QRIS_ACTIVE_PROVIDER=gopay` — order baru via GoPay, DANA fallback.
  Rollback = 1 env kembali ke `dana` + deploy.
- **Ganti merchant GoPay 2026-10-16 ✅ live:** QRIS GoPay aktif kini merchant
  **axvara.tech** (`G284624569`, NMID `ID1026616934059`); secret Pages
  `GOPAY_STATIC_QRIS` diganti ke payload merchant baru (nilai hanya di secret,
  tidak di repo). Poller mendukung **dua akun bersamaan** agar invoice lama
  tidak yatim: Pages `GET /api/webhook/gopay/pending` kini menyertakan
  `merchant_id` yang dibaca dari `qris_payload` tersimpan tiap invoice
  (`getGopayInvoiceMerchantId`, CRC wajib valid; payload rusak/tidak dikenal →
  `null`, tidak pernah fallback ke merchant konfigurasi saat ini). Poller
  (`axvara-gopay-poller/src/merchant-routing.ts`) mengelompokkan invoice per
  merchant; respon Pages lama tanpa field tetap dirutekan ke merchant utama
  legacy. Tiap merchant punya file sesi + state backoff/401 sendiri:
  utama `GOPAY_MERCHANT_ID`+`SESSION_PATH` (`/opt/axvara/gopay/.session`),
  kedua `GOPAY_SECONDARY_MERCHANT_ID`+`GOPAY_SECONDARY_SESSION_PATH`
  (`/opt/axvara/gopay/.session-axvara-tech`); sesi kedua wajib merchant dan
  path berbeda, token hasil refresh hanya menulis file akunnya sendiri.
  `merchant_id` null/tidak dikenal tidak mengkueri akun mana pun dan tidak
  meneruskan pembayaran. Health poller menampilkan `merchantSessions[]`.
  Rollback QR: kembalikan secret `GOPAY_STATIC_QRIS` ke payload lama +
  redeploy; invoice yang sudah terbit tetap dirutekan sesuai merchant
  tersimpannya selama sesi akun itu masih dikonfigurasi di poller.
- **Migrasi 0054:** index gopay + trigger `IN ('dana','gopay')` + kolom
  `provider` di events. Issue: `issue/qris-gopay-ganti-hp-hook-2026-10-02.md`.

### 16.10 Pedia Dua Provider dan Handoff (Working-Tree 2026-10-12)

- **Rebuild kurasi 2026-10-14 (keputusan owner):** plafon Hemat/Standar/Premium dibuang. Migrasi **0062** rebuild `pedia_tiers`: CHECK 3-nama hilang, `UNIQUE(product_id, supplier, supplier_service_id)`, kolom kurasi `public_name/description_md/region/quality/speed_note/drop_risk/is_recommended/sort_order` (diterapkan ke prod via API per-statement + pola rename — `DROP TABLE` induk gagal FK dari `pedia_order_items`; tabel lama tersimpan sebagai `pedia_tiers_old0062`, id tier yang dirujuk order lama PERTAHANKAN persis). Katalog publik kini mengirim daftar layanan per produk (nama publik + deskripsi bahasa manusia + atribut + `price_per_1k` dari rate live + `quick_quantities`), rekomendasi lebih dulu; UI order = `ServicePicker` (rekomendasi utama, tombol lihat-semua, filter wilayah/refill/kualitas, urut) + jumlah bebas (chip cepat + input angka; validasi min–max layanan; produk `step=1`). Harga acuan client = harga paket tersimpan bila jumlah persis paket, selainnya estimasi per-1.000 — selisih tetap memicu consent quote. 34 layanan aktif terkurasi nama/atribut/deskripsi publik; glosarium istilah di halaman order. Mesin uang (quote JWE/dispatch/kredit) tidak berubah kontraknya.

**Deployed 2026-10-14** (proxy dua-provider live di VPS; flag order/dispatch Pages DIBUKA; lihat butir rilis di bawah). Yang masih pending: API key IndoSMM valid (key lama ditolak upstream) + bukti IDR/rate per 1.000, serta top-up saldo ProviderSMM untuk order nyata pertama.

| Boundary | Kontrak aktual |
|---|---|
| Pages → VPS | `callPediaProxy` merutekan `providersmm` ke `POST /psmm/:action`, `indosmm` ke `/indosmm/:action`; allowlist services/add/status/refill/refill_status/cancel/balance, JSON inbound → form upstream |
| Auth | Pages `WARUNG_REBAHAN_PROXY_URL/TOKEN` existing; header `x-proxy-token` divalidasi terhadap VPS `WR_PROXY_TOKEN` |
| Secret VPS saja | `PROVIDERSMM_API_KEY`, `INDOSMM_API_KEY`; key/action pemanggil ditimpa server; tidak dikirim Pages/git/log |
| Gate IndoSMM | services/add perlu `INDOSMM_RATE_PER_1000_VERIFIED=true` serta balance terbaru `currency === "IDR"`; gagal 503 `indosmm_pricing_unverified`; tanpa konversi kurs. balance/status/refill/refill_status/cancel recovery tidak memakai gate itu |
| Diff VPS → Pages | Tiap 10 menit, header `x-supplier-sync-token`, body `{source: "providersmm"|"indosmm", currency:"IDR", services:[], removed_service_ids:[], heartbeat?}`; input divalidasi sebelum tulis, max 100 services + 100 removed/request, non-2xx bila apply parsial |
| State/compat | D1 key `(supplier,service_id)`, harga IDR per 1k. Legacy ProviderSMM tanpa currency tetap IDR; IndoSMM wajib currency. Snapshot terpisah `state/psmm-diff-state.json` / `state/indosmm-diff-state.json` (`PSMM_DIFF_STATE_FILE`/`INDOSMM_DIFF_STATE_FILE`), batch maju hanya 2xx |

- Marker diff memakai prefix `pedia_diff` / `pedia_indosmm_diff`; saldo, `*_balance_checked_at` dan `*_balance_alert_at` terpisah per provider. Lite cron cek saldo maksimum sekali/30 menit/provider; hanya saldo IDR valid masuk log, alert throttle 6 jam atau turun melintasi Rp5.000. Overview admin menampilkan live/cache/error/pricing_verified/last_sync per provider; IndoSMM pricing_verified memerlukan services berhasil melewati gate, `/health` proxy hanya konfigurasi key.
- Receiver menggunakan upsert/removed/reprice per provider, bukan migrasi identity baru. Resync admin eksplisit supplier, katalog nonkosong tervalidasi, potongan 100; tidak menandai missing dari resync manual (missing ditangani diff). Diff VPS membatasi kedua array secara independen: layanan `chunkMax` dinormalisasi 1..100 (default 50), removals maksimum 100 per batch. Antrean dan snapshot maju hanya untuk potongan yang mendapat ack 2xx; sisa termasuk >100 removals dilanjutkan pada batch berikutnya, bukan batas pending. Katalog kosong atau >50% missing tetap ditahan di proxy.
- Quote baru `EncryptJWT`, JWE compact `dir/A256GCM`, key SHA-256 dari `ADMIN_JWT_SECRET`, TTL 30 menit; mengikat `refill_days` dan `min_profit_rp` selain provider/service/rate. Verifier tetap membaca HS256 legacy belum kedaluwarsa dan default supplier legacy ke ProviderSMM; token baru menyembunyikan identitas/modal, legacy signed payload masih terbaca sampai expiry. Order menolak provider/service yang berubah sejak quote walau harganya sama (`409 service_changed`).
- Order item menyimpan kolom provider/service/rate/order supplier serta snapshot `refill_days/min_profit_rp` dari quote, sehingga edit tier tidak mengganti ketentuan yang disetujui. Dispatch dan polling memakai asal item, refill/status refill memakai provider asal; remapping tier hanya order baru. Quote/order legacy tanpa field tersebut masih fallback tier. Refill `requested/submitted/needs_check` tetap diblokir berapa pun usianya; hanya refill belum pernah diajukan atau hasil terminal konklusif dapat diklaim, dengan jeda 24 jam dan masa refill dihitung dari waktu order dibuat. ID/key refill ambigu tidak diganti. Supplier order ID tersimpan di kolom saat add sukses; recovery `mark_submitted` juga mengisi snapshot JSON.
- D1 CAS `queued → submitting` + increment attempts + lease **5 menit sebelum** jaringan; hanya order lunas. Max 20 queued dan 20 polling/cycle, bukan batch status 100. Add timeout Pages 30 detik (proxy upstream 20 detik), status 20 detik. Error eksplisit supplier, timeout/5xx/unreadable/ID hilang atau lease submitting basi → needs_check, tanpa retry/failover otomatis. Poll gagal memperpanjang lease; refill_status hingga 5 item berbatas budget. Normalisasi spasi status dan Cancelled/Canceled. Terminal/kredit/notifikasi tidak menjadi satu transaksi end-to-end karena perubahan ini.
- Proxy reservation durable di `SMM_IDEMPOTENCY_DIR` (default `state/smm-idempotency`, subfolder `psmm`/`indosmm`), hash action+key dan fingerprint parameter, exclusive create + fsync file/direktori **sebelum upstream**, sukses disimpan atomik tanpa TTL/eviction. Add wajib Idempotency-Key stabil kode order 1..120 karakter (tidak dipotong); refill/cancel dedupe hanya jika header diberikan. Replay sukses tidak memanggil upstream; pending/corrupt/ambigu → 409 needs_check, key sama payload beda → 409 conflict, storage gagal sebelum submit → 503. Hanya rejection eksplisit 2xx error string tanpa order/refill melepas reservation otomatis; Pages tetap needs_check.
- Jangan hapus pending/corrupt, mengganti provider/key atau reset direktori idempotensi untuk retry ambigu. Backup seluruh state; single-VPS durable storage bukan dedupe lintas host, cache in-memory lama tidak dapat dipulihkan, belum ada endpoint reconcile/pruning. `mark_submitted` recovery memverifikasi ID/status/conflict provider asal; resubmit/cancel+kredit dibatasi belum pernah mencoba add (`submit_attempts=0`, tanpa ID). Dedupe proxy tidak menjamin exactly-once end-to-end atau atomisitas order/kredit/invoice.
- Rollout terpisah: siapkan backup state dan handoff secret server-side/bukti unit dulu; receiver Pages kompatibel sebelum diff IndoSMM proxy. Review mapping/ETA/refill/margin dan kurasi produksi, verifikasi mock serta QA fully hydrated/HTTP/CSS/Obscura/build, baru deployment dan aktivasi owner. Tidak ada secret/gate/deploy/push yang dilakukan saat sinkronisasi docs ini.
- **Rilis 2026-10-14 (keputusan owner):** build proxy dua-provider TERDEPLOY ke VPS (`/health`: `indosmm:true`). Key IndoSMM pertama ditolak upstream ("Invalid API key"); **key baru owner (14 Okt) VALID** — `balance` membalas `currency:"IDR"`, satuan rate terverifikasi per-1.000 dari katalog nyata, `INDOSMM_RATE_PER_1000_VERIFIED=true` dinyalakan, services 4.411 layanan ter-sync ke D1 (4.074 baris), dan **12 peringkat `indosmm` terkurasi live** berdampingan ProviderSMM (katalog 17 produk). Saldo kedua provider masih Rp0 (belum diisi owner) → pengiriman order nyata pertama menunggu top-up, tanpa saldo jatuh `needs_check`. Flag Pages `PEDIA_ORDERS_ENABLED=true` + `PEDIA_DISPATCH_ENABLED=true` DIBUKA (PATCH env + redeploy build yang sama agar terbaca; `ordersEnabled:true` terverifikasi di HTML prod + quote live mengembalikan token). Saldo ProviderSMM Rp0 atas pilihan owner — order nyata pertama menunggu top-up (tanpa saldo → `needs_check` admin). Kurasi gelombang 1: platform **X** live (Followers #592/#594, Likes #597/#600, Views #447 ProviderSMM; harga dihitung rumus §7.2 dari rate live). UX dirilis bersamaan: kartu katalog panel visual brand 16:10, skeleton Pedia (`PediaCatalogSkeleton`/`PediaOrderSkeleton` + `routeSkeletonKind` pedia di NavigationProgress yang kini juga terpasang di layout Pedia), overlay transisi tengah `CrossAppTransition` ("Memuat AXVARA Pedia/Market") di kedua layout, footer bersama dipadatkan (tautan rapat di desktop, kartu newsletter `self-start`), halaman pesanan Pedia memakai skeleton + modal refill sebaris (tanpa `window.prompt`/nomor WA hardcoded).
- Hasil final aktual MAIN 2026-10-12 setelah preview: `npx vitest run --run` 2288 test pada 184 file pass, `tsc` pass, `build:pages` selesai exit 0 (log temp `pedia-final-build.log`); lint sebelumnya pass dengan warning existing. Obscura route nyata home/Pedia/admin dan CSS 200; screenshot fixture hydrated desktop/mobile diperiksa, termasuk preview tersimpan dengan komponen aktual. Batas renderer radio/SVG/fixed tetap dicatat; ini bukan bukti produksi penuh atau seluruh gate live lulus. Tetap lokal, BELUM deployed; secret/flag tidak diubah atau diverifikasi, tanpa order supplier nyata. Bukti supplier live currency/rate-unit dan kurasi awal produksi/approval owner tetap pending.

### Banner dan rekonsiliasi admin (2026-10-15, publikasi CI)

- Migrasi aditif 0064 mempertahankan ID/konten dan urutan tayang lama (`sort_order ASC,id DESC`), menormalkan posisi ke 0..N-1 lalu memasang unique index `banners_sort_order_unique`. Katalog >1000 banner ditolak agar posisi 0..999 tetap valid. Tidak ada rebuild/FK rename.
- `writeBannerOrder` dipakai seluruh POST/PUT banner: cari posisi kosong di/atas permintaan, kecualikan ID sendiri, termasuk banner nonaktif, retry maksimal lima hanya untuk benturan unique. API membalas posisi tersimpan; toggle `PUT /api/banners/:id` hanya menulis is_active. Fallback dev menegakkan unique sebelum mutasi.
- `AdminStatusSwitch` menyediakan track/knob yang sama dengan Produk, role switch, checked/busy/disabled dan relasi error; digunakan Banner di sebelah Edit dan publikasi produk Pedia. Mutasi banner tetap parsial is_active, konten editor yang belum disimpan tetap dipertahankan.
- Pedia admin memakai helper lokal `DataTable` untuk Produk/Layanan/Pesanan/Kredit/harga tingkat/riwayat saldo: glass wrapper, header/cell/divider seragam dan overflow-x terlokalisasi. Filter/aksi dirapikan; endpoint, lifecycle request, preview tersimpan dan guard recovery tetap sama.
- Popup mengambil banner layak pertama, melewati hide 24 jam dan cap sesi; ref membatasi satu popup per dokumen, penutupan tidak memicu modal berikutnya.
- Events QRIS mengekspos `provider` (null legacy menjadi dana), health berisi provider efektif dari `activeQrisProvider()`, boolean konfigurasi dan waktu event per provider. Tidak ada secret/payload mentah di respons, konfigurasi bukan bukti kesehatan poller GoBiz. Panduan dan ACC mengikuti merchant invoice; engine pembayaran dan guard retry tidak diubah.


### 16.11 PG KlikQRIS — 2026-10-18

Koreksi runtime/checkout 2026-10-18: `fetch` API dan PNG memakai
`redirect: "manual"` lalu menolak non-2xx. Runtime workerd yang dipakai menolak
`redirect: "error"` sebelum jaringan (direproduksi lokal); penolakan ini sempat
tersamarkan sebagai `klikqris_network_ambiguous` dan meninggalkan ledger
initializing. Tidak mengikuti Location atau meneruskan secret ke host lain.
Test adapter aktual di workerd mencakup POST, PNG, reuse dan penolakan 302.

POST `/api/orders` mengecek quote existing setelah validasi token/keranjang,
sebelum validasi harga/reservasi baru, lalu menyertakan QR KlikQRIS yang berhasil
dipulihkan pada respons `200 reused:true`. Guard UNIQUE tetap menangani race;
retry initializing hanya GET order ID yang sama, bukan POST atau provider baru.
Stok terakhir yang sudah terreservasi tidak menghalangi retry pesanan asal.
GET `/api/orders?code=...&wake=1` dapat memulihkan ledger initializing KlikQRIS
melalui GET provider dan memuat ulang detail QR; polling tanpa wake tidak
memanggil provider. Field tambahan `qris_preparation_error` hanya boolean untuk
notice UI, tanpa detail rahasia; `expires_at` KlikQRIS memakai deadline ledger
15 menit juga saat initializing, sehingga tidak menampilkan TTL order generik
24 jam. Tidak memulihkan pesanan terminal atau mengulang POST untuk 404 ambigu.
Halaman pesanan tanpa QR menawarkan aksi manual ini dan tidak menjanjikan
verifikasi bukti pembayaran. Cleanup/stok/pembayaran terlambat tetap existing.

✅ Diimplementasikan, publikasi melalui CI. Mode **in-house PG**, bukan MY PG/sandbox. `lib/payments/klikqris.ts` terisolasi untuk `POST https://klikqris.com/api/qris/create` dan `GET /api/qris/status/{order_id}`, auth header `x-api-key` + `id_merchant`; create body order_id/amount/id_merchant/keterangan/callback_url. Credential lokal `.klikqris-credentials` git-ignored/chmod600; Pages `secret_text`: `KLIKQRIS_API_KEY`, `KLIKQRIS_MERCHANT_ID`, `KLIKQRIS_ENABLED=true`, `QRIS_ACTIVE_PROVIDER=klikqris`. Tidak ada key di proxy/VPS/bot credential repo lain, browser, log atau respons publik. Build maintenance `false` membuka pembayaran; env runtime tidak mengganti nilai build. Memilih KlikQRIS tanpa config gagal tertutup, bukan fallback ke merchant bermasalah.

`createActiveQrisInvoice` merutekan invoice baru; retry invoice lama mempertahankan provider ledger. Satu klaim `operation_guards` + INSERT initializing atomik sebelum POST, order ID stabil, satu pemenang. Timeout/hasil ambigu tidak di-POST ulang: recovery memakai GET ID sama. Status initializing/pending KlikQRIS tidak memicu kompensasi stok catch Telegram/web, dan cleanup stale-init/expiry existing tetap penjamin. Cron lite expiry menyertakan KlikQRIS pada tick existing agar pengembalian stok tidak menunggu route cadangan per jam; transisi bersyarat tetap mengembalikan sekali. Finalisasi ledger + deadline order dibatch dan difence agar cancel/expiry tidak dihidupkan kembali. Tidak mengklaim exactly-once jaringan provider.

`total_amount` harus integer Rupiah >= requested amount; nominal request/order/merchant wajib cocok, signature disimpan privat, timestamp provider tanpa zona dibaca WIB. **Keputusan owner: tetap 15 menit**, cap paling awal dengan deadline order existing/expiry provider; retry tidak memperpanjang. Provider uji memberi 60 menit: QR yang sudah disimpan tetap mungkin dibayar setelah batas AXVARA. Pelunasan seperti itu masuk manual review, tanpa revive/refund/fulfillment otomatis. Migrasi 0069 menambah satu kolom nullable `payment_transactions.provider_qris_url`, tanpa mengubah data/trigger/index rail lama. `qris_url` adalah proxy AXVARA `/api/payments/qris/[code]/image`; menerima kode AXV dan AXP. Proxy hanya mengambil HTTPS storage KlikQRIS (tanpa redirect), maksimum 2MB, wajib magic PNG, private/no-store. API key/signature tidak dikirim pada fetch gambar atau ke pembeli.

Callback `POST /api/payments/klikqris/callback` menerima JSON <=16KB dan signature constant-time, memeriksa nominal/merchant yang dikirim, lalu **wajib** cek status API autentikasi. Gagal API tidak berarti paid (503 agar provider retry). Merchant/order/requested/total/signature status harus cocok. Confirmed paid memakai event unik `klikqris:<order>:paid` di `dana_webhook_events` provider klikqris; raw_text/hash tidak memuat signature/key. Shared transition atomik melunasi order+ledger+event dan membuat outbox Market. Pedia memakai antreannya sendiri (tidak membuat/mengirim fulfillment Market dengan ID sama); materialisasi WR/SK idempoten + cron existing. Duplikat tidak mengirim ulang produk. EXPIRED gateway tidak memotong lifecycle lokal lebih awal; cron existing memegang pengembalian stok/kredit.

Pembayaran terkonfirmasi yang melewati deadline atau kalah cancel/expiry disimpan failed dengan last_error `klikqris_late_payment_manual_review`/`klikqris_payment_race_manual_review`, plus satu notifikasi admin pada insert pertama. Notifikasi gagal tidak dipaksa ulang pada setiap callback; entry Rekonsiliasi tetap durable. Admin API/UI melarang retry pencocokan nominal dan confirm_match KlikQRIS agar tidak diarahkan ke rail DANA/GoPay. Tindak lanjut: periksa pembayaran, status order dan stok untuk penyelesaian manual. Jangan menghidupkan order expired otomatis.

Callback per invoice memakai SITE.webUrl kanonis. Pemeriksaan manual web/Pedia `wake=1` dan tombol Telegram refresh memakai API status; polling browser biasa hanya membaca DB. Tidak ada worker/cron/polling baru. Webhook/poller/kredensial DANA/GoPay tetap untuk invoice lama. Rollback invoice baru: ubah QRIS_ACTIVE_PROVIDER + rilis CI; jangan cabut KLIKQRIS_ENABLED/key/merchant/callback selama invoice lama/late reconciliation masih perlu dikonfirmasi. Dokumentasi sumber: https://klikqris.com/dokumentasi-api. Uji produksi hanya membuat invoice unpaid berlabel AXVARA-INTEGRATION (callback probe diabaikan); tidak membayar atau menyimulasikan uang produksi sebagai paid.

Koreksi kapasitas env Pages 2026-10-18: penambahan tiga secret KlikQRIS membawa
konfigurasi produksi menjadi 61 + empat variabel sistem = 65 dan publish gagal.
Hanya `PEDIA_DISPATCH_ENABLED` yang tidak dikonsumsi runtime dihapus, sehingga
60 + 4 = 64; keempat env pemilihan/config KlikQRIS serta secret DANA/GoPay lama
tetap tersimpan sebagai `secret_text`. Guard CI dan bukti insiden ada di §17.2.

## 17. Penghematan rows_read D1 Free — 2026-10-16

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. Laporan pekerjaan:
`issue/d1-read-budget-2026-10-16.md`. Audit produksi membedakan kuota rows_read
(5 juta/hari, reset 07.00 WIB) dari jumlah statement, CPU Workers, dan rows_written.
Perbaikan log 0057 tetap terpasang; snapshot audit terakhir 4.582.928 rows_read.

- **Pedia:** `src/lib/pedia/catalog-queries.ts` mengawali query batas/rate dari
  tier dan produk aktif, lalu mencari mirror dengan pasangan `(supplier,service_id)`.
  Layanan supplier tak terpakai tidak dibaca untuk katalog. DTO, harga, bounds,
  guard present/Default/rate, dan pemisahan provider tetap. Percobaan baca produksi
  sebelum patch: 414 rows_read untuk 129 layanan rujukan vs rata-rata lama 5.024.
- **GoPay pending:** `/api/webhook/gopay/pending` menggunakan indeks unik existing
  `payment_transactions_active_gopay_amount` dengan predikat partial index eksplisit
  `provider='gopay' AND status IN ('initializing','pending')` dan filter pending.
  Invoice initializing tetap tidak dikirim; auth, expiry order/invoice, merchant
  dari QR tersimpan dan batas 50 tidak berubah. Tidak ada perubahan kontrak poller.
- **Cache katalog:** `src/lib/catalog-cache.ts` memakai Cache API `caches.default`
  secara eksplisit di dalam handler, sehingga panggilan SSR langsung ke handler
  Market ikut terlindungi. TTL Market 30 detik, by-slug 10, Pedia/kategori 60.
  Hanya katalog publik (`active=1` pada Market, kategori tanpa `all=1`); admin
  melewati cache dan autentikasi tetap dilakukan. Key Market mengikat search,
  kategori, slug dan flag varian; prefix kontrak `d1-v1` perlu direvisi bila DTO
  berubah. Cache per lokasi Cloudflare; bukan penyimpanan global atau jaminan hit
  lintas lokasi/deployment. Miss paralel digabung per proses (maks 128 key pending).
  Respons gagal/degraded/private/berkuki tidak disimpan; kegagalan Cache API
  memakai pembacaan langsung. `X-Axvara-Cache` HIT/MISS/BYPASS untuk diagnosis,
  Age mempertahankan umur respons. Cache tidak dipakai untuk quote, checkout,
  status pembayaran, capability atau kredensial. Dev tanpa binding/Cache API
  tetap membaca langsung; `CF-Cache-Status: DYNAMIC` tidak berarti cache internal
  ini miss. Harga/stok checkout tetap divalidasi melalui query aktual.
- **Admin:** section selain Ringkasan tidak memanggil overview. Periode standar
  memakai `selectedReportFromFinancial` dari fact set yang sama, bukan CTE kedua.
  Rentang historis tetap memakai perhitungan terpilih dan kontrak legacy respons
  tetap lengkap. `readOverviewFinancialReport` menahan hasil privat maksimal 60
  detik per binding D1 di proses produksi (bukan Cache API publik), dengan key
  hari WIB/jam dan generated_at snapshot aktual. Auth/revocation diperiksa setiap
  request; cache gagal dihapus agar retry dapat pulih. Pemanggil laporan lain
  tetap memiliki kontrak pembacaan baru.
- **Cron:** `src/lib/cron-queues.ts` memilih probe sesuai forced phase; mode rotasi
  lama tetap membaca seluruh sinyal admission/anti-starvation. Probe WR/SK tidak
  dibayar oleh fase lain. Watchdog, expiry, order, delivery, retry dan pemulihan
  yatim tetap berjalan; gerbang due tidak dipasang kembali pada probe yatim.
  `src/lib/maintenance-cleanup.ts` dipakai lite dan heavy, memakai marker sukses
  UTC `store_settings.maintenance_cleanup_at`; empat DELETE housekeeping maksimal
  sekali per jam pada run berurutan, termasuk data DANA >30 hari. Tick di antaranya
  hanya membaca marker. Kegagalan tidak memajukan marker; run paralel dapat
  melakukan cleanup idempoten bersamaan. Anggaran heavy cleanup menjadi 6 statement
  (marker + empat DELETE + marker selesai). Tidak ada throttle baru pada jalur uang.
- **Pairs:** agregat stok terbatas dan unlimited digabung satu pass per sisi
  pasangan, tetap satu SELECT dan UPDATE hanya bila berubah. Semua pasangan
  tetap dihitung pada versi 16 Oktober; revisi 17 Oktober memakai antrean
  invalidasi di bawah untuk diff dan mempertahankan sweep penuh sebagai cadangan.
- **Migrasi 0067:** indeks Pedia bernama baru pada tabel aktif memperbaiki kasus
  indeks lama masih milik arsip 0062; indeks mapping supplier+service, created_at
  event DANA, recent-paid recovery (status/payment_status + ekspresi tanggal),
  serta registry WR/SK by axvara_variant_id. Tidak DROP/rebuild tabel atau mengubah
  FK, state, harga, kredit, reservasi, maupun indeks unik nominal QRIS. CI menerapkan
  migrasi sebelum kode Pages; migration test memastikan idempotensi dan FK.
- **Observability:** `db/read-metrics.ts` mencatat metadata queryAll ≥1.000 rows_read
  di kedua akses database melalui log `[d1-read]` (scope tetap + jumlah baca/tulis).
  Tidak mencatat SQL, parameter, hasil, secret atau menulis telemetri ke D1;
  kegagalan log tidak menggagalkan query. first/batch tetap dianalisis via Cloudflare
  Query Insights. Ini pelengkap budget statement, bukan hard stop kuota baris.

Tidak ada env/binding/secret/flag/cron Worker/kontrak antar-repo baru. Verifikasi
biaya baca menggunakan D1/workerd dengan ribuan layanan tak terpakai, riwayat
GoPay terminal dan order lunas lama; cache diuji pada Cache API workerd asli.
Penurunan harian dan CPU produksi sesudah rilis belum diukur.


### 17.1 Penghematan lanjutan — 2026-10-17

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. Baseline audit pukul
11.04 WIB: 1.030.021 reads / 3.977 writes sejak reset; jam 10–11 menyumbang
511.960 reads. Pengukuran ini mendahului rilis lanjutan, bukan bukti penurunan
harian pascarilis. Laporan: `issue/d1-read-budget-phase2-2026-10-17.md`.

- **Ringkasan lengkap:** `admin-overview-cache.ts` menahan seluruh respons D1
  maksimal 60 detik di memori privat per binding/proses; key mencakup email admin,
  periode/rentang kanonik, hari dan jam. Auth, revocation dan validasi parameter
  selalu berjalan sebelum lookup. Miss paralel digabung, maksimal 16 key; error
  atau hasil query parsial tidak disimpan. TTL juga dibatasi expiry snapshot
  keuangan asal agar pergantian periode tidak memperpanjang umur data menjadi
  120 detik. Periode tetap berbagi agregat keuangan; ekspor tetap kontrak existing.
- **SQL Ringkasan:** `admin-overview-queries.ts` memulai attention dari status
  bermasalah di jobs/items, lalu lookup order paid dan COUNT DISTINCT kode order.
  Ringkasan status jobs hanya membaca status aktif; delivered tetap diabaikan
  oleh evaluator antrean dan sinyal kirim sukses tetap diukur terpisah. SUM omzet
  lama yang tidak dipakai respons dihapus; angka finansial tetap fact set existing.
- **Telegram:** `telegram/catalog-snapshot.ts` memakai satu key publik
  `telegram-catalog-v1`, TTL 30 detik, untuk daftar, filter kategori, pencarian dan
  bestseller. Snapshot minimal menyertakan ID/nama/kategori/urutan/terjual/alias
  dan harga varian tersedia termurah; baris habis disimpan dengan harga null
  untuk jawaban pencarian “habis”. Tidak menyertakan data pelanggan/pesanan/
  kredensial. Kegagalan Cache API membaca D1 langsung; checkout/detail/state
  percakapan tidak memakai snapshot. Cache per lokasi Cloudflare, bukan global.
- **SQL katalog/recipient:** filter pecundang mematerialisasi ID SK bila winner
  NULL/WR dan ID WR bila winner SK, lalu NOT IN; ID pasangan wajib NOT NULL.
  Aturan Opsi B dan redirect tombol lama tetap. Inventory unique memakai EXISTS
  dan indeks `(product_id,variant_id,status)`; indeks orders
  `(sales_channel,telegram_user_id,status,payment_status)` mendukung pencarian
  order paid pembeli saat recipient privat dipastikan. Tidak mengubah penerima.
- **Pasangan berubah:** migrasi `0068_d1_read_budget_phase2.sql` menambah tabel
  `supplier_pair_dirty(pair_id,version,pending)` dan indeks pending. Trigger SQL
  atomik menandai perubahan produk/varian, stok/modal registry WR/SK dan preferensi
  pasangan. UPDATE nilai identik tidak menandai ulang. Token versi acak diganti
  pada invalidasi; hasil ack menyetel pending=0 sambil mempertahankan token,
  mencegah proses lama mengakui generasi baru. Seed migrasi menandai semua pasangan.
  Request VPS `action:pairs` membaca maksimal 10 pasangan pending; UPDATE keputusan
  dan ack disyaratkan versi teramati. Error dipropagasikan sebagai non-2xx (503),
  tanpa membuang pending. Sisa/budget habis diproses berikutnya. Cron lite cleanup
  existing tiap lima menit juga menguras maksimal 10 selama budget cukup, setelah
  housekeeping: perubahan WR saja dan kegagalan request pasangan tidak bergantung
  pada diff SK baru. Saat bersih, satu SELECT indeks membaca nol baris statistik.
  Sweep penuh cron existing tetap ada dan tulisnya dijaga versi agar tidak menimpa
  keputusan dari data lebih baru. Tidak mengubah pemilihan stok/modal, flag,
  jadwal Worker atau request/response sukses VPS; tidak perlu deploy proxy.
- **Pengukuran:** `[catalog-cache]` scope/status dan `[overview-cache]` status
  melengkapi `[d1-read]`; tanpa key, SQL, parameter, isi hasil atau write telemetry.
  Query first/batch tetap memakai Query Insights untuk atribusi biaya.
- **Monitor akun:** `.github/workflows/d1-usage.yml` berjalan jam `:17` UTC
  (`:17` WIB juga), serta workflow_dispatch. Node 22 menjalankan
  `scripts/d1-usage-check.cjs --report /tmp/d1-usage.json --check` dengan Secrets CI
  existing `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`, `CLOUDFLARE_ACCOUNT_ID`;
  alternatif CLI menerima API_TOKEN. Hanya Cloudflare GraphQL Analytics, tanpa SQL
  aplikasi/deploy/env Pages baru. Menjumlahkan seluruh database akun sejak 00.00
  UTC (07.00 WIB), laju satu jam terakhir dari bucket tertutup (jeda ingest lima
  menit), proyeksi rata-rata/terkini, sisa anggaran/jam dan estimasi habis bersyarat.
  Limit Free: 5 juta reads dan 100 ribu writes/hari. Setelah jam pertama, proyeksi
  melampaui salah satu limit atau penggunaan ≥90% membuat status risk; limit
  tercapai exhausted. Analytics kosong unknown, respons invalid/gagal membuat job
  gagal, tanpa klaim kuota aman. Status risk/exhausted/unknown menghasilkan warning
  dan exit 1; error exit 2. Laporan agregat tampil di Actions summary dan artifact
  tujuh hari. Notifikasi mengikuti pengaturan GitHub owner; jadwal dapat terlambat,
  analytics dapat delayed/sampled. Ini alarm berkala, bukan alarm Telegram atau
  jaminan realtime, dan tidak menambah polling browser/tulis D1.

Uji D1/workerd dengan fixture besar: filter katalog 40.220→2.040 rows_read,
inventory 250.050→100, attention 24.997→10, tick pasangan bersih 0; hasil bisnis
sebelum/sesudah setara. EXPLAIN memakai indeks recipient baru, dan trigger migrasi
benar-benar dijalankan di workerd. Angka fixture tidak mewakili total produksi.
Target operasional ≤3 juta reads/hari (rata-rata 125 ribu/jam) membutuhkan satu
siklus produksi 07.00–07.00; risiko limit tetap bergantung trafik dan cache hit.


### 17.2. Kapasitas variabel Pages Free — 2026-10-18

Run CI 39128121106 (`47d118d`) lulus test/type-check/build/migrasi tetapi gagal
publish Pages: 65 variabel melebihi batas Free 64. Metadata project membuktikan
61 env produksi; Pages menambahkan `CF_PAGES`, `CF_PAGES_BRANCH`,
`CF_PAGES_COMMIT_SHA`, `CF_PAGES_URL`. Ini batas variabel, bukan kuota D1.

`PEDIA_DISPATCH_ENABLED` dihapus dari env produksi karena tidak ada konsumen di
kode runtime. Catatan flag dibuka 14 Oktober pada §16.10 adalah histori, bukan
gate dispatch aktual; `runPediaOrders` cron lite tetap memanggil
`processPediaPaidOrders` untuk antrean existing. Tidak mengubah penerimaan order
`PEDIA_ORDERS_ENABLED`, secret provider lama/baru, ataupun env preview. Sesudah
penghapusan: 60 konfigurasi + 4 sistem = 64; tidak ada ruang untuk env tambahan.

Guard read-only `scripts/ci-pages-env-check.cjs` berjalan di `ci.yml` push/main
sesudah type-check, sebelum build dan migrasi. GET project API menggunakan
Secrets CI Cloudflare existing, memvalidasi metadata produksi, menghitung
union nama konfigurasi + empat sistem tanpa menggandakan override. Total >64
atau API/auth/metadata gagal menghentikan rilis; tepat 64 menghasilkan warning.
Output hanya jumlah/limit; nilai env dan respons/error mentah tidak dicetak.
Tidak ada query D1, mutasi konfigurasi otomatis, secret runtime baru atau deploy
manual. Perubahan env produksi dilakukan terarah melalui API PATCH, hanya key
usang bernilai null; metadata env lain dan preview diperiksa tetap sama.

Referensi: [batas Workers](https://developers.cloudflare.com/workers/platform/limits/),
[sistem Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/),
[penghapusan env dengan null](https://developers.cloudflare.com/api/typescript/resources/pages/subresources/projects/methods/edit/).
Publikasi ulang tetap melalui push main dan CI; push bukan bukti deploy sukses.

## 18. Halaman maintenance kuota D1 — 2026-10-17

✅ Implementasi dan verifikasi lokal; publikasi melalui CI. `src/middleware.ts`
memeriksa ketersediaan D1 sebelum render halaman GET/HEAD dan rewrite Pedia.
`src/lib/d1-maintenance.ts` memakai binding DB seperti client existing, tanpa
mengimpor seed/helper order. Probe `SELECT key FROM store_settings LIMIT 1`
membaca paling banyak satu baris (teruji D1/workerd), tanpa COUNT atau write.
Hasil ditahan maksimal 60 detik per binding/proses, miss paralel digabung; Cache
API per origin/lokasi mengurangi probe lintas proses. Batas ini bukan satu
probe global: cold start/lokasi baru atau kegagalan cache dapat menambah probe.
Tidak ada polling browser. Deteksi/pemulihan dapat tertunda hingga 60 detik pada
request berikutnya. Cache dibatasi reset berikutnya dan key memakai hari UTC.

Hanya error resmi Cloudflare `exceeded D1's free tier daily row read limit`
atau `row write limit` (termasuk nested cause) mengaktifkan maintenance. Error
SQL, CPU, storage atau jaringan lain tetap memakai penanganan existing; probe
error lain ditahan 10 detik. Dev tanpa binding mempertahankan seed existing.
Tidak ada flag/env/secret, binding, migrasi atau jadwal cron baru. Ini menangani
kuota D1; kehabisan request/CPU Worker yang mencegah middleware berjalan tidak
dapat ditangani oleh halaman ini.

`src/lib/maintenance-page.ts` menghasilkan HTML+CSS mandiri, status 503,
Retry-After 60, private/no-store dan noindex. Tidak ada layout React, script,
fetch katalog/settings atau penulisan pesanan. Estimasi 07.00–08.00 WIB
menggunakan tanggal reset UTC berikutnya; situs pulih berdasarkan hasil probe,
bukan menunggu paksa sampai 08.00. Metadata error database tidak ditampilkan.
`/maintenance` (`src/app/maintenance/route.ts`, GET/HEAD edge) adalah dokumen
preview/fallback yang selalu menampilkan layar ini, bukan endpoint health;
middleware melewatkannya sebelum rewrite di kedua host agar tidak berulang.
Navigasi RSC saat kuota habis diarahkan 307 ke `/maintenance`, sedangkan
navigasi dokumen mempertahankan URL dengan HTML 503.

Tombol manual menuju hub absolut `https://axvara.tech/wa` dari `lib/site.ts`, sehingga
host Pedia tidak salah rewrite. `/wa` dan `/pedia/wa` saat maintenance menampilkan
hub mandiri tanpa D1: nomor berstatus active dari SUPPORT_WA_NUMBERS, pesan
`pesan` terbatas 300 karakter/URL-encoded, support Telegram (bukan bot order),
dan jam layanan. Ini mempertahankan pilihan nomor di hub dan tidak menyatakan
admin online 24 jam. API, webhook, supplier-sync, cron, MCP, R2, aset dan metode
mutasi tidak diganti HTML atau mendapat probe baru. CSRF serta routing normal
tetap. Tab yang sudah terbuka tetap memakai perilaku API existing sampai
navigasi/reload; ini bukan penghentian otomatis seluruh request atau bot.

Dokumentasi error resmi: https://developers.cloudflare.com/d1/observability/debug-d1/
dan https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/.
Pengujian meliputi dua jenis quota error/cause, pengecualian error lain, TTL/UTC
rollover/pemulihan/coalescing/cache failure, protocol bypass/CSRF/Pedia, link WA
aktif/escaping dan D1/Cache API workerd. Obscura memeriksa route preview nyata
dan middleware aktual yang dibundel dengan fixture DB kuota lokal di
320/390/1280px; fixture bukan secret/flag produksi.

Perbaikan publikasi 2026-10-17: tahap migrasi tetap berada sebelum Pages.
`scripts/ci-d1-migrations.cjs` mendapat bukti melalui GitHub CLI read-only:
rilis `ci.yml` terbaru yang sukses, event push/main, job verify-and-deploy sukses,
dan tahap migrasi serta deploy Pages sukses. Commit baseline wajib ancestor
HEAD; fingerprint git dari `drizzle/migrations`, `drizzle/schema.sql` dan
`wrangler.json` harus identik dan lengkap. Hanya kondisi tersebut menghindari
query D1 yang tidak diperlukan pada rilis kode saja. Jika bukti/API/history
tidak tersedia atau DB files berbeda, Wrangler `d1 migrations apply --remote`
tetap dijalankan dan exit gagal tetap menggagalkan deploy. Tidak ada
continue-on-error, penundaan migrasi baru atau deploy manual. Checkout history
penuh; permission Actions read dan GH_TOKEN dari token otomatis workflow
bukan Pages env/secret baru. `--check-only` menampilkan keputusan tanpa
menjalankan Wrangler. Bukti ini mengasumsikan database produksi tidak di-restore/
recreate di luar CI; setelah operasi tersebut pemeriksaan remote wajib dilakukan.
Push bukan bukti halaman maintenance sudah aktif.

Bukti insiden: run 38941622661 (830a573) gagal 17 Okt 00.44 WIB di query D1
[code 7500], deploy Pages/MCP skipped; pemeriksaan publik 17 Okt 05.49 WIB:
home 200, /maintenance 404, API katalog 500. Baseline run 38936424025 (ed2c41c)
migrasi+Pages sukses dan fingerprint DB identik; dry-run helper aktual memutuskan
tidak perlu remote query. Ini membuktikan penghalang rilis, bukan cache browser
atau hasil produksi patch terbaru.

### Notifikasi saldo Pedia tanpa spam saat D1 gagal — 2026-10-17

`lib/pedia/notify.ts` tidak lagi menganggap error baca sebagai state kosong atau
menelan error tulis lalu tetap mengirim. Alert admin nonkritis ditunda bila DB
tidak diberikan, baca gagal atau reservasi gagal (termasuk kuota/query budget).
State `amount|ms` memakai upsert compare-and-set terhadap value yang dibaca;
`changes === 1` wajib sebelum Telegram, sehingga dua tick yang membaca value
lama sama tidak sama-sama mengirim. Kunci per provider, parsing UTC legacy,
ambang env serta throttle enam jam/penurunan Rp5.000 dipertahankan. Migrasi
format legacy juga conditional dan tidak mengirim ulang. `true` hanya bila
respons Telegram ok; penolakan/timeout tetap menahan reservasi untuk menghindari
retry ambigu tiap tick. Ini dapat menunda alert sampai jadwal pengingat berikut,
bukan jaminan exactly-once atau mekanisme retry notifikasi pembeli.

`api/cron/lite` tidak memanggil proxy ProviderSMM jika baca/tulis checkpoint
30 menit gagal. Kegagalan supplier itu tidak menghentikan checkpoint IndoSMM.
Tidak ada tabel, env Pages, kontrak proxy, jadwal cron, dispatch atau jalur uang
baru. Tes menginjeksi error read/write/budget, dua cron paralel, dua provider,
12 tick lima-menit saat DB terblokir lalu pulih, serta Telegram menolak.
