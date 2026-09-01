"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <footer className="relative overflow-hidden border-t border-white/10 mt-16">
      <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 w-[860px] h-[260px] rounded-full opacity-[0.06] blur-[40px]" style={{ background: "radial-gradient(ellipse at center, #00E5FF, transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-12 sm:py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.05fr] gap-10 lg:gap-12">
          {/* Brand — premium editorial, not AI slop */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-[22px] h-[19px] text-white/90 flex items-center justify-center">
                <svg viewBox="0 0 120 110" className="w-full h-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
                  <path d="M60 4 L6.5 104 L113.5 104 Z" />
                  <path d="M60 4 L60 49.5" />
                  <path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" />
                  <path d="M35.8 78.5 L84.2 78.5" />
                  <path d="M35.8 78.5 L6.5 104" />
                  <path d="M84.2 78.5 L113.5 104" />
                </svg>
              </span>
              <p className="font-display font-[300] tracking-[0.20em] text-white">AXVARA</p>
            </div>
            <p className="mt-3 text-[13px] leading-[1.65] text-white/55 max-w-[34ch]">
              Kurasi tool premium yang kamu pakai tiap hari. Satu gerbang, harga jujur — tanpa ribet.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2.5 py-1 text-[11px] text-white/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Bergaransi
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2.5 py-1 text-[11px] text-white/60">
                Aktivasi 5–15 menit
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2.5 py-1 text-[11px] text-white/60">
                Support WA
              </span>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-white/40 uppercase">Jelajah</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link href="/#katalog" className="text-white/60 hover:text-white transition">Semua produk</Link></li>
              <li><Link href="/artikel" className="text-white/60 hover:text-white transition">Artikel & bansos</Link></li>
              <li><Link href="/#katalog" className="text-white/60 hover:text-white transition">AI Gateway</Link></li>
              <li><Link href="/#katalog" className="text-white/60 hover:text-white transition">Bundle hemat</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-white/40 uppercase">Bantuan</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link href="/#katalog" className="text-white/60 hover:text-white transition">Cara order</Link></li>
              <li><Link href="/#katalog" className="text-white/60 hover:text-white transition">Garansi & replace</Link></li>
              <li><a href="https://wa.me/6282135277434?text=Halo%20AXVARA" target="_blank" className="text-[#00E5FF]/90 hover:text-white transition">Chat WA — 09.00–23.00 WIB</a></li>
            </ul>
          </div>

          <div className="rounded-[20px] bg-white/[0.04] border border-white/10 p-4 sm:p-5">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">Tetap update</p>
            <p className="mt-2 text-[13px] leading-5 text-white/55">Info bundle & restock, langsung ke WA kamu.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget as HTMLFormElement;
                const input = form.elements.namedItem("contact") as HTMLInputElement | null;
                const v = input?.value?.trim();
                if (!v) return;
                const msg = encodeURIComponent(`Halo AXVARA, saya mau info promo. Kontak saya: ${v}`);
                window.open(`https://wa.me/6282135277434?text=${msg}`, "_blank");
                if (input) input.value = "";
              }}
              className="mt-4 flex gap-2"
            >
              <input name="contact" placeholder="Nomor WA" className="flex-1 h-9 px-3.5 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
              <button type="submit" className="h-9 px-5 rounded-full bg-white text-[#080C1E] text-sm font-bold hover:bg-white/90 transition shrink-0">Langganan</button>
            </form>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-white/35">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse" /> Balas cepat di WA
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:items-center justify-between border-t border-white/10 pt-6">
          <p className="text-xs text-white/35">© 2026 AXVARA</p>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/#katalog" className="text-white/40 hover:text-white transition">Katalog</Link>
            <Link href="/artikel" className="text-white/40 hover:text-white transition">Artikel</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
