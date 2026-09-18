# Disable Auto-DM Kredensial WA + Hardening Umur Nomor BOT Grup

## Latar Belakang

19 Sep 2026 ~00:30 WIB: nomor BOT WA (`089519388264`) kena **pembatasan sementara**
(timer ~3 jam 22 menit, "tidak bisa memulai chat baru", masih bisa balas chat masuk).
Pola pemicu (riset komunitas WhiskeySockets/Baileys 19 Sep 2026):

1. **Reconnect hammer tiap 3 detik** — `src/index.ts` gateway reconnect SEMUA close
   termasuk 401 (`setTimeout(startWhatsApp, 3000)`, tanpa backoff, tanpa teardown
   socket lama). Dok Baileys: 401 = loggedOut = JANGAN reconnect. Socket ganda
   hidup bersamaan (zombie) dianggap konflik sesi → eskalasi ke restriction.
2. **DM dingin + link di pesan pertama** — `wr-web-ready`/`wr-delivery` adalah chat
   baru ke nomor yang belum pernah chat + template identik + URL. Red flag ganda
   (cold outreach / TC-token + template spam). Outbox memproses 8 baris berurutan
   tanpa jeda — panduan aman: ~8/mnt, maks 200/jam, jeda acak 2–8 dtk.
3. **IP datacenter US vs nomor ID** — dyno Heroku region `us`; reputasi IP server +
   lompat region dari HP memicu flag (kasus lokal-aman-naik-server-kena).
4. **Tanpa `cachedGroupMetadata`** — tiap `sendMessage` ke grup fetch daftar
   partisipan; FAQ resmi Baileys mewajibkan cache (rate limit cepat habis).

Keputusan owner 19 Sep 2026:
- **Auto-DM kredensial WA ke buyer DIMATIKAN via flag (kode + mekanisme UTUH,
  mudah dinyalakan lagi).** BOT WA cukup balas grup. Kredensial tetap terkirim
  via email (Resend, terbukti 3/3) + panel web + kirim manual dari HP bila perlu.
- Saat restriction lepas + pairing ulang: BOT grup dipastikan berjalan + semua
  hardening umur nomor diterapkan.

## Tujuan

1. Tidak ada lagi chat baru otomatis dari bot (nol risiko restriction dari sisi kita)
   selama flag mati — grup tetap hidup penuh.
2. Gateway grup tahan lama: reconnect benar, pacing manusiawi, cache grup,
   health terpantau, sesi stabil (satu socket, fingerprint tetap).
3. Menyalakan lagi auto-DM semudah set 1 env + deploy (tanpa ubah kode).

## Ruang Lingkup

- Flag baru `WHATSAPP_CREDENTIAL_DM_ENABLED` (default **false** = mati):
  gate di `notifyWebBuyerCredentialsReady`, `deliverWebCredentialViaWhatsApp`,
  `deliverWhatsAppCredential` (channel whatsapp) — ketiganya return dini
  (skip diam, BUKAN error) agar delivery tetap settled via email + panel.
  Kode + mekanisme outbox + template + test TIDAK dihapus.
- Hardening gateway (`axvara-wa-gateway/src/index.ts`, deploy via `git push heroku`):
  no-reconnect pada 401; exponential backoff + jitter untuk sisanya;
  teardown socket lama (`sock.end()`) sebelum reconnect; `cachedGroupMetadata`
  (TTL 5 mnt); jeda baca 1-2 dtk + presence sebelum balas grup;
  `/health` memaparkan `lastDisconnect` + `reconnectCount`.
- Pacing outbox Pages (`processDueWhatsAppOutbox` / `processWhatsAppOutboxRow`):
  jeda antar kirim dalam satu run (default ~6 dtk + jitter, env override),
  cooldown per destinasi, stop-aturan: sinyal `whatsapp_not_connected` /
  401 / 403 / 463 N kali berurutan → jeda panjang + catat (auto-pause lunak),
  bukan retry buta.
- Update Baileys rc13 → rilis terbaru + rebuild dist.
- Docs: `.env.example`, `docs/ARCHITECTURE.md` (§ grup + § pengawasan),
  `docs/PRD.md` (FR-S24 + catatan flag), `README.md`, `CHANGELOG.md`.

