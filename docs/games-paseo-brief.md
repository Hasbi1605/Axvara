# Brief Paseo Orkestrator — Menuntaskan AXVARA Games

> Prompt siap tempel untuk agent orkestrator Paseo (9 November 2026). Salin seluruh isi
> di bawah garis ke agent orkestrator.

---

Kamu adalah **orkestrator** untuk menuntaskan **AXVARA Games** (top up game) di repo
`/Users/macbookair/axvara`, dari kondisi backend-sudah-ada sampai siap go-live. Pakai tim
Paseo sesuai skill `paseo-orchestrator` (konfigurasi 9 November 2026). Tugas dianggap selesai hanya bila semua butir "Selesai bila" di bawah terpenuhi dengan
bukti, atau tertahan di gerbang owner (§7) dengan laporan jelas.

## 0. Pembagian peran untuk tugas ini
| Bagian | Pemilik |
|---|---|
| Rencana, kriteria terima, review diff, verdict visual, commit/push | **PM — Claude Opus 5.5** (tidak menulis kode) |
| §3.A data/admin, §3.B API pesanan/status/expire, test, i18n, kartu Games di CommunityBar, dokumentasi | **DeepSeek V4.1 Flash** |
| §3.B integrasi rail pembayaran + pemicu dispatch gateway, cek nickname berbayar, routing subdomain `games.axvara.tech` | **GPT-6.1 Sol** (tugas berat) |
| §3.C halaman `/games`, halaman game, status, lacak/bantuan/ketentuan, orbit+carousel, kartu nominal | **GPT-6.1 Terra** (UI) |
| Riset aset resmi game, audit/peta sebelum menulis, QA browser desktop/mobile + screenshot | **Gemini Flash** |
| Review independen alur pembayaran/order sebelum go-live | **Muse Wonder** (opsional) |
| Cadangan bila Sol/Terra gagal | **Muse Spark 1.3** |

## 1. Wajib dibaca dulu (urut)
1. `AGENTS.md` (aturan repo: test, dokumentasi, changelog, commit/push ke `main`, jangan
   memantau CI, kredensial).
2. `docs/GAMES.md` **seluruhnya** — spesifikasi produk/desain (§1–§9 keputusan owner sudah
   final), rencana fase (§11), kontrak backend (§12, §12.6 status).
3. `docs/agent-rules/digiflazz.md`, `docs/agent-rules/payments.md`, `docs/agent-rules/pedia.md`,
   `docs/agent-rules/admin-security.md`, `docs/agent-rules/platform-ops.md`.
4. `docs/DESIGN.md` (bagian AXVARA Games + token/komponen Market/Pedia),
   `docs/ARCHITECTURE.md` §16.25–§16.26, `docs/PRD.md` bagian AXVARA Games.

## 2. Yang SUDAH ada (jangan ditulis ulang)
- Proxy VPS `/dgf/*` (live), klien `src/lib/games/digiflazz.ts`, rumus harga
  `src/lib/games/pricing.ts`, sinkron `src/lib/games/catalog-sync.ts` (cron `games_catalog`),
  schema `games_products` / `games_order_items` / `games_dispatch_attempts` (migrasi 0107),
  dispatch + seller cadangan `src/lib/games/dispatch.ts` (cron `games_orders`, hook
  `schedulePaidFulfillment` kind `games`), webhook `POST /api/games/digiflazz/webhook`.
- Akun Digiflazz: 612 produk Games unik, kode buyer final (`ml86`, `mlid97`, `ff140`,
  `pubg60`, …), 396 baris seller cadangan `…b` untuk gelombang 1.

## 3. Lingkup kerja (urutan disarankan)

### A. Data & admin
- Seed `reference_price` (harga Oura) gelombang 1 (FF, FF MAX, ML, PUBG) dari snapshot di
  `docs/PRD.md`/hasil riset; tandai sumber + tanggal. Sediakan halaman admin Games (pola admin
  Pedia, di balik Cloudflare Access) untuk: daftar SKU, `enabled`, edit `reference_price`,
  pengelompokan "Terlaris"/"Spesial", lihat harga modal/jual/margin, status sinkron.
