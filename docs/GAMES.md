# AXVARA Games — Spesifikasi Produk & Desain

> **Status (9 November 2026): backend inti, admin data, API pembeli B1 QRIS + B2 gateway/crypto dan S1 routing/nickname berbiaya diimplementasikan lokal; belum ada bukti deployment Games.**
> Env Digiflazz, UI storefront, nickname publik, deposit dan transaksi nyata belum termasuk bukti B1/B2; non-QRIS kini diuji fixture lokal B2.
> §1–§11 mempertahankan rancangan awal; keputusan terbuka yang sudah dijawab
> digantikan §9. Kontrak implementasi terkini ada di **§14**; §12–§13 adalah histori kontrak
> backend 9–12 November yang sebagian sudah digantikan §14.
> Ringkasan ada di `docs/PRD.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`;
> aturan supplier di `docs/agent-rules/digiflazz.md`.
>
> **Status dokumen (14 November 2026): §14 adalah kontrak implementasi lokal yang berlaku
> sekarang — markup OD1, katalog SK + `games_meta`, storefront Oura+ditopup, admin per game,
> dan aset resmi lokal. §1–§13 dipertahankan sebagai histori/kontrak lama; klaim yang
> bertentangan ditandai di tempatnya. "Lokal" berarti kode + tes di worktree integrasi
> `games-sk-integration`, bukan publikasi CI dan bukan deployment terverifikasi.**

## 1. Posisi produk

- **[DISETUJUI]** AXVARA Games adalah lini ketiga `axvara.tech` setelah Market
  (tools premium) dan Pedia (sosial media), dengan pola yang sama seperti Pedia:
  satu domain, layout dan navbar sendiri, footer/ekosistem bersama, order tanpa login.
- **[DISETUJUI]** Supplier: Digiflazz buyer. Seller utama Om\*\*\* plus pengisi celah;
  kode buyer `<game>[id]<nominal>` (contoh `ml86`, `mlid97`, `ff140`, `pubg60`).
- **[DISETUJUI]** Pembayaran: rail yang sudah ada di Market/Pedia — QRIS,
  Virtual Account, e-wallet (gateway Sekalipay) dan crypto (NOWPayments).
- **[DIGANTIKAN §14 OD1, 14 November 2026]** Harga jual = markup 5 % + pembulatan Rp100 di
  atas modal supplier (bukan lagi Oura −2 % / lantai 3 %). Teks di bawah adalah aturan lama
  9 November dan hanya berlaku sebagai histori: harga jual = harga Oura Store −2%, batas
  bawah = modal Digiflazz + biaya kanal + margin minimum 3 %. Snapshot 9 Nov 2026: ruang
  FF/FF MAX median ~24 %, ML ~5 %, PUBG ~6 %, Valorant ~5,5 %, CODM ~8 %, Genshin <1 %.
- **Acuan UX: Oura Store** (ourastore.com) karena pola belinya sudah dikenal pembeli
  game Indonesia. Kita meniru **pola alur dan tata letak**, bukan aset, ilustrasi,
  banner, warna, logo atau teks mereka. Identitas visual tetap AXVARA (§6).

## 2. Ruang lingkup MVP

**[KEPUTUSAN TERBUKA]** daftar game peluncuran. Usulan bertahap:

| Gelombang | Game | Alasan |
|---|---|---|
| 1 (peluncuran) | Free Fire, Free Fire MAX, Mobile Legends, PUBG Mobile | Volume terbesar; seller matang lengkap; FF margin tinggi |
| 2 | Magic Chess Go Go, Valorant, CODM, Honor of Kings, Blood Strike, Delta Force | Seller matang ada, katalog kecil |
| 3 | Genshin, Honkai SR, ZZZ, Wuthering Waves, AOV, Super Sus, Sausage Man, Stumble Guys, Eggy Party, Undawn, Wild Rift | Margin tipis/katalog terbatas; tampil setelah pricing stabil |

Di luar MVP: joki, leaderboard, akun member/koin, voucher non-game, pulsa/tagihan.

## 3. Informasi arsitektur (route internal dan URL kanonis)

Mengikuti pola `src/app/pedia/*`:

| Route | Isi |
|---|---|
| `/games` | Beranda Games |
| `/games/[slug]` | Halaman game (pilih nominal + bayar), mis. `/games/mobile-legends` |
| `/games/pesanan/[code]` | Pembayaran & status pesanan |
| `/games/lacak` | Lacak pesanan (kode/WA) |
| `/games/bantuan`, `/games/ketentuan` | Bantuan & S&K khusus top up |

`ServicesMenu` dan `CrossServicePromo` bertambah entri Games; footer bersama tetap satu.
Seperti Pedia, Games memakai route internal `/games` dengan URL kanonis final
`https://games.axvara.tech` (`SITE.gamesUrl`). Middleware rewrite `/` ke `/games`
dan path halaman ke `/games/*` tanpa flag enable; host lain `/games/*` dialihkan
308 ke host Games, kecuali localhost/127.*. API/aset/R2/MCP tidak direwrite;
admin produksi tetap dialihkan ke apex. Semua return tetap memiliki security headers.
`GAMES_HOST` opsional mengubah host routing (default `games.axvara.tech`; Pages
`secret_text` bila dipasang). Canonical/OG/sitemap tetap host publik final.
Sitemap Games hanya root + slug registry dengan SKU enabled yang dapat dijual;
robots menutup API privat/status/lacak. PM9November2026 sekitar21.40–22.05WIB memasang
CNAME `games` ke `axvara.pages.dev` (proxied) + custom domain Pages `games.axvara.tech`.
Status awal initializing; domain aktif/DNS end-to-end belum diverifikasi, bukan klaim live.
Access admin belum mencakup host ini: `/admin` produksi ke apex, `/api/admin` fail-closed.

## 4. Beranda `/games`

Urutan section (atas → bawah):

1. **Navbar Games** — logo AXVARA + label Games, search "Cari game…", bahasa/mata uang,
   ServicesMenu. Tanpa tombol masuk/daftar.
2. **Hero** — lihat §4.1.
   Tepat sesudahnya dua kartu ekosistem **AXVARA Market + AXVARA Pedia**, pola
   `CommunityBar`/`CrossServicePromo` Market identik (utm_source=games), berdampingan
   juga pada375px, sebelum katalog/populer. Tidak ada kartu komunitas tambahan.
3. **Populer sekarang** — **14 Nov 2026 koreksi owner:** maks 9 kartu horizontal 1/2/3 kolom,
   urutan admin `featured_rank` atau daftar default terkurasi; termasuk belum bisa dijual,
   disembunyikan hanya bila hasil kosong. Detail pemilihan/tampilan di §14.5.
4. **Kategori genre** — chip di bawah heading/count katalog: Semua · MOBA · Shooter & Battle
   Royale · RPG & Petualangan · Olahraga & Balap · Strategi · Kasual & Sosial. Genre kosong
   disembunyikan, slug belum dipetakan hanya di Semua; chip menyaring grid, bukan populer.
5. **Grid semua game** — **14 Nov 2026 koreksi owner (G2b):** portrait 2:3 full-bleed tanpa teks
   saat diam di pointer-fine; hover/fokus ring cyan + gap, scale dan overlay nama/publisher/status;
   touch menampilkan overlay selalu. Fallback ikon square tetap utuh. Grid 2/3/4/6 kolom
   (base/sm/md/lg). Semua hasil filter
   selalu terlihat tanpa batas 12 atau tombol "Tampilkan lainnya"; count mengikuti filter.
6. **Cara top up** — 4 langkah ber-ikon (Pilih game → Masukkan ID → Bayar → Diamond masuk).
7. **Kepercayaan** — proses otomatis 24 jam, rail pembayaran (logo QRIS/VA/e-wallet/crypto),
   bantuan WA; tanpa angka rating palsu (§5.4).
8. **FAQ singkat** + footer bersama.
  **Revisi 15 Nov 2026:** 48 portrait diganti gaya Oura (karakter resmi + logo judul resmi terpanggang di gambar, gradien navy seragam; master 1200×1800 di `scripts/games-assets-src/portraits/`, sumber di `docs/games-portrait-sources.md`); kartu ber-portrait tidak lagi menampilkan overlay nama/publisher/harga (desktop maupun touch), nama tetap di aria-label; game belum tersedia memakai pill kecil "Segera tersedia" di pojok kanan atas; overlay teks hanya untuk fallback ikon.

**Tidak ada popup saat halaman dibuka** (Oura memunculkan popup "follow channel" yang
menutup konten). Ajakan komunitas cukup di footer/pill komunitas yang sudah ada.

### 4.1 Hero — [DISETUJUI; koreksi owner 10 November 2026, lokal]

Hero Games memakai kelas tipografi, CTA, grid dan padding hero Pedia persis,
tanpa eyebrow kuning "AXVARA GAMES". Radial gold Games dihapus; glow cyan Pedia.
Orbit memakai ulang `PediaOrbit`, termasuk pusat orb kaca3D dan games-mark putih
dengan perlakuan identik pedia-mark, ring/planet/animasi serta aturan mobile/reduced-motion.
**[DIGANTIKAN §14, 14 November 2026]** Planet kini berasal dari empat game pertama
urutan katalog API. **Histori:** empat planet berasal dari registry, tidak dari SKU enabled. Masing-masing dapat
diklik ke `/games/<slug>` meski katalog kosong. Halaman game registry tanpa SKU
enabled harus200 + header game + **"Nominal segera tersedia"** (EN tersedia),
robots noindex sampai ada SKU; tidak menampilkan form checkout/nickname. Slug di
luar registry tetap404; sitemap tetap hanya game yang memiliki SKU sellable.

Pilihan awal berikut adalah histori keputusan hybrid, bukan alternatif terbuka:

| Opsi | Isi | Kelebihan | Kekurangan |
|---|---|---|---|
| A. Orbit | Headline + orbit AXVARA dengan **ikon game sebagai planet** (bisa diklik) | Ciri khas paling kuat, konsisten dengan Market/Pedia, tidak butuh materi promo baru | Promo/event tidak punya tempat menonjol |
| B. Carousel | Banner promo lebar seperti Oura | Familiar bagi pembeli game, cocok untuk event/promo | Butuh desain banner rutin; tanpa materi terasa kosong; kurang khas AXVARA |
| **C. Hybrid (usulan)** | Hero orbit (Opsi A) + **carousel promo tipis** tepat di bawahnya, hanya tampil bila admin punya ≥1 banner aktif | Identitas AXVARA tetap; promo tetap punya panggung; tidak ada ruang kosong | Satu komponen lebih banyak |

