# Rencana Implementasi — Order AXVARA Pedia & AXVARA Games via Bot Telegram Native (`@Axvara_bot`)

> **Status:** Rencana desain & arsitektur (draft untuk persetujuan owner — belum ada perubahan kode/DB/deploy).
> **Tanggal:** 2026-11-25
> **Basis kode:** `main` @ `491c2919`
> **Target kanal:** Bot Telegram native existing (`@Axvara_bot`, `src/lib/telegram/*`), **tanpa Telegram Mini App**.

---

## 1. Tujuan & Keputusan Kunci

Memungkinkan pembeli melakukan pemesanan **AXVARA Pedia** (layanan sosial media — IndoSMM) dan **AXVARA Games** (top up game instan — Sekalipay H2H) **100% di dalam chat `@Axvara_bot`**, menyatu dengan AXVARA Market yang sudah berjalan.

### Keputusan Arsitektur yang Dikunci
1. **1 Bot Terpadu (`@Axvara_bot`):** Tidak membuat bot terpisah agar user base, `/orders`, preferensi bahasa/mata uang (`ID/IDR`, `EN/USD`), broadcast, dan webhook tetap satu.
2. **100% Bot Native (Tanpa Mini App):** Nol WebView, nol auth `initData`, nol perubahan CSP/`X-Frame-Options: DENY`, nol UI React baru, respons instan di HP jaringan lemot.
3. **Susunan `/start` Sesuai Arahan Owner:** Mempertahankan layout `/start` saat ini secara utuh, **hanya menambahkan 1 baris berisi 2 tombol (`Sosmed` & `Games`) tepat di bawah tombol hijau `🛍 Lihat Semua Katalog`**.
4. **Rail Pembayaran Konsisten Kebijakan Bot (7 Nov 2026):** **QRIS + Crypto (NOWPayments)** saja (`includeGateway: false`). Pembeli Telegram **tidak diminta mengisi WA maupun Email** (0 form kontak → checkout tercepat).
5. **Nol Env/Secret Baru & Nol Migrasi D1 Wajib untuk MVP:**
   - Memakai env/gate yang sudah live: `TELEGRAM_BOT_ENABLED`, `GAMES_SK_ENABLED` (`gamesOrderingOpen()`), `PEDIA_ENABLED` + `PEDIA_ORDERS_ENABLED`, QRIS aktif (`gopay`/`klikqris`), dan `NOWPAYMENTS_ENABLED`.
   - Fitur *"Pakai ID Game terakhir"* dibaca langsung dari riwayat order Games milik `telegram_user_id` sendiri (`orders ⨝ games_order_items`) tanpa tabel baru.
6. **White-Label & Keamanan Ketat:** Tidak pernah membocorkan nama supplier (`IndoSMM`, `ProviderSMM`, `Sekalipay`, `Digiflazz`) ke teks pembeli; seluruh callback order/refill/checkout tunduk pada `ownerBound` + verifikasi private chat (`chatId > 0 && chatId === from.id`); cancel/failure Pedia & Games **tidak pernah** merestock stok Market.

---

## 2. Kondisi Katalog Produksi & Implikasi UX Native

Pengamatan baca-saja katalog produksi (24–25 Nov 2026) menjadi dasar seluruh keputusan UX di bawah:

| Lini | Skala Live | Titik Kritis UX di Chat Native | Solusi UX di Rencana Ini |
|---|---|---|---|
| **Market (Existing)** | ~79 produk, 5–6 kategori, 1–5 varian/produk | Sudah matang & cepat | **Tidak diubah** (tetap 100% flow existing) |
| **Games** | **48 game** sellable, **1.600+ SKU** (ML **348 SKU** across 10 region — Indonesia saja **118 SKU**; FF **259 SKU** — Diamond saja **134 SKU**; PUBG **90 SKU**; Genshin **44 SKU**) | Jika 118 SKU dibuat list 1 kolom → 15+ halaman pagination; risiko salah pilih region (Brasil/Rusia); repot ketik ID + Zone berulang | 1) Default langsung **Region Indonesia / Utama**, region lain di tombol `🌏 Region Lain`<br>2) Shortcut **`🎫 Pass & Membership`** di atas<br>3) Grid **2 kolom** (10–12 nominal/halaman)<br>4) Filter **rentang harga** (`<20rb`, `20–100rb`, `100–500rb`, `>500rb`) + **ketik angka/nama nominal langsung** (mis. `85`, `wdp`)<br>5) Input 1 pesan `ID Zone` + **1-klik ID terakhir** + **Cek Nickname live gratis** |
| **Pedia** | **33 platform**, **109 produk**, **275 tier** (**79%** produk hanya 1–3 tier; hanya **10 produk** ≥7 tier, mis. Followers IG 20 tier; **12 tier** `input_kind='comments'`) | Label tombol Telegram sempit (±38–42 char) sehingga rincian wilayah/refill/drop/speed terpotong; repot cari platform satu per satu | 1) **Paste link sosmed langsung di chat** → auto-detect `detectPediaLink()` → langsung tawarkan layanan cocok!<br>2) Daftar **tier bernomor di isi pesan** (rinci & bersih) + tombol pilih angka `1..6` + filter 1-klik (`🇮🇩 Indo`, `🌍 Global`, `🛡 Refill`)<br>3) Custom Comments langsung kirim 1 pesan multi-baris (1 baris = 1 komentar) |

---

## 3. Desain UI & UX Lengkap

### 3.1 Layar `/start` (Home Screen) — Persis Arahan Owner

Mempertahankan banner `tg-welcome.jpg`, caption sapaan (disesuaikan ringan agar menyebut aplikasi premium, top up game, dan layanan sosmed), serta seluruh posisi tombol existing — **hanya menambah 1 baris 2 tombol tepat di bawah `🛍 Lihat Semua Katalog`**.

> **Catatan lebar tombol HP (dari screenshot live):** Di layar HP 2 kolom, `🎬 Streaming & Hiburan` (22 char) terpotong menjadi `🎬 Strea...Hiburan`, sedangkan `⚡ AI & Chatbot` (14 char) & `🎨 Desain & Video` (17 char) muat utuh. Maka 2 tombol baru wajib **≤ 15 karakter** agar tidak pernah terpotong elipsis.

```text
[Banner: tg-welcome.jpg]
Halo, [Nama] 👋
Selamat datang di AXVARA — aplikasi premium, layanan sosmed, dan top up game otomatis 24 jam.

Pilih menu di bawah, ketik nama produk/game, atau tempel link sosmed langsung di sini.

┌────────────────────────┬────────────────────────┐
│ ⚡ AI & Chatbot        │ 🎬 Streaming & Hiburan │  ← primary (biru) — TETAP
├────────────────────────┼────────────────────────┤
│ 💼 Produktivitas & Off │ 🎨 Desain & Video      │  ← primary (biru) — TETAP
├────────────────────────┴────────────────────────┤
│ 🛠️ Developer & Tools                            │  ← primary (biru) — TETAP
├─────────────────────────────────────────────────┤
│ 🛍 Lihat Semua Katalog                          │  ← success (hijau) — TETAP
├────────────────────────┬────────────────────────┤
│ 📈 Sosmed Pedia        │ 🎮 Top Up Games        │  ← BARU (tepat di bawah Lihat Semua Katalog)
├────────────────────────┼────────────────────────┤
│ 📦 Pesanan Saya        │ 💬 Bantuan             │  ← primary (biru) — TETAP
├────────────────────────┼────────────────────────┤
│ 🇮🇩 Bahasa              │ 🌐 Web                 │  ← primary (biru) — TETAP
└────────────────────────┴────────────────────────┘
```

