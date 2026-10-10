"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";
import { useStoreSettings } from "@/hooks/useStoreSettings";
import { waHubLink } from "@/lib/site";

type FooterCategory = { id: number; name: string; slug: string };

// Ikon brand satu tone (fill=currentColor) dari Simple Icons versi terbaru
// (2026-10-03, diverifikasi via cdn.jsdelivr.net/npm/simple-icons@latest):
// Instagram + Threads (redesain Meta 2026, PR #14879) + TikTok + Facebook.
// ViewBox 24x24 seragam, tanpa warna brand asli agar selaras tema Midnight.
const SOCIAL_ICON_PATHS = {
  instagram:
    "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
  threads:
    "M18.263 11.097c-.03-3.486-1.92-5.586-5.111-5.586-2.13 0-3.922.963-4.863 2.499l2.062 1.438c.535-.843 1.272-1.543 2.628-1.543 1.528 0 2.318.85 2.544 2.431a15 15 0 0 0-2.236-.173c-4.125 0-6.068 1.867-6.068 4.336s1.943 3.99 4.804 3.99c3.139 0 5.013-2.115 5.781-4.735.798.361 1.348 1.204 1.348 2.47 0 3.387-3.907 5.232-7.22 5.232-4.885 0-8.077-3.207-8.077-8.424 0-6.392 4.223-10.487 9.9-10.487 3.808 0 5.69 1.671 6.97 3.914l2.108-1.475C21.44 2.078 18.331 0 13.663 0 6.227 0 1.168 5.277 1.168 12.934c0 7 4.953 11.066 10.856 11.066 4.878 0 9.809-2.846 9.809-7.716 0-2.545-1.46-4.231-3.569-5.187m-6.33 4.855c-1.077 0-2.026-.512-2.026-1.453 0-1.483 1.822-1.934 3.606-1.934.678 0 1.34.045 1.927.173-.422 1.927-1.671 3.215-3.508 3.214Z",
  tiktok:
    "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
} as const;

type SocialKey = keyof typeof SOCIAL_ICON_PATHS;

const SOCIAL_LINKS: { key: SocialKey; label: string; href: string }[] = [
  { key: "instagram", label: "Instagram AXVARA", href: SITE.social.instagram },
  { key: "threads", label: "Threads AXVARA", href: SITE.social.threads },
  { key: "tiktok", label: "TikTok AXVARA", href: SITE.social.tiktok },
  { key: "facebook", label: "Facebook AXVARA", href: SITE.social.facebook },
];

export function Footer({ shopBase = "" }: { shopBase?: string }) {
  // shopBase: prefix host toko saat footer dipakai di host lain.
  // Pedia (pedia.axvara.tech) → shopBase="https://axvara.tech" agar link
  // market tidak jatuh ke host Pedia (2026-10-08 owner: footer konsisten).
  const shop = (path: string) => `${shopBase}${path}`;
  const pathname = usePathname();
  const [categories, setCategories] = useState<FooterCategory[]>([]);
  const storeSettings = useStoreSettings();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Kategori gagal dimuat")))
      .then((categoryBody) => setCategories(Array.isArray(categoryBody.categories) ? categoryBody.categories : []))
      .catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setCategories([]); });
    return () => controller.abort();
  }, [pathname]);

  if (pathname?.startsWith("/admin")) return null;
  // Halaman link-in-bio (/link) + hub WA (/wa) tampil tanpa chrome global agar fokus.
  if (pathname === "/link" || pathname === "/wa") return null;

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
    <footer className="relative mt-16 overflow-hidden border-t border-white/10 pb-16 md:pb-0">
      <div className="pointer-events-none absolute -top-28 left-1/2 h-[260px] w-[860px] -translate-x-1/2 rounded-full opacity-[0.06] blur-[40px]" style={{ background: "radial-gradient(ellipse at center, #00E5FF, transparent 70%)" }} />

      <div className="relative mx-auto max-w-[1280px] px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.05fr] lg:gap-12">
          <div>
            <div className="flex items-center gap-2.5">
              {storeSettings.logoUrl ? <span className="flex h-[22px] w-[24px] items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={storeSettings.logoUrl} alt="" className="h-full w-full object-contain" />
              </span> : <span className="flex h-[19px] w-[22px] items-center justify-center text-white/90">
                <svg viewBox="0 0 120 110" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" shapeRendering="geometricPrecision" aria-hidden>
                  <path d="M60 4 L6.5 104 L113.5 104 Z" /><path d="M60 4 L60 49.5" /><path d="M60 49.5 L35.8 78.5 L84.2 78.5 Z" /><path d="M35.8 78.5 L84.2 78.5" /><path d="M35.8 78.5 L6.5 104" /><path d="M84.2 78.5 L113.5 104" />
                </svg>
              </span>}
              <p className="font-display font-[300] tracking-[0.20em] text-white">{storeSettings.name}</p>
            </div>
            <p className="mt-3 max-w-[34ch] text-[13px] leading-[1.65] text-white/55">{storeSettings.tagline}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Bergaransi</span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Aktivasi 5–15 menit</span>
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/60">Support WA</span>
            </div>
            <div className="mt-4 flex items-center gap-2">
              {SOCIAL_LINKS.map((social) => (
                <a
                  key={social.key}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={social.label}
                  title={social.label}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 transition hover:border-[#00E5FF]/40 hover:text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor" aria-hidden="true">
                    <path d={SOCIAL_ICON_PATHS[social.key]} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Jelajah</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link prefetch={false} href={shop("/#katalog")} className="text-white/60 transition hover:text-white">Semua produk</Link></li>
              <li>
                <Link prefetch={false} href="/pedia?utm_source=axvara&utm_medium=footer" className="text-white/60 transition hover:text-white">
                  Axvara Pedia
                  <span className="ml-1.5 rounded-full bg-[#FFB800]/15 px-1.5 py-px text-[10px] font-bold text-[#FFCF55]">Baru</span>
                </Link>
              </li>
              <li><Link prefetch={false} href={shop("/artikel")} className="text-white/60 transition hover:text-white">AI & teknologi</Link></li>
              {categories.map((category) => (
                <li key={category.id}><a href={shop(`/?category=${encodeURIComponent(category.slug)}#katalog`)} className="text-white/60 transition hover:text-white">{category.name}</a></li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">Bantuan</p>
            <ul className="mt-3.5 space-y-2.5 text-[13px]">
              <li><Link prefetch={false} href={shop("/cara-order")} className="text-white/60 transition hover:text-white">Cara order</Link></li>
              <li><Link prefetch={false} href="/pedia/lacak" className="text-white/60 transition hover:text-white">Lacak pesanan Pedia</Link></li>
              <li><Link prefetch={false} href={shop("/lacak-pesanan")} className="text-white/60 transition hover:text-white">Lacak pesanan market</Link></li>
              <li><Link prefetch={false} href="/pedia/bantuan" className="text-white/60 transition hover:text-white">Bantuan Pedia</Link></li>
              <li><Link prefetch={false} href={shop("/garansi-replace")} className="text-white/60 transition hover:text-white">Garansi & replace</Link></li>
              <li><a href={waHubLink(`Halo ${storeSettings.name}`)} target="_blank" rel="noreferrer" className="text-[#00E5FF]/90 transition hover:text-white">Chat WA — {storeSettings.supportHours}</a></li>
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

        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-xs text-white/35">© 2026 {storeSettings.name}</p>
        </div>
      </div>
    </footer>
  );
}
