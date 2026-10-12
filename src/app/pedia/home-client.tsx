"use client";

import { useState } from "react";
import Link from "next/link";
import { LinkPasteHero } from "@/components/pedia/LinkPasteHero";
import { PediaServiceCards } from "@/components/pedia/PediaServiceCards";
import { Typewriter } from "@/components/pedia/Typewriter";
import { PEDIA_PLATFORMS, PlatformIcon, ProductCard, catalogCard } from "@/components/pedia/PlatformGrid";
import type { PediaLinkDetect } from "@/lib/pedia/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const FAQ = [
  { q: "Bagaimana cara memesan?", a: "Pilih layanan, paket, dan jumlah. Masukkan tautan tujuan serta kontak, lalu lanjutkan ke pembayaran QRIS. Jika harga berubah, persetujuan Anda diminta terlebih dahulu." },
  { q: "Kapan pesanan mulai diproses?", a: "Estimasi mulai dan selesai mengikuti paket yang dipilih. Keduanya ditampilkan sebelum pembayaran; estimasi bukan jaminan waktu selesai." },
  { q: "Apa yang dimaksud refill?", a: "Refill adalah pengisian ulang jumlah yang turun, sesuai syarat dan masa berlaku paket. Tidak semua paket menyediakan refill. Baca Ketentuan Pedia sebelum memesan." },
  { q: "Bagaimana jika pesanan hanya selesai sebagian atau dibatalkan?", a: "Nilai bagian yang tidak diproses menjadi Kode Kredit Pedia, bukan pengembalian tunai. Kode berlaku 180 hari untuk pemesanan Pedia berikutnya dan dikirim melalui email serta halaman pesanan." },
  { q: "Apakah perlu memberikan password akun?", a: "Tidak. Pesanan menggunakan tautan profil atau konten. Akun atau konten harus dapat diakses publik dan memenuhi persyaratan layanan yang dipilih." },
];

export function PediaHomeClient({ products }: { products: PediaCatalogProduct[]; ordersEnabled?: boolean }) {
  const [platform, setPlatform] = useState("");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const featured = products.filter((p) => p.is_featured === 1);
  const browsingAll = showAll || !!platform || !!query.trim();
  const selection = browsingAll ? products : featured.length ? featured.slice(0, 8) : products.slice(0, 6);
  const filtered = selection.filter((p) => (!platform || p.platform === platform) && `${p.name} ${p.platform} ${p.metric}`.toLowerCase().includes(query.trim().toLowerCase()));
  const suggestionsFor = (d: PediaLinkDetect) => products.filter((p) => p.platform === d.platform &&
    (p.target_kind === d.targetKind || (p.target_kind === "post" && ["video", "reel"].includes(d.targetKind)) ||
      (p.target_kind === "video" && ["post", "reel"].includes(d.targetKind)) ||
      (p.target_kind === "profile" && d.targetKind === "channel")))
    .map((p) => ({ slug: p.slug, name: p.name, minPrice: p.min_price, target: d.normalized }));

  return <div className="pt-10 sm:pt-14 pb-4">
    {/* Hero ala Market: glow section-level (bukan di dalam card), h1 font-display
        42/56px tight, sub 15px/white-60, tanpa eyebrow AXVARA PEDIA. */}
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[520px] h-[300px] sm:w-[900px] sm:h-[520px] rounded-full opacity-60 blur-[44px] sm:blur-[80px]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.18), transparent 70%)" }} />
        <div className="absolute top-24 right-[10%] w-[240px] h-[240px] sm:w-[420px] sm:h-[420px] rounded-full opacity-30 blur-[36px] sm:blur-[60px] hidden sm:block" style={{ background: "radial-gradient(ellipse at center, rgba(255,184,0,0.15), transparent 70%)" }} />
      </div>
      <div className="relative max-w-3xl w-full">
        <h1 className="font-display font-[700] tracking-[-0.02em] leading-[0.98] text-[42px] sm:text-[56px] text-white">
          Layanan media sosial
          <Typewriter />
        </h1>
        <p className="mt-4 text-[15px] leading-6 text-white/60 max-w-[46ch]">
          Followers, likes, dan views. Pilih paket, masukkan link, lalu bayar dengan QRIS.
        </p>
      </div>
    </section>
    <div className="mt-6"><PediaServiceCards /></div>

    <section aria-labelledby="pedia-catalog-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h2 id="pedia-catalog-heading" className="font-display font-bold text-[20px] sm:text-[24px] text-white tracking-[-0.02em]">{browsingAll ? "Semua layanan" : featured.length ? "Pilihan AXVARA" : "Jelajahi layanan"}</h2>{(browsingAll || featured.length > 0) && <p className="mt-1 text-sm text-white/60">Harga awal sesuai jumlah dan paket yang ditampilkan.</p>}</div>
        <label className="w-full text-sm text-white/70 sm:w-64">Cari layanan<input value={query} onChange={(e) => setQuery(e.target.value)} type="search" placeholder="Nama layanan" className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-white/[0.03] px-3 text-base text-white placeholder:text-white/40" /></label>
      </div>
      <details className="mt-3 max-w-2xl rounded-xl border border-white/10 bg-white/[0.025] px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-[#00E5FF]">Cari lewat link <span className="ml-2 text-xs text-white/50">Opsional</span></summary>
        <div className="pb-3"><p className="mb-3 text-xs leading-relaxed text-white/60">Tempel link untuk melihat pilihan layanan yang cocok. Anda tetap memilih paketnya.</p><LinkPasteHero suggestionsFor={suggestionsFor} /></div>
      </details>
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Filter platform">
        <button type="button" aria-pressed={!platform} onClick={() => setPlatform("")} className={`min-h-11 rounded-lg border px-3 text-sm ${!platform ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}>Semua</button>
        {PEDIA_PLATFORMS.filter((p) => products.some((product) => product.platform === p.id)).map((p) => <button key={p.id} type="button" aria-pressed={platform === p.id} onClick={() => setPlatform(p.id)} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${platform === p.id ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/70"}`}><PlatformIcon id={p.id} size={18} />{p.label}</button>)}
      </div>
      <p role="status" className="mt-4 text-xs text-white/60">{filtered.length} layanan</p>
      {filtered.length ? <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3">{filtered.map((p) => <ProductCard key={p.slug} p={catalogCard(p)} />)}</div> : <div className="mt-3 rounded-xl border border-white/15 p-6 text-sm text-white/70"><p>{products.length ? "Tidak ada layanan yang sesuai pencarian." : "Layanan belum tersedia. Coba kembali nanti atau hubungi bantuan."}</p>{products.length > 0 && <button type="button" onClick={() => { setQuery(""); setPlatform(""); setShowAll(true); }} className="mt-3 min-h-11 text-[#00E5FF]">Reset pencarian</button>}</div>}
      {!browsingAll && products.length > filtered.length && <button type="button" onClick={() => setShowAll(true)} className="mt-5 min-h-11 w-full rounded-xl border border-[#00E5FF]/25 bg-[#00E5FF]/5 px-4 text-sm font-medium text-[#00E5FF] transition-colors hover:bg-[#00E5FF]/10">Tampilkan semua layanan <span className="ml-2 text-white/60">({products.length})</span></button>}
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