- **Label ID (≤15 char, anti-elipsis):** `📈 Sosmed Pedia` (15 char) | `🎮 Top Up Games` (15 char) *(atau `📈 Sosmed` | `🎮 Games` bila owner ingin super ringkas)*.
- **Label EN (≤15 char):** `📈 Social Media` (15 char) | `🎮 Top Up Games` (15 char).
- **Style warna (`button-style.ts`):** `style: "success"` (hijau, menyatu dengan blok CTA belanja `🛍 Lihat Semua Katalog`) atau `style: "primary"` (biru, jika ingin hanya `Lihat Semua Katalog` yang hijau — dikonfirmasi owner sebelum coding).
- **Gate visibilitas:**
  - Tombol `📈 Sosmed Pedia` tampil bila `PEDIA_ENABLED === "true"` (bila `PEDIA_ORDERS_ENABLED !== "true"`, klik tetap membuka info jujur "Pedia segera dibuka").
  - Tombol `🎮 Top Up Games` selalu tampil (bila `!gamesOrderingOpen()`, katalog tetap bisa dilihat namun saat checkout tampil pesan `gamesPreviewMessage(locale)`).

### 3.2 Reply Menu Bawah & Slash Commands

- **Reply Keyboard (`mainReplyMenu`)** — 2×3 ringkas (tetap `is_persistent: false` sesuai keputusan owner 20 Nov 2026):
  - **ID:**
    - Baris 1: `🛍 Katalog` | `📈 Sosmed` | `🎮 Games`
    - Baris 2: `📦 Pesanan` | `💬 Bantuan` | `🇮🇩 Bahasa`
  - **EN:**
    - Baris 1: `🛍 Catalog` | `📈 Social` | `🎮 Games`
    - Baris 2: `📦 Orders` | `💬 Help` | `🇬🇧 Language`
  - Placeholder input: `"Cari produk/game atau tempel link sosmed…"` / `"Search product/game or paste a social link…"`.
- **Bot Commands (`setMyCommands` di `src/lib/telegram/api.ts`):**
  - `/start` — `🏠 Menu utama`
  - `/katalog` — `🛍 Katalog produk premium`
  - `/games` — `🎮 Top up game instan`
  - `/pedia` — `📈 Layanan sosial media`
  - `/orders` — `📦 Pesanan saya`
  - `/bantuan` — `💬 Bantuan`
  - `/bahasa` — `🌐 Bahasa / Language`
- **Webhook group guard (`src/app/api/telegram/webhook/route.ts`):** tambahkan `/games` dan `/pedia` ke `purchaseIntents` agar pemanggilan dari grup publik otomatis diarahkan ke DM pribadi.

---

### 3.3 Alur Native **AXVARA Games** (4 Langkah Cepat)

#### Langkah 1 — Beranda & Pilih Game (`gmh`)
- Single-screen edit (`replaceWithPhoto` / `replaceWithText`).
- Tampilkan **9 Game Populer** dari `selectPopularGames()` (`src/lib/games/popular.ts`) dalam **grid 2 kolom** (maks 5 baris, nama singkat rapi):
  ```text
  🎮 AXVARA Games · 48 game siap top up
  Proses otomatis 24 jam · Cek nickname gratis.

  Pilih game populer di bawah atau ketik nama game (mis. ml, ff, valo):

  [ Mobile Legends ]   [ Magic Chess Go Go ]
  [ PUBG Mobile ]      [ Free Fire ]
  [ Genshin Impact ]   [ Honor of Kings ]
  [ Valorant ]         [ Roblox ]
  [ Honkai: Star Rail ]
  [ 📂 Semua Game (48) ] [ 🔎 Cari Game ]
  [ 🏷 Genre ]          [ 🏠 Menu ]
  ```
- **`📂 Semua Game (48)` (`gma:<page>`):** grid 2 kolom, **10 game/halaman** (5 halaman, hanya game dengan `sellable_count > 0` dulu).
- **`🏷 Genre` (`gmg:<genre>:<page>`):** memakai `GAMES_GENRES` & `GAMES_GENRE_BY_SLUG` (`MOBA`, `Shooter`, `RPG`, `Olahraga`, `Strategi`, `Kasual`).
- **`🔎 Cari Game` (`gmq`)** atau **ketik bebas di chat**: mencocokkan nama game + alias umum (`ml`/`mlbb` → Mobile Legends, `ff` → Free Fire, `ffmax` → Free Fire MAX, `pubg`/`pubgm` → PUBG Mobile, `hok` → Honor of Kings, `valo` → Valorant, `gi`/`genshin` → Genshin Impact, `hsr` → Honkai: Star Rail, `mcgg` → Magic Chess Go Go, `codm` → Call of Duty Mobile, `aov` → Arena of Valor, `zzz` → Zenless Zone Zero).

#### Langkah 2 — Pilih Nominal (`gmo:<slug>` → `gmt:...`)
Menggunakan `getGamesDetail(slug, locale)` (hanya SKU `available === true` yang dapat dibeli; jika semua SKU habis tampil info jujur).
- **Pengelompokan otomatis berdasarkan jumlah SKU tersedia:**
  - **Game ringkas (≤ 12 SKU, mis. Roblox, Blood Strike, AOV):** langsung tampilkan **grid 2 kolom** dalam 1 halaman tanpa menu rentang tambahan.
  - **Game besar (> 12 SKU, mis. ML 348 SKU, FF 259 SKU, PUBG 90 SKU, Genshin 44 SKU):**
    1. **Default Region/Tipe otomatis:** pilih `Indonesia` jika ada; jika tidak ada, pilih tipe dengan SKU terbanyak (mis. `Diamond` untuk FF, `UC` untuk PUBG, `Points` untuk Valorant).
    2. **Pintasan `🎫 Pass & Membership`** di baris teratas bila game memiliki SKU kategori `pass`/`first_topup` (sehingga *Weekly Diamond Pass*, *Twilight Pass*, *Membership FF*, *Welkin Moon* langsung ketemu dalam **1 klik**!).
    3. **Filter Rentang Harga 1-klik** (baris 4 tombol mini):
       `Semua` · `<20rb` · `20–100rb` · `>100rb` *(dinamis: hanya tampil jika SKU pada tipe aktif > 10)*.
    4. **Grid Nominal 2 Kolom (10 SKU/halaman):** label ringkas seperti `85 DM · Rp25.600` (format penuh dot-thousands, mengikuti `tgDisplayPrice` bila EN/USD) agar 1 halaman menampilkan 10 pilihan sekaligus!
    5. **Tombol aksi cepat bawah:**
       - `[ 🔢 Cari Nominal ]` → pembeli tinggal ketik `85`, `257`, `wdp`, `starlight` → langsung muncul 1–6 SKU yang cocok!
       - `[ 🌏 Region Lain (9) ]` → muncul hanya jika game punya ≥2 `type_label`, agar region luar negeri (Malaysia/Singapura/Filipina/Global/Brasil/Turki/Rusia) tetap bisa diakses tanpa mengganggu pembeli Indonesia.
