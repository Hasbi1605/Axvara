# AGENTS — gateway WhatsApp AXVARA

Scope: `axvara/gateway/`. Aturan root AXVARA berlaku. Source produksi kanonis
berpindah dari folder saudara `axvara-wa-gateway` pada 24 Oktober 2026.

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
- `/send-notification` menerima key order stabil + grup terverifikasi, max satu
  percobaan baru/60detik. Key sent didedupe, sending/unknown tidak dikirim ulang.
  Timeout/hasil ambigu perlu pemeriksaan manual, jangan hapus row untuk retry.
  Batas operasional ini bukan jaminan anti-ban. Jangan membuka DM/broadcast,
  merotasi akun, atau mengubah fingerprint untuk melewati pembatasan.
- Test `npm --prefix gateway test`, build `npm --prefix gateway run build`, lalu
  seluruh Vitest root. Sinkron PRD/ARCHITECTURE §16.12/README/CHANGELOG dan root
  AGENTS bila kontrak/env/rollout berubah.

Detail operasional dan referensi: `../issue/whatsapp-sales-notifications-2026-10-24.md`.
