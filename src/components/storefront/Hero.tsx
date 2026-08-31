"use client";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Zap, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full opacity-60 blur-[80px]" style={{ background: "radial-gradient(ellipse at center, rgba(0,229,255,0.18), transparent 70%)" }} />
        <div className="absolute top-24 right-[10%] w-[420px] h-[420px] rounded-full opacity-30 blur-[60px]" style={{ background: "radial-gradient(ellipse at center, rgba(255,184,0,0.15), transparent 70%)" }} />
      </div>

      <div className="relative mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 pb-10 sm:pb-14">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full ax-glass px-3 py-1.5 text-xs font-medium text-white/80 border-white/10">
            <span className="w-2 h-2 rounded-full bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.8)] animate-pulse" />
            Gerbang Semua Tools Premium — Bayar QRIS 10 detik
          </div>
          <h1 className="mt-5 font-display font-bold tracking-[-0.03em] leading-[0.95] text-[36px] sm:text-[52px] lg:text-[60px] text-white">
            Satu Gerbang,
            <br />
            <span className="text-gradient-cyan">Semua Tools Premium.</span>
          </h1>
          <p className="mt-4 text-[15px] sm:text-[17px] leading-7 text-white/60 max-w-xl">
            AI Gateway, Akun Premium, Tools Pro — harga jujur, aktivasi cepat, bayar via <span className="text-white font-medium">QRIS / DANA / Gopay / Shopeepay / SeaBank</span>. Tanpa ribet.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#katalog">
              <Button size="lg" className="gap-2">
                Jelajahi Katalog <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Link href="#cara-bayar">
              <Button variant="glass" size="lg">
                Cara Bayar
              </Button>
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-3 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5"><ShieldCheck className="w-3.5 h-3.5 text-[#00E5FF]" /> Garansi Full</span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5"><Zap className="w-3.5 h-3.5 text-[#FFB800]" /> Aktivasi 5–15 Menit</span>
            <span className="inline-flex items-center gap-1.5 ax-glass rounded-full px-3 py-1.5"><CreditCard className="w-3.5 h-3.5 text-white/60" /> QRIS & Transfer</span>
          </div>
        </div>

        {/* Search besar seperti Apple Store */}
        <div className="mt-8 max-w-2xl">
          <div className="relative ax-glass rounded-2xl p-1.5 flex gap-2">
            <div className="flex-1 relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm">⌘K</span>
              <input
                placeholder="Cari ChatGPT Plus, AI Gateway, Canva Pro..."
                className="w-full h-11 pl-12 pr-4 rounded-xl bg-white/[0.04] border border-white/0 text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-white/[0.08]"
              />
            </div>
            <button className="h-11 px-6 rounded-xl bg-white text-[#080C1E] font-semibold text-sm hover:bg-white/90 transition">
              Cari
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