- **Tampilan foto game:** memakai `game.banner` / `game.icon` lokal (`https://axvara.tech/brand/games/...`) via `replaceWithPhoto` + cache `file_id` existing (`sendCachedPhoto`), fallback mulus ke teks bila gagal.

#### Langkah 3 — Input Data Akun + Auto-Fill ID Terakhir + Cek Nickname Gratis (`gmv:<productId>`)
Mengikuti kontrak per-varian Sekalipay (`parseGamesSkContract(required_fields_json)` — hanya key `note` dan opsional `zone_id`):
1. **Cek riwayat ID terakhir** milik `telegram_user_id` untuk `game_slug` yang sama (query 1 baris dari `orders ⨝ games_order_items ⨝ games_products` yang statusnya bukan invalid).
   - Jika ada **DAN** bentuk targetnya lolos `validateGamesSkTarget(contract, savedTarget)`: tampilkan layar shortcut 1-klik sebelum memaksa mengetik:
     ```text
     🎮 Mobile Legends · 85 Diamonds (Indonesia)
     Harga: Rp25.600

     Pakai data akun terakhir atau kirim ID baru:
     • ID: 12345678 (1234) · PlayerPro

     [ 👤 Pakai 12345678 (1234) ]
     [ ✏️ Masukkan ID Baru ]
     [ ◀️ Ganti Nominal ]  [ 🏠 Menu ]
     ```
2. **Input ID Akun Baru (`pending_action = gm_acct:...`):**
   - **Varian 1 field (`note` saja, mis. FF / PUBG / Roblox):**
     > Kirim **Player ID** kamu (contoh: `1234567890`).
     > *(Sertakan `id_guide` singkat dari `games_meta` bila terisi.)*
     > Ketik `/batal` untuk membatalkan.
   - **Varian 2 field (`note` + `zone_id`, mis. Mobile Legends / Genshin Impact):**
     > Kirim **User ID** dan **Zone ID** dipisah spasi atau tanda kurung.
     > Contoh: `12345678 1234` atau `12345678(1234)`.
     > *(Jika hanya mengirim User ID dulu, bot akan menanyakan Zone ID di langkah berikutnya.)*
   - **Parser pintar 2-field:**
     - Mendukung `12345678 1234`, `12345678(1234)`, `12345678 (1234)`, `12345678|1234`, `12345678/1234`, `12345678-1234` (khusus bila hanya 2 token; tetap memvalidasi hasil akhir lewat `validateGamesSkTarget(contract, { note, zone_id })` agar ID karakter dengan spasi/simbol seperti Riot ID `Name#TAG` tetap utuh!).
     - Jika user hanya mengirim 1 nilai pada varian ber-`zone_id`, bot simpan `note` di draft dan minta `zone_id` saja di pesan berikutnya.
3. **Cek Nickname Otomatis (`checkSkGamesNickname` — GRATIS via Sekalipay):**
   - Jika `contract.validation_available === true`: bot kirim `sendChatAction(chatId, "typing")` lalu panggil `checkSkGamesNickname(db, { variantId, contract, target, display, device: "tg:" + from.id })`.
   - **Hasil `ok`:** tampilkan `Nickname : PlayerPro ✓`.
     - **Hint Region Konflik (paritas Web):** gunakan `splitNicknameRegion(nickname)` (`src/lib/games/variant-kind.ts`). Bila region akun (mis. `MY`) berbeda dari `region_code` varian terpilih (mis. `ID`, dan bukan `GLOBAL`), tampilkan callout peringatan `⚠️ Akun terdeteksi region Malaysia, sedangkan nominal ini untuk Indonesia.` + tombol **`🔄 Pindah ke Region Malaysia`** (saran saja, tidak memblokir bila pembeli tetap ingin lanjut).
   - **Hasil `unavailable`:** tampilkan catatan jujur *"Nickname belum bisa dicek saat ini — pastikan ID sudah benar."* (tidak memblokir checkout, sesuai `docs/GAMES.md` §13).

#### Langkah 4 — Layar Konfirmasi & Pilih Pembayaran (Reuse `payq1`!)
```text
🧾 Konfirmasi Top Up Game
━━━━━━━━━━━━━━━━
Game     : Mobile Legends
Nominal  : 85 Diamonds (Indonesia)
ID Akun  : 12345678 (1234)
Nickname : PlayerPro ✓
Total    : Rp25.600
━━━━━━━━━━━━━━━━
⚡ Pengiriman instan otomatis setelah lunas.
Pastikan ID & nominal benar — top up yang sudah diproses tidak dapat dibatalkan.

[ 📱 Bayar QRIS · Rp25.600 ]
[ 🪙 Crypto · 1,62 USDT ]          ← hanya muncul bila memenuhi min koin NOWPayments
[ ✏️ Ganti ID ]   [ ◀️ Ganti Nominal ]
[ ✖️ Batalkan ]
```
- **1-Klik QRIS:** Menekan `📱 Bayar QRIS` langsung menerbitkan order `AXG-...` + foto QRIS GoPay/KlikQRIS di chat (identik dengan Market!).
- **Crypto:** Menekan `🪙 Crypto` membuka submenu koin/jaringan `cryptoCoinKeyboard` existing (`pmc:`/`pm:`/`pgo:`).

---

### 3.4 Alur Native **AXVARA Pedia** (2 Jalur Masuk + Daftar Tier Bernomor)

#### Jalur Masuk A — Paste Link Sosmed Langsung di Chat *(Killer UX)*
- Di `handleCommand` (`src/lib/telegram/handlers/command.ts`), **sebelum** fallback free-text search, jalankan `detectPediaLink(trimmed)` (murni regex/URL parser lokal, **nol HTTP fetch keluar**, <1 ms).
- Jika terdeteksi platform & `targetKind` (mis. user paste `https://www.instagram.com/reel/ABCDE/` atau `https://vt.tiktok.com/ZSYxxx/`):
  - Muat katalog publik Pedia (edge-cached 300 dtk), saring produk yang `platform === detected.platform` dan `pediaTargetMatches(product.target_kind, detected.targetKind, ...)`.
  - Simpan `target_raw` & `target_normalized` di draft `pd_link_ctx` milik user (TTL 15 menit) lalu balas **1 bubble cerdas**:
    ```text
    🔗 Link Reels Instagram terdeteksi!
    Target: https://www.instagram.com/reel/ABCDE/

    Pilih layanan untuk link ini:
    [ ❤️ Likes Instagram · mulai Rp1.100 ]
    [ 👁 Tayangan Reels Instagram · mulai Rp1.100 ]
    [ 🔖 Saves Instagram · mulai Rp1.100 ]
    [ ↗️ Share Instagram · mulai Rp1.100 ]
    [ 💬 Komentar Instagram · mulai Rp1.500 ]
    [ 🛍 Cari di Katalog Apps ]  [ 🏠 Menu ]
    ```
  - Ketika pembeli klik salah satu layanan, **langkah input link langsung dilewati** (atau tinggal dikonfirmasi)!