Keputusan: **Opsi C**. Orbit memakai komponen orbit Pedia (aturan hemat mobile:
compositor-only, keempat planet tetap tampil ≤640px, reduced-motion statis). Headline:
"Satu tempat untuk / top up game favorit." statis dua baris putih (typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit))
(pola Pedia). Carousel memakai kontrak banner carousel existing (ARCHITECTURE "Kontrak
banner carousel"), rasio 3:1 desktop / 2:1 mobile, autoplay berhenti saat interaksi,
tanpa autoplay saat reduced motion.

## 5. Halaman game `/games/[slug]`

Pola Oura dipertahankan: **header identitas game + kartu langkah bernomor di kiri +
rail ringkasan sticky di kanan (desktop) / bar bawah (mobile)**.

### 5.1 Header
- Banner game lebar (rasio ~5:1 desktop, 2.5:1 mobile) dengan overlay gradien midnight
  agar teks terbaca; tile ikon game menumpang di kiri bawah; nama game (Space Grotesk 700),
  publisher, chip: ⚡ Proses otomatis · 🕐 24 jam · 🛡 Pembayaran aman (Lucide, bukan emoji).
- **[DIGANTIKAN §14 OD4]** "Pengiriman instan" kini muncul **per kartu nominal yang tersedia**
  (permintaan owner, pola ditopup), bukan sekali di header. Kalimat lama: "cukup sekali di
  header, tidak diulang di setiap kartu" — tidak lagi berlaku.

### 5.2 Langkah bernomor (kartu glass, nomor dalam kotak gold; MVP tanpa Jumlah)
Urutan implementasi MVP: **1 Data akun → 2 Pilih nominal → 3 Metode pembayaran → 4 Kontak** (langkah Jumlah/stepper disembunyikan karena quantity selalu 1 — lihat §12.8 P5).
1. **Data akun** — field sesuai game (ML: User ID + Zone ID; FF: Player ID; PUBG: ID;
   Genshin: UID + server). Ikon ⓘ membuka panduan "cara menemukan ID" (gambar milik
   AXVARA). Validasi format inline. **Cek nickname** otomatis setelah ID lengkap
   (produk "Cek Username" Digiflazz; tampil "Nickname: xxx ✓") sebelum pembeli membayar —
    disetujui owner (§9.3). `POST /api/games/nickname` menerima `{slug,fields}`,
    stream maksimal8.000byte; hasil `{status:"ok",nickname}` / `{status:"unavailable"}` /
    `{status:"invalid",message}` (ID/EN cookie `axv_locale`). Format invalid tidak memanggil supplier.
    P9 testing/konfigurasi kosong selalu unavailable tanpa nickname palsu.
    SKU FF/FF MAX=`ffcekusername` (snapshot Rp5), ML=`mlcekusername` (Rp24),
    PUBG=`pubgcekusername` (Rp80); `max_price` = modal katalog bila ada, fallback
    snapshot bila belum ada; modal >Rp80 ditolak agar batas global tetap <=Rp40.000/hari.
    D1 cache sukses24jam/ID invalid1jam per namespace lookup+customer_no (FF MAX berbagi FF).
    Admission atomik: IP10 + perangkat cookie httpOnly5 per15menit rolling, global500/hari UTC.
    D1 error/limit/saldo kurang/ambigu menjadi unavailable, bukan penghalang checkout.
    Pending dicek ulang sekali sesudah1,5detik dengan payload/ref `NCK-*` sama;
    pending/ambigu tetap diklaim tanpa expiry, tidak membeli ulang. S1b lokal: request
    berikut setelah checked_at berumur60detik melakukan satu re-poll dengan CAS D1,
    memakai ref/payload/max_price log asli. Tidak ada log biaya baru/slot global500
    karena lookup ref existing tidak membeli ulang. Re-poll IP10/perangkat5 per15menit
    memakai rateLimit existing best-effort per isolate (counter terpisah dari admission
    berbayar D1); CAS60detik tetap durable dan hasil respons lama berpagar pemilik.
    Hanya rc54 resmi "Nomor Tujuan Salah" menjadi invalid "ID tidak ditemukan" / "ID not found";
    rc55 gangguan bukan invalid. SN dibersihkan HTML/kontrol, trim, maksimal64karakter.
    Admin menampilkan jumlah dan batas modal hari ini/7hari kalender UTC, bukan tagihan settlement.
   Opsi "ingat ID di perangkat ini" (localStorage, opt-in).
2. **Pilih nominal** — lihat §5.3.
3. **Jumlah** — MVP: quantity 1, langkah Jumlah disembunyikan (P5).
4. **Metode pembayaran** — akordeon pembayaran Market/Pedia; **harga total per metode
   sudah termasuk biaya** ditampilkan sebelum memilih.
5. **Kontak** — WhatsApp + email (pola checkout Market: wajib, hint kegunaan).
6. **Kode promo** — [KEPUTUSAN TERBUKA], sembunyikan sampai fitur promo ada.

### 5.3 Pilih nominal (perbaikan utama vs Oura)
Masalah di Oura: ML punya ±150 nominal dalam satu daftar panjang; promo dan reguler
dengan harga hampir sama tampil ganda; pembayaran tertimbun jauh di bawah.

**[DIGANTIKAN §14 OD4]** Daftar chip rentang harga + grup Spesial/Terlaris/Semua di bawah
diganti chip TIPE/REGION ber-count dan section KATEGORI Oura-style (lihat §14). Teks lama
dipertahankan sebagai histori:

AXVARA:
- **Grup** berurutan: Spesial (WDP/Twilight/Membership), Terlaris, Semua nominal.
- **Terlaris** (6–8 nominal pilihan admin) tampil default; "Semua nominal" dilipat
  dengan tombol "Lihat semua (N)".
- **Chip filter rentang** (≤100, 100–500, 500–2.000, >2.000) + kolom cari angka.
- Satu kartu per nominal — bila ada SKU ganda, tampilkan harga termurah yang sehat saja.
- Kartu: ikon mata uang game (diamond/UC/VP, SVG AXVARA), nominal (bonus dipisah
  "77 + 8 bonus"), harga Space Grotesk; badge gold kecil "Terlaris"/"Hemat" seperlunya.
- Kartu = radio (`role="radiogroup"`), terpilih: border cyan + glow + centang.
- Grid 2 kolom mobile, 3 kolom desktop; tinggi kartu ringkas (±72px mobile).
- SKU OFF/gangguan: abu-abu "Sedang gangguan", tidak bisa dipilih (tidak hilang diam-diam).

### 5.4 Rail ringkasan
- Desktop: kolom kanan 360px sticky — ringkasan (game, ID+nickname, nominal, metode,
  total), CTA "Bayar sekarang", tautan bantuan WA.
- **Tidak menampilkan rating/ulasan** sampai AXVARA punya data ulasan nyata
  (Oura menampilkan 4.99/9.97jt; kita tidak boleh mengarang angka).
- Mobile: bar bawah **satu baris** (nominal + total + CTA) setinggi ±64px + safe area;
  saat belum memilih cukup CTA nonaktif berlabel "Pilih nominal". Oura memakai panel
  bawah ±150px walau kosong sehingga memakan layar.
- CTA yang belum siap tidak diam: klik menggulir ke langkah pertama yang belum lengkap
  (pola validasi checkout Market).

## 6. Rasa AXVARA (yang membedakan dari Oura)

- Token tetap: midnight `#080C1E`/`#0F1430`, cyan `#00E5FF` (aksi/terpilih/fokus),
  gold `#FFB800` (nomor langkah, badge terlaris), glass `ax-glass`, Space Grotesk untuk
  judul & harga, Inter body. Oura memakai abu/krem datar — kita glass + glow.
- Orbit di hero, glow radial cyan+gold section-level seperti Market/Pedia.
- Motion Apple spring yang hemat: pilih kartu = scale 0.98→1 + glow 160ms; hormati
  reduced motion.
- Copy ringkas, bahasa santai-sopan khas AXVARA, ID/EN mengikuti preferensi bahasa
  yang sudah ada.

## 7. Aset & ikon

- Ikon chrome navbar/bottom nav: `IosIcon` mengikuti Market/Pedia; ikon konten:
  Lucide (outline 20px, stroke 1.75), keputusan PM 9 November 2026.
- **[DIGANTIKAN §14 OD5]** Ikon/banner game: aset resmi publisher kini disimpan sebagai
  berkas statis di `public/brand/games/` (tanpa unggah R2) dengan urutan admin `games_meta`
  → aset lokal resmi → fallback AXVARA; **jangan mengambil banner, ilustrasi, atau gambar
  buatan Oura**. Kalimat "disimpan di R2 dan dikelola admin" tidak lagi akurat untuk paket
  ini. Panduan "cara cari ID" tetap dibuat sendiri.
- Ikon mata uang (diamond, UC, VP, CP, dsb.): SVG buatan AXVARA.

## 8. Alur pesanan (ringkas; detail teknis di ARCHITECTURE)

Pilih game → isi ID (+cek nickname) → pilih nominal → pilih metode → kontak →
pesanan dibuat dengan harga terkunci → bayar → pembayaran terverifikasi → kirim ke
Digiflazz (`ref_id` unik, `max_price`) → Sukses (tampilkan SN/keterangan) / Pending
(cek ulang `ref_id` sama, webhook) / Gagal.

**[KEPUTUSAN TERBUKA]** penanganan gagal setelah bayar: refund manual via admin,
kredit AXVARA, atau coba seller cadangan otomatis. Halaman status wajib jujur
(pola status Pedia), tanpa "sukses" sebelum Digiflazz menyatakan sukses.

## 9. Keputusan owner 9 November 2026 [DISETUJUI]

1. **Hero: Opsi C hybrid** — orbit AXVARA dengan ikon game sebagai planet yang bisa
   diklik + carousel promo tipis di bawahnya hanya bila ada banner aktif.
2. **Gelombang 1:** Free Fire, Free Fire MAX, Mobile Legends, PUBG Mobile.
3. **Cek nickname sebelum bayar: aktif** (produk "Cek Username" Digiflazz). Wajib
   rate limit per IP/perangkat dan cache hasil per ID+game agar biaya cek tidak
   disalahgunakan; kegagalan cek tidak memblokir bila supplier cek sedang gangguan
   (tampilkan "Nickname belum bisa dicek, pastikan ID benar").
4. **Gagal setelah bayar: otomatis coba seller cadangan.** Digiflazz tidak punya fitur
   backup seller, jadi tiap nominal mendapat baris kedua di akun buyer dengan kode
   ber-akhiran `b` (mis. `ff140b`) yang memakai seller matang lain. Aturan: hanya
   setelah status **Gagal final** dari seller utama (bukan Pending/timeout), memakai
   `ref_id` baru yang tercatat terhubung ke pesanan yang sama, tetap dengan
   `max_price` = batas modal pesanan; bila cadangan juga gagal → status
   "Perlu tindakan admin" + notifikasi admin (refund manual). Tidak pernah dua dispatch
   aktif bersamaan untuk satu pesanan.
5. **Kode promo: menyusul** (langkah 6 disembunyikan di MVP).
6. **Aset awal disiapkan agent:** logo/ikon & key art resmi game diambil dari sumber
   resmi publisher/toko aplikasi/press kit (identifikasi produk), dioptimasi WebP dan
   disimpan di R2; **tidak** mengambil aset buatan toko top up lain (termasuk Oura).
   Ikon mata uang dan panduan "cara cari ID" dibuat sendiri.

## 10. Kriteria selesai (untuk tahap implementasi nanti)

- Desktop/mobile diperiksa di browser nyata: pilih nominal, validasi ID, metode,
  sticky bar, keyboard/fokus, reduced motion.
- Tidak ada popup saat masuk; tidak ada angka rating fiktif; total per metode benar.
- Test harga (rumus Oura −2% + batas bawah), dispatch idempoten, webhook HMAC, status jujur.
- Dokumen PRD/DESIGN/ARCHITECTURE/README/CHANGELOG diperbarui sesuai aturan repo.

## 11. Rencana kerja implementasi (brief serah terima untuk Paseo orkestrator)

Sudah dikerjakan (9 November 2026):
- Akun Digiflazz: 612 produk Games unik, 596 ON dengan kode buyer final; seller
  cadangan berkode akhiran `b` untuk gelombang 1 (lihat `docs/agent-rules/digiflazz.md`).
- `src/lib/games/pricing.ts` + `tests/games-pricing.test.ts`: rumus harga jual murni
  (`computeGamesSellPrice`, `gamesPriceFloor`) — pakai ini, jangan menulis ulang.
- Preflight baca-saja `scripts/digiflazz-preflight.mjs` lewat SSH VPS (Development OK).

Urutan fase (masing-masing satu PR/commit logis, wajib baca AGENTS.md + aturan area):

| Fase | Isi | Repo/area | Selesai bila |
|---|---|---|---|
| G1 | Proxy `/dgf/*` di VPS: allowlist eksak `POST /dgf/v1/{cek-saldo,price-list,transaction}`, header `x-proxy-token`, body diteruskan apa adanya ke `api.digiflazz.com`, timeout & error kode seperti `/skg/*` | `/Users/macbookair/axvara-wr-proxy` (cek worktree kotor milik tugas lain dulu) + `axvara-wr-proxy/AGENTS.md` | test proxy lulus; `cek-saldo` Development lewat proxy 200; tanpa `/transaction` nyata |
| G2 | Klien Digiflazz server-side (sign MD5, price-list, transaction, cek status `ref_id` sama, parser respons) + env `secret_text` | `src/lib/games/digiflazz.ts` | test kontrak dengan fixture; tidak ada key di bundle klien |
| G3 | Schema D1 + migrasi: game, SKU (kode utama/cadangan, modal, referensi Oura, harga jual), pesanan game, dispatch | `drizzle/schema.sql`, `migrations/` | migrasi lokal/remote via CI; ARCHITECTURE §4 diperbarui |
| G4 | Sinkron katalog terjadwal (cache, batas rate price-list) + hitung harga via `pricing.ts`; input harga referensi admin | cron + admin | test sinkron & harga; tidak memanggil price-list per page view |
| G5 | Order + dispatch: buat pesanan harga terkunci → rail pembayaran existing → setelah terverifikasi kirim `transaction` (`max_price`, `ref_id` unik) → pending cek ulang `ref_id` sama → Gagal final: coba kode `b` sekali → gagal lagi: "Perlu tindakan admin" | `src/lib/games/*`, `src/app/api/games/*` | test idempoten, tidak ada dua dispatch aktif, fixture `testing:true` sukses/gagal/pending |
| G6 | Webhook `POST /api/games/digiflazz/webhook` (HMAC-SHA1 `X-Hub-Signature` body mentah, idempoten) + cek nickname (rate limit + cache) | API | test signature salah ditolak, duplikat aman |
| G7 | UI `/games`, `/games/[slug]`, `/games/pesanan/[code]`, lacak/bantuan/ketentuan sesuai §4–§7 & §9; aset game resmi di R2 | `src/app/games/*`, komponen | verifikasi browser nyata desktop/mobile, keyboard, reduced motion; README/ARCHITECTURE/DESIGN diperbarui |
| G8 | Go-live: keputusan key owner (7.1 ditutup tanpa rotasi9Nov malam), mode Production + OTP owner, deposit kecil, satu transaksi nyata disetujui owner | owner + agent | bukti transaksi sukses; tanpa QA di produksi selain yang disetujui |

Batasan: jangan mengaktifkan webhook dashboard sebelum G6 terdeploy; jangan deposit
atau transaksi produksi tanpa izin owner; jangan mengubah seller/kode di akun tanpa
mencatat di `docs/agent-rules/digiflazz.md`.

## 12. Kontrak teknis backend (9 November 2026, implementasi bertahap)

Cakupan yang sudah diimplementasikan lokal: proxy `/dgf`, klien Digiflazz, schema,
sinkron katalog/harga, dispatch + seller cadangan, webhook, cron, admin data
(§12.7), dan API pembeli B1 QRIS + B2 gateway/crypto (§12.8).
Routing host, SKU utilitas dan endpoint nickname publik S1 juga tersedia lokal;
UI storefront masih paket terpisah.

### 12.1 Egress & env
- Panggilan runtime: `POST {WARUNG_REBAHAN_PROXY_URL}/dgf/v1/{cek-saldo|price-list|transaction}`
  dengan `x-proxy-token: WARUNG_REBAHAN_PROXY_TOKEN` (VPS & token yang sama dengan Pedia).
  Body ditandatangani di Pages: `sign = md5(username + key + X)` dengan X = `depo` /
  `pricelist` / `ref_id`. Key tidak pernah dikirim ke VPS.
- Env Pages (semua `secret_text`, dipasang PM9Nov2026 malam; berlaku pada deployment
  CI berikutnya): `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` (Development Key),
  `DIGIFLAZZ_WEBHOOK_SECRET`, `DIGIFLAZZ_TESTING=true` (`true` → kirim `testing:true`). Tanpa
  `DIGIFLAZZ_USERNAME`/`DIGIFLAZZ_API_KEY` semua job Games no-op (tidak error).

### 12.2 Data (D1)
- `games_products`: satu baris per SKU utama. `buyer_sku_code` UNIQUE, `backup_sku_code`
  (kode `…b`, nullable), `game_brand`, `product_type` (Umum/Indonesia/Membership),
  `product_name`, `cost`, `backup_cost`, `seller_active`, `backup_seller_active`,
  `unlimited_stock`, `stock`, `multi`, `start_cut_off`, `end_cut_off`, `description`,
  `reference_price` (Oura, input admin, nullable), `sell_price` (hasil
  `computeGamesSellPrice` dengan biaya kanal 0 — biaya kanal ditambahkan rail pembayaran
  seperti Market/Pedia), `enabled` (tampil ke pembeli, default 0), `synced_at`.
- `games_order_items`: satu baris per pesanan (`order_code` UNIQUE FK `orders.code`,
  `orders.order_kind='games'`), `product_id`, `buyer_sku_code`, `customer_no`,
  `customer_nickname`, `quantity` (MVP = 1), `unit_price`, `total`, `cost_snapshot`,
  `max_price`, `status` ∈ awaiting_payment | queued | submitting | pending | success |
  needs_check | expired, `attempt_no` (1 utama, 2 cadangan), `sn`, `supplier_message`,
  `lease_until`, `submit_attempts`, `last_polled_at`, `completed_at`, `last_error`.
- `games_dispatch_attempts`: `ref_id` UNIQUE (`<order_code>-<attempt_no>`), `order_code`,
  `attempt_no` (UNIQUE bersama order_code), `buyer_sku_code`, `status` ∈ submitting |
   pending | success | failed | ambiguous, `rc`, `message`, `sn`, `price`.
- Migrasi0109: `games_nickname_cache` PK `(game_key,customer_no)`, `ref_id` UNIQUE,
  hasil/nickname/checked_at/expiry; `games_nickname_checks` log admission+biaya (`ref_id`
  PK, slug, SKU, cost, status, rc, created_at). IP berupa HMAC domain checkout existing,
  perangkat UUID acak. Customer_no disimpan plain untuk kunci akun game non-secret;
  tidak ada kontak/pembayaran/kredensial dalam cache. Tidak mengakses API supplier pada cache hit.

### 12.3 Alur dispatch
1. Pembayaran terverifikasi → `schedulePaidFulfillment(code,'games')` → `processGamesPaidOrders()`;
   cron lite `games_orders` adalah jalur pemulihan.
2. Klaim berpagar: `queued` + lease kedaluwarsa → `submitting` (lease 300 dtk) dengan
   `changes===1`; baru kemudian insert attempt + panggil `transaction`.
3. Respons `status`: **Sukses** → item `success` (simpan `sn`); **Pending** → item
   `pending`; **Gagal** (final) → bila `attempt_no=1`, ada `backup_sku_code` aktif dan
   `backup_cost ≤ max_price` → attempt 2 (ref baru) di run berikutnya, selain itu
   `needs_check` + notifikasi admin Telegram.
4. Transport ambigu (timeout/502/504/tak terbaca) → attempt `ambiguous`, item `pending`;
   dicek ulang dengan **payload & `ref_id` yang sama** (Digiflazz mengembalikan status
   transaksi existing). Tidak pernah membuat ref baru untuk ambiguitas.
5. Polling pending dengan backoff (60/120/300 dtk); pending > 24 jam → `needs_check`.
6. Tidak pernah dua attempt aktif untuk satu pesanan; `max_price` selalu dikirim.

### 12.4 Webhook
`POST /api/games/digiflazz/webhook`: baca body mentah (batas byte), verifikasi
`X-Hub-Signature: sha1=<HMAC-SHA1(secret, raw)>` constant-time, dedupe di
`dana_webhook_events` (`provider='digiflazz'`, key `ref_id:status`), lalu transisi yang sama
dengan polling (idempoten, hanya dari `submitting|pending` milik attempt aktif).
Respons 200 setelah tercatat; signature salah 401. Webhook dashboard baru diaktifkan
setelah route ini terdeploy.

### 12.5 Sinkron katalog
Cron lite `games_catalog` (throttle ≥10 menit lewat `store_settings`): `price-list`
`cmd:prepaid`, filter kategori Games, upsert per kode utama; kode berakhiran `b` mengisi
kolom cadangan dari kode dasar. SKU yang hilang dari daftar → `seller_active=0`.
[Histori Digiflazz — untuk baris Sekalipay lihat §14: `sell_price` kini dihitung dari markup
OD1, bukan `games_reference_prices`.] `sell_price` dihitung ulang dari
`games_reference_prices` (cermin `reference_price` ikut ditulis). `enabled`,
`display_group`, dan `display_order` tidak pernah diubah oleh sinkron.

### 12.6 Status implementasi (9 November 2026)
- Selesai: G1 proxy (terpasang VPS), G2 klien, G3 schema (migrasi 0107), G4 sinkron +
  cron `games_catalog`, G5 dispatch + cadangan + cron `games_orders`, G6 webhook.
  Bagian A admin data: migrasi 0108, `src/lib/games/admin.ts`, tab admin Games
  (`/api/admin/games/products`; `.../enable-wave` DIHAPUS 13 Nov 2026) — §12.7.
  B1 API katalog/quote/order/status/lacak QRIS, registry empat game, preview gate P9,
  expiry item di job existing, dan paid routing tiga provider QRIS juga selesai lokal (§12.8).
  B2 menambah gateway/crypto, consent dan view/status/lookup kanonis tanpa UI atau env baru.
  S1 menambah routing host tanpa enable flag, metadata helper/sitemap/robots, migrasi0109,
  nickname berbiaya/cache/admission/log, ringkasan admin, dan larangan jual SKU utilitas.
  Kode `ffcekusername`/`mlcekusername`/`pubgcekusername` atau nama `/cek\s*username/i`
  selalu tersembunyi di katalog pembeli; quote/order baru dan enable admin409 `not_sellable`,
  tidak ada lagi aktivasi massal. Nickname dari klien display-only, disanitasi ke `customer_nickname`.
  Detail perilaku & penyimpangan kecil: ARCHITECTURE §16.25–§16.29.
- **Untuk Paseo/fase berikut:** integrasi metadata/QA UI rail gateway/crypto Games,
  UI §4–§7, verifikasi aktivasi domain/env setelah CI, lalu gerbang G8 yang masih terbuka.
  Domain/env sudah dipasang PM, bukan bukti runtime aktif atau izin webhook/Production.
- Tindak lanjut teknis: allowlist `rc` Gagal yang transien sebelum dianggap final;
  seed referensi A2 tersedia lokal di migrasi0111 (§12.7), belum bukti data produksi.
- Prompt serah terima Paseo: `docs/games-paseo-brief.md`.

#### Gerbang owner (status PM9November2026 sekitar21.40–22.05WIB)
- §7.1 brief: **ditutup owner tanpa rotasi key**, keputusan9November2026 malam.
  Jangan menulis bahwa key telah dirotasi atau merotasi sebagai efek samping.
- §7.2: **terbuka**, webhook dashboard Digiflazz tetap non-aktif.
- §7.3: **terbuka**, belum deposit atau mode Production. Pages produksi menyimpan
  Development Key + testing=true; sesudah deployment CI berikutnya cron katalog
  mulai memakai Development Key, ordering tetap preview P9 dan nickname unavailable.
- §7.4: **terbuka**, belum transaksi nyata yang membuktikan go-live.
- PM memasang75env (79/128 termasuk4sistem), empat env Digiflazz `secret_text`.
  CNAME/custom domain telah ditambahkan dengan status awal initializing; aktif
  belum diverifikasi. Tidak ada klaim live/sinkron selesai/pembayaran nyata.

### 12.7 Admin data Games (P1–P3, 9 November 2026, lokal → CI)

Kontrak keputusan PM untuk bagian A. Semua admin di balik Cloudflare Access + JWT
admin + idle (`requireAdmin`, audit `admin_authorized`); body PATCH dibatasi 8.000 byte
lewat `readJsonBody`.

- **[DIGANTIKAN §14 OD1 untuk baris SK]** Harga referensi Oura tidak lagi dipakai menghitung
  harga jual Games; tabel/seed di bawah tetap ada sebagai histori dan untuk baris Digiflazz lama.
- **P1 Harga referensi = tabel (histori).** `games_reference_prices(buyer_sku_code PK, price
  INTEGER NOT NULL CHECK(price>0), source TEXT NOT NULL, captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL)` (migrasi 0108) adalah sumber kebenaran harga Oura. Tabel
  boleh berisi kode yang belum ada di `games_products` (seed sebelum sinkron pertama).
  `syncGamesCatalog` membaca map referensi dari tabel ini (bukan dari
  `games_products.reference_price`) lalu menulis cermin `reference_price` +
  `sell_price` saat upsert. Menghapus baris referensi membuat sinkron berikutnya
  mengembalikan harga ke batas bawah modal.
- **Seed A2 Oura (lokal, 9 November 2026).** Migrasi `0111_games_reference_seed.sql`
  menambah198 referensi: FREE FIRE16, Free Fire Max8, MOBILE LEGENDS156, PUBG MOBILE18.
  Generator offline `node scripts/generate-games-reference-seed.mjs <reference.json> <skus.json>`
  membaca JSON riset R1 di luar repo (bukan kode/SQL executable), memilih `match==='exact'`,
  hanya kode utama (akhiran `b` adalah cadangan hanya bila kode dasarnya ada),
  bukan utilitas Cek Username, empat brand gelombang1, harga Oura integer positif
  dan rasio harga Oura/modal `[0.5,3.0]` inklusif.383 match =>198 diterima,185 dibuang:
 168 cadangan,16 bukan exact,1 rasio di luar batas (`ml3`). Setiap baris ditolak
  dihitung sekali sesuai urutan filter; katalog yang tidak ada di matches bukan kandidat.
  SQL terurut kode, `ON CONFLICT(buyer_sku_code) DO NOTHING` menjaga edit admin;
  source `ourastore.com riset 2026-11-09`, captured_at/updated_at `2026-11-09T08:28:15Z`.
  Seed tidak mengaktifkan SKU atau mengubah katalog/harga jual langsung: sinkron
  katalog berikutnya membaca referensi lalu menghitung ulang cermin `reference_price`
  dan `sell_price` via rumus existing. JSON mentah tidak dimasukkan repo; daftar
  penolakan ada pada evidence A2 di workspace orkestrasi. Belum deployment seed.
- **P2 Grup nominal (histori).** `display_group` kini menerima 8 kategori Oura
  (`special|bestseller|promo|first_topup|pass|pack|topup|other`) sebagai override section di
  §14; dua nilai lama tetap diterima. Definisi awal 9 November:
  `games_products.display_group TEXT NULL CHECK (display_group IS
  NULL OR display_group IN ('special','bestseller'))` + `display_order INTEGER NULL`.
  `effectiveGroup(row)`: `display_group` bila terisi; NULL → `special` bila
  `product_type='Membership'` atau nama cocok
  `/weekly diamond pass|\bwdp\b|twilight|membership/i`; selain itu `all`. Sinkron tidak
  pernah menyentuh kedua kolom ini.
- **P3 Sehat untuk aktivasi massal.** `seller_active=1 AND cost>0 AND sell_price ≥
  ceil(cost×1.03) AND (reference_price IS NULL OR sell_price ≤ reference_price)`
  (`isHealthyForWave`, dipertahankan untuk tes; endpoint aktivasi massal DIHAPUS 13 Nov 2026).
  Dulu `POST .../enable-wave` hanya memproses brand
  `GAMES_WAVE1_BRANDS` (FREE FIRE, Free Fire Max, MOBILE LEGENDS, PUBG MOBILE;
  pencocokan case-insensitive) dan **tidak pernah** menonaktifkan SKU. Sinkron tetap
  tidak pernah mengubah `enabled`.
- **API admin** (edge, `src/app/api/admin/games/products/`):
  - `GET /api/admin/games/products?brand&enabled&q&limit&offset` → `{items, total,
    limit, offset, brands, sync:{last_sync_at, counts:{total, enabled, seller_active,
    with_reference}}}`. Item membawa `margin` (`cost, sell, floor, margin_rp,
    margin_pct, source:'reference'|'floor', competitive`) dan `effectiveGroup`.
    `limit` maksimal 200; brand dicocokkan case-insensitive; `q` mencari kode/nama.
  - `PATCH /api/admin/games/products` body `{buyer_sku_code, enabled?, reference_price?,
    display_group?, display_order?}`. Validasi ketat (400 dengan pesan jelas, field
    asing ditolak), 404 `not_found` bila SKU tidak ada. `reference_price` → upsert/delete
    `games_reference_prices` (`source='admin'`, `captured_at=now`), hitung ulang
    `sell_price` via `computeGamesSellPrice({cost, referencePrice})`, cermin
    `reference_price`, semuanya dalam satu `db.d1.batch`. `enabled=true` ditolak 409
    `not_sellable` bila `seller_active=0` atau `cost≤0`; menonaktifkan tetap boleh.
  - `POST /api/admin/games/products/enable-wave` DIHAPUS 13 November 2026 (dulu
    `{dry_run?}` → `{eligible, enabled_now, skipped_unhealthy}`); jangan membuat
    aktivasi massal baru.
- **UI admin:** tab "Games" (`src/components/admin/GamesManager.tsx`) mengikuti pola tab
  Pedia/Produk (round 2, 13 November 2026): `PageHeader` + 4 StatCard netral
  (Sinkron terakhir ringkas, Total varian, **Bisa dijual** = `sync.counts.sellable`,
  Supplier aktif), satu toolbar (cari, game, filter "Bisa dijual", status jual), lalu
  tabel desktop / kartu mobile berisi kode+nama, game, stok, status jual manusiawi,
  harga jual, margin, grup, toggle aktif. Daftar default `?sort=sellable` sehingga SKU
  yang benar-benar bisa dijual tampil dulu. **UI harga Oura sudah dihapus** (kolom
  input, stat, hint) dan tombol "Aktifkan gelombang 1" tidak ada karena endpoint
  `enable-wave` dihapus; `PATCH` masih menerima `reference_price` null/int untuk
  kompatibilitas. Grup tampilan bisa diubah dari tabel maupun kartu mobile (PATCH
  `display_group`), dan guard aktivasi sama di kedua tampilan: `supplier_active`,
  modal > 0, dan kontrak didukung (server tetap otoritatif). Deskripsi supplier
  dibersihkan dari emoji. Copy Indonesia; loading/error/empty state, tanpa angka palsu.
- **Batas bukti:** implementasi + tes fixture lokal (`tests/games-admin.test.ts`,
  `tests/games-admin-migration.test.ts`, `tests/games-admin-summary.test.tsx`,
  `tests/admin-round2-ui3-corrections.behavior.test.tsx`); belum ada deployment,
  data produksi, atau pengisian tabel harga referensi. Kolom `reference_price` /
  `games_reference_prices` tetap ada di DB untuk kompatibilitas API.

### 12.8 API pembeli B1 + B2 — QRIS, gateway, crypto (9 November 2026, lokal; belum deploy)

- **Registry:** `src/lib/games/registry.ts` adalah sumber tunggal slug, brand, field
  ID/EN, regex dan `buildCustomerNo`: `free-fire`/`free-fire-max` memakai `playerId`,
  `mobile-legends` memakai `userId` + `zoneId` yang digabung TANPA pemisah,
  `pubg-mobile` memakai `playerId`. Validasi numerik memakai rentang konservatif
  FF/FF MAX 6–14, ML user 1–12 + zone 1–6, PUBG 6–15 digit. Riset R1 9 Nov
  mengamati FF 8–11, ML 6–10 + 4–5, PUBG 7–12, tetapi sumber belum membuktikan
  rentang itu sebagai batas universal. Rentang lebih longgar dipilih agar ID sah
  tidak ditolak; ini validasi format, bukan verifikasi kepemilikan/keberadaan akun.
- **P5–P7:** quantity selalu 1 (juga CHECK schema); harga terkunci = `sell_price`,
  `max_price=min(unit_price,ceil(cost_snapshot*1.05))`; order QRIS deadline 15 menit,
  invoice tidak melebihi deadline order/provider. Prefix owner **`AXG-YYYYMMDD-XXXXXXXX`**.
- **P9 preview gate:** `DIGIFLAZZ_TESTING==='true'` atau username/API key kosong
  (setelah trim) membuat `ordering_open=false`. Katalog tetap terbaca;
  POST quote/order mengembalikan 503 `{error_code:'games_preview',error}` dengan
  ID "Pemesanan AXVARA Games segera dibuka." / EN "AXVARA Games ordering is opening soon."
  Tidak memasang env atau membuka Production sebagai efek samping implementasi.

| Endpoint | Kontrak |
|---|---|
| `GET /api/games/catalog` | `{ordering_open,games:[{slug,name,publisher,currency,icon,banner,min_price,sku_count}]}`; hanya empat game registry dengan SKU enabled |
| `GET /api/games/catalog/[slug]` | `{game:{slug,name,publisher,currency,icon,banner,fields},ordering_open,products:[{buyer_sku_code,name,price,group,display_order,available}]}`; SKU seller OFF tetap tampil `available:false`; tanpa modal/margin/seller/kode cadangan |
| `POST /api/games/quote` | `{slug,buyer_sku_code,fields,nickname?,locale?}`; tanpa kontak; validasi registry + SKU live; balas `{ok,quote_token,quote_id,total,payable,currency:'IDR',locale,game,sku,paymentMethods}`. Katalog/metode beserta total+fee sama dengan Pedia (`buildMethodCatalog`), hanya yang available ditandatangani. JWE A256GCM TTL 30 menit mengikat SKU/harga/customer_no/locale/metode; nickname input pembeli, BUKAN hasil verifikasi |
| `POST /api/games/orders` | `{quote_token,payment_method,whatsapp,email}` (default QRIS bila metode tidak dikirim dan QRIS ada dalam token); kontak divalidasi/trim/normalisasi WA 62 saat admission. Ulang quote tersimpan → order/metode sama 200, baru → 201 `{code,status_url,status,total,qris,payment?,reused}`; QRIS null untuk gateway/crypto. `status_url=/games/pesanan/[code]`; gagal rail 503 `error_code:payment_method_unavailable` membawa kode/status_url, saved retry non-QRIS tidak POST ulang |
| `GET /api/games/orders/[code]` | Header `x-order-contact` (atau `x-order-access-code`) = WA/email checkout penuh; 200 `{ok,order}` dengan `games_status`, ID akun, nominal, SN sukses dan QRIS tersimpan; kontak respons dimask, cost/max_price/backup tidak dikirim. `?wake=1` memakai klaim durable untuk recovery KlikQRIS; tidak membuat order baru |
| `POST /api/games/lookup` | `{code,contact}` (body maksimal 8.000 byte); kontak penuh seperti Pedia, salah/tidak ada order → respons generik 404. Balas `{order}` dengan ringkasan aman yang sama; tidak menerbitkan grant kredensial Market |

Admission memakai `checkout-guard` bersama Market/Pedia (5/IP, 3/WA, 3/email per
15 menit, HMAC subjek, error D1 → 503; batas → 429). Namespace klaim quote
`games:<jti>`; reuse/parallel retry tidak mengonsumsi slot kedua. Harga/brand/
enabled/seller/modal dipagar ulang DI DALAM satu `d1.batch` atomik yang membuat
`orders(order_kind='games',items='[]')` + `games_order_items(awaiting_payment)`;
tidak ada reservasi stok Market. Harga/ketersediaan berubah → 409 `quote_stale`;
satu customer_no + SKU masih aktif → 409 `duplicate_active_order` (termasuk
`needs_check`, sampai admin menyelesaikannya). Quote cacat/kedaluwarsa → 409
`quote_expired`. Invoice memakai `createActiveQrisInvoice`, `createSekalipayGatewayInvoice`
atau `createNowpaymentsInvoice` existing seperti Pedia, mempertahankan provider/nominal
tersimpan saat retry. Metode hilang/tidak kanonis/tidak ada dalam token → 409 `quote_stale`.
Order baru gateway 30 menit, crypto 60, QRIS 15, dipendekkan ke deadline provider;
retry tidak memperpanjangnya. Token dibatasi 30.000 karakter untuk katalog penuh
28 koin + gateway (batas stream JSON tetap 32.000 byte). Payload token tidak memuat kontak.

B2 memakai `serializePediaQuoteMethods`/`resolvePediaMethodSelection`: tidak ada
daftar kanal atau rumus biaya Games. Kurasi DANA/ShopeePay dan `cryptoPricing(base,ticker)`
mengikuti payment rules terkini. Definitif gateway = rejeksi terbaca + GET absence
`absent` + mark rejected berhasil, atau gagal sebelum klaim; crypto mengikuti Pedia.
Definitif membatalkan order + item expired dengan restock kosong. Ambigu mempertahankan
klaim/duplicate-target guard dan tidak POST ulang; memilih metode lain memerlukan quote baru.
Status/lacak menyertakan `payment` dari `build*PaymentView`, dengan proof kontak penuh
sebelum baca view/poll. Consent memakai `POST /api/orders/[code]/payment-consent`
(`{contact,expected_final_total}`); fee/total harus sesuai dan URL baru muncul setelah consent.
GET status memakai klaim poll durable, recovery gateway known-id hanya GET; cron tetap recovery.

Status pembeli: `awaiting_payment` hanya saat order masih pending; item
`queued|submitting|pending` atau paid belum dipromosi → `processing`;
`success` hanya setelah item sukses (SN/keterangan hanya pada sukses);
`needs_check` → `needs_admin`; order batal/kadaluarsa atau item expired → `expired`.
Job cron lite `expiry` existing meng-expire order belum bayar lalu item (sweep
hanya untuk order terminal/unpaid, bounded 5 transisi + 20 item, tidak mengubah
paid); histori item expired tidak menyumbat sweep. Shared
`transitionPendingOrder` mengecualikan Pedia DAN Games dari restock, walau ID item
bertabrakan dengan `products`/`product_variants`. KlikQRIS callback/reconcile,
DANA dan GoPay paid memanggil `schedulePaidFulfillment(code,'games')`, tanpa
Market outbox/WR/SK; cron `games_orders` tetap pemulihan. B2 memperluas guard pembayaran
AXV|AXP|AXG (bukan `isValidOrderCode`/route Market). Gateway paid reconcile/callback
dan crypto IPN menjadwalkan Games sekali setelah transisi atomik menang; late/underpaid/
mismatch manual review tanpa dispatch, tanpa job fulfillment Market.

Batas bukti: tes fixture lokal (termasuk replay callback tiga QRIS dan ID stok
bertabrakan) + `games-checkout.workerd.test.ts` (handler asli quote/order/reuse/
status/expiry dengan D1 workerd, adapter HTTP Next diganti primitive native),
bukan deployment atau pembayaran produksi. B2 menambah `games-payment-rails.integration.test.ts`
(33 tes: katalog, quote/contact, create/retry/min expiry, kegagalan definitif/ambigu,
consent, status/recovery, callback/IPN replay, review tanpa dispatch, route Market tetap sempit)
dan regresi workerd gateway AXG. Fokus akhir 67 file/1016 tes hijau; UI/nickname dan akses
produksi tetap di luar B2, full suite/build milik PM.

## 13. Katalog & transaksi Sekalipay Games — P3 (12 November 2026, lokal, belum deploy)

> Status bagian ini: implementasi + tes fixture lokal pada worktree
> `feat/games-sekalipay-only`. Tidak ada deployment, panggilan supplier nyata,
> transaksi berbayar, atau perubahan env/secret. Gate pembelian produksi tetap
> **tidak diset**. Bagian §1–§12 adalah histori keputusan Digiflazz; untuk
> penjualan baru, bagian ini menggantikan sumber katalog/supplier.

- **Supplier baru penjualan Games = Sekalipay H2H.** Seluruh kategori `Game`
  diimpor (snapshot bukti 12 November 2026: 47 produk / 1.619 varian; angka itu
  hasil pengamatan bertanggal, bukan janji jumlah permanen). Digiflazz
  diparkir: tidak ada price-list/order baru, tidak ada fallback otomatis, dan
  baris/order lama tetap dapat dibaca/direkonsiliasi lewat jalur legacy.
- **Gerbang order baru:** `GAMES_SK_ENABLED=true` **dan** `SEKALIPAY_ENABLED`
  **dan** transport/kredensial SK tersedia **dan** bukan `SEKALIPAY_SANDBOX`.
  Kredensial Digiflazz tidak lagi membuka order baru. Sync katalog tetap berjalan
  dengan konfigurasi SK existing tanpa bergantung gate pembelian. Tidak ada env
  yang diubah oleh implementasi ini.
- **Katalog DB, bukan whitelist empat game.** Home, detail, pencarian navbar,
  sitemap, dan metadata membaca katalog D1 hasil sync. Slug stabil per produk
  supplier (`game_slug`); empat slug lama (`free-fire`, `free-fire-max`,
  `mobile-legends`, `pubg-mobile`) dipertahankan lewat override registry lokal.
  Semua varian/region/tipe tetap baris terpisah dengan identitas
  `sk:<variant_id>`; UI tidak menggabungkan nominal/region yang sama. Katalog
  publik dan sitemap **hanya** baris `supplier='sekalipay'`; baris Digiflazz
  legacy tidak pernah ditampilkan sebagai game/SKU yang bisa dibeli baru
  (hanya tetap tersedia untuk histori order/status/dispatch lama). Empat slug
  lama hanya override metadata bila SK dengan slug itu ada, bukan fallback
  katalog DGF.
- **Kontrak field per varian.** Hanya key `note`/`zone_id` yang didukung, selalu
  teks (ID bisa memuat huruf/`#`/Unicode/nama server), `note` maks 50 dan
  `zone_id` maks 20. Label/instruksi mengikuti varian terpilih; `note` dan
  `zone_id` dikirim terpisah (tidak pernah digabung). Varian off, stok 0,
  admin-disabled tetap tampil dengan alasan jujur tetapi tidak dapat dibeli;
  open-denom, min_order>1, atau kontrak tak didukung tidak pernah di-quote.
  Stok `-1` mengikuti makna platform SK: tak terbatas dan dapat dibeli; `0`,
  negatif lain, atau nilai rusak menjadi tidak tersedia.
- **Quote/order** mengikat supplier, varian, target snapshot, digest kontrak,
  modal, dan harga; recheck atomik memeriksa supplier/enabled/active/stok/
  min_order/slug/kontrak/harga. SKU Digiflazz dan token quote lama ditolak untuk
  order baru. Rail pembayaran, biaya kanal, consent, TTL, dan idempotensi order
  existing dipertahankan.
- **Dispatch SK:** ref stabil kompak `AXG…` (≤50). Payload + sent-fence ditulis
  sebelum POST; setelah fence tidak pernah ada POST kedua — timeout/5xx/ref
  sudah ada/404 melakukan GET ref yang sama. Preflight live menegakkan status
  on, stok cukup, min_order 1, kontrak sama dengan snapshot, harga live ≤ batas
  quote, dan saldo; pelanggaran transien ditunda, pelanggaran kontrak/harga
  menjadi `needs_check`. Sukses hanya dari GET authoritative: transaksi
  `completed`, tepat satu item cart qty1 dan satu hasil H2H bervarian cocok,
  dispatch `completed`, SN nyata, unit konsisten.
- **Batasan yang disengaja:** SK tidak menyediakan parameter `max_price`.
  Pemeriksaan biaya tertagih (`amount` valid atau `price+fees`, disimpan di
  `games_dispatch_attempts.price`) adalah **deteksi pasca-debit + review
  manual**, bukan pencegahan atau jaminan harga. Detail SK hanya mengekspos
  `note`; bila respons tidak memuat `note|zone`, korelasi zone memakai payload
  snapshot yang benar-benar dikirim (batas bukti yang terdokumentasi, bukan
  field rekaan). Tidak ada refund/rebuy otomatis; kegagalan/partial/mismatch →
  `needs_check`. Ikon/banner yang kosong dirender sebagai placeholder inisial
  atau aset merek; tidak pernah mengirim `src=""`. **[DIGANTIKAN §14 OD5]** Storefront tidak
  lagi merender gambar produk Sekalipay, sehingga entri `img-src
  https://sekalipay.com/images/products/` **dihapus** dari CSP publik 14 November 2026
  (aturan 12 November di bawah menjadi histori; header keamanan lain tidak berubah, CSP admin
  tetap).
- **Webhook** hanya memproses ref Games yang dikenal setelah signature valid;
  invoice tersimpan otoritas, GET by ref authoritative, hint invoice dari
  payload tidak pernah ditulis sebelum korelasi dan hint salah ditolak tanpa
  memindahkan order. Dedupe memakai `dana_webhook_events` provider
  `sekalipay_games`.
- **Nickname** publik baru hanya untuk varian SK dengan `validation.available`,
  memakai `validateSkAccount` gratis (tanpa utilitas Digiflazz berbayar), cache
  24 jam per varian+target, rate-limit perangkat, dan hasil `unavailable` tidak
  memblokir checkout. Hasil cek bukan jaminan kepemilikan ID.
- **Admin** hanya mengelola katalog SK (supplier/varian/stok/kontrak/deskripsi,
  harga Oura, grup, urutan, aktif). `PATCH` menolak baris Digiflazz legacy
  (`legacy_parked`); endpoint `.../enable-wave` DIHAPUS 13 November 2026 (tidak ada
  aktivasi massal). Baris legacy tetap disimpan untuk histori
  order.
- **Verifikasi final terintegrasi (12 November 2026, setelah fix stok -1 dispatch):**
  full suite serial parent `npx vitest run --run --maxWorkers=1` **438 file/5.923 tes
  lulus** (228,77 dtk), lalu `npm run build:pages` penuh **PASS 173 edge route**
  (Next compile/lint/typecheck + konversi; 19,02 dtk hanya durasi konversi, bukan
  total build). Pemulihan jujur: default-worker suite sempat timeout fixture workerd
  `telegram-bulk-checkout` (5 dtk), run 2-worker sempat gagal 2 fixture workerd
  `telegram-payment-rails`; keduanya lulus saat ditargetkan dan serial penuh lulus
  tanpa perubahan kode/assertion/timeout. Checkpoint 419/5.760 (pra-integrasi) dan
  438/5.920 (pra-fix stok) adalah histori. Wonder QA browser nyata lulus: publik
  Playwright 1280/390 (katalog>12, search, varian region/tipe, field per
  varian, disabled/unsupported, tanpa overflow/gambar rusak) dan admin statis
  pada artefak Next lokal 8792 dengan fixture jaringan browser (search/filter/
  empty, harga Oura valid-invalid, grup, toggle, unsupported, tanpa tombol
  wave, loading/503/Muat ulang). Batas: admin tidak diuji dengan auth/backend
  persist nyata; `display_order` masih API-only tanpa editor (header admin
  menyebut "urutan" — keterbatasan UI kecil yang jujur); tidak ada deployment,
  env/flag aktivasi, atau transaksi supplier nyata.

## 14. Implementasi terkini — markup, katalog SK, storefront, admin, aset (14 November 2026, lokal)

> Status: **implementasi + verifikasi lokal di worktree integrasi `games-sk-integration`**
> (`36056e42` + perubahan paket G-BE/G-STORE/G-ASSETS/G-ADMIN/G-STORE-2 yang diterima).
> Publikasi melalui CI setelah commit/push; deployment belum terverifikasi.
> Tidak ada perubahan gate pembelian `GAMES_SK_ENABLED`; status aktivasi produksi tidak
> diperiksa ulang dalam paket ini dan snapshot tugas lama bukan bukti status sekarang. Angka 48 game/1.644 varian adalah snapshot bertanggal.

### 14.1 Harga & markup (OD1)

- Rumus aritmetika bilangan bulat di `src/lib/games/pricing.ts`
  (`computeGamesMarkupPrice`): `bp = round(pct×100)`,
  `harga = ceil(cost×(10000+bp) / (10000×R))×R + fixed`.
  Default **markup 5 %**, **R = Rp100**, `fixed` default 0.
- Validasi: `cost` bilangan bulat > 0; `pct` 0–100 dengan maksimal 2 desimal; `fixed`
  bilangan bulat 0–1.000.000; `R` ∈ {1, 100, 500, 1000}; input lain melempar `RangeError`.
  Hasil selalu ≥ modal (lebih besar bila pct/fixed > 0).
- Precedence markup efektif: **varian → game → global**. Persen memakai nilai paling
  spesifik yang ada; `fixed` bersifat **aditif** di atas hasil pembulatan. Sumber:
  `games_variant_markup` → `games_meta.markup_percent` → `store_settings`
  (`games_markup_percent`, `games_price_rounding`).
- Pasangan acuan 5 %/R100 (dipakai tes): `11750→12400`, `321115→337200`,
  `1641500→1723600`, `4825225→5066500`, `1106018→1161400`.
- Harga referensi Oura **tidak lagi dibaca** untuk baris Sekalipay. Helper lama
  (`computeGamesSellPrice`/`gamesPriceFloor`) dipertahankan hanya untuk jalur Digiflazz legacy.
- `PATCH /api/admin/games/products` menolak `reference_price` (`400 invalid_body`); kolom dan
  `games_reference_prices` tetap disimpan sebagai histori.

### 14.2 Data & migrasi 0122

`drizzle/migrations/0122_games_markup_meta.sql` (+ cermin `drizzle/schema.sql`), aditif/idempoten:

- **Rebuild `games_products`**: `display_group` menerima 8 kategori
  (`special|bestseller|promo|first_topup|pass|pack|topup|other` atau NULL). SQLite/D1 tidak bisa
  melonggarkan CHECK di tempat, karena itu tabel dibangun ulang (kolom/CHECK/index lain sama,
  id AUTOINCREMENT lanjut, FK `games_order_items.product_id` tetap valid).
- **`games_meta`** (PK `slug`): `display_name`, `publisher`, `icon_url`, `banner_url`,
  `description`, `id_guide`, `featured_rank`, `hidden` (default 0), `markup_percent`,
  `updated_at`, `updated_by`.
- **`games_variant_markup`** (PK `buyer_sku_code`): `markup_percent`, `markup_fixed`,
  `updated_at`. Override varian **tidak** disimpan sebagai kolom `games_products` (spesifikasi
  awal) supaya re-run migrasi/sinkron tidak menghapus override; tabel ini tidak pernah ditulis
  oleh sync.
- `store_settings` diisi `INSERT OR IGNORE`: `games_markup_percent='5'`,
  `games_price_rounding='100'`.
- Hitung ulang sekali untuk baris Sekalipay memakai rumus SQL integer
  (`((cost*10500+999999)/1000000)*100`), ditandai `_games_0122_probe` agar re-run 0122 tidak
  menimpa harga admin. Baris Digiflazz, `reference_price`, dan `games_reference_prices` tidak disentuh.
- `recomputeGamesSkPrices(db, {all}|{slug}|{skus[]})`: satu `UPDATE` dengan subquery
  `games_meta`/`games_variant_markup`; daftar SKU lewat satu parameter `json_each` (batas 100
  parameter D1 aman). `cost=0` dan baris Digiflazz dilewati.

### 14.3 API admin (B5)

Semua `requireAdmin` (401 `unauthorized`), body via `readJsonBody`, zod `strict()` (key asing →
`400 invalid_body`), pesan Indonesia.

| Endpoint | Kontrak singkat |
|---|---|
| `GET /api/admin/games/pricing` | `{markup_percent, rounding}` efektif |
| `PUT /api/admin/games/pricing` | `{markup_percent?(0–100,≤2dp), rounding?(1/100/500/1000)}`, minimal satu; simpan setting lalu hitung ulang SEMUA baris SK; balas `{markup_percent, rounding, updated}` |
| `GET /api/admin/games/games` | per game SK (termasuk hidden): name/publisher/icon/banner/description/id_guide/featured_rank/hidden, `markup_percent` (override\|null) + `effective_markup_percent`, `variants_total`, `sellable_count`, `supplier_off_count`, `min_price` (hanya varian bisa dijual) |
| `PATCH /api/admin/games/games` | `{slug, display_name?, publisher?, icon_url?, banner_url?, description?(≤600), id_guide?(≤600), featured_rank?(1–99\|null), hidden?, markup_percent?(0–100\|null)}`; URL `https://` atau path `/r2/…` hasil `/api/upload`; slug tanpa baris SK → 404; markup berubah → hitung ulang game itu |
| `PATCH /api/admin/games/products` | tambah `markup_percent`/`markup_fixed`, `display_group` 8 nilai, `reference_price` dihapus |
| `POST /api/admin/games/products/bulk-markup` | `{skus:["sk:<id>"] (1–2000), markup_percent?, markup_fixed?, display_group?}` minimal satu. **Field yang tidak dikirim dipertahankan per SKU; `null` mereset field itu; `0` tetap 0; `null`+`null` menghapus override; kategori saja hanya mengubah kategori tanpa harga.** Satu UPSERT `json_each` + satu reprice (≤3 statement bisnis) |
| `GET /api/admin/games/products` | item + `markup_source:"global"\|"game"\|"variant"`, `effective_markup_percent`, `markup_fixed`, `region`; filter baru `?region=PH` (case-insensitive, kode asing → `400 invalid_region`); `sync.counts.supplier_off` |

### 14.4 Katalog publik (`src/lib/games/catalog.ts`)

- Presedensi field: **`games_meta` → aset/registry lokal → nilai SK**. Game `hidden=1` hilang
  dari list, sitemap, pencarian, dan detail 404. Katalog publik tetap **SK-only**; baris Digiflazz
  legacy tidak pernah dirender.
- Item list: `min_price` = harga terendah varian yang **bisa dijual** (null bila 0),
  `sku_count`, `sellable_count`, `featured_rank`. Urutan: bisa dijual dulu → `featured_rank`
  asc (null terakhir) → registry → nama.
- Item produk (detail): `type_label` (ejaan Indonesia: Filipina/Rusia/Turki/Singapura/Brasil;
  DIGITAL/kosong → null), `region_code` (ISO-2 atau `GLOBAL`), `category` (override
  `display_group`, selain itu aturan otomatis: first_topup → pass → pack → topup → other),
  `validation_available` (kontrak SK, predikat sama dengan route nickname), `availability_reason`
  jujur (`supplier_off`/`stock_empty`/`admin_disabled`/`no_price`/…).
- Label field dibersihkan (`"User ID :"`→`"User ID"`). **V2:** label generik
  (`Catatan`/`Note`/`Notes`/`Keterangan`/`Ket`/kosong) diganti **label mayoritas game untuk key
  yang sama**; label bermakna per varian (mis. `Player ID` vs `No Hp`) **dipertahankan**.
  Contoh nyata: ML 349×`User ID` vs 3×`Catatan` → semua `User ID`.
- Export UI: `GAMES_CATEGORY_SECTIONS` (urutan + label Indonesia), `GAMES_CATEGORY_ORDER`,
  `gamesCategoryLabel`, `cleanGamesFieldLabel`, `regionCodeFromNickname`.

### 14.5 Storefront (OD4, P1–P14) — `src/app/games/*`, `src/components/games/*`

- **Koreksi owner 14 Nov 2026 (mobile, lokal):** di <640 px bagian Populer = grid 2 kolom
  kartu ringkas (thumbnail 40 px, nama 12 px 2 baris, publisher 10 px; bila jumlah ganjil kartu
  terakhir disembunyikan di HP agar grid genap), katalog potret = 3 kolom (overlay nama 11 px +
  status 9–10 px, publisher hanya ≥sm), baris chip genre mendapat fade tepi kanan
  (mask 78 %→transparan) yang hilang saat di-scroll mentok kanan (`data-at-end`). Desktop tetap. Tipografi & jarak HP ikut ringkas: judul seksi 18 px (sm 24 px), subjudul/jumlah 12 px, ikon api 20 px, chip genre 32 px/12 px, jarak antarseksi 40 px (sm 80 px).
- **Koreksi owner 14 Nov 2026 (larut malam, lokal):** (1) kartu lintas layanan beranda Pedia =
  AXVARA Market + AXVARA Games (kartu Bot Telegram dihapus; Telegram tetap di footer); (2) overlay
  `CrossAppTransition` (logo tujuan + cincin putar + "Memuat AXVARA …") kini juga untuk tujuan/asal
  Games dan terpasang di layout Games; (3) "Cara top up" dihapus juga dari halaman detail game
  (komponen `HowToTopUp` + copy langkah dihapus); (4) "Game lainnya" = karusel horizontal
  `GamesRail` (hingga 16 game, yang bisa dibeli dulu; snap per kartu, panah ‹ › desktop redup di
  ujung, fade tepi, ±6 kartu desktop / ±2,5 kartu HP); (5) footer bersama punya baris "Metode
  pembayaran" di atas © (chip putih 28/32 px: QRIS · GoPay, DANA, OVO, ShopeePay, LinkAja · BCA, BNI,
  BRI, Mandiri, Permata · USDT, BTC, ETH; logo lokal yang sama dengan picker; dekoratif).
