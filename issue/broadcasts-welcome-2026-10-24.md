# Siaran admin dan sambutan anggota grup — 24 Oktober 2026

Implementasi selesai di source; publikasi lewat push main/CI. QA memakai fixture:
tidak mengirim siaran uji produksi, pesan WhatsApp nyata, atau order supplier.

## Keputusan fitur Siaran

- Menu **Konten → Siaran** (`/admin?section=broadcasts`, requireAdmin): pustaka
  maksimal 200 template teks (nama internal, judul/subjek email, isi ≤3000 karakter,
  tombol tautan HTTPS opsional). Buat/edit/salin/arsip/pulihkan; simpan tidak mengirim.
- Kirim: pilih satu/beberapa tujuan → Tinjau jumlah → Kirim siaran sekarang.
  Tujuan: (1) satu grup WA AXVARA'S terverifikasi pada nomor bot aktif,
  (2) subscriber email `newsletter_subscribers` status active,
  (3) pengguna pribadi Telegram terdaftar yang tidak diblokir/opt-out.
  Telegram hanya menjangkau pengguna yang pernah berinteraksi dengan bot.
- Migrasi 0077: `broadcast_templates`, `broadcast_campaigns`, `broadcast_deliveries`,
  `broadcast_dispatch_control`, `newsletter_subscribers.unsubscribe_token`,
  `telegram_users.broadcast_opt_out`. Setiap launch membekukan snapshot isi +
  daftar penerima; edit template tidak mengubah siaran berjalan/terkirim.
- Idempotensi: UUID kampanye client + fingerprint (template/revisi/kanal/identitas WA).
  Replay ID sama tidak menambah penerima/mengirim ulang. Worker di cron lite existing
  (promo): maks 8 penerima/tick, lease singleton, CAS delivery; hasil ambigu → `unknown`
  (Perlu diperiksa), tidak dikirim ulang otomatis. Kampanye queued bisa dihentikan;
  hanya pending dibatalkan.
- Opt-out: email token acak 32 byte + `/api/subscribers/unsubscribe` (GET form inert,
  POST berhenti); Telegram `/stop` / `/siaran_on`. Sesudah claim, status opt-out
  diperiksa ulang di SQL. Email memakai Resend existing dengan List-Unsubscribe.

## Sambutan anggota grup WhatsApp

- Penyebab bug lama: anggota tanpa sesi dianggap baru lalu disapa saat pertama
  chat; percakapan biasa juga memicu pencarian produk. Pemicu itu dihapus.
- Gateway `group-participants.update` action `add` (grup terverifikasi, bot sendiri
  PN/LID disingkirkan, maks 100/batch) → Pages `/api/whatsapp/group-events`
  (token webhook existing, verifikasi ulang group/phone/revision) → outbox
  `group_welcome` dengan kunci SHA256(group,phone,revision,hari UTC,member IDs).
  Dedupe per batch/hari; ID anggota tidak disimpan di payload.
- Gateway `/send-welcome` key `wa:welcome:<sha256>`, `/send-broadcast` key
  `wa:broadcast:<UUIDv4>`, `/send-notification` key invoice — namespace terpisah,
  lintas namespace ditolak; pacing/cooldown/ledger PG bersama.
- Format pesan: bingkai existing, sapaan waktu WIB, nama tersanitasi (maks 3,
  fallback "Kak"), deskripsi layanan, tautan order website/Telegram/bantuan admin.

## Batas dan rollout

- Batas pacing (WA 60 detik, email 650ms, Telegram 150ms + Retry-After) adalah
  batas operasional, bukan jaminan kuota/inbox/anti-ban. Tidak ada env/cron/resource
  baru, tidak ada DM WA massal, tidak ada paid Telegram broadcast.
- Rollout hanya CI main: migrasi 0077 → gateway → Pages. Rollback wajib kompatibel
  runtime nomor/revisi + ledger broadcast/welcome; pertahankan tabel/snapshot/token.
- Verifikasi: Vitest root 3104 test/259 file pass, `tsc` pass, gateway 12 test +
  build pass; dev `GET /` 200 + CSS 200; Obscura fixture komponen aktual 1440/390
  (review → kirim ambigu → retry ID sama → hentikan) tanpa overflow/JS error.
