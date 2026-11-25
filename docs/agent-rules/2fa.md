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
  record bentrok pada `2fa.axvara.tech`. Verifikasi live 25 November 2026:
  `GET https://2fa.axvara.tech/` HTTP 200 dengan CSP ketat dan
  `GET https://2fa.axvara.tech/api/time` mengembalikan `{"now":...}`.
- Konsolidasi tautan 2FA (keputusan owner 25 November 2026, Opsi B):
  - Migrasi idempoten `0167_axvara_2fa_links.sql` mengalihkan tujuan shortlink
    `otp-2fa` dan `otp-2fa-auth` pada `supplier_links` ke `https://2fa.axvara.tech/`
    (email/pesanan lama tetap hidup), memperbarui seluruh salinan produk/varian
    (`admin_activation*`, `admin_terms*`, `handover_template`, `description*`)
    dari `2fa.cn`/`2fa.live`/`2fa-auth.com`/`axvara.tech/go/otp-2fa*` menjadi
    `2fa.axvara.tech`, dan menyegarkan `catalog_revision_market`.
  - `src/lib/product-copy/format.ts` (`GO_OTP_2FA = AXVARA_2FA_HOST = "2fa.axvara.tech"`)
    otomatis me-rewrite seluruh situs generator TOTP pihak ketiga
    (`2fa.live`, `2fa.cn`, `2fa-auth.com`, `2fa.fb.rip`, `2fa.uno`, `2fa.zone`,
    `2fa.run`, `totp.danhersam.com`) dari teks mentah supplier langsung ke
    `2fa.axvara.tech`. Mailbox OTP email (`/go/otp*`, `tempmail.plus`, `dongvan`,
    dll.) tidak boleh diarahkan ke `2fa.axvara.tech`.
