"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE, adminWaLink } from "@/lib/site";

type FooterCategory = { id: number; name: string; slug: string };

export function Footer() {
  const pathname = usePathname();
  const [categories, setCategories] = useState<FooterCategory[]>([]);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Kategori gagal dimuat")))
      .then((body) => setCategories(Array.isArray(body.categories) ? body.categories : []))
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCategories([]); });
    return () => controller.abort();
  }, [pathname]);

  if (pathname?.startsWith("/admin")) return null;

  const subscribe = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Email belum dapat disimpan");
      setFeedback({ type: "success", message: body.existing ? "Email ini sudah terdaftar." : "Email berhasil didaftarkan." });
      setEmail("");
    } catch (submitError) {
      setFeedback({ type: "error", message: submitError instanceof Error ? submitError.message : "Email belum dapat disimpan" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer className="relative mt-16 overflow-hidden border-t border-white/10">
      <div className="pointer-events-none absolute -top-28 left-1/2 h-[260px] w-[860px] -translate-x-1/2 rounded-full opacity-[0.06] blur-[40px]" style={{ background: "radial-gradient(ellipse at center, #00E5FF, transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1280px] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.05fr] lg:gap-12">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-[19px] w-[22px] items-center justify-center text-white/90">
                <svg viewBox="0 0 120 110" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
                  <path d="M60 4 L6.5 104 L113.5 104 Z" /><path d="M60 4 L60 49.5" /><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" /><path d="M35.8 78.5 L84.2 78.5" /><path d="M35.8 78.5 L6.5 104" /><path d="M84.2 78.5 L113.5 104" />
                </svg>
              </span>
              <p className="font-display font-[300] tracking-[0.20em] text-white">AXVARA</p>
            </div>
            <p className="mt-3 max-w-[34ch] text-[13px] leading-[1.65] text-white/55">Tempat membeli akun dan tools premium dengan proses yang jelas dan dukungan admin.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Bergaransi</span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Aktivasi 5–15 menit</span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Support WA</span>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Jelajah</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link href="/#katalog" className="text-white/60 transition hover:text-white">Semua produk</Link></li>
              <li><Link href="/artikel" className="text-white/60 transition hover:text-white">AI & teknologi</Link></li>
              {categories.map((category) => (
                <li key={category.id}><a href={`/?category=${encodeURIComponent(category.slug)}#katalog`} className="text-white/60 transition hover:text-white">{category.name}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Bantuan</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link href="/cara-order" className="text-white/60 transition hover:text-white">Cara order</Link></li>
              <li><Link href="/garansi-replace" className="text-white/60 transition hover:text-white">Garansi & replace</Link></li>
              <li><a href={adminWaLink()} target="_blank" rel="noreferrer" className="text-[#00E5FF]/90 transition hover:text-white">Chat WA — {SITE.supportHours}</a></li>
            </ul>
          </div>

          <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Tetap update</p>
            <p className="mt-2 text-[13px] leading-5 text-white/55">Info produk, promo, dan artikel terbaru lewat email.</p>
            <form onSubmit={subscribe} className="mt-4 flex gap-2">
              <input type="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="email" placeholder="Email kamu" className="min-w-0 flex-1 h-9 rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/40 focus:outline-none" />
              <button type="submit" disabled={submitting} className="h-9 shrink-0 rounded-full bg-white px-4 text-sm font-bold text-[#080C1E] transition hover:bg-white/90 disabled:opacity-60">{submitting ? "Menyimpan…" : "Langganan"}</button>
            </form>
            <div aria-live="polite" className={`mt-3 min-h-4 text-[11px] ${feedback?.type === "error" ? "text-red-300" : "text-white/40"}`}>{feedback?.message ?? "Email tersimpan di panel admin. Tanpa spam."}</div>
          </div>
        </div>

        <div className="mt-10 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-white/35">© 2026 AXVARA</p>
          <div className="flex items-center gap-4 text-xs"><Link href="/#katalog" className="text-white/40 transition hover:text-white">Katalog</Link><Link href="/artikel" className="text-white/40 transition hover:text-white">Artikel</Link></div>
        </div>
      </div>
    </footer>
  );
}