## Di Luar Scope

- Menghapus template/kode DM (dilarang — harus gampang dinyalakan lagi).
- Cloud API resmi untuk DM transaksional (rencana jangka menengah, issue terpisah).
- Pairing ulang (aksi owner di HP setelah timer nol; sesi Postgres dipertahankan,
  jangan hapus kunci; JANGAN `pair:fast` kecuali sesi ditolak total).

## Area / File Terkait

- `src/lib/feature-flags.ts` — flag baru.
- `src/lib/warung-rebahan/deliver.ts` — 3 gate (notify + 2 deliver).
- `src/lib/fulfillment/delivery/send.ts`, `process.ts` — gate jalur legacy WA.
- `src/lib/whatsapp/outbox.ts` — pacing + auto-pause.
- `axvara-wa-gateway/src/index.ts` — reconnect/cache/presence/health.
- `axvara-wa-gateway/package.json` — bump Baileys.
- `.env.example` — dokumentasi flag.
- `tests/wr-queued-delivery.regression.test.ts` + test flag/outbox baru.
- `docs/{ARCHITECTURE,PRD}.md`, `README.md`, `CHANGELOG.md`.

## Risiko

- **Buyer MBO menunggu lama tanpa WA otomatis.** Mitigasi: email + panel tetap
  jalan; halaman pesanan memuat estimasi; kirim manual dari HP untuk kasus lama.
- **Flag mati tapi kode dikira dihapus.** Mitigasi: test guard "fungsi DM masih
  ada + di-gate flag"; docs cara menyalakan lagi (1 env + deploy, tanpa kode).
- **Backoff membuat grup terasa mati saat gangguan.** Mitigasi: `/health`
  memaparkan status jujur; admin tahu dari dashboard, bukan tebak-tebakan.
- **Bump Baileys merusak pairing.** Mitigasi: baca changelog RC; pairing ulang
  hanya setelah timer nol; sesi Postgres tidak dihapus.

## Langkah Implementasi

1. Flag + gate 3 call-site WR + 2 legacy (skip diam, settled via jalur lain).
2. Hardening gateway (reconnect/cache/presence/health) + bump Baileys + build.
3. Pacing + auto-pause outbox Pages.
4. `.env.example` + docs + CHANGELOG.
5. `tsc` + full vitest + dev 200/CSS 200 + Obscura + commit + push `main`
   (gateway deploy terpisah via `git push heroku` — TUNDA sampai timer nol,
   karena deploy = restart = reconnect saat restriction = memperpanjang).

## Rencana Test

- Baru: flag mati → 3 fungsi DM skip tanpa enqueue + delivery web tetap settled
  (token + email); flag nyala → perilaku lama utuh.
- Baru: outbox pacing (jeda antar kirim tercatat) + auto-pause setelah N sinyal
  401/403 berurutan.
- Baru: gateway — 401 tidak reconnect; backoff naik; cache grup dipakai.
- Wajib: full `vitest` hijau + `tsc` bersih + dev + Obscura.

## Kriteria Selesai

- [ ] Flag mati: tidak ada `wr-delivery`/`wr-web-ready` baru di outbox;
      email + panel tetap jalan (bukti: test + D1).
- [ ] Flag nyala (di test): perilaku DM lama utuh (kode tidak dihapus).
- [ ] Gateway: 401 tidak reconnect; backoff + teardown; cache grup; health jujur.
- [ ] Outbox: pacing + auto-pause teruji.
- [ ] Docs + CHANGELOG + push `main`; deploy gateway DITUNDA sampai timer nol.
- [ ] Cara menyalakan lagi terdokumentasi (1 env + deploy).

## Cara Menyalakan Lagi (besok-besok)

1. Pastikan nomor sehat (lewati warming 2–3 hari pasca-restriction).
2. Set Pages secret `WHATSAPP_CREDENTIAL_DM_ENABLED=true` + deploy (commit kosong).
3. Pantau outbox 1 jam pertama (maks ~8/mnt); bila 401/403 → matikan lagi.
