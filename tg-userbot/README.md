# AXVARA Telegram userbot

Service kecil di VPS (sebelah `wr-proxy`) untuk satu tugas: meneruskan pesan promo
yang berisi custom/animated emoji dari supergroup **staging** privat ke **channel**
publik dengan `drop_author` (Hide Sender Name). Bot biasa tidak bisa memposting
custom emoji di channel; akun Premium yang meneruskan dengan `drop_author` bisa.

Tidak ada secret di folder ini. Session, API hash dan state hanya ada di VPS/Mac owner.

## Batas keamanan

- Hanya satu method Telegram: `messages.ForwardMessages` (`dropAuthor: true`). Tidak
  membaca chat, tidak ada event handler. `getDialogs` dipanggil sekali saat start
  hanya untuk mengisi cache access hash.
- Hanya dari `TG_ALLOW_FROM_CHAT` ke `TG_ALLOW_TO_CHAT` (string persis); selain itu `403 forbidden_chat`.
- HTTP hanya `127.0.0.1` (cek alamat socket + header `Host`), body maks 4 KB.
  Akses dari luar lewat `POST /tgu/forward` di `wr-proxy` (butuh `x-proxy-token`).
- Idempotensi durable (`TG_STATE_FILE`, mode 0600, entri dipangkas setelah 7 hari).
  `pending` ditulis SEBELUM memanggil Telegram; bila proses mati di tengah jalan,
  percobaan ulang dengan kunci sama dijawab `502 outcome_unknown` dan TIDAK PERNAH
  meneruskan dua kali. Cek manual channel, lalu pakai `idempotencyKey` baru bila perlu.

## Kontrak

`POST /forward` `{ fromChatId, messageId, toChatId, idempotencyKey }`
(`-100...` string, int positif, kunci `[A-Za-z0-9:_-]{8,128}`):

| Status | Body |
|---|---|
| 200 | `{ ok:true, messageId, replay }` (`messageId` bisa `null` bila Telegram sukses tapi id tak terbaca) |
| 400 | `invalid_request` |
| 403 | `forbidden_chat` |
| 409 | `telegram_rejected` + `rpc` (nama error Telegram) + `retryAfter` (detik, bila FLOOD_WAIT) |
| 502 | `outcome_unknown` |
| 503 | `userbot_not_ready` |

`GET /health` -> `{ ok, ready }`.

## Login (sekali, dijalankan OWNER sendiri di Terminal)

```bash
cd tg-userbot && npm ci
node scripts/login.mjs --out ~/.axvara-tg-userbot.session
```

Skrip meminta API ID + API hash (dari https://my.telegram.org), nomor telepon, kode
login, dan password 2FA bila ada. Kode/password/session tidak pernah dicetak. Output
hanya `Session saved to <path>` dan nama depan akun. File session sama berharganya dengan
password akun: jangan commit, jangan kirim lewat chat.

## Deploy ke VPS

```bash
# di VPS (ec2-user)
mkdir -p ~/axvara-tg-userbot && cd ~/axvara-tg-userbot
# salin isi tg-userbot/ (tanpa node_modules) ke sini, lalu:
npm ci --omit=dev --ignore-scripts   # utf-8-validate opsional gagal compile di t4g.nano; tidak dibutuhkan
cp .env.example .env && chmod 600 .env     # isi TG_API_ID, TG_API_HASH, TG_ALLOW_*
scp ~/.axvara-tg-userbot.session ec2-user@<vps>:~/axvara-tg-userbot/session.string
chmod 600 session.string
which node   # sesuaikan ExecStart di unit bila bukan /usr/bin/node
sudo cp deploy/axvara-tg-userbot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now axvara-tg-userbot
curl -s http://127.0.0.1:8791/health       # {"ok":true,"ready":true}
```

Setelah itu deploy `wr-proxy` (route `/tgu/forward`, lihat `axvara-wr-proxy/AGENTS.md`).

## Cabut akses

Telegram -> Settings -> Devices -> pilih sesi userbot -> Terminate. Lalu
`sudo systemctl disable --now axvara-tg-userbot` dan hapus `session.string`.

## Test

```bash
npm test   # node:test, tanpa jaringan/Telegram
```