- **Koreksi owner 14 Nov 2026 malam — halaman detail (lokal):** banner full-bleed kiri–kanan
  tapi ramping (190/260/330 px, fade ke midnight), kartu ikon 3D lebih besar (112/176/212 px), miring
  `rotateZ(-4deg)` + tilt pointer, tepi kaca (ikon di-zoom 1.1 agar sudut putih App Store hilang),
  bayangan berlapis + kilau periodik; badge trust jadi pill kaca dengan spotlight bergiliran 2 s
  dalam siklus 6 s (instan → layanan → aman); setiap tahapan = kartu kaca iOS dengan header strip
  (nomor di squircle gradien cyan→biru, judul 17 px, garis pemisah); Data akun ramping (input 44 px,
  Cek ID satu baris dengan input bila hanya satu field, bantuan + "Ingat ID" satu baris);
  "Nominal sedang tidak tersedia" pindah ke kartu nominal; chip tipe bergaya chip beranda/Pedia;
  kartu nominal ramping ±74 px (nama 12–12.5 px, harga 13–14 px, badge INSTAN/Habis kanan atas,
  centang kanan bawah, kaca + highlight 1 px); badge INSTAN = pill kaca cyan ⚡ + kilau, hanya untuk
  varian yang bisa dibeli; ikon item dinormalisasi `GAMES_ITEM_ICON_SCALE` (sqrt(0.42/luas bbox),
  0.7–1.08) sehingga ikon satuan tidak lebih besar dari tumpukan; pembayaran memakai
  `PaymentMethodPicker` persis seperti Market/Pedia tanpa daftar harga mentah tambahan. Semua animasi
  mati pada reduced motion. Revisi lanjutan (malam, owner): badge trust hero kembali lepas tanpa pill/bulatan, hanya animasi
  ikon bergiliran yang dipertahankan; badge INSTAN dikembalikan ke desain asli (bolt + garis kecepatan SVG, "Pengiriman/INSTAN" |
  "Instant/DELIVERY", kilau saat terpilih) di strip bawah kartu nominal (22 px HP / 28 px desktop, border-top tipis; badge mungil ala Oura, ikon 11/14 px, teks 5.5–7.5 / 6.5–9 px; di HP label tipe disembunyikan); animasi badge: idle diam, hover kartu (pointer) = petir menyala sekali 0,6 s + garis kecepatan melesat, kartu terpilih = denyut halus tiap 2,5 s; teks tidak bergerak; mati pada reduced motion;
  stiker GPT Image dibatalkan atas permintaan owner; hover kartu nominal = outline
  cyan tipis + ikon item miring -10° & scale 1.1 (300 ms, pointer hover saja); memilih nominal lewat
  klik/tap men-scroll halus ke "Metode pembayaran" (block start, kontak ikut terlihat), navigasi
  keyboard tidak men-scroll.