#### Jalur Masuk B — Menu `📈 Sosmed Pedia` (`pdh`)
- **Beranda Pedia (`pdh`):**
  ```text
  📈 AXVARA Pedia · 33 platform · 109 layanan
  Proses otomatis 24 jam · Tanpa password akun.

  💡 Tips: Kamu juga bisa langsung tempel link IG/TikTok/YouTube di chat ini!

  Pilih platform populer:
  [ 📸 Instagram ]   [ 🎵 TikTok ]
  [ ▶️ YouTube ]     [ 📘 Facebook ]
  [ 🧵 Threads ]     [ 𝕏 X / Twitter ]
  [ ✈️ Telegram ]    [ 🛒 Shopee ]
  [ 📂 Semua Platform (33) ] [ 🔎 Cari Layanan ]
  [ 🏠 Menu ]
  ```
- **`📂 Semua Platform (33)` (`pda:<page>`):** grid 2 kolom, 10 platform/halaman (4 halaman).
- **Pilih Produk/Metrik (`pdp:<platform>:<page>`):** daftar 1 kolom (mis. Instagram punya 11 produk → 2 halaman × 6 produk), masing-masing menampilkan nama produk + harga mulai (`Followers Instagram · mulai Rp1.200`).

#### Langkah 2 — Pilih Kualitas / Tier (`pdt:<prodId>:<filter>:<page>`)
- **Desain Anti-Terpotong (Nomor di Body + Tombol Angka):**
  - Karena 1 tier Pedia punya banyak atribut penting (`public_name`, `region`, `refill_days`, `drop_label`, `speed_per_day`, `min–max`, `price_per_1k` atau `price_ref`), detail lengkap ditulis rapi dalam daftar bernomor di body pesan (maks **5–6 tier/halaman**), dan tombol inline di bawahnya memakai tombol angka/ringkas yang lega di jempol:
    ```text
    📈 Followers Instagram (Indonesia · 7 layanan)
    Filter: 🇮🇩 Indonesia

    1. Followers Indonesia Real
       Rp48.000/1.000 · No Refill · Min 100
    2. Followers Indonesia Real Look
       Rp70.000/1.000 · 🛡 Refill 30 Days · Min 100
    3. Followers Indonesia HQ
       Rp75.500/1.000 · No Refill · Min 100
    4. Followers Indonesia Real (35d)
       Rp71.500/1.000 · 🛡 Refill 35 Days · Min 100
    5. Followers Indonesia HQ (30d)
       Rp114.500/1.000 · 🛡 Refill 30 Days · Min 50

    Pilih nomor layanan:
    [ 1 ]  [ 2 ]  [ 3 ]  [ 4 ]  [ 5 ]
    [ ◀️ ] [ 1/2 ] [ ▶️ ]
    [ Semua ] [ 🇮🇩 Indo ✓ ] [ 🌍 Global ] [ 🛡 Refill ]
    [ ◀️ Instagram ]  [ 🏠 Menu ]
    ```
  - **Aturan adaptif:**
    - Untuk **79% produk** yang hanya punya **1–3 tier**: baris filter `Semua/Indo/Global/Refill` dan pagination **disembunyikan** agar layar super bersih!
    - Istilah SMM tetap mengikuti aturan `docs/agent-rules/pedia.md` (`No Drop`, `Less Drop`, `High Drop`, `Refill N Days`, `No Refill` tidak diterjemahkan). Semua string melewati `whiteLabel()`.

#### Langkah 3 — Target Link + Jumlah (atau Custom Comments) (`pds:<prodId>:<tierId>`)
1. **Input Target Link (jika belum ada dari paste-link chat):**
   - Bot tampilkan contoh format nyata dari `pediaTargetExample(product.platform, product.target_kind)` (mis. `https://www.instagram.com/username/` atau `@username`), lalu tunggu reply teks (`pending_action = pd_target:...`).
   - Validasi dengan `detectPediaLink(input, product.platform)` + `pediaTargetMatches(...)`:
     - Jika format salah → pesan ramah + contoh link + tetap di state input.
     - Jika link valid tapi **salah jenis target** (mis. pembeli pilih Followers [profil] tapi paste link Reels [post]) → beri pesan jelas seperti API web (`target_mismatch`) + opsi tombol pindah ke produk yang cocok!
2. **Input Jumlah:**
   - **Cabang A — Layanan Reguler (`input_kind !== 'comments'`):**
     - Hitung batas live dari `pediaBounds(live, tier, product.step)` dan harga per paket `quick_quantities` (maks 4–6 chip paling representatif, mis. `100`, `250`, `500`, `1.000`, `2.500`, `5.000`).
     - Tampilkan dalam **grid 2 kolom** (`100 · Rp2.700` | `500 · Rp13.300`) + tombol `[ ✍️ Ketik Jumlah Lain ]` (pembeli juga bisa langsung mengetik angka tanpa klik tombol, selama masih di state `pd_qty:`!).
     - Validasi live `min <= qty <= max`, `qty % step === 0`, dan harga live via `computePediaPrice` + `pediaMinOrderRp()`.
   - **Cabang B — Custom Comments (`input_kind === 'comments'`, 12 tier):**
     - Bot meminta pembeli mengirim **1 pesan berisi daftar komentar (1 baris = 1 komentar)** dengan batas `min_qty` sampai `min(max_qty, CUSTOM_COMMENT_MAX_LINES=200)`.
     - Validasi langsung via `checkCustomComments(rawText, null, locale)` (`src/lib/pedia/custom-comments.ts`): jumlah baris otomatis menjadi `quantity` (tunduk pada `min`, `max`, `step`, maks 300 char/baris, maks 8.000 char total).

#### Langkah 4 — Baca Syarat & Checklist + Pilih Pembayaran (Reuse `payq1`!)
```text
🧾 Konfirmasi Pesanan Pedia
━━━━━━━━━━━━━━━━
Layanan  : Followers Instagram
Kualitas : Followers Global HQ · Akun berpostingan
Target   : https://www.instagram.com/username/
Jumlah   : 1.000
Garansi  : 🛡 Refill 365 Days (sejak pesanan dibuat)
Estimasi : 0–4 jam
Total    : Rp26.500
━━━━━━━━━━━━━━━━
⚠️ Syarat wajib sebelum bayar:
• Pastikan akun TIDAK dikunci (Publik) selama proses.
• Jangan ganti username sebelum pesanan selesai.
• Dengan membayar, kamu setuju ketentuan layanan.

[ 📱 Setuju & Bayar QRIS · Rp26.500 ]
[ 🪙 Crypto · 1,68 USDT ]          ← hanya muncul bila memenuhi min koin
[ ✏️ Ubah Jumlah ] [ ✏️ Ganti Link ]
[ ✖️ Batalkan ]
```

---

### 3.5 Unified `/orders`, Detail Pesanan, Cancel, & Refill di Chat

