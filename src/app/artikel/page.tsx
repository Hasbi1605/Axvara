import Link from "next/link";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type Article = { id: number; slug: string; title: string; excerpt: string | null; cover_url: string | null; published_at: string | null };

async function getArticles(): Promise<Article[]> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || "";
    const url = base ? `${base}/api/articles?published=1` : "/api/articles?published=1";
    // In edge, relative fetch works via internal; fallback to empty if fails
    const r = await fetch(url, { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) return [];
    const j = await r.json().catch(() => ({}));
    return (j.articles as Article[]) ?? [];
  } catch { return []; }
}

export default async function ArtikelListPage() {
  const articles = await getArticles();
  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="max-w-[720px]">
        <p className="text-[11px] tracking-[0.14em] text-[#00E5FF]/70 font-semibold uppercase">Artikel</p>
        <h1 className="mt-2 font-display font-bold text-[28px] sm:text-[36px] leading-none tracking-[-0.02em] text-white">Bansos AI gratis & tips hemat</h1>
        <p className="mt-3 text-sm leading-6 text-white/55 max-w-[52ch]">Kurasi share gratis, promo bundling, dan panduan pakai tool premium tanpa boros. Update tiap minggu.</p>
      </div>

      {articles.length === 0 ? (
        <div className="mt-10 ax-glass rounded-[24px] p-8 sm:p-10 text-center">
          <p className="text-white font-medium">Belum ada artikel</p>
          <p className="text-sm text-white/50 mt-1">Artikel pertama segera terbit — follow WA kami biar tidak ketinggalan.</p>
          <a href="https://wa.me/6282135277434?text=Halo%20AXVARA" target="_blank" className="mt-4 inline-flex h-10 px-5 rounded-full bg-[#00E5FF] text-[#070a1e] text-sm font-bold">Chat WA</a>
        </div>
      ) : (
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {articles.map((a) => (
            <Link key={a.id} href={`/artikel/${a.slug}`} className="group ax-glass rounded-[20px] overflow-hidden hover:border-white/15 transition">
              <div className="aspect-[16/10] bg-white/5 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.cover_url ? <img src={a.cover_url} alt={a.title} className="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" /> : <div className="w-full h-full bg-gradient-to-br from-white/10 to-white/[0.04]" />}
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-[11px] tracking-[0.08em] text-white/40 uppercase">{a.published_at ? new Date(a.published_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : ""}</p>
                <h2 className="mt-1 font-semibold text-white leading-snug line-clamp-2 group-hover:text-white">{a.title}</h2>
                {a.excerpt && <p className="mt-1.5 text-sm leading-5 text-white/55 line-clamp-2">{a.excerpt}</p>}
                <span className="mt-3 inline-flex text-xs font-semibold text-[#00E5FF] group-hover:text-white">Baca →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