- **Koreksi owner 14 Nov 2026 malam (lokal; menggantikan bagian terkait di bawah):** (1) orbit
  hero = 8 game tetap `GAMES_ORBIT` (`mobile-legends`, `pubg-mobile`, `free-fire`, `genshin-impact`,
  `honor-of-kings`, `valorant`, `roblox`, `call-of-duty-mobile`; Free Fire MAX dikecualikan),
  ring 0/1/1/1/2/2/3/3 dan sudut awal per ring `GAMES_ORBIT_PHASE` 200/20/50/110 (prop opsional
  `ringPhase` PediaOrbit; default Pedia tidak berubah), slug yang tak ada diisi game katalog
  berikutnya; (2) ikon populer = Microsoft Fluent Emoji 3D "Fire" (MIT,
  `public/brand/games/ui/fire-3d.webp` 96 px) dengan kedip halus `ax-flame` + glow oranye
  berdenyut 2,6 s; (3) thumbnail populer art di-zoom 1.14 (hover 1.2) agar penuh tanpa sudut putih;
  (4) kilau diagonal kiri→kanan hanya saat hover (`ax-card-sheen-hover`, 0,9 s, intensitas putih/cyan ≤20 %;
  kilau otomatis bergelombang dihapus 15 Nov 2026 — keputusan owner: orbit satu-satunya gerak terus-menerus); (5) hover GameCard: ring
  cyan 1,5 px /70 + inset 4 px, scale 1.02, glow lembut, art zoom 1.08 500 ms ease-out; (6) subjudul
  katalog dihapus; (7) chip genre gaya katalog Pedia: aktif putih solid teks midnight, nonaktif
  `ax-glass-card` border white/10, tinggi 36 px, ikon lucide per genre; (8) beranda tanpa Cara top
  up, kartu kepercayaan dan FAQ (detail game tetap memakai HowToTopUp). Semua animasi
  transform/opacity saja dan mati total pada `prefers-reduced-motion`.
