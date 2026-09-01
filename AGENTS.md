# AGENTS.md — AXVARA (Project-Specific)

> ⚠️ Scope: aturan ini **HANYA untuk folder `axvara/`**.
> Jangan ubah `/Users/macbookair/AGENTS.md` global. File ini adalah source of truth untuk agent yang kerja di project AXVARA.

## Tujuan
AXVARA — Gerbang Semua Tools Premium. Toko digital premium Apple Store + glassmorphism, checkout Transfer/QRIS statis, hosting Cloudflare Pages + D1 + R2. Workflow: plan → implementasi kecil → verifikasi dev → catat changelog → selesai.

## WAJIB dibaca dulu (context)
Sebelum ubah kode di `axvara/`, baca:
1. `docs/PRD.md` — requirement, flow, payment spec (E-Wallet 082135277434, SeaBank 901812349386, QRIS Brotherstore06)
2. `docs/DESIGN.md` — token Midnight #080C1E/#070a1e + Cyan #00E5FF + Gold #FFB800, SF Pro, Liquid Glass
3. `docs/ARCHITECTURE.md` — stack Next 14 + Pages + D1 + R2, schema, API contract, wrangler
4. `README.md` — struktur, brand, cara jalan & deploy
5. `CHANGELOG.md` (root `axvara/`) — riwayat perubahan, baca dulu biar tidak duplikasi

Jika perubahan mengubah struktur folder, route `src/app/*`, komponen `src/components/storefront/*`, `drizzle/schema.sql`, `wrangler.toml`, atau flow checkout/admin, **perbarui `docs/ARCHITECTURE.md` dan `README.md` di PR yang sama**.

## Cara bekerja
- Perubahan sekecil mungkin yang tetap selesaikan masalah.
- Jangan refactor besar tanpa diminta.
- Jika ragu, tulis asumsi eksplisit di `CHANGELOG.md` atau komentar PR.

## Aturan Changelog (WAJIB — khusus axvara)
Setiap kali ubah kode/docs di `axvara/`, **WAJIB catat di `axvara/CHANGELOG.md`** (bukan di AGENTS.md global):

- Tambah entri baru di **paling atas** (terbaru di atas), append-only, jangan hapus entri lama.
- Format: `- YYYY-MM-DD — <ringkas perubahan> — <file/area utama> — (verifikasi: <hasil>)`
- Satu entri per perubahan logis. Ringkas, faktual, sebut file/area.
- Contoh: `- 2026-08-31 — Pasang logo Prism wireframe di Navbar/Footer — public/brand/axvara-mark.svg, src/components/storefront/Navbar.tsx — (verifikasi: dev GET / 200, CSS 200, build pass)`
- Changelog melengkapi `issue/` — ia adalah indeks ringkas semua perubahan axvara.

## Verifikasi WAJIB (dev-only, tanpa build tiap kali)
**Jangan wajib `npm run build` setiap perubahan.** Cukup `npm run dev` — build hanya sebelum deploy/major change.
**Wajib pakai Chrome DevTools MCP** untuk verifikasi visual/fungsional (bukan Playwright MCP). Aktifkan via skill `chrome-devtools`.

1. Jalankan dev **dari folder yang benar** (wajib):
   ```bash
   cd /Users/macbookair/axvara
   node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
   ```
   Jangan dari `/Users/macbookair` (akan `Missing script: dev` → 500).

2. Jika port 3000 macet/CSS 404 (`GET /_next/static/css/app/layout.css 404` / `ENOENT vendor-chunks`):
   ```bash
   lsof -ti:3000 | xargs kill -9 2>/dev/null; rm -rf .next; node ./node_modules/next/dist/bin/next dev --port 3000 --hostname 127.0.0.1 > /tmp/axvara-dev.log 2>&1 &
   ```

3. Verifikasi ringan (wajib sebelum anggap selesai):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/  # harus 200
   curl -s http://127.0.0.1:3000/ | grep -o 'href="[^"]*\.css[^"]*"' | head -1
   curl -s "http://127.0.0.1:3000/_next/static/css/app/layout.css?v=xxxx" -o /dev/null -w "%{http_code}\n" # harus 200
   tail -20 /tmp/axvara-dev.log  # Ready in ... / Compiled / GET / 200
   ```

4. Hanya jalankan `npm run build` jika:
   - Mau deploy ke Pages
   - Ubah `next.config.mjs`, `tailwind.config.ts`, `tsconfig`, atau routing besar
   - Verifikasi akhir sebelum merge

## Sebelum menyelesaikan percakapan (checklist)
Agent **wajib** pastikan sebelum jawab "selesai":
- [ ] `CHANGELOG.md` sudah di-update (entri paling atas)
- [ ] Halaman jalan: `GET / 200` dan CSS `200` dari `http://127.0.0.1:3000` (atau `http://localhost:3000`)
- [ ] Tidak ada error `Compiled` di `/tmp/axvara-dev.log`
- [ ] Jika ubah struktur/flow, `docs/ARCHITECTURE.md`/`README.md` ikut di-update
- [ ] Jangan pernah ubah `/Users/macbookair/AGENTS.md` global

## Done when
- Tujuan tugas tercapai
- Perubahan diimplementasi
- `CHANGELOG.md` terisi
- Verifikasi dev (GET / 200 + CSS 200) jelas
- Risiko/tindak lanjut diringkas
