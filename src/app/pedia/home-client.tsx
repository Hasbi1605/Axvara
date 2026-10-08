// src/app/pedia/home-client.tsx — Beranda Pedia interaktif (PD-01).
// Hero + LinkPasteHero + trust strip + PlatformGrid + laris + cara kerja +
// ticker (≥5/24jam) + FAQ.
"use client";

import { useMemo } from "react";
import { LinkPasteHero } from "@/components/pedia/LinkPasteHero";
import { PlatformGrid, ProductCard, type ProductCardData } from "@/components/pedia/PlatformGrid";
import { OrderTicker } from "@/components/pedia/OrderTicker";
import type { PediaLinkDetect } from "@/lib/pedia/link";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const FAQ = [
  { q: "Bagaimana cara order?", a: "Tempel link profil atau postingan, pilih layanan dan jumlah, bayar QRIS. Pesanan mulai dalam hitungan menit." },
  { q: "Apakah akun saya harus publik?", a: "Ya. Akun yang dikunci tidak bisa diproses. Buka kunci dulu sebelum order." },
  { q: "Berapa lama prosesnya?", a: "Mulai dalam ±5–30 menit tergantung layanan. Estimasi selesai tampil sebelum kamu bayar." },
  { q: "Apa itu garansi?", a: "Produk bergaransi bisa refill gratis bila jumlah turun dalam masa garansi. Produk tanpa garansi tidak." },
  { q: "Bagaimana bila pesanan sebagian/cancel?", a: "Sisa dana otomatis jadi Kode Kredit Pedia (email + halaman pesanan), berlaku 180 hari untuk belanja lagi." },
  { q: "Apakah aman untuk akun saya?", a: "Layanan hanya menambah angka interaksi. Kamu tetap bertanggung jawab atas kepatuhan terhadap aturan platform." },
];

export function PediaHomeClient({ products, ticker }: { products: PediaCatalogProduct[]; ticker: { text: string }[] }) {
  const cards: ProductCardData[] = useMemo(() => products.map((p) => ({
    slug: p.slug, name: p.name, tagline: p.tagline, platform: p.platform,
    badges: badgesFor(p), minPrice: p.min_price,
  })), [products]);

  const suggestionsFor = useMemo(() => (d: PediaLinkDetect) => {
    const kind = d.targetKind;
    const match = products.filter((p) =>
      p.platform === d.platform &&
      (p.target_kind === kind ||
        (kind === "video" && (p.target_kind === "post" || p.target_kind === "reel")) ||
        (kind === "post" && p.target_kind === "video") ||
        (kind === "reel" && p.target_kind === "video") ||
        (kind === "channel" && p.target_kind === "profile")),
    );
    return match.map((p) => ({ slug: p.slug, name: p.name, minPrice: p.min_price, target: d.normalized }));
  }, [products]);

  return (
    <div>
      {/* Hero — tanpa glow (2026-10-08 owner: gradien potong tidak smooth) */}
      <section className="relative overflow-hidden px-1 pt-8 sm:px-0 sm:pt-16">
        <h1 className="animate-[fadeInUp_420ms_var(--ease-out)] font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-white sm:text-[56px] sm:leading-[1.08]">
          Tempel link,<br />sisanya beres.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] text-white/60 sm:text-[18px]">
          Followers, likes, dan views untuk Instagram, TikTok, YouTube, dan lainnya. Bayar QRIS, mulai dalam hitungan menit.
        </p>
        <div className="mt-6 animate-[fadeInUp_420ms_var(--ease-out)]" style={{ animationDelay: "80ms" }}>
          <LinkPasteHero suggestionsFor={suggestionsFor} />
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-white/55">
          <span>✓ Bayar QRIS</span><span>✓ Mulai ±5 menit</span><span>✓ Garansi refill</span><span>✓ Sisa dana kembali otomatis</span>
        </p>
      </section>

      {/* Platform — mobile 4 kolom rapat ala market, desktop 8 */}
      <section className="mt-10 sm:mt-24">
        <PlatformGrid />
      </section>

      {/* Paling laris */}
      {cards.length > 0 && (
        <section className="mt-10 sm:mt-24">
          <h2 className="font-display text-[20px] font-bold text-white sm:text-[32px]">Paling laris</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:mt-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </section>
      )}

      {/* Cara kerja */}
      <section className="mt-10 sm:mt-24">
        <h2 className="font-display text-[20px] font-bold text-white sm:text-[32px]">Cara kerja</h2>
        <ol className="mt-3 grid gap-2.5 sm:mt-4 sm:grid-cols-3 sm:gap-3">
          {["Tempel link profil atau postingan", "Pilih layanan & jumlah", "Bayar QRIS, pantau progres"].map((s, i) => (
            <li key={s} className="ax-glass-card rounded-[20px] p-4 text-sm text-white/75">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--px-violet-soft)] text-xs font-bold text-white">{i + 1}</span>
              <span className="mt-2 block">{s}</span>
            </li>
          ))}
        </ol>
        {ticker.length >= 5 && (
          <div className="mt-4">
            <OrderTicker items={ticker} />
          </div>
        )}
      </section>

      {/* FAQ */}
      <section className="mt-10 sm:mt-24">
        <h2 className="font-display text-[20px] font-bold text-white sm:text-[32px]">Pertanyaan umum</h2>
        <div className="mt-4 space-y-2">
          {FAQ.map((f) => (
            <details key={f.q} className="ax-glass-card group rounded-[20px] p-4">
              <summary className="cursor-pointer text-[15px] font-semibold text-white">{f.q}</summary>
              <p className="mt-2 text-sm text-white/65">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
    </div>
  );
}

function badgesFor(p: PediaCatalogProduct): string[] {
  const out: string[] = [];
  const notes = p.tiers.map((t) => t.label_note ?? "").join(" ").toLowerCase();
  if (/indonesia aktif/.test(notes)) out.push("Akun Indonesia aktif");
  else if (/indonesia/.test(notes)) out.push("Akun Indonesia");
  const maxRefill = Math.max(0, ...p.tiers.map((t) => t.refill_days));
  if (maxRefill > 0) out.push(`Garansi ${maxRefill} hari`);
  return out.slice(0, 2);
}