- Koreksi 14 Nov 2026 (sore): hero kembali ke §4.1 — `PediaOrbit` animasi (art game di
  planet via `renderIcon`) + headline statis "Satu tempat untuk / top up game favorit." (typewriter dihapus 15 Nov 2026 (keputusan owner: bersaing dengan orbit)) + CTA pill putih "Top Up Game"
  dan pill kaca "Bantuan WhatsApp".
  `GamesOrbit` statis dan copy "Top up game favoritmu" dari 648c9cb5 dibatalkan.
- **14 Nov 2026 koreksi owner (lokal, belum bukti deployment):** beranda mempertahankan hero
  orbit 4 game pertama API, CrossServicePromo, cara top up, trust dan FAQ; aturan berikut
  menggantikan populer minimum 4/maksimum 8, katalog 12 + "Tampilkan lainnya" dan kartu redup.
  - Populer: `src/lib/games/popular.ts`, `featured_rank` admin terurut naik maks 9 bila ada;
    kalau tidak ada gunakan `mobile-legends`, `magic-chess-go-go`, `pubg-mobile`, `free-fire`,
    `genshin-impact`, `honor-of-kings`, `valorant`, `roblox`, `honkai-star-rail` dalam urutan itu,
    hanya slug yang ada di katalog. Tidak mensyaratkan sellable; sembunyi hanya jika 0 hasil.
    Heading ikon Flame gold + subjudul existing; grid horizontal 1/2/3 kolom (base/sm/lg),
    thumbnail 64/72 px + nama/publisher. Koreksi G2b14Nov: tint ikon blur opacity75 %/saturasi150 %
    agar tiap game jelas berwarna, garis diagonal putih4 %, gradient midnight hanya area teks.
    Publisher memakai metadata admin/registry sungguhan, bukan label fixture. Tidak memakai
    warna/aset Oura. Hover/fokus lift2px + border cyan/glow + zoom1.05.
  - Katalog: heading/count hasil filter → subjudul → chip genre → grid. Mapping slug statis
    `src/lib/games/genres.ts`, urutan chip §4; label ID/EN. Genre kosong tidak ditampilkan,
    slug baru hanya di Semua. Tombol `aria-pressed` 44 px, aktif cyan, scroll satu baris mobile
    tanpa overflow halaman, wrap mulai sm. Count live berubah; populer tidak ikut disaring.
    Seluruh hasil filter dirender langsung, grid 2/3/4/6 kolom (base/sm/md/lg).
  - **GameCard G2b — 14 Nov 2026 koreksi owner:** shared (termasuk Game lainnya di detail),
    rasio2:3/radius16px; `GamesCatalogItem.portrait` dari `gamesLocalAsset(slug).portrait` (aset
    lokal600×900), full-bleed object-cover. Saat diam di pointer-fine/hover-capable hanya gambar,
    tanpa border/frame/teks. Hover/focus-visible: ring cyan3px + gap inset3px, glow/scale1.045,
    gradient bawah midnight dan nama2baris + publisher white/70 + status slide/fade masuk300ms
    ease-out. Touch/no-hover selalu menampilkan overlay nama lebih kecil. Accessible name
    tautan selalu nama + harga/status. Portrait null memakai fill ikon blur + ikon square utuh
    (tanpa crop logo tepi); header detail **tetap menggunakan ikon square**, bukan portrait.
    Harga "Mulai Rp…" hanya varian bisa dijual (tanpa harga karangan), selainnya pill "Segera
    tersedia"; tanpa `opacity-70`. Reduced-motion tanpa scale/slide/transisi, overlay/ring tetap
    muncul. GameImage lazy + async + no-referrer dan fallback monogram dipertahankan.