1. **Tab `/orders` (`📦 Pesanan Saya` — tetap 3 tab `Aktif | Selesai | Gagal`, 5/halaman):**
   - Setiap baris memakai ikon jenis agar langsung terbaca:
     - `🛍` Market (`AXV-…`)
     - `🎮` Games (`AXG-…`)
     - `📈` Pedia (`AXP-…`)
   - **Pemetaan status tab yang akurat (memperbaiki bug latent di `ORDER_TAB_SQL`):**
     - **Aktif (`a`):**
       - `apps`: `o.status='pending'` ATAU (`o.status='lunas'` & `o.fulfillment_status!='delivered'`)
       - `games`: `o.status='pending'` ATAU (`o.status='lunas'` & `gi.status IN ('awaiting_payment','queued','submitting','pending','needs_check')`)
       - `pedia`: `o.status='pending'` ATAU (`o.status='lunas'` & `pi.status IN ('awaiting_payment','queued','submitting','submitted','in_progress','needs_check','partial','canceled')`)
     - **Selesai (`s`):**
       - `apps`: `lunas + paid + fulfillment_status='delivered'`
       - `games`: `lunas + paid + gi.status='success'`
       - `pedia`: `lunas + paid + pi.status='completed'`
     - **Gagal (`g`):**
       - Order `kadaluarsa`/`dibatalkan` atau `payment_status IN ('expired','failed','refunded')` (termasuk unpaid expired Games/Pedia).
2. **Detail Pesanan Games (`order:AXG-…` / `refresh:AXG-…`):**
   - Menampilkan Kode, Game + Nominal, ID Akun (+ Nickname), Status Pembayaran, Status Top Up (dari `gamesBuyerStatus`), Total, Waktu WIB, dan **SN dalam `<code>...</code>`** hanya jika `status === 'success'`.
   - Tombol:
     - Saat pending: `[ 🔄 Cek Pembayaran ]` | `[ ❌ Batalkan ]` | `[ ◀️ Daftar Pesanan ]`
     - Saat lunas/proses: `[ 🔄 Cek Status ]` | `[ 💬 WhatsApp Admin ]` | `[ ◀️ Daftar Pesanan ]`
     - Saat sukses: `[ 🔁 Top Up Lagi ]` (`gmo:<slug>`) | `[ 💬 WhatsApp Admin ]` | `[ ◀️ Daftar Pesanan ]`
     - **TIDAK pernah** menampilkan tombol `📦 Ambil Ulang Produk` atau `🛡 Klaim Garansi` milik Market.
3. **Detail Pesanan Pedia (`order:AXP-…` / `refresh:AXP-…`):**
   - Menampilkan Kode, Layanan + Kualitas, Target, Jumlah Dipesan, Jumlah Awal (`start_count`), Masuk/Sisa (`done/qty`, unknown tetap "Belum dilaporkan" bukan `0`), Status Pedia, Status Refill (`pediaRefillState`).
   - Tombol:
     - Saat pending: `[ 🔄 Cek Pembayaran ]` | `[ ❌ Batalkan ]`
     - Saat proses: `[ 🔄 Cek Progres ]` | `[ 💬 WhatsApp Admin ]`
     - Saat selesai/partial & `refill.eligible === true`: **`[ ♻️ Ajukan Refill ]`** (`pdrf:AXP-…`) + `[ 🔁 Pesan Lagi ]` (`pds:<prodId>:<tierId>`).
     - Saat selesai tanpa refill / masa refill habis: `[ 🔁 Pesan Lagi ]` + `[ 💬 WhatsApp Admin ]`.
4. **Aksi `♻️ Ajukan Refill` (`pdrf:<code>`) di Chat:**
   - Guard: `ownerBound` + private chat + ownership `orders.telegram_user_id`.
   - Memanggil helper bersama yang diekstrak dari `src/app/api/pedia/orders/[code]/refill/route.ts` (CAS atomik cooldown 24 jam, cabang `mode === 'api'` panggil `callPediaProxy(..., 'refill', ...)`, cabang `mode === 'manual'` set `manual_requested` + `notifyPediaNeedsCheck` ke admin).
   - Balasan langsung di chat: konfirmasi refill diajukan (atau alasan jujur dari `refillReasonText`).

---

## 4. Arsitektur Teknis & Perubahan File

### 4.1 Modul Baru (Ramping & Terisolasi)
Agar `callback.ts`, `command.ts`, dan `keyboards.ts` tidak membengkak, logika Games & Pedia dipisah ke modul sendiri:

| File Baru | Tanggung Jawab |
|---|---|
| `src/lib/telegram/handlers/games.ts` | Navigasi katalog Games (populer, semua, genre, search), filter tipe/pass/rentang, prompt input ID + parser 1-pesan, lookup ID terakhir, cek nickname + region hint, review → `showPaymentMethodOffer` |
| `src/lib/telegram/handlers/pedia.ts` | Paste-link auto-detect, navigasi platform/produk/tier bernomor + filter Indo/Global/Refill, input target, pilih/ketik qty, input custom comments, review → `showPaymentMethodOffer`, handler `pdrf:` refill |
| `src/lib/telegram/games-checkout.ts` | Pembuatan order Games atomik (`orders` + `games_order_items`, `AXG-`), preflight harga/kontrak/stok/`duplicate_active_order`, penerbitan QRIS & Crypto, rollback/cancel non-restock |
| `src/lib/telegram/pedia-checkout.ts` | Pembuatan order Pedia atomik (`orders` + `pedia_order_items`, `AXP-`), preflight harga/margin guard/bounds/`duplicate_active_order`, penerbitan QRIS & Crypto, rollback/cancel non-restock |
| `src/lib/telegram/messages/games.ts` | Seluruh copy ID/EN & formatter pesan Games (katalog, konfirmasi, status, notif paid/success+SN/needs_check) |
| `src/lib/telegram/messages/pedia.ts` | Seluruh copy ID/EN & formatter pesan Pedia (katalog, daftar tier bernomor, status progres, notif paid/completed/partial/canceled, hasil refill) |
| `src/lib/telegram/order-summary.ts` | Helper bersama `telegramOrderItemSummary()` lintas `apps`/`games`/`pedia` (dipakai invoice, retry, reminder, expiry, `/orders`) |
| `src/lib/pedia/refill-action.ts` | Ekstraksi logika inti pengajuan refill (CAS 24 jam + API/manual) agar dipakai bersama oleh `POST /api/pedia/orders/[code]/refill` dan bot Telegram (`pdrf:`) tanpa duplikasi |

### 4.2 Modul Existing yang Diubah Secara Aditif

