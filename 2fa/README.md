# AXVARA 2FA

Standalone Cloudflare Worker untuk generator kode 2FA TOTP (RFC 6238 / RFC 4226)
di `https://2fa.axvara.tech`. Semua perhitungan kode berjalan 100% lokal di
browser memakai Web Crypto API (`crypto.subtle`) — secret key tidak pernah
dikirim ke server, disimpan di database, atau tercatat di URL.

## Cara kerja
- `2fa/src/worker.mjs`: melayani aset statis dari `2fa/public/` dengan header
  keamanan ketat (CSP `default-src 'self'; style-src 'self'`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`) serta endpoint ringan `GET/HEAD /api/time`
  (`{ now }`, `cache-control: no-store`) untuk koreksi *clock skew* perangkat.
- `2fa/public/totp.js`: implementasi murni RFC 4648 Base32 dan RFC 6238 TOTP
  (`SHA-1`, `SHA-256`, `SHA-512`; `6/7/8` digit; interval `15/30/60` detik) plus
  parser untuk secret tunggal, URI `otpauth://totp/...`, dan mode multi-baris
  (termasuk format `email|password|secret` tanpa menampilkan segmen password).
- `2fa/public/app.js`: antarmuka AXVARA Liquid Glass tanpa ketergantungan
  eksternal; opsi penyimpanan kunci lokal opsional di `localStorage` perangkat
  pengguna sendiri.

## Perintah lokal (dari root repo)
```bash
# Dev server lokal Worker
temp-mail/node_modules/.bin/wrangler dev --config 2fa/wrangler.jsonc

# Dry-run bundle tanpa mutasi Cloudflare
temp-mail/node_modules/.bin/wrangler deploy --dry-run --config 2fa/wrangler.jsonc

# Tes fokus 2FA
npx vitest run tests/axvara-2fa-totp.test.ts tests/axvara-2fa-worker.test.ts tests/axvara-2fa-ui.behavior.test.ts
```

## Publikasi
Rilis hanya melalui `.github/workflows/ci.yml` saat push ke `main` (memakai
`temp-mail/node_modules/.bin/wrangler deploy --config 2fa/wrangler.jsonc`).
Domain publik `2fa.axvara.tech` dideklarasikan sebagai Worker custom domain di
`2fa/wrangler.jsonc` — tanpa database D1, tanpa KV, dan tanpa env/secret Pages baru.