- Halaman game (revisi 14 Nov 2026, `src/components/games/detail/*`): banner hero `aspect-[16/9]`
  mobile / `aspect-[21/9]` ≥sm, maks 440 px, `object-[center_30%]` (art tampil utuh, bukan strip
  6:1); ikon square sebagai **kartu 3D melayang** 96/152 px (miring, float 6 s, sheen, tilt ikut
  pointer halus; reduced-motion = miring statis) + baris trust animasi SVG duotone "Proses
  instan" · "Layanan 24/7" · "Pembayaran aman". *Snapshot lama: header ≤216 px di 390 (banner
  ≤120 px, tile 72 px) + chip "Pengiriman instan", "24 jam", "Pembayaran aman".* Urutan langkah **1 Data akun → 2 Pilih nominal → 3 Metode
  pembayaran → 4 Kontak**.
  - Langkah 1 langsung terisi karena **varian tersedia termurah berkategori `topup` di chip
    default** dipilih otomatis (chip default `Indonesia` bila ada); bila tidak ada, varian
    tersedia pertama di section pertama; bila game tidak punya varian tersedia, field varian
    pertama tampil **disabled** + catatan "Nominal sedang tidak tersedia".
  - Chip: satu baris TIPE/REGION + count (Indonesia · lainnya by count · "Lainnya" · Semua
    terakhir), hanya bila ≥2 grup. Section kategori Oura-style dengan label dari §14.4; **semua kartu
    langsung tampil** (batas 12 + "Tampilkan semua (N)" dihapus 14 Nov 2026); search lintas section.
  - Kartu nominal: nama 12–13 px medium (clamp 2 baris, `title` nama penuh), **ikon item per game**
    (`src/lib/games/item-icons.ts` → `public/brand/games/items/*.webp`: set mata uang 3 tier per
    peringkat harga dalam section + pass/member/gift/pack/promo/special; fallback ikon lucide bila
    gambar gagal) + harga 14–15 px semibold, footer **badge bergambar "Pengiriman / INSTAN"**
    (teks aksesibel tetap "Pengiriman instan") pada kartu tersedia; tidak tersedia menampilkan "Habis"/"Tidak
    tersedia" dengan harga tetap terlihat dan `aria-disabled`.
  - Rail desktop sticky 360 px (varian terpilih + Tipe/Proses/deskripsi clamp + ID/nickname +
    Harga/Biaya/Total) dan bar bawah mobile satu baris ±66 px. "Selengkapnya" hanya muncul
    ketika deskripsi benar-benar terpotong (`ResizeObserver`).
  - Hint region hanya **saran**: nickname dengan `(XX)` berbeda dari `region_code` varian
    menampilkan callout gold + tombol pindah chip; **tidak** memblokir checkout. `GLOBAL`
    tidak pernah konflik.
