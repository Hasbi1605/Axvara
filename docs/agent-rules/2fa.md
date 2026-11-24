# Aturan agent - AXVARA 2FA (`2fa.axvara.tech`)

## Keputusan owner 24 November 2026

- Layanan utilitas generator kode 2FA TOTP (RFC 6238 / RFC 4226) publik, tanpa
  login/admin, memakai pola Worker Static Assets terisolasi seperti
  `mail.axvara.tech` (`temp-mail/`).
- Domain publik: `https://2fa.axvara.tech` via custom domain di
  `2fa/wrangler.jsonc` (`name: "axvara-2fa"`). Tanpa database D1, tanpa KV,
  tanpa env/secret Pages baru, dan tidak mengubah rute/toko storefront.
- **Privasi & Zero-Knowledge (WAJIB):** seluruh perhitungan Base32/HMAC/TOTP
  wajib berjalan 100% di sisi browser memakai Web Crypto API (`crypto.subtle`).
  Jangan pernah mengirim secret key pembeli ke server, membaca secret dari URL
  query string (`?secret=...`), atau menambahkan endpoint generator server-side
  seperti `/tok/<secret>`.
- Satu-satunya endpoint server di `2fa/src/worker.mjs` adalah `GET/HEAD /api/time`
  (`{ now }`, `cache-control: no-store`) untuk koreksi *clock skew* perangkat.
- Antarmuka mengikuti gaya Midnight Liquid Glass AXVARA tanpa AI slop dan tanpa
  teks bantuan berlebih; wajib menjaga CSP ketat (`style-src 'self'`, tanpa
  `innerHTML`, inline `<script>`, atau atribut `style=`). Penyimpanan kunci
  opsional hanya di `localStorage` perangkat pengguna sendiri.

## Isolasi dan publikasi

- Source dan aset ada di `2fa/` tanpa dependency runtime tambahan.
- Publikasi hanya melalui `.github/workflows/ci.yml` pada push `main` memakai
  `temp-mail/node_modules/.bin/wrangler deploy --config 2fa/wrangler.jsonc`.
  Jangan deploy manual dengan Wrangler kecuali recovery eksplisit dari owner.
- Preflight DNS read-only 24 November 2026 (`dig` A/AAAA/CNAME) tidak menemukan
  record bentrok pada `2fa.axvara.tech`. Implementasi/QA lokal bukan bukti
  deployment live atau propagasi sertifikat custom domain.
- Link redirect storefront `/go/otp-2fa` dan `/go/otp-2fa-auth` tetap menunjuk
  tujuan existing hingga `2fa.axvara.tech` terverifikasi live dan owner
  menginstruksikan pengalihan.
