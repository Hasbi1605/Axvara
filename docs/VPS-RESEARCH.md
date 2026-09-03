# VPS-RESEARCH.md — Riset VPS & Hosting Gratis untuk AXVARA

**Tanggal Riset:** 31 Agustus 2026  
**Kebutuhan AXVARA:** Toko digital kecil-menengah (8–50 produk, 0–5000 visitor/hari, foto + bukti transfer)  
**Kriteria:** Gratis (atau trial panjang), tanpa kartu kredit jika bisa, bandwidth cukup, tidak sleep, deploy mudah  

---

## Ringkasan Eksekutif

> **Rekomendasi utama untuk AXVARA: Cloudflare Pages + D1 + R2 (GRATIS selamanya, tanpa kartu kredit, tanpa VPS).**  
> Oracle Free Tier adalah juara spek, tapi kamu sudah ditolak — jadi Pages adalah pengganti paling ideal dan justru lebih simpel (tanpa ngurus Linux).

---

## 1. Cloudflare Pages + D1 + R2 — REKOMENDASI UTAMA ⭐

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis selamanya (Free plan) |
| **Daftar** | Email saja, **tanpa kartu kredit** |
| **Bandwidth** | **Unlimited** — tidak ada tagihan kejutan |
| **Build** | 500 builds/bulan, 20k files/build |
| **CDN** | 300+ PoP global, cache otomatis di Indonesia |
| **Custom Domain** | Gratis, SSL auto |
| **Database** | D1 (SQLite) — 5GB storage, 5M reads/hari gratis |
| **Storage File** | R2 — 10GB storage, 10M Class A ops gratis |
| **Functions** | Workers/Pages Functions — 100k req/hari gratis |
| **Kelebihan** | Tanpa ngurus server, deploy via git push, super cepat, tidak sleep |
| **Kekurangan** | Bukan VPS tradisional (tidak bisa install apt, docker, dll) — tapi untuk toko Next.js justru kelebihan |
| **Cocok untuk AXVARA?** | **SANGAT COCOK** — stack ideal |

**Limit yang perlu diperhatikan:**
- Pages Function max 50ms CPU (cukup untuk CRUD), D1 max 10GB per DB
- Untuk AXVARA MVP (ratusan produk, ribuan order) **tidak akan habis**

**Cara daftar:** https://pages.cloudflare.com → Sign up → Connect GitHub → Deploy

---

## 2. Oracle Cloud Free Tier — Juara Spek, Tapi Sering Ditolak

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis selamanya (Always Free) |
| **Spek** | 4 OCPU ARM Ampere + 24GB RAM + 200GB storage (2x VM) |
| **Bandwidth** | 10TB/bulan |
| **Kelebihan** | Spek VPS gratis paling gahar di dunia, setara VPS Rp 400rb/bulan |
| **Kekurangan** | **Wajib kartu kredit/debit (Jenius/Blu/BCA) untuk verifikasi**, sering auto-reject (kasus kamu), verifikasi manual lama, instance bisa di-reclaim jika idle, harus bisa Linux |
| **Status kamu** | **DITOLAK** — tidak usah dipaksa, ada alternatif lebih simpel |
| **Cocok untuk AXVARA?** | Overkill, ribet |

**Tips jika tetap mau coba:** pakai kartu Jenius/Blu, alamat sesuai KTP, IP Indonesia, jangan pakai VPN. Tapi untuk AXVARA, skip saja.

---

## 3. Alternatif Gratis Lain

### 3.1 Vercel (Free) — Runner-up Simpel

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis (Hobby) |
| **Bandwidth** | 100GB/bulan (cukup untuk toko kecil, tapi tidak unlimited seperti Cloudflare) |
| **Database** | Butuh Neon/Supabase terpisah (gratis ada limit) |
| **Kelebihan** | Deploy Next.js 1 klik, paling mudah, preview URL |
| **Kekurangan** | Bandwidth terbatas, storage butuh layanan lain, build 100 jam/bulan |
| **Cocok?** | Cocok, tapi Cloudflare lebih royal untuk bandwidth + R2 |