- Aktifkan (`enabled=1`) hanya SKU gelombang 1 yang punya seller aktif dan margin sehat.

### B. API pembeli
- Quote + order mengikuti pola `src/app/api/pedia/orders/route.ts` (rate limit scope baru,
  `checkout-guard`, quote token, satu `db.batch` atomik: `orders` dengan `order_kind='games'`
  + `games_order_items` status `awaiting_payment`, harga terkunci dari `sell_price`).
- `max_price` = `min(unit_price, ceil(cost_snapshot × 1,05))` — tidak pernah membayar modal
  di atas harga jual. Catat di `docs/GAMES.md`.
- Rail pembayaran existing: QRIS, Virtual Account + e-wallet (gateway Sekalipay), crypto
  (NOWPayments). **Penting:** callback gateway Sekalipay saat ini tidak memanggil
  `schedulePaidFulfillment` (Pedia mengandalkan cron) — pastikan pesanan Games ter-dispatch
  lewat cron `games_orders` atau tambahkan pemicu, dengan test.
- Kedaluwarsa pesanan belum bayar → item `expired` (ikuti pola expire Pedia).
- Endpoint cek nickname: memakai SKU "Cek Username" Digiflazz (transaksi berbayar kecil,
  butuh saldo) dengan rate limit per IP/perangkat + cache per game+ID; bila gagal/belum ada
  saldo, jangan blok pembeli (tampilkan peringatan). Catat biaya per cek di admin.
- Halaman status/lacak membaca `games_order_items` + attempt (SN, pesan, status jujur;
  tidak "sukses" sebelum Digiflazz Sukses).

### C. UI/UX (sesuai `docs/GAMES.md` §4–§7 dan §9)
- Route `/games`, `/games/[slug]`, `/games/pesanan/[code]`, `/games/lacak`,
  `/games/bantuan`, `/games/ketentuan`; URL kanonis **`games.axvara.tech`** mengikuti pola
  subdomain Pedia (middleware/rewrite, canonical, sitemap, robots, OG).
- Beranda: hero **hybrid** — orbit AXVARA dengan ikon game sebagai planet yang bisa diklik
  + carousel promo tipis di bawahnya hanya bila ada banner aktif (kontrak banner existing).
  Populer, grid game ber-ikon, cara top up, kepercayaan (tanpa rating fiktif), FAQ. Tanpa
  popup saat masuk.
- Halaman game: header banner + ikon, langkah bernomor (Data akun + cek nickname → Nominal
  → Jumlah → Pembayaran → Kontak), nominal dikelompokkan (Spesial, Terlaris, Semua dilipat)
  + chip rentang + cari angka, kartu radio glass (cyan terpilih, gold badge), rail ringkasan
  sticky desktop, bar bawah satu baris ±64px mobile, total per metode termasuk biaya.
- Rasa AXVARA (midnight/cyan/gold/glass/Space Grotesk), Lucide, ID/EN mengikuti preferensi
  bahasa & mata uang yang sudah ada.
- **Tombol Games di Market:** di `src/components/storefront/CommunityBar.tsx`, ganti kartu
  **Telegram Bot** (di samping `CrossServicePromo` Pedia, tepat di bawah hero Market) dengan
  kartu **AXVARA Games** (ikon, judul, deskripsi singkat, panah, tautan ke `games.axvara.tech`)
  dengan dimensi/gaya identik kartu Pedia. Bot Telegram tetap ada di footer. Perbarui teks
  i18n (`catalogCopy`) ID/EN dan test terkait.
- Tambah Games ke `ServicesMenu`, `CrossServicePromo`, footer bersama, `AXVARA_SERVICES`.
- Aset: ikon & banner game dari sumber resmi publisher/toko aplikasi/press kit → WebP → R2;
  **jangan** memakai aset buatan toko top up lain (termasuk Oura). Ikon mata uang (diamond,
  UC, VP, CP) dan panduan "cara cari ID" dibuat sendiri.

