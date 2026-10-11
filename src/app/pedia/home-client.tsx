"use client";

import { useState } from "react";
import Link from "next/link";
import { LinkPasteHero } from "@/components/pedia/LinkPasteHero";
import { PEDIA_PLATFORMS, PlatformIcon, ProductCard, catalogCard } from "@/components/pedia/PlatformGrid";
import type { PediaLinkDetect } from "@/lib/pedia/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const FAQ = [
  { q: "Bagaimana cara memesan?", a: "Pilih layanan, paket, dan jumlah. Masukkan tautan tujuan serta kontak, periksa harga, lalu lanjutkan ke pembayaran QRIS." },
  { q: "Kapan pesanan mulai diproses?", a: "Estimasi mulai dan selesai mengikuti paket yang dipilih. Keduanya ditampilkan sebelum pembayaran; estimasi bukan jaminan waktu selesai." },
  { q: "Apa yang dimaksud refill?", a: "Refill adalah pengisian ulang jumlah yang turun, sesuai syarat dan masa berlaku paket. Tidak semua paket menyediakan refill. Baca Ketentuan Pedia sebelum memesan." },
  { q: "Bagaimana jika pesanan hanya selesai sebagian atau dibatalkan?", a: "Nilai bagian yang tidak diproses menjadi Kode Kredit Pedia, bukan pengembalian tunai. Kode berlaku 180 hari untuk pemesanan Pedia berikutnya dan dikirim melalui email serta halaman pesanan." },
  { q: "Apakah perlu memberikan password akun?", a: "Tidak. Pesanan menggunakan tautan profil atau konten. Akun atau konten harus dapat diakses publik dan memenuhi persyaratan layanan yang dipilih." },
];

export function PediaHomeClient({ products, ordersEnabled = false }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  const [platform, setPlatform] = useState("");
  const [query, setQuery] = useState("");
  const filtered = products.filter((p) => (!platform || p.platform === platform) && p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const suggestionsFor = (d: PediaLinkDetect) => products.filter((p) => p.platform === d.platform &&
    (p.target_kind === d.targetKind || (["video", "post", "reel"].includes(p.target_kind) && ["video", "post", "reel"].includes(d.targetKind)) ||
      (p.target_kind === "profile" && d.targetKind === "channel")))
    .map((p) => ({ slug: p.slug, name: p.name, minPrice: p.min_price, target: d.normalized }));

  return <div className="py-8 sm:py-12">
    <header className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#00E5FF]">AXVARA PEDIA</p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">Layanan media sosial</h1>
      <p className="mt-3 text-base leading-relaxed text-white/70">Pilih followers, likes, atau views berdasarkan platform. Bandingkan paket, jumlah, dan ketentuannya sebelum memesan.</p>
    </header>
    {!ordersEnabled && <p role="status" className="mt-6 border-l-2 border-[#00E5FF]/60 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-white/75"><strong className="font-semibold text-white">Pemesanan belum tersedia.</strong> Katalog dan harga paket dapat dilihat.</p>}

    <section aria-labelledby="pedia-catalog-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 id="pedia-catalog-heading" className="text-xl font-semibold text-white">Pilih layanan</h2><p className="mt-1 text-sm text-white/60">Harga awal selalu disertai jumlah paketnya.</p></div>
        <label className="w-full text-sm text-white/70 sm:w-64">Cari layanan<input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Nama layanan" className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-white/[0.03] px-3 text-base text-white placeholder:text-white/40" /></label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Filter platform">
        <button type="button" aria-pressed={!platform} onClick={() => setPlatform("")} className={`min-h-11 rounded-lg border px-3 text-sm ${!platform ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}>Semua</button>
        {PEDIA_PLATFORMS.filter((p) => products.some((product) => product.platform === p.id)).map((p) => <button key={p.id} type="button" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${platform === p.id ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}><PlatformIcon id={p.id} size={18} />{p.label}</button>)}
      </div>
      <p role="status" className="mt-4 text-xs text-white/60">{filtered.length} layanan</p>
      {filtered.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((p) => <ProductCard key={p.slug} p={catalogCard(p)} />)}</div> : <div className="mt-3 rounded-xl border border-white/15 p-6 text-sm text-white/70"><p>{products.length ? "Tidak ada layanan yang sesuai pencarian." : "Layanan belum tersedia. Coba kembali nanti atau hubungi bantuan."}</p>{products.length > 0 && <button type="button" onClick={() => { setQuery(""); setPlatform(""); }} className="mt-3 min-h-11 text-[#00E5FF]">Reset pencarian</button>}</div>}
    </section>

    <section aria-labelledby="pedia-link-heading" className="mt-10 border-t border-white/15 pt-8">
      <h2 id="pedia-link-heading" className="text-xl font-semibold text-white">Sudah punya tautan?</h2>
      <p className="mt-2 text-sm text-white/65">Masukkan tautan profil atau konten untuk menemukan layanan yang sesuai.</p>
      <div className="mt-4 max-w-2xl"><LinkPasteHero suggestionsFor={suggestionsFor} /></div>
    </section>

    <section aria-labelledby="pedia-how-heading" className="mt-10 border-t border-white/15 pt-8">
      <h2 id="pedia-how-heading" className="text-xl font-semibold text-white">Cara pemesanan</h2>
      <ol className="mt-4 grid gap-5 text-sm sm:grid-cols-3">{[
        ["Pilih paket", "Bandingkan karakteristik, jumlah, harga, dan ketentuan refill."],
        ["Periksa tujuan", "Masukkan tautan dan pastikan persyaratan layanan terpenuhi."],
        ["Bayar dan lacak", "Lanjutkan ke QRIS, lalu pantau status di halaman pesanan."],
      ].map(([title, text], i) => <li key={title}><p className="font-semibold text-white"><span className="mr-2 text-white/45">0{i + 1}</span>{title}</p><p className="mt-2 leading-relaxed text-white/65">{text}</p></li>)}</ol>
    </section>

    <section aria-labelledby="pedia-faq-heading" className="mt-10 border-t border-white/15 pt-8">
      <h2 id="pedia-faq-heading" className="text-xl font-semibold text-white">Sebelum memesan</h2>
      <div className="mt-4 divide-y divide-white/15">{FAQ.map((f) => <details key={f.q} className="py-4"><summary className="cursor-pointer text-sm font-medium text-white">{f.q}</summary><p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/70">{f.a}</p></details>)}</div>
      <div className="mt-5 flex flex-wrap gap-5 text-sm"><Link prefetch={false} href="/pedia/ketentuan" className="text-[#00E5FF]">Ketentuan Pedia</Link><Link prefetch={false} href="/pedia/bantuan" className="text-[#00E5FF]">Hubungi bantuan</Link></div>
    </section>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }) }} />
  </div>;
}