### 3.2 Google Cloud Free Tier (e2-micro)

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis selamanya (1 VM e2-micro US) |
| **Spek** | 0.25–0.5 vCPU, 1GB RAM, 30GB disk |
| **Kekurangan** | Spek kecil, region US (latensi ke Indonesia tinggi), wajib kartu kredit, lemot jika rame |
| **Cocok?** | Kurang, spek terlalu kecil untuk toko yang ingin cepat |

### 3.3 Fly.io / Render / Railway / Koyeb

| Aspek | Detail |
|-------|--------|
| **Harga** | Free tier dengan credit $5–$10/bulan atau trial |
| **Kekurangan** | App akan **sleep** jika tidak ada traffic → pembeli pertama loading 10–30 detik (buruk untuk toko), credit habis harus bayar |
| **Cocok?** | Tidak untuk toko produksi — sleep = kehilangan pembeli |

### 3.4 InfinityFree / 000WebHost / AwardSpace

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis tapi dengan iklan, batasan PHP, no custom domain SSL proper |
| **Kekurangan** | Lemot, sering down, tidak profesional, tidak ada Node.js/Next.js |
| **Cocok?** | **JANGAN** — merusak brand premium AXVARA |

### 3.5 GitHub Pages / Netlify Free

| Aspek | Detail |
|-------|--------|
| **Harga** | Gratis |
| **Kekurangan** | Hanya static (tanpa DB/API), Netlify Functions terbatas, bandwidth Netlify 100GB |
| **Cocok?** | Hanya untuk landing page, tidak untuk toko dengan checkout + upload bukti |

---

## 4. Perbandingan Ringkas

| Provider | Kartu Kredit? | Bandwidth | DB Gratis | Storage Gratis | Sleep? | Kemudahan | Skor AXVARA |
|----------|:---:|-----------|-----------|---------------|:---:|-----------|-------------|
| **Cloudflare Pages+D1+R2** | ❌ Tidak | Unlimited | 5GB | 10GB | Tidak | ⭐⭐⭐⭐⭐ | **9.5/10** |
| Vercel + Neon | ❌ | 100GB | 512MB | - | Tidak | ⭐⭐⭐⭐⭐ | 8.5/10 |
| Oracle Always Free | ✅ Wajib | 10TB | - (install sendiri) | 200GB | Tidak (tapi reclaim) | ⭐⭐ | 8/10 (tapi ditolak) |
| GCP e2-micro | ✅ | 1GB egress | - | 30GB | Tidak | ⭐⭐ | 6/10 |
| Fly.io / Render Free | ❌/✅ | Kecil | - | - | **Ya** | ⭐⭐⭐ | 5/10 |
| InfinityFree | ❌ | Kecil | MySQL kecil | Kecil | Tidak | ⭐⭐ | 2/10 |

---

## 5. Rekomendasi Final untuk AXVARA

**Pakai Cloudflare Pages + D1 + R2.**

Alasan:
1. Kamu ditolak Oracle — Pages tanpa kartu kredit langsung jalan
2. Toko digital butuh **cepat & tidak sleep** — Pages CDN di Indonesia <50ms
3. Upload bukti & foto produk butuh storage — R2 10GB gratis (cukup untuk 20.000+ foto bukti)
4. Tanpa ngurus server — kamu fokus jualan, bukan jadi sysadmin
5. Biaya Rp 0/bulan selama memakai axvara.pages.dev; custom domain axvara.tech dipasang nanti

**Jika nanti AXVARA rame banget (>50k visitor/hari):** upgrade ke Cloudflare Pro $20/bulan atau pindah ke VPS berbayar (Contabo $5/bulan, Vultr $6/bulan) — tapi itu nanti, bukan sekarang.

**Domain:** Beli di Cloudflare Registrar (paling murah, integrasi langsung), bukan Niagahoster/Hostinger yang markup.

---

## 6. Sumber

- Cloudflare Pages Pricing: https://pages.cloudflare.com/#pricing
- Cloudflare D1 Pricing: https://developers.cloudflare.com/d1/pricing/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Oracle Free Tier: https://www.oracle.com/cloud/free/
- Vercel Pricing: https://vercel.com/pricing
- Riset dilakukan 31 Agustus 2026 — harga dapat berubah, cek link resmi sebelum deploy