### D. Env & konfigurasi
- Pasang env Pages `secret_text` dari `/Users/macbookair/axvara/.digiflazz-credentials`
  (format JSON — jangan `source`): `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` (**Development
  Key dulu**), `DIGIFLAZZ_WEBHOOK_SECRET`, `DIGIFLAZZ_TESTING=true`. Jangan pernah mencetak
  nilainya. Periksa batas jumlah env Pages (`scripts/ci-pages-env-check.cjs`). Catat di
  ARCHITECTURE §16 + README.

## 4. Verifikasi wajib
- Test unit/integrasi untuk quote/order/expire/nickname/status/admin; workerd untuk route
  edge yang memakai D1; seluruh suite `npx vitest run --run` hijau sebelum tiap push.
- Uji end-to-end mode Development (`DIGIFLAZZ_TESTING=true`): order → bayar (fixture/rail
  test, bukan uang nyata) → dispatch → status. Tidak ada transaksi produksi.
- Browser nyata desktop + mobile (375px): beranda, halaman game, pilih nominal, validasi
  ID, cek nickname, metode, sticky bar, keyboard/fokus, reduced motion, overflow, state
  loading/error/kosong; tombol Games di Market. Flash mengambil screenshot; PM (Opus) memberi verdict visual akhir.
- Lighthouse/performa mobile orbit mengikuti aturan hemat (compositor-only).

## 5. Aturan kerja
- Satu PR/commit logis per bagian; `CHANGELOG.md` + PRD/DESIGN/ARCHITECTURE/README/AGENTS
  sesuai tabel Aturan Dokumentasi; commit lalu `git push origin main`; jangan memantau CI.
- Worktree bisa berisi pekerjaan paralel — stage hanya file milik tugas ini.
- Jangan mengubah seller/kode di akun Digiflazz tanpa mencatat di `docs/agent-rules/digiflazz.md`.
- Jangan deposit, ganti mode Production, aktifkan webhook dashboard, atau transaksi nyata
  tanpa izin owner (§7).

## 6. Selesai bila
- Semua route Games + admin + API live lewat CI dengan bukti deploy; tombol Games
  menggantikan kartu Telegram di bawah hero Market; dokumentasi lengkap; test hijau;
  verifikasi browser tercatat (screenshot Flash + verdict visual PM); mode Development end-to-end terbukti.

## 7. Gerbang owner (berhenti dan minta owner melakukan/menyetujui)
1. **DITUTUP OWNER tanpa rotasi** (keputusan9November2026 malam): owner memilih tidak
   merotasi Development/Production Key. Bukan bukti key dirotasi; jangan merotasi otomatis.
2. **TERBUKA, dashboard tetap non-aktif.** Aktifkan webhook di dashboard Digiflazz (URL `https://<host>/api/games/digiflazz/webhook`,
   secret = `DIGIFLAZZ_WEBHOOK_SECRET`) — butuh OTP owner; periksa ping lolos verifikasi.
3. **TERBUKA, belum deposit/Production.** Deposit kecil + ganti `DIGIFLAZZ_API_KEY` ke Production Key + `DIGIFLAZZ_TESTING` dihapus
   + mode Production di dashboard (OTP owner).
4. **TERBUKA, belum transaksi nyata.** Satu transaksi nyata kecil yang disetujui owner sebagai bukti go-live.

Snapshot PM9November2026 sekitar21.40–22.05WIB: empat env Digiflazz dipasang Pages
produksi sebagai `secret_text`, key Development/testing=true; berlaku deployment CI
berikutnya (ordering preview P9/nickname unavailable). CNAME `games` ke `axvara.pages.dev`
proxied dan custom domain ditambahkan (awal initializing, aktif belum diverifikasi).
Detail env/domain/jumlah ada di GAMES §12.6 dan ARCHITECTURE §16.25/§16.29; bukan izin go-live.
