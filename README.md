# AXVARA — Gerbang Semua Tools Premium

AXVARA adalah platform untuk produk dan layanan digital:

- [Market](https://axvara.tech) — akun, aplikasi, dan tools premium.
- [Pedia](https://pedia.axvara.tech) — layanan media sosial.
- [Games](https://games.axvara.tech) — top up game.

Aplikasi web memakai Next.js dan TypeScript. Produksi berjalan di Cloudflare
Pages dengan D1 untuk database dan R2 untuk penyimpanan aset.

## Jalankan lokal

Siapkan **Node.js 22** (versi yang dipakai CI) dan npm. Dari root repo:

```bash
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Buka [http://127.0.0.1:3000](http://127.0.0.1:3000). Mode dev memakai hot
reload; tidak perlu build setiap kali mengubah file. Tanpa binding D1, katalog
Market memakai data contoh di memori. Ini cukup untuk melihat storefront,
bukan untuk menguji integrasi produksi. Jika tugas memerlukan konfigurasi
lokal, gunakan [`.env.example`](.env.example) sebagai referensi dan jangan
commit `.env.local` atau kredensial.

Untuk menjalankan tes aplikasi secara lokal:

```bash
npm test
```

Lihat [aturan verifikasi](AGENTS.md#verifikasi-wajib-berdasarkan-dampak-perubahan)
untuk memilih pemeriksaan sesuai jenis perubahan.

## Struktur repo

| Path | Isi |
|---|---|
| [`src/app/`](src/app/) | Halaman Market, Pedia, Games, admin, dan route API |
| [`src/components/`](src/components/) | Komponen antarmuka pembeli dan admin |
| [`src/lib/`](src/lib/) | Logika bisnis, pembayaran, supplier, dan integrasi |
| [`drizzle/`](drizzle/) | Skema dan migrasi D1 |
| [`mcp-worker/`](mcp-worker/) | Cloudflare Worker untuk cron dan antrean fulfillment |
| [`gateway/`](gateway/) | Gateway WhatsApp |
| [`temp-mail/`](temp-mail/) | Layanan email sementara yang terisolasi |
| [`tests/`](tests/) | Tes aplikasi dan integrasi |

## Panduan rilis dan operasi

Rilis normal lewat [GitHub Actions](.github/workflows/ci.yml) saat push ke
`main`. Push yang diterima GitHub bukan bukti deployment berhasil. Untuk
konfigurasi, rollback, dan prosedur operasi, lihat
[Panduan Operasi](docs/PAID-OPERATIONS.md) dan
[aturan platform](docs/agent-rules/platform-ops.md).

## Dokumentasi

| Jika mencari… | Buka |
|---|---|
| Aturan kontribusi dan indeks aturan per area | [AGENTS.md](AGENTS.md) |
| Requirement, alur pembeli, dan ketentuan produk | [PRD](docs/PRD.md) |
| Desain, brand, dan komponen | [DESIGN](docs/DESIGN.md) |
| Arsitektur, skema, kontrak API, dan konfigurasi Cloudflare | [ARCHITECTURE](docs/ARCHITECTURE.md) |
| Spesifikasi Pedia dan Games | [Pedia PRD](docs/PEDIA-PRD.md), [Pedia Design](docs/PEDIA-DESIGN.md), [Games](docs/GAMES.md) |
| Pengembangan gateway WhatsApp dan temp mail | [Gateway](gateway/AGENTS.md), [Temp Mail](temp-mail/README.md) |
| Riwayat perubahan | [CHANGELOG.md](CHANGELOG.md) |

README ini hanya untuk orientasi dan cara mulai. Catat perubahan di
[CHANGELOG.md](CHANGELOG.md) dan perbarui kontrak di dokumen topik terkait;
jangan menambahkan catatan historis atau status rilis bertanggal di sini.