| File Existing | Perubahan Spesifik |
|---|---|
| `src/lib/telegram/keyboards.ts` | Tambah 1 baris 2 tombol (`📈 Sosmed Pedia` \| `🎮 Top Up Games`) tepat di bawah `🛍 Lihat Semua Katalog` di `homeKeyboard()`; perbarui `mainReplyMenu()` (2×3 ringkas); tambah builder `cb.games*`, `cb.pedia*`, `cb.pediaRefill`, `gamesKeyboard*`, `pediaKeyboard*`, dan perbarui `paymentExpiredKeyboard`/`otherMethodsEntryKeyboard` agar sadar `order_kind` |
| `src/lib/telegram/button-style.ts` | Daftarkan prefix aksi baru (`gmv`, `gmu`, `pds`, `pdn`, `pdrf`) ke `SUCCESS_ACTIONS` bila diperlukan agar warna tombol tetap konsisten Bot API 9.4+ |
| `src/lib/telegram/api.ts` | Tambah `/games` dan `/pedia` ke `setMyCommands()` |
| `src/app/api/telegram/webhook/route.ts` | Tambah `/games`, `/pedia` ke `purchaseIntents` (group redirect) & tambah prefix `pdrf:` di `isProtectedCallbackMessage` |
| `src/lib/telegram/handlers/command.ts` | Routing `/games`, `/pedia`, label Reply Menu baru, input `gm_*`/`pd_*` (`handleGamesPendingInput`, `handlePediaPendingInput`), **deteksi paste link sosmed** (`detectPediaLink`) sebelum free-text search, serta smart search lintas Apps + Games + Pedia |
| `src/lib/telegram/handlers/callback.ts` | Tambah `pdrf`, `gmv`, `gmu`, `pds`, `pdn`, `pdni` ke guard `ownerBound` / private-chat; delegasikan prefix `gm*` ke `handlers/games.ts` dan `pd*`/`pdrf` ke `handlers/pedia.ts`; pastikan navigasi pulang membersihkan draft `gm_*`/`pd_*` tanpa menyentuh `creating` anchor |
| `src/lib/telegram/payment-quote.ts` | Perluasan **aditif** `Payq1CartSource` menjadi union diskriminatif: `{ kind: "single", ... }` \| `{ kind: "games", productId, sku, slug, note, zoneId?, nickname?, contractDigest, costSnapshot }` \| `{ kind: "pedia", productId, tierId, qty, targetRaw, targetNormalized, commentsHash? }`; regex `orderCode` terima `/^(?:AXV\|AXG\|AXP)-\d{8}-[A-Z0-9]{8}$/` |
| `src/lib/telegram/handlers/payment-methods.ts` & `payment-dispatch.ts` | Branch bersih saat `state.source.kind === "games"` atau `"pedia"`: QRIS arahkan ke `games-checkout.ts`/`pedia-checkout.ts`, Crypto panggil adapter `createNowpaymentsInvoice` yang sama + definitive failure cancel dengan restock kosong `[]` + `expireGamesCheckouts`/`expirePediaCheckouts` |
| `src/lib/telegram/handlers/orders.ts` | Perbaiki `ORDER_TAB_SQL`, `handleMyOrdersPaged`, `handleOrderStatus`, `handleOrderRefresh`, `handleOrderCancel` (branch `games` & `pedia` dengan restock `[]` + expire item), serta guard `handleWarrantyClaim` khusus `apps` |
| `src/lib/telegram/handlers/payment-status.ts` & `invoice-retry.ts` | Pakai `telegramOrderItemSummary()` agar label item Games tidak jatuh ke `"Pesanan"`, serta keyboard terminal/paid mengikuti `order_kind` |
| `src/lib/payments/qris-expiry-notifications.ts` | Pakai `telegramOrderItemSummary()` dan tombol reorder sesuai `order_kind` (`gmo:`/`pds:`/`reorder:`) |
| `src/lib/telegram/order-notifications.ts` | Sesuaikan `notifyTelegramBuyerPaid` untuk `games` & `pedia` (copy akurat + keyboard sesuai kind, bukan `Ambil Detail Produk`); rapikan tautan `👁 Lihat pesanan pembeli` di `telegramOrderAdminKeyboard` untuk `games` & `pedia` |
| `src/lib/games/notify.ts` | Di `notifyGamesPaid`: bila `sales_channel='telegram'`, skip DM duplikat (karena `notifyTelegramBuyerPaid` sudah mengirim DM lunas, atau sebaliknya — **kunci 1 pemilik tunggal!**). Di `notifyGamesCompleted`: kirim DM sukses + SN `<code>` + tombol `🔁 Top Up Lagi` via Telegram |
| `src/lib/pedia/notify.ts` | Tambah pengiriman DM Telegram untuk order `sales_channel='telegram'` pada fase `completed` (dengan tombol `♻️ Ajukan Refill` bila eligible) dan `partial`/`canceled` melalui `buyer_notice_log` (`telegram:pedia-{phase}:<code>`) tanpa mensyaratkan `customer_email` |
| `src/lib/telegram/credential-delivery.ts` | Guard eksplisit bila `order_kind !== 'apps'` (tolak ramah tanpa membaca tabel kredensial Market) |

---

### 4.3 Peta Kontrak Notifikasi Lunas & Selesai (Anti-Dobel!)

Untuk mencegah pembeli Telegram menerima 2 pesan "Pembayaran diterima" sekaligus:

| Event | `order_kind='apps'` (Existing) | `order_kind='games'` (`sales_channel='telegram'`) | `order_kind='pedia'` (`sales_channel='telegram'`) |
|---|---|---|---|
| **Invoice terbit** | `invoice.ts` / `payment-dispatch.ts` (QRIS photo / Crypto text) | `games-checkout.ts` / `payment-dispatch.ts` (QRIS photo / Crypto text, sama!) | `pedia-checkout.ts` / `payment-dispatch.ts` (QRIS photo / Crypto text, sama!) |
| **Reminder & Expiry** | `sendPendingOrderReminders` & `sendQrisExpiryNotifications` | Sama (memakai `telegramOrderItemSummary` & tombol reorder Games) | Sama (memakai `telegramOrderItemSummary` & tombol reorder Pedia) |
| **Order Lunas** | `notifyTelegramBuyerPaid` (DM) | **`notifyTelegramBuyerPaid`** (DM khusus Games: "Pembayaran diterima · Top up diproses otomatis"); `notifyGamesPaid` **skip DM** bila `sales_channel='telegram'` | **`notifyTelegramBuyerPaid`** (DM khusus Pedia: "Pembayaran diterima · Pesanan masuk antrean otomatis"); `notifyPediaPaid` tetap email-only (no-op tanpa email) |
| **Order Selesai** | `credential-delivery.ts` (kredensial) | **`notifyGamesCompleted`** → DM Telegram berisi Game, Nominal, ID, Nickname, **`SN`** + tombol `🔁 Top Up Lagi` | **`notifyPediaCompleted`** → DM Telegram berisi Layanan, Target, Jumlah Masuk + tombol **`♻️ Ajukan Refill`** (bila eligible) + `🔁 Pesan Lagi` |
| **Butuh Tindak Lanjut / Partial / Canceled** | `notifyBuyerDeliveryFailed` | Status `needs_check`: alert admin Telegram (`notifyGamesNeedsCheck`), halaman/cek status jujur ke pembeli (konsisten keputusan owner 17 Nov) | `partial`/`canceled`: 1 DM jujur ke pembeli bahwa sedang ditindaklanjuti admin + tombol WA Admin (`buyer_notice_log` key `telegram:pedia-followup:<code>`) |
| **Notif Grup Admin (`Axvara_Notif`)** | `notifyTelegramPaidAdmin` (existing) | `notifyTelegramPaidAdmin` (sudah memanggil `gamesAdminDeliverySummary`!) | `notifyTelegramPaidAdmin` (sudah memanggil `pediaAdminDeliverySummary`!) |

---

### 4.4 Tabel Callback Data (Semua Terverifikasi ≤ 64 Byte)