- Frame P14: tile radius 16 px, border 1 px white/10, kaca midnight + glow cyan saat hover.
  Banner tak tersedia = ikon lokal diperbesar 125 % + **blur 48 px** + gradient midnight + grid
  halus; ikon hilang/gagal = monogram. Tidak ada aset supplier/kompetitor di layar.

### 14.6 Aset gambar (OD5)

- Sumber tunggal `scripts/games-assets.manifest.json` (48 slug SK) + generator
  `node scripts/games-assets.mjs`; provenance `docs/games-assets.md`; peta runtime
  `src/lib/games/assets.ts`.
- Hasil (revisi banner 14 Nov 2026): **48 ikon** 512×512 q82 + **48 banner tepat 1600×900**
  (cover-resize + region fokus per slug, tanpa letterbox, ≤200.000 byte, gagal keras bila lebih;
  test `tests/games-assets.test.ts` memastikan 48 file berdimensi persis) + **48 portrait**
  600×900 q80 (≤120 KB) = **10.023.192 byte** di `public/brand/games/`. Banner: 20 resmi
  dipertahankan, 2 resmi di-recrop (`laplace-m`, `marvel-rivals`), 26 edit/outpaint Codex
  `image_gen` atas art resmi (teks promo/musiman dibuang, karakter + logo resmi dipertahankan,
  Free Fire vs MAX dibedakan); master `scripts/games-assets-src/banners/`, provenance per slug di
  manifest. Safe zone: subjek tengah-kanan, kiri bawah ±35%×40% untuk ikon 3D + judul hero detail.
  *Snapshot sebelumnya: 23 banner ≤250 KB + `banner_skip` 25 game = 7.726.332 byte.* Kelima slug
  yang dulu di-skip (`valorant`, `point-blank`, `marvel-rivals`, `laplace-m`, `au2-mobile`) kini
  memakai sumber resmi; tanpa `portrait_skip`/`banner_skip`.
  Portrait = 30 crop aset resmi + 18 outpaint GPT Image atas input resmi
  (`scripts/games-assets-src/portraits/`, master lokal).
