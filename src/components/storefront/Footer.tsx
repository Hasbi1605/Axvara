"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;
  return (
    <footer className="relative overflow-hidden border-t border-white/10 mt-12">
      <div className="pointer-events-none absolute -top-28 left-1/2 -translate-x-1/2 w-[860px] h-[260px] rounded-full opacity-[0.07] blur-[40px]" style={{ background: "radial-gradient(ellipse at center, #00E5FF, transparent 70%)" }} />
      <div className="pointer-events-none absolute -bottom-24 right-[8%] w-[420px] h-[220px] rounded-full opacity-[0.05] blur-[36px]" style={{ background: "radial-gradient(ellipse at center, #FFB800, transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.25fr_0.9fr_0.9fr_1fr] gap-8 lg:gap-10">
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
            <p className="mt-3 text-sm leading-6 text-white/60 max-w-[32ch]">Gerbang Semua Tools Premium — AI Gateway, Akun Premium, Tools Pro, dan Bundle Hemat. Aktivasi cepat, bergaransi, support WA ramah.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-2.5 py-1 text-[11px] font-medium text-white/70">
                <img src="/icons/ios11/shield-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-60" draggable={false} /> Bergaransi
              </span>
              <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-2.5 py-1 text-[11px] font-medium text-white/70">
                <img src="/icons/ios11/lightning-bolt-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-60" draggable={false} /> 5–15 Menit
              </span>
              <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-2.5 py-1 text-[11px] font-medium text-white/70">
                <img src="/icons/ios11/star-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-60" draggable={false} /> Support WA
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="#" onClick={(e) => { e.preventDefault(); alert("Link Grup WhatsApp AXVARA menyusul — hubungi Admin via WA untuk info terbaru."); }} className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-bold pl-1 pr-3 py-1 hover:bg-[#1ebd5a] transition">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/whatsapp.svg" alt="" width={20} height={20} className="w-5 h-5 rounded-full object-contain bg-white shrink-0" draggable={false} /> Grup WhatsApp
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); alert("Link Bot Telegram AXVARA menyusul — hubungi Admin via WA untuk info terbaru."); }} className="inline-flex items-center gap-1.5 rounded-full bg-[#2AABEE] text-white text-[11px] font-bold pl-1 pr-3 py-1 hover:bg-[#229ED9] transition">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/telegram.svg" alt="" width={20} height={20} className="w-5 h-5 rounded-full object-cover shrink-0" draggable={false} /> Bot Telegram
              </a>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-white/45 uppercase">Katalog</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/#katalog" className="text-white/65 hover:text-white transition">Semua Produk</Link></li>
              <li><Link href="/#katalog" className="inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"><img src="/icons/ios11/lightning-bolt-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-50" draggable={false} /> AI Gateway</Link></li>
              <li><Link href="/#katalog" className="inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"><img src="/icons/ios11/crown-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-50" draggable={false} /> Akun Premium</Link></li>
              <li><Link href="/#katalog" className="inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"><img src="/icons/ios11/shield-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-50" draggable={false} /> Tools Pro</Link></li>
              <li><Link href="/#katalog" className="inline-flex items-center gap-1.5 text-white/65 hover:text-white transition"><img src="/icons/ios11/packaging-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-50" draggable={false} /> Bundle Hemat</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-white/45 uppercase">Bantuan</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/#katalog" className="text-white/65 hover:text-white transition">Cara Order</Link></li>
              <li><Link href="/#katalog" className="text-white/65 hover:text-white transition">Garansi & Replace</Link></li>
              <li><Link href="/#katalog" className="text-white/65 hover:text-white transition">Jam Layanan 09.00–23.00 WIB</Link></li>
              <li><a href="https://wa.me/6282135277434?text=Halo%20AXVARA" target="_blank" className="inline-flex items-center gap-1.5 text-[#00E5FF] hover:text-white transition"><img src="/icons/ios11/chat-32.png" alt="" width={12} height={12} className="w-3 h-3 object-contain brightness-0 invert opacity-70" draggable={false} /> Chat WA Admin</a></li>
            </ul>
          </div>

          <div className="ax-glass rounded-[20px] p-4 sm:p-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-white/70 uppercase">Dapat Info Promo</p>
            <p className="mt-1 text-xs leading-5 text-white/50">Drop WA atau email — kami kirim info bundle & restock. No spam.</p>
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
              className="mt-3 flex gap-2"
            >
              <input name="contact" placeholder="WA / email kamu" className="flex-1 h-9 px-3 rounded-full bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
              <button type="submit" className="h-9 px-4 rounded-full bg-white text-[#080C1E] text-xs font-bold hover:bg-white/90 transition shrink-0">Kirim</button>
            </form>
            <p className="mt-3 text-[11px] leading-4 text-white/30">Dengan kirim kamu setuju dihubungi via WA untuk info produk AXVARA.</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse" /> Online — balas cepat di WA
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center justify-between border-t border-white/10 pt-6">
          <p className="text-xs text-white/40">© 2026 AXVARA. Semua hak dilindungi.</p>
          {/* keep minimal — no Brotherstore06 per user request */}
          <div className="flex items-center gap-4 text-xs">
            <Link href="/#katalog" className="text-white/50 hover:text-white transition">Katalog</Link>
            <Link href="/admin" className="text-white/25 hover:text-white/60 transition">Admin</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