| Prefix | Format | Contoh | Panjang Maks | Guard |
|---|---|---|---|---|
| `gmh` | `gmh` | `gmh` | 3 B | Public / Private |
| `gma` | `gma:<page>` | `gma:2` | 8 B | Public / Private |
| `gmg` | `gmg:<genre>:<page>` | `gmg:shooter:1` | 18 B | Public / Private |
| `gmq` | `gmq` | `gmq` | 3 B | Private (`pending_action`) |
| `gmo` | `gmo:<slug>` | `gmo:league-of-legends-wild-rift` | ≤ 40 B | Public / Private |
| `gmr` | `gmr:<slug>` | `gmr:mobile-legends` | ≤ 40 B | Public / Private |
| `gms` | `gms:<slug>:<typeIdx>` | `gms:mobile-legends:0` | ≤ 44 B | Private (`pending_action`) |
| `gmt` | `gmt:<slug>:<tIdx>:<cat>:<rng>:<pg>` | `gmt:mobile-legends:0:a:1:0` | ≤ 52 B | Public / Private |
| `gmv` | `gmv:<gamesProductId>` | `gmv:1042` | ≤ 14 B | Private (`ownerBound`) |
| `gmu` | `gmu:<gamesProductId>` | `gmu:1042` | ≤ 14 B | Private (`ownerBound`) |
| `gme` | `gme:<gamesProductId>` | `gme:1042` | ≤ 14 B | Private (`ownerBound`) |
| `pdh` | `pdh` | `pdh` | 3 B | Public / Private |
| `pda` | `pda:<page>` | `pda:1` | 8 B | Public / Private |
| `pdsrc` | `pdsrc` *(prompt cari layanan)* | `pdsrc` | 5 B | Private (`pending_action`) |
| `pdp` | `pdp:<platform>:<page>` | `pdp:coinmarketcap:0` | ≤ 24 B | Public / Private |
| `pdt` | `pdt:<prodId>:<flt>:<page>` | `pdt:12:i:0` | ≤ 16 B | Public / Private |
| `pds` | `pds:<prodId>:<tierId>` | `pds:12:269` | ≤ 18 B | Private (`ownerBound`) |
| `pdl` | `pdl:<prodId>` *(dari paste-link chat)* | `pdl:12` | ≤ 12 B | Private (`ownerBound`) |
| `pdn` | `pdn:<prodId>:<tierId>:<qty>` *(pilih qty preset)* | `pdn:12:269:1000` | ≤ 28 B | Private (`ownerBound`) |
| `pdni` | `pdni:<prodId>:<tierId>` *(ketik qty/komentar)* | `pdni:12:269` | ≤ 20 B | Private (`ownerBound`) |
| `pdrf` | `pdrf:<orderCode>` *(ajukan refill)* | `pdrf:AXP-20261125-ABCD1234` | 26 B | Private + Ownership DB |

> **Catatan keamanan `callback_data`:** Seluruh 48 game live saat ini memiliki `slug` ≤ 32 karakter (sehingga `gmt:<slug>:...` selalu ≤ 52 byte). Namun bila kelak ada game dengan `slug` > 38 karakter, fallback ke token integer `repId = MIN(games_products.id)` milik `game_slug` tersebut (`gmo:#<repId>` / `gmt:#<repId>:...` → selalu ≤ 24 byte, tetap mencakup seluruh region dalam `game_slug` yang sama tanpa bergantung pada `sk_product_id` per-region).

### 4.5 Penyimpanan Sementara Custom Comments Pedia
- Komentar custom Pedia dapat mencapai **8.000 karakter** (200 baris).
- Jangan menaruh komentar di `callback_data`. Simpan di JSON `pending_action` (batas `PAYQ1_MAX_BYTES = 64 KB`, jauh di atas 8 KB komentar; kolom `telegram_users.pending_action` bertipe `TEXT` di SQLite/D1).
- Validasi panjang/jumlah baris ulang lewat `checkCustomComments()` sebelum insert ke `pedia_order_items.snapshot_json`.

---

## 5. Rencana Eksekusi Bertahap (4 Fase)

Setiap fase adalah satu paket perubahan mandiri yang lulus full test suite, typecheck, lint, dan terdokumentasi sebelum lanjut ke fase berikutnya:

### Fase 0 — Fondasi Lintas-Kind & Anti-Regresi
**Tujuan:** Membuat mesin `/orders`, cancel, status, expiry, notifikasi, dan `payq1` aman untuk `AXG` & `AXP` sebelum tombol publik dibuka.
1. Buat `src/lib/telegram/order-summary.ts` (`telegramOrderItemSummary`).
2. Perbaiki `src/lib/telegram/handlers/orders.ts`: `ORDER_TAB_SQL`, `handleMyOrdersPaged`, `handleOrderStatus`, `handleOrderRefresh`, `handleOrderCancel` (restock `[]` + `expireGamesCheckouts`/`expirePediaCheckouts`), dan guard `handleWarrantyClaim`.
3. Perbaiki `src/lib/telegram/credential-delivery.ts`, `invoice-retry.ts`, `payment-status.ts`, dan `src/lib/payments/qris-expiry-notifications.ts` agar sadar `order_kind`.
4. Satukan notifikasi pembeli & admin di `order-notifications.ts`, `src/lib/games/notify.ts`, dan `src/lib/pedia/notify.ts` (nol pesan dobel, nol tombol Market di order Games/Pedia).
5. Perluas `Payq1State` di `src/lib/telegram/payment-quote.ts` secara aditif (`source.kind: "single" | "games" | "pedia"`, regex `AXV|AXG|AXP`).
6. Tambah unit & workerd D1 test fokus Fase 0.

### Fase 1 — Entri Home `/start` + **AXVARA Games Native End-to-End**
**Tujuan:** Pembeli bisa top up 48 game langsung dari `@Axvara_bot` (QRIS + Crypto).
1. Update `homeKeyboard()` — tambah tepat 1 baris 2 tombol di bawah `🛍 Lihat Semua Katalog` (sementara tombol Pedia bila Fase 2 belum deploy bisa menampilkan info atau ditahan hingga Fase 2 siap — atau rilis Fase 1 & 2 berurutan sebelum push publik bila diinginkan).
2. Update `mainReplyMenu()`, `setMyCommands()`, dan `webhook/route.ts` group guard.
3. Implementasikan `src/lib/telegram/handlers/games.ts`, `src/lib/telegram/games-checkout.ts`, `src/lib/telegram/messages/games.ts`.
4. Sambungkan `payment-methods.ts` & `payment-dispatch.ts` untuk `source.kind === "games"` (QRIS + Crypto + definitive vs ambiguous failure + cancel tanpa restock).
5. Tambah test lengkap Games Telegram (navigasi, filter tipe/pass/rentang, parser ID 1-pesan & 2-pesan, auto-fill ID terakhir, cek nickname ok/unavailable + hint region, create order QRIS/Crypto, `duplicate_active_order`, definitive failure cancel, paid → dispatch → notif SN, `/orders` & cancel).