- Sumber artwork resmi publisher (App Store ID, Google Play, Steam, situs resmi publisher);
  *(histori: 8 banner berat UI/gameplay sempat ditolak via `banner_skip`, kini diganti banner
  1600×900 di atas).* Tanpa unggah R2/migrasi:
  berkas statis `public/` diterima sebagai keputusan PM.
- Presedensi render: unggahan admin `games_meta` → aset lokal resmi → fallback AXVARA.
  Gambar produk Sekalipay tidak dirender dan entri CSP-nya dihapus.

### 14.7 Admin Games (A1–A7)

- Section Games: `PageHeader` + 4 StatCard (Sinkron terakhir · Bisa dijual n/total · Supplier
  nonaktif · Markup default) + alert agregat bila supplier-off >50 %, tab URL **Game | Varian |
  Harga** (popstate), tautan "Lihat pesanan Games".
- **Game**: tabel desktop/kartu mobile (ikon, nama+publisher, bisa dijual, mulai, markup
  Default/Khusus, populer, tampil, Edit). Sheet editor: nama, publisher, ikon/banner
  (`ImageDropzone` → `/api/upload`), deskripsi ≤600, panduan ID ≤600, urutan 1–99, markup
  khusus + preview, satu tombol Simpan, draft guard.
- **Varian**: kolom Modal · Markup (efektif + badge sumber + "+Rp" tetap) · Harga jual · Margin ·
  **Kategori** (Select "Otomatis (label)" + 8 kategori, label penuh, scroll internal tabel) ·
  Popover "Atur markup"/reset · bulk `BulkMarkupToolbar` (preset 3/5/8/10 %, persen + reset Rp tetap ke 0,
  "Set kategori"). Bulk aman: field tak dikirim dipertahankan, reset hanya eksplisit.
  Supplier-off memakai badge sekunder (bukan "Perlu diperiksa" per baris).
- **Harga**: markup default %, pembulatan Rp1/100/500/1.000, tiga contoh hidup, hitung ulang di
  balik konfirmasi jumlah varian, toast "{n} harga diperbarui".

### 14.8 Yang TIDAK berubah

Gate order SK, quote/order admission, kunci harga `quote_stale`/`duplicate_active_order`,
dispatch SK (sent-fence, tanpa POST kedua, tanpa fallback supplier), webhook, nickname,
kebijakan expiry, dan semua header keamanan lain. **Tidak ada env/secret baru** dan tidak ada
perubahan skema di luar migrasi 0122.

### 14.9 Verifikasi & batas bukti

- Full suite terintegrasi (parent, sumber final): `NODE_ENV=test npx vitest run --run`
  **448 file / 6.154 tes lulus, exit 0, 61,93 dtk**, setelah menggabungkan perbaikan QRIS
  `b1b72f13` tanpa mengubah sumber Games.
- Fokus koreksi: G-ADMIN **9 file/140 tes**, G-ASSETS **4 file/146 tes**, G-STORE-2
  **4 file/42 tes**. `tsc --noEmit`, `npm run lint`, dan `NODE_ENV=production npm run build:pages`
  lulus ulang pada sumber gabungan final (log G-PM-merged-*). Sumber UI/aset tidak berubah
  setelah QA G-STORE-2; hanya dokumentasi yang diselaraskan setelah verifikasi akhir.
- Browser: Chromium 1280/390 (home, ML, nominal, Habis, pass names, region hint, Roblox, AU2,
  keyboard, reduced motion, loading/error) + admin terang/gelap 1280/390 — semua dengan fixture
  lokal, tanpa order/pembayaran/produksi. Angka lama (443/6.057 backend, 437/5.941 storefront,
  447/6.100 assets, 6.105/3 admin) adalah checkpoint histori, bukan hasil final.
