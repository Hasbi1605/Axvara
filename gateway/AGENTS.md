# AGENTS — gateway WhatsApp AXVARA

Scope: `axvara/gateway/`. Aturan root AXVARA berlaku. Source produksi kanonis
berpindah dari folder saudara `axvara-wa-gateway` pada 24 Oktober 2026.

**21 November 2026 — keputusan owner (FX-15, lokal):** hanya web dan bot Telegram
yang menjadi kanal jual. Gateway WA tetap untuk promo, siaran grup, sambutan dan
balasan dukungan `.d`/`garansi`/arahan ke kanal resmi. Jangan menambah checkout,
notifikasi transaksi atau DM kredensial. `/send` teks grup bertoken tetap ada;
`/send-image` legacy dihapus (tidak memengaruhi gambar pada endpoint promo).

Audit dependency27Oktober: Fastify5.12.7, Sharp0.35.5, fast-uri4.2.3/3.1.9,
music-metadata11.16.1 dipatch kompatibel; Baileys/Node22/session/runtime tidak
diganti. Sharp dipanggil transitif Baileys thumbnail, sehingga tidak boleh
dianggap unreachable hanya karena source gateway tidak mengimportnya. CI root
menjalankan gate runtime high/critical dan registry error sebelum build/deploy;
laporan `../docs/security/dependency-audit-2026-10-27.md`. Deploy tetap hanya CI.

- Baileys 7.0.0-rc14 dikunci lockfile; Node22, Heroku akun#1/app `axvara-wa-gateway`.
  Tidak membuat app/database/paket baru. WR/SK tetap di VPS, `/wr/*` tetap410.
- Deploy HANYA melalui push main AXVARA → `.github/workflows/ci.yml` →
  `scripts/ci-whatsapp-gateway.cjs` (Heroku source/build API). Jangan push Heroku,
  upload session lokal, atau deploy manual. Setelah push diterima berhenti.
- Secret CI `HEROKU_API_KEY_AKUN1` berasal dari root `.heroku-credentials` ignored;
  konfigurasi Heroku existing `DATABASE_URL`, `AXVARA_WEBHOOK_TOKEN`,
  `AXVARA_WEBHOOK_URL`, `PUBLIC_BASE_URL`, `TARGET_GROUP_ID` dipertahankan.
  Pages `WHATSAPP_WEBHOOK_TOKEN` harus sama dengan token gateway.
- Nomor awal `6283181632507` hanya bootstrap; nomor aktif/revisi/pin grup tersimpan
  di singleton PG `axvara_wa_runtime`. Admin action:number → `/notification-number`
  mengganti nomor manual, tanpa edit env/deploy selanjutnya. WA_BOT_NUMBER lama
  tidak menentukan sesi. Prefix auth ditangkap per nomor; jangan menghapus key
  lama atau tabel delivery/control/runtime. Lock runtime global + lock bootstrap
  lama mencegah socket ganda saat rolling upgrade.
- Pergantian memakai mutex send/pair/status, menutup socket/listener lama + flush
  creds, CAS PG phone/revision, UUID revisi baru, lalu memuat auth nomor terpilih.
  D1 sudah dijeda dahulu. Sent/unknown/pin/cooldown/pacing tidak direset. Tab dan
  send lama wajib ditolak oleh phone/revision, termasuk A→B→A. Commit ambigu:
  hentikan sesi, baca ulang runtime, owner Cek koneksi/Hubungkan. Tidak ada rotasi
  otomatis atau reset restriction. Rollback setelah ganti nomor harus kompatibel
  runtime/revisi; jangan kembali ke kode nomor tetap atau menghapus auth/outbox.
- Hanya satu proses memiliki advisory lock Postgres. Cache grup invalidasi pada
  perubahan metadata/anggota; tujuan pertama harus satu grup `AXVARA'S` setelah
  NFKC, trim, kapitalisasi dan penyetaraan apostrof ’/‘/ʼ. Tidak ada substring/fuzzy
  matching. Nama ganda setelah normalisasi ditolak; kemudian pin ID durable.
  Pin tidak berpindah jika nama berubah. `/notification-status` memberi groupName
  kanonis dan groupSubject asli hanya setelah grup/izin kirim terverifikasi.
  Keanggotaan nomor aktif harus cocok PN/LID pada semua grup; announcement juga
  wajib admin. Metadata/kode pairing lama dibuang sebelum commit pergantian agar
  recovery commit ambigu tidak memakai izin dari nomor sebelumnya.
