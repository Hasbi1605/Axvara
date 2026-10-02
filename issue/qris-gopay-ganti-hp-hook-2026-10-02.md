# QRIS GoPay Merchant — ganti ketergantungan HP (DANA Hook) dengan mutasi GoBiz

## Latar Belakang
QRIS Axvara saat ini 100% bergantung pada aplikasi QRIS Hook di HP Android
(`POST /api/webhook/dana`): HP mati / notif telat / format teks DANA berubah =
order gagal lunas otomatis. Tombol ACC manual (2026-10-01) hanya perban.
Owner punya akun GoPay Merchant + QRIS statis sendiri. GoPay menyediakan feed
mutasi GoBiz yang bisa di-poll dari server — pola yang sama dengan AutoGoPay
(`POST /qris/generate` + poll 3 detik + webhook), tapi untuk pemakaian pribadi
1 akun dengan interval wajar 8–10 detik. `makeDynamicQris()` di
`src/lib/payments/dana-qris.ts` sudah generik EMVCo (tidak DANA-specific) dan
bisa dipakai langsung untuk payload GoPay.

## Tujuan
1. Order QRIS bisa terbit dari rail GoPay (payload statis GoPay + nominal unik
   + QR 15 menit) TANPA mengubah perilaku DANA live.
2. Pelunasan GoPay via poller server (VPS `wr-proxy.axvara.tech`, service
   terpisah) yang POST ke webhook internal Pages — HP boleh off.
3. Semua di balik flag default mati: `GOPAY_QRIS_ENABLED=false`,
   `QRIS_ACTIVE_PROVIDER=dana` (default = perilaku hari ini).

## Ruang Lingkup
- Generalisasi core: konstanta provider (`dana` | `gopay`), allocator nominal,
  matcher kausal + history check berlaku untuk kedua provider.
- `createGopayQrisInvoice()` = cermin `createDanaQrisInvoice()` dengan
  `provider='gopay'` (tabel + trigger + index yang sama, diperluas).
- Migrasi `0054_qris_gopay_provider.sql`: partial index aktif gopay, trigger
  history `IN ('dana','gopay')`, kolom `provider` di `dana_webhook_events`
  (default `'dana'`, tanpa rename tabel).
- Route `POST /api/webhook/gopay` (HMAC internal dari poller, bukan publik):
  dedup + exact-match + causal guard + `transitionPendingPaymentToPaid()` yang
  SAMA dengan webhook DANA.
- `GET /api/payments/qris/:code/image` + reissue berlaku untuk invoice gopay
  (ganti `provider='dana'` hardcode → provider order itu).
- Poller Node di VPS (folder baru `axvara-gopay-poller/`, systemd unit
  terpisah, env `chmod 600`): login GoBiz 1x (OTP manual), refresh token
  otomatis, poll 8–10 detik, POST match ke Pages.
- Env baru di `.env.example` (default mati) + Pages Secrets `secret_text`.

## Di Luar Scope
- ShopeePay (fase berikutnya, pola sama — scope store lebih rewel).
- Auto-fallback antar rail (manual via `QRIS_ACTIVE_PROVIDER` dulu).
- Multi-tenant / jual API key seperti AutoGoPay (personal 1 akun saja).
- Perubahan UI checkout (tetap 1 tombol QRIS).
- Perubahan perilaku DANA: semua test DANA existing harus hijau tanpa edit.

## Area / File Terkait
- `src/lib/payments/dana-qris.ts` (ekstrak core generik; JANGAN ubah signature
  publik yang dipakai test: `makeDynamicQris`, `parseDanaWebhook`,
  `createDanaQrisInvoice`, `reissueDanaQrisInvoice`)
- `src/lib/payments/dana-history.ts` (`DANA_AMOUNT_REUSED_SQL` → berlaku gopay)
- `src/lib/db/orders-transition.ts` (guard `pt.provider='dana'` → IN)
- `src/app/api/webhook/dana/route.ts` (cermin → `webhook/gopay/route.ts`)
- `src/app/api/orders/route.ts` (pilih rail via `QRIS_ACTIVE_PROVIDER`)
- `src/app/api/payments/qris/[code]/{image,reissue}/route.ts`
- `src/app/api/cron/operations/route.ts` (expiry `CASE provider='dana'`)
- `src/lib/telegram/invoice-retry.ts`, `qris-expiry-notifications.ts`
- `src/app/api/admin/payments/events/route.ts` (audit + retry per provider)
- `drizzle/schema.sql` + `drizzle/migrations/0054_qris_gopay_provider.sql`
- `.env.example`, `docs/{PRD,ARCHITECTURE}.md`, `README.md`, `CHANGELOG.md`
- Baru: `axvara-gopay-poller/` (folder sibling, AGENTS.md sendiri)