### Fase 2 — **AXVARA Pedia Native End-to-End** + Refill di Chat
**Tujuan:** Pembeli bisa order 33 platform / 109 produk / 275 tier Pedia (termasuk paste-link otomatis & custom comments) dan ajukan Refill langsung dari chat.
1. Ekstrak `src/lib/pedia/refill-action.ts` dan pakai ulang di `POST /api/pedia/orders/[code]/refill`.
2. Implementasikan `src/lib/telegram/handlers/pedia.ts`, `src/lib/telegram/pedia-checkout.ts`, `src/lib/telegram/messages/pedia.ts`.
3. Sambungkan deteksi paste link sosmed (`detectPediaLink`) di `command.ts` sebelum free-text search.
4. Sambungkan `payment-methods.ts` & `payment-dispatch.ts` untuk `source.kind === "pedia"` (QRIS + Crypto + margin guard 410 + `duplicate_active_order` + cancel tanpa restock).
5. Tambah test lengkap Pedia Telegram (paste link valid/mismatch, filter Indo/Global/Refill, daftar tier bernomor, qty preset & bebas, custom comments valid/error, margin guard 410, create order QRIS/Crypto, paid → completed → DM + tombol `♻️ Ajukan Refill` API & manual + cooldown 24 jam).

### Fase 3 — Smart Search Lintas 3 Lini, Polish & Dokumentasi Final
1. Perluas free-text search (`discovery.ts`) agar 1 pencarian (mis. `"ml"`, `"followers ig"`, `"canva"`) menampilkan hasil relevan dari Apps, Games, dan Pedia secara rapi tanpa banjir tombol.
2. Review seluruh copy ID/EN + format USD display (`TG-CURLANG`) + audit white-label (0 kata supplier bocor).
3. Update dokumentasi wajib: `docs/PRD.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/GAMES.md`, `docs/agent-rules/pedia.md`, dan `CHANGELOG.md`.
4. Jalankan full suite `npx vitest run --run`, `npx tsc --noEmit`, `npm run lint`, `npm run build:pages`, dan `git diff --check`.

---

## 6. Matriks Edge Case, Keamanan & Anti-Regresi

| Skenario | Perilaku yang Diwajibkan |
|---|---|
| **Harga/stok/kontrak Games berubah antara konfirmasi dan klik Bayar** | Tolak fail-closed di batch D1, lepas anchor jika belum ada order/TX, tampilkan pesan ramah + tombol pilih ulang nominal |
| **Margin Pedia turun di bawah `min_profit_rp` saat bayar** | Nonaktifkan tier otomatis (`auto_disabled_reason='margin'`), bump `catalog_revision_pedia`, tolak order tanpa membuat tagihan |
| **`duplicate_active_order` (ID+SKU Games atau Link+Produk Pedia masih aktif)** | Tolak ramah dengan nomor order aktif / saran tunggu selesai atau batalkan order pending sebelumnya |
| **Cancel order Games/Pedia saat sedang pending** | `transitionPendingOrder(code, "dibatalkan", "buyer_cancel", [])` + `expireGamesCheckouts`/`expirePediaCheckouts` → **0 perubahan stok Market** dan target/ID langsung bebas dipesan lagi |
| **Cancel order saat pembayaran baru saja lunas (race)** | `OrderTransitionError` → order tetap lunas, tampilkan pesan status sudah berubah |
| **Kegagalan create NOWPayments definitif vs ambigu** | Definitif: batal order (restock `[]`) + expire item + TX `failed` + lepas anchor + tawarkan QRIS/metode lain. Ambigu: **jangan batal, jangan POST ulang**, pertahankan anchor `creating` |
| **Double-tap tombol bayar / redelivery webhook Telegram** | Dijaga `telegram_updates` lease + CAS `quoted → creating` + unique `orders.quote_id` + guard 1 pending order per chat |
| **Order kecil Rp800–Rp15.000 (di bawah minimum crypto)** | `buildMethodOptions` otomatis hanya mengembalikan `qris`; tombol Crypto tidak ditampilkan (bukan error) |
| **Nickname Games `unavailable` / timeout Sekalipay** | Tidak memblokir checkout; tampilkan catatan jujur agar pembeli cek ID secara manual |
| **User sedang di state input (`gm_acct`/`pd_target`/`pd_comments`) lalu tekan tombol menu atau `/start` atau `/batal`** | Route slash command & tombol Reply Menu dijalankan **sebelum** pending-input handler sehingga user tidak pernah terjebak (hanya `payq1` berstatus `creating` yang tetap dilindungi) |
| **Bot dipakai di grup publik Telegram** | Semua command & callback `gm*`/`pd*`/`pdrf` dari chat negatif (`chatId < 0`) tetap di-redirect ke DM pribadi `@Axvara_bot` |
| **Test existing yang sensitif terhadap `homeKeyboard()`** | Audit & update assertion pada `tests/telegram-bot.regression.test.ts`, `tests/telegram-button-style.test.ts`, `tests/telegram-commerce-locale.test.ts`, `tests/telegram-orders-tabs-claim.test.ts`, `tests/telegram-p0-ux-fixes.integration.test.ts` |

---

## 7. Kriteria Selesai & Verifikasi

- **Unit & Integrasi (Vitest + Miniflare D1 workerd):**
  - Seluruh jalur baru diuji dengan fixture D1 nyata (tanpa mutasi/transaksi produksi): Games checkout QRIS/Crypto, Pedia checkout QRIS/Crypto + Custom Comments, cancel non-restock + collision ID dengan `products.id`, `/orders` tab `Aktif|Selesai|Gagal` lintas 3 kind, notif paid/completed/SN tanpa duplikasi, Refill API & manual + cooldown 24 jam, white-label leak check, dan ownership/group security guard.
  - Full suite `npx vitest run --run` hijau 100%, `npx tsc --noEmit` 0 error, `npm run lint` 0 error, `npm run build:pages` lulus.
- **Uji Live Pasca-Deploy CI (Read-Only / Tanpa Bayar Nyata):**
  - Kirim `/start` di `@Axvara_bot` (HP & Desktop) → pastikan 2 tombol baru muncul tepat di bawah `🛍 Lihat Semua Katalog` tanpa elipsis (`...`).
  - Uji jelajah `🎮 Top Up Games` (ML → Pass/Rentang/Ketik angka → ID + cek nickname live), `📈 Sosmed Pedia` (menu & paste link Instagram/TikTok → filter tier bernomor → validasi jumlah), dan `/orders`.
  - Hentikan sebelum transfer/bayar nyata di produksi (sesuai aturan QA produksi).

---

## 8. Konfirmasi Singkat Sebelum Mulai Coding

1. **Label & warna 2 tombol baru di `/start` (tepat di bawah `🛍 Lihat Semua Katalog`):**
   - Label rekomendasi (≤15 char, anti-elipsis di HP): **`📈 Sosmed Pedia`** | **`🎮 Top Up Games`** *(EN: `📈 Social Media` | `🎮 Top Up Games`)*. Mau pakai ini atau versi lebih pendek (`📈 Sosmed` | `🎮 Games`)?
   - Warna tombol: mau **hijau (`success`)** menyatu dengan `Lihat Semua Katalog`, atau **biru (`primary`)** seperti tombol kategori?
2. **Urutan rilis:** Mau langsung saya eksekusi bertahap **Fase 0 → Fase 1 (Games) → Fase 2 (Pedia) → Fase 3 (Polish)** dan baru tampilkan tombol keduanya setelah Fase 1 & 2 siap, atau rilis **Fase 0 + Fase 1 (Games)** dulu ke produksi lalu menyusul **Fase 2 (Pedia)**?
