# Rencana Migrasi Adapter Cloudflare — next-on-pages → OpenNext (Workers)

**Status:** RENCANA — belum dieksekusi. Implementasi adalah pekerjaan tersendiri setelah rancangan dan cakupannya ditinjau pemilik.
**Tanggal:** 7 September 2026
**Pemicu (issue #17):** `@cloudflare/next-on-pages` 1.13.x **ARCHIVED + deprecated** (repo `cloudflare/next-on-pages`, PR #986, Sep 2025). Jalur resmi pengganti: **`@opennextjs/cloudflare`** (v1.20.6 saat riset; adapter 1.0-beta Apr 2025, kini arus utama di docs Cloudflare Workers).
**Catatan penting hasil riset:** Pages TIDAK dimatikan — tetap didukung penuh, tanpa deadline migrasi paksa. Alasan migrasi di sini adalah adapter yang diarsipkan (risiko: tidak ada patch keamanan/fitur Next baru), bukan Pages yang ditutup. Migrasi target = **Workers + Static Assets** (satu deployment frontend + API), bukan pindah cloud.

---

## 1. Kondisi saat ini (terverifikasi di repo)

| Aspek | Kondisi |
|---|---|
| Adapter | `@cloudflare/next-on-pages` 1.13 (devDep), script `build:pages` → output `.vercel/output/static` |
| Deploy | `wrangler pages deploy` via `.github/workflows/ci.yml` (test → tsc → build Pages → migrasi D1 → deploy Pages → deploy MCP Worker) |
| Runtime route | **49 file** memakai `export const runtime = "edge"` (43 route API + 4 page + mcp + r2) |
| Binding D1/R2 | Diakses via `globalThis`/`process.env` (`getD1()` di `src/lib/db.ts`, `getR2Bucket()` di `src/lib/r2.ts`) — pola warisan next-on-pages, BUKAN `getRequestContext` (tidak ada import `@cloudflare/next-on-pages` di `src/`) |
| Cron | MCP Worker terpisah (`mcp-worker/`, `*/5 * * * *`) memanggil `/api/cron/*` via HTTP — TIDAK memakai cron trigger Pages (Pages memang tidak mendukung cron trigger; Workers mendukung) |
| Node API | `compatibility_flags: ["nodejs_compat"]` sudah aktif di `wrangler.json` |
| Middleware | `src/middleware.ts` (CSP + CSRF origin check) — didukung OpenNext |
| Next | 15.5.24 — didukung penuh OpenNext (semua minor 15 + 16; Next 14 drop Q1 2026) |

Keuntungan posisi awal: **tidak ada** `getRequestContext`, `setupDevPlatform()`, atau eslint-plugin next-on-pages di `src/` — tiga hal yang paling menyakitkan saat migrasi sudah tidak ada.

---

## 2. Target akhir

| Aspek | Sesudah |
|---|---|
| Adapter | `@opennextjs/cloudflare` (^1.x) |
| Build | `opennextjs-cloudflare build` → `.open-next/` (`worker.js` + `assets/`) |
| Deploy | `opennextjs-cloudflare deploy` (atau `wrangler deploy`) ke **Workers + Static Assets** — satu Worker melayani frontend + API |
| Binding | `getCloudflareContext().env.DB` / `.env.R2_ASSETS` (sync di route dinamis, `{ async: true }` di route statis/SSG) |
| Runtime route | Hapus `export const runtime = "edge"` dari 49 file — OpenNext hanya mendukung **Node runtime** (edge runtime Next TIDAK didukung; untungnya Workers tetap dekat-pengguna sehingga latensi setara) |
| Dev lokal | `initOpenNextCloudflareForDev()` di `next.config.mjs` agar `next dev` tetap melihat binding D1/R2 lokal |
| Cron | Tetap via MCP Worker HTTP (tidak berubah) — ATAU pindahkan ke cron trigger native Workers (opsional, tahap 2) |
| Domain | `axvara.tech` + `www` dipindah dari Pages custom domain ke Workers custom domain/route; `axvara.pages.dev` tetap redirect (dipertahankan sampai stabil) |

---

## 3. Perubahan file per file (cakupan implementasi)

### 3.1 Wajib — build & deploy
1. `package.json` — hapus `@cloudflare/next-on-pages`; tambah `@opennextjs/cloudflare`; script: `build:pages` → `preview`/`deploy`/`cf-typegen` (`opennextjs-cloudflare build/preview/deploy`); tambah `open-next.config.ts` (`defineCloudflareConfig()` default, tanpa R2 cache dulu).
2. `wrangler.json` — tulis ulang: `main: .open-next/worker.js`, `assets: { directory: .open-next/assets, binding: ASSETS }`, pertahankan `d1_databases` (DB/axvara-db/c21453bf…) + `r2_buckets` (R2_ASSETS/axvara-assets) + `nodejs_compat`; tambah `services: [{ binding: WORKER_SELF_REFERENCE, service: axvara }]`; hapus `pages_build_output_dir`.
3. `.github/workflows/ci.yml` — ganti `npm run build:pages` → `opennextjs-cloudflare build`; ganti `wrangler pages deploy` → `opennextjs-cloudflare deploy` (atau `wrangler deploy`); migrasi D1 + deploy MCP Worker tetap.
4. `next.config.mjs` — tambah `initOpenNextCloudflareForDev()` (bawah file, tanpa await); hapus workaround `webpack.cache = false` khusus Pages 25 MiB (Workers punya batas berbeda — ukur ulang saat migrasi).

### 3.2 Wajib — akses binding (2 file inti + 49 route)
5. `src/lib/db.ts` — `getD1()` dibaca dari `getCloudflareContext().env.DB` (dengan fallback `globalThis`/`process.env` selama masa transisi agar dev lama tetap jalan); sediakan varian async untuk route statis.
6. `src/lib/r2.ts` — pola sama untuk `R2_ASSETS`.
7. 49 file `src/app/**/route.ts|page.tsx` — hapus `export const runtime = "edge"`. Ini perubahan mekanis terbesar tapi nol-logika (satu baris per file, bisa codemod + review diff).

### 3.3 Tidak berubah
- `drizzle/*` (skema + 16 migrasi) — D1 database yang SAMA dipakai ulang, tanpa migrasi data.
- `mcp-worker/` — Worker terpisah, tidak tersentuh (kecuali bila cron dipindah ke trigger native — tahap 2).
- Seluruh logika bisnis (`src/lib/*`, webhook, fulfillment, bot) — nol perubahan perilaku.
- DNSSEC, WAF rule, secrets Pages → dipetakan ulang sebagai secrets/vars Worker (nilai sama, nama sama).

---

## 4. Risiko + mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | `wrangler pages deploy` → `wrangler deploy` salah sasaran (Workers ≠ Pages) | Downtime / deploy ke proyek kosong | Deploy pertama ke **nama Worker baru** (`axvara-worker`), verifikasi penuh, BARU pindahkan domain. Proyek Pages lama JANGAN dihapus sebelum 7 hari stabil. |
| R2 | 49 route kehilangan `runtime=edge` sekaligus | Perilaku Node vs Edge berbeda (mis. `crypto`, `TextEncoder`, batas CPU 30 dtk → 30 dtk Workers tetap) | `nodejs_compat` sudah aktif; audit satu-per-satu pemakaian API Node di route (sudah Edge-safe sejak awal — komentar `db.ts` menegaskan tanpa fs/better-sqlite3); uji 56 Edge routes via `preview` (workerd lokal, akurat produksi). |
| R3 | Binding DB/R2 kosong di produksi (env salah petik) | Seluruh API 500 | `wrangler types` → `cloudflare-env.d.ts`; smoke test `/api/products?active=1` + `/api/catalog?slug=` + checkout quote di preview SEBELUM pindah domain; pola fallback berlapis di `getD1()` memberi error eksplisit, bukan undefined samar. |
| R4 | Aset statis tidak ketemu (`assets.directory` salah) | Halaman blank / 404 massal | `opennextjs-cloudflare preview` lokal dulu; cek `/`, `/produk/[slug]`, CSS, gambar R2; `_headers`/`_redirects` di `public/` TIDAK terbawa otomatis ke Workers — ganti dengan blok `[assets]` + Transform Rules (sudah diinventarisasi: redirect `www`→apex, `pages.dev`→apex). |
| R5 | Middleware CSP/CSRF berperilaku beda (aset didahulukan Worker kecuali `run_worker_first`) | Header keamanan hilang di aset statis | Set eksplisit `assets.run_worker_first` sesuai kebutuhan; verifikasi header via curl pada rute statis + API. |
| R6 | MCP Worker cron URL berubah bila domain pindah | Order kedaluwarsa tidak diproses | `AXVARA_API_ORIGIN` + `CRON_SECRET` tidak berubah nilainya; cukup pastikan domain baru menjawab `/api/cron/*` 401-tanpa-secret/200-dengan-secret sebelum mematikan Pages. |
| R7 | Rollback rumit bila Workers gagal di produksi | Downtime panjang | Lihat §6 — rollback = kembalikan DNS ke Pages (proyek Pages dipertahankan), tanpa deploy ulang. |

---

## 5. Urutan eksekusi (pekerjaan tersendiri, 4 tahap)

- **Tahap A — persiapan tanpa risiko (bisa sekarang):** pasang `@opennextjs/cloudflare` berdampingan, buat `open-next.config.ts` + `wrangler.json` baru (nama Worker baru), JANGAN ubah CI. Hasil: `preview` lokal jalan di workerd.
- **Tahap B — porting kode:** ubah `db.ts`/`r2.ts` (dengan fallback), hapus 49× `runtime=edge` via codemod, `initOpenNextCloudflareForDev()`. Verifikasi: vitest + tsc + `preview` + Obscura penuh + 373 test hijau.
- **Tahap C — deploy bayangan:** CI deploy ke Worker baru (domain `*.workers.dev`); smoke test produksi-bayangan: katalog, PDP, checkout quote, webhook (secret header), cron manual, admin login; bandingkan respons Pages vs Workers.
- **Tahap D — cutover:** pindahkan custom domain `axvara.tech` ke Worker; pantau 24–72 jam (order, webhook DANA, cron, fulfillment); hapus proyek Pages HANYA setelah stabil 7 hari.

---

## 6. Strategi rollback

1. **Cutover hanyalah perubahan DNS/custom-domain** (Pages ↔ Workers), bukan deploy ulang — kedua proyek hidup berdampingan selama jendela 7 hari.
2. Bila anomali: kembalikan custom domain ke proyek Pages lama di dashboard (< 5 menit), investigasi di Worker tanpa tekanan.
3. Bila data tercemar (seharusnya tidak — D1 yang sama, tanpa migrasi skema): D1 Time Travel (7 hari di Free) untuk point-in-time recovery.
4. Kriteria abort cutover: error rate API > 1% selama 15 menit, webhook DANA gagal 3x beruntun, atau cron 2x run tanpa hasil.

---

## 7. Keputusan yang butuh pemilik (ditunda sampai implementasi)

- [ ] Nama Worker produksi (`axvara` vs `axvara-worker`) dan subdomain `workers.dev`.
- [ ] Apakah cron pindah ke trigger native Workers (tahap 2) atau tetap via MCP Worker HTTP (rekomendasi: tetap — sudah terbukti stabil).
- [ ] Jadwal jendela cutover (rekomendasi: malam WIB, trafik rendah) + siapa standby verifikasi order masuk.
- [ ] Apakah incremental cache R2 (`NEXT_INC_CACHE_R2_BUCKET`) diaktifkan (rekomendasi: tidak dulu — cache publik 30/60 dtk saat ini sudah cukup).

---

## Referensi (diverifikasi 7 Sep 2026)

- Repo `cloudflare/next-on-pages` — ARCHIVED, README mengarah ke OpenNext (PR #986).
- `opennext.js.org/cloudflare/get-started` — panduan `migrate`, `wrangler.jsonc`, `open-next.config.ts`, `initOpenNextCloudflareForDev()`, §11 penghapusan next-on-pages.
- `developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages` — langkah Pages→Workers, `_headers`/`_redirects` tidak terbawa, `run_worker_first`, hapus proyek Pages terakhir.
- `developers.cloudflare.com/workers/framework-guides/web-apps/opennext` — matriks fitur (App Router/SSR/ISR/middleware ✅; Node-in-middleware ❌ — tidak dipakai AXVARA), skrip preview/deploy/cf-typegen.
- `opennext.js.org/cloudflare/bindings` + `howtos/db` — `getCloudflareContext().env.*`, mode `{ async: true }` untuk SSG.
- Komunitas (oriz.in, mecanik.dev, Mei–Jun 2026): Pages freeze fitur sejak Apr 2025, tetap didukung; migrasi hanya bila ada alasan konkret — di sini alasannya adapter yang diarsipkan.