## Risiko
- Lib GoBiz unofficial (endpoint privat bisa berubah) → poller baca-only,
  `/health` + notif Telegram saat 401, JANGAN loop login brutal.
- Polling agresif = rate-limit/banned → interval 8–10 detik + throttle global
  via file lock, expiry 15 menit. Jangan tiru 3 detik AutoGoPay.
- Session/cookie bocor ke log/repo → simpan di `/opt/axvara/gopay/.session`
  (`chmod 600`), JANGAN di git, JANGAN di Pages Secrets (Pages Edge tanpa fs).
- Race webhook gopay vs expiry vs ACC manual → pakai guard atomik yang sama
  (`transitionPendingPaymentToPaid` return false = kalah race = 409 jujur).
- Nominal tabrakan antar provider (GoPay 15037 vs DANA 15037) → matcher WAJIB
  filter `provider` di SEMUA query kandidat + unique index per provider.
- Single VPS = single point of failure (WR + GoPay bareng) → systemd restart
  + healthcheck Telegram yang sudah ada; backup session harian (bukan ke git).

## Langkah Implementasi
### Fase 0 — Generalisasi tanpa ubah perilaku (PR 1)
1. Migrasi 0054 (index + trigger + kolom provider events default dana).
2. Ekstrak `QRIS_PROVIDERS = ['dana','gopay']`, helper `isQrisProvider()`;
   ganti hardcode `='dana'` → `IN (...)` di expiry/cron/retry/notif/admin
   (DANA tetap satu-satunya yang aktif → perilaku identik).
3. `createQrisInvoice(provider, ...)` generik; `createDanaQrisInvoice()` jadi
   wrapper tipis (signature tetap).
4. Test baru: invoice gopay terbit + matcher tolak nominal silang provider.
5. Docs + changelog + push (flag gopay mati → prod tidak berubah).

### Fase 1 — GoPay live personal (PR 2, setelah Fase 0 hijau + whitelist N/A)
1. Env + `isGopayQrisConfigured()` + `QRIS_ACTIVE_PROVIDER` switch di orders.
2. `POST /api/webhook/gopay` (secret poller `GOPAY_POLLER_SECRET`).
3. Poller VPS: login OTP sekali → session file → poll 8s → POST Pages.
4. Uji nominal kecil end-to-end (buat → bayar persis → paid tanpa HP).
5. Stabil 3–7 hari → `QRIS_ACTIVE_PROVIDER=gopay`, DANA jadi fallback.
6. Docs + changelog + push.

## Rencana Test
- Existing: 1806 test DANA + seluruh suite HARUS hijau tanpa edit
  (bukti generalisasi tidak mengubah perilaku).
- Baru `tests/qris-gopay-provider.test.ts`:
  - `makeDynamicQris` valid untuk fixture payload GoPay (CRC + tag 54).
  - create invoice gopay alokasi nominal unik, tidak tabrakan dana.
  - webhook gopay tolak nominal milik invoice dana (filter provider).
  - causal guard + amount-reused berlaku untuk gopay.
  - reissue gopay 1x, tolak saat invoice aktif.
- Manual: order kecil → bayar → `paid` + fulfillment + email, tanpa HP Hook.

## Kriteria Selesai
- [ ] Fase 0: test hijau, DANA live tidak berubah, docs + changelog + push main
- [ ] Fase 1: order GoPay end-to-end lunas tanpa HP, HP Hook boleh off
- [ ] Poller jalan 3–7 hari tanpa force-logout / rate-limit
- [ ] `QRIS_ACTIVE_PROVIDER` terdokumentasi + rollback 1 env ke `dana`
- [ ] Tidak ada secret/session di repo, log, atau Pages Secrets yang salah tipe