- Pairing hanya aksi admin dari Pengaturan Toko; kode jangan masuk log/git.
  401 tidak otomatis berarti ban. 401/403/440/500 berhenti untuk pemeriksaan;
  515 restart normal, error sementara memakai backoff.
- Revisi11November2026 lokal: `/send-notification` dipensiunkan410 setelah cek
  token. `/send-promo` menerima `wa:promo:YYYY-MM-DD:morning|evening` hanya dalam
  slot WIB09.00–<12.00/17.00–<20.00. Satu gambar URL tetap
  `https://axvara.tech/banners/ready-promo.webp`+caption, unduh maksimal5MB/8detik,
  WebP saja/tanpa redirect dan sebelum claim. Jangan menerima URL media sembarang.
  Proto pesan gambar disimpan di payload ledger untuk getMessage; fingerprint
  tetap mengikat target+konten. Tanpa schema/env baru atau pairing otomatis.
- `/send-promo` memakai key slot stabil + grup terverifikasi, max satu
  percobaan baru/60detik. Key sent didedupe, sending/unknown tidak dikirim ulang.
  Timeout/hasil ambigu perlu pemeriksaan manual, jangan hapus row untuk retry.
  Batas operasional ini bukan jaminan anti-ban. Jangan membuka DM massal,
  merotasi akun, atau mengubah fingerprint untuk melewati pembatasan.
- Siaran/welcome 24 Oktober: `/send-broadcast` key `wa:broadcast:<UUIDv4>` dan
  `/send-welcome` key `wa:welcome:<sha256>` memakai handler grup yang sama
  (token, mutex sesi, nomor/revisi aktif, pin grup terverifikasi, ledger PG,
  pacing bersama); key lintas namespace ditolak. `group-participants.update`
  action `add` menyimpan maks 100 anggota (bot PN/LID disingkirkan) di inbox
  PostgreSQL, lalu meneruskan ke Pages `/api/whatsapp/group-events` tanpa mutex
  sesi. Retry memakai waktu asal `x-wa-join-observed-at`, maks 6 percobaan dan
  umur 30 menit; 202 hanya sah setelah outbox D1 tersimpan. Mutex outbound
  terpisah dari status/sesi; izin grup, socket, revisi dan usia diperiksa sebelum
  kirim, settlement memakai nomor asal. Pacing/cooldown lama tetap. Detail:
  `../issue/broadcasts-welcome-2026-10-24.md`, ARCHITECTURE §16.13.
- Promo bot 17 Nov 2026 (`src/promo-bot.ts`): sesi Baileys kedua yang
  terisolasi di proses yang sama (mutex, socket, cache metadata grup 5 menit,
  reconnect/backoff sendiri; tanpa `messages.upsert`, tanpa welcome webhook,
  tanpa DM — hanya grup `@g.us` di mana nomor promo menjadi anggota dan berizin
  kirim via `groupAllowsBotSend(..., phone)`). Identitas/revisi disimpan di
  singleton PG `axvara_wa_promo_runtime(id=1, phone, revision)` (NULL = belum
  dikonfigurasi); pacing/cooldown memakai `axvara_wa_control` per nomor promo,
  ledger memakai `axvara_wa_delivery`, auth memakai `usePostgresAuthState(phone)`.
  Nomor promo dilarang sama dengan `BOT_NUMBER` utama (`409 same_as_notification_bot`,
  dan menolak start/terblokir jika bot utama beralih ke nomor promo). Endpoint
  bertanda `x-gateway-token`: `GET /promo-bot/status`, `POST /promo-bot/number`
  (CAS tanpa pairing otomatis), `POST /promo-bot/pair` (401 hanya hapus auth
  promo), `GET /promo-bot/groups`, dan `POST /promo-bot/send-promo` (key
  `wa:promo2:YYYY-MM-DD:morning|evening:<groupIdTanpa@g.us>` pada slot WIB
  09.00–<12.00 / 17.00–<20.00, gambar `PROMO_IMAGE_URL`, pacing 60 detik per
  nomor, timeout 25 detik → `unknown` + blokir sesi promo saja). `/health`
  memaparkan `promoBot:{configured,connected,blocked}` + `memoryRssMb`.
- Test `npm --prefix gateway test`, build `npm --prefix gateway run build`, lalu
  seluruh Vitest root. Sinkron PRD/ARCHITECTURE §16.12/README/CHANGELOG dan root
  AGENTS bila kontrak/env/rollout berubah.

Detail operasional dan referensi: `../issue/whatsapp-sales-notifications-2026-10-24.md`.
